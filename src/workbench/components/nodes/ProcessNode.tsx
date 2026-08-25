// 处理节点：调用 AI 基于上游输出生成方案 / 执行处理，可选择多家平台。
import type { NodeProps } from 'reactflow';
import type { WorkbenchNodeData } from '../../store/workflowStore';
import { NodeShell } from './NodeShell';

export function ProcessNode({ id, data, selected }: NodeProps<WorkbenchNodeData>) {
  return (
    <NodeShell
      id={id}
      data={data}
      selected={selected}
      accent="process"
      showTarget
      showSource
      editablePrompt
      showProviders
    />
  );
}
