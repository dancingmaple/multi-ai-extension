// ============================================================
// workbench-test/TestConsole.tsx
// AI 请求/获取核心链路测试台：
//  - 选平台 → 右侧 iframe 内嵌预览该 AI 网页（验证页面可打开、content script 就绪）
//  - 输入 prompt → 「发起请求」：在可见 iframe 内执行（postMessage → content script）
//  - 「手动获取」：iframe 内就地读屏，验证「获取结果」链路并对比自动结果
//  - 「自定义 AI 网页」：输入任意网址 → 授权 → 点选输入框/发送/回答区域 →
//    验证通过后「保存为节点」，工作台等页面即可像内置平台一样直接选用
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderName, ElementRole, ProviderCustomSelectors } from '../shared/types';
import { PROVIDER_LABELS, EMBED_MSG, isCustomProvider } from '../shared/constants';
import {
  loadCustomSelectors,
  upsertCustomSelector,
  clearCustomSelector,
} from '../shared/customSelectors';
import {
  getEffectiveProviders,
  upsertCustomProvider,
  deleteCustomProvider,
  newCustomProviderId,
  getCustomProvider,
} from '../shared/customProviders';

/** 尚未保存的自定义网页用这个占位 id 与 content script 通信 */
const DRAFT = 'custom:draft';

type LogLevel = 'info' | 'ok' | 'warn' | 'err';
interface LogLine {
  ts: number;
  level: LogLevel;
  text: string;
}
interface ProviderOption {
  id: ProviderName;
  label: string;
  url: string;
  custom: boolean;
}

function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return 'https://' + s;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function TestConsole() {
  const [provider, setProvider] = useState<ProviderName>('chatgpt');
  const [prompt, setPrompt] = useState('用一句话介绍你自己');
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  // iframe 内执行模式的结果（postMessage 回传，不走 background）
  const [execText, setExecText] = useState('');
  const [grabTextState, setGrabTextState] = useState('');
  const [t0, setT0] = useState(0);
  const logBoxRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 手动选取元素状态
  const [pickRole, setPickRole] = useState<ElementRole | null>(null);
  const [savedSel, setSavedSel] = useState<ProviderCustomSelectors | null>(null);
  const [diag, setDiag] = useState<Record<string, unknown> | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  // 自定义 AI 网页
  const [options, setOptions] = useState<ProviderOption[]>([]);
  const [draftName, setDraftName] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [draftLoadedUrl, setDraftLoadedUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const push = useCallback((level: LogLevel, text: string) => {
    setLogs((prev) => [...prev, { ts: Date.now(), level, text }]);
  }, []);

  const labelOf = useCallback(
    (p: string): string => {
      if (p === DRAFT) return draftName.trim() || '自定义网页（草稿）';
      const hit = options.find((o) => o.id === p);
      return hit?.label ?? PROVIDER_LABELS[p] ?? p;
    },
    [options, draftName]
  );

  const refreshOptions = useCallback(async () => {
    const list = await getEffectiveProviders().catch(() => []);
    setOptions(list);
    return list;
  }, []);

  useEffect(() => {
    void refreshOptions();
  }, [refreshOptions]);

  // 加载当前 provider 已保存的自定义选择器
  useEffect(() => {
    let alive = true;
    loadCustomSelectors()
      .then((map) => {
        if (alive) setSavedSel(map[provider] ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [provider]);

  // 切到已保存的自定义节点时，把它的地址同步到草稿输入框（便于查看/编辑）
  useEffect(() => {
    if (provider === DRAFT || !isCustomProvider(provider)) return;
    void getCustomProvider(provider).then((c) => {
      if (c) {
        setDraftName(c.label);
        setDraftUrl(c.url);
      }
    });
  }, [provider]);

  // 日志自动滚到底
  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [logs]);

  // 监听 background 实时状态广播（标签页执行链路，保留兼容）
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
        const label = labelOf(p);
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
  }, [t0, push, labelOf]);

  const roleLabel = (r: ElementRole): string => (r === 'input' ? '输入框' : r === 'submit' ? '发送按钮' : '回答区域');

  // 监听 iframe 内 content script 回传的点选结果（postMessage，非 chrome.runtime）
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const data = ev.data as Record<string, unknown> | null;
      if (!data || data.__multiAi !== EMBED_MSG.PICK_RESULT) return;
      const role = data.role as ElementRole;
      const selector = (data.selector as string) || '';
      setPickRole(null);
      if (!selector) {
        push('warn', `点选「${roleLabel(role)}」已取消`);
        return;
      }
      void (async () => {
        const map = await upsertCustomSelector(provider, role, selector);
        setSavedSel(map[provider] ?? null);
        push('ok', `✅ 已保存「${roleLabel(role)}」选择器：${selector}`);
      })();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [provider, push]);

  // 开始手动点选：给 iframe 内的 content script 发 PICK_START
  const startPickEl = (role: ElementRole) => {
    setPickRole(role);
    const w = iframeRef.current?.contentWindow;
    if (w) {
      w.postMessage({ __multiAi: EMBED_MSG.PICK_START, provider, role }, '*');
      push('info', `👆 请在右侧预览页点选「${roleLabel(role)}」（元素会高亮，Esc 取消）`);
    } else {
      push('err', '预览 iframe 未就绪，无法点选');
    }
  };

  const stopPickEl = () => {
    const w = iframeRef.current?.contentWindow;
    if (w) w.postMessage({ __multiAi: EMBED_MSG.PICK_STOP, provider }, '*');
    setPickRole(null);
  };

  const clearOne = (role: ElementRole) => {
    void (async () => {
      const map = await clearCustomSelector(provider, role);
      setSavedSel(map[provider] ?? null);
      push('info', `已清除「${roleLabel(role)}」自定义选择器`);
    })();
  };

  // 一键诊断：扫描右侧预览页全部元素，回传结构化信息便于排查
  const runDiagnose = () => {
    const w = iframeRef.current?.contentWindow;
    if (!w) {
      push('err', '预览 iframe 未就绪，无法诊断');
      return;
    }
    setDiagLoading(true);
    setDiag(null);
    push('info', '🔬 正在诊断右侧预览页元素…');
    w.postMessage({ __multiAi: EMBED_MSG.DIAGNOSE, provider }, '*');
  };

  // 监听诊断结果回传
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const data = ev.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object') return;
      if (data.__multiAi === EMBED_MSG.DIAGNOSE_RESULT) {
        setDiagLoading(false);
        setDiag(data.result as Record<string, unknown>);
        push('ok', '✅ 诊断完成，已显示在下方面板');
      }
      if (data.__multiAi === EMBED_MSG.READY) {
        push('info', `🔌 预览页 content script 就绪（provider=${String(data.provider ?? '')}）`);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [push]);

  // 监听 iframe 内执行 / 抓取结果回传（postMessage 模式）
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const data = ev.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object') return;
      const m = data.__multiAi as string;

      // ── 执行状态 ──
      if (m === EMBED_MSG.EXECUTE_STATUS) {
        const status = (data.status as string) || '';
        const detail = (data.detail as string) || '';
        const p = (data.provider as string) || provider;
        const label = labelOf(p);
        const elapsed = t0 ? ` +${((Date.now() - t0) / 1000).toFixed(1)}s` : '';
        push('info', `[${label}] 状态: ${status}${detail ? ' · ' + detail : ''}${elapsed}`);
        if (status === 'done' || status === 'error' || status === 'login_required') setBusy(false);
      } else if (m === EMBED_MSG.EXECUTE_STREAM) {
        const content = (data.content as string) || '';
        setExecText(content);
      } else if (m === EMBED_MSG.EXECUTE_DONE) {
        const finalContent = (data.finalContent as string) || '';
        setExecText(finalContent);
        const cost = t0 ? ((Date.now() - t0) / 1000).toFixed(1) : '0';
        push('ok', `✅ 执行成功，耗时 ${cost}s，${finalContent.length} 字`);
        setBusy(false);
      } else if (m === EMBED_MSG.EXECUTE_ERROR) {
        const message = (data.errorMessage as string) || (data.errorCode as string) || '';
        const cost = t0 ? ((Date.now() - t0) / 1000).toFixed(1) : '0';
        push('err', `❌ 执行失败（${cost}s）：${message}`);
        setBusy(false);
      }
      // ── 抓取结果 ──
      else if (m === EMBED_MSG.GRAB_RESULT) {
        const text = (data.text as string) || '';
        const reason = (data.reason as string) || '';
        const cost = t0 ? ((Date.now() - t0) / 1000).toFixed(1) : '0';
        setGrabTextState(text);
        if (text && text.length > 0) {
          push('ok', `✅ 手动获取成功（${cost}s），${text.length} 字`);
        } else {
          push('err', `❌ 手动获取失败（${cost}s）：${reason || '未读取到内容'}`);
        }
        setGrabbing(false);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [t0, provider, push, labelOf]);

  // Kimi 等站点需要「受信任点击」：iframe 内的 content script 把发送钮在 iframe 内的
  // 矩形发来（__kimiSend），这里加上 iframe 在测试台里的偏移，转发给后台在「本标签页」
  // 正确位置点击发送（chrome.debugger 才能产生 isTrusted 事件）。
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const data = ev.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object') return;
      if (data.__kimiSend !== true || !data.rect) return;
      const rect = data.rect as { left: number; top: number; width: number; height: number };
      const frame = iframeRef.current?.getBoundingClientRect();
      const ax = (frame?.left ?? 0) + rect.left + rect.width / 2;
      const ay = (frame?.top ?? 0) + rect.top + rect.height / 2;
      push('info', `🖱 受信任点击：iframe内→本页(${Math.round(ax)}, ${Math.round(ay)})`);
      chrome.tabs.getCurrent((tab) => {
        const tabId = tab?.id;
        if (typeof tabId !== 'number') {
          push('err', '无法获取本页标签页 ID，受信任点击失败（测试台需以标签页/弹窗形式打开）');
          return;
        }
        chrome.runtime.sendMessage({ type: 'TRUSTED_CLICK', x: ax, y: ay, tabId }, () => {
          if (chrome.runtime.lastError) {
            push('err', '受信任点击失败：' + (chrome.runtime.lastError.message || '未知错误'));
          }
        });
      });
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [push]);

  // 发起请求：直接在右侧可见 iframe 内执行（postMessage，不走后台标签页）
  const runExecute = () => {
    if (busy || !prompt.trim()) return;
    setBusy(true);
    setExecText('');
    const t = Date.now();
    setT0(t);
    const taskId = `embed_exec_${Date.now().toString(36)}`;
    push('info', `━━ 发起请求 → ${labelOf(provider)}（iframe 内执行）━━`);
    push('info', `Prompt: ${prompt.slice(0, 80)}`);
    const w = iframeRef.current?.contentWindow;
    if (!w) {
      push('err', '预览 iframe 未就绪，无法发起请求');
      setBusy(false);
      return;
    }
    w.postMessage({ __multiAi: EMBED_MSG.EXECUTE, provider, prompt, taskId }, '*');
  };

  // 手动获取：在 iframe 内就地读屏（postMessage，不走后台标签页）
  const runGrab = () => {
    if (grabbing) return;
    setGrabbing(true);
    setGrabTextState('');
    push('info', `━━ 手动获取（读屏）→ ${labelOf(provider)} ━━`);
    setT0(Date.now());
    const reqId = `embed_grab_${Date.now().toString(36)}`;
    const w = iframeRef.current?.contentWindow;
    if (!w) {
      push('err', '预览 iframe 未就绪，无法获取');
      setGrabbing(false);
      return;
    }
    w.postMessage(
      {
        __multiAi: EMBED_MSG.GRAB,
        provider,
        prompt,
        reqId,
        // 刚点选好、还没保存成节点时，直接把回答区域选择器带过去
        responseSelector: savedSel?.response || '',
      },
      '*'
    );
  };

  // ── 自定义网页：授权 + 加载预览 ──────────────────────────
  const loadDraftPreview = () => {
    const url = normalizeUrl(draftUrl);
    const origin = originOf(url);
    if (!origin) {
      push('err', '网址无效，请输入形如 https://example.com/chat 的地址');
      return;
    }
    push('info', `🔐 正在申请访问权限：${origin}`);
    // 必须在用户手势中同步调用，不能 await 之后再调
    chrome.permissions.request({ origins: [origin + '/*'] }, (granted) => {
      if (!granted) {
        push('err', '未授权该网站，无法注入脚本/嵌入预览');
        return;
      }
      push('ok', `✅ 已授权 ${origin}，正在注册脚本与放行嵌入…`);
      chrome.runtime.sendMessage({ type: 'SYNC_CUSTOM_SITES' }, () => {
        setProvider(DRAFT);
        setDraftLoadedUrl(url);
        setExecText('');
        setGrabTextState('');
        push('info', '🌐 预览已加载。请依次点选「输入框 / 发送按钮 / 回答区域」，再试发一条验证。');
      });
    });
  };

  // ── 自定义网页：保存为可复用的 AI 节点 ────────────────────
  const saveAsNode = () => {
    const url = normalizeUrl(draftUrl);
    const label = draftName.trim();
    if (!label) {
      push('err', '请先填写节点名称');
      return;
    }
    if (!originOf(url)) {
      push('err', '网址无效');
      return;
    }
    if (!savedSel?.input || !savedSel?.submit) {
      push('err', '请至少点选「输入框」和「发送按钮」后再保存');
      return;
    }
    setSaving(true);
    void (async () => {
      try {
        // 编辑已有节点 → 沿用其 id；否则新建
        const editing = isCustomProvider(provider) && provider !== DRAFT;
        const id = editing ? provider : newCustomProviderId();
        await upsertCustomProvider({
          id,
          label,
          url,
          inputSelector: savedSel.input,
          submitSelector: savedSel.submit,
          responseSelector: savedSel.response,
        });
        // 把草稿态点选的选择器迁移到正式 id 下（执行时优先读它）
        if (!editing) {
          if (savedSel.input) await upsertCustomSelector(id, 'input', savedSel.input);
          if (savedSel.submit) await upsertCustomSelector(id, 'submit', savedSel.submit);
          if (savedSel.response) await upsertCustomSelector(id, 'response', savedSel.response);
          await clearCustomSelector(DRAFT);
        }
        await refreshOptions();
        chrome.runtime.sendMessage({ type: 'SYNC_CUSTOM_SITES' }, () => {});
        setProvider(id);
        push('ok', `✅ 已${editing ? '更新' : '保存'}节点「${label}」，工作台/侧边栏现在可以直接选用`);
      } catch (e) {
        push('err', '保存失败：' + (e instanceof Error ? e.message : String(e)));
      } finally {
        setSaving(false);
      }
    })();
  };

  const deleteNode = () => {
    if (!isCustomProvider(provider) || provider === DRAFT) return;
    const name = labelOf(provider);
    void (async () => {
      await deleteCustomProvider(provider);
      await clearCustomSelector(provider);
      await refreshOptions();
      chrome.runtime.sendMessage({ type: 'SYNC_CUSTOM_SITES' }, () => {});
      setProvider('chatgpt');
      push('info', `已删除自定义节点「${name}」`);
    })();
  };

  const currentOption = useMemo(() => options.find((o) => o.id === provider), [options, provider]);
  const iframeUrl = provider === DRAFT ? draftLoadedUrl : currentOption?.url ?? '';
  const autoText = execText;
  const grabText = grabTextState;
  const isCustomSel = isCustomProvider(provider);

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
                setProvider(e.target.value);
                setExecText('');
                setGrabTextState('');
                setDiag(null);
              }}
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.custom ? '🧩 ' + o.label : o.label}
                </option>
              ))}
              <option value={DRAFT}>➕ 自定义网页（新建）</option>
            </select>
          </div>

          {/* ── 自定义 AI 网页 ── */}
          <div className="tc-pick">
            <div className="tc-pick__title">
              自定义 AI 网页
              <span className="tc-pick__hint">授权 → 点选三要素 → 验证 → 保存为节点</span>
            </div>
            <div className="tc-row">
              <label className="tc-label">名称</label>
              <input
                className="tc-select"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="例如：我的 Claude"
              />
            </div>
            <div className="tc-row">
              <label className="tc-label">网址</label>
              <input
                className="tc-select"
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                placeholder="https://example.com/chat"
              />
            </div>
            <div className="tc-pick__btns">
              <button className="tc-pick__btn" onClick={loadDraftPreview}>
                🌐 授权并加载预览
              </button>
              <button className="tc-pick__btn" disabled={saving} onClick={saveAsNode}>
                {saving ? '保存中…' : '💾 保存为 AI 节点'}
              </button>
              {isCustomSel && provider !== DRAFT && (
                <button className="tc-pick__btn" onClick={deleteNode}>
                  🗑 删除该节点
                </button>
              )}
            </div>
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
            <button className="tc-btn tc-btn--primary" disabled={busy} onClick={runExecute}>
              {busy ? '请求中…' : '🚀 发起请求'}
            </button>
            <button className="tc-btn" disabled={grabbing} onClick={runGrab}>
              {grabbing ? '获取中…' : '🔍 手动获取'}
            </button>
            <button className="tc-btn" disabled={diagLoading} onClick={runDiagnose}>
              {diagLoading ? '诊断中…' : '🔬 诊断页面'}
            </button>
            <button className="tc-btn tc-btn--ghost" onClick={() => setLogs([])}>
              清空日志
            </button>
          </div>

          {/* ── 手动修复：点选元素（适配网页 UI 变化 / 自定义网页录入） ── */}
          <div className="tc-pick">
            <div className="tc-pick__title">
              元素定位（{labelOf(provider)}）
              <span className="tc-pick__hint">在右侧预览页点选，永久保存</span>
            </div>
            <div className="tc-pick__btns">
              {(['input', 'submit', 'response'] as ElementRole[]).map((role) => (
                <button
                  key={role}
                  className={'tc-pick__btn' + (pickRole === role ? ' is-active' : '')}
                  onClick={() => (pickRole === role ? stopPickEl() : startPickEl(role))}
                >
                  {pickRole === role ? '点选中…' : '选取' + roleLabel(role)}
                </button>
              ))}
            </div>
            <div className="tc-pick__list">
              {(['input', 'submit', 'response'] as ElementRole[]).map((role) => {
                const sel = savedSel?.[role];
                return (
                  <div key={role} className="tc-pick__item">
                    <span className="tc-pick__role">{roleLabel(role)}</span>
                    <code className="tc-pick__sel">{sel || '（默认）'}</code>
                    {sel && (
                      <button className="tc-pick__del" title="清除自定义" onClick={() => clearOne(role)}>
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
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
              <div className="tc-result__head tc-result__head--auto">自动结果（流式抓取）</div>
              <pre className="tc-result__body">{autoText || '（空）'}</pre>
            </div>
            <div className="tc-result">
              <div className="tc-result__head tc-result__head--grab">手动获取（读屏）</div>
              <pre className="tc-result__body">{grabText || '（空）'}</pre>
            </div>
          </div>
        )}

        {/* 页面诊断面板 */}
        {diag && (
          <div className="tc-diag">
            <div className="tc-diag__head">页面诊断结果（{labelOf(provider)}）</div>
            <div className="tc-diag__summary">
              输入框候选 {((diag.inputCandidates as unknown[]) || []).length} · 按钮 {(diag.total as Record<string, number>)?.button ?? 0} · URL {(diag.url as string)?.slice(0, 50)}
            </div>
            <details className="tc-diag__details" open>
              <summary>输入框候选（按面积排序，仅可见）</summary>
              <pre className="tc-diag__pre">{JSON.stringify(diag.inputCandidates, null, 1)}</pre>
            </details>
            <details className="tc-diag__details" open>
              <summary>按钮候选（仅可见）</summary>
              <pre className="tc-diag__pre">{JSON.stringify(diag.buttonCandidates, null, 1)}</pre>
            </details>
            <details className="tc-diag__details">
              <summary>AI 猜测（输入框 / 发送按钮）</summary>
              <pre className="tc-diag__pre">{JSON.stringify(diag.guess, null, 1)}</pre>
            </details>
          </div>
        )}
      </div>

      {/* ── 右侧 iframe 内嵌网页预览 ── */}
      <div className="tc-preview">
        <div className="tc-preview__head">
          <span>
            iframe 预览：<b>{labelOf(provider)}</b>
          </span>
          {iframeUrl && (
            <a className="tc-preview__open" href={iframeUrl} target="_blank" rel="noopener noreferrer">
              新标签打开 ↗
            </a>
          )}
        </div>
        {iframeUrl ? (
          <iframe
            key={provider + '|' + iframeUrl}
            ref={iframeRef}
            className="tc-preview__frame"
            src={iframeUrl}
            title={`${labelOf(provider)} 预览`}
          />
        ) : (
          <div className="tc-logs-empty" style={{ padding: 24 }}>
            填写「名称 + 网址」后点「授权并加载预览」，即可开始点选元素并保存为新的 AI 节点。
          </div>
        )}
      </div>
    </div>
  );
}
