// ============================================================
// workbench/WorkbenchApp.tsx
// 工作台主界面：ReactFlow DAG 画布 + 顶部工具栏（新增节点 / 运行 / 重置）。
// ============================================================
import { useEffect, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useReactFlow,
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
import {
  PlayIcon,
  SaveIcon,
  HistoryIcon,
  DownloadIcon,
  PanelIcon,
  RefreshIcon,
  SparkIcon,
  TerminalIcon,
  GearIcon,
  ArrowRightIcon,
} from './components/icons';

const nodeTypes: NodeTypes = {
  start: StartNode,
  summarize: SummarizeNode,
  process: ProcessNode,
  end: EndNode,
};

const ADD_BUTTONS: { type: WorkbenchNodeType; label: string; Icon: (p: { size?: number }) => React.ReactNode }[] = [
  { type: 'start', label: '起点', Icon: SparkIcon },
  { type: 'summarize', label: '汇总', Icon: TerminalIcon },
  { type: 'process', label: '处理', Icon: GearIcon },
  { type: 'end', label: '终点', Icon: ArrowRightIcon },
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
  const addNodeAt = useWorkflowStore((s) => s.addNodeAt);

  const { screenToFlowPosition } = useReactFlow();
  // 右键菜单：记录菜单出现位置（画布坐标），菜单消失置空
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const paneClickAt = useRef(0);

  // 快捷键：Ctrl/Cmd+Enter 运行整个工作流
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!running) void runWorkflow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, runWorkflow]);

  useEffect(() => {
    void load();
  }, [load]);

  // 双击画布空白：在该位置新建「汇总」节点（最常见的中间节点）
  const onPaneClick = () => {
    const now = Date.now();
    if (now - paneClickAt.current < 300) {
      // 第二次点击（双击）：在画布中心附近新建节点
      const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 3 });
      addNodeAt('summarize', center);
      paneClickAt.current = 0;
    } else {
      paneClickAt.current = now;
    }
  };

  // 右键画布空白：弹出「添加节点」快捷菜单
  const onPaneContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const ctxAdd = (type: WorkbenchNodeType) => {
    if (ctxMenu) {
      const pos = screenToFlowPosition({ x: ctxMenu.x, y: ctxMenu.y });
      addNodeAt(type, pos);
    }
    setCtxMenu(null);
  };

  return (
    <div className="wb-app">
      {/* 顶部工具栏 */}
      <header className="wb-toolbar">
        <div className="wb-toolbar__brand">
          <span className="wb-toolbar__logo"><SparkIcon size={15} /></span>
          <span className="wb-toolbar__title">AI 工作台</span>
        </div>

        {/* 添加节点 */}
        <div className="wb-toolbar__group" title="添加节点">
          {ADD_BUTTONS.map((b) => (
            <button
              key={b.type}
              className={`wb-toolbar__btn wb-add-btn wb-add-btn--${b.type}`}
              onClick={() => addNode(b.type)}
              title={`添加「${b.label}」节点`}
            >
              <b.Icon size={13} />
              <span>{b.label}</span>
            </button>
          ))}
        </div>

        <div className="wb-toolbar__spacer" />

        {/* 面板操作 */}
        <div className="wb-toolbar__group">
          <button
            className="wb-toolbar__btn"
            onClick={() => openPanel('saved')}
            title="保存当前画布为可复用工作流"
          >
            <SaveIcon size={14} />
            <span>保存</span>
          </button>
          <button
            className="wb-toolbar__btn"
            onClick={() => openPanel('history')}
            title="查看每次运行的完整过程与结果"
          >
            <HistoryIcon size={14} />
            <span>历史</span>
            {runCount > 0 ? <span className="wb-toolbar__badge">{runCount}</span> : null}
          </button>
          <button
            className="wb-toolbar__btn"
            onClick={() => exportRun()}
            title="导出最近一次运行（或当前设计草稿）为 Markdown"
          >
            <DownloadIcon size={14} />
            <span>导出</span>
          </button>
          <button
            className={`wb-toolbar__btn ${dockOpen ? 'wb-toolbar__btn--active' : ''}`}
            onClick={toggleDock}
            title="停靠各节点的 AI 会话，点击即可聚焦/打开对应标签页"
          >
            <PanelIcon size={14} />
            <span>会话</span>
          </button>
        </div>

        {/* 运行 / 重置 */}
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
              <PlayIcon size={14} />
            )}
            {running ? '执行中…' : '运行'}
          </button>
          <button
            className="wb-toolbar__btn"
            onClick={reset}
            title="重置为默认示例工作流"
          >
            <RefreshIcon size={14} />
            <span>重置</span>
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
          onPaneClick={onPaneClick}
          onPaneContextMenu={onPaneContextMenu}
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

        {/* 画布右键菜单：快捷添加节点 */}
        {ctxMenu && (
          <div
            className="wb-ctxmenu"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onMouseLeave={() => setCtxMenu(null)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="wb-ctxmenu__title">添加节点</div>
            {ADD_BUTTONS.map((b) => (
              <button
                key={b.type}
                type="button"
                className="wb-ctxmenu__item"
                onClick={() => ctxAdd(b.type)}
              >
                <b.Icon size={13} />
                <span>{b.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 底部状态栏 */}
      <footer className="wb-statusbar">
        <span>
          提示：给节点设置「变量名」后，下游可用 <code>{'{{变量名}}'}</code> 引用其输出（变量名优先于{' '}
          <code>{'{{节点id.output}}'}</code>）。画布空白处双击新建「汇总」节点、右键打开快捷菜单；{' '}
          <code>Ctrl+Enter</code> 运行整个工作流。
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
