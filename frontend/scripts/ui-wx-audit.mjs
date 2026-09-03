/** 微信记录界面现状走查 + 截图 */
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
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 20000 })
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item')
  for (const it of items) if (it.textContent.includes('微信')) { it.click(); break }
})
await page.waitForSelector('.wx-layout', { timeout: 15000 })
await new Promise(r => setTimeout(r, 800))
await page.screenshot({ path: 'screenshots/wx-01-initial.png' })
console.log('[1] 初始三栏布局')

// 点击联系人后的中栏状态（不点预览按钮）
await page.click('.wx-search input')
await page.type('.wx-search input', 'ZOPC', { delay: 50 })
await new Promise(r => setTimeout(r, 1000))
await page.evaluate(() => document.querySelector('.wx-contact-item .wx-contact-info')?.click())
await new Promise(r => setTimeout(r, 600))
await page.screenshot({ path: 'screenshots/wx-02-after-click.png' })
console.log('[2] 点击联系人后（未预览）')

// 点预览，看加载与结果初始滚动位置
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('预览消息'))
  b?.click()
})
const t0 = Date.now()
await page.waitForSelector('.wx-msg-row', { timeout: 30000 })
console.log(`[3] 预览耗时 ${Date.now() - t0}ms`)
await new Promise(r => setTimeout(r, 500))
const scrollInfo = await page.evaluate(() => {
  const el = document.querySelector('.wx-messages')
  if (!el) return null
  return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientH: el.clientHeight }
})
console.log('[3] 预览后滚动位置:', JSON.stringify(scrollInfo), scrollInfo && scrollInfo.scrollHeight - scrollInfo.clientHeight - scrollInfo.scrollTop > 200 ? '→ 没滚到底部(最新消息看不到!)' : '→ 在底部')
await page.screenshot({ path: 'screenshots/wx-03-preview.png' })

const cols = await page.evaluate(() => ({
  left: document.querySelector('.wx-col-left')?.offsetWidth,
  mid: document.querySelector('.wx-col-mid')?.offsetWidth,
  right: document.querySelector('.wx-col-right')?.offsetWidth,
}))
console.log('[4] 三栏宽度:', JSON.stringify(cols))
await browser.close()
