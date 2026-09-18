"""Agnes AI 免费模型服务 —— 文本/图片/视频统一代理。

只放免费模型（2026-09 平台"当前优惠"现价 ¥0），收费模型明确排除：
agnes-2.5-pro / -pro-alpha / -pro-beta / agnes-video-2.5（非 flash）。
Key 只存后端环境变量，前端永远经本服务转发。

接口要点（实测 + 官方文档）：
- 文本：标准 OpenAI /chat/completions（agnes-3.0-flash 实测通过）
- 图片：/images/generations，size 传 1K~4K 档位 + ratio 比例；
  response_format 必须放 extra_body 里（顶层会被忽略）
- 视频 2.5-flash：/videos 创建，size 固定字符串 "720P"、seconds 是
  字符串 "4"~"12"、mode: text/keyframe/reference
- 视频 v2.0：同端点，但时长用 num_frames(8n+1)/frame_rate 控制，
  分辨率用 width/height；两者查询都在域名根 /agnesapi（不在 /v1 下）
- 免费档有速率限制（实测 429），错误原样透传给前端提示
"""
import json
from typing import AsyncGenerator

import httpx

from app.config import settings

# 免费模型注册表（kind 决定前端控件与端点）
AGNES_FREE_MODELS = {
    "text": [
        {"id": "agnes-3.0-flash", "name": "Agnes 3.0 Flash", "note": "最新一代，质量优先"},
        {"id": "agnes-2.5-flash", "name": "Agnes 2.5 Flash", "note": "上一代，速度优先"},
    ],
    "image": [
        {"id": "agnes-image-2.5-flash", "name": "Image 2.5 Flash", "note": "最新一代，高信息密度"},
        {"id": "agnes-image-2.1-flash", "name": "Image 2.1 Flash", "note": "上一代"},
    ],
    "video": [
        {"id": "agnes-video-2.5-flash", "name": "Video 2.5 Flash", "note": "720P 限时免费，文/首尾帧/参考图"},
        {"id": "agnes-video-v2.0", "name": "Video V2.0", "note": "时长全免，帧级参数控制"},
    ],
}

TIMEOUT = httpx.Timeout(connect=15, read=360, write=30, pool=15)


def _headers() -> dict:
    return {"Authorization": f"Bearer {settings.agnes_api_key}"}


def _base() -> str:
    return settings.agnes_api_base.rstrip("/")


def _root() -> str:
    """视频轮询端点在域名根（/agnesapi），不在 /v1 下。"""
    from urllib.parse import urlsplit
    parts = urlsplit(_base())
    return f"{parts.scheme}://{parts.netloc}"


def key_configured() -> bool:
    return bool(settings.agnes_api_key)


def _err_detail(e: httpx.HTTPError) -> str:
    body = ""
    if isinstance(e, httpx.HTTPStatusError) and e.response is not None:
        body = e.response.text[:300]
    return f"{type(e).__name__}: {e} {body}".strip()


async def stream_chat(model: str, messages: list[dict]) -> AsyncGenerator[str, None]:
    """流式对话：透传上游 OpenAI SSE，重组为前端统一事件格式。"""
    payload = {"model": model, "messages": messages, "stream": True}
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        async with client.stream("POST", f"{_base()}/chat/completions",
                                 headers=_headers(), json=payload) as resp:
            if resp.status_code != 200:
                text = (await resp.aread()).decode(errors="replace")[:300]
                yield f"data: {json.dumps({'type': 'error', 'data': f'上游 {resp.status_code}: {text}'}, ensure_ascii=False)}\n\n"
                return
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content")
                if content:
                    yield f"data: {json.dumps({'type': 'content', 'data': content}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"


async def generate_image(model: str, prompt: str, size: str = "1K", ratio: str = "1:1",
                         ref_images: list[str] | None = None) -> dict:
    """文生图/图生图。response_format 放 extra_body（顶层无效）。"""
    extra: dict = {"response_format": "url"}
    if ref_images:
        extra["image"] = ref_images
    payload = {"model": model, "prompt": prompt, "size": size,
               "extra_body": extra}
    if ratio:
        payload["ratio"] = ratio
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(f"{_base()}/images/generations",
                                 headers=_headers(), json=payload)
        if resp.status_code != 200:
            raise RuntimeError(f"上游 {resp.status_code}: {resp.text[:300]}")
        data = resp.json()["data"][0]
        return {"url": data.get("url"), "b64": data.get("b64_json")}


async def create_video(payload: dict) -> dict:
    """创建视频任务（按模型白名单校验，字段由前端按模型组装）。"""
    model = payload.get("model", "")
    allowed = {m["id"] for m in AGNES_FREE_MODELS["video"]}
    if model not in allowed:
        raise ValueError(f"仅支持免费视频模型: {sorted(allowed)}")
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(f"{_base()}/videos", headers=_headers(), json=payload)
        if resp.status_code != 200:
            raise RuntimeError(f"上游 {resp.status_code}: {resp.text[:300]}")
        return resp.json()


async def query_video(video_id: str, model: str) -> dict:
    """轮询视频任务。查询端点在域名根 /agnesapi。"""
    params: dict = {"video_id": video_id}
    if model:
        params["model_name"] = model
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.get(f"{_root()}/agnesapi", headers=_headers(), params=params)
        if resp.status_code != 200:
            raise RuntimeError(f"上游 {resp.status_code}: {resp.text[:300]}")
        return resp.json()
