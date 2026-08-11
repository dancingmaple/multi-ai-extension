import { CUSTOM_SELECTORS_KEY } from './constants';
import type { CustomSelectorMap, ProviderCustomSelectors, ProviderName } from './types';

/**
 * 手动修复的元素选择器永久存储。
 * 当用户在测试台手动点选输入框 / 发送按钮 / 回答区域后，
 * 选择器写入 chrome.storage.local，后续执行时优先使用。
 */

// 内存缓存：content script 流式期间反复读取手动修复的选择器，
// 缓存 + storage.onChanged 失效避免每次都全量读盘（#28）。
let cachePromise: Promise<CustomSelectorMap> | undefined;

export async function loadCustomSelectors(): Promise<CustomSelectorMap> {
  if (cachePromise) return cachePromise;
  cachePromise = (async () => {
    try {
      const r = await chrome.storage.local.get(CUSTOM_SELECTORS_KEY);
      const m = r[CUSTOM_SELECTORS_KEY];
      if (m && typeof m === 'object') return m as CustomSelectorMap;
    } catch {
      /* storage 不可用时返回空 */
    }
    return {};
  })();
  return cachePromise;
}

export async function saveCustomSelectors(map: CustomSelectorMap): Promise<void> {
  cachePromise = undefined; // 写入后失效缓存
  try {
    await chrome.storage.local.set({ [CUSTOM_SELECTORS_KEY]: map });
  } catch {
    /* ignore */
  }
}

// 外部改了自定义选择器 → 让本上下文缓存失效（#28）
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[CUSTOM_SELECTORS_KEY]) cachePromise = undefined;
  });
}

export async function getCustomForProvider(provider: ProviderName): Promise<ProviderCustomSelectors | null> {
  const map = await loadCustomSelectors();
  return map[provider] ?? null;
}

/** 合并写入某 provider 的单个角色选择器，返回更新后的完整 map */
export async function upsertCustomSelector(
  provider: ProviderName,
  role: 'input' | 'submit' | 'response',
  selector: string
): Promise<CustomSelectorMap> {
  const map = await loadCustomSelectors();
  const cur = map[provider] ?? {};
  cur[role] = selector;
  map[provider] = cur;
  await saveCustomSelectors(map);
  return map;
}

/** 清除某 provider 的单个角色选择器（或全部） */
export async function clearCustomSelector(
  provider: ProviderName,
  role?: 'input' | 'submit' | 'response'
): Promise<CustomSelectorMap> {
  const map = await loadCustomSelectors();
  if (!map[provider]) return map;
  if (role) {
    delete map[provider]![role];
    if (Object.keys(map[provider]!).length === 0) delete map[provider];
  } else {
    delete map[provider];
  }
  await saveCustomSelectors(map);
  return map;
}
