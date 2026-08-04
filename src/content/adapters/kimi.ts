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
      // 首选：直接写 textContent 并派发 React 能识别的 input 事件（实测 Kimi 走这条成功）
      () => {
        el.focus();
        if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
          el.value = prompt;
        } else {
          el.textContent = prompt;
        }
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt, inputType: 'insertText' }));
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
      // 兜底：Selection/Range 真正插入文本节点（对某些 React 编辑器更稳）
      () => writeRange(el, prompt),
    ];
    for (const fn of writers) {
      try { fn(); } catch { /* noop */ }
      await new Promise((r) => setTimeout(r, 150));
      if (writeOk(el, prompt)) { ok = true; break; }
    }
    if (!ok) {
      throw new SubmitFailedError(this.provider, '输入框已找到但文本无法写入（写入后回读失败）');
    }

    el.focus();
    await new Promise((r) => setTimeout(r, 200));
    console.log('[Kimi:adapter] setPrompt', { ok, readBack: readBack(el).length });
  }

  /**
   * Kimi 的发送按钮是 .send-button-container（一个普通 <div>，React 把 onClick 挂在上边），
   * 且只接受 isTrusted 的真实用户手势——content script 用 dispatchEvent 派发的事件一律被拒。
   * 因此这里不能自己 click：写完文本后，把发送钮在 iframe 视口内的坐标告诉父窗口（sidepanel），
   * 由 background 用 chrome.debugger 派发受信任点击。
   */
  override async submit(): Promise<void> {
    await new Promise((r) => setTimeout(r, 200));

    const send = document.querySelector('.send-button-container') as HTMLElement | null;
    if (!send || !isVisible(send)) {
      const anySend = [...document.querySelectorAll(SUBMIT_SELECTORS.join(','))].find(isVisible) as HTMLElement | null;
      if (!anySend) {
        throw new SubmitFailedError(this.provider, '找不到发送按钮（.send-button-container）');
      }
      throw new SubmitFailedError(this.provider, '发送按钮存在但不可见，无法计算坐标发起受信任点击');
    }

    const r = send.getBoundingClientRect();
    const rect = { left: r.left, top: r.top, width: r.width, height: r.height };
    // 跨域 iframe → 父窗口（sidepanel）的 postMessage 是允许的
    try {
      window.parent.postMessage({ __kimiSend: true, rect }, '*');
      console.log('[Kimi:adapter] submit → 已请求父窗口受信任点击', rect);
    } catch (e) {
      throw new SubmitFailedError(this.provider, 'postMessage 给父窗口失败：' + (e instanceof Error ? e.message : String(e)));
    }
    // 父窗口会算绝对坐标并触发 chrome.debugger 点击；这里无需再等
  }
}

export default KimiAdapter;
