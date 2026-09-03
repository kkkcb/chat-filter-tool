import { useEffect } from 'react'
import { Clock, FileText, Download, Eye, FileCode, History as HistoryIcon, Inbox } from 'lucide-react'
import { useWeChatStore } from '../../stores/wechatStore'
import { downloadUrl } from '../../api/wechat'

function fmtTime(ts) {
  if (!ts) return ''
  try {
    const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts)
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return String(ts) }
}

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / 1024 / 1024).toFixed(1) + 'MB'
}

export default function HistoryPane() {
  const { history, files, loadingHistory, loadHistory, loadFiles, rightCollapsed } = useWeChatStore()

  useEffect(() => {
    if (rightCollapsed) return // 收起时不请求，展开时再加载
    loadHistory()
    loadFiles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightCollapsed])

  return (
    <div className={`wx-col wx-col-right ${rightCollapsed ? 'collapsed' : ''}`}>
      {/* 导出历史 */}
      <div className="wx-right-section">
        <div className="wx-right-header">
          <HistoryIcon size={13} strokeWidth={2} />
          <span>导出历史</span>
        </div>
        <div className="wx-right-body">
          {loadingHistory && history.length === 0 ? (
            <div className="wx-empty-sm">加载中...</div>
          ) : history.length === 0 ? (
            <div className="wx-empty-sm muted">暂无导出记录</div>
          ) : (
            history.slice(0, 20).map((h, i) => (
              <div key={h.task_id || i} className="wx-history-item">
                <div className="wx-history-top">
                  <Clock size={11} strokeWidth={2} className="wx-time-icon" />
                  <span className="wx-history-time">{fmtTime(h.timestamp)}</span>
                  <span className="wx-history-fmt">{h.format || 'html'}</span>
                </div>
                <div className="wx-history-names">
                  {(h.results || []).slice(0, 3).map((r, j) => (
                    <span key={j} className="wx-history-name">
                      {r.name}
                      {r.message_count != null && <em>·{r.message_count}条</em>}
                    </span>
                  ))}
                  {(h.results || []).length > 3 && <span className="wx-history-more">+{h.results.length - 3}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 已导出文件 */}
      <div className="wx-right-section">
        <div className="wx-right-header">
          <FileText size={13} strokeWidth={2} />
          <span>已导出文件</span>
        </div>
        <div className="wx-right-body">
          {files.length === 0 ? (
            <div className="wx-empty-list-sm">
              <Inbox size={22} strokeWidth={1.5} />
              <p>暂无文件</p>
            </div>
          ) : (
            files.map((f, i) => {
              const isHtml = f.name.endsWith('.html')
              const isJson = f.name.endsWith('.json')
              return (
                <div key={f.name || i} className="wx-file-item">
                  <span className={`wx-file-icon ${isHtml ? 'html' : isJson ? 'json' : ''}`}>
                    {isHtml ? <Eye size={13} strokeWidth={2} /> : isJson ? <FileCode size={13} strokeWidth={2} /> : <FileText size={13} strokeWidth={2} />}
                  </span>
                  <div className="wx-file-info">
                    <span className="wx-file-name" title={f.name}>{f.name}</span>
                    <span className="wx-file-meta">{fmtSize(f.size)} · {fmtTime(f.modified)}</span>
                  </div>
                  <div className="wx-file-actions">
                    <a
                      className="wx-file-btn"
                      href={downloadUrl(f.name)}
                      download={f.name}
                      title="下载"
                    >
                      <Download size={12} strokeWidth={2} />
                    </a>
                    {isHtml && (
                      <a
                        className="wx-file-btn"
                        href={downloadUrl(f.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="预览"
                      >
                        <Eye size={12} strokeWidth={2} />
                      </a>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
