// ============================================================
// background/workbenchEngine.ts — 工作台节点的 AI 执行器
// 复用现有 handleAskAll + stateStore，把「流式多步骤」收敛成
// 一次「请求 / 响应」，供 Workbench 前端按节点同步等待结果。
// ============================================================

import type { AskTaskState, ProviderName, WorkbenchExecResult } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/constants';
import { handleAskAll, markTaskDeleted } from './messageRouter';
import { getTask, deleteTask } from './stateStore';
import { onBroadcast } from '../shared/messaging';

/**
 * 事件驱动等待：订阅 TASK_STATE_UPDATE 广播，当本任务全部 settle 时立即返回
 * （替代 400ms 轮询，省电且更即时）；同时按「每 provider 独立 deadline」兜底（#42）。
 */
function waitForSettled(
  taskId: string,
  providers: ProviderName[],
  outputs: Partial<Record<ProviderName, string>>,
  errors: Partial<Record<ProviderName, string>>,
  deadlinePerProvider: Record<string, number>
): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const settled = new Set<ProviderName>();
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(tick);
      off();
      resolve();
    };

    const collect = (task: AskTaskState | undefined) => {
      if (!task || task.taskId !== taskId) return;
      for (const p of providers) {
        const st = task.providers[p]?.status;
        if (st === 'done') {
          const content = task.providers[p]?.content ?? '';
          // 关键：done 但内容为空属于「抓取失败/未渲染完」，不能算成功；
          // 留作未落定，最终由 deadline 兜底记为超时错误。
          if (content.trim().length > 0) {
            if (outputs[p] === undefined) {
              outputs[p] = content;
              console.log('[Workbench:engine]', p, 'done (len=' + content.length + ')');
            }
            settled.add(p);
          }
        } else if (st === 'error' || st === 'login_required') {
          if (errors[p] === undefined) {
            errors[p] = task.providers[p]?.error || st;
            console.warn('[Workbench:engine]', p, 'failed:', errors[p]);
          }
          settled.add(p);
        }
      }
      if (settled.size >= providers.length) finish();
    };

    const off = onBroadcast((msg) => {
      if (msg.type === 'TASK_STATE_UPDATE') collect(msg.task);
    });

    // 每 provider 独立 deadline：短超时 provider（如 deepseek 45s）不再被最长家
    // （如 chatgpt 120s）拖到统一 deadline 才记超时（#42）。
    const tick = setInterval(() => {
      for (const p of providers) {
        if (settled.has(p)) continue;
        const dl = deadlinePerProvider[p];
        if (dl !== undefined && Date.now() >= dl) {
          if (outputs[p] === undefined && errors[p] === undefined) {
            errors[p] = '超时（无响应，可能未登录 / 网络不通 / 受信任点击未触发）';
            console.warn('[Workbench:engine]', p, 'timeout');
          }
          settled.add(p);
        }
      }
      if (settled.size >= providers.length) finish();
    }, 500);

    // 订阅前先看一次当前状态（可能已全部完成）
    collect(getTask(taskId));
  });
}

/**
 * 向一组 AI 并发发送 prompt，并等待它们全部落定（done / error / login_required），
 * 返回各家最终文本。底层完全复用现有适配器与标签页调度，无需为工作台重写 AI 逻辑。
 */
export async function runWorkbenchExecution(
  prompt: string,
  providers: ProviderName[],
  opts?: { nodeId?: string }
): Promise<WorkbenchExecResult> {
  const taskId = `wb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const outputs: Partial<Record<ProviderName, string>> = {};
  const errors: Partial<Record<ProviderName, string>> = {};

  if (providers.length === 0) {
    return { ok: false, outputs, errors: { _empty: '未选择任何 AI' } as Partial<Record<ProviderName, string>> };
  }

  console.log('[Workbench:engine] 开始执行', { taskId, providers, nodeId: opts?.nodeId });
  // 透传 nodeId：让后台为「这个节点」复用 / 新建其专属标签页（每节点独立会话，不串台）

  // 每 provider 独立 deadline（超时上限 + 余量），短超时家不被最长家拖住（#42）
  const deadlinePerProvider: Record<string, number> = {};
  for (const p of providers) {
    const per = DEFAULT_SETTINGS.responseTimeoutMs[p] ?? 60000;
    deadlinePerProvider[p] = Date.now() + per + 8000;
  }

  // 并行：派发指令（不阻塞） + 事件驱动等待（广播驱动即时返回，超时兜底）。
  // 关键：不能 await handleAskAll —— 它内部 await Promise.allSettled(dispatches)，
  // 单家 dispatch 最坏数十秒（tab ready + sendMessage 超时），会超过 deadline
  // 导致 waitForSettled 永不启动、整个请求永久挂起。改为 fire dispatch 同时启动等待。
  const dispatchPromise = handleAskAll(taskId, prompt, providers, { nodeId: opts?.nodeId });
  await waitForSettled(taskId, providers, outputs, errors, deadlinePerProvider);
  // 派发链应已随 settle 完成；兜底 await 一下避免悬挂 Promise
  await dispatchPromise.catch(() => {});

  // 收集每家 AI 的最终会话地址与标签页 id（回看/手动获取/会话坞用）。
  // 优先用实时标签页地址（最权威），content script 经 EMBED_URL 回传的 url 作为兜底。
  const urls: Partial<Record<ProviderName, string>> = {};
  const tabIds: Partial<Record<ProviderName, number>> = {};
  const task = getTask(taskId);
  for (const p of providers) {
    const st = task?.providers?.[p];
    if (st?.tabId !== undefined) tabIds[p] = st.tabId;
    let liveUrl: string | undefined;
    if (st?.tabId !== undefined) {
      try {
        liveUrl = (await chrome.tabs.get(st.tabId)).url;
      } catch {
        /* 标签页可能已被用户关闭，忽略 */
      }
    }
    const finalUrl = liveUrl || st?.url;
    if (finalUrl) urls[p] = finalUrl;
  }

  const ok = providers.every((p) => outputs[p] !== undefined && errors[p] === undefined);
  console.log('[Workbench:engine] 结束', {
    ok,
    answered: Object.keys(outputs),
    failed: Object.keys(errors),
    urls: Object.keys(urls),
  });

  // 工作台任务用完即弃：从 stateStore 删除，避免 tasks Map / lastTask 无限膨胀
  // （工作台有自己的运行历史与节点结果存储，不需要留 background 运行时态）。
  // 先 markTaskDeleted 进入宽限期，使 deadline 后迟到的 TASK_DONE 有日志而非静默丢弃（#20）。
  markTaskDeleted(taskId);
  deleteTask(taskId);

  return { ok, outputs, errors, taskId, urls, tabIds };
}
