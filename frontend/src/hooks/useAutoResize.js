import { useRef, useCallback, useEffect } from 'react'

/**
 * 自动调整 textarea 高度。
 *
 * 布局抖动修复：原实现 write(height=auto) → read(scrollHeight) → write(height)
 * 每键强制 2 次同步布局。改为 rAF 批处理 + dirty 标记。
 */
export function useAutoResize() {
  const ref = useRef(null)
  const rafRef = useRef(null)
  const lastHeightRef = useRef(0)

  const resize = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const el = ref.current
      if (!el) return
      const h = Math.min(el.scrollHeight, 120)
      if (h !== lastHeightRef.current) {
        lastHeightRef.current = h
        el.style.height = h + 'px'
      }
    })
  }, [])

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
  }, [])

  return { ref, resize }
}
