// ============================================================
// background/contextMenu.ts — 右键插件图标打开独立全屏工作台
// ============================================================

const MENU_ID = 'open-workbench';
const TEST_MENU_ID = 'open-link-test';
const SIDEPANEL_MENU_ID = 'open-sidepanel-fullscreen';

const MENU_ITEMS: { id: string; title: string }[] = [
  { id: MENU_ID, title: '🧠 打开 AI 工作台 (全屏)' },
  { id: SIDEPANEL_MENU_ID, title: '📐 打开侧边栏页面 (全屏)' },
  { id: TEST_MENU_ID, title: '⚡ 打开请求链路测试台' },
];

function createMenus(): void {
  for (const item of MENU_ITEMS) {
    chrome.contextMenus.create(
      {
        id: item.id,
        title: item.title,
        contexts: ['action'], // 右键点击工具栏插件图标时显示
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn(`[MultiAI:contextMenu] create ${item.id} failed:`, chrome.runtime.lastError.message);
        }
      }
    );
  }
}

export function setupContextMenu(): void {
  chrome.runtime.onInstalled.addListener(() => {
    // 先清空再重建（#45）：菜单项由浏览器持久化，扩展更新后若菜单项增删或改名，
    // 旧项会残留；对同一 id 重复 create 还会报 "duplicate id" 而静默失败。
    chrome.contextMenus.removeAll(() => {
      void chrome.runtime.lastError; // removeAll 失败不阻断重建
      createMenus();
    });
  });

  chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === MENU_ID) {
      openWorkbench();
    } else if (info.menuItemId === SIDEPANEL_MENU_ID) {
      openSidepanelFullscreen();
    } else if (info.menuItemId === TEST_MENU_ID) {
      openLinkTest();
    }
  });
}

/**
 * 打开「侧边栏页面」的独立全屏窗口。
 * 复用 sidepanel.html，并带 ?mode=fullscreen 让页面按全屏形态渲染
 * （与 messageRouter.openFullscreen() 使用同一 URL 约定）。
 */
export function openSidepanelFullscreen(): void {
  const url = chrome.runtime.getURL('public/sidepanel.html') + '?mode=fullscreen';
  chrome.windows.create(
    {
      url,
      type: 'popup',
      state: 'maximized',
      focused: true,
    },
    (win) => {
      if (chrome.runtime.lastError) {
        console.warn('[MultiAI:contextMenu] open sidepanel fullscreen failed:', chrome.runtime.lastError.message);
      } else {
        console.log('[MultiAI:contextMenu] sidepanel fullscreen window opened, id=', win?.id);
      }
    }
  );
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
