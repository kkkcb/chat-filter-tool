import { create } from 'zustand'
import { getStats } from '../api/materials'

export const useMaterialStore = create((set) => ({
  stats: { total: 0, categories: {}, recent: [] },

  fetchStats: async () => {
    try {
      const data = await getStats()
      set({ stats: data })
    } catch {}
  },
}))
