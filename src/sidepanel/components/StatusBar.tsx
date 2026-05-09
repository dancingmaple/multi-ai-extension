import React from 'react';
import { useStore } from '../store';
import type { ProviderName, ProviderStatus } from '../../shared/types';
import { ALL_PROVIDERS, PROVIDER_LABELS } from '../../shared/constants';
import styles from './StatusBar.module.css';

const STATUS_LABELS: Record<ProviderStatus, string> = {
  idle: '',
  waiting: 'Waiting...',
  sending: 'Sending...',
  streaming: 'Streaming...',
  done: 'Done',
  error: 'Error',
  login_required: 'Login Required',
};

interface StatusButtonProps {
  provider: ProviderName;
  status: ProviderStatus;
  error?: string;
  tabId?: number;
}

const StatusButton: React.FC<StatusButtonProps> = ({ provider, status, error, tabId }) => {
  const handleClick = () => {
    if (tabId !== undefined && (status === 'done' || status === 'streaming')) {
      chrome.tabs.update(tabId, { active: true }).catch(() => {});
    }
  };

  const clickable = tabId !== undefined && (status === 'done' || status === 'streaming');

  return (
    <button
      className={`${styles.btn} ${styles[status] || ''} ${clickable ? styles.clickable : ''}`}
      onClick={clickable ? handleClick : undefined}
      title={error || (clickable ? 'Click to open tab' : '')}
      disabled={!clickable && status !== 'error'}
    >
      <StatusIcon status={status} />
      <span className={styles.label}>{PROVIDER_LABELS[provider]}</span>
      <span className={styles.status}>{error || STATUS_LABELS[status]}</span>
    </button>
  );
};

const StatusIcon: React.FC<{ status: ProviderStatus }> = ({ status }) => {
  switch (status) {
    case 'done':
      return <span className={styles.iconDone}>✓</span>;
    case 'error':
    case 'login_required':
      return <span className={styles.iconError}>✗</span>;
    case 'streaming':
      return <span className={styles.iconStreaming}>●</span>;
    case 'sending':
      return <span className={styles.iconSending}>↗</span>;
    case 'waiting':
      return <span className={styles.iconWaiting}>◌</span>;
    default:
      return <span className={styles.iconIdle}>○</span>;
  }
};

const StatusBar: React.FC = () => {
  const task = useStore((s) => s.task);

  return (
    <div className={styles.container}>
      {ALL_PROVIDERS.map((provider) => {
        const ps = task?.providers[provider];
        return (
          <StatusButton
            key={provider}
            provider={provider}
            status={ps?.status || 'idle'}
            error={ps?.error}
            tabId={ps?.tabId}
          />
        );
      })}
    </div>
  );
};

export default StatusBar;
