const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
let browser, server;

async function main() {
  const output = path.join(root, 'test-results', 'demo');
  await fs.mkdir(output, { recursive: true });
  server = spawn(process.execPath, ['tools/serve.cjs'], {
    cwd: root, env: { ...process.env, PORT: '4190' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
    server.once('error', reject);
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
    server.stdout.on('data', data => {
      const match = data.toString().match(/http:\/\/localhost:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'],
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { Math.random = () => 208.25 / 397; });
  await page.goto(`${url}/?review=synthetic`);
  await page.evaluate(async () => {
    const context = new AudioContext({ sampleRate: 16000 });
    await context.resume();
    const destination = context.createMediaStreamDestination();
    const carrier = context.createOscillator(), mute = context.createGain();
    mute.gain.value = 0;
    carrier.connect(mute).connect(destination);
    carrier.start();
    window.previewAudio = { context, destination };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true, value: async () => destination.stream,
    });
  });
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('voice-status').textContent === '正在监听',
    null, { timeout: 100000 });
  await page.getByRole('button', { name: '开始录制', exact: true }).click();
  assert.equal(await page.locator('#record-status').textContent(), '录制中');
  await page.waitForFunction(() => document.getElementById('state').textContent === '游戏中');
  await page.waitForFunction(() => document.getElementById('score').textContent === '010');
  const play = async index => {
    const data = await fs.readFile(path.join(root, 'test-results', 'speech', `${index}.wav`));
    await page.evaluate(async base64 => {
      const { context, destination } = window.previewAudio;
      const buffer = await context.decodeAudioData(Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer);
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(destination);
      source.start();
      await new Promise(resolve => setTimeout(resolve, buffer.duration * 1000 + 500));
      source.disconnect();
    }, data.toString('base64'));
  };
  for (const [index, command] of [[4, '上'], [6, '左'], [5, '下'], [7, '右']]) {
    await play(index);
    assert.equal(await page.locator('#command').textContent(), command);
    assert.equal(await page.locator('#receipt').textContent(), '已转向');
  }
  await play(8);
  assert.equal(await page.locator('#state').textContent(), '已暂停');
  await play(12);
  assert.equal(await page.locator('#receipt').textContent(), '非完整口令');
  await page.waitForTimeout(1000);
  await play(9);
  assert.equal(await page.locator('#state').textContent(), '游戏中');
  await page.waitForFunction(() => document.getElementById('state').textContent === '已结算',
    null, { timeout: 14000 });
  await play(10);
  assert.equal(await page.locator('#state').textContent(), '游戏中');
  await play(11);
  assert.equal(await page.locator('#state').textContent(), '已结束');
  await page.waitForFunction(() => document.getElementById('record-status').textContent === '录像已生成');
  for (const [name, filename] of [['下载录像', 'voice-snake-synthetic.webm'], ['下载事件记录', 'voice-snake-synthetic-events.json']]) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    await (await download).saveAs(path.join(output, filename));
  }
  const report = JSON.parse(await fs.readFile(path.join(output, 'voice-snake-synthetic-events.json'), 'utf8'));
  assert.equal(report.kind, 'synthetic');
  assert.equal(report.status, 'recorded');
  assert.ok(report.durationMs > 20000);
  for (const command of ['UP', 'LEFT', 'DOWN', 'RIGHT', 'PAUSE', 'RESUME', 'RESTART', 'END']) {
    assert.ok(report.events.some(event => event.type === 'receipt' && event.command === command && event.accepted), command);
  }
  // Decode the saved file to verify a moving image and an audio track, not just nonzero bytes.
  const recording = (await fs.readFile(path.join(output, 'voice-snake-synthetic.webm'))).toString('base64');
  const media = await page.evaluate(async base64 => {
    const blob = new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: 'video/webm' });
    const url = URL.createObjectURL(blob), video = document.createElement('video');
    video.muted = true; video.src = url;
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
    const canvas = document.createElement('canvas');
    canvas.width = 100; canvas.height = 100;
    const ctx = canvas.getContext('2d');
    const checksums = [];
    for (const time of [2, 7]) {
      await new Promise(resolve => { video.onseeked = resolve; video.currentTime = time; });
      ctx.drawImage(video, 0, 0, 100, 100);
      checksums.push(ctx.getImageData(0, 0, 100, 100).data.reduce((sum, value, i) => sum + value * (i % 31), 0));
    }
    const audio = await window.previewAudio.context.decodeAudioData(await blob.arrayBuffer());
    const samples = audio.getChannelData(0);
    let peak = 0;
    for (const value of samples) peak = Math.max(peak, Math.abs(value));
    URL.revokeObjectURL(url);
    return { width: video.videoWidth, height: video.videoHeight, checksums, audioSeconds: audio.duration, peak };
  }, recording);
  assert.equal(media.width, 1000); assert.equal(media.height, 1000);
  assert.notEqual(media.checksums[0], media.checksums[1]);
  assert.ok(media.audioSeconds > 20 && media.peak > .01, JSON.stringify(media));
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'preview-verification.json'), JSON.stringify({ browser: browser.version(), media, kind: 'synthetic' }, null, 2));
  console.log(`PASS synthetic preview with real Vosk, moving video, audio and all eight command categories: ${output}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) server.kill();
});
