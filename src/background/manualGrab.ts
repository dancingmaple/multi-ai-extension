import type { ProviderName } from '../shared/types';
import {
  getTask,
  createTask,
  setProviderTabId,
  finishProviderTask,
  failProviderTask,
} from './stateStore';
import { broadcastTaskState } from '../shared/messaging';
import { upsertAnswer } from './conversationStore';

const DOMAIN_PATTERN: Record<string, string> = {
  chatgpt: '*://chatgpt.com/*',
  gemini: '*://gemini.google.com/*',
  deepseek: '*://*.deepseek.com/*',
  qwen: '*://chat.qwen.ai/*',
  zai: '*://chat.z.ai/*',
  doubao: '*://www.doubao.com/*',
  kimi: '*://*.moonshot.cn/*',
};

/**
 * 注入函数（必须自包含，不依赖任何模块/import）：
 * 读整页可见文本 → 用提问当剪刀剪出回答 → 剪不到兜底取页面后半段 →
 * 裁掉头尾元信息 + 页面 footer/免责声明。宁可抓糙，绝不抓空。
 */
function grabInPage(args: { prompt: string; provider?: string }): { text: string; method: string; reason?: string } {
  const HEAD =
    /^(思考了|已思考|思考中|Thought for|Thinking|Reasoned|Reasoning|搜索了|联网搜索|Searching|Searched|Found\s+\d+|阅读了|Read\s+\d+|查看了|引用了|\d+\s*个\s*(网页|来源|结果|web\s*pages?)|DeepThink|Instant|深度思考|联网搜索中|搜索中|生成中)/i;
  const TAIL =
    /^(复制|点赞|点踩|重新生成|再生成|分享|引用|参考来源|参考|来源|DeepThink|联网搜索|Instant|搜索|给\s*豆包|发消息|发送|Copy|Like|Dislike|Share|Regenerate|Retry|Message|⎘|👍|👎|◎|↻)/i;
  const STOP =
    /^(Gemini is AI|Gemini may display inaccurate|Gemini Apps|Gemini Advanced|Gemini can make mistakes|Gemini is experimental|I'm Gemini|以上(?:内容|回答|结果|文本).{0,30}(?:AI|人工智能).{0,20}(?:生成|提供)|(?:AI|人工智能).{0,20}(?:生成|提供).{0,20}(?:仅供参考|内容|回答)|本回答由.{0,10}(?:AI|人工智能).{0,10}生成|以上内容(?:仅供|均由AI生成|由AI生成)|结果仅供参考|免责声明|免责说明|隐私政策|隐私条款|用户协议|使用条款|服务条款|Cookie|Feedback|报告问题|ICP备|京ICP|沪ICP|粤ICP|苏ICP|备案号|技术支持|联系我们|关于我们|登录|注册|登录\/注册|立即登录|帮助中心|意见反馈|最高|技术博客|快速|图像生成|视频生成|AI\s*播客|帮我写作|翻译|音乐生成|深入研究)$/i;

  function isVisible(el: Element | null): boolean {
    if (!el || !(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.01;
  }

  function pickRoot(): HTMLElement {
    const common = [
      '[data-testid="message-list"]',
      '.chat-messages',
      '.message-list',
      '.chat-content',
      '.conversation-content',
      '.conversation-main',
      'main[class*="chat"]',
      'main',
    ];
    const providerRoots: Record<string, string[]> = {
      zai: ['.chat-content', '.message-list', '.chat-messages', '.conversation-content', 'main[class*="chat"]', 'main'],
      doubao: ['[data-testid="message-list"]', '.chat-messages', '.message-list', 'main'],
      gemini: ['.conversation-container', '.chat-container', 'main', 'body'],
      chatgpt: ['[data-testid="conversation-turn-2"]', '.conversation-content', 'main', 'body'],
      deepseek: ['.chat-messages', '.message-list', 'main', 'body'],
      qwen: ['.chat-messages', '.message-list', 'main', 'body'],
      kimi: ['.chat-content', '.message-list', '.chat-messages', '.conversation-content', 'main[class*="chat"]', 'main'],
    };
    const order = args.provider && providerRoots[args.provider] ? providerRoots[args.provider] : common;
    for (const s of order) {
      const el = document.querySelector(s) as HTMLElement | null;
      if (el && isVisible(el) && el.innerText.trim().length > 20) return el;
    }
    return document.body;
  }

  const clean = (s: string) => s.replace(/\u00a0/g, ' ');
  const root = pickRoot();
  const raw = clean(root.innerText || document.body.innerText || '');
  const lines = raw.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);

  const trimHeadTail = (arr: string[]) => {
    while (arr.length && HEAD.test(arr[0])) arr.shift();
    while (arr.length && TAIL.test(arr[arr.length - 1])) arr.pop();
    return arr;
  };

  const key = (args.prompt || '').replace(/\s/g, '').slice(0, 12);
  let q = -1;
  if (key)
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].replace(/\s/g, '').includes(key)) {
        q = i;
        break;
      }
    }
  if (q >= 0 && q < lines.length - 1) {
    const rawBody = lines.slice(q + 1);
    const stopIdx = rawBody.findIndex((l) => STOP.test(l));
    const body = trimHeadTail(stopIdx >= 0 ? rawBody.slice(0, stopIdx) : rawBody).join('\n').trim();
    if (body.length > 8) return { text: body, method: 'scissor' };
  }
  const rawHalf = lines.slice(Math.floor(lines.length / 2));
  const stopIdx2 = rawHalf.findIndex((l) => STOP.test(l));
  const half = trimHeadTail(stopIdx2 >= 0 ? rawHalf.slice(0, stopIdx2) : rawHalf).join('\n').trim();
  if (half.length > 8) return { text: half, method: 'tail-fallback' };

  const loggedOut = /(^|\n)\s*(登录|登陆|Sign in|Log in|立即登录|扫码登录)\s*($|\n)/i.test(raw);
  const reason = !lines.length
    ? '页面没有可见文本（可能尚未加载完成）'
    : loggedOut
      ? '页面疑似未登录（只读到登录入口），请先在该网页登录'
      : q < 0
        ? '页面里找不到你这次的提问文本——多半是消息没真正发出去，或页面还没渲染出这一轮对话'
        : '已定位到提问，但其后没有足量正文——回答可能仍在生成中，稍等再试';
  return { text: '', method: 'none', reason };
}

export { grabInPage };

/**
 * 纯读屏：找到指定 provider 的标签页，执行 grabInPage 读回回答文本。
 * 不写会话/运行时，供工作台「手动获取」等旁路场景复用（只是兜底读，不沉淀）。
 * 定位优先级：显式传入的 tabId（forceNew 后精确对应，避免多标签串台）
 * > taskId 记录的 tabId > 按域名在全部标签页里查找（兜底）。
 */
export async function grabFromProviderTab(
  provider: ProviderName,
  prompt: string,
  opts?: { taskId?: string; tabId?: number }
): Promise<{ ok: boolean; text: string; method?: string; reason?: string; url?: string; tabId?: number }> {
  let tabId: number | undefined = opts?.tabId;
  if (tabId === undefined && opts?.taskId !== undefined) {
    tabId = getTask(opts.taskId)?.providers?.[provider]?.tabId;
  }
  const pat = DOMAIN_PATTERN[provider];
  if (tabId === undefined && pat) {
    const tabs = await chrome.tabs.query({ url: pat });
    tabId = tabs[0]?.id;
  }
  if (tabId === undefined) {
    return { ok: false, text: '', reason: '找不到该站点的标签页，请先在浏览器里打开它' };
  }
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: grabInPage,
      args: [{ prompt, provider }],
    });
    const got = (res?.[0]?.result || { text: '', method: 'none' }) as {
      text: string;
      method: string;
      reason?: string;
    };
    const text = (got.text || '').trim();
    let url: string | undefined;
    try {
      url = (await chrome.tabs.get(tabId)).url;
    } catch {
      /* 标签已关闭 */
    }
    if (text) return { ok: true, text, method: got.method, url, tabId };
    return { ok: false, text: '', reason: got.reason || '页面当前没有可读取的回答文本', url, tabId };
  } catch (e) {
    return { ok: false, text: '', reason: e instanceof Error ? e.message : String(e), tabId };
  }
}

export interface GrabOutcome {
  provider: ProviderName;
  ok: boolean;
  method?: string;
  error?: string;
}

/**
 * 手动兜底（§9）：旁路读屏，把结果写回运行时 Task（让卡片变 done）与
 * Conversation 的对应 Turn（source='manual'）。自动链路失败时它是 100% 可用的保险丝。
 */
export async function manualGrab(
  conversationId: string,
  turnId: string,
  provider: ProviderName,
  prompt: string
): Promise<GrabOutcome> {
  let tabId = getTask(turnId)?.providers?.[provider]?.tabId;
  if (!tabId) {
    const pat = DOMAIN_PATTERN[provider];
    if (pat) {
      const tabs = await chrome.tabs.query({ url: pat });
      tabId = tabs[0]?.id;
    }
  }
  if (!tabId) {
    return { provider, ok: false, error: '找不到该站点的标签页，请先在浏览器里打开它' };
  }

  try {
    const got = await grabFromProviderTab(provider, prompt, { taskId: turnId });
    const text = got.text;

    let task = getTask(turnId);
    if (!task) task = createTask(turnId, prompt, [provider]);
    setProviderTabId(turnId, provider, tabId);
    if (text) finishProviderTask(turnId, provider, text);
    else failProviderTask(turnId, provider, '手动抓取未读到回答文本');
    const t2 = getTask(turnId);
    if (t2) broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: t2 });

    if (text) {
      const method = got.method === 'scissor' ? 'scissor' : got.method === 'tail-fallback' ? 'tail-fallback' : 'stream';
      const tab = await chrome.tabs.get(tabId).catch(() => undefined);
      upsertAnswer(conversationId, turnId, provider, {
        provider,
        content: text,
        status: 'done',
        source: 'manual',
        method,
        url: tab?.url,
        finishedAt: Date.now(),
      });
    }
    return {
      provider,
      ok: !!text,
      method: got.method,
      error: text ? undefined : got.reason || '页面当前没有可读取的回答文本',
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { provider, ok: false, error: msg };
  }
}

/**
 * 嵌入视图（iframe）专用：文本已由 iframe 内的 content script 就地读出，
 * 这里只负责落库——写回运行时 Task（卡片变 done）与 Conversation 的对应 Turn。
 * iframe 不是标签页，走不了 chrome.scripting，所以必须有这条独立通路。
 */
export function saveGrabbedText(
  conversationId: string,
  turnId: string,
  provider: ProviderName,
  prompt: string,
  rawText: string,
  method?: string,
  url?: string
): GrabOutcome {
  const text = (rawText || '').trim();
  if (!text) return { provider, ok: false, error: '没有可保存的文本' };

  if (!getTask(turnId)) createTask(turnId, prompt, [provider]);
  finishProviderTask(turnId, provider, text);
  const t2 = getTask(turnId);
  if (t2) broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: t2 });

  const m: 'scissor' | 'tail-fallback' | 'stream' =
    method === 'scissor' ? 'scissor' : method === 'tail-fallback' ? 'tail-fallback' : 'stream';

  upsertAnswer(conversationId, turnId, provider, {
    provider,
    content: text,
    status: 'done',
    source: 'manual',
    method: m,
    url,
    finishedAt: Date.now(),
  });

  return { provider, ok: true, method: m };
}

export async function manualGrabAll(
  conversationId: string,
  turnId: string,
  prompt: string,
  providers: ProviderName[]
): Promise<GrabOutcome[]> {
  const outs: GrabOutcome[] = [];
  for (const p of providers) {
    outs.push(await manualGrab(conversationId, turnId, p, prompt));
  }
  return outs;
}
