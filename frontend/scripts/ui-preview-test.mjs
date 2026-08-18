/**
 * 复现"预览消息卡死"场景的端到端验证：
 * 搜索联系人 → 点击 → 预览消息 → 验证渲染窗口与加载更多按钮
 */
import puppeteer from 'puppeteer-core'
import { existsSync } from 'fs'

const EXECUTABLE = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p))

const URL = process.env.UI_URL || 'http://localhost:5173/'

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE, headless: 'new',
  args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })

const t0 = Date.now()
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 20000 })

await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item')
  for (const it of items) if (it.textContent.includes('微信')) { it.click(); break }
})
await page.waitForSelector('.wx-layout', { timeout: 15000 })
console.log(`[t+${Date.now() - t0}ms] 微信页三栏加载完成`)

await page.waitForSelector('.wx-search input', { timeout: 10000 })
await page.click('.wx-search input')
await page.type('.wx-search input', 'ZOPC', { delay: 60 })
// 等防抖搜索(300ms)结果渲染稳定，避免点击竞态
await new Promise(r => setTimeout(r, 1000))
await page.waitForSelector('.wx-contact-item', { timeout: 10000 })
console.log(`[t+${Date.now() - t0}ms] 搜索到联系人`)

// 用 evaluate 点击联系人信息区（避开勾选框的 stopPropagation）
await page.evaluate(() => {
  const info = document.querySelector('.wx-contact-item .wx-contact-info')
  if (!info) throw new Error('联系人行不存在')
  info.click()
})
await page.waitForFunction(
  () => (document.querySelector('.wx-detail-name')?.textContent || '').includes('ZOPC'),
  { timeout: 5000 },
)
console.log(`[t+${Date.now() - t0}ms] 已选中联系人`)

const tPreview = Date.now()
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('预览消息'))
  if (!btn) throw new Error('找不到预览按钮')
  btn.click()
})
await page.waitForSelector('.wx-msg-row', { timeout: 15000 })
const rows = await page.evaluate(() => document.querySelectorAll('.wx-msg-row').length)
console.log(`[预览耗时 ${Date.now() - tPreview}ms] 消息渲染 ${rows} 行`)

const sub = await page.evaluate(() => document.querySelector('.wx-detail-sub')?.textContent || '')
console.log(`头部信息: ${sub.trim()}`)

const loadMore = await page.$('.wx-load-more')
console.log(`加载更多按钮: ${loadMore ? '存在' : '不存在（消息少于首屏窗口）'}`)
if (loadMore) {
  console.log(`按钮文案: ${(await page.evaluate(el => el.textContent, loadMore)).trim()}`)
  await loadMore.click()
  await new Promise(r => setTimeout(r, 600))
  const rows2 = await page.evaluate(() => document.querySelectorAll('.wx-msg-row').length)
  console.log(`点击后渲染: ${rows2} 行（+${rows2 - rows}）`)
}

// 页面仍可交互（未卡死）
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item')
  for (const it of items) if (it.textContent.includes('对话')) { it.click(); break }
})
await page.waitForSelector('.chat-welcome, .chat-page-messages .msg', { timeout: 5000 })
console.log(`[t+${Date.now() - t0}ms] 页面切换正常，未卡死 ✅`)

console.log('\n=== JS errors ===')
console.log(errors.length ? errors.join('\n') : '(none)')
await browser.close()
