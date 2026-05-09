import type { ProviderName } from '../shared/types';
import { getProviderUrl, getProviderMatchPattern } from '../shared/providers';
import { TAB_SETTLE_MS, PING_RETRY_MAX, PING_RETRY_DELAY_MS } from '../shared/constants';
import { sleep } from '../shared/utils';

export async function getOrCreateProviderTab(provider: ProviderName): Promise<number> {
  console.log('[MultiAI:tabManager] getOrCreateProviderTab for', provider);
  const existing = await findExistingTab(provider);
  if (existing !== null) {
    console.log('[MultiAI:tabManager] Found existing tab', existing, 'for', provider);
    return existing;
  }

  const url = getProviderUrl(provider);
  console.log('[MultiAI:tabManager] Creating new tab for', url);
  const tab = await chrome.tabs.create({ url, active: false });
  if (!tab.id) throw new Error(`Failed to create tab for ${provider}`);
  console.log('[MultiAI:tabManager] Created tab', tab.id, 'for', provider);

  await waitForTabReady(tab.id);
  console.log('[MultiAI:tabManager] Tab', tab.id, 'ready, settling...');
  await sleep(TAB_SETTLE_MS);
  await ensureContentScriptReady(tab.id);
  console.log('[MultiAI:tabManager] Content script ready in tab', tab.id);

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
