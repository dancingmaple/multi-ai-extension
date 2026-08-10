import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';
import { SubmitFailedError, sleep } from '../../shared/utils';

/* ============================================================
   通用自定义站点适配器
   ────────────────────────────────────────────────────────────
   用户在测试台录入任意 AI 网页，手动点选「输入框 / 发送按钮 / 回答区域」
   三个元素后，就用这个适配器驱动：
     · 写入用 textarea/input 原生 setter 或 contenteditable execCommand
     · 发送优先点按钮，其次回车
     · 抓取用「提交快照门闩 + 末条回答元素 + 静止阈值」（与 DeepSeek 同范式）
   点选到的选择器通过 setCustomSelectors 注入，永远排在内置兜底选择器之前。
   ============================================================ */

const CFG = {
  HARD_STABLE: 2500,
  SOFT_STABLE: 6000,
  ABS_CAP: 15000,
  STREAM_THROTTLE_MS: 250,
  POLL_MS: 400,
  PLACEHOLDER_RE: /^[.\u2026\u00b7\u2022\s]*$/,
  THINKING_PLACEHOLDER: '\u23f3 \u7b49\u5f85\u56de\u7b54\u4e2d\u2026',
};

const FALLBACK_INPUT = [
  'textarea',
  'div[contenteditable="true"]',
  '[role="textbox"]',
  'input[type="text"]',
];
const FALLBACK_SUBMIT = [
  'button[type="submit"]',
  'button[aria-label*="Send" i]',
  'button[aria-label*="\u53d1\u9001"]',
  'button[data-testid*="send" i]',
];
const FALLBACK_RESPONSE = [
  '[class*="markdown"]',
  '[class*="assistant"]',
  '[class*="message"]',
  'main',
];

function vis(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.01;
}

function textOf(el: Element | null): string {
  if (!el) return '';
  const t = (el instanceof HTMLElement ? el.innerText : el.textContent) || '';
  return t.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
}

export class CustomAdapter extends BaseAdapter {
  readonly provider: ProviderName;
  readonly inputSelectors: string[];
  readonly submitSelectors: string[];
  readonly responseSelectors: string[];
  readonly loginSelectors: string[] = [];

  constructor(provider: ProviderName, sel?: { input?: string; submit?: string; response?: string }) {
    super();
    this.provider = provider;
    this.inputSelectors = sel?.input ? [sel.input, ...FALLBACK_INPUT] : [...FALLBACK_INPUT];
    this.submitSelectors = sel?.submit ? [sel.submit, ...FALLBACK_SUBMIT] : [...FALLBACK_SUBMIT];
    this.responseSelectors = sel?.response ? [sel.response, ...FALLBACK_RESPONSE] : [...FALLBACK_RESPONSE];
  }

  private queryAll(selectors: string[]): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const s of selectors) {
      if (!s) continue;
      try {
        document.querySelectorAll(s).forEach((e) => {
          if (e instanceof HTMLElement) out.push(e);
        });
      } catch {
        /* 用户点选出的选择器可能非法，跳过 */
      }
      if (out.length) break;
    }
    return out;
  }

  private findInput(): HTMLElement | null {
    return this.queryAll(this.effectiveInputSelectors).find(vis) ?? null;
  }

  private findSubmit(): HTMLElement | null {
    return (
      this.queryAll(this.effectiveSubmitSelectors).find(
        (e) => vis(e) && !(e as HTMLButtonElement).disabled
      ) ?? null
    );
  }

  /** 末条回答元素（回答区域选择器可能匹配多条历史消息，永远取最后一条） */
  private lastResponse(): HTMLElement | null {
    const all = this.queryAll(this.effectiveResponseSelectors).filter(vis);
    return all[all.length - 1] ?? null;
  }

  private responseCount(): number {
    return this.queryAll(this.effectiveResponseSelectors).filter(vis).length;
  }

  override async waitForReady(timeoutMs?: number): Promise<void> {
    const timeout = timeoutMs ?? this.getElementTimeout();
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (this.findInput()) return;
      await sleep(300);
    }
    throw new Error('自定义站点：等待输入框超时（' + timeout + 'ms），请重新点选输入框');
  }

  override detectLoginRequired(): boolean {
    // 自定义站点无法可靠判断登录态，交给用户自己保证已登录
    return false;
  }

  override async setPrompt(prompt: string): Promise<void> {
    const el = this.findInput();
    if (!el) throw new SubmitFailedError(this.provider, '找不到可见输入框（请重新点选）');

    el.focus();
    await sleep(80);

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc?.set?.call(el, prompt);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      try {
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, prompt);
      } catch {
        el.textContent = prompt;
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt, inputType: 'insertText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', bubbles: true }));
    await sleep(200);
  }

  override async submit(): Promise<void> {
    await sleep(150);
    const btn = this.findSubmit();
    if (btn) {
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      btn.click();
      return;
    }
    const input = this.findInput();
    if (input) {
      input.focus();
      const init = {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true, composed: true, isComposing: false,
      } as KeyboardEventInit;
      input.dispatchEvent(new KeyboardEvent('keydown', init));
      input.dispatchEvent(new KeyboardEvent('keypress', init));
      input.dispatchEvent(new KeyboardEvent('keyup', init));
      return;
    }
    throw new SubmitFailedError(this.provider, '无发送按钮且找不到输入框（请重新点选）');
  }

  override startStreaming(
    onUpdate: (text: string) => void,
    onDone: (finalText: string) => void,
    onError: (err: Error) => void
  ): () => void {
    let stopped = false;

    const snapText = textOf(this.lastResponse());
    const snapCount = this.responseCount();
    console.log('[Custom:adapter] SNAPSHOT', this.provider, { len: snapText.length, count: snapCount });

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
      const cur = textOf(this.lastResponse());
      const count = this.responseCount();

      if (!started && (cur !== snapText || count > snapCount)) started = true;

      const raw = started ? cur : '';
      const real = !raw || CFG.PLACEHOLDER_RE.test(raw) ? '' : raw;

      const show = real || CFG.THINKING_PLACEHOLDER;
      if (show !== lastSent && now - lastEmit >= CFG.STREAM_THROTTLE_MS) {
        lastSent = show;
        lastEmit = now;
        onUpdate(show);
      }

      if (real) {
        if (real !== lastReal) { lastReal = real; stableSince = now; }
      } else {
        lastReal = '';
        stableSince = 0;
      }

      const elapsed = real ? now - stableSince : 0;
      const done = !!real && real === lastReal && (elapsed >= CFG.HARD_STABLE || elapsed >= CFG.ABS_CAP);
      if (done) {
        stopped = true;
        const final = textOf(this.lastResponse()) || real;
        onUpdate(final);
        onDone(final);
        cleanup();
        return;
      }

      if (now - t0 >= maxWait) {
        stopped = true;
        cleanup();
        const final = textOf(this.lastResponse());
        if (final && final !== snapText && !CFG.PLACEHOLDER_RE.test(final)) onDone(final);
        else onError(new Error('StreamTimeoutError: 超时未抓到回答，请检查「回答区域」选择器'));
      }
    };

    const mo = new MutationObserver(() => { if (!stopped) tick(); });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    const poll = window.setInterval(tick, CFG.POLL_MS);
    function cleanup() { mo.disconnect(); clearInterval(poll); }

    tick();
    return cleanup;
  }
}

export default CustomAdapter;
