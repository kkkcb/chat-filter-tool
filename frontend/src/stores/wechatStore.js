import { create } from 'zustand'
import {
  WX_BASE, checkOnline, getStats, getContacts,
  exportChats, pollExport, fetchMessages,
  getHistory, getFiles,
} from '../api/wechat'

// === localStorage 持久化 ===
const SAVED_KEY = 'wx_saved_contacts'
const HIDDEN_KEY = 'wx_hidden_contacts'

function loadSet(key) {
  try {
    const raw = localStorage.getItem(key)
    return new Set(raw ? JSON.parse(raw) : [])
  } catch { return new Set() }
}

function saveSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])) } catch {}
}

/** 联系人排序：按名称字母序，无名称的排最后 */
function sortContacts(list) {
  return [...list].sort((a, b) => {
    const na = a.name === a.username ? 1 : 0
    const nb = b.name === b.username ? 1 : 0
    if (na !== nb) return na - nb
    return a.name.localeCompare(b.name, 'zh-CN')
  })
}

export const useWeChatStore = create((set, get) => ({
  // 服务状态
  online: null,
  stats: null,
  checking: false,

  // 联系人
  contacts: [],
  query: '',
  typeFilter: 'all',
  loadingContacts: false,
  recentFilter: 30,
  hasSearched: false,

  // 收藏 & 隐藏（替代 pinned）
  savedNames: loadSet(SAVED_KEY),
  hiddenNames: loadSet(HIDDEN_KEY),

  // 右键菜单
  contextMenu: null,    // {x, y, name} 或 null

  // 选中态
  selectedNames: new Set(),
  activeContact: null,
  messages: [],
  loadingMessages: false,
  selectedMsgs: new Set(),

  // 导出
  exportFormat: 'both',
  exportTask: null,
  exporting: false,

  // 预览进度
  previewProgress: null,

  // 历史/文件
  history: [],
  files: [],
  loadingHistory: false,

  // === Actions ===

  checkOnlineStatus: async () => {
    set({ checking: true })
    const online = await checkOnline()
    set({ online, checking: false })
    if (online) {
      get().loadStats()
      get().loadContacts()
    }
    return online
  },

  loadStats: async () => {
    try {
      const stats = await getStats()
      set({ stats })
    } catch {}
  },

  loadContacts: async () => {
    const { query, typeFilter, recentFilter, savedNames, hiddenNames } = get()
    const q = query.trim()

    if (!q) {
      // 无搜索：只显示已收藏的联系人
      if (savedNames.size === 0) {
        set({ contacts: [], loadingContacts: false, hasSearched: false })
        return
      }
      set({ loadingContacts: true })
      try {
        // 拉全量，按收藏名单过滤（排除隐藏的）
        const data = await getContacts('', typeFilter, 0)
        const saved = (data.contacts || []).filter(c =>
          savedNames.has(c.name) && !hiddenNames.has(c.name)
        )
        set({ contacts: sortContacts(saved), loadingContacts: false, hasSearched: false })
      } catch {
        set({ contacts: [], loadingContacts: false })
      }
      return
    }

    // 有搜索：显示搜索结果（排除隐藏的）
    set({ loadingContacts: true, hasSearched: true })
    try {
      const data = await getContacts(query, typeFilter, recentFilter)
      const filtered = (data.contacts || []).filter(c => !hiddenNames.has(c.name))
      set({ contacts: sortContacts(filtered), loadingContacts: false, hasSearched: true })
    } catch {
      set({ contacts: [], loadingContacts: false, hasSearched: true })
    }
  },

  setRecentFilter: (days) => {
    set({ recentFilter: days })
    get().loadContacts()
  },

  setQuery: (query) => { set({ query }) },
  setTypeFilter: (typeFilter) => { set({ typeFilter }) },

  // 点击联系人 → 自动收藏
  setActive: (contact) => {
    const saved = new Set(get().savedNames)
    const wasNew = !saved.has(contact.name)
    saved.add(contact.name)
    if (wasNew) saveSet(SAVED_KEY, saved)

    set({
      activeContact: contact,
      messages: [],
      selectedMsgs: new Set(),
      previewProgress: null,
      savedNames: saved,
    })
  },

  // 右键隐藏
  hideContact: (name) => {
    const saved = new Set(get().savedNames)
    saved.delete(name)
    const hidden = new Set(get().hiddenNames)
    hidden.add(name)
    saveSet(SAVED_KEY, saved)
    saveSet(HIDDEN_KEY, hidden)
    set({ savedNames: saved, hiddenNames: hidden })
    get().loadContacts()
  },

  // 右键菜单
  openContextMenu: (x, y, name) => set({ contextMenu: { x, y, name } }),
  closeContextMenu: () => set({ contextMenu: null }),

  toggleSelect: (name) => {
    const next = new Set(get().selectedNames)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    set({ selectedNames: next })
  },

  clearSelected: () => set({ selectedNames: new Set() }),

  toggleSelectMsg: (idx) => {
    const next = new Set(get().selectedMsgs)
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    set({ selectedMsgs: next })
  },

  clearSelectedMsgs: () => set({ selectedMsgs: new Set() }),

  previewContact: async (contact) => {
    // 预览也自动收藏
    const saved = new Set(get().savedNames)
    const wasNew = !saved.has(contact.name)
    saved.add(contact.name)
    if (wasNew) saveSet(SAVED_KEY, saved)

    set({
      activeContact: contact,
      messages: [],
      selectedMsgs: new Set(),
      loadingMessages: true,
      previewProgress: null,
      savedNames: saved,
    })
    try {
      const data = await fetchMessages(contact.name, (status) => {
        set({ previewProgress: { completed: status.completed || 0, total: status.total || 1 } })
      })
      set({ messages: data.messages || [], loadingMessages: false, previewProgress: null })
    } catch (e) {
      set({ loadingMessages: false, previewProgress: null })
      throw e
    }
  },

  setExportFormat: (format) => set({ exportFormat: format }),

  exportSelected: async (names, format) => {
    const fmt = format || get().exportFormat
    const targets = names || Array.from(get().selectedNames)
    if (!targets.length) return

    set({ exporting: true, exportTask: { taskId: null, done: false, progress: 0 } })
    try {
      const { task_id } = await exportChats(targets, fmt)
      set({ exportTask: { taskId: task_id, done: false, progress: 0, results: [] } })

      const status = await pollExport(task_id, (s) => {
        const progress = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0
        set({ exportTask: { taskId: task_id, done: s.done, progress, results: s.results || [] } })
      })

      set({
        exporting: false,
        exportTask: { taskId: task_id, done: true, progress: 100, results: status.results || [] },
      })
      get().loadHistory()
      get().loadFiles()
      get().clearSelected()
    } catch (e) {
      set({ exporting: false, exportTask: null })
      throw e
    }
  },

  loadHistory: async () => {
    set({ loadingHistory: true })
    try {
      const data = await getHistory()
      set({ history: data.history || [], loadingHistory: false })
    } catch { set({ loadingHistory: false }) }
  },

  loadFiles: async () => {
    try {
      const data = await getFiles()
      set({ files: data.files || [] })
    } catch {}
  },

  reset: () => set({
    online: null, stats: null, contacts: [], query: '', typeFilter: 'all',
    selectedNames: new Set(), activeContact: null, messages: [], selectedMsgs: new Set(),
    exportTask: null, exporting: false, history: [], files: [],
  }),
}))
