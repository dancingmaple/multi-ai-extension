import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';

export class DoubaoAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'doubao';

  readonly inputSelectors = [
    'textarea[placeholder*="发消息"]',
    'textarea[placeholder*="输入"]',
    'textarea',
    'div[contenteditable="true"]',
  ];

  readonly submitSelectors = [
    'div.send-btn-wrapper button',
    'div.send-btn-wrapper',
    'button[aria-label*="发送"]',
    'button[aria-label*="send"]',
  ];

  readonly responseSelectors = [
    '[class*="markdown"]',
    '[class*="answer"]',
    '[class*="response"]',
    '[class*="message"]',
    '[class*="bot"]',
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
        throw new Error('Doubao: cannot submit');
      }
    }
  }
}
