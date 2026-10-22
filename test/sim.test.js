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
        if (ch && '=xyz^PN'.includes(ch)) return true;
      }
      return false;
    };
    g.screws.forEach(sc => {
      const r = Math.floor(sc.y / T), c = Math.floor(sc.x / T);
      if (!near(r, c, reach) && !helper(r, c)) bad.push(l.id + ' (' + r + ',' + c + ')');
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
      if (list[i].every((f, j) => f(g, g.players[j], t) === null)) i++;
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
const passPresses = (presses, toX, speed = PHYS.runSpeed) => (g, p, t) => {
  if (p.x + p.w / 2 >= toX - 6) return null;
  const next = presses.filter(P => P.x + P.w > p.x).sort((a, b) => a.x - b.x)[0];
  if (next && p.x + p.w > next.x - 14 && p.x < next.x + next.w) {
    const inside = p.x + p.w > next.x;
    const safe = (next.y <= next.topY + 1 && next.dir > 0 && next.pause > (next.w + p.w + 20) / speed) || g.channelOn(next.channel);
    if (!inside && !safe) return I();   // sütunun önünde bekle
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

console.log(failed ? '\\n' + failed + ' test başarısız' : '\\nTüm testler geçti');
`, ctx);
