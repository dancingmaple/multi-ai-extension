import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './store';
import type { Turn, Conversation } from '../shared/types';
import { useEffectiveProviders } from '../shared/useEffectiveProviders';
import { PromptTemplateMenu } from '../shared/PromptTemplateMenu';
import WebView from './WebView';
import styles from './Fullscreen.module.css';
import { THEME_ICON, THEME_ORDER } from './theme';

const fmtTime = (ts: number): string => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};

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
  const exportMd = useStore((s) => s.exportMd);
  const switchPanelMode = useStore((s) => s.switchPanelMode);
  const listConversationsAction = useStore((s) => s.listConversationsAction);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const openReader = useStore((s) => s.openReader);
  const sendEmbed = useStore((s) => s.sendEmbed);
  const embedSend = useStore((s) => s.embedSend);

  const [drawer, setDrawer] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  const effective = useEffectiveProviders();

  useEffect(() => {
    setTitleDraft(conversation?.title ?? '');
  }, [conversation?.id, conversation?.title]);

  const turn: Turn | undefined = useMemo(() => {
    if (!conversation) return undefined;
    return conversation.turns.find((t) => t.id === selectedTurnId) ?? conversation.turns[conversation.turns.length - 1];
  }, [conversation, selectedTurnId]);

  const liveTask = task && turn && task.taskId === turn.id ? task : undefined;
  // 一键获取并查看：发送后全部完成时自动弹出阅读器
  const pendingAutoOpen = useRef<string | null>(null);

  const handleSend = () => {
    if (!prompt.trim() || selectedProviders.length === 0) return;
    sendEmbed(prompt, selectedProviders);
    setPrompt('');
  };

  // 记录本轮 turnId，等待自动打开阅读器
  useEffect(() => {
    if (embedSend) pendingAutoOpen.current = embedSend.turnId;
  }, [embedSend]);

  // 本轮全部 settle 后自动打开弹窗
  useEffect(() => {
    if (!pendingAutoOpen.current || !liveTask) return;
    if (liveTask.taskId !== pendingAutoOpen.current) return;
    const targets = embedSend?.targets ?? [];
    if (targets.length === 0) return;
    const settled = targets.every((p) => {
      const s = liveTask.providers[p]?.status;
      return s === 'done' || s === 'error' || s === 'login_required';
    });
    if (settled) {
      openReader(targets, 0, liveTask.taskId);
      pendingAutoOpen.current = null;
    }
  }, [liveTask, embedSend, openReader]);

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

        {/* 对照区：网页视图常驻 */}
        <main className={styles.compare}>
          <WebView layout="columns" />
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
            {effective.map((e) => {
              const p = e.id;
              return (
                <label key={p} className={`${styles.chip} ${selectedProviders.includes(p) ? styles.chipOn : ''}`}>
                  <input type="checkbox" checked={selectedProviders.includes(p)} onChange={() => toggleProvider(p)} />
                  {e.label}
                </label>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {/* 提示词模板：搜索/添加/一键填充（与侧边栏、测试台、工作台共用） */}
            <PromptTemplateMenu currentPrompt={prompt} onPick={(content) => setPrompt(content)} direction="up" />
            <button className={styles.sendBtn} onClick={handleSend} disabled={isLoading || !prompt.trim() || selectedProviders.length === 0}>
              {isLoading ? '获取中…' : '一键获取并查看 ▶'}
            </button>
          </div>
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
