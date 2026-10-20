'use strict';

// Oyun simülasyonu: fizik, çarpışmalar, demir tozu, saçma, diken, fırtına ve bot zekâsı.
// Çizimden bağımsızdır; ileride aynen sunucuda (Node.js) çalıştırılabilir.
//
// Kurallar: kimse kimseyi yutmaz. Rakip yalnızca dikene ya da arena dışındaki boşluğa
// itilerek elenir. Toplanan demir tozu mıknatısın etrafında döner: ağırlık, zırh ve cephanedir.

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
  constructor(id, name, isBot, x, y, ammo) {
    this.id = id;
    this.name = name;
    this.isBot = isBot;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.ax = 0; this.ay = 0;
    this.ammo = ammo;
    this.maxAmmo = ammo;
    this.alive = true;
    this.pol = Math.random() < 0.5 ? 1 : -1;   // +1 = Artı (kırmızı), -1 = Eksi (mavi)
    this.polT = -99;                           // son kutup değişim zamanı
    this.switchCD = 0;
    this.neutralT = 0;
    this.blastCD = 0;
    this.spikeImmune = 0;
    this.stunT = 0;
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
    this.reactJitter = rand(0.75, 1.3);
    this.thinkT = 0;
    this.wander = null;
  }
  get mass() { return CONFIG.coreMass + this.ammo * CONFIG.ammoWeight; }
  get r() { return radiusOf(this.mass); }
  // Nötr geçişteyken kuvvet uygulamaz/almaz
  get sign() { return this.neutralT > 0 ? 0 : this.pol; }
  get maxSpeed() { return CONFIG.baseSpeed * Math.pow(CONFIG.coreMass / this.mass, 0.25); }
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
    this.dustAcc = 0;
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

  // Serbest demir tozu. hot > 0 iken fırlatılmış mermidir; cool > 0 iken toplanamaz.
  spawnDust(x, y, vx = 0, vy = 0, cool = 0) {
    if (x === undefined) {
      const p = this.randomPoint(30);
      x = p.x; y = p.y;
    }
    this.dust.push({ x, y, vx, vy, cool, hot: 0, owner: null, dead: false });
  }

  burstDust(x, y, n, r) {
    n = Math.min(Math.round(n), 70);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(150, 480);
      this.spawnDust(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8, Math.cos(a) * s, Math.sin(a) * s, 0.35);
    }
  }

  addMagnet(name, isBot) {
    const ammo = isBot ? Math.round(rand(0, 30)) : CONFIG.startAmmo;
    const p = this.safePoint(radiusOf(CONFIG.coreMass + ammo * CONFIG.ammoWeight));
    const m = new Magnet(this.nextId++, name, isBot, p.x, p.y, ammo);
    m.bornT = this.t;
    m.spikeImmune = 1.5;
    this.magnets.push(m);
    return m;
  }

  effect(type, x, y, r, col, ang = 0) {
    this.effects.push({ type, x, y, r, col, ang, t: 0, life: type === 'boom' ? 0.7 : type === 'blast' ? 0.25 : 0.4 });
  }

  // ---------- Aksiyonlar ----------

  switchPolarity(m) {
    if (!m.alive || m.switchCD > 0 || m.locked) return false;
    m.pol = -m.pol;
    m.polT = this.t;
    m.neutralT = CONFIG.switchNeutral;
    m.switchCD = CONFIG.switchCooldown;
    this.effect('pulse', m.x, m.y, m.r, m.pol > 0 ? 'red' : 'blue');
    return true;
  }

  // Demir saçması: bulutun bir kısmını hedefe doğru koni şeklinde fırlatır.
  blast(m, tx = m.aimX, ty = m.aimY) {
    const C = CONFIG;
    if (!m.alive || m.blastCD > 0 || m.ammo <= 0) return false;
    let dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy);
    if (d < 1) { dx = 1; dy = 0; d = 1; }
    const a0 = Math.atan2(dy, dx);
    const n = Math.min(m.ammo, C.blastCount);
    m.ammo -= n;
    for (let i = 0; i < n; i++) {
      const a = a0 + (n > 1 ? (i / (n - 1) - 0.5) * 2 * C.blastSpread : 0) + rand(-0.05, 0.05);
      const s = C.blastSpeed * rand(0.85, 1.1);
      this.dust.push({
        x: m.x + Math.cos(a) * (m.r + 4), y: m.y + Math.sin(a) * (m.r + 4),
        vx: Math.cos(a) * s + m.vx * 0.5, vy: Math.sin(a) * s + m.vy * 0.5,
        cool: 0, hot: C.hotTime, owner: m, dead: false,
      });
    }
    const rec = C.blastRecoil * C.coreMass / m.mass;
    m.vx -= dx / d * rec;
    m.vy -= dy / d * rec;
    m.blastCD = C.blastCooldown;
    this.effect('blast', m.x, m.y, m.r, m.pol > 0 ? 'red' : 'blue', a0);
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
    if (cause === 'spike') this.burstDust(m.x, m.y, m.ammo + 6, m.r);
    if (killer) killer.frags++;
    this.effect('boom', m.x, m.y, m.r, m.pol > 0 ? 'red' : 'blue');

    const verb = { spike: 'dikene itti', void: 'boşluğa itti' }[cause];
    const self = { spike: 'dikene çarptı', void: 'boşluğa düştü' }[cause];
    const text = killer ? `${killer.name} ▸ ${m.name} · ${verb}` : `${m.name} · ${self}`;
    const mine = !!this.player && (m === this.player || killer === this.player);
    this.feed.push({ text, t: this.t, mine });
    if (this.feed.length > 6) this.feed.shift();

    if (m.isBot) this.respawnQueue.push({ name: m.name, t: this.t + rand(2, 5) });
  }

  // Yeterli demiri olan zırhı sayesinde hayatta kalır ama demirinin bir kısmını saçar.
  hitSpike(m, s, nx, ny) {
    const C = CONFIG;
    if (m.ammo < C.spikeArmor) { this.kill(m, this.recentHitter(m), 'spike'); return; }
    const lost = Math.max(C.spikeArmor, Math.round(m.ammo * C.spikeAmmoLoss));
    m.ammo -= lost;
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
      m.blastCD = Math.max(0, m.blastCD - dt);
      m.spikeImmune = Math.max(0, m.spikeImmune - dt);
      m.stunT = Math.max(0, m.stunT - dt);

      m.locked = false; m.boosted = false;
      for (const z of this.storms) {
        if (!z.active) continue;
        if ((m.x - z.x) ** 2 + (m.y - z.y) ** 2 < z.r * z.r) {
          if (z.type === 'lock') m.locked = true; else m.boosted = true;
        }
      }

      if (m.isBot) this.botThink(m, dt);

      const dx = m.aimX - m.x, dy = m.aimY - m.y, d = Math.hypot(dx, dy) || 1;
      const sp = m.maxSpeed * m.throttle;
      let k = Math.min(1, C.steer * dt);
      // Savrulurken kontrol azalır: darbelerin momentumu hissedilsin
      if (m.stunT > 0) k *= 0.12;
      else if (Math.hypot(m.vx, m.vy) > m.maxSpeed * 1.25) k *= 0.3;
      m.vx += (dx / d * sp - m.vx) * k;
      m.vy += (dy / d * sp - m.vy) * k;
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
        const ma = a.mass, mb = b.mass;
        let F = C.forceK * chargeOf(ma) * chargeOf(mb) / (dd * dd) * (1 - q * q);
        if (a.boosted || b.boosted) F *= 2;
        const s = a.sign * b.sign;   // +1 itme, -1 çekme
        // Zıt kutuplar temasa yaklaştıkça çekim söner: çekip savurabilirsin ama yapışamazsın
        if (s < 0) F *= clamp((d - (ra + rb)) / ((ra + rb) * 0.9), 0, 1);
        const nx = dx / d, ny = dy / d;
        const accA = Math.min(F / ma, C.maxMagAccel);
        const accB = Math.min(F / mb, C.maxMagAccel);
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
    }

    // Mıknatıs-mıknatıs çarpışma: sumo gibi seker
    for (let i = 0; i < ms.length; i++) {
      const a = ms[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < ms.length; j++) {
        const b = ms[j];
        if (!b.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const ra = a.r, rb = b.r;
        if (d >= ra + rb) continue;
        const ma = a.mass, mb = b.mass;
        const nx = dx / d, ny = dy / d, overlap = ra + rb - d, tot = ma + mb;
        a.x -= nx * overlap * (mb / tot); a.y -= ny * overlap * (mb / tot);
        b.x += nx * overlap * (ma / tot); b.y += ny * overlap * (ma / tot);
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          const imp = -(1 + C.bounce) * rel / (1 / ma + 1 / mb);
          a.vx -= imp * nx / ma; a.vy -= imp * ny / ma;
          b.vx += imp * nx / mb; b.vy += imp * ny / mb;
          if (-rel > 100) {
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
      if (m.alive) m.maxAmmo = Math.max(m.maxAmmo, m.ammo);
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
    const damp = Math.pow(0.08, dt), hotDamp = Math.pow(0.5, dt);
    const R2 = (C.arenaRadius + 10) ** 2;
    for (const p of this.dust) {
      if (p.hot > 0) {
        // Mermi: sahibi dışındaki ilk mıknatısa çarpar, savurur ve zırhından demir koparır
        p.hot -= dt;
        for (const m of ms) {
          if (m === p.owner || !m.alive) continue;
          const dx = m.x - p.x, dy = m.y - p.y, lim = m.r + 4;
          if (dx > lim || dx < -lim || dy > lim || dy < -lim || dx * dx + dy * dy > lim * lim) continue;
          const sp = Math.hypot(p.vx, p.vy) || 1;
          const k = C.blastImpulse * C.coreMass / m.mass;
          m.vx += p.vx / sp * k;
          m.vy += p.vy / sp * k;
          m.stunT = C.stunTime;
          if (p.owner && p.owner.alive) { m.lastHitBy = p.owner; m.lastHitT = this.t; }
          if (m.ammo > 0) {
            m.ammo--;
            const a = Math.random() * Math.PI * 2;
            this.spawnDust(m.x + Math.cos(a) * m.r, m.y + Math.sin(a) * m.r, Math.cos(a) * 250, Math.sin(a) * 250, 0.4);
          }
          p.vx *= 0.15; p.vy *= 0.15;
          p.hot = 0;
          p.cool = 0.3;
          break;
        }
        p.vx *= hotDamp; p.vy *= hotDamp;
      } else {
        if (p.cool > 0) p.cool -= dt;
        else {
          for (const m of ms) {
            if (!m.alive || m.ammo >= C.ammoCap) continue;
            const pull = m.r * 3 + 90;
            const dx = m.x - p.x, dy = m.y - p.y;
            if (dx > pull || dx < -pull || dy > pull || dy < -pull) continue;
            const d = Math.hypot(dx, dy) || 0.001;
            if (d < m.r + 6) { m.ammo++; p.dead = true; break; }
            if (d < pull) {
              // Nötr demir her iki kutba da çekilir
              const acc = 250 + 1400 * (1 - d / pull);
              p.vx += dx / d * acc * dt;
              p.vy += dy / d * acc * dt;
            }
          }
        }
        p.vx *= damp; p.vy *= damp;
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x * p.x + p.y * p.y > R2) p.dead = true;
    }
    this.dust = this.dust.filter(p => !p.dead);

    // Toz yavaşça yeniden doğar
    this.dustAcc += C.dustRespawn * dt;
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
    return this.magnets.filter(m => m.alive)
      .sort((a, b) => b.frags - a.frags || b.ammo - a.ammo)
      .slice(0, n);
  }

  // ---------- Bot zekâsı ----------

  // Bir mıknatısa en yakın tehlike noktası (arena kenarı ya da diken) ve aradaki boşluk
  hazardOf(o) {
    const R = CONFIG.arenaRadius, dc = Math.hypot(o.x, o.y) || 1;
    let best = { x: o.x / dc * R, y: o.y / dc * R, d: R - dc - o.r };
    for (const s of this.spikes) {
      const d = Math.hypot(o.x - s.x, o.y - s.y) - s.r - o.r;
      if (d < best.d) best = { x: s.x, y: s.y, d };
    }
    return best;
  }

  findDust(b) {
    let best = null, bestD = 700 * 700;
    for (const p of this.dust) {
      if (p.hot > 0) continue;
      const d = (p.x - b.x) ** 2 + (p.y - b.y) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  // Bot, başkasının kutup değişimini ancak tepki süresi kadar sonra fark eder.
  // Böylece oyuncunun ani kutup değişimi gerçek bir avantaj sağlar.
  reactionOf(b) {
    return CONFIG.botReaction * b.reactJitter * (1.6 - b.skill);
  }

  seenPol(b, o) {
    return this.t - o.polT < this.reactionOf(b) ? -o.pol : o.pol;
  }

  botThink(b, dt) {
    b.throttle = 1;
    b.thinkT -= dt;
    if (b.thinkT > 0) return;
    b.thinkT = rand(0.12, 0.28) + (1 - b.skill) * 0.25;   // tepki süresi
    const C = CONFIG;

    // Çevredeki herkesin toplam etkisi: kalabalığın çoğunluğuyla aynı kutba geçen itilir.
    // Hedef olarak en yakın değil, tehlikeye en yakın (itilmeye en uygun) rakip seçilir.
    let enemy = null, ed = 1e9, bestScore = -1e9, polSum = 0, crowdX = 0, crowdY = 0, crowd = 0;
    for (const o of this.magnets) {
      if (!o.alive || o === b) continue;
      const d = Math.hypot(o.x - b.x, o.y - b.y) || 1;
      const range = rangeOf(o.r, b.r);
      if (d < range) {
        const w = chargeOf(o.mass) * (1 - d / range);
        polSum += this.seenPol(b, o) * w;
        crowdX += (o.x - b.x) / d * (1 - d / range);
        crowdY += (o.y - b.y) / d * (1 - d / range);
        crowd++;
      }
      if (d < 750) {
        const score = -d - this.hazardOf(o).d * 1.5;
        if (score > bestScore) { bestScore = score; enemy = o; ed = d; }
      }
    }
    const crowdPol = polSum > 0 ? 1 : polSum < 0 ? -1 : 0;
    const engaged = enemy && ed < rangeOf(enemy.r, b.r) * 1.2;
    const myHaz = this.hazardOf(b);

    let vx = 0, vy = 0, wantPol = 0, blastAt = null;

    if (engaged && myHaz.d < 220) {
      // Savunma: tehlikeden uzaklaş; kuvvet beni tehlikeden uzağa itsin
      const hx = myHaz.x - b.x, hy = myHaz.y - b.y, hl = Math.hypot(hx, hy) || 1;
      vx -= hx / hl * 2; vy -= hy / hl * 2;
      const onHazSide = ((enemy.x - b.x) * hx + (enemy.y - b.y) * hy) / (ed * hl) > 0;
      const sp = this.seenPol(b, enemy);
      wantPol = onHazSide ? sp : crowd > 1 ? crowdPol : -sp;   // tehlike tarafındaysa it, değilse ona doğru çek
      if (onHazSide) blastAt = enemy;
    } else if (enemy && b.ammo >= 8 && crowd <= 2) {
      // Saldırı: rakibin tehlikeye göre arkasına geç, aynı kutupla it, saçmayla vur
      const eh = this.hazardOf(enemy);
      const hx = eh.x - enemy.x, hy = eh.y - enemy.y, hl = Math.hypot(hx, hy) || 1;
      const gap = enemy.r + b.r + 110;
      const tx = enemy.x - hx / hl * gap, ty = enemy.y - hy / hl * gap;
      const dx = tx - b.x, dy = ty - b.y, dl = Math.hypot(dx, dy) || 1;
      vx += dx / dl * 1.6; vy += dy / dl * 1.6;
      const lined = ((enemy.x - b.x) * hx + (enemy.y - b.y) * hy) / (ed * hl) > 0.6;
      const sp = this.seenPol(b, enemy);
      if (lined) {
        wantPol = sp;
        if (eh.d < 500) blastAt = enemy;
      } else if (crowd) {
        wantPol = crowdPol;   // pozisyon alırken kimseye kapılma
      }
    } else {
      // Demir topla
      const p = this.findDust(b);
      if (p) {
        const d = Math.hypot(p.x - b.x, p.y - b.y) || 1;
        vx += (p.x - b.x) / d; vy += (p.y - b.y) / d;
      } else {
        if (!b.wander || Math.hypot(b.wander.x - b.x, b.wander.y - b.y) < 150) b.wander = this.randomPoint(400);
        const d = Math.hypot(b.wander.x - b.x, b.wander.y - b.y) || 1;
        vx += (b.wander.x - b.x) / d; vy += (b.wander.y - b.y) / d;
      }
      if (crowd) wantPol = crowdPol;
    }

    // Kalabalıktan uzaklaş: yumaklaşmayı önler
    if (crowd > 1) {
      vx -= crowdX * 1.2; vy -= crowdY * 1.2;
    }

    // Kenardan ve dikenlerden kaçın
    const dc = Math.hypot(b.x, b.y) || 1;
    const care = 0.4 + b.skill * 0.6;
    const edge = C.arenaRadius - b.r - 220 * care;
    if (dc > edge) {
      const w = (dc - edge) / 150 * 2.5 * care;
      vx -= b.x / dc * w; vy -= b.y / dc * w;
    }
    for (const s of this.spikes) {
      const dx = b.x - s.x, dy = b.y - s.y, d = Math.hypot(dx, dy) || 1;
      const gap = d - s.r - b.r;
      const zone = 110 * care;
      if (gap < zone) {
        const w = (zone - gap) / zone * 3 * care;
        vx += dx / d * w; vy += dy / d * w;
      }
    }

    const len = Math.hypot(vx, vy);
    if (len > 0.01) { b.aimX = b.x + vx / len * 300; b.aimY = b.y + vy / len * 300; }

    if (wantPol && wantPol !== b.pol && this.t - b.polT > C.botSwitchGap &&
      Math.random() < 0.35 + b.skill * 0.65) this.switchPolarity(b);

    if (blastAt && b.ammo >= 6 && Math.hypot(blastAt.x - b.x, blastAt.y - b.y) < 420 &&
      Math.random() < b.skill * 0.6) {
      this.blast(b, blastAt.x, blastAt.y);
    }
  }
}
