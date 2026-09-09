// 笔记图片全流程：粘贴上传→保存→自适应渲染→大图→提取文字（自建自删）
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

// 用 CDP 模拟粘贴图片（比 keyboard 粘贴文件可靠）
async function pasteImage() {
  const cdp = await page.createCDPSession();
  // 1x1 红色 PNG → 换成带文字的图更好？用 canvas 生成 400x100 白底黑字"测试OCR文字"
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 400; c.height = 100
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 400, 100)
    ctx.fillStyle = '#000'; ctx.font = 'bold 40px sans-serif'
    ctx.fillText('ICE测试图片', 20, 65)
    return c.toDataURL('image/png')
  })
  await cdp.send('Input.insertText', { text: '' }).catch(() => {})
  // 构造 ClipboardEvent
  await page.evaluate(async (dataUrl) => {
    const blob = await (await fetch(dataUrl)).blob()
    const file = new File([blob], 'paste-test.png', { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    const ta = document.querySelector('.pkb-edit-content')
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, dataUrl)
}

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item');
  for (const it of items) if (it.textContent.includes('个人知识库')) { it.click(); break }
});
await page.waitForSelector('.pkb-container', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 800));

// 新建笔记 → 粘贴图片
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('新建笔记'))?.click());
await page.waitForSelector('.pkb-editor', { timeout: 5000 });
await page.type('.pkb-edit-title', '图片功能自测', { delay: 10 });
await pasteImage();
await new Promise((r) => setTimeout(r, 2500)); // 等上传+插入
const inserted = await page.evaluate(() => document.querySelector('.pkb-edit-content').value.includes('/api/notes/images/'));
console.log('1. 粘贴上传并插入 markdown:', inserted);

// 保存
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存')?.click());
await new Promise((r) => setTimeout(r, 900));

// 重新打开（查看态）
await page.evaluate(() => {
  const card = [...document.querySelectorAll('.pkb-card')].find(c => c.textContent.includes('图片功能自测'));
  card?.click();
});
await new Promise((r) => setTimeout(r, 1400));
const rendered = await page.evaluate(() => {
  const img = document.querySelector('.pkb-view-content img');
  if (!img) return { found: false };
  // 自适应：宽度不超过容器
  const c = document.querySelector('.pkb-view-content').getBoundingClientRect();
  const r = img.getBoundingClientRect();
  return { found: true, fits: r.width <= c.width + 1, cursor: getComputedStyle(img).cursor };
});
console.log('2. 查看态渲染:', JSON.stringify(rendered));
await page.screenshot({ path: 'screenshots/note-img-view.png' });

// 点击图片 → lightbox
await page.evaluate(() => document.querySelector('.pkb-view-content img')?.click());
await new Promise((r) => setTimeout(r, 500));
const lbOpen = await page.evaluate(() => !!document.querySelector('.img-lightbox'));
console.log('3. 大图打开:', lbOpen);

// 提取文字（真实调视觉模型）
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('提取图中文字'))?.click());
let ocr = null;
for (let i = 0; i < 45; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  ocr = await page.evaluate(() => {
    const box = document.querySelector('.ilb-ocr:not(.loading)');
    return box ? box.textContent.slice(0, 30) : null;
  });
  if (ocr) break;
}
console.log('4. OCR 提取结果:', ocr);
await page.screenshot({ path: 'screenshots/note-img-ocr.png' });

// 清理：关 lightbox → 删除测试笔记
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('关闭'))?.click());
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => document.querySelector('.pkb-icon-btn.danger')?.click());
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '删除')?.click());
await new Promise((r) => setTimeout(r, 800));
console.log('5. 测试笔记已清理');

console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();

const fail = [];
if (!inserted) fail.push('粘贴未插入');
if (!rendered.found || !rendered.fits) fail.push('渲染/自适应失败');
if (!lbOpen) fail.push('lightbox 未打开');
if (!ocr || !ocr.includes('ICE')) fail.push('OCR 未识别出文字');
if (fail.length) { console.log('FAIL:', fail.join('; ')); process.exit(1); }
console.log('PASS');
