import type { ElementRole } from '../shared/types';

/**
 * 手动选取元素：在 iframe 内悬停高亮 + 点击捕获元素选择器。
 * 用于适配 AI 网页 UI 变化——用户点选输入框 / 发送按钮 / 回答区域，
 * 把选择器回传给父页面永久保存。
 */

const OVERLAY_ID = 'multiAI-pick-overlay';
const LABEL_ID = 'multiAI-pick-label';

/**
 * 选取稳定的语义属性选择器，优先级高于 :nth-child（网站改版后更不易失效）。
 * 命中即返回，作为该层的选择器片段。
 */
function pickStableAttribute(el: Element): string | null {
  const testid = el.getAttribute('data-testid');
  if (testid) return `[data-testid="${CSS.escape(testid)}"]`;
  const aria = el.getAttribute('aria-label');
  if (aria) return `[aria-label="${CSS.escape(aria)}"]`;
  const role = el.getAttribute('role');
  if (role) return `[role="${CSS.escape(role)}"]`;
  const name = el.getAttribute('name');
  if (name) return `[name="${CSS.escape(name)}"]`;
  return null;
}

export function getCssSelector(el: Element): string {
  if (!(el instanceof Element)) return '';
  if (el.id) return '#' + CSS.escape(el.id);

  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement) {
    let sel = cur.tagName.toLowerCase();
    if (cur.id) {
      sel = '#' + CSS.escape(cur.id);
      parts.unshift(sel);
      break;
    }
    // 优先采用稳定语义属性，单段即可唯一定位，避免依赖脆弱的层级
    const stable = pickStableAttribute(cur);
    if (stable) {
      parts.unshift(stable);
      break;
    }
    const cls = [...cur.classList].filter((c) => c && !c.startsWith('__')).join('.');
    if (cls) sel += '.' + cls;
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const sameTag = [...parent.children].filter((c) => c.tagName === cur!.tagName);
      if (sameTag.length > 1) {
        const idx = [...parent.children].indexOf(cur as Element) + 1;
        sel += ':nth-child(' + idx + ')';
      }
    }
    parts.unshift(sel);
    cur = parent;
  }
  return parts.join(' > ');
}

export function startPick(
  role: ElementRole,
  onResult: (role: ElementRole, selector: string) => void,
  onCancel?: () => void
): () => void {
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, {
    position: 'fixed',
    pointerEvents: 'none',
    border: '3px solid #ff3b30',
    background: 'rgba(255,59,48,0.12)',
    borderRadius: '4px',
    zIndex: '2147483647',
    transition: 'all 100ms ease-out',
    boxSizing: 'border-box',
    display: 'none',
  } as CSSStyleDeclaration);

  const label = document.createElement('div');
  label.id = LABEL_ID;
  Object.assign(label.style, {
    position: 'fixed',
    pointerEvents: 'none',
    background: '#111',
    color: '#fff',
    fontSize: '12px',
    fontFamily: 'monospace',
    padding: '4px 8px',
    borderRadius: '4px',
    zIndex: '2147483647',
    maxWidth: '70vw',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
    display: 'none',
  } as CSSStyleDeclaration);

  document.body.appendChild(overlay);
  document.body.appendChild(label);

  const roleText = role === 'input' ? '输入框' : role === 'submit' ? '发送按钮' : '回答区域';
  label.textContent = '点选「' + roleText + '」（Esc 取消）';

  const moveHandler = (ev: MouseEvent) => {
    const target = ev.target as Element | null;
    if (!target || !(target instanceof Element)) {
      overlay.style.display = 'none';
      label.style.display = 'none';
      return;
    }
    const r = target.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = r.left + 'px';
    overlay.style.top = r.top + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';

    label.style.display = 'block';
    const lx = Math.min(r.left, window.innerWidth - 300);
    const ly = r.top > 40 ? r.top - 32 : r.bottom + 8;
    label.style.left = lx + 'px';
    label.style.top = ly + 'px';
    label.textContent = '点选「' + roleText + '」→ ' + getCssSelector(target).slice(0, 80) + '（Esc 取消）';
  };

  const clickHandler = (ev: MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    const target = ev.target as Element | null;
    if (!target || !(target instanceof Element)) return;
    const selector = getCssSelector(target);
    cleanup();
    onResult(role, selector);
  };

  const keyHandler = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      cleanup();
      onCancel?.();
    }
  };

  const cleanup = () => {
    document.removeEventListener('mousemove', moveHandler, true);
    document.removeEventListener('click', clickHandler, true);
    document.removeEventListener('keydown', keyHandler, true);
    overlay.remove();
    label.remove();
  };

  document.addEventListener('mousemove', moveHandler, true);
  document.addEventListener('click', clickHandler, true);
  document.addEventListener('keydown', keyHandler, true);

  return cleanup;
}
