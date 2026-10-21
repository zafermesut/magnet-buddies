'use strict';

// Online bağlantı: sunucuya tuş durumunu gönderir, gelen durumu yerel Game nesnesine uygular.
// Tarayıcı simülasyonu çalıştırmaz; sunucu tek doğru kaynaktır, burada yalnızca yumuşatarak çizilir.

const Net = {
  ws: null,
  handlers: {},
  lastBits: -1,

  available() { return location.protocol === 'http:' || location.protocol === 'https:'; },

  connect() {
    this.close();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      let opened = false;
      ws.onopen = () => { opened = true; resolve(); };
      ws.onerror = () => { if (!opened) reject(new Error('bağlanamadı')); };
      ws.onclose = () => { if (this.ws === ws) { this.ws = null; if (opened && this.handlers.close) this.handlers.close(); } };
      ws.onmessage = e => {
        let m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        const h = this.handlers[m.t];
        if (h) h(m);
      };
      this.ws = ws;
      this.lastBits = -1;
    });
  },

  close() {
    if (this.ws) { const ws = this.ws; this.ws = null; ws.close(); }
  },

  on(type, fn) { this.handlers[type] = fn; },

  send(msg) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg)); },

  // Yalnızca değişince gönderilir
  sendInput(i) {
    const b = (i.left ? 1 : 0) | (i.right ? 2 : 0) | (i.jump ? 4 : 0) | (i.action ? 8 : 0) | (i.swap ? 16 : 0);
    if (b !== this.lastBits) { this.lastBits = b; this.send({ t: 'i', b }); }
  },
};

// Sunucudan gelen durumu yerel oyuna uygula. Konumlar hedef olarak tutulur, smoothNet ile yaklaşılır.
function setTarget(o, x, y) {
  if (o.tx === undefined || Math.hypot(x - o.x, y - o.y) > 120) { o.x = x; o.y = y; }   // ışınlanma: atla
  o.tx = x;
  o.ty = y;
}

function applySnapshot(g, s) {
  g.t = s.time;
  s.p.forEach((a, i) => {
    const p = g.players[i];
    if (!p) return;
    setTarget(p, a[0], a[1]);
    p.vx = a[2]; p.vy = a[3]; p.pol = a[4];
    p.magnetOn = !!a[5]; p.inExit = !!a[6]; p.squash = a[7]; p.facing = a[8];
    p.affects = a[9].map(([kind, idx, repel]) => ({ o: kind === 'p' ? g.players[idx] : kind === 'b' ? g.boxes[idx] : g.keys[idx], repel: !!repel })).filter(x => x.o);
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
  s.x.forEach((a, i) => { const b = g.boxes[i]; setTarget(b, a[0], a[1]); b.pushers = a[2]; });
  (s.sw || []).forEach((o, i) => { g.switches[i + 1] = !!o; });
  (s.lv || []).forEach((t, i) => { if (g.levers[i]) g.levers[i].flipT = t; });
  (s.l || []).forEach((y, i) => { if (g.lifts[i]) setTarget(g.lifts[i], g.lifts[i].x, y); });
  (s.m || []).forEach((x, i) => { if (g.movers[i]) setTarget(g.movers[i], x, g.movers[i].y); });
  (s.sp || []).forEach((t, i) => { if (g.springs[i]) g.springs[i].t = t; });
  for (const e of s.fx) g.effects.push(e);
  if (g.effects.length > 60) g.effects = g.effects.filter(e => g.t - e.t < 1.2);
}

function smoothNet(g, dt) {
  const k = Math.min(1, dt * 20);
  for (const o of [...g.players, ...g.keys, ...g.boxes, ...g.lifts, ...g.movers]) {
    if (o.tx === undefined) continue;
    o.x += (o.tx - o.x) * k;
    o.y += (o.ty - o.y) * k;
  }
}
