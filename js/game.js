'use strict';

// Co-op top bulmacası: simülasyon. Çizimden ve giriş cihazından bağımsızdır.
// Her adımda oyuncu başına { left, right, jump, action } alır; ileride aynen sunucuda çalışabilir.

const NO_INPUT = { left: false, right: false, jump: false, action: false, swap: false };

const approach = (v, target, amount) => (v < target ? Math.min(v + amount, target) : Math.max(v - amount, target));
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const grow = (r, n) => ({ x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n });
const cellRect = q => ({ x: q.c * T, y: q.r * T, w: T, h: T });

function makeBody(kind, x, y, w, h, extra) {
  return Object.assign({
    kind, x, y, w, h, vx: 0, vy: 0, ox: x, oy: y,
    onGround: false, ground: null, supported: false, dx: 0,
  }, extra);
}

class Game {
  // level: hazır bölümün sırası ya da kendi yapılmış bölüm nesnesi ({ name, map, magnet, ... })
  constructor(level, playerCount) {
    this.levelIndex = typeof level === 'number' ? level : -1;
    this.def = typeof level === 'number' ? LEVELS[level] : level;
    this.t = 0;
    this.done = false;
    this.doneT = 0;
    this.effects = [];
    this.parse(this.def.map);

    const P = PHYS.playerSize, s = this.spawn;
    this.magnet = !!this.def.magnet;
    const pols = this.def.pols || [1, -1];
    this.players = [];
    for (let i = 0; i < playerCount; i++) {
      this.players.push(makeBody('player', s.x + 3 + i * (P + 6), s.y + T - P, P, P, {
        index: i, facing: 1, want: 0, coyote: 0, jumpBuf: 0, cut: true,
        prevJump: true, prevAction: true, prevSwap: true,   // bölüm başında basılı tutulan tuş tetiklenmesin
        squash: 0, inExit: false, exitCD: 0, blockedBy: null, boxHit: null,
        pol: pols[i % pols.length], magnetOn: false, actT: 0, magT: 0, gripT: 0,
      }));
    }
    this.boxNeed = Math.max(1, Math.min(this.def.boxNeed || 2, playerCount));
    this.solids = [];
  }

  // ---------- Bölüm okuma ----------

  parse(map) {
    const rows = map.length, cols = map[0].length;
    this.rows = rows; this.cols = cols;
    this.W = cols * T; this.H = rows * T;
    this.grid = [];
    this.blockers = [];
    this.keys = []; this.doors = []; this.buttons = []; this.gates = []; this.boxes = [];
    this.spawn = null; this.exit = null;
    const doorCells = [], gateCells = {};

    for (let r = 0; r < rows; r++) {
      this.grid.push([]);
      this.blockers.push([]);
      for (let c = 0; c < cols; c++) {
        const ch = map[r][c];
        const x = c * T, y = r * T;
        this.grid[r].push(ch === '#');
        this.blockers[r].push(null);
        if (ch === 'S' && !this.spawn) this.spawn = { x, y };
        else if (ch === 'E') {
          // Kapı karodan geniştir; yanında duvar varsa duvara taşmasın diye o tarafa yaslanır
          let ex = x + (T - EXIT_W) / 2;
          if (map[r][c + 1] === '#') ex = x + T - EXIT_W;
          else if (map[r][c - 1] === '#') ex = x;
          this.exit = { x: ex, y: y - T, w: EXIT_W, h: 2 * T };
        }
        else if (ch === 'K') {
          const k = PHYS.keySize;
          this.keys.push(makeBody('key', x + (T - k) / 2, y + T - k, k, k, { holder: null, used: false, noPick: new Map() }));
        } else if (ch === 'D') doorCells.push({ r, c });
        else if ('123'.includes(ch)) this.buttons.push({ channel: +ch, x: x + 3, y: y + T - 8, w: T - 6, h: 8, pressed: false });
        else if ('abc'.includes(ch)) (gateCells[ch] = gateCells[ch] || []).push({ r, c });
        else if (ch === 'H') this.boxes.push(makeBody('box', x, y, 2 * T, 2 * T, { push: { 1: 0, '-1': 0 }, pushers: 0 }));
      }
    }

    // Komşu kapı hücreleri tek kapıdır
    const seen = new Set();
    for (const start of doorCells) {
      if (seen.has(start.r * cols + start.c)) continue;
      const door = { kind: 'door', cells: [], open: false, openT: 0 };
      const stack = [start];
      seen.add(start.r * cols + start.c);
      while (stack.length) {
        const q = stack.pop();
        door.cells.push(q);
        this.blockers[q.r][q.c] = door;
        for (const n of doorCells) {
          const id = n.r * cols + n.c;
          if (!seen.has(id) && Math.abs(n.r - q.r) + Math.abs(n.c - q.c) === 1) { seen.add(id); stack.push(n); }
        }
      }
      this.doors.push(door);
    }

    for (const ch in gateCells) {
      const gate = { kind: 'gate', channel: 'abc'.indexOf(ch) + 1, cells: gateCells[ch], open: false };
      for (const q of gate.cells) this.blockers[q.r][q.c] = gate;
      this.gates.push(gate);
    }
  }

  blocked(c, r) {
    if (c < 0 || c >= this.cols || r < 0) return true;
    if (r >= this.rows) return false;   // haritanın altı çukurdur
    if (this.grid[r][c]) return true;
    const b = this.blockers[r][c];
    return !!b && !b.open;
  }

  rectBlocked(x, y, w, h) {
    const c0 = Math.floor(x / T), c1 = Math.floor((x + w - 0.001) / T);
    const r0 = Math.floor(y / T), r1 = Math.floor((y + h - 0.001) / T);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (this.blocked(c, r)) return true;
    return false;
  }

  fx(type, x, y, extra) {
    this.effects.push(Object.assign({ type, x, y, t: this.t }, extra));
  }

  // ---------- Çarpışmalı hareket ----------

  moveX(b, dx) {
    if (dx === 0) return null;
    b.x += dx;
    let hit = null;
    const r0 = Math.floor(b.y / T), r1 = Math.floor((b.y + b.h - 0.001) / T);
    const c = dx > 0 ? Math.floor((b.x + b.w - 0.001) / T) : Math.floor(b.x / T);
    for (let r = r0; r <= r1; r++) {
      if (this.blocked(c, r)) { b.x = dx > 0 ? c * T - b.w : (c + 1) * T; hit = 'tile'; break; }
    }
    for (const o of this.solids) {
      if (o === b || !overlap(b, o)) continue;
      b.x = dx > 0 ? o.x - b.w : o.x + o.w;
      hit = o;
    }
    if (hit) b.vx = 0;
    return hit;
  }

  moveY(b, dy, depth = 0) {
    if (dy === 0) return null;
    const vy0 = b.vy;
    b.y += dy;
    let hit = null;
    const c0 = Math.floor(b.x / T), c1 = Math.floor((b.x + b.w - 0.001) / T);
    const r = dy > 0 ? Math.floor((b.y + b.h - 0.001) / T) : Math.floor(b.y / T);
    for (let c = c0; c <= c1; c++) {
      if (this.blocked(c, r)) { b.y = dy > 0 ? r * T - b.h : (r + 1) * T; hit = 'tile'; break; }
    }
    for (const o of this.solids) {
      if (o === b || !overlap(b, o)) continue;
      // Köşe düzeltmesi: yukarı çıkarken birinin kenarına birkaç piksel takıldıysan yana kay
      if (dy < 0) {
        const fromLeft = b.x + b.w - o.x, fromRight = o.x + o.w - b.x;
        const nudge = fromLeft < fromRight ? -fromLeft : fromRight;
        if (Math.abs(nudge) <= 6 && !this.rectBlocked(b.x + nudge, b.y, b.w, b.h)) { b.x += nudge; continue; }
      }
      // Alttaki oyuncu zıplarsa üstündekini de kaldırır. Mıknatısı açık olan sabittir:
      // yoksa çektiği arkadaşı onu yukarı iter, ikisi birbirini sonsuza dek taşırdı.
      if (dy < 0 && depth < 4 && b.kind === 'player' && o.kind === 'player' && !o.magnetOn) {
        this.moveY(o, b.y - (o.y + o.h), depth + 1);
        if (!overlap(b, o)) continue;
      }
      b.y = dy > 0 ? o.y - b.h : o.y + o.h;
      hit = o;
    }
    if (hit) {
      if (dy > 0) {
        b.onGround = true;
        b.ground = hit === 'tile' ? null : hit;
        if (b.kind === 'player' && vy0 > 350) b.squash = Math.min(0.32, vy0 / 2600);
      }
      b.vy = 0;
    }
    return hit;
  }

  // ---------- Simülasyon adımı ----------

  step(dt, inputs) {
    if (this.done) return;
    this.t += dt;
    const ph = PHYS;
    this.solids = this.players.filter(p => !p.inExit).concat(this.boxes);

    // 1) Oyuncu girişleri
    this.players.forEach((p, i) => {
      const inp = inputs[i] || NO_INPUT;
      const jumpEdge = inp.jump && !p.prevJump, actEdge = inp.action && !p.prevAction;
      const actRelease = !inp.action && p.prevAction, swapEdge = inp.swap && !p.prevSwap;
      p.prevJump = inp.jump;
      p.prevAction = inp.action;
      p.prevSwap = inp.swap;
      p.exitCD = Math.max(0, p.exitCD - dt);
      p.magT = Math.max(0, p.magT - dt);
      if (p.inExit) {
        p.magnetOn = false;
        if (jumpEdge || actEdge) this.leaveExit(p);
        return;
      }
      if (this.magnet && swapEdge) {
        p.pol = -p.pol;
        this.fx('swap', p.x + p.w / 2, p.y + p.h / 2, { color: POLE_COLORS[p.pol] });
      }
      // Eylem: kısa dokunuş anahtarı bırakır, basılı tutmak mıknatısı açar
      if (actEdge) p.actT = 0;
      if (inp.action) p.actT += dt;
      p.magnetOn = this.magnet && inp.action;
      if (actRelease && p.actT < 0.2) this.dropKey(p);

      const want = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      p.want = want;
      // Mıknatısla savrulurken kontrol azalır; yoksa savrulma hemen sönerdi
      const ctl = p.magT > 0 ? 0.25 : 1;
      if (want) {
        p.vx = approach(p.vx, want * ph.runSpeed, (p.onGround && ctl === 1 ? ph.accel : ph.airAccel) * ctl * dt);
        p.facing = want;
      } else {
        p.vx = approach(p.vx, 0, (p.onGround && ctl === 1 ? ph.friction : ph.airAccel * 0.4) * ctl * dt);
      }
      // Zıt kutuplu mıknatısa yapışıkken arkadaşından destek alıp zıplayabilir
      p.gripT = Math.max(0, p.gripT - dt);
      p.coyote = p.supported || p.gripT > 0 ? ph.coyote : p.coyote - dt;
      p.jumpBuf = jumpEdge ? ph.jumpBuffer : p.jumpBuf - dt;
      if (p.jumpBuf > 0 && p.coyote > 0) {
        p.vy = -ph.jumpV;
        p.jumpBuf = 0; p.coyote = 0; p.cut = false;
        p.squash = -0.22;
        this.fx('jump', p.x + p.w / 2, p.y + p.h);
      }
      if (!inp.jump && p.vy < 0 && !p.cut) { p.vy *= ph.jumpCut; p.cut = true; }
    });

    this.applyMagnets(dt);

    // 2) Kutular: önceki adımda yeterince kişi ittiyse kayar
    for (const b of this.boxes) {
      const dir = b.push[1] >= this.boxNeed ? 1 : b.push[-1] >= this.boxNeed ? -1 : 0;
      b.vx = dir * ph.boxSpeed;
      b.pushers = Math.max(b.push[1], b.push[-1]);
      b.push[1] = 0; b.push[-1] = 0;
    }

    // 3) Yerçekimi ve hareket: alttakiler önce hareket eder, üstündekiler onunla taşınır
    const movers = this.solids.slice().sort((a, b) => (b.y + b.h) - (a.y + a.h));
    for (const b of movers) { b.dx = 0; b.blockedBy = null; b.boxHit = null; }
    for (const b of movers) {
      b.vy = Math.min(b.vy + ph.gravity * dt, ph.maxFall);
      const g = b.ground;
      const carry = g && this.solids.includes(g) ? g.dx : 0;
      const x0 = b.x;
      b.onGround = false;
      b.ground = null;
      this.moveX(b, b.vx * dt + carry);
      this.moveY(b, b.vy * dt);
      b.dx = b.x - x0;
    }
    // Kime yaslanıyor? Kutu kaydıkça temas bir kare kopabildiği için küçük bir yoklama payı bırakılır
    for (const p of this.players) {
      if (!p.want || p.inExit) continue;
      const probe = { x: p.x + p.want * 3, y: p.y + 2, w: p.w, h: p.h - 4 };
      for (const o of this.solids) {
        if (o === p || !overlap(probe, o)) continue;
        if (o.kind === 'box') p.boxHit = o; else p.blockedBy = o;
      }
    }
    for (const b of movers) b.supported = b.onGround && (!b.ground || b.ground.supported);

    // 4) İtme zinciri: kutuya yaslanan oyuncuyu aynı yöne iten herkes iten sayılır
    for (const p of this.players) {
      if (!p.want || p.inExit) continue;
      let q = p, guard = 0;
      while (q && !q.boxHit && q.blockedBy && q.blockedBy.want === p.want && guard++ < 4) q = q.blockedBy;
      if (q && q.boxHit) q.boxHit.push[p.want]++;
    }

    this.updateKeys(dt);
    this.updateDoors(dt);
    this.updateButtons();

    // 5) Çıkış, çukur
    for (const p of this.players) {
      p.squash += (0 - p.squash) * Math.min(1, dt * 10);
      if (!p.inExit && this.exit && p.exitCD <= 0 && p.supported && overlap(p, this.exit)) this.enterExit(p);
      if (!p.inExit && p.y > this.H + 150) this.respawn(p);
    }
    for (const b of this.boxes) {
      if (b.y > this.H + 150) { b.x = b.ox; b.y = b.oy; b.vx = b.vy = 0; }
    }

    if (this.players.length && this.players.every(p => p.inExit)) {
      this.done = true;
      this.doneT = this.t;
      this.fx('win', this.exit.x + this.exit.w / 2, this.exit.y);
    }

    if (this.effects.length > 40 || (this.effects.length && this.t - this.effects[0].t > 1.2)) {
      this.effects = this.effects.filter(e => this.t - e.t < 1.2);
    }
  }

  // Mıknatısı açık olan her oyuncu, menzilindeki diğer oyuncuları ve serbest anahtarları etkiler.
  applyMagnets(dt) {
    if (!this.magnet) return;
    const ph = PHYS, R = ph.magnetRange;
    const push = (o, hx, hy, force) => {
      const dx = o.x + o.w / 2 - hx, dy = o.y + o.h / 2 - hy, d = Math.hypot(dx, dy) || 1;
      if (d > R) return false;
      const a = force * (1 - (d / R) ** 2);
      o.vx += dx / d * a * dt;
      o.vy += dy / d * a * dt;
      const sp = Math.hypot(o.vx, o.vy);
      if (sp > ph.maxSpeed) { o.vx *= ph.maxSpeed / sp; o.vy *= ph.maxSpeed / sp; }
      o.magT = 0.3;
      return true;
    };
    for (const h of this.players) {
      h.affects = [];
      if (!h.magnetOn || h.inExit) continue;
      const hx = h.x + h.w / 2, hy = h.y + h.h / 2;
      for (const o of this.players) {
        if (o === h || o.inExit) continue;
        // aynı kutup iter (+), zıt kutup çeker (−)
        if (push(o, hx, hy, ph.magnetForce * (o.pol === h.pol ? 1 : -1))) {
          h.affects.push({ o, repel: o.pol === h.pol });
          // Çekildiği mıknatısın dibindeyse (değmese bile) ona tutunmuş sayılır
          const gap = Math.hypot(o.x - h.x, o.y - h.y) - (o.w + h.w) / 2;
          if (o.pol !== h.pol && gap < 20) o.gripT = 0.1;
          if (o.cut === false) o.cut = true;   // zıplama kesmesi mıknatısla fırlamayı bozmasın
        }
      }
      for (const k of this.keys) {
        if (k.used || k.holder) continue;
        if (push(k, hx, hy, -ph.magnetKeyForce)) h.affects.push({ o: k, repel: false });
      }
    }
  }

  updateKeys(dt) {
    const ph = PHYS;
    for (const k of this.keys) {
      if (k.used) continue;
      if (k.holder) {
        const h = k.holder;
        k.x = h.x + h.w / 2 - k.w / 2;
        k.y = h.y - k.h - 4;
        k.vx = k.vy = 0;
        continue;
      }
      k.vy = Math.min(k.vy + ph.gravity * dt, ph.maxFall);
      k.magT = Math.max(0, (k.magT || 0) - dt);
      k.vx = approach(k.vx, 0, (k.onGround && !k.magT ? 1500 : 150) * dt);
      k.onGround = false;
      this.moveX(k, k.vx * dt);
      this.moveY(k, k.vy * dt);
      if (k.y > this.H + 150) { k.x = k.ox; k.y = k.oy; k.vx = k.vy = 0; this.fx('respawn', k.x + k.w / 2, k.y, { color: '#ffd43b' }); }
      for (const p of this.players) {
        if (p.inExit || this.keys.some(o => o.holder === p)) continue;
        if ((k.noPick.get(p) || 0) > this.t) continue;
        if (overlap(grow(p, 4), k)) {
          k.holder = p;
          this.fx('pickup', k.x + k.w / 2, k.y + k.h / 2);
          break;
        }
      }
    }
  }

  dropKey(p) {
    const k = this.keys.find(o => o.holder === p);
    if (!k) return;
    k.holder = null;
    k.vx = p.facing * 280 + p.vx * 0.4;
    k.vy = -480;
    k.noPick.set(p, this.t + 0.5);
  }

  updateDoors(dt) {
    for (const d of this.doors) {
      if (d.open) { d.openT += dt; continue; }
      for (const k of this.keys) {
        if (k.used) continue;
        const probe = grow(k.holder || k, 3);
        if (d.cells.some(q => overlap(probe, cellRect(q)))) {
          d.open = true;
          k.used = true;
          k.holder = null;
          const mid = d.cells[Math.floor(d.cells.length / 2)];
          this.fx('unlock', mid.c * T + T / 2, mid.r * T + T / 2);
          break;
        }
      }
    }
  }

  updateButtons() {
    const weights = this.players.filter(p => !p.inExit).concat(this.boxes);
    for (const b of this.buttons) {
      const was = b.pressed;
      b.pressed = weights.some(w => overlap(w, { x: b.x, y: b.y - 4, w: b.w, h: b.h + 4 }));
      if (b.pressed && !was) this.fx('click', b.x + b.w / 2, b.y, { color: CHANNEL_COLORS[b.channel] });
    }
    for (const g of this.gates) {
      const want = this.buttons.some(b => b.channel === g.channel && b.pressed);
      if (want) g.open = true;
      else if (g.open) {
        // İçinde biri varken kapanmaz
        const occupied = this.solids.some(w => g.cells.some(q => overlap(w, cellRect(q))));
        if (!occupied) g.open = false;
      }
    }
  }

  enterExit(p) {
    p.inExit = true;
    p.vx = p.vy = 0;
    const k = this.keys.find(o => o.holder === p);
    if (k) { k.holder = null; k.vy = -200; }
    this.fx('enter', this.exit.x + this.exit.w / 2, this.exit.y + T);
  }

  leaveExit(p) {
    p.inExit = false;
    p.exitCD = 0.8;
    p.x = this.exit.x + (this.exit.w - p.w) / 2;
    p.y = this.exit.y + this.exit.h - p.h;
    p.vy = -250;
  }

  respawn(p) {
    const mate = this.players.find(o => o !== p && !o.inExit && o.supported);
    if (mate) {
      p.x = mate.x;
      p.y = mate.y - p.h - 6;
    } else {
      p.x = this.spawn.x + 3;
      p.y = this.spawn.y + T - p.h;
    }
    p.vx = p.vy = 0;
    this.fx('respawn', p.x + p.w / 2, p.y + p.h / 2, { color: PLAYER_COLORS[p.index] });
  }

  get inExitCount() { return this.players.filter(p => p.inExit).length; }
}
