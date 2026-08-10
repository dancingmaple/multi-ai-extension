import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';
import { SubmitFailedError, sleep } from '../../shared/utils';

/* ============================================================
   ChatGPT 适配器 · robust-v1
   ────────────────────────────────────────────────────────────
   过去 chatgpt 走 BaseAdapter 的通用 startStreaming：
     waitForElement(responseSelectors) 拿到的往往是「上一轮」的
     assistant 节点，文本一开始就稳定 → 立刻判完成 → 自动获取拿到
     空串或旧回答，表现为「测试台无法自动获取 chatgpt」。
   这里改用 DeepSeek 已验证的「提交快照门闩」范式：
     · 进入即拍快照（末条 assistant 正文 + 条数），门闩未开时旧文本视作空
     · 永远只读最后一条 assistant 消息，避免锁死在历史节点
     · 剜除思考/工具块，占位符过滤，三档静止阈值 + 硬超时逃生
   ============================================================ */
const CG = {
  ASSISTANT_SELECTORS: [
    '[data-message-author-role="assistant"]',
    'article[data-testid^="conversation-turn"]',
    '[class*="agent-turn"]',
  ],
  MARKDOWN_SELECTORS: ['.markdown', '.prose', '[class*="markdown"]'],
  TOOL_BLOCK_SELECTORS: [
    '[data-testid*="tool" i]',
    '[class*="tool-call"]',
    '[class*="search-result"]',
    '[class*="citation"]',
  ],
  STOP_BUTTON_SELECTORS: [
    'button[data-testid="stop-button"]',
    'button[aria-label*="Stop" i]',
    'button[aria-label*="停止"]',
  ],
  THINKING_HEADER_RE: /^(Thought for|Thinking|Reasoning|Reasoned|已思考|思考了|正在思考|推理)/i,
  THINKING_ACTIVE_RE: /Thinking(?! for)|正在思考|思考中|Reasoning(?! for|ed)/i,
  PLACEHOLDER_RE: /^[.…·••\s\u2026\u00b7]+$/,
  HARD_STABLE: 2200,
  SOFT_STABLE: 6000,
  ABS_CAP: 12000,
  THINKING_PLACEHOLDER: '⏳ 思考 / 联网检索中…',
  STREAM_THROTTLE_MS: 250,
  POLL_MS: 400,
  DEBUG: true,
};

const cgLog = (...a: unknown[]) => { if (CG.DEBUG) console.log('[ChatGPT:adapter]', ...a); };
const CG_MARKDOWN_SEL = CG.MARKDOWN_SELECTORS.join(',');
const CG_TOOL_SEL = CG.TOOL_BLOCK_SELECTORS.join(',');

function cgVisible(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.01;
}

function cgDirectText(el: Element): string {
  let t = '';
  el.childNodes.forEach((n) => { if (n.nodeType === 3) t += n.textContent || ''; });
  return t;
}

function cgText(node: Element | null): string {
  if (!node) return '';
  const t = (node instanceof HTMLElement ? node.innerText : node.textContent) || '';
  return t.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
}

/** 所有 assistant 消息（必须内含 markdown 容器，天然排除用户气泡） */
function cgAssistantMessages(): Element[] {
  for (const s of CG.ASSISTANT_SELECTORS) {
    const arr = [...document.querySelectorAll(s)].filter((e) => e.querySelector(CG_MARKDOWN_SEL));
    if (arr.length) return arr;
  }
  const set = new Set<Element>();
  document.querySelectorAll(CG_MARKDOWN_SEL).forEach((m) => {
    const a = m.closest('[data-message-author-role], article, div');
    if (a) set.add(a);
  });
  return [...set];
}

function cgLastAssistant(): Element | null {
  const all = cgAssistantMessages();
  return all[all.length - 1] || null;
}

function cgFindThinkingHeader(root: Element): Element | null {
  for (const el of root.querySelectorAll('*')) {
    const d = cgDirectText(el).trim();
    if (d && d.length < 60 && CG.THINKING_HEADER_RE.test(d)) return el;
  }
  return null;
}

/** 取消息正文：剜除思考块与工具/引用块 */
function cgBodyText(msg: Element | null): string {
  if (!msg) return '';
  const clone = msg.cloneNode(true) as Element;
  const header = cgFindThinkingHeader(clone);
  if (header) {
    // 找到承载思考内容的容器（向上找到含 markdown 的兄弟层），整块移除
    let p: Element | null = header.parentElement;
    while (p && p !== clone) {
      if (/think|reason/i.test(String((p as HTMLElement).className || ''))) break;
      p = p.parentElement;
    }
    const cont = p && p !== clone ? p : header;
    cont.parentNode?.removeChild(cont);
  }
  if (CG_TOOL_SEL) clone.querySelectorAll(CG_TOOL_SEL).forEach((n) => n.parentNode?.removeChild(n));
  // 优先取 markdown 容器拼接（更贴近纯回答），拿不到再退化到整块文本
  const mds = [...clone.querySelectorAll(CG_MARKDOWN_SEL)];
  if (mds.length) {
    const joined = mds.map((m) => cgText(m)).filter(Boolean).join('\n\n').trim();
    if (joined) return joined;
  }
  return cgText(clone);
}

function cgHasStopButton(): boolean {
  return CG.STOP_BUTTON_SELECTORS.some((s) => [...document.querySelectorAll(s)].some(cgVisible));
}

function cgThinkingActive(msg: Element | null): boolean {
  if (!msg) return false;
  const h = cgFindThinkingHeader(msg);
  return !!h && CG.THINKING_ACTIVE_RE.test(cgDirectText(h).trim());
}

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
    'button[aria-label="Send prompt"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
    'button[aria-label*="send"]',
  ];

  readonly responseSelectors = [
    '[data-message-author-role="assistant"]',
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

  private isVisible(el: Element | null): boolean {
    if (!el || !(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.01;
  }

  private findInput(): HTMLElement | null {
    for (const s of this.inputSelectors) {
      const el = [...document.querySelectorAll(s)].find((e) => this.isVisible(e)) as HTMLElement | undefined;
      if (el) return el;
    }
    return null;
  }

  private findSendButton(): HTMLElement | null {
    for (const s of this.submitSelectors) {
      const el = [...document.querySelectorAll(s)].find((e) => {
        if (!this.isVisible(e)) return false;
        const b = e as HTMLButtonElement;
        return !b.disabled;
      }) as HTMLElement | undefined;
      if (el) return el;
    }
    return null;
  }

  private fireEnter(el: HTMLElement): void {
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true, isComposing: false } as KeyboardEventInit;
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keypress', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  override async setPrompt(prompt: string): Promise<void> {
    const el = this.findInput();
    if (!el) throw new SubmitFailedError(this.provider, '找不到可见输入框');

    el.focus();
    await sleep(80);

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc?.set?.call(el, prompt);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // ChatGPT 的 #prompt-textarea 是 contenteditable；用 execCommand insertText 最能唤醒 React 状态
      try {
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, prompt);
      } catch {
        el.textContent = prompt;
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt, inputType: 'insertText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 额外触发一次 keyup，帮助按钮从 disabled 切到 enabled
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', bubbles: true }));
    await sleep(200);
  }

  override async submit(): Promise<void> {
    await sleep(150);

    // 1) 优先点击可见且未禁用的发送按钮
    const btn = this.findSendButton();
    if (btn) {
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      btn.click();
      return;
    }

    // 2) 回车兜底
    const input = this.findInput();
    if (input) {
      input.focus();
      this.fireEnter(input);
      return;
    }

    throw new SubmitFailedError(this.provider, '无可用发送按钮且找不到输入框');
  }

  /** 稳健流式：提交快照门闩 + 只读最后一条 assistant + 静止阈值 + 硬超时逃生 */
  override startStreaming(
    onUpdate: (text: string) => void,
    onDone: (finalText: string) => void,
    onError: (err: Error) => void,
  ): () => void {
    let stopped = false;

    // ▼ 提交快照门闩：此刻本轮回答必然尚未渲染
    const snapshotText = cgBodyText(cgLastAssistant());
    const snapshotCount = cgAssistantMessages().length;
    cgLog('SNAPSHOT', { snapshotTextLen: snapshotText.length, snapshotCount });
    let started = false;

    let lastReal = '';
    let stableSince = 0;
    let lastEmit = 0;
    let lastSent = '';
    const maxWait = this.getResponseMaxWait();
    const t0 = Date.now();

    const tick = () => {
      if (stopped) return;
      const now = Date.now();
      const msg = cgLastAssistant();
      const curCount = cgAssistantMessages().length;
      const curText = msg ? cgBodyText(msg) : '';

      if (!started && (curText !== snapshotText || curCount > snapshotCount)) {
        started = true;
        cgLog('GATE OPEN', { curTextLen: curText.length, curCount });
      }

      const raw = started ? curText : '';
      const isPlaceholder = !raw || CG.PLACEHOLDER_RE.test(raw);
      const real = isPlaceholder ? '' : raw;

      const show = real || CG.THINKING_PLACEHOLDER;
      if (show !== lastSent && now - lastEmit >= CG.STREAM_THROTTLE_MS) {
        lastSent = show; lastEmit = now; onUpdate(show);
      }

      if (real) {
        if (real !== lastReal) { lastReal = real; stableSince = now; }
      } else {
        lastReal = ''; stableSince = 0;
      }

      const stop = cgHasStopButton();
      const think = cgThinkingActive(msg);
      const elapsed = real ? now - stableSince : 0;
      const need = (stop || think) ? CG.SOFT_STABLE : CG.HARD_STABLE;
      // 仍在流式（Stop 按钮可见）时不轻易判完成，除非已达绝对上限
      const done = !!real && real === lastReal && (elapsed >= need || elapsed >= CG.ABS_CAP);

      cgLog('tick', { started, realLen: real.length, stableMs: elapsed, need, stop, think, done });

      if (done) {
        stopped = true;
        const final = cgBodyText(cgLastAssistant()) || real;
        cgLog('DONE finalLen=', final.length);
        onUpdate(final);
        onDone(final);
        cleanup();
        return;
      }

      if (now - t0 >= maxWait) {
        stopped = true; cleanup();
        const final = cgBodyText(cgLastAssistant());
        if (final && !CG.PLACEHOLDER_RE.test(final) && final !== snapshotText) {
          cgLog('HARD_TIMEOUT 有正文，按完成处理');
          onDone(final);
        } else {
          cgLog('HARD_TIMEOUT 无正文，报错');
          onError(new Error('StreamTimeoutError: 超时未能抓取到 ChatGPT 回答，请重试或用「手动获取」'));
        }
      }
    };

    const mo = new MutationObserver(() => { if (!stopped) tick(); });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    const poll = window.setInterval(tick, CG.POLL_MS);
    function cleanup() { mo.disconnect(); clearInterval(poll); }

    tick();
    return cleanup;
  }
}
