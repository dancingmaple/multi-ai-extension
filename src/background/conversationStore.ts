import type {
  Conversation,
  Turn,
  Answer,
  ProviderName,
  ProviderThread,
  AskTaskState,
} from '../shared/types';
import { ALL_PROVIDERS } from '../shared/constants';
import { broadcastConversation } from '../shared/messaging';

/**
 * Conversation 存储（§2 / §8）：多轮对话的沉淀态。
 * 内存 Map 为唯一写源；变更后节流落盘到 chrome.storage.local('conversations')，
 * 并通过 broadcastConversation 推给 UI / 外部工作台。
 */

const STORAGE_KEY = 'conversations';
const MAX_CONVERSATIONS = 200;

const conversations = new Map<string, Conversation>();
const taskToConversationId = new Map<string, string>();
let currentConversationId: string | undefined;
let loaded = false;

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 取首句前 max 字作为会话标题 */
export function summarize(prompt: string, max = 24): string {
  const t = prompt.trim().replace(/\s+/g, ' ');
  return t.length > max ? t.slice(0, max) + '…' : t || '新对话';
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const r = await chrome.storage.local.get(STORAGE_KEY);
    const map = (r[STORAGE_KEY] || {}) as Record<string, Conversation>;
    for (const c of Object.values(map)) conversations.set(c.id, c);
  } catch {
    /* storage 不可用时退化为纯内存 */
  }
}

async function persist(): Promise<void> {
  const list = [...conversations.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS);
  const map: Record<string, Conversation> = {};
  for (const c of list) map[c.id] = c;
  await chrome.storage.local.set({ [STORAGE_KEY]: map }).catch(() => {});
}

export function getCurrentConversationId(): string | undefined {
  return currentConversationId;
}
export function setCurrentConversationId(id: string | undefined): void {
  currentConversationId = id;
}

export async function getOrCreateConversation(
  id?: string,
  title?: string
): Promise<Conversation> {
  await ensureLoaded();
  if (id && conversations.has(id)) {
    currentConversationId = id;
    return conversations.get(id)!;
  }
  const conv: Conversation = {
    id: id || genId('conv'),
    title: title || '新对话',
    threads: {},
    turns: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  conversations.set(conv.id, conv);
  currentConversationId = conv.id;
  await persist();
  broadcastConversation({ type: 'CONVERSATION_UPDATE', conversation: conv });
  return conv;
}

export function getConversation(id: string): Conversation | undefined {
  return conversations.get(id);
}

export async function listConversations(): Promise<Conversation[]> {
  await ensureLoaded();
  return [...conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function renameConversation(
  id: string,
  title: string
): Promise<Conversation | undefined> {
  const c = conversations.get(id);
  if (!c) return undefined;
  c.title = title;
  c.updatedAt = Date.now();
  await persist();
  broadcastConversation({ type: 'CONVERSATION_UPDATE', conversation: c });
  return c;
}

export async function deleteConversation(id: string): Promise<void> {
  conversations.delete(id);
  for (const [k, v] of taskToConversationId) if (v === id) taskToConversationId.delete(k);
  if (currentConversationId === id) currentConversationId = undefined;
  await persist();
  broadcastConversation({ type: 'CONVERSATION_UPDATE', conversation: null });
}

export async function appendTurn(
  conversationId: string,
  partial: { id: string; prompt: string; targets: ProviderName[] }
): Promise<Conversation> {
  const c = conversations.get(conversationId) || (await getOrCreateConversation(conversationId));
  const turn: Turn = {
    id: partial.id,
    index: c.turns.length,
    prompt: partial.prompt,
    targets: partial.targets,
    answers: {},
    createdAt: Date.now(),
  };
  c.turns.push(turn);
  c.updatedAt = Date.now();
  if (!c.title || c.title === '新对话') c.title = summarize(partial.prompt);
  taskToConversationId.set(turn.id, conversationId);
  currentConversationId = conversationId;
  await persist();
  broadcastConversation({ type: 'CONVERSATION_UPDATE', conversation: c });
  return c;
}

export function getConversationIdForTask(taskId: string): string | undefined {
  return taskToConversationId.get(taskId);
}

export function upsertAnswer(
  conversationId: string,
  turnId: string,
  provider: ProviderName,
  answer: Answer
): Conversation | undefined {
  const c = conversations.get(conversationId);
  if (!c) return undefined;
  const turn = c.turns.find((t) => t.id === turnId);
  if (!turn) return undefined;
  turn.answers = { ...turn.answers, [provider]: answer };
  c.updatedAt = Date.now();
  void persist();
  broadcastConversation({ type: 'CONVERSATION_UPDATE', conversation: c });
  return c;
}

export function setThread(
  conversationId: string,
  provider: ProviderName,
  thread: ProviderThread
): Conversation | undefined {
  const c = conversations.get(conversationId);
  if (!c) return undefined;
  c.threads = { ...c.threads, [provider]: thread };
  void persist();
  return c;
}

/**
 * 把运行时 Task 沉淀进对应 Turn（§2 双态分离约定）。
 * 在「一轮全部 settle」时由 messageRouter 调用。
 */
export function sedimentTask(taskId: string, task: AskTaskState): Conversation | undefined {
  const convId = taskToConversationId.get(taskId);
  if (!convId) return undefined;
  const c = conversations.get(convId);
  if (!c) return undefined;
  const turn = c.turns.find((t) => t.id === taskId);
  if (!turn) return undefined;

  const answers: Turn['answers'] = { ...turn.answers };
  for (const p of ALL_PROVIDERS) {
    const ps = task.providers[p];
    if (!ps) continue;
    const status: Answer['status'] =
      ps.status === 'error'
        ? 'error'
        : ps.status === 'login_required'
        ? 'login_required'
        : 'done';
    answers[p] = {
      provider: p,
      content: ps.content,
      status,
      source: 'auto',
      method: 'stream',
      error: ps.error,
      finishedAt: ps.updatedAt,
      url: ps.url,
    };
    c.threads = {
      ...c.threads,
      [p]: {
        provider: p,
        tabId: ps.tabId,
        alive: status === 'done',
        lastError: ps.error,
      } as ProviderThread,
    };
  }
  turn.answers = answers;
  c.updatedAt = Date.now();
  void persist();
  broadcastConversation({ type: 'CONVERSATION_UPDATE', conversation: c });
  return c;
}

export async function loadConversations(): Promise<void> {
  await ensureLoaded();
}

// 兼容旧单轮：给定 taskId 自动挂到（或新建）一段会话，使 ASK_ALL 也能沉淀为 1 轮
export async function ensureConversationForTask(taskId: string): Promise<string> {
  if (taskToConversationId.has(taskId)) return taskToConversationId.get(taskId)!;
  const conv = await getOrCreateConversation(undefined, '新对话');
  taskToConversationId.set(taskId, conv.id);
  return conv.id;
}
