import { create } from 'zustand'
import {
  getNotes, getNoteStats, createNote, updateNote, deleteNote,
  createCategory, renameCategory, deleteCategory,
} from '../api/notes'

export const useNoteStore = create((set, get) => ({
  notes: [],
  stats: { total: 0, tags: {} },
  loading: false,
  filter: {},   // 当前列表过滤（q/tag/category）——保存/删除后刷新保持所在视图

  loadNotes: async (params = {}) => {
    set({ loading: true })
    try {
      const notes = await getNotes(params)
      set({ notes, loading: false })
    } catch {
      set({ notes: [], loading: false })
    }
  },

  loadStats: async () => {
    try {
      const stats = await getNoteStats()
      set({ stats })
    } catch {}
  },

  /** 新建/编辑保存后刷新列表与统计 — 保持用户当前所在分类/标签/搜索视图 */
  refresh: async (params) => {
    const filter = params !== undefined ? params : get().filter
    set({ filter })
    await Promise.all([get().loadNotes(filter), get().loadStats()])
  },

  saveNote: async (data, id = null) => {
    const saved = id
      ? await updateNote(id, data)
      : await createNote(data)
    await get().refresh()
    return saved
  },

  removeNote: async (id) => {
    await deleteNote(id)
    await get().refresh()
  },

  // ===== 分类管理 =====

  newCategory: async (name) => {
    await createCategory(name)
    await get().loadStats()
  },

  doRenameCategory: async (name, newName) => {
    await renameCategory(name, newName)
    await get().refresh()
  },

  doDeleteCategory: async (name) => {
    await deleteCategory(name)
    await get().refresh()
  },
}))
