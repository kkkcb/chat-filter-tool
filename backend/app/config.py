"""配置管理 — 从 .env 读取所有配置"""
import os
from pathlib import Path
from pydantic_settings import BaseSettings

# backend/app/ → backend/ → workspace/
BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    # GLM API
    glm_api_key: str = ""
    glm_endpoint: str = "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions"
    glm_model: str = "glm-5.2"
    glm_vision_model: str = "glm-4.6v"

    # Database
    database_path: str = "../data/workbench.db"

    # File Storage
    inbox_dir: str = "../../inbox"

    # App
    app_host: str = "0.0.0.0"
    app_port: int = 8000

    # 个人知识库对外接口（/api/kb）可选 token；不配置则本机免鉴权
    kb_api_token: str = ""

    # 全局访问令牌：公网部署（tunnel/服务器）时保护所有 /api（含 GLM key 调用）；
    # 设置后请求需带 X-Access-Token / ?access_token= / Bearer，/api/health 放行探活
    app_access_token: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

    @property
    def database_url(self) -> str:
        db_path = Path(self.database_path)
        if not db_path.is_absolute():
            db_path = BACKEND_DIR / db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{db_path}"

    @property
    def inbox_path(self) -> Path:
        p = Path(self.inbox_dir)
        if not p.is_absolute():
            p = BACKEND_DIR / p
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def categories(self) -> list[str]:
        return [
            "AI概念与原理", "AI工具与产品", "AI科普灵感",
            "GitHub项目", "行业资讯", "写作技巧", "待分类",
        ]


settings = Settings()
