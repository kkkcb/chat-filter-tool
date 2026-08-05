import { useState } from 'react'
import { Route, Lightbulb } from 'lucide-react'
import { ARTICLES, PHASES } from '../utils/articles'
import './ArticleRoadmap.css'

export default function ArticleRoadmap() {
  const [expanded, setExpanded] = useState(null)

  return (
    <div className="ar-view">
      <div className="ar-header">
        <h2 className="header-title"><Route size={18} strokeWidth={2.2} /> 文章路线</h2>
        <p>20 篇文章 · 6 个阶段 · 认知科学驱动的一文一概念系列</p>
      </div>
      <div className="ar-content">
        {/* 阶段总览条 */}
        <div className="phase-overview">
          {PHASES.map((p, i) => {
            const count = ARTICLES.filter(a => a.phase === p.name).length
            return (
              <div key={i} className="phase-bar" style={{ borderColor: p.color }}>
                <div className="phase-dot" style={{ background: p.color }} />
                <span className="phase-name">{p.name}</span>
                <span className="phase-count">{count} 篇</span>
              </div>
            )
          })}
        </div>

        {/* 按阶段分组展示 */}
        {PHASES.map((phase, pi) => {
          const articles = ARTICLES.filter(a => a.phase === phase.name)
          if (!articles.length) return null
          return (
            <div key={pi} className="phase-section">
              <div className="phase-header">
                <span className="phase-badge" style={{ background: phase.color }}>{phase.name}</span>
                <span className="phase-desc">{phase.desc}</span>
              </div>
              <div className="article-cards">
                {articles.map((a) => {
                  const idx = a.seq
                  const isOpen = expanded === idx
                  return (
                    <div
                      key={idx}
                      className={`article-card ${isOpen ? 'expanded' : ''}`}
                      onClick={() => setExpanded(isOpen ? null : idx)}
                    >
                      <div className="ac-left">
                        <div className="ac-num" style={{ background: phase.color }}>{idx}</div>
                      </div>
                      <div className="ac-body">
                        <div className="ac-stage">{a.stage}</div>
                        <div className="ac-title">{a.title}</div>
                        <div className="ac-concepts">
                          {a.concepts.map((c, i) => (
                            <span key={i} className="concept-tag">{c}</span>
                          ))}
                        </div>
                        <div className="ac-metaphor">
                          <span className="ac-metaphor-icon"><Lightbulb size={13} strokeWidth={2} /></span>
                          {a.metaphor}
                        </div>

                        {isOpen && (
                          <div className="ac-detail">
                            <div className="detail-row">
                              <span className="detail-label">概念</span>
                              <span>{a.concept}</span>
                            </div>
                            <div className="detail-row">
                              <span className="detail-label">理论</span>
                              <span>{a.theory}</span>
                            </div>
                            <div className="detail-row">
                              <span className="detail-label">伏笔</span>
                              <span>{a.foreshadow.join('、')}</span>
                            </div>
                            <div className="detail-row">
                              <span className="detail-label">任务</span>
                              <span>{a.task}</span>
                            </div>
                            <div className="detail-row next-hook">
                              <span className="detail-label">衔接</span>
                              <span>{a.next}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
