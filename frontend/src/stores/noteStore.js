import { create } from 'zustand'
import {
  getNotes, getNoteStats, createNote, updateNote, deleteNote,
} from '../api/notes'

export const useNoteStore = create((set, get) => ({
  notes: [],
  stats: { total: 0, tags: {} },
  loading: false,

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

  /** 新建/编辑保存后刷新列表与统计 */
  refresh: async (params = {}) => {
    await Promise.all([get().loadNotes(params), get().loadStats()])
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
}))
