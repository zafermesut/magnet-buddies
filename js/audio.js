'use strict';

// Ses efektleri ve müzik: hepsi WebAudio ile anında üretilir, dosya yoktur.
// Efektler oyunun efekt listesinden (game.effects) tetiklenir; bu liste yerelde de online'da da doludur.
// Tarayıcılar sesi ancak bir tıklama ya da tuştan sonra başlatmaya izin verir.

const Sound = {
  ctx: null,
  settings: { sfx: true, music: true },
  lastT: -1,
  lastGame: null,
  lastPlayed: {},

  load() {
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem('sound') || '{}')); } catch (e) { /* yoksay */ }
    const start = () => { this.start(); removeEventListener('pointerdown', start); removeEventListener('keydown', start); };
    addEventListener('pointerdown', start);
    addEventListener('keydown', start);
  },

  save() { try { localStorage.setItem('sound', JSON.stringify(this.settings)); } catch (e) { /* yoksay */ } },

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.out = ctx.createDynamicsCompressor();
    this.out.connect(ctx.destination);
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = this.settings.sfx ? 0.55 : 0;
    this.sfxGain.connect(this.out);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.settings.music ? 0.32 : 0;
    this.musicGain.connect(this.out);
    // Melodi için hafif yankı (lo-fi)
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = 0.36;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 1800;
    this.echo.connect(tone); tone.connect(fb); fb.connect(this.echo);
    tone.connect(this.musicGain);
    this.noiseBuf = this.makeNoise();
    this.setupHum();
    this.startMusic();
  },

  toggle(kind) {
    this.settings[kind] = !this.settings[kind];
    this.save();
    if (!this.ctx) return;
    const g = kind === 'sfx' ? this.sfxGain : this.musicGain;
    g.gain.setTargetAtTime(this.settings[kind] ? (kind === 'sfx' ? 0.55 : 0.32) : 0, this.ctx.currentTime, 0.08);
  },

  makeNoise() {
    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  },

  // ---------- Yapı taşları ----------

  // Tek nota: dalga, frekans (bitişe kayabilir), süre, ses
  tone(dest, { type = 'sine', f, f2, t = 0, dur = 0.15, vol = 0.3, attack = 0.005, filter }) {
    const c = this.ctx, at = c.currentTime + t;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, at);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    let node = o;
    if (filter) {
      const bq = c.createBiquadFilter();
      bq.type = 'lowpass';
      bq.frequency.value = filter;
      o.connect(bq);
      node = bq;
    }
    node.connect(g);
    g.connect(dest);
    o.start(at);
    o.stop(at + dur + 0.05);
  },

  noise(dest, { t = 0, dur = 0.1, vol = 0.2, type = 'lowpass', freq = 1200, q = 0.8 }) {
    const c = this.ctx, at = c.currentTime + t;
    const src = c.createBufferSource(), bq = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noiseBuf;
    bq.type = type;
    bq.frequency.value = freq;
    bq.Q.value = q;
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(bq); bq.connect(g); g.connect(dest);
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.05);
  },

  // ---------- Ses efektleri ----------

  play(type, e = {}) {
    if (!this.ctx || !this.settings.sfx) return;
    const now = this.ctx.currentTime;
    if (now - (this.lastPlayed[type] || 0) < 0.04) return;   // aynı anda üst üste binmesin
    this.lastPlayed[type] = now;
    const d = this.sfxGain;
    switch (type) {
      case 'jump':
        this.tone(d, { type: 'triangle', f: 320, f2: 640, dur: 0.14, vol: 0.22 });
        break;
      case 'land': {
        const p = e.power || 0.5;
        this.tone(d, { f: 150, f2: 55, dur: 0.12, vol: 0.25 + 0.3 * p });
        this.noise(d, { dur: 0.08, vol: 0.06 + 0.1 * p, freq: 700 });
        break;
      }
      case 'pickup':
        this.tone(d, { type: 'triangle', f: 1046, dur: 0.12, vol: 0.2 });
        this.tone(d, { type: 'triangle', f: 1568, t: 0.07, dur: 0.22, vol: 0.2 });
        break;
      case 'unlock':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(d, { type: 'triangle', f, t: i * 0.07, dur: 0.3, vol: 0.18 }));
        this.noise(d, { t: 0.05, dur: 0.4, vol: 0.06, type: 'highpass', freq: 5000 });
        break;
      case 'click':
        this.tone(d, { type: 'square', f: 880, f2: 660, dur: 0.06, vol: 0.08, filter: 2500 });
        break;
      case 'swap':
        this.tone(d, { f: 420, f2: 840, dur: 0.16, vol: 0.18 });
        this.tone(d, { f: 630, f2: 1260, t: 0.03, dur: 0.14, vol: 0.08 });
        break;
      case 'enter':
        this.tone(d, { f: 660, dur: 0.5, vol: 0.16 });
        this.tone(d, { f: 990, t: 0.06, dur: 0.5, vol: 0.12 });
        break;
      case 'respawn':
        this.tone(d, { f: 220, f2: 880, dur: 0.18, vol: 0.18 });
        break;
      case 'win':
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(d, { type: 'triangle', f, t: i * 0.1, dur: 0.45, vol: 0.18 }));
        [523, 659, 784].forEach(f => this.tone(d, { type: 'sine', f: f / 2, t: 0.5, dur: 1.1, vol: 0.12, attack: 0.05 }));
        break;
    }
  },

  // Oyunun efekt listesindeki yeni olayları çal
  processEffects(game) {
    if (game !== this.lastGame) { this.lastGame = game; this.lastT = game.t; return; }
    let maxT = this.lastT;
    for (const e of game.effects) {
      if (e.t <= this.lastT) continue;
      this.play(e.type, e);
      if (e.t > maxT) maxT = e.t;
    }
    this.lastT = maxT;
    this.setHum(!!game.magnet && game.players.some(p => p.magnetOn && !p.inExit));
  },

  // ---------- Mıknatıs uğultusu ----------

  setupHum() {
    const c = this.ctx;
    this.humGain = c.createGain();
    this.humGain.gain.value = 0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    for (const f of [110, 110.7, 220.4]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    const lfo = c.createOscillator(), lfoGain = c.createGain();
    lfo.frequency.value = 5;
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    lfo.start();
    lp.connect(this.humGain);
    this.humGain.connect(this.sfxGain);
  },

  setHum(on) {
    if (!this.ctx) return;
    this.humGain.gain.setTargetAtTime(on ? 0.09 : 0, this.ctx.currentTime, 0.06);
  },

  // ---------- Müzik: sakin lo-fi döngüsü ----------

  startMusic() {
    const bpm = 84;
    this.beat = 60 / bpm;
    // Fmaj7 – Em7 – Dm7 – Cmaj7 (her biri bir ölçü)
    this.chords = [
      [53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59],
    ];
    this.scale = [60, 62, 64, 67, 69, 72, 74, 76];   // Do majör pentatonik
    this.step = 0;
    this.melodyIdx = 3;
    this.nextTime = this.ctx.currentTime + 0.2;
    setInterval(() => this.schedule(), 40);
  },

  midi(n) { return 440 * Math.pow(2, (n - 69) / 12); },

  schedule() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const eighth = this.beat / 2;
    while (this.nextTime < c.currentTime + 0.15) {
      const t = this.nextTime - c.currentTime;
      const s = this.step % 32;            // 4 ölçü × 8 sekizlik
      const chord = this.chords[Math.floor(s / 8)];
      const m = this.musicGain;
      if (s % 8 === 0) {
        // Akor (yumuşak, filtreli) ve bas
        for (const n of chord) this.tone(m, { type: 'triangle', f: this.midi(n), t, dur: this.beat * 4, vol: 0.045, attack: 0.25, filter: 1200 });
        this.tone(m, { f: this.midi(chord[0] - 12), t, dur: this.beat * 1.8, vol: 0.16, attack: 0.02 });
      }
      if (s % 8 === 4) this.tone(m, { f: this.midi(chord[0] - 12), t, dur: this.beat * 1.6, vol: 0.12, attack: 0.02 });
      // Davul: vuruş 1 ve 3'te kick, 2 ve 4'te yumuşak snare, sekizliklerde çok hafif hi-hat
      if (s % 4 === 0) this.tone(m, { f: 120, f2: 45, t, dur: 0.18, vol: s % 8 === 0 ? 0.35 : 0.25 });
      if (s % 4 === 2) this.noise(m, { t, dur: 0.14, vol: 0.06, type: 'bandpass', freq: 1800, q: 0.7 });
      this.noise(m, { t, dur: 0.03, vol: s % 2 ? 0.012 : 0.02, type: 'highpass', freq: 7000 });
      // Melodi: pentatonikte yavaşça gezinen, yer yer susan, yankılı notalar
      if (Math.random() < (s % 2 ? 0.25 : 0.5)) {
        this.melodyIdx = Math.max(0, Math.min(this.scale.length - 1, this.melodyIdx + [-2, -1, -1, 0, 1, 1, 2][Math.random() * 7 | 0]));
        this.tone(this.echo, { type: 'sine', f: this.midi(this.scale[this.melodyIdx] + 12), t, dur: eighth * 1.6, vol: 0.07, attack: 0.01 });
        this.tone(m, { type: 'sine', f: this.midi(this.scale[this.melodyIdx] + 12), t, dur: eighth * 1.6, vol: 0.06, attack: 0.01 });
      }
      this.nextTime += eighth;
      this.step++;
    }
  },
};

Sound.load();
