import { useEffect } from 'react'
import DOMPurify from 'dompurify'

let sequence = 0

// ICE 暖色主题（mermaid 官方 base 主题 + themeVariables 定制，必须 hex 色值）
const ICE_THEME = {
  theme: 'base',
  themeVariables: {
    background: 'transparent',
    primaryColor: '#FFF7ED',        // 节点底：暖白
    primaryTextColor: '#44403C',    // 正文深暖灰
    primaryBorderColor: '#E8533A',  // ICE 橙描边
    secondaryColor: '#FFFBEB',
    tertiaryColor: '#FFFBEB',
    clusterBkg: '#FFFBF2',          // 阶段分组底：奶油色
    clusterBorder: '#FDBA74',       // 分组描边：浅橙
    lineColor: '#A8A29E',           // 连线暖灰
    edgeLabelBackground: '#FFFBF2',
    fontSize: '14px',
    fontFamily: '"PingFang SC","Microsoft YaHei",system-ui,sans-serif',
    titleColor: '#78350F',
  },
  flowchart: { htmlLabels: false, curve: 'basis', padding: 14, nodeSpacing: 42, rankSpacing: 56 },
}

// 保留原始代码块；图表只在笔记阅读态渐进增强，不改变共享 Markdown 输出。
export function useMermaid(ref, deps) {
  useEffect(() => {
    const container = ref.current
    if (!container) return
    let cancelled = false
    const panels = []
    const blocks = [...container.querySelectorAll('pre code.language-mermaid')]
    if (!blocks.length) return

    async function render() {
      const { default: mermaid } = await import('mermaid')
      if (cancelled) return
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', htmlLabels: false, flowchart: { htmlLabels: false } })
      for (const block of blocks) {
        if (cancelled || !container.contains(block)) return
        const panel = document.createElement('div')
        panel.className = 'note-diagram'
        panel.setAttribute('aria-label', 'Mermaid 图表')
        block.closest('.code-block').before(panel)
        panels.push(panel)
        try {
          const code = block.textContent
          if (!await mermaid.parse(code, { suppressErrors: true })) throw new Error('Invalid diagram')
          if (cancelled) return
          const { svg } = await mermaid.render(`note-diagram-${++sequence}`, code)
          if (cancelled) return
          panel.innerHTML = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            // mermaid 的 classDef/themeVariables 样式在 <style> 块里，
            // svg profile 默认剥 style → 节点全部落回灰色默认样式
            ADD_TAGS: ['style'],
          })
        } catch {
          if (!cancelled) panel.textContent = '图表暂时无法渲染，请检查下方 Mermaid 源码。'
        }
      }
    }
    render().catch(error => {
      console.warn('Note diagram renderer unavailable:', error)
    })
    return () => {
      cancelled = true
      panels.forEach(panel => panel.remove())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
