import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  NotebookPen, Search, Plus, X, Trash2, Pencil, Copy, MessageSquareQuote,
  Loader2, Check, Clock, FolderOpen, Plug, FolderPlus, ScanText, Maximize2, Minimize2, BookOpen, MessageCircleQuestion, Wand2,
} from 'lucide-react'
import { useNoteStore } from '../stores/noteStore'
import { getNote, uploadNoteImage, polishNote, getNoteSource } from '../api/notes'
import { diffTexts } from '../utils/diff'
import { analyzeVision } from '../api/vision'
import { renderMarkdown, extractOutline } from '../utils/markdown'
import { toast } from '../components/Toast'
import { confirmDialog } from '../components/Confirm'
import KbApiModal from '../components/KbApiModal'
import Library from './Library'
import TiptapEditor from '../components/TiptapEditor'
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

  // 接收对话页的「跳到笔记」事件
  useEffect(() => {
    const handler = (e) => {
      const { id } = e.detail
      if (id) setModal({ mode: 'view', id })
    }
    window.addEventListener('ice:goto-note', handler)
    return () => window.removeEventListener('ice:goto-note', handler)
  }, [])

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
  const [polishing, setPolishing] = useState(false)
  const editorRef = useRef(null)  // Tiptap 实例（工具栏命令/大纲跳转用）
  const [diffView, setDiffView] = useState(null) // {polished} 润色对比

  // 分类候选：已有分类在前 + 固定示例（去重）
  const categoryOptions = [...new Set([
    ...Object.keys(stats.categories || {}).filter(Boolean),
    ...CATEGORY_SUGGESTIONS,
  ])]

  // 阅读态大纲：与渲染同源（markdown 标题 + XML 分节标签→二级标题）
  const viewOutline = useMemo(() => {
    if (editing || !note?.content) return []
    return extractOutline(note.content)
  }, [note, editing])

  // 编辑大纲：同源提取，raw 行文本用于编辑器内定位（XML 标签在 Tiptap 里是普通段落）
  const outline = useMemo(() => {
    if (!editing) return []
    return extractOutline(content)
  }, [content, editing])

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

  // 表单状态灌数：全文到达/切换模式时填充（编辑/查看互切也靠它）
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

  // ===== Tiptap 命令桥：工具栏按钮驱动所见即所得编辑器 =====

  const tp = () => editorRef.current?.chain().focus()

  const jumpToOutline = (h) => {
    // 编辑器内定位：标题节点按文本匹配；XML 分节标签在 Tiptap 里是普通段落
    // 且可能与相邻行合并，须按「包含 <标签>」匹配
    const dom = editorRef.current?.view?.dom
    if (!dom) return
    const blocks = [...dom.querySelectorAll('h1,h2,h3,h4,p')]
    const el = h.isTag
      ? blocks.find((x) => (x.textContent || '').includes(h.raw))
      : blocks.find((x) => {
          const t = (x.textContent || '').trim()
          return t === h.raw || t.startsWith(h.text)
        })
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      editorRef.current?.commands.focus()
    }
  }

  // AI 一键润色 → 对比视图（采用与否由用户决定，原文不动）
  const handlePolish = async () => {
    if (!content.trim() || polishing) return
    setPolishing(true)
    try {
      const r = await polishNote(content)
      if (r.content && r.content !== content) {
        setDiffView({ polished: r.content })
      } else {
        toast('润色结果与原文相同，无需修改', 'info')
      }
    } catch (e) {
      toast(e?.message || '润色失败', 'error')
    }
    setPolishing(false)
  }

  // 采用润色：写回编辑器（对比视图关闭）
  const applyPolish = () => {
    if (!diffView) return
    setContent(diffView.polished) // TiptapEditor 的 value 同步会刷新编辑器
    setDiffView(null)
    toast('已采用润色结果（保存前仍可继续编辑）', 'success')
  }

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

  // ===== 自动保存（编辑态：内容变化后 debounce 静默保存；新建先创建再持续更新）=====

  const [localId, setLocalId] = useState(modal.id || null)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const autoSaveTimer = useRef(null)
  const latestForm = useRef({ title: '', content: '', tags: '', category: '' })
  latestForm.current = { title, content, tags: tagsInput, category }

  const doAutoSave = async (silent = true) => {
    const { title: t, content: c, tags: ti, category: ca } = latestForm.current
    if (!t.trim()) return // 标题空时跳过（还没想好名字）
    try {
      const tags = ti.split(/[,，\s]+/).filter(Boolean)
      const saved = await saveNote(
        { title: t.trim(), content: c, tags, category: ca.trim() },
        localId
      )
      if (!localId) setLocalId(saved.id) // 新建 → 转编辑模式
      setLastSavedAt(new Date())
      if (!silent) toast('笔记已保存', 'success')
    } catch (e) {
      if (!silent) toast(e?.message || '保存失败', 'error')
      else console.warn('[autosave]', e?.message)
    }
  }

  // 表单变化 → 800ms debounce 自动保存（仅编辑态）
  useEffect(() => {
    if (!editing) return
    if (modal.mode === 'edit' && note?.content == null) return // 正文还没加载完
    clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => { doAutoSave(true) }, 800)
    return () => clearTimeout(autoSaveTimer.current)
  }, [title, content, tagsInput, category, editing])

  // 关闭弹窗时 flush 未保存的变更
  const handleClose = () => {
    clearTimeout(autoSaveTimer.current)
    if (editing) doAutoSave(true) // fire-and-forget
    onClose()
  }

  const handleSave = async () => {
    if (!title.trim()) { toast('请填写标题', 'error'); return }
    setSaving(true)
    await doAutoSave(false)
    setSaving(false)
    onClose()
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
              ? (localId ? '编辑笔记' : '新建笔记')
              : (note?.source_conversation_id ? '对话沉淀笔记' : '笔记')}
          </span>
          {editing && lastSavedAt && (
            <span className="pkb-autosave-badge">
              <Check size={11} strokeWidth={2.4} /> 已自动保存 {lastSavedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <div className="pkb-modal-actions">
            {!editing && note && (
              <>
                <button className="pkb-icon-btn" onClick={handleCopy} title="复制全文">
                  {copied ? <Check size={15} strokeWidth={2.4} /> : <Copy size={15} strokeWidth={2} />}
                </button>
                {note?.source_conversation_id && (
                  <button className="pkb-icon-btn" onClick={async () => {
                    try {
                      const r = await getNoteSource(note.id)
                      if (r.conversation_id) {
                        // 跳到对话页（通过全局事件通知切换视图）
                        window.dispatchEvent(new CustomEvent('ice:goto-conversation', { detail: { id: r.conversation_id } }))
                      }
                    } catch { toast('获取来源对话失败', 'error') }
                  }} title="跳到来源对话">
                    <MessageCircleQuestion size={15} strokeWidth={2} />
                  </button>
                )}
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
            <button className="pkb-icon-btn" onClick={handleClose}><X size={17} strokeWidth={2} /></button>
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
              <button title="二级标题" onClick={() => tp()?.toggleHeading({ level: 2 }).run()}>H2</button>
              <button title="三级标题" onClick={() => tp()?.toggleHeading({ level: 3 }).run()}>H3</button>
              <span className="pkb-md-sep" />
              <button title="粗体 (Ctrl+B)" onClick={() => tp()?.toggleBold().run()}><b>B</b></button>
              <button title="斜体 (Ctrl+I)" onClick={() => tp()?.toggleItalic().run()}><i>I</i></button>
              <button title="删除线" onClick={() => tp()?.toggleStrike().run()}><s>S</s></button>
              <span className="pkb-md-sep" />
              <button title="行内代码" onClick={() => tp()?.toggleCode().run()}><code>{'<>'}</code></button>
              <button title="代码块" onClick={() => tp()?.toggleCodeBlock().run()}>块</button>
              <span className="pkb-md-sep" />
              <button title="无序列表" onClick={() => tp()?.toggleBulletList().run()}>• 列表</button>
              <button title="有序列表" onClick={() => tp()?.toggleOrderedList().run()}>1. 序号</button>
              <button title="引用" onClick={() => tp()?.toggleBlockquote().run()}>❝ 引用</button>
              <button title="链接" onClick={() => {
                const url = window.prompt('链接地址（留空取消）')
                if (url) tp()?.setLink({ href: url }).run()
              }}>🔗</button>
              <button className="pkb-md-polish" title="AI 一键润色整理" onClick={handlePolish} disabled={polishing}>
                {polishing ? <Loader2 size={12} className="wx-spin" /> : <Wand2 size={12} />} {polishing ? '润色中' : '✨ 润色'}
              </button>
              <span className="pkb-md-hint">输入 # / 1. / - 加空格即变样式</span>
            </div>
            <TiptapEditor
              value={content}
              onChange={setContent}
              onReady={(ed) => { editorRef.current = ed }}
              placeholder="开始写作：输入 # / ## / 1. / - / > 加空格自动变样式，可直接粘贴图片"
            />
            <div className="pkb-editor-footer">
              <span className="pkb-editor-hint">{content.length} 字 · Markdown</span>
              <div className="pkb-editor-btns">
                <button className="pkb-btn-secondary" onClick={handleClose}>关闭</button>
                <button className="pkb-btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 size={14} strokeWidth={2.5} className="wx-spin" /> : <Check size={14} strokeWidth={2.5} />}
                  保存
                </button>
              </div>
            </div>
            </div>
          </div>
        ) : (
          <div className="pkb-modal-body pkb-view-body">
            {/* 阅读态：左侧大纲 + 右侧正文（和编辑态结构对齐） */}
            {viewOutline.length > 0 && (
              <aside className="pkb-outline">
                <div className="pkb-outline-head">大纲</div>
                {viewOutline.map((h, i) => (
                  <button key={i} className={`pkb-outline-item lv${h.level}`} title={h.text}
                    onClick={() => {
                      const content = document.querySelector('.pkb-view-content')
                      if (!content) return
                      const heads = [...content.querySelectorAll('h1,h2,h3,h4')]
                      const el = heads.find((x) => (x.textContent || '').trim().startsWith(h.text))
                      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }}>
                    {h.text}
                  </button>
                ))}
              </aside>
            )}
            <div className="pkb-view-main">
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
          </div>
        )}
      </div>

      {/* 图片大图查看 + 提取图中文字 */}
      {lightbox && (
        <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />
      )}

      {/* AI 润色对比视图 */}
      {diffView && (
        <div className="polish-overlay">
          <div className="polish-modal" onClick={(e) => e.stopPropagation()}>
            <div className="polish-header">
              <span><Wand2 size={15} strokeWidth={2} /> 润色对比</span>
              <div className="polish-header-btns">
                <button className="polish-btn ghost" onClick={() => setDiffView(null)}>放弃</button>
                <button className="polish-btn primary" onClick={applyPolish}><Check size={13} /> 采用润色</button>
              </div>
            </div>
            <div className="polish-legend">
              <span className="lg-del">删除的内容</span>
              <span className="lg-add">润色新增</span>
              <span className="lg-count">{(() => {
                const d = diffTexts(content, diffView.polished)
                const changes = d.filter(x => x.type !== 'same').length
                return `${changes} 处修改 / 共 ${d.length} 行`
              })()}</span>
            </div>
            <div className="polish-body">
              {diffTexts(content, diffView.polished).map((d, i) => {
                if (d.type === 'same') return <div key={i} className="pl same"><span className="pl-tag" /><span className="pl-old">{d.old || ' '}</span><span className="pl-new">{d.new || ' '}</span></div>
                if (d.type === 'mod') return <div key={i} className="pl mod"><span className="pl-tag">改</span><span className="pl-old" dangerouslySetInnerHTML={{ __html: d.oldHtml || '' }} /><span className="pl-new" dangerouslySetInnerHTML={{ __html: d.newHtml || '' }} /></div>
                if (d.type === 'del') return <div key={i} className="pl del"><span className="pl-tag">删</span><span className="pl-old">{d.old}</span><span className="pl-new" /></div>
                return <div key={i} className="pl add"><span className="pl-tag">增</span><span className="pl-old" /><span className="pl-new">{d.new}</span></div>
              })}
            </div>
          </div>
        </div>
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
