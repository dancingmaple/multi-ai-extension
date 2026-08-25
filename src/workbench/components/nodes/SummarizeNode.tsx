// 汇总节点：调用 AI 将上游输出整理为摘要，可选择多家平台。
import type { NodeProps } from 'reactflow';
import type { WorkbenchNodeData } from '../../store/workflowStore';
import { NodeShell } from './NodeShell';

export function SummarizeNode({ id, data, selected }: NodeProps<WorkbenchNodeData>) {
  return (
    <NodeShell
      id={id}
      data={data}
      selected={selected}
      accent="summarize"
      showTarget
      showSource
      editablePrompt
      showProviders
    />
  );
}
