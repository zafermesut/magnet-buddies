'use strict';

// Canvas 2D çizimi: kamera, arena, toz, diken, mıknatıslar, efektler, mini harita.

const COLORS = {
  void: '#05070c',
  arena: '#0d1120',
  grid: 'rgba(120,140,190,0.07)',
  edge: '#ff3b5c',
  red: [255, 77, 94],
  blue: [61, 155, 255],
  neutral: [232, 236, 243],
  dust: '#aab4c3',
  spike: '#262b38',
  spikeEdge: '#ff4d6d',
  boost: [199, 125, 255],
  lock: [255, 209, 102],
};

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const polColor = sign => (sign > 0 ? COLORS.red : sign < 0 ? COLORS.blue : COLORS.neutral);

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0, z: 1 };
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
    return game.leaderboard(1)[0] || { x: 0, y: 0, r: 30 };
  }

  draw(game, dt) {
    const ctx = this.ctx, cam = this.cam;
    const f = this.focusOf(game);
    const tz = clamp(1.12 - f.r / 260, 0.42, 1) * Math.min(this.w, this.h) / 850;
    const k = Math.min(1, dt * 6);
    cam.x += (f.x - cam.x) * k;
    cam.y += (f.y - cam.y) * k;
    cam.z += (tz - cam.z) * Math.min(1, dt * 2);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.void;
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(cam.z, cam.z);
    ctx.translate(-cam.x, -cam.y);

    const view = {
      x0: cam.x - this.w / 2 / cam.z, x1: cam.x + this.w / 2 / cam.z,
      y0: cam.y - this.h / 2 / cam.z, y1: cam.y + this.h / 2 / cam.z,
    };
    const visible = (x, y, r) => x + r > view.x0 && x - r < view.x1 && y + r > view.y0 && y - r < view.y1;

    this.drawArena(ctx, game, view);
    this.drawStorms(ctx, game);
    this.drawLinks(ctx, game);
    this.drawDust(ctx, game, visible);
    for (const s of game.spikes) if (visible(s.x, s.y, s.r * 1.4)) this.drawSpike(ctx, s);
    const p = game.player;
    if (p && p.alive) this.drawRange(ctx, p);
    for (const m of game.magnets) if (m.alive && visible(m.x, m.y, m.r * 2 + 40)) this.drawMagnet(ctx, m, game.t, m === p);
    this.drawEffects(ctx, game);

    ctx.restore();
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

    // Kenar: dışarısı boşluk
    const pulse = 0.35 + 0.15 * Math.sin(game.t * 3);
    ctx.lineWidth = 8;
    ctx.strokeStyle = rgba([255, 59, 92], pulse);
    ctx.setLineDash([30, 20]);
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawStorms(ctx, game) {
    for (const z of game.storms) {
      const col = z.type === 'boost' ? COLORS.boost : COLORS.lock;
      const end = z.warn + z.life;
      const fade = Math.min(1, (end - z.t) / 1);
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
      if (z.active) {
        ctx.fillStyle = rgba(col, 0.09 * fade);
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = rgba(col, (0.45 + 0.2 * Math.sin(game.t * 6)) * fade);
      } else {
        ctx.lineWidth = 3;
        ctx.strokeStyle = rgba(col, Math.sin(z.t * 10) > 0 ? 0.6 : 0.15);
      }
      ctx.setLineDash([18, 12]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = rgba(col, 0.75 * fade);
      ctx.font = '700 28px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = z.type === 'boost' ? '2× GÜÇ' : 'KUTUP KİLİDİ';
      ctx.fillText(z.active ? label : label + ' geliyor…', z.x, z.y);
    }
  }

  drawLinks(ctx, game) {
    ctx.lineWidth = 3;
    for (const l of game.links) {
      if (l.k < 0.06) continue;
      ctx.beginPath();
      ctx.moveTo(l.a.x, l.a.y);
      ctx.lineTo(l.b.x, l.b.y);
      if (l.s < 0) {
        ctx.strokeStyle = rgba(COLORS.boost, l.k * 0.55);   // çekme
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = rgba(COLORS.lock, l.k * 0.45);    // itme
        ctx.setLineDash([10, 12]);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  drawDust(ctx, game, visible) {
    ctx.fillStyle = COLORS.dust;
    ctx.beginPath();
    for (const p of game.dust) {
      if (p.hot > 0 || !visible(p.x, p.y, 8)) continue;
      ctx.rect(p.x - 2.5, p.y - 2.5, 5, 5);
    }
    ctx.fill();

    // Uçan saçmalar: hız yönünde parlak çizgiler
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (const p of game.dust) {
      if (p.hot <= 0 || !visible(p.x, p.y, 30)) continue;
      const col = p.owner ? polColor(p.owner.pol) : COLORS.neutral;
      ctx.strokeStyle = rgba(col, 0.95);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  drawSpike(ctx, s) {
    const n = 12;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = i / (n * 2) * Math.PI * 2;
      const rr = i % 2 === 0 ? s.r * 1.35 : s.r * 0.8;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = COLORS.spike;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.spikeEdge;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, s.r * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.spikeEdge;
    ctx.fill();
    ctx.restore();
  }

  drawRange(ctx, p) {
    const r = rangeOf(p.r, radiusOf(CONFIG.coreMass));
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(polColor(p.sign), 0.12);
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 10]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawMagnet(ctx, m, t, isPlayer) {
    const r = m.r, col = polColor(m.sign);

    // Etrafında dönen demir bulutu (zırh + cephane)
    if (m.ammo > 0) {
      ctx.fillStyle = COLORS.dust;
      ctx.beginPath();
      for (let i = 0; i < m.ammo; i++) {
        const ring = i % 3;
        const a = t * (1.6 - ring * 0.4) * (ring === 1 ? -1 : 1) + i * 2.39996;
        const d = r + 6 + ring * 6 + Math.sin(t * 3 + i) * 2;
        ctx.rect(m.x + Math.cos(a) * d - 2, m.y + Math.sin(a) * d - 2, 4, 4);
      }
      ctx.fill();
    }

    // Aura
    const g = ctx.createRadialGradient(m.x, m.y, r * 0.7, m.x, m.y, r * 1.9);
    g.addColorStop(0, rgba(col, m.boosted ? 0.55 : 0.32));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(m.x, m.y, r * 1.9, 0, Math.PI * 2);
    ctx.fill();

    // Gövde (doğduktan / dikenden sonra korumalıyken yanıp söner)
    const blink = m.spikeImmune > 0 && Math.sin(t * 30) > 0;
    ctx.globalAlpha = blink ? 0.55 : 1;
    ctx.beginPath();
    ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
    ctx.fillStyle = rgba(col, 1);
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.1);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.arc(m.x, m.y, r * 0.82, 0, Math.PI * 2);
    ctx.stroke();
    if (isPlayer) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // İşaret
    ctx.fillStyle = m.sign === 0 ? '#5b6475' : '#fff';
    ctx.font = `800 ${r * 1.1}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(m.sign > 0 ? '+' : m.sign < 0 ? '−' : '•', m.x, m.y + r * 0.04);
    ctx.globalAlpha = 1;

    // Kilit göstergesi
    if (m.locked) {
      ctx.font = `${Math.max(14, r * 0.45)}px system-ui`;
      ctx.fillText('🔒', m.x + r * 0.75, m.y - r * 0.75);
    }

    // Kutup bekleme halkası
    if (isPlayer && m.switchCD > 0 && CONFIG.switchCooldown > 0) {
      const f = m.switchCD / CONFIG.switchCooldown;
      ctx.beginPath();
      ctx.arc(m.x, m.y, r + 7, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    // İsim
    ctx.font = `600 ${Math.max(14, r * 0.34)}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(m.name, m.x, m.y + r + 8);
    ctx.fillStyle = isPlayer ? '#fff' : 'rgba(230,235,245,0.85)';
    ctx.fillText(m.name, m.x, m.y + r + 8);
  }

  drawEffects(ctx, game) {
    for (const e of game.effects) {
      const p = e.t / e.life;
      const col = e.col === 'red' ? COLORS.red : e.col === 'blue' ? COLORS.blue : [255, 77, 109];
      ctx.beginPath();
      if (e.type === 'blast') {
        // Saçma ağız patlaması: kısa bir koni
        const sp = CONFIG.blastSpread;
        ctx.moveTo(e.x, e.y);
        ctx.arc(e.x, e.y, e.r * (1.6 + p * 2.5), e.ang - sp, e.ang + sp);
        ctx.closePath();
        ctx.fillStyle = rgba(col, 0.35 * (1 - p));
        ctx.fill();
        continue;
      }
      if (e.type === 'pulse') {
        ctx.arc(e.x, e.y, e.r * (1 + p * 1.8), 0, Math.PI * 2);
        ctx.lineWidth = 5 * (1 - p);
      } else {
        ctx.arc(e.x, e.y, e.r * (1 + p * 3), 0, Math.PI * 2);
        ctx.lineWidth = 10 * (1 - p);
      }
      ctx.strokeStyle = rgba(col, 1 - p);
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
    ctx.strokeStyle = 'rgba(255,59,92,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    for (const z of game.storms) {
      ctx.beginPath();
      ctx.arc(cx + z.x * s, cy + z.y * s, Math.max(3, z.r * s), 0, Math.PI * 2);
      ctx.fillStyle = rgba(z.type === 'boost' ? COLORS.boost : COLORS.lock, z.active ? 0.35 : 0.15);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,77,109,0.7)';
    for (const sp of game.spikes) ctx.fillRect(cx + sp.x * s - 1.5, cy + sp.y * s - 1.5, 3, 3);
    for (const m of game.magnets) {
      if (!m.alive) continue;
      const me = m === game.player;
      ctx.beginPath();
      ctx.arc(cx + m.x * s, cy + m.y * s, me ? 4 : Math.max(1.8, m.r * s * 1.5), 0, Math.PI * 2);
      ctx.fillStyle = me ? '#fff' : rgba(polColor(m.pol), 0.85);
      ctx.fill();
    }
  }
}
