export type ProviderName = 'chatgpt' | 'gemini' | 'deepseek' | 'qwen' | 'zai' | 'doubao';

export type ProviderStatus =
  | 'idle'
  | 'waiting'
  | 'sending'
  | 'streaming'
  | 'done'
  | 'error'
  | 'login_required';

export interface ProviderTaskState {
  provider: ProviderName;
  tabId?: number;
  status: ProviderStatus;
  content: string;
  error?: string;
  updatedAt: number;
}

export interface AskTaskState {
  taskId: string;
  prompt: string;
  createdAt: number;
  providers: Record<ProviderName, ProviderTaskState>;
}

// ── Message types ──────────────────────────────────────

export type AskAllMessage = {
  type: 'ASK_ALL';
  taskId: string;
  prompt: string;
  targets: ProviderName[];
};

export type GetTaskStateMessage = {
  type: 'GET_TASK_STATE';
  taskId: string;
};

export type RetryProviderMessage = {
  type: 'RETRY_PROVIDER';
  taskId: string;
  provider: ProviderName;
};

export type SwitchModeMessage = {
  type: 'SWITCH_MODE';
  target: 'fullscreen' | 'sidepanel';
};

export type UIMessage = AskAllMessage | GetTaskStateMessage | RetryProviderMessage | SwitchModeMessage;

// ── Background → Content ───────────────────────────────

export type ExecutePromptMessage = {
  type: 'EXECUTE_PROMPT';
  taskId: string;
  provider: ProviderName;
  prompt: string;
};

export type PingMessage = {
  type: 'PING';
};

export type BackgroundToContentMessage = ExecutePromptMessage | PingMessage;

// ── Content → Background ───────────────────────────────

export type ProviderStatusMessage = {
  type: 'PROVIDER_STATUS';
  taskId: string;
  provider: ProviderName;
  status: ProviderStatus;
  detail?: string;
};

export type StreamUpdateMessage = {
  type: 'STREAM_UPDATE';
  taskId: string;
  provider: ProviderName;
  content: string;
  isPartial: true;
};

export type TaskDoneMessage = {
  type: 'TASK_DONE';
  taskId: string;
  provider: ProviderName;
  finalContent: string;
};

export type TaskErrorMessage = {
  type: 'TASK_ERROR';
  taskId: string;
  provider: ProviderName;
  errorCode: string;
  errorMessage: string;
};

export type ContentToBackgroundMessage =
  | ProviderStatusMessage
  | StreamUpdateMessage
  | TaskDoneMessage
  | TaskErrorMessage;

// ── Settings ───────────────────────────────────────────

export interface AppSettings {
  responseTimeoutMs: number;
  elementTimeoutMs: number;
  deepseekResponseTimeoutMs: number;
}

// ── History ────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  prompt: string;
  createdAt: number;
  providers: Record<ProviderName, {
    status: ProviderStatus;
    content: string;
    tabId?: number;
    url?: string;
  }>;
}

// ── Background → UI (state broadcast) ──────────────────

export type TaskStateUpdateMessage = {
  type: 'TASK_STATE_UPDATE';
  task: AskTaskState;
};

export type HistoryUpdateMessage = {
  type: 'HISTORY_UPDATE';
  entry: HistoryEntry;
};

export type BackgroundToUIMessage = TaskStateUpdateMessage | HistoryUpdateMessage;
