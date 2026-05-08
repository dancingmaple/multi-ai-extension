import React, { useEffect } from 'react';
import { useStore } from './store';
import { PromptInput, ProviderTabs, ResponseView } from './components';
import type { BackgroundToUIMessage } from '../shared/types';
import styles from './App.module.css';

const App: React.FC = () => {
  const setTask = useStore((s) => s.setTask);
  const restoreLastTask = useStore((s) => s.restoreLastTask);

  useEffect(() => {
    restoreLastTask();

    const listener = (msg: BackgroundToUIMessage) => {
      if (msg.type === 'TASK_STATE_UPDATE') {
        setTask(msg.task);
        // Clear loading when all providers have finished
        const allDone = Object.values(msg.task.providers).every(
          (p) => p.status === 'done' || p.status === 'error' || p.status === 'login_required'
        );
        if (allDone) {
          useStore.setState({ isLoading: false });
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [setTask, restoreLastTask]);

  return (
    <div className={styles.app}>
      <PromptInput />
      <ProviderTabs />
      <ResponseView />
    </div>
  );
};

export default App;
