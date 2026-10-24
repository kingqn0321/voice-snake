import assert from 'assert';
import { parseCommand, createCommandGate } from '../src/commands.mjs';
import { BrowserVoice } from '../src/browser-voice.mjs';

let passed = 0;
function test(name, run) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}
const event = (id, command = 'LEFT', receivedAt = 100) => ({ id, command, receivedAt });
test('all eight command categories', () => {
  for (const [text, command] of [['上', 'UP'], ['下', 'DOWN'], ['左', 'LEFT'], ['右', 'RIGHT'], ['暂停', 'PAUSE'], ['继续', 'RESUME'], ['重新开始', 'RESTART'], ['结束游戏', 'END']]) {
    assert.strictEqual(parseCommand(text), command);
  }
});
test('aliases and trailing punctuation', () => {
  for (const text of ['向左', '往左', ' 左。 ', '向 左！']) assert.strictEqual(parseCommand(text), 'LEFT');
  assert.strictEqual(parseCommand('再来一局'), 'RESTART');
});
test('negative, ambiguous and unknown phrases do not trigger', () => {
  for (const text of ['不要向左', '上还是下', '左右', '左边有东西', '暂停一下再继续', '不要结束游戏', '', null, 2]) {
    assert.strictEqual(parseCommand(text), null);
  }
});
test('deduplicate stable result IDs', () => {
  const gate = createCommandGate();
  assert.strictEqual(gate.accept(event('s1:0'), 'RUNNING', 100).accepted, true);
  assert.strictEqual(gate.accept(event('s1:0'), 'RUNNING', 110).reason, 'duplicate');
  assert.strictEqual(gate.accept(event('s2:0'), 'RUNNING', 110).accepted, true);
});
test('reject stale, future and malformed timestamps', () => {
  const gate = createCommandGate();
  assert.strictEqual(gate.accept(event('old'), 'RUNNING', 1601).reason, 'expired');
  assert.strictEqual(gate.accept(event('future', 'LEFT', 200), 'RUNNING', 100).reason, 'expired');
  assert.strictEqual(gate.accept(event('bad', 'LEFT', NaN), 'RUNNING', 100).reason, 'invalid_event');
});
test('pause and game-over state rules', () => {
  const gate = createCommandGate();
  assert.strictEqual(gate.accept(event('1'), 'PAUSED', 100).accepted, false);
  assert.strictEqual(gate.accept(event('2', 'RESUME'), 'PAUSED', 100).accepted, true);
  assert.strictEqual(gate.accept(event('3', 'RESUME'), 'GAME_OVER', 100).accepted, false);
  assert.strictEqual(gate.accept(event('4', 'RESTART'), 'GAME_OVER', 100).accepted, true);
  assert.strictEqual(gate.accept(event('5', 'END'), 'ENDED', 100).accepted, false);
  assert.strictEqual(gate.accept(event('6'), 'READY', 100).accepted, false);
});
test('bounded deduplication cache and configuration validation', () => {
  const gate = createCommandGate({ capacity: 2 });
  gate.accept(event('a'), 'RUNNING', 100);
  gate.accept(event('b'), 'RUNNING', 100);
  gate.accept(event('c'), 'RUNNING', 100);
  assert.strictEqual(gate.accept(event('b'), 'RUNNING', 100).reason, 'duplicate');
  assert.strictEqual(gate.accept(event('a'), 'RUNNING', 100).accepted, true);
  assert.throws(() => createCommandGate({ capacity: 0 }));
});

function fixture(Recognition) {
  const statuses = [], texts = [], failures = [];
  const voice = new BrowserVoice({
    Recognition, onStatus: (s) => statuses.push(s), onText: (t) => texts.push(t),
    onFailure: (f) => failures.push(f), now: () => 123,
  });
  return { voice, statuses, texts, failures };
}
class FakeRecognition {
  constructor() { FakeRecognition.last = this; }
  start() { this.onstart(); }
  abort() { if (this.onend) this.onend(); }
}
test('unsupported recognizer reports failure', () => {
  const f = fixture(undefined);
  assert.strictEqual(f.voice.start(), false);
  assert.deepStrictEqual(f.failures, ['unsupported']);
});
test('recognition config, final/interim results and session IDs', () => {
  const f = fixture(FakeRecognition);
  f.voice.start();
  const r = FakeRecognition.last;
  assert.strictEqual(r.lang, 'zh-CN');
  assert.strictEqual(r.continuous, true);
  assert.strictEqual(f.voice.start(), false);
  const result = [{ transcript: '上' }];
  result.isFinal = false;
  r.onresult({ resultIndex: 0, results: [result] });
  assert.strictEqual(f.texts[0].isFinal, false);
  result.isFinal = true;
  r.onresult({ resultIndex: 0, results: [result] });
  assert.strictEqual(f.texts[0].resultId, f.texts[1].resultId);
  assert.strictEqual(f.texts[1].receivedAt, 123);
  f.voice.stop();
  assert.deepStrictEqual(f.failures, []);
  r.onresult({ resultIndex: 0, results: [result] });
  assert.strictEqual(f.texts.length, 2);
  f.voice.start();
  FakeRecognition.last.onresult({ resultIndex: 0, results: [result] });
  assert.notStrictEqual(f.texts[2].resultId, f.texts[0].resultId);
  f.voice.stop();
});
test('unexpected end and network errors stop without retry', () => {
  const f = fixture(FakeRecognition);
  f.voice.start();
  FakeRecognition.last.onend();
  assert.deepStrictEqual(f.failures, ['disconnected']);
  assert.strictEqual(f.voice.active, null);
  f.voice.start();
  FakeRecognition.last.onerror({ error: 'network' });
  assert.deepStrictEqual(f.failures, ['disconnected', 'network']);
  assert.strictEqual(f.voice.active, null);
});
test('removed interim recognition entries invalidate their candidates', () => {
  const f = fixture(FakeRecognition); f.voice.start();
  const r = FakeRecognition.last;
  const result = [{ transcript: '上' }]; result.isFinal = false;
  r.onresult({ resultIndex: 0, results: [result] });
  r.onresult({ resultIndex: 0, results: [] });
  assert.equal(f.texts[1].text, '');
  assert.equal(f.texts[1].isFinal, false);
  assert.equal(f.texts[1].resultId, f.texts[0].resultId);
  f.voice.stop();
});
test('synchronous recognition start errors are recoverable', () => {
  class Broken extends FakeRecognition { start() { throw new Error('failed'); } }
  const f = fixture(Broken);
  assert.strictEqual(f.voice.start(), false);
  assert.deepStrictEqual(f.failures, ['start_failed']);
  assert.strictEqual(f.voice.active, null);
});
console.log(`\n${passed} tests passed. No microphone or platform integration tested.`);
