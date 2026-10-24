const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
let browser, server, passed = 0;

function speechFixture() {
  // This fixture replaces ASR, never requests a microphone or transmits audio.
  Math.random = () => 208.25 / 397;
  class Recognition {
    constructor() { window.testRecognition = this; this.results = []; }
    start() { queueMicrotask(() => this.onstart()); }
    abort() { if (this.onend) this.onend(); }
    emit(text, final = true, repeat = false) {
      const result = [{ transcript: text }];
      result.isFinal = final;
      const index = repeat ? Math.max(0, this.results.length - 1) : this.results.length;
      this.results[index] = result;
      this.onresult({ resultIndex: index, results: this.results });
    }
  }
  window.SpeechRecognition = Recognition;
}

async function run() {
  server = spawn(process.execPath, ['tools/serve.cjs'], {
    cwd: root, env: { ...process.env, PORT: '4190' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview startup timeout')), 10000);
    server.on('error', reject);
    server.on('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited: ${code}`)); });
    server.stdout.on('data', data => {
      const match = data.toString().match(/http:\/\/localhost:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(speechFixture);
  await page.goto(url);
  const emit = async (text, final = true, repeat = false) =>
    page.evaluate(({ text, final, repeat }) => window.testRecognition.emit(text, final, repeat), { text, final, repeat });
  const check = (name) => { passed += 1; console.log(`PASS ${name}`); };
  const head = () => page.locator('#board').evaluate(c => {
    const ctx = c.getContext('2d'), step = c.width / 20;
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
      const p = ctx.getImageData(Math.floor((x + .5) * step), Math.floor((y + .5) * step), 1, 1).data;
      if (p[0] === 212 && p[1] === 243 && p[2] === 166) return { x, y };
    }
    return null;
  });
  const waitHead = async expected => {
    const until = Date.now() + 2500;
    while (Date.now() < until) {
      if (JSON.stringify(await head()) === JSON.stringify(expected)) return;
      await page.waitForTimeout(30);
    }
    assert.deepEqual(await head(), expected);
  };
  assert.equal(await page.locator('#debug-panel').isVisible(), false);
  assert.equal(await page.locator('#diagnostics').isVisible(), false);
  check('normal route hides simulation inputs');
  await page.selectOption('#voice-engine', 'browser');
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('state').textContent === '游戏中', null, { timeout: 7000 });
  await page.waitForFunction(() => document.getElementById('score').textContent === '010');
  assert.equal(await page.locator('#length').textContent(), '04');
  check('start/countdown, moving canvas, food growth and score');
  await emit('上', false);
  await waitHead({ x: 11, y: 9 });
  // Keep final absent for seconds: the snake must already follow the interim.
  await page.waitForTimeout(2100);
  const earlyHead = await head();
  assert.equal(earlyHead.x, 11);
  assert.ok(earlyHead.y < 9);
  assert.equal(await page.locator('#state').textContent(), '游戏中');
  await emit('上', true, true);
  assert.equal(await page.locator('#receipt').textContent(), '已转向');
  check('stable interim turns actual canvas without waiting seconds for final');
  await emit('上', true, true);
  assert.equal(await page.locator('#receipt').textContent(), '已转向');
  check('late and duplicate final results do not replay or overwrite turn feedback');
  await emit('不要向左');
  assert.equal(await page.locator('#receipt').textContent(), '非完整口令');
  await emit('暂停');
  assert.equal(await page.locator('#state').textContent(), '已暂停');
  const pausedHead = await head();
  await page.waitForTimeout(600);
  assert.deepEqual(await head(), pausedHead);
  await emit('右');
  assert.equal(await page.locator('#receipt').textContent(), '当前状态不可用');
  check('negative phrase and pause rules');
  await emit('继续');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await page.locator('#state').textContent(), '已暂停');
  await emit('再来一局');
  assert.equal(await page.locator('#receipt').textContent(), '语音或焦点未就绪');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  assert.equal(await page.locator('#state').textContent(), '已暂停');
  await emit('继续');
  assert.equal(await page.locator('#state').textContent(), '游戏中');
  check('focus interruption requires explicit resume');
  await page.evaluate(() => window.testRecognition.onerror({ error: 'network' }));
  assert.equal(await page.locator('#state').textContent(), '已暂停');
  await page.getByRole('button', { name: '恢复语音通道', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('voice-status').textContent === '正在监听');
  assert.equal(await page.locator('#state').textContent(), '已暂停');
  await emit('再来一局');
  check('recognition error pauses; recovery keeps paused until command');
  await page.waitForFunction(() => document.getElementById('state').textContent.startsWith('边缘缓冲'), null, { timeout: 7000 });
  assert.deepEqual(await head(), { x: 19, y: 10 });
  await page.waitForTimeout(300);
  await emit('上', false);
  await waitHead({ x: 19, y: 9 });
  assert.equal(await page.locator('#state').textContent(), '游戏中');
  check('wall grace lets an interim command spoken at the edge escape');
  await emit('再来一局');
  await page.waitForFunction(() => document.getElementById('state').textContent === '已结算', null, { timeout: 8000 });
  await emit('再来一局');
  assert.equal(await page.locator('#state').textContent(), '游戏中');
  await emit('暂停');
  check('wall collision, settlement and voice restart');
  const label = (process.env.BROWSER_LABEL || 'browser').replace(/[^a-z0-9_-]/gi, '_');
  const output = path.join(root, 'test-results', label);
  await fs.mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    assert.ok(await page.locator('img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)));
    await page.screenshot({ path: path.join(output, `${viewport.width}.png`), fullPage: true });
  }
  check('desktop/mobile layout without horizontal overflow and loaded assets');
  await emit('结束游戏');
  assert.equal(await page.locator('#state').textContent(), '已结束');
  assert.equal(await page.locator('#voice-status').textContent(), '未监听');
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('state').textContent === '游戏中', null, { timeout: 7000 });
  check('end releases recognizer; manual new session starts');
  assert.deepEqual(errors, []);
  console.log(`\n${passed} browser checks passed with mocked ASR. No real microphone tested.`);
  console.log(`Browser version: ${browser.version()}`);
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) server.kill();
});
