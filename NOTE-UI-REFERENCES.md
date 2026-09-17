# 笔记区复用建议与本轮验证

日期：2026-09-17

## GitHub 来源

| 项目 | 许可 | 适合 ICE 的部分 |
|---|---|---|
| [github-markdown-css](https://github.com/sindresorhus/github-markdown-css) | MIT | 阅读态标题层级、段落节奏、引用块、表格、代码排版；通过 markdown-body 局部作用域接入，不污染聊天区。 |
| [Tiptap](https://github.com/ueberdosis/tiptap) | MIT（开源核心） | 继续沿用当前编辑器，按已安装主版本选择官方 table/task-list/task-item 扩展；不要为表格、任务列表另写编辑引擎。 |
| [Mermaid](https://github.com/mermaid-js/mermaid) | MIT | 技术笔记中的流程图、时序图等，按需加载；不必为了渲染图表挂第二棵 React 树。 |
| [Outline](https://github.com/outline/outline) | BSL 1.1，非宽松开源许可 | 可参考阅读布局、目录导航和工具栏层级；不把公开仓库等同于可直接复制代码。 |

官方文档：
- https://tiptap.dev/docs/editor/extensions/nodes/table
- https://tiptap.dev/docs/editor/extensions/nodes/task-list
- https://mermaid.js.org/config/schema-docs/config.html

## 当前结构的实际限制

- TiptapEditor 注册了 StarterKit、Image、Placeholder 和 tiptap-markdown，没有表格、任务列表扩展。阅读态能显示表格不代表编辑后能无损保存。补扩展之前须先做 Markdown 编辑往返测试。
- 阅读态仍使用统一 markdown-it / DOMPurify / KaTeX 管线。样式库只能改善排版，不能补齐语法解析能力。
- 前一次未完成的 Mermaid 改动在 .js 文件中放 JSX，导致构建失败；data-code 也会被现有清理配置剥除，并且全局替换代码块会影响未挂载图表的聊天页面。

## 本轮已实施

- 恢复共享 Markdown 的普通代码块输出，不放宽清理白名单。
- 新增 NoteMarkdown 阅读态组件，隔离父弹窗重渲染与图表 DOM 更新。
- Mermaid 11.17.2 声明为直接依赖，动态加载，仅增强笔记阅读态的 Mermaid 围栏。
- strict 模式、纯 SVG 文字、输出 SVG 再清理；错误语法保留源码与复制按钮，显示错误提示。
- 有效图表仍保留下方源代码，便于复制和修改；未修改原笔记内容或存储格式。

## 验证证据与边界

- 本地测试笔记 #43：有效流程图生成 1 个 SVG，6 个节点及分支中文文字可读取。
- 无效语法 not_a_diagram：显示“图表暂时无法渲染，请检查下方 Mermaid 源码。”；两段源码仍存在。
- 隔离页验证：开始/结束两个中文节点可读取，无效语法降级正常。
- npm run build 通过；仍有大包与无效动态导入警告。
- npm audit 报告 1 项 high：传递依赖 nanoid，GHSA-2v37-7h3g-55p8；本轮未进行无关依赖升级。
- 浏览器截图连续超时：没有完成视觉验收，不能宣称视觉通过。本轮未部署、未推送。

## 后续推荐次序（未实施）

1. github-markdown-css 局部阅读主题：统一 H1–H6 层级、引用块、列表留白、表格横向滚动，并保留 ICE 主题色和 KaTeX 样式。
2. Tiptap 官方表格与任务列表扩展：先验证打开、编辑、保存、再打开不丢格式，再开放工具栏。
3. 阅读页工具栏和目录参考 Outline 的信息层级；不要以引入组件数量为优化目标。
