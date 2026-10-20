'use strict';

// Çalışma adı: oyunun adı kesinleşince sadece burayı değiştir.
const GAME_TITLE = 'Magnet.io';

// Oyunun bütün ayarları. "T" tuşuyla açılan ayar panelindeki kaydırıcılar bu değerleri canlı değiştirir.
const DEFAULT_CONFIG = {
  arenaRadius: 1400,     // Arena yarıçapı (dışı boşluk = ölüm)
  dustCount: 400,        // Haritadaki hedef serbest demir tozu sayısı
  dustRespawn: 20,       // Saniyede yeniden doğan toz (en fazla)
  spikeCount: 12,        // Dikenli mayın sayısı
  botCount: 15,          // Bot sayısı (yeni oyunda uygulanır)

  // Demir bulutu: hem zırh, hem cephane, hem ağırlık
  startAmmo: 10,         // Başlangıçtaki demir tozu
  ammoCap: 60,           // Taşınabilecek en fazla demir
  ammoWeight: 0.8,       // Her demirin kütleye katkısı
  coreMass: 20,          // Çekirdek kütlesi (demirsiz)

  baseSpeed: 300,        // Çekirdek kütlesindeki azami hız (px/sn)
  steer: 4,              // Yön değiştirme çevikliği
  bounce: 0.9,           // Mıknatıslar çarpışınca seken enerji oranı

  forceK: 75,            // Manyetik kuvvet katsayısı
  rangeMul: 4,           // Etki menzili = rangeMul * (r1 + r2)
  minRange: 220,         // En küçük etki menzili
  maxMagAccel: 2200,     // Manyetik ivme üst sınırı

  switchCooldown: 0.6,   // Kutup değiştirme bekleme süresi (sn)
  switchNeutral: 0.15,   // Değişim sırasında nötr (savunmasız) kalınan süre (sn)

  botReaction: 0.5,      // Botların kutup değişimini fark etme süresi (sn, ortalama)

  // Demir saçması (Shift / sağ tık)
  blastCount: 14,        // Bir atışta fırlatılan en fazla demir
  blastSpread: 0.45,     // Koninin yarı açısı (radyan)
  blastSpeed: 950,       // Mermi hızı
  blastImpulse: 110,     // Her isabetin savurma gücü
  blastRecoil: 220,      // Atıcıya geri tepme
  blastCooldown: 1,      // Atış bekleme süresi (sn)
  hotTime: 0.55,         // Merminin tehlikeli kaldığı süre (sn)
  stunTime: 0.45,        // Saçma isabetinden sonra kontrolün azaldığı süre (sn)

  spikeArmor: 10,        // Dikene çarpınca hayatta kalmak için gereken demir
  spikeAmmoLoss: 0.5,    // Dikende kaybedilen demir oranı

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
  { key: 'botReaction', label: 'Bot tepki süresi (sn)', min: 0, max: 1.5, step: 0.05 },
  { key: 'steer', label: 'Çeviklik', min: 1, max: 12, step: 0.5 },
  { key: 'baseSpeed', label: 'Hız', min: 150, max: 500, step: 10 },
  { key: 'blastImpulse', label: 'Saçma gücü', min: 10, max: 200, step: 5 },
  { key: 'blastCooldown', label: 'Saçma bekleme (sn)', min: 0.2, max: 4, step: 0.1 },
  { key: 'bounce', label: 'Çarpışma sekmesi', min: 0.2, max: 1.5, step: 0.05 },
  { key: 'botCount', label: 'Bot sayısı (yeni oyun)', min: 0, max: 35, step: 1 },
];
