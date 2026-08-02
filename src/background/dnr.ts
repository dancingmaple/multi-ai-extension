import { EMBED_HOSTS } from '../shared/constants';

// 嵌入视图依赖：许多 AI 站点会下发 X-Frame-Options / CSP: frame-ancestors
// 拒绝被 iframe 嵌套。这里用 declarativeNetRequest 在 sub_frame 响应上剥离这些
// 头，使插件页能把它们的网页直接嵌进 iframe 供用户查看 / 直接交互。
const RULE_PRIORITY = 1;

function buildRules(): chrome.declarativeNetRequest.Rule[] {
  return [
    {
      id: 1001,
      priority: RULE_PRIORITY,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'X-Frame-Options', operation: 'remove' },
          { header: 'Content-Security-Policy', operation: 'remove' },
        ],
      },
      condition: {
        resourceTypes: ['sub_frame'],
        requestDomains: EMBED_HOSTS,
      },
    } as chrome.declarativeNetRequest.Rule,
  ];
}

export function installEmbedRules(): void {
  const rules = buildRules();
  chrome.declarativeNetRequest
    .updateDynamicRules({
      removeRuleIds: rules.map((r) => r.id),
      addRules: rules,
    })
    .then(() => {
      console.log('[MultiAI:dnr] embed header-strip rules installed for', EMBED_HOSTS.join(', '));
    })
    .catch((e) => {
      console.error('[MultiAI:dnr] failed to install rules:', e);
    });
}
