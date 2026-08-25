// ============================================================
// tests/workflowUtils.test.ts — 工作台纯函数（拓扑/状态机）单测
// 运行：node --experimental-strip-types --test tests/*.test.ts
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  topoOrder,
  descendants,
  joinOutputs,
  sanitizeNodes,
  transitionStatus,
  canTransition,
} from '../src/workbench/store/workflowUtils.ts';

const mkNode = (id: string) => ({
  id,
  type: 'process' as const,
  position: { x: 0, y: 0 },
  data: {
    label: id,
    nodeType: 'process' as const,
    prompt: '',
    providers: [],
    output: '',
    outputs: {},
    status: 'idle' as const,
  },
});

test('topoOrder: 按依赖排序（先 start 后 end）', () => {
  const start = mkNode('a');
  const mid = mkNode('b');
  const end = mkNode('c');
  const order = topoOrder([end, start, mid], [
    { id: 'e1', source: 'a', target: 'b' },
    { id: 'e2', source: 'b', target: 'c' },
  ]);
  const ids = order.map((n) => n.id);
  assert.deepEqual(ids, ['a', 'b', 'c']);
});

test('topoOrder: 存在环时剩余节点追加末尾（不崩溃）', () => {
  const a = mkNode('a');
  const b = mkNode('b');
  const order = topoOrder([a, b], [
    { id: 'e1', source: 'a', target: 'b' },
    { id: 'e2', source: 'b', target: 'a' },
  ]);
  assert.equal(order.length, 2);
});

test('descendants: 取可达后代（含自身）', () => {
  const desc = descendants('a', [
    { id: 'e1', source: 'a', target: 'b' },
    { id: 'e2', source: 'b', target: 'c' },
    { id: 'e3', source: 'x', target: 'y' },
  ]);
  assert.deepEqual([...desc].sort(), ['a', 'b', 'c']);
});

test('joinOutputs: 仅拼接有内容的家', () => {
  const out = joinOutputs(
    { chatgpt: '回答A', gemini: '', deepseek: '回答C' },
    ['chatgpt', 'gemini', 'deepseek']
  );
  assert.ok(out.includes('回答A'));
  assert.ok(!out.includes('回答B'));
  assert.ok(out.includes('回答C'));
});

test('sanitizeNodes: 去掉瞬态字段', () => {
  const n = { ...mkNode('a'), selected: true, measured: { width: 100, height: 50 }, dragging: false };
  const clean = sanitizeNodes([n]);
  assert.equal((clean[0] as Record<string, unknown>).selected, undefined);
  assert.equal((clean[0] as Record<string, unknown>).measured, undefined);
});

test('状态机: 合法迁移', () => {
  assert.equal(canTransition('idle', 'running'), true);
  assert.equal(canTransition('running', 'reviewing'), true);
  assert.equal(canTransition('reviewing', 'success'), true);
  assert.equal(canTransition('error', 'running'), true);
});

test('状态机: 非法迁移被拦截并保留原状态', () => {
  assert.equal(canTransition('idle', 'success'), true); // 起点/终点直接成功
  assert.equal(transitionStatus('running', 'reviewing'), 'reviewing'); // 合法
  assert.equal(transitionStatus('reviewing', 'running'), 'running'); // 重试合法
  assert.equal(transitionStatus('running', 'success'), 'running'); // 非法→保留原状态
  assert.equal(transitionStatus('idle', 'reviewing'), 'idle'); // 非法→保留原状态
});
