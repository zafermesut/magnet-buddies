'use strict';

// Giriş, oyun döngüsü ve arayüz (menü, HUD, ölüm ekranı, ayar paneli).

const $ = id => document.getElementById(id);
const canvas = $('game');
const renderer = new Renderer(canvas);

const STEP = 1 / 60;
let game = new Game(null, true);   // menünün arkasında botlar oynasın
let state = 'menu';                // menu | playing | dead
let acc = 0, last = performance.now(), hudT = 0;

document.title = GAME_TITLE;
document.querySelector('#title .name').textContent = GAME_TITLE;

// ---------- Ayarların kalıcılığı ----------

const TWEAK_KEY = 'tweaks-v3';

function loadTweaks() {
  try {
    const saved = JSON.parse(localStorage.getItem(TWEAK_KEY) || '{}');
    for (const t of TWEAKS) if (typeof saved[t.key] === 'number') CONFIG[t.key] = saved[t.key];
  } catch (e) { /* depolama yoksa varsayılanlar */ }
}

function saveTweaks() {
  try {
    const out = {};
    for (const t of TWEAKS) out[t.key] = CONFIG[t.key];
    localStorage.setItem(TWEAK_KEY, JSON.stringify(out));
  } catch (e) { /* yoksay */ }
}

function buildTweaks() {
  const list = $('tweakList');
  list.innerHTML = '';
  for (const t of TWEAKS) {
    const row = document.createElement('div');
    row.className = 'tweak';
    row.innerHTML = `<label>${t.label}</label><output></output>
      <input type="range" min="${t.min}" max="${t.max}" step="${t.step}" value="${CONFIG[t.key]}">`;
    const input = row.querySelector('input'), out = row.querySelector('output');
    out.textContent = CONFIG[t.key];
    input.addEventListener('input', () => {
      CONFIG[t.key] = parseFloat(input.value);
      out.textContent = input.value;
      saveTweaks();
    });
    list.appendChild(row);
  }
}

$('resetTweaks').addEventListener('click', () => {
  for (const t of TWEAKS) CONFIG[t.key] = DEFAULT_CONFIG[t.key];
  saveTweaks();
  buildTweaks();
});

loadTweaks();
buildTweaks();

// ---------- Giriş ----------

const input = { sx: innerWidth / 2, sy: innerHeight / 2, keys: new Set(), touching: false, mouseFire: false, touchFire: false };
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add('touch');

function player() { return state === 'playing' && game.player && game.player.alive ? game.player : null; }

canvas.addEventListener('mousemove', e => { input.sx = e.clientX; input.sy = e.clientY; });
canvas.addEventListener('mousedown', e => {
  if (e.button === 0) input.mouseFire = true;
  const p = player();
  if (p && e.button === 2) game.burst(p);
});
addEventListener('mouseup', e => { if (e.button === 0) input.mouseFire = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('touchstart', e => {
  const t = e.touches[0];
  input.sx = t.clientX; input.sy = t.clientY; input.touching = true;
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  const t = e.touches[0];
  input.sx = t.clientX; input.sy = t.clientY;
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchend', e => { if (e.touches.length === 0) input.touching = false; });

function bindButton(id, onDown, onUp) {
  const el = $(id);
  const down = e => { e.preventDefault(); onDown(); };
  const up = e => { e.preventDefault(); if (onUp) onUp(); };
  el.addEventListener('touchstart', down, { passive: false });
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
}
bindButton('btnSwitch', () => { const p = player(); if (p) game.switchPolarity(p); });
bindButton('btnFire', () => { input.touchFire = true; }, () => { input.touchFire = false; });
bindButton('btnBurst', () => { const p = player(); if (p) game.burst(p); });

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') {
    if (e.key === 'Enter' && state === 'menu') startGame();
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 't') { $('tweaks').classList.toggle('hidden'); return; }
  if ((state === 'dead' || state === 'menu') && e.key === 'Enter') { startGame(); return; }
  input.keys.add(k);
  const p = player();
  if (!p || e.repeat) return;
  if (e.code === 'Space') { e.preventDefault(); game.switchPolarity(p); }
  if (e.key === 'Shift') game.burst(p);
});
addEventListener('keyup', e => input.keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => { input.keys.clear(); input.mouseFire = false; });

function nearestEnemy(p) {
  let best = null, bd = 700;
  for (const s of game.ships) {
    if (s === p || !s.alive) continue;
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function applyInput() {
  const p = player();
  if (!p) return;
  const K = input.keys;
  const w = renderer.screenToWorld(input.sx, input.sy);

  // Nişan: fareye; dokunmatikte en yakın rakibe otomatik
  if (isTouch) {
    const t = nearestEnemy(p);
    if (t) { p.aimX = t.x; p.aimY = t.y; }
  } else {
    p.aimX = w.x; p.aimY = w.y;
  }
  p.firing = input.mouseFire || input.touchFire;

  // Hareket: WASD varsa onunla, yoksa fareye/dokunulan yere doğru
  const kx = (K.has('d') || K.has('arrowright') ? 1 : 0) - (K.has('a') || K.has('arrowleft') ? 1 : 0);
  const ky = (K.has('s') || K.has('arrowdown') ? 1 : 0) - (K.has('w') || K.has('arrowup') ? 1 : 0);
  if (kx || ky) {
    const l = Math.hypot(kx, ky);
    p.moveX = p.x + kx / l * 400;
    p.moveY = p.y + ky / l * 400;
    p.throttle = 1;
    return;
  }
  if (isTouch && !input.touching) { p.throttle = 0; return; }
  p.moveX = w.x; p.moveY = w.y;
  const d = Math.hypot(w.x - p.x, w.y - p.y);
  p.throttle = clamp((d - p.r * 0.5) / 120, 0, 1);
}

// ---------- Ekranlar ----------

function startGame() {
  const name = $('nameInput').value.trim() || 'İsimsiz';
  try { localStorage.setItem('name', name); } catch (e) { /* yoksay */ }
  game = new Game(name);
  acc = 0;
  input.mouseFire = false;
  state = 'playing';
  $('menu').classList.add('hidden');
  $('death').classList.add('hidden');
  $('hud').classList.remove('hidden');
}

function showMenu() {
  state = 'menu';
  game = new Game(null, true);
  $('death').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('nameInput').focus();
}

function onDeath() {
  state = 'dead';
  const p = game.player, k = p.killer;
  $('deathCause').innerHTML = k ? `<b>${esc(k.name)}</b> seni vurdu.` : 'Kule mermilerine yakalandın.';
  const secs = Math.round(p.deathT - p.bornT);
  $('deathStats').innerHTML = `
    <div>Skor<b>${p.score}</b></div>
    <div>Frag<b>${p.frags}</b></div>
    <div>Emilen mermi<b>${p.absorbed}</b></div>
    <div>Hayatta kalma<b>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</b></div>`;
  setTimeout(() => {
    if (state !== 'dead') return;
    $('death').classList.remove('hidden');
    $('againBtn').focus();
  }, 900);
}

$('playBtn').addEventListener('click', startGame);
$('againBtn').addEventListener('click', startGame);
$('menuBtn').addEventListener('click', showMenu);
try { $('nameInput').value = localStorage.getItem('name') || ''; } catch (e) { /* yoksay */ }
$('nameInput').focus();

function esc(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- HUD ----------

function updateHud(dt) {
  if (state === 'menu') return;
  const p = game.player, C = CONFIG;

  const pol = $('polarity');
  pol.className = p.pol > 0 ? 'pos' : 'neg';
  pol.textContent = p.pol > 0 ? '+' : '−';
  $('hpFill').style.width = Math.max(0, p.hp / C.maxHp * 100) + '%';
  $('hpFill').className = 'fill ' + (p.hp > 50 ? 'ok' : p.hp > 25 ? 'warn' : 'low');
  $('energyFill').style.width = p.energy / C.maxEnergy * 100 + '%';
  $('energyFill').classList.toggle('ready', p.energy >= C.burstCost);

  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.12;

  $('stats').innerHTML = `Skor <b>${p.score}</b><br>Frag ${p.frags}` +
    (p.energy < C.fireCost ? '<br><span class="lock">Enerji yok: kendi rengini em</span>' : '');

  const top = game.leaderboard(10);
  let html = '<h3>LİDERLİK</h3><ol>';
  top.forEach((m, i) => {
    html += `<li class="${m === p ? 'me' : ''}"><span>${i + 1}.</span>` +
      `<span class="dot" style="background:${m.pol > 0 ? '#ff4d5e' : '#3d9bff'}"></span>` +
      `<span class="n">${esc(m.name)}</span><span class="m">${m.score}</span></li>`;
  });
  html += '</ol>';
  if (p.alive && !top.includes(p)) {
    const rank = 1 + game.ships.filter(m => m.alive && m.score > p.score).length;
    html += `<ol><li class="me"><span>${rank}.</span><span class="n">${esc(p.name)}</span>` +
      `<span class="m">${p.score}</span></li></ol>`;
  }
  $('leaderboard').innerHTML = html;

  $('feed').innerHTML = game.feed
    .filter(f => game.t - f.t < 5)
    .map(f => `<div class="${f.mine ? 'mine' : ''}">${esc(f.text)}</div>`)
    .join('');
}

// ---------- Döngü ----------

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  applyInput();
  acc += dt;
  while (acc >= STEP) {
    game.step(STEP);
    acc -= STEP;
  }
  if (state === 'playing' && !game.player.alive) onDeath();
  renderer.draw(game, dt);
  updateHud(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
