'use strict';

// Atölye: oyuncuların bölümleri ve paketleri, Google ile giriş.
// Oynamak hesapsızdır; kaydetmek, yayınlamak, beğenmek ve bildirmek için giriş gerekir.
// Şifre saklanmaz: Google'dan yalnızca kimlik numarası, ad ve profil resmi alınır.

const crypto = require('crypto');
const { Store } = require('./store');

const SESSION_DAYS = 90;
const LIMITS = { levelsPerUser: 200, packsPerUser: 50, packSize: 30, title: 24, displayName: 20, about: 140, body: 32 * 1024 };
const PAGE = 24;
const VISIBILITY = ['private', 'link', 'public'];

// Kötü söz filtresi (ad ve başlıklar için). Kısa kelimeler tam kelime olarak, uzunlar parça olarak aranır.
const BAD_WORDS = ['amk', 'aq', 'oc', 'orospu', 'sikis', 'sikik', 'sikerim', 'yarrak', 'yarak', 'pezevenk', 'kahpe', 'gavat',
  'gotveren', 'ibne', 'puşt', 'fuck', 'shit', 'bitch', 'cunt', 'nigger', 'whore', 'dick'];
const fold = s => s.toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u')
  .replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[^a-z0-9]+/g, ' ');
function isClean(text) {
  const t = ` ${fold(text)} `, squashed = t.replace(/ /g, '');
  return !BAD_WORDS.some(w => {
    const f = fold(w).trim();
    return f.length <= 4 ? t.includes(` ${f} `) : squashed.includes(f);
  });
}

const cleanText = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

function createAtolye({ dataDir, validateLevel, publicUrl, google, devLogin }) {
  const store = new Store(dataDir);
  const D = store.data;
  const secure = publicUrl.startsWith('https://');
  const loginEnabled = !!(google && google.clientId && google.clientSecret) || !!devLogin;

  // ---------- Yardımcılar ----------

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
    res.end(JSON.stringify(body));
  };
  const fail = (res, status, msg) => send(res, status, { error: msg });

  const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent)).filter(p => p[0]));
  const cookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

  // Büyük istekte bağlantı koparılmaz; geri kalanı okunup atılır ve düzgün bir 413 dönülür
  const readJson = req => new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > LIMITS.body) { req.resume(); return reject(new Error('too-big')); }
    let size = 0, body = '', tooBig = false;
    req.on('data', d => { size += d.length; if (size > LIMITS.body) tooBig = true; else body += d; });
    req.on('end', () => {
      if (tooBig) return reject(new Error('too-big'));
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(new Error('bad-json')); }
    });
    req.on('error', reject);
  });

  // Basit hız sınırı: anahtar başına pencere içinde en fazla n istek
  const buckets = new Map();
  const allow = (key, n, windowMs) => {
    const now = Date.now(), b = buckets.get(key);
    if (!b || b.reset < now) { buckets.set(key, { count: 1, reset: now + windowMs }); return true; }
    return ++b.count <= n;
  };
  setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60000).unref();

  const clientIp = req => String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  function userOf(req) {
    const tok = cookies(req).mb_session;
    if (!tok) return null;
    const s = D.sessions[Store.hash(tok)];
    if (!s || s.expires < Date.now()) return null;
    return D.users[s.userId] || null;
  }

  function startSession(res, user, extraHeaders = {}) {
    const tok = crypto.randomBytes(32).toString('hex');
    D.sessions[Store.hash(tok)] = { userId: user.id, expires: Date.now() + SESSION_DAYS * 86400e3 };
    store.save();
    return Object.assign({ 'Set-Cookie': cookie('mb_session', tok, SESSION_DAYS * 86400) }, extraHeaders);
  }

  function findOrCreateUser(provider, sub, name, avatar) {
    const key = `${provider}:${sub}`;
    let user = Object.values(D.users).find(u => u.key === key);
    if (!user) {
      let display = cleanText(name, LIMITS.displayName);
      if (!display || !isClean(display)) display = 'Oyuncu';
      user = { id: Store.id(10), key, name: display, avatar: avatar || null, createdAt: Date.now() };
      D.users[user.id] = user;
    } else if (avatar) {
      user.avatar = avatar;
    }
    store.save();
    return user;
  }

  // Yalnızca site içi göreli adreslere geri dön (açık yönlendirme olmasın)
  const safeNext = n => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.includes('\\') ? n : '/');

  // ---------- Görünümler ----------

  const author = id => { const u = D.users[id]; return u ? { id: u.id, name: u.name, avatar: u.avatar } : { id, name: 'Silinmiş oyuncu', avatar: null }; };
  const likedBy = (key, user) => !!(user && D.likes[key] && D.likes[key][user.id]);

  const levelView = (l, user, full = true) => Object.assign({
    id: l.id, name: l.name, magnet: l.magnet, visibility: l.visibility, likes: l.likes, plays: l.plays,
    createdAt: l.createdAt, updatedAt: l.updatedAt, author: author(l.ownerId),
    liked: likedBy(l.id, user), mine: !!(user && user.id === l.ownerId), hidden: !!l.hidden,
  }, full ? { map: l.map } : {});

  const packLevels = p => p.levelIds.map(id => D.levels[id]).filter(Boolean);
  const packView = (p, user, withLevels) => Object.assign({
    id: p.id, name: p.name, about: p.about, visibility: p.visibility, likes: p.likes, plays: p.plays,
    createdAt: p.createdAt, updatedAt: p.updatedAt, author: author(p.ownerId), count: packLevels(p).length,
    cover: (packLevels(p)[0] || {}).map || null, liked: likedBy('p:' + p.id, user), mine: !!(user && user.id === p.ownerId),
  }, withLevels ? { levels: packLevels(p).map(l => levelView(l, user)) } : {});

  const canSee = (item, user) => item.visibility !== 'private' || (user && user.id === item.ownerId);

  function listing(items, url, user, view) {
    const sort = url.searchParams.get('sort') === 'popular' ? 'popular' : 'new';
    const q = fold(cleanText(url.searchParams.get('q'), 40)).trim();
    const offset = Math.max(0, parseInt(url.searchParams.get('offset'), 10) || 0);
    let list = items.filter(i => i.visibility === 'public' && !i.hidden);
    if (q) list = list.filter(i => fold(i.name).includes(q) || fold(author(i.ownerId).name).includes(q));
    list.sort(sort === 'popular'
      ? (a, b) => (b.likes * 3 + b.plays) - (a.likes * 3 + a.plays) || b.createdAt - a.createdAt
      : (a, b) => b.createdAt - a.createdAt);
    return { items: list.slice(offset, offset + PAGE).map(i => view(i, user)), total: list.length };
  }

  // ---------- Doğrulama ----------

  function checkLevel(body) {
    const def = {
      name: cleanText(body.name, LIMITS.title),
      magnet: !!body.magnet,
      map: Array.isArray(body.map) ? body.map.slice(0, 20).map(r => String(r).slice(0, 48)) : [],
    };
    const errs = validateLevel(def);
    if (errs.length) return { error: errs[0] };
    if (!isClean(def.name)) return { error: 'Bölüm adında uygunsuz bir kelime var.' };
    const visibility = VISIBILITY.includes(body.visibility) ? body.visibility : 'private';
    return { def, visibility };
  }

  function checkPack(body, user) {
    const name = cleanText(body.name, LIMITS.title);
    const about = cleanText(body.about, LIMITS.about);
    if (!name) return { error: 'Pakete bir ad ver.' };
    if (!isClean(name) || !isClean(about)) return { error: 'Pakette uygunsuz bir kelime var.' };
    const ids = Array.isArray(body.levelIds) ? [...new Set(body.levelIds.map(String))] : [];
    if (!ids.length || ids.length > LIMITS.packSize) return { error: `Pakette 1–${LIMITS.packSize} bölüm olmalı.` };
    if (ids.some(id => !D.levels[id] || D.levels[id].ownerId !== user.id)) return { error: 'Pakete yalnızca kendi bölümlerini ekleyebilirsin.' };
    const visibility = VISIBILITY.includes(body.visibility) ? body.visibility : 'private';
    return { name, about, levelIds: ids, visibility };
  }

  // ---------- Yönlendirme ----------

  async function route(req, res, url) {
    const p = url.pathname, m = req.method;
    const user = userOf(req);

    // Durum değiştiren istekler: yalnızca bu siteden ve JSON olarak (başka sitelerden sahte istek gönderilemesin)
    if (m !== 'GET') {
      const origin = req.headers.origin;
      if (origin && origin !== publicUrl && origin !== `${secure ? 'https' : 'http'}://${req.headers.host}`) return fail(res, 403, 'İzin yok.');
      if (p.startsWith('/api/') && !String(req.headers['content-type'] || '').startsWith('application/json')) return fail(res, 415, 'JSON bekleniyor.');
      if (!allow('w:' + clientIp(req), 120, 60e3)) return fail(res, 429, 'Biraz yavaş: çok fazla istek.');
    }

    // ----- Giriş -----
    if (p === '/auth/google' && m === 'GET') {
      if (!google || !google.clientId) return fail(res, 404, 'Google girişi bu sunucuda kapalı.');
      const state = crypto.randomBytes(16).toString('hex');
      const next = safeNext(url.searchParams.get('next'));
      const q = new URLSearchParams({
        client_id: google.clientId, redirect_uri: `${publicUrl}/auth/google/callback`,
        response_type: 'code', scope: 'openid profile', state, prompt: 'select_account',
      });
      res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, 'Set-Cookie': cookie('mb_oauth', `${state}|${next}`, 600) });
      return res.end();
    }
    if (p === '/auth/google/callback' && m === 'GET') {
      const [state, next] = String(cookies(req).mb_oauth || '').split('|');
      if (!state || state !== url.searchParams.get('state') || !url.searchParams.get('code')) return fail(res, 400, 'Giriş doğrulanamadı, tekrar dene.');
      try {
        const r = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code: url.searchParams.get('code'), client_id: google.clientId, client_secret: google.clientSecret,
            redirect_uri: `${publicUrl}/auth/google/callback`, grant_type: 'authorization_code',
          }),
        });
        const tok = await r.json();
        if (!tok.id_token) throw new Error('kimlik yok');
        // Kimlik doğrudan Google'ın sunucusundan HTTPS ile alındığı için imza ayrıca doğrulanmaz; alanlar kontrol edilir.
        const claims = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString('utf8'));
        if (claims.aud !== google.clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || claims.exp * 1000 < Date.now()) {
          throw new Error('kimlik geçersiz');
        }
        const u = findOrCreateUser('google', claims.sub, claims.given_name || claims.name, claims.picture);
        const session = startSession(res, u)['Set-Cookie'];
        res.writeHead(302, { Location: safeNext(next), 'Set-Cookie': [session, cookie('mb_oauth', '', 0)] });
        return res.end();
      } catch (e) {
        console.warn('Google girişi başarısız:', e.message);
        return fail(res, 502, 'Google girişi tamamlanamadı, tekrar dene.');
      }
    }
    if (p === '/auth/dev' && m === 'POST') {
      // Yalnızca testlerde ve yerel geliştirmede açık (DEV_LOGIN=1); canlıda yoktur
      if (!devLogin) return fail(res, 404, 'Yok.');
      const body = await readJson(req);
      const u = findOrCreateUser('dev', cleanText(body.name, 20) || 'test', body.name, null);
      return send(res, 200, { user: { id: u.id, name: u.name } }, startSession(res, u));
    }
    if (p === '/auth/logout' && m === 'POST') {
      const tok = cookies(req).mb_session;
      if (tok) { delete D.sessions[Store.hash(tok)]; store.save(); }
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('mb_session', '', 0) });
    }

    // ----- Hesap -----
    if (p === '/api/me' && m === 'GET') {
      let stats = null;
      if (user) {
        const mine = Object.values(D.levels).filter(l => l.ownerId === user.id);
        const packs = Object.values(D.packs).filter(pk => pk.ownerId === user.id);
        stats = { levels: mine.length, packs: packs.length, likes: mine.concat(packs).reduce((n, i) => n + i.likes, 0), plays: mine.reduce((n, l) => n + l.plays, 0) };
      }
      return send(res, 200, { user: user && { id: user.id, name: user.name, avatar: user.avatar }, stats, loginEnabled, google: !!(google && google.clientId) });
    }
    if (p === '/api/me' && m === 'POST') {
      if (!user) return fail(res, 401, 'Önce giriş yap.');
      const body = await readJson(req);
      const name = cleanText(body.name, LIMITS.displayName);
      if (name.length < 2) return fail(res, 400, 'Ad en az 2 harf olmalı.');
      if (!isClean(name)) return fail(res, 400, 'Bu ad kullanılamaz.');
      user.name = name;
      store.save();
      return send(res, 200, { user: { id: user.id, name: user.name, avatar: user.avatar } });
    }

    // ----- Bölümler -----
    const levelList = () => Object.values(D.levels);
    if (p === '/api/levels' && m === 'GET') return send(res, 200, listing(levelList(), url, user, (l, u) => levelView(l, u)));
    if (p === '/api/levels/mine' && m === 'GET') {
      if (!user) return fail(res, 401, 'Önce giriş yap.');
      return send(res, 200, { items: levelList().filter(l => l.ownerId === user.id).sort((a, b) => b.updatedAt - a.updatedAt).map(l => levelView(l, user)) });
    }
    if (p === '/api/levels' && m === 'POST') {
      if (!user) return fail(res, 401, 'Bölüm kaydetmek için giriş yap.');
      if (!allow('lv:' + user.id, 30, 3600e3)) return fail(res, 429, 'Bir saatte çok fazla bölüm kaydettin, biraz sonra dene.');
      if (levelList().filter(l => l.ownerId === user.id).length >= LIMITS.levelsPerUser) return fail(res, 400, `En fazla ${LIMITS.levelsPerUser} bölüm kaydedebilirsin.`);
      const c = checkLevel(await readJson(req));
      if (c.error) return fail(res, 400, c.error);
      const now = Date.now();
      const l = Object.assign({ id: Store.id(), ownerId: user.id, visibility: c.visibility, likes: 0, plays: 0, createdAt: now, updatedAt: now, hidden: false }, c.def);
      D.levels[l.id] = l;
      store.save();
      return send(res, 201, levelView(l, user));
    }

    let mm = p.match(/^\/api\/levels\/([A-Za-z0-9]{6,12})(\/(like|play|report))?$/);
    if (mm) {
      const l = D.levels[mm[1]], action = mm[3];
      if (!l || !canSee(l, user)) return fail(res, 404, 'Bölüm bulunamadı.');
      if (!action && m === 'GET') return send(res, 200, levelView(l, user));
      if (!action && m === 'PUT') {
        if (!user || user.id !== l.ownerId) return fail(res, 403, 'Bu bölüm senin değil.');
        const c = checkLevel(await readJson(req));
        if (c.error) return fail(res, 400, c.error);
        Object.assign(l, c.def, { visibility: c.visibility, updatedAt: Date.now() });
        store.save();
        return send(res, 200, levelView(l, user));
      }
      if (!action && m === 'DELETE') {
        if (!user || user.id !== l.ownerId) return fail(res, 403, 'Bu bölüm senin değil.');
        delete D.levels[l.id];
        delete D.likes[l.id];
        delete D.reports[l.id];
        for (const pk of Object.values(D.packs)) pk.levelIds = pk.levelIds.filter(id => id !== l.id);
        store.save();
        return send(res, 200, { ok: true });
      }
      if (action === 'like' && m === 'POST') {
        if (!user) return fail(res, 401, 'Beğenmek için giriş yap.');
        const set = D.likes[l.id] = D.likes[l.id] || {};
        if (set[user.id]) delete set[user.id]; else set[user.id] = Date.now();
        l.likes = Object.keys(set).length;
        store.save();
        return send(res, 200, { liked: !!set[user.id], likes: l.likes });
      }
      if (action === 'play' && m === 'POST') {
        // Aynı yerden aynı bölüm 10 dakikada bir sayılır
        if (allow(`pl:${clientIp(req)}:${l.id}`, 1, 600e3)) { l.plays++; store.save(); }
        return send(res, 200, { plays: l.plays });
      }
      if (action === 'report' && m === 'POST') {
        if (!user) return fail(res, 401, 'Bildirmek için giriş yap.');
        const set = D.reports[l.id] = D.reports[l.id] || {};
        set[user.id] = Date.now();
        // Üç farklı kişi bildirirse herkese açık listeden kalkar (link ile hâlâ açılır, sahibi görür)
        if (Object.keys(set).length >= 3) l.hidden = true;
        store.save();
        return send(res, 200, { ok: true });
      }
      return fail(res, 405, 'Desteklenmiyor.');
    }

    // ----- Paketler -----
    const packList = () => Object.values(D.packs);
    if (p === '/api/packs' && m === 'GET') return send(res, 200, listing(packList(), url, user, (pk, u) => packView(pk, u, false)));
    if (p === '/api/packs/mine' && m === 'GET') {
      if (!user) return fail(res, 401, 'Önce giriş yap.');
      return send(res, 200, { items: packList().filter(pk => pk.ownerId === user.id).sort((a, b) => b.updatedAt - a.updatedAt).map(pk => packView(pk, user, false)) });
    }
    if (p === '/api/packs' && m === 'POST') {
      if (!user) return fail(res, 401, 'Paket oluşturmak için giriş yap.');
      if (packList().filter(pk => pk.ownerId === user.id).length >= LIMITS.packsPerUser) return fail(res, 400, `En fazla ${LIMITS.packsPerUser} paket oluşturabilirsin.`);
      const c = checkPack(await readJson(req), user);
      if (c.error) return fail(res, 400, c.error);
      const now = Date.now();
      const pk = Object.assign({ id: Store.id(), ownerId: user.id, likes: 0, plays: 0, createdAt: now, updatedAt: now, hidden: false }, c);
      D.packs[pk.id] = pk;
      store.save();
      return send(res, 201, packView(pk, user, true));
    }
    mm = p.match(/^\/api\/packs\/([A-Za-z0-9]{6,12})(\/(like|play|report))?$/);
    if (mm) {
      const pk = D.packs[mm[1]], action = mm[3];
      if (!pk || !canSee(pk, user)) return fail(res, 404, 'Paket bulunamadı.');
      if (!action && m === 'GET') return send(res, 200, packView(pk, user, true));
      if (!action && (m === 'PUT' || m === 'DELETE') && (!user || user.id !== pk.ownerId)) return fail(res, 403, 'Bu paket senin değil.');
      if (!action && m === 'PUT') {
        const c = checkPack(await readJson(req), user);
        if (c.error) return fail(res, 400, c.error);
        Object.assign(pk, c, { updatedAt: Date.now() });
        store.save();
        return send(res, 200, packView(pk, user, true));
      }
      if (!action && m === 'DELETE') {
        delete D.packs[pk.id];
        delete D.likes['p:' + pk.id];
        store.save();
        return send(res, 200, { ok: true });
      }
      if (action === 'like' && m === 'POST') {
        if (!user) return fail(res, 401, 'Beğenmek için giriş yap.');
        const set = D.likes['p:' + pk.id] = D.likes['p:' + pk.id] || {};
        if (set[user.id]) delete set[user.id]; else set[user.id] = Date.now();
        pk.likes = Object.keys(set).length;
        store.save();
        return send(res, 200, { liked: !!set[user.id], likes: pk.likes });
      }
      if (action === 'play' && m === 'POST') {
        if (allow(`pp:${clientIp(req)}:${pk.id}`, 1, 600e3)) { pk.plays++; store.save(); }
        return send(res, 200, { plays: pk.plays });
      }
      if (action === 'report' && m === 'POST') {
        if (!user) return fail(res, 401, 'Bildirmek için giriş yap.');
        const set = D.reports['p:' + pk.id] = D.reports['p:' + pk.id] || {};
        set[user.id] = Date.now();
        if (Object.keys(set).length >= 3) pk.hidden = true;
        store.save();
        return send(res, 200, { ok: true });
      }
      return fail(res, 405, 'Desteklenmiyor.');
    }

    return fail(res, 404, 'Bulunamadı.');
  }

  // Sunucunun istek işleyicisinden çağrılır: /api ve /auth adreslerini üstlenir
  function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/auth/')) return false;
    route(req, res, url).catch(e => {
      if (e.message === 'too-big') return fail(res, 413, 'İstek çok büyük.');
      if (e.message === 'bad-json') return fail(res, 400, 'Geçersiz istek.');
      console.error('Atölye hatası:', e);
      if (!res.headersSent) fail(res, 500, 'Sunucuda bir hata oldu.');
    });
    return true;
  }

  return { handle, store };
}

module.exports = { createAtolye, isClean };
