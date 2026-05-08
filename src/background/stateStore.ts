import type { AskTaskState, ProviderName, ProviderStatus, ProviderTaskState } from '../shared/types';
import { ALL_PROVIDERS } from '../shared/constants';

const tasks = new Map<string, AskTaskState>();

function createInitialProviderState(provider: ProviderName): ProviderTaskState {
  return {
    provider,
    status: 'idle',
    content: '',
    updatedAt: Date.now(),
  };
}

function createInitialProviders(): Record<ProviderName, ProviderTaskState> {
  const providers = {} as Record<ProviderName, ProviderTaskState>;
  for (const p of ALL_PROVIDERS) {
    providers[p] = createInitialProviderState(p);
  }
  return providers;
}

export function createTask(taskId: string, prompt: string, targets: ProviderName[]): AskTaskState {
  const providers = createInitialProviders();
  for (const p of targets) {
    providers[p].status = 'waiting';
    providers[p].updatedAt = Date.now();
  }
  const task: AskTaskState = { taskId, prompt, createdAt: Date.now(), providers };
  tasks.set(taskId, task);
  persistTask(task);
  return task;
}

export function getTask(taskId: string): AskTaskState | undefined {
  return tasks.get(taskId);
}

export function updateProviderStatus(
  taskId: string,
  provider: ProviderName,
  status: ProviderStatus,
  detail?: string
): AskTaskState | undefined {
  const task = tasks.get(taskId);
  if (!task) return;
  const updated = { ...task };
  updated.providers = { ...updated.providers };
  updated.providers[provider] = {
    ...updated.providers[provider],
    status,
    error: status === 'error' ? (detail ?? updated.providers[provider].error) : undefined,
    updatedAt: Date.now(),
  };
  tasks.set(taskId, updated);
  persistTask(updated);
  return updated;
}

export function updateProviderContent(
  taskId: string,
  provider: ProviderName,
  content: string
): AskTaskState | undefined {
  const task = tasks.get(taskId);
  if (!task) return;
  const updated = { ...task };
  updated.providers = { ...updated.providers };
  updated.providers[provider] = {
    ...updated.providers[provider],
    content,
    updatedAt: Date.now(),
  };
  tasks.set(taskId, updated);
  return updated;
}

export function finishProviderTask(
  taskId: string,
  provider: ProviderName,
  finalContent: string
): AskTaskState | undefined {
  const task = tasks.get(taskId);
  if (!task) return;
  const updated = { ...task };
  updated.providers = { ...updated.providers };
  updated.providers[provider] = {
    ...updated.providers[provider],
    status: 'done',
    content: finalContent,
    updatedAt: Date.now(),
  };
  tasks.set(taskId, updated);
  persistTask(updated);
  return updated;
}

export function failProviderTask(
  taskId: string,
  provider: ProviderName,
  error: string
): AskTaskState | undefined {
  const task = tasks.get(taskId);
  if (!task) return;
  const updated = { ...task };
  updated.providers = { ...updated.providers };
  updated.providers[provider] = {
    ...updated.providers[provider],
    status: 'error',
    error,
    updatedAt: Date.now(),
  };
  tasks.set(taskId, updated);
  persistTask(updated);
  return updated;
}

export function setProviderTabId(
  taskId: string,
  provider: ProviderName,
  tabId: number
): AskTaskState | undefined {
  const task = tasks.get(taskId);
  if (!task) return;
  const updated = { ...task };
  updated.providers = { ...updated.providers };
  updated.providers[provider] = {
    ...updated.providers[provider],
    tabId,
    updatedAt: Date.now(),
  };
  tasks.set(taskId, updated);
  return updated;
}

function persistTask(task: AskTaskState): void {
  chrome.storage.local.set({ lastTask: task }).catch(console.error);
}

export async function loadLastTask(): Promise<AskTaskState | undefined> {
  const result = await chrome.storage.local.get('lastTask');
  const task = result.lastTask as AskTaskState | undefined;
  if (task) {
    tasks.set(task.taskId, task);
  }
  return task;
}
