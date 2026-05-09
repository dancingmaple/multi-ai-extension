import { onBackgroundMessage } from '../shared/messaging';
import type { ExecutePromptMessage } from '../shared/types';
import { executePrompt } from './executor';

console.log('[MultiAI:content] Content script loaded on', location.hostname);

onBackgroundMessage((msg, _sender) => {
  if (msg.type === 'EXECUTE_PROMPT') {
    console.log('[MultiAI:content] Received EXECUTE_PROMPT for', msg.provider);
    const execMsg = msg as ExecutePromptMessage;
    const sendStatus = (status: string, detail?: string) => {
      console.log('[MultiAI:content] sendStatus', status, detail);
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
      console.log('[MultiAI:content] sendDone, text length:', finalContent.length);
      chrome.runtime.sendMessage({
        type: 'TASK_DONE',
        taskId: execMsg.taskId,
        provider: execMsg.provider,
        finalContent,
      });
    };

    const sendError = (errorCode: string, errorMessage: string) => {
      console.error('[MultiAI:content] sendError', errorCode, errorMessage);
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

  // PING: respond directly by returning a value
  if (msg.type === 'PING') {
    console.log('[MultiAI:content] PING received, responding PONG');
    return { type: 'PONG' };
  }
});
