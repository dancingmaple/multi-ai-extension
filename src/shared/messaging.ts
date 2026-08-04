import type {
  UIMessage,
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  BackgroundToUIMessage,
  TaskStateUpdateMessage,
  ConversationUpdateMessage,
} from './types';

const DEBUG = true;
function log(...args: unknown[]): void {
  if (DEBUG) console.log('[MultiAI:shared:messaging]', ...args);
}

export function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sendToBackground(message: UIMessage): Promise<unknown> {
  log('sendToBackground', message.type);
  return chrome.runtime.sendMessage(message);
}

export async function sendToContent(
  tabId: number,
  message: BackgroundToContentMessage
): Promise<void> {
  log('sendToContent tab=', tabId, message.type);
  await chrome.tabs.sendMessage(tabId, message);
}

export function sendToUI(message: BackgroundToUIMessage): void {
  log('sendToUI', message.type);
  chrome.runtime.sendMessage(message).catch(() => {
    // UI may not be open; that's fine
  });
}

// ── 广播钩子：让 externalBridge 把状态转发给外部网页（工作台） ──
type BroadcastHook = (msg: TaskStateUpdateMessage) => void;
const broadcastHooks: BroadcastHook[] = [];
export function onBroadcast(hook: BroadcastHook): () => void {
  broadcastHooks.push(hook);
  return () => {
    const i = broadcastHooks.indexOf(hook);
    if (i >= 0) broadcastHooks.splice(i, 1);
  };
}

export function broadcastTaskState(message: TaskStateUpdateMessage): void {
  log('broadcastTaskState taskId=', message.task.taskId);
  chrome.runtime.sendMessage(message).catch(() => {});
  for (const hook of broadcastHooks) {
    try { hook(message); } catch { /* 外部端口已断开 */ }
  }
}

// ── 会话广播钩子：让 externalBridge 把 CONVERSATION_UPDATE 转发给外部网页 ──
type ConversationHook = (msg: ConversationUpdateMessage) => void;
const conversationHooks: ConversationHook[] = [];
export function onConversationBroadcast(hook: ConversationHook): () => void {
  conversationHooks.push(hook);
  return () => {
    const i = conversationHooks.indexOf(hook);
    if (i >= 0) conversationHooks.splice(i, 1);
  };
}

export function broadcastConversation(message: ConversationUpdateMessage): void {
  log('broadcastConversation id=', message.conversation?.id);
  chrome.runtime.sendMessage(message).catch(() => {});
  for (const hook of conversationHooks) {
    try { hook(message); } catch { /* 外部端口已断开 */ }
  }
}

export function onUIMessage(
  handler: (msg: UIMessage, sender: chrome.runtime.MessageSender) => void
): () => void {
  const listener = (msg: UIMessage, sender: chrome.runtime.MessageSender) => {
    log('onUIMessage received', msg.type);
    if (msg.type === 'ASK_ALL' || msg.type === 'GET_TASK_STATE' || msg.type === 'RETRY_PROVIDER') {
      handler(msg, sender);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

export function onBackgroundMessage(
  handler: (msg: BackgroundToContentMessage, sender: chrome.runtime.MessageSender) => unknown
): () => void {
  const listener = (
    msg: BackgroundToContentMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    log('onBackgroundMessage received', msg.type, 'from tab', sender.tab?.id);
    if (msg.type === 'PING') {
      const result = handler(msg, sender);
      if (result !== undefined && typeof result !== 'boolean') {
        sendResponse(result);
      }
      return false;
    }
    if (msg.type === 'EXECUTE_PROMPT') {
      handler(msg, sender);
      sendResponse({ type: 'ACK' });
      return false;
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

export function onContentMessage(
  handler: (msg: ContentToBackgroundMessage, sender: chrome.runtime.MessageSender) => void
): () => void {
  const listener = (
    msg: ContentToBackgroundMessage,
    sender: chrome.runtime.MessageSender
  ) => {
    log('onContentMessage received', msg.type);
    if (
      msg.type === 'PROVIDER_STATUS' ||
      msg.type === 'STREAM_UPDATE' ||
      msg.type === 'TASK_DONE' ||
      msg.type === 'TASK_ERROR'
    ) {
      handler(msg, sender);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}