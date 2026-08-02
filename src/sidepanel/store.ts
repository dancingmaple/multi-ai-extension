import { create } from 'zustand';
import type {
  ProviderName,
  AskTaskState,
  HistoryEntry,
  AppSettings,
  Conversation,
  ExportLayout,
  ExportSink,
} from '../shared/types';
import { ALL_PROVIDERS, SETTINGS_KEY, DEFAULT_SETTINGS } from '../shared/constants';
import { sendToBackground, generateTaskId } from '../shared/messaging';

export type PanelMode = 'fullscreen' | 'sidepanel';

const HISTORY_KEY = 'conversation_history';
const MAX_HISTORY = 200;

function detectMode(): PanelMode {
  if (typeof window !== 'undefined' && window.location.search.includes('mode=fullscreen')) {
    return 'fullscreen';
  }
  return 'sidepanel';
}

interface PanelState {
  currentTaskId: string | undefined;
  prompt: string;
  selectedProviders: ProviderName[];
  visibleProviders: ProviderName[];
  activeTab: ProviderName;
  task: AskTaskState | undefined;
  isLoading: boolean;
  panelMode: PanelMode;
  history: HistoryEntry[];
  showHistoryList: boolean;
  historySearch: string;
  settings: AppSettings;
  showSettings: boolean;
  // ── 多轮会话（§2） ──
  conversationId: string | undefined;
  conversation: Conversation | undefined;
  selectedTurnId: string | undefined;
  conversations: Conversation[];
  toast: string | undefined;
  // ── 主题（网页风格切换） ──
  theme: 'light' | 'dark' | 'auto';
  setTheme: (t: 'light' | 'dark' | 'auto') => void;
  // ── 视图模式：对比卡片 / 网页视图（iframe 嵌入） ──
  viewMode: 'compare' | 'web';
  setViewMode: (m: 'compare' | 'web') => void;
  webSendNonce: number;
  // ── 大弹窗阅读器 ──
  reader: { open: boolean; providers: ProviderName[]; index: number; turnId?: string };
  openReader: (providers: ProviderName[], index: number, turnId?: string) => void;
  closeReader: () => void;
  switchReader: (dir: 1 | -1) => void;

  setPrompt: (prompt: string) => void;
  toggleProvider: (provider: ProviderName) => void;
  toggleVisibleProvider: (provider: ProviderName) => void;
  setActiveTab: (provider: ProviderName) => void;
  setTask: (task: AskTaskState) => void;
  sendPrompt: () => Promise<void>;
  retryProvider: (provider: ProviderName) => Promise<void>;
  restoreLastTask: () => Promise<void>;
  switchPanelMode: () => Promise<void>;
  loadHistory: () => Promise<void>;
  deleteHistoryItem: (id: string) => Promise<void>;
  setHistorySearch: (query: string) => void;
  setShowHistoryList: (show: boolean) => void;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  setShowSettings: (show: boolean) => void;
  // ── 多轮动作 ──
  setConversation: (c: Conversation | null) => void;
  setConversations: (list: Conversation[]) => void;
  setToast: (msg?: string) => void;
  newConversation: () => Promise<void>;
  openConversation: (id: string) => Promise<void>;
  openCurrentConversation: () => Promise<void>;
  listConversationsAction: () => Promise<void>;
  renameCurrent: (title: string) => Promise<void>;
  deleteCurrent: (id: string) => Promise<void>;
  selectTurn: (id: string) => void;
  sendTurn: (prompt: string, targets: ProviderName[]) => Promise<void>;
  manualGrabProvider: (provider: ProviderName) => Promise<void>;
  manualGrabAllTurn: () => Promise<void>;
  exportMd: (layout: ExportLayout, sink: ExportSink, providers?: ProviderName[]) => Promise<void>;
  // ── 网页视图发送：不打开标签页，由 WebView 把 prompt 发给 iframe ──
  sendEmbed: (prompt: string, providers: ProviderName[]) => Promise<void>;
}

export const useStore = create<PanelState>((set, get) => ({
  currentTaskId: undefined,
  prompt: '',
  selectedProviders: [...ALL_PROVIDERS],
  visibleProviders: [...ALL_PROVIDERS],
  activeTab: ALL_PROVIDERS[0],
  task: undefined,
  isLoading: false,
  panelMode: detectMode(),
  history: [],
  showHistoryList: false,
  historySearch: '',
  settings: { ...DEFAULT_SETTINGS },
  showSettings: false,
  conversationId: undefined,
  conversation: undefined,
  selectedTurnId: undefined,
  conversations: [],
  toast: undefined,
  theme: 'light',
  reader: { open: false, providers: [], index: 0 },
  viewMode: 'compare',
  webSendNonce: 0,

  setPrompt: (prompt) => set({ prompt }),

  toggleProvider: (provider) =>
    set((state) => {
      const selected = state.selectedProviders.includes(provider)
        ? state.selectedProviders.filter((p) => p !== provider)
        : [...state.selectedProviders, provider];
      return { selectedProviders: selected };
    }),

  toggleVisibleProvider: (provider) =>
    set((state) => {
      const visible = state.visibleProviders.includes(provider)
        ? state.visibleProviders.filter((p) => p !== provider)
        : [...state.visibleProviders, provider];
      return { visibleProviders: visible };
    }),

  setActiveTab: (provider) => set({ activeTab: provider }),

  setTask: (task) => set({ task }),

  sendPrompt: async () => {
    const { prompt, selectedProviders } = get();
    if (!prompt.trim() || selectedProviders.length === 0) return;

    set({ toast: `正在向 ${selectedProviders.length} 家 AI 发起请求…` });
    setTimeout(() => {
      if (get().toast?.startsWith('正在向')) set({ toast: undefined });
    }, 2600);

    const taskId = generateTaskId();
    set({ currentTaskId: taskId, isLoading: true });

    // Safety timeout: force-clear loading after 5 minutes
    const safetyTimer = setTimeout(() => set({ isLoading: false }), 300000);

    try {
      await sendToBackground({
        type: 'ASK_ALL',
        taskId,
        prompt: prompt.trim(),
        targets: selectedProviders,
      });
    } catch {
      set({ isLoading: false });
      clearTimeout(safetyTimer);
    }
  },

  retryProvider: async (provider) => {
    const { currentTaskId } = get();
    if (!currentTaskId) return;

    set({ isLoading: true });
    await sendToBackground({
      type: 'RETRY_PROVIDER',
      taskId: currentTaskId,
      provider,
    });
    set({ isLoading: false });
  },

  restoreLastTask: async () => {
    const result = await chrome.storage.local.get('lastTask');
    const task = result.lastTask as AskTaskState | undefined;
    if (task) {
      set({
        currentTaskId: task.taskId,
        prompt: task.prompt,
        task,
        activeTab: task.prompt ? ALL_PROVIDERS.find((p) => task.providers[p]?.content) ?? ALL_PROVIDERS[0] : ALL_PROVIDERS[0],
      });
    }
  },

  switchPanelMode: async () => {
    const { panelMode } = get();
    const target = panelMode === 'fullscreen' ? 'sidepanel' : 'fullscreen';
    await sendToBackground({ type: 'SWITCH_MODE', target } as any);
    set({ panelMode: target });
    if (panelMode === 'fullscreen') {
      window.close();
    }
  },

  loadHistory: async () => {
    const result = await chrome.storage.local.get(HISTORY_KEY);
    const history = (result[HISTORY_KEY] || []) as HistoryEntry[];
    set({ history });
  },

  deleteHistoryItem: async (id: string) => {
    const { history } = get();
    const updated = history.filter((h) => h.id !== id);
    set({ history: updated });
    await chrome.storage.local.set({ [HISTORY_KEY]: updated.slice(0, MAX_HISTORY) });
  },

  setHistorySearch: (query: string) => set({ historySearch: query }),

  setShowHistoryList: (show: boolean) => set({ showHistoryList: show }),

  loadSettings: async () => {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    const settings = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) } as AppSettings;
    set({ settings });
  },

  saveSettings: async (settings: AppSettings) => {
    set({ settings });
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  },

  setShowSettings: (show: boolean) => set({ showSettings: show }),

  // ── 多轮会话动作 ──
  setConversation: (c) =>
    set({
      conversation: c ?? undefined,
      conversationId: c?.id ?? get().conversationId,
      selectedTurnId: c?.turns.length ? c.turns[c.turns.length - 1].id : get().selectedTurnId,
    }),

  setConversations: (list) => set({ conversations: list }),

  setToast: (msg) => set({ toast: msg }),

  newConversation: async () => {
    const res = (await sendToBackground({ type: 'NEW_CONVERSATION' })) as
      | { type: 'CONVERSATION_UPDATE'; conversation: Conversation }
      | undefined;
    if (res?.conversation) {
      set({ conversation: res.conversation, conversationId: res.conversation.id, selectedTurnId: undefined });
    }
  },

  openConversation: async (id) => {
    const res = (await sendToBackground({ type: 'GET_CONVERSATION', conversationId: id })) as
      | { type: 'CONVERSATION_UPDATE'; conversation: Conversation | null }
      | undefined;
    if (res) {
      set({
        conversation: res.conversation ?? undefined,
        conversationId: id,
        selectedTurnId: res.conversation?.turns.length
          ? res.conversation.turns[res.conversation.turns.length - 1].id
          : undefined,
      });
    }
  },

  openCurrentConversation: async () => {
    const res = (await sendToBackground({ type: 'GET_CONVERSATION' })) as
      | { type: 'CONVERSATION_UPDATE'; conversation: Conversation | null }
      | undefined;
    if (res?.conversation) {
      set({
        conversation: res.conversation,
        conversationId: res.conversation.id,
        selectedTurnId: res.conversation.turns.length
          ? res.conversation.turns[res.conversation.turns.length - 1].id
          : undefined,
      });
    }
  },

  listConversationsAction: async () => {
    const res = (await sendToBackground({ type: 'LIST_CONVERSATIONS' })) as
      | { type: 'CONVERSATION_LIST'; conversations: Conversation[] }
      | undefined;
    if (res) set({ conversations: res.conversations });
  },

  renameCurrent: async (title) => {
    if (!get().conversationId) return;
    await sendToBackground({ type: 'RENAME_CONVERSATION', conversationId: get().conversationId!, title });
  },

  deleteCurrent: async (id) => {
    await sendToBackground({ type: 'DELETE_CONVERSATION', conversationId: id });
    if (get().conversationId === id) {
      set({ conversation: undefined, conversationId: undefined, selectedTurnId: undefined });
    }
    await get().listConversationsAction();
  },

  selectTurn: (id) => set({ selectedTurnId: id }),

  sendTurn: async (prompt, targets) => {
    const text = prompt.trim();
    if (!text || targets.length === 0) return;

    let convId = get().conversationId;
    if (!convId) {
      const res = (await sendToBackground({ type: 'NEW_CONVERSATION' })) as
        | { type: 'CONVERSATION_UPDATE'; conversation: Conversation }
        | undefined;
      convId = res?.conversation?.id;
      if (!convId) return;
    }

    const turnId = generateTaskId();
    set({ currentTaskId: turnId, selectedTurnId: turnId, isLoading: true, conversationId: convId });
    set({ toast: `正在向 ${targets.length} 家 AI 发起请求…` });
    setTimeout(() => {
      if (get().toast?.startsWith('正在向')) set({ toast: undefined });
    }, 2600);

    const safetyTimer = setTimeout(() => set({ isLoading: false }), 300000);
    try {
      await sendToBackground({
        type: 'APPEND_TURN',
        conversationId: convId!,
        turnId,
        prompt: text,
        targets,
      });
    } catch {
      set({ isLoading: false });
      clearTimeout(safetyTimer);
    }
  },

  manualGrabProvider: async (provider) => {
    const { conversationId, selectedTurnId, conversation, prompt } = get();
    if (!conversationId || !selectedTurnId) return;
    const turn = conversation?.turns.find((t) => t.id === selectedTurnId);
    const p = prompt || turn?.prompt || '';
    const res = (await sendToBackground({
      type: 'MANUAL_GRAB',
      conversationId,
      turnId: selectedTurnId,
      provider,
      prompt: p,
    })) as { type: 'GRAB_RESULT'; ok: boolean; method?: string; error?: string } | undefined;
    set({
      toast: res?.ok
        ? `手动抓取成功（${res.method === 'scissor' ? '精确' : '兜底'}）`
        : `手动抓取失败：${res?.error ?? ''}`,
    });
    setTimeout(() => set({ toast: undefined }), 2600);
  },

  manualGrabAllTurn: async () => {
    const { conversationId, selectedTurnId, conversation, prompt } = get();
    if (!conversationId || !selectedTurnId) return;
    const turn = conversation?.turns.find((t) => t.id === selectedTurnId);
    const p = prompt || turn?.prompt || '';
    set({ isLoading: true });
    const res = (await sendToBackground({
      type: 'MANUAL_GRAB_ALL',
      conversationId,
      turnId: selectedTurnId,
      prompt: p,
    })) as { type: 'GRAB_RESULT'; ok: boolean; error?: string } | undefined;
    set({
      isLoading: false,
      toast: res?.ok ? '全部手动抓取完成' : `批量抓取未全部成功：${res?.error ?? ''}`,
    });
    setTimeout(() => set({ toast: undefined }), 2600);
  },

  exportMd: async (layout, sink, providers) => {
    const { conversationId } = get();
    if (!conversationId) return;
    const res = (await sendToBackground({
      type: 'EXPORT_MARKDOWN',
      conversationId,
      layout,
      sink,
      providers,
    })) as { type: 'EXPORT_RESULT'; ok: boolean; error?: string } | undefined;
    set({ toast: res?.ok ? '已导出 Markdown' : `导出失败：${res?.error ?? ''}` });
    setTimeout(() => set({ toast: undefined }), 2600);
  },

  setTheme: (t) => {
    set({ theme: t });
    chrome.storage.local.set({ theme: t }).catch(() => {});
  },

  setViewMode: (m) => {
    set({ viewMode: m });
    chrome.storage.local.set({ viewMode: m }).catch(() => {});
  },

  openReader: (providers, index, turnId) => set({ reader: { open: true, providers, index, turnId } }),

  closeReader: () => set((s) => ({ reader: { ...s.reader, open: false } })),

  switchReader: (dir) =>
    set((s) => {
      const n = s.reader.providers.length;
      if (n === 0) return {};
      const index = (s.reader.index + dir + n) % n;
      return { reader: { ...s.reader, index } };
    }),

  sendEmbed: async (prompt, providers) => {
    const text = prompt.trim();
    if (!text || providers.length === 0) return;

    let convId = get().conversationId;
    if (!convId) {
      const res = (await sendToBackground({ type: 'NEW_CONVERSATION' })) as
        | { type: 'CONVERSATION_UPDATE'; conversation: Conversation }
        | undefined;
      convId = res?.conversation?.id;
      if (!convId) return;
    }

    const turnId = generateTaskId();
    set({
      currentTaskId: turnId,
      selectedTurnId: turnId,
      isLoading: true,
      conversationId: convId,
      viewMode: 'web',
      webSendNonce: get().webSendNonce + 1,
    });

    const safetyTimer = setTimeout(() => set({ isLoading: false }), 300000);
    try {
      await sendToBackground({
        type: 'APPEND_TURN',
        conversationId: convId!,
        turnId,
        prompt: text,
        targets: providers,
        embed: true,
      });
    } catch {
      set({ isLoading: false });
      clearTimeout(safetyTimer);
    }
  },
}));
