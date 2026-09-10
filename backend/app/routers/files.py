"""通用文件上传路由 — 对话分析 + 笔记附件共用

支持类型：文本类（.txt .md .py .js .json .csv .yml .xml .html .css 等）
         PDF（提取文本） / Office（提示不支持预览）
         任意文件均可存储，AI 分析时文本类直接读内容，二进制类只传文件名和大小
"""
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel

from app.config import settings
from app.core.database import get_db

router = APIRouter()

UPLOAD_DIR = settings.inbox_path.parent / "data" / "uploads"
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB

# 文本类扩展名 → AI 可直接读内容
TEXT_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".py", ".js", ".ts", ".jsx", ".tsx",
    ".json", ".yaml", ".yml", ".xml", ".html", ".htm", ".css", ".scss",
    ".sql", ".sh", ".bat", ".ps1", ".env", ".ini", ".cfg", ".conf",
    ".log", ".csv", ".tsv", ".toml", ".rs", ".go", ".java", ".c", ".cpp",
    ".h", ".hpp", ".rb", ".php", ".vue", ".svelte",
}


def _safe_filename(name: str) -> str:
    if not name or name in (".", "..") or "/" in name or "\\" in name or ":" in name:
        raise HTTPException(400, "非法文件名")
    return name


@router.post("/files/upload")
async def upload_file(file: UploadFile = File(...)):
    """通用文件上传 → { url, name, size, is_text, text_content }"""
    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(400, "文件过大（最大 20MB）")

    original = os.path.basename(file.filename or "unnamed")
    ext = os.path.splitext(original)[1].lower()
    stored_name = f"{uuid.uuid4().hex[:12]}{ext}"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    (UPLOAD_DIR / stored_name).write_bytes(data)

    is_text = ext in TEXT_EXTENSIONS
    text_content = ""
    if is_text:
        try:
            text_content = data.decode("utf-8", errors="replace")[:50000]
        except Exception:
            text_content = ""

    return {
        "url": f"/api/files/{stored_name}",
        "name": original,
        "stored_name": stored_name,
        "size": len(data),
        "is_text": is_text,
        "text_content": text_content,
    }


@router.get("/files/{name}")
async def get_file(name: str):
    """文件下载/预览"""
    _safe_filename(name)
    path = UPLOAD_DIR / name
    if not path.is_file():
        raise HTTPException(404, "文件不存在")
    ext = os.path.splitext(name)[1].lower()
    if ext in TEXT_EXTENSIONS:
        return PlainTextResponse(path.read_text(encoding="utf-8", errors="replace"))
    return FileResponse(path, filename=name)
