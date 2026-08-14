import { useState, useRef, useEffect, useCallback } from 'react'
import {
  ImagePlus, Send, Bot, User, X,
  FileText, Type, Palette, AlertCircle, BarChart3, TrendingUp,
  Check, Loader2, Sparkles, MessageCircle, Square, RotateCcw, Brain, ChevronDown,
  Plus, Trash2, Pencil, GripVertical, History, Code2, ArrowDown,
} from 'lucide-react'
import { useChatStore } from '../stores/chatStore'
import { useVisionStore } from '../stores/visionStore'
import { useMaterialStore } from '../stores/materialStore'
import { useConversationStore } from '../stores/conversationStore'
import { useImagePaste } from '../hooks/useImagePaste'
import { useAutoResize } from '../hooks/useAutoResize'
import { renderMarkdown } from '../utils/markdown'
import { toast } from '../components/Toast'
import './KnowledgeBase.css'

const VISION_MODES = [
  { key:'describe', label:'描述图片', Icon: FileText },
  { key:'ocr', label:'提取文字', Icon: Type },
  { key:'ui', label:'UI分析', Icon: Palette },
  { key:'error', label:'错误诊断', Icon: AlertCircle },
  { key:'diagram', label:'图表解读', Icon: BarChart3 },
  { key:'chart', label:'数据分析', Icon: TrendingUp },
]

export default function KnowledgeBase() {
  const { messages, isSending, sendMessage, confirmSave, dismissSave, clearMessages, abort, retry, deepThinking, toggleDeepThinking } = useChatStore()
  const { selectedImage, selectedMode, setImage, setMode, clear } = useVisionStore()
  const { fetchStats } = useMaterialStore()
  const { conversations, activeId, loadConversations, selectConversation, newConversation, renameConversation, removeConversation, reorder, refreshAfterMessage, clearActive } = useConversationStore()
  const [input, setInput] = useState('')
  const messagesRef = useRef(null)
  const fileInputRef = useRef(null)
  const { ref: textareaRef, resize } = useAutoResize()
  const [detailModal, setDetailModal] = useState(null) // { rawRequest, rawResponse }

  useEffect(() => { loadConversations() }, [loadConversations])

  const [showScrollBtn, setShowScrollBtn] = useState(false)

  // 距底部超过 300px 时显示「回到底部」按钮
  const handleMessagesScroll = useCallback(() => {
    const el = messagesRef.current
    if (!el) return
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 300)
  }, [])

  const scrollToBottom = (smooth = false) => {
    if (messagesRef.current) {
      messagesRef.current.scrollTo({
        top: messagesRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      })
    }
  }
  useEffect(() => { scrollToBottom() }, [messages])

  // 加载选中的对话历史
  const handleSelectConv = async (id) => {
    clearMessages()
    const detail = await selectConversation(id)
    if (detail?.messages?.length) {
      // 一次性写入全部历史消息，避免逐条 setState 触发多次渲染
      useChatStore.setState(state => ({
        messages: detail.messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          reasoning: m.reasoning,
          messageType: m.message_type,
          rawRequest: m.raw_request,
          rawResponse: m.raw_response,
          messageId: m.id,
        })),
      }))
    }
  }

  const handleNewConv = async () => {
    clearMessages()
    clearActive()
    await newConversation()
  }

  const handleImageFile = useCallback(async (file) => {
    if (!file.type.startsWith('image/')) return
    if (file.size > 10 * 1024 * 1024) { toast('图片不能超过 10MB', 'error'); return }
    const reader = new FileReader()
    reader.onload = (e) => setImage(e.target.result)
    reader.readAsDataURL(file)
  }, [setImage])

  useImagePaste(handleImageFile)

  const handleSend = async () => {
    const text = input.trim()
    if ((!text && !selectedImage) || isSending) return

    const img = selectedImage
    const mode = selectedMode
    const convId = activeId
    setInput('')
    resize()
    if (selectedImage) clear()

    await sendMessage(text, img, mode, convId, refreshAfterMessage)
    fetchStats()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const hasChat = messages.length > 0

  return (
    <div className="kb-container kb-chat-layout">
      {/* === 左侧对话历史栏 === */}
      <div className="chat-history-bar">
        <div className="chat-history-header">
          <span className="ch-title"><History size={15} strokeWidth={2} /> 对话历史</span>
          <button className="ch-new-btn" onClick={handleNewConv} title="新对话">
            <Plus size={16} strokeWidth={2.2} />
          </button>
        </div>
        <div className="chat-history-list">
          {conversations.length === 0 ? (
            <div className="ch-empty">还没有对话</div>
          ) : (
            conversations.map((c, idx) => (
              <ConvItem
                key={c.id}
                conv={c}
                index={idx}
                isActive={c.id === activeId}
                onSelect={() => handleSelectConv(c.id)}
                onRename={(title) => renameConversation(c.id, title)}
                onDelete={() => removeConversation(c.id)}
                onDragReorder={reorder}
                allConvs={conversations}
              />
            ))
          )}
        </div>
      </div>

      {/* === 右侧对话区 === */}
      <div className="kb-chat-main">
        <div className="kb-topbar">
          <h2 className="header-title"><MessageCircle size={18} strokeWidth={2.2} /> 对话</h2>
          <button
            className={`think-toggle ${deepThinking ? 'active' : ''}`}
            onClick={toggleDeepThinking}
            title={deepThinking ? '深度思考已开启（响应较慢）' : '点击开启深度思考'}
          >
            <Brain size={14} strokeWidth={2} />
            <span>深度思考</span>
            <span className={`think-switch ${deepThinking ? 'on' : ''}`}>
              <span className="think-switch-knob" />
            </span>
          </button>
        </div>

        <div className="chat-page-messages" ref={messagesRef} onScroll={handleMessagesScroll}>
          {!hasChat ? (
            <div className="chat-welcome">
              <Sparkles size={40} strokeWidth={1.5} />
              <p>问点什么？</p>
              <div className="chat-suggestions">
                <button className="chat-suggestion" onClick={() => { setInput('我收藏的素材里有哪些适合做选题？'); textareaRef.current?.focus() }}>
                  哪些素材适合做选题
                </button>
                <button className="chat-suggestion" onClick={() => { setInput('帮我总结一下浏览器自动化相关的素材'); textareaRef.current?.focus() }}>
                  总结浏览器自动化素材
                </button>
                <button className="chat-suggestion" onClick={() => { setInput('有哪些开源工具？'); textareaRef.current?.focus() }}>
                  有哪些开源工具
                </button>
              </div>
              <div className="chat-tip">💡 也可以直接粘贴链接收藏素材，或上传图片分析</div>
            </div>
          ) : (
            messages.map((msg, i) => (
              <MessageBubble key={msg.id ?? `idx-${i}`} msg={msg} index={i}
                onConfirmSave={confirmSave} onDismissSave={dismissSave}
                onRetry={retry}
                onShowDetail={(rawReq, rawResp) => setDetailModal({ rawRequest: rawReq, rawResponse: rawResp })}
              />
            ))
          )}
        </div>

        {/* 回到底部浮动按钮 */}
        {showScrollBtn && hasChat && (
          <button className="scroll-bottom-btn" onClick={() => scrollToBottom(true)} title="回到底部">
            <ArrowDown size={16} strokeWidth={2.2} />
          </button>
        )}

        <div className="chat-page-input">
          {selectedImage && (
            <div className="image-preview-bar">
              <img src={selectedImage} alt="preview" />
              <div className="ip-info">
                <strong>已附加图片</strong>
                <span>选择分析模式或输入问题</span>
              </div>
              <span className="ip-remove" onClick={clear}><X size={16} strokeWidth={2} /></span>
            </div>
          )}
          {selectedImage && (
            <div className="vision-presets">
              {VISION_MODES.map(({ key, label, Icon }) => (
                <div key={key} className={`vision-preset ${selectedMode === key ? 'active' : ''}`}
                  onClick={() => setMode(key)}>
                  <Icon size={13} strokeWidth={2} /> {label}
                </div>
              ))}
            </div>
          )}
          <div className="chat-input-wrap">
            <button className="chat-clip-btn" onClick={() => fileInputRef.current?.click()} title="上传图片">
              <ImagePlus size={18} strokeWidth={2} />
            </button>
            <input type="file" ref={fileInputRef} accept="image/*" style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleImageFile(file)
                e.target.value = ''
              }}
            />
            <textarea ref={textareaRef} className="chat-input" rows="1" value={input}
              placeholder="提问 · 粘贴链接收藏..."
              onChange={(e) => { setInput(e.target.value); resize() }}
              onKeyDown={handleKeyDown}
            />
            <button className="chat-send" disabled={isSending} onClick={handleSend} title="发送">
              {isSending ? <Loader2 size={16} strokeWidth={2.2} className="spin-icon" /> : <Send size={16} strokeWidth={2.2} />}
            </button>
            {isSending && (
              <button className="chat-abort" onClick={abort} title="中止">
                <Square size={16} strokeWidth={2.2} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* === 原始请求/返回查看弹窗 === */}
      {detailModal && (
        <div className="detail-modal-overlay" onClick={() => setDetailModal(null)}>
          <div className="detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-modal-header">
              <span><Code2 size={16} strokeWidth={2} /> 原始请求与返回</span>
              <button className="detail-modal-close" onClick={() => setDetailModal(null)}>
                <X size={18} strokeWidth={2} />
              </button>
            </div>
            <div className="detail-modal-body">
              <div className="detail-section">
                <h4>请求 (Request)</h4>
                <pre className="detail-code">{detailModal.rawRequest || '(无)'}</pre>
              </div>
              <div className="detail-section">
                <h4>返回 (Response)</h4>
                <pre className="detail-code">{detailModal.rawResponse || '(无)'}</pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* === 对话历史项（支持拖拽排序、重命名、删除） === */
function ConvItem({ conv, index, isActive, onSelect, onRename, onDelete, onDragReorder, allConvs }) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(conv.title)
  const [dragOver, setDragOver] = useState(false)
  const dragRef = useRef(null)

  const handleRename = () => {
    const v = editValue.trim()
    if (v && v !== conv.title) onRename(v)
    setEditing(false)
  }

  const handleDragStart = (e) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(conv.id))
    dragRef.current = conv.id
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = () => setDragOver(false)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const draggedId = parseInt(e.dataTransfer.getData('text/plain'))
    if (draggedId === conv.id) return

    // 重新排序
    const ids = allConvs.map(c => c.id)
    const fromIdx = ids.indexOf(draggedId)
    const toIdx = ids.indexOf(conv.id)
    if (fromIdx === -1 || toIdx === -1) return

    ids.splice(fromIdx, 1)
    ids.splice(toIdx, 0, draggedId)
    onDragReorder(ids)
  }

  if (editing) {
    return (
      <div className={`conv-item ${isActive ? 'active' : ''}`}>
        <input
          className="conv-edit-input"
          value={editValue}
          autoFocus
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRename()
            if (e.key === 'Escape') { setEditing(false); setEditValue(conv.title) }
          }}
        />
      </div>
    )
  }

  return (
    <div
      className={`conv-item ${isActive ? 'active' : ''} ${dragOver ? 'drag-over' : ''}`}
      onClick={onSelect}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <GripVertical size={12} strokeWidth={2} className="conv-grip" />
      <span className="conv-title-text">{conv.title}</span>
      <div className="conv-actions">
        <button className="conv-action-btn" onClick={(e) => { e.stopPropagation(); setEditing(true); setEditValue(conv.title) }} title="重命名">
          <Pencil size={11} strokeWidth={2} />
        </button>
        <button className="conv-action-btn danger" onClick={(e) => { e.stopPropagation(); onDelete() }} title="删除">
          <Trash2 size={11} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

/* === 消息气泡（支持流式 + 思考过程 + 双击查看原始数据） === */
function MessageBubble({ msg, index, onConfirmSave, onDismissSave, onRetry, onShowDetail }) {
  const isUser = msg.role === 'user'
  const [showReasoning, setShowReasoning] = useState(true)

  if (msg.typing) {
    return (
      <div className="msg assistant">
        <div className="msg-avatar assistant-avatar"><Bot size={18} strokeWidth={2} /></div>
        <div className="msg-content">
          <div className="msg-name">助手</div>
          <div className="msg-body">
            <div className="typing-indicator"><span></span><span></span><span></span></div>
          </div>
        </div>
      </div>
    )
  }

  const handleDoubleClick = () => {
    if (!isUser && (msg.rawRequest || msg.rawResponse)) {
      onShowDetail?.(msg.rawRequest, msg.rawResponse)
    }
  }

  return (
    <div className={`msg ${isUser ? 'user' : 'assistant'}`}>
      <div className={`msg-avatar ${isUser ? 'user-avatar' : 'assistant-avatar'}`}>
        {isUser ? <User size={18} strokeWidth={2} /> : <Bot size={18} strokeWidth={2} />}
      </div>
      <div className="msg-content">
        <div className="msg-name">
          {isUser ? '我' : '助手'}
          {!isUser && msg.streaming && <span className="msg-streaming-badge">生成中...</span>}
          {!isUser && (msg.rawRequest || msg.rawResponse) && (
            <span className="msg-detail-hint" title="双击查看原始请求/返回">双击查看详情</span>
          )}
        </div>
        <div
          className="msg-body"
          onDoubleClick={handleDoubleClick}
          style={!isUser && (msg.rawRequest || msg.rawResponse) ? { cursor: 'pointer' } : {}}
        >
          {msg.image && <img className="vision-image" src={msg.image} alt="用户上传" />}

          {!isUser && msg.reasoning && (
            <div className={`reasoning-block ${showReasoning ? 'expanded' : 'collapsed'}`}>
              <div className="reasoning-header" onClick={() => setShowReasoning(!showReasoning)}>
                <Brain size={13} strokeWidth={2} />
                <span>思考过程</span>
                {msg.streaming && <Loader2 size={12} strokeWidth={2.5} className="spin-icon" />}
                <ChevronDown size={13} strokeWidth={2} className={`reasoning-chevron ${showReasoning ? 'rotated' : ''}`} />
              </div>
              {showReasoning && <div className="reasoning-content">{msg.reasoning}</div>}
            </div>
          )}

          {msg.content ? (
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
          ) : !msg.reasoning ? (
            <span className="msg-placeholder">...</span>
          ) : null}

          {msg.streaming && msg.content && <span className="stream-cursor" />}

          {msg.aborted && (
            <div className="msg-aborted">
              <span>已中止</span>
              <button className="msg-retry-btn" onClick={onRetry}>
                <RotateCcw size={13} strokeWidth={2} /> 重新生成
              </button>
            </div>
          )}

          {msg.action === 'confirm_save' && !msg.saveState && (
            <div className="save-actions">
              <button className="save-btn save-yes" onClick={() => onConfirmSave(index)}>
                <Check size={15} strokeWidth={2.2} /> 保存
              </button>
              <button className="save-btn save-no" onClick={() => onDismissSave(index)}>不保存</button>
            </div>
          )}
          {msg.saveState === 'saving' && (
            <div className="save-status saving"><Loader2 size={14} strokeWidth={2.5} className="spin-icon" /> 保存中...</div>
          )}
          {msg.saveState === 'saved' && (
            <div className="save-status saved"><Check size={14} strokeWidth={2.5} /> 已收藏</div>
          )}
          {msg.saveState === 'error' && (
            <div className="save-status error">
              <AlertCircle size={14} strokeWidth={2} /> 保存失败：{msg.saveError}
              <button className="save-btn save-retry" onClick={() => onConfirmSave(index)}>重试</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
