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

// ── 沉淀态（多轮对话模型，§2） ──────────────────────────
// 运行时态 AskTaskState 在流式过程中高频写入；一轮全部 settle 后，
// background 把它沉淀成 Turn 写进 Conversation.turns。taskId === turn.id。

export type AnswerStatus = 'done' | 'error' | 'login_required';
export type AnswerSource = 'auto' | 'manual';
export type AnswerMethod = 'scissor' | 'tail-fallback' | 'stream';

/** 沉淀态：某家在某轮的最终回答 */
export interface Answer {
  provider: ProviderName;
  content: string;
  status: AnswerStatus;
  source: AnswerSource; // 自动抓取 or 手动兜底
  method?: AnswerMethod;
  error?: string;
  finishedAt: number;
}

/** 沉淀态：一轮 */
export interface Turn {
  id: string; // 与 Task.taskId 同值
  index: number; // 第几轮，从 0 起
  prompt: string;
  targets: ProviderName[]; // 本轮实际询问的家（可为上轮子集）
  answers: Partial<Record<ProviderName, Answer>>;
  createdAt: number;
}

/** 沉淀态：某家在本对话的线程指针 */
export interface ProviderThread {
  provider: ProviderName;
  tabId?: number; // 续问复用的标签页
  alive: boolean; // 标签页是否仍在、上下文是否连续
  lastError?: string;
}

/** 沉淀态：一段多轮对话（顶层记录，导出单位） */
export interface Conversation {
  id: string;
  title: string; // 默认取首轮问题前 24 字，可改
  threads: Partial<Record<ProviderName, ProviderThread>>;
  turns: Turn[];
  createdAt: number;
  updatedAt: number;
}

export type ExportLayout = 'by-turn' | 'by-provider';
export type ExportSink = 'download' | 'clipboard' | 'both';

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

// ── 多轮 / 会话（§5） ───────────────────────────────
export type NewConversationMessage = {
  type: 'NEW_CONVERSATION';
  title?: string;
  conversationId?: string; // 若提供则用其作为 id（外部/恢复场景）
};

export type AppendTurnMessage = {
  type: 'APPEND_TURN';
  conversationId: string;
  turnId: string;
  prompt: string;
  targets: ProviderName[];
};

export type GetConversationMessage = {
  type: 'GET_CONVERSATION';
  conversationId?: string; // 省略则取当前会话
};

export type ListConversationsMessage = {
  type: 'LIST_CONVERSATIONS';
};

export type RenameConversationMessage = {
  type: 'RENAME_CONVERSATION';
  conversationId: string;
  title: string;
};

export type DeleteConversationMessage = {
  type: 'DELETE_CONVERSATION';
  conversationId: string;
};

// ── 手动兜底（§9） ───────────────────────────────────
export type ManualGrabMessage = {
  type: 'MANUAL_GRAB';
  conversationId: string;
  turnId: string;
  provider: ProviderName;
  prompt: string;
};

export type ManualGrabAllMessage = {
  type: 'MANUAL_GRAB_ALL';
  conversationId: string;
  turnId: string;
  prompt: string;
};

// ── 导出（§11） ──────────────────────────────────────
export type ExportMarkdownMessage = {
  type: 'EXPORT_MARKDOWN';
  conversationId: string;
  layout: ExportLayout;
  providers?: ProviderName[]; // 仅导出部分家
  sink: ExportSink;
};

// ── 外部工作台长连接专用 ─────────────────────────────
export type ResumeMessage = {
  type: 'RESUME';
  taskId: string;
};

export type KeepaliveAck = {
  type: 'KA';
};

export type UIMessage =
  | AskAllMessage
  | GetTaskStateMessage
  | RetryProviderMessage
  | SwitchModeMessage
  | NewConversationMessage
  | AppendTurnMessage
  | GetConversationMessage
  | ListConversationsMessage
  | RenameConversationMessage
  | DeleteConversationMessage
  | ManualGrabMessage
  | ManualGrabAllMessage
  | ExportMarkdownMessage
  | ResumeMessage
  | KeepaliveAck;

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
  elementTimeoutMs: number;
  responseTimeoutMs: Record<ProviderName, number>;
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

export type ConversationUpdateMessage = {
  type: 'CONVERSATION_UPDATE';
  conversation: Conversation | null;
};

export type ConversationListMessage = {
  type: 'CONVERSATION_LIST';
  conversations: Conversation[];
};

export type GrabResultMessage = {
  type: 'GRAB_RESULT';
  provider: ProviderName;
  ok: boolean;
  method?: string;
  error?: string;
};

export type ExportResultMessage = {
  type: 'EXPORT_RESULT';
  ok: boolean;
  sink?: ExportSink;
  bytes?: number;
  error?: string;
};

export type BackgroundToUIMessage =
  | TaskStateUpdateMessage
  | HistoryUpdateMessage
  | ConversationUpdateMessage
  | ConversationListMessage
  | GrabResultMessage
  | ExportResultMessage;
