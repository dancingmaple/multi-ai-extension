import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';

export class DeepSeekAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'deepseek';

  readonly inputSelectors = [
    'textarea[placeholder*="发消息"]',
    'textarea[placeholder*="发送"]',
    'textarea[placeholder*="message"]',
    'textarea[placeholder*="Message"]',
    '#chat-input',
    'textarea',
  ];

  readonly submitSelectors = [
    'button[aria-label*="发送"]',
    'button[aria-label*="Send"]',
    'div[role="button"][aria-label*="发送"]',
  ];

  readonly responseSelectors = [
    '[class*="ds-markdown"]',
    '.ds-markdown',
    '[class*="markdown"]',
  ];

  readonly loginSelectors = [
    'a[href*="login"]',
    'a[href*="/auth"]',
  ];

  readonly loginTextPatterns = ['登录', 'Log in', 'Sign in'];

  async submit(): Promise<void> {
    try {
      await super.submit();
    } catch {
      const input = document.querySelector<HTMLElement>(this.inputSelectors[0]);
      if (input) {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
        );
      } else {
        throw new Error('DeepSeek: cannot submit — no button and no input found');
      }
    }
  }
}
