import React, { useEffect } from 'react';
import { useStore } from './store';
import { PromptInput, StatusBar, HistoryBar, HistoryList, IframeGrid } from './components';
import type { BackgroundToUIMessage } from '../shared/types';
import styles from './App.module.css';

const App: React.FC = () => {
  const setTask = useStore((s) => s.setTask);
  const restoreLastTask = useStore((s) => s.restoreLastTask);
  const panelMode = useStore((s) => s.panelMode);
  const switchPanelMode = useStore((s) => s.switchPanelMode);
  const visibleProviders = useStore((s) => s.visibleProviders);
  const toggleVisibleProvider = useStore((s) => s.toggleVisibleProvider);
  const showHistoryList = useStore((s) => s.showHistoryList);
  const loadHistory = useStore((s) => s.loadHistory);

  useEffect(() => {
    restoreLastTask();
    loadHistory();

    const listener = (msg: BackgroundToUIMessage) => {
      if (msg.type === 'TASK_STATE_UPDATE') {
        setTask(msg.task);
        const allDone = Object.values(msg.task.providers).every(
          (p) => p.status === 'done' || p.status === 'error' || p.status === 'login_required'
        );
        if (allDone) {
          useStore.setState({ isLoading: false });
          // Reload history when task completes
          loadHistory();
        }
      }
      if (msg.type === 'HISTORY_UPDATE') {
        loadHistory();
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [setTask, restoreLastTask, loadHistory]);

  const isFullscreen = panelMode === 'fullscreen';

  return (
    <div className={styles.app}>
      <div className={styles.header}>
        <span className={styles.title}>Multi AI</span>
        <div className={styles.headerActions}>
          <button
            className={styles.modeBtn}
            onClick={switchPanelMode}
            title={isFullscreen ? 'Switch to Side Panel' : 'Switch to Fullscreen'}
          >
            {isFullscreen ? '◧' : '⛶'}
          </button>
        </div>
      </div>
      <PromptInput />
      <StatusBar />
      <HistoryBar />
      {isFullscreen && (
        <IframeGrid visibleProviders={visibleProviders} onToggle={toggleVisibleProvider} />
      )}
      {showHistoryList && <HistoryList />}
    </div>
  );
};

export default App;
