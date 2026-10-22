'use strict';

// İstemci tarafı tahmin: online'da kendi topun tuşa beklemeden tepki verir.
// Top yerelde, sunucuyla aynı adım süresiyle ilerletilir; her adımın tuşu ve sonucu geçmişte tutulur.
// Sunucu yayınında her oyuncu için [son tuş sırası, o tuşla geçen adım] gelir. Bundan sunucunun
// geçmişteki hangi adımda olduğu bulunur: top sunucunun konumuna alınır, sonraki adımlar yeniden oynanır.
// Aradaki fark çizimde birden değil, yavaşça kapatılır.

// Geçmişte saklanan oyuncu alanları (sunucudan gelmeyen iç durum dahil)
const PRED_FIELDS = ['x', 'y', 'vx', 'vy', 'onGround', 'ground', 'supported', 'coyote', 'jumpBuf', 'cut',
  'prevJump', 'prevAction', 'prevSwap', 'facing', 'want', 'squash', 'pol', 'magT', 'gripT', 'actT',
  'usedLever', 'magnetOn', 'exitCD', 'fixedOn', 'wallSide'];

const Predict = {
  active: false,
  me: null,        // çizilen asıl oyuncu (game.players[you])
  body: null,      // tahmin edilen kopya
  hist: [],        // { seq, inp, s } her yerel adım için
  acc: 0,
  ex: 0, ey: 0,    // düzeltme sonrası çizimde kapatılacak fark

  reset(g, you) {
    this.me = g.players[you] || null;
    this.body = this.me ? Object.assign({}, this.me) : null;
    this.active = !!this.me;
    this.hist = [];
    this.acc = 0;
    this.ex = this.ey = 0;
  },

  save(b) {
    const s = {};
    for (const k of PRED_FIELDS) s[k] = b[k];
    return s;
  },

  // Yerel adımlar: kare süresi biriktirilir, sunucuyla aynı sabit adımla ilerlenir
  step(g, inp, seq, dt) {
    if (!this.active || this.me.inExit) return;
    this.acc += dt;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      g.predict(this.body, inp, STEP, this.me);
      this.hist.push({ seq, inp, s: this.save(this.body) });
    }
    if (this.hist.length > 600) this.hist.splice(0, this.hist.length - 600);
    this.show(dt);
  },

  // Sunucunun durumu geldi: sv = { x, y, vx, vy, pol, magT, gripT, inExit }, ack = [tuş sırası, adım]
  reconcile(g, sv, ack) {
    if (!this.active) return;
    const b = this.body;
    if (sv.inExit || this.me.inExit) {
      // Kapıdayken tahmin yok; çıkınca sunucunun konumundan yeniden başlanır
      Object.assign(b, sv, { ground: null, onGround: false });
      this.hist = [];
      this.ex = this.ey = 0;
      return;
    }
    const ox = b.x, oy = b.y;
    const [seq, n] = ack;
    const j = this.hist.findIndex(h => h.seq === seq);
    let from;
    if (j >= 0 && j + n - 1 < this.hist.length) {
      // Sunucu, bu tuşun ilk yerel adımından n adım sonrasında: o adımın iç durumuyla başla.
      // Sunucu tuşu bizden uzun tuttuysa (ağ titremesi) bu tuşun son yerel adımında kalınır.
      let i = j + n - 1;
      while (i > j && this.hist[i].seq !== seq) i--;
      if (i >= 0) Object.assign(b, this.hist[i].s);
      from = i + 1;
    } else if (j < 0 && this.hist.length && seq < this.hist[0].seq) {
      // Sunucu tuşlarımızın hiçbirini henüz almadı: geçmişin tamamı yeniden oynanır
      from = 0;
    } else {
      // Geçmişte karşılığı yok (çok eski ya da sunucu önde): doğrudan sunucunun konumuna geç
      from = this.hist.length;
      this.hist = [];
    }
    b.x = sv.x; b.y = sv.y; b.vx = sv.vx; b.vy = sv.vy;
    b.pol = sv.pol; b.magT = sv.magT; b.gripT = sv.gripT;
    for (let k = from; k < this.hist.length; k++) {
      g.predict(b, this.hist[k].inp, STEP, this.me);
      this.hist[k].s = this.save(b);
    }
    if (j > 0) this.hist.splice(0, j);
    // Küçük farklar çizimde yavaşça kapanır; büyük sıçrama (yeniden doğma vb.) hemen uygulanır
    this.ex += ox - b.x;
    this.ey += oy - b.y;
    if (Math.hypot(this.ex, this.ey) > 100) this.ex = this.ey = 0;
  },

  // Çizilen oyuncuya tahmini aktar
  show(dt) {
    const k = Math.exp(-dt * 12);
    this.ex *= k;
    this.ey *= k;
    const p = this.me, b = this.body;
    p.x = b.x + this.ex;
    p.y = b.y + this.ey;
    p.tx = undefined;
    p.vx = b.vx; p.vy = b.vy;
    p.facing = b.facing; p.squash = b.squash; p.pol = b.pol;
    p.magnetOn = b.magnetOn; p.fixedOn = b.fixedOn;
  },
};
