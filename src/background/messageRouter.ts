import type { UIMessage, AskTaskState, ProviderName, ProviderStatus } from '../shared/types';
import {
  sendToContent,
  broadcastTaskState,
} from '../shared/messaging';
import { createTask, getTask, updateProviderStatus, updateProviderContent, finishProviderTask, failProviderTask, setProviderTabId, loadLastTask } from './stateStore';
import { getOrCreateProviderTab } from './tabManager';

let ready = false;
const pendingMessages: Array<{ msg: Record<string, unknown>; sender: chrome.runtime.MessageSender; sendResponse: (r?: unknown) => void }> = [];

console.log('[MultiAI:background] Service worker starting...');

// ── Register listeners SYNCHRONOUSLY at top level ──────
// This is REQUIRED for MV3. If registered inside an async function,
// Chrome won't recognize the listener and sendMessage will fail.

chrome.runtime.onMessage.addListener((rawMsg, sender, sendResponse) => {
  const msg = rawMsg as Record<string, unknown>;
  // Route UI messages (from side panel / popup)
  if (msg.type === 'ASK_ALL' || msg.type === 'GET_TASK_STATE' || msg.type === 'RETRY_PROVIDER') {
    if (!ready) {
      console.log('[MultiAI:background] Queuing message, not ready yet:', msg.type);
      pendingMessages.push({ msg: msg as Record<string, unknown>, sender, sendResponse });
      return true; // keep channel open
    }
    handleUIMessage(msg as UIMessage, sender).then(() => sendResponse());
    return true; // async response
  }

  // Route content script messages
  if (
    rawMsg.type === 'PROVIDER_STATUS' ||
    rawMsg.type === 'STREAM_UPDATE' ||
    rawMsg.type === 'TASK_DONE' ||
    rawMsg.type === 'TASK_ERROR'
  ) {
    if (!ready) {
      pendingMessages.push({ msg: rawMsg as Record<string, unknown>, sender, sendResponse });
      return true;
    }
    handleContentMessage(rawMsg as Record<string, unknown>);
    return false; // sync, no response needed
  }

  return false;
});

// ── Async initialization ───────────────────────────────

async function doInit(): Promise<void> {
  console.log('[MultiAI:background] Initializing...');

  await loadLastTask();

  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Side panel may not be available in all contexts
  });

  ready = true;
  console.log('[MultiAI:background] Ready, processing', pendingMessages.length, 'pending messages');

  // Process any queued messages
  for (const { msg, sender, sendResponse } of pendingMessages) {
    if (msg.type === 'ASK_ALL' || msg.type === 'GET_TASK_STATE' || msg.type === 'RETRY_PROVIDER') {
      await handleUIMessage(msg as UIMessage, sender);
      sendResponse();
    } else {
      handleContentMessage(msg as Record<string, unknown>);
    }
  }
  pendingMessages.length = 0;
}

doInit().catch(console.error);

// ── Handlers ────────────────────────────────────────────

async function handleUIMessage(
  msg: UIMessage,
  _sender: chrome.runtime.MessageSender
): Promise<void> {
  console.log('[MultiAI:background] handleUIMessage', msg.type);
  switch (msg.type) {
    case 'ASK_ALL': {
      console.log('[MultiAI:background] ASK_ALL taskId=', msg.taskId, 'targets=', msg.targets);
      await handleAskAll(msg.taskId, msg.prompt, msg.targets);
      break;
    }
    case 'GET_TASK_STATE': {
      const task = getTask(msg.taskId);
      if (task) {
        broadcastTaskState({ type: 'TASK_STATE_UPDATE', task });
      }
      break;
    }
    case 'RETRY_PROVIDER': {
      const task = getTask(msg.taskId);
      if (task) {
        updateProviderStatus(msg.taskId, msg.provider, 'waiting');
        broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: getTask(msg.taskId)! });
        await dispatchToProvider(msg.taskId, msg.provider, task.prompt);
      }
      break;
    }
  }
}

function handleContentMessage(
  msg: Record<string, unknown>
): void {
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
  }

  if (updatedTask) {
    broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: updatedTask });
  }
}

async function handleAskAll(
  taskId: string,
  prompt: string,
  targets: ProviderName[]
): Promise<void> {
  let task = getTask(taskId);
  if (!task) {
    task = createTask(taskId, prompt, targets);
  }

  broadcastTaskState({ type: 'TASK_STATE_UPDATE', task });

  const dispatches = targets.map((provider) => dispatchToProvider(taskId, provider, prompt));
  await Promise.allSettled(dispatches);
}

async function dispatchToProvider(
  taskId: string,
  provider: ProviderName,
  prompt: string
): Promise<void> {
  console.log('[MultiAI:background] dispatchToProvider', provider);
  try {
    updateProviderStatus(taskId, provider, 'waiting');
    broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: getTask(taskId)! });

    const tabId = await getOrCreateProviderTab(provider);
    console.log('[MultiAI:background] Got tab', tabId, 'for', provider);
    setProviderTabId(taskId, provider, tabId);

    updateProviderStatus(taskId, provider, 'sending');
    broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: getTask(taskId)! });

    console.log('[MultiAI:background] Sending EXECUTE_PROMPT to tab', tabId);
    await sendToContent(tabId, {
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
