# Top Takımı (çalışma adı)

Arkadaşlarla aynı klavyede oynanan, birlikte çözülen bir top bulmaca oyunu (Pico Park tarzı).
Bölümleri tek başına geçemezsin: üst üste binmek, düğme tutmak, kutuyu birlikte itmek ve anahtarı
taşımak gerekir. İleri bölümlerde herkes bir mıknatısa dönüşür: aynı kutup iter, zıt kutup çeker.
Ölüm yok, acele yok.

## Çalıştırma

Kurulum gerekmez. `index.html` dosyasını tarayıcıda açman yeterli. Ya da yerel bir sunucuyla:

```bash
python3 -m http.server 5173
```

Sonra http://localhost:5173 adresini aç. Oyuncular kendi zıplama tuşuna basarak katılır (en az 2 kişi).

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
node test/sim.test.js
```

Fizik ve mıknatıs kurallarını, 10 bölümün hepsinin iki oyuncuyla otomatik geçilebildiğini kontrol eder.

## Yapı

```
index.html        Menüler ve HUD
css/style.css     Arayüz stilleri
js/config.js      Oyun adı (GAME_TITLE), fizik sabitleri, renkler
js/levels.js      Bölümler
js/input.js       Klavye şemaları ve gamepad
js/game.js        Simülasyon: fizik, anahtar, kapı, düğme, kutu, çıkış
js/render.js      Canvas çizimi
js/main.js        Ekranlar ve oyun döngüsü
test/sim.test.js  Başsız testler
```

`game.js` yalnızca oyuncu başına `{ left, right, jump, action }` girişini alır ve çizimden bağımsızdır.
Online sürümde aynı dosya sunucuda çalışacak.

## Yol haritası

- [ ] Online oda: link paylaşıp herkes kendi cihazından (Node.js + WebSocket)
- [ ] Daha fazla bölüm
- [ ] Ses ve müzik
- [ ] Oyun adı
