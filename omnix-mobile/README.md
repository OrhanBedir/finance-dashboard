# Omnix mobil (iPhone öncelikli)

Omnix platformunun yeni mobil uygulaması. Tek uygulama: giriş ekranı Omnix markalı; giriş sonrası kullanıcının
backend'de doğrulanan firması (Şimşek / Teknocenter / …) ve yetkili paneli açılır.

- Eski "ERC Operasyon" uygulaması (`ERC/mobile`, `com.simsektel.ercoperasyon`) **ayrı** ve değiştirilmedi.
- Teknoloji: Expo SDK 54 · React Native 0.81 · React 19 (eski uygulamayla aynı SDK, Expo Go 54 ile test edilir).
- Backend: mevcut ERC/Omnix API (`backend/server.js`) — yeni uç, yeni veritabanı veya yeni alan yok.

## Kimlikler ve ortamlar (`app.config.js`, `eas.json`)

| APP_VARIANT | Telefonda ad | Bundle | API |
|---|---|---|---|
| development | Omnix Geliştirme | `global.omnix.app.dev` | yerel test sunucusu `http://127.0.0.1:5099` |
| test (TestFlight) | Omnix Test (TEST rozetli ikon) | `global.omnix.app` | canlı API (ayrı test sunucusu yok) |
| production | Omnix | `global.omnix.app` | canlı API |

EAS proje kimliği ve App Store Connect uygulama kimliği **henüz yok** (eski projenin kimlikleri bilerek kopyalanmadı):
`EAS_PROJECT_ID` ve `eas.json` → `submit.*.ios.ascAppId` Orhan'ın onayıyla doldurulacak.

## Geliştirme

```bash
npm install
npm test                                   # iş mantığı ve gönderim akışı testleri (node --test)
test/yerel/kur_ve_baslat.sh /tmp/omnix-yerel   # sahte verili yerel backend (canlıya bağlanmaz)
APP_VARIANT=development npx expo start --port 8082   # Expo Go (iOS simülatör) ile aç
YEREL_API=http://127.0.0.1:5099 NODE_PATH=../backend/node_modules node --test test/yerel/uctan_uca.test.mjs
```

Yerel test hesapları ve şifresi `test/yerel/tohum.js` başındadır (yalnız yerel sahte veri).

## Klasörler

- `src/tema` — renk, yazı, boşluk (Omnix logosundan lacivert + altın)
- `src/bilesenler` — kart, buton, rozet, form alanları, onay akışı göstergesi, bağlantı bandı, Omnix/firma kimliği
- `src/oturum` — güvenli oturum (token yalnız iOS anahtar zincirinde), açılışta ve öne gelişte `/auth/me` doğrulaması
- `src/api` — API istemcisi (zaman aşımı, 401 → oturum düşer, teknik hata metni gösterilmez), uçlar, ekran verisi
- `src/mantik` — saf iş mantığı: biçim, durum adları, hesap türü (avans/alacak), çift kayıt önleme, kapsam anahtarı
- `src/taslak` — kullanıcı/firma kapsamlı taslak deposu, fiş fotoğrafı, kaldığı yerden devam eden masraf gönderimi
- `src/ekranlar` — giriş, ana sayfa, harcamalar, masraf formu, kalem + fiş, avans, hesap hareketleri, saha, onaylar, profil
- `teslim/` — teslim notu ve simülatör ekran görüntüleri
