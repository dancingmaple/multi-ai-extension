import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';

export class GeminiAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'gemini';

  readonly inputSelectors = [
    'rich-textarea div[contenteditable="true"]',
    'div[contenteditable="true"][aria-label*="prompt"]',
    'div[contenteditable="true"][aria-label*="输入"]',
    'textarea[aria-label*="prompt"]',
    'textarea[aria-label*="输入"]',
  ];

  readonly submitSelectors = [
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
    'button[aria-label*="send"]',
    'button.send-button',
  ];

  readonly responseSelectors = [
    'model-response .markdown',
    'model-response',
    '[class*="response-content"]',
    'message-content',
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

  async submit(): Promise<void> {
    try {
      await super.submit();
    } catch {
      const input = document.querySelector<HTMLElement>(
        'rich-textarea div[contenteditable="true"]'
      );
      if (input) {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
        );
      } else {
        throw new Error('Gemini: cannot submit — no button and no input found');
      }
    }
  }
}
