'use strict';

// Çalışma adı: oyunun adı kesinleşince sadece burayı değiştir.
const GAME_TITLE = 'Top Takımı';

const T = 40;   // karo boyutu (px)

// Fizik sabitleri. Tek başına zıplama ~109 px (2 karo aşılır, 3 karo aşılamaz);
// bir arkadaşının üstünden zıplayınca ~143 px (3 karo aşılır).
const PHYS = {
  gravity: 2000,
  maxFall: 1000,
  jumpV: 660,
  jumpCut: 0.45,       // zıplama tuşu erken bırakılırsa yükselme hızı bu oranla kesilir
  coyote: 0.09,        // kenardan düştükten sonra hâlâ zıplanabilen süre (sn)
  jumpBuffer: 0.12,    // yere değmeden az önce basılan zıplamanın hatırlanma süresi (sn)
  runSpeed: 230,
  accel: 2400,
  airAccel: 1600,
  friction: 2800,
  playerSize: 34,
  boxSpeed: 95,
  keySize: 22,
  maxSpeed: 900,

  // Mıknatıs: eylem tuşunu basılı tutan oyuncu çevresindekileri iter (aynı kutup) ya da çeker (zıt kutup).
  // Kendisi etkilenmez. Anahtar metaldir: kutup ne olursa olsun çekilir.
  magnetRange: 280,
  magnetForce: 5000,
  magnetKeyForce: 3500,
};

const POLE_COLORS = { 1: '#ff8787', '-1': '#66d9e8' };

const PLAYER_COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c'];
const CHANNEL_COLORS = { 1: '#ff922b', 2: '#b197fc', 3: '#63e6be' };
