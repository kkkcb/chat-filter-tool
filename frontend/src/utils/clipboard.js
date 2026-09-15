/**
 * 剪贴板工具 + 代码块复制的全局事件委托
 *
 * navigator.clipboard 只在安全上下文（https / localhost）可用——
 * VPS 以 http://IP 访问时它是 undefined，必须走 execCommand 兜底。
 */

export function copyText(text) {
  return new Promise((resolve) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text)
        .then(() => resolve(true))
        .catch(() => resolve(_legacyCopy(text)))
    } else {
      resolve(_legacyCopy(text))
    }
  })
}

function _legacyCopy(text) {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;top:-999px;opacity:0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/**
 * 装一次（main.jsx）：给所有 markdown 渲染出来的代码块复制按钮
 * 提供点击复制。按钮是 innerHTML 的一部分（无法绑 React 事件），
 * 全局委托让聊天气泡 / 笔记阅读态 / 创作区预览全部自动生效。
 * 注意选择器只能用 class——markdown.js 的消毒配置 ALLOW_DATA_ATTR:false
 * 会把 data-* 属性全部剥掉。
 */
export function installCodeCopy() {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.code-copy-btn')
    if (!btn) return
    const code = btn.closest('.code-block')?.querySelector('pre code')
    if (!code) return
    const ok = await copyText(code.textContent || '')
    const original = btn.textContent
    btn.textContent = ok ? '已复制' : '复制失败'
    btn.classList.toggle('copied', ok)
    setTimeout(() => {
      btn.textContent = original
      btn.classList.remove('copied')
    }, 1500)
  })
}
