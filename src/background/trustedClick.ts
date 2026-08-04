// 受信任点击（trusted click）
// 某些站点的发送按钮是 React 挂在普通 <div> 上的 onClick，并且只接受
// isTrusted === true 的真实用户手势。扩展的 content script 用 dispatchEvent
// 派发的事件一律 isTrusted === false，会被站点拒绝（实测 Kimi 即如此）。
//
// 唯一可行的办法是用 chrome.debugger 走 CDP 的 Input.dispatchMouseEvent，
// 它产生的事件 isTrusted === true。这里 attach 到目标 tab，派发一次
// mousePressed + mouseReleased，然后立即 detach，避免长期占用调试器。

let attachedTab: number | null = null;

async function ensureAttached(tabId: number): Promise<void> {
  if (attachedTab === tabId) return;
  if (attachedTab !== null) {
    try {
      await chrome.debugger.detach({ tabId: attachedTab });
    } catch {
      /* 可能已经 detached */
    }
  }
  await chrome.debugger.attach({ tabId }, '1.3');
  attachedTab = tabId;
}

function send(target: { tabId: number }, method: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target as chrome.debugger.Debuggee, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || method + ' failed'));
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * 在指定 tab 视口坐标 (x, y) 处派发一次受信任的鼠标左键点击。
 * 返回是否成功。调用方负责传入正确坐标（对于嵌入在 sidepanel 里的 iframe，
 * 坐标是相对于 sidepanel 视口的绝对坐标）。
 */
export async function trustedClickAt(tabId: number, x: number, y: number): Promise<boolean> {
  try {
    await ensureAttached(tabId);
    const target = { tabId };
    await send(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
      modifiers: 0,
    });
    await send(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
      modifiers: 0,
    });
    return true;
  } catch (e) {
    console.warn('[trustedClick] failed:', e instanceof Error ? e.message : e);
    return false;
  } finally {
    if (attachedTab === tabId) {
      try {
        await chrome.debugger.detach({ tabId });
      } catch {
        /* noop */
      }
      attachedTab = null;
    }
  }
}
