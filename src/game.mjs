const vectors = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] };
const opposite = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };
const isDirection = (value) => Object.prototype.hasOwnProperty.call(vectors, value);
const same = (a, b) => a.x === b.x && a.y === b.y;
const copy = (point) => point && { ...point };

export class GameEngine {
  constructor({ cols = 20, rows = 20, random = Math.random, ttlMs = 1500,
    initialSnake, initialFood, initialDirection = 'RIGHT' } = {}) {
    if (!Number.isInteger(cols) || cols < 3 || !Number.isInteger(rows) || rows < 2 ||
        !Number.isFinite(ttlMs) || ttlMs <= 0 || !isDirection(initialDirection)) {
      throw new Error('Invalid game configuration');
    }
    this.cols = cols;
    this.rows = rows;
    this.random = random;
    this.ttlMs = ttlMs;
    const x = Math.max(2, Math.floor(cols / 2)), y = Math.floor(rows / 2);
    this.initialSnake = (initialSnake || [{ x, y }, { x: x - 1, y }, { x: x - 2, y }]).map(copy);
    if (!this.initialSnake.length || this.initialSnake.some((p, i, points) =>
      !Number.isInteger(p.x) || !Number.isInteger(p.y) || !this.inBounds(p) ||
      points.slice(0, i).some((q) => same(p, q)) ||
      (i > 0 && Math.abs(p.x - points[i - 1].x) + Math.abs(p.y - points[i - 1].y) !== 1))) {
      throw new Error('Invalid initial snake');
    }
    if (initialFood && (!this.inBounds(initialFood) || !Number.isInteger(initialFood.x) ||
        !Number.isInteger(initialFood.y) || this.initialSnake.some((p) => same(p, initialFood)))) {
      throw new Error('Invalid initial food');
    }
    this.initialFood = copy(initialFood);
    this.initialDirection = initialDirection;
    this.roundId = 0;
    this.state = 'READY';
    this.snake = this.initialSnake.map(copy);
    this.direction = initialDirection;
    this.food = null;
    this.score = 0;
    this.tick = 0;
    this.pending = null;
    this.result = null;
    this.lastAppliedId = null;
    this.pauseReason = null;
    this.lastDiscardedId = null;
  }

  inBounds(p) { return p.x >= 0 && p.y >= 0 && p.x < this.cols && p.y < this.rows; }

  spawnFood() {
    const occupied = new Set(this.snake.map((p) => `${p.x}:${p.y}`));
    const empty = [];
    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        if (!occupied.has(`${x}:${y}`)) empty.push({ x, y });
      }
    }
    if (!empty.length) return null;
    const value = this.random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Invalid random value');
    return empty[Math.floor(value * empty.length)];
  }

  resetRound() {
    this.roundId += 1;
    this.state = 'RUNNING';
    this.snake = this.initialSnake.map(copy);
    this.direction = this.initialDirection;
    this.pending = null;
    this.score = 0;
    this.tick = 0;
    this.result = null;
    this.lastAppliedId = null;
    this.lastDiscardedId = null;
    this.pauseReason = null;
    this.food = this.initialFood ? copy(this.initialFood) : this.spawnFood();
    if (!this.food) this.finish('WIN', 'board_full');
    return this.snapshot();
  }

  start() {
    if (!['READY', 'ENDED'].includes(this.state)) return this.snapshot();
    return this.resetRound();
  }

  prepare() {
    if (this.state === 'ENDED') this.state = 'READY';
    return this.snapshot();
  }

  finish(outcome, reason) {
    this.state = 'GAME_OVER';
    this.result = { outcome, reason };
    this.pending = null;
  }

  dispatch(event, now) {
    const reject = (reason) => ({ accepted: false, reason });
    if (!event || !Number.isFinite(event.receivedAt) || !Number.isFinite(now) ||
        typeof event.id !== 'string' || !event.id) return reject('invalid_event');
    if (now < event.receivedAt || now - event.receivedAt > this.ttlMs) return reject('expired');
    const { command } = event;
    if (['READY', 'ENDED'].includes(this.state)) return reject('invalid_state');
    if (command === 'END') {
      if (!this.result) this.result = { outcome: 'ABORTED', reason: 'manual_end' };
      this.state = 'ENDED';
      this.pending = null;
    } else if (command === 'RESTART') {
      this.resetRound();
    } else if (command === 'PAUSE' && this.state === 'RUNNING') {
      this.pause('manual');
    } else if (command === 'RESUME' && this.state === 'PAUSED') {
      this.state = 'RUNNING';
      this.pauseReason = null;
    } else if (isDirection(command) && this.state === 'RUNNING') {
      if (command === opposite[this.direction]) return reject('opposite_direction');
      if (this.pending) return reject('turn_pending');
      if (command === this.direction) return { accepted: true, reason: 'same_direction' };
      this.pending = { ...event, roundId: this.roundId };
      return { accepted: true, reason: 'queued' };
    } else {
      return reject('invalid_state');
    }
    return { accepted: true, reason: 'accepted' };
  }

  pause(reason = 'manual') {
    if (this.state === 'RUNNING') {
      this.state = 'PAUSED';
      this.pauseReason = reason;
    }
    this.pending = null;
    return this.snapshot();
  }

  validPending(now) {
    return this.pending && now >= this.pending.receivedAt &&
      now - this.pending.receivedAt <= this.ttlMs && this.pending.roundId === this.roundId;
  }

  nextStepHitsWall(now) {
    const direction = this.validPending(now) ? this.pending.command : this.direction;
    const [dx, dy] = vectors[direction];
    return !this.inBounds({ x: this.snake[0].x + dx, y: this.snake[0].y + dy });
  }

  step(now) {
    if (!Number.isFinite(now)) throw new Error('Invalid step time');
    if (this.state !== 'RUNNING') return this.snapshot();
    this.lastAppliedId = null;
    this.lastDiscardedId = null;
    if (this.pending) {
      if (this.validPending(now)) {
        this.direction = this.pending.command;
        this.lastAppliedId = this.pending.id;
      } else {
        this.lastDiscardedId = this.pending.id;
      }
      this.pending = null;
    }
    const [dx, dy] = vectors[this.direction];
    const head = { x: this.snake[0].x + dx, y: this.snake[0].y + dy };
    const eating = this.food && same(head, this.food);
    const occupied = eating ? this.snake : this.snake.slice(0, -1);
    this.tick += 1;
    if (!this.inBounds(head)) this.finish('LOSS', 'wall');
    else if (occupied.some((p) => same(p, head))) this.finish('LOSS', 'self');
    else {
      this.snake.unshift(head);
      if (eating) {
        this.score += 10;
        this.food = this.spawnFood();
        if (!this.food) this.finish('WIN', 'board_full');
      } else this.snake.pop();
    }
    return this.snapshot();
  }

  snapshot() {
    return {
      cols: this.cols, rows: this.rows, roundId: this.roundId, state: this.state,
      snake: this.snake.map(copy), direction: this.direction,
      pendingDirection: this.pending ? this.pending.command : null,
      food: copy(this.food), score: this.score, tick: this.tick,
      result: this.result && { ...this.result }, pauseReason: this.pauseReason,
      lastAppliedId: this.lastAppliedId, lastDiscardedId: this.lastDiscardedId,
    };
  }
}
