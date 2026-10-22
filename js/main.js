'use strict';

// Ekranlar ve oyun döngüsü.
//   Aynı klavye: home → lobby (katılım) → select → playing → complete
//   Online:      home → onlineForm → room (oda + bölüm seçimi) → playing → complete
//   Editör:      home → editor → (dene) playing → complete → editor
// Aynı klavyede simülasyon burada çalışır; online'da sunucuda çalışır, burada yalnızca çizilir.

const $ = id => document.getElementById(id);
let renderer = null;        // sayfa hazır olunca kurulur: 3D (Three.js) ya da 2D yedek
Input.init();

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

// Bölüm kimliğine göre en iyi süre: { kule: 12.3 }. Araya yeni bölüm girse de kayıt kaymaz.
// Misafirken yalnızca bu tarayıcıda durur; giriş yapınca hesaptakiyle birleştirilir (her bölümde en iyi süre kalır).
const V1_ORDER = ['merhaba', 'anahtar', 'kule', 'nobetci', 'agir-kutu', 'hepsi-birden', 'firlatma', 'ucurum', 'metal-anahtar', 'miknatis-ustasi'];
let progress = {};
try {
  progress = JSON.parse(localStorage.getItem('progress-v2') || 'null');
  if (!progress) {
    // Eski kayıt bölüm sırasına göreydi
    progress = {};
    const old = JSON.parse(localStorage.getItem('progress-v1') || '{}');
    for (const [i, secs] of Object.entries(old)) if (V1_ORDER[i]) progress[V1_ORDER[i]] = secs;
  }
} catch (e) { progress = {}; }
function saveProgress() {
  try { localStorage.setItem('progress-v2', JSON.stringify(progress)); } catch (e) { /* yoksay */ }
}
const bestOf = i => progress[LEVELS[i].id];

// Toplanan vidalar: bölüm kimliği → bit maskesi (1., 2., 3. vida). Bölüm bitince kaydedilir, birikir.
let screws = {};
try { screws = JSON.parse(localStorage.getItem('screws-v1') || '{}') || {}; } catch (e) { screws = {}; }
const saveScrews = () => { try { localStorage.setItem('screws-v1', JSON.stringify(screws)); } catch (e) { /* yoksay */ } };
const screwsOf = i => screws[LEVELS[i].id] || 0;
const bitCount = m => (m & 1) + (m >> 1 & 1) + (m >> 2 & 1);
const totalScrews = () => LEVELS.reduce((n, l, i) => n + bitCount(screwsOf(i)), 0);

// Yeni süreyi ve vidaları kaydet; girişliyse hesaba da yaz
function recordProgress(i, secs, mask = 0) {
  const id = LEVELS[i].id, sent = {};
  if (!progress[id] || secs < progress[id]) {
    progress[id] = Math.round(secs * 100) / 100;
    saveProgress();
    sent.levels = { [id]: progress[id] };
  }
  if ((screwsOf(i) | mask) !== screwsOf(i)) {
    screws[id] = screwsOf(i) | mask;
    saveScrews();
    sent.screws = { [id]: screws[id] };
  }
  if (Atolye.me && (sent.levels || sent.screws)) Atolye.api('POST', '/api/progress', sent);
}

// Giriş yapılınca: tarayıcıdaki ilerlemeyi hesaba gönder, hesaptakini geri al
async function syncProgress() {
  if (!Atolye.me) return;
  const r = await Atolye.api('POST', '/api/progress', { levels: progress, screws });
  if (!r.ok || !r.json.levels) return;
  for (const [id, secs] of Object.entries(r.json.levels)) if (!progress[id] || secs < progress[id]) progress[id] = secs;
  for (const [id, m] of Object.entries(r.json.screws || {})) screws[id] = (screws[id] || 0) | m;
  saveProgress();
  saveScrews();
  if (state === 'select') renderLevelGrid();
}

const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Hurdalık haritası ----------
// Bölümler kıvrılan bir patika üzerinde duraklar: her kısım bir satır, satır sonunda yol aşağı kıvrılıp
// ters yöne devam eder. Geçilen duraklar turuncu, sıradaki yeşil ve nabız gibi atar, kilitliler sönük.
const MAP_COLS = 5;
function renderMap(el, { done, pick, canPick = true, compact = false, note = null }) {
  const rowH = compact ? 108 : 142, head = 26, n = LEVELS.length + 1;   // sonda "devamı yakında"
  const rows = Math.ceil(n / MAP_COLS);
  const pts = [];
  for (let k = 0; k < n; k++) {
    const row = Math.floor(k / MAP_COLS), col = k % MAP_COLS, x = row % 2 ? MAP_COLS - 1 - col : col;
    pts.push({ x: (x + 0.5) / MAP_COLS * 1000, y: row * rowH + head + (compact ? 28 : 36) + (x % 2 ? -6 : 6), row });
  }
  // Aynı satırda yumuşak dalga, satır değişince dışarı doğru U dönüşü
  const seg = (a, b) => {
    if (a.row === b.row) { const mx = (a.x + b.x) / 2; return `C ${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`; }
    const out = a.x > 500 ? 95 : -95;
    return `C ${a.x + out} ${a.y} ${b.x + out} ${b.y} ${b.x} ${b.y}`;
  };
  const pathTo = k => pts.slice(0, k + 1).map((p, j) => (j ? seg(pts[j - 1], p) : `M ${p.x} ${p.y}`)).join(' ');
  const open = LEVELS.map((l, i) => levelUnlocked(i, done));
  // Aydınlık yol: yalnızca iki ucu da açık duraklar arasında
  const lit = pts.slice(1, LEVELS.length).map((p, j) => (open[j] && open[j + 1] ? `M ${pts[j].x} ${pts[j].y} ${seg(pts[j], p)}` : '')).join(' ');
  const current = LEVELS.findIndex((l, i) => open[i] && !done.has(l.id));

  const parts = PARTS.map((p, r) => {
    const first = levelIndexById(p.ids[0]), cleared = p.ids.filter(id => done.has(id)).length;
    return `<div class="partHead" style="top:${Math.floor(first / MAP_COLS) * rowH}px"><b>${r + 1}. Kısım</b>${esc(p.name)}<span>${cleared}/${p.ids.length}</span></div>`;
  }).join('');
  const stops = LEVELS.map((l, i) => {
    const p = pts[i], best = bestOf(i);
    const cls = !open[i] ? 'locked' : done.has(l.id) ? 'done' : i === current ? 'current' : 'open';
    return `<button class="stop ${cls}" data-i="${i}" style="left:${p.x / 10}%;top:${p.y}px" title="${i + 1}. ${esc(l.name)}">
      <span class="dot">${open[i] ? i + 1 : icon('lock')}${l.magnet ? `<span class="badge">${icon('magnet')}</span>` : ''}</span>
      <span class="lbl">${esc(l.name)}</span>${best && !compact ? `<span class="time">${icon('check')}${fmt(best)}</span>` : ''}
      ${open[i] && !compact ? `<span class="nuts">${[0, 1, 2].map(k => `<i class="${screwsOf(i) >> k & 1 ? 'got' : ''}"></i>`).join('')}</span>` : ''}
    </button>`;
  }).join('');
  const last = pts[n - 1];
  const soon = `<div class="stop soon" style="left:${last.x / 10}%;top:${last.y}px"><span class="dot">${icon('pack')}</span><span class="lbl">Devamı yakında</span></div>`;

  el.style.height = rows * rowH + 'px';
  el.classList.toggle('readonly', !canPick);
  el.innerHTML = `<svg viewBox="0 0 1000 ${rows * rowH}" preserveAspectRatio="none" aria-hidden="true">
      <path class="trail" d="${pathTo(n - 1)}"/>${lit ? `<path class="trailLit" d="${lit}"/>` : ''}
    </svg>${parts}${stops}${soon}`;
  for (const b of el.querySelectorAll('button.stop')) {
    b.addEventListener('click', () => {
      const i = +b.dataset.i;
      if (!open[i]) {
        b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
        if (note) note.textContent = `Önce ${i}. bölüm "${LEVELS[i - 1].name}" geçilmeli.`;
        return;
      }
      if (canPick) pick(i);
    });
  }
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
  Atolye.loadMe();   // profil kartındaki sayılar güncel kalsın
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
  renderLevelGrid();
}

function renderLevelGrid() {
  const done = new Set(Object.keys(progress));
  const cleared = LEVELS.filter(l => done.has(l.id)).length;
  $('mapCount').innerHTML = `<b>${cleared}</b> / ${LEVELS.length} bölüm · <b>${totalScrews()}</b> / ${LEVELS.length * 3} vida`;
  $('mapBar').style.width = `${(cleared / LEVELS.length) * 100}%`;
  $('mapNote').textContent = '';
  renderMap($('levelGrid'), { done, pick: startLevel, note: $('mapNote') });
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
  playLocal(def, def.name);
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

// Oyun içinde toplanan vidalar (bölümde vida varsa)
let shownScrews = -1;
function updateScrewHud() {
  const el = $('screwHud');
  if (!game || !game.screws || (state !== 'playing' && state !== 'complete')) { if (shownScrews !== -1) { el.classList.add('hidden'); shownScrews = -1; } return; }
  const n = game.screws.length, got = game.screws.filter(s => s.got).length, key = n * 10 + got;
  if (key === shownScrews) return;
  shownScrews = key;
  el.classList.toggle('hidden', !n);
  el.innerHTML = `<span class="nut"></span>${got}/${n}`;
}

function setHud(title, def, rows) {
  $('levelName').textContent = title;
  $('levelHint').textContent = def.hint || 'Arkadaşının yaptığı bölüm. Kolay gelsin!';
  $('controls').innerHTML = rows.map(r => `<span><b style="color:${r.color}">${esc(r.label)}</b>${esc(r.hint)}</span>`).join('');
}

function showComplete(i, secs) {
  state = 'complete';
  completeAt = performance.now();
  const custom = i < 0;
  const prevBest = custom ? 0 : bestOf(i);
  const mask = game && game.screwMask || 0;
  if (!custom) recordProgress(i, secs, mask);
  const lastLevel = custom || i === LEVELS.length - 1;
  $('completeTitle').textContent = lastLevel ? 'Tüm bölümler bitti!' : 'Bölüm tamam!';
  $('completeInfo').innerHTML = `Süre <b>${fmt(secs)}</b>` +
    (prevBest && secs < prevBest ? ' · yeni rekor!' : prevBest ? ` · rekor ${fmt(prevBest)}` : '') +
    (game && game.screws && game.screws.length ? ` · vida <b>${bitCount(mask)}/${game.screws.length}</b>` : '');
  if (custom) $('completeTitle').textContent = 'Bölüm tamam!';
  // Alan 1'in finali: pusula parçası bulundu, pusula ilk kez kıpırdar
  const final = !custom && LEVELS[i].final;
  $('compassScene').classList.toggle('hidden', !final);
  $('toSelectBtn').classList.toggle('hidden', !!final);
  if (final) {
    $('completeTitle').textContent = 'Pusula parçası bulundu!';
    $('completeInfo').innerHTML = `Süre <b>${fmt(secs)}</b><br><span class="partDone">${icon('star')}Alan 1 · Hurdalık tamamlandı</span>
      <br><span class="small">Pusula ilk kez kıpırdadı. İğne kuzeyi, Fabrika'yı gösteriyor…</span>`;
    $('nextBtn').textContent = mode === 'online' ? 'ODAYA DÖN' : 'HARİTA';
  }
  // Kısmın son bölümü ilk kez geçildi: küçük kutlama ve haritada sıradaki kısım açılır
  const part = custom ? -1 : partOf(i);
  if (part >= 0 && !final && !prevBest && PARTS[part].ids[PARTS[part].ids.length - 1] === LEVELS[i].id) {
    $('completeTitle').textContent = `${PARTS[part].name} tamam!`;
    $('completeInfo').innerHTML += `<br><span class="partDone">${icon('star')}${part + 1}. Kısım bitti${PARTS[part + 1] ? ` · sırada <b>${esc(PARTS[part + 1].name)}</b>` : ''}</span>`;
  }
  $('nextBtn').textContent = editorTest ? 'EDİTÖRE DÖN' : lastLevel ? (mode === 'online' ? 'ODAYA DÖN' : 'HARİTA') : 'SONRAKİ BÖLÜM';
  $('toSelectBtn').textContent = editorTest ? 'Tekrar dene' : mode === 'online' ? 'Odaya dön' : 'Harita';
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
  Net.send(Object.assign({ name, done: Object.keys(progress) }, msg));
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
  // Odadakilerden biri bir bölümü açtıysa herkes için açık
  renderMap($('roomMap'), { done: new Set(room.done || []), pick: i => Net.send({ t: 'start', level: i }), canPick: !locked, compact: true, note: $('roomNote') });
  if (room.custom) {
    const b = document.createElement('button');
    b.className = 'lvl custom';
    b.disabled = locked;
    const c = room.custom;
    b.innerHTML = c.total > 1
      ? `<span class="num">${icon('pack')}</span><span>${esc(c.packName || 'Paket')}</span><span class="best">${c.total} bölüm · ${c.index + 1}. sıradan</span>`
      : `<span class="num">${icon('star')}</span><span>${c.magnet ? icon('magnet', 'mag') : ''}${esc(c.name)}</span><span class="best">özel bölüm</span>`;
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
  Predict.reset(game, m.you);
  Net.lastBits = -1;   // yeni bölümde tuş durumu yeni bir sırayla yeniden gönderilsin
  state = 'playing';
  show(null);
  levelIntro(m.def ? 'Kendi bölümün' : `Bölüm ${m.level + 1}`, currentDef.name);
  setHud(m.def ? m.def.name : `${m.level + 1}. ${currentDef.name}`, currentDef, [{ color: PLAYER_COLORS[m.you], label: m.players[m.you].name,
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
  $('onlineError').textContent = 'Oda kur: bölümün odada yıldızla işaretli çıkacak.';
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

// Online oynarken sağ üstte ping
function updatePingHud() {
  const el = $('ping');
  const show = mode === 'online' && (state === 'playing' || state === 'complete') && Net.rtt !== null;
  el.classList.toggle('hidden', !show);
  if (!show) return;
  const ms = Math.round(Net.rtt);
  el.textContent = `${ms} ms`;
  el.className = 'panel ' + (ms < 80 ? 'good' : ms < 150 ? 'ok' : 'bad');
}

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
    const inp = onlineInput();
    Net.sendInput(inp);
    Net.ping(now);
    Predict.step(game, inp, Net.seq, dt);
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

  updatePingHud();
  if (state === 'editor' && Editor.game) game = Editor.game;
  updateScrewHud();
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
// Ayarlar penceresi: ses ve müzik seviyesi, görüntü kalitesi
function renderSettings() {
  for (const k of ['sfx', 'music']) {
    const lvl = Sound.level(k);
    $(k + 'Vol').value = Math.round(lvl * 100);
    $(k + 'Vol').style.setProperty('--fill', Math.round(lvl * 100) + '%');
    $(k + 'Val').textContent = lvl ? `%${Math.round(lvl * 100)}` : 'Kapalı';
    $(k + 'Mute').classList.toggle('off', !lvl);
  }
  $('sfxMute').innerHTML = icon(Sound.level('sfx') ? 'volume' : 'mute');
  const hasQ = !!(renderer && renderer.setQuality);
  $('qualityRow').classList.toggle('hidden', !hasQ);
  if (hasQ) {
    for (const b of $('qualitySeg').children) b.classList.toggle('on', b.dataset.q === renderer.quality);
    $('qualityNote').textContent = renderer.autoLowered ? 'otomatik düşürüldü' : '';
  }
}
function openSettings(open) {
  $('settingsModal').classList.toggle('hidden', !open);
  if (open) renderSettings();
}
$('setOpen').addEventListener('click', () => { Sound.start(); openSettings(true); });
$('setClose').addEventListener('click', () => openSettings(false));
$('settingsModal').addEventListener('pointerdown', e => { if (e.target === $('settingsModal')) openSettings(false); });
for (const k of ['sfx', 'music']) {
  $(k + 'Vol').addEventListener('input', e => { Sound.start(); Sound.setVolume(k, e.target.value / 100); renderSettings(); });
  $(k + 'Mute').addEventListener('click', () => { Sound.start(); Sound.toggle(k); renderSettings(); });
}
for (const b of $('qualitySeg').children) b.addEventListener('click', () => {
  renderer.autoLowered = false;
  renderer.setQuality(b.dataset.q);
  renderSettings();
});
// Pencere açıkken tuşlar oyuna gitmesin; Esc pencereyi kapatır
addEventListener('keydown', e => {
  if ($('settingsModal').classList.contains('hidden')) return;
  if (e.key === 'Escape') { openSettings(false); e.stopImmediatePropagation(); return; }
  if (!$('settingsModal').contains(e.target)) e.stopImmediatePropagation();
}, true);
$('settingsModal').addEventListener('keydown', e => e.stopPropagation());   // kaydırıcının ok tuşları oyuncuyu yürütmesin
$('setOpen').addEventListener('mousedown', e => e.preventDefault());

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
