import { useState, useRef, useEffect } from 'react'
import {
  ListChecks, Fish, PenLine, Sparkles, Lightbulb, ClipboardList, X,
} from 'lucide-react'
import { ARTICLES } from '../utils/articles'
import { sendChat } from '../api/chat'
import { renderMarkdown } from '../utils/markdown'
import './WritingStudio.css'

export default function WritingStudio() {
  const [selectedArticle, setSelectedArticle] = useState(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [aiResult, setAiResult] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiAction, setAiAction] = useState('')
  const [savedAt, setSavedAt] = useState(null)
  const textareaRef = useRef(null)

  // 自动保存到 localStorage
  useEffect(() => {
    const saved = localStorage.getItem('ws_draft')
    if (saved) {
      try {
        const data = JSON.parse(saved)
        setTitle(data.title || '')
        setContent(data.content || '')
      } catch {}
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('ws_draft', JSON.stringify({ title, content }))
      if (title || content) setSavedAt(new Date())
    }, 2000)
    return () => clearTimeout(timer)
  }, [title, content])

  const selectArticle = (article) => {
    setSelectedArticle(article)
    if (!title) setTitle(article.title)
    setContent(prev => prev || generateSkeleton(article))
  }

  const generateSkeleton = (a) => {
    return `# ${a.title}

> ${a.metaphor}

## 开头（Hook）

## 核心概念：${a.concepts.join('、')}
${a.concept}

## 类比解释
${a.metaphor}

## 生活场景


## 常见误区


## 总结


---
*迁移任务：${a.task}*
`
  }

  const aiTools = [
    { action: 'outline', Icon: ListChecks, label: '生成大纲' },
    { action: 'hook', Icon: Fish, label: '开头 Hook' },
    { action: 'continue', Icon: PenLine, label: '续写下一段' },
    { action: 'polish', Icon: Sparkles, label: '润色文章' },
  ]

  const callAI = async (action) => {
    setAiLoading(true); setAiResult(''); setAiAction(action)
    // 路线文章参考块（选了才有）
    const articleRef = selectedArticle
      ? `主题：${selectedArticle.title}\n核心概念：${selectedArticle.concepts.join('、')}\n比喻：${selectedArticle.metaphor}\n迁移任务：${selectedArticle.task}`
      : '（未选择路线文章）'
    const prompts = {
      polish: `请润色以下文章片段，保持科普风格，让语言更生动适合大众阅读：\n\n${content.substring(0, 2000)}`,
      // 大纲 = 第一步：读取页面全部信息（标题+正文+路线参考），产出后自动补充到正文末尾
      outline: `请基于以下写作页面的全部信息，生成一份详细的写作大纲，包含：开头 hook 思路、3-5 个核心段落（每段一个小标题 + 2-3 条要点）、结尾落点。直接输出 Markdown 大纲本身：\n\n【标题】${title || selectedArticle?.title || '（未填写）'}\n\n【当前正文】\n${content || '（正文为空）'}\n\n【路线参考】\n${articleRef}`,
      continue: `请续写以下文章的下一段（150字以内）：\n\n${content.substring(content.length - 800)}`,
      hook: `请为以下文章生成 3 个不同的开头（Hook），要求：从生活场景切入、引发好奇心、50字以内：\n\n主题：${title || selectedArticle?.title}\n概念：${selectedArticle?.concepts.join('、') || ''}`,
    }
    try {
      const data = await sendChat({ message: prompts[action] || prompts.polish })
      setAiResult(data.reply)
      if (action === 'outline') {
        setContent(prev => (prev ? prev + '\n\n' + data.reply : data.reply))
      }
    } catch (e) {
      setAiResult(`请求失败：${e?.message || '网络错误，请确认后端已启动'}`)
    }
    setAiLoading(false)
  }

  const insertResult = () => {
    if (!aiResult) return
    setContent(prev => prev + '\n\n' + aiResult)
    setAiResult('')
    setAiAction('')
  }

  const wordCount = content.replace(/\s/g, '').length

  return (
    <div className="ws-container">
      {/* 顶部工具栏 */}
      <div className="ws-toolbar">
        <div className="ws-toolbar-left">
          <select
            className="ws-article-select"
            value={selectedArticle?.seq || ''}
            onChange={(e) => {
              const seq = parseInt(e.target.value)
              const article = ARTICLES.find(a => a.seq === seq)
              if (article) selectArticle(article)
            }}
          >
            <option value="">选择路线文章...</option>
            {ARTICLES.map(a => (
              <option key={a.seq} value={a.seq}>
                {a.seq}. {a.title}
              </option>
            ))}
          </select>
        </div>
        <div className="ws-toolbar-right">
          {savedAt && (
            <span className="ws-saved">
              <span className="ws-save-dot" />
              已自动保存 {savedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · {wordCount} 字
            </span>
          )}
          <button
            className={`ws-mode-btn ${!showPreview ? 'active' : ''}`}
            onClick={() => setShowPreview(false)}
          >编辑</button>
          <button
            className={`ws-mode-btn ${showPreview ? 'active' : ''}`}
            onClick={() => setShowPreview(true)}
          >预览</button>
        </div>
      </div>

      {/* 主体 — 左编辑 + 右 AI */}
      <div className="ws-body">
        {/* 编辑/预览区 */}
        <div className="ws-editor-area">
          <input
            className="ws-title-input"
            value={title}
            placeholder="文章标题..."
            onChange={(e) => setTitle(e.target.value)}
          />
          {showPreview ? (
            <div className="ws-preview">
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(content || '*开始写作...*') }} />
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              className="ws-content-input"
              value={content}
              placeholder="开始写作..."
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
            />
          )}
        </div>

        {/* AI 辅助面板 */}
        <div className="ws-ai-panel">
          <div className="ws-ai-header">
            <span className="ws-ai-title">AI 写作助手</span>
          </div>
          <div className="ws-ai-tools">
            {aiTools.map(({ action, Icon, label }) => (
              <button key={action} className="ws-ai-tool" onClick={() => callAI(action)} disabled={aiLoading}>
                <span className="tool-icon"><Icon size={20} strokeWidth={1.8} /></span>
                <span className="tool-name">{label}</span>
              </button>
            ))}
          </div>

          {/* 文章参考 */}
          {selectedArticle && (
            <div className="ws-ref-card">
              <div className="ws-ref-label">路线参考</div>
              <div className="ws-ref-metaphor">
                <span className="ws-ref-icon"><Lightbulb size={13} strokeWidth={2} /></span>
                {selectedArticle.metaphor}
              </div>
              <div className="ws-ref-concepts">
                {selectedArticle.concepts.map((c, i) => (
                  <span key={i} className="ws-ref-tag">{c}</span>
                ))}
              </div>
              <div className="ws-ref-task">
                <span className="ws-ref-icon"><ClipboardList size={13} strokeWidth={2} /></span>
                {selectedArticle.task}
              </div>
            </div>
          )}

          {/* AI 结果 */}
          {aiLoading && (
            <div className="ws-ai-loading">
              <div className="ws-spinner" />
              <span>AI 正在写作中...</span>
            </div>
          )}
          {!aiLoading && aiResult && (
            <div className="ws-ai-result">
              <div className="ws-ai-result-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(aiResult) }} />
              <div className="ws-ai-actions">
                {aiAction === 'outline' ? (
                  <span className="ws-ai-auto-hint">✓ 已补充到文章末尾</span>
                ) : (
                  <button className="ws-ai-insert" onClick={insertResult}>插入到文章</button>
                )}
                <button className="ws-ai-dismiss" onClick={() => { setAiResult(''); setAiAction('') }}>
                  <X size={13} strokeWidth={2} /> 清除
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
