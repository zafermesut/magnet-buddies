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
    // Sabit mıknatıs ya da kutup kapısı olan bölümde kutup değiştirmek de açık
    this.magnet = !!this.def.magnet || this.fixed.length > 0 || this.poleCells.size > 0;
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
    this.levers = []; this.lifts = []; this.springs = []; this.movers = [];
    this.fixed = [];               // sabit mıknatıs blokları: { x, y, pol }
    this.screws = [];              // vidalar (isteğe bağlı toplanır): { x, y, w, h, got }
    this.poleCells = new Map();    // kutup kapısı hücreleri: r * cols + c → kutup
    this.oneway = [];
    this.switches = { 1: false, 2: false, 3: false };   // şalterlerin açık tuttuğu kanallar
    this.spawn = null; this.exit = null;
    const doorCells = [], gateCells = {};

    for (let r = 0; r < rows; r++) {
      this.grid.push([]);
      this.blockers.push([]);
      this.oneway.push([]);
      for (let c = 0; c < cols; c++) {
        const ch = map[r][c];
        const x = c * T, y = r * T;
        this.grid[r].push(ch === '#' || ch === 'P' || ch === 'N');
        this.blockers[r].push(null);
        this.oneway[r].push(ch === '-');
        if (ch === 'S' && !this.spawn) this.spawn = { x, y };
        else if (ch === 'E') {
          // Kapı karodan geniştir; yanında duvar varsa duvara taşmasın diye o tarafa yaslanır
          let ex = x + (T - EXIT_W) / 2;
          if (map[r][c + 1] === '#') ex = x + T - EXIT_W;
          else if (map[r][c - 1] === '#') ex = x;
          this.exit = { x: ex, y: y - T, w: EXIT_W, h: 2 * T };
        }
        else if (ch === 'K' || ch === 'C') {
          // Pusula parçası (C) anahtar gibi taşınır ve kapı açar; yalnızca görünüşü farklıdır
          const k = PHYS.keySize;
          this.keys.push(makeBody('key', x + (T - k) / 2, y + T - k, k, k, { holder: null, used: false, noPick: new Map(), compass: ch === 'C' }));
        } else if (ch === 'D') doorCells.push({ r, c });
        else if ('123'.includes(ch)) this.buttons.push({ channel: +ch, x: x + 3, y: y + T - 8, w: T - 6, h: 8, pressed: false });
        else if ('abcABC'.includes(ch)) (gateCells[ch] = gateCells[ch] || []).push({ r, c });
        else if (ch === 'H') this.boxes.push(makeBody('box', x, y, 2 * T, 2 * T, { push: { 1: 0, '-1': 0 }, pushers: 0 }));
        else if (ch === 'M') {
          // Metal sandık: tek kişi iter, mıknatıs çeker
          const k = PHYS.crateSize;
          this.boxes.push(makeBody('box', x + (T - k) / 2, y + T - k, k, k, { metal: true, push: { 1: 0, '-1': 0 }, pushers: 0, magT: 0 }));
        }
        else if (ch === 'P' || ch === 'N') this.fixed.push({ x: x + T / 2, y: y + T / 2, c, r, pol: ch === 'P' ? 1 : -1 });
        else if (ch === 'p' || ch === 'n') this.poleCells.set(r * cols + c, ch === 'p' ? 1 : -1);
        else if (ch === 'V') this.screws.push({ x: x + 10, y: y + 10, w: T - 20, h: T - 20, got: false });
        else if ('456'.includes(ch)) this.levers.push({ channel: +ch - 3, x, y, w: T, h: T, flipT: -9 });
        else if (ch === '^') this.springs.push({ x: x + 4, y: y + T - 12, w: T - 8, h: 12, t: -9 });
        else if (ch === '=' && map[r][c - 1] !== '=') {
          // Gezgin platform: yan yana '=' tek platformdur; duvara ya da ray sonuna (':') kadar gidip döner
          let w = 1;
          while (map[r][c + w] === '=') w++;
          const stop = k => k < 0 || k >= cols || map[r][k] === '#' || map[r][k] === ':';
          let a = c - 1, b = c + w;
          while (!stop(a)) a--;
          while (!stop(b)) b++;
          this.movers.push(makeBody('mover', x, y, w * T, 14, { minX: (a + 1) * T, maxX: b * T - w * T, dir: 1, pause: 0, supported: true, onGround: true }));
        }
        else if ('xyz'.includes(ch) && map[r][c - 1] !== ch) {
          // Asansör: yan yana aynı harfler tek platformdur. Üstündeki ilk duvarın bir karo altına kadar çıkar.
          let w = 1;
          while (map[r][c + w] === ch) w++;
          let ceil = r - 1;
          while (ceil >= 0 && ![...map[ceil].slice(c, c + w)].includes('#')) ceil--;
          const topY = Math.min(y, (ceil + 2) * T);
          this.lifts.push(makeBody('lift', x, y, w * T, T, { channel: 'xyz'.indexOf(ch) + 1, topY, supported: true, onGround: true }));
        }
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
      // Büyük harfli kapak terstir: kanal kapalıyken açık, açıkken kapalı
      const inverse = ch === ch.toUpperCase();
      const gate = { kind: 'gate', channel: 'abc'.indexOf(ch.toLowerCase()) + 1, inverse, cells: gateCells[ch], open: inverse };
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

  // Kutup kapısı: yalnızca aynı kutuptaki oyuncu geçer; başka her şeyi durdurur
  poleAt(c, r) { return r >= 0 && r < this.rows ? this.poleCells.get(r * this.cols + c) || 0 : 0; }
  blocks(b, c, r) {
    if (this.blocked(c, r)) return true;
    const pol = this.poleCells.size ? this.poleAt(c, r) : 0;
    return !!pol && !(b && b.kind === 'player' && b.pol === pol);
  }

  rectBlocked(x, y, w, h, b = null) {
    const c0 = Math.floor(x / T), c1 = Math.floor((x + w - 0.001) / T);
    const r0 = Math.floor(y / T), r1 = Math.floor((y + h - 0.001) / T);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (this.blocks(b, c, r)) return true;
    return false;
  }

  // Bir kanal açık mı: düğmesine basılıyor ya da şalteri açık
  channelOn(ch) {
    return this.switches[ch] || this.buttons.some(b => b.channel === ch && b.pressed);
  }

  fx(type, x, y, extra) {
    if (this.predicting) return;
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
      if (this.blocks(b, c, r)) { b.x = dx > 0 ? c * T - b.w : (c + 1) * T; hit = 'tile'; break; }
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
      if (this.blocks(b, c, r)) { b.y = dy > 0 ? r * T - b.h : (r + 1) * T; hit = 'tile'; break; }
      // Tek yönlü platform: yalnızca yukarıdan gelen üstüne basar, alttan geçilir
      if (dy > 0 && !hit && this.oneway[r] && this.oneway[r][c] && b.y + b.h - dy <= r * T + 0.01) { b.y = r * T - b.h; hit = 'tile'; break; }
    }
    for (const o of this.solids) {
      if (o === b || !overlap(b, o)) continue;
      // Köşe düzeltmesi: yukarı çıkarken birinin kenarına birkaç piksel takıldıysan yana kay
      if (dy < 0) {
        const fromLeft = b.x + b.w - o.x, fromRight = o.x + o.w - b.x;
        const nudge = fromLeft < fromRight ? -fromLeft : fromRight;
        if (Math.abs(nudge) <= 6 && !this.rectBlocked(b.x + nudge, b.y, b.w, b.h, b)) { b.x += nudge; continue; }
      }
      // Alttaki oyuncu zıplarsa üstündekini de kaldırır. Mıknatısı açık olan sabittir:
      // yoksa çektiği arkadaşı onu yukarı iter, ikisi birbirini sonsuza dek taşırdı.
      if (dy < 0 && depth < 4 && b.kind === 'player' && o.kind === 'player' && !o.magnetOn && !this.predicting) {
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
        if (b.kind === 'player' && vy0 > 350) {
          b.squash = Math.min(0.32, vy0 / 2600);
          this.fx('land', b.x + b.w / 2, b.y + b.h, { power: Math.min(1, vy0 / 1000) });
        }
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
    this.solids = this.players.filter(p => !p.inExit).concat(this.boxes, this.lifts, this.movers);

    // 1) Oyuncu girişleri
    this.players.forEach((p, i) => this.playerInput(p, inputs[i] || NO_INPUT, dt));

    this.applyMagnets(dt);
    this.applyFixed(dt);

    // 2) Kutular: önceki adımda yeterince kişi ittiyse kayar
    for (const b of this.boxes) {
      const need = b.metal ? 1 : this.boxNeed;
      const dir = b.push[1] >= need ? 1 : b.push[-1] >= need ? -1 : 0;
      if (b.metal) {
        // Metal sandık: itilince kayar, mıknatısla savrulunca bir süre kayar, sonra durur
        b.magT = Math.max(0, b.magT - dt);
        if (dir) b.vx = dir * ph.crateSpeed;
        else b.vx = approach(b.vx, 0, (b.onGround && !b.magT ? 1800 : 200) * dt);
      } else b.vx = dir * ph.boxSpeed;
      b.pushers = Math.max(b.push[1], b.push[-1]);
      b.push[1] = 0; b.push[-1] = 0;
    }

    this.updateLifts(dt);
    this.updateMovers(dt);

    // 3) Yerçekimi ve hareket: alttakiler önce hareket eder, üstündekiler onunla taşınır
    const movers = this.solids.filter(o => o.kind !== 'lift' && o.kind !== 'mover').sort((a, b) => (b.y + b.h) - (a.y + a.h));
    for (const b of movers) { b.dx = 0; b.blockedBy = null; b.boxHit = null; }
    for (const b of movers) {
      b.vy = Math.min(b.vy + ph.gravity * dt, ph.maxFall);
      const g = b.ground;
      // Üstündekini taşır; ama oyuncunun kafasına düşen sandık taşınmaz, oyuncu yürüyünce kayıp düşer
      const carry = g && this.solids.includes(g) && !(b.kind === 'box' && g.kind === 'player') ? g.dx : 0;
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
    // Düşen oyuncu en son sağlam zeminde (karo üstünde) durduğu yerde doğar
    for (const p of this.players) if (p.supported && !p.ground && !p.inExit) p.safe = { x: p.x, y: p.y };

    // 4) İtme zinciri: kutuya yaslanan oyuncuyu aynı yöne iten herkes iten sayılır
    for (const p of this.players) {
      if (!p.want || p.inExit) continue;
      let q = p, guard = 0;
      while (q && !q.boxHit && q.blockedBy && q.blockedBy.want === p.want && guard++ < 4) q = q.blockedBy;
      if (q && q.boxHit) q.boxHit.push[p.want]++;
    }

    this.updateSprings();
    this.updateScrews();
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

  // Bir oyuncunun tuşları: kutup, eylem, yürüme, zıplama
  playerInput(p, inp, dt) {
    const ph = PHYS;
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
    // Kutup kapısının içindeyken kutup değişmez (kapının içinde sıkışılmasın)
    if (this.magnet && swapEdge && !(this.poleCells.size && this.rectBlocked(p.x, p.y, p.w, p.h, { kind: 'player', pol: -p.pol }))) {
      p.pol = -p.pol;
      this.fx('swap', p.x + p.w / 2, p.y + p.h / 2, { color: POLE_COLORS[p.pol] });
    }
    // Eylem: kısa dokunuş anahtarı bırakır, basılı tutmak mıknatısı açar
    if (actEdge) { p.actT = 0; p.usedLever = this.flipLever(p); }
    if (inp.action) p.actT += dt;
    p.magnetOn = this.magnet && inp.action && !p.usedLever;
    if (actRelease && p.actT < 0.2 && !p.usedLever) this.dropKey(p);

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
  }

  // İstemci tarafı tahmin: yalnızca p'yi bir adım ilerletir, dünyanın geri kalanı yerinde durur.
  // p oyunun kendi oyuncusu değil, onun kopyasıdır (skip: çizilen asıl oyuncu, çarpışmaya girmez).
  // Başkalarını etkileyen her şey (şalter, anahtar, arkadaşını kaldırma, efektler) sunucuya bırakılır.
  predict(p, inp, dt, skip) {
    const ph = PHYS;
    this.predicting = true;
    this.solids = [p].concat(this.players.filter(o => o !== skip && !o.inExit), this.boxes, this.lifts, this.movers);
    this.playerInput(p, inp, dt);
    if (this.fixed.length) this.applyFixedTo(p, dt);
    p.vy = Math.min(p.vy + ph.gravity * dt, ph.maxFall);
    // Zemin kayıyorsa onunla taşınır (hızı sunucudan gelen durumlardan tahmin edilir)
    const g = p.ground;
    const carry = g && this.solids.includes(g) && g.kind !== 'lift' ? (g.ndx || 0) * dt : 0;
    if (g && g.kind === 'lift') p.y += (g.ndy || 0) * dt;
    p.onGround = false;
    p.ground = null;
    this.moveX(p, p.vx * dt + carry);
    this.moveY(p, p.vy * dt);
    p.supported = p.onGround;
    this.updateSprings([p]);
    p.squash += (0 - p.squash) * Math.min(1, dt * 10);
    this.predicting = false;
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
      for (const b of this.boxes) {
        if (b.metal && push(b, hx, hy, -ph.magnetKeyForce)) h.affects.push({ o: b, repel: false });
      }
    }
  }

  // Sabit mıknatıslar: menzildeki oyuncuyu kutbuna göre çeker ya da iter. Kontrolü azaltmaz
  // (tavanda asılıyken yürünebilsin). Değdiği mıknatısa çekiliyorsa ona tutunmuş sayılır: zıplayabilir.
  applyFixed(dt) {
    if (!this.fixed.length) return;
    for (const p of this.players) this.applyFixedTo(p, dt);
  }

  applyFixedTo(p, dt) {
    const ph = PHYS, R = ph.fixedRange;
    p.fixedOn = [];
    p.wallSide = 0;
    if (p.inExit) return;
    const px = p.x + p.w / 2, py = p.y + p.h / 2;
    let ax = 0, ay = 0;
    for (const f of this.fixed) {
      const dx = px - f.x, dy = py - f.y, d = Math.hypot(dx, dy) || 1;
      if (d > R) continue;
      const sign = f.pol === p.pol ? 1 : -1, a = ph.fixedForce * (1 - (d / R) ** 2) * sign;
      ax += dx / d * a; ay += dy / d * a;
      p.fixedOn.push(f);
      // Değiyor mu (kenar kenara)? Çekiliyorsa tutunur; yandaysa duvar zıplaması için tarafı
      const touchX = Math.abs(dx) <= T / 2 + p.w / 2 + 1 && Math.abs(dy) < T / 2 + p.h / 2 - 4;
      const touchY = Math.abs(dy) <= T / 2 + p.h / 2 + 1 && Math.abs(dx) < T / 2 + p.w / 2 - 4;
      if (sign < 0 && (touchX || touchY)) {
        p.gripT = 0.1;
        if (touchX && !touchY) p.wallSide = dx < 0 ? -1 : 1;   // duvar hangi yanda (duvardan uzaklaşma yönü)
      }
    }
    // Mıknatıslı duvara yapışıkken yalnızca duvara doğru çekilir: yavaşça kayar, zıpladıkça tırmanır
    if (p.wallSide) ay = 0;
    const am = Math.hypot(ax, ay);
    if (am > ph.fixedMax) { ax *= ph.fixedMax / am; ay *= ph.fixedMax / am; }
    p.vx += ax * dt;
    p.vy += ay * dt;
    if (p.wallSide && p.vy > ph.wallSlide) p.vy = ph.wallSlide;
    if (p.cut === false && ay < 0) p.cut = true;
  }

  // Şalter: yanında eylem tuşuna basınca kanalını açar ya da kapatır (aynı kanaldaki şalterler birlikte döner)
  flipLever(p) {
    if (this.predicting) return false;
    const lv = this.levers.find(l => overlap(grow(p, 6), l));
    if (!lv) return false;
    this.switches[lv.channel] = !this.switches[lv.channel];
    for (const l of this.levers) if (l.channel === lv.channel) l.flipT = this.t;
    this.fx('lever', lv.x + T / 2, lv.y + T * 0.6, { color: CHANNEL_COLORS[lv.channel], on: this.switches[lv.channel] });
    return true;
  }

  // Asansör: kanalı açıkken yukarı, kapalıyken aşağı gider; üstündekileri taşır, kimseyi ezmez
  updateLifts(dt) {
    const free = this.keys.filter(k => !k.used && !k.holder);
    const bodies = this.solids.filter(o => o.kind !== 'lift' && o.kind !== 'mover').concat(free);
    for (const L of this.lifts) {
      const target = this.channelOn(L.channel) ? L.topY : L.oy;
      const dy = Math.max(-PHYS.liftSpeed * dt, Math.min(PHYS.liftSpeed * dt, target - L.y));
      if (Math.abs(dy) < 0.01) { L.y = target; continue; }
      // Üstündekiler: asansöre basanlar ve onların üstündekiler
      const riders = new Set();
      let grew = true;
      while (grew) {
        grew = false;
        for (const b of bodies) {
          if (riders.has(b)) continue;
          const base = b.ground === L || riders.has(b.ground) ||
            (dy < 0 && overlap(b, { x: L.x, y: L.y + dy, w: L.w, h: L.h }));   // yükselirken çarptığı da kalkar
          if (base) { riders.add(b); grew = true; }
        }
      }
      const moved = [...riders];
      const ok = moved.every(b => !this.rectBlocked(b.x, b.y + dy, b.w, b.h)) &&
        !this.rectBlocked(L.x, L.y + dy, L.w, L.h) &&
        // Aşağı inerken altında biri varsa durur
        !(dy > 0 && bodies.some(b => !riders.has(b) && overlap(b, { x: L.x, y: L.y + dy, w: L.w, h: L.h })));
      if (!ok) continue;
      L.y += dy;
      for (const b of moved) b.y += dy;
    }
  }

  // Gezgin platform: iki ucu arasında gidip gelir, uçlarda biraz bekler. Üstündekiler yerçekimi adımında
  // zemin kayması (dx) ile taşınır; önüne çıkanı iter, itemezse (duvara sıkıştıracaksa) geri döner.
  updateMovers(dt) {
    const bodies = this.solids.filter(o => o.kind !== 'lift' && o.kind !== 'mover');
    for (const M of this.movers) {
      M.dx = 0;
      if (M.pause > 0) { M.pause -= dt; continue; }
      let dx = M.dir * PHYS.moverSpeed * dt;
      const end = M.dir > 0 ? M.maxX : M.minX;
      if ((M.dir > 0 && M.x + dx >= end) || (M.dir < 0 && M.x + dx <= end)) { dx = end - M.x; M.dir = -M.dir; M.pause = PHYS.moverPause; }
      const next = { x: M.x + dx, y: M.y, w: M.w, h: M.h };
      const pushed = bodies.filter(b => b.ground !== M && overlap(b, next));
      for (const b of pushed) this.moveX(b, dx > 0 ? next.x + next.w - b.x : next.x - (b.x + b.w));
      if (pushed.some(b => overlap(b, next))) { M.dir = -M.dir; M.pause = 0.2; continue; }
      M.x += dx;
      M.dx = dx;
    }
  }

  // Yay: üstüne basanı yukarı fırlatır. Zıplama tuşu basılıysa daha yükseğe.
  updateSprings(players = this.players) {
    for (const s of this.springs) {
      const pad = { x: s.x, y: s.y - 2, w: s.w, h: s.h + 2 };
      for (const p of players) {
        if (p.inExit || !p.onGround || p.vy < 0 || !overlap(p, pad)) continue;
        p.vy = -PHYS.springV * (p.prevJump ? PHYS.springBoost : 1);
        // Artık havada: sonraki karede normal zıplama yayın hızını ezmesin
        p.cut = true; p.coyote = 0; p.jumpBuf = 0; p.onGround = false; p.supported = false; p.ground = null;
        p.squash = -0.3;
        s.t = this.t;
        this.fx('spring', s.x + s.w / 2, s.y);
      }
    }
  }

  // Vida: herhangi bir oyuncu değince toplanır (bölümü bitirmek için gerekmez)
  updateScrews() {
    for (const s of this.screws) {
      if (s.got) continue;
      if (this.players.some(p => !p.inExit && overlap(grow(p, 2), s))) {
        s.got = true;
        this.fx('screw', s.x + s.w / 2, s.y + s.h / 2);
      }
    }
  }

  // Toplanan vidalar bit maskesi olarak (1. vida = 1, 2. = 2, 3. = 4)
  get screwMask() { return this.screws.reduce((m, s, i) => (s.got ? m | (1 << i) : m), 0); }

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
      const carry = k.ground && (k.ground.kind === 'mover' || this.solids.includes(k.ground)) ? k.ground.dx || 0 : 0;
      k.onGround = false;
      k.ground = null;
      this.moveX(k, k.vx * dt + carry);
      this.moveY(k, k.vy * dt);
      for (const s of this.springs) {
        if (k.onGround && overlap(k, { x: s.x, y: s.y - 2, w: s.w, h: s.h + 2 })) { k.vy = -PHYS.springV * 0.9; s.t = this.t; }
      }
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
    if (this.predicting) return;
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
      const want = this.channelOn(g.channel) !== !!g.inverse;
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

  // Çukura düşen, en son sağlam zeminde durduğu yerde doğar (arkadaşının yanında doğsaydı
  // biri karşıya geçince öbürü kendini çukura atıp geçebilirdi). Orası doluysa biraz üstünde.
  respawn(p) {
    const at = p.safe || { x: this.spawn.x + 3, y: this.spawn.y + T - p.h };
    p.x = at.x;
    p.y = at.y;
    while (this.solids.some(o => o !== p && overlap(p, o)) && p.y > 0) p.y -= T / 2;
    p.vx = p.vy = 0;
    this.fx('respawn', p.x + p.w / 2, p.y + p.h / 2, { color: PLAYER_COLORS[p.index] });
  }

  get inExitCount() { return this.players.filter(p => p.inExit).length; }
}
