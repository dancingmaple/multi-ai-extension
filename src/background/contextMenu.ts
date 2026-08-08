// ============================================================
// background/contextMenu.ts — 右键插件图标打开独立全屏工作台
// ============================================================

const MENU_ID = 'open-workbench';

export function setupContextMenu(): void {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create(
      {
        id: MENU_ID,
        title: '🧠 打开 AI 工作台 (全屏)',
        contexts: ['action'], // 右键点击工具栏插件图标时显示
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn('[MultiAI:contextMenu] create failed:', chrome.runtime.lastError.message);
        }
      }
    );
  });

  chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === MENU_ID) {
      openWorkbench();
    }
  });
}

/** 打开独立工作台窗口（popup + 默认最大化） */
export function openWorkbench(): void {
  const url = chrome.runtime.getURL('workbench.html');
  chrome.windows.create(
    {
      url,
      type: 'popup',
      state: 'maximized', // 默认全屏
      focused: true,
    },
    (win) => {
      if (chrome.runtime.lastError) {
        console.warn('[MultiAI:contextMenu] open window failed:', chrome.runtime.lastError.message);
      } else {
        console.log('[MultiAI:contextMenu] workbench window opened, id=', win?.id);
      }
    }
  );
}
