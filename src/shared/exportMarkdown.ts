import type { Conversation, Answer, ProviderName, ExportLayout } from './types';
import { PROVIDER_LABELS } from './constants';

/** 模型展示名 */
export function nameOf(p: ProviderName): string {
  return PROVIDER_LABELS[p] || p;
}

/** 取摘要（用于轮标题） */
export function summarize(prompt: string, max = 60): string {
  const t = prompt.trim().replace(/\s+/g, ' ');
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/** 最小清洗：合并多余空行、清掉行尾空白 */
function clean(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function nowStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 导出文件名：会话标题-YYYYMMDD-HHmm.md */
export function fileNameFor(c: Conversation): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  const base = (c.title || 'conversation').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40);
  return `${base}-${stamp}.md`;
}

export interface ExportOptions {
  layout: ExportLayout;
  providers?: ProviderName[];
}

function sectionFor(a: Answer | undefined, p: ProviderName): string {
  if (!a || a.status !== 'done' || !a.content.trim()) {
    return `### ${nameOf(p)}\n\n（本轮未取得回答）\n`;
  }
  const tag = a.source === 'manual' ? '\n\n*（手动补录 · source: manual）*' : '';
  const urlLine = a.url ? `\n\n🔗 [原网页链接](${a.url})` : '';
  return `### ${nameOf(p)}\n\n${clean(a.content)}${tag}${urlLine}\n`;
}

function byTurn(c: Conversation, provs: ProviderName[]): string {
  return c.turns
    .map((t, i) => {
      const q = `## 轮 ${i + 1} · ${summarize(t.prompt)}\n\n**❓ 问题**：${t.prompt}\n`;
      const ans = provs.map((p) => sectionFor(t.answers[p], p)).join('\n');
      return `${q}\n${ans}\n\n---\n`;
    })
    .join('\n');
}

function byProvider(c: Conversation, provs: ProviderName[]): string {
  return provs
    .map((p) => {
      const header = `## ${nameOf(p)}\n`;
      const body = c.turns
        .map((t, i) => {
          const lead = `### 轮 ${i + 1} · ${summarize(t.prompt)}\n\n**❓ 问题**：${t.prompt}\n\n`;
          return lead + sectionFor(t.answers[p], p);
        })
        .join('\n');
      return `${header}\n${body}\n\n---\n`;
    })
    .join('\n');
}

function linksAppendix(c: Conversation, provs: ProviderName[]): string {
  const rows: string[] = [];
  for (const t of c.turns) {
    for (const p of provs) {
      const a = t.answers[p];
      if (a?.url) {
        rows.push(`- **${nameOf(p)}** · 轮 ${t.index + 1}: [${a.url}](${a.url})`);
      }
    }
  }
  if (rows.length === 0) return '';
  return `\n## 原始网页链接汇总\n\n${rows.join('\n')}\n`;
}

/** 把一段多轮对话拼成 Markdown（§11）。纯函数，便于单测。 */
export function buildMarkdown(c: Conversation, opt: ExportOptions): string {
  let provs = opt.providers && opt.providers.length > 0 ? opt.providers : [];
  if (provs.length === 0) provs = (Object.keys(c.threads) as ProviderName[]).filter(Boolean);
  if (provs.length === 0) {
    const keys = new Set<ProviderName>();
    for (const t of c.turns) for (const k of Object.keys(t.answers)) keys.add(k as ProviderName);
    provs = [...keys];
  }
  const head =
    `# ${c.title}\n\n` +
    `> 导出时间：${nowStamp()}  ·  轮数：${c.turns.length}  ·  模型：${provs.map(nameOf).join(', ')}\n` +
    `> 来源：Multi-AI Extension\n\n---\n`;
  const body = opt.layout === 'by-provider' ? byProvider(c, provs) : byTurn(c, provs);
  return head + body + linksAppendix(c, provs);
}
