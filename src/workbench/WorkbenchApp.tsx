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
import { SavedWorkflowsPanel } from './components/SavedWorkflowsPanel';
import { RunHistoryPanel } from './components/RunHistoryPanel';
import { SessionDock } from './components/SessionDock';

const nodeTypes: NodeTypes = {
  start: StartNode,
  summarize: SummarizeNode,
  process: ProcessNode,
  end: EndNode,
};

const ADD_BUTTONS: { type: WorkbenchNodeType; label: string; icon: string }[] = [
  { type: 'start', label: '起点', icon: '🌱' },
  { type: 'summarize', label: '汇总', icon: '📊' },
  { type: 'process', label: '处理', icon: '⚙️' },
  { type: 'end', label: '终点', icon: '🏁' },
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
  const openPanel = useWorkflowStore((s) => s.openPanel);
  const exportRun = useWorkflowStore((s) => s.exportRun);
  const panel = useWorkflowStore((s) => s.panel);
  const runCount = useWorkflowStore((s) => s.runHistory.length);
  const dockOpen = useWorkflowStore((s) => s.dockOpen);
  const toggleDock = useWorkflowStore((s) => s.toggleDock);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="wb-app">
      {/* 顶部工具栏 */}
      <header className="wb-toolbar">
        <div className="wb-toolbar__brand">
          <span className="wb-toolbar__logo">🧠</span>
          <span className="wb-toolbar__title">AI 工作台</span>
        </div>

        <div className="wb-toolbar__group" title="添加节点">
          {ADD_BUTTONS.map((b) => (
            <button
              key={b.type}
              className={`wb-toolbar__btn wb-add-btn wb-add-btn--${b.type}`}
              onClick={() => addNode(b.type)}
              title={`添加「${b.label}」节点`}
            >
              <span className="wb-add-btn__icon">{b.icon}</span>
              <span>{b.label}</span>
            </button>
          ))}
        </div>

        <div className="wb-toolbar__spacer" />

        <div className="wb-toolbar__group">
          <button
            className="wb-toolbar__btn"
            onClick={() => openPanel('saved')}
            title="保存当前画布为可复用工作流"
          >
            💾 保存
          </button>
          <button
            className="wb-toolbar__btn"
            onClick={() => openPanel('history')}
            title="查看每次运行的完整过程与结果"
          >
            📜 历史{runCount > 0 ? <span className="wb-toolbar__badge">{runCount}</span> : null}
          </button>
          <button
            className="wb-toolbar__btn"
            onClick={() => exportRun()}
            title="导出最近一次运行（或当前设计草稿）为 Markdown"
          >
            📤 导出
          </button>
          <button
            className={`wb-toolbar__btn ${dockOpen ? 'wb-toolbar__btn--active' : ''}`}
            onClick={toggleDock}
            title="停靠各节点的 AI 会话，点击即可聚焦/打开对应标签页"
          >
            🖥 会话
          </button>
        </div>

        <div className="wb-toolbar__group">
          <button
            className="wb-toolbar__run"
            disabled={running}
            onClick={() => void runWorkflow()}
            title="按拓扑顺序运行全部节点"
          >
            {running ? (
              <span className="wb-run-spinner" />
            ) : (
              <span className="wb-toolbar__run-icon">▶</span>
            )}
            {running ? '执行中…' : '运行'}
          </button>
          <button
            className="wb-toolbar__btn"
            onClick={reset}
            title="重置为默认示例工作流"
          >
            ↺ 重置
          </button>
        </div>
      </header>

      {/* 画布 */}
      <div className="wb-canvas">
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
          <Background color="#1e293b" gap={18} size={1.5} />
          <Controls
            className="wb-flow-controls"
            showInteractive={false}
          />
          <MiniMap
            pannable
            zoomable
            className="wb-minimap"
            nodeColor={(n) => {
              switch (n.type) {
                case 'start':
                  return '#10b981';
                case 'summarize':
                  return '#3b82f6';
                case 'process':
                  return '#a855f7';
                case 'end':
                  return '#f59e0b';
                default:
                  return '#64748b';
              }
            }}
          />
        </ReactFlow>
      </div>

      {/* 底部状态栏 */}
      <footer className="wb-statusbar">
        <span>
          提示：给节点设置「变量名」后，下游可用 <code>{'{{变量名}}'}</code> 引用其输出（变量名优先于{' '}
          <code>{'{{节点id.output}}'}</code>）。每个节点独立新会话运行；「🖥 会话」停靠各节点会话，可聚焦/打开。
        </span>
        <span className="wb-statusbar__providers">
          {ALL_PROVIDERS.map((p) => PROVIDER_LABELS[p]).join(' / ')}
        </span>
      </footer>

      {/* 浮层：保存工作流 / 运行历史 */}
      {panel === 'saved' && <SavedWorkflowsPanel />}
      {panel === 'history' && <RunHistoryPanel />}

      {/* 侧边会话坞 */}
      <SessionDock />
    </div>
  );
}
