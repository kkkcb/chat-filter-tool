"""对话路由"""
import json
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.conversation import Message
from app.schemas.chat import ChatRequest, ChatResponse, SaveConfirmRequest, SaveConfirmResponse
from app.services.chat_service import ChatService
from app.services.material_service import MaterialService
from app.routers.conversations import save_message
from app.models.conversation import Conversation, Message

router = APIRouter()

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}

# 回传给模型的历史消息条数（user+assistant 合计）
HISTORY_LIMIT = 10


def _load_history(db: Session, conv_id: int, before_id: int | None = None, limit: int = HISTORY_LIMIT) -> list[dict]:
    """加载对话历史（带 dsh 式检查点压缩）。

    有压缩检查点时：检查点 + 最近 N 条全文（替代旧的每条硬截断）；
    无检查点时保持原逻辑。详见 services/compaction_service.py。
    """
    from app.services.compaction_service import load_history_with_checkpoint
    return load_history_with_checkpoint(db, conv_id, before_id, limit)


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, db: Session = Depends(get_db)):
    """统一对话入口（链接/图片/普通）— 非流式"""
    if not req.message and not req.image:
        return ChatResponse(type="chat", reply="消息不能为空", success=False)

    history = _load_history(db, req.conversation_id) if req.conversation_id else []
    svc = ChatService(db)
    result = await svc.handle_message(req.message, req.image, req.mode, history=history)
    return ChatResponse(**result)



@router.get("/chat/personas")
async def list_personas(db: Session = Depends(get_db)):
    """可用聊天人设（笔记 tag=人设）：id/标题/摘要"""
    from app.models.note import Note
    notes = db.query(Note).filter(Note.tags.like('%人设%')).order_by(Note.updated_at.desc()).all()
    return [{"id": n.id, "title": n.title,
             "excerpt": (n.content or "")[:80].replace("\n", " ")} for n in notes]

@router.post("/chat/stream")
async def chat_stream(req: ChatRequest, db: Session = Depends(get_db)):
    """流式对话入口（SSE）— 实时输出思考过程和正文，同时保存对话历史"""
    if not req.message and not req.image:
        async def empty():
            yield 'data: ' + json.dumps({"type": "error", "data": "消息不能为空"}, ensure_ascii=False) + '\n\n'
        return StreamingResponse(empty(), media_type="text/event-stream", headers=SSE_HEADERS)

    svc = ChatService(db)
    conv_id = req.conversation_id

    # 如果没指定对话 ID，自动创建一个新对话
    if not conv_id:
        max_pos_q = db.query(Conversation.position).order_by(Conversation.position.desc()).first()
        next_pos = (max_pos_q[0] + 1 if max_pos_q and max_pos_q[0] is not None else 0)
        title = req.message[:30] if req.message else "图片分析"
        conv = Conversation(title=title, position=next_pos)
        db.add(conv)
        db.commit()
        db.refresh(conv)
        conv_id = conv.id

    # 保存用户消息，并加载此消息之前的历史作为多轮上下文
    user_meta = json.dumps({"image": bool(req.image), "mode": req.mode}, ensure_ascii=False)
    user_msg = save_message(db, conv_id, "user", req.message or "", message_type="chat", meta_json=user_meta)
    history = _load_history(db, conv_id, before_id=user_msg.id)

    # 构建原始请求记录
    # 人设笔记内容（写作助手 system prompt）——raw_request 需要带上
    # 实际发给模型的完整 system（人设/RAG 规则），消息详情里可见可查
    persona_text = ""
    if req.persona_id:
        from app.models.note import Note as _Note
        _n = db.query(_Note).filter(_Note.id == req.persona_id).first()
        if _n:
            persona_text = _n.content or ""

    # 组装 raw_request：与真实发给模型的 messages 对齐（system 完整呈现）
    svc_probe = ChatService(db)
    _probe_rag = ""
    if req.use_rag if req.use_rag is not None else True:
        try:
            _probe_rag, _ = svc_probe._build_rag(req.message)
        except Exception:
            _probe_rag = ""
    _probe_msgs = svc_probe._build_messages(
        req.message, _probe_rag, history or [],
        style=req.style or "", persona=persona_text)
    _sys = next((m["content"] for m in _probe_msgs if m["role"] == "system"), None)
    raw_request = json.dumps({
        "message": req.message, "image": "[base64 image]" if req.image else None,
        "mode": req.mode, "thinking": req.thinking, "style": req.style or "",
        "persona_id": req.persona_id,
        "system": _sys if _sys else "(无 system —— 纯模型直答)",
        "conversation_id": conv_id,
    }, ensure_ascii=False, indent=2)

    async def event_stream():
        try:
            # 先发对话 ID、用户消息 ID 和连接建立信号（前端据此支持单句删除）
            yield f'data: {json.dumps({"type": "start", "data": "", "conversation_id": conv_id, "user_message_id": user_msg.id}, ensure_ascii=False)}\n\n'

            full_content = ""
            full_reasoning = ""
            msg_data = None

            async for event_type, event_data in svc.handle_message_stream(
                req.message, req.image, req.mode, req.thinking or False, history=history, use_rag=req.use_rag if req.use_rag is not None else True, files=[f.dict() for f in req.files] if req.files else None, use_web=req.use_web or False, style=req.style or "", persona=persona_text
            ):
                if isinstance(event_data, (dict, list)):
                    payload_data = event_data
                else:
                    payload_data = str(event_data)

                # 收集完整内容
                if event_type == "reasoning":
                    full_reasoning += payload_data
                elif event_type == "content":
                    full_content += payload_data
                elif event_type == "done":
                    msg_data = event_data

                chunk = json.dumps({"type": event_type, "data": payload_data}, ensure_ascii=False)
                yield f'data: {chunk}\n\n'

            # 流结束后保存助手消息（含原始请求和返回）
            # reasoning 全文进 raw_response：详情弹窗要能看到思考过程，
            # 只存长度的话双击详情里推理细节不可见
            raw_response = json.dumps({
                "type": msg_data.get("type") if isinstance(msg_data, dict) else "chat",
                "reply": full_content,
                **({"reasoning": full_reasoning} if full_reasoning else {}),
                "reasoning_length": len(full_reasoning),
                "content_length": len(full_content),
            }, ensure_ascii=False, indent=2)

            save_message(
                db, conv_id, "assistant",
                content=full_content or (msg_data.get("reply", "") if isinstance(msg_data, dict) else ""),
                reasoning=full_reasoning,
                message_type=msg_data.get("type", "chat") if isinstance(msg_data, dict) else "chat",
                raw_request=raw_request,
                raw_response=raw_response,
            )
            # 通知前端该条助手消息的服务端 ID（支持单句删除/懒加载 raw）
            last_id = db.query(Message.id).filter(
                Message.conversation_id == conv_id
            ).order_by(Message.id.desc()).limit(1).scalar()
            yield f'data: {json.dumps({"type": "saved", "data": "", "message_id": last_id}, ensure_ascii=False)}\n\n'

        except Exception as e:
            # 中止/断连时也保存已生成的部分内容——用户点停止不该丢掉模型输出
            if full_content.strip():
                try:
                    partial_response = json.dumps({
                        "type": "aborted",
                        "reply": full_content,
                        **({"reasoning": full_reasoning} if full_reasoning else {}),
                        "reasoning_length": len(full_reasoning),
                        "content_length": len(full_content),
                        "error": str(e)[:200],
                    }, ensure_ascii=False, indent=2)
                    save_message(
                        db, conv_id, "assistant",
                        content=full_content,
                        reasoning=full_reasoning,
                        message_type="chat",
                        raw_request=raw_request,
                        raw_response=partial_response,
                    )
                    last_id = db.query(Message.id).filter(
                        Message.conversation_id == conv_id
                    ).order_by(Message.id.desc()).limit(1).scalar()
                    yield f'data: {json.dumps({"type": "saved", "data": "", "message_id": last_id}, ensure_ascii=False)}\n\n'
                except Exception as save_err:
                    print(f"[Chat] 中止保存失败: {save_err}")
            yield f'data: {json.dumps({"type": "error", "data": str(e)}, ensure_ascii=False)}\n\n'

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=SSE_HEADERS)


@router.post("/chat/confirm-save", response_model=SaveConfirmResponse)
async def confirm_save(req: SaveConfirmRequest, db: Session = Depends(get_db)):
    """确认保存素材到知识库"""
    svc = MaterialService(db)
    result = svc.save_entry(req.entry)
    if result.get("success"):
        return SaveConfirmResponse(success=True, entry=result["entry"], message="已保存到知识库（侧边栏 → 知识库 → 素材 查看）")
    return SaveConfirmResponse(success=False, message=result.get("error", "保存失败"))
