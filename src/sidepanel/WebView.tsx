import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { ALL_PROVIDERS, PROVIDER_LABELS, PROVIDER_URLS, EMBED_MSG } from '../shared/constants';
import type { ProviderName } from '../shared/types';
import styles from './WebView.module.css';

interface WebViewProps {
  layout?: 'columns' | 'stack';
}

const MIN_PX = 240;
const PONG_TIMEOUT_MS = 8000;
const STALL_TIMEOUT_MS = 20000;

const STATUS_LABEL: Record<string, string> = {
  idle: '待发送',
  waiting: '排队中',
  sending: '发送中',
  streaming: '生成中',
  done: '已完成',
  error: '出错',
  login_required: '需登录',
};

export const WebView: React.FC<WebViewProps> = ({ layout = 'columns' }) => {
  const conversation = useStore((s) => s.conversation);
  const selectedTurnId = useStore((s) => s.selectedTurnId);
  const embedSend = useStore((s) => s.embedSend);
  const task = useStore((s) => s.task);
  const selectedProviders = useStore((s) => s.selectedProviders);
  const setToast = useStore((s) => s.setToast);

  const frameRefs = useRef<Record<string, HTMLIFrameElement | null>>({});
  const frameReady = useRef<Record<string, boolean>>({});
  const pendingSend = useRef<Record<string, { prompt: string; taskId: string } | undefined>>({});
  const pingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const stallTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const [errored, setErrored] = useState<Record<string, boolean>>({});
  const [readyMap, setReadyMap] = useState<Record<string, boolean>>({});
  const [stalledMap, setStalledMap] = useState<Record<string, boolean>>({});
  const [widths, setWidths] = useState<number[]>(() => ALL_PROVIDERS.map(() => 1));

  const turn = React.useMemo(() => {
    if (!conversation) return undefined;
    return (
      conversation.turns.find((t) => t.id === selectedTurnId) ??
      conversation.turns[conversation.turns.length - 1]
    );
  }, [conversation, selectedTurnId]);

  const providers: ProviderName[] = React.useMemo(() => {
    const base = turn ? turn.targets : selectedProviders;
    return ALL_PROVIDERS.filter((p) => base.includes(p));
  }, [turn, selectedProviders]);

  const liveTask = task && turn && task.taskId === turn.id ? task : undefined;

  const postTo = useCallback((provider: ProviderName, prompt: string, taskId: string) => {
    const frame = frameRefs.current[provider];
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage(
      { __multiAi: EMBED_MSG.EXECUTE, provider, prompt, taskId },
      '*'
    );
    console.log('[MultiAI:WebView] EXECUTE sent to', provider);

    // 启动 stall 检测：若发送后长时间无状态更新，提示用户
    clearTimeout(stallTimers.current[provider]);
    stallTimers.current[provider] = setTimeout(() => {
      setStalledMap((m) => ({ ...m, [provider]: true }));
    }, STALL_TIMEOUT_MS);
  }, []);

  const ping = useCallback((provider: ProviderName) => {
    const frame = frameRefs.current[provider];
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage({ __multiAi: EMBED_MSG.PING, provider }, '*');
  }, []);

  const markReady = useCallback(
    (provider: ProviderName) => {
      if (frameReady.current[provider]) return;
      frameReady.current[provider] = true;
      setReadyMap((m) => ({ ...m, [provider]: true }));
      setStalledMap((m) => ({ ...m, [provider]: false }));
      clearTimeout(pingTimers.current[provider]);

      const pending = pendingSend.current[provider];
      if (pending) {
        console.log('[MultiAI:WebView] Frame ready, flushing pending send for', provider);
        pendingSend.current[provider] = undefined;
        postTo(provider, pending.prompt, pending.taskId);
      }
    },
    [postTo]
  );

  const markNotReady = useCallback((provider: ProviderName) => {
    frameReady.current[provider] = false;
    setReadyMap((m) => ({ ...m, [provider]: false }));
    pendingSend.current[provider] = undefined;
  }, []);

  // 监听 iframe 内 content script 的 PONG
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const data = ev.data as Record<string, unknown> | null;
      if (!data || data.__multiAi !== EMBED_MSG.PONG) return;
      const provider = data.provider as ProviderName | undefined;
      if (provider && providers.includes(provider)) {
        markReady(provider);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [providers, markReady]);

  // 当发送载荷变化时，向已就绪 iframe 立即发送；未就绪的加入队列并 ping
  useEffect(() => {
    if (!embedSend) return;
    const { prompt, targets, turnId } = embedSend;
    targets.forEach((provider) => {
      if (!providers.includes(provider)) return;
      if (frameReady.current[provider]) {
        postTo(provider, prompt, turnId);
      } else {
        console.log('[MultiAI:WebView] Frame not ready yet, queueing', provider);
        pendingSend.current[provider] = { prompt, taskId: turnId };
        ping(provider);
        clearTimeout(pingTimers.current[provider]);
        pingTimers.current[provider] = setTimeout(() => {
          if (!frameReady.current[provider]) ping(provider);
        }, 1500);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedSend]);

  // 当 provider 状态变化时，清除 stall 标记
  useEffect(() => {
    if (!liveTask) return;
    providers.forEach((p) => {
      const s = liveTask.providers[p]?.status;
      if (s && s !== 'waiting' && s !== 'idle') {
        clearTimeout(stallTimers.current[p]);
        if (stalledMap[p]) setStalledMap((m) => ({ ...m, [p]: false }));
      }
    });
  }, [liveTask, providers, stalledMap]);

  const resendProvider = (provider: ProviderName) => {
    const payload = embedSend ?? (turn ? { turnId: turn.id, prompt: turn.prompt, targets: turn.targets, nonce: 0 } : undefined);
    if (!payload) {
      setToast('没有可重发的轮次');
      return;
    }
    pendingSend.current[provider] = { prompt: payload.prompt, taskId: payload.turnId };
    markNotReady(provider);
    ping(provider);
    clearTimeout(pingTimers.current[provider]);
    pingTimers.current[provider] = setTimeout(() => {
      if (!frameReady.current[provider]) ping(provider);
    }, 1500);
    setToast(`已向 ${PROVIDER_LABELS[provider]} 重发当前问题`);
    setTimeout(() => setToast(undefined), 1800);
  };

  const openInTab = (provider: ProviderName) => {
    chrome.tabs.create({ url: PROVIDER_URLS[provider], active: true }).catch(() => {});
  };

  const reload = (provider: ProviderName) => {
    const frame = frameRefs.current[provider];
    if (frame) {
      setErrored((e) => ({ ...e, [provider]: false }));
      markNotReady(provider);
      frame.src = frame.src;
    }
  };

  // 拖拽调整列宽
  const dragging = useRef<{ index: number; startX: number; startWidths: number[] } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const onHandleDown = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = { index, startX: e.clientX, startWidths: [...widths] };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current || layout !== 'columns') return;
      const { index, startX, startWidths } = dragging.current;
      const cw = containerRef.current.getBoundingClientRect().width;
      const dxPct = ((e.clientX - startX) / cw) * 100;
      const next = [...startWidths];
      const left = index;
      const right = index + 1;
      const minPct = (MIN_PX / cw) * 100;
      const leftNew = Math.max(minPct, startWidths[left] + dxPct);
      const rightNew = Math.max(minPct, startWidths[right] - dxPct);
      if (leftNew >= minPct && rightNew >= minPct) {
        next[left] = leftNew;
        next[right] = rightNew;
        setWidths(next);
      }
    };
    const onUp = () => {
      dragging.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [widths, layout]);

  useEffect(() => {
    const equal = providers.length ? 1 / providers.length : 1;
    setWidths(ALL_PROVIDERS.map((p) => (providers.includes(p) ? equal : 0)));
  }, [providers.join(',')]);

  // 清理定时器
  useEffect(() => {
    return () => {
      Object.values(pingTimers.current).forEach(clearTimeout);
      Object.values(stallTimers.current).forEach(clearTimeout);
    };
  }, []);

  if (providers.length === 0) {
    return <div className={styles.empty}>请先在下方勾选至少一家 AI。</div>;
  }

  return (
    <div
      ref={containerRef}
      className={layout === 'columns' ? styles.container : styles.containerStack}
    >
      {ALL_PROVIDERS.map((provider, i) => {
        if (!providers.includes(provider)) return <React.Fragment key={provider} />;
        const status = liveTask?.providers[provider]?.status ?? 'idle';
        const isErr = status === 'error' || status === 'login_required';
        const isLive = status === 'streaming' || status === 'sending' || status === 'waiting';
        const ready = readyMap[provider];
        const stalled = stalledMap[provider];

        return (
          <React.Fragment key={provider}>
            {layout === 'columns' && i > 0 && providers.includes(ALL_PROVIDERS[i - 1]) && (
              <div className={styles.handle} onMouseDown={(e) => onHandleDown(i - 1, e)}>
                <div className={styles.handleLine} />
              </div>
            )}
            <div
              className={styles.column}
              style={layout === 'columns' ? { flexGrow: widths[i] } : undefined}
            >
              <div className={styles.header}>
                <span className={styles.label}>{PROVIDER_LABELS[provider]}</span>
                <span
                  className={`${styles.dot} ${styles['dot_' + (isErr ? 'err' : isLive ? 'live' : status === 'done' ? 'done' : 'idle')]}`}
                  title={STATUS_LABEL[status] ?? status}
                />
                <span className={styles.statusText}>
                  {stalled ? '无响应' : STATUS_LABEL[status] ?? status}
                </span>
                {!ready && status !== 'done' && status !== 'error' && (
                  <span className={styles.readyBadge}>未就绪</span>
                )}
                <div className={styles.headerActions}>
                  <button className={styles.miniBtn} onClick={() => resendProvider(provider)} title="重发当前问题到该网页">
                    ↻
                  </button>
                  <button className={styles.miniBtn} onClick={() => reload(provider)} title="重新加载网页">
                    ⟳
                  </button>
                  <button className={styles.miniBtn} onClick={() => openInTab(provider)} title="在浏览器标签页打开（部分站点禁止嵌入）">
                    ↗
                  </button>
                </div>
              </div>
              {errored[provider] && (
                <div className={styles.errTip}>
                  该网页可能无法嵌入，请点 <b>↗</b> 在标签页打开。
                </div>
              )}
              {stalled && (
                <div className={styles.stallTip}>
                  长时间未收到响应，可尝试 <b>↻</b> 重发或 <b>↗</b> 在标签页打开。
                </div>
              )}
              <iframe
                ref={(el) => {
                  frameRefs.current[provider] = el;
                }}
                className={styles.iframe}
                src={PROVIDER_URLS[provider]}
                title={PROVIDER_LABELS[provider]}
                onLoad={() => {
                  // iframe 加载完成不代表 content script 已就绪，先标记未就绪并 ping
                  markNotReady(provider);
                  ping(provider);
                  clearTimeout(pingTimers.current[provider]);
                  pingTimers.current[provider] = setTimeout(() => {
                    if (!frameReady.current[provider]) ping(provider);
                  }, 1500);
                  // 若最终仍无 PONG，标记为嵌入异常
                  clearTimeout(pingTimers.current[`${provider}_timeout`]);
                  pingTimers.current[`${provider}_timeout`] = setTimeout(() => {
                    if (!frameReady.current[provider]) {
                      setErrored((e) => ({ ...e, [provider]: true }));
                    }
                  }, PONG_TIMEOUT_MS);
                }}
                onError={() => setErrored((e) => ({ ...e, [provider]: true }))}
                allow="clipboard-read; clipboard-write; microphone; camera"
              />
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default WebView;
