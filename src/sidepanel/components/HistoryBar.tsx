import React from 'react';
import { useStore } from '../store';
import type { HistoryEntry } from '../../shared/types';
import styles from './HistoryBar.module.css';

const HistoryItem: React.FC<{ entry: HistoryEntry; onDelete: () => void; onClick: () => void }> = ({
  entry,
  onDelete,
  onClick,
}) => {
  const done = Object.values(entry.providers).filter(
    (p) => p.status === 'done' || p.status === 'error'
  ).length;
  const total = Object.keys(entry.providers).length;
  const date = new Date(entry.createdAt);
  const timeStr = isToday(date)
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });

  return (
    <button className={styles.item} onClick={onClick}>
      <span className={styles.time}>{timeStr}</span>
      <span className={styles.prompt}>{entry.prompt.slice(0, 60)}</span>
      <span className={styles.meta}>
        {done}/{total}
      </span>
      <span
        className={styles.deleteBtn}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete"
      >
        ×
      </span>
    </button>
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

  // Load history on first render
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
