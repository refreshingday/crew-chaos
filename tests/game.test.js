import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, GAME_CONSTANTS } from '../src/game.js';
import { ADDONS, ADDON_IDS } from '../src/addons.js';

function run(game, seconds, inputs = {}) {
  for (let i = 0; i < Math.round(seconds * 60); i++) game.update(1 / 60, inputs);
}

function assertFiniteSnapshot(value, path = 'state') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} must be finite`);
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) assertFiniteSnapshot(item, `${path}.${key}`);
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
  assert.ok(Number.isFinite(game.state.boat.x));
});

test('balanced crew cancels steering; overboard weight does not steer', () => {
  const game = new Game({ roster: [{ id: 'a' }, { id: 'b' }] });
  game.state.players[0].x = -3;
  game.state.players[1].x = 3;
  run(game, 1);
  assert.ok(Math.abs(game.state.boat.x) < .01);
  game.state.players[1].state = 'swim';
  game.state.players[1].x = 6.5;
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
  p.x = 6.5; p.z = -6;
  game.fallOverboard(p);
  run(game, 4);
  assert.equal(p.state, 'deck');
  assert.equal(game.state.hull, 90);
  assert.ok(p.invulnerable > 0);
});

test('manual rescue requires matching rail and completes while held', () => {
  const game = new Game({ roster: [{ id: 'rescuer' }, { id: 'swimmer' }] });
  const [rescuer, swimmer] = game.state.players;
  swimmer.x = 6.2;
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

test('harder seeded voyages remain winnable and end cleanly for all crew sizes', () => {
  let wins = 0, losses = 0;
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
      if (frame % 600 === 0) assertFiniteSnapshot(game.snapshot());
    }
    assert.ok(['won','lost'].includes(game.state.phase), `crew=${count}, seed=${seed}`);
    if (game.state.phase === 'won') { wins++; assert.equal(game.state.time, 180); assert.ok(game.state.hull > 0); }
    else { losses++; assert.ok(game.state.hull === 0 || game.state.wipeTime > 7, 'defeat has a gameplay cause'); }
    assertFiniteSnapshot(game.snapshot());
  }
  assert.ok(wins > 0 && losses > 0, 'the harder benchmark is winnable but punishes some routes');
});

test('one emergency buoy recovers the whole overboard crew', () => {
  const game = new Game({ roster: ['a', 'b', 'c', 'd'].map(id => ({ id })) });
  game.state.players.forEach(p => { p.x = 6.5; p.z = -6; game.fallOverboard(p); });
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
  game.state.players.forEach(p => { p.x = 6.5; p.z = -6; game.fallOverboard(p); });
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
  rescuer.x = 2.5; swimmer.x = 6.3;
  game.fallOverboard(swimmer);
  run(game, .5, { a: { interact: true } });
  const progress = swimmer.rescueProgress;
  const remaining = swimmer.swimTime;
  run(game, .5);
  assert.equal(swimmer.state, 'swim');
  assert.ok(swimmer.swimTime < remaining);
  assert.ok(swimmer.rescueProgress > 0 && swimmer.rescueProgress < progress);
});

function quietGame(options) {
  const game = new Game(options);
  game.nextChunk = Infinity;
  game.nextWave = Infinity;
  game.state.obstacles = [];
  return game;
}

function eat(game, id, index = 0) {
  const player = game.state.players[index];
  player.snack = id;
  game.useSnack(player);
  return player;
}

test('the boat can travel beyond 100m sideways while sailors remain inside the deck', () => {
  const game = quietGame();
  run(game, 25, { host: { x: 1 } });
  assert.ok(game.state.boat.x > 170);
  assert.equal(game.state.players[0].x, GAME_CONSTANTS.DECK_X);
  run(game, 50, { host: { x: -1 } });
  assert.ok(game.state.boat.x < -170);
  assert.equal(game.state.players[0].x, -GAME_CONSTANTS.DECK_X);
});

test('new encounters follow the boat anywhere on the ocean with a bounded course prediction', () => {
  for (const x of [-5000, 2500]) {
    const game = quietGame({ seed: 44 });
    game.state.boat.x = x;
    game.state.boat.vx = 4;
    game.spawnChunk();
    assert.ok(game.state.obstacles.length >= 3);
    for (const obstacle of game.state.obstacles) assert.ok(Math.abs(obstacle.x - x) < 40);
    game.spawnWave();
    assert.ok(Math.abs(game.state.waves[0].x - x) < 15);
  }
});

test('every deck sailor jumps on collision; brace reduces height and the impact retains actual damage', () => {
  const game = quietGame({ roster: [{ id: 'a' }, { id: 'b' }] });
  game.state.obstacles.push({ id: 50, type: 'crate', x: 0, z: 0, radius: 1, active: true });
  game.update(1 / 60, { a: { brace: true } });
  const [braced, loose] = game.state.players;
  assert.equal(braced.state, 'air');
  assert.equal(loose.state, 'air');
  assert.ok(braced.vy > 0 && braced.vy < loose.vy);
  assert.equal(game.state.hull, 94);
  assert.deepEqual(game.state.impacts.map(i => ({ damage: i.damage, kind: i.kind, blocked: i.blocked })),
    [{ damage: 6, kind: 'crate', blocked: false }]);
  assert.ok(Number.isFinite(game.snapshot().impacts[0].x));
});

test('waves visibly advance toward the boat and hit only their finite horizontal span', () => {
  const game = quietGame();
  const p = game.state.players[0];
  p.invulnerable = 0;
  const wave = { id: 70, x: 0, z: 30, width: 12, speed: 8, hit: false, passed: false, side: 0, strength: 1 };
  game.state.waves.push(wave);
  run(game, .5);
  assert.ok(wave.z < 26.01 && wave.z > 25.99);
  assert.equal(wave.hit, false);
  run(game, 1.2);
  assert.equal(wave.hit, true);
  assert.equal(wave.passed, true);
  assert.equal(p.state, 'air');

  const dodged = quietGame();
  const miss = { id: 71, x: 30, z: 15, width: 12, speed: 8, hit: false, passed: false, side: 0, strength: 1 };
  dodged.state.waves.push(miss);
  run(dodged, 1);
  assert.equal(miss.hit, false);
  assert.equal(miss.passed, true);
  assert.equal(miss.dodged, true);
  assert.equal(dodged.state.players[0].state, 'deck');
  assert.equal(dodged.state.stats.waveDodges, 1);
});

test('generated waves have finite width and preserve an actionable closing-time warning at high speed', () => {
  const game = quietGame({ seed: 39 });
  game.state.boat.speed = 22;
  game.spawnWave();
  const wave = game.state.waves[0];
  const warning = (wave.z - game.state.boat.z) / (wave.speed + game.state.boat.speed);
  assert.ok(wave.width >= 18 && wave.width <= 24);
  assert.ok(wave.speed >= 10 && wave.speed <= 13);
  assert.ok(warning >= 3.3 && warning <= 3.7);
  assert.equal(wave.kind, 'breaker');
  assert.equal(wave.side, 0);
});

test('front and rear crew trim change forward speed without stopping or reversing the ship', () => {
  const forward = quietGame();
  const aft = quietGame();
  forward.state.players[0].z = GAME_CONSTANTS.DECK_Z;
  aft.state.players[0].z = -GAME_CONSTANTS.DECK_Z;
  run(forward, 5);
  run(aft, 5);
  assert.ok(forward.state.boat.speed > 13);
  assert.ok(aft.state.boat.speed >= 9 && aft.state.boat.speed < 10);
  assert.equal(forward.state.boat.trim, 1);
  assert.equal(aft.state.boat.trim, -1);
  assert.ok(forward.state.boat.z > aft.state.boat.z);
});

test('scheduled tide tiers increase speed through the voyage while trim remains available', () => {
  const game = quietGame({ duration: 180 });
  run(game, 20.1);
  assert.equal(game.state.boat.speedTier, 1);
  assert.ok(game.state.pace.baseSpeed > 14.5);
  assert.equal(game.state.pace.nextAt, 40);
  game.state.time = 160;
  game.state.players[0].z = GAME_CONSTANTS.DECK_Z;
  run(game, 5);
  assert.equal(game.state.boat.speedTier, 8);
  assert.equal(game.state.pace.nextAt, null);
  assert.ok(game.state.boat.speed > 28 && game.state.boat.speed <= 31);
  assert.ok(game.state.events.some(e => e.kind === 'pace'));
});

test('all twelve add-ons have usable shared metadata and a shuffled non-repeating spawn bag', () => {
  assert.equal(ADDON_IDS.length, 12);
  const game = quietGame({ seed: 42 });
  const bag = Array.from({ length: 12 }, () => game.nextAddon());
  assert.deepEqual([...bag].sort(), [...ADDON_IDS].sort());
  for (const id of ADDON_IDS) {
    const a = ADDONS[id];
    assert.ok(a.name && a.icon && a.color && a.description && a.duration > 0);
    const p = eat(game, id);
    assert.equal(p.snack, null);
    assert.ok(p.effects[id] > 0);
  }
  const opportunities = quietGame({ seed: 42 });
  for (let chunk = 0; chunk < 25; chunk++) opportunities.spawnChunk();
  const snacks = opportunities.state.obstacles.filter(o => o.type === 'snack');
  assert.ok(snacks.length >= 12);
  assert.equal(new Set(snacks.slice(0, 12).map(o => o.snack)).size, 12);
});

test('magnet collects farther-away supplies; disco and banana change treasure value', () => {
  const game = quietGame();
  game.state.hull = 50;
  game.state.obstacles.push({ id: 80, type: 'supply', x: 7, z: 0, radius: 1, active: true });
  game.update(1 / 60);
  assert.equal(game.state.hull, 50);
  eat(game, 'magnet');
  game.update(1 / 60);
  assert.equal(game.state.hull, 68);
  eat(game, 'disco'); eat(game, 'banana');
  game.state.obstacles.push({ id: 81, type: 'treasure', x: 0, z: game.state.boat.z, radius: 1, active: true });
  game.update(1 / 60);
  assert.equal(game.state.score, 250);
});

test('ghost phases through a hazard without hull damage or collision jumps', () => {
  const game = quietGame();
  eat(game, 'ghost');
  game.state.obstacles.push({ id: 90, type: 'wreck', x: 0, z: 0, radius: 2, active: true });
  game.update(1 / 60);
  assert.equal(game.state.hull, 100);
  assert.equal(game.state.players[0].state, 'deck');
  assert.equal(game.state.impacts[0].blocked, true);
  assert.equal(game.state.impacts[0].damage, 0);
});

test('jelly strengthens air correction and bounces a forgiving landing; balloon reduces gravity', () => {
  const jelly = quietGame();
  const plain = quietGame();
  const jp = eat(jelly, 'jelly');
  const pp = plain.state.players[0];
  for (const p of [jp, pp]) { p.state = 'air'; p.y = 4; p.vy = 1; }
  jelly.update(1 / 60, { host: { x: 1 } });
  plain.update(1 / 60, { host: { x: 1 } });
  assert.ok(jp.vx > pp.vx * 2);
  jp.x = GAME_CONSTANTS.DECK_X + .6; jp.y = GAME_CONSTANTS.DECK_Y + .01; jp.vy = -2;
  jelly.update(1 / 60);
  assert.ok(jp.vy > 0);
  assert.equal(jp.jellyBounced, true);
  assert.ok(jp.x <= GAME_CONSTANTS.DECK_X);

  const balloon = quietGame();
  const bp = eat(balloon, 'balloon');
  bp.state = pp.state = 'air'; bp.y = pp.y = 5; bp.vy = pp.vy = 4;
  balloon.update(1 / 60);
  plain.update(1 / 60);
  assert.ok(bp.vy > pp.vy);
});

test('banana has slippery stopping, and giant changes both steering weight and walking speed', () => {
  const banana = quietGame();
  const normal = quietGame();
  const bp = eat(banana, 'banana');
  bp.vx = normal.state.players[0].vx = 4;
  banana.update(.1); normal.update(.1);
  assert.ok(bp.vx > normal.state.players[0].vx * 2);
  const giant = quietGame();
  eat(giant, 'giant');
  run(giant, .3, { host: { x: 1 } });
  const walking = quietGame();
  run(walking, .3, { host: { x: 1 } });
  assert.ok(giant.state.players[0].x < walking.state.players[0].x);
  giant.state.players[0].x = walking.state.players[0].x = 2;
  run(giant, .5); run(walking, .5);
  assert.ok(giant.state.boat.steer > walking.state.boat.steer);
});

test('thunder clears nearby hazards, preserves supplies, and records its shockwave', () => {
  const game = quietGame();
  game.state.obstacles = [
    { id: 100, type: 'crate', x: 0, z: 20, radius: 1, active: true },
    { id: 101, type: 'wreck', x: 0, z: 45, radius: 2, active: true },
    { id: 102, type: 'supply', x: 0, z: 10, radius: 1, active: true },
  ];
  eat(game, 'thunder');
  assert.equal(game.state.obstacles[0].active, false);
  assert.equal(game.state.obstacles[1].active, true);
  assert.equal(game.state.obstacles[2].active, true);
  assert.equal(game.state.score, 25);
  assert.equal(game.state.impacts.at(-1).kind, 'thunder');
});

test('octopus retrieves swimming crew without a buoy or protects against waves when no one needs rescue', () => {
  const game = quietGame({ roster: [{ id: 'a' }, { id: 'b' }] });
  const swimmer = game.state.players[1];
  swimmer.x = -5;
  game.fallOverboard(swimmer);
  eat(game, 'octopus');
  assert.equal(swimmer.state, 'deck');
  assert.equal(game.state.buoys, 2);
  assert.equal(game.state.stats.rescues, 1);
  assert.equal(game.state.score, 80);
  eat(game, 'octopus');
  game.state.players.forEach(p => p.invulnerable = 0);
  game.hitWave({ strength: 1, side: 0 });
  assert.ok(game.state.players.every(p => p.state === 'deck'));
  assert.ok(game.state.boat.effects.octopus > 0);
});

test('rescue intent takes precedence over a snack and holding interact does not consume newly collected snacks', () => {
  const game = quietGame({ roster: [{ id: 'a' }, { id: 'b' }] });
  const [rescuer, swimmer] = game.state.players;
  rescuer.x = 2.5; rescuer.snack = 'ghost'; swimmer.x = 5;
  game.fallOverboard(swimmer);
  run(game, 1.8, { a: { interact: true } });
  assert.equal(rescuer.snack, 'ghost');
  assert.equal(game.state.boat.effects.ghost, 0);
  game.update(1 / 60, { a: { interact: true } });
  assert.equal(rescuer.snack, 'ghost');
  game.update(1 / 60);
  game.update(1 / 60, { a: { interact: true } });
  assert.equal(rescuer.snack, null);
  assert.ok(game.state.boat.effects.ghost > 0);
});

test('swimmers climb aboard from both rails, the bow, and the stern without a rescue button or cost', () => {
  const edges = [[-4.8, 0], [4.8, 0], [0, 4.5], [0, -3.6], [3.55, 3.2]];
  for (const [x, z] of edges) {
    const game = quietGame({ roster: [{ id: 'a' }, { id: 'b' }] });
    const p = game.state.players[1];
    p.x = x; p.z = z;
    game.fallOverboard(p);
    run(game, .2);
    assert.equal(p.state, 'rescue', `climb should start at ${x},${z}`);
    assert.equal(p.boarding, true);
    assert.ok(p.y >= .25 && p.y < GAME_CONSTANTS.DECK_Y);
    run(game, .5);
    assert.equal(p.state, 'deck', `climb should complete at ${x},${z}`);
    assert.equal(p.y, GAME_CONSTANTS.DECK_Y);
    assert.ok(Math.abs(p.x) <= GAME_CONSTANTS.DECK_X);
    assert.ok(Math.abs(p.z) <= GAME_CONSTANTS.DECK_Z);
    if (Math.abs(x) > 4) assert.equal(Math.sign(p.x), Math.sign(x));
    if (Math.abs(z) > 3.5) assert.equal(Math.sign(p.z), Math.sign(z));
    assert.equal(game.state.buoys, 2);
    assert.equal(game.state.hull, 100);
    assert.equal(game.state.score, 0);
    assert.equal(game.state.stats.rescues, 0);
    assert.equal(p.boarding, false);
  }
});

test('distant swimmers must reach the actual hull rather than an invisible rectangle or ladder point', () => {
  for (const [x, z] of [[6.5, 0], [0, -6], [5, 4.5]]) {
    const game = quietGame({ roster: [{ id: 'a' }, { id: 'b' }] });
    const p = game.state.players[1];
    p.x = x; p.z = z; game.fallOverboard(p);
    run(game, .8);
    assert.equal(p.state, 'swim', `distant swimmer ${x},${z} must not teleport aboard`);
    assert.equal(p.boarding, false);
  }
  const game = quietGame({ roster: [{ id: 'a' }, { id: 'b' }] });
  const p = game.state.players[1];
  p.x = 6.5; p.z = .8; game.fallOverboard(p);
  run(game, 1.7, { b: { x: -1 } });
  assert.equal(p.state, 'deck');
  assert.ok(p.x > 0, 'swimmer climbs onto the rail they reached');
  assert.equal(game.state.buoys, 2);
});

test('the whole crew can climb aboard near the wipe deadline without an emergency buoy interrupting them', () => {
  const game = quietGame({ roster: [{ id: 'a' }, { id: 'b' }] });
  game.state.score = 500;
  for (const p of game.state.players) { p.x = 8; p.z = 0; game.fallOverboard(p); }
  for (let i = 0; i < 80; i++) game.update(1 / 60);
  for (let i = 0; i < 90; i++) game.update(1 / 60, { a: { x: -1 }, b: { x: -1 } });
  assert.ok(game.state.players.every(p => p.state === 'rescue' && p.boarding));
  assert.equal(game.state.wipeTime, 0);
  run(game, .6);
  assert.ok(game.state.players.every(p => p.state === 'deck'));
  assert.equal(game.state.buoys, 2);
  assert.equal(game.state.score, 500);
  assert.equal(game.state.hull, 100);
});

test('authoritative islands collide at the bow and a glancing rail, while an ellipse corner miss stays clear', () => {
  for (const [x, z, hit] of [[0, 7.7, true], [8.7, 0, true], [9.8, 0, false], [8.5, 6.5, false]]) {
    const game = quietGame();
    game.spawnIsland(x, z, 0);
    const island = game.state.obstacles[0];
    game.updateObstacles();
    assert.equal(game.state.hull, hit ? 82 : 100, `island ${x},${z}`);
    assert.equal(island.active, true, 'land must not vanish on impact');
    assert.equal(game.state.impacts.length, hit ? 1 : 0);
    if (hit) {
      assert.equal(game.state.impacts[0].kind, 'island');
      assert.equal(game.state.impacts[0].damage, 18);
      assert.equal(game.state.players[0].state, 'air');
      assert.ok(Math.hypot(game.state.boat.x, game.state.boat.z) > .1, 'the shore separates the hull instead of allowing overlap');
    }
  }
});

test('island contact is latched until the ship separates and can be damaged again on a later approach', () => {
  const game = quietGame();
  game.spawnIsland(0, 7.7, 0);
  const island = game.state.obstacles[0];
  game.updateObstacles();
  game.collisionCooldown = 0;
  for (let i = 0; i < 10; i++) {
    game.state.boat.z = 0; // continuing thrust against the same shoreline
    game.updateObstacles();
  }
  assert.equal(game.state.hull, 82);
  assert.equal(game.state.impacts.length, 1);
  game.state.boat.x = -30;
  game.updateObstacles();
  assert.equal(island.touching, false);
  game.state.boat.x = 0; game.state.boat.z = 0;
  game.updateObstacles();
  assert.equal(game.state.hull, 64);
  assert.equal(game.state.impacts.length, 2);
});

test('ghost can cross an island, while thunder cannot erase solid land', () => {
  const game = quietGame();
  game.spawnIsland(0, 7.7, 0);
  const island = game.state.obstacles[0];
  eat(game, 'ghost');
  game.updateObstacles();
  assert.equal(game.state.hull, 100);
  assert.equal(game.state.boat.z, 0);
  assert.equal(island.active, true);
  assert.equal(game.state.impacts[0].blocked, true);
  assert.equal(game.state.impacts[0].kind, 'island');
  eat(game, 'thunder');
  assert.equal(island.active, true);
  assert.equal(game.state.score, 0);
});

test('islands begin ahead of the ship and new shores follow an unlimited route without blocking its reward lane', () => {
  const game = new Game({ seed: 44 });
  const initial = game.state.obstacles.filter(o => o.type === 'island');
  assert.equal(initial.length, 8);
  assert.ok(initial.every(o => o.z > 20 && Math.abs(o.x) > o.radius + 15));
  for (const x of [-5000, 2500]) {
    game.state.boat.x = x;
    game.spawnChunk(); game.spawnChunk();
    const shore = game.state.obstacles.filter(o => o.type === 'island').at(-1);
    assert.ok(Math.abs(shore.x - x) >= 31 && Math.abs(shore.x - x) <= 47);
    assert.equal(shore.radiusZ, shore.radius * .75);
  }
});


test('cruise speed rises continuously inside a pace tier, and late encounters are denser', () => {
  const game = quietGame();
  run(game, 2); const early = game.state.boat.speed;
  run(game, 12); assert.ok(game.state.boat.speed > early + .7);
  assert.equal(game.state.boat.speedTier, 0);
  game.state.time = 145; run(game, 4);
  assert.ok(game.state.boat.speed > 24);
  game.state.obstacles = []; game.spawnChunk();
  const hazards = game.state.obstacles.filter(o => ['crate','wreck','whale','reef'].includes(o.type));
  assert.ok(hazards.length >= 3);
  assert.ok(game.nextChunk - game.state.time <= 2.9 + .001);
});

test('wave hit emits one replicated splash, including protected hits without hull damage', () => {
  for (const brace of [false,true]) {
    const game = quietGame(); const p = game.state.players[0]; p.invulnerable=0;p.brace=brace;
    game.hitWave({strength:1.12,side:0});
    assert.equal(game.state.impacts.length,1);
    assert.equal(game.state.impacts[0].kind,'wave');
    assert.equal(game.state.impacts[0].blocked,brace);
    assert.equal(game.state.hull,100);
    assert.equal(p.state,brace?'deck':'air');
  }
});
