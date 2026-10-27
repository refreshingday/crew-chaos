import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, GAME_CONSTANTS } from '../src/game.js';

function run(game, seconds, inputs = {}) {
  for (let i = 0; i < Math.round(seconds * 60); i++) game.update(1 / 60, inputs);
}

test('same seed and input produce identical encounter state', () => {
  const a = new Game({ seed: 57 });
  const b = new Game({ seed: 57 });
  run(a, 25, { host: { brace: true } });
  run(b, 25, { host: { brace: true } });
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('weight moves the ship in the chosen direction while deck edges constrain walking', () => {
  const game = new Game({ seed: 1 });
  run(game, 3, { host: { x: 1 } });
  assert.ok(game.state.boat.x > 5);
  assert.equal(game.state.players[0].x, GAME_CONSTANTS.DECK_X);
  run(game, 5, { host: { x: -1 } });
  assert.ok(game.state.boat.vx < -5);
  assert.ok(game.state.boat.x >= -18);
});

test('balanced crew cancels steering; overboard weight does not steer', () => {
  const game = new Game({ roster: [{ id: 'a' }, { id: 'b' }] });
  game.state.players[0].x = -3;
  game.state.players[1].x = 3;
  run(game, 1);
  assert.ok(Math.abs(game.state.boat.x) < .01);
  game.state.players[1].state = 'swim';
  game.state.players[1].swimTime = 10;
  run(game, 1);
  assert.ok(game.state.boat.x < -.5);
});

test('bracing resists a wave; unbraced sailor launches', () => {
  const game = new Game({ roster: [{ id: 'a' }, { id: 'b' }] });
  game.state.players.forEach(p => p.invulnerable = 0);
  game.state.waves.push({ id: 99, z: 0, side: 1, strength: 1, hit: false });
  game.update(1 / 60, { a: { brace: true } });
  assert.equal(game.state.players[0].state, 'deck');
  assert.equal(game.state.players[1].state, 'air');
  assert.equal(game.state.stats.perfectBraces, 1);
});

test('solo lifeline returns a swimmer and charges future failures to hull', () => {
  const game = new Game({ seed: 7 });
  const p = game.state.players[0];
  game.state.buoys = 0;
  game.fallOverboard(p);
  run(game, 4);
  assert.equal(p.state, 'deck');
  assert.equal(game.state.hull, 90);
  assert.ok(p.invulnerable > 0);
});

test('manual rescue requires matching rail and completes while held', () => {
  const game = new Game({ roster: [{ id: 'rescuer' }, { id: 'swimmer' }] });
  const [rescuer, swimmer] = game.state.players;
  swimmer.x = 5;
  game.fallOverboard(swimmer);
  rescuer.x = -3;
  run(game, .5, { rescuer: { interact: true } });
  assert.equal(swimmer.rescueProgress, 0);
  rescuer.x = 2.5;
  run(game, 1.8, { rescuer: { interact: true } });
  assert.equal(swimmer.state, 'deck');
  assert.equal(game.state.stats.rescues, 1);
  assert.equal(game.state.score, 50);
});

test('bubble snack prevents one fall, then is consumed', () => {
  const game = new Game();
  const p = game.state.players[0];
  p.snack = 'bubble';
  game.update(1 / 60, { host: { interact: true } });
  assert.ok(p.shield > 0);
  game.fallOverboard(p);
  assert.equal(p.state, 'deck');
  assert.equal(p.shield, 0);
  game.fallOverboard(p);
  assert.equal(p.state, 'swim');
});

test('collision damage has a grace period; supplies repair the hull', () => {
  const game = new Game();
  game.state.obstacles = [0, 1].map(id => ({ id, type: 'wreck', x: 0, z: 0, radius: 2, active: true }));
  game.update(1 / 60);
  assert.equal(game.state.hull, 85);
  game.state.obstacles.push({ id: 3, type: 'supply', x: 0, z: 0, radius: 1, active: true });
  game.update(1 / 60);
  assert.equal(game.state.hull, 100);
});

test('finish gives win score and rescues crew for arrival; zero hull loses', () => {
  const game = new Game({ duration: 120 });
  game.state.time = 119.999;
  game.update(1 / 60, { host: { brace: true } });
  assert.equal(game.state.phase, 'won');
  assert.ok(game.state.score >= 1000);
  const lost = new Game();
  lost.state.hull = 0;
  lost.update(1 / 60);
  assert.equal(lost.state.phase, 'lost');
});

test('all four players can survive 30 seconds braced without non-finite simulation values', () => {
  const roster = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  const game = new Game({ seed: 123, roster });
  run(game, 30, Object.fromEntries(roster.map(p => [p.id, { brace: true }])));
  assert.equal(game.state.players.length, 4);
  assert.ok(game.state.obstacles.length > 0);
  assert.ok(game.state.boat.z > 300);
  for (const p of game.state.players) for (const key of ['x', 'z', 'y', 'vx', 'vz', 'vy']) assert.ok(Number.isFinite(p[key]));
});

test('disconnect removes steering influence and clears rescue references', () => {
  const game = new Game({ roster: [{ id: 'a' }, { id: 'b' }] });
  game.state.players[0].rescueTarget = 'b';
  game.removePlayer('b');
  assert.equal(game.state.players.length, 1);
  assert.equal(game.state.players[0].rescueTarget, null);
});

test('ordinary navigation and timed bracing can finish seeded 180-second voyages with 1–4 players', () => {
  for (const count of [1, 2, 3, 4]) for (const seed of [1, 7, 13, 37, 57]) {
    const roster = Array.from({ length: count }, (_, i) => ({ id: String(i) }));
    const game = new Game({ seed, duration: 180, roster });
    for (let frame = 0; frame < 180 * 60 + 1 && game.state.phase === 'playing'; frame++) {
      const s = game.state;
      // A modest controller follows the next visible reward corridor, using only
      // the same public state available to a player. It braces in the last second.
      const next = s.obstacles.filter(o => o.active && o.z > s.boat.z + 8 && ['supply', 'snack', 'treasure'].includes(o.type))
        .sort((a, b) => a.z - b.z)[0];
      const target = next?.x || 0;
      const waveApproaching = s.waves.some(w => !w.hit && w.z - s.boat.z < 11);
      const desiredDeckX = Math.max(-3.2, Math.min(3.2, (target - s.boat.x) * .45 - s.boat.vx * .7));
      const inputs = Object.fromEntries(s.players.map(p => [p.id, {
        x: Math.max(-1, Math.min(1, (desiredDeckX - p.x) * 2)), z: (.5 - p.z) * 2,
        brace: waveApproaching, interact: !!p.snack,
      }]));
      game.update(1 / 60, inputs);
    }
    assert.equal(game.state.phase, 'won', `crew=${count}, seed=${seed}`);
    assert.equal(game.state.time, 180);
    assert.ok(game.state.hull > 0);
  }
});

test('one emergency buoy recovers the whole overboard crew', () => {
  const game = new Game({ roster: ['a', 'b', 'c', 'd'].map(id => ({ id })) });
  game.state.players.forEach(p => game.fallOverboard(p));
  run(game, 3.2);
  assert.equal(game.state.buoys, 1);
  assert.ok(game.state.players.every(p => p.state === 'rescue'));
  run(game, 1.3);
  assert.ok(game.state.players.every(p => p.state === 'deck'));
  assert.equal(game.state.phase, 'playing');
});

test('a crew wipe with no buoy has a grace period then ends the voyage', () => {
  const game = new Game({ roster: [{ id: 'a' }, { id: 'b' }] });
  game.state.buoys = 0;
  game.state.players.forEach(p => game.fallOverboard(p));
  run(game, 6);
  assert.equal(game.state.phase, 'playing');
  run(game, 1.2);
  assert.equal(game.state.phase, 'lost');
  assert.match(game.state.message, /overboard/);
});

test('an airborne crew is not treated as a wipe before landing', () => {
  const game = new Game({ roster: [{ id: 'a' }, { id: 'b' }] });
  game.state.buoys = 0;
  game.state.players.forEach(p => { p.state = 'air'; p.y = 1000; });
  run(game, 7.2);
  assert.equal(game.state.phase, 'playing');
  assert.equal(game.state.wipeTime, 0);
});

test('an interrupted lifeline resumes the swim timer and preserves partial progress briefly', () => {
  const game = new Game({ roster: [{ id: 'a' }, { id: 'b' }] });
  const [rescuer, swimmer] = game.state.players;
  rescuer.x = 2.5; swimmer.x = 5;
  game.fallOverboard(swimmer);
  run(game, .5, { a: { interact: true } });
  const progress = swimmer.rescueProgress;
  const remaining = swimmer.swimTime;
  run(game, .5);
  assert.equal(swimmer.state, 'swim');
  assert.ok(swimmer.swimTime < remaining);
  assert.ok(swimmer.rescueProgress > 0 && swimmer.rescueProgress < progress);
});
