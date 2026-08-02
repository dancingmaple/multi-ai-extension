/**
 * 站点无关的「提问当剪刀」抓取法（§6）。
 * 只依赖一个物理事实：回答一定排在用户提问之后的可见文本里。
 * 纯函数，便于单测；externalBridge 注入版（grabInPage）与之逻辑一致、但需自包含。
 */

export const HEAD_META =
  /^(思考了|已思考|思考中|Thought for|Thinking|Reasoned|Reasoning|搜索了|联网搜索|Searching|Searched|Found\s+\d+|阅读了|Read\s+\d+|查看了|引用了|\d+\s*个\s*(网页|来源|结果|web\s*pages?)|DeepThink|Instant|深度思考|联网搜索中|搜索中|生成中)/i;

export const TAIL_META =
  /^(复制|点赞|点踩|重新生成|再生成|分享|引用|参考来源|参考|来源|DeepThink|联网搜索|Instant|搜索|给\s*豆包|发消息|发送|Copy|Like|Dislike|Share|Regenerate|Retry|Message|⎘|👍|👎|◎|↻)/i;

export function extractAnswer(
  pageText: string,
  prompt: string
): { text: string; method: string } {
  const cleanNbsp = (s: string) => s.replace(/ /g, ' ');
  const lines = cleanNbsp(pageText)
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const trim = (arr: string[]) => {
    while (arr.length && HEAD_META.test(arr[0])) arr.shift();
    while (arr.length && TAIL_META.test(arr[arr.length - 1])) arr.pop();
    return arr;
  };

  // 1) 剪刀法：从后定位最后一次提问，取其后
  const key = (prompt || '').replace(/\s/g, '').slice(0, 12);
  let q = -1;
  if (key) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].replace(/\s/g, '').includes(key)) {
        q = i;
        break;
      }
    }
  }
  if (q >= 0 && q < lines.length - 1) {
    const body = trim(lines.slice(q + 1)).join('\n').trim();
    if (body.length > 8) return { text: body, method: 'scissor' };
  }
  // 2) 兜底：取页面后半段（回答通常在下方），宁可多带上下文也不抓空
  const half = trim(lines.slice(Math.floor(lines.length / 2))).join('\n').trim();
  if (half.length > 8) return { text: half, method: 'tail-fallback' };
  return { text: '', method: 'none' };
}
