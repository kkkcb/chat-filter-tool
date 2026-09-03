// 当前微信记录页整体截图（基线）
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';

mkdirSync('screenshots', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 1600, height: 950 },
});
const page = await browser.newPage();
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 20000 });
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item');
  for (const it of items) if (it.textContent.includes('微信')) { it.click(); break }
});
await page.waitForSelector('.wx-layout', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 800));

// 打开 ZOPC 群预览
await page.click('.wx-search input');
await page.type('.wx-search input', 'ZOPC', { delay: 40 });
await new Promise((r) => setTimeout(r, 1000));
await page.evaluate(() => document.querySelector('.wx-contact-item .wx-contact-info')?.click());
await page.waitForSelector('.wx-msg-row', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: 'screenshots/wx-before-redesign.png' });

// 滚一点看中部消息
const el = await page.$('.wx-messages');
await el.evaluate((n) => { n.scrollTop = Math.max(0, n.scrollHeight - n.clientHeight - 600); });
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'screenshots/wx-before-redesign-mid.png' });
await browser.close();
console.log('done');
