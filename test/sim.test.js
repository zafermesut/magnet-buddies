// Başsız fizik ve bölüm testleri: node test/sim.test.js
// Bir bölümün botunu izlemek için: TRACE=bolum-kimligi node test/sim.test.js (saniyede bir oyuncu durumları)
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { console, Math, Map, Set, btoa, atob, TextEncoder, TextDecoder, Uint8Array, TRACE: process.env.TRACE || '' };
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
  const trace = TRACE && g.def.id === TRACE;
  for (let i = 0; i < secs * 60; i++) {
    g.step(DT, g.players.map((p, k) => (ctrls[k] ? ctrls[k](g, p, g.t) : I())));
    if (trace && i % 60 === 0) {
      const pl = g.players.map(p => '(' + (p.x | 0) + ',' + (p.y | 0) + (p.supported ? '' : ' havada') + (p.pol < 0 ? ' −' : ' +') +
        (p.ground ? ' ' + p.ground.kind : '') + (p.inExit ? ' kapıda' : '') + ')').join(' ');
      const rest = g.boxes.map(b => 'kutu(' + (b.x | 0) + ',' + (b.y | 0) + ')').concat(
        g.keys.map(k => (k.used ? 'açtı' : k.holder ? 'elde' : 'anahtar(' + (k.x | 0) + ',' + (k.y | 0) + ')')),
        g.movers.map(m => 'gezgin ' + (m.x | 0)), g.lifts.map(l => 'asansör ' + (l.y | 0))).join(' ');
      console.log('    ' + g.t.toFixed(0) + ' sn', pl, rest, JSON.stringify(g.switches));
    }
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
const L = id => { const i = levelIndexById(id); if (i < 0) throw new Error('bölüm yok: ' + id); return i; };

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

console.log('Harita ve kilitler');
{
  const flat = PARTS.flatMap(p => p.ids);
  ok(flat.length === LEVELS.length && flat.every((id, i) => LEVELS[i].id === id), 'her bölüm sırasıyla tek bir kısımda');
  ok(new Set(LEVELS.map(l => l.id)).size === LEVELS.length, 'bölüm kimlikleri benzersiz');
  const none = new Set();
  ok(levelUnlocked(0, none) && !levelUnlocked(1, none), 'başta yalnızca ilk bölüm açık');
  const some = new Set(['merhaba', 'anahtar']);
  ok(levelUnlocked(2, some) && !levelUnlocked(3, some), 'geçilen bölümün ardındaki açılır, ötesi kilitli');
  ok(levelUnlocked(L('firlatma'), new Set(['firlatma'])), 'daha önce geçilen bölüm sıra atlanmış olsa da açık kalır');
}
{
  // Alanlar istenen sırayla oynanır: her alanın ilk bölümü baştan açık, içindekiler sırayla
  const none = new Set();
  ok(AREAS.every((a, k) => levelUnlocked(areaLevels(k)[0], none)), 'her alanın ilk bölümü baştan açık');
  ok(AREAS.every((a, k) => { const idx = areaLevels(k); return idx.length < 2 || !levelUnlocked(idx[1], none); }), 'alanın ikinci bölümü ilki geçilmeden kilitli');
  ok(AREAS.every((a, k) => { const idx = areaLevels(k); return nextInArea(idx[idx.length - 1]) === -1 && levelNo(idx[0]) === 1; }), 'alanın sonunda sıradaki bölüm yok, numaralar alanda 1 ile başlar');
  ok(PARTS.every(p => AREAS.includes(p.area)), 'her kısım bir alana bağlı');
}

console.log('Vidalar');
{
  ok(LEVELS.every(l => new Game(LEVELS.indexOf(l), 2).screws.length === 3), 'her bölümde 3 vida var');
  // Kaba ulaşılabilirlik: vidanın altında (kule ile ~4 karo, mıknatıslı bölümde fırlatmayla ~7 karo) durulacak bir yer,
  // ya da yakınında onu oraya taşıyacak bir öğe (gezgin, asansör, yay, mıknatıslı tavan) olmalı
  const bad = [];
  LEVELS.forEach((l, i) => {
    const g = new Game(i, 2), m = l.map, reach = g.magnet ? 7 : 4;
    const solid = (r, c) => r >= m.length || '#PN-xyz=<>'.includes(m[r][c]) || ('H'.includes(m[r][c]));
    const stand = (r, c) => r >= 0 && r < m.length && c >= 0 && c < m[0].length && !'#PN'.includes(m[r][c]) && solid(r + 1, c);
    const near = (r0, c0, k) => {
      for (let r = r0; r <= Math.min(m.length - 1, r0 + k); r++) for (let c = c0 - 3; c <= c0 + 3; c++) if (stand(r, c)) return true;
      return false;
    };
    const helper = (r0, c0) => {
      for (let r = r0 - 2; r <= r0 + 7; r++) for (let c = c0 - 3; c <= c0 + 3; c++) {
        const ch = m[r] && m[r][c];
        if (ch && '=xyz^PN789'.includes(ch)) return true;   // pres de asansör gibi taşır
      }
      return false;
    };
    g.screws.forEach(sc => {
      const r = Math.floor(sc.y / T), c = Math.floor(sc.x / T);
      if (!near(r, c, g.aurora.has(r * g.cols + c) ? 7 : reach) && !helper(r, c)) bad.push(l.id + ' (' + r + ',' + c + ')');
    });
  });
  ok(!bad.length, 'her vida ulaşılabilir görünüyor' + (bad.length ? ': ' + bad.join(', ') : ''));
  const g = new Game(L('merhaba'), 1), p = g.players[0], sc = g.screws[0];
  p.x = sc.x - 10; p.y = sc.y - 10;
  run(g, [idle], 0.1);
  ok(sc.got && g.screwMask === 1, 'oyuncu değince vida toplanır');
}

console.log('Fizik');
{
  const g = new Game(L('merhaba'), 1); const p = g.players[0];
  run(g, [idle], 0.5);
  const floorY = p.y; let minY = p.y;
  run(g, [(g, p, t) => I({ jump: t < 1 })], 1, g => { minY = Math.min(minY, p.y); return false; });
  const h = floorY - minY;
  ok(h > 2 * T && h < 3 * T, 'tek başına zıplama 2 karoyu aşar, 3 karoyu aşamaz (' + h.toFixed(0) + ' px)');
}
{
  const g = new Game(L('merhaba'), 2); const [a, b] = g.players;
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
  const g = new Game(L('agir-kutu'), 2); const box = g.boxes[0]; const bx = box.x;
  run(g, [(g, p) => I({ right: true }), idle], 3);
  ok(Math.abs(box.x - bx) < 1, 'ağır kutu tek kişiyle kıpırdamaz');
  run(g, [(g, p) => I({ right: true }), (g, p) => I({ right: true })], 3);
  ok(box.x > bx + 100, 'iki kişi arka arkaya itince kutu kayar (' + (box.x - bx).toFixed(0) + ' px)');
}

console.log('Bölümleri otomatik geçme');
{
  // 1. Merhaba: ikisi de sağa gider, engelde/çukurda zıplar
  const g = new Game(L('merhaba'), 2), ex = g.exit.x + g.exit.w / 2;
  ok(run(g, [goTo(ex), goTo(ex)], 20, g => g.done), '1. Merhaba geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // 2. Anahtar: A anahtarı alır, kapıya götürür; sonra ikisi çıkışa
  const g = new Game(L('anahtar'), 2), ex = g.exit.x + g.exit.w / 2, key = g.keys[0];
  const keyX = key.x + key.w / 2;
  const a = (g, p, t) => (!key.used && key.holder !== p ? goTo(keyX, { hopAtEnd: true })(g, p, t) : goTo(ex)(g, p, t));
  const b = (g, p, t) => (g.doors[0].open ? goTo(ex)(g, p, t) : idle());
  ok(run(g, [a, b], 30, g => g.done), '2. Anahtar geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // 3. Kule: A çıkıntının yanında bekler, B onun üstüne çıkıp çıkıntıya zıplar, anahtarı alır
  const g = new Game(L('kule'), 2), ex = g.exit.x + g.exit.w / 2, key = g.keys[0];
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
  const g = new Game(L('nobetci'), 2), ex = g.exit.x + g.exit.w / 2;
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
  const g = new Game(L('agir-kutu'), 2), ex = g.exit.x + g.exit.w / 2, box = g.boxes[0];
  const c = (g, p, t) => (box.x + box.w < 20 * T - 2 ? I({ right: true }) : goTo(ex)(g, p, t));
  ok(run(g, [c, c], 40, g => g.done), '5. Ağır kutu geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // 6. Hepsi birden: kutuyu duvara it → üst kata çık → kule ile anahtar → kapı → düğmelerle geçiş → çıkış
  const g = new Game(L('hepsi-birden'), 2), ex = g.exit.x + g.exit.w / 2, box = g.boxes[0], key = g.keys[0], door = g.doors[0];
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
  const g = new Game(L('firlatma'), 2); const [a, b] = g.players;
  run(g, [idle, idle], 0.3);
  b.x = a.x; b.y = a.y - b.h - 1;
  run(g, [idle, idle], 0.5);
  const y0 = b.y; let minY = b.y;
  run(g, [() => I({ action: true }), idle], 1.5, () => { minY = Math.min(minY, b.y); return false; });
  ok(y0 - minY > 5 * T, 'aynı kutup: alttaki mıknatısı açınca üstteki 5 karodan yükseğe fırlar (' + (y0 - minY).toFixed(0) + ' px)');
}
{
  // Çekme: duvarın üstündeki, aşağıdaki zıt kutuplu arkadaşını yukarı çeker
  const g = new Game(L('firlatma'), 2); const [a, b] = g.players;
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
  const g = new Game(L('firlatma'), 2); const [a, b] = g.players;
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
    const g = new Game(L('metal-anahtar'), 2); const [a] = g.players; const key = g.keys[0];
    a.pol = pol;
    a.x = 10 * T + 3;
    run(g, [(g, p, t) => I({ action: true, jump: (t * 3 | 0) % 2 === 0 }), idle], 4, () => key.holder === a);
    ok(key.holder === a, 'anahtar ' + (pol > 0 ? '+' : '−') + ' kutupla mıknatısa çekilip alınır');
  }
}
{
  // Mıknatıssız bölümlerde eylem tuşunu basılı tutmak bir şey yapmaz
  const g = new Game(L('merhaba'), 2); const [a, b] = g.players; const bx = b.x;
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
      return I({ right: true, jump: p.supported ? (t * 6 | 0) % 2 === 0 : p.vy < 0 });
    }
    // B'nin hemen arkasında dur, B havalanınca it
    const target = B.x - p.w - 2;
    if (!B.supported && B.x > p.x) return I({ action: true });
    return I({ right: p.x < target - 2, left: p.x > target + 2 });
  };
  const b = (g, p, t) => {
    if (done()) return null;
    if (p.inExit) return I({ jump: (t * 4 | 0) % 2 === 0 });   // kapıya düştüyse çık, arkadaşını çek
    if (p.x > farX - 10 && p.supported) {
      if (!swapped) { swapped = true; return I({ swap: true }); }
      const cx = p.x + p.w / 2, at = farX + 20;
      if (Math.abs(cx - at) > 8) return I({ right: cx < at, left: cx > at });
      return I({ action: A.x < farX - 10 });
    }
    const cx = p.x + p.w / 2;
    if (!p.supported) return I({ right: cx < farX + 20, left: cx > farX + 80, jump: p.vy < 0 });   // karşıda kapıya değil çekme yerine
    if (cx < edgeX - 24) return I({ right: true });
    // Kenarda: A hemen arkaya gelince zıpla
    return A.x + A.w >= p.x - 6 ? I({ right: true, jump: true }) : idle();
  };
  return [a, b];
}
// Duvar aşma: B, A'nın üstüne çıkar; A fırlatır; yukarıda B kutup değiştirip A'yı çeker
function climbWall(g, A, B, standX, wallX, topY, done) {
  let launching = false;
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
    if (Math.abs(cx - standX) > 6 || !p.supported) return goTo(standX)(g, p, t);
    // Yalnızca B tam üstüne oturunca fırlat, B yükselirken itmeye devam et
    if (B.ground === p && Math.abs(B.x - p.x) < 6) launching = true;
    else if (B.supported || B.vy >= 0) launching = false;
    return I({ action: launching });
  };
  const b = (g, p, t) => {
    if (done()) return null;
    if (p.inExit) return I({ jump: (t * 4 | 0) % 2 === 0 });   // kapıya düştüyse çık, arkadaşını çek
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
    if (p.ground === A) { const d = A.x - p.x; return I({ right: d > 2, left: d < -2 }); }   // kafasında ortalan
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
      if (list[i].every((f, j) => f === idle || f(g, g.players[j], t) === null)) i++;   // idle olan aşamayı bekletmez
      else return I();
    }
    return I();
  });
}
{
  const g = new Game(L('firlatma'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2;
  const both = () => [A, B].every(p => p.supported && p.y + p.h <= 6 * T + 1);
  const ctl = phases([climbWall(g, A, B, 16 * T, 18 * T, 6 * T, both), [goTo(ex), goTo(ex)]]);
  ok(run(g, ctl, 40, g => g.done), '7. Fırlatma geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  const g = new Game(L('ucurum'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2;
  const across = () => A.x > 18 * T - 10 && B.x > 18 * T - 10 && A.supported;
  const ctl = phases([crossPit(g, A, B, 12 * T, 18 * T, across), [goTo(ex), goTo(ex)]]);
  ok(run(g, ctl, 40, g => g.done), '8. Uçurum geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  const g = new Game(L('metal-anahtar'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, key = g.keys[0], door = g.doors[0];
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
  const g = new Game(L('miknatis-ustasi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2;
  const across = () => A.x > 18 * T - 10 && B.x > 18 * T - 10 && A.supported;
  const both = () => [A, B].every(p => p.supported && p.y + p.h <= 6 * T + 1);
  const ctl = phases([
    crossPit(g, A, B, 12 * T, 18 * T, across),
    climbWall(g, A, B, 24 * T, 26 * T, 6 * T, both),
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), '10. Mıknatıs ustası geçildi (' + g.t.toFixed(1) + ' sn)');
}


console.log('Hurdalık öğeleri');
// Eylem tuşunu kısa aralıklarla basıp bırak (şalter basışta döner)
const tap = t => (t * 6 | 0) % 2 === 0;
// Platform dizisine tırman: bir sonrakinin altına/yanına git ve zıpla
const surfOn = (p, pl) => p.supported && Math.abs(p.y + p.h - pl.surf) < 2 && p.x + p.w > pl.x0 && p.x < pl.x1;
const climbTo = plats => {
  const reached = new Map();   // oyuncu başına çıkılan en yüksek basamak (havadayken unutulmasın)
  return (g, p, t) => {
  let i = plats.length - 1;
  while (i >= 0 && !surfOn(p, plats[i])) i--;
  if (p.supported && i < 0 && p.y + p.h > plats[0].surf) reached.set(p, -1);   // yere düştü
  i = Math.max(i, p.supported ? i : reached.has(p) ? reached.get(p) : -1);
  reached.set(p, i);
  const next = plats[i + 1];
  if (!next) return null;
  const cx = p.x + p.w / 2, aim = Math.max(next.x0 + 22, Math.min(next.x1 - 22, cx)), d = aim - cx;
  return I({ right: d > 3, left: d < -3, jump: (Math.abs(d) < 75 && p.supported) || p.vy < 0 });
  };
};
{
  // Tek yönlü platform: alttan zıplayıp geçer, üstüne basar
  const g = new Game(L('merdiven'), 1), p = g.players[0];
  p.x = 6 * T - 17;
  run(g, [idle], 0.3);
  run(g, [(g, p, t) => I({ jump: t < 0.6 })], 1.5);
  ok(p.supported && Math.abs(p.y + p.h - 9 * T) < 1, 'tek yönlü platforma alttan zıplanır ve üstünde durulur');
}
{
  // Şalter: bir kez çevrilince kapak açık kalır, tekrar çevrilince kapanır
  const g = new Game(L('salter'), 2), [A] = g.players, lv = g.levers.find(l => l.channel === 2), gate = g.gates.find(x => x.channel === 2);
  A.x = lv.x + 3; A.y = lv.y + T - A.h;
  run(g, [idle, idle], 0.2);
  run(g, [(g, p, t) => I({ action: t < g.t + 1 && !g.switches[2] })], 0.3);
  run(g, [idle, idle], 0.5);
  const opened = gate.open;
  A.x = 3 * T;   // şalterden uzaklaş
  run(g, [idle, idle], 1);
  const stays = gate.open;
  A.x = lv.x + 3;
  run(g, [idle, idle], 0.2);
  let pressed = false;
  run(g, [() => { const r = I({ action: !pressed }); pressed = true; return r; }, idle], 0.5);
  ok(opened && stays && !gate.open, 'şalter kapağı açar, açık tutar; tekrar çevrilince kapatır');
}
{
  // Asansör: düğmeye basılıyken üstündekini taşıyarak çıkar, bırakılınca iner, altta kimse varsa ezmez
  const g = new Game(L('asansor'), 2), [A, B] = g.players, lift = g.lifts[0], btn = g.buttons[0];
  B.x = lift.x + 20; B.y = lift.y - B.h;
  A.x = btn.x; A.y = btn.y + btn.h - A.h;
  run(g, [idle, idle], 5);
  ok(lift.y === lift.topY && B.ground === lift && Math.abs(B.y + B.h - lift.topY) < 1, 'asansör üstündekini taşıyarak yukarı çıkar (' + (lift.oy - lift.y) + ' px)');
  B.x = 16 * T; B.y = 5 * T - B.h;   // B üst kata geçti
  A.x = lift.x + 20; A.y = lift.oy + T - A.h;   // A asansörün boşluğuna indi
  run(g, [idle, idle], 4);
  ok(lift.y < lift.oy && lift.y + lift.h <= A.y + 1, 'inen asansör altındakini ezmez, üstünde durur');
}
{
  // Yay: ~4 karo fırlatır; zıplama tuşu basılıysa 5 karoyu aşar
  for (const held of [false, true]) {
    const g = new Game(L('zipzip'), 1), p = g.players[0], s = g.springs[0];
    p.x = s.x + s.w / 2 - p.w / 2; p.y = 9 * T - p.h;   // yayın üstüne düşür
    const floor = s.y + s.h; let minY = p.y;
    run(g, [() => I({ jump: held })], 1.2, () => { minY = Math.min(minY, p.y + p.h); return false; });
    const h = floor - minY;
    ok(held ? h > 5 * T + 10 : h > 4 * T + 10 && h < 5 * T, 'yay ' + (held ? 'zıplama basılıyken 5 karoyu aşar' : '4 karoyu aşar, 5 karoyu aşamaz') + ' (' + h.toFixed(0) + ' px)');
  }
}

console.log('Hurdalık bölümleri');
{
  // Şalter: A düğmede tutar; B geçip mor şalteri, sonra turuncu şalteri çevirir; A da geçer
  const g = new Game(L('salter'), 2), ex = g.exit.x + g.exit.w / 2, btn = g.buttons[0];
  const lv2 = g.levers.find(l => l.channel === 2), lv1 = g.levers.find(l => l.channel === 1);
  const at = (p, l) => overlap(grow(p, 6), l);
  const a = (g, p, t) => (g.switches[1] ? goTo(ex)(g, p, t) : goTo(btn.x + btn.w / 2)(g, p, t));
  const b = (g, p, t) => {
    if (!btn.pressed && !g.switches[1]) return idle();
    if (!g.switches[2]) return at(p, lv2) ? I({ action: tap(t) }) : goTo(lv2.x + T / 2)(g, p, t);
    if (!g.switches[1]) return at(p, lv1) ? I({ action: tap(t) }) : goTo(lv1.x + T / 2)(g, p, t);
    return goTo(ex)(g, p, t);
  };
  ok(run(g, [a, b], 40, g => g.done), '6. Şalter geçildi (' + g.t.toFixed(1) + ' sn)');
  const solo = new Game(L('salter'), 1);
  ok(!run(solo, [goTo(ex)], 15, g => g.done), 'Şalter tek kişiyle düz yürüyerek geçilmez');
}
{
  // Merdiven: ikisi platformlardan çıkar; üst basamağa B, A'nın üstünden zıplar; anahtarı kapıya götürür
  const g = new Game(L('merdiven'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, key = g.keys[0], door = g.doors[0];
  const P = (r, c0, c1) => ({ surf: r * T, x0: c0 * T, x1: (c1 + 1) * T });
  const steps = [P(9, 5, 7), P(7, 9, 11), P(5, 5, 8)], top = P(2, 5, 8), baseX = 7 * T;
  const climbA = climbTo(steps), climbB = climbTo(steps);
  const a = (g, p, t) => {
    if (door.open) return goTo(ex)(g, p, t);
    const c = climbA(g, p, t);
    if (c) return c;
    return goTo(baseX)(g, p, t);
  };
  const b = (g, p, t) => {
    if (door.open) return goTo(ex)(g, p, t);
    if (key.holder === p) return goTo(door.cells[0].c * T)(g, p, t);
    if (surfOn(p, top)) return goTo(key.x + key.w / 2)(g, p, t);
    if (p.ground === A || (!p.supported && p.y + p.h < 5 * T - A.h)) return I({ jump: p.ground === A ? (t * 5 | 0) % 2 === 0 : p.vy < 0 });
    const c = climbB(g, p, t);
    if (c) return c;
    if (!surfOn(A, steps[2]) || Math.abs(A.x + A.w / 2 - baseX) > 8) return goTo(baseX - 60)(g, p, t);
    return climbOn(A)(g, p, t);
  };
  ok(run(g, [a, b], 60, g => g.done), '7. Merdiven geçildi (' + g.t.toFixed(1) + ' sn)');
  const solo = new Game(L('merdiven'), 1), q = solo.players[0];
  const climbS = climbTo(steps);
  run(solo, [(g, p, t) => climbS(g, p, t) || I({ jump: tap(t) })], 20);
  ok(!(q.y + q.h < 3 * T), 'Merdiven: tek kişi en üst basamağa çıkamaz');
}
{
  // Asansör: A düğmede, B asansörle çıkar; sonra B yukarıdaki düğmeye basar, A çıkar
  const g = new Game(L('asansor'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, lift = g.lifts[0];
  const [high, low] = g.buttons.slice().sort((p, q) => p.y - q.y), liftX = lift.x + lift.w / 2, up = () => lift.y <= lift.topY + 0.5, down = () => lift.y >= lift.oy - 0.5;
  const upstairs = p => p.supported && p.y + p.h <= 5 * T + 1 && p.x > lift.x + lift.w - 10;
  const onLift = p => p.ground === lift;
  let phase = 0;
  const a = (g, p, t) => {
    if (upstairs(p)) return goTo(ex)(g, p, t);
    if (phase === 0) return onLift(B) || !down() ? goTo(low.x + low.w / 2)(g, p, t) : goTo(5 * T)(g, p, t);   // B binince düğmeye, B çıkana kadar orada
    if (onLift(p) || (p.supported && p.y + p.h <= 5 * T + 1)) return up() || !onLift(p) ? I({ right: true }) : idle();
    return down() ? goTo(liftX)(g, p, t) : goTo(5 * T)(g, p, t);   // düğmeden in, asansör insin
  };
  const b = (g, p, t) => {
    if (upstairs(p)) {
      if (phase === 0) phase = 1;
      if (upstairs(A)) return goTo(ex)(g, p, t);
      return onLift(A) && down() || !down() && onLift(A) ? goTo(high.x + high.w / 2)(g, p, t) : goTo(17 * T)(g, p, t);
    }
    if (onLift(p) || (p.supported && p.y + p.h <= 5 * T + 1)) return up() || !onLift(p) ? I({ right: true }) : idle();
    return goTo(liftX)(g, p, t);
  };
  ok(run(g, [a, b], 60, g => g.done), '8. Asansör geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // Zıp zıp: A düğmede kapağı tutar, B yayla yukarı çıkıp şalteri çevirir; A da yayla çıkar
  const g = new Game(L('zipzip'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, btn = g.buttons[0], sp = g.springs[0], lv = g.levers[0];
  const upstairs = p => p.supported && p.y + p.h <= 6 * T + 1 && p.x > 17 * T - 10;
  const toSpring = (g, p, t) => {
    if (!p.supported) return I({ right: true, jump: true });
    const cx = p.x + p.w / 2, d = sp.x + sp.w / 2 - cx;
    return I({ right: d > 0, left: d < -30, jump: Math.abs(d) < 50 });
  };
  const a = (g, p, t) => {
    if (upstairs(p)) return goTo(ex)(g, p, t);
    if (!g.switches[1]) return goTo(btn.x + btn.w / 2)(g, p, t);
    return toSpring(g, p, t);
  };
  const b = (g, p, t) => {
    if (upstairs(p)) {
      if (!g.switches[1]) return overlap(grow(p, 6), lv) ? I({ action: tap(t) }) : goTo(lv.x + T / 2)(g, p, t);
      return upstairs(A) ? goTo(ex)(g, p, t) : idle();
    }
    if (!btn.pressed) return idle();
    return toSpring(g, p, t);
  };
  ok(run(g, [a, b], 40, g => g.done), '9. Zıp zıp geçildi (' + g.t.toFixed(1) + ' sn)');
}
// Gezgin platformla karşıya geçiş: kıyıda bekle, platform bu uçtayken bin, karşı uçta in.
// slot: platformdaki yer (px); öndeki büyük, arkadaki küçük slot alır.
const ride = (M, slotOf) => (g, p, t) => {
  const shore = M.maxX + M.w, slot = typeof slotOf === 'function' ? slotOf(p) : slotOf;
  if ((p.supported && !p.ground && p.x + p.w / 2 > shore + 4) || p.x > shore + 10) return null;   // karşı kıyıda
  if (p.x + p.w > shore + 1 && (p.supported || p.ground === M)) return I({ right: true });   // kıyıya basıyor: ilerle
  const hold = x => { const d = x - p.x; return I({ right: d > 3, left: d < -3 }); };
  if (p.ground === M) return M.x >= M.maxX - 0.5 ? I({ right: true }) : hold(M.x + slot);
  if (!p.supported) return I({ right: true });
  if (M.x <= M.minX + 0.5 && M.pause > 0.15) return hold(M.x + slot);
  return hold(M.minX - p.w - 4 - (slot > 20 ? 0 : 40));
};
// Kim öndeyse (kıyıya yakınsa) platformun ön tarafına biner
const rideBoth = (M, A, B) => {
  const slot = p => { const o = p === A ? B : A; return p.x >= o.x ? M.w - PHYS.playerSize - 4 : 2; };
  return [ride(M, slot), ride(M, slot)];
};

console.log('Paslı raylar öğeleri');
{
  // Gezgin platform üstündekini taşır, uçlarda döner
  const g = new Game(L('gezgin'), 1), p = g.players[0], M = g.movers[0];
  p.x = M.x + 20; p.y = M.y - p.h;
  let minX = M.x, maxX = M.x, fell = false;
  run(g, [idle], 8, () => { minX = Math.min(minX, M.x); maxX = Math.max(maxX, M.x); if (p.y > M.y) fell = true; return false; });
  ok(!fell && Math.abs(p.x - M.x - 20) < 2, 'gezgin platform üstündekini düşürmeden taşır');
  ok(Math.abs(minX - M.minX) < 1 && Math.abs(maxX - M.maxX) < 1, 'gezgin platform iki ucu arasında gidip gelir');
}
{
  // Ters kapak: kanal kapalıyken açık, düğmeye basılınca kapanır, bırakınca açılır
  const g = new Game(L('ters-asansor'), 2), [A] = g.players, gate = g.gates.find(x => x.inverse);
  const low = g.buttons.slice().sort((p, q) => q.y - p.y)[0];
  run(g, [idle, idle], 0.2);
  const wasOpen = gate.open;
  A.x = low.x; A.y = low.y + low.h - A.h;
  run(g, [idle, idle], 0.3);
  const closed = !gate.open;
  A.x = 6 * T;
  run(g, [idle, idle], 0.3);
  ok(wasOpen && closed && gate.open, 'ters kapak düğmeye basılınca kapanır, bırakınca açılır');
}
{
  // Çukura düşen, arkadaşının yanında değil en son durduğu yerde doğar
  const g = new Game(L('gezgin'), 2), [A, B] = g.players;
  B.x = 24 * T; B.y = 10 * T - B.h + 6;   // B karşıda
  run(g, [idle, idle], 0.5);
  A.x = 8 * T; run(g, [idle, idle], 0.3);
  run(g, [() => I({ right: true }), idle], 4, g => g.effects.some(e => e.type === 'respawn'));
  ok(A.x < 10 * T && B.x > 22 * T, 'çukura düşen kendi kıyısında doğar (A x=' + (A.x / T).toFixed(1) + ')');
}

console.log('Paslı raylar bölümleri');
{
  // Gezgin: kule ile anahtarı al, platformla geç, kapıyı aç
  const g = new Game(L('gezgin'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, key = g.keys[0], door = g.doors[0], M = g.movers[0];
  const ledge = { surf: 8 * T, x0: T, x1: 4 * T }, baseX = 4 * T + 22;
  const [ra, rb] = rideBoth(M, A, B);
  const a = (g, p, t) => {
    if (key.holder !== B && !key.used) return goTo(baseX)(g, p, t);
    return door.open ? goTo(ex)(g, p, t) : ra(g, p, t) || goTo(23 * T + 20)(g, p, t);   // kıyıdan uzaklaş, B insin
  };
  const b = (g, p, t) => {
    if (key.holder === p || key.used) {
      if (door.open) return goTo(ex)(g, p, t);
      if (p.x < 22 * T) return rb(g, p, t) || I({ right: true });
      return goTo(door.cells[0].c * T)(g, p, t);
    }
    if (surfOn(p, ledge)) return goTo(key.x + key.w / 2)(g, p, t);
    if (p.ground === A) return I({ jump: (t * 5 | 0) % 2 === 0, left: p.y + p.h < 8 * T });
    if (!p.supported && p.y + p.h < 10 * T) return I({ jump: p.vy < 0, left: p.y + p.h < 8 * T });
    if (Math.abs(A.x + A.w / 2 - baseX) > 8 || !A.supported) return goTo(baseX + 60)(g, p, t);
    return climbOn(A)(g, p, t);
  };
  ok(run(g, [a, b], 60, g => g.done), '11. Gezgin geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // Yük treni: sandığı platforma iki seferde yükle, karşıda indir, duvara dayayıp basamak yap
  const g = new Game(L('yuk-treni'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, box = g.boxes[0], M = g.movers[0];
  const atLeft = () => M.x <= M.minX + 0.5 && M.pause > 0.15, atRight = () => M.x >= M.maxX - 0.5 && M.pause > 0.15;
  const [ra, rb] = rideBoth(M, A, B);
  const c = (g, p, t) => {
    const onM = p.ground === M, boxOnM = box.ground === M;
    if (box.x + box.w >= 28 * T - 1) {   // sandık duvarda: üstüne çık, oradan çıkıntıya
      if (p.ground === box) return I({ right: true, jump: (t * 5 | 0) % 2 === 0 || p.vy < 0 });
      return goTo(ex)(g, p, t);
    }
    if (box.x >= 16 * T && !boxOnM) {   // sandık karşı kıyıda: karşıya geç ve duvara it
      if (onM) return atRight() ? I({ right: true }) : idle();
      return (p === A ? ra : rb)(g, p, t) || I({ right: true });
    }
    if (boxOnM) {
      if (box.x < M.x + M.w / 2 - 1 && atLeft()) return I({ right: true });   // ikinci yükleme: sandığı öne it, platforma bin
      if (onM) return atRight() ? I({ right: true }) : idle();
      return idle();
    }
    if (box.x + box.w < 12 * T - 1) return I({ right: true });           // sandığı kıyıya it
    return atLeft() ? I({ right: true }) : idle();                         // platform gelince yükle
  };
  ok(run(g, [c, c], 90, g => g.done), '12. Yük treni geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // Ters asansör: düğme asansörü kaldırır ama ters kapağı kapatır; sırayla geçilir
  const g = new Game(L('ters-asansor'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, lift = g.lifts[0];
  const [high, low] = g.buttons.slice().sort((p, q) => p.y - q.y), liftX = lift.x + lift.w / 2, gate = g.gates[0];
  const up = () => lift.y <= lift.topY + 0.5, down = () => lift.y >= lift.oy - 0.5, onLift = p => p.ground === lift;
  const upper = p => p.supported && p.y + p.h <= 5 * T + 1;
  const pastGate = p => upper(p) && p.x > 18 * T;
  const step = (p, x) => { const d = x - p.x; return I({ right: d > 3, left: d < -3 }); };
  const a = (g, p, t) => {
    if (pastGate(p)) return goTo(ex)(g, p, t);
    if (upper(p) && !onLift(p)) return gate.open ? I({ right: true }) : step(p, 15 * T + 4);   // yukarıda, kapak açılmasını bekle
    if (onLift(p)) return up() ? I({ right: true }) : idle();
    if (!pastGate(B)) return onLift(B) || !down() ? (upper(B) ? goTo(5 * T)(g, p, t) : goTo(low.x + low.w / 2)(g, p, t)) : goTo(5 * T)(g, p, t);
    return down() ? goTo(liftX)(g, p, t) : goTo(5 * T)(g, p, t);
  };
  const b = (g, p, t) => {
    if (pastGate(p)) {
      if (pastGate(A)) return goTo(ex)(g, p, t);
      if (upper(A) && !onLift(A)) return goTo(ex)(g, p, t);              // A yukarıda: düğmeden in, kapak açılsın
      return onLift(A) && (down() || !up()) || up() ? step(p, high.x + 4) : step(p, 19 * T);
    }
    if (upper(p) && !onLift(p)) return gate.open ? I({ right: true }) : step(p, 15 * T + 4);
    if (onLift(p)) return up() ? I({ right: true }) : idle();
    return goTo(liftX)(g, p, t);
  };
  ok(run(g, [a, b], 60, g => g.done), '13. Ters asansör geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // Yay ve kule: ikisi de yayla rafa, A asansörde durur, B onun üstünden çıkıntıya; B düğmeyle A'yı kaldırır
  // Öndeki oyuncu (2P) önden gidip asansörde bekler: burada A o, B arkadan gelir
  const g = new Game(L('yay-ve-kule'), 2), [B, A] = g.players, ex = g.exit.x + g.exit.w / 2, sp = g.springs[0], lift = g.lifts[0], btn = g.buttons[0];
  const shelf = p => p.supported && Math.abs(p.y + p.h - 6 * T) < 2;
  const ledge = p => p.supported && p.y + p.h <= 3 * T + 1 && p.x + p.w > 24 * T;
  const toSpring = (g, p, t) => {
    if (!p.supported) return I({ right: true, jump: true });
    const d = sp.x + sp.w / 2 - (p.x + p.w / 2);
    return I({ right: d > 0, left: d < -30, jump: Math.abs(d) < 50 });
  };
  const liftX = lift.x + lift.w / 2;
  const a = (g, p, t) => {
    if (ledge(p)) return goTo(ex)(g, p, t);
    if (p.ground === lift) return lift.y <= lift.topY + 0.5 ? I({ right: true }) : idle();
    if (shelf(p) || (p.supported && p.y + p.h <= 6 * T + 1)) return goTo(liftX)(g, p, t);
    return toSpring(g, p, t);
  };
  let fromA = false;   // B, A'nın kafasından sıçradı mı (sıçradıysa havada sağa, çıkıntıya)
  const b = (g, p, t) => {
    if (ledge(p)) return ledge(A) ? goTo(ex)(g, p, t) : goTo(btn.x + btn.w / 2)(g, p, t);
    if (p.ground === A) { fromA = true; const d = A.x - p.x; return I({ right: d > 2, left: d < -2, jump: Math.abs(d) <= 2 && (t * 5 | 0) % 2 === 0 }); }
    if (p.supported) fromA = false;
    if (fromA && !p.supported) return I({ right: p.y + p.h < 3 * T, jump: p.vy < 0 });
    const up = p.y + p.h <= 6 * T + 1 && p.x > 14 * T;   // raf seviyesinde (yerde ya da havada)
    if (shelf(p) || up) return A.ground === lift ? climbOn(A)(g, p, t) : goTo(18 * T)(g, p, t);
    return A.ground === lift || shelf(A) ? toSpring(g, p, t) : idle();
  };
  ok(run(g, [b, a], 60, g => g.done), '14. Yay ve kule geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // Hurda dağı: platformla geç; önden inen A yaya gider, arkadan inen B kıyıdaki düğmede kapağı tutar.
  // A yayla rafa çıkıp şalteri çevirir (kapak açık kalır), B de yayla çıkar; ikisi asansöre biner, biri yandaki şalteri çevirir
  const g = new Game(L('hurda-dagi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, M = g.movers[0], lift = g.lifts[0], sp = g.springs[0];
  const btn = g.buttons[0], lv1 = g.levers.find(l => l.channel === 1);
  const [ra, rb] = rideBoth(M, A, B);
  const shelf = p => p.supported && p.y + p.h <= 8 * T + 1 && p.x > 26 * T - 10;
  const top = p => p.supported && p.y + p.h <= 4 * T + 1 && p.x > 30 * T;
  const toSpring = (g, p, t) => {
    if (!p.supported) return I({ right: true, jump: true });
    const d = sp.x + sp.w / 2 - (p.x + p.w / 2);
    return I({ right: d > 0, left: d < -30, jump: Math.abs(d) < 50 });
  };
  const step = (p, x) => { const d = x - p.x; return I({ right: d > 2, left: d < -2 }); };
  const onLift = p => p.ground === lift;
  let runner = null;   // ilk karşıya geçen yaya gider, öbürü düğmede bekler
  const c = (g, p, t) => {
    const o = p === A ? B : A;
    if (top(p)) return goTo(ex)(g, p, t);
    if (onLift(p)) {
      if (lift.y <= lift.topY + 0.5) return I({ right: true });
      if (p === runner) {   // şalterin yanındaki yerde dur, arkadaşın binince çevir
        if (Math.abs(p.x - (31 * T + 2)) > 3) return step(p, 31 * T + 2);
        return onLift(o) && !g.switches[2] ? I({ action: (t * 6 | 0) % 2 === 0 }) : idle();
      }
      return step(p, 32 * T + 4);
    }
    if (shelf(p)) {
      if (p === runner && !g.switches[1]) return overlap(grow(p, 6), lv1) ? I({ action: (t * 6 | 0) % 2 === 0 }) : goTo(lv1.x + T / 2)(g, p, t);
      if (p === runner) return shelf(o) || onLift(o) ? goTo(31 * T + 20)(g, p, t) : idle();
      return goTo(32 * T + 20)(g, p, t);
    }
    const r = (p === A ? ra : rb)(g, p, t); if (r) return r;
    if (!runner) runner = p;
    if (p === runner) {
      if (p.x < 22 * T + 4) return goTo(22 * T + 20)(g, p, t);   // düğmedekinin üstünden atlayıp kapağın önüne geç
      return btn.pressed || g.switches[1] ? toSpring(g, p, t) : idle();
    }
    return g.switches[1] ? toSpring(g, p, t) : goTo(btn.x + btn.w / 2)(g, p, t);
  };
  const a = c, b = c;
  ok(run(g, [a, b], 90, g => g.done), '15. Hurda dağı geçildi (' + g.t.toFixed(1) + ' sn)');
}

console.log('Manyetik öğeler');
{
  // Metal sandık: tek kişi iter, mıknatıs uzaktan çeker
  const g = new Game(L('metal-sandik'), 2), [A, B] = g.players, crate = g.boxes[0];
  const x0 = crate.x;
  A.x = 7 * T; B.x = 17 * T;   // B mıknatısın menzili dışında (yoksa o da çekilir)
  run(g, [() => I({ action: true }), idle], 0.5);
  run(g, [() => I({ left: true }), idle], 2);   // mıknatısı bırak, sandık düşerken kenara çekil
  ok(crate.y + crate.h >= 11 * T - 1 && crate.x > x0 + 5, 'metal sandık mıknatısla raftan çekilir (' + crate.x.toFixed(0) + ', ' + crate.y.toFixed(0) + ')');
  run(g, [idle, idle], 0.5);
  A.x = crate.x - A.w - 2; A.y = 11 * T - A.h;
  const x1 = crate.x;
  run(g, [() => I({ right: true }), idle], 1);
  ok(crate.x > x1 + 60, 'metal sandığı tek kişi iter');
}
{
  // Sabit mıknatıs: dururken tavana kapılmaz, zıplayınca yapışır, asılı yürür, kutup değişince bırakır
  const g = new Game(L('yapiskan-tavan'), 2), [A] = g.players;
  A.x = 10 * T; A.y = 11 * T - A.h - 60;   // çukurun üstünde, tavanın altında
  A.x = 8 * T; A.y = 11 * T - A.h;
  run(g, [idle, idle], 0.5);
  const stays = A.supported;
  run(g, [(g, p, t) => I({ jump: t < g.t + 1 })], 0.4);
  const stuck = A.y <= 7 * T + 1 && !A.supported;
  run(g, [() => I({ right: true })], 2);
  const hang = A.y <= 7 * T + 1 && A.x > 12 * T;
  let sw = false;
  run(g, [() => { const r = I({ swap: !sw }); sw = true; return r; }], 1.5);
  ok(stays && stuck && hang && A.y > 8 * T, 'tavana zıplayınca yapışılır, asılı yürünür, kutup değişince bırakılır');
}
{
  // Mıknatıslı duvar: zıt kutupla yapışıp zıplayarak tırmanılır ve üstünden aşılır
  const g = new Game(L('miknatis-bacasi'), 2), [A] = g.players;
  A.pol = 1; A.x = 12 * T - A.w; A.y = 11 * T - A.h;
  // Tepeye çıkınca kutbunu değiştirip duvardan ayrılır
  run(g, [(g, p, t) => (p.supported && p.y + p.h <= 3 * T + 1 && p.pol === 1 ? I({ swap: true, right: true }) : I({ right: true, jump: p.pol === 1 && (t * 6 | 0) % 2 === 0 }))], 12,
    () => A.x > 14 * T && A.supported);
  ok(A.x > 14 * T && A.supported, 'mıknatıslı duvara tırmanıp kutup değiştirerek öbür yana geçilir (' + g.t.toFixed(1) + ' sn)');
  const g2 = new Game(L('miknatis-bacasi'), 2), [Z] = g2.players;
  Z.pol = -1; Z.x = 12 * T - Z.w; Z.y = 11 * T - Z.h;
  run(g2, [(g, p, t) => I({ right: true, jump: (t * 6 | 0) % 2 === 0 })], 8);
  ok(Z.x < 12 * T, 'aynı kutuptaki duvara tırmanamaz');
}
{
  // Kutup kapısı: yalnızca aynı kutuptaki geçer, içindeyken kutup değişmez
  const g = new Game(L('kutup-kapisi'), 2), [A, B] = g.players;
  A.x = 5 * T; B.x = 2 * T;
  run(g, [() => I({ right: true }), () => I({ right: true })], 3);
  ok(A.pol === 1 && A.x > 9 * T && B.x < 8 * T, '+ kutup kırmızı kapıdan geçer, − geçemez');
  const g2 = new Game(L('kutup-kapisi'), 2), [C] = g2.players;
  C.x = 8 * T + 3; C.y = 11 * T - C.h;
  run(g2, [() => I({ swap: true })], 0.2);
  ok(C.pol === 1, 'kapının içindeyken kutup değişmez');
}

console.log('Mıknatıs mezarlığı ve Manyetik çekirdek bölümleri');
// Tavana yapışıp karşıya geç: başlangıçta yanlış kutuptaysa değiştir, karşıda bırak
const hangAcross = (startX, endX, pol) => (g, p, t) => {
  if (p.x + p.w / 2 > endX && (p.supported || p.pol !== pol)) return null;
  if (p.pol !== pol && p.x + p.w / 2 < endX) return I({ swap: (t * 10 | 0) % 2 === 0 });
  const hanging = !p.supported && p.vy <= 1 && p.gripT > 0;
  if (hanging) return p.x + p.w / 2 > endX ? I({ swap: true }) : I({ right: true });
  if (!p.supported) return I({ right: p.x + p.w / 2 > startX });
  const d = startX - (p.x + p.w / 2);
  if (Math.abs(d) > 8) return I({ right: d > 0, left: d < 0 });
  return I({ jump: (t * 4 | 0) % 2 === 0 });
};
{
  // Metal sandık: A mıknatısla sandığı indirir, sandık duvara itilir, A sandığın üstünde B'yi fırlatır, B A'yı çeker
  const g = new Game(L('metal-sandik'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0];
  const both = () => [A, B].every(p => p.supported && p.y + p.h <= 7 * T + 1);
  const down = () => crate.y + crate.h >= 11 * T - 1, atWall = () => crate.x + crate.w >= 24 * T - 1;
  const behind = p => p.x + p.w <= crate.x + 3 && p.supported && p.ground !== crate;   // sandığın solunda, yerde
  // Sandığı indir: raftayken mıknatısla çek, raftan ayrılınca bırak ve kenara çekil
  const pullDown = (shelfY, standX) => (g, p, t) => {
    if (down()) return null;
    if (crate.ground === p) return I({ right: true });   // sandık kafasında: yürü, düşsün
    if (crate.y + crate.h > shelfY + 2) return goTo(standX + 90)(g, p, t);
    return Math.abs(p.x + p.w / 2 - standX) > 6 ? goTo(standX)(g, p, t) : I({ action: true });
  };
  const fetch = [pullDown(7 * T, 6 * T + 37), (g, p, t) => (down() ? null : goTo(17 * T)(g, p, t))];   // B menzil dışında bekler
  const push = [
    (g, p, t) => (atWall() ? null : behind(p) ? I({ right: true }) : goTo(crate.x - 50)(g, p, t)),
    (g, p, t) => (atWall() ? null : p.x > crate.x + crate.w ? idle() : goTo(crate.x - 90)(g, p, t)),
  ];
  const ctl = phases([fetch, push, climbWall(g, A, B, 24 * T - crate.w / 2, 24 * T, 7 * T, both), [goTo(ex), goTo(ex)]]);
  ok(run(g, ctl, 60, g => g.done), '19. Metal sandık geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // Yapışkan tavan: sırayla tavandan karşıya geç, sonra kule ve mıknatısla çıkıntıya
  const g = new Game(L('yapiskan-tavan'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2;
  const ha = hangAcross(8 * T, 26 * T, 1), hb = hangAcross(8 * T, 26 * T, 1);
  // Öndeki (B) önce geçer, A arkada bekler
  const across = [
    (g, p, t) => (B.x < 25 * T ? (p.x > 2 * T ? goTo(2 * T)(g, p, t) : idle()) : ha(g, p, t)),
    (g, p, t) => hb(g, p, t),
  ];
  const both = () => [A, B].every(p => p.supported && p.y + p.h <= 8 * T + 1);
  const ctl = phases([across, climbWall(g, A, B, 28 * T, 29 * T, 8 * T, both), [goTo(ex), goTo(ex)]]);
  ok(run(g, ctl, 60, g => g.done), '21. Yapışkan tavan geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // Mıknatıs bacası: A duvara tırmanıp düğmeye basar; B kutbunu değiştirip tırmanır, kapıdan geçip içerideki düğmeye basar; A da geçer
  const g = new Game(L('miknatis-bacasi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2;
  const [b1, b2] = g.buttons.slice().sort((p, q) => p.x - q.x), gate = g.gates[0];
  const over = p => p.x > 13 * T;
  const climbed = new Set();
  const climb = (g, p, t) => {
    if (p.supported && p.y + p.h <= 3 * T + 1) climbed.add(p);
    if (climbed.has(p)) return p.pol === 1 ? I({ swap: true, right: true }) : I({ right: true });   // tepede: kutbu değiştir, duvardan ayrıl
    if (p.pol !== 1) return I({ swap: (t * 10 | 0) % 2 === 0 });
    if (p.x + p.w < 12 * T - 4 && p.supported) return goTo(12 * T - p.w)(g, p, t);
    return I({ right: true, jump: (t * 6 | 0) % 2 === 0 });
  };
  const a = (g, p, t) => {
    if (!over(p)) return climb(g, p, t);
    if (b2.pressed || p.x > gate.cells[0].c * T) return goTo(ex)(g, p, t);
    return goTo(b1.x + b1.w / 2)(g, p, t);
  };
  const b = (g, p, t) => {
    if (!over(p)) return b1.pressed ? climb(g, p, t) : goTo(5 * T)(g, p, t);
    if (A.x > b2.x + 20 || A.inExit) return goTo(ex)(g, p, t);
    return goTo(b2.x + b2.w / 2)(g, p, t);
  };
  ok(run(g, [a, b], 60, g => g.done), '22. Mıknatıs bacası geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // Kutup kapısı: B kutbunu değiştirip kırmızı kapıdan geçer, kule ile anahtar, ikisi − olup mavi kapıdan, kapı, çıkış
  const g = new Game(L('kutup-kapisi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, key = g.keys[0], door = g.doors[0];
  const ledge = { surf: 8 * T, x0: 14 * T, x1: 18 * T }, baseX = 13 * T;
  const want = p => (p.x < 9 * T ? 1 : -1);   // kırmızı kapıya + , mavi kapıya − ile
  const swapTo = (p, t, pol) => (p.pol !== pol ? I({ swap: (t * 10 | 0) % 2 === 0 }) : null);
  const a = (g, p, t) => {
    if (door.open) return swapTo(p, t, -1) || goTo(ex)(g, p, t);
    if (key.holder === B || key.used) return swapTo(p, t, -1) || goTo(22 * T)(g, p, t);
    return swapTo(p, t, 1) || goTo(baseX)(g, p, t);
  };
  const b = (g, p, t) => {
    if (door.open) return swapTo(p, t, -1) || goTo(ex)(g, p, t);
    if (key.holder === p) return swapTo(p, t, -1) || goTo(door.cells[0].c * T)(g, p, t);
    if (p.x < 9 * T) return swapTo(p, t, 1) || goTo(10 * T)(g, p, t);
    if (surfOn(p, ledge)) return goTo(key.x + key.w / 2)(g, p, t);
    if (p.ground === A) return I({ jump: (t * 5 | 0) % 2 === 0, right: p.y + p.h < 8 * T });
    if (!p.supported && p.y + p.h < 10 * T) return I({ jump: p.vy < 0, right: p.y + p.h < 8 * T });
    if (Math.abs(A.x + A.w / 2 - baseX) > 8 || !A.supported) return goTo(baseX - 60)(g, p, t);
    return climbOn(A)(g, p, t);
  };
  ok(run(g, [a, b], 60, g => g.done), '23. Kutup kapısı geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // İkiye bölün: + kırmızı zeminden sol odaya, − mavi zeminden sağ odaya düşer; şalterle birbirine kapı açar
  const g = new Game(L('ikiye-bolun'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2;
  const lv = ch => g.levers.find(l => l.channel === ch);
  const room = (holeX, lever, gateCh) => (g, p, t) => {
    if (p.y + p.h <= 5 * T + 1) return goTo(holeX)(g, p, t);                       // üstteyken deliğe yürü
    if (!g.switches[lever.channel]) return overlap(grow(p, 6), lever) ? I({ action: (t * 6 | 0) % 2 === 0 }) : goTo(lever.x + T / 2)(g, p, t);
    return g.switches[gateCh] ? goTo(ex)(g, p, t) : idle();
  };
  const a = room(7 * T, lv(2), 1), b = room(25 * T, lv(1), 2);
  ok(run(g, [a, b], 40, g => g.done), '24. İkiye bölün geçildi (' + g.t.toFixed(1) + ' sn)');
  const solo = new Game(L('ikiye-bolun'), 1);
  ok(!run(solo, [room(7 * T, lv(2), 1)], 20, g => g.done), 'İkiye bölün tek kişiyle geçilemez');
}
{
  // Çekirdek: tavandan geç, − olup mavi kapıdan, sandığı indir ve duvara it, fırlat ve çek
  const g = new Game(L('cekirdek'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0];
  const ha = hangAcross(7 * T + 20, 18 * T, 1), hb = hangAcross(7 * T + 20, 18 * T, 1);   // şeridin karadaki ucunda bırak
  const swapTo = (p, t, pol) => (p.pol !== pol ? I({ swap: (t * 10 | 0) % 2 === 0 }) : null);
  // Öndeki (B) önce geçer, A arkada bekler
  const across = [
    (g, p, t) => (p.x > 22 * T ? null : B.x < 18 * T ? (p.x > 2 * T ? goTo(2 * T)(g, p, t) : idle()) : ha(g, p, t) || swapTo(p, t, -1) || goTo(22 * T + 20)(g, p, t)),
    (g, p, t) => (p.x > 22 * T ? null : hb(g, p, t) || swapTo(p, t, -1) || goTo(23 * T + 10)(g, p, t)),
  ];
  const down = () => crate.y + crate.h >= 13 * T - 1, atWall = () => crate.x + crate.w >= 30 * T - 1;
  const behind = p => p.x + p.w <= crate.x + 3 && p.supported && p.ground !== crate;
  const fetch = [
    (g, p, t) => {
      if (down()) return null;
      if (crate.ground === p) return I({ left: true });
      if (crate.y + crate.h > 9 * T + 2) return goTo(27 * T + 127)(g, p, t);
      return Math.abs(p.x + p.w / 2 - (27 * T + 37)) > 6 ? goTo(27 * T + 37)(g, p, t) : I({ action: true });
    },
    (g, p, t) => (down() ? null : idle()),
  ];
  const push = [
    (g, p, t) => (atWall() ? null : behind(p) ? I({ right: true }) : goTo(crate.x - 50)(g, p, t)),
    (g, p, t) => (atWall() ? null : p.x > crate.x + crate.w ? idle() : goTo(crate.x - 90)(g, p, t)),
  ];
  const both = () => [A, B].every(p => p.supported && p.y + p.h <= 9 * T + 1);
  const ctl = phases([across, fetch, push, climbWall(g, A, B, 30 * T - crate.w / 2, 30 * T, 9 * T, both), [goTo(ex), goTo(ex)]]);
  ok(run(g, ctl, 90, g => g.done), '25. Çekirdek geçildi (' + g.t.toFixed(1) + ' sn)');
}

console.log('Pusula parçası bölümleri');
const swapTo = (p, t, pol) => (p.pol !== pol ? I({ swap: (t * 10 | 0) % 2 === 0 }) : null);
// Yayın üstüne yürü, orada yerinde zıpla ve tuşu basılı tut: yaya geri düşünce güçlü fırlar
const toSpringAt = sp => (g, p, t) => {
  const d = sp.x + sp.w / 2 - (p.x + p.w / 2);
  if (!p.supported) return I({ right: d > 4, left: d < -4, jump: true });
  if (Math.abs(d) > 8) return I({ right: d > 0, left: d < 0 });
  return I({ jump: true });
};
{
  // Uzun yol: platformla sütuna, oradan biri iter öbürü çeker
  const g = new Game(L('uzun-yol'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, M = g.movers[0];
  const [ra, rb] = rideBoth(M, A, B);
  const onPillar = p => p.supported && !p.ground && p.x > 20 * T - 10 && p.x < 22 * T;
  const toPillar = [(g, p, t) => (onPillar(A) && onPillar(B) ? null : ra(g, p, t) || I({ right: p.x + p.w < 22 * T - 2 && p.x < B.x - p.w - 4 })),
                    (g, p, t) => (onPillar(A) && onPillar(B) ? null : rb(g, p, t) || I({ right: p.x + p.w < 22 * T - 2 }))];
  const across = () => A.x > 28 * T - 10 && B.x > 28 * T - 10 && A.supported;
  const ctl = phases([toPillar, crossPit(g, A, B, 22 * T, 28 * T, across), [goTo(ex), goTo(ex)]]);
  ok(run(g, ctl, 60, g => g.done), '26. Uzun yol geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // Anahtar zinciri: kule ile ilk anahtar; öndeki B ikinci anahtarı raftan mıknatısla indirir, A geride bekler
  const g = new Game(L('anahtar-zinciri'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2;
  const [k1, k2] = g.keys.slice().sort((p, q) => p.x - q.x), [d1, d2] = g.doors.slice().sort((p, q) => p.cells[0].c - q.cells[0].c);
  const ledge = { surf: 8 * T, x0: 2 * T, x1: 5 * T }, baseX = 5 * T + 22;
  const a = (g, p, t) => {
    if (d2.open) return goTo(ex)(g, p, t);
    if (d1.open) return goTo(6 * T)(g, p, t);   // B'nin mıknatısından uzak dur
    return goTo(baseX)(g, p, t);
  };
  const b = (g, p, t) => {
    if (d2.open) return goTo(ex)(g, p, t);
    if (k2.holder === p) return goTo(d2.cells[0].c * T)(g, p, t);
    if (d1.open) {   // ikinci oda: raftaki anahtarı mıknatısla indir
      const at = 20 * T + 30, cx = p.x + p.w / 2;
      if (k2.y + k2.h >= 11 * T - 1) return goTo(k2.x + k2.w / 2)(g, p, t);
      return Math.abs(cx - at) > 6 ? goTo(at)(g, p, t) : I({ action: true });
    }
    if (k1.holder === p) return goTo(d1.cells[0].c * T)(g, p, t);
    if (surfOn(p, ledge)) return goTo(k1.x + k1.w / 2)(g, p, t);
    if (p.ground === A) return I({ jump: (t * 5 | 0) % 2 === 0, left: p.y + p.h < 8 * T });
    if (!p.supported && p.y + p.h < 10 * T) return I({ jump: p.vy < 0, left: p.y + p.h < 8 * T });
    if (Math.abs(A.x + A.w / 2 - baseX) > 8 || !A.supported) return goTo(baseX + 60)(g, p, t);
    return climbOn(A)(g, p, t);
  };
  ok(run(g, [a, b], 60, g => g.done), '27. Anahtar zinciri geçildi (' + g.t.toFixed(1) + ' sn)');
}
// Asma bahçe ve finaldeki tırmanış: yay → tavan → (bırak) → platform → mıknatıslı duvar → üst kat
function gardenClimb(g, sp, stripEnd, wallX, topY, stripBottom) {
  const climbed = new Set();
  return (g, p, t) => {
    const cx = p.x + p.w / 2;
    if (p.supported && p.y + p.h <= topY + 1) climbed.add(p);
    if (climbed.has(p)) return p.pol === 1 ? I({ swap: true, right: true }) : null;   // üstte: duvardan ayrıl
    const hanging = !p.supported && p.gripT > 0 && !p.wallSide && Math.abs(p.y - stripBottom) < 8;   // tavan şeridinin altında asılı
    if (hanging) return cx > stripEnd ? I({ swap: true }) : I({ right: true });
    if (p.wallSide || (p.supported && p.y + p.h <= 11 * T + 1 && cx > stripEnd - 20)) {   // platformda ya da duvarda
      if (p.pol !== 1) return I({ swap: (t * 10 | 0) % 2 === 0 });
      if (p.supported && p.x + p.w < wallX - 3) return I({ right: true });
      return I({ right: true, jump: (t * 6 | 0) % 2 === 0 });
    }
    if (p.pol !== 1) return I({ swap: (t * 10 | 0) % 2 === 0 });
    return toSpringAt(sp)(g, p, t);
  };
}
{
  // Asma bahçe: B aşağıdaki düğmede, A tırmanıp içerideki düğmeye basar; B tırmanır; ikisi çıkar
  const g = new Game(L('asma-bahce'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, sp = g.springs[0];
  const [low, high] = g.buttons.slice().sort((p, q) => q.y - p.y), gate = g.gates[0];
  const ca = gardenClimb(g, sp, 13 * T + 20, 19 * T, 3 * T, 8 * T), cb = gardenClimb(g, sp, 13 * T + 20, 19 * T, 3 * T, 8 * T);
  const a = (g, p, t) => {
    if (p.y + p.h > 11 * T + 1 && p.x < 7 * T && p.supported) return goTo(7 * T)(g, p, t);   // düğmedekinin üstünden atla
    const c = ca(g, p, t); if (c) return c;
    if (B.y + B.h <= 3 * T + 1 && B.x > gate.cells[0].c * T) return goTo(ex)(g, p, t);
    return goTo(high.x + high.w / 2)(g, p, t);
  };
  const b = (g, p, t) => {
    if (!high.pressed && !(p.y + p.h <= 3 * T + 1)) return p.y + p.h > 11 * T + 1 ? goTo(low.x + low.w / 2)(g, p, t) : cb(g, p, t);
    const c = cb(g, p, t); if (c) return c;
    return goTo(ex)(g, p, t);
  };
  ok(run(g, [a, b], 90, g => g.done), '28. Asma bahçe geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // Fırtınanın gözü: asansörle sırayla yukarı, gezgin platformla karşıya, kırmızı kapıdan + kutupla
  const g = new Game(L('firtinanin-gozu'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, lift = g.lifts[0], M = g.movers[0];
  const [high, low] = g.buttons.slice().sort((p, q) => p.y - q.y), liftX = lift.x + lift.w / 2;
  const up = () => lift.y <= lift.topY + 0.5, down = () => lift.y >= lift.oy - 0.5, onLift = p => p.ground === lift;
  const upstairs = p => p.supported && p.y + p.h <= 6 * T + 1 && p.x > lift.x + lift.w - 10;
  let phase = 0;
  const a = (g, p, t) => {
    if (upstairs(p)) return null;
    if (phase === 0) return onLift(B) || !down() ? goTo(low.x + low.w / 2)(g, p, t) : goTo(5 * T)(g, p, t);
    if (onLift(p) || (p.supported && p.y + p.h <= 6 * T + 1)) return up() || !onLift(p) ? I({ right: true }) : idle();
    return down() ? goTo(liftX)(g, p, t) : goTo(5 * T)(g, p, t);
  };
  const b = (g, p, t) => {
    if (upstairs(p)) {
      if (phase === 0) phase = 1;
      if (upstairs(A)) return null;
      return onLift(A) && down() || !down() && onLift(A) ? goTo(high.x + high.w / 2)(g, p, t) : goTo(14 * T)(g, p, t);
    }
    if (onLift(p) || (p.supported && p.y + p.h <= 6 * T + 1)) return up() || !onLift(p) ? I({ right: true }) : idle();
    return goTo(liftX)(g, p, t);
  };
  const [ra, rb] = rideBoth(M, A, B);
  const gate = [(g, p, t) => swapTo(p, t, 1) || goTo(ex)(g, p, t), (g, p, t) => swapTo(p, t, 1) || goTo(ex)(g, p, t)];
  const acrossBoth = () => [A, B].every(p => p.x > 27 * T - 5 && p.supported && !p.ground);
  const ride2 = [(g, p, t) => (acrossBoth() ? null : ra(g, p, t) || goTo(28 * T + 4)(g, p, t)),
                 (g, p, t) => (acrossBoth() ? null : rb(g, p, t) || goTo(28 * T + 4)(g, p, t))];
  const ctl = phases([[a, b], ride2, gate]);
  ok(run(g, ctl, 90, g => g.done), '29. Fırtınanın gözü geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // Pusula parçası: platform, yay ve tavan, mavi kapı, sandık, fırlatma ve çekme, pusula parçası ve kapı
  const g = new Game(L('pusula-parcasi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, M = g.movers[0], sp = g.springs[0];
  const crate = g.boxes[0], piece = g.keys[0], door = g.doors[0];
  const [ra, rb] = rideBoth(M, A, B);
  const across1 = () => [A, B].every(p => p.x > 15 * T - 5 && p.supported && !p.ground);
  const pit1 = [(g, p, t) => (across1() ? null : ra(g, p, t) || goTo(16 * T)(g, p, t)),
                (g, p, t) => (across1() ? null : rb(g, p, t) || goTo(17 * T + 20)(g, p, t))];
  // Tavandan sırayla: önce öndeki (B), sonra A
  const hang = p => {
    const cx = p.x + p.w / 2;
    if (p.x > 29 * T - 10 && p.supported) return null;
    if (p.pol !== 1 && (p.supported && cx < 29 * T)) return I({ swap: (g.t * 10 | 0) % 2 === 0 });
    if (!p.supported && p.gripT > 0 && p.y < 12 * T) return cx > 29 * T + 15 ? I({ swap: true }) : I({ right: true });
    if (!p.supported) return I({ right: cx > 20 * T, jump: true });
    return toSpringAt(sp)(g, p, g.t);
  };
  const strip = [(g, p, t) => (B.x < 29 * T - 10 || !B.supported ? (p.x > 16 * T ? goTo(16 * T)(g, p, t) : idle()) : hang(p)), (g, p, t) => hang(p)];
  // Mavi kapıdan − kutupla: önce A geçip ilerler, sonra B
  const gateN = [(g, p, t) => (p.x > 36 * T - 5 ? null : swapTo(p, t, -1) || goTo(36 * T + 17)(g, p, t)),
                 (g, p, t) => (p.x > 35 * T - 5 ? null : A.x < 36 * T - 5 ? (p.x > 31 * T ? idle() : goTo(31 * T)(g, p, t)) : swapTo(p, t, -1) || goTo(35 * T + 10)(g, p, t))];
  const down = () => crate.y + crate.h >= 17 * T - 1, atWall = () => crate.x + crate.w >= 40 * T - 1;
  const behind = p => p.x + p.w <= crate.x + 3 && p.supported && p.ground !== crate;
  const fetch = [
    (g, p, t) => {
      if (down()) return null;
      if (crate.ground === p) return I({ right: true });
      if (crate.y + crate.h > 13 * T + 2) return goTo(35 * T + 20)(g, p, t);
      // Rafın sol ucunun çaprazında (− kutupla mavi kapının içinde) dur, sandığı çapraz çek
      return Math.abs(p.x + p.w / 2 - (34 * T + 20)) > 8 ? goTo(34 * T + 20)(g, p, t) : I({ action: true });
    },
    // B kapının solunda + kutupta bekler: A'nın mıknatısı onu kapıya doğru çeker (− olsa çukura iterdi)
    (g, p, t) => (down() ? null : crate.ground === p ? I({ right: true }) : swapTo(p, t, 1) || (p.x > 32 * T ? idle() : goTo(32 * T)(g, p, t))),
  ];
  const push = [
    (g, p, t) => (atWall() ? null : behind(p) ? I({ right: true }) : goTo(crate.x - 50)(g, p, t)),
    (g, p, t) => (atWall() ? null : swapTo(p, t, -1) || (p.x > crate.x + crate.w ? idle() : goTo(Math.max(35 * T + 10, crate.x - 90))(g, p, t))),
  ];
  const both = () => [A, B].every(p => p.supported && p.y + p.h <= 13 * T + 1 && p.x > 39 * T);
  const finish = [(g, p, t) => (door.open ? goTo(ex)(g, p, t) : goTo(piece.holder ? door.cells[0].c * T : piece.x + piece.w / 2)(g, p, t)),
                  (g, p, t) => (door.open ? goTo(ex)(g, p, t) : piece.holder === p ? goTo(door.cells[0].c * T)(g, p, t) : idle())];
  const ctl = phases([pit1, strip, gateN, fetch, push, climbWall(g, A, B, 40 * T - crate.w / 2, 40 * T, 13 * T, both), finish]);
  ok(run(g, ctl, 150, g => g.done), '30. Pusula parçası geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // Ağ: şalter, asansör ve yayın durumu yeni bir Game'e aktarılabilir olmalı (sunucu bunları yollar)
  const g = new Game(L('asansor'), 2);
  ok(Array.isArray(g.lifts) && Array.isArray(g.levers) && Array.isArray(g.springs) && g.switches, 'yeni öğelerin durumu Game üzerinde');
}

{
  // Biri düşerse son yerinde doğar; ikisi de düşerse bölüm baştan başlar
  const g = new Game(L('gezgin'), 2), [A, B] = g.players;
  run(g, [idle, idle], 0.3);
  A.x = 8 * T; run(g, [() => I({ right: true }), idle], 4, g => g.effects.some(e => e.type === 'respawn'));
  ok(!g.wantRestart, 'biri düşünce bölüm baştan başlamaz');
  const h = new Game(L('gezgin'), 2);
  run(h, [idle, idle], 0.3);
  h.players.forEach(p => { p.x = 8 * T + p.index * 40; });
  run(h, [() => I({ right: true }), () => I({ right: true })], 4, g => g.wantRestart);
  ok(h.wantRestart, 'ikisi de düşünce bölüm baştan başlar');
}

{
  // Kapak, içinde duran oyuncu varken de kapanır: oyuncu yana itilir (düğmeden inen arkadaşına açık tutamaz)
  const g = new Game(L('uzun-atlama'), 2), [A, B] = g.players, gate = g.gates.find(x => x.channel === 1), btn = g.buttons[0];
  A.x = btn.x; A.y = btn.y + btn.h - A.h;
  const c = gate.cells[0].c;
  B.x = c * T + 3; B.y = 11 * T - B.h;
  run(g, [idle, idle], 0.3);
  const openWhileHeld = gate.open;
  A.x = 2 * T;
  run(g, [idle, idle], 0.3);
  ok(openWhileHeld && !gate.open && (B.x + B.w <= c * T || B.x >= (c + 1) * T), 'düğmeden inince kapak kapanır, içindeki yana itilir');
}

console.log('Fabrika öğeleri');
{
  const mk = (map, n) => new Game({ name: 'Deneme', map }, n || 1);
  // Taşıyıcı bant üstündekini taşır
  const g = mk(['##########', '#........#', '#........#', '#S......E#', '##>>>>>###']), p = g.players[0];
  p.x = 2 * T + 3; p.y = 4 * T - p.h;
  const x0 = p.x;
  run(g, [idle], 1);
  ok(p.x - x0 > 90 && p.x - x0 < 130, 'bant duran oyuncuyu sağa taşır (' + Math.round(p.x - x0) + ' px)');
}
{
  // Pres iner; altında kalan ezilmez, yana fırlar; pres zeminde bekleyip geri çıkar
  const g = new Game({ name: 'Deneme', map: ['##########', '#...7....#', '#........#', '#E......S#', '##########'] }, 1);
  const p = g.players[0], P = g.presses[0];
  p.x = 4 * T + 3; p.y = 4 * T - p.h;
  let bonk = false, low = P.y;
  run(g, [idle], 4, g => { bonk = bonk || g.effects.some(e => e.type === 'bonk'); low = Math.max(low, P.y); return false; });
  ok(bonk && (p.x + p.w <= P.x || p.x >= P.x + P.w), 'presin altında kalan yana fırlar');
  ok(Math.abs(low - 3 * T) < 1, 'pres zemine kadar iner (' + low + ')');
  let back = false;
  run(g, [idle], 3, () => { back = back || P.y <= P.topY + 0.5; return false; });
  ok(back, 'pres geri çıkar');
}
{
  // Pres kanalı açıkken yukarıda bekler
  const g = new Game({ name: 'Deneme', map: ['##########', '#...7....#', '#........#', '#S.1....E#', '##########'] }, 1);
  const p = g.players[0], P = g.presses[0], btn = g.buttons[0];
  p.x = btn.x; p.y = btn.y + btn.h - p.h;
  let moved = false;
  run(g, [idle], 4, () => { moved = moved || P.y > P.topY + 1; return false; });
  ok(!moved, 'düğmeye basılıyken pres yukarıda bekler');
}
{
  // Zamanlı düğme bırakıldıktan sonra kanalı birkaç saniye daha açık tutar
  const g = new Game({ name: 'Deneme', map: ['##########', '#........#', '#....a...#', '#S.t.a..E#', '##########'] }, 1);
  const p = g.players[0], btn = g.buttons[0], gate = g.gates[0];
  p.x = btn.x; p.y = btn.y + btn.h - p.h;
  run(g, [idle], 0.3);
  p.x = 1 * T + 3;
  run(g, [idle], PHYS.timerHold - 1);
  const stillOpen = gate.open;
  run(g, [idle], 1.5);
  ok(stillOpen && !gate.open, 'zamanlı düğme kanalı ' + PHYS.timerHold + ' sn açık tutar, sonra kapanır');
}

console.log('Buzul öğeleri');
// Geçici bölümle oyun kur (LEVELS'e eklenip hemen çıkarılır)
const tmpGame = (map, extra = {}) => {
  LEVELS.push(Object.assign({ id: 'tmp', name: 'tmp', hint: '', map }, extra));
  const g = new Game(LEVELS.length - 1, 2);
  LEVELS.pop();
  return g;
};
const flat = (floor, row10 = '#.SS' + '.'.repeat(27) + '#') => ['#'.repeat(32)].concat(Array(9).fill('#' + '.'.repeat(30) + '#'), [row10, floor]);
{
  // Kaygan buz: koşup bırakınca uzun kayar; normal zeminde hemen durur
  const slide = floor => {
    const g = tmpGame(flat(floor)), [A, B] = g.players;
    B.x = 1 * T; A.x = 4 * T;
    run(g, [() => I({ right: true }), idle], 1.2);
    const x0 = A.x;
    run(g, [idle, idle], 3);
    return A.x - x0;
  };
  const onIce = slide('#' + '~'.repeat(30) + '#'), onRock = slide('#'.repeat(32));
  ok(onIce > 3 * T && onRock < T, 'kaygan buzda bırakınca uzun kayar (' + (onIce / T).toFixed(1) + ' karo; normal zeminde ' + (onRock / T).toFixed(1) + ')');
  // Buzda hızlanmak da yavaş: aynı sürede daha az yol
  const g = tmpGame(flat('#' + '~'.repeat(30) + '#')), [A, B] = g.players;
  B.x = 1 * T; A.x = 4 * T;
  run(g, [() => I({ right: true }), idle], 0.3);
  ok(A.vx < PHYS.runSpeed * 0.7, 'kaygan buzda hızlanmak yavaş (' + A.vx.toFixed(0) + ' px/sn)');
}
{
  // Metal sandık buzda itilince duvara kadar kayar
  const g = tmpGame(flat('#' + '~'.repeat(30) + '#', '#.SS..M' + '.'.repeat(24) + '#')), [A, B] = g.players, c = g.boxes[0];
  B.x = 1 * T; A.x = c.x - A.w - 1;
  run(g, [() => I({ right: true }), idle], 0.4);
  run(g, [() => I({ left: true }), idle], 8);
  ok(c.x + c.w >= 31 * T - 1, 'metal sandık buzda duvara kadar kayar (' + (c.x / T).toFixed(1) + ')');
}
{
  // Eriyen buz: basınca çatlar, 1 sn sonra kırılır (üstündeki düşer), boşken 3 sn sonra yeniden donar
  const floor = '#'.repeat(10) + 'ooo' + '#'.repeat(19);
  const g = tmpGame(flat(floor)), [A, B] = g.players, th = g.thaws[1];
  B.x = 1 * T; A.x = 11 * T + 3; A.y = 11 * T - A.h - 2;
  run(g, [idle, idle], 0.6);
  const holds = !th.open && th.crackT > 0 && A.supported;
  run(g, [idle, idle], 0.6);
  const broke = th.open;
  run(g, [idle, idle], 1.5);
  const fell = A.x < 10 * T || A.x > 13 * T || A.y < 11 * T - A.h - 1;   // düştü ve son sağlam yerde doğdu
  run(g, [idle, idle], 3);
  ok(holds && broke && fell && !th.open, 'eriyen buz çatlar, 1 sn sonra kırılır, sonra yeniden donar');
}
{
  // Kar topu: karda yuvarlanınca büyür; büyüyünce tek kişi itemez, iki kişi iter; buzda büyümez
  const g = tmpGame(flat('#'.repeat(32), '#.SS..O' + '.'.repeat(24) + '#')), [A, B] = g.players, sb = g.boxes[0];
  B.x = 1 * T; A.x = sb.x - A.w - 1;
  run(g, [() => I({ right: true }), idle], 2.5);
  const grew = sb.big && sb.w === PHYS.snowBig;
  const x1 = sb.x;
  run(g, [() => I({ right: true }), idle], 1);
  const solo = sb.x - x1;
  B.x = A.x - B.w - 1; B.y = A.y;
  run(g, [() => I({ right: true }), () => I({ right: true })], 1);
  ok(grew && solo < 2 && sb.x - x1 > 40, 'kar topu karda büyür; büyükken tek kişi itemez, iki kişi iter');
  const g2 = tmpGame(flat('#' + '~'.repeat(30) + '#', '#.SS..O' + '.'.repeat(24) + '#')), [A2, B2] = g2.players, s2 = g2.boxes[0];
  B2.x = 1 * T; A2.x = s2.x - A2.w - 1;
  run(g2, [() => I({ right: true }), idle], 0.5);
  run(g2, [() => I({ left: true }), idle], 8);
  ok(!s2.big && s2.x + s2.w >= 31 * T - 1, 'kar topu buzda büyümez, duvara kadar kayar');
}
{
  // Kar topu mıknatısla çekilmez
  const g = tmpGame(flat('#'.repeat(32), '#.SS..O' + '.'.repeat(24) + '#'), { magnet: true }), [A, B] = g.players, sb = g.boxes[0];
  B.x = 20 * T; A.x = sb.x + 80;
  const x0 = sb.x;
  run(g, [() => I({ action: true }), idle], 1);
  ok(Math.abs(sb.x - x0) < 1, 'kar topu mıknatısla çekilmez');
}

{
  // Yay hafif nesneleri de fırlatır (küçük kar topu, metal sandık); büyük top ve ağır kutu fırlamaz
  const lift = ch => {
    const g = tmpGame(flat('#'.repeat(32), '#.SS..' + ch + '^' + '.'.repeat(23) + '#')), [A, B] = g.players, b = g.boxes[0];
    if (ch === 'O' && lift.big) { b.w = b.h = PHYS.snowBig; b.big = true; b.y = 11 * T - b.w; }
    B.x = 1 * T; A.x = b.x - A.w - 1;
    let minY = b.y;
    run(g, [(g, p) => I({ right: p.x + p.w < 7 * T - 2 }), idle], 3, () => { minY = Math.min(minY, b.y); return false; });
    return b.y + b.h - (minY + b.h);
  };
  const small = lift('O'), crate = lift('M');
  ok(small > 3 * T && crate > 3 * T, 'yay küçük kar topunu ve metal sandığı fırlatır (' + (small | 0) + ' / ' + (crate | 0) + ' px)');
}

console.log('Fabrika bölümleri');
// Bantta koşup çukurun kenarında zıpla (bant hız verir); karşıya inince biter
const longJump = (edgeX, landX) => (g, p, t) => {
  if (p.supported && p.x > landX) return null;
  if (p.supported && p.x + p.w < edgeX + 10) return I({ right: true });
  return I({ right: true, jump: p.vy < 0 || p.supported });
};
// Arkadaşının başına çık, oradan yandaki yüksek yere zıpla (dir: 1 sağa, -1 sola)
const towerUp = (A, topSurf, dir) => (g, p, t) => {
  if (p.supported && p.y + p.h <= topSurf + 1) return null;
  if (p.ground === A) return I({ jump: (t * 5 | 0) % 2 === 0 });   // tuş kenar ister: aralıklı bas
  if (!p.supported && p.vy < 0 && p.y + p.h < topSurf + 6) return I({ jump: true, right: dir > 0, left: dir < 0 });
  return climbOn(A)(g, p, t);
};
// Perdede tam zıplayıp surf yüzeyine çık: x'te zıplar, surf'ün üstüne geçince dir yönüne süzülür
const perdeUp = (x, surf, dir) => (g, p, t) => {
  if (p.supported && p.y + p.h <= surf + 1) return null;
  if (p.supported && Math.abs(p.x + p.w / 2 - x) > 6) return goTo(x)(g, p, t);
  return I({ jump: !p.supported || (t * 5 | 0) % 2 === 0, right: dir > 0 && !p.supported && p.y + p.h < surf, left: dir < 0 && !p.supported && p.y + p.h < surf });
};
// Perdede kule: A'nın başına çık, oradan zıpla; surf'ün üstüne geçince sağa süzül
const towerPerde = (A, surf, belowY) => (g, p, t) => {
  if (p.supported && p.y + p.h <= surf + 1) return null;
  if (p.ground === A) return I({ jump: (t * 5 | 0) % 2 === 0 });
  if (!p.supported && p.vy < 200 && p.y + p.h < belowY) return I({ jump: true, right: p.y + p.h < surf });
  return climbOn(A)(g, p, t);
};
// Kutunun üstünden sağa atla
const hopPast = box => (g, p, t) => (p.supported && !p.ground && p.x > box.x + box.w + 2 ? null : I({ right: true, jump: !p.supported || (t * 4 | 0) % 2 === 0 }));
const flip = (lv, ch) => (g, p, t) => (g.switches[ch] ? null : Math.abs(p.x + p.w / 2 - (lv.x + T / 2)) > 10 ? goTo(lv.x + T / 2)(g, p, t) : I({ action: tap(t) }));
{
  // F1. Uzun atlama: A düğmede, B bantla çukuru aşar ve şalteri çevirir; A da aşar; kule ile duvara, şalter ile kapak
  const g = new Game(L('uzun-atlama'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2;
  const btn = g.buttons[0], [lv1, lv2] = g.levers.slice().sort((p, q) => p.x - q.x);
  const hold = (g, p, t) => (g.switches[1] ? null : goTo(btn.x + btn.w / 2)(g, p, t));
  const ctl = phases([
    [hold, (g, p, t) => (g.gates[0].open || g.switches[1] ? longJump(14 * T, 19 * T)(g, p, t) || flip(lv1, 1)(g, p, t) : goTo(7 * T)(g, p, t))],
    [longJump(14 * T, 19 * T), (g, p, t) => (A.x > 19 * T ? null : idle())],
    [(g, p, t) => (p.supported && p.y + p.h <= 8 * T + 1 ? null : Math.abs(B.x + B.w / 2 - (25 * T + 17)) < 8 && B.supported ? towerUp(B, 8 * T, 1)(g, p, t) : goTo(23 * T)(g, p, t)),
     (g, p, t) => (A.supported && A.y + A.h <= 8 * T + 1 ? null : Math.abs(p.x + p.w / 2 - (25 * T + 17)) > 6 ? goTo(25 * T + 17)(g, p, t) : idle())],
    [flip(lv2, 2), (g, p, t) => (g.switches[2] ? null : idle())],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'F1. Uzun atlama geçildi (' + g.t.toFixed(1) + ' sn)');
}

// Preslerin altından geç: sıradaki presin sütununa yalnızca pres yukarıda ve beklemesi yetecekken gir
const passPresses = (presses, toX, speed = PHYS.runSpeed, hover = false) => (g, p, t) => {
  if (p.x + p.w / 2 >= toX - 6) return null;
  const next = presses.filter(P => P.x + P.w > p.x).sort((a, b) => a.x - b.x)[0];
  if (next && p.x + p.w > next.x - 14 && p.x < next.x + next.w) {
    const inside = p.x + p.w > next.x;
    const safe = (next.y <= next.topY + 1 && next.dir > 0 && next.pause > (next.w + p.w + 20) / speed) || g.channelOn(next.channel);
    if (!inside && !safe) return hover && p.x + p.w > next.x - 30 ? I({ left: true }) : I();   // sütunun önünde bekle (ileri akan bantta geri yürüyerek)
  }
  return goTo(toX)(g, p, t);
};
{
  // F2. Pres hattı: kule ile raftan anahtar; B anahtarla preslerden zamanlayarak geçer, düğmede presleri tutar; A geçer
  const g = new Game(L('pres-hatti'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, key = g.keys[0], door = g.doors[0], btn = g.buttons[0];
  const base = 4 * T + 20;
  const ctl = phases([
    [(g, p, t) => (key.holder ? null : Math.abs(p.x + p.w / 2 - base) > 6 ? goTo(base)(g, p, t) : idle()),
     (g, p, t) => (key.holder ? null : Math.abs(A.x + A.w / 2 - base) < 8 && A.supported ? towerUp(A, 8 * T, -1)(g, p, t) : goTo(6 * T)(g, p, t))],
    [(g, p, t) => (btn.pressed ? null : idle()), (g, p, t) => (Math.abs(p.x + p.w / 2 - (btn.x + btn.w / 2)) < 6 ? null : passPresses(g.presses, btn.x + btn.w / 2)(g, p, t))],
    [(g, p, t) => (p.x > 23 * T ? null : goTo(23 * T + 20)(g, p, t)), (g, p, t) => (A.x > 23 * T ? null : idle())],
    [(g, p, t) => (door.open ? goTo(ex)(g, p, t) : idle()), (g, p, t) => (door.open ? goTo(ex)(g, p, t) : goTo(door.cells[0].c * T)(g, p, t))],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'F2. Pres hattı geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F3. Vardiya: A düğmede cebi açar; B zamanlı düğmeye basıp kapak kapanmadan geçer, şalterle cebi açık bırakır; A da koşar
  const g = new Game(L('vardiya'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2;
  const tb = g.buttons.find(b => b.timed), b2 = g.buttons.find(b => !b.timed), lv = g.levers[0], gx = g.gates.find(x => x.channel === 1).cells[0].c * T;
  const on = (b, p) => Math.abs(p.x + p.w / 2 - (b.x + b.w / 2)) < 6;
  const pressed = new Set();   // zamanlı düğmeye basmış olan koşar
  const sprint = (g, p, t) => {
    if (p.x > gx + T) return null;
    if (on(tb, p)) pressed.add(p);
    return pressed.has(p) ? goTo(gx + 2 * T)(g, p, t) : goTo(tb.x + tb.w / 2)(g, p, t);
  };
  const ctl = phases([
    [(g, p, t) => (g.switches[2] ? null : p.x > gx + T ? flip(lv, 2)(g, p, t) : sprint(g, p, t)), (g, p, t) => (g.switches[2] ? null : goTo(b2.x + b2.w / 2)(g, p, t))],
    [(g, p, t) => (B.x > gx + T ? null : goTo(gx + 6 * T)(g, p, t)), (g, p, t) => (p.x > gx + T ? null : sprint(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'F3. Vardiya geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F4. Ters akıntı: B anahtarı alıp düğmede presleri tutar, A karşı bantta geçer; B anahtarla tek başına zamanlayarak geçer;
  // kapı açılır, kule ile duvarın üstüne, şalterle duvardaki kapak
  const g = new Game(L('ters-akinti'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, key = g.keys[0], door = g.doors[0], btn = g.buttons[0], lv = g.levers[0];
  const waitX = 23 * T + 20, base = 26 * T + 20, slow = PHYS.runSpeed - PHYS.beltSpeed;
  const ctl = phases([
    [(g, p, t) => (p.x > 22 * T ? null : btn.pressed ? passPresses(g.presses, waitX, slow)(g, p, t) : idle()),
     (g, p, t) => (A.x > 22 * T ? null : goTo(btn.x + btn.w / 2)(g, p, t))],
    [(g, p, t) => (door.open ? null : goTo(waitX)(g, p, t)), (g, p, t) => (door.open ? null : key.holder !== p ? goTo(key.x + key.w / 2)(g, p, t) : passPresses(g.presses, door.cells[0].c * T, slow)(g, p, t))],
    [(g, p, t) => (Math.abs(p.x + p.w / 2 - base) < 6 && p.supported ? null : goTo(base)(g, p, t)), (g, p, t) => (p.x > 24 * T ? null : goTo(24 * T + 10)(g, p, t))],
    [(g, p, t) => (B.supported && B.y + B.h <= 8 * T + 1 ? null : idle()), towerUp(A, 8 * T, 1)],
    [(g, p, t) => (g.switches[2] ? null : idle()), flip(lv, 2)],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'F4. Ters akıntı geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F5. Montaj sınavı: zamanlı düğme → bantla uzun atlama (inişteki pres kalkarken) → ikisi kutuyu düğmeye iter →
  // kutudan rafa, anahtar → kapı → çıkış
  const g = new Game(L('montaj-sinavi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, key = g.keys[0], door = g.doors[0];
  const tb = g.buttons.find(b => b.timed), P = g.presses[0], box = g.boxes[0];
  const landed = p => p.supported && p.x > 20 * T;
  // Zamanlı düğmeye bas; pres kalkmaya başlayınca koş ve atla, inince presin altından çık
  const cross = (g, p, t) => {
    if (landed(p)) return null;
    if (p.x > 13 * T) return p.supported && p.x > 17 * T ? goTo(21 * T)(g, p, t) : longJump(13 * T, 17 * T)(g, p, t) || goTo(21 * T)(g, p, t);
    const onT = Math.abs(p.x + p.w / 2 - (tb.x + tb.w / 2)) < 6;
    if (onT && P.dir < 0 && P.y > P.topY + 150) going.add(p);   // pres kalkarken yola çık, sonra durma
    if (!going.has(p)) return goTo(tb.x + tb.w / 2)(g, p, t);
    return longJump(13 * T, 17 * T)(g, p, t);
  };
  const going = new Set();
  const boxDone = () => box.x + box.w >= 29 * T - 1;
  const ctl = phases([
    [cross, (g, p, t) => (landed(A) ? null : idle())],
    [(g, p, t) => (landed(B) ? null : goTo(21 * T + 10)(g, p, t)), cross],
    [(g, p, t) => (boxDone() ? null : I({ right: true })), (g, p, t) => (boxDone() ? null : I({ right: true }))],
    [(g, p, t) => {
      if (door.open) return null;
      if (key.holder === p) return goTo(door.cells[0].c * T)(g, p, t);
      if (p.supported && p.y + p.h <= 8 * T + 1 && p.x > 29 * T) return goTo(key.x + key.w / 2)(g, p, t);   // rafta
      if (p.ground === box || (!p.supported && p.y + p.h < 9 * T)) return I({ right: true, jump: p.supported || p.vy < 0 });   // kutudan rafa
      return goTo(box.x + box.w / 2)(g, p, t);   // önce kutunun üstüne
    },
     (g, p, t) => (door.open ? null : idle())],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'F5. Montaj sınavı geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F6. Pres asansörü: pres aşağıda dururken önce A (sağ yarı), sonraki seferde B (sol yarı) üstüne yürür;
  // yukarıdaki beklemede B, A'nın başına çıkıp rafa atlar, anahtarı alır; A presle iner; kapı, çıkış
  const g = new Game(L('pres-asansoru'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, key = g.keys[0], door = g.doors[0], P = g.presses[0];
  const resting = () => P.dir < 0 && P.y > P.topY + 200;
  const atTop = () => P.y <= P.topY + 1 && P.dir > 0;
  const waitX = 6 * T + 20;
  // Presin sütununa girme; pres aşağıda dururken hedef yarıya yürü
  const board = slot => (g, p, t) => {
    if (p.ground === P) return Math.abs(p.x + p.w / 2 - (P.x + slot)) > 6 && resting() ? goTo(P.x + slot)(g, p, t) : null;
    if (resting()) return goTo(P.x + slot)(g, p, t);
    return p.x + p.w > P.x - 4 ? I({ left: true }) : goTo(waitX)(g, p, t);
  };
  const ctl = phases([
    [board(60), (g, p, t) => (A.ground === P ? null : p.x > 4 * T ? idle() : goTo(4 * T + 10)(g, p, t))],
    [(g, p, t) => (B.ground === P ? null : idle()), board(18)],
    [(g, p, t) => (key.holder ? null : idle()),
     (g, p, t) => {
       if (key.holder === p) return null;
       if (p.supported && p.y + p.h <= 2 * T + 1) return goTo(key.x + key.w / 2)(g, p, t);   // rafta
       if (p.ground === A || (!p.supported && p.y + p.h < A.y)) return towerUp(A, 2 * T, 1)(g, p, t);
       if (atTop() || (!p.supported && p.y + p.h < P.y)) return climbOn(A)(g, p, t);
       return p.ground === P ? idle() : board(18)(g, p, t) || idle();
     }],
    [(g, p, t) => (door.open ? goTo(ex)(g, p, t) : p.supported && p.y + p.h > 12 * T ? goTo(20 * T)(g, p, t) : I({ right: P.y > 10 * T })),
     (g, p, t) => (door.open ? goTo(ex)(g, p, t) : goTo(door.cells[0].c * T)(g, p, t))],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'F6. Pres asansörü geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F7. Kapan koridoru: A düğmede (2) kapağı açar; B zamanlı düğmeye basıp presler yukarıdayken karşı bantta koşar;
  // karşıda şalterle (5) kapağı açık bırakır, düğmede (1) presleri tutar; A yavaşça geçer
  const g = new Game(L('kapan-koridoru'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2;
  const tb = g.buttons.find(b => b.timed), b2 = g.buttons.find(b => b.channel === 2 && !b.timed), b1 = g.buttons.find(b => b.channel === 1 && !b.timed), lv = g.levers[0];
  const end = 22 * T, on = (b, p) => Math.abs(p.x + p.w / 2 - (b.x + b.w / 2)) < 6;
  let pressedT = false;
  const ctl = phases([
    [(g, p, t) => (g.switches[2] ? null : goTo(b2.x + b2.w / 2)(g, p, t)),
     (g, p, t) => {
       if (g.switches[2]) return null;
       if (p.x > end) return flip(lv, 2)(g, p, t);
       if (on(tb, p) && b2.pressed) pressedT = true;
       return pressedT ? goTo(end + 20)(g, p, t) : goTo(tb.x + tb.w / 2)(g, p, t);
     }],
    [(g, p, t) => (p.x > end ? null : b1.pressed ? goTo(end + 20)(g, p, t) : idle()), (g, p, t) => (A.x > end ? null : goTo(b1.x + b1.w / 2)(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'F7. Kapan koridoru geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F8. Vardiya değişimi: A düğmede (1) sol kapağı açar, B sol odada anahtarı alır ve u'ya basar (sağ kapak 4 sn);
  // A sağ odaya koşup t'nin üstünde durur (sol kapak açık); B u'ya yeniden basıp sağ kapak kapanmadan geçer; kapı, çıkış
  const g = new Game(L('vardiya-degisimi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, key = g.keys[0], door = g.doors[0];
  const u = g.buttons.find(b => b.timed && b.channel === 2), tt = g.buttons.find(b => b.timed && b.channel === 1), b1 = g.buttons.find(b => !b.timed);
  const bx = g.gates.find(x => x.channel === 2).cells[0].c * T, on = (b, p) => Math.abs(p.x + p.w / 2 - (b.x + b.w / 2)) < 6;
  let runStart = null, runTime = null;
  const ctl = phases([
    // 1) A sol kapağı tutar, B anahtarı alıp u'ya gider
    [(g, p, t) => (on(u, B) && key.holder === B ? null : goTo(b1.x + b1.w / 2)(g, p, t)),
     (g, p, t) => {
       if (on(u, p) && key.holder === p) return null;
       if (key.holder === p) return goTo(u.x + u.w / 2)(g, p, t);
       const shelf = { surf: 9 * T, x0: 6 * T, x1: 9 * T };
       if (surfOn(p, shelf)) return goTo(key.x + key.w / 2)(g, p, t);
       if (!p.supported && p.vy < 0) return I({ jump: true, left: p.y + p.h < 9 * T });   // rafa doğru
       return Math.abs(p.x - (9 * T + 4)) > 6 ? goTo(9 * T + 21)(g, p, t) : I({ jump: tap(t) });   // rafın sağından zıpla
     }],
    // 2) B u'da; A sağ kapak açılınca sağ odaya, t'ye koşar
    [(g, p, t) => (on(tt, p) ? null : u.left > 0 || p.x > bx ? goTo(tt.x + tt.w / 2)(g, p, t) : idle()), (g, p, t) => (on(tt, A) ? null : idle())],
    // 3) B u'dan bırakıp koşar: sol kapak A sayesinde açık, sağ kapak 4 sn açık
    [(g, p, t) => (B.x > bx + T ? null : idle()),
     (g, p, t) => { if (p.x > bx + T) { if (runTime === null) runTime = g.t - runStart; return null; } if (runStart === null && !u.pressed && u.left > 0) runStart = g.t; return goTo(bx + 2 * T)(g, p, t); }],
    [(g, p, t) => (door.open ? goTo(ex)(g, p, t) : idle()), (g, p, t) => (door.open ? goTo(ex)(g, p, t) : goTo(door.cells[0].c * T)(g, p, t))],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'F8. Vardiya değişimi geçildi (' + g.t.toFixed(1) + ' sn; son koşu ' + (runTime === null ? '-' : runTime.toFixed(2)) + ' / ' + PHYS.timerHold + ' sn)');
}

{
  // F9. Ritim: ikisi de ileri akan bantta, farklı ritimdeki dört presi zamanlayarak geçer (beklerken geri yürür);
  // sonda ağır kutuyu birlikte düğmeye iterler, kapak açılır
  const g = new Game(L('ritim'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, box = g.boxes[0];
  const out = 27 * T, fast = PHYS.runSpeed + PHYS.beltSpeed;
  const cross = (g, p, t) => (p.x > out ? null : passPresses(g.presses, out + 20, fast, true)(g, p, t));
  const boxDone = () => box.x + box.w >= 34 * T - 1;
  const ctl = phases([
    [cross, (g, p, t) => (A.x > 12 * T || p.x > out ? cross(g, p, t) : idle())],
    [(g, p, t) => (B.x > out ? null : goTo(28 * T)(g, p, t)), cross],
    [(g, p, t) => (boxDone() ? null : I({ right: true })), (g, p, t) => (boxDone() ? null : I({ right: true }))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'F9. Ritim geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F10. Atölye sınavı: pres asansörüyle (A sağ yarı, B sol yarı) yukarı; B, A'nın başından rafa, anahtar ve şalter (4);
  // koridorda A zamanlı düğmeye basıp presler yukarıdayken karşı bantta koşar, düğmede (3) presleri tutar; B anahtarla geçer
  const g = new Game(L('atolye-sinavi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, key = g.keys[0], door = g.doors[0];
  const P = g.presses[0], lv = g.levers[0], w = g.buttons.find(b => b.timed), b3 = g.buttons.find(b => !b.timed);
  const resting = () => P.dir < 0 && P.y > P.topY + 200, waitX = 4 * T + 20, ledge = { surf: 2 * T, x0: 8 * T, x1: 12 * T };
  const on = (b, p) => Math.abs(p.x + p.w / 2 - (b.x + b.w / 2)) < 6;
  const board = slot => (g, p, t) => {
    if (p.ground === P) return Math.abs(p.x + p.w / 2 - (P.x + slot)) > 6 && resting() ? goTo(P.x + slot)(g, p, t) : null;
    if (resting()) return goTo(P.x + slot)(g, p, t);
    return p.x + p.w > P.x - 4 ? I({ left: true }) : goTo(waitX)(g, p, t);
  };
  let ran = false;
  const ctl = phases([
    [board(60), (g, p, t) => (A.ground === P ? null : idle())],
    [(g, p, t) => (B.ground === P ? null : idle()), board(18)],
    [(g, p, t) => (key.holder && g.switches[1] ? null : idle()),
     (g, p, t) => {
       if (key.holder === p && g.switches[1]) return null;
       if (surfOn(p, ledge)) return key.holder === p ? flip(lv, 1)(g, p, t) : goTo(key.x + key.w / 2)(g, p, t);
       if (p.ground === A || (!p.supported && p.y + p.h < A.y)) return towerUp(A, 2 * T, 1)(g, p, t);
       if ((P.y <= P.topY + 1 && P.dir > 0) || (!p.supported && p.y + p.h < P.y)) return climbOn(A)(g, p, t);
       return p.ground === P ? idle() : board(18)(g, p, t) || idle();
     }],
    // İkisi de aşağı: B raftan atlar, A presle iner
    [(g, p, t) => (p.supported && p.y + p.h >= 13 * T - 1 ? null : p.ground === P ? (P.y > 10 * T ? I({ right: true }) : idle()) : idle()),
     (g, p, t) => (p.supported && p.y + p.h >= 13 * T - 1 ? null : I({ left: true }))],
    // A zamanlı düğmeye basıp koşar, karşıda düğmede durur; B anahtarla yavaşça geçer
    [(g, p, t) => {
       if (B.x > 25 * T) return null;
       if (on(b3, p)) return idle();
       if (on(w, p) && B.x > 8 * T) ran = true;
       return ran ? goTo(b3.x + b3.w / 2)(g, p, t) : goTo(w.x + w.w / 2)(g, p, t);
     },
     (g, p, t) => (p.x > 25 * T ? null : b3.pressed ? goTo(26 * T)(g, p, t) : goTo(10 * T)(g, p, t))],
    [(g, p, t) => (door.open ? goTo(ex)(g, p, t) : idle()), (g, p, t) => (door.open ? goTo(ex)(g, p, t) : goTo(door.cells[0].c * T)(g, p, t))],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'F10. Atölye sınavı geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F11. Paket: A düğmede (1) kapağı açar; B geçip karşıdaki düğmeye (2) basar: sandık banttan bacaya, oradan kapağın içine düşer;
  // içinde sandık olan kapak kapanmaz, ikisi de sandığın üstünden geçer
  const g = new Game(L('paket'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0];
  const b1 = g.buttons.find(b => b.channel === 1), b2 = g.buttons.find(b => b.channel === 2), ga = g.gates.find(x => x.channel === 1), gx = ga.cells[0].c * T;
  const wedged = () => crate.y + crate.h >= 11 * T - 1 && crate.x >= gx - 1 && crate.x + crate.w <= gx + T + 1;
  const ctl = phases([
    [(g, p, t) => (wedged() ? null : goTo(b1.x + b1.w / 2)(g, p, t)), (g, p, t) => (wedged() ? null : ga.open || p.x > gx ? goTo(b2.x + b2.w / 2)(g, p, t) : idle())],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'F11. Paket geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F12. Pres takozu: A düğmede (1) sandığı bırakır; sandık banttan düşüp presin altına girer, pres sandığın üstünde durur.
  // Pres yukarıdayken ikisi sandığın üstünden atlar, presin altından geçer; kule ile rafa, şalterle (5) kapak
  const g = new Game(L('pres-takozu'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0], P = g.presses[0];
  const b1 = g.buttons[0], lv = g.levers[0], out = 16 * T;
  const settled = () => crate.y + crate.h >= 11 * T - 1 && Math.abs(crate.dx) < 0.01 && crate.x > 9 * T - 20;
  const going = new Set();
  const cross = (g, p, t) => {
    if (p.x > out) return null;
    if (P.y <= P.topY + 1 && P.dir > 0 && P.pause > 0.9 && p.x + p.w < crate.x && p.x > crate.x - 80) going.add(p);
    if (!going.has(p)) return goTo(crate.x - 50)(g, p, t);
    if (p.x > crate.x + crate.w) return I({ right: true });   // presin altında zıplama: yürü
    return I({ right: true, jump: p.supported || p.vy < 0 });   // sandığın üstünden
  };
  const past = p => (A.x > out && B.x > out ? null : p.x > out ? goTo(p === A ? 17 * T + 20 : 19 * T + 20)(g, p, g.t) : null);
  const base = 22 * T + 20;
  const ctl = phases([
    [(g, p, t) => (settled() ? null : goTo(b1.x + b1.w / 2)(g, p, t)), (g, p, t) => (settled() ? null : goTo(5 * T)(g, p, t))],
    [(g, p, t) => (A.x > out && B.x > out ? null : past(p) || (B.x > out ? cross(g, p, t) || idle() : idle())),
     (g, p, t) => (A.x > out && B.x > out ? null : past(p) || cross(g, p, t) || idle())],
    [(g, p, t) => (Math.abs(p.x + p.w / 2 - base) < 6 && p.supported ? null : goTo(base)(g, p, t)), (g, p, t) => (A.x > 21 * T ? null : goTo(18 * T)(g, p, t))],
    [(g, p, t) => (B.supported && B.y + B.h <= 8 * T + 1 ? null : idle()), towerUp(A, 8 * T, -1)],
    [(g, p, t) => (g.switches[2] ? null : idle()), flip(lv, 2)],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'F12. Pres takozu geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F13. Vinç: bant anahtarı çukura döker; A çukurun kenarında, anahtar düşerken mıknatısla çeker (B menzil dışında).
  // Sonra Uçurum'daki gibi: B, A'yı karşıya iter; A kutup değiştirip B'yi çeker; kapı, çıkış
  const g = new Game(L('vinc'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, key = g.keys[0], door = g.doors[0];
  const edge = 11 * T + 20;
  const across = () => A.x > 18 * T - 10 && B.x > 18 * T - 10 && A.supported && B.supported;
  const ctl = phases([
    [(g, p, t) => (key.holder === p ? null : Math.abs(p.x + p.w / 2 - edge) > 6 ? goTo(edge)(g, p, t) : I({ action: key.vy > 0 && key.y > 4 * T })),
     (g, p, t) => (key.holder ? null : idle())],
    crossPit(g, B, A, 12 * T, 18 * T, across).reverse(),   // anahtarlı A öndedir: B onu iter, A karşıda B'yi çeker
    [(g, p, t) => (door.open ? goTo(ex)(g, p, t) : goTo(door.cells[0].c * T)(g, p, t)), (g, p, t) => (door.open ? goTo(ex)(g, p, t) : idle())],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'F13. Vinç geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F14. Kepçe: bant sandığı çukura döker; A kenarda mıknatısla yakalar (B raftaki düğmede, kapak açık).
  // A sandığı kapağın içine iter (basamak onu orada tutar): içinde sandık olan kapak kapanmaz. İkisi de geçer;
  // A, B'yi duvarın üstüne fırlatır, B kutup değiştirip A'yı çeker
  const g = new Game(L('kepce'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0];
  const catchX = 7 * T + 20, gx = 14 * T, btn = g.buttons[0];
  const caught = () => crate.supported && crate.x > 6 * T - 4 && crate.y + crate.h >= 11 * T - 1;
  const wedged = () => caught() && crate.x >= gx - 1;
  // B rafın sağından sola zıplayıp düğmenin üstünde durur
  const onBtn = (g, p, t) => {
    if (p.supported && p.y + p.h <= 9 * T + 1) return Math.abs(p.x + p.w / 2 - (btn.x + btn.w / 2)) > 4 ? goTo(btn.x + btn.w / 2)(g, p, t) : idle();
    if (p.x > 12 * T - 6) return I({ left: !p.supported && p.y + p.h < 9 * T, jump: p.supported ? tap(t) : true });   // zıpla, rafın üstüne çıkınca sola
    return goTo(13 * T)(g, p, t);
  };
  const both = () => [A, B].every(p => p.supported && p.y + p.h <= 6 * T + 1);
  const ctl = phases([
    [(g, p, t) => (caught() ? null : crate.ground === p ? I({ right: true }) : Math.abs(p.x + p.w / 2 - catchX) > 6 ? goTo(catchX)(g, p, t) : I({ action: !crate.supported && crate.vy > 0 && crate.y > 4 * T })),
     (g, p, t) => (caught() ? null : onBtn(g, p, t))],
    [(g, p, t) => (wedged() ? null : p.x + p.w <= crate.x + 3 && p.supported && p.ground !== crate ? I({ right: true }) : goTo(crate.x - p.w / 2 - 2)(g, p, t)),
     (g, p, t) => (wedged() ? null : onBtn(g, p, t))],
    [(g, p, t) => (A.x > 17 * T && B.x > 17 * T ? null : goTo(26 * T)(g, p, t)), (g, p, t) => (A.x > 17 * T && B.x > 17 * T ? null : A.x > 17 * T ? goTo(28 * T)(g, p, t) : idle())],
    climbWall(g, A, B, 30 * T, 32 * T, 6 * T, both),
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'F14. Kepçe geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F15. Paketleme sınavı: A düğmede (2) sandığı bırakır, sandık presin altına girer; ikisi pres yukarıdayken sandığın
  // üstünden atlayıp geçer. Bantla çukuru aşarlar; kule ile rafa, şalterle (4) kapak; çıkış
  const g = new Game(L('paketleme-sinavi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0], P = g.presses[0];
  const b2 = g.buttons[0], lv = g.levers[0], out = 16 * T, land = 28 * T, base = 32 * T + 20;
  const settled = () => crate.y + crate.h >= 11 * T - 1 && Math.abs(crate.dx) < 0.01 && crate.x > 9 * T - 20;
  const going = new Set();
  const cross = (g, p, t) => {
    if (p.x > out) return null;
    if (P.y <= P.topY + 1 && P.dir > 0 && P.pause > 0.9 && p.x + p.w < crate.x && p.x > crate.x - 80) going.add(p);
    if (!going.has(p)) return goTo(crate.x - 50)(g, p, t);
    if (p.x > crate.x + crate.w) return I({ right: true });
    return I({ right: true, jump: p.supported || p.vy < 0 });
  };
  const over = p => p.supported && p.x > land;
  const ctl = phases([
    [(g, p, t) => (settled() ? null : goTo(b2.x + b2.w / 2)(g, p, t)), (g, p, t) => (settled() ? null : goTo(5 * T)(g, p, t))],
    // Önce B geçer; presten çıkan hemen bantla çukuru aşar
    [(g, p, t) => (over(A) && over(B) ? null : over(p) ? goTo(base)(g, p, t) : p.x > out ? longJump(23 * T, land)(g, p, t) || idle() : B.x > out ? cross(g, p, t) || idle() : idle()),
     (g, p, t) => (over(A) && over(B) ? null : over(p) ? goTo(29 * T)(g, p, t) : p.x > out ? longJump(23 * T, land)(g, p, t) || idle() : cross(g, p, t) || idle())],
    [(g, p, t) => (Math.abs(p.x + p.w / 2 - base) < 6 && p.supported ? null : goTo(base)(g, p, t)), (g, p, t) => (A.x > 31 * T ? null : goTo(29 * T)(g, p, t))],
    [(g, p, t) => (B.supported && B.y + B.h <= 8 * T + 1 ? null : idle()), towerUp(A, 8 * T, -1)],
    [(g, p, t) => (g.switches[1] ? null : idle()), flip(lv, 1)],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'F15. Paketleme sınavı geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F16. Yük asansörü: A düğmede (1) asansörü kaldırır; B sandığı asansöre itip onunla çıkar, yukarıda banda iter:
  // bant sandığı düğmeye (2) götürür, b kapağı açılır. A düğmeden iner, asansör iner, A biner; B şalterle (4) kaldırır
  const g = new Game(L('yuk-asansoru'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0], lift = g.lifts[0];
  const b1 = g.buttons.find(b => b.channel === 1), b2 = g.buttons.find(b => b.channel === 2), lv = g.levers[0];
  const up = () => lift.y <= lift.topY + 0.5, down = () => lift.y >= lift.oy - 0.5;
  const ctl = phases([
    // B sandığı asansörün sağına iter, kendisi solunda durur
    [(g, p, t) => (crate.ground === lift && B.ground === lift ? null : idle()),
     (g, p, t) => (crate.ground === lift && p.ground === lift ? null : p.x + p.w <= crate.x + 3 && p.supported && p.ground !== crate ? I({ right: true }) : goTo(crate.x - p.w / 2 - 2)(g, p, t))],
    [(g, p, t) => (b2.pressed ? null : goTo(b1.x + b1.w / 2)(g, p, t)), (g, p, t) => (b2.pressed ? null : up() ? I({ right: true }) : idle())],
    [(g, p, t) => (p.ground === lift && down() ? null : down() ? goTo(lift.x + 20)(g, p, t) : goTo(8 * T)(g, p, t)), (g, p, t) => (A.ground === lift && down() ? null : goTo(18 * T)(g, p, t))],
    [(g, p, t) => (up() ? null : idle()), flip(lv, 1)],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'F16. Yük asansörü geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F17. Sapan: A düğmede (1) kapağı tutar; B bantta koşup yaya basar, bandın hızıyla 4 karoluk duvarın üstüne uçar,
  // şalteri (4) çevirir; kapak açık kalır, A da aynı yoldan çıkar
  const g = new Game(L('sapan'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, btn = g.buttons[0], lv = g.levers[0];
  const top = p => p.supported && p.y + p.h <= 7 * T + 1;
  const sling = (g, p, t) => (top(p) ? null : I({ right: true }));
  const ctl = phases([
    [(g, p, t) => (g.switches[1] ? null : goTo(btn.x + btn.w / 2)(g, p, t)), (g, p, t) => (g.switches[1] ? null : top(p) ? flip(lv, 1)(g, p, t) : g.gates[0].open ? sling(g, p, t) : idle())],
    [sling, (g, p, t) => (top(A) ? null : goTo(28 * T)(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'F17. Sapan geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F18. Aktarma: B gezgin platforma biner; A, platform düşme yerine yaklaşırken düğmeye (2) basıp anahtarı bırakır.
  // Anahtar platformdakine (ya da platforma) düşer, B alır. B karşıda iner, kapıyı açar; A platformla geçer
  const g = new Game(L('aktarma'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, key = g.keys[0], door = g.doors[0], M = g.movers[0];
  const btn = g.buttons[0], dropX = 15 * T;
  const at = (p, x) => Math.abs(p.x + p.w / 2 - x) < 6;
  // Platforma bin: kenarda bekle, platform bu uçta durunca üstüne yürü; üstündeyken ortasında dur
  const board = (side) => (g, p, t) => {
    if (p.ground === M) { const d = M.x + M.w / 2 - (p.x + p.w / 2); return I({ right: d > 4, left: d < -4 }); }
    const edge = side < 0 ? M.minX - 20 : M.maxX + M.w + 20, here = side < 0 ? M.x <= M.minX + 1 : M.x >= M.maxX - 1;
    if (here && M.pause > 0.3) return I({ right: side < 0, left: side > 0 });   // yürüyerek bin (zıplama)
    return goTo(edge)(g, p, t);
  };
  // Platformdan in: karşı uçta durunca platformun dışına yürü
  const leave = side => (g, p, t) => {
    if (p.ground !== M) return p.supported && (side > 0 ? p.x > M.maxX + M.w : p.x + p.w < M.minX) ? null : idle();
    const here = side > 0 ? M.x >= M.maxX - 1 : M.x <= M.minX + 1;
    return here ? I({ right: side > 0, left: side < 0 }) : board(side)(g, p, t);
  };
  // A: anahtar bandın ucuna varırken platform altına gelecekse bas (bant ~ 6 karo, düşüş ~0,4 sn)
  const travel = (dropX - 9 * T) / PHYS.beltSpeed + 0.45;
  const mAt = dt => { let x = M.x, d = M.dir, ps = M.pause, tt = dt;   // platformun dt sonraki yeri (kaba)
    while (tt > 0) { if (ps > 0) { const s = Math.min(ps, tt); ps -= s; tt -= s; continue; } x += d * PHYS.moverSpeed * Math.min(tt, 0.05); tt -= 0.05;
      if (x >= M.maxX) { x = M.maxX; d = -1; ps = PHYS.moverPause; } if (x <= M.minX) { x = M.minX; d = 1; ps = PHYS.moverPause; } }
    return x; };
  // Karşıya geç: soldaysan bin, platformdaysan sağ uçta in
  const cross = (g, p, t) => (p.x > 22 * T && p.supported ? null : p.ground === M ? leave(1)(g, p, t) || idle() :
    p.supported && p.x > 20 * T ? I({ right: true }) : p.supported && p.x < M.minX ? board(-1)(g, p, t) : idle());
  let released = false;
  const ctl = phases([
    [(g, p, t) => (B.ground === M ? null : goTo(btn.x + btn.w / 2 + 50)(g, p, t)), (g, p, t) => (p.ground === M ? null : board(-1)(g, p, t))],
    [(g, p, t) => {
       if (key.holder) return null;
       const x = mAt(travel);
       if (!released && x < dropX - 10 && x + M.w > dropX + 30 && key.x < 9 * T) released = true;
       if (released && key.x > 9 * T + 30) released = false;
       return released || key.x >= 9 * T ? goTo(btn.x + btn.w / 2)(g, p, t) : goTo(btn.x + btn.w / 2 + 50)(g, p, t);
     },
     (g, p, t) => (key.holder === p ? null : key.ground === M ? goTo(key.x + key.w / 2)(g, p, t) : board(-1)(g, p, t))],
    [(g, p, t) => (door.open ? null : idle()), (g, p, t) => (door.open ? null : cross(g, p, t) || goTo(door.cells[0].c * T)(g, p, t))],
    [(g, p, t) => cross(g, p, t), (g, p, t) => (A.x > 22 * T && A.supported ? null : goTo(27 * T)(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'F18. Aktarma geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F19. Fıskiye: anahtar kuyudaki yayda zıplar. A rafın dibinde durur, B onun başından rafa çıkar, rafın ucunda
  // zıplayan anahtarı alır; aşağı inip kapıyı açar
  const g = new Game(L('fiskiye'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, key = g.keys[0], door = g.doors[0];
  const base = 14 * T + 20, ledge = { surf: 8 * T, x0: 15 * T, x1: 18 * T };
  const ctl = phases([
    [(g, p, t) => (surfOn(B, ledge) ? null : Math.abs(p.x + p.w / 2 - base) > 6 ? goTo(base)(g, p, t) : idle()),
     (g, p, t) => (surfOn(p, ledge) ? null : Math.abs(A.x + A.w / 2 - base) < 8 && A.supported ? towerUp(A, 8 * T, 1)(g, p, t) : goTo(11 * T)(g, p, t))],
    [(g, p, t) => (key.holder ? null : idle()), (g, p, t) => (key.holder === p ? null : surfOn(p, ledge) ? goTo(18 * T - 4)(g, p, t) : idle())],
    [(g, p, t) => (door.open ? null : goTo(10 * T)(g, p, t)), (g, p, t) => (door.open ? null : goTo(door.cells[0].c * T + T)(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'F19. Fıskiye geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F20. Sevkiyat sınavı: Yük asansörü gibi sandık yukarı, bant onu düğmeye (2) götürür, b kapağı açılır; B şalterle (4)
  // A'yı alır. İkisi gezgin platformla çukuru geçer, bantta koşup yayla 4 karoluk rafa uçar; çıkış
  const g = new Game(L('sevkiyat-sinavi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0], lift = g.lifts[0], M = g.movers[0];
  const b1 = g.buttons.find(b => b.channel === 1), b2 = g.buttons.find(b => b.channel === 2), lv = g.levers[0];
  const up = () => lift.y <= lift.topY + 0.5, down = () => lift.y >= lift.oy - 0.5;
  const board = (g, p, t) => {
    if (p.ground === M) { const d = M.x + M.w / 2 - (p.x + p.w / 2); return I({ right: d > 4, left: d < -4 }); }
    if (M.x <= M.minX + 1 && M.pause > 0.3) return I({ right: true });
    if (p.x + p.w / 2 < M.minX - 26) return I({ right: true, jump: p.vy < 0 || (p.supported && p.x > 20 * T && p.x < 22 * T) });   // sandık ve basamağın üstünden
    return goTo(M.minX - 20)(g, p, t);
  };
  const far = p => p.supported && p.ground !== M && p.x > 29 * T + 20;
  const cross = (g, p, t) => (far(p) ? null : p.ground === M ? (M.x >= M.maxX - 1 ? I({ right: true }) : board(g, p, t)) :
    p.supported && p.x > 28 * T ? I({ right: true }) : p.x < M.minX ? board(g, p, t) : idle());
  const top = p => p.supported && p.y + p.h <= 3 * T + 1;
  const ctl = phases([
    [(g, p, t) => (crate.ground === lift && B.ground === lift ? null : idle()),
     (g, p, t) => (crate.ground === lift && p.ground === lift ? null : p.x + p.w <= crate.x + 3 && p.supported && p.ground !== crate ? I({ right: true }) : goTo(crate.x - p.w / 2 - 2)(g, p, t))],
    [(g, p, t) => (b2.pressed ? null : goTo(b1.x + b1.w / 2)(g, p, t)), (g, p, t) => (b2.pressed ? null : up() ? I({ right: true }) : idle())],
    [(g, p, t) => (p.ground === lift && down() ? null : down() ? goTo(lift.x + 20)(g, p, t) : goTo(8 * T)(g, p, t)), (g, p, t) => (A.ground === lift && down() ? null : goTo(17 * T + 20)(g, p, t))],
    [(g, p, t) => (up() ? null : idle()), flip(lv, 1)],
    // Önce B geçer, sonra A
    [(g, p, t) => (far(A) && far(B) ? null : far(B) ? cross(g, p, t) || idle() : goTo(15 * T + 20)(g, p, t)), (g, p, t) => (far(A) && far(B) ? null : far(p) ? goTo(31 * T)(g, p, t) : cross(g, p, t))],
    [(g, p, t) => (top(p) ? null : B.x > 33 * T || top(B) ? I({ right: true }) : idle()), (g, p, t) => (top(p) ? null : I({ right: true }))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 120, g => g.done), 'F20. Sevkiyat sınavı geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F21. Asma hat: A düğmede (1) a kapağını açar. B tavana asılır, bantta akan anahtarı mıknatısla çeker, karşıda kutup
  // değiştirip iner, şalterle (4) kapağı açık bırakır. A da asılarak geçer; B anahtarla kapıyı açar
  const g = new Game(L('asma-hat'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, key = g.keys[0], door = g.doors[0];
  const btn = g.buttons[0], lv = g.levers[0], startX = 8 * T, endX = 24 * T + 20;
  const hanging = p => !p.supported && p.vy <= 1 && p.gripT > 0;
  // Asılıyken anahtarın üstüne kadar git, anahtar elde olana kadar mıknatıs
  const fish = (g, p, t) => {
    if (key.holder === p) return null;
    if (hanging(p) && p.x + p.w / 2 > 14 * T) return I({ action: true });
    return hangAcross(startX, endX, 1)(g, p, t) || idle();
  };
  const land = p => p.supported && p.x > 23 * T + 30;
  const ctl = phases([
    [(g, p, t) => (key.holder ? null : goTo(btn.x + btn.w / 2)(g, p, t)), fish],
    [(g, p, t) => (g.switches[1] ? null : goTo(btn.x + btn.w / 2)(g, p, t)), (g, p, t) => (g.switches[1] ? null : land(p) ? flip(lv, 1)(g, p, t) : hangAcross(startX, endX, 1)(g, p, t) || idle())],
    [(g, p, t) => (land(p) ? null : hangAcross(startX, endX, 1)(g, p, t) || idle()), (g, p, t) => (land(A) ? null : goTo(29 * T)(g, p, t))],
    [(g, p, t) => (door.open ? null : idle()), (g, p, t) => (door.open ? null : goTo(door.cells[0].c * T + T)(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'F21. Asma hat geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F22. Zamanlı çekiş: A yakındaki zamanlı düğmeye basıp B'nin arkasına koşar, B kenardan zıplarken iter; B karşıda.
  // B karşıdaki zamanlı düğmeye basıp çekme yerine koşar; kapak açıkken A zıplar, B kutup değiştirip çeker
  const g = new Game(L('zamanli-cekis'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, gate = g.gates[0];
  const [tNear, tFar] = g.buttons.slice().sort((p, q) => p.x - q.x), on = (b, p) => Math.abs(p.x + p.w / 2 - (b.x + b.w / 2)) < 6;
  const farX = 18 * T, bAcross = () => B.x > farX - 10 && B.supported, both = () => bAcross() && A.x > farX - 10 && A.supported;
  let pressed = false, pressedFar = false;
  const [pa, pb] = crossPit(g, A, B, 12 * T, farX, bAcross);
  const [qa, qb] = crossPit(g, A, B, 12 * T, farX, both);
  const ctl = phases([
    [(g, p, t) => (pressed ? null : on(tNear, p) ? ((pressed = true), idle()) : goTo(tNear.x + tNear.w / 2)(g, p, t)), (g, p, t) => (pressed ? null : goTo(10 * T)(g, p, t))],
    [(g, p, t) => (gate.open ? pa(g, p, t) : idle()), (g, p, t) => (gate.open ? pb(g, p, t) : idle())],
    [(g, p, t) => (pressedFar ? null : goTo(10 * T)(g, p, t)), (g, p, t) => (pressedFar ? null : on(tFar, p) ? ((pressedFar = true), idle()) : goTo(tFar.x + tFar.w / 2)(g, p, t))],
    // A, B çekme yerine varana kadar kenarda bekler
    [(g, p, t) => (both() ? null : gate.open && Math.abs(B.x + B.w / 2 - (farX + 20)) < 12 ? qa(g, p, t) : goTo(10 * T + 10)(g, p, t)), (g, p, t) => (both() ? null : qb(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'F22. Zamanlı çekiş geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F23. Gezgin fırlatma: A, B'nin başına çıkar; B onu taşıyarak gezgin platforma biner. Platform duvarın dibinde beklerken
  // B mıknatısla A'yı fırlatır, A duvarın üstüne iner, kutup değiştirip B'yi çeker (platform bir sonraki gelişinde de olur)
  const g = new Game(L('gezgin-firlatma'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, M = g.movers[0];
  const wallX = 28 * T, topY = 6 * T, onTop = p => p.supported && p.y + p.h <= topY + 1 && p.x + p.w > wallX;
  const ride = slot => (g, p, t) => { const d = M.x + slot - (p.x + p.w / 2); return I({ right: d > 3, left: d < -3 }); };
  const atLeft = () => M.x <= M.minX + 1 && M.pause > 0.15, atRight = () => M.x >= M.maxX - 1 && M.pause > 0;
  const center = (g, p, t) => { const d = B.x - p.x; return I({ right: d > 2, left: d < -2 }); };
  let launching = false;
  const ctl = phases([
    // A karada B'nin başına çıkar; B onu taşıyıp platform sol uçta beklerken biner
    [(g, p, t) => (p.ground === B && B.ground === M ? null : p.ground === B ? center(g, p, t) :
       Math.abs(B.x + B.w / 2 - (M.minX - 24)) < 6 && B.supported ? climbOn(B)(g, p, t) : goTo(M.minX - 90)(g, p, t)),
     (g, p, t) => (A.ground === p && p.ground === M ? null : p.ground === M ? ride(M.w - 24)(g, p, t) : A.ground === p && atLeft() ? I({ right: true }) :
       Math.abs(p.x + p.w / 2 - (M.minX - 24)) > 4 ? goTo(M.minX - 24)(g, p, t) : idle())],
    // Sağ uçta B fırlatır, A duvarın üstüne kayar
    [(g, p, t) => (onTop(p) ? null : p.ground === B ? center(g, p, t) : !p.supported && p.y + p.h < topY + 20 ? I({ right: true }) : idle()),
     (g, p, t) => {
       if (onTop(A)) return null;
       if (A.ground === p && atRight()) launching = true;
       else if (A.supported || A.y + A.h < topY - 20) launching = false;
       return I({ action: launching, right: M.x + M.w - 24 - (p.x + p.w / 2) > 3, left: M.x + M.w - 24 - (p.x + p.w / 2) < -3 });
     }],
    // A kutup değiştirip duvarın kenarında çeker; B platform sağ uçtayken duvara doğru zıplar
    [(g, p, t) => {
       if (onTop(B)) return null;
       if (p.pol === B.pol) return I({ swap: (t * 10 | 0) % 2 === 0 });
       const cx = p.x + p.w / 2, at = wallX + 20;
       if (Math.abs(cx - at) > 8) return I({ right: cx < at, left: cx > at });
       return I({ action: B.x + B.w > wallX - 80 && !onTop(B), right: B.y + B.h < topY });
     },
     (g, p, t) => {
       if (onTop(p)) return null;
       if (p.y + p.h < topY + 4) return I({ right: true, jump: true });
       if (p.ground === M) return M.x >= M.maxX - 1 && A.pol !== p.pol ? I({ right: true, jump: (t * 5 | 0) % 2 === 0 || p.vy < 0 }) : ride(M.w - 24)(g, p, t);
       return I({ right: true, jump: p.vy < 0 });
     }],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'F23. Gezgin fırlatma geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F24. Kanca: B düğmede (2) cebin kapağını açar. A şeride asılıp B'nin tam üstünde durur, mıknatısla sandığı cebinden çeker;
  // sandık altında asılı kalır, A asılı yürüyüp karşıdaki düğmenin (1) üstünde bırakır. A iner; B de asılarak geçer
  const g = new Game(L('kanca'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0];
  const b2 = g.buttons.find(b => b.channel === 2), b1 = g.buttons.find(b => b.channel === 1);
  const hanging = p => !p.supported && p.vy <= 1 && p.gripT > 0;
  const holdX = b2.x + b2.w / 2, dropX = b1.x + b1.w / 2;
  const land = p => p.supported && p.x > 23 * T;
  const ctl = phases([
    [(g, p, t) => {
       if (b1.pressed) return null;
       if (!hanging(p)) return p.supported ? (Math.abs(p.x + p.w / 2 - 6 * T) > 8 ? goTo(6 * T)(g, p, t) : B.supported && Math.abs(B.x + B.w / 2 - holdX) < 6 ? I({ jump: (t * 4 | 0) % 2 === 0 }) : idle()) : I();
       const held = crate.y + crate.h < 10 * T && Math.abs(crate.x + crate.w / 2 - (p.x + p.w / 2)) < 60;
       if (!held) { const d = holdX - (p.x + p.w / 2); return Math.abs(d) > 4 ? I({ right: d > 0, left: d < 0 }) : I({ action: true }); }   // düğmedekinin tam üstünde: sandığı çek
       const cx = crate.x + crate.w / 2;
       return Math.abs(cx - dropX) > 8 ? I({ action: true, right: cx < dropX, left: cx > dropX }) : I();   // düğmenin üstünde bırak
     },
     (g, p, t) => (b1.pressed ? null : goTo(holdX)(g, p, t))],
    [(g, p, t) => (land(B) ? null : land(p) ? goTo(26 * T)(g, p, t) : hangAcross(holdX + 40, 25 * T, 1)(g, p, t) || idle()),
     (g, p, t) => (land(p) ? null : A.supported ? hangAcross(holdX + 40, 25 * T, 1)(g, p, t) || idle() : idle())],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'F24. Kanca geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F25. Atölye ustası: Kanca gibi: B düğmede (2), A asılıp sandığı cebinden çeker, birinci çukurun üstünden taşıyıp düğmeye (1)
  // bırakır: a kapağı açık kalır. İkisi asılarak geçer. İkinci çukuru Uçurum gibi: A, B'yi iter; B kutup değiştirip A'yı çeker
  const g = new Game(L('atolye-ustasi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0];
  const b2 = g.buttons.find(b => b.channel === 2), b1 = g.buttons.find(b => b.channel === 1);
  const hanging = p => !p.supported && p.vy <= 1 && p.gripT > 0;
  const holdX = b2.x + b2.w / 2, dropX = b1.x + b1.w / 2, endX = 20 * T;
  const land = p => p.supported && p.x > 18 * T && p.x < 26 * T;
  const across = () => A.x > 32 * T - 10 && B.x > 32 * T - 10 && A.supported && B.supported;
  const ctl = phases([
    [(g, p, t) => {
       if (b1.pressed) return null;
       if (!hanging(p)) return p.supported ? (Math.abs(p.x + p.w / 2 - 6 * T) > 8 ? goTo(6 * T)(g, p, t) : B.supported && Math.abs(B.x + B.w / 2 - holdX) < 6 ? I({ jump: (t * 4 | 0) % 2 === 0 }) : idle()) : I();
       const held = crate.y + crate.h < 10 * T && Math.abs(crate.x + crate.w / 2 - (p.x + p.w / 2)) < 60;
       if (!held) { const d = holdX - (p.x + p.w / 2); return Math.abs(d) > 4 ? I({ right: d > 0, left: d < 0 }) : I({ action: true }); }
       const cx = crate.x + crate.w / 2;
       return Math.abs(cx - dropX) > 8 ? I({ action: true, right: cx < dropX, left: cx > dropX }) : I();
     },
     (g, p, t) => (b1.pressed ? null : goTo(holdX)(g, p, t))],
    [(g, p, t) => (land(B) && land(p) ? null : land(p) ? goTo(22 * T)(g, p, t) : hangAcross(holdX + 40, endX, 1)(g, p, t) || idle()),
     (g, p, t) => (land(p) && land(A) ? null : land(p) ? goTo(24 * T)(g, p, t) : A.supported && land(A) ? hangAcross(holdX + 40, endX, 1)(g, p, t) || idle() : idle())],
    // Kutuplar: ikisi de + olmalı (asılırken + kaldılar; inince değişmiş olabilir)
    [(g, p, t) => (!land(p) || !land(B) ? (land(p) ? idle() : hangAcross(holdX + 40, endX, 1)(g, p, t) || idle()) : p.pol === 1 && B.pol === 1 ? (Math.abs(p.x + p.w / 2 - 22 * T) > 6 ? goTo(22 * T)(g, p, t) : null) : p.pol !== 1 ? I({ swap: (t * 10 | 0) % 2 === 0 }) : idle()),
     (g, p, t) => (!land(p) || !land(A) ? (land(p) ? idle() : hangAcross(holdX + 40, endX, 1)(g, p, t) || idle()) : p.pol === 1 && A.pol === 1 ? (Math.abs(p.x + p.w / 2 - 24 * T) > 6 ? goTo(24 * T)(g, p, t) : null) : p.pol !== 1 ? I({ swap: (t * 10 | 0) % 2 === 0 }) : idle())],
    crossPit(g, A, B, 26 * T, 32 * T, across),
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'F25. Atölye ustası geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F26. Çift takoz: A düğmede (2) iki sandığı bırakır: biri presin altına girer, öbürü bacadan a kapağının üstüne düşer.
  // Pres yukarıdayken sandığın üstünden geçerler; A karşıdaki düğmede (1) kapağı açar, sandık kapağın içine düşer; çıkış
  const g = new Game(L('cift-takoz'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, P = g.presses[0];
  const b2 = g.buttons.find(b => b.channel === 2), b1 = g.buttons.find(b => b.channel === 1), gx = g.gates.find(x => x.channel === 1).cells[0].c * T;
  const [near, far] = g.boxes.slice().sort((p, q) => p.x - q.x), out = 16 * T;
  const settled = () => near.y + near.h >= 11 * T - 1 && Math.abs(near.dx) < 0.01 && near.x > 9 * T - 20 && far.y + far.h >= 8 * T - 1 && Math.abs(far.dx) < 0.01;
  const wedged = () => far.y + far.h >= 11 * T - 1 && far.x >= gx - 1;
  const going = new Set();
  const cross = (g, p, t) => {
    if (p.x > out) return null;
    if (P.y <= P.topY + 1 && P.dir > 0 && P.pause > 0.9 && p.x + p.w < near.x && p.x > near.x - 80) going.add(p);
    if (!going.has(p)) return goTo(near.x - 50)(g, p, t);
    if (p.x > near.x + near.w) return I({ right: true });
    return I({ right: true, jump: p.supported || p.vy < 0 });
  };
  const ctl = phases([
    [(g, p, t) => (settled() ? null : goTo(b2.x + b2.w / 2)(g, p, t)), (g, p, t) => (settled() ? null : goTo(5 * T)(g, p, t))],
    [(g, p, t) => (A.x > out && B.x > out ? null : p.x > out ? goTo(20 * T)(g, p, t) : B.x > out ? cross(g, p, t) || idle() : idle()),
     (g, p, t) => (A.x > out && B.x > out ? null : p.x > out ? goTo(23 * T)(g, p, t) : cross(g, p, t) || idle())],
    [(g, p, t) => (wedged() ? null : goTo(b1.x + b1.w / 2)(g, p, t)), (g, p, t) => (wedged() ? null : goTo(24 * T)(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'F26. Çift takoz geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F27. Asılı takoz: B asılarak karşıya geçer, raftaki yuvada düğmeye (1) basar ve kutbunu + yapar (asılı onu duvara iter).
  // A basamağın üstünde asılıp sandığı çeker, karşıya taşıyıp bırakır, inip sandığı rafın altından kapağın içine iter
  const g = new Game(L('asili-takoz'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0];
  const b1 = g.buttons[0], gx = g.gates[0].cells[0].c * T, dropX = 20 * T + 20, endX = 19 * T + 30;
  const hanging = p => !p.supported && p.vy <= 1 && p.gripT > 0;
  const shelf = { surf: 9 * T, x0: 24 * T, x1: 26 * T };
  const onB1 = () => b1.pressed && surfOn(B, shelf);
  const dropped = () => crate.supported && crate.x > 19 * T && crate.y + crate.h >= 11 * T - 1;
  const wedged = () => dropped() && crate.x >= gx - 1;
  const toShelf = (g, p, t) => {
    if (surfOn(p, shelf)) return Math.abs(p.x + p.w / 2 - (b1.x + b1.w / 2)) > 4 ? goTo(b1.x + b1.w / 2)(g, p, t) : p.pol !== 1 ? I({ swap: (t * 10 | 0) % 2 === 0 }) : idle();
    if (!p.supported) return I({ right: p.y + p.h < 9 * T, jump: p.vy < 0 });
    return Math.abs(p.x + p.w / 2 - (23 * T + 10)) > 6 ? goTo(23 * T + 10)(g, p, t) : I({ jump: true });
  };
  const ctl = phases([
    [(g, p, t) => (onB1() && B.pol === 1 ? null : idle()), (g, p, t) => (onB1() && p.pol === 1 ? null : p.x > 19 * T && !hanging(p) ? toShelf(g, p, t) : hangAcross(5 * T + 20, endX, 1)(g, p, t) || toShelf(g, p, t))],
    [(g, p, t) => {
       if (dropped()) return null;
       if (!hanging(p)) return p.supported ? (Math.abs(p.x + p.w / 2 - 6 * T) > 8 ? goTo(6 * T)(g, p, t) : I({ jump: (t * 4 | 0) % 2 === 0 })) : I();
       const held = crate.y + crate.h < 10 * T && Math.abs(crate.x + crate.w / 2 - (p.x + p.w / 2)) < 60;
       if (!held) { const d = 7 * T + 20 - (p.x + p.w / 2); return Math.abs(d) > 4 ? I({ right: d > 0, left: d < 0 }) : I({ action: true }); }   // basamağın üstünde: sandık basamağa dayanıp yapışır
       const cx = crate.x + crate.w / 2;
       return Math.abs(cx - dropX) > 8 ? I({ action: true, right: cx < dropX, left: cx > dropX }) : I();
     },
     (g, p, t) => (dropped() ? null : toShelf(g, p, t))],
    [(g, p, t) => {
       if (wedged()) return null;
       if (!p.supported) return hanging(p) ? (p.x + p.w / 2 < 19 * T + 30 ? I({ right: true }) : I({ swap: (t * 10 | 0) % 2 === 0 })) : I();   // karanın üstüne gelince bırakıl
       return p.x + p.w <= crate.x + 3 && p.ground !== crate ? I({ right: true }) : p.ground === crate ? I({ left: true }) : goTo(crate.x - p.w / 2 - 2)(g, p, t);
     },
     (g, p, t) => (wedged() ? null : toShelf(g, p, t))],
    [goTo(ex), (g, p, t) => (p.pol === 1 ? I({ swap: (t * 10 | 0) % 2 === 0 }) : surfOn(p, shelf) ? I({ left: true }) : goTo(ex)(g, p, t))],   // − olup (tavana yapışmasın) yuvadan sola inip rafın altından
  ]);
  ok(run(g, ctl, 60, g => g.done), 'F27. Asılı takoz geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F28. Yük yolu: B gezgin platformun sol yarısına biner; A, platform düşme yerine gelirken düğmeye (2) basıp sandığı bırakır.
  // Sandık platforma düşer; B karşı uçta onu banda iter, bant düğmeye (1) götürür: a kapağı açılır. İkisi platformla geçer
  const g = new Game(L('yuk-yolu'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0], M = g.movers[0];
  const btn = g.buttons.find(b => b.channel === 2), b1 = g.buttons.find(b => b.channel === 1), dropX = 15 * T;
  const ride = slot => (g, p, t) => { const d = M.x + slot - (p.x + p.w / 2); return I({ right: d > 3, left: d < -3 }); };
  const far = p => p.supported && p.ground !== M && p.x > 22 * T;
  const board = slot => (g, p, t) => (p.ground === M ? ride(slot)(g, p, t) : M.x <= M.minX + 1 && M.pause > 0.3 ? I({ right: true }) : goTo(M.minX - 20)(g, p, t));
  const travel = (dropX - 9 * T) / PHYS.beltSpeed + 0.45;
  const mAt = dt => { let x = M.x, d = M.dir, ps = M.pause, tt = dt;
    while (tt > 0) { if (ps > 0) { const s = Math.min(ps, tt); ps -= s; tt -= s; continue; } x += d * PHYS.moverSpeed * Math.min(tt, 0.05); tt -= 0.05;
      if (x >= M.maxX) { x = M.maxX; d = -1; ps = PHYS.moverPause; } if (x <= M.minX) { x = M.minX; d = 1; ps = PHYS.moverPause; } }
    return x; };
  let released = false;
  const cross = (g, p, t) => (far(p) ? null : p.ground === M ? (M.x >= M.maxX - 1 && M.pause > 0.1 ? I({ right: true }) : ride(M.w - 20)(g, p, t)) : p.supported && p.x < M.minX ? board(M.w - 20)(g, p, t) : I({ right: true }));
  const ctl = phases([
    [(g, p, t) => (B.ground === M ? null : goTo(btn.x + btn.w / 2 + 60)(g, p, t)), (g, p, t) => (p.ground === M ? null : board(20)(g, p, t))],
    // Sandık platformun sağ yarısına düşmeli: platform düşme yerinin solundayken bırak
    [(g, p, t) => {
       if (crate.ground === M) return null;
       const x = mAt(travel);
       if (!released && x + 50 < dropX && x + M.w > dropX + 40 && crate.x < 9 * T) released = true;
       if (released && crate.x > 9 * T + 30) released = false;
       return released || crate.x >= 9 * T ? goTo(btn.x + btn.w / 2)(g, p, t) : goTo(btn.x + btn.w / 2 + 60)(g, p, t);
     },
     (g, p, t) => (crate.ground === M ? null : p.ground === M ? ride(20)(g, p, t) : board(20)(g, p, t))],
    // Karşı uçta B sandığı banda iter
    [(g, p, t) => (b1.pressed ? null : goTo(btn.x + btn.w / 2 + 60)(g, p, t)),
     (g, p, t) => (b1.pressed ? null : p.ground === M ? (M.x >= M.maxX - 1 && M.pause > 0.05 ? I({ right: true }) : ride(20)(g, p, t)) : far(p) ? idle() : board(20)(g, p, t))],
    [(g, p, t) => cross(g, p, t), (g, p, t) => (far(A) ? null : far(p) ? goTo(27 * T)(g, p, t) : cross(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'F28. Yük yolu geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F29. Büyük sapan: A düğmede (1) kapağı tutar. B, platform sol ucuna varacakken bantta koşup yaya basar, platforma iner,
  // karşıda şalteri (4) çevirir; A da aynı yoldan
  const g = new Game(L('buyuk-sapan'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, M = g.movers[0], btn = g.buttons[0], lv = g.levers[0];
  const mAt = dt => { let x = M.x, d = M.dir, ps = M.pause, tt = dt;
    while (tt > 0) { if (ps > 0) { const s = Math.min(ps, tt); ps -= s; tt -= s; continue; } x += d * PHYS.moverSpeed * Math.min(tt, 0.05); tt -= 0.05;
      if (x >= M.maxX) { x = M.maxX; d = -1; ps = PHYS.moverPause; } if (x <= M.minX) { x = M.minX; d = 1; ps = PHYS.moverPause; } }
    return x; };
  const far = p => p.supported && p.ground !== M && p.x > 28 * T;
  const startX = 4 * T + 20, flight = 1.75;
  const go = new Set();
  // Kalkış yerinde bekle; platform iniş anında sol ucundaysa koş (bant + yay), havada ve platformda sağa
  const sling = (g, p, t) => {
    if (far(p)) return null;
    if (p.ground === M) return M.x >= M.maxX - 1 && M.pause > 0.05 ? I({ right: true }) : I({ right: p.x + p.w / 2 < M.x + M.w - 25, left: p.x + p.w / 2 > M.x + M.w - 15 });
    if (!p.supported) return I({ right: true });
    if (p.x > 6 * T) return I({ right: true });   // bantta: dur yok
    if (go.has(p)) return I({ right: true });
    if (Math.abs(p.x + p.w / 2 - startX) > 6) return goTo(startX)(g, p, t);
    const x = mAt(flight);
    if (x < M.minX + 30) go.add(p);
    return idle();
  };
  const ctl = phases([
    [(g, p, t) => (g.switches[1] ? null : goTo(btn.x + btn.w / 2)(g, p, t)), (g, p, t) => (g.switches[1] ? null : far(p) ? flip(lv, 1)(g, p, t) : g.gates[0].open ? sling(g, p, t) || idle() : idle())],
    [sling, (g, p, t) => (far(A) ? null : goTo(31 * T)(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'F29. Büyük sapan geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // F30. Pusula iğnesi (final): A düğmede (2) sandığı bırakır, sandık presin altına girer; pres yukarıdayken geçerler.
  // Bantta koşup yayla 4 karoluk duvarın üstüne uçarlar. A rafın dibinde, B onun başından rafa: pusula parçası; kapı, çıkış
  const g = new Game(L('pusula-ignesi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0], P = g.presses[0];
  const piece = g.keys[0], door = g.doors[0], b2 = g.buttons[0], out = 16 * T;
  const settled = () => crate.y + crate.h >= 11 * T - 1 && Math.abs(crate.dx) < 0.01 && crate.x > 9 * T - 20;
  const going = new Set();
  const cross = (g, p, t) => {
    if (p.x > out) return null;
    if (P.y <= P.topY + 1 && P.dir > 0 && P.pause > 0.9 && p.x + p.w < crate.x && p.x > crate.x - 80) going.add(p);
    if (!going.has(p)) return goTo(crate.x - 50)(g, p, t);
    if (p.x > crate.x + crate.w) return I({ right: true });
    return I({ right: true, jump: p.supported || p.vy < 0 });
  };
  const top = p => p.supported && p.y + p.h <= 7 * T + 1 && p.x > 28 * T;
  const sling = (g, p, t) => (top(p) ? null : I({ right: true }));
  const base = 36 * T + 20, shelf = { surf: 4 * T, x0: 34 * T, x1: 36 * T };
  const ctl = phases([
    [(g, p, t) => (settled() ? null : goTo(b2.x + b2.w / 2)(g, p, t)), (g, p, t) => (settled() ? null : goTo(5 * T)(g, p, t))],
    // Önce B: presin altından geçip hemen sapanla duvarın üstüne; sonra A
    [(g, p, t) => (top(A) && top(B) ? null : top(p) ? goTo(31 * T)(g, p, t) : top(B) ? (p.x > out ? sling(g, p, t) : cross(g, p, t) || idle()) : idle()),
     (g, p, t) => (top(A) && top(B) ? null : top(p) ? goTo(37 * T)(g, p, t) : p.x > out ? sling(g, p, t) : cross(g, p, t) || idle())],
    // B rafın sağında durur; A rafın altından gelip B'nin başından sola, rafa
    [(g, p, t) => (Math.abs(B.x + B.w / 2 - base) < 6 && B.supported ? null : goTo(31 * T)(g, p, t)), (g, p, t) => (Math.abs(p.x + p.w / 2 - base) < 6 && p.supported ? null : goTo(base)(g, p, t))],
    [(g, p, t) => (piece.holder === p ? null : surfOn(p, shelf) ? goTo(piece.x + piece.w / 2)(g, p, t) : towerUp(B, 4 * T, -1)(g, p, t) || idle()),
     (g, p, t) => (piece.holder ? null : idle())],
    [(g, p, t) => (door.open ? goTo(ex)(g, p, t) : goTo(door.cells[0].c * T)(g, p, t)), (g, p, t) => (door.open ? goTo(ex)(g, p, t) : idle())],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'F30. Pusula iğnesi geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B1. Kayak: A düğmede (1) kapağı tutar; B buzda uzun koşup 5 karoluk çukuru aşar, şalterle (4) kapağı açık bırakır; A da koşar
  const g = new Game(L('kayak'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, btn = g.buttons[0], lv = g.levers[0];
  const edge = 16 * T, over = p => p.supported && p.x > 21 * T;
  const skate = (g, p, t) => (over(p) ? null : I({ right: true, jump: (p.supported && p.x + p.w > edge - 4) || (!p.supported && p.vy < 0) }));
  const ctl = phases([
    [(g, p, t) => (g.switches[1] ? null : goTo(btn.x + btn.w / 2)(g, p, t)), (g, p, t) => (g.switches[1] ? null : over(p) ? flip(lv, 1)(g, p, t) : g.gates[0].open ? skate(g, p, t) : idle())],
    [skate, (g, p, t) => (over(A) ? null : goTo(27 * T)(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'B1. Kayak geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B2. Çatlak köprü: sırayla köprüden koşarak geçerler (köprü arkalarından kırılır, sonra donar). A rafın dibinde, B onun
  // başından rafa çıkıp anahtarı alır; yine sırayla dönerler, anahtarla kapı
  const g = new Game(L('catlak-kopru'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, key = g.keys[0], door = g.doors[0];
  const intact = () => g.thaws.every(th => !th.open && th.crackT < 0);
  const right = p => p.supported && p.x > 16 * T, left = p => p.supported && p.x + p.w < 9 * T;
  // Köprü sağlamken ve kimse üstünde değilken koş; köprüdeyken durmadan devam
  const onBridge = p => p.x + p.w > 9 * T && p.x < 16 * T;
  const dash = (dir, done) => (g, p, t) => {
    if (done(p)) return null;
    if (onBridge(p) || !p.supported) return I({ right: dir > 0, left: dir < 0 });
    const other = p === A ? B : A;
    if (!intact() || onBridge(other)) return goTo(dir > 0 ? 8 * T : 17 * T)(g, p, t);
    return I({ right: dir > 0, left: dir < 0 });
  };
  const base = 22 * T + 10, shelf = { surf: 8 * T, x0: 23 * T, x1: 25 * T };
  const ctl = phases([
    [(g, p, t) => (right(p) && right(B) ? null : right(B) ? dash(1, right)(g, p, t) || idle() : goTo(6 * T)(g, p, t)), (g, p, t) => (right(p) && right(A) ? null : right(p) ? goTo(27 * T)(g, p, t) : dash(1, right)(g, p, t))],
    [(g, p, t) => (Math.abs(p.x + p.w / 2 - base) < 6 && p.supported ? null : goTo(base)(g, p, t)), (g, p, t) => (p.x < 20 * T ? goTo(18 * T)(g, p, t) : null)],
    [(g, p, t) => (key.holder ? null : idle()), (g, p, t) => (key.holder === p ? null : surfOn(p, shelf) ? goTo(key.x + key.w / 2)(g, p, t) : towerUp(A, 8 * T, 1)(g, p, t) || idle())],
    [(g, p, t) => (left(p) && left(B) ? null : left(B) ? dash(-1, left)(g, p, t) || idle() : goTo(22 * T)(g, p, t)), (g, p, t) => (left(p) && left(A) ? null : left(p) ? (door.open ? goTo(5 * T)(g, p, t) : goTo(door.cells[0].c * T + T)(g, p, t)) : p.supported && !onBridge(p) && p.y + p.h <= 8 * T + 1 ? I({ left: true }) : dash(-1, left)(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'B2. Çatlak köprü geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B3. Buz hokeyi: A direğin üstündeki düğmede (2) alçak b kapağını açar; B sandığı iter, sandık buzda kayıp kapaktan geçer,
  // duvardaki düğmeye (1) çarpıp orada kalır: a kapağı açılır. İkisi sandığın üstünden çıkışa
  const g = new Game(L('buz-hokeyi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0];
  const b1 = g.buttons.find(b => b.channel === 1), b2 = g.buttons.find(b => b.channel === 2);
  const pillar = { surf: 9 * T, x0: 2 * T, x1: 3 * T };
  const onPillar = (g, p, t) => (surfOn(p, pillar) ? I({ left: p.x + p.w / 2 > 2 * T + 22, right: p.x + p.w / 2 < 2 * T + 18 })
    : !p.supported ? I({ left: p.x + p.w / 2 > 2 * T + 20, jump: p.vy < 0 }) : Math.abs(p.x + p.w / 2 - (3 * T + 24)) > 6 ? goTo(3 * T + 24)(g, p, t) : I({ jump: true, left: true }));
  let shoved = false;
  const ctl = phases([
    [(g, p, t) => (b1.pressed ? null : onPillar(g, p, t)),
     (g, p, t) => {
       if (b1.pressed) return null;
       if (!b2.pressed) return goTo(crate.x - 40)(g, p, t);   // kapak açılana kadar sandığın arkasında bekle
       if (crate.dx > 1) shoved = true;
       return shoved ? I({ left: true }) : p.x + p.w <= crate.x + 3 ? I({ right: true }) : goTo(crate.x - 25)(g, p, t);   // bir kez it, sonra fren
     }],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'B3. Buz hokeyi geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B4. Kartopu: A topu karda yuvarlar, büyür; ikisi büyük topu duvarın dibine iter (buzda kendiliğinden kayar).
  // Topun üstünden 4 karoluk rafa zıplarlar
  const g = new Game(L('kartopu'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, sb = g.boxes[0];
  const wall = 24 * T, top = p => p.supported && p.y + p.h <= 7 * T + 1 && p.x > wall - 10;
  const atWall = () => sb.x + sb.w >= wall - 1;
  const behind = p => p.x + p.w <= sb.x + 3 && p.supported && p.ground !== sb;
  // Topa çık, oradan rafa zıpla
  const climb = (g, p, t) => {
    if (top(p)) return null;
    if (p.ground === sb) return I({ right: true, jump: true });
    if (!p.supported) return I({ right: true, jump: p.vy < 0 });
    return Math.abs(p.x + p.w / 2 - (sb.x - 30)) > 8 ? goTo(sb.x - 30)(g, p, t) : I({ right: true, jump: true });
  };
  const ctl = phases([
    [(g, p, t) => (sb.big ? null : behind(p) ? I({ right: true }) : goTo(sb.x - 40)(g, p, t)), (g, p, t) => (sb.big ? null : goTo(2 * T)(g, p, t))],
    [(g, p, t) => (atWall() ? null : behind(p) ? I({ right: true }) : goTo(sb.x - 40)(g, p, t)),
     (g, p, t) => (atWall() ? null : behind(p) && (p.x + p.w > A.x - 4 || behind(A)) ? I({ right: true }) : goTo(sb.x - 80)(g, p, t))],
    [climb, (g, p, t) => (top(A) ? null : goTo(sb.x - 100)(g, p, t))],
    [(g, p, t) => (top(B) ? null : goTo(27 * T)(g, p, t)), climb],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'B4. Kartopu geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B5. Buz kapısı (sınav): sırayla buzda koşup 5 karoluk çukuru aşarlar. A düğmede (2) alçak kapağı açar, B sandığı
  // kaydırır: sandık duvardaki düğmeye (1) çarpar, a kapağı açılır. Eriyen köprüden sırayla geçip çıkışa
  const g = new Game(L('buz-kapisi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0];
  const b1 = g.buttons.find(b => b.channel === 1), b2 = g.buttons.find(b => b.channel === 2);
  const edge = 13 * T, over = p => p.supported && p.x > 18 * T - 10;
  const skate = (g, p, t) => (over(p) ? null : I({ right: true, jump: (p.supported && p.x + p.w > edge - 4) || (!p.supported && p.vy < 0) }));
  let shoved = false;
  const intact = () => g.thaws.every(th => !th.open && th.crackT < 0);
  const onBridge = p => !p.inExit && p.x + p.w > 36 * T && p.x < 41 * T;
  const dash = (g, p, t) => {
    if (p.inExit) return null;
    if (p.x > 41 * T) return goTo(ex)(g, p, t);
    if (onBridge(p) || !p.supported) return I({ right: true });
    const other = p === A ? B : A;
    if (!intact() || onBridge(other)) return goTo(35 * T)(g, p, t);
    return I({ right: true });
  };
  const ctl = phases([
    [(g, p, t) => (over(B) ? skate(g, p, t) : idle()), (g, p, t) => (over(p) && over(A) ? null : over(p) ? goTo(crate.x - 40)(g, p, t) : skate(g, p, t))],
    [(g, p, t) => (b1.pressed ? null : goTo(b2.x + b2.w / 2)(g, p, t)),
     (g, p, t) => {
       if (b1.pressed) return null;
       if (!b2.pressed) return goTo(crate.x - 40)(g, p, t);
       if (crate.dx > 1) shoved = true;
       return shoved ? I({ left: true }) : p.x + p.w <= crate.x + 3 ? I({ right: true }) : goTo(crate.x - 25)(g, p, t);
     }],
    [(g, p, t) => (p.x > 34 * T ? null : goTo(35 * T)(g, p, t)), (g, p, t) => (p.x > 34 * T ? null : goTo(34 * T + 30)(g, p, t))],
    [(g, p, t) => (B.inExit ? dash(g, p, t) : goTo(34 * T + 10)(g, p, t)), dash],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'B5. Buz kapısı geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B6. Kar köprüsü: A topu karda yuvarlar, büyür; ikisi büyük topu hendeğe iter, top dibe oturur. Topun üstüne inip karşıya zıplarlar
  const g = new Game(L('kar-koprusu'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, sb = g.boxes[0];
  const inTrench = () => sb.big && sb.supported && sb.y > 10 * T;
  const behind = p => p.x + p.w <= sb.x + 3 && p.supported && p.ground !== sb;
  const far = p => p.supported && p.x > 20 * T;
  const cross = (g, p, t) => (far(p) ? null : I({ right: true, jump: p.ground === sb || (!p.supported && p.vy < 0) }));
  const ctl = phases([
    [(g, p, t) => (sb.big ? null : behind(p) ? I({ right: true }) : goTo(sb.x - 40)(g, p, t)), (g, p, t) => (sb.big ? null : goTo(2 * T)(g, p, t))],
    [(g, p, t) => (inTrench() ? null : behind(p) ? I({ right: true }) : goTo(sb.x - 40)(g, p, t)),
     (g, p, t) => (inTrench() ? null : behind(p) && (p.x + p.w > A.x - 4 || behind(A)) ? I({ right: true }) : goTo(sb.x - 80)(g, p, t))],
    [cross, (g, p, t) => (far(A) ? cross(g, p, t) : goTo(12 * T)(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'B6. Kar köprüsü geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B7. Eriyen kule: B, A'nın başına çıkar; A onu taşıyarak eriyen buza girer, B hemen rafa zıplar (buz kırılmadan), şalter (4)
  // rafın altındaki kapağı açar. B raftan sağa iner; A eriyen buzdan koşarak kapaktan geçer
  const g = new Game(L('eriyen-kule'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, lv = g.levers[0];
  const shelf = { surf: 8 * T, x0: 14 * T, x1: 17 * T };
  const spot = 13 * T + 4, ready = 9 * T;
  const ctl = phases([
    // Başlangıçta kule kurulur, A, B'yi taşıyarak buzun önüne gelir
    [(g, p, t) => (B.ground === p ? null : idle()), (g, p, t) => (p.ground === A ? null : climbOn(A)(g, p, t))],
    [(g, p, t) => (Math.abs(p.x + p.w / 2 - ready) < 6 ? null : goTo(ready)(g, p, t)), (g, p, t) => (Math.abs(A.x + A.w / 2 - ready) < 6 ? null : I({ right: A.x - p.x > 2, left: A.x - p.x < -2 }))],
    // A buza girer, B zıplar
    [(g, p, t) => (surfOn(B, shelf) ? null : B.ground === p ? I({ right: p.x < spot }) : idle()),
     (g, p, t) => {
       if (surfOn(p, shelf)) return null;
       if (p.ground === A) return A.x >= spot - 8 ? I({ jump: true, right: true }) : I({ right: A.x - p.x > 2, left: A.x - p.x < -2 });
       return I({ right: true, jump: p.vy < 0 });
     }],
    [(g, p, t) => (g.switches[1] ? null : idle()), flip(lv, 1)],
    // B raftan sağa iner; A buz donunca koşup geçer
    [(g, p, t) => (p.x > 15 * T && p.supported ? null : g.thaws.some(th => th.open) ? goTo(9 * T)(g, p, t) : I({ right: true })),
     (g, p, t) => (p.x > 17 * T && p.supported ? null : I({ right: true }))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'B7. Eriyen kule geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B8. Kartopu takozu: A ilk topu buzda iter, top kayıp presin altına girer (bant girişte tutar), küçük kalır. Pres yukarıdayken
  // topun üstünden geçerler. A düğmede (1) kapağı açar, B ikinci topu buzda iter: kapağın içine kayar, basamak tutar
  const g = new Game(L('kartopu-takozu'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, P = g.presses[0];
  const [s1, s2] = g.boxes.slice().sort((p, q) => p.x - q.x), b1 = g.buttons[0], gx = 32 * T, out = 21 * T + 10;
  const settled = () => s1.x + s1.w > 13 * T + 4 && Math.abs(s1.dx) < 0.01 && s1.supported;
  const wedged = () => s2.x >= gx - 1 && s2.supported;
  const going = new Set();
  const cross = (g, p, t) => {
    if (p.x > out) return null;
    if (P.y <= P.topY + 1 && P.dir > 0 && P.pause > 0.9 && p.x + p.w < s1.x && p.x > s1.x - 80) going.add(p);
    if (!going.has(p)) return goTo(s1.x - 50)(g, p, t);
    if (p.x > s1.x + s1.w) return I({ right: true });
    return I({ right: true, jump: p.supported || p.vy < 0 });
  };
  let shoved1 = false, shoved2 = false;
  const ctl = phases([
    [(g, p, t) => { if (settled()) return null; if (s1.dx > 1) shoved1 = true; return shoved1 ? I({ left: true }) : p.x + p.w <= s1.x + 3 ? I({ right: true }) : goTo(s1.x - 25)(g, p, t); },
     (g, p, t) => (settled() ? null : goTo(1 * T)(g, p, t))],
    [(g, p, t) => (A.x > out && B.x > out ? null : p.x > out ? goTo(22 * T + 20)(g, p, t) : B.x > out ? cross(g, p, t) || idle() : idle()),
     (g, p, t) => (A.x > out && B.x > out ? null : p.x > out ? goTo(s2.x - 40)(g, p, t) : cross(g, p, t) || idle())],
    [(g, p, t) => (wedged() ? null : goTo(b1.x + b1.w / 2)(g, p, t)),
     (g, p, t) => { if (wedged()) return null; if (!b1.pressed) return goTo(s2.x - 40)(g, p, t); if (s2.dx > 1) shoved2 = true; return shoved2 ? I({ left: true }) : p.x + p.w <= s2.x + 3 ? I({ right: true }) : goTo(s2.x - 25)(g, p, t); }],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'B8. Kartopu takozu geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B9. Buz pisti: A zamanlı düğmeye (t) basıp buzda koşar, hızla çukuru aşar, kapak kapanmadan geçer; şalterle (4) kapağı
  // açık bırakır. B de koşar
  const g = new Game(L('buz-pisti'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, tb = g.buttons[0], lv = g.levers[0];
  const gx = 29 * T, past = p => p.supported && p.x > gx + T;
  let ran = false, runT = null;
  const sprint = (g, p, t) => (past(p) ? null : I({ right: true, jump: (p.supported && p.x + p.w > 15 * T - 6 && p.x < 15 * T) || (!p.supported && p.vy < 0) }));
  const ctl = phases([
    [(g, p, t) => {
       if (past(p)) { if (runT === null) runT = g.t; return null; }
       if (!ran) { if (Math.abs(p.x + p.w / 2 - (tb.x + tb.w / 2)) < 6) ran = true; return goTo(tb.x + tb.w / 2)(g, p, t); }
       return sprint(g, p, t);
     },
     (g, p, t) => (past(A) ? null : idle())],
    [flip(lv, 1), (g, p, t) => (g.switches[1] ? null : idle())],
    [goTo(ex), (g, p, t) => (past(p) ? goTo(ex)(g, p, t) : sprint(g, p, t))],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'B9. Buz pisti geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B10. Kar fırtınası (sınav): topu büyütüp hendeğe iterler, üstünden geçerler. B, A'nın başında; A eriyen buza girer, B rafa
  // zıplar, şalter (4) rafın altındaki kapağı açar. Sırayla buzda koşup 5 karoluk çukuru aşarlar
  const g = new Game(L('kar-firtinasi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, sb = g.boxes[0], lv = g.levers[0];
  const inTrench = () => sb.big && sb.supported && sb.y > 11 * T;
  const behind = p => p.x + p.w <= sb.x + 3 && p.supported && p.ground !== sb;
  const pastTrench = p => p.supported && p.x > 16 * T && p.x < 22 * T;
  const crossT = (g, p, t) => (pastTrench(p) ? null : I({ right: true, jump: p.ground === sb || (!p.supported && p.vy < 0) }));
  const shelf = { surf: 8 * T, x0: 25 * T, x1: 28 * T }, spot = 24 * T + 4, ready = 20 * T;
  const edge = 37 * T, over = p => p.supported && p.x > 42 * T;
  const skate = (g, p, t) => (over(p) ? null : I({ right: true, jump: (p.supported && p.x + p.w > edge - 4) || (!p.supported && p.vy < 0) }));
  const ctl = phases([
    [(g, p, t) => (sb.big ? null : behind(p) ? I({ right: true }) : goTo(sb.x - 40)(g, p, t)), (g, p, t) => (sb.big ? null : goTo(2 * T)(g, p, t))],
    [(g, p, t) => (inTrench() ? null : behind(p) ? I({ right: true }) : goTo(sb.x - 40)(g, p, t)),
     (g, p, t) => (inTrench() ? null : behind(p) && (p.x + p.w > A.x - 4 || behind(A)) ? I({ right: true }) : goTo(sb.x - 80)(g, p, t))],
    [(g, p, t) => (pastTrench(p) && pastTrench(B) ? null : pastTrench(B) ? crossT(g, p, t) || goTo(17 * T)(g, p, t) : goTo(9 * T)(g, p, t)),
     (g, p, t) => (pastTrench(p) && pastTrench(A) ? null : pastTrench(p) ? goTo(19 * T)(g, p, t) : crossT(g, p, t))],
    // Kule: B, A'nın başına; A onu buzun önüne taşır
    [(g, p, t) => (B.ground === p ? null : Math.abs(p.x + p.w / 2 - (17 * T + 20)) > 6 ? goTo(17 * T + 20)(g, p, t) : idle()),
     (g, p, t) => (p.ground === A ? null : Math.abs(A.x + A.w / 2 - (17 * T + 20)) < 8 && A.supported ? climbOn(A)(g, p, t) : goTo(19 * T + 20)(g, p, t))],
    [(g, p, t) => (Math.abs(p.x + p.w / 2 - ready) < 6 ? null : goTo(ready)(g, p, t)), (g, p, t) => (Math.abs(A.x + A.w / 2 - ready) < 6 ? null : I({ right: A.x - p.x > 2, left: A.x - p.x < -2 }))],
    [(g, p, t) => (surfOn(B, shelf) ? null : B.ground === p ? I({ right: p.x < spot }) : idle()),
     (g, p, t) => {
       if (surfOn(p, shelf)) return null;
       if (p.ground === A) return A.x >= spot - 8 ? I({ jump: true, right: true }) : I({ right: A.x - p.x > 2, left: A.x - p.x < -2 });
       return I({ right: true, jump: p.vy < 0 });
     }],
    [(g, p, t) => (g.switches[1] ? null : idle()), flip(lv, 1)],
    // B raftan iner, buzda koşup çukuru aşar; A buz donunca kapaktan geçip koşar
    [(g, p, t) => (over(p) ? null : over(B) ? (p.x > 25 * T ? skate(g, p, t) || idle() : p.x > 21 * T || !g.thaws.some(th => th.open || th.crackT >= 0) ? I({ right: true }) : goTo(20 * T)(g, p, t)) : goTo(20 * T)(g, p, t)),
     (g, p, t) => (over(p) ? null : skate(g, p, t) || idle())],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'B10. Kar fırtınası geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B11. Donmuş bant: A düğmede (2) sandığı bırakır, B düğmede (3) alçak kapağı açar. Sandık banttan buza geçip kayar, kapaktan
  // geçer, duvardaki düğmeye (1) çarpar: a kapağı açılır. İkisi alçak kapağın ve basamağın üstünden çıkışa
  const g = new Game(L('donmus-bant'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0];
  const b1 = g.buttons.find(b => b.channel === 1), b2 = g.buttons.find(b => b.channel === 2), b3 = g.buttons.find(b => b.channel === 3);
  const ctl = phases([
    [(g, p, t) => (b1.pressed ? null : goTo(b2.x + b2.w / 2)(g, p, t)), (g, p, t) => (b1.pressed ? null : goTo(b3.x + b3.w / 2)(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'B11. Donmuş bant geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B12. Eriyen merdiven: A düğmede (1) kapağı tutar; B eriyen buz basamaklardan durmadan zıplayarak rafa çıkar, şalterle (4)
  // kapağı açık bırakır. Basamaklar donunca A da çıkar
  const g = new Game(L('eriyen-merdiven'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, btn = g.buttons[0], lv = g.levers[0];
  const top = p => p.supported && p.y + p.h <= 6 * T + 1 && p.x > 20 * T;
  const intact = () => g.thaws.every(th => !th.open && th.crackT < 0);
  const started = new Set();
  const climb = (g, p, t) => {
    if (top(p)) return null;
    if (!started.has(p)) { if (!intact()) return goTo(12 * T)(g, p, t); if (Math.abs(p.x + p.w / 2 - 15 * T) < 8) started.add(p); else return goTo(15 * T)(g, p, t); }
    if (p.y > 9 * T && p.supported && p.x < 16 * T && !intact()) { started.delete(p); return idle(); }   // düştüyse yeniden dene
    return I({ right: true, jump: p.supported ? true : p.vy < 0 });
  };
  const ctl = phases([
    [(g, p, t) => (g.switches[1] ? null : goTo(btn.x + btn.w / 2)(g, p, t)), (g, p, t) => (g.switches[1] ? null : top(p) ? flip(lv, 1)(g, p, t) : g.gates[0].open ? climb(g, p, t) || idle() : idle())],
    [climb, (g, p, t) => (top(A) ? null : goTo(26 * T)(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'B12. Eriyen merdiven geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B13. Buz sapanı: A düğmede (1) kapağı tutar; B buzda koşup yaya basar, 4 karoluk duvarın üstüne uçar, şalterle (4) kapağı
  // açık bırakır; A da aynı yoldan
  const g = new Game(L('buz-sapani'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, btn = g.buttons[0], lv = g.levers[0];
  const top = p => p.supported && p.y + p.h <= 7 * T + 1 && p.x > 22 * T;
  const sling = (g, p, t) => (top(p) ? null : I({ right: true }));
  const ctl = phases([
    [(g, p, t) => (g.switches[1] ? null : goTo(btn.x + btn.w / 2)(g, p, t)), (g, p, t) => (g.switches[1] ? null : top(p) ? flip(lv, 1)(g, p, t) : g.gates[0].open ? sling(g, p, t) : idle())],
    [sling, (g, p, t) => (top(A) ? null : goTo(31 * T)(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'B13. Buz sapanı geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B14. Kar asansörü: A topu karda büyütür; ikisi topu asansörün sağına iter, yanına binerler; B kenardaki şalteri (4)
  // çevirir, asansör çıkar. Yukarıda topu duvarın dibine iterler, üstünden 4 karoluk rafa zıplarlar
  const g = new Game(L('kar-asansoru'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, sb = g.boxes[0], lift = g.lifts[0];
  const behind = p => p.x + p.w <= sb.x + 3 && p.supported && p.ground !== sb;
  const push = done => [
    (g, p, t) => (done() ? null : behind(p) ? I({ right: true }) : goTo(sb.x - 40)(g, p, t)),
    (g, p, t) => (done() ? null : behind(p) && (p.x + p.w > A.x - 4 || behind(A)) ? I({ right: true }) : goTo(sb.x - 80)(g, p, t)),
  ];
  const onLift = () => sb.x + sb.w >= 18 * T - 1 && sb.ground === lift;
  const up = () => lift.y <= lift.topY + 0.5;
  const ledge = 27 * T, top = p => p.supported && p.y + p.h <= 3 * T + 1;
  const climb = (g, p, t) => {
    if (top(p)) return null;
    if (p.ground === sb) return I({ right: true, jump: true });
    if (!p.supported) return I({ right: true, jump: p.vy < 0 });
    return Math.abs(p.x + p.w / 2 - (sb.x - 30)) > 8 ? goTo(sb.x - 30)(g, p, t) : I({ right: true, jump: true });
  };
  const at = (p, x) => Math.abs(p.x + p.w / 2 - x) < 4;
  const ctl = phases([
    [(g, p, t) => (sb.big ? null : behind(p) ? I({ right: true }) : goTo(sb.x - 40)(g, p, t)), (g, p, t) => (sb.big ? null : goTo(1 * T)(g, p, t))],
    push(onLift),
    // Asansöre bin; B sol kenarda şalteri çevirir
    [(g, p, t) => (g.switches[1] ? null : at(p, lift.x + 62) ? idle() : goTo(lift.x + 62)(g, p, t)),
     (g, p, t) => (g.switches[1] ? null : at(p, lift.x + 12) && at(A, lift.x + 62) ? I({ action: tap(t) }) : at(p, lift.x + 12) ? idle() : goTo(lift.x + 12)(g, p, t))],   // asansörün sol kenarında: şalter yanında
    [(g, p, t) => (up() ? null : idle()), (g, p, t) => (up() ? null : idle())],
    push(() => sb.x + sb.w >= ledge - 1),
    [climb, (g, p, t) => (top(A) ? null : goTo(sb.x - 100)(g, p, t))],
    [(g, p, t) => (top(B) ? null : goTo(30 * T)(g, p, t)), climb],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'B14. Kar asansörü geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B15. Buzul ustası (sınav): A düğmede (2) sandığı bırakır, B düğmede (3) alçak kapağı açar; sandık banttan buza geçip
  // düğmeye (1) kayar, a kapağı açılır. Sırayla eriyen basamaklardan rafa çıkarlar, buzda koşup çukuru aşarlar
  const g = new Game(L('buzul-ustasi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2;
  const b1 = g.buttons.find(b => b.channel === 1), b2 = g.buttons.find(b => b.channel === 2), b3 = g.buttons.find(b => b.channel === 3);
  const ledge = p => p.supported && p.y + p.h <= 7 * T + 1 && p.x > 25 * T, over = p => p.supported && p.x > 42 * T;
  const intact = () => g.thaws.every(th => !th.open && th.crackT < 0);
  const started = new Set();
  const climb = (g, p, t) => {
    if (ledge(p)) return null;
    if (!started.has(p)) { if (!intact()) return goTo(21 * T)(g, p, t); if (Math.abs(p.x + p.w / 2 - (21 * T + 20)) < 8) started.add(p); else return goTo(21 * T + 20)(g, p, t); }
    if (p.supported && p.y + p.h > 10 * T && p.x < 23 * T && !intact()) { started.delete(p); return idle(); }
    return I({ right: true, jump: p.supported ? true : p.vy < 0 });
  };
  const edge = 37 * T;
  const skate = (g, p, t) => (over(p) ? null : I({ right: true, jump: (p.supported && p.x + p.w > edge - 4) || (!p.supported && p.vy < 0) }));
  const ctl = phases([
    [(g, p, t) => (b1.pressed ? null : goTo(b2.x + b2.w / 2)(g, p, t)), (g, p, t) => (b1.pressed ? null : goTo(b3.x + b3.w / 2)(g, p, t))],
    // Önce B tırmanıp kayar; A basamaklar donunca
    [(g, p, t) => (ledge(B) || over(B) ? (over(p) ? null : ledge(p) ? skate(g, p, t) : climb(g, p, t) || idle()) : goTo(20 * T)(g, p, t)),
     (g, p, t) => (over(p) ? (over(A) ? null : goTo(45 * T)(g, p, t)) : ledge(p) ? skate(g, p, t) : climb(g, p, t) || idle())],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'B15. Buzul ustası geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B16. Buz kancası: B düğmede (2) cebin kapağını açar; A şeride asılıp B'nin tam üstünde sandığı çeker, karşıya taşır, buzun
  // üstünde giderken bırakır: sandık buzda kayıp düğmeye (1) gider, basamak tutar, a kapağı açılır. İkisi asılarak geçer
  const g = new Game(L('buz-kancasi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0];
  const b2 = g.buttons.find(b => b.channel === 2), b1 = g.buttons.find(b => b.channel === 1);
  const hanging = p => !p.supported && p.vy <= 1 && p.gripT > 0;
  const holdX = b2.x + b2.w / 2, endX = 23 * T + 20;
  const land = p => p.supported && p.x > 20 * T;
  let dropped = false;
  const ctl = phases([
    [(g, p, t) => {
       if (b1.pressed) return null;
       if (!hanging(p)) return p.supported && !dropped ? (Math.abs(p.x + p.w / 2 - 6 * T) > 8 ? goTo(6 * T)(g, p, t) : B.supported && Math.abs(B.x + B.w / 2 - holdX) < 6 ? I({ jump: (t * 4 | 0) % 2 === 0 }) : idle()) : idle();
       const held = crate.y + crate.h < 10 * T && Math.abs(crate.x + crate.w / 2 - (p.x + p.w / 2)) < 60;
       if (dropped) return I({ right: p.x + p.w / 2 < endX });
       if (!held) { const d = holdX - (p.x + p.w / 2); return Math.abs(d) > 4 ? I({ right: d > 0, left: d < 0 }) : I({ action: true }); }
       if (crate.x > 22 * T) { dropped = true; return I({ right: true }); }   // buzun üstünde giderken bırak
       return I({ action: true, right: true });
     },
     (g, p, t) => (b1.pressed ? null : goTo(holdX)(g, p, t))],
    [(g, p, t) => (land(p) ? null : hangAcross(holdX + 40, endX, 1)(g, p, t) || idle()),
     (g, p, t) => (land(p) ? null : A.supported || land(A) ? hangAcross(holdX + 40, endX, 1)(g, p, t) || idle() : idle())],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'B16. Buz kancası geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B17. Eriyen fırlatma: B, A'nın başına çıkar; A onu taşıyıp duvarın dibindeki eriyen buza girer ve hemen fırlatır, B rafa
  // iner. Buz donunca A yine duvarın dibine gelir; B kutup değiştirip onu çeker
  const g = new Game(L('eriyen-firlatma'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2;
  const wallX = 12 * T, topY = 5 * T, onTop = p => p.supported && p.y + p.h <= topY + 1 && p.x + p.w > wallX;
  const spot = 11 * T + 2, intact = () => g.thaws.every(th => !th.open && th.crackT < 0);
  let launching = false;
  const ctl = phases([
    [(g, p, t) => (B.ground === p ? null : idle()), (g, p, t) => (p.ground === A ? null : climbOn(A)(g, p, t))],
    [(g, p, t) => {
       if (onTop(B)) return null;
       if (p.x < spot && !launching) return B.ground === p ? I({ right: true }) : idle();
       if (B.ground === p) launching = true; else if (B.supported || B.y + B.h < topY - 30) launching = false;
       return I({ action: launching });
     },
     (g, p, t) => {
       if (onTop(p)) return null;
       if (p.ground === A) { const d = A.x - p.x; return I({ right: d > 2, left: d < -2 }); }
       return I({ right: p.y + p.h < topY + 10 });
     }],
    // A buz donunca duvarın dibine gelir, B kutup değiştirip çeker
    [(g, p, t) => {
       if (onTop(p)) return null;
       if (p.y + p.h < topY + 4) return I({ right: true, jump: true });
       if (!p.supported) return I({ right: true, jump: p.vy < 0 });
       if (p.x + p.w / 2 < 9 * T && !intact()) return goTo(7 * T)(g, p, t);   // buz donana kadar sağlam zeminde bekle
       return B.pol !== p.pol && Math.abs(p.x + p.w / 2 - (11 * T + 20)) < 8 ? I({ jump: (t * 5 | 0) % 2 === 0 || p.vy < 0, right: p.y + p.h < topY + 40 }) : goTo(11 * T + 20)(g, p, t);
     },
     (g, p, t) => {
       if (onTop(A)) return null;
       if (p.pol === A.pol) return I({ swap: (t * 10 | 0) % 2 === 0 });
       const cx = p.x + p.w / 2, at = wallX + 20;
       if (Math.abs(cx - at) > 8) return I({ right: cx < at, left: cx > at });
       return I({ action: A.x + A.w > 10 * T, right: A.y + A.h < topY });
     }],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'B17. Eriyen fırlatma geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B18. Donmuş göl: A küçük topu eriyen buzun üstünden iter (büyük top kırar), karşıda karda yuvarlayıp büyütür. B buz donunca
  // geçer. İkisi büyük topu rafın dibine iter, üstünden 4 karoluk rafa zıplarlar
  const g = new Game(L('donmus-gol'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, sb = g.boxes[0];
  const intact = () => g.thaws.every(th => !th.open && th.crackT < 0);
  const behind = p => p.x + p.w <= sb.x + 3 && p.supported && p.ground !== sb;
  const across = p => p.supported && p.x > 12 * T;
  const wall = 25 * T, top = p => p.supported && p.y + p.h <= 7 * T + 1 && p.x > wall - 10;
  const atWall = () => sb.x + sb.w >= wall - 1;
  const climb = (g, p, t) => {
    if (top(p)) return null;
    if (p.ground === sb) return I({ right: true, jump: true });
    if (!p.supported) return I({ right: true, jump: p.vy < 0 });
    return Math.abs(p.x + p.w / 2 - (sb.x - 30)) > 8 ? goTo(sb.x - 30)(g, p, t) : I({ right: true, jump: true });
  };
  const ctl = phases([
    // A topu buzdan geçirip büyütür; B bekler
    [(g, p, t) => (sb.big ? null : behind(p) ? I({ right: true }) : goTo(sb.x - 40)(g, p, t)), (g, p, t) => (sb.big ? null : goTo(2 * T)(g, p, t))],
    [(g, p, t) => (across(B) ? null : goTo(18 * T)(g, p, t)), (g, p, t) => (across(p) ? null : p.x > 7 * T - 10 || intact() ? I({ right: true }) : goTo(5 * T)(g, p, t))],   // buz donunca başla, başlayınca durma
    [(g, p, t) => (atWall() ? null : behind(p) ? I({ right: true }) : goTo(sb.x - 40)(g, p, t)),
     (g, p, t) => (atWall() ? null : behind(p) && (p.x + p.w > A.x - 4 || behind(A)) ? I({ right: true }) : goTo(sb.x - 80)(g, p, t))],
    [climb, (g, p, t) => (top(A) ? null : goTo(sb.x - 100)(g, p, t))],
    [(g, p, t) => (top(B) ? null : goTo(28 * T)(g, p, t)), climb],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'B18. Donmuş göl geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B19. Buzlu baca: A düğmede (1) kapağı tutar; B eriyen buzdan koşup (+) mıknatıslı duvara yapışır, zıplayarak tırmanır,
  // tepede kutup değiştirip öbür yana iner, şalterle (4) kapağı açık bırakır. A da buz donunca aynı yoldan
  const g = new Game(L('buzlu-baca'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, btn = g.buttons[0], lv = g.levers[0];
  const over = p => p.supported && p.x > 13 * T;
  const intact = () => g.thaws.every(th => !th.open && th.crackT < 0);
  const started = new Set();
  const climb = (g, p, t) => {
    if (over(p)) return null;
    if (p.supported && p.y + p.h <= 3 * T + 1) return p.pol === 1 ? I({ swap: true, right: true }) : I({ right: true });   // tepede: bırak, öbür yana
    if (!started.has(p)) { if (!intact() || p.pol !== 1) return p.pol !== 1 ? I({ swap: (t * 10 | 0) % 2 === 0 }) : goTo(4 * T)(g, p, t); started.add(p); }
    return I({ right: true, jump: p.pol === 1 && (t * 6 | 0) % 2 === 0 });
  };
  const ctl = phases([
    [(g, p, t) => (g.switches[1] ? null : goTo(btn.x + btn.w / 2)(g, p, t)), (g, p, t) => (g.switches[1] ? null : over(p) ? (p.pol !== 1 ? I({ swap: (t * 10 | 0) % 2 === 0 }) : flip(lv, 1)(g, p, t)) : g.gates[0].open ? climb(g, p, t) || idle() : idle())],
    [climb, (g, p, t) => (over(A) ? null : goTo(22 * T)(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'B19. Buzlu baca geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B20. Kuzey rüzgârı (sınav): Eriyen fırlatma gibi B rafa fırlatılır, A çekilir. Yukarıda A basamağın üstünde asılıp sandığı
  // çeker, çukurun üstünden taşıyıp buzun üstünde bırakır: sandık düğmeye (1) kayar, a kapağı açılır. İkisi asılarak geçer
  const g = new Game(L('kuzey-ruzgari'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0], b1 = g.buttons[0];
  const wallX = 12 * T, topY = 6 * T, onTop = p => p.supported && p.y + p.h <= topY + 1 && p.x + p.w > wallX;
  const spot = 11 * T + 2, intact = () => g.thaws.every(th => !th.open && th.crackT < 0);
  const hanging = p => !p.supported && p.vy <= 1 && p.gripT > 0;
  const far = p => p.supported && p.x > 29 * T;
  let launching = false, dropped = false;
  const ctl = phases([
    [(g, p, t) => (B.ground === p ? null : idle()), (g, p, t) => (p.ground === A ? null : climbOn(A)(g, p, t))],
    [(g, p, t) => {
       if (onTop(B)) return null;
       if (p.x < spot && !launching) return B.ground === p ? I({ right: true }) : idle();
       if (B.ground === p) launching = true; else if (B.supported || B.y + B.h < topY - 30) launching = false;
       return I({ action: launching });
     },
     (g, p, t) => {
       if (onTop(p)) return null;
       if (p.ground === A) { const d = A.x - p.x; return I({ right: d > 2, left: d < -2 }); }
       return I({ right: p.y + p.h < topY + 10 && p.x < 13 * T });
     }],
    [(g, p, t) => {
       if (onTop(p)) return null;
       if (p.y + p.h < topY + 4) return I({ right: true, jump: true });
       if (!p.supported) return I({ right: true, jump: p.vy < 0 });
       if (p.x + p.w / 2 < 9 * T && !intact()) return goTo(7 * T)(g, p, t);
       return B.pol !== p.pol && Math.abs(p.x + p.w / 2 - (11 * T + 20)) < 8 ? I({ jump: (t * 5 | 0) % 2 === 0 || p.vy < 0, right: p.y + p.h < topY + 40 }) : goTo(11 * T + 20)(g, p, t);
     },
     (g, p, t) => {
       if (onTop(A)) return null;
       if (p.pol === A.pol) return I({ swap: (t * 10 | 0) % 2 === 0 });
       const cx = p.x + p.w / 2, at = wallX + 20;
       if (Math.abs(cx - at) > 8) return I({ right: cx < at, left: cx > at });
       return I({ action: A.x + A.w > 10 * T, right: A.y + A.h < topY });
     }],
    // B yeniden + olur ve kenara çekilir; A asılıp sandığı taşır
    [(g, p, t) => {
       if (b1.pressed) return null;
       if (!hanging(p)) return p.supported && !dropped ? (Math.abs(p.x + p.w / 2 - (18 * T + 10)) > 6 ? goTo(18 * T + 10)(g, p, t) : I({ jump: true })) : I({ right: dropped });
       const held = crate.y + crate.h < 6 * T && Math.abs(crate.x + crate.w / 2 - (p.x + p.w / 2)) < 60;
       if (dropped) return I({ right: p.x + p.w / 2 < 30 * T });
       if (!held) { const d = 17 * T + 20 - (p.x + p.w / 2); return I({ action: true, right: d > 4, left: d < -4 }); }   // mıknatıs hep açık
       if (crate.x > 30 * T) { dropped = true; return I({ right: true }); }
       return I({ action: true, right: true });
     },
     (g, p, t) => (b1.pressed ? null : p.pol !== 1 ? I({ swap: (t * 10 | 0) % 2 === 0 }) : goTo(12 * T + 20)(g, p, t))],
    [(g, p, t) => (far(p) ? null : hangAcross(16 * T + 20, 30 * T, 1)(g, p, t) || idle()),
     (g, p, t) => (far(p) ? null : hangAcross(16 * T + 20, 30 * T, 1)(g, p, t) || idle())],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'B20. Kuzey rüzgârı geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B21. Kar yayı: A düğmede (2) alçak kapağı açar; B küçük topu buzda iter: top kapaktan kayıp yaya çarpar, rafa fırlar, düğmeye
  // (1) düşer, a kapağı açılır. İkisi rafın altından çıkışa
  const g = new Game(L('kar-yayi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, sb = g.boxes[0];
  const b1 = g.buttons.find(b => b.channel === 1), b2 = g.buttons.find(b => b.channel === 2);
  let shoved = false;
  const ctl = phases([
    [(g, p, t) => (b1.pressed ? null : goTo(b2.x + b2.w / 2)(g, p, t)),
     (g, p, t) => { if (b1.pressed) return null; if (!b2.pressed) return idle(); if (sb.dx > 1) shoved = true; return shoved ? I({ left: true }) : p.x + p.w <= sb.x + 3 ? I({ right: true }) : goTo(sb.x - 25)(g, p, t); }],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'B21. Kar yayı geçildi (' + g.t.toFixed(1) + ' sn)');
}


{
  // B22. Çift yay: A düğmede (3) alçak kapakları açar; B önce birinci topu, sonra ikinciyi buzda iter: her top yaya çarpıp kendi
  // rafındaki düğmeye (1, 2) düşer; a ve b kapakları açılır
  const g = new Game(L('cift-yay'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2;
  const [s1, s2] = g.boxes.slice().sort((p, q) => p.x - q.x);
  const b1 = g.buttons.find(b => b.channel === 1), b2 = g.buttons.find(b => b.channel === 2), b3 = g.buttons.find(b => b.channel === 3);
  const shove = (ball, done) => { let shoved = false; return (g, p, t) => { if (done()) return null; if (!b3.pressed) return idle(); if (ball.dx > 1) shoved = true; return shoved ? idle() : p.x + p.w <= ball.x + 3 ? I({ right: true }) : goTo(ball.x - 25)(g, p, t); }; };
  const ctl = phases([
    [(g, p, t) => (b1.pressed ? null : goTo(b3.x + b3.w / 2)(g, p, t)), shove(s1, () => b1.pressed)],
    [(g, p, t) => (b2.pressed ? null : goTo(b3.x + b3.w / 2)(g, p, t)), (g, p, t) => (b2.pressed ? null : p.x + p.w < s2.x - 30 ? I({ right: true, jump: p.x > 8 * T && p.x < 9 * T && p.supported }) : shove(s2, () => b2.pressed)(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'B22. Çift yay geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B23. İki top: A küçük topu buzda iter, top yaya çarpıp rafın düğmesine (1) düşer: a kapağı açılır. İkinci topu A karda
  // yuvarlayıp büyütür; ikisi büyük topu kapaktan geçirip yüksek rafın dibine iter, üstünden zıplarlar
  const g = new Game(L('iki-top'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2;
  const [s1, s2] = g.boxes.slice().sort((p, q) => p.x - q.x), b1 = g.buttons[0];
  const behind = (p, b) => p.x + p.w <= b.x + 3 && p.supported && p.ground !== b;
  let shoved = false;
  const wall = 30 * T, top = p => p.supported && p.y + p.h <= 7 * T + 1 && p.x > wall - 10;
  const atWall = () => s2.x + s2.w >= wall - 1;
  const climb = (g, p, t) => {
    if (top(p)) return null;
    if (p.ground === s2) return I({ right: true, jump: true });
    if (!p.supported) return I({ right: true, jump: p.vy < 0 });
    return Math.abs(p.x + p.w / 2 - (s2.x - 30)) > 8 ? goTo(s2.x - 30)(g, p, t) : I({ right: true, jump: true });
  };
  const ctl = phases([
    [(g, p, t) => { if (b1.pressed) return null; if (s1.dx > 1) shoved = true; return shoved ? I({ left: true }) : behind(p, s1) ? I({ right: true }) : goTo(s1.x - 25)(g, p, t); },
     (g, p, t) => (b1.pressed ? null : goTo(1 * T)(g, p, t))],
    // A ikinci topa gider (yayın üstünden atlar), büyütür
    [(g, p, t) => (s2.big ? null : p.x + p.w < s2.x - 30 ? I({ right: true, jump: p.x > 8 * T && p.x < 9 * T && p.supported }) : behind(p, s2) ? I({ right: true }) : goTo(s2.x - 40)(g, p, t)),
     (g, p, t) => (s2.big ? null : goTo(1 * T)(g, p, t))],
    [(g, p, t) => (atWall() ? null : behind(p, s2) ? I({ right: true }) : goTo(s2.x - 40)(g, p, t)),
     (g, p, t) => (atWall() ? null : p.x < 10 * T ? I({ right: true, jump: p.x > 8 * T && p.supported }) : behind(p, s2) && (p.x + p.w > A.x - 4 || behind(A, s2)) ? I({ right: true }) : goTo(s2.x - 80)(g, p, t))],
    [climb, (g, p, t) => (top(A) ? null : goTo(s2.x - 100)(g, p, t))],
    [(g, p, t) => (top(B) ? null : goTo(34 * T)(g, p, t)), climb],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'B23. İki top geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B24. Kar kapısı: A topu karda büyütür; ikisi büyük topu kapağın önüne iter. A zamanlı düğmeye (t) basıp koşar; kapak 4 sn
  // açıkken ikisi topu kapağın içine iter: kapak kapanmaz. Topun üstünden geçerler
  const g = new Game(L('kar-kapisi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, sb = g.boxes[0], tb = g.buttons[0];
  const gx = 16 * T, gate = g.gates[0];
  const behind = p => p.x + p.w <= sb.x + 3 && p.supported && p.ground !== sb;
  const ready = () => sb.x + sb.w >= gx - 2;
  const wedged = () => sb.x + sb.w > gx + 10 && sb.supported;
  let pressed = false;
  const push2 = done => [
    (g, p, t) => (done() ? null : behind(p) ? I({ right: true }) : goTo(sb.x - 40)(g, p, t)),
    (g, p, t) => (done() ? null : behind(p) && (p.x + p.w > A.x - 4 || behind(A)) ? I({ right: true }) : goTo(sb.x - 80)(g, p, t)),
  ];
  const ctl = phases([
    [(g, p, t) => (sb.big ? null : behind(p) ? I({ right: true }) : goTo(sb.x - 40)(g, p, t)), (g, p, t) => (sb.big ? null : goTo(1 * T + 20)(g, p, t))],
    push2(ready),
    // A zamanlı düğmeye basıp döner; B topun arkasında bekler; kapak açıkken ikisi iter
    [(g, p, t) => {
       if (wedged()) return null;
       if (!pressed) { if (Math.abs(p.x + p.w / 2 - (tb.x + tb.w / 2)) < 6) pressed = true; return goTo(tb.x + tb.w / 2)(g, p, t); }
       return behind(p) ? I({ right: true }) : goTo(sb.x - 40)(g, p, t);
     },
     (g, p, t) => (wedged() ? null : gate.open && behind(p) && (p.x + p.w > A.x - 4 || behind(A)) ? I({ right: true }) : goTo(sb.x - 80)(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'B24. Kar kapısı geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B25. Kar ustası (sınav): A küçük topu buzda iter, top yayla rafın düğmesine (1) düşer: a kapağı açılır. A ikinci topu karda
  // büyütür; ikisi büyük topu hendeğe iter, üstünden geçerler. Sırayla eriyen basamaklardan rafa çıkarlar
  const g = new Game(L('kar-ustasi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2;
  const [s1, s2] = g.boxes.slice().sort((p, q) => p.x - q.x), b1 = g.buttons[0];
  const behind = (p, b) => p.x + p.w <= b.x + 3 && p.supported && p.ground !== b;
  let shoved = false;
  const inTrench = () => s2.big && s2.supported && s2.y > 12 * T;
  const pastTrench = p => p.supported && p.x > 26 * T && p.y + p.h <= 12 * T + 1;
  const crossT = (g, p, t) => (pastTrench(p) ? null : I({ right: true, jump: p.ground === s2 || (!p.supported && p.vy < 0) }));
  const top = p => p.supported && p.y + p.h <= 8 * T + 1 && p.x > 32 * T;
  const intact = () => g.thaws.every(th => !th.open && th.crackT < 0);
  const started = new Set();
  const climb = (g, p, t) => {
    if (top(p)) return null;
    if (!started.has(p)) { if (!intact()) return goTo(27 * T)(g, p, t); if (Math.abs(p.x + p.w / 2 - (28 * T + 20)) < 8) started.add(p); else return goTo(28 * T + 20)(g, p, t); }
    if (p.supported && p.y + p.h > 11 * T && p.x < 30 * T && !intact()) { started.delete(p); return idle(); }
    return I({ right: true, jump: p.supported ? true : p.vy < 0 });
  };
  const ctl = phases([
    [(g, p, t) => { if (b1.pressed) return null; if (s1.dx > 1) shoved = true; return shoved ? I({ left: true }) : behind(p, s1) ? I({ right: true }) : goTo(s1.x - 25)(g, p, t); },
     (g, p, t) => (b1.pressed ? null : goTo(1 * T)(g, p, t))],
    [(g, p, t) => (s2.big ? null : p.x + p.w < s2.x - 30 ? I({ right: true, jump: p.x > 7 * T && p.x < 8 * T && p.supported }) : behind(p, s2) ? I({ right: true }) : goTo(s2.x - 40)(g, p, t)),
     (g, p, t) => (s2.big ? null : goTo(1 * T)(g, p, t))],
    [(g, p, t) => (inTrench() ? null : behind(p, s2) ? I({ right: true }) : goTo(s2.x - 40)(g, p, t)),
     (g, p, t) => (inTrench() ? null : p.x < 9 * T ? I({ right: true, jump: p.x > 7 * T && p.supported }) : behind(p, s2) && (p.x + p.w > A.x - 4 || behind(A, s2)) ? I({ right: true }) : goTo(s2.x - 80)(g, p, t))],
    [(g, p, t) => (pastTrench(p) && pastTrench(B) ? null : pastTrench(B) ? crossT(g, p, t) || goTo(27 * T)(g, p, t) : goTo(19 * T)(g, p, t)),
     (g, p, t) => (pastTrench(p) && pastTrench(A) ? null : pastTrench(p) ? goTo(28 * T)(g, p, t) : crossT(g, p, t))],
    [(g, p, t) => (top(p) && top(B) ? null : top(B) ? climb(g, p, t) || idle() : goTo(26 * T + 20)(g, p, t)), (g, p, t) => (top(p) ? (top(A) ? null : goTo(40 * T)(g, p, t)) : climb(g, p, t) || idle())],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'B25. Kar ustası geçildi (' + g.t.toFixed(1) + ' sn)');
}


{
  // B26. Donmuş köprü: A küçük topu eriyen buzdan geçirir, karşıda karda büyütür; B buz donunca geçer. İkisi büyük topu hendeğe
  // iter, topun üstünden karşıya zıplarlar
  const g = new Game(L('donmus-kopru'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, sb = g.boxes[0];
  const intact = () => g.thaws.every(th => !th.open && th.crackT < 0);
  const behind = p => p.x + p.w <= sb.x + 3 && p.supported && p.ground !== sb;
  const across = p => p.supported && p.x > 12 * T;
  const inTrench = () => sb.big && sb.supported && sb.y > 10 * T;
  const far = p => p.supported && p.x > 28 * T;
  const cross = (g, p, t) => (far(p) ? null : I({ right: true, jump: p.ground === sb || (!p.supported && p.vy < 0) }));
  const ctl = phases([
    [(g, p, t) => (sb.big ? null : behind(p) ? I({ right: true }) : goTo(sb.x - 40)(g, p, t)), (g, p, t) => (sb.big ? null : goTo(2 * T)(g, p, t))],
    [(g, p, t) => (across(B) ? null : goTo(20 * T)(g, p, t)), (g, p, t) => (across(p) ? null : p.x > 7 * T - 10 || intact() ? I({ right: true }) : goTo(5 * T)(g, p, t))],
    [(g, p, t) => (inTrench() ? null : behind(p) ? I({ right: true }) : goTo(sb.x - 40)(g, p, t)),
     (g, p, t) => (inTrench() ? null : behind(p) && (p.x + p.w > A.x - 4 || behind(A)) ? I({ right: true }) : goTo(sb.x - 80)(g, p, t))],
    [cross, (g, p, t) => (far(A) ? cross(g, p, t) : goTo(20 * T)(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'B26. Donmuş köprü geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B27. Buzlu pist: A zamanlı düğmeye (t) basıp buzda koşar, çukuru aşar, kapaktan geçer, yaya basıp rafa uçar. B de aynısını yapar
  const g = new Game(L('buzlu-pist'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, tb = g.buttons[0];
  const top = p => p.supported && p.y + p.h <= 7 * T + 1 && p.x > 38 * T;
  const pressed = new Set();
  const sprint = (g, p, t) => {
    if (top(p)) return null;
    if (!pressed.has(p)) { if (Math.abs(p.x + p.w / 2 - (tb.x + tb.w / 2)) < 6) pressed.add(p); else return goTo(tb.x + tb.w / 2)(g, p, t); }
    return I({ right: true, jump: (p.supported && p.x + p.w > 15 * T - 6 && p.x < 15 * T) || (!p.supported && p.vy < 0 && p.x < 20 * T) });
  };
  const ctl = phases([
    [sprint, (g, p, t) => (top(A) ? null : goTo(4 * T)(g, p, t))],
    [(g, p, t) => (top(B) ? null : goTo(44 * T)(g, p, t)), sprint],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'B27. Buzlu pist geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B28. Fırtına kulesi: A küçük topu buzda iter, top yayla rafın düğmesine (1) düşer: a kapağı açılır. B, A'nın başına çıkar;
  // A onu eriyen buza taşır, B rafa zıplar, şalter (5) b kapağını açar; çıkış
  const g = new Game(L('firtina-kulesi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, sb = g.boxes[0], b1 = g.buttons[0], lv = g.levers[0];
  const behind = p => p.x + p.w <= sb.x + 3 && p.supported && p.ground !== sb;
  let shoved = false;
  const shelf = { surf: 8 * T, x0: 21 * T, x1: 24 * T }, spot = 20 * T + 4, ready = 16 * T + 20;
  const hop = (g, p, t, dir) => I({ right: dir > 0, left: dir < 0, jump: (p.supported && Math.abs(p.x + p.w / 2 - 8 * T - 20) < 40) || (!p.supported && p.vy < 0) });   // yayın üstünden atla
  let back = false;
  const ctl = phases([
    // A yayın üstünden sola gidip topu iter, sonra geri döner
    [(g, p, t) => {
       if (b1.pressed && back) return null;
       if (b1.pressed || shoved && sb.dx < 0.5) { back = true; return p.x > 12 * T ? null : hop(g, p, t, 1); }
       if (p.x > 9 * T && !shoved) return hop(g, p, t, -1);
       if (sb.dx > 1) shoved = true;
       return shoved ? I({ left: true }) : behind(p) ? I({ right: true }) : goTo(sb.x - 25)(g, p, t);
     },
     (g, p, t) => (b1.pressed && back ? null : idle())],
    // Yayın sağında kule; A, B'yi taşıyarak kapaktan geçip buzun önüne gelir
    [(g, p, t) => (B.ground === p ? null : Math.abs(p.x + p.w / 2 - (12 * T + 20)) > 6 ? goTo(12 * T + 20)(g, p, t) : idle()),
     (g, p, t) => (p.ground === A ? null : Math.abs(A.x + A.w / 2 - (12 * T + 20)) < 8 && A.supported ? climbOn(A)(g, p, t) : idle())],
    [(g, p, t) => (Math.abs(p.x + p.w / 2 - ready) < 6 ? null : I({ right: p.x + p.w / 2 < ready, left: p.x + p.w / 2 > ready + 6 })),
     (g, p, t) => (Math.abs(A.x + A.w / 2 - ready) < 6 ? null : I({ right: A.x - p.x > 2, left: A.x - p.x < -2 }))],
    [(g, p, t) => (surfOn(B, shelf) ? null : B.ground === p ? I({ right: p.x < spot }) : idle()),
     (g, p, t) => {
       if (surfOn(p, shelf)) return null;
       if (p.ground === A) return A.x >= spot - 8 ? I({ jump: true, right: true }) : I({ right: A.x - p.x > 2, left: A.x - p.x < -2 });
       return I({ right: true, jump: p.vy < 0 });
     }],
    [(g, p, t) => (g.switches[2] ? null : idle()), flip(lv, 2)],
    [(g, p, t) => (p.x > 22 * T && p.supported ? goTo(ex)(g, p, t) : p.x > 17 * T || !g.thaws.some(th => th.open || th.crackT >= 0) ? I({ right: true }) : goTo(16 * T)(g, p, t)),
     (g, p, t) => (p.x > 24 * T && p.supported ? goTo(ex)(g, p, t) : I({ right: true }))],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'B28. Fırtına kulesi geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B29. Fırtına koşusu: Eriyen fırlatma gibi B rafa fırlatılır, A çekilir. Yukarıda A zamanlı düğmeye (t) basıp buzda koşar,
  // kapak kapanmadan geçer, şalterle (4) açık bırakır; B de geçer
  const g = new Game(L('firtina-kosusu'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, tb = g.buttons[0], lv = g.levers[0];
  const wallX = 12 * T, topY = 5 * T, onTop = p => p.supported && p.y + p.h <= topY + 1 && p.x + p.w > wallX;
  const spot = 11 * T + 2, intact = () => g.thaws.every(th => !th.open && th.crackT < 0);
  const past = p => p.supported && p.x > 40 * T;
  let launching = false, pressed = false;
  const ctl = phases([
    [(g, p, t) => (B.ground === p ? null : idle()), (g, p, t) => (p.ground === A ? null : climbOn(A)(g, p, t))],
    [(g, p, t) => {
       if (onTop(B)) return null;
       if (p.x < spot && !launching) return B.ground === p ? I({ right: true }) : idle();
       if (B.ground === p) launching = true; else if (B.supported || B.y + B.h < topY - 30) launching = false;
       return I({ action: launching });
     },
     (g, p, t) => {
       if (onTop(p)) return null;
       if (p.ground === A) { const d = A.x - p.x; return I({ right: d > 2, left: d < -2 }); }
       return I({ right: p.y + p.h < topY + 10 && p.x < 13 * T });
     }],
    [(g, p, t) => {
       if (onTop(p)) return null;
       if (p.y + p.h < topY + 4) return I({ right: true, jump: true });
       if (!p.supported) return I({ right: true, jump: p.vy < 0 });
       if (p.x + p.w / 2 < 9 * T && !intact()) return goTo(7 * T)(g, p, t);
       return B.pol !== p.pol && Math.abs(p.x + p.w / 2 - (11 * T + 20)) < 8 ? I({ jump: (t * 5 | 0) % 2 === 0 || p.vy < 0, right: p.y + p.h < topY + 40 }) : goTo(11 * T + 20)(g, p, t);
     },
     (g, p, t) => {
       if (onTop(A)) return null;
       if (p.pol === A.pol) return I({ swap: (t * 10 | 0) % 2 === 0 });
       const cx = p.x + p.w / 2, at = wallX + 20;
       if (Math.abs(cx - at) > 8) return I({ right: cx < at, left: cx > at });
       return I({ action: A.x + A.w > 10 * T, right: A.y + A.h < topY });
     }],
    // A zamanlı düğmeye basıp koşar; B kenarda bekler
    [(g, p, t) => {
       if (past(p)) return g.switches[1] ? null : flip(lv, 1)(g, p, t);
       if (!pressed) { if (Math.abs(p.x + p.w / 2 - (tb.x + tb.w / 2)) < 6) pressed = true; return goTo(tb.x + tb.w / 2)(g, p, t); }
       return I({ right: true });
     },
     (g, p, t) => (g.switches[1] ? null : p.pol !== 1 ? I({ swap: (t * 10 | 0) % 2 === 0 }) : goTo(12 * T + 20)(g, p, t))],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'B29. Fırtına koşusu geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // B30. Pusula iğnesi III (final): sırayla buzda koşup 5 karoluk çukuru aşarlar. A topu karda büyütür, ikisi hendeğe iter,
  // üstünden geçerler. B, A'nın başına çıkar; A onu eriyen buza taşır, B rafa zıplar, iğne parçasını alır; kapı, çıkış
  const g = new Game(L('pusula-ignesi-3'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, sb = g.boxes[0], piece = g.keys[0], door = g.doors[0];
  const edge = 13 * T, over = p => p.supported && p.x > 18 * T - 10;
  const skate = (g, p, t) => (over(p) ? null : I({ right: true, jump: (p.supported && p.x + p.w > edge - 4) || (!p.supported && p.vy < 0) }));
  const behind = p => p.x + p.w <= sb.x + 3 && p.supported && p.ground !== sb;
  const inTrench = () => sb.big && sb.supported && sb.y > 11 * T;
  const pastTrench = p => p.supported && p.x > 32 * T && p.y + p.h <= 11 * T + 1;
  const crossT = (g, p, t) => (pastTrench(p) ? null : I({ right: true, jump: p.ground === sb || (!p.supported && p.vy < 0) }));
  const shelf = { surf: 8 * T, x0: 38 * T, x1: 41 * T }, spot = 37 * T + 4, ready = 33 * T + 20;
  const ctl = phases([
    [(g, p, t) => (over(B) ? skate(g, p, t) : idle()), (g, p, t) => (over(p) && over(A) ? null : over(p) ? goTo(19 * T)(g, p, t) : skate(g, p, t))],
    [(g, p, t) => (sb.big ? null : behind(p) ? I({ right: true }) : goTo(sb.x - 40)(g, p, t)), (g, p, t) => (sb.big ? null : goTo(18 * T + 20)(g, p, t))],
    [(g, p, t) => (inTrench() ? null : behind(p) ? I({ right: true }) : goTo(sb.x - 40)(g, p, t)),
     (g, p, t) => (inTrench() ? null : behind(p) && (p.x + p.w > A.x - 4 || behind(A)) ? I({ right: true }) : goTo(sb.x - 80)(g, p, t))],
    [(g, p, t) => (pastTrench(p) && pastTrench(B) ? null : pastTrench(B) ? crossT(g, p, t) || idle() : goTo(25 * T)(g, p, t)),
     (g, p, t) => (pastTrench(p) && pastTrench(A) ? null : pastTrench(p) ? goTo(34 * T + 10)(g, p, t) : crossT(g, p, t))],
    // Kule: B, A'nın başına; A onu eriyen buza taşır, B rafa zıplar
    [(g, p, t) => (B.ground === p ? null : Math.abs(p.x + p.w / 2 - ready) > 6 ? goTo(ready)(g, p, t) : idle()),
     (g, p, t) => (p.ground === A ? null : Math.abs(A.x + A.w / 2 - ready) < 8 && A.supported ? climbOn(A)(g, p, t) : goTo(32 * T + 20)(g, p, t))],
    [(g, p, t) => (surfOn(B, shelf) ? null : B.ground === p ? I({ right: p.x < spot }) : idle()),
     (g, p, t) => {
       if (surfOn(p, shelf)) return null;
       if (p.ground === A) return A.x >= spot - 8 ? I({ jump: true, right: true }) : I({ right: A.x - p.x > 2, left: A.x - p.x < -2 });
       return I({ right: true, jump: p.vy < 0 });
     }],
    [(g, p, t) => (piece.holder ? null : idle()), (g, p, t) => (piece.holder === p ? null : goTo(piece.x + piece.w / 2)(g, p, t))],
    // B raftan sağa inip kapıyı açar; A buz donunca rafın altından geçer
    [(g, p, t) => (door.open && p.x > 38 * T ? goTo(ex)(g, p, t) : p.x > 34 * T || !g.thaws.some(th => th.open || th.crackT >= 0) ? I({ right: !(p.x > 40 * T && !door.open) }) : goTo(33 * T)(g, p, t)),
     (g, p, t) => (door.open ? goTo(ex)(g, p, t) : I({ right: true }))],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'B30. Pusula iğnesi III geçildi (' + g.t.toFixed(1) + ' sn)');
}

console.log('Kuzey öğeleri');
{
  const map = ['##########', '#.%%%....#', '#........#', '#....FFFF#', '#........#', '#........#', '#....ffff#', '#........#', '#........#', '#S.....E.#', '##########'];
  // Perde: zıplama 6 karoyu aşar, 7'yi aşmaz; perde dışında normal
  const height = x => {
    const g = new Game({ name: 't', map }, 1), p = g.players[0];
    p.x = x; let top = p.y;
    for (let i = 0; i < 180; i++) { g.step(DT, [I({ jump: i > 3 })]); top = Math.min(top, p.y); }
    return g.spawn.y + T - p.h - top;
  };
  const inside = height(3 * T), outside = height(6 * T);
  ok(inside > 6 * T && inside < 7 * T, 'perdede zıplama 6 karoyu aşar, 7 karoyu aşmaz (' + (inside / T).toFixed(1) + ')');
  ok(outside < 3 * T, 'perde dışında zıplama normal (' + (outside / T).toFixed(1) + ')');
  // Köprü: kanalı açıkken uzar, üstüne basılır, kapanınca söner; ters köprü tersini yapar
  const g = new Game({ name: 't', map }, 1), p = g.players[0], B = g.bridges.find(b => !b.inverse), R = g.bridges.find(b => b.inverse);
  ok(B.lit === 0 && R.lit === R.n, 'köprü başta sönük, ters köprü başta yanık');
  g.switches[1] = true;
  run(g, [idle], 0.2);
  ok(B.lit > 0 && B.lit < B.n, 'köprü karo karo uzar (' + B.lit.toFixed(1) + ')');
  run(g, [idle], 1);
  ok(B.lit === B.n && R.lit === 0, 'kanal açıkken köprü yanar, ters köprü söner');
  ok(B.fromRight && B.c + B.n === 9, 'duvara dayalı köprü duvardan uzar');
  p.x = 6 * T; p.y = 4 * T; p.vy = 0;
  run(g, [idle], 0.8);
  ok(p.supported && p.y + p.h === 6 * T, 'köprünün üstüne basılır');
  g.switches[1] = false;
  run(g, [idle], 0.4);
  ok(B.lit === 0 && p.y + p.h > 6 * T, 'kanal kapanınca köprü söner, üstündeki düşer');
  // Alttan geçilir
  const h = new Game({ name: 't', map }, 1), q = h.players[0], lit = h.bridges.find(b => !b.inverse);
  h.switches[1] = true; run(h, [idle], 1);
  q.x = 6 * T; q.y = 6 * T + 2; q.vy = -600;
  run(h, [idle], 0.25);
  ok(q.y + q.h < 6 * T, 'köprüden alttan geçilir');
  ok(lit.lit === lit.n && !validateLevel({ name: 't', map }).length, 'perde ve köprü karoları doğrulamadan geçer');
}

{
  // Işın: alıcıya varınca kanalı açar; cisim, kapalı kapak keser; yürüyen, başının üstünden geçen ışını kesmez
  const map = ['##########', '#........#', '#........#', '#........#', '#........#', '#.[.a..q.#', '#........#', '#........#', '#S.....E.#', '##########'];
  const g = new Game({ name: 't', map }, 1), p = g.players[0];
  run(g, [idle], 0.1);
  ok(!g.channelOn(1) && g.beams[0].end === 4 * T, 'kapalı kapak ışını keser');
  g.switches[1] = true; run(g, [idle], 0.1);
  ok(g.beams[0].ch === 1 && g.beams[0].end === 7 * T + 20, 'açık kapaktan geçen ışın alıcıya varır');
  p.x = 5 * T; p.y = 5 * T - 40; p.vy = 0;
  let cut = false; run(g, [idle], 1, g => { if (g.beams[0].ch === 0) cut = true; return false; });
  ok(cut && g.beams[0].ch === 1, 'düşen oyuncu ışını keserken kanal kapanır, geçince açılır');
}

{
  // K1. Işık perdesi: B perdede zıplayıp rafa çıkar, düğmede kapağı tutar; A geçip şalteri çevirir
  const g = new Game(L('isik-perdesi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, btn = g.buttons[0], lv = g.levers[0];
  const ctl = phases([
    [idle, perdeUp(7 * T + 20, 6 * T, 1)],
    [(g, p, t) => (p.x > 21 * T ? null : g.gates[0].open ? goTo(22 * T)(g, p, t) : idle()), (g, p, t) => (A.x > 21 * T ? null : goTo(btn.x + btn.w / 2)(g, p, t))],
    [flip(lv, 1), idle],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K1. Işık perdesi geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // K2. Işık köprüsü: A düğmede köprüyü yakar, B geçip karşı düğmeyle A'yı geçirir. A ikinci düğmede yüksek köprüyü yakar,
  // B perdede zıplayıp alttan köprüye çıkar, şalteri çevirir; A da aynı yoldan
  const g = new Game(L('isik-koprusu'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, lv = g.levers[0];
  const bL = g.buttons.find(b => b.channel === 1 && b.x < 5 * T), bR = g.buttons.find(b => b.channel === 1 && b.x > 5 * T), b2 = g.buttons.find(b => b.channel === 2);
  const low = g.bridges.find(b => b.channel === 1), cx = b => b.x + b.w / 2, over = p => p.supported && p.x > 19 * T;
  const ctl = phases([
    [(g, p, t) => (over(B) ? null : goTo(cx(bL))(g, p, t)), (g, p, t) => (over(p) ? null : low.lit >= 10 ? I({ right: true }) : idle())],
    [(g, p, t) => (over(p) ? null : low.lit >= 10 ? I({ right: true }) : idle()), (g, p, t) => (over(A) ? null : goTo(cx(bR))(g, p, t))],
    [(g, p, t) => (Math.abs(p.x + p.w / 2 - cx(b2)) < 8 && p.supported ? null : goTo(cx(b2))(g, p, t)), (g, p, t) => (p.x > 24 * T ? null : goTo(24 * T + 20)(g, p, t))],
    [(g, p, t) => (surfOn(B, { surf: 6 * T, x0: 24 * T, x1: 40 * T }) ? null : idle()), perdeUp(24 * T + 20, 6 * T, 0)],
    [idle, flip(lv, 2)],
    [perdeUp(24 * T + 20, 6 * T, 0), idle],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K2. Işık köprüsü geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // K3. Zıt köprüler: düğmeye basan köprüleri değiştirir; öbürü sütunda bekleyip sıradakine geçer. Karşıda roller değişir
  const g = new Game(L('zit-kopru'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2;
  const bL = g.buttons[0], bR = g.buttons[1], cx = b => b.x + b.w / 2;
  const at = (p, c) => p.supported && !p.ground && p.x + p.w / 2 > c * T && p.x + p.w / 2 < (c + 1) * T;
  // Sütunlar 13, 19; karşı zemin 26: walker c'ye yürür, köprü yanınca
  const lit = (g, i) => g.bridges[i].lit >= g.bridges[i].n;
  const walk = (c, i) => (g, p, t) => (at(p, c) ? null : lit(g, i) ? goTo(c * T + 20)(g, p, t) : idle());
  const off = (b, x) => (g, p, t) => (Math.abs(p.x + p.w / 2 - x) < 8 ? null : goTo(x)(g, p, t));
  const on = b => (g, p, t) => (b.pressed ? null : goTo(cx(b))(g, p, t));
  const ctl = phases([
    [on(bL), idle],
    [idle, walk(13, 0)],
    [off(bL, 4 * T), idle],
    [idle, walk(19, 1)],
    [on(bL), idle],
    [idle, walk(26, 2)],
    [idle, on(bR)],
    [walk(13, 0), idle],
    [idle, off(bR, 28 * T)],
    [walk(19, 1), idle],
    [idle, on(bR)],
    [walk(25, 2), idle],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K3. Zıt köprüler geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // K4. Perde kulesi: A, B'nin başından perdede rafa çıkar (tek zıplama 6 karoda kalır), şalteri çevirir; B köprüden çıkar
  const g = new Game(L('perde-kulesi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, lv = g.levers[0];
  const spot = 9 * T + 16, surf = 4 * T;
  const ctl = phases([
    [(g, p, t) => (Math.abs(B.x + B.w / 2 - spot) < 8 ? null : idle()), (g, p, t) => (Math.abs(p.x + p.w / 2 - spot) < 8 ? null : goTo(spot)(g, p, t))],
    [towerPerde(B, surf, 8 * T), idle],
    [flip(lv, 1), idle],
    [idle, perdeUp(8 * T + 20, 7 * T, 0)],
    [idle, perdeUp(9 * T + 16, surf, 1)],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K4. Perde kulesi geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // K5. Perde sınavı: A düğmede kapağı açar, B perdede süzülüp çukuru aşar, karşı düğmeyle A'yı geçirir. Zıt köprülerde rol değişimi.
  // Son rafta kule: A şalteri çevirir, B köprüden çıkar
  const g = new Game(L('perde-sinavi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, lv = g.levers[0];
  const bL = g.buttons[0], bR = g.buttons[1], c2 = g.buttons[2], d2 = g.buttons[3], cx = b => b.x + b.w / 2;
  const across = p => p.supported && p.x > 18 * T;
  const floatOver = (g, p, t) => (across(p) ? null : g.gates[0].open && p.x > 6 * T ? I({ right: true, jump: !p.supported || p.x + p.w > 9 * T - 3 }) : g.gates[0].open ? I({ right: true }) : idle());
  const on = b => (g, p, t) => (b.pressed ? null : goTo(cx(b))(g, p, t));
  const off = x => (g, p, t) => (Math.abs(p.x + p.w / 2 - x) < 8 ? null : goTo(x)(g, p, t));
  const at = (p, c) => p.supported && !p.ground && p.x + p.w / 2 > c * T && p.x + p.w / 2 < (c + 1) * T;
  const lit = (g, i) => g.bridges[i].lit >= g.bridges[i].n;
  const G = g.bridges.find(b => b.inverse), f = g.bridges.find(b => !b.inverse && b.channel === 2);
  const i0 = g.bridges.indexOf(G), i1 = g.bridges.indexOf(f);
  const walk = (c, i) => (g, p, t) => (at(p, c) ? null : lit(g, i) ? goTo(c * T + 20)(g, p, t) : idle());
  const spot = 41 * T + 16, surf = 5 * T;
  const ctl = phases([
    [on(bL), idle],
    [idle, floatOver],
    [idle, on(bR)],
    [floatOver, idle],
    [idle, (g, p, t) => (p.x > 23 * T ? null : goTo(23 * T + 20)(g, p, t))],
    [on(c2), (g, p, t) => (c2.pressed ? null : idle())],
    [off(21 * T), idle],
    [idle, walk(29, i0)],
    [on(c2), idle],
    [idle, walk(35, i1)],
    [off(23 * T + 22), idle],
    [idle, on(d2)],
    [off(23 * T + 22), idle],
    [idle, off(38 * T)],
    [walk(29, i0), idle],
    [idle, on(d2)],
    [walk(35, i1), idle],
    [(g, p, t) => (Math.abs(B.x + B.w / 2 - spot) < 8 ? null : goTo(37 * T)(g, p, t)), (g, p, t) => (Math.abs(p.x + p.w / 2 - spot) < 8 ? null : goTo(spot)(g, p, t))],
    [towerPerde(B, surf, 9 * T), idle],
    [flip(lv, 3), idle],
    [idle, perdeUp(40 * T + 20, 8 * T, 0)],
    [idle, perdeUp(41 * T + 16, surf, 1)],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'K5. Perde sınavı geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // K6. Işık ışını: A ışında durur, ters kapak açılır; B geçip sandığı geri iter, sandık ışını keser; ikisi geçer
  const g = new Game(L('isik-isini'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0];
  const ctl = phases([
    [(g, p, t) => (Math.abs(p.x + p.w / 2 - 2.5 * T) < 8 ? null : goTo(2.5 * T)(g, p, t)), (g, p, t) => (g.gates[0].open && p.supported && !p.ground && p.x > crate.x + crate.w ? null : g.gates[0].open && p.x > 15 * T ? I({ right: true, jump: !p.supported || (t * 4 | 0) % 2 === 0 }) : g.gates[0].open ? I({ right: true }) : idle())],
    [idle, (g, p, t) => (crate.x < 205 ? null : I({ left: true }))],
    [idle, (g, p, t) => (p.x > 16 * T ? null : I({ right: true }))],
    [(g, p, t) => (p.supported && !p.ground && p.x > crate.x + crate.w ? null : I({ right: true, jump: !p.supported || (t * 4 | 0) % 2 === 0 })), idle],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K6. Işık ışını geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // K7. Kutu gölgesi: ikisi ağır kutuyu ışının altına iter; ters köprü yanar, üstünden atlayıp geçerler
  const g = new Game(L('kutu-golgesi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, box = g.boxes[0];
  const cut = () => box.x + box.w > 12 * T + 34;
  const push = (g, p, t) => (cut() ? null : I({ right: true }));
  const ctl = phases([
    [push, push],
    [idle, hopPast(box)],
    [hopPast(box), (g, p, t) => (p.x > 28 * T ? null : g.bridges[0].lit >= 10 ? I({ right: true }) : idle())],
    [(g, p, t) => (p.x > 25 * T ? null : I({ right: true })), idle],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K7. Kutu gölgesi geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // K8. Buz mercek: A eriyen buza çıkar, kırılınca ışın alıcıya varır; B köprü sönmeden karşıya koşar, şalteri çevirir
  const g = new Game(L('buz-mercek'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, br = g.bridges[0], lv = g.levers[0];
  const over = p => p.supported && p.x > 31 * T;
  const ctl = phases([
    [idle, (g, p, t) => (p.x > 19 * T - 2 ? null : goTo(19 * T + 16)(g, p, t))],
    [(g, p, t) => (g.thaws[0].crackT >= 0 ? null : p.supported && Math.abs(p.x + p.w / 2 - 5.5 * T) > 6 ? goTo(5.5 * T)(g, p, t) : I({ jump: true, right: p.y + p.h < 9 * T })), idle],
    [(g, p, t) => (over(B) ? null : p.supported && p.y + p.h <= 9 * T + 1 ? idle() : goTo(9 * T)(g, p, t)), (g, p, t) => (over(p) ? null : br.lit >= 2 || p.x > 20 * T ? I({ right: true }) : idle())],
    [idle, flip(lv, 1)],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K8. Buz mercek geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // K9. Işık zinciri: A düğmede kapağı tutar; B perdeden rafa çıkıp sandığı ışının yolundan iter. Işın ikinci ışının kapağını açar,
  // köprü yanar; B geçip şalterle kalıcı yapar, A gelir
  const g = new Game(L('isik-zinciri'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, crate = g.boxes[0], lv = g.levers[0], br = g.bridges[0], b3 = g.buttons[0];
  const ctl = phases([
    [(g, p, t) => (b3.pressed ? null : goTo(b3.x + b3.w / 2)(g, p, t)), perdeUp(26 * T, 6 * T, -1)],
    [idle, (g, p, t) => (p.x + p.w < crate.x - 2 ? null : I({ left: true, jump: !p.supported || (t * 4 | 0) % 2 === 0 }))],
    [idle, (g, p, t) => (crate.y > 6 * T ? null : I({ right: true }))],
    [idle, (g, p, t) => (p.supported && p.x > 28 * T ? null : br.lit >= 10 || p.x < 25 * T || !p.supported ? I({ right: p.x < 27 * T || br.lit >= 10 }) : idle())],
    [idle, flip(lv, 2)],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K9. Işık zinciri geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // K10. Işın sınavı: kutu ışının altına; ters köprüden geçilir. A eriyen buzu kırar, B koşar, şalter; A gelir
  const g = new Game(L('isin-sinavi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, box = g.boxes[0], lv = g.levers[0], br = g.bridges.find(b => !b.inverse);
  const cut = () => box.x + box.w > 9 * T + 34, push = (g, p, t) => (cut() ? null : I({ right: true }));
  const past = p => p.supported && p.x > 18 * T, over = p => p.supported && p.x > 44 * T;
  const walkOver = (g, p, t) => (past(p) ? null : I({ right: true }));
  const ctl = phases([
    [push, push],
    [idle, hopPast(box)],
    [hopPast(box), walkOver],
    [walkOver, (g, p, t) => (p.x > 35 * T - 8 ? null : goTo(35 * T + 10)(g, p, t))],
    [(g, p, t) => (g.thaws[0].crackT >= 0 ? null : p.supported && Math.abs(p.x + p.w / 2 - 19.5 * T) > 6 ? goTo(19.5 * T)(g, p, t) : I({ jump: true, right: p.y + p.h < 10 * T })), idle],
    [(g, p, t) => (over(B) ? null : p.supported && p.y + p.h <= 10 * T + 1 ? idle() : goTo(22 * T)(g, p, t)), (g, p, t) => (over(p) ? null : br.lit >= 2 || p.x > 36 * T ? I({ right: true }) : idle())],
    [idle, flip(lv, 2)],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'K10. Işın sınavı geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // K11. Yüksek yay: B yayla rafa çıkar, düğmede kapağı tutar; A geçip şalterle köprüyü yakar; B köprüden karşıya geçer
  const g = new Game(L('yuksek-yay'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, btn = g.buttons[0], lv = g.levers[0], br = g.bridges[0];
  const up = (g, p, t) => {
    if (p.supported && p.y + p.h <= 4 * T + 1) return Math.abs(p.x + p.w / 2 - (btn.x + btn.w / 2)) < 6 ? null : goTo(btn.x + btn.w / 2)(g, p, t);
    if (!p.supported) return p.y + p.h < 4 * T ? I({ right: true }) : I();
    return goTo(8 * T + 20)(g, p, t);
  };
  const ctl = phases([
    [idle, up],
    [(g, p, t) => (p.x > 22 * T ? null : goTo(23 * T)(g, p, t)), idle],
    [flip(lv, 2), idle],
    [idle, (g, p, t) => (p.x > 22 * T ? null : br.lit >= br.n ? I({ right: true }) : idle())],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K11. Yüksek yay geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // K12. Sandık yayı: B düğmede kapakları tutar; A aşağı inip sandığı yaya iter, sandık ince rafa konar, kapaklar açık kalır
  const g = new Game(L('sandik-yayi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, btn = g.buttons.find(b => b.y > 8 * T), c = g.boxes[0];
  const placed = () => c.supported && c.y < 5 * T;
  const ctl = phases([
    [idle, (g, p, t) => (btn.pressed ? null : goTo(btn.x + btn.w / 2)(g, p, t))],
    [(g, p, t) => (p.x > 13 * T && p.supported ? null : goTo(14 * T)(g, p, t)), idle],
    [(g, p, t) => (placed() ? null : c.supported && c.y > 12 * T && c.x + c.w < 24 * T + 4 ? I({ right: true }) : I()), idle],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K12. Sandık yayı geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // K13. Hafif sandık: B düğmede kafesin kapağını açar; A raftan sandığı perdede yukarı çeker, üstteki düğmeye sürükler; ikisi geçer
  const g = new Game(L('hafif-sandik'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, c = g.boxes[0], b1 = g.buttons.find(b => b.channel === 1), b2 = g.buttons.find(b => b.channel === 2);
  const surf = 6 * T, up = () => c.supported && c.y + c.h <= surf + 1;
  const ctl = phases([
    [idle, (g, p, t) => (b1.pressed ? null : goTo(b1.x + b1.w / 2)(g, p, t))],
    [(g, p, t) => (p.x > 8 * T + 30 && p.y + p.h <= 9 * T + 1 ? null : goTo(9 * T + 30)(g, p, t)), idle],
    [perdeUp(9 * T + 30, surf, 1), idle],
    [(g, p, t) => (up() ? null : Math.abs(p.x + p.w / 2 - 11.6 * T) > 6 ? goTo(11.6 * T)(g, p, t) : I({ action: true })), idle],
    [(g, p, t) => (c.ground !== p && c.y + c.h > surf - 1 && p.x + p.w <= c.x + 2 && p.supported ? null : c.ground === p ? I({ left: true }) : goTo(c.x - 19)(g, p, t)), idle],
    [(g, p, t) => (b2.pressed ? null : I({ right: true })), idle],
    [idle, (g, p, t) => (p.x > 8 * T + 30 && p.y + p.h <= 9 * T + 1 ? null : goTo(9 * T + 30)(g, p, t))],
    [idle, perdeUp(9 * T + 30, surf, 1)],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K13. Hafif sandık geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // K14. Perde fırlatma: A, B'yi rafa fırlatır; B kutup değiştirip A'yı çeker. İkisi raftan karşıya süzülür
  const g = new Game(L('perde-firlatma'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, surf = 8 * T;
  const both = () => [A, B].every(p => p.supported && p.y + p.h <= surf + 1);
  const glide = (g, p, t) => (p.supported && p.x > 23 * T ? null : I({ right: true, jump: p.x + p.w / 2 > 12 * T + 20 }));
  const ctl = phases([climbWall(g, A, B, 7 * T, 9 * T, surf, both), [glide, idle], [idle, glide], [goTo(ex), goTo(ex)]]);
  ok(run(g, ctl, 60, g => g.done), 'K14. Perde fırlatma geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // K15. Süzülüş sınavı: B düğmede kapağı tutar; A aşağıda sandığı yaya iter, raftaki sandık ışını keser, ters kapak açılır.
  // A geri döner; ikisi geçer. A, B'yi rafa fırlatır, B çeker; raftan karşıya süzülürler
  const g = new Game(L('suzulus-sinavi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, c = g.boxes[0], btn = g.buttons[0], surf = 7 * T;
  const placed = () => c.supported && c.y < 6 * T;
  const both = () => [A, B].every(p => p.supported && p.y + p.h <= surf + 1);
  const glide = (g, p, t) => (p.supported && p.x > 36 * T ? null : I({ right: true, jump: !p.supported || (!p.prevJump && p.x + p.w / 2 > 26 * T + 16) }));
  // Raftan önce sağdaki süzülür (arkadaşına takılmasın)
  let first = null;
  const lead = (g, p, t) => { first = first || (A.x > B.x ? A : B); return p === first ? glide(g, p, t) : null; };
  const rest = (g, p, t) => (p === first ? null : glide(g, p, t));
  const past = x => (g, p, t) => (p.x > x && p.supported ? null : goTo(x + 40)(g, p, t));
  const inv = g.gates.find(x => x.inverse), a = g.gates.find(x => !x.inverse);
  g.step(DT, [I(), I()]);
  ok(!inv.open && !a.open, 'K15. başta iki kapak da kapalı (ışın ters kapağı kapalı tutar)');
  const ctl = phases([
    [idle, (g, p, t) => (btn.pressed ? null : goTo(btn.x + btn.w / 2)(g, p, t))],
    [(g, p, t) => (p.x + p.w < 12 * T && p.supported ? null : goTo(10.5 * T)(g, p, t)), idle],
    [(g, p, t) => (placed() ? null : c.supported && c.y > 13 * T && c.x > 3 * T ? I({ left: true }) : I()), idle],
    [(g, p, t) => (inv.open ? (p.x > 13 * T && p.supported ? null : goTo(14 * T)(g, p, t)) : I()), idle],
    [past(20 * T), past(20 * T)],
    climbWall(g, A, B, 23 * T, 25 * T, surf, both),
    [lead, lead],
    [rest, rest],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'K15. Süzülüş sınavı geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // Ayna fiziği: sabit ayna döndürür, döner ayna kanalıyla yön değiştirir, cisim keser, ayna sandığı çevirir
  const row = s => '#' + s.padEnd(18, '.') + '#';
  const g = new Game({ name: 'a', map: ['#'.repeat(20), row('......r'), row('.'), row('[.....h.....q'), row('.'), row('......s'), row('.'), row('S.1.............E'), '#'.repeat(20)] }, 2);
  g.step(DT, [I(), I()]);
  ok(g.beams[0].ch === 2 && g.beams[0].pts.length === 6, 'döner ayna başta "/": sağa giden ışın yukarı döner, alıcıya varır');
  g.players[0].x = g.buttons[0].x; g.step(DT, [I(), I()]); g.step(DT, [I(), I()]);
  ok(g.beams[0].ch === 3, 'düğmeye basılınca ayna "\\\\" olur: ışın aşağı döner');
  const f = new Game({ name: 'a', map: ['#'.repeat(20), row('.'), row('[....e'), row('.'), row('.'), row('.....e..q'), row('.'), row('S...............E'), '#'.repeat(20)] }, 2);
  f.step(DT, [I(), I()]);
  ok(f.beams[0].ch === 1 && f.beams[0].pts.length === 8, 'iki sabit ayna ışını merdiven gibi çevirir');
  f.players[0].x = 6 * T + 3; f.players[0].y = 3 * T; f.step(DT, [I(), I()]);
  ok(f.beams[0].ch === 0 && Math.abs(f.beams[0].end - 3 * T) < 2, 'aynadan sonraki parçayı cisim keser');
  const c = new Game({ name: 'a', map: ['#'.repeat(20), row('.'), row('.'), row('.......q'), row('.'), row('.'), row('S...l........]'), '#'.repeat(20)] }, 2);
  c.step(DT, [I(), I()]);
  ok(c.beams[0].ch === 0 && c.beams[0].pts.length === 6, 'ayna sandığı ışını yukarı çevirir; sütun tutmazsa alıcıya varmaz');
  const box = c.boxes[0]; box.x = 8 * T + 1; c.step(DT, [I(), I()]);
  ok(c.beams[0].ch === 1, 'ayna sandığı alıcının sütununa gelince ışın alıcıya varır');
}

{
  // K16. Ayna: A rafta ışını keser, ters kapak açılır; B geçip karşıda inen ışını keser, A gelir
  const g = new Game(L('ayna'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, inv = g.gates[0];
  g.step(DT, [I(), I()]);
  ok(!inv.open, 'K16. ışın varken ters kapak kapalı');
  const ctl = phases([
    [(g, p, t) => (p.supported && p.y + p.h <= 10 * T + 1 && Math.abs(p.x + p.w / 2 - 5 * T) < 8 ? null : goTo(5 * T)(g, p, t)), idle],
    [(g, p, t) => (p.supported && p.y + p.h <= 8 * T + 1 && p.x > 7 * T + 8 ? null : I({ jump: !p.supported || !p.prevJump, right: true })), idle],
    [idle, (g, p, t) => (Math.abs(p.x + p.w / 2 - 26.5 * T) < 8 ? null : inv.open || p.x > 17 * T ? goTo(26.5 * T)(g, p, t) : idle())],
    [(g, p, t) => (p.x > 17 * T ? null : goTo(19 * T)(g, p, t)), idle],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K16. Ayna geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // K17. Makas: A düğmede yakın köprüyü yakar, B adaya geçip adadaki düğmeye basar; A geçer. B inince uzak köprü yanar, ikisi geçer
  const g = new Game(L('makas'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, [b0, b1] = g.buttons;
  const near = g.bridges.find(x => x.channel === 3), far = g.bridges.find(x => x.channel === 2);
  const on = b => (g, p, t) => (b.pressed && overlap(p, { x: b.x, y: b.y - 4, w: b.w, h: b.h + 4 }) ? null : goTo(b.x + b.w / 2)(g, p, t));
  const ctl = phases([
    [on(b0), idle],
    [idle, (g, p, t) => (b1.pressed ? null : near.lit >= near.n || p.x > 16 * T ? goTo(b1.x + b1.w / 2)(g, p, t) : idle())],
    [(g, p, t) => (p.supported && p.x > 16 * T ? null : goTo(16.5 * T)(g, p, t)), idle],
    [idle, (g, p, t) => (p.x > 19 * T + 6 && p.supported ? null : I({ right: true }))],
    [idle, (g, p, t) => (p.x > 28 * T && p.supported ? null : far.lit >= far.n ? I({ right: true }) : idle())],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K17. Makas geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // K18. Ayna sandığı: A aşağıda sandığı iter; B köprülerden geçip şalteri çevirir, alttaki kapak açılır
  const g = new Game(L('ayna-sandigi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, c = g.boxes[0], lv = g.levers[0];
  const near = g.bridges.find(x => x.channel === 3), far = g.bridges.find(x => x.channel === 2);
  const cx = () => c.x + c.w / 2;
  const ctl = phases([
    [(g, p, t) => (p.y > 8 * T && p.supported ? null : I({ left: true })), idle],
    [(g, p, t) => (cx() >= 12.3 * T ? null : I({ right: true })), idle],
    [idle, (g, p, t) => (p.x > 16 * T && p.supported ? null : near.lit >= near.n || p.x > 10 * T ? goTo(17 * T)(g, p, t) : goTo(8.5 * T)(g, p, t))],
    [(g, p, t) => (cx() >= 18.3 * T ? null : I({ right: true })), idle],
    [idle, (g, p, t) => (p.x > 26 * T && p.supported ? null : far.lit >= far.n ? goTo(27 * T)(g, p, t) : idle())],
    [idle, flip(lv, 1)],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K18. Ayna sandığı geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // K19. Zamanlı ayna: B kuleyle rafa çıkar; ikisi zamanlı düğmelerde iki aynayı çevirir, ışın alıcıya varır; bırakıp köprüden koşarlar
  const g = new Game(L('zamanli-ayna'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, t1 = g.buttons.find(b => b.channel === 1), t2 = g.buttons.find(b => b.channel === 2);
  const on = b => (g, p, t) => (b.pressed && overlap(p, { x: b.x, y: b.y - 4, w: b.w, h: b.h + 4 }) ? null : goTo(b.x + b.w / 2)(g, p, t));
  const ctl = phases([
    [(g, p, t) => (Math.abs(p.x + p.w / 2 - 6.4 * T) < 8 ? null : goTo(6.4 * T)(g, p, t)), idle],
    [idle, towerUp(A, 9 * T, 1)],
    [idle, on(t2)],
    [on(t1), idle],
    [(g, p, t) => (g.beams[0].ch === 3 ? null : idle()), idle],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K19. Zamanlı ayna geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // K20. Ayna sınavı: A aşağıda ayna sandığını iter, yakın köprü yanar; B adadaki düğmeye basar, alttaki kapak açılır, A geçer.
  // B inince döner ayna uzak köprüyü yakar, B geçer
  const g = new Game(L('ayna-sinavi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, c = g.boxes[0], btn = g.buttons[0];
  const near = g.bridges.find(x => x.channel === 3), far = g.bridges.find(x => x.channel === 2);
  g.step(DT, [I(), I()]);
  ok(far.lit > 0 && near.lit === 0 && !g.gates[0].open, 'K20. başta uzak köprü yanıyor, yakın köprü sönük, kapak kapalı');
  const ctl = phases([
    [(g, p, t) => (p.y > 8 * T && p.supported ? null : I({ left: true })), idle],
    [(g, p, t) => (c.x + c.w / 2 >= 12.3 * T ? null : I({ right: true })), idle],
    [idle, (g, p, t) => (btn.pressed ? null : near.lit >= near.n || p.x > 10 * T ? goTo(btn.x + btn.w / 2)(g, p, t) : goTo(8.5 * T)(g, p, t))],
    [(g, p, t) => (p.inExit || (p.x > 32 * T && p.supported) ? null : g.gates[0].open ? goTo(33 * T)(g, p, t) : idle()), idle],
    [idle, (g, p, t) => (p.x > 19 * T + 6 && p.supported ? null : I({ right: true }))],
    [idle, (g, p, t) => (p.x > 26 * T && p.supported ? null : far.lit >= far.n ? I({ right: true }) : idle())],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K20. Ayna sınavı geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // K21. Buzlu perde: B düğmede kapağı tutar, A geçip içerdeki düğmeyle B'yi alır; ikisi buzda hızlanıp perdede karşıya süzülür
  const g = new Game(L('buzlu-perde'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, [b0, b1] = g.buttons;
  const on = b => (g, p, t) => (b.pressed && overlap(p, { x: b.x, y: b.y - 4, w: b.w, h: b.h + 4 }) ? null : goTo(b.x + b.w / 2)(g, p, t));
  const leap = (g, p, t) => (p.supported && p.x > 34 * T ? null : p.supported && p.x + p.w / 2 < 21 * T + 28 ? I({ right: true }) : I({ right: true, jump: true }));
  const ctl = phases([
    [idle, on(b0)],
    [on(b1), idle],
    [idle, (g, p, t) => (p.x > 9 * T + 2 && p.supported ? null : goTo(9.5 * T)(g, p, t))],
    [(g, p, t) => (p.supported && p.x > 34 * T ? null : p.x < 13 * T ? I({ right: true }) : leap(g, p, t)), idle],
    [idle, leap],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K21. Buzlu perde geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // K22. Pres ritmi: A düğmede presi yukarıda tutar, ışın kesilmez, köprü yanar; B geçip karşıdaki düğmeyle A'yı alır
  const g = new Game(L('pres-ritmi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, [b0, b1] = g.buttons, br = g.bridges[0];
  const on = b => (g, p, t) => (b.pressed && overlap(p, { x: b.x, y: b.y - 4, w: b.w, h: b.h + 4 }) ? null : goTo(b.x + b.w / 2)(g, p, t));
  const ctl = phases([
    [on(b0), idle],
    [idle, (g, p, t) => (b1.pressed ? null : br.lit >= br.n || p.x > 11 * T ? goTo(b1.x + b1.w / 2)(g, p, t) : goTo(9 * T)(g, p, t))],
    [(g, p, t) => (p.x > 26 * T && p.supported ? null : br.lit >= br.n ? goTo(27 * T)(g, p, t) : idle()), idle],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K22. Pres ritmi geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // K23. Buz aynası: B düğmede kapağı açar, A aşağı iner, sandığı iter, eriyen buzda durur. A üstünden buzu kırar, geri döner,
  // sandığı iter; sandık yayıcıya dayanınca köprü yanar. B geçip şalterle alttaki kapağı açar
  const g = new Game(L('buz-aynasi'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, c = g.boxes[0], lv = g.levers[0], th = g.thaws[0], btn = g.buttons[0], br = g.bridges[0];
  const stop1 = () => c.x + c.w >= 13 * T - 1 && c.x + c.w < 14 * T, stop2 = () => c.x + c.w >= 19 * T - 1;
  const ctl = phases([
    [idle, (g, p, t) => (btn.pressed ? null : goTo(btn.x + btn.w / 2)(g, p, t))],
    [(g, p, t) => (p.y > 8 * T && p.supported ? null : I({ left: true })), idle],
    [(g, p, t) => (stop1() ? null : c.vx > 10 ? I() : I({ right: true })), idle],
    [(g, p, t) => (p.ground === c ? null : I({ right: p.x + p.w / 2 < c.x + c.w / 2, left: p.x > c.x + 2, jump: p.x + p.w > c.x - 40 && (!p.prevJump || !p.supported) })), idle],
    [(g, p, t) => (th.crackT >= 0 ? null : I({ right: true })), idle],
    [(g, p, t) => (p.x + p.w <= c.x + 3 && p.supported ? null : I({ left: true, jump: !p.supported || !p.prevJump })), idle],
    [(g, p, t) => (stop2() ? null : th.open ? I({ right: true }) : I()), idle],
    [idle, (g, p, t) => (p.x > 22 * T && p.supported ? null : br.lit >= br.n ? goTo(23 * T)(g, p, t) : goTo(13 * T)(g, p, t))],
    [idle, flip(lv, 1)],
    [(g, p, t) => (p.inExit || (p.x > 32 * T && p.supported) ? null : goTo(33 * T)(g, p, t)), idle],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K23. Buz aynası geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // K24. Ters bant: A sandığı bandın tersine yayıcıya dayar ve itmeyi sürdürür, köprü yanar; B geçip şalterle kalıcı yapar; A perdeden çıkıp gelir
  const g = new Game(L('ters-bant'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, c = g.boxes[0], lv = g.levers[0], br = g.bridges[0];
  const ctl = phases([
    [(g, p, t) => (p.y > 8 * T && p.supported ? null : I({ left: true })), idle],
    [(g, p, t) => (br.lit >= br.n ? null : I({ right: true })), idle],
    [(g, p, t) => (g.switches[3] ? null : I({ right: true })), (g, p, t) => (p.x > 26 * T && p.supported ? (g.switches[3] ? null : flip(lv, 3)(g, p, t) || null) : br.lit >= br.n ? goTo(27 * T)(g, p, t) : goTo(17 * T)(g, p, t))],
    [(g, p, t) => (p.supported && p.y + p.h <= 7 * T + 1 ? null : p.supported && Math.abs(p.x + p.w / 2 - 2 * T) < 8 ? I({ jump: !p.prevJump || !p.supported }) : p.supported ? goTo(2 * T)(g, p, t) : I({ jump: true, right: p.y + p.h < 7 * T - 2 })), idle],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 60, g => g.done), 'K24. Ters bant geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // K25. Kuzey yolu: kapaktan sırayla geçilir, buzda hızlanıp perdede karşıya süzülünür; pres köprüsünde biri düğmede presi tutar
  const g = new Game(L('kuzey-yolu'), 2), [A, B] = g.players, ex = g.exit.x + g.exit.w / 2, [b0, b1, b2, b3] = g.buttons, br = g.bridges[0];
  const on = b => (g, p, t) => (b.pressed && overlap(p, { x: b.x, y: b.y - 4, w: b.w, h: b.h + 4 }) ? null : goTo(b.x + b.w / 2)(g, p, t));
  const leap = (g, p, t) => (p.supported && p.x > 30 * T ? null : p.x < 10 * T ? I({ right: true }) : p.supported && p.x + p.w / 2 < 17 * T + 28 ? I({ right: true }) : I({ right: true, jump: true }));
  const ctl = phases([
    [idle, on(b0)],
    [on(b1), idle],
    [idle, (g, p, t) => (p.x > 7 * T && p.supported ? null : goTo(7 * T + 20)(g, p, t))],
    [leap, idle],
    [idle, leap],
    [on(b2), idle],
    [idle, (g, p, t) => (b3.pressed ? null : br.lit >= br.n || p.x > 35 * T ? goTo(b3.x + b3.w / 2)(g, p, t) : goTo(33.5 * T)(g, p, t))],
    [(g, p, t) => (p.x > 43 * T && p.supported ? null : br.lit >= br.n ? goTo(43.5 * T)(g, p, t) : idle()), idle],
    [goTo(ex), goTo(ex)],
  ]);
  ok(run(g, ctl, 90, g => g.done), 'K25. Kuzey yolu geçildi (' + g.t.toFixed(1) + ' sn)');
}

console.log(failed ? '\\n' + failed + ' test başarısız' : '\\nTüm testler geçti');
`, ctx);
