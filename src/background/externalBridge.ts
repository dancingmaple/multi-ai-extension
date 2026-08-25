import type { ProviderName, TaskStateUpdateMessage, ConversationUpdateMessage, ConversationListMessage } from '../shared/types';
import { onBroadcast, onConversationBroadcast } from '../shared/messaging';
import { handleAskAll, retryProvider, triggerExport } from './messageRouter';
import { getTask } from './stateStore';
import { manualGrab, manualGrabAll } from './manualGrab';
import {
  getConversationIdForTask,
  getConversation,
  getOrCreateConversation,
  listConversations,
  appendTurn,
} from './conversationStore';
import { ALL_PROVIDERS } from '../shared/constants';

console.log('[MultiAI:externalBridge] build=spec-v2 2026-08-02');

const ALL_PROVIDERS_LIST: ProviderName[] = ALL_PROVIDERS;
const PORT_NAME = 'nianlun-studio';
const KEEPALIVE_ALARM = 'studio-keepalive';

const externalPorts = new Set<chrome.runtime.Port>();

/* ---------- 转发给外部网页（工作台） ---------- */
function forwardToExternal(msg: TaskStateUpdateMessage): void {
  for (const port of externalPorts) {
    try {
      port.postMessage(msg);
    } catch {
      externalPorts.delete(port);
    }
  }
}
function forwardToExternalConv(msg: ConversationUpdateMessage): void {
  for (const port of externalPorts) {
    try {
      port.postMessage(msg);
    } catch {
      externalPorts.delete(port);
    }
  }
}
onBroadcast(forwardToExternal);
onConversationBroadcast(forwardToExternalConv);

/* ---------- 保活心跳（§10） ---------- */
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
  if (externalPorts.size === 0) {
    stopKeepalive();
    return;
  }
  for (const port of externalPorts) {
    try {
      port.postMessage({ type: 'KA' });
    } catch {
      externalPorts.delete(port);
    }
  }
  if (externalPorts.size === 0) stopKeepalive();
});

/* ---------- 断线恢复（§10）：内存 → laststream → conversation 三级 ---------- */
async function resumeTask(taskId: string, port: chrome.runtime.Port): Promise<void> {
  const mem = getTask(taskId);
  if (mem) {
    try {
      port.postMessage({ type: 'TASK_STATE_UPDATE', task: mem });
    } catch {
      /* disconnected */
    }
    pushConversationForTask(taskId, port);
    return;
  }
  const r = await chrome.storage.local
    .get(['studio_laststream', 'conversations'])
    .catch(() => ({}) as Record<string, unknown>);
  const lsStore = (r as Record<string, unknown>).studio_laststream as
    | Record<string, { prompt: string; providers: Record<string, { content: string; status: string }>; updatedAt: number }>
    | undefined;
  const ls = lsStore?.[taskId];
  if (ls) {
    const providers: Record<string, { provider: string; status: string; content: string }> = {};
    for (const [p, v] of Object.entries(ls.providers)) providers[p] = { provider: p, status: v.status, content: v.content };
    try {
      port.postMessage({ type: 'TASK_STATE_UPDATE', task: { taskId, prompt: ls.prompt, createdAt: ls.updatedAt, providers } });
    } catch {
      /* disconnected */
    }
    pushConversationForTask(taskId, port);
    return;
  }
  const convs = (((r as Record<string, unknown>).conversations || {}) as Record<string, { id: string; turns: Array<{ id: string }> }>);
  for (const c of Object.values(convs)) {
    if (c.turns?.some((t) => t.id === taskId)) {
      try {
        port.postMessage(getConversation(c.id) ? { type: 'CONVERSATION_UPDATE', conversation: getConversation(c.id) } : { type: 'CONVERSATION_UPDATE', conversation: null });
      } catch {
        /* disconnected */
      }
      return;
    }
  }
}

function pushConversationForTask(taskId: string, port: chrome.runtime.Port): void {
  const cid = getConversationIdForTask(taskId);
  if (!cid) return;
  const conv = getConversation(cid);
  if (conv) {
    try {
      port.postMessage({ type: 'CONVERSATION_UPDATE', conversation: conv });
    } catch {
      /* disconnected */
    }
  }
}

/* ---------- 外部探测 ---------- */
chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
  if (msg && (msg as Record<string, unknown>).type === 'EXT_PING') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version, providers: ALL_PROVIDERS_LIST });
  }
  return true;
});

/* ---------- 外部长连接（§3 / §5） ---------- */
chrome.runtime.onConnectExternal.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  externalPorts.add(port);
  if (externalPorts.size === 1) ensureKeepalive();

  port.onDisconnect.addListener(() => {
    externalPorts.delete(port);
    if (externalPorts.size === 0) stopKeepalive();
  });

  port.onMessage.addListener((raw: Record<string, unknown>) => {
    const post = (m: Record<string, unknown>) => {
      try {
        port.postMessage(m);
      } catch {
        /* disconnected */
      }
    };

    switch (raw.type) {
      case 'ASK_ALL': {
        const taskId = raw.taskId as string;
        const prompt = raw.prompt as string;
        const targets = raw.targets as ProviderName[];
        handleAskAll(taskId, prompt, targets).catch((err) => {
          const m = err instanceof Error ? err.message : 'Unknown error';
          post({ type: 'TASK_ERROR', taskId, provider: targets[0], errorCode: 'ASK_FAILED', errorMessage: m });
        });
        break;
      }
      case 'RETRY_PROVIDER':
        retryProvider(raw.taskId as string, raw.provider as ProviderName).catch(() => {});
        break;
      case 'RESUME':
        resumeTask(raw.taskId as string, port).catch(() => {});
        break;
      case 'MANUAL_GRAB': {
        const provider = raw.provider as ProviderName;
        manualGrab(raw.conversationId as string, raw.turnId as string, provider, raw.prompt as string)
          .then((out) => post({ type: 'GRAB_RESULT', ...out }))
          .catch(() => post({ type: 'GRAB_RESULT', provider, ok: false, error: '手动抓取失败' }));
        break;
      }
      case 'MANUAL_GRAB_ALL': {
        const convId = raw.conversationId as string;
        const turnId = raw.turnId as string;
        const prompt = raw.prompt as string;
        const conv = getConversation(convId);
        const turn = conv?.turns.find((t) => t.id === turnId);
        const pending = ALL_PROVIDERS_LIST.filter((p) => {
          const a = turn?.answers[p];
          return !a || a.status !== 'done';
        });
        manualGrabAll(convId, turnId, prompt, pending)
          .then((outs) =>
            post({
              type: 'GRAB_RESULT',
              provider: pending[0] ?? 'chatgpt',
              ok: outs.length > 0 && outs.every((o) => o.ok),
            })
          )
          .catch(() => post({ type: 'GRAB_RESULT', provider: pending[0] ?? 'chatgpt', ok: false, error: '批量手动抓取失败' }));
        break;
      }
      case 'NEW_CONVERSATION': {
        getOrCreateConversation(raw.conversationId as string | undefined, raw.title as string | undefined)
          .then((conv) => post({ type: 'CONVERSATION_UPDATE', conversation: conv }))
          .catch(() => {});
        break;
      }
      case 'APPEND_TURN': {
        const convId = raw.conversationId as string;
        const turnId = raw.turnId as string;
        const prompt = raw.prompt as string;
        const targets = raw.targets as ProviderName[];
        appendTurn(convId, { id: turnId, prompt, targets })
          .then(() => handleAskAll(turnId, prompt, targets, { convId }))
          .catch((err) => {
            const m = err instanceof Error ? err.message : 'Unknown error';
            post({ type: 'TASK_ERROR', taskId: turnId, provider: targets[0], errorCode: 'ASK_FAILED', errorMessage: m });
          });
        break;
      }
      case 'GET_CONVERSATION': {
        const id = raw.conversationId as string | undefined;
        const conv = id ? getConversation(id) : undefined;
        post({ type: 'CONVERSATION_UPDATE', conversation: conv ?? null });
        break;
      }
      case 'LIST_CONVERSATIONS': {
        listConversations()
          .then((list: ConversationListMessage['conversations']) => post({ type: 'CONVERSATION_LIST', conversations: list }))
          .catch(() => post({ type: 'CONVERSATION_LIST', conversations: [] }));
        break;
      }
      case 'EXPORT_MARKDOWN': {
        triggerExport(raw as unknown as Parameters<typeof triggerExport>[0])
          .then((res) => post(res))
          .catch((err) => post({ type: 'EXPORT_RESULT', ok: false, error: err instanceof Error ? err.message : String(err) }));
        break;
      }
    }
  });
});
