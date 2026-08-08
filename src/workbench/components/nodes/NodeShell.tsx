// ============================================================
// workbench/components/nodes/NodeShell.tsx
// 四种节点的共享外壳：标题栏 + 状态徽标 + 提示词编辑 +
// 可选 AI 平台选择 + 输出区 + 运行/采纳/重试操作 + 连线桩。
// ============================================================
import { Handle, Position } from 'reactflow';
import type { WorkbenchNodeData } from '../../store/workflowStore';
import { useWorkflowStore } from '../../store/workflowStore';
import { ALL_PROVIDERS, PROVIDER_LABELS } from '@shared/constants';

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
  const running = data.status === 'running';

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
                ✅ {Object.keys(data.outputs).length}/{data.providers.length} 已回答
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
