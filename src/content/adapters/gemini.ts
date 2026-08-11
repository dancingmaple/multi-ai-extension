import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';
import { SubmitFailedError, sleep } from '../../shared/utils';
import { extractAnswer } from '../../shared/grab';
import { observeDocumentThrottled } from '../dom/observer';
import { PLACEHOLDER_RE } from '../../shared/constants';
import { createLogger } from '../../shared/debug';

const gLog = createLogger('[Gemini:adapter]');

const STREAM_CONFIG = {
  HARD_STABLE: 2200,
  SOFT_STABLE: 6000,
  ABS_CAP: 90000,
  THINKING_PLACEHOLDER: '\u23f3 \u601d\u8003 / \u8054\u7f51\u68c0\u7d22\u4e2d\u2026',
  STREAM_THROTTLE_MS: 250,
  POLL_MS: 400,
};

function pageText(): string {
  return (document.body.innerText || document.body.textContent || '').replace(/\u00a0/g, ' ');
}

/* ── Gemini DOM 直取（优于整页剪刀法） ─────────────────────
   Gemini 是 Angular 自定义元素：每条回答一个 <model-response>，
   正文在 message-content.model-response-text > .markdown。
   之前只靠 extractAnswer(pageText) 剪刀法，一旦用户气泡文本与
   prompt 不完全逐字一致（换行/截断/富文本），定位就会失败 →
   表现为「测试台无法自动获取 gemini」。这里优先走 DOM，
   拿不到再退回剪刀法。 */
const G_ANSWER_SELECTORS = [
  'model-response',
  'message-content.model-response-text',
  '.model-response-text',
  '[class*="response-container"] message-content',
];
const G_MARKDOWN_SEL = '.markdown, [class*="markdown"], .model-response-text';
const G_NOISE_SEL = [
  'model-thoughts',
  '[class*="thought"]',
  'sources-list',
  '[class*="sources"]',
  '[class*="citation"]',
  'message-actions',
  '[class*="response-footer"]',
  'button',
].join(',');

function gAnswerEls(): Element[] {
  for (const s of G_ANSWER_SELECTORS) {
    const arr = [...document.querySelectorAll(s)];
    if (arr.length) return arr;
  }
  return [];
}

function gLastAnswerEl(): Element | null {
  const all = gAnswerEls();
  return all[all.length - 1] || null;
}

function gClean(node: Element | null): string {
  if (!node) return '';
  const clone = node.cloneNode(true) as Element;
  clone.querySelectorAll(G_NOISE_SEL).forEach((n) => n.parentNode?.removeChild(n));
  const mds = [...clone.querySelectorAll(G_MARKDOWN_SEL)];
  const src = mds.length ? mds : [clone];
  const joined = src
    .map((m) => ((m as HTMLElement).innerText || m.textContent || ''))
    .filter(Boolean)
    .join('\n\n');
  return joined.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
}

function gHasStopButton(): boolean {
  const sels = ['button[aria-label*="Stop" i]', 'button[aria-label*="\u505c\u6b62"]', '.stop-icon', '[data-test-id="stop-button"]'];
  return sels.some((s) =>
    [...document.querySelectorAll(s)].some((e) => {
      if (!(e instanceof HTMLElement)) return false;
      const r = e.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    })
  );
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
        gLog('Page ready in ' + (Date.now() - start) + 'ms');
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
        gLog('Input found: selector="' + s + '", tag=' + el.tagName + ', cls=' + String(el.className).slice(0, 60));
        return el;
      }
    }
    // Fallback: all contenteditable
    const allCe = [...document.querySelectorAll('[contenteditable="true"]')] as HTMLElement[];
    const vis = allCe.filter((e) => this.isVisible(e));
    if (vis.length) {
      gLog('Fallback CE: tag=' + vis[0].tagName + ', cls=' + String(vis[0].className).slice(0, 60));
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

    gLog('setPrompt: writing "' + prompt.slice(0, 40) + '" to ' + el.tagName + '.' + String(el.className).slice(0, 40));

    let written = false;

    // --- Method 1: Clipboard paste (most reliable for rich editors) ---
    try {
      written = await this.tryClipboardPaste(el, prompt);
      if (written) gLog('Method 1 (clipboard paste) succeeded');
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
        gLog('Method 2 (execCommand insertText) succeeded');
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
          gLog('Method 3 (Quill innerHTML) applied');
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
        gLog('Method 4 (inner p textContent) applied');
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
      gLog('setPrompt OK (readback=' + got.slice(0, 30) + ')');
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

    // NEW Gemini: the send button is NOT present in zero-state — it only appears
    // AFTER text is typed into the input. Poll for up to 5s for it to show up.
    let btn: HTMLButtonElement | null = null;
    const waitStart = Date.now();
    while (Date.now() - waitStart < 5000) {
      btn = this.findSubmitBtn(input);
      if (btn) break;
      await sleep(300);
    }
    if (!btn) {
      console.warn('[Gemini:adapter] submit: no send button appeared within 5s (zero-state?). Retrying find once...');
      btn = this.findSubmitBtn(input);
    }


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
        gLog('Submit appears successful');
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
        gLog('Submit btn by selector "' + s + '": label=' + b.getAttribute('aria-label') + ', disabled=' + b.disabled);
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

    // Strategy 4: Among ALL visible buttons, pick the one most likely to be submit.
    // NEW Gemini: zero-state has NO send button; it appears only after typing.
    // Exclude known non-submit buttons by aria-label; prefer the one closest to
    // the input's bottom-right corner (where Gemini's send arrow sits).
    const EXCLUDE_LABELS = [
      'open sidebar', 'sidebar', 'upgrade', 'temporary chat', 'settings',
      'upload', 'tools', 'mode picker', 'dictate', 'mic', 'menu', 'close',
      'cancel', 'new chat', 'share', 'history', 'profile', 'account', 'help',
      'extensions', 'gem manager', 'apps',
    ];
    const isExcluded = (b: HTMLButtonElement): boolean => {
      const label = (b.getAttribute('aria-label') || '').toLowerCase().trim();
      const cls = String(b.className).toLowerCase();
      const title = (b.getAttribute('title') || '').toLowerCase();
      const combined = label + ' ' + title;
      if (EXCLUDE_LABELS.some((k) => combined.includes(k))) return true;
      if (cls.includes('menu') || cls.includes('nav') || cls.includes('close') || cls.includes('cancel')) return true;
      return false;
    };

    let best: HTMLButtonElement | null = null;
    let bestDist = Infinity;
    const inputRect = inputEl ? inputEl.getBoundingClientRect() : null;
    const targetX = inputRect ? inputRect.right : window.innerWidth;
    const targetY = inputRect ? inputRect.bottom : window.innerHeight;

    for (const b of visBtns) {
      if (isExcluded(b)) continue;
      const r = b.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dist = Math.hypot(cx - targetX, cy - targetY);
      const hasSvg = !!b.querySelector('svg');
      const isSmallIcon = r.width <= 56 && r.height <= 56 && r.width >= 20 && r.height >= 20;
      const score = dist - (hasSvg && isSmallIcon ? 200 : 0);
      if (score < bestDist) {
        bestDist = score;
        best = b;
      }
    }

    if (best) {
      const r = best.getBoundingClientRect();
      gLog('Best-guess submit btn: aria-label="' + best.getAttribute('aria-label') + '", size=' + r.width + 'x' + r.height + ', hasSvg=' + (best.querySelector('svg') ? 'yes' : 'no') + ', dist=' + bestDist.toFixed(0));
    }
    return best;
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
          gLog('Nearby btn: label=' + b.getAttribute('aria-label') + ', disabled=' + b.disabled + ', cls=' + String(b.className).slice(0, 40));
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
            gLog('Sibling-area btn: label=' + b.getAttribute('aria-label') + ', cls=' + String(b.className).slice(0, 40));
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

    gLog('Clicked button (wasDisabled=' + wasDisabled + ', label=' + btn.getAttribute('aria-label') + ')');
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
    gLog('Pressed Enter on input');
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

    // DOM 门闩快照：进入时本轮回答必未渲染
    const snapDomText = gClean(gLastAnswerEl());
    const snapDomCount = gAnswerEls().length;
    gLog('SNAPSHOT', { domLen: snapDomText.length, domCount: snapDomCount, pageLen: gateLen });

    /** 优先 DOM 直取，拿不到再回退整页剪刀法 */
    const readAnswer = (): string => {
      const els = gAnswerEls();
      if (els.length) {
        const cur = gClean(els[els.length - 1]);
        // DOM 门闩：文本与快照相同且条数未增 → 仍是上一轮，视作空
        if (els.length > snapDomCount || cur !== snapDomText) return cur;
        return '';
      }
      const text = pageText();
      if (text.length <= gateLen + 12) return '';
      return extractAnswer(text, prompt).text;
    };

    const tick = () => {
      if (stopped) return;
      const now = Date.now();
      if (!started) {
        const grew = pageText().length > gateLen + 12;
        const domMoved = gAnswerEls().length > snapDomCount || gClean(gLastAnswerEl()) !== snapDomText;
        if (grew || domMoved) started = true;
      }
      const real = started ? readAnswer() : '';
      const isPlaceholder = !real || PLACEHOLDER_RE.test(real);
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
      const hasProgress = /(\u601d\u8003\u4e2d|\u641c\u7d22\u4e2d|\u8054\u7f51\u641c\u7d22\u4e2d|\u751f\u6210\u4e2d|\u6b63\u5728\u641c\u7d22|\u6b63\u5728\u601d\u8003|\u6b57\u5728\u9608\u8bfb|\u6b57\u5728\u8054\u7f51|Searching(?! for)|Reading\s+\d)/i.test(body) || gHasStopButton();
      const elapsed = body ? now - stableSince : 0;
      const need = hasProgress ? STREAM_CONFIG.SOFT_STABLE : STREAM_CONFIG.HARD_STABLE;
      const done = !!body && body === lastReal && (elapsed >= need || elapsed >= STREAM_CONFIG.ABS_CAP);
      if (done) {
        stopped = true;
        const final = readAnswer() || body;
        gLog('DONE finalLen=', final.length);
        onUpdate(final);
        onDone(final);
        cleanup();
        return;
      }
      if (now - t0 >= maxWait) {
        stopped = true;
        cleanup();
        const final = readAnswer() || extractAnswer(pageText(), prompt).text;
        if (final && !PLACEHOLDER_RE.test(final)) onDone(final);
        else onError(new Error('StreamTimeoutError: \u8d85\u65f6\u672a\u80fd\u6293\u53d6\u5230 Gemini \u56de\u7b54\uff0c\u8bf7\u91cd\u8bd5\u6216\u7528\u300c\u624b\u52a8\u83b7\u53d6\u300d'));
      }
    };

    // 合并节流：流式期间站点每秒数百条 mutation，逐条跑 tick 会打满 CPU（#7）
    const stopObserve = observeDocumentThrottled(() => { if (!stopped) tick(); });
    const poll = window.setInterval(tick, STREAM_CONFIG.POLL_MS);
    function cleanup() { stopObserve(); clearInterval(poll); }
    tick();
    return cleanup;
  }
}
