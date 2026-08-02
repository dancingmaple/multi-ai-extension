import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';
import { SubmitFailedError, sleep } from '../../shared/utils';

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

  override async waitForReady(timeoutMs?: number): Promise<void> {
    await super.waitForReady(timeoutMs);
    await sleep(1500);
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
      // Gemini 的 Quill 编辑器：先清空再插入
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
    await sleep(300);
  }

  override async submit(): Promise<void> {
    await sleep(150);

    const btn = this.findSendButton();
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
      this.fireEnter(input);
      return;
    }

    throw new SubmitFailedError(this.provider, '无可用发送按钮且找不到输入框');
  }
}
