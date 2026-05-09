import React from 'react';
import { useStore } from '../store';
import styles from './SettingsPanel.module.css';

const SettingsPanel: React.FC = () => {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const setShowSettings = useStore((s) => s.setShowSettings);

  const handleChange = (key: string, value: number) => {
    saveSettings({ ...settings, [key]: value });
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
              <span className={styles.hint}>Max wait for input/button elements (ms)</span>
              <input
                type="number"
                className={styles.input}
                value={settings.elementTimeoutMs}
                onChange={(e) => handleChange('elementTimeoutMs', Number(e.target.value) || 5000)}
                min={5000}
                max={60000}
                step={1000}
              />
            </label>
          </div>

          <div className={styles.divider} />

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Response Timeouts</h3>
            <p className={styles.sectionHint}>Max wait for AI to finish generating response (ms)</p>

            <label className={styles.field}>
              <span className={styles.label}>ChatGPT & Gemini</span>
              <input
                type="number"
                className={styles.input}
                value={settings.responseTimeoutMs}
                onChange={(e) => handleChange('responseTimeoutMs', Number(e.target.value) || 30000)}
                min={30000}
                max={600000}
                step={10000}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>DeepSeek</span>
              <span className={styles.hint}>Usually needs more time for the first token</span>
              <input
                type="number"
                className={styles.input}
                value={settings.deepseekResponseTimeoutMs}
                onChange={(e) => handleChange('deepseekResponseTimeoutMs', Number(e.target.value) || 30000)}
                min={30000}
                max={600000}
                step={5000}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
