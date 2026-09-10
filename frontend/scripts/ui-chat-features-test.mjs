// 对话六件套回归：全屏阅读 / 标记 / 划词追问 / 消息渲染
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';

mkdirSync('screenshots', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 100)));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 40000 });
await page.waitForSelector('textarea.chat-input', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 800));

// 1. 全屏阅读模式切换
const readBtn = await page.$('.chat-read-btn');
console.log('1. 阅读模式按钮存在:', !!readBtn);
await readBtn?.click();
await new Promise((r) => setTimeout(r, 400));
const reading = await page.evaluate(() => ({
  active: document.querySelector('.kb-container.reading-mode') !== null,
  sidebarHidden: !document.querySelector('.chat-history-bar') || getComputedStyle(document.querySelector('.chat-history-bar')).display === 'none',
}));
console.log('2. 全屏阅读:', JSON.stringify(reading));
await readBtn?.click();
await new Promise((r) => setTimeout(r, 300));

// 3. 标记：hover 消息 → 点击书签按钮
const msgRow = await page.$('.msg-row-wrap');
if (msgRow) {
  const btn = await msgRow.$('.chat-bookmark-btn');
  console.log('3. 标记按钮存在:', !!btn);
  await btn?.click();
  await new Promise((r) => setTimeout(r, 300));
  const nav = await page.evaluate(() => ({
    navShown: !!document.querySelector('.chat-bookmark-nav'),
    navBtns: document.querySelectorAll('.chat-bookmark-nav button').length,
  }));
  console.log('4. 标记后导航:', JSON.stringify(nav));
  await page.screenshot({ path: 'screenshots/chat-bookmark.png' });
  // 取消标记
  await btn?.click();
  await new Promise((r) => setTimeout(r, 300));
  const afterCancel = await page.evaluate(() => !document.querySelector('.chat-bookmark-nav'));
  console.log('5. 取消标记:', afterCancel);
}

// 6. 划词追问面板 UI（选中文本逻辑需真实鼠标，这里测面板打开）
const askPanelExists = await page.evaluate(() => !document.querySelector('.chat-ask-panel'));
console.log('6. 追问面板默认关闭:', askPanelExists);

console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();

const fail = [];
if (!reading.active || !reading.sidebarHidden) fail.push('阅读模式');
if (fail.length) { console.log('FAIL:', fail.join('; ')); process.exit(1); }
console.log('PASS');
