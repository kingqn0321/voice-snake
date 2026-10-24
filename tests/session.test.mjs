import assert from 'assert/strict';
import { GameSession } from '../src/session.mjs';
import { GameEngine } from '../src/game.mjs';
let passed = 0;
function test(name, run) { run(); console.log(`PASS ${name}`); passed += 1; }
function fixture(options = {}) {
  let time = 0, sequence = 0;
  const receipts = [];
  const session = new GameSession({ now: () => time, engine: new GameEngine({ random: () => 0 }),
    onReceipt: (input, command, receipt) => receipts.push({ input, command, receipt }), ...options });
  const send = (text, extra = {}) => session.receive({ text, resultId: `s:${++sequence}`, receivedAt: time, isFinal: true, ...extra });
  const advance = (value) => { time = value; session.update(); };
  const start = () => { session.requestStart(); session.setListening(true); advance(3000); };
  return { session, receipts, send, advance, start, time: (value) => { time = value; } };
}
test('waits for listening and full countdown', () => {
  const f = fixture();
  f.session.requestStart(); f.advance(10000);
  assert.equal(f.session.snapshot().state, 'READY');
  f.session.setListening(true);
  f.advance(12999); assert.equal(f.session.snapshot().state, 'READY');
  f.advance(13000); assert.equal(f.session.snapshot().state, 'RUNNING');
});
test('focus loss cancels and rearms countdown without starting in background', () => {
  const f = fixture(); f.session.requestStart(); f.session.setListening(true);
  f.advance(2000); f.session.setPresence({ focused: false });
  f.advance(7000); assert.equal(f.session.snapshot().state, 'READY');
  f.session.setPresence({ focused: true });
  f.advance(9999); assert.equal(f.session.snapshot().state, 'READY');
  f.advance(10000); assert.equal(f.session.snapshot().state, 'RUNNING');
});
test('movement waits one period, no catch-up burst', () => {
  const f = fixture(); f.start();
  f.advance(3499); assert.equal(f.session.snapshot().tick, 0);
  f.advance(3500); assert.equal(f.session.snapshot().tick, 1);
  f.advance(10000); assert.equal(f.session.snapshot().tick, 2);
});
test('final only; duplicate recognized results execute once', () => {
  const f = fixture(); f.start();
  f.send('暂停', { resultId: 'a', isFinal: false });
  assert.equal(f.session.snapshot().state, 'RUNNING');
  f.send('暂停', { resultId: 'a' });
  assert.equal(f.session.snapshot().state, 'PAUSED');
  assert.equal(f.send('暂停', { resultId: 'a' }).reason, 'duplicate');
});
test('interim from before restart cannot become new-round command', () => {
  const f = fixture(); f.start();
  f.send('上', { resultId: 'pending', isFinal: false });
  f.send('再来一局');
  f.send('上', { resultId: 'pending' });
  assert.equal(f.receipts.at(-1).receipt.reason, 'old_interaction');
  assert.equal(f.session.snapshot().pendingDirection, null);
});
test('focus recovery stays paused until explicit voice resume', () => {
  const f = fixture(); f.start(); f.send('上');
  f.session.setPresence({ focused: false });
  assert.equal(f.session.snapshot().pendingDirection, null);
  assert.equal(f.send('继续').reason, 'input_unavailable');
  f.session.setPresence({ focused: true }); f.advance(5000);
  assert.equal(f.session.snapshot().state, 'PAUSED');
  f.send('继续'); f.advance(5499); assert.equal(f.session.snapshot().tick, 0);
  f.advance(5500); assert.equal(f.session.snapshot().tick, 1);
});
test('recognition interruption never auto resumes', () => {
  const f = fixture(); f.start();
  f.session.setListening(false); f.advance(5000);
  assert.equal(f.session.snapshot().state, 'PAUSED');
  f.session.setListening(true); f.advance(9000);
  assert.equal(f.session.snapshot().state, 'PAUSED');
  f.send('继续'); assert.equal(f.session.snapshot().state, 'RUNNING');
});
test('hidden page rejects new inputs and restart', () => {
  const f = fixture(); f.start();
  f.session.setPresence({ visible: false });
  assert.equal(f.send('再来一局').accepted, false);
  assert.equal(f.session.snapshot().roundId, 1);
});
test('gate and engine reject unknown, reverse and second-turn commands', () => {
  const f = fixture(); f.start();
  assert.equal(f.send('不要向左').reason, 'unknown');
  assert.equal(f.send('左').reason, 'opposite_direction');
  assert.equal(f.send('上').reason, 'queued');
  assert.equal(f.send('下').reason, 'turn_pending');
  f.advance(3500); assert.equal(f.session.snapshot().direction, 'UP');
});
test('restart clears pending and resets next movement time', () => {
  const f = fixture(); f.start(); f.send('上'); f.time(3200); f.send('再来一局');
  assert.equal(f.session.snapshot().roundId, 2);
  assert.equal(f.session.snapshot().pendingDirection, null);
  f.advance(3500); assert.equal(f.session.snapshot().tick, 0);
  f.advance(3700); assert.equal(f.session.snapshot().tick, 1);
});
test('game over retains listening and allows restart', () => {
  const f = fixture(); f.start();
  for (let i = 1; i <= 10; i += 1) f.advance(3000 + i * 500);
  f.advance(9200);
  assert.equal(f.session.snapshot().state, 'GAME_OVER');
  assert.equal(f.session.snapshot().listening, true);
  assert.equal(f.send('继续').accepted, false);
  assert.equal(f.send('再来一局').accepted, true);
});
test('ending cancels listening and can manually start new session', () => {
  const f = fixture(); f.start(); f.send('结束游戏');
  assert.equal(f.session.snapshot().state, 'ENDED');
  assert.equal(f.session.snapshot().listening, false);
  assert.equal(f.send('再来一局').accepted, false);
  f.session.requestStart();
  assert.equal(f.session.snapshot().state, 'READY');
  f.session.setListening(true); f.advance(6000);
  assert.equal(f.session.snapshot().state, 'RUNNING');
  assert.equal(f.session.snapshot().roundId, 2);
});
test('late final timestamps from previous interaction are rejected', () => {
  const f = fixture(); f.start(); f.time(3200); f.send('暂停');
  assert.equal(f.send('继续', { receivedAt: 3100 }).reason, 'old_interaction');
});
test('pause and game-over do not accept direction commands', () => {
  const f = fixture(); f.start(); f.send('暂停');
  assert.equal(f.send('上').reason, 'invalid_state');
  f.send('继续'); f.advance(3500);
  assert.equal(f.session.snapshot().direction, 'RIGHT');
});
test('stable interim turns without waiting for final or the cruise tick', () => {
  const f = fixture(); f.start();
  f.send('上', { resultId: 'early', isFinal: false });
  f.advance(3039); assert.equal(f.session.snapshot().pendingDirection, null);
  f.advance(3040); assert.equal(f.session.snapshot().direction, 'UP');
  assert.deepEqual(f.session.snapshot().snake[0], { x: 10, y: 9 });
  for (let t = 4000; t <= 5500; t += 500) f.advance(t);
  const count = f.receipts.length;
  assert.equal(f.send('右', { resultId: 'early' }).reason, 'duplicate');
  assert.equal(f.receipts.length, count);
  assert.equal(f.session.snapshot().direction, 'UP');
});
test('local directions need only 16ms stability while online directions retain 40ms', () => {
  const f = fixture(); f.start();
  f.send('上', { source: 'local', isFinal: false });
  f.advance(3015); assert.equal(f.session.snapshot().direction, 'RIGHT');
  f.advance(3016); assert.equal(f.session.snapshot().direction, 'UP');
  assert.equal(f.session.snapshot().lastTurnMs, 16);
  f.time(3200); f.send('左', { isFinal: false });
  f.advance(3216); assert.equal(f.session.snapshot().direction, 'UP');
  f.advance(3240); assert.equal(f.session.snapshot().direction, 'LEFT');
});
test('identical interim updates do not postpone stabilization', () => {
  const f = fixture(); f.start();
  f.send('上', { resultId: 'early', isFinal: false });
  f.time(3020); f.send('向上', { resultId: 'early', isFinal: false });
  f.advance(3040); assert.equal(f.session.snapshot().direction, 'UP');
});
test('negative or ambiguous revision cancels an unconfirmed interim', () => {
  for (const text of ['不要向上', '上还是下', '']) {
    const f = fixture(); f.start();
    f.send('上', { resultId: 'early', isFinal: false });
  f.time(3020); f.send(text, { resultId: 'early', isFinal: false });
    f.advance(3500);
    assert.equal(f.session.snapshot().direction, 'RIGHT');
    assert.equal(f.receipts.length, 0);
  }
});
test('changed interim direction gets its own stabilization window', () => {
  const f = fixture(); f.start();
  f.send('上', { resultId: 'early', isFinal: false });
  f.time(3020); f.send('下', { resultId: 'early', isFinal: false });
  f.advance(3040); assert.equal(f.session.snapshot().pendingDirection, null);
  f.advance(3060); assert.equal(f.session.snapshot().direction, 'DOWN');
});
test('final bypasses stabilization and cancels its interim candidate', () => {
  const f = fixture(); f.start();
  f.send('上', { resultId: 'early', isFinal: false });
  f.time(3050); f.send('下', { resultId: 'early' });
  f.advance(3100);
  assert.equal(f.session.snapshot().direction, 'DOWN');
  assert.equal(f.receipts.length, 1);
});
test('interim restart and end never execute without final confirmation', () => {
  for (const text of ['重新开始', '结束游戏', '暂停']) {
    const f = fixture(); f.start();
    f.send(text, { isFinal: false }); f.advance(3500);
    assert.equal(f.session.snapshot().state, 'RUNNING');
    assert.equal(f.session.snapshot().roundId, 1);
    assert.equal(f.receipts.length, 0);
  }
});
test('interrupt cancels stabilized candidates and blocks late final', () => {
  const f = fixture(); f.start();
  f.send('上', { resultId: 'early', isFinal: false });
  f.session.setPresence({ focused: false });
  f.session.setPresence({ focused: true });
  f.send('继续'); f.advance(3500);
  assert.equal(f.session.snapshot().direction, 'RIGHT');
  f.send('上', { resultId: 'early' });
  assert.equal(f.receipts.at(-1).receipt.reason, 'old_interaction');
});
test('early directions obey reverse, one-turn and expiration guards', () => {
  const f = fixture(); f.start();
  f.send('左', { resultId: 'reverse', isFinal: false });
  f.advance(3100); assert.equal(f.receipts.at(-1).receipt.reason, 'opposite_direction');
  f.send('上', { resultId: 'up', isFinal: false });
  f.send('下', { resultId: 'down', isFinal: false });
  f.advance(3200);
  assert.equal(f.receipts.at(-1).receipt.reason, 'turn_pending');
  assert.equal(f.session.snapshot().direction, 'UP');
  f.advance(3500);
  f.time(5500); f.send('右', { receivedAt: 3500, isFinal: false });
  f.advance(5600); assert.equal(f.receipts.at(-1).receipt.reason, 'expired');
});
test('new result IDs can turn again; candidate storage remains bounded', () => {
  const f = fixture(); f.start();
  f.send('上', { resultId: 'first', isFinal: false }); f.advance(3500);
  f.send('右', { resultId: 'second', isFinal: false }); f.advance(4000);
  assert.equal(f.session.snapshot().direction, 'RIGHT');
  for (let i = 0; i < 300; i += 1) f.send('上', { resultId: `bounded:${i}`, isFinal: false });
  assert.equal(f.session.directionCandidates.size, 256);
  f.session.interrupt('focus');
  assert.equal(f.session.directionCandidates.size, 0);
});
test('final turn executes on update instead of waiting for a 500ms cruise tick', () => {
  const f = fixture(); f.start(); f.time(3010); f.send('上');
  f.advance(3020);
  assert.deepEqual(f.session.snapshot().snake[0], { x: 10, y: 9 });
  assert.equal(f.session.snapshot().lastTurnMs, 10);
  f.advance(3519); assert.equal(f.session.snapshot().tick, 1);
  f.advance(3520); assert.equal(f.session.snapshot().tick, 2);
});
test('rapid turns keep at least 100ms between grid moves', () => {
  const f = fixture(); f.start(); f.send('上'); f.advance(3010);
  f.time(3020); f.send('左'); f.advance(3109);
  assert.equal(f.session.snapshot().direction, 'UP');
  assert.equal(f.session.snapshot().tick, 1);
  f.advance(3110); assert.equal(f.session.snapshot().direction, 'LEFT');
  assert.equal(f.session.snapshot().tick, 2);
  assert.equal(f.session.snapshot().lastTurnMs, 90);
});
test('early turn at the boundary prevents a pending wall collision', () => {
  const f = fixture(); f.start();
  for (let t = 3500; t <= 7500; t += 500) f.advance(t);
  assert.equal(f.session.snapshot().snake[0].x, 19);
  f.time(7510); f.send('上', { isFinal: false }); f.advance(7550);
  assert.equal(f.session.snapshot().direction, 'RIGHT');
  f.advance(7600);
  assert.deepEqual(f.session.snapshot().snake[0], { x: 19, y: 9 });
  assert.equal(f.session.snapshot().state, 'RUNNING');
});
function atWall() {
  const f = fixture(); f.start();
  for (let t = 3500; t <= 8000; t += 500) f.advance(t);
  return f;
}
test('wall grants 1200ms of stationary grace, then loses normally', () => {
  const f = atWall();
  assert.equal(f.session.snapshot().wallWaitMs, 1200);
  const head = f.session.snapshot().snake[0], tick = f.session.snapshot().tick;
  f.advance(9199);
  assert.deepEqual(f.session.snapshot().snake[0], head);
  assert.equal(f.session.snapshot().tick, tick);
  assert.equal(f.session.snapshot().state, 'RUNNING');
  f.advance(9200);
  assert.equal(f.session.snapshot().state, 'GAME_OVER');
  assert.equal(f.session.snapshot().result.reason, 'wall');
  assert.equal(f.session.snapshot().wallWaitMs, null);
  const late = atWall();
  late.time(9200); late.send('上');
  assert.equal(late.session.snapshot().state, 'GAME_OVER');
  assert.deepEqual(late.session.snapshot().snake[0], { x: 19, y: 10 });
});
test('an interim spoken after reaching the wall can escape during grace', () => {
  const f = atWall(); f.time(8600);
  f.send('上', { isFinal: false }); f.advance(8640);
  assert.deepEqual(f.session.snapshot().snake[0], { x: 19, y: 9 });
  assert.equal(f.session.snapshot().state, 'RUNNING');
  assert.equal(f.session.snapshot().wallWaitMs, null);
  f.advance(9140); assert.deepEqual(f.session.snapshot().snake[0], { x: 19, y: 8 });
});
test('same direction, reverse, unknown and repeated commands never renew grace', () => {
  const f = atWall();
  f.time(8400); assert.equal(f.send('右').reason, 'same_direction');
  assert.equal(f.send('左').reason, 'opposite_direction');
  assert.equal(f.send('不要向上').reason, 'unknown');
  f.advance(8800); assert.equal(f.session.snapshot().wallWaitMs, 400);
  f.send('右'); f.advance(9200);
  assert.equal(f.session.snapshot().state, 'GAME_OVER');
});
test('pause, focus interruption and restart clear old wall timers', () => {
  for (const action of ['pause', 'focus', 'restart']) {
    const f = atWall(); f.time(8300);
    if (action === 'pause') f.send('暂停');
    else if (action === 'focus') f.session.setPresence({ focused: false });
    else f.send('再来一局');
    assert.equal(f.session.snapshot().wallWaitMs, null);
    f.advance(9400);
    assert.equal(f.session.snapshot().state, action === 'restart' ? 'RUNNING' : 'PAUSED');
  }
});
test('wall grace can be disabled without changing core collision rules', () => {
  const f = fixture({ wallGraceMs: 0 }); f.start();
  for (let t = 3500; t <= 8000; t += 500) f.advance(t);
  assert.equal(f.session.snapshot().state, 'GAME_OVER');
  assert.equal(f.session.snapshot().wallWaitMs, null);
  assert.throws(() => fixture({ wallGraceMs: -1 }));
});
test('a turn toward another wall at a corner does not renew grace', () => {
  const engine = new GameEngine({ cols: 4, rows: 4, random: () => 0,
    initialSnake: [{ x: 3, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }] });
  const f = fixture({ engine }); f.start(); f.advance(3500);
  f.time(4000); f.send('上'); f.advance(4000);
  assert.equal(f.session.snapshot().wallWaitMs, 700);
  f.advance(4700);
  assert.equal(f.session.snapshot().state, 'GAME_OVER');
});
test('self collision has no wall grace', () => {
  const engine = new GameEngine({ cols: 5, rows: 5, random: () => 0,
    initialSnake: [{ x: 2, y: 2 }, { x: 2, y: 1 }, { x: 3, y: 1 },
      { x: 3, y: 2 }, { x: 3, y: 3 }] });
  const f = fixture({ engine }); f.start(); f.advance(3500);
  assert.equal(f.session.snapshot().state, 'GAME_OVER');
  assert.equal(f.session.snapshot().result.reason, 'self');
  assert.equal(f.session.snapshot().wallWaitMs, null);
});
console.log(`\n${passed} session tests passed. Voice events are simulated.`);
