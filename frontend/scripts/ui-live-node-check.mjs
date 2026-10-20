// 检查线上各对话的节点轨状态
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
await page.goto('http://${VPS_IP:-YOUR_VPS_IP}/', { waitUntil: 'networkidle2', timeout: 40000 });
await new Promise((r) => setTimeout(r, 1500));
if (await page.evaluate(() => !!document.querySelector('.agate'))) {
  await page.type('.agate input', process.env.ICE_GATE_PW || 'YOUR_GATE_PW', { delay: 5 });
  await page.evaluate(() => [...document.querySelectorAll('.agate-btn')].find((b) => b.textContent === '确认')?.click());
  await new Promise((r) => setTimeout(r, 2000));
}

const convs = await page.evaluate(() =>
  [...document.querySelectorAll('.conv-item')].map((c, i) => ({ i, text: c.textContent.slice(0, 15) }))
);
console.log('对话数:', convs.length);

for (const conv of convs.slice(0, 6)) {
  await page.evaluate((idx) => [...document.querySelectorAll('.conv-item')][idx]?.click(), conv.i);
  await new Promise((r) => setTimeout(r, 1500));
  const state = await page.evaluate(() => {
    const userMsgs = [...document.querySelectorAll('.msg.user')].length;
    const track = document.querySelector('.chat-node-track');
    const msgs = document.querySelector('.chat-page-messages');
    return {
      userMsgs,
      trackExists: !!track,
      trackLeft: track ? Math.round(track.getBoundingClientRect().left) : null,
      msgLeft: msgs ? Math.round(msgs.getBoundingClientRect().left) : null,
      cssLeft: track ? getComputedStyle(track).left : null,
    };
  });
  console.log(`对话${conv.i} [${conv.text}]:`, JSON.stringify(state));
  if (state.trackExists && state.userMsgs > 1) {
    await page.screenshot({ path: 'screenshots/live-node-found.png' });
    break;
  }
}
await browser.close();
