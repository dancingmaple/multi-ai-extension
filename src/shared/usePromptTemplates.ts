import { useEffect, useState } from 'react';
import type { PromptTemplate } from './types';
import { PROMPT_TEMPLATES_KEY } from './constants';
import { loadPromptTemplates } from './promptTemplates';

/**
 * 提示词模板列表的 React 订阅 hook：挂载时加载，
 * 任意界面增删模板（storage.onChanged）后自动刷新。
 * 侧边栏 / 测试台 / 工作台共用，保证三处看到的列表始终一致。
 */
export function usePromptTemplates(): { templates: PromptTemplate[]; ready: boolean } {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const list = await loadPromptTemplates().catch(() => [] as PromptTemplate[]);
      if (alive) {
        setTemplates(list);
        setReady(true);
      }
    };
    load();

    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (area === 'local' && changes[PROMPT_TEMPLATES_KEY]) load();
    };
    chrome.storage.onChanged.addListener(onChange);

    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, []);

  return { templates, ready };
}
