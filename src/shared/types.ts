export type ProviderName = 'chatgpt' | 'gemini' | 'deepseek';

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

export type UIMessage = AskAllMessage | GetTaskStateMessage | RetryProviderMessage;

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

// ── Background → UI (state broadcast) ──────────────────

export type TaskStateUpdateMessage = {
  type: 'TASK_STATE_UPDATE';
  task: AskTaskState;
};

export type BackgroundToUIMessage = TaskStateUpdateMessage;
