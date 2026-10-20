'use strict';

// Bölümler ASCII olarak yazılır. Her satır aynı uzunlukta olmalı.
//
//   #  duvar / zemin             .  boşluk (en alt satırda boşluk = çukur)
//   S  başlangıç noktası         E  çıkış kapısı (zemine oturur, 2 karo yüksek)
//   K  anahtar                   D  kilitli kapı (anahtarla açılır, komşu D'ler tek kapıdır)
//   1 2 3  düğme                 a b c  düğmeye bağlı kapak (1→a, 2→b, 3→c)
//   H  ağır kutu (sol üst köşesi; 2x2 karo). İtmek için gereken kişi: boxNeed
//
// magnet: true olan bölümlerde mıknatıs açıktır. pols: oyuncuların başlangıç kutupları (1 = +, -1 = −).
//
// Tek başına zıplama 2 karoyu aşar, 3 karoyu aşamaz. Biri diğerinin üstüne çıkarsa 3 karo aşılır.

const LEVELS = [
  {
    name: 'Merhaba',
    hint: 'Yürü, zıpla ve hep birlikte kapıya girin. Çukura düşen arkadaşının yanında doğar.',
    map: [
      '################################',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#.................##...........#',
      '#.SS.......#......##.........E.#',
      '########################..######',
    ],
  },
  {
    name: 'Anahtar',
    hint: 'Anahtarı kapıya götürün. Eylem tuşu anahtarı bırakır ya da arkadaşına atar.',
    map: [
      '################################',
      '#...................D..........#',
      '#...................D..........#',
      '#...................D..........#',
      '#...................D..........#',
      '#...................D..........#',
      '#...................D..........#',
      '#...................D..........#',
      '#.....K.............D..........#',
      '#....####...........D..........#',
      '#.SS.####...........D........E.#',
      '################################',
    ],
  },
  {
    name: 'Kule',
    hint: 'Anahtar tek başına ulaşılamayacak kadar yüksekte. Biriniz diğerinin üstüne çıkıp oradan zıplasın.',
    map: [
      '################################',
      '#...................D..........#',
      '#...................D..........#',
      '#...................D..........#',
      '#...................D..........#',
      '#...................D..........#',
      '#...................D..........#',
      '#..K................D..........#',
      '######..............D..........#',
      '#...................D..........#',
      '#.SS................D........E.#',
      '################################',
    ],
  },
  {
    name: 'Nöbetçi',
    hint: 'Düğmenin üstünde duran kapağı açık tutar. Sırayla birbirinize kapı açın.',
    map: [
      '################################',
      '#..............a...............#',
      '#..............a...............#',
      '#..............a...............#',
      '#..............a...............#',
      '#..............a...............#',
      '#..............a...............#',
      '#..............a...............#',
      '#..............a...............#',
      '#..............a...............#',
      '#.SS....1......a......1......E.#',
      '################################',
    ],
  },
  {
    name: 'Ağır kutu',
    hint: 'Kutu tek kişiyle kıpırdamaz. Birlikte itin ve duvarın dibine basamak yapın.',
    boxNeed: 2,
    map: [
      '################################',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#............................E.#',
      '#...................############',
      '#.......H...........############',
      '#.SS................############',
      '################################',
    ],
  },
  {
    name: 'Hepsi birden',
    hint: 'Kutu, kule, anahtar ve düğme: öğrendiğiniz her şey bu bölümde.',
    boxNeed: 2,
    map: [
      '########################################',
      '#..........................D.....a.....#',
      '#..........................D.....a.....#',
      '#..........................D.....a.....#',
      '#....................K.....D.....a.....#',
      '#...................####...D.....a.....#',
      '#..........................D.....a.....#',
      '#..........................D.....a.....#',
      '#.............##############.....a.....#',
      '#.....H.......##############.....a.....#',
      '#.SS..........##############...1.a.1..E#',
      '########################################',
    ],
  },
  {
    name: 'Fırlatma',
    hint: 'Aynı kutuptasınız. Biriniz diğerinin üstüne çıksın, alttaki mıknatısı açınca (eylem tuşunu basılı tut) üstteki fırlar. Yukarı çıkan kutbunu değiştirip arkadaşını çekerek alsın.',
    magnet: true,
    pols: [1, 1],
    map: [
      '################################',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#...........................E..#',
      '#.................##############',
      '#.................##############',
      '#.................##############',
      '#.................##############',
      '#.SS..............##############',
      '################################',
    ],
  },
  {
    name: 'Uçurum',
    hint: 'Boşluk zıplanamayacak kadar geniş. Aynı kutupta biri diğerini karşıya itsin, karşıya geçen kutbunu değiştirip öbürünü çeksin.',
    magnet: true,
    pols: [1, 1],
    map: [
      '################################',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#.SS.........................E.#',
      '############......##############',
    ],
  },
  {
    name: 'Metal anahtar',
    hint: 'Anahtar metaldir: mıknatısı açınca kutbun ne olursa olsun sana gelir.',
    magnet: true,
    map: [
      '################################',
      '#...................D..........#',
      '#...................D..........#',
      '#...................D..........#',
      '#......K............D..........#',
      '#.....####..........D..........#',
      '#...................D..........#',
      '#...................D..........#',
      '#...................D..........#',
      '#...................D..........#',
      '#.SS................D........E.#',
      '################################',
    ],
  },
  {
    name: 'Mıknatıs ustası',
    hint: 'Önce uçurum, sonra yüksek duvar. İtmek mi çekmek mi, hangisi ne zaman?',
    magnet: true,
    pols: [1, 1],
    map: [
      '########################################',
      '#......................................#',
      '#......................................#',
      '#......................................#',
      '#......................................#',
      '#...................................E..#',
      '#.........................##############',
      '#.........................##############',
      '#.........................##############',
      '#.........................##############',
      '#.SS......................##############',
      '############......######################',
    ],
  },
];

// ---------- Kendi bölümün: doğrulama ve linke sığdırma ----------

const LEVEL_CHARS = '#.SEKD123abcH';
const LEVEL_LIMITS = { minCols: 10, maxCols: 48, minRows: 6, maxRows: 20, name: 24 };

// Bölüm oynanabilir mi? Hata listesi döner (boşsa geçerli). Sunucu da aynı kontrolü yapar.
function validateLevel(def) {
  const L = LEVEL_LIMITS, errs = [];
  if (!def || !Array.isArray(def.map) || !def.map.length) return ['Bölüm okunamadı.'];
  const rows = def.map.length, cols = String(def.map[0]).length;
  if (cols < L.minCols || cols > L.maxCols || rows < L.minRows || rows > L.maxRows) {
    errs.push(`Boyut ${L.minCols}–${L.maxCols} sütun, ${L.minRows}–${L.maxRows} satır olmalı.`);
  }
  if (def.map.some(r => typeof r !== 'string' || r.length !== cols)) return errs.concat('Satırlar aynı uzunlukta olmalı.');
  const all = def.map.join('');
  if ([...all].some(ch => !LEVEL_CHARS.includes(ch))) errs.push('Bilinmeyen bir karo var.');
  const count = ch => all.split(ch).length - 1;
  if (count('S') < 1) errs.push('Bir başlangıç noktası koy.');
  if (count('E') !== 1) errs.push('Bir çıkış kapısı koy.');
  if (def.map[0].includes('E')) errs.push('Çıkış en üst satırda olamaz.');
  def.map.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch !== 'H') return;
    const fits = c + 1 < cols && r + 1 < rows && row[c + 1] === '.' && def.map[r + 1][c] === '.' && def.map[r + 1][c + 1] === '.';
    if (!fits) errs.push('Ağır kutunun 2×2 boş yeri olmalı.');
  }));
  if (typeof def.name !== 'string' || !def.name.trim() || def.name.length > L.name) errs.push(`Bölüme bir ad ver (en fazla ${L.name} harf).`);
  return [...new Set(errs)];
}

// Linke sığdırma: satırlar uzun tekrarlar "(sayı)karo" olarak kısaltılır, sonra base64url.
// (Karo karakterleri arasında rakam olduğu için sayı parantez içindedir.)
function encodeLevel(def) {
  const rle = def.map.map(row => row.replace(/(.)\1*/g, m => (m.length > 2 ? `(${m.length})${m[0]}` : m))).join('/');
  const json = JSON.stringify({ n: def.name, m: def.magnet ? 1 : 0, r: rle });
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeLevel(code) {
  try {
    const bin = atob(String(code).replace(/-/g, '+').replace(/_/g, '/'));
    const json = new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)));
    const o = JSON.parse(json);
    const map = String(o.r).split('/').map(row => row.replace(/\((\d+)\)(.)/g, (_, n, ch) => ch.repeat(Math.min(+n, 64))));
    const def = { name: String(o.n || ''), magnet: !!o.m, map };
    return validateLevel(def).length ? null : def;
  } catch (e) {
    return null;
  }
}
