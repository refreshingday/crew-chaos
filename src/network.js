// Room reservation and host-star topology adapted from refreshingday/multiplayerTest:
// room-v23.js, network-v23.js, and puff-river/room.js (inspected 27 Oct 2026).
// PeerJS Cloud provides signaling only. No dedicated gameplay server is used.
// Islands are authoritative terrain in v3. Isolate cached older clients whose
// renderers lack terrain and whose validators reject island collision impacts.
const PREFIX = 'crew-chaos-web-v3-';
export const NETWORK_PROTOCOL = 3;
const PROTOCOL = NETWORK_PROTOCOL;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLORS = ['#ffb34d', '#56ded0', '#bd9cff', '#ff82aa'];
const MAX_PACKET = 60_000;
const encoder = new TextEncoder();
const emptyInput = () => ({ x: 0, z: 0, brace: false, interact: false, ping: false });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const finiteFields = (value, keys) => record(value) && keys.every(key => Number.isFinite(value[key]));
const entityId = value => Number.isSafeInteger(value) && value >= 0;
const text = (value, length = 64) => typeof value === 'string' && value.length <= length;
const effectKeys = new Set(['bubble', 'chili', 'anchor', 'jelly', 'magnet', 'ghost', 'balloon', 'disco', 'banana', 'thunder', 'giant', 'octopus']);

function validEffects(value) {
  return record(value) && Object.entries(value).every(([key, timer]) => effectKeys.has(key) && Number.isFinite(timer) && timer >= 0);
}

/** Keep malformed host data out of the renderer while allowing an open ocean and changing speeds. */
export function validSnapshot(state) {
  try {
    if (!record(state) || !['playing', 'won', 'lost', 'paused'].includes(state.phase)) return false;
    if (!finiteFields(state, ['time', 'duration', 'hull', 'score', 'buoys', 'storm'])) return false;
    if (state.time < 0 || state.duration <= 0 || state.hull < 0 || state.hull > 100 || state.score < 0 || state.buoys < 0) return false;
    if (!finiteFields(state.boat, ['x', 'z', 'vx', 'roll', 'steer', 'speed']) || state.boat.speed < 0) return false;
    if (state.boat.effects !== undefined && !validEffects(state.boat.effects)) return false;
    if (state.pace !== undefined && (!finiteFields(state.pace, ['tier', 'baseSpeed']) ||
      !(state.pace.nextAt === null || Number.isFinite(state.pace.nextAt) && state.pace.nextAt >= 0))) return false;
    if (!Array.isArray(state.players) || state.players.length < 1 || state.players.length > 4) return false;
    const ids = new Set();
    for (const p of state.players) {
      if (!finiteFields(p, ['x', 'y', 'z', 'vx', 'vy', 'vz', 'swimTime', 'rescueProgress'])) return false;
      if (!text(p.id, 30) || !p.id || ids.has(p.id) || !text(p.name, 18) || !/^#[a-f0-9]{6}$/i.test(p.color)) return false;
      if (!['deck', 'air', 'swim', 'rescue'].includes(p.state) || typeof p.brace !== 'boolean') return false;
      if (p.snack !== null && !text(p.snack, 32)) return false;
      if (p.effects !== undefined && !validEffects(p.effects)) return false;
      if (p.rescuer !== undefined && p.rescuer !== null && !text(p.rescuer, 30)) return false;
      ids.add(p.id);
    }
    if (!Array.isArray(state.obstacles) || state.obstacles.length > 64 || !state.obstacles.every(o =>
      finiteFields(o, ['x', 'z', 'radius']) && entityId(o.id) && text(o.type, 32) && o.radius > 0 && typeof o.active === 'boolean' &&
      (o.radiusZ === undefined || Number.isFinite(o.radiusZ) && o.radiusZ > 0) &&
      (o.type !== 'island' || Number.isFinite(o.radiusZ) && o.radiusZ > 0))) return false;
    if (!Array.isArray(state.waves) || state.waves.length > 32 || !state.waves.every(w =>
      finiteFields(w, ['z', 'side', 'strength']) && entityId(w.id) && typeof w.hit === 'boolean' && text(w.kind, 32))) return false;
    if (!Array.isArray(state.events) || state.events.length > 16 || !state.events.every(e =>
      record(e) && entityId(e.id) && text(e.text, 512) && text(e.kind, 32) && Number.isFinite(e.at))) return false;
    if (!finiteFields(state.stats, ['rescues', 'crates', 'treasure', 'falls', 'perfectBraces'])) return false;
    if (state.impacts !== undefined && (!Array.isArray(state.impacts) || state.impacts.length > 16 || !state.impacts.every(i =>
      finiteFields(i, ['x', 'z', 'at', 'damage']) && entityId(i.id) &&
      ['crate', 'wreck', 'whale', 'reef', 'island', 'thunder'].includes(i.kind) && typeof i.blocked === 'boolean'))) return false;

    // Optional fields and future cosmetic fields must still be finite, shallow JSON data.
    // This also rejects cyclic objects, undefined, typed arrays, and oversized nested payloads.
    let nodes = 0;
    const validValue = (value, depth = 0) => {
      if (++nodes > 12_000 || depth > 8) return false;
      if (value === null || typeof value === 'boolean') return true;
      if (typeof value === 'number') return Number.isFinite(value);
      if (typeof value === 'string') return value.length <= 2048;
      if (Array.isArray(value)) return value.length <= 512 && value.every(item => validValue(item, depth + 1));
      return record(value) && Object.keys(value).length <= 64 && Object.values(value).every(item => validValue(item, depth + 1));
    };
    return validValue(state) && encoder.encode(JSON.stringify(state)).byteLength < MAX_PACKET;
  } catch { return false; }
}

export function normalizeRoomCode(code) {
  const value = String(code ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(value)) throw new Error('Enter the host’s four-character room code.');
  return value;
}

export function sanitizeInput(input = {}) {
  const axis = value => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  return { x: axis(input?.x), z: axis(input?.z), brace: input?.brace === true,
    interact: input?.interact === true, ping: input?.ping === true };
}

const cleanName = name => String(name || 'Sailor').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 18) || 'Sailor';
const code = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), n => ALPHABET[n % ALPHABET.length]).join('');
const packet = (type, fields = {}) => ({ v: PROTOCOL, type, ...fields });
const validPacket = value => value && typeof value === 'object' && !Array.isArray(value) && value.v === PROTOCOL && typeof value.type === 'string';

function explain(error) {
  switch (error?.type) {
    case 'peer-unavailable': return 'Room not found. Check the code and ask the host to keep their game open.';
    case 'browser-incompatible': return 'This browser cannot connect to other players. Try current Chrome, Edge, Firefox, or Safari.';
    case 'network': case 'server-error': case 'socket-error': return 'Room service could not be reached. Check your internet connection and try again.';
    case 'webrtc': return 'The browsers could not connect. Try the same Wi-Fi network and keep both games open.';
    default: return error?.message || 'Connection failed. Check the room code and try again.';
  }
}

/** One host simulates the world; up to three guests send only movement/actions. */
export class CrewNetwork extends EventTarget {
  constructor({ PeerClass, iceServers } = {}) {
    super();
    this.PeerClass = PeerClass;
    // Explicit STUN-only configuration prevents an implicit dependency on demo TURN credentials.
    // A deployment can inject its own TURN servers through the constructor when needed.
    this.iceServers = iceServers || [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    this.isHost = false;
    this.localId = 'host';
    this.roomCode = '';
    this.roster = [];
    this.session = null;
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  _active(s) { return this.session === s && !s.closed; }

  _timer(s, callback, delay) {
    const timer = setTimeout(() => { s.timers.delete(timer); if (this._active(s)) callback(); }, delay);
    s.timers.add(timer);
    return timer;
  }

  _clear(s, timer) { clearTimeout(timer); s.timers.delete(timer); }

  async _begin(host, name) {
    this.leave();
    if (globalThis.isSecureContext === false) throw new Error('Open the HTTPS game address to use online rooms.');
    this.isHost = host;
    this.localId = host ? 'host' : '';
    const s = { closed: false, peer: null, links: new Map(), timers: new Set(), cancels: new Set(),
      playing: false, name: cleanName(name), nextId: 1, reconnectTimer: null };
    this.session = s;
    this.roster = host ? [{ id: 'host', name: s.name, color: COLORS[0], connected: true }] : [];
    this._emit('status', host ? 'Reserving a room…' : 'Finding your crew…');
    const PeerClass = this.PeerClass || (await import('peerjs')).Peer;
    if (!this._active(s)) throw new Error('Room setup cancelled.');
    return { s, PeerClass };
  }

  _openPeer(s, PeerClass, id) {
    return new Promise((resolve, reject) => {
      if (!this._active(s)) { reject(new Error('Room setup cancelled.')); return; }
      const options = { secure: true, debug: 0, config: { iceServers: this.iceServers } };
      const peer = id ? new PeerClass(id, options) : new PeerClass(options);
      s.peer = peer;
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true; this._clear(s, timer); s.cancels.delete(cancel);
        error ? reject(error) : resolve(peer);
      };
      const cancel = () => finish(new Error('Room setup cancelled.'));
      s.cancels.add(cancel);
      const timer = this._timer(s, () => finish(new Error('Room service timed out. Check internet access and try again.')), 16_000);
      peer.on('open', () => {
        if (!this._active(s) || s.peer !== peer) return;
        finish();
      });
      peer.on('error', error => {
        if (!this._active(s) || s.peer !== peer) return;
        if (!settled) { finish(error); return; }
        if (!this.isHost && error.type === 'peer-unavailable') { s.joinFinish?.(new Error(explain(error))); return; }
        // A signaling interruption does not stop an already-open gameplay link.
        this._emit('status', explain(error));
      });
      peer.on('disconnected', () => {
        if (!this._active(s) || s.peer !== peer) return;
        this._emit('status', 'Room service interrupted. Existing game connections can continue.');
        if (s.reconnectTimer) return;
        s.reconnectTimer = this._timer(s, () => {
          s.reconnectTimer = null;
          try { if (!peer.destroyed && peer.disconnected) peer.reconnect(); } catch { /* already reconnecting */ }
        }, 1500);
      });
      peer.on('close', () => {
        if (!this._active(s) || s.peer !== peer) return;
        if (!settled) finish(new Error('Room service closed. Please try again.'));
        else this._shutdown(s, 'The room connection closed. Create or join a new room.');
      });
      peer.on('connection', connection => {
        if (!this._active(s) || s.peer !== peer || !this.isHost) { connection.close(); return; }
        this._incoming(s, connection);
      });
    });
  }

  async host(name = 'Captain') {
    const { s, PeerClass } = await this._begin(true, name);
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        const room = code();
        try {
          await this._openPeer(s, PeerClass, PREFIX + room);
          if (!this._active(s)) throw new Error('Room setup cancelled.');
          this.roomCode = room;
          this._publishRoster(s);
          this._heartbeat(s);
          this._emit('status', 'Room ready. Share the four-character code.');
          return room;
        } catch (error) {
          const peer = s.peer; s.peer = null; peer?.destroy();
          if (!this._active(s) || error.type !== 'unavailable-id') throw error;
        }
      }
      throw new Error('Could not reserve a room. Please try again.');
    } catch (error) {
      if (this._active(s)) { this.leave(); this._emit('error', explain(error)); }
      throw new Error(explain(error));
    }
  }

  async join(room, name = 'Sailor') {
    const normalized = normalizeRoomCode(room);
    const { s, PeerClass } = await this._begin(false, name);
    this.roomCode = normalized;
    try {
      await this._openPeer(s, PeerClass);
      if (!this._active(s)) throw new Error('Room setup cancelled.');
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = error => {
          if (settled) return;
          settled = true; this._clear(s, timer); s.cancels.delete(cancel); s.joinFinish = null;
          error ? reject(error) : resolve();
        };
        s.joinFinish = finish;
        const cancel = () => finish(new Error('Room setup cancelled.'));
        s.cancels.add(cancel);
        const timer = this._timer(s, () => finish(new Error('Could not reach the host. Try the same Wi-Fi and check that the room is still open.')), 25_000);
        const connection = s.peer.connect(PREFIX + normalized, {
          reliable: true, serialization: 'json', label: PREFIX,
          metadata: { game: PREFIX, v: PROTOCOL },
        });
        const link = { connection, id: 'host', welcomed: false, lastRx: Date.now(), lastInput: 0 };
        s.links.set('host', link);
        connection.on('open', () => {
          if (!this._active(s)) return;
          this._send(link, packet('hello', { name: s.name }));
          this._emit('status', 'Host found. Boarding the boat…');
        });
        connection.on('data', data => this._receiveGuest(s, link, data));
        connection.on('error', error => {
          if (!this._active(s)) return;
          if (!settled) finish(new Error(explain(error)));
          else this._shutdown(s, 'Connection to the host was lost. Join a new room to play again.');
        });
        connection.on('close', () => {
          if (!this._active(s)) return;
          if (!settled) finish(new Error('The host closed the room before you could join.'));
          else this._shutdown(s, 'The host left the room. Create or join a new room.');
        });
      });
      this._heartbeat(s);
      return this.roomCode;
    } catch (error) {
      if (this._active(s)) { this.leave(); this._emit('error', explain(error)); }
      throw new Error(explain(error));
    }
  }

  _reject(s, connection, reason) {
    const send = () => {
      try { connection.send(packet('reject', { reason })); } catch { /* remote already gone */ }
      this._timer(s, () => connection.close(), 250);
    };
    if (connection.open) send(); else connection.on('open', send);
  }

  _incoming(s, connection) {
    if (connection.metadata?.game !== PREFIX || connection.metadata?.v !== PROTOCOL) {
      this._reject(s, connection, 'Different game version. Reload both browsers and create a new room.'); return;
    }
    if (s.playing) { this._reject(s, connection, 'This voyage has already started. Ask the host to create a new room.'); return; }
    if (s.links.size >= 3) { this._reject(s, connection, 'Room full. Four sailors are already connected.'); return; }
    const slot = [1, 2, 3].find(n => ![...s.links.values()].some(l => l.slot === n));
    const id = 'crew-' + s.nextId++;
    const link = { connection, id, slot, welcomed: false, lastRx: Date.now(), lastInput: 0 };
    s.links.set(id, link);
    link.timer = this._timer(s, () => this._drop(s, link), 20_000);
    connection.on('data', data => this._receiveHost(s, link, data));
    connection.on('close', () => this._drop(s, link));
    connection.on('error', () => this._drop(s, link));
  }

  _receiveHost(s, link, data) {
    if (!this._active(s) || s.links.get(link.id) !== link || !validPacket(data)) return;
    link.lastRx = Date.now();
    if (data.type === 'hello' && !link.welcomed) {
      if (s.playing) { this._reject(s, link.connection, 'The voyage has already started. Ask for a new room.'); this._drop(s, link, false); return; }
      this._clear(s, link.timer);
      link.welcomed = true;
      this.roster.push({ id: link.id, name: cleanName(data.name), color: COLORS[link.slot], connected: true });
      this._send(link, packet('welcome', { id: link.id, roomCode: this.roomCode, roster: this.roster }));
      this._publishRoster(s);
      return;
    }
    if (!link.welcomed) return;
    if (data.type === 'input') {
      // Identity comes exclusively from the established link. Guest-supplied IDs are ignored.
      // Input sequence numbers reject delayed packets across a rematch.
      if (data.run !== s.run || !Number.isSafeInteger(data.seq) || data.seq <= link.lastInput) return;
      link.lastInput = data.seq;
      this._emit('input', { id: link.id, input: sanitizeInput(data.input) });
    } else if (data.type === 'ping') this._send(link, packet('pong'));
    else if (data.type === 'leave') this._drop(s, link);
  }

  _receiveGuest(s, link, data) {
    if (!this._active(s) || !validPacket(data)) return;
    link.lastRx = Date.now();
    if (data.type === 'reject') { s.joinFinish?.(new Error(String(data.reason || 'The host could not accept your connection.'))); return; }
    if (data.type === 'ended') { this._shutdown(s, 'The host ended the room.'); return; }
    if (data.type === 'welcome' && !link.welcomed) {
      if (typeof data.id !== 'string' || !Array.isArray(data.roster) || data.roster.length > 4 || !data.roster.some(p => p.id === data.id)) return;
      this.localId = data.id;
      link.welcomed = true;
      this._setRoster(data.roster);
      this._emit('status', 'Crew connected. Waiting for the captain to launch.');
      s.joinFinish?.();
      return;
    }
    if (!link.welcomed) return;
    if (data.type === 'roster') this._setRoster(data.roster);
    else if (data.type === 'start' && Number.isSafeInteger(data.run) && data.run > (s.run || 0)) {
      s.run = data.run; s.inputSeq = 0; s.snapshotSeq = 0; s.playing = true;
      this._emit('start', data.config);
    } else if (data.type === 'snapshot' && data.run === s.run && Number.isSafeInteger(data.seq) && data.seq > (s.snapshotSeq || 0) && validSnapshot(data.state)) {
      s.snapshotSeq = data.seq;
      this._emit('snapshot', data.state);
    } else if (data.type === 'ping') this._send(link, packet('pong'));
  }

  _setRoster(roster) {
    if (!Array.isArray(roster) || roster.length < 1 || roster.length > 4 || !roster.every(p => p && typeof p.id === 'string')) return;
    this.roster = roster.map(p => ({ id: p.id.slice(0, 30), name: cleanName(p.name), color: /^#[a-f0-9]{6}$/i.test(p.color) ? p.color : COLORS[0], connected: p.connected === true }));
    this._emit('roster', this.roster.map(p => ({ ...p })));
  }

  _publishRoster(s) {
    if (!this._active(s)) return;
    for (const link of s.links.values()) if (link.welcomed) this._send(link, packet('roster', { roster: this.roster }));
    this._emit('roster', this.roster.map(p => ({ ...p })));
  }

  _drop(s, link, close = true) {
    if (!this._active(s) || s.links.get(link.id) !== link) return;
    s.links.delete(link.id);
    this._clear(s, link.timer);
    if (close) link.connection.close();
    if (link.welcomed) {
      this._emit('input', { id: link.id, input: emptyInput() });
      this.roster = this.roster.filter(p => p.id !== link.id);
      this._publishRoster(s);
      this._emit('status', 'A sailor disconnected. Remaining crew can continue.');
    }
  }

  _send(link, data) {
    if (!link?.connection?.open) return false;
    try {
      if (encoder.encode(JSON.stringify(data)).byteLength > MAX_PACKET || link.connection.bufferSize > 8) return false;
      link.connection.send(data); return true;
    } catch { return false; }
  }

  _heartbeat(s) {
    const pulse = () => {
      const now = Date.now();
      for (const link of s.links.values()) {
        if (!link.welcomed) continue;
        if (now - link.lastRx > 15_000) {
          if (this.isHost) this._drop(s, link);
          else { this._shutdown(s, 'The host stopped responding. Keep both browsers open and try a new room.'); return; }
        } else this._send(link, packet('ping'));
      }
      this._timer(s, pulse, 2000);
    };
    this._timer(s, pulse, 2000);
  }

  sendInput(input) {
    const s = this.session;
    if (!s || this.isHost || !s.playing) return false;
    s.inputSeq = (s.inputSeq || 0) + 1;
    return this._send(s.links.get('host'), packet('input', { run: s.run, seq: s.inputSeq, input: sanitizeInput(input) }));
  }

  broadcast(state) {
    const s = this.session;
    if (!s || !this.isHost || !s.playing) return;
    s.snapshotSeq = (s.snapshotSeq || 0) + 1;
    for (const link of s.links.values()) if (link.welcomed) this._send(link, packet('snapshot', { run: s.run, seq: s.snapshotSeq, state }));
  }

  startGame(config) {
    const s = this.session;
    if (!s || !this.isHost) return false;
    s.playing = true; s.run = (s.run || 0) + 1; s.snapshotSeq = 0;
    for (const link of [...s.links.values()]) {
      if (!link.welcomed) { this._reject(s, link.connection, 'The voyage started before boarding finished. Ask for a new room.'); this._drop(s, link, false); }
      else { link.lastInput = 0; this._send(link, packet('start', { run: s.run, config })); }
    }
    this._emit('start', config);
    return true;
  }

  _shutdown(s, reason) {
    if (!this._active(s)) return;
    this.leave();
    this._emit('closed', reason);
  }

  leave() {
    const s = this.session;
    if (!s) return;
    for (const link of s.links.values()) this._send(link, packet(this.isHost ? 'ended' : 'leave'));
    s.closed = true; this.session = null;
    for (const cancel of [...s.cancels]) cancel();
    for (const timer of s.timers) clearTimeout(timer);
    s.timers.clear(); s.cancels.clear();
    for (const link of s.links.values()) { try { link.connection.close(); } catch { /* already closed */ } }
    s.links.clear();
    try { s.peer?.destroy(); } catch { /* already closed */ }
    this.isHost = false; this.localId = 'host'; this.roomCode = ''; this.roster = [];
  }
}
