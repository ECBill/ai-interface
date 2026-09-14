import { useRef, useEffect, useState, useCallback, memo } from "react";
import { useConversationStore } from "../stores/conversationStore";
import { usePreferenceStore } from "../stores/preferenceStore";
import type { ChatMessage } from "../types";

interface MessageFlowProps {
  conversationId: string;
  onSendExample: (text: string) => void;
}

const WELCOME_EXAMPLES = [
  { icon: "🐍", text: "帮我写一个 Python 函数，读取 JSON 文件并按字段排序" },
  { icon: "⚛", text: "解释一下 React useEffect 的清理函数什么时候执行" },
  { icon: "📘", text: "用 TypeScript 实现一个简单的发布订阅模式" },
  { icon: "🗄", text: "帮我优化这段 SQL 查询的性能" },
];

export function MessageFlow({ conversationId, onSendExample }: MessageFlowProps) {
  const { messages, isStreaming, getStreamState, regenerateMessage } =
    useConversationStore();
  const { prefs } = usePreferenceStore();
  const flowRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [newCount, setNewCount] = useState(0);

  const msgs = messages[conversationId] || [];
  const streaming = isStreaming(conversationId);
  const streamState = getStreamState(conversationId);

  // Track message count and last message content length for optimized auto-scroll
  const msgCount = msgs.length;
  const lastMsgLen = msgCount > 0 ? (msgs[msgCount - 1]?.content?.length ?? 0) : 0;

  // Auto-scroll to bottom when new messages arrive if user is near bottom
  const scrollToBottom = useCallback((smooth = true) => {
    const el = flowRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
    setNewCount(0);
  }, []);

  const isNearBottom = useCallback(() => {
    const el = flowRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }, []);

  // rAF-throttled scroll handler — avoids excessive state updates
  const scrollRafRef = useRef<number | null>(null);
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const nearBottom = isNearBottom();
      setShowScrollBtn(!nearBottom && msgCount > 3);
      if (nearBottom) setNewCount(0);
    });
  }, [isNearBottom, msgCount]);

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  // Auto-follow on new content — only triggers on message count change or content length change,
  // not on every single re-render. This is much cheaper than depending on [msgs] directly.
  useEffect(() => {
    if (isNearBottom()) {
      scrollToBottom(false);
    } else {
      setNewCount((c) => c + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgCount, lastMsgLen]);

  // Scroll to bottom on conversation switch
  useEffect(() => {
    scrollToBottom(false);
    setNewCount(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  if (msgs.length === 0) {
    return (
      <div className="message-flow" ref={flowRef} onScroll={handleScroll}>
        <div className="welcome-state">
          <div className="welcome-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h2>开始新对话</h2>
          <p>选择模型，输入消息，开始与 AI 对话。支持多轮上下文、流式响应和思维链展示。</p>
          <div className="welcome-examples">
            {WELCOME_EXAMPLES.map((ex, i) => (
              <button
                key={i}
                className="welcome-example"
                onClick={() => onSendExample(ex.text)}
              >
                <span className="welcome-example-icon">{ex.icon}</span>
                <span>{ex.text}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="message-flow"
      ref={flowRef}
      onScroll={handleScroll}
      style={{ position: "relative" }}
    >
      <div className="message-flow-inner">
        {msgs.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            conversationId={conversationId}
            showThinking={prefs?.showThinking || "expanded"}
            onRegenerate={
              msg.role === "assistant" && msg.status === "succeeded"
                ? () => regenerateMessage(conversationId, msg.id)
                : undefined
            }
          />
        ))}

        {/* Typing indicator when connecting but no content yet */}
        {streaming && streamState.status === "connecting" && (
          <div className="msg assistant">
            <div className="msg-row">
              <div className="msg-avatar assistant">AI</div>
              <div className="msg-content-wrap">
                <div className="msg-bubble">
                  <div className="typing-indicator">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {showScrollBtn && (
        <button
          className="scroll-bottom-btn"
          onClick={() => scrollToBottom(true)}
        >
          {newCount > 0 && <span className="badge">{newCount}</span>}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
          回到最新
        </button>
      )}
    </div>
  );
}

// ── Single Message Bubble (memoized for streaming performance) ──────
interface MessageBubbleProps {
  msg: ChatMessage;
  conversationId: string;
  showThinking: "expanded" | "collapsed" | "hidden";
  onRegenerate?: () => void;
}

/**
 * Custom comparison: only re-render when the message data that affects
 * the bubble's visual output actually changes. This prevents re-rendering
 * ALL bubbles on every streaming token — only the streaming bubble updates.
 */
function arePropsEqual(prev: MessageBubbleProps, next: MessageBubbleProps): boolean {
  const pm = prev.msg;
  const nm = next.msg;
  // Fast path: same object reference
  if (pm === nm && prev.showThinking === next.showThinking && prev.onRegenerate === next.onRegenerate) {
    return true;
  }
  // Check all fields that affect rendering
  return (
    pm.id === nm.id &&
    pm.content === nm.content &&
    pm.status === nm.status &&
    pm.thinking === nm.thinking &&
    pm.role === nm.role &&
    pm.model === nm.model &&
    pm.errorCode === nm.errorCode &&
    pm.firstTokenMs === nm.firstTokenMs &&
    pm.latencyMs === nm.latencyMs &&
    pm.totalTokens === nm.totalTokens &&
    pm.finishReason === nm.finishReason &&
    prev.showThinking === next.showThinking &&
    prev.onRegenerate === next.onRegenerate
  );
}

const MessageBubble = memo(function MessageBubble({
  msg,
  conversationId,
  showThinking,
  onRegenerate,
}: MessageBubbleProps) {
  const { editMessage, deleteMessage, regenerateMessage } = useConversationStore();
  const [thinkingExpanded, setThinkingExpanded] = useState(
    showThinking === "expanded",
  );
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(msg.content);

  // Track when thinking starts to compute duration
  const thinkingStartRef = useRef<number | null>(null);
  const [thinkingDuration, setThinkingDuration] = useState<number | null>(null);

  const isStreaming = msg.status === "streaming";
  const isError = msg.status === "failed";
  const isCancelled = msg.status === "cancelled";
  const hasThinking = msg.thinking && msg.thinking.trim().length > 0;

  // Auto-collapse thinking block when streaming ends, show duration
  useEffect(() => {
    if (isStreaming && hasThinking && thinkingStartRef.current === null) {
      thinkingStartRef.current = Date.now();
    }
    if (!isStreaming && hasThinking && thinkingStartRef.current !== null && thinkingDuration === null) {
      const duration = Math.round((Date.now() - thinkingStartRef.current) / 1000);
      setThinkingDuration(duration);
      // Auto-collapse after done
      setThinkingExpanded(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, hasThinking]);

  useEffect(() => {
    setThinkingExpanded(showThinking === "expanded");
  }, [showThinking]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  };

  const handleEditSave = async () => {
    if (!editText.trim()) return;
    setEditing(false);
    await editMessage(conversationId, msg.id, editText.trim());
  };

  const handleEditCancel = () => {
    setEditing(false);
    setEditText(msg.content);
  };

  const handleDelete = async () => {
    if (confirm("确定删除这条消息？")) {
      await deleteMessage(conversationId, msg.id);
    }
  };

  const handleRetry = () => {
    regenerateMessage(conversationId, msg.id);
  };

  // Build metadata row
  const metaParts: string[] = [];
  if (msg.firstTokenMs != null) metaParts.push(`首字 ${msg.firstTokenMs}ms`);
  if (msg.latencyMs != null) metaParts.push(`总计 ${(msg.latencyMs / 1000).toFixed(1)}s`);
  if (msg.totalTokens != null) metaParts.push(`${msg.totalTokens} tokens`);
  if (msg.finishReason) {
    const reasonMap: Record<string, string> = {
      stop: "自然结束",
      length: "达到长度限制",
      cancelled: "已取消",
    };
    metaParts.push(reasonMap[msg.finishReason] || msg.finishReason);
  }

  const avatarText = msg.role === "assistant" ? "AI" : "你";

  return (
    <div className={`msg ${msg.role}`}>
      <div className="msg-row">
        <div className={`msg-avatar ${msg.role}`}>{avatarText}</div>
        <div className="msg-content-wrap">
          {/* Thinking block (assistant only) */}
          {msg.role === "assistant" && hasThinking && showThinking !== "hidden" && (
            <div className="thinking-block">
              <div
                className={`thinking-header ${thinkingExpanded ? "expanded" : ""}`}
                onClick={() => setThinkingExpanded((e) => !e)}
              >
                <span className="label">
                  <span className="dot" />
                  {isStreaming
                    ? "思考中..."
                    : thinkingDuration != null
                      ? `已思考 ${thinkingDuration} 秒`
                      : "思考过程"}
                </span>
                <span className="chevron">▶</span>
              </div>
              {thinkingExpanded && (
                <div className="thinking-content">{msg.thinking}</div>
              )}
            </div>
          )}

          {/* Message bubble */}
          <div className={`msg-bubble ${isError ? "error" : ""}`}>
            {editing ? (
              <div className="msg-edit-area">
                <textarea
                  className="msg-edit-textarea"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  autoFocus
                  rows={Math.min(Math.max(editText.split("\n").length, 2), 10)}
                />
                <div className="msg-edit-actions">
                  <button className="msg-action-btn primary" onClick={handleEditSave}>
                    保存并重发
                  </button>
                  <button className="msg-action-btn" onClick={handleEditCancel}>
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <>
                {msg.content}
                {isStreaming && <span className="stream-cursor" />}
                {isError && msg.errorCode && (
                  <div style={{ marginTop: "8px", fontSize: "11px", opacity: 0.8 }}>
                    错误: {msg.errorCode}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Meta info */}
          <div className="msg-meta">
            {msg.model && <span className="msg-badge">{msg.model}</span>}
            {metaParts.length > 0 && (
              <span className="msg-meta-info">{metaParts.join(" · ")}</span>
            )}
            {isCancelled && <span>已取消</span>}

            {/* Actions — show on hover for non-streaming messages */}
            {!isStreaming && !editing && (
              <div className="msg-actions">
                {/* Copy button */}
                <button
                  className="msg-action-btn"
                  onClick={handleCopy}
                  title="复制"
                >
                  {copied ? "✓ 已复制" : "复制"}
                </button>

                {/* Edit-resend button (user messages only) */}
                {msg.role === "user" && (
                  <button
                    className="msg-action-btn"
                    onClick={() => setEditing(true)}
                    title="编辑并重发"
                  >
                    编辑
                  </button>
                )}

                {/* Regenerate button (assistant messages only) */}
                {msg.role === "assistant" && msg.status === "succeeded" && (
                  <button
                    className="msg-action-btn"
                    onClick={onRegenerate || handleRetry}
                    title="重新生成"
                  >
                    重新生成
                  </button>
                )}

                {/* Retry button (failed assistant messages only) */}
                {msg.role === "assistant" && isError && (
                  <button
                    className="msg-action-btn"
                    onClick={handleRetry}
                    title="重试"
                  >
                    重试
                  </button>
                )}

                {/* Delete button */}
                <button
                  className="msg-action-btn danger"
                  onClick={handleDelete}
                  title="删除"
                >
                  删除
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}, arePropsEqual);
