// ============================================================
// workbench/components/RunHistoryPanel.tsx
// 工作流运行历史：列表 + 详情（Markdown 预览 / 复制 / 导出）+ 删除 / 清空。
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { buildRunMarkdown, runStatusLabel } from '../utils/export';
import { HistoryIcon, CloseIcon, CopyIcon, DownloadIcon, CheckIcon, ArrowLeftIcon } from './icons';

export function RunHistoryPanel() {
  const history = useWorkflowStore((s) => s.runHistory);
  const deleteRunHistory = useWorkflowStore((s) => s.deleteRunHistory);
  const clearRunHistory = useWorkflowStore((s) => s.clearRunHistory);
  const exportRun = useWorkflowStore((s) => s.exportRun);
  const closePanel = useWorkflowStore((s) => s.closePanel);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const detail = useMemo(
    () => history.find((r) => r.id === detailId) ?? null,
    [history, detailId]
  );
  const md = useMemo(() => (detail ? buildRunMarkdown(detail) : ''), [detail]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (detailId) setDetailId(null);
        else closePanel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closePanel, detailId]);

  const copyMd = async () => {
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时忽略 */
    }
  };

  return (
    <div className="wb-overlay" onClick={detailId ? () => setDetailId(null) : closePanel}>
      <div className="wb-modal wb-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="wb-modal__head">
          <span><HistoryIcon size={16} />运行历史</span>
          <button className="wb-modal__close" onClick={closePanel} title="关闭">
            <CloseIcon size={13} />
          </button>
        </div>

        <div className="wb-modal__body">
          {detail ? (
            <div className="wb-detail">
              <div className="wb-detail__bar">
                <button className="wb-btn wb-btn--sm" onClick={() => setDetailId(null)}>
                  <ArrowLeftIcon size={12} />
                  返回列表
                </button>
                <div className="wb-detail__title">{detail.name}</div>
                <div className="wb-detail__acts">
                  <button className="wb-btn wb-btn--sm" onClick={() => void copyMd()}>
                    {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                    {copied ? '已复制' : '复制 MD'}
                  </button>
                  <button
                    className="wb-btn wb-btn--sm wb-btn--primary"
                    onClick={() => exportRun(detail.id)}
                  >
                    <DownloadIcon size={12} />
                    下载 .md
                  </button>
                </div>
              </div>
              <pre className="wb-detail__md">{md}</pre>
            </div>
          ) : history.length === 0 ? (
            <div className="wb-empty">暂无运行记录。点「运行工作流」后，每次运行的完整过程与结果都会自动归档在这里。</div>
          ) : (
            <ul className="wb-list">
              {history.map((r) => (
                <li key={r.id} className="wb-list__item">
                  <div className="wb-list__main">
                    <div className="wb-list__title">{r.name}</div>
                    <div className="wb-list__meta">
                      {new Date(r.createdAt).toLocaleString('zh-CN')} · {r.nodeCount} 节点 ·{' '}
                      <span className={`wb-badge wb-badge--${r.status}`}>{runStatusLabel(r.status)}</span>
                    </div>
                  </div>
                  <div className="wb-list__actions">
                    <button className="wb-btn wb-btn--sm" onClick={() => setDetailId(r.id)}>
                      查看
                    </button>
                    <button
                      className="wb-btn wb-btn--sm wb-btn--primary"
                      onClick={() => exportRun(r.id)}
                    >
                      导出 MD
                    </button>
                    <button
                      className="wb-btn wb-btn--sm wb-btn--danger"
                      onClick={() => deleteRunHistory(r.id)}
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!detail && (
          <div className="wb-modal__foot">
            <button
              className="wb-btn wb-btn--sm wb-btn--danger"
              onClick={() => {
                if (history.length && confirm('确定清空全部运行历史？')) clearRunHistory();
              }}
            >
              清空历史
            </button>
            <span className="wb-modal__hint">共 {history.length} 条记录</span>
          </div>
        )}
      </div>
    </div>
  );
}
