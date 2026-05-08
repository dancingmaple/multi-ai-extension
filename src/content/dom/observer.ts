export function waitForElement(
  selectors: string[],
  timeoutMs: number = 15000
): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    for (const sel of selectors) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) {
        resolve(el);
        return;
      }
    }

    let observer: MutationObserver;

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(
        new Error(
          `Element not found for selectors: ${selectors.join(', ')} within ${timeoutMs}ms`
        )
      );
    }, timeoutMs);

    observer = new MutationObserver(() => {
      for (const sel of selectors) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el) {
          clearTimeout(timer);
          observer.disconnect();
          resolve(el);
          return;
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

export function observeTextChanges(
  target: Node,
  onUpdate: (text: string) => void,
  throttleMs: number = 300
): () => void {
  let lastText = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    const text = target.textContent?.trim() ?? '';
    if (text !== lastText) {
      lastText = text;
      onUpdate(text);
    }
  };

  const observer = new MutationObserver(() => {
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, throttleMs);
    }
  });

  observer.observe(target, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  flush();

  return () => {
    observer.disconnect();
    if (timer !== null) clearTimeout(timer);
  };
}

export function waitForStableText(
  target: Node,
  stableMs: number = 250,
  maxWaitMs: number = 120000
): Promise<string> {
  return new Promise((resolve) => {
    let lastText = target.textContent?.trim() ?? '';
    let stableTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTimer = setTimeout(() => {
      observer.disconnect();
      if (stableTimer !== null) clearTimeout(stableTimer);
      resolve(lastText);
    }, maxWaitMs);

    let done = false;
    const finish = (text: string) => {
      if (done) return;
      done = true;
      clearTimeout(maxTimer);
      if (stableTimer !== null) clearTimeout(stableTimer);
      observer.disconnect();
      resolve(text);
    };

    const observer = new MutationObserver(() => {
      const current = target.textContent?.trim() ?? '';
      if (current !== lastText) {
        lastText = current;
        if (stableTimer !== null) clearTimeout(stableTimer);
        stableTimer = setTimeout(() => finish(current), stableMs);
      }
    });

    observer.observe(target, { childList: true, subtree: true, characterData: true });
    stableTimer = setTimeout(() => finish(lastText), stableMs);
  });
}
