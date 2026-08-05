import { useState, useEffect } from 'react'
import { Files, Inbox, ExternalLink } from 'lucide-react'
import { getMaterials } from '../api/materials'
import './MaterialLibrary.css'

export default function MaterialLibrary() {
  const [materials, setMaterials] = useState([])
  const [category, setCategory] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadMaterials()
  }, [category])

  const loadMaterials = async () => {
    setLoading(true)
    try {
      const params = {}
      if (category) params.category = category
      const data = await getMaterials(params)
      setMaterials(data)
    } catch (e) {
      setMaterials([])
    }
    setLoading(false)
  }

  const categories = [
    'AI概念与原理', 'AI工具与产品', 'AI科普灵感',
    'GitHub项目', '行业资讯', '写作技巧', '待分类',
  ]
  const srcLabels = { github: 'GitHub', wechat: '公众号', web: '网页' }

  return (
    <div className="ml-view">
      <div className="ml-header">
        <h2 className="header-title"><Files size={18} strokeWidth={2.2} /> 素材库</h2>
        <p>管理你已收藏的所有素材</p>
      </div>
      <div className="ml-content">
        <div className="filter-bar">
          <div className={`filter-chip ${!category ? 'active' : ''}`} onClick={() => setCategory('')}>
            全部 ({materials.length})
          </div>
          {categories.map(cat => (
            <div
              key={cat}
              className={`filter-chip ${category === cat ? 'active' : ''}`}
              onClick={() => setCategory(cat)}
            >{cat}</div>
          ))}
        </div>

        {loading ? (
          <div className="ml-loading">加载中...</div>
        ) : materials.length === 0 ? (
          <div className="ml-empty">
            <div className="icon"><Inbox size={36} strokeWidth={1.5} /></div>
            <p>暂无素材，去知识库发送链接收藏吧</p>
          </div>
        ) : (
          <div className="material-list">
            {materials.map(m => (
              <div key={m.id} className="material-item fade-in">
                <div className="mi-main">
                  <div className="mi-title">{m.title}</div>
                  <div className="mi-summary">{m.summary || '暂无摘要'}</div>
                  <div className="mi-meta">
                    <span className={`lc-tag ${m.source}`}>{srcLabels[m.source] || '网页'}</span>
                    <span className="lc-tag category">{m.category}</span>
                    {m.tags?.map((t, i) => (
                      <span key={i} className="lc-tag" style={{ background:'var(--bg-muted)', color:'var(--text-muted)' }}>{t}</span>
                    ))}
                    {m.date && <span className="mi-date">{m.date.split('T')[0]}</span>}
                  </div>
                </div>
                {m.url && (
                  <a href={m.url} target="_blank" rel="noopener noreferrer" className="mi-link">
                    <ExternalLink size={16} strokeWidth={2} />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
