import type { ProviderName } from './types';
import { PROVIDER_URLS } from './constants';

export function getProviderUrl(provider: ProviderName): string {
  return PROVIDER_URLS[provider];
}

export function getProviderFromUrl(url: string): ProviderName | null {
  const hostname = new URL(url).hostname;
  if (hostname.includes('chatgpt.com')) return 'chatgpt';
  if (hostname.includes('gemini.google.com')) return 'gemini';
  if (hostname.includes('deepseek.com')) return 'deepseek';
  if (hostname.includes('qwen.ai')) return 'qwen';
  if (hostname.includes('z.ai')) return 'zai';
  if (hostname.includes('doubao.com')) return 'doubao';
  return null;
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
  }
}
