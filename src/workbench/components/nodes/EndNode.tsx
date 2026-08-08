// 终点节点：聚合上游输出（渲染模板），不调用 AI，无出口连线桩。
import type { NodeProps } from 'reactflow';
import type { WorkbenchNodeData } from '../../store/workflowStore';
import { NodeShell } from './NodeShell';

export function EndNode({ id, data, selected }: NodeProps<WorkbenchNodeData>) {
  return (
    <NodeShell
      id={id}
      data={data}
      selected={selected}
      accent="end"
      showTarget
      showSource={false}
      editablePrompt
      showProviders={false}
    />
  );
}
