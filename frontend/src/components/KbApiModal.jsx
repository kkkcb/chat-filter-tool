import { useState, useEffect } from 'react'
import { Plug, X, Copy, Check, Loader2 } from 'lucide-react'
import { toast } from './Toast'
import { request } from '../api/client'

/**
 * 个人知识库对外接口说明弹窗 — 展示外部 AI 读取笔记的 HTTP 接口与示例。
 * 打开时实时请求 /api/kb/（接口自述），展示鉴权要求与知识库结构统计。
 */
export default function KbApiModal({ onClose }) {
  const [info, setInfo] = useState(null)
  const [copied, setCopied] = useState('')

  // 开发模式（5173）下对外地址是后端 8000；生产同源
  const base = location.port === '5173' ? 'http://127.0.0.1:8000' : location.origin
  const apiUrl = `${base}/api/kb`

  useEffect(() => {
    let cancelled = false
    request('/kb/')
      .then((d) => { if (!cancelled) setInfo(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const endpoints = [
    { path: '/api/kb/', desc: '接口自述 — 给 AI 的入口说明（端点清单 + 用法提示）' },
    { path: '/api/kb/stats', desc: '结构统计：总数 / 分类 / 标签计数' },
    { path: '/api/kb/notes?category=技术原理&limit=20', desc: '笔记列表（默认含 Markdown 全文；可加 q= 搜索、tag= 过滤）' },
    { path: '/api/kb/notes/{id}', desc: '单篇笔记全文' },
    { path: '/api/kb/search?q=部署&limit=5', desc: '相关性检索（FTS），按相关度排序' },
    { path: '/api/kb/export?format=markdown', desc: '全量导出为单个 Markdown 文档，可直接粘贴给任何 AI' },
  ]

  const curlExample = `curl "${apiUrl}/search?q=部署"`

  const aiPrompt = `# 踩坑实录自动记录系统

你在帮用户写代码时，如果遇到非平凡的问题并解决了，请自动把经验记录到用户的知识库。

## 何时记录
- 环境差异坑（Windows/Linux/路径/编码）
- 框架隐蔽行为（React/SQLAlchemy/FastAPI 等）
- 耗时超过 3 分钟的排查
- 官方文档没写的 workaround

## 记录 API
POST ${apiUrl}/notes
Headers: Content-Type: application/json${info?.auth?.required ? ` | X-Access-Token: <令牌见下>` : ''}

Body:
{
  "title": "【项目名】一句话标题",
  "content": "## 现象\\n原始报错\\n\\n## 根因\\n为什么\\n\\n## 解决\\n具体命令/代码",
  "tags": ["项目名", "技术关键词1", "技术关键词2"],
  "category": "踩坑实录"
}

## 查询 API
搜索：GET ${apiUrl}/notes?category=踩坑实录&q=关键词
全文：GET ${apiUrl}/kb/search?q=关键词${info?.auth?.required ? '\n（需加 X-Access-Token 头）' : ''}

## 格式要求
- title：【项目名】一句话
- content 三节：现象/根因/解决
- tags 首位=项目名，后跟技术关键词
- 中文 JSON 写临时文件再发（--data-binary @文件）`

  const copy = (text, key) => {
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopied(key)
        toast('已复制', 'success')
        setTimeout(() => setCopied(''), 1500)
      })
      .catch(() => toast('复制失败', 'error'))
  }

  return (
    <div className="pkb-modal-overlay" onClick={onClose}>
      <div className="pkb-modal kb-api-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pkb-modal-header">
          <span className="pkb-modal-title"><Plug size={15} strokeWidth={2.2} /> 对外读取接口</span>
          <div className="pkb-modal-actions">
            <button className="pkb-icon-btn" onClick={onClose}><X size={17} strokeWidth={2} /></button>
          </div>
        </div>
        <div className="pkb-modal-body">
          <p className="kb-api-intro">
            笔记不只是给你看的 — 外部 AI（Claude / ChatGPT / 本地 Agent 等）可通过这套只读 HTTP 接口
            直接读取你的知识库做检索与引用。对方只需能访问 <code>{base}</code>。
          </p>

          <div className="kb-api-row">
            <span className="kb-api-label">接口地址</span>
            <div className="kb-api-value">
              <code>{apiUrl}</code>
              <button className="kb-api-copy" onClick={() => copy(apiUrl, 'url')}>
                {copied === 'url' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          </div>

          <div className="kb-api-row">
            <span className="kb-api-label">鉴权</span>
            <span className="kb-api-value">
              {info === null
                ? <Loader2 size={13} className="wx-spin" />
                : info?.auth?.required
                  ? <span className="kb-api-badge warn">已启用 token（?token=xxx 或 Bearer）</span>
                  : <span className="kb-api-badge ok">免鉴权（仅本机可访问）</span>}
            </span>
          </div>

          {info?.stats && (
            <div className="kb-api-row">
              <span className="kb-api-label">当前规模</span>
              <span className="kb-api-value">
                {info.stats.total} 篇笔记
                {info.stats.categories && Object.keys(info.stats.categories).filter(Boolean).length > 0
                  && ` · ${Object.entries(info.stats.categories).filter(([k]) => k).map(([k, v]) => `${k} ${v}`).join('、')}`}
              </span>
            </div>
          )}

          <div className="kb-api-section">
            <h4>端点清单</h4>
            <div className="kb-api-endpoints">
              {endpoints.map((e) => (
                <div key={e.path} className="kb-api-endpoint">
                  <div className="kb-api-endpoint-path">
                    <code>{e.path}</code>
                    <button className="kb-api-copy" onClick={() => copy(base + e.path, e.path)}>
                      {copied === e.path ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                  <span className="kb-api-endpoint-desc">{e.desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="kb-api-section">
            <h4>快速示例</h4>
            <div className="kb-api-curl">
              <code>{curlExample}</code>
              <button className="kb-api-copy" onClick={() => copy(curlExample, 'curl')}>
                {copied === 'curl' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          </div>

          <div className="kb-api-section">
            <h4>AI 接入 Prompt（复制发给任何 AI）</h4>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.5 }}>
              粘贴到 Claude / ChatGPT / Cursor 等任何 AI，它就能自动把踩坑经验写入你的知识库、遇到问题时检索过往经验。
            </p>
            <div className="kb-api-curl" style={{ maxHeight: 280, overflow: 'auto', alignItems: 'flex-start' }}>
              <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'var(--font)', lineHeight: 1.6, flex: 1 }}>{aiPrompt}</pre>
              <button className="kb-api-copy" style={{ marginTop: 6, flexShrink: 0 }} onClick={() => copy(aiPrompt, 'ai-prompt')}>
                {copied === 'ai-prompt' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          </div>

          <p className="kb-api-note">
            服务仅监听本机（127.0.0.1）。若要让公网 AI 访问：自行配置内网穿透，并在
            <code> backend/.env </code>中设置<code> KB_API_TOKEN=你的密钥 </code>后重启后端即可开启鉴权。
          </p>
        </div>
      </div>
    </div>
  )
}
