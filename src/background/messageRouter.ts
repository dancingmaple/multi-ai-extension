import type { UIMessage, AskTaskState, ProviderName, ProviderStatus, HistoryEntry } from '../shared/types';
import { broadcastTaskState } from '../shared/messaging';
import { createTask, getTask, updateProviderStatus, updateProviderContent, finishProviderTask, failProviderTask, setProviderTabId, loadLastTask } from './stateStore';
import { getOrCreateProviderTab } from './tabManager';

const HISTORY_KEY = 'conversation_history';
const MAX_HISTORY = 200;

async function saveToHistory(task: AskTaskState): Promise<void> {
  const entry: HistoryEntry = {
    id: task.taskId,
    prompt: task.prompt,
    createdAt: task.createdAt,
    providers: {} as HistoryEntry['providers'],
  };
  for (const [p, ps] of Object.entries(task.providers)) {
    entry.providers[p as ProviderName] = {
      status: ps.status,
      content: ps.content,
      tabId: ps.tabId,
    };
  }

  const result = await chrome.storage.local.get(HISTORY_KEY);
  const history: HistoryEntry[] = result[HISTORY_KEY] || [];
  // Remove duplicate if exists, then prepend
  const filtered = history.filter((h) => h.id !== entry.id);
  filtered.unshift(entry);
  // Trim to max
  const trimmed = filtered.slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ [HISTORY_KEY]: trimmed });
}

function providersAllDone(task: AskTaskState): boolean {
  return Object.values(task.providers).every(
    (p) => p.status === 'done' || p.status === 'error' || p.status === 'login_required'
  );
}

let ready = false;
const pendingMessages: Array<{ msg: Record<string, unknown>; sender: chrome.runtime.MessageSender; sendResponse: (r?: unknown) => void }> = [];

console.log('[MultiAI:background] Service worker starting...');

// ── Register listeners SYNCHRONOUSLY at top level ──────
// This is REQUIRED for MV3. If registered inside an async function,
// Chrome won't recognize the listener and sendMessage will fail.

chrome.runtime.onMessage.addListener((rawMsg, sender, sendResponse) => {
  const msg = rawMsg as Record<string, unknown>;
  // Route UI messages (from side panel / popup)
  if (msg.type === 'ASK_ALL' || msg.type === 'GET_TASK_STATE' || msg.type === 'RETRY_PROVIDER' || msg.type === 'SWITCH_MODE') {
    if (!ready) {
      console.log('[MultiAI:background] Queuing message, not ready yet:', msg.type);
      pendingMessages.push({ msg: msg as Record<string, unknown>, sender, sendResponse });
      return true; // keep channel open
    }
    handleUIMessage(msg as UIMessage, sender).then(() => sendResponse());
    return true; // async response
  }

  // Route content script messages
  if (
    rawMsg.type === 'PROVIDER_STATUS' ||
    rawMsg.type === 'STREAM_UPDATE' ||
    rawMsg.type === 'TASK_DONE' ||
    rawMsg.type === 'TASK_ERROR'
  ) {
    if (!ready) {
      pendingMessages.push({ msg: rawMsg as Record<string, unknown>, sender, sendResponse });
      return true;
    }
    handleContentMessage(rawMsg as Record<string, unknown>);
    sendResponse();
    return false;
  }

  return false;
});

// ── Action click handler ────────────────────────────────
// Default: open as fullscreen tab. Can switch to side panel via toggle.

chrome.action.onClicked.addListener(() => {
  openFullscreen();
});

// ── Async initialization ───────────────────────────────

async function doInit(): Promise<void> {
  console.log('[MultiAI:background] Initializing...');

  await loadLastTask();

  ready = true;
  console.log('[MultiAI:background] Ready, processing', pendingMessages.length, 'pending messages');

  // Process any queued messages
  for (const { msg, sender, sendResponse } of pendingMessages) {
    if (msg.type === 'ASK_ALL' || msg.type === 'GET_TASK_STATE' || msg.type === 'RETRY_PROVIDER' || msg.type === 'SWITCH_MODE') {
      await handleUIMessage(msg as UIMessage, sender);
    } else {
      handleContentMessage(msg as Record<string, unknown>);
    }
    sendResponse();
  }
  pendingMessages.length = 0;
}

doInit().catch(console.error);

// ── Mode switching ──────────────────────────────────────

let fullscreenTabId: number | undefined;

async function openFullscreen(): Promise<void> {
  const url = chrome.runtime.getURL('public/sidepanel.html') + '?mode=fullscreen';
  // Reuse existing tab if still open
  if (fullscreenTabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(fullscreenTabId);
      if (tab) {
        await chrome.tabs.update(fullscreenTabId, { active: true });
        if (tab.windowId !== undefined) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
        return;
      }
    } catch {
      fullscreenTabId = undefined;
    }
  }
  const tab = await chrome.tabs.create({ url, active: true });
  if (tab.id) fullscreenTabId = tab.id;
}

async function openSidePanel(): Promise<void> {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  // Close fullscreen tab
  if (fullscreenTabId !== undefined) {
    await chrome.tabs.remove(fullscreenTabId).catch(() => {});
    fullscreenTabId = undefined;
  }
  // Open side panel
  chrome.sidePanel.open({ windowId: -1 } as any).catch(() => {});
}

// ── Handlers ────────────────────────────────────────────

async function handleUIMessage(
  msg: UIMessage,
  _sender: chrome.runtime.MessageSender
): Promise<void> {
  console.log('[MultiAI:background] handleUIMessage', msg.type);
  switch (msg.type) {
    case 'ASK_ALL': {
      console.log('[MultiAI:background] ASK_ALL taskId=', msg.taskId, 'targets=', msg.targets);
      await handleAskAll(msg.taskId, msg.prompt, msg.targets);
      break;
    }
    case 'GET_TASK_STATE': {
      const task = getTask(msg.taskId);
      if (task) {
        broadcastTaskState({ type: 'TASK_STATE_UPDATE', task });
      }
      break;
    }
    case 'RETRY_PROVIDER': {
      const task = getTask(msg.taskId);
      if (task) {
        updateProviderStatus(msg.taskId, msg.provider, 'waiting');
        broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: getTask(msg.taskId)! });
        await dispatchToProvider(msg.taskId, msg.provider, task.prompt);
      }
      break;
    }
    case 'SWITCH_MODE': {
      if (msg.target === 'fullscreen') {
        await openFullscreen();
      } else {
        await openSidePanel();
      }
      break;
    }
  }
}

function handleContentMessage(
  msg: Record<string, unknown>
): void {
  const taskId = msg.taskId as string;
  const provider = msg.provider as ProviderName;
  console.log('[MultiAI:background] handleContentMessage', msg.type, 'taskId=', taskId, 'provider=', provider);

  let updatedTask: AskTaskState | undefined;

  switch (msg.type) {
    case 'PROVIDER_STATUS':
      updatedTask = updateProviderStatus(taskId, provider, msg.status as ProviderStatus, msg.detail as string | undefined);
      break;
    case 'STREAM_UPDATE':
      updatedTask = updateProviderContent(taskId, provider, msg.content as string);
      break;
    case 'TASK_DONE':
      updatedTask = finishProviderTask(taskId, provider, msg.finalContent as string);
      break;
    case 'TASK_ERROR':
      updatedTask = failProviderTask(taskId, provider, msg.errorMessage as string);
      break;
  }

  if (updatedTask) {
    broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: updatedTask });
    // Save to history when all providers have finished
    if (providersAllDone(updatedTask)) {
      saveToHistory(updatedTask).catch(console.error);
    }
  }
}

async function handleAskAll(
  taskId: string,
  prompt: string,
  targets: ProviderName[]
): Promise<void> {
  let task = getTask(taskId);
  if (!task) {
    task = createTask(taskId, prompt, targets);
  }

  broadcastTaskState({ type: 'TASK_STATE_UPDATE', task });

  const dispatches = targets.map((provider) => dispatchToProvider(taskId, provider, prompt));
  await Promise.allSettled(dispatches);
}

async function dispatchToProvider(
  taskId: string,
  provider: ProviderName,
  prompt: string
): Promise<void> {
  console.log('[MultiAI:background] dispatchToProvider', provider);
  try {
    updateProviderStatus(taskId, provider, 'waiting');
    broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: getTask(taskId)! });

    // Always use hidden tabs for reliable automation
    const tabId = await getOrCreateProviderTab(provider);
    console.log('[MultiAI:background] Got tab', tabId, 'for', provider);
    setProviderTabId(taskId, provider, tabId);

    updateProviderStatus(taskId, provider, 'sending');
    broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: getTask(taskId)! });

    console.log('[MultiAI:background] Sending EXECUTE_PROMPT to tab', tabId);
    await chrome.tabs.sendMessage(tabId, {
      type: 'EXECUTE_PROMPT',
      taskId,
      provider,
      prompt,
    });

    console.log('[MultiAI:background] EXECUTE_PROMPT sent to', provider);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[MultiAI:background] dispatchToProvider failed for', provider, ':', message);
    failProviderTask(taskId, provider, message);
    broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: getTask(taskId)! });
  }
}
