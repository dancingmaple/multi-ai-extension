import type { ProviderName } from '../../shared/types';
import { BaseAdapter } from './base';
import { SubmitFailedError } from '../../shared/utils';

/* ============================================================
   Qwen 适配器 · robust-v2（可见元素优先 + 写读校验 + Enter 兜底）
   修复「未发送」：旧版直接 super.submit，裸 textarea 选择器排在首位，
   当 Qwen 改用 contenteditable 或输入框不可见时写入失败。
   本版：可见元素优先 + execCommand 写入 + 未禁用发送按钮 + Enter 兜底。
   ============================================================ */
console.log('[Qwen:adapter] build=robust-v2 2026-08-02');

const SUBMIT_SELECTORS = [
  'button.send-button',
  'button[aria-label*="send" i]',
  'button[aria-label*="发送"]',
  'button[data-testid*="send" i]',
  'button[class*="send" i]',
  'form button[type="submit"]',
];

const INPUT_SELECTORS = [
  'textarea.message-input-textarea',
  'textarea[placeholder*="How can I help"]',
  'textarea[placeholder*="消息"]',
  'textarea',
  'div[contenteditable="true"]',
  '[contenteditable="true"]',
];

function isVisible(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.01;
}
function readBack(el: HTMLElement | null): string {
  if (!el) return '';
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return (el.value || '').trim();
  return ((el as HTMLElement).innerText || el.textContent || '').trim();
}
function findVisibleInput(): HTMLElement | null {
  for (const s of INPUT_SELECTORS) {
    const el = [...document.querySelectorAll(s)].find(isVisible) as HTMLElement | undefined;
    if (el) return el;
  }
  return null;
}
function writeExec(el: HTMLElement, value: string): void {
  el.focus();
  try { document.execCommand('selectAll', false); document.execCommand('insertText', false, value); } catch { /* noop */ }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
function writeOk(el: HTMLElement, prompt: string): boolean {
  const got = readBack(el);
  const head = prompt.replace(/\s/g, '').slice(0, 8);
  return got.replace(/\s/g, '').includes(head) || got.length >= Math.max(4, Math.floor(prompt.length * 0.8));
}

export class QwenAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'qwen';

  readonly inputSelectors = INPUT_SELECTORS;
  readonly submitSelectors = SUBMIT_SELECTORS;
  readonly responseSelectors = [
    '[class*="assistant"]',
    '[class*="answer"]',
    '[class*="message"] [class*="content"]',
    '[class*="markdown"]',
  ];
  readonly loginSelectors = ['a[href*="login"]', 'a[href*="signin"]'];
  readonly loginTextPatterns = ['登录', 'Log in', 'Sign in'];

  override async setPrompt(prompt: string): Promise<void> {
    const el = findVisibleInput();
    if (!el) throw new SubmitFailedError(this.provider, '找不到可见输入框');
    el.focus();
    await new Promise((r) => setTimeout(r, 80));
    let ok = false;
    const writers: Array<() => void> = [
      () => writeExec(el, prompt),
      () => { el.focus(); el.textContent = prompt; el.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt })); },
    ];
    for (const fn of writers) {
      try { fn(); } catch { /* noop */ }
      await new Promise((r) => setTimeout(r, 120));
      if (writeOk(el, prompt)) { ok = true; break; }
    }
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a', code: 'KeyA' }));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt, inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a', code: 'KeyA' }));
    el.blur();
    el.focus();
    await new Promise((r) => setTimeout(r, 250));
    console.log('[Qwen:adapter] setPrompt', { ok, readBack: readBack(el).length });
  }

  override async submit(): Promise<void> {
    await new Promise((r) => setTimeout(r, 150));
    const btn = [...document.querySelectorAll(SUBMIT_SELECTORS.join(','))]
      .filter((b) => isVisible(b) && !(b as HTMLButtonElement).disabled)
      .pop() as HTMLElement | undefined;
    if (btn) { btn.click(); console.log('[Qwen:adapter] submit via button'); return; }
    const el = findVisibleInput();
    if (el) {
      const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true } as KeyboardEventInit;
      el.dispatchEvent(new KeyboardEvent('keydown', init));
      el.dispatchEvent(new KeyboardEvent('keypress', init));
      el.dispatchEvent(new KeyboardEvent('keyup', init));
      console.log('[Qwen:adapter] submit via Enter');
      return;
    }
    throw new SubmitFailedError(this.provider, 'no submit button and no input for Enter fallback');
  }
}

export default QwenAdapter;
