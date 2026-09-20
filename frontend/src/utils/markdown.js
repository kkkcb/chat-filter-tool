import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import katex from 'katex'
import remend from 'remend'
import 'katex/dist/katex.min.css'
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
// button 仅用于代码块复制（data-code-copy），无事件属性所以安全；
// style 需放行——KaTeX 公式的上下标堆叠靠内联 style 定位，剥掉会符号错位
// （现代浏览器 style 内不执行脚本，自有内容风险可控）
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'hr', 'strong', 'em', 'del', 's', 'code', 'pre',
    'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'div', 'sup', 'sub', 'button',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'target', 'rel', 'class', 'style', 'aria-hidden'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
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

/** LaTeX 数学公式 → KaTeX HTML（output:'html' 只产 span+class，MathML 不生成，
 *  消毒白名单天然放行）。上下标定位依赖内联 style，消毒层需放行 style 属性 */
function renderMathToHtml(tex, displayMode) {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode, output: 'html' })
  } catch {
    return `<code>${escapeHtml(tex)}</code>`
  }
}

/** 行内 $...$ 的误伤防线：内容必须含数学符号才算公式，
 *  否则「价格 $5，成本 $3」这类普通美元文本会被吞掉 */
const _MATHY = /[A-Za-z\\^_=+*/<>|,().-]/
function toMathPlaceholder(segments, tex, displayMode) {
  const id = segments.length
  segments.push(renderMathToHtml(tex, displayMode))
  return `${PH_START}${id}${PH_END}`
}

/** 数学公式保护：$$块级$$、$行内$、\(行内\)、\[块级\]。
 *  必须在代码块/行内代码之后、emphasis 修复之前——公式里的 _ * ~
 *  会被 fixInlineSyntax 当 Markdown 语法误伤，先换占位符隔离 */
function protectMath(text, segments) {
  // 块级：$$...$$（可跨行）与 \[...\]
  text = text.replace(/\$\$[ \t]*\n?([\s\S]+?)\n?[ \t]*\$\$/g, (_, tex) =>
    toMathPlaceholder(segments, tex.trim(), true))
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) =>
    toMathPlaceholder(segments, tex.trim(), true))
  // 行内：$...$（同行，非贪婪；两侧不贴空格 + 含数学符号）与 \(...\)
  text = text.replace(/\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$/g, (m, tex) =>
    _MATHY.test(tex) ? toMathPlaceholder(segments, tex, false) : m)
  text = text.replace(/\\\(([^)\n]+?)\\\)/g, (m, tex) =>
    _MATHY.test(tex) ? toMathPlaceholder(segments, tex, false) : m)
  return text
}

// 代码块渲染缓存：流式期间前端每 ~100ms 全量重渲染整条消息，已完成代码块
// 的高亮结果不会再变，命中缓存后重算只发生在正在生长的最后一个块上
// （streamdown 的块级稳定思路在自研管线里的等价实现）
const _fenceCache = new Map()
const _FENCE_CACHE_MAX = 300

function _renderFence(lang, code) {
  const key = `${lang}\u0000${code}`
  let html = _fenceCache.get(key)
  if (html === undefined) {
    let inner
    if (lang && hljs.getLanguage(lang)) {
      try {
        inner = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      } catch { inner = escapeHtml(code) }
    } else {
      inner = escapeHtml(code)
    }
    html = (
      `<div class="code-block${lang === 'mermaid' ? ' mermaid-source' : ''}"><button class="code-copy-btn">复制代码</button>`
      + `<pre class="hljs"><code class="language-${lang}">${inner}</code></pre></div>`
    )
    if (_fenceCache.size > _FENCE_CACHE_MAX) _fenceCache.clear()
    _fenceCache.set(key, html)
  }
  return html
}

function protectSegments(text) {
  const segments = []

  // 先保护代码块 ```lang\ncode\n```（必须在 inline code 之前）
  // 高亮在恢复阶段做（markdown-it 的 fence 规则见不到占位符）。
  // 外包 .code-block + 复制按钮：点击行为由 utils/clipboard.js 全局委托处理
  let result = text.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const id = segments.length
    segments.push(_renderFence((lang || '').trim(), code))
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

  // 最后保护数学公式（在代码之后：代码里的 $ 符号不算公式；
  // 在 emphasis 之前：公式里的 _ * 会被行内语法规则误伤）
  result = protectMath(result, segments)

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

/**
 * 提取大纲 — 与 renderMarkdown 的结构规则同源：
 * markdown #{2,4} 标题 + 独立成行的 XML 分节标签（渲染时转二级标题）。
 * 大纲侧栏必须用这个而不是自己正则 raw 文本，否则 XML 分节的笔记
 * （如提示词）大纲会漏掉主要章节。跳 fences 内的标题样文本。
 */
export function extractOutline(text, { maxLen = 24 } = {}) {
  if (!text) return []
  const out = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue }
    if (inFence) continue
    const t = line.trim()
    const open = t.match(/^<([^<>\/]+)>$/)
    if (open) {
      const name = open[1].trim().slice(0, maxLen)
      if (name) out.push({ level: 2, text: name, raw: t, isTag: true })
      continue
    }
    const m = t.match(/^(#{2,4})\s+(.+)/)
    if (m) {
      const h = m[2].trim().slice(0, maxLen)
      if (h) out.push({ level: m[1].length, text: h, raw: h })
    }
  }
  return out
}

export function renderMarkdown(text) {
  if (!text) return ''

  // 0. 流式容错（streamdown 同款思路，remend 即其终止逻辑独立版）：
  //    a) 块级代码围栏奇数 → 补闭合（remend 不处理块级围栏）。必须先补，
  //       remend 才能正确识别并跳过代码内容
  //    b) remend 补其余未闭合行内语法：**粗体、[链接、~~删除线、$$公式、
  //       未完成图片直接移除。完整内容零改动，美元金额不误伤（已实测）
  const fences = text.match(/^```/gm)
  if (fences && fences.length % 2 !== 0) text += '\n```'
  text = remend(text)

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
  // 公式同款渲染（用户粘贴 $$..$$ 时两侧显示一致）；其余仍禁 HTML 透传
  const segments = []
  const protectedText = protectMath(text, segments)
  let html = mdUser.render(protectedText)
  html = html.replace(new RegExp(`${PH_START}(\\d+)${PH_END}`, 'g'), (_, i) => segments[parseInt(i)])
  html = DOMPurify.sanitize(html, SANITIZE_CONFIG)
  return html
}
