import { useEffect, useRef, useState } from 'react'
import { Route, Loader2, Wand2, Save, Pencil, Eye } from 'lucide-react'
import { request } from '../api/client'
import NoteMarkdown from '../components/NoteMarkdown'
import { toast } from '../components/Toast'
import './RoadmapView.css'

/**
 * 文章路线（重构版）：路线 = 一篇 markdown 笔记（含 mermaid 矢量图）。
 - 展示：NoteMarkdown 渲染（GitHub 排版 + mermaid → SVG）
 - 自然语言修改：下指令 → GLM 修订 markdown（保持 mermaid 语法）→ 预览确认 → 保存回笔记
 - 手动编辑：直接改 markdown 源码
 数据不再是硬编码的 utils/articles.js，而是笔记库里 tag=roadmap 的文档。
 */
export default function RoadmapView() {
  const [note, setNote] = useState(null)        // {id, title, content}
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)  // 手动编辑模式
  const [draft, setDraft] = useState('')
  const [instruction, setInstruction] = useState('')
  const [revising, setRevising] = useState(false)
  const [revised, setRevised] = useState('')     // 修订预览稿
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)  // 重挂 NoteMarkdown 触发 mermaid 重渲
  const [zoomSvg, setZoomSvg] = useState('')      // 全屏查看的矢量图 outerHTML

  // 点击图表面板 → 全屏原尺寸查看（缩放图太小读不清时用）
  const openZoom = (e) => {
    const svg = e.currentTarget.querySelector('svg')
    if (!svg) return
    // 克隆进 overlay 的 svg 需要 width：有 viewBox 无 width 时按 0 宽渲染
    const clone = svg.cloneNode(true)
    const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/)
    if (vb.length === 4) clone.setAttribute('width', Math.round(parseFloat(vb[2])))
    setZoomSvg(clone.outerHTML)
  }

  useEffect(() => {
    setLoading(true)
    request('/notes?tag=roadmap&limit=1').then(async list => {
      const items = Array.isArray(list) ? list : (list.notes || list.items || [])
      if (items.length) {
        const full = await request(`/notes/${items[0].id}`)  // 列表仅摘要，拉全文
        setNote({ id: items[0].id, title: full.title, content: full.content || '' })
      }
    }).catch(() => toast('加载路线笔记失败', 'error')).finally(() => setLoading(false))
  }, [])

  const revise = async () => {
    if (!instruction.trim() || !note || revising) return
    setRevising(true)
    try {
      const d = await request('/notes/revise', {
        method: 'POST', body: JSON.stringify({ note_id: note.id, instruction: instruction.trim() }),
      })
      if (d.revised) { setRevised(d.revised); toast('已生成修订稿，预览确认后保存', 'success') }
    } catch (e) {
      toast(e?.message || '修订失败', 'error')
    } finally { setRevising(false) }
  }

  const save = async (content) => {
    if (!note || saving) return
    setSaving(true)
    try {
      await request(`/notes/${note.id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: note.title, content, category: '路线图', tags: ['roadmap'] }),
      })
      setNote(n => ({ ...n, content }))
      setRevised(''); setInstruction(''); setEditing(false); setDraft('')
      setReloadKey(k => k + 1)
      toast('路线已保存', 'success')
    } catch (e) {
      toast(e?.message || '保存失败', 'error')
    } finally { setSaving(false) }
  }

  if (loading) return <div className="rv-view"><div className="rv-loading"><Loader2 size={20} className="spin" /> 加载路线…</div></div>
  if (!note) return <div className="rv-view"><div className="rv-loading">未找到路线笔记（tag=roadmap）</div></div>

  return (
    <div className="rv-view">
      <div className="rv-header">
        <h2 className="header-title"><Route size={18} strokeWidth={2.2} /> {note.title}</h2>
        <div className="rv-actions">
          {!editing && !revised && (
            <button className="rv-btn" onClick={() => { setEditing(true); setDraft(revised || note.content) }}>
              <Pencil size={13} /> 编辑源码
            </button>
          )}
        </div>
      </div>

      {/* 自然语言修改指令行 */}
      <div className="rv-revise">
        <input value={instruction} onChange={e => setInstruction(e.target.value)}
          placeholder="用自然语言修改路线，如：把「幻觉」挪到阶段一 / 新增一个「实战篇」阶段 / 第 7 篇换个标题"
          onKeyDown={e => { if (e.key === 'Enter') revise() }} />
        <button className="rv-primary" onClick={revise} disabled={!instruction.trim() || revising}>
          {revising ? <><Loader2 size={13} className="spin" /> 修订中</> : <><Wand2 size={13} /> 按指令修改</>}
        </button>
      </div>

      {revised && (
        <div className="rv-preview">
          <div className="rv-preview-head">
            <span>修订预览（确认后写入路线）</span>
            <div className="rv-preview-btns">
              <button className="rv-btn" onClick={() => setRevised('')}>放弃</button>
              <button className="rv-primary" onClick={() => save(revised)} disabled={saving}>
                <Save size={13} /> {saving ? '保存中' : '采用并保存'}
              </button>
            </div>
          </div>
          <div className="rv-preview-meta">原 {note.content.length} 字 → 修订 {revised.length} 字</div>
          <NoteMarkdown key={'preview-' + revised.length} content={revised} onImageOpen={() => {}} />
        </div>
      )}

      {editing ? (
        <div className="rv-editor">
          <textarea value={draft} onChange={e => setDraft(e.target.value)} spellCheck={false} />
          <div className="rv-editor-btns">
            <button className="rv-btn" onClick={() => { setEditing(false); setDraft('') }}>取消</button>
            <button className="rv-primary" onClick={() => save(draft)} disabled={saving}>
              <Save size={13} /> {saving ? '保存中' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="rv-body">
            <div onClick={openZoom}><NoteMarkdown key={'roadmap-' + reloadKey + note.content.length} content={note.content} onImageOpen={() => {}} /></div>
          </div>
          {zoomSvg && (
            <div className="rv-zoom" onClick={() => setZoomSvg('')}>
              <div className="rv-zoom-inner" dangerouslySetInnerHTML={{ __html: zoomSvg }} onClick={e => e.stopPropagation()} />
              <div className="rv-zoom-hint">点击空白处关闭 · 滚动查看细节</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
