import type { ProviderName } from '../shared/types';
import {
  getTask,
  createTask,
  setProviderTabId,
  finishProviderTask,
  failProviderTask,
} from './stateStore';
import { broadcastTaskState } from '../shared/messaging';
import { upsertAnswer } from './conversationStore';

const DOMAIN_PATTERN: Record<string, string> = {
  chatgpt: '*://chatgpt.com/*',
  gemini: '*://gemini.google.com/*',
  deepseek: '*://*.deepseek.com/*',
  qwen: '*://chat.qwen.ai/*',
  zai: '*://chat.z.ai/*',
  doubao: '*://www.doubao.com/*',
};

/**
 * 注入函数（必须自包含，不依赖任何模块/import）：
 * 读整页可见文本 → 用提问当剪刀剪出回答 → 剪不到兜底取页面后半段 →
 * 裁掉头尾元信息。宁可抓糙，绝不抓空。逻辑与 shared/grab.ts 的 extractAnswer 一致。
 */
function grabInPage(args: { prompt: string }): { text: string; method: string } {
  const HEAD =
    /^(思考了|已思考|思考中|Thought for|Thinking|Reasoned|Reasoning|搜索了|联网搜索|Searching|Searched|Found\s+\d+|阅读了|Read\s+\d+|查看了|引用了|\d+\s*个\s*(网页|来源|结果|web\s*pages?)|DeepThink|Instant|深度思考|联网搜索中|搜索中|生成中)/i;
  const TAIL =
    /^(复制|点赞|点踩|重新生成|再生成|分享|引用|参考来源|参考|来源|DeepThink|联网搜索|Instant|搜索|给\s*豆包|发消息|发送|Copy|Like|Dislike|Share|Regenerate|Retry|Message|⎘|👍|👎|◎|↻)/i;
  const clean = (s: string) => s.replace(/ /g, ' ');
  const root = (document.querySelector('main') || document.body) as HTMLElement;
  const raw = clean(root.innerText || document.body.innerText || '');
  const lines = raw.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);

  const trim = (arr: string[]) => {
    while (arr.length && HEAD.test(arr[0])) arr.shift();
    while (arr.length && TAIL.test(arr[arr.length - 1])) arr.pop();
    return arr;
  };

  const key = (args.prompt || '').replace(/\s/g, '').slice(0, 12);
  let q = -1;
  if (key)
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].replace(/\s/g, '').includes(key)) {
        q = i;
        break;
      }
    }
  if (q >= 0 && q < lines.length - 1) {
    const body = trim(lines.slice(q + 1)).join('\n').trim();
    if (body.length > 8) return { text: body, method: 'scissor' };
  }
  const half = trim(lines.slice(Math.floor(lines.length / 2))).join('\n').trim();
  if (half.length > 8) return { text: half, method: 'tail-fallback' };
  return { text: '', method: 'none' };
}

export { grabInPage };

export interface GrabOutcome {
  provider: ProviderName;
  ok: boolean;
  method?: string;
  error?: string;
}

/**
 * 手动兜底（§9）：旁路读屏，把结果写回运行时 Task（让卡片变 done）与
 * Conversation 的对应 Turn（source='manual'）。自动链路失败时它是 100% 可用的保险丝。
 */
export async function manualGrab(
  conversationId: string,
  turnId: string,
  provider: ProviderName,
  prompt: string
): Promise<GrabOutcome> {
  let tabId = getTask(turnId)?.providers?.[provider]?.tabId;
  if (!tabId) {
    const pat = DOMAIN_PATTERN[provider];
    if (pat) {
      const tabs = await chrome.tabs.query({ url: pat });
      tabId = tabs[0]?.id;
    }
  }
  if (!tabId) {
    return { provider, ok: false, error: '找不到该站点的标签页，请先在浏览器里打开它' };
  }

  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: grabInPage,
      args: [{ prompt }],
    });
    const got = res?.[0]?.result || { text: '', method: 'none' };
    const text = (got.text || '').trim();

    let task = getTask(turnId);
    if (!task) task = createTask(turnId, prompt, [provider]);
    setProviderTabId(turnId, provider, tabId);
    if (text) finishProviderTask(turnId, provider, text);
    else failProviderTask(turnId, provider, '手动抓取未读到回答文本');
    const t2 = getTask(turnId);
    if (t2) broadcastTaskState({ type: 'TASK_STATE_UPDATE', task: t2 });

    if (text) {
      const method = got.method === 'scissor' ? 'scissor' : got.method === 'tail-fallback' ? 'tail-fallback' : 'stream';
      upsertAnswer(conversationId, turnId, provider, {
        provider,
        content: text,
        status: 'done',
        source: 'manual',
        method,
        finishedAt: Date.now(),
      });
    }
    return {
      provider,
      ok: !!text,
      method: got.method,
      error: text ? undefined : '页面当前没有可读取的回答文本',
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { provider, ok: false, error: msg };
  }
}

export async function manualGrabAll(
  conversationId: string,
  turnId: string,
  prompt: string,
  providers: ProviderName[]
): Promise<GrabOutcome[]> {
  const outs: GrabOutcome[] = [];
  for (const p of providers) {
    outs.push(await manualGrab(conversationId, turnId, p, prompt));
  }
  return outs;
}
