import { onBackgroundMessage } from '../shared/messaging';
import type { ExecutePromptMessage, ProviderName, ElementRole } from '../shared/types';
import { executePrompt } from './executor';
import { getProviderFromUrl, resolveProviderFromUrl, getProviderUrlAsync } from '../shared/providers';
import { EMBED_MSG, isCustomProvider } from '../shared/constants';
import { grabLocal } from './grabLocal';
import { startPick } from './pickElement';
import { runDiagnose } from './diagnose';
import { getCustomProvider } from '../shared/customProviders';
import { getCustomForProvider } from '../shared/customSelectors';

/** 测试台里「尚未保存」的自定义网页，用这个占位 id 通信 */
export const DRAFT_PROVIDER = 'custom:draft';

/** 扩展自身 origin（父页面一定是扩展页面），用于校验 postMessage 来源与指定 targetOrigin */
const EXT_ORIGIN = chrome.runtime.getURL('').replace(/\/$/, '');

/**
 * 内嵌执行「新建会话」机制：
 * 工作台/测试台每次在 iframe 里跑一个节点，都应从「全新对话」开始，
 * 而不是沿用上一节点在该 iframe 里留下的会话（否则上下文会串台）。
 * 做法：收到 EXECUTE 时，先把任务参数暂存到 sessionStorage，再把 iframe
 * 导航到 provider 的首页（即新对话），重载后由本脚本的启动钩子从
 * sessionStorage 取出并恢复执行——从而保证每个节点都是独立的新会话。
 */
const PENDING_EXEC_KEY = 'multiAI_pending_exec';

async function beginEmbedExecute(msg: ExecutePromptMessage, replyTarget: Window | null): Promise<void> {
  let url = '';
  try {
    url = await getProviderUrlAsync(msg.provider);
  } catch {
    url = '';
  }
  if (url) {
    try {
      sessionStorage.setItem(PENDING_EXEC_KEY, JSON.stringify(msg));
    } catch {
      /* sessionStorage 不可用时退化为直接执行（可能沿用当前会话） */
    }
    console.log('[MultiAI:content] 新建会话：导航到', url, 'taskId=', msg.taskId);
    location.assign(url);
    return;
  }
  // 取不到新会话地址：退化直接执行（仍沿用当前页）
  runExecute(msg, replyTarget);
}

// 先同步认内置 7 家；随后异步补上用户自定义节点的匹配（自定义节点存在 storage 里）
let currentProvider: ProviderName | null = getProviderFromUrl(location.href);

console.log('[MultiAI:content] Content script loaded on', location.hostname, 'provider=', currentProvider);

resolveProviderFromUrl(location.href)
  .then((p) => {
    if (p && p !== currentProvider) {
      currentProvider = p;
      console.log('[MultiAI:content] provider resolved to custom node:', p);
      if (window.parent && window.parent !== window) {
        replyTo(window.parent, { __multiAi: EMBED_MSG.READY, provider: p });
      }
    }
  })
  .catch(() => {});

/**
 * 是否接受父页面下发的这条指令。
 * - 内置站点：必须 provider 完全一致，避免串台
 * - 自定义节点 / 草稿：父页面（插件自身页面）显式指定即接受，
 *   因为自定义网页刚录入时 storage 里还没有它，无法反查出 provider
 */
function accepts(p?: string | null): boolean {
  if (!p) return false;
  if (currentProvider && p === currentProvider) return true;
  if (isCustomProvider(p)) return true;
  return false;
}

/** 当前帧对外使用的 provider 标识 */
function effectiveProvider(claimed?: string | null): ProviderName {
  return currentProvider ?? claimed ?? DRAFT_PROVIDER;
}

// 记录当前任务 id，用于把网页地址变化回传给 background（网页视图定位原网页）
let currentEmbedTaskId: string | undefined;

// 向父页面（iframe 嵌入视图的宿主）postMessage 回传数据
function replyTo(target: Window | null, payload: Record<string, unknown>): void {
  try {
    // 用扩展自身 origin 作为 targetOrigin（不用 '*'），避免回答泄露给恶意父页面
    (target ?? window.parent ?? window).postMessage(payload, EXT_ORIGIN);
  } catch {
    /* 父页面可能已关闭 */
  }
}

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

function runExecute(msg: ExecutePromptMessage, replyTarget?: Window | null): void {
  const execMsg = msg;
  currentEmbedTaskId = execMsg.taskId;
  // replyTarget 存在 → 通过 postMessage 回传父页面（嵌入视图执行模式）；
  // 否则 → 通过 chrome.runtime 回传 background（常规标签页执行模式）。
  const embed = !!replyTarget;
  const sendStatus = (status: string, detail?: string) => {
    if (embed && replyTarget) {
      replyTo(replyTarget, { __multiAi: EMBED_MSG.EXECUTE_STATUS, provider: execMsg.provider, taskId: execMsg.taskId, status, detail });
    } else {
      chrome.runtime.sendMessage({
        type: 'PROVIDER_STATUS',
        taskId: execMsg.taskId,
        provider: execMsg.provider,
        status,
        detail,
      });
    }
  };
  const sendStream = (content: string) => {
    if (embed && replyTarget) {
      replyTo(replyTarget, { __multiAi: EMBED_MSG.EXECUTE_STREAM, provider: execMsg.provider, taskId: execMsg.taskId, content });
    } else {
      chrome.runtime.sendMessage({
        type: 'STREAM_UPDATE',
        taskId: execMsg.taskId,
        provider: execMsg.provider,
        content,
        isPartial: true,
      });
    }
  };
  const sendDone = (finalContent: string) => {
    if (embed && replyTarget) {
      replyTo(replyTarget, { __multiAi: EMBED_MSG.EXECUTE_DONE, provider: execMsg.provider, taskId: execMsg.taskId, finalContent });
    } else {
      chrome.runtime.sendMessage({
        type: 'TASK_DONE',
        taskId: execMsg.taskId,
        provider: execMsg.provider,
        finalContent,
      });
    }
  };
  const sendError = (errorCode: string, errorMessage: string) => {
    if (embed && replyTarget) {
      replyTo(replyTarget, { __multiAi: EMBED_MSG.EXECUTE_ERROR, provider: execMsg.provider, taskId: execMsg.taskId, errorCode, errorMessage });
    } else {
      chrome.runtime.sendMessage({
        type: 'TASK_ERROR',
        taskId: execMsg.taskId,
        provider: execMsg.provider,
        errorCode,
        errorMessage,
      });
    }
  };

  executePrompt(execMsg, sendStatus, sendStream, sendDone, sendError);
}

onBackgroundMessage((msg, _sender) => {
  if (msg.type === 'EXECUTE_PROMPT') {
    console.log('[MultiAI:content] Received EXECUTE_PROMPT for', msg.provider);
    runExecute(msg as ExecutePromptMessage, null);
  }

  // PING: respond directly by returning a value
  if (msg.type === 'PING') {
    console.log('[MultiAI:content] PING received, responding PONG');
    return { type: 'PONG' };
  }
});

// ── 嵌入视图：插件父页面（Fullscreen / 侧边栏的网页视图）通过 window.postMessage
// 把任务下发给 iframe 内的 content script。跨域 postMessage 不受同源策略限制。 ──
window.addEventListener('message', (ev: MessageEvent) => {
  // 安全校验：只接受来自扩展自身页面（父页面）的指令，拒绝任意第三方网页伪造
  if (ev.origin !== EXT_ORIGIN) return;
  const data = ev.data as Record<string, unknown> | null;
  if (!data || typeof data !== 'object') return;

  if (data.__multiAi === EMBED_MSG.PING) {
    replyTo(ev.source as Window | null, {
      __multiAi: EMBED_MSG.PONG,
      provider: effectiveProvider(data.provider as string | undefined),
    });
    return;
  }

  if (data.__multiAi === EMBED_MSG.EXECUTE) {
    const p = data.provider as ProviderName | undefined;
    const prompt = data.prompt as string | undefined;
    const taskId = data.taskId as string | undefined;
    if (accepts(p) && p && prompt && taskId) {
      console.log('[MultiAI:content] postMessage EXECUTE for', p, 'taskId=', taskId);
      // 内嵌执行：先新建会话（导航到 provider 首页），再执行，避免沿用上一节点会话
      void beginEmbedExecute(
        { type: 'EXECUTE_PROMPT', taskId, provider: p, prompt },
        ev.source as Window | null
      );
    }
    return;
  }

  // 嵌入视图的手动获取：就地读屏，把结果（或失败原因）回传父页面
  if (data.__multiAi === EMBED_MSG.GRAB) {
    const p = data.provider as ProviderName | undefined;
    if (!accepts(p) || !p) return;
    const prompt = (data.prompt as string | undefined) ?? '';
    const reqId = data.reqId as string | undefined;
    // 父页面可直接下发 response 选择器（自定义网页点选后立刻验证，尚未落库）
    const inlineSel = (data.responseSelector as string | undefined) || '';
    const src = ev.source as Window | null;

    void (async () => {
      let sel: string | null = inlineSel || null;
      if (!sel) {
        try {
          sel = (await getCustomForProvider(p))?.response ?? null;
        } catch {
          sel = null;
        }
      }
      if (!sel && isCustomProvider(p)) {
        try {
          sel = (await getCustomProvider(p))?.responseSelector ?? null;
        } catch {
          sel = null;
        }
      }
      let out: { text: string; method: string; reason?: string };
      try {
        out = grabLocal(currentProvider ?? p, prompt, sel);
      } catch (e) {
        out = { text: '', method: 'none', reason: '读屏异常：' + (e instanceof Error ? e.message : String(e)) };
      }
      replyTo(src, {
        __multiAi: EMBED_MSG.GRAB_RESULT,
        provider: p,
        reqId,
        text: out.text,
        method: out.method,
        reason: out.reason,
        url: location.href,
      });
    })();
    return;
  }

  // 手动选取元素：父页面请求在 iframe 内点选输入框 / 发送按钮 / 回答区域
  if (data.__multiAi === EMBED_MSG.PICK_START) {
    const p = data.provider as ProviderName | undefined;
    const role = data.role as ElementRole | undefined;
    if (!accepts(p) || !role) return;
    console.log('[MultiAI:content] PICK_START role=', role);
    const src = ev.source as Window | null;
    startPick(
      role,
      (r, selector) => {
        console.log('[MultiAI:content] PICK_RESULT', r, selector);
        replyTo(src, { __multiAi: EMBED_MSG.PICK_RESULT, role: r, selector, provider: p });
      },
      () => {
        // 取消（Esc）：回传空选择器，父页面知道取消
        replyTo(src, { __multiAi: EMBED_MSG.PICK_RESULT, role, selector: '', provider: p });
      }
    );
    return;
  }

  // 页面诊断：父页面请求扫描整页元素，回传结构化信息
  if (data.__multiAi === EMBED_MSG.DIAGNOSE) {
    const p = data.provider as ProviderName | undefined;
    if (!accepts(p) || !p) return;
    console.log('[MultiAI:content] DIAGNOSE requested for', p);
    const result = runDiagnose(currentProvider ?? p);
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
  const announce = () =>
    replyTo(window.parent, { __multiAi: EMBED_MSG.READY, provider: effectiveProvider() });
  announce();
  [200, 600, 1500, 3000, 6000].forEach((t) => setTimeout(announce, t));
  window.addEventListener('load', announce);
}

// 新建会话后，iframe 被导航重载到 provider 首页；本钩子在加载后从 sessionStorage
// 取出暂存的待执行任务并恢复执行，结果仍回传给同一父页面（保证每个节点独立新会话）。
(() => {
  try {
    if (!window.parent || window.parent === window) return; // 仅在嵌入（iframe）场景恢复
    const raw = sessionStorage.getItem(PENDING_EXEC_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PENDING_EXEC_KEY);
    const msg = JSON.parse(raw) as ExecutePromptMessage;
    if (!msg || msg.type !== 'EXECUTE_PROMPT' || !msg.taskId || !msg.provider || !msg.prompt) return;
    // 导航后重新校验：当前页是否仍属于目标 provider（防止登录跳转等重定向导致用错适配器操作错页面）
    const currentP = getProviderFromUrl(location.href);
    if (currentP !== msg.provider) {
      console.warn('[MultiAI:content] 恢复任务时 provider 不匹配，丢弃', { expected: msg.provider, actual: currentP, host: location.hostname });
      replyTo(window.parent, {
        __multiAi: EMBED_MSG.EXECUTE_ERROR,
        provider: msg.provider,
        taskId: msg.taskId,
        errorCode: 'PROVIDER_MISMATCH',
        errorMessage: `新建会话后页面已跳转，未落在 ${msg.provider} 的页面（当前：${location.hostname}）`,
      });
      return;
    }
    console.log('[MultiAI:content] 恢复待执行任务（新会话已就绪）taskId=', msg.taskId);
    runExecute(msg, window.parent);
  } catch {
    /* 解析失败忽略，等待下一次执行 */
  }
})();
