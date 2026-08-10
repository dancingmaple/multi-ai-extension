import { useEffect, useState } from 'react';
import type { ProviderName } from './types';
import { ALL_PROVIDERS, PROVIDER_LABELS, PROVIDER_URLS, CUSTOM_PROVIDERS_KEY } from './constants';
import { getEffectiveProviders } from './customProviders';

export interface EffectiveProvider {
  id: ProviderName;
  label: string;
  url: string;
  custom: boolean;
}

const BUILTIN: EffectiveProvider[] = ALL_PROVIDERS.map((p) => ({
  id: p,
  label: PROVIDER_LABELS[p] ?? p,
  url: PROVIDER_URLS[p] ?? '',
  custom: false,
}));

/**
 * 内置 7 家 + 用户自定义 AI 节点的统一列表，供各页面（工作台、侧边栏、全屏）
 * 的平台选择器、iframe 地址解析、状态展示共用。自定义节点增删改后通过
 * chrome.storage.onChanged 自动刷新，无需手动重新拉取。
 *
 * 初始值直接给内置 7 家（避免首帧空列表闪烁）；异步加载后会追加自定义节点。
 */
export function useEffectiveProviders(): EffectiveProvider[] {
  const [list, setList] = useState<EffectiveProvider[]>(BUILTIN);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const l = await getEffectiveProviders().catch(() => BUILTIN);
      if (alive) setList(l);
    };
    load();

    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (area === 'local' && changes[CUSTOM_PROVIDERS_KEY]) load();
    };
    chrome.storage.onChanged.addListener(onChange);

    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, []);

  return list;
}
