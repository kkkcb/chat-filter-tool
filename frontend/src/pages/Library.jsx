import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Library as LibraryIcon, Search, ChevronRight,
  Calendar, ExternalLink, Inbox, Trash2, Copy, Link2, Pencil, Loader2, Check,
} from 'lucide-react'
import { useMaterialStore } from '../stores/materialStore'
import { renderMarkdown } from '../utils/markdown'
import { getMaterials, deleteMaterial, updateMaterial } from '../api/materials'
import { toast } from '../components/Toast'
import { confirmDialog } from '../components/Confirm'
import './Library.css'
import './KnowledgeBase.css'

const SOURCE_ICONS = {
  github: { label: 'GitHub', color: '#333' },
  wechat: { label: '公众号', color: '#07c160' },
  web: { label: '网页', color: 'var(--accent)' },
}

export default function Library({ embedded = false }) {
  const { fetchStats, stats } = useMaterialStore()
  const [materials, setMaterials] = useState([])
  const [loadingMats, setLoadingMats] = useState(true)
  const [filter, setFilter] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [collapsedGroups, setCollapsedGroups] = useState({})
  const [contextMenu, setContextMenu] = useState(null) // { x, y, material }
  const contextMenuRef = useRef(null)

  const loadMaterials = useCallback(async () => {
    try {
      const data = await getMaterials({ size: 500 })
      setMaterials(data)
    } catch { setMaterials([]) }
    setLoadingMats(false)
  }, [])

  useEffect(() => { loadMaterials() }, [loadMaterials])

  // 点击外部关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [contextMenu])

  const handleDelete = useCallback(async (material) => {
    const ok = await confirmDialog({
      title: '删除素材',
      message: `确定删除「${material.title}」？关联的 Markdown 文件也会一并删除`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteMaterial(material.id)
      setExpandedId(null)
      await loadMaterials()
      fetchStats()
      toast(`已删除「${material.title.slice(0, 20)}」`, 'success')
    } catch {
      toast('删除失败，请重试', 'error')
    }
  }, [loadMaterials, fetchStats])

  const handleToggle = useCallback((id) => {
    setExpandedId(prev => prev === id ? null : id)
  }, [])

  const handleContextMenu = useCallback((e, material) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, material })
  }, [])

  const handleCopyLink = useCallback((url) => {
    if (!url) return
    navigator.clipboard.writeText(url)
      .then(() => toast('链接已复制', 'success'))
      .catch(() => toast('复制失败', 'error'))
    setContextMenu(null)
  }, [])

  const filtered = filter
    ? materials.filter(m => m.title?.toLowerCase().includes(filter.toLowerCase()) || m.category?.includes(filter))
    : materials

  const groups = {}
  filtered.forEach(m => {
    const cat = m.category || '未分类'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(m)
  })

  return (
    <div className="lib-container">
      <div className="lib-topbar">
        <div className="lib-topbar-left">
          {!embedded && <h2 className="header-title"><LibraryIcon size={18} strokeWidth={2.2} /> 素材库</h2>}
          <span className="lib-count">{materials.length} 条素材</span>
          {stats.total > materials.length && materials.length > 0 && (
            <span className="lib-count" title="超过 500 条时仅加载最近 500 条">已加载 {materials.length}/{stats.total}</span>
          )}
        </div>
        <div className="lib-search">
          <Search size={14} strokeWidth={2} />
          <input placeholder="搜索素材..." value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>

      <div className="lib-main">
        <div className="lib-materials">
          {loadingMats ? (
            <div className="lib-skeleton" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skel-card">
                  <div className="skel-line skel-w60" />
                  <div className="skel-line skel-w90" />
                  <div className="skel-line skel-w40" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="lib-empty-list">
              <Inbox size={40} strokeWidth={1.5} />
              <p>{filter ? '没有匹配的素材' : '还没有素材'}</p>
              {!filter && <p className="lib-empty-hint">去「对话」页面发送链接收藏</p>}
            </div>
          ) : (
            Object.entries(groups).map(([cat, items]) => (
              <div key={cat} className="lib-group">
                <div className="lib-group-header"
                  onClick={() => setCollapsedGroups(prev => ({ ...prev, [cat]: !prev[cat] }))}
                >
                  <div className="lib-group-left">
                    <ChevronRight size={14} strokeWidth={2.5}
                      className={`lib-group-chevron ${collapsedGroups[cat] ? 'collapsed' : ''}`} />
                    <span className="lib-group-title">{cat}</span>
                  </div>
                  <span className="lib-group-count">{items.length}</span>
                </div>
                {!collapsedGroups[cat] && (
                  <div className="lib-card-list">
                    {items.map(m => (
                      <MaterialCard key={m.id} material={m}
                        isExpanded={expandedId === m.id}
                        onToggle={() => handleToggle(m.id)}
                        onDelete={() => handleDelete(m)}
                        onContextMenu={(e) => handleContextMenu(e, m)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* === 右键上下文菜单 === */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="ctx-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.material.url && (
            <a
              className="ctx-item"
              href={contextMenu.material.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setContextMenu(null)}
            >
              <ExternalLink size={14} strokeWidth={2} /> 查看原文
            </a>
          )}
          {contextMenu.material.url && (
            <div className="ctx-item" onClick={() => handleCopyLink(contextMenu.material.url)}>
              <Copy size={14} strokeWidth={2} /> 复制链接
            </div>
          )}
          <div
            className="ctx-item ctx-danger"
            onClick={() => {
              const mat = contextMenu.material
              setContextMenu(null)
              handleDelete(mat)
            }}
          >
            <Trash2 size={14} strokeWidth={2} /> 删除
          </div>
        </div>
      )}
    </div>
  )
}

function MaterialCard({ material: m, isExpanded, onToggle, onDelete, onContextMenu }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [savingOutline, setSavingOutline] = useState(false)
  const [summary, setSummary] = useState(m.summary || '')
  useEffect(() => { setSummary(m.summary || '') }, [m.summary])
  const src = SOURCE_ICONS[m.source] || SOURCE_ICONS.web
  const dateStr = m.date ? new Date(m.date).toLocaleDateString('zh-CN', { month:'short', day:'numeric' }) : ''

  const saveOutline = async () => {
    setSavingOutline(true)
    try {
      await updateMaterial(m.id, { summary: draft })
      setSummary(draft)
      setEditing(false)
      toast('概要已更新', 'success')
    } catch (e) {
      toast(e?.message || '保存失败', 'error')
    }
    setSavingOutline(false)
  }

  // 详情即大纲（summary 多行要点），不再拉取 md 全文
  const handleExpand = () => {
    onToggle()
  }

  return (
    <div
      className={`mc-card ${isExpanded ? 'expanded' : ''}`}
      onClick={handleExpand}
      onContextMenu={onContextMenu}
    >
      <div className="mc-stripe" style={{ background: src.color }} />
      <div className="mc-main">
        <div className="mc-header">
          <div className="mc-title-area">
            <div className="mc-title">{m.title}</div>
            {m.extra_text && <div className="mc-extra">{m.extra_text}</div>}
          </div>
          <ChevronRight size={16} strokeWidth={2} className={`mc-chevron ${isExpanded ? 'rotated' : ''}`} />
        </div>
        <div className="mc-summary">{summary.split('\n')[0] || '暂无摘要'}</div>
        <div className="mc-meta">
          <span className="mc-source" style={{ color: src.color }}>{src.label}</span>
          {m.tags?.length > 0 && (
            <div className="mc-tags">{m.tags.map((t, i) => <span key={i} className="mc-tag">{t}</span>)}</div>
          )}
          {dateStr && <span className="mc-date"><Calendar size={11} strokeWidth={2} /> {dateStr}</span>}
        </div>
        {isExpanded && (
          <div className="mc-detail" onClick={(e) => e.stopPropagation()}>
            {/* 大纲式展示 + 可编辑（读后补自己的想法） */}
            {editing ? (
              <div className="mc-outline-edit">
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="每行一条要点，可补充自己的想法..."
                  spellCheck={false}
                />
                <div className="mc-outline-edit-btns">
                  <button className="mo-btn ghost" onClick={() => setEditing(false)}>取消</button>
                  <button className="mo-btn" onClick={saveOutline} disabled={savingOutline}>
                    {savingOutline ? <Loader2 size={12} className="spin-icon" /> : <Check size={12} />} 保存
                  </button>
                </div>
              </div>
            ) : (
              <>
                {(() => {
                  const lines = summary.split('\n').map(s => s.trim()).filter(Boolean)
                  if (!lines.length) return <div className="mc-detail-empty">暂无大纲</div>
                  return (
                    <ul className="mc-outline">
                      {lines.map((l, i) => <li key={i}>{l}</li>)}
                    </ul>
                  )
                })()}
                <button className="mc-outline-edit-btn" title="编辑概要，补充你的想法"
                  onClick={() => { setDraft(summary); setEditing(true) }}>
                  <Pencil size={12} strokeWidth={2} /> 编辑概要
                </button>
              </>
            )}
            <div className="mc-detail-actions">
              {m.url && (
                <a href={m.url} target="_blank" rel="noopener noreferrer" className="mc-detail-link"
                  onClick={(e) => e.stopPropagation()}>
                  查看原文全文 <ExternalLink size={13} strokeWidth={2} />
                </a>
              )}
              <button className="mc-detail-delete" onClick={(e) => { e.stopPropagation(); onDelete?.() }}>
                <Trash2 size={13} strokeWidth={2} /> 删除
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
