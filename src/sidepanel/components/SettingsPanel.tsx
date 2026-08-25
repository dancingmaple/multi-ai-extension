import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import type { ProviderName } from '../../shared/types';
import { useEffectiveProviders } from '../../shared/useEffectiveProviders';
import styles from './SettingsPanel.module.css';

const SettingsPanel: React.FC = () => {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const setShowSettings = useStore((s) => s.setShowSettings);

  const effective = useEffectiveProviders();

  // 本地草稿：输入时只更新草稿，失焦/关闭时才落盘，避免每次按键都写 storage 并触发订阅者重渲染（#54）
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  const commit = () => saveSettings(draft);

  const handleElementTimeout = (value: number) => {
    setDraft((d) => ({ ...d, elementTimeoutMs: value || 5000 }));
  };

  const handleResponseTimeout = (provider: ProviderName, value: number) => {
    setDraft((d) => ({
      ...d,
      responseTimeoutMs: { ...d.responseTimeoutMs, [provider]: value || 30000 },
    }));
  };

  return (
    <div className={styles.overlay} onClick={() => { commit(); setShowSettings(false); }}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Settings</span>
          <button className={styles.closeBtn} onClick={() => { commit(); setShowSettings(false); }}>×</button>
        </div>

        <div className={styles.body}>
          <div className={styles.section}>
            <label className={styles.field}>
              <span className={styles.label}>Element Wait Timeout</span>
              <span className={styles.hint}>Max wait for input/button elements to appear (ms)</span>
              <input
                type="number"
                className={styles.input}
                value={draft.elementTimeoutMs}
                onChange={(e) => handleElementTimeout(Number(e.target.value))}
                onBlur={commit}
                min={5000} max={60000} step={1000}
              />
            </label>
          </div>

          <div className={styles.divider} />

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Response Timeout per Provider</h3>
            <p className={styles.sectionHint}>Max wait for AI to finish generating response (ms)</p>

            {effective.map((e) => {
              const p = e.id as ProviderName;
              return (
                <label key={p} className={styles.field}>
                  <span className={styles.label}>{e.label}</span>
                  <input
                    type="number"
                    className={styles.input}
                    value={draft.responseTimeoutMs[p] ?? 120000}
                    onChange={(e) => handleResponseTimeout(p, Number(e.target.value))}
                    onBlur={commit}
                    min={30000} max={600000} step={10000}
                  />
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
