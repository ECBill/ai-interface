import { useConversationStore } from "../stores/conversationStore";
import { useProviderStore } from "../stores/providerStore";
import { usePreferenceStore } from "../stores/preferenceStore";

interface StatusBarProps {
  conversationId: string | null;
}

export function StatusBar({ conversationId }: StatusBarProps) {
  const { isStreaming, getStreamState } = useConversationStore();
  const { providers } = useProviderStore();
  const { prefs } = usePreferenceStore();

  const streaming = conversationId ? isStreaming(conversationId) : false;
  const streamState = conversationId ? getStreamState(conversationId) : null;

  const currentProviderId = prefs?.lastProviderId || "";
  const currentModel = prefs?.lastModel || "";
  const provider = providers.find((p) => p.id === currentProviderId);
  const fingerprint = provider?.keyFingerprint;

  return (
    <footer className="statusbar">
      <div className="statusbar-left">
        <span
          className={`status-dot ${streaming ? "live" : ""} ${streamState?.status === "error" ? "error" : ""}`}
        />
        <span>
          {streaming
            ? `流式生成中 · ${streamState?.status || "..."}`
            : streamState?.status === "error"
              ? "连接错误"
              : streamState?.status === "cancelled"
                ? "已取消"
                : "就绪"}
        </span>
        {streamState?.warnings && streamState.warnings.length > 0 && (
          <span style={{ color: "var(--error)" }}>
            ⚠ {streamState.warnings.length} 个警告
          </span>
        )}
      </div>
      <div className="statusbar-right">
        {currentModel && <span>{currentProviderId} / {currentModel}</span>}
        {fingerprint && <span>🔑 {fingerprint}</span>}
        <span>V3</span>
      </div>
    </footer>
  );
}
