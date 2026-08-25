// ============================================================
// content/diagnose.ts — 页面元素诊断
// 在 AI 网页内扫描输入框 / 发送按钮 / 回答区域，返回结构化信息，
// 用于排查「网页 UI 变化后定位失败」的问题。结果会渲染到测试台界面。
// ============================================================

import { getCssSelector } from './pickElement';

interface ElInfo {
  selector: string;
  tag: string;
  cls: string;
  ariaLabel: string;
  placeholder: string;
  contenteditable: string;
  title: string;
  visible: boolean;
  w: number;
  h: number;
  disabled: boolean | null;
  text: string;
}

function visible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.01;
}

function describe(el: Element): ElInfo {
  const html = el as HTMLElement;
  const text = (html.innerText || html.textContent || '').trim().slice(0, 60);
  return {
    selector: getCssSelector(el),
    tag: el.tagName.toLowerCase(),
    cls: (html.className && typeof html.className === 'string' ? html.className : '').slice(0, 80),
    ariaLabel: html.getAttribute('aria-label') || '',
    placeholder: (html as HTMLInputElement).placeholder || html.getAttribute('data-placeholder') || '',
    contenteditable: html.getAttribute('contenteditable') || '',
    title: html.getAttribute('title') || '',
    visible: visible(el),
    w: Math.round(html.getBoundingClientRect().width),
    h: Math.round(html.getBoundingClientRect().height),
    disabled: html.hasAttribute('disabled') ? true : html.hasAttribute('aria-disabled') ? true : null,
    text,
  };
}

export function runDiagnose(provider: string): Record<string, unknown> {
  const ce = [...document.querySelectorAll('[contenteditable="true"]')].map(describe);
  const ta = [...document.querySelectorAll('textarea')].map(describe);
  const inputs = [...document.querySelectorAll('input')].map(describe);
  const btns = [...document.querySelectorAll('button')].map(describe);

  // 判断哪个最像输入/发送/回答
  const guessInput = [...ce, ...ta, ...inputs].filter((e) => e.visible).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const guessSubmit = btns
    .filter((b) => b.visible && /(send|submit|\u53d1\u9001|\u63d0\u4ea4|arrow|\u2192)/i.test(b.ariaLabel + ' ' + b.title))
    .sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const guessResponse = null; // 回答区域通常在提交后才出现，这里只列候选

  return {
    provider,
    url: location.href,
    title: document.title,
    total: {
      contenteditable: ce.length,
      textarea: ta.length,
      input: inputs.length,
      button: btns.length,
    },
    inputCandidates: [...ce, ...ta, ...inputs].filter((e) => e.visible).slice(0, 12),
    buttonCandidates: btns.filter((b) => b.visible).slice(0, 20),
    guess: {
      input: guessInput || null,
      submit: guessSubmit || null,
      response: guessResponse,
    },
  };
}
