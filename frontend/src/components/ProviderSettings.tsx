import { useState, useEffect } from "react";
import { useProviderStore } from "../stores/providerStore";
import type { ProviderStatus } from "../types";

interface ProviderSettingsProps {
  onBack: () => void;
}

export function ProviderSettings({ onBack }: ProviderSettingsProps) {
  const { providers, load, saveCredentials, validate, revoke } =
    useProviderStore();
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [models, setModels] = useState("");
  const [validation, setValidation] = useState<Record<string, string>>({});

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (provider: ProviderStatus) => {
    setEditingProvider(provider.id);
    setApiKey("");
    setBaseUrl(provider.baseUrl || "");
    setModels(provider.models.join(", "));
    setValidation({});
  };

  const handleSave = async (providerId: string) => {
    try {
      const modelList = models
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
      await saveCredentials(providerId, apiKey, baseUrl, modelList);
      setApiKey("");
      setValidation((v) => ({
        ...v,
        [providerId]: "✓ 配置已保存",
      }));
    } catch (err) {
      setValidation((v) => ({
        ...v,
        [providerId]: err instanceof Error ? err.message : "保存失败",
      }));
    }
  };

  const handleValidate = async (providerId: string) => {
    try {
      const modelList = models
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
      const result = await validate(providerId, modelList[0]);
      setValidation((v) => ({ ...v, [providerId]: `✓ ${result}` }));
    } catch (err) {
      setValidation((v) => ({
        ...v,
        [providerId]: err instanceof Error ? err.message : "验证失败",
      }));
    }
  };

  const handleRevoke = async (providerId: string) => {
    if (confirm("确定撤销此供应商的凭据？")) {
      try {
        await revoke(providerId);
        setValidation((v) => ({ ...v, [providerId]: "✓ 凭据已撤销" }));
      } catch (err) {
        setValidation((v) => ({
          ...v,
          [providerId]: err instanceof Error ? err.message : "撤销失败",
        }));
      }
    }
  };

  return (
    <div className="provider-page">
      <div className="provider-page-inner">
        <button className="provider-back" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          返回
        </button>
        <h2>供应商设置</h2>
        {providers.map((provider) => (
          <div key={provider.id} className="provider-card">
            <div className="provider-card-header">
              <h3>{provider.id}</h3>
              <span
                className={`provider-status-badge ${provider.configured ? "configured" : "not-configured"}`}
              >
                <span className="dot" />
                {provider.configured ? "已配置" : "未配置"}
              </span>
            </div>

            {provider.configured && (
              <div style={{ marginBottom: "12px", fontSize: "11px", color: "var(--text-muted)" }}>
                {provider.keyFingerprint && <div>🔑 {provider.keyFingerprint}</div>}
                {provider.models.length > 0 && (
                  <div>模型: {provider.models.join(", ")}</div>
                )}
                {provider.baseUrl && <div>Base URL: {provider.baseUrl}</div>}
              </div>
            )}

            {editingProvider === provider.id ? (
              <>
                <div className="provider-field">
                  <label>API Key</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="输入 API Key..."
                  />
                </div>
                <div className="provider-field">
                  <label>Base URL (可选)</label>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                  />
                </div>
                <div className="provider-field">
                  <label>模型列表 (逗号分隔)</label>
                  <input
                    type="text"
                    value={models}
                    onChange={(e) => setModels(e.target.value)}
                    placeholder="gpt-4.1-mini, gpt-4.1"
                  />
                </div>
                <div className="provider-validation">
                  {validation[provider.id] || ""}
                </div>
                <div className="provider-actions">
                  <button
                    className="provider-btn primary"
                    onClick={() => handleSave(provider.id)}
                  >
                    保存
                  </button>
                  <button
                    className="provider-btn secondary"
                    onClick={() => handleValidate(provider.id)}
                  >
                    验证连接
                  </button>
                  <button
                    className="provider-btn secondary"
                    onClick={() => setEditingProvider(null)}
                  >
                    取消
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="provider-validation">
                  {validation[provider.id] || ""}
                </div>
                <div className="provider-actions">
                  <button
                    className="provider-btn primary"
                    onClick={() => startEdit(provider)}
                  >
                    {provider.configured ? "更新配置" : "配置"}
                  </button>
                  {provider.configured && (
                    <button
                      className="provider-btn secondary"
                      onClick={() => handleRevoke(provider.id)}
                    >
                      撤销凭据
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
