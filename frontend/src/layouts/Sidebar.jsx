import { useState, useEffect } from 'react'
import { Snowflake, BookOpen, PenLine, Library, MessageCircle, MessagesSquare } from 'lucide-react'
import { useMaterialStore } from '../stores/materialStore'
import './Sidebar.css'

export default function Sidebar({ currentView, onSwitch }) {
  const { stats, fetchStats } = useMaterialStore()
  const [kbExpanded, setKbExpanded] = useState(true)

  useEffect(() => {
    fetchStats()
    const timer = setInterval(fetchStats, 30000)
    return () => clearInterval(timer)
  }, [fetchStats])

  const isKBSub = ['chat', 'library'].includes(currentView)

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <span className="logo-mark"><Snowflake size={20} strokeWidth={2.5} /></span>
          <span className="logo-text">ICE</span>
        </div>
        <div className="subtitle">ZERO° · AI 创作引擎</div>
      </div>

      <nav className="nav">
        {/* 知识库分组 */}
        <div
          className={`nav-group ${isKBSub ? 'active-group' : ''}`}
          onClick={() => setKbExpanded(!kbExpanded)}
        >
          <div className="nav-item nav-group-title">
            <span className="icon"><BookOpen size={18} strokeWidth={2} /></span>
            <span>知识库</span>
            <span className={`nav-group-arrow ${kbExpanded ? 'expanded' : ''}`}>▸</span>
          </div>
        </div>

        {kbExpanded && (
          <div className="nav-sub-items">
            <div
              className={`nav-item nav-sub ${currentView === 'library' ? 'active' : ''}`}
              onClick={() => onSwitch('library')}
            >
              <span className="icon"><Library size={16} strokeWidth={2} /></span> 素材库
            </div>
            <div
              className={`nav-item nav-sub ${currentView === 'chat' ? 'active' : ''}`}
              onClick={() => onSwitch('chat')}
            >
              <span className="icon"><MessageCircle size={16} strokeWidth={2} /></span> 对话
            </div>
          </div>
        )}

        {/* 创作区 */}
        <div
          className={`nav-item ${currentView === 'studio' ? 'active' : ''}`}
          onClick={() => onSwitch('studio')}
        >
          <span className="icon"><PenLine size={18} strokeWidth={2} /></span> 创作区
        </div>

        {/* 微信记录 */}
        <div
          className={`nav-item ${currentView === 'wechat' ? 'active' : ''}`}
          onClick={() => onSwitch('wechat')}
        >
          <span className="icon"><MessagesSquare size={18} strokeWidth={2} /></span> 微信记录
        </div>
      </nav>

      <div className="sidebar-stats">
        <div className="stat-row"><span>素材总数</span><strong>{stats.total}</strong></div>
        <div className="stat-row"><span>分类数</span><strong>{Object.keys(stats.categories).length}</strong></div>
      </div>
    </div>
  )
}
