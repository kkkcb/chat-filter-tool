import { create } from 'zustand'
import {
  getConversations, getConversation, createConversation,
  updateConversation, deleteConversation, reorderConversations,
} from '../api/conversations'

export const useConversationStore = create((set, get) => ({
  conversations: [],
  activeId: null,
  loading: false,

  loadConversations: async () => {
    set({ loading: true })
    try {
      const data = await getConversations()
      set({ conversations: data })
      // 如果没有活跃对话，自动选最近的
      if (!get().activeId && data.length > 0) {
        // 不自动加载，等用户点击
      }
    } catch { set({ conversations: [] }) }
    set({ loading: false })
  },

  selectConversation: async (id) => {
    set({ activeId: id })
    try {
      return await getConversation(id)
    } catch { return null }
  },

  newConversation: async () => {
    const conv = await createConversation('新对话')
    set(state => ({ conversations: [conv, ...state.conversations], activeId: conv.id }))
    return conv
  },

  renameConversation: async (id, title) => {
    // 乐观更新
    set(state => ({
      conversations: state.conversations.map(c =>
        c.id === id ? { ...c, title } : c
      ),
    }))
    try {
      await updateConversation(id, { title })
    } catch {
      // 失败回滚
      get().loadConversations()
    }
  },

  removeConversation: async (id) => {
    const wasActive = get().activeId === id
    set(state => ({
      conversations: state.conversations.filter(c => c.id !== id),
      activeId: wasActive ? null : state.activeId,
    }))
    // 删的是当前打开的会话：右侧消息区一并清空，回到新对话空态
    // （否则列表没了、消息还挂着已删会话的内容）
    if (wasActive) {
      const { useChatStore } = await import('./chatStore')
      useChatStore.getState().clearMessages()
    }
    try {
      await deleteConversation(id)
    } catch {}
  },

  reorder: async (orderedIds) => {
    // 乐观更新
    const map = new Map(orderedIds.map((id, idx) => [id, idx]))
    set(state => ({
      conversations: state.conversations
        .map(c => ({ ...c, position: map.get(c.id) ?? c.position }))
        .sort((a, b) => (a.position || 0) - (b.position || 0)),
    }))
    try {
      await reorderConversations(orderedIds)
    } catch {
      get().loadConversations()
    }
  },

  // 当新对话在 chat/stream 中创建后，刷新列表
  refreshAfterMessage: (conversationId) => {
    set({ activeId: conversationId })
    get().loadConversations()
  },

  clearActive: () => set({ activeId: null }),
}))
