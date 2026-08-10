import type { ProviderName } from './types';
import { PROVIDER_URLS } from './constants';
import { getCustomProvider, loadCustomProviders } from './customProviders';

export function getProviderUrl(provider: ProviderName): string {
  return PROVIDER_URLS[provider] ?? '';
}

/** 含自定义节点的地址解析（自定义 provider 的 url 存在 storage 里） */
export async function getProviderUrlAsync(provider: ProviderName): Promise<string> {
  const builtin = PROVIDER_URLS[provider];
  if (builtin) return builtin;
  const c = await getCustomProvider(provider);
  return c?.url ?? '';
}

export function getProviderFromUrl(url: string): ProviderName | null {
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  if (hostname.includes('chatgpt.com')) return 'chatgpt';
  if (hostname.includes('gemini.google.com')) return 'gemini';
  if (hostname.includes('deepseek.com')) return 'deepseek';
  if (hostname.includes('qwen.ai')) return 'qwen';
  if (hostname.includes('z.ai')) return 'zai';
  if (hostname.includes('doubao.com')) return 'doubao';
  if (hostname.includes('moonshot.cn') || hostname.includes('kimi.com')) return 'kimi';
  return null;
}

/**
 * 异步解析：先按内置域名匹配，未命中再查用户自定义 AI 网页。
 * content script 用它来确定「我现在跑在哪个 provider 的页面上」，
 * 否则自定义网页永远解析为 null，postMessage 通路不会被激活。
 */
export async function resolveProviderFromUrl(url: string): Promise<ProviderName | null> {
  const builtin = getProviderFromUrl(url);
  if (builtin) return builtin;

  let hostname = '';
  let href = url;
  try {
    const u = new URL(url);
    hostname = u.hostname;
    href = u.href;
  } catch {
    return null;
  }

  const map = await loadCustomProviders();
  let best: { id: ProviderName; score: number } | null = null;
  for (const c of Object.values(map)) {
    let ch = '';
    try {
      ch = new URL(c.url).hostname;
    } catch {
      continue;
    }
    if (!ch || ch !== hostname) continue;
    // 同域名下多个自定义节点时，路径前缀更长者优先
    let score = 1;
    try {
      const cPath = new URL(c.url).pathname.replace(/\/$/, '');
      if (cPath && href.includes(cPath)) score += cPath.length;
    } catch {
      /* noop */
    }
    if (!best || score > best.score) best = { id: c.id, score };
  }
  return best?.id ?? null;
}

export function getProviderMatchPattern(provider: ProviderName): string {
  switch (provider) {
    case 'chatgpt':
      return 'https://chatgpt.com/*';
    case 'gemini':
      return 'https://gemini.google.com/*';
    case 'deepseek':
      return 'https://chat.deepseek.com/*';
    case 'qwen':
      return 'https://chat.qwen.ai/*';
    case 'zai':
      return 'https://chat.z.ai/*';
    case 'doubao':
      return 'https://www.doubao.com/*';
    case 'kimi':
      return 'https://kimi.moonshot.cn/*';
    default: {
      // 自定义节点：按其 origin 生成匹配串
      const url = PROVIDER_URLS[provider];
      if (url) {
        try {
          return new URL(url).origin + '/*';
        } catch {
          /* noop */
        }
      }
      return '';
    }
  }
}

/** 自定义节点需要异步取 url 才能算 match pattern */
export async function getProviderMatchPatternAsync(provider: ProviderName): Promise<string> {
  const p = getProviderMatchPattern(provider);
  if (p) return p;
  const url = await getProviderUrlAsync(provider);
  if (!url) return '';
  try {
    return new URL(url).origin + '/*';
  } catch {
    return '';
  }
}
