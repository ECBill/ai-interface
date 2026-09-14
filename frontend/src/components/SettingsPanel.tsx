import { useState, useEffect } from "react";
import { useConversationStore } from "../stores/conversationStore";
import { useProviderStore } from "../stores/providerStore";
import { usePreferenceStore } from "../stores/preferenceStore";
import type { GenerationParameters } from "../types";

interface SettingsPanelProps {
  collapsed: boolean;
  onClose: () => void;
}

export function SettingsPanel({ collapsed, onClose }: SettingsPanelProps) {
  const { activeConversation, patchConversation, messages } =
    useConversationStore();
  const { providers, getConfiguredModels } = useProviderStore();
  const { prefs, updateDebounced } = usePreferenceStore();

  const [system, setSystem] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [topP, setTopP] = useState(1.0);
  const [showThinking, setShowThinking] = useState<
    "expanded" | "collapsed" | "hidden"
  >("expanded");

  // Sync from active conversation / preferences
  useEffect(() => {
    if (activeConversation) {
      setSystem(activeConversation.systemPrompt || "");
      const params = activeConversation.parameters as Partial<GenerationParameters>;
      setTemperature(params?.temperature ?? 0.7);
      setMaxTokens(params?.maxTokens ?? 4096);
      setTopP(params?.topP ?? 1.0);
    } else if (prefs) {
      setSystem(prefs.defaultSystemPrompt || "");
      const params = prefs.defaultParameters as Partial<GenerationParameters>;
      setTemperature(params?.temperature ?? 0.7);
      setMaxTokens(params?.maxTokens ?? 4096);
      setTopP(params?.topP ?? 1.0);
      setShowThinking(prefs.showThinking);
    }
  }, [activeConversation, prefs]);

  const configuredModels = getConfiguredModels();
  const currentProviderId =
    activeConversation?.providerId || prefs?.lastProviderId || "";
  const currentModel = activeConversation?.model || prefs?.lastModel || "";

  const handleModelChange = (value: string) => {
    const [providerId, model] = value.split("::");
    if (activeConversation) {
      patchConversation(activeConversation.id, { providerId, model });
    }
    updateDebounced({ lastProviderId: providerId, lastModel: model });
  };

  const handleSystemChange = (value: string) => {
    setSystem(value);
    if (activeConversation) {
      patchConversation(activeConversation.id, { system: value });
    }
    updateDebounced({ defaultSystemPrompt: value });
  };

  const handleParamChange = (
    params: Partial<GenerationParameters>,
  ) => {
    if (activeConversation) {
      patchConversation(activeConversation.id, { parameters: { ...activeConversation.parameters, ...params } as GenerationParameters });
    }
    updateDebounced({
      defaultParameters: { ...prefs?.defaultParameters, ...params },
    });
  };

  const handleThinkingChange = (value: "expanded" | "collapsed" | "hidden") => {
    setShowThinking(value);
    updateDebounced({ showThinking: value });
  };

  // Session stats
  const convMessages = activeConversation
    ? messages[activeConversation.id] || []
    : [];
  const userMsgs = convMessages.filter((m) => m.role === "user").length;
  const assistantMsgs = convMessages.filter((m) => m.role === "assistant").length;
  const totalTokens = convMessages.reduce((sum, m) => sum + (m.totalTokens || 0), 0);

  return (
    <aside className={`settings-panel ${collapsed ? "collapsed" : ""}`}>
      <div className="settings-header">
        <h3>会话设置</h3>
        <button className="settings-close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="settings-body">
        {/* Model selector */}
        <div className="settings-group">
          <label className="settings-label">模型</label>
          <select
            className="settings-select"
            value={
              configuredModels.some(
                (m) =>
                  m.providerId === currentProviderId &&
                  m.model === currentModel,
              )
                ? `${currentProviderId}::${currentModel}`
                : ""
            }
            onChange={(e) => handleModelChange(e.target.value)}
          >
            <option value="" disabled>
              选择模型
            </option>
            {configuredModels.map((m) => (
              <option
                key={`${m.providerId}::${m.model}`}
                value={`${m.providerId}::${m.model}`}
              >
                {m.providerId} / {m.model}
              </option>
            ))}
          </select>
          {providers.filter((p) => p.configured).length === 0 && (
            <span
              style={{ fontSize: "11px", color: "var(--text-muted)" }}
            >
              请先配置供应商
            </span>
          )}
        </div>

        {/* System prompt */}
        <div className="settings-group">
          <label className="settings-label">系统提示词</label>
          <textarea
            className="settings-textarea"
            value={system}
            onChange={(e) => handleSystemChange(e.target.value)}
            placeholder="定义模型的角色与回答边界..."
          />
        </div>

        {/* Temperature */}
        <div className="settings-group">
          <label className="settings-label">Temperature</label>
          <div className="settings-slider-row">
            <input
              type="range"
              className="settings-slider"
              min="0"
              max="2"
              step="0.1"
              value={temperature}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setTemperature(v);
                handleParamChange({ temperature: v });
              }}
            />
            <span className="settings-slider-value">{temperature}</span>
          </div>
        </div>

        {/* Max tokens */}
        <div className="settings-group">
          <label className="settings-label">Max Tokens</label>
          <div className="settings-slider-row">
            <input
              type="range"
              className="settings-slider"
              min="256"
              max="32768"
              step="256"
              value={maxTokens}
              onChange={(e) => {
                const v = parseInt(e.target.value);
                setMaxTokens(v);
                handleParamChange({ maxTokens: v });
              }}
            />
            <span className="settings-slider-value">{maxTokens}</span>
          </div>
        </div>

        {/* Top P */}
        <div className="settings-group">
          <label className="settings-label">Top P</label>
          <div className="settings-slider-row">
            <input
              type="range"
              className="settings-slider"
              min="0"
              max="1"
              step="0.05"
              value={topP}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setTopP(v);
                handleParamChange({ topP: v });
              }}
            />
            <span className="settings-slider-value">{topP}</span>
          </div>
        </div>

        {/* Thinking display toggle */}
        <div className="settings-group">
          <label className="settings-label">思维链展示</label>
          <select
            className="settings-select"
            value={showThinking}
            onChange={(e) =>
              handleThinkingChange(
                e.target.value as "expanded" | "collapsed" | "hidden",
              )
            }
          >
            <option value="expanded">展开</option>
            <option value="collapsed">折叠</option>
            <option value="hidden">隐藏</option>
          </select>
        </div>

        {/* Session stats */}
        {activeConversation && (
          <div className="settings-group">
            <label className="settings-label">会话统计</label>
            <div className="settings-stats">
              <div className="stat-card">
                <div className="stat-label">用户消息</div>
                <div className="stat-value">{userMsgs}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">AI 回复</div>
                <div className="stat-value">{assistantMsgs}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">总 Token</div>
                <div className="stat-value">{totalTokens}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">消息总数</div>
                <div className="stat-value">{convMessages.length}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
