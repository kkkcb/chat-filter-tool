"""Agnes 免费模型路由 —— 模型实验室专用。

文本流式 / 图片生成 / 视频任务（创建+轮询）。
key 在后端 .env，前端只与本路由交互。
生成结果落 lab_assets 表：前端切页/刷新后仍能展示，
pending 视频任务可恢复轮询。
"""
import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.lab_asset import LabAsset
from app.services import agnes_service
from app.core.tasklog import log_task

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


def _asset_dict(a: LabAsset) -> dict:
    return {
        "id": a.id, "kind": a.kind, "model": a.model, "prompt": a.prompt,
        "params": json.loads(a.params) if a.params else {},
        "url": a.url, "video_id": a.video_id, "status": a.status,
        "progress": a.progress, "error": a.error,
        "internal_progress": a.internal_progress, "internal_status": a.internal_status,
        "upstream_created_at": a.upstream_created_at, "upstream_completed_at": a.upstream_completed_at,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


@router.get("/agnes/models")
async def list_free_models():
    return {"key_ok": agnes_service.key_configured(),
            "models": agnes_service.AGNES_FREE_MODELS,
            "prompt_templates": agnes_service.PROMPT_TEMPLATES}


@router.get("/agnes/assets")
async def list_assets(kind: str = "", limit: int = 60, db: Session = Depends(get_db)):
    """生成历史：kind 为空返回全部（图片+视频）。"""
    q = db.query(LabAsset).order_by(LabAsset.id.desc())
    if kind in ("image", "video"):
        q = q.filter(LabAsset.kind == kind)
    return [_asset_dict(a) for a in q.limit(min(limit, 200)).all()]


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
async def image(req: AgnesImageRequest, db: Session = Depends(get_db)):
    import time as _time
    started = _time.monotonic()
    allowed = {m["id"] for m in agnes_service.AGNES_FREE_MODELS["image"]}
    if req.model not in allowed:
        return {"error": f"仅支持免费图片模型: {sorted(allowed)}"}
    asset = LabAsset(kind="image", model=req.model, prompt=req.prompt,
                     params=json.dumps({"size": req.size, "ratio": req.ratio,
                                        "refs": len(req.ref_images or [])}, ensure_ascii=False),
                     status="completed", progress=100)
    db.add(asset)
    db.commit()  # 先落一行占位，失败也能看到记录
    log_task("image.create", asset_id=asset.id, model=req.model, size=req.size,
             ratio=req.ratio, refs=len(req.ref_images or []), prompt=req.prompt[:80])
    try:
        result = await agnes_service.generate_image(
            req.model, req.prompt, req.size, req.ratio, req.ref_images)
        asset.url, asset.b64 = result.get("url"), result.get("b64")
        db.commit()
        log_task("image.done", asset_id=asset.id, latency_ms=int((_time.monotonic() - started) * 1000),
                 has_url=bool(result.get("url")), has_b64=bool(result.get("b64")))
        return {"id": asset.id, "url": asset.url, "b64": asset.b64}
    except Exception as e:
        asset.status, asset.error = "failed", str(e)[:500]
        db.commit()
        log_task("image.failed", asset_id=asset.id, latency_ms=int((_time.monotonic() - started) * 1000),
                 error=str(e)[:300])
        return {"error": str(e)[:300]}


class AgnesVideoCreate(BaseModel):
    payload: dict  # 前端按模型组装（2.5-flash: mode/size/seconds...；v2.0: num_frames...）


@router.post("/agnes/videos")
async def video_create(req: AgnesVideoCreate, db: Session = Depends(get_db)):
    import time as _time
    started = _time.monotonic()
    try:
        d = await agnes_service.create_video(req.payload)
    except (ValueError, RuntimeError) as e:
        log_task("video.create_failed", model=req.payload.get("model"),
                 error=str(e)[:300], latency_ms=int((_time.monotonic() - started) * 1000))
        return {"error": str(e)}
    vid = d.get("video_id") or d.get("id")
    asset_id = None
    if vid:
        asset = LabAsset(kind="video", model=req.payload.get("model", ""),
                         prompt=req.payload.get("prompt", ""),
                         params=json.dumps({k: v for k, v in req.payload.items()
                                            if k not in ("model", "prompt")}, ensure_ascii=False),
                         video_id=vid, status=d.get("status") or "pending",
                         progress=int(d.get("progress") or 0),
                         upstream_created_at=d.get("created_at"),
                         last_response=json.dumps(d, ensure_ascii=False))
        db.add(asset)
        db.commit()
        asset_id = asset.id
        d["asset_id"] = asset.id
    log_task("video.create", asset_id=asset_id, video_id=vid,
             model=req.payload.get("model"), mode=req.payload.get("mode"),
             seconds=req.payload.get("seconds"), prompt=(req.payload.get("prompt") or "")[:80],
             upstream_status=d.get("status"), latency_ms=int((_time.monotonic() - started) * 1000))
    return d


class AgnesPolishRequest(BaseModel):
    prompt: str = ""                       # 简单模式：一段话
    modules: dict | None = None            # 高级模式：六要素分模块 {subject,action,camera,style,sound,consistency}


@router.post("/agnes/polish-video-prompt")
async def polish_video_prompt(req: AgnesPolishRequest):
    """视频提示词六要素润色。简单模式传 prompt；高级模式传 modules 分模块输入。"""
    _MODULE_LABELS = {
        "subject": "主体与场景", "action": "动作与变化", "camera": "镜头语言",
        "style": "视觉风格", "sound": "声音与节奏", "consistency": "一致性要求",
    }
    if req.modules:
        parts = [f"{label}：{str(req.modules.get(key, '')).strip()}"
                 for key, label in _MODULE_LABELS.items()
                 if str(req.modules.get(key, "") or "").strip()]
        if not parts:
            return {"error": "至少填写一个模块"}
        source = "\n".join(parts) + "\n\n（把以上分模块要点融合成连贯完整的视频提示词）"
    elif req.prompt.strip():
        source = req.prompt
    else:
        return {"error": "prompt 或 modules 至少提供一个"}
    try:
        polished = await agnes_service.polish_video_prompt(source)
        return {"polished": polished}
    except RuntimeError as e:
        return {"error": str(e)}


class AgnesImagePolishRequest(BaseModel):
    prompt: str = ""             # 简单模式
    modules: dict | None = None  # 高级模式：{subject,scene,style,lighting,composition,quality}


@router.post("/agnes/polish-image-prompt")
async def polish_image_prompt(req: AgnesImagePolishRequest):
    """图像提示词六要素润色（主体/场景/风格/光照/构图/质量）。"""
    source = agnes_service.build_image_source(req.prompt, req.modules)
    if not source:
        return {"error": "prompt 或 modules 至少提供一个"}
    try:
        polished = await agnes_service.polish_image_prompt(source)
        return {"polished": polished}
    except RuntimeError as e:
        return {"error": str(e)}


class AgnesReviseRequest(BaseModel):
    prompt: str = Field(..., min_length=1)       # 现有提示词（通常是润色产物）
    instruction: str = Field(..., min_length=1)  # 自然语言修改指令
    kind: str = "video"                          # video / image（选对应系统约束）


@router.post("/agnes/revise-video-prompt")
async def revise_video_prompt(req: AgnesReviseRequest, db: Session = Depends(get_db)):
    """对已生成提示词做指定性修订：自然语言指令 → 专业提示词改写（视频/图像通用）。"""
    import time as _time
    started = _time.monotonic()
    try:
        revised = await agnes_service.revise_video_prompt(
            req.prompt, req.instruction, req.kind or "video")
        log_task("prompt.revise", kind=req.kind, instruction=req.instruction[:80],
                 in_len=len(req.prompt), out_len=len(revised),
                 latency_ms=int((_time.monotonic() - started) * 1000))
        return {"polished": revised}
    except RuntimeError as e:
        log_task("prompt.revise_failed", kind=req.kind, instruction=req.instruction[:80], error=str(e)[:200])
        return {"error": str(e)}


@router.get("/agnes/videos/query")
async def video_query(video_id: str, model: str = "", db: Session = Depends(get_db)):
    import time as _time
    started = _time.monotonic()
    try:
        d = await agnes_service.query_video(video_id, model)
    except RuntimeError as e:
        log_task("video.query_error", video_id=video_id, error=str(e)[:200])
        return {"error": str(e)}
    # 同步落库：前端刷新后从列表接口拿最终状态，不必重查上游
    asset = db.query(LabAsset).filter(LabAsset.video_id == video_id).first()
    if asset and not d.get("error"):
        prev_status = asset.status
        asset.status = d.get("status") or asset.status
        asset.progress = d.get("progress") or asset.progress
        asset.url = d.get("url") or (d.get("metadata") or {}).get("url") or asset.url
        asset.internal_progress = d.get("internal_progress")
        asset.internal_status = d.get("internal_status")
        asset.upstream_completed_at = d.get("completed_at")
        asset.last_response = json.dumps(d, ensure_ascii=False)
        if d.get("status") == "failed":
            asset.error = str((d.get("error") or {}) if isinstance(d.get("error"), dict) else d.get("error"))[:500]
        db.commit()
        # 状态变化/终态才记日志（常规 3s 轮询不刷屏）
        if prev_status != asset.status or asset.status in ("completed", "failed"):
            duration = None
            if asset.status == "completed" and d.get("created_at") and d.get("completed_at"):
                duration = d["completed_at"] - d["created_at"]
            log_task("video.status_change", asset_id=asset.id, video_id=video_id,
                     model=asset.model, from_status=prev_status, to_status=asset.status,
                     progress=asset.progress, internal_progress=asset.internal_progress,
                     internal_status=asset.internal_status,
                     upstream_duration_s=duration,
                     latency_ms=int((_time.monotonic() - started) * 1000))
    return d
