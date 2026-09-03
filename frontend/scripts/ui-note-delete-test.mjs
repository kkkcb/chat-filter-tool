/** 验证笔记卡片悬停删除按钮（自建测试笔记，不触碰真实数据） */
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
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 20000 })
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item')
  for (const it of items) if (it.textContent.includes('个人知识库')) { it.click(); break }
})
await page.waitForSelector('.pkb-card', { timeout: 8000 })

// 1. 先造一篇专用测试笔记（置顶显示，删除目标明确且不影响真实数据）
const TEST_TITLE = `删除测试-勿留-${Date.now()}`
await page.evaluate(async (title) => {
  await fetch('/api/notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content: '自动化测试用', tags: ['测试'] }),
  })
}, TEST_TITLE)
await new Promise(r => setTimeout(r, 600))
await page.reload({ waitUntil: 'networkidle0' })
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item')
  for (const it of items) if (it.textContent.includes('个人知识库')) { it.click(); break }
})
await page.waitForSelector('.pkb-card', { timeout: 8000 })
const before = await page.evaluate(() => document.querySelectorAll('.pkb-card').length)

// 2. 悬停测试卡片 → 删除按钮浮现
const testCard = await page.evaluateHandle((title) => {
  const cards = [...document.querySelectorAll('.pkb-card')]
  return cards.find(c => c.querySelector('.pkb-card-title')?.textContent === title)
}, TEST_TITLE)
await testCard.asElement().hover()
await new Promise(r => setTimeout(r, 300))
const btnVisible = await page.evaluate((title) => {
  const cards = [...document.querySelectorAll('.pkb-card')]
  const c = cards.find(x => x.querySelector('.pkb-card-title')?.textContent === title)
  const b = c?.querySelector('.pkb-card-delete')
  return !!b && getComputedStyle(b).opacity === '1'
}, TEST_TITLE)
console.log(`删除前 ${before} 张卡片，悬停后删除按钮可见: ${btnVisible}`)
await page.screenshot({ path: 'screenshots/note-delete-hover.png' })

// 3. 点击删除 → 应用内确认弹窗 → 点「删除」→ 数量减一 + toast
await page.evaluate((title) => {
  const cards = [...document.querySelectorAll('.pkb-card')]
  const c = cards.find(x => x.querySelector('.pkb-card-title')?.textContent === title)
  c.querySelector('.pkb-card-delete').click()
}, TEST_TITLE)
await page.waitForSelector('.confirm-dialog', { timeout: 5000 })
await page.screenshot({ path: 'screenshots/note-confirm-dialog.png' })
console.log('确认弹窗文案:', await page.evaluate(() => ({
  title: document.querySelector('.confirm-title')?.textContent,
  message: document.querySelector('.confirm-message')?.textContent,
  btn: document.querySelector('.confirm-btn.ok')?.textContent,
})))
await page.click('.confirm-btn.ok')
await new Promise(r => setTimeout(r, 1200))
const after = await page.evaluate(() => document.querySelectorAll('.pkb-card').length)
const toast = await page.evaluate(() => document.querySelector('.toast')?.textContent || '')
console.log(`删除后 ${after} 张卡片（${before} → ${after}），toast: ${toast}`)

console.log('JS errors:', errors.length ? errors.join('; ') : '(none)')
await browser.close()
