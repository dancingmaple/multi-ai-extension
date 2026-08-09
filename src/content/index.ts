import { onBackgroundMessage } from '../shared/messaging';
import type { ExecutePromptMessage, ProviderName, ElementRole } from '../shared/types';
import { executePrompt } from './executor';
import { getProviderFromUrl } from '../shared/providers';
import { EMBED_MSG } from '../shared/constants';
import { grabLocal } from './grabLocal';
import { startPick } from './pickElement';
import { runDiagnose } from './diagnose';

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
  const provider = currentProvider;

  const replyTo = (target: Window | null, payload: Record<string, unknown>) => {
    try {
      (target ?? window.parent ?? window).postMessage(payload, '*');
    } catch {
      /* 父页面可能已关闭 */
    }
  };

  window.addEventListener('message', (ev: MessageEvent) => {
    const data = ev.data as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') return;

    if (data.__multiAi === EMBED_MSG.PING) {
      replyTo(ev.source as Window | null, { __multiAi: EMBED_MSG.PONG, provider });
      return;
    }

    if (data.__multiAi === EMBED_MSG.EXECUTE) {
      const p = data.provider as ProviderName | undefined;
      const prompt = data.prompt as string | undefined;
      const taskId = data.taskId as string | undefined;
      if (p === provider && prompt && taskId) {
        console.log('[MultiAI:content] postMessage EXECUTE for', p);
        runExecute({ type: 'EXECUTE_PROMPT', taskId, provider: p, prompt });
      }
      return;
    }

    // 嵌入视图的手动获取：就地读屏，把结果（或失败原因）回传父页面
    if (data.__multiAi === EMBED_MSG.GRAB) {
      const p = data.provider as ProviderName | undefined;
      if (p !== provider) return;
      const prompt = (data.prompt as string | undefined) ?? '';
      const reqId = data.reqId as string | undefined;
      let out: { text: string; method: string; reason?: string };
      try {
        out = grabLocal(provider, prompt);
      } catch (e) {
        out = { text: '', method: 'none', reason: '读屏异常：' + (e instanceof Error ? e.message : String(e)) };
      }
      replyTo(ev.source as Window | null, {
        __multiAi: EMBED_MSG.GRAB_RESULT,
        provider,
        reqId,
        text: out.text,
        method: out.method,
        reason: out.reason,
        url: location.href,
      });
      return;
    }

    // 手动选取元素：父页面请求在 iframe 内点选输入框 / 发送按钮 / 回答区域
    if (data.__multiAi === EMBED_MSG.PICK_START) {
      const p = data.provider as ProviderName | undefined;
      const role = data.role as ElementRole | undefined;
      if (p !== provider || !role) return;
      console.log('[MultiAI:content] PICK_START role=', role);
      const src = ev.source as Window | null;
      startPick(
        role,
        (r, selector) => {
          console.log('[MultiAI:content] PICK_RESULT', r, selector);
          replyTo(src, { __multiAi: EMBED_MSG.PICK_RESULT, role: r, selector });
        },
        () => {
          // 取消（Esc）：回传空选择器，父页面知道取消
          replyTo(src, { __multiAi: EMBED_MSG.PICK_RESULT, role, selector: '' });
        }
      );
      return;
    }

    // 页面诊断：父页面请求扫描整页元素，回传结构化信息
    if (data.__multiAi === EMBED_MSG.DIAGNOSE) {
      const p = data.provider as ProviderName | undefined;
      if (p !== provider) return;
      console.log('[MultiAI:content] DIAGNOSE requested for', p);
      const result = runDiagnose(p);
      replyTo(ev.source as Window | null, {
        __multiAi: EMBED_MSG.DIAGNOSE_RESULT,
        provider: p,
        result,
        url: location.href,
      });
      return;
    }
  });

  // 主动向父页面广播「我已就绪」：避免父页面 PING 早于 content script 注入的竞态
  // （这正是「第一次发送没反应、第二次才正常」的根因之一）。
  if (window.parent && window.parent !== window) {
    const announce = () => replyTo(window.parent, { __multiAi: EMBED_MSG.READY, provider });
    announce();
    [200, 600, 1500, 3000, 6000].forEach((t) => setTimeout(announce, t));
    window.addEventListener('load', announce);
  }
}
