import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { PROVIDER_LABELS, PROVIDER_URLS, EMBED_MSG } from '../shared/constants';
import { sendToBackground } from '../shared/messaging';
import type { ProviderName } from '../shared/types';
import { getProviderUrlAsync } from '../shared/providers';
import { useEffectiveProviders } from '../shared/useEffectiveProviders';
import styles from './WebView.module.css';

interface WebViewProps {
  layout?: 'columns' | 'stack';
}

const MIN_PX = 240;
const PONG_TIMEOUT_MS = 10000;
const STALL_TIMEOUT_MS = 25000;
const PING_INTERVAL_MS = 1500;
const GRAB_TIMEOUT_MS = 6000;

const STATUS_LABEL: Record<string, string> = {
  idle: '待发送',
  waiting: '排队中',
  sending: '发送中',
  streaming: '生成中',
  done: '已完成',
  error: '出错',
  login_required: '需登录',
};

type Note = { ok: boolean; text: string };

export const WebView: React.FC<WebViewProps> = ({ layout = 'columns' }) => {
  const conversation = useStore((s) => s.conversation);
  const selectedTurnId = useStore((s) => s.selectedTurnId);
  const embedSend = useStore((s) => s.embedSend);
  const task = useStore((s) => s.task);
  const selectedProviders = useStore((s) => s.selectedProviders);
  const setToast = useStore((s) => s.setToast);
  const openReader = useStore((s) => s.openReader);

  const frameRefs = useRef<Record<string, HTMLIFrameElement | null>>({});
  const frameReady = useRef<Record<string, boolean>>({});
  const pendingSend = useRef<Record<string, { prompt: string; taskId: string } | undefined>>({});
  const stallTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const embedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const grabTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const grabReq = useRef<Record<string, string | undefined>>({});

  const [errored, setErrored] = useState<Record<string, boolean>>({});
  const [readyMap, setReadyMap] = useState<Record<string, boolean>>({});
  const [stalledMap, setStalledMap] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, Note | undefined>>({});
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [maxProvider, setMaxProvider] = useState<ProviderName | null>(null);

  const turn = React.useMemo(() => {
    if (!conversation) return undefined;
    return (
      conversation.turns.find((t) => t.id === selectedTurnId) ??
      conversation.turns[conversation.turns.length - 1]
    );
  }, [conversation, selectedTurnId]);

  // 网页视图的 iframe 列直接跟随勾选，状态跟随当前 embed 任务
  const effective = useEffectiveProviders();
  const providers: ProviderName[] = React.useMemo(
    () => effective.map((e) => e.id).filter((p) => selectedProviders.includes(p)),
    [effective, selectedProviders]
  );

  // 内置 7 家 + 用户自定义 AI 节点的标签 / 地址解析（自定义节点地址在 storage，需异步取）
  const labelOf = (p: ProviderName) => effective.find((e) => e.id === p)?.label ?? PROVIDER_LABELS[p] ?? p;
  const allowIds = React.useMemo(() => new Set(effective.map((e) => e.id)), [effective]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void (async () => {
      const m: Record<string, string> = {};
      await Promise.all(
        providers.map(async (p) => {
          m[p] = await getProviderUrlAsync(p);
        })
      );
      if (alive) setUrls(m);
    })();
    return () => {
      alive = false;
    };
  }, [providers.join(',')]);
  const urlOf = (p: ProviderName) => urls[p] || PROVIDER_URLS[p] || '';

  const liveTask = React.useMemo(() => {
    if (!task) return undefined;
    const id = embedSend?.turnId ?? turn?.id;
    return id && task.taskId === id ? task : undefined;
  }, [task, embedSend, turn]);

  // 切换到历史记录时，各家优先打开当时保存的链接；没有链接则回退默认网页
  const historyUrls = useStore((s) => s.historyUrls);

  const setNote = useCallback((provider: ProviderName, note?: Note, autoHideMs?: number) => {
    setNotes((m) => ({ ...m, [provider]: note }));
    if (note && autoHideMs) {
      setTimeout(() => setNotes((m) => (m[provider] === note ? { ...m, [provider]: undefined } : m)), autoHideMs);
    }
  }, []);

  const postTo = useCallback((provider: ProviderName, prompt: string, taskId: string) => {
    const frame = frameRefs.current[provider];
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage({ __multiAi: EMBED_MSG.EXECUTE, provider, prompt, taskId }, '*');
    console.log('[MultiAI:WebView] EXECUTE sent to', provider);

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
      const first = !frameReady.current[provider];
      frameReady.current[provider] = true;
      if (first) {
        setReadyMap((m) => ({ ...m, [provider]: true }));
        setErrored((e) => (e[provider] ? { ...e, [provider]: false } : e));
        clearTimeout(embedTimers.current[provider]);
      }
      // 无论是否首次就绪，只要有待发任务就立即补发（修复首次发送被丢弃）
      const pending = pendingSend.current[provider];
      if (pending) {
        console.log('[MultiAI:WebView] Frame ready, flushing pending send for', provider);
        pendingSend.current[provider] = undefined;
        postTo(provider, pending.prompt, pending.taskId);
      }
    },
    [postTo]
  );

  /**
   * 只把「就绪」标记清掉，绝不清 pendingSend。
   * 之前的版本在 iframe onLoad 里顺手清了队列 —— 用户在网页还没加载完时点发送，
   * 排队的任务会被随后的 onLoad 抹掉，于是「第一次发送没反应，第二次才正常」。
   */
  const markNotReady = useCallback((provider: ProviderName) => {
    frameReady.current[provider] = false;
    setReadyMap((m) => ({ ...m, [provider]: false }));
  }, []);

  // 监听 iframe 内 content script 的 READY / PONG / GRAB_RESULT
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const data = ev.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object') return;

      // Kimi 受信任点击桥接：iframe 内的 Kimi 适配器算出发送钮在自身视口内的坐标，
      // 父窗口把 iframe 在 sidepanel 视口里的偏移加上去，得到绝对坐标，再让 background
      // 用 chrome.debugger 派发受信任点击（Kimi 只接受 isTrusted 事件）。
      if (data.__kimiSend === true && data.rect) {
        const frame = frameRefs.current['kimi'];
        if (frame) {
          const fr = frame.getBoundingClientRect();
          const r = data.rect as { left: number; top: number; width: number; height: number };
          const x = fr.left + r.left + r.width / 2;
          const y = fr.top + r.top + r.height / 2;
          sendToBackground({ type: 'TRUSTED_CLICK', x, y }).catch(() => {});
          // 侧边栏没有可被 chrome.debugger 调试的标签页，受信任点击实际无法生效；
          // 明确提示用户改用「测试台」或独立标签页发起 Kimi 请求。
          setToast('Kimi 发送需真实标签页（受信任点击），侧边栏暂不支持；请用「请求链路测试台」或独立标签页发起');
          setTimeout(() => setToast(undefined), 4000);
        }
        return;
      }

      const provider = data.provider as ProviderName | undefined;
      if (!provider || !allowIds.has(provider)) return;

      if (data.__multiAi === EMBED_MSG.PONG || data.__multiAi === EMBED_MSG.READY) {
        markReady(provider);
        return;
      }

      if (data.__multiAi === EMBED_MSG.GRAB_RESULT) {
        const reqId = data.reqId as string | undefined;
        if (grabReq.current[provider] !== reqId) return; // 过期响应
        grabReq.current[provider] = undefined;
        clearTimeout(grabTimers.current[provider]);

        const text = ((data.text as string) || '').trim();
        if (!text) {
          setNote(provider, {
            ok: false,
            text: `手动获取失败：${(data.reason as string) || '页面里没有读到回答文本'}`,
          });
          return;
        }

        const st = useStore.getState();
        const payload = st.embedSend;
        const turnId = payload?.turnId ?? st.selectedTurnId;
        const convId = st.conversationId;
        if (!turnId || !convId) {
          setNote(provider, { ok: false, text: '手动获取失败：当前没有可归档的对话轮次，请先发送一个问题' });
          return;
        }
        sendToBackground({
          type: 'EMBED_GRAB_SAVE',
          conversationId: convId,
          turnId,
          provider,
          prompt: payload?.prompt ?? '',
          text,
          method: data.method as string | undefined,
          url: data.url as string | undefined,
        })
          .then(() => {
            const how = data.method === 'scissor' ? '精确定位' : '兜底截取';
            setNote(provider, { ok: true, text: `手动获取成功（${how}，${text.length} 字）` }, 4000);
          })
          .catch((e: unknown) => {
            setNote(provider, {
              ok: false,
              text: '手动获取失败：写入会话出错 ' + (e instanceof Error ? e.message : String(e)),
            });
          });
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [markReady, setNote]);

  // 持续 PING 未就绪的 iframe，直到 content script 应答（脚本注入时机不可预测）
  useEffect(() => {
    const id = setInterval(() => {
      providers.forEach((p) => {
        if (!frameReady.current[p]) ping(p);
      });
    }, PING_INTERVAL_MS);
    return () => clearInterval(id);
  }, [providers, ping]);

  // 当发送载荷变化时，向已就绪 iframe 立即发送；未就绪的入队，就绪后自动补发
  useEffect(() => {
    if (!embedSend) return;
    const { prompt, targets, turnId } = embedSend;
    const queued: ProviderName[] = [];
    targets.forEach((provider) => {
      if (!providers.includes(provider)) return;
      setNote(provider, undefined);
      setStalledMap((m) => ({ ...m, [provider]: false }));
      if (frameReady.current[provider]) {
        postTo(provider, prompt, turnId);
      } else {
        pendingSend.current[provider] = { prompt, taskId: turnId };
        queued.push(provider);
        ping(provider);
      }
    });
      if (queued.length) {
        setToast(`${queued.map((p) => labelOf(p)).join('、')} 网页尚未就绪，就绪后会自动发送`);
      setTimeout(() => setToast(undefined), 3000);
    }
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

  const currentPayload = React.useMemo(
    () =>
      embedSend ??
      (turn ? { turnId: turn.id, prompt: turn.prompt, targets: turn.targets, nonce: 0 } : undefined),
    [embedSend, turn]
  );

  const resendProvider = (provider: ProviderName) => {
    if (!currentPayload) {
      setNote(provider, { ok: false, text: '还没有可重发的问题，请先在下方输入并发送' }, 4000);
      return;
    }
    pendingSend.current[provider] = { prompt: currentPayload.prompt, taskId: currentPayload.turnId };
    if (frameReady.current[provider]) {
      pendingSend.current[provider] = undefined;
      postTo(provider, currentPayload.prompt, currentPayload.turnId);
      setNote(provider, { ok: true, text: '已重发当前问题' }, 2500);
    } else {
      ping(provider);
      setNote(provider, { ok: true, text: '网页尚未就绪，已排队，就绪后自动发送' }, 4000);
    }
  };

  // 嵌入视图的手动获取：iframe 不是标签页，必须让 iframe 内脚本就地读屏后回传
  const manualGrabEmbed = (provider: ProviderName) => {
    if (!currentPayload) {
      setNote(provider, { ok: false, text: '手动获取失败：还没有发起过提问，无法定位要抓取哪一轮' }, 5000);
      return;
    }
    const frame = frameRefs.current[provider];
    if (!frame || !frame.contentWindow) {
      setNote(provider, { ok: false, text: '手动获取失败：网页还没加载出来' }, 5000);
      return;
    }
    const reqId = `${provider}_${Date.now()}`;
    grabReq.current[provider] = reqId;
    setNote(provider, { ok: true, text: '正在读取网页内容…' });
    frame.contentWindow.postMessage(
      { __multiAi: EMBED_MSG.GRAB, provider, prompt: currentPayload.prompt, reqId },
      '*'
    );
    clearTimeout(grabTimers.current[provider]);
    grabTimers.current[provider] = setTimeout(() => {
      if (grabReq.current[provider] !== reqId) return;
      grabReq.current[provider] = undefined;
      setNote(provider, {
        ok: false,
        text: '手动获取失败：网页没有响应读取请求——该站点很可能拒绝被嵌入，脚本没能注入。请点 ↗ 在标签页打开后再抓取',
      });
    }, GRAB_TIMEOUT_MS);
  };

  // 右上角「一键全部手动获取」：对当前所有可见网页逐个就地读屏并落库
  const manualGrabAllEmbed = () => {
    if (!currentPayload) {
      setToast('还没有可获取的提问，请先在下方输入并发送');
      return;
    }
    if (providers.length === 0) {
      setToast('请先勾选至少一家 AI');
      return;
    }
    setToast(`已对 ${providers.length} 家 AI 发起手动获取`);
    setTimeout(() => setToast(undefined), 3000);
    providers.forEach((p) => manualGrabEmbed(p));
  };

  const readProvider = (provider: ProviderName) => {
    openReader(providers, providers.indexOf(provider), currentPayload?.turnId);
  };

  const openInTab = (provider: ProviderName) => {
    const url = historyUrls?.[provider] ?? liveTask?.providers[provider]?.url ?? urlOf(provider);
    chrome.tabs.create({ url, active: true }).catch(() => {});
  };

  const reload = (provider: ProviderName) => {
    const frame = frameRefs.current[provider];
    if (frame) {
      setErrored((e) => ({ ...e, [provider]: false }));
      markNotReady(provider);
      // eslint-disable-next-line no-self-assign
      frame.src = frame.src;
    }
  };

  // ── 大屏查看：把该列变成覆盖全窗的 fixed 层。不移动 DOM，iframe 不会重载 ──
  const switchMax = useCallback(
    (dir: 1 | -1) => {
      setMaxProvider((cur) => {
        if (!cur) return cur;
        const i = providers.indexOf(cur);
        if (i < 0 || providers.length === 0) return cur;
        return providers[(i + dir + providers.length) % providers.length];
      });
    },
    [providers]
  );

  useEffect(() => {
    if (!maxProvider) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMaxProvider(null);
      else if (e.key === 'ArrowRight') switchMax(1);
      else if (e.key === 'ArrowLeft') switchMax(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [maxProvider, switchMax]);

  // 大屏模式下：在标题栏按住鼠标右键左右拖动切换（iframe 内部吞事件，故拖标题栏）
  const swipe = useRef<{ x: number } | null>(null);
  const onSwipeDown = (e: React.MouseEvent) => {
    if (e.button !== 2) return;
    e.preventDefault();
    swipe.current = { x: e.clientX };
  };
  const onSwipeUp = (e: React.MouseEvent) => {
    if (!swipe.current) return;
    const dx = e.clientX - swipe.current.x;
    swipe.current = null;
    if (dx <= -40) switchMax(1);
    else if (dx >= 40) switchMax(-1);
  };

  // 拖拽调整列宽（按 provider 记录宽度，支持任意数量的自定义节点）
  const dragging = useRef<{ left: ProviderName; right: ProviderName; startX: number; startWidths: Record<string, number> } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const onHandleDown = (left: ProviderName, right: ProviderName, e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = { left, right, startX: e.clientX, startWidths: { ...widths } };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current || layout !== 'columns') return;
      const { left, right, startX, startWidths } = dragging.current;
      const cw = containerRef.current.getBoundingClientRect().width;
      const dxPct = ((e.clientX - startX) / cw) * 100;
      const minPct = (MIN_PX / cw) * 100;
      const leftNew = Math.max(minPct, (startWidths[left] ?? minPct) + dxPct);
      const rightNew = Math.max(minPct, (startWidths[right] ?? minPct) - dxPct);
      if (leftNew >= minPct && rightNew >= minPct) {
        setWidths({ ...startWidths, [left]: leftNew, [right]: rightNew });
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
    setWidths(Object.fromEntries(providers.map((p) => [p, equal])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers.join(',')]);

  // 勾选变化后，若被大屏的那家已取消勾选则退出大屏
  useEffect(() => {
    if (maxProvider && !providers.includes(maxProvider)) setMaxProvider(null);
  }, [providers, maxProvider]);

  useEffect(() => {
    const stalls = stallTimers.current;
    const embeds = embedTimers.current;
    const grabs = grabTimers.current;
    return () => {
      Object.values(stalls).forEach(clearTimeout);
      Object.values(embeds).forEach(clearTimeout);
      Object.values(grabs).forEach(clearTimeout);
    };
  }, []);

  return (
    <div className={styles.webviewRoot}>
      <div className={styles.toolbar}>
        <span className={styles.toolbarInfo}>网页视图 · 已勾选 {providers.length} 家</span>
        <button
          className={styles.grabAllBtn}
          onClick={manualGrabAllEmbed}
          title="对当前所有可见网页逐个就地读取回答并保存"
        >
          📥 一键全部手动获取
        </button>
      </div>
      {providers.length === 0 ? (
        <div className={styles.empty}>请先在下方勾选至少一家 AI。</div>
      ) : (
        <div
          ref={containerRef}
          className={layout === 'columns' ? styles.container : styles.containerStack}
        >
          {maxProvider && <div className={styles.maxBackdrop} onClick={() => setMaxProvider(null)} />}

      {providers.map((provider, i) => {
        const status = liveTask?.providers[provider]?.status ?? 'idle';
        const isErr = status === 'error' || status === 'login_required';
        const isLive = status === 'streaming' || status === 'sending' || status === 'waiting';
        const ready = readyMap[provider];
        const stalled = stalledMap[provider];
        const note = notes[provider];
        const maximized = maxProvider === provider;
        const idx = providers.indexOf(provider);

        return (
          <React.Fragment key={provider}>
            {layout === 'columns' && i > 0 && (
              <div className={styles.handle} onMouseDown={(e) => onHandleDown(providers[i - 1], providers[i], e)}>
                <div className={styles.handleLine} />
              </div>
            )}
            <div
              className={`${styles.column} ${maximized ? styles.columnMax : ''}`}
              style={layout === 'columns' && !maximized ? { flexGrow: widths[provider] ?? (providers.length ? 1 / providers.length : 1) } : undefined}
            >
              <div
                className={styles.header}
                onMouseDown={maximized ? onSwipeDown : undefined}
                onMouseUp={maximized ? onSwipeUp : undefined}
                onContextMenu={maximized ? (e) => e.preventDefault() : undefined}
              >
                <span className={styles.label}>{labelOf(provider)}</span>
                {maximized && (
                  <span className={styles.maxIdx}>
                    {idx + 1} / {providers.length}
                  </span>
                )}
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
                  <button
                    className={styles.miniBtn}
                    onClick={() => manualGrabEmbed(provider)}
                    title="手动获取：就地读取这个网页当前的回答"
                  >
                    📥
                  </button>
                  <button
                    className={styles.miniBtn}
                    onClick={() => readProvider(provider)}
                    title="阅读：弹窗查看已获取的内容，可左右滑动切换"
                  >
                    📖
                  </button>
                  <button
                    className={styles.miniBtn}
                    onClick={() => setMaxProvider(maximized ? null : provider)}
                    title={maximized ? '退出大屏 (Esc)' : '大屏查看这个网页'}
                  >
                    {maximized ? '⤡' : '⛶'}
                  </button>
                  <button className={styles.miniBtn} onClick={() => resendProvider(provider)} title="重发当前问题到该网页">
                    ↻
                  </button>
                  <button className={styles.miniBtn} onClick={() => reload(provider)} title="重新加载网页">
                    ⟳
                  </button>
                  <button className={styles.miniBtn} onClick={() => openInTab(provider)} title="在浏览器标签页打开（部分站点禁止嵌入）">
                    ↗
                  </button>
                  {maximized && (
                    <button className={styles.miniBtn} onClick={() => setMaxProvider(null)} title="关闭大屏 (Esc)">
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {note && (
                <div className={note.ok ? styles.okTip : styles.errTip}>{note.text}</div>
              )}
              {errored[provider] && !note && (
                <div className={styles.errTip}>
                  该网页可能无法嵌入，请点 <b>↗</b> 在标签页打开。
                </div>
              )}
              {stalled && !note && (
                <div className={styles.stallTip}>
                  长时间未收到响应，可尝试 <b>↻</b> 重发、<b>📥</b> 手动获取，或 <b>↗</b> 在标签页打开。
                </div>
              )}

              <iframe
                ref={(el) => {
                  frameRefs.current[provider] = el;
                }}
                className={styles.iframe}
                src={historyUrls?.[provider] ?? liveTask?.providers[provider]?.url ?? urlOf(provider)}
                title={labelOf(provider)}
                onLoad={() => {
                  // 加载完不等于脚本已注入：标记未就绪并 ping，但保留待发队列
                  markNotReady(provider);
                  ping(provider);
                  clearTimeout(embedTimers.current[provider]);
                  embedTimers.current[provider] = setTimeout(() => {
                    if (!frameReady.current[provider]) {
                      setErrored((e) => ({ ...e, [provider]: true }));
                    }
                  }, PONG_TIMEOUT_MS);
                }}
                onError={() => setErrored((e) => ({ ...e, [provider]: true }))}
                allow="clipboard-read; clipboard-write; microphone; camera"
              />

              {maximized && providers.length > 1 && (
                <>
                  <button className={`${styles.swipeBtn} ${styles.swipeL}`} onClick={() => switchMax(-1)} title="上一个 (←)">
                    ‹
                  </button>
                  <button className={`${styles.swipeBtn} ${styles.swipeR}`} onClick={() => switchMax(1)} title="下一个 (→)">
                    ›
                  </button>
                </>
              )}
            </div>
          </React.Fragment>
        );
      })}
        </div>
      )}
    </div>
  );
};

export default WebView;
