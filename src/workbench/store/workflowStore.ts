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
} from '../../shared/types';
import { PROVIDER_LABELS } from '../../shared/constants';
import { renderTemplate } from '../utils/template';
import {
  buildRunMarkdown,
  buildDraftMarkdown,
  downloadMarkdown,
  safeFileName,
  tsStamp,
} from '../utils/export';
import {
  buildOutputMap,
  buildVarMap,
  buildRunRecord,
  descendants,
  joinOutputs,
  makeNode,
  sanitizeEdges,
  sanitizeNodes,
  seedWorkflow,
  topoOrder,
} from './workflowUtils';
import type { NodeStatus as NodeStatusT } from './workflowUtils';

/** 节点状态机定义见 workflowUtils（可单测），这里 re-export 保持兼容 */
export type NodeStatus = NodeStatusT;

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
  /** 阶梯自动探测当前档位（0=首次 15s，1=30s，2=60s）；用于 UI 显示「第 N 次探测」 */
  probeStage?: number;
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

/** 预设流程（内置 + 用户可编辑）：工具栏下拉框直接加载 */
export interface PresetWorkflow {
  id: string;
  name: string;
  /** 是否内置预设（内置不可删除，可覆盖保存为自定义） */
  builtin?: boolean;
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
  /** 节点在画布上的位置（供历史「恢复到画布」还原布局） */
  position?: { x: number; y: number };
}

/** 一次工作流运行的历史记录 */
export interface RunRecord {
  id: string;
  name: string;
  createdAt: number;
  /** 最近一次运行/覆盖时间（同起点去重后每次运行都会更新） */
  updatedAt: number;
  status: 'success' | 'partial' | 'error';
  nodeCount: number;
  startPrompt: string;
  nodes: RunNodeResult[];
  edges: Edge[];
}

const STORAGE_KEY = 'workbench_workflow_v1';
const SAVED_KEY = 'workbench_saved_v1';
const HISTORY_KEY = 'workbench_history_v1';
const PRESET_KEY = 'workbench_presets_v1';
const HISTORY_CAP = 50;

/** 内置预设：公众号写作流水线（seedWorkflow 即该流程） */
function builtinPreset(): PresetWorkflow {
  const { nodes, edges } = seedWorkflow();
  const now = Date.now();
  return {
    id: 'preset_writing',
    name: '公众号写作流水线',
    builtin: true,
    nodes: sanitizeNodes(nodes),
    edges: sanitizeEdges(edges),
    createdAt: now,
    updatedAt: now,
  };
}

function sanitizePreset(p: PresetWorkflow): PresetWorkflow {
  return {
    id: p.id,
    name: p.name,
    builtin: p.builtin,
    nodes: sanitizeNodes(p.nodes),
    edges: sanitizeEdges(p.edges),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}


/** 通过 background 执行一次 AI 调用（WORKBENCH_EXECUTE） */
function sendWorkbenchExecute(
  prompt: string,
  providers: ProviderName[],
  nodeId: string,
  nodeType: WorkbenchNodeType
): Promise<WorkbenchExecResult> {
  // 超时兜底：background 侧最长等待 ≈ maxPer(120s)+8s 余量；这里给 140s。
  // 若无超时，background 无响应会让 promise 永不 settle → running 永久 true →
  // 所有节点按钮 disabled（"点运行无响应"）+ executingNodes 永久残留。
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.error('[Workbench:store] WORKBENCH_EXECUTE 超时(140s)，未收到 background 响应');
      reject(new Error('执行超时：background 长时间未响应（可稍后点「手动获取」补救）'));
    }, 140_000);
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
        clearTimeout(timer);
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
      clearTimeout(timer);
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
  // 超时兜底：逐家顺序读屏，45s 足够；避免 background 无响应导致 promise 永不 settle
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.error('[Workbench:store] WORKBENCH_GRAB 超时(45s)，未收到 background 响应');
      reject(new Error('手动获取超时：background 长时间未响应'));
    }, 45_000);
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
        clearTimeout(timer);
        const lastErr = chrome.runtime.lastError?.message;
        if (lastErr) reject(new Error(lastErr));
        else resolve(resp);
      });
    } catch (e) {
      clearTimeout(timer);
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
 * 阶梯探测间隔（秒）：节点执行完成后若还有缺失回答（自动抓取失败），
 * 依次按 15s → 30s → 60s 自动「探测获取」，最多 3 档；每档到点调用
 * grabNodeAnswers 强制刷新，抓齐即停，全档用尽才放弃（UI 可见倒计时可取消）。
 */
const PROBE_INTERVALS_SEC = [15, 30, 60];

/**
 * 调度一次「阶梯自动探测获取」。
 * @param stage 第几档（0 起）；stage 0 若节点配置了 grabDelay，则首次延迟用 grabDelay 秒
 */
function scheduleProbeGrab(get: () => WorkflowState, id: string, stage: number): void {
  const node = get().nodes.find((n) => n.id === id);
  if (!node) return;
  const { providers, outputs, grabDelay } = node.data;
  const answered = providers.filter((p) => outputs[p] && outputs[p]!.length > 0).length;
  // 已抓齐：无需继续探测
  if (answered >= providers.length) return;
  // 档位用尽：放弃
  if (stage >= PROBE_INTERVALS_SEC.length) {
    get().updateNodeData(id, { autoGrabAt: undefined, probeStage: undefined });
    return;
  }
  // 首次探测：尊重用户配置的 grabDelay（>0 时作为首次延迟）；未配置则用档位间隔
  const delaySec = stage === 0 && grabDelay && grabDelay > 0 ? grabDelay : PROBE_INTERVALS_SEC[stage];
  clearAutoGrabTimer(id);
  const at = Date.now() + delaySec * 1000;
  get().updateNodeData(id, { autoGrabAt: at, probeStage: stage });
  const t = setTimeout(() => {
    autoGrabTimers.delete(id);
    get().updateNodeData(id, { autoGrabAt: undefined });
    void get()
      .grabNodeAnswers(id)
      .then(() => {
        // 抓完后二次校验：节点若已被采纳(success)/重新运行/用户取消，就不再续档探测，
        // 避免「采纳并继续」或重跑后旧探测回调又补一刀造成竞态。
        const n = get().nodes.find((x) => x.id === id);
        if (!n) return;
        if (n.data.status === 'success') {
          get().updateNodeData(id, { probeStage: undefined });
          return;
        }
        // 还缺则进入下一档继续探测
        scheduleProbeGrab(get, id, stage + 1);
      });
  }, delaySec * 1000);
  autoGrabTimers.set(id, t);
}

/** 取消某节点的自动探测（用户点「取消」/ 重新执行时调用） */
function cancelProbe(get: () => WorkflowState, id: string): void {
  clearAutoGrabTimer(id);
  get().updateNodeData(id, { autoGrabAt: undefined, probeStage: undefined });
}

interface WorkflowState {
  nodes: WBNode[];
  edges: Edge[];
  running: boolean;

  // ── 已保存工作流（可复用库） ──
  savedWorkflows: SavedWorkflow[];
  // ── 预设流程（内置 + 用户可编辑，工具栏下拉框加载） ──
  presetWorkflows: PresetWorkflow[];
  // ── 运行历史 ──
  runHistory: RunRecord[];
  // ── 当前打开的浮层：'none' | 'saved' | 'history' ──
  panel: 'none' | 'saved' | 'history';
  // ── 会话坞（侧边嵌入/聚焦 AI 标签页）开关 ──
  dockOpen: boolean;
  toggleDock: () => void;
  /** 手动获取的逐平台进度（正在抓哪家的哪节点）；null = 无进行中的抓取 */
  grabProgress: { nodeId: string; provider: ProviderName } | null;
  setGrabProgress: (p: { nodeId: string; provider: ProviderName } | null) => void;

  // ── ReactFlow 编辑回调 ──
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (conn: Connection) => void;
  addNode: (nodeType: WorkbenchNodeType) => void;
  /** 在指定画布坐标新增节点（右键菜单/双击空白处用） */
  addNodeAt: (nodeType: WorkbenchNodeType, position: { x: number; y: number }) => void;
  updateNodeData: (id: string, patch: Partial<WorkbenchNodeData>) => void;
  /** 直接编辑某家 AI 的回答文本（节点结果可编辑），并重新聚合 output */
  updateNodeOutput: (id: string, provider: ProviderName, text: string) => void;
  /** 取消该节点待触发的自动获取定时器 */
  cancelAutoGrab: (id: string) => void;

  // ── 引擎 ──
  executeNode: (id: string) => Promise<void>;
  /** 从某节点开始运行其下游（默认含自身；「采纳并继续」时 excludeSelf 排除当前节点） */
  runDownstream: (id: string, opts?: { excludeSelf?: boolean }) => Promise<void>;
  runWorkflow: () => Promise<void>;
  confirmNode: (id: string) => void;
  /** 采纳当前节点并自动继续运行其下游节点（「采纳并继续」） */
  confirmAndContinue: (id: string) => Promise<void>;
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

  // ── 预设流程（工具栏下拉框） ──
  loadPresets: () => Promise<void>;
  /** 把当前画布保存为预设：同名覆盖，否则新增 */
  savePreset: (name: string) => Promise<void>;
  /** 加载预设到画布 */
  loadPreset: (id: string) => Promise<void>;
  /** 删除用户自定义预设（内置不可删） */
  deletePreset: (id: string) => Promise<void>;
  /** 用指定预设覆盖当前画布并进入编辑（下拉框选中即调用） */
  applyPreset: (id: string) => Promise<void>;
  /** 把当前画布以「预设名」保存（供编辑后重新保存） */
  saveCurrentAsPreset: (name: string) => Promise<void>;

  // ── 运行历史 ──
  loadRunHistory: () => Promise<void>;
  recordRun: () => void;
  deleteRunHistory: (id: string) => void;
  clearRunHistory: () => void;
  exportRun: (id?: string) => void;
  /** 把某条历史记录还原到画布（含节点位置/提示词/输出），便于复现或续跑 */
  restoreRunToCanvas: (id: string) => void;

  // ── 浮层 ──
  openPanel: (panel: 'saved' | 'history') => void;
  closePanel: () => void;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  running: false,
  savedWorkflows: [],
  presetWorkflows: [builtinPreset()],
  runHistory: [],
  panel: 'none',
  dockOpen: false,
  grabProgress: null,
  setGrabProgress: (p) => set({ grabProgress: p }),

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
    get().addNodeAt(nodeType, { x: 200 + col * 120, y: 120 + row * 100 });
  },
  addNodeAt: (nodeType, position) => {
    const node = makeNode(nodeType, position);
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
    const output = joinOutputs(outputs, node.data.providers, PROVIDER_LABELS);
    get().updateNodeData(id, { outputs, output });
  },

  cancelAutoGrab: (id) => {
    cancelProbe(get, id);
  },

  confirmNode: (id) => {
    const node = get().nodes.find((n) => n.id === id);
    if (node && node.data.status === 'reviewing') {
      get().updateNodeData(id, { status: 'success' });
    }
  },

  /** 采纳当前节点并自动继续运行其下游节点（「采纳并继续」） */
  confirmAndContinue: async (id) => {
    get().confirmNode(id);
    await get().runDownstream(id, { excludeSelf: true });
  },

  grabNodeAnswers: async (id) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return;
    const { providers, renderedPrompt, prompt, outputs: prevOutputs, taskId, tabIds: prevTabIds, urls: prevUrls } =
      node.data;
    if (providers.length === 0) return;
    const sendPrompt = renderedPrompt || prompt;

    // 手动获取是「用户主动要最新内容」：抓取成功的项强制覆盖旧值，
    // 避免界面一直显示上一次的结果；抓不到的家才保留旧值并记错误。
    get().updateNodeData(id, { error: undefined });
    const merged: Partial<Record<ProviderName, string>> = { ...(prevOutputs as Record<ProviderName, string>) };
    const errs: Partial<Record<ProviderName, string>> = {};
    const urls: Partial<Record<ProviderName, string>> = { ...(prevUrls as Record<ProviderName, string>) };
    const tabIds: Partial<Record<ProviderName, number>> = { ...(prevTabIds as Record<ProviderName, number>) };
    try {
      // 逐家抓取：每家完成后更新一次进度，用户能看到「正在抓 ChatGPT / 正在抓 Qwen…」
      for (const p of providers) {
        get().setGrabProgress({ nodeId: id, provider: p });
        const result = await sendWorkbenchGrab(
          sendPrompt,
          [p],
          id,
          taskId,
          tabIds[p] !== undefined ? { [p]: tabIds[p] } : undefined,
          urls[p] ? { [p]: urls[p] } : undefined
        );
        const txt = result.outputs[p];
        if (txt && txt.length > 0) {
          // 手动获取 = 强制刷新：抓到的新内容直接覆盖旧内容
          merged[p] = txt;
        } else if (result.errors[p]) {
          errs[p] = result.errors[p];
        }
        if (result.urls?.[p]) urls[p] = result.urls[p];
        if (result.tabIds?.[p] !== undefined) tabIds[p] = result.tabIds[p];
      }
      const answered = providers.filter((p) => merged[p] && merged[p]!.length > 0);
      const output = joinOutputs(merged, providers, PROVIDER_LABELS);
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
    } finally {
      get().setGrabProgress(null);
    }
  },

  executeNode: async (id) => {
    // 防同节点重入：上一次执行还没结束（背景 SW 卡/AI 超时/用户连点）
    if (executingNodes.has(id)) return;
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return;
    const { nodeType, prompt, providers } = node.data;

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

    // summarize / process：执行前检查直接上游是否全部失败/无输出。
    // 避免上游失败后下游仍白白调用 AI（基于空上下文回答毫无意义）。
    // 全部上游都失败或无输出 → 节点标 error 并跳过；部分正常 → 继续让 AI 处理可用输入。
    {
      const allEdges = get().edges;
      const allNodesNow = get().nodes;
      const upstreamIds = allEdges.filter((e) => e.target === id).map((e) => e.source);
      if (upstreamIds.length > 0) {
        const upstreamNodes = upstreamIds
          .map((uid) => allNodesNow.find((n) => n.id === uid))
          .filter(Boolean) as typeof allNodesNow;
        if (
          upstreamNodes.length > 0 &&
          upstreamNodes.every(
            (n) => n.data.status === 'error' || !n.data.output || n.data.output.trim().length === 0
          )
        ) {
          const details = upstreamNodes
            .map((n) => (n.data.status === 'error' ? `${n.data.label}(失败)` : `${n.data.label}(无输出)`))
            .join('、');
          get().updateNodeData(id, {
            status: 'error',
            error: `上游节点未提供有效输出（${details}）。请先修复上游后再运行。`,
            outputs: {},
            output: '',
            urls: undefined,
            tabIds: undefined,
            taskId: undefined,
          });
          return;
        }
      }
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
        const output = joinOutputs(result.outputs, providers, PROVIDER_LABELS);
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
        // 执行完成后自动开始阶梯探测：若仍有缺失回答，按 15s→30s→60s 自动补抓
        scheduleProbeGrab(get, id, 0);
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
        scheduleProbeGrab(get, id, 0);
      }
    } catch (e) {
      get().updateNodeData(id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
    } finally {
      executingNodes.delete(id);
    }
  },

  runDownstream: async (id, opts?: { excludeSelf?: boolean }) => {
    // 运行前重置：把本次涉及的节点恢复为 idle、清空旧错误/残留自动获取倒计时，
    // 并**清空上一轮运行产物**（outputs/output/urls/tabIds/taskId），
    // 让界面一开始就是干净的，绝不残留上次的结果。
    const order = topoOrder(get().nodes, get().edges);
    const desc = descendants(id, get().edges);
    // 默认包含起始节点自身（「从此节点开始重跑」）；「采纳并继续」时排除自身
    const targets = new Set(
      [...desc].filter((nid) => (opts?.excludeSelf ? nid !== id : true))
    );
    const seq = order.filter((n) => targets.has(n.id));
    for (const n of seq) clearAutoGrabTimer(n.id);
    set({
      nodes: get().nodes.map((n) =>
        targets.has(n.id)
          ? {
              ...n,
              data: {
                ...n.data,
                status: 'idle' as NodeStatus,
                error: undefined,
                autoGrabAt: undefined,
                probeStage: undefined,
                outputs: {},
                output: '',
                urls: undefined,
                tabIds: undefined,
                taskId: undefined,
              },
            }
          : n
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
    // 运行前重置全部节点：清除旧状态/错误/残留自动获取定时器，并**清空上一轮运行产物**，
    // 保证本次运行一开始界面就是干净的（不显示上一轮的任何结果）。
    for (const n of get().nodes) clearAutoGrabTimer(n.id);
    set({
      nodes: get().nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          status: 'idle' as NodeStatus,
          error: undefined,
          autoGrabAt: undefined,
          probeStage: undefined,
          outputs: {},
          output: '',
          urls: undefined,
          tabIds: undefined,
          taskId: undefined,
        },
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
    // 先加载预设流程（内置写作流水线 + 用户自定义），供工具栏下拉框使用
    void get().loadPresets();
    try {
      const res = await chrome.storage.local.get(STORAGE_KEY);
      const saved = res[STORAGE_KEY] as { nodes: WBNode[]; edges: Edge[] } | undefined;
      if (saved && Array.isArray(saved.nodes) && saved.nodes.length > 0) {
        // SW/页面重载后：保留 autoGrabAt/probeStage（用于续调探测），
        // 仅清除已过期的倒计时标记（到点未执行的探测重新调度）。
        const now = Date.now();
        const cleaned = saved.nodes.map((n) => {
          const at = n.data.autoGrabAt;
          const keep = typeof at === 'number' && at > now && typeof n.data.probeStage === 'number';
          return {
            ...n,
            data: { ...n.data, autoGrabAt: keep ? at : undefined, probeStage: keep ? n.data.probeStage : undefined },
          };
        });
        set({ nodes: cleaned, edges: saved.edges ?? [] });
        // 重载后恢复未过期的探测定时器（SW 重启丢定时器，这里按剩余时间续调）
        for (const n of cleaned) {
          const at = n.data.autoGrabAt;
          const stage = n.data.probeStage;
          if (typeof at === 'number' && typeof stage === 'number' && at > now) {
            const remainMs = at - now;
            const t = setTimeout(() => {
              autoGrabTimers.delete(n.id);
              get().updateNodeData(n.id, { autoGrabAt: undefined });
              void get()
                .grabNodeAnswers(n.id)
                .then(() => {
                  const cur = get().nodes.find((x) => x.id === n.id);
                  if (!cur || cur.data.status === 'success') {
                    get().updateNodeData(n.id, { probeStage: undefined });
                    return;
                  }
                  scheduleProbeGrab(get, n.id, stage + 1);
                });
            }, remainMs);
            autoGrabTimers.set(n.id, t);
          }
        }
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

  // ── 预设流程（工具栏下拉框） ──────────────────────────
  loadPresets: async () => {
    const builtin = builtinPreset();
    try {
      const res = await chrome.storage.local.get(PRESET_KEY);
      const stored = (res[PRESET_KEY] as PresetWorkflow[] | undefined) ?? [];
      const list = Array.isArray(stored) ? stored : [];
      // 内置预设总是存在（用户可能自定义覆盖同名 id：同名时以用户保存为准）
      const merged: PresetWorkflow[] = list.some((p) => p.id === builtin.id)
        ? list
        : [builtin, ...list];
      set({ presetWorkflows: merged.map(sanitizePreset) });
    } catch {
      set({ presetWorkflows: [builtin] });
    }
  },

  savePreset: async (name) => {
    const trimmed = (name || '').trim() || `预设 ${new Date().toLocaleString('zh-CN')}`;
    const now = Date.now();
    const current = {
      nodes: sanitizeNodes(get().nodes),
      edges: sanitizeEdges(get().edges),
    };
    const list = get().presetWorkflows;
    // 同名覆盖（含内置预设：允许用当前画布覆盖「公众号写作流水线」）
    const sameName = list.find((p) => p.name === trimmed);
    const next: PresetWorkflow[] = sameName
      ? list.map((p) =>
          p.id === sameName.id
            ? { ...p, ...current, name: trimmed, updatedAt: now }
            : p
        )
      : [
          {
            id: `preset_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`,
            name: trimmed,
            nodes: current.nodes,
            edges: current.edges,
            createdAt: now,
            updatedAt: now,
          },
          ...list,
        ];
    set({ presetWorkflows: next });
    try {
      await chrome.storage.local.set({ [PRESET_KEY]: next });
    } catch {
      /* 存储失败静默 */
    }
  },

  applyPreset: async (id) => {
    const p = get().presetWorkflows.find((x) => x.id === id);
    if (!p) return;
    // 加载预设到画布（保留预设内保存的节点结构；状态重置为 idle）
    const nodes = p.nodes.map((n) => ({
      ...n,
      data: { ...n.data, status: 'idle' as NodeStatus, error: undefined, outputs: {}, output: '' },
    }));
    set({ nodes, edges: p.edges, panel: 'none' });
    void get().save();
  },

  loadPreset: async (id) => {
    await get().applyPreset(id);
  },

  deletePreset: async (id) => {
    const target = get().presetWorkflows.find((p) => p.id === id);
    if (!target || target.builtin) return; // 内置预设不可删除
    const next = get().presetWorkflows.filter((p) => p.id !== id);
    set({ presetWorkflows: next });
    try {
      await chrome.storage.local.set({ [PRESET_KEY]: next });
    } catch {
      /* 存储失败静默 */
    }
  },

  saveCurrentAsPreset: async (name) => {
    await get().savePreset(name);
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
    const now = Date.now();
    // 同一起点（startPrompt 相同）只保留一条历史：覆盖旧记录、更新到顶部，
    // 避免同一次输入反复运行在「历史」里堆出多条相同起点。
    const sameStartIdx = get().runHistory.findIndex((r) => r.startPrompt === rec.startPrompt);
    let next: RunRecord[];
    if (sameStartIdx >= 0) {
      const merged: RunRecord = {
        ...get().runHistory[sameStartIdx],
        ...rec,
        id: get().runHistory[sameStartIdx].id, // 保留原 id，便于导出/删除定位
        createdAt: get().runHistory[sameStartIdx].createdAt,
        updatedAt: now,
      };
      next = [merged, ...get().runHistory.filter((_, i) => i !== sameStartIdx)].slice(0, HISTORY_CAP);
    } else {
      next = [{ ...rec, updatedAt: now }, ...get().runHistory].slice(0, HISTORY_CAP);
    }
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

  restoreRunToCanvas: (id) => {
    const rec = get().runHistory.find((r) => r.id === id);
    if (!rec) return;
    // 用历史快照重建节点（含提示词/输出/位置），edges 直接还原
    const nodes: WBNode[] = rec.nodes.map((n) => ({
      id: n.id,
      type: n.nodeType,
      position: n.position ?? { x: 120, y: 120 },
      data: {
        label: n.label,
        nodeType: n.nodeType,
        prompt: n.prompt,
        providers: n.providers,
        varName: n.varName,
        output: n.output,
        outputs: n.outputs as Partial<Record<ProviderName, string>>,
        status: n.status,
        renderedPrompt: n.renderedPrompt,
        urls: n.urls,
        error: n.error,
      },
    }));
    set({ nodes, edges: rec.edges, panel: 'none' });
    void get().save();
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
