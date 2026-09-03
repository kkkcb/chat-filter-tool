// 访问令牌门端到端：401 → 弹 AccessGate → 输入令牌 → 自动重试成功
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

// 清掉可能存在的旧 token
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
await page.evaluate(() => localStorage.removeItem('app_access_token'));

// 重新加载 → 任意 API 请求 401 → AccessGate 应弹出
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 20000 });
await new Promise((r) => setTimeout(r, 1200));
const gate = await page.evaluate(() => {
  const g = document.querySelector('.agate');
  return g ? { title: g.querySelector('h3')?.textContent, hasInput: !!g.querySelector('input') } : null;
});
console.log('[弹窗]', JSON.stringify(gate));
await page.screenshot({ path: 'screenshots/access-gate-1.png' });

// 输入错误令牌 → 仍 401 → 再次弹（重试路径）
await page.type('.agate input', 'wrong-token', { delay: 15 });
await page.evaluate(() => [...document.querySelectorAll('.agate-btn')].find((b) => b.textContent === '确认')?.click());
await new Promise((r) => setTimeout(r, 1000));
const still401 = await page.evaluate(() => !!document.querySelector('.agate'));
console.log('[错令牌后] 再次弹窗:', still401);

// 输入正确令牌 → 请求自动重试 → 页面正常
await page.evaluate(() => localStorage.removeItem('app_access_token'));
await page.type('.agate input', 'test123', { delay: 15 });
await page.evaluate(() => [...document.querySelectorAll('.agate-btn')].find((b) => b.textContent === '确认')?.click());
await new Promise((r) => setTimeout(r, 1500));
const recovered = await page.evaluate(() => ({
  gateGone: !document.querySelector('.agate'),
  tokenStored: localStorage.getItem('app_access_token'),
  appLoaded: !!document.querySelector('.app-layout'),
  chatView: !!document.querySelector('.msg-input, .chat-input, textarea'),
}));
console.log('[对令牌后]', JSON.stringify(recovered));
await page.screenshot({ path: 'screenshots/access-gate-2-recovered.png' });

// 刷新 → token 已存 → 不再弹窗直接可用
await page.reload({ waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1000));
const afterReload = await page.evaluate(() => ({
  gate: !!document.querySelector('.agate'),
  appLoaded: !!document.querySelector('.app-layout'),
}));
console.log('[刷新后]', JSON.stringify(afterReload));

console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();

const fail = [];
if (!gate?.hasInput) fail.push('AccessGate 未弹出');
if (!still401) fail.push('错令牌后未重新弹窗');
if (!recovered.gateGone || recovered.tokenStored !== 'test123') fail.push('正确令牌未恢复');
if (!recovered.appLoaded) fail.push('应用未加载');
if (afterReload.gate || !afterReload.appLoaded) fail.push('刷新后仍弹窗/未加载');
if (fail.length) { console.log('FAIL:', fail.join('; ')); process.exit(1); }
console.log('PASS');
