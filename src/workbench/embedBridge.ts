// ============================================================
// workbench/embedBridge.ts
// 内嵌执行桥：工作台节点不再为每个 AI 开新标签页，而是在本页面内的
// 专属 iframe 里执行（与侧边栏网页视图 / 测试台同构）。
//
// 该单例由 React 宿主（EmbeddedRunner）注册各 provider 的 iframe 窗口，
// 并负责：
//  - 维护各 iframe 的就绪状态（content script 注入后通过 PING/PONG 或 READY 广播标记）；
//  - 把父页面下发的 EXECUTE / GRAB 指令 postMessage 给对应 iframe；
//  - 把 iframe 回传的 EXECUTE_STATUS / _STREAM / _DONE / _ERROR（按 taskId 路由）
//    与 GRAB_RESULT（按 reqId 路由）派发给对应的回调。
// ============================================================
import type { ProviderName } from '@shared/types';
import { EMBED_MSG } from '@shared/constants';

export interface ExecHandlers {
  onStatus?: (status: string, detail?: string) => void;
  onStream?: (content: string) => void;
  onDone?: (finalContent: string) => void;
  onError?: (errorCode: string, errorMessage: string) => void;
}

export interface GrabResult {
  text: string;
  method: string;
  reason?: string;
  url?: string;
}

interface FrameEntry {
  win: Window | null;
  ready: boolean;
  origin: string;
}

class EmbedBridge {
  private frames = new Map<ProviderName, FrameEntry>();
  private pending = new Map<string, ExecHandlers>();
  private grabPending = new Map<string, (r: GrabResult) => void>();

  /** React 宿主在 iframe 加载后注册其窗口；win 为 null 表示卸载 */
  registerProvider(p: ProviderName, win: Window | null, origin?: string): void {
    this.frames.set(p, { win, ready: false, origin: origin ?? '' });
  }

  unregisterProvider(p: ProviderName): void {
    this.frames.delete(p);
  }

  private markReady(p: ProviderName): void {
    const f = this.frames.get(p);
    if (f) f.ready = true;
  }

  isReady(p: ProviderName): boolean {
    return this.frames.get(p)?.ready ?? false;
  }

  hasFrame(p: ProviderName): boolean {
    const f = this.frames.get(p);
    return !!f && !!f.win;
  }

  /**
   * 等待某 provider 的 iframe 就绪（content script 已注入）。
   * 期间持续 PING，避免「PING 早于脚本注入」的竞态。超时返回当前就绪态。
   */
  async waitReady(p: ProviderName, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.isReady(p)) return true;
      const f = this.frames.get(p);
      if (f?.win) {
        try {
          f.win.postMessage({ __multiAi: EMBED_MSG.PING, provider: p }, f.origin || '*');
        } catch {
          /* iframe 可能正在卸载 */
        }
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    return this.isReady(p);
  }

  /** 在对应 provider 的 iframe 内执行一次 AI 调用；窗口不存在返回 false */
  run(p: ProviderName, prompt: string, taskId: string, handlers: ExecHandlers): boolean {
    const f = this.frames.get(p);
    if (!f?.win) return false;
    this.pending.set(taskId, handlers);
    try {
      f.win.postMessage({ __multiAi: EMBED_MSG.EXECUTE, provider: p, prompt, taskId }, f.origin || '*');
      return true;
    } catch {
      this.pending.delete(taskId);
      return false;
    }
  }

  /** 在对应 provider 的 iframe 内就地读屏；窗口不存在返回 false */
  grab(p: ProviderName, prompt: string, reqId: string, cb: (r: GrabResult) => void): boolean {
    const f = this.frames.get(p);
    if (!f?.win) return false;
    this.grabPending.set(reqId, cb);
    try {
      f.win.postMessage({ __multiAi: EMBED_MSG.GRAB, provider: p, prompt, reqId }, f.origin || '*');
      return true;
    } catch {
      this.grabPending.delete(reqId);
      return false;
    }
  }

  /** React 宿主在 window 'message' 事件中调用，统一路由回传消息 */
  dispatch(data: Record<string, unknown>): void {
    if (!data || typeof data !== 'object') return;
    const m = data.__multiAi as string | undefined;
    if (!m) return;
    const p = data.provider as ProviderName | undefined;

    switch (m) {
      case EMBED_MSG.PONG:
      case EMBED_MSG.READY:
        if (p) this.markReady(p);
        break;
      case EMBED_MSG.EXECUTE_STATUS: {
        const h = this.findByTask(data.taskId as string | undefined);
        h?.onStatus?.(data.status as string, data.detail as string | undefined);
        break;
      }
      case EMBED_MSG.EXECUTE_STREAM: {
        const h = this.findByTask(data.taskId as string | undefined);
        h?.onStream?.(data.content as string);
        break;
      }
      case EMBED_MSG.EXECUTE_DONE: {
        const tid = data.taskId as string | undefined;
        const h = this.findByTask(tid);
        if (h) {
          h.onDone?.(data.finalContent as string);
          if (tid) this.pending.delete(tid);
        }
        break;
      }
      case EMBED_MSG.EXECUTE_ERROR: {
        const tid = data.taskId as string | undefined;
        const h = this.findByTask(tid);
        if (h) {
          h.onError?.(data.errorCode as string, data.errorMessage as string);
          if (tid) this.pending.delete(tid);
        }
        break;
      }
      case EMBED_MSG.GRAB_RESULT: {
        const reqId = data.reqId as string | undefined;
        if (reqId) {
          const cb = this.grabPending.get(reqId);
          if (cb) {
            cb({
              text: (data.text as string) ?? '',
              method: (data.method as string) ?? 'none',
              reason: data.reason as string | undefined,
              url: data.url as string | undefined,
            });
            this.grabPending.delete(reqId);
          }
        }
        break;
      }
    }
  }

  /** 取消某 taskId 的待处理回调（超时/中止时清理，避免 pending 泄漏） */
  cancel(taskId: string): void {
    this.pending.delete(taskId);
  }

  private findByTask(taskId?: string): ExecHandlers | undefined {
    if (!taskId) return undefined;
    return this.pending.get(taskId);
  }
}

export const embedBridge = new EmbedBridge();
