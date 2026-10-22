// İstemci tarafı tahmin testi: node test/predict.test.js
// Sunucuyu başlatır; tarayıcıdaki net.js + predict.js'i yapay gecikmeli bir istemcide çalıştırır.
// Kendi top tuşa hemen tepki vermeli, sunucunun durumu gelince yapılan düzeltmeler küçük kalmalı.
const { spawn } = require('child_process');
const fs = require('fs'), vm = require('vm'), path = require('path');
const WebSocket = require('ws');

const PORT = 3998;
const LAG = 150;   // gidiş-dönüşe eklenen gecikme (ms)
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ctx = vm.createContext({ console, Math, Map, Set, btoa, atob, TextEncoder, TextDecoder, Uint8Array, performance });
for (const f of ['config.js', 'levels.js', 'game.js', 'net.js', 'predict.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const { Game, Predict, applySnapshot, STEP } = vm.runInContext('({ Game, Predict, applySnapshot, STEP })', ctx);

function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const c = { ws, msgs: [], onMsg: null };
  ws.on('message', d => { const m = JSON.parse(d); c.msgs.push(m); if (c.onMsg) c.onMsg(m); });
  c.open = new Promise(r => ws.on('open', r));
  c.send = m => ws.send(JSON.stringify(m));
  c.wait = async (pred, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const m = c.msgs.find(pred); if (m) return m; await sleep(10); }
    return null;
  };
  return c;
}

// Tuş senaryosu (sn): yürü, zıpla, dur, geri dön ve zıpla, dur
function script(t) {
  const i = { left: false, right: false, jump: false, action: false, swap: false };
  if (t > 0.3 && t < 1.5) i.right = true;
  if (t > 0.8 && t < 1.05) i.jump = true;
  if (t > 2.0 && t < 2.8) i.left = true;
  if (t > 2.2 && t < 2.3) i.jump = true;
  return i;
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mb-predict-test-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dataDir, ENV_FILE: '/nonexistent' } });
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('hazır')) r(); }));
  try {
    console.log(`Tahmin (${LAG} ms gecikme)`);
    const a = client(), b = client();
    await Promise.all([a.open, b.open]);
    a.send({ t: 'create', name: 'A' });
    const room = await a.wait(m => m.t === 'room');
    b.send({ t: 'join', name: 'B', code: room.code });
    await a.wait(m => m.t === 'room' && m.members.length === 2);
    a.send({ t: 'start', level: 0 });
    await a.wait(m => m.t === 'start');

    const g = new Game(0, 2);
    g.players[0].isMe = true;
    Predict.reset(g, 0);
    let last = null;
    a.onMsg = m => { if (m.t === 's') setTimeout(() => { applySnapshot(g, m); last = m; }, LAG / 2); };
    const send = m => setTimeout(() => a.send(m), LAG / 2);

    // Her uzlaştırmada tahminin ne kadar kaydığı (DEBUG=1 büyükleri yazar)
    const fixes = [];
    const t0 = performance.now();
    const reconcile = Predict.reconcile.bind(Predict);
    Predict.reconcile = (gg, sv, ack) => {
      const ox = Predict.body.x, oy = Predict.body.y;
      reconcile(gg, sv, ack);
      fixes.push(Math.hypot(Predict.body.x - ox, Predict.body.y - oy));
      if (process.env.DEBUG && fixes[fixes.length - 1] > 1) console.log('    düzeltme', ((performance.now() - t0) / 1000).toFixed(2), 'sn', fixes[fixes.length - 1].toFixed(1), 'px, a =', JSON.stringify(ack));
    };

    let seq = 0, bits = -1, x0 = null, moved = null, jumpedAt = null;
    let prev = t0;
    await new Promise(done => {
      const timer = setInterval(() => {
        const now = performance.now(), t = (now - t0) / 1000, dt = Math.min(0.1, (now - prev) / 1000);
        prev = now;
        const inp = script(t);
        const bb = (inp.left ? 1 : 0) | (inp.right ? 2 : 0) | (inp.jump ? 4 : 0);
        if (bb !== bits) { bits = bb; send({ t: 'i', b: bb, s: ++seq }); }
        Predict.step(g, inp, seq, dt);
        const me = g.players[0];
        if (inp.right && x0 === null) x0 = me.x;
        if (x0 !== null && moved === null && t > 0.3 + 0.05) moved = me.x - x0;   // basıştan ~50 ms sonra
        if (inp.jump && jumpedAt === null) jumpedAt = me.y;
        if (t > 4) { clearInterval(timer); done(); }
      }, 1000 / 60);
    });

    ok(moved > 3, `sağa basınca top sunucuyu beklemeden yürüdü (50 ms'de ${moved.toFixed(1)} px)`);
    // Tuşlar adım numarası taşımadığı için ağ titremesi bir tuşu sunucuda bir adım kayabilir;
    // bu yüzden tuş değişimlerinde bir adımlık (yürürken ~4 px) düzeltme olağandır, fazlası değil.
    const big = fixes.filter(f => f > 1).length;
    const max = Math.max(...fixes);
    ok(fixes.length > 150, `sunucu durumları uzlaştırıldı (${fixes.length})`);
    ok(max < 12 && big <= 8, `düzeltmeler en fazla bir adımlık: ${fixes.length} uzlaştırmadan ${big} tanesi 1 px'ten büyük, en büyük ${max.toFixed(1)} px`);
    const me = g.players[0], sp = last.p[0];
    ok(Math.hypot(me.x - sp[0], me.y - sp[1]) < 1, `durunca tahmin sunucuyla aynı yerde (${me.x.toFixed(1)},${me.y.toFixed(1)} / ${sp[0]},${sp[1]})`);
    a.ws.close(); b.ws.close();
  } finally {
    srv.kill();
  }
  console.log(failed ? '\n' + failed + ' test başarısız' : '\nTüm testler geçti');
  process.exit(failed ? 1 : 0);
})();
