import { useEffect, useState } from 'react'
import { MessageCircle, RefreshCw, AlertCircle, Users, User, PanelRight } from 'lucide-react'
import { useWeChatStore } from '../stores/wechatStore'
import ContactList from './wechat/ContactList'
import DetailPane from './wechat/DetailPane'
import HistoryPane from './wechat/HistoryPane'
import './WeChatExport.css'

export default function WeChatExport() {
  const {
    online, checking, stats, rightCollapsed,
    checkOnlineStatus, loadStats, loadHistory, loadFiles,
    toggleRightCollapsed,
  } = useWeChatStore()

  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    checkOnlineStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRefresh = async () => {
    setRefreshKey(k => k + 1)
    await checkOnlineStatus()
    if (online) {
      loadStats()
      loadHistory()
      loadFiles()
    }
  }

  // 离线引导页
  if (online === false) {
    return (
      <div className="wx-page">
        <div className="wx-topbar">
          <div className="wx-topbar-left">
            <h2 className="header-title"><MessageCircle size={18} strokeWidth={2.2} /> 微信记录</h2>
            <span className="wechat-status offline">● 服务未启动</span>
          </div>
        </div>
        <div className="wx-offline">
          <AlertCircle size={48} strokeWidth={1.5} />
          <h3>微信记录服务未启动</h3>
          <p>需要先完成以下步骤：</p>
          <div className="wx-steps">
            <div className="wx-step">
              <span className="step-num">1</span>
              <span>通过 <code>wechat-decrypt</code> 解密微信数据库，生成 <code>all_keys.json</code></span>
            </div>
            <div className="wx-step">
              <span className="step-num">2</span>
              <span>编辑 <code>config.json</code>，填入数据库路径和密钥文件路径</span>
            </div>
            <div className="wx-step">
              <span className="step-num">3</span>
              <span>运行 <code>python export_server.py</code> 启动服务</span>
            </div>
          </div>
          <button className="wx-retry" onClick={handleRefresh}>
            <RefreshCw size={14} strokeWidth={2} /> 重新检测
          </button>
        </div>
      </div>
    )
  }

  // 检测中
  if (online === null) {
    return (
      <div className="wx-page">
        <div className="wx-topbar">
          <div className="wx-topbar-left">
            <h2 className="header-title"><MessageCircle size={18} strokeWidth={2.2} /> 微信记录</h2>
            <span className="wechat-status checking">● 检查中...</span>
          </div>
        </div>
        <div className="wx-loading">
          <RefreshCw size={24} strokeWidth={2} className="wx-spin" />
          <p>正在连接微信记录服务...</p>
        </div>
      </div>
    )
  }

  // 在线 — 三栏布局
  return (
    <div className="wx-page">
      <div className="wx-topbar">
        <div className="wx-topbar-left">
          <h2 className="header-title"><MessageCircle size={18} strokeWidth={2.2} /> 微信记录</h2>
          <span className="wechat-status online">● 服务已连接</span>
          {stats && (
            <div className="wx-stats">
              <span className="wx-stat-pill">总 {stats.total}</span>
              <span className="wx-stat-pill"><Users size={11} /> 群 {stats.groups}</span>
              <span className="wx-stat-pill"><User size={11} /> 人 {stats.users}</span>
            </div>
          )}
        </div>
        <div className="wx-topbar-right">
          <button
            className={`wx-panel-toggle ${rightCollapsed ? 'collapsed' : ''}`}
            onClick={toggleRightCollapsed}
            title={rightCollapsed ? '展开导出历史' : '收起导出历史，给消息区让空间'}
          >
            <PanelRight size={15} strokeWidth={2} />
          </button>
          <button className="wx-refresh-btn" onClick={handleRefresh} title="刷新">
            <RefreshCw size={15} strokeWidth={2} className={checking ? 'wx-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="wx-layout" key={refreshKey}>
        <ContactList />
        <DetailPane />
        <HistoryPane />
      </div>
    </div>
  )
}
