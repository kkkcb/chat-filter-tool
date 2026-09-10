import { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Markdown } from 'tiptap-markdown'
import Placeholder from '@tiptap/extension-placeholder'
import { uploadNoteImage } from '../api/notes'
import { toast } from './Toast'
import './TiptapEditor.css'

/**
 * 飞书式所见即所得笔记编辑器（Tiptap）：
 * - 输入 # / ## / 1. / - / > 后敲空格，当前行立即变标题/列表/引用
 * - 内容以 Markdown 进出（笔记存储格式不变）
 * - 粘贴图片自动上传插入
 */
export default function TiptapEditor({ value, onChange, onReady, placeholder }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
      }),
      Image.configure({ inline: false }),
      Placeholder.configure({ placeholder: placeholder || '' }),
      Markdown.configure({
        html: false,
        breaks: true,
        transformPastedText: true,
      }),
    ],
    content: value || '',
    autofocus: 'end',
    editorProps: {
      attributes: {
        class: 'tp-editor-area',
        'data-placeholder': placeholder || '',
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items || []
        for (const item of items) {
          if (!item.type.startsWith('image/')) continue
          const file = item.getAsFile()
          if (!file) continue
          event.preventDefault()
          toast('图片上传中...', 'info', 1500)
          uploadNoteImage(file)
            .then(({ url }) => {
              editor.chain().focus().setImage({ src: url }).run()
              toast('图片已插入', 'success')
            })
            .catch((e) => toast(e?.message || '图片上传失败', 'error'))
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor }) => {
      onChange?.(editor.storage.markdown.getMarkdown())
    },
  })

  // 外部值变化（打开笔记/采用润色结果）→ 同步进编辑器
  useEffect(() => {
    if (!editor || value === undefined) return
    const current = editor.storage.markdown.getMarkdown()
    if (value !== current) {
      editor.commands.setContent(value || '')
    }
  }, [value, editor])

  useEffect(() => {
    if (editor && onReady) onReady(editor)
  }, [editor, onReady])

  if (!editor) return <div className="tp-loading">编辑器加载中...</div>

  return <EditorContent editor={editor} className="tp-editor" />
}
