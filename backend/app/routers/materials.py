"""素材路由"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core import fts
from app.services.material_service import MaterialService
from app.services.llm_service import llm_service
from app.services.clip_service import clip_service
from app.schemas.material import MaterialUpdate
from app.config import settings

router = APIRouter()


@router.get("/categories")
async def categories():
    """可用分类列表 — 前端统一从此接口获取，避免多处硬编码"""
    return {"categories": settings.categories}


@router.get("/materials")
async def list_materials(
    category: str | None = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """素材列表（支持分类筛选+分页）"""
    svc = MaterialService(db)
    return svc.list(category=category, page=page, size=size)


@router.get("/materials/{material_id}")
async def get_material(material_id: int, db: Session = Depends(get_db)):
    """素材详情（含正文）"""
    svc = MaterialService(db)
    result = svc.get(material_id)
    if not result:
        raise HTTPException(status_code=404, detail="素材不存在")
    return result


@router.put("/materials/{material_id}")
async def update_material(
    material_id: int,
    req: MaterialUpdate,
    db: Session = Depends(get_db),
):
    """编辑素材（改分类/标签）"""
    svc = MaterialService(db)
    result = svc.update(material_id, category=req.category, tags=req.tags, summary=req.summary)
    if not result:
        raise HTTPException(status_code=404, detail="素材不存在")
    return result


@router.post("/materials/{material_id}/retranslate")
async def retranslate_material(material_id: int, db: Session = Depends(get_db)):
    """对已有素材重新跑 AI 分类翻译（标题/摘要英译中）"""
    import json
    from app.models.material import Material
    from app.core.storage import save_markdown
    from app.config import settings

    m = db.query(Material).filter(Material.id == material_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="素材不存在")

    # 读取正文
    from app.core.storage import read_markdown
    content = read_markdown(m.md_path) if m.md_path else ""

    # 重新 AI 分类 + 翻译
    ai_result = await llm_service.classify(m.title, content, m.summary or "")

    if ai_result:
        if ai_result.get("title_cn"):
            m.title = ai_result["title_cn"]
        if ai_result.get("summary"):
            m.summary = ai_result["summary"]
        if ai_result.get("category") and ai_result["category"] in settings.categories:
            m.category = ai_result["category"]
        if ai_result.get("tags"):
            m.tags = json.dumps(ai_result["tags"], ensure_ascii=False)
        if ai_result.get("bilingual"):
            m.extra_text = ai_result["bilingual"]

        # 如果有翻译后的正文，写回 markdown 文件
        if ai_result.get("content_cn"):
            inbox = settings.inbox_path
            from pathlib import Path
            md_fullpath = inbox / m.md_path if not Path(m.md_path).is_absolute() else Path(m.md_path)
            if md_fullpath.exists():
                # 保留 frontmatter，替换正文
                original = md_fullpath.read_text(encoding="utf-8")
                frontmatter = ""
                if original.startswith("---"):
                    end = original.find("\n---", 3)
                    if end != -1:
                        frontmatter = original[:end + 4] + "\n"
                md_fullpath.write_text(frontmatter + ai_result["content_cn"], encoding="utf-8")

        db.commit()
        db.refresh(m)
        fts.upsert(db, m)

    svc = MaterialService(db)
    return svc.get(material_id)


@router.delete("/materials/{material_id}")
async def delete_material(material_id: int, db: Session = Depends(get_db)):
    """删除素材（同时删除 Markdown 文件）"""
    from app.models.material import Material
    from pathlib import Path
    from app.config import settings

    m = db.query(Material).filter(Material.id == material_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="素材不存在")

    # 删除 Markdown 文件
    inbox = settings.inbox_path
    md_fullpath = Path(inbox) / m.md_path if not Path(m.md_path).is_absolute() else Path(m.md_path)
    if md_fullpath.exists():
        md_fullpath.unlink()

    # 删除数据库记录
    db.delete(m)
    db.commit()
    fts.remove(db, material_id)

    return {"success": True, "message": "已删除"}


@router.get("/stats")
async def stats(db: Session = Depends(get_db)):
    """统计数据"""
    svc = MaterialService(db)
    return svc.stats()
