import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';

export class DeepSeekAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'deepseek';

  readonly inputSelectors = [
    'textarea[placeholder*="发消息"]',
    'textarea[placeholder*="发送"]',
    'textarea[placeholder*="message"]',
    'textarea[placeholder*="Message"]',
    'textarea[placeholder*="Send"]',
    '#chat-input',
    'textarea',
    'div[contenteditable="true"]',
  ];

  readonly submitSelectors = [
    'button[aria-label*="发送"]',
    'button[aria-label*="Send"]',
    'div[role="button"][aria-label*="发送"]',
    'div[role="button"][aria-label*="send"]',
    'button:has(svg)',
  ];

  readonly responseSelectors = [
    '[class*="ds-markdown"]',
    '.ds-markdown',
    '[class*="markdown"]',
    '[class*="message"] [class*="content"]',
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
      const input = document.querySelector<HTMLElement>(
        'textarea, div[contenteditable="true"], #chat-input'
      );
      if (input) {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, composed: true })
        );
        input.dispatchEvent(
          new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, composed: true })
        );
      } else {
        throw new Error('DeepSeek: cannot submit — no button and no input found');
      }
    }
  }
}
