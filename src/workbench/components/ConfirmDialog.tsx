// ============================================================
// workbench/components/ConfirmDialog.tsx
// 自定义确认弹层：替代原生 confirm()。原生 confirm 会阻塞主线程、
// 在扩展内联场景不可靠，且无法做无障碍（aria-modal）。
// ============================================================
import { useEffect } from 'react';
import { CloseIcon } from './icons';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作（删除/清空）：确认按钮用 danger 红色样式 */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onConfirm, onCancel]);

  return (
    <div
      className="wb-confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="wb-confirm">
        <div className="wb-confirm__head">
          <span>{title}</span>
          <button className="wb-modal__close" onClick={onCancel} title="关闭" aria-label="关闭">
            <CloseIcon size={13} />
          </button>
        </div>
        <div className="wb-confirm__body">{message}</div>
        <div className="wb-confirm__foot">
          <button className="wb-btn wb-btn--sm" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            className={`wb-btn wb-btn--sm ${danger ? 'wb-btn--danger' : 'wb-btn--primary'}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
