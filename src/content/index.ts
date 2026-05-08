import { onBackgroundMessage } from '../shared/messaging';
import type { ExecutePromptMessage } from '../shared/types';
import { executePrompt } from './executor';

onBackgroundMessage((msg, _sender) => {
  if (msg.type === 'EXECUTE_PROMPT') {
    const execMsg = msg as ExecutePromptMessage;
    const sendStatus = (status: string, detail?: string) => {
      chrome.runtime.sendMessage({
        type: 'PROVIDER_STATUS',
        taskId: execMsg.taskId,
        provider: execMsg.provider,
        status,
        detail,
      });
    };

    const sendStream = (content: string) => {
      chrome.runtime.sendMessage({
        type: 'STREAM_UPDATE',
        taskId: execMsg.taskId,
        provider: execMsg.provider,
        content,
        isPartial: true,
      });
    };

    const sendDone = (finalContent: string) => {
      chrome.runtime.sendMessage({
        type: 'TASK_DONE',
        taskId: execMsg.taskId,
        provider: execMsg.provider,
        finalContent,
      });
    };

    const sendError = (errorCode: string, errorMessage: string) => {
      chrome.runtime.sendMessage({
        type: 'TASK_ERROR',
        taskId: execMsg.taskId,
        provider: execMsg.provider,
        errorCode,
        errorMessage,
      });
    };

    executePrompt(execMsg, sendStatus, sendStream, sendDone, sendError);
  }

  if (msg.type === 'PING') {
    chrome.runtime.sendMessage({ type: 'PONG' });
  }
});
