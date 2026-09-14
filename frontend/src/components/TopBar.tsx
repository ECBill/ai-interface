import { useState, useRef, useEffect } from "react";
import { useAuthStore } from "../stores/authStore";
import { useConversationStore } from "../stores/conversationStore";
import { useProviderStore } from "../stores/providerStore";
import { usePreferenceStore } from "../stores/preferenceStore";


interface TopBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  onOpenProviders: () => void;
  onModelChange: (providerId: string, model: string) => void;
}

export function TopBar({
  sidebarOpen,
  onToggleSidebar,
  settingsOpen,
  onToggleSettings,
  onOpenProviders,
  onModelChange,
}: TopBarProps) {
  const { user, logout } = useAuthStore();
  const { activeConversation, patchConversation } = useConversationStore();
  const { providers, getConfiguredModels } = useProviderStore();
  const { prefs, updateDebounced } = usePreferenceStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const configuredModels = getConfiguredModels();
  const currentProviderId =
    activeConversation?.providerId || prefs?.lastProviderId || "";
  const currentModel =
    activeConversation?.model || prefs?.lastModel || "";

  const handleModelSelect = (providerId: string, model: string) => {
    if (activeConversation) {
      patchConversation(activeConversation.id, { providerId, model });
    }
    updateDebounced({ lastProviderId: providerId, lastModel: model });
    onModelChange(providerId, model);
  };

  const hasProviders = providers.some((p) => p.configured);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className={`topbar-btn mobile-menu-btn ${sidebarOpen ? "active" : ""}`}
          onClick={onToggleSidebar}
          title="切换侧栏"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="topbar-brand">
          <span className="mark">AI</span>
          <span className="brand-text">Interface</span>
        </div>
        {activeConversation && (
          <span className="topbar-title">{activeConversation.title}</span>
        )}
      </div>
      <div className="topbar-right">
        {/* Model selector */}
        {hasProviders && (
          <select
            className="settings-select"
            style={{ width: "auto", fontSize: "11px", padding: "4px 8px" }}
            value={
              configuredModels.some(
                (m) =>
                  m.providerId === currentProviderId && m.model === currentModel,
                  )
                ? `${currentProviderId}::${currentModel}`
                : ""
            }
            onChange={(e) => {
              const [providerId, model] = e.target.value.split("::");
              handleModelSelect(providerId, model);
            }}
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
        )}
        <button
          className={`topbar-btn ${!hasProviders ? "active" : ""}`}
          onClick={onOpenProviders}
          title="供应商设置"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="9" height="9" rx="1" />
            <rect x="13" y="2" width="9" height="9" rx="1" />
            <rect x="2" y="13" width="9" height="9" rx="1" />
            <rect x="13" y="13" width="9" height="9" rx="1" />
          </svg>
          供应商
        </button>
        <button
          className={`topbar-btn ${settingsOpen ? "active" : ""}`}
          onClick={onToggleSettings}
          title="会话设置"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          设置
        </button>
        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            className="topbar-avatar"
            onClick={() => setMenuOpen((o) => !o)}
            title={user?.email || ""}
          >
            {user?.email?.slice(0, 2).toUpperCase() || "??"}
          </button>
          {menuOpen && (
            <div className="profile-menu">
              <div className="profile-menu-header">
                <div className="profile-menu-email">{user?.email}</div>
                <div className="profile-menu-info">
                  {user?.expiresAt
                    ? `会话至 ${new Date(user.expiresAt).toLocaleDateString()}`
                    : "会话活跃中"}
                </div>
              </div>
              <button
                className="profile-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenProviders();
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="9" height="9" rx="1" />
                  <rect x="13" y="2" width="9" height="9" rx="1" />
                  <rect x="2" y="13" width="9" height="9" rx="1" />
                  <rect x="13" y="13" width="9" height="9" rx="1" />
                </svg>
                供应商设置
              </button>
              <button
                className="profile-menu-item danger"
                onClick={() => {
                  setMenuOpen(false);
                  logout();
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                退出登录
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
