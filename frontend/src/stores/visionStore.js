import { create } from 'zustand'

export const useVisionStore = create((set) => ({
  selectedImage: null,
  selectedMode: 'describe',

  setImage: (image) => set({ selectedImage: image }),
  setMode: (mode) => set({ selectedMode: mode }),
  clear: () => set({ selectedImage: null }),
}))
