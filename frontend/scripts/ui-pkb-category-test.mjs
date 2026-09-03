// 个人知识库分类功能回归：横条/过滤/编辑带分类/新建带分类（自建自删测试笔记）
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
await new Promise((r) => setTimeout(r, 800));

// 1. 分类横条初始状态
const bar0 = await page.evaluate(() => ({
  chips: [...document.querySelectorAll('.pkb-category-chip')].map((c) => c.textContent.trim()),
  tagsBar: !!document.querySelector('.pkb-tags-bar'),
  cards: document.querySelectorAll('.pkb-card').length,
}));
console.log('[初始]', JSON.stringify(bar0));
await page.screenshot({ path: 'screenshots/pkb-cat-1-initial.png' });

// 2. 新建一篇带分类的测试笔记
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('新建笔记'))?.click());
await page.waitForSelector('.pkb-editor', { timeout: 5000 });
await page.type('.pkb-edit-title', '分类功能自测笔记', { delay: 10 });
// 分类输入框（datalist 输入）
await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('.pkb-edit-field input')];
  const cat = inputs[0];
  cat.focus();
});
await page.keyboard.type('技术原理', { delay: 20 });
await page.evaluate(() => {
  const ta = document.querySelector('.pkb-edit-content');
  ta.value = '# 自测正文\n测试分类功能。';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存')?.click());
await new Promise((r) => setTimeout(r, 800));

// 3. 新分类应出现在横条 + 卡片角标
const after1 = await page.evaluate(() => ({
  chips: [...document.querySelectorAll('.pkb-category-chip')].map((c) => c.textContent.trim()),
  badges: [...document.querySelectorAll('.pkb-card-category')].map((c) => c.textContent.trim()),
  toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.slice(0, 20)),
}));
console.log('[新建后]', JSON.stringify(after1));
await page.screenshot({ path: 'screenshots/pkb-cat-2-created.png' });

// 4. 点"技术原理"分类过滤 → 只剩该分类笔记
await page.evaluate(() => {
  [...document.querySelectorAll('.pkb-category-chip')].find((c) => c.textContent.includes('技术原理'))?.click();
});
await new Promise((r) => setTimeout(r, 600));
const filtered = await page.evaluate(() => ({
  active: document.querySelector('.pkb-category-chip.active')?.textContent.trim(),
  cards: document.querySelectorAll('.pkb-card').length,
  allHaveBadge: [...document.querySelectorAll('.pkb-card')].every((c) => !!c.querySelector('.pkb-card-category')),
}));
console.log('[过滤后]', JSON.stringify(filtered));
await page.screenshot({ path: 'screenshots/pkb-cat-3-filtered.png' });

// 5. 清理：删除测试笔记（用应用内确认弹窗）
await page.evaluate(() => {
  // 先回到全部，避免过滤态删完触发空态
  [...document.querySelectorAll('.pkb-category-chip')].find((c) => c.textContent.includes('全部'))?.click();
});
await new Promise((r) => setTimeout(r, 500));
const testCard = await page.evaluateHandle(() =>
  [...document.querySelectorAll('.pkb-card')].find((c) => c.textContent.includes('分类功能自测笔记')));
await (await testCard.asElement().$('.pkb-card-delete')).click();
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '删除')?.click());
await new Promise((r) => setTimeout(r, 800));
const cleaned = await page.evaluate(() => ({
  chips: [...document.querySelectorAll('.pkb-category-chip')].map((c) => c.textContent.trim()),
  cards: document.querySelectorAll('.pkb-card').length,
}));
console.log('[清理后]', JSON.stringify(cleaned));

console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();

const fail = [];
if (!bar0.chips.some((c) => c.includes('全部'))) fail.push('无"全部"分类chip');
if (bar0.tagsBar !== true) fail.push('标签条丢失（当前显示方式应保留）');
if (!after1.chips.some((c) => c.includes('技术原理'))) fail.push('新分类未出现在横条');
if (!after1.badges.includes('技术原理')) fail.push('卡片无分类角标');
if (filtered.active && !filtered.active.includes('技术原理')) fail.push('过滤chip未激活');
if (filtered.cards !== 1) fail.push('分类过滤数量不对: ' + filtered.cards);
if (cleaned.cards !== 1) fail.push('清理后卡片数异常: ' + cleaned.cards);
if (fail.length) { console.log('FAIL:', fail.join('; ')); process.exit(1); }
console.log('PASS');
