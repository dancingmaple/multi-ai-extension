import React, { useRef, useEffect } from 'react';
import { useStore } from '../store';
import styles from './ResponseView.module.css';

const ResponseView: React.FC = () => {
  const task = useStore((s) => s.task);
  const activeTab = useStore((s) => s.activeTab);
  const retryProvider = useStore((s) => s.retryProvider);
  const containerRef = useRef<HTMLDivElement>(null);

  const providerState = task?.providers[activeTab];
  const content = providerState?.content ?? '';
  const status = providerState?.status ?? 'idle';
  const error = providerState?.error;

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [content]);

  const handleCopy = () => {
    navigator.clipboard.writeText(content).catch(console.error);
  };

  if (status === 'error' || status === 'login_required') {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <p>{error ?? 'An error occurred'}</p>
          <button className={styles.retryBtn} onClick={() => retryProvider(activeTab)}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (status === 'idle' || status === 'waiting') {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>Waiting to start...</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <button className={styles.copyBtn} onClick={handleCopy} disabled={!content}>
          Copy
        </button>
      </div>
      <div ref={containerRef} className={styles.content}>
        {content ? (
          <pre className={styles.pre}>{content}</pre>
        ) : status === 'streaming' ? (
          <div className={styles.empty}>Waiting for response...</div>
        ) : (
          <div className={styles.empty}>No response yet</div>
        )}
        {status === 'streaming' && <span className={styles.cursor}>|</span>}
      </div>
    </div>
  );
};

export default ResponseView;
