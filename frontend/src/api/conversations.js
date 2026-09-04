import { request } from './client'

export const getConversations = () => request('/conversations')

export const getConversation = (id) => request(`/conversations/${id}`)

/** 单条消息的原始请求/返回（双击消息时按需拉取） */
export const getMessage = (id) => request(`/messages/${id}`)

export const createConversation = (title = '新对话') =>
  request('/conversations', { method: 'POST', body: JSON.stringify({ title }) })

export const updateConversation = (id, { title, position }) => {
  const body = {}
  if (title !== undefined) body.title = title
  if (position !== undefined) body.position = position
  return request(`/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export const deleteConversation = (id) =>
  request(`/conversations/${id}`, { method: 'DELETE' })

export const reorderConversations = (orderedIds) =>
  request('/conversations/reorder', { method: 'POST', body: JSON.stringify({ ordered_ids: orderedIds }) })

/** 删除单条消息（聊天中单句删除） */
export const deleteMessage = (id) =>
  request(`/messages/${id}`, { method: 'DELETE' })
