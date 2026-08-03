import type { ProviderName } from '../../shared/types';
import { BaseAdapter } from './base';
import { SubmitFailedError } from '../../shared/utils';

/* ============================================================
   Kimi 适配器 · robust-v1
   站点：kimi.moonshot.cn（kimi.com 会跳转过来）。
   输入框是 contenteditable（.chat-input-editor / [data-testid="msh-chatinput-editor"]），
   发送按钮是 .send-button-container 里的圆钮（可能只是 SVG 图标，无文字）。
   策略：可见输入框优先 + execCommand 写入 + 写后回读校验 + 发送按钮优先点击、Enter 兜底。
   ============================================================ */
console.log('[Kimi:adapter] build=robust-v1 2026-08-03');

const SUBMIT_SELECTORS = [
  '.send-button-container',
  '.send-button',
  'button[aria-label*="send" i]',
  'button[aria-label*="发送"]',
  'button[data-testid*="send" i]',
  'button[class*="send" i]',
  'form button[type="submit"]',
];

const INPUT_SELECTORS = [
  '.chat-input-editor',
  '[data-testid="msh-chatinput-editor"]',
  '.chat-input [contenteditable="true"]',
  'div.chat-input[contenteditable="true"]',
  '[contenteditable="true"]',
  'textarea.chat-input',
  'textarea',
  '[placeholder*="Kimi"]',
  '[placeholder*="提问"]',
  '[placeholder*="kimi"]',
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

export class KimiAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'kimi';

  readonly inputSelectors = INPUT_SELECTORS;
  readonly submitSelectors = SUBMIT_SELECTORS;
  readonly responseSelectors = [
    '.chat-content',
    '[class*="message"]',
    '[class*="answer"]',
    '[class*="markdown"]',
    'main',
  ];
  readonly loginSelectors = ['a[href*="login"]', 'a[href*="signin"]', 'a[href*="auth"]', 'a[href*="passport"]'];
  readonly loginTextPatterns = ['登录', 'Log in', 'Sign in'];

  override detectLoginRequired(): boolean {
    if (super.detectLoginRequired()) return true;
    if (/\/login|\/signin|\/auth|passport|account/i.test(location.href)) return true;
    if (!findVisibleInput()) {
      const loginBtn = [...document.querySelectorAll('button,a')].some((b) =>
        /登录|sign\s*in|log\s*in/i.test((b.textContent || '').trim())
      );
      return loginBtn;
    }
    return false;
  }

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
    console.log('[Kimi:adapter] setPrompt', { ok, readBack: readBack(el).length });
  }

  override async submit(): Promise<void> {
    await new Promise((r) => setTimeout(r, 150));
    const btn = [...document.querySelectorAll(SUBMIT_SELECTORS.join(','))]
      .filter((b) => isVisible(b) && !(b as HTMLButtonElement).disabled)
      .pop() as HTMLElement | undefined;
    if (btn) { btn.click(); console.log('[Kimi:adapter] submit via button'); return; }
    const el = findVisibleInput();
    if (el) {
      const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true } as KeyboardEventInit;
      el.dispatchEvent(new KeyboardEvent('keydown', init));
      el.dispatchEvent(new KeyboardEvent('keypress', init));
      el.dispatchEvent(new KeyboardEvent('keyup', init));
      console.log('[Kimi:adapter] submit via Enter');
      return;
    }
    throw new SubmitFailedError(this.provider, 'no submit button and no input for Enter fallback');
  }
}

export default KimiAdapter;
