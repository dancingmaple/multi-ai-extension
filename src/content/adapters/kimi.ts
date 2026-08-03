import type { ProviderName } from '../../shared/types';
import { BaseAdapter } from './base';
import { SubmitFailedError } from '../../shared/utils';

/* ============================================================
   Kimi 适配器 · robust-v2
   站点：kimi.moonshot.cn（kimi.com 会跳转过来）。
   输入框可能是：
     - 对话页 contenteditable .chat-input-editor / [data-testid="msh-chatinput-editor"]
     - 落地页 textarea / contenteditable .chat-input / .input-box
   发送按钮可能是 .send-button-container 里的圆钮（无文字），落地页也可能是
   button[type="submit"] 或带 send 图标的 button。
   策略：可见输入框优先 + 占位符兜底 + 先点击激活 + execCommand 写入 +
         写后回读校验 + 发送按钮优先点击、Enter 兜底。
   ============================================================ */
console.log('[Kimi:adapter] build=robust-v2 2026-08-03');

const SUBMIT_SELECTORS = [
  '.send-icon.iconify',
  'svg.send-icon',
  'button.send-button',
  '.action-send',
  '.send-button',
  '.send-button-container button',
  'button[aria-label*="send" i]',
  'button[aria-label*="发送"]',
  'button[data-testid*="send" i]',
  'button[class*="send" i]',
  'button[type="submit"]',
  'form button[type="submit"]',
];

const INPUT_SELECTORS = [
  '.chat-input-editor',
  '[data-testid="msh-chatinput-editor"]',
  'textarea.chat-input',
  '.chat-input [contenteditable="true"]',
  'div.chat-input[contenteditable="true"]',
  '.chat-input textarea',
  '.input-box textarea',
  '.input-box [contenteditable="true"]',
  '[contenteditable="true"][data-testid*="input" i]',
  '[contenteditable="true"][data-testid*="editor" i]',
  'textarea[placeholder*="问" i]',
  'textarea[placeholder*="Ask" i]',
  'textarea[placeholder*="kimi" i]',
  'div[contenteditable="true"][placeholder*="问" i]',
  'div[contenteditable="true"][placeholder*="Ask" i]',
  'div[contenteditable="true"][placeholder*="kimi" i]',
  '[contenteditable="true"]',
  'textarea',
  '[placeholder*="Kimi"]',
  '[placeholder*="提问"]',
  '[placeholder*="kimi"]',
];

function isVisible(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.01;
}
function readBack(el: HTMLElement | null): string {
  if (!el) return '';
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return (el.value || '').trim();
  return ((el as HTMLElement).innerText || el.textContent || '').trim();
}
function findVisibleInput(): HTMLElement | null {
  for (const s of INPUT_SELECTORS) {
    const el = [...document.querySelectorAll(s)].find(isVisible) as HTMLElement | undefined;
    if (el) return el;
  }
  return null;
}

// 把任意匹配到的元素（可能是 SVG 图标、容器 div）解析成真正可点击的按钮：
// 若是 button/a/[role=button] 直接用；否则向上找最近的这类祖先。找不到返回 null。
function resolveClickable(el: Element | null): HTMLElement | null {
  if (!el) return null;
  if (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement) return el;
  if (el.getAttribute('role') === 'button') return el as HTMLElement;
  const btn = el.closest('button, a, [role="button"]') as HTMLElement | null;
  return btn && isVisible(btn) ? btn : null;
}
function writeExec(el: HTMLElement, value: string): void {
  el.focus();
  try {
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, value);
  } catch { /* noop */ }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// 最原生的 contenteditable 写入：用 Selection/Range 真正插入文本节点并触发 input 事件，
// 这对很多基于 React 的编辑器比设置 textContent 更可靠。
function writeRange(el: HTMLElement, value: string): void {
  el.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel?.removeAllRanges();
  sel?.addRange(range);
  range.deleteContents();
  range.insertNode(document.createTextNode(value));
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
function writeOk(el: HTMLElement, prompt: string): boolean {
  const got = readBack(el);
  const head = prompt.replace(/\s/g, '').slice(0, 8);
  return got.replace(/\s/g, '').includes(head) || got.length >= Math.max(4, Math.floor(prompt.length * 0.8));
}

export class KimiAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'kimi';

  readonly inputSelectors = INPUT_SELECTORS;
  readonly submitSelectors = SUBMIT_SELECTORS;
  readonly responseSelectors = [
    '.chat-content',
    '.chat-history',
    '.message-list',
    '[class*="message"]',
    '[class*="answer"]',
    '[class*="markdown"]',
    'main',
  ];
  readonly loginSelectors = ['a[href*="login"]', 'a[href*="signin"]', 'a[href*="auth"]', 'a[href*="passport"]'];
  readonly loginTextPatterns = ['登录', 'Log in', 'Sign in'];

  override detectLoginRequired(): boolean {
    if (super.detectLoginRequired()) return true;
    if (/\/login|\/signin|\/auth|passport|account/i.test(location.href)) return true;
    if (!findVisibleInput()) {
      const loginBtn = [...document.querySelectorAll('button,a')].some((b) =>
        /登录|sign\s*in|log\s*in/i.test((b.textContent || '').trim())
      );
      return loginBtn;
    }
    return false;
  }

  override async setPrompt(prompt: string): Promise<void> {
    const el = findVisibleInput();
    if (!el) {
      const allInputs = INPUT_SELECTORS.map((s) => `${s}: ${document.querySelectorAll(s).length}`).join('; ');
      throw new SubmitFailedError(this.provider, '找不到可见输入框（' + allInputs + '）');
    }

    // 落地页有时需要先点一下输入框才能激活
    el.focus();
    try { el.click(); } catch { /* noop */ }
    await new Promise((r) => setTimeout(r, 120));

    let ok = false;
    const writers: Array<() => void> = [
      () => writeExec(el, prompt),
      () => writeRange(el, prompt),
      () => {
        el.focus();
        if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
          el.value = prompt;
        } else {
          el.textContent = prompt;
        }
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt }));
      },
      () => {
        el.focus();
        if ('value' in el && (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) {
          (el as HTMLTextAreaElement).value = prompt;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          el.innerHTML = prompt.replace(/\n/g, '<br/>');
          el.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt }));
        }
      },
    ];
    for (const fn of writers) {
      try { fn(); } catch { /* noop */ }
      await new Promise((r) => setTimeout(r, 150));
      if (writeOk(el, prompt)) { ok = true; break; }
    }
    if (!ok) {
      throw new SubmitFailedError(this.provider, '输入框已找到但文本无法写入（写入后回读失败）');
    }

    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a', code: 'KeyA' }));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt, inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a', code: 'KeyA' }));
    el.blur();
    el.focus();
    await new Promise((r) => setTimeout(r, 250));
    console.log('[Kimi:adapter] setPrompt', { ok, readBack: readBack(el).length });
  }

  override async submit(): Promise<void> {
    await new Promise((r) => setTimeout(r, 250));

    // 收集所有候选，解析成真正可点击的按钮，过滤可见且未禁用，按文档顺序取最后一个（最具体的发送钮通常在后）
    const clickable = [...document.querySelectorAll(SUBMIT_SELECTORS.join(','))]
      .map((el) => resolveClickable(el))
      .filter((b): b is HTMLElement => !!b && isVisible(b) && !(b as HTMLButtonElement).disabled);

    if (clickable.length > 0) {
      const btn = clickable[clickable.length - 1];
      // 部分发送钮需要先聚焦输入框才会变为可点，这里确保输入框已有内容
      btn.click();
      console.log('[Kimi:adapter] submit via button:', btn.outerHTML.slice(0, 80));
      return;
    }

    // 兜底：Enter 提交
    const el = findVisibleInput();
    if (el) {
      const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true } as KeyboardEventInit;
      el.dispatchEvent(new KeyboardEvent('keydown', init));
      el.dispatchEvent(new KeyboardEvent('keypress', init));
      el.dispatchEvent(new KeyboardEvent('keyup', init));
      console.log('[Kimi:adapter] submit via Enter fallback');
      return;
    }
    throw new SubmitFailedError(this.provider, '找不到可点击的发送按钮，也没有输入框可作 Enter 兜底');
  }
}

export default KimiAdapter;
