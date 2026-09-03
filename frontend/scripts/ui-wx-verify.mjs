/** 微信记录界面优化后回归验证 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'fs'

const EXECUTABLE = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => existsSync(p))

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE, headless: 'new',
  args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 20000 })
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item')
  for (const it of items) if (it.textContent.includes('微信')) { it.click(); break }
})
await page.waitForSelector('.wx-layout', { timeout: 15000 })

// 1. 搜索后单击联系人 → 应自动预览（无需再点按钮）
await page.click('.wx-search input')
await page.type('.wx-search input', 'ZOPC', { delay: 50 })
await new Promise(r => setTimeout(r, 1000))
const t0 = Date.now()
await page.evaluate(() => document.querySelector('.wx-contact-item .wx-contact-info')?.click())
await page.waitForSelector('.wx-msg-row', { timeout: 30000 })
console.log(`[1] 单击联系人直接出消息: ${Date.now() - t0}ms ✅`)
await new Promise(r => setTimeout(r, 600))

// 2. 滚动位置应在底部（最新消息可见）
const scroll = await page.evaluate(() => {
  const el = document.querySelector('.wx-messages')
  return { top: el.scrollTop, gap: el.scrollHeight - el.clientHeight - el.scrollTop }
})
console.log(`[2] 预览后滚动: 距底部 ${scroll.gap}px ${scroll.gap < 50 ? '→ 在底部(最新可见) ✅' : '→ 不在底部 ❌'}`)

// 3. 日期分隔条
const dividers = await page.evaluate(() =>
  [...document.querySelectorAll('.wx-date-divider span')].map(e => e.textContent))
console.log(`[3] 日期分隔条: ${dividers.length} 个, 示例: ${dividers.slice(-3).join(' / ')}`)

// 4. 中栏宽度（未折叠 vs 折叠后）
const midBefore = await page.evaluate(() => document.querySelector('.wx-col-mid').offsetWidth)
await page.click('.wx-panel-toggle')
await new Promise(r => setTimeout(r, 500))
const midAfter = await page.evaluate(() => document.querySelector('.wx-col-mid').offsetWidth)
const rightAfter = await page.evaluate(() => document.querySelector('.wx-col-right').offsetWidth)
console.log(`[4] 折叠右栏: 中栏 ${midBefore}px → ${midAfter}px, 右栏宽 ${rightAfter}px`)
await page.screenshot({ path: 'screenshots/wx-10-collapsed.png' })
await page.click('.wx-panel-toggle') // 展开恢复
await new Promise(r => setTimeout(r, 500))

// 5. 勾选消息 → 收集条吸底可见
await page.evaluate(() => document.querySelectorAll('.wx-msg-row .wx-check')[5]?.click())
await new Promise(r => setTimeout(r, 300))
const bar = await page.evaluate(() => {
  const b = document.querySelector('.wx-collect-bar')
  if (!b) return null
  const r = b.getBoundingClientRect(), wrap = document.querySelector('.wx-messages-wrap').getBoundingClientRect()
  return { text: b.textContent.trim().slice(0, 20), atBottom: wrap.bottom - r.bottom < 5, visible: r.height > 0 }
})
console.log(`[5] 收集条吸底: ${JSON.stringify(bar)}`)
await page.screenshot({ path: 'screenshots/wx-11-collect-bar.png' })
await page.evaluate(() => document.querySelector('.wx-btn-clear-sm')?.click())

await page.screenshot({ path: 'screenshots/wx-12-final.png' })
console.log(`\nJS errors: ${errors.length ? errors.join('; ') : '(none)'}`)
await browser.close()
