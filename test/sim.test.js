// Başsız fizik ve bölüm testleri: node test/sim.test.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { console, Math, Map, Set, btoa, atob, TextEncoder, TextDecoder, Uint8Array };
vm.createContext(ctx);
for (const f of ['config.js', 'levels.js', 'game.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx);
}
vm.runInContext(`
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failed++; };
const DT = 1 / 60;
const I = (o = {}) => Object.assign({ left: false, right: false, jump: false, action: false }, o);

// Oyuncu başına bir kontrol fonksiyonu (g, p, t) -> giriş ile çalıştır
function run(g, ctrls, secs, until) {
  for (let i = 0; i < secs * 60; i++) {
    g.step(DT, g.players.map((p, k) => (ctrls[k] ? ctrls[k](g, p, g.t) : I())));
    if (until && until(g)) return true;
  }
  return false;
}
// Hedef x'e git; engel/çukur varsa zıpla
const goTo = (x, opts = {}) => (g, p, t) => {
  const cx = p.x + p.w / 2, d = x - cx;
  if (Math.abs(d) < 6) return I({ jump: !!opts.hopAtEnd && (t * 4 | 0) % 2 === 0 });
  const dir = Math.sign(d);
  const c = Math.floor((cx + dir * (p.w / 2 + 12)) / T), r = Math.floor((p.y + p.h - 1) / T);
  const probe = { x: p.x + dir * 4, y: p.y, w: p.w, h: p.h };
  const body = g.solids.some(o => o !== p && overlap(probe, o));
  const wall = g.blocked(c, r) || g.blocked(c, r - 1) || body;
  const pit = !g.blocked(c, r + 1) && !g.blocked(c + dir, r + 1) && r + 1 >= g.rows - 1;
  return I({ right: dir > 0, left: dir < 0, jump: (wall || pit) && (t * 6 | 0) % 2 === 0 });
};
const idle = () => I();

console.log('Bölümler');
LEVELS.forEach((l, i) => {
  const g = new Game(i, 2);
  ok(g.spawn && g.exit && new Set(l.map.map(r => r.length)).size === 1, (i + 1) + '. ' + l.name + ': ayrıştırıldı, başlangıç ve çıkış var');
});

console.log('Kendi bölümün');
{
  ok(LEVELS.every(l => validateLevel(l).length === 0), 'bütün hazır bölümler doğrulamadan geçer');
  const same = LEVELS.every(l => {
    const d = decodeLevel(encodeLevel(l));
    return d && d.name === l.name && d.magnet === !!l.magnet && d.map.join('|') === l.map.join('|');
  });
  ok(same, 'linke sığdırılıp geri açılan bölüm birebir aynı');
  const longest = Math.max(...LEVELS.map(l => encodeLevel(l).length));
  ok(longest < 600, 'bölüm linki kısa (en uzunu ' + longest + ' karakter)');
  const base = { name: 'Deneme', map: LEVELS[0].map.slice() };
  const bad = [
    ['başlangıç yok', Object.assign({}, base, { map: base.map.map(r => r.replace(/S/g, '.')) })],
    ['iki çıkış', Object.assign({}, base, { map: base.map.map((r, i) => (i === 5 ? '#E' + r.slice(2) : r)) })],
    ['satırlar farklı uzunlukta', Object.assign({}, base, { map: base.map.map((r, i) => (i === 3 ? r + '.' : r)) })],
    ['bilinmeyen karo', Object.assign({}, base, { map: base.map.map((r, i) => (i === 3 ? 'X' + r.slice(1) : r)) })],
    ['kutuya yer yok', Object.assign({}, base, { map: base.map.map((r, i) => (i === 10 ? r.slice(0, 5) + 'H' + r.slice(6) : r)) })],
    ['ad yok', Object.assign({}, base, { name: '' })],
  ];
  for (const [why, def] of bad) ok(validateLevel(def).length > 0, 'geçersiz bölüm reddedilir: ' + why);
  ok(decodeLevel('bozuk-link') === null, 'bozuk link güvenle reddedilir');
  const g = new Game({ name: 'Deneme', map: LEVELS[0].map, magnet: true }, 2);
  ok(g.levelIndex === -1 && g.magnet && g.players.length === 2 && g.exit, 'kendi bölüm nesnesiyle oyun kurulur');
}

console.log('Fizik');
{
  const g = new Game(0, 1); const p = g.players[0];
  run(g, [idle], 0.5);
  const floorY = p.y; let minY = p.y;
  run(g, [(g, p, t) => I({ jump: t < 1 })], 1, g => { minY = Math.min(minY, p.y); return false; });
  const h = floorY - minY;
  ok(h > 2 * T && h < 3 * T, 'tek başına zıplama 2 karoyu aşar, 3 karoyu aşamaz (' + h.toFixed(0) + ' px)');
}
{
  const g = new Game(0, 2); const [a, b] = g.players;
  run(g, [idle, idle], 0.3);
  b.x = a.x; b.y = a.y - b.h - 2;
  run(g, [idle, idle], 3);
  ok(b.supported && b.ground === a && Math.abs(b.x - a.x) < 0.5, 'üstteki oyuncu 3 sn boyunca kaymadan durur');
  run(g, [idle, idle], 0.4);
  let minB = b.y, startB = b.y;
  run(g, [(g, p, t) => I({ jump: true }), idle], 0.6, () => { minB = Math.min(minB, b.y); return false; });
  ok(startB - minB > 80, 'alttaki zıplayınca üstteki de kalkar (' + (startB - minB).toFixed(0) + ' px)');
  run(g, [idle, idle], 1);
  const ax = a.x;
  run(g, [(g, p) => I({ right: true }), idle], 0.5);
  ok(Math.abs((b.x - a.x)) < 1 && a.x > ax + 50, 'üstteki, alttaki yürüyünce onunla taşınır');
}
{
  const g = new Game(4, 2); const box = g.boxes[0]; const bx = box.x;
  run(g, [(g, p) => I({ right: true }), idle], 3);
  ok(Math.abs(box.x - bx) < 1, 'ağır kutu tek kişiyle kıpırdamaz');
  run(g, [(g, p) => I({ right: true }), (g, p) => I({ right: true })], 3);
  ok(box.x > bx + 100, 'iki kişi arka arkaya itince kutu kayar (' + (box.x - bx).toFixed(0) + ' px)');
}

console.log('Bölümleri otomatik geçme');
{
  // 1. Merhaba: ikisi de sağa gider, engelde/çukurda zıplar
  const g = new Game(0, 2), ex = g.exit.x + g.exit.w / 2;
  ok(run(g, [goTo(ex), goTo(ex)], 20, g => g.done), '1. Merhaba geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // 2. Anahtar: A anahtarı alır, kapıya götürür; sonra ikisi çıkışa
  const g = new Game(1, 2), ex = g.exit.x + g.exit.w / 2, key = g.keys[0];
  const keyX = key.x + key.w / 2;
  const a = (g, p, t) => (!key.used && key.holder !== p ? goTo(keyX, { hopAtEnd: true })(g, p, t) : goTo(ex)(g, p, t));
  const b = (g, p, t) => (g.doors[0].open ? goTo(ex)(g, p, t) : idle());
  ok(run(g, [a, b], 30, g => g.done), '2. Anahtar geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // 3. Kule: A çıkıntının yanında bekler, B onun üstüne çıkıp çıkıntıya zıplar, anahtarı alır
  const g = new Game(2, 2), ex = g.exit.x + g.exit.w / 2, key = g.keys[0];
  const baseX = 7 * T + 10;
  let phase = 0;
  const a = (g, p, t) => (g.doors[0].open ? goTo(ex)(g, p, t) : goTo(baseX)(g, p, t));
  const b = (g, p, t) => {
    if (g.doors[0].open) return goTo(ex)(g, p, t);
    if (key.holder === p) return goTo(g.doors[0].cells[0].c * T)(g, p, t);
    const A = g.players[0];
    if (p.supported && p.y + p.h <= 8 * T + 1) return goTo(key.x + key.w / 2)(g, p, t);   // çıkıntıda: anahtara yürü
    if (p.ground !== A && p.y > 8 * T) {   // önce A'nın üstüne çık
      const d = A.x - p.x;
      return I({ right: d > 4, left: d < -4, jump: Math.abs(d) < 45 && (t * 5 | 0) % 2 === 0 });
    }
    // A'nın üstünden dümdüz zıpla, çıkıntının üstüne çıkınca sola kay
    return I({ left: p.y + p.h < 8 * T || p.ground !== A && p.vy >= 0 && p.y < 7 * T, jump: (p.ground === A && (t * 5 | 0) % 2 === 0) || p.vy < 0 });
  };
  ok(run(g, [a, b], 40, g => g.done), '3. Kule geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // 4. Nöbetçi: A sol düğmede bekler, B geçip sağ düğmeye basar, A geçer
  const g = new Game(3, 2), ex = g.exit.x + g.exit.w / 2;
  const [b1, b2] = g.buttons;
  const gateX = g.gates[0].cells[0].c * T;
  const a = (g, p, t) => (b2.pressed || p.x > gateX ? goTo(ex)(g, p, t) : goTo(b1.x + b1.w / 2)(g, p, t));
  const b = (g, p, t) => {
    if (g.players[0].x > b2.x + 20 || g.players[0].inExit) return goTo(ex)(g, p, t);
    return b1.pressed ? goTo(b2.x + b2.w / 2)(g, p, t) : idle();
  };
  ok(run(g, [a, b], 40, g => g.done), '4. Nöbetçi geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // 5. Ağır kutu: ikisi birlikte iter, kutunun üstünden duvara çıkarlar
  const g = new Game(4, 2), ex = g.exit.x + g.exit.w / 2, box = g.boxes[0];
  const c = (g, p, t) => (box.x + box.w < 20 * T - 2 ? I({ right: true }) : goTo(ex)(g, p, t));
  ok(run(g, [c, c], 40, g => g.done), '5. Ağır kutu geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // 6. Hepsi birden: kutuyu duvara it → üst kata çık → kule ile anahtar → kapı → düğmelerle geçiş → çıkış
  const g = new Game(5, 2), ex = g.exit.x + g.exit.w / 2, box = g.boxes[0], key = g.keys[0], door = g.doors[0];
  const [b1, b2] = g.buttons, gateX = g.gates[0].cells[0].c * T;
  const ledgeR = 24 * T;            // anahtar çıkıntısının sağ kenarı
  const baseX = ledgeR + 30;         // A'nın kule için durduğu yer
  const boxDone = () => box.x + box.w >= 14 * T - 1;
  const A = g.players[0], B = g.players[1];
  const a = (g, p, t) => {
    if (!boxDone()) return I({ right: true });
    if (!door.open) return goTo(baseX)(g, p, t);
    if (b2.pressed || p.x > gateX) return goTo(ex)(g, p, t);
    return goTo(b1.x + b1.w / 2)(g, p, t);
  };
  const b = (g, p, t) => {
    if (!boxDone()) return I({ right: true });
    if (door.open) {
      if (A.x > b2.x + 20 || A.inExit) return goTo(ex)(g, p, t);
      return b1.pressed || p.x > gateX + T ? goTo(b2.x + b2.w / 2)(g, p, t) : goTo(b1.x - 60)(g, p, t);
    }
    if (key.holder === p) return goTo(door.cells[0].c * T)(g, p, t);
    if (p.supported && p.y + p.h <= 5 * T + 1) return goTo(key.x + key.w / 2)(g, p, t);   // çıkıntıda
    if (p.x < 14 * T || p.y + p.h > 8 * T + 1) return goTo(14 * T + 60)(g, p, t);          // önce üst kata çık
    if (Math.abs(A.x - baseX + A.w / 2) > 12 || !A.supported) return idle();               // A yerine geçsin
    if (p.ground !== A && p.y + p.h > 5 * T) {
      const d = A.x - p.x;
      return I({ right: d > 4, left: d < -4, jump: Math.abs(d) < 45 && (t * 5 | 0) % 2 === 0 });
    }
    return I({ left: p.y + p.h < 5 * T, jump: (p.ground === A && (t * 5 | 0) % 2 === 0) || p.vy < 0 });
  };
  ok(run(g, [a, b], 60, g => g.done), '6. Hepsi birden geçildi (' + g.t.toFixed(1) + ' sn)');
}

console.log('Mıknatıs');
// B, A'nın üstüne çıkar (A yerinde dururken)
const climbOn = A => (g, p, t) => {
  const d = A.x - p.x;
  return I({ right: d > 4, left: d < -4, jump: Math.abs(d) < 45 && p.ground !== A && (t * 5 | 0) % 2 === 0 });
};
{
  // Fırlatma: üstteki, alttakinin mıknatısıyla 5 karodan yükseğe çıkar
  const g = new Game(6, 2); const [a, b] = g.players;
  run(g, [idle, idle], 0.3);
  b.x = a.x; b.y = a.y - b.h - 1;
  run(g, [idle, idle], 0.5);
  const y0 = b.y; let minY = b.y;
  run(g, [() => I({ action: true }), idle], 1.5, () => { minY = Math.min(minY, b.y); return false; });
  ok(y0 - minY > 5 * T, 'aynı kutup: alttaki mıknatısı açınca üstteki 5 karodan yükseğe fırlar (' + (y0 - minY).toFixed(0) + ' px)');
}
{
  // Çekme: duvarın üstündeki, aşağıdaki zıt kutuplu arkadaşını yukarı çeker
  const g = new Game(6, 2); const [a, b] = g.players;
  b.x = 18 * T + 4; b.y = 6 * T - b.h; b.pol = -a.pol;   // B duvarın kenarında
  a.x = 16 * T; a.y = 11 * T - a.h;
  run(g, [idle, idle], 0.3);
  let minY = a.y;
  run(g, [(g, p, t) => I({ jump: (t * 4 | 0) % 2 === 0, right: p.y + p.h < 6 * T + 4 }), () => I({ action: true })], 3,
    () => { minY = Math.min(minY, a.y); return false; });
  ok(a.supported && a.y + a.h <= 6 * T + 1, 'zıt kutup: yukarıdaki arkadaş aşağıdakini duvarın üstüne çeker');
}
{
  // Üstteki zıt kutupta mıknatısı açınca ikisi birlikte uçmamalı (alttaki üsttekini kaldıramaz)
  const g = new Game(6, 2); const [a, b] = g.players;
  run(g, [idle, idle], 0.3);
  b.x = a.x; b.y = a.y - b.h - 1; b.pol = -a.pol;
  run(g, [idle, idle], 0.5);
  const ya = a.y, yb = b.y; let minA = a.y, minB = b.y;
  run(g, [idle, () => I({ action: true })], 2, () => { minA = Math.min(minA, a.y); minB = Math.min(minB, b.y); return false; });
  ok(ya - minA < 5 && yb - minB < 5, 'üstteki zıt kutupta çekince ikisi birlikte uçmaz (yükselme ' + (ya - minA).toFixed(0) + ' / ' + (yb - minB).toFixed(0) + ' px)');
}
{
  // Anahtar her iki kutba da çekilir
  for (const pol of [1, -1]) {
    const g = new Game(8, 2); const [a] = g.players; const key = g.keys[0];
    a.pol = pol;
    a.x = 10 * T + 3;
    run(g, [(g, p, t) => I({ action: true, jump: (t * 3 | 0) % 2 === 0 }), idle], 4, () => key.holder === a);
    ok(key.holder === a, 'anahtar ' + (pol > 0 ? '+' : '−') + ' kutupla mıknatısa çekilip alınır');
  }
}
{
  // Mıknatıssız bölümlerde eylem tuşunu basılı tutmak bir şey yapmaz
  const g = new Game(0, 2); const [a, b] = g.players; const bx = b.x;
  run(g, [() => I({ action: true }), idle], 1);
  ok(Math.abs(b.x - bx) < 1, 'mıknatıssız bölümde mıknatıs çalışmaz');
}

// Mıknatıslı bölümleri geçme senaryoları
// Uçurumu geçiş: B kenardan zıplar, A arkasından iter; karşıda B kutup değiştirip A'yı çeker
function crossPit(g, A, B, edgeX, farX, done) {
  let swapped = false;
  const a = (g, p, t) => {
    if (done()) return null;
    if (B.x > farX - 10) {   // B karşıda: kenardan zıpla, çekilmeyi bekle
      const cx = p.x + p.w / 2;
      if (cx < edgeX - 6 && p.supported && p.x < farX) return I({ right: true });
      return I({ right: true, jump: true });
    }
    // B'nin hemen arkasında dur, B havalanınca it
    const target = B.x - p.w - 2;
    if (!B.supported && B.x > p.x) return I({ action: true });
    return I({ right: p.x < target - 2, left: p.x > target + 2 });
  };
  const b = (g, p, t) => {
    if (done()) return null;
    if (p.x > farX - 10 && p.supported) {
      if (!swapped) { swapped = true; return I({ swap: true }); }
      const cx = p.x + p.w / 2, at = farX + 20;
      if (Math.abs(cx - at) > 8) return I({ right: cx < at, left: cx > at });
      return I({ action: A.x < farX - 10 });
    }
    const cx = p.x + p.w / 2;
    if (!p.supported) return I({ right: true, jump: p.vy < 0 });
    if (cx < edgeX - 24) return I({ right: true });
    // Kenarda: A hemen arkaya gelince zıpla
    return A.x + A.w >= p.x - 6 ? I({ right: true, jump: true }) : idle();
  };
  return [a, b];
}
// Duvar aşma: B, A'nın üstüne çıkar; A fırlatır; yukarıda B kutup değiştirip A'yı çeker
function climbWall(g, A, B, standX, wallX, topY, done) {
  const onTop = p => p.supported && p.y + p.h <= topY + 1 && p.x + p.w > wallX;
  const a = (g, p, t) => {
    if (done()) return null;
    if (onTop(B)) {
      if (onTop(p)) return null;
      const cx = p.x + p.w / 2, at = wallX - 60;
      if (p.y + p.h < topY + 4) return I({ right: true, jump: true });
      if (Math.abs(cx - at) > 8 && p.supported) return I({ right: cx < at, left: cx > at });
      // Duvarın kenarında B'ye yapışıkken ondan destek alıp zıpla ve üste geç
      return I({ jump: (t * 5 | 0) % 2 === 0 || p.vy < 0, right: p.y + p.h < topY + 40 && !p.supported });
    }
    const cx = p.x + p.w / 2;
    if (Math.abs(cx - standX) > 6) return I({ right: cx < standX, left: cx > standX });
    return I({ action: B.ground === p || (!B.supported && B.y < p.y) });
  };
  const b = (g, p, t) => {
    if (done()) return null;
    // Fırlatılmak için A ile aynı kutupta, yukarıdan çekmek için zıt kutupta olmalı
    const wantPol = onTop(p) ? -A.pol : A.pol;
    if (p.pol !== wantPol) return I({ swap: (t * 10 | 0) % 2 === 0 });
    if (onTop(p)) {
      if (onTop(A)) return null;
      const cx = p.x + p.w / 2, at = wallX + 20;
      if (Math.abs(cx - at) > 8) return I({ right: cx < at, left: cx > at });
      return I({ action: true, right: A.y + A.h < topY });
    }
    if (p.y + p.h < topY + 20 || (!p.supported && p.vy < 0 && p.y < A.y - T)) return I({ right: true });
    if (p.ground === A) return idle();
    return climbOn(A)(g, p, t);
  };
  return [a, b];
}
// Senaryoları sırayla çalıştır; bir aşama null dönerse sonrakine geç
function phases(list) {
  let i = 0;
  return list[0].map((_, k) => (g, p, t) => {
    while (i < list.length) {
      const r = list[i][k](g, p, t);
      if (r) return r;
      if (list[i].every((f, j) => f(g, g.players[j], t) === null)) i++;
      else return I();
    }
    return I();
  });
}
{
  const g = new Game(6, 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2;
  const both = () => [A, B].every(p => p.supported && p.y + p.h <= 6 * T + 1);
  const ctl = phases([climbWall(g, A, B, 16 * T, 18 * T, 6 * T, both), [goTo(ex), goTo(ex)]]);
  ok(run(g, ctl, 40, g => g.done), '7. Fırlatma geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  const g = new Game(7, 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2;
  const across = () => A.x > 18 * T - 10 && B.x > 18 * T - 10 && A.supported;
  const ctl = phases([crossPit(g, A, B, 12 * T, 18 * T, across), [goTo(ex), goTo(ex)]]);
  ok(run(g, ctl, 40, g => g.done), '8. Uçurum geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  const g = new Game(8, 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, key = g.keys[0], door = g.doors[0];
  const a = (g, p, t) => {
    if (door.open) return goTo(ex)(g, p, t);
    if (key.holder === p) return goTo(door.cells[0].c * T)(g, p, t);
    const cx = p.x + p.w / 2, at = 10 * T + 20;
    if (Math.abs(cx - at) > 8) return goTo(at)(g, p, t);
    return I({ action: true, jump: (t * 3 | 0) % 2 === 0 });
  };
  const b = (g, p, t) => (door.open ? goTo(ex)(g, p, t) : idle());
  ok(run(g, [a, b], 30, g => g.done), '9. Metal anahtar geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  const g = new Game(9, 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2;
  const across = () => A.x > 18 * T - 10 && B.x > 18 * T - 10 && A.supported;
  const both = () => [A, B].every(p => p.supported && p.y + p.h <= 6 * T + 1);
  const ctl = phases([
    crossPit(g, A, B, 12 * T, 18 * T, across),
    climbWall(g, A, B, 24 * T, 26 * T, 6 * T, both),
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), '10. Mıknatıs ustası geçildi (' + g.t.toFixed(1) + ' sn)');
}

console.log(failed ? '\\n' + failed + ' test başarısız' : '\\nTüm testler geçti');
`, ctx);
