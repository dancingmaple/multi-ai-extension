// ============================================================
// background/workbenchEngine.ts — 工作台节点的 AI 执行器
// 复用现有 handleAskAll + stateStore，把「流式多步骤」收敛成
// 一次「请求 / 响应」，供 Workbench 前端按节点同步等待结果。
// ============================================================

import type { ProviderName, WorkbenchExecResult } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/constants';
import { handleAskAll } from './messageRouter';
import { getTask } from './stateStore';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 向一组 AI 并发发送 prompt，并等待它们全部落定（done / error / login_required），
 * 返回各家最终文本。底层完全复用现有适配器与标签页调度，无需为工作台重写 AI 逻辑。
 */
export async function runWorkbenchExecution(
  prompt: string,
  providers: ProviderName[]
): Promise<WorkbenchExecResult> {
  const taskId = `wb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const outputs: Partial<Record<ProviderName, string>> = {};
  const errors: Partial<Record<ProviderName, string>> = {};

  if (providers.length === 0) {
    return { ok: false, outputs, errors: { _empty: '未选择任何 AI' } as Partial<Record<ProviderName, string>> };
  }

  await handleAskAll(taskId, prompt, providers);

  // 取各家超时上限 + 余量作为总等待上限
  const maxPer = Math.max(...providers.map((p) => DEFAULT_SETTINGS.responseTimeoutMs[p] ?? 60000));
  const deadline = Date.now() + maxPer + 8000;

  while (Date.now() < deadline) {
    const task = getTask(taskId);
    if (task) {
      let allSettled = true;
      for (const p of providers) {
        const st = task.providers[p]?.status;
        if (st === 'done') {
          if (outputs[p] === undefined) outputs[p] = task.providers[p].content;
        } else if (st === 'error' || st === 'login_required') {
          if (errors[p] === undefined) errors[p] = task.providers[p].error || st;
        } else {
          allSettled = false;
        }
      }
      if (allSettled) break;
    }
    await sleep(400);
  }

  const ok = providers.every((p) => outputs[p] !== undefined && errors[p] === undefined);
  return { ok, outputs, errors };
}
