# Multi AI Web Automation Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome MV3 extension that sends one prompt concurrently to ChatGPT, Gemini, and DeepSeek web apps, collects streaming responses via DOM automation, and displays them in a side panel with per-provider tabs.

**Architecture:** Side Panel (React+Zustand) → Background Service Worker (task orchestration) → Content Scripts (per-site DOM automation via adapter pattern). Messages flow through Chrome runtime messaging with typed protocols defined in a shared module.

**Tech Stack:** TypeScript, Vite (multi-entry build), React 18, Zustand, CSS Modules, chrome-types

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `manifest.ts`
- Create: `public/icon-16.png`
- Create: `public/icon-48.png`
- Create: `public/icon-128.png`
- Create: `public/sidepanel.html`
- Create: `src/background/index.ts`
- Create: `src/content/index.ts`
- Create: `src/sidepanel/main.tsx`
- Create: `src/sidepanel/App.tsx`
- Create: `src/sidepanel/App.module.css`

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "multi-ai-extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zustand": "^4.5.2"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.268",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.3",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `pnpm install`
Expected: dependencies installed without errors

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create manifest.ts (used by vite-plugin to generate manifest.json)**

```ts
import { type ManifestV3Export } from '@crxjs/vite-plugin';

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: 'Multi AI Web Automation',
  version: '0.1.0',
  description: 'Send one prompt to multiple AI web apps and view answers in one side panel',
  permissions: ['tabs', 'storage', 'scripting', 'sidePanel'],
  host_permissions: [
    'https://chatgpt.com/*',
    'https://gemini.google.com/*',
    'https://chat.deepseek.com/*',
    'https://*.deepseek.com/*',
  ],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  side_panel: {
    default_path: 'public/sidepanel.html',
  },
  content_scripts: [
    {
      matches: [
        'https://chatgpt.com/*',
        'https://gemini.google.com/*',
        'https://chat.deepseek.com/*',
        'https://*.deepseek.com/*',
      ],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  action: {
    default_title: 'Open Multi AI Panel',
  },
  icons: {
    '16': 'public/icon-16.png',
    '48': 'public/icon-48.png',
    '128': 'public/icon-128.png',
  },
};

export default manifest;
```

- [ ] **Step 5: Create vite.config.ts**

Note: We use `@crxjs/vite-plugin` for Chrome extension builds. Install it first:
Run: `pnpm add -D @crxjs/vite-plugin`

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import manifest from './manifest';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

- [ ] **Step 6: Create public/sidepanel.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Multi AI Panel</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="../src/sidepanel/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 7: Generate placeholder icon files**

Run: `pnpm add -D sharp; node -e "const sharp=require('sharp');[16,48,128].forEach(s=>sharp({create:{width:s,height:s,channels:4,background:{r:99,g:102,b:241,a:1}}}).png().toFile('public/icon-'+s+'.png'))"`

Alternatively, create simple solid-color PNGs using any tool. The icons just need to exist.

- [ ] **Step 8: Create placeholder source files to verify build**

`src/background/index.ts`:
```ts
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
console.log('Background service worker loaded');
```

`src/content/index.ts`:
```ts
console.log('[MultiAI] Content script loaded on', location.hostname);
```

`src/sidepanel/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);
```

`src/sidepanel/App.tsx`:
```tsx
import React from 'react';

const App: React.FC = () => {
  return <div><h1>Multi AI Panel</h1><p>Ready.</p></div>;
};

export default App;
```

- [ ] **Step 9: Verify build**

Run: `pnpm build`
Expected: Build succeeds, `dist/` directory created with extension files

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + React + TypeScript Chrome MV3 extension project"
```

---

### Task 2: Shared Types and Constants

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/constants.ts`
- Create: `src/shared/providers.ts`

- [ ] **Step 1: Create shared/types.ts**

```ts
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
```

- [ ] **Step 2: Create shared/constants.ts**

```ts
import type { ProviderName } from './types';

export const PROVIDER_URLS: Record<ProviderName, string> = {
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/',
  deepseek: 'https://chat.deepseek.com/',
};

export const PROVIDER_LABELS: Record<ProviderName, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
};

export const ALL_PROVIDERS: ProviderName[] = ['chatgpt', 'gemini', 'deepseek'];

export const STREAM_THROTTLE_MS = 300;
export const DONE_STABLE_MS = 250;
export const TAB_SETTLE_MS = 3000;
export const ELEMENT_TIMEOUT_MS = 15000;
export const PING_RETRY_MAX = 5;
export const PING_RETRY_DELAY_MS = 1000;

export const ERROR_CODES = {
  ELEMENT_NOT_FOUND: 'ELEMENT_NOT_FOUND',
  LOGIN_REQUIRED: 'LOGIN_REQUIRED',
  SUBMIT_FAILED: 'SUBMIT_FAILED',
  STREAM_FAILED: 'STREAM_FAILED',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
} as const;
```

- [ ] **Step 3: Create shared/providers.ts**

```ts
import type { ProviderName } from './types';
import { PROVIDER_URLS } from './constants';

export function getProviderUrl(provider: ProviderName): string {
  return PROVIDER_URLS[provider];
}

export function getProviderFromUrl(url: string): ProviderName | null {
  const hostname = new URL(url).hostname;
  if (hostname.includes('chatgpt.com')) return 'chatgpt';
  if (hostname.includes('gemini.google.com')) return 'gemini';
  if (hostname.includes('deepseek.com')) return 'deepseek';
  return null;
}

export function getProviderMatchPattern(provider: ProviderName): string {
  switch (provider) {
    case 'chatgpt':
      return 'https://chatgpt.com/*';
    case 'gemini':
      return 'https://gemini.google.com/*';
    case 'deepseek':
      return 'https://chat.deepseek.com/*';
  }
}
```

- [ ] **Step 4: Verify types compile**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/shared/
git commit -m "feat: add shared types, constants, and provider utilities"
```

---

### Task 3: Shared Messaging Helpers

**Files:**
- Create: `src/shared/messaging.ts`

- [ ] **Step 1: Create src/shared/messaging.ts**

```ts
import type {
  UIMessage,
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  BackgroundToUIMessage,
  TaskStateUpdateMessage,
} from './types';

export function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sendToBackground(message: UIMessage): Promise<BackgroundToUIMessage> {
  return chrome.runtime.sendMessage(message);
}

export async function sendToContent(
  tabId: number,
  message: BackgroundToContentMessage
): Promise<void> {
  await chrome.tabs.sendMessage(tabId, message);
}

export function sendToUI(message: BackgroundToUIMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // UI may not be open; that's fine
  });
}

export function broadcastTaskState(message: TaskStateUpdateMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}

export function onUIMessage(
  handler: (msg: UIMessage, sender: chrome.runtime.MessageSender) => void
): () => void {
  const listener = (msg: UIMessage, sender: chrome.runtime.MessageSender) => {
    if (msg.type === 'ASK_ALL' || msg.type === 'GET_TASK_STATE' || msg.type === 'RETRY_PROVIDER') {
      handler(msg, sender);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

export function onBackgroundMessage(
  handler: (msg: BackgroundToContentMessage, sender: chrome.runtime.MessageSender) => void
): () => void {
  const listener = (msg: BackgroundToContentMessage, sender: chrome.runtime.MessageSender) => {
    if (msg.type === 'EXECUTE_PROMPT' || msg.type === 'PING') {
      handler(msg, sender);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

export function onContentMessage(
  handler: (msg: ContentToBackgroundMessage, sender: chrome.runtime.MessageSender) => void
): () => void {
  const listener = (
    msg: ContentToBackgroundMessage,
    sender: chrome.runtime.MessageSender
  ) => {
    if (
      msg.type === 'PROVIDER_STATUS' ||
      msg.type === 'STREAM_UPDATE' ||
      msg.type === 'TASK_DONE' ||
      msg.type === 'TASK_ERROR'
    ) {
      handler(msg, sender);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/messaging.ts
git commit -m "feat: add typed messaging helpers for Chrome runtime communication"
```

---

### Task 4: Shared DOM Utilities

**Files:**
- Create: `src/shared/utils.ts`

- [ ] **Step 1: Create src/shared/utils.ts**

```ts
export function setNativeInputValue(
  element: HTMLTextAreaElement | HTMLInputElement,
  value: string
): void {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

export function setContentEditableValue(element: HTMLElement, value: string): void {
  element.focus();
  element.textContent = value;
  element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
}

export function clickElement(element: HTMLElement): void {
  element.click();
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractText(node: Node): string {
  return node.textContent?.trim() ?? '';
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export class ElementNotFoundError extends Error {
  constructor(selectors: string[]) {
    super(`Element not found for selectors: ${selectors.join(', ')}`);
    this.name = 'ElementNotFoundError';
  }
}

export class LoginRequiredError extends Error {
  constructor(provider: string) {
    super(`Login required for ${provider}`);
    this.name = 'LoginRequiredError';
  }
}

export class SubmitFailedError extends Error {
  constructor(provider: string, reason?: string) {
    super(`Submit failed for ${provider}${reason ? `: ${reason}` : ''}`);
    this.name = 'SubmitFailedError';
  }
}

export function isElementVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/utils.ts
git commit -m "feat: add shared DOM utilities and error classes"
```

---

### Task 5: Background — State Store

**Files:**
- Create: `src/background/stateStore.ts`

- [ ] **Step 1: Create src/background/stateStore.ts**

```ts
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
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/background/stateStore.ts
git commit -m "feat: add background state store with in-memory and persisted task state"
```

---

### Task 6: Background — Message Router and Tab Manager

**Files:**
- Create: `src/background/messageRouter.ts`
- Create: `src/background/tabManager.ts`

- [ ] **Step 1: Create src/background/tabManager.ts**

```ts
import type { ProviderName } from '../shared/types';
import { getProviderUrl, getProviderMatchPattern } from '../shared/providers';
import { TAB_SETTLE_MS, PING_RETRY_MAX, PING_RETRY_DELAY_MS } from '../shared/constants';
import { sleep } from '../shared/utils';

export async function getOrCreateProviderTab(provider: ProviderName): Promise<number> {
  const existing = await findExistingTab(provider);
  if (existing !== null) return existing;

  const url = getProviderUrl(provider);
  const tab = await chrome.tabs.create({ url, active: false });
  if (!tab.id) throw new Error(`Failed to create tab for ${provider}`);

  await waitForTabReady(tab.id);
  await sleep(TAB_SETTLE_MS);
  await ensureContentScriptReady(tab.id);

  return tab.id;
}

async function findExistingTab(provider: ProviderName): Promise<number | null> {
  const pattern = getProviderMatchPattern(provider);
  const tabs = await chrome.tabs.query({ url: pattern });
  if (tabs.length > 0 && tabs[0].id !== undefined) {
    return tabs[0].id;
  }
  return null;
}

async function waitForTabReady(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Tab load timeout')), 30000);
    const check = () => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          clearTimeout(timeout);
          reject(chrome.runtime.lastError);
          return;
        }
        if (tab.status === 'complete') {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 500);
        }
      });
    };
    check();
  });
}

async function ensureContentScriptReady(tabId: number): Promise<void> {
  for (let i = 0; i < PING_RETRY_MAX; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      return;
    } catch {
      await sleep(PING_RETRY_DELAY_MS);
    }
  }
  throw new Error(`Content script not ready for tab ${tabId} after ${PING_RETRY_MAX} retries`);
}
```

- [ ] **Step 2: Create src/background/messageRouter.ts**

```ts
import type { UIMessage, AskTaskState, ProviderName, ProviderStatus } from '../shared/types';
import {
  onUIMessage,
  onContentMessage,
  sendToContent,
  broadcastTaskState,
} from '../shared/messaging';
import { createTask, getTask, updateProviderStatus, updateProviderContent, finishProviderTask, failProviderTask, setProviderTabId, loadLastTask } from './stateStore';
import { getOrCreateProviderTab } from './tabManager';

let initialized = false;

export async function initMessageRouter(): Promise<void> {
  if (initialized) return;
  initialized = true;

  await loadLastTask();

  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

  onUIMessage(handleUIMessage);
  onContentMessage(handleContentMessage);
}

async function handleUIMessage(
  msg: UIMessage,
  _sender: chrome.runtime.MessageSender
): Promise<void> {
  switch (msg.type) {
    case 'ASK_ALL': {
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
  }
}

function handleContentMessage(
  msg: {
    type: string;
    taskId: string;
    provider: ProviderName;
    status?: ProviderStatus;
    detail?: string;
    content?: string;
    finalContent?: string;
    errorCode?: string;
    errorMessage?: string;
  },
  _sender: chrome.runtime.MessageSender
): void {
  let updatedTask: AskTaskState | undefined;

  switch (msg.type) {
    case 'PROVIDER_STATUS':
      updatedTask = updateProviderStatus(msg.taskId, msg.provider, msg.status!, msg.detail);
      break;
    case 'STREAM_UPDATE':
      updatedTask = updateProviderContent(msg.taskId, msg.provider, msg.content!);
      break;
    case 'TASK_DONE':
      updatedTask = finishProviderTask(msg.taskId, msg.provider, msg.finalContent!);
      break;
    case 'TASK_ERROR':
      updatedTask = failProviderTask(msg.taskId, msg.provider, msg.errorMessage!);
      break;
  }

  if (updatedTask) {
    broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: updatedTask });
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
  try {
    updateProviderStatus(taskId, provider, 'waiting');
    broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: getTask(taskId)! });

    const tabId = await getOrCreateProviderTab(provider);
    setProviderTabId(taskId, provider, tabId);

    updateProviderStatus(taskId, provider, 'sending');
    broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: getTask(taskId)! });

    await sendToContent(tabId, {
      type: 'EXECUTE_PROMPT',
      taskId,
      provider,
      prompt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    failProviderTask(taskId, provider, message);
    broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: getTask(taskId)! });
  }
}
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/background/messageRouter.ts src/background/tabManager.ts
git commit -m "feat: add background message router and tab manager"
```

---

### Task 7: Background — Entry Point

**Files:**
- Modify: `src/background/index.ts`

- [ ] **Step 1: Rewrite src/background/index.ts**

```ts
import { initMessageRouter } from './messageRouter';

initMessageRouter().catch(console.error);
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/background/index.ts
git commit -m "feat: wire up background service worker entry point"
```

---

### Task 8: Content Script — DOM Observer

**Files:**
- Create: `src/content/dom/observer.ts`

- [ ] **Step 1: Create src/content/dom/observer.ts**

```ts
export function waitForElement(
  selectors: string[],
  timeoutMs: number = 15000
): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    for (const sel of selectors) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) {
        resolve(el);
        return;
      }
    }

    let observer: MutationObserver;

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(
        new Error(
          `Element not found for selectors: ${selectors.join(', ')} within ${timeoutMs}ms`
        )
      );
    }, timeoutMs);

    observer = new MutationObserver(() => {
      for (const sel of selectors) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el) {
          clearTimeout(timer);
          observer.disconnect();
          resolve(el);
          return;
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

export function observeTextChanges(
  target: Node,
  onUpdate: (text: string) => void,
  throttleMs: number = 300
): () => void {
  let lastText = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    const text = target.textContent?.trim() ?? '';
    if (text !== lastText) {
      lastText = text;
      onUpdate(text);
    }
  };

  const observer = new MutationObserver(() => {
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, throttleMs);
    }
  });

  observer.observe(target, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  flush();

  return () => {
    observer.disconnect();
    if (timer !== null) clearTimeout(timer);
  };
}

export function waitForStableText(
  target: Node,
  stableMs: number = 250,
  maxWaitMs: number = 120000
): Promise<string> {
  return new Promise((resolve) => {
    let lastText = target.textContent?.trim() ?? '';
    let stableTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTimer = setTimeout(() => {
      observer.disconnect();
      if (stableTimer !== null) clearTimeout(stableTimer);
      resolve(lastText);
    }, maxWaitMs);

    let done = false;
    const finish = (text: string) => {
      if (done) return;
      done = true;
      clearTimeout(maxTimer);
      if (stableTimer !== null) clearTimeout(stableTimer);
      observer.disconnect();
      resolve(text);
    };

    const observer = new MutationObserver(() => {
      const current = target.textContent?.trim() ?? '';
      if (current !== lastText) {
        lastText = current;
        if (stableTimer !== null) clearTimeout(stableTimer);
        stableTimer = setTimeout(() => finish(current), stableMs);
      }
    });

    observer.observe(target, { childList: true, subtree: true, characterData: true });
    stableTimer = setTimeout(() => finish(lastText), stableMs);
  });
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/content/dom/observer.ts
git commit -m "feat: add DOM observer utilities for element waiting and text change monitoring"
```

---

### Task 9: Content Script — Adapter Base Class

**Files:**
- Create: `src/content/adapters/base.ts`

- [ ] **Step 1: Create src/content/adapters/base.ts**

```ts
import type { ProviderName } from '../../shared/types';
import { waitForElement, observeTextChanges, waitForStableText } from '../dom/observer';
import { setNativeInputValue, setContentEditableValue, clickElement, LoginRequiredError, SubmitFailedError } from '../../shared/utils';
import { ELEMENT_TIMEOUT_MS, STREAM_THROTTLE_MS, DONE_STABLE_MS } from '../../shared/constants';

export interface SiteAdapter {
  readonly provider: ProviderName;
  isReady(): Promise<boolean>;
  detectLoginRequired(): boolean;
  waitForReady(timeoutMs?: number): Promise<void>;
  setPrompt(prompt: string): Promise<void>;
  submit(): Promise<void>;
  startStreaming(
    onUpdate: (text: string) => void,
    onDone: (finalText: string) => void,
    onError: (err: Error) => void
  ): () => void;
}

export abstract class BaseAdapter implements SiteAdapter {
  abstract readonly provider: ProviderName;
  abstract readonly inputSelectors: string[];
  abstract readonly submitSelectors: string[];
  abstract readonly responseSelectors: string[];
  abstract readonly loginSelectors: string[];
  protected readonly loginTextPatterns: string[] = [];

  async isReady(): Promise<boolean> {
    try {
      const el = await waitForElement(this.inputSelectors, 3000);
      return el !== null;
    } catch {
      return false;
    }
  }

  detectLoginRequired(): boolean {
    for (const sel of this.loginSelectors) {
      const el = document.querySelector(sel);
      if (el) return true;
    }
    if (this.loginTextPatterns.length > 0) {
      const buttons = document.querySelectorAll('button, a');
      for (const btn of buttons) {
        const text = btn.textContent?.trim() ?? '';
        for (const pattern of this.loginTextPatterns) {
          if (text === pattern) return true;
        }
      }
    }
    return false;
  }

  async waitForReady(timeoutMs: number = ELEMENT_TIMEOUT_MS): Promise<void> {
    await waitForElement(this.inputSelectors, timeoutMs);
  }

  async setPrompt(prompt: string): Promise<void> {
    const el = await waitForElement(this.inputSelectors, ELEMENT_TIMEOUT_MS);

    if (this.detectLoginRequired()) {
      throw new LoginRequiredError(this.provider);
    }

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      setNativeInputValue(el, prompt);
    } else if (el.getAttribute('contenteditable') === 'true' || el.isContentEditable) {
      setContentEditableValue(el, prompt);
    } else {
      const textarea = el.querySelector('textarea');
      if (textarea) {
        setNativeInputValue(textarea, prompt);
      } else {
        setContentEditableValue(el, prompt);
      }
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  async submit(): Promise<void> {
    const btn = await waitForElement(this.submitSelectors, ELEMENT_TIMEOUT_MS);
    if (!(btn instanceof HTMLElement)) {
      throw new SubmitFailedError(this.provider, 'Submit button not an HTMLElement');
    }
    clickElement(btn);
  }

  startStreaming(
    onUpdate: (text: string) => void,
    onDone: (finalText: string) => void,
    onError: (err: Error) => void
  ): () => void {
    let cancelled = false;
    let cleanupObserve: (() => void) | null = null;

    const start = async () => {
      try {
        const responseEl = await waitForElement(this.responseSelectors, 30000);
        if (cancelled) return;

        let lastText = '';

        cleanupObserve = observeTextChanges(responseEl, (text) => {
          if (cancelled) return;
          if (text !== lastText) {
            lastText = text;
            onUpdate(text);
          }
        }, STREAM_THROTTLE_MS);

        const finalText = await waitForStableText(responseEl, DONE_STABLE_MS, 120000);
        if (!cancelled) {
          onDone(finalText);
        }
      } catch (err) {
        if (!cancelled) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };

    start();

    return () => {
      cancelled = true;
      if (cleanupObserve) cleanupObserve();
    };
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/content/adapters/base.ts
git commit -m "feat: add BaseAdapter abstract class with shared site automation logic"
```

---

### Task 10: DeepSeek Adapter

**Files:**
- Create: `src/content/adapters/deepseek.ts`

- [ ] **Step 1: Create src/content/adapters/deepseek.ts**

```ts
import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';

export class DeepSeekAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'deepseek';

  readonly inputSelectors = [
    'textarea[placeholder*="发消息"]',
    'textarea[placeholder*="发送"]',
    'textarea[placeholder*="message"]',
    'textarea[placeholder*="Message"]',
    '#chat-input',
    'textarea',
  ];

  readonly submitSelectors = [
    'button[aria-label*="发送"]',
    'button[aria-label*="Send"]',
    'div[role="button"][aria-label*="发送"]',
  ];

  readonly responseSelectors = [
    '[class*="ds-markdown"]',
    '.ds-markdown',
    '[class*="markdown"]',
  ];

  readonly loginSelectors = [
    'a[href*="login"]',
    'a[href*="/auth"]',
  ];

  readonly loginTextPatterns = ['登录', 'Log in', 'Sign in'];

  async submit(): Promise<void> {
    // DeepSeek often uses Enter to send; try button first, fall back to Enter
    try {
      await super.submit();
    } catch {
      const input = document.querySelector<HTMLElement>(this.inputSelectors[0]);
      if (input) {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
        );
      } else {
        throw new Error('DeepSeek: cannot submit — no button and no input found');
      }
    }
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/content/adapters/deepseek.ts
git commit -m "feat: add DeepSeek site adapter"
```

---

### Task 11: ChatGPT Adapter

**Files:**
- Create: `src/content/adapters/chatgpt.ts`

- [ ] **Step 1: Create src/content/adapters/chatgpt.ts**

```ts
import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';

export class ChatGPTAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'chatgpt';

  readonly inputSelectors = [
    '#prompt-textarea',
    'textarea[data-id="root"]',
    'textarea[placeholder*="Message"]',
    'textarea[placeholder*="消息"]',
    'div[contenteditable="true"][data-mce-placeholder]',
    'p[data-placeholder]',
  ];

  readonly submitSelectors = [
    'button[data-testid="send-button"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
  ];

  readonly responseSelectors = [
    '[data-message-author-role="assistant"]',
    '.markdown',
    '[class*="agent-turn"]',
  ];

  readonly loginSelectors = [
    'a[href*="login"]',
    'a[href*="/auth"]',
  ];

  readonly loginTextPatterns = ['Log in', '登录', 'Sign in'];

  async setPrompt(prompt: string): Promise<void> {
    // ChatGPT uses contenteditable div with a nested p tag
    const pEl = document.querySelector('p[data-placeholder]');
    if (pEl instanceof HTMLElement) {
      pEl.focus();
      pEl.textContent = prompt;
      pEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt }));
      await new Promise((r) => setTimeout(r, 200));
      return;
    }
    await super.setPrompt(prompt);
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/content/adapters/chatgpt.ts
git commit -m "feat: add ChatGPT site adapter"
```

---

### Task 12: Gemini Adapter

**Files:**
- Create: `src/content/adapters/gemini.ts`

- [ ] **Step 1: Create src/content/adapters/gemini.ts**

```ts
import { BaseAdapter } from './base';
import type { ProviderName } from '../../shared/types';

export class GeminiAdapter extends BaseAdapter {
  readonly provider: ProviderName = 'gemini';

  readonly inputSelectors = [
    'rich-textarea div[contenteditable="true"]',
    'div[contenteditable="true"][aria-label*="prompt"]',
    'div[contenteditable="true"][aria-label*="输入"]',
    'textarea[aria-label*="prompt"]',
    'textarea[aria-label*="输入"]',
  ];

  readonly submitSelectors = [
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
    'button[aria-label*="send"]',
    'button.send-button',
  ];

  readonly responseSelectors = [
    'model-response .markdown',
    'model-response',
    '[class*="response-content"]',
    'message-content',
  ];

  readonly loginSelectors = [
    'a[href*="signin"]',
    'a[href*="login"]',
    'a[href*="/auth"]',
  ];

  readonly loginTextPatterns = ['Sign in', '登录', 'Log in'];

  async waitForReady(timeoutMs?: number): Promise<void> {
    // Gemini sometimes has a two-stage load; wait for the rich-textarea to be fully interactive
    await super.waitForReady(timeoutMs);
    await new Promise((r) => setTimeout(r, 1500));
  }

  async submit(): Promise<void> {
    try {
      await super.submit();
    } catch {
      // Gemini sometimes requires pressing Enter in the contenteditable div
      const input = document.querySelector<HTMLElement>(
        'rich-textarea div[contenteditable="true"]'
      );
      if (input) {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
        );
      } else {
        throw new Error('Gemini: cannot submit — no button and no input found');
      }
    }
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/content/adapters/gemini.ts
git commit -m "feat: add Gemini site adapter"
```

---

### Task 13: Content Script — Executor and Entry Point

**Files:**
- Create: `src/content/executor.ts`
- Modify: `src/content/index.ts`

- [ ] **Step 1: Create src/content/executor.ts**

```ts
import type { ProviderName, ExecutePromptMessage } from '../shared/types';
import type { SiteAdapter } from './adapters/base';
import { ChatGPTAdapter } from './adapters/chatgpt';
import { GeminiAdapter } from './adapters/gemini';
import { DeepSeekAdapter } from './adapters/deepseek';
import { LoginRequiredError } from '../shared/utils';

const adapters: Record<ProviderName, SiteAdapter> = {
  chatgpt: new ChatGPTAdapter(),
  gemini: new GeminiAdapter(),
  deepseek: new DeepSeekAdapter(),
};

export async function executePrompt(
  msg: ExecutePromptMessage,
  sendStatus: (status: string, detail?: string) => void,
  sendStream: (content: string) => void,
  sendDone: (finalContent: string) => void,
  sendError: (code: string, message: string) => void
): Promise<void> {
  const adapter = adapters[msg.provider];
  if (!adapter) {
    sendError('UNKNOWN_PROVIDER', `Unknown provider: ${msg.provider}`);
    return;
  }

  try {
    sendStatus('sending', 'Locating input...');
    await adapter.waitForReady();

    if (adapter.detectLoginRequired()) {
      sendStatus('login_required', 'Login required');
      sendError('LOGIN_REQUIRED', `${msg.provider} requires login`);
      return;
    }

    await adapter.setPrompt(msg.prompt);

    sendStatus('sending', 'Submitting...');
    await adapter.submit();

    sendStatus('streaming');
    adapter.startStreaming(
      (text) => sendStream(text),
      (final) => {
        sendStatus('done');
        sendDone(final);
      },
      (err) => {
        if (err instanceof LoginRequiredError) {
          sendStatus('login_required');
        } else {
          sendStatus('error', err.message);
        }
        sendError('STREAM_FAILED', err.message);
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    sendStatus('error', message);
    sendError('EXECUTION_FAILED', message);
  }
}
```

- [ ] **Step 2: Rewrite src/content/index.ts**

```ts
import { onBackgroundMessage } from '../shared/messaging';
import type { ExecutePromptMessage } from '../shared/types';
import { executePrompt } from './executor';

onBackgroundMessage((msg, sender) => {
  if (msg.type === 'EXECUTE_PROMPT') {
    const execMsg = msg as ExecutePromptMessage;
    const sendStatus = (status: string, detail?: string) => {
      chrome.runtime.sendMessage({
        type: 'PROVIDER_STATUS',
        taskId: execMsg.taskId,
        provider: execMsg.provider,
        status,
        detail,
      });
    };

    const sendStream = (content: string) => {
      chrome.runtime.sendMessage({
        type: 'STREAM_UPDATE',
        taskId: execMsg.taskId,
        provider: execMsg.provider,
        content,
        isPartial: true,
      });
    };

    const sendDone = (finalContent: string) => {
      chrome.runtime.sendMessage({
        type: 'TASK_DONE',
        taskId: execMsg.taskId,
        provider: execMsg.provider,
        finalContent,
      });
    };

    const sendError = (errorCode: string, errorMessage: string) => {
      chrome.runtime.sendMessage({
        type: 'TASK_ERROR',
        taskId: execMsg.taskId,
        provider: execMsg.provider,
        errorCode,
        errorMessage,
      });
    };

    executePrompt(execMsg, sendStatus, sendStream, sendDone, sendError);
  }

  if (msg.type === 'PING') {
    chrome.runtime.sendMessage({ type: 'PONG' });
  }
});
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/content/executor.ts src/content/index.ts
git commit -m "feat: add content script executor and wire up entry point"
```

---

### Task 14: Side Panel — Zustand Store

**Files:**
- Create: `src/sidepanel/store.ts`

- [ ] **Step 1: Create src/sidepanel/store.ts**

```ts
import { create } from 'zustand';
import type { ProviderName, AskTaskState } from '../shared/types';
import { ALL_PROVIDERS } from '../shared/constants';
import { sendToBackground, generateTaskId } from '../shared/messaging';

interface PanelState {
  currentTaskId: string | undefined;
  prompt: string;
  selectedProviders: ProviderName[];
  activeTab: ProviderName;
  task: AskTaskState | undefined;
  isLoading: boolean;

  setPrompt: (prompt: string) => void;
  toggleProvider: (provider: ProviderName) => void;
  setActiveTab: (provider: ProviderName) => void;
  setTask: (task: AskTaskState) => void;
  sendPrompt: () => Promise<void>;
  retryProvider: (provider: ProviderName) => Promise<void>;
  restoreLastTask: () => Promise<void>;
}

export const useStore = create<PanelState>((set, get) => ({
  currentTaskId: undefined,
  prompt: '',
  selectedProviders: [...ALL_PROVIDERS],
  activeTab: ALL_PROVIDERS[0],
  task: undefined,
  isLoading: false,

  setPrompt: (prompt) => set({ prompt }),

  toggleProvider: (provider) =>
    set((state) => {
      const selected = state.selectedProviders.includes(provider)
        ? state.selectedProviders.filter((p) => p !== provider)
        : [...state.selectedProviders, provider];
      return { selectedProviders: selected };
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
}));
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/sidepanel/store.ts
git commit -m "feat: add Zustand store for side panel state management"
```

---

### Task 15: Side Panel — Components

**Files:**
- Create: `src/sidepanel/components/PromptInput.tsx`
- Create: `src/sidepanel/components/PromptInput.module.css`
- Create: `src/sidepanel/components/ProviderTabs.tsx`
- Create: `src/sidepanel/components/ProviderTabs.module.css`
- Create: `src/sidepanel/components/StatusBadge.tsx`
- Create: `src/sidepanel/components/StatusBadge.module.css`
- Create: `src/sidepanel/components/Toolbar.tsx`
- Create: `src/sidepanel/components/Toolbar.module.css`
- Create: `src/sidepanel/components/ResponseView.tsx`
- Create: `src/sidepanel/components/ResponseView.module.css`
- Create: `src/sidepanel/components/index.ts`

- [ ] **Step 1: Create PromptInput component**

`src/sidepanel/components/PromptInput.tsx`:
```tsx
import React, { useCallback, useRef } from 'react';
import { useStore } from '../store';
import { ALL_PROVIDERS, PROVIDER_LABELS } from '../../shared/constants';
import type { ProviderName } from '../../shared/types';
import styles from './PromptInput.module.css';

const PromptInput: React.FC = () => {
  const prompt = useStore((s) => s.prompt);
  const setPrompt = useStore((s) => s.setPrompt);
  const selectedProviders = useStore((s) => s.selectedProviders);
  const toggleProvider = useStore((s) => s.toggleProvider);
  const sendPrompt = useStore((s) => s.sendPrompt);
  const isLoading = useStore((s) => s.isLoading);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    sendPrompt();
  }, [sendPrompt]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className={styles.container}>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter your prompt... (Ctrl+Enter to send)"
        rows={3}
      />
      <div className={styles.providers}>
        {ALL_PROVIDERS.map((p: ProviderName) => (
          <label key={p} className={styles.checkbox}>
            <input
              type="checkbox"
              checked={selectedProviders.includes(p)}
              onChange={() => toggleProvider(p)}
            />
            {PROVIDER_LABELS[p]}
          </label>
        ))}
      </div>
      <button
        className={styles.sendBtn}
        onClick={handleSend}
        disabled={isLoading || !prompt.trim() || selectedProviders.length === 0}
      >
        {isLoading ? 'Sending...' : 'Send'}
      </button>
    </div>
  );
};

export default PromptInput;
```

`src/sidepanel/components/PromptInput.module.css`:
```css
.container {
  padding: 12px;
  border-bottom: 1px solid #e5e7eb;
}
.textarea {
  width: 100%;
  padding: 8px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  resize: vertical;
  box-sizing: border-box;
  font-family: inherit;
}
.providers {
  display: flex;
  gap: 12px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.checkbox {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
}
.sendBtn {
  margin-top: 8px;
  padding: 6px 16px;
  background: #6366f1;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.sendBtn:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Create StatusBadge component**

`src/sidepanel/components/StatusBadge.tsx`:
```tsx
import React from 'react';
import type { ProviderStatus } from '../../shared/types';
import styles from './StatusBadge.module.css';

const STATUS_COLORS: Record<ProviderStatus, string> = {
  idle: '#9ca3af',
  waiting: '#f59e0b',
  sending: '#3b82f6',
  streaming: '#8b5cf6',
  done: '#10b981',
  error: '#ef4444',
  login_required: '#f97316',
};

interface Props {
  status: ProviderStatus;
}

const StatusBadge: React.FC<Props> = ({ status }) => {
  return (
    <span className={styles.badge} style={{ background: STATUS_COLORS[status] }}>
      {status.replace('_', ' ')}
    </span>
  );
};

export default StatusBadge;
```

`src/sidepanel/components/StatusBadge.module.css`:
```css
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  color: #fff;
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.5px;
}
```

- [ ] **Step 3: Create ProviderTabs component**

`src/sidepanel/components/ProviderTabs.tsx`:
```tsx
import React from 'react';
import { useStore } from '../store';
import { PROVIDER_LABELS } from '../../shared/constants';
import type { ProviderName } from '../../shared/types';
import StatusBadge from './StatusBadge';
import styles from './ProviderTabs.module.css';

const ProviderTabs: React.FC = () => {
  const task = useStore((s) => s.task);
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const selectedProviders = useStore((s) => s.selectedProviders);

  return (
    <div className={styles.tabs}>
      {selectedProviders.map((p: ProviderName) => {
        const providerState = task?.providers[p];
        const status = providerState?.status ?? 'idle';
        return (
          <button
            key={p}
            className={`${styles.tab} ${activeTab === p ? styles.active : ''}`}
            onClick={() => setActiveTab(p)}
          >
            <span>{PROVIDER_LABELS[p]}</span>
            <StatusBadge status={status} />
          </button>
        );
      })}
    </div>
  );
};

export default ProviderTabs;
```

`src/sidepanel/components/ProviderTabs.module.css`:
```css
.tabs {
  display: flex;
  border-bottom: 2px solid #e5e7eb;
}
.tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 4px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  font-size: 12px;
  cursor: pointer;
  color: #6b7280;
}
.tab:hover {
  color: #374151;
}
.active {
  color: #6366f1;
  border-bottom-color: #6366f1;
}
```

- [ ] **Step 4: Create ResponseView component**

`src/sidepanel/components/ResponseView.tsx`:
```tsx
import React, { useRef, useEffect } from 'react';
import { useStore } from '../store';
import styles from './ResponseView.module.css';

const ResponseView: React.FC = () => {
  const task = useStore((s) => s.task);
  const activeTab = useStore((s) => s.activeTab);
  const retryProvider = useStore((s) => s.retryProvider);
  const containerRef = useRef<HTMLDivElement>(null);

  const providerState = task?.providers[activeTab];
  const content = providerState?.content ?? '';
  const status = providerState?.status ?? 'idle';
  const error = providerState?.error;

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [content]);

  const handleCopy = () => {
    navigator.clipboard.writeText(content).catch(console.error);
  };

  if (status === 'error' || status === 'login_required') {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <p>{error ?? 'An error occurred'}</p>
          <button className={styles.retryBtn} onClick={() => retryProvider(activeTab)}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (status === 'idle' || status === 'waiting') {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>Waiting to start...</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <button className={styles.copyBtn} onClick={handleCopy} disabled={!content}>
          Copy
        </button>
      </div>
      <div ref={containerRef} className={styles.content}>
        {content ? (
          <pre className={styles.pre}>{content}</pre>
        ) : status === 'streaming' ? (
          <div className={styles.empty}>Waiting for response...</div>
        ) : (
          <div className={styles.empty}>No response yet</div>
        )}
        {status === 'streaming' && <span className={styles.cursor}>|</span>}
      </div>
    </div>
  );
};

export default ResponseView;
```

`src/sidepanel/components/ResponseView.module.css`:
```css
.container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 4px 8px;
  border-bottom: 1px solid #f3f4f6;
}
.copyBtn {
  padding: 2px 8px;
  font-size: 11px;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  cursor: pointer;
}
.content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.pre {
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
}
.cursor {
  animation: blink 1s step-end infinite;
}
@keyframes blink {
  50% { opacity: 0; }
}
.empty {
  color: #9ca3af;
  font-size: 13px;
  padding: 20px;
  text-align: center;
}
.error {
  padding: 20px;
  text-align: center;
  color: #ef4444;
  font-size: 13px;
}
.retryBtn {
  margin-top: 8px;
  padding: 4px 12px;
  background: #ef4444;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
```

- [ ] **Step 5: Create components barrel export**

`src/sidepanel/components/index.ts`:
```ts
export { default as PromptInput } from './PromptInput';
export { default as ProviderTabs } from './ProviderTabs';
export { default as StatusBadge } from './StatusBadge';
export { default as ResponseView } from './ResponseView';
```

- [ ] **Step 6: Verify types compile**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/components/
git commit -m "feat: add side panel UI components"
```

---

### Task 16: Side Panel — App and Message Listener

**Files:**
- Modify: `src/sidepanel/App.tsx`
- Create: `src/sidepanel/App.module.css`
- Create: `src/sidepanel/globals.css`

- [ ] **Step 1: Rewrite src/sidepanel/App.tsx**

```tsx
import React, { useEffect } from 'react';
import { useStore } from './store';
import { PromptInput, ProviderTabs, ResponseView } from './components';
import type { BackgroundToUIMessage } from '../shared/types';
import styles from './App.module.css';

const App: React.FC = () => {
  const setTask = useStore((s) => s.setTask);
  const restoreLastTask = useStore((s) => s.restoreLastTask);

  useEffect(() => {
    restoreLastTask();

    const listener = (msg: BackgroundToUIMessage) => {
      if (msg.type === 'TASK_STATE_UPDATE') {
        setTask(msg.task);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [setTask, restoreLastTask]);

  return (
    <div className={styles.app}>
      <PromptInput />
      <ProviderTabs />
      <ResponseView />
    </div>
  );
};

export default App;
```

`src/sidepanel/App.module.css`:
```css
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  color: #1f2937;
  background: #fff;
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/sidepanel/App.tsx src/sidepanel/App.module.css
git commit -m "feat: wire up App component with message listener and last-task restore"
```

---

### Task 17: End-to-End Verification and Polish

**Files:**
- Modify: `src/sidepanel/main.tsx` (add global CSS import)
- Modify: `src/sidepanel/store.ts` (fix any issues from integration)

- [ ] **Step 1: Add global CSS import to main.tsx**

Edit `src/sidepanel/main.tsx` to add at the top:
```tsx
import './globals.css';
```

Create `src/sidepanel/globals.css`:
```css
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
```

- [ ] **Step 2: Fix store type issue — setIsLoading after send**

The `sendPrompt` action should set `isLoading: false` when the task state update arrives. Update the TASK_STATE_UPDATE handler in App.tsx to also clear loading. Add to the effect:

```tsx
const listener = (msg: BackgroundToUIMessage) => {
  if (msg.type === 'TASK_STATE_UPDATE') {
    setTask(msg.task);
    // Clear loading when all providers have finished (not waiting/sending/streaming)
    const allDone = Object.values(msg.task.providers).every(
      (p) => p.status === 'done' || p.status === 'error' || p.status === 'login_required'
    );
    if (allDone) {
      useStore.setState({ isLoading: false });
    }
  }
};
```

- [ ] **Step 3: Rebuild and verify**

Run: `pnpm build`
Expected: Clean build with no errors

- [ ] **Step 4: Load extension in Chrome and smoke test**

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `dist/` directory
4. Click the extension icon → side panel should open
5. Verify the UI renders with input box, provider checkboxes, and Send button

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add global styles and loading state polish"
```
