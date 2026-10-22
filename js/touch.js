'use strict';

// Dokunmatik kontroller: telefonda ekranın altındaki tuşlar. Input'a 'touch' adlı bir giriş kaynağı olarak
// eklenir; oyun tuşun klavyeden mi ekrandan mı geldiğini bilmez. Yalnızca dokunmatik cihazda açılır.
//   Sol başparmak: yön şeridi. Parmak kaldırılmadan sağa sola kaydırılınca yön değişir.
//   Sağ başparmak: zıpla, eylem (dokun: anahtar / şalter, basılı tut: mıknatıs), kutup (mıknatıslı bölümde).
// Parmak tuşun biraz dışına da basabilir; sağdaki tuşlar arasında kaydırınca parmağın altındaki tuş basılır.

const TOUCH_KEYS = ['left', 'right', 'jump', 'action', 'swap'];

const Touch = {
  enabled: false,
  held: {},
  tapped: {},          // iki kare arasında basılıp bırakılan tuş kaybolmasın
  fingers: new Map(),  // pointerId → { k: 'move' | 'jump' | 'action' | 'swap', dir }
  hooks: [],

  init() {
    // Yazı alanları dışında seçim ve uzun basma menüsü yok (Safari CSS'e rağmen bazen seçer)
    const typing = e => e.target instanceof Element && e.target.closest('input, textarea');
    document.addEventListener('selectstart', e => { if (!typing(e)) e.preventDefault(); });
    document.addEventListener('contextmenu', e => { if (this.enabled && !typing(e)) e.preventDefault(); });
    if (matchMedia('(pointer: coarse)').matches) this.enable();
    else addEventListener('touchstart', () => this.enable(), { once: true, passive: true });
  },

  // Dokunmatik açılınca çalışacaklar (açıksa hemen çalışır)
  onEnable(fn) { if (this.enabled) fn(); else this.hooks.push(fn); },

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    document.body.classList.add('touch');
    const pad = document.createElement('div');
    pad.id = 'touchPad';
    pad.innerHTML = `
      <div class="tpMove"><span class="tpBtn" data-k="left">${icon('left')}</span><span class="tpBtn" data-k="right">${icon('right')}</span></div>
      <span class="tpBtn tpSwap" data-k="swap">${icon('refresh')}</span>
      <span class="tpBtn tpAction" data-k="action">${icon('magnet')}</span>
      <span class="tpBtn tpJump" data-k="jump">${icon('up')}</span>`;
    document.getElementById('hud').appendChild(pad);
    this.pad = pad;
    this.moveEl = pad.querySelector('.tpMove');
    this.btn = {};
    for (const el of pad.querySelectorAll('.tpBtn')) this.btn[el.dataset.k] = el;
    addEventListener('pointerdown', e => this.down(e), { passive: false });
    addEventListener('pointermove', e => this.move(e), { passive: false });
    addEventListener('pointerup', e => this.up(e));
    addEventListener('pointercancel', e => this.up(e));
    addEventListener('blur', () => { this.fingers.clear(); this.refresh(); });
    // iPhone Safari uzun basınca büyüteç / seçim açar; pointer olayını engellemek yetmez, touchstart engellenmeli.
    // Yalnızca tuşlara ve bölüme dokunuşta: HUD düğmelerinin (menü, ayarlar) tıklaması bozulmasın.
    const block = e => {
      if (!this.active()) return;
      const onGame = e.target === document.getElementById('game');
      if (onGame || [...e.changedTouches].some(t => this.hit(t.clientX, t.clientY))) e.preventDefault();
    };
    addEventListener('touchstart', block, { passive: false });
    addEventListener('touchmove', block, { passive: false });
    for (const fn of this.hooks) fn();
    this.hooks = [];
  },

  // Alttaki tuş şeridinin yüksekliği (px): kamera bölümü bunun üstüne sığdırır
  band() {
    let top = innerHeight;
    for (const el of Object.values(this.btn || {})) if (el.offsetParent) top = Math.min(top, el.getBoundingClientRect().top);
    if (top < innerHeight) this.lastBand = Math.max(30, innerHeight - top + 8);
    return this.lastBand || 30;   // tuşlar gizliyken (bölüm sonu) kamera yerinde kalsın
  },

  // Eylem tuşu mıknatıssız bölümde el (anahtar bırak, şalter çevir), mıknatıslıda mıknatıs
  setMagnet(on) {
    if (!this.pad) return;
    this.pad.classList.toggle('magnet', !!on);
    this.btn.action.innerHTML = icon(on ? 'magnet' : 'hand');
  },

  // Oyun ekranı açıkken (HUD görünürken) çalışır
  active() { return this.enabled && !document.getElementById('hud').classList.contains('hidden'); },

  // Parmağın altındaki kontrol: yön şeridi ya da en yakın sağ tuş (görünen tuşun biraz dışı da sayılır)
  hit(x, y, rightOnly) {
    const near = (el, pad) => {
      if (!el.offsetParent) return null;
      const r = el.getBoundingClientRect();
      if (x < r.left - pad || x > r.right + pad || y < r.top - pad || y > r.bottom + pad) return null;
      return Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
    };
    if (!rightOnly && near(this.moveEl, 24) !== null) return 'move';
    let best = null, bd = Infinity;
    for (const k of ['jump', 'action', 'swap']) {
      const d = near(this.btn[k], 18);
      if (d !== null && d < bd) { best = k; bd = d; }
    }
    return best;
  },

  // Yön şeridinde ortanın solu sola, sağı sağa
  dirAt(x) {
    const r = this.moveEl.getBoundingClientRect();
    return x < r.left + r.width / 2 ? -1 : 1;
  },

  down(e) {
    if (!this.active()) return;
    const k = this.hit(e.clientX, e.clientY);
    if (!k) return;
    e.preventDefault();
    this.fingers.set(e.pointerId, { k, dir: k === 'move' ? this.dirAt(e.clientX) : 0 });
    this.refresh();
  },

  move(e) {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    e.preventDefault();
    if (f.k === 'move') f.dir = this.dirAt(e.clientX);
    else { const k = this.hit(e.clientX, e.clientY, true); if (k) f.k = k; }
    this.refresh();
  },

  up(e) {
    if (!this.fingers.delete(e.pointerId)) return;
    this.refresh();
  },

  // Parmaklardan tuş durumunu yeniden kur; yeni basılanları "dokunuldu" olarak da işaretle
  refresh() {
    if (!this.active()) this.fingers.clear();
    const now = {};
    for (const f of this.fingers.values()) {
      if (f.k === 'move') now[f.dir < 0 ? 'left' : 'right'] = true;
      else now[f.k] = true;
    }
    if (now.left && now.right) now.left = now.right = false;   // iki başparmak da şeritteyse durur
    for (const k of TOUCH_KEYS) {
      if (now[k] && !this.held[k]) {
        this.tapped[k] = true;
        if (k === 'jump' && navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(8);
      }
      if (this.btn) this.btn[k].classList.toggle('on', !!now[k]);
    }
    this.held = now;
  },

  read() {
    const out = {};
    for (const k of TOUCH_KEYS) out[k] = !!(this.held[k] || this.tapped[k]);
    return out;
  },

  endFrame() { this.tapped = {}; },

  // Android'de oyuna girerken tam ekran ve yatay kilit (iPhone Safari'de tam ekran yok, ana ekrana eklenince açılır)
  fullscreen() {
    const el = document.documentElement;
    if (!this.enabled || document.fullscreenElement || !el.requestFullscreen) return;
    if (matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches) return;
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
      .catch(() => { /* izin verilmezse olduğu gibi oynanır */ });
  },
};
