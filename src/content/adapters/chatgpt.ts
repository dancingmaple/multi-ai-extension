import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';

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
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
    'button[aria-label*="send"]',
    'button.cursor-pointer[type="button"]',
    'button:has(svg)',
  ];

  readonly responseSelectors = [
    '[data-message-author-role="assistant"] article',
    '[data-message-author-role="assistant"]',
    'article[data-testid^="conversation-turn"]',
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

  async setPrompt(prompt: string): Promise<void> {
    // ChatGPT uses a contenteditable div with a nested p tag
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

  async submit(): Promise<void> {
    try {
      await super.submit();
    } catch {
      // Fall back to pressing Enter on the input
      const input = document.querySelector<HTMLElement>('#prompt-textarea, textarea, div[contenteditable="true"]');
      if (input) {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, composed: true })
        );
        input.dispatchEvent(
          new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, composed: true })
        );
      } else {
        throw new Error('ChatGPT: cannot submit — no button and no input found');
      }
    }
  }
}
