// 文件上传 E2E：上传按钮 → 附件条 → 发送 → AI 分析文件内容
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'fs';

mkdirSync('screenshots', { recursive: true });
writeFileSync('test_upload_tmp.py', 'def greet(name):\n    return f"Hello, {name}!"\n');

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 100)));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 40000 });
await page.waitForSelector('.chat-input-wrap', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 600));

// 1. 上传按钮存在
const hasBtn = await page.$('.chat-clip-btn input[type="file"][multiple][type="file"]');
console.log('1. 上传按钮:', !!hasBtn);

// 2. 通过 input 上传文件
const input = await page.$('.chat-clip-btn input[type="file"][multiple][type="file"]');
await input.uploadFile('test_upload_tmp.py');
await new Promise((r) => setTimeout(r, 2500));
const att = await page.evaluate(() => ({
  shown: !!document.querySelector('.chat-attachments'),
  items: document.querySelectorAll('.chat-attachment').length,
  name: document.querySelector('.att-name')?.textContent,
}));
console.log('2. 附件条:', JSON.stringify(att));
await page.screenshot({ path: 'screenshots/file-upload-att.png' });

// 3. 发送消息（AI 应分析文件内容）
const ta = await page.$('textarea.chat-input');
await ta.type('这个文件的函数名是什么？返回什么？', { delay: 15 });
await page.keyboard.press('Enter');
let reply = '';
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  reply = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('.msg.assistant')];
    return (msgs[msgs.length - 1]?.textContent || '');
  });
  if (reply.includes('greet') || reply.includes('Hello')) break;
}
console.log('3. AI 回复包含文件内容:', reply.includes('greet') || reply.includes('Hello'));
console.log('   回复片段:', reply.slice(0, 100));

console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();

const fail = [];
if (!hasBtn) fail.push('上传按钮');
if (!att.shown || att.items === 0) fail.push('附件条');
if (!reply.includes('greet')) fail.push('AI 分析');
if (fail.length) { console.log('FAIL:', fail.join('; ')); process.exit(1); }
console.log('PASS');
