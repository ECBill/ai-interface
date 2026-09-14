import { useEffect, useState, useCallback } from "react";
import "./App.css";

import { useAuthStore } from "./stores/authStore";
import { useProviderStore } from "./stores/providerStore";
import { usePreferenceStore } from "./stores/preferenceStore";
import { useConversationStore } from "./stores/conversationStore";

import { LoadingOverlay } from "./components/LoadingOverlay";
import { AuthPage } from "./components/AuthPage";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { MessageFlow } from "./components/MessageFlow";
import { InputArea } from "./components/InputArea";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatusBar } from "./components/StatusBar";
import { ProviderSettings } from "./components/ProviderSettings";

type AppView = "loading" | "auth" | "main" | "providers";
type LoadingPhase = "session" | "data" | "conversation" | "done";

export default function App() {
  const { user, checkSession, initialized } = useAuthStore();
  const { load: loadProviders } = useProviderStore();
  const { load: loadPrefs, prefs } = usePreferenceStore();
  const {
    loadConversations,
    activeConversation,
    selectConversation,
    createConversation,
  } = useConversationStore();

  const [view, setView] = useState<AppView>("loading");
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>("session");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingExample, setPendingExample] = useState<string | null>(null);

  // ── Startup loading chain (§4.6) ──────────────────────
  const startup = useCallback(async () => {
    setLoadError(null);
    setView("loading");
    setLoadingPhase("session");

    // Step 1: Check session
    const ok = await checkSession();
    if (!ok) {
      setView("auth");
      return;
    }

    // Step 2: Parallel load providers + preferences + conversations
    setLoadingPhase("data");
    try {
      await Promise.all([loadProviders(), loadPrefs(), loadConversations()]);
    } catch {
      // Non-fatal — continue with empty state
    }

    // Step 3: Load last conversation if any
    setLoadingPhase("conversation");
    const lastConvId = usePreferenceStore.getState().prefs?.lastConversationId;
    const convs = useConversationStore.getState().conversations;
    if (lastConvId && convs.some((c) => c.id === lastConvId)) {
      await selectConversation(lastConvId);
    } else if (convs.length > 0) {
      await selectConversation(convs[0].id);
    }

    // Step 4: Done
    setLoadingPhase("done");
    setView("main");
  }, [checkSession, loadProviders, loadPrefs, loadConversations, selectConversation]);

  useEffect(() => {
    startup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watch for auth state changes — login success triggers data loading
  useEffect(() => {
    if (user && view === "auth") {
      // User just logged in / registered — run the data loading chain
      startup();
    }
    if (initialized && !user && view !== "loading" && view !== "auth") {
      setView("auth");
    }
  }, [user, initialized, view, startup]);

  // ── Handlers ──────────────────────────────────────────
  const handleNewChat = useCallback(async () => {
    const providerId =
      activeConversation?.providerId || prefs?.lastProviderId || undefined;
    const model = activeConversation?.model || prefs?.lastModel || undefined;
    const system = prefs?.defaultSystemPrompt || undefined;
    await createConversation({ providerId, model, system });
    setMobileSidebarOpen(false);
    setPendingExample(null);
  }, [activeConversation, prefs, createConversation]);

  const handleToggleSidebar = useCallback(() => {
    // On mobile, toggle mobile-specific state
    if (window.innerWidth <= 768) {
      setMobileSidebarOpen((o) => !o);
    } else {
      setSidebarOpen((o) => !o);
    }
  }, []);

  const handleOpenProviders = useCallback(() => {
    setView("providers");
  }, []);

  const handleBackFromProviders = useCallback(() => {
    setView("main");
  }, []);

  const handleSendExample = useCallback(
    (text: string) => {
      setPendingExample(text);
    },
    [],
  );

  // ── Render ────────────────────────────────────────────
  if (view === "loading") {
    const messages: Record<LoadingPhase, string> = {
      session: "正在验证会话...",
      data: "正在加载工作区数据...",
      conversation: "正在恢复对话...",
      done: "加载完成",
    };
    return (
      <LoadingOverlay
        message={messages[loadingPhase]}
        error={loadError}
        onRetry={startup}
      />
    );
  }

  if (view === "auth") {
    return <AuthPage />;
  }

  if (view === "providers") {
  return (
    <div className="app-shell" key="providers">
      <div className="aurora-bg">
        <div className="aurora-blob b1" />
        <div className="aurora-blob b2" />
        <div className="aurora-blob b3" />
      </div>
      <TopBar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={handleToggleSidebar}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((o) => !o)}
        onOpenProviders={handleOpenProviders}
        onModelChange={() => {}}
      />
      <ProviderSettings onBack={handleBackFromProviders} />
      <StatusBar conversationId={activeConversation?.id || null} />
    </div>
  );
  }

  // Main view
  const conversationId = activeConversation?.id || "";
  const currentProviderId =
    activeConversation?.providerId || prefs?.lastProviderId || "";
  const currentModel = activeConversation?.model || prefs?.lastModel || "";
  const currentSystem =
    activeConversation?.systemPrompt || prefs?.defaultSystemPrompt || "";

  return (
    <div className="app-shell" key="main">
      <div className="aurora-bg">
        <div className="aurora-blob b1" />
        <div className="aurora-blob b2" />
        <div className="aurora-blob b3" />
      </div>
      <TopBar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={handleToggleSidebar}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((o) => !o)}
        onOpenProviders={handleOpenProviders}
        onModelChange={() => {}}
      />
      <div className="main-area">
        <Sidebar
          collapsed={!sidebarOpen}
          mobileOpen={mobileSidebarOpen}
          onNewChat={handleNewChat}
        />

        <div className="chat-area">
          {conversationId ? (
            <>
              <MessageFlow
                conversationId={conversationId}
                onSendExample={handleSendExample}
              />
              <InputArea
                conversationId={conversationId}
                providerId={currentProviderId}
                model={currentModel}
                system={currentSystem}
                initialText={pendingExample}
              />
            </>
          ) : (
            <div className="welcome-state">
              <h2>AI Interface</h2>
              <p>点击左侧"新对话"开始，或选择一个已有对话继续。</p>
              <button
                className="new-chat-btn"
                style={{ maxWidth: "200px", marginTop: "16px" }}
                onClick={handleNewChat}
              >
                + 开始新对话
              </button>
            </div>
          )}
        </div>

        <SettingsPanel
          collapsed={!settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      </div>
      <StatusBar conversationId={conversationId || null} />
    </div>
  );
}
