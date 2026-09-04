// 分类管理 UI 回归：新建/重命名/删除 + 配色显示
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
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item');
  for (const it of items) if (it.textContent.includes('个人知识库')) { it.click(); break }
});
await page.waitForSelector('.pkb-category-bar', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 800));

// 1. 初始状态 + 新建按钮存在
const s1 = await page.evaluate(() => ({
  chips: [...document.querySelectorAll('.pkb-category-chip')].map(c => c.textContent.trim()),
  addBtn: !!document.querySelector('.pkb-cat-add'),
  dots: document.querySelectorAll('.pkb-cat-dot').length,
}));
console.log('[初始]', JSON.stringify(s1));

// 2. 新建分类「UI自测」
await page.click('.pkb-cat-add');
await page.waitForSelector('.pkb-cat-rename', { timeout: 5000 });
await page.type('.pkb-cat-rename', 'UI自测', { delay: 20 });
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 800));
const s2 = await page.evaluate(() => ({
  chips: [...document.querySelectorAll('.pkb-category-chip')].map(c => c.textContent.trim()),
  toast: document.querySelector('.toast')?.textContent,
}));
console.log('[新建后]', JSON.stringify(s2));
await page.screenshot({ path: 'screenshots/cat-mgmt-1.png' });

// 3. hover 显示管理按钮 → 重命名「UI自测」→「UI自测2」
await page.evaluate(() => {
  const ops = document.querySelectorAll('.pkb-cat-ops');
  const wrap = [...document.querySelectorAll('.pkb-cat-wrap')].find(w => w.textContent.includes('UI自测'));
  wrap?.querySelector('.pkb-cat-ops button')?.click(); // 第一个按钮 = 重命名
});
await page.waitForSelector('.pkb-cat-rename', { timeout: 5000 });
await page.evaluate(() => {
  const input = document.querySelector('.pkb-cat-rename');
  input.value = '';
});
await page.type('.pkb-cat-rename', 'UI自测2', { delay: 20 });
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 800));
const s3 = await page.evaluate(() => [...document.querySelectorAll('.pkb-category-chip')].map(c => c.textContent.trim()));
console.log('[重命名后]', JSON.stringify(s3));

// 4. 删除「UI自测2」（空分类，确认弹窗）
await page.evaluate(() => {
  const wrap = [...document.querySelectorAll('.pkb-cat-wrap')].find(w => w.textContent.includes('UI自测2'));
  const btns = wrap?.querySelectorAll('.pkb-cat-ops button');
  btns?.[btns.length - 1]?.click(); // 最后一个按钮 = 删除
});
await new Promise((r) => setTimeout(r, 400));
const confirmShown = await page.evaluate(() => !!document.querySelector('[class*="confirm" i], .confirm-dialog, [class*="Confirm"]'));
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  btns.find(b => b.textContent.trim() === '删除')?.click();
});
await new Promise((r) => setTimeout(r, 800));
const s4 = await page.evaluate(() => ({
  chips: [...document.querySelectorAll('.pkb-category-chip')].map(c => c.textContent.trim()),
  toast: document.querySelector('.toast')?.textContent?.slice(0, 15),
}));
console.log('[删除确认弹窗]', !!confirmShown, '| [删除后]', JSON.stringify(s4));

// 5. 卡片角标配色
const s5 = await page.evaluate(() => {
  const badges = [...document.querySelectorAll('.pkb-card-category')];
  return badges.slice(0, 3).map(b => ({ text: b.textContent.trim().slice(0, 8), bg: getComputedStyle(b).backgroundColor }));
});
console.log('[卡片角标]', JSON.stringify(s5));

console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();

const fail = [];
if (!s1.addBtn) fail.push('无新建按钮');
if (!s2.chips.some(c => c.includes('UI自测'))) fail.push('新建分类未出现');
if (!s3.some(c => c.includes('UI自测2'))) fail.push('重命名未生效');
if (s4.chips.some(c => c.includes('UI自测'))) fail.push('删除未生效');
if (s5.length && s5.every(b => b.bg === 'rgba(0, 0, 0, 0)')) fail.push('角标无配色');
if (fail.length) { console.log('FAIL:', fail.join('; ')); process.exit(1); }
console.log('PASS');
