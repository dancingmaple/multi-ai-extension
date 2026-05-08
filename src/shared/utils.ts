export function setNativeInputValue(
  element: HTMLTextAreaElement | HTMLInputElement,
  value: string
): void {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

export function setContentEditableValue(element: HTMLElement, value: string): void {
  element.focus();
  element.textContent = value;
  element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
}

export function clickElement(element: HTMLElement): void {
  element.click();
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractText(node: Node): string {
  return node.textContent?.trim() ?? '';
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export class ElementNotFoundError extends Error {
  constructor(selectors: string[]) {
    super(`Element not found for selectors: ${selectors.join(', ')}`);
    this.name = 'ElementNotFoundError';
  }
}

export class LoginRequiredError extends Error {
  constructor(provider: string) {
    super(`Login required for ${provider}`);
    this.name = 'LoginRequiredError';
  }
}

export class SubmitFailedError extends Error {
  constructor(provider: string, reason?: string) {
    super(`Submit failed for ${provider}${reason ? `: ${reason}` : ''}`);
    this.name = 'SubmitFailedError';
  }
}

export function isElementVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
}
