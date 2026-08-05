import { useState } from 'react'
import {
  Lightbulb, Target, PencilLine, Microscope, Sparkles,
  Copy, Check, HelpCircle, ClipboardList,
} from 'lucide-react'
import { inspire } from '../api/inspire'
import './InspireWorkshop.css'

export default function InspireWorkshop() {
  const [tool, setTool] = useState('topics')

  const tools = [
    { key: 'topics', Icon: Target, title: '选题建议', desc: '基于已收藏素材，推荐 3 个值得写的选题' },
    { key: 'titles', Icon: PencilLine, title: '标题工坊', desc: '输入话题，生成 5 种风格的标题' },
    { key: 'angle', Icon: Microscope, title: '角度挖掘', desc: '为话题提供独特的科普切入角度' },
  ]

  return (
    <div className="inspire-view">
      <div className="inspire-header">
        <h2 className="header-title"><Lightbulb size={18} strokeWidth={2.2} /> 创作灵感</h2>
        <p>从你的知识库素材中，挖掘选题、标题和科普角度</p>
      </div>
      <div className="inspire-content">
        <div className="tool-grid">
          {tools.map(({ key, Icon, title, desc }) => (
            <div key={key} className={`tool-card ${tool === key ? 'active' : ''}`} onClick={() => setTool(key)}>
              <div className="tc-icon"><Icon size={28} strokeWidth={1.8} /></div>
              <div className="tc-title">{title}</div>
              <div className="tc-desc">{desc}</div>
            </div>
          ))}
        </div>

        {tool === 'topics' && <TopicsPanel />}
        {tool === 'titles' && <TitlesPanel />}
        {tool === 'angle' && <AnglePanel />}
      </div>
    </div>
  )
}

function TopicsPanel() {
  const [loading, setLoading] = useState(false)
  const [topics, setTopics] = useState(null)

  const generate = async () => {
    setLoading(true); setTopics(null)
    try {
      const data = await inspire({ action: 'topics' })
      setTopics(data.topics || [])
    } catch (e) { setTopics([]) }
    setLoading(false)
  }

  return (
    <div className="tool-panel">
      <div className="tool-panel-header">
        <h3 className="header-title"><Target size={16} strokeWidth={2.2} /> 选题建议</h3>
        <button className="btn btn-primary" disabled={loading} onClick={generate}>
          {loading ? '生成中...' : '生成选题'}
        </button>
      </div>
      {loading && <Loading />}
      {!loading && topics === null && <EmptyState Icon={Target} text="点击「生成选题」，从你的素材库中挖掘灵感" />}
      {!loading && topics !== null && topics.length === 0 && <EmptyState Icon={HelpCircle} text="没有生成结果，请重试" />}
      {!loading && topics?.length > 0 && (
        <>
          <div className="result-section-title"><ClipboardList size={14} strokeWidth={2} /> 生成 {topics.length} 个选题</div>
          {topics.map((t, i) => (
            <div key={i} className="idea-card fade-in">
              <div className="ic-title">{i+1}. {t.title}</div>
              {t.concepts?.length > 0 && (
                <div className="ic-concepts">
                  {t.concepts.map((c, j) => <span key={j} className="ic-concept">{c}</span>)}
                </div>
              )}
              {t.reason && <div className="ic-reason"><strong>为什么写：</strong>{t.reason}</div>}
              {t.angle && (
                <div className="ic-angle">
                  <span className="ic-angle-icon"><Lightbulb size={13} strokeWidth={2} /></span>
                  <span><strong>科普角度：</strong>{t.angle}</span>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function TitlesPanel() {
  const [topic, setTopic] = useState('')
  const [loading, setLoading] = useState(false)
  const [titles, setTitles] = useState(null)
  const [copiedIdx, setCopiedIdx] = useState(null)

  const generate = async () => {
    if (!topic.trim()) return
    setLoading(true); setTitles(null)
    try {
      const data = await inspire({ action: 'titles', topic })
      setTitles(data.titles || [])
    } catch (e) { setTitles([]) }
    setLoading(false)
  }

  const styles = ['疑问', '数字', '对比', '故事', '反常识']

  const handleCopy = (text, idx) => {
    navigator.clipboard.writeText(text)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 1500)
  }

  return (
    <div className="tool-panel">
      <div className="tool-panel-header"><h3 className="header-title"><PencilLine size={16} strokeWidth={2.2} /> 标题工坊</h3></div>
      <div className="input-row">
        <input
          type="text"
          value={topic}
          placeholder="输入你的话题，比如：为什么 AI 会胡说八道"
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && generate()}
        />
        <button className="btn btn-primary" disabled={loading} onClick={generate}>
          {loading ? '生成中...' : '生成标题'}
        </button>
      </div>
      {loading && <Loading />}
      {!loading && titles === null && <EmptyState Icon={PencilLine} text="输入话题后点击生成" />}
      {!loading && titles?.length === 0 && <EmptyState Icon={HelpCircle} text="没有生成结果，请重试" />}
      {!loading && titles?.length > 0 && (
        <>
          <div className="result-section-title"><Sparkles size={14} strokeWidth={2} /> 生成 {titles.length} 个标题</div>
          <div className="title-list">
            {titles.map((t, i) => (
              <div key={i} className="title-item fade-in">
                <span className="ti-style">{styles[i] || '创意'}</span>
                <span className="ti-text">{t}</span>
                <span className="ti-copy" onClick={() => handleCopy(t, i)}>
                  {copiedIdx === i ? <Check size={14} strokeWidth={2.5} className="copied" /> : <Copy size={14} strokeWidth={2} />}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function AnglePanel() {
  const [topic, setTopic] = useState('')
  const [loading, setLoading] = useState(false)
  const [angles, setAngles] = useState(null)

  const generate = async () => {
    if (!topic.trim()) return
    setLoading(true); setAngles(null)
    try {
      const data = await inspire({ action: 'angle', topic })
      setAngles(data.angles || [])
    } catch (e) { setAngles([]) }
    setLoading(false)
  }

  return (
    <div className="tool-panel">
      <div className="tool-panel-header"><h3 className="header-title"><Microscope size={16} strokeWidth={2.2} /> 角度挖掘</h3></div>
      <div className="input-row">
        <input
          type="text"
          value={topic}
          placeholder="输入你的话题，比如：什么是 Token"
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && generate()}
        />
        <button className="btn btn-primary" disabled={loading} onClick={generate}>
          {loading ? '挖掘中...' : '挖掘角度'}
        </button>
      </div>
      {loading && <Loading />}
      {!loading && angles === null && <EmptyState Icon={Microscope} text="输入话题后点击挖掘" />}
      {!loading && angles?.length === 0 && <EmptyState Icon={HelpCircle} text="没有生成结果，请重试" />}
      {!loading && angles?.length > 0 && (
        <>
          <div className="result-section-title"><Microscope size={14} strokeWidth={2} /> 挖掘出 {angles.length} 个角度</div>
          {angles.map((a, i) => (
            <div key={i} className="angle-card fade-in">
              <div className="ac-name">
                <Target size={15} strokeWidth={2} /> {i+1}. {a.name}
              </div>
              {a.hook && <div className="ac-row"><span className="label">开头</span>{a.hook}</div>}
              {a.analogy && <div className="ac-row"><span className="label">类比</span>{a.analogy}</div>}
              {a.conflict && <div className="ac-row"><span className="label">悬念</span>{a.conflict}</div>}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function Loading() {
  return (
    <div className="loading-state">
      <div className="spinner" />
      <p>AI 正在思考中...</p>
    </div>
  )
}

function EmptyState({ Icon, text }) {
  return (
    <div className="empty-state">
      <div className="icon"><Icon size={36} strokeWidth={1.5} /></div>
      <p>{text}</p>
    </div>
  )
}
