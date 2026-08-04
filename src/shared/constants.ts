import type { ProviderName, AppSettings } from './types';

export const PROVIDER_URLS: Record<ProviderName, string> = {
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/',
  deepseek: 'https://chat.deepseek.com/',
  qwen: 'https://chat.qwen.ai/',
  zai: 'https://chat.z.ai/',
  doubao: 'https://www.doubao.com/chat/',
  kimi: 'https://kimi.moonshot.cn/',
};

export const PROVIDER_LABELS: Record<ProviderName, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  zai: 'Z.AI',
  doubao: 'Doubao',
  kimi: 'Kimi',
};

export const ALL_PROVIDERS: ProviderName[] = ['chatgpt', 'gemini', 'deepseek', 'qwen', 'zai', 'doubao', 'kimi'];

export const STREAM_THROTTLE_MS = 300;
export const DONE_STABLE_MS = 250;
export const TAB_SETTLE_MS = 3000;
export const ELEMENT_TIMEOUT_MS = 15000;
export const PING_RETRY_MAX = 5;
export const PING_RETRY_DELAY_MS = 1000;

export const SETTINGS_KEY = 'app_settings';

export const DEFAULT_SETTINGS: AppSettings = {
  elementTimeoutMs: 15000,
  responseTimeoutMs: {
    chatgpt: 120000,
    gemini: 120000,
    deepseek: 45000,
    qwen: 45000,
    zai: 45000,
    doubao: 45000,
    kimi: 60000,
  },
};

export const ERROR_CODES = {
  ELEMENT_NOT_FOUND: 'ELEMENT_NOT_FOUND',
  LOGIN_REQUIRED: 'LOGIN_REQUIRED',
  SUBMIT_FAILED: 'SUBMIT_FAILED',
  STREAM_FAILED: 'STREAM_FAILED',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
} as const;

// ── 嵌入视图（把 AI 网页放进插件 iframe） ──────────────
// 这些域名在 sub_frame 请求时会被 DNR 规则剥离 X-Frame-Options /
// Content-Security-Policy，从而允许被插件页 iframe 嵌套。
export const EMBED_HOSTS: string[] = [
  'chatgpt.com',
  'gemini.google.com',
  'chat.deepseek.com',
  'deepseek.com',
  'chat.qwen.ai',
  'chat.z.ai',
  'www.doubao.com',
  'kimi.moonshot.cn',
  'kimi.com',
];

// 父页面（插件）↔ iframe 内 content script 的跨域通信协议
export const EMBED_MSG = {
  EXECUTE: 'multi_ai_execute',
  PING: 'multi_ai_ping',
  PONG: 'multi_ai_pong',
  // content script 加载后主动向父页面广播（避免 PING 早于脚本注入的竞态）
  READY: 'multi_ai_ready',
  // 嵌入视图的手动抓取：父页面请求 → iframe 内就地读屏 → 回传结果
  GRAB: 'multi_ai_grab',
  GRAB_RESULT: 'multi_ai_grab_result',
} as const;
