import type { ProviderName, AppSettings } from '../../shared/types';
import { waitForElement, observeTextChanges, waitForStableText } from '../dom/observer';
import { setNativeInputValue, setContentEditableValue, clickElement, LoginRequiredError, SubmitFailedError } from '../../shared/utils';
import { ELEMENT_TIMEOUT_MS, STREAM_THROTTLE_MS, DONE_STABLE_MS } from '../../shared/constants';

export interface SiteAdapter {
  readonly provider: ProviderName;
  isReady(): Promise<boolean>;
  detectLoginRequired(): boolean;
  waitForReady(timeoutMs?: number): Promise<void>;
  setPrompt(prompt: string): Promise<void>;
  submit(): Promise<void>;
  startStreaming(
    onUpdate: (text: string) => void,
    onDone: (finalText: string) => void,
    onError: (err: Error) => void
  ): () => void;
  setTimeouts(settings: AppSettings): void;
}

export abstract class BaseAdapter implements SiteAdapter {
  abstract readonly provider: ProviderName;
  abstract readonly inputSelectors: string[];
  abstract readonly submitSelectors: string[];
  abstract readonly responseSelectors: string[];
  abstract readonly loginSelectors: string[];
  protected timeoutSettings: AppSettings | null = null;

  setTimeouts(settings: AppSettings): void {
    this.timeoutSettings = settings;
  }

  protected getElementTimeout(): number {
    return this.timeoutSettings?.elementTimeoutMs ?? ELEMENT_TIMEOUT_MS;
  }

  protected getResponseMaxWait(): number {
    if (this.timeoutSettings?.responseTimeoutMs) {
      return this.timeoutSettings.responseTimeoutMs[this.provider] ?? 120000;
    }
    return 120000;
  }
  protected readonly loginTextPatterns: string[] = [];

  async isReady(): Promise<boolean> {
    try {
      const el = await waitForElement(this.inputSelectors, 3000);
      return el !== null;
    } catch {
      return false;
    }
  }

  detectLoginRequired(): boolean {
    for (const sel of this.loginSelectors) {
      const el = document.querySelector(sel);
      if (el) return true;
    }
    if (this.loginTextPatterns.length > 0) {
      const buttons = document.querySelectorAll('button, a');
      for (const btn of buttons) {
        const text = btn.textContent?.trim() ?? '';
        for (const pattern of this.loginTextPatterns) {
          if (text === pattern) return true;
        }
      }
    }
    return false;
  }

  async waitForReady(timeoutMs?: number): Promise<void> {
    await waitForElement(this.inputSelectors, timeoutMs ?? this.getElementTimeout());
  }

  async setPrompt(prompt: string): Promise<void> {
    const el = await waitForElement(this.inputSelectors, this.getElementTimeout());

    if (this.detectLoginRequired()) {
      throw new LoginRequiredError(this.provider);
    }

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      setNativeInputValue(el, prompt);
    } else if (el.getAttribute('contenteditable') === 'true' || el.isContentEditable) {
      setContentEditableValue(el, prompt);
    } else {
      const textarea = el.querySelector('textarea');
      if (textarea) {
        setNativeInputValue(textarea, prompt);
      } else {
        setContentEditableValue(el, prompt);
      }
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  async submit(): Promise<void> {
    // Use shorter timeout for submit — button should already exist after setPrompt
    const btn = await waitForElement(this.submitSelectors, 5000);
    if (!(btn instanceof HTMLElement)) {
      throw new SubmitFailedError(this.provider, 'Submit button not an HTMLElement');
    }
    clickElement(btn);
  }

  startStreaming(
    onUpdate: (text: string) => void,
    onDone: (finalText: string) => void,
    onError: (err: Error) => void
  ): () => void {
    let cancelled = false;
    let cleanupObserve: (() => void) | null = null;

    const findResponse = async (): Promise<HTMLElement> => {
      const elTimeout = this.getElementTimeout();
      // Try primary selectors first with reduced timeout
      try {
        return await waitForElement(this.responseSelectors, elTimeout);
      } catch {
        // Fallback: try finding any markdown or content container
        const broad = [
          '[class*="markdown"]',
          '[class*="response"]',
          '[class*="assistant"]',
          '[class*="message"] [class*="content"]',
          '[data-message-author-role="assistant"]',
        ];
        return await waitForElement(broad, elTimeout);
      }
    };

    const maxWait = this.getResponseMaxWait();

    const start = async () => {
      try {
        const responseEl = await findResponse();
        if (cancelled) return;

        let lastText = '';

        cleanupObserve = observeTextChanges(responseEl, (text) => {
          if (cancelled) return;
          if (text !== lastText) {
            lastText = text;
            onUpdate(text);
          }
        }, STREAM_THROTTLE_MS);

        const finalText = await waitForStableText(responseEl, DONE_STABLE_MS, maxWait);
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
