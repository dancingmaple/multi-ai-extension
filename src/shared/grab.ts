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

/** 正文最短字符数。注意：判定的是「拼接后的字符数」，不是行数。 */
export const MIN_ANSWER_CHARS = 8;

export interface GrabResult {
  text: string;
  method: string;
  /** 失败时给出人话原因，供 UI 直接展示 */
  reason?: string;
}

export function extractAnswer(pageText: string, prompt: string): GrabResult {
  const cleanNbsp = (s: string) => s.replace(/\u00a0/g, ' ');
  const lines = cleanNbsp(pageText)
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (lines.length === 0) {
    return { text: '', method: 'none', reason: '页面没有可见文本（可能尚未加载完成或被登录墙拦截）' };
  }

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

  /**
   * 改进的 STOP 截断：要求**连续 3 行**都匹配 STOP 模式才截断，
   * 避免正文中某一行偶然命中 footer 关键词就把整个后半段回答丢掉。
   */
  const findStopIndex = (arr: string[]): number => {
    let consecutive = 0;
    for (let i = 0; i < arr.length; i++) {
      if (STOP_FOOTER.test(arr[i])) {
        consecutive++;
        if (consecutive >= 3) return i - 2;
      } else {
        consecutive = 0;
      }
    }
    return -1;
  };

  if (q >= 0 && q < lines.length - 1) {
    const rawBody = lines.slice(q + 1);
    const stopIdx = findStopIndex(rawBody);
    const body = trimHeadTail(stopIdx >= 0 ? rawBody.slice(0, stopIdx) : rawBody)
      .join('\n')
      .trim();
    if (body.length > MIN_ANSWER_CHARS) return { text: body, method: 'scissor' };
  }

  // 2) 兜底：取页面后半段（回答通常在下方），宁可多带上下文也不抓空
  const rawHalf = lines.slice(Math.floor(lines.length / 2));
  const stopIdx2 = findStopIndex(rawHalf);
  const half = trimHeadTail(stopIdx2 >= 0 ? rawHalf.slice(0, stopIdx2) : rawHalf)
    .join('\n')
    .trim();
  if (half.length > MIN_ANSWER_CHARS) return { text: half, method: 'tail-fallback' };

  // 3) 说明失败原因，别让用户面对一个空白的「抓取失败」
  const looksLoggedOut = /(^|\n)\s*(登录|登陆|Sign in|Log in|立即登录|扫码登录)\s*($|\n)/i.test(pageText);
  const reason = looksLoggedOut
    ? '页面疑似未登录（只读到登录入口），请先在该网页登录'
    : q < 0
      ? '页面里找不到你这次的提问文本——多半是消息没真正发出去，或页面还没渲染出这一轮对话'
      : '已定位到提问，但其后没有足量正文——回答可能仍在生成中，稍等再试';
  return { text: '', method: 'none', reason };
}
