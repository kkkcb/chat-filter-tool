import { useEffect } from 'react'

export function useImageDrop(ref, onImage) {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const onDragOver = (e) => { e.preventDefault() }
    const onDrop = (e) => {
      e.preventDefault()
      const files = e.dataTransfer?.files
      if (!files) return
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          onImage(file)
          break
        }
      }
    }

    el.addEventListener('dragover', onDragOver)
    el.addEventListener('drop', onDrop)
    return () => {
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('drop', onDrop)
    }
  }, [ref, onImage])
}
