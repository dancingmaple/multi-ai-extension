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
} from '@shared/types';
import { PROVIDER_LABELS } from '@shared/constants';
import { renderTemplate, type NodeOutput } from '../utils/template';

export type NodeStatus = 'idle' | 'running' | 'reviewing' | 'success' | 'error';

export interface WorkbenchNodeData {
  label: string;
  nodeType: WorkbenchNodeType;
  prompt: string;
  providers: ProviderName[];
  /** 聚合后的文本（供下游 {{node_id.output}} 引用） */
  output: string;
  /** 各家 AI 的原始回答 */
  outputs: Partial<Record<ProviderName, string>>;
  status: NodeStatus;
  error?: string;
}

export type WBNode = Node<WorkbenchNodeData>;

const STORAGE_KEY = 'workbench_workflow_v1';

let nodeSeq = 0;
function nid(): string {
  nodeSeq += 1;
  return `n_${Date.now().toString(36)}_${nodeSeq}`;
}

function defaultData(nodeType: WorkbenchNodeType): WorkbenchNodeData {
  const presets: Record<WorkbenchNodeType, { label: string; prompt: string; providers: ProviderName[] }> = {
    start: { label: '起点 · 输入', prompt: '在这里写下你的原始问题 / 素材……', providers: [] },
    summarize: {
      label: '汇总',
      prompt: '请把以下内容整理成简明摘要：\n\n{{start.output}}',
      providers: ['chatgpt', 'gemini'],
    },
    process: {
      label: '处理',
      prompt: '基于以下摘要，给出可执行的方案：\n\n{{summarize.output}}',
      providers: ['deepseek', 'qwen'],
    },
    end: { label: '终点 · 输出', prompt: '最终交付物：\n\n{{summarize.output}}\n\n{{process.output}}', providers: [] },
  };
  const p = presets[nodeType];
  return {
    label: p.label,
    nodeType,
    prompt: p.prompt,
    providers: p.providers,
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

/** 把所有节点的输出汇总成模板渲染所需的 map */
function buildOutputMap(nodes: WBNode[]): Record<string, NodeOutput> {
  const map: Record<string, NodeOutput> = {};
  for (const n of nodes) {
    map[n.id] = { output: n.data.output, outputs: n.data.outputs as Record<string, string> };
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
      chrome.runtime.sendMessage(msg, (resp: WorkbenchExecResult) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(resp);
        }
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

interface WorkflowState {
  nodes: WBNode[];
  edges: Edge[];
  running: boolean;

  // ── ReactFlow 编辑回调 ──
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (conn: Connection) => void;
  addNode: (nodeType: WorkbenchNodeType) => void;
  updateNodeData: (id: string, patch: Partial<WorkbenchNodeData>) => void;

  // ── 引擎 ──
  executeNode: (id: string) => Promise<void>;
  runDownstream: (id: string) => Promise<void>;
  runWorkflow: () => Promise<void>;
  confirmNode: (id: string) => void;

  // ── 持久化 ──
  load: () => Promise<void>;
  save: () => Promise<void>;
  reset: () => void;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  running: false,

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
    const offset = get().nodes.length * 12;
    const node = makeNode(nodeType, { x: 120 + offset, y: 80 + offset });
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

  confirmNode: (id) => {
    const node = get().nodes.find((n) => n.id === id);
    if (node && node.data.status === 'reviewing') {
      get().updateNodeData(id, { status: 'success' });
    }
  },

  executeNode: async (id) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return;
    const { nodeType, prompt, providers } = node.data;

    // 起点：纯种子输入，不调用 AI
    if (nodeType === 'start') {
      get().updateNodeData(id, { output: prompt, status: 'success' });
      return;
    }

    const outputMap = buildOutputMap(get().nodes);
    const rendered = renderTemplate(prompt, outputMap);

    // 终点：聚合上游，不调用 AI（仅渲染模板）
    if (nodeType === 'end') {
      get().updateNodeData(id, { output: rendered, status: 'success' });
      return;
    }

    // summarize / process：调用 background 复用 handleAskAll
    get().updateNodeData(id, { status: 'running', error: undefined });
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
        });
      } else {
        const errMsg = result
          ? Object.values(result.errors).filter(Boolean).join('；') || '执行失败'
          : '无响应';
        get().updateNodeData(id, { status: 'error', error: errMsg });
      }
    } catch (e) {
      get().updateNodeData(id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },

  runDownstream: async (id) => {
    const order = topoOrder(get().nodes, get().edges);
    const desc = descendants(id, get().edges);
    const seq = order.filter((n) => desc.has(n.id));
    set({ running: true });
    try {
      for (const n of seq) {
        await get().executeNode(n.id);
      }
    } finally {
      set({ running: false });
    }
  },

  runWorkflow: async () => {
    const order = topoOrder(get().nodes, get().edges);
    set({ running: true });
    try {
      for (const n of order) {
        await get().executeNode(n.id);
      }
    } finally {
      set({ running: false });
    }
  },

  load: async () => {
    try {
      const res = await chrome.storage.local.get(STORAGE_KEY);
      const saved = res[STORAGE_KEY] as { nodes: WBNode[]; edges: Edge[] } | undefined;
      if (saved && Array.isArray(saved.nodes) && saved.nodes.length > 0) {
        set({ nodes: saved.nodes, edges: saved.edges ?? [] });
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
      await chrome.storage.local.set({
        [STORAGE_KEY]: { nodes: get().nodes, edges: get().edges },
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
}));
