import { request } from './client'

export const inspire = (data) =>
  request('/inspire', { method: 'POST', body: JSON.stringify(data) })
