import { useState } from 'react'
import Sidebar from './Sidebar'
import KnowledgeBase from '../pages/KnowledgeBase'
import Library from '../pages/Library'
import CreativeStudio from '../pages/CreativeStudio'
import WeChatExport from '../pages/WeChatExport'
import './AppLayout.css'

export default function AppLayout() {
  const [view, setView] = useState('chat')

  return (
    <div className="app-layout">
      <Sidebar currentView={view} onSwitch={setView} />
      <main className="main-area">
        {view === 'chat' && <KnowledgeBase />}
        {view === 'library' && <Library />}
        {view === 'studio' && <CreativeStudio />}
        {view === 'wechat' && <WeChatExport />}
      </main>
    </div>
  )
}
