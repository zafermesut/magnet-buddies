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
  const dataDir = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'mb-server-test-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dataDir, ENV_FILE: '/nonexistent' } });
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('hazır')) r(); }));
  try {
    console.log('Sunucu');
    const page = await fetch(`http://localhost:${PORT}/`).then(r => r.text());
    ok(page.includes('<canvas'), 'ana sayfa sunuluyor');
    const ver = require('../package.json').version;
    const build = (page.match(/<meta name="build" content="([0-9a-f]+)" data-version="([^"]+)"/) || []);
    ok(build[1] && build[2] === ver, `sayfaya sürüm yazılıyor (${build[2]}, ${build[1]})`);
    const hc = client('Sürüm'); await hc.open;
    const hello = await hc.wait(m => m.t === 'hello');
    ok(hello && hello.build === build[1] && hello.version === ver, 'bağlanınca sunucu sürümünü bildiriyor');
    hc.ws.close();
    ok(/src="js\/main\.js\?v=[0-9a-f]{10}"/.test(page) && /href="css\/style\.css\?v=/.test(page), 'js ve css adreslerinde sürüm var (eski önbellek kullanılmaz)');
    const leak = await fetch(`http://localhost:${PORT}/server/server.js`).then(r => r.status);
    const pkg = await fetch(`http://localhost:${PORT}/package.json`).then(r => r.status);
    ok(leak === 404 && pkg === 404, 'sunucu kodu ve proje dosyaları dışarı verilmiyor');
    const three = await fetch(`http://localhost:${PORT}/vendor/three/build/three.module.min.js`);
    ok(three.status === 200 && /javascript/.test(three.headers.get('content-type')), 'Three.js sunuluyor');
    const bloom = await fetch(`http://localhost:${PORT}/vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js`).then(r => r.status);
    ok(bloom === 200, 'Three.js eklentileri sunuluyor');
    const escapes = await Promise.all([
      '/vendor/three/package.json',
      '/vendor/three/../ws/package.json',
      '/vendor/three/%2e%2e/%2e%2e/package.json',
      '/vendor/three/build/../../../server/server.js',
    ].map(p => fetch(`http://localhost:${PORT}${p}`).then(r => r.status)));
    // fetch '../' kısımlarını kendisi temizler; ham istekle adresi olduğu gibi gönder
    const raw = p => new Promise(resolve => {
      require('http').get({ host: 'localhost', port: PORT, path: p }, r => { r.resume(); resolve(r.statusCode); });
    });
    const rawEscapes = await Promise.all([
      '/vendor/three/../ws/package.json',
      '/vendor/three/build/../../../server/server.js',
      '/vendor/three/build/..%2f..%2f..%2fpackage.json',
      '/vendor/three/examples/jsm/../../package.json',
    ].map(raw));
    ok(escapes.concat(rawEscapes).every(s => s === 404), 'vendor adresinden Three.js dışına çıkılamıyor (' + escapes.concat(rawEscapes).join(',') + ')');

    console.log('Oda');
    const a = client('Ayşe'), b = client('Bora');
    await Promise.all([a.open, b.open]);
    a.send({ t: 'create', name: 'Ayşe' });
    const roomA = await a.wait(m => m.t === 'room');
    ok(roomA && /^[A-Z2-9]{4}$/.test(roomA.code), 'oda kuruldu, kod: ' + (roomA && roomA.code));

    a.send({ t: 'ping', c: 1234.5 });
    const pong = await a.wait(m => m.t === 'pong');
    ok(pong && pong.c === 1234.5, 'ping yanıtı gönderilen zamanı geri döndürür');

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
    const n0 = a.msgs.filter(m => m.t === 's').length;
    await sleep(500);
    const rate = (a.msgs.filter(m => m.t === 's').length - n0) * 2;
    ok(rate > 45, `durum saniyede ~60 kez yayınlanıyor (${rate}/sn)`);
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

    console.log('Kilitler');
    a.msgs.length = 0;
    a.send({ t: 'lobby' });
    const lobby = await a.wait(m => m.t === 'room' && m.state === 'lobby');
    ok(lobby.done.includes('merhaba'), 'odada geçilen bölüm odanın listesine eklenir');
    a.msgs.length = 0;
    a.send({ t: 'start', level: 9 });
    ok(!!(await a.wait(m => m.t === 'error' && /kilitli/.test(m.msg))), 'kilitli bölüm başlatılamaz');
    const c = client('Cem'); await c.open;
    c.send({ t: 'join', name: 'Cem', code: roomA.code, done: ['zipzip', 'uydurma'] });
    const withC = await a.wait(m => m.t === 'room' && m.members.length === 3);
    ok(withC.done.includes('zipzip') && !withC.done.includes('uydurma'), 'katılanın geçtiği bölümler odaya eklenir (yalnızca gerçek bölümler)');
    a.send({ t: 'start', level: 9 });
    ok(!!(await a.wait(m => m.t === 'start' && m.level === 9)), 'odadan biri açtıysa bölüm herkes için açık');
    c.ws.close();
    await sleep(150);

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

    console.log('Paket kuyruğu');
    a.send({ t: 'lobby' });
    await a.wait(m => m.t === 'room' && m.state === 'lobby' && m.custom && m.custom.total === 1);
    const second = Object.assign({}, mine, { name: 'İkinci bölüm' });
    a.send({ t: 'custom', def: mine, queue: [mine, second], packName: 'Benim paketim' });
    const withQueue = await b.wait(m => m.t === 'room' && m.custom && m.custom.total === 2);
    ok(withQueue && withQueue.custom.packName === 'Benim paketim' && withQueue.custom.index === 0, 'paket kuyruğu odaya yüklendi');
    a.msgs.length = 0; b.msgs.length = 0;
    a.send({ t: 'start', custom: true });
    ok(!!(await b.wait(m => m.t === 'start' && m.def && m.def.name === 'Benim bölümüm')), 'paketin 1. bölümü başladı');

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
