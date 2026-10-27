import './style.css';
import './refinements.css';
import { Game } from './game.js';
import { CrewNetwork } from './network.js';
import { CrewRenderer } from './renderer.js';

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
const keys = new Set();
const touch = { x:0, z:0, brace:false, interact:false, ping:false };
const isTouch = new URLSearchParams(location.search).get('controls') === 'touch' || matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints > 0;
document.body.classList.toggle('touch-mode', isTouch);
$('sailor-name').value = preferences.get('name', 'Captain');
$('reduce-motion').checked = preferences.get('reduced-motion', 'false') === 'true';
document.body.classList.toggle('reduced-motion', $('reduce-motion').checked);

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
  ];
  s.presentation = true;
  return s;
}
const attractState = demoState();

function resetPresentation() {
  screen = 'menu'; game = null; state = null;
  guestPackets = []; remoteInputs.clear(); accumulator = 0;
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
  screen = 'game'; accumulator = 0; networkClock = 0; lastEvent = 0; lastDamage = 100; lastWaveId=0;
  guestPackets = []; lastSnapshotAt = performance.now(); remoteInputs.clear(); clearInput();
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
  $('score').textContent=String(s.score).padStart(4,'0');
  $('route-label').textContent=s.time>s.duration-30?'THE LAST LIGHTHOUSE':'SUNNY SALVAGE';
  $('balance-needle').style.left=`${50+clamp(s.boat.steer,-1,1)*46}%`;
  const html=s.players.map(p=>{
    const self=p.id===(online?network.localId:'host');
    const label=p.state==='swim'?`OVERBOARD · ${Math.ceil(p.swimTime)}s`:p.state==='rescue'?'COMING ABOARD':p.state==='air'?'AIRBORNE!':p.brace?'BRACED':p.snack?'SNACK READY':self?'YOU':'ON DECK';
    return `<div class="crew-chip ${p.state==='swim'?'overboard':''}"><span class="avatar" style="--color:${p.color}">${p.state==='swim'?'!':p.brace?'↓':'⚓'}</span><div><strong>${escapeHTML(p.name)}${self?' · YOU':''}</strong><small>${label}</small></div></div>`;
  }).join('');
  if(html!==crewHTML){$('crew-hud').innerHTML=html;crewHTML=html;}
  const wave=s.waves.find(w=>!w.hit&&w.z-s.boat.z<s.boat.speed*3.6);
  $('wave-warning').hidden=!wave;
  if(wave && wave.id!==lastWaveId){lastWaveId=wave.id;sounds.cue('wave');}
  const event=s.events.at(-1);
  if(event&&event.id!==lastEvent){
    lastEvent=event.id;
    if(event.kind!=='wave'){$('game-toast').textContent=event.text;$('game-toast').hidden=false;}
    if(['rescue','pickup','fall'].includes(event.kind))sounds.cue(event.kind);
  }
  if(!event || s.time-event.at>3.4)$('game-toast').hidden=true;
  if(s.hull<lastDamage)sounds.cue('damage');lastDamage=s.hull;
  const p=s.players.find(p=>p.id===(online?network.localId:'host'));
  const rescue=s.players.some(other=>other.id!==p?.id&&['swim','rescue'].includes(other.state));
  $('touch-interact').querySelector('small').textContent=rescue?'HOLD RESCUE':p?.snack?'USE SNACK':'RESCUE / USE';
  $('snack-hint').hidden=!p?.snack;
  if(p?.snack)$('snack-hint').textContent=`${{bubble:'◌ Bubble Fruit',chili:'♨ Chili Noodles',anchor:'⚓ Anchor Biscuit'}[p.snack]||'Snack ready'} · ${isTouch?'tap Use':'press E'}`;
  let tip=null;
  if(s.time<7)tip=['↔','YOU ARE THE STEERING WHEEL',isTouch?'Move the joystick to shift your weight.':'WASD to move. Stand left or right to steer.'];
  else if(s.time<14)tip=['↓','BIG WAVE? SMALL TARGET.',isTouch?'Hold Brace until the wave passes.':'Hold Space to brace when a wave arrives.'];
  else if(s.time<24)tip=['⚓','NOBODY LEFT BEHIND',s.players.length===1?'Your automatic lifeline rescues you if you fall.':isTouch?'Move to a friend’s side. Hold Rescue.':'Move to a friend’s side. Hold E to rescue.'];
  else if(p?.state==='swim')tip=['!','YOU’RE OVERBOARD',s.players.length===1?'Swim toward the boat. Your lifeline is coming.':'Swim toward the boat and call for help!'];
  $('tutorial').hidden=!tip||!!wave;
  if(tip){$('tutorial').querySelector('.tutorial-icon').textContent=tip[0];$('tutorial').querySelector('strong').textContent=tip[1];$('tutorial').querySelector(':scope > div > span').textContent=tip[2];}
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
  return {...b.state,boat:{...b.state.boat,x:mix(a.state.boat.x,b.state.boat.x),z:mix(a.state.boat.z,b.state.boat.z),roll:mix(a.state.boat.roll,b.state.boat.roll)},players:b.state.players.map(p=>{
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
  if(!document.hidden||!online||!network.isHost||screen!=='game'||!game)return;
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
      if(!(helpOpen&&!online)&&!document.hidden){
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
      renderer.render(online&&!network.isHost?guestRender(now):state,online?network.localId:'host',dt);
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
}
