import { PROMPT_TEMPLATES_KEY } from './constants';
import type { PromptTemplate } from './types';
import { withStorageLock } from './concurrency';

/**
 * 提示词模板的永久存储（侧边栏 / 测试台 / 工作台三处共用）。
 *
 * 场景：把常用提问存成模板 → 任意界面的输入框旁点「模板」→
 * 搜索 / 点击即一键填充；当前输入内容也可随时存为新模板。
 *
 * 存储结构：chrome.storage.local[PROMPT_TEMPLATES_KEY] = PromptTemplate[]
 * （新模板插到最前，列表按 updatedAt 倒序展示）
 */

// 内存缓存：三处界面频繁读取，缓存 + storage.onChanged 失效避免重复读盘（同 #28 模式）
let cachePromise: Promise<PromptTemplate[]> | undefined;

function sanitize(raw: unknown): PromptTemplate[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is PromptTemplate =>
      !!t &&
      typeof t === 'object' &&
      typeof (t as PromptTemplate).id === 'string' &&
      typeof (t as PromptTemplate).name === 'string' &&
      typeof (t as PromptTemplate).content === 'string'
  );
}

export async function loadPromptTemplates(): Promise<PromptTemplate[]> {
  if (cachePromise) return cachePromise;
  cachePromise = (async () => {
    try {
      const r = await chrome.storage.local.get(PROMPT_TEMPLATES_KEY);
      return sanitize(r[PROMPT_TEMPLATES_KEY]);
    } catch {
      /* storage 不可用时返回空 */
      return [];
    }
  })();
  return cachePromise;
}

async function savePromptTemplates(list: PromptTemplate[]): Promise<void> {
  cachePromise = undefined; // 写入后失效缓存，下次读取重新加载
  try {
    await chrome.storage.local.set({ [PROMPT_TEMPLATES_KEY]: list });
  } catch {
    /* ignore */
  }
}

// 其它界面（如测试台）增删模板 → 本上下文缓存失效，下次读取拉最新值
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[PROMPT_TEMPLATES_KEY]) cachePromise = undefined;
  });
}

function newTemplateId(): string {
  return 'pt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 新增一个模板（读-改-写加锁，避免并发覆盖，同 #8 模式）。name/content 为空时返回 null */
export async function addPromptTemplate(name: string, content: string): Promise<PromptTemplate | null> {
  const n = name.trim();
  if (!n || !content.trim()) return null;
  return withStorageLock(PROMPT_TEMPLATES_KEY, async () => {
    const r = await chrome.storage.local.get(PROMPT_TEMPLATES_KEY);
    const list = sanitize(r[PROMPT_TEMPLATES_KEY]);
    const now = Date.now();
    const t: PromptTemplate = { id: newTemplateId(), name: n, content, createdAt: now, updatedAt: now };
    await savePromptTemplates([t, ...list]);
    return t;
  });
}

/** 删除一个模板 */
export async function deletePromptTemplate(id: string): Promise<void> {
  await withStorageLock(PROMPT_TEMPLATES_KEY, async () => {
    const r = await chrome.storage.local.get(PROMPT_TEMPLATES_KEY);
    const list = sanitize(r[PROMPT_TEMPLATES_KEY]);
    await savePromptTemplates(list.filter((t) => t.id !== id));
  });
}
