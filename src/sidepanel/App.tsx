import React, { useEffect, useState, useRef } from 'react';
import { useStore } from './store';
import { PromptInput, StatusBar, HistoryBar, HistoryList, SettingsPanel, ProviderTabs, ResponseView } from './components';
import Fullscreen from './Fullscreen';
import type { BackgroundToUIMessage, ExportLayout, ExportSink } from '../shared/types';
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
  const exportMd = useStore((s) => s.exportMd);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  const runExport = (layout: ExportLayout, sink: ExportSink) => {
    setExportOpen(false);
    exportMd(layout, sink).catch(() => {});
  };

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
              <div className={styles.exportWrap} ref={exportRef}>
                <button
                  className={styles.iconBtn}
                  onClick={() => setExportOpen((v) => !v)}
                  title="Export Markdown"
                >
                  ⤓
                </button>
                {exportOpen && (
                  <div className={styles.exportMenu}>
                    <div className={styles.exportGroup}>按轮导出</div>
                    <button className={styles.exportItem} onClick={() => runExport('by-turn', 'download')}>
                      下载文件
                    </button>
                    <button className={styles.exportItem} onClick={() => runExport('by-turn', 'clipboard')}>
                      复制到剪贴板
                    </button>
                    <div className={styles.exportGroup}>按模型导出</div>
                    <button className={styles.exportItem} onClick={() => runExport('by-provider', 'download')}>
                      下载文件
                    </button>
                    <button className={styles.exportItem} onClick={() => runExport('by-provider', 'clipboard')}>
                      复制到剪贴板
                    </button>
                  </div>
                )}
              </div>
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
          <ProviderTabs />
          <ResponseView />
          <HistoryBar />
          {showHistoryList && <HistoryList />}
          {showSettings && <SettingsPanel />}
        </>
      )}
    </div>
  );
};

export default App;
