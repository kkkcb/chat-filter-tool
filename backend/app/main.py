"""AI 科普工作台 — FastAPI 应用入口"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.core.database import init_db
from app.core.exceptions import AppError, app_error_handler
from app.routers import chat, vision, materials, inspire, conversations
from app.services.llm_service import llm_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时初始化数据库，退出时释放 LLM 连接池"""
    init_db()
    print(f"{'='*50}")
    print(f"  AI 科普工作台 (FastAPI)")
    print(f"{'='*50}")
    print(f"  API 文档: http://localhost:{settings.app_port}/docs")
    print(f"  数据库: {settings.database_url}")
    print(f"  素材目录: {settings.inbox_path}")
    print(f"{'='*50}")
    yield
    await llm_service.aclose()


app = FastAPI(
    title="AI 科普工作台",
    description="知识库对话 + 视觉理解 + 创作灵感",
    version="2.1.0",
    lifespan=lifespan,
)

# CORS — 前端开发经 Vite 代理同源访问，生产由本服务直接托管，
# 仅放行本地开发直连场景
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 异常处理
app.add_exception_handler(AppError, app_error_handler)

# 注册路由
app.include_router(chat.router, prefix="/api", tags=["对话"])
app.include_router(vision.router, prefix="/api", tags=["视觉"])
app.include_router(materials.router, prefix="/api", tags=["素材"])
app.include_router(inspire.router, prefix="/api", tags=["灵感"])
app.include_router(conversations.router, prefix="/api", tags=["对话历史"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "2.1.0"}


# 生产环境：serve 前端 build 产物
# 注意：mount("/") 会匹配所有路径，必须放在所有路由注册之后
frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
