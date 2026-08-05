"""链接抓取服务 — 从 clip.py 提取，使用 BeautifulSoup4"""
import re
import httpx
from urllib.parse import urlparse

from bs4 import BeautifulSoup


class ClipService:
    """链接抓取引擎，纯函数，不含存储逻辑"""

    @staticmethod
    def detect_source(url: str) -> str:
        """检测来源类型"""
        host = urlparse(url).netloc.lower()
        if "github.com" in host:
            return "github"
        if "mp.weixin.qq.com" in host or "weixin" in host or "wechat" in host:
            return "wechat"
        return "web"

    @staticmethod
    async def fetch(url: str) -> dict | None:
        """统一抓取入口"""
        source = ClipService.detect_source(url)
        if source == "github":
            return await ClipService._fetch_github(url)
        elif source == "wechat":
            return await ClipService._fetch_wechat(url)
        else:
            return await ClipService._fetch_webpage(url)

    @staticmethod
    async def _fetch_html(url: str, timeout: int = 15) -> str | None:
        """获取网页 HTML"""
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    resp.encoding = resp.charset_encoding or "utf-8"
                    return resp.text
        except Exception as e:
            print(f"[Clip] 获取失败 {url}: {e}")
        return None

    @staticmethod
    async def _fetch_github(url: str) -> dict | None:
        """GitHub: About + README"""
        match = re.match(r"https?://github\.com/([^/]+)/([^/]+)", url)
        if not match:
            return None
        owner, repo = match.group(1), match.group(2).rstrip("/").replace(".git", "")

        page_url = f"https://github.com/{owner}/{repo}"
        html = await ClipService._fetch_html(page_url)
        if not html:
            return None

        soup = BeautifulSoup(html, "lxml")

        # About (og:description)
        desc = ""
        og_desc = soup.find("meta", property="og:description")
        if og_desc:
            desc = og_desc.get("content", "")

        # README
        readme = ""
        article = soup.find("article", class_=re.compile(r"markdown-body"))
        if article:
            readme = article.get_text(separator=" ", strip=True)[:3000]

        return {
            "title": f"{owner}/{repo}",
            "summary": desc or f"GitHub 项目 {owner}/{repo}",
            "content": f"## About\n\n{desc}\n\n## README (节选)\n\n{readme}",
            "extra_text": "",
        }

    @staticmethod
    async def _fetch_wechat(url: str) -> dict | None:
        """微信公众号文章"""
        html = await ClipService._fetch_html(url)
        if not html:
            return None

        soup = BeautifulSoup(html, "lxml")

        # 标题
        title = ""
        for selector in [
            lambda: soup.find("h1", id="activity-name"),
            lambda: soup.find("meta", property="og:title"),
        ]:
            el = selector()
            if el:
                title = el.get("content", "") or el.get_text(strip=True)
                if title:
                    break

        # 公众号名
        author = ""
        js_name = soup.find(id="js_name")
        if js_name:
            author = js_name.get_text(strip=True)

        # 正文
        content = ""
        js_content = soup.find(id="js_content")
        if js_content:
            content = js_content.get_text(separator=" ", strip=True)[:3000]

        return {
            "title": title or "未知标题",
            "summary": f"公众号「{author}」" if author else "",
            "content": content,
            "extra_text": f"来源: {author}" if author else "",
        }

    @staticmethod
    async def _fetch_webpage(url: str) -> dict | None:
        """普通网页"""
        html = await ClipService._fetch_html(url)
        if not html:
            return None

        soup = BeautifulSoup(html, "lxml")

        title = soup.find("title")
        title = title.get_text(strip=True) if title else url

        desc = ""
        meta_desc = soup.find("meta", attrs={"name": "description"}) or \
                    soup.find("meta", attrs={"property": "description"})
        if meta_desc:
            desc = meta_desc.get("content", "")

        # 正文
        body_text = ""
        body = soup.find("body")
        if body:
            # 移除 script/style
            for tag in body.find_all(["script", "style"]):
                tag.decompose()
            body_text = body.get_text(separator=" ", strip=True)[:2000]

        return {
            "title": title,
            "summary": desc,
            "content": body_text,
            "extra_text": "",
        }


clip_service = ClipService()
