import React from 'react';
import { useStore } from '../store';
import type { HistoryEntry, ProviderName } from '../../shared/types';
import { ALL_PROVIDERS } from '../../shared/constants';
import styles from './HistoryBar.module.css';

const PROVIDER_INITIAL: Record<ProviderName, string> = {
  chatgpt: 'C',
  gemini: 'G',
  deepseek: 'D',
  qwen: 'Q',
  zai: 'Z',
  doubao: 'B',
};

const HistoryItem: React.FC<{ entry: HistoryEntry; onDelete: () => void; onClick: () => void }> = ({
  entry,
  onDelete,
  onClick,
}) => {
  const date = new Date(entry.createdAt);
  const timeStr = isToday(date)
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });

  return (
    <div className={styles.itemRow}>
      <button className={styles.item} onClick={onClick}>
        <span className={styles.time}>{timeStr}</span>
        <span className={styles.prompt}>{entry.prompt.slice(0, 60)}</span>
      </button>
      <span className={styles.links}>
        {ALL_PROVIDERS.map((p) => {
          const ps = entry.providers[p];
          if (!ps?.url) return null;
          return (
            <a
              key={p}
              className={`${styles.link} ${ps.status === 'done' ? styles.linkDone : styles.linkError}`}
              href={ps.url}
              target="_blank"
              title={`${p}: ${ps.status}`}
              onClick={(e) => e.stopPropagation()}
            >
              {PROVIDER_INITIAL[p]}
            </a>
          );
        })}
      </span>
      <span
        className={styles.deleteBtn}
        onClick={() => onDelete()}
        title="Delete"
      >
        ×
      </span>
    </div>
  );
};

function isToday(d: Date): boolean {
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

const HistoryBar: React.FC = () => {
  const history = useStore((s) => s.history);
  const showHistoryList = useStore((s) => s.showHistoryList);
  const setShowHistoryList = useStore((s) => s.setShowHistoryList);
  const deleteHistoryItem = useStore((s) => s.deleteHistoryItem);
  const sendPrompt = useStore((s) => s.sendPrompt);
  const setPrompt = useStore((s) => s.setPrompt);
  const loadHistory = useStore((s) => s.loadHistory);
  const historyLoaded = useStore((s) => s.history.length > 0 || s.showHistoryList);

  React.useEffect(() => {
    if (!historyLoaded) {
      loadHistory();
    }
  }, []);

  const recent = history.slice(0, 5);

  if (recent.length === 0 && !showHistoryList) return null;

  const handleItemClick = (entry: HistoryEntry) => {
    setPrompt(entry.prompt);
    sendPrompt();
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>Recent</span>
        <button
          className={styles.moreBtn}
          onClick={() => {
            loadHistory();
            setShowHistoryList(true);
          }}
        >
          View All
        </button>
      </div>
      <div className={styles.list}>
        {recent.map((entry) => (
          <HistoryItem
            key={entry.id}
            entry={entry}
            onDelete={() => deleteHistoryItem(entry.id)}
            onClick={() => handleItemClick(entry)}
          />
        ))}
      </div>
    </div>
  );
};

export default HistoryBar;
