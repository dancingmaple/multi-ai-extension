import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import type { HistoryEntry, ProviderName } from '../../shared/types';
import { ALL_PROVIDERS } from '../../shared/constants';
import styles from './HistoryList.module.css';

const PROVIDER_LINKS: Record<ProviderName, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  zai: 'Z.AI',
  doubao: 'Doubao',
  kimi: 'Kimi',
};

const HistoryList: React.FC = () => {
  const history = useStore((s) => s.history);
  const search = useStore((s) => s.historySearch);
  const setSearch = useStore((s) => s.setHistorySearch);
  const tagFilter = useStore((s) => s.historyTagFilter);
  const setTagFilter = useStore((s) => s.setHistoryTagFilter);
  const setShowHistoryList = useStore((s) => s.setShowHistoryList);
  const deleteHistoryItem = useStore((s) => s.deleteHistoryItem);
  const addHistoryTag = useStore((s) => s.addHistoryTag);
  const removeHistoryTag = useStore((s) => s.removeHistoryTag);
  const openHistory = useStore((s) => s.openHistory);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    history.forEach((h) => h.tags?.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [history]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return history.filter((h) => {
      const matchesSearch = !q || h.prompt.toLowerCase().includes(q) || h.tags?.some((t) => t.toLowerCase().includes(q));
      const matchesTag = !tagFilter || h.tags?.includes(tagFilter);
      return matchesSearch && matchesTag;
    });
  }, [history, search, tagFilter]);

  const handleItemClick = (entry: HistoryEntry) => {
    openHistory(entry);
  };

  const handleExport = () => {
    const data = history.map((h) => ({
      id: h.id,
      prompt: h.prompt,
      createdAt: h.createdAt,
      tags: h.tags || [],
      providers: Object.fromEntries(
        ALL_PROVIDERS.map((p) => {
          const ps = h.providers[p];
          return [p, ps ? { status: ps.status, url: ps.url, contentPreview: ps.content.slice(0, 500) } : null];
        }).filter(([, v]) => v)
      ),
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `multi-ai-history-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>History</span>
          <div className={styles.headerActions}>
            <button className={styles.exportBtn} onClick={handleExport} title="导出全部历史为 JSON（含链接）">
              ⤓ 导出
            </button>
            <button className={styles.closeBtn} onClick={() => setShowHistoryList(false)}>
              ×
            </button>
          </div>
        </div>
        <div className={styles.searchBar}>
          <svg className={styles.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className={styles.searchInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索问题或标签..."
            autoFocus
          />
          {search && (
            <button className={styles.clearBtn} onClick={() => setSearch('')}>
              ×
            </button>
          )}
        </div>
        {allTags.length > 0 && (
          <div className={styles.tagBar}>
            <span className={styles.tagBarLabel}>标签：</span>
            <button
              className={`${styles.tagChip} ${!tagFilter ? styles.tagChipActive : ''}`}
              onClick={() => setTagFilter(null)}
            >
              全部
            </button>
            {allTags.map((t) => (
              <button
                key={t}
                className={`${styles.tagChip} ${tagFilter === t ? styles.tagChipActive : ''}`}
                onClick={() => setTagFilter(t === tagFilter ? null : t)}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        <div className={styles.list}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>
              {search || tagFilter ? '没有匹配的记录' : '暂无历史记录'}
            </div>
          ) : (
            filtered.map((entry) => (
              <HistoryRow
                key={entry.id}
                entry={entry}
                onClick={() => handleItemClick(entry)}
                onDelete={() => deleteHistoryItem(entry.id)}
                onAddTag={(tag) => addHistoryTag(entry.id, tag)}
                onRemoveTag={(tag) => removeHistoryTag(entry.id, tag)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

const HistoryRow: React.FC<{
  entry: HistoryEntry;
  onClick: () => void;
  onDelete: () => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
}> = ({ entry, onClick, onDelete, onAddTag, onRemoveTag }) => {
  const date = new Date(entry.createdAt);
  const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const [tagInput, setTagInput] = useState('');

  return (
    <button className={styles.row} onClick={onClick}>
      <div className={styles.rowTop}>
        <span className={styles.rowPrompt}>{entry.prompt}</span>
        <span className={styles.deleteRowBtn} onClick={(e) => { e.stopPropagation(); onDelete(); }}>×</span>
      </div>
      <div className={styles.rowTags}>
        {(entry.tags || []).map((t) => (
          <span key={t} className={styles.tag}>
            {t}
            <span className={styles.tagRemove} onClick={(e) => { e.stopPropagation(); onRemoveTag(t); }}>×</span>
          </span>
        ))}
        <input
          className={styles.tagInput}
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              onAddTag(tagInput);
              setTagInput('');
            }
          }}
          onClick={(e) => e.stopPropagation()}
          placeholder="+ 标签"
          title="按回车添加标签"
        />
      </div>
      <div className={styles.rowMeta}>
        <span>{dateStr} {timeStr}</span>
        {ALL_PROVIDERS.map((p) => {
          const ps = entry.providers[p];
          if (!ps?.url) return null;
          return (
            <a
              key={p}
              className={`${styles.provLink} ${ps.status === 'done' ? styles.provDone : styles.provError}`}
              href={ps.url}
              target="_blank"
              title={`Open ${PROVIDER_LINKS[p]} conversation`}
              onClick={(e) => e.stopPropagation()}
            >
              {PROVIDER_LINKS[p]}
            </a>
          );
        })}
      </div>
    </button>
  );
};

export default HistoryList;
