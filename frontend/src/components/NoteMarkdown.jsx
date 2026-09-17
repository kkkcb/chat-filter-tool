import { memo, useMemo, useRef } from 'react'
import { renderMarkdown } from '../utils/markdown'
import { useMermaid } from '../utils/mermaidMount'
import 'github-markdown-css/github-markdown-light.css'
import './NoteMarkdown.css'

// 图表增强会修改正文 DOM；父弹窗的元数据更新不应重新写入 innerHTML。
// 阅读排版用 github-markdown-css（.markdown-body 作用域，只影响笔记阅读区，
// 不污染聊天页）；ICE 的 KaTeX/Mermaid/代码块样式在后加载可覆盖冲突项。
const NoteMarkdown = memo(function NoteMarkdown({ content, onImageOpen }) {
  const ref = useRef(null)
  const html = useMemo(() => ({ __html: renderMarkdown(content) }), [content])
  useMermaid(ref, [content])
  return <div ref={ref} className="pkb-view-content markdown-body"
    onClick={event => { if (event.target.tagName === 'IMG') onImageOpen(event.target.src) }}
    dangerouslySetInnerHTML={html} />
})

export default NoteMarkdown
