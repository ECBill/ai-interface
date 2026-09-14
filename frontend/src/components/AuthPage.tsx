import { useState } from "react";
import { useAuthStore } from "../stores/authStore";

const AUTH_FEATURES = [
  { icon: "💬", text: "多轮对话上下文，流畅的流式响应体验" },
  { icon: "🧠", text: "思维链展示，看见 AI 的推理过程" },
  { icon: "🔌", text: "多供应商接入，灵活切换模型与参数" },
  { icon: "🔒", text: "端到端加密，凭据安全存储" },
];

export function AuthPage() {
  const { login, register, loading, error, clearError } = useAuthStore();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password);
      }
    } catch {
      // error is set in store
    }
  };

  const switchMode = () => {
    clearError();
    setMode((m) => (m === "login" ? "register" : "login"));
  };

  return (
    <div className="auth-page">
      {/* Left visual side */}
      <div className="auth-visual">
        <div className="auth-visual-content">
          <div className="auth-visual-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1>AI Interface</h1>
          <p>统一的多模型 AI 对话平台，让每一次交互都精准而优雅</p>
          <div className="auth-visual-features">
            {AUTH_FEATURES.map((f, i) => (
              <div key={i} className="auth-feature">
                <div className="auth-feature-icon">{f.icon}</div>
                <span>{f.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right form side */}
      <div className="auth-form-side">
        <div className="auth-card">
          <h2>{mode === "login" ? "欢迎回来" : "创建账号"}</h2>
          <p className="subtitle">
            {mode === "login"
              ? "登录以继续你的对话"
              : "注册一个新账号开始使用"}
          </p>
          <form onSubmit={handleSubmit}>
            <div className="auth-field">
              <label>邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>
            <div className="auth-field">
              <label>密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 12 位，含字母和数字"
                required
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>
            <div className="auth-field">
              <label className="auth-remember">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                <span>记住我（30 天免登录）</span>
              </label>
            </div>
            <p className="auth-error">{error || ""}</p>
            <div className="auth-actions">
              <button
                type="submit"
                className="auth-btn primary"
                disabled={loading}
              >
                {loading ? "处理中..." : mode === "login" ? "登录" : "注册"}
              </button>
              <button
                type="button"
                className="auth-btn secondary"
                onClick={switchMode}
              >
                {mode === "login" ? "注册新账号" : "已有账号"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
