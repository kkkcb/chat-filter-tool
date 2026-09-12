// 输入性能分析：量化每次键入的渲染开销
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();

// 启用性能追踪
await page.tracing.start({ categories: ['devtools.timeline'], path: 'screenshots/input-trace.json' });

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 40000 });
await page.waitForSelector('textarea.chat-input', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1000));

// 打开有消息的对话
await page.evaluate(() => [...document.querySelectorAll('.conv-item')][0]?.click());
await new Promise((r) => setTimeout(r, 1500));

// 注入 performance counter：计每次 React render 花的时间
await page.evaluate(() => {
  window.__renderCount = 0;
  window.__renderTime = 0;
  const origRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => {
    window.__renderCount++;
    const t0 = performance.now();
    return origRaf((ts) => {
      cb(ts);
      window.__renderTime += performance.now() - t0;
    });
  };
});

// 模拟快速打字（20 个字符）
const ta = await page.$('textarea.chat-input');
await ta.click();
const t0 = Date.now();
for (let i = 0; i < 20; i++) {
  await page.keyboard.type('a', { delay: 20 });
}
const typingTime = Date.now() - t0;

await page.tracing.stop();

const stats = await page.evaluate(() => ({
  renderCount: window.__renderCount,
  renderTime: Math.round(window.__renderTime * 10) / 10,
}));

// 检查 DOM 节点数量（重渲染开销指标）
const domInfo = await page.evaluate(() => ({
  totalNodes: document.querySelectorAll('*').length,
  messageNodes: document.querySelectorAll('.msg').length,
  sidebarNodes: document.querySelectorAll('.conv-item').length,
}));

console.log('=== 输入性能分析 ===');
console.log(`打字 20 字符耗时: ${typingTime}ms (${Math.round(typingTime / 20)}ms/键)`);
console.log(`RAF 帧数: ${stats.renderCount} (总耗时 ${stats.renderTime}ms)`);
console.log(`DOM 节点: ${domInfo.totalNodes} 总计, ${domInfo.messageNodes} 消息, ${domInfo.sidebarNodes} 对话`);

// 分析 trace 中的长任务
const fs = await import('fs');
const trace = JSON.parse(fs.readFileSync('screenshots/input-trace.json', 'utf-8'));
const events = trace.traceEvents || [];
const longTasks = events.filter((e) => e.name === 'RunTask' && e.dur > 5000); // >5ms
const totalLong = longTasks.reduce((s, e) => s + e.dur, 0) / 1000;
console.log(`长任务(>5ms): ${longTasks.length} 个, 总计 ${totalLong.toFixed(1)}ms`);

// 检查是否有 layout thrashing
const layouts = events.filter((e) => e.name === 'Layout' || e.name === 'UpdateLayoutTree');
console.log(`Layout 事件: ${layouts.length} 次`);

await browser.close();
