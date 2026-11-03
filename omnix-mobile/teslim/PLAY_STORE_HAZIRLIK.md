# Google Play — Omnix Field Operation yayın hazırlığı (26.10.2026)

## 0. Durum
- Google Play geliştirici hesabı: Efelis Tarım Ticaret Ltd. Şti. (kuruluş) — kuruluş, kimlik ve telefon doğrulaması **tamamlandı** 26.10.2026.
- Play Console'da uygulama **oluşturuldu** 26.10.2026: ad "Omnix Field Operation", paket `global.omnix.app`, Türkçe (tr-TR), App, Free,
  Play app signing kabul edildi. Console adresi: `play.google.com/console/u/0/developers/7658846550927547615/app/4973910108496791970`.
- EAS Android derlemeleri 26.10.2026 (ikisi de aynı yükleme anahtarıyla, keystore EAS'ta "Build Credentials 9Pp9y_er6f"):
  - **AAB** (Play) — profil `production`, versionCode **2**, build `4f061b32`
  - **APK** (personel, `/mobil` linki) — profil `personel-apk` (eas.json'a eklendi), build `37d473e0`
- Görseller: `teslim/magaza-ekran/play/` (10 telefon ekran görüntüsü 1290×2524 = 1,96:1; `ikon-512.png`; `tanitim-1024x500.png`).
  Kopyası `~/Downloads/Omnix_Play_Gorseller/`.

## 0b. Play Console durumu — 26.10.2026 22:50 (Chrome üzerinden dolduruldu)
Tamamlanan ve "Change saved" olan bölümler (henüz incelemeye GÖNDERİLMEDİ, Publishing overview'da bekliyor):
- Main store listing: metinler + ikon + tanıtım görseli + 8 ekran görüntüsü (AI beyanı: etiketleme yok)
- Store settings: kategori Business; iletişim info@efelis.com + https://omnix.global (telefon boş)
- App content: Gizlilik URL · Reklam yok · Sign-in details (demo.yonetici; şifreyi Orhan girdi; "Google test cihazlarında kullanılsın" açık) ·
  İçerik derecelendirme IARC tamam (Everyone / PEGI 3; IARC şartlarını Orhan işaretledi) · Hedef kitle 18+ · Veri güvenliği (§5'teki gibi;
  silme sayfası destek.html) · Devlet/Finans/Sağlık/Reklam kimliği: yok → "You've caught up with everything"
- Internal testing → Testers: e-posta listesi "Omnix iç test" (orhan.bedir@gmail.com) seçili; katılım linki
  https://play.google.com/apps/internaltest/4700865883802722867 (yayınlanınca aktif)
Kalan: AAB yükle → Internal testing release → Production release (yalnız Türkiye) → Publishing overview'dan "Send for review".

## 0c. GÖNDERİLDİ — 26.10.2026 23:03
- **Internal testing yayında:** sürüm 2 (1.0.0), 26.10 22:58; katılım linki https://play.google.com/apps/internaltest/4700865883802722867 (tester: orhan.bedir@gmail.com).
- **Production incelemeye gönderildi (Orhan onayı):** 10 değişiklik "Changes in review" (sürüm 2 (1.0.0) full rollout, ülke yalnız Türkiye, mağaza kaydı,
  tüm App content beyanları). Google ön kontrolleri (≤14 dk) bitince inceleme kuyruğuna girer; tipik süre 7 güne kadar. Onay → Managed publishing KAPALI olduğu için
  otomatik yayınlanır. Red gelirse Policy status / e-posta ile bildirilir.
- Kalan: APK → `/mobil` (web deploy onayı); mapping (deobfuscation) dosyası sonraki sürümde yüklenebilir (uyarı, engel değil).

## 1. Sıra (Play Console sol menü)
Her adım kaydedilince Dashboard'daki görev listesi kendiliğinden işaretlenir.

1. **Test and release → Testing → Internal testing → Create new release**
   - "App integrity": Play app signing → **Google tarafından yönetilen anahtar** (varsayılan, "Use Google-generated key").
   - AAB dosyasını yükle (Downloads'tan). Release name otomatik (2 (1.0.0)). Release notes (tr-TR): aşağıdaki §3 metni.
   - Testers: **Create email list** → ad "Omnix iç test", e-posta: orhan.bedir@gmail.com (+ Android kullanan 1–2 personel). Save → Next → Save → **Start rollout to Internal testing**.
   - "Copy link" ile test bağlantısını alın; test kullanıcıları bu bağlantıdan katılıp Play'den kurar.
2. **Grow users → Store presence → Main store listing** (§2 metinleri + görseller) → Save.
3. **Monitor and manage → Policy and programmes → App content** (§4 cevapları); her kart "Start" → cevapla → Save.
4. **Grow users → Store presence → Store settings**: kategori **Business**, etiketler (isteğe bağlı), iletişim e-postası, telefon, web sitesi.
5. **Test and release → Production → Create new release**: aynı AAB'yi "Add from library" ile ekle → Countries/regions: **yalnız Türkiye** → Review release → **Start rollout to Production** (inceleme 1–7 gün; ilk yayın genelde 3 güne kadar).

> Not: Yeni hesaplarda Google, üretime çıkmadan önce **en az 12 test kullanıcısıyla 14 gün kapalı test** şartı koyabilir (kişisel hesaplar için zorunlu;
> kuruluş hesaplarında genelde yok). Production sayfasında "Apply for production access" görünürse bu şart devrede demektir; o zaman Closed testing
> → "Omnix kapalı test" listesiyle 14 gün bekleme gerekir.

## 2. Mağaza kaydı (Main store listing, tr-TR)
- **App name (30):** `Omnix Field Operation`
- **Short description (80):** `Telekom saha operasyonu: avans, masraf ve fiş, saha işleri, hakediş — tek uygulama`
- **Full description (4000):** aşağıdaki metin (App Store açıklamasıyla aynı):

```
Omnix Field Operation, telekom ve altyapı saha operasyonlarını yürüten firmalar için geliştirilen Omnix platformunun mobil
uygulamasıdır. Platforma abone firmalar, yöneticileri ve çalıştıkları taşeronlar aynı uygulamayı kullanır; her firma yalnız
kendi verisini görür ve girişten sonra kendi firma adıyla çalışır.

SAHA PERSONELİ
• İş avansı talebi oluşturun, onay adımlarını takip edin
• Masraf formuna kalem ekleyin; fiş fotoğrafı otomatik kırpılır
• Size atanan saha işlerini başlatın ve kapatın
• Clean Up işlerinde önce / sonra fotoğrafı yükleyip onaya gönderin
• Malzeme talebi oluşturun, üzerinizdeki zimmeti görün
• Bağlantı koptuğunda bilgileriniz telefonda kalır, aynı kayıt iki kez oluşmaz

ŞİRKET SAHİBİ VE YÖNETİCİLER
• Şirket özeti ve onay bekleyen işlemler
• Personel Yönetimi: ekip, hesap hareketleri, puantaj, saha işleri ve zimmet
• Maaş gibi hassas bilgiler yalnız yetkili kullanıcıya gösterilir

TAŞERON FİRMALAR
• Size atanan işler, kapsam ve anlaşılmış fiyat
• Merkez kalite kontrolünden geçen işlerin hakedişi
• Faturalarınız, ödenen ve kalan tutarlar
• TSSR, proje ve çizim gibi saha belgeleri

Hesaplar firmanızın yöneticisi tarafından açılır; uygulamada açık kayıt yoktur. Hesabınız yoksa firmanızla iletişime geçin.
```

- **App icon:** `ikon-512.png` (512×512) · **Feature graphic:** `tanitim-1024x500.png` · **Phone screenshots:** `telefon/01…10.png` (en az 2, en çok 8 yüklenir; öneri: 01, 02, 03, 04, 05, 06, 07, 08).
- 7" / 10" tablet ekran görüntüsü zorunlu değil (uygulama telefon odaklı; tablet görüntüsü yüklenmezse Play tablette "telefon için tasarlandı" der, sorun değil).
- **Contact details:** e-posta `info@efelis.com` (destek sayfasındaki adres), telefon `+90 549 741 92 22`, web `https://omnix.global`.
- **Privacy policy URL:** `https://app.omnix.global/gizlilik.html` (canlı, 200).

## 3. Sürüm notları (tr-TR)
```
İlk sürüm. İş avansı ve masraf formları, fiş fotoğrafı, saha işleri, Clean Up fotoğrafları, malzeme talebi ve zimmet;
yöneticiler için onaylar ve personel yönetimi; taşeronlar için işler, hakediş ve faturalar.
```

## 4. App content (Policy → App content) cevapları
| Kart | Cevap |
|---|---|
| Privacy policy | `https://app.omnix.global/gizlilik.html` |
| Ads | **No**, uygulamada reklam yok |
| App access | **All or some functionality is restricted** → Add instructions: demo hesap bilgileri (kullanıcı adı `demo.personel`, `demo.yonetici`, `demo.taseron`; şifre ayrı iletilecek — depoya yazılmaz), not: "Accounts are created by the company administrator; there is no public sign-up. Use the demo accounts to review." |
| Content ratings | Anketi başlat → kategori **Utility, Productivity, Communication or Other** → tüm sorulara **No** (şiddet, cinsellik, kumar, uyuşturucu yok; kullanıcı etkileşimi: çalışanlar arasında içerik paylaşımı yok; konum paylaşımı yok; satın alma yok) → IARC **Everyone / PEGI 3** |
| Target audience and content | Yaş grubu **18 and over** yalnız → "Appeal to children" **No** |
| News apps | **No** |
| COVID-19 contact tracing | **No** |
| Data safety | §5 |
| Government apps | **No** |
| Financial features | **No financial features** (iş avansı/masraf şirket içi muhasebe kaydıdır; ödeme, kredi, cüzdan yok) |
| Health | **No health features** |
| Advertising ID | **No** (uygulama reklam kimliği kullanmaz; AAB manifestinde AD_ID izni yok) |

## 5. Data safety (Veri güvenliği) formu
Genel sorular:
- Does your app collect or share any of the required user data types? **Yes**
- Is all of the user data collected by your app encrypted in transit? **Yes** (yalnız HTTPS)
- Do you provide a way for users to request that their data is deleted? **Yes** — kullanıcı firma yöneticisine veya `info@efelis.com` adresine başvurur; gizlilik politikasında "Hesap silme" bölümü. (Account deletion URL sorulursa: `https://app.omnix.global/destek.html`)

Toplanan veri türleri (hepsi: **Collected**, Shared **No**, Ephemeral **No**, **Required**, amaç **App functionality**; satır sonundaki ek amaçlar belirtilir):

| Kategori → tür | Not |
|---|---|
| Personal info → Name | kullanıcı adı/soyadı (firma kaydı) |
| Personal info → Email address | giriş kimliği |
| Personal info → Phone number | personel kartı (varsa) |
| Personal info → User IDs | kullanıcı/personel numarası |
| Financial info → Other financial info | avans, masraf tutarları, IBAN (ödeme hesabı); amaç: App functionality |
| Photos and videos → Photos | fiş ve Clean Up önce/sonra fotoğrafları (kullanıcı yükler) |
| Files and docs → Files and docs | TSSR/proje belgeleri görüntüleme (taşeron) |
| App activity → App interactions | onay/işlem geçmişi (denetim izi); amaç: App functionality, Fraud prevention/security |
| App info and performance → Crash logs | **No** (çökme raporu SDK'sı yok) |
| Device or other IDs | **No** |
| Location | **No** (konum izni yok) |

Veri işleme: "Data collected is processed ephemerally" → No. Güvenlik uygulamaları: encryption in transit **Yes**; deletion request **Yes**;
"Committed to follow the Play Families Policy" → No (çocuklara yönelik değil); "Independent security review" → No.

## 6. Personel dağıtımı (Android, Play dışı)
- APK: `/mobil` sayfasına **v1.0.0 (2)** olarak konur (web deploy onay ister). Personel linkten indirir; "Bilinmeyen kaynak" izni gerekir.
- Play'den kurulan sürümle aynı imza anahtarı (Play app signing kullanıldığı için Play'deki APK Google anahtarıyla **yeniden imzalanır**; `/mobil`
  APK'sı yükleme anahtarıyla imzalıdır → **iki kaynak birbirinin üstüne güncellenmez**). Bir telefonda tek kaynak seçilmeli: ofis/yönetim Play, saha
  personeli `/mobil`. İleride herkes Play'e geçerse `/mobil` APK'sı kaldırılır.
- "You'll get automatic protection" (installer check) Play sürümüne uygulanır; `/mobil` APK'sı ayrı derlendiği için etkilenmez.

## 7. Sonraki sürümler
- `eas build -p android --profile production` (AAB, versionCode otomatik artar) → Play Console Production → "Create new release".
- `eas build -p android --profile personel-apk` → `/mobil` güncelle.
- iOS ile aynı sürüm numarası (app.config `version`) kullanılır; Play'de versionCode, App Store'da buildNumber ayrı sayaçlardır.

## 1.1.0 güncellemesi (03.11.2026)
- Sürüm 1.1.0 (versionCode EAS "remote" kaynaktan otomatik: 3). Değişiklik: Saha Haritası (Saha sekmesi), yönetici İş Atama (Ana sayfa → Operasyon), personel Issue bildirimi + çevrimdışı kuyruk.
- Release notes (tr-TR):
  Yenilikler
  • Saha Haritası: size atanan işlerin sahaları haritada; yol tarifi alın.
  • İş Atama (yöneticiler): ekibe iş atayın, atamaları görün ve güncelleyin.
  • Sahadan issue / engel bildirimi; bağlantı kopunca bildirimler telefonda bekler, bağlantı gelince gönderilir.
