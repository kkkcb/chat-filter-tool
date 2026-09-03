"""AI 科普工作台 — FastAPI 应用入口"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.core.database import init_db
from app.core.exceptions import AppError, app_error_handler
from app.routers import chat, vision, materials, inspire, conversations, notes, kb
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


# 全局访问令牌 + 按需放开 CORS：
# - 本机直连（Host 为 localhost/127.0.0.1，含 Vite 代理）：免鉴权，CORS 维持白名单
# - 公网域名（tunnel / 服务器，Host 为线上域名）：设了 APP_ACCESS_TOKEN 则所有
#   /api 需带 X-Access-Token / ?access_token= / Bearer（/api/health 放行探活），
#   并放开 CORS 供 Pages 前端跨源调用
# 注：tunnel 流量经 cloudflared 从本机回源，client.host 恒为 127.0.0.1，
# 因此用 Host 头（请求的目标域名）而非来源 IP 区分内外。
_LOCAL_HOSTS = {"localhost:8000", "127.0.0.1:8000", "localhost:5173", "127.0.0.1:5173",
                "localhost", "127.0.0.1", "[::1]:8000", "[::1]:5173"}


@app.middleware("http")
async def access_gate_and_cors(request: Request, call_next):
    path = request.url.path
    host = (request.headers.get("host") or "").lower()
    is_local = host in _LOCAL_HOSTS
    token = settings.app_access_token
    needs_auth = bool(token) and not is_local
    open_cors = needs_auth or path.startswith("/api/kb")

    if open_cors and path.startswith("/api") and request.method == "OPTIONS":
        from fastapi.responses import JSONResponse
        return JSONResponse(
            {},
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Access-Token",
            },
        )

    if needs_auth and path.startswith("/api") and path != "/api/health":
        supplied = request.headers.get("x-access-token") or request.query_params.get("access_token") or ""
        if not supplied:
            auth = request.headers.get("authorization") or ""
            if auth.lower().startswith("bearer "):
                supplied = auth[7:].strip()
        if supplied != token:
            from fastapi.responses import JSONResponse
            # 401 也必须带 CORS 头，否则跨源前端 fetch 被浏览器拦截、
            # 拿不到状态码，无法触发令牌输入弹窗
            return JSONResponse(
                {"detail": "需要访问令牌"},
                status_code=401,
                headers={"Access-Control-Allow-Origin": "*"},
            )

    response = await call_next(request)
    if open_cors and path.startswith("/api"):
        response.headers["Access-Control-Allow-Origin"] = "*"
    return response

# 注册路由
app.include_router(chat.router, prefix="/api", tags=["对话"])
app.include_router(vision.router, prefix="/api", tags=["视觉"])
app.include_router(materials.router, prefix="/api", tags=["素材"])
app.include_router(inspire.router, prefix="/api", tags=["灵感"])
app.include_router(conversations.router, prefix="/api", tags=["对话历史"])
app.include_router(notes.router, prefix="/api", tags=["个人知识库"])
app.include_router(kb.router, prefix="/api", tags=["知识库对外接口"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "2.1.0"}


# 生产环境：serve 前端 build 产物
# 注意：mount("/") 会匹配所有路径，必须放在所有路由注册之后
frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
