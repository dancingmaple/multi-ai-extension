import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';
import { SubmitFailedError, sleep } from '../../shared/utils';
import { extractAnswer } from '../../shared/grab';

const STREAM_CONFIG = {
  HARD_STABLE: 2200,
  SOFT_STABLE: 6000,
  ABS_CAP: 90000,
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

  readonly inputSelectors = [
    '.ql-editor[contenteditable="true"]',
    'div.ql-editor',
    '[contenteditable="true"].ql-editor',
    'p[contenteditable="true"]',
    'div[contenteditable="true"][aria-label*="Ask" i]',
    'div[contenteditable="true"][placeholder*="Enter" i]',
    'rich-textarea [contenteditable="true"]',
    '[class*="editor"] [contenteditable="true"]',
    'textarea[aria-label*="prompt" i]',
    'textarea[aria-label*="Ask" i]',
    'div[contenteditable="true"]',
    'textarea',
  ];

  readonly submitSelectors = [
    // New Gemini: button near input with various possible labels
    'button[aria-label*="Send" i]',
    'button[aria-label*="send" i]',
    'button[aria-label*="Submit" i]',
    'button[aria-label*="submit" i]',
    'button[aria-label*="\u53d1\u9001" i]',
    'button[aria-label*="\u63d0\u4ea4" i]',
    // Icon-only buttons (arrow, plane, etc.)
    'button[aria-label*="arrow" i]',
    'button[aria-label*="\u2192" i]',
    'button[aria-label*="plane" i]',
    // Generic: any button inside the input container area
    '.ql-toolbar button',
    '.rich-textarea button',
    'rich-textarea button',
    '[class*="textarea"] button',
    '[class*="input-field"] button',
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

  private lastPrompt = '';
  private preSendLen = 0;

  override async waitForReady(timeoutMs?: number): Promise<void> {
    const timeout = timeoutMs ?? this.getElementTimeout();
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = this.findInput();
      if (el) {
        console.log('[Gemini:adapter] Page ready in ' + (Date.now() - start) + 'ms');
        await sleep(1000);
        return;
      }
      await sleep(400);
    }
    throw new Error('Gemini input location timeout (' + timeout + 'ms)');
  }

  /** Find visible input element */
  private findInput(): HTMLElement | null {
    for (const s of this.effectiveInputSelectors) {
      const el = [...document.querySelectorAll(s)].find((e) => this.isVisible(e)) as HTMLElement | undefined;
      if (el) {
        console.log('[Gemini:adapter] Input found: selector="' + s + '", tag=' + el.tagName + ', cls=' + String(el.className).slice(0, 60));
        return el;
      }
    }
    // Fallback: all contenteditable
    const allCe = [...document.querySelectorAll('[contenteditable="true"]')] as HTMLElement[];
    const vis = allCe.filter((e) => this.isVisible(e));
    if (vis.length) {
      console.log('[Gemini:adapter] Fallback CE: tag=' + vis[0].tagName + ', cls=' + String(vis[0].className).slice(0, 60));
      return vis[0];
    }
    console.warn('[Gemini:adapter] No input found. CE total=' + allCe.length + ', visible=' + vis.length);
    return null;
  }

  /**
   * Write text into the Gemini Quill editor.
   * New Gemini (2025-2026) uses Angular + Quill; standard execCommand often fails.
   * Strategy: focus -> clear -> try multiple write methods -> verify.
   */
  override async setPrompt(prompt: string): Promise<void> {
    this.lastPrompt = prompt;
    this.preSendLen = pageText().length;

    const el = this.findInput();
    if (!el) throw new SubmitFailedError(this.provider, 'No visible input found');

    console.log('[Gemini:adapter] setPrompt: writing "' + prompt.slice(0, 40) + '" to ' + el.tagName + '.' + String(el.className).slice(0, 40));

    let written = false;

    // --- Method 1: Clipboard paste (most reliable for rich editors) ---
    try {
      written = await this.tryClipboardPaste(el, prompt);
      if (written) console.log('[Gemini:adapter] Method 1 (clipboard paste) succeeded');
    } catch (e) {
      console.warn('[Gemini:adapter] Method 1 failed:', e instanceof Error ? e.message : e);
    }

    // --- Method 2: execCommand insertText ---
    if (!written) {
      try {
        el.focus();
        document.execCommand('selectAll', false, undefined);
        document.execCommand('delete', false, undefined);
        await sleep(50);
        document.execCommand('insertText', false, prompt);
        written = true;
        console.log('[Gemini:adapter] Method 2 (execCommand insertText) succeeded');
      } catch {
        console.warn('[Gemini:adapter] Method 2 failed');
      }
    }

    // --- Method 3: Direct innerHTML on .ql-editor ---
    if (!written || !this.verifyWrite(el, prompt)) {
      const qlEditor = el.closest('.ql-editor') || (el.classList.contains('ql-editor') ? el : null);
      if (qlEditor) {
        try {
          qlEditor.innerHTML = '<p>' + prompt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '</p><p>') + '</p><p><br></p>';
          written = true;
          console.log('[Gemini:adapter] Method 3 (Quill innerHTML) applied');
        } catch {
          console.warn('[Gemini:adapter] Method 3 failed');
        }
      }
    }

    // --- Method 4: Find inner <p> and set textContent ---
    if (!written || !this.verifyWrite(el, prompt)) {
      try {
        const innerP = el.querySelector('p') || el;
        innerP.textContent = prompt;
        written = true;
        console.log('[Gemini:adapter] Method 4 (inner p textContent) applied');
      } catch {
        console.warn('[Gemini:adapter] Method 4 failed');
      }
    }

    // Dispatch framework notification events
    this.dispatchInputEvents(el);

    await sleep(300);

    // Verify
    const got = this.readBack(el);
    if (this.verifyWrite(el, prompt)) {
      console.log('[Gemini:adapter] setPrompt OK (readback=' + got.slice(0, 30) + ')');
    } else {
      console.warn('[Gemini:adapter] setPrompt readback FAILED (got="' + got.slice(0, 30) + '")');
    }
  }

  /** Try clipboard-based paste into element */
  private async tryClipboardPaste(el: HTMLElement, text: string): Promise<boolean> {
    el.focus();
    await sleep(100);

    // Select all then delete
    try {
      document.execCommand('selectAll', false, undefined);
      document.execCommand('delete', false, undefined);
    } catch { /* noop */ }

    await sleep(50);

    // Use clipboard API
    try {
      await navigator.clipboard.writeText(text);
      document.execCommand('paste', false, undefined);
      return true;
    } catch {
      // Clipboard API may not work in all contexts (iframe, permission)
      console.warn('[Gemini:adapter] clipboard paste not available');
      return false;
    }
  }

  /** Dispatch comprehensive input events for framework detection */
  private dispatchInputEvents(el: HTMLElement): void {
    const evt = new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      composed: true,
      data: '',
      inputType: 'insertText',
    });
    el.dispatchEvent(evt);

    // Also dispatch on parent containers (Angular may listen there)
    let parent = el.parentElement;
    for (let i = 0; i < 3 && parent; i++) {
      parent.dispatchEvent(new Event('input', { bubbles: true }));
      parent = parent.parentElement;
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private readBack(el: HTMLElement): string {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return (el.value || '').trim();
    return ((el as HTMLElement).innerText || el.textContent || '').trim();
  }

  private verifyWrite(el: HTMLElement, expected: string): boolean {
    const got = this.readBack(el);
    const head = expected.replace(/\s/g, '').slice(0, 8);
    return got.replace(/\s/g, '').includes(head) || got.length >= Math.max(4, Math.floor(expected.length * 0.8));
  }

  /**
   * Find the submit/send button.
   * Key insight from diagnostic: new Gemini has VERY few visible buttons.
   * The real send button is likely an icon-only button near the input area.
   */
  override async submit(): Promise<void> {
    await sleep(300);

    // Re-check input has content
    const input = this.findInput();
    if (input && this.readBack(input).length < 2) {
      console.warn('[Gemini:adapter] submit: input empty, re-writing...');
      await this.setPrompt(this.lastPrompt);
      await sleep(200);
    }

    const btn = this.findSubmitBtn(input);

    if (btn) {
      this.clickButton(btn);

      // Wait and verify
      await sleep(1500);
      const pageChanged = pageText().length > this.preSendLen + 20;

      if (!pageChanged && input && this.readBack(input).length >= 2) {
        console.warn('[Gemini:adapter] First click had no effect, retrying...');
        await this.setPrompt(this.lastPrompt);
        await sleep(200);
        const btn2 = this.findSubmitBtn(input);
        if (btn2) {
          this.clickButton(btn2);
        } else {
          // Try Enter key
          this.pressEnter(input);
        }
      } else {
        console.log('[Gemini:adapter] Submit appears successful');
      }
      return;
    }

    // No button — try Enter key
    if (input) {
      console.warn('[Gemini:adapter] No submit button, trying Enter key');
      this.pressEnter(input);
      return;
    }

    throw new SubmitFailedError(this.provider, 'No available submit method');
  }

  /**
   * Core submit button finder with proximity search.
   * After writing text, look for buttons NEAR the input element.
   */
  private findSubmitBtn(inputEl: HTMLElement | null): HTMLButtonElement | null {
    // Strategy 1: Standard selectors (custom first via effectiveSubmitSelectors)
    for (const s of this.effectiveSubmitSelectors) {
      const matches = [...document.querySelectorAll(s)] as HTMLElement[];
      const vis = matches.filter((e) => this.isVisible(e));
      if (vis.length > 0) {
        const b = vis[0] as HTMLButtonElement;
        console.log('[Gemini:adapter] Submit btn by selector "' + s + '": label=' + b.getAttribute('aria-label') + ', disabled=' + b.disabled);
        return b;
      }
    }

    // Strategy 2: Proximity search — buttons near the input element
    if (inputEl) {
      const nearbyBtn = this.findNearbyButton(inputEl);
      if (nearbyBtn) return nearbyBtn;
    }

    // Strategy 3: Full scan — log ALL visible buttons for debugging
    const allBtns = [...document.querySelectorAll('button')] as HTMLButtonElement[];
    const visBtns = allBtns.filter((b) => this.isVisible(b));

    console.warn('[Gemini:adapter] No submit btn by selector. Visible buttons (' + visBtns.length + '):');
    visBtns.forEach((b, i) => {
      console.warn('  btn[' + i + ']: aria-label="' + b.getAttribute('aria-label') + '", title="' + b.getAttribute('title') + '", disabled=' + b.disabled + ', text="' + (b.textContent || '').trim().slice(0, 20) + '", cls=' + String(b.className).slice(0, 50) + ', svg=' + (b.querySelector('svg') ? 'yes' : 'no'));
    });

    // Strategy 4: Among ALL visible buttons, pick the one most likely to be submit
    // Heuristic: small square button (icon), near bottom-right of viewport, with SVG
    for (const b of visBtns) {
      const r = b.getBoundingClientRect();
      const hasSvg = !!b.querySelector('svg');
      const cls = String(b.className).toLowerCase();
      const label = (b.getAttribute('aria-label') || '').toLowerCase();

      // Skip obviously non-submit buttons (navigation, menu, etc.)
      if (cls.includes('menu') || cls.includes('nav') || cls.includes('close') || cls.includes('cancel')) continue;
      if (label.includes('cancel') || label.includes('close') || label.includes('menu')) continue;

      // Prefer small icon buttons (likely action buttons)
      if (hasSvg && r.width <= 48 && r.height <= 48 && r.width >= 24 && r.height >= 24) {
        console.log('[Gemini:adapter] Best guess submit btn: cls=' + cls.slice(0, 40) + ', size=' + r.width + 'x' + r.height + ', hasSvg=yes');
        return b;
      }
    }

    return null;
  }

  /** Find buttons that are DOM-nearby the input element (siblings, parent siblings, etc.) */
  private findNearbyButton(inputEl: HTMLElement): HTMLButtonElement | null {
    // Check same container / adjacent elements
    const container = inputEl.closest('.ql-container') || inputEl.closest('.rich-textarea') ||
                      inputEl.closest('[class*="textarea"]') || inputEl.closest('[class*="input"]') ||
                      inputEl.parentElement?.parentElement || inputEl.parentElement;

    if (container) {
      const btns = container.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
      for (const b of btns) {
        if (this.isVisible(b)) {
          console.log('[Gemini:adapter] Nearby btn: label=' + b.getAttribute('aria-label') + ', disabled=' + b.disabled + ', cls=' + String(b.className).slice(0, 40));
          return b;
        }
      }
    }

    // Check parent's siblings (toolbar, action bar, etc.)
    let parent = inputEl.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      const sibling = parent.nextElementSibling || parent.previousElementSibling;
      if (sibling) {
        const btns = sibling.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
        for (const b of btns) {
          if (this.isVisible(b)) {
            console.log('[Gemini:adapter] Sibling-area btn: label=' + b.getAttribute('aria-label') + ', cls=' + String(b.className).slice(0, 40));
            return b;
          }
        }
      }
      parent = parent.parentElement;
    }

    return null;
  }

  /** Click a button with full event simulation + force-enable if needed */
  private clickButton(btn: HTMLButtonElement): void {
    const wasDisabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';

    if (wasDisabled) {
      console.warn('[Gemini:adapter] Force-enabling disabled button');
      btn.disabled = false;
      btn.removeAttribute('disabled');
      btn.removeAttribute('aria-disabled');
    }

    // Full event sequence
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true }));
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, composed: true }));
    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    console.log('[Gemini:adapter] Clicked button (wasDisabled=' + wasDisabled + ', label=' + btn.getAttribute('aria-label') + ')');
  }

  /** Press Enter key on element */
  private pressEnter(el: HTMLElement): void {
    el.focus();
    const init: KeyboardEventInit = {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true, composed: true, isComposing: false,
    };
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keypress', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
    console.log('[Gemini:adapter] Pressed Enter on input');
  }

  override startStreaming(
    onUpdate: (text: string) => void,
    onDone: (finalText: string) => void,
    onError: (err: Error) => void,
  ): () => void {
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
      if (!started && text.length > gateLen + 12) started = true;
      const extracted = started ? extractAnswer(text, prompt) : { text: '', method: 'none' };
      const real = extracted.text;
      const isPlaceholder = !real || STREAM_CONFIG.PLACEHOLDER_RE.test(real);
      const body = isPlaceholder ? '' : real;
      const show = body || (started ? STREAM_CONFIG.THINKING_PLACEHOLDER : '');
      if (show && show !== lastSent && now - lastEmit >= STREAM_CONFIG.STREAM_THROTTLE_MS) {
        lastSent = show;
        lastEmit = now;
        onUpdate(show);
      }
      if (body) {
        if (body !== lastReal) { lastReal = body; stableSince = now; }
      } else {
        lastReal = '';
        stableSince = 0;
      }
      const hasProgress = /(\u601d\u8003\u4e2d|\u641c\u7d22\u4e2d|\u8054\u7f51\u641c\u7d22\u4e2d|\u751f\u6210\u4e2d|\u6b63\u5728\u641c\u7d22|\u6b63\u5728\u601d\u8003|\u6b57\u5728\u9608\u8bfb|\u6b57\u5728\u8054\u7f51|Searching(?! for)|Reading\s+\d)/i.test(body);
      const elapsed = body ? now - stableSince : 0;
      const need = hasProgress ? STREAM_CONFIG.SOFT_STABLE : STREAM_CONFIG.HARD_STABLE;
      const done = !!body && body === lastReal && (elapsed >= need || elapsed >= STREAM_CONFIG.ABS_CAP);
      if (done) {
        stopped = true;
        const final = extractAnswer(pageText(), prompt).text || body;
        onUpdate(final);
        onDone(final);
        cleanup();
        return;
      }
      if (now - t0 >= maxWait) {
        stopped = true;
        cleanup();
        const final = extractAnswer(pageText(), prompt).text;
        if (final && !STREAM_CONFIG.PLACEHOLDER_RE.test(final)) onDone(final);
        else onError(new Error('StreamTimeoutError'));
      }
    };

    const mo = new MutationObserver(() => { if (!stopped) tick(); });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    const poll = window.setInterval(tick, STREAM_CONFIG.POLL_MS);
    function cleanup() { mo.disconnect(); clearInterval(poll); }
    tick();
    return cleanup;
  }
}
