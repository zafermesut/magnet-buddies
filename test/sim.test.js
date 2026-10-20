// Başsız fizik ve bölüm testleri: node test/sim.test.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { console, Math, Map, Set };
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
  const g = new Game(0, 2), ex = g.exit.x + T / 2;
  ok(run(g, [goTo(ex), goTo(ex)], 20, g => g.done), '1. Merhaba geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // 2. Anahtar: A anahtarı alır, kapıya götürür; sonra ikisi çıkışa
  const g = new Game(1, 2), ex = g.exit.x + T / 2, key = g.keys[0];
  const keyX = key.x + key.w / 2;
  const a = (g, p, t) => (!key.used && key.holder !== p ? goTo(keyX, { hopAtEnd: true })(g, p, t) : goTo(ex)(g, p, t));
  const b = (g, p, t) => (g.doors[0].open ? goTo(ex)(g, p, t) : idle());
  ok(run(g, [a, b], 30, g => g.done), '2. Anahtar geçildi (' + g.t.toFixed(1) + ' sn)');
}
{
  // 3. Kule: A çıkıntının yanında bekler, B onun üstüne çıkıp çıkıntıya zıplar, anahtarı alır
  const g = new Game(2, 2), ex = g.exit.x + T / 2, key = g.keys[0];
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
  const g = new Game(3, 2), ex = g.exit.x + T / 2;
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
  const g = new Game(4, 2), ex = g.exit.x + T / 2, box = g.boxes[0];
  const c = (g, p, t) => (box.x + box.w < 20 * T - 2 ? I({ right: true }) : goTo(ex)(g, p, t));
  ok(run(g, [c, c], 40, g => g.done), '5. Ağır kutu geçildi (' + g.t.toFixed(1) + ' sn)');
}

{
  // 6. Hepsi birden: kutuyu duvara it → üst kata çık → kule ile anahtar → kapı → düğmelerle geçiş → çıkış
  const g = new Game(5, 2), ex = g.exit.x + T / 2, box = g.boxes[0], key = g.keys[0], door = g.doors[0];
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

console.log(failed ? '\\n' + failed + ' test başarısız' : '\\nTüm testler geçti');
`, ctx);
