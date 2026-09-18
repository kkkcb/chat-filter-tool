import { useState, useEffect } from 'react'
import Sidebar from './Sidebar'
import KnowledgeBase from '../pages/KnowledgeBase'
import PersonalKB from '../pages/PersonalKB'
import CreativeStudio from '../pages/CreativeStudio'
import WeChatExport from '../pages/WeChatExport'
import ModelLab from '../pages/ModelLab'
import ToastHost from '../components/Toast'
import ConfirmHost from '../components/Confirm'
import AccessGateHost from '../components/AccessGate'
import './AppLayout.css'

export default function AppLayout() {
  const [view, setView] = useState('chat')

  // 接收跨页跳转的视图切换事件
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.view) setView(e.detail.view)
    }
    window.addEventListener('ice:switch-view', handler)
    return () => window.removeEventListener('ice:switch-view', handler)
  }, [])

  return (
    <div className="app-layout">
      <Sidebar currentView={view} onSwitch={setView} />
      <main className="main-area">
        {/* key={view} 触发切换时的入场过渡动画 */}
        <div key={view} className="view-transition">
          {view === 'chat' && <KnowledgeBase />}
          {view === 'notes' && <PersonalKB />}
          {view === 'studio' && <CreativeStudio />}
          {view === 'wechat' && <WeChatExport />}
          {view === 'lab' && <ModelLab />}
        </div>
      </main>
      <ToastHost />
      <ConfirmHost />
      <AccessGateHost />
    </div>
  )
}
