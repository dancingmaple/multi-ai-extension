import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';
import { SubmitFailedError, sleep } from '../../shared/utils';

export class ChatGPTAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'chatgpt';

  readonly inputSelectors = [
    '#prompt-textarea',
    'textarea[data-id="root"]',
    'textarea[placeholder*="Message"]',
    'textarea[placeholder*="消息"]',
    'div[contenteditable="true"] p[data-placeholder]',
    'div[contenteditable="true"]',
    'p[data-placeholder]',
    'textarea',
  ];

  readonly submitSelectors = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
    'button[aria-label*="send"]',
  ];

  readonly responseSelectors = [
    '[data-message-author-role="assistant"]',
    '.markdown.prose',
    '.markdown',
    '[class*="agent-turn"]',
    '[class*="assistant"]',
    '[class*="message"]',
  ];

  readonly loginSelectors = [
    'a[href*="login"]',
    'a[href*="/auth"]',
    'button[data-testid="login-button"]',
  ];

  readonly loginTextPatterns = ['Log in', '登录', 'Sign in', 'Sign up'];

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

  private findSendButton(): HTMLElement | null {
    for (const s of this.submitSelectors) {
      const el = [...document.querySelectorAll(s)].find((e) => {
        if (!this.isVisible(e)) return false;
        const b = e as HTMLButtonElement;
        return !b.disabled;
      }) as HTMLElement | undefined;
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

  override async setPrompt(prompt: string): Promise<void> {
    const el = this.findInput();
    if (!el) throw new SubmitFailedError(this.provider, '找不到可见输入框');

    el.focus();
    await sleep(80);

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc?.set?.call(el, prompt);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // ChatGPT 的 #prompt-textarea 是 contenteditable；用 execCommand insertText 最能唤醒 React 状态
      try {
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, prompt);
      } catch {
        el.textContent = prompt;
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt, inputType: 'insertText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 额外触发一次 keyup，帮助按钮从 disabled 切到 enabled
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', bubbles: true }));
    await sleep(200);
  }

  override async submit(): Promise<void> {
    await sleep(150);

    // 1) 优先点击可见且未禁用的发送按钮
    const btn = this.findSendButton();
    if (btn) {
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      btn.click();
      return;
    }

    // 2) 回车兜底
    const input = this.findInput();
    if (input) {
      input.focus();
      this.fireEnter(input);
      return;
    }

    throw new SubmitFailedError(this.provider, '无可用发送按钮且找不到输入框');
  }
}
