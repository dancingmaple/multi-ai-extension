/**
 * 站点无关的「提问当剪刀」抓取法（§6）。
 * 只依赖一个物理事实：回答一定排在用户提问之后的可见文本里。
 * 纯函数，便于单测；externalBridge 注入版（grabInPage）与之逻辑一致、但需自包含。
 */

export const HEAD_META =
  /^(思考了|已思考|思考中|Thought for|Thinking|Reasoned|Reasoning|搜索了|联网搜索|Searching|Searched|Found\s+\d+|阅读了|Read\s+\d+|查看了|引用了|\d+\s*个\s*(网页|来源|结果|web\s*pages?)|DeepThink|Instant|深度思考|联网搜索中|搜索中|生成中)/i;

export const TAIL_META =
  /^(复制|点赞|点踩|重新生成|再生成|分享|引用|参考来源|参考|来源|DeepThink|联网搜索|Instant|搜索|给\s*豆包|发消息|发送|Copy|Like|Dislike|Share|Regenerate|Retry|Message|⎘|👍|👎|◎|↻)/i;

/**
 * 页面固定 footer / 免责声明 / AI 声明 / 法律链接等，一定不是回答正文。
 * 一旦在回答后出现，立即截断（取它之前的内容）。
 */
export const STOP_FOOTER =
  /^(Gemini is AI|Gemini may display inaccurate|Gemini Apps|Gemini Advanced|Gemini can make mistakes|Gemini is experimental|I'm Gemini|以上(?:内容|回答|结果|文本).{0,30}(?:AI|人工智能).{0,20}(?:生成|提供)|(?:AI|人工智能).{0,20}(?:生成|提供).{0,20}(?:仅供参考|内容|回答)|本回答由.{0,10}(?:AI|人工智能).{0,10}生成|以上内容(?:仅供|均由AI生成|由AI生成)|结果仅供参考|免责声明|免责说明|隐私政策|隐私条款|用户协议|使用条款|服务条款|Cookie|Feedback|报告问题|ICP备|京ICP|沪ICP|粤ICP|苏ICP|备案号|技术支持|联系我们|关于我们|登录|注册|登录\/注册|立即登录|帮助中心|意见反馈|最高|技术博客|快速|图像生成|视频生成|AI\s*播客|帮我写作|翻译|音乐生成|深入研究)$/i;

export function extractAnswer(
  pageText: string,
  prompt: string
): { text: string; method: string } {
  const cleanNbsp = (s: string) => s.replace(/\u00a0/g, ' ');
  const lines = cleanNbsp(pageText)
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const trimHeadTail = (arr: string[]) => {
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
    const rawBody = lines.slice(q + 1);
    const stopIdx = rawBody.findIndex((l) => STOP_FOOTER.test(l));
    const body = trimHeadTail(stopIdx >= 0 ? rawBody.slice(0, stopIdx) : rawBody);
    if (body.length > 8) return { text: body.join('\n').trim(), method: 'scissor' };
  }

  // 2) 兜底：取页面后半段（回答通常在下方），宁可多带上下文也不抓空
  const rawHalf = lines.slice(Math.floor(lines.length / 2));
  const stopIdx2 = rawHalf.findIndex((l) => STOP_FOOTER.test(l));
  const half = trimHeadTail(stopIdx2 >= 0 ? rawHalf.slice(0, stopIdx2) : rawHalf);
  if (half.length > 8) return { text: half.join('\n').trim(), method: 'tail-fallback' };

  return { text: '', method: 'none' };
}
