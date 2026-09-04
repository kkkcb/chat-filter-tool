import { request } from './client'

/** 笔记列表：{notes:[...], } 支持 q（搜索）与 tag 过滤 */
export const getNotes = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return request(`/notes?${qs}`)
}

export const getNote = (id) => request(`/notes/${id}`)

export const createNote = (data) =>
  request('/notes', { method: 'POST', body: JSON.stringify(data) })

export const updateNote = (id, data) =>
  request(`/notes/${id}`, { method: 'PUT', body: JSON.stringify(data) })

export const deleteNote = (id) =>
  request(`/notes/${id}`, { method: 'DELETE' })

/** 笔记统计：{total, tags:{标签:次数}} */
export const getNoteStats = () => request('/notes/stats')

/** 把对话总结成笔记：{conversation_id, instruction?} → {success, note} */
export const summarizeConversation = (conversationId, instruction = '') =>
  request('/notes/from-conversation', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId, instruction }),
  })

/** 分类管理（分类一等公民：新建/重命名/删除） */
export const getCategories = () => request('/notes/categories')

export const createCategory = (name) =>
  request('/notes/categories', { method: 'POST', body: JSON.stringify({ name }) })

export const renameCategory = (name, newName) =>
  request(`/notes/categories/${encodeURIComponent(name)}`, {
    method: 'PATCH', body: JSON.stringify({ new_name: newName }) })

export const deleteCategory = (name) =>
  request(`/notes/categories/${encodeURIComponent(name)}`, { method: 'DELETE' })
