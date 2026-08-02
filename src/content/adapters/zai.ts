import type { ProviderName } from '../../shared/types';
import { BaseAdapter } from './base';
import { SubmitFailedError } from '../../shared/utils';

/* ============================================================
   Z.ai 适配器 · robust-v1（与 DeepSeek v4 同逻辑，通用选择器）
   修复「状态完成但抓不到答案」：剜思考/联网块 + 门闩防追问串味 +
   三档静止阈值 + 绝对上限 + 硬超时逃生。类型契约由 BaseAdapter 满足。
   选择器为多家通吃超集；若不准，改 CONFIG 即可。
   ============================================================ */
console.log('[Zai:adapter] build=robust-v1 2026-08-02');

const CONFIG = {
  INPUT_SELECTORS: [
    'textarea', 'div[contenteditable="true"]',
    '[placeholder*="发送"]', '[placeholder*="消息"]', '[placeholder*="输入"]',
    '[placeholder*="问"]', '[placeholder*="Message" i]', '[data-testid*="input"]',
  ],
  SUBMIT_SELECTORS: [
    'button[aria-label*="Send" i]', 'button[aria-label*="发送"]',
    'button[data-testid*="send" i]', 'button[class*="send" i]',
    'form button[type="submit"]', 'button[aria-label*="submit" i]',
  ],
  RESPONSE_SELECTORS: ['.markdown-body', '[class*="markdown"]', '.prose', '[class*="answer"]'],
  LOGIN_SELECTORS: ['a[href*="/login"]', 'a[href*="/signin"]'],

  ANSWER_MARKDOWN_SELECTORS: ['.markdown-body', '[class*="markdown"]', '.prose', '[class*="answer"]', '[class*="response"] [class*="content"]'],
  THINKING_CONTAINER_CLASS_RE: /think|reason|思考|推理/i,
  THINKING_HEADER_RE: /^(Thought for|思考了|已思考|思考中|Thinking|Reasoning|Reasoned|深度思考|联网搜索|搜索中|Searching|Searched)/i,
  THINKING_ACTIVE_RE: /思考中|Thinking(?! for)|^Thinking$|Reasoning(?! for|ed)|搜索中|Searching(?! for)/i,
  TOOL_BLOCK_SELECTORS: ['[class*="tool"]', '[class*="search-result"]', '[class*="web-search"]', '[class*="searching"]', '[class*="browse"]'],
  STOP_BUTTON_SELECTORS: ['button[aria-label*="Stop" i]', 'button[aria-label*="停止"]', 'button[data-testid*="stop" i]'],

  PLACEHOLDER_RE: /^[.…·••\s…\u2026\u00b7]+$/,
  HARD_STABLE: 2200, SOFT_STABLE: 6000, ABS_CAP: 9000,
  THINKING_PLACEHOLDER: '⏳ 思考 / 联网检索中…',
  STREAM_THROTTLE_MS: 250, POLL_MS: 400, DEBUG: true,
};

const log = (...a: unknown[]) => { if (CONFIG.DEBUG) console.log('[Zai:adapter]', ...a); };
const MARKDOWN_SEL = CONFIG.ANSWER_MARKDOWN_SELECTORS.join(',');
const TOOL_SEL = CONFIG.TOOL_BLOCK_SELECTORS.join(',');

function isVisible(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.01;
}
function directText(el: Element): string {
  let t = ''; el.childNodes.forEach((n) => { if (n.nodeType === 3) t += n.textContent || ''; }); return t;
}
function extractText(node: Element | null): string {
  if (!node) return '';
  const t = (node instanceof HTMLElement ? node.innerText : node.textContent) || '';
  return t.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
}
function assistantMessages(): Element[] {
  const cands = ['[data-testid*="assistant" i]', '[class*="assistant"]', '[data-message-author-role="assistant"]'];
  for (const s of cands) { const arr = [...document.querySelectorAll(s)].filter((e) => e.querySelector(MARKDOWN_SEL)); if (arr.length) return arr; }
  const set = new Set<Element>();
  document.querySelectorAll(MARKDOWN_SEL).forEach((m) => { const a = m.closest('div'); if (a) set.add(a); });
  return [...set];
}
function lastAssistantMessage(): Element | null { const all = assistantMessages(); return all[all.length - 1] || null; }
function countAssistant(): number { return assistantMessages().length; }
function findThinkingHeaderIn(root: Element): Element | null {
  for (const el of root.querySelectorAll('*')) { const d = directText(el).trim(); if (d && d.length < 60 && CONFIG.THINKING_HEADER_RE.test(d)) return el; }
  return null;
}
function thinkingContainerIn(root: Element, header: Element): Element | null {
  let p: Element | null = header;
  while (p && p !== root) { if (CONFIG.THINKING_CONTAINER_CLASS_RE.test(String((p as HTMLElement).className || ''))) return p; p = p.parentElement; }
  p = header.parentElement;
  while (p && p !== root) { if (p.querySelector(MARKDOWN_SEL)) return p; p = p.parentElement; }
  return null;
}
function bodyText(msg: Element | null): string {
  if (!msg) return '';
  const clone = msg.cloneNode(true) as Element;
  const header = findThinkingHeaderIn(clone);
  if (header) { const cont = thinkingContainerIn(clone, header); if (cont && cont.parentNode) cont.parentNode.removeChild(cont); }
  if (TOOL_SEL) clone.querySelectorAll(TOOL_SEL).forEach((n) => n.parentNode && n.parentNode.removeChild(n));
  return extractText(clone);
}
function hasStopButton(): boolean { return CONFIG.STOP_BUTTON_SELECTORS.some((s) => [...document.querySelectorAll(s)].some(isVisible)); }
function isThinkingActive(msg: Element | null): boolean { if (!msg) return false; const h = findThinkingHeaderIn(msg); return !!h && CONFIG.THINKING_ACTIVE_RE.test(directText(h).trim()); }

export class ZaiAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'zai';
  readonly inputSelectors = CONFIG.INPUT_SELECTORS;
  readonly submitSelectors = CONFIG.SUBMIT_SELECTORS;
  readonly responseSelectors = CONFIG.RESPONSE_SELECTORS;
  readonly loginSelectors = CONFIG.LOGIN_SELECTORS;

  override detectLoginRequired(): boolean {
    if (super.detectLoginRequired()) return true;
    if (/\/login|\/signin|\/auth/i.test(location.href)) return true;
    const hasInput = [...document.querySelectorAll(this.inputSelectors.join(','))].some(isVisible);
    const loginBtn = [...document.querySelectorAll('button,a')].some((b) => /登录|sign\s*in|log\s*in/i.test((b.textContent || '').trim()));
    return !hasInput && loginBtn;
  }
  override async submit(): Promise<void> {
    await new Promise((r) => setTimeout(r, 150));
    const btn = [...document.querySelectorAll(this.submitSelectors.join(','))].filter((b) => isVisible(b) && !(b as HTMLButtonElement).disabled).pop() as HTMLElement | undefined;
    if (btn) { btn.click(); log('submit via button'); return; }
    const el = [...document.querySelectorAll(this.inputSelectors.join(','))].find(isVisible) as HTMLElement | undefined;
    if (el) {
      const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true } as KeyboardEventInit;
      el.dispatchEvent(new KeyboardEvent('keydown', init)); el.dispatchEvent(new KeyboardEvent('keypress', init)); el.dispatchEvent(new KeyboardEvent('keyup', init));
      log('submit via Enter'); return;
    }
    throw new SubmitFailedError(this.provider, 'no submit button and no input for Enter fallback');
  }
  override startStreaming(onUpdate: (t: string) => void, onDone: (t: string) => void, onError: (e: Error) => void): () => void {
    let stopped = false;
    const snapshotText = bodyText(lastAssistantMessage()); const snapshotCount = countAssistant();
    log('SNAPSHOT', { snapshotTextLen: snapshotText.length, snapshotCount });
    let started = false, lastReal = '', stableSince = 0, lastEmit = 0, lastSent = '';
    const maxWait = this.getResponseMaxWait(); const t0 = Date.now();
    const tick = () => {
      if (stopped) return;
      const now = Date.now(); const msg = lastAssistantMessage(); const curCount = countAssistant(); const curText = msg ? bodyText(msg) : '';
      if (!started && (curText !== snapshotText || curCount > snapshotCount)) { started = true; log('GATE OPEN', { curTextLen: curText.length, curCount }); }
      const raw = started ? curText : ''; const isPlaceholder = !raw || CONFIG.PLACEHOLDER_RE.test(raw); const real = isPlaceholder ? '' : raw;
      const show = real || CONFIG.THINKING_PLACEHOLDER;
      if (show && show !== lastSent && now - lastEmit >= CONFIG.STREAM_THROTTLE_MS) { lastSent = show; lastEmit = now; onUpdate(show); }
      if (real) { if (real !== lastReal) { lastReal = real; stableSince = now; } } else { lastReal = ''; stableSince = 0; }
      const stop = hasStopButton(); const think = isThinkingActive(msg); const elapsed = real ? now - stableSince : 0;
      const need = (stop || think) ? CONFIG.SOFT_STABLE : CONFIG.HARD_STABLE;
      const done = !!real && real === lastReal && (elapsed >= need || elapsed >= CONFIG.ABS_CAP);
      log('tick', { started, realLen: real.length, placeholder: isPlaceholder, stableMs: elapsed, need, stop, think, done });
      if (done) { stopped = true; const final = bodyText(lastAssistantMessage()) || real; log('DONE finalLen=', final.length); onUpdate(final); onDone(final); cleanup(); return; }
      if (now - t0 >= maxWait) { stopped = true; cleanup(); const final = bodyText(lastAssistantMessage()); if (final && !CONFIG.PLACEHOLDER_RE.test(final)) { log('HARD_TIMEOUT 有正文'); onDone(final); } else { log('HARD_TIMEOUT 无正文'); onError(new Error('StreamTimeoutError')); } }
    };
    const mo = new MutationObserver(() => { if (!stopped) tick(); });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    const poll = window.setInterval(tick, CONFIG.POLL_MS);
    function cleanup() { mo.disconnect(); clearInterval(poll); }
    tick(); return cleanup;
  }
}
export default ZaiAdapter;