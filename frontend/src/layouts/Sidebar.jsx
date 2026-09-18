import { useEffect } from 'react'
import { Snowflake, BookOpen, PenLine, MessagesSquare, MessageCircle, FlaskConical } from 'lucide-react'
import { useMaterialStore } from '../stores/materialStore'
import { useNoteStore } from '../stores/noteStore'
import './Sidebar.css'

export default function Sidebar({ currentView, onSwitch }) {
  const { stats, fetchStats } = useMaterialStore()
  const { stats: noteStats, loadStats: loadNoteStats } = useNoteStore()

  useEffect(() => {
    fetchStats()
    loadNoteStats()
    const timer = setInterval(() => { fetchStats(); loadNoteStats() }, 30000)
    return () => clearInterval(timer)
  }, [fetchStats, loadNoteStats])

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
        {/* 对话 */}
        <div
          className={`nav-item ${currentView === 'chat' ? 'active' : ''}`}
          onClick={() => onSwitch('chat')}
        >
          <span className="icon"><MessageCircle size={18} strokeWidth={2} /></span> 对话
        </div>

        {/* 知识库（笔记 + 素材融合，页内 Tab 切换） */}
        <div
          className={`nav-item ${currentView === 'notes' ? 'active' : ''}`}
          onClick={() => onSwitch('notes')}
        >
          <span className="icon"><BookOpen size={18} strokeWidth={2} /></span> 知识库
        </div>

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

        {/* 模型实验室（Agnes 免费模型） */}
        <div
          className={`nav-item ${currentView === 'lab' ? 'active' : ''}`}
          onClick={() => onSwitch('lab')}
        >
          <span className="icon"><FlaskConical size={18} strokeWidth={2} /></span> 模型实验室
        </div>
      </nav>

      <div className="sidebar-stats">
        <div className="stat-row"><span>素材</span><strong>{stats.total}</strong></div>
        <div className="stat-row"><span>笔记</span><strong>{noteStats.total}</strong></div>
      </div>
    </div>
  )
}
