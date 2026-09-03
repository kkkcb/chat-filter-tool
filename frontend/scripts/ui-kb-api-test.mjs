// 对外接口弹窗验证
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
  for (const it of items) if (it.textContent.includes('个人知识库')) { it.click(); break }
});
await page.waitForSelector('.pkb-container', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 600));

// 打开对外接口弹窗
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('对外接口'))?.click());
await new Promise((r) => setTimeout(r, 800));

const modal = await page.evaluate(() => {
  const m = document.querySelector('.kb-api-modal');
  if (!m) return null;
  return {
    apiText: m.querySelector('.kb-api-value code')?.textContent,
    badge: m.querySelector('.kb-api-badge')?.textContent,
    endpoints: [...m.querySelectorAll('.kb-api-endpoint-path code')].map((c) => c.textContent.slice(0, 45)),
    curl: m.querySelector('.kb-api-curl code')?.textContent,
    note: m.querySelector('.kb-api-note')?.textContent?.slice(0, 30),
  };
});
console.log(JSON.stringify(modal, null, 2));
await page.screenshot({ path: 'screenshots/pkb-api-modal.png' });

// 复制按钮
await page.evaluate(() => document.querySelector('.kb-api-copy')?.click());
await new Promise((r) => setTimeout(r, 400));
const toast = await page.evaluate(() => document.querySelector('.toast')?.textContent);

console.log('toast:', toast, '| errors:', errors.length ? errors : 'none');
await browser.close();

const fail = [];
if (!modal) fail.push('弹窗未打开');
if (!modal.apiText?.includes('/api/kb')) fail.push('接口地址缺失');
if (!modal.badge?.includes('免鉴权')) fail.push('鉴权状态异常');
if (modal.endpoints.length < 6) fail.push('端点数不足');
if (!modal.curl?.startsWith('curl ')) fail.push('curl 示例缺失');
if (fail.length) { console.log('FAIL:', fail.join('; ')); process.exit(1); }
console.log('PASS');
