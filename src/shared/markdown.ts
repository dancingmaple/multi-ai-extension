/**
 * 极简 Markdown 渲染（用于答案阅读弹窗）。
 * 先整体 HTML 转义，再做安全的行内/块级替换，避免 XSS。
 * 支持：标题、引用、有序/无序列表、代码块、行内代码、加粗、斜体、链接。
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(text: string): string {
  let t = escapeHtml(text);
  // 行内代码
  t = t.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  // 加粗
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // 斜体
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // 链接 [text](url) —— 仅允许 http(s)
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, txt, url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${txt}</a>`;
  });
  return t;
}

export function renderMarkdown(src: string): string {
  const lines = (src || '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  let inCode = false;
  let codeBuf: string[] = [];

  const flushCode = () => {
    if (codeBuf.length) {
      out.push(`<pre class="md-code"><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
      codeBuf = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // 代码块围栏
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
      }
      i++;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i++;
      continue;
    }

    // 空行
    if (!line.trim()) {
      i++;
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // 无序列表
    if (/^\s*[-*]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        buf.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${buf.join('')}</ul>`);
      continue;
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(`<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${buf.join('')}</ol>`);
      continue;
    }

    // 段落（聚合连续非块级行）
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^```/.test(lines[i])
    ) {
      para.push(inline(lines[i]));
      i++;
    }
    if (para.length) out.push(`<p>${para.join('<br/>')}</p>`);
  }

  if (inCode) flushCode();
  return out.join('\n');
}
