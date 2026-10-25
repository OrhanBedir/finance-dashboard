# Omnix — şirket yönetimi ve taşeron firma deneyimleri (25.10.2026)

**Durum:** yerelde geliştirildi ve sahte verilerle test edildi. **Commit, canlı veritabanı değişikliği, migration, backend
deploy, TestFlight yüklemesi yapılmadı** — hepsi Orhan'ın onayını bekliyor. Canlı veritabanına bağlanılmadı.

## 1. Tek uygulamada üç deneyim
Deneyim, backend'in doğruladığı hesaptan seçilir (`/auth/login` ve `/auth/me` → `kullanici_tipi`, `yonetim_profili`, `taseron`):

| Deneyim | Kim | Ana ekran |
|---|---|---|
| Personel | şirket içi, profil yok / PERSONEL | Mevcut personel ekranları (değişmedi) |
| Yönetim | şirket içi, profil YONETICI veya SAHIP | Şirket özeti, onay bekleyenler, **Personel Yönetimi**, saha. Kişisel puantaj/mesai kartı yok; kendi avans/masraf hareketi varsa "Kişisel hesabım" |
| Taşeron | kullanici_tipi TASERON + taşeron kaydına bağlı | Taşeron unvanı + "Taşeron paneli · Omnix Platformu · ana firma"; Ana sayfa, İşler, Hakediş, Faturalar, Belgeler, Profil |
| Bağlantısız taşeron | taşeron hesabı ama bağlantı eksik / eski tip | Hiçbir veri gösterilmez; "yöneticinizden hesabınızı bağlamasını isteyin" |

## 2. Kimlik kuralları (isim benzerliği yok)
- `users.kullanici_tipi` IC / TASERON (NULL = eski hesap, davranışı aynen sürer — **mevcut kullanıcıların tipi toplu tahminle değiştirilmedi**).
- `users.taseron_id` → `subcons.id` (taşeronun kalıcı kimliği; aynı taşerona birden çok kullanıcı bağlanabilir).
- `users.marka` → bağlı / ana firma (`markalar.kod`). Taşeron kaydı bir ana firmaya bağlıysa hesabın firması aynı olmalı.
- `users.yonetim_profili` PERSONEL / YONETICI / SAHIP — **yalnız merkez tam yönetici** atayabilir; kişi kendi profilini değiştiremez.
- Taşeronun kayıtlarda geçen diğer yazımları `subcon_takma_ad` tablosunda, **tam eşleşme** (UPPER/TRIM); aynı ad iki taşerona verilemez.
- Personel kaydı bağlantısı `personel.user_id` (başka hesaba bağlı kayıt seçilemez; şirket sahibine otomatik personel kaydı açılmaz).

## 3. Yetki tablosu
| İşlem | Personel | Yönetici | Şirket sahibi | Taşeron | Merkez admin | Alt marka admini (Teknocenter) |
|---|---|---|---|---|---|---|
| Kendi avans / masraf / zimmet | ✓ | ✓ (kaydı varsa) | ✓ (kaydı varsa) | — | ✓ | ✓ |
| Personel Yönetimi (liste + detay) | — | kendi firması | kendi firması | — | profil atanırsa | profil atanırsa |
| Personel maaşı | — | yalnız kişiye özel izinle | ✓ (kendi firması; kişiye özel kapatılabilir) | — | mevcut kural | mevcut kural |
| Başka firmanın personeli | — | — (404) | — (404) | — | mevcut kural | — |
| Taşeron paneli | — | — | — | yalnız kendi taşeronu | — | — |
| Başka taşeronun işi / fiyatı / faturası / belgesi | — | — | — | — (404) | — | — |
| Kendi işinde "başladık" / "tamamlandı" | — | — | — | ✓ (mevcut akış) | — | — |
| Fiyat, QC, ödeme değiştirme | — | — | — | **—** | finans kuralı | — |
| Taşerona fiyatlı iş atama | — | — | — | — | ✓ (iş atama yetkilisi: Nurcan, rollout/bölge müdürü…) | — |
| Kullanıcı listesi / düzenleme | — | — | — | — | tümü | **yalnız kendi firması** |
| Şirket sahibi / yönetici profili verme | — | — | — | — | ✓ | — |

Maaş alanı yetki yoksa **yanıtta hiç yer almaz** (yalnız ekranda gizleme değil). Nurcan, Serdar, Yağmur, Hatice için mevcut
`yetki_ayar` (maas_goruntule=false, gizli_arac_kira_goruntule=false) aynen geçerli; Personel Yönetimi erişimi maaş yetkisi vermez.

## 4. Taşeron paneli ve hesap kuralları
- **Atanan işler:** yalnız `is_atama.taseron_id` = kendi taşeronu. Kapsam kalemleri, **anlaşılmış** fiyat (para birimi, KDV esası),
  revizyon geçmişi (tarih + neden), saha, teknik belgeler (TSSR, LOS, BTK, EMR, YSB, enerji projesi, FSC). Kabul / memnuniyet /
  perakende sözleşme-dekont gibi müşteri ve ödeme belgeleri verilmez. Belge adresi listede verilmez; indirme önce iş + taşeron + saha doğrulaması.
- **Fiyat:** atama anında sürüm 1 olarak saklanır; değişiklik yalnız yeni sürümle (neden zorunlu, yapan kaydedilir). Sıfır/eksik fiyat
  kabul edilmez; fiyat girilmediyse taşeron "fiyat belirlenmedi" görür. Öneri yalnız **aynı taşeronla** daha önce anlaşılmış fiyattan;
  Huawei fiyatı, şirket kârı ya da başka taşeronun fiyatı hiçbir uçtan gönderilmez.
- **Hakediş (yeni kural icat edilmedi):** bedel = anlaşılan birim fiyat × hakedişe esas miktar. Kalem kodu varsa miktar ve QC mevcut
  `master_works` kaydından (`COALESCE(tamamlanan_qty, done_qty)`, yalnız QC 'OK' faturalanabilir — /finance/subcon-paket-bedel ile aynı);
  kayıt yoksa "gerçekleşen miktar bekleniyor" (toplama girmez). Paket kalemde iş tamamlanınca anlaşılan miktar, QC sahanın Rollout QC'sinden.
  İptal hakedişe girmez; aynı saha + kalem iki işte geçerse ikincisi "mükerrer" (toplanmaz). Para birimleri ayrı toplanır.
  Faturalandı mı: bu taşeronun `bolge_fatura` satırı ya da faturasına bağlı `fatura_saha_kalem` sahası var mı.
- **Faturalar ve ödemeler:** web'de girilen `invoice_entries` + `taseron_odeme_log` (yeniden oluşturulmaz). Saha bağlantısı
  `fatura_saha_kalem`'den; yoksa "Saha bağlantısı eksik" (tahminle bağlanmaz). Kısmi ödeme geçmişi dağılımdan. Yalnız görüntüleme.

## 5. Kapatılan açıklar (bu iş sırasında bulundu)
1. **Hesap ele geçirme:** `POST /admin/users` "aynı e-postayla yeniden ekle" yolu, her kullanıcı yöneticisine herhangi bir hesabın
   (admin dahil) şifresini ve rolünü değiştirtiyordu → hedef hesap kapsam/rol kontrolü + kendi rolünü değiştirme yasak.
2. **Teknocenter yöneticisi tüm ERC kullanıcılarını** listeleyip rol/firma/maaş izni değiştirebiliyordu → alt marka yöneticisi yalnız
   kendi firma kapsamı; başka firmaya kullanıcı taşıyamaz.
3. **`/taseron/*` (taşeron fatura/ödeme yönetimi)** yalnız girişe bakıyordu: her personel ve taşeron tüm taşeron faturalarını okuyup
   silebiliyordu → Finans Paneli yetkisi (web'de bu ekranı yalnız Finans Paneli kullanıyor).
4. Taşeron hesabı `/is-atama/liste` ile tüm atamaları görebiliyor, `/rollout/:id/belge-url` ile saha belge adresi değiştirebiliyordu → kapalı.
5. Taşeron adı (`subcon_name`) oturum boyunca 90 gün token'dan okunuyordu → her istekte veritabanından.
6. Taşeron hesabına iş atama yetkisi hiçbir koşulda verilmez.

## 6. Değişen / yeni dosyalar
- `backend/omnixProfil.js` (yeni): profil okuma, taşeron kapsam kapısı, `/taseron-panel/*`, `/yonetim/*`, `/admin/taseronlar`,
  `/is-atama/taseronlar`, `/is-atama/fiyat-oneri`, `PUT /is-atama/:id/fiyat`.
- `backend/server.js`: oturum tazeleme profil alanları; izinler (personel_yonetimi, sahipte maaş); `/auth/login` + `/auth/me` profil;
  admin kapsam ve hesap ele geçirme düzeltmeleri; `PUT /admin/users/:id` kullanıcı tipi/taşeron/profil/personel bağlantısı + işlem geçmişi;
  `POST /is-atama` taşeron + fiyat; taşeronun kendi işinde başla/çıkış; hesap ekstresi tek fonksiyon (`personelHesapEkstresi`);
  taşeron için kapalı uçlar; `/health` build `2026-10-25-profil`. (Önceki gizlilik yaması da bu dosyada, commit edilmedi.)
- `backend/migrations/2026-10-25_omnix_profil.sql` (yeni, uygulanmadı) ve `2026-10-25_omnix_eslestirme_raporu.sql` (salt okunur rapor).
- `frontend/frontend/src/App.jsx` (web): Admin → Kullanıcılar formunda kullanıcı tipi, taşeron listesi, ana firma, profil, personel
  kaydı, maaş izni; satırda "Şirket sahibi / Yönetici" ve "eski tip taşeron bağlantısı" işaretleri. İş Ata formunda "Taşerona ata" +
  anlaşılmış fiyat kalemleri, para birimi, KDV, toplam, önceki anlaşmalardan doldurma.
- `omnix-mobile`: `src/mantik/profil.js`, `src/ekranlar/YonetimEkranlari.js`, `src/ekranlar/TaseronEkranlari.js` (yeni); gezinme,
  API uçları, profil ekranı, para birimi biçimi. Ana sayfa görüntüleme hataları (madde 9) düzeltildi — bkz. TESLIM.md bölüm 0.

## 7. Testler (yerel, sahte veri; canlıya bağlanılmadı)
| Test | Sonuç |
|---|---|
| `test/yerel/profil.test.mjs` — Şimşek personeli, Teknocenter personeli, Teknocenter şirket sahibi, maaş izni olmayan yönetici, Taşeron A (+ aynı taşerona ikinci kullanıcı), Taşeron B, bağlantısız ve eski tip taşeron, Teknocenter alt marka yöneticisi, Nurcan | 8/8 |
| `test/yerel/yetki.test.mjs` (önceki gizlilik yaması) | 8/8 |
| `test/yerel/uctan_uca.test.mjs` (mevcut Omnix akışları) | 9/9 |
| Birim testleri (`npm test`) | 29/29 |
| Web derlemesi (`vite build`) | Başarılı |
| Simülatör (Expo Go): şirket sahibi ana sayfa → Personel Yönetimi → Personel Detayı; taşeron ana sayfa → İşler → İş detayı → Hakediş | Çalıştı |
| Web önizleme (yerel API): Admin → Kullanıcı düzenle — şirket içi / taşeron alanları | Görüntülendi (kaydedilmedi) |

Profil testinde doğrulananlar: sahibin maaşı görmesi ve kişiye özel kapatılınca görmemesi; yöneticide maaş alanının yanıtta hiç
olmaması; personelin yönetim uçlarına girememesi; Nurcan'ın atamasında aynı sahadaki A (1.100) ve B (1.500) fiyatlarının birbirine
sızmaması; revizyonun sürümlü ve nedenli olması; taşeronun fiyat değiştirememesi; QC 'NOK' iken hakedişin kesin gösterilmemesi,
'OK' olunca uygun tutara geçmesi; faturaya bağlı sahanın "faturalanmış" sayılması; web'de girilen kısmi ödemenin aynı kayıttan
görünmesi; takma adla girilmiş faturanın doğru taşerona düşmesi; B'nin A'nın faturası/belgesi/işi için 404 alması; eski açık uçların kapalı olması.

**Sınırlar:** onaycı (Onaylar) ekranları bu turda değişmedi. Simülatörde bağlantısız taşeron ekranı ve yönetici (maaşsız) ekranı
açılmadı — davranışları API testleriyle doğrulandı. Gerçek iPhone ve canlı veriyle test yapılmadı.

## 8. Karar / onay bekleyenler
1. **Commit + deploy** (önce web, sonra API; push sizde). Backend açılışta migration'ı kendisi uygular (yalnız ekleme).
2. **İlhami Şahin ve Mustafa Şahin (Orhan onayı 25.10.2026):** canlı veritabanı salt-okunur bekçiyle okundu (yazma yok).
   Sonuç: **ikisinin de kişisel kullanıcı hesabı ve personel kaydı yok.** Teknocenter'a bağlı tek hesap ortak `teknocenter` girişi
   (id 1285, rol admin). `ilhami.sahin@simsektel.com` ile kayıt yok. İsim benzerliği yalnız alakasız bir AHY personeli
   ("MUSTAFA ELELER", id 19) — ona yetki verilmez. Uygulanacak adımlar (backend deploy'dan SONRA, çünkü profil kolonu canlıda henüz yok):
   - Admin → Kullanıcılar → Kullanıcı Ekle (Orhan 25.10.2026 akşam): İlhami Şahin ve Mustafa Şahin, Orhan'ın verdiği adresler
     `ilhami.şahin@simsektel.com`, `mustafa.şahin@simsektel.com`. **Öneri: "ş" yerine "s" (`ilhami.sahin@…`, `mustafa.sahin@…`)** —
     Türkçe karakterli e-posta adresleri çoğu posta sunucusunda çalışmaz; giriş kullanıcı adı olarak çalışır ama şifre sıfırlama /
     bildirim e-postası gitmeyebilir. Hangisi seçilirse posta kutusunun gerçekten var olduğu teyit edilmeli.
   - Kullanıcı tipi "Şirket içi", Firma "Teknocenter", Profil "Şirket sahibi", Personel kaydı boş (zorunlu değil), Maaş izni "Profil kuralı".
   - Şifreyi siz belirleyip kişiye iletin (şifre ve hesap açma sizde; ben canlıda hesap açmıyorum).
   - Ortak `teknocenter` girişi değişmeden kalır; kişisel hesaplar işlem geçmişinde kimin ne yaptığını ayırır.
3. **Eski taşeron hesapları (Orhan kararı 25.10.2026): geçiş yapılmayacak.** Taşeron paneli **1 Kasım 2026'dan itibaren yeni
   taşeronlar** için kullanılacak: yeni taşeron kaydı (subcons) + taşeron firma kullanıcısı admin panelinden listeden bağlanır, işler
   fiyatıyla atanır. Eski tip taşeron hesapları olduğu gibi kalır (web'deki mevcut ekranları değişmedi; mobilde taşeron verisi görmezler).
   Eşleştirme raporunun 1–3. bölümleri gerekmiyor; 5. bölüm (sahip doğrulama) çalıştırıldı.
4. **Şirket sahibine onay adımı:** mevcut onay zincirleri (avans RM→PM→PD→ödeme, masraf) korunuyor; sahibin özet ekranında onay
   bekleyen sayılar görünüyor ama sahip bir onay adımına otomatik eklenmedi. Hangi adımı (ör. Teknocenter PD/ödeme) alacağına karar verin.
5. Bilerek dokunulmayanlar (sizin kararınız): 2KX taşeronunun kendi fiyat kurallarını düzenleyebildiği `/2kx/pricing` ekranı (ayrı
   firma/tenant akışı); `/master/list-detailed` ve `/dashboard/result` taşerona Huawei PO birim fiyatı gönderiyor (web Bölge Analizi);
   saha belgeleri genel (public) depoda — mobil taşeron yalnız doğrulanmış bağlantı alıyor ama adres kalıcı; kısa ömürlü imzalı bağlantı
   için belgelerin özel depoya taşınması gerekir; `/hr/personel/:id/isg` ve `/belgeler` firma kapsamı yok; eski `taseron_fatura` tablosu
   (Taşeron Fatura Yönetimi) mobilde gösterilmiyor — mobil, Ödeme Motoru'nun `invoice_entries` kayıtlarını gösteriyor.
6. **iPhone test build'i:** TestFlight'taki build 4 bu özellikleri içermiyor. Commit/deploy onayından sonra build 5 (EAS) → TestFlight
   dahili grup (yalnız siz). Taşeron/yönetim ekranları canlı API'de backend deploy edilmeden çalışmaz.

## 9. Ekran görüntüleri
`teslim/ekran-goruntuleri/` 21 şirket sahibi ana sayfa · 22 personel detayı · 23 taşeron ana sayfa · 24 taşeron iş detayı ·
25 taşeron hakediş · 26 web admin (şirket sahibi profili) · 27 web admin (taşeron firma kullanıcısı).

## 10. Android (bilgi, 25.10.2026)
Google Play kuruluş hesabı "Omnix Global" açıldı (Efelis, D-U-N-S 595956895); Google'ın kimlik/kuruluş ve SMS doğrulaması bekleniyor.
Onaydan sonra sıra: Play'de "Omnix Field Operation" uygulaması → paket adı `global.omnix.app` kaydı → AAB (artan versionCode,
Play App Signing) → önce dahili test kanalı. Her adım Orhan onayıyla; onay gelmeden Play'de yayın yapılamaz.
