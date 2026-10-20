// Sunucu entegrasyon testi: node test/server.test.js
// Sunucuyu ayrı bir portta başlatır, iki WebSocket istemcisiyle oda kurar, bölüm oynatır.
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const PORT = 3999;
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function client(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const c = { ws, name, msgs: [], last: {} };
  ws.on('message', d => { const m = JSON.parse(d); c.msgs.push(m); c.last[m.t] = m; });
  c.open = new Promise(r => ws.on('open', r));
  c.send = m => ws.send(JSON.stringify(m));
  c.wait = async (pred, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const m = c.msgs.find(pred); if (m) return m; await sleep(20); }
    return null;
  };
  return c;
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, PORT } });
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('hazır')) r(); }));
  try {
    console.log('Sunucu');
    const page = await fetch(`http://localhost:${PORT}/`).then(r => r.text());
    ok(page.includes('<canvas'), 'ana sayfa sunuluyor');
    const leak = await fetch(`http://localhost:${PORT}/server/server.js`).then(r => r.status);
    const pkg = await fetch(`http://localhost:${PORT}/package.json`).then(r => r.status);
    ok(leak === 404 && pkg === 404, 'sunucu kodu ve proje dosyaları dışarı verilmiyor');

    console.log('Oda');
    const a = client('Ayşe'), b = client('Bora');
    await Promise.all([a.open, b.open]);
    a.send({ t: 'create', name: 'Ayşe' });
    const roomA = await a.wait(m => m.t === 'room');
    ok(roomA && /^[A-Z2-9]{4}$/.test(roomA.code), 'oda kuruldu, kod: ' + (roomA && roomA.code));

    const bad = client('X'); await bad.open;
    bad.send({ t: 'join', name: 'X', code: 'ZZZZ' });
    ok(!!(await bad.wait(m => m.t === 'error')), 'olmayan odaya katılma hata verir');
    bad.ws.close();

    b.send({ t: 'join', name: 'Bora', code: roomA.code.toLowerCase() });
    const roomB = await b.wait(m => m.t === 'room');
    ok(roomB && roomB.members.length === 2 && roomB.members[1].name === 'Bora', 'ikinci oyuncu küçük harfli kodla katıldı');

    b.send({ t: 'start', level: 0 });
    await sleep(150);
    ok(!b.msgs.some(m => m.t === 'start'), 'bölümü yalnızca oda kurucusu başlatabilir');

    a.send({ t: 'start', level: 0 });
    const startB = await b.wait(m => m.t === 'start');
    ok(startB && startB.you === 1 && startB.players.length === 2, 'bölüm başladı, ikinci oyuncu 2P');

    const s0 = await a.wait(m => m.t === 's');
    ok(!!s0, 'durum yayını geliyor');
    const x0 = s0.p[1][0];
    b.send({ t: 'i', b: 2 });   // sağ
    await sleep(600);
    const x1 = b.last.s.p[1][0];
    ok(x1 > x0 + 50, `B'nin tuşu sunucuda oyuncuyu hareket ettirdi (${x0} → ${x1})`);
    ok(Math.abs(a.last.s.p[1][0] - x1) < 20, 'iki istemci aynı durumu görüyor');
    b.send({ t: 'i', b: 0 });

    // Bölümü sunucuda bitir: iki oyuncu sağa gidip engellerde zıplar
    let done = null;
    for (let i = 0; i < 120 && !done; i++) {
      for (const [c, k] of [[a, 0], [b, 1]]) {
        const s = c.last.s, p = s && s.p[k];
        if (p && p[6]) { c.send({ t: 'i', b: 0 }); continue; }   // kapıya girdiyse dur (zıplamak kapıdan çıkarır)
        const exitX = 29 * 40 + 20, d = p ? exitX - (p[0] + 17) : 1;   // 1. bölümün çıkışı 29. sütunda
        const dir = Math.abs(d) < 8 ? 0 : d > 0 ? 2 : 1;
        const jump = p && dir && (i % 4 < 2);
        c.send({ t: 'i', b: dir | (jump ? 4 : 0) });
      }
      await sleep(100);
      done = a.msgs.find(m => m.t === 'complete');
      if (process.env.DEBUG && i % 10 === 0) console.log('    ', a.last.s.time, JSON.stringify(a.last.s.p.map(p => [p[0], p[1], p[6]])));
    }
    ok(!!done, '1. bölüm online oynanıp bitirildi (' + (done ? done.time.toFixed(1) + ' sn' : 'bitmedi') + ')');

    b.send({ t: 'next' });
    const st2 = await a.wait(m => m.t === 'start' && m.level === 1);
    ok(!!st2, 'herhangi bir oyuncu sonraki bölüme geçirebilir');

    console.log('Kendi bölümün online');
    a.send({ t: 'lobby' });
    await a.wait(m => m.t === 'room' && m.state === 'lobby');
    const mine = { name: 'Benim bölümüm', magnet: true, map: [
      '##########', '#........#', '#........#', '#........#', '#........#', '#.S....E.#', '##########'] };
    a.send({ t: 'custom', def: Object.assign({}, mine, { map: mine.map.map(r => r.replace('E', '.')) }) });
    ok(!!(await a.wait(m => m.t === 'error' && /çıkış/.test(m.msg))), 'geçersiz bölüm sunucuda reddedilir (çıkış yok)');
    b.send({ t: 'custom', def: mine });
    await sleep(150);
    ok(!(b.last.room && b.last.room.custom), 'kendi bölümünü yalnızca oda kurucusu yükleyebilir');
    a.send({ t: 'custom', def: mine });
    const withCustom = await b.wait(m => m.t === 'room' && m.custom);
    ok(withCustom && withCustom.custom.name === 'Benim bölümüm', 'kurucunun bölümü odadaki herkese görünür');
    a.send({ t: 'start', custom: true });
    const cs = await b.wait(m => m.t === 'start' && m.level === -1);
    ok(cs && cs.def && cs.def.map.length === 7 && cs.def.magnet, 'kendi bölümü online başladı, tanımı herkese gitti');
    const sCustom = await b.wait(m => m.t === 's' && m.p.length === 2 && m.p[0][1] < 7 * 40);
    ok(!!sCustom, 'sunucu kendi bölümünü simüle ediyor');

    b.ws.close();
    const back = await a.wait(m => m.t === 'room' && m.state === 'lobby' && m.members.length === 1);
    ok(!!back, 'oyuncu ayrılınca tek kalan odaya döner');
    a.ws.close();
  } finally {
    srv.kill();
  }
  console.log(failed ? '\n' + failed + ' test başarısız' : '\nTüm testler geçti');
  process.exit(failed ? 1 : 0);
})();
