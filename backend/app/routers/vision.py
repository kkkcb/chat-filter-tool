"""视觉路由"""
import base64
from fastapi import APIRouter, UploadFile, File, HTTPException

from app.schemas.vision import VisionRequest, VisionResponse
from app.services.llm_service import llm_service, VISION_PRESETS

router = APIRouter()


@router.post("/vision", response_model=VisionResponse)
async def vision(req: VisionRequest):
    """视觉分析（独立调用）"""
    if not req.image:
        raise HTTPException(status_code=400, detail="请提供图片")

    prompt = req.prompt if req.prompt else VISION_PRESETS.get(req.mode, VISION_PRESETS["describe"])
    result = await llm_service.vision(req.image, prompt)
    if result:
        return VisionResponse(reply=result)
    raise HTTPException(status_code=500, detail="视觉分析失败")


@router.get("/vision/presets")
async def vision_presets():
    """返回可用的视觉分析模式"""
    return {"presets": VISION_PRESETS}


@router.post("/upload")
async def upload(file: UploadFile = File(...)):
    """图片上传 → base64 data URL"""
    if not file.filename:
        raise HTTPException(status_code=400, detail="没有文件名")

    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件过大（最大 10MB）")

    b64 = base64.b64encode(data).decode("utf-8")
    mime = file.content_type or "image/png"
    return {"image": f"data:{mime};base64,{b64}", "size": len(data), "name": file.filename}
