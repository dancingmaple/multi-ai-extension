// ============================================================
// workbench/utils/template.ts
// 占位符模板解析：把 `{{node_id.output}}`（或简写 `{{node_id}}`）
// 替换为对应上游节点的聚合输出文本。
// ============================================================

export interface NodeOutput {
  output: string;
  outputs?: Record<string, string>;
}

// 匹配 {{ some_id }} 或 {{ some_id.output }}，id 仅允许字母数字与下划线/连字符
const TOKEN_RE = /\{\{\s*([A-Za-z0-9_-]+)(?:\.output)?\s*\}\}/g;

/**
 * 渲染模板：用 outputs 中对应节点的 output 替换占位符。
 * 找不到的占位符替换为空串，避免抛出。
 */
export function renderTemplate(tpl: string, outputs: Record<string, NodeOutput>): string {
  if (!tpl) return '';
  return tpl.replace(TOKEN_RE, (_m, id: string) => {
    const o = outputs[id];
    return o?.output ?? '';
  });
}

/** 提取模板中引用的节点 id 列表（去重，保持出现顺序） */
export function extractReferencedNodes(tpl: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(tpl)) !== null) {
    const id = m[1];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}
