import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const md = new MarkdownIt({
  html: true,       // 允许我们自己生成的 HTML 标签
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

function protectSegments(text) {
  const segments = []

  // 先保护代码块 ```...```（必须在 inline code 之前）
  let result = text.replace(/```[\s\S]*?```/g, (match) => {
    const id = segments.length
    segments.push(match)
    return `${PH_START}${id}${PH_END}`
  })

  // 再保护 inline code: `code`
  result = result.replace(/`([^`]+)`/g, (_, content) => {
    const id = segments.length
    segments.push(`<code>${content}</code>`)
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
