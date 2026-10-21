// Atölye API testleri: node test/atolye.test.js
// Sunucuyu geçici bir veri klasörüyle ve yalnızca testte açık sahte girişle (DEV_LOGIN=1) başlatır.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3996, BASE = `http://localhost:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-test-'));
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer() {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, PORT, DATA_DIR: DATA, DEV_LOGIN: '1', ENV_FILE: '/nonexistent' },
  });
  return new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('hazır')) r(srv); }));
}

// Çerezleri hatırlayan küçük bir istemci
function client() {
  let cookie = '';
  const req = async (method, p, body, headers = {}) => {
    const r = await fetch(BASE + p, {
      method, redirect: 'manual',
      headers: Object.assign({ cookie, origin: BASE }, body !== undefined ? { 'content-type': 'application/json' } : {}, headers),
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const c of set) {
      const [kv] = c.split(';');
      const name = kv.split('=')[0];
      cookie = cookie.split('; ').filter(x => x && !x.startsWith(name + '=')).concat(kv.endsWith('=') ? [] : [kv]).join('; ');
    }
    let json = null;
    try { json = await r.json(); } catch (e) { /* boş */ }
    return { status: r.status, json };
  };
  return {
    get: p => req('GET', p),
    post: (p, b = {}, h) => req('POST', p, b, h),
    put: (p, b) => req('PUT', p, b),
    del: p => req('DELETE', p, {}),
    login: name => req('POST', '/auth/dev', { name }),
  };
}

const MAP = ['##########', '#........#', '#........#', '#........#', '#........#', '#.S....E.#', '##########'];
const level = (extra = {}) => Object.assign({ name: 'Deneme', magnet: false, map: MAP, visibility: 'private' }, extra);

(async () => {
  let srv = await startServer();
  try {
    const anon = client(), a = client(), b = client(), c = client(), d = client();

    console.log('Giriş');
    let r = await anon.get('/api/me');
    ok(r.status === 200 && r.json.user === null && r.json.loginEnabled, 'girişsiz: kullanıcı yok, giriş açık');
    ok((await anon.post('/api/levels', level())).status === 401, 'girişsiz bölüm kaydedilemez');
    await a.login('Ayşe');
    r = await a.get('/api/me');
    ok(r.json.user && r.json.user.name === 'Ayşe', 'giriş yapınca kullanıcı görünür');
    ok((await a.post('/api/me', { name: 'orospu çocuğu' })).status === 400, 'uygunsuz ad reddedilir');
    ok((await a.post('/api/me', { name: 'Ayşe K.' })).json.user.name === 'Ayşe K.', 'ad değiştirilebilir');

    console.log('Güvenlik');
    ok((await a.post('/api/levels', level(), { origin: 'https://kotu.site' })).status === 403, 'başka siteden gelen istek reddedilir');
    ok((await a.post('/api/levels', 'name=x', { 'content-type': 'text/plain' })).status === 415, 'JSON olmayan istek reddedilir');
    ok((await a.post('/api/levels', level({ map: MAP.map(row => row.replace('E', '.')) }))).status === 400, 'geçersiz bölüm (çıkış yok) reddedilir');
    ok((await a.post('/api/levels', level({ name: 'amk' }))).status === 400, 'uygunsuz bölüm adı reddedilir');
    r = await a.post('/api/levels', 'x'.repeat(40000));
    ok(r.status === 413, 'çok büyük istek reddedilir');

    console.log('Bölümler ve görünürlük');
    r = await a.post('/api/levels', level({ name: 'Gizli oda' }));
    ok(r.status === 201 && r.json.id && r.json.mine, 'bölüm kaydedildi (gizli)');
    const id = r.json.id;
    ok((await anon.get(`/api/levels/${id}`)).status === 404, 'gizli bölümü başkası göremez');
    ok((await a.get(`/api/levels/${id}`)).status === 200, 'sahibi gizli bölümünü görür');
    ok((await b.login('Bora')).status === 200 && (await b.put(`/api/levels/${id}`, level({ name: 'Ele geçirdim' }))).status === 404, 'başkası gizli bölümü değiştiremez');
    await a.put(`/api/levels/${id}`, level({ name: 'Gizli oda', visibility: 'link' }));
    ok((await anon.get(`/api/levels/${id}`)).status === 200, 'linkle paylaşılan bölümü herkes açar');
    ok(!(await anon.get('/api/levels')).json.items.some(l => l.id === id), 'linkle paylaşılan bölüm listede görünmez');
    ok((await b.put(`/api/levels/${id}`, level({ name: 'Ele geçirdim', visibility: 'public' }))).status === 403, 'başkası linkli bölümü değiştiremez');
    await a.put(`/api/levels/${id}`, level({ name: 'Herkesin odası', visibility: 'public', magnet: true }));
    r = await anon.get('/api/levels');
    ok(r.json.items.some(l => l.id === id && l.name === 'Herkesin odası' && l.magnet && l.map.length === 7), 'herkese açık bölüm Atölye listesinde, haritasıyla');
    ok((await anon.get('/api/levels?q=herkes')).json.items.length === 1 && (await anon.get('/api/levels?q=yokboyle')).json.items.length === 0, 'arama çalışır');
    ok((await a.get('/api/levels/mine')).json.items.length === 1 && (await b.get('/api/levels/mine')).json.items.length === 0, '"Bölümlerim" yalnızca kendi bölümlerini gösterir');

    console.log('Beğeni ve oynanma');
    ok((await anon.post(`/api/levels/${id}/like`)).status === 401, 'girişsiz beğenilemez');
    r = await b.post(`/api/levels/${id}/like`);
    ok(r.json.liked && r.json.likes === 1, 'beğeni eklendi');
    r = await b.post(`/api/levels/${id}/like`);
    ok(!r.json.liked && r.json.likes === 0, 'tekrar basınca beğeni geri alındı');
    await b.post(`/api/levels/${id}/like`);
    await anon.post(`/api/levels/${id}/play`);
    r = await anon.post(`/api/levels/${id}/play`);
    ok(r.json.plays === 1, 'aynı yerden art arda oynanma bir kez sayılır');
    const id2 = (await b.post('/api/levels', level({ name: 'İkinci', visibility: 'public' }))).json.id;
    r = await anon.get('/api/levels?sort=popular');
    ok(r.json.items[0].id === id, 'popüler sıralamada beğenilen bölüm önde');
    r = await anon.get('/api/levels?sort=new');
    ok(r.json.items[0].id === id2, 'yeni sıralamada son eklenen önde');

    console.log('Bildirme');
    await c.login('Cem'); await d.login('Deniz');
    for (const u of [b, c]) await u.post(`/api/levels/${id2}/report`);
    ok((await anon.get('/api/levels')).json.items.some(l => l.id === id2), 'iki bildirimle hâlâ listede');
    await d.post(`/api/levels/${id2}/report`);
    ok(!(await anon.get('/api/levels')).json.items.some(l => l.id === id2), 'üç farklı kişi bildirince listeden kalkar');
    ok((await anon.get(`/api/levels/${id2}`)).status === 200, 'bildirilen bölüm linkle hâlâ açılır');

    console.log('Paketler');
    const id3 = (await a.post('/api/levels', level({ name: 'Paket iki' }))).json.id;
    ok((await b.post('/api/packs', { name: 'Hırsız', levelIds: [id], visibility: 'public' })).status === 400, 'başkasının bölümü pakete eklenemez');
    r = await a.post('/api/packs', { name: 'Ayşe\'nin alanı', about: 'Kısa bir macera', levelIds: [id, id3], visibility: 'public' });
    ok(r.status === 201 && r.json.levels.length === 2, 'paket oluşturuldu');
    const pid = r.json.id;
    r = await anon.get(`/api/packs/${pid}`);
    ok(r.status === 200 && r.json.levels.length === 2 && r.json.levels[1].map, 'paket, gizli bölümleri dahil sırasıyla oynanabilir');
    ok((await anon.get('/api/packs')).json.items.some(pk => pk.id === pid && pk.count === 2 && pk.cover), 'paket Atölye listesinde, kapak haritasıyla');
    await a.del(`/api/levels/${id3}`);
    ok((await anon.get(`/api/packs/${pid}`)).json.levels.length === 1, 'silinen bölüm paketten de düşer');
    ok((await b.del(`/api/packs/${pid}`)).status === 403, 'başkası paketi silemez');

    console.log('İlerleme');
    ok((await anon.post('/api/progress', { levels: { kule: 10 } })).status === 401, 'girişsiz ilerleme kaydedilmez');
    r = await c.post('/api/progress', { levels: { kule: 12.345, yokboyle: 5, merhaba: 0.2, salter: 'x' } });
    ok(r.status === 200 && r.json.levels.kule === 12.35 && Object.keys(r.json.levels).length === 1, 'yalnızca gerçek bölümlerin geçerli süreleri kaydedilir');
    r = await c.post('/api/progress', { levels: { kule: 20, merhaba: 8 } });
    ok(r.json.levels.kule === 12.35 && r.json.levels.merhaba === 8, 'birleştirmede her bölüm için en iyi süre kalır');
    ok((await d.get('/api/progress')).json.levels.kule === undefined, 'ilerleme hesaba özel');
    await c.post('/api/progress', { screws: { kule: 1, yokboyle: 7, merhaba: 9 } });
    r = await c.post('/api/progress', { screws: { kule: 4 } });
    ok(r.json.screws.kule === 5 && r.json.screws.merhaba === undefined && r.json.screws.yokboyle === undefined, 'vidalar birikerek birleşir, geçersizler alınmaz');

    console.log('Kalıcılık');
    await sleep(400);
    srv.kill();
    await sleep(200);
    srv = await startServer();
    r = await anon.get(`/api/levels/${id}`);
    ok(r.status === 200 && r.json.likes === 1 && r.json.plays === 1, 'sunucu yeniden başlayınca bölüm, beğeni ve oynanma duruyor');
    ok((await a.get('/api/me')).json.user.name === 'Ayşe K.', 'oturum yeniden başlatmadan sonra da geçerli');
    await a.post('/auth/logout');
    ok((await a.get('/api/me')).json.user === null, 'çıkış yapınca oturum kapanır');
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
  }
  console.log(failed ? '\n' + failed + ' test başarısız' : '\nTüm testler geçti');
  process.exit(failed ? 1 : 0);
})();
