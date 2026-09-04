// 对话式保存指令回归：链接确认自然语言驱动 + 状态回写不重问 + 笔记指令
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';

mkdirSync('screenshots', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 30000 });
const ta = await page.waitForSelector('textarea, input[placeholder*="问点什么"]', { timeout: 20000 });
await new Promise((r) => setTimeout(r, 600));

// 1. 发链接 → 等确认文案出现（抓取+AI分类，最多60s）
await ta.type('https://example.com/', { delay: 10 });
await page.keyboard.press('Enter');
let confirmReady = false;
for (let i = 0; i < 60 && !confirmReady; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  confirmReady = await page.evaluate(() =>
    document.body.innerText.includes('是否保存到知识库'));
}
console.log('1. 链接确认出现:', confirmReady);
await page.screenshot({ path: 'screenshots/save-intent-1.png' });

// 2. 自然语言「保存到素材库」→ 直接入库（不走 AI 对话）
await ta.type('保存到素材库', { delay: 15 });
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 2500));
const savedState = await page.evaluate(() => ({
  textHasSaved: document.body.innerText.includes('已保存到知识库'),
  stillAsking: document.body.innerText.includes('是否保存到知识库'),
  toast: document.querySelector('.toast')?.textContent?.slice(0, 15),
  sendHappened: document.querySelectorAll('.msg').length, // 不应新增 AI 对话气泡
}));
console.log('2. 说「保存到素材库」后:', JSON.stringify(savedState));

// 3. 刷新 → 不应再问（服务端文案已回写）
await page.reload({ waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1200));
const afterReload = await page.evaluate(() => ({
  stillAsking: document.body.innerText.includes('是否保存到知识库'),
  showsSaved: document.body.innerText.includes('已保存到知识库'),
}));
console.log('3. 刷新后:', JSON.stringify(afterReload));

// 4. 再发同一链接 → 应提示已在知识库（不重复问）
const ta2 = await page.waitForSelector('textarea, input[placeholder*="问点什么"]', { timeout: 15000 });
await ta2.type('https://example.com/', { delay: 10 });
await page.keyboard.press('Enter');
let dupState = null;
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  dupState = await page.evaluate(() => ({
    inLib: document.body.innerText.includes('已在知识库中'),
    askingAgain: document.body.innerText.includes('是否保存到知识库'),
  }));
  if (dupState.inLib) break;
}
console.log('4. 重复发链接:', JSON.stringify(dupState));

// 5. 「总结为笔记」指令 → 笔记入库
const ta3 = await page.waitForSelector('textarea, input[placeholder*="问点什么"]', { timeout: 15000 });
await ta3.type('总结为笔记', { delay: 15 });
await page.keyboard.press('Enter');
let noteSaved = false;
for (let i = 0; i < 90 && !noteSaved; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  noteSaved = await page.evaluate(() =>
    document.body.innerText.includes('已保存笔记'));
}
console.log('5. 「总结为笔记」指令生效:', noteSaved);
await page.screenshot({ path: 'screenshots/save-intent-2.png' });

console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();

const fail = [];
if (!confirmReady) fail.push('链接确认未出现');
if (!savedState.textHasSaved || savedState.stillAsking) fail.push('自然语言保存未生效');
if (afterReload.stillAsking) fail.push('刷新后又问了（服务端未回写）');
if (!dupState?.inLib) fail.push('重复链接未识别已在库');
if (!noteSaved) fail.push('笔记指令未生效');
if (fail.length) { console.log('FAIL:', fail.join('; ')); process.exit(1); }
console.log('PASS');
