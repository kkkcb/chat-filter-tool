import { create } from 'zustand'
import { sendChat, confirmSave } from '../api/chat'
import { getAccessToken, API_PREFIX } from '../api/client'
import { updateMessageContent, deleteMessage } from '../api/conversations'

// 消息唯一 id（比数组下标更适合作为 React key）
let nextMsgId = 1

// 流式渲染节流间隔（ms）：chunk 很密集时降低 setState 频率，结束时统一补全
const RENDER_INTERVAL = 100

export const useChatStore = create((set, get) => ({
  messages: [],
  isSending: false,
  abortController: null,
  deepThinking: false,
  useRag: false, // 「引用知识库」开关：关=纯对话不带参考资料（默认），开=检索素材/笔记并引用
  useWeb: true, // 「联网抓取」开关：开=模型可按需调用 web_fetch 抓网页（默认开）
  lastSendParams: null, // 供 retry 复用（保留 conversationId/mode）

  toggleDeepThinking: () => set(state => ({ deepThinking: !state.deepThinking })),
  toggleUseRag: () => set(state => ({ useRag: !state.useRag })),
  toggleUseWeb: () => set(state => ({ useWeb: !state.useWeb })),

  // 单句删除：从列表移除（有 messageId 的会同时已在服务端删除）
  removeMessage: (localId) => set(state => ({
    messages: state.messages.filter(m => m.id !== localId),
  })),

  sendMessage: async (text, image, mode, conversationId, onComplete, files = null) => {
    if ((!text && !image) || get().isSending) return

    const thinking = get().deepThinking
    const abortController = new AbortController()
    set({ isSending: true, abortController, lastSendParams: { text, image, mode, conversationId, onComplete, files } })

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
      // API_PREFIX：本机走 Vite 代理/同源；部署形态指向远端后端（VITE_API_BASE）
      const streamHeaders = { 'Content-Type': 'application/json' }
      const accessToken = getAccessToken()
      if (accessToken) streamHeaders['X-Access-Token'] = accessToken
      const resp = await fetch(`${API_PREFIX}/chat/stream`, {
        method: 'POST',
        headers: streamHeaders,
        body: JSON.stringify({ message: text, image: image || '', mode: mode || '', thinking, use_rag: get().useRag, use_web: get().useWeb, conversation_id: conversationId || null, files: files || undefined }),
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

      // 归属守卫：流式内容只写本次的占位消息。用户中途切换会话后 messages
      // 已被换成新会话的历史——继续写"最后一条"会把 AI 回复灌进别人的气泡
      // （含用户消息）。守卫失守后跳过 UI 更新但继续读完流，让后端完整保存。
      const safeUpdate = (updates) => {
        if (get().messages.some(m => m.id === assistantMsg.id)) {
          get()._updateLastMsg(set, updates)
        }
      }

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
              safeUpdate({ typing: true })
              if (evt.conversation_id && onComplete) {
                onComplete(evt.conversation_id)
              }
              // 服务端返回用户消息 ID（前端支持单句删除）
              if (evt.user_message_id) {
                get()._updateMsgById(set, userMsg.id, { messageId: evt.user_message_id })
              }
            } else if (evt.type === 'saved') {
              // 助手消息已入库，记录服务端 ID（支持单句删除/懒加载 raw）
              if (evt.message_id) {
                safeUpdate({ messageId: evt.message_id })
              }
            } else if (evt.type === 'reasoning') {
              fullReasoning += evt.data
              const now = performance.now()
              if (now - lastRender > RENDER_INTERVAL) {
                lastRender = now
                safeUpdate({ reasoning: fullReasoning, typing: false })
              }
            } else if (evt.type === 'content') {
              fullContent += evt.data
              const now = performance.now()
              if (now - lastRender > RENDER_INTERVAL) {
                lastRender = now
                safeUpdate({ content: fullContent, typing: false })
              }
            } else if (evt.type === 'citations') {
              safeUpdate({ citations: evt.data })
            } else if (evt.type === 'tool_status') {
              // 模型调用了 web_fetch：气泡上累积显示抓取痕迹
              const cur = get()._getLastMsg()?.tools || []
              safeUpdate({ tools: [...cur, evt.data], typing: false })
            } else if (evt.type === 'error') {
              safeUpdate({
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

      safeUpdate({
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
        safeUpdate({
          typing: false, streaming: false, aborted: true,
          content: get()._getLastMsg()?.content || '（已中止）',
        })
      } else {
        const errMsg = err?.message || '网络请求失败'
        safeUpdate({
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

  // 手动重试 / 重新生成：重发最后一条用户消息
  // fallback 参数用于页面刷新后（lastSendParams 已丢）从当前选中会话兜底
  retry: async (fallbackConvId = null, fallbackOnComplete = null) => {
    const { messages, lastSendParams, isSending } = get()
    if (isSending) return
    // 找最后一条用户消息
    let lastUserIdx = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserIdx = i; break }
    }
    if (lastUserIdx === -1) return

    const lastUser = messages[lastUserIdx]
    // 服务端先删除这批消息再重发（重发会重新入库）：必须等删除落库，
    // 否则新请求加载历史时旧消息还在，会混进重发请求的上下文
    const doomed = messages.slice(lastUserIdx).filter(m => m.messageId)
    set({ messages: messages.slice(0, lastUserIdx) }) // 本地先移除，UI 即刻回位
    try {
      await Promise.all(doomed.map(m => deleteMessage(m.messageId)))
    } catch { /* 删除失败不阻塞重试 */ }
    // 重新发送
    await get().sendMessage(
      lastUser.content, lastUser.image,
      lastSendParams?.mode || '',
      lastSendParams?.conversationId ?? fallbackConvId,
      lastSendParams?.onComplete ?? fallbackOnComplete,
      lastSendParams?.files ?? null,
    )
  },

  _updateLastMsg: (setFn, updates) => {
    setFn(state => ({
      messages: state.messages.map((m, i) =>
        i === state.messages.length - 1 ? { ...m, ...updates } : m
      ),
    }))
  },

  _updateMsgById: (setFn, localId, updates) => {
    setFn(state => ({
      messages: state.messages.map(m => m.id === localId ? { ...m, ...updates } : m),
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
      const newContent = msg.content
        .replace('**是否保存到知识库？**', `**${data.message}**`)      // 旧文案
        .replace(/\*\*是否保存到素材库？[^\n]*/, `**${data.message}**`) // 新文案（含括号说明）
      set(state => ({
        messages: state.messages.map((m, i) =>
          i === messageIndex ? { ...m, saveState: 'saved', content: newContent } : m
        ),
      }))
      // 回写服务端：库里存的还是"是否保存？"原文，不回写的话刷新后会再问一遍
      if (msg.messageId) updateMessageContent(msg.messageId, newContent).catch(() => {})
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
    const msg = get().messages[messageIndex]
    const newContent = (msg?.content || '')
      .replace('**是否保存到知识库？**', '**未保存**')
      .replace(/\*\*是否保存到素材库？[^\n]*/, '**未保存**')
    set(state => ({
      messages: state.messages.map((m, i) =>
        i === messageIndex ? { ...m, saveState: 'dismissed', content: newContent } : m
      ),
    }))
    if (msg?.messageId) updateMessageContent(msg.messageId, newContent).catch(() => {})
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
