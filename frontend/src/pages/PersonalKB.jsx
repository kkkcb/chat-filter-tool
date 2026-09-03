import { useState, useEffect, useRef, useCallback } from 'react'
import {
  NotebookPen, Search, Plus, X, Trash2, Pencil, Copy, MessageSquareQuote,
  Loader2, Check, Clock, FolderOpen,
} from 'lucide-react'
import { useNoteStore } from '../stores/noteStore'
import { getNote } from '../api/notes'
import { renderMarkdown } from '../utils/markdown'
import { toast } from '../components/Toast'
import { confirmDialog } from '../components/Confirm'
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

/** 编辑弹窗里分类输入框的候选建议（已有分类之外的首选示例） */
const CATEGORY_SUGGESTIONS = ['技术原理', '个人规划', '踩坑记录', '灵感想法']

function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  } catch { return '' }
}

export default function PersonalKB() {
  const { notes, stats, loading, loadNotes, refresh, removeNote } = useNoteStore()
  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState('')
  const [activeCategory, setActiveCategory] = useState('')
  const searchTimer = useRef(null)

  const handleDelete = (note) => handleDeleteNote(note, removeNote)

  // 弹窗状态：null | {mode:'view', id} | {mode:'edit', id} | {mode:'create'}
  const [modal, setModal] = useState(null)

  const reload = useCallback((q, tag, category) => {
    const params = {}
    if (q) params.q = q
    if (tag) params.tag = tag
    if (category) params.category = category
    loadNotes(params)
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

  const topTags = Object.entries(stats.tags || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)

  // 大分类（含未分类），按数量倒序；"全部" 始终在首位
  const categories = Object.entries(stats.categories || {})
    .filter(([name]) => name !== '')
    .sort((a, b) => b[1] - a[1])
  const uncategorized = (stats.categories || {})[''] || 0

  return (
    <div className="pkb-container">
      <div className="pkb-topbar">
        <div className="pkb-topbar-left">
          <h2 className="header-title"><NotebookPen size={18} strokeWidth={2.2} /> 个人知识库</h2>
          <span className="pkb-count">{stats.total} 篇笔记</span>
        </div>
        <div className="pkb-topbar-right">
          <div className="pkb-search">
            <Search size={14} strokeWidth={2} />
            <input placeholder="搜索标题 / 内容 / 标签..." value={query} onChange={handleSearch} />
            {query && <X size={13} className="pkb-search-clear" onClick={() => { setQuery(''); reload('', activeTag) }} />}
          </div>
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
        {categories.map(([name, count]) => (
          <button
            key={name}
            className={`pkb-category-chip ${activeCategory === name ? 'active' : ''}`}
            onClick={() => handleCategory(name)}
          >
            {name} <span className="pkb-cat-n">{count}</span>
          </button>
        ))}
        {uncategorized > 0 && (
          <button
            className={`pkb-category-chip dim ${activeCategory === '__none__' ? 'active' : ''}`}
            onClick={() => handleCategory('__none__')}
          >
            未分类 <span className="pkb-cat-n">{uncategorized}</span>
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
      <div className="pkb-card-title">{note.title}</div>
      {note.category && <span className="pkb-card-category"><FolderOpen size={10} strokeWidth={2.2} /> {note.category}</span>}
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
  const textareaRef = useRef(null)

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
      <div className="pkb-modal" onClick={e => e.stopPropagation()}>
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
            <button className="pkb-icon-btn" onClick={onClose}><X size={17} strokeWidth={2} /></button>
          </div>
        </div>

        {editing ? (
          <div className="pkb-modal-body pkb-editor">
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
            <textarea ref={textareaRef} className="pkb-edit-content" placeholder="支持 Markdown..."
              value={content} onChange={e => setContent(e.target.value)} spellCheck={false} />
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
        ) : (
          <div className="pkb-modal-body">
            <h3 className="pkb-view-title">{note?.title}</h3>
            {(note?.category || note?.tags?.length > 0) && (
              <div className="pkb-view-tags">
                {note?.category && (
                  <span className="pkb-view-category"><FolderOpen size={11} strokeWidth={2.2} /> {note.category}</span>
                )}
                {note?.tags?.map(t => {
                  const c = tagColor(t)
                  return <span key={t} className="pkb-mini-tag" style={{ background: c.bg, color: c.fg }}># {t}</span>
                })}
              </div>
            )}
            {loadingNote || note?.content == null ? (
              <div className="pkb-view-loading"><Loader2 size={18} strokeWidth={2.5} className="wx-spin" /> 加载正文...</div>
            ) : (
              <div className="pkb-view-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
