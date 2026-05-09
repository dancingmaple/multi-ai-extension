import { create } from 'zustand';
import type { ProviderName, AskTaskState } from '../shared/types';
import { ALL_PROVIDERS } from '../shared/constants';
import { sendToBackground, generateTaskId } from '../shared/messaging';

export type PanelMode = 'fullscreen' | 'sidepanel';

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

  setPrompt: (prompt: string) => void;
  toggleProvider: (provider: ProviderName) => void;
  toggleVisibleProvider: (provider: ProviderName) => void;
  setActiveTab: (provider: ProviderName) => void;
  setTask: (task: AskTaskState) => void;
  sendPrompt: () => Promise<void>;
  retryProvider: (provider: ProviderName) => Promise<void>;
  restoreLastTask: () => Promise<void>;
  switchPanelMode: () => Promise<void>;
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

    const taskId = generateTaskId();
    set({ currentTaskId: taskId, isLoading: true });

    await sendToBackground({
      type: 'ASK_ALL',
      taskId,
      prompt: prompt.trim(),
      targets: selectedProviders,
    });
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
    // If switching from fullscreen to side panel, close this tab
    if (panelMode === 'fullscreen') {
      window.close();
    }
  },
}));
