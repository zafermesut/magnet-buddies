'use strict';

// Oyun simülasyonu: fizik, çarpışmalar, toz, diken, fırtına ve bot zekâsı.
// Çizimden bağımsızdır; ileride aynen sunucuda (Node.js) çalıştırılabilir.

const BOT_NAMES = [
  'Tesla', 'Neodim', 'Ferro', 'Pusula', 'Bobin', 'Volt', 'Amper', 'Gauss',
  'Faraday', 'Demirci', 'Elektron', 'Proton', 'Manyetar', 'Dinamo', 'Ohm',
  'Kuzey', 'Güney', 'Toz Avcısı', 'Sarmal', 'Kıvılcım', 'Alan Çizgisi',
  'Kutupçu', 'Nikel', 'Kobalt', 'Hematit', 'Manyetit', 'Akım', 'Rezistans',
  'Kondansatör', 'Solenoid', 'Ferrit', 'Torik', 'Zıtlık', 'Çekim', 'İtici',
];

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function radiusOf(mass) { return 4 + 5 * Math.sqrt(mass); }
function chargeOf(mass) { return Math.pow(mass, 0.7); }
function rangeOf(ra, rb) { return Math.max(CONFIG.minRange, CONFIG.rangeMul * (ra + rb)); }

class Magnet {
  constructor(id, name, isBot, x, y, mass) {
    this.id = id;
    this.name = name;
    this.isBot = isBot;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.ax = 0; this.ay = 0;
    this.mass = mass;
    this.maxMass = mass;
    this.alive = true;
    this.pol = Math.random() < 0.5 ? 1 : -1;   // +1 = Artı (kırmızı), -1 = Eksi (mavi)
    this.switchCD = 0;
    this.neutralT = 0;
    this.dashCD = 0;
    this.dashT = 0;
    this.spikeImmune = 0;
    this.aimX = x; this.aimY = y;
    this.throttle = 0;
    this.frags = 0;
    this.lastHitBy = null;
    this.lastHitT = -99;
    this.locked = false;
    this.boosted = false;
    this.bornT = 0;
    // bot durumu
    this.skill = rand(0.35, 0.95);
    this.thinkT = 0;
    this.wander = null;
  }
  get r() { return radiusOf(this.mass); }
  // Nötr geçişteyken kuvvet uygulamaz/almaz
  get sign() { return this.neutralT > 0 ? 0 : this.pol; }
  get maxSpeed() { return CONFIG.baseSpeed * Math.pow(CONFIG.startMass / this.mass, 0.2); }
}

class Game {
  constructor(playerName, spectator = false) {
    this.t = 0;
    this.nextId = 1;
    this.magnets = [];
    this.dust = [];
    this.spikes = [];
    this.storms = [];
    this.effects = [];
    this.feed = [];
    this.links = [];
    this.respawnQueue = [];
    this.stormTimer = CONFIG.stormEvery * 0.4;
    this.botTarget = Math.round(CONFIG.botCount);

    this.genSpikes();
    for (let i = 0; i < CONFIG.dustCount; i++) this.spawnDust();

    const names = shuffle(BOT_NAMES.slice());
    for (let i = 0; i < this.botTarget; i++) this.addMagnet(names[i % names.length], true);
    this.player = spectator ? null : this.addMagnet(playerName || 'Sen', false);
  }

  // ---------- Kurulum ----------

  randomPoint(margin) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * (CONFIG.arenaRadius - margin);
    return { x: Math.cos(a) * d, y: Math.sin(a) * d };
  }

  safePoint(r) {
    for (let k = 0; k < 40; k++) {
      const p = this.randomPoint(300);
      if (this.spikes.some(s => Math.hypot(p.x - s.x, p.y - s.y) < s.r + r + 150)) continue;
      if (this.magnets.some(m => m.alive && Math.hypot(p.x - m.x, p.y - m.y) < rangeOf(m.r, r) + 50)) continue;
      return p;
    }
    return this.randomPoint(300);
  }

  genSpikes() {
    const R = CONFIG.arenaRadius;
    for (let i = 0; i < CONFIG.spikeCount; i++) {
      for (let k = 0; k < 50; k++) {
        const p = this.randomPoint(120);
        if (Math.hypot(p.x, p.y) < 250) continue;
        if (this.spikes.some(s => Math.hypot(p.x - s.x, p.y - s.y) < 380)) continue;
        this.spikes.push({ x: p.x, y: p.y, r: rand(26, 42), rot: rand(0, 6.28), spin: rand(-0.6, 0.6) });
        break;
      }
    }
    // Kenara yakın birkaç diken daha: itme taktikleri için
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2, d = R - rand(150, 260);
      this.spikes.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: rand(26, 36), rot: 0, spin: rand(-0.6, 0.6) });
    }
  }

  spawnDust(x, y, vx = 0, vy = 0, v = 1) {
    if (x === undefined) {
      const p = this.randomPoint(30);
      x = p.x; y = p.y;
    }
    this.dust.push({ x, y, vx, vy, v, dead: false });
  }

  burstDust(x, y, amount, r) {
    const n = clamp(Math.round(amount / 1.5), 3, 50);
    const v = amount / n;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(150, 480);
      this.spawnDust(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, Math.cos(a) * s, Math.sin(a) * s, v);
    }
  }

  addMagnet(name, isBot) {
    const mass = isBot ? CONFIG.startMass * rand(1, 3.5) : CONFIG.startMass;
    const p = this.safePoint(radiusOf(mass));
    const m = new Magnet(this.nextId++, name, isBot, p.x, p.y, mass);
    m.bornT = this.t;
    m.spikeImmune = 1.5;
    this.magnets.push(m);
    return m;
  }

  effect(type, x, y, r, col) {
    this.effects.push({ type, x, y, r, col, t: 0, life: type === 'boom' ? 0.7 : 0.4 });
  }

  // ---------- Aksiyonlar ----------

  switchPolarity(m) {
    if (!m.alive || m.switchCD > 0 || m.locked) return false;
    m.pol = -m.pol;
    m.neutralT = CONFIG.switchNeutral;
    m.switchCD = CONFIG.switchCooldown;
    this.effect('pulse', m.x, m.y, m.r, m.pol > 0 ? 'red' : 'blue');
    return true;
  }

  dash(m) {
    if (!m.alive || m.dashCD > 0) return false;
    let dx = m.aimX - m.x, dy = m.aimY - m.y, d = Math.hypot(dx, dy);
    if (d < 1) { dx = m.vx; dy = m.vy; d = Math.hypot(dx, dy) || 1; }
    const s = CONFIG.dashSpeed * Math.pow(CONFIG.startMass / m.mass, 0.12);
    m.vx = dx / d * s;
    m.vy = dy / d * s;
    m.dashT = 0.25;
    m.dashCD = CONFIG.dashCooldown;
    return true;
  }

  recentHitter(m) {
    const h = m.lastHitBy;
    if (h && h !== m && h.alive && this.t - m.lastHitT < 3) return h;
    return null;
  }

  kill(m, killer, cause) {
    if (!m.alive) return;
    m.alive = false;
    m.deathCause = cause;
    m.killer = killer;
    m.deathT = this.t;
    if (cause === 'spike') this.burstDust(m.x, m.y, m.mass * 0.6, m.r);
    if (killer) {
      killer.frags++;
      if (cause !== 'eat') killer.mass += CONFIG.fragBonus;
    }
    this.effect('boom', m.x, m.y, m.r, m.pol > 0 ? 'red' : 'blue');

    const verb = { eat: 'yuttu', spike: 'dikene itti', void: 'boşluğa itti' }[cause];
    const self = { spike: 'dikene çarptı', void: 'boşluğa düştü' }[cause];
    const text = killer ? `${killer.name} ▸ ${m.name} · ${verb}` : `${m.name} · ${self}`;
    const mine = !!this.player && (m === this.player || killer === this.player);
    this.feed.push({ text, t: this.t, mine });
    if (this.feed.length > 6) this.feed.shift();

    if (m.isBot) this.respawnQueue.push({ name: m.name, t: this.t + rand(2, 5) });
  }

  hitSpike(m, s, nx, ny) {
    const killer = this.recentHitter(m);
    if (m.mass < CONFIG.spikeKillBelow) { this.kill(m, killer, 'spike'); return; }
    const lost = m.mass * CONFIG.spikeMassLoss;
    m.mass -= lost;
    this.burstDust(m.x, m.y, lost, m.r);
    m.vx = nx * 520; m.vy = ny * 520;
    m.spikeImmune = 0.8;
    this.effect('boom', m.x, m.y, m.r * 0.7, 'spike');
  }

  // ---------- Simülasyon ----------

  step(dt) {
    const C = CONFIG;
    this.t += dt;
    const ms = this.magnets;

    this.updateStorms(dt);
    for (const s of this.spikes) s.rot += s.spin * dt;

    // Sayaçlar, bölgeler, yönlendirme
    for (const m of ms) {
      if (!m.alive) continue;
      m.switchCD = Math.max(0, m.switchCD - dt);
      m.neutralT = Math.max(0, m.neutralT - dt);
      m.dashCD = Math.max(0, m.dashCD - dt);
      m.dashT = Math.max(0, m.dashT - dt);
      m.spikeImmune = Math.max(0, m.spikeImmune - dt);

      m.locked = false; m.boosted = false;
      for (const z of this.storms) {
        if (!z.active) continue;
        if ((m.x - z.x) ** 2 + (m.y - z.y) ** 2 < z.r * z.r) {
          if (z.type === 'lock') m.locked = true; else m.boosted = true;
        }
      }

      if (m.isBot) this.botThink(m, dt);

      if (m.dashT <= 0) {
        const dx = m.aimX - m.x, dy = m.aimY - m.y, d = Math.hypot(dx, dy) || 1;
        const sp = m.maxSpeed * m.throttle;
        const k = Math.min(1, C.steer * dt);
        m.vx += (dx / d * sp - m.vx) * k;
        m.vy += (dy / d * sp - m.vy) * k;
      }
      m.ax = 0; m.ay = 0;
    }

    // Manyetik kuvvetler: aynı kutup iter, zıt kutup çeker
    this.links.length = 0;
    for (let i = 0; i < ms.length; i++) {
      const a = ms[i];
      if (!a.alive || a.sign === 0) continue;
      for (let j = i + 1; j < ms.length; j++) {
        const b = ms[j];
        if (!b.alive || b.sign === 0) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const ra = a.r, rb = b.r;
        const range = rangeOf(ra, rb);
        if (d > range) continue;
        const dd = Math.max(d, (ra + rb) * 0.9) / 100;
        const q = d / range;
        let F = C.forceK * chargeOf(a.mass) * chargeOf(b.mass) / (dd * dd) * (1 - q * q);
        if (a.boosted || b.boosted) F *= 2;
        const s = a.sign * b.sign;   // +1 itme, -1 çekme
        const nx = dx / d, ny = dy / d;
        const accA = Math.min(F / a.mass, C.maxMagAccel);
        const accB = Math.min(F / b.mass, C.maxMagAccel);
        a.ax -= nx * accA * s; a.ay -= ny * accA * s;
        b.ax += nx * accB * s; b.ay += ny * accB * s;
        // Kim kimi savurdu? Diken/boşluk frag'ı için kayıt
        if (accB > 150) { b.lastHitBy = a; b.lastHitT = this.t; }
        if (accA > 150) { a.lastHitBy = b; a.lastHitT = this.t; }
        this.links.push({ a, b, s, k: clamp(Math.max(accA, accB) / 900, 0, 1) });
      }
    }

    // Hareket
    for (const m of ms) {
      if (!m.alive) continue;
      m.vx += m.ax * dt; m.vy += m.ay * dt;
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.mass > C.decayAbove) m.mass -= (m.mass - C.decayAbove) * C.decayRate * dt;
    }

    // Mıknatıs-mıknatıs çarpışma ve yutma
    for (let i = 0; i < ms.length; i++) {
      const a = ms[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < ms.length; j++) {
        if (!a.alive) break;
        const b = ms[j];
        if (!b.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const ra = a.r, rb = b.r;
        if (d >= ra + rb) continue;
        const big = a.mass >= b.mass ? a : b, small = big === a ? b : a;
        if (big.mass >= C.eatRatio * small.mass) {
          // Yeterince büyükse küçük olan içine girebilir; derin girince yutulur
          if (d < big.r - small.r * 0.35 && small.spikeImmune <= 0) {
            big.mass += small.mass * C.eatGain;
            this.kill(small, big, 'eat');
          }
          continue;
        }
        // Benzer boyutlar: sekerek ayrılır
        const nx = dx / d, ny = dy / d, overlap = ra + rb - d, tot = a.mass + b.mass;
        a.x -= nx * overlap * (b.mass / tot); a.y -= ny * overlap * (b.mass / tot);
        b.x += nx * overlap * (a.mass / tot); b.y += ny * overlap * (a.mass / tot);
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          const imp = -1.6 * rel / (1 / a.mass + 1 / b.mass);
          a.vx -= imp * nx / a.mass; a.vy -= imp * ny / a.mass;
          b.vx += imp * nx / b.mass; b.vy += imp * ny / b.mass;
          if (-rel > 120) {
            a.lastHitBy = b; a.lastHitT = this.t;
            b.lastHitBy = a; b.lastHitT = this.t;
          }
        }
      }
    }

    // Diken ve boşluk
    for (const m of ms) {
      if (!m.alive) continue;
      for (const s of this.spikes) {
        const dx = m.x - s.x, dy = m.y - s.y, d = Math.hypot(dx, dy) || 1;
        const lim = m.r + s.r * 0.75;
        if (d < lim) {
          const nx = dx / d, ny = dy / d;
          m.x = s.x + nx * lim; m.y = s.y + ny * lim;
          if (m.spikeImmune <= 0) this.hitSpike(m, s, nx, ny);
          if (!m.alive) break;
        }
      }
      if (m.alive && Math.hypot(m.x, m.y) > C.arenaRadius + m.r * 0.3) {
        this.kill(m, this.recentHitter(m), 'void');
      }
      if (m.alive) m.maxMass = Math.max(m.maxMass, m.mass);
    }

    this.updateDust(dt);

    // Efektler
    for (const e of this.effects) e.t += dt;
    this.effects = this.effects.filter(e => e.t < e.life);

    // Ölüleri temizle (oyuncu nesnesi referans olarak kalır)
    if (ms.some(m => !m.alive)) this.magnets = ms.filter(m => m.alive);

    // Bot yeniden doğma
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const q = this.respawnQueue[i];
      if (this.t >= q.t) {
        this.respawnQueue.splice(i, 1);
        if (this.magnets.filter(m => m.isBot).length < this.botTarget) this.addMagnet(q.name, true);
      }
    }
  }

  updateDust(dt) {
    const C = CONFIG, ms = this.magnets;
    const damp = Math.pow(0.08, dt);
    const R2 = (C.arenaRadius + 10) ** 2;
    for (const p of this.dust) {
      for (const m of ms) {
        if (!m.alive) continue;
        const pull = m.r * 3 + 80;
        const dx = m.x - p.x, dy = m.y - p.y;
        if (dx > pull || dx < -pull || dy > pull || dy < -pull) continue;
        const d = Math.hypot(dx, dy) || 0.001;
        if (d < m.r) { m.mass += p.v; p.dead = true; break; }
        if (d < pull) {
          // Nötr metal her iki kutba da çekilir
          const acc = 250 + 1400 * (1 - d / pull);
          p.vx += dx / d * acc * dt;
          p.vy += dy / d * acc * dt;
        }
      }
      p.vx *= damp; p.vy *= damp;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x * p.x + p.y * p.y > R2) p.dead = true;
    }
    this.dust = this.dust.filter(p => !p.dead);
    // Toz yavaşça yeniden doğar (haritayı kütleyle boğmamak için)
    this.dustAcc = (this.dustAcc || 0) + C.dustRespawn * dt;
    while (this.dustAcc >= 1) {
      this.dustAcc -= 1;
      if (this.dust.length < C.dustCount) this.spawnDust();
    }
  }

  updateStorms(dt) {
    const C = CONFIG;
    this.stormTimer -= dt;
    if (this.stormTimer <= 0) {
      this.stormTimer = C.stormEvery;
      const p = this.randomPoint(450);
      this.storms.push({
        x: p.x, y: p.y, r: C.stormRadius * rand(0.8, 1.25),
        type: Math.random() < 0.5 ? 'boost' : 'lock',
        t: 0, warn: 2.5, life: C.stormDuration, active: false,
      });
    }
    for (const z of this.storms) { z.t += dt; z.active = z.t > z.warn; }
    this.storms = this.storms.filter(z => z.t < z.warn + z.life);
  }

  leaderboard(n = 10) {
    return this.magnets.filter(m => m.alive).sort((a, b) => b.mass - a.mass).slice(0, n);
  }

  // ---------- Bot zekâsı ----------

  nearHazard(o) {
    if (Math.hypot(o.x, o.y) > CONFIG.arenaRadius - o.r - 260) return true;
    return this.spikes.some(s => Math.hypot(o.x - s.x, o.y - s.y) < o.r + s.r + 160);
  }

  findDust(b) {
    let best = null, bestD = 600 * 600;
    for (const p of this.dust) {
      const d = (p.x - b.x) ** 2 + (p.y - b.y) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  botThink(b, dt) {
    b.throttle = 1;
    b.thinkT -= dt;
    if (b.thinkT > 0) return;
    b.thinkT = rand(0.12, 0.28) + (1 - b.skill) * 0.25;   // tepki süresi
    const C = CONFIG;

    let threat = null, threatD = 1e9, prey = null, preyScore = 0, near = null, nearD = 1e9;
    for (const o of this.magnets) {
      if (!o.alive || o === b) continue;
      const d = Math.hypot(o.x - b.x, o.y - b.y);
      const range = rangeOf(o.r, b.r);
      if (d < range && d < nearD) { near = o; nearD = d; }
      if (o.mass >= b.mass * 1.1) {
        if (d < range * 1.15 && d < threatD) { threat = o; threatD = d; }
      } else if (b.mass >= o.mass * C.eatRatio * 1.05 && d < 650 + b.r) {
        const s = o.mass / (d + 50);
        if (s > preyScore) { preyScore = s; prey = o; }
      }
    }

    let vx = 0, vy = 0, wantPol = 0;
    if (threat) {
      // Kaç ve aynı kutba geç ki itsin
      vx += (b.x - threat.x) / threatD * 2;
      vy += (b.y - threat.y) / threatD * 2;
      wantPol = threat.pol;
    } else if (prey) {
      // Kovala ve zıt kutba geç ki çeksin
      const d = Math.hypot(prey.x - b.x, prey.y - b.y) || 1;
      vx += (prey.x - b.x) / d * 1.6;
      vy += (prey.y - b.y) / d * 1.6;
      wantPol = -prey.pol;
    } else {
      const p = this.findDust(b);
      if (p) {
        const d = Math.hypot(p.x - b.x, p.y - b.y) || 1;
        vx += (p.x - b.x) / d; vy += (p.y - b.y) / d;
      } else {
        if (!b.wander || Math.hypot(b.wander.x - b.x, b.wander.y - b.y) < 150) b.wander = this.randomPoint(400);
        const d = Math.hypot(b.wander.x - b.x, b.wander.y - b.y) || 1;
        vx += (b.wander.x - b.x) / d; vy += (b.wander.y - b.y) / d;
      }
      if (near) {
        wantPol = near.pol;   // varsayılan: mesafe koru
        // Fırsat: tehlikeye yakın rakibi it
        if (b.mass > near.mass * 0.7 && b.skill > 0.55 && this.nearHazard(near)) {
          vx += (near.x - b.x) / nearD * 1.5;
          vy += (near.y - b.y) / nearD * 1.5;
        }
      }
    }

    // Kenardan ve dikenlerden kaçın
    const dc = Math.hypot(b.x, b.y) || 1;
    const edge = C.arenaRadius - b.r - 280;
    if (dc > edge) {
      const w = (dc - edge) / 150 * 2.5;
      vx -= b.x / dc * w; vy -= b.y / dc * w;
    }
    for (const s of this.spikes) {
      const dx = b.x - s.x, dy = b.y - s.y, d = Math.hypot(dx, dy) || 1;
      const gap = d - s.r - b.r;
      if (gap < 140) {
        const w = (140 - gap) / 140 * 3;
        vx += dx / d * w; vy += dy / d * w;
      }
    }

    const len = Math.hypot(vx, vy);
    if (len > 0.01) { b.aimX = b.x + vx / len * 300; b.aimY = b.y + vy / len * 300; }

    if (wantPol && wantPol !== b.pol && Math.random() < 0.35 + b.skill * 0.65) this.switchPolarity(b);

    if (threat && threatD < b.r + threat.r + 90 && Math.random() < b.skill * 0.5) this.dash(b);
    else if (prey && b.pol === -prey.pol && Math.hypot(prey.x - b.x, prey.y - b.y) < b.r + prey.r + 130 &&
      Math.random() < b.skill * 0.3) this.dash(b);
  }
}
