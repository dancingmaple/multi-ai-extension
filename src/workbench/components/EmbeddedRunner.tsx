// ============================================================
// workbench/components/EmbeddedRunner.tsx
// 内嵌执行面板：为本工作流用到的每家 AI 常驻一个交互式 iframe（不 sandbox，
// 以让 content script 注入并执行）。节点运行时，workflowStore 通过 embedBridge
// 把 EXECUTE 指令 postMessage 给对应 iframe，结果流式回传并写回节点输出——
// 全程不开新标签页。面板作为右侧栏与画布并排（不遮挡），可折叠。
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { PROVIDER_LABELS, PROVIDER_URLS, EMBED_MSG } from '@shared/constants';
import type { ProviderName } from '@shared/types';
import { getProviderUrlAsync } from '@shared/providers';
import { useEffectiveProviders } from '@shared/useEffectiveProviders';
import { embedBridge } from '../embedBridge';
import { PanelIcon, CloseIcon, LinkIcon, EyeIcon, EyeSlashIcon } from './icons';

export function EmbeddedRunner(): JSX.Element {
  const embedOpen = useWorkflowStore((s) => s.embedOpen);
  const toggleEmbed = useWorkflowStore((s) => s.toggleEmbed);
  const preferEmbed = useWorkflowStore((s) => s.preferEmbed);
  const running = useWorkflowStore((s) => s.running);
  const nodes = useWorkflowStore((s) => s.nodes);

  // 用到哪些 provider：节点上勾选过的全部 provider（去重）
  const providers = useMemo<ProviderName[]>(() => {
    const set = new Set<ProviderName>();
    for (const n of nodes) for (const p of n.data.providers) set.add(p);
    return Array.from(set);
  }, [nodes]);

  const frameRefs = useRef<Record<string, HTMLIFrameElement | null>>({});
  const [readyMap, setReadyMap] = useState<Record<string, boolean>>({});
  const [loadedMap, setLoadedMap] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<ProviderName | null>(null);

  // 内置 7 家 + 用户自定义 AI 节点（地址缓存在 storage，需异步解析）
  const effective = useEffectiveProviders();
  const labelOf = (p: ProviderName) => effective.find((e) => e.id === p)?.label ?? PROVIDER_LABELS[p] ?? p;
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void (async () => {
      const m: Record<string, string> = {};
      await Promise.all(providers.map(async (p) => {
        m[p] = await getProviderUrlAsync(p);
      }));
      if (alive) setUrls(m);
    })();
    return () => {
      alive = false;
    };
  }, [providers.join(',')]);
  const urlOf = (p: ProviderName) => urls[p] || PROVIDER_URLS[p] || '';
  const originOf = (p: ProviderName): string => {
    try {
      const u = urlOf(p);
      return u ? new URL(u).origin : '';
    } catch {
      return '';
    }
  };

  // 统一路由 iframe 回传的 postMessage（含 PING/PONG/READY/EXECUTE_*/GRAB_RESULT）
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const data = ev.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object') return;
      if (data.__multiAi == null) return;
      // 安全校验：只接受来自已注册 iframe contentWindow 的消息，拒绝任意来源伪造
      const known = Object.values(frameRefs.current).some((f) => f?.contentWindow === ev.source);
      if (!known) return;
      if (data.__multiAi === EMBED_MSG.READY || data.__multiAi === EMBED_MSG.PONG) {
        const p = data.provider as ProviderName | undefined;
        if (p && providers.includes(p)) setReadyMap((m) => (m[p] ? m : { ...m, [p]: true }));
      }
      embedBridge.dispatch(data);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [providers]);

  // 运行节点时，自动把预览聚焦到当前正在执行的 provider，
  // 让用户实时看到该 AI 的执行过程，而不是面对空白面板。
  useEffect(() => {
    if (!running) return;
    const runningNode = nodes.find((n) => n.data.status === 'running');
    const active = runningNode?.data.providers[0];
    if (active && active !== preview) setPreview(active);
  }, [running, nodes, preview]);

  const openInNewTab = (p: ProviderName) => {
    const u = urlOf(p);
    if (u) chrome.tabs.create({ url: u, active: true }).catch(() => window.open(u, '_blank'));
  };

  return (
    <aside className={`wb-embed ${embedOpen ? '' : 'wb-embed--collapsed'}`}>
      <div className="wb-embed__header">
        <span>
          <PanelIcon size={15} />
          内嵌执行
          {preferEmbed ? (
            <span className="wb-embed__mode wb-embed__mode--on">· 优先内嵌</span>
          ) : (
            <span className="wb-embed__mode">· 标签页模式</span>
          )}
        </span>
        <button type="button" className="wb-embed__close" onClick={toggleEmbed} title="收起">
          <CloseIcon size={13} />
        </button>
      </div>

      <div className="wb-embed__body">
        {providers.length === 0 ? (
          <div className="wb-embed__hint">还没有节点勾选 AI 平台。给节点勾选平台后，这里会出现对应的内嵌执行窗口。</div>
        ) : (
          providers.map((p) => {
            const ready = readyMap[p];
            const loaded = loadedMap[p];
            const isPreview = preview === p;
            return (
              <div key={p} className="wb-embed__row">
                <div className="wb-embed__rowhead">
                  <span className={`wb-embed__dot ${ready ? 'is-ready' : ''}`} title={ready ? '脚本已就绪' : '加载中…'} />
                  <span className="wb-embed__name">{labelOf(p)}</span>
                  <span className="wb-embed__acts">
                    <button
                      type="button"
                      className="wb-embed__btn"
                      title="在浏览器新标签打开该 AI（回看/溯源）"
                      onClick={() => openInNewTab(p)}
                    >
                      <LinkIcon size={11} />
                    </button>
                    <button
                      type="button"
                      className="wb-embed__btn"
                      title="展开/收起内嵌预览"
                      onClick={() => setPreview((cur) => (cur === p ? null : p))}
                    >
                      {isPreview ? <EyeSlashIcon size={11} /> : <EyeIcon size={11} />}
                      {isPreview ? '收起' : '预览'}
                    </button>
                  </span>
                </div>

                {/* 始终挂载的执行 iframe：不 sandbox（需 content script 注入）。
                    折叠（非预览）态用 0 高度占位但仍在 DOM 中，保持脚本就绪与连接；
                    预览态展开为 340px。未就绪时叠加深色加载遮罩，避免白屏/空白页。 */}
                <div className={`wb-embed__framebox ${isPreview ? '' : 'wb-embed__framebox--collapsed'}`}>
                  <iframe
                    ref={(el) => {
                      frameRefs.current[p] = el;
                    }}
                    className={`wb-embed__frame ${isPreview ? 'is-open' : ''}`}
                    src={urlOf(p)}
                    title={labelOf(p)}
                    allow="clipboard-write"
                    onLoad={() => {
                      setLoadedMap((m) => ({ ...m, [p]: true }));
                      const w = frameRefs.current[p]?.contentWindow ?? null;
                      const o = originOf(p);
                      embedBridge.registerProvider(p, w, o);
                      try {
                        w?.postMessage({ __multiAi: EMBED_MSG.PING, provider: p }, o || '*');
                      } catch {
                        /* ignore */
                      }
                    }}
                  />
                  {isPreview && !ready && (
                    <div className="wb-embed__overlay">
                      <span className="wb-embed__spinner" />
                      <span>
                        {loaded
                          ? `${labelOf(p)} 可能无法在框架内显示`
                          : `正在加载 ${labelOf(p)}…`}
                      </span>
                      <button type="button" className="wb-embed__overlay-btn" onClick={() => openInNewTab(p)}>
                        在新标签页打开
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {running && (
          <div className="wb-embed__hint">
            执行中：指令正通过内嵌 iframe 下发，不再开新标签页。当前预览：
            {preview ? labelOf(preview) : '—'}
          </div>
        )}
      </div>
    </aside>
  );
}
