"""模型可调用的自建工具（function calling）— 让对话中的模型能主动抓取网页

设计：
- 工具规格用 OpenAI 兼容格式（GLM 的 tools 参数同构）
- 执行层复用 ClipService 的全部抓取经验：完整浏览器 UA（残缺 UA 会被
  微信风控 403）、字节级解码 utf-8→gb18030（畸形 Content-Type 不炸）、
  GitHub API 优先、微信 js_content 正文
- 每次抓取结果截断，避免撑爆上下文窗口
- 只允许 http/https 且拒绝内网/回环地址（防模型探测部署机自身）
"""
import re
from urllib.parse import urlparse

from app.services.clip_service import ClipService

# 提供给 GLM 的工具清单
WEB_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "web_fetch",
            "description": (
                "抓取一个网页并返回其标题和正文文本。当用户消息里包含链接、"
                "或回答需要引用某个网页的具体内容（文章、文档、版本说明、讨论帖等）时调用。"
                "支持普通网页、微信公众号文章、GitHub 仓库页。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "完整 URL，必须以 http:// 或 https:// 开头",
                    },
                },
                "required": ["url"],
            },
        },
    }
]

# 结果截断：正文给 6000 字足够模型引用关键内容，又不至于挤爆上下文
_MAX_RESULT_CHARS = 6000

# 内网/回环防护：模型不该经由工具访问部署机自身或内网服务
_PRIVATE_HOST = re.compile(
    r"^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])",
    re.IGNORECASE,
)


async def execute_web_tool(name: str, arguments: dict) -> str:
    """工具调度入口 — 返回给模型的纯文本结果（失败也返回文字说明，不抛异常）"""
    if name != "web_fetch":
        return f"未知工具: {name}"
    url = (arguments or {}).get("url", "").strip()
    if not url:
        return "参数错误: 缺少 url"

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return f"仅支持 http/https 链接，收到: {parsed.scheme or '空'}"
    if not parsed.hostname or _PRIVATE_HOST.match(parsed.hostname):
        return "不允许访问内网/本机地址"

    try:
        data = await ClipService.fetch(url)
    except Exception as e:
        return f"抓取异常: {str(e)[:120]}"

    if not data:
        return f"抓取失败（超时或站点拒绝），URL: {url}"

    title = data.get("title") or url
    summary = data.get("summary") or ""
    content = data.get("content") or ""
    if not content:
        return f"标题: {title}\n摘要: {summary or '无'}\n（页面无可提取正文，可能是 JS 渲染页面）"

    text = f"标题: {title}\n"
    if summary:
        text += f"摘要: {summary}\n"
    text += f"正文:\n{content}"
    if len(text) > _MAX_RESULT_CHARS:
        text = text[:_MAX_RESULT_CHARS] + "\n…（正文过长已截断）"
    return text
