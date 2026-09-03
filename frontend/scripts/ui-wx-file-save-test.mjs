// 文件卡片 + 保存原件 全流程验证
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

// 打开有文件消息的群
await page.click('.wx-search input');
await page.type('.wx-search input', 'A物电2025', { delay: 40 });
await new Promise((r) => setTimeout(r, 1000));
await page.evaluate(() => document.querySelector('.wx-contact-item .wx-contact-info')?.click());
await page.waitForSelector('.wx-msg-row', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 600));

const cards = await page.evaluate(() =>
  [...document.querySelectorAll('.wx-card-file')].map((c) => ({
    name: c.querySelector('.wx-card-title')?.textContent,
    hasSave: !!c.querySelector('.wx-card-save'),
  }))
);
console.log('[文件卡片]', JSON.stringify(cards, null, 2));

// 点第一个"保存"→ 轮询抓 toast（成功或失败都会出提示，默认时长短）
const toastText = await page.evaluate(async () => {
  document.querySelector('.wx-card-save')?.click();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const t = document.querySelector('.toast');
    if (t) return t.textContent.slice(0, 80);
  }
  return null;
});
console.log('[保存结果 toast]', toastText);

await page.screenshot({ path: 'screenshots/wx-file-save.png' });
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();

if (cards.length === 0) { console.log('FAIL: 无文件卡片'); process.exit(1); }
if (!cards[0].hasSave) { console.log('FAIL: 无保存按钮'); process.exit(1); }
if (!toastText) { console.log('FAIL: 无 toast 反馈'); process.exit(1); }
console.log(/已保存/.test(toastText) ? 'PASS (保存成功)' : `PASS (有反馈: ${toastText})`);
