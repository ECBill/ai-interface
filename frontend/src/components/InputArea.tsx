import { useState, useRef, useEffect } from "react";
import { useConversationStore } from "../stores/conversationStore";
import { usePreferenceStore } from "../stores/preferenceStore";
import type { GenerationParameters } from "../types";

interface InputAreaProps {
  conversationId: string;
  providerId: string;
  model: string;
  system: string;
  initialText?: string | null;
}

export function InputArea({
  conversationId,
  providerId,
  model,
  system,
  initialText,
}: InputAreaProps) {
  const { sendMessage, isStreaming, stopStreaming } = useConversationStore();
  const { prefs } = usePreferenceStore();
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streaming = isStreaming(conversationId);

  // Apply pending example text from welcome state
  useEffect(() => {
    if (initialText) {
      setText(initialText);
      textareaRef.current?.focus();
    }
  }, [initialText]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const handleSend = async () => {
    if (!text.trim() || streaming) return;
    const content = text.trim();
    setText("");
    try {
      await sendMessage(conversationId, content, {
        providerId,
        model,
        system: system || undefined,
        parameters: prefs?.defaultParameters as GenerationParameters | undefined,
      });
    } catch {
      // Refill the textarea on failure so the user doesn't lose their input
      setText(content);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = () => {
    stopStreaming(conversationId);
  };

  return (
    <div className="input-area">
      <div className="input-inner">
        <div className="input-row">
          <textarea
            ref={textareaRef}
            className="input-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            rows={1}
          />
          {streaming ? (
            <button
              className="send-btn stop"
              onClick={handleStop}
              title="停止生成"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={handleSend}
              disabled={!text.trim()}
              title="发送"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="input-footer">
          <span className="input-model-badge">
            <span className="dot" />
            {providerId || "?"} / {model || "?"}
          </span>
          <span className="input-hint">
            {streaming ? "生成中..." : "Enter 发送 · Shift+Enter 换行"}
          </span>
        </div>
      </div>
    </div>
  );
}
