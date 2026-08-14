import { create } from 'zustand'
import { sendChat, confirmSave } from '../api/chat'

// 消息唯一 id（比数组下标更适合作为 React key）
let nextMsgId = 1

// 流式渲染节流间隔（ms）：chunk 很密集时降低 setState 频率，结束时统一补全
const RENDER_INTERVAL = 100

export const useChatStore = create((set, get) => ({
  messages: [],
  isSending: false,
  abortController: null,
  deepThinking: false,
  lastSendParams: null, // 供 retry 复用（保留 conversationId/mode）

  toggleDeepThinking: () => set(state => ({ deepThinking: !state.deepThinking })),

  sendMessage: async (text, image, mode, conversationId, onComplete) => {
    if ((!text && !image) || get().isSending) return

    const thinking = get().deepThinking
    const abortController = new AbortController()
    set({ isSending: true, abortController, lastSendParams: { text, image, mode, conversationId, onComplete } })

    // Add user message
    const userMsg = {
      id: nextMsgId++,
      role: 'user',
      content: image && !text ? getModeLabel(mode) : text,
      image: image || null,
    }
    set(state => ({ messages: [...state.messages, userMsg] }))

    // Add assistant placeholder with streaming state
    const assistantMsg = {
      id: nextMsgId++,
      role: 'assistant',
      content: '',
      reasoning: '',
      typing: true,
      streaming: true,
    }
    set(state => ({ messages: [...state.messages, assistantMsg] }))

    try {
      // 相对路径走 Vite 代理（开发）/ 同源（生产 build 由后端托管）
      const resp = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, image: image || '', mode: mode || '', thinking, conversation_id: conversationId || null }),
        signal: abortController.signal,
      })

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullContent = ''
      let fullReasoning = ''
      let msgData = null
      let lastRender = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6))

            if (evt.type === 'start') {
              // 连接已建立，显示等待状态；如果返回了 conversation_id，通知回调
              get()._updateLastMsg(set, { typing: true })
              if (evt.conversation_id && onComplete) {
                onComplete(evt.conversation_id)
              }
            } else if (evt.type === 'reasoning') {
              fullReasoning += evt.data
              const now = performance.now()
              if (now - lastRender > RENDER_INTERVAL) {
                lastRender = now
                get()._updateLastMsg(set, { reasoning: fullReasoning, typing: false })
              }
            } else if (evt.type === 'content') {
              fullContent += evt.data
              const now = performance.now()
              if (now - lastRender > RENDER_INTERVAL) {
                lastRender = now
                get()._updateLastMsg(set, { content: fullContent, typing: false })
              }
            } else if (evt.type === 'citations') {
              get()._updateLastMsg(set, { citations: evt.data })
            } else if (evt.type === 'error') {
              get()._updateLastMsg(set, {
                content: `请求失败：${evt.data}`,
                typing: false, streaming: false,
              })
            } else if (evt.type === 'done') {
              msgData = evt.data
            }
          } catch {}
        }
      }

      // Finalize — 保存原始请求和返回用于双击查看
      const rawRequest = JSON.stringify({
        message: text, mode: mode || '', thinking,
        conversation_id: conversationId || null,
      }, null, 2)
      const rawResponse = JSON.stringify({
        type: msgData?.type || 'chat',
        content_length: fullContent.length,
        reasoning_length: fullReasoning.length,
        reply: fullContent,
      }, null, 2)

      get()._updateLastMsg(set, {
        typing: false, streaming: false,
        content: fullContent || msgData?.reply || '（无回复）',
        reasoning: fullReasoning,
        messageType: msgData?.type,
        rawRequest, rawResponse,
        action: msgData?.action || null,
        entry: msgData?.entry,
        saveState: msgData?.action === 'already_saved' ? 'saved' : null,
      })

    } catch (err) {
      if (err.name === 'AbortError') {
        get()._updateLastMsg(set, {
          typing: false, streaming: false, aborted: true,
          content: get()._getLastMsg()?.content || '（已中止）',
        })
      } else {
        const errMsg = err?.message || '网络请求失败'
        get()._updateLastMsg(set, {
          content: `请求失败：${errMsg}`,
          typing: false, streaming: false,
        })
      }
    }

    set({ isSending: false, abortController: null })
  },

  // 中止当前请求
  abort: () => {
    const { abortController } = get()
    if (abortController) abortController.abort()
  },

  // 重试最后一条消息（复用发送时的 conversationId/mode，避免新建对话）
  retry: async () => {
    const { messages, lastSendParams } = get()
    // 找最后一条用户消息
    let lastUserIdx = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserIdx = i; break }
    }
    if (lastUserIdx === -1) return

    const lastUser = messages[lastUserIdx]
    // 删除该用户消息之后的所有消息
    set({ messages: messages.slice(0, lastUserIdx) })
    // 重新发送
    await get().sendMessage(
      lastUser.content, lastUser.image,
      lastSendParams?.mode || '',
      lastSendParams?.conversationId || null,
      lastSendParams?.onComplete,
    )
  },

  _updateLastMsg: (setFn, updates) => {
    setFn(state => ({
      messages: state.messages.map((m, i) =>
        i === state.messages.length - 1 ? { ...m, ...updates } : m
      ),
    }))
  },

  _getLastMsg: () => {
    const { messages } = get()
    return messages[messages.length - 1]
  },

  confirmSave: async (messageIndex) => {
    const messages = get().messages
    const msg = messages[messageIndex]
    if (!msg?.entry) return

    set(state => ({
      messages: state.messages.map((m, i) =>
        i === messageIndex ? { ...m, saveState: 'saving' } : m
      ),
    }))

    try {
      const data = await confirmSave(msg.entry)
      set(state => ({
        messages: state.messages.map((m, i) =>
          i === messageIndex
            ? { ...m, saveState: 'saved', content: m.content.replace('**是否保存到知识库？**', `**${data.message}**`) }
            : m
        ),
      }))
    } catch (err) {
      const errMsg = err?.message || '保存失败'
      set(state => ({
        messages: state.messages.map((m, i) =>
          i === messageIndex ? { ...m, saveState: 'error', saveError: errMsg } : m
        ),
      }))
    }
  },

  dismissSave: (messageIndex) => {
    set(state => ({
      messages: state.messages.map((m, i) =>
        i === messageIndex
          ? { ...m, saveState: 'dismissed', content: m.content.replace('**是否保存到知识库？**', '**未保存**') }
          : m
      ),
    }))
  },

  clearMessages: () => set({ messages: [], lastSendParams: null }),
}))

function getModeLabel(mode) {
  const labels = {
    describe: '描述图片', ocr: '提取文字', ui: 'UI 分析',
    error: '错误诊断', diagram: '图表解读', chart: '数据分析',
  }
  return labels[mode] || '图片分析'
}
