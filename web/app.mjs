import { parseCommand, createCommandGate } from '/src/commands.mjs';
import { BrowserVoice } from '/src/browser-voice.mjs';

const $ = (id) => document.getElementById(id);
const labels = { UP: '上', DOWN: '下', LEFT: '左', RIGHT: '右', PAUSE: '暂停', RESUME: '继续', RESTART: '重新开始', END: '结束游戏' };
const states = { READY: '待启动', RUNNING: '运行中', PAUSED: '已暂停', GAME_OVER: '已结算', ENDED: '已结束' };
const reasons = { accepted: '已接受', duplicate: '重复结果', expired: '指令过期', invalid_state: '当前状态不可用', invalid_event: '无效输入', unknown: '非完整口令' };
const errors = {
  unsupported: '此浏览器未提供识别接口，可使用文本调试。', unavailable: '识别器不可用。',
  'not-allowed': '麦克风或语音权限被拒绝，请检查浏览器设置。',
  'service-not-allowed': '浏览器语音服务不可用。', 'audio-capture': '无法采集麦克风。',
  'no-speech': '没有检测到语音，识别已停止。', network: '语音服务网络错误。',
  disconnected: '识别连接已结束。', timeout: '识别启动超时。', start_failed: '识别启动失败。',
};
let state = 'READY';
let gate = createCommandGate();
let debugSequence = 0;
let recordCount = 0;
let starting = false;

function setState(next) {
  state = next;
  $('state').textContent = states[next];
}

function log(text, command, receipt, source) {
  const empty = $('empty');
  if (empty) empty.remove();
  const row = document.createElement('tr');
  const values = [`${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / ${source}`, text, labels[command] || '—', reasons[receipt.reason] || receipt.reason];
  values.forEach((value, index) => {
    const cell = document.createElement('td');
    cell.textContent = value;
    if (index === 3) cell.className = receipt.accepted ? 'accepted' : 'rejected';
    row.append(cell);
  });
  $('records').prepend(row);
  while ($('records').children.length > 100) $('records').lastElementChild.remove();
  recordCount += 1;
  $('count').textContent = `${recordCount} 条 / 显示最近 100 条`;
}

function consume(input, source) {
  $('interim').textContent = input.text || '—';
  if (!input.isFinal) return;
  const command = parseCommand(input.text);
  const receipt = command
    ? gate.accept({ command, id: input.resultId, receivedAt: input.receivedAt }, state, performance.now())
    : { accepted: false, reason: 'unknown' };
  log(input.text, command, receipt, source);
  if (!receipt.accepted) return;
  $('command').textContent = labels[command];
  document.querySelectorAll('[data-direction]').forEach((element) => {
    element.classList.toggle('active', element.dataset.direction === command);
  });
  if (command === 'PAUSE') setState('PAUSED');
  if (command === 'RESUME' || command === 'RESTART') setState('RUNNING');
  if (command === 'END') {
    setState('ENDED');
    voice.stop();
    $('notice').textContent = '验证会话已结束，麦克风已停止。';
  }
}

const voice = new BrowserVoice({
  Recognition: window.SpeechRecognition || window.webkitSpeechRecognition,
  onStatus(status) {
    starting = status === 'starting';
    const listening = status === 'listening';
    $('voice-status').textContent = { starting: '等待识别服务', listening: '监听中', stopped: '未监听' }[status];
    $('dot').className = `dot${listening ? ' active' : ''}`;
    $('start').disabled = starting || listening;
    $('start').textContent = starting ? '正在启动…' : listening ? '监听中' : '启动验证';
    if (listening) {
      if (state === 'READY' || state === 'ENDED') setState('RUNNING');
      $('notice').textContent = '语音服务已连接。';
    }
  },
  onText: (input) => consume(input, '麦克风'),
  onFailure(reason) {
    if (state === 'RUNNING') setState('PAUSED');
    $('voice-status').textContent = '识别不可用';
    $('dot').className = 'dot error';
    $('notice').textContent = errors[reason] || `识别错误：${reason}`;
  },
});

$('start').addEventListener('click', () => {
  if (starting) return;
  gate = createCommandGate();
  voice.start();
});
$('debug').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!$('sample').value.trim()) return;
  if (state === 'READY') setState('RUNNING');
  consume({ text: $('sample').value, resultId: `debug:${++debugSequence}`, receivedAt: performance.now(), isFinal: true }, '文本模拟');
});
$('simulate-over').addEventListener('click', () => {
  if (state === 'RUNNING' || state === 'PAUSED') setState('GAME_OVER');
});
function pauseForFocus() {
  if (state === 'RUNNING') setState('PAUSED');
}
window.addEventListener('blur', pauseForFocus);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseForFocus();
});
window.addEventListener('pagehide', () => voice.stop());
