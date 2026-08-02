import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';
import { SubmitFailedError, sleep } from '../../shared/utils';
import { extractAnswer } from '../../shared/grab';

const STREAM_CONFIG = {
  HARD_STABLE: 2200,
  SOFT_STABLE: 6000,
  ABS_CAP: 9000,
  THINKING_PLACEHOLDER: '⏳ 思考 / 联网检索中…',
  STREAM_THROTTLE_MS: 250,
  POLL_MS: 400,
  PLACEHOLDER_RE: /^[.…·••\s…\u2026\u00b7]*$/,
};

function pageText(): string {
  return (document.body.innerText || document.body.textContent || '').replace(/\u00a0/g, ' ');
}

export class GeminiAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'gemini';

  readonly inputSelectors = [
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][aria-label*="prompt"]',
    'div[contenteditable="true"][aria-label*="输入"]',
    'textarea[aria-label*="prompt"]',
    'textarea[aria-label*="输入"]',
    'div[contenteditable="true"].ql-editor',
    'textarea',
    'div[contenteditable="true"]',
  ];

  readonly submitSelectors = [
    'button[aria-label="Send message"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
    'button[aria-label*="send"]',
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

  readonly loginTextPatterns = ['Sign in', '登录', 'Log in'];

  private isVisible(el: Element | null): boolean {
    if (!el || !(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.01;
  }

  private findInput(): HTMLElement | null {
    for (const s of this.inputSelectors) {
      const el = [...document.querySelectorAll(s)].find((e) => this.isVisible(e)) as HTMLElement | undefined;
      if (el) return el;
    }
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
    await super.waitForReady(timeoutMs);
    await sleep(1500);
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
    if (!el) throw new SubmitFailedError(this.provider, '找不到可见输入框');

    el.focus();
    await sleep(80);

    // 先清空旧内容（第二轮常见残留）
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

    // 写入新内容
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
      console.warn('[Gemini:adapter] setPrompt 回读未确认，继续尝试 submit');
    }
  }

  override async submit(): Promise<void> {
    await sleep(200);

    // 如果输入框为空，重写一次
    const input = this.findInput();
    if (input && this.readBack(input).length < 2) {
      await this.setPrompt(this.lastPrompt);
    }

    // 尝试找发送按钮（包括 disabled，因为 Gemini 有时会短暂禁用）
    const findBtn = (): HTMLButtonElement | null => {
      for (const s of this.submitSelectors) {
        const el = [...document.querySelectorAll(s)].find((e) => this.isVisible(e)) as HTMLButtonElement | undefined;
        if (el) return el;
      }
      return null;
    };

    const btn = findBtn();
    if (btn) {
      const was = btn.disabled;
      btn.disabled = false;
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      btn.click();
      btn.disabled = was;
      return;
    }

    if (input) {
      input.focus();
      this.fireEnter(input);
      return;
    }

    throw new SubmitFailedError(this.provider, '无可用发送按钮且找不到输入框');
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
      const hasProgress = /(思考中|搜索中|联网搜索中|生成中|正在搜索|正在思考|正在阅读|正在联网|Searching(?! for)|Reading\s+\d)/i.test(body);
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
