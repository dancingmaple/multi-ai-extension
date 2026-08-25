/**
 * 嵌入视图（iframe）里的就地读屏。
 * 与 background 的 manualGrab.grabInPage 逻辑一致，但运行在 content script 上下文里，
 * 因此不需要 chrome.tabs / chrome.scripting——这正是「网页视图里手动获取拿不到」的根因：
 * iframe 不是标签页，tabs.query 永远查不到它。
 */
import { extractAnswer, HEAD_META, TAIL_META, type GrabResult } from '../shared/grab';
import type { ProviderName } from '../shared/types';

const COMMON_ROOTS = [
  '[data-testid="message-list"]',
  '.chat-messages',
  '.message-list',
  '.chat-content',
  '.conversation-content',
  '.conversation-main',
  'main[class*="chat"]',
  'main',
];

/**
 * 根节点候选项：
 *  - string：CSS 选择器，命中的块通常含「问 + 答」，需走 extractAnswer 剪刀法
 *  - function：动态定位，默认返回的就是「纯回答元素」，可直接裁头尾（isAnswer=true）
 *  - { get, answer:false }：动态定位但结果含问答混排，仍走剪刀法
 */
type RootPick = string | (() => Element | null) | { get: () => Element | null; answer: boolean };

const PROVIDER_ROOTS: Record<string, RootPick[]> = {
  zai: ['.chat-content', '.message-list', '.chat-messages', '.conversation-content', 'main[class*="chat"]', 'main'],
  doubao: ['[data-testid="message-list"]', '.chat-messages', '.message-list', 'main'],
  /**
   * Gemini：必须取「最后一条」回答。
   * 原来写死 '.conversation-container' 走 querySelector，多轮会话下永远命中
   * 第一轮容器 → 手动获取拿回上一轮/首轮回答，表现为「获取不到 gemini」。
   */
  gemini: [
    () => {
      const els = document.querySelectorAll('model-response');
      return els.length ? els[els.length - 1] : null;
    },
    () => {
      const els = document.querySelectorAll('message-content.model-response-text, .model-response-text');
      return els.length ? els[els.length - 1] : null;
    },
    // 整个 conversation-container 含「问 + 答」，交给剪刀法
    {
      get: () => {
        const els = document.querySelectorAll('.conversation-container');
        return els.length ? els[els.length - 1] : null;
      },
      answer: false,
    },
    'chat-window',
    '.chat-container',
    'main',
  ],
  /** ChatGPT：动态查找最后一条 assistant 消息（整个元素即完整回答） */
  chatgpt: [
    () => {
      const turns = document.querySelectorAll('[data-testid^="conversation-turn-"][data-message-author-role="assistant"]');
      return turns.length > 0 ? turns[turns.length - 1] : null;
    },
    () => {
      const all = document.querySelectorAll('[data-message-author-role="assistant"]');
      return all.length > 0 ? (all[all.length - 1] as HTMLElement) : null;
    },
    '[data-message-author-role="assistant"]',
    '.markdown.prose',
    '[role="presentation"] .flex.flex-col',
    'main .flex.flex-col',
    'main',
  ],
  deepseek: ['.chat-messages', '.message-list', 'main'],
  qwen: ['.chat-messages', '.message-list', 'main'],
  kimi: ['.chat-content', '.message-list', '.chat-messages', '.conversation-content', 'main[class*="chat"]', 'main'],
};

function isVisible(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.01;
}

/**
 * 块级感知全文提取（与 background grabInPage.blockText 一致）：直接遍历 DOM 子树拼接文本，
 * 块级元素前插换行，永不因滚动/虚拟化丢失文本——这是长回答能抓全的关键。
 */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR', 'TR', 'SECTION',
  'ARTICLE', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'TABLE', 'THEAD', 'TBODY', 'TD', 'TH',
]);
const SKIP_TAGS = new Set(['BUTTON', 'SVG', 'IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'PATH']);
function blockText(el: HTMLElement): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent || '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const e = node as HTMLElement;
    const tag = e.tagName;
    if (tag === 'BR') { out += '\n'; return; }
    if (SKIP_TAGS.has(tag)) return;
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return;
    const before = out.length;
    for (const child of Array.from(e.childNodes)) walk(child);
    if (BLOCK_TAGS.has(tag) && out.length > before && !out.endsWith('\n')) out += '\n';
  };
  walk(el);
  return out.replace(/\u00a0/g, ' ');
}

function pickRoot(provider: ProviderName | null, customResponse?: string | null): { el: HTMLElement; isAnswer: boolean } {
  const base: RootPick[] = provider && PROVIDER_ROOTS[provider] ? PROVIDER_ROOTS[provider] : COMMON_ROOTS;
  // 用户手动点选过 response 元素 → 最高优先级，且视为「纯回答」（取最后一个匹配）
  const order: RootPick[] = customResponse
    ? [
        {
          get: () => {
            try {
              const els = document.querySelectorAll(customResponse);
              return els.length ? els[els.length - 1] : null;
            } catch {
              return null;
            }
          },
          answer: true,
        },
        ...base,
      ]
    : base;

  for (const sel of order) {
    let el: HTMLElement | null = null;
    let answer = false;
    if (typeof sel === 'function') {
      const r = sel();
      el = r instanceof HTMLElement ? r : null;
      answer = true;
    } else if (typeof sel === 'object') {
      const r = sel.get();
      el = r instanceof HTMLElement ? r : null;
      answer = sel.answer;
    } else {
      el = document.querySelector(sel) as HTMLElement | null;
    }
    if (el && isVisible(el) && blockText(el).trim().length > 20) {
      return { el, isAnswer: answer };
    }
  }
  return { el: document.body, isAnswer: false };
}

export function grabLocal(provider: ProviderName | null, prompt: string, customResponse?: string | null): GrabResult {
  let root: HTMLElement;
  let isAnswer = false;
  try {
    const r = pickRoot(provider, customResponse);
    root = r.el;
    isAnswer = r.isAnswer;
  } catch {
    root = document.body;
  }

  const raw = blockText(root).trim();
  if (!raw) {
    return { text: '', method: 'none', reason: '页面文本为空（网页可能还没加载完，或被站点的嵌入限制挡住了）' };
  }

  // ChatGPT 等「root 已是完整回答」：直接裁头尾，不走 extractAnswer 的 scissors/tail-fallback（会取半段）
  if (isAnswer) {
    const lines = raw.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
    const trimmed = [...lines];
    while (trimmed.length && HEAD_META.test(trimmed[0])) trimmed.shift();
    while (trimmed.length && TAIL_META.test(trimmed[trimmed.length - 1])) trimmed.pop();
    const body = trimmed.join('\n').trim();
    if (body.length > 8) return { text: body, method: 'direct' };
    // 太短则退化到通用剪刀法
  }

  return extractAnswer(raw, prompt);
}
