// ============================================================
// shared/PromptTemplateMenu.tsx
// 提示词模板菜单：三界面（侧边栏 / 测试台 / 工作台）共用的
// 「模板」按钮 + 弹层（搜索 / 添加 / 存当前 / 删除 / 一键填充）。
//
// 样式自含（inline style）：颜色全部走 CSS 变量并带深色兜底——
// 侧边栏的 theme.css 定义了 --surface/--text/--accent 等变量，
// 弹层会自动跟随其明暗主题；工作台 / 测试台未定义这些变量，
// 走兜底的深色（与两处界面一致）。
//
// 注意：根节点固定挂 nodrag nowheel——工作台画布内防止拖节点/滚轮缩放，
// 其余界面无 reactflow，这两个类是惰性的。
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { usePromptTemplates } from './usePromptTemplates';
import { addPromptTemplate, deletePromptTemplate } from './promptTemplates';

export interface PromptTemplateMenuProps {
  /** 选中模板 → 一键填充；由调用方决定「替换」还是「光标处插入」 */
  onPick: (content: string) => void;
  /** 当前输入框内容（用于「存当前为模板」预填）；不传则不显示该按钮 */
  currentPrompt?: string;
  /** 触发按钮文案 */
  label?: string;
  /** 弹层弹出方向：输入框在页面底部时用 up，其余用 down */
  direction?: 'up' | 'down';
  /** 弹层宽度（px） */
  width?: number;
  /** 触发按钮附加 class（如工作台传 'nodrag' 以外还需要的局部样式） */
  buttonClassName?: string;
}

// ── 颜色：CSS 变量（侧边栏主题）+ 深色兜底（工作台/测试台）──
const C = {
  panelBg: 'var(--surface-2, #111a2e)',
  panelText: 'var(--text, #e5e9f0)',
  dim: 'var(--text-dim, #8b97ab)',
  border: 'var(--border, rgba(148, 163, 184, 0.22))',
  hover: 'var(--accent-weak, rgba(14, 165, 233, 0.12))',
  accent: 'var(--accent, #0ea5e9)',
  btnBg: 'var(--surface, rgba(30, 41, 59, 0.6))',
  danger: 'var(--danger, #f87171)',
  inputBg: 'var(--surface, rgba(15, 23, 42, 0.6))',
};

const listIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </svg>
);

export function PromptTemplateMenu({
  onPick,
  currentPrompt,
  label = '模板',
  direction = 'down',
  width = 320,
  buttonClassName,
}: PromptTemplateMenuProps) {
  const { templates } = usePromptTemplates();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // 添加表单（「新建」或「存当前」打开，content 预填）
  const [formOpen, setFormOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formContent, setFormContent] = useState('');
  const [saving, setSaving] = useState(false);
  // 删除二段确认：第一下 × 变红显示「确认」，再点才删
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [hoverBtn, setHoverBtn] = useState(false);

  const rootRef = useRef<HTMLSpanElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const confirmTimer = useRef<number | undefined>(undefined);

  // 点击面板外 → 关闭；Esc → 关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // 关闭时复位临时态
  useEffect(() => {
    if (!open) {
      setQuery('');
      setFormOpen(false);
      setFormName('');
      setFormContent('');
      setConfirmId(null);
    }
  }, [open]);

  // 二段确认 2s 未续点自动复位
  useEffect(() => {
    if (!confirmId) return;
    confirmTimer.current = window.setTimeout(() => setConfirmId(null), 2000);
    return () => {
      if (confirmTimer.current !== undefined) window.clearTimeout(confirmTimer.current);
    };
  }, [confirmId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) => t.name.toLowerCase().includes(q) || t.content.toLowerCase().includes(q)
    );
  }, [templates, query]);

  const openForm = useCallback(
    (prefill: boolean) => {
      setFormOpen(true);
      setFormContent(prefill ? (currentPrompt ?? '') : '');
      setFormName('');
      requestAnimationFrame(() => nameInputRef.current?.focus());
    },
    [currentPrompt]
  );

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const t = await addPromptTemplate(formName, formContent);
      if (t) {
        setFormOpen(false);
        setFormName('');
        setFormContent('');
      }
    } finally {
      setSaving(false);
    }
  }, [formName, formContent, saving]);

  const remove = useCallback(
    (id: string) => {
      if (confirmId !== id) {
        setConfirmId(id);
        return;
      }
      setConfirmId(null);
      void deletePromptTemplate(id);
    },
    [confirmId]
  );

  const canSaveCurrent = !!currentPrompt && currentPrompt.trim().length > 0;

  // ── 弹层定位 ──
  const panelStyle: CSSProperties =
    direction === 'up'
      ? { position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, width }
      : { position: 'absolute', top: 'calc(100% + 6px)', left: 0, width };

  return (
    <span ref={rootRef} className="nodrag nowheel" style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className={buttonClassName}
        title="提示词模板：搜索 / 添加 / 一键填充"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHoverBtn(true)}
        onMouseLeave={() => setHoverBtn(false)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '5px 11px',
          fontSize: 12,
          borderRadius: 7,
          cursor: 'pointer',
          background: hoverBtn ? C.hover : C.btnBg,
          color: C.dim,
          border: `1px solid ${C.border}`,
          whiteSpace: 'nowrap',
          transition: 'all 0.15s ease',
        }}
      >
        {listIcon}
        {label}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="提示词模板"
          style={{
            ...panelStyle,
            zIndex: 100,
            background: C.panelBg,
            color: C.panelText,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            boxShadow: 'var(--shadow, 0 16px 48px rgba(2, 6, 18, 0.6))',
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            maxHeight: 340,
            boxSizing: 'border-box',
          }}
        >
          {/* 搜索 */}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索模板名或内容…"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '6px 10px',
              fontSize: 12,
              borderRadius: 7,
              border: `1px solid ${C.border}`,
              background: C.inputBg,
              color: C.panelText,
              outline: 'none',
            }}
          />

          {/* 动作行 */}
          <div style={{ display: 'flex', gap: 6 }}>
            {canSaveCurrent && !formOpen && (
              <ActionButton onClick={() => openForm(true)} title="把当前输入框内容存为模板">
                📥 存当前为模板
              </ActionButton>
            )}
            {!formOpen && <ActionButton onClick={() => openForm(false)}>＋ 新建模板</ActionButton>}
          </div>

          {/* 添加表单 */}
          {formOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, border: `1px solid ${C.border}`, borderRadius: 8 }}>
              <input
                ref={nameInputRef}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && formName.trim() && formContent.trim()) void save();
                }}
                placeholder="模板名称，如「周报生成」"
                style={{
                  padding: '6px 10px',
                  fontSize: 12,
                  borderRadius: 7,
                  border: `1px solid ${C.border}`,
                  background: C.inputBg,
                  color: C.panelText,
                  outline: 'none',
                }}
              />
              <textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="模板内容（支持 {{变量}} 占位）"
                rows={3}
                style={{
                  padding: '6px 10px',
                  fontSize: 12,
                  borderRadius: 7,
                  border: `1px solid ${C.border}`,
                  background: C.inputBg,
                  color: C.panelText,
                  outline: 'none',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  lineHeight: 1.5,
                }}
              />
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <ActionButton onClick={() => setFormOpen(false)}>取消</ActionButton>
                <ActionButton
                  onClick={() => void save()}
                  disabled={saving || !formName.trim() || !formContent.trim()}
                  primary
                >
                  {saving ? '保存中…' : '保存模板'}
                </ActionButton>
              </div>
            </div>
          )}

          {/* 模板列表 */}
          <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 32 }}>
            {filtered.length === 0 ? (
              <div style={{ fontSize: 12, color: C.dim, padding: '10px 4px', textAlign: 'center' }}>
                {templates.length === 0
                  ? '还没有模板。输入常用提问后点「存当前为模板」，或「新建模板」。'
                  : `没有匹配「${query.trim()}」的模板`}
              </div>
            ) : (
              filtered.map((t) => (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  title="点击填充到输入框"
                  onClick={() => {
                    onPick(t.content);
                    setOpen(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      onPick(t.content);
                      setOpen(false);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 6,
                    padding: '7px 9px',
                    borderRadius: 7,
                    border: `1px solid transparent`,
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = C.hover;
                    e.currentTarget.style.borderColor = C.border;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.borderColor = 'transparent';
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: C.panelText, marginBottom: 2 }}>
                      {t.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: C.dim,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        maxHeight: 32,
                        overflow: 'hidden',
                        lineHeight: '16px',
                      }}
                    >
                      {t.content.slice(0, 120)}
                    </div>
                  </div>
                  <button
                    type="button"
                    title={confirmId === t.id ? '再点一次确认删除' : '删除该模板'}
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(t.id);
                    }}
                    style={{
                      flexShrink: 0,
                      border: 'none',
                      borderRadius: 6,
                      padding: '2px 7px',
                      fontSize: 11,
                      cursor: 'pointer',
                      lineHeight: '18px',
                      background: confirmId === t.id ? C.danger : 'transparent',
                      color: confirmId === t.id ? '#fff' : C.dim,
                    }}
                  >
                    {confirmId === t.id ? '确认' : '×'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </span>
  );
}

function ActionButton({
  children,
  onClick,
  title,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  primary?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '4px 10px',
        fontSize: 11.5,
        borderRadius: 7,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        border: `1px solid ${primary ? C.accent : C.border}`,
        background: primary ? C.accent : hover ? C.hover : 'transparent',
        color: primary ? '#fff' : C.dim,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}
