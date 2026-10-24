import assert from 'assert/strict';
import { GameEngine } from '../src/game.mjs';
let passed = 0;
function test(name, run) { run(); console.log(`PASS ${name}`); passed += 1; }
const command = (command, receivedAt = 0, id = command) => ({ command, receivedAt, id });
const game = (config = {}) => { const g = new GameEngine({ random: () => 0, ...config }); g.start(); return g; };

test('starts centrally, score zero, food outside snake', () => {
  const g = game(), s = g.snapshot();
  assert.equal(s.state, 'RUNNING');
  assert.deepEqual(s.snake[0], { x: 10, y: 10 });
  assert.equal(s.snake.length, 3);
  assert.equal(s.score, 0);
  assert.ok(!s.snake.some(p => p.x === s.food.x && p.y === s.food.y));
});
test('moves one square without growing', () => {
  const g = game(); g.step(500);
  assert.deepEqual(g.snapshot().snake[0], { x: 11, y: 10 });
  assert.equal(g.snapshot().snake.length, 3);
});
test('wall prediction respects a timely pending turn without mutating the game', () => {
  const g = game({ cols: 4, rows: 4,
    initialSnake: [{ x: 3, y: 2 }, { x: 2, y: 2 }, { x: 1, y: 2 }] });
  const before = g.snapshot();
  assert.equal(g.nextStepHitsWall(0), true);
  assert.deepEqual(g.snapshot(), before);
  g.dispatch(command('UP'), 0);
  assert.equal(g.nextStepHitsWall(100), false);
  assert.equal(g.nextStepHitsWall(1600), true);
  assert.equal(g.snapshot().direction, 'RIGHT');
});
test('food adds one segment and ten points', () => {
  const g = game({ initialFood: { x: 11, y: 10 } });
  const s = g.step(500);
  assert.equal(s.score, 10); assert.equal(s.snake.length, 4);
  assert.ok(!s.snake.some(p => p.x === s.food.x && p.y === s.food.y));
});
test('direction waits for step and reports execution ID', () => {
  const g = game();
  assert.equal(g.dispatch(command('UP'), 0).reason, 'queued');
  assert.equal(g.snapshot().direction, 'RIGHT');
  const s = g.step(500);
  assert.equal(s.direction, 'UP');
  assert.deepEqual(s.snake[0], { x: 10, y: 9 });
  assert.equal(s.lastAppliedId, 'UP');
});
test('rejects reverse and second turn without consuming valid opportunity', () => {
  const g = game();
  assert.equal(g.dispatch(command('LEFT'), 0).reason, 'opposite_direction');
  assert.equal(g.dispatch(command('UP'), 0).accepted, true);
  assert.equal(g.dispatch(command('DOWN'), 0).reason, 'turn_pending');
  assert.equal(g.dispatch(command('RIGHT'), 0).reason, 'turn_pending');
  assert.equal(g.step(500).direction, 'UP');
});
test('same direction does not consume turn capacity', () => {
  const g = game();
  assert.equal(g.dispatch(command('RIGHT'), 0).reason, 'same_direction');
  assert.equal(g.dispatch(command('UP'), 0).reason, 'queued');
});
test('pause clears pending turn and does not move while paused', () => {
  const g = game(); g.dispatch(command('UP'), 0);
  g.dispatch(command('PAUSE'), 0);
  assert.equal(g.snapshot().pendingDirection, null);
  assert.equal(g.step(500).tick, 0);
  assert.equal(g.dispatch(command('DOWN'), 0).accepted, false);
  g.dispatch(command('RESUME'), 500);
  assert.equal(g.step(1000).direction, 'RIGHT');
});
test('wall collision produces loss without corrupting snake', () => {
  const g = game({ cols: 4, rows: 3 });
  g.step(500); const s = g.step(1000);
  assert.equal(s.state, 'GAME_OVER');
  assert.deepEqual(s.result, { outcome: 'LOSS', reason: 'wall' });
  assert.equal(s.snake.length, 3);
});
test('body collision produces self loss', () => {
  const g = game({ cols: 4, rows: 4, initialDirection: 'UP',
    initialSnake: [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 1 }, { x: 2, y: 0 }] });
  g.dispatch(command('RIGHT'), 0);
  assert.equal(g.step(500).result.reason, 'self');
});
test('old tail cell is allowed when not growing', () => {
  const g = game({ cols: 4, rows: 4,
    initialSnake: [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 1 }] });
  assert.equal(g.step(500).state, 'RUNNING');
  assert.deepEqual(g.snapshot().snake[0], { x: 2, y: 1 });
});
test('full board wins without attempting random generation', () => {
  const g = game({ cols: 3, rows: 2, initialFood: { x: 2, y: 0 },
    initialSnake: [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
    random: () => { throw new Error('Must not generate food'); } });
  const s = g.step(500);
  assert.deepEqual(s.result, { outcome: 'WIN', reason: 'board_full' });
  assert.equal(s.food, null); assert.equal(s.snake.length, 6);
});
test('restart resets score, queue, result and increments round', () => {
  const g = game({ initialFood: { x: 11, y: 10 } });
  g.step(500); g.dispatch(command('UP', 500), 500);
  g.dispatch(command('RESTART', 500), 500);
  const s = g.snapshot();
  assert.equal(s.roundId, 2); assert.equal(s.tick, 0); assert.equal(s.score, 0);
  assert.equal(s.pendingDirection, null); assert.equal(s.result, null);
});
test('ending a running game aborts; ending a completed game preserves outcome', () => {
  const g = game();
  g.dispatch(command('END'), 0);
  assert.equal(g.snapshot().result.outcome, 'ABORTED');
  assert.equal(g.snapshot().state, 'ENDED');
  assert.equal(g.dispatch(command('RESTART'), 0).accepted, false);
  g.start(); assert.equal(g.snapshot().roundId, 2);
  const small = game({ cols: 3, rows: 2 });
  small.step(500); small.dispatch(command('END', 500), 500);
  assert.equal(small.snapshot().result.outcome, 'LOSS');
});
test('stale, future and malformed commands rejected', () => {
  const g = game();
  assert.equal(g.dispatch(command('UP'), 1501).reason, 'expired');
  assert.equal(g.dispatch(command('UP', 100), 0).reason, 'expired');
  assert.equal(g.dispatch(null, 0).reason, 'invalid_event');
});
test('pending commands are rechecked at execution time', () => {
  const g = game();
  g.dispatch(command('UP'), 0);
  const s = g.step(1501);
  assert.equal(s.direction, 'RIGHT'); assert.equal(s.lastDiscardedId, 'UP');
});
test('snapshots cannot mutate engine state', () => {
  const g = game(), s = g.snapshot();
  s.snake[0].x = 500; s.food.x = 500;
  assert.equal(g.snapshot().snake[0].x, 10);
  assert.notEqual(g.snapshot().food.x, 500);
});
test('invalid configuration and random sources are rejected', () => {
  assert.throws(() => game({ cols: 2 }));
  assert.throws(() => game({ initialSnake: [{ x: 1, y: 1 }, { x: 1, y: 1 }] }));
  assert.throws(() => game({ initialFood: { x: 10, y: 10 } }));
  assert.throws(() => game({ random: () => 1 }));
  assert.throws(() => game({ initialDirection: '__proto__' }));
  assert.equal(game().dispatch(command('constructor'), 0).reason, 'invalid_state');
});
console.log(`\n${passed} game tests passed.`);
