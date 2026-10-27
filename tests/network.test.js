import test from 'node:test';
import assert from 'node:assert/strict';
import { CrewNetwork, normalizeRoomCode, sanitizeInput } from '../src/network.js';

// In-memory PeerJS surface: no public service, sockets, browser, or clock sleeps.
class Emitter {
  constructor() { this.handlers = new Map(); }
  on(type, fn) { const a = this.handlers.get(type) || []; a.push(fn); this.handlers.set(type, a); return this; }
  emit(type, value) { for (const fn of this.handlers.get(type) || []) fn(value); }
}
class Channel extends Emitter {
  constructor(metadata) { super(); this.metadata = metadata; this.open = false; this.bufferSize = 0; this.closed = false; }
  send(data) { if (this.open) queueMicrotask(() => { if (this.other.open) this.other.emit('data', structuredClone(data)); }); }
  close() {
    if (this.closed) return;
    this.closed = true; this.open = false; this.emit('close');
    if (this.other && !this.other.closed) this.other.close();
  }
}
class MockPeer extends Emitter {
  static registry = new Map();
  static count = 0;
  constructor(idOrOptions) {
    super(); this.id = typeof idOrOptions === 'string' ? idOrOptions : 'guest-' + ++MockPeer.count;
    this.destroyed = false; this.disconnected = false; this.channels = [];
    queueMicrotask(() => {
      if (this.destroyed) return;
      if (MockPeer.registry.has(this.id)) this.emit('error', { type: 'unavailable-id' });
      else { MockPeer.registry.set(this.id, this); this.emit('open', this.id); }
    });
  }
  connect(id, options) {
    const local = new Channel(options.metadata), remote = new Channel(options.metadata);
    local.other = remote; remote.other = local; this.channels.push(local);
    queueMicrotask(() => {
      const host = MockPeer.registry.get(id);
      if (!host) { this.emit('error', { type: 'peer-unavailable' }); return; }
      host.channels.push(remote); host.emit('connection', remote);
      queueMicrotask(() => {
        if (local.closed || remote.closed) return;
        local.open = remote.open = true; remote.emit('open'); local.emit('open');
      });
    });
    return local;
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (MockPeer.registry.get(this.id) === this) MockPeer.registry.delete(this.id);
    for (const channel of this.channels) channel.close();
    this.emit('close');
  }
}

const make = () => new CrewNetwork({ PeerClass: MockPeer });
const flush = () => new Promise(resolve => setImmediate(resolve));
const once = (target, type) => new Promise(resolve => target.addEventListener(type, e => resolve(e.detail), { once: true }));
const using = async (count, fn) => {
  const clients = Array.from({ length: count }, make);
  try { await fn(clients); }
  finally { for (const client of clients) client.leave(); await flush(); }
};

test('room codes accept exactly four case-insensitive alphanumeric characters', () => {
  assert.equal(normalizeRoomCode(' a9z2 '), 'A9Z2');
  for (const bad of ['', 'A12', 'A1234', '<x/>', 'A B2', '中文12']) assert.throws(() => normalizeRoomCode(bad));
});

test('remote input is clamped, finite, and contains no submitted identity', () => {
  assert.deepEqual(sanitizeInput({ x: Infinity, z: -44, brace: 1, interact: true, ping: 'yes', id: 'host' }),
    { x: 0, z: -1, brace: false, interact: true, ping: false });
  assert.deepEqual(sanitizeInput(null), { x: 0, z: 0, brace: false, interact: false, ping: false });
});

test('four clients join one room with stable individual identity and roster', async () => using(4, async ([host, ...guests]) => {
  const room = await host.host('Captain');
  assert.match(room, /^[A-Z0-9]{4}$/);
  for (let i = 0; i < guests.length; i++) await guests[i].join(room.toLowerCase(), 'Sailor ' + i);
  await flush();
  assert.equal(host.roster.length, 4);
  const ids = new Set([host.localId, ...guests.map(g => g.localId)]);
  assert.equal(ids.size, 4);
  for (const guest of guests) {
    assert.equal(guest.roster.length, 4);
    assert.deepEqual(guest.roster, host.roster);
  }
}));

test('fifth sailor is explicitly rejected without changing existing roster', async () => using(5, async ([host, ...guests]) => {
  const room = await host.host('Captain');
  for (const guest of guests.slice(0, 3)) await guest.join(room, 'Sailor');
  await assert.rejects(guests[3].join(room, 'Extra'), /Room full/);
  assert.equal(host.roster.length, 4);
  assert.equal(guests[3].session, null);
}));

test('host rejects new joins after launch and existing crew can rematch', async () => using(3, async ([host, guest, late]) => {
  const room = await host.host(); await guest.join(room);
  let started = once(guest, 'start');
  host.startGame({ seed: 42 });
  assert.deepEqual(await started, { seed: 42 });
  await assert.rejects(late.join(room), /already started/);
  started = once(guest, 'start');
  host.startGame({ seed: 99 });
  assert.deepEqual(await started, { seed: 99 });
}));

test('authoritative inputs identify sender and stale run packets cannot affect rematch', async () => using(2, async ([host, guest]) => {
  const room = await host.host(); await guest.join(room);
  host.startGame({}); await flush();
  const received = once(host, 'input');
  guest.sendInput({ x: 3, z: NaN, interact: true, id: 'host' });
  assert.deepEqual(await received, { id: guest.localId, input: { x: 1, z: 0, brace: false, interact: true, ping: false } });
  const stale = { v: 1, type: 'input', run: 1, seq: 999, input: { x: -1 } };
  host.startGame({}); await flush();
  let count = 0; host.addEventListener('input', () => count++);
  guest.session.links.get('host').connection.send(stale);
  await flush(); assert.equal(count, 0);
  const fresh = once(host, 'input'); guest.sendInput({ x: .25 });
  assert.equal((await fresh).input.x, .25);
}));

test('snapshots reset sequence on rematch and ignore previous run', async () => using(2, async ([host, guest]) => {
  const room = await host.host(); await guest.join(room); host.startGame({}); await flush();
  for (let i = 0; i < 5; i++) host.broadcast({ n: i }); await flush();
  host.startGame({}); await flush();
  const received = once(guest, 'snapshot'); host.broadcast({ n: 99 });
  assert.deepEqual(await received, { n: 99 });
  let count = 0; guest.addEventListener('snapshot', () => count++);
  const link = [...host.session.links.values()][0];
  link.connection.send({ v: 1, type: 'snapshot', run: 1, seq: 999, state: { n: -1 } });
  await flush(); assert.equal(count, 0);
}));

test('disconnect updates every roster and host departure ends guest session', async () => using(3, async ([host, guest, leaver]) => {
  const room = await host.host(); await guest.join(room); await leaver.join(room);
  const departedId = leaver.localId; leaver.leave(); await flush();
  assert.equal(host.roster.length, 2); assert.equal(guest.roster.length, 2);
  assert.ok(!host.roster.some(p => p.id === departedId));
  const ended = once(guest, 'closed'); host.leave();
  assert.match(await ended, /host/i);
  assert.equal(guest.session, null);
}));

test('missing room fails promptly and cleanup releases reservations', async () => using(2, async ([host, guest]) => {
  await assert.rejects(guest.join('ZZZZ'), /Room not found/);
  const room = await host.host();
  assert.ok(MockPeer.registry.has('crew-chaos-web-v1-' + room));
  const s = host.session; host.leave();
  assert.equal(s.timers.size, 0); assert.equal(s.cancels.size, 0);
  assert.ok(!MockPeer.registry.has('crew-chaos-web-v1-' + room));
}));
