import { useEffect, useState } from 'react'
import './App.css'

type Provider = { id: string; configured: boolean; keyFingerprint?: string; baseUrl?: string; models: string[] }
type User = { email: string }

function App() {
  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('gpt-4.1-mini')
  const [message, setMessage] = useState('')
  const [response, setResponse] = useState('')
  const [reasoning, setReasoning] = useState('')
  const [stream, setStream] = useState(true)
  const [running, setRunning] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [dialog, setDialog] = useState<'login' | 'settings' | 'history' | 'profile' | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [settingsProvider, setSettingsProvider] = useState('custom-gateway')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [models, setModels] = useState('')
  const [validation, setValidation] = useState('')
  const [history, setHistory] = useState<Array<{ id: number; providerId: string; model: string; status: string; latencyMs?: number }>>([])

  const api = async (path: string, options?: RequestInit) => {
    const result = await fetch(path, { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) } })
    if (!result.ok) throw new Error((await result.text()) || `请求失败 (${result.status})`)
    return result.status === 204 ? null : result.json()
  }

  const loadProviders = async () => { try { const data = await api('/api/v1/providers'); setProviders(data.items) } catch { setDialog('login') } }
  useEffect(() => { api('/api/v1/auth/me').then(setUser).catch(() => undefined) }, [])

  const authenticate = async (mode: 'login' | 'register') => {
    try { const data = await api(`/api/v1/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email, password }) }); setUser(data); setDialog(null); setAuthError('') } catch (error) { setAuthError(error instanceof Error ? error.message : '认证失败') }
  }

  const openSettings = () => { if (!user) { setDialog('login'); return }; loadProviders(); setDialog('settings') }
  const saveProvider = async () => {
    try { await api(`/api/v1/providers/${settingsProvider}/credentials`, { method: 'PUT', body: JSON.stringify({ apiKey, baseUrl: baseUrl || null, models: models.split(',').map((item) => item.trim()).filter(Boolean) }) }); await loadProviders(); setApiKey(''); setValidation('供应商配置已保存') } catch (error) { setValidation(error instanceof Error ? error.message : '保存失败') }
  }
  const validateProvider = async () => {
    try { const result = await api(`/api/v1/providers/${settingsProvider}/validate`, { method: 'POST', body: JSON.stringify({ model: models.split(',').map((item) => item.trim()).filter(Boolean)[0] }) }); setValidation(`${result.message} · ${result.model} · ${result.latencyMs}ms`) } catch (error) { setValidation(error instanceof Error ? error.message : '验证失败') }
  }
  const openHistory = async () => { if (!user) { setDialog('login'); return }; try { const data = await api('/api/v1/invocations'); setHistory(data.items); setDialog('history') } catch { setDialog('login') } }

  const sendRequest = async () => {
    if (!message.trim()) return
    const effectiveStream = stream
    setRunning(true)
    setReasoning('')
    setResponse('')
    try {
      const endpoint = effectiveStream ? '/api/v1/invocations/stream' : '/api/v1/invocations'
      const result = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: provider, model, messages: [{ role: 'user', content: message }], stream: effectiveStream }),
      })
      if (result.status === 401) { setDialog('login'); throw new Error('请先登录并配置供应商') }
      if (!result.ok || !result.body) throw new Error((await result.text()) || `请求失败 (${result.status})`)
      if (!effectiveStream) {
        const body = await result.json()
        setResponse(body.outputText || '接口返回为空')
        return
      }
      const reader = result.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let output = ''
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''
        for (const event of events) {
          const data = event.split('\n').find((line) => line.startsWith('data: '))?.slice(6)
          if (!data) continue
          const parsed = JSON.parse(data) as { type: string; text?: string; message?: string }
          if (parsed.type === 'reasoning') { setReasoning((current) => current + (parsed.text || '')) }
          if (parsed.type === 'delta') { output += parsed.text || ''; setResponse(output) }
          if (parsed.type === 'error') throw new Error(parsed.message || '流式请求失败')
        }
      }
    } catch (error) {
      setResponse(error instanceof Error ? error.message : '请求失败')
    } finally {
      setRunning(false)
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="mark">AI</span><span>Interface / Workbench</span></div>
        <nav><button type="button" onClick={openHistory}>调用记录</button><button type="button" onClick={openSettings}>供应商设置</button><button className="avatar" type="button" onClick={() => setDialog(user ? 'profile' : 'login')}>{user ? user.email.slice(0, 2).toUpperCase() : 'BC'}</button></nav>
      </header>
      <section className="intro"><div><p className="eyebrow">API EXPERIMENTAL DESK / 01</p><h1>把每一次模型调用<br /><em>变成可复现的实验。</em></h1></div><div className="status"><span className="dot" />本地工作区 <strong>就绪</strong><small>SESSION · 24H</small></div></section>
      <section className="workspace">
        <div className="panel request-panel">
          <div className="panel-head"><div><span className="label">01 / REQUEST</span><h2>请求配置</h2></div><span className="pill">TEXT ONLY</span></div>
          <div className="field-row"><label>供应商<select value={provider} onChange={(event) => { setProvider(event.target.value); const item = providers.find((candidate) => candidate.id === event.target.value); setModel(item?.models[0] || (event.target.value === 'openai' ? 'gpt-4.1-mini' : 'claude-sonnet-4-5')) }}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option>{providers.filter((item) => !['openai', 'anthropic'].includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label><label>模型<input value={model} onChange={(event) => setModel(event.target.value)} /></label></div>
          <label>系统提示词<textarea className="system-input" placeholder="定义模型的角色与回答边界..." /></label>
          <div className="message-box"><span className="role">USER</span><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="输入一条消息开始实验..." /></div>
          <div className="controls"><label className="toggle-label"><input type="checkbox" checked={stream} onChange={(event) => setStream(event.target.checked)} /><span className="toggle" />流式响应</label><button className="send" type="button" onClick={sendRequest} disabled={running}>{running ? '处理中...' : '发送请求  →'}</button></div>
        </div>
        <div className="panel response-panel">
          <div className="panel-head"><div><span className="label">02 / RESPONSE</span><h2>响应观察</h2></div><span className={`live ${running ? 'active' : ''}`}>{running ? 'LIVE' : 'IDLE'}</span></div>
          <div className="response-body">{reasoning && <div className="reasoning"><span className="response-label">THINKING</span>{reasoning}</div>}{response ? <div><span className="response-label">ANSWER</span>{response}</div> : !reasoning && <span className="placeholder">响应内容将在这里逐字出现<span className="cursor" /></span>}</div>
          <div className="metrics"><span>LATENCY <strong>{running ? '...' : '—'}</strong></span><span>TOKENS <strong>—</strong></span><span>MODE <strong>{stream ? 'SSE' : 'JSON'}</strong></span></div>
        </div>
      </section>
      <footer><span>OPENAI / ANTHROPIC READY</span><span>DESIGN v0.2 · 2026</span></footer>
      {dialog && <div className="modal-backdrop" onClick={() => setDialog(null)}><section className="modal" onClick={(event) => event.stopPropagation()}>
        {dialog === 'login' && <><span className="label">ACCOUNT ACCESS</span><h2>登录工作台</h2><input placeholder="邮箱" value={email} onChange={(event) => setEmail(event.target.value)} /><input type="password" placeholder="密码（至少 12 位，含字母和数字）" value={password} onChange={(event) => setPassword(event.target.value)} /><p className="error">{authError}</p><div className="modal-actions"><button className="send" onClick={() => authenticate('login')}>登录</button><button onClick={() => authenticate('register')}>首次使用，创建账号</button></div></>}
        {dialog === 'settings' && <><span className="label">PROVIDER VAULT</span><h2>供应商设置</h2><label>供应商 ID<input value={settingsProvider} onChange={(event) => setSettingsProvider(event.target.value)} /></label><label>API Key<input type="password" placeholder="只会加密保存，不写入浏览器" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label><label>Base URL<input placeholder="例如 https://gateway.company.com/v1" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label><label>模型列表<input placeholder="model-a, model-b, model-c" value={models} onChange={(event) => setModels(event.target.value)} /></label><p className="validation">{validation}</p><div className="modal-actions"><button className="send" onClick={saveProvider}>保存配置</button><button onClick={validateProvider}>验证连接</button><button onClick={() => setDialog(null)}>关闭</button></div>{providers.map((item) => <p className="config-row" key={item.id}>{item.id} · {item.configured ? `已配置 ${item.keyFingerprint}` : '未配置'} · {item.models.join(', ')}</p>)}</>}
        {dialog === 'history' && <><span className="label">INVOCATION LOG</span><h2>调用记录</h2>{history.length ? history.map((item) => <p className="config-row" key={item.id}>{item.providerId} / {item.model} · {item.status} · {item.latencyMs || '-'}ms</p>) : <p>暂无调用记录</p>}<button onClick={() => setDialog(null)}>关闭</button></>}
        {dialog === 'profile' && <><span className="label">SESSION</span><h2>{user?.email}</h2><p>当前会话有效期 24 小时。</p><button onClick={async () => { await api('/api/v1/auth/logout', { method: 'POST' }); setUser(null); setDialog(null) }}>退出登录</button></>}
      </section></div>}
    </main>
  )
}

export default App
