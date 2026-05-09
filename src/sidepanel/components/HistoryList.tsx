import React from 'react';
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
};

const HistoryList: React.FC = () => {
  const history = useStore((s) => s.history);
  const search = useStore((s) => s.historySearch);
  const setSearch = useStore((s) => s.setHistorySearch);
  const setShowHistoryList = useStore((s) => s.setShowHistoryList);
  const deleteHistoryItem = useStore((s) => s.deleteHistoryItem);
  const sendPrompt = useStore((s) => s.sendPrompt);
  const setPrompt = useStore((s) => s.setPrompt);

  const filtered = search.trim()
    ? history.filter((h) => h.prompt.toLowerCase().includes(search.toLowerCase()))
    : history;

  const handleItemClick = (entry: HistoryEntry) => {
    setPrompt(entry.prompt);
    setShowHistoryList(false);
    sendPrompt();
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>History</span>
          <button className={styles.closeBtn} onClick={() => setShowHistoryList(false)}>
            ×
          </button>
        </div>
        <div className={styles.searchBar}>
          <svg className={styles.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className={styles.searchInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search history..."
            autoFocus
          />
          {search && (
            <button className={styles.clearBtn} onClick={() => setSearch('')}>
              ×
            </button>
          )}
        </div>
        <div className={styles.list}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>
              {search ? 'No matching conversations' : 'No history yet'}
            </div>
          ) : (
            filtered.map((entry) => (
              <HistoryRow
                key={entry.id}
                entry={entry}
                onClick={() => handleItemClick(entry)}
                onDelete={() => deleteHistoryItem(entry.id)}
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
}> = ({ entry, onClick, onDelete }) => {
  const date = new Date(entry.createdAt);
  const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <button className={styles.row} onClick={onClick}>
      <div className={styles.rowTop}>
        <span className={styles.rowPrompt}>{entry.prompt}</span>
        <span className={styles.deleteRowBtn} onClick={(e) => { e.stopPropagation(); onDelete(); }}>×</span>
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
