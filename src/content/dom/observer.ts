import { MUTATION_THROTTLE_MS } from '../../shared/constants';

/**
 * 监听整篇文档，并把一段时间内的所有 mutation 合并成一次回调（#7）。
 *
 * 直接 `new MutationObserver(cb)` + `observe(document.body, {subtree:true})`
 * 在 AI 站点流式输出时每秒会触发数百次回调；若回调内部还做
 * cloneNode / querySelectorAll('*') 之类的重活，CPU 会被直接打满。
 * 这里统一收口成「合并 + 节流」，配合各适配器自身的轮询兜底，
 * 既不丢事件也不会空转。
 *
 * @returns 取消监听的函数（幂等）
 */
export function observeDocumentThrottled(
  onMutate: () => void,
  throttleMs: number = MUTATION_THROTTLE_MS
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const observer = new MutationObserver(() => {
    if (disposed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      if (!disposed) onMutate();
    }, throttleMs);
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  return () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

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
    let scheduled = false;

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(
        new Error(
          `Element not found for selectors: ${selectors.join(', ')} within ${timeoutMs}ms`
        )
      );
    }, timeoutMs);

    const check = () => {
      scheduled = false;
      for (const sel of selectors) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el) {
          clearTimeout(timer);
          observer.disconnect();
          resolve(el);
          return;
        }
      }
    };

    // 一帧内的成批 mutation 只做一次查询，避免整页高频改动时反复全选择器扫描（#7）
    observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(check);
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
