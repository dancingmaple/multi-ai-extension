// ============================================================
// workbench/store/workflowStore.ts
// 工作台 DAG 工作流的状态机 + 执行引擎。
//  - 节点状态机：idle → running → reviewing → success → error
//  - 依赖编排：拓扑排序后按序执行，下游节点可引用上游 {{node_id.output}}
//  - 持久化：整个工作流（nodes + edges）存入 chrome.storage.local
//  - AI 执行：复用 background 的 WORKBENCH_EXECUTE（底层 handleAskAll）
// ============================================================

import { create } from 'zustand';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from 'reactflow';
import type {
  ProviderName,
  WorkbenchNodeType,
  WorkbenchExecResult,
  WorkbenchExecuteMessage,
  WorkbenchGrabMessage,
  WorkbenchGrabResult,
} from '@shared/types';
import { PROVIDER_LABELS } from '@shared/constants';
import { renderTemplate, type NodeOutput } from '../utils/template';
import {
  buildRunMarkdown,
  buildDraftMarkdown,
  downloadMarkdown,
  safeFileName,
  tsStamp,
} from '../utils/export';

export type NodeStatus = 'idle' | 'running' | 'reviewing' | 'success' | 'error';

export interface WorkbenchNodeData {
  label: string;
  nodeType: WorkbenchNodeType;
  prompt: string;
  providers: ProviderName[];
  /** 本节点输出的变量名（可选）。下游可用 {{变量名}} 引用，比 {{node_id.output}} 更稳定可读 */
  varName?: string;
  /** 聚合后的文本（供下游 {{node_id.output}} 或 {{变量名}} 引用） */
  output: string;
  /** 各家 AI 的原始回答 */
  outputs: Partial<Record<ProviderName, string>>;
  status: NodeStatus;
  error?: string;
  /** 本次执行实际发送给 AI 的提示词（变量/上游占位符已替换），用于导出与排查 */
  renderedPrompt?: string;
  /** 本次执行在 background 内部创建的 taskId，供「手动获取」定位标签页 */
  taskId?: string;
  /** 每家 AI 回答后所在会话的最终地址（回看/溯源），键为 provider */
  urls?: Partial<Record<ProviderName, string>>;
  /** 每家 AI 实际运行的标签页 id（forceNew 后为新开标签），键为 provider */
  tabIds?: Partial<Record<ProviderName, number>>;
  /** 自动获取倒计时（秒）：执行后等待该时长自动触发一次「手动获取」，挽回抓取失败 */
  grabDelay?: number;
  /** 待触发的自动获取预定时间（时间戳 ms）；用于 UI 显示倒计时与取消；到点后清空 */
  autoGrabAt?: number;
}

export type WBNode = Node<WorkbenchNodeData>;

/** 已命名保存的工作流（可复用库） */
export interface SavedWorkflow {
  id: string;
  name: string;
  nodes: WBNode[];
  edges: Edge[];
  createdAt: number;
  updatedAt: number;
}

/** 运行记录中，单个节点的过程与结果快照 */
export interface RunNodeResult {
  id: string;
  label: string;
  nodeType: WorkbenchNodeType;
  varName?: string;
  providers: ProviderName[];
  status: NodeStatus;
  prompt: string;
  renderedPrompt?: string;
  output: string;
  outputs: Partial<Record<ProviderName, string>>;
  /** 每家 AI 回答后所在会话的最终地址（回看/溯源） */
  urls?: Partial<Record<ProviderName, string>>;
  error?: string;
}

/** 一次工作流运行的历史记录 */
export interface RunRecord {
  id: string;
  name: string;
  createdAt: number;
  status: 'success' | 'partial' | 'error';
  nodeCount: number;
  startPrompt: string;
  nodes: RunNodeResult[];
  edges: Edge[];
}

const STORAGE_KEY = 'workbench_workflow_v1';
const SAVED_KEY = 'workbench_saved_v1';
const HISTORY_KEY = 'workbench_history_v1';
const HISTORY_CAP = 50;

let nodeSeq = 0;
function nid(): string {
  nodeSeq += 1;
  return `n_${Date.now().toString(36)}_${nodeSeq}`;
}

function defaultData(nodeType: WorkbenchNodeType): WorkbenchNodeData {
  const presets: Record<
    WorkbenchNodeType,
    { label: string; prompt: string; providers: ProviderName[]; varName?: string }
  > = {
    start: {
      label: '起点 · 输入',
      prompt: '在这里写下你的原始问题 / 素材……',
      providers: [],
      varName: 'input',
    },
    summarize: {
      label: '汇总',
      prompt: '请把以下内容整理成简明摘要：\n\n{{input}}',
      providers: ['chatgpt', 'gemini'],
      varName: 'summary',
    },
    process: {
      label: '处理',
      prompt: '基于以下摘要，给出可执行的方案：\n\n{{summary}}',
      providers: ['deepseek', 'qwen'],
      varName: 'plan',
    },
    end: {
      label: '终点 · 输出',
      prompt: '最终交付物：\n\n{{summary}}\n\n{{plan}}',
      providers: [],
    },
  };
  const p = presets[nodeType];
  return {
    label: p.label,
    nodeType,
    prompt: p.prompt,
    providers: p.providers,
    varName: p.varName,
    output: '',
    outputs: {},
    status: 'idle',
  };
}

function makeNode(nodeType: WorkbenchNodeType, position: { x: number; y: number }): WBNode {
  return {
    id: nid(),
    type: nodeType,
    position,
    data: defaultData(nodeType),
  };
}

/** 默认示例工作流：Start → Summarize → Process → End */
function seedWorkflow(): { nodes: WBNode[]; edges: Edge[] } {
  const start = makeNode('start', { x: 40, y: 220 });
  const summarize = makeNode('summarize', { x: 380, y: 120 });
  const process = makeNode('process', { x: 380, y: 320 });
  const end = makeNode('end', { x: 740, y: 220 });
  const edges: Edge[] = [
    { id: `e_${start.id}_${summarize.id}`, source: start.id, target: summarize.id, animated: true },
    { id: `e_${start.id}_${process.id}`, source: start.id, target: process.id, animated: true },
    { id: `e_${summarize.id}_${end.id}`, source: summarize.id, target: end.id, animated: true },
    { id: `e_${process.id}_${end.id}`, source: process.id, target: end.id, animated: true },
  ];
  return { nodes: [start, summarize, process, end], edges };
}

/** 把所有节点的输出汇总成模板渲染所需的 map（按节点 ID 索引） */
function buildOutputMap(nodes: WBNode[]): Record<string, NodeOutput> {
  const map: Record<string, NodeOutput> = {};
  for (const n of nodes) {
    map[n.id] = { output: n.data.output, outputs: n.data.outputs as Record<string, string> };
  }
  return map;
}

/** 把所有「设置了变量名」的节点输出汇总成 map（按变量名索引，优先级高于节点 ID） */
function buildVarMap(nodes: WBNode[]): Record<string, NodeOutput> {
  const map: Record<string, NodeOutput> = {};
  for (const n of nodes) {
    const name = n.data.varName?.trim();
    if (name) {
      map[name] = { output: n.data.output, outputs: n.data.outputs as Record<string, string> };
    }
  }
  return map;
}

/** 拓扑排序（Kahn）。存在环时，剩余节点按原顺序追加在末尾。 */
function topoOrder(nodes: WBNode[], edges: Edge[]): WBNode[] {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  nodes.forEach((n) => {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  });
  edges.forEach((e) => {
    if (indeg.has(e.target) && adj.has(e.source)) {
      indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
      adj.get(e.source)!.push(e.target);
    }
  });
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const nxt of adj.get(id) ?? []) {
      indeg.set(nxt, (indeg.get(nxt) ?? 0) - 1);
      if ((indeg.get(nxt) ?? 0) === 0) queue.push(nxt);
    }
  }
  nodes.forEach((n) => {
    if (!seen.has(n.id)) order.push(n.id);
  });
  return order.map((id) => nodes.find((n) => n.id === id)!).filter(Boolean);
}

/** 取从 startId 出发可达的全部后代节点 id（含自身） */
function descendants(startId: string, edges: Edge[]): Set<string> {
  const adj = new Map<string, string[]>();
  edges.forEach((e) => {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  });
  const out = new Set<string>([startId]);
  const stack = [startId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const nxt of adj.get(cur) ?? []) {
      if (!out.has(nxt)) {
        out.add(nxt);
        stack.push(nxt);
      }
    }
  }
  return out;
}

function joinOutputs(
  outputs: Partial<Record<ProviderName, string>>,
  providers: ProviderName[]
): string {
  return providers
    .filter((p) => outputs[p] && outputs[p]!.length > 0)
    .map((p) => `## ${PROVIDER_LABELS[p]}\n${outputs[p]}`)
    .join('\n\n');
}

/** 仅保留可序列化、装载回 ReactFlow 所需的字段（去掉 measured/selected/dragging 等瞬态） */
function sanitizeNodes(nodes: WBNode[]): WBNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: { x: n.position.x, y: n.position.y },
    data: n.data,
  }));
}

function sanitizeEdges(edges: Edge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: e.animated,
    label: e.label,
  }));
}

/** 从当前节点状态构建一次运行的记录 */
function buildRunRecord(nodes: WBNode[], edges: Edge[]): RunRecord {
  const runNodes: RunNodeResult[] = nodes.map((n) => ({
    id: n.id,
    label: n.data.label,
    nodeType: n.data.nodeType,
    varName: n.data.varName,
    providers: n.data.providers,
    status: n.data.status,
    prompt: n.data.prompt,
    renderedPrompt: n.data.renderedPrompt,
    output: n.data.output,
    outputs: n.data.outputs,
    urls: n.data.urls,
    error: n.data.error,
  }));
  const startNode = nodes.find((n) => n.data.nodeType === 'start');
  const hasErr = nodes.some((n) => n.data.status === 'error');
  const hasOk = nodes.some(
    (n) => n.data.status === 'success' || n.data.status === 'reviewing' || n.data.output
  );
  const status: RunRecord['status'] = !hasErr
    ? 'success'
    : hasOk
      ? 'partial'
      : 'error';
  return {
    id: `run_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`,
    name: (startNode?.data.prompt || '未命名工作流').split('\n')[0].slice(0, 30) || '未命名工作流',
    createdAt: Date.now(),
    status,
    nodeCount: nodes.length,
    startPrompt: startNode?.data.prompt ?? '',
    nodes: runNodes,
    edges: sanitizeEdges(edges),
  };
}

/** 通过 background 执行一次 AI 调用（WORKBENCH_EXECUTE） */
function sendWorkbenchExecute(
  prompt: string,
  providers: ProviderName[],
  nodeId: string,
  nodeType: WorkbenchNodeType
): Promise<WorkbenchExecResult> {
  return new Promise((resolve, reject) => {
    const msg: WorkbenchExecuteMessage = {
      type: 'WORKBENCH_EXECUTE',
      nodeId,
      nodeType,
      prompt,
      providers,
    };
    try {
      console.log('[Workbench:store] 发送 WORKBENCH_EXECUTE', { nodeId, nodeType, providers, promptLen: prompt.length });
      chrome.runtime.sendMessage(msg, (resp: WorkbenchExecResult) => {
        const lastErr = chrome.runtime.lastError?.message;
        console.log('[Workbench:store] 收到响应', {
          respType: typeof resp,
          respKeys: resp ? Object.keys(resp) : null,
          lastError: lastErr ?? null,
          respSnapshot: resp ? { ok: resp.ok, outKeys: Object.keys(resp.outputs ?? {}), errKeys: Object.keys(resp.errors ?? {}) } : null,
        });
        if (lastErr) {
          reject(new Error(lastErr));
        } else {
          resolve(resp);
        }
      });
    } catch (e) {
      console.error('[Workbench:store] sendMessage throw:', e);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** 通过 background 手动兜底获取（WORKBENCH_GRAB）：重新从各家标签页读屏 */
function sendWorkbenchGrab(
  prompt: string,
  providers: ProviderName[],
  nodeId: string,
  taskId?: string,
  tabIds?: Partial<Record<ProviderName, number>>,
  urls?: Partial<Record<ProviderName, string>>
): Promise<WorkbenchGrabResult> {
  return new Promise((resolve, reject) => {
    const msg: WorkbenchGrabMessage = {
      type: 'WORKBENCH_GRAB',
      nodeId,
      prompt,
      providers,
      taskId,
      tabIds,
      urls,
    };
    try {
      chrome.runtime.sendMessage(msg, (resp: WorkbenchGrabResult) => {
        const lastErr = chrome.runtime.lastError?.message;
        if (lastErr) reject(new Error(lastErr));
        else resolve(resp);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave(get: () => WorkflowState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void get().save();
  }, 400);
}

/** 自动获取定时器登记表：nodeId -> timeout 句柄（执行后延时触发「手动获取」） */
const autoGrabTimers = new Map<string, ReturnType<typeof setTimeout>>();
function clearAutoGrabTimer(id: string): void {
  const t = autoGrabTimers.get(id);
  if (t !== undefined) {
    clearTimeout(t);
    autoGrabTimers.delete(id);
  }
}

/** 正在执行的节点集合（防同节点重入 + 给 UI 判定按钮 disabled 用） */
const executingNodes = new Set<string>();

/**
 * 调度一次「到点自动获取」：在 delaySec 秒后自动触发该节点的手动获取，
 * 用于挽回自动抓取失败的回答（例如某家 AI 超时 / 未登录）。
 * 到点后清空 autoGrabAt 标记，并调用 grabNodeAnswers。
 */
function scheduleAutoGrab(get: () => WorkflowState, id: string, delaySec: number): void {
  if (!(delaySec > 0)) return;
  clearAutoGrabTimer(id);
  const at = Date.now() + delaySec * 1000;
  get().updateNodeData(id, { autoGrabAt: at });
  const t = setTimeout(() => {
    autoGrabTimers.delete(id);
    get().updateNodeData(id, { autoGrabAt: undefined });
    void get().grabNodeAnswers(id);
  }, delaySec * 1000);
  autoGrabTimers.set(id, t);
}

interface WorkflowState {
  nodes: WBNode[];
  edges: Edge[];
  running: boolean;

  // ── 已保存工作流（可复用库） ──
  savedWorkflows: SavedWorkflow[];
  // ── 运行历史 ──
  runHistory: RunRecord[];
  // ── 当前打开的浮层：'none' | 'saved' | 'history' ──
  panel: 'none' | 'saved' | 'history';
  // ── 会话坞（侧边嵌入/聚焦 AI 标签页）开关 ──
  dockOpen: boolean;
  toggleDock: () => void;

  // ── ReactFlow 编辑回调 ──
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (conn: Connection) => void;
  addNode: (nodeType: WorkbenchNodeType) => void;
  updateNodeData: (id: string, patch: Partial<WorkbenchNodeData>) => void;
  /** 直接编辑某家 AI 的回答文本（节点结果可编辑），并重新聚合 output */
  updateNodeOutput: (id: string, provider: ProviderName, text: string) => void;
  /** 取消该节点待触发的自动获取定时器 */
  cancelAutoGrab: (id: string) => void;

  // ── 引擎 ──
  executeNode: (id: string) => Promise<void>;
  runDownstream: (id: string) => Promise<void>;
  runWorkflow: () => Promise<void>;
  confirmNode: (id: string) => void;
  /** 手动兜底：重新从各家标签页读屏，挽回自动抓取失败的回答 */
  grabNodeAnswers: (id: string) => Promise<void>;

  // ── 持久化 ──
  load: () => Promise<void>;
  save: () => Promise<void>;
  reset: () => void;

  // ── 已保存工作流 ──
  loadSavedWorkflows: () => Promise<void>;
  saveWorkflowAs: (name: string) => Promise<void>;
  loadSavedWorkflow: (id: string) => Promise<void>;
  renameSavedWorkflow: (id: string, name: string) => Promise<void>;
  deleteSavedWorkflow: (id: string) => Promise<void>;

  // ── 运行历史 ──
  loadRunHistory: () => Promise<void>;
  recordRun: () => void;
  deleteRunHistory: (id: string) => void;
  clearRunHistory: () => void;
  exportRun: (id?: string) => void;

  // ── 浮层 ──
  openPanel: (panel: 'saved' | 'history') => void;
  closePanel: () => void;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  running: false,
  savedWorkflows: [],
  runHistory: [],
  panel: 'none',
  dockOpen: false,

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
    scheduleSave(get);
  },
  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
    scheduleSave(get);
  },
  onConnect: (conn) => {
    set({ edges: addEdge({ ...conn, animated: true }, get().edges) });
    scheduleSave(get);
  },
  addNode: (nodeType) => {
    // 新节点放在画布中部偏上的空位：按已有节点数做「3 列网格 + 级联偏移」，
    // 避免全部堆在左上角重叠，也方便在画布空白处直接操作。
    const count = get().nodes.length;
    const col = count % 3;
    const row = Math.floor(count / 3) % 4;
    const node = makeNode(nodeType, { x: 200 + col * 120, y: 120 + row * 100 });
    set({ nodes: [...get().nodes, node] });
    scheduleSave(get);
  },
  updateNodeData: (id, patch) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
      ),
    });
    scheduleSave(get);
  },

  updateNodeOutput: (id, provider, text) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return;
    const outputs: Record<ProviderName, string> = {
      ...(node.data.outputs as Record<ProviderName, string>),
    };
    outputs[provider] = text;
    const output = joinOutputs(outputs, node.data.providers);
    get().updateNodeData(id, { outputs, output });
  },

  cancelAutoGrab: (id) => {
    clearAutoGrabTimer(id);
    get().updateNodeData(id, { autoGrabAt: undefined });
  },

  confirmNode: (id) => {
    const node = get().nodes.find((n) => n.id === id);
    if (node && node.data.status === 'reviewing') {
      get().updateNodeData(id, { status: 'success' });
    }
  },

  grabNodeAnswers: async (id) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return;
    const { providers, renderedPrompt, prompt, outputs: prevOutputs, taskId, tabIds: prevTabIds, urls: prevUrls } =
      node.data;
    if (providers.length === 0) return;
    const sendPrompt = renderedPrompt || prompt;

    get().updateNodeData(id, { error: undefined });
    try {
      const result = await sendWorkbenchGrab(sendPrompt, providers, id, taskId, prevTabIds, prevUrls);
      // 合并：只补全「缺失」项，不覆盖用户已编辑过的内容（防止手动获取把改好的文本冲掉）
      const merged: Partial<Record<ProviderName, string>> = { ...(prevOutputs as Record<ProviderName, string>) };
      const errs: Partial<Record<ProviderName, string>> = {};
      const urls: Partial<Record<ProviderName, string>> = { ...(prevUrls as Record<ProviderName, string>) };
      const tabIds: Partial<Record<ProviderName, number>> = { ...(prevTabIds as Record<ProviderName, number>) };
      for (const p of providers) {
        const txt = result.outputs[p];
        if (txt && txt.length > 0) {
          // 已有非空回答（可能是用户编辑过的）则保留，仅缺失时补全
          if (!merged[p] || merged[p]!.length === 0) merged[p] = txt;
        } else if (result.errors[p]) {
          errs[p] = result.errors[p];
        }
        if (result.urls?.[p]) urls[p] = result.urls[p];
        if (result.tabIds?.[p] !== undefined) tabIds[p] = result.tabIds[p];
      }
      const answered = providers.filter((p) => merged[p] && merged[p]!.length > 0);
      const output = joinOutputs(merged, providers);
      const errMsg = Object.keys(errs).length
        ? Object.values(errs).join('；')
        : answered.length
          ? undefined
          : '仍未获取到任何回答，请确认对应 AI 标签页已打开且回答已生成';
      get().updateNodeData(id, {
        outputs: merged,
        output,
        status: answered.length ? 'reviewing' : 'error',
        error: errMsg,
        urls,
        tabIds,
        autoGrabAt: undefined,
      });
    } catch (e) {
      get().updateNodeData(id, { error: e instanceof Error ? e.message : String(e) });
    }
  },

  executeNode: async (id) => {
    // 防同节点重入：上一次执行还没结束（背景 SW 卡/AI 超时/用户连点）
    if (executingNodes.has(id)) return;
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return;
    const { nodeType, prompt, providers, grabDelay } = node.data;

    executingNodes.add(id);

    // 重新执行前，清掉上一轮可能还在排队的自动获取定时器
    clearAutoGrabTimer(id);
    get().updateNodeData(id, { autoGrabAt: undefined });

    try {
    // 起点：纯种子输入，不调用 AI
    if (nodeType === 'start') {
      get().updateNodeData(id, { output: prompt, status: 'success', error: undefined });
      return;
    }

    const outputMap = buildOutputMap(get().nodes);
    const varMap = buildVarMap(get().nodes);
    const rendered = renderTemplate(prompt, outputMap, varMap);

    // 终点：聚合上游，不调用 AI（仅渲染模板）
    if (nodeType === 'end') {
      const trimmed = rendered.trim();
      if (!trimmed) {
        // 上游没有输出时给出明确提示，避免「点了没反应」
        get().updateNodeData(id, {
          output: '',
          status: 'error',
          error: '终点没有拿到任何上游输出——请先运行其上游节点（或检查引用 {{变量名}} 是否写对）',
        });
      } else {
        get().updateNodeData(id, { output: rendered, status: 'success', error: undefined });
      }
      return;
    }

    // summarize / process：调用 background 复用 handleAskAll
    // 关键：先把上一轮的运行产物清空，否则运行中/失败时用户会看到「上次的旧内容」
    // （outputs/output/urls/tabIds/taskId/autoGrabAt 都是本次运行的产物，不是节点固有状态）
    get().updateNodeData(id, {
      status: 'running',
      error: undefined,
      renderedPrompt: rendered,
      outputs: {},
      output: '',
      urls: undefined,
      tabIds: undefined,
      taskId: undefined,
    });
    try {
      const result = await sendWorkbenchExecute(rendered, providers, id, nodeType);
      const hasOutput = !!result && Object.keys(result.outputs).length > 0;
      if (result && (result.ok || hasOutput)) {
        const output = joinOutputs(result.outputs, providers);
        // 部分成功：只要有 ≥1 个 provider 返回正文就进入「待采纳」，
        // 同时把失败 provider 的原因带上，便于排查（不会因单点失败拖垮整条链）。
        const errMsg =
          result.errors && Object.keys(result.errors).length
            ? Object.values(result.errors).filter(Boolean).join('；')
            : undefined;
        get().updateNodeData(id, {
          outputs: result.outputs,
          output,
          status: 'reviewing',
          error: errMsg,
          taskId: result.taskId,
          urls: result.urls,
          tabIds: result.tabIds,
        });
        scheduleAutoGrab(get, id, grabDelay ?? 0);
      } else {
        const errMsg = result
          ? Object.values(result.errors).filter(Boolean).join('；') || '执行失败'
          : '无响应';
        get().updateNodeData(id, {
          status: 'error',
          error: errMsg,
          taskId: result?.taskId,
          urls: result?.urls,
          tabIds: result?.tabIds,
        });
        scheduleAutoGrab(get, id, grabDelay ?? 0);
      }
    } catch (e) {
      get().updateNodeData(id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
    } finally {
      executingNodes.delete(id);
    }
  },

  runDownstream: async (id) => {
    // 运行前重置：把本次涉及的节点恢复为 idle、清空旧错误与残留的自动获取倒计时，
    // 避免「上次失败还挂着红色状态 / 上一轮的自动获取到点后又来抓一次」。
    const order = topoOrder(get().nodes, get().edges);
    const desc = descendants(id, get().edges);
    const seq = order.filter((n) => desc.has(n.id));
    for (const n of seq) clearAutoGrabTimer(n.id);
    set({
      nodes: get().nodes.map((n) =>
        desc.has(n.id) ? { ...n, data: { ...n.data, status: 'idle' as NodeStatus, error: undefined, autoGrabAt: undefined } } : n
      ),
    });
    set({ running: true });
    try {
      for (const n of seq) {
        await get().executeNode(n.id);
      }
    } finally {
      set({ running: false });
      get().recordRun();
    }
  },

  runWorkflow: async () => {
    // 运行前重置全部节点：清除旧状态/错误/残留自动获取定时器，保证本次运行干净无残留
    for (const n of get().nodes) clearAutoGrabTimer(n.id);
    set({
      nodes: get().nodes.map((n) => ({
        ...n,
        data: { ...n.data, status: 'idle' as NodeStatus, error: undefined, autoGrabAt: undefined },
      })),
    });
    const order = topoOrder(get().nodes, get().edges);
    set({ running: true });
    try {
      for (const n of order) {
        await get().executeNode(n.id);
      }
    } finally {
      set({ running: false });
      get().recordRun();
    }
  },

  load: async () => {
    try {
      const res = await chrome.storage.local.get(STORAGE_KEY);
      const saved = res[STORAGE_KEY] as { nodes: WBNode[]; edges: Edge[] } | undefined;
      if (saved && Array.isArray(saved.nodes) && saved.nodes.length > 0) {
        // 清除过期的自动获取倒计时标记（定时器不会跨页面加载存活）
        const cleaned = saved.nodes.map((n) => ({
          ...n,
          data: { ...n.data, autoGrabAt: undefined },
        }));
        set({ nodes: cleaned, edges: saved.edges ?? [] });
        return;
      }
    } catch {
      /* 忽略，使用默认示例 */
    }
    const seed = seedWorkflow();
    set({ nodes: seed.nodes, edges: seed.edges });
  },

  save: async () => {
    try {
      // 只存可序列化字段（去掉 ReactFlow 注入的 measured/selected/dragging 等瞬态）
      await chrome.storage.local.set({
        [STORAGE_KEY]: { nodes: sanitizeNodes(get().nodes), edges: sanitizeEdges(get().edges) },
      });
    } catch {
      /* 存储失败时静默 */
    }
  },

  reset: () => {
    const seed = seedWorkflow();
    set({ nodes: seed.nodes, edges: seed.edges });
    void get().save();
  },

  // ── 已保存工作流（可复用库） ──────────────────────────
  loadSavedWorkflows: async () => {
    try {
      const res = await chrome.storage.local.get(SAVED_KEY);
      const list = (res[SAVED_KEY] as SavedWorkflow[] | undefined) ?? [];
      set({ savedWorkflows: Array.isArray(list) ? list : [] });
    } catch {
      set({ savedWorkflows: [] });
    }
  },

  saveWorkflowAs: async (name) => {
    const trimmed = (name || '').trim() || `工作流 ${new Date().toLocaleString('zh-CN')}`;
    const wf: SavedWorkflow = {
      id: `wf_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`,
      name: trimmed,
      nodes: sanitizeNodes(get().nodes),
      edges: sanitizeEdges(get().edges),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const next = [wf, ...get().savedWorkflows];
    set({ savedWorkflows: next });
    try {
      await chrome.storage.local.set({ [SAVED_KEY]: next });
    } catch {
      /* 存储失败静默 */
    }
  },

  loadSavedWorkflow: async (id) => {
    const wf = get().savedWorkflows.find((w) => w.id === id);
    if (!wf) return;
    set({ nodes: wf.nodes, edges: wf.edges, panel: 'none' });
    void get().save();
  },

  renameSavedWorkflow: async (id, name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const next = get().savedWorkflows.map((w) =>
      w.id === id ? { ...w, name: trimmed, updatedAt: Date.now() } : w
    );
    set({ savedWorkflows: next });
    try {
      await chrome.storage.local.set({ [SAVED_KEY]: next });
    } catch {
      /* 静默 */
    }
  },

  deleteSavedWorkflow: async (id) => {
    const next = get().savedWorkflows.filter((w) => w.id !== id);
    set({ savedWorkflows: next });
    try {
      await chrome.storage.local.set({ [SAVED_KEY]: next });
    } catch {
      /* 静默 */
    }
  },

  // ── 运行历史 ──────────────────────────────────────────
  loadRunHistory: async () => {
    try {
      const res = await chrome.storage.local.get(HISTORY_KEY);
      const list = (res[HISTORY_KEY] as RunRecord[] | undefined) ?? [];
      set({ runHistory: Array.isArray(list) ? list : [] });
    } catch {
      set({ runHistory: [] });
    }
  },

  recordRun: () => {
    const rec = buildRunRecord(get().nodes, get().edges);
    const next = [rec, ...get().runHistory].slice(0, HISTORY_CAP);
    set({ runHistory: next });
    try {
      void chrome.storage.local.set({ [HISTORY_KEY]: next });
    } catch {
      /* 静默 */
    }
  },

  deleteRunHistory: (id) => {
    const next = get().runHistory.filter((r) => r.id !== id);
    set({ runHistory: next });
    try {
      void chrome.storage.local.set({ [HISTORY_KEY]: next });
    } catch {
      /* 静默 */
    }
  },

  clearRunHistory: () => {
    set({ runHistory: [] });
    try {
      void chrome.storage.local.set({ [HISTORY_KEY]: [] });
    } catch {
      /* 静默 */
    }
  },

  exportRun: (id) => {
    const rec = id ? get().runHistory.find((r) => r.id === id) : get().runHistory[0];
    if (rec) {
      const md = buildRunMarkdown(rec);
      downloadMarkdown(`run_${safeFileName(rec.name)}_${tsStamp(new Date(rec.createdAt))}.md`, md);
      return;
    }
    // 没有历史记录：导出当前画布设计草稿
    const draftMd = buildDraftMarkdown(
      '当前设计',
      get().nodes.map((n) => ({ data: n.data }))
    );
    downloadMarkdown(`workbench_draft_${tsStamp()}.md`, draftMd);
  },

  // ── 浮层 ──────────────────────────────────────────────
  openPanel: (panel) => {
    if (panel === 'saved') void get().loadSavedWorkflows();
    if (panel === 'history') void get().loadRunHistory();
    set({ panel });
  },
  closePanel: () => set({ panel: 'none' }),
  toggleDock: () => set((s) => ({ dockOpen: !s.dockOpen })),
}));
