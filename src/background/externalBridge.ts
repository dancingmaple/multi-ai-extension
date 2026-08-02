import type { ProviderName, TaskStateUpdateMessage } from '../shared/types';
import { onBroadcast, broadcastTaskState } from '../shared/messaging';
import { handleAskAll, retryProvider } from './messageRouter';
import { getTask, createTask, setProviderTabId, finishProviderTask, failProviderTask } from './stateStore';

console.log('[MultiAI:externalBridge] build=manual-grab-v1 2026-08-02');

const ALL_PROVIDERS: ProviderName[] = ['chatgpt', 'gemini', 'deepseek', 'qwen', 'zai', 'doubao'];
const PORT_NAME = 'nianlun-studio';
const KEEPALIVE_ALARM = 'studio-keepalive';

/* provider → tabs.query 用的 match pattern（与 manifest host_permissions 对齐） */
const DOMAIN_PATTERN: Record<string, string> = {
  chatgpt: '*://chatgpt.com/*',
  gemini: '*://gemini.google.com/*',
  deepseek: '*://*.deepseek.com/*',
  qwen: '*://chat.qwen.ai/*',
  zai: '*://chat.z.ai/*',
  doubao: '*://www.doubao.com/*',
};

const externalPorts = new Set<chrome.runtime.Port>();

function forwardToExternal(msg: TaskStateUpdateMessage): void {
  for (const port of externalPorts) {
    try { port.postMessage(msg); } catch { externalPorts.delete(port); }
  }
}
onBroadcast(forwardToExternal);

/* ---------- 保活心跳 ---------- */
let keepaliveOn = false;
function ensureKeepalive(): void {
  if (keepaliveOn) return;
  keepaliveOn = true;
  chrome.alarms.create(KEEPALIVE_ALARM, { delayInMinutes: 0.4, periodInMinutes: 0.4 });
}
function stopKeepalive(): void {
  if (!keepaliveOn) return;
  keepaliveOn = false;
  chrome.alarms.clear(KEEPALIVE_ALARM).catch(() => {});
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== KEEPALIVE_ALARM) return;
  if (externalPorts.size === 0) { stopKeepalive(); return; }
  chrome.storage.local.get('_ka').catch(() => {});
  for (const port of externalPorts) {
    try { port.postMessage({ type: 'KA' }); } catch { externalPorts.delete(port); }
  }
  if (externalPorts.size === 0) stopKeepalive();
});

/* ---------- 手动抓取：executeScript 旁路注入（不碰 adapter） ----------
   注入函数必须自包含：读整页文字 → 用提问当剪刀剪出回答 →
   剪不到就兜底取页面后半段 → 裁掉头尾元信息。宁可抓糙，绝不抓空。 */
function grabInPage(args: { prompt: string }): { text: string; method: string } {
  const HEAD = /^(思考了|已思考|思考中|Thought for|Thinking|Reasoned|Reasoning|搜索了|联网搜索|Searching|Searched|Found\s+\d+|阅读了|Read\s+\d+|查看了|引用了|\d+\s*个\s*(网页|来源|结果|web\s*pages?)|DeepThink|Instant|深度思考|联网搜索中|搜索中|生成中)/i;
  const TAIL = /^(复制|点赞|点踩|重新生成|再生成|分享|引用|参考来源|参考|来源|DeepThink|联网搜索|Instant|搜索|给\s*豆包|发消息|发送|Message|⎘|👍|👎|◎|↻)/i;
  const clean = (s: string) => s.replace(/\u00a0/g, ' ');
  const root = (document.querySelector('main') || document.body) as HTMLElement;
  const raw = clean(root.innerText || document.body.innerText || '');
  const lines = raw.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);

  const trim = (arr: string[]) => {
    while (arr.length && HEAD.test(arr[0])) arr.shift();
    while (arr.length && TAIL.test(arr[arr.length - 1])) arr.pop();
    return arr;
  };

  // 1) 剪刀法：定位提问行，取其后
  const key = (args.prompt || '').replace(/\s/g, '').slice(0, 12);
  let q = -1;
  if (key) for (let i = lines.length - 1; i >= 0; i--) { if (lines[i].replace(/\s/g, '').includes(key)) { q = i; break; } }
  if (q >= 0 && q < lines.length - 1) {
    const body = trim(lines.slice(q + 1)).join('\n').trim();
    if (body.length > 8) return { text: body, method: 'scissor' };
  }
  // 2) 兜底：取页面后半段（回答通常在下方）
  const half = trim(lines.slice(Math.floor(lines.length / 2))).join('\n').trim();
  if (half.length > 8) return { text: half, method: 'tail-fallback' };
  return { text: '', method: 'none' };
}

async function manualGrab(taskId: string, provider: ProviderName, prompt: string, port: chrome.runtime.Port): Promise<void> {
  const post = (m: Record<string, unknown>) => { try { port.postMessage(m); } catch { /* disconnected */ } };

  // 找 tabId：先查 task 里存的，再按域名 query
  let tabId = getTask(taskId)?.providers?.[provider]?.tabId;
  if (!tabId) {
    const pat = DOMAIN_PATTERN[provider];
    if (pat) {
      const tabs = await chrome.tabs.query({ url: pat });
      tabId = tabs[0]?.id;
    }
  }
  if (!tabId) { post({ type: 'GRAB_RESULT', provider, ok: false, error: '找不到该站点的标签页，请先在浏览器里打开它' }); return; }

  try {
    const res = await chrome.scripting.executeScript({ target: { tabId }, func: grabInPage, args: [{ prompt }] });
    const got = res?.[0]?.result || { text: '', method: 'none' };
    const text = (got.text || '').trim();

    // 写进内存 task，让卡片变 done + 有内容（合并按钮才能用到）
    let task = getTask(taskId);
    if (!task) task = createTask(taskId, prompt, [provider]);
    setProviderTabId(taskId, provider, tabId);
    if (text) finishProviderTask(taskId, provider, text);
    else failProviderTask(taskId, provider, '手动抓取未读到回答文本');
    const t2 = getTask(taskId);
    if (t2) broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: t2 }); // 经钩子推给工作台

    post({ type: 'GRAB_RESULT', provider, ok: !!text, method: got.method, error: text ? '' : '页面当前没有可读取的回答文本' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    post({ type: 'GRAB_RESULT', provider, ok: false, error: msg });
  }
}

/* ---------- 断线恢复 ---------- */
async function resumeTask(taskId: string, port: chrome.runtime.Port): Promise<void> {
  const mem = getTask(taskId);
  if (mem) { try { port.postMessage({ type: 'TASK_STATE_UPDATE', task: mem }); } catch {} return; }
  const r = await chrome.storage.local.get(['studio_laststream', 'conversation_history']).catch(() => ({} as Record<string, unknown>));
  const ls = ((r as Record<string, any>).studio_laststream || {})[taskId] as
    | { prompt: string; providers: Record<string, { content: string; status: string }>; updatedAt: number } | undefined;
  if (ls) {
    const providers: Record<string, { provider: string; status: string; content: string }> = {};
    for (const [p, v] of Object.entries(ls.providers)) providers[p] = { provider: p, status: v.status, content: v.content };
    try { port.postMessage({ type: 'TASK_STATE_UPDATE', task: { taskId, prompt: ls.prompt, createdAt: ls.updatedAt, providers } }); } catch {}
    return;
  }
  const hist = (((r as Record<string, any>).conversation_history || []) as Array<{ id: string; prompt: string; createdAt: number; providers: Record<string, { status: string; content: string }> }>).find((h) => h.id === taskId);
  if (hist) {
    const providers: Record<string, { provider: string; status: string; content: string }> = {};
    for (const [p, v] of Object.entries(hist.providers)) providers[p] = { provider: p, status: v.status, content: v.content };
    try { port.postMessage({ type: 'TASK_STATE_UPDATE', task: { taskId, prompt: hist.prompt, createdAt: hist.createdAt, providers } }); } catch {}
  }
}

/* ---------- 外部探测 ---------- */
chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
  if (msg && (msg as Record<string, unknown>).type === 'EXT_PING') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version, providers: ALL_PROVIDERS });
  }
  return true;
});

/* ---------- 外部长连接 ---------- */
chrome.runtime.onConnectExternal.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  externalPorts.add(port);
  if (externalPorts.size === 1) ensureKeepalive();

  port.onDisconnect.addListener(() => {
    externalPorts.delete(port);
    if (externalPorts.size === 0) stopKeepalive();
  });

  port.onMessage.addListener((raw: Record<string, unknown>) => {
    if (raw.type === 'ASK_ALL') {
      const taskId = raw.taskId as string, prompt = raw.prompt as string, targets = raw.targets as ProviderName[];
      handleAskAll(taskId, prompt, targets).catch((err) => {
        const message = err instanceof Error ? err.message : 'Unknown error';
        try { port.postMessage({ type: 'TASK_ERROR', taskId, provider: targets[0], errorCode: 'ASK_FAILED', errorMessage: message }); } catch {}
      });
    } else if (raw.type === 'RETRY_PROVIDER') {
      retryProvider(raw.taskId as string, raw.provider as ProviderName).catch(() => {});
    } else if (raw.type === 'RESUME') {
      resumeTask(raw.taskId as string, port).catch(() => {});
    } else if (raw.type === 'MANUAL_GRAB') {
      // 旁路手动抓取：prompt 由工作台闭包自带
      manualGrab(raw.taskId as string, raw.provider as ProviderName, raw.prompt as string, port).catch(() => {});
    }
  });
});