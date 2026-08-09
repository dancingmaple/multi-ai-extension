// ============================================================
// workbench/components/nodes/NodeShell.tsx
// 四种节点的共享外壳：标题栏 + 状态徽标 + 提示词编辑 +
// 可选 AI 平台选择 + 输出区（逐家可编辑/复制）+ 运行/采纳/重试操作 + 连线桩。
// ============================================================
import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position } from 'reactflow';
import type { WorkbenchNodeData } from '../../store/workflowStore';
import { useWorkflowStore } from '../../store/workflowStore';
import { ALL_PROVIDERS, PROVIDER_LABELS } from '@shared/constants';
import { isValidVarName } from '../../utils/template';
import type { ProviderName } from '@shared/types';
import {
  SparkIcon,
  TerminalIcon,
  GearIcon,
  ArrowRightIcon,
  PlayIcon,
  StopIcon,
  RefreshIcon,
  CheckIcon,
  ArrowClockIcon,
  CopyIcon,
  LinkIcon,
  PlusIcon,
} from '../icons';

const STATUS_LABEL: Record<string, string> = {
  idle: '空闲',
  running: '运行中',
  reviewing: '待采纳',
  success: '成功',
  error: '失败',
};

export type Accent = 'start' | 'summarize' | 'process' | 'end';

const ACCENT_ICON: Record<Accent, (p: { size?: number }) => React.ReactNode> = {
  start: SparkIcon,
  summarize: TerminalIcon,
  process: GearIcon,
  end: ArrowRightIcon,
};

interface Props {
  id: string;
  data: WorkbenchNodeData;
  selected?: boolean;
  showTarget?: boolean;
  showSource?: boolean;
  editablePrompt?: boolean;
  showProviders?: boolean;
  accent: Accent;
}

/**
 * 逐家回答的可编辑框：本地草稿为唯一真源，输入时只改本地 state（光标不受
 * ReactFlow 节点重渲染影响），失焦后跟随外部 store 变化（如手动获取补全）。
 */
const EditableAnswer = memo(function EditableAnswer({
  value,
  label,
  copied,
  onCopy,
  onEdit,
}: {
  value: string;
  label: string;
  copied: boolean;
  onCopy: () => void;
  onEdit: (text: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  return (
    <div className="wb-answer">
      <div className="wb-answer__head">
        <span className="wb-answer__name">{label}</span>
        <button type="button" className="wb-copy" onClick={onCopy}>
          {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <textarea
        className="wb-answer__edit nodrag nowheel"
        rows={5}
        value={draft}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setDraft(value);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          onEdit(e.target.value);
        }}
      />
    </div>
  );
});

export const NodeShell = memo(function NodeShell({
  id,
  data,
  selected,
  showTarget = true,
  showSource = true,
  editablePrompt = true,
  showProviders = false,
  accent,
}: Props) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const executeNode = useWorkflowStore((s) => s.executeNode);
  const confirmNode = useWorkflowStore((s) => s.confirmNode);
  const confirmAndContinue = useWorkflowStore((s) => s.confirmAndContinue);
  const grabNodeAnswers = useWorkflowStore((s) => s.grabNodeAnswers);
  const updateNodeOutput = useWorkflowStore((s) => s.updateNodeOutput);
  const cancelAutoGrab = useWorkflowStore((s) => s.cancelAutoGrab);
  const allNodes = useWorkflowStore((s) => s.nodes);
  // 节点运行按钮：既要看本节点状态，也要看全局工作流是否在跑；
  // 否则用户在「▶ 运行工作流」中途点节点按钮会并发触发，造成"上一节点还没结束下个就开始"
  const globalRunning = useWorkflowStore((s) => s.running);
  const running = data.status === 'running' || (globalRunning && data.status === 'idle');
  const [grabbing, setGrabbing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [refOpen, setRefOpen] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // ── 本地草稿：提示词 / 变量名（输入时只改本地，避免光标被重渲染重置） ──
  const [promptDraft, setPromptDraft] = useState(data.prompt);
  const promptFocused = useRef(false);
  useEffect(() => {
    if (!promptFocused.current) setPromptDraft(data.prompt);
  }, [data.prompt]);

  const [varNameDraft, setVarNameDraft] = useState(data.varName ?? '');
  const varFocused = useRef(false);
  useEffect(() => {
    if (!varFocused.current) setVarNameDraft(data.varName ?? '');
  }, [data.varName]);

  // 自动获取秒数：本地草稿（数字输入框同样避免光标重置）
  const [delayDraft, setDelayDraft] = useState(data.grabDelay === undefined ? '' : String(data.grabDelay));
  const delayFocused = useRef(false);
  useEffect(() => {
    if (!delayFocused.current)
      setDelayDraft(data.grabDelay === undefined ? '' : String(data.grabDelay));
  }, [data.grabDelay]);

  // 自动获取倒计时（本地心跳，仅用于显示）
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!data.autoGrabAt) return;
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, [data.autoGrabAt]);
  const remainSec = data.autoGrabAt
    ? Math.max(0, Math.ceil((data.autoGrabAt - now) / 1000))
    : 0;

  // 在浏览器新标签打开 AI 会话（用于回看/溯源）
  const openUrl = (url?: string) => {
    if (url) chrome.tabs.create({ url, active: true }).catch(() => window.open(url, '_blank'));
  };

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
    } catch {
      /* 剪贴板不可用时静默 */
    }
  };

  // 真正拿到正文的平台数（空字符串不算已回答，防止「显示 3/3 实际 1 条」）
  const answeredCount = data.providers.filter(
    (p) => data.outputs[p] && data.outputs[p]!.length > 0
  ).length;
  const canGrab =
    showProviders &&
    data.providers.length > 0 &&
    data.status !== 'idle' &&
    data.status !== 'running';
  const missingCount = data.providers.length - answeredCount;

  const onGrab = async () => {
    if (grabbing) return;
    setGrabbing(true);
    try {
      await grabNodeAnswers(id);
    } finally {
      setGrabbing(false);
    }
  };

  // 引用上游输出：在提示词光标处插入 {{变量名}} 或 {{节点id}}
  const insertRef = (ref: string) => {
    const token = `{{${ref}}}`;
    const ta = promptRef.current;
    const start = ta?.selectionStart ?? data.prompt.length;
    const end = ta?.selectionEnd ?? data.prompt.length;
    const next = data.prompt.slice(0, start) + token + data.prompt.slice(end);
    setPromptDraft(next); // 同步本地草稿，避免光标跳末尾
    updateNodeData(id, { prompt: next });
    setRefOpen(false);
    requestAnimationFrame(() => {
      if (ta) {
        ta.focus();
        const pos = start + token.length;
        ta.setSelectionRange(pos, pos);
      }
    });
  };

  // 可引用的上游节点：有变量名或已有输出的其它节点
  const refCandidates = allNodes
    .filter((n) => n.id !== id)
    .filter((n) => (n.data.varName && isValidVarName(n.data.varName)) || (n.data.output && n.data.output.length > 0))
    .map((n) => ({
      id: n.id,
      label: n.data.label,
      ref: n.data.varName && isValidVarName(n.data.varName) ? n.data.varName : n.id,
      hasOutput: !!(n.data.output && n.data.output.length > 0),
    }));

  return (
    <div className={`wb-node wb-node--${accent} ${selected ? 'ring-2 ring-sky-400' : ''}`}>
      {showTarget && <Handle type="target" position={Position.Left} />}

      <div className="wb-node__header">
        {(() => {
          const NodeIcon = ACCENT_ICON[accent];
          return (
            <span className="wb-node__icon" aria-hidden><NodeIcon size={12} /></span>
          );
        })()}
        <span className="truncate">{data.label}</span>
        <span className={`wb-node__status wb-node__status--${data.status}`}>
          <span className="wb-node__dot" aria-hidden />
          {STATUS_LABEL[data.status] ?? data.status}
        </span>
      </div>

      <div className="wb-node__body">
        {/* 变量名：设置后，下游节点可用 {{变量名}} 引用本节点输出 */}
        <div className="wb-varname">
          <label className="wb-varname__label">变量名</label>
          <input
            className={`wb-input wb-varname__input nodrag nowheel ${
              varNameDraft && !isValidVarName(varNameDraft) ? 'wb-input--invalid' : ''
            }`}
            value={varNameDraft}
            placeholder="如 summary（下游用 {{summary}} 引用）"
            onFocus={() => (varFocused.current = true)}
            onBlur={() => {
              varFocused.current = false;
              setVarNameDraft(data.varName ?? '');
            }}
            onChange={(e) => {
              setVarNameDraft(e.target.value);
              updateNodeData(id, { varName: e.target.value });
            }}
          />
          {varNameDraft && !isValidVarName(varNameDraft) && (
            <div className="wb-varname__warn">! 变量名需以字母/中文开头，仅含字母数字下划线</div>
          )}
          {varNameDraft && isValidVarName(varNameDraft) && (
            <div className="wb-varname__hint">下游可用 <code>{`{{${varNameDraft}}}`}</code> 引用</div>
          )}
        </div>

        {editablePrompt && (
          <div className="wb-prompt-wrap">
            <textarea
              ref={promptRef}
              className="wb-input nodrag nowheel"
              rows={4}
              value={promptDraft}
              onFocus={() => (promptFocused.current = true)}
              onBlur={() => {
                promptFocused.current = false;
                setPromptDraft(data.prompt);
              }}
              onChange={(e) => {
                setPromptDraft(e.target.value);
                updateNodeData(id, { prompt: e.target.value });
              }}
              placeholder="支持 {{node_id.output}} 引用上游输出"
            />
            {refCandidates.length > 0 && (
              <div className="wb-ref">
                <button
                  type="button"
                  className="wb-ref__btn nodrag"
                  title="引用其它节点的输出到当前光标"
                  onClick={() => setRefOpen((v) => !v)}
                >
                  <PlusIcon size={11} />
                  引用上游
                </button>
                {refOpen && (
                  <div className="wb-ref__menu">
                    {refCandidates.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="wb-ref__item"
                        title={`插入 {{${c.ref}}}（${c.label}）`}
                        onClick={() => insertRef(c.ref)}
                      >
                        <code>{`{{${c.ref}}}`}</code>
                        <span className="wb-ref__name">{c.label}</span>
                        {c.hasOutput ? (
                          <span className="wb-ref__ok">有输出</span>
                        ) : (
                          <span className="wb-ref__none">待运行</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {showProviders && (
          <div className="wb-providers">
            {ALL_PROVIDERS.map((p) => (
              <label
                key={p}
                className={`wb-provider ${data.providers.includes(p) ? 'wb-provider--on' : ''}`}
              >
                <input
                  type="checkbox"
                  className="wb-provider__input nodrag"
                  checked={data.providers.includes(p)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...data.providers, p]
                      : data.providers.filter((x) => x !== p);
                    updateNodeData(id, { providers: next });
                  }}
                />
                <span className="wb-provider__label">{PROVIDER_LABELS[p]}</span>
              </label>
            ))}
          </div>
        )}

        {showProviders && (
          <div className="wb-delay nodrag">
            <label className="wb-delay__label" title="执行后等待该秒数自动触发一次「手动获取」，挽回抓取失败">
              自动获取(秒)
            </label>
            <input
              type="number"
              min={0}
              step={5}
              className="wb-delay__input"
              value={delayDraft}
              placeholder="0=不自动"
              onFocus={() => (delayFocused.current = true)}
              onBlur={() => {
                delayFocused.current = false;
                setDelayDraft(data.grabDelay === undefined ? '' : String(data.grabDelay));
              }}
              onChange={(e) => {
                const v = e.target.value;
                setDelayDraft(v);
                updateNodeData(id, {
                  grabDelay: v === '' ? undefined : Math.max(0, Number(v) || 0),
                });
              }}
            />
            {data.autoGrabAt && (
              <span className="wb-delay__count">
                <ArrowClockIcon size={11} />
                {remainSec}s 后自动获取
                {typeof data.probeStage === 'number' && (
                  <span className="wb-delay__probe">（第 {data.probeStage + 1}/3 次探测）</span>
                )}
                <button
                  type="button"
                  className="wb-delay__cancel"
                  onClick={() => cancelAutoGrab(id)}
                  title="取消自动获取"
                >
                  取消
                </button>
              </span>
            )}
          </div>
        )}

        {(data.output || data.error) && (
          <div className="wb-output nowheel">
            {showProviders && data.providers.length > 0 && (
              <div className="wb-output__meta">
                <CheckIcon size={11} />
                {answeredCount}/{data.providers.length} 已回答
                {missingCount > 0 && (
                  <span className="wb-output__missing">（{missingCount} 个未取到，可手动获取）</span>
                )}
              </div>
            )}
            {data.error && data.status === 'error' ? (
              <div className="wb-output__err" title={data.error}>✕ {data.error.length > 80 ? data.error.slice(0, 77) + '…' : data.error}</div>
            ) : data.error ? (
              <div className="wb-output__warn" title={data.error}>△ 部分失败：{data.error.length > 60 ? data.error.slice(0, 57) + '…' : data.error}</div>
            ) : null}

            {/* 逐家回答：可编辑 + 可复制（本地草稿输入，光标不受重渲染影响） */}
            {showProviders &&
              data.providers.map((p) => {
                const txt = data.outputs[p];
                if (!txt || txt.length === 0) return null;
                const ck = `out_${p}`;
                return (
                  <EditableAnswer
                    key={p}
                    value={txt}
                    label={PROVIDER_LABELS[p]}
                    copied={copied === ck}
                    onCopy={() => void copyText(txt, ck)}
                    onEdit={(text) => updateNodeOutput(id, p as ProviderName, text)}
                  />
                );
              })}

            {data.output && data.providers.some((p) => data.outputs[p] && data.outputs[p]!.length > 0) && (
              <div className="wb-output__all">
                <button
                  type="button"
                  className="wb-copy wb-copy--all"
                  onClick={() => void copyText(data.output, 'all')}
                >
                  {copied === 'all' ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
                  {copied === 'all' ? '已复制' : '复制全部'}
                </button>
              </div>
            )}

            {showProviders && data.urls && (() => {
              const linkProviders = data.providers.filter((p) => data.urls?.[p]);
              if (linkProviders.length === 0) return null;
              return (
                <div className="wb-output__links">
                  <span className="wb-output__links-label">回看会话：</span>
                  {linkProviders.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className="wb-link"
                      title={data.urls?.[p]}
                      onClick={() => openUrl(data.urls?.[p])}
                    >
                      <LinkIcon size={11} />
                      {PROVIDER_LABELS[p]}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        <div className="wb-actions">
          <button
            className="wb-actions__btn wb-actions__btn--run"
            disabled={running}
            onClick={() => void executeNode(id)}
            title="仅运行当前节点"
          >
            {running ? <StopIcon size={12} /> : <PlayIcon size={12} />}
            {running ? '运行中…' : '运行'}
          </button>
          {canGrab && (
            <button
              className="wb-actions__btn wb-actions__btn--grab"
              disabled={grabbing}
              onClick={() => void onGrab()}
              title="自动抓取可能漏掉回答：从各家标签页重新读屏补全"
            >
              <RefreshIcon size={12} />
              {grabbing ? '获取中…' : missingCount > 0 ? '手动获取' : '重新获取'}
            </button>
          )}
          {data.status === 'reviewing' && (
            <>
              <button
                className="wb-actions__btn wb-actions__btn--ok"
                onClick={() => confirmNode(id)}
                title="采纳当前结果（状态变为成功）"
              >
                <CheckIcon size={12} />
                采纳
              </button>
              <button
                className="wb-actions__btn wb-actions__btn--continue"
                onClick={() => void confirmAndContinue(id)}
                title="采纳当前结果，并自动运行其下游节点（按拓扑顺序继续）"
              >
                <ArrowClockIcon size={12} />
                采纳并继续
              </button>
            </>
          )}
          {data.status === 'error' && (
            <button
              className="wb-actions__btn wb-actions__btn--retry"
              onClick={() => void executeNode(id)}
            >
              <RefreshIcon size={12} />
              重试
            </button>
          )}
        </div>
      </div>

      {showSource && <Handle type="source" position={Position.Right} />}
    </div>
  );
});
