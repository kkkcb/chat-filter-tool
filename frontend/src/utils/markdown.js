import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', javascript)
hljs.registerLanguage('ts', javascript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('sql', sql)

const md = new MarkdownIt({
  html: true,       // 允许我们自己生成的 HTML 标签
  breaks: true,
  linkify: true,
  typographer: false,
})

// 用户消息专用：禁 HTML 透传——用户输入的 <img>/<script> 等尖括号内容
// 必须原样显示为文本，不能被解释/吞掉（同渲染器曾把用户消息里的
// "<img>/<script>" 吃得只剩一个斜杠）
const mdUser = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: false,
})

// 所有链接新窗口打开
const defaultLinkOpen = md.renderer.rules.link_open || function(tokens, idx, options, env, self) {
  return self.renderToken(tokens, idx, options)
}
md.renderer.rules.link_open = function(tokens, idx, options, env, self) {
  const targetIdx = tokens[idx].attrIndex('target')
  if (targetIdx < 0) {
    tokens[idx].attrPush(['target', '_blank'])
    tokens[idx].attrPush(['rel', 'noopener noreferrer'])
  } else {
    tokens[idx].attrs[targetIdx][1] = '_blank'
  }
  return defaultLinkOpen(tokens, idx, options, env, self)
}

// DOMPurify 配置：允许常见 Markdown 标签，禁止所有事件属性和危险标签
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'hr', 'strong', 'em', 'del', 's', 'code', 'pre',
    'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'div', 'sup', 'sub',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'target', 'rel', 'class'],
  FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'style'],
  ALLOW_DATA_ATTR: false,
}

/**
 * 保护 inline code 和代码块，避免被 emphasis 预处理误伤
 * 使用 Unicode 私用区字符（U+E000~U+F8FF）做定界符，不会被 DOMPurify 移除
 */
const PH_START = '\uE000'  // 私用区起始字符
const PH_END = '\uE001'    // 私用区结束字符

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function protectSegments(text) {
  const segments = []

  // 先保护代码块 ```lang\ncode\n```（必须在 inline code 之前）
  // 高亮在恢复阶段做（markdown-it 的 fence 规则见不到占位符）
  let result = text.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const id = segments.length
    const language = (lang || '').trim()
    let inner
    if (language && hljs.getLanguage(language)) {
      try {
        inner = hljs.highlight(code, { language, ignoreIllegals: true }).value
      } catch { inner = escapeHtml(code) }
    } else {
      inner = escapeHtml(code)
    }
    segments.push(`<pre class="hljs"><code class="language-${language}">${inner}</code></pre>`)
    return `${PH_START}${id}${PH_END}`
  })

  // 再保护 inline code: `code`
  // 内容必须 HTML 转义——`<img>` 这类标签字样若不转义，拼出的
  // <code><img></code> 会被消毒层当真实 img 标签，文本丢失
  result = result.replace(/`([^`]+)`/g, (_, content) => {
    const id = segments.length
    segments.push(`<code>${escapeHtml(content)}</code>`)
    return `${PH_START}${id}${PH_END}`
  })

  return {
    text: result,
    restore: (html) => html.replace(new RegExp(`${PH_START}(\\d+)${PH_END}`, 'g'), (_, i) => segments[parseInt(i)]),
  }
}

/**
 * 预处理 emphasis 和 strikethrough 语法
 * 绕过 CommonMark 对中文全角标点的边界判定 bug
 * 影响的语法：**bold**, *italic*, _italic_, ~~strikethrough~~
 */
function fixInlineSyntax(text) {
  // 1. **bold** → <strong>bold</strong>
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')

  // 2. *italic* → <em>italic</em>（在 ** 已被替换后处理剩余的单个 *）
  //    要求 * 两侧不能紧邻空白，内容首字符不能是 *
  text = text.replace(/(?<!\s)\*([^\s*][^*\n]*?)\*(?!\s)/g, '<em>$1</em>')

  // 3. _italic_ → <em>italic</em>（下划线风格斜体，同样的 bug）
  //    要求两侧不能紧邻字母/数字/下划线（避免 snake_case 被误伤）
  text = text.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '<em>$1</em>')

  // 4. ~~strikethrough~~ → <del>strikethrough</del>（GFM 删除线，同样的 bug）
  //    要求 ~~ 两侧不能紧邻空白
  text = text.replace(/(?<!\s)~~([^~\n]+?)~~(?!\s)/g, '<del>$1</del>')

  return text
}

/**
 * 自定义标签分节 → markdown 标题
 * 提示词笔记常用 <角色>、<回复逻辑> 这类 XML 风格标签做分节——markdown-it
 * 不认识它们，DOMPurify 消毒时会静默剥掉，整篇结构糊成一坨。独立成行的
 * 开标签转成二级标题，闭标签整行删除。须在 protectSegments 之后调用
 * （代码块已被占位符替换，块内的标签样文本不会被误转）。
 */
function convertCustomTags(text) {
  return text
    .split('\n')
    .map((line) => {
      const t = line.trim()
      if (/^<\/[^<>\/]+>$/.test(t)) return ''
      const open = t.match(/^<([^<>\/]+)>$/)
      if (open) return `## ${open[1].trim()}`
      return line
    })
    .join('\n')
}

export function renderMarkdown(text) {
  if (!text) return ''

  // 1. 保护 code 和已有 HTML
  const { text: protectedText, restore } = protectSegments(text)

  // 2. 自定义标签分节转标题（提示词类笔记的结构恢复）
  const tagged = convertCustomTags(protectedText)

  // 3. 修复 emphasis / strikethrough 语法（中文标点兼容）
  const fixed = fixInlineSyntax(tagged)

  // 4. 用 markdown-it 渲染
  let html = md.render(fixed)

  // 5. 恢复保护的片段
  html = restore(html)

  // 6. XSS 消毒：移除所有危险标签和属性
  html = DOMPurify.sanitize(html, SANITIZE_CONFIG)

  return html
}

/** 用户消息渲染：禁 HTML 透传（尖括号内容原样显示），仍保留换行/链接识别 */
export function renderUserText(text) {
  if (!text) return ''
  let html = mdUser.render(text)
  html = DOMPurify.sanitize(html, SANITIZE_CONFIG)
  return html
}
