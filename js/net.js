'use strict';

// Online bağlantı: sunucuya tuş durumunu gönderir, gelen durumu yerel Game nesnesine uygular.
// Sunucu tek doğru kaynaktır. Kendi top predict.js ile tahmin edilir, diğer her şey yumuşatarak çizilir.
// Deneme için yapay gecikme: adrese ?lag=150 eklenirse gidiş-dönüşe 150 ms eklenir.

const Net = {
  ws: null,
  handlers: {},
  lastBits: -1,
  rtt: null,         // son ölçülen gidiş-dönüş süresi (ms)
  pingT: 0,
  seq: 0,            // gönderilen son tuş durumunun sırası
  lag: 0,

  available() { return location.protocol === 'http:' || location.protocol === 'https:'; },

  connect() {
    this.close();
    try { this.lag = Math.max(0, Math.min(2000, +new URLSearchParams(location.search).get('lag') || 0)); } catch (e) { this.lag = 0; }
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      let opened = false;
      ws.onopen = () => { opened = true; resolve(); };
      ws.onerror = () => { if (!opened) reject(new Error('bağlanamadı')); };
      ws.onclose = () => { if (this.ws === ws) { this.ws = null; if (opened && this.handlers.close) this.handlers.close(); } };
      ws.onmessage = e => {
        if (this.lag) { const d = e.data; setTimeout(() => this.receive(ws, d), this.lag / 2); return; }
        this.receive(ws, e.data);
      };
      this.ws = ws;
      this.lastBits = -1;
      this.rtt = null;
    });
  },

  receive(ws, data) {
    if (ws !== this.ws) return;
    let m;
    try { m = JSON.parse(data); } catch (err) { return; }
    if (m.t === 'pong') { this.pong(m); return; }
    const h = this.handlers[m.t];
    if (h) h(m);
  },

  close() {
    if (this.ws) { const ws = this.ws; this.ws = null; ws.close(); }
  },

  on(type, fn) { this.handlers[type] = fn; },

  send(msg) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    const s = JSON.stringify(msg);
    if (this.lag) setTimeout(() => { if (ws.readyState === 1) ws.send(s); }, this.lag / 2);
    else ws.send(s);
  },

  // Saniyede bir ping; yanıt gelince rtt güncellenir (hafif ortalama)
  ping(now) {
    if (now - this.pingT < 1000) return;
    this.pingT = now;
    this.send({ t: 'ping', c: performance.now() });
  },

  pong(m) {
    const ms = performance.now() - m.c;
    if (ms < 0 || ms > 10000) return;
    this.rtt = this.rtt === null ? ms : this.rtt * 0.7 + ms * 0.3;
  },

  // Yalnızca değişince gönderilir
  sendInput(i) {
    const b = (i.left ? 1 : 0) | (i.right ? 2 : 0) | (i.jump ? 4 : 0) | (i.action ? 8 : 0) | (i.swap ? 16 : 0);
    if (b !== this.lastBits) { this.lastBits = b; this.send({ t: 'i', b, s: ++this.seq }); }
  },
};

// Sunucudan gelen durumu yerel oyuna uygula. Konumlar hedef olarak tutulur, smoothNet ile yaklaşılır.
// ndx / ndy: son iki durumdan tahmin edilen hız (px/sn); tahmin edilen top üstünde durduğu şeyle taşınsın diye.
function setTarget(o, x, y, gap) {
  if (gap > 0 && o.tx !== undefined) { o.ndx = (x - o.tx) / gap; o.ndy = (y - o.ty) / gap; }
  if (o.tx === undefined || Math.hypot(x - o.x, y - o.y) > 120) { o.x = x; o.y = y; }   // ışınlanma: atla
  o.tx = x;
  o.ty = y;
}

function applySnapshot(g, s) {
  const gap = s.time - g.t;
  g.t = s.time;
  let mine = null;
  s.p.forEach((a, i) => {
    const p = g.players[i];
    if (!p) return;
    p.magnetOn = !!a[5]; p.inExit = !!a[6];
    p.affects = a[9].map(([kind, idx, repel]) => ({ o: kind === 'p' ? g.players[idx] : kind === 'b' ? g.boxes[idx] : g.keys[idx], repel: !!repel })).filter(x => x.o);
    if (p === Predict.me && Predict.active && !p.inExit) {
      mine = { sv: { x: a[0], y: a[1], vx: a[2], vy: a[3], pol: a[4], magT: a[10] || 0, gripT: a[11] || 0, inExit: false }, ack: (s.a && s.a[i]) || [0, 0] };
      return;
    }
    setTarget(p, a[0], a[1], gap);
    p.vx = a[2]; p.vy = a[3]; p.pol = a[4];
    p.ndx = a[2]; p.ndy = a[3];
    p.squash = a[7]; p.facing = a[8];
    if (p === Predict.me) Predict.reconcile(g, { x: a[0], y: a[1], vx: a[2], vy: a[3], pol: a[4], magT: 0, gripT: 0, inExit: p.inExit }, [0, 0]);
  });
  s.k.forEach((a, i) => {
    const k = g.keys[i];
    setTarget(k, a[0], a[1]);
    k.used = !!a[2];
    k.holder = a[3] >= 0 ? g.players[a[3]] : null;
  });
  s.d.forEach((a, i) => { g.doors[i].open = !!a[0]; g.doors[i].openT = a[1]; });
  s.g.forEach((o, i) => { g.gates[i].open = !!o; });
  s.b.forEach((o, i) => { g.buttons[i].pressed = !!o; });
  s.x.forEach((a, i) => { const b = g.boxes[i]; setTarget(b, a[0], a[1], gap); b.pushers = a[2]; });
  (s.sw || []).forEach((o, i) => { g.switches[i + 1] = !!o; });
  (s.lv || []).forEach((t, i) => { if (g.levers[i]) g.levers[i].flipT = t; });
  (s.l || []).forEach((y, i) => { if (g.lifts[i]) setTarget(g.lifts[i], g.lifts[i].x, y, gap); });
  (s.v || []).forEach((o, i) => { if (g.screws[i]) g.screws[i].got = !!o; });
  (s.m || []).forEach((x, i) => { if (g.movers[i]) setTarget(g.movers[i], x, g.movers[i].y, gap); });
  (s.sp || []).forEach((t, i) => { if (g.springs[i]) g.springs[i].t = t; });
  // Dünya güncellendikten sonra kendi top sunucuyla uzlaştırılır
  if (mine) Predict.reconcile(g, mine.sv, mine.ack);
  for (const e of s.fx) g.effects.push(e);
  if (g.effects.length > 60) g.effects = g.effects.filter(e => g.t - e.t < 1.2);
}

// Tahmin edilen kendi top burada değil predict.js'te çizilir; elindeki anahtar da onunla gider
function smoothNet(g, dt) {
  const k = Math.min(1, dt * 20);
  for (const o of [...g.players, ...g.keys, ...g.boxes, ...g.lifts, ...g.movers]) {
    if (o.tx === undefined) continue;
    o.x += (o.tx - o.x) * k;
    o.y += (o.ty - o.y) * k;
  }
  const me = Predict.active && Predict.me;
  if (!me || me.inExit) return;
  for (const key of g.keys) {
    if (key.holder !== me || key.used) continue;
    key.x = me.x + me.w / 2 - key.w / 2;
    key.y = me.y - key.h - 4;
  }
}
