'use strict';

// Bölüm editörü: ızgaraya çiz, aynı klavyede dene, linkle paylaş ya da online odada oyna.
// Bölüm hazır bölümlerle aynı biçimdedir ({ name, map, magnet }), Game ve sunucu onu aynen kullanır.

const EDITOR_TOOLS = [
  { ch: '#', label: 'Duvar' },
  { ch: '.', label: 'Sil' },
  { ch: 'S', label: 'Başlangıç' },
  { ch: 'E', label: 'Çıkış' },
  { ch: 'K', label: 'Anahtar' },
  { ch: 'D', label: 'Kilitli kapı' },
  { ch: '1', label: 'Düğme', channel: 1 },
  { ch: 'a', label: 'Kapak', channel: 1 },
  { ch: '2', label: 'Düğme', channel: 2 },
  { ch: 'b', label: 'Kapak', channel: 2 },
  { ch: '3', label: 'Düğme', channel: 3 },
  { ch: 'c', label: 'Kapak', channel: 3 },
  { ch: 'H', label: 'Ağır kutu' },
];

const EDITOR_KEY = 'editor-level-v1';

function blankLevel() {
  const cols = 32, rows = 12;
  const map = [];
  for (let r = 0; r < rows; r++) {
    if (r === 0 || r === rows - 1) map.push('#'.repeat(cols));
    else map.push('#' + '.'.repeat(cols - 2) + '#');
  }
  map[rows - 2] = '#.S' + '.'.repeat(cols - 6) + 'E.#';
  return { name: 'Benim bölümüm', magnet: false, map };
}

const Editor = {
  level: null,      // { name, magnet, map: string[] }
  grid: null,       // düzenlenen karolar: string[][]
  tool: '#',
  game: null,       // önizleme için oyuncusuz Game
  hover: null,
  painting: 0,      // 0: yok, 1: çiz, 2: sil
  lastCell: null,   // sürüklerken atlanan hücreleri doldurmak için
  errors: [],

  load(def) {
    this.level = { name: def.name, magnet: !!def.magnet, map: def.map.slice() };
    this.grid = def.map.map(r => [...r]);
    this.refresh(false);
  },

  loadSaved() {
    let def = null;
    try { def = JSON.parse(localStorage.getItem(EDITOR_KEY) || 'null'); } catch (e) { def = null; }
    this.load(def && def.map ? def : blankLevel());
  },

  def() {
    return { name: this.level.name.trim(), magnet: this.level.magnet, map: this.grid.map(r => r.join('')) };
  },

  // Her düzenlemeden sonra: önizlemeyi kur, hataları göster, kaydet
  refresh(save = true) {
    const def = this.def();
    this.errors = validateLevel(def);
    try { this.game = new Game(def, 0); } catch (e) { this.game = null; }
    if (save) { try { localStorage.setItem(EDITOR_KEY, JSON.stringify(def)); } catch (e) { /* yoksay */ } }
    this.renderPanel();
  },

  get rows() { return this.grid.length; },
  get cols() { return this.grid[0].length; },

  // Bir hücre bir ağır kutunun parçasıysa o kutunun sol üst köşesi
  boxAt(c, r) {
    for (const [dc, dr] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      const x = c + dc, y = r + dr;
      if (this.grid[y] && this.grid[y][x] === 'H') return { c: x, r: y };
    }
    return null;
  },

  clearCell(c, r) {
    const box = this.boxAt(c, r);
    if (box) this.grid[box.r][box.c] = '.';
    this.grid[r][c] = '.';
  },

  paint(c, r, ch) {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    if (ch === 'H') {
      if (c + 1 >= this.cols || r + 1 >= this.rows) return false;
      for (const [x, y] of [[c, r], [c + 1, r], [c, r + 1], [c + 1, r + 1]]) this.clearCell(x, y);
      this.grid[r][c] = 'H';
      return true;
    }
    const box = this.boxAt(c, r);
    if (this.grid[r][c] === ch && !box) return false;
    if (ch === 'S' || ch === 'E') {
      // Tek başlangıç ve tek çıkış: eskisi kalkar
      for (const row of this.grid) for (let i = 0; i < row.length; i++) if (row[i] === ch) row[i] = '.';
    }
    this.clearCell(c, r);
    this.grid[r][c] = ch;
    return true;
  },

  resize(dw, dh) {
    const L = LEVEL_LIMITS;
    if (dw > 0 && this.cols < L.maxCols) this.grid.forEach(row => row.splice(row.length - 1, 0, '.'));
    if (dw < 0 && this.cols > L.minCols) this.grid.forEach(row => row.splice(row.length - 2, 1));
    if (dh > 0 && this.rows < L.maxRows) this.grid.splice(1, 0, this.grid[1].map((ch, i) => (i === 0 || i === this.cols - 1 ? '#' : '.')));
    if (dh < 0 && this.rows > L.minRows) this.grid.splice(1, 1);
    // Kesilen kutular geçersiz kalmasın
    this.grid.forEach((row, r) => row.forEach((ch, c) => {
      if (ch === 'H' && (c + 1 >= this.cols || r + 1 >= this.rows)) row[c] = '.';
    }));
    this.refresh();
  },

  // ---------- Panel ----------

  buildPanel() {
    const tools = $('edTools');
    tools.innerHTML = '';
    for (const t of EDITOR_TOOLS) {
      const b = document.createElement('button');
      b.className = 'tool';
      b.dataset.ch = t.ch;
      const swatch = t.channel ? `<i style="background:${CHANNEL_COLORS[t.channel]}"></i>` : `<i class="t${t.ch === '.' ? 'erase' : t.ch === '#' ? 'wall' : t.ch}"></i>`;
      b.innerHTML = swatch + t.label;
      b.addEventListener('click', () => { this.tool = t.ch; this.renderPanel(); });
      tools.appendChild(b);
    }
  },

  renderPanel() {
    if (!this.level) return;
    for (const b of document.querySelectorAll('#edTools .tool')) b.classList.toggle('on', b.dataset.ch === this.tool);
    if (document.activeElement !== $('edName')) $('edName').value = this.level.name;
    $('edMagnet').checked = this.level.magnet;
    $('edSize').textContent = `${this.cols} × ${this.rows}`;
    $('edErrors').innerHTML = this.errors.map(e => `<div>• ${esc(e)}</div>`).join('');
    const ok = !this.errors.length;
    for (const id of ['edTest', 'edShare', 'edOnline']) $(id).disabled = !ok;
  },

  // ---------- Fare ----------

  cellAt(e) {
    const w = renderer.screenToWorld(e.clientX, e.clientY);
    return { c: Math.floor(w.x / T), r: Math.floor(w.y / T) };
  },

  pointer(e) {
    if (state !== 'editor') return;
    const cell = this.cellAt(e);
    this.hover = cell;
    if (!cell || !this.painting) return;
    const ch = this.painting === 2 ? '.' : this.tool;
    // Başlangıç, çıkış ve kutu sürüklenerek çoğaltılmasın: yalnızca tıklamada konur
    if (e.type === 'mousemove' && 'SEH'.includes(ch)) return;
    // Fare hızlı sürüklenince aradaki hücreler atlanmasın: son hücreden buna kadar çiz
    const from = e.type === 'mousemove' && this.lastCell ? this.lastCell : cell;
    const steps = Math.max(Math.abs(cell.c - from.c), Math.abs(cell.r - from.r));
    let changed = false;
    for (let i = 0; i <= steps; i++) {
      const k = steps ? i / steps : 0;
      changed = this.paint(Math.round(from.c + (cell.c - from.c) * k), Math.round(from.r + (cell.r - from.r) * k), ch) || changed;
    }
    this.lastCell = cell;
    if (changed) this.refresh();
  },

  // Izgara, başlangıç işareti ve fare altındaki hücre
  // Izgara, başlangıç işareti ve fare altındaki hücre. Noktalar oyun koordinatından ekrana
  // izdüşürülür; böylece hem 2D hem 3D (eğik kamera) çizimde doğru yere düşer.
  drawOverlay(ctx) {
    if (!this.grid) return;
    const P = (x, y) => renderer.worldToScreen(x, y);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const line = (x1, y1, x2, y2) => { const a = P(x1, y1), b = P(x2, y2); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); };
    for (let c = 0; c <= this.cols; c++) line(c * T, 0, c * T, this.rows * T);
    for (let r = 0; r <= this.rows; r++) line(0, r * T, this.cols * T, r * T);
    ctx.stroke();
    const unit = Math.hypot(P(T, 0).x - P(0, 0).x, P(T, 0).y - P(0, 0).y) / T;   // ekranda 1 px oyun birimi
    this.grid.forEach((row, r) => row.forEach((ch, c) => {
      if (ch !== 'S') return;
      PLAYER_COLORS.forEach((col, i) => {
        const s = P(c * T + T / 2 + i * 40, r * T + T - 17);
        ctx.globalAlpha = i < 2 ? 0.9 : 0.35;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 15 * unit, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }));
    const h = this.hover;
    if (h && h.c >= 0 && h.r >= 0 && h.c < this.cols && h.r < this.rows) {
      const w = this.tool === 'H' ? 2 : 1;
      const x0 = h.c * T + 1, y0 = h.r * T + 1, x1 = (h.c + w) * T - 1, y1 = (h.r + w) * T - 1;
      const pts = [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  },

  shareLink() {
    return `${shareOrigin}${location.pathname}?bolum=${encodeLevel(this.def())}`;
  },
};

Editor.buildPanel();
$('game').addEventListener('mousedown', e => {
  if (state !== 'editor') return;
  Editor.painting = e.button === 2 ? 2 : 1;
  Editor.pointer(e);
});
$('game').addEventListener('mousemove', e => Editor.pointer(e));
addEventListener('mouseup', () => { Editor.painting = 0; Editor.lastCell = null; });
$('game').addEventListener('contextmenu', e => e.preventDefault());
$('game').addEventListener('mouseleave', () => { Editor.hover = null; });
$('edName').addEventListener('input', () => { Editor.level.name = $('edName').value; Editor.refresh(); });
$('edMagnet').addEventListener('change', () => { Editor.level.magnet = $('edMagnet').checked; Editor.refresh(); });
for (const b of document.querySelectorAll('[data-resize]')) {
  b.addEventListener('click', () => { const [dw, dh] = b.dataset.resize.split(',').map(Number); Editor.resize(dw, dh); });
}
$('edClear').addEventListener('click', () => {
  if (confirm('Bölüm temizlensin mi?')) { Editor.load(blankLevel()); Editor.refresh(); }
});
$('edShare').addEventListener('click', async () => {
  const link = Editor.shareLink();
  try { await navigator.clipboard.writeText(link); $('edShare').textContent = 'Link kopyalandı!'; }
  catch (e) { prompt('Bölüm linki:', link); }
  setTimeout(() => { $('edShare').textContent = 'Linki kopyala'; }, 1500);
});
