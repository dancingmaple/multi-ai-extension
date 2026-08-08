// ============================================================
// workbench/utils/template.ts
// 占位符模板解析，支持两种引用方式：
//   1) 按节点 ID：   {{node_id}}          或  {{node_id.output}}
//   2) 按变量名：     {{变量名}}           或  {{变量名.output}}
//      变量名 = 节点上用户自定义的 varName，更可读、更稳定
//      （节点 ID 在增删/复制后会变化，变量名可固定）
// 解析优先级：变量名优先，其次节点 ID（避免变量名与节点 ID 冲突时误命中）。
// ============================================================

export interface NodeOutput {
  output: string;
  outputs?: Record<string, string>;
}

// 匹配 {{ name }} 或 {{ name.output }}，name 为合法标识符（字母/中文开头，后接字母/数字/下划线/连字符/中文）
const TOKEN_RE = /\{\{\s*([A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_.\u4e00-\u9fa5-]*?)(?:\.output)?\s*\}\}/g;

/**
 * 渲染模板。
 * @param tpl     模板文本，含 {{...}} 占位符
 * @param outputs 按节点 ID 索引的输出表
 * @param vars    按变量名索引的输出表（可选；优先级高于 outputs）
 * @returns 替换后的文本；找不到的占位符替换为空串，避免抛出
 */
export function renderTemplate(
  tpl: string,
  outputs: Record<string, NodeOutput>,
  vars: Record<string, NodeOutput> = {}
): string {
  if (!tpl) return '';
  return tpl.replace(TOKEN_RE, (_m, key: string) => {
    const o = vars[key] ?? outputs[key];
    return o?.output ?? '';
  });
}

/** 是否为合法的变量名（合法标识符：字母/中文开头，后接字母/数字/下划线/连字符/中文） */
export function isValidVarName(name: string): boolean {
  return /^[A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_.\u4e00-\u9fa5-]*$/.test(name);
}

/** 提取模板中引用的 key 列表（含节点 ID 与变量名，去重，保持出现顺序） */
export function extractReferencedNodes(tpl: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(tpl)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      keys.push(m[1]);
    }
  }
  return keys;
}
