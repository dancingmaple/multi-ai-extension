/**
 * 各适配器共用的 DOM 查询工具（#24 / #50）。
 *
 * 此前 chatgpt / gemini / deepseek / qwen / zai / doubao / custom / kimi
 * 各自抄了一份逐字相同的 isVisible，改一处得改八处；
 * 发送按钮的挑选也各写各的，且普遍踩到 querySelectorAll 的文档顺序陷阱。
 */

/** 元素是否真的可见：有尺寸、未被 display/visibility/opacity 隐藏 */
export function isElementVisible(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.01;
}

/**
 * 按「选择器优先级」挑一个可用按钮（#50）。
 *
 * 陷阱：`document.querySelectorAll('a, b, c')` 返回的是**文档顺序**而非
 * 选择器顺序，因此 `[...querySelectorAll(sels.join(','))].pop()` 既丢掉了
 * 精确选择器的优先级，又可能取到页面最末尾那个无关按钮（页脚 / 弹层残留）。
 *
 * 这里逐条选择器单独查询：命中即返回该选择器下**最后一个**可见且未禁用的
 * 元素（输入框附近的发送键通常排在同类按钮的末尾），命中不到再降级到下一条。
 */
export function findByPriority(
  selectors: string[],
  isVisible: (el: Element | null) => boolean = isElementVisible
): HTMLElement | undefined {
  for (const sel of selectors) {
    let matched: NodeListOf<Element>;
    try {
      matched = document.querySelectorAll(sel);
    } catch {
      continue; // 用户自定义选择器可能非法，跳过而不是让整条链路崩掉
    }
    const usable = [...matched].filter(
      (el) => isVisible(el) && !(el as HTMLButtonElement).disabled
    );
    if (usable.length) return usable[usable.length - 1] as HTMLElement;
  }
  return undefined;
}
