import React, { useCallback, useRef } from 'react';
import { useStore } from '../store';
import { ALL_PROVIDERS, PROVIDER_LABELS } from '../../shared/constants';
import type { ProviderName } from '../../shared/types';
import styles from './PromptInput.module.css';

const PromptInput: React.FC = () => {
  const prompt = useStore((s) => s.prompt);
  const setPrompt = useStore((s) => s.setPrompt);
  const selectedProviders = useStore((s) => s.selectedProviders);
  const toggleProvider = useStore((s) => s.toggleProvider);
  const sendPrompt = useStore((s) => s.sendPrompt);
  const isLoading = useStore((s) => s.isLoading);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    sendPrompt();
  }, [sendPrompt]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const canSend = !isLoading && prompt.trim().length > 0 && selectedProviders.length > 0;

  return (
    <div className={styles.container}>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="What do you want to ask all AIs?"
        rows={1}
      />
      <div className={styles.actions}>
        <div className={styles.providers}>
          {ALL_PROVIDERS.map((p: ProviderName) => (
            <label key={p} className={`${styles.chip} ${selectedProviders.includes(p) ? styles.chipOn : styles.chipOff}`}>
              <input
                type="checkbox"
                checked={selectedProviders.includes(p)}
                onChange={() => toggleProvider(p)}
              />
              <span className={styles.chipDot} />
              {PROVIDER_LABELS[p]}
            </label>
          ))}
        </div>
        <button
          className={`${styles.sendBtn} ${canSend ? styles.sendBtnReady : ''}`}
          onClick={handleSend}
          disabled={!canSend}
        >
          {isLoading ? (
            <span className={styles.spinner} />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
};

export default PromptInput;
