// ============================================================
// workbench/WorkbenchApp.tsx
// 工作台主界面：ReactFlow DAG 画布 + 顶部工具栏（新增节点 / 运行 / 重置）。
// ============================================================
import { useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type NodeTypes,
} from 'reactflow';
import { useWorkflowStore } from './store/workflowStore';
import type { WorkbenchNodeType } from '@shared/types';
import { ALL_PROVIDERS, PROVIDER_LABELS } from '@shared/constants';
import { StartNode } from './components/nodes/StartNode';
import { SummarizeNode } from './components/nodes/SummarizeNode';
import { ProcessNode } from './components/nodes/ProcessNode';
import { EndNode } from './components/nodes/EndNode';

const nodeTypes: NodeTypes = {
  start: StartNode,
  summarize: SummarizeNode,
  process: ProcessNode,
  end: EndNode,
};

const ADD_BUTTONS: { type: WorkbenchNodeType; label: string }[] = [
  { type: 'start', label: '+ 起点' },
  { type: 'summarize', label: '+ 汇总' },
  { type: 'process', label: '+ 处理' },
  { type: 'end', label: '+ 终点' },
];

export function WorkbenchApp() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);
  const addNode = useWorkflowStore((s) => s.addNode);
  const runWorkflow = useWorkflowStore((s) => s.runWorkflow);
  const reset = useWorkflowStore((s) => s.reset);
  const load = useWorkflowStore((s) => s.load);
  const running = useWorkflowStore((s) => s.running);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full flex-col bg-slate-900 text-slate-100">
      {/* 顶部工具栏 */}
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-700 bg-slate-800 px-4 py-2">
        <span className="mr-2 text-sm font-semibold">🧠 AI 工作台</span>
        {ADD_BUTTONS.map((b) => (
          <button
            key={b.type}
            className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600"
            onClick={() => addNode(b.type)}
          >
            {b.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button
            className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium hover:bg-emerald-500 disabled:opacity-50"
            disabled={running}
            onClick={() => void runWorkflow()}
          >
            {running ? '执行中…' : '▶ 运行工作流'}
          </button>
          <button
            className="rounded bg-slate-700 px-3 py-1 text-xs hover:bg-slate-600"
            onClick={reset}
          >
            重置示例
          </button>
        </div>
      </header>

      {/* 画布 */}
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ animated: true }}
        >
          <Background color="#334155" gap={16} />
          <Controls />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => {
              switch (n.type) {
                case 'start':
                  return '#16a34a';
                case 'summarize':
                  return '#2563eb';
                case 'process':
                  return '#9333ea';
                case 'end':
                  return '#d97706';
                default:
                  return '#64748b';
              }
            }}
          />
        </ReactFlow>
      </div>

      {/* 底部说明 + 平台图例 */}
      <footer className="border-t border-slate-700 bg-slate-800 px-4 py-1.5 text-[11px] text-slate-400">
        提示：在「汇总 / 处理」节点里用 <code className="text-slate-200">{'{{节点id.output}}'}</code>{' '}
        引用上游输出；右键插件图标可重新打开本工作台。可用平台：
        {ALL_PROVIDERS.map((p) => PROVIDER_LABELS[p]).join(' / ')}
      </footer>
    </div>
  );
}
