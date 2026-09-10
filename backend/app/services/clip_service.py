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
    async def _fetch_html(url: str, timeout: int = 40) -> str | None:
        """获取网页 HTML（大页面如微信长文可达数 MB，timeout 给足；失败重试一次）"""
        headers = {
            # 完整真实的浏览器 UA——残缺 UA（以 AppleWebKit/537.36 结尾）会被
            # 微信等站点的风控识别为机器人，间歇性 403
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                    resp = await client.get(url, headers=headers)
                    if resp.status_code == 200:
                        # 不走 httpx 的 encoding 属性——畸形 Content-Type 头（实测
                        # 微信部分响应解析出 "utf-8, text/html"）会让它抛
                        # unknown encoding。直接按字节解码，utf-8 → gb18030 兜底
                        raw = resp.content
                        for enc in ("utf-8", "gb18030"):
                            try:
                                return raw.decode(enc)
                            except UnicodeDecodeError:
                                continue
                        return raw.decode("utf-8", errors="replace")
            except Exception as e:
                print(f"[Clip] 获取失败(第{attempt + 1}次) {url}: {e}")
        return None

    @staticmethod
    async def _fetch_github(url: str) -> dict | None:
        """GitHub: About + README（优先 API，页面 HTML 兜底）

        部分机房到 github.com 主页超时但 api.github.com 正常（实测火山
        轻量香港即如此），故 API 优先：About 走 repo 信息、README 走
        readme 端点（匿名限流 60/h，个人使用足够）。
        """
        match = re.match(r"https?://github\.com/([^/]+)/([^/]+)", url)
        if not match:
            return None
        owner, repo = match.group(1), match.group(2).rstrip("/").replace(".git", "")

        desc, readme = "", ""
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                r = await client.get(
                    f"https://api.github.com/repos/{owner}/{repo}",
                    headers={"Accept": "application/vnd.github+json"})
                if r.status_code == 200:
                    info = r.json()
                    desc = info.get("description") or ""
                    rr = await client.get(
                        f"https://api.github.com/repos/{owner}/{repo}/readme",
                        headers={"Accept": "application/vnd.github.raw"})
                    if rr.status_code == 200:
                        readme = rr.text[:3000]
        except Exception as e:
            print(f"[Clip] GitHub API 失败: {e}")

        if desc or readme:
            return {
                "title": f"{owner}/{repo}",
                "summary": desc or f"GitHub 项目 {owner}/{repo}",
                "content": f"## About\n\n{desc}\n\n## README (节选)\n\n{readme}",
                "extra_text": "",
            }

        # 兜底：老路径（抓页面 HTML 解析 og:description + 渲染后 README）
        page_url = f"https://github.com/{owner}/{repo}"
        html = await ClipService._fetch_html(page_url)
        if not html:
            return None

        soup = BeautifulSoup(html, "lxml")

        # About (og:description)
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

        # 微信的占位页（参数错误/环境异常/已删除等）也是 200，先识别出来，
        # 避免解析出一篇「未知标题 空页面」让用户误以为抓取坏了
        for marker in ("参数错误", "环境异常", "已被发布者删除", "此内容因违规", "链接已过期"):
            if marker in html:
                return {
                    "title": "链接无法访问",
                    "summary": f"微信返回「{marker}」",
                    "content": "",
                    "extra_text": "",
                    "dead_link": True,
                }

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
