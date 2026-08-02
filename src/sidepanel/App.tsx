import React, { useEffect } from 'react';
import { useStore } from './store';
import { PromptInput, StatusBar, HistoryBar, HistoryList, SettingsPanel } from './components';
import Fullscreen from './Fullscreen';
import type { BackgroundToUIMessage } from '../shared/types';
import styles from './App.module.css';

const App: React.FC = () => {
  const setTask = useStore((s) => s.setTask);
  const restoreLastTask = useStore((s) => s.restoreLastTask);
  const panelMode = useStore((s) => s.panelMode);
  const switchPanelMode = useStore((s) => s.switchPanelMode);
  const showHistoryList = useStore((s) => s.showHistoryList);
  const loadHistory = useStore((s) => s.loadHistory);
  const showSettings = useStore((s) => s.showSettings);
  const setShowSettings = useStore((s) => s.setShowSettings);
  const loadSettings = useStore((s) => s.loadSettings);
  const setConversation = useStore((s) => s.setConversation);
  const setConversations = useStore((s) => s.setConversations);

  useEffect(() => {
    restoreLastTask();
    loadHistory();
    loadSettings();
    // 全页面模式打开时拉取当前会话
    if (panelMode === 'fullscreen') {
      useStore.getState().listConversationsAction().catch(() => {});
      useStore.getState().openCurrentConversation().catch(() => {});
    }

    const listener = (msg: BackgroundToUIMessage) => {
      if (msg.type === 'TASK_STATE_UPDATE') {
        setTask(msg.task);
        const allDone = Object.values(msg.task.providers).every(
          (p) => p.status === 'done' || p.status === 'error' || p.status === 'login_required' || p.status === 'idle'
        );
        if (allDone) {
          useStore.setState({ isLoading: false });
          loadHistory();
        }
      }
      if (msg.type === 'HISTORY_UPDATE') {
        loadHistory();
      }
      if (msg.type === 'CONVERSATION_UPDATE') {
        setConversation(msg.conversation);
      }
      if (msg.type === 'CONVERSATION_LIST') {
        setConversations(msg.conversations);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [setTask, restoreLastTask, loadHistory, panelMode]);

  const isFullscreen = panelMode === 'fullscreen';

  return (
    <div className={styles.app}>
      {isFullscreen ? (
        <Fullscreen />
      ) : (
        <>
          <div className={styles.header}>
            <span className={styles.title}>Multi AI</span>
            <div className={styles.headerActions}>
              <button className={styles.iconBtn} onClick={() => setShowSettings(true)} title="Settings">
                ⚙
              </button>
              <button
                className={styles.modeBtn}
                onClick={switchPanelMode}
                title="Switch to Fullscreen"
              >
                ⛶
              </button>
            </div>
          </div>
          <PromptInput />
          <StatusBar />
          <HistoryBar />
          {showHistoryList && <HistoryList />}
          {showSettings && <SettingsPanel />}
        </>
      )}
    </div>
  );
};

export default App;
