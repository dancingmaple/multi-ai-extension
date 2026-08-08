// ============================================================
// workbench/utils/export.ts
// 把一次工作流运行（或当前草稿）渲染成 Markdown，并触发浏览器下载。
// 导出内容包含：运行元信息、起点输入、每个节点的提示词 / 各平台原始回答 /
// 聚合输出 / 错误，便于完整沉淀「过程数据 + 结果」。
// ============================================================
import type { ProviderName, WorkbenchNodeType } from '@shared/types';
import { PROVIDER_LABELS } from '@shared/constants';
import type {
  RunRecord,
  WorkbenchNodeData,
  NodeStatus,
} from '../store/workflowStore';

/** 节点类型 → 中文名 */
export function nodeTypeLabel(t: WorkbenchNodeType): string {
  switch (t) {
    case 'start':
      return '起点 / 输入';
    case 'summarize':
      return '汇总';
    case 'process':
      return '处理';
    case 'end':
      return '终点 / 输出';
    default:
      return t;
  }
}

/** 运行状态 → 中文名 */
export function runStatusLabel(s: RunRecord['status']): string {
  switch (s) {
    case 'success':
      return '全部成功';
    case 'partial':
      return '部分成功';
    case 'error':
      return '执行失败';
    default:
      return s;
  }
}

/** 单节点状态 → 中文名 */
export function nodeStatusLabel(s: NodeStatus): string {
  switch (s) {
    case 'idle':
      return '空闲';
    case 'running':
      return '运行中';
    case 'reviewing':
      return '待采纳';
    case 'success':
      return '成功';
    case 'error':
      return '失败';
    default:
      return s;
  }
}

/** 压缩多余空行 */
function tidy(t: string): string {
  return (t ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 把一次运行记录渲染成 Markdown。
 * @param rec 运行记录（含每个节点的过程与结果）
 */
export function buildRunMarkdown(rec: RunRecord): string {
  const L: string[] = [];
  L.push(`# 工作台运行记录：${rec.name}`);
  L.push('');
  L.push(`- 运行时间：${new Date(rec.createdAt).toLocaleString('zh-CN')}`);
  L.push(`- 运行状态：${runStatusLabel(rec.status)}`);
  L.push(`- 节点数：${rec.nodeCount}`);
  L.push('');

  L.push('## 起点输入');
  L.push('');
  L.push('```');
  L.push(tidy(rec.startPrompt) || '(空)');
  L.push('```');
  L.push('');

  for (const n of rec.nodes) {
    L.push(`## 节点：${n.label}（${nodeTypeLabel(n.nodeType)}）`);
    L.push('');
    if (n.varName) L.push(`- 变量名：\`${n.varName}\``);
    if (n.providers.length) {
      L.push(`- 调用平台：${n.providers.map((p) => PROVIDER_LABELS[p]).join('、')}`);
    }
    L.push(`- 状态：${nodeStatusLabel(n.status)}`);
    L.push('');

    if (n.prompt) {
      L.push('### 提示词');
      L.push('');
      L.push('```');
      L.push(tidy(n.prompt));
      L.push('```');
      L.push('');
    }

    const outEntries = Object.entries(n.outputs).filter(([, c]) => c && c.length > 0);
    if (outEntries.length) {
      L.push('### 各平台原始回答');
      L.push('');
      for (const [p, c] of outEntries) {
        L.push(`#### ${PROVIDER_LABELS[p as ProviderName] ?? p}`);
        L.push('');
        L.push(tidy(c!));
        L.push('');
      }
    }

    if (n.output && outEntries.length > 1) {
      // 仅当聚合输出与单家不同时额外展示（多平台时聚合更有价值）
      L.push('### 聚合输出（多平台拼接）');
      L.push('');
      L.push(tidy(n.output));
      L.push('');
    } else if (n.output) {
      L.push('### 输出');
      L.push('');
      L.push(tidy(n.output));
      L.push('');
    }

    if (n.error) {
      L.push(`> ⚠ 错误：${tidy(n.error)}`);
      L.push('');
    }

    const urlEntries = Object.entries(n.urls ?? {}).filter(([, u]) => u && u.length > 0);
    if (urlEntries.length) {
      L.push('### 各平台会话链接（回看 / 溯源）');
      L.push('');
      for (const [p, u] of urlEntries) {
        L.push(`- ${PROVIDER_LABELS[p as ProviderName] ?? p}：${u}`);
      }
      L.push('');
    }
  }

  return L.join('\n');
}

/** 把当前画布（未运行的草稿）渲染成 Markdown，便于「导出当前设计」 */
export function buildDraftMarkdown(
  name: string,
  nodes: { data: WorkbenchNodeData }[]
): string {
  const L: string[] = [];
  L.push(`# 工作台设计草稿：${name}`);
  L.push('');
  L.push(`- 导出时间：${new Date().toLocaleString('zh-CN')}`);
  L.push(`- 节点数：${nodes.length}`);
  L.push('');
  for (const n of nodes) {
    const d = n.data;
    L.push(`## ${d.label}（${nodeTypeLabel(d.nodeType)}）`);
    L.push('');
    if (d.varName) L.push(`- 变量名：\`${d.varName}\``);
    if (d.providers.length) {
      L.push(`- 调用平台：${d.providers.map((p) => PROVIDER_LABELS[p]).join('、')}`);
    }
    L.push('');
    if (d.prompt) {
      L.push('```');
      L.push(tidy(d.prompt));
      L.push('```');
      L.push('');
    }

    const urlEntries = Object.entries(d.urls ?? {}).filter(([, u]) => u && u.length > 0);
    if (urlEntries.length) {
      L.push('各平台会话链接：');
      for (const [p, u] of urlEntries) {
        L.push(`- ${PROVIDER_LABELS[p as ProviderName] ?? p}：${u}`);
      }
      L.push('');
    }
  }
  return L.join('\n');
}

/** 触发浏览器下载一段 Markdown 文本 */
export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.md') ? filename : `${filename}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 生成安全的文件名片段 */
export function safeFileName(s: string): string {
  return (s || 'workbench')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 40);
}

/** 生成 YYYYMMDD_HHmmss 时间戳串 */
export function tsStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}
