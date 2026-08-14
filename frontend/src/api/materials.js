import { request } from './client'

export const getMaterials = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return request(`/materials?${qs}`)
}

export const getMaterial = (id) => request(`/materials/${id}`)

export const getStats = () => request('/stats')

export const getCategories = () => request('/categories')

export const deleteMaterial = (id) =>
  request(`/materials/${id}`, { method: 'DELETE' })
