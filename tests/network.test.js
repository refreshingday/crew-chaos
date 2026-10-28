import test from 'node:test';
import assert from 'node:assert/strict';
import { CrewNetwork, normalizeRoomCode, sanitizeInput, validSnapshot, NETWORK_PROTOCOL } from '../src/network.js';
import { Game } from '../src/game.js';
import { ADDON_IDS } from '../src/addons.js';

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
const snapshot = (score = 0) => ({ ...new Game({ seed: 7 }).snapshot(), score });
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
  const stale = { v: NETWORK_PROTOCOL, type: 'input', run: 1, seq: 999, input: { x: -1 } };
  host.startGame({}); await flush();
  let count = 0; host.addEventListener('input', () => count++);
  guest.session.links.get('host').connection.send(stale);
  await flush(); assert.equal(count, 0);
  const fresh = once(host, 'input'); guest.sendInput({ x: .25 });
  assert.equal((await fresh).input.x, .25);
}));

test('snapshots reset sequence on rematch and ignore previous run', async () => using(2, async ([host, guest]) => {
  const room = await host.host(); await guest.join(room); host.startGame({}); await flush();
  for (let i = 0; i < 5; i++) host.broadcast(snapshot(i)); await flush();
  host.startGame({}); await flush();
  const received = once(guest, 'snapshot'); host.broadcast(snapshot(99));
  assert.equal((await received).score, 99);
  let count = 0; guest.addEventListener('snapshot', () => count++);
  const link = [...host.session.links.values()][0];
  link.connection.send({ v: NETWORK_PROTOCOL, type: 'snapshot', run: 1, seq: 999, state: snapshot(77) });
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
  assert.ok(MockPeer.registry.has('crew-chaos-web-v4-' + room));
  const s = host.session; host.leave();
  assert.equal(s.timers.size, 0); assert.equal(s.cancels.size, 0);
  assert.ok(!MockPeer.registry.has('crew-chaos-web-v4-' + room));
}));

test('v4 snapshots support open-ocean coordinates, moving waves, effects and bounded impacts', () => {
  const s = snapshot();
  s.boat.x = -15_000; s.boat.z = 50_000; s.boat.speed = 38.5;
  s.boat.trim = .8; s.boat.targetSpeed = 40; s.boat.speedTier = 3;
  s.boat.effects = { ghost: 4, magnet: 7, disco: 0, octopus: 2, thunder: 0 };
  s.players[0].effects = Object.fromEntries(['bubble', 'chili', 'anchor', 'jelly', 'magnet', 'ghost', 'balloon', 'disco', 'banana', 'thunder', 'giant', 'octopus'].map(key => [key, 2]));
  s.players[0].snack = 'octopus';
  s.pace = { tier: 3, baseSpeed: 30, nextAt: 120 };
  s.waves = [{ id: 88, x: -15_001, z: 50_010, width: 18, speed: 10, hit: false, passed: false, dodged: false, kind: 'breaker', side: 0, strength: 1.2, at: 12 }];
  s.impacts = Array.from({ length: 16 }, (_, i) => ({ id: i, x: -15_000, z: 50_000, at: i, damage: i, kind: 'thunder', blocked: i % 2 === 0 }));
  assert.equal(validSnapshot(s), true);
  assert.ok(new TextEncoder().encode(JSON.stringify(s)).byteLength < 60_000);
});

test('island snapshots retain their elliptical collision footprint and impact', () => {
  const s = snapshot();
  s.obstacles = [{ id: 123, type: 'island', x: 500, z: 100, radius: 9.4, radiusZ: 7.05, active: true }];
  s.impacts = [{ id: 124, x: 493, z: 100, at: s.time, damage: 18, kind: 'island', blocked: false }];
  assert.equal(validSnapshot(s), true);
  for (const radiusZ of [undefined, 0, -2, Infinity, '7.05']) {
    s.obstacles[0].radiusZ = radiusZ;
    assert.equal(validSnapshot(s), false, `invalid island length ${String(radiusZ)}`);
  }
});

test('malformed snapshots are ignored without consuming their sequence number', async () => using(2, async ([host, guest]) => {
  const room = await host.host(); await guest.join(room); host.startGame({}); await flush();
  const channel = [...host.session.links.values()][0].connection;
  const broken = snapshot(); broken.events = null;
  let count = 0; guest.addEventListener('snapshot', () => count++);
  channel.send({ v: NETWORK_PROTOCOL, type: 'snapshot', run: 1, seq: 500, state: broken });
  await flush(); assert.equal(count, 0);
  const received = once(guest, 'snapshot'); host.broadcast(snapshot(25));
  assert.equal((await received).score, 25);
}));

test('snapshot validation rejects malformed structures, non-finite numbers and oversized effects', () => {
  const mutations = [
    s => { s.players = {}; },
    s => { s.players.push({ ...s.players[0] }); },
    s => { s.boat.x = Infinity; },
    s => { s.players[0].vx = NaN; },
    s => { s.players[0].effects = { chili: 'fast' }; },
    s => { s.boat.effects = { ghost: -1 }; },
    s => { s.impacts = Array.from({ length: 17 }, (_, id) => ({ id, x: 0, z: 0, at: 0, damage: 0, kind: 'crate', blocked: false })); },
    s => { s.pace = { tier: 2, baseSpeed: 30 }; },
    s => { s.pace.nextAt = -1; },
    s => { s.obstacles = [null]; },
    s => { s.waves = [{ id: 3, z: 20, side: 0, strength: 1, hit: false, kind: 'breaker', speed: Infinity }]; },
    s => { s.events.push({ id: 2, kind: 'tip', text: 'x'.repeat(513), at: 0 }); },
    s => { s.extra = s; },
  ];
  for (const mutate of mutations) { const s = snapshot(); mutate(s); assert.equal(validSnapshot(s), false); }
  assert.equal(validSnapshot(null), false);
  assert.equal(validSnapshot([]), false);
});

test('previous protocol packets cannot control or update a v4 room', async () => using(2, async ([host, guest]) => {
  const room = await host.host(); await guest.join(room); host.startGame({}); await flush();
  let inputs = 0, updates = 0;
  host.addEventListener('input', () => inputs++); guest.addEventListener('snapshot', () => updates++);
  guest.session.links.get('host').connection.send({ v: 3, type: 'input', run: 1, seq: 1, input: { x: 1 } });
  [...host.session.links.values()][0].connection.send({ v: 3, type: 'snapshot', run: 1, seq: 1, state: snapshot() });
  await flush(); assert.equal(inputs, 0); assert.equal(updates, 0);
}));

test('31 real voyage snapshots reach every guest through tier eight and victory', async () => using(4, async ([host, ...guests]) => {
  const room = await host.host('Captain');
  for (let i = 0; i < guests.length; i++) await guests[i].join(room, `Sailor ${i + 1}`);
  const config = { seed: 31, duration: 180, roster: host.roster };
  const game = new Game(config);
  const inputs = Object.fromEntries(game.state.players.map(p => [p.id, { x: .7, z: .6, brace: true }]));
  const received = guests.map(() => []);
  guests.forEach((guest, i) => guest.addEventListener('snapshot', e => received[i].push(e.detail)));
  host.startGame(config); await flush();
  const tiers = new Set();
  let largestPacket = 0;
  for (let checkpoint = 0; checkpoint <= 30; checkpoint++) {
    const targetTime = checkpoint * 6;
    if (checkpoint > 0) {
      // Exercise the real snack code, timers, impact history, moving waves,
      // and open-ocean movement rather than constructing a parallel fixture.
      const p = game.state.players[checkpoint % game.state.players.length];
      p.snack = ADDON_IDS[(checkpoint - 1) % ADDON_IDS.length];
      game.useSnack(p);
    }
    while (game.state.phase === 'playing' && game.state.time + 1e-7 < targetTime) {
      // Keep the voyage alive so this protocol test reaches every pace tier.
      // Hull balance is tested by the simulation suite, not this transport test.
      game.state.hull = 100;
      game.update(.25, inputs);
    }
    if (checkpoint === 30 && game.state.phase === 'playing') game.update(.25, inputs);
    const state = game.snapshot();
    assert.equal(validSnapshot(state), true, `real snapshot rejected at ${state.time}s / tier ${state.pace.tier} / phase ${state.phase}`);
    tiers.add(state.pace.tier);
    largestPacket = Math.max(largestPacket, new TextEncoder().encode(JSON.stringify(state)).byteLength);
    host.broadcast(state); await flush();
  }
  assert.equal(game.state.phase, 'won');
  assert.deepEqual([...tiers], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(game.state.pace.nextAt, null);
  assert.ok(Math.abs(game.state.boat.x) > 18, 'actual voyage travels beyond the former horizontal bound');
  assert.ok(largestPacket < 60_000);
  for (const states of received) {
    assert.equal(states.length, 31, 'every actual state reaches each connected guest');
    assert.equal(states.at(-1).phase, 'won');
    assert.equal(states.at(-1).pace.tier, 8);
    assert.equal(states.at(-1).pace.nextAt, null);
  }
}));

test('actual final-tier defeat remains a valid guest snapshot', () => {
  const game = new Game({ seed: 73, duration: 180 });
  const inputs = { host: { x: -.65, z: -.6, brace: true } };
  while (game.state.time < 162) {
    game.state.hull = 100;
    game.update(.25, inputs);
  }
  assert.equal(game.state.pace.tier, 8);
  assert.equal(game.state.pace.nextAt, null);
  assert.equal(validSnapshot(game.snapshot()), true);
  game.state.hull = 0;
  game.update(1 / 60, inputs);
  assert.equal(game.state.phase, 'lost');
  assert.equal(validSnapshot(game.snapshot()), true);
});

test('actual island collision and automatic climbing snapshots reach a guest', async () => using(2, async ([host, guest]) => {
  const room = await host.host('Captain');
  await guest.join(room, 'Swimmer');
  const config = { seed: 97, duration: 180, roster: host.roster };
  const game = new Game(config);
  host.startGame(config); await flush();
  const received = [];
  guest.addEventListener('snapshot', event => received.push(event.detail));
  const sendActualState = async () => {
    const state = game.snapshot();
    assert.equal(validSnapshot(state), true);
    host.broadcast(state); await flush();
    assert.deepEqual(received.at(-1), state);
  };

  // Place an authoritative island under the ship, then use the production
  // collision path: terrain persists while damage and launches replicate.
  const island = { id: game.nextId++, type: 'island', x: 0, z: 0, radius: 5.2, radiusZ: 3.9, active: true };
  game.state.obstacles = [island];
  game.updateObstacles();
  assert.equal(game.state.hull, 82);
  assert.equal(island.active, true);
  assert.equal(game.state.impacts.at(-1).kind, 'island');
  await sendActualState();

  // The guest swims to an ordinary section of the starboard hull. No deck
  // rescuer presses Interact; boarding is a host-authoritative transition.
  const captain = game.state.players.find(p => p.id === host.localId);
  captain.state = 'deck'; captain.x = 0; captain.y = 1.8; captain.vx = captain.vy = captain.vz = 0;
  const swimmer = game.state.players.find(p => p.id === guest.localId);
  game.fallOverboard(swimmer);
  swimmer.x = 4.5; swimmer.z = 1;
  const buoys = game.state.buoys, score = game.state.score;
  game.update(.2, {});
  assert.equal(swimmer.state, 'rescue');
  assert.equal(swimmer.boarding, true);
  assert.equal(swimmer.automaticRescue, true);
  await sendActualState();
  for (let i = 0; i < 3; i++) game.update(.2, {});
  assert.equal(swimmer.state, 'deck');
  assert.equal(game.state.buoys, buoys);
  assert.equal(game.state.score, score);
  await sendActualState();
  assert.equal(received.length, 3);
  assert.equal(received[1].players.find(p => p.id === guest.localId).boarding, true);
  assert.equal(received[2].players.find(p => p.id === guest.localId).state, 'deck');
}));


test('wave impact feedback remains valid on guest snapshots', () => {
  const s = snapshot();
  s.impacts = [{id:123,x:0,z:1,at:s.time,damage:0,kind:'wave',blocked:false}];
  assert.equal(validSnapshot(s),true);
  s.impacts[0].blocked=true;
  assert.equal(validSnapshot(s),true);
});
