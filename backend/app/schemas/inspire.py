"""灵感 Schema"""
from pydantic import BaseModel


class InspireRequest(BaseModel):
    action: str = "topics"  # topics / titles / angle
    topic: str = ""


class TopicItem(BaseModel):
    title: str
    concepts: list[str] = []
    reason: str = ""
    angle: str = ""


class TitleResult(BaseModel):
    titles: list[str] = []
