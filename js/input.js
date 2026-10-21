'use strict';

// Yerel çok oyunculu giriş: aynı klavyede 4 şema + gamepad'ler.
// Her şema { left, right, jump, action } üretir; oyun bunun nereden geldiğini bilmez.

const SCHEMES = [
  // hint: temel kontroller · magnetHint: mıknatıslı bölümlerde eklenen kontroller
  { id: 'wasd', label: 'W A S D', hint: 'A D yürü · W zıpla · S eylem', magnetHint: 'S basılı mıknatıs · E kutup', join: 'W',
    left: ['KeyA'], right: ['KeyD'], jump: ['KeyW', 'Space'], action: ['KeyS'], swap: ['KeyE'] },
  { id: 'arrows', label: 'Ok tuşları', hint: '← → yürü · ↑ zıpla · ↓ eylem', magnetHint: '↓ basılı mıknatıs · sağ Shift kutup', join: '↑',
    left: ['ArrowLeft'], right: ['ArrowRight'], jump: ['ArrowUp'], action: ['ArrowDown'], swap: ['ShiftRight'] },
  { id: 'ijkl', label: 'I J K L', hint: 'J L yürü · I zıpla · K eylem', magnetHint: 'K basılı mıknatıs · U kutup', join: 'I',
    left: ['KeyJ'], right: ['KeyL'], jump: ['KeyI'], action: ['KeyK'], swap: ['KeyU'] },
  { id: 'numpad', label: 'Numpad', hint: '4 6 yürü · 8 zıpla · 5 eylem', magnetHint: '5 basılı mıknatıs · 7 kutup', join: 'Num 8',
    left: ['Numpad4'], right: ['Numpad6'], jump: ['Numpad8'], action: ['Numpad5'], swap: ['Numpad7'] },
];

const Input = {
  down: new Set(),
  tapped: new Set(),   // iki kare arasında basılıp bırakılan tuşlar kaybolmasın
  cur: {},
  prev: {},

  init() {
    const block = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (block.has(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.tapped.add(e.code);
    });
    addEventListener('keyup', e => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
  },

  // Şu an bağlı olan bütün giriş kaynakları (klavye şemaları + gamepad'ler)
  sources() {
    const list = SCHEMES.map(s => ({ id: s.id, label: s.label, hint: s.hint, magnetHint: s.magnetHint, join: s.join }));
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (p && p.connected) list.push({ id: 'pad' + p.index, label: 'Gamepad ' + (p.index + 1), hint: 'Çubuk yürü · A zıpla · B eylem', magnetHint: 'B basılı mıknatıs · X/Y kutup', join: 'A' });
    }
    return list;
  },

  read(id) {
    const s = SCHEMES.find(x => x.id === id);
    if (s) {
      const any = codes => codes.some(c => this.down.has(c) || this.tapped.has(c));
      return { left: any(s.left), right: any(s.right), jump: any(s.jump), action: any(s.action), swap: any(s.swap) };
    }
    const pad = navigator.getGamepads && navigator.getGamepads()[+id.slice(3)];
    if (!pad || !pad.connected) return { left: false, right: false, jump: false, action: false, swap: false };
    const b = i => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const ax = pad.axes[0] || 0;
    return { left: ax < -0.4 || b(14), right: ax > 0.4 || b(15), jump: b(0), action: b(1), swap: b(2) || b(3) };
  },

  // Her karenin başında çağrılır; basılma anlarını (edge) yakalamak için
  update() {
    this.prev = this.cur;
    this.cur = {};
    for (const s of this.sources()) this.cur[s.id] = this.read(s.id);
    this.tapped.clear();
  },

  state(id) { return this.cur[id] || { left: false, right: false, jump: false, action: false, swap: false }; },

  pressed(id, btn) { return !!(this.cur[id] && this.cur[id][btn] && !(this.prev[id] && this.prev[id][btn])); },
};
