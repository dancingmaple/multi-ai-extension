import React from 'react';
import { useStore } from '../store';
import type { ProviderName } from '../../shared/types';
import { useEffectiveProviders } from '../../shared/useEffectiveProviders';
import StatusBadge from './StatusBadge';
import styles from './ProviderTabs.module.css';

const ProviderTabs: React.FC = () => {
  const task = useStore((s) => s.task);
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const selectedProviders = useStore((s) => s.selectedProviders);
  const openReader = useStore((s) => s.openReader);
  const effective = useEffectiveProviders();
  const labelOf = (p: ProviderName) => effective.find((e) => e.id === p)?.label ?? p;

  return (
    <div className={styles.tabs}>
      {selectedProviders.map((p: ProviderName, idx: number) => {
        const providerState = task?.providers[p];
        const status = providerState?.status ?? 'idle';
        return (
          <button
            key={p}
            className={`${styles.tab} ${activeTab === p ? styles.active : ''}`}
            onClick={() => setActiveTab(p)}
            onDoubleClick={() => openReader(selectedProviders, idx)}
            title="单击切换 · 双击大弹窗阅读"
          >
            <span>{labelOf(p)}</span>
            <StatusBadge status={status} />
          </button>
        );
      })}
    </div>
  );
};

export default ProviderTabs;
