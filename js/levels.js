'use strict';

// Bölümler ASCII olarak yazılır. Her satır aynı uzunlukta olmalı.
//
//   #  duvar / zemin             .  boşluk (en alt satırda boşluk = çukur)
//   S  başlangıç noktası         E  çıkış kapısı (zemine oturur, 2 karo yüksek)
//   K  anahtar                   D  kilitli kapı (anahtarla açılır, komşu D'ler tek kapıdır)
//   1 2 3  düğme                 a b c  düğmeye bağlı kapak (1→a, 2→b, 3→c)
//   H  ağır kutu (sol üst köşesi; 2x2 karo). İtmek için gereken kişi: boxNeed
//   4 5 6  şalter (4→a, 5→b, 6→c; eylem tuşuyla çevrilir, açık kalır)
//   -  tek yönlü platform (alttan geçilir, üstüne basılır)
//   x y z  asansör (1/2/3 kanalı açıkken yukarı çıkar; yan yana aynı harfler tek platform,
//          üstündeki ilk duvarın bir karo altında durur)
//   ^  yay (altında duvar olmalı)
//   A B C  ters kapak (kanalı kapalıyken açık, açıkken kapalı)
//   =  gezgin platform (yan yana '=' tek platform; duvara ya da ':' ray sonuna kadar gidip döner)
//   :  ray sonu (görünür durdurucu, içinden geçilir)
//   M  metal sandık (tek kişi iter, mıknatıs çeker)
//   P N  sabit mıknatıs bloğu (+ / −): zıt kutuptaki oyuncuyu çeker, aynı kutuptakini iter
//   p n  kutup kapısı (+ / −): yalnızca aynı kutuptaki oyuncuyu geçirir
//
// magnet: true olan bölümlerde mıknatıs açıktır. pols: oyuncuların başlangıç kutupları (1 = +, -1 = −).
//
// Tek başına zıplama 2 karoyu aşar, 3 karoyu aşamaz. Biri diğerinin üstüne çıkarsa 3 karo aşılır.

const LEVELS = [
  {
    id: 'merhaba',
    name: 'Merhaba',
    hint: 'Yürü, zıpla ve hep birlikte kapıya girin. Çukura düşen, en son durduğu yerde doğar.',
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
    id: 'anahtar',
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
    id: 'kule',
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
    id: 'nobetci',
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
    id: 'agir-kutu',
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
    id: 'salter',
    name: 'Şalter',
    hint: 'Düğme yalnızca üstünde dururken açık tutar; şalter ise bir kez çevrilince açık kalır. Şalteri eylem tuşuyla çevir. Aynı renkteki şalterler aynı kapağı açar.',
    map: [
      '################################',
      '#........a..........b..........#',
      '#........a..........b..........#',
      '#........a..........b..........#',
      '#........a..........b..........#',
      '#........a..........b..........#',
      '#........a..........b..........#',
      '#........a..........b..........#',
      '#........a..........b..........#',
      '#........a..........b..........#',
      '#.SS.1...a.....5....b....4...E.#',
      '################################',
    ],
  },
  {
    id: 'merdiven',
    name: 'Merdiven',
    hint: 'İnce platformlardan alttan geçilir, üstlerine basılır. En üst basamak tek başına zıplanamayacak kadar yüksek: birbirinizin üstüne çıkın.',
    map: [
      '################################',
      '#.....K.............D..........#',
      '#....----...........D..........#',
      '#...................D..........#',
      '#...................D..........#',
      '#....----...........D..........#',
      '#...................D..........#',
      '#........---........D..........#',
      '#...................D..........#',
      '#....---............D..........#',
      '#.SS................D........E.#',
      '################################',
    ],
  },
  {
    id: 'asansor',
    name: 'Asansör',
    hint: 'Asansör, aynı renkteki düğmeye basılı tutulunca yukarı çıkar. Biriniz düğmede dursun, öbürü yukarı çıksın; sonra yukarıdaki düğmeyle sıra değişir.',
    map: [
      '################################',
      '#..............................#',
      '#..............................#',
      '#............##................#',
      '#..................1........E..#',
      '#..............#################',
      '#..............#################',
      '#..............#################',
      '#..............#################',
      '#..............#################',
      '#.1..SS........#################',
      '#############xx#################',
      '################################',
    ],
  },
  {
    id: 'zipzip',
    name: 'Zıp zıp',
    hint: 'Yay seni yukarı fırlatır. Yaya inerken zıplama tuşunu basılı tutarsan daha yükseğe çıkarsın.',
    map: [
      '################################',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#...................4.......E..#',
      '#................###############',
      '#.............a..###############',
      '#.............a..###############',
      '#.............a..###############',
      '#.1..SS.......a.^###############',
      '################################',
    ],
  },
  {
    id: 'hepsi-birden',
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
    id: 'gezgin',
    name: 'Gezgin',
    hint: 'Gezgin platform çukurun üstünde gidip gelir. Önce anahtarı alın: çıkıntı yüksek, birbirinizin üstüne çıkın.',
    map: [
      '################################',
      '#........................D.....#',
      '#........................D.....#',
      '#........................D.....#',
      '#........................D.....#',
      '#........................D.....#',
      '#........................D.....#',
      '#.K......................D.....#',
      '####.....................D.....#',
      '####.....................D.....#',
      '####.SS..................D...E.#',
      '##########===.........##########',
    ],
  },
  {
    id: 'yuk-treni',
    name: 'Yük treni',
    hint: 'Ağır sandığı birlikte itip gezgin platforma yükleyin. Karşıda sandık, yüksek çıkıntıya basamak olur.',
    boxNeed: 2,
    map: [
      '##################################',
      '#................................#',
      '#................................#',
      '#................................#',
      '#................................#',
      '#................................#',
      '#..............................E.#',
      '#...........................######',
      '#...........................######',
      '#....H......................######',
      '#.SS........................######',
      '############====......############',
    ],
  },
  {
    id: 'ters-asansor',
    name: 'Ters asansör',
    hint: 'Ters kapak (yatay çizgili) düğmeye basılınca kapanır. Asansör çıkarken yol kapalı: zamanlamayı birlikte ayarlayın.',
    map: [
      '################################',
      '#................A.............#',
      '#................A.............#',
      '#............##..A.............#',
      '#................A...1......E..#',
      '#..............#################',
      '#..............#################',
      '#..............#################',
      '#..............#################',
      '#..............#################',
      '#.1..SS........#################',
      '#############xx#################',
      '################################',
    ],
  },
  {
    id: 'yay-ve-kule',
    name: 'Yay ve kule',
    hint: 'Yayla rafa çıkın (zıplamayı basılı tutun). Raftaki çıkıntıya kule kurarak çıkın; yukarıdaki düğme asansörü kaldırır.',
    map: [
      '################################',
      '#.....................##.......#',
      '#.........................1..E.#',
      '#.......................########',
      '#.......................########',
      '#.......................########',
      '#.............########xx########',
      '#.............##################',
      '#.............##################',
      '#.............##################',
      '#.SS.........^##################',
      '################################',
    ],
  },
  {
    id: 'hurda-dagi',
    name: 'Hurda dağı',
    hint: 'Gezgin platform, düğme, yay, şalter, asansör: hepsi bu dağda. Sonunda asansöre birlikte binip şalteri çevirin.',
    map: [
      '########################################',
      '#......................................#',
      '#..............................##......#',
      '#....................................E.#',
      '#................................#######',
      '#................................#######',
      '#................................#######',
      '#...........................4.5..#######',
      '#.........................#####yy#######',
      '#......................a..##############',
      '#......................a..##############',
      '#......................a..##############',
      '#...SS...............1.a.^##############',
      '############===.....####################',
    ],
  },
  {
    id: 'firlatma',
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
    id: 'ucurum',
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
    id: 'metal-anahtar',
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
    id: 'metal-sandik',
    name: 'Metal sandık',
    hint: 'Metal sandık hafiftir: tek kişi iter, mıknatıs kutbu ne olursa olsun çeker. Rafın yanında mıknatısı açıp indirin, duvara dayayıp basamak yapın.',
    magnet: true,
    map: [
      '################################',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#....M......................E..#',
      '######..................########',
      '#.......................########',
      '#.......................########',
      '#........SS.............########',
      '################################',
    ],
  },
  {
    id: 'miknatis-ustasi',
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
  {
    id: 'yapiskan-tavan',
    name: 'Yapışkan tavan',
    hint: 'Tavandaki − mıknatıs + kutbu çeker: zıplayıp yapış, asılı yürü. Karşıda kutbunu değiştir, bırakıl.',
    magnet: true,
    pols: [1, 1],
    map: [
      '##################################',
      '#................................#',
      '#................................#',
      '#................................#',
      '#................................#',
      '#................................#',
      '#......NNNNNNNNNNNNNNNNNNNN......#',
      '#..............................E.#',
      '#............................#####',
      '#............................#####',
      '#.SS.........................#####',
      '#########................#########',
    ],
  },
  {
    id: 'miknatis-bacasi',
    name: 'Mıknatıs bacası',
    hint: 'Mıknatıslı duvara zıt kutupla yapış, zıpladıkça tırman; duvardan ayrılmak için kutbunu değiştir. Karşıda düğmelerle birbirinize kapı açın.',
    magnet: true,
    map: [
      '################################',
      '#.....................a........#',
      '#.....................a........#',
      '#...........N.........a........#',
      '#...........N.........a........#',
      '#...........N.........a........#',
      '#...........N.........a........#',
      '#...........N.........a........#',
      '#...........N.........a........#',
      '#...........N.........a........#',
      '#..SS.......N...1.....a..1..E..#',
      '################################',
    ],
  },
  {
    id: 'kutup-kapisi',
    name: 'Kutup kapısı',
    hint: 'Kırmızı kapıdan yalnızca + kutup, mavi kapıdan yalnızca − kutup geçer. Kapının önünde kutbunu değiştir.',
    magnet: true,
    map: [
      '################################',
      '#.......p...........n....D.....#',
      '#.......p...........n....D.....#',
      '#.......p...........n....D.....#',
      '#.......p...........n....D.....#',
      '#.......p...........n....D.....#',
      '#.......p...........n....D.....#',
      '#.......p......K....n....D.....#',
      '#.......p.....####..n....D.....#',
      '#.......p...........n....D.....#',
      '#.SS....p...........n....D..E..#',
      '################################',
    ],
  },
  {
    id: 'ikiye-bolun',
    name: 'İkiye bölün',
    hint: '+ kutup kırmızı zeminden, − kutup mavi zeminden düşer. Aşağıda ayrı odalardasınız: şalterlerle birbirinize kapı açın.',
    magnet: true,
    map: [
      '################################',
      '#..............................#',
      '#..............................#',
      '#..............................#',
      '#.............SS...............#',
      '######pp################nn######',
      '#...........a######b...........#',
      '#...........a######b...........#',
      '#...........a######b...........#',
      '#...........a######b...........#',
      '#...........a######b...........#',
      '#...........a......b...........#',
      '#....5......a..E...b....4......#',
      '################################',
    ],
  },
  {
    id: 'cekirdek',
    name: 'Çekirdek',
    hint: 'Tavan, kutup kapısı, metal sandık ve mıknatıs: çekirdekte hepsi var. Sandık basamak, arkadaşın asansör olsun.',
    magnet: true,
    map: [
      '####################################',
      '#....................n.............#',
      '#....................n.............#',
      '#....................n.............#',
      '#....................n.............#',
      '#....................n.............#',
      '#....................n.............#',
      '#....................n.............#',
      '#......NNNNNNNNNNNN..n....M......E.#',
      '#....................n.####...######',
      '#....................n........######',
      '#....................n........######',
      '#.SS.................n........######',
      '########..........##################',
    ],
  },
];

const levelIndexById = id => LEVELS.findIndex(l => l.id === id);

// Alan 1 · Hurdalık haritasının kısımları (sırası LEVELS ile aynı)
const PARTS = [
  { name: 'Uyanış', ids: ['merhaba', 'anahtar', 'kule', 'nobetci', 'agir-kutu'] },
  { name: 'Hurda yığınları', ids: ['salter', 'merdiven', 'asansor', 'zipzip', 'hepsi-birden'] },
  { name: 'Paslı raylar', ids: ['gezgin', 'yuk-treni', 'ters-asansor', 'yay-ve-kule', 'hurda-dagi'] },
  { name: 'Mıknatıs mezarlığı', ids: ['firlatma', 'ucurum', 'metal-anahtar', 'metal-sandik', 'miknatis-ustasi'] },
  { name: 'Manyetik çekirdek', ids: ['yapiskan-tavan', 'miknatis-bacasi', 'kutup-kapisi', 'ikiye-bolun', 'cekirdek'] },
];
const partOf = i => PARTS.findIndex(p => p.ids.includes(LEVELS[i].id));

// Kilit: ilk bölüm, önceki bölümü geçilmiş ya da kendisi daha önce geçilmiş bölüm açıktır.
// done: geçilen bölüm kimlikleri (Set). Online odada odadakilerin hepsinin birleşimi kullanılır.
function levelUnlocked(i, done) {
  return i === 0 || done.has(LEVELS[i].id) || (i > 0 && done.has(LEVELS[i - 1].id));
}

// ---------- Kendi bölümün: doğrulama ve linke sığdırma ----------

const LEVEL_CHARS = '#.SEKD123abcH456-xyz^ABC=:MPNpn';
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
  def.map.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === '^' && (r + 1 >= rows || def.map[r + 1][c] !== '#')) errs.push('Yayın altında duvar olmalı.');
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
