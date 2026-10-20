# ICE · AI 创作引擎

个人 AI 内容创作工作台：GLM 流式对话 · 网页剪藏素材库 · 知识库全文检索 · 创作工坊 · 微信记录导出。前后端自研，已部署上线（systemd 常驻 80 端口）。

## 技术栈

- **前端**：React 19 + Vite 8 + Zustand 5；Markdown 渲染（markdown-it + DOMPurify）
- **后端**：Python / FastAPI + SQLAlchemy + SQLite（FTS5）
- **模型**：GLM-5.2（对话主力）/ glm-4.6v（视觉理解）/ glm-5.3-flash（润色等轻量任务，实测 11s vs 旗舰 16~29s，质量相当——按任务分级调用）
- **微信导出**：独立 stdlib HTTP 服务，SQLCipher + AES-256-CBC 解密本地聊天库
- **部署**：VPS systemd 常驻；脚本化「构建 → 上传 → 版本回读自检」流程；Cloudflare Pages + 内网穿透备用链路

## 核心设计

### 一条消息如何变成回复

```text
用户输入（文本 / 图片 / 链接 / 素材引用）
  → 输入分发：链接剪藏入库 / 图片走视觉模型理解 / 文本直达
  → RAG 检索：FTS5 bigram 全文检索素材与笔记
      → 相关性后过滤（2-gram 覆盖度），只留真正命中问题语义的条目
  → 上下文组装：
      人设（可实时编辑；无人设则零 system 注入）
      + 输出风格（科普/教学/简洁/脑暴四型会话级约束）
      + 命中素材注入 + 压缩检查点（长对话）
  → GLM 分级调用（对话 / 视觉 / 轻量三档）
  → SSE 流式返回；raw_request 全量留痕（记录实际发送的 system 提示词，行为可回溯）
```

### 上下文压缩（长对话检查点）

借鉴 deepseek-harness 的 compaction 策略并做中文适配：

- **七段结构化检查点**：原始意图 / 关键概念 / 文件与代码 / 错误与修复 / 待办 / 当前工作 / 下一步；要求保留精确路径、命令、错误串与用户纠正
- **压缩指令放在重放对话的最后一条 user 消息**（而非独立 system）——与上次真实请求前缀对齐，可复用 KV 缓存
- 遇到旧 `<compacted-summary>` 增量合并而非照抄，压缩可重复执行
- 加载历史 = 检查点 + 最近 12 条全文，替代硬截断

### 检索：FTS5 bigram + 相关性后过滤

- SQLite FTS5 的 unicode61 分词器把连续中文当整串 token → 入库与查询都先做 **bigram 预处理**（“浏览器自动化” → “浏览 览器 器自 自动 动化”）
- FTS 命中过宽（只言片语即返回）→ 检索后按 **2-gram 滑窗覆盖比例**过滤并剔除停用词，避免弱相关素材被注入、AI 被迫硬凑引用
- FTS5 不可用或索引损坏时自动回退关键词暴力扫描，主流程不中断

### 知识库对外只读 API

- 供外部 AI / 工具读取个人沉淀笔记：默认返回 Markdown 全文（笔记本身不大，摘要截断反而要二次请求）
- 根路径 `/kb/` 返回自描述 JSON，外部 agent 首次访问即可学会怎么用
- 只读（写入仍走应用内接口）；可选 token 鉴权

### 访问控制

- 本机直连（localhost Host）免鉴权；公网访问所有 `/api` 需 `APP_ACCESS_TOKEN`（`X-Access-Token` / `?access_token=` / `Bearer`）
- 前端收到 401 时弹应用内令牌输入框（非浏览器原生弹窗），确认后写入 localStorage 自动重试
- 笔记图片静态服务豁免鉴权（`<img>` 无法携带自定义头），安全性靠 12 位 hex 不可猜文件名 + 正文 API 仍需令牌

### 微信记录导出

解密微信 4.x 本地库（需自行提取密钥）→ FTS 检索 → 预览 / 收藏 / 导出 HTML / JSON → 勾选消息一键收入素材库，进入 RAG 链路。仅支持导出本人聊天数据。

## 代码导航

| 路径 | 职责 |
|---|---|
| `backend/app/services/chat_service.py` | 对话编排：输入分发、人设与输出风格、素材注入 |
| `backend/app/services/llm_service.py` | GLM 统一封装：三档模型分级、共享连接池、流式 |
| `backend/app/services/compaction_service.py` | 长对话检查点压缩 |
| `backend/app/services/clip_service.py` | 网页剪藏（GitHub / 微信公众号 / 通用来源适配） |
| `backend/app/services/material_service.py` | 素材管理与检索（FTS 优先，回退扫描） |
| `backend/app/services/note_service.py` | 笔记与知识库 |
| `backend/app/core/fts.py` | FTS5 bigram 分词与检索 |
| `backend/app/core/relevance.py` | 检索结果相关性后过滤 |
| `backend/app/routers/kb.py` | 知识库对外只读 API |
| `backend/app/main.py` | 应用入口 + 全局访问令牌中间件 |
| `frontend/src/` | React 19 前端（对话 / 素材库 / 知识库 / 创作区 / 微信记录） |
| `wechat-export/` | 微信解密导出独立服务（:5679） |

各模块 docstring 记录了设计决策的背景与取舍（如压缩策略为何放最后一条 user 消息、bigram 的必要性），读代码建议从 docstring 入手。

## 开发与运行

环境：Node.js 18+、Python 3.10+（微信导出推荐 3.13）、Windows 10/11。

```powershell
git clone https://github.com/kkkcb/ice-workbench.git
cd ice-workbench

# 依赖
cd frontend; npm install; cd ..
cd backend; pip install -r requirements.txt; cd ..
pip install pycryptodome zstandard   # 可选：微信导出

# 配置：backend/.env（参照 backend/.env.example，填 GLM_API_KEY）
copy backend\.env.example backend\.env

# 启动（后台静默，三个服务一键拉起）
.\start.ps1     # 开发模式用 .\dev.ps1
```

| 服务 | 端口 | 用途 |
|---|---|---|
| 前端 Vite | 5173 | React 开发服务器（主入口） |
| 后端 FastAPI | 8000 | REST API + AI 对话 |
| 微信导出 | 5679 | 聊天记录解密 / 导出 |

GLM API Key：https://open.bigmodel.cn/ 控制台获取。

### 微信导出配置（可选）

1. `wechat-export/config.json` 填 `db_dir`：`%USERPROFILE%\Documents\xwechat_files\<wxid>\db_storage`
2. `wechat-export/all_keys.json` 需自行提取（密钥绑定当前 Windows 账户 + 微信登录态，换机 / 重装需重提）：管理员 PowerShell 运行微信 4.x 密钥提取工具（GitHub 上的 wechat-decrypt 类项目），生成后复制入 `wechat-export/`

## 故障排查

```powershell
# 端口被占用（5173 / 8000 / 5679）
Get-NetTCPConnection -LocalPort 5173,8000,5679 -State Listen
Stop-Process -Id <PID> -Force        # 或直接重跑 start.ps1（自动清理旧进程）

# 无法运行 .ps1
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

# 后端起不来：检查 backend\.env 是否存在且含 API Key；重装依赖
pip install -r backend\requirements.txt

# 微信导出离线：确认 Weixin.exe 在运行、db_dir 路径正确、all_keys.json 有效
```

## 说明

个人项目，代码仅供学习参考；未附开源许可证。微信记录导出功能仅支持导出本人聊天数据。
