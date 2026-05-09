import { BaseAdapter } from './base';
import { observeTextChanges, waitForStableText } from '../dom/observer';
import { STREAM_THROTTLE_MS, DONE_STABLE_MS } from '../../shared/constants';
import type { ProviderName } from '../../shared/types';

export class DeepSeekAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'deepseek';

  readonly inputSelectors = [
    'textarea[placeholder*="Message DeepSeek"]',
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
    'div.ds-icon-button--l[role="button"]:last-child',
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
    const input = document.querySelector<HTMLElement>('textarea');
    if (input) {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, composed: true })
      );
      input.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, composed: true })
      );
      return;
    }
    await super.submit();
  }

  startStreaming(
    onUpdate: (text: string) => void,
    onDone: (finalText: string) => void,
    onError: (err: Error) => void
  ): () => void {
    let cancelled = false;
    let cleanupObserve: (() => void) | null = null;

    const findResponseElement = (): HTMLElement | null => {
      // Try specific selectors first
      for (const sel of this.responseSelectors) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el && el.textContent && el.textContent.trim().length > 3) return el;
      }
      // Fallback: find the conversation container and get its last child
      const containers = document.querySelectorAll('[class*="e cero"], [class*="f fo"], [class*="78c"], [role="list"]');
      for (const c of containers) {
        const last = c.lastElementChild as HTMLElement;
        if (last && last.textContent && last.textContent.trim().length > 10) return last;
      }
      return null;
    };

    const start = async () => {
      try {
        // Wait briefly for DeepSeek to start streaming
        await new Promise((r) => setTimeout(r, 1500));

        let responseEl = findResponseElement();
        if (!responseEl) {
          // Use deepseek-specific timeout, falling back to general response timeout
          const maxRetries = Math.ceil(this.getResponseMaxWait() / 1000);
          for (let i = 0; i < maxRetries && !cancelled; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            responseEl = findResponseElement();
            if (responseEl) break;
          }
        }

        if (cancelled) return;
        if (!responseEl) {
          onError(new Error('No response element found after waiting'));
          return;
        }

        let lastText = '';
        cleanupObserve = observeTextChanges(responseEl, (text) => {
          if (cancelled) return;
          if (text !== lastText) {
            lastText = text;
            onUpdate(text);
          }
        }, STREAM_THROTTLE_MS);

        const finalText = await waitForStableText(responseEl, DONE_STABLE_MS, this.getResponseMaxWait());
        if (!cancelled) {
          onDone(finalText);
        }
      } catch (err) {
        if (!cancelled) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };

    start();

    return () => {
      cancelled = true;
      if (cleanupObserve) cleanupObserve();
    };
  }
}
