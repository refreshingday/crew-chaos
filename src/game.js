// Authoritative, renderer-independent simulation. The host alone advances this state.
const DECK_Y = 1.8;
const DECK_X = 3.65;
const DECK_Z = 2.35;
const COLORS = ['#ffbf47', '#65e6d1', '#ff7997', '#a899ff'];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const approach = (a, b, speed, dt) => a + (b - a) * (1 - Math.exp(-speed * dt));

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
    const members = roster.slice(0, 4);
    if (!members.length) members.push({ id: 'host', name: 'Captain' });
    this.state = {
      phase: 'playing', time: 0, duration: clamp(Number(duration) || 180, 30, 240), seed,
      difficulty, hull: 100, score: 0, buoys: 2, storm: 0, wipeTime: 0,
      boat: { x: 0, z: 0, vx: 0, roll: 0, steer: 0, speed: 10.5 },
      players: members.map((p, i) => ({
        id: String(p.id), name: String(p.name || `Sailor ${i + 1}`).slice(0, 18), color: p.color || COLORS[i],
        x: (i - (members.length - 1) / 2) * 1.35, z: i % 2 ? -.55 : .55, y: DECK_Y,
        vx: 0, vz: 0, vy: 0, state: 'deck', brace: false, snack: null,
        shield: 0, boost: 0, anchor: 0, invulnerable: 1, swimTime: 0,
        swimElapsed: 0, rescueProgress: 0, rescueTarget: null, rescuer: null,
        automaticRescue: false, ping: 0,
      })),
      obstacles: [], waves: [], events: [],
      stats: { rescues: 0, crates: 0, treasure: 0, falls: 0, perfectBraces: 0 },
    };
    this.event('All aboard! Move across the deck to steer.', 'tip');
    this.spawnSupply(0, 42, 'treasure');
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

  spawnChunk() {
    const s = this.state;
    const progress = s.time / s.duration;
    const gentle = s.difficulty === 'relaxed';
    const safeLane = [-12, -6, 0, 6, 12][Math.floor(this.random() * 5)];
    const z = s.boat.z + 95 + this.random() * 20;
    const first = s.time < 15;
    const recovery = s.time > s.duration * .5 && s.time < s.duration * .59;
    const hazardCount = first || recovery ? 1 : gentle ? 2 : progress > .6 ? 3 : 2;
    const candidates = [-15, -7.5, 0, 7.5, 15].filter(x => Math.abs(x - safeLane) > 6.5);
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
    const supply = recovery || s.hull < 50 ? 'supply' : this.random() < .4 ? 'snack' : 'treasure';
    this.spawnSupply(safeLane, z + 3, supply);
    if (supply === 'snack') s.obstacles.at(-1).snack = ['bubble', 'chili', 'anchor'][Math.floor(this.random() * 3)];
    this.nextChunk = s.time + (recovery ? 8.5 : gentle ? 8 : progress > .7 ? 5.6 : 6.8);
  }

  spawnWave() {
    const s = this.state;
    const side = s.time < 15 ? 0 : [-1, 0, 1][Math.floor(this.random() * 3)];
    const warning = s.difficulty === 'relaxed' ? 3.8 : 3;
    s.waves.push({ id: this.nextId++, z: s.boat.z + s.boat.speed * warning, side,
      hit: false, kind: side === 0 ? 'breaker' : 'side', strength: s.difficulty === 'relaxed' ? .8 : 1,
    });
    this.event(side === 0 ? 'WAVE AHEAD — hold BRACE!' : `WAVE FROM ${side < 0 ? 'RIGHT' : 'LEFT'} — hold BRACE!`, 'wave');
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

    const steer = s.players.reduce((sum, p) => sum + (p.state === 'deck' ? p.x / DECK_X : 0), 0) / Math.max(1, s.players.length);
    s.boat.steer = approach(s.boat.steer, Math.abs(steer) < .065 ? 0 : steer, 7, dt);
    s.boat.vx = approach(s.boat.vx, s.boat.steer * 7.8, 3, dt);
    s.boat.x = clamp(s.boat.x + s.boat.vx * dt, -18, 18);
    if (Math.abs(s.boat.x) >= 18) s.boat.vx *= .85;
    s.boat.roll = approach(s.boat.roll, -s.boat.steer * .115, 5, dt);
    s.boat.z += s.boat.speed * dt;

    for (const wave of s.waves) {
      if (!wave.hit && wave.z <= s.boat.z + 1.1) {
        wave.hit = true;
        this.hitWave(wave);
      }
    }
    this.updateObstacles();
    s.obstacles = s.obstacles.filter(o => o.z > s.boat.z - 32);
    s.waves = s.waves.filter(w => w.z > s.boat.z - 35);

    const active = s.players.some(p => p.state === 'deck' || p.state === 'air');
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
    p.brace = input.brace && p.state === 'deck';
    if (input.ping && p.ping <= 0) p.ping = 2.5;
    const magnitude = Math.hypot(input.x, input.z);
    const dx = magnitude > 1 ? input.x / magnitude : input.x;
    const dz = magnitude > 1 ? input.z / magnitude : input.z;

    if (p.state === 'deck') {
      const speed = (p.boost > 0 ? 6.7 : 4.8) * (p.brace ? .35 : 1) * (p.anchor > 0 ? .7 : 1);
      p.vx = approach(p.vx, dx * speed, 18, dt);
      p.vz = approach(p.vz, dz * speed, 18, dt);
      p.x = clamp(p.x + p.vx * dt, -DECK_X, DECK_X);
      p.z = clamp(p.z + p.vz * dt, -DECK_Z, DECK_Z);
      p.y = DECK_Y;
    } else if (p.state === 'air') {
      p.vx += dx * 4.5 * dt;
      p.vz += dz * 4.5 * dt;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.vy -= 17 * dt;
      p.y += p.vy * dt;
      if (p.vy < 0 && p.y <= DECK_Y && Math.abs(p.x) < DECK_X + .3 && Math.abs(p.z) < DECK_Z + .3) {
        p.state = 'deck'; p.y = DECK_Y; p.vy = 0;
        p.x = clamp(p.x, -DECK_X, DECK_X); p.z = clamp(p.z, -DECK_Z, DECK_Z);
        p.vx *= .2; p.vz *= .2;
      } else if (p.y <= .25) this.fallOverboard(p);
    } else if (p.state === 'swim') {
      p.swimElapsed += dt;
      p.swimTime = Math.max(0, p.swimTime - dt);
      p.x = clamp(p.x + dx * 2 * dt, -7, 7);
      p.z = clamp(p.z + (dz * 1.8 - .35) * dt, -8.5, 3.5);
      p.y = .25;
      if (s.players.length === 1 && p.swimElapsed > 2.1) {
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
      p.rescueProgress += dt / 1.2;
      p.y = .25 + p.rescueProgress * DECK_Y;
      p.x = approach(p.x, Math.sign(p.x || 1) * 2.6, 3, dt);
      p.z = approach(p.z, -.7, 3, dt);
      if (p.rescueProgress >= 1) this.finishRescue(p, false);
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
    for (const p of s.players) {
      if (p.state !== 'deck' || p.invulnerable > 0) continue;
      if (p.brace || p.anchor > 0) {
        protectedCount++; s.stats.perfectBraces++;
        // Bracing is useful even at the rail: no random unavoidable spill.
        continue;
      }
      p.state = 'air';
      p.vy = 7.8 * wave.strength;
      p.vx = wave.side ? wave.side * 4.7 * wave.strength : p.x * .38;
      p.vz = wave.side ? -.55 : -4.6 * wave.strength;
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
      p.state = 'deck'; p.y = DECK_Y;
      p.x = clamp(p.x, -2.5, 2.5); p.z = clamp(p.z, -1.5, 1.5);
      p.vx = p.vz = p.vy = 0; p.invulnerable = 1;
      this.event(`${p.name}'s bubble bounced them aboard!`, 'good');
      return;
    }
    p.state = 'swim'; p.y = .25;
    p.x = clamp(p.x, -6.5, 6.5); p.z = clamp(p.z, -7, 2.5);
    p.vx = p.vz = p.vy = 0; p.brace = false;
    p.swimTime = this.state.players.length === 2 ? 12 : 10;
    p.swimElapsed = 0; p.rescueProgress = 0; p.rescuer = null;
    this.state.stats.falls++;
    this.event(`${p.name} overboard! Go to their side and hold RESCUE.`, 'danger');
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
    p.state = 'rescue'; p.automaticRescue = true; p.rescueProgress = 0; p.rescuer = null;
    this.state.score = Math.max(0, this.state.score - 75);
  }

  finishRescue(p, manual) {
    p.state = 'deck'; p.x = Math.sign(p.x || 1) * 2.55; p.z = -.4; p.y = DECK_Y;
    p.vx = p.vz = p.vy = 0; p.invulnerable = 2;
    p.automaticRescue = false; p.rescuer = null; p.rescueProgress = 0; p.swimTime = 0;
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
    p.snack = null;
    if (snack === 'bubble') { p.shield = 30; this.event(`${p.name} ate Bubble Fruit. Next fall is covered!`, 'good'); }
    else if (snack === 'chili') { p.boost = 8; this.event(`${p.name} ate Chili Noodles. Speedy feet!`, 'good'); }
    else { p.anchor = 8; this.event(`${p.name} ate Anchor Biscuit. Wave-proof for 8s!`, 'good'); }
  }

  updateObstacles() {
    const s = this.state;
    for (const o of s.obstacles) {
      if (!o.active) continue;
      const dz = Math.abs(o.z - s.boat.z);
      if (dz > 3.4 + o.radius) continue;
      const dx = Math.abs(o.x - s.boat.x);
      if (dx > 3.4 + o.radius) continue;
      if (['supply', 'snack', 'treasure'].includes(o.type)) {
        if (o.type === 'supply') {
          s.hull = Math.min(100, s.hull + 18);
          this.event('Repair supplies! +18 hull', 'good');
        } else if (o.type === 'treasure') {
          s.score += 100; s.stats.treasure++;
          this.event('Treasure aboard! +100', 'good');
        } else {
          const p = s.players.filter(p => p.state === 'deck' && !p.snack)
            .sort((a, b) => Math.abs(a.x - (o.x - s.boat.x)) - Math.abs(b.x - (o.x - s.boat.x)))[0];
          if (!p) continue;
          p.snack = o.snack || 'bubble';
          this.event(`${p.name} grabbed a snack! Press USE to eat.`, 'good');
        }
        o.active = false;
      } else if (this.collisionCooldown <= 0) {
        const damage = { crate: 6, wreck: 15, whale: 12, reef: 9 }[o.type] || 8;
        s.hull = Math.max(0, s.hull - damage);
        this.collisionCooldown = 1.3;
        o.active = false;
        s.boat.vx += (s.boat.x >= o.x ? 1 : -1) * 2;
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

export const GAME_CONSTANTS = { DECK_Y, DECK_X, DECK_Z, COLORS };
