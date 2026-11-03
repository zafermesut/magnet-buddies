'use strict';

// Çalışma adı: oyunun adı kesinleşince sadece burayı değiştir.
const GAME_TITLE = 'Magnet Buddies';

const T = 40;   // karo boyutu (px)
const EXIT_W = 70;   // çıkış kapısının genişliği: iki top yan yana sığar

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

  // Hurdalık öğeleri
  liftSpeed: 120,      // asansör (px/sn)
  moverSpeed: 90,      // gezgin platform (px/sn)
  moverPause: 1.2,     // gezgin platformun uçlarda bekleme süresi (sn)
  springV: 860,        // yayın fırlatma hızı: ~4 karo; zıplama tuşu basılıysa springBoost katı (~5 karo)
  springBoost: 1.12,

  // Fabrika öğeleri
  beltSpeed: 110,      // taşıyıcı bant üstündekini bu hızla taşır (px/sn)
  pressDown: 520,      // pres iniş hızı (px/sn)
  pressUp: 150,        // pres çıkış hızı (px/sn)
  pressWait: 1.2,      // pres yukarıda bekler (sn)
  pressRest: 0.5,      // pres aşağıda bekler (sn)
  timerHold: 4,        // zamanlı düğme bırakıldıktan sonra kanalı bu kadar açık tutar (sn)

  // Buzul öğeleri
  iceAccel: 300,       // kaygan buzda hızlanma (normal 2400)
  iceSpeed: 330,       // buzda uzun koşunca ulaşılan hız (normal 230): uzun koşuyla geniş çukur aşılır
  iceFriction: 150,    // kaygan buzda yavaşlama (normal 2800): bırakınca uzun kayarsın
  thawTime: 1,         // eriyen buz: değdikten bu kadar sonra kırılır (sn)
  thawRegrow: 3,       // kırılan eriyen buz bu kadar sonra yeniden donar (boşsa)
  snowGrow: 120,       // kar topu karlı zeminde bu kadar yuvarlanınca büyür (px)
  snowSmall: 38,       // küçük kar topu (tek kişi iter)
  snowBig: 80,         // büyük kar topu (iki kişi iter): iki karo, 2×2 hendeği tam doldurur

  // Kuzey Işıkları öğeleri
  auroraGravity: 0.4,  // ışık perdesinde yerçekimi bu kata iner: zıplama ~6 karo, uzun süzülme
  auroraFall: 380,     // perdede en fazla bu hızla düşülür
  bridgeGrow: 10,      // ışık köprüsü saniyede bu kadar karo uzar
  bridgeFade: 20,      // kanal kapanınca saniyede bu kadar karo söner

  // Mıknatıs: eylem tuşunu basılı tutan oyuncu çevresindekileri iter (aynı kutup) ya da çeker (zıt kutup).
  // Kendisi etkilenmez. Anahtar metaldir: kutup ne olursa olsun çekilir.
  magnetRange: 280,
  magnetForce: 5000,
  magnetKeyForce: 3500,
  crateSpeed: 150,     // metal sandık tek kişiyle bu hızla itilir
  crateSize: 38,

  // Sabit mıknatıs: zıt kutuptakini çeker (tavana yapışmaya yeter), aynı kutuptakini iter
  fixedRange: 150,
  fixedForce: 4200,
  fixedMax: 6000,      // birden çok bloğun toplam ivme sınırı
  wallSlide: 120,      // mıknatıslı duvara yapışıkken en fazla bu hızla aşağı kayar
};

const POLE_COLORS = { 1: '#ff8787', '-1': '#66d9e8' };

const PLAYER_COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c'];
const CHANNEL_COLORS = { 1: '#ff922b', 2: '#b197fc', 3: '#63e6be' };
