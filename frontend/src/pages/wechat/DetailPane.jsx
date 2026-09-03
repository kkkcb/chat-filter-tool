import { useState, useEffect, useRef } from 'react'
import {
  Eye, Download, FileText, FileCode, Files, Loader2,
  ImageIcon, Mic, Video, Smile, Link2, MapPin, UserCircle,
  Phone, Info, RotateCcw, MessageSquare, Sparkles, X, ChevronUp,
  ListChecks, ExternalLink,
} from 'lucide-react'
import { useWeChatStore } from '../../stores/wechatStore'
import CollectDialog from './CollectDialog'
import WxAvatar from '../../components/WxAvatar'
import { wxFileUrl } from '../../api/wechat'
import { toast } from '../../components/Toast'

const TYPE_ICON = {
  image: ImageIcon, voice: Mic, video: Video, sticker: Smile,
  link: Link2, file: FileText, location: MapPin, contact_card: UserCircle,
  record: Files, link_or_file: Link2,
  voip: Phone, call: Phone, system: Info, recall: RotateCcw,
}
const TYPE_LABEL = {
  image: '图片', voice: '语音', video: '视频', sticker: '表情',
  link: '链接', file: '文件', location: '位置', contact_card: '名片',
  record: '聊天记录', link_or_file: '链接/文件',
  voip: '通话', call: '通话', system: '系统消息', recall: '撤回',
}

/** 首屏渲染条数与每次加载增量 — 超大聊天（数万条）一次性渲染会卡死浏览器 */
const INITIAL_VISIBLE = 300
const LOAD_MORE_STEP = 1000

/** 时间胶囊显示阈值：与微信一致，间隔超过 5 分钟或跨天才出现 */
const TIME_GAP = 5 * 60

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad2(n) { return n < 10 ? `0${n}` : String(n) }

function dateKey(ts) {
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** 微信式时间胶囊文案：14:23 / 昨天 14:23 / 8月30日 周六 14:23 / 2024年8月30日 周六 14:23 */
function pillLabel(ts) {
  const d = new Date(ts * 1000)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400000)
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (d.toDateString() === today.toDateString()) return hm
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`
  const day = `${d.getMonth() + 1}月${d.getDate()}日`
  const wd = ` ${WEEKDAYS[d.getDay()]}`
  if (d.getFullYear() === today.getFullYear()) return `${day}${wd} ${hm}`
  return `${d.getFullYear()}年${day}${wd} ${hm}`
}

/** 文本气泡内容：引用消息（"↳ 回复…"）拆出来渲染成内嵌引用块 */
function BubbleText({ content, isQuote }) {
  const t = content || ''
  const idx = t.indexOf('\n  ↳ ')
  if (idx < 0) return <span>{t}</span>
  return (
    <>
      <span>{t.slice(0, idx)}</span>
      <span className="wx-quote" data-me={isQuote || undefined}>{t.slice(idx + 5)}</span>
    </>
  )
}

export default function DetailPane() {
  const {
    activeContact, messages, loadingMessages,
    selectedMsgs, exportFormat, exportTask, exporting,
    setExportFormat, exportSelected, toggleSelectMsg, clearSelectedMsgs,
    previewContact,
  } = useWeChatStore()
  const [showCollect, setShowCollect] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [error, setError] = useState('')
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE)
  const [elapsed, setElapsed] = useState(0)
  const messagesRef = useRef(null)
  const prevHeightRef = useRef(0)

  const exitSelect = () => {
    setSelectMode(false)
    clearSelectedMsgs()
  }

  // 换联系人时退出多选并清空选中
  useEffect(() => {
    setSelectMode(false)
    clearSelectedMsgs()
  }, [activeContact?.username])

  // 换联系人或新一批消息到达时，重置渲染窗口
  useEffect(() => { setVisibleCount(INITIAL_VISIBLE) }, [activeContact?.username, messages])

  // 预览耗时计时（超过 1s 才显示，避免闪烁）
  useEffect(() => {
    if (!loadingMessages) { setElapsed(0); return }
    const t0 = Date.now()
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500)
    return () => clearInterval(timer)
  }, [loadingMessages])

  // 新一批消息加载完成 → 直接滚到最底部（最新消息）
  useEffect(() => {
    if (!loadingMessages && messages.length > 0 && messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages, loadingMessages])

  // 「加载更多」在顶部插入旧消息 → 锚定原有视口位置不跳动
  useEffect(() => {
    const el = messagesRef.current
    if (!el || loadingMessages || !messages.length) return
    if (prevHeightRef.current && el.scrollHeight > prevHeightRef.current) {
      el.scrollTop += el.scrollHeight - prevHeightRef.current
    }
    prevHeightRef.current = el.scrollHeight
  }, [visibleCount, loadingMessages, messages])

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

  // 保存文件原件：先 fetch 校验（本地无缓存时后端返回 404+原因），成功再触发下载
  const handleSaveFile = async (e, m) => {
    e.stopPropagation()
    const name = (m.content || '文件').replace(/^\[文件\]\s*/, '')
    try {
      const resp = await fetch(wxFileUrl(activeContact.name, m.local_id, m.timestamp))
      if (!resp.ok) {
        const err = await resp.json().catch(() => null)
        throw new Error(err?.error || '保存失败')
      }
      const blob = await resp.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      a.click()
      URL.revokeObjectURL(a.href)
      toast(`已保存 ${name}`, 'success')
    } catch (err) {
      toast(String(err.message || err).split('\n')[0], 'error', 5000)
    }
  }

  const selectedCount = selectedMsgs.size

  // 空态：未选联系人
  if (!activeContact) {
    return (
      <div className="wx-col wx-col-mid">
        <div className="wx-detail-empty">
          <MessageSquare size={36} strokeWidth={1.5} />
          <p>点击左侧联系人即可预览消息</p>
          <span className="wx-detail-hint">支持搜索群名 / 人名 / 昵称，右键可隐藏不常看的会话</span>
        </div>
      </div>
    )
  }

  const isGroup = !!activeContact.is_group

  return (
    <div className="wx-col wx-col-mid">
      {/* 联系人头部：多选模式下替换为选取操作 */}
      <div className="wx-detail-header">
        {selectMode ? (
          <>
            <div className="wx-detail-contact">
              <ListChecks size={18} strokeWidth={2} className="wx-select-icon" />
              <div>
                <div className="wx-detail-name">选择消息</div>
                <div className="wx-detail-sub">{selectedCount > 0 ? `已选 ${selectedCount} 条` : '点击消息选取'}</div>
              </div>
            </div>
            <div className="wx-detail-ops">
              <button className="wx-btn-secondary" onClick={exitSelect}>
                <X size={13} strokeWidth={2} /> 取消
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="wx-detail-contact">
              <WxAvatar
                kind={isGroup ? 'group' : 'user'}
                seed={activeContact.name}
                size={38}
                text={activeContact.name}
              />
              <div>
                <div className="wx-detail-name">{activeContact.name}</div>
                <div className="wx-detail-sub">
                  {isGroup ? '群聊' : '个人'}
                  {!loadingMessages && messages.length > 0 && ` · ${messages.length} 条消息`}
                </div>
              </div>
            </div>
            <div className="wx-detail-ops">
              <button
                className="wx-btn-secondary"
                onClick={() => setSelectMode(true)}
                disabled={!messages.length || loadingMessages}
                title="选取消息收入素材库"
              >
                <ListChecks size={13} strokeWidth={2} /> 多选
              </button>
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
                    <Icon size={11} strokeWidth={2} /> {label}
                  </button>
                ))}
              </div>
              <button className="wx-btn-secondary" onClick={handlePreview} disabled={loadingMessages} title="重新读取最近消息">
                {loadingMessages ? <Loader2 size={13} strokeWidth={2.5} className="wx-spin" /> : <RotateCcw size={13} strokeWidth={2} />}
                {loadingMessages ? '读取中' : '刷新'}
              </button>
              <button className="wx-btn-primary" onClick={handleExport} disabled={exporting}>
                {exporting ? <Loader2 size={13} strokeWidth={2.5} className="wx-spin" /> : <Download size={13} strokeWidth={2} />}
                导出
              </button>
            </div>
          </>
        )}
      </div>

      {/* 导出进度 */}
      {exportTask && !selectMode && (
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

      {/* 预览进度（带耗时，超过 1s 才显示具体秒数） */}
      {loadingMessages && (
        <div className="wx-progress-wrap slim">
          <span className="wx-progress-text">
            <Loader2 size={12} strokeWidth={2.5} className="wx-spin" /> 正在读取最近 {messages.length || 2000} 条消息{elapsed > 1 ? ` · ${elapsed}s` : '...'}
          </span>
        </div>
      )}

      {error && <div className="wx-detail-error">{error}</div>}

      {/* 消息列表 + 吸底收集条 */}
      <div className={`wx-messages-wrap ${selectMode ? 'selecting' : ''}`}>
        <div className="wx-messages" ref={messagesRef}>
          {loadingMessages ? (
            <div className="wx-messages-loading">
              <Loader2 size={24} strokeWidth={2} className="wx-spin" />
              <p>正在读取聊天记录...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="wx-detail-empty">
              <Eye size={32} strokeWidth={1.5} />
              <p>该会话暂无消息</p>
            </div>
          ) : (
            <>
              {/* 渲染窗口：默认最近 INITIAL_VISIBLE 条，避免大聊天卡死浏览器 */}
              {messages.length > visibleCount && (
                <button className="wx-load-more" onClick={() => setVisibleCount(c => c + LOAD_MORE_STEP)}>
                  <ChevronUp size={12} strokeWidth={2.2} />
                  查看更早的消息（还有 {messages.length - visibleCount} 条）
                </button>
              )}
              {(() => {
                const total = messages.length
                const visible = total > visibleCount ? messages.slice(total - visibleCount) : messages
                const startIndex = total - visible.length
                let prevTs = 0
                let prevKey = null
                let prevSender = null
                return visible.map((m, i) => {
                  const absIdx = startIndex + i // 选中状态使用全量数组下标，与收入素材库对齐
                  const isMe = m.sender === 'me'
                  const Icon = TYPE_ICON[m.type]
                  const isText = !m.type || m.type === 'text' || m.type === 'quote'
                  const isSys = m.type === 'system' || m.type === 'recall'
                  const checked = selectedMsgs.has(absIdx)
                  // 时间胶囊：首条 / 跨天 / 距上一条超过 5 分钟
                  const dk = m.timestamp ? dateKey(m.timestamp) : null
                  const showTime = !!m.timestamp && (dk !== prevKey || (prevTs && m.timestamp - prevTs > TIME_GAP))
                  if (dk) prevKey = dk
                  if (m.timestamp) prevTs = m.timestamp
                  // 同一人连续发言 → 收紧间距（微信式消息分组）
                  const grouped = !isSys && !showTime && m.sender === prevSender
                  prevSender = isSys ? null : m.sender

                  if (isSys) {
                    return (
                      <div key={absIdx}>
                        {showTime && <div className="wx-time-pill">{pillLabel(m.timestamp)}</div>}
                        <div className="wx-sys-row">
                          {m.type === 'recall' && <RotateCcw size={11} strokeWidth={2} />}
                          <span>{m.content || TYPE_LABEL[m.type]}</span>
                        </div>
                      </div>
                    )
                  }

                  // 气泡内容：按消息类型分流
                  const renderBody = () => {
                    // 图片/视频：微信式缩略占位块，不带气泡底
                    if (!isText && (m.type === 'image' || m.type === 'video')) {
                      return (
                        <span className="wx-media-box">
                          {Icon && <Icon size={26} strokeWidth={1.6} />}
                          <span>{TYPE_LABEL[m.type]}</span>
                        </span>
                      )
                    }
                    // 链接：可点击卡片（有真实 URL 时）
                    if (m.type === 'link') {
                      const title = (m.content || '').replace(/^\[链接\]\s*/, '')
                      if (m.url) {
                        return (
                          <a
                            className="wx-card-link"
                            href={m.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => selectMode && e.preventDefault()}
                          >
                            <span className="wx-card-thumb"><Link2 size={15} strokeWidth={2} /></span>
                            <span className="wx-card-title">{title || m.url}</span>
                            <ExternalLink size={12} strokeWidth={2} className="wx-card-arrow" />
                          </a>
                        )
                      }
                    }
                    // 文件：卡片 + 保存原件（定位微信本地缓存副本）
                    if (m.type === 'file') {
                      const name = (m.content || '').replace(/^\[文件\]\s*/, '')
                      return (
                        <span className="wx-card-file">
                          <span className="wx-card-thumb file"><FileText size={15} strokeWidth={2} /></span>
                          <span className="wx-card-title">{name || '文件'}</span>
                          <button
                            className="wx-card-save"
                            onClick={(e) => handleSaveFile(e, m)}
                            title="保存原件（来自微信本地缓存）"
                          >
                            保存
                          </button>
                        </span>
                      )
                    }
                    // 引用 / 普通文本 / 其他特殊类型
                    return (
                      <div className={`wx-bubble ${isMe ? 'wx-bubble-me' : 'wx-bubble-other'}`}>
                        {isText ? (
                          <BubbleText content={m.content} isQuote={isMe} />
                        ) : (
                          <span className="wx-msg-special">
                            {Icon && <Icon size={14} strokeWidth={2} />}
                            {m.content || TYPE_LABEL[m.type] || m.type || '消息'}
                          </span>
                        )}
                      </div>
                    )
                  }

                  return (
                    <div key={absIdx}>
                      {showTime && <div className="wx-time-pill">{pillLabel(m.timestamp)}</div>}
                      <div
                        className={`wx-msg-row ${isMe ? 'me' : 'other'} ${grouped ? 'grouped' : ''} ${checked ? 'selected' : ''}`}
                        onClick={() => selectMode && toggleSelectMsg(absIdx)}
                      >
                        {selectMode && (
                          <span
                            className="wx-check"
                            data-checked={checked}
                            onClick={(e) => { e.stopPropagation(); toggleSelectMsg(absIdx) }}
                          />
                        )}
                        <WxAvatar
                          kind={isMe ? 'me' : 'user'}
                          seed={isMe ? '__me__' : (m.sender || activeContact.name)}
                          size={38}
                          text={isMe ? '我' : (m.sender || '?')}
                        />
                        <div className="wx-msg-main">
                          {isGroup && !isMe && <div className="wx-msg-sender">{m.sender}</div>}
                          {renderBody()}
                        </div>
                      </div>
                    </div>
                  )
                })
              })()}
            </>
          )}
        </div>

        {/* 多选态吸底操作条 */}
        {selectMode && !loadingMessages && (
          <div className="wx-collect-bar">
            <span className="wx-collect-count">
              {selectedCount > 0 ? `已选 ${selectedCount} 条` : '点击消息选取'}
            </span>
            <div className="wx-collect-btns">
              <button className="wx-btn-clear-sm" onClick={exitSelect}>
                <X size={12} /> 取消
              </button>
              <button
                className="wx-btn-primary"
                disabled={selectedCount === 0}
                onClick={() => setShowCollect(true)}
                style={selectedCount === 0 ? { opacity: .55, cursor: 'not-allowed' } : undefined}
              >
                <Sparkles size={13} strokeWidth={2.5} /> 收入素材库
              </button>
            </div>
          </div>
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
