import { useState, useRef, useImperativeHandle, forwardRef } from 'react'
import { Paperclip, ImagePlus } from 'lucide-react'
import { Sender } from '@ant-design/x'

/**
 * 聊天输入框 —— 壳由 @ant-design/x Sender 提供（框架化）：
 * - 自动增高（autoSize 内置，手搓 rAF 高度计算已退役）
 * - Enter 发送 / Shift+Enter 换行（组件默认行为）
 * - 附件按钮放 prefix 槽位
 * 性能设计保留：输入 state 只在这个组件内——打字只重渲染这个小组件，
 * 不触发 KnowledgeBase 大组件重渲染（lift state down，输入卡顿治理的成果）。
 *
 * 父组件通过 ref 调用 getValue()/clear()/setValue()，发送走 onSend(text)。
 */
const ChatInputBar = forwardRef(function ChatInputBar({
  onSend,
  onFileUpload,       // (files: FileList) => void
  onImageSelect,      // (file: File) => void
  isSending = false,
}, ref) {
  const [text, setText] = useState('')
  const fileInputRef = useRef(null)
  const senderRef = useRef(null)

  const doSend = () => {
    const val = text.trim()
    if (val && !isSending) {
      onSend(val)
      setText('')
    }
  }

  // --- 暴露给父组件的方法（契约与旧版一致） ---
  useImperativeHandle(ref, () => ({
    getValue: () => text,
    clear: () => setText(''),
    setValue: (val) => setText(val || ''),
    focus: () => senderRef.current?.focus(),
  }), [text])

  return (
    <div className="chat-page-input">
      <Sender
        ref={senderRef}
        className="ice-sender"
        placeholder="提问 · 输入 / 命令、@ 引用 · 粘贴链接收藏..."
        value={text}
        onChange={setText}
        onSubmit={doSend}
        loading={isSending}
        autoSize={{ minRows: 1, maxRows: 6 }}
        prefix={
          <>
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
          </>
        }
      />
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
    </div>
  )
})

export default ChatInputBar
