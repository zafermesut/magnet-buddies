'use strict';

// Oyun simülasyonu: gemiler, mermiler, emme, kuleler, enerji küreleri ve bot zekâsı.
// Çizimden bağımsızdır; ileride aynen sunucuda (Node.js) çalıştırılabilir.
//
// Kurallar: herkes kırmızı (+) ya da mavi (−) kutuptadır ve anında değiştirebilir.
// Kendi rengindeki mermiyi emer (enerji kazanır), zıt renk mermiden hasar alır.
// Ateş ettiğin mermi o anki rengini taşır: rakibi vurmak için onun zıt rengine geçmelisin,
// ama o zaman onun mermileri de sana işler.

const BOT_NAMES = [
  'Tesla', 'Neodim', 'Ferro', 'Pusula', 'Bobin', 'Volt', 'Amper', 'Gauss',
  'Faraday', 'Demirci', 'Elektron', 'Proton', 'Manyetar', 'Dinamo', 'Ohm',
  'Kuzey', 'Güney', 'Kıvılcım', 'Sarmal', 'Kutupçu', 'Nikel', 'Kobalt',
  'Hematit', 'Manyetit', 'Akım', 'Rezistans', 'Solenoid', 'Ferrit', 'Zıtlık', 'Prizma',
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

class Ship {
  constructor(id, name, isBot, x, y) {
    this.id = id;
    this.name = name;
    this.isBot = isBot;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.r = CONFIG.shipRadius;
    this.pol = Math.random() < 0.5 ? 1 : -1;   // +1 = kırmızı (+), -1 = mavi (−)
    this.polT = -99;                           // son renk değişim zamanı
    this.hp = CONFIG.maxHp;
    this.energy = CONFIG.startEnergy;
    this.switchCD = 0;
    this.fireCD = 0;
    this.firing = false;
    this.moveX = x; this.moveY = y;           // hareket hedefi
    this.aimX = x + 1; this.aimY = y;         // nişan noktası
    this.throttle = 0;
    this.frags = 0;
    this.score = 0;
    this.absorbed = 0;
    this.alive = true;
    this.lastHitBy = null;
    this.lastHitT = -99;
    this.lastDmgT = -99;
    this.lastAbsorbT = -99;
    this.spawnShield = 2;
    this.bornT = 0;
    // bot durumu
    this.skill = rand(0.35, 0.95);
    this.reactJitter = rand(0.75, 1.3);
    this.thinkT = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.wander = null;
  }
}

class Game {
  constructor(playerName, spectator = false) {
    this.t = 0;
    this.nextId = 1;
    this.ships = [];
    this.bullets = [];
    this.orbs = [];
    this.pylons = [];
    this.effects = [];
    this.feed = [];
    this.respawnQueue = [];
    this.orbAcc = 0;
    this.botTarget = Math.round(CONFIG.botCount);

    this.genPylons();
    for (let i = 0; i < CONFIG.orbCount; i++) this.spawnOrb();

    const names = shuffle(BOT_NAMES.slice());
    for (let i = 0; i < this.botTarget; i++) this.addShip(names[i % names.length], true);
    this.player = spectator ? null : this.addShip(playerName || 'Sen', false);
  }

  // ---------- Kurulum ----------

  randomPoint(margin) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * (CONFIG.arenaRadius - margin);
    return { x: Math.cos(a) * d, y: Math.sin(a) * d };
  }

  safePoint() {
    for (let k = 0; k < 40; k++) {
      const p = this.randomPoint(150);
      if (this.pylons.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 320)) continue;
      if (this.ships.some(s => s.alive && Math.hypot(p.x - s.x, p.y - s.y) < 450)) continue;
      return p;
    }
    return this.randomPoint(150);
  }

  genPylons() {
    const n = CONFIG.pylonCount;
    const R = CONFIG.arenaRadius;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + rand(-0.3, 0.3);
      const d = i === 0 ? 0 : R * rand(0.45, 0.65);
      this.pylons.push({
        x: Math.cos(a) * d, y: Math.sin(a) * d, r: 34,
        pol: Math.random() < 0.5 ? 1 : -1,
        ang: rand(0, 6.28), spin: rand(0.9, 1.4) * (Math.random() < 0.5 ? 1 : -1),
        flipT: rand(1, CONFIG.pylonFlipEvery), acc: 0,
      });
    }
  }

  spawnOrb(x, y, pol) {
    if (x === undefined) {
      const p = this.randomPoint(40);
      x = p.x; y = p.y;
    }
    const a = Math.random() * Math.PI * 2, s = rand(5, 25);
    this.orbs.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, pol: pol || (Math.random() < 0.5 ? 1 : -1), dead: false });
  }

  addShip(name, isBot) {
    const p = this.safePoint();
    const s = new Ship(this.nextId++, name, isBot, p.x, p.y);
    s.bornT = this.t;
    this.ships.push(s);
    return s;
  }

  effect(type, x, y, r, pol) {
    this.effects.push({ type, x, y, r, pol, t: 0, life: type === 'boom' ? 0.7 : type === 'absorb' ? 0.25 : 0.3 });
  }

  // ---------- Aksiyonlar ----------

  switchPolarity(s) {
    if (!s.alive || s.switchCD > 0) return false;
    s.pol = -s.pol;
    s.polT = this.t;
    s.switchCD = CONFIG.switchCooldown;
    this.effect('pulse', s.x, s.y, s.r, s.pol);
    return true;
  }

  shoot(s, angle, speed, life, dmg) {
    this.bullets.push({
      x: s.x + Math.cos(angle) * (s.r + 4), y: s.y + Math.sin(angle) * (s.r + 4),
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      pol: s.pol, owner: s, life, age: 0, dmg, dead: false,
    });
  }

  burst(s) {
    const C = CONFIG;
    if (!s.alive || s.energy < C.burstCost) return false;
    s.energy -= C.burstCost;
    for (let i = 0; i < C.burstCount; i++) {
      this.shoot(s, i / C.burstCount * Math.PI * 2, C.bulletSpeed * 0.85, C.bulletLife, C.bulletDamage);
    }
    this.effect('boom', s.x, s.y, s.r * 1.2, s.pol);
    return true;
  }

  damage(s, amount, by) {
    if (s.spawnShield > 0) return;
    s.hp -= amount;
    s.lastDmgT = this.t;
    if (by && by !== s && by instanceof Ship) { s.lastHitBy = by; s.lastHitT = this.t; }
    if (s.hp <= 0) this.kill(s, by);
  }

  kill(s, by) {
    if (!s.alive) return;
    s.alive = false;
    s.deathT = this.t;
    let killer = by instanceof Ship && by.alive && by !== s ? by : null;
    if (!killer && s.lastHitBy && s.lastHitBy.alive && this.t - s.lastHitT < 3) killer = s.lastHitBy;
    s.killer = killer;
    s.killedByPylon = !killer && by && !(by instanceof Ship);
    if (killer) { killer.frags++; killer.score += 50; }

    // Enerjisi küre olarak saçılır
    const n = 6 + Math.round(s.energy / 8);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = rand(0, 50);
      this.spawnOrb(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, i % 2 ? 1 : -1);
    }
    this.effect('boom', s.x, s.y, s.r, s.pol);

    const text = killer ? `${killer.name} ▸ ${s.name}` : `${s.name} · kuleye yakalandı`;
    const mine = !!this.player && (s === this.player || killer === this.player);
    this.feed.push({ text, t: this.t, mine });
    if (this.feed.length > 6) this.feed.shift();

    if (s.isBot) this.respawnQueue.push({ name: s.name, t: this.t + rand(2, 4) });
  }

  // ---------- Simülasyon ----------

  step(dt) {
    const C = CONFIG;
    this.t += dt;
    const R = C.arenaRadius;

    // Gemiler
    for (const s of this.ships) {
      if (!s.alive) continue;
      s.switchCD = Math.max(0, s.switchCD - dt);
      s.fireCD = Math.max(0, s.fireCD - dt);
      s.spawnShield = Math.max(0, s.spawnShield - dt);
      if (this.t - s.lastDmgT > C.regenDelay) s.hp = Math.min(C.maxHp, s.hp + C.hpRegen * dt);

      if (s.isBot) this.botThink(s, dt);

      const dx = s.moveX - s.x, dy = s.moveY - s.y, d = Math.hypot(dx, dy) || 1;
      const sp = C.baseSpeed * s.throttle;
      const k = Math.min(1, C.steer * dt);
      s.vx += (dx / d * sp - s.vx) * k;
      s.vy += (dy / d * sp - s.vy) * k;
      s.x += s.vx * dt; s.y += s.vy * dt;

      // Duvar
      const dc = Math.hypot(s.x, s.y);
      if (dc > R - s.r) {
        const nx = s.x / dc, ny = s.y / dc;
        s.x = nx * (R - s.r); s.y = ny * (R - s.r);
        const vn = s.vx * nx + s.vy * ny;
        if (vn > 0) { s.vx -= vn * nx * 1.5; s.vy -= vn * ny * 1.5; }
      }
      // Kule gövdesi engeldir
      for (const q of this.pylons) {
        const ex = s.x - q.x, ey = s.y - q.y, ed = Math.hypot(ex, ey) || 1, lim = s.r + q.r;
        if (ed < lim) { s.x = q.x + ex / ed * lim; s.y = q.y + ey / ed * lim; }
      }

      // Ateş
      if (s.firing && s.fireCD <= 0 && s.energy >= C.fireCost) {
        const a = Math.atan2(s.aimY - s.y, s.aimX - s.x) + rand(-0.04, 0.04);
        this.shoot(s, a, C.bulletSpeed, C.bulletLife, C.bulletDamage);
        s.energy -= C.fireCost;
        s.fireCD = 1 / C.fireRate;
      }
    }

    // Gemiler birbirinin içinden geçmez
    const ss = this.ships;
    for (let i = 0; i < ss.length; i++) {
      const a = ss[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < ss.length; j++) {
        const b = ss[j];
        if (!b.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, lim = a.r + b.r;
        if (d < lim) {
          const o = (lim - d) / 2, nx = dx / d, ny = dy / d;
          a.x -= nx * o; a.y -= ny * o; b.x += nx * o; b.y += ny * o;
        }
      }
    }

    // Kuleler: dönen spiral mermi kolları, belli aralıkla renk değiştirir
    for (const q of this.pylons) {
      q.ang += q.spin * dt;
      q.flipT -= dt;
      if (q.flipT <= 0) {
        q.pol = -q.pol;
        q.flipT = C.pylonFlipEvery * rand(0.8, 1.2);
        this.effect('pulse', q.x, q.y, q.r, q.pol);
      }
      q.acc += C.pylonFireRate * dt;
      while (q.acc >= 1) {
        q.acc -= 1;
        for (let arm = 0; arm < 3; arm++) {
          const a = q.ang + arm * Math.PI * 2 / 3;
          this.bullets.push({
            x: q.x + Math.cos(a) * q.r, y: q.y + Math.sin(a) * q.r,
            vx: Math.cos(a) * C.pylonBulletSpeed, vy: Math.sin(a) * C.pylonBulletSpeed,
            pol: q.pol, owner: q, life: C.pylonBulletLife, age: 0, dmg: C.pylonDamage, dead: false,
          });
        }
      }
    }

    this.updateBullets(dt);
    this.updateOrbs(dt);

    for (const e of this.effects) e.t += dt;
    this.effects = this.effects.filter(e => e.t < e.life);

    if (this.ships.some(s => !s.alive)) this.ships = this.ships.filter(s => s.alive);

    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const q = this.respawnQueue[i];
      if (this.t >= q.t) {
        this.respawnQueue.splice(i, 1);
        if (this.ships.filter(s => s.isBot).length < this.botTarget) this.addShip(q.name, true);
      }
    }
  }

  updateBullets(dt) {
    const C = CONFIG, R2 = C.arenaRadius ** 2;
    for (const b of this.bullets) {
      b.age += dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.age > b.life || b.x * b.x + b.y * b.y > R2) { b.dead = true; continue; }
      for (const s of this.ships) {
        if (!s.alive || s === b.owner) continue;
        const dx = s.x - b.x, dy = s.y - b.y, lim = s.r + 5;
        if (dx > lim || dx < -lim || dy > lim || dy < -lim || dx * dx + dy * dy > lim * lim) continue;
        b.dead = true;
        if (s.pol === b.pol) {
          // Aynı renk: emilir
          s.energy = Math.min(C.maxEnergy, s.energy + C.absorbGain);
          s.score += 1;
          s.absorbed++;
          s.lastAbsorbT = this.t;
          this.effect('absorb', b.x, b.y, 10, b.pol);
        } else {
          this.damage(s, b.dmg, b.owner);
          this.effect('hit', b.x, b.y, 10, b.pol);
        }
        break;
      }
    }
    this.bullets = this.bullets.filter(b => !b.dead);
  }

  updateOrbs(dt) {
    const C = CONFIG, R = C.arenaRadius;
    const damp = Math.pow(0.4, dt);
    for (const o of this.orbs) {
      for (const s of this.ships) {
        if (!s.alive) continue;
        const dx = s.x - o.x, dy = s.y - o.y;
        if (dx > 160 || dx < -160 || dy > 160 || dy < -160) continue;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < s.r + 6) {
          o.dead = true;
          if (o.pol === s.pol) {
            s.energy = Math.min(C.maxEnergy, s.energy + C.orbGain);
            s.score += 1;
            this.effect('absorb', o.x, o.y, 12, o.pol);
          } else {
            this.damage(s, C.orbDamage, null);
            this.effect('hit', o.x, o.y, 12, o.pol);
          }
          break;
        }
        if (d < 160) {
          // Mıknatıs gibi: aynı renk küre gemiye akar, zıt renk kaçar
          const f = (1 - d / 160) * 900 * (o.pol === s.pol ? 1 : -0.6);
          o.vx += dx / d * f * dt;
          o.vy += dy / d * f * dt;
        }
      }
      o.vx *= damp; o.vy *= damp;
      o.x += o.vx * dt; o.y += o.vy * dt;
      const dc = Math.hypot(o.x, o.y);
      if (dc > R - 10) { o.x *= (R - 10) / dc; o.y *= (R - 10) / dc; o.vx *= -0.5; o.vy *= -0.5; }
    }
    this.orbs = this.orbs.filter(o => !o.dead);
    this.orbAcc += C.orbRespawn * dt;
    while (this.orbAcc >= 1) {
      this.orbAcc -= 1;
      if (this.orbs.length < C.orbCount) this.spawnOrb();
    }
  }

  leaderboard(n = 10) {
    return this.ships.filter(s => s.alive).sort((a, b) => b.score - a.score).slice(0, n);
  }

  // ---------- Bot zekâsı ----------

  reactionOf(b) {
    return CONFIG.botReaction * b.reactJitter * (1.6 - b.skill);
  }

  // Bot rakibin renk değişimini tepki süresi kadar geç fark eder
  seenPol(b, o) {
    return this.t - o.polT < this.reactionOf(b) ? -o.pol : o.pol;
  }

  botThink(b, dt) {
    const C = CONFIG;
    b.throttle = 1;
    b.thinkT -= dt;
    if (b.thinkT > 0) return;
    b.thinkT = rand(0.08, 0.2) + (1 - b.skill) * 0.15;
    const react = this.reactionOf(b);

    // 1) Gelen tehlike: yakında bana doğru gelen ve fark ettiğim mermiler
    let threat = { 1: 0, '-1': 0 }, dodgeX = 0, dodgeY = 0;
    for (const m of this.bullets) {
      if (m.owner === b || m.age < react) continue;
      const rx = m.x - b.x, ry = m.y - b.y;
      if (rx > 350 || rx < -350 || ry > 350 || ry < -350) continue;
      const v2 = m.vx * m.vx + m.vy * m.vy;
      const tc = -(rx * m.vx + ry * m.vy) / v2;          // en yakın geçiş zamanı
      if (tc < 0 || tc > 0.9) continue;
      const mx = rx + m.vx * tc, my = ry + m.vy * tc;
      const miss = Math.hypot(mx, my);
      if (miss > b.r + 18) continue;
      const w = 1 / (tc + 0.15);
      threat[m.pol] += w;
      if (m.pol !== b.pol) {
        // dik yönde kaç
        const vl = Math.sqrt(v2);
        const px = -m.vy / vl, py = m.vx / vl;
        const side = (px * -rx + py * -ry) >= 0 ? 1 : -1;
        dodgeX += px * side * w; dodgeY += py * side * w;
      }
    }
    const tRed = threat[1], tBlue = threat[-1];
    const danger = tRed + tBlue;

    // 2) Hedef: menzildeki en uygun rakip (yakın ve canı az olan)
    let target = null, best = -1e9;
    for (const o of this.ships) {
      if (!o.alive || o === b) continue;
      const d = Math.hypot(o.x - b.x, o.y - b.y);
      if (d > 700) continue;
      const score = -d - o.hp * 2;
      if (score > best) { best = score; target = o; }
    }

    let wantPol = 0, vx = 0, vy = 0;
    b.firing = false;

    if (danger > 1.5) {
      // Savunma: tehlikenin çoğunluğunun rengine geç ki emilsin
      wantPol = tRed >= tBlue ? 1 : -1;
      vx += dodgeX * 0.5; vy += dodgeY * 0.5;
    }

    if (target) {
      const tx = target.x - b.x, ty = target.y - b.y, td = Math.hypot(tx, ty) || 1;
      const attackPol = -this.seenPol(b, target);
      if (!wantPol && b.energy >= 10) wantPol = attackPol;
      // Mesafe koru ve yanlama hareket et
      const ideal = 300;
      const radial = td > ideal + 60 ? 1 : td < ideal - 60 ? -1 : 0;
      if (Math.random() < 0.02) b.strafe = -b.strafe;
      vx += tx / td * radial + (-ty / td) * b.strafe * 0.8;
      vy += ty / td * radial + (tx / td) * b.strafe * 0.8;
      // Ateş: yalnızca hedefin (bildiğim) rengine zıt renkteyken
      if (b.pol === attackPol && b.energy >= C.fireCost && td < 600) {
        b.firing = true;
        const lead = td / C.bulletSpeed * (0.4 + b.skill * 0.6);
        const err = rand(-1, 1) * (1 - b.skill) * 0.3;
        const ax = target.x + target.vx * lead, ay = target.y + target.vy * lead;
        const a = Math.atan2(ay - b.y, ax - b.x) + err;
        b.aimX = b.x + Math.cos(a) * 100; b.aimY = b.y + Math.sin(a) * 100;
      }
      if (b.energy >= C.burstCost + 15 && td < 200 && Math.random() < b.skill * 0.4) this.burst(b);
    }

    if (!target || b.energy < 10) {
      // Kendi rengimdeki küreleri topla; enerji azsa kulelerden beslen
      let best = null, bd = 600 * 600;
      for (const o of this.orbs) {
        if (o.pol !== b.pol) continue;
        const d = (o.x - b.x) ** 2 + (o.y - b.y) ** 2;
        if (d < bd) { bd = d; best = o; }
      }
      if (best) {
        const d = Math.sqrt(bd) || 1;
        vx += (best.x - b.x) / d; vy += (best.y - b.y) / d;
      } else {
        if (!b.wander || Math.hypot(b.wander.x - b.x, b.wander.y - b.y) < 150) b.wander = this.randomPoint(250);
        const d = Math.hypot(b.wander.x - b.x, b.wander.y - b.y) || 1;
        vx += (b.wander.x - b.x) / d; vy += (b.wander.y - b.y) / d;
      }
    }

    // Duvardan uzak dur
    const dc = Math.hypot(b.x, b.y) || 1;
    const edge = C.arenaRadius - 180;
    if (dc > edge) { const w = (dc - edge) / 100; vx -= b.x / dc * w; vy -= b.y / dc * w; }

    const len = Math.hypot(vx, vy);
    if (len > 0.01) { b.moveX = b.x + vx / len * 200; b.moveY = b.y + vy / len * 200; }
    else { b.moveX = b.x; b.moveY = b.y; b.throttle = 0; }

    // Beceriye göre bazen yanlış karar / geç kalma
    // Saldırı için renk değiştirmede biraz kararlı dur; savunmada ise hemen tepki ver
    const hold = danger > 1.5 ? 0 : 0.6 + (1 - b.skill) * 0.6;
    if (wantPol && wantPol !== b.pol && this.t - b.polT > hold && Math.random() < 0.4 + b.skill * 0.6) {
      this.switchPolarity(b);
    }
  }
}
