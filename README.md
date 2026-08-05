# ICE · AI 创作引擎

> ZERO° · AI 内容创作工作台 — AI 对话 · 素材管理 · 创作工坊 · 微信记录导出

---

## 目录

- [功能一览](#功能一览)
- [环境要求](#环境要求)
- [快速部署（新电脑）](#快速部署新电脑)
- [详细配置说明](#详细配置说明)
- [日常使用](#日常使用)
- [微信导出功能](#微信导出功能)
- [故障排查](#故障排查)
- [项目结构](#项目结构)

---

## 功能一览

| 模块 | 说明 |
|------|------|
| **AI 对话** | 流式聊天（GLM-5.2），深度思考模式，多轮对话历史管理 |
| **素材库** | 分类管理创作素材，支持文本/图片/链接，CLIP 语义搜索 |
| **创作区** | 文章选题推荐、写作工坊、灵感工坊 |
| **微信记录** | 导出微信 4.x 聊天记录，搜索/预览/收藏/导出 HTML/JSON |

---

## 环境要求

| 组件 | 版本 | 说明 |
|------|------|------|
| **Node.js** | 18+ | 前端构建 |
| **Python** | 3.10+ | 后端服务（微信导出推荐 3.13） |
| **操作系统** | Windows 10/11 | 微信导出仅支持 Windows |
| **微信** | 4.x（Weixin.exe） | 微信导出需要微信正在运行 |

**Python 包管理器**: `pip`（Python 自带）

---

## 快速部署（新电脑）

### 第 0 步：安装基础软件

如果新电脑还没装 Node.js 和 Python：

```powershell
# 下载 Node.js (LTS 版)
# https://nodejs.org/

# 下载 Python 3.13
# https://www.python.org/downloads/
# 安装时务必勾选 "Add Python to PATH"
```

### 第 1 步：克隆仓库

```powershell
git clone https://github.com/kkkcb/chat-filter-tool.git
cd chat-filter-tool
```

> 如果没装 Git，去 https://git-scm.com/ 下载安装

### 第 2 步：安装全部依赖（一键脚本）

将以下命令复制到 PowerShell 中执行：

```powershell
# 前端依赖
cd frontend
npm install
cd ..

# 后端依赖
cd backend
pip install -r requirements.txt
cd ..

# 微信导出依赖（可选）
pip install pycryptodome zstandard
```

### 第 3 步：配置环境

```powershell
# ===== 后端配置 =====
copy backend\.env.example backend\.env
# 用记事本编辑 backend\.env，填入你的 GLM API Key

# ===== 微信导出配置（可选） =====
copy wechat-export\config.example.json wechat-export\config.json
# 用记事本编辑 wechat-export\config.json，填入你的微信数据路径
```

### 第 4 步：启动

```powershell
.\start.ps1
```

浏览器会自动打开 `http://localhost:5173`，三个服务全部后台静默运行。

---

## 详细配置说明

### 1. 后端 `.env` 文件

位置：`backend/.env`

```ini
# GLM API（必填，AI 对话功能依赖此 Key）
GLM_API_KEY=你的智谱API Key
GLM_ENDPOINT=https://open.bigmodel.cn/api/coding/paas/v4/chat/completions
GLM_MODEL=glm-5.2
GLM_VISION_MODEL=glm-4.6v

# 数据库
DATABASE_PATH=../data/workbench.db

# 文件存储
INBOX_DIR=../../inbox

# 服务
APP_HOST=0.0.0.0
APP_PORT=8000
```

> **获取 GLM API Key**: 访问 https://open.bigmodel.cn/ → 注册 → 控制台 → API Keys

### 2. 微信导出 `config.json`

位置：`wechat-export/config.json`

```json
{
    "db_dir": "C:\\Users\\你的用户名\\Documents\\xwechat_files\\你的wxid\\db_storage",
    "keys_file": "all_keys.json",
    "decrypted_dir": "decrypted",
    "wechat_process": "Weixin.exe"
}
```

**如何找到你的 `db_dir` 路径**：

```powershell
# 在 PowerShell 中运行，查找微信数据库目录
Get-ChildItem "$env:USERPROFILE\Documents\xwechat_files" -Directory | Select-Object Name
# 输出示例: wxid_xxxx_1234
# 那么完整路径就是:
# C:\Users\你的用户名\Documents\xwechat_files\wxid_xxxx_1234\db_storage
```

### 3. 微信导出 `all_keys.json`（密钥文件）

**此文件不含在仓库中，需自行创建。**

位置：`wechat-export/all_keys.json`

格式：

```json
{
    "contact\\contact.db": {
        "enc_key": "64位十六进制密钥字符串"
    },
    "message\\message_0.db": {
        "enc_key": "64位十六进制密钥字符串"
    }
}
```

> 密钥提取需要使用第三方工具（如 wechat-decrypt），从运行中的 Weixin.exe 进程内存提取。

---

## 日常使用

### 启动项目

```powershell
# 方式一：正式启动（后台静默，无弹窗）
.\start.ps1

# 方式二：开发模式（前台运行，方便看日志调试）
.\dev.ps1
```

### 停止项目

```powershell
# start.ps1 每次运行会自动清理旧进程
# 如需手动停止：
Get-NetTCPConnection -LocalPort 5173,8000,5679 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

### 构建前端

```powershell
cd frontend
npm run build
# 产物在 frontend/dist/
```

---

## 微信导出功能

### 交互设计

| 操作 | 效果 |
|------|------|
| 打开微信记录页面 | 显示搜索引导（不加载全部联系人，避免卡顿） |
| 输入群名/人名/昵称 | 实时搜索匹配的联系人 |
| 点击联系人 | 自动收藏到左侧列表 |
| 清空搜索 | 显示已收藏的联系人 |
| **右键**联系人 | 弹出菜单 → 「隐藏此联系人」 |
| 隐藏后 | 不再出现在收藏列表和搜索结果中 |
| 点击「近30天」按钮 | 切换近期活跃 / 全部联系人 |

### 导出聊天记录

1. 在左侧选中联系人（可多选勾选框）
2. 在中栏选择导出格式：HTML / JSON / 两者
3. 点击「导出」
4. 等待进度完成
5. 在右侧「导出历史」中下载文件

### 收入素材库

1. 预览联系人消息
2. 勾选需要的消息
3. 点击「收入素材库」
4. 选择分类，确认保存

---

## 服务端口

| 服务 | 端口 | 用途 |
|------|------|------|
| **前端 Vite** | 5173 | React 开发服务器（主入口） |
| **后端 FastAPI** | 8000 | REST API + AI 对话 |
| **微信导出** | 5679 | 聊天记录解密/导出服务 |

> 前端会自动连接后端和微信服务，无需额外配置。

---

## 故障排查

### 前端启动失败（端口 5173）

```powershell
# 检查 node_modules 是否安装
Test-Path frontend\node_modules
# 如果返回 False，重新安装：
cd frontend; npm install; cd ..
```

### 后端启动失败（端口 8000）

```powershell
# 检查 .env 是否存在且有 API Key
Get-Content backend\.env
# 检查依赖
pip install -r backend\requirements.txt
```

### 微信导出显示离线

1. 确认 Weixin.exe 正在运行
2. 确认 `config.json` 中的 `db_dir` 路径正确
3. 确认 `all_keys.json` 存在且密钥有效
4. 检查微信导出依赖：`pip install pycryptodome zstandard`

### 端口被占用

```powershell
# 查看占用进程
Get-NetTCPConnection -LocalPort 5173,8000,5679 -State Listen
# 杀掉占用进程
Stop-Process -Id <PID> -Force
# 或直接重新运行 start.ps1（会自动清理）
```

### PowerShell 执行策略错误

```powershell
# 如果无法运行 .ps1 脚本
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

---

## 项目结构

```
chat-filter-tool/
│
├── frontend/                  # React 前端
│   ├── src/
│   │   ├── api/               # API 客户端
│   │   │   └── wechat.js      # 微信导出 API
│   │   ├── stores/            # Zustand 状态管理
│   │   │   └── wechatStore.js # 微信导出状态（收藏/隐藏/搜索）
│   │   ├── pages/
│   │   │   ├── WeChatExport.jsx   # 微信导出主页面
│   │   │   ├── WeChatExport.css   # 微信导出样式
│   │   │   ├── KnowledgeBase.jsx  # AI 对话页
│   │   │   ├── Library.jsx        # 素材库
│   │   │   └── CreativeStudio.jsx # 创作区
│   │   │   └── wechat/            # 微信导出子组件
│   │   │       ├── ContactList.jsx   # 联系人列表（搜索/收藏/右键隐藏）
│   │   │       ├── DetailPane.jsx    # 导出操作面板
│   │   │       ├── HistoryPane.jsx   # 导出历史
│   │   │       └── CollectDialog.jsx # 收入素材库对话框
│   │   ├── layouts/           # 布局
│   │   └── styles/            # 全局样式
│   ├── package.json
│   └── vite.config.js
│
├── backend/                   # FastAPI 后端
│   ├── app/
│   │   ├── routers/           # API 路由（chat/materials/conversations）
│   │   ├── services/          # 业务逻辑（LLM/CLIP/素材管理）
│   │   ├── models/            # 数据模型
│   │   ├── schemas/           # Pydantic 模型
│   │   └── config.py          # 配置加载
│   ├── .env.example           # 环境变量模板
│   └── requirements.txt
│
├── wechat-export/             # 微信聊天记录导出
│   ├── export_server.py       # HTTP 服务 (:5679)
│   ├── mcp_server.py          # 解密核心逻辑
│   ├── config.json            # 配置（需自建）
│   ├── all_keys.json          # 密钥（需自建）
│   └── requirements.txt
│
├── start.ps1                  # 一键启动脚本（后台静默）
├── dev.ps1                    # 开发启动脚本（前台调试）
├── build.ps1                  # 前端构建脚本
└── README.md                  # 本文档
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 19 + Vite 8 |
| 状态管理 | Zustand 5 |
| UI 组件 | Lucide Icons + 自定义 CSS |
| Markdown | markdown-it + DOMPurify |
| 后端框架 | FastAPI + Uvicorn |
| 数据库 | SQLite + SQLAlchemy |
| AI 模型 | GLM-5.2（智谱 AI） |
| 微信解密 | SQLCipher 4 + AES-256-CBC |

---

## License

Private — 仅供个人使用
