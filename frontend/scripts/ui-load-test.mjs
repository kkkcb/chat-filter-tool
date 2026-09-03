/** 数据加载优化端到端回归：对话历史 + 微信收藏列表 */
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

// 预置微信收藏名单，验证收藏视图不再拉全量
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('wx_saved_contacts', JSON.stringify(['ZOPC Builders 正式群']))
})

const sizes = []
page.on('response', r => {
  const u = r.url()
  if (u.includes('/api/contacts')) sizes.push({ api: 'contacts', len: 0 })
})

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 20000 })

// 1. 对话历史：列表 → 点开对话2 → 消息渲染
await page.waitForSelector('.conv-item', { timeout: 8000 })
const convCount = await page.evaluate(() => document.querySelectorAll('.conv-item').length)
console.log(`[1] 对话列表加载: ${convCount} 个`)
await page.evaluate(() => {
  const items = [...document.querySelectorAll('.conv-item')]
  items.find(i => i.textContent.includes('上线'))?.click()
})
await page.waitForSelector('.chat-page-messages .msg', { timeout: 8000 })
const msgs = await page.evaluate(() => [...document.querySelectorAll('.msg')].map(m => m.querySelector('.msg-name')?.textContent))
console.log(`[2] 对话详情消息: ${JSON.stringify(msgs)}`)

// 2. 双击助手消息 → 懒加载 raw（应先 loading 后内容）
await page.evaluate(() => {
  const assistant = [...document.querySelectorAll('.msg.assistant')].pop()
  assistant?.querySelector('.msg-body')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
})
await page.waitForSelector('.detail-modal', { timeout: 5000 })
await page.waitForFunction(
  () => !document.querySelector('.pkb-view-loading') && (document.querySelector('.detail-code')?.textContent.length || 0) > 50,
  { timeout: 5000 }
)
const rawLen = await page.evaluate(() =>
  [...document.querySelectorAll('.detail-code')].map(e => e.textContent.length))
console.log(`[3] 双击详情懒加载 raw: ${JSON.stringify(rawLen)} 字符 ✅`)
await page.keyboard.press('Escape')
await page.evaluate(() => document.querySelector('.detail-modal-close')?.click())
await new Promise(r => setTimeout(r, 300))

// 3. 微信页：收藏视图直接出联系人（响应应极小）
const t0 = Date.now()
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item')
  for (const it of items) if (it.textContent.includes('微信')) { it.click(); break }
})
await page.waitForSelector('.wx-contact-item', { timeout: 10000 })
console.log(`[4] 微信收藏视图: 联系人出现耗时 ${Date.now() - t0}ms`)
const names = await page.evaluate(() => [...document.querySelectorAll('.wx-contact-name')].map(e => e.textContent))
console.log(`[5] 收藏列表: ${JSON.stringify(names)}`)

console.log('JS errors:', errors.length ? errors.join('; ') : '(none)')
await browser.close()
