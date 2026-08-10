import { loadCustomProviders } from '../shared/customProviders';

/**
 * 用户自定义 AI 网页的运行时启用。
 *
 * 内置 7 家在 manifest 里写死了 host_permissions / content_scripts，
 * 自定义网页只能在运行时按需开通三件事：
 *   1. 主机权限（optional_host_permissions: *://*\/* → 用户点选时申请）
 *   2. 动态注册 content script（否则 iframe 内没有脚本，postMessage 通路不通）
 *   3. 动态 DNR 规则剥离 X-Frame-Options / CSP（否则网页拒绝被 iframe 嵌套）
 */

const CUSTOM_DNR_RULE_ID = 1002;
const CUSTOM_CS_ID = 'multiai-custom-sites';

/** 从 manifest 里取内置 content script 的产物路径（构建后带 hash，只能运行时读） */
function contentScriptFiles(): string[] {
  try {
    const m = chrome.runtime.getManifest();
    const cs = m.content_scripts?.[0]?.js ?? [];
    return [...cs];
  } catch {
    return [];
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** 已授权的自定义站点 origin（未授权的跳过，避免 register 整体失败） */
async function grantedOrigins(urls: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const u of urls) {
    const o = originOf(u);
    if (!o) continue;
    const has = await chrome.permissions
      .contains({ origins: [o + '/*'] })
      .catch(() => false);
    if (has) out.push(o);
  }
  return [...new Set(out)];
}

/** 读取全部自定义节点，同步 DNR 规则 + 动态 content script 注册 */
export async function syncCustomSites(): Promise<{ origins: string[]; hosts: string[] }> {
  const map = await loadCustomProviders();
  const urls = Object.values(map).map((c) => c.url).filter(Boolean);
  const origins = await grantedOrigins(urls);
  const hosts = [...new Set(origins.map((o) => hostOf(o)).filter((h): h is string => !!h))];

  // ── 1. DNR：剥离 sub_frame 的 XFO / CSP ──
  try {
    const addRules: chrome.declarativeNetRequest.Rule[] = hosts.length
      ? [
          {
            id: CUSTOM_DNR_RULE_ID,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              responseHeaders: [
                { header: 'X-Frame-Options', operation: 'remove' },
                { header: 'Content-Security-Policy', operation: 'remove' },
              ],
            },
            condition: { resourceTypes: ['sub_frame'], requestDomains: hosts },
          } as chrome.declarativeNetRequest.Rule,
        ]
      : [];
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [CUSTOM_DNR_RULE_ID],
      addRules,
    });
  } catch (e) {
    console.warn('[MultiAI:customSite] DNR sync failed:', e);
  }

  // ── 2. 动态 content script ──
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CUSTOM_CS_ID] }).catch(() => []);
    if (existing.length) {
      await chrome.scripting.unregisterContentScripts({ ids: [CUSTOM_CS_ID] }).catch(() => {});
    }
    const js = contentScriptFiles();
    if (origins.length && js.length) {
      await chrome.scripting.registerContentScripts([
        {
          id: CUSTOM_CS_ID,
          matches: origins.map((o) => o + '/*'),
          js,
          runAt: 'document_end',
          allFrames: true,
          world: 'ISOLATED',
        },
      ]);
      console.log('[MultiAI:customSite] content script registered for', origins.join(', '));
    } else if (!js.length) {
      console.warn('[MultiAI:customSite] 无法从 manifest 解析 content script 路径，跳过注册');
    }
  } catch (e) {
    console.warn('[MultiAI:customSite] registerContentScripts failed:', e);
  }

  return { origins, hosts };
}

/** 启动时同步一次；storage 变更时自动重同步 */
export function setupCustomSites(): void {
  syncCustomSites().catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!Object.prototype.hasOwnProperty.call(changes, 'multiAI.customProviders')) return;
    syncCustomSites().catch(() => {});
  });
  chrome.permissions.onAdded.addListener(() => {
    syncCustomSites().catch(() => {});
  });
  chrome.permissions.onRemoved.addListener(() => {
    syncCustomSites().catch(() => {});
  });
}
