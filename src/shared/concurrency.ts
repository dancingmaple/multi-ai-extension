/**
 * 存储写锁：让「读-改-写」型 storage 操作串行化，避免并发覆盖（#8）。
 *
 * 背景：扩展多个页面（侧边栏 / 测试台 / 工作台 / content script）各自持有模块实例，
 * 同时写同一 storage key（自定义 provider / 自定义选择器 / 历史 / 流式快照）时，
 * read-modify-write 会交错：A 读旧值→B 读旧值→A 写→B 写，B 覆盖了 A 的结果。
 *
 * 方案：优先用 navigator.locks（MV3 支持，跨扩展页面共享同一 origin，可真正互斥）；
 * 不支持的环境（早期 Chrome / 非标准上下文）回退为同进程单飞，至少避免同页面内并发覆盖。
 */

const LOCK_PREFIX = 'multiAI:lock:';
const flights = new Map<string, Promise<unknown>>();

/** 同进程单飞：同一 key 的并发调用复用进行中的那一次 */
async function singleFlight<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const existing = flights.get(name);
  if (existing) return existing as Promise<T>;
  const p = Promise.resolve()
    .then(fn)
    .finally(() => {
      flights.delete(name);
    });
  flights.set(name, p);
  return p as Promise<T>;
}

/**
 * 在命名锁内执行 read-modify-write。
 * @param key storage key（用作锁名，保证同 key 串行）
 * @param fn  临界区；持有锁期间执行，结束后锁自动释放
 */
export async function withStorageLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const name = LOCK_PREFIX + key;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks?.request) {
    return locks.request(name, fn);
  }
  return singleFlight(name, fn);
}
