# ICE · AI 创作引擎

> ZERO° · AI 内容创作工作台

一个集 AI 对话、素材管理、创意创作、微信聊天记录导出于一体的本地工作台。

## 功能概览

| 模块 | 说明 |
|------|------|
| **AI 对话** | 流式聊天，支持 GLM-5.2 模型，深度思考模式，对话历史管理 |
| **素材库** | 分类管理创作素材，支持文本/图片/链接，CLIP 语义搜索 |
| **创作区** | 文章选题推荐、写作工坊、灵感工坊 |
| **微信记录** | 导出微信 4.x 聊天记录，搜索/预览/收藏/导出 HTML/JSON |

## 技术栈

- **前端**: React 18 + Vite + Zustand + Markdown-it
- **后端**: Python FastAPI + SQLite + GLM-5.2 API
- **微信导出**: Python HTTP Server (端口 5679) + SQLCipher 解密

## 快速开始

### 1. 环境要求

- Node.js 18+
- Python 3.10+（微信导出需要 3.13 + pycryptodome）
- Windows 10/11（微信导出功能仅支持 Windows）

### 2. 安装依赖

```powershell
# 前端
cd frontend
npm install

# 后端
cd backend
pip install -r requirements.txt

# 微信导出（可选）
cd wechat-export
pip install -r requirements.txt
```

### 3. 配置

```powershell
# 后端环境变量
cp backend/.env.example backend/.env
# 编辑 .env 填入 GLM API Key 等配置

# 微信导出配置
cp wechat-export/config.example.json wechat-export/config.json
# 编辑 config.json 填入微信数据路径
```

微信导出还需要 `all_keys.json`（数据库解密密钥），需自行提取，不包含在仓库中。

### 4. 启动

```powershell
# 一键启动（后端 + 前端 + 微信导出）
.\start.ps1

# 开发模式（前台运行，方便调试）
.\dev.ps1
```

启动后访问 http://localhost:5173

## 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| 前端 Vite | 5173 | React 开发服务器 |
| 后端 FastAPI | 8000 | REST API + AI 对话 |
| 微信导出 | 5679 | 聊天记录解密/导出服务 |

## 项目结构

```
workspace/
├── frontend/              # React 前端
│   ├── src/
│   │   ├── api/           # API 客户端
│   │   ├── stores/        # Zustand 状态管理
│   │   ├── pages/         # 页面组件
│   │   │   └── wechat/    # 微信导出子组件
│   │   ├── layouts/       # 布局组件
│   │   └── styles/        # 全局样式
│   └── package.json
├── backend/               # FastAPI 后端
│   ├── app/
│   │   ├── routers/       # API 路由
│   │   ├── services/      # 业务逻辑
│   │   ├── models/        # 数据模型
│   │   └── schemas/       # Pydantic 模型
│   └── requirements.txt
├── wechat-export/         # 微信聊天记录导出
│   ├── export_server.py   # HTTP 服务 (:5679)
│   ├── mcp_server.py      # 解密核心
│   ├── config.json        # 配置（需自建）
│   └── all_keys.json      # 密钥（需自建）
├── start.ps1              # 正式启动脚本
├── dev.ps1                # 开发启动脚本
└── build.ps1              # 构建脚本
```

## 微信导出功能

### 配置步骤

1. 确保 Weixin.exe（微信 4.x）正在运行
2. 提取数据库密钥到 `all_keys.json`（格式见 `config.example.json`）
3. 配置 `config.json` 指向微信数据目录
4. 启动后会自动解密数据库

### 交互设计

- **搜索驱动**: 不搜索时不显示联系人列表，输入关键词后才出结果
- **自动收藏**: 点击过的联系人自动收藏，清空搜索后仍可见
- **右键隐藏**: 右键联系人可选择隐藏，隐藏后不再出现在搜索结果中
- **近期过滤**: 默认只显示近 30 天有消息的联系人，可切换为全部

## 在另一台电脑恢复

```powershell
# 1. 克隆仓库
git clone <repo-url>
cd workspace

# 2. 安装依赖
cd frontend; npm install
cd ../backend; pip install -r requirements.txt
cd ../wechat-export; pip install -r requirements.txt

# 3. 配置
cp backend/.env.example backend/.env       # 编辑填入 API Key
cp wechat-export/config.example.json wechat-export/config.json
# 手动创建 wechat-export/all_keys.json（提取密钥）

# 4. 启动
.\start.ps1
```

## License

Private
