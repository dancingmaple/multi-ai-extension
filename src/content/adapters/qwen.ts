import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';

export class QwenAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'qwen';

  readonly inputSelectors = [
    'textarea.message-input-textarea',
    'textarea[placeholder*="How can I help"]',
    'textarea[placeholder*="消息"]',
    'textarea',
    'div[contenteditable="true"]',
  ];

  readonly submitSelectors = [
    'button.send-button',
    'button[aria-label*="send"]',
    'button[aria-label*="发送"]',
  ];

  readonly responseSelectors = [
    '[class*="assistant"]',
    '[class*="answer"]',
    '[class*="message"] [class*="content"]',
    '[class*="markdown"]',
  ];

  readonly loginSelectors = [
    'a[href*="login"]',
    'a[href*="signin"]',
  ];

  readonly loginTextPatterns = ['登录', 'Log in', 'Sign in'];

  async submit(): Promise<void> {
    try {
      await super.submit();
    } catch {
      const input = document.querySelector<HTMLElement>('textarea, div[contenteditable="true"]');
      if (input) {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, composed: true })
        );
        input.dispatchEvent(
          new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, composed: true })
        );
      } else {
        throw new Error('Qwen: cannot submit');
      }
    }
  }
}
