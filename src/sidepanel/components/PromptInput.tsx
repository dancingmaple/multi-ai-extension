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
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className={styles.container}>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter your prompt... (Ctrl+Enter to send)"
        rows={3}
      />
      <div className={styles.providers}>
        {ALL_PROVIDERS.map((p: ProviderName) => (
          <label key={p} className={styles.checkbox}>
            <input
              type="checkbox"
              checked={selectedProviders.includes(p)}
              onChange={() => toggleProvider(p)}
            />
            {PROVIDER_LABELS[p]}
          </label>
        ))}
      </div>
      <button
        className={styles.sendBtn}
        onClick={handleSend}
        disabled={isLoading || !prompt.trim() || selectedProviders.length === 0}
      >
        {isLoading ? 'Sending...' : 'Send'}
      </button>
    </div>
  );
};

export default PromptInput;
