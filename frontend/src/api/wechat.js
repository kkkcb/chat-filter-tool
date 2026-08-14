/**
 * export_server (端口 5679) API 客户端
 * 跨域直连，CORS 已全通
 */
export const WX_BASE = 'http://localhost:5679'

function wxError(resp) {
  return `微信服务请求失败 (HTTP ${resp.status})`
}

/** 健康检测：服务是否在线 */
export async function checkOnline() {
  try {
    const resp = await fetch(`${WX_BASE}/api/stats`, { method: 'GET' })
    return resp.ok
  } catch {
    return false
  }
}

/** 统计：{total, groups, users} */
export async function getStats() {
  const resp = await fetch(`${WX_BASE}/api/stats`)
  if (!resp.ok) throw new Error(wxError(resp))
  return resp.json()
}

/** 联系人列表：{contacts:[{name,username,is_group,remark}], total, filtered} */
export async function getContacts(q = '', type = 'all', recent = 30) {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (type && type !== 'all') params.set('type', type)
  if (recent && recent > 0) params.set('recent', recent)
  const qs = params.toString()
  const resp = await fetch(`${WX_BASE}/api/contacts${qs ? '?' + qs : ''}`)
  if (!resp.ok) throw new Error(wxError(resp))
  return resp.json()
}

/** 发起导出：{names:[...], format:'html'|'json'|'both'} → {task_id, names} */
export async function exportChats(names, format = 'html') {
  const resp = await fetch(`${WX_BASE}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names, format }),
  })
  if (!resp.ok) throw new Error(wxError(resp))
  return resp.json()
}

/** 查询导出进度：{done, results:[{name,status,message_count,files,error}], total, completed} */
export async function getExportStatus(taskId) {
  const resp = await fetch(`${WX_BASE}/api/export_status/${taskId}`)
  if (!resp.ok) throw new Error(wxError(resp))
  return resp.json()
}

/** 下载文件 URL（用于 <a download>） */
export function downloadUrl(filename) {
  return `${WX_BASE}/api/download/${encodeURIComponent(filename)}`
}

/** 下载文件内容并解析为 JSON */
export async function fetchJsonFile(filename) {
  const resp = await fetch(downloadUrl(filename))
  if (!resp.ok) throw new Error(wxError(resp))
  const text = await resp.text()
  return JSON.parse(text)
}

/** 导出历史：{history:[{task_id,timestamp,results,format}]} */
export async function getHistory() {
  const resp = await fetch(`${WX_BASE}/api/history`)
  if (!resp.ok) throw new Error(wxError(resp))
  return resp.json()
}

/** 已导出文件列表：{files:[{name,size,modified}]} */
export async function getFiles() {
  const resp = await fetch(`${WX_BASE}/api/files`)
  if (!resp.ok) throw new Error(wxError(resp))
  return resp.json()
}

/** 轮询导出直到完成，返回最终状态；超过 timeoutMs 抛错，防止无限轮询 */
export async function pollExport(taskId, onProgress, interval = 800, timeoutMs = 10 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const status = await getExportStatus(taskId)
    onProgress?.(status)
    if (status.done) return status
    if (Date.now() > deadline) {
      throw new Error(`导出超时（超过 ${Math.round(timeoutMs / 60000)} 分钟），请检查微信导出服务`)
    }
    await new Promise(r => setTimeout(r, interval))
  }
}

/**
 * 获取某联系人的完整消息（预览/收入素材库的统一数据源）
 * 流程：export json → 轮询完成 → 下载 json → 解析
 * 返回 {chat, username, messages} 或抛错
 */
export async function fetchMessages(name, onProgress) {
  const { task_id } = await exportChats([name], 'json')
  const status = await pollExport(task_id, onProgress)

  // 从 results 找到 json 文件
  let jsonFile = null
  for (const r of status.results || []) {
    if (r.files && r.files.length > 0) {
      jsonFile = r.files.find(f => f.endsWith('.json')) || r.files[0]
      break
    }
  }
  if (!jsonFile) throw new Error('导出完成但未找到 JSON 文件')

  return await fetchJsonFile(jsonFile)
}
