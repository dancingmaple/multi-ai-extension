import { onBackgroundMessage } from '../shared/messaging';
import type { ExecutePromptMessage, ProviderName } from '../shared/types';
import { executePrompt } from './executor';
import { getProviderFromUrl } from '../shared/providers';
import { EMBED_MSG } from '../shared/constants';

const currentProvider: ProviderName | null = getProviderFromUrl(location.href);

console.log('[MultiAI:content] Content script loaded on', location.hostname, 'provider=', currentProvider);

// 记录当前任务 id，用于把网页地址变化回传给 background（网页视图定位原网页）
let currentEmbedTaskId: string | undefined;

function reportUrl(): void {
  if (!currentEmbedTaskId || !currentProvider) return;
  const url = location.href;
  if (!url || url.startsWith('about:')) return;
  try {
    chrome.runtime.sendMessage({ type: 'EMBED_URL', taskId: currentEmbedTaskId, provider: currentProvider, url });
  } catch {
    /* 扩展可能正被重载 */
  }
}

// 监听 SPA 路由变化（地址栏 URL 改变）
(() => {
  const patch = (m: 'pushState' | 'replaceState') => {
    const orig = history[m];
    const wrapper = function (this: History, ...args: unknown[]) {
      const r = (orig as (...a: unknown[]) => unknown).apply(this, args);
      reportUrl();
      return r;
    };
    (history as unknown as Record<string, unknown>)[m] = wrapper;
  };
  patch('pushState');
  patch('replaceState');
  window.addEventListener('popstate', reportUrl);
  window.addEventListener('hashchange', reportUrl);
  window.addEventListener('load', reportUrl);
  // 初次也报一次
  reportUrl();
})();

function runExecute(msg: ExecutePromptMessage): void {
  const execMsg = msg;
  currentEmbedTaskId = execMsg.taskId;
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

onBackgroundMessage((msg, _sender) => {
  if (msg.type === 'EXECUTE_PROMPT') {
    console.log('[MultiAI:content] Received EXECUTE_PROMPT for', msg.provider);
    runExecute(msg as ExecutePromptMessage);
  }

  // PING: respond directly by returning a value
  if (msg.type === 'PING') {
    console.log('[MultiAI:content] PING received, responding PONG');
    return { type: 'PONG' };
  }
});

// ── 嵌入视图：插件父页面（Fullscreen / 侧边栏的网页视图）通过 window.postMessage
// 把任务下发给 iframe 内的 content script。跨域 postMessage 不受同源策略限制。 ──
if (currentProvider) {
  window.addEventListener('message', (ev: MessageEvent) => {
    const data = ev.data as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') return;

    if (data.__multiAi === EMBED_MSG.PING) {
      const reply = { __multiAi: EMBED_MSG.PONG, provider: currentProvider };
      if (ev.source && (ev.source as Window).postMessage) {
        (ev.source as Window).postMessage(reply, '*');
      } else {
        (window.parent || window).postMessage(reply, '*');
      }
      return;
    }

    if (data.__multiAi === EMBED_MSG.EXECUTE) {
      const provider = data.provider as ProviderName | undefined;
      const prompt = data.prompt as string | undefined;
      const taskId = data.taskId as string | undefined;
      if (provider === currentProvider && prompt && taskId) {
        console.log('[MultiAI:content] postMessage EXECUTE for', provider);
        runExecute({ type: 'EXECUTE_PROMPT', taskId, provider, prompt });
      }
    }
  });
}
