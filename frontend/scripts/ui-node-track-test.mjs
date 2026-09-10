// 节点轨修复验证
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 40000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 3000));
await page.evaluate(() => [...document.querySelectorAll('.conv-item')].find((c) => c.textContent.includes('上线'))?.click());
await new Promise((r) => setTimeout(r, 1500));

const s1 = await page.evaluate(() => {
  const t = document.querySelector('.chat-node-track');
  if (!t) return { exists: false };
  const r = t.getBoundingClientRect();
  return {
    exists: true,
    visible: t.offsetHeight > 0,
    left: Math.round(r.left),
    dots: t.querySelectorAll('.chat-node-dot').length,
    currentDots: t.querySelectorAll('.chat-node-dot.current').length,
  };
});
console.log('节点轨:', JSON.stringify(s1));

// 滚动后还在
await page.evaluate(() => {
  const el = document.querySelector('.chat-page-messages');
  if (el) el.scrollTop = 500;
});
await new Promise((r) => setTimeout(r, 500));
const s2 = await page.evaluate(() => {
  const t = document.querySelector('.chat-node-track');
  return {
    stillVisible: t ? t.offsetHeight > 0 && t.getBoundingClientRect().top > 0 : false,
    top: t ? Math.round(t.getBoundingClientRect().top) : -1,
  };
});
console.log('滚动后:', JSON.stringify(s2));
await browser.close();

if (!s1.exists || !s1.visible || !s2.stillVisible) { console.log('FAIL'); process.exit(1); }
console.log('PASS');
