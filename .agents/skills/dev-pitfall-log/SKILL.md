---
name: dev-pitfall-log
description: 记录开发过程中遇到的坑（报错、环境问题、诡异行为）到踩坑日志与个人知识库。当用户说"记一下这个坑"、"把这个记录下来"、"踩坑了"、"更新踩坑日志"，或者一个棘手问题刚被排查解决、值得沉淀复用时使用——哪怕用户没明说"记录"，解决完一个非平凡问题后也应主动建议沉淀。
---

# 开发踩坑记录

把开发中遇到的问题沉淀为结构化记录，写入两处：
1. **`docs/pitfalls.md`**（项目内踩坑日志，git 管理，按主题分组）
2. **个人知识库**（本机 `http://127.0.0.1:8000` 的 `/api/notes`，分类固定为「踩坑记录」）——线上对话的 RAG 能引用到这些经验

## 流程

1. **提炼三元组**：从上下文提炼「现象 → 根因 → 解决」。现象要含原始报错关键词（方便下次全文搜索命中），解决办法要含可直接复制的命令/代码。
2. **查重**：先 `grep -i "关键词" docs/pitfalls.md`，已记录的只补充新信息，不重复建档。
3. **追加到 `docs/pitfalls.md`**：找到对应主题分节（没有就在文件末尾新建 `## 主题`），在节内**顶部**插入新条目（最新的在前）。只用 Edit 追加，不要重写整个文件。
4. **同步知识库**：`curl -sf http://127.0.0.1:8000/api/health` 探活，在线则 POST 建笔记（见下方示例）；离线就跳过（日志文件仍是完整记录），不要卡在这一步。

## 条目格式（pitfalls.md）

```markdown
### 一句话标题（症状或根因）
- **现象**：原始报错/症状，保留英文错误关键词
- **根因**：为什么会这样（一句话讲透）
- **解决**：具体命令/代码/配置，可直接复制
- 日期：2026-09-04 · 环境：Windows Git Bash / Python 3.13 / ...
```

## 知识库笔记示例

标题一句话点明；正文 Markdown：`## 现象` `## 根因` `## 解决` 三节；tags 取技术关键词 2-4 个；category 固定 `踩坑记录`。

```bash
# 中文 JSON 用文件方式传（Git Bash 里 -d 直接写中文会乱码）
python -c "
import json
body = {'title': '...', 'content': open('note.md', encoding='utf-8').read(),
        'tags': ['GitBash', 'curl'], 'category': '踩坑记录'}
open('note.json', 'w', encoding='utf-8').write(json.dumps(body, ensure_ascii=False))
"
curl -s -X POST http://127.0.0.1:8000/api/notes -H "Content-Type: application/json" --data-binary @note.json
```

## 判断什么值得记

值得记：环境差异坑（Windows/Linux/路径/编码）、框架隐蔽行为、耗时超过几分钟的排查、官方文档没写的 workaround、一次性的神秘现象。
不值得记：语法错误、看报错就知道原因的问题、纯业务逻辑。

## 本项目高频坑速查

先读 `docs/pitfalls.md` 再动手，历史坑大概率会再遇到。特别高频：Git Bash 与 Windows 的 `/tmp` 不一致、中文 JSON 必须走文件、微信消息的 wxid 前缀、SQLAlchemy 原生 SQL 要 `text()`。
