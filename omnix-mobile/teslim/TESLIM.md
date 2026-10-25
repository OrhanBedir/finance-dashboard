# Omnix mobil — iPhone ilk sürüm teslim notu (24.10.2026, güncelleme 25.10.2026)

## 0. Güncelleme 25.10.2026 (Orhan'ın kararlarından sonra)
**Kararlar:** IBAN eklensin · Clean Up Omnix'e taşınsın · köşe düzeltme bana bırakıldı (eklendi) · mağaza adı
**"Omnix Field Operation"** (telefondaki ad "Omnix") · backend gizlilik açıkları düzeltilsin · TestFlight'a eklensin.

**Uygulamaya eklenenler**
- **Fiş kırpma tamamlandı:** her adayda "Kırpmayı düzelt" (4 köşe sürüklenir, "Döndür" üst kenarı değiştirir, "Sıfırla");
  kırpma bulamazsa "Elle kırp"; her durumda **"Yeniden çek"** (kamera açılır, yeni foto taslaktakinin yerine geçer, sunucuya
  eski foto eklenmediği için çift ek olmaz). Köşeler sunucuya `secimler[].kose` ile gider, sunucu orijinalden kırpar → `kirpma_durum = KULLANICI`.
- **Taklit / gerçek kırpma servisi:** yerel testte yapay zekâ anahtarı yok → servis `AI_HATA` döner; uygulama "Elle kırp / Kırpmadan ekle /
  Yeniden çek" yolunu gösterir (bu yol yerelde denendi). Canlıda kırpma 79cf23b'deki gerçek servisle çalışır; gerçek fişle deneme TestFlight'ta yapılacak.
- **İş avansı formunda IBAN / banka** (isteğe bağlı): TR IBAN doğrulaması (TR + 24 hane, kontrol hanesi); IBAN girilirse banka adı zorunlu;
  detayda görünür.
- **Clean Up:** Saha › İşlerim'de "Clean Up sahalarım" (ofisin atadıkları) + "Site ID ile aç"; iş detayında Clean Up işi için saha düğmesi;
  kalem başına Önce / Sonra fotoğrafı (kamera/galeri), "Sonra" yüklenince kalem tamamlanır; kendi fotoğrafını onaya göndermeden önce silme;
  eksik "Sonra" varsa onaya gönderilemez; gönderilince kayıt kilitli; red gerekçesi görünür, düzeltip tekrar gönderilir. Bölge onaycısı
  (Serdar / Nurcan / Orhan / Düzgün) **Onaylar** sekmesinde "Clean Up onayı" listesinden fotoğrafları büyük görür, onaylar ya da gerekçeyle reddeder.
  İş detayındaki "eski uygulamadan yapın" bandı kaldırıldı. Fotoğraflar bağlantı varken yüklenir; bağlantı koparsa kayıt yeniden okunur.

**Backend gizlilik / yetki düzeltmesi** (`backend/server.js`, +193 satır, **commit ve canlıya çıkış yok — onayınızı bekliyor**)
- Malzeme: tek yetki katmanı. Personel yalnız kendi taleplerini/zimmetini görür (sorgudaki e-posta yok sayılır), başkası adına talep açamaz,
  yalnız taslak / rollout onayına gönderir, onaydakini değiştiremez, talebi ortak fiyat listesini değiştirmez. Depo işlemleri yalnız depo
  yetkilisinde (admin, PM, direktör, Nurcan, Murat, Emre), fiyat listesi yalnız admin/PM/direktörde, talep onayı yönetici + rollout/bölge
  müdüründe; `malzeme_goruntule` izni salt okunur. Taşeron giremez; alt marka (Teknocenter/AHY) Şimşek deposunu görmez.
- Masraf: form detayı / Excel / PDF yalnız sahibine ve onay zincirine; `masraf-formlari` kişisel kapsam; bakiye yalnız kendininki
  (Orhan'ın kişisel kaydı ayrıca korunuyor); onaya gönderilmiş forma personel kalem ekleyemez; dönem Excel'i yalnız tam görüşte.
- İş atama detayı yalnız atanan ekibe ve yetkililere. Clean Up: onaya gönderilen kayıt kilitli; fotoğraf silme yalnız yükleyen
  (kilitlenmeden önce) veya ofis; kayıt silme yalnız atama yetkilisi/ofis; taşeron yazamaz. `/health` build etiketi `2026-10-25-yetki`.
- Test: `test/yerel/yetki.test.mjs` 8/8 geçti (rol bazlı: personel, başka personel, depo, rollout müdürü, İSG salt okunur, taşeron, admin);
  **aynı test eski kodda 8/8 başarısız** (açıklar gerçekti). Omnix uçtan uca testi 9/9 (bilinen açıklar artık "kapalı" diye doğrulanıyor).
- Web ve eski mobil uyumu: web'in malzeme/masraf ekranlarının ve eski uygulamanın kullandığı istekler tek tek kontrol edildi; personel
  kendi kayıtlarını aynen görür. Davranış değişen tek yer: personel web'de parametresiz talep listesinde artık yalnız kendi taleplerini görür;
  Teknocenter/AHY yöneticisi Şimşek malzeme deposunu görmez.

**Testler:** birim testleri 28/28 · uçtan uca 9/9 · yetki 8/8 · simülatörde Clean Up (atanan saha → foto yükleme → eksik uyarısı →
görüntüleyici/silme → onaya gönder → kilit) çalıştı. Onaycı ekranı simülatörde değil, API testiyle doğrulandı (simülatör klavyesi "@" yazamadı).

**Güncelleme 25.10.2026 öğleden sonra:**
- **TestFlight:** App Store Connect kaydı "Omnix Field Operation" (6826747737) açıldı; **build 4** (Clean Up + IBAN + kırpma düzeltme)
  TestFlight'a gönderildi. Dahili test grubu "Team (Expo)": yalnız `orhan.bedir@gmail.com`, açık bağlantı yok, dış test yok.
- **Ana sayfa görüntüleme hataları düzeltildi:** veri yenilenemezse eski sonuç "Hesabınız kapalı / 0,00" gibi kesin gösterilmiyor —
  "Son bilinen: …" + son başarılı yükleme saati + "güncel olmayabilir"; hiç veri yoksa "yüklenemedi / tekrar dene"; "Bilgileriniz
  telefonda saklandı" yalnız gerçekten taslak saklayan ekranlarda; yetki hatası kilit simgesi ve "görme yetkiniz yok" ile (bağlantı
  hatası gibi değil); boş iş listesi ile yüklenemeyen liste ayrı; puantajda eksik alan 0 yerine "—".
- **Şirket yönetimi ve taşeron firma deneyimleri:** ayrıntı, yetki tablosu ve testler → `teslim/YONETIM_TASERON.md`.
- **İş avansında IBAN otomatik dolar (25.10 gece, Orhan'ın isteği; commit yok):** "Kim için" bir personel seçilince banka adı ve IBAN
  o personelin kayıtlı hesabından gelir; kayıtlı IBAN'ı yoksa alan boşalır ve "kayıtlı IBAN'ı yok" uyarısı çıkar; kullanıcı alana elle
  yazdıysa seçim değişince üzerine yazılmaz. Backend: `GET /hr/personel-secim/:id/odeme-hesabi` (yalnız başkası adına avans açabilen
  yetkili + İK hassas alan kapsamı; taşeron/personel/alt marka 403; yanıt yalnız banka + IBAN). Test: `yetki.test.mjs` 9/9, `npm test` 29/29;
  simülatör: `teslim/ekran-goruntuleri/28-iban-otomatik-doldurma.png`. Telefona gelmesi için **build 7** gerekir (API tarafı da commit + push).
- **App Store herkese açık yayın hazırlığı** (yalnız Türkiye; gönderilmedi): inceleme notu, ekran kaydı senaryosu, demo firma planı,
  mağaza metinleri, App Privacy, yaş, ekran görüntüsü boyutları, gizlilik sayfası eksikleri → `teslim/APP_STORE_HAZIRLIK.md`.

**Build 5 açılışta takıldı (25.10 akşam) — kök neden ve düzeltme:** TestFlight'tan kurulan uygulama yerel açılış ekranında kalıyordu
(JavaScript hiç başlamıyordu). `expo-doctor`: `@expo/vector-icons` için gereken `expo-font` projeye doğrudan eklenmemişti; npm, `>=14.0.4`
koşulunu en yeni **expo-font@58.0.10** (SDK 55 nesli) ile çözüp üst dizine koymuş, SDK 54'ün `expo-font@14.0.12`'si altta kalmıştı.
Gerçek build'de yanlış sürüm derlenince uygulama açılışta çöktü. Expo Go kendi yerel modüllerini taşıdığı için simülatör testlerinde
görünmedi. Düzeltme: `npx expo install expo-font` → her yerde 14.0.12, `expo-doctor` 18/18. **Ders:** her EAS derlemesinden önce
`npx expo-doctor` çalıştır; yalnız Expo Go testi gerçek build'i temsil etmez. **Doğrulama (25.10 akşam):** Mac'te Release simülatör
derlemesi (scratchpad kopyası: `APP_VARIANT=test npx expo prebuild`, Podfile'a Xcode 27 hedef yaması, `xcodebuild -configuration Release`,
React/ReactNativeDependencies/hermes çerçevelerini ve `expo export:embed` ile üretim JS paketini .app'e elle gömme) canlı API'ye karşı
giriş ekranına ulaştı. **Build 6** (4b21d0f1) TestFlight'ta, Apple işlemesi tamam.

**App Store / TestFlight durumu (sabah):** bundle `global.omnix.app` Apple'da kayıtlı; EAS projesi `@orhanbedir/omnix`; 1. derleme (build 2)
bitti; 2. derleme (Clean Up + backend'den bağımsız tüm düzeltmeler) başlatıldı. **App Store Connect'te uygulama kaydı henüz yok**
(Apple bu kaydın API ile açılmasına izin vermiyor). Kayıt açılınca: ASC kimliği `eas.json`'a yazılır → `eas submit` → yalnız sizi
içeren dahili test grubu.

## 1. Kısaca
- Yeni uygulama **ayrı bir klasörde** yazıldı: `ERC/frontend/omnix-mobile` (commit edilmedi).
- Eski "ERC Operasyon" uygulamasına (`ERC/mobile`) hiç dokunulmadı; kimliği, ikonu, build ayarları, TestFlight kaydı aynı.
- Yeni uygulamanın kimliği eskisinden farklı: bundle `global.omnix.app` (eski: `com.simsektel.ercoperasyon`).
  Bu yüzden iki uygulama aynı iPhone'da yan yana kurulur; telefondaki verileri, oturumları ve dosyaları birbirine karışmaz.
- Backend'de hiçbir değişiklik yapılmadı. Uygulama web ile aynı uçları ve aynı iş kurallarını kullanıyor.
- **Henüz yapılmayanlar (sizin onayınızı bekliyor):** EAS/Xcode build, App Store Connect kaydı, TestFlight yüklemesi,
  commit. Bu yüzden şu an **telefonunuza kurulabilir bir dosya yok**; uygulama yalnız simülatörde sahte verilerle çalıştırıldı.

## 2. Eski uygulamanın korunduğu — kontrol sonucu
| Kontrol | Sonuç |
|---|---|
| `ERC/mobile/app.json`, `eas.json`, `package.json`, `assets/`, `plugins/` | Fark yok (`git diff HEAD` boş) |
| Bundle / EAS proje / App Store Connect kimliği | Eskisi aynen: `com.simsektel.ercoperasyon`, EAS `90c62b24…`, ASC `6775361138`; yenisine kopyalanmadı |
| Eski uygulamanın çalışma ağacı | Yalnız benden önceki değişiklikler (`store/magaza-metinleri.md`, `.claude/settings.json`) — bana ait değil |
| Web uygulaması / `backend/server.js` | Dokunulmadı (fiş kırpma servisi paralel oturumun commit'i 79cf23b) |
| Sertifika, TestFlight grupları, eski build'ler | Hiçbir Apple/Expo hesabına bağlanılmadı; hiçbir şey değişmedi |
| Canlı veritabanı | Bağlanılmadı; tüm testler bilgisayarda geçici, sahte verili PostgreSQL ile |

## 3. Uygulamada neler var
**Açılış ve firma kimliği**
- Açılış ve giriş ekranı Omnix markalı (mevcut logo: lacivert + altın). Firma seçtirme yok.
- Giriş sonrası "Firma bilgileriniz doğrulanıyor…" ekranı; firma adı/logosu yalnız backend'in doğruladığı oturumdan
  (`/auth/me` → `marka_ad`). Teknocenter hesabı "Teknocenter", Şimşek hesabı backend'de yazılı marka adıyla açılır
  (yerel testte "ERC Mühendislik" — canlıda `markalar` tablosundaki ad neyse o görünür).
- Backend logo adresi vermediği için firma logosu yerine firmanın baş harfli altın rozeti gösteriliyor. Logo adresi
  eklenirse (ör. `marka_logo_url`) uygulama otomatik gösterir.
- Rol ve firma her açılışta ve uygulama öne geldiğinde backend'den yeniden okunur; telefonda saklanan role güvenilmez.

**Ana sayfa** — Hesabım kartı (backend'in `/hr/is-avans/hesap` hesabı, mobilde yeniden hesaplanmaz):
- Pozitif bakiye → "Üzerinizdeki iş avansı"; **negatif bakiye → "Şirketten alacağınız"** (eski uygulamadaki yanlış başlık düzeltildi).
- Onaydaki avans, onaydaki masraf formu, kapanış bekleyen ve taslak form ayrı satırlarda "henüz bakiyeye işlenmeyenler" olarak.
- Veri yüklenemezse "0 ₺" yerine "Hesap bilgisi alınamadı" + Tekrar dene.
- Hızlı işlemler, bu ayın çalışma (puantaj) özeti, trafik cezaları; onaycıya "X kayıt onayınızı bekliyor".

**Harcamalar** — Masraflarım (taslağa devam, telefonda bekleyen kalemler, gönderilen formlar ve onay adımları) ve İş avanslarım.
- Masraf formu: kalem ekle, fiş ekle (kamera/galeri), "fişim yok" + neden, kalem sil, onaya gönder; onaya gidince form kilitlenir.
- Fiş: otomatik kırpma servisi (79cf23b) varsa önce o kullanılır (kırpılmış ya da orijinal seçilir); servis yoksa eski
  doğrudan yükleme. Fişteki tutar farkında açıklama istenir, yakıt fişinde plaka uyuşmazsa fiş kaldırılır (mevcut kural).
- İş avansı: Personel → Rollout Müdürü → Proje Müdürü → Proje Direktörü → Muhasebe ödemesi; adım göstergesi rol adlarıyla.
  "Kim için" seçimi yalnız backend'in yetkili saydığı kişilerde çıkar. Yakıtta atanan araç plakası otomatik gelir.

**Saha** — Rollout İşlerim (İşe başla / Çıkış: tamamlandı mı, QC, ara verme sebebi, çalışanlar, not), Malzeme taleplerim
(+ yeni talep, web ile aynı "Rollout Müdürü onayı" başlangıcı), Zimmetim (+ depoya iade talebi).

**Onaylar** — yalnız backend onaycı olarak işaretlediyse görünür: iş avansı (incele / reddet gerekçeli / onayla + kasa:
Şimşek–Teknocenter, eski uygulamadaki kural) ve PM için malzeme talepleri. Her adımın yetkisi yine backend'de denetlenir.

**Profil** — kişi, firma, rol, sürüm; Çıkış / hesap değiştir.

**Saha kullanımı / bağlantı**
- Formlar yazarken telefona kaydedilir; fotoğraflar uygulamanın kendi klasörüne kopyalanır (galeri silinse de kalır).
- Bağlantı koparsa kayıt "Gönderildi" görünmez; tekrar denemede önce sunucu okunur, kayıt zaten oluştuysa **ikinci kez oluşturulmaz**
  (avans, kalem, fiş, malzeme talebi, form gönderimi). Çift dokunma kilitli.
- Taslaklar kullanıcı + firma anahtarıyla saklanır; başka hesap göremez. Çıkışta (uyarıyla) o kişinin taslakları ve fotoğrafları silinir.
- Oturum süresi dolarsa giriş ekranına "Oturumunuzun süresi doldu" ile dönülür, taslaklar korunur.
- Token yalnız iPhone anahtar zincirinde (yalnız bu cihaz). Uygulama silinip kurulursa eski token temizlenir.
- Kullanıcıya teknik hata metni gösterilmez; çevrimdışıyken üstte bilgi bandı çıkar. Sayısal klavyeye "Tamam" çubuğu eklendi.

## 4. Değişen / yeni dosyalar
Yalnız yeni klasör: `ERC/frontend/omnix-mobile/` (repo'da izlenmeyen dosya olarak duruyor).
`app.config.js`, `eas.json`, `App.js`, `index.js`, `assets/` (Omnix ve TEST rozetli ikon, açılış), `src/**` (yaklaşık 30 dosya),
`test/` (birim testleri, uçtan uca API testi, yerel sahte sunucu düzeneği), `teslim/` (bu not + ekran görüntüleri).

## 5. Çalıştırılan testler
| Test | Sonuç |
|---|---|
| Birim testleri (`npm test`): biçim, hesap türü, durum adları, teknik hata gizleme, çift kayıt önleme, kapsam anahtarı, masraf gönderim akışı (bağlantı kopması senaryoları dahil) | 18/18 geçti |
| Uçtan uca API testi: gerçek backend kodu + bilgisayarda sahte verili PostgreSQL (`test/yerel/`) | 9/9 geçti |
| iOS paketi derleme (`expo export`) | Başarılı |
| iPhone 17e simülatörü (Expo Go 54, küçük ekran): giriş, hatalı giriş, ana sayfa, hesap hareketleri, masraf formu, kalem + galeriden fiş, kamera izni reddi, uygulama kapanıp açılınca taslak + fotoğrafın geri gelmesi, kırpma servisi (yapay zekâ anahtarı yokken orijinali ekleme), plaka uyarısı, fişsiz açıklama, onaya gönderme ve kilit, avans listesi, işlerim, profil, çıkışta taslak silme uyarısı, Teknocenter hesabına geçiş, onaycı hesabında Onaylar | Çalıştı; test sırasında bulunan hatalar düzeltildi (tarih UTC kayması, durum çubuğu çakışması, taslak listesinde tür/tutar, küçük ekranda tarih alanı, sayısal klavyede kapatma, mevcut kaleme fiş ekleyememe, sunucu kırpma mesajının ham görünmesi, boş saha kartı vb.) |

Uçtan uca testte doğrulananlar: Teknocenter personeli sorgu parametresini değiştirse de Şimşek personelinin avans/hesap/pano
verisini alamıyor; pasif hesap reddediliyor; onaylanmamış/ödenmemiş avans ve onaydaki form bakiyeye işlenmiyor; aynı istek
kimliğiyle fiş ikinci kez eklenmiyor; onaydaki forma kalem eklenmiyor, fiş silinemiyor; personel avans onaylayamıyor (403).

**Yapılamayanlar / sınırlar**
- Gerçek iPhone'da, gerçek hesapla ve canlı API'ye karşı test yapılmadı (onayınız gerekiyor; kapsam aşağıda).
- Simülatörde kamera yok: kamera yolu yalnız izin reddi açısından denendi; fotoğraf çekimi gerçek cihazda denenmeli.
- Simülatörde (Expo Go 54 + iOS 26.5) görüntü küçültme modülü yanıt vermedi; uygulama 8 sn sonra seçicinin verdiği
  sıkıştırılmış fotoğrafla devam ediyor. Gerçek cihazda küçültmenin çalıştığı ayrıca doğrulanmalı.
- Erişilebilir yazı boyutu, büyük iPhone (Pro Max) ve yatay/çentik varyasyonları yalnız tasarımda dikkate alındı; ayrıca test edilmedi.
- Simülatöre otomatik yazı girişi (otomasyon) bazen harf kaçırdı; bu uygulama hatası değil, avans gönderimi API testiyle doğrulandı.

## 6. Backend kapsam açıkları (24.10 tespiti — 25.10'da düzeltildi, bkz. bölüm 0; canlıya çıkış onayınızı bekliyor)
Şartnamedeki "yalnız menü gizlemekle yetinme" maddesi gereği raporluyorum; **düzeltme backend değişikliği ister, onayınızı bekliyor**:
1. `GET /malzeme/talepler` — sıradan personel başka kişinin e-postasını yazınca (ya da parametresiz) başkalarının taleplerini görüyor.
2. `GET /malzeme/dagitim?personel_email=…` — başka kişinin zimmet listesi görülebiliyor.
3. `GET /hr/masraf-form/:id` — sahiplik denetimi yok; Şimşek personeli Teknocenter personelinin formunu açabildi (tersi 403).
4. `GET /malzeme/talepler/:id` ve `GET /is-atama/:id` — sahiplik/atama denetimi yok.
5. `POST /hr/masraf-kalem` — formun TASLAK olup olmadığına bakmıyor (yeni uygulama bunu kendisi kilitliyor).
6. Uçlar istemci istek anahtarı (idempotency) almıyor; yeni uygulama "önce sunucuyu oku" yöntemiyle çift kaydı önlüyor.
   Kalıcı çözüm için isteğe bağlı `İstek-Kimliği` başlığı geriye uyumlu biçimde eklenebilir.
Öneri: kişisel kapsamı token'dan kilitleyen küçük, geriye uyumlu bir yama (eski uygulamanın kullandığı davranış değişmez).

## 7. Karar bekleyenler (24.10 — 1-4 karara bağlandı, bkz. bölüm 0)
1. **App Store adı:** "Omnix" adı App Store'da başka bir geliştiriciye ait. Mağaza kaydı için ör. "Omnix Saha" ya da "Omnix Platform"
   gerekiyor; telefondaki simge altı ad yine "Omnix" olabilir. (Not: "OMNIX TURKEY TEKNOLOJİ A.Ş." adlı bir şirketin de uygulaması var — marka
   tescili açısından bakmak isteyebilirsiniz.)
2. **IBAN / banka alanı:** eski mobil avans formunda vardı; yenisinde yok (kişisel veri). Muhasebe ödemede bu alanı kullanıyorsa eklerim.
3. **Clean Up fotoğraf akışı** bu sürümde yok (iş başlat/çıkış var); şimdilik eski uygulamadan yapılır. İsterseniz sonraki adımda eklerim.
4. **Kırpmada köşe düzeltme:** kırpma servisi "kontrol edin" dediğinde şimdilik "kırpılmış" ya da "orijinal" seçiliyor; eski uygulamadaki
   4 köşe düzeltme ekranı sonraki adımda taşınabilir.
5. Gerçek hesapla cihaz testi kapsamı (öneri): yalnız sizin hesabınız; okuma ekranları serbest; yazma testi olarak 1 taslak masraf kalemi
   + fiş (sonra silinir), avans ve onay işlemi yapılmaz.

## 8. iPhone'a kurulum için gerekenler (hiçbiri yapılmadı)
**Sizden gereken erişimler / onaylar**
- Apple Developer hesabında yeni App ID: `global.omnix.app` (gerekirse `global.omnix.app.dev`) — EAS veya Xcode otomatik açabilir.
- App Store Connect'te **yeni uygulama kaydı** (eski kayıt kullanılmaz) → oluşan uygulama kimliği `eas.json`'daki
  `YENI_OMNIX_ASC_UYGULAMA_KIMLIGI` yerine yazılır.
- Build yolu seçimi (birini onaylayın):
  - **EAS bulut** (eski uygulamadaki yol): `eas init` ile **yeni** Expo projesi → `eas build -p ios --profile test` → `eas submit -p ios --profile test`.
    EAS ücretsiz planda aylık build sınırı var; aşarsa ücretli.
  - **Yerel Xcode arşivi** (Efelis'teki yol, ücretsiz): `APP_VARIANT=test npx expo prebuild -p ios` → Xcode'da Archive → App Store Connect'e yükle.
- Dağıtım imzası: mevcut dağıtım sertifikası **paylaşılabilir**, iptal edilmez; yeni uygulama için yeni provizyon profili oluşur.

**TestFlight (yalnız siz)**
- Yalnız "Dahili test" kullanılacak: test grubuna yalnız sizin App Store Connect kullanıcınız eklenir; açık bağlantı açılmaz, dış test yok
  (dış test Apple incelemesi ister ve personele gidebilir).
- Her TestFlight build'i yüklendiği günden itibaren **90 gün** geçerlidir; sonra açılmaz. Test sürerken yeni build yüklemek gerekir
  (`autoIncrement` açık, build numarası kendiliğinden artar).
- Telefonunuzda: TestFlight uygulaması → davet → "Omnix Test" kur. Eski ERC Operasyon silinmeden yanında durur.

## 9. Sonraki aşamalar
- **Personel iPhone dağıtımı (onayınızdan sonra):** TestFlight 90 günde biter, personel için kalıcı yol değildir. Öneri: App Store'da
  "Liste dışı (Unlisted)" yayın (eski uygulamadaki gibi; bağlantıyı bilen kurar) ya da Apple Business Manager ile özel uygulama.
- **Android:** kod ortak; onaydan sonra Android cihaz testi → Google Play kurumsal hesap (D-U-N-S 595956895) → AAB, Play App Signing,
  artan `versionCode`. Güncel Play gereksinimleri (hedef API seviyesi, kapalı test süresi vb.) yayın tarihinde resmi belgelerden doğrulanmalı.
- Backend kapsam yaması (madde 6), Clean Up fotoğrafları, kırpmada köşe düzeltme, şifre sıfırlama ekranı.

## 10. Ekran görüntüleri (simülatör, sahte veri)
`teslim/ekran-goruntuleri/` — 01 giriş · 02 Şimşek ana sayfa (alacak) · 03 Teknocenter ana sayfa (avans) · 04 telefonda bekleyen kalem ·
05 doğrulama · 06 kamera izni kapalı · 07 fiş telefonda · 08 plaka uyarısı · 09 onaydaki form kilidi · 10 avanslarım · 11 işlerim ·
12 profil · 13 çıkış uyarısı · 14 ana sayfa alt · 15 hesap hareketleri · 16 taslak form · 17 onaylar · 18 mevcut kaleme fiş ekle/açıkla
· 19 Clean Up foto yüklendi · 20 Clean Up onay bekliyor (kilitli)
(Bazı görüntüler küçük görünüm düzeltmelerinden önce alındı.)
