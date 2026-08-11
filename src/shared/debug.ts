/**
 * 统一调试日志开关（#59）。
 *
 * 现状问题：各适配器写死 `DEBUG: true`，流式期间每个 tick 都打一行，
 * 生产环境下既刷屏又拖慢（console 序列化对象本身有成本）。
 *
 * 策略：
 * - 开发构建默认输出；
 * - 生产构建默认静默，且 `import.meta.env.DEV` 会被静态替换为 false，
 *   打包时相关分支可被摇树消除；
 * - 线上排查时无需重新打包：在页面控制台执行
 *   `localStorage.setItem('multiAI.debug','1')` 后刷新即可打开。
 *   （Service Worker 无 localStorage，读取失败按关闭处理。）
 */
const FORCE_KEY = 'multiAI.debug';

function readForceFlag(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(FORCE_KEY) === '1';
  } catch {
    return false;
  }
}

export const DEBUG_ENABLED: boolean = import.meta.env.DEV || readForceFlag();

/** 生成带前缀的日志函数；关闭时是空操作，调用点无需再写 if */
export function createLogger(tag: string): (...args: unknown[]) => void {
  if (!DEBUG_ENABLED) return () => {};
  return (...args: unknown[]) => console.log(tag, ...args);
}
