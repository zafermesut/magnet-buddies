'use strict';

// Canvas 2D çizimi. Bölüm her zaman ekrana sığdırılır; böylece herkes her şeyi görür.

const PAL = {
  skyTop: '#1c1b3a',
  skyBottom: '#2e2a5e',
  tile: '#3a3f72',
  tileEdge: '#7d86e8',
  tileLine: 'rgba(0,0,0,0.14)',
  door: '#e0a84a',
  doorDark: '#8a5a1c',
  box: '#b67b4c',
  boxDark: '#6e4527',
  key: '#ffd43b',
  exit: '#69db7c',
};

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbaHex = (h, a) => { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; };

class Renderer {
  // WebGL yoksa kullanılan 2D yedek çizim. 3D çizimle aynı arayüzü sunar.
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.overlayCtx = this.ctx;   // editör katmanı aynı tuvale çizilir
    this.stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.6 + 0.4, p: Math.random() * 6 }));
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

  // Oyun koordinatı (px) ↔ ekran (CSS px); editör ve 3D çizimle ortak arayüz
  worldToScreen(x, y) {
    const v = this.view || { z: 1, ox: 0, oy: 0 };
    return { x: v.ox + x * v.z, y: v.oy + y * v.z };
  }

  screenToWorld(sx, sy) {
    const v = this.view || { z: 1, ox: 0, oy: 0 };
    return { x: (sx - v.ox) / v.z, y: (sy - v.oy) / v.z };
  }

  draw(game, time) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Gökyüzü
    const sky = ctx.createLinearGradient(0, 0, 0, this.h);
    sky.addColorStop(0, PAL.skyTop);
    sky.addColorStop(1, PAL.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.w, this.h);
    for (const s of this.stars) {
      ctx.globalAlpha = 0.3 + 0.3 * Math.sin(time * 1.5 + s.p);
      ctx.fillStyle = '#fff';
      ctx.fillRect(s.x * this.w, s.y * this.h, s.r, s.r);
    }
    ctx.globalAlpha = 1;
    if (!game) return;

    // Bölümü ekrana sığdır (üstte HUD için, editörde solda panel için pay bırak)
    const padTop = this.padTop ?? 70, padLeft = this.padLeft || 0, pad = 24;
    const z = Math.min((this.w - padLeft - pad * 2) / game.W, (this.h - padTop - pad) / game.H, 1.6);
    const ox = padLeft + (this.w - padLeft - game.W * z) / 2, oy = padTop + (this.h - padTop - pad - game.H * z) / 2;
    this.view = { z, ox, oy };
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(z, z);

    const t = game.t;
    this.drawTiles(ctx, game);
    this.drawDoors(ctx, game);
    this.drawGates(ctx, game, t);
    this.drawButtons(ctx, game);
    this.drawScrap(ctx, game, t);
    this.drawExit(ctx, game, t);
    for (const b of game.boxes) this.drawBox(ctx, b, game);
    if (game.magnet) for (const p of game.players) if (p.magnetOn && !p.inExit) this.drawField(ctx, p, t);
    for (const p of game.players) if (!p.inExit) this.drawPlayer(ctx, p, t, game.magnet);
    for (const k of game.keys) if (!k.used) this.drawKey(ctx, k, t);
    this.drawEffects(ctx, game);
    ctx.restore();
  }

  drawTiles(ctx, g) {
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        if (!g.grid[r][c]) continue;
        const x = c * T, y = r * T;
        ctx.fillStyle = PAL.tile;
        ctx.fillRect(x, y, T, T);
        ctx.strokeStyle = PAL.tileLine;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
        if (r > 0 && !g.grid[r - 1][c]) {
          ctx.fillStyle = PAL.tileEdge;
          ctx.fillRect(x, y, T, 5);
        }
      }
    }
  }

  drawDoors(ctx, g) {
    for (const d of g.doors) {
      const alpha = d.open ? Math.max(0, 1 - d.openT * 2.5) : 1;
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      for (const q of d.cells) {
        const x = q.c * T, y = q.r * T;
        ctx.fillStyle = PAL.door;
        ctx.fillRect(x + 4, y, T - 8, T);
        ctx.fillStyle = PAL.doorDark;
        ctx.fillRect(x + 4, y, 3, T);
        ctx.fillRect(x + T - 7, y, 3, T);
        ctx.fillRect(x + 4, y + T - 3, T - 8, 3);
      }
      // Anahtar deliği ortadaki hücrede
      const mid = d.cells.slice().sort((a, b) => a.r - b.r)[Math.floor(d.cells.length / 2)];
      const cx = mid.c * T + T / 2, cy = mid.r * T + T / 2;
      ctx.fillStyle = PAL.doorDark;
      ctx.beginPath();
      ctx.arc(cx, cy - 4, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 4, cy);
      ctx.lineTo(cx + 4, cy);
      ctx.lineTo(cx + 2, cy + 10);
      ctx.lineTo(cx - 2, cy + 10);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  drawGates(ctx, g, t) {
    for (const gate of g.gates) {
      const col = CHANNEL_COLORS[gate.channel];
      for (const q of gate.cells) {
        const x = q.c * T, y = q.r * T;
        if (gate.open) {
          ctx.strokeStyle = rgbaHex(col, 0.25);
          ctx.setLineDash([4, 6]);
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 6, y + 1, T - 12, T - 2);
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = rgbaHex(col, 0.18);
          ctx.fillRect(x + 4, y, T - 8, T);
          ctx.fillStyle = rgbaHex(col, 0.9);
          // Ters kapak yatay çubuklu
          for (let i = 0; i < 3; i++) gate.inverse ? ctx.fillRect(x + 4, y + 8 + i * 10, T - 8, 4) : ctx.fillRect(x + 8 + i * 10, y, 4, T);
        }
      }
    }
  }

  drawButtons(ctx, g) {
    for (const b of g.buttons) {
      const col = CHANNEL_COLORS[b.channel];
      ctx.fillStyle = '#20233f';
      ctx.fillRect(b.x - 2, b.y + b.h - 3, b.w + 4, 3);
      const h = b.pressed ? 3 : 8;
      if (b.pressed) {
        ctx.fillStyle = rgbaHex(col, 0.35);
        ctx.fillRect(b.x - 6, b.y - 10, b.w + 12, 18);
      }
      ctx.fillStyle = col;
      ctx.fillRect(b.x + 3, b.y + b.h - 3 - h, b.w - 6, h);
    }
  }

  // Hurdalık öğeleri: tek yönlü platform, şalter, asansör, yay
  drawScrap(ctx, g, t) {
    ctx.fillStyle = '#c27a4a';
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
      if (g.oneway[r][c]) ctx.fillRect(c * T, r * T, T, 7);
    }
    for (const l of g.levers) {
      const col = CHANNEL_COLORS[l.channel], on = g.switches[l.channel];
      const bx = l.x + T / 2, by = l.y + T;
      ctx.fillStyle = '#8c90c8';
      ctx.fillRect(bx - 11, by - 6, 22, 6);
      const a = on ? 0.6 : -0.6;
      const tx = bx + Math.sin(a) * 20, ty = by - 6 - Math.cos(a) * 20;
      ctx.strokeStyle = '#8c90c8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(bx, by - 6); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(tx, ty, 5, 0, Math.PI * 2); ctx.fill();
    }
    for (const L of g.lifts) {
      ctx.fillStyle = '#3a3c6e';
      ctx.fillRect(L.x - 3, L.topY, 3, L.oy + L.h - L.topY);
      ctx.fillRect(L.x + L.w, L.topY, 3, L.oy + L.h - L.topY);
      ctx.fillStyle = '#55588f';
      ctx.fillRect(L.x, L.y, L.w, L.h);
      ctx.fillStyle = rgbaHex(CHANNEL_COLORS[L.channel], g.channelOn(L.channel) ? 1 : 0.5);
      ctx.fillRect(L.x + 4, L.y + 4, L.w - 8, 4);
    }
    for (const f of g.fixed) {
      const x = f.c * T, y = f.r * T, col = POLE_COLORS[f.pol];
      ctx.fillStyle = col;
      ctx.fillRect(x, y, T, T);
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + 10, y + T / 2 - 2, T - 20, 4);
      if (f.pol > 0) ctx.fillRect(x + T / 2 - 2, y + 10, 4, T - 20);
    }
    for (const [key, pol] of g.poleCells) {
      const r = Math.floor(key / g.cols), c = key % g.cols;
      ctx.fillStyle = rgbaHex(POLE_COLORS[pol], 0.3);
      ctx.fillRect(c * T + 2, r * T, T - 4, T);
    }
    for (const M of g.movers) {
      ctx.fillStyle = '#3a3c6e';
      ctx.fillRect(M.minX, M.y + M.h / 2 - 1, M.maxX + M.w - M.minX, 2);
      ctx.fillStyle = '#9a9ee0';
      ctx.fillRect(M.x, M.y, M.w, M.h);
      ctx.fillStyle = '#ffa94d';
      ctx.fillRect(M.x + 4, M.y + M.h / 2 - 1, M.w - 8, 2);
    }
    ctx.fillStyle = '#ffa94d';
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) if (g.def.map[r][c] === ':') ctx.fillRect(c * T + T / 2 - 3, r * T, 6, T / 2);
    for (const sp of g.springs) {
      const since = t - sp.t;
      const k = since >= 0 && since < 0.6 ? Math.exp(-since * 7) * Math.cos(since * 26) : 0;
      const h = Math.max(4, 10 * (1 + k * 0.9));
      ctx.fillStyle = '#8c90c8';
      ctx.fillRect(sp.x, sp.y + sp.h - 3, sp.w, 3);
      ctx.strokeStyle = '#8c90c8'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 4; i++) ctx.lineTo(sp.x + (i % 2 ? sp.w - 6 : 6), sp.y + sp.h - 3 - (h * i) / 4);
      ctx.stroke();
      ctx.fillStyle = '#ffa94d';
      ctx.fillRect(sp.x - 1, sp.y + sp.h - 3 - h - 4, sp.w + 2, 4);
    }
  }

  drawExit(ctx, g, t) {
    const e = g.exit;
    if (!e) return;
    const glow = 0.25 + 0.1 * Math.sin(t * 3);
    ctx.fillStyle = rgbaHex(PAL.exit, glow);
    ctx.beginPath();
    const cx = e.x + e.w / 2, ar = e.w / 2 - 4;
    ctx.ellipse(cx, e.y + e.h - 4, e.w * 0.8, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    // Kemerli kapı
    ctx.fillStyle = '#15172e';
    ctx.strokeStyle = PAL.exit;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(e.x + 4, e.y + e.h);
    ctx.lineTo(e.x + 4, e.y + 4 + ar);
    ctx.arc(cx, e.y + 4 + ar, ar, Math.PI, 0);
    ctx.lineTo(e.x + e.w - 4, e.y + e.h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // İçeri girenler kapıda küçük toplar olarak görünür
    const inside = g.players.filter(p => p.inExit);
    inside.forEach((p, i) => {
      ctx.fillStyle = PLAYER_COLORS[p.index];
      ctx.beginPath();
      ctx.arc(cx + (i % 2 ? 11 : -11), e.y + e.h - 14 - Math.floor(i / 2) * 22, 9, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = '#fff';
    ctx.font = '700 16px "Fredoka", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${inside.length}/${g.players.length}`, cx, e.y - 4);
  }

  drawBox(ctx, b, g) {
    const { x, y, w, h } = b;
    if (b.metal) {
      ctx.fillStyle = '#9ea3c7';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#5d6194';
      for (const [dx, dy] of [[5, 5], [w - 9, 5], [5, h - 9], [w - 9, h - 9]]) ctx.fillRect(x + dx, y + dy, 4, 4);
      return;
    }
    ctx.fillStyle = PAL.box;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = PAL.boxDark;
    ctx.lineWidth = 5;
    ctx.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 6); ctx.lineTo(x + w - 6, y + h - 6);
    ctx.moveTo(x + w - 6, y + 6); ctx.lineTo(x + 6, y + h - 6);
    ctx.stroke();
    // Kaç kişi gerektiği: dolu daireler şu an itenler
    const n = g.boxNeed, r = 6, gap = 16, sx = x + w / 2 - (n - 1) * gap / 2;
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(sx + i * gap, y - 12, r, 0, Math.PI * 2);
      ctx.fillStyle = i < b.pushers ? '#fff' : 'rgba(255,255,255,0.15)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // Mıknatıs alanı: menzil halkası, içe/dışa akan dalgalar, etkilenenlere çizgiler
  drawField(ctx, p, t) {
    const col = POLE_COLORS[p.pol], R = PHYS.magnetRange;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    ctx.strokeStyle = rgbaHex(col, 0.18);
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 3; i++) {
      const f = (t * 1.6 + i / 3) % 1;
      ctx.strokeStyle = rgbaHex(col, 0.35 * (1 - f));
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, p.w / 2 + 6 + f * (R - p.w), 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const a of p.affects || []) {
      const o = a.o;
      ctx.strokeStyle = rgbaHex(col, 0.6);
      ctx.lineWidth = 3;
      ctx.setLineDash(a.repel ? [8, 8] : []);
      ctx.lineDashOffset = a.repel ? -t * 60 : 0;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(o.x + o.w / 2, o.y + o.h / 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  drawPlayer(ctx, p, t, magnet) {
    const col = PLAYER_COLORS[p.index];
    const r = p.w / 2 + 1;
    const s = p.squash;
    ctx.save();
    ctx.translate(p.x + p.w / 2, p.y + p.h);
    ctx.scale(1 + s, 1 - s);

    // Gövde
    const grad = ctx.createRadialGradient(-r * 0.35, -r * 1.35, r * 0.2, 0, -r, r * 1.1);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.18, col);
    grad.addColorStop(1, rgbaHex(col, 0.85));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, -r, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Gözler: baktığı yöne kayar, ara sıra kırpar
    const look = p.facing * 3, lookY = clampN(p.vy / 300, -2, 2);
    const blink = ((t + p.index * 1.7) % 4) < 0.12;
    for (const ex of [-r * 0.32, r * 0.32]) {
      const exx = ex + look, eyy = -r * 1.12;
      if (blink) {
        ctx.strokeStyle = '#1c1b3a';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(exx - 4, eyy); ctx.lineTo(exx + 4, eyy);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.ellipse(exx, eyy, 5, 6.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1c1b3a';
        ctx.beginPath();
        ctx.arc(exx + p.facing * 1.5, eyy + lookY, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // Kutup rozeti (mıknatıslı bölümlerde)
    if (magnet) {
      const bx = p.x + p.w - 2, by = p.y + 4, pc = POLE_COLORS[p.pol];
      ctx.beginPath();
      ctx.arc(bx, by, 9, 0, Math.PI * 2);
      ctx.fillStyle = pc;
      ctx.fill();
      ctx.strokeStyle = '#1c1b3a';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#1c1b3a';
      ctx.font = '900 15px "Fredoka", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.pol > 0 ? '+' : '−', bx, by + 1);
    }

    if (p.noLabel) return;
    // Kim olduğu: online'da takma ad, kendi topunun üstünde küçük bir ok
    const label = p.name || `${p.index + 1}P`;
    let ly = p.y - 6;
    if (p.isMe) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(p.x + p.w / 2 - 6, ly - 8);
      ctx.lineTo(p.x + p.w / 2 + 6, ly - 8);
      ctx.lineTo(p.x + p.w / 2, ly - 1);
      ctx.fill();
      ly -= 11;
    }
    ctx.font = '800 13px "Fredoka", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(20,20,45,0.8)';
    ctx.strokeText(label, p.x + p.w / 2, ly);
    ctx.fillStyle = col;
    ctx.fillText(label, p.x + p.w / 2, ly);
  }

  drawKey(ctx, k, t) {
    const bob = k.holder ? 0 : Math.sin(t * 3) * 2;
    const x = k.x + k.w / 2, y = k.y + k.h / 2 + bob;
    ctx.save();
    ctx.translate(x, y);
    if (k.compass) {
      // Pusula parçası: kırmızı-beyaz iğne
      ctx.rotate(0.5 + Math.sin(t * 5) * 0.15);
      ctx.shadowColor = '#ff6b6b';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(6, 0); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f1f3ff';
      ctx.beginPath(); ctx.moveTo(0, 16); ctx.lineTo(6, 0); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
      return;
    }
    ctx.shadowColor = PAL.key;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = PAL.key;
    ctx.fillStyle = PAL.key;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(-5, 0, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillRect(0, -2, 13, 4);
    ctx.fillRect(8, 2, 3, 5);
    ctx.fillRect(12, 2, 3, 4);
    ctx.restore();
  }

  drawEffects(ctx, g) {
    for (const e of g.effects) {
      const age = g.t - e.t;
      if (age < 0 || age > 0.8) continue;
      const p = age / 0.8;
      ctx.globalAlpha = 1 - p;
      if (e.type === 'jump') {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        for (const dx of [-10, 10]) {
          ctx.beginPath();
          ctx.arc(e.x + dx * (1 + p * 2), e.y - 2, 3 * (1 - p) + 1, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        const col = e.type === 'unlock' || e.type === 'pickup' ? PAL.key
          : e.type === 'swap' ? e.color
          : e.type === 'enter' || e.type === 'win' ? PAL.exit
          : e.color || '#fff';
        const size = e.type === 'unlock' || e.type === 'win' ? 70 : 30;
        ctx.strokeStyle = col;
        ctx.lineWidth = 4 * (1 - p) + 1;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 6 + size * p, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}

function clampN(v, a, b) { return v < a ? a : v > b ? b : v; }
