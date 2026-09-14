"""个人知识库对外读取接口 — 供外部 AI / 工具获取用户沉淀的笔记

设计原则：
- 只读：外部只能读取，写入仍走应用内接口
- AI 友好：默认返回 Markdown 全文（笔记本身不大，摘要截断反而要二次请求）；
  根路径 /kb/ 返回自描述 JSON，外部 agent 首访即可学会怎么用
- 可选鉴权：backend/.env 配 KB_API_TOKEN=xxx 后，需 ?token= 或
  Authorization: Bearer xxx；不配置则本机直连免鉴权（服务只绑 127.0.0.1）
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.core.database import get_db
from app.services.note_service import NoteService

router = APIRouter()


def _check_token(request: Request) -> None:
    """可选 token 鉴权：KB_API_TOKEN 未配置时直接放行（仅本机可达）"""
    expected = settings.kb_api_token
    if not expected:
        return
    supplied = request.query_params.get("token") or ""
    if not supplied:
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            supplied = auth[7:].strip()
    if supplied != expected:
        raise HTTPException(status_code=401, detail="需要有效 token：?token=xxx 或 Authorization: Bearer xxx")


def _full_notes(svc: NoteService, q: str, category: str, tag: str, limit: int) -> list[dict]:
    """复用列表过滤逻辑，但补全全文（列表服务只回摘要，外部 AI 要全文）"""
    rows = svc.list(q=q, tag=tag, category=category, limit=limit)
    if not rows:
        return []
    full = {n["id"]: n for n in (svc.get(r["id"]) for r in rows) if n}
    return [full.get(r["id"], r) for r in rows]


@router.get("/kb/")
@router.get("/kb")
async def kb_root(db: Session = Depends(get_db), _: None = Depends(_check_token)):
    """接口自述 — 外部 AI 首访问这里即可了解全部用法"""
    svc = NoteService(db)
    stats = svc.stats()
    return {
        "service": "个人知识库（Personal Knowledge Base）对外读取接口",
        "description": "用户从日常对话中沉淀的笔记：踩坑经验、技术方案、个人规划等，正文为 Markdown",
        "auth": {
            "required": bool(settings.kb_api_token),
            "how": "?token=xxx 或 Authorization: Bearer xxx（KB_API_TOKEN 未配置时免鉴权）",
        },
        "endpoints": {
            "/api/kb/notes": "笔记列表。参数 q(搜索)/category(大分类)/tag(标签)/limit(默认50)；默认含 Markdown 全文，full=false 只返回元信息",
            "/api/kb/notes/{id}": "单篇笔记全文",
            "/api/kb/search": "相关性检索（FTS）。参数 q 必填，limit 默认 5，按相关度排序",
            "/api/kb/stats": "结构统计：总数 / 分类计数 / 标签计数，建议先看这个了解知识库结构",
            "/api/kb/export": "全量导出。format=markdown（单文档，可直接投喂）或 json，可按 category 过滤",
        },
        "hint_for_ai": "先 GET /api/kb/stats 了解结构；用户提问时用 /api/kb/search 检索相关笔记，引用时注明笔记标题与分类",
        "stats": stats,
        "server_time": datetime.now().isoformat(),
    }


@router.get("/kb/notes")
async def kb_notes(
    q: str = Query("", description="标题/正文/标签模糊搜索"),
    category: str = Query("", description="按大分类过滤；__none__ 表示未分类"),
    tag: str = Query("", description="按标签过滤"),
    limit: int = Query(50, ge=1, le=200),
    full: bool = Query(True, description="false 时仅返回元信息（不含正文，用于轻量发现）"),
    db: Session = Depends(get_db),
    _: None = Depends(_check_token),
):
    svc = NoteService(db)
    if not full:
        return svc.list(q=q, tag=tag, category=category, limit=limit)
    return _full_notes(svc, q, category, tag, limit)


@router.get("/kb/notes/{note_id}")
async def kb_note(note_id: int, db: Session = Depends(get_db), _: None = Depends(_check_token)):
    note = NoteService(db).get(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="笔记不存在")
    return note


@router.get("/kb/search")
async def kb_search(
    q: str = Query(..., min_length=1, description="检索词"),
    limit: int = Query(5, ge=1, le=20),
    db: Session = Depends(get_db),
    _: None = Depends(_check_token),
):
    """FTS 相关性检索，返回全文笔记（按相关度排序）"""
    return NoteService(db).search_relevant(q, limit=limit)


@router.get("/kb/stats")
async def kb_stats(db: Session = Depends(get_db), _: None = Depends(_check_token)):
    return NoteService(db).stats()


@router.get("/kb/export")
async def kb_export(
    format: str = Query("markdown", pattern="^(markdown|json)$"),
    category: str = Query("", description="可按大分类导出，空为全部"),
    db: Session = Depends(get_db),
    _: None = Depends(_check_token),
):
    """全量导出 — markdown 为单文档（直接粘贴给任何 AI），json 为结构化"""
    svc = NoteService(db)
    notes = _full_notes(svc, "", category, "", 500)

    if format == "json":
        return {
            "exported_at": datetime.now().isoformat(),
            "category": category or "全部",
            "count": len(notes),
            "notes": notes,
        }

    lines = [
        "# 个人知识库导出",
        "",
        f"> 共 {len(notes)} 篇 · 导出于 {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "",
    ]
    # 按分类分组输出，空分类归入"未分类"
    by_cat: dict[str, list] = {}
    for n in notes:
        by_cat.setdefault(n.get("category") or "未分类", []).append(n)
    for cat in sorted(by_cat):
        lines += [f"## {cat}", ""]
        for n in by_cat[cat]:
            meta = []
            if n.get("tags"):
                meta.append("标签: " + ", ".join(n["tags"]))
            if n.get("updated_at"):
                meta.append("更新: " + n["updated_at"][:10])
            if meta:
                lines.append("*" + " · ".join(meta) + "*")
            lines += [f"### {n['title']}", "", n.get("content") or "", ""]
    return {
        "format": "markdown",
        "count": len(notes),
        "content": "\n".join(lines),
    }


@router.get("/kb/install-skill")
async def install_skill(request: Request):
    """一键安装 coding-pitfall-log skill——返回 bash 脚本，curl | bash 即装。

    后端地址从请求自身的 Host 推导（在哪台服务器上 curl 就写哪台），
    令牌取 APP_ACCESS_TOKEN，装完写入 ~/.agents/skills/，ZCode 重开会话即可发现。
    """
    from fastapi.responses import PlainTextResponse

    token = settings.app_access_token
    host = (request.headers.get("host") or "127.0.0.1:8000").lower()
    if host.split(":")[0] in {"localhost", "127.0.0.1", "[::1]"}:
        base = "http://127.0.0.1:8000"
    else:
        proto = (request.headers.get("x-forwarded-proto") or "http").lower()
        base = f"{proto}://{host}"

    auth_line = f"X-Access-Token: {token}" if token else "（本机免鉴权，无需令牌）"

    skill = f"""---
name: coding-pitfall-log
description: coding 踩坑实录——连接 ICE 后端知识库，按项目读取与沉淀开发踩坑经验。当用户说"记一下这个坑"、"踩坑了"、"记录到踩坑实录"，或一个非平凡问题刚被排查解决值得沉淀时写入；用户问"之前是不是踩过 xx 坑"、"查下踩坑实录"时检索。
---

# coding 踩坑实录

开发踩坑的记录与检索，跨项目沉淀到 ICE 知识库。

## 后端（已预配置，直接用）

- 服务器: {base}
- 鉴权: 所有请求加请求头 `{auth_line}`
- 探活: `curl -sf {base}/api/health`，不通则提示用户先启动后端

## 检索（会话开始 & 用户提问时）

```
curl -s -H "X-Access-Token: {token}" -G "{base}/api/kb/search" --data-urlencode "q=关键词"
curl -s -H "X-Access-Token: {token}" -G "{base}/api/notes" --data-urlencode "category=踩坑实录" --data-urlencode "q=关键词"
```

## 记录（排查解决后写入）

POST {base}/api/notes，Body（JSON）：

- title: 【项目名】一句话概括
- content: `## 现象`（报错/表现）`## 根因`（为什么，查了什么资料）`## 解决`（怎么修的）
- tags: ["项目名", "技术关键词"]
- category: "踩坑实录"

中文 JSON 务必写临时文件再 `--data-binary @note.json` 发送（命令行直传会乱码）。

## 值得记的标准

环境差异、框架隐蔽行为、排查超 3 分钟、文档没写的 workaround。
语法错误、显而易见的问题不值得记。
"""

    install_url = f"{base}/api/kb/install-skill" + (f"?access_token={token}" if token else "")
    script = f"""#!/usr/bin/env bash
# coding-pitfall-log skill 一键安装
# 用法: curl -s "{install_url}" | bash
set -euo pipefail

SKILL_DIR="$HOME/.agents/skills/coding-pitfall-log"
mkdir -p "$SKILL_DIR"
cat > "$SKILL_DIR/SKILL.md" << 'SKILLEOF'
{skill}SKILLEOF

echo "OK  skill 已安装: $SKILL_DIR"
echo "    后端: {base}"
echo "    重开 ZCode 会话后生效，说『连一下踩坑实录』即可验证"
"""

    return PlainTextResponse(script, media_type="text/plain; charset=utf-8")
