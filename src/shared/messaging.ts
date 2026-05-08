import type {
  UIMessage,
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  BackgroundToUIMessage,
  TaskStateUpdateMessage,
} from './types';

export function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sendToBackground(message: UIMessage): Promise<BackgroundToUIMessage> {
  return chrome.runtime.sendMessage(message);
}

export async function sendToContent(
  tabId: number,
  message: BackgroundToContentMessage
): Promise<void> {
  await chrome.tabs.sendMessage(tabId, message);
}

export function sendToUI(message: BackgroundToUIMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // UI may not be open; that's fine
  });
}

export function broadcastTaskState(message: TaskStateUpdateMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}

export function onUIMessage(
  handler: (msg: UIMessage, sender: chrome.runtime.MessageSender) => void
): () => void {
  const listener = (msg: UIMessage, sender: chrome.runtime.MessageSender) => {
    if (msg.type === 'ASK_ALL' || msg.type === 'GET_TASK_STATE' || msg.type === 'RETRY_PROVIDER') {
      handler(msg, sender);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

export function onBackgroundMessage(
  handler: (msg: BackgroundToContentMessage, sender: chrome.runtime.MessageSender) => void
): () => void {
  const listener = (msg: BackgroundToContentMessage, sender: chrome.runtime.MessageSender) => {
    if (msg.type === 'EXECUTE_PROMPT' || msg.type === 'PING') {
      handler(msg, sender);
    }
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
