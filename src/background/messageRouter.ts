import type {
  UIMessage,
  AskTaskState,
  ProviderName,
  ProviderStatus,
  HistoryEntry,
  ExportMarkdownMessage,
} from '../shared/types';
import { broadcastTaskState } from '../shared/messaging';
import {
  createTask,
  getTask,
  updateProviderStatus,
  updateProviderContent,
  finishProviderTask,
  failProviderTask,
  setProviderTabId,
  updateProviderUrl,
  loadLastTask,
} from './stateStore';
import { getOrCreateProviderTab } from './tabManager';
import {
  getConversationIdForTask,
  ensureConversationForTask,
  getConversation,
  appendTurn,
  sedimentTask,
  getCurrentConversationId,
  getOrCreateConversation,
  listConversations,
  renameConversation,
  deleteConversation,
  loadConversations,
} from './conversationStore';
import { manualGrab, manualGrabAll, saveGrabbedText, grabFromProviderTab } from './manualGrab';
import { loadTabRegistry } from './tabManager';
import { trustedClickAt } from './trustedClick';
import { buildMarkdown, fileNameFor } from '../shared/exportMarkdown';
import { runWorkbenchExecution } from './workbenchEngine';
import { ALL_PROVIDERS } from '../shared/constants';

console.log('[MultiAI:messageRouter] build=spec-v2 2026-08-02');

const HISTORY_KEY = 'conversation_history';
const MAX_HISTORY = 200;

// 流式内容节流落盘：断线重连后可从这里恢复最新内容
const streamWriteAt = new Map<string, number>();
const STREAM_CACHE_TTL = 30 * 60 * 1000; // 30 分钟无更新的任务清理节流记录
function persistStream(taskId: string, task: AskTaskState, force = false): void {
  const now = Date.now();
  // 定期清理过期的节流记录，避免 Map 无限膨胀
  if (streamWriteAt.size > 64) {
    for (const [k, t] of streamWriteAt) {
      if (now - t > STREAM_CACHE_TTL) streamWriteAt.delete(k);
    }
  }
  if (!force) {
    const last = streamWriteAt.get(taskId) || 0;
    if (now - last < 2000) return;
    streamWriteAt.set(taskId, now);
  } else {
    streamWriteAt.set(taskId, now);
  }
  const providers: Record<string, { content: string; status: string }> = {};
  for (const [p, ps] of Object.entries(task.providers)) providers[p] = { content: ps.content, status: ps.status };
  chrome.storage.local.get('studio_laststream').then((r) => {
    const m = (r.studio_laststream || {}) as Record<
      string,
      { prompt: string; providers: Record<string, { content: string; status: string }>; updatedAt: number }
    >;
    m[taskId] = { prompt: task.prompt, providers, updatedAt: now };
    const keys = Object.keys(m)
      .sort((a, b) => (m[b].updatedAt || 0) - (m[a].updatedAt || 0))
      .slice(0, 5);
    const pruned: Record<string, unknown> = {};
    keys.forEach((k) => (pruned[k] = m[k]));
    chrome.storage.local.set({ studio_laststream: pruned }).catch(() => {});
  }).catch(() => {});
}

async function saveToHistory(task: AskTaskState): Promise<void> {
  const entry: HistoryEntry = {
    id: task.taskId,
    prompt: task.prompt,
    createdAt: task.createdAt,
    providers: {} as HistoryEntry['providers'],
  };
  for (const [p, ps] of Object.entries(task.providers)) {
    // 优先使用 task 上已记录的 url（iframe 嵌入模式由 EMBED_URL 回报写入）；
    // 若无则尝试从 tabId 反查（标签页模式）。
    let url: string | undefined = ps.url;
    if (!url && ps.tabId !== undefined) {
      try {
        const tab = await chrome.tabs.get(ps.tabId);
        url = tab.url;
      } catch {
        // Tab may have been closed
      }
    }
    entry.providers[p as ProviderName] = {
      status: ps.status,
      content: ps.content,
      tabId: ps.tabId,
      url,
    };
  }

  const result = await chrome.storage.local.get(HISTORY_KEY);
  const history: HistoryEntry[] = result[HISTORY_KEY] || [];
  const filtered = history.filter((h) => h.id !== entry.id);
  filtered.unshift(entry);
  const trimmed = filtered.slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ [HISTORY_KEY]: trimmed });
}

function providersAllDone(task: AskTaskState): boolean {
  return Object.values(task.providers).every(
    (p) => p.status === 'done' || p.status === 'error' || p.status === 'login_required'
  );
}

let ready = false;
const pendingMessages: Array<{
  msg: Record<string, unknown>;
  sender: chrome.runtime.MessageSender;
  sendResponse: (r?: unknown) => void;
}> = [];

const UI_TYPES = new Set([
  'ASK_ALL',
  'GET_TASK_STATE',
  'RETRY_PROVIDER',
  'SWITCH_MODE',
  'NEW_CONVERSATION',
  'APPEND_TURN',
  'GET_CONVERSATION',
  'LIST_CONVERSATIONS',
  'RENAME_CONVERSATION',
  'DELETE_CONVERSATION',
  'MANUAL_GRAB',
  'MANUAL_GRAB_ALL',
  'EMBED_GRAB_SAVE',
  'EXPORT_MARKDOWN',
  'RESUME',
  'KA',
  'TRUSTED_CLICK',
  'WORKBENCH_EXECUTE',
  'WORKBENCH_GRAB',
]);
const CONTENT_TYPES = new Set(['PROVIDER_STATUS', 'STREAM_UPDATE', 'TASK_DONE', 'TASK_ERROR', 'EMBED_URL']);

// 双形态入口（§4）：工具栏点击默认打开「侧边栏」；
// 「全屏页」由侧边栏内的 ⛶ 按钮（SWITCH_MODE target=fullscreen）打开。
// 注意：openPanelOnActionClick=true 与 action.onClicked 互斥，后者不会触发。
chrome.action.onClicked.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .then(() => chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT }))
    .catch(() => {});
});

chrome.runtime.onMessage.addListener((rawMsg, sender, sendResponse) => {
  const msg = rawMsg as Record<string, unknown>;
  const type = msg.type as string;

  if (UI_TYPES.has(type)) {
    if (!ready) {
      console.log('[MultiAI:background] Queuing UI message, not ready yet:', type);
      pendingMessages.push({ msg, sender, sendResponse });
      return true;
    }
    handleUIMessage(msg as UIMessage, sender)
      .then((resp) => sendResponse(resp))
      .catch((err) => {
        // 不再吞掉错误（之前 sendResponse() 无参数 → 前端收到 undefined → "无响应"）
        const errMsg = err instanceof Error ? err.message : String(err ?? 'unknown');
        console.error('[MultiAI:background] handleUIMessage error for', msg.type, ':', errMsg);
        sendResponse({ ok: false, outputs: {}, errors: { _system: errMsg } });
      });
    return true;
  }

  if (CONTENT_TYPES.has(type)) {
    if (!ready) {
      pendingMessages.push({ msg: rawMsg as Record<string, unknown>, sender, sendResponse });
      return true;
    }
    handleContentMessage(rawMsg as Record<string, unknown>);
    sendResponse();
    return false;
  }

  return false;
});

async function doInit(): Promise<void> {
  console.log('[MultiAI:background] Initializing...');
  await loadLastTask();
  await loadTabRegistry();
  await loadConversations().catch(() => {});
  // 工具栏点击默认打开侧边栏（§4 双形态入口）
  await chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
  ready = true;
  console.log('[MultiAI:background] Ready, processing', pendingMessages.length, 'pending messages');
  for (const { msg, sender, sendResponse } of pendingMessages) {
    if (msg.type && CONTENT_TYPES.has(msg.type as string)) {
      handleContentMessage(msg as Record<string, unknown>);
    } else {
      await handleUIMessage(msg as UIMessage, sender).catch(() => {});
    }
    sendResponse();
  }
  pendingMessages.length = 0;
}

doInit().catch(console.error);

let fullscreenTabId: number | undefined;

async function openFullscreen(): Promise<void> {
  const url = chrome.runtime.getURL('public/sidepanel.html') + '?mode=fullscreen';
  if (fullscreenTabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(fullscreenTabId);
      if (tab) {
        await chrome.tabs.update(fullscreenTabId, { active: true });
        if (tab.windowId !== undefined) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
        return;
      }
    } catch {
      fullscreenTabId = undefined;
    }
  }
  const tab = await chrome.tabs.create({ url, active: true });
  if (tab.id) fullscreenTabId = tab.id;
}

async function openSidePanel(): Promise<void> {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  let windowId: number | undefined;
  if (fullscreenTabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(fullscreenTabId);
      windowId = tab.windowId;
      await chrome.tabs.remove(fullscreenTabId).catch(() => {});
    } catch {
      /* fullscreen tab 已关闭 */
    }
    fullscreenTabId = undefined;
  }
  if (windowId === undefined) {
    const w = await chrome.windows.getCurrent().catch(() => undefined);
    windowId = w?.id;
  }
  if (windowId !== undefined) {
    chrome.sidePanel.open({ windowId }).catch(() => {});
  }
}

export async function handleUIMessage(
  msg: UIMessage,
  _sender: chrome.runtime.MessageSender
): Promise<unknown> {
  console.log('[MultiAI:background] handleUIMessage', msg.type);
  switch (msg.type) {
    case 'ASK_ALL': {
      await handleAskAll(msg.taskId, msg.prompt, msg.targets);
      return undefined;
    }
    case 'GET_TASK_STATE': {
      const task = getTask(msg.taskId);
      if (task) broadcastTaskState({ type: 'TASK_STATE_UPDATE', task });
      return undefined;
    }
    case 'RETRY_PROVIDER': {
      await retryProvider(msg.taskId, msg.provider);
      return undefined;
    }
    case 'SWITCH_MODE': {
      if (msg.target === 'fullscreen') await openFullscreen();
      else await openSidePanel();
      return undefined;
    }
    case 'NEW_CONVERSATION': {
      const conv = await getOrCreateConversation(msg.conversationId, msg.title || '新对话');
      return { type: 'CONVERSATION_UPDATE', conversation: conv };
    }
    case 'APPEND_TURN': {
      await appendTurn(msg.conversationId, {
        id: msg.turnId,
        prompt: msg.prompt,
        targets: msg.targets,
      });
      if (msg.embed) {
        // 嵌入视图：只建任务（waiting）并广播初始状态，不打开标签页、不自动派发。
        // 实际执行由网页视图里的 iframe 通过 postMessage 触发。
        const task = createTask(msg.turnId, msg.prompt, msg.targets);
        broadcastTaskState({ type: 'TASK_STATE_UPDATE', task });
        return undefined;
      }
      await handleAskAll(msg.turnId, msg.prompt, msg.targets, { convId: msg.conversationId });
      return undefined;
    }
    case 'GET_CONVERSATION': {
      const id = msg.conversationId ?? getCurrentConversationId();
      const conv = id ? getConversation(id) : undefined;
      return { type: 'CONVERSATION_UPDATE', conversation: conv ?? null };
    }
    case 'LIST_CONVERSATIONS': {
      const list = await listConversations();
      return { type: 'CONVERSATION_LIST', conversations: list };
    }
    case 'RENAME_CONVERSATION': {
      await renameConversation(msg.conversationId, msg.title);
      return { type: 'CONVERSATION_UPDATE', conversation: getConversation(msg.conversationId) ?? null };
    }
    case 'DELETE_CONVERSATION': {
      await deleteConversation(msg.conversationId);
      return { type: 'CONVERSATION_UPDATE', conversation: null };
    }
    case 'MANUAL_GRAB': {
      const out = await manualGrab(msg.conversationId, msg.turnId, msg.provider, msg.prompt);
      return { type: 'GRAB_RESULT', ...out };
    }
    case 'MANUAL_GRAB_ALL': {
      const conv = getConversation(msg.conversationId);
      const turn = conv?.turns.find((t) => t.id === msg.turnId);
      // 只抓「本轮实际请求过」的平台，避免对没参与的 provider 也去读屏（浪费 + 误报）
      const pending = (turn?.targets ?? ALL_PROVIDERS).filter((p) => {
        const a = turn?.answers[p];
        return !a || a.status !== 'done';
      });
      const outs = await manualGrabAll(msg.conversationId, msg.turnId, msg.prompt, pending);
      return {
        type: 'GRAB_RESULT',
        provider: pending[0] ?? 'chatgpt',
        ok: outs.length > 0 && outs.every((o) => o.ok),
      };
    }
    case 'EMBED_GRAB_SAVE': {
      const out = saveGrabbedText(
        msg.conversationId,
        msg.turnId,
        msg.provider,
        msg.prompt,
        msg.text,
        msg.method,
        msg.url
      );
      return { type: 'GRAB_RESULT', ...out };
    }
    case 'EXPORT_MARKDOWN': {
      return await triggerExport(msg);
    }
    case 'TRUSTED_CLICK': {
      const tabId = _sender.tab?.id;
      if (typeof tabId === 'number') {
        // 受信任点击：坐标由 sidepanel 基于 iframe 在 sidepanel 视口中的位置算出
        await trustedClickAt(tabId, msg.x as number, msg.y as number);
      }
      return { type: 'ACK' };
    }
    case 'WORKBENCH_EXECUTE': {
      const providers = (msg.providers ?? []) as ProviderName[];
      // 工作台每个节点用「专属标签页」：透传 nodeId，后台据此复用/新建该节点的专属 tab，
      // 既保证每节点独立新会话（不串台），又不会每次都新开标签堆满浏览器。
      const result = await runWorkbenchExecution(msg.prompt, providers, { nodeId: msg.nodeId as string | undefined });
      return result;
    }
    case 'WORKBENCH_GRAB': {
      // 手动兜底：重新从各家标签页读屏，挽回自动抓取失败的回答
      const providers = (msg.providers ?? []) as ProviderName[];
      const prompt = (msg.prompt ?? '') as string;
      const taskId = msg.taskId as string | undefined;
      const nodeId = msg.nodeId as string | undefined;
      const tabIds = (msg.tabIds ?? {}) as Partial<Record<ProviderName, number>>;
      const msgUrls = (msg.urls ?? {}) as Partial<Record<ProviderName, string>>;
      const outputs: Partial<Record<ProviderName, string>> = {};
      const errors: Partial<Record<ProviderName, string>> = {};
      const urls: Partial<Record<ProviderName, string>> = {};
      const resolvedTabIds: Partial<Record<ProviderName, number>> = {};
      for (const p of providers) {
        // 解析优先级：显式 tabId > 本节点登记的专属 tab > taskId > 域名查找（优先匹配本节点 url），
        // 确保多标签 / SW 重启后都抓到「这个节点」对应的那张页面，不串台。
        const g = await grabFromProviderTab(p, prompt, {
          nodeId,
          taskId,
          tabId: tabIds[p],
          url: msgUrls?.[p],
        });
        if (g.ok && g.text) outputs[p] = g.text;
        else errors[p] = g.reason || '未读取到回答文本';
        if (g.url) urls[p] = g.url;
        if (g.tabId !== undefined) resolvedTabIds[p] = g.tabId;
      }
      const ok = providers.every((p) => outputs[p] !== undefined && outputs[p]!.length > 0);
      return { ok, outputs, errors, urls, tabIds: resolvedTabIds };
    }
    case 'RESUME':
    case 'KA':
    default:
      return undefined;
  }
}

function handleContentMessage(msg: Record<string, unknown>): void {
  const taskId = msg.taskId as string;
  const provider = msg.provider as ProviderName;
  console.log('[MultiAI:background] handleContentMessage', msg.type, 'taskId=', taskId, 'provider=', provider);

  let updatedTask: AskTaskState | undefined;

  switch (msg.type) {
    case 'PROVIDER_STATUS':
      updatedTask = updateProviderStatus(taskId, provider, msg.status as ProviderStatus, msg.detail as string | undefined);
      break;
    case 'STREAM_UPDATE':
      updatedTask = updateProviderContent(taskId, provider, msg.content as string);
      break;
    case 'TASK_DONE':
      updatedTask = finishProviderTask(taskId, provider, msg.finalContent as string);
      break;
    case 'TASK_ERROR':
      updatedTask = failProviderTask(taskId, provider, msg.errorMessage as string);
      break;
    case 'EMBED_URL': {
      const url = msg.url as string | undefined;
      if (url) {
        updatedTask = updateProviderUrl(taskId, provider, url);
      }
      break;
    }
  }

  if (updatedTask) {
    broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: updatedTask });
    persistStream(taskId, updatedTask, providersAllDone(updatedTask));
    if (providersAllDone(updatedTask)) {
      // 工作台任务（wb_ 前缀）是独立运行管线：只做状态收集，不写侧边栏的多轮会话/历史，
      // 否则每次运行工作流都会在「会话列表」和「历史」里堆一批无关记录。
      if (!taskId.startsWith('wb_')) {
        saveToHistory(updatedTask).catch(console.error);
        // 沉淀进多轮会话（§2 双态分离）：一轮全部 settle → 写进 Turn
        sedimentTask(taskId, updatedTask);
      }
    }
  }
}

export async function handleAskAll(
  taskId: string,
  prompt: string,
  targets: ProviderName[],
  opts?: { convId?: string; forceNew?: boolean; nodeId?: string }
): Promise<void> {
  const convId = opts?.convId;
  const forceNew = !!opts?.forceNew;
  const nodeId = opts?.nodeId;
  // 工作台任务（wb_ 前缀）走独立运行管线：不建多轮会话、不 appendTurn，
  // 避免污染侧边栏会话列表（结果由工作台自己收集展示）。
  const isWorkbench = taskId.startsWith('wb_');
  if (!isWorkbench) {
    let cid = convId ?? getConversationIdForTask(taskId);
    if (!cid) cid = await ensureConversationForTask(taskId);

    const conv = getConversation(cid);
    if (!conv || !conv.turns.find((t) => t.id === taskId)) {
      await appendTurn(cid, { id: taskId, prompt, targets });
    }
  }

  let task = getTask(taskId);
  if (!task) {
    task = createTask(taskId, prompt, targets);
  }

  broadcastTaskState({ type: 'TASK_STATE_UPDATE', task });

  const dispatches = targets.map((provider) => dispatchToProvider(taskId, provider, prompt, { forceNew, nodeId }));
  await Promise.allSettled(dispatches);
}

export async function retryProvider(taskId: string, provider: ProviderName): Promise<void> {
  const task = getTask(taskId);
  if (!task) return;
  updateProviderStatus(taskId, provider, 'waiting');
  broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: getTask(taskId)! });
  await dispatchToProvider(taskId, provider, task.prompt);
}

async function dispatchToProvider(
  taskId: string,
  provider: ProviderName,
  prompt: string,
  opts?: { forceNew?: boolean; nodeId?: string }
): Promise<void> {
  console.log('[MultiAI:background] dispatchToProvider', provider, { nodeId: opts?.nodeId ?? null, forceNew: !!opts?.forceNew });
  try {
    updateProviderStatus(taskId, provider, 'waiting');
    broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: getTask(taskId)! });

    // nodeId 存在时复用 / 新建该节点的专属标签页；否则走侧边栏的常规复用逻辑
    const tabId = await getOrCreateProviderTab(provider, { forceNew: opts?.forceNew, nodeId: opts?.nodeId });
    console.log('[MultiAI:background] Got tab', tabId, 'for', provider);
    setProviderTabId(taskId, provider, tabId);

    updateProviderStatus(taskId, provider, 'sending');
    broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: getTask(taskId)! });

    console.log('[MultiAI:background] Sending EXECUTE_PROMPT to tab', tabId);
    await chrome.tabs.sendMessage(tabId, {
      type: 'EXECUTE_PROMPT',
      taskId,
      provider,
      prompt,
    });

    console.log('[MultiAI:background] EXECUTE_PROMPT sent to', provider);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[MultiAI:background] dispatchToProvider failed for', provider, ':', message);
    failProviderTask(taskId, provider, message);
    broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: getTask(taskId)! });
  }
}

export async function triggerExport(msg: ExportMarkdownMessage): Promise<{ type: 'EXPORT_RESULT'; ok: boolean; sink?: string; bytes?: number; error?: string }> {
  const conv = getConversation(msg.conversationId);
  if (!conv) return { type: 'EXPORT_RESULT', ok: false, error: '会话不存在' };
  const md = buildMarkdown(conv, { layout: msg.layout, providers: msg.providers });
  const fname = fileNameFor(conv);
  const bytes = new TextEncoder().encode(md).length;

  let clipOk = true;
  let dlOk = true;
  let error: string | undefined;

  if (msg.sink === 'clipboard' || msg.sink === 'both') {
    try {
      await navigator.clipboard.writeText(md);
    } catch (e) {
      clipOk = false;
      error = '剪贴板写入失败：' + (e instanceof Error ? e.message : String(e));
    }
  }
  if (msg.sink === 'download' || msg.sink === 'both') {
    try {
      const url = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(md);
      await chrome.downloads.download({ url, filename: fname, saveAs: true });
    } catch (e) {
      dlOk = false;
      error = (error ? error + '；' : '') + '下载失败：' + (e instanceof Error ? e.message : String(e));
    }
  }

  const ok = (msg.sink === 'clipboard' ? clipOk : true) && (msg.sink === 'download' ? dlOk : true);
  return { type: 'EXPORT_RESULT', ok, sink: msg.sink, bytes, error };
}
