# Magnet.io (çalışma adı)

Tarayıcıda oynanan, mıknatıs fiziğine dayalı bir .io oyunu prototipi.
Aynı kutuplar iter, zıt kutuplar çeker; kutbunu doğru anda değiştiren kazanır.

## Çalıştırma

Kurulum gerekmez. `index.html` dosyasını tarayıcıda açman yeterli.
Ya da yerel bir sunucuyla:

```bash
python3 -m http.server 5173
```

Sonra http://localhost:5173 adresini aç.

## Kontroller

| Tuş | Eylem |
| --- | --- |
| Fare / WASD | Hareket |
| Space / Sol tık | Kutup değiştir (+ / −) |
| Shift / Sağ tık | Demir saçması |
| T | Ayar paneli (kuvvet, bekleme süreleri, bot tepkisi…) |

Mobilde ekrana dokunarak yön verilir; sağ alttaki butonlar kutup değiştirir ve saçma atar.

## Kurallar (mıknatıs sumosu)

- **Kimse kimseyi yiyemez.** Rakip yalnızca **dikenlere** ya da **arena dışındaki boşluğa** itilerek elenir. Puan = frag.
- **Aynı kutuplar iter, zıt kutuplar çeker.** Kutup değiştirmenin bekleme süresi var ve geçişte kısa bir an **nötr** kalırsın.
- **Demir tozu** her iki kutba da çekilir ve etrafında döner:
  - **Ağırlık:** çok demir = daha güçlü ama daha hantal mıknatıs.
  - **Zırh:** en az 10 demirin varsa dikene çarpınca ölmezsin, demirinin yarısını kaybedersin.
  - **Cephane:** saçma, demirini koni şeklinde fırlatır. İsabet alan savrulur, kısa süre sersemler ve demir kaybeder.
- **Mor fırtına** bölgesinde manyetik güç 2 katına çıkar, **sarı fırtına** kutbunu kilitler.
- Botlar kutup değişimini insan gibi gecikmeli fark eder; ani kutup değişimi avantaj sağlar.

## Yol haritası

- [ ] Raund sistemi: 2-3 dakikalık maçlar, daralan arena, son kalan kazanır
- [ ] Gerçek multiplayer (Node.js + Socket.io, sunucu tarafında aynı `game.js`)

## Yapı

```
index.html        Menü, HUD ve ekranlar
css/style.css     Arayüz stilleri
js/config.js      Tüm denge ayarları ve oyunun adı (GAME_TITLE)
js/game.js        Simülasyon: fizik, çarpışma, toz, diken, fırtına, bot zekâsı
js/render.js      Canvas 2D çizimi ve mini harita
js/main.js        Giriş, oyun döngüsü, arayüz
```

`game.js` çizimden bağımsızdır; ileride multiplayer için aynen sunucuda (Node.js) çalıştırılabilir.
