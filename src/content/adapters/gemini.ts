import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';
import { SubmitFailedError, sleep } from '../../shared/utils';
import { extractAnswer } from '../../shared/grab';

const STREAM_CONFIG = {
  HARD_STABLE: 2200,
  SOFT_STABLE: 6000,
  ABS_CAP: 9000,
  THINKING_PLACEHOLDER: '\u23f3 \u601d\u8003 / \u8054\u7f51\u68c0\u7d22\u4e2d\u2026',
  STREAM_THROTTLE_MS: 250,
  POLL_MS: 400,
  PLACEHOLDER_RE: /^[.\u2026\u00b7\u2022\s]*$/,
};

function pageText(): string {
  return (document.body.innerText || document.body.textContent || '').replace(/\u00a0/g, ' ');
}

export class GeminiAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'gemini';

  /**
   * New Gemini (2025-2026) DOM changes frequently.
   * Selectors ordered by priority: exact new patterns -> generic -> fallback.
   */
  readonly inputSelectors = [
    // -- New Gemini (2025-2026) exact match --
    'p[contenteditable="true"]',
    '.ql-editor[contenteditable="true"]',
    '.ql-editor p[contenteditable="true"]',
    'div[contenteditable="true"] p',
    '[class*="editor"] [contenteditable="true"]',
    '[class*="textarea"] [contenteditable="true"]',
    '[class*="query-input"] [contenteditable="true"]',
    '[class*="prompt-textarea"] [contenteditable="true"]',
    'rich-textarea [contenteditable="true"]',
    'mat-form-field [contenteditable="true"]',

    // -- aria-label / placeholder match --
    '[aria-label*="Ask" i][contenteditable="true"]',
    '[aria-label*="Enter" i][contenteditable="true"]',
    '[aria-label*="prompt" i][contenteditable="true"]',
    '[aria-label*="\u8f93\u5165" i][contenteditable="true"]',
    '[data-placeholder*="Ask" i]',
    '[placeholder*="Ask" i]',

    // -- Legacy compat --
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][aria-label*="prompt"]',
    'div[contenteditable="true"][aria-label*="\u8f93\u5165"]',
    'textarea[aria-label*="prompt"]',
    'textarea[aria-label*="\u8f93\u5165"]',
    'div[contenteditable="true"].ql-editor',

    // -- Broadest fallback --
    'textarea',
    'div[contenteditable="true"]',
  ];

  readonly submitSelectors = [
    // -- New Gemini submit --
    'button[aria-label="Submit"]',
    'button[aria-label="\u63d0\u4ea4"]',
    'button[aria-label*="submit" i]',
    'button[aria-label*="\u63d0\u4ea4" i]',

    // -- Legacy --
    'button[aria-label="Send message"]',
    'button[aria-label="\u53d1\u9001\u6d88\u606f"]',
    'button[aria-label*="Send" i]',
    'button[aria-label*="\u53d1\u9001" i]',
    'button[aria-label*="send" i]',
  ];

  readonly responseSelectors = [
    'model-response .markdown',
    'model-response',
    '[class*="response-content"]',
    'message-content',
    '[class*="markdown"]',
    '[class*="assistant"]',
  ];

  readonly loginSelectors = [
    'a[href*="signin"]',
    'a[href*="login"]',
    'a[href*="/auth"]',
  ];

  readonly loginTextPatterns = ['Sign in', '\u767b\u554e', 'Log in'];

  private isVisible(el: Element | null): boolean {
    if (!el || !(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.01;
  }

  /** Find input with debug logging and deep fallback scan */
  private findInput(): HTMLElement | null {
    // 1. Try each selector in order (custom first via effectiveInputSelectors)
    for (const s of this.effectiveInputSelectors) {
      const el = [...document.querySelectorAll(s)].find((e) => this.isVisible(e)) as HTMLElement | undefined;
      if (el) {
        console.log('[Gemini:adapter] Input found: selector="' + s + '", tag=' + el.tagName + ', class=' + el.className.slice(0, 60));
        return el;
      }
    }

    // 2. Deep fallback: scan ALL contenteditable elements regardless of selector
    const allCe = [...document.querySelectorAll('[contenteditable="true"]')] as HTMLElement[];
    const visibleCe = allCe.filter((e) => this.isVisible(e));
    if (visibleCe.length > 0) {
      const pick = visibleCe[0];
      console.log('[Gemini:adapter] Fallback found contenteditable: tag=' + pick.tagName + ', class=' + pick.className.slice(0, 60) + ', total=' + visibleCe.length);
      return pick;
    }

    // 3. Final fallback: scan all textareas
    const allTa = [...document.querySelectorAll('textarea')] as HTMLTextAreaElement[];
    const visibleTa = allTa.filter((e) => this.isVisible(e));
    if (visibleTa.length > 0) {
      console.log('[Gemini:adapter] Fallback found textarea: total=' + visibleTa.length);
      return visibleTa[0];
    }

    // 4. All failed - output page diagnostics
    console.warn('[Gemini:adapter] No input found. Page stats:');
    console.warn('  contenteditable total: ' + allCe.length + ', visible: ' + visibleCe.length);
    console.warn('  textarea total: ' + allTa.length + ', visible: ' + visibleTa.length);
    allCe.forEach((e, i) => {
      console.warn('  ce[' + i + ']: tag=' + e.tagName + ', class=' + e.className.slice(0, 80) + ', visible=' + this.isVisible(e) + ', size=' + e.getBoundingClientRect().width + 'x' + e.getBoundingClientRect().height);
    });
    allTa.forEach((e, i) => {
      console.warn('  ta[' + i + ']: aria-label=' + e.getAttribute('aria-label') + ', visible=' + this.isVisible(e));
    });

    return null;
  }

  private fireEnter(el: HTMLElement): void {
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true, isComposing: false } as KeyboardEventInit;
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keypress', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  private lastPrompt = '';
  private preSendLen = 0;

  override async waitForReady(timeoutMs?: number): Promise<void> {
    const timeout = timeoutMs ?? this.getElementTimeout();
    const start = Date.now();
    const pollInterval = 400;

    // Use own findInput with visibility check instead of base class waitForElement
    while (Date.now() - start < timeout) {
      const el = this.findInput();
      if (el) {
        console.log('[Gemini:adapter] Page ready in ' + (Date.now() - start) + 'ms');
        // Extra wait for page stability
        await sleep(1500);
        return;
      }
      await sleep(pollInterval);
    }

    throw new Error('Gemini input location timeout (' + timeout + 'ms). Make sure gemini.google.com is open and fully loaded');
  }

  private readBack(el: HTMLElement): string {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return (el.value || '').trim();
    return ((el as HTMLElement).innerText || el.textContent || '').trim();
  }

  private writeOk(el: HTMLElement, prompt: string): boolean {
    const got = this.readBack(el);
    const head = prompt.replace(/\s/g, '').slice(0, 8);
    return got.replace(/\s/g, '').includes(head) || got.length >= Math.max(4, Math.floor(prompt.length * 0.8));
  }

  override async setPrompt(prompt: string): Promise<void> {
    this.lastPrompt = prompt;
    this.preSendLen = pageText().length;

    const el = this.findInput();
    if (!el) throw new SubmitFailedError(this.provider, 'No visible input found');

    el.focus();
    await sleep(80);

    // Clear old content (common residue on retry)
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc?.set?.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      el.textContent = '';
      try { document.execCommand('selectAll', false); document.execCommand('delete', false); } catch { /* noop */ }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    }
    await sleep(80);

    // Write new content
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc?.set?.call(el, prompt);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      try {
        document.execCommand('insertText', false, prompt);
      } catch {
        el.textContent = prompt;
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt, inputType: 'insertText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt, inputType: 'insertText' }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', bubbles: true }));
    el.blur();
    el.focus();
    await sleep(300);

    if (!this.writeOk(el, prompt)) {
      console.warn('[Gemini:adapter] setPrompt readback not confirmed, continuing with submit');
    }
  }

  override async submit(): Promise<void> {
    await sleep(250);

    // If input is empty, rewrite once
    const input = this.findInput();
    if (input && this.readBack(input).length < 2) {
      await this.setPrompt(this.lastPrompt);
    }

    // Try to find send button (including disabled, since Gemini briefly disables it)
    const findBtn = (): HTMLButtonElement | null => {
      // 1. By selector list (custom first via effectiveSubmitSelectors)
      for (const s of this.effectiveSubmitSelectors) {
        const el = [...document.querySelectorAll(s)].find((e) => this.isVisible(e)) as HTMLButtonElement | undefined;
        if (el) {
          console.log('[Gemini:adapter] Send btn found: selector="' + s + '", label=' + el.getAttribute('aria-label'));
          return el;
        }
      }

      // 2. Full button scan
      const allBtns = [...document.querySelectorAll('button')] as HTMLButtonElement[];
      const keywords = ['send', '\u53d1\u9001', 'submit', '\u63d0\u4ea4'];
      for (const b of allBtns) {
        if (!this.isVisible(b)) continue;
        const label = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase();
        if (keywords.some((k) => label.includes(k))) {
          console.log('[Gemini:adapter] Send btn(scan): label="' + b.getAttribute('aria-label') + '", text="' + (b.textContent || '').trim().slice(0, 30) + '"');
          return b;
        }
      }

      console.warn('[Gemini:adapter] No send btn found, ' + allBtns.filter((b) => this.isVisible(b)).length + ' visible buttons on page');
      return null;
    };

    const tryClick = (btn: HTMLButtonElement): void => {
      const was = btn.disabled;
      btn.disabled = false;
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      btn.click();
      btn.disabled = was;
    };

    const btn = findBtn();
    if (btn) {
      tryClick(btn);
      // Gemini sometimes ignores first click; verify and retry if needed
      await sleep(900);
      const stillThere = input && this.readBack(input).length >= 2;
      const responded = pageText().length > this.preSendLen + 24;
      if (stillThere && !responded) {
        console.warn('[Gemini:adapter] First click had no effect, retrying');
        await this.setPrompt(this.lastPrompt);
        const btn2 = findBtn();
        if (btn2) tryClick(btn2);
        else if (input) this.fireEnter(input);
      }
      return;
    }

    if (input) {
      input.focus();
      this.fireEnter(input);
      return;
    }

    throw new SubmitFailedError(this.provider, 'No available send button and no input found');
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
      if (!started && text.length > gateLen + 12) { started = true; }
      const extracted = started ? extractAnswer(text, prompt) : { text: '', method: 'none' };
      const real = extracted.text;
      const isPlaceholder = !real || STREAM_CONFIG.PLACEHOLDER_RE.test(real);
      const body = isPlaceholder ? '' : real;
      const show = body || (started ? STREAM_CONFIG.THINKING_PLACEHOLDER : '');
      if (show && show !== lastSent && now - lastEmit >= STREAM_CONFIG.STREAM_THROTTLE_MS) { lastSent = show; lastEmit = now; onUpdate(show); }
      if (body) { if (body !== lastReal) { lastReal = body; stableSince = now; } } else { lastReal = ''; stableSince = 0; }
      const hasProgress = /(\u601d\u8003\u4e2d|\u641c\u7d22\u4e2d|\u8054\u7f51\u641c\u7d22\u4e2d|\u751f\u6210\u4e2d|\u6b63\u5728\u641c\u7d22|\u6b63\u5728\u601d\u8003|\u6b57\u5728\u9605\u8bfb|\u6b57\u5728\u8054\u7f51|Searching(?! for)|Reading\s+\d)/i.test(body);
      const elapsed = body ? now - stableSince : 0;
      const need = hasProgress ? STREAM_CONFIG.SOFT_STABLE : STREAM_CONFIG.HARD_STABLE;
      const done = !!body && body === lastReal && (elapsed >= need || elapsed >= STREAM_CONFIG.ABS_CAP);
      if (done) {
        stopped = true;
        const final = extractAnswer(pageText(), prompt).text || body;
        onUpdate(final); onDone(final); cleanup();
        return;
      }
      if (now - t0 >= maxWait) {
        stopped = true; cleanup();
        const final = extractAnswer(pageText(), prompt).text;
        if (final && !STREAM_CONFIG.PLACEHOLDER_RE.test(final)) { onDone(final); }
        else { onError(new Error('StreamTimeoutError')); }
      }
    };

    const mo = new MutationObserver(() => { if (!stopped) tick(); });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    const poll = window.setInterval(tick, STREAM_CONFIG.POLL_MS);
    function cleanup() { mo.disconnect(); clearInterval(poll); }
    tick(); return cleanup;
  }
}
