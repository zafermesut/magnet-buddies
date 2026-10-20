# Magnet Buddies

Arkadaşlarla linkle online ya da aynı klavyede oynanan, birlikte çözülen bir top bulmaca oyunu.
Bölümleri tek başına geçemezsin: üst üste binmek, düğme tutmak, kutuyu birlikte itmek ve anahtarı
taşımak gerekir. İleri bölümlerde herkes bir mıknatısa dönüşür: aynı kutup iter, zıt kutup çeker.
Ölüm yok, acele yok.

## Çalıştırma

İlk seferde bağımlılıkları kur:

```bash
npm install
```

Sonra sunucuyu başlat:

```bash
npm start
```

http://localhost:3000 adresini aç.

- **Online · linkle oyna:** Takma adını yaz, **Oda kur**'a bas ve çıkan linki arkadaşlarına gönder (en fazla 4 kişi).
  Linke tıklayan doğrudan odaya gelir. Bölümü oda kurucusu seçer; yeniden başlatmak (R) ve devam etmek herkese açıktır.
- **Aynı klavyede oyna:** Herkes kendi zıplama tuşuna basarak katılır (en az 2 kişi).

Oyunu kendi bilgisayarından (`localhost`) açtığında oda linki otomatik olarak bilgisayarının yerel ağ
adresini kullanır (`http://192.168…:3000`). Böylece **aynı Wi-Fi'deki** arkadaşların hemen katılabilir.
macOS ilk seferde Node için gelen bağlantılara izin isteyebilir.
Farklı evlerden oynamak için sunucunun internete açık bir yerde çalışması gerekir (bkz. yol haritası).

Sunucu olmadan `index.html` dosyasını doğrudan açarsan yalnızca aynı klavye modu çalışır.

## Kontroller

| Oyuncu | Yürü | Zıpla | Eylem (dokun: anahtarı at · basılı tut: mıknatıs) | Kutup değiştir |
| --- | --- | --- | --- | --- |
| 1P | A D | W (ya da Space) | S | E |
| 2P | ← → | ↑ | ↓ | sağ Shift |
| 3P | J L | I | K | U |
| 4P | Numpad 4 6 | Numpad 8 | Numpad 5 | Numpad 7 |
| Gamepad | Sol çubuk / D-pad | A | B | X / Y |

`R` bölümü yeniden başlatır, `Esc` bölüm seçimine döner.

Not: Bazı klavyeler aynı anda çok fazla tuşa basılınca bazı tuşları algılamaz. Dört kişi oynarken gamepad daha rahattır.

## Kurallar

- Herkes çıkış kapısına girince bölüm biter. Kapıdan çıkmak için zıplama tuşuna bas.
- Tek başına zıplama 2 karoyu aşar, 3 karoyu aşamaz. Arkadaşının üstüne çık ve oradan zıpla.
- Alttaki oyuncu yürürse ya da zıplarsa üstündekini de taşır.
- Anahtara değince alırsın. Bırak tuşu anahtarı önüne doğru atar; arkadaşın havada yakalayabilir.
- Düğmenin üstünde duran, aynı renkteki kapağı açık tutar.
- Ağır kutunun üstündeki noktalar kaç kişinin itmesi gerektiğini gösterir.
- Çukura düşen, ayakta duran bir arkadaşının üstünde yeniden doğar.

### Mıknatıs (🧲 bölümler, 7-10)

- Herkesin bir kutbu vardır (+ ya da −). Kutup tuşuyla istediğin an değiştirirsin.
- Eylem tuşunu basılı tutan oyuncu mıknatıs olur. Kendisi etkilenmez, menzilindekileri etkiler:
  - **Aynı kutup iter:** üstündeki arkadaşını fırlatır, kenardaki arkadaşını boşluğun karşısına iter.
  - **Zıt kutup çeker:** aşağıdaki arkadaşını yukarı çeker, boşluktan atlayanı kendine çeker.
- Anahtar metaldir: kutup ne olursa olsun mıknatısa gelir.
- Ahşap kutu mıknatıstan etkilenmez.

## Yeni bölüm eklemek

Bölümler `js/levels.js` içinde ASCII olarak yazılır. Lejant dosyanın başında. Yeni bölümün
çözülebildiğini doğrulamak için `test/sim.test.js` dosyasına bir senaryo eklenebilir.

## Testler

```bash
npm test
```

- `test/sim.test.js`: fizik ve mıknatıs kuralları, 10 bölümün hepsinin iki oyuncuyla otomatik geçilebildiği
- `test/server.test.js`: sunucuyu başlatıp iki istemciyle oda kurar, katılır, bölüm oynar ve bitirir

## Yapı

```
index.html        Menüler ve HUD
css/style.css     Arayüz stilleri
js/config.js      Oyun adı (GAME_TITLE), fizik sabitleri, renkler
js/levels.js      Bölümler
js/input.js       Klavye şemaları ve gamepad
js/net.js         Online bağlantı: tuşları gönderir, sunucudan gelen durumu uygular
js/game.js        Simülasyon: fizik, anahtar, kapı, düğme, kutu, çıkış
js/render.js      Canvas çizimi
js/main.js        Ekranlar ve oyun döngüsü
server/server.js  Oda sunucusu: dosyaları sunar, odaları yönetir, simülasyonu çalıştırır
test/             Başsız testler
```

`game.js` yalnızca oyuncu başına `{ left, right, jump, action, swap }` girişini alır ve çizimden bağımsızdır.
Online modda aynı dosya sunucuda çalışır: tarayıcılar yalnızca tuş durumunu gönderir, sunucu saniyede
30 kez durumu yayınlar, tarayıcılar bunu yumuşatarak çizer.

## Yol haritası

- [x] Online oda: link paylaşıp herkes kendi cihazından (Node.js + WebSocket)
- [ ] İnternete açmak (farklı evlerden oynamak için bir sunucuya yüklemek)
- [ ] Gecikmeyi azaltmak için kendi topunu anında hareket ettirme (istemci tarafı tahmin)
- [ ] Daha fazla bölüm
- [ ] Ses ve müzik
- [ ] Oyun adı
