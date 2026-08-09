// ============================================================
// tests/grab.test.ts — 抓取文本处理纯函数单测
// 运行：node --experimental-strip-types --test tests/*.test.ts
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAnswer } from '../src/shared/grab.ts';

test('extractAnswer: 剪刀法——从提问后切出回答', () => {
  const page =
    '用户：今天天气如何\nAI：今天晴，22 度，适合外出。\n版权信息';
  const r = extractAnswer(page, '今天天气如何');
  assert.equal(r.method, 'scissor');
  assert.ok(r.text.includes('今天晴'));
  // 单行页脚不触发截断（STOP 需连续 3 行才切，防误切正文）
  assert.ok(r.text.includes('版权信息'));
});

test('extractAnswer: 找不到提问时回退取后半段', () => {
  const page = '第一段内容\n第二段内容\n第三段内容';
  const r = extractAnswer(page, '完全不存在的提问');
  assert.ok(r.method === 'tail-fallback' || r.method === 'none');
});

test('extractAnswer: 空页面返回 none', () => {
  const r = extractAnswer('   ', '提问');
  assert.equal(r.method, 'none');
  assert.ok(r.reason);
});

test('extractAnswer: 裁掉页脚免责声明（连续 3 行才截断）', () => {
  const page = [
    '提问：写首诗',
    'AI：床前明月光',
    '疑是地上霜',
    '结果仅供参考',
    '免责声明',
    '隐私政策',
  ].join('\n');
  const r = extractAnswer(page, '写首诗');
  assert.ok(r.text.includes('床前明月光'));
  assert.ok(!r.text.includes('隐私政策'));
});
