"""Agnes 免费模型路由 —— 模型实验室专用。

文本流式 / 图片生成 / 视频任务（创建+轮询）。
key 在后端 .env，前端只与本路由交互。
"""
import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.services import agnes_service

router = APIRouter()

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


class AgnesChatRequest(BaseModel):
    model: str = "agnes-3.0-flash"
    messages: list[dict] = Field(..., min_length=1)


class AgnesImageRequest(BaseModel):
    model: str = "agnes-image-2.5-flash"
    prompt: str = Field(..., min_length=1)
    size: str = "1K"
    ratio: str = "1:1"
    ref_images: list[str] | None = None  # 图生图/多图合成的参考图 URL


@router.get("/agnes/models")
async def list_free_models():
    return {"key_ok": agnes_service.key_configured(), "models": agnes_service.AGNES_FREE_MODELS}


@router.post("/agnes/chat")
async def chat(req: AgnesChatRequest):
    allowed = {m["id"] for m in agnes_service.AGNES_FREE_MODELS["text"]}
    if req.model not in allowed:
        return StreamingResponse(
            iter([f"data: {json.dumps({'type': 'error', 'data': f'仅支持免费文本模型: {sorted(allowed)}'}, ensure_ascii=False)}\n\n"]),
            media_type="text/event-stream", headers=SSE_HEADERS)
    return StreamingResponse(agnes_service.stream_chat(req.model, req.messages),
                             media_type="text/event-stream", headers=SSE_HEADERS)


@router.post("/agnes/images")
async def image(req: AgnesImageRequest):
    allowed = {m["id"] for m in agnes_service.AGNES_FREE_MODELS["image"]}
    if req.model not in allowed:
        return {"error": f"仅支持免费图片模型: {sorted(allowed)}"}
    try:
        result = await agnes_service.generate_image(
            req.model, req.prompt, req.size, req.ratio, req.ref_images)
        return result
    except Exception as e:  # 上游限流/参数错误原样透传
        return {"error": agnes_service._err_detail(e) if isinstance(e, Exception) else str(e)} \
            if not isinstance(e, RuntimeError) else {"error": str(e)}


class AgnesVideoCreate(BaseModel):
    payload: dict  # 前端按模型组装（2.5-flash: mode/size/seconds...；v2.0: num_frames...）


@router.post("/agnes/videos")
async def video_create(req: AgnesVideoCreate):
    try:
        return await agnes_service.create_video(req.payload)
    except (ValueError, RuntimeError) as e:
        return {"error": str(e)}


@router.get("/agnes/videos/query")
async def video_query(video_id: str, model: str = ""):
    try:
        return await agnes_service.query_video(video_id, model)
    except RuntimeError as e:
        return {"error": str(e)}
