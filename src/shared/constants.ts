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

/**
 * 占位符文本判定（#51）。
 * 各站点流式初期会先渲染「…」「•••」这类骨架，需与真实正文区分。
 * 原先 6 个适配器各写一份、量词与字符集互不相同（星号/加号、重复字符），
 * 统一到这里：字符集 = 句点 / 省略号 / 间隔号 / 项目符号 / 空白。
 * 注意：调用点均已用 `!text ||` 单独处理空串，故这里用 `+` 不匹配空串。
 */
export const PLACEHOLDER_RE = /^[.\u2026\u00b7\u2022\s]+$/;

/**
 * 全文档 MutationObserver 的合并节流间隔（#7）。
 * 流式输出时站点每秒可产生数百条 mutation，逐条触发重量级 tick 会打满 CPU。
 */
export const MUTATION_THROTTLE_MS = 200;

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
// 由 PROVIDER_URLS 派生，新增 provider 只需改一处，避免两边漏配（#52）。
export const EMBED_HOSTS: string[] = Array.from(
  new Set(
    Object.values(PROVIDER_URLS)
      .map((u) => {
        try {
          return new URL(u).hostname;
        } catch {
          return '';
        }
      })
      .filter(Boolean)
  )
);

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
  // 手动选取元素：父页面请求 → iframe 内悬停高亮 → 点击捕获选择器 → 回传
  PICK_START: 'multi_ai_pick_start',
  PICK_STOP: 'multi_ai_pick_stop',
  PICK_RESULT: 'multi_ai_pick_result',
  // 页面诊断：父页面请求 → iframe 内扫描整页元素 → 回传结构化信息（用于排查 UI 变化）
  DIAGNOSE: 'multi_ai_diagnose',
  DIAGNOSE_RESULT: 'multi_ai_diagnose_result',
  // 嵌入视图执行结果回传：iframe 内执行 EXECUTE 后，把状态/流式/完成/错误回传父页面
  EXECUTE_STATUS: 'multi_ai_execute_status',
  EXECUTE_STREAM: 'multi_ai_execute_stream',
  EXECUTE_DONE: 'multi_ai_execute_done',
  EXECUTE_ERROR: 'multi_ai_execute_error',
} as const;

// 自定义元素选择器（手动修复 UI 变化）永久存储键
export const CUSTOM_SELECTORS_KEY = 'multiAI.customSelectors';

// 用户自定义 AI 网页（测试台录入后成为新的 AI 节点）永久存储键
export const CUSTOM_PROVIDERS_KEY = 'multiAI.customProviders';

// 提示词模板（侧边栏/测试台/工作台共用）永久存储键
export const PROMPT_TEMPLATES_KEY = 'multiAI.promptTemplates';

/** 自定义 provider id 前缀 */
export const CUSTOM_PROVIDER_PREFIX = 'custom:';

export function isCustomProvider(p: string): boolean {
  return typeof p === 'string' && p.startsWith(CUSTOM_PROVIDER_PREFIX);
}
