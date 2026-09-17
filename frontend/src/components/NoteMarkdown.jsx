import { memo, useMemo, useRef } from 'react'
import { renderMarkdown } from '../utils/markdown'
import { useMermaid } from '../utils/mermaidMount'
import './NoteMarkdown.css'

// 图表增强会修改正文 DOM；父弹窗的元数据更新不应重新写入 innerHTML。
const NoteMarkdown = memo(function NoteMarkdown({ content, onImageOpen }) {
  const ref = useRef(null)
  const html = useMemo(() => ({ __html: renderMarkdown(content) }), [content])
  useMermaid(ref, [content])
  return <div ref={ref} className="pkb-view-content"
    onClick={event => { if (event.target.tagName === 'IMG') onImageOpen(event.target.src) }}
    dangerouslySetInnerHTML={html} />
})

export default NoteMarkdown
