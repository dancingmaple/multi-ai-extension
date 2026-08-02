import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from './store';
import { ALL_PROVIDERS, PROVIDER_LABELS } from '../shared/constants';
import type { ProviderName, Turn, Answer, Conversation } from '../shared/types';
import styles from './Fullscreen.module.css';

const fmtTime = (ts: number): string => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};

const ProviderCard: React.FC<{
  provider: ProviderName;
  content: string;
  status: string;
  answer?: Answer;
  onCopy: () => void;
  onManual: () => void;
  onRetry: () => void;
  onRead: () => void;
}> = ({ provider, content, status, answer, onCopy, onManual, onRetry, onRead }) => {
  const isStreaming = status === 'streaming' || status === 'sending' || status === 'waiting';
  const isError = status === 'error' || status === 'login_required';
  return (
    <div className={`${styles.card} ${isError ? styles.cardError : ''}`}>
      <div className={styles.cardHead}>
        <span className={styles.cardName}>{PROVIDER_LABELS[provider]}</span>
        <span className={`${styles.dot} ${styles['dot_' + (isError ? 'err' : isStreaming ? 'live' : 'done')]}`} />
      </div>
      <div className={styles.cardBody}>
        {content ? (
          <pre className={styles.pre}>{content}</pre>
        ) : isStreaming ? (
          <div className={styles.empty}>思考中…</div>
        ) : (
          <div className={styles.empty}>（本轮未取得回答）</div>
        )}
        {isStreaming && <span className={styles.cursor}>|</span>}
      </div>
      <div className={styles.cardFoot}>
        <button className={styles.miniBtn} onClick={onCopy} disabled={!content}>
          复制
        </button>
        <button className={styles.miniBtn} onClick={onRead} disabled={!content}>
          阅读 ⤢
        </button>
        {answer?.source === 'manual' && <span className={styles.tagManual}>手动补录</span>}
        {isError && (
          <button className={styles.miniBtn} onClick={onRetry}>
            ↻ 重试
          </button>
        )}
        {(status !== 'done' || !answer) && !isError && (
          <button className={styles.miniBtn} onClick={onManual}>
            📥 手动抓取
          </button>
        )}
      </div>
    </div>
  );
};

const THEME_ICON: Record<string, string> = { light: '☀', dark: '🌙', auto: '🌗' };
const THEME_ORDER = ['light', 'dark', 'auto'] as const;

const Fullscreen: React.FC = () => {
  const conversation = useStore((s) => s.conversation);
  const selectedTurnId = useStore((s) => s.selectedTurnId);
  const conversations = useStore((s) => s.conversations);
  const task = useStore((s) => s.task);
  const prompt = useStore((s) => s.prompt);
  const setPrompt = useStore((s) => s.setPrompt);
  const selectedProviders = useStore((s) => s.selectedProviders);
  const toggleProvider = useStore((s) => s.toggleProvider);
  const isLoading = useStore((s) => s.isLoading);
  const toast = useStore((s) => s.toast);

  const newConversation = useStore((s) => s.newConversation);
  const openConversation = useStore((s) => s.openConversation);
  const renameCurrent = useStore((s) => s.renameCurrent);
  const deleteCurrent = useStore((s) => s.deleteCurrent);
  const selectTurn = useStore((s) => s.selectTurn);
  const sendTurn = useStore((s) => s.sendTurn);
  const manualGrabProvider = useStore((s) => s.manualGrabProvider);
  const retryProvider = useStore((s) => s.retryProvider);
  const manualGrabAllTurn = useStore((s) => s.manualGrabAllTurn);
  const exportMd = useStore((s) => s.exportMd);
  const switchPanelMode = useStore((s) => s.switchPanelMode);
  const listConversationsAction = useStore((s) => s.listConversationsAction);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const openReader = useStore((s) => s.openReader);

  const [drawer, setDrawer] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  useEffect(() => {
    setTitleDraft(conversation?.title ?? '');
  }, [conversation?.id, conversation?.title]);

  const turn: Turn | undefined = useMemo(() => {
    if (!conversation) return undefined;
    return conversation.turns.find((t) => t.id === selectedTurnId) ?? conversation.turns[conversation.turns.length - 1];
  }, [conversation, selectedTurnId]);

  const columns: ProviderName[] = useMemo(() => {
    if (!turn) return [];
    const fromTargets = turn.targets.filter((p) => ALL_PROVIDERS.includes(p));
    const fromAnswers = Object.keys(turn.answers) as ProviderName[];
    const set = new Set<ProviderName>([...fromTargets, ...fromAnswers]);
    return ALL_PROVIDERS.filter((p) => set.has(p));
  }, [turn]);

  const liveTask = task && turn && task.taskId === turn.id ? task : undefined;

  const handleSend = () => {
    sendTurn(prompt, selectedProviders);
    setPrompt('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={styles.root}>
      {/* 顶栏 */}
      <header className={styles.topbar}>
        <button className={styles.iconBtn} onClick={() => { setDrawer((v) => !v); listConversationsAction(); }} title="历史会话">
          ≡
        </button>
        <input
          className={styles.titleInput}
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => renameCurrent(titleDraft.trim() || '新对话')}
          placeholder="会话标题"
        />
        <div className={styles.spacer} />
        <button className={styles.iconBtn} onClick={() => exportMd('by-turn', 'download')} title="导出 Markdown（按轮）">
          ⤓ 按轮
        </button>
        <button className={styles.iconBtn} onClick={() => exportMd('by-provider', 'download')} title="导出 Markdown（按模型）">
          ⤓ 按模型
        </button>
        <button className={styles.iconBtn} onClick={() => newConversation()} title="新会话">
          ＋
        </button>
        <button
          className={styles.iconBtn}
          onClick={() => setTheme(THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length])}
          title={`主题：${theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统'}`}
        >
          {THEME_ICON[theme]}
        </button>
        <button className={styles.iconBtn} onClick={() => switchPanelMode()} title="回到侧边栏">
          ◧
        </button>
      </header>

      <div className={styles.body}>
        {/* 时间线 */}
        <aside className={styles.timeline}>
          {conversation?.turns.length ? (
            conversation.turns.map((t, i) => {
              const done = Object.values(t.answers).filter((a) => a?.status === 'done').length;
              const active = t.id === (turn?.id);
              return (
                <button
                  key={t.id}
                  className={`${styles.turnItem} ${active ? styles.turnActive : ''}`}
                  onClick={() => selectTurn(t.id)}
                >
                  <span className={styles.turnIdx}>轮 {i + 1}</span>
                  <span className={styles.turnPrompt}>{t.prompt}</span>
                  <span className={styles.turnMeta}>
                    {done}/{t.targets.length} · {fmtTime(t.createdAt)}
                  </span>
                </button>
              );
            })
          ) : (
            <div className={styles.empty}>还没有对话，下面发一条试试。</div>
          )}
        </aside>

        {/* 对照区 */}
        <main className={styles.compare}>
          {turn ? (
            <>
              <div className={styles.compareHead}>
                <span className={styles.turnLabel}>轮 {conversation!.turns.indexOf(turn) + 1} · {turn.prompt}</span>
                <button className={styles.btn} onClick={() => manualGrabAllTurn()} disabled={isLoading}>
                  📥 全部手动抓取
                </button>
              </div>
              <div
                className={styles.grid}
                style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(0, 1fr))` }}
              >
                {columns.map((p) => {
                  const live = liveTask?.providers[p];
                  const content = live?.content ?? turn.answers[p]?.content ?? '';
                  const status = live?.status ?? turn.answers[p]?.status ?? 'idle';
                  return (
                    <ProviderCard
                      key={p}
                      provider={p}
                      content={content}
                      status={status}
                      answer={turn.answers[p]}
                      onCopy={() => navigator.clipboard.writeText(content).catch(() => {})}
                      onManual={() => manualGrabProvider(p)}
                      onRetry={() => retryProvider(p)}
                      onRead={() => openReader(columns, columns.indexOf(p), turn?.id)}
                    />
                  );
                })}
              </div>
            </>
          ) : (
            <div className={styles.emptyCenter}>在下方输入框发起第一个问题，各家回答会并排展示在这里。</div>
          )}
        </main>
      </div>

      {/* 追问输入 */}
      <footer className={styles.compose}>
        <textarea
          className={styles.composeInput}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="继续问点什么…（⌘/Ctrl + Enter 发送）"
          rows={2}
        />
        <div className={styles.composeBar}>
          <div className={styles.chips}>
            {ALL_PROVIDERS.map((p) => (
              <label key={p} className={`${styles.chip} ${selectedProviders.includes(p) ? styles.chipOn : ''}`}>
                <input type="checkbox" checked={selectedProviders.includes(p)} onChange={() => toggleProvider(p)} />
                {PROVIDER_LABELS[p]}
              </label>
            ))}
          </div>
          <button className={styles.sendBtn} onClick={handleSend} disabled={isLoading || !prompt.trim() || selectedProviders.length === 0}>
            {isLoading ? '生成中…' : '发送 ▶'}
          </button>
        </div>
      </footer>

      {/* 历史抽屉 */}
      {drawer && (
        <div className={styles.drawer} onClick={() => setDrawer(false)}>
          <div className={styles.drawerInner} onClick={(e) => e.stopPropagation()}>
            <div className={styles.drawerHead}>历史会话</div>
            {conversations.map((c: Conversation) => (
              <div key={c.id} className={styles.drawerItem}>
                <button className={styles.drawerOpen} onClick={() => { openConversation(c.id); setDrawer(false); }}>
                  <span className={styles.drawerTitle}>{c.title}</span>
                  <span className={styles.drawerMeta}>{c.turns.length} 轮 · {fmtTime(c.updatedAt)}</span>
                </button>
                <button className={styles.drawerDel} onClick={() => deleteCurrent(c.id)} title="删除">
                  ✕
                </button>
              </div>
            ))}
            {conversations.length === 0 && <div className={styles.empty}>暂无历史会话</div>}
          </div>
        </div>
      )}

      {toast && <div className={styles.toast}>{toast}</div>}
    </div>
  );
};

export default Fullscreen;
