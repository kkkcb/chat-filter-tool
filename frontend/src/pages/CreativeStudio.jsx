import { useState } from 'react'
import { Lightbulb, Map, PenLine, Files } from 'lucide-react'
import InspireWorkshop from './InspireWorkshop'
import ArticleRoadmap from './ArticleRoadmap'
import WritingStudio from './WritingStudio'
import MaterialLibrary from './MaterialLibrary'
import './CreativeStudio.css'

const TABS = [
  { key: 'inspire', Icon: Lightbulb, label: '灵感' },
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
        {tab === 'inspire' && <InspireWorkshop />}
        {tab === 'roadmap' && <ArticleRoadmap />}
        {tab === 'writing' && <WritingStudio />}
        {tab === 'materials' && <MaterialLibrary />}
      </div>
    </div>
  )
}
