import { Search, Users, User, Download, X, Inbox, Clock, SearchIcon, EyeOff } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { useWeChatStore } from '../../stores/wechatStore'
import WxAvatar from '../../components/WxAvatar'

export default function ContactList() {
  const {
    contacts, query, typeFilter, loadingContacts,
    selectedNames, activeContact, savedNames, recentFilter, hasSearched,
    contextMenu,
    setQuery, setTypeFilter, loadContacts, setRecentFilter,
    toggleSelect, clearSelected,
    openContact,
    exportSelected, hideContact,
    openContextMenu, closeContextMenu,
  } = useWeChatStore()

  const menuRef = useRef(null)
  const searchTimerRef = useRef(null)

  const handleSearch = (e) => {
    setQuery(e.target.value)
    clearTimeout(searchTimerRef.current)
    if (!e.target.value.trim()) {
      loadContacts()
      return
    }
    searchTimerRef.current = setTimeout(() => loadContacts(), 300)
  }

  const handleTypeChange = (t) => {
    setTypeFilter(t)
    setTimeout(() => loadContacts(), 0)
  }

  const handleItemClick = (c) => {
    // 点击即预览（openContact 内部有 loading 防抖与同联系人短路）
    openContact(c)
  }

  const handleContextMenu = (e, name) => {
    e.preventDefault()
    openContextMenu(e.clientX, e.clientY, name)
  }

  const handleHide = () => {
    if (contextMenu?.name) {
      hideContact(contextMenu.name)
    }
    closeContextMenu()
  }

  // 点击外部关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return
    const close = () => closeContextMenu()
    // 延迟绑定，避免触发当前事件
    setTimeout(() => {
      document.addEventListener('click', close)
      document.addEventListener('contextmenu', close)
    }, 0)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('contextmenu', close)
    }
  }, [contextMenu])

  const selectedCount = selectedNames.size
  const hasQuery = query.trim().length > 0
  const showGuide = !hasQuery && contacts.length === 0 && !loadingContacts
  // 收藏视图（无搜索词时）顶部带一个小节标题
  const savedView = !hasQuery && savedNames.size > 0

  const renderContact = (c) => (
    <div
      key={c.username || c.name}
      className={`wx-contact-item ${activeContact?.name === c.name ? 'active' : ''}`}
      onClick={() => handleItemClick(c)}
      onContextMenu={(e) => handleContextMenu(e, c.name)}
    >
      <span
        className="wx-check"
        data-checked={selectedNames.has(c.name)}
        onClick={(e) => { e.stopPropagation(); toggleSelect(c.name) }}
      />
      <WxAvatar
        kind={c.is_group ? 'group' : 'user'}
        seed={c.name}
        size={36}
        text={c.name}
      />
      <div className="wx-contact-info">
        <span className="wx-contact-name">{c.name}</span>
        {c.remark && c.remark !== c.name && (
          <span className="wx-contact-remark">{c.remark}</span>
        )}
      </div>
      {c.is_group && <span className="wx-tag-mini">群</span>}
      {!savedView && savedNames.has(c.name) && <span className="wx-saved-dot" title="已收藏" />}
    </div>
  )

  return (
    <div className="wx-col wx-col-left">
      <div className="wx-search-wrap">
        <div className="wx-search">
          <Search size={14} strokeWidth={2} />
          <input
            placeholder="搜索群名 / 人名 / 昵称..."
            value={query}
            onChange={handleSearch}
            autoFocus
          />
          {query && <X size={13} className="wx-search-clear" onClick={() => { setQuery(''); loadContacts() }} />}
        </div>
        <div className="wx-type-tabs">
          {[
            { key: 'all', label: '全部' },
            { key: 'user', label: '个人', Icon: User },
            { key: 'group', label: '群聊', Icon: Users },
          ].map(({ key, label, Icon }) => (
            <button
              key={key}
              className={`wx-type-tab ${typeFilter === key ? 'active' : ''}`}
              onClick={() => handleTypeChange(key)}
            >
              {Icon && <Icon size={11} strokeWidth={2} />}
              {label}
            </button>
          ))}
          <button
            className={`wx-type-tab wx-recent-toggle ${recentFilter > 0 ? 'active' : ''}`}
            onClick={() => setRecentFilter(recentFilter > 0 ? 0 : 30)}
            title={recentFilter > 0 ? '当前只看近30天活跃，点击查看全部' : '当前显示全部，点击只看近30天'}
          >
            <Clock size={11} strokeWidth={2} />
            {recentFilter > 0 ? '近30天' : '全部'}
          </button>
        </div>
      </div>

      <div className="wx-contact-list">
        {loadingContacts ? (
          <div className="wx-contact-skeleton" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="wx-skel-row">
                <span className="wx-skel-avatar" />
                <div className="wx-skel-lines">
                  <span className="skel-line skel-w60" />
                  <span className="skel-line skel-w40" />
                </div>
              </div>
            ))}
          </div>
        ) : showGuide ? (
          <div className="wx-search-guide">
            <SearchIcon size={32} strokeWidth={1.5} />
            <p className="wx-guide-title">搜索找到想看的聊天</p>
            <p className="wx-guide-hint">输入群名、人名或昵称</p>
            <p className="wx-guide-hint">点过的自动收藏，右键可以隐藏</p>
          </div>
        ) : hasSearched && contacts.length === 0 ? (
          <div className="wx-empty-list">
            <Inbox size={28} strokeWidth={1.5} />
            <p>没有找到 "{query}"</p>
          </div>
        ) : contacts.length > 0 ? (
          <>
            {savedView && (
              <div className="wx-saved-header">
                <span>已收藏 {contacts.length}</span>
              </div>
            )}
            {contacts.map(renderContact)}
          </>
        ) : null}
      </div>

      {selectedCount > 0 && (
        <div className="wx-batch-bar">
          <span className="wx-batch-count">已选 {selectedCount} 个</span>
          <div className="wx-batch-actions">
            <button className="wx-batch-btn" onClick={() => exportSelected(null, 'html')}>
              <Download size={12} strokeWidth={2} /> HTML
            </button>
            <button className="wx-batch-btn" onClick={() => exportSelected(null, 'json')}>
              <Download size={12} strokeWidth={2} /> JSON
            </button>
            <button className="wx-batch-clear" onClick={clearSelected}>
              <X size={13} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="wx-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button className="wx-context-item" onClick={handleHide}>
            <EyeOff size={14} strokeWidth={2} />
            <span>隐藏此联系人</span>
          </button>
        </div>
      )}
    </div>
  )
}
