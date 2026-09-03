import { useState } from 'react'
import Sidebar from './Sidebar'
import KnowledgeBase from '../pages/KnowledgeBase'
import Library from '../pages/Library'
import PersonalKB from '../pages/PersonalKB'
import CreativeStudio from '../pages/CreativeStudio'
import WeChatExport from '../pages/WeChatExport'
import ToastHost from '../components/Toast'
import ConfirmHost from '../components/Confirm'
import './AppLayout.css'

export default function AppLayout() {
  const [view, setView] = useState('chat')

  return (
    <div className="app-layout">
      <Sidebar currentView={view} onSwitch={setView} />
      <main className="main-area">
        {/* key={view} 触发切换时的入场过渡动画 */}
        <div key={view} className="view-transition">
          {view === 'chat' && <KnowledgeBase />}
          {view === 'library' && <Library />}
          {view === 'notes' && <PersonalKB />}
          {view === 'studio' && <CreativeStudio />}
          {view === 'wechat' && <WeChatExport />}
        </div>
      </main>
      <ToastHost />
      <ConfirmHost />
    </div>
  )
}
