'use strict';

// Çalışma adı: oyunun adı kesinleşince sadece burayı değiştir.
const GAME_TITLE = 'Magnet.io';

// Oyunun bütün ayarları. "T" tuşuyla açılan ayar panelindeki kaydırıcılar bu değerleri canlı değiştirir.
const DEFAULT_CONFIG = {
  arenaRadius: 1800,     // Arena yarıçapı (dışı boşluk = ölüm)
  dustCount: 700,        // Haritadaki hedef metal tozu sayısı
  dustRespawn: 20,       // Saniyede yeniden doğan toz (en fazla)
  spikeCount: 14,        // Dikenli mayın sayısı
  botCount: 15,          // Bot sayısı (yeni oyunda uygulanır)

  startMass: 20,         // Başlangıç kütlesi
  baseSpeed: 300,        // Başlangıç kütlesindeki azami hız (px/sn)
  steer: 4,              // Yön değiştirme çevikliği

  forceK: 75,            // Manyetik kuvvet katsayısı
  rangeMul: 4,           // Etki menzili = rangeMul * (r1 + r2)
  minRange: 220,         // En küçük etki menzili
  maxMagAccel: 2200,     // Manyetik ivme üst sınırı

  switchCooldown: 0.6,   // Kutup değiştirme bekleme süresi (sn)
  switchNeutral: 0.15,   // Değişim sırasında nötr (savunmasız) kalınan süre (sn)

  botReaction: 0.5,      // Botların kutup değişimini fark etme süresi (sn, ortalama)

  dashCooldown: 3,       // Dash bekleme süresi (sn)
  dashSpeed: 750,        // Dash hızı

  eatRatio: 1.2,         // Yutmak için gereken kütle oranı
  eatGain: 0.8,          // Yutulan kütlenin ne kadarı kazanılır
  fragBonus: 15,         // Diken/boşluğa itme ödülü (kütle)

  spikeMassLoss: 0.5,    // Dikene çarpınca kaybedilen kütle oranı
  spikeKillBelow: 40,    // Bu kütlenin altındakiler dikende ölür

  decayAbove: 150,       // Bu kütlenin üstünde yavaş erime başlar
  decayRate: 0.02,       // Erime hızı (fazlalığın saniyelik oranı)

  stormEvery: 16,        // Manyetik fırtına aralığı (sn)
  stormDuration: 12,     // Fırtına süresi (sn)
  stormRadius: 380,      // Fırtına yarıçapı
};

const CONFIG = Object.assign({}, DEFAULT_CONFIG);

// Ayar panelinde gösterilecek kaydırıcılar
const TWEAKS = [
  { key: 'forceK', label: 'Manyetik güç', min: 10, max: 250, step: 5 },
  { key: 'switchCooldown', label: 'Kutup bekleme (sn)', min: 0, max: 2, step: 0.05 },
  { key: 'switchNeutral', label: 'Nötr geçiş (sn)', min: 0, max: 0.6, step: 0.01 },
  { key: 'steer', label: 'Çeviklik', min: 1, max: 12, step: 0.5 },
  { key: 'baseSpeed', label: 'Hız', min: 150, max: 500, step: 10 },
  { key: 'dashCooldown', label: 'Dash bekleme (sn)', min: 0.5, max: 8, step: 0.5 },
  { key: 'spikeMassLoss', label: 'Diken hasarı', min: 0.1, max: 0.9, step: 0.05 },
  { key: 'botReaction', label: 'Bot tepki süresi (sn)', min: 0, max: 1.5, step: 0.05 },
  { key: 'botCount', label: 'Bot sayısı (yeni oyun)', min: 0, max: 35, step: 1 },
];
