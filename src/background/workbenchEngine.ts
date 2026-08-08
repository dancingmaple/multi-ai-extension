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

  console.log('[Workbench:engine] 开始执行', { taskId, providers });
  await handleAskAll(taskId, prompt, providers);

  // 取各家超时上限 + 余量作为总等待上限
  const maxPer = Math.max(...providers.map((p) => DEFAULT_SETTINGS.responseTimeoutMs[p] ?? 60000));
  const deadline = Date.now() + maxPer + 8000;
  const budgetSec = Math.round((maxPer + 8000) / 1000);

  while (Date.now() < deadline) {
    const task = getTask(taskId);
    if (task) {
      let allSettled = true;
      for (const p of providers) {
        const st = task.providers[p]?.status;
        if (st === 'done') {
          const content = task.providers[p]?.content ?? '';
          // 关键：done 但内容为空属于「抓取失败/未渲染完」，不能算成功；
          // 留作未落定，最终记为超时错误，便于用户用「手动获取」补救。
          if (content.trim().length > 0) {
            if (outputs[p] === undefined) {
              outputs[p] = content;
              console.log('[Workbench:engine]', p, 'done (len=' + content.length + ')');
            }
          } else {
            allSettled = false;
          }
        } else if (st === 'error' || st === 'login_required') {
          if (errors[p] === undefined) {
            errors[p] = task.providers[p].error || st;
            console.warn('[Workbench:engine]', p, 'failed:', errors[p]);
          }
        } else {
          allSettled = false;
        }
      }
      if (allSettled) break;
    }
    await sleep(400);
  }

  // 超时仍未落定（仍在 sending/waiting，或 done 但内容为空）的 provider，
  // 记为明确超时错误，便于排查，也提示用户可「手动获取」。
  for (const p of providers) {
    if (outputs[p] === undefined && errors[p] === undefined) {
      errors[p] = `超时（>${budgetSec}s 无响应，可能未登录 / 网络不通 / 受信任点击未触发）`;
      console.warn('[Workbench:engine]', p, 'timeout after', budgetSec, 's');
    }
  }

  const ok = providers.every((p) => outputs[p] !== undefined && errors[p] === undefined);
  console.log('[Workbench:engine] 结束', {
    ok,
    answered: Object.keys(outputs),
    failed: Object.keys(errors),
  });
  return { ok, outputs, errors, taskId };
}
