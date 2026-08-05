"""对话路由"""
import json
from datetime import datetime
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.chat import ChatRequest, ChatResponse, SaveConfirmRequest, SaveConfirmResponse
from app.services.chat_service import ChatService
from app.services.material_service import MaterialService
from app.routers.conversations import save_message
from app.models.conversation import Conversation

router = APIRouter()

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, db: Session = Depends(get_db)):
    """统一对话入口（链接/图片/普通）— 非流式"""
    if not req.message and not req.image:
        return ChatResponse(type="chat", reply="消息不能为空", success=False)

    svc = ChatService(db)
    result = await svc.handle_message(req.message, req.image, req.mode)
    return ChatResponse(**result)


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest, db: Session = Depends(get_db)):
    """流式对话入口（SSE）— 实时输出思考过程和正文，同时保存对话历史"""
    if not req.message and not req.image:
        async def empty():
            yield 'data: ' + json.dumps({"type": "error", "data": "消息不能为空"}, ensure_ascii=False) + '\n\n'
        return StreamingResponse(empty(), media_type="text/event-stream", headers=SSE_HEADERS)

    svc = ChatService(db)
    conv_id = getattr(req, 'conversation_id', None)

    # 如果没指定对话 ID，自动创建一个新对话
    if not conv_id:
        from app.models.conversation import Conversation
        max_pos_q = db.query(Conversation.position).order_by(Conversation.position.desc()).first()
        next_pos = (max_pos_q[0] + 1 if max_pos_q and max_pos_q[0] is not None else 0)
        title = req.message[:30] if req.message else "图片分析"
        conv = Conversation(title=title, position=next_pos)
        db.add(conv)
        db.commit()
        db.refresh(conv)
        conv_id = conv.id

    # 保存用户消息
    user_meta = json.dumps({"image": bool(req.image), "mode": req.mode}, ensure_ascii=False)
    user_msg = save_message(db, conv_id, "user", req.message or "", message_type="chat", meta_json=user_meta)

    # 构建原始请求记录
    raw_request = json.dumps({
        "message": req.message, "image": "[base64 image]" if req.image else None,
        "mode": req.mode, "thinking": req.thinking, "conversation_id": conv_id,
    }, ensure_ascii=False, indent=2)

    async def event_stream():
        try:
            # 先发对话 ID 和连接建立信号
            yield f'data: {json.dumps({"type": "start", "data": "", "conversation_id": conv_id}, ensure_ascii=False)}\n\n'

            full_content = ""
            full_reasoning = ""
            msg_data = None

            async for event_type, event_data in svc.handle_message_stream(
                req.message, req.image, req.mode, req.thinking or False
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
            raw_response = json.dumps({
                "type": msg_data.get("type") if isinstance(msg_data, dict) else "chat",
                "reply": full_content,
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

        except Exception as e:
            yield f'data: {json.dumps({"type": "error", "data": str(e)}, ensure_ascii=False)}\n\n'

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=SSE_HEADERS)


@router.post("/chat/confirm-save", response_model=SaveConfirmResponse)
async def confirm_save(req: SaveConfirmRequest, db: Session = Depends(get_db)):
    """确认保存素材到知识库"""
    svc = MaterialService(db)
    result = svc.save_entry(req.entry)
    if result.get("success"):
        return SaveConfirmResponse(success=True, entry=result["entry"], message="已保存到知识库")
    return SaveConfirmResponse(success=False, message=result.get("error", "保存失败"))
