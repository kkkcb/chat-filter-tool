"""个人知识库笔记路由"""
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.core.database import get_db
from app.models.note import Note
from app.services.note_service import NoteService
from app.models.conversation import Conversation
from app.schemas.note import NoteCreate, NoteUpdate, SummarizeRequest

router = APIRouter()

# 笔记图片：落盘存储（base64 塞正文会让笔记体积/检索/编辑全面劣化）
IMAGE_DIR = settings.inbox_path.parent / "data" / "note_images"
ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024


def _safe_image_name(name: str) -> str:
    if (not name or name in (".", "..") or "/" in name or "\\" in name or ":" in name):
        raise HTTPException(400, "非法文件名")
    return name


@router.post("/notes/images")
async def upload_note_image(file: UploadFile = File(...)):
    """笔记图片上传：落盘返回 URL，markdown 以 ![](url) 引用"""
    if (file.content_type or "") not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, f"不支持的图片类型：{file.content_type}（支持 png/jpeg/gif/webp/bmp）")
    data = await file.read()
    if len(data) > MAX_IMAGE_SIZE:
        raise HTTPException(400, "图片过大（最大 10MB）")
    ext = (file.content_type or "image/png").split("/")[-1].replace("jpeg", "jpg")
    name = f"{uuid.uuid4().hex[:12]}.{ext}"
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    (IMAGE_DIR / name).write_bytes(data)
    return {"url": f"/api/notes/images/{name}", "name": name, "size": len(data)}


@router.get("/notes/images/{name}")
async def get_note_image(name: str):
    """笔记图片静态服务（纯文件名校验，防路径穿越）"""
    _safe_image_name(name)
    path = IMAGE_DIR / name
    if not path.is_file():
        raise HTTPException(404, "图片不存在")
    return FileResponse(path)


class CategoryCreate(BaseModel):
    name: str


class PolishRequest(BaseModel):
    content: str = ""
    mode: str = "full"  # full=整篇润色 / selection=仅润色选中片段（严格忠于原文）


@router.post("/notes/polish")
async def polish_note(req: PolishRequest):
    """AI 一键润色整理笔记正文（不落库——前端对比后由用户决定是否采用）"""
    from app.services.llm_service import llm_service
    if not req.content.strip():
        raise HTTPException(400, "笔记内容为空")
    if req.mode not in ("full", "selection"):
        raise HTTPException(400, "mode 仅支持 full / selection")
    result = await llm_service.polish_note(req.content, mode=req.mode)
    if not result or not result.strip():
        raise HTTPException(502, "润色失败，请稍后重试")
    return {"content": result.strip()}


class CategoryRename(BaseModel):
    new_name: str


@router.get("/notes/categories")
async def list_categories(db: Session = Depends(get_db)):
    """分类清单（分类表 ∪ 笔记数据 distinct）"""
    return {"categories": NoteService(db).existing_categories()}


@router.post("/notes/categories")
async def create_category(req: CategoryCreate, db: Session = Depends(get_db)):
    try:
        return NoteService(db).create_category(req.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/notes/categories/{name}")
async def rename_category(name: str, req: CategoryRename, db: Session = Depends(get_db)):
    try:
        return NoteService(db).rename_category(name, req.new_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/notes/categories/{name}")
async def delete_category(name: str, db: Session = Depends(get_db)):
    """删除分类：其下笔记归入未分类"""
    return NoteService(db).delete_category(name)


@router.get("/notes")
async def list_notes(
    q: str = Query("", description="标题/正文/标签模糊搜索"),
    tag: str = Query("", description="按标签过滤"),
    category: str = Query("", description="按大分类过滤；__none__ 表示未分类"),
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """笔记列表（按更新时间倒序，仅含摘要不含全文）"""
    svc = NoteService(db)
    return svc.list(q=q, tag=tag, category=category, limit=limit)


@router.get("/notes/stats")
async def note_stats(db: Session = Depends(get_db)):
    """笔记统计：总数 + 标签计数"""
    return NoteService(db).stats()


@router.get("/notes/{note_id}")
async def get_note(note_id: int, db: Session = Depends(get_db)):
    result = NoteService(db).get(note_id)
    if not result:
        raise HTTPException(status_code=404, detail="笔记不存在")
    return result


@router.post("/notes")
async def create_note(req: NoteCreate, db: Session = Depends(get_db)):
    """手动新建笔记"""
    return NoteService(db).create(title=req.title, content=req.content, tags=req.tags, category=req.category)


@router.post("/notes/from-conversation")
async def note_from_conversation(req: SummarizeRequest, db: Session = Depends(get_db)):
    """把对话总结成笔记并保存到个人知识库"""
    svc = NoteService(db)
    try:
        note = await svc.summarize_from_conversation(req.conversation_id, req.instruction)
        return {"success": True, "note": note}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))



class NoteReviseRequest(BaseModel):
    note_id: int
    instruction: str


@router.post("/notes/revise")
async def revise_note(req: NoteReviseRequest, db: Session = Depends(get_db)):
    """markdown 笔记的自然语言修订（路线图等；返回修订稿，不动原笔记）。"""
    note = db.query(Note).filter(Note.id == req.note_id).first()
    if not note:
        raise HTTPException(404, "笔记不存在")
    from app.services.llm_service import llm_service
    from app.core.tasklog import log_task
    import time as _t
    t0 = _t.monotonic()
    revised = await llm_service.revise_markdown(note.content or "", req.instruction)
    log_task("note.revise", note_id=req.note_id, instruction=req.instruction[:80],
             out_len=len(revised or ""), latency_ms=int((_t.monotonic() - t0) * 1000))
    if not revised:
        raise HTTPException(502, "修订失败，请稍后重试")
    return {"revised": revised}

@router.put("/notes/{note_id}")
async def update_note(note_id: int, req: NoteUpdate, db: Session = Depends(get_db)):
    result = NoteService(db).update(note_id, title=req.title, content=req.content, tags=req.tags, category=req.category)
    if not result:
        raise HTTPException(status_code=404, detail="笔记不存在")
    return result


@router.get("/notes/{note_id}/source")
async def get_note_source(note_id: int, db: Session = Depends(get_db)):
    """笔记的来源对话（从对话总结而来的笔记可跳回对话）"""
    n = db.query(Note).filter(Note.id == note_id).first()
    if not n:
        raise HTTPException(404, "笔记不存在")
    if not n.source_conversation_id:
        return {"conversation_id": None}
    conv = db.query(Conversation).filter(Conversation.id == n.source_conversation_id).first()
    if not conv:
        return {"conversation_id": n.source_conversation_id, "title": "(对话已删除)"}
    return {"conversation_id": conv.id, "title": conv.title}


@router.delete("/notes/{note_id}")
async def delete_note(note_id: int, db: Session = Depends(get_db)):
    if not NoteService(db).delete(note_id):
        raise HTTPException(status_code=404, detail="笔记不存在")
    return {"success": True, "message": "已删除"}
