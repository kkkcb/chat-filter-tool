import { request } from './client'

export const sendChat = (data) =>
  request('/chat', { method: 'POST', body: JSON.stringify(data) })

export const confirmSave = (entry) =>
  request('/chat/confirm-save', { method: 'POST', body: JSON.stringify({ entry }) })
