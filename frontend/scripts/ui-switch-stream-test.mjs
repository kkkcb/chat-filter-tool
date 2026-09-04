// 流式中切换会话回归：AI 回复不得写进其他会话的消息气泡
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
await new Promise((r) => setTimeout(r, 600));

// 1. 发一条会流式生成一会儿的消息
const PROMPT = '切换会话回归测试，请用两句话介绍你自己';
await ta.type(PROMPT, { delay: 15 });
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 2000)); // 确认进入流式生成

// 2. 生成中切到历史会话「什么是AI」
await page.evaluate(() => {
  const item = [...document.querySelectorAll('.conv-item')].find(c => (c.textContent || '').includes('什么是AI'));
  item?.click();
});
await new Promise((r) => setTimeout(r, 1500));

// 3. 该会话的消息不应被流式内容污染（流式回复的文字特征/typing/游标都不该出现）
const polluted = await page.evaluate((prompt) => {
  const msgs = [...document.querySelectorAll('.msg')];
  return {
    count: msgs.length,
    pollutedByStream: msgs.some(m => m.textContent.includes('介绍你自己')),
    hasTyping: !!document.querySelector('.typing-indicator'),
    hasCursor: !!document.querySelector('.stream-cursor'),
    hasMyPrompt: msgs.some(m => m.textContent.includes(prompt)),
    texts: msgs.map(m => (m.textContent || '').slice(0, 22)),
    _prompt: prompt.slice(0, 8),
  };
}, PROMPT);
console.log('[切到历史会话后]', JSON.stringify(polluted, null, 2));
await page.screenshot({ path: 'screenshots/switch-bug-1.png' });

// 4. 等流结束（后台读完入库），再切回发消息的那个会话
await new Promise((r) => setTimeout(r, 25000));
await page.evaluate((prompt) => {
  const item = [...document.querySelectorAll('.conv-item')].find(c => (c.textContent || '').includes(prompt.slice(0, 6)));
  item?.click();
}, PROMPT);
await new Promise((r) => setTimeout(r, 1500));
const back = await page.evaluate((prompt) => {
  const msgs = [...document.querySelectorAll('.msg')];
  const last = msgs[msgs.length - 1];
  return {
    count: msgs.length,
    lastIsAssistant: last?.classList.contains('assistant'),
    lastHasReply: (last?.textContent || '').length > 20,
    hasMyPrompt: msgs.some(m => m.textContent.includes(prompt)),
    lastText: (last?.textContent || '').slice(0, 40),
  };
}, PROMPT);
console.log('[切回后会话]', JSON.stringify(back, null, 2));
await page.screenshot({ path: 'screenshots/switch-bug-2.png' });

console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();

const fail = [];
if (polluted.pollutedByStream) fail.push('历史会话被流式内容污染');
if (polluted.hasMyPrompt) fail.push('测试消息串进了历史会话');
if (back.count < 2) fail.push('原会话消息丢失');
if (!back.hasMyPrompt) fail.push('用户消息不见了');
if (!back.lastIsAssistant || !back.lastHasReply) fail.push('AI 回复未恢复');
if (fail.length) { console.log('FAIL:', fail.join('; ')); process.exit(1); }
console.log('PASS');
