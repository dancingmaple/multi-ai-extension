// ============================================================
// workbench-test/TestConsole.tsx
// AI 请求/获取核心链路测试台：
//  - 选平台 → 右侧 iframe 内嵌预览该 AI 网页（验证页面可打开、content script 就绪）
//  - 输入 prompt → 「发起请求」：完整走 WORKBENCH_EXECUTE 链路（开/复用标签页 →
//    content script 执行 → 流式回传 → done），实时打印每阶段日志与耗时
//  - 「手动获取」：WORKBENCH_GRAB 读屏，验证「获取结果」链路并对比自动结果
//  - 使用固定 nodeId（test_node_xxx）独立标签页，不污染工作台节点
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderName, WorkbenchExecResult, WorkbenchGrabResult } from '../shared/types';
import { ALL_PROVIDERS, PROVIDER_LABELS } from '../shared/constants';
import { getProviderUrl } from '../shared/providers';

type LogLevel = 'info' | 'ok' | 'warn' | 'err';
interface LogLine {
  ts: number;
  level: LogLevel;
  text: string;
}

const TEST_NODE_ID = `test_node_${Date.now().toString(36)}`;

export function TestConsole() {
  const [provider, setProvider] = useState<ProviderName>('chatgpt');
  const [prompt, setPrompt] = useState('用一句话介绍你自己');
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  const [result, setResult] = useState<WorkbenchExecResult | null>(null);
  const [grabResult, setGrabResult] = useState<WorkbenchGrabResult | null>(null);
  const [t0, setT0] = useState(0);
  const logBoxRef = useRef<HTMLDivElement>(null);

  const push = (level: LogLevel, text: string) => {
    setLogs((prev) => [...prev, { ts: Date.now(), level, text }]);
  };

  // 日志自动滚到底
  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [logs]);

  // 监听 background 实时状态广播（PROVIDER_STATUS / STREAM_UPDATE / TASK_DONE / TASK_ERROR）
  // 仅显示当前测试任务的日志，避免与侧边栏任务串扰
  useEffect(() => {
    const taskPrefix = `wb_test_`;
    const listener = (msg: Record<string, unknown>) => {
      const t = msg.type as string;
      if (
        (t === 'PROVIDER_STATUS' || t === 'STREAM_UPDATE' || t === 'TASK_DONE' || t === 'TASK_ERROR') &&
        typeof msg.taskId === 'string' &&
        msg.taskId.startsWith(taskPrefix)
      ) {
        const p = msg.provider as string;
        const label = PROVIDER_LABELS[p as ProviderName] ?? p;
        const elapsed = t0 ? `+${((Date.now() - t0) / 1000).toFixed(1)}s` : '';
        switch (t) {
          case 'PROVIDER_STATUS':
            push('info', `[${label}] 状态 ${msg.status}${elapsed ? ' ' + elapsed : ''}${msg.detail ? ' · ' + msg.detail : ''}`);
            break;
          case 'STREAM_UPDATE':
            push('info', `[${label}] 流式内容 ${String(msg.content ?? '').length} 字${elapsed ? ' ' + elapsed : ''}`);
            break;
          case 'TASK_DONE':
            push('ok', `[${label}] ✅ 完成，最终内容 ${String(msg.finalContent ?? '').length} 字${elapsed ? ' ' + elapsed : ''}`);
            break;
          case 'TASK_ERROR':
            push('err', `[${label}] ❌ ${String(msg.errorMessage ?? msg.errorCode ?? '')}${elapsed ? ' ' + elapsed : ''}`);
            break;
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [t0]);

  // 发起请求：完整走 WORKBENCH_EXECUTE 链路
  const runExecute = async () => {
    if (busy || !prompt.trim()) return;
    setBusy(true);
    setResult(null);
    setGrabResult(null);
    const t = Date.now();
    setT0(t);
    push('info', `━━ 发起请求 → ${PROVIDER_LABELS[provider]}（nodeId=${TEST_NODE_ID}）━━`);
    push('info', `Prompt: ${prompt.slice(0, 80)}`);
    try {
      const resp = (await chrome.runtime.sendMessage({
        type: 'WORKBENCH_EXECUTE',
        nodeId: TEST_NODE_ID,
        nodeType: 'process',
        prompt,
        providers: [provider],
      })) as WorkbenchExecResult;
      const cost = ((Date.now() - t) / 1000).toFixed(1);
      if (resp && (resp.ok || (resp.outputs && Object.keys(resp.outputs).length > 0))) {
        push('ok', `✅ 执行成功，耗时 ${cost}s`);
      } else {
        const err = resp?.errors?.[provider] || '无响应';
        push('err', `❌ 执行失败（${cost}s）：${err}`);
      }
      setResult(resp);
    } catch (e) {
      push('err', `❌ 请求异常：${e instanceof Error ? e.message : String(e)}`);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  // 手动获取：WORKBENCH_GRAB 读屏
  const runGrab = async () => {
    if (grabbing) return;
    setGrabbing(true);
    push('info', `━━ 手动获取（读屏）→ ${PROVIDER_LABELS[provider]} ━━`);
    const t = Date.now();
    try {
      const resp = (await chrome.runtime.sendMessage({
        type: 'WORKBENCH_GRAB',
        nodeId: TEST_NODE_ID,
        prompt,
        providers: [provider],
        tabIds: result?.tabIds,
        urls: result?.urls,
      })) as WorkbenchGrabResult;
      const cost = ((Date.now() - t) / 1000).toFixed(1);
      const txt = resp?.outputs?.[provider];
      if (txt && txt.length > 0) {
        push('ok', `✅ 手动获取成功（${cost}s），${txt.length} 字`);
      } else {
        push('err', `❌ 手动获取失败（${cost}s）：${resp?.errors?.[provider] || '未读取到内容'}`);
      }
      setGrabResult(resp);
    } catch (e) {
      push('err', `❌ 获取异常：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGrabbing(false);
    }
  };

  const iframeUrl = useMemo(() => getProviderUrl(provider), [provider]);
  const autoText = result?.outputs?.[provider] ?? '';
  const grabText = grabResult?.outputs?.[provider] ?? '';

  return (
    <div className="tc-app">
      {/* ── 左侧控制台 ── */}
      <div className="tc-panel">
        <div className="tc-head">
          <span className="tc-logo">⚡</span>
          <span className="tc-title">AI 请求 / 获取核心链路测试台</span>
        </div>

        <div className="tc-form">
          <div className="tc-row">
            <label className="tc-label">平台</label>
            <select
              className="tc-select"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as ProviderName);
                setResult(null);
                setGrabResult(null);
              }}
            >
              {ALL_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
          </div>

          <div className="tc-row">
            <label className="tc-label">Prompt</label>
            <textarea
              className="tc-textarea"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="输入要测试的提问……"
            />
          </div>

          <div className="tc-acts">
            <button className="tc-btn tc-btn--primary" disabled={busy} onClick={() => void runExecute()}>
              {busy ? '请求中…' : '🚀 发起请求'}
            </button>
            <button className="tc-btn" disabled={grabbing} onClick={() => void runGrab()}>
              {grabbing ? '获取中…' : '🔍 手动获取'}
            </button>
            <button className="tc-btn tc-btn--ghost" onClick={() => setLogs([])}>
              清空日志
            </button>
          </div>
        </div>

        {/* 实时日志 */}
        <div className="tc-logs" ref={logBoxRef}>
          {logs.length === 0 ? (
            <div className="tc-logs-empty">选择平台 → 输入 Prompt → 点「发起请求」，实时日志会显示在这里</div>
          ) : (
            logs.map((l, i) => (
              <div key={i} className={`tc-log tc-log--${l.level}`}>
                <span className="tc-log-ts">{new Date(l.ts).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                <span>{l.text}</span>
              </div>
            ))
          )}
        </div>

        {/* 结果对比：自动抓取 vs 手动获取 */}
        {(autoText || grabText) && (
          <div className="tc-results">
            <div className="tc-result">
              <div className="tc-result__head tc-result__head--auto">自动结果（WORKBENCH_EXECUTE）</div>
              <pre className="tc-result__body">{autoText || '（空）'}</pre>
            </div>
            <div className="tc-result">
              <div className="tc-result__head tc-result__head--grab">手动获取（WORKBENCH_GRAB）</div>
              <pre className="tc-result__body">{grabText || '（空）'}</pre>
            </div>
          </div>
        )}
      </div>

      {/* ── 右侧 iframe 内嵌网页预览 ── */}
      <div className="tc-preview">
        <div className="tc-preview__head">
          <span>
            iframe 预览：<b>{PROVIDER_LABELS[provider]}</b>
          </span>
          <a className="tc-preview__open" href={iframeUrl} target="_blank" rel="noopener noreferrer">
            新标签打开 ↗
          </a>
        </div>
        <iframe
          key={provider}
          className="tc-preview__frame"
          src={iframeUrl}
          title={`${PROVIDER_LABELS[provider]} 预览`}
        />
      </div>
    </div>
  );
}
