"""灵感路由"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.inspire import InspireRequest
from app.services.inspire_service import InspireService

router = APIRouter()


@router.post("/inspire")
async def inspire(req: InspireRequest, db: Session = Depends(get_db)):
    """灵感生成（选题/标题/角度）"""
    svc = InspireService(db)

    if req.action == "topics":
        topics = await svc.generate_topics()
        return {"topics": topics}
    elif req.action == "titles":
        titles = await svc.generate_titles(req.topic)
        return {"titles": titles}
    elif req.action == "angle":
        angles = await svc.generate_angles(req.topic)
        return {"angles": angles}

    return {"error": "未知操作"}
