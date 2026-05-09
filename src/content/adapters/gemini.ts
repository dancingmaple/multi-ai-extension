import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';

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

  async waitForReady(timeoutMs?: number): Promise<void> {
    await super.waitForReady(timeoutMs);
    await new Promise((r) => setTimeout(r, 1500));
  }

  async setPrompt(prompt: string): Promise<void> {
    // Gemini uses Quill editor — set content on the ql-editor div
    const el = document.querySelector<HTMLElement>(
      'div[contenteditable="true"][role="textbox"]'
    );
    if (el) {
      el.focus();
      el.textContent = prompt;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      return;
    }
    await super.setPrompt(prompt);
  }

  async submit(): Promise<void> {
    try {
      await super.submit();
    } catch {
      const input = document.querySelector<HTMLElement>(
        'div[contenteditable="true"][role="textbox"], div[contenteditable="true"]'
      );
      if (input) {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, composed: true })
        );
        input.dispatchEvent(
          new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, composed: true })
        );
      } else {
        throw new Error('Gemini: cannot submit — no button and no input found');
      }
    }
  }
}
