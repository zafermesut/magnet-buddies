# Magnet.io (çalışma adı)

Tarayıcıda oynanan bir .io oyunu prototipi. Renk kalkanı mekaniği:
kendi rengindeki mermiyi emersin, zıt renktekinden hasar alırsın.

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
| Fare / WASD | Hareket (WASD varsa fare yalnızca nişan alır) |
| Sol tık (basılı) | Ateş |
| Space | Renk değiştir (+ kırmızı / − mavi) |
| Shift / Sağ tık | Patlama (50 enerji, çepeçevre mermi) |
| T | Ayar paneli |

Mobilde ekrana dokunarak yön verilir; nişan en yakın rakibe otomatik alınır. Sağ alttaki butonlar: renk, ateş, patlama.

## Kurallar

- Herkes kırmızı (+) ya da mavi (−) kutuptadır ve rengini anında değiştirebilir.
- **Aynı renk** mermi ve küreler **emilir**: enerji ve skor kazandırır.
- **Zıt renk** mermi ve küreler **can götürür**. Bir süre hasar almazsan can yenilenir.
- Ateş ettiğin mermiler **senin rengindedir**. Rakibi vurmak için onun zıt rengine geçmelisin;
  ama o zaman onun mermileri de sana işler. Rakip son anda senin rengine geçerse mermilerin onu besler.
- Ateş etmek enerji harcar; enerji emerek kazanılır.
- **Kuleler** dönen spiral mermi yağdırır ve ara sıra renk değiştirir (önce yanıp söner).
  Doğru renkteysen enerji kaynağı, yanlış renkteysen tuzaktır.
- Enerji küreleri mıknatıs gibidir: kendi rengindekiler sana akar, zıt renktekiler kaçar.
- Botlar mermiyi ve renk değişimini insan gibi gecikmeli fark eder.

## Yol haritası

- [ ] Raund sistemi: kısa maçlar, daralan arena, son kalan kazanır
- [ ] Gerçek multiplayer (Node.js + Socket.io, sunucu tarafında aynı `game.js`)

## Yapı

```
index.html        Menü, HUD ve ekranlar
css/style.css     Arayüz stilleri
js/config.js      Tüm denge ayarları ve oyunun adı (GAME_TITLE)
js/game.js        Simülasyon: gemiler, mermiler, emme, kuleler, küreler, bot zekâsı
js/render.js      Canvas 2D çizimi ve mini harita
js/main.js        Giriş, oyun döngüsü, arayüz
```

`game.js` çizimden bağımsızdır; ileride multiplayer için aynen sunucuda (Node.js) çalıştırılabilir.
