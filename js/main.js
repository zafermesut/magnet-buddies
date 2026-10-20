'use strict';

// Ekranlar ve oyun döngüsü: katılım → bölüm seçimi → oyun → bölüm sonu.

const $ = id => document.getElementById(id);
const renderer = new Renderer($('game'));
Input.init();

const STEP = 1 / 60;
let state = 'lobby';        // lobby | select | playing | complete
let joined = [];            // katılan giriş kaynaklarının id'leri (katılım sırasıyla)
let game = new Game(0, 0);  // menünün arkasında boş 1. bölüm görünsün
let levelIndex = 0;
let acc = 0, last = performance.now(), completeAt = 0;

document.title = GAME_TITLE;
$('title').textContent = GAME_TITLE;

// ---------- İlerleme (en iyi süreler) ----------

let progress = {};
try { progress = JSON.parse(localStorage.getItem('progress-v1') || '{}'); } catch (e) { progress = {}; }
function saveProgress() {
  try { localStorage.setItem('progress-v1', JSON.stringify(progress)); } catch (e) { /* yoksay */ }
}

const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------- Ekran geçişleri ----------

function show(id) {
  for (const s of ['lobby', 'select', 'complete']) $(s).classList.toggle('hidden', s !== id);
  $('hud').classList.toggle('hidden', id !== null);
}

function toLobby() {
  state = 'lobby';
  game = new Game(0, 0);
  show('lobby');
  renderSlots();
}

function toSelect() {
  if (joined.length < 2) return;
  state = 'select';
  game = new Game(levelIndex, 0);
  show('select');
  const grid = $('levelGrid');
  grid.innerHTML = '';
  LEVELS.forEach((l, i) => {
    const b = document.createElement('button');
    b.className = 'lvl';
    const best = progress[i];
    b.innerHTML = `<span class="num">${i + 1}</span><span>${l.magnet ? '🧲 ' : ''}${l.name}</span><span class="best">${best ? '✓ ' + fmt(best) : ''}</span>`;
    b.addEventListener('click', () => startLevel(i));
    grid.appendChild(b);
  });
}

function startLevel(i) {
  levelIndex = i;
  game = new Game(i, joined.length);
  acc = 0;
  state = 'playing';
  show(null);
  $('levelName').textContent = `${i + 1}. ${LEVELS[i].name}`;
  $('levelHint').textContent = LEVELS[i].hint;
  const sources = Input.sources();
  $('controls').innerHTML = joined.map((id, k) => {
    const s = sources.find(x => x.id === id);
    const hint = s ? s.hint + (game.magnet ? ' · ' + s.magnetHint : '') : '';
    return `<span><b style="color:${PLAYER_COLORS[k]}">${k + 1}P</b>${hint}</span>`;
  }).join('');
}

function onComplete() {
  state = 'complete';
  completeAt = performance.now();
  const secs = game.doneT;
  const prevBest = progress[levelIndex];
  if (!prevBest || secs < prevBest) progress[levelIndex] = secs;
  saveProgress();
  const last = levelIndex === LEVELS.length - 1;
  $('completeTitle').textContent = last ? 'Tüm bölümler bitti!' : 'Bölüm tamam!';
  $('completeInfo').innerHTML = `Süre <b>${fmt(secs)}</b>` +
    (prevBest && secs < prevBest ? ' · yeni rekor!' : prevBest ? ` · rekor ${fmt(prevBest)}` : '');
  $('nextBtn').textContent = last ? 'BÖLÜM SEÇİMİ' : 'SONRAKİ BÖLÜM';
  setTimeout(() => { if (state === 'complete') show('complete'); }, 700);
}

function next() {
  if (levelIndex < LEVELS.length - 1) startLevel(levelIndex + 1);
  else toSelect();
}

$('startBtn').addEventListener('click', toSelect);
$('backBtn').addEventListener('click', toLobby);
$('nextBtn').addEventListener('click', next);
$('toSelectBtn').addEventListener('click', toSelect);

addEventListener('keydown', e => {
  if (state === 'lobby' && e.code === 'Enter') toSelect();
  else if (state === 'select') {
    if (e.code === 'Escape') toLobby();
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= LEVELS.length) startLevel(n - 1);
  } else if (state === 'playing') {
    if (e.code === 'KeyR') startLevel(levelIndex);
    if (e.code === 'Escape') toSelect();
  } else if (state === 'complete') {
    if (e.code === 'Enter') next();
    if (e.code === 'Escape') toSelect();
  }
});

// ---------- Katılım ekranı ----------

function renderSlots() {
  const sources = Input.sources();
  const free = sources.filter(s => !joined.includes(s.id));
  let html = '';
  for (let k = 0; k < 4; k++) {
    const id = joined[k];
    if (id) {
      const s = sources.find(x => x.id === id);
      html += `<div class="slot on" style="border-color:${PLAYER_COLORS[k]}">
        <div class="ball" style="background:${PLAYER_COLORS[k]}"></div>
        <b style="color:${PLAYER_COLORS[k]}">${k + 1}P</b><span>${s ? s.label : id}</span></div>`;
    } else {
      const s = free[k - joined.length];
      html += `<div class="slot"><div class="ball"></div><b>${k + 1}P</b>
        <span>${s ? `${s.label}<br>katılmak için <b>${s.join}</b>` : 'boş'}</span></div>`;
    }
  }
  $('slots').innerHTML = html;
  $('startBtn').disabled = joined.length < 2;
  $('lobbyNote').textContent = joined.length === 1 ? 'Bölümler en az 2 kişiyle çözülebilir. Bir arkadaşını çağır!' : '';
}

function lobbyInput() {
  let changed = false;
  for (const s of Input.sources()) {
    const isIn = joined.includes(s.id);
    if (!isIn && joined.length < 4 && Input.pressed(s.id, 'jump')) { joined.push(s.id); changed = true; }
    else if (isIn && Input.pressed(s.id, 'action')) { joined = joined.filter(x => x !== s.id); changed = true; }
  }
  if (changed) renderSlots();
}

// ---------- Döngü ----------

let slotsT = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  Input.update();

  if (state === 'lobby') {
    lobbyInput();
    slotsT -= dt;
    if (slotsT <= 0) { slotsT = 1; renderSlots(); }   // gamepad takılırsa listede görünsün
  } else if (state === 'playing') {
    const inputs = joined.map(id => Input.state(id));
    acc += dt;
    while (acc >= STEP) { game.step(STEP, inputs); acc -= STEP; }
    $('timer').textContent = fmt(game.t);
    if (game.done) onComplete();
  } else if (state === 'complete') {
    if (now - completeAt > 900 && joined.some(id => Input.pressed(id, 'jump'))) next();
  }

  renderer.draw(game, now / 1000);
  requestAnimationFrame(frame);
}

renderSlots();
requestAnimationFrame(frame);
