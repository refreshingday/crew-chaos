// Authoritative, renderer-independent simulation. The host alone advances this state.
import { ADDONS, ADDON_IDS } from './addons.js';
const DECK_Y = 1.8;
const DECK_X = 3.65;
const DECK_Z = 2.35;
// Keep the collision hull identical to the visible deck, including its pointed bow.
const BOAT_OUTLINE = [[-3.7,-3.15],[-4.25,-2.6],[-4.4,-1],[-4.1,1.5],[-3.15,2.8],[-1.8,3.65],[0,4.05],[1.8,3.65],[3.15,2.8],[4.1,1.5],[4.4,-1],[4.25,-2.6],[3.7,-3.15]];
const BOARDING_REACH = .75;
const COLORS = ['#ffbf47', '#65e6d1', '#ff7997', '#a899ff'];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const approach = (a, b, speed, dt) => a + (b - a) * (1 - Math.exp(-speed * dt));

function distanceToPolygon(x, z, points) {
  let inside = false;
  let nearest = { x: points[0][0], z: points[0][1], distance: Infinity };
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, az] = points[j], [bx, bz] = points[i];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
    const dx = bx - ax, dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    const px = ax + dx * t, pz = az + dz * t, distance = Math.hypot(x - px, z - pz);
    if (distance < nearest.distance) nearest = { x: px, z: pz, distance };
  }
  return { ...nearest, inside };
}

// Transform the ellipse to a unit circle, then find its nearest hull edge. This
// avoids the square corner collisions produced by a radius-only bounding box.
function islandContact(boat, island, margin = 0) {
  const rx = island.radius + margin, rz = (island.radiusZ || island.radius * .75) + margin;
  if (Math.abs(boat.x - island.x) > rx + 4.4 || Math.abs(boat.z - island.z) > rz + 4.05) return null;
  const points = BOAT_OUTLINE.map(([x, z]) => [(boat.x + x - island.x) / rx, (boat.z + z - island.z) / rz]);
  const nearest = distanceToPolygon(0, 0, points);
  if (!nearest.inside && nearest.distance >= 1) return null;
  const d = Math.max(nearest.distance, .0001);
  const direction = nearest.inside ? -1 : 1;
  let nx = nearest.x / d * direction, nz = nearest.z / d * direction;
  if (nearest.distance < .0001) {
    const cx = (boat.x - island.x) / rx, cz = (boat.z - island.z) / rz;
    const length = Math.hypot(cx, cz) || 1;
    nx = cx / length; nz = cz / length;
  }
  const depth = nearest.inside ? 1 + nearest.distance : 1 - nearest.distance;
  return { dx: nx * rx * (depth + .002), dz: nz * rz * (depth + .002),
    x: island.x + nx * rx, z: island.z + nz * rz, nx, nz };
}

function randomGenerator(seed) {
  let n = seed >>> 0;
  return () => {
    n += 0x6D2B79F5;
    let t = Math.imul(n ^ n >>> 15, 1 | n);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export class Game {
  constructor({ seed = Date.now() >>> 0, duration = 180, roster = [{ id: 'host', name: 'Captain' }], difficulty = 'normal' } = {}) {
    this.random = randomGenerator(Number(seed) || 1);
    this.nextId = 1;
    this.nextChunk = 1.5;
    this.nextWave = 7;
    this.collisionCooldown = 0;
    this.lastInteract = {};
    this.finale = false;
    this.chunkCount = 0;
    this.addonBag = [];
    const members = roster.slice(0, 4);
    if (!members.length) members.push({ id: 'host', name: 'Captain' });
    this.state = {
      phase: 'playing', time: 0, duration: clamp(Number(duration) || 180, 30, 240), seed,
      difficulty, hull: 100, score: 0, buoys: 2, storm: 0, wipeTime: 0,
      boat: { x: 0, z: 0, vx: 0, roll: 0, steer: 0, trim: 0, speed: 10,
        targetSpeed: 10, speedTier: 0, effects: { ghost: 0, magnet: 0, disco: 0, octopus: 0, thunder: 0 } },
      pace: { tier: 0, baseSpeed: 10, nextAt: clamp(Number(duration) || 180, 30, 240) / 9 },
      players: members.map((p, i) => ({
        id: String(p.id), name: String(p.name || `Sailor ${i + 1}`).slice(0, 18), color: p.color || COLORS[i],
        x: (i - (members.length - 1) / 2) * 1.35, z: i % 2 ? -.55 : .55, y: DECK_Y,
        vx: 0, vz: 0, vy: 0, state: 'deck', brace: false, snack: null,
        shield: 0, boost: 0, anchor: 0, invulnerable: 1, swimTime: 0,
        swimElapsed: 0, rescueProgress: 0, rescueTarget: null, rescuer: null,
        automaticRescue: false, boarding: false, boardX: 0, boardZ: 0, ping: 0,
        effects: Object.fromEntries(ADDON_IDS.map(id => [id, 0])), jellyBounced: false,
      })),
      obstacles: [], waves: [], events: [], impacts: [],
      stats: { rescues: 0, crates: 0, treasure: 0, falls: 0, perfectBraces: 0, waveDodges: 0 },
    };
    this.event('All aboard! Move across the deck to steer.', 'tip');
    this.spawnSupply(0, 42, 'treasure');
    // Islands belong to the host simulation rather than looping cosmetic scenery.
    for (let i = 0; i < 8; i++) {
      const side = i % 2 ? 1 : -1;
      this.spawnIsland(side * (31 + (i % 3) * 9), 36 + i * 32, i % 4);
    }
  }

  event(text, kind = 'info') {
    this.state.events.push({ id: this.nextId++, text, kind, at: this.state.time });
    this.state.events = this.state.events.slice(-8);
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  removePlayer(id) {
    const target = this.state.players.find(p => p.id === id);
    if (!target) return;
    this.state.players = this.state.players.filter(p => p.id !== id);
    for (const p of this.state.players) {
      if (p.rescuer === id) p.rescuer = null;
      if (p.rescueTarget === id) p.rescueTarget = null;
    }
    delete this.lastInteract[id];
    this.event(`${target.name} left the crew.`, 'info');
  }

  spawnSupply(x, z, type = 'supply') {
    this.state.obstacles.push({ id: this.nextId++, type, x, z, radius: 1, active: true });
  }

  spawnIsland(x, z, variant = Math.floor(this.random() * 4)) {
    const radius = 2 * (2.6 + variant * .7);
    this.state.obstacles.push({ id: this.nextId++, type: 'island', x, z,
      radius, radiusZ: radius * .75, active: true, variant, touching: false });
  }

  nextAddon() {
    if (!this.addonBag.length) {
      this.addonBag = [...ADDON_IDS];
      for (let i = this.addonBag.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.addonBag[i], this.addonBag[j]] = [this.addonBag[j], this.addonBag[i]];
      }
    }
    return this.addonBag.pop();
  }

  impact(kind, x, z, damage = 0, blocked = false) {
    this.state.impacts.push({ id: this.nextId++, x, z, at: this.state.time, damage, kind, blocked });
    this.state.impacts = this.state.impacts.slice(-16);
  }

  spawnChunk() {
    const s = this.state;
    const progress = s.time / s.duration;
    const gentle = s.difficulty === 'relaxed';
    this.chunkCount++;
    // Encounters follow the current course across the unlimited ocean. A short
    // velocity prediction makes continued sideways sailing encounter new hazards.
    const routeX = s.boat.x + clamp(s.boat.vx, -7.8, 7.8) * 4;
    const safeLane = routeX + [-12, -6, 0, 6, 12][Math.floor(this.random() * 5)];
    const z = s.boat.z + s.boat.speed * (6.6 + this.random() * .8);
    const first = s.time < 15;
    const recovery = s.time > s.duration * .5 && s.time < s.duration * .59;
    const hazardCount = first || recovery ? 1 : gentle ? 2 : progress > .6 ? 3 : 2;
    const candidates = [-15, -7.5, 0, 7.5, 15].map(x => x + routeX).filter(x => Math.abs(x - safeLane) > 6.5);
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    for (let i = 0; i < Math.min(hazardCount, candidates.length); i++) {
      const roll = this.random();
      let type = first ? 'crate' : roll < .43 ? 'crate' : roll < .7 ? 'wreck' : roll < .9 ? 'whale' : 'reef';
      if (recovery) type = 'crate';
      const radius = { crate: 1.1, wreck: 2.5, whale: 2.8, reef: 1.65 }[type];
      s.obstacles.push({
        id: this.nextId++, type, x: candidates[i], z: z + i * 4,
        radius, active: true, variant: Math.floor(this.random() * 3),
      });
    }
    const supply = recovery || s.hull < 50 ? 'supply' : 'treasure';
    this.spawnSupply(safeLane, z + 3, supply);
    // Separate food from repairs/treasure so useful recovery never removes all
    // add-on opportunities. The shuffled bag visits all twelve before repeating.
    if (this.chunkCount % 2 === 1 || recovery) {
      this.spawnSupply(safeLane, z - 8, 'snack');
      s.obstacles.at(-1).snack = this.nextAddon();
    }
    if (this.chunkCount % 2 === 0) {
      const side = this.chunkCount % 4 ? 1 : -1;
      this.spawnIsland(routeX + side * (31 + this.random() * 16), z + 18);
    }
    this.nextChunk = s.time + (recovery ? 7 : gentle ? 7 : progress > .7 ? 4.8 : 6.2);
  }

  spawnWave() {
    const s = this.state;
    const warning = s.difficulty === 'relaxed' ? 4.6 : 3.8 + this.random() * .5;
    const speed = 7 + this.random() * 3;
    s.waves.push({ id: this.nextId++, x: s.boat.x + clamp(s.boat.vx, -7.8, 7.8) * 2 + (this.random() - .5) * 10,
      z: s.boat.z + (s.boat.speed + speed) * warning, width: 10 + this.random() * 8,
      speed, hit: false, passed: false, dodged: false, kind: 'breaker', side: 0,
      strength: s.difficulty === 'relaxed' ? .8 : 1, at: s.time,
    });
    this.event('BIG WAVE APPROACHING — steer around it or hold BRACE!', 'wave');
    const recovery = s.time > s.duration * .5 && s.time < s.duration * .59;
    this.nextWave = s.time + (recovery ? 17 : s.time > s.duration * .72 ? 10 : 14) + this.random() * 4;
  }

  update(dt, inputs = {}) {
    if (this.state.phase !== 'playing') return;
    const total = clamp(Number(dt) || 0, 0, .25);
    let remaining = total;
    while (remaining > 0) {
      const step = Math.min(remaining, 1 / 60);
      this.step(step, inputs);
      remaining -= step;
      if (this.state.phase !== 'playing') break;
    }
  }

  step(dt, inputs) {
    const s = this.state;
    s.time += dt;
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);
    s.storm = clamp(s.time / s.duration, 0, 1);
    for (const key of Object.keys(s.boat.effects)) s.boat.effects[key] = Math.max(0, s.boat.effects[key] - dt);
    const tier = Math.min(8, Math.floor(s.time / (s.duration / 9)));
    if (tier > s.boat.speedTier) this.event(`TIDE RISING! Speed level ${tier + 1} — move aft to slow down.`, 'pace');
    s.boat.speedTier = tier;
    s.pace = { tier, baseSpeed: 10 + tier * 1.25, nextAt: tier < 8 ? (tier + 1) * s.duration / 9 : null };
    if (s.time >= this.nextChunk && s.time < s.duration - 7) this.spawnChunk();
    if (s.time >= this.nextWave && s.time < s.duration - 4) this.spawnWave();
    if (!this.finale && s.time > s.duration - 30) {
      this.finale = true;
      this.event('LIGHTHOUSE IN SIGHT! Bring the crew home!', 'finale');
    }

    for (const p of s.players) {
      const source = inputs[p.id] || {};
      const input = {
        x: clamp(Number(source.x) || 0, -1, 1), z: clamp(Number(source.z) || 0, -1, 1),
        brace: !!source.brace, interact: !!source.interact, ping: !!source.ping,
      };
      this.movePlayer(p, input, dt);
    }
    this.updateRescues(inputs, dt);

    const steer = s.players.reduce((sum, p) => sum + (p.state === 'deck' ? p.x / DECK_X * (p.effects.giant > 0 ? 1.7 : 1) : 0), 0) / Math.max(1, s.players.length);
    s.boat.trim = s.players.reduce((sum, p) => sum + (p.state === 'deck' ? p.z / DECK_Z : 0), 0) / Math.max(1, s.players.length);
    s.boat.targetSpeed = clamp(s.pace.baseSpeed + s.boat.trim * 3.5, 6.5, 22);
    s.boat.speed = approach(s.boat.speed, s.boat.targetSpeed, 1.25, dt);
    s.boat.steer = approach(s.boat.steer, Math.abs(steer) < .065 ? 0 : steer, 7, dt);
    s.boat.vx = approach(s.boat.vx, s.boat.steer * 7.8, 3, dt);
    s.boat.x += s.boat.vx * dt;
    s.boat.roll = approach(s.boat.roll, -s.boat.steer * .115, 5, dt);
    s.boat.z += s.boat.speed * dt;

    for (const wave of s.waves) {
      wave.z -= (Number(wave.speed) || 0) * dt;
      if (!wave.passed && !wave.hit && wave.z <= s.boat.z + 1.1) {
        wave.passed = true;
        const x = Number.isFinite(wave.x) ? wave.x : s.boat.x;
        const width = Number.isFinite(wave.width) ? wave.width : 14;
        if (Math.abs(s.boat.x - x) <= width / 2 + 2.8) {
          wave.hit = true;
          this.hitWave(wave);
        } else {
          wave.dodged = true;
          s.stats.waveDodges++;
          s.score += 25;
          this.event('Clean wave dodge! +25', 'good');
        }
      }
    }
    this.updateObstacles();
    s.obstacles = s.obstacles.filter(o => o.z > s.boat.z - 32 && Math.abs(o.x - s.boat.x) < 220);
    s.waves = s.waves.filter(w => w.z > s.boat.z - 35);

    // Reaching the hull is already a successful recovery. A climb must finish
    // before considering an emergency buoy, even when the entire crew is wet.
    const active = s.players.some(p => p.state === 'deck' || p.state === 'air' || p.state === 'rescue' && p.boarding);
    s.wipeTime = !active && s.players.length > 1 ? s.wipeTime + dt : 0;
    if (s.wipeTime > 3 && s.buoys > 0) {
      s.buoys--;
      for (const p of s.players.filter(p => p.state === 'swim' || p.state === 'rescue')) this.beginAutoRescue(p);
      this.event('Emergency buoy deployed! Everyone back aboard.', 'rescue');
      s.wipeTime = 0;
    } else if (s.wipeTime > 7 && s.buoys <= 0) {
      this.finish(false, 'The whole crew went overboard.');
    }
    if (s.hull <= 0) this.finish(false, 'The boat gave everything it had.');
    else if (s.time >= s.duration) this.finish(true, 'Safe harbor. Every sailor made it home!');
  }

  movePlayer(p, input, dt) {
    const s = this.state;
    for (const key of ['shield', 'boost', 'anchor', 'invulnerable', 'ping']) p[key] = Math.max(0, p[key] - dt);
    for (const key of ADDON_IDS) p.effects[key] = Math.max(0, p.effects[key] - dt);
    p.brace = input.brace && p.state === 'deck';
    if (input.ping && p.ping <= 0) p.ping = 2.5;
    const magnitude = Math.hypot(input.x, input.z);
    const dx = magnitude > 1 ? input.x / magnitude : input.x;
    const dz = magnitude > 1 ? input.z / magnitude : input.z;

    if (p.state === 'deck') {
      const speed = (p.boost > 0 ? 6.7 : p.effects.banana > 0 ? 5.6 : 4.8) * (p.brace ? .35 : 1) * (p.anchor > 0 ? .7 : 1) * (p.effects.giant > 0 ? .65 : 1);
      const acceleration = p.effects.banana > 0 ? 2.4 : 18;
      p.vx = approach(p.vx, dx * speed, acceleration, dt);
      p.vz = approach(p.vz, dz * speed, acceleration, dt);
      p.x = clamp(p.x + p.vx * dt, -DECK_X, DECK_X);
      p.z = clamp(p.z + p.vz * dt, -DECK_Z, DECK_Z);
      p.y = DECK_Y;
    } else if (p.state === 'air') {
      const correction = p.effects.jelly > 0 ? 10.8 : 4.5;
      p.vx += dx * correction * dt;
      p.vz += dz * correction * dt;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.vy -= (p.effects.balloon > 0 ? 7.65 : 17) * dt;
      p.y += p.vy * dt;
      const catchMargin = p.effects.jelly > 0 ? 1 : .3;
      if (p.vy < 0 && p.y <= DECK_Y && Math.abs(p.x) < DECK_X + catchMargin && Math.abs(p.z) < DECK_Z + catchMargin) {
        p.y = DECK_Y;
        p.x = clamp(p.x, -DECK_X, DECK_X); p.z = clamp(p.z, -DECK_Z, DECK_Z);
        if (p.effects.jelly > 0 && !p.jellyBounced) {
          p.jellyBounced = true; p.vy = 2.8; p.vx *= .05; p.vz *= .05;
        } else {
          p.state = 'deck'; p.vy = 0; p.vx *= .2; p.vz *= .2;
        }
      } else if (p.y <= .25) this.fallOverboard(p);
    } else if (p.state === 'swim') {
      p.swimElapsed += dt;
      p.swimTime = Math.max(0, p.swimTime - dt);
      p.x = clamp(p.x + dx * 2 * dt, -9, 9);
      p.z = clamp(p.z + (dz * 1.8 - .35) * dt, -10, 6.5);
      p.y = .25;
      const hull = distanceToPolygon(p.x, p.z, BOAT_OUTLINE);
      if (p.swimElapsed > .18 && (hull.inside || hull.distance <= BOARDING_REACH)) {
        p.state = 'rescue'; p.automaticRescue = true; p.boarding = true;
        p.rescueProgress = 0; p.rescuer = null;
        p.boardX = clamp(p.x, -DECK_X, DECK_X); p.boardZ = clamp(p.z, -DECK_Z, DECK_Z);
      } else if (s.players.length === 1 && p.swimElapsed > 2.1) {
        if (s.buoys > 0) s.buoys--;
        else s.hull = Math.max(0, s.hull - 10);
        this.beginAutoRescue(p);
        this.event('Your lifeline pulled you back!', 'rescue');
      } else if (p.swimTime <= 0 && s.players.some(other => other.state === 'deck')) {
        if (s.buoys > 0) s.buoys--;
        else s.hull = Math.max(0, s.hull - 8);
        this.beginAutoRescue(p);
        this.event('Emergency lifeline! Keep an eye on your crew.', 'rescue');
      }
    } else if (p.state === 'rescue' && p.automaticRescue) {
      p.rescueProgress += dt / (p.boarding ? .45 : 1.2);
      p.y = .25 + p.rescueProgress * (DECK_Y - .25);
      p.x = approach(p.x, p.boarding ? p.boardX : Math.sign(p.x || 1) * 2.6, p.boarding ? 8 : 3, dt);
      p.z = approach(p.z, p.boarding ? p.boardZ : -.7, p.boarding ? 8 : 3, dt);
      if (p.rescueProgress >= 1) {
        const climbed = p.boarding;
        this.finishRescue(p, false, climbed);
        if (climbed) this.event(`${p.name} climbed back aboard!`, 'rescue');
      }
    }

    if (input.interact && !this.lastInteract[p.id] && p.state === 'deck' && !p.brace && p.snack) {
      const nearbySwimmer = s.players.some(other => other.id !== p.id && ['swim', 'rescue'].includes(other.state) && this.canRescue(p, other));
      if (!nearbySwimmer) this.useSnack(p);
    }
    this.lastInteract[p.id] = input.interact;
  }

  hitWave(wave) {
    const s = this.state;
    let protectedCount = 0;
    let flying = 0;
    if (s.boat.effects.octopus > 0) {
      this.event('Octopus arms held the whole boat steady!', 'good');
      s.score += 20;
      return;
    }
    for (const p of s.players) {
      if (p.state !== 'deck' || p.invulnerable > 0) continue;
      if (p.brace || p.anchor > 0) {
        protectedCount++; s.stats.perfectBraces++;
        // Bracing is useful even at the rail: no random unavoidable spill.
        continue;
      }
      p.state = 'air';
      const strength = Number(wave.strength) || 1;
      p.vy = 7.8 * strength;
      p.vx = wave.side ? wave.side * 4.7 * strength : p.x * .38;
      p.vz = wave.side ? -.55 : -4.6 * strength;
      p.jellyBounced = false;
      p.brace = false;
      flying++;
    }
    if (protectedCount && !flying) {
      s.score += protectedCount * 10;
      this.event('Perfect brace! The crew held strong.', 'good');
    } else if (flying) this.event('Crew airborne! Aim for the deck!', 'danger');
  }

  fallOverboard(p) {
    if (p.shield > 0) {
      p.shield = 0;
      p.effects.bubble = 0;
      p.state = 'deck'; p.y = DECK_Y;
      p.x = clamp(p.x, -2.5, 2.5); p.z = clamp(p.z, -1.5, 1.5);
      p.vx = p.vz = p.vy = 0; p.invulnerable = 1;
      this.event(`${p.name}'s bubble bounced them aboard!`, 'good');
      return;
    }
    p.state = 'swim'; p.y = .25;
    p.x = clamp(p.x, -8, 8); p.z = clamp(p.z, -9, 6);
    p.vx = p.vz = p.vy = 0; p.brace = false;
    p.swimTime = this.state.players.length === 2 ? 12 : 10;
    p.swimElapsed = 0; p.rescueProgress = 0; p.rescuer = null;
    p.automaticRescue = false; p.boarding = false;
    this.state.stats.falls++;
    this.event(`${p.name} overboard! Swim to the hull to climb aboard, or hold RESCUE from the deck.`, 'danger');
  }

  canRescue(rescuer, swimmer) {
    const side = Math.sign(swimmer.x || 1);
    return rescuer.state === 'deck' && !rescuer.brace && rescuer.x * side > 1.45;
  }

  updateRescues(inputs, dt) {
    const s = this.state;
    for (const p of s.players) p.rescueTarget = null;
    for (const swimmer of s.players) {
      if (!['swim', 'rescue'].includes(swimmer.state) || swimmer.automaticRescue) continue;
      const rescuer = s.players.find(p => p.id !== swimmer.id && !p.rescueTarget && inputs[p.id]?.interact && this.canRescue(p, swimmer));
      if (rescuer) {
        swimmer.state = 'rescue'; swimmer.rescuer = rescuer.id;
        rescuer.rescueTarget = swimmer.id;
        swimmer.rescueProgress += dt / 1.6;
        swimmer.y = .25 + swimmer.rescueProgress * 1.1;
        swimmer.x = approach(swimmer.x, Math.sign(rescuer.x) * 4, 1, dt);
        swimmer.z = approach(swimmer.z, rescuer.z, 1, dt);
        if (swimmer.rescueProgress >= 1) this.finishRescue(swimmer, true);
      } else {
        swimmer.rescuer = null;
        swimmer.rescueProgress = Math.max(0, swimmer.rescueProgress - dt * .18);
        if (swimmer.state === 'rescue') swimmer.state = 'swim';
      }
    }
  }

  beginAutoRescue(p) {
    p.state = 'rescue'; p.automaticRescue = true; p.boarding = false; p.rescueProgress = 0; p.rescuer = null;
    this.state.score = Math.max(0, this.state.score - 75);
  }

  finishRescue(p, manual, climbed = false) {
    p.state = 'deck';
    p.x = climbed ? clamp(p.boardX, -DECK_X, DECK_X) : Math.sign(p.x || 1) * 2.55;
    p.z = climbed ? clamp(p.boardZ, -DECK_Z, DECK_Z) : -.4; p.y = DECK_Y;
    p.vx = p.vz = p.vy = 0; p.invulnerable = 2;
    p.automaticRescue = false; p.boarding = false; p.rescuer = null; p.rescueProgress = 0; p.swimTime = 0;
    if (manual) {
      this.state.stats.rescues++;
      // Falls only originate from hazards, and each swimmer can award one rescue.
      const points = this.state.stats.rescues <= 8 ? 50 : 0;
      this.state.score += points;
      this.event(`${p.name} is back aboard!${points ? ' +50 rescue' : ''}`, 'rescue');
    }
  }

  useSnack(p) {
    const snack = p.snack;
    if (!ADDONS[snack]) return;
    p.snack = null;
    const s = this.state;
    const duration = ADDONS[snack].duration;
    p.effects[snack] = duration;
    if (snack === 'bubble') p.shield = duration;
    else if (snack === 'chili') p.boost = duration;
    else if (snack === 'anchor') p.anchor = duration;
    else if (['magnet', 'ghost', 'disco'].includes(snack)) s.boat.effects[snack] = Math.max(s.boat.effects[snack], duration);
    else if (snack === 'thunder') {
      s.boat.effects.thunder = duration;
      let cleared = 0;
      for (const obstacle of s.obstacles) {
        if (obstacle.active && !['treasure', 'snack', 'supply', 'island'].includes(obstacle.type)
          && Math.hypot(obstacle.x - s.boat.x, obstacle.z - s.boat.z) < 28) {
          obstacle.active = false; cleared++;
        }
      }
      s.score += cleared * 25;
      this.impact('thunder', s.boat.x, s.boat.z, 0, false);
      this.event(`THUNDER POP! ${cleared} hazards cleared.`, 'good');
    } else if (snack === 'octopus') {
      const swimmers = s.players.filter(other => ['swim', 'rescue'].includes(other.state));
      if (swimmers.length) {
        for (const swimmer of swimmers) this.finishRescue(swimmer, true);
        s.score += swimmers.length * 30;
        this.event(`Octopus grapple! ${swimmers.length} sailors saved.`, 'rescue');
      } else s.boat.effects.octopus = duration;
    }
    if (!['thunder', 'octopus'].includes(snack)) this.event(`${p.name} ate ${ADDONS[snack].name}!`, 'good');
    else if (snack === 'octopus' && s.boat.effects.octopus > 0) this.event('Octopus arms are guarding the boat from waves!', 'good');
  }

  updateObstacles() {
    const s = this.state;
    for (const o of s.obstacles) {
      if (!o.active) continue;
      const island = o.type === 'island';
      let contact = null;
      if (island) {
        contact = islandContact(s.boat, o);
        if (!contact) {
          if (!islandContact(s.boat, o, .3)) o.touching = false;
          continue;
        }
        // The shore is solid. Preserve automatic forward thrust but allow the
        // crew to steer and slide around it; it never vanishes after a bump.
        if (s.boat.effects.ghost <= 0) {
          s.boat.x += contact.dx; s.boat.z += contact.dz;
        }
        if (o.touching) continue;
        o.touching = true;
      }
      const collectible = ['supply', 'snack', 'treasure'].includes(o.type);
      const reach = collectible && s.boat.effects.magnet > 0 ? 8 : 3.4;
      const dz = Math.abs(o.z - s.boat.z);
      if (!island && dz > reach + o.radius) continue;
      const dx = Math.abs(o.x - s.boat.x);
      if (!island && dx > reach + o.radius) continue;
      if (collectible) {
        if (o.type === 'supply') {
          s.hull = Math.min(100, s.hull + 18);
          this.event('Repair supplies! +18 hull', 'good');
        } else if (o.type === 'treasure') {
          const points = Math.round(100 * (s.boat.effects.disco > 0 ? 2 : 1) * (s.players.some(p => p.effects.banana > 0) ? 1.25 : 1));
          s.score += points; s.stats.treasure++;
          this.event(`Treasure aboard! +${points}`, 'good');
        } else {
          const p = s.players.filter(p => p.state === 'deck' && !p.snack)
            .sort((a, b) => Math.abs(a.x - (o.x - s.boat.x)) - Math.abs(b.x - (o.x - s.boat.x)))[0];
          if (!p) continue;
          p.snack = o.snack || 'bubble';
          this.event(`${p.name} grabbed a snack! Press USE to eat.`, 'good');
        }
        o.active = false;
      } else if (this.collisionCooldown <= 0) {
        if (s.boat.effects.ghost > 0) {
          if (!island) o.active = false;
          this.impact(o.type, contact?.x ?? o.x, contact?.z ?? o.z, 0, true);
          this.event('Ghost Grape! Phased through the obstacle.', 'good');
          continue;
        }
        const damage = { crate: 6, wreck: 15, whale: 12, reef: 9, island: 18 }[o.type] || 8;
        s.hull = Math.max(0, s.hull - damage);
        this.collisionCooldown = 1.3;
        if (!island) o.active = false;
        this.impact(o.type, contact?.x ?? o.x, contact?.z ?? o.z, damage, false);
        s.boat.vx += (s.boat.x >= o.x ? 1 : -1) * 2;
        for (const p of s.players) {
          if (p.state !== 'deck') continue;
          // A collision visibly jolts everyone, even a braced sailor. Keep its
          // horizontal impulse small so a single bump is usually recoverable.
          const braced = p.brace || p.anchor > 0;
          p.state = 'air'; p.vy = braced ? 2.7 : 4.8;
          p.vx = braced ? 0 : (s.boat.x >= o.x ? 1 : -1) * .8;
          p.vz = braced ? 0 : -.7;
          p.jellyBounced = false; p.brace = false;
        }
        if (o.type === 'crate') s.stats.crates++;
        this.event(o.type === 'whale' ? `Whale bump! −${damage} hull` : `Watch the ${o.type}! −${damage} hull`, 'damage');
      }
    }
  }

  finish(won, message) {
    const s = this.state;
    if (s.phase !== 'playing') return;
    s.phase = won ? 'won' : 'lost';
    s.time = Math.min(s.time, s.duration);
    s.message = message;
    if (won) {
      s.score += 1000 + Math.round(s.hull * 5);
      for (const p of s.players) {
        p.state = 'deck'; p.x = clamp(p.x, -2.5, 2.5); p.z = clamp(p.z, -1.5, 1.5); p.y = DECK_Y;
      }
    }
    this.event(message, won ? 'win' : 'lose');
  }
}

export const GAME_CONSTANTS = { DECK_Y, DECK_X, DECK_Z, BOAT_OUTLINE, BOARDING_REACH, COLORS };
