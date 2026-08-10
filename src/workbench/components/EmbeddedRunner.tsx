// ============================================================
// workbench/components/EmbeddedRunner.tsx
// 内嵌执行面板：为本工作流用到的每家 AI 常驻一个交互式 iframe（不 sandbox，
// 以让 content script 注入并执行）。节点运行时，workflowStore 通过 embedBridge
// 把 EXECUTE 指令 postMessage 给对应 iframe，结果流式回传并写回节点输出——
// 全程不开新标签页。面板可折叠（折叠仅隐藏 UI，iframe 仍挂载以保持就绪）。
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

  // 统一路由 iframe 回传的 postMessage（含 PING/PONG/READY/EXECUTE_*/GRAB_RESULT）
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const data = ev.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object') return;
      if (data.__multiAi === EMBED_MSG.READY || data.__multiAi === EMBED_MSG.PONG) {
        const p = data.provider as ProviderName | undefined;
        if (p && providers.includes(p)) setReadyMap((m) => (m[p] ? m : { ...m, [p]: true }));
      }
      embedBridge.dispatch(data);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [providers]);

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
                      onClick={() =>
                        chrome.tabs.create({ url: urlOf(p), active: true }).catch(() => window.open(urlOf(p), '_blank'))
                      }
                    >
                      <LinkIcon size={11} />
                    </button>
                    <button
                      type="button"
                      className="wb-embed__btn"
                      title="展开/收起内嵌预览"
                      onClick={() => setPreview((cur) => (cur === p ? null : p))}
                    >
                      {preview === p ? <EyeSlashIcon size={11} /> : <EyeIcon size={11} />}
                      {preview === p ? '收起' : '预览'}
                    </button>
                  </span>
                </div>

                {/* 始终挂载的执行 iframe：不 sandbox（需 content script 注入）。
                    折叠（非预览）态用 0 高度占位但仍在 DOM 中，保持脚本就绪与连接。 */}
                <iframe
                  ref={(el) => {
                    frameRefs.current[p] = el;
                  }}
                  className={`wb-embed__frame ${preview === p ? 'is-open' : ''}`}
                  src={urlOf(p)}
                  title={labelOf(p)}
                  allow="clipboard-read; clipboard-write; microphone; camera"
                  onLoad={() => {
                    const w = frameRefs.current[p]?.contentWindow ?? null;
                    embedBridge.registerProvider(p, w);
                    try {
                      w?.postMessage({ __multiAi: EMBED_MSG.PING, provider: p }, '*');
                    } catch {
                      /* ignore */
                    }
                  }}
                />
              </div>
            );
          })
        )}

        {running && <div className="wb-embed__hint">执行中：指令正通过内嵌 iframe 下发，不再开新标签页。</div>}
      </div>
    </aside>
  );
}
