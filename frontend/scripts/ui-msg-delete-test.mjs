// 聊天单句删除端到端：发测试消息 → 等AI回复 → 两条都可删 → 删除验证（不动真实历史）
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
await new Promise((r) => setTimeout(r, 800));

// 1. 流式生成中：AI 消息（最后一条）不应有删除按钮（用户消息已入库、可以有）
await ta.type('单句删除功能自测，请只回复两个字：收到', { delay: 15 });
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 250)); // 立即检查：此时必在流式/typing 中
const duringStream = await page.evaluate(() => {
  const msgs = [...document.querySelectorAll('.msg')];
  const last = msgs[msgs.length - 1];
  return last ? last.querySelectorAll('.msg-delete-btn').length : -1;
});
console.log('1. 流式中AI消息删除按钮数(应为0):', duringStream);

// 2. 等 AI 回复完成（saved 事件带回 id）
let done = false;
for (let i = 0; i < 60 && !done; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  done = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('.msg')];
    return msgs.length >= 4 && (msgs[msgs.length - 1].textContent || '').includes('收到');
  });
}
await new Promise((r) => setTimeout(r, 600));
const afterDone = await page.evaluate(() => {
  const msgs = [...document.querySelectorAll('.msg')];
  const btns = document.querySelectorAll('.msg-delete-btn');
  return { totalMsgs: msgs.length, deleteBtns: btns.length, lastText: (msgs[msgs.length-1]?.textContent || '').slice(0, 30) };
});
console.log('2. 完成后状态:', JSON.stringify(afterDone));

// 3. 删除最后一条（AI 回复）：悬停 → 点删除 → 应用内确认
await page.evaluate(() => {
  const btns = document.querySelectorAll('.msg-delete-btn');
  btns[btns.length - 1].click();
});
await new Promise((r) => setTimeout(r, 400));
const confirmShown = await page.evaluate(() => !!document.querySelector('.confirm-dialog, [class*="confirm"]'));
console.log('3. 确认弹窗出现:', !!confirmShown);
await page.screenshot({ path: 'screenshots/msg-del-confirm.png' });
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  btns.find(b => b.textContent.trim() === '删除')?.click();
});
await new Promise((r) => setTimeout(r, 800));

// 4. 删除后的消息数 + toast
const afterDel1 = await page.evaluate(() => ({
  msgs: document.querySelectorAll('.msg').length,
  toast: document.querySelector('.toast')?.textContent,
}));
console.log('4. 删除AI回复后:', JSON.stringify(afterDel1));

// 5. 删除用户测试消息
await page.evaluate(() => {
  const btns = document.querySelectorAll('.msg-delete-btn');
  btns[btns.length - 1].click();
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  btns.find(b => b.textContent.trim() === '删除')?.click();
});
await new Promise((r) => setTimeout(r, 800));
const afterDel2 = await page.evaluate(() => document.querySelectorAll('.msg').length);
console.log('5. 删除用户消息后消息数:', afterDel2);

// 6. 服务端验证：刷新后重进对话，被删的消息不应回来（对话标题匹配属正常，检查消息区）
await page.reload({ waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1200));
const bodyText = await page.evaluate(() => {
  const area = document.querySelector('.chat-page-messages');
  return area ? area.innerText : '';
});
console.log('6. 刷新后消息区测试消息残留:', bodyText.includes('单句删除功能自测') ? '有(FAIL)' : '无 ✓');

console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();

const fail = [];
if (duringStream !== 0) fail.push('流式生成中出现了删除按钮');
if (afterDone.deleteBtns < 2) fail.push('完成后删除按钮不足2个');
if (!confirmShown) fail.push('确认弹窗未出现');
if (afterDel2 !== afterDone.totalMsgs - 2) fail.push(`应删2条，剩 ${afterDel2}`);
if (bodyText.includes('单句删除功能自测')) fail.push('刷新后消息回来了(服务端未删)');
if (fail.length) { console.log('FAIL:', fail.join('; ')); process.exit(1); }
console.log('PASS');
