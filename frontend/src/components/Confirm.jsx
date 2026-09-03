import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { AlertTriangle, HelpCircle } from 'lucide-react'

/**
 * 轻量确认弹窗 — 替代 window.confirm() 的应用内组件
 * 用法：const ok = await confirmDialog({ title, message, danger: true })
 *      ok 为 true 表示用户点了确认；取消/点遮罩/按 Esc 都返回 false
 */
const useConfirmStore = create((set) => ({
  dialog: null, // { title, message, confirmText, cancelText, danger, resolve }
  open: (options) => new Promise((resolve) => {
    set({ dialog: { cancelText: '取消', confirmText: '确认', danger: false, ...options, resolve } })
  }),
  close: (result) => {
    const d = useConfirmStore.getState().dialog
    d?.resolve?.(result)
    set({ dialog: null })
  },
}))

export function confirmDialog(options) {
  return useConfirmStore.getState().open(options)
}

export default function ConfirmHost() {
  const dialog = useConfirmStore((s) => s.dialog)
  const close = useConfirmStore((s) => s.close)
  const confirmBtnRef = useRef(null)

  useEffect(() => {
    if (!dialog) return
    confirmBtnRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') close(false)
      else if (e.key === 'Enter') close(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, close])

  if (!dialog) return null

  return (
    <div className="confirm-overlay" onClick={() => close(false)}>
      <div className="confirm-dialog" onClick={e => e.stopPropagation()} role="alertdialog">
        <div className={`confirm-icon ${dialog.danger ? 'danger' : 'info'}`}>
          {dialog.danger ? <AlertTriangle size={20} strokeWidth={2.2} /> : <HelpCircle size={20} strokeWidth={2.2} />}
        </div>
        <div className="confirm-title">{dialog.title}</div>
        {dialog.message && <div className="confirm-message">{dialog.message}</div>}
        <div className="confirm-btns">
          <button className="confirm-btn cancel" onClick={() => close(false)}>
            {dialog.cancelText}
          </button>
          <button
            ref={confirmBtnRef}
            className={`confirm-btn ok ${dialog.danger ? 'danger' : ''}`}
            onClick={() => close(true)}
          >
            {dialog.confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
