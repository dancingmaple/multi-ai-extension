import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { PROVIDER_LABELS } from '../../shared/constants';
import type { ProviderName } from '../../shared/types';
import { renderMarkdown } from '../../shared/markdown';
import styles from './AnswerModal.module.css';

const AnswerModal: React.FC = () => {
  const reader = useStore((s) => s.reader);
  const task = useStore((s) => s.task);
  const conversation = useStore((s) => s.conversation);
  const closeReader = useStore((s) => s.closeReader);
  const switchReader = useStore((s) => s.switchReader);

  const [hint, setHint] = useState(0); // 右键拖动视觉反馈位移
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);

  const provider: ProviderName | undefined = reader.providers[reader.index];

  const content = useMemo(() => {
    if (!provider) return '';
    if (reader.turnId && conversation) {
      const turn = conversation.turns.find((t) => t.id === reader.turnId);
      const a = turn?.answers[provider];
      if (a?.content) return a.content;
    }
    return task?.providers[provider]?.content ?? '';
  }, [provider, reader.turnId, conversation, task]);

  const isStreaming = useMemo(() => {
    if (!provider) return false;
    if (reader.turnId && conversation) {
      const turn = conversation.turns.find((t) => t.id === reader.turnId);
      if (turn?.answers[provider]?.status === 'done') return false;
    }
    const st = task?.providers[provider]?.status;
    return st === 'streaming' || st === 'sending' || st === 'waiting';
  }, [provider, reader.turnId, conversation, task]);

  // 键盘：← → 切换，Esc 关闭
  useEffect(() => {
    if (!reader.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeReader();
      else if (e.key === 'ArrowRight') switchReader(1);
      else if (e.key === 'ArrowLeft') switchReader(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reader.open, closeReader, switchReader]);

  if (!reader.open || !provider) return null;

  // 定位该 AI 原生回复页（对话记录里记录的地址）
  const sourceUrl: string | undefined = (() => {
    if (reader.turnId && conversation) {
      const turn = conversation.turns.find((t) => t.id === reader.turnId);
      const a = turn?.answers[provider];
      if (a?.url) return a.url;
    }
    return task?.providers[provider]?.url;
  })();

  // 流式期间每 token 重渲染，markdown 渲染较重 → 仅 content 变化时重算（#56）
  const html = useMemo(() => renderMarkdown(content), [content]);

  const onContextMenu = (e: React.MouseEvent) => e.preventDefault();

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) {
      e.preventDefault();
      setDragging(true);
      startX.current = e.clientX;
    }
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setHint(e.clientX - startX.current);
  };
  const endDrag = () => {
    if (!dragging) return;
    if (hint <= -40) switchReader(1);
    else if (hint >= 40) switchReader(-1);
    setDragging(false);
    setHint(0);
  };

  return (
    <div className={styles.overlay} onMouseUp={endDrag} onMouseLeave={endDrag}>
      <div
        className={styles.modal}
        onContextMenu={onContextMenu}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部：模型切换 + 关闭 */}
        <div className={styles.head}>
          <div className={styles.tabs}>
            {reader.providers.map((p, idx) => (
              <button
                key={p}
                className={`${styles.tab} ${idx === reader.index ? styles.tabOn : ''}`}
                onClick={() => useStore.setState({ reader: { ...reader, index: idx } })}
              >
                {PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>
          <button className={styles.close} onClick={closeReader} title="关闭 (Esc)">
            ✕
          </button>
        </div>

        {/* 阅读区 */}
        <div
          className={styles.stage}
          style={{ transform: hint ? `translateX(${hint * 0.25}px)` : undefined, transition: dragging ? 'none' : 'transform .2s' }}
        >
          <div className={styles.docHead}>
            <span className={styles.docName}>{PROVIDER_LABELS[provider]}</span>
            <span className={styles.docIdx}>
              {reader.index + 1} / {reader.providers.length}
            </span>
          </div>
          {content ? (
            <article
              className={`${styles.doc} markdown-body`}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : isStreaming ? (
            <div className={styles.placeholder}>生成中…</div>
          ) : (
            <div className={styles.placeholder}>（本轮未取得回答）</div>
          )}
          {isStreaming && <span className={styles.cursor}>|</span>}
        </div>

        {/* 底部操作 */}
        <div className={styles.foot}>
          <button className={styles.navBtn} onClick={() => switchReader(-1)} disabled={reader.providers.length < 2}>
            ← 上一个
          </button>
          <span className={styles.hint}>按住鼠标右键左右拖动切换 · ← → 键 · Esc 关闭</span>
          <button className={styles.navBtn} onClick={() => switchReader(1)} disabled={reader.providers.length < 2}>
            下一个 →
          </button>
          <button
            className={styles.copyBtn}
            onClick={() => navigator.clipboard.writeText(content).catch(() => {})}
            disabled={!content}
          >
            复制
          </button>
          {sourceUrl && (
            <button
              className={styles.copyBtn}
              onClick={() => chrome.tabs.create({ url: sourceUrl, active: true }).catch(() => {})}
              title="打开该 AI 的原生回复页"
            >
              原网页 ↗
            </button>
          )}
          <button
            className={styles.copyBtn}
            onClick={() => useStore.getState().exportMd('by-turn', 'download').catch(() => {})}
            disabled={!useStore.getState().conversationId}
            title="导出本轮对话为 Markdown"
          >
            导出 ⤓
          </button>
        </div>
      </div>
    </div>
  );
};

export default AnswerModal;
