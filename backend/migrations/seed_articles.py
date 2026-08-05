"""文章路线种子数据 — 20 篇文章规划"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import Column, Integer, Text, Index
from app.core.database import Base, engine, SessionLocal, init_db


class Article(Base):
    __tablename__ = "articles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    seq = Column(Integer, nullable=False)           # 序号 1-20
    title = Column(Text, nullable=False)
    stage = Column(Text, nullable=False)             # 阶段
    phase = Column(Text, nullable=False)             # 大阶段
    concept_desc = Column(Text, default="")          # 概念描述
    core_concepts = Column(Text, default="")         # 核心概念
    theory = Column(Text, default="")                # 理论依据
    metaphor = Column(Text, default="")              # 核心比喻
    foreshadow = Column(Text, default="[]")          # 螺旋伏笔 (JSON array)
    task = Column(Text, default="")                  # 迁移任务
    next_hook = Column(Text, default="")             # 衔接下一篇
    status = Column(Text, default="planned")         # planned/drafting/published
    created_at = Column(Text, default="")


ARTICLES = [
    # 阶段一 · 先用起来
    {"seq":1,"title":"亲手让 AI 为你做一件事","stage":"整体感知","phase":"阶段一·先用起来",
     "concept_desc":"不讲定义，先让读者用一次 AI，体验输入一句话到拿到结果的魔法时刻",
     "core_concepts":"AI 助手 / 聊天机器人",
     "theory":"fast.ai whole game · 情境学习",
     "metaphor":"AI 像一个反应神速的实习生",
     "foreshadow":["流式输出","提示词"],
     "task":"用 AI 帮你处理一件自己的小事",
     "next_hook":"它什么都能做吗？下一篇告诉你它的边界。"},

    {"seq":2,"title":"AI 做得好与做不好的事（含 AI 视频好坏差异）","stage":"边界澄清","phase":"阶段一·先用起来",
     "concept_desc":"用正反例给新手清晰规则；把 AI 视频质量差异作为边界现象",
     "core_concepts":"生成式 AI vs 判别式 AI",
     "theory":"工作样例效应 · 新手规则",
     "metaphor":"视频质量差异 = 同一道菜，厨师手感和配方不同",
     "foreshadow":["文生视频","AIGC"],
     "task":"观察身边一个 AI 用得好和用砸的场景",
     "next_hook":"既然它有边界，那它到底是什么？"},

    # 阶段二 · 核心概念解码
    {"seq":3,"title":"到底什么是大语言模型","stage":"概念解码","phase":"阶段二·核心概念解码",
     "concept_desc":"读者已用过、看过边界，概念终于有了挂靠点",
     "core_concepts":"大语言模型 LLM / 人工智能",
     "theory":"先行组织者 · 认知负荷",
     "metaphor":"AI = 一个特别勤奋、只从海量例子里学手感的学徒（全系列锚点）",
     "foreshadow":["机器学习","深度学习"],
     "task":"用一句话向家人解释 AI 是什么",
     "next_hook":"它到底在算什么？要从 Token 说起。"},

    {"seq":4,"title":"Token：AI 世界的基本单位","stage":"概念解码","phase":"阶段二·核心概念解码",
     "concept_desc":"AI 处理文本的最小颗粒，决定计费和长度上限",
     "core_concepts":"Token / 分词",
     "theory":"功能型比喻 · 一文一概念",
     "metaphor":"Token = 里程表的最小一格；按 Token 计费 = 按里程计费",
     "foreshadow":["Token 计费","上下文窗口"],
     "task":"观察一段话被切成了多少 Token",
     "next_hook":"Token 决定了它一次能记住多少。下一篇讲上下文。"},

    {"seq":5,"title":"上下文：AI 的短期记忆","stage":"概念解码","phase":"阶段二·核心概念解码",
     "concept_desc":"AI 一次对话能记住并处理的文字长度",
     "core_concepts":"上下文 / 上下文窗口",
     "theory":"工作记忆容量限制的类比映射",
     "metaphor":"上下文窗口 = AI 的短期记忆格子，装满就忘前面的",
     "foreshadow":["温度","流式输出"],
     "task":"测试你的 AI 到第几轮开始忘事",
     "next_hook":"它记性有限，而且会编。下一篇讲幻觉。"},

    {"seq":6,"title":"幻觉：AI 为什么会一本正经地胡说","stage":"概念解码","phase":"阶段二·核心概念解码",
     "concept_desc":"用 AI 最大风险，必须教识别方法",
     "core_concepts":"幻觉 Hallucination",
     "theory":"功能型比喻 · Bloom 理解层",
     "metaphor":"幻觉 = 一个极其自信的骗子：不知道答案但很会编",
     "foreshadow":["知识截止","安全对齐"],
     "task":"让 AI 编一个错误事实，再验证它",
     "next_hook":"它为什么会编？因为它有知识截止。"},

    {"seq":7,"title":"知识截止与联网搜索：AI 怎么知道新鲜事","stage":"概念解码","phase":"阶段二·核心概念解码",
     "concept_desc":"解释为什么它不知道昨天新闻，并引入联网功能",
     "core_concepts":"知识截止 / 联网搜索 / AI 搜索",
     "theory":"认知冲突驱动好奇（Loewenstein 缺口）",
     "metaphor":"知识截止 = AI 的教材印在去年；联网 = 临时翻开今年新课本",
     "foreshadow":["RAG","深度研究"],
     "task":"对比开关联网前后，AI 回答的差异",
     "next_hook":"知道了它的局限，怎么让它更好用？从提示词开始。"},

    # 阶段三 · 用好工具
    {"seq":8,"title":"提示词工程：怎么让 AI 听你的话","stage":"工具迁移","phase":"阶段三·用好工具",
     "concept_desc":"概念稳定后立即上工具，让读者获得胜任感",
     "core_concepts":"提示词工程 / 系统提示词",
     "theory":"Bloom 应用层 · SDT 胜任感",
     "metaphor":"Prompt = 给实习生的需求说明书；系统提示词 = AI 的人设剧本",
     "foreshadow":["越狱/注入"],
     "task":"用 3 个模板写一条自己工作中的 Prompt",
     "next_hook":"它只会文字吗？下一篇它长出了眼睛耳朵。"},

    {"seq":9,"title":"多模态：AI 的眼睛和耳朵","stage":"工具迁移","phase":"阶段三·用好工具",
     "concept_desc":"AI 不止文字，还能看图听声",
     "core_concepts":"多模态 / 文生图",
     "theory":"功能型比喻（五官）",
     "metaphor":"多模态 = AI 长出了五官，能看图、听声、读字",
     "foreshadow":["嵌入/向量"],
     "task":"给 AI 一张图，看它怎么理解",
     "next_hook":"这些能力也能被用来骗人。下一篇讲 AI 的暗面。"},

    {"seq":10,"title":"数字人与语音克隆：AI 的暗面","stage":"工具迁移","phase":"阶段三·用好工具",
     "concept_desc":"安全警觉篇",
     "core_concepts":"数字人 / 语音克隆 / AIGC 诈骗防范",
     "theory":"情境学习（真实案例 anchor）",
     "metaphor":"眼见不再为实：AI 让面具变得完美",
     "foreshadow":["越狱/注入","隐私"],
     "task":"学会 3 招辨别 AI 生成的虚假内容",
     "next_hook":"了解了风险，我们来深入它到底怎么想的。"},

    # 阶段四 · 深挖本质
    {"seq":11,"title":"思考不是推理：两个最容易搞混的词","stage":"螺旋深挖","phase":"阶段四·深挖本质",
     "concept_desc":"中文圈最大的术语灾难，几乎所有媒体都混用",
     "core_concepts":"思考 reasoning vs 推理 inference / 推理模型",
     "theory":"术语消歧降低外在负荷（借鉴《AI Agent》做法）",
     "metaphor":"推理(inference) = 算出来；思考(reasoning) = 想一圈再算",
     "foreshadow":["深度研究"],
     "task":"对比普通模型和推理模型的回答差异",
     "next_hook":"它为什么会想？因为模型训练。"},

    {"seq":12,"title":"模型是怎么训练出来的","stage":"原理登场","phase":"阶段四·深挖本质",
     "concept_desc":"延迟满足：已有充分体感后才讲原理",
     "core_concepts":"模型 / 训练 / 参数量 / 微调 / RLHF",
     "theory":"延迟满足（数学/原理延后）",
     "metaphor":"训练 = 烧电的大师课；参数 = 模型脑中的旋钮数量；RLHF = 给野性学徒立规矩",
     "foreshadow":["涌现","蒸馏"],
     "task":"理解 7B 和 70B 的区别意味着什么",
     "next_hook":"训练这么费劲，为什么还要抢显卡？"},

    {"seq":13,"title":"为什么全世界在抢显卡：AI 的算力账单","stage":"原理登场","phase":"阶段四·深挖本质",
     "concept_desc":"强调要有事实依据，涉及 GPU/显存涨价",
     "core_concepts":"GPU / HBM / 算力 / Token 计费",
     "theory":"真实数据锚定（情境学习），TrendForce 可溯源",
     "metaphor":"GPU = 专门背算力的特种车间；HBM = 车间的临时仓库",
     "foreshadow":["训练vs推理成本","云端vs本地"],
     "task":"判断一则 AI 硬件涨价新闻说得对不对",
     "next_hook":"大模型为什么强、小模型为什么也能用？"},

    {"seq":14,"title":"涌现与蒸馏：大模型为什么强、小模型为什么便宜","stage":"螺旋深挖","phase":"阶段四·深挖本质",
     "concept_desc":"回应为什么有的模型强有的弱",
     "core_concepts":"涌现 / 蒸馏 / 小模型 SLM",
     "theory":"螺旋式回顾，二次接触讲透",
     "metaphor":"涌现 = 量变引起质变；蒸馏 = 大学生教小学生",
     "foreshadow":["MoE","Transformer"],
     "task":"判断你的手机能不能跑本地模型",
     "next_hook":"模型再强，也只是聊天。要让它干活，需要 Agent。"},

    # 阶段五 · 选对工具
    {"seq":15,"title":"Agent 智能体：从聊天到代办","stage":"概念解码","phase":"阶段五·选对工具",
     "concept_desc":"2025-2026 最大风口",
     "core_concepts":"Agent / 工具调用 / MCP / 工作流",
     "theory":"借鉴《AI Agent》大脑+眼睛+手脚；认知负荷锚点",
     "metaphor":"Agent = 会自己规划、动手办事的 AI；MCP = AI 的 USB 接口",
     "foreshadow":["插件/GPTs"],
     "task":"找一个你能用的 Agent 产品试用",
     "next_hook":"Agent 要用你的数据，怎么做到的？"},

    {"seq":16,"title":"RAG 与知识库：让 AI 用你的数据","stage":"概念解码","phase":"阶段五·选对工具",
     "concept_desc":"解决 AI 能不能用我公司的数据",
     "core_concepts":"RAG / 知识库 / 嵌入·向量",
     "theory":"功能型比喻",
     "metaphor":"RAG = 开卷考试先翻书；嵌入 = 把意思变成坐标",
     "foreshadow":["向量数据库"],
     "task":"体验一个带知识库的 AI 产品",
     "next_hook":"这么多模型，到底该选哪个？"},

    {"seq":17,"title":"怎么选 AI：榜单、开源闭源与国产模型","stage":"评价决策","phase":"阶段五·选对工具",
     "concept_desc":"帮读者做消费决策",
     "core_concepts":"Benchmark / 榜单 / 开源vs闭源 / 国产模型",
     "theory":"Bloom 评价层 · 批判性思维",
     "metaphor":"榜单 = AI 的月考排名；开源 = 配方公开谁都能做；闭源 = 秘方只在店里",
     "foreshadow":["云端vs本地"],
     "task":"为你最常做的任务选一个最合适的 AI",
     "next_hook":"AI 不只是聊天工具，它正在改变每个行业。"},

    # 阶段六 · 看懂 AI 世界
    {"seq":18,"title":"AI 编程与 Vibe Coding：人人能做软件","stage":"产业应用","phase":"阶段六·看懂AI世界",
     "concept_desc":"回应就业焦虑和要不要学编程",
     "core_concepts":"AI 编程 / Copilot / Vibe Coding",
     "theory":"情境学习 · 迁移 bridging",
     "metaphor":"Copilot = 坐在你旁边的副驾程序员；Vibe Coding = 用嘴写代码",
     "foreshadow":["Agent"],
     "task":"用 AI 写一段简单的小程序",
     "next_hook":"用 AI 之前，你的数据安全吗？"},

    {"seq":19,"title":"隐私与安全：你的数据去了哪里","stage":"评价决策","phase":"阶段六·看懂AI世界",
     "concept_desc":"解决敢不敢把隐私/公司资料喂给 AI",
     "core_concepts":"隐私 / 越狱·注入 / 云端vs本地",
     "theory":"真实案例 anchor · Bloom 评价",
     "metaphor":"云端 = 数据寄存在别人家；本地 = 自己的保险柜",
     "foreshadow":["安全/责任AI"],
     "task":"检查你最常用的 AI 产品的隐私条款",
     "next_hook":"学到这里，你已经能独立判断 AI 了。"},

    {"seq":20,"title":"你的 AI 学习地图：回顾与分叉路口","stage":"评价创造","phase":"阶段六·看懂AI世界",
     "concept_desc":"收束于高阶认知 + 自主选择",
     "core_concepts":"AGI / 全景综合 / 分支选择",
     "theory":"Bloom 创造 · 高路迁移 bridging · SDT 自主感",
     "metaphor":"你不再是做题的人，而是出题和验收的人",
     "foreshadow":["Transformer","MoE"],
     "task":"设计一个属于自己的 AI 工作流",
     "next_hook":"可参考《深入理解 AI Agent》等进阶书目"},
]


def seed():
    """导入文章路线数据"""
    init_db()
    Article.__table__.create(bind=engine, checkfirst=True)

    db = SessionLocal()
    try:
        existing = db.query(Article).count()
        if existing > 0:
            print(f"[种子] articles 表已有 {existing} 条，跳过")
            return

        for a in ARTICLES:
            article = Article(
                seq=a["seq"],
                title=a["title"],
                stage=a["stage"],
                phase=a["phase"],
                concept_desc=a["concept_desc"],
                core_concepts=a["core_concepts"],
                theory=a["theory"],
                metaphor=a["metaphor"],
                foreshadow=json.dumps(a["foreshadow"], ensure_ascii=False),
                task=a["task"],
                next_hook=a["next_hook"],
                status="planned",
            )
            db.add(article)

        db.commit()
        print(f"[种子] 成功导入 {len(ARTICLES)} 篇文章")
    except Exception as e:
        db.rollback()
        print(f"[种子] 失败: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
