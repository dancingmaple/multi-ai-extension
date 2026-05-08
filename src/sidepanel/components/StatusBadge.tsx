import React from 'react';
import type { ProviderStatus } from '../../shared/types';
import styles from './StatusBadge.module.css';

const STATUS_COLORS: Record<ProviderStatus, string> = {
  idle: '#9ca3af',
  waiting: '#f59e0b',
  sending: '#3b82f6',
  streaming: '#8b5cf6',
  done: '#10b981',
  error: '#ef4444',
  login_required: '#f97316',
};

interface Props {
  status: ProviderStatus;
}

const StatusBadge: React.FC<Props> = ({ status }) => {
  return (
    <span className={styles.badge} style={{ background: STATUS_COLORS[status] }}>
      {status.replace('_', ' ')}
    </span>
  );
};

export default StatusBadge;
