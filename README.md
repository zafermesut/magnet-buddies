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
| Shift / Sağ tık | Dash |
| T | Ayar paneli (kuvvet, bekleme süreleri, hız…) |

Mobilde ekrana dokunarak yön verilir; sağ alttaki butonlar kutup değiştirir ve dash atar.

## Kurallar

- **Metal tozu** her iki kutba da çekilir; topladıkça büyürsün.
- **Zıt kutuplar çeker:** senden en az %20 küçük olanı çekip yutabilirsin.
- **Aynı kutuplar iter:** rakipleri **dikenlere** ya da **arena dışındaki boşluğa** iterek frag al.
- Kutup değiştirmenin bekleme süresi var ve geçiş anında kısa bir süre **nötr** (savunmasız) kalırsın.
- **Mor fırtına** bölgesinde manyetik güç 2 katına çıkar, **sarı fırtına** kutbunu kilitler.

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
