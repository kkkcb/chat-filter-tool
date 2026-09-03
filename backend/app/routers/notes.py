"""个人知识库笔记路由"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.note_service import NoteService
from app.schemas.note import NoteCreate, NoteUpdate, SummarizeRequest

router = APIRouter()


@router.get("/notes")
async def list_notes(
    q: str = Query("", description="标题/正文/标签模糊搜索"),
    tag: str = Query("", description="按标签过滤"),
    db: Session = Depends(get_db),
):
    """笔记列表（按更新时间倒序）"""
    svc = NoteService(db)
    return svc.list(q=q, tag=tag)


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
    return NoteService(db).create(title=req.title, content=req.content, tags=req.tags)


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


@router.put("/notes/{note_id}")
async def update_note(note_id: int, req: NoteUpdate, db: Session = Depends(get_db)):
    result = NoteService(db).update(note_id, title=req.title, content=req.content, tags=req.tags)
    if not result:
        raise HTTPException(status_code=404, detail="笔记不存在")
    return result


@router.delete("/notes/{note_id}")
async def delete_note(note_id: int, db: Session = Depends(get_db)):
    if not NoteService(db).delete(note_id):
        raise HTTPException(status_code=404, detail="笔记不存在")
    return {"success": True, "message": "已删除"}
