import { create } from 'zustand'
import { Check, AlertCircle, Info } from 'lucide-react'

/**
 * 轻量 Toast 通知 — 替代 alert() 的非阻塞反馈
 * 用法：import { toast } from '../components/Toast'
 *      toast('已复制'); toast('删除失败', 'error')
 */
const useToastStore = create((set) => ({
  toasts: [],
  add: (t) => set((s) => ({ toasts: [...s.toasts.slice(-4), t] })),
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

let nextToastId = 1

export function toast(message, type = 'info', duration = 2400) {
  const id = nextToastId++
  useToastStore.getState().add({ id, message, type })
  if (duration > 0) {
    setTimeout(() => useToastStore.getState().remove(id), duration)
  }
}

const ICONS = {
  success: Check,
  error: AlertCircle,
  info: Info,
}

export default function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)

  if (!toasts.length) return null

  return (
    <div className="toast-host">
      {toasts.map((t) => {
        const Icon = ICONS[t.type] || Info
        return (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <Icon size={14} strokeWidth={2.4} />
            <span>{t.message}</span>
          </div>
        )
      })}
    </div>
  )
}
