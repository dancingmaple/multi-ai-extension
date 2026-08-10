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
import { useEffectiveProviders } from '@shared/useEffectiveProviders';
import { StartNode } from './components/nodes/StartNode';
import { SummarizeNode } from './components/nodes/SummarizeNode';
import { ProcessNode } from './components/nodes/ProcessNode';
import { EndNode } from './components/nodes/EndNode';
import { SavedWorkflowsPanel } from './components/SavedWorkflowsPanel';
import { RunHistoryPanel } from './components/RunHistoryPanel';
import { SessionDock } from './components/SessionDock';
import { EmbeddedRunner } from './components/EmbeddedRunner';
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
  const awaitingConfirm = useWorkflowStore((s) => s.awaitingConfirm);
  const openPanel = useWorkflowStore((s) => s.openPanel);
  const exportRun = useWorkflowStore((s) => s.exportRun);
  const panel = useWorkflowStore((s) => s.panel);

  const effective = useEffectiveProviders();
  const runCount = useWorkflowStore((s) => s.runHistory.length);
  const dockOpen = useWorkflowStore((s) => s.dockOpen);
  const toggleDock = useWorkflowStore((s) => s.toggleDock);
  const preferEmbed = useWorkflowStore((s) => s.preferEmbed);
  const setPreferEmbed = useWorkflowStore((s) => s.setPreferEmbed);
  const embedOpen = useWorkflowStore((s) => s.embedOpen);
  const toggleEmbed = useWorkflowStore((s) => s.toggleEmbed);
  const addNodeAt = useWorkflowStore((s) => s.addNodeAt);
  const presetWorkflows = useWorkflowStore((s) => s.presetWorkflows);
  const applyPreset = useWorkflowStore((s) => s.applyPreset);
  const savePreset = useWorkflowStore((s) => s.savePreset);
  const deletePreset = useWorkflowStore((s) => s.deletePreset);

  // 预设流程下拉框状态：选中的预设 id；保存预设的输入（内联 prompt）
  const [presetSel, setPresetSel] = useState<string>('');
  const [presetName, setPresetName] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const [deletingPreset, setDeletingPreset] = useState(false);

  // 选中的预设变化时加载到画布（含内置写作流水线 / 用户自定义）
  const onPresetChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setPresetSel(id);
    if (id && !running) {
      await applyPreset(id);
    }
  };
  // 「保存为预设」：用当前画布覆盖同名或新建
  const onSavePreset = async () => {
    const name = presetName.trim();
    if (!name) return;
    setSavingPreset(true);
    await savePreset(name);
    setSavingPreset(false);
    setPresetName('');
  };
  // 「删除预设」：仅用户自定义可删
  const onDeletePreset = async () => {
    if (!presetSel || deletingPreset) return;
    const target = presetWorkflows.find((p) => p.id === presetSel);
    if (!target || target.builtin) return;
    setDeletingPreset(true);
    await deletePreset(presetSel);
    setDeletingPreset(false);
    setPresetSel('');
  };

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

        {/* 预设流程下拉框 */}
        <div className="wb-toolbar__group wb-presets" title="预设流程：选择即加载到画布">
          <select
            className="wb-presets__select"
            value={presetSel}
            onChange={(e) => void onPresetChange(e)}
          >
            <option value="">预设流程…</option>
            {presetWorkflows.map((p) => (
              <option key={p.id} value={p.id}>
                {p.builtin ? '★ ' : ''}{p.name}
              </option>
            ))}
          </select>
          <input
            className="wb-presets__input"
            value={presetName}
            placeholder="存为预设"
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onSavePreset();
            }}
          />
          <button
            className="wb-toolbar__btn wb-presets__save"
            disabled={savingPreset || !presetName.trim()}
            onClick={() => void onSavePreset()}
            title="把当前画布保存为预设（同名覆盖）"
          >
            <SaveIcon size={13} />
            存预设
          </button>
          <button
            className="wb-toolbar__btn wb-presets__del"
            disabled={deletingPreset || !presetSel}
            onClick={() => void onDeletePreset()}
            title="删除所选自定义预设（内置预设不可删除）"
          >
            <RefreshIcon size={13} />
            删
          </button>
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
          <button
            className={`wb-toolbar__btn ${embedOpen ? 'wb-toolbar__btn--active' : ''}`}
            onClick={toggleEmbed}
            title="内嵌执行面板：节点在本页面 iframe 内运行，不再开新标签页"
          >
            <TerminalIcon size={14} />
            <span>内嵌</span>
          </button>
          <button
            className={`wb-toolbar__btn ${preferEmbed ? 'wb-toolbar__btn--active' : ''}`}
            onClick={() => setPreferEmbed(!preferEmbed)}
            title={preferEmbed ? '当前：优先内嵌 iframe 执行（点此切回开标签页）' : '当前：开新标签页执行（点此切回内嵌）'}
          >
            <SparkIcon size={14} />
            <span>{preferEmbed ? '内嵌执行' : '标签页执行'}</span>
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
            {running ? (awaitingConfirm ? '待确认' : '执行中…') : '运行'}
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

      {/* 画布 + 内嵌执行面板：并排布局，内嵌面板作为右侧栏，不再遮挡画布 */}
      <div className="wb-main">
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

        {/* 内嵌执行面板（节点在本页面 iframe 内运行，不再开新标签页） */}
        <EmbeddedRunner />
      </div>

      {/* 底部状态栏 */}
      <footer className="wb-statusbar">
        <span>
          提示：给节点设置「变量名」后，下游可用 <code>{'{{变量名}}'}</code> 引用其输出（变量名优先于{' '}
          <code>{'{{节点id.output}}'}</code>）。画布空白处双击新建「汇总」节点、右键打开快捷菜单；{' '}
          <code>Ctrl+Enter</code> 运行整个工作流。
        </span>
        <span className="wb-statusbar__providers">
          {effective.map((e) => e.label).join(' / ')}
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
