import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  NotebookPen, Search, Plus, X, Trash2, Pencil, Copy, MessageSquareQuote,
  Loader2, Check, Clock, FolderOpen, Plug, FolderPlus, ScanText, Maximize2, Minimize2, BookOpen,
} from 'lucide-react'
import { useNoteStore } from '../stores/noteStore'
import { getNote, uploadNoteImage } from '../api/notes'
import { analyzeVision } from '../api/vision'
import { renderMarkdown } from '../utils/markdown'
import { toast } from '../components/Toast'
import { confirmDialog } from '../components/Confirm'
import KbApiModal from '../components/KbApiModal'
import Library from './Library'
import './PersonalKB.css'

/** 标签配色 — 按标签名 hash 落到固定色板，视觉稳定 */
const TAG_COLORS = [
  { bg: '#fff1ec', fg: '#c2410c' }, { bg: '#ecfdf5', fg: '#047857' },
  { bg: '#eff6ff', fg: '#1d4ed8' }, { bg: '#fef9c3', fg: '#a16207' },
  { bg: '#f5f3ff', fg: '#6d28d9' }, { bg: '#fdf2f8', fg: '#be185d' },
]
function tagColor(tag) {
  let h = 0
  for (let i = 0; i < tag.length; i++) h = ((h << 5) - h + tag.charCodeAt(i)) | 0
  return TAG_COLORS[Math.abs(h) % TAG_COLORS.length]
}

/** 分类配色 — 与标签同思路但用另一组色相，区分层级 */
const CAT_COLORS = [
  { bg: '#e8f4fd', fg: '#0369a1', bar: '#0284c7' }, { bg: '#ecfdf5', fg: '#047857', bar: '#059669' },
  { bg: '#fef3e2', fg: '#b45309', bar: '#d97706' }, { bg: '#f3e8ff', fg: '#7e22ce', bar: '#9333ea' },
  { bg: '#fde8ef', fg: '#be185d', bar: '#db2777' }, { bg: '#eef2ff', fg: '#4338ca', bar: '#4f46e5' },
  { bg: '#ecfeff', fg: '#0e7490', bar: '#0891b2' }, { bg: '#f1f5f9', fg: '#475569', bar: '#64748b' },
]
function catColor(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0
  return CAT_COLORS[Math.abs(h) % CAT_COLORS.length]
}

/** 编辑弹窗里分类输入框的候选建议（已有分类之外的首选示例） */
const CATEGORY_SUGGESTIONS = ['技术原理', '个人规划', '踩坑记录', '灵感想法']

function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  } catch { return '' }
}

export default function PersonalKB() {
  const { notes, stats, loading, loadNotes, refresh, removeNote,
          newCategory, doRenameCategory, doDeleteCategory } = useNoteStore()
  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState('')
  const [activeCategory, setActiveCategory] = useState('')
  const [creating, setCreating] = useState(false)      // 分类条内联新建输入框
  const [newCatName, setNewCatName] = useState('')
  const [renaming, setRenaming] = useState(null)       // 正在重命名的分类名
  const [renameValue, setRenameValue] = useState('')
  const searchTimer = useRef(null)

  const handleDelete = (note) => handleDeleteNote(note, removeNote)

  // 弹窗状态：null | {mode:'view', id} | {mode:'edit', id} | {mode:'create'}
  const [modal, setModal] = useState(null)
  const [showApi, setShowApi] = useState(false)
  const [view, setView] = useState('notes') // notes=笔记 | materials=素材（融合视图）

  const reload = useCallback((q, tag, category) => {
    const params = {}
    if (q) params.q = q
    if (tag) params.tag = tag
    if (category) params.category = category
    loadNotes(params)
    // 记住当前过滤：保存/删除后的自动刷新会保持这个视图（不弹回"全部"）
    useNoteStore.setState({ filter: params })
  }, [loadNotes])

  useEffect(() => { refresh() }, [refresh])

  const handleSearch = (e) => {
    setQuery(e.target.value)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => reload(e.target.value.trim(), activeTag, activeCategory), 300)
  }

  const handleTag = (tag) => {
    const next = activeTag === tag ? '' : tag
    setActiveTag(next)
    reload(query.trim(), next, activeCategory)
  }

  const handleCategory = (cat) => {
    const next = activeCategory === cat ? '' : cat
    setActiveCategory(next)
    reload(query.trim(), activeTag, next)
  }

  // ===== 分类管理 =====

  const submitNewCategory = async () => {
    const name = newCatName.trim()
    setCreating(false); setNewCatName('')
    if (!name) return
    try {
      await newCategory(name)
      toast(`已创建分类「${name}」`, 'success')
    } catch (e) {
      toast(e?.message || '创建失败', 'error')
    }
  }

  const submitRename = async () => {
    const old = renaming
    const name = renameValue.trim()
    setRenaming(null); setRenameValue('')
    if (!old || !name || name === old) return
    try {
      await doRenameCategory(old, name)
      if (activeCategory === old) { setActiveCategory(name); reload(query.trim(), activeTag, name) }
      toast(`「${old}」已重命名为「${name}」`, 'success')
    } catch (e) {
      toast(e?.message || '重命名失败', 'error')
    }
  }

  const handleDeleteCategory = async (name) => {
    const count = (stats.categories || {})[name] || 0
    const ok = await confirmDialog({
      title: '删除分类',
      message: count > 0
        ? `「${name}」下有 ${count} 篇笔记，删除分类后这些笔记将归入"未分类"（笔记本身保留）`
        : `删除空分类「${name}」？`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      await doDeleteCategory(name)
      if (activeCategory === name) { setActiveCategory(''); reload(query.trim(), activeTag, '') }
      toast('分类已删除', 'success')
    } catch (e) {
      toast(e?.message || '删除失败', 'error')
    }
  }

  const topTags = Object.entries(stats.tags || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)

  // 大分类（含未分类），按数量倒序；"全部" 始终在首位
  const categories = Object.entries(stats.categories || {})
    .filter(([name]) => name !== '')
    .sort((a, b) => b[1] - a[1])
  const uncategorized = (stats.categories || {})[''] || 0

  // 素材视图：直接渲染整个 Library 页（自取数据），包在融合容器里
  if (view === 'materials') {
    return (
      <div className="pkb-container">
        <div className="pkb-topbar">
          <div className="pkb-topbar-left">
            <h2 className="header-title"><BookOpen size={18} strokeWidth={2.2} /> 知识库</h2>
            <div className="pkb-view-tabs">
              <button className="pkb-view-tab" onClick={() => setView('notes')}>📝 笔记</button>
              <button className="pkb-view-tab active">🔗 素材</button>
            </div>
          </div>
        </div>
        <Library embedded />
      </div>
    )
  }

  return (
    <div className="pkb-container">
      <div className="pkb-topbar">
        <div className="pkb-topbar-left">
          <h2 className="header-title"><NotebookPen size={18} strokeWidth={2.2} /> 知识库</h2>
          <div className="pkb-view-tabs">
            <button className="pkb-view-tab active">📝 笔记</button>
            <button className="pkb-view-tab" onClick={() => setView('materials')}>🔗 素材</button>
          </div>
          <span className="pkb-count">{stats.total} 篇笔记</span>
        </div>
        <div className="pkb-topbar-right">
          <div className="pkb-search">
            <Search size={14} strokeWidth={2} />
            <input placeholder="搜索标题 / 内容 / 标签..." value={query} onChange={handleSearch} />
            {query && <X size={13} className="pkb-search-clear" onClick={() => { setQuery(''); reload('', activeTag, activeCategory) }} />}
          </div>
          <button className="pkb-api-btn" onClick={() => setShowApi(true)} title="外部 AI 读取这些笔记的接口">
            <Plug size={14} strokeWidth={2.2} /> 对外接口
          </button>
          <button className="pkb-new-btn" onClick={() => setModal({ mode: 'create' })}>
            <Plus size={15} strokeWidth={2.4} /> 新建笔记
          </button>
        </div>
      </div>

      {/* 大分类：分段式标签页导航（第一层），可与搜索/标签叠加过滤 */}
      <div className="pkb-category-bar">
        <button
          className={`pkb-category-chip ${activeCategory === '' ? 'active' : ''}`}
          onClick={() => handleCategory('')}
        >
          全部 <span className="pkb-cat-n">{stats.total}</span>
        </button>
        {categories.map(([name, count]) => {
          const c = catColor(name)
          return renaming === name ? (
            <input
              key={name}
              className="pkb-cat-rename"
              value={renameValue}
              autoFocus
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={submitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename()
                if (e.key === 'Escape') { setRenaming(null) }
              }}
            />
          ) : (
            <span key={name} className={`pkb-cat-wrap ${activeCategory === name ? 'active' : ''}`}
              style={activeCategory === name ? { background: c.bg } : undefined}>
              <button
                className={`pkb-category-chip ${activeCategory === name ? 'active' : ''}`}
                style={activeCategory === name ? { color: c.fg, borderColor: c.bar } : undefined}
                onClick={() => handleCategory(name)}
              >
                <span className="pkb-cat-dot" style={{ background: c.bar }} />
                {name} <span className="pkb-cat-n">{count}</span>
              </button>
              <span className="pkb-cat-ops">
                <button title="重命名" onClick={(e) => { e.stopPropagation(); setRenaming(name); setRenameValue(name) }}>
                  <Pencil size={10} strokeWidth={2.2} />
                </button>
                <button title="删除分类" onClick={(e) => { e.stopPropagation(); handleDeleteCategory(name) }}>
                  <Trash2 size={10} strokeWidth={2.2} />
                </button>
              </span>
            </span>
          )
        })}
        {uncategorized > 0 && (
          <button
            className={`pkb-category-chip dim ${activeCategory === '__none__' ? 'active' : ''}`}
            onClick={() => handleCategory('__none__')}
          >
            未分类 <span className="pkb-cat-n">{uncategorized}</span>
          </button>
        )}
        {creating ? (
          <input
            className="pkb-cat-rename"
            placeholder="分类名..."
            value={newCatName}
            autoFocus
            onChange={(e) => setNewCatName(e.target.value)}
            onBlur={submitNewCategory}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNewCategory()
              if (e.key === 'Escape') { setCreating(false); setNewCatName('') }
            }}
          />
        ) : (
          <button className="pkb-cat-add" title="新建分类" onClick={() => setCreating(true)}>
            <FolderPlus size={12} strokeWidth={2.2} /> 新建
          </button>
        )}
      </div>

      {/* 标签过滤（第二层：小彩色胶囊） */}
      {topTags.length > 0 && (
        <div className="pkb-tags-bar">
          {topTags.map(([tag, count]) => {
            const c = tagColor(tag)
            return (
              <button
                key={tag}
                className={`pkb-tag-chip ${activeTag === tag ? 'active' : ''}`}
                style={activeTag === tag ? { background: c.bg, color: c.fg, borderColor: c.fg } : {}}
                onClick={() => handleTag(tag)}
              >
                {tag} <span className="pkb-tag-n">{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* 笔记卡片流（ima 风格瀑布流） */}
      <div className="pkb-main">
        {loading ? (
          <div className="lib-skeleton" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skel-card">
                <div className="skel-line skel-w40" />
                <div className="skel-line skel-w90" />
                <div className="skel-line skel-w60" />
              </div>
            ))}
          </div>
        ) : notes.length === 0 ? (
          <div className="pkb-empty">
            <NotebookPen size={42} strokeWidth={1.4} />
            <p>{query || activeTag || activeCategory ? '没有匹配的笔记' : '还没有笔记'}</p>
            {!query && !activeTag && !activeCategory && (
              <p className="pkb-empty-hint">
                在「对话」里聊完踩坑/经验后，点顶部的「总结为笔记」即可沉淀到这里
              </p>
            )}
          </div>
        ) : (
          <div className="pkb-masonry">
            {notes.map(n => (
              <NoteCard
                key={n.id}
                note={n}
                onOpen={() => setModal({ mode: 'view', id: n.id })}
                onDelete={() => handleDelete(n)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 查看 / 编辑 / 新建 弹窗 */}
      {modal && (
        <NoteModal
          modal={modal}
          notes={notes}
          onClose={() => setModal(null)}
          onEdit={(id) => setModal({ mode: 'edit', id })}
        />
      )}

      {/* 对外接口说明弹窗 */}
      {showApi && <KbApiModal onClose={() => setShowApi(false)} />}
    </div>
  )
}

/** 卡片上直接删除（应用内确认弹窗） */
async function handleDeleteNote(note, removeNote) {
  const ok = await confirmDialog({
    title: '删除笔记',
    message: `确定删除「${note.title}」？删除后不可恢复`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  try {
    await removeNote(note.id)
    toast('笔记已删除', 'success')
  } catch (e) {
    toast(e?.message || '删除失败', 'error')
  }
}

/* === 笔记卡片 === */
function NoteCard({ note, onOpen, onDelete }) {
  return (
    <div className="pkb-card" onClick={onOpen}>
      <button
        className="pkb-card-delete"
        title="删除笔记"
        onClick={(e) => { e.stopPropagation(); onDelete() }}
      >
        <Trash2 size={14} strokeWidth={2} />
      </button>
      {/* 首图封面（图片为主的笔记直接看图，而不是"图片"两个字） */}
      {note.cover_image && (
        <img className="pkb-card-cover" src={note.cover_image} alt="" loading="lazy" />
      )}
      <div className="pkb-card-title">{note.title}</div>
      {note.category && (() => {
        const c = catColor(note.category)
        return <span className="pkb-card-category" style={{ background: c.bg, color: c.fg }}><FolderOpen size={10} strokeWidth={2.2} /> {note.category}</span>
      })()}
      <div className="pkb-card-excerpt">{note.excerpt || '（空笔记）'}</div>
      {note.tags?.length > 0 && (
        <div className="pkb-card-tags">
          {note.tags.slice(0, 4).map(t => {
            const c = tagColor(t)
            return <span key={t} className="pkb-mini-tag" style={{ background: c.bg, color: c.fg }}>{t}</span>
          })}
          {note.tags.length > 4 && <span className="pkb-mini-tag more">+{note.tags.length - 4}</span>}
        </div>
      )}
      <div className="pkb-card-footer">
        {note.source_conversation_id ? (
          <span className="pkb-from-chat"><MessageSquareQuote size={11} strokeWidth={2} /> 来自对话</span>
        ) : <span />}
        <span className="pkb-card-date"><Clock size={11} strokeWidth={2} /> {fmtDate(note.updated_at)}</span>
      </div>
    </div>
  )
}

/* === 查看/编辑/新建 弹窗 === */
const NL = '\n'  // 换行常量
function NoteModal({ modal, notes, onClose, onEdit }) {
  const { saveNote, removeNote, stats } = useNoteStore()
  // 列表行（即时渲染头部），详情打开后异步补全正文
  const [note, setNote] = useState(modal.id ? notes.find(n => n.id === modal.id) : null)
  const [loadingNote, setLoadingNote] = useState(!!modal.id)
  const editing = modal.mode === 'edit' || modal.mode === 'create'

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [fullscreen, setFullscreen] = useState(false)
  const textareaRef = useRef(null)

  // 编辑大纲：正文标题（##/###/####）→ 左侧栏点击跳转
  const outline = useMemo(() => {
    if (!editing) return []
    return content.split('\n').flatMap((line, idx) => {
      const m = line.match(/^(#{2,4})\s+(.+)/)
      if (!m) return []
      const text = m[2].trim().slice(0, 24)
      return text ? [{ level: m[1].length, text, line: idx }] : []
    })
  }, [content, editing])

  // ===== Markdown 编辑辅助：包裹选区 / 行前缀切换 / 工具栏与快捷键共用 =====

  const wrapSelection = (before, after = before, placeholder = '文本') => {
    const ta = textareaRef.current
    if (!ta) return
    const s0 = ta.selectionStart
    const e0 = ta.selectionEnd
    const selected = content.slice(s0, e0)
    const inner = selected || placeholder
    const next = content.slice(0, s0) + before + inner + after + content.slice(e0)
    setContent(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(s0 + before.length, s0 + before.length + inner.length)
    })
  }

  const toggleLinePrefix = (prefix) => {
    const ta = textareaRef.current
    if (!ta) return
    const pos = ta.selectionStart
    const lineStart = content.lastIndexOf(NL, pos - 1) + 1
    const nl = content.indexOf(NL, pos)
    const lineEnd = nl === -1 ? content.length : nl
    const line = content.slice(lineStart, lineEnd)
    const stripped = line.replace(/^#{1,6}\s+/, '').replace(/^[-*>]\s+/, '')
    const has = line.startsWith(prefix)
    const newLine = has ? stripped : prefix + stripped
    const next = content.slice(0, lineStart) + newLine + content.slice(lineEnd)
    setContent(next)
    requestAnimationFrame(() => {
      ta.focus()
      const delta = newLine.length - line.length
      ta.setSelectionRange(pos + delta, pos + delta)
    })
  }

  const insertAtCursor = (text) => {
    const ta = textareaRef.current
    if (!ta) return
    const pos = ta.selectionStart
    const next = content.slice(0, pos) + text + content.slice(pos)
    setContent(next)
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(pos + text.length, pos + text.length) })
  }

  const handleEditorKeyDown = (e) => {
    const ta = textareaRef.current
    if (!ta) return
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase()
      if (k === 'b') { e.preventDefault(); wrapSelection('**'); return }
      if (k === 'i') { e.preventDefault(); wrapSelection('*'); return }
      if (k === 'k') { e.preventDefault(); wrapSelection('[', '](https://)', '链接文字'); return }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
      const pos = ta.selectionStart
      const lineStart = content.lastIndexOf(NL, pos - 1) + 1
      const curLine = content.slice(lineStart, pos)
      const m = curLine.match(/^(\s*)([-*]|\d+\.|>)\s+/)
      if (m) {
        e.preventDefault()
        const rest = curLine.slice(m[0].length)
        let next, caret
        if (!rest.trim()) {
          // 空列表项回车 = 退出列表
          next = content.slice(0, lineStart) + content.slice(pos)
          caret = lineStart
        } else {
          const bullet = /^\d+\.$/.test(m[2]) ? String(parseInt(m[2], 10) + 1) + '.' : m[2]
          const insert = NL + m[1] + bullet + ' '
          next = content.slice(0, pos) + insert + content.slice(pos)
          caret = pos + insert.length
        }
        // 直接 setState 在合成 keydown 后有 DOM 值打回的时序问题——
        // 用原生 setter + input 事件驱动受控更新（本页已验证可靠）
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
        setter.call(ta, next)
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(caret, caret) })
      }
    }
  }

  const jumpToOutline = (h) => {
    const ta = textareaRef.current
    if (!ta) return
    // 行高 = font-size(13.5px) × line-height(1.8)；滚动并放置光标到该行
    const lineHeight = 13.5 * 1.8
    const before = content.split('\n').slice(0, h.line).join('\n').length
    ta.focus()
    ta.setSelectionRange(before + (before ? 1 : 0), before + (before ? 1 : 0))
    ta.scrollTop = Math.max(0, h.line * lineHeight - 48)
  }

  // 分类候选：已有分类在前 + 固定示例（去重）
  const categoryOptions = [...new Set([
    ...Object.keys(stats.categories || {}).filter(Boolean),
    ...CATEGORY_SUGGESTIONS,
  ])]

  // 打开已有笔记 → 拉取完整正文（列表接口只含摘要）
  useEffect(() => {
    if (!modal.id) return
    let cancelled = false
    setLoadingNote(true)
    getNote(modal.id)
      .then(full => { if (!cancelled && full) setNote(full) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingNote(false) })
    return () => { cancelled = true }
  }, [modal.id])

  useEffect(() => {
    if (modal.mode === 'create') {
      setTitle(''); setCategory(''); setTagsInput(''); setContent('')
    } else if (note?.content != null) {
      setTitle(note.title)
      setCategory(note.category || '')
      setTagsInput((note.tags || []).join(', '))
      setContent(note.content)
    }
  }, [modal.mode, note])

  // 粘贴图片：上传落盘 → 在光标处插入 markdown 引用（正文只存 URL 不存 base64）
  const handleEditorPaste = async (e) => {
    const items = e.clipboardData?.items || []
    for (const item of items) {
      if (!item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (!file) continue
      e.preventDefault()
      toast('图片上传中...', 'info', 1500)
      try {
        const { url } = await uploadNoteImage(file)
        const ta = textareaRef.current
        const markdown = `\n![图片](${url})\n`
        const pos = ta?.selectionStart ?? content.length
        const next = content.slice(0, pos) + markdown + content.slice(pos)
        setContent(next)
        requestAnimationFrame(() => {
          if (ta) { ta.selectionStart = ta.selectionEnd = pos + markdown.length }
        })
        toast('图片已插入', 'success')
      } catch (err) {
        toast(err?.message || '图片上传失败', 'error')
      }
      return // 一次只处理一张
    }
  }

  const handleSave = async () => {
    if (!title.trim()) { toast('请填写标题', 'error'); return }
    setSaving(true)
    try {
      const tags = tagsInput.split(/[,，\s]+/).filter(Boolean)
      await saveNote(
        { title: title.trim(), content, tags, category: category.trim() },
        modal.mode === 'edit' ? modal.id : null
      )
      toast(modal.mode === 'edit' ? '笔记已更新' : '笔记已创建', 'success')
      onClose()
    } catch (e) {
      toast(e?.message || '保存失败', 'error')
    }
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!note) return
    const ok = await confirmDialog({
      title: '删除笔记',
      message: `确定删除「${note.title}」？删除后不可恢复`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      await removeNote(note.id)
      toast('笔记已删除', 'success')
      onClose()
    } catch (e) {
      toast(e?.message || '删除失败', 'error')
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(content)
      .then(() => { setCopied(true); toast('已复制到剪贴板', 'success'); setTimeout(() => setCopied(false), 1500) })
      .catch(() => toast('复制失败', 'error'))
  }

  return (
    <div className="pkb-modal-overlay" onClick={onClose}>
      <div className={`pkb-modal ${fullscreen ? 'fullscreen' : ''}`} onClick={e => e.stopPropagation()}>
        <div className="pkb-modal-header">
          <span className="pkb-modal-title">
            {editing
              ? (modal.mode === 'create' ? '新建笔记' : '编辑笔记')
              : (note?.source_conversation_id ? '对话沉淀笔记' : '笔记')}
          </span>
          <div className="pkb-modal-actions">
            {!editing && note && (
              <>
                <button className="pkb-icon-btn" onClick={handleCopy} title="复制全文">
                  {copied ? <Check size={15} strokeWidth={2.4} /> : <Copy size={15} strokeWidth={2} />}
                </button>
                <button className="pkb-icon-btn" onClick={() => onEdit(note.id)} title="编辑">
                  <Pencil size={15} strokeWidth={2} />
                </button>
                <button className="pkb-icon-btn danger" onClick={handleDelete} title="删除">
                  <Trash2 size={15} strokeWidth={2} />
                </button>
              </>
            )}
            <button className="pkb-icon-btn" onClick={() => setFullscreen(f => !f)}
              title={fullscreen ? '退出全屏' : '全屏（沉浸编辑/阅读）'}>
              {fullscreen ? <Minimize2 size={15} strokeWidth={2} /> : <Maximize2 size={15} strokeWidth={2} />}
            </button>
            <button className="pkb-icon-btn" onClick={onClose}><X size={17} strokeWidth={2} /></button>
          </div>
        </div>

        {editing ? (
          <div className="pkb-modal-body pkb-editor">
            {/* ima 式大纲侧栏：点标题跳到编辑区对应位置 */}
            {outline.length > 0 && (
              <aside className="pkb-outline">
                <div className="pkb-outline-head">大纲</div>
                {outline.map((h, i) => (
                  <button key={i} className={`pkb-outline-item lv${h.level}`}
                    onClick={() => jumpToOutline(h)}
                    title={h.text}>
                    {h.text}
                  </button>
                ))}
              </aside>
            )}
            <div className="pkb-editor-main">
            <input className="pkb-edit-title" placeholder="笔记标题..." value={title}
              onChange={e => setTitle(e.target.value)} />
            <div className="pkb-edit-row">
              <div className="pkb-edit-field">
                <label>分类</label>
                <input list="pkb-category-options" placeholder="选择或输入分类，如：技术原理"
                  value={category} onChange={e => setCategory(e.target.value)} />
                <datalist id="pkb-category-options">
                  {categoryOptions.map(c => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="pkb-edit-field">
                <label>标签</label>
                <input placeholder="逗号分隔，如：踩坑, Docker"
                  value={tagsInput} onChange={e => setTagsInput(e.target.value)} />
              </div>
            </div>
            <div className="pkb-md-toolbar">
              <button title="二级标题" onClick={() => toggleLinePrefix('## ')}>H2</button>
              <button title="三级标题" onClick={() => toggleLinePrefix('### ')}>H3</button>
              <span className="pkb-md-sep" />
              <button title="粗体 (Ctrl+B)" onClick={() => wrapSelection('**')}><b>B</b></button>
              <button title="斜体 (Ctrl+I)" onClick={() => wrapSelection('*')}><i>I</i></button>
              <button title="删除线" onClick={() => wrapSelection('~~')}><s>S</s></button>
              <span className="pkb-md-sep" />
              <button title="行内代码" onClick={() => wrapSelection('`')}><code>{'<>'}</code></button>
              <button title="代码块" onClick={() => insertAtCursor(NL + '```' + NL + '代码' + NL + '```' + NL)}>块</button>
              <span className="pkb-md-sep" />
              <button title="无序列表" onClick={() => toggleLinePrefix('- ')}>• 列表</button>
              <button title="引用" onClick={() => toggleLinePrefix('> ')}>❝ 引用</button>
              <button title="链接 (Ctrl+K)" onClick={() => wrapSelection('[', '](https://)', '链接文字')}>🔗</button>
              <span className="pkb-md-hint">Ctrl+B 加粗 · 回车自动续列表</span>
            </div>
            <textarea ref={textareaRef} className="pkb-edit-content" placeholder="支持 Markdown...（可直接粘贴图片）"
              value={content} onChange={e => setContent(e.target.value)} onPaste={handleEditorPaste}
              onKeyDown={handleEditorKeyDown} spellCheck={false} />
            {/* 编辑态实时图片条：正文中引用的图片即时可见（缩略，点击放大） */}
            {(() => {
              const urls = [...content.matchAll(/!\[[^\]]*\]\((\/api\/notes\/images\/[^)\s]+|https?:\/\/[^)\s]+)\)/g)].map(m => m[1])
              if (!urls.length) return null
              return (
                <div className="pkb-edit-images">
                  {urls.map((u, i) => (
                    <img key={i} src={u} alt="" onClick={() => setLightbox(u)} title="点击放大" />
                  ))}
                </div>
              )
            })()}
            <div className="pkb-editor-footer">
              <span className="pkb-editor-hint">{content.length} 字 · Markdown</span>
              <div className="pkb-editor-btns">
                <button className="pkb-btn-secondary" onClick={onClose}>取消</button>
                <button className="pkb-btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 size={14} strokeWidth={2.5} className="wx-spin" /> : <Check size={14} strokeWidth={2.5} />}
                  保存
                </button>
              </div>
            </div>
            </div>
          </div>
        ) : (
          <div className="pkb-modal-body">
            <h3 className="pkb-view-title">{note?.title}</h3>
            {(note?.category || note?.tags?.length > 0) && (
              <div className="pkb-view-tags">
                {note?.category && (() => {
                  const c = catColor(note.category)
                  return <span className="pkb-view-category" style={{ background: c.bg, color: c.fg }}><FolderOpen size={11} strokeWidth={2.2} /> {note.category}</span>
                })()}
                {note?.tags?.map(t => {
                  const c = tagColor(t)
                  return <span key={t} className="pkb-mini-tag" style={{ background: c.bg, color: c.fg }}># {t}</span>
                })}
              </div>
            )}
            {loadingNote || note?.content == null ? (
              <div className="pkb-view-loading"><Loader2 size={18} strokeWidth={2.5} className="wx-spin" /> 加载正文...</div>
            ) : (
              <div
                className="pkb-view-content"
                onClick={(e) => { if (e.target.tagName === 'IMG') setLightbox(e.target.src) }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }}
              />
            )}
          </div>
        )}
      </div>

      {/* 图片大图查看 + 提取图中文字 */}
      {lightbox && (
        <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}

/* === 图片大图（自适应查看 + 图中文本提取） === */
function ImageLightbox({ src, onClose }) {
  const [ocrText, setOcrText] = useState(null)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const extractText = async () => {
    setOcrLoading(true)
    try {
      // 取图片转 base64 调视觉模型（相对路径走同源/代理，外部图直接 fetch）
      const blob = await (await fetch(src)).blob()
      const b64 = await new Promise((resolve) => {
        const fr = new FileReader()
        fr.onload = () => resolve(fr.result)
        fr.readAsDataURL(blob)
      })
      const r = await analyzeVision({ image: b64, mode: 'ocr' })
      setOcrText(r.reply || '（未识别到文字）')
    } catch (e) {
      setOcrText(`提取失败：${e?.message || e}`)
    }
    setOcrLoading(false)
  }

  const copyOcr = () => {
    navigator.clipboard.writeText(ocrText || '')
      .then(() => { setCopied(true); toast('已复制', 'success'); setTimeout(() => setCopied(false), 1500) })
      .catch(() => toast('复制失败', 'error'))
  }

  return (
    <div className="img-lightbox" onClick={onClose}>
      <div className="img-lightbox-body" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt="笔记图片" onClick={(e) => e.stopPropagation()} />
        <div className="img-lightbox-actions">
          <button className="ilb-btn" onClick={extractText} disabled={ocrLoading}>
            {ocrLoading ? <Loader2 size={13} className="wx-spin" /> : <ScanText size={13} />}
            提取图中文字
          </button>
          <button className="ilb-btn ghost" onClick={onClose}><X size={13} /> 关闭</button>
        </div>
        {ocrLoading && <div className="ilb-ocr loading">识别中...</div>}
        {ocrText && !ocrLoading && (
          <div className="ilb-ocr">
            <pre>{ocrText}</pre>
            <button className="ilb-btn sm" onClick={copyOcr}>
              {copied ? <Check size={12} /> : <Copy size={12} />} 复制文字
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
