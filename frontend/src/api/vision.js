import { request } from './client'

export const analyzeVision = (data) =>
  request('/vision', { method: 'POST', body: JSON.stringify(data) })

export const getPresets = () => request('/vision/presets')
