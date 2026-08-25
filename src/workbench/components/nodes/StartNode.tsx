// 起点节点：仅作为种子输入，不调用 AI，无入口连线桩。
import type { NodeProps } from 'reactflow';
import type { WorkbenchNodeData } from '../../store/workflowStore';
import { NodeShell } from './NodeShell';

export function StartNode({ id, data, selected }: NodeProps<WorkbenchNodeData>) {
  return (
    <NodeShell
      id={id}
      data={data}
      selected={selected}
      accent="start"
      showTarget={false}
      showSource
      editablePrompt
      showProviders={false}
    />
  );
}
