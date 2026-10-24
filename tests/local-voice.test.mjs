import assert from 'node:assert/strict';
import { LocalVoice } from '../src/local-voice.mjs';

let passed = 0;
async function test(name, run) { await run(); console.log(`PASS ${name}`); passed += 1; }
function fixture(overrides = {}) {
  const statuses = [], texts = [], failures = [], levels = [];
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };
  let recognizer, context, capture, constraints, grammar, modelUrl;
  class Recognizer {
    constructor(rate, vocabulary) { this.listeners = {}; this.rate = rate; grammar = JSON.parse(vocabulary); recognizer = this; this.flushes = 0; }
    on(name, fn) { this.listeners[name] = fn; }
    acceptWaveformFloat(samples, rate) { this.samples = samples; assert.equal(rate, 16000); }
    retrieveFinalResult() { this.flushes++; }
    remove() { this.removed = true; }
  }
  class Model {
    constructor(url) { modelUrl = url; this.listeners = {}; this.KaldiRecognizer = Recognizer; }
    on(name, fn) { this.listeners[name] = fn; if (name === 'load') queueMicrotask(() => fn({ result: true })); }
    terminate() {}
  }
  const node = () => ({ connect() {}, disconnect() {}, gain: { value: 1 } });
  class Context {
    constructor(options) { this.options = options; this.sampleRate = 16000; this.state = 'running'; this.audioWorklet = { addModule: async () => {} }; context = this; }
    async resume() {}
    async close() { this.closed = true; }
    createMediaStreamSource() { return node(); }
    createGain() { return node(); }
  }
  class Capture {
    constructor() { Object.assign(this, node()); this.port = {}; capture = this; }
  }
  const voice = new LocalVoice({ Vosk: { Model }, AudioContext: Context, AudioWorkletNode: Capture,
    mediaDevices: { getUserMedia: async value => { constraints = value; return stream; } },
    onStatus: status => statuses.push(status), onText: text => texts.push(text),
    onFailure: reason => failures.push(reason), onLevel: level => levels.push(level),
    now: () => 100, ...overrides });
  return { voice, statuses, texts, failures, levels, track, stream,
    recognizer: () => recognizer, context: () => context, capture: () => capture,
    constraints: () => constraints, grammar: () => grammar, modelUrl: () => modelUrl };
}

await test('local recognition configures mono AGC capture and command grammar', async () => {
  const f = fixture(); assert.equal(await f.voice.start(), true);
  assert.equal(f.context().options.latencyHint, 'interactive');
  assert.equal(f.modelUrl(), '/models/chinese-fast-v1.tar.gz');
  assert.equal(f.constraints().audio.autoGainControl, true);
  assert.equal(f.constraints().audio.noiseSuppression, true);
  assert.ok(f.grammar().includes('左'));
  assert.ok(f.grammar().includes('[unk]'));
  assert.ok(f.grammar().includes('不要 向 左'));
  assert.deepEqual(f.statuses, ['starting', 'microphone', 'listening']);
  assert.equal(await f.voice.start(), false); f.voice.stop();
});
await test('partial revisions share an ID, final advances to a fresh utterance', async () => {
  const f = fixture(); await f.voice.start();
  const r = f.recognizer();
  r.listeners.partialresult({ result: { partial: '向 左' } });
  r.listeners.partialresult({ result: { partial: '向 左' } });
  r.listeners.result({ result: { text: '向 左' } });
  r.listeners.partialresult({ result: { partial: '上' } });
  assert.equal(f.texts.length, 3);
  assert.equal(f.texts[0].resultId, f.texts[1].resultId);
  assert.notEqual(f.texts[1].resultId, f.texts[2].resultId);
  assert.equal(f.texts[1].isFinal, true);
  assert.equal(f.texts[0].source, 'local');
  f.voice.stop();
});
await test('short silence flushes once without waiting for a long endpoint', async () => {
  const f = fixture(); await f.voice.start();
  const send = level => f.capture().port.onmessage({ data: { samples: new Float32Array(256), level } });
  for (let i = 0; i < 10; i++) send(0);
  assert.equal(f.recognizer().flushes, 0);
  send(.03);
  for (let i = 0; i < 7; i++) send(0);
  assert.equal(f.recognizer().flushes, 0);
  send(0); assert.equal(f.recognizer().flushes, 1);
  for (let i = 0; i < 10; i++) send(0);
  assert.equal(f.recognizer().flushes, 1);
  assert.equal(f.levels.at(-1), 0); f.voice.stop();
});
await test('stop releases capture and ignores late recognizer events', async () => {
  const f = fixture(); await f.voice.start(); const r = f.recognizer();
  f.voice.stop(); r.listeners.partialresult({ result: { partial: '上' } });
  assert.equal(f.texts.length, 0);
  assert.equal(f.track.stopped, true);
  assert.equal(r.removed, true);
  assert.equal(f.context().closed, true);
  assert.equal(f.capture().port.onmessage, null);
  assert.deepEqual(f.failures, []);
});
await test('permission denial reports an error and closes audio', async () => {
  const error = new Error('denied'); error.name = 'NotAllowedError';
  const f = fixture({ mediaDevices: { getUserMedia: async () => { throw error; } } });
  assert.equal(await f.voice.start(), false);
  assert.deepEqual(f.failures, ['not-allowed']);
  assert.equal(f.context().closed, true);
});
await test('stop during pending permission cleans a late stream', async () => {
  let resolve, requested;
  const wait = new Promise(done => { requested = done; });
  const f = fixture({ mediaDevices: { getUserMedia: () => {
    requested(); return new Promise(done => { resolve = done; });
  } } });
  const starting = f.voice.start();
  await wait; f.voice.stop(); resolve(f.stream);
  assert.equal(await starting, false);
  assert.equal(f.track.stopped, true);
  assert.ok(!f.statuses.includes('listening'));
});
await test('audio suspension stops and reports instead of silently losing speech', async () => {
  const f = fixture(); await f.voice.start();
  f.context().state = 'suspended'; f.context().onstatechange();
  assert.deepEqual(f.failures, ['audio_suspended']);
  assert.equal(f.track.stopped, true);
});
await test('unsupported local runtime does not attempt capture', async () => {
  const f = fixture({ Vosk: null });
  assert.equal(await f.voice.start(), false);
  assert.deepEqual(f.failures, ['local_unsupported']);
});
console.log(`\n${passed} local voice tests passed. Capture is simulated.`);
