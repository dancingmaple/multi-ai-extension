// ============================================================
// workbench/components/SessionDock.tsx
// 会话坞：把各节点的 AI 会话「停靠」在工作台侧边，按节点分组，
// 免于在浏览器一堆 tab 里翻找。支持：
//  - 聚焦标签页：直接把对应 AI 的浏览器标签页切到前台
//  - 在浏览器打开：新标签打开该会话链接（回看/溯源，取标签页实时地址，绝不拿旧页面）
//  - 内嵌预览：尽力而为的 iframe 预览（多数 AI 站点设了 X-Frame-Options 会拒绝内嵌，
//    此时以「聚焦 / 打开」为主，预览区会提示改用浏览器打开）
// 每个节点持有「专属标签页」（后台 (nodeId,provider)->tabId 登记表），故预览/打开/聚焦
// 都精确定位到该节点当前的那一张，不会串台也不会拿到上一个任务的页面。
// ============================================================
import { useEffect, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { PROVIDER_LABELS } from '@shared/constants';
import type { ProviderName } from '@shared/types';
import type { WorkbenchNodeData } from '../store/workflowStore';

/** 把对应 AI 的浏览器标签页切到前台 */
async function focusTab(tabId?: number): Promise<void> {
  if (tabId === undefined) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch {
    /* 标签页已被关闭 */
  }
}

/** 取标签页实时地址（比节点里存的 url 更准，避免拿到旧任务的页面）；失败则用兜底 url */
async function liveUrlOf(tabId: number | undefined, fallback?: string): Promise<string | undefined> {
  if (tabId !== undefined) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t?.url) return t.url;
    } catch {
      /* 标签已关闭 */
    }
  }
  return fallback;
}

/** 新标签打开会话链接（用实时地址） */
async function openLiveUrl(tabId: number | undefined, fallback?: string): Promise<void> {
  const url = await liveUrlOf(tabId, fallback);
  if (!url) return;
  chrome.tabs.create({ url, active: true }).catch(() => window.open(url, '_blank'));
}

function NodeSessions({ data }: { data: WorkbenchNodeData }): JSX.Element {
  const [preview, setPreview] = useState<ProviderName | null>(null);
  // 预览展开时实时拉取该 tab 的当前地址，确保看到的就是「最新那次」的会话
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    if (preview) {
      const tabId = data.tabIds?.[preview];
      const fallback = data.urls?.[preview];
      void liveUrlOf(tabId, fallback).then((u) => {
        if (alive) setPreviewUrl(u);
      });
    } else {
      setPreviewUrl(undefined);
    }
    return () => {
      alive = false;
    };
  }, [preview, data.tabIds, data.urls]);

  return (
    <div className="dock-node">
      <div className="dock-node__title">
        {data.label}
        {data.varName && <span className="dock-node__var">（{data.varName}）</span>}
      </div>
      <div className="dock-node__list">
        {data.providers.map((p) => {
          const tabId = data.tabIds?.[p];
          const url = data.urls?.[p];
          const answered = !!(data.outputs[p] && data.outputs[p]!.length > 0);
          return (
            <div key={p} className="dock-row">
              <div className="dock-row__head">
                <span className={`dock-row__name ${answered ? 'is-ok' : ''}`}>{PROVIDER_LABELS[p]}</span>
                {url || tabId !== undefined ? (
                  <span className="dock-row__acts">
                    <button
                      type="button"
                      className="dock-btn"
                      title="把该 AI 的浏览器标签页切到前台"
                      onClick={() => void focusTab(tabId)}
                      disabled={tabId === undefined}
                    >
                      聚焦
                    </button>
                    <button
                      type="button"
                      className="dock-btn"
                      title="新标签打开会话（取实时地址）"
                      onClick={() => void openLiveUrl(tabId, url)}
                    >
                      打开
                    </button>
                    <button
                      type="button"
                      className="dock-btn"
                      title="内嵌预览（部分站点禁止内嵌）"
                      onClick={() => setPreview((cur) => (cur === p ? null : p))}
                    >
                      {preview === p ? '收起' : '预览'}
                    </button>
                  </span>
                ) : (
                  <span className="dock-row__none">未运行</span>
                )}
              </div>
              {preview === p && (
                <div className="dock-preview">
                  {previewUrl ? (
                    <iframe
                      className="dock-preview__frame"
                      src={previewUrl}
                      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                    />
                  ) : (
                    <div className="dock-preview__hint">无法读取该标签页地址（可能已关闭）。</div>
                  )}
                  <div className="dock-preview__hint">
                    若空白：该站点禁止 iframe 内嵌（X-Frame-Options），请点「打开」在浏览器查看最新会话。
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SessionDock(): JSX.Element {
  const nodes = useWorkflowStore((s) => s.nodes);
  const dockOpen = useWorkflowStore((s) => s.dockOpen);
  const toggleDock = useWorkflowStore((s) => s.toggleDock);

  if (!dockOpen) return <></>;

  const usable = nodes.filter(
    (n) => n.data.providers.length > 0 && (n.data.tabIds || n.data.urls || n.data.status !== 'idle')
  );

  return (
    <aside className="wb-dock">
      <div className="wb-dock__header">
        <span>🖥 会话坞（按节点分组）</span>
        <button type="button" className="wb-dock__close" onClick={toggleDock} title="收起">
          ✕
        </button>
      </div>
      <div className="wb-dock__body">
        {usable.length === 0 ? (
          <div className="wb-dock__empty">
            还没有任何节点运行过 AI。运行带 AI 平台的节点后，这里会按节点列出各家会话，
            可直接「聚焦」或「打开」对应标签页。
          </div>
        ) : (
          usable.map((n) => <NodeSessions key={n.id} data={n.data} />)
        )}
      </div>
    </aside>
  );
}
