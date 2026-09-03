"""对话历史路由"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc, func

from app.core.database import get_db
from app.models.conversation import Conversation, Message
from app.schemas.conversation import (
    ConversationOut, ConversationDetail, MessageOut,
    CreateConversationRequest, UpdateConversationRequest, ReorderRequest,
)

router = APIRouter()


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(db: Session = Depends(get_db)):
    """获取所有对话（按 position 排序）— 聚合查询计数与末条消息，避免 N+1"""
    convs = db.query(Conversation).order_by(Conversation.position.asc()).all()

    # 每个对话的消息数（一次 GROUP BY）
    counts: dict[int, int] = dict(
        db.query(Message.conversation_id, func.count(Message.id))
        .group_by(Message.conversation_id)
        .all()
    )
    # 每个对话最后一条消息（max(id) 一次聚合 + 一次 IN 取回）
    last_ids: dict[int, int] = dict(
        db.query(Message.conversation_id, func.max(Message.id))
        .group_by(Message.conversation_id)
        .all()
    )
    last_msgs = {}
    if last_ids:
        rows = db.query(Message).filter(Message.id.in_(last_ids.values())).all()
        last_msgs = {m.conversation_id: m for m in rows}

    result = []
    for c in convs:
        last = last_msgs.get(c.id)
        result.append(ConversationOut(
            id=c.id, title=c.title or "新对话", position=c.position or 0,
            created_at=c.created_at or "", updated_at=c.updated_at or "",
            last_message=(last.content or "")[:80] if last else "",
            message_count=counts.get(c.id, 0),
        ))
    return result


@router.post("/conversations", response_model=ConversationOut)
async def create_conversation(req: CreateConversationRequest, db: Session = Depends(get_db)):
    """创建新对话"""
    max_pos = db.query(Conversation.position).order_by(desc(Conversation.position)).first()
    next_pos = (max_pos[0] + 1 if max_pos and max_pos[0] is not None else 0)

    conv = Conversation(title=req.title, position=next_pos)
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return ConversationOut(
        id=conv.id, title=conv.title, position=conv.position,
        created_at=conv.created_at or "", updated_at=conv.updated_at or "",
    )


@router.get("/conversations/{conv_id}", response_model=ConversationDetail)
async def get_conversation(conv_id: int, db: Session = Depends(get_db)):
    """获取对话详情（含所有消息；不含 raw 请求/响应大字段，双击消息时按需拉取）"""
    conv = db.query(Conversation).filter(Conversation.id == conv_id).first()
    if not conv:
        raise HTTPException(404, "对话不存在")

    msgs = db.query(Message).filter(Message.conversation_id == conv_id).order_by(Message.id.asc()).all()
    return ConversationDetail(
        id=conv.id, title=conv.title, position=conv.position or 0,
        messages=[MessageOut(
            id=m.id, role=m.role, content=m.content or "", reasoning=m.reasoning or "",
            message_type=m.message_type or "chat", meta_json=m.meta_json or "{}",
            created_at=m.created_at or "",
        ) for m in msgs],
    )


@router.get("/messages/{message_id}")
async def get_message_raw(message_id: int, db: Session = Depends(get_db)):
    """单条消息的原始请求/返回（双击消息查看详情时按需加载）"""
    m = db.query(Message).filter(Message.id == message_id).first()
    if not m:
        raise HTTPException(404, "消息不存在")
    return {
        "id": m.id,
        "conversation_id": m.conversation_id,
        "role": m.role,
        "raw_request": m.raw_request or "",
        "raw_response": m.raw_response or "",
    }


@router.patch("/conversations/{conv_id}", response_model=ConversationOut)
async def update_conversation(conv_id: int, req: UpdateConversationRequest, db: Session = Depends(get_db)):
    """更新对话标题或位置"""
    conv = db.query(Conversation).filter(Conversation.id == conv_id).first()
    if not conv:
        raise HTTPException(404, "对话不存在")

    if req.title is not None:
        conv.title = req.title
    if req.position is not None:
        conv.position = req.position
    conv.updated_at = datetime.now().isoformat()
    db.commit()
    db.refresh(conv)
    return ConversationOut(
        id=conv.id, title=conv.title, position=conv.position or 0,
        created_at=conv.created_at or "", updated_at=conv.updated_at or "",
    )


@router.delete("/conversations/{conv_id}")
async def delete_conversation(conv_id: int, db: Session = Depends(get_db)):
    """删除对话及其所有消息"""
    conv = db.query(Conversation).filter(Conversation.id == conv_id).first()
    if not conv:
        raise HTTPException(404, "对话不存在")

    db.query(Message).filter(Message.conversation_id == conv_id).delete()
    db.delete(conv)
    db.commit()
    return {"success": True}


@router.post("/conversations/reorder")
async def reorder_conversations(req: ReorderRequest, db: Session = Depends(get_db)):
    """批量重新排序对话"""
    for idx, conv_id in enumerate(req.ordered_ids):
        conv = db.query(Conversation).filter(Conversation.id == conv_id).first()
        if conv:
            conv.position = idx
    db.commit()
    return {"success": True}


def save_message(db: Session, conv_id: int, role: str, content: str,
                 reasoning: str = "", message_type: str = "chat",
                 meta_json: str = "{}", raw_request: str = "", raw_response: str = "") -> Message:
    """保存单条消息到对话历史"""
    msg = Message(
        conversation_id=conv_id, role=role, content=content,
        reasoning=reasoning, message_type=message_type,
        meta_json=meta_json, raw_request=raw_request, raw_response=raw_response,
    )
    db.add(msg)

    # 更新对话的 updated_at
    conv = db.query(Conversation).filter(Conversation.id == conv_id).first()
    if conv:
        conv.updated_at = datetime.now().isoformat()
        # 第一条用户消息自动设标题
        if role == "user" and conv.title in ("新对话", "", None) and content:
            conv.title = content[:30]

    db.commit()
    db.refresh(msg)
    return msg
