// ============================================================
// tests/template.test.ts — 模板渲染纯函数单测
// 运行：node --experimental-strip-types --test tests/*.test.ts
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, isValidVarName, extractReferencedNodes } from '../src/workbench/utils/template.ts';

const outputs = {
  n_1: { output: '第一个输出', outputs: {} },
  n_2: { output: '第二个输出', outputs: {} },
};
const vars = {
  summary: { output: '摘要内容', outputs: {} },
};

test('renderTemplate: 按变量名替换', () => {
  assert.equal(renderTemplate('摘要：{{summary}}', outputs, vars), '摘要：摘要内容');
});

test('renderTemplate: 按节点 ID 替换', () => {
  assert.equal(renderTemplate('输出：{{n_1.output}}', outputs), '输出：第一个输出');
});

test('renderTemplate: 变量名优先级高于节点 ID', () => {
  const both = { ...outputs, summary: { output: '节点ID同名输出', outputs: {} } };
  assert.equal(renderTemplate('{{summary}}', both, vars), '摘要内容');
});

test('renderTemplate: 未找到的占位符替换为空串（不抛错）', () => {
  assert.equal(renderTemplate('a{{missing}}b', outputs), 'ab');
});

test('renderTemplate: 空模板返回空串', () => {
  assert.equal(renderTemplate('', outputs), '');
});

test('renderTemplate: 支持空格/花括号内空白', () => {
  assert.equal(renderTemplate('{{ summary }}', outputs, vars), '摘要内容');
});

test('isValidVarName: 合法变量名', () => {
  assert.equal(isValidVarName('summary'), true);
  assert.equal(isValidVarName('汇总2'), true);
  assert.equal(isValidVarName('_x'), true);
});

test('isValidVarName: 非法变量名', () => {
  assert.equal(isValidVarName('2abc'), false);
  assert.equal(isValidVarName('a b'), false);
  assert.equal(isValidVarName(''), false);
});

test('isValidVarName: 连字符与点允许（设计如此）', () => {
  // 正则允许连字符/点（与模板解析 TOKEN_RE 一致），保持为合法
  assert.equal(isValidVarName('a-b'), true);
  assert.equal(isValidVarName('a.b'), true);
});

test('extractReferencedNodes: 提取引用 key 去重保序', () => {
  assert.deepEqual(
    extractReferencedNodes('{{a}} 与 {{b.output}} 与 {{a}}'),
    ['a', 'b']
  );
});
