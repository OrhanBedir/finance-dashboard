# Omnix / ERC Operasyon — Mağaza Metinleri (App Store + Google Play)

> Geliştirici/satıcı: **Efelis Tarım Ticaret Ltd. Şti.** (görünen ad: **Omnix**).
> Müşteri firmalar (Şimşek, AHY, …) kullanıcıdır; hesaplar firma bazlıdır.

## Ortak

- **Uygulama adı:** ERC Operasyon *(öneri: çok firmalı satışta "Omnix" — yeni uygulama kaydı gerektirir, karar Orhan'ın)*
- **Geliştirici adı (mağazada görünen):** Omnix
- **Kısa açıklama (30-80 karakter):**
  Kurumsal saha operasyon ve hakediş takibi — Omnix platformu
- **Kategori:** İş / Business
- **Yaş sınıfı:** 4+ (App Store) · Herkes (Play)
- **Gizlilik politikası URL:** https://app.omnix.global/gizlilik.html
- **Destek e-postası:** orhan.bedir@gmail.com *(öneri: destek@omnix.global açılınca güncelle)*

## Uzun açıklama (iki mağazada da aynı)

Omnix, telekom ve saha operasyonu yürüten kurumsal firmalar için geliştirilen
operasyon ve hakediş takip platformudur. Bu uygulama, platforma abone firmaların
saha personeli içindir.

Uygulama ile saha personeli:
- İş avansı talebi oluşturur (yakıt taleplerinde atanan araç plakası otomatik gelir),
- Masraf formu doldurur ve fiş/fatura fotoğrafı yükler,
- Üzerindeki malzemeleri ve zimmetleri takip eder,
- Araç kilometre bilgisini bildirir.

Uygulama yalnızca firmanız tarafından tanımlanan hesaplarla kullanılabilir; halka
açık kayıt yoktur. Hesabınız yoksa firmanızdaki yöneticinizle iletişime geçin.

## App Store — ek alanlar

- **Ekran görüntüleri:** 6.7" ve 6.1" boyutlarında 3-5 adet: giriş ekranı, ana menü,
  iş avans talebi (Yakıt + plaka otomatik), masraf formu, malzeme listesi.
- **App Review notları (İngilizce):**
  "Omnix is a B2B field-operations platform. This app is used by field staff of
  subscriber companies; public registration is not available.
  Demo credentials for review: [DEMO E-POSTA] / [DEMO ŞİFRE] — this account contains
  sample data only."
- **Unlisted başvurusu:** yayın onayı sonrası https://developer.apple.com/contact/request/unlisted-app/
  formuna: "Omnix is a B2B operations app used exclusively by employees of subscriber
  companies. It is not intended for public discovery. We request unlisted distribution
  so staff can install it via direct link."

## Google Play — ek alanlar

- **Kayıt:** Organisation hesabı · yasal ad **EFELİS TARIM TİCARET LİMİTED ŞİRKETİ**
  (İstiklal Mah. Dülger Sk. No:6 İç Kapı No:1, Gürsu/Bursa) · D-U-N-S Efelis adına
  sorgulanır/alınır (dnb.com → Google Developers → Türkiye).
- **Data safety formu:** Veri toplanıyor: ad, e-posta, kullanıcı içeriği (iş kayıtları,
  fotoğraflar). Paylaşım: yok. Şifreleme: evet (HTTPS). Silme talebi: destek e-postasıyla.
- **İlk kurulum:** Play Console → Uygulama oluştur → Kapalı test kanalına AAB yükle
  (eas build --platform android --profile store) → personel e-postalarını test
  kullanıcısı ekle → yayınla.

## Demo hesap (App Review için) — ORHAN OLUŞTURACAK

Admin Panel → Yeni Kullanıcı: örn. demo@omnix.global / kısıtlı saha personeli rolü,
şifreyi kendin belirle; içine 1-2 örnek (sahte tutarlı) kayıt gir. Bilgileri doğrudan
mağaza formundaki review notes alanına yaz.

## Build komutları

```
# iOS App Store (Unlisted) — Apple bireysel hesapla da olur, DUNS beklemez:
eas build --platform ios --profile store --auto-submit

# Android Play (AAB):
eas build --platform android --profile store
```

## Yol haritası notu

- Bundle id `com.simsektel.ercoperasyon` ve "ERC Operasyon" adı Şimşek markalı.
  Çok firmalı satış büyüyünce yeni bundle id (`global.omnix.app` gibi) + "Omnix"
  adıyla yeni uygulama kaydı düşünülmeli — mevcut kullanıcılar için geçiş planıyla.
- Apple hesabı bireysel (Orhan BEDR); kurumsal görünüm istenirse Apple org hesabı da
  Efelis D-U-N-S'u ile açılabilir (aynı numara iki mağazada da kullanılır).
