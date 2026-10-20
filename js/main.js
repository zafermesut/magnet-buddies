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

function loadTweaks() {
  try {
    const saved = JSON.parse(localStorage.getItem('tweaks-v2') || '{}');
    for (const t of TWEAKS) if (typeof saved[t.key] === 'number') CONFIG[t.key] = saved[t.key];
  } catch (e) { /* depolama yoksa varsayılanlar */ }
}

function saveTweaks() {
  try {
    const out = {};
    for (const t of TWEAKS) out[t.key] = CONFIG[t.key];
    localStorage.setItem('tweaks-v2', JSON.stringify(out));
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

const input = { sx: innerWidth / 2, sy: innerHeight / 2, keys: new Set(), touching: false };
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add('touch');

function player() { return state === 'playing' && game.player && game.player.alive ? game.player : null; }

canvas.addEventListener('mousemove', e => { input.sx = e.clientX; input.sy = e.clientY; });
canvas.addEventListener('mousedown', e => {
  const p = player();
  if (!p) return;
  if (e.button === 0) game.switchPolarity(p);
  if (e.button === 2) game.blast(p);
});
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

for (const [id, fn] of [['btnSwitch', p => game.switchPolarity(p)], ['btnBlast', p => game.blast(p)]]) {
  $(id).addEventListener('touchstart', e => { e.preventDefault(); const p = player(); if (p) fn(p); }, { passive: false });
  $(id).addEventListener('mousedown', e => { e.preventDefault(); const p = player(); if (p) fn(p); });
}

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') {
    if (e.key === 'Enter' && state === 'menu') startGame();
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 't') { $('tweaks').classList.toggle('hidden'); return; }
  if (state === 'dead' && e.key === 'Enter') { startGame(); return; }
  if (state === 'menu' && e.key === 'Enter') { startGame(); return; }
  input.keys.add(k);
  const p = player();
  if (!p || e.repeat) return;
  if (e.code === 'Space') { e.preventDefault(); game.switchPolarity(p); }
  if (e.key === 'Shift') game.blast(p);
});
addEventListener('keyup', e => input.keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => input.keys.clear());

function applyInput() {
  const p = player();
  if (!p) return;
  const K = input.keys;
  const kx = (K.has('d') || K.has('arrowright') ? 1 : 0) - (K.has('a') || K.has('arrowleft') ? 1 : 0);
  const ky = (K.has('s') || K.has('arrowdown') ? 1 : 0) - (K.has('w') || K.has('arrowup') ? 1 : 0);
  if (kx || ky) {
    const l = Math.hypot(kx, ky);
    p.aimX = p.x + kx / l * 400;
    p.aimY = p.y + ky / l * 400;
    p.throttle = 1;
    return;
  }
  if (isTouch && !input.touching) { p.throttle = 0; return; }
  const w = renderer.screenToWorld(input.sx, input.sy);
  p.aimX = w.x; p.aimY = w.y;
  const d = Math.hypot(w.x - p.x, w.y - p.y);
  p.throttle = clamp((d - p.r * 0.3) / (p.r * 2 + 60), 0, 1);
}

// ---------- Ekranlar ----------

function startGame() {
  const name = $('nameInput').value.trim() || 'İsimsiz';
  try { localStorage.setItem('name', name); } catch (e) { /* yoksay */ }
  game = new Game(name);
  acc = 0;
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
  const causes = {
    eat: k ? `<b>${esc(k.name)}</b> seni yuttu.` : 'Yutuldun.',
    spike: k ? `<b>${esc(k.name)}</b> seni dikenlere itti.` : 'Dikenlere çarptın.',
    void: k ? `<b>${esc(k.name)}</b> seni boşluğa itti.` : 'Boşluğa düştün.',
  };
  $('deathCause').innerHTML = causes[p.deathCause] || '';
  const secs = Math.round(p.deathT - p.bornT);
  const rank = 1 + game.magnets.filter(m => m.alive && m.frags > p.frags).length;
  $('deathStats').innerHTML = `
    <div>En çok demir<b>${p.maxAmmo}</b></div>
    <div>Frag<b>${p.frags}</b></div>
    <div>Hayatta kalma<b>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</b></div>
    <div>Sıralama<b>#${rank}</b></div>`;
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
  const p = game.player;

  const pol = $('polarity');
  pol.className = p.sign > 0 ? 'pos' : p.sign < 0 ? 'neg' : 'neu';
  pol.textContent = p.sign > 0 ? '+' : p.sign < 0 ? '−' : '•';
  const sw = CONFIG.switchCooldown > 0 ? 1 - p.switchCD / CONFIG.switchCooldown : 1;
  const ds = p.ammo > 0 ? 1 - p.blastCD / CONFIG.blastCooldown : 0;
  $('switchFill').style.width = (p.locked ? 0 : sw * 100) + '%';
  $('switchFill').classList.toggle('ready', sw >= 1 && !p.locked);
  $('blastFill').style.width = ds * 100 + '%';
  $('blastFill').classList.toggle('ready', ds >= 1);

  // Liste ve metinler saniyede ~8 kez yeterli
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.12;

  const armor = p.ammo >= CONFIG.spikeArmor ? '' : '<br><span class="lock">Zırh yok: dikenler öldürür</span>';
  $('stats').innerHTML = `Frag <b>${p.frags}</b><br>Demir ${p.ammo}/${CONFIG.ammoCap}` + armor +
    (p.boosted ? '<br><span class="boost">2× güç bölgesi</span>' : '') +
    (p.locked ? '<br><span class="lock">Kutup kilitli</span>' : '');

  const top = game.leaderboard(10);
  let html = '<h3>LİDERLİK · frag · demir</h3><ol>';
  top.forEach((m, i) => {
    html += `<li class="${m === p ? 'me' : ''}"><span>${i + 1}.</span>` +
      `<span class="dot" style="background:${m.pol > 0 ? '#ff4d5e' : '#3d9bff'}"></span>` +
      `<span class="n">${esc(m.name)}</span><span class="m">${m.frags} · ${m.ammo}</span></li>`;
  });
  html += '</ol>';
  if (p.alive && !top.includes(p)) {
    const rank = 1 + game.magnets.filter(m => m.alive && (m.frags > p.frags || (m.frags === p.frags && m.ammo > p.ammo))).length;
    html += `<ol><li class="me"><span>${rank}.</span><span class="n">${esc(p.name)}</span>` +
      `<span class="m">${p.frags} · ${p.ammo}</span></li></ol>`;
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
