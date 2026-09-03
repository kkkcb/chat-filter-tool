// 分类条新样式视觉截图
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
  for (const it of items) if (it.textContent.includes('个人知识库')) { it.click(); break }
});
await page.waitForSelector('.pkb-container', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 800));

// 造一个带分类的临时笔记让分类 tab 可见（截图后删）
await page.evaluate(async () => {
  await fetch('/api/notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '视觉验收临时笔记', content: 'x', tags: ['临时'], category: '技术原理' }),
  });
});
await new Promise((r) => setTimeout(r, 600));
await page.reload({ waitUntil: 'networkidle0' });
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item');
  for (const it of items) if (it.textContent.includes('个人知识库')) { it.click(); break }
});
await page.waitForSelector('.pkb-category-bar', { timeout: 10000 });
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: 'screenshots/pkb-cat-4-tabs.png', clip: { x: 200, y: 0, width: 1400, height: 400 } });
await page.screenshot({ path: 'screenshots/pkb-cat-5-full.png' });

// 激活态
await page.evaluate(() => {
  [...document.querySelectorAll('.pkb-category-chip')].find((c) => c.textContent.includes('技术原理'))?.click();
});
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'screenshots/pkb-cat-6-active.png', clip: { x: 200, y: 0, width: 1400, height: 400 } });

// 清理临时笔记
await page.evaluate(async () => {
  const notes = await (await fetch('/api/notes')).json();
  const t = notes.find((n) => n.title === '视觉验收临时笔记');
  if (t) await fetch(`/api/notes/${t.id}`, { method: 'DELETE' });
});
await browser.close();
console.log('done');
