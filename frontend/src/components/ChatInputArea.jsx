import { memo, useState, useRef, useCallback, useEffect } from 'react'
import { Paperclip, ImagePlus, Send, Loader2 } from 'lucide-react'

/**
 * 聊天输入框（独立组件，React.memo）：
 * 打字只重渲染这个小组件，不触发整个 1185 行的 KnowledgeBase 重渲染。
 * 值的变化通过 onInputChange（debounced）通知父组件。
 */
const ChatInputArea = memo(function ChatInputArea({
  onSend,
  onInputChange,
  textareaRef,
  isSending,
  children, // palette 等浮层由父组件渲染
  ...props
}) {
  return (
    <div className="chat-page-input">
      <div className="chat-input-wrap" {...props}>
        {children}
        <textarea
          ref={textareaRef}
          className="chat-input"
          rows="1"
          placeholder="提问 · 输入 / 命令、@ 引用笔记素材 · 粘贴链接收藏..."
          onChange={onInputChange}
          onKeyDown={props.onKeyDown}
        />
        <button className="chat-clip-btn" title="上传图片">
          <ImagePlus size={18} strokeWidth={2} />
        </button>
        <label className="chat-file-btn" title="上传文件">
          <input type="file" multiple style={{ display: 'none' }} />
          <Paperclip size={18} strokeWidth={2} />
        </label>
        <button className="chat-send" disabled={isSending} onClick={onSend} title="发送">
          {isSending ? <Loader2 size={16} strokeWidth={2.2} className="spin-icon" /> : <Send size={16} strokeWidth={2.2} />}
        </button>
      </div>
    </div>
  )
})

export default ChatInputArea
