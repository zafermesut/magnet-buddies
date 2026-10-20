'use strict';

// Çalışma adı: oyunun adı kesinleşince sadece burayı değiştir.
const GAME_TITLE = 'Magnet.io';

// Oyunun bütün ayarları. "T" tuşuyla açılan ayar panelindeki kaydırıcılar bu değerleri canlı değiştirir.
const DEFAULT_CONFIG = {
  arenaRadius: 1300,     // Arena yarıçapı (kenar duvardır)
  botCount: 12,          // Bot sayısı (yeni oyunda uygulanır)
  pylonCount: 5,         // Renkli mermi yağdıran kule sayısı
  orbCount: 140,         // Haritadaki enerji küresi sayısı
  orbRespawn: 8,         // Saniyede yeniden doğan küre (en fazla)

  shipRadius: 22,
  baseSpeed: 280,        // Azami hız (px/sn)
  steer: 7,              // Yön değiştirme çevikliği

  maxHp: 100,
  hpRegen: 8,            // Hasar almadan bekleyince saniyede yenilenen can
  regenDelay: 3,         // Yenilenme başlamadan önce beklenen süre (sn)

  maxEnergy: 100,
  startEnergy: 30,

  switchCooldown: 0.25,  // Renk değiştirme bekleme süresi (sn)

  fireRate: 6,           // Saniyede atış
  fireCost: 2,           // Atış başına enerji
  bulletSpeed: 620,
  bulletLife: 1.3,       // sn
  bulletDamage: 6,
  absorbGain: 3,         // Emilen mermi başına enerji

  burstCost: 50,         // Patlama için gereken enerji
  burstCount: 24,        // Patlamadaki mermi sayısı

  orbGain: 4,            // Aynı renk küre: enerji
  orbDamage: 4,          // Zıt renk küre: hasar

  pylonFireRate: 9,      // Kule başına saniyede mermi çifti
  pylonFlipEvery: 5,     // Kulenin renk değiştirme aralığı (sn)
  pylonBulletSpeed: 230,
  pylonBulletLife: 2.6,
  pylonDamage: 5,

  botReaction: 0.35,     // Botların mermiyi/renk değişimini fark etme süresi (sn, ortalama)
};

const CONFIG = Object.assign({}, DEFAULT_CONFIG);

// Ayar panelinde gösterilecek kaydırıcılar
const TWEAKS = [
  { key: 'switchCooldown', label: 'Renk bekleme (sn)', min: 0, max: 1.5, step: 0.05 },
  { key: 'bulletDamage', label: 'Mermi hasarı', min: 2, max: 30, step: 1 },
  { key: 'fireRate', label: 'Atış hızı', min: 2, max: 15, step: 1 },
  { key: 'bulletSpeed', label: 'Mermi hızı', min: 250, max: 1200, step: 10 },
  { key: 'absorbGain', label: 'Emme enerjisi', min: 0, max: 10, step: 0.5 },
  { key: 'pylonFireRate', label: 'Kule yoğunluğu', min: 0, max: 25, step: 1 },
  { key: 'botReaction', label: 'Bot tepki süresi (sn)', min: 0, max: 1.5, step: 0.05 },
  { key: 'baseSpeed', label: 'Hız', min: 150, max: 450, step: 10 },
  { key: 'botCount', label: 'Bot sayısı (yeni oyun)', min: 0, max: 30, step: 1 },
];
