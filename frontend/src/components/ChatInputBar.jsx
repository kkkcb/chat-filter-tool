import { useState, useRef, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Paperclip, ImagePlus, Send, Loader2 } from 'lucide-react'

/**
 * 聊天输入框（自包含组件，性能隔离）：
 * 输入文字的 state 只在这个组件内——打字只重渲染这个小组件，
 * 不触发 KnowledgeBase（1185 行）重渲染。
 *
 * 父组件通过 ref 调用 getValue()/clear()/setValue()。
 * 发送时通过 onSend(text) 回调。
 * 命令面板检测在这个组件内完成，选中命令后通过 onCommand 回调。
 */
const ChatInputBar = forwardRef(function ChatInputBar({
  onSend,
  onCommand,          // (cmd: string, args?: any) => void — palette 命令选中
  onFileUpload,       // (files: FileList) => void
  onImageSelect,      // (file: File) => void
  isSending = false,
}, ref) {
  const [text, setText] = useState('')
  const [palette, setPalette] = useState(null) // 'slash' | 'at' | null
  const [paletteIdx, setPaletteIdx] = useState(0)
  const [atItems, setAtItems] = useState([])
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const rafRef = useRef(null)
  const lastHRef = useRef(0)

  // --- 自动调整高度（rAF 批处理，不布局抖动） ---
  const resize = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const el = textareaRef.current
      if (!el) return
      const h = Math.min(el.scrollHeight, 160)
      if (h !== lastHRef.current) {
        lastHRef.current = h
        el.style.height = h + 'px'
      }
    })
  }, [])

  // --- 命令面板检测（只在模式变化时 setState） ---
  const detectPalette = useCallback((val) => {
    const isSlash = /^\/[^\s]*$/.test(val)
    const atMatch = val.match(/@([^\s]*)$/)
    if (isSlash) {
      setPalette(p => p !== 'slash' ? 'slash' : p)
      setPaletteIdx(0)
    } else if (atMatch) {
      setPalette(p => p !== 'at' ? 'at' : p)
      setPaletteIdx(0)
      // 延迟搜索 @ 引用（父组件传入的搜索函数）
    } else {
      setPalette(p => p !== null ? null : p)
    }
  }, [])

  const handleChange = useCallback((e) => {
    setText(e.target.value)
    detectPalette(e.target.value)
    resize()
  }, [detectPalette, resize])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const val = text.trim()
      if (val && !isSending) {
        onSend(val)
        setText('')
        if (textareaRef.current) textareaRef.current.value = ''
        resize()
      }
    }
    if (e.key === 'Escape' && palette) {
      e.preventDefault()
      setPalette(null)
    }
  }, [text, isSending, onSend, palette, resize])

  // --- 暴露给父组件的方法 ---
  useImperativeHandle(ref, () => ({
    getValue: () => text,
    clear: () => {
      setText('')
      if (textareaRef.current) textareaRef.current.value = ''
      resize()
    },
    setValue: (val) => {
      setText(val)
      if (textareaRef.current) textareaRef.current.value = val
      resize()
    },
    focus: () => textareaRef.current?.focus(),
  }), [text, resize])

  return (
    <div className="chat-page-input">
      <div className="chat-input-wrap">
        <textarea
          ref={textareaRef}
          className="chat-input"
          rows="1"
          placeholder="提问 · 输入 / 命令、@ 引用 · 粘贴链接收藏..."
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
        <button
          className="chat-clip-btn"
          onClick={() => fileInputRef.current?.click()}
          title="上传图片"
          type="button"
        >
          <ImagePlus size={18} strokeWidth={2} />
        </button>
        <label className="chat-file-btn" title="上传文件（AI 分析内容）">
          <input type="file" multiple onChange={(e) => { onFileUpload?.(e.target.files); e.target.value = '' }} style={{ display: 'none' }} />
          <Paperclip size={18} strokeWidth={2} />
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onImageSelect?.(file)
            e.target.value = ''
          }}
        />
        <button
          className="chat-send"
          disabled={isSending || !text.trim()}
          onClick={() => {
            const val = text.trim()
            if (val && !isSending) {
              onSend(val)
              setText('')
              if (textareaRef.current) textareaRef.current.value = ''
              resize()
            }
          }}
          title="发送"
          type="button"
        >
          {isSending ? <Loader2 size={16} strokeWidth={2.2} className="spin-icon" /> : <Send size={16} strokeWidth={2.2} />}
        </button>
      </div>
    </div>
  )
})

export default ChatInputBar
