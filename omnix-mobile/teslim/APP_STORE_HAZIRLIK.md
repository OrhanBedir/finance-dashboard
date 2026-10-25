# Omnix Field Operation — App Store gönderim hazırlığı (25.10.2026)

**Karar (Orhan, 25.10.2026):** App Store'da **herkese açık** yayın (Unlisted değil), **yalnız Türkiye**. Gönderim Orhan'ın TestFlight
testi ve açık onayından sonra. **App Store Connect'te "Add for Review"a basılmadı; hiçbir alan doldurulmadı.** Bu belge doldurulacak
metinlerin ve çekilecek kaydın hazırlığıdır.

Uygulama: Omnix Field Operation · ASC 6826747737 · bundle `global.omnix.app` · SKU OMNIX-FIELD-001 · birincil dil Türkçe.
Satıcı/geliştirici hesabı: Orhan BEDR (bireysel, team 42H743X873). Platform sağlayıcı: Efelis Tarım Ticaret Ltd. Şti. (Omnix).

> ERC Operasyon 1.0 (15) 15.08.2026'da **Guideline 2.1 – Information Needed** ile reddedilmişti. Apple'ın istediği her madde aşağıdaki
> notta baştan veriliyor: ekran kaydı, test cihazları, işlev + hedef kitle, demo hesap, dış servisler, bölge, sektör.

---

## 1. App Review Information → Notes (İngilizce, yapıştırmaya hazır)

Köşeli parantezli yerler gönderimden önce doldurulur.

```
WHAT THE APP IS
Omnix Field Operation is the mobile client of Omnix (omnix.global), a multi-company B2B platform for telecom field operations
in Turkey. Subscriber companies (telecom field contractors) and their subcontractors use it to run day-to-day site work.
It is not an internal app of a single company: each subscriber company is an isolated tenant, sees only its own data,
and shows its own company name after sign-in.

WHO USES IT (three roles, decided by the server after sign-in)
1) Field staff of a subscriber company: work-advance requests, expense forms with receipt photos, assigned site jobs
   (start / finish), site clean-up photos (before / after), material requests and assigned equipment.
2) Company owners / managers: company summary, pending approvals, personnel management (team, accounts, field activity)
   limited to their own company.
3) Subcontractor companies: jobs assigned to them with the agreed price, earnings after central QC, their invoices and
   payments, and technical site documents (TSSR, drawings).

ACCOUNTS AND ACCOUNT DELETION
There is no public sign-up. Accounts are created, deactivated and deleted by the administrator of each subscriber company
in the Omnix web panel (the company is the data controller under Turkish data protection law KVKK). Users cannot create
an account in the app, so in-app account creation and in-app account deletion do not exist. A user who wants their
account or data removed contacts their company administrator or [destek e-postası]; the request
is fulfilled in the web panel. This is described in the privacy policy (Account deletion section).

DEMO ACCOUNTS (sample data only, isolated demo company — no real customer data)
Field staff:   [demo.personel@omnix.global] / [şifre]
Company owner: [demo.yonetici@omnix.global] / [şifre]
Subcontractor: [demo.taseron@omnix.global] / [şifre]
Suggested path (field staff): Sign in → Home (account summary) → Expenses → open the draft form → Add item → take or
choose a receipt photo → the receipt is cropped automatically → Save. Field tab → My jobs → open a job → Start.
Company owner: Home → Personnel management → open a person. Subcontractor: Home → Jobs → open a job → Earnings → Invoices.

SCREEN RECORDING
A screen recording made on a physical iPhone, starting from app launch (sign-in, camera and photo permission prompts,
main flows of all three roles, sign-out) is attached / available at: [bağlantı].

DEVICES TESTED
[Orhan'ın iPhone modeli], iOS [sürüm] (physical device, TestFlight build [no]); iPhone 17 and iPhone 17e simulators, iOS 26.5.

PERMISSIONS
Camera and Photo Library: only to photograph expense receipts and site clean-up work, when the user taps "Camera"/"Gallery".
The app does not use location, contacts, microphone, tracking or advertising.

THIRD-PARTY SERVICES (all used only to provide the app's functionality)
- Render: application server (API).
- Supabase (EU, Ireland): database and file storage.
- Anthropic Claude API: automatic receipt cropping / reading. Only the receipt photo the user chose to upload is sent;
  no account or contact data. No data is used for advertising or tracking; nothing is sold.

REGION AND SECTOR
Distributed in Turkey only; no regional differences in features. The app is not in a regulated sector (no banking,
payments, health, gambling or crypto). Amounts shown are the company's internal work-advance and expense records;
the app does not move money.

CONTACT
[Ad Soyad], [telefon], [e-posta]
```

## 2. Ekran kaydı senaryosu (Orhan'ın iPhone'unda çekilecek)

Hazırlık: TestFlight'tan güncel build · **demo hesaplar** (gerçek firma verisi görünmesin) · iPhone **Ayarlar → Gizlilik → Kamera
ve Fotoğraflar'da Omnix izinleri sıfır** (izin sorusunun kayıtta çıkması için: uygulamayı silip TestFlight'tan yeniden kurmak en
temizi) · Bildirimler sessiz · Denetim Merkezi → Ekran Kaydı. Süre hedefi 3–5 dk; konuşma gerekmez.

1. Kayıt başlasın, ana ekrandan **Omnix**'e dokunun (açılış ekranı görünsün).
2. Giriş ekranı: demo **personel** hesabıyla giriş → "Firma bilgileriniz doğrulanıyor" → ana sayfa (firma adı demo firma).
3. Ana sayfa: Hesabım kartı, hızlı işlemler kısaca kaydırılsın.
4. **Harcamalar → Masraflarım** → taslak form → **Kalem ekle** → kategori, tutar → **Fiş ekle → Kamera**: kamera izni sorusu çıksın,
   **İzin Ver** → bir fişi çekin → otomatik kırpma ekranı → "Kırpılmış fişi ekle" → Kaydet.
5. Aynı ekranda **Galeri** ile ikinci fiş: fotoğraf izni sorusu çıksın → izin → seçim.
6. **Harcamalar → İş avansları → Yeni talep** formunu açıp kapatın (göndermeyin ya da demo veride gönderin).
7. **Saha → İşlerim** → bir iş → **İşe başla**; **Clean Up sahalarım** → bir saha → "Sonra" fotoğrafı.
8. **Profil → Çıkış yap**.
9. Demo **şirket sahibi** ile giriş → şirket özeti → **Personel Yönetimi** → bir personel → bölümler aşağı kaydırılsın → çıkış.
10. Demo **taşeron** ile giriş → ana sayfa özet kartları → **İşler** → iş detayı (anlaşılmış fiyat, belgeler) → **Hakediş** →
    **Faturalar** → bir fatura → çıkış.
11. Kaydı durdurun. Dosyayı Fotoğraflar'dan paylaşın; ASC'de "App Review Information → Attachment" alanına yüklenir (ya da bağlantı).

Not: Hesap silme düğmesi yok; kayıtta göstermeye gerek yok, notta nedeni yazıyor (hesaplar firma yöneticisince açılıp kapanır).

## 3. Test edilen cihazlar (doldurulacak)
| Cihaz | iOS | Kaynak |
|---|---|---|
| [Orhan'ın iPhone'u — model] | [sürüm] | TestFlight build 4/5 (gerçek cihaz) |
| iPhone 17 simülatör | 26.5 | Expo Go, yerel sahte veri |
| iPhone 17e simülatör | 26.5 | Expo Go, yerel sahte veri |

## 4. Demo firma ve hesaplar (plan — canlıda oluşturma Orhan onayı ister)
Mevcut `demo@omnix.global` ERC ailesinde duruyor; Omnix'in yönetim ve taşeron ekranlarında ERC verisine yakın uçlar (ör. saha
kodu önerisi, Clean Up "Site ID ile aç") olduğu için **App Review'a gerçek veriyle aynı firmada demo hesap verilmemeli.**
Önerilen: **izole demo firması** (platformun mevcut tenant izolasyonu — ayrı şema).
1. Platform yöneticisi (Orhan) yeni izole firma: ör. tenant `omnixdemo`, görünen ad "Omnix Demo Telekom".
2. Bu firmada sahte veri: 3–4 personel, 1 taslak masraf formu + fiş, 1 onayda avans, 2 saha işi (biri Clean Up), 1 zimmet, 1 demo
   taşeron (subcons) + fiyatlı atama + tamamlanmış/QC OK iş + 1 kısmi ödenmiş fatura. Tohum betiği yerel `test/yerel/tohum.js` ile aynı
   yapıda hazırlanır; **canlıya çalıştırma onayla**.
3. Üç hesap: `demo.personel@…` (personel), `demo.yonetici@…` (Şirket sahibi profili), `demo.taseron@…` (taşeron firma kullanıcısı).
   Şifreleri Orhan belirler; yalnız ASC notuna yazılır (depoya/belgeye yazılmaz).
4. Gönderimden önce: üç hesapla TestFlight'ta uçtan uca deneme; izole tenant'ta yeni `/yonetim` ve `/taseron-panel` uçlarının çalıştığı
   **ayrıca doğrulanmalı** (bu uçlar yerelde ERC ailesinde test edildi, izole şemada henüz denenmedi).
5. İnceleme bitince demo hesaplar açık kalabilir (sonraki sürümler için), veriler sahte.

## 5. Mağaza metinleri (Türkçe)
- **Ad:** Omnix Field Operation · **Altyazı (30):** Saha operasyon ve hakediş
- **Kategori:** Birincil **İş (Business)** · ikincil Verimlilik (isteğe bağlı)
- **Promosyon metni (170):** Telekom saha operasyonları için tek uygulama: iş avansı, masraf ve fiş, saha işleri, personel yönetimi ve
  taşeron hakediş takibi — firmanızın hesabıyla.
- **Anahtar kelimeler (≤100, virgülle, boşluksuz):** `saha,operasyon,hakediş,taşeron,masraf,avans,telekom,puantaj,fiş,zimmet,personel,B2B`
- **Açıklama:**

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

- **Destek URL:** `https://app.omnix.global/destek.html` — sayfa hazırlandı (`frontend/frontend/public/destek.html`; hesap yok, şifre, hesap silme, iletişim info@efelis.com), web deploy ile yayına çıkar. Eski not: canlıda henüz **404**. Seçenek: `https://omnix.global` (açılıyor, 200) ya da kısa bir
  destek sayfası (iletişim e-postası + "hesabım yok / şifremi unuttum / hesap silme" yanıtları) — sayfa yayını onay ister.
- **Pazarlama URL (isteğe bağlı):** https://omnix.global
- **Gizlilik URL:** https://app.omnix.global/gizlilik.html — **güncellenmeli** (bkz. bölüm 8).
- **Telif:** © 2026 Efelis Tarım Ticaret Ltd. Şti.
- **Yayın:** Fiyat ücretsiz · **Kullanılabilirlik: yalnız Türkiye** · Uygulama içi satın alma yok.

## 6. App Privacy (Uygulama Gizliliği) cevapları
"Verileri topluyor musunuz?" → **Evet**. İzleme (tracking) → **Hayır**. Tüm türler: **Kullanıcıya bağlı**, amaç **Uygulama İşlevselliği**,
reklam/analitik/kişiselleştirme **yok**.

| Apple veri türü | Ne | Not |
|---|---|---|
| İletişim Bilgileri → Ad | ad soyad | hesap |
| İletişim Bilgileri → E-posta adresi | kurumsal e-posta | giriş |
| Finansal Bilgiler → Diğer finansal bilgiler | iş avansı, masraf tutarları, isteğe bağlı IBAN/banka; yetkiliye maaş / hakediş görüntüleme | ödeme/kart bilgisi YOK |
| Kullanıcı İçeriği → Fotoğraflar veya Videolar | fiş ve saha (Clean Up) fotoğrafları | yalnız kullanıcı seçince |
| Kullanıcı İçeriği → Diğer kullanıcı içeriği | form açıklamaları, notlar, malzeme talepleri | |
| Tanımlayıcılar → Kullanıcı Kimliği | hesap kimliği | |

Toplanmayanlar: konum, kişiler, sağlık, satın almalar, tarama/arama geçmişi, kullanım verisi, tanılama (çökme SDK'sı yok), hassas bilgi.
Telefon numarası uygulamadan girilmez (personel kaydında web'den gelir) → "Toplanmıyor".

## 7. Diğer form alanları
- **Yaş derecelendirmesi:** anketteki tüm içerik soruları "Hayır/Yok" → **4+** (sınırsız web erişimi yok, kullanıcılar arası açık sohbet yok).
- **Şifreleme (Export Compliance):** yalnız HTTPS → muaf; `ITSAppUsesNonExemptEncryption = false` app.config'de zaten var.
- **İçerik hakları:** üçüncü taraf içerik yok.
- **Giriş gerekli:** Evet → demo hesaplar notta.
- **Reklam tanımlayıcı (IDFA):** kullanılmıyor.

## 8. Ekran görüntüleri — HAZIR (25.10.2026 akşam)
`teslim/magaza-ekran/6.9/` — **1290×2796** (App Store 6,9" kabul ettiği boyut), dikey, 10 adet, kurgusal "Demo Telekom" verisi
(gerçek kişi/firma yok), durum çubuğu 9:41 / tam pil, "TEST" rozeti yok:
01 giriş · 02 personel ana sayfa · 03 harcamalar · 04 masraf formu (fişli kalemler) · 05 saha işleri + Clean Up · 06 şirket sahibi
ana sayfa · 07 Personel Yönetimi · 08 taşeron ana sayfa · 09 taşeron işler · 10 taşeron iş detayı (anlaşılmış fiyat).
Önerilen yükleme sırası ve sayı: 01, 02, 04, 05, 06, 07, 08, 10 (8 adet; 03 ve 09 yedek).
Not: Pro Max simülatörüne erişim izni verilmediği için iPhone 17'de (1206×2622) çekilip %7 ölçeklendi ve 9 px kırpıldı; metinler net.
İstenirse Pro Max'te birebir yeniden çekilebilir. `ham/` klasörü orijinal çekimler. Demo verisi: `test/yerel/magaza_tohum.js` (yalnız yerel).

## 9. Gizlilik politikası sayfası — Omnix'e uygunluk kontrolü
**25.10.2026 akşam: eksikler kaynak dosyada giderildi (yayınlanmadı — web deploy ile çıkar).** Mevcut canlı sayfa (12.08.2026) genel yapı olarak uygun: veri sorumlusu müşteri firma, Efelis veri işleyen, açık kayıt yok,
konum/izleme/reklam yok. **Eksikler (yayından önce güncellenmeli; sayfa yayını onay ister):**
1. **Fiş görsellerinin otomatik kırpma/okuma için Anthropic (ABD) yapay zekâ servisine gönderilmesi** yazmıyor → KVKK yurt dışı aktarım
   bilgisi ve alt işleyen olarak eklenmeli (yalnız fiş görseli; hesap/kişi bilgisi gönderilmez).
2. Toplanan veriler: **saha (Clean Up) fotoğrafları**, **isteğe bağlı IBAN/banka**, **puantaj ve maaş/hakediş bilgilerinin yetkili
   yöneticiye gösterilmesi**, **taşeron fatura/ödeme bilgileri** eklenmeli.
3. **Kamera ve fotoğraf izni** ne için kullanılıyor (yalnız kullanıcı dokununca) cümlesi.
4. **Hesap silme / veri silme** başlığı: hesabı firma yöneticisi kapatır/siler; talep yolu (e-posta) ve süre.
5. Barındırma: veritabanı/depolama **Supabase AB (İrlanda, eu-west-1)** — doğrulandı. **Uygulama sunucusu (Render) bölgesi doğrulanmalı**;
   AB dışındaysa "Avrupa bölgesi veri merkezleri" ifadesi düzeltilmeli.
6. İletişim e-postası kişisel Gmail → kurumsal adres önerilir (ör. destek@ / kvkk@omnix.global).
Kaynak dosya: `frontend/frontend/public/gizlilik.html` (web ile birlikte yayınlanır).
