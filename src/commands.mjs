const phrases = new Map([
  ['上', 'UP'], ['向上', 'UP'], ['往上', 'UP'],
  ['下', 'DOWN'], ['向下', 'DOWN'], ['往下', 'DOWN'],
  ['左', 'LEFT'], ['向左', 'LEFT'], ['往左', 'LEFT'],
  ['右', 'RIGHT'], ['向右', 'RIGHT'], ['往右', 'RIGHT'],
  ['暂停', 'PAUSE'], ['停一下', 'PAUSE'],
  ['继续', 'RESUME'], ['继续游戏', 'RESUME'],
  ['重新开始', 'RESTART'], ['再来一局', 'RESTART'],
  ['结束游戏', 'END'], ['不玩了', 'END'],
]);

const allowed = {
  READY: new Set(),
  RUNNING: new Set(['UP', 'DOWN', 'LEFT', 'RIGHT', 'PAUSE', 'RESTART', 'END']),
  PAUSED: new Set(['RESUME', 'RESTART', 'END']),
  GAME_OVER: new Set(['RESTART', 'END']),
  ENDED: new Set(),
};

export function parseCommand(text) {
  if (typeof text !== 'string') return null;
  const normalized = text.trim().replace(/\s/g, '').replace(/[。.!！?？,，、;；]+$/g, '');
  return phrases.get(normalized) || null;
}

export function createCommandGate({ ttlMs = 1500, capacity = 256 } = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || !Number.isInteger(capacity) || capacity < 1) {
    throw new Error('Invalid gate configuration');
  }
  const seen = new Set();
  return {
    accept(event, state, now) {
      if (!event || typeof event.id !== 'string' || !event.id ||
          !Number.isFinite(event.receivedAt) || !Number.isFinite(now)) {
        return { accepted: false, reason: 'invalid_event' };
      }
      if (seen.has(event.id)) return { accepted: false, reason: 'duplicate' };
      seen.add(event.id);
      if (seen.size > capacity) seen.delete(seen.values().next().value);
      const age = now - event.receivedAt;
      if (age < 0 || age > ttlMs) return { accepted: false, reason: 'expired' };
      if (!allowed[state] || !allowed[state].has(event.command)) {
        return { accepted: false, reason: 'invalid_state' };
      }
      return { accepted: true, reason: 'accepted' };
    },
  };
}
