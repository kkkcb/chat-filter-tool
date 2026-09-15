import { useState, useEffect, useRef } from 'react'
import { summarizeConversation } from '../api/notes'
import { toast } from './Toast'

/**
 * 输入框命令/引用自动补全面板（pi 式）：
 * - 输入 / 开头 → 斜杠命令面板（模糊过滤 + ↑↓ 选择 + Enter 确认）
 * - 输入 @xx → 笔记/素材引用面板，选中替换为 @标题（后端解析注入正文）
 * 由父组件通过 detect(text) 驱动，键盘事件经 handleKeyDown 拦截。
 */
export const SLASH_COMMANDS = [
  { cmd: '/总结为笔记', desc: '把当前对话沉淀为个人知识库笔记' },
  { cmd: '/深度思考', desc: '切换深度思考模式（更慢更深入）' },
  { cmd: '/引用知识库', desc: '切换回复时检索素材/笔记并引用' },
  { cmd: '/联网', desc: '切换联网抓取（模型可按需抓网页正文）' },
  { cmd: '/新对话', desc: '开启一个新对话' },
]

export default function InputPalette({
  mode,          // 'slash' | 'at' | null
  query,         // 过滤词（/或@后的文字）
  items,         // at 模式的候选项 [{label, sub}]
  index,         // 当前高亮序号
  onPick,        // 选中回调 (item) => void
  onClose,       // Esc 关闭
}) {
  const filtered = mode === 'slash'
    ? SLASH_COMMANDS.filter(c => c.cmd.slice(1).toLowerCase().includes((query || '').toLowerCase()))
    : (items || [])

  const pick = (item) => onPick(item)
  const onKey = (e) => {
    if (mode === null) return false
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return true }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      // 高亮移动由父组件管理（通过 window 自定义事件太绕——这里直接 DOM 高亮由 index prop 控，父组件在 keydown 里改 index）
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const item = filtered[index] || filtered[0]
      if (item) pick(item)
      return true
    }
    return false
  }
  // 把键盘拦截注册给父级：通过 ref 暴露
  const api = useRef({ onKey, filtered })
  api.current = { onKey, filtered }
  useEffect(() => { /* noop: 保持 ref 新鲜 */ })

  if (mode === null || filtered.length === 0) return null

  return (
    <div className="input-palette" data-mode={mode}>
      <div className="ip-head">{mode === 'slash' ? '命令' : '引用内容（笔记 / 素材）'}</div>
      <div className="ip-list">
        {filtered.map((item, i) => (
          <button
            key={item.cmd || item.label + i}
            className={`ip-item ${i === index ? 'active' : ''}`}
            onMouseEnter={() => {/* 高亮由 index 控制，悬停不抢 */ }}
            onClick={() => pick(item)}
          >
            {mode === 'slash' ? (
              <>
                <span className="ip-cmd">{item.cmd}</span>
                <span className="ip-desc">{item.desc}</span>
              </>
            ) : (
              <>
                <span className="ip-cmd">{item.label}</span>
                {item.sub && <span className="ip-desc">{item.sub}</span>}
              </>
            )}
          </button>
        ))}
      </div>
      <div className="ip-foot">↑↓ 选择 · Enter 确认 · Esc 关闭</div>
    </div>
  )
}

/** 面板键盘处理：供输入框 keydown 调用。返回 true 表示已拦截 */
export function paletteKeydown(mode, e, count, setIndex) {
  if (mode === null) return false
  if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, count - 1)); return true }
  if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); return true }
  return false
}
