// 统一 API 客户端：支持部署形态（VITE_API_BASE 指向线上后端）与全局访问令牌
const API_BASE = import.meta.env.VITE_API_BASE || ''
const BASE = `${API_BASE}/api`
const TOKEN_KEY = 'app_access_token'

export function getAccessToken() {
  try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' }
}

export function setAccessToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {}
}

function extractError(error, status) {
  // FastAPI 验证错误: { detail: [{ msg: "..." }] }
  if (Array.isArray(error?.detail)) {
    return error.detail.map(e => e.msg || JSON.stringify(e)).join('; ')
  }
  // 普通错误: { detail: "msg" } 或 { error: "msg" }
  if (typeof error?.detail === 'string') return error.detail
  if (typeof error?.error === 'string') return error.error
  if (typeof error?.message === 'string') return error.message
  return `HTTP ${status}`
}

// 401 时弹令牌输入（应用内样式，非浏览器原生）；同一时刻只弹一个
let gatePromise = null
function askAccessToken() {
  if (!gatePromise) {
    gatePromise = import('../components/AccessGate')
      .then(m => m.askAccessToken())
      .finally(() => { gatePromise = null })
  }
  return gatePromise
}

function authHeaders(extra) {
  const headers = { 'Content-Type': 'application/json', ...(extra || {}) }
  const token = getAccessToken()
  if (token) headers['X-Access-Token'] = token
  return headers
}

export async function request(path, options = {}) {
  let first = true
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const resp = await fetch(`${BASE}${path}`, { ...options, headers: authHeaders(options.headers) })
    if (resp.status !== 401) {
      if (!resp.ok) {
        const error = await resp.json().catch(() => ({}))
        throw new Error(extractError(error, resp.status))
      }
      return resp.json()
    }
    // 401 → 弹令牌输入；输错会带着"令牌无效"提示重弹，取消才放弃
    const ok = await askAccessToken(!first)
    if (!ok) {
      throw new Error('需要访问令牌')
    }
    first = false
  }
}

export async function uploadFile(file) {
  const formData = new FormData()
  formData.append('file', file)
  const resp = await fetch(`${BASE}/upload`, {
    method: 'POST',
    body: formData,
    headers: (() => {
      const h = {}
      const token = getAccessToken()
      if (token) h['X-Access-Token'] = token
      return h
    })(),
  })
  if (!resp.ok) throw new Error('上传失败')
  return resp.json()
}
