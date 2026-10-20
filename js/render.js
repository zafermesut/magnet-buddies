'use strict';

// Canvas 2D çizimi: kamera, arena, kuleler, küreler, mermiler, gemiler, efektler, mini harita.

const COLORS = {
  void: '#05070c',
  arena: '#0d1120',
  grid: 'rgba(120,140,190,0.07)',
  wall: [150, 170, 220],
  red: [255, 77, 94],
  blue: [61, 155, 255],
};

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const polColor = pol => (pol > 0 ? COLORS.red : COLORS.blue);

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0, z: 1 };
    this.shake = 0;
    this.lastDmgSeen = -99;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = innerWidth;
    this.h = innerHeight;
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
  }

  screenToWorld(sx, sy) {
    return { x: (sx - this.w / 2) / this.cam.z + this.cam.x, y: (sy - this.h / 2) / this.cam.z + this.cam.y };
  }

  focusOf(game) {
    const p = game.player;
    if (p && p.alive) return p;
    if (p && p.killer && p.killer.alive) return p.killer;
    if (p) return p;
    return game.leaderboard(1)[0] || { x: 0, y: 0 };
  }

  draw(game, dt) {
    const ctx = this.ctx, cam = this.cam;
    const f = this.focusOf(game);
    const tz = Math.min(this.w, this.h) / 900;
    const k = Math.min(1, dt * 8);
    cam.x += (f.x - cam.x) * k;
    cam.y += (f.y - cam.y) * k;
    cam.z += (tz - cam.z) * Math.min(1, dt * 3);

    // Oyuncu hasar alınca ekran sarsıntısı
    const p = game.player;
    if (p && p.lastDmgT > this.lastDmgSeen) { this.lastDmgSeen = p.lastDmgT; this.shake = 6; }
    this.shake = Math.max(0, this.shake - dt * 40);
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.void;
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.save();
    ctx.translate(this.w / 2 + sx, this.h / 2 + sy);
    ctx.scale(cam.z, cam.z);
    ctx.translate(-cam.x, -cam.y);

    const view = {
      x0: cam.x - this.w / 2 / cam.z, x1: cam.x + this.w / 2 / cam.z,
      y0: cam.y - this.h / 2 / cam.z, y1: cam.y + this.h / 2 / cam.z,
    };
    const visible = (x, y, r) => x + r > view.x0 && x - r < view.x1 && y + r > view.y0 && y - r < view.y1;

    this.drawArena(ctx, game, view);
    this.drawOrbs(ctx, game, visible);
    for (const q of game.pylons) if (visible(q.x, q.y, 80)) this.drawPylon(ctx, q, game.t);
    for (const s of game.ships) if (s.alive && visible(s.x, s.y, 80)) this.drawShip(ctx, s, game.t, s === p);
    this.drawBullets(ctx, game, visible);
    this.drawEffects(ctx, game);

    ctx.restore();

    // Hasar alınca kenarlarda kırmızı parlama
    if (p && p.alive && game.t - p.lastDmgT < 0.25) {
      const a = 0.35 * (1 - (game.t - p.lastDmgT) / 0.25);
      const g = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.35, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
      g.addColorStop(0, 'rgba(255,40,60,0)');
      g.addColorStop(1, `rgba(255,40,60,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    this.drawMinimap(ctx, game);
  }

  drawArena(ctx, game, view) {
    const R = CONFIG.arenaRadius;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.arena;
    ctx.fill();

    ctx.save();
    ctx.clip();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const g = 90;
    for (let x = Math.floor(view.x0 / g) * g; x < view.x1; x += g) { ctx.moveTo(x, view.y0); ctx.lineTo(x, view.y1); }
    for (let y = Math.floor(view.y0 / g) * g; y < view.y1; y += g) { ctx.moveTo(view.x0, y); ctx.lineTo(view.x1, y); }
    ctx.stroke();
    ctx.restore();

    ctx.lineWidth = 10;
    ctx.strokeStyle = rgba(COLORS.wall, 0.35);
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawOrbs(ctx, game, visible) {
    const pulse = 1 + Math.sin(game.t * 4) * 0.15;
    for (const pol of [1, -1]) {
      const col = polColor(pol);
      ctx.fillStyle = rgba(col, 0.25);
      ctx.beginPath();
      for (const o of game.orbs) {
        if (o.pol !== pol || !visible(o.x, o.y, 12)) continue;
        ctx.moveTo(o.x + 9 * pulse, o.y);
        ctx.arc(o.x, o.y, 9 * pulse, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.fillStyle = rgba(col, 1);
      ctx.beginPath();
      for (const o of game.orbs) {
        if (o.pol !== pol || !visible(o.x, o.y, 12)) continue;
        ctx.moveTo(o.x + 4.5, o.y);
        ctx.arc(o.x, o.y, 4.5, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  drawPylon(ctx, q, t) {
    // Renk değiştirmeden hemen önce yanıp söner (uyarı)
    const warn = q.flipT < 0.8 && Math.sin(t * 30) > 0;
    const col = polColor(warn ? -q.pol : q.pol);
    ctx.save();
    ctx.translate(q.x, q.y);
    const g = ctx.createRadialGradient(0, 0, q.r * 0.5, 0, 0, q.r * 2.6);
    g.addColorStop(0, rgba(col, 0.3));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, q.r * 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(q.ang);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      ctx.lineTo(Math.cos(a) * q.r, Math.sin(a) * q.r);
    }
    ctx.closePath();
    ctx.fillStyle = '#1a2033';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = rgba(col, 1);
    ctx.stroke();
    // üç namlu
    ctx.fillStyle = rgba(col, 1);
    for (let arm = 0; arm < 3; arm++) {
      ctx.save();
      ctx.rotate(arm * Math.PI * 2 / 3);
      ctx.fillRect(q.r * 0.4, -5, q.r * 0.75, 10);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, q.r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawBullets(ctx, game, visible) {
    for (const pol of [1, -1]) {
      const col = polColor(pol);
      ctx.fillStyle = rgba(col, 0.3);
      ctx.beginPath();
      for (const b of game.bullets) {
        if (b.pol !== pol || !visible(b.x, b.y, 14)) continue;
        ctx.moveTo(b.x + 11, b.y);
        ctx.arc(b.x, b.y, 11, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.fillStyle = rgba(col, 1);
      ctx.beginPath();
      for (const b of game.bullets) {
        if (b.pol !== pol || !visible(b.x, b.y, 14)) continue;
        ctx.moveTo(b.x + 6, b.y);
        ctx.arc(b.x, b.y, 6, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    // parlak çekirdek
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    for (const b of game.bullets) {
      if (!visible(b.x, b.y, 4)) continue;
      ctx.moveTo(b.x + 2.5, b.y);
      ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  drawShip(ctx, s, t, isPlayer) {
    const r = s.r, col = polColor(s.pol);
    const absorbing = t - s.lastAbsorbT < 0.15;

    // Aura (emerken büyür)
    const ar = r * (absorbing ? 2.4 : 1.9);
    const g = ctx.createRadialGradient(s.x, s.y, r * 0.7, s.x, s.y, ar);
    g.addColorStop(0, rgba(col, absorbing ? 0.6 : 0.35));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s.x, s.y, ar, 0, Math.PI * 2);
    ctx.fill();

    // Nişan yönü
    const a = Math.atan2(s.aimY - s.y, s.aimX - s.x);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(a);
    ctx.fillStyle = rgba(col, 1);
    ctx.beginPath();
    ctx.moveTo(r + 10, 0);
    ctx.lineTo(r - 2, -8);
    ctx.lineTo(r - 2, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Gövde (doğuş korumasında yanıp söner)
    const hurt = t - s.lastDmgT < 0.1;
    ctx.globalAlpha = s.spawnShield > 0 && Math.sin(t * 25) > 0 ? 0.5 : 1;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = hurt ? '#ffffff' : rgba(col, 1);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = isPlayer ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.3)';
    ctx.stroke();

    ctx.fillStyle = hurt ? rgba(col, 1) : '#fff';
    ctx.font = `800 ${r * 1.15}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.pol > 0 ? '+' : '−', s.x, s.y + r * 0.04);
    ctx.globalAlpha = 1;

    // Enerji halkası
    const e = s.energy / CONFIG.maxEnergy;
    if (e > 0) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 6, -Math.PI / 2, -Math.PI / 2 + e * Math.PI * 2);
      ctx.strokeStyle = s.energy >= CONFIG.burstCost ? 'rgba(255,230,120,0.95)' : 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Can çubuğu
    const w = r * 2.2, hy = s.y + r + 12;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(s.x - w / 2, hy, w, 5);
    const hp = Math.max(0, s.hp / CONFIG.maxHp);
    ctx.fillStyle = hp > 0.5 ? '#4ade80' : hp > 0.25 ? '#facc15' : '#ef4444';
    ctx.fillRect(s.x - w / 2, hy, w * hp, 5);

    // İsim
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(s.name, s.x, hy + 9);
    ctx.fillStyle = isPlayer ? '#fff' : 'rgba(230,235,245,0.85)';
    ctx.fillText(s.name, s.x, hy + 9);
  }

  drawEffects(ctx, game) {
    for (const e of game.effects) {
      const p = e.t / e.life;
      const col = polColor(e.pol);
      ctx.beginPath();
      if (e.type === 'absorb') {
        ctx.arc(e.x, e.y, e.r * (1 - p * 0.7), 0, Math.PI * 2);
        ctx.strokeStyle = rgba(col, 1 - p);
        ctx.lineWidth = 3;
      } else if (e.type === 'hit') {
        ctx.arc(e.x, e.y, e.r * (1 + p * 2), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${1 - p})`;
        ctx.lineWidth = 3;
      } else if (e.type === 'pulse') {
        ctx.arc(e.x, e.y, e.r * (1 + p * 1.8), 0, Math.PI * 2);
        ctx.strokeStyle = rgba(col, 1 - p);
        ctx.lineWidth = 5 * (1 - p);
      } else {
        ctx.arc(e.x, e.y, e.r * (1 + p * 4), 0, Math.PI * 2);
        ctx.strokeStyle = rgba(col, 1 - p);
        ctx.lineWidth = 10 * (1 - p);
      }
      ctx.stroke();
    }
  }

  drawMinimap(ctx, game) {
    const size = Math.min(150, this.w * 0.28), pad = 16;
    const cx = pad + size / 2, cy = this.h - pad - size / 2;
    const s = size / 2 / CONFIG.arenaRadius;
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(13,17,32,0.85)';
    ctx.fill();
    ctx.strokeStyle = rgba(COLORS.wall, 0.4);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    for (const q of game.pylons) {
      ctx.fillStyle = rgba(polColor(q.pol), 0.5);
      ctx.fillRect(cx + q.x * s - 3, cy + q.y * s - 3, 6, 6);
    }
    for (const m of game.ships) {
      if (!m.alive) continue;
      const me = m === game.player;
      ctx.beginPath();
      ctx.arc(cx + m.x * s, cy + m.y * s, me ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = me ? '#fff' : rgba(polColor(m.pol), 0.9);
      ctx.fill();
    }
  }
}
