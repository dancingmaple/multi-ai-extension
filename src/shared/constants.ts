import type { ProviderName, AppSettings } from './types';

export const PROVIDER_URLS: Record<ProviderName, string> = {
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/',
  deepseek: 'https://chat.deepseek.com/',
  qwen: 'https://chat.qwen.ai/',
  zai: 'https://chat.z.ai/',
  doubao: 'https://www.doubao.com/chat/',
};

export const PROVIDER_LABELS: Record<ProviderName, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  zai: 'Z.AI',
  doubao: 'Doubao',
};

export const ALL_PROVIDERS: ProviderName[] = ['chatgpt', 'gemini', 'deepseek', 'qwen', 'zai', 'doubao'];

export const STREAM_THROTTLE_MS = 300;
export const DONE_STABLE_MS = 250;
export const TAB_SETTLE_MS = 3000;
export const ELEMENT_TIMEOUT_MS = 15000;
export const PING_RETRY_MAX = 5;
export const PING_RETRY_DELAY_MS = 1000;

export const SETTINGS_KEY = 'app_settings';

export const DEFAULT_SETTINGS: AppSettings = {
  responseTimeoutMs: 120000,
  elementTimeoutMs: 15000,
  deepseekResponseTimeoutMs: 45000,
};

export const ERROR_CODES = {
  ELEMENT_NOT_FOUND: 'ELEMENT_NOT_FOUND',
  LOGIN_REQUIRED: 'LOGIN_REQUIRED',
  SUBMIT_FAILED: 'SUBMIT_FAILED',
  STREAM_FAILED: 'STREAM_FAILED',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
} as const;
