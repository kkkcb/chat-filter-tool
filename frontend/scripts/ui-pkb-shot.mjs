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
page.on('pageerror', e => errors.push(e.message))
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 20000 })
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item')
  for (const it of items) if (it.textContent.includes('个人知识库')) { it.click(); break }
})
await page.waitForSelector('.pkb-card', { timeout: 8000 })
await new Promise(r => setTimeout(r, 600))
await page.screenshot({ path: 'screenshots/pkb-refined.png' })
const m = await page.evaluate(() => {
  const c = document.querySelector('.pkb-card')
  const cs = getComputedStyle(c)
  const title = getComputedStyle(document.querySelector('.pkb-card-title'))
  const exc = getComputedStyle(document.querySelector('.pkb-card-excerpt'))
  return { pad: cs.padding, radius: cs.borderRadius, titleSize: title.fontSize, excSize: exc.fontSize, excHeight: exc.lineHeight }
})
console.log(JSON.stringify(m, null, 1))
console.log('JS errors:', errors.length ? errors.join('; ') : '(none)')
await browser.close()
