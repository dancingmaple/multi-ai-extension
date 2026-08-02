import type { ProviderName } from '../../shared/types';
import { BaseAdapter } from './base';
import { SubmitFailedError } from '../../shared/utils';

/* ============================================================
   豆包适配器 · inner-v2（写入闭环 + 提交闭环）
   ────────────────────────────────────────────────────────────
   修复「无法发送」根因：旧版 setPrompt 调 super，裸 textarea 排首位，
   把字写进了页面隐藏的 textarea，可见 contenteditable 始终为空，
   发送按钮恒 disabled，submit 全失败。
   本版：
     · setPrompt 不调 super，按"contenteditable/placeholder 优先 + 必须可见"
       找框，三种写法逐个试 + 写后回读核对，字真进去才停。
     · submit 用「发送后输入框清空 / 页面长出回答」做成功信号，
       五种提交方式逐个试，命中即停，闭环验证。
     · 抓取沿用 inner-v1 剪刀法 + 门闩，未改动。
   F12 过滤 [Doubao:adapter] 看 write ok / submit ok 日志。
   ============================================================ */
console.log('[Doubao:adapter] build=inner-v2 2026-08-02');

const CONFIG = {
  /* abstract 契约选择器（顺序不敏感，setPrompt 用下面的 PRIO 自控） */
  INPUT_SELECTORS: [
    '[data-testid="chat_input_input"]',
    'div[contenteditable="true"]',
    '[placeholder*="豆包"]', '[placeholder*="发消息"]', '[placeholder*="发送"]',
    '[placeholder*="输入"]', '[placeholder*="Message" i]',
    'textarea',
  ],
  SUBMIT_SELECTORS: [
    'button[data-testid="chat_input_send_button"]',
    'button[aria-label*="Send" i]', 'button[aria-label*="发送"]',
    'button[data-testid*="send" i]', 'button[class*="send" i]',
    'button[aria-label*="submit" i]', 'form button[type="submit"]',
  ],
  RESPONSE_SELECTORS: ['[data-testid="message-list"]', 'main', 'body'],
  LOGIN_SELECTORS: ['a[href*="/login"]', 'a[href*="/signin"]', 'a[href*="passport"]'],

  /* 抓取相关（与 inner-v1 相同） */
  HEAD_LINE: /^(思考了|已思考|思考中|Thought for|Thinking|Reasoned|Reasoning|搜索了|联网搜索|Searching|Searched|Found\s+\d+|阅读了|Read\s+\d+|查看了|引用了|\d+\s*个\s*(网页|来源|结果|web\s*pages?)|DeepThink|Instant|深度思考|联网搜索中|搜索中|生成中)/i,
  TAIL_LINE: /^(复制|点赞|点踩|重新生成|再生成|分享|引用|参考来源|参考|来源|DeepThink|联网搜索|Instant|搜索|给\s*豆包|发消息|发送|Message|⎘||👎|◎|↻)/i,
  PROGRESS: /(思考中|搜索中|联网搜索中|生成中|正在搜索|正在思考|正在阅读|正在联网|Searching(?! for)|Reading\s+\d)/i,
  PLACEHOLDER_RE: /^[.…·••\s…\u2026\u00b7]*$/,

  HARD_STABLE: 2500, SOFT_STABLE: 6000, ABS_CAP: 12000,
  HARD_TIMEOUT: 75000,
  THINKING_PLACEHOLDER: '⏳ 思考 / 联网检索中…',
  STREAM_THROTTLE_MS: 250, POLL_MS: 400,

  /* 写入/提交闭环参数 */
  WRITE_VERIFY_MS: 130,      // 每种写法后等多久再回读
  SUBMIT_VERIFY_MS: 750,     // 每种提交方式后等多久再验证
  DEBUG: true,
};

const log = (...a: unknown[]) => { if (CONFIG.DEBUG) console.log('[Doubao:adapter]', ...a); };

/* ---------- DOM 工具 ---------- */
function isVisible(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.01;
}
function isEditable(el: Element): boolean {
  return el.getAttribute?.('contenteditable') === 'true' || (el as HTMLElement).isContentEditable === true;
}
function readBack(el: HTMLElement | null): string {
  if (!el) return '';
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return (el.value || '').trim();
  return ((el as HTMLElement).innerText || el.textContent || '').trim();
}

/* 找可见输入框：contenteditable / placeholder 优先，textarea 兜底且必须可见 */
const INPUT_PRIO = [
  '[data-testid="chat_input_input"]',
  '[placeholder*="豆包"]', '[placeholder*="发消息"]', '[placeholder*="发送"]',
  '[placeholder*="输入"]', '[placeholder*="问"]', '[placeholder*="Message" i]',
  'div[contenteditable="true"]', '[class*="editor"][contenteditable="true"]',
  'textarea',
];
function findVisibleInput(): HTMLElement | null {
  for (const s of INPUT_PRIO) {
    const el = [...document.querySelectorAll(s)].find(isVisible) as HTMLElement | undefined;
    if (el) return el;
  }
  return null;
}

/* 三种写入法 */
function writeExec(el: HTMLElement, value: string): void {
  el.focus();
  try { document.execCommand('selectAll', false); document.execCommand('insertText', false, value); } catch { /* noop */ }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
}
function writeNative(el: HTMLElement, value: string): void {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    writeExec(el, value);
  }
}
function writeText(el: HTMLElement, value: string): void {
  el.focus();
  el.textContent = value;
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
}
function writeOk(el: HTMLElement, prompt: string): boolean {
  const got = readBack(el);
  const head = prompt.replace(/\s/g, '').slice(0, 8);
  return got.replace(/\s/g, '').includes(head) || got.length >= Math.max(4, Math.floor(prompt.length * 0.8));
}

/* 收集发送按钮候选：语义选择器 + 输入框同容器末尾按钮（兜底大招） */
function collectSendButtons(): HTMLElement[] {
  const bySel = [...document.querySelectorAll(CONFIG.SUBMIT_SELECTORS.join(','))].filter(isVisible) as HTMLElement[];
  const inputEl = findVisibleInput();
  const byContainer: HTMLElement[] = [];
  if (inputEl) {
    let cont: HTMLElement | null = inputEl;
    for (let i = 0; i < 6 && cont; i++) {
      cont = cont.parentElement;
      if (cont && cont.querySelectorAll('button').length >= 1) break;
    }
    if (cont) {
      const inC = [...cont.querySelectorAll('button')].filter(isVisible) as HTMLElement[];
      byContainer.push(...inC);
    }
  }
  const seen = new Set<HTMLElement>();
  const out: HTMLElement[] = [];
  for (const b of bySel.concat(byContainer)) { if (!seen.has(b)) { seen.add(b); out.push(b); } }
  return out;
}

/* 抓取相关（与 inner-v1 相同） */
function rootEl(): Element {
  return document.querySelector('[data-testid="message-list"]') || document.querySelector('main') || document.body;
}
function grabText(): string {
  const r = rootEl();
  return ((r && (r as HTMLElement).innerText) || document.body.innerText || '').replace(/\u00a0/g, ' ');
}
function grabLen(): number { return grabText().length; }
function extractAnswer(text: string, prompt: string): string {
  const lines = text.split('\n').map((s) => s.replace(/\s+$/, '').replace(/^\s+/, '')).filter((s) => s.length > 0);
  const key = (prompt || '').replace(/\s/g, '').slice(0, 12);
  let q = -1;
  if (key) for (let i = lines.length - 1; i >= 0; i--) { if (lines[i].replace(/\s/g, '').includes(key)) { q = i; break; } }
  if (q < 0) return '';
  let body = lines.slice(q + 1);
  while (body.length && CONFIG.HEAD_LINE.test(body[0])) body.shift();
  while (body.length && CONFIG.TAIL_LINE.test(body[body.length - 1])) body.pop();
  return body.join('\n').trim();
}

/* ============================================================
   适配器
   ============================================================ */
export class DoubaoAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'doubao';
  readonly inputSelectors = CONFIG.INPUT_SELECTORS;
  readonly submitSelectors = CONFIG.SUBMIT_SELECTORS;
  readonly responseSelectors = CONFIG.RESPONSE_SELECTORS;
  readonly loginSelectors = CONFIG.LOGIN_SELECTORS;

  private lastPrompt = '';
  private preSendLen = 0;

  override detectLoginRequired(): boolean {
    if (super.detectLoginRequired()) return true;
    if (/\/login|\/signin|\/auth|passport/i.test(location.href)) return true;
    const hasInput = !!findVisibleInput();
    const loginBtn = [...document.querySelectorAll('button,a')].some((b) => /登录|sign\s*in|log\s*in/i.test((b.textContent || '').trim()));
    return !hasInput && loginBtn;
  }

  /* ▼▼▼ 写入闭环：不调 super，可见优先 + 三种写法 + 写后回读 ▼▼▼ */
  override async setPrompt(prompt: string): Promise<void> {
    this.lastPrompt = prompt;
    this.preSendLen = grabLen();

    const el = findVisibleInput();
    if (!el) throw new SubmitFailedError(this.provider, '找不到可见输入框');
    el.focus();
    await new Promise((r) => setTimeout(r, 80));

    const writers: Array<[string, () => void]> = [
      ['exec', () => writeExec(el, prompt)],
      ['native', () => writeNative(el, prompt)],
      ['textContent', () => writeText(el, prompt)],
      ['exec2', () => { el.focus(); writeExec(el, prompt); }],
    ];
    let ok = false;
    let used = '';
    for (const [name, fn] of writers) {
      try { fn(); } catch { /* noop */ }
      await new Promise((r) => setTimeout(r, CONFIG.WRITE_VERIFY_MS));
      if (writeOk(el, prompt)) { ok = true; used = name; break; }
    }
    // 唤醒发送按钮（豆包"空内容禁用"）
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a', code: 'KeyA' }));
    await new Promise((r) => setTimeout(r, 300));

    log('setPrompt', { ok, used, readBack: readBack(el).length, editable: isEditable(el) });
    if (!ok) log('setPrompt 警告：回读未确认写入，submit 将尝试重写');
  }

  /* ▼▼▼ 提交闭环：发送后输入框清空 / 页面长出回答 = 成功 ▼▼▼ */
  override async submit(): Promise<void> {
    await new Promise((r) => setTimeout(r, 200));

    // 先确认输入框非空；若空，重写一次
    let inputEl = findVisibleInput();
    if (!inputEl || readBack(inputEl).length < 2) {
      log('submit 前输入框为空，重写一次');
      if (inputEl) await this.setPrompt(this.lastPrompt);
      inputEl = findVisibleInput();
      if (!inputEl || readBack(inputEl).length < 2) {
        throw new SubmitFailedError(this.provider, '写入失败：输入框仍为空');
      }
    }

    const baseLen = this.preSendLen;
    const submitted = (): boolean => {
      const e = findVisibleInput();
      const cleared = !e || readBack(e).length < 2;          // 豆包发送成功后清空输入框
      const grew = grabLen() > baseLen + 30;                 // 或回答已开始渲染
      return cleared || grew;
    };

    const fireEnter = (el: HTMLElement) => {
      const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, isComposing: false } as KeyboardEventInit;
      el.dispatchEvent(new KeyboardEvent('keydown', init));
      el.dispatchEvent(new KeyboardEvent('keypress', init));
      el.dispatchEvent(new KeyboardEvent('keyup', init));
    };

    const strategies: Array<[string, () => void]> = [
      ['clickEnabledLast', () => { const b = collectSendButtons().filter((x) => !(x as HTMLButtonElement).disabled); const t = b[b.length - 1]; if (t) t.click(); }],
      ['enter', () => { const e = findVisibleInput(); if (e) { e.focus(); fireEnter(e); } }],
      ['clickEnabledFirst', () => { const b = collectSendButtons().filter((x) => !(x as HTMLButtonElement).disabled); if (b[0]) b[0].click(); }],
      ['clickForceLast', () => { const b = collectSendButtons(); const t = b[b.length - 1]; if (t) t.click(); }],
      ['refocusEnter', () => { const e = findVisibleInput(); if (e) { e.blur(); e.focus(); fireEnter(e); } }],
      ['clickSvgBtn', () => {
        const e = findVisibleInput(); if (!e) return;
        let cont: HTMLElement | null = e;
        for (let i = 0; i < 6 && cont; i++) { cont = cont.parentElement; if (cont && cont.querySelector('button svg, button [class*="icon"]')) break; }
        const btn = cont ? ([...cont.querySelectorAll('button')].filter(isVisible) as HTMLElement[]).pop() : null;
        if (btn) btn.click();
      }],
    ];

    for (const [name, fn] of strategies) {
      try { fn(); } catch { /* noop */ }
      await new Promise((r) => setTimeout(r, CONFIG.SUBMIT_VERIFY_MS));
      if (submitted()) { log('submit ok via', name); return; }
      log('submit try failed:', name);
    }

    throw new SubmitFailedError(this.provider, '所有提交方式均未使输入框清空/页面响应');
  }

  /* 抓取：与 inner-v1 完全相同 */
  override startStreaming(
    onUpdate: (t: string) => void,
    onDone: (t: string) => void,
    onError: (e: Error) => void,
  ): () => void {
    let stopped = false;
    const prompt = this.lastPrompt;
    const gateLen = this.preSendLen;
    let started = false;
    let lastReal = '';
    let stableSince = 0;
    let lastEmit = 0;
    let lastSent = '';
    const t0 = Date.now();

    const tick = () => {
      if (stopped) return;
      const now = Date.now();
      const text = grabText();
      if (!started && text.length > gateLen + 12) { started = true; log('GATE OPEN len', text.length, '>', gateLen); }
      const real = started ? extractAnswer(text, prompt) : '';
      const isPlaceholder = !real || CONFIG.PLACEHOLDER_RE.test(real);
      const body = isPlaceholder ? '' : real;
      const show = body || (started ? CONFIG.THINKING_PLACEHOLDER : '');
      if (show && show !== lastSent && now - lastEmit >= CONFIG.STREAM_THROTTLE_MS) { lastSent = show; lastEmit = now; onUpdate(show); }
      if (body) { if (body !== lastReal) { lastReal = body; stableSince = now; } } else { lastReal = ''; stableSince = 0; }
      const hasProgress = CONFIG.PROGRESS.test(body);
      const elapsed = body ? now - stableSince : 0;
      const need = hasProgress ? CONFIG.SOFT_STABLE : CONFIG.HARD_STABLE;
      const done = !!body && body === lastReal && (elapsed >= need || elapsed >= CONFIG.ABS_CAP);
      log('tick', { started, bodyLen: body.length, hasProgress, stableMs: elapsed, need, done });
      if (done) {
        stopped = true;
        const final = extractAnswer(grabText(), prompt) || body;
        log('DONE finalLen=', final.length);
        onUpdate(final); onDone(final); cleanup();
        return;
      }
      if (now - t0 >= CONFIG.HARD_TIMEOUT) {
        stopped = true; cleanup();
        const final = extractAnswer(grabText(), prompt);
        if (final && !CONFIG.PLACEHOLDER_RE.test(final)) { log('HARD_TIMEOUT 有正文'); onDone(final); }
        else { log('HARD_TIMEOUT 无正文'); onError(new Error('StreamTimeoutError: 超时未抓到回答，可点重发')); }
      }
    };

    const mo = new MutationObserver(() => { if (!stopped) tick(); });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    const poll = window.setInterval(tick, CONFIG.POLL_MS);
    function cleanup() { mo.disconnect(); clearInterval(poll); }
    tick();
    return cleanup;
  }
}

export default DoubaoAdapter;