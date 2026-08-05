# 微信聊天记录导出工具

基于 [wechat-decrypt](https://github.com/ylytdeng/wechat-decrypt) 的微信 4.x 数据库解密能力，提供 Web 界面一键导出聊天记录为 HTML / JSON。

## 功能

- Web 界面搜索、筛选联系人/群聊
- 多选批量导出聊天记录
- 支持 HTML（微信气泡风格）和 JSON 两种格式
- 导出历史记录与文件管理
- 6000+ 联系人虚拟滚动，流畅不卡顿

## 前置条件

1. 已通过 [wechat-decrypt](https://github.com/ylytdeng/wechat-decrypt) 完成数据库解密，生成了 `all_keys.json` 和 `decrypted/` 目录
2. Python 3.10+

## 快速开始

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 复制配置模板并填写路径
cp config.example.json config.json
# 编辑 config.json，填入：
#   db_dir        — 微信加密数据库所在目录
#   keys_file     — all_keys.json 路径
#   decrypted_dir — 解密后数据库目录
#   image_aes_key — 图片解密密钥（可选）

# 3. 启动服务
python export_server.py

# 4. 浏览器打开
# http://localhost:5679
```

## 文件说明

| 文件 | 说明 |
|------|------|
| `export_server.py` | Web 服务入口，提供 REST API |
| `export_web.html` | 前端界面（虚拟滚动 + 防抖搜索） |
| `export_chat.py` | 聊天记录导出为 JSON |
| `gen_chat_html.py` | JSON 转 HTML（微信气泡风格） |
| `mcp_server.py` | 核心数据层（数据库查询、消息解析） |
| `config.py` | 配置加载 |
| `key_utils.py` | 密钥工具 |
| `decode_image.py` | 图片解密模块 |

## API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/contacts` | GET | 联系人列表（支持 `?q=搜索&type=user/group`） |
| `/api/stats` | GET | 联系人统计 |
| `/api/export` | POST | 触发导出 `{"names":["名1","名2"],"format":"html"}` |
| `/api/export_status/{id}` | GET | 轮询导出进度 |
| `/api/download/{file}` | GET | 下载导出文件 |
| `/api/history` | GET | 导出历史 |
| `/api/files` | GET | 已导出文件列表 |

## 命令行使用

不启动 Web 服务，也可以命令行单独导出：

```bash
# 导出为 JSON
python export_chat.py "联系人备注名" output.json

# JSON 转 HTML
python gen_chat_html.py output.json chat.html
```

## 致谢

- 数据库解密核心：[wechat-decrypt](https://github.com/ylytdeng/wechat-decrypt)
