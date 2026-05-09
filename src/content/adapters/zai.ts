import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';

export class ZaiAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'zai';

  readonly inputSelectors = [
    'textarea[placeholder*="输入消息"]',
    'textarea[placeholder*="消息"]',
    'textarea[placeholder*="输入"]',
    'textarea',
    'div[contenteditable="true"]',
  ];

  readonly submitSelectors = [
    'button.sendMessageButton',
    'button[aria-label*="send"]',
    'button[aria-label*="发送"]',
  ];

  readonly responseSelectors = [
    '[class*="assistant"]',
    '[class*="markdown"]',
    '[class*="prose"]',
    '[class*="response"]',
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
        throw new Error('Z.AI: cannot submit');
      }
    }
  }
}
