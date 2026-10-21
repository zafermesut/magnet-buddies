'use strict';

// Online oda sunucusu: oyunun dosyalarını sunar ve WebSocket üzerinden odaları yönetir.
// Simülasyon (js/game.js) burada tarayıcıdakiyle aynı kodla çalışır; sunucu tek doğru kaynaktır.
// İstemciler yalnızca tuş durumunu gönderir, sunucu her 2 adımda bir durumu yayınlar.

const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const { WebSocketServer } = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const STEP = 1 / 60;
const MAX_MEMBERS = 4;

// Tarayıcı dosyaları global değişkenli düz script'ler; Node'da ortak bir bağlamda yüklenir
const sim = vm.createContext({ console, Math, Map, Set });
for (const f of ['config.js', 'levels.js', 'game.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sim, { filename: f });
}
const { Game, LEVELS, validateLevel } = vm.runInContext('({ Game, LEVELS, validateLevel })', sim);

// ---------- Statik dosyalar ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const PUBLIC = new Set(['index.html', 'css', 'js']);
const THREE_ROOT = path.join(ROOT, 'node_modules', 'three');
const THREE_PUBLIC = [path.join(THREE_ROOT, 'build'), path.join(THREE_ROOT, 'examples', 'jsm')];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') { res.writeHead(200); res.end('ok'); return; }
  if (url.pathname === '/info') {
    // localhost'tan açan kurucuya, aynı Wi-Fi'deki arkadaşlar için yerel ağ adresini söyler
    const lan = Object.values(os.networkInterfaces()).flat()
      .filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ lan, port: PORT }));
    return;
  }
  let rel;
  try { rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'; } catch (e) { rel = ''; }
  let file, cache = 'no-cache';
  if (rel.startsWith('vendor/three/')) {
    // Three.js: yalnızca node_modules/three içindeki tarayıcı dosyaları (build/ ve examples/jsm/)
    file = path.normalize(path.join(THREE_ROOT, rel.slice('vendor/three/'.length)));
    if (!THREE_PUBLIC.some(dir => file.startsWith(dir + path.sep))) { res.writeHead(404); res.end('Bulunamadı'); return; }
    cache = 'public, max-age=86400';
  } else {
    file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep) || !PUBLIC.has(rel.split('/')[0])) {
      res.writeHead(404); res.end('Bulunamadı'); return;
    }
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Bulunamadı'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  });
});

// ---------- Odalar ----------

const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // karışan harfler (I, O, 0, 1) yok
let nextId = 1;

function newCode() {
  let code;
  do code = Array.from({ length: 4 }, () => CODE_CHARS[Math.random() * CODE_CHARS.length | 0]).join('');
  while (rooms.has(code));
  return code;
}

const r1 = v => Math.round(v * 10) / 10;
const r3 = v => Math.round(v * 1000) / 1000;

class Room {
  constructor(code) {
    this.code = code;
    this.members = [];       // { id, name, ws, input }
    this.state = 'lobby';    // lobby | playing | complete
    this.level = 0;
    this.game = null;
    this.inGame = [];        // bölüme katılan üyeler (sırası oyuncu numarasıdır)
    this.custom = null;      // kurucunun editörde yaptığı bölüm (level -1)
    this.tick = 0;
    this.fxT = -1;
  }

  get host() { return this.members[0]; }

  send(m, msg) { if (m.ws.readyState === 1) m.ws.send(JSON.stringify(msg)); }
  broadcast(msg) { const s = JSON.stringify(msg); for (const m of this.members) if (m.ws.readyState === 1) m.ws.send(s); }

  sendRoom() {
    for (const m of this.members) {
      this.send(m, {
        t: 'room', code: this.code, state: this.state, level: this.level,
        host: this.host.id, you: m.id,
        custom: this.custom ? { name: this.custom.name, magnet: this.custom.magnet } : null,
        members: this.members.map(x => ({ id: x.id, name: x.name, playing: this.inGame.includes(x) })),
      });
    }
  }

  // level: hazır bölüm sırası; -1 kurucunun kendi bölümü
  start(level) {
    if (this.members.length < 2 || level >= LEVELS.length) return;
    if (level < 0 && (level !== -1 || !this.custom)) return;
    this.level = level;
    this.inGame = this.members.slice(0, MAX_MEMBERS);
    for (const m of this.inGame) m.input = { left: false, right: false, jump: false, action: false, swap: false };
    this.game = new Game(level === -1 ? this.custom : level, this.inGame.length);
    this.state = 'playing';
    this.fxT = -1;
    this.tick = 0;
    const players = this.inGame.map(m => ({ id: m.id, name: m.name }));
    const def = level === -1 ? this.custom : undefined;
    for (const m of this.members) this.send(m, { t: 'start', level, def, players, you: this.inGame.indexOf(m) });
    this.sendRoom();
  }

  toLobby() {
    this.state = 'lobby';
    this.game = null;
    this.inGame = [];
    this.sendRoom();
  }

  step() {
    if (this.state !== 'playing') return;
    const g = this.game;
    g.step(STEP, this.inGame.map(m => m.input));
    this.tick++;
    if (this.tick % 2 === 0 || g.done) this.broadcast(this.snapshot());
    if (g.done) {
      this.state = 'complete';
      this.broadcast({ t: 'complete', level: this.level, time: g.doneT });
    }
  }

  snapshot() {
    const g = this.game;
    const fx = g.effects.filter(e => e.t > this.fxT).map(e => ({ type: e.type, x: r1(e.x), y: r1(e.y), t: r3(e.t), color: e.color }));
    this.fxT = g.t;
    const keyIndex = new Map(g.keys.map((k, i) => [k, i]));
    const playerIndex = new Map(g.players.map((p, i) => [p, i]));
    return {
      t: 's',
      time: r3(g.t),
      p: g.players.map(p => [
        r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), p.pol, p.magnetOn ? 1 : 0, p.inExit ? 1 : 0,
        Math.round(p.squash * 100) / 100, p.facing,
        (p.affects || []).map(a => (playerIndex.has(a.o) ? ['p', playerIndex.get(a.o), a.repel ? 1 : 0] : ['k', keyIndex.get(a.o), 0])),
      ]),
      k: g.keys.map(k => [r1(k.x), r1(k.y), k.used ? 1 : 0, k.holder ? playerIndex.get(k.holder) : -1]),
      d: g.doors.map(d => [d.open ? 1 : 0, r3(d.openT)]),
      g: g.gates.map(x => (x.open ? 1 : 0)),
      b: g.buttons.map(x => (x.pressed ? 1 : 0)),
      x: g.boxes.map(b => [r1(b.x), r1(b.y), b.pushers]),
      fx,
    };
  }

  join(m) {
    this.members.push(m);
    this.sendRoom();
  }

  leave(m) {
    this.members = this.members.filter(x => x !== m);
    if (!this.members.length) { rooms.delete(this.code); return; }
    if (this.inGame.includes(m) && this.state !== 'lobby') {
      // Biri ayrılırsa kalanlarla bölüm baştan başlar; tek kişi kalırsa odaya dönülür
      if (this.members.length >= 2) this.start(this.level);
      else this.toLobby();
      return;
    }
    this.sendRoom();
  }

  message(m, msg) {
    switch (msg.t) {
      case 'i': {
        const b = msg.b | 0;
        m.input = { left: !!(b & 1), right: !!(b & 2), jump: !!(b & 4), action: !!(b & 8), swap: !!(b & 16) };
        break;
      }
      case 'start':
        if (m === this.host && this.state === 'lobby') this.start(msg.custom ? -1 : msg.level | 0);
        break;
      case 'custom': {
        // Kurucunun editörde yaptığı bölüm: yalnızca bilinen alanlar alınır ve doğrulanır
        if (m !== this.host || this.state !== 'lobby' || !msg.def) break;
        const d = msg.def;
        const def = {
          name: String(d.name || '').slice(0, 24).trim(),
          magnet: !!d.magnet,
          map: Array.isArray(d.map) ? d.map.slice(0, 20).map(r => String(r).slice(0, 48)) : [],
        };
        const errs = validateLevel(def);
        if (errs.length) { this.send(m, { t: 'error', msg: 'Bölüm geçersiz: ' + errs[0] }); break; }
        this.custom = def;
        this.sendRoom();
        break;
      }
      case 'restart':
        if (this.state !== 'lobby') this.start(this.level);
        break;
      case 'next':
        if (this.state === 'complete') {
          if (this.level >= 0 && this.level < LEVELS.length - 1) this.start(this.level + 1);
          else this.toLobby();
        }
        break;
      case 'lobby':
        if (this.state !== 'lobby') this.toLobby();
        break;
    }
  }
}

// ---------- WebSocket ----------

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8192 });

function cleanName(s) {
  const n = String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16);
  return n || 'İsimsiz';
}

wss.on('connection', ws => {
  const member = { id: nextId++, name: 'İsimsiz', ws, input: {} };
  let room = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', data => {
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (!room) {
      if (msg.t === 'create') {
        member.name = cleanName(msg.name);
        room = new Room(newCode());
        rooms.set(room.code, room);
        room.join(member);
      } else if (msg.t === 'join') {
        member.name = cleanName(msg.name);
        const r = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!r) { ws.send(JSON.stringify({ t: 'error', msg: 'Böyle bir oda yok. Kodu kontrol et.' })); return; }
        if (r.members.length >= MAX_MEMBERS) { ws.send(JSON.stringify({ t: 'error', msg: 'Oda dolu (en fazla 4 kişi).' })); return; }
        room = r;
        room.join(member);
      }
      return;
    }
    room.message(member, msg);
  });

  ws.on('close', () => { if (room) room.leave(member); });
});

// Kopan bağlantıları temizle
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

// Sabit adımlı oyun döngüsü
let last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (acc >= STEP) {
    for (const r of rooms.values()) r.step();
    acc -= STEP;
  }
}, 1000 / 60);

server.listen(PORT, () => {
  console.log(`Sunucu hazır: http://localhost:${PORT}`);
});

module.exports = { server, rooms };
