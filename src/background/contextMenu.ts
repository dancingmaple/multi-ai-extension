// ============================================================
// background/contextMenu.ts — 右键插件图标打开独立全屏工作台
// ============================================================

const MENU_ID = 'open-workbench';
const TEST_MENU_ID = 'open-link-test';

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
    chrome.contextMenus.create(
      {
        id: TEST_MENU_ID,
        title: '⚡ 打开请求链路测试台',
        contexts: ['action'],
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn('[MultiAI:contextMenu] create test menu failed:', chrome.runtime.lastError.message);
        }
      }
    );
  });

  chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === MENU_ID) {
      openWorkbench();
    } else if (info.menuItemId === TEST_MENU_ID) {
      openLinkTest();
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

/** 打开 AI 请求/获取核心链路测试台（独立窗口） */
export function openLinkTest(): void {
  const url = chrome.runtime.getURL('test.html');
  chrome.windows.create(
    {
      url,
      type: 'popup',
      state: 'maximized',
      focused: true,
    },
    (win) => {
      if (chrome.runtime.lastError) {
        console.warn('[MultiAI:contextMenu] open link test failed:', chrome.runtime.lastError.message);
      } else {
        console.log('[MultiAI:contextMenu] link test window opened, id=', win?.id);
      }
    }
  );
}
