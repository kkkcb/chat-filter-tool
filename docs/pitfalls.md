# 开发踩坑日志

> 由 `dev-pitfall-log` skill 维护。条目按主题分组，节内最新在前。
> 动手前先搜这里：`grep -i "关键词" docs/pitfalls.md`

## Windows / Git Bash 环境

### Git Bash 的 /tmp 与 Windows Python 的 /tmp 不是同一个目录
- **现象**：Git Bash 里 `tar czf /tmp/x.tar.gz` 成功，随后 Windows Python `sftp.put('/tmp/x.tar.gz')` 报 FileNotFoundError
- **根因**：Git Bash（MSYS）把 `/tmp` 映射到 `C:\Users\<user>\AppData\Local\Temp`，而 Windows 原生 Python 把 `/tmp` 解析为 `C:\tmp`
- **解决**：跨 Bash/Python 传文件路径时不用 `/tmp`，用工作区内相对路径（如 `./.deploy-x.tar.gz`）或 `cygpath -w /tmp` 换算
- 日期：2026-09-03 · 环境：Win11 Git Bash + Python 3.13（VPS 部署脚本踩了两次）

### Git Bash curl 直接写中文 JSON body 会乱码
- **现象**：`curl -d '{"title":"中文"}'` 后端报 `There was an error parsing the body`
- **根因**：Git Bash 的编码转换把 UTF-8 中文损坏
- **解决**：用 python 写 JSON 到文件（`ensure_ascii=False`），curl `--data-binary @file` 发送
- 日期：2026-09-03

### Bash heredoc 会吞掉 Windows 路径的反斜杠
- **现象**：heredoc 生成的脚本里 `C:\Users\...` 变成断裂路径（executablePath undefined）
- **根因**：heredoc 内 `\` 被转义解释
- **解决**：脚本文件用 Write 工具直接写；必须 heredoc 时用正斜杠路径（`C:/Program Files/...`）
- 日期：2026-09-03 · puppeteer 脚本 Chrome 路径

### git clean -fd 会删掉未跟踪的工具目录
- **现象**：`git clean -fd` 后 `tools/gitleaks.exe` 消失（同目录 cloudflared.exe 幸存）
- **根因**：gitignore 只忽略了 `tools/tunnel.log`，目录内其他未跟踪文件被 clean；cloudflared 正在运行被 Windows 文件锁保护
- **解决**：整个运行时目录进 gitignore（`tools/*`）；clean 前先 `git clean -nd` 预览
- 日期：2026-09-04

## Python / 后端

### SQLAlchemy 2.0 原生 SQL 字符串必须 text() 包裹
- **现象**：`Textual SQL expression should be explicitly declared as text(...)`
- **根因**：SQLAlchemy 2.0 不再接受裸字符串 SQL
- **解决**：`from sqlalchemy import text`，所有 `execute("...")` 改 `execute(text("..."))`
- 日期：2026-09-03 · FTS 索引重建

### FastAPI 路由必须注册在 app.mount("/") 之前
- **现象**：`/api/health` 404，但其他 /api 路由正常
- **根因**：`app.mount("/", StaticFiles(...))` 会吞掉所有未匹配路径，注册在其后的路由永远不生效
- **解决**：mount 放到所有 include_router 之后
- 日期：2026-09-03

### 类方法 list 遮蔽内置 list 导致类型注解崩溃
- **现象**：`TypeError: unsupported operand type(s) for |`（`tags: list | None` 注解处）
- **根因**：类里定义了名为 `list` 的方法，注解在类作用域内解析时 `list` 指向了方法
- **解决**：文件头加 `from __future__ import annotations`（注解延迟求值）
- 日期：2026-09-03 · NoteService

### SQLite FTS5 中文不能直接分词
- **现象**：中文查询在 FTS 表里命中不了
- **根因**：默认 unicode61 tokenizer 不切 CJK 连续文本
- **解决**：入库前 bigramize（双字切分）再写入 FTS；查询词同样处理
- 日期：2026-09-03

## 微信数据

### 群消息原始 content 带 wxid 发送者前缀
- **现象**：聊天气泡里显示 `wxid_xxx: 你好` 冗余前缀
- **根因**：微信数据库群消息 content 格式为 `wxid:\n正文`；导出路径没像渲染路径那样先剥离
- **解决**：导出时统一走 `_parse_message_content` 剥前缀；引用消息的 ref_content 要在 `_collapse_text` **之前**剥（换行压成空格后就匹配不到了）
- 日期：2026-09-03

### 两万条消息一次性渲染卡死浏览器
- **现象**：微信记录预览大群时页面冻结
- **根因**：数万 DOM 节点 + markdown 全量渲染
- **解决**：双管齐下——服务端 `tail_limit` 只取最近 N 条 + 前端窗口渲染（初始 300 条，滚到顶再加载 1000）
- 日期：2026-09-03

## 前端 / 浏览器测试

### 跨源 401 响应必须带 CORS 头，否则前端永远收不到状态码
- **现象**：部署后 AccessGate 弹窗死活不触发，页面直接报网络错误
- **根因**：鉴权中间件返回 401 时没加 `Access-Control-Allow-Origin`，浏览器把整个响应拦截，fetch 拿不到 status=401
- **解决**：所有 4xx JSON 响应（尤其 401）都要带 CORS 头
- 日期：2026-09-03 · 令牌门

### 流式 SSE fetch 不能走统一 request()（resp.json() 会挂）
- **现象**：流式聊天无响应
- **根因**：SSE 响应是持续分块文本，json() 解析不了
- **解决**：流式用原生 fetch + `resp.body.getReader()`；且要走 `API_PREFIX`（部署形态的远端地址），别写死相对路径
- 日期：2026-09-03 · chatStore

### 纯悬停浮现的按钮可发现性太差
- **现象**：用户找不到"删除消息"按钮（设计为 hover 才出现）
- **解决**：改为常显低调（opacity .45）+ 悬停强调；功能入口宁可低调常显不要隐藏
- 日期：2026-09-04

### 内置浏览器自动化不可用时用 puppeteer-core + 系统 Chrome
- **现象**：browser-use webview 报 "browser guest not attached"
- **解决**：`puppeteer-core` + `executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'`（正斜杠）；截图目录先 mkdirSync
- 日期：2026-09-03

## 部署 / 云

### 腾讯云轻量上 iptables 80→8000 REDIRECT 返回云层 502
- **现象**：PREROUTING REDIRECT 到 127.0.0.1:8000 后公网访问 80 得到空 body 502（无 Server 头）
- **根因**：云平台网络层对该转发路径的行为，非本机 nginx
- **解决**：放弃转发，systemd 以 root 直接 `uvicorn --host 0.0.0.0 --port 80`
- 日期：2026-09-04

### 新 VPS apt 报 dpkg was interrupted
- **现象**：`apt-get install` 失败提示 dpkg 被中断
- **解决**：先 `dpkg --configure -a` 再 update/install
- 日期：2026-09-04

### Pages(HTTPS) 前端不能调 http:// 的后端（mixed content）
- **现象**：Pages 上的站点调 `http://IP` 的 API 全部失败
- **根因**：HTTPS 页面禁止发起明文 HTTP 请求（且裸 IP 拿不到 HTTPS 证书）
- **解决**：后端挂域名 + HTTPS，前端构建时 `VITE_API_BASE` 注入；或前后端同源同机部署（IP 直连形态）
- 日期：2026-09-03

### 隧道(tunnel)回源流量 client.host 恒为 127.0.0.1
- **现象**：想按"来源 IP"区分本机/公网请求做免鉴权，隧道流量全部长得像本机
- **解决**：改按 **Host 头**区分（localhost/127.0.0.1 = 本机免鉴权，公网域名 = 需令牌）
- 日期：2026-09-03

### deploy 脚本漏同步前端 dist，导致"后端更新了前端还是旧的"
- **现象**：新功能接口在线上，页面却没变化
- **根因**：部署脚本只打包了 backend/，前端 dist 靠手工
- **解决**：脚本内自动 `npm run build` 并打包 dist 一起上传
- 日期：2026-09-04
