'use strict';

// Online bağlantı: sunucuya tuş durumunu gönderir, gelen durumu yerel Game nesnesine uygular.
// Tarayıcı simülasyonu çalıştırmaz; sunucu tek doğru kaynaktır, burada yalnızca yumuşatarak çizilir.
// Gecikmeyi hissettirmemek için kendi topun bakış yönü, zıplama sesi ve tozu yerelde hemen oynar (Echo).

const Net = {
  ws: null,
  handlers: {},
  lastBits: -1,
  rtt: null,         // son ölçülen gidiş-dönüş süresi (ms)
  pingT: 0,

  available() { return location.protocol === 'http:' || location.protocol === 'https:'; },

  // Sayfanın yüklendiği sürüm (sunucu index.html'e yazar; dosyadan açılınca yoktur)
  build() {
    const m = document.querySelector('meta[name="build"]');
    const b = m && m.content;
    return b && !b.startsWith('__') ? b : null;
  },

  // Sunucu yeni bir sürümle açıldıysa sayfayı yenile (aynı sürüm için en fazla dakikada bir)
  checkBuild(m) {
    const mine = this.build();
    if (!mine || !m.build || m.build === mine) return;
    let last = 0;
    try { last = +sessionStorage.getItem('reloadFor:' + m.build) || 0; } catch (e) { /* yoksay */ }
    if (Date.now() - last < 60000) return;
    try { sessionStorage.setItem('reloadFor:' + m.build, String(Date.now())); } catch (e) { /* yoksay */ }
    location.reload();
  },

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
        if (m.t === 'pong') { this.pong(m); return; }
        if (m.t === 'hello') { this.checkBuild(m); return; }
        const h = this.handlers[m.t];
        if (h) h(m);
      };
      this.ws = ws;
      this.lastBits = -1;
      this.rtt = null;
    });
  },

  close() {
    if (this.ws) { const ws = this.ws; this.ws = null; ws.close(); }
  },

  on(type, fn) { this.handlers[type] = fn; },

  send(msg) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg)); },

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
  Echo.filter(g, s);
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
  (s.pr || []).forEach((y, i) => { if (g.presses[i]) setTarget(g.presses[i], g.presses[i].x, y); });
  (s.tm || []).forEach((t, i) => { if (g.buttons[i]) g.buttons[i].left = t; });
  (s.v || []).forEach((o, i) => { if (g.screws[i]) g.screws[i].got = !!o; });
  (s.m || []).forEach((x, i) => { if (g.movers[i]) setTarget(g.movers[i], x, g.movers[i].y); });
  (s.sp || []).forEach((t, i) => { if (g.springs[i]) g.springs[i].t = t; });
  for (const e of s.fx) g.effects.push(e);
  if (g.effects.length > 60) g.effects = g.effects.filter(e => g.t - e.t < 1.2);
}

// Kendi top yumuşatılmaz, sunucunun son konumunda çizilir: tuşa tepki gecikmesi azalır
function smoothNet(g, dt) {
  const k = Math.min(1, dt * 20);
  for (const o of [...g.players, ...g.keys, ...g.boxes, ...g.lifts, ...g.movers, ...g.presses]) {
    if (o.tx === undefined) continue;
    const kk = o.isMe ? 1 : k;
    o.x += (o.tx - o.x) * kk;
    o.y += (o.ty - o.y) * kk;
  }
}

// Yerel yankı: fiziğe dokunmaz, yalnızca görüntü ve ses. Zıplama tuşuna basınca top yerdeyse
// zıplama sesi, tozu ve ezilmesi sunucuyu beklemeden oynar; sunucudan gelen aynı efekt atlanır.
const Echo = {
  prevJump: true,
  groundT: -1,       // topun en son yerde görüldüğü an (ms)
  jumpT: -1,         // yerel zıplama yankısının anı (ms)
  pending: false,    // sunucudan gelecek zıplama efekti henüz atlanmadı

  reset() { this.prevJump = true; this.groundT = this.jumpT = -1; this.pending = false; },

  // Top bir şeyin üstünde mi: ayağının altında karo, ince platform ya da başka bir cisim
  onGround(g, p) {
    const foot = { x: p.x + 2, y: p.y + p.h, w: p.w - 4, h: 3 };
    if (g.rectBlocked(foot.x, foot.y, foot.w, foot.h, p)) return true;
    const r = Math.floor((p.y + p.h + 1) / T);
    for (let c = Math.floor(foot.x / T); c <= Math.floor((foot.x + foot.w) / T); c++) if (g.oneway[r] && g.oneway[r][c]) return true;
    return [...g.players, ...g.boxes, ...g.lifts, ...g.movers, ...g.presses].some(o => o !== p && !o.inExit &&
      foot.x < o.x + o.w && foot.x + foot.w > o.x && foot.y < o.y + o.h && foot.y + foot.h > o.y);
  },

  frame(g, inp, now) {
    const p = g.players.find(x => x.isMe);
    if (!p) return;
    const jumpEdge = inp.jump && !this.prevJump;
    this.prevJump = inp.jump;
    if (p.inExit) return;
    const want = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (want) p.facing = want;
    if (Math.abs(p.vy) < 60 && this.onGround(g, p)) this.groundT = now;
    // Kısa bir tolerans: kenardan yeni düştüyse de sunucu zıplatır
    if (jumpEdge && now - this.groundT < 120 && now - this.jumpT > 250) {
      this.jumpT = now;
      this.pending = true;
      g.effects.push({ type: 'jump', x: p.x + p.w / 2, y: p.y + p.h, t: g.t + 1e-4 });
    }
    // Yankıdan sonra ezilme yerel eğriyle çizilir (sunucununki ping kadar geç gelir)
    const since = now - this.jumpT;
    if (this.jumpT >= 0 && since < (Net.rtt || 100) + 350) p.squash = -0.22 * Math.exp(-since / 100);
  },

  // Sunucudan gelen ilk zıplama efekti yerelde zaten oynadıysa atlanır
  filter(g, s) {
    if (!this.pending) return;
    const p = g.players.find(x => x.isMe);
    if (!p) return;
    const i = s.fx.findIndex(e => e.type === 'jump' && Math.abs(e.x - (p.x + p.w / 2)) < 80);
    if (i >= 0) { s.fx.splice(i, 1); this.pending = false; }
    else if (performance.now() - this.jumpT > 1000) this.pending = false;   // sunucu zıplatmadı
  },
};
