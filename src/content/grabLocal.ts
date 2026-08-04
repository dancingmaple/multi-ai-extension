/**
 * 嵌入视图（iframe）里的就地读屏。
 * 与 background 的 manualGrab.grabInPage 逻辑一致，但运行在 content script 上下文里，
 * 因此不需要 chrome.tabs / chrome.scripting——这正是「网页视图里手动获取拿不到」的根因：
 * iframe 不是标签页，tabs.query 永远查不到它。
 */
import { extractAnswer, type GrabResult } from '../shared/grab';
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

const PROVIDER_ROOTS: Record<string, string[]> = {
  zai: ['.chat-content', '.message-list', '.chat-messages', '.conversation-content', 'main[class*="chat"]', 'main'],
  doubao: ['[data-testid="message-list"]', '.chat-messages', '.message-list', 'main'],
  gemini: ['.conversation-container', 'chat-window', '.chat-container', 'main'],
  chatgpt: ['[role="presentation"] .flex.flex-col', 'main .flex.flex-col', 'main'],
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

function pickRoot(provider: ProviderName | null): HTMLElement {
  const order = provider && PROVIDER_ROOTS[provider] ? PROVIDER_ROOTS[provider] : COMMON_ROOTS;
  for (const sel of order) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el && isVisible(el) && (el.innerText || '').trim().length > 20) return el;
  }
  return document.body;
}

export function grabLocal(provider: ProviderName | null, prompt: string): GrabResult {
  let root: HTMLElement;
  try {
    root = pickRoot(provider);
  } catch {
    root = document.body;
  }
  const text = (root.innerText || document.body.innerText || '').trim();
  if (!text) {
    return { text: '', method: 'none', reason: '页面文本为空（网页可能还没加载完，或被站点的嵌入限制挡住了）' };
  }
  return extractAnswer(text, prompt);
}
