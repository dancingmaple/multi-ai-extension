import type { ProviderName } from '../../shared/types';
import { BaseAdapter } from './base';
import { SubmitFailedError } from '../../shared/utils';

/* ============================================================
   Z.ai 适配器 · robust-v2
   修复「抓错回答」：改用笔直剪刀法（prompt-scissor）替代
   markdown-body 容器选择器。只依赖物理事实「回答在提问后」，
   不再受历史对话/浮动提示/思考块位置影响。
   ============================================================ */
console.log('[Zai:adapter] build=robust-v2 2026-08-02');

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
  RESPONSE_SELECTORS: ['main', 'body'],
  LOGIN_SELECTORS: ['a[href*="/login"]', 'a[href*="/signin"]'],

  /* 剪刀法裁剪：思考/联网头 + 动作尾 */
  HEAD_LINE: /^(思考了|已思考|思考中|Thought for|Thinking|Reasoned|Reasoning|搜索了|联网搜索|Searching|Searched|Found\s+\d+|阅读了|Read\s+\d+|查看了|引用了|\d+\s*个\s*(网页|来源|结果|web\s*pages?)|DeepThink|Instant|深度思考|联网搜索中|搜索中|生成中|正在思考|正在联网|正在搜索)/i,
  TAIL_LINE: /^(复制|点赞|点踩|重新生成|再生成|分享|引用|参考来源|参考|来源|DeepThink|联网搜索|Instant|搜索|给\s*豆包|发消息|发送|Message|跳过|⎘|👍|👎|◎|↻)/i,
  PROGRESS: /(思考中|搜索中|联网搜索中|生成中|正在搜索|正在思考|正在阅读|正在联网|Searching(?! for)|Reading\s+\d)/i,
  PLACEHOLDER_RE: /^[.…·••\s…\u2026\u00b7]*$/,

  HARD_STABLE: 2200, SOFT_STABLE: 6000, ABS_CAP: 9000,
  THINKING_PLACEHOLDER: '⏳ 思考 / 联网检索中…',
  STREAM_THROTTLE_MS: 250, POLL_MS: 400, DEBUG: true,
};

const log = (...a: unknown[]) => { if (CONFIG.DEBUG) console.log('[Zai:adapter]', ...a); };

function isVisible(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.01;
}

function pageText(): string {
  return (document.body.innerText || document.body.textContent || '').replace(/\u00a0/g, ' ');
}

function extractAnswer(text: string, prompt: string): string {
  const lines = text
    .split('\n')
    .map((s) => s.replace(/\s+$/, '').replace(/^\s+/, ''))
    .filter((s) => s.length > 0);
  const key = (prompt || '').replace(/\s/g, '').slice(0, 12);
  let q = -1;
  if (key) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].replace(/\s/g, '').includes(key)) { q = i; break; }
    }
  }
  if (q < 0) return '';
  let body = lines.slice(q + 1);
  while (body.length && CONFIG.HEAD_LINE.test(body[0])) body.shift();
  while (body.length && CONFIG.TAIL_LINE.test(body[body.length - 1])) body.pop();
  return body.join('\n').trim();
}

export class ZaiAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'zai';
  readonly inputSelectors = CONFIG.INPUT_SELECTORS;
  readonly submitSelectors = CONFIG.SUBMIT_SELECTORS;
  readonly responseSelectors = CONFIG.RESPONSE_SELECTORS;
  readonly loginSelectors = CONFIG.LOGIN_SELECTORS;

  private lastPrompt = '';
  private preSendLen = 0;

  override detectLoginRequired(): boolean {
    if (super.detectLoginRequired()) return true;
    if (/\/login|\/signin|\/auth/i.test(location.href)) return true;
    const hasInput = [...document.querySelectorAll(this.inputSelectors.join(','))].some(isVisible);
    const loginBtn = [...document.querySelectorAll('button,a')].some((b) => /登录|sign\s*in|log\s*in/i.test((b.textContent || '').trim()));
    return !hasInput && loginBtn;
  }

  override async setPrompt(prompt: string): Promise<void> {
    this.lastPrompt = prompt;
    this.preSendLen = pageText().length;
    await super.setPrompt(prompt);
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
    const prompt = this.lastPrompt;
    const gateLen = this.preSendLen;
    let started = false;
    let lastReal = '';
    let stableSince = 0;
    let lastEmit = 0;
    let lastSent = '';
    const maxWait = this.getResponseMaxWait();
    const t0 = Date.now();

    const tick = () => {
      if (stopped) return;
      const now = Date.now();
      const text = pageText();
      if (!started && text.length > gateLen + 12) { started = true; log('GATE OPEN len', text.length, '>', gateLen); }
      const real = started ? extractAnswer(text, prompt) : '';
      const isPlaceholder = !real || CONFIG.PLACEHOLDER_RE.test(real);
      const body = isPlaceholder ? '' : real;
      const show = body || (started ? CONFIG.THINKING_PLACEHOLDER : '');
      if (show && show !== lastSent && now - lastEmit >= CONFIG.STREAM_THROTTLE_MS) { lastSent = show; lastEmit = now; onUpdate(show); }
      if (body) { if (body !== lastReal) { lastReal = body; stableSince = now; } } else { lastReal = ''; stableSince = 0; }
      const hasProgress = CONFIG.PROGRESS.test(body);
      const elapsed = body ? now - stableSince : 0;
      const need = hasProgress ? CONFIG.SOFT_STABLE : CONFIG.HARD_STABLE;
      const done = !!body && body === lastReal && (elapsed >= need || elapsed >= CONFIG.ABS_CAP);
      log('tick', { started, bodyLen: body.length, hasProgress, stableMs: elapsed, need, done });
      if (done) {
        stopped = true;
        const final = extractAnswer(pageText(), prompt) || body;
        log('DONE finalLen=', final.length);
        onUpdate(final); onDone(final); cleanup();
        return;
      }
      if (now - t0 >= maxWait) {
        stopped = true; cleanup();
        const final = extractAnswer(pageText(), prompt);
        if (final && !CONFIG.PLACEHOLDER_RE.test(final)) { log('HARD_TIMEOUT 有正文'); onDone(final); }
        else { log('HARD_TIMEOUT 无正文'); onError(new Error('StreamTimeoutError')); }
      }
    };

    const mo = new MutationObserver(() => { if (!stopped) tick(); });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    const poll = window.setInterval(tick, CONFIG.POLL_MS);
    function cleanup() { mo.disconnect(); clearInterval(poll); }
    tick(); return cleanup;
  }
}
export default ZaiAdapter;
