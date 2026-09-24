"""对话 Schema"""
from typing import Optional
from pydantic import BaseModel


class FileAttachment(BaseModel):
    name: str = ""
    url: str = ""
    is_text: bool = False
    text_content: str = ""


class ChatRequest(BaseModel):
    message: str = ""
    image: Optional[str] = ""
    mode: Optional[str] = "describe"
    thinking: Optional[bool] = False
    use_rag: Optional[bool] = True   # 是否检索知识库并引用（前端「引用知识库」开关）
    use_web: Optional[bool] = False  # 是否允许模型调用 web_fetch 抓取网页（前端「联网抓取」开关）
    style: Optional[str] = ""
    persona_id: Optional[int] = None  # 人设笔记 id（tag=人设），注入为写作 system prompt        # 输出风格：explain/teach/concise/brainstorm（前端「输出风格」选择器）
    conversation_id: Optional[int] = None
    files: Optional[list[FileAttachment]] = None  # 上传的文件附件


class ChatResponse(BaseModel):
    type: str  # chat / vision / link
    reply: str
    success: bool = True
    action: Optional[str] = None  # confirm_save / already_saved
    entry: Optional[dict] = None
    citations: Optional[list] = None  # RAG 引用（缺此字段会被 response_model 静默滤掉）


class SaveConfirmRequest(BaseModel):
    entry: dict


class SaveConfirmResponse(BaseModel):
    success: bool = True
    entry: Optional[dict] = None
    message: str = ""
