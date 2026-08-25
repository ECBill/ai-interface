import { useState } from 'react'
import './App.css'

function App() {
  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('gpt-4.1-mini')
  const [message, setMessage] = useState('')
  const [response, setResponse] = useState('')
  const [stream, setStream] = useState(true)
  const [running, setRunning] = useState(false)

  const sendRequest = async () => {
    if (!message.trim()) return
    setRunning(true)
    setResponse('正在连接接口...')
    try {
      const endpoint = stream ? '/api/v1/invocations/stream' : '/api/v1/invocations'
      const result = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: provider, model, messages: [{ role: 'user', content: message }], stream }),
      })
      if (!result.ok || !result.body) throw new Error((await result.text()) || `请求失败 (${result.status})`)
      if (!stream) {
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
        <nav><button type="button">调用记录</button><button type="button">供应商设置</button><button className="avatar" type="button">BC</button></nav>
      </header>
      <section className="intro"><div><p className="eyebrow">API EXPERIMENTAL DESK / 01</p><h1>把每一次模型调用<br /><em>变成可复现的实验。</em></h1></div><div className="status"><span className="dot" />本地工作区 <strong>就绪</strong><small>SESSION · 24H</small></div></section>
      <section className="workspace">
        <div className="panel request-panel">
          <div className="panel-head"><div><span className="label">01 / REQUEST</span><h2>请求配置</h2></div><span className="pill">TEXT ONLY</span></div>
          <div className="field-row"><label>供应商<select value={provider} onChange={(event) => { setProvider(event.target.value); setModel(event.target.value === 'openai' ? 'gpt-4.1-mini' : 'claude-sonnet-4-5') }}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select></label><label>模型<input value={model} onChange={(event) => setModel(event.target.value)} /></label></div>
          <label>系统提示词<textarea className="system-input" placeholder="定义模型的角色与回答边界..." /></label>
          <div className="message-box"><span className="role">USER</span><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="输入一条消息开始实验..." /></div>
          <div className="controls"><label className="toggle-label"><input type="checkbox" checked={stream} onChange={(event) => setStream(event.target.checked)} /><span className="toggle" />流式响应</label><button className="send" type="button" onClick={sendRequest} disabled={running}>{running ? '处理中...' : '发送请求  →'}</button></div>
        </div>
        <div className="panel response-panel">
          <div className="panel-head"><div><span className="label">02 / RESPONSE</span><h2>响应观察</h2></div><span className={`live ${running ? 'active' : ''}`}>{running ? 'LIVE' : 'IDLE'}</span></div>
          <div className="response-body">{response || <span className="placeholder">响应内容将在这里逐字出现<span className="cursor" /></span>}</div>
          <div className="metrics"><span>LATENCY <strong>{running ? '...' : '—'}</strong></span><span>TOKENS <strong>—</strong></span><span>MODE <strong>{stream ? 'SSE' : 'JSON'}</strong></span></div>
        </div>
      </section>
      <footer><span>OPENAI / ANTHROPIC READY</span><span>DESIGN v0.2 · 2026</span></footer>
    </main>
  )
}

export default App
