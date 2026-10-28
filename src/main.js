import './style.css';
import './refinements.css';
import './juice.css';
import { Game } from './game.js';
import { CrewNetwork } from './network.js';
import { CrewRenderer } from './renderer.js';
import { ADDONS, ADDON_IDS } from './addons.js';

const $ = id => document.getElementById(id);
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const preferences = {
  get(key, fallback) { try { return localStorage.getItem(`crew-${key}`) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`crew-${key}`, value); } catch { /* Browser privacy mode. */ } },
};
const network = new CrewNetwork();
let renderer, game = null, state = null, screen = 'menu', online = false;
let duration = 180, lastEvent = 0, lastFrame = performance.now(), lastHUD = 0;
let networkClock = 0, accumulator = 0, running = true, helpOpen = false, wakeLock = null;
let busy = false, connectionGeneration = 0, guestPackets = [], lastSnapshotAt = 0;
let rosterHTML = '', crewHTML = '', globalToastTimer, lastDamage = 100, lastWaveId = 0;
const remoteInputs = new Map();
const impactNodes = new Map();
let activeAddonsHTML = '', heldSnackHTML = '';
let qaPaused = false;
const keys = new Set();
const touch = { x:0, z:0, brace:false, interact:false, ping:false };
const isTouch = new URLSearchParams(location.search).get('controls') === 'touch' || matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints > 0;
document.body.classList.toggle('touch-mode', isTouch);
$('sailor-name').value = preferences.get('name', 'Captain');
$('reduce-motion').checked = preferences.get('reduced-motion', 'false') === 'true';
document.body.classList.toggle('reduced-motion', $('reduce-motion').checked);
$('snack-catalog').innerHTML = ADDON_IDS.map(id => {
  const snack = ADDONS[id];
  return `<div class="catalog-snack"><span>${snack.icon}</span><div><strong>${escapeHTML(snack.name)}</strong><p>${escapeHTML(snack.description)}</p></div></div>`;
}).join('');

class SeaSounds {
  constructor() { this.enabled = false; this.context = null; this.nextAmbient = 0; }
  async unlock() {
    if (!this.enabled) return;
    try {
      this.context ||= new (window.AudioContext || window.webkitAudioContext)();
      if (this.context.state !== 'running') await this.context.resume();
    } catch { /* Audio is optional. */ }
  }
  tone(frequency, duration = .14, type = 'sine', volume = .08, delay = 0) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const c = this.context, start = c.currentTime + delay;
    const oscillator = c.createOscillator(), gain = c.createGain();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency,start);
    gain.gain.setValueAtTime(.001,start); gain.gain.exponentialRampToValueAtTime(volume,start+.015);
    gain.gain.exponentialRampToValueAtTime(.001,start+duration);
    oscillator.connect(gain); gain.connect(c.destination); oscillator.start(start); oscillator.stop(start+duration+.02);
  }
  cue(kind) {
    if (kind === 'wave') { this.tone(330,.2,'triangle'); this.tone(440,.24,'triangle',.08,.22); }
    else if (kind === 'damage' || kind === 'fall') { this.tone(100,.23,'triangle',.12); this.tone(75,.3,'sine',.1,.08); }
    else if (kind === 'rescue' || kind === 'pickup') { this.tone(523,.12); this.tone(659,.15,'sine',.08,.11); this.tone(784,.2,'sine',.07,.22); }
    else if (kind === 'win') [392,523,659,784].forEach((n,i)=>this.tone(n,.4,'triangle',.07,i*.15));
    else this.tone(262,.13,'sine',.035);
  }
  update(now) {
    if (this.enabled && screen === 'game' && now > this.nextAmbient) {
      this.nextAmbient = now + 1.7;
      this.tone([196,262,294,330][Math.floor(now / 1700) % 4],.45,'sine',.015);
    }
  }
}
const sounds = new SeaSounds();

function toast(text, error = false) {
  clearTimeout(globalToastTimer);
  $('global-toast').textContent = text;
  $('global-toast').style.background = error ? '#91472f' : '';
  $('global-toast').hidden = false;
  globalToastTimer = setTimeout(() => $('global-toast').hidden = true, 4200);
}

function status(text, error = false) {
  $('connection-status').textContent = text;
  $('connection-status').classList.toggle('error', error);
  $('connection-status').hidden = !text;
}

function panel(name) {
  for (const id of ['home','join','lobby']) $(`${id}-panel`).hidden = id !== name;
}

function setBusy(value) {
  busy = value;
  for (const id of ['host','join','solo','show-join']) $(id).disabled = value;
}

function name() {
  const value = $('sailor-name').value.trim().slice(0,16) || 'Captain';
  preferences.set('name', value);
  return value;
}

function clearInput() {
  keys.clear(); Object.assign(touch,{x:0,z:0,brace:false,interact:false,ping:false});
  $('joystick-knob').style.transform = '';
  for (const id of ['touch-brace','touch-interact']) $(id).classList.remove('held');
}

function input() {
  if (helpOpen || document.hidden || screen !== 'game') return {x:0,z:0,brace:false,interact:false,ping:false};
  let x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')) + touch.x;
  let z = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')) + touch.z;
  let brace = keys.has('Space') || touch.brace, interact = keys.has('KeyE') || touch.interact;
  let ping = keys.has('KeyQ') || touch.ping;
  let pad;
  try { pad = navigator.getGamepads?.()?.find(p=>p?.connected); } catch { /* Embedded pages can restrict gamepad access. */ }
  if (pad) { x += Math.abs(pad.axes[0]) > .15 ? pad.axes[0] : 0; z -= Math.abs(pad.axes[1]) > .15 ? pad.axes[1] : 0; brace ||= !!pad.buttons[7]?.pressed; interact ||= !!pad.buttons[0]?.pressed; ping ||= !!pad.buttons[3]?.pressed; }
  return {x:clamp(x,-1,1),z:clamp(z,-1,1),brace,interact,ping};
}

async function keepAwake() {
  try { if ('wakeLock' in navigator && !document.hidden && screen === 'game') wakeLock = await navigator.wakeLock.request('screen'); } catch { /* Unsupported or denied by browser. */ }
}

function demoState() {
  const s = new Game({seed:314159,duration:180,roster:[
    {id:'host',name:'Captain',color:'#ffb34d'}, {id:'demo-2',name:'Skipper',color:'#56ded0'},
    {id:'demo-3',name:'Scout',color:'#bd9cff'}, {id:'demo-4',name:'Mate',color:'#ff82aa'},
  ]}).state;
  s.players.forEach((p,i)=>{p.x=[-2.25,1.8,-.7,2.8][i];p.z=[.8,.4,-1.2,-1.35][i];});
  s.obstacles = [
    {id:101,type:'whale',x:-12,z:22,radius:2.8,active:true},
    {id:102,type:'crate',x:10,z:15,radius:1.1,active:true},
    {id:103,type:'treasure',x:5,z:29,radius:1,active:true},
    {id:104,type:'wreck',x:14,z:45,radius:2.5,active:true},
    {id:105,type:'supply',x:-5,z:42,radius:1,active:true},
    {id:106,type:'island',x:-29,z:26,radius:6.6,radiusZ:4.95,variant:1,active:true},
    {id:107,type:'island',x:30,z:63,radius:8,radiusZ:6,variant:2,active:true},
    {id:108,type:'island',x:-34,z:107,radius:9.4,radiusZ:7.05,variant:3,active:true},
  ];
  s.presentation = true;
  return s;
}
const attractState = demoState();

function resetPresentation() {
  screen = 'menu'; game = null; state = null;
  guestPackets = []; remoteInputs.clear(); accumulator = 0;
  impactNodes.clear(); $('impact-numbers').replaceChildren();
  document.body.classList.remove('playing');
  $('menu').hidden = false; $('hud').hidden = true; $('results').hidden = true;
  clearInput(); wakeLock?.release().catch(()=>{}); wakeLock = null;
}

function harbor({leave=true}={}) {
  connectionGeneration++;
  if (leave) { online = false; network.leave(); }
  setBusy(false); status(''); panel('home'); resetPresentation();
}

function begin(config) {
  game = new Game(config); state = game.state;
  qaPaused = false;
  screen = 'game'; accumulator = 0; networkClock = 0; lastEvent = 0; lastDamage = 100; lastWaveId=0;
  guestPackets = []; lastSnapshotAt = performance.now(); remoteInputs.clear(); clearInput();
  impactNodes.clear(); $('impact-numbers').replaceChildren(); activeAddonsHTML = ''; heldSnackHTML = '';
  $('menu').hidden=true; $('results').hidden=true; $('hud').hidden=false;
  $('tutorial').hidden=false; $('game-toast').hidden=true;
  document.body.classList.add('playing');
  crewHTML=''; helpOpen=false; $('help-modal').hidden=true;
  status(''); updateHUD(state); sounds.unlock(); keepAwake();
  if (online && network.isHost) network.broadcast(game.snapshot());
}

function launch() {
  const config={seed:crypto.getRandomValues(new Uint32Array(1))[0],duration,roster:online ? network.roster : [{id:'host',name:name(),color:'#ffb34d'}]};
  if (online && network.isHost) network.startGame(config);
  else if (!online) begin(config);
}

function updateRoster(roster=network.roster) {
  const html = Array.from({length:4},(_,i)=>{
    const p=roster[i];
    return p ? `<div class="roster-slot"><span class="avatar" style="--color:${p.color}">⚓</span><div><strong>${escapeHTML(p.name)}</strong><small>${p.id==='host'?'CAPTAIN':p.id===network.localId?'YOU · CONNECTED':'CONNECTED'}</small></div></div>` : '<div class="roster-slot empty"><span class="avatar">+</span> Waiting for crew</div>';
  }).join('');
  if(html!==rosterHTML){$('roster').innerHTML=html;rosterHTML=html;}
  $('launch').disabled=!network.isHost;
  $('launch').firstElementChild.textContent=network.isHost?'All aboard. Set sail!':'Waiting for the captain…';
  $('lobby-note').textContent=network.isHost?'Share the code with up to three friends.':'Your captain chooses the voyage and sets sail.';
  $('room-code').textContent=network.roomCode || '····';
  if (online && network.isHost && game && screen!=='menu') {
    for(const p of [...game.state.players]) if(!roster.some(r=>r.id===p.id)) game.removePlayer(p.id);
  }
}

network.addEventListener('roster',e=>updateRoster(e.detail));
network.addEventListener('status',e=>{if(screen==='menu')status(e.detail);else if(!e.detail.startsWith('Room ready'))toast(e.detail);});
network.addEventListener('error',e=>status(e.detail,true));
network.addEventListener('closed',e=>{harbor();toast(e.detail,true);});
network.addEventListener('input',e=>remoteInputs.set(e.detail.id,{input:e.detail.input,at:performance.now()}));
network.addEventListener('start',e=>begin(e.detail));
network.addEventListener('snapshot',e=>{
  if(!online || network.isHost || !e.detail?.players || !e.detail?.boat)return;
  state=e.detail;lastSnapshotAt=performance.now();
  guestPackets.push({at:lastSnapshotAt,state:e.detail});guestPackets=guestPackets.slice(-5);
});

$('solo').addEventListener('click',()=>{if(busy)return;online=false;network.leave();launch();});
$('host').addEventListener('click',async()=>{
  if(busy)return;const generation=++connectionGeneration;
  setBusy(true);status('Calling the harbor…');online=true;
  try {await network.host(name());if(generation!==connectionGeneration)return;panel('lobby');updateRoster();status('');}
  catch(error){if(generation===connectionGeneration){online=false;status(error.message,true);}}
  finally{if(generation===connectionGeneration)setBusy(false);}
});
$('show-join').addEventListener('click',()=>{panel('join');status('');$('room-input').focus();});
for(const button of document.querySelectorAll('.back-home'))button.addEventListener('click',()=>{connectionGeneration++;network.leave();online=false;panel('home');setBusy(false);status('');});
$('room-input').addEventListener('input',()=>{$('room-input').value=$('room-input').value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);});
$('room-input').addEventListener('keydown',e=>{if(e.key==='Enter')$('join').click();});
$('join').addEventListener('click',async()=>{
  if(busy)return;
  const code=$('room-input').value.trim();
  if(code.length!==4){status('Enter all four characters from your captain’s room code.',true);return;}
  const generation=++connectionGeneration;setBusy(true);online=true;
  try{await network.join(code,name());if(generation!==connectionGeneration)return;panel('lobby');updateRoster();status('');}
  catch(error){if(generation===connectionGeneration){online=false;status(error.message,true);}}
  finally{if(generation===connectionGeneration)setBusy(false);}
});
$('leave-room').addEventListener('click',()=>harbor());
$('launch').addEventListener('click',launch);
$('copy-room').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(network.roomCode);toast(`Room ${network.roomCode} copied. Send it to your crew!`);}
  catch{toast(`Your room code is ${network.roomCode}.`);}
});
for(const button of document.querySelectorAll('[data-duration]'))button.addEventListener('click',()=>{
  duration=Number(button.dataset.duration);
  for(const b of document.querySelectorAll('[data-duration]')){const selected=b===button;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));}
});
$('rematch').addEventListener('click',()=>{if(!online || network.isHost)launch();});
$('back-menu').addEventListener('click',()=>harbor());
$('exit-game').addEventListener('click',()=>harbor());
document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();if(screen==='menu'&&!busy){panel('home');status('');}});
$('sound').addEventListener('click',async()=>{
  sounds.enabled=!sounds.enabled;await sounds.unlock();$('sound').querySelector('.sound-off').hidden=sounds.enabled;
  $('sound').setAttribute('aria-label',sounds.enabled?'Turn sound off':'Turn sound on');if(sounds.enabled)sounds.cue('pickup');
});
function help(show){helpOpen=show;$('help-modal').hidden=!show;clearInput();if(show)$('close-help').focus();}
$('help').addEventListener('click',()=>help(true));
$('close-help').addEventListener('click',()=>help(false));
$('help-done').addEventListener('click',()=>help(false));
$('help-modal').addEventListener('click',e=>{if(e.target===$('help-modal'))help(false);});
$('reduce-motion').addEventListener('change',()=>{const v=$('reduce-motion').checked;document.body.classList.toggle('reduced-motion',v);preferences.set('reduced-motion',String(v));if(renderer)renderer.reducedMotion=v;});
$('reload').addEventListener('click',()=>location.reload());

document.addEventListener('keydown',e=>{
  if(e.target instanceof HTMLInputElement)return;
  if(e.code==='Escape'){help(!helpOpen);return;}
  if(screen==='game' && ['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','KeyE','KeyQ'].includes(e.code)){e.preventDefault();keys.add(e.code);}
});
document.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('blur',clearInput);
let lastBackgroundTick=performance.now();
document.addEventListener('visibilitychange',()=>{clearInput();lastFrame=performance.now();lastBackgroundTick=lastFrame;accumulator=0;if(!document.hidden)keepAwake();});
window.addEventListener('pagehide',()=>{network.leave();wakeLock?.release().catch(()=>{});});

let joystickId=null, joystickCenter={x:0,y:0};
function moveJoystick(e){
  if(e.pointerId!==joystickId)return;
  const dx=e.clientX-joystickCenter.x,dy=e.clientY-joystickCenter.y;
  const length=Math.hypot(dx,dy),radius=40,scale=length>radius?radius/length:1;
  // Normalize by radial distance, avoiding diagonal speed advantages.
  touch.x=dx*scale/radius;touch.z=-dy*scale/radius;
  $('joystick-knob').style.transform=`translate(${dx*scale}px,${dy*scale}px)`;
}
$('joystick').addEventListener('pointerdown',e=>{e.preventDefault();if(joystickId!==null)return;joystickId=e.pointerId;$('joystick').setPointerCapture(e.pointerId);const r=$('joystick').getBoundingClientRect();joystickCenter={x:r.left+r.width/2,y:r.top+r.height/2};moveJoystick(e);});
$('joystick').addEventListener('pointermove',moveJoystick);
function releaseJoystick(e){if(e.pointerId!==joystickId)return;joystickId=null;touch.x=0;touch.z=0;$('joystick-knob').style.transform='';}
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('joystick').addEventListener(event,releaseJoystick);
function bindHold(id,key){
  const button=$(id);let pointer=null;
  button.addEventListener('pointerdown',e=>{e.preventDefault();if(pointer!==null)return;pointer=e.pointerId;button.setPointerCapture(pointer);touch[key]=true;button.classList.add('held');sounds.unlock();});
  const release=e=>{if(e.pointerId!==pointer)return;pointer=null;touch[key]=false;button.classList.remove('held');};
  for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,release);
  button.addEventListener('contextmenu',e=>e.preventDefault());
}
bindHold('touch-brace','brace');bindHold('touch-interact','interact');bindHold('touch-ping','ping');

function updateHUD(s){
  $('hull-value').innerHTML=`${Math.ceil(s.hull)}<span>%</span>`;
  $('hull-fill').style.width=`${s.hull}%`;$('hull-fill').style.background=s.hull<30?'#ed7b58':s.hull<60?'#d8b853':'#4eaa8e';
  $('buoys').textContent=`${s.buoys} EMERGENCY ${s.buoys===1?'BUOY':'BUOYS'}`;
  const remaining=Math.max(0,Math.ceil(s.duration-s.time));$('clock').textContent=`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`;
  $('progress-fill').style.width=`${clamp(s.time/s.duration*100,0,100)}%`;
  $('speed-value').textContent=s.boat.speed.toFixed(1);
  const trim=s.boat.trim||0;
  $('trim-icon').textContent=trim>.15?'↑':trim<-.15?'↓':'↔';
  $('trim-label').textContent=trim>.15?'BOW WEIGHT · ACCELERATING':trim<-.15?'STERN WEIGHT · SLOWING':'BOW: FASTER · STERN: SLOWER';
  $('pace-label').textContent=`PACE ${(s.boat.speedTier||0)+1}`;
  $('speed-readout').classList.toggle('high-speed',s.boat.speed>17);
  $('speed-readout').title=`${s.boat.speed.toFixed(1)} knots · ${trim>.15?'bow accelerates':trim<-.15?'stern slows':'balanced trim'} · sea pace rises through the voyage`;
  $('score').textContent=String(s.score).padStart(4,'0');
  $('route-label').textContent=s.time>s.duration-30?'THE LAST LIGHTHOUSE':'SUNNY SALVAGE';
  $('balance-needle').style.left=`${50+clamp(s.boat.steer,-1,1)*46}%`;
  const html=s.players.map(p=>{
    const self=p.id===(online?network.localId:'host');
    const label=p.state==='swim'?`OVERBOARD · ${Math.ceil(p.swimTime)}s`:p.state==='rescue'?'COMING ABOARD':p.state==='air'?'AIRBORNE!':p.brace?'BRACED':p.snack?'SNACK READY':self?'YOU':'ON DECK';
    return `<div class="crew-chip ${p.state==='swim'?'overboard':''}"><span class="avatar" style="--color:${p.color}">${p.state==='swim'?'!':p.brace?'↓':'⚓'}</span><div><strong>${escapeHTML(p.name)}${self?' · YOU':''}</strong><small>${label}</small></div></div>`;
  }).join('');
  if(html!==crewHTML){$('crew-hud').innerHTML=html;crewHTML=html;}
  const wave=s.waves.filter(w=>!w.passed&&!w.hit&&w.z>=s.boat.z-1)
    .sort((a,b)=>(a.z-s.boat.z)/(s.boat.speed+(a.speed||0))-(b.z-s.boat.z)/(s.boat.speed+(b.speed||0)))
    .find(w=>(w.z-s.boat.z)/(s.boat.speed+(w.speed||0))<4.8);
  $('wave-warning').hidden=!wave;
  if(wave){
    const threatened=Math.abs(s.boat.x-(wave.x??s.boat.x))<(wave.width||14)/2+3.4;
    const seconds=Math.max(0,(wave.z-s.boat.z)/(s.boat.speed+(wave.speed||0)));
    const direction=(wave.x??s.boat.x)>=s.boat.x?'LEFT':'RIGHT';
    $('wave-warning').classList.toggle('safe-wave',!threatened);
    $('wave-warning').querySelector('strong').textContent=threatened?`BREAKER · ${seconds.toFixed(1)}s`:'CLEAR OF THE BREAKER';
    $('wave-warning').querySelector('small').textContent=threatened?`STEER ${direction} TO DODGE · OR HOLD BRACE`:'STAY OUTSIDE ITS FOAMY EDGES';
  }
  if(wave && wave.id!==lastWaveId){lastWaveId=wave.id;sounds.cue('wave');}
  const event=s.events.at(-1);
  if(event&&event.id!==lastEvent){
    lastEvent=event.id;
    if(event.kind!=='wave'){$('game-toast').textContent=event.text;$('game-toast').hidden=false;}
    if(['rescue','pickup','fall'].includes(event.kind))sounds.cue(event.kind);
    else if(event.kind==='pace')sounds.cue('wave');
  }
  if(!event || s.time-event.at>3.4)$('game-toast').hidden=true;
  if(s.hull<lastDamage)sounds.cue('damage');lastDamage=s.hull;
  const p=s.players.find(p=>p.id===(online?network.localId:'host'));
  const rescue=s.players.some(other=>other.id!==p?.id&&['swim','rescue'].includes(other.state));
  $('touch-interact').querySelector('small').textContent=rescue?'HOLD RESCUE':p?.snack?'USE SNACK':'RESCUE / USE';
  $('snack-hint').hidden=!p?.snack;
  if(p?.snack){
    const snack=ADDONS[p.snack];
    const html=snack?`<span class="snack-name">${snack.icon} ${escapeHTML(snack.name)}</span><span class="snack-description">${escapeHTML(snack.description)}</span><b>${isTouch?'TAP USE':'PRESS E'} TO EAT</b>`:'Snack ready';
    if(html!==heldSnackHTML){$('snack-hint').innerHTML=html;heldSnackHTML=html;}
  }else heldSnackHTML='';
  const effects={...(p?.effects||{})};
  for(const [id,time] of Object.entries(s.boat.effects||{}))if(time>0)effects[id]=Math.max(effects[id]||0,time);
  const active=Object.entries(effects).filter(([id,time])=>ADDONS[id]&&time>0);
  const activeHTML=active.map(([id,time])=>`<span class="addon-chip" title="${escapeHTML(ADDONS[id].description)}"><span>${ADDONS[id].icon}</span>${escapeHTML(ADDONS[id].name)}<b>${Math.ceil(time)}s</b></span>`).join('');
  $('active-addons').hidden=!active.length;
  if(activeHTML!==activeAddonsHTML){$('active-addons').innerHTML=activeHTML;activeAddonsHTML=activeHTML;}
  let tip=null;
  if(p?.state==='swim')tip=['!','SWIM BACK ABOARD','Swim close to any edge of the hull to climb up automatically.'];
  else if(p?.state==='rescue')tip=['⚓','COMING ABOARD','Hold tight! You’re climbing back onto the deck.'];
  else if(s.time<7)tip=['↔','YOU ARE THE STEERING WHEEL',isTouch?'Move the joystick to shift your weight.':'WASD to move. Stand left or right to steer.'];
  else if(s.time<14)tip=['≋','DODGE THE FOAM',isTouch?'Steer around moving waves, or hold Brace.':'Steer around a wave’s edge, or hold Space.'];
  else if(s.time<21)tip=['↕','BOW FAST. STERN SLOW.', 'Move forward to accelerate, back to slow down.'];
  else if(s.time<29)tip=['⚓','NOBODY LEFT BEHIND', 'Swim to any hull edge to climb aboard. Friends can also throw a lifeline.'];
  $('tutorial').hidden=!tip||!!wave&&!['swim','rescue'].includes(p?.state);
  if(tip){$('tutorial').querySelector('.tutorial-icon').textContent=tip[0];$('tutorial').querySelector('strong').textContent=tip[1];$('tutorial').querySelector(':scope > div > span').textContent=tip[2];}
}

function renderDamageNumbers(s){
  const live=new Set();
  for(const hit of s.impacts||[]){
    const age=s.time-hit.at;
    if(age<0||age>1.4||hit.kind==='wave')continue;
    live.add(hit.id);
    let node=impactNodes.get(hit.id);
    if(!node){
      node=document.createElement('div');node.className=`damage-number ${hit.blocked?'phased':hit.kind==='thunder'?'thunder':''}`;
      const number=document.createElement('strong'),label=document.createElement('span');
      number.textContent=hit.damage>0?`−${hit.damage}`:hit.blocked?'PHASED!':'ZAP!';
      label.textContent=hit.damage>0?'HULL HIT':hit.blocked?'GHOST GRAPE':'THUNDER POP';
      node.append(number,label);$('impact-numbers').append(node);impactNodes.set(hit.id,node);
    }
    const y=5.4+(renderer.waterHeight?.(s.boat.x,s.boat.z)||0)+age*2;
    const anchor=renderer.projectWorld?.(s.boat.x,y,s.boat.z);
    if(!anchor?.visible){node.hidden=true;continue;}
    node.hidden=false;
    const reduced=document.body.classList.contains('reduced-motion');
    const punch=reduced?1:age<.14?.55+age/.14*.65:1.2-Math.min(.2,(age-.14)*.22);
    const drift=reduced?0:age*26;
    const offsetX=Math.min(110,renderer.canvas.clientWidth*.16);
    node.style.transform=`translate(${anchor.x+offsetX}px,${anchor.y-drift}px) translate(-50%,-50%) scale(${punch}) rotate(${hit.id%2?-5:4}deg)`;
    node.style.opacity=String(Math.min(1,(1.4-age)/.3));
  }
  for(const [id,node]of impactNodes)if(!live.has(id)){node.remove();impactNodes.delete(id);}
}

function showResults(s){
  screen='results';$('results').hidden=false;$('hud').hidden=true;clearInput();
  $('result-eyebrow').textContent=s.phase==='won'?'VOYAGE COMPLETE':'A GLORIOUS SHIPWRECK';
  $('result-title').textContent=s.phase==='won'?'LAND AHOY!':'SEA YOU AGAIN.';
  $('result-icon').textContent=s.phase==='won'?'⚓':'≋';
  $('result-copy').textContent=s.phase==='won'?'One boat. One crew. A story to tell.':s.message||'The sea won this round. Your next voyage awaits.';
  $('result-score').textContent=s.score.toLocaleString();$('result-rescues').textContent=s.stats.rescues;$('result-hull').textContent=`${Math.ceil(s.hull)}%`;
  $('rematch').disabled=online&&!network.isHost;$('rematch').firstElementChild.textContent=online&&!network.isHost?'Waiting for the captain…':'One more voyage';
  $('result-note').textContent=online?`ROOM ${network.roomCode} · ${network.isHost?'Your crew stays together for a rematch.':'Keep this tab open for a rematch.'}`:'A new sea, a new story. Every voyage is different.';
  sounds.cue(s.phase==='won'?'win':'damage');wakeLock?.release().catch(()=>{});wakeLock=null;
}

function guestRender(now){
  if(guestPackets.length<2)return state;
  const target=now-80;
  let a=guestPackets[0],b=guestPackets.at(-1);
  for(let i=0;i<guestPackets.length-1;i++){if(guestPackets[i].at<=target){a=guestPackets[i];b=guestPackets[i+1];}}
  const t=clamp((target-a.at)/Math.max(1,b.at-a.at),0,1);
  const mix=(x,y)=>x+(y-x)*t;
  return {...b.state,time:mix(a.state.time,b.state.time),boat:{...b.state.boat,x:mix(a.state.boat.x,b.state.boat.x),z:mix(a.state.boat.z,b.state.boat.z),roll:mix(a.state.boat.roll,b.state.boat.roll)},waves:b.state.waves.map(w=>{
    const old=a.state.waves.find(q=>q.id===w.id);return old?{...w,z:mix(old.z,w.z)}:w;
  }),players:b.state.players.map(p=>{
    const old=a.state.players.find(q=>q.id===p.id);if(!old||old.state!==p.state)return p;
    return {...p,x:mix(old.x,p.x),z:mix(old.z,p.z),y:mix(old.y,p.y)};
  })};
}

// Browsers may suspend animation frames in a backgrounded host tab. A bounded
// timer keeps the voyage and network heartbeat moving when timers are allowed.
// Mobile OS suspension still requires the captain to return to the game.
setInterval(()=>{
  const now=performance.now();
  const elapsed=Math.min((now-lastBackgroundTick)/1000,1.5);lastBackgroundTick=now;
  if(!document.hidden||!online||!network.isHost||screen!=='game'||!game||qaPaused)return;
  const inputs=Object.fromEntries([...remoteInputs].map(([id,value])=>[id,now-value.at<500?value.input:{}]));
  inputs[network.localId]={brace:true};
  for(let remaining=elapsed;remaining>0;remaining-=.05)game.update(Math.min(remaining,.05),inputs);
  state=game.state;network.broadcast(game.snapshot());
  if(state.phase!=='playing')showResults(state);
},100);

function frame(now){
  if(!running)return;
  const dt=Math.min((now-lastFrame)/1000,.1);lastFrame=now;
  if(screen==='game'){
    const local=input();
    if(!online||network.isHost){
      if(!(helpOpen&&!online)&&!document.hidden&&!qaPaused){
        accumulator=Math.min(accumulator+dt,.2);
        const inputs=Object.fromEntries([...remoteInputs].map(([id,value])=>[id,now-value.at<400?value.input:{}]));
        inputs[online?network.localId:'host']=local;
        while(accumulator>=1/60){game.update(1/60,inputs);accumulator-=1/60;}
      }
      state=game.state;
      if(online){networkClock+=dt;if(networkClock>=.05){network.broadcast(game.snapshot());networkClock=0;}}
    }else{
      networkClock+=dt;if(networkClock>=.04){network.sendInput(local);networkClock=0;}
      if(now-lastSnapshotAt>4000&&now-lastHUD>100){$('game-toast').textContent='Waiting for the captain’s connection…';$('game-toast').hidden=false;}
    }
    if(state){
      if(now-lastHUD>80){updateHUD(state);lastHUD=now;}
      const visualState=online&&!network.isHost?guestRender(now):state;
      renderer.render(visualState,online?network.localId:'host',dt);
      renderDamageNumbers(visualState);
      if(state.phase!=='playing')showResults(state);
    }
  }else if(screen==='results'&&state){
    renderer.render(state,online?network.localId:'host',dt);
  }else{
    attractState.time+=dt;attractState.boat.roll=Math.sin(attractState.time*.8)*.025;
    renderer.render(attractState,'host',dt);
  }
  sounds.update(now);requestAnimationFrame(frame);
}

try{
  renderer=new CrewRenderer($('ocean'));renderer.reducedMotion=$('reduce-motion').checked;
  window.addEventListener('resize',()=>renderer.resize());
  renderer.render(attractState,'host',0);
  $('loading').hidden=true;requestAnimationFrame(frame);
}catch(error){
  console.error(error);$('loading').hidden=true;$('graphics-error').hidden=false;
  $('graphics-error-text').textContent=`The 3D scene could not start. Try enabling hardware acceleration or using a current browser. ${error.message||''}`;
}

// Inspection hook is available only on local development origins.
if(import.meta.env.DEV){
  window.__crew={get game(){return game;},get state(){return state;},get screen(){return screen;},network,launch,harbor,renderer};
  // Deterministic, click-driven fixtures for browser visual QA. Production
  // compilation removes this branch; these controls are never shipped.
  if(new URLSearchParams(location.search).has('qa')){
    const toolbar=document.createElement('aside');toolbar.className='qa-toolbar';toolbar.setAttribute('aria-label','Development visual checks');
    const title=document.createElement('b');title.textContent='VISUAL QA · LOCAL ONLY';toolbar.append(title);
    let snackIndex=0, swimSide=0;
    const withGame=action=>()=>{if(screen!=='game'||online){toast('Start a solo voyage first.');return;}action(game);};
    const buttons=[
      ['Collision −15',withGame(g=>{
        g.collisionCooldown=0;for(const p of g.state.players){p.state='deck';p.y=1.8;p.invulnerable=0;p.brace=false;}
        g.state.obstacles.push({id:g.nextId++,type:'wreck',x:g.state.boat.x,z:g.state.boat.z,radius:2.5,active:true});
        g.updateObstacles();g.update(.2,{});qaPaused=true;
      })],
      ['Island ahead',withGame(g=>{
        g.state.obstacles=[{id:g.nextId++,type:'island',x:g.state.boat.x+9,z:g.state.boat.z+24,radius:7.2,radiusZ:5.4,active:true}];
        g.state.waves=[];qaPaused=true;
      })],
      ['Island collision',withGame(g=>{
        g.collisionCooldown=0;
        for(const p of g.state.players){p.state='deck';p.y=1.8;p.invulnerable=0;p.brace=false;}
        g.state.obstacles=[{id:g.nextId++,type:'island',x:g.state.boat.x+6,z:g.state.boat.z+2,radius:7.2,radiusZ:5.4,active:true}];
        g.state.waves=[];g.updateObstacles();g.update(.2,{});qaPaused=true;
      })],
      ['Swim beside next edge',withGame(g=>{
        const p=g.state.players[0],positions=[[5.5,0],[-5.5,0],[0,5],[0,-5.5]];
        p.shield=0;p.effects.bubble=0;g.fallOverboard(p);
        [p.x,p.z]=positions[swimSide++%positions.length];
        g.state.obstacles=[];g.state.waves=[];g.nextChunk=g.nextWave=g.state.time+20;
        qaPaused=true;
      })],
      ['Moving breaker',withGame(g=>{g.state.waves=[];g.spawnWave();for(let i=0;i<4;i++)g.update(.25,{});g.state.waves[0].z=g.state.boat.z+18;g.state.waves[0].x=g.state.boat.x+3;qaPaused=true;})],
      ['Breaker hit',withGame(g=>{for(const p of g.state.players){p.state='deck';p.y=1.8;p.invulnerable=0;p.brace=false;}g.hitWave({strength:1.12,side:0});g.update(.2,{});qaPaused=true;})],
      ['Eat next snack',withGame(g=>{const p=g.state.players[0];p.snack=ADDON_IDS[snackIndex++%ADDON_IDS.length];g.useSnack(p);})],
      ['Stand at bow',withGame(g=>{for(const p of g.state.players){p.z=2.3;p.vz=0;}})],
      ['Stand at stern',withGame(g=>{for(const p of g.state.players){p.z=-2.3;p.vz=0;}})],
      ['Ocean x +150',withGame(g=>{g.state.boat.x+=150;g.state.obstacles=[];g.state.waves=[];g.nextChunk=g.state.time+.1;})],
      ['Next pace tier',withGame(g=>{g.state.time=Math.min(g.state.duration-5,g.state.time+g.state.duration/9);})],
      ['Pause / resume QA',()=>{qaPaused=!qaPaused;toast(qaPaused?'QA simulation paused.':'QA simulation resumed.');}],
      ['Hide QA controls',()=>toolbar.remove()],
    ];
    for(const [label,action]of buttons){const button=document.createElement('button');button.textContent=label;button.addEventListener('click',action);toolbar.append(button);}
    document.body.append(toolbar);
  }
}
