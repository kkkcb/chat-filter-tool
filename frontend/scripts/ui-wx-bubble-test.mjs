// 验证微信记录页群聊气泡不再显示 wxid_xxx: 前缀
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';

mkdirSync('screenshots', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 1600, height: 950 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 20000 });
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item');
  for (const it of items) if (it.textContent.includes('微信')) { it.click(); break }
});
await page.waitForSelector('.wx-layout', { timeout: 15000 });

// 搜索并打开 ZOPC 群（单击直接预览）
await page.click('.wx-search input');
await page.type('.wx-search input', 'ZOPC', { delay: 50 });
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => document.querySelector('.wx-contact-item .wx-contact-info')?.click());
await page.waitForSelector('.wx-msg-row', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1000));

// 检查所有已渲染气泡是否残留 wxid_ 前缀
const junk = await page.evaluate(() => {
  const bubbles = [...document.querySelectorAll('.wx-bubble')];
  const bad = bubbles.filter((b) => /wxid_[A-Za-z0-9]+:/.test(b.textContent) || /^[A-Za-z0-9_\-@.]+:\n/.test(b.textContent));
  return {
    bubbleCount: bubbles.length,
    badCount: bad.length,
    badSamples: bad.slice(0, 3).map((b) => b.textContent.slice(0, 80)),
    goodSamples: bubbles.slice(-6).map((b) => b.textContent.slice(0, 80)),
  };
});
console.log(JSON.stringify(junk, null, 2));
await page.screenshot({ path: 'screenshots/wx-bubble-clean.png' });

console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
if (junk.badCount > 0) { console.log('FAIL: 气泡仍有 wxid 前缀'); process.exit(1); }
if (junk.bubbleCount === 0) { console.log('FAIL: 未渲染任何气泡'); process.exit(1); }
console.log(`PASS: ${junk.bubbleCount} 个气泡全部干净`);
