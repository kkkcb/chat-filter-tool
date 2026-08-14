/**
 * UI 截图验证脚本 — 用系统 Chrome 无头模式截图各视图
 * 用法：node scripts/ui-screenshot.mjs [输出目录]
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'fs'
import { resolve } from 'path'

const OUT = process.argv[2] || 'screenshots'
mkdirSync(OUT, { recursive: true })

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]
import { existsSync } from 'fs'
const EXECUTABLE = CHROME_PATHS.find(p => existsSync(p))

const URL = process.env.UI_URL || 'http://127.0.0.1:8001/'

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})

const page = await browser.newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })

const shot = async name => {
  await new Promise(r => setTimeout(r, 600))
  await page.screenshot({ path: resolve(OUT, `${name}.png`) })
  console.log(`[shot] ${name}.png`)
}

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 })
await shot('01-chat-welcome')

// 素材库视图（含卡片列表 + 右键菜单 toast 测试）
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item')
  for (const it of items) {
    if (it.textContent.includes('素材库')) { it.click(); break }
  }
})
await shot('02-library')

// 右键第一张素材卡 → 复制链接 → 截 toast
const hasCards = await page.evaluate(() => document.querySelectorAll('.mc-card').length)
if (hasCards > 0) {
  const card = await page.$('.mc-card')
  await card.click({ button: 'right' })
  await new Promise(r => setTimeout(r, 300))
  await shot('03-library-context-menu')
  const copyBtn = await page.evaluateHandle(() => {
    const els = [...document.querySelectorAll('.ctx-item')]
    return els.find(e => e.textContent.includes('复制链接')) || null
  })
  if (copyBtn && copyBtn.asElement()) {
    await copyBtn.asElement().click()
    await new Promise(r => setTimeout(r, 300))
    await shot('04-toast')
  }
}

// 创作区
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item')
  for (const it of items) {
    if (it.textContent.includes('创作')) { it.click(); break }
  }
})
await shot('05-studio')

// 微信记录（服务未启动时的引导页）
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item')
  for (const it of items) {
    if (it.textContent.includes('微信')) { it.click(); break }
  }
})
await shot('06-wechat-offline')

// 回到对话页 — 加载骨架屏验证：block API 让联系人骨架停留？对话历史很快，
// 直接截视图切换后的对话页
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item')
  for (const it of items) {
    if (it.textContent.includes('对话')) { it.click(); break }
  }
})
await shot('07-chat-back')

console.log('\n=== JS errors during test ===')
console.log(errors.length ? errors.join('\n') : '(none)')
await browser.close()
