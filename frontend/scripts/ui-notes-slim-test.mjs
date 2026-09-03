import puppeteer from 'puppeteer-core'
import { existsSync, mkdirSync } from 'fs'
mkdirSync('screenshots', { recursive: true })
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
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 20000 })
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item')
  for (const it of items) if (it.textContent.includes('个人知识库')) { it.click(); break }
})
await page.waitForSelector('.pkb-card', { timeout: 8000 })

// 列表接口不再下发全文 → 打开详情应触发 getNote 并渲染全文
await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.pkb-card')]
  cards.find(c => c.textContent.includes('Cloudflare'))?.click()
})
await page.waitForSelector('.pkb-modal', { timeout: 5000 })
const t0 = Date.now()
await page.waitForSelector('.pkb-view-content h2, .pkb-view-content li', { timeout: 5000 })
console.log(`[1] 详情全文渲染: ${Date.now() - t0}ms 后出现 Markdown 结构 ✅`)
const bodyLen = await page.evaluate(() => document.querySelector('.pkb-view-content')?.textContent.length)
console.log(`[2] 正文长度: ${bodyLen} 字符`)
await page.screenshot({ path: 'screenshots/notes-slim-detail.png' })

// 编辑模式字段应有完整正文
await page.evaluate(() => [...document.querySelectorAll('.pkb-icon-btn')].find(b => b.title === '编辑')?.click())
await new Promise(r => setTimeout(r, 600))
const editLen = await page.evaluate(() => document.querySelector('.pkb-edit-content')?.value.length)
console.log(`[3] 编辑器载入正文: ${editLen} 字符 ${editLen > 1000 ? '✅' : '❌ 不完整'}`)

// 搜索走后端 SQL
await page.keyboard.press('Escape')
await page.click('.pkb-search input')
await page.type('.pkb-search input', 'cloudflare', { delay: 40 })
await new Promise(r => setTimeout(r, 900))
const filtered = await page.evaluate(() => [...document.querySelectorAll('.pkb-card-title')].map(e => e.textContent))
console.log(`[4] 搜索 cloudflare: ${JSON.stringify(filtered)}`)

console.log('JS errors:', errors.length ? errors.join('; ') : '(none)')
await browser.close()
