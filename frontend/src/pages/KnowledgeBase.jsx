import { useState, useRef, useEffect, useCallback, memo } from 'react'
import {
  ImagePlus, Send, Bot, User, X,
  FileText, Type, Palette, AlertCircle, BarChart3, TrendingUp,
  Check, Copy, Loader2, Sparkles, MessageCircle, Square, RotateCcw, Brain, ChevronDown,
  Plus, Trash2, History, Code2, ArrowDown, NotebookPen, BookOpen, Maximize2, Minimize2, Bookmark, MessageCircleQuestion, Paperclip, Globe,
} from 'lucide-react'
import { useChatStore } from '../stores/chatStore'
import { ThoughtChain, Bubble, Conversations } from '@ant-design/x'
import { useVisionStore } from '../stores/visionStore'
import { useMaterialStore } from '../stores/materialStore'
import { useConversationStore } from '../stores/conversationStore'
import { getMessage } from '../api/conversations'
import { useNoteStore } from '../stores/noteStore'
import { summarizeConversation, getNotes } from '../api/notes'
import { getConversationNotes, getConversationContext } from '../api/conversations'
import ChatInputBar from '../components/ChatInputBar'
import { useImagePaste } from '../hooks/useImagePaste'
import { useAutoResize } from '../hooks/useAutoResize'
import { renderMarkdown, renderUserText } from '../utils/markdown'
import { copyText } from '../utils/clipboard'
import { toast } from '../components/Toast'
import { confirmDialog } from '../components/Confirm'
import InputPalette, { SLASH_COMMANDS, paletteKeydown } from '../components/InputPalette'
import '../components/InputPalette.css'
import { deleteMessage } from '../api/conversations'
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
  const { messages, isSending, sendMessage, confirmSave, dismissSave, clearMessages, abort, retry, deepThinking, toggleDeepThinking, useRag, toggleUseRag, useWeb, toggleUseWeb, removeMessage } = useChatStore()
  const { selectedImage, selectedMode, setImage, setMode, clear } = useVisionStore()
  const { fetchStats } = useMaterialStore()
  const { conversations, activeId, loadConversations, selectConversation, newConversation, renameConversation, removeConversation, reorder, refreshAfterMessage, clearActive } = useConversationStore()
  const [input, setInput] = useState('')
  // pi 式输入面板：/ 命令 与 @ 引用
  const [palette, setPalette] = useState(null) // 'slash' | 'at' | null
  const [readingMode, setReadingMode] = useState(false) // 全屏阅读
  const [historyCollapsed, setHistoryCollapsed] = useState(false) // 侧栏收起
  const [nodePreview, setNodePreview] = useState(null) // 导航点悬停预览 {text,x,y}
  const [bookmarks, setBookmarks] = useState([]) // 一次性标记 [{msgId, label}]
  const [askPanel, setAskPanel] = useState(null) // {quote, question, messages: [], sending}
  const [paletteIdx, setPaletteIdx] = useState(0)
  const [atItems, setAtItems] = useState([])
  const atSearchTimer = useRef(null)
  const inputBarRef = useRef(null) // 输入 debounce：打字时只更 DOM，停顿后同步 React state
  const [summarizing, setSummarizing] = useState(false)
  const { loadStats: loadNoteStats } = useNoteStore()
  const messagesRef = useRef(null)
  const fileInputRef = useRef(null)
  const { ref: textareaRef, resize } = useAutoResize()
  const [detailModal, setDetailModal] = useState(null) // { rawRequest, rawResponse }

  useEffect(() => { loadConversations() }, [loadConversations])

  // 接收笔记页的「跳到来源对话」事件
  useEffect(() => {
    const handler = (e) => {
      const { id } = e.detail
      if (id) {
        handleSelectConv(id)
        toast('已跳转到来源对话', 'info')
      }
    }
    window.addEventListener('ice:goto-conversation', handler)
    return () => window.removeEventListener('ice:goto-conversation', handler)
  }, [])

  const [showScrollBtn, setShowScrollBtn] = useState(false)

  // 距底部超过 300px 时显示「回到底部」按钮
  const handleMessagesScroll = useCallback(() => {
    const el = messagesRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setShowScrollBtn(distFromBottom > 300)
    // 智能跟随：用户滚离底部 > 80px 时停止自动跟随，滚回底部恢复
    userScrolledUp.current = distFromBottom > 80
  }, [])

  const scrollToBottom = (smooth = false) => {
    if (messagesRef.current) {
      messagesRef.current.scrollTo({
        top: messagesRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      })
    }
  }
  // 流式输出时跟随最新消息——但用户手动滚上去后不再强行拉回
  const userScrolledUp = useRef(false)
  useEffect(() => {
    if (!userScrolledUp.current) scrollToBottom()
  }, [messages])

  // 加载选中的对话历史（详情不再含 raw 大字段，双击时按需拉取）
  // 节点轨当前位置：滚动时计算视口内最近的用户消息
  const updateCurrentNode = useCallback(() => {
    const el = messagesRef.current
    if (!el) return
    const viewport = el.scrollTop + el.clientHeight / 2
    const rows = [...el.querySelectorAll('[data-msg-idx]')]
    let closest = -1
    let closestDist = Infinity
    for (const row of rows) {
      const idx = parseInt(row.dataset.msgIdx, 10)
      const msg = messages[idx]
      if (!msg || msg.role !== 'user' || !msg.content) continue
      const rect = row.offsetTop
      const dist = Math.abs(rect - viewport)
      if (dist < closestDist) { closestDist = dist; closest = idx }
    }
    setCurrentNodeIdx(closest)
  }, [messages])

  useEffect(() => {
    const el = messagesRef.current
    if (!el) return
    el.addEventListener('scroll', updateCurrentNode, { passive: true })
    updateCurrentNode()
    return () => el.removeEventListener('scroll', updateCurrentNode)
  }, [updateCurrentNode])

  const checkConvNotes = useCallback(async (id) => {
    if (!id) { setConvNotesCount(0); setCtxStats(null); return }
    try {
      const notes = await getConversationNotes(id)
      setConvNotesCount(notes.length)
    } catch { setConvNotesCount(0) }
    try {
      setCtxStats(await getConversationContext(id))
    } catch { setCtxStats(null) }
  }, [])

  const handleShowConvNotes = async () => {
    if (!activeId) return
    try {
      const notes = await getConversationNotes(activeId)
      if (notes.length === 1) {
        // 只有一篇 → 直接跳
        window.dispatchEvent(new CustomEvent('ice:switch-view', { detail: { view: 'notes' } }))
        setTimeout(() => window.dispatchEvent(new CustomEvent('ice:goto-note', { detail: { id: notes[0].id } })), 150)
      } else if (notes.length > 1) {
        // 多篇 → 弹选择
        setConvNotes(notes)
      }
    } catch { toast('获取笔记失败', 'error') }
  }

  // === 会话列表操作（@ant-design/x Conversations 组件的菜单/重命名） ===
  const [renamingId, setRenamingId] = useState(null)
  const [renameVal, setRenameVal] = useState('')

  const commitRename = () => {
    if (renamingId == null) return
    const v = renameVal.trim()
    const conv = conversations.find(c => c.id === renamingId)
    if (v && conv && v !== conv.title) renameConversation(renamingId, v)
    setRenamingId(null)
  }

  const moveConv = (id, dir) => {
    const ids = conversations.map(c => c.id)
    const i = ids.indexOf(id)
    const j = i + dir
    if (i === -1 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    reorder(ids)
  }

  const handleConvMenu = async (menuKey, convId) => {
    const conv = conversations.find(c => c.id === convId)
    if (!conv) return
    if (menuKey === 'rename') {
      setRenamingId(convId); setRenameVal(conv.title)
    } else if (menuKey === 'delete') {
      const ok = await confirmDialog({
        title: '删除对话',
        message: `「${(conv.title || '').slice(0, 30)}」及其全部消息将删除，不可恢复`,
        confirmText: '删除', danger: true,
      })
      if (ok) removeConversation(convId)
    } else if (menuKey === 'up') moveConv(convId, -1)
    else if (menuKey === 'down') moveConv(convId, 1)
  }

  const handleSelectConv = async (id) => {
    userScrolledUp.current = false // 切换对话 → 恢复自动跟随
    clearMessages()
    checkConvNotes(id)
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
          messageId: m.id,
        })),
      }))
    }
  }

  // 单句删除：应用内确认 → 服务端删除 → 本地移除
  const handleDeleteMessage = async (msg) => {
    if (!msg.messageId) return
    const preview = (msg.content || '').slice(0, 30).replace(/\s+/g, ' ')
    const ok = await confirmDialog({
      title: '删除这条消息',
      message: `「${preview}${(msg.content || '').length > 30 ? '...' : ''}」删除后不可恢复，且后续对话不再携带它作为上下文`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteMessage(msg.messageId)
      removeMessage(msg.id)
      // 消息删光后自动清掉空壳对话（标题等残留没意义）
      if (messages.length === 1 && activeId) {
        await removeConversation(activeId)
      } else {
        refreshAfterMessage()
      }
      toast('消息已删除', 'success')
    } catch (e) {
      toast(e?.message || '删除失败', 'error')
    }
  }

  // 双击消息 → 查看原始请求/返回（历史消息按需从服务端拉取 raw）
  const openMessageDetail = async (msg) => {
    const hasLocal = msg.rawRequest || msg.rawResponse
    if (!hasLocal && !msg.messageId) return
    setDetailModal({
      rawRequest: msg.rawRequest || '',
      rawResponse: msg.rawResponse || '',
      reasoning: msg.reasoning || '',
      loading: !hasLocal,
    })
    if (!hasLocal && msg.messageId) {
      try {
        const d = await getMessage(msg.messageId)
        setDetailModal({ rawRequest: d.raw_request || '(无)', rawResponse: d.raw_response || '(无)', reasoning: d.reasoning || '', loading: false })
      } catch {
        setDetailModal({ rawRequest: '加载失败，请重试', rawResponse: '', reasoning: '', loading: false })
      }
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

  // ===== pi 式输入面板：/ 命令、@ 引用 =====

  const paletteQuery = (() => {
    if (palette === 'slash' && input.startsWith('/')) return input.slice(1)
    if (palette === 'at') {
      const m = input.match(/@([^@\s]*)$/)
      return m ? m[1] : ''
    }
    return ''
  })()

  const filteredCount = palette === 'slash'
    ? SLASH_COMMANDS.filter(c => c.cmd.slice(1).toLowerCase().includes(paletteQuery.toLowerCase())).length
    : atItems.length

  const detectPalette = useCallback((text) => {
    const isSlash = /^\/[^\s]*$/.test(text)
    const atMatch = text.match(/@([^@\s]*)$/)

    // 只在模式实际变化时 setState（避免每键触发重渲染）
    if (isSlash) {
      if (palette !== 'slash') { setPalette('slash'); setPaletteIdx(0) }
      return
    }
    if (atMatch) {
      if (palette !== 'at') { setPalette('at'); setPaletteIdx(0) }
      const q = atMatch[1] || ''
      clearTimeout(atSearchTimer.current)
      atSearchTimer.current = setTimeout(async () => {
        try {
          const notes = await getNotes({ q, limit: 8 })
          const items = (notes || []).map(n => ({
            label: `@${n.title}`, sub: `笔记${n.category ? ' · ' + n.category : ''}`,
            kind: 'note', title: n.title,
          }))
          setAtItems(items)
        } catch { setAtItems([]) }
      }, 200)
      return
    }
    if (palette !== null) setPalette(null)
  }, [palette])

  const onInputChanged = (e) => {
    setInput(e.target.value)
    detectPalette(e.target.value)
  }

  const pickSlash = (item) => {
    setPalette(null); setInput('')
    const c = item.cmd
    if (c === '/总结为笔记') { handleSendNote() }
    else if (c === '/深度思考') { toggleDeepThinking(); toast(deepThinking ? '已关闭深度思考' : '已开启深度思考', 'info') }
    else if (c === '/引用知识库') { toggleUseRag(); toast(useRag ? '已关闭知识库引用' : '已开启知识库引用', 'info') }
    else if (c === '/联网') { toggleUseWeb(); toast(useWeb ? '已关闭联网抓取' : '已开启联网抓取', 'info') }
    else if (c === '/新对话') { handleNewConv() }
  }

  const pickAt = (item) => {
    // 把输入尾部 @xx 替换为完整 @标题 （后端解析注入正文）
    const next = input.replace(/@[^@\s]*$/, item.label + ' ')
    setInput(next)
    setPalette(null)
    textareaRef.current?.focus()
  }

  const handlePaletteKey = (e) => {
    if (palette === null) return false
    if (e.key === 'Escape') { e.preventDefault(); setPalette(null); return true }
    if (paletteKeydown(palette, e, filteredCount, setPaletteIdx)) return true
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      if (palette === 'slash') {
        const list = SLASH_COMMANDS.filter(c => c.cmd.slice(1).toLowerCase().includes(paletteQuery.toLowerCase()))
        const item = list[paletteIdx] || list[0]
        if (item) pickSlash(item)
      } else {
        const item = atItems[paletteIdx] || atItems[0]
        if (item) pickAt(item)
      }
      return true
    }
    return false
  }

  const handleSend = async (textArg) => {
    const text = (textArg || '').trim()
    if ((!text && !selectedImage) || isSending) return

    // === 对话式指令拦截：保存类的话直接执行，不再发给 AI 空转 ===
    // 保存目标判定：有待决链接 → 存链接；否则「保存」→ 默认总结当前对话为笔记
    const lastMsg = messages[messages.length - 1]
    const hasPendingLink = lastMsg?.role === 'assistant' && lastMsg.action === 'confirm_save' && !lastMsg.saveState
    const saveNoteIntent = /^(请|帮我)?(保存|总结|存|记)(为|到|成)?(一|这)?(篇|个)?(笔记|个人知识库)/.test(text)
      || text.includes('总结为笔记') || text.includes('保存到笔记') || text.includes('存为笔记')
    const bareSaveIntent = /^(请)?(保存|存一下|保存一下|收藏一下)(吧)?$/.test(text) && !hasPendingLink

    // 1) 保存为笔记（明确说了笔记，或裸「保存」且没有待决链接 → 默认存本对话）
    if (saveNoteIntent || bareSaveIntent) {
      setInput(''); resize()
      const convId = activeId || conversations[0]?.id
      if (!convId) { toast('当前没有可总结的对话', 'error'); return }
      // 在消息流里显示一条轻提示，让"保存"有对话感（裸「保存」时说明默认目标）
      const hint = bareSaveIntent && !saveNoteIntent
        ? '📌 本对话没有待保存的链接，已默认把本对话总结为笔记…'
        : '📌 正在把本对话总结为笔记…'
      useChatStore.setState(s => ({ messages: [...s.messages, { id: Date.now(), role: 'assistant', content: hint }] }))
      setSummarizing(true)
      try {
        const data = await summarizeConversation(convId)
        toast(`已保存笔记「${data.note.title}」`, 'success', 4000)
        useChatStore.setState(s => ({
          messages: s.messages.map(m => m.content === hint
            ? { ...m, content: `📌 已保存笔记「${data.note.title}」（可在 个人知识库 查看）` } : m),
        }))
        loadNoteStats()
      } catch (e) {
        toast(e?.message || '总结失败，请重试', 'error')
        useChatStore.setState(s => ({ messages: s.messages.filter(m => m.content !== hint) }))
      }
      setSummarizing(false)
      return
    }

    // 2) 待决的链接收藏：直接说「保存 / 保存到素材库 / 不保存」即可确认或取消
    if (hasPendingLink) {
      const wantsSave = /^(好|嗯|要|存|保存|确认|收藏|可以|yes|ok)/i.test(text) || /保存到|收藏到|存到/.test(text)
      const wantsNo = /^(不|别|取消|不用|算了|no)/i.test(text)
      if (wantsSave && !wantsNo) {
        setInput(''); resize()
        await confirmSave(messages.length - 1)
        return
      }
      if (wantsNo) {
        setInput(''); resize()
        await dismissSave(messages.length - 1)
        return
      }
    }
    // === 拦截结束，走正常发送 ===

    const img = selectedImage
    const mode = selectedMode
    const convId = activeId
    setInput('')
    resize()
    if (selectedImage) clear()

    const files = attachments.length > 0 ? attachments.map(a => ({ name: a.name, url: a.url, is_text: a.is_text, text_content: a.text_content, size: a.size })) : null
    setAttachments([])
    userScrolledUp.current = false // 用户发新消息 → 恢复自动跟随
    await sendMessage(text, img, mode, convId, refreshAfterMessage, files)
    fetchStats()
  }

  const handleSendNote = async () => {
    const convId = activeId || conversations[0]?.id
    if (!convId) { toast('当前没有可总结的对话', 'error'); return }
    setSummarizing(true)
    try {
      const data = await summarizeConversation(convId)
      toast(`已保存笔记「${data.note.title}」`, 'success', 4000)
      loadNoteStats()
    } catch (e) {
      toast(e?.message || '总结失败，请重试', 'error')
    }
    setSummarizing(false)
  }

  // ===== 一次性标记（会话级书签）=====

  const toggleBookmark = (msg, idx) => {
    setBookmarks(prev => {
      const exists = prev.find(b => b.msgId === msg.id)
      if (exists) return prev.filter(b => b.msgId !== msg.id)
      const label = (msg.content || '').slice(0, 18).replace(/\n/g, ' ')
      return [...prev, { msgId: msg.id, idx, label }]
    })
  }

  const jumpToBookmark = (idx) => {
    const el = document.querySelector(`[data-msg-idx="${idx}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // ===== 划词追问 sub-agent =====

  const handleTextSelect = (e, msg, idx) => {
    const sel = window.getSelection()
    const text = sel?.toString().trim()
    if (!text || text.length < 4) { setAskFloat(null); return }
    // 只在本条消息内选的才弹
    const range = sel.getRangeAt(0)
    if (!e.currentTarget.contains(range.commonAncestorContainer)) return
    // 浮动按钮位置
    const rect = range.getBoundingClientRect()
    setAskFloat({ text, x: rect.left + rect.width / 2, y: rect.top - 36, msg, idx })
  }

  const [askFloat, setAskFloat] = useState(null)
  const [attachments, setAttachments] = useState([]) // 上传的文件
  const [currentNodeIdx, setCurrentNodeIdx] = useState(-1) // 当前视口的用户消息节点 [{name, url, is_text, text_content, size}]
  const [convNotes, setConvNotes] = useState(null) // 弹窗：对话沉淀的笔记列表
  const [convNotesCount, setConvNotesCount] = useState(0)
  const [ctxStats, setCtxStats] = useState(null) // {estimated_tokens, usage_percent, message_count}

  const openAskPanel = () => {
    if (!askFloat) return
    setAskPanel({ quote: askFloat.text, messages: [], sending: false })
    setAskFloat(null)
    window.getSelection()?.removeAllRanges()
  }

  const askQuestion = async () => {
    if (!askPanel || askPanel.sending || !askInput.trim()) return
    const q = askInput.trim()
    setAskInput('')
    const userMsg = { role: 'user', content: q }
    setAskPanel(p => ({ ...p, messages: [...p.messages, userMsg], sending: true }))
    try {
      // 构建追问上下文：引用原文 + 之前的追问历史（多轮追问能连贯）
      const historyText = askPanel.messages
        .map(m => `${m.role === 'user' ? '问' : '答'}: ${m.content}`)
        .join('\n')
      const prompt = `我在阅读一段内容时有疑问，请你帮我解答。

原文片段：
${askPanel.quote}
${historyText ? `\n之前的追问：\n${historyText}\n` : ''}
我的问题：${q}`

      // 走流式接口（sendChat 非 stream 版本在此页面未 import，直接 fetch）
      const token = getAccessToken()
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers['X-Access-Token'] = token
      const resp = await fetch(`${API_PREFIX}/chat/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: prompt, use_rag: false }),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let reply = ''
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
            if (evt.type === 'content') reply += evt.data
            if (evt.type === 'error') throw new Error(evt.data)
          } catch (e) {
            if (e.message && !e.message.includes('JSON')) throw e
          }
        }
      }
      setAskPanel(p => ({ ...p, messages: [...p.messages, { role: 'assistant', content: reply || '(无回复)' }], sending: false }))
    } catch (e) {
      setAskPanel(p => ({ ...p, messages: [...p.messages, { role: 'assistant', content: `追问失败：${e.message}` }], sending: false }))
    }
  }

  const [askInput, setAskInput] = useState('')

  const handleFileUpload = async (fileList) => {
    const files = [...fileList].filter(f => f.size <= 20 * 1024 * 1024)
    if (!files.length) { toast('文件过大（最大 20MB）', 'error'); return }
    for (const f of files) {
      try {
        toast(`上传 ${f.name}...`, 'info', 1500)
        const r = await uploadFileGeneric(f)
        setAttachments(prev => [...prev, r])
        toast(`已上传 ${f.name}`, 'success')
      } catch (e) {
        toast(`上传 ${f.name} 失败: ${e.message}`, 'error')
      }
    }
  }

  const handleFileInput = (e) => {
    if (e.target.files?.length) handleFileUpload(e.target.files)
    e.target.value = '' // 允许重复选择同一文件
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handleDrop = (e) => {
    e.preventDefault()
    if (e.dataTransfer.files?.length) handleFileUpload(e.dataTransfer.files)
  }

  const removeAttachment = (idx) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx))
  }

  const handleKeyDown = (e) => {
    if (handlePaletteKey(e)) return
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  // 把当前对话总结沉淀为个人知识库笔记
  const handleSummarize = async () => {
    const convId = activeId || conversations[0]?.id
    if (!convId) { toast('当前没有可总结的对话', 'error'); return }
    setSummarizing(true)
    try {
      const data = await summarizeConversation(convId)
      toast(`已保存笔记「${data.note.title}」`, 'success', 4000)
      loadNoteStats()
    } catch (e) {
      toast(e?.message || '总结失败，请重试', 'error')
    }
    setSummarizing(false)
  }

  const hasChat = messages.length > 0

  return (
    <div className={`kb-container kb-chat-layout ${readingMode ? 'reading-mode' : ''}`}>
      {/* === 左侧对话历史栏 === */}
        <div className={`chat-history-bar ${historyCollapsed ? 'collapsed' : ''}`}>
        <div className="chat-history-header">
          <span className="ch-title"><History size={15} strokeWidth={2} /> {historyCollapsed ? '' : '对话历史'}</span>
            <button className="ch-collapse-btn" onClick={() => setHistoryCollapsed(!historyCollapsed)}
              title={historyCollapsed ? '展开对话历史' : '收起对话历史'}>
              {historyCollapsed ? '›' : '‹'}
            </button>
          <button className="ch-new-btn" onClick={handleNewConv} title="新对话">
            <Plus size={16} strokeWidth={2.2} />
          </button>
        </div>
        <div className="chat-history-list">
          {conversations.length === 0 ? (
            <div className="ch-empty">还没有对话</div>
          ) : (
            <Conversations
              items={conversations.map(c => ({
                key: String(c.id),
                label: renamingId === c.id ? (
                  <input
                    className="conv-edit-input" value={renameVal} autoFocus
                    onChange={(e) => setRenameVal(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                  />
                ) : c.title,
                // 双击快捷重命名（菜单里也有入口）
                onDoubleClick: () => { setRenamingId(c.id); setRenameVal(c.title) },
              }))}
              activeKey={activeId ? String(activeId) : undefined}
              onActiveChange={(key) => handleSelectConv(Number(key))}
              menu={(item) => ({
                items: [
                  { key: 'rename', label: '重命名' },
                  { key: 'up', label: '上移', disabled: item.key === String(conversations[0]?.id) },
                  { key: 'down', label: '下移', disabled: item.key === String(conversations[conversations.length - 1]?.id) },
                  { type: 'divider' },
                  { key: 'delete', label: '删除对话', danger: true },
                ],
                onClick: ({ key: menuKey }) => handleConvMenu(menuKey, Number(item.key)),
              })}
            />
          )}
        </div>
      </div>

      {/* === 右侧对话区 === */}
      <div className="kb-chat-main">
        <div className="kb-topbar">
          <h2 className="header-title"><MessageCircle size={18} strokeWidth={2.2} /> 对话</h2>
          <div className="kb-topbar-actions">
            <button
              className={`note-sum-btn ${hasChat ? '' : 'disabled'}`}
              onClick={handleSummarize}
              disabled={!hasChat || summarizing}
              title={hasChat ? '把当前对话总结成笔记，沉淀踩坑与经验' : '先进行一段对话'}
            >
              {summarizing
                ? <Loader2 size={14} strokeWidth={2.5} className="spin-icon" />
                : <NotebookPen size={14} strokeWidth={2} />}
              <span>{summarizing ? '总结中...' : '总结为笔记'}</span>
            </button>
            {convNotesCount > 0 && (
              <button className="chat-summarize-btn" onClick={() => { console.log("DBG btn clicked"); handleShowConvNotes() }}
                title={`本对话已沉淀 ${convNotesCount} 篇笔记`}>
                <NotebookPen size={14} strokeWidth={2} /> 笔记 ({convNotesCount})
              </button>
            )}
            <button
              className={`chat-read-btn ${readingMode ? 'active' : ''}`}
              onClick={() => setReadingMode(r => !r)}
              title={readingMode ? '退出全屏阅读' : '全屏阅读（隐藏侧栏）'}
            >
              {readingMode ? <Minimize2 size={14} strokeWidth={2} /> : <Maximize2 size={14} strokeWidth={2} />}
            </button>
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
            <button
              className={`think-toggle ${useRag ? 'active' : ''}`}
              onClick={toggleUseRag}
              title={useRag ? '已开启：回复会检索素材库/笔记并标注引用' : '已关闭：纯对话，不带参考资料'}
            >
              <BookOpen size={14} strokeWidth={2} />
              <span>引用知识库</span>
              <span className={`think-switch ${useRag ? 'on' : ''}`}>
                <span className="think-switch-knob" />
              </span>
            </button>
            <button
              className={`think-toggle ${useWeb ? 'active' : ''}`}
              onClick={toggleUseWeb}
              title={useWeb ? '已开启：模型可按需抓取网页（链接+提问会读取网页正文）' : '已关闭：模型不联网，纯本地知识回答'}
            >
              <Globe size={14} strokeWidth={2} />
              <span>联网抓取</span>
              <span className={`think-switch ${useWeb ? 'on' : ''}`}>
                <span className="think-switch-knob" />
              </span>
            </button>
          </div>
        </div>

        {/* 对话节点导航：紧贴消息区左侧（在滚动容器外，不随内容滚动消失） */}
        {messages.filter(m => m.role === 'user' && m.content).length > 1 && !readingMode && (
          <div className="chat-node-track">
            {messages.map((msg, i) => {
              if (msg.role !== 'user' || !msg.content) return null
              const fullText = typeof msg.content === 'string' ? msg.content : ''
              return (
                <button
                  key={msg.id || i}
                  className={`chat-node-dot ${i === currentNodeIdx ? 'current' : ''}`}
                  onMouseEnter={(e) => {
                    // 预览卡 fixed 定位渲染在组件根部：轨道是 overflow-y:auto
                    // 的滚动容器，绝对定位子元素会被横向裁掉。轨道在右侧，
                    // 必须用 right 锚定（left 锚定在视口右缘时，shrink-to-fit
                    // 的可用宽度只剩十几像素，文本被压成一字一行的竖条）
                    const r = e.currentTarget.getBoundingClientRect()
                    setNodePreview({ text: fullText, right: window.innerWidth - r.left + 10, y: r.top + r.height / 2 })
                  }}
                  onMouseLeave={() => setNodePreview(null)}
                  onClick={() => {
                    const el = document.querySelector(`[data-msg-idx="${i}"]`)
                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }}
                />
              )
            })}
          </div>
        )}
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
              <div key={msg.id ?? `idx-${i}`} data-msg-idx={i} className="msg-row-wrap"
                onMouseUp={(e) => handleTextSelect(e, msg, i)}>
                <MessageBubble msg={msg} index={i} isLast={i === messages.length - 1}
                onConfirmSave={confirmSave} onDismissSave={dismissSave}
                onRetry={() => retry(activeId, refreshAfterMessage)}
                onShowDetail={openMessageDetail}
                onDelete={() => handleDeleteMessage(msg)}
                bookmarked={bookmarks.some(b => b.msgId === msg.id)}
                onBookmark={() => toggleBookmark(msg, i)}
              />
              <button
                className={`chat-bookmark-btn ${bookmarks.some(b => b.msgId === msg.id) ? 'active' : ''}`}
                onClick={() => toggleBookmark(msg, i)}
                title="标记此位置（会话内有效）"
              >
                <Bookmark size={13} strokeWidth={2} fill={bookmarks.some(b => b.msgId === msg.id) ? 'currentColor' : 'none'} />
              </button>
              </div>
            ))
          )}
        </div>

        {/* 一次性标记导航（右侧悬浮，会话级） */}
        {bookmarks.length > 0 && (
          <div className="chat-bookmark-nav">
            {bookmarks.map((b, i) => (
              <button key={b.msgId} onClick={() => jumpToBookmark(b.idx)} title={b.label}>
                {i + 1}
              </button>
            ))}
          </div>
        )}

        {/* 划词追问浮动按钮 */}
        {askFloat && (
          <div className="chat-ask-float" style={{ left: askFloat.x, top: askFloat.y, position: 'fixed', transform: 'translateX(-50%)' }}
            onClick={openAskPanel}>
            <MessageCircleQuestion size={13} strokeWidth={2} /> 追问
          </div>
        )}

        {/* 追问 sub-agent 面板 */}
        {askPanel && (
          <div className="chat-ask-panel">
            <div className="ask-panel-header">
              <span><MessageCircleQuestion size={14} strokeWidth={2} /> 追问</span>
              <button className="pkb-icon-btn" onClick={() => setAskPanel(null)}><X size={16} strokeWidth={2} /></button>
            </div>
            <div className="ask-panel-quote">{askPanel.quote}</div>
            <div className="ask-panel-messages">
              {askPanel.messages.map((m, i) => (
                <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'assistant'}`} style={{ fontSize: 12.5 }}>
                  <div className="msg-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                </div>
              ))}
              {askPanel.sending && <Loader2 size={16} className="spin-icon" />}
            </div>
            <div className="ask-panel-input">
              <textarea rows="1" placeholder="问点什么..." value={askInput}
                onChange={(e) => setAskInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askQuestion() } }} />
              <button onClick={askQuestion} disabled={askPanel.sending}>
                {askPanel.sending ? <Loader2 size={13} className="spin-icon" /> : <Send size={13} />}
              </button>
            </div>
          </div>
        )}

        {/* 对话沉淀笔记选择弹窗（一对多） */}
        {convNotes && (
          <div className="detail-modal-overlay" onClick={() => setConvNotes(null)}>
            <div className="conv-notes-modal" onClick={(e) => e.stopPropagation()}>
              <div className="conv-notes-header">
                <span><NotebookPen size={15} strokeWidth={2} /> 本对话沉淀的笔记（{convNotes.length} 篇）</span>
                <button className="pkb-icon-btn" onClick={() => setConvNotes(null)}><X size={16} strokeWidth={2} /></button>
              </div>
              <div className="conv-notes-list">
                {convNotes.map(n => (
                  <button key={n.id} className="conv-note-item" onClick={() => {
                    setConvNotes(null)
                    window.dispatchEvent(new CustomEvent('ice:switch-view', { detail: { view: 'notes' } }))
                    setTimeout(() => window.dispatchEvent(new CustomEvent('ice:goto-note', { detail: { id: n.id } })), 150)
                  }}>
                    <span className="conv-note-title">{n.title}</span>
                    {n.category && <span className="conv-note-cat">{n.category}</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 导航点悬停预览：fixed 定位，脱离轨道滚动容器的裁剪（right 锚定向左展开） */}
        {nodePreview && (
          <div className="chat-node-preview-float" style={{ right: nodePreview.right, top: nodePreview.y }}>
            {nodePreview.text.length > 260 ? nodePreview.text.slice(0, 260) + '…' : nodePreview.text}
          </div>
        )}

        {/* 回到底部浮动按钮 */}
        {showScrollBtn && hasChat && (
          <button className="scroll-bottom-btn" onClick={() => scrollToBottom(true)} title="回到底部">
            <ArrowDown size={16} strokeWidth={2.2} />
          </button>
        )}

        <ChatInputBar ref={inputBarRef} onSend={handleSend} isSending={isSending} onFileUpload={handleFileUpload} onImageSelect={handleImageFile} />
          {ctxStats && ctxStats.message_count > 0 && (() => {
            const pct = Math.min(100, ctxStats.usage_percent)
            const warn = ctxStats.usage_percent > 80
            const R = 8; const C = 2 * Math.PI * R
            const tokens = ctxStats.estimated_tokens > 1000
              ? (ctxStats.estimated_tokens / 1000).toFixed(1) + 'k'
              : String(ctxStats.estimated_tokens)
            return (
              <div className={`ctx-ring-wrap ${warn ? 'warn' : ''}`}>
                <svg width="20" height="20" viewBox="0 0 20 20" className="ctx-ring">
                  <circle cx="10" cy="10" r={R} fill="none" stroke="rgba(0,0,0,.08)" strokeWidth="2.5" />
                  <circle cx="10" cy="10" r={R} fill="none"
                    stroke={warn ? '#f59e0b' : 'currentColor'}
                    strokeWidth="2.5" strokeLinecap="round"
                    strokeDasharray={C}
                    strokeDashoffset={C - (C * pct) / 100}
                    transform="rotate(-90 10 10)"
                    className="ctx-ring-fill" />
                </svg>
                <span className="ctx-ring-tip">
                  {tokens} / 128k tokens ({ctxStats.usage_percent}%) · {ctxStats.message_count} 条
                </span>
              </div>
            )
          })()}
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
              {detailModal.loading ? (
                <div className="pkb-view-loading" style={{ minHeight: 160 }}>
                  <Loader2 size={18} strokeWidth={2.5} className="spin-icon" /> 加载原始数据...
                </div>
              ) : (
                <>
                  <RawJSONSection title="系统提示词 (System)" raw={extractSystemPrompt(detailModal.rawRequest)} asMarkdown />
                  <RawJSONSection title="请求 (Request)" raw={stripSystemPrompt(detailModal.rawRequest)} />
                  {detailModal.reasoning && (
                    <RawJSONSection title="推理过程 (Reasoning)" raw={detailModal.reasoning} asMarkdown />
                  )}
                  <RawJSONSection title="返回 (Response)" raw={detailModal.rawResponse} />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* === 原始数据查看辅助 === */

/** 从 rawRequest JSON 里提取 system 消息的 content（系统提示词本体） */
function extractSystemPrompt(raw) {
  try {
    const obj = JSON.parse(raw)
    const sys = (obj.messages || []).find(m => m.role === 'system')
    return sys ? sys.content : null
  } catch { return null }
}

/** 展示用：去掉 messages 里的 system 项（已单独在上方渲染），其余保持原样 */
function stripSystemPrompt(raw) {
  try {
    const obj = JSON.parse(raw)
    if (obj.messages && obj.messages[0]?.role === 'system') {
      obj.messages = [
        { role: 'system', content: `（系统提示词见上方，共 ${obj.messages[0].content.length} 字）` },
        ...obj.messages.slice(1),
      ]
    }
    return JSON.stringify(obj, null, 2)
  } catch { return raw }
}

/** JSON 语法高亮（单遍 tokenize，escape 每段防注入；非 JSON 原样返回 null） */
function highlightJSON(text) {
  let obj
  try { obj = JSON.parse(text) } catch { return null }
  const pretty = JSON.stringify(obj, null, 2)
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return pretty.replace(
    /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m, str, colon, bool, num) => {
      if (str) return colon ? `<span class="j-key">${esc(str)}</span>${colon}` : `<span class="j-str">${esc(str)}</span>`
      if (bool) return `<span class="j-bool">${bool}</span>`
      if (num) return `<span class="j-num">${num}</span>`
      return esc(m)
    },
  )
}

/** 一节原始数据：JSON 高亮 / Markdown 渲染（系统提示词）+ 复制按钮 */
function RawJSONSection({ title, raw, asMarkdown = false }) {
  const [copied, setCopied] = useState(false)
  if (!raw) return null
  const highlighted = asMarkdown ? null : highlightJSON(raw)
  const copy = () => {
    navigator.clipboard.writeText(raw)
      .then(() => { setCopied(true); toast('已复制', 'success'); setTimeout(() => setCopied(false), 1500) })
      .catch(() => toast('复制失败', 'error'))
  }
  return (
    <div className="detail-section">
      <h4>
        {title}
        <button className="detail-copy-btn" onClick={copy} title="复制原文">
          {copied ? <Check size={12} strokeWidth={2.4} /> : <Copy size={12} strokeWidth={2} />}
        </button>
      </h4>
      {asMarkdown ? (
        <div className="detail-system" dangerouslySetInnerHTML={{ __html: renderMarkdown(raw) }} />
      ) : highlighted ? (
        <pre className="detail-code dark" dangerouslySetInnerHTML={{ __html: highlighted }} />
      ) : (
        <pre className="detail-code">{raw}</pre>
      )}
    </div>
  )
}

/* === 对话历史项（支持拖拽排序、重命名、删除） === */
/* === 消息气泡（支持流式 + 思考过程 + 双击查看原始数据 + 单句删除） === */
const MessageBubble = memo(function MessageBubble({ msg, index, onConfirmSave, onDismissSave, onRetry, onShowDetail, onDelete, isLast }) {
  const isUser = msg.role === 'user'
  const [bubbleCopied, setBubbleCopied] = useState(false)

  // 头像 / 内容 / 操作栏三段渲染器 —— 壳由 @ant-design/x Bubble 提供
  // （placement 左右对齐、variant 气泡形态、加载态都是组件能力，不再手搓）
  const avatar = (
    <div className={`msg-avatar ${isUser ? 'user-avatar' : 'assistant-avatar'}`}>
      {isUser ? <User size={18} strokeWidth={2} /> : <Bot size={18} strokeWidth={2} />}
    </div>
  )

  if (msg.typing) {
    return (
      <Bubble className="msg assistant" placement="start" variant="borderless"
        avatar={avatar} content="" loading
        loadingRender={() => (
          <div className="msg-body"><div className="typing-indicator"><span></span><span></span><span></span></div></div>
        )}
      />
    )
  }

  const handleDoubleClick = () => {
    // 本会话消息直接用内存里的 raw；历史消息交给父组件按需拉取
    if (!isUser && (msg.rawRequest || msg.rawResponse || msg.messageId)) {
      onShowDetail?.(msg)
    }
  }

  const contentRender = () => (
    <div
      className="msg-body"
      onDoubleClick={handleDoubleClick}
      style={!isUser && (msg.rawRequest || msg.rawResponse || msg.messageId) ? { cursor: 'pointer' } : {}}
    >
      {msg.image && <img className="vision-image" src={msg.image} alt="用户上传" />}

      {/* 思维链（@ant-design/x ThoughtChain 组件）：工具抓取 + 思考过程 */}
      {!isUser && (() => {
        const items = []
        ;(msg.tools || []).forEach((t, ti) => items.push({
          key: `tool-${ti}`,
          icon: <Globe size={13} strokeWidth={2} />,
          title: '联网抓取',
          description: t.url || t.name,
          status: 'success',
        }))
        if (msg.reasoning) items.push({
          key: 'reasoning',
          icon: <Brain size={13} strokeWidth={2} />,
          title: msg.streaming ? '思考中…' : '思考过程',
          status: msg.streaming ? 'loading' : 'success',
          collapsible: true,
          content: <div className="tc-reasoning">{msg.reasoning}</div>,
        })
        return items.length > 0 ? (
          <ThoughtChain className="msg-thought-chain" items={items} size="small"
            collapsible={{ defaultExpandedKeys: [] }} />
        ) : null
      })()}

      {msg.content ? (
        isUser ? (
          // 用户消息：禁 HTML 透传，尖括号内容原样显示（防 <img>/<script> 被吞）
          <div dangerouslySetInnerHTML={{ __html: renderUserText(msg.content) }} />
        ) : (
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
        )
      ) : !msg.reasoning ? (
        <span className="msg-placeholder">...</span>
      ) : null}

      {msg.streaming && msg.content && <span className="stream-cursor" />}
      {!isUser && msg.streaming && <span className="msg-streaming-badge">生成中...</span>}

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
  )

  // hover 操作栏：复制 / 重新生成 / 删除（+ 双击详情提示）
  const hasActions =
    (msg.content && !msg.streaming) ||
    (msg.messageId && !msg.streaming && onDelete) ||
    (!isUser && isLast && !msg.streaming && !msg.aborted && msg.content && onRetry)
  const footer = hasActions ? () => (
    <div className={`msg-actions ${isUser ? 'end' : ''}`}>
      {!isUser && (msg.rawRequest || msg.rawResponse || msg.messageId) && (
        <span className="msg-detail-hint" title="双击查看原始请求/返回">双击查看详情</span>
      )}
      {/* 复制正文（不含思考过程）*/}
      {msg.content && !msg.streaming && (
        <button
          className={`msg-copy-btn ${bubbleCopied ? 'copied' : ''}`}
          title={isUser ? '复制这条消息' : '复制回复正文（不含思考过程）'}
          onClick={() => {
            copyText(msg.content).then((ok) => {
              if (!ok) return toast('复制失败', 'error')
              setBubbleCopied(true)
              setTimeout(() => setBubbleCopied(false), 1500)
            })
          }}
        >
          {bubbleCopied ? <Check size={11} strokeWidth={2.2} /> : <Copy size={11} strokeWidth={2} />}
        </button>
      )}
      {/* 重新生成：最后一条 AI 回复专属（中止的消息已有块内按钮）*/}
      {!isUser && isLast && !msg.streaming && !msg.aborted && msg.content && onRetry && (
        <button className="msg-retry-btn" title="重新生成这条回复"
          onClick={(e) => { e.stopPropagation(); onRetry() }}>
          <RotateCcw size={11} strokeWidth={2} />
        </button>
      )}
      {/* 单句删除：消息已入库（有服务端 id）且不在流式生成中才可删 */}
      {msg.messageId && !msg.streaming && onDelete && (
        <button className="msg-delete-btn" title="删除这条消息" onClick={onDelete}>
          <Trash2 size={11} strokeWidth={2} />
        </button>
      )}
    </div>
  ) : undefined

  return (
    <Bubble
      className={`msg ${isUser ? 'user' : 'assistant'}`}
      placement={isUser ? 'end' : 'start'}
      variant={isUser ? 'filled' : 'borderless'}
      avatar={avatar}
      content={msg.content}
      contentRender={contentRender}
      footer={footer}
    />
  )
})
