import type { UIMessage, AskTaskState, ProviderName, ProviderStatus } from '../shared/types';
import {
  onUIMessage,
  onContentMessage,
  sendToContent,
  broadcastTaskState,
} from '../shared/messaging';
import { createTask, getTask, updateProviderStatus, updateProviderContent, finishProviderTask, failProviderTask, setProviderTabId, loadLastTask } from './stateStore';
import { getOrCreateProviderTab } from './tabManager';

let initialized = false;

export async function initMessageRouter(): Promise<void> {
  if (initialized) return;
  initialized = true;

  await loadLastTask();

  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

  onUIMessage(handleUIMessage);
  onContentMessage(handleContentMessage);
}

async function handleUIMessage(
  msg: UIMessage,
  _sender: chrome.runtime.MessageSender
): Promise<void> {
  switch (msg.type) {
    case 'ASK_ALL': {
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
  msg: {
    type: string;
    taskId: string;
    provider: ProviderName;
    status?: ProviderStatus;
    detail?: string;
    content?: string;
    finalContent?: string;
    errorCode?: string;
    errorMessage?: string;
  },
  _sender: chrome.runtime.MessageSender
): void {
  let updatedTask: AskTaskState | undefined;

  switch (msg.type) {
    case 'PROVIDER_STATUS':
      updatedTask = updateProviderStatus(msg.taskId, msg.provider, msg.status!, msg.detail);
      break;
    case 'STREAM_UPDATE':
      updatedTask = updateProviderContent(msg.taskId, msg.provider, msg.content!);
      break;
    case 'TASK_DONE':
      updatedTask = finishProviderTask(msg.taskId, msg.provider, msg.finalContent!);
      break;
    case 'TASK_ERROR':
      updatedTask = failProviderTask(msg.taskId, msg.provider, msg.errorMessage!);
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
  try {
    updateProviderStatus(taskId, provider, 'waiting');
    broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: getTask(taskId)! });

    const tabId = await getOrCreateProviderTab(provider);
    setProviderTabId(taskId, provider, tabId);

    updateProviderStatus(taskId, provider, 'sending');
    broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: getTask(taskId)! });

    await sendToContent(tabId, {
      type: 'EXECUTE_PROMPT',
      taskId,
      provider,
      prompt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    failProviderTask(taskId, provider, message);
    broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: getTask(taskId)! });
  }
}
