import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';

export class ChatGPTAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'chatgpt';

  readonly inputSelectors = [
    '#prompt-textarea',
    'textarea[data-id="root"]',
    'textarea[placeholder*="Message"]',
    'textarea[placeholder*="消息"]',
    'div[contenteditable="true"][data-mce-placeholder]',
    'p[data-placeholder]',
  ];

  readonly submitSelectors = [
    'button[data-testid="send-button"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
  ];

  readonly responseSelectors = [
    '[data-message-author-role="assistant"]',
    '.markdown',
    '[class*="agent-turn"]',
  ];

  readonly loginSelectors = [
    'a[href*="login"]',
    'a[href*="/auth"]',
  ];

  readonly loginTextPatterns = ['Log in', '登录', 'Sign in'];

  async setPrompt(prompt: string): Promise<void> {
    const pEl = document.querySelector('p[data-placeholder]');
    if (pEl instanceof HTMLElement) {
      pEl.focus();
      pEl.textContent = prompt;
      pEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt }));
      await new Promise((r) => setTimeout(r, 200));
      return;
    }
    await super.setPrompt(prompt);
  }
}
