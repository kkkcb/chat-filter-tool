import { useState } from 'react'
import { Map, PenLine, Files } from 'lucide-react'
import RoadmapView from './RoadmapView'
import WritingStudio from './WritingStudio'
import Library from './Library'
import './CreativeStudio.css'

const TABS = [
  { key: 'roadmap', Icon: Map, label: '路线' },
  { key: 'writing', Icon: PenLine, label: '写作' },
  { key: 'materials', Icon: Files, label: '素材' },
]

export default function CreativeStudio() {
  const [tab, setTab] = useState('writing')

  return (
    <div className="cs-container">
      <div className="cs-tabs">
        {TABS.map(({ key, Icon, label }) => (
          <button
            key={key}
            className={`cs-tab ${tab === key ? 'active' : ''}`}
            onClick={() => setTab(key)}
          >
            <Icon size={15} strokeWidth={2} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="cs-content">
          {tab === 'roadmap' && <RoadmapView />}
        {tab === 'writing' && <WritingStudio />}
        {tab === 'materials' && <Library />}
      </div>
    </div>
  )
}
