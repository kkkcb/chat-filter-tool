"""对话服务 — 编排 clip/vision/qa，统一入口"""
import re
import json

from sqlalchemy.orm import Session

from app.services.llm_service import llm_service, VISION_PRESETS
from app.services.material_service import MaterialService
from app.services.note_service import NoteService


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
        reply += f"\n[查看原文]({url})\n\n---\n**是否保存到素材库？**（保存后在「素材库」页面聚合阅读全文）"

        return {
            "type": "link",
            "success": True,
            "action": "confirm_save",
            "reply": reply,
            "entry": entry,
        }

    async def handle_message_stream(self, message: str, image: str = "", mode: str = "describe", thinking: bool = False, history: list | None = None, use_rag: bool = True):
        """流式版统一入口 — yield (event_type, data_dict)"""
        if image:
            # 图片不支持流式，降级为普通调用
            result = await self._handle_vision(image, message, mode)
            yield ("done", result)
            return

        url_match = re.search(r"https?://[^\s<>\"']+", message)
        if url_match:
            # 链接不支持流式，降级为普通调用
            result = await self._handle_link(url_match.group(0))
            yield ("done", result)
            return

        # 普通对话走流式
        async for event in self._handle_chat_stream(message, thinking, history or [], use_rag=use_rag):
            yield event

    def _build_rag(self, question: str) -> tuple[str, list]:
        """合并素材库 + 个人知识库笔记的 RAG 上下文"""
        mat_ctx, mat_cites = self.material_svc.build_rag_context(question)
        note_ctx, note_cites = self.note_svc.build_note_context(question)
        context = "\n\n".join(x for x in (mat_ctx, note_ctx) if x)
        return context, mat_cites + note_cites

    def _build_messages(self, question: str, rag_context: str, history: list) -> list[dict]:
        """组装完整 messages：system + 多轮历史 + 当前问题"""
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
        messages = [{"role": "system", "content": system_content}]
        # 多轮历史（role/content 均已校验，见路由层 _load_history）
        messages.extend(history)
        messages.append({"role": "user", "content": question})
        return messages

    async def _handle_chat_stream(self, question: str, thinking: bool = False, history: list | None = None, use_rag: bool = True):
        """流式知识库对话"""
        rag_context, citations = self._build_rag(question) if use_rag else ("", [])
        messages = self._build_messages(question, rag_context, history or [])

        # 发送引用信息
        if citations:
            yield ("citations", citations)

        # 流式输出
        full_content = ""
        async for chunk_type, chunk_text in llm_service.chat_stream(messages, thinking=thinking):
            if chunk_type == "error":
                yield ("error", chunk_text)
                return
            yield (chunk_type, chunk_text)
            if chunk_type == "content":
                full_content += chunk_text

        yield ("done", {"type": "chat", "reply": full_content})

    async def _handle_chat(self, question: str, history: list | None = None) -> dict:
        """知识库对话 — 自动检索相关素材并引用"""
        rag_context, citations = self._build_rag(question)
        messages = self._build_messages(question, rag_context, history or [])

        reply = await llm_service.chat(messages)

        return {
            "type": "chat",
            "reply": reply or "暂时无法回答，请稍后再试。",
            "citations": citations,
        }
