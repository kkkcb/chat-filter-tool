"""自定义异常 + 全局异常处理器"""
from fastapi import Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    """应用异常基类"""
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code


class FetchError(AppError):
    """抓取失败"""
    pass


class LLMError(AppError):
    """AI 调用失败"""
    pass


async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.message},
    )
