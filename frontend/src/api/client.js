const BASE = '/api'

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

export async function request(path, options = {}) {
  const resp = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!resp.ok) {
    const error = await resp.json().catch(() => ({}))
    throw new Error(extractError(error, resp.status))
  }
  return resp.json()
}

export async function uploadFile(file) {
  const formData = new FormData()
  formData.append('file', file)
  const resp = await fetch(`${BASE}/upload`, { method: 'POST', body: formData })
  if (!resp.ok) throw new Error('上传失败')
  return resp.json()
}
