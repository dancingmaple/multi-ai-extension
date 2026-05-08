import React from 'react';
import { useStore } from '../store';
import { PROVIDER_LABELS } from '../../shared/constants';
import type { ProviderName } from '../../shared/types';
import StatusBadge from './StatusBadge';
import styles from './ProviderTabs.module.css';

const ProviderTabs: React.FC = () => {
  const task = useStore((s) => s.task);
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const selectedProviders = useStore((s) => s.selectedProviders);

  return (
    <div className={styles.tabs}>
      {selectedProviders.map((p: ProviderName) => {
        const providerState = task?.providers[p];
        const status = providerState?.status ?? 'idle';
        return (
          <button
            key={p}
            className={`${styles.tab} ${activeTab === p ? styles.active : ''}`}
            onClick={() => setActiveTab(p)}
          >
            <span>{PROVIDER_LABELS[p]}</span>
            <StatusBadge status={status} />
          </button>
        );
      })}
    </div>
  );
};

export default ProviderTabs;
