/** 个人知识库功能端到端截图验证 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'fs'

const EXECUTABLE = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p))

const OUT = 'screenshots'
import { mkdirSync } from 'fs'
mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE, headless: 'new',
  args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })

const shot = async name => {
  await new Promise(r => setTimeout(r, 600))
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`[shot] ${name}.png`)
}

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 20000 })

// 切到个人知识库
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item')
  for (const it of items) if (it.textContent.includes('个人知识库')) { it.click(); break }
})
await page.waitForSelector('.pkb-container', { timeout: 8000 })
await page.waitForSelector('.pkb-card', { timeout: 8000 })
const cards = await page.evaluate(() => document.querySelectorAll('.pkb-card').length)
const tags = await page.evaluate(() => document.querySelectorAll('.pkb-tag-chip').length)
console.log(`笔记卡片: ${cards} 张, 标签过滤: ${tags} 个`)
await shot('01-pkb-list')

// 打开一篇笔记详情
await page.click('.pkb-card')
await page.waitForSelector('.pkb-modal', { timeout: 5000 })
await shot('02-pkb-detail')

// 编辑模式
const editBtn = await page.evaluateHandle(() =>
  [...document.querySelectorAll('.pkb-icon-btn')].find(b => b.title === '编辑'))
await editBtn.asElement().click()
await new Promise(r => setTimeout(r, 400))
await shot('03-pkb-edit')
await page.keyboard.press('Escape')

// 搜索过滤
await page.click('.pkb-search input')
await page.type('.pkb-search input', 'docker', { delay: 50 })
await new Promise(r => setTimeout(r, 800))
const filtered = await page.evaluate(() => document.querySelectorAll('.pkb-card').length)
console.log(`搜索 docker 后: ${filtered} 张卡片`)
await shot('04-pkb-search')

// 对话页「总结为笔记」按钮存在性
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item')
  for (const it of items) if (it.textContent.trim() === '对话') { it.click(); break }
})
await page.waitForSelector('.note-sum-btn', { timeout: 5000 })
const btnState = await page.evaluate(() => {
  const b = document.querySelector('.note-sum-btn')
  return { text: b.textContent.trim(), disabled: b.disabled }
})
console.log('对话页总结按钮:', JSON.stringify(btnState))
await shot('05-chat-sum-btn')

console.log('\n=== JS errors ===')
console.log(errors.length ? errors.join('\n') : '(none)')
await browser.close()
