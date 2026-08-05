import { useState } from 'react'
import { X, Sparkles, Loader2, Check, AlertCircle } from 'lucide-react'
import { confirmSave } from '../../api/chat'
import { useMaterialStore } from '../../stores/materialStore'

const CATEGORIES = [
  'AI概念与原理', 'AI工具与产品', 'AI科普灵感',
  'GitHub项目', '行业资讯', '写作技巧', '待分类',
]

const TYPE_LABELS = {
  image: '图片', voice: '语音', video: '视频', sticker: '表情',
  link: '链接', location: '位置', card: '名片', voip: '通话', system: '系统', recall: '撤回',
}

function fmtTs(ts) {
  if (!ts) return ''
  try {
    return new Date(ts * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

/** 简单 hash（用于 url 去重，非加密） */
function simpleHash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(36)
}

function buildEntry(contact, msgs, { title, summary, category, tags }) {
  const sorted = [...msgs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
  const joined = sorted.map(m => m.content || `[${TYPE_LABELS[m.type] || m.type || '消息'}]`).join('\n')

  const content = sorted.map(m => {
    const t = fmtTs(m.timestamp)
    const body = m.content || `*[${TYPE_LABELS[m.type] || m.type || '消息'}]*`
    const who = m.sender === 'me' ? '我' : (m.sender || '对方')
    return `> **${who}**${t ? ' · ' + t : ''}\n> ${body}\n`
  }).join('\n')

  const timeRange = sorted.length
    ? `${fmtTs(sorted[0].timestamp)} ~ ${fmtTs(sorted[sorted.length - 1].timestamp)}`
    : ''

  const firstText = sorted.find(m => m.content)?.content || ''

  return {
    title: title || `微信对话｜${contact.name}${contact.is_group ? '（群）' : ''}`,
    url: `wechat://chat/${contact.username || contact.name}#${simpleHash(joined).slice(0, 12)}`,
    source_type: 'wechat',
    category: category || 'AI科普灵感',
    summary: summary || firstText.slice(0, 80),
    tags: tags?.length ? tags : ['微信', contact.name, ...(contact.is_group ? ['群聊'] : [])],
    extra_text: `来自 ${contact.name} · ${sorted.length}条消息 · ${timeRange}`,
    content,
  }
}

export default function CollectDialog({ contact, selectedMsgs, messages, onClose }) {
  const { fetchStats } = useMaterialStore()
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [category, setCategory] = useState('AI科普灵感')
  const [tagsInput, setTagsInput] = useState('')
  const [state, setState] = useState('idle')  // idle | saving | done | error
  const [error, setError] = useState('')

  const msgList = messages.filter((_, i) => selectedMsgs.has(i))
  const hasTextContent = msgList.some(m => m.content)

  const handleSubmit = async () => {
    if (!hasTextContent) {
      setError('请至少选择一条含文字的消息')
      return
    }
    setState('saving')
    setError('')
    try {
      const tags = tagsInput.split(/[,，\s]+/).filter(Boolean)
      const entry = buildEntry(contact, msgList, { title, summary, category, tags })
      const result = await confirmSave(entry)
      if (result.success === false) {
        setState('error')
        setError(result.message || '保存失败')
        return
      }
      setState('done')
      fetchStats()
      setTimeout(() => onClose(), 1200)
    } catch (e) {
      setState('error')
      setError(e.message || '保存失败')
    }
  }

  return (
    <div className="wx-modal-overlay" onClick={onClose}>
      <div className="wx-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wx-modal-header">
          <span><Sparkles size={16} strokeWidth={2} /> 收入素材库</span>
          <button className="wx-modal-close" onClick={onClose}><X size={18} strokeWidth={2} /></button>
        </div>

        {state === 'done' ? (
          <div className="wx-modal-success">
            <Check size={40} strokeWidth={1.5} />
            <p>已收入素材库</p>
            <span>AI 创作时可引用这条微信摘录</span>
          </div>
        ) : (
          <div className="wx-modal-body">
            {/* 消息预览 */}
            <div className="wx-collect-preview">
              {msgList.map((m, i) => (
                <div key={i} className={`wx-preview-bubble ${m.sender === 'me' ? 'me' : 'other'}`}>
                  <span className="wx-preview-sender">{m.sender === 'me' ? '我' : m.sender || contact.name}</span>
                  <span className="wx-preview-text">
                    {m.content || `[${TYPE_LABELS[m.type] || m.type || '消息'}]`}
                  </span>
                </div>
              ))}
            </div>

            {/* 字段编辑 */}
            <div className="wx-collect-form">
              <div className="wx-form-row">
                <label>标题</label>
                <input
                  placeholder={`微信对话｜${contact.name}`}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="wx-form-row">
                <label>摘要</label>
                <input
                  placeholder="留空则取首条消息前80字"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                />
              </div>
              <div className="wx-form-row">
                <label>分类</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="wx-form-row">
                <label>标签</label>
                <input
                  placeholder="微信, 对方名（逗号分隔）"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <div className="wx-collect-error"><AlertCircle size={14} strokeWidth={2} /> {error}</div>
            )}

            <div className="wx-modal-footer">
              <button className="wx-btn-secondary" onClick={onClose}>取消</button>
              <button className="wx-btn-primary" onClick={handleSubmit} disabled={state === 'saving'}>
                {state === 'saving' ? <Loader2 size={14} strokeWidth={2.5} className="wx-spin" /> : <Sparkles size={14} strokeWidth={2} />}
                收入素材库
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
