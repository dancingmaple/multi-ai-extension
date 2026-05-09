import type {
  UIMessage,
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  BackgroundToUIMessage,
  TaskStateUpdateMessage,
} from './types';

const DEBUG = true;
function log(...args: unknown[]): void {
  if (DEBUG) console.log('[MultiAI:shared:messaging]', ...args);
}

export function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sendToBackground(message: UIMessage): Promise<BackgroundToUIMessage> {
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

export function broadcastTaskState(message: TaskStateUpdateMessage): void {
  log('broadcastTaskState taskId=', message.task.taskId);
  chrome.runtime.sendMessage(message).catch(() => {});
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
    if (msg.type === 'EXECUTE_PROMPT' || msg.type === 'PING') {
      const result = handler(msg, sender);
      if (result !== undefined && typeof result !== 'boolean') {
        sendResponse(result);
      }
    }
    // Return true to keep the message channel open for async sendResponse
    return true;
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
