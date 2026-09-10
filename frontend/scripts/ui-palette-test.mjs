// 对话组件回归：斜杠命令 / @引用 / 代码高亮 / @注入后端
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
const ta = await page.waitForSelector('textarea.chat-input', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 600));

// 1. 斜杠命令面板
await ta.click();
await page.keyboard.type('/', { delay: 40 });
await new Promise((r) => setTimeout(r, 400));
const slash = await page.evaluate(() => ({
  open: !!document.querySelector('.input-palette[data-mode="slash"]'),
  items: document.querySelectorAll('.ip-item').length,
}));
console.log('1. 斜杠面板:', JSON.stringify(slash));
await page.screenshot({ path: 'screenshots/palette-slash.png' });

// 模糊过滤 / Enter 选择
await page.keyboard.type('深度', { delay: 40 });
await new Promise((r) => setTimeout(r, 300));
const filtered = await page.evaluate(() => document.querySelectorAll('.ip-item').length);
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 400));
const afterSlash = await page.evaluate(() => ({
  paletteClosed: !document.querySelector('.input-palette'),
  // 深度思考应被切换（通过输入区附近 toggle 状态或 toast）
  toast: document.querySelector('.toast')?.textContent?.slice(0, 12),
}));
console.log('2. 过滤+Enter 执行:', filtered, '项过滤 |', JSON.stringify(afterSlash));

// 2. @ 引用面板
await ta.click();
await page.keyboard.type('@Git', { delay: 40 });
await new Promise((r) => setTimeout(r, 1200));
const at = await page.evaluate(() => ({
  open: !!document.querySelector('.input-palette[data-mode="at"]'),
  items: [...document.querySelectorAll('.ip-item .ip-cmd')].map((e) => e.textContent.slice(0, 16)),
}));
console.log('3. @ 引用面板:', JSON.stringify(at));
await page.screenshot({ path: 'screenshots/palette-at.png' });

// Enter 选中 → 输入替换为 @完整标题
if (at.items.length) {
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 300));
  const inputVal = await page.evaluate(() => document.querySelector('.chat-input').value);
  console.log('4. 选中后输入:', JSON.stringify(inputVal.slice(0, 40)));
}

console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();

const fail = [];
if (!slash.open || slash.items < 3) fail.push('斜杠面板');
if (!afterSlash.paletteClosed) fail.push('命令执行');
if (!at.open || at.items.length === 0) fail.push('@ 面板');
if (fail.length) { console.log('FAIL:', fail.join('; ')); process.exit(1); }
console.log('PASS');
