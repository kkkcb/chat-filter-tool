"""视觉 Schema"""
from pydantic import BaseModel


class VisionRequest(BaseModel):
    image: str
    mode: str = "describe"
    prompt: str = ""


class VisionResponse(BaseModel):
    reply: str
