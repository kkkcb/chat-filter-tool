// 多选模式 + 链接/文件卡片 + 无常驻勾选框 验收
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

// 打开 ZOPC 群
await page.click('.wx-search input');
await page.type('.wx-search input', 'ZOPC', { delay: 40 });
await new Promise((r) => setTimeout(r, 1000));
await page.evaluate(() => document.querySelector('.wx-contact-item .wx-contact-info')?.click());
await page.waitForSelector('.wx-msg-row', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));

// 1. 默认视图：完全没有勾选框
const before = await page.evaluate(() => ({
  checks: document.querySelectorAll('.wx-msg-row .wx-check').length,
  rows: document.querySelectorAll('.wx-msg-row').length,
}));
console.log('[默认视图] rows:', before.rows, 'checks:', before.checks, before.checks === 0 ? '✅ 无框' : '❌ 仍有框');
await page.screenshot({ path: 'screenshots/wx-multi-1-default.png' });

// 2. 消息类型盘点：链接卡片 / 文件卡片 / 引用气泡 / 媒体块
const types = await page.evaluate(() => ({
  linkCards: [...document.querySelectorAll('.wx-card-link')].map((a) => ({
    title: a.querySelector('.wx-card-title')?.textContent?.slice(0, 30),
    href: a.href.slice(0, 50),
  })).slice(0, 3),
  linkCount: document.querySelectorAll('.wx-card-link').length,
  plainLinkChips: [...document.querySelectorAll('.wx-msg-special')].filter((s) => s.textContent.includes('[链接]')).length,
  fileCards: document.querySelectorAll('.wx-card-file').length,
  fileSave: [...document.querySelectorAll('.wx-card-save')].map((a) => a.href.slice(0, 80)).slice(0, 2),
  quotes: document.querySelectorAll('.wx-quote').length,
  media: document.querySelectorAll('.wx-media-box').length,
}));
console.log('[消息类型]', JSON.stringify(types, null, 2));

// 3. 进入多选模式
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  btns.find((b) => b.textContent.includes('多选'))?.click();
});
await new Promise((r) => setTimeout(r, 400));
const inMode = await page.evaluate(() => ({
  checks: document.querySelectorAll('.wx-msg-row .wx-check').length,
  header: document.querySelector('.wx-detail-name')?.textContent,
  bar: document.querySelector('.wx-collect-bar')?.textContent?.slice(0, 30),
}));
console.log('[多选模式]', JSON.stringify(inMode));
await page.screenshot({ path: 'screenshots/wx-multi-2-mode.png' });

// 4. 点消息选中（点气泡本体）
await page.evaluate(() => document.querySelector('.wx-msg-row .wx-msg-main')?.click());
await new Promise((r) => setTimeout(r, 300));
const picked = await page.evaluate(() => ({
  selected: document.querySelectorAll('.wx-msg-row.selected').length,
  bar: document.querySelector('.wx-collect-bar')?.textContent?.slice(0, 20),
}));
console.log('[点选]', JSON.stringify(picked));
await page.screenshot({ path: 'screenshots/wx-multi-3-selected.png' });

// 5. 退出多选 → 框消失、选中清空
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.includes('取消'))?.click();
});
await new Promise((r) => setTimeout(r, 300));
const exited = await page.evaluate(() => ({
  checks: document.querySelectorAll('.wx-msg-row .wx-check').length,
  bar: !!document.querySelector('.wx-collect-bar'),
  header: document.querySelector('.wx-detail-name')?.textContent,
}));
console.log('[退出]', JSON.stringify(exited));

console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();

const fail = [];
if (before.checks !== 0) fail.push('默认视图仍有勾选框');
if (inMode.checks === 0 || inMode.header !== '选择消息') fail.push('多选模式未生效');
if (picked.selected !== 1) fail.push('点击消息未选中');
if (exited.checks !== 0 || exited.bar || exited.header === '选择消息') fail.push('退出多选未复位');
if (types.linkCount > 0 && !types.linkCards[0]?.href?.startsWith('http')) fail.push('链接卡片缺 URL');
if (fail.length) { console.log('FAIL:', fail.join('; ')); process.exit(1); }
console.log('PASS');
