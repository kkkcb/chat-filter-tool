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

/** 更新素材（分类/标签/大纲概要） */
export const updateMaterial = (id, data) =>
  request(`/materials/${id}`, { method: 'PUT', body: JSON.stringify(data) })
