import { CUSTOM_PROVIDERS_KEY, CUSTOM_PROVIDER_PREFIX, PROVIDER_LABELS, PROVIDER_URLS, ALL_PROVIDERS } from './constants';
import type { CustomProvider, CustomProviderMap, ProviderName } from './types';

/**
 * 用户自定义 AI 网页的永久存储。
 *
 * 场景：测试台里输入任意 AI 网页地址 → 手动点选输入框 / 发送按钮 / 回答区域
 * → 验证可用后「保存为节点」，之后工作台、侧边栏等处都能像内置 7 家一样直接选用。
 *
 * 存储结构：{ 'custom:1754800000000': CustomProvider, ... }
 */

// 内存缓存：content script 解析 provider / useEffectiveProviders 频繁读盘，
// 缓存 + storage.onChanged 失效避免每次状态变更都全量读盘（#28）。
let cachePromise: Promise<CustomProviderMap> | undefined;

export async function loadCustomProviders(): Promise<CustomProviderMap> {
  if (cachePromise) return cachePromise;
  cachePromise = (async () => {
    try {
      const r = await chrome.storage.local.get(CUSTOM_PROVIDERS_KEY);
      const m = r[CUSTOM_PROVIDERS_KEY];
      if (m && typeof m === 'object') return m as CustomProviderMap;
    } catch {
      /* storage 不可用时返回空 */
    }
    return {};
  })();
  return cachePromise;
}

export async function saveCustomProviders(map: CustomProviderMap): Promise<void> {
  cachePromise = undefined; // 写入后失效缓存，下次读取重新加载最新值
  try {
    await chrome.storage.local.set({ [CUSTOM_PROVIDERS_KEY]: map });
  } catch {
    /* ignore */
  }
}

// 外部（如测试台）改了自定义节点 → 让本上下文缓存失效（#28）
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[CUSTOM_PROVIDERS_KEY]) cachePromise = undefined;
  });
}

export async function getCustomProvider(id: ProviderName): Promise<CustomProvider | null> {
  if (!id) return null;
  const map = await loadCustomProviders();
  return map[id] ?? null;
}

export function newCustomProviderId(): ProviderName {
  return CUSTOM_PROVIDER_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 新增 / 覆盖一个自定义 AI 节点 */
export async function upsertCustomProvider(
  input: Omit<CustomProvider, 'createdAt' | 'updatedAt'> & Partial<Pick<CustomProvider, 'createdAt'>>
): Promise<CustomProviderMap> {
  const map = await loadCustomProviders();
  const now = Date.now();
  const prev = map[input.id];
  map[input.id] = {
    ...input,
    createdAt: prev?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  };
  await saveCustomProviders(map);
  return map;
}

export async function deleteCustomProvider(id: ProviderName): Promise<CustomProviderMap> {
  const map = await loadCustomProviders();
  delete map[id];
  await saveCustomProviders(map);
  return map;
}

/** 内置 7 家 + 自定义节点，供各页面的平台选择器统一使用 */
export async function getEffectiveProviders(): Promise<
  { id: ProviderName; label: string; url: string; custom: boolean }[]
> {
  const builtin = ALL_PROVIDERS.map((p) => ({
    id: p,
    label: PROVIDER_LABELS[p] ?? p,
    url: PROVIDER_URLS[p] ?? '',
    custom: false,
  }));
  const map = await loadCustomProviders();
  const customs = Object.values(map)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((c) => ({ id: c.id, label: c.label, url: c.url, custom: true }));
  return [...builtin, ...customs];
}

/** 自定义节点的 label（找不到时回退 id） */
export async function getProviderLabelAsync(p: ProviderName): Promise<string> {
  if (PROVIDER_LABELS[p]) return PROVIDER_LABELS[p];
  const c = await getCustomProvider(p);
  return c?.label ?? p;
}
