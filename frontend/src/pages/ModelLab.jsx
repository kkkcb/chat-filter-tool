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
  const [templates, setTemplates] = useState(null) // 润色/修订的系统提示词模板（页面展示）

  useEffect(() => {
    request('/agnes/models').then(d => {
      setKeyOk(!!d.key_ok)
      setTemplates(d.prompt_templates || null)
    }).catch(() => setKeyOk(false))
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
      {tab === 'image' && <ImageTab templates={templates} />}
      {tab === 'video' && <VideoTab templates={templates} />}
    </div>
  )
}


/* 提示词模板面板：展示润色/修订背后的系统提示词（调试用） */
function PromptTemplatePanel({ templates, keys }) {
  if (!templates) return null
  const names = { video_polish: '视频·统一润色', video_revise: '视频·按指令修改', image_polish: '图片·统一润色', image_revise: '图片·按指令修改' }
  return (
    <details className="lab-templates">
      <summary>⚙ 提示词模板（润色/指令修改背后的系统提示词）</summary>
      {keys.map(k => (
        <div key={k} className="lab-template">
          <div className="lab-template-name">{names[k] || k}</div>
          <pre>{templates[k]}</pre>
        </div>
      ))}
    </details>
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

const IMAGE_MODULES = [
  { key: 'subject', name: '主体', hint: '核心人物/物体，如：发光浮空城市' },
  { key: 'scene', name: '场景/环境', hint: '环境与时间，如：日出时分的薄雾峡谷' },
  { key: 'style', name: '风格', hint: '艺术风格/写实度/质感，如：电影级写实' },
  { key: 'lighting', name: '光照', hint: '光源/方向/氛围，如：柔和金色光线' },
  { key: 'composition', name: '构图', hint: '景别/视角/布局，如：广角构图' },
  { key: 'quality', name: '质量要求', hint: '细节/清晰度/密度，如：丰富建筑细节，高视觉密度' },
]

/* ============ 图片生成 ============ */
function ImageTab({ templates }) {
  const [model, setModel] = useState(IMAGE_MODELS[0].id)
  const [size, setSize] = useState('1K')
  const [ratio, setRatio] = useState('1:1')
  const [prompt, setPrompt] = useState('')
  const [refs, setRefs] = useState('') // 参考图 URL，每行一个
  const [loading, setLoading] = useState(false)
  const [gallery, setGallery] = useState([]) // 后端持久化的生成历史
  // 高级提示词工作台（与视频同款流程）
  const [advanced, setAdvanced] = useState(false)
  const [modules, setModules] = useState({ subject: '', scene: '', style: '', lighting: '', composition: '', quality: '' })
  const [finalPrompt, setFinalPrompt] = useState('')
  const [instruction, setInstruction] = useState('')
  const [polishing, setPolishing] = useState(false)
  const [revising, setRevising] = useState(false)

  // 历史从后端加载：切页/刷新后画廊仍在
  useEffect(() => {
    request('/agnes/assets?kind=image').then(list => {
      setGallery(list.map(a => ({
        id: a.id, url: a.url, prompt: a.prompt, model: a.model,
        size: a.params?.size, ratio: a.params?.ratio,
      })))
    }).catch(() => {})
  }, [])

  const polish = async () => {
    if (polishing) return
    if (advanced) {
      if (!Object.values(modules).some(v => v.trim())) { toast('至少填写一个模块', 'error'); return }
    } else if (!prompt.trim()) return
    setPolishing(true)
    try {
      const d = await request('/agnes/polish-image-prompt', {
        method: 'POST',
        body: JSON.stringify(advanced ? { modules } : { prompt: prompt.trim() }),
      })
      if (d.error) { toast(d.error.slice(0, 120), 'error'); return }
      if (d.polished) {
        if (advanced) setFinalPrompt(d.polished)
        else setPrompt(d.polished)
        toast('已润色，确认后可生成（内容可再手改）', 'success')
      }
    } catch (e) {
      toast(e?.message || '润色失败', 'error')
    } finally {
      setPolishing(false)
    }
  }

  // 指定性润色：对当前提示词下自然语言指令
  const revise = async () => {
    const current = advanced ? finalPrompt : prompt
    if (!instruction.trim() || !current.trim() || revising) return
    setRevising(true)
    try {
      const d = await request('/agnes/revise-video-prompt', {
        method: 'POST',
        body: JSON.stringify({ prompt: current.trim(), instruction: instruction.trim(), kind: 'image' }),
      })
      if (d.error) { toast(d.error.slice(0, 120), 'error'); return }
      if (d.polished) {
        if (advanced) setFinalPrompt(d.polished)
        else setPrompt(d.polished)
        setInstruction('')
        toast('已按指令修改，确认后再生成', 'success')
      }
    } catch (e) {
      toast(e?.message || '修改失败', 'error')
    } finally {
      setRevising(false)
    }
  }

  const generate = async () => {
    const effectivePrompt = advanced ? finalPrompt.trim() : prompt.trim()
    if (!effectivePrompt || loading) {
      if (advanced && !effectivePrompt) toast('高级模式请先填写模块并润色，确认完整提示词后再生成', 'error')
      return
    }
    setLoading(true)
    try {
      const refImages = refs.split('\n').map(s => s.trim()).filter(Boolean)
      const d = await request('/agnes/images', {
        method: 'POST',
        body: JSON.stringify({ model, prompt: effectivePrompt, size, ratio, ref_images: refImages.length ? refImages : null }),
      })
      if (d.error) { toast(d.error.slice(0, 120), 'error'); return }
      const url = d.url || (d.b64 ? `data:image/png;base64,${d.b64}` : null)
      if (!url) { toast('未返回图片', 'error'); return }
      setGallery(g => [{ id: d.id || Date.now(), url, prompt: effectivePrompt, model, size, ratio }, ...g])
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
      <div className="lab-prompt-wrap">
        <div className="lab-prompt-mode">
          <span>提示词</span>
          <button className={`lab-mode-toggle ${advanced ? 'on' : ''}`} onClick={() => setAdvanced(a => !a)}>
            {advanced ? '高级模式（分模块）' : '简单模式'}
          </button>
          <span className="lab-mode-tip">
            {advanced ? '填写模块 → 统一润色 → 确认完整提示词 → 生成' : '一句话描述，可点润色扩写'}
          </span>
        </div>
        {advanced ? (
          <>
            <div className="lab-modules">
              {IMAGE_MODULES.map(m => (
                <label key={m.key} className="lab-module">
                  <span className="lab-module-name">{m.name}</span>
                  <textarea rows={2} value={modules[m.key]} placeholder={m.hint}
                    onChange={e => setModules(prev => ({ ...prev, [m.key]: e.target.value }))} />
                </label>
              ))}
            </div>
            {finalPrompt && (
              <div className="lab-final">
                <div className="lab-final-head">完整提示词（确认或手改后生成）</div>
                <textarea rows={3} value={finalPrompt} onChange={e => setFinalPrompt(e.target.value)} />
              </div>
            )}
          </>
        ) : (
          <div className="lab-prompt-box">
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
              placeholder="描述画面：主体 + 场景/环境 + 风格 + 光照 + 构图 + 质量要求，如：日出时分的薄雾峡谷上方的发光浮空城市，电影级写实，柔和金色光线"
              rows={3} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generate() }} />
          </div>
        )}
        {(advanced ? finalPrompt : prompt).trim() && (
          <div className="lab-revise">
            <input value={instruction} onChange={e => setInstruction(e.target.value)}
              placeholder="对当前提示词下修改指令，如：换成夜晚 / 光线改成冷色 / 加雪花"
              onKeyDown={e => { if (e.key === 'Enter') revise() }} />
            <button onClick={revise} disabled={!instruction.trim() || revising}>
              {revising ? <><Loader2 size={12} className="spin" /> 修改中</> : '按指令修改'}
            </button>
          </div>
        )}
        <div className="lab-prompt-actions">
          <button className="lab-polish" onClick={polish}
            disabled={polishing || (advanced ? !Object.values(modules).some(v => v.trim()) : !prompt.trim())}>
            {polishing ? <><Loader2 size={13} className="spin" /> 润色中</> : advanced ? '统一润色' : '润色'}
          </button>
          <button className="lab-primary" onClick={generate}
            disabled={loading || !(advanced ? finalPrompt.trim() : prompt.trim())}>
            {loading ? <><Loader2 size={14} className="spin" /> 生成中（数秒~几十秒）</> : '生成图片'}
          </button>
        </div>
      </div>
      <details className="lab-refs">
        <summary>参考图（图生图/多图合成，URL 每行一个，可留空）</summary>
        <textarea value={refs} onChange={e => setRefs(e.target.value)} rows={3}
          placeholder={'https://example.com/a.png\nhttps://example.com/b.png'} />
      </details>
      <PromptTemplatePanel templates={templates} keys={['image_polish', 'image_revise']} />
      {gallery.length > 0 && (
        <div className="lab-gallery">
          {gallery.map(g => (
            <figure key={g.id} className="lab-figure">
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
const VIDEO_MODES = [
  { id: 'text', name: '文生视频' },
  { id: 'keyframe', name: '首尾帧' },
  { id: 'reference', name: '参考图/音' },
]

const VIDEO_MODULES = [
  { key: 'subject', name: '主体与场景', hint: '人物/物体/环境/时间，如：橘猫在午后窗台' },
  { key: 'action', name: '动作与变化', hint: '主体怎么动、场景怎么变，如：伸懒腰，尾巴扫过台面' },
  { key: 'camera', name: '镜头语言', hint: '推/拉/摇/移/跟拍/固定/景别，如：中景固定机位' },
  { key: 'style', name: '视觉风格', hint: '光线/色彩/材质/写实度/氛围，如：暖色柔光，电影感' },
  { key: 'sound', name: '声音与节奏', hint: '环境声/动作声，如：轻微呼吸声，窗外鸟鸣' },
  { key: 'consistency', name: '一致性要求', hint: '保持不变的外观/细节/构图，如：毛色花纹不变' },
]

function VideoTab({ templates }) {
  const [model, setModel] = useState(VIDEO_MODELS[0].id)
  const [mode, setMode] = useState('text')
  const [aspect, setAspect] = useState('16:9')
  const [seconds, setSeconds] = useState(5)
  const [prompt, setPrompt] = useState('')
  const [polishing, setPolishing] = useState(false)
  // 高级模式：六要素分模块填写 → 统一润色 → 确认完整提示词再生成
  const [advanced, setAdvanced] = useState(false)
  const [modules, setModules] = useState({ subject: '', action: '', camera: '', style: '', sound: '', consistency: '' })
  const [finalPrompt, setFinalPrompt] = useState('') // 润色后的确认区（可手改）
  const [instruction, setInstruction] = useState('')  // 自然语言修改指令
  const [revising, setRevising] = useState(false)
  // 历史任务卡的指定性润色：reviseFor 打开哪张卡的指令行
  const [reviseFor, setReviseFor] = useState(null)
  const [taskInstruction, setTaskInstruction] = useState('')
  const [detailFor, setDetailFor] = useState(null) // 双击展开的请求详情卡
  const [firstFrame, setFirstFrame] = useState('')
  const [lastFrame, setLastFrame] = useState('')
  const [refImgs, setRefImgs] = useState('')
  const [refAudios, setRefAudios] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [tasks, setTasks] = useState([]) // {video_id, model, prompt, status, progress, url, error, upstream_created_at...}
  const isV25 = model === 'agnes-video-2.5-flash'
  const [now, setNow] = useState(Math.floor(Date.now() / 1000))

  // 有进行中任务时每秒走秒表（已用时显示）
  const hasActive = tasks.some(t => !['completed', 'failed'].includes(t.status))
  useEffect(() => {
    if (!hasActive) return
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(timer)
  }, [hasActive])

  // 历史任务从后端加载：切页/刷新后仍在；pending 的自动进入下方轮询
  useEffect(() => {
    request('/agnes/assets?kind=video').then(list => {
      setTasks(list.map(a => ({
        video_id: a.video_id, model: a.model, prompt: a.prompt,
        status: a.status, progress: a.progress, url: a.url, error: a.error, params: a.params,
        internal_progress: a.internal_progress,
        upstream_created_at: a.upstream_created_at, upstream_completed_at: a.upstream_completed_at,
      })))
    }).catch(() => {})
  }, [])

  // 轮询进行中的任务（3s 一次）
  const poll = useCallback(async () => {
    const active = tasks.filter(t => !['completed', 'failed'].includes(t.status))
    if (!active.length) return
    for (const t of active) {
      try {
        const d = await request(`/agnes/videos/query?video_id=${encodeURIComponent(t.video_id)}&model=${encodeURIComponent(t.model)}`)
        // 轮询请求本身失败（免费档限流 429/网络抖动）≠ 任务失败：
        // 跳过本轮，不动状态继续等下一轮
        if (d.error) continue
        const errMsg = typeof d.error === 'object' ? (d.error?.message || '') : (d.error || '')
        setTasks(prev => prev.map(p => p.video_id === t.video_id
          ? { ...p, status: d.status || p.status, progress: d.progress ?? p.progress,
              url: d.url || d.metadata?.url || p.url,
              internal_progress: d.internal_progress ?? p.internal_progress,
              upstream_completed_at: d.completed_at ?? p.upstream_completed_at,
              error: d.status === 'failed' ? (errMsg || '生成失败') : p.error } : p))
      } catch { /* 单次失败继续 */ }
    }
  }, [tasks])

  useEffect(() => {
    const hasActive = tasks.some(t => !['completed', 'failed'].includes(t.status))
    if (!hasActive) return
    // 5s：上游查询接口也限流（实测 3s 会撞"查询过于频繁"429）
    const timer = setInterval(poll, 5000)
    return () => clearInterval(timer)
  }, [tasks, poll])

  // 提示词润色：简单模式润色当前输入并原位替换；高级模式融合六模块到确认区
  const polish = async () => {
    if (polishing) return
    if (advanced) {
      const filled = Object.values(modules).some(v => v.trim())
      if (!filled) { toast('至少填写一个模块', 'error'); return }
    } else if (!prompt.trim()) return
    setPolishing(true)
    try {
      const body = advanced
        ? { modules }
        : { prompt: prompt.trim() }
      const d = await request('/agnes/polish-video-prompt', {
        method: 'POST', body: JSON.stringify(body),
      })
      if (d.error) { toast(d.error.slice(0, 120), 'error'); return }
      if (d.polished) {
        if (advanced) setFinalPrompt(d.polished)
        else setPrompt(d.polished)
        toast('已润色，确认后可生成（内容可再手改）', 'success')
      }
    } catch (e) {
      toast(e?.message || '润色失败', 'error')
    } finally {
      setPolishing(false)
    }
  }

  // 指定性润色：对已生成提示词下自然语言指令，只改指令涉及的部分
  const revise = async () => {
    const current = advanced ? finalPrompt : prompt
    if (!instruction.trim() || !current.trim() || revising) return
    setRevising(true)
    try {
      const d = await request('/agnes/revise-video-prompt', {
        method: 'POST',
        body: JSON.stringify({ prompt: current.trim(), instruction: instruction.trim() }),
      })
      if (d.error) { toast(d.error.slice(0, 120), 'error'); return }
      if (d.polished) {
        if (advanced) setFinalPrompt(d.polished)
        else setPrompt(d.polished)
        setInstruction('')
        toast('已按指令修改，确认后再生成', 'success')
      }
    } catch (e) {
      toast(e?.message || '修改失败', 'error')
    } finally {
      setRevising(false)
    }
  }

  // 历史任务卡：对该卡的提示词下指令修订，结果进高级模式确认区
  const reviseTask = async (task) => {
    if (!taskInstruction.trim() || !task.prompt || revising) return
    setRevising(true)
    try {
      const d = await request('/agnes/revise-video-prompt', {
        method: 'POST',
        body: JSON.stringify({ prompt: task.prompt, instruction: taskInstruction.trim() }),
      })
      if (d.error) { toast(d.error.slice(0, 120), 'error'); return }
      if (d.polished) {
        setAdvanced(true)
        setFinalPrompt(d.polished)
        setReviseFor(null)
        setTaskInstruction('')
        toast('已修订到确认区，可再改或直接生成', 'success')
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    } catch (e) {
      toast(e?.message || '修改失败', 'error')
    } finally {
      setRevising(false)
    }
  }

  const submit = async () => {
    const effectivePrompt = advanced ? finalPrompt.trim() : prompt.trim()
    if (!effectivePrompt || submitting) {
      if (advanced && !effectivePrompt) toast('高级模式请先填写模块并点击润色，确认完整提示词后再生成', 'error')
      return
    }
    // 模式校验（Flash 限制：图≤5 音≤3 不支持参考视频）
    const imgs = refImgs.split('\n').map(s => s.trim()).filter(Boolean)
    const audios = refAudios.split('\n').map(s => s.trim()).filter(Boolean)
    if (isV25 && mode === 'keyframe' && !firstFrame.trim() && !lastFrame.trim()) {
      toast('首尾帧模式至少提供一个首帧或尾帧 URL', 'error'); return
    }
    if (isV25 && mode === 'reference' && !imgs.length && !audios.length) {
      toast('参考模式至少提供一张图片或一段音频 URL', 'error'); return
    }
    if (imgs.length > 5) { toast('参考图最多 5 张（Flash 限制）', 'error'); return }
    if (audios.length > 3) { toast('参考音频最多 3 段（Flash 限制）', 'error'); return }
    setSubmitting(true)
    try {
      let payload
      if (model === 'agnes-video-2.5-flash') {
        payload = { model, prompt: effectivePrompt, mode, size: '720P', aspect_ratio: aspect, seconds: String(seconds) }
        if (mode === 'keyframe') {
          if (firstFrame.trim()) payload.first_frame = firstFrame.trim()
          if (lastFrame.trim()) payload.last_frame = lastFrame.trim()
        } else if (mode === 'reference') {
          if (imgs.length) payload.images = imgs
          if (audios.length) payload.audios = audios
        }
      } else {
        // v2.0：无 seconds，时长 = num_frames / frame_rate，帧数须满足 8n+1
        const fps = 24
        const frames = Math.max(9, Math.round((seconds * fps - 1) / 8) * 8 + 1)
        const [w, h] = V20_DIMS[aspect] || V20_DIMS['16:9']
        payload = { model, prompt: effectivePrompt, width: w, height: h, num_frames: frames, frame_rate: fps }
      }
      const d = await request('/agnes/videos', { method: 'POST', body: JSON.stringify({ payload }) })
      if (d.error) { toast(d.error.slice(0, 140), 'error'); return }
      const vid = d.video_id || d.id
      if (!vid) { toast('未返回任务 ID', 'error'); return }
      setTasks(prev => [{ video_id: vid, model, prompt: effectivePrompt, status: d.status || 'pending',
        progress: d.progress ?? 0, url: null, params: payload, internal_progress: d.internal_progress,
        upstream_created_at: d.created_at, upstream_completed_at: d.completed_at }, ...prev])
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
        <select value={model} onChange={e => { setModel(e.target.value); setMode('text'); setAspect('16:9') }}>
          {VIDEO_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {isV25 && (
          <select value={mode} onChange={e => setMode(e.target.value)}>
            {VIDEO_MODES.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
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
      {isV25 && mode === 'keyframe' && (
        <div className="lab-media-row">
          <input value={firstFrame} onChange={e => setFirstFrame(e.target.value)} placeholder="首帧图片 URL（必填一个，需公网可访问且带图片扩展名）" />
          <input value={lastFrame} onChange={e => setLastFrame(e.target.value)} placeholder="尾帧图片 URL（可选）" />
        </div>
      )}
      {isV25 && mode === 'reference' && (
        <div className="lab-media-col">
          <textarea value={refImgs} onChange={e => setRefImgs(e.target.value)} rows={2}
            placeholder={'参考图片 URL，每行一个（最多 5 张，需公网可访问且带扩展名如 .png/.jpg）\n提示词中用 <Picture 1>、<Picture 2> 指代'} />
          <textarea value={refAudios} onChange={e => setRefAudios(e.target.value)} rows={2}
            placeholder={'参考音频 URL，每行一个（最多 3 段，可留空，需带 .mp3 等扩展名）\n提示词中用 <Audio 1> 指代节奏/氛围'} />
        </div>
      )}
      <div className="lab-prompt-wrap">
        <div className="lab-prompt-mode">
          <span>提示词</span>
          <button className={`lab-mode-toggle ${advanced ? 'on' : ''}`} onClick={() => setAdvanced(a => !a)}>
            {advanced ? '高级模式（分模块）' : '简单模式'}
          </button>
          <span className="lab-mode-tip">
            {advanced ? '填写模块 → 统一润色 → 确认完整提示词 → 生成' : '一句话描述，可点润色扩写'}
          </span>
        </div>
        {advanced ? (
          <>
            <div className="lab-modules">
              {VIDEO_MODULES.map(m => (
                <label key={m.key} className="lab-module">
                  <span className="lab-module-name">{m.name}</span>
                  <textarea rows={2} value={modules[m.key]} placeholder={m.hint}
                    onChange={e => setModules(prev => ({ ...prev, [m.key]: e.target.value }))} />
                </label>
              ))}
            </div>
            {finalPrompt && (
              <div className="lab-final">
                <div className="lab-final-head">完整提示词（确认或手改后生成）</div>
                <textarea rows={4} value={finalPrompt} onChange={e => setFinalPrompt(e.target.value)} />
              </div>
            )}
          </>
        ) : (
          <div className="lab-prompt-box">
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
              placeholder="描述视频画面与运镜：主体与场景 → 动作变化 → 镜头语言 → 视觉风格（写完可点「润色」自动扩写成六要素专业提示词）"
              rows={3} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit() }} />
          </div>
        )}
        {(advanced ? finalPrompt : prompt).trim() && (
          <div className={`lab-revise ${advanced ? '' : 'standalone'}`}>
            <input value={instruction} onChange={e => setInstruction(e.target.value)}
              placeholder="对当前提示词下修改指令，如：镜头改成航拍远景 / 氛围换成冬天雪夜"
              onKeyDown={e => { if (e.key === 'Enter') revise() }} />
            <button onClick={revise} disabled={!instruction.trim() || revising}>
              {revising ? <><Loader2 size={12} className="spin" /> 修改中</> : '按指令修改'}
            </button>
          </div>
        )}
        <div className="lab-prompt-actions">
          <button className="lab-polish" onClick={polish}
            disabled={polishing || (advanced ? !Object.values(modules).some(v => v.trim()) : !prompt.trim())}>
            {polishing ? <><Loader2 size={13} className="spin" /> 润色中</> : advanced ? '统一润色' : '润色'}
          </button>
          <button className="lab-primary" onClick={submit}
            disabled={submitting || !(advanced ? finalPrompt.trim() : prompt.trim())}>
            {submitting ? <><Loader2 size={14} className="spin" /> 提交中</> : '生成视频（免费）'}
          </button>
        </div>
      </div>
      <PromptTemplatePanel templates={templates} keys={['video_polish', 'video_revise']} />
      <div className="lab-tasks">
        {tasks.length === 0 && <div className="lab-empty small">提交后任务在此排队，完成后可直接播放 · 免费档有速率限制，报 429 稍等再试 · 双击提示词可看完整请求</div>}
        {tasks.map(t => {
          // 计时全部用上游返回的时间戳，不做本地推测；拿不到就不显示
          const active = !['completed', 'failed'].includes(t.status)
          const elapsed = active && t.upstream_created_at ? Math.max(0, now - t.upstream_created_at) : null
          const total = !active && t.upstream_created_at && t.upstream_completed_at
            ? t.upstream_completed_at - t.upstream_created_at : null
          // 进度：上游 internal_progress 比粗粒度 progress 更细时优先显示（同为真实返回）
          const finer = Number.isFinite(Number(t.internal_progress))
            && Number(t.internal_progress) > (t.progress || 0)
            && Number(t.internal_progress) < 100
            ? Number(t.internal_progress) : (t.progress || 0)
          const fmt = s => s < 60 ? `${s}秒` : `${Math.floor(s / 60)}分${s % 60}秒`
          return (
          <div key={t.video_id} className={`lab-task ${t.status}`}>
            <div className="lab-task-head">
              <span className="lab-task-model">{t.model.replace('agnes-video-', '')}</span>
              <span className={`lab-task-status ${t.status}`}>
                {t.status === 'completed' ? `已完成${total != null ? ' · 耗时' + fmt(total) : ''}`
                  : t.status === 'failed' ? '失败'
                  : t.status === 'in_progress'
                    ? `生成中 ${finer}%${elapsed != null ? ' · 已' + fmt(elapsed) : ''}`
                    : `排队中${elapsed != null ? ' · 已' + fmt(elapsed) : ''}`}
              </span>
            </div>
            <div className="lab-task-prompt" title="双击查看完整请求"
              onDoubleClick={() => setDetailFor(detailFor === t.video_id ? null : t.video_id)}>{t.prompt}</div>
            {detailFor === t.video_id && (
              <div className="lab-request-detail">
                <div className="lab-template-name">完整请求（发给上游的 JSON）</div>
                <pre>{JSON.stringify({ model: t.model, prompt: t.prompt, ...(t.params || {}) }, null, 2)}</pre>
              </div>
            )}
            <button className="lab-task-revise-btn" onClick={() => {
              setReviseFor(reviseFor === t.video_id ? null : t.video_id)
              setTaskInstruction('')
            }}>改提示词</button>
            {reviseFor === t.video_id && (
              <div className="lab-revise in-card">
                <input value={taskInstruction} onChange={e => setTaskInstruction(e.target.value)}
                  placeholder="对这个视频的提示词下指令，如：镜头换成航拍 / 换成夜晚场景"
                  onKeyDown={e => { if (e.key === 'Enter') reviseTask(t) }} />
                <button onClick={() => reviseTask(t)} disabled={!taskInstruction.trim() || revising}>
                  {revising ? <><Loader2 size={12} className="spin" /> 修改中</> : '按指令修改'}
                </button>
              </div>
            )}
            {active && (
              <div className="lab-progress"><div style={{ width: `${finer || 3}%` }} /></div>
            )}
            {t.error && <div className="lab-task-error">{t.error}</div>}
            {t.status === 'completed' && t.url && (
              <video controls preload="metadata" src={t.url} />
            )}
          </div>
          )
        })}
      </div>
    </div>
  )
}
