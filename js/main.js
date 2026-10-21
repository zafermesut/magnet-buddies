'use strict';

// Ekranlar ve oyun döngüsü.
//   Aynı klavye: home → lobby (katılım) → select → playing → complete
//   Online:      home → onlineForm → room (oda + bölüm seçimi) → playing → complete
//   Editör:      home → editor → (dene) playing → complete → editor
// Aynı klavyede simülasyon burada çalışır; online'da sunucuda çalışır, burada yalnızca çizilir.

const $ = id => document.getElementById(id);
let renderer = null;        // sayfa hazır olunca kurulur: 3D (Three.js) ya da 2D yedek
Input.init();

const STEP = 1 / 60;
const SCREENS = ['home', 'lobby', 'select', 'onlineForm', 'room', 'complete', 'editor', 'atolye'];

let mode = 'local';         // local | online
let state = 'home';
let joined = [];            // aynı klavye: katılan giriş kaynakları (katılım sırasıyla)
let game = null;            // menülerde canlı demo sahnesi (menuGame), oyunda oynanan bölüm
let levelIndex = 0;
let acc = 0, last = performance.now(), completeAt = 0;
let room = null;            // online: sunucudan gelen son oda bilgisi
let currentDef = LEVELS[0]; // oynanan bölümün tanımı (hazır ya da kendi bölümün)
let editorTest = false;     // editörden "Dene" ile mi oynanıyor
let pendingCustom = null;   // online odaya götürülecek bölüm(ler): { def, queue, packName }
let customSent = false;

document.title = GAME_TITLE;
for (const el of document.querySelectorAll('.gameTitle')) el.textContent = GAME_TITLE;

// ---------- İlerleme (en iyi süreler) ----------

let progress = {};
try { progress = JSON.parse(localStorage.getItem('progress-v1') || '{}'); } catch (e) { progress = {}; }
function saveProgress() {
  try { localStorage.setItem('progress-v1', JSON.stringify(progress)); } catch (e) { /* yoksay */ }
}

const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function levelButton(i, disabled, onClick) {
  const l = LEVELS[i], best = progress[i];
  const b = document.createElement('button');
  b.className = 'lvl';
  b.disabled = !!disabled;
  b.innerHTML = `<span class="num">${i + 1}</span><span>${l.magnet ? '🧲 ' : ''}${esc(l.name)}</span><span class="best">${best ? '✓ ' + fmt(best) : ''}</span>`;
  b.addEventListener('click', onClick);
  return b;
}

// ---------- Ekran geçişleri ----------

function show(id) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  $('hud').classList.toggle('hidden', id !== null);
  // Editörde bölüm sol paneli açıkta bırakacak şekilde çizilir
  renderer.padLeft = id === 'editor' ? 260 : 0;
  renderer.padTop = id === 'editor' ? 24 : 70;
  if (typeof Atolye !== 'undefined') Atolye.renderAccount();
}

// ---------- Menü arka planı: botların zıplayıp birbirini mıknatısla fırlattığı canlı sahne ----------

const MENU_LEVEL = {
  name: 'Menü', magnet: true, pols: [1, 1, 1],
  map: [
    '############################',
    '#..........................#',
    '#..........................#',
    '#..........................#',
    '#.......#####.......####...#',
    '#..........................#',
    '#..........................#',
    '#...###.............###....#',
    '#..........................#',
    '#..........................#',
    '#.S.........##.......E.....#',
    '############################',
  ],
};
const MENU_STATES = new Set(['home', 'lobby', 'select', 'onlineForm', 'room', 'atolye']);
let demo = null;

function menuGame() {
  if (!demo) {
    demo = new Game(MENU_LEVEL, 3);
    demo.isDemo = true;
    demo.players.forEach(p => { p.noLabel = true; });
    demo.bots = demo.players.map(() => ({ dir: 1, t: Math.random(), jump: false, hold: 0 }));
  }
  return demo;
}

// Basit botlar: rastgele yürür, zıplar; ara sıra biri durup mıknatısını açar ve yakınındakileri fırlatır
function demoInputs(g, dt) {
  return g.players.map((p, i) => {
    const b = g.bots[i];
    b.t -= dt;
    b.hold -= dt;
    if (b.t <= 0) {
      b.t = 0.5 + Math.random() * 1.3;
      b.dir = [-1, 1, 1, -1, 0][Math.random() * 5 | 0];
      b.jump = Math.random() < 0.5;
      if (Math.random() < 0.18) b.hold = 0.6;
    }
    const c = Math.floor((p.x + p.w / 2 + b.dir * (p.w / 2 + 6)) / T), r = Math.floor((p.y + p.h - 1) / T);
    if (b.dir && (g.blocked(c, r) || g.blocked(c, r - 1))) b.jump = true;
    const holding = b.hold > 0;
    return {
      left: !holding && b.dir < 0, right: !holding && b.dir > 0,
      jump: !holding && b.jump && (g.t * 3 + i) % 1 < 0.5, action: holding, swap: false,
    };
  });
}

// Bölüm başlarken: ekran kararıp açılır, bölümün adı büyükçe belirir
function levelIntro(num, name) {
  for (const id of ['fade', 'levelIntro']) {
    const el = $(id);
    el.classList.remove('go');
    void el.offsetWidth;   // animasyonu baştan başlat
    el.classList.add('go');
  }
  $('introNum').textContent = num;
  $('introName').textContent = name;
}

function toHome() {
  Net.close();
  mode = 'local';
  room = null;
  pendingCustom = null;
  editorTest = false;
  Atolye.play = null;
  state = 'home';
  game = menuGame();
  show('home');
}

// ---------- Aynı klavye ----------

function toLobby() {
  mode = 'local';
  state = 'lobby';
  game = menuGame();
  show('lobby');
  renderSlots();
}

function toSelect() {
  if (joined.length < 2) return;
  state = 'select';
  game = menuGame();
  show('select');
  const grid = $('levelGrid');
  grid.innerHTML = '';
  LEVELS.forEach((l, i) => grid.appendChild(levelButton(i, false, () => startLevel(i))));
}

function startLevel(i) {
  editorTest = false;
  levelIndex = i;
  playLocal(LEVELS[i], `${i + 1}. ${LEVELS[i].name}`);
}

// Editörden "Dene" ya da Atölye'den oyna: tek başına deneyen biri iki topu WASD ve ok tuşlarıyla yönetebilir
function startCustom(def, fromAtolye = false) {
  editorTest = !fromAtolye;
  levelIndex = -1;
  mode = 'local';
  if (joined.length < 2) joined = ['wasd', 'arrows'];
  playLocal(def, `★ ${def.name}`);
}

function playLocal(def, title) {
  currentDef = def;
  game = new Game(def === LEVELS[levelIndex] ? levelIndex : def, joined.length);
  acc = 0;
  state = 'playing';
  show(null);
  const ap = !editorTest && Atolye.play;
  levelIntro(levelIndex >= 0 ? `Bölüm ${levelIndex + 1}`
    : ap && ap.pack ? `${ap.pack.name} · ${ap.index + 1}/${ap.pack.levels.length}`
    : ap ? `Atölye · ${ap.level.author.name}` : 'Kendi bölümün', def.name);
  const sources = Input.sources();
  setHud(title, def, joined.map((id, k) => {
    const s = sources.find(x => x.id === id);
    return { color: PLAYER_COLORS[k], label: `${k + 1}P`, hint: s ? s.hint + (game.magnet ? ' · ' + s.magnetHint : '') : '' };
  }));
}

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

// ---------- Ortak: HUD ve bölüm sonu ----------

function setHud(title, def, rows) {
  $('levelName').textContent = title;
  $('levelHint').textContent = def.hint || 'Arkadaşının yaptığı bölüm. Kolay gelsin!';
  $('controls').innerHTML = rows.map(r => `<span><b style="color:${r.color}">${esc(r.label)}</b>${esc(r.hint)}</span>`).join('');
}

function showComplete(i, secs) {
  state = 'complete';
  completeAt = performance.now();
  const custom = i < 0;
  const prevBest = custom ? 0 : progress[i];
  if (!custom && (!prevBest || secs < prevBest)) { progress[i] = secs; saveProgress(); }
  const lastLevel = custom || i === LEVELS.length - 1;
  $('completeTitle').textContent = lastLevel ? 'Tüm bölümler bitti!' : 'Bölüm tamam!';
  $('completeInfo').innerHTML = `Süre <b>${fmt(secs)}</b>` +
    (prevBest && secs < prevBest ? ' · yeni rekor!' : prevBest ? ` · rekor ${fmt(prevBest)}` : '');
  if (custom) $('completeTitle').textContent = 'Bölüm tamam!';
  $('nextBtn').textContent = editorTest ? 'EDİTÖRE DÖN' : lastLevel ? (mode === 'online' ? 'ODAYA DÖN' : 'BÖLÜM SEÇİMİ') : 'SONRAKİ BÖLÜM';
  $('toSelectBtn').textContent = editorTest ? 'Tekrar dene' : mode === 'online' ? 'Odaya dön' : 'Bölüm seçimi';
  // Atölye'den oynanan bölüm: oynanma kaydı, beğen düğmesi, pakette sıradaki bölüm
  $('likeBtn').classList.add('hidden');
  if (mode === 'local' && !editorTest && Atolye.play) {
    Atolye.onComplete();
    $('completeTitle').textContent = Atolye.hasNext() ? 'Bölüm tamam!' : Atolye.play.pack ? 'Paket bitti!' : 'Bölüm tamam!';
    $('nextBtn').textContent = Atolye.hasNext() ? 'SONRAKİ BÖLÜM' : 'ATÖLYE\'YE DÖN';
    $('toSelectBtn').textContent = 'Tekrar oyna';
  }
  $('completeHint').textContent = mode === 'online'
    ? 'Herhangi biriniz devam ettirebilir (zıplama tuşu da olur).'
    : 'Herhangi bir oyuncunun zıplama tuşu da devam ettirir.';
  setTimeout(() => { if (state === 'complete') show('complete'); }, 700);
}

function next() {
  if (mode === 'online') { Net.send({ t: 'next' }); return; }
  if (editorTest) toEditor();
  else if (Atolye.play) Atolye.next();
  else if (levelIndex < LEVELS.length - 1) startLevel(levelIndex + 1);
  else toSelect();
}

function backToChooser() {
  if (mode === 'online') Net.send({ t: 'lobby' });
  else if (editorTest) toEditor();
  else if (Atolye.play) Atolye.back();
  else toSelect();
}

function restart() {
  if (mode === 'online') Net.send({ t: 'restart' });
  else if (editorTest) startCustom(currentDef);
  else if (Atolye.play) startCustom(currentDef, true);
  else startLevel(levelIndex);
}

// ---------- Editör ----------

function toEditor(note) {
  Net.close();
  mode = 'local';
  editorTest = false;
  state = 'editor';
  if (!Editor.level) Editor.loadSaved();
  show('editor');
  if (note) $('edErrors').innerHTML = `<div class="note">${esc(note)}</div>` + $('edErrors').innerHTML;
}

// ---------- Online ----------

function myName() { return $('onlineName').value.trim(); }

function toOnlineForm(err) {
  Net.close();
  mode = 'online';
  room = null;
  editorTest = false;
  customSent = false;
  state = 'onlineForm';
  game = menuGame();
  show('onlineForm');
  $('onlineError').textContent = err || (Net.available() ? '' : 'Online oynamak için oyunu sunucudan açmalısın (npm start).');
  try { if (!$('onlineName').value) $('onlineName').value = localStorage.getItem('name') || ''; } catch (e) { /* yoksay */ }
  ($('onlineName').value ? $('createBtn') : $('onlineName')).focus();
}

async function goOnline(msg) {
  const name = myName();
  if (!name) { $('onlineError').textContent = 'Önce bir takma ad yaz.'; $('onlineName').focus(); return; }
  try { localStorage.setItem('name', name); } catch (e) { /* yoksay */ }
  $('onlineError').textContent = 'Bağlanıyor…';
  try {
    await Net.connect();
  } catch (e) {
    $('onlineError').textContent = 'Sunucuya bağlanılamadı.';
    return;
  }
  $('onlineError').textContent = '';
  Net.send(Object.assign({ name }, msg));
}

// Kurucu oyunu localhost'tan açtıysa link arkadaşlarda çalışmaz; yerel ağ adresiyle değiştir
let shareOrigin = location.origin;
if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
  fetch('/info').then(r => r.json()).then(info => {
    if (info.lan && info.lan.length) {
      shareOrigin = `${location.protocol}//${info.lan[0]}:${location.port || info.port}`;
      renderRoom();
    }
  }).catch(() => { /* sunucu yoksa olduğu gibi kalır */ });
}

function renderRoom() {
  if (!room) return;
  const isHost = room.host === room.you;
  $('roomCode').textContent = room.code;
  $('roomLink').value = `${shareOrigin}${location.pathname}?oda=${room.code}`;
  let html = '';
  for (let k = 0; k < 4; k++) {
    const m = room.members[k];
    if (m) {
      html += `<div class="member" style="border-color:${PLAYER_COLORS[k]}">
        <div class="ball" style="background:${PLAYER_COLORS[k]}"></div>
        <b>${esc(m.name)}${m.id === room.you ? ' (sen)' : ''}</b>
        <span class="tag">${m.id === room.host ? 'oda kurucusu' : room.state !== 'lobby' && !m.playing ? 'sonraki bölümde' : ''}</span></div>`;
    } else {
      html += '<div class="member empty">boş</div>';
    }
  }
  $('roomMembers').innerHTML = html;
  const enough = room.members.length >= 2;
  $('roomNote').textContent = !enough ? 'Arkadaşın linkle katılınca bölüm seçebilirsiniz.'
    : room.state !== 'lobby' ? 'Arkadaşların oynuyor; bir sonraki bölümde sen de katılacaksın.'
    : isHost ? 'Bir bölüm seç.' : 'Oda kurucusu bölüm seçiyor…';
  const grid = $('roomLevels');
  grid.innerHTML = '';
  const locked = !isHost || !enough || room.state !== 'lobby';
  LEVELS.forEach((l, i) => grid.appendChild(levelButton(i, locked, () => Net.send({ t: 'start', level: i }))));
  if (room.custom) {
    const b = document.createElement('button');
    b.className = 'lvl custom';
    b.disabled = locked;
    const c = room.custom;
    b.innerHTML = c.total > 1
      ? `<span class="num">📦</span><span>${esc(c.packName || 'Paket')}</span><span class="best">${c.total} bölüm · ${c.index + 1}. sıradan</span>`
      : `<span class="num">★</span><span>${c.magnet ? '🧲 ' : ''}${esc(c.name)}</span><span class="best">özel bölüm</span>`;
    b.addEventListener('click', () => Net.send({ t: 'start', custom: true }));
    grid.appendChild(b);
  }
}

Net.on('room', m => {
  room = m;
  // Editörden gelen kurucu kendi bölümünü odaya yükler (sunucu doğrular)
  if (pendingCustom && !customSent && m.host === m.you) {
    customSent = true;
    Net.send({ t: 'custom', def: pendingCustom.def, queue: pendingCustom.queue, packName: pendingCustom.packName });
  }
  history.replaceState(null, '', `${location.pathname}?oda=${m.code}`);
  if (m.state === 'lobby' || (state !== 'playing' && state !== 'complete')) {
    if (state !== 'room') { state = 'room'; game = menuGame(); show('room'); }
  }
  renderRoom();
});

Net.on('start', m => {
  levelIndex = m.level;
  if (m.you < 0) { state = 'room'; game = menuGame(); show('room'); renderRoom(); return; }   // bu bölümü izliyor
  currentDef = m.def || LEVELS[m.level];
  game = new Game(m.def || m.level, m.players.length);
  game.players.forEach((p, i) => { p.name = m.players[i].name; p.isMe = i === m.you; });
  state = 'playing';
  show(null);
  levelIntro(m.def ? 'Kendi bölümün' : `Bölüm ${m.level + 1}`, currentDef.name);
  setHud(m.def ? `★ ${m.def.name}` : `${m.level + 1}. ${currentDef.name}`, currentDef, [{ color: PLAYER_COLORS[m.you], label: m.players[m.you].name,
    hint: 'A D / ← → yürü · W / ↑ zıpla · S / ↓ eylem' + (game.magnet ? ' (basılı: mıknatıs) · E / sağ Shift kutup' : '') }]);
});

Net.on('s', s => { if (state === 'playing' || state === 'complete') applySnapshot(game, s); });
Net.on('complete', m => { if (state === 'playing') showComplete(m.level, m.time); });
Net.on('error', m => {
  if (room) { $('roomNote').textContent = m.msg; return; }   // odadayken (ör. bölüm reddedildi) odada kal
  $('onlineError').textContent = m.msg;
  Net.close();
});
Net.on('close', () => { if (mode === 'online') toOnlineForm('Bağlantı koptu. Tekrar katılabilirsin.'); });

// Aynı klavyedeki bütün şemalar ve ilk gamepad tek oyuncuyu yönetir
function onlineInput() {
  const out = { left: false, right: false, jump: false, action: false, swap: false };
  for (const s of Input.sources()) {
    const i = Input.state(s.id);
    for (const k in out) out[k] = out[k] || !!i[k];
  }
  return out;
}

// ---------- Düğmeler ve tuşlar ----------

$('homeOnline').addEventListener('click', () => toOnlineForm());
$('homeLocal').addEventListener('click', toLobby);
$('homeEditor').addEventListener('click', () => toEditor());
$('edBack').addEventListener('click', toHome);
$('edTest').addEventListener('click', () => startCustom(Editor.def()));
$('edOnline').addEventListener('click', () => {
  pendingCustom = { def: Editor.def(), queue: [Editor.def()] };
  customSent = false;
  toOnlineForm();
  $('onlineError').textContent = 'Oda kur: bölümün odada ★ ile çıkacak.';
});
$('lobbyBack').addEventListener('click', toHome);
$('startBtn').addEventListener('click', toSelect);
$('backBtn').addEventListener('click', toLobby);
$('nextBtn').addEventListener('click', next);
$('toSelectBtn').addEventListener('click', () => (editorTest || (mode === 'local' && Atolye.play) ? restart() : backToChooser()));
$('onlineBack').addEventListener('click', toHome);
$('createBtn').addEventListener('click', () => goOnline({ t: 'create' }));
$('joinBtn').addEventListener('click', () => goOnline({ t: 'join', code: $('joinCode').value }));
$('roomLeave').addEventListener('click', () => { history.replaceState(null, '', location.pathname); toHome(); });
$('copyBtn').addEventListener('click', async () => {
  const input = $('roomLink');
  try { await navigator.clipboard.writeText(input.value); } catch (e) { input.select(); document.execCommand('copy'); }
  $('copyBtn').textContent = 'Kopyalandı!';
  setTimeout(() => { $('copyBtn').textContent = 'Kopyala'; }, 1500);
});
$('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });
$('onlineName').addEventListener('keydown', e => {
  if (e.key === 'Enter') ($('joinCode').value.length === 4 ? $('joinBtn') : $('createBtn')).click();
});

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (state === 'lobby' && e.code === 'Enter') toSelect();
  else if (state === 'select') {
    if (e.code === 'Escape') toLobby();
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= LEVELS.length) startLevel(n - 1);
  } else if (state === 'playing') {
    if (e.code === 'KeyR') restart();
    if (e.code === 'Escape') backToChooser();
  } else if (state === 'complete') {
    if (e.code === 'Enter') next();
    if (e.code === 'Escape') backToChooser();
  }
});

// ---------- Döngü ----------

let slotsT = 0, shownQuality;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  Input.update();

  if (state === 'lobby') {
    lobbyInput();
    acc += dt;
    while (acc >= STEP) { game.step(STEP, demoInputs(game, STEP)); acc -= STEP; }
    slotsT -= dt;
    if (slotsT <= 0) { slotsT = 1; renderSlots(); }   // gamepad takılırsa listede görünsün
  } else if (state === 'playing' && mode === 'local') {
    const inputs = joined.map(id => Input.state(id));
    acc += dt;
    while (acc >= STEP) { game.step(STEP, inputs); acc -= STEP; }
    $('timer').textContent = fmt(game.t);
    if (game.done) showComplete(levelIndex, game.doneT);
  } else if (state === 'playing' && mode === 'online') {
    Net.sendInput(onlineInput());
    smoothNet(game, dt);
    $('timer').textContent = fmt(game.t);
  } else if (MENU_STATES.has(state) && game && game.isDemo) {
    acc += dt;
    while (acc >= STEP) { game.step(STEP, demoInputs(game, STEP)); acc -= STEP; }
  } else if (state === 'complete') {
    if (mode === 'online') smoothNet(game, dt);
    const anyJump = mode === 'online' ? Input.sources().some(s => Input.pressed(s.id, 'jump')) : joined.some(id => Input.pressed(id, 'jump'));
    if (now - completeAt > 900 && anyJump) { completeAt = now + 1e9; next(); }
  }

  if (state === 'editor' && Editor.game) game = Editor.game;
  if (renderer.quality !== shownQuality) { shownQuality = renderer.quality; renderSettings(); }   // otomatik düşürülmüş olabilir
  if (state === 'playing' || state === 'complete') Sound.processEffects(game);
  else Sound.setHum(false);
  renderer.draw(game, now / 1000);
  if (state === 'editor') Editor.drawOverlay(renderer.overlayCtx);
  requestAnimationFrame(frame);
}

// Linkle gelen: ?oda=KOD (online odaya katıl) ya da ?bolum=... (paylaşılan bölümü aç).
// editor.js bu dosyadan sonra yüklendiği için açılış, sayfa hazır olunca yapılır.
// Ayar düğmeleri: ses efektleri, müzik, görüntü kalitesi (3D'de)
function renderSettings() {
  $('setSfx').classList.toggle('off', !Sound.settings.sfx);
  $('setMusic').classList.toggle('off', !Sound.settings.music);
  $('setQuality').classList.toggle('hidden', !renderer || !renderer.setQuality);
  if (renderer && renderer.setQuality) {
    $('setQuality').classList.toggle('off', renderer.quality !== 'high');
    $('setQuality').title = renderer.quality === 'high' ? 'Görüntü kalitesi: yüksek' : 'Görüntü kalitesi: düşük (daha akıcı)';
  }
}
$('setSfx').addEventListener('click', () => { Sound.start(); Sound.toggle('sfx'); renderSettings(); });
$('setMusic').addEventListener('click', () => { Sound.start(); Sound.toggle('music'); renderSettings(); });
$('setQuality').addEventListener('click', () => {
  renderer.setQuality(renderer.quality === 'high' ? 'low' : 'high');
  renderSettings();
});
for (const b of document.querySelectorAll('#settings button')) b.addEventListener('mousedown', e => e.preventDefault());

function createRenderer() {
  if (window.Renderer3D && !new URLSearchParams(location.search).has('2d')) {
    try {
      return new window.Renderer3D($('game'), $('overlay'));
    } catch (e) {
      console.warn('3D çizim başlatılamadı, 2D kullanılıyor:', e);
    }
  }
  $('overlay').classList.add('hidden');
  return new Renderer($('game'));
}

addEventListener('DOMContentLoaded', () => {
  renderer = createRenderer();
  renderSettings();
  const params = new URLSearchParams(location.search);
  const linkCode = params.get('oda'), shared = params.get('bolum');
  Atolye.loadMe();
  if (params.get('b') || params.get('p') || params.has('atolye')) {
    // Atölye linkleri: ?b=bölüm, ?p=paket, ?atolye[=sekme]
    history.replaceState(null, '', location.pathname);
    Atolye.open(params.get('atolye') || 'new');
    if (params.get('b')) Atolye.openLevel(params.get('b'));
    else if (params.get('p')) Atolye.openPack(params.get('p'));
  } else if (params.has('editor')) {
    history.replaceState(null, '', location.pathname);
    toEditor();
  } else if (linkCode) {
    toOnlineForm();
    $('joinCode').value = linkCode.toUpperCase().slice(0, 4);
    $('onlineError').textContent = $('onlineName').value ? '' : 'Takma adını yaz ve Katıl\'a bas.';
    ($('onlineName').value ? $('joinBtn') : $('onlineName')).focus();
  } else if (shared) {
    const def = decodeLevel(shared);
    history.replaceState(null, '', location.pathname);
    if (def) { Editor.load(def); toEditor('Arkadaşının bölümü açıldı. DENE ile oyna ya da online odaya götür.'); }
    else { toHome(); }
  } else {
    toHome();
  }
  requestAnimationFrame(frame);
});
