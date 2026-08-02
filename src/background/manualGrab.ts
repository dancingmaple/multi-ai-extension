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
 * 裁掉头尾元信息 + 页面 footer/免责声明。宁可抓糙，绝不抓空。
 */
function grabInPage(args: { prompt: string }): { text: string; method: string } {
  const HEAD =
    /^(思考了|已思考|思考中|Thought for|Thinking|Reasoned|Reasoning|搜索了|联网搜索|Searching|Searched|Found\s+\d+|阅读了|Read\s+\d+|查看了|引用了|\d+\s*个\s*(网页|来源|结果|web\s*pages?)|DeepThink|Instant|深度思考|联网搜索中|搜索中|生成中)/i;
  const TAIL =
    /^(复制|点赞|点踩|重新生成|再生成|分享|引用|参考来源|参考|来源|DeepThink|联网搜索|Instant|搜索|给\s*豆包|发消息|发送|Copy|Like|Dislike|Share|Regenerate|Retry|Message|⎘|👍|👎|◎|↻)/i;
  const STOP =
    /^(Gemini is AI|Gemini may display inaccurate|Gemini Apps|Gemini Advanced|Gemini can make mistakes|Gemini is experimental|I'm Gemini|以上(?:内容|回答|结果|文本).{0,30}(?:AI|人工智能).{0,20}(?:生成|提供)|(?:AI|人工智能).{0,20}(?:生成|提供).{0,20}(?:仅供参考|内容|回答)|本回答由.{0,10}(?:AI|人工智能).{0,10}生成|以上内容仅供|结果仅供参考|免责声明|免责说明|隐私政策|隐私条款|用户协议|使用条款|服务条款|Cookie|Feedback|报告问题|ICP备|京ICP|沪ICP|粤ICP|苏ICP|备案号|技术支持|联系我们|关于我们|登录|注册|登录\/注册|立即登录|帮助中心|意见反馈)$/i;
  const clean = (s: string) => s.replace(/\u00a0/g, ' ');
  const root = (document.querySelector('main') || document.body) as HTMLElement;
  const raw = clean(root.innerText || document.body.innerText || '');
  const lines = raw.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);

  const trimHeadTail = (arr: string[]) => {
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
    const rawBody = lines.slice(q + 1);
    const stopIdx = rawBody.findIndex((l) => STOP.test(l));
    const body = trimHeadTail(stopIdx >= 0 ? rawBody.slice(0, stopIdx) : rawBody).join('\n').trim();
    if (body.length > 8) return { text: body, method: 'scissor' };
  }
  const rawHalf = lines.slice(Math.floor(lines.length / 2));
  const stopIdx2 = rawHalf.findIndex((l) => STOP.test(l));
  const half = trimHeadTail(stopIdx2 >= 0 ? rawHalf.slice(0, stopIdx2) : rawHalf).join('\n').trim();
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
