// ============================================================
// workbench/components/SavedWorkflowsPanel.tsx
// 已保存工作流（可复用库）浮层：保存当前为新工作流、打开、重命名、删除。
// ============================================================
import { useEffect, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { SaveIcon, CloseIcon } from './icons';
import { ConfirmDialog } from './ConfirmDialog';

export function SavedWorkflowsPanel() {
  const saved = useWorkflowStore((s) => s.savedWorkflows);
  const saveWorkflowAs = useWorkflowStore((s) => s.saveWorkflowAs);
  const loadSavedWorkflow = useWorkflowStore((s) => s.loadSavedWorkflow);
  const renameSavedWorkflow = useWorkflowStore((s) => s.renameSavedWorkflow);
  const deleteSavedWorkflow = useWorkflowStore((s) => s.deleteSavedWorkflow);
  const closePanel = useWorkflowStore((s) => s.closePanel);

  const [name, setName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 确认弹层打开时，Esc 交由 ConfirmDialog 处理，避免连层面板一起关掉
        if (confirmDeleteId) return;
        closePanel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closePanel, confirmDeleteId]);

  const handleSave = async () => {
    await saveWorkflowAs(name);
    setName('');
  };

  const startRename = (id: string, current: string) => {
    setRenamingId(id);
    setRenameVal(current);
  };

  const commitRename = async () => {
    if (renamingId) await renameSavedWorkflow(renamingId, renameVal);
    setRenamingId(null);
    setRenameVal('');
  };

  return (
    <div className="wb-overlay" onClick={closePanel}>
      <div className="wb-modal wb-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="wb-modal__head">
          <span><SaveIcon size={16} />我的工作流</span>
          <button className="wb-modal__close" onClick={closePanel} title="关闭">
            <CloseIcon size={13} />
          </button>
        </div>

        <div className="wb-modal__body">
          {/* 保存当前为新工作流 */}
          <div className="wb-save-form">
            <input
              className="wb-input wb-save-form__input"
              value={name}
              placeholder="给当前工作流起个名字，如「每周竞品摘要」"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSave();
              }}
            />
            <button className="wb-btn wb-btn--primary" onClick={() => void handleSave()}>
              保存当前为新工作流
            </button>
          </div>

          {saved.length === 0 ? (
            <div className="wb-empty">还没有保存的工作流。编辑好画布后点上方按钮保存即可复用。</div>
          ) : (
            <ul className="wb-list">
              {saved.map((w) => (
                <li key={w.id} className="wb-list__item">
                  <div className="wb-list__main">
                    {renamingId === w.id ? (
                      <input
                        className="wb-input wb-list__rename"
                        value={renameVal}
                        autoFocus
                        onChange={(e) => setRenameVal(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename();
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        onBlur={() => void commitRename()}
                      />
                    ) : (
                      <div className="wb-list__title" onDoubleClick={() => startRename(w.id, w.name)}>
                        {w.name}
                      </div>
                    )}
                    <div className="wb-list__meta">
                      {w.nodes.length} 个节点 · 更新于 {new Date(w.updatedAt).toLocaleString('zh-CN')}
                    </div>
                  </div>
                  <div className="wb-list__actions">
                    <button className="wb-btn wb-btn--sm" onClick={() => void loadSavedWorkflow(w.id)}>
                      打开
                    </button>
                    <button
                      className="wb-btn wb-btn--sm"
                      onClick={() => startRename(w.id, w.name)}
                    >
                      重命名
                    </button>
                    <button
                      className="wb-btn wb-btn--sm wb-btn--danger"
                      onClick={() => setConfirmDeleteId(w.id)}
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="wb-modal__foot">双击标题也可快速重命名。</div>
      </div>

      {confirmDeleteId && (
        <ConfirmDialog
          title="删除工作流"
          message={`确定删除工作流「${saved.find((x) => x.id === confirmDeleteId)?.name ?? ''}」？此操作不可撤销。`}
          confirmText="删除"
          danger
          onConfirm={() => {
            void deleteSavedWorkflow(confirmDeleteId);
            setConfirmDeleteId(null);
          }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  );
}
