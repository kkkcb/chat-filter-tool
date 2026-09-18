import { useEffect, useRef, useState, useCallback } from 'react'
import { FlaskConical, MessageSquare, Image as ImageIcon, Clapperboard, Loader2, Download, Trash2, AlertCircle } from 'lucide-react'
import { Bubble, Sender } from '@ant-design/x'
import { request, API_PREFIX, getAccessToken } from '../api/client'
import { renderMarkdown } from '../utils/markdown'
import { toast } from '../components/Toast'
import './ModelLab.css'

/**
 * 模型实验室 —— Agnes AI 免费模型专用独立页。
 * 三类能力三个标签：文本对话（流式）/ 图片生成 / 视频生成（异步轮询）。
 * 只列免费模型；key 在后端，前端全部经 /api/agnes/* 转发。
 * 对话壳复用 @ant-design/x Bubble/Sender（与对话页同款交互），
 * 正文走统一 markdown 管线（含公式/代码/表格）。
 */

const TEXT_MODELS = [
  { id: 'agnes-3.0-flash', name: 'Agnes 3.0 Flash' },
  { id: 'agnes-2.5-flash', name: 'Agnes 2.5 Flash' },
]
const IMAGE_MODELS = [
  { id: 'agnes-image-2.5-flash', name: 'Image 2.5 Flash' },
  { id: 'agnes-image-2.1-flash', name: 'Image 2.1 Flash' },
]
const VIDEO_MODELS = [
  { id: 'agnes-video-2.5-flash', name: 'Video 2.5 Flash（720P 免费时长）' },
  { id: 'agnes-video-v2.0', name: 'Video V2.0（时长全免）' },
]
const SIZES = ['1K', '2K', '3K', '4K']
const RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9']
const VIDEO_ASPECTS = {
  'agnes-video-2.5-flash': ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
  'agnes-video-v2.0': ['16:9', '9:16', '1:1', '4:3'],
}
// v2.0 分辨率按 720p 档给（服务端会自动标准化）
const V20_DIMS = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [720, 720], '4:3': [960, 720] }

export default function ModelLab() {
  const [tab, setTab] = useState('chat')
  const [keyOk, setKeyOk] = useState(true)

  useEffect(() => {
    request('/agnes/models').then(d => setKeyOk(!!d.key_ok)).catch(() => setKeyOk(false))
  }, [])

  return (
    <div className="lab-page">
      <div className="lab-header">
        <h2><FlaskConical size={18} strokeWidth={2.2} /> 模型实验室
          <span className="lab-free-badge">免费模型</span>
        </h2>
        <div className="lab-tabs">
          <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
            <MessageSquare size={14} strokeWidth={2} /> 对话
          </button>
          <button className={tab === 'image' ? 'active' : ''} onClick={() => setTab('image')}>
            <ImageIcon size={14} strokeWidth={2} /> 图片
          </button>
          <button className={tab === 'video' ? 'active' : ''} onClick={() => setTab('video')}>
            <Clapperboard size={14} strokeWidth={2} /> 视频
          </button>
        </div>
      </div>
      {!keyOk && (
        <div className="lab-key-warning">
          <AlertCircle size={14} strokeWidth={2} />
          Agnes API Key 未配置：在 backend/.env 设置 AGNES_API_KEY 后重启后端
        </div>
      )}
      {tab === 'chat' && <ChatTab />}
      {tab === 'image' && <ImageTab />}
      {tab === 'video' && <VideoTab />}
    </div>
  )
}

/* ============ 对话（流式，复用 Bubble/Sender） ============ */
function ChatTab() {
  const [model, setModel] = useState(TEXT_MODELS[0].id)
  const [messages, setMessages] = useState([]) // {role, content, streaming?}
  const [sending, setSending] = useState(false)
  const senderRef = useRef(null)
  const scrollRef = useRef(null)

  const send = async (text) => {
    if (!text.trim() || sending) return
    const userMsg = { role: 'user', content: text.trim() }
    const history = [...messages.filter(m => !m.streaming), userMsg]
    setMessages([...history, { role: 'assistant', content: '', streaming: true }])
    setSending(true)
    try {
      const resp = await fetch(`${API_PREFIX}/agnes/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(getAccessToken() ? { 'X-Access-Token': getAccessToken() } : {}) },
        body: JSON.stringify({ model, messages: history.map(m => ({ role: m.role, content: m.content })) }),
      })
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let acc = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        let emit = ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6))
            if (evt.type === 'content') { acc += evt.data; emit = acc }
            if (evt.type === 'error') { acc += `\n\n> ⚠️ ${evt.data}`; emit = acc }
          } catch { /* 半包 */ }
        }
        if (emit) setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, content: emit } : m))
      }
      setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, streaming: false } : m))
    } catch (e) {
      toast(e?.message || '请求失败', 'error')
      setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, streaming: false, content: m.content || '（请求失败）' } : m))
    } finally {
      setSending(false)
      senderRef.current?.focus()
    }
  }

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  return (
    <div className="lab-chat">
      <div className="lab-toolbar">
        <select value={model} onChange={e => setModel(e.target.value)}>
          {TEXT_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <span className="lab-hint">会话仅保存在本页刷新前 · 上下文完整带入</span>
        <button className="lab-clear" onClick={() => setMessages([])} disabled={!messages.length || sending}>
          <Trash2 size={13} strokeWidth={2} /> 清空
        </button>
      </div>
      <div className="lab-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="lab-empty">
            <p>免费文本模型直连（¥0）</p>
            <div className="lab-suggests">
              {['写一段 200 字的科幻微小说开头', '用通俗语言解释一下什么是 Transformer', '帮我把这段话翻译成英文：知识就是力量'].map(s =>
                <button key={s} onClick={() => { send(s) }}>{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <Bubble
            key={i}
            className={`msg ${m.role === 'user' ? 'user' : 'assistant'}`}
            placement={m.role === 'user' ? 'end' : 'start'}
            variant={m.role === 'user' ? 'filled' : 'borderless'}
            content={m.content}
            contentRender={() => (
              <div className={`msg-body markdown-body ${m.role === 'user' ? 'user-text' : ''}`}>
                {m.role === 'user'
                  ? <div dangerouslySetInnerHTML={{ __html: m.content.replace(/</g, '&lt;').replace(/\n/g, '<br/>') }} />
                  : (m.content
                    ? <div dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                    : <span className="lab-typing"><span/><span/><span/></span>)}
              </div>
            )}
          />
        ))}
      </div>
      <div className="lab-input">
        <Sender ref={senderRef} className="ice-sender" placeholder={`向 ${model} 提问…`}
          onSubmit={send} loading={sending} autoSize={{ minRows: 1, maxRows: 5 }} />
      </div>
    </div>
  )
}

/* ============ 图片生成 ============ */
function ImageTab() {
  const [model, setModel] = useState(IMAGE_MODELS[0].id)
  const [size, setSize] = useState('1K')
  const [ratio, setRatio] = useState('1:1')
  const [prompt, setPrompt] = useState('')
  const [refs, setRefs] = useState('') // 参考图 URL，每行一个
  const [loading, setLoading] = useState(false)
  const [gallery, setGallery] = useState([]) // {url, prompt, model, size, ratio, ts}

  const generate = async () => {
    if (!prompt.trim() || loading) return
    setLoading(true)
    try {
      const refImages = refs.split('\n').map(s => s.trim()).filter(Boolean)
      const d = await request('/agnes/images', {
        method: 'POST',
        body: JSON.stringify({ model, prompt: prompt.trim(), size, ratio, ref_images: refImages.length ? refImages : null }),
      })
      if (d.error) { toast(d.error.slice(0, 120), 'error'); return }
      const url = d.url || (d.b64 ? `data:image/png;base64,${d.b64}` : null)
      if (!url) { toast('未返回图片', 'error'); return }
      setGallery(g => [{ url, prompt: prompt.trim(), model, size, ratio, ts: Date.now() }, ...g])
    } catch (e) {
      toast(e?.message || '生成失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="lab-image">
      <div className="lab-ctrl-row">
        <select value={model} onChange={e => setModel(e.target.value)}>
          {IMAGE_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={size} onChange={e => setSize(e.target.value)}>
          {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={ratio} onChange={e => setRatio(e.target.value)}>
          {RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="lab-prompt-box">
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
          placeholder="描述想要的画面：[主体] + [场景/环境] + [风格] + [光照] + [构图]"
          rows={3} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generate() }} />
        <button className="lab-primary" onClick={generate} disabled={!prompt.trim() || loading}>
          {loading ? <><Loader2 size={14} className="spin" /> 生成中（数秒~几十秒）</> : '生成图片'}
        </button>
      </div>
      <details className="lab-refs">
        <summary>参考图（图生图/多图合成，URL 每行一个，可留空）</summary>
        <textarea value={refs} onChange={e => setRefs(e.target.value)} rows={3}
          placeholder={'https://example.com/a.png\nhttps://example.com/b.png'} />
      </details>
      {gallery.length > 0 && (
        <div className="lab-gallery">
          {gallery.map(g => (
            <figure key={g.ts} className="lab-figure">
              <a href={g.url} target="_blank" rel="noreferrer"><img src={g.url} alt={g.prompt} loading="lazy" /></a>
              <figcaption>
                <span className="lab-fig-meta">{g.model.replace('agnes-image-', '')} · {g.size} · {g.ratio}</span>
                <span className="lab-fig-prompt">{g.prompt.slice(0, 60)}{g.prompt.length > 60 ? '…' : ''}</span>
                <a className="lab-dl" href={g.url} target="_blank" rel="noreferrer"><Download size={12} /> 打开原图</a>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}

/* ============ 视频生成（异步任务 + 轮询） ============ */
function VideoTab() {
  const [model, setModel] = useState(VIDEO_MODELS[0].id)
  const [aspect, setAspect] = useState('16:9')
  const [seconds, setSeconds] = useState(5)
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [tasks, setTasks] = useState([]) // {video_id, model, prompt, status, progress, url, error}

  // 轮询进行中的任务（3s 一次）
  const poll = useCallback(async () => {
    const active = tasks.filter(t => !['completed', 'failed'].includes(t.status))
    if (!active.length) return
    for (const t of active) {
      try {
        const d = await request(`/agnes/videos/query?video_id=${encodeURIComponent(t.video_id)}&model=${encodeURIComponent(t.model)}`)
        if (d.error) { setTasks(prev => prev.map(p => p.video_id === t.video_id ? { ...p, status: 'failed', error: d.error } : p)); continue }
        setTasks(prev => prev.map(p => p.video_id === t.video_id
          ? { ...p, status: d.status || p.status, progress: d.progress ?? p.progress, url: d.url || d.metadata?.url || p.url } : p))
      } catch { /* 单次失败继续 */ }
    }
  }, [tasks])

  useEffect(() => {
    const hasActive = tasks.some(t => !['completed', 'failed'].includes(t.status))
    if (!hasActive) return
    const timer = setInterval(poll, 3000)
    return () => clearInterval(timer)
  }, [tasks, poll])

  const submit = async () => {
    if (!prompt.trim() || submitting) return
    setSubmitting(true)
    try {
      let payload
      if (model === 'agnes-video-2.5-flash') {
        payload = { model, prompt: prompt.trim(), mode: 'text', size: '720P', aspect_ratio: aspect, seconds: String(seconds) }
      } else {
        // v2.0：无 seconds，时长 = num_frames / frame_rate，帧数须满足 8n+1
        const fps = 24
        const frames = Math.max(9, Math.round((seconds * fps - 1) / 8) * 8 + 1)
        const [w, h] = V20_DIMS[aspect] || V20_DIMS['16:9']
        payload = { model, prompt: prompt.trim(), width: w, height: h, num_frames: frames, frame_rate: fps }
      }
      const d = await request('/agnes/videos', { method: 'POST', body: JSON.stringify({ payload }) })
      if (d.error) { toast(d.error.slice(0, 140), 'error'); return }
      const vid = d.video_id || d.id
      if (!vid) { toast('未返回任务 ID', 'error'); return }
      setTasks(prev => [{ video_id: vid, model, prompt: prompt.trim(), status: d.status || 'pending', progress: d.progress ?? 0, url: null }, ...prev])
      toast('任务已提交，等待生成', 'success')
    } catch (e) {
      toast(e?.message || '提交失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="lab-video">
      <div className="lab-ctrl-row">
        <select value={model} onChange={e => { setModel(e.target.value); setAspect('16:9') }}>
          {VIDEO_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={aspect} onChange={e => setAspect(e.target.value)}>
          {(VIDEO_ASPECTS[model] || VIDEO_ASPECTS['agnes-video-2.5-flash']).map(a =>
            <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="lab-seconds">
          <span>{seconds}s</span>
          <input type="range" min="4" max="12" step="1" value={seconds}
            onChange={e => setSeconds(Number(e.target.value))} />
        </div>
      </div>
      <div className="lab-prompt-box">
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
          placeholder="描述视频画面与运镜，如：雨后未来城市街道，霓虹倒影，镜头缓慢推进，电影级"
          rows={3} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit() }} />
        <button className="lab-primary" onClick={submit} disabled={!prompt.trim() || submitting}>
          {submitting ? <><Loader2 size={14} className="spin" /> 提交中</> : '生成视频（免费）'}
        </button>
      </div>
      <div className="lab-tasks">
        {tasks.length === 0 && <div className="lab-empty small">提交后任务在此排队，完成后可直接播放 · 免费档有速率限制，报 429 稍等再试</div>}
        {tasks.map(t => (
          <div key={t.video_id} className={`lab-task ${t.status}`}>
            <div className="lab-task-head">
              <span className="lab-task-model">{t.model.replace('agnes-video-', '')}</span>
              <span className={`lab-task-status ${t.status}`}>
                {t.status === 'completed' ? '已完成' : t.status === 'failed' ? '失败' :
                  t.status === 'in_progress' ? `生成中 ${t.progress ?? 0}%` : '排队中'}
              </span>
            </div>
            <div className="lab-task-prompt">{t.prompt}</div>
            {t.status !== 'completed' && t.status !== 'failed' && (
              <div className="lab-progress"><div style={{ width: `${t.progress || 0}%` }} /></div>
            )}
            {t.error && <div className="lab-task-error">{t.error}</div>}
            {t.status === 'completed' && t.url && (
              <video controls preload="metadata" src={t.url} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
