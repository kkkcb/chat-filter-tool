import { useState, useEffect } from 'react'
import {
  Eye, Download, FileText, FileCode, Files, Loader2,
  ImageIcon, Mic, Video, Smile, Link2, MapPin, UserCircle,
  Phone, Info, RotateCcw, MessageSquare, Sparkles, X, ChevronUp,
} from 'lucide-react'
import { useWeChatStore } from '../../stores/wechatStore'
import CollectDialog from './CollectDialog'

const TYPE_ICON = {
  image: ImageIcon, voice: Mic, video: Video, sticker: Smile,
  link: Link2, location: MapPin, card: UserCircle,
  voip: Phone, system: Info, recall: RotateCcw,
}
const TYPE_LABEL = {
  image: '图片', voice: '语音', video: '视频', sticker: '表情',
  link: '链接', location: '位置', card: '名片',
  voip: '通话', system: '系统消息', recall: '撤回',
}

/** 首屏渲染条数与每次加载增量 — 超大聊天（数万条）一次性渲染会卡死浏览器 */
const INITIAL_VISIBLE = 300
const LOAD_MORE_STEP = 1000

function fmtTime(ts) {
  if (!ts) return ''
  try {
    return new Date(ts * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

export default function DetailPane() {
  const {
    activeContact, messages, loadingMessages, previewProgress,
    selectedMsgs, exportFormat, exportTask, exporting,
    setExportFormat, exportSelected, toggleSelectMsg, clearSelectedMsgs,
    previewContact,
  } = useWeChatStore()
  const [showCollect, setShowCollect] = useState(false)
  const [error, setError] = useState('')
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE)

  // 换联系人或新一批消息到达时，重置渲染窗口
  useEffect(() => { setVisibleCount(INITIAL_VISIBLE) }, [activeContact?.username, messages])

  const handlePreview = async () => {
    if (!activeContact) return
    setError('')
    try {
      await previewContact(activeContact)
    } catch (e) {
      setError(e.message || '加载消息失败')
    }
  }

  const handleExport = () => {
    if (!activeContact) return
    setError('')
    exportSelected([activeContact.name], exportFormat).catch(e => setError(e.message))
  }

  const selectedCount = selectedMsgs.size

  // 空态：未选联系人
  if (!activeContact) {
    return (
      <div className="wx-col wx-col-mid">
        <div className="wx-detail-empty">
          <MessageSquare size={36} strokeWidth={1.5} />
          <p>从左侧选择联系人</p>
          <span className="wx-detail-hint">查看聊天记录、导出或收入素材库</span>
        </div>
      </div>
    )
  }

  return (
    <div className="wx-col wx-col-mid">
      {/* 联系人头部 */}
      <div className="wx-detail-header">
        <div className="wx-detail-contact">
          <span className={`wx-avatar-mini ${activeContact.is_group ? 'group' : 'user'}`}>
            {activeContact.is_group ? <MessageSquare size={13} /> : (activeContact.name || '?').charAt(0)}
          </span>
          <div>
            <div className="wx-detail-name">{activeContact.name}</div>
            <div className="wx-detail-sub">
              {activeContact.is_group ? '群聊' : '个人'} · {activeContact.username || ''}
              {!loadingMessages && messages.length > 0 && ` · 共 ${messages.length} 条`}
            </div>
          </div>
        </div>
      </div>

      {/* 操作区 */}
      <div className="wx-detail-actions">
        <div className="wx-format-group">
          {[
            { key: 'html', label: 'HTML', Icon: FileText },
            { key: 'json', label: 'JSON', Icon: FileCode },
            { key: 'both', label: '两者', Icon: Files },
          ].map(({ key, label, Icon }) => (
            <button
              key={key}
              className={`wx-format-btn ${exportFormat === key ? 'active' : ''}`}
              onClick={() => setExportFormat(key)}
            >
              <Icon size={12} strokeWidth={2} /> {label}
            </button>
          ))}
        </div>
        <div className="wx-detail-btns">
          <button className="wx-btn-secondary" onClick={handlePreview} disabled={loadingMessages}>
            {loadingMessages ? <Loader2 size={13} strokeWidth={2.5} className="wx-spin" /> : <Eye size={13} strokeWidth={2} />}
            {loadingMessages ? '加载中' : '预览消息'}
          </button>
          <button className="wx-btn-primary" onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 size={13} strokeWidth={2.5} className="wx-spin" /> : <Download size={13} strokeWidth={2} />}
            导出
          </button>
        </div>
      </div>

      {/* 导出进度 */}
      {exportTask && (
        <div className="wx-progress-wrap">
          <div className="wx-progress-bar">
            <div className="wx-progress-fill" style={{ width: `${exportTask.progress}%` }} />
          </div>
          <span className="wx-progress-text">
            {exportTask.done ? '完成' : `${exportTask.progress}%`}
            {exportTask.results?.length > 0 && ` · ${exportTask.results.length} 个会话`}
          </span>
        </div>
      )}

      {/* 预览进度 */}
      {previewProgress && (
        <div className="wx-progress-wrap slim">
          <span className="wx-progress-text">
            <Loader2 size={12} strokeWidth={2.5} className="wx-spin" /> 正在导出消息 {previewProgress.completed}/{previewProgress.total}...
          </span>
        </div>
      )}

      {error && <div className="wx-detail-error">{error}</div>}

      {/* 消息列表 */}
      <div className="wx-messages">
        {loadingMessages ? (
          <div className="wx-messages-loading">
            <Loader2 size={24} strokeWidth={2} className="wx-spin" />
            <p>正在读取聊天记录...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="wx-detail-empty">
            <Eye size={32} strokeWidth={1.5} />
            <p>点击「预览消息」查看聊天记录</p>
          </div>
        ) : (
          <>
            {/* 渲染窗口：默认最近 INITIAL_VISIBLE 条，避免大聊天卡死浏览器 */}
            {messages.length > visibleCount && (
              <button className="wx-load-more" onClick={() => setVisibleCount(c => c + LOAD_MORE_STEP)}>
                <ChevronUp size={13} strokeWidth={2.2} />
                加载更早的消息（还有 {messages.length - visibleCount} 条）
              </button>
            )}
            {(() => {
              const total = messages.length
              const visible = total > visibleCount ? messages.slice(total - visibleCount) : messages
              const startIndex = total - visible.length
              return visible.map((m, i) => {
                const absIdx = startIndex + i // 选中状态使用全量数组下标，与收入素材库对齐
                const isMe = m.sender === 'me'
                const Icon = TYPE_ICON[m.type]
                const isText = !m.type || m.type === 'text'
                return (
                  <div key={absIdx} className={`wx-msg-row ${isMe ? 'me' : 'other'}`}>
                    <span
                      className="wx-check"
                      data-checked={selectedMsgs.has(absIdx)}
                      onClick={() => toggleSelectMsg(absIdx)}
                    />
                    <span className={`wx-avatar-mini ${isMe ? 'user' : 'other'}`}>
                      {isMe ? '我' : (m.sender || '?').charAt(0)}
                    </span>
                    <div className="wx-msg-main">
                      <div className="wx-msg-meta">
                        <span className="wx-msg-sender">{isMe ? '我' : (m.sender || activeContact.name)}</span>
                        {m.timestamp && <span className="wx-msg-time">{fmtTime(m.timestamp)}</span>}
                      </div>
                      <div className={`wx-bubble ${isMe ? 'wx-bubble-me' : 'wx-bubble-other'}`}>
                        {isText ? (
                          <span>{m.content || ''}</span>
                        ) : (
                          <span className="wx-msg-special">
                            {Icon && <Icon size={13} strokeWidth={2} />}
                            {m.content || TYPE_LABEL[m.type] || m.type || '消息'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            })()}

            {/* 收入素材库条 */}
            {selectedCount > 0 && (
              <div className="wx-collect-bar">
                <span className="wx-collect-count">已选 {selectedCount} 条</span>
                <div className="wx-collect-btns">
                  <button className="wx-btn-clear-sm" onClick={clearSelectedMsgs}>
                    <X size={12} /> 清除
                  </button>
                  <button className="wx-btn-primary" onClick={() => setShowCollect(true)}>
                    <Sparkles size={13} strokeWidth={2} /> 收入素材库
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showCollect && (
        <CollectDialog
          contact={activeContact}
          selectedMsgs={selectedMsgs}
          messages={messages}
          onClose={() => setShowCollect(false)}
        />
      )}
    </div>
  )
}
