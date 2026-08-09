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
   * New Gemini (2025-2026) uses Quill-rich-editor.
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
    // -- New Gemini submit button (arrow icon) --
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

    // -- Icon-only buttons near input (common in new Gemini) --
    'button[aria-label*="arrow" i]',
    'button[aria-label*="\u2192" i]',
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

  /** Simulate pressing Enter on element */
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

    while (Date.now() - start < timeout) {
      const el = this.findInput();
      if (el) {
        console.log('[Gemini:adapter] Page ready in ' + (Date.now() - start) + 'ms');
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

  /**
   * Write text into a Quill/ProseMirror-rich-contenteditable.
   * Key insight: modern frameworks (React/Angular) listen for specific event patterns.
   * We try multiple strategies in order of reliability.
   */
  private writeRichText(el: HTMLElement, text: string): void {
    // Strategy 1: execCommand('insertText') — works for most contenteditable including Quill
    el.focus();
    try {
      // Select all existing content first
      document.execCommand('selectAll', false, undefined);
      document.execCommand('delete', false, undefined);
    } catch { /* some contexts block execCommand */ }

    // Try insertText via execCommand (most reliable for Quill)
    let inserted = false;
    try {
      document.execCommand('insertText', false, text);
      inserted = true;
      console.log('[Gemini:adapter] writeRichText: execCommand insertText succeeded');
    } catch {
      console.warn('[Gemini:adapter] writeRichText: execCommand insertText failed, trying fallback');
    }

    if (!inserted) {
      // Strategy 2: Direct textContent + InputEvent
      el.textContent = text;
    }

    // Dispatch comprehensive events to notify frameworks
    const inputEvent = new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      composed: true,
      data: text,
      inputType: 'insertText',
    });
    el.dispatchEvent(inputEvent);
    el.dispatchEvent(new Event('change', { bubbles: true }));

    // Strategy 3: Also try setting innerHTML for Quill (Quill stores content in innerHTML)
    const qlEditor = el.closest('.ql-editor') || el.classList.contains('ql-editor') ? el : null;
    if (qlEditor && !inserted) {
      try {
        qlEditor.innerHTML = '<p>' + text.replace(/\n/g, '</p><p>') + '</p>';
        el.dispatchEvent(inputEvent);
        console.log('[Gemini:adapter] writeRichText: Quill innerHTML fallback applied');
      } catch { /* noop */ }
    }
  }

  override async setPrompt(prompt: string): Promise<void> {
    this.lastPrompt = prompt;
    this.preSendLen = pageText().length;

    const el = this.findInput();
    if (!el) throw new SubmitFailedError(this.provider, 'No visible input found');

    console.log('[Gemini:adapter] setPrompt: writing "' + prompt.slice(0, 40) + '" to', el.tagName, el.className.slice(0, 40));

    // Use rich-text writer for contenteditable elements
    if (el.getAttribute('contenteditable') === 'true' || el.isContentEditable) {
      this.writeRichText(el, prompt);
    } else if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      // Standard form input
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc?.set?.call(el, prompt);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // Unknown element type — try rich text approach
      this.writeRichText(el, prompt);
    }

    await sleep(300);

    // Verify and report
    const got = this.readBack(el);
    if (this.writeOk(el, prompt)) {
      console.log('[Gemini:adapter] setPrompt: OK (readback=' + got.slice(0, 30) + ')');
    } else {
      console.warn('[Gemini:adapter] setPrompt: readback not confirmed (got="' + got.slice(0, 30) + '"), will still attempt submit');
    }
  }

  override async submit(): Promise<void> {
    await sleep(300);

    // Re-check input has content; if empty, retry write
    const input = this.findInput();
    if (input && this.readBack(input).length < 2) {
      console.warn('[Gemini:adapter] submit: input appears empty, re-writing prompt');
      await this.setPrompt(this.lastPrompt);
    }

    // Find send button with detailed logging
    const findBtn = (): HTMLButtonElement | null => {
      // 1. By selector list (custom first via effectiveSubmitSelectors)
      for (const s of this.effectiveSubmitSelectors) {
        const matches = [...document.querySelectorAll(s)] as HTMLElement[];
        const visible = matches.filter((e) => this.isVisible(e));
        if (visible.length > 0) {
          const btn = visible[0] as HTMLButtonElement;
          console.log('[Gemini:adapter] Send btn found: selector="' + s + '", label=' + btn.getAttribute('aria-label') + ', disabled=' + btn.disabled + ', visibleBtns=' + visible.length);
          return btn;
        }
      }

      // 2. Full button scan with keyword matching
      const allBtns = [...document.querySelectorAll('button')] as HTMLButtonElement[];
      const visibleBtns = allBtns.filter((b) => this.isVisible(b));
      const keywords = ['send', '\u53d1\u9001', 'submit', '\u63d0\u4ea4', 'arrow', '\u2192'];
      for (const b of visibleBtns) {
        const label = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase();
        const title = (b.getAttribute('title') || '').toLowerCase();
        const combined = label + ' ' + title;
        if (keywords.some((k) => combined.includes(k))) {
          console.log('[Gemini:adapter] Send btn(scan): label="' + b.getAttribute('aria-label') + '", title="' + b.getAttribute('title') + '", text="' + (b.textContent || '').trim().slice(0, 20) + '"');
          return b;
        }
      }

      // 3. Log all visible buttons for debugging
      console.warn('[Gemini:adapter] No send btn found. Visible buttons (' + visibleBtns.length + '):');
      visibleBtns.forEach((b, i) => {
        console.warn('  btn[' + i + ']: aria-label="' + b.getAttribute('aria-label') + '", title="' + b.getAttribute('title') + '", disabled=' + b.disabled + ', text="' + (b.textContent || '').trim().slice(0, 20) + '", class=' + b.className.slice(0, 40));
      });

      return null;
    };

    // Aggressive click simulation that handles disabled buttons
    const tryClick = (btn: HTMLButtonElement): void => {
      const wasDisabled = btn.disabled;

      // Force-enable if disabled (framework may disable until it detects input)
      if (wasDisabled) {
        console.warn('[Gemini:adapter] Force-enabling disabled submit button');
        btn.disabled = false;
        btn.removeAttribute('disabled');
        btn.removeAttribute('aria-disabled');
      }

      // Full pointer/mouse event sequence
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true }));
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, composed: true }));
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      // Restore disabled state after a tick
      if (wasDisabled) {
        setTimeout(() => { btn.disabled = true; }, 100);
      }

      console.log('[Gemini:adapter] Clicked submit button (wasDisabled=' + wasDisabled + ')');
    };

    const btn = findBtn();
    if (btn) {
      tryClick(btn);

      // Wait and verify response
      await sleep(1200);
      const inputStillHasText = input && this.readBack(input).length >= 2;
      const pageChanged = pageText().length > this.preSendLen + 24;

      if (inputStillHasText && !pageChanged) {
        console.warn('[Gemini:adapter] First click had no visible effect, retrying...');
        // Re-write prompt (in case first click cleared it)
        await this.setPrompt(this.lastPrompt);
        await sleep(200);
        const btn2 = findBtn();
        if (btn2) {
          tryClick(btn2);
        } else if (input) {
          console.warn('[Gemini:adapter] Button disappeared, trying Enter key');
          input.focus();
          this.fireEnter(input);
        }
      } else {
        console.log('[Gemini:adapter] Submit appears successful (pageChanged=' + pageChanged + ')');
      }
      return;
    }

    // No button found — try Enter key as last resort
    if (input) {
      console.warn('[Gemini:adapter] No submit button, attempting Enter key submission');
      input.focus();
      await sleep(100);
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
      const hasProgress = /(\u601d\u8003\u4e2d|\u641c\u7d22\u4e2d|\u8054\u7f51\u641c\u7d22\u4e2d|\u751f\u6210\u4e2d|\u6b63\u5728\u641c\u7d22|\u6b63\u5728\u601d\u8003|\u6b57\u5728\u9608\u8bfb|\u6b57\u5728\u8054\u7f51|Searching(?! for)|Reading\s+\d)/i.test(body);
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
