import React from 'react';
import { useStore } from '../store';
import type { ProviderName } from '../../shared/types';
import { ALL_PROVIDERS, PROVIDER_LABELS } from '../../shared/constants';
import styles from './SettingsPanel.module.css';

const SettingsPanel: React.FC = () => {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const setShowSettings = useStore((s) => s.setShowSettings);

  const handleElementTimeout = (value: number) => {
    saveSettings({ ...settings, elementTimeoutMs: value || 5000 });
  };

  const handleResponseTimeout = (provider: ProviderName, value: number) => {
    saveSettings({
      ...settings,
      responseTimeoutMs: { ...settings.responseTimeoutMs, [provider]: value || 30000 },
    });
  };

  return (
    <div className={styles.overlay} onClick={() => setShowSettings(false)}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Settings</span>
          <button className={styles.closeBtn} onClick={() => setShowSettings(false)}>×</button>
        </div>

        <div className={styles.body}>
          <div className={styles.section}>
            <label className={styles.field}>
              <span className={styles.label}>Element Wait Timeout</span>
              <span className={styles.hint}>Max wait for input/button elements to appear (ms)</span>
              <input
                type="number"
                className={styles.input}
                value={settings.elementTimeoutMs}
                onChange={(e) => handleElementTimeout(Number(e.target.value))}
                min={5000} max={60000} step={1000}
              />
            </label>
          </div>

          <div className={styles.divider} />

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Response Timeout per Provider</h3>
            <p className={styles.sectionHint}>Max wait for AI to finish generating response (ms)</p>

            {ALL_PROVIDERS.map((p) => (
              <label key={p} className={styles.field}>
                <span className={styles.label}>{PROVIDER_LABELS[p]}</span>
                <input
                  type="number"
                  className={styles.input}
                  value={settings.responseTimeoutMs[p] ?? 120000}
                  onChange={(e) => handleResponseTimeout(p, Number(e.target.value))}
                  min={30000} max={600000} step={10000}
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
