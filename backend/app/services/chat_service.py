"""对话服务 — 编排 clip/vision/qa，统一入口"""
import re
import json

from sqlalchemy.orm import Session

from app.models.note import Note
from app.models.material import Material
from app.services.llm_service import llm_service, VISION_PRESETS
from app.services.material_service import MaterialService
from app.services.note_service import NoteService
from app.services.web_tools import WEB_TOOLS, execute_web_tool



# 输出风格库（借鉴 Claude Code output-style 插件的会话级输出约束）
OUTPUT_STYLES = {
    "explain": (
        "科普讲解型：面向公众号普通读者。每个概念先用一句大白话说清本质，"
        "再配一个生活化类比，最后给出「为什么重要」。术语首次出现必须解释，"
        "节奏循序渐进，读完有获得感。"
    ),
    "teach": (
        "循序教学型：像老师带学生。先抛一个引导问题，分步骤展开，每步讲清"
        "「做什么、为什么、易错点」；关键节点给出小结和自测问题，结尾布置"
        "一个小练习。"
    ),
    "concise": (
        "简洁高效型：直给结论，不做铺垫。优先用要点清单和短句；每个要点"
        "一行说透；没有废话和客套；需要展开时用折叠式的简短补充。"
    ),
    "brainstorm": (
        "创作脑暴型：发散优先。围绕主题给出多个不同角度的方案/选题/标题，"
        "包含一个反常规的意外角度；每个方案配一句卖点说明；最后标注你个人"
        "最推荐哪个及理由。"
    ),
}

class ChatService:
    """对话编排：根据输入类型分发到不同处理逻辑"""

    def __init__(self, db: Session):
        self.db = db
        self.material_svc = MaterialService(db)
        self.note_svc = NoteService(db)

    async def handle_message(self, message: str, image: str = "", mode: str = "describe", history: list | None = None) -> dict:
        """
        统一入口：
        - 有图片 → 视觉分析
        - 有 URL → 链接处理
        - 否则 → 知识库对话（history 为多轮对话历史 [{"role","content"}]）
        """
        if image:
            return await self._handle_vision(image, message, mode)

        url_match = re.search(r"https?://[^\s<>\"']+", message)
        if url_match:
            return await self._handle_link(url_match.group(0))

        return await self._handle_chat(message, history or [])

    async def _handle_vision(self, image: str, prompt: str, mode: str) -> dict:
        """图片视觉分析"""
        actual_prompt = prompt if prompt else VISION_PRESETS.get(mode, VISION_PRESETS["describe"])
        mode_labels = {
            "describe": "📝 图片描述", "ocr": "🔤 文字提取", "ui": "🎨 UI分析",
            "error": "❌ 错误诊断", "diagram": "📊 图表解读", "chart": "📈 数据分析",
        }
        label = mode_labels.get(mode, "🔍 视觉分析")

        result = await llm_service.vision(image, actual_prompt)
        if result:
            return {"type": "vision", "reply": f"**{label}**\n\n{result}"}
        return {"type": "vision", "reply": "图片分析失败，请重试。"}

    async def _handle_link(self, url: str) -> dict:
        """链接处理 — 抓取+总结，但不自动保存，等用户确认"""
        result = await self.material_svc.preview_url(url)

        if not result.get("success"):
            if result.get("error") == "已存在":
                entry = result["entry"]
                return {
                    "type": "link",
                    "success": True,
                    "action": "already_saved",
                    "reply": f"**已在知识库中**\n\n**{entry['title']}**\n\n分类: {entry['category']}\n\n[查看原文]({url})",
                    "entry": entry,
                }
            return {"type": "link", "success": False, "reply": f"抓取失败：{result.get('error', '未知错误')}\n\n链接：{url}"}

        entry = result["entry"]
        source_labels = {"github": "GitHub 项目", "wechat": "公众号文章", "web": "网页"}
        source_label = source_labels.get(entry.get("source_type", "web"), "网页")

        reply = (
            f"**抓取成功**\n\n"
            f"**{entry['title']}**\n\n"
            f"- 来源：{source_label}\n"
            f"- 分类：{entry['category']}\n"
            f"- 标签：{', '.join(entry['tags']) if entry['tags'] else '无'}\n"
            f"- 摘要：{entry.get('summary') or '暂无'}\n"
        )
        if entry.get("extra_text"):
            reply += f"- 附加：{entry['extra_text']}\n"
        reply += f"\n[查看原文]({url})\n\n---\n**是否保存到知识库素材？**（保存后在 知识库 → 素材 聚合看大纲）"

        return {
            "type": "link",
            "success": True,
            "action": "confirm_save",
            "reply": reply,
            "entry": entry,
        }

    async def handle_message_stream(self, message: str = "", image: str = "", mode: str = "describe", thinking: bool = False, history: list | None = None, use_rag: bool = True, files: list | None = None, use_web: bool = False, style: str = "", persona: str = ""):
        """流式版统一入口 — yield (event_type, data_dict)"""
        if image:
            # 图片不支持流式，降级为普通调用
            result = await self._handle_vision(image, message, mode)
            yield ("done", result)
            return

        url_match = re.search(r"https?://[^\s<>\"']+", message)
        if url_match:
            # 联网开启时：链接 + 还有别的话（如"总结下 https://… 这篇"）
            # 走对话流，让模型自己调 web_fetch 工具——比静默转存素材更符合提问意图；
            # 纯链接（粘贴收藏场景）仍走原有的抓取→确认保存流程
            url_only = message.strip() == url_match.group(0).strip()
            if not (use_web and not url_only):
                result = await self._handle_link(url_match.group(0))
                yield ("done", result)
                return

        # 文件附件内容注入
        if files:
            file_parts = []
            for f in files[:3]:  # 最多 3 个文件
                name = f.get("name", "未知文件")
                if f.get("is_text") and f.get("text_content"):
                    file_parts.append(f"--- 文件: {name} ---\n{f['text_content'][:8000]}\n--- 文件结束 ---")
                else:
                    size_kb = f.get("size", 0) // 1024
                    file_parts.append(f"[附件: {name} ({size_kb}KB, 非文本文件)]")
            if file_parts:
                message = message + "\n\n以下是用户上传的文件内容：\n\n" + "\n\n".join(file_parts)

        # 普通对话走流式
        async for event in self._handle_chat_stream(message, thinking, history or [], use_rag=use_rag, use_web=use_web, style=style, persona=persona):
            yield event

    def _build_rag(self, question: str) -> tuple[str, list]:
        """合并素材库 + 个人知识库笔记的 RAG 上下文"""
        mat_ctx, mat_cites = self.material_svc.build_rag_context(question)
        note_ctx, note_cites = self.note_svc.build_note_context(question)
        context = "\n\n".join(x for x in (mat_ctx, note_ctx) if x)
        return context, mat_cites + note_cites

    def _build_messages(self, question: str, rag_context: str, history: list, style: str = "", persona: str = "") -> list[dict]:
        """组装完整 messages：system + 多轮历史 + 当前问题。style 为输出风格注入"""
        if not rag_context:
            system_content = (
                "你是一个AI科普创作助手，帮助用户运营AI科普公众号。请结合用户知识库素材（如有）回答问题。\n"
                "输出规则：凡是要展示 HTML/XML 标签的字面写法（如 <img>、<div>），必须用反引号包裹成行内代码（如 `<img>`），"
                "否则会被页面渲染吞掉导致内容缺失。"
            )
        else:
            system_content = (
                "你是一个AI科普创作助手。用户正在运营AI科普公众号，坚持「一文一概念」系列。\n\n"
                "输出规则：凡是要展示 HTML/XML 标签的字面写法（如 <img>、<div>），必须用反引号包裹成行内代码（如 `<img>`），否则会被页面渲染吞掉。\n\n"
                f"{rag_context}\n\n"
                "上方是与问题可能相关的知识库内容（收藏素材 + 个人知识库笔记）。\n"
                "请基于这些内容回答用户的问题。要求：\n"
                "1. **只在素材内容直接支撑你的论点时才引用**：句末用 [序号] 标注素材、[N序号] 标注笔记；"
                "与回答无关的素材不要硬凑引用\n"
                "2. 引用了才在回答末尾列「参考资料」（序号 + 标题 + 链接，笔记写「个人笔记」）；"
                "一条引用都没有就**不要**输出参考资料部分\n"
                "3. 闲聊、简单问答、与知识库无关的问题（比如打招呼、问你是谁）直接正常回答，不提素材\n"
                "4. 用户问某个技能/工具/理论时优先从知识库找依据；用户曾踩过的坑（笔记有记录）要主动提醒\n"
                "5. 回答简洁有干货，适合中文表达"
            )
        # 输出风格注入（借鉴 Claude Code output-style：会话级输出约束）
        style_block = OUTPUT_STYLES.get(style)
        if style_block:
            system_content += f"\n\n【输出风格要求】\n{style_block}"
        # 人设注入（写作助手）：完整替代默认科普通识，置于 system 最前。
        # 无人设且无 RAG 上下文 → 完全不带 system（纯模型直答）
        if persona:
            base_persona = ("你是一个AI科普创作助手的底盘能力：知识准确、不编造数据。\n\n"
                            if not rag_context else "")
            system_content = base_persona + persona + "\n\n---\n以下为检索上下文与输出规则（人设优先级最高）：\n" + system_content
            messages = [{"role": "system", "content": system_content}]
        elif rag_context:
            messages = [{"role": "system", "content": system_content}]
        else:
            messages = []
        # 多轮历史（role/content 均已校验，见路由层 _load_history）
        messages.extend(history)
        messages.append({"role": "user", "content": question})
        return messages

    def _resolve_mentions(self, question: str) -> str:
        """解析消息里的 @标题 引用（pi 式 @ mention）：
        命中笔记/素材则把正文节选注入为显式上下文，比 RAG 检索更精准。
        """
        import re as _re
        refs = _re.findall(r"@[一-龥A-Za-z0-9_\-·]{2,30}", question)
        if not refs:
            return ""
        parts = []
        for ref in refs[:3]:  # 最多注入 3 条，防撑爆
            title = ref[1:]
            note = self.db.query(Note).filter(Note.title.like(f"%{title}%")).first()
            if note:
                parts.append(f"[引用@{note.title}]（个人笔记）\n{(note.content or '')[:1200]}")
                continue
            mat = self.db.query(Material).filter(Material.title.like(f"%{title}%")).first()
            if mat:
                parts.append(f"[引用@{mat.title}]（素材）\n{(mat.summary or '')[:600]}")
        if not parts:
            return ""
        return "用户在消息里显式引用了以下内容（优先依据它们回答）：\n\n" + "\n\n".join(parts)

    async def _handle_chat_stream(self, question: str, thinking: bool = False, history: list | None = None, use_rag: bool = True, use_web: bool = False, style: str = "", persona: str = ""):
        """流式知识库对话（use_web=True 时模型可调用 web_fetch 工具抓网页）"""
        rag_context, citations = self._build_rag(question) if use_rag else ("", [])
        mention_ctx = self._resolve_mentions(question)
        if mention_ctx:
            rag_context = (rag_context + "\n\n" + mention_ctx).strip()
        messages = self._build_messages(question, rag_context, history or [], style=style, persona=persona)

        # 工具提示注入 system（GLM 拿到 tools 规格，这里补充「何时该用」）
        # 原生 web_search 由智谱服务端执行（按次计费，费用很低），web_fetch 由本机执行
        tools = None
        if use_web:
            tools = [
                {"type": "web_search", "web_search": {"search_result": True}},
                *WEB_TOOLS,
            ]
            messages[0]["content"] += (
                "\n\n你配有 web_search（关键词搜索，拿案例/找资料/查最新信息用）和 "
                "web_fetch（抓取指定网页正文）两个工具：需要具体案例、代码示例、"
                "最新信息而你手上没有时，先搜索再按需抓取结果页正文；"
                "用户消息里的链接要用 web_fetch 读取。抓取失败要如实告知。"
                "与外部信息无关的问题不要调用。打算继续调用工具时直接调用，不要只口头说「我再抓一下」。"
            )

        # 发送引用信息
        if citations:
            yield ("citations", citations)

        full_content = ""
        # 工具轮次上限：搜索后模型常要连抓 3-5 个页面（实测 3 轮不够被掐断，
        # 产出 0 字正文）。最后一轮不再下发工具，强制模型基于已有材料作答，
        # 从机制上保证不会"轮次耗尽、正文为空"
        MAX_TOOL_ROUNDS = 6
        for _round in range(MAX_TOOL_ROUNDS):
            round_tools = tools if _round < MAX_TOOL_ROUNDS - 1 else None
            tool_calls = None
            async for chunk_type, chunk_text in llm_service.chat_stream(
                messages, thinking=thinking, tools=round_tools
            ):
                if chunk_type == "error":
                    yield ("error", chunk_text)
                    return
                if chunk_type == "tool_calls":
                    tool_calls = chunk_text
                    continue
                yield (chunk_type, chunk_text)
                if chunk_type == "content":
                    full_content += chunk_text

            if not tool_calls:
                break

            # 执行工具并把结果回灌，模型继续生成（正文接着上一轮流）
            messages.append({"role": "assistant", "content": "", "tool_calls": tool_calls})
            for tc in tool_calls:
                fn = tc.get("function", {})
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                # 通知前端正在抓取（气泡上显示工具调用痕迹）
                yield ("tool_status", {"name": fn.get("name", ""), "url": str(args.get("url", ""))[:200]})
                result = await execute_web_tool(fn.get("name", ""), args)
                messages.append({"role": "tool", "tool_call_id": tc.get("id", ""), "content": result})

        # 兜底：任何路径下都不存 0 字正文（刷新后气泡全空、双击只看到 content_length:0）
        if not full_content.strip():
            full_content = "（模型未返回正文，可能是服务繁忙，请点 ↻ 重试）"
        yield ("done", {"type": "chat", "reply": full_content})

    async def _handle_chat(self, question: str, history: list | None = None, style: str = "", persona: str = "") -> dict:
        """知识库对话 — 自动检索相关素材并引用"""
        rag_context, citations = self._build_rag(question)
        messages = self._build_messages(question, rag_context, history or [], style=style, persona=persona)

        reply = await llm_service.chat(messages)

        return {
            "type": "chat",
            "reply": reply or "暂时无法回答，请稍后再试。",
            "citations": citations,
        }
