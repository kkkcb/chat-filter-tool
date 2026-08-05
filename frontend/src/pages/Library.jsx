import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Library as LibraryIcon, Search, ChevronRight,
  Calendar, ExternalLink, Inbox, Trash2, Copy, Link2,
} from 'lucide-react'
import { useMaterialStore } from '../stores/materialStore'
import { renderMarkdown } from '../utils/markdown'
import { getMaterials, getMaterial, deleteMaterial } from '../api/materials'
import './Library.css'
import './KnowledgeBase.css'

const SOURCE_ICONS = {
  github: { label: 'GitHub', color: '#333' },
  wechat: { label: '公众号', color: '#07c160' },
  web: { label: '网页', color: 'var(--accent)' },
}

export default function Library() {
  const { fetchStats } = useMaterialStore()
  const [materials, setMaterials] = useState([])
  const [loadingMats, setLoadingMats] = useState(true)
  const [filter, setFilter] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [collapsedGroups, setCollapsedGroups] = useState({})
  const [contextMenu, setContextMenu] = useState(null) // { x, y, material }
  const contextMenuRef = useRef(null)

  const loadMaterials = useCallback(async () => {
    try {
      const data = await getMaterials()
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
    if (!window.confirm(`确定删除「${material.title}」？`)) return
    try {
      await deleteMaterial(material.id)
      setExpandedId(null)
      await loadMaterials()
      fetchStats()
    } catch {
      window.alert('删除失败')
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
    navigator.clipboard.writeText(url).then(() => {
      // 可以加 toast 提示
    }).catch(() => {})
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
          <h2 className="header-title"><LibraryIcon size={18} strokeWidth={2.2} /> 素材库</h2>
          <span className="lib-count">{materials.length} 条素材</span>
        </div>
        <div className="lib-search">
          <Search size={14} strokeWidth={2} />
          <input placeholder="搜索素材..." value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>

      <div className="lib-main">
        <div className="lib-materials">
          {loadingMats ? (
            <div className="lib-loading">加载中...</div>
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
  const [detail, setDetail] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const src = SOURCE_ICONS[m.source] || SOURCE_ICONS.web
  const dateStr = m.date ? new Date(m.date).toLocaleDateString('zh-CN', { month:'short', day:'numeric' }) : ''

  const handleExpand = async () => {
    onToggle()
    if (!detail && !loadingDetail) {
      setLoadingDetail(true)
      try { setDetail(await getMaterial(m.id)) } catch { setDetail(null) }
      setLoadingDetail(false)
    }
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
        <div className="mc-summary">{m.summary || '暂无摘要'}</div>
        <div className="mc-meta">
          <span className="mc-source" style={{ color: src.color }}>{src.label}</span>
          {m.tags?.length > 0 && (
            <div className="mc-tags">{m.tags.map((t, i) => <span key={i} className="mc-tag">{t}</span>)}</div>
          )}
          {dateStr && <span className="mc-date"><Calendar size={11} strokeWidth={2} /> {dateStr}</span>}
        </div>
        {isExpanded && (
          <div className="mc-detail">
            {loadingDetail && <div className="mc-detail-loading">加载详情...</div>}
            {!loadingDetail && detail?.content && (
              <div className="mc-detail-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(detail.content.substring(0, 2000)) }} />
            )}
            {!loadingDetail && !detail?.content && <div className="mc-detail-empty">暂无正文内容</div>}
            <div className="mc-detail-actions">
              {m.url && (
                <a href={m.url} target="_blank" rel="noopener noreferrer" className="mc-detail-link"
                  onClick={(e) => e.stopPropagation()}>
                  查看原文 <ExternalLink size={13} strokeWidth={2} />
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
