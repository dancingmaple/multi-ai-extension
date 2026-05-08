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
  }
}
