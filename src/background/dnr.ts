import { EMBED_HOSTS } from '../shared/constants';

// 嵌入视图依赖：许多 AI 站点会下发 X-Frame-Options / CSP: frame-ancestors
// 拒绝被 iframe 嵌套。这里用 declarativeNetRequest 在 sub_frame 响应上剥离这些
// 头，使插件页能把它们的网页直接嵌进 iframe 供用户查看 / 直接交互。
const RULE_PRIORITY = 1;

/*
 * ⚠️ 安全风险说明（#44）
 * ────────────────────────────────────────────────────────────
 * declarativeNetRequest 只能整条移除响应头，无法只删 CSP 里的
 * frame-ancestors 指令。为了让 AI 站点能被 iframe 嵌入，这里不得不
 * 整条移除 Content-Security-Policy —— 代价是该站点在嵌入视图内
 * 同时失去 script-src / connect-src 等 XSS 防护。
 *
 * 收敛措施：
 * 1) 作用域严格限制在 sub_frame + EMBED_HOSTS（本扩展支持的 AI 站点），
 *    顶层导航（main_frame）与其它域名完全不受影响；
 * 2) 拆成两条规则：XFO 一条、CSP 一条。多数站点仅靠 XFO 拦截嵌套，
 *    将来确认某站点无需动 CSP 时，可单独把它从 CSP 规则里摘掉；
 * 3) 不动 Content-Security-Policy-Report-Only，保留站点的违规上报。
 */
const XFO_RULE_ID = 1001;
const CSP_RULE_ID = 1002;

function buildRules(): chrome.declarativeNetRequest.Rule[] {
  const condition = {
    resourceTypes: ['sub_frame'],
    requestDomains: EMBED_HOSTS,
  } as chrome.declarativeNetRequest.RuleCondition;

  return [
    {
      id: XFO_RULE_ID,
      priority: RULE_PRIORITY,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [{ header: 'X-Frame-Options', operation: 'remove' }],
      },
      condition,
    } as chrome.declarativeNetRequest.Rule,
    {
      id: CSP_RULE_ID,
      priority: RULE_PRIORITY,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [{ header: 'Content-Security-Policy', operation: 'remove' }],
      },
      condition,
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
