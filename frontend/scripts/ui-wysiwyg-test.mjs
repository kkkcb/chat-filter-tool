// WYSIWYG 核心体验回归（脚本文件运行，避开 bash 转义）
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
page.on('pageerror', (e) => errs.push(e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 40000 });
await page.evaluate(() => {
  [...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('知识库'))?.click();
});
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('新建笔记'))?.click());
const pm = await page.waitForSelector('.ProseMirror', { timeout: 12000 });
console.log('1. 富文本编辑器加载:', !!pm);
await page.type('.pkb-edit-title', 'WYSIWYG自测', { delay: 8 });

// 飞书式：输入 ## 空格 → 当前行立即变 H2
await pm.click();
await page.keyboard.type('## 标题即刻变', { delay: 30 });
await new Promise((r) => setTimeout(r, 400));
console.log('2. ## 即时变H2:', await page.evaluate(() => !!document.querySelector('.ProseMirror h2')));

await page.keyboard.press('Enter');
await page.keyboard.type('1. 第一项', { delay: 30 });
await new Promise((r) => setTimeout(r, 300));
console.log('3. "1. " 即时变有序列表:', (await page.evaluate(() => document.querySelectorAll('.ProseMirror ol li').length)) >= 1);
await page.keyboard.press('Enter');
await page.keyboard.type('第二项自动续', { delay: 30 });
const liCount = await page.evaluate(() => document.querySelectorAll('.ProseMirror ol li').length);
console.log('4. 回车自动续序号:', liCount >= 2, `(${liCount} 项)`);

// 退出有序列表（空项回车）→ 无序列表 + 引用
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await page.keyboard.type('- 无序要点', { delay: 30 });
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await page.keyboard.type('> 引用一句', { delay: 30 });
const styles = await page.evaluate(() => ({
  ul: document.querySelectorAll('.ProseMirror ul li').length,
  quote: document.querySelectorAll('.ProseMirror blockquote').length,
}));
console.log('5. 无序列表/引用:', JSON.stringify(styles));

// 大纲联动（markdown 数据流验证）
await new Promise((r) => setTimeout(r, 400));
const outline = await page.evaluate(() => [...document.querySelectorAll('.pkb-outline-item')].map((b) => b.textContent.trim()));
console.log('6. 大纲联动:', JSON.stringify(outline));

await page.screenshot({ path: 'screenshots/wysiwyg.png' });

// 保存 → 服务端应是 markdown
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存')?.click());
await new Promise((r) => setTimeout(r, 900));
console.log('7. 保存:', await page.evaluate(() => document.querySelector('.toast')?.textContent?.slice(0, 14)));
console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();

const fail = [];
if (liCount < 2) fail.push('列表');
if (styles.ul < 1 || styles.quote < 1) fail.push('样式');
if (!outline.some((o) => o.includes('标题即刻变'))) fail.push('大纲');
if (fail.length) { console.log('FAIL:', fail.join('; ')); process.exit(1); }
console.log('PASS');
