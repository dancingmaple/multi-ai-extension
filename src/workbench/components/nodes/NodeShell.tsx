// ============================================================
// workbench/components/nodes/NodeShell.tsx
// 四种节点的共享外壳：标题栏 + 状态徽标 + 提示词编辑 +
// 可选 AI 平台选择 + 输出区 + 运行/采纳/重试操作 + 连线桩。
// ============================================================
import { useState } from 'react';
import { Handle, Position } from 'reactflow';
import type { WorkbenchNodeData } from '../../store/workflowStore';
import { useWorkflowStore } from '../../store/workflowStore';
import { ALL_PROVIDERS, PROVIDER_LABELS } from '@shared/constants';
import { isValidVarName } from '../../utils/template';

const STATUS_LABEL: Record<string, string> = {
  idle: '空闲',
  running: '运行中',
  reviewing: '待采纳',
  success: '成功',
  error: '失败',
};

export type Accent = 'start' | 'summarize' | 'process' | 'end';

interface Props {
  id: string;
  data: WorkbenchNodeData;
  selected?: boolean;
  showTarget?: boolean;
  showSource?: boolean;
  editablePrompt?: boolean;
  showProviders?: boolean;
  accent: Accent;
}

export function NodeShell({
  id,
  data,
  selected,
  showTarget = true,
  showSource = true,
  editablePrompt = true,
  showProviders = false,
  accent,
}: Props) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const executeNode = useWorkflowStore((s) => s.executeNode);
  const confirmNode = useWorkflowStore((s) => s.confirmNode);
  const grabNodeAnswers = useWorkflowStore((s) => s.grabNodeAnswers);
  const running = data.status === 'running';
  const [grabbing, setGrabbing] = useState(false);

  // 真正拿到正文的平台数（空字符串不算已回答，防止「显示 3/3 实际 1 条」）
  const answeredCount = data.providers.filter(
    (p) => data.outputs[p] && data.outputs[p]!.length > 0
  ).length;
  // 自动抓取后仍可能缺失的回答：已勾选平台中尚未拿到正文的
  const canGrab =
    showProviders &&
    data.providers.length > 0 &&
    data.status !== 'idle' &&
    data.status !== 'running';
  const missingCount = data.providers.length - answeredCount;

  const onGrab = async () => {
    if (grabbing) return;
    setGrabbing(true);
    try {
      await grabNodeAnswers(id);
    } finally {
      setGrabbing(false);
    }
  };

  return (
    <div className={`wb-node wb-node--${accent} ${selected ? 'ring-2 ring-sky-400' : ''}`}>
      {showTarget && <Handle type="target" position={Position.Left} />}

      <div className="wb-node__header">
        <span className="truncate">{data.label}</span>
        <span className={`wb-node__status wb-node__status--${data.status}`}>
          {STATUS_LABEL[data.status] ?? data.status}
        </span>
      </div>

      <div className="wb-node__body">
        {/* 变量名：设置后，下游节点可用 {{变量名}} 引用本节点输出 */}
        <div className="wb-varname">
          <label className="wb-varname__label">变量名</label>
          <input
            className={`wb-input wb-varname__input ${
              data.varName && !isValidVarName(data.varName) ? 'wb-input--invalid' : ''
            }`}
            value={data.varName ?? ''}
            placeholder="如 summary（下游用 {{summary}} 引用）"
            onChange={(e) => updateNodeData(id, { varName: e.target.value })}
          />
          {data.varName && !isValidVarName(data.varName) && (
            <div className="wb-varname__warn">⚠ 变量名需以字母/中文开头，仅含字母数字下划线</div>
          )}
          {data.varName && isValidVarName(data.varName) && (
            <div className="wb-varname__hint">下游可用 <code>{`{{${data.varName}}}`}</code> 引用</div>
          )}
        </div>

        {editablePrompt && (
          <textarea
            className="wb-input"
            rows={4}
            value={data.prompt}
            onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
            placeholder="支持 {{node_id.output}} 引用上游输出"
          />
        )}

        {showProviders && (
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
            {ALL_PROVIDERS.map((p) => (
              <label key={p} className="flex items-center gap-1 text-[11px] text-slate-200">
                <input
                  type="checkbox"
                  className="accent-sky-400"
                  checked={data.providers.includes(p)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...data.providers, p]
                      : data.providers.filter((x) => x !== p);
                    updateNodeData(id, { providers: next });
                  }}
                />
                {PROVIDER_LABELS[p]}
              </label>
            ))}
          </div>
        )}

        {(data.output || data.error) && (
          <div className="wb-output">
            {showProviders && data.providers.length > 0 && (
              <div className="wb-output__meta">
                ✅ {answeredCount}/{data.providers.length} 已回答
                {missingCount > 0 && (
                  <span className="wb-output__missing">（{missingCount} 个未取到，可手动获取）</span>
                )}
              </div>
            )}
            {data.error && data.status === 'error' ? (
              <div className="wb-output__err" title={data.error}>❌ {data.error.length > 80 ? data.error.slice(0, 77) + '…' : data.error}</div>
            ) : data.error ? (
              <div className="wb-output__warn" title={data.error}>⚠ 部分失败：{data.error.length > 60 ? data.error.slice(0, 57) + '…' : data.error}</div>
            ) : null}
            {data.output && <div className="wb-output__text">{data.output}</div>}
          </div>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          <button
            className="rounded bg-sky-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-400 disabled:opacity-50"
            disabled={running}
            onClick={() => void executeNode(id)}
          >
            {running ? '运行中…' : '运行'}
          </button>
          {canGrab && (
            <button
              className="rounded bg-amber-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-400 disabled:opacity-50"
              disabled={grabbing}
              onClick={() => void onGrab()}
              title="自动抓取可能漏掉回答：从各家标签页重新读屏补全"
            >
              {grabbing ? '获取中…' : missingCount > 0 ? '手动获取' : '重新获取'}
            </button>
          )}
          {data.status === 'reviewing' && (
            <button
              className="rounded bg-emerald-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-400"
              onClick={() => confirmNode(id)}
            >
              采纳
            </button>
          )}
          {data.status === 'error' && (
            <button
              className="rounded bg-rose-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-rose-400"
              onClick={() => void executeNode(id)}
            >
              重试
            </button>
          )}
        </div>
      </div>

      {showSource && <Handle type="source" position={Position.Right} />}
    </div>
  );
}
