import { useState, useEffect, useRef } from 'react'
import { KeyRound } from 'lucide-react'
import { setAccessToken } from '../api/client'
import './AccessGate.css'

// Promise 式令牌输入：request() 收到 401 时调用 askAccessToken()，
// 同一时刻只弹一个；确认后写入 localStorage 由请求层自动重试。
// invalid=true 表示上一次输入的令牌不对，弹窗会带错误提示。
let resolver = null
let notifyOpen = null

export function askAccessToken(invalid = false) {
  return new Promise((resolve) => {
    resolver = resolve
    notifyOpen?.(invalid)
  })
}

export default function AccessGateHost() {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    notifyOpen = (invalid) => {
      setValue('')
      setError(invalid ? '令牌无效，请重试' : '')
      setOpen(true)
    }
    return () => { notifyOpen = null }
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60)
  }, [open])

  const finish = (ok, token) => {
    setOpen(false)
    if (ok && token) setAccessToken(token)
    resolver?.(ok)
    resolver = null
  }

  const submit = () => {
    if (!value.trim()) { setError('请输入访问令牌'); return }
    finish(true, value.trim())
  }

  if (!open) return null

  return (
    <div className="agate-overlay" onClick={() => finish(false)}>
      <div className="agate" onClick={(e) => e.stopPropagation()}>
        <div className="agate-icon"><KeyRound size={20} strokeWidth={2} /></div>
        <h3>需要访问令牌</h3>
        <p>该服务已开启访问保护，请输入令牌继续（输入一次即可，之后自动携带）。</p>
        <input
          ref={inputRef}
          type="password"
          placeholder="访问令牌..."
          value={value}
          onChange={(e) => { setValue(e.target.value); setError('') }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          spellCheck={false}
        />
        {error && <span className="agate-error">{error}</span>}
        <div className="agate-btns">
          <button className="agate-btn ghost" onClick={() => finish(false)}>取消</button>
          <button className="agate-btn primary" onClick={submit}>确认</button>
        </div>
      </div>
    </div>
  )
}
