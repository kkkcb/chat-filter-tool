// 微信式聊天画布改造验收：结构 + 交互 + 截图
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
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 20000 });
await page.evaluate(() => {
  const items = document.querySelectorAll('.nav-item');
  for (const it of items) if (it.textContent.includes('微信')) { it.click(); break }
});
await page.waitForSelector('.wx-layout', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'screenshots/wx-after-contacts.png' });

// 打开 ZOPC 群
await page.click('.wx-search input');
await page.type('.wx-search input', 'ZOPC', { delay: 40 });
await new Promise((r) => setTimeout(r, 1000));
await page.evaluate(() => document.querySelector('.wx-contact-item .wx-contact-info')?.click());
await page.waitForSelector('.wx-msg-row', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));

// 1. 聊天画布结构检查
const structure = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.wx-msg-row')];
  const pills = [...document.querySelectorAll('.wx-time-pill')];
  const meBubbles = document.querySelectorAll('.wx-bubble-me');
  const otherBubbles = document.querySelectorAll('.wx-bubble-other');
  const meBg = meBubbles.length ? getComputedStyle(meBubbles[0]).backgroundColor : null;
  const otherBg = otherBubbles.length ? getComputedStyle(otherBubbles[0]).backgroundColor : null;
  const canvasBg = getComputedStyle(document.querySelector('.wx-messages')).backgroundColor;
  const avatars = document.querySelectorAll('.wx-msg-row .wx-chat-avatar');
  const avatarRadius = avatars.length ? getComputedStyle(avatars[0]).borderRadius : null;
  const avatarW = avatars.length ? avatars[0].offsetWidth : 0;
  // 群聊里"我"的消息不应有 sender 名
  const meRowsWithSender = rows.filter((r) => r.classList.contains('me') && r.querySelector('.wx-msg-sender')).length;
  // 时间胶囊数量应远小于消息数（间隔>5分钟才显示）
  const senders = [...document.querySelectorAll('.wx-msg-sender')].map((s) => s.textContent);
  return {
    rows: rows.length, pills: pills.length,
    meBg, otherBg, canvasBg, avatarRadius, avatarW,
    meRowsWithSender, senderSamples: senders.slice(0, 4),
    pillSamples: pills.slice(-3).map((p) => p.textContent),
  };
});
console.log('[结构]', JSON.stringify(structure, null, 2));

// 2. 勾选消息 → 收集条出现 → 勾选框常显
const before = await page.evaluate(() => ({
  bar: !!document.querySelector('.wx-collect-bar'),
  checksVisible: getComputedStyle(document.querySelector('.wx-msg-row .wx-check')).opacity,
}));
await page.evaluate(() => document.querySelector('.wx-msg-row .wx-check')?.click());
await new Promise((r) => setTimeout(r, 300));
const after = await page.evaluate(() => ({
  bar: !!document.querySelector('.wx-collect-bar'),
  barText: document.querySelector('.wx-collect-bar')?.textContent?.slice(0, 20),
  checksVisible: getComputedStyle(document.querySelector('.wx-msg-row .wx-check')).opacity,
}));
console.log('[勾选]', JSON.stringify({ before, after }));
await page.screenshot({ path: 'screenshots/wx-after-selecting.png' });

// 3. 滚到中部再看时间胶囊分布
await page.evaluate(() => {
  const el = document.querySelector('.wx-messages');
  el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - 900);
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'screenshots/wx-after-mid.png' });

// 4. 气泡垃圾检查（wxid 前缀残留）
const junk = await page.evaluate(() => {
  const bubbles = [...document.querySelectorAll('.wx-bubble')];
  const bad = bubbles.filter((b) => /wxid_[A-Za-z0-9]+:/.test(b.textContent));
  return { bubbleCount: bubbles.length, badCount: bad.length };
});
console.log('[气泡]', JSON.stringify(junk));

// 5. 回到底部 + 收集条清空恢复
await page.evaluate(() => { document.querySelector('.wx-messages').scrollTop = 1e9; });
await page.evaluate(() => document.querySelector('.wx-btn-clear-sm')?.click());
await new Promise((r) => setTimeout(r, 300));
const cleared = await page.evaluate(() => !document.querySelector('.wx-collect-bar'));
console.log('[清除收集条]', cleared ? 'OK' : 'FAIL');
await page.screenshot({ path: 'screenshots/wx-after-final.png' });

console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();

const fail = [];
if (structure.meBg !== 'rgb(149, 236, 105)') fail.push('我方气泡不是微信绿 #95EC69: ' + structure.meBg);
if (structure.pills.length === 0 || structure.pills.length >= structure.rows) fail.push('时间胶囊异常');
if (structure.meRowsWithSender > 0) fail.push('我方消息不应显示发送者名');
if (structure.avatarW !== 38) fail.push('头像尺寸不是38');
if (junk.badCount > 0) fail.push('气泡残留 wxid');
if (!after.bar) fail.push('勾选后收集条未出现');
if (after.checksVisible !== '1') fail.push('多选态勾选框未常显');
if (fail.length) { console.log('FAIL:', fail.join('; ')); process.exit(1); }
console.log('PASS');
