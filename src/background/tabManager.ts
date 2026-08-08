import type { ProviderName } from '../shared/types';
import { getProviderUrl, getProviderMatchPattern } from '../shared/providers';
import { TAB_SETTLE_MS, PING_RETRY_MAX, PING_RETRY_DELAY_MS } from '../shared/constants';
import { sleep } from '../shared/utils';

// ─────────────────────────────────────────────────────────────
// 节点-平台专属标签页登记表：(nodeId + provider) -> tabId
// 工作台每个节点对每个 AI 只持有「一张」专属标签页：
//  - 既保证「每个节点独立新会话」（不同节点的同名 AI 不会串台/续聊），
//  - 又避免每次执行都新开标签、导致浏览器里堆满重复 tab，
//  - 同时让「手动获取 / 预览 / 聚焦」能精确定位到这一张 tab，不再因
//    「同 provider 多 tab」而抓错页面（之前的 forceNew 方案的痛点）。
// ─────────────────────────────────────────────────────────────
const nodeProviderTabs = new Map<string, number>();

function registryKey(nodeId: string, provider: ProviderName): string {
  return `${nodeId}:${provider}`;
}

/** 取出某节点某平台的专属 tabId（不做存活校验，调用方负责） */
export function getRegisteredTabId(
  nodeId: string | undefined,
  provider: ProviderName
): number | undefined {
  if (!nodeId) return undefined;
  return nodeProviderTabs.get(registryKey(nodeId, provider));
}

/** 标签页被用户关闭时，从登记表移除，避免复用死 tab */
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [key, id] of nodeProviderTabs.entries()) {
    if (id === tabId) nodeProviderTabs.delete(key);
  }
});

export async function getOrCreateProviderTab(
  provider: ProviderName,
  opts?: { forceNew?: boolean; nodeId?: string }
): Promise<number> {
  const nodeId = opts?.nodeId;
  console.log('[MultiAI:tabManager] getOrCreateProviderTab', provider, {
    nodeId: nodeId ?? null,
    forceNew: !!opts?.forceNew,
  });

  // ── 工作台路径：每个 (节点, provider) 绑定一张专属标签页，复用而非新开 ──
  if (nodeId) {
    const key = registryKey(nodeId, provider);
    const existing = nodeProviderTabs.get(key);
    if (existing !== undefined) {
      try {
        const tab = await chrome.tabs.get(existing);
        if (tab) {
          // 复用前把该标签页重置为新会话（避免沿用上一个任务 / 上一轮对话的上下文）
          await resetTabToNewChat(existing, provider);
          console.log('[MultiAI:tabManager] 复用节点专属 tab', existing, 'for', key);
          return existing;
        }
      } catch {
        nodeProviderTabs.delete(key);
      }
    }
    // 还没有专属 tab：新开并登记
    const tabId = await createProviderTab(provider);
    nodeProviderTabs.set(key, tabId);
    console.log('[MultiAI:tabManager] 新建并登记节点专属 tab', tabId, 'for', key);
    return tabId;
  }

  // ── 侧边栏 / 全屏路径（无 nodeId）：沿用原有「按域名复用一个 tab」逻辑 ──
  if (!opts?.forceNew) {
    const existing = await findExistingTab(provider);
    if (existing !== null) {
      try {
        await ensureContentScriptReady(existing);
        console.log('[MultiAI:tabManager] Found existing tab', existing, 'for', provider);
        return existing;
      } catch {
        console.log('[MultiAI:tabManager] Existing tab', existing, 'has stale content script, creating new tab');
        chrome.tabs.remove(existing).catch(() => {});
      }
    }
  }

  return createProviderTab(provider);
}

/** 把已存在的标签页重置为对应 AI 的新会话（导航到新对话地址 + 等待就绪） */
async function resetTabToNewChat(tabId: number, provider: ProviderName): Promise<void> {
  try {
    await chrome.tabs.update(tabId, { url: getProviderUrl(provider) });
    await waitForTabReady(tabId);
    await sleep(TAB_SETTLE_MS);
    await ensureContentScriptReady(tabId);
    console.log('[MultiAI:tabManager] 已重置 tab', tabId, '为', provider, '新会话');
  } catch (e) {
    // 导航失败（站点结构变化等）时退化为沿用当前页面，不让本次执行整体失败
    console.warn('[MultiAI:tabManager] 重置会话失败，沿用当前页面', provider, e);
  }
}

async function createProviderTab(provider: ProviderName): Promise<number> {
  const url = getProviderUrl(provider);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      console.log('[MultiAI:tabManager] Creating new tab for', url, 'attempt', attempt + 1);
      const tab = await chrome.tabs.create({ url, active: false });
      if (!tab.id) throw new Error(`Failed to create tab for ${provider}`);
      console.log('[MultiAI:tabManager] Created tab', tab.id, 'for', provider);

      await waitForTabReady(tab.id);
      console.log('[MultiAI:tabManager] Tab', tab.id, 'ready, settling...');
      await sleep(TAB_SETTLE_MS);
      await ensureContentScriptReady(tab.id);
      console.log('[MultiAI:tabManager] Content script ready in tab', tab.id);
      return tab.id;
    } catch (e) {
      console.warn('[MultiAI:tabManager] attempt', attempt + 1, 'failed for', provider, ':', e);
    }
  }

  throw new Error(`无法为 ${provider} 准备好标签页（content script 未就绪）`);
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
