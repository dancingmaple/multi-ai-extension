// ============================================================
// workbench/store/workflowUtils.ts
// 从 workflowStore 拆出的纯函数工具：拓扑排序、输出聚合、
// 节点构建、记录构建、消毒等。与 store 状态解耦，便于单测与复用。
// 注意：本模块保持「零外部依赖」（不 import @shared/* 路径别名），
// 以便 node --experimental-strip-types 直接单测。
// ============================================================
import type { Edge } from 'reactflow';
import type { ProviderName, WorkbenchNodeType } from '../../shared/types';
import type { NodeOutput } from '../utils/template';
import type { RunRecord, RunNodeResult, WBNode, WorkbenchNodeData } from './workflowStore';

export type { NodeOutput };

/* ── 节点状态机（P3-14 类型化） ─────────────────────────
 * idle     空闲（未运行/已重置）
 * running  执行中（AI 调用进行中）
 * reviewing 执行完成、等待采纳
 * success  已采纳/直接成功
 * error    失败（执行失败或上游失败被跳过）
 *
 * 合法迁移：
 *   idle → running | success(起点/终点) | error
 *   running → reviewing | error
 *   reviewing → success(采纳) | error(重试失败)
 *   error → running(重试) | idle(重置)
 */
export type NodeStatus = 'idle' | 'running' | 'reviewing' | 'success' | 'error';

/** 状态机迁移表：from → 允许的 to 集合 */
export const NODE_STATUS_TRANSITIONS: Record<NodeStatus, Set<NodeStatus>> = {
  idle: new Set(['running', 'success', 'error']),
  running: new Set(['reviewing', 'error']),
  reviewing: new Set(['success', 'error', 'running']),
  success: new Set(['running', 'idle']),
  error: new Set(['running', 'idle', 'reviewing']),
};

/** 校验一次迁移是否合法；非法时返回 false（调用方可决定忽略或告警） */
export function canTransition(from: NodeStatus, to: NodeStatus): boolean {
  return NODE_STATUS_TRANSITIONS[from]?.has(to) ?? false;
}

/** 带校验的状态迁移：合法才返回新状态，否则返回原状态 */
export function transitionStatus(from: NodeStatus, to: NodeStatus): NodeStatus {
  if (canTransition(from, to)) return to;
  console.warn(`[Workbench:status] 非法状态迁移 ${from} → ${to}（已忽略）`);
  return from;
}

export function isTerminalStatus(s: NodeStatus): boolean {
  return s === 'success' || s === 'error';
}

let nodeSeq = 0;
export function nid(): string {
  nodeSeq += 1;
  return `n_${Date.now().toString(36)}_${nodeSeq}`;
}

export function defaultData(nodeType: WorkbenchNodeType): WorkbenchNodeData {
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

export function makeNode(nodeType: WorkbenchNodeType, position: { x: number; y: number }): WBNode {
  return {
    id: nid(),
    type: nodeType,
    position,
    data: defaultData(nodeType),
  };
}

/** 默认示例工作流：Start → Summarize → Process → End */
export function seedWorkflow(): { nodes: WBNode[]; edges: Edge[] } {
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

/** 把所有节点的输出汇总成模板渲染所需的 map（按节点 ID 索引，带缓存） */
let outputMapCache: { key: unknown[]; value: Record<string, NodeOutput> } | null = null;
let varMapCache: { key: unknown[]; value: Record<string, NodeOutput> } | null = null;

/** 输出相关引用序列（任一节点输出引用变化 → key 变化 → 重建） */
function outputKey(nodes: WBNode[]): unknown[] {
  return nodes.map((n) => [n.id, n.data.output, n.data.outputs, n.data.varName]);
}

export function buildOutputMap(nodes: WBNode[]): Record<string, NodeOutput> {
  const key = outputKey(nodes);
  if (outputMapCache && outputMapCache.key.length === key.length && outputMapCache.key.every((k, i) => k === key[i])) {
    return outputMapCache.value;
  }
  const map: Record<string, NodeOutput> = {};
  for (const n of nodes) {
    map[n.id] = { output: n.data.output, outputs: n.data.outputs as Record<string, string> };
  }
  outputMapCache = { key, value: map };
  return map;
}

/** 把所有「设置了变量名」的节点输出汇总成 map（按变量名索引，优先级高于节点 ID，带缓存） */
export function buildVarMap(nodes: WBNode[]): Record<string, NodeOutput> {
  const key = outputKey(nodes);
  if (varMapCache && varMapCache.key.length === key.length && varMapCache.key.every((k, i) => k === key[i])) {
    return varMapCache.value;
  }
  const map: Record<string, NodeOutput> = {};
  for (const n of nodes) {
    const name = n.data.varName?.trim();
    if (name) {
      map[name] = { output: n.data.output, outputs: n.data.outputs as Record<string, string> };
    }
  }
  varMapCache = { key, value: map };
  return map;
}

/** 拓扑排序（Kahn）。存在环时，剩余节点按原顺序追加在末尾。 */
export function topoOrder(nodes: WBNode[], edges: Edge[]): WBNode[] {
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
export function descendants(startId: string, edges: Edge[]): Set<string> {
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

export function joinOutputs(
  outputs: Partial<Record<ProviderName, string>>,
  providers: ProviderName[],
  labels: Record<ProviderName, string> = {} as Record<ProviderName, string>
): string {
  return providers
    .filter((p) => outputs[p] && outputs[p]!.length > 0)
    .map((p) => `## ${labels[p] ?? p}\n${outputs[p]}`)
    .join('\n\n');
}

/** 仅保留可序列化、装载回 ReactFlow 所需的字段（去掉 measured/selected/dragging 等瞬态） */
export function sanitizeNodes(nodes: WBNode[]): WBNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: { x: n.position.x, y: n.position.y },
    data: n.data,
  }));
}

export function sanitizeEdges(edges: Edge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: e.animated,
    label: e.label,
  }));
}

/** 从当前节点状态构建一次运行的记录（长文本截断，避免 storage 膨胀） */
export function buildRunRecord(nodes: WBNode[], edges: Edge[]): RunRecord {
  // 历史记录里单家回答最大保留长度：超过则截断（画布节点仍保留完整内容）
  const MAX_TEXT = 8000;
  const trunc = (s: string): string =>
    s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + '\n…（历史记录已截断）' : s;
  const runNodes: RunNodeResult[] = nodes.map((n) => ({
    id: n.id,
    label: n.data.label,
    nodeType: n.data.nodeType,
    varName: n.data.varName,
    providers: n.data.providers,
    status: n.data.status,
    prompt: n.data.prompt,
    renderedPrompt: n.data.renderedPrompt,
    output: trunc(n.data.output),
    outputs: Object.fromEntries(
      Object.entries(n.data.outputs).map(([p, c]) => [p, c ? trunc(c) : c] as [string, string | undefined])
    ) as Partial<Record<ProviderName, string>>,
    urls: n.data.urls,
    error: n.data.error,
    position: { x: n.position.x, y: n.position.y },
  }));
  const startNode = nodes.find((n) => n.data.nodeType === 'start');
  const hasErr = nodes.some((n) => n.data.status === 'error');
  const hasOk = nodes.some(
    (n) => n.data.status === 'success' || n.data.status === 'reviewing' || n.data.output
  );
  const status: RunRecord['status'] = !hasErr ? 'success' : hasOk ? 'partial' : 'error';
  return {
    id: `run_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`,
    name: (startNode?.data.prompt || '未命名工作流').split('\n')[0].slice(0, 30) || '未命名工作流',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status,
    nodeCount: nodes.length,
    startPrompt: startNode?.data.prompt ?? '',
    nodes: runNodes,
    edges: sanitizeEdges(edges),
  };
}
