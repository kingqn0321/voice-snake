const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let Capture;
const messages = [];
class AudioWorkletProcessor {
  constructor() { this.port = { postMessage: (data, transfers) => messages.push({ data, transfers }) }; }
}
vm.runInNewContext(fs.readFileSync(require.resolve('../web/audio-capture.mjs'), 'utf8'), {
  AudioWorkletProcessor, Float32Array, registerProcessor: (name, type) => {
    assert.equal(name, 'voice-capture'); Capture = type;
  },
});
const capture = new Capture();
assert.equal(capture.process([[new Float32Array(128).fill(.25)]]), true);
assert.equal(messages.length, 0);
capture.process([[new Float32Array(128).fill(.5)]]);
assert.equal(messages.length, 1);
assert.equal(messages[0].data.samples.length, 256);
assert.equal(messages[0].data.samples[127], .25);
assert.equal(messages[0].data.samples[128], .5);
assert.ok(Math.abs(messages[0].data.level - Math.sqrt((.25 ** 2 + .5 ** 2) / 2)) < 1e-6);
assert.equal(messages[0].transfers[0], messages[0].data.samples.buffer);
console.log('PASS capture sends ordered 256-sample / 16ms mono chunks with correct RMS');
capture.process([]);
assert.equal(messages.length, 1);
capture.process([[new Float32Array(128)]]);
capture.process([[new Float32Array(128)]]);
assert.equal(messages.length, 2);
assert.equal(messages[1].data.level, 0);
assert.notEqual(messages[0].data.samples.buffer, messages[1].data.samples.buffer);
console.log('PASS silence uses fresh buffers and absent inputs produce no spurious audio');
console.log('\n2 audio capture tests passed.');
