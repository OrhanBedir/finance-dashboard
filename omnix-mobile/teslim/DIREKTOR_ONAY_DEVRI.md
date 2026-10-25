# Teknocenter direktör / şirket sahibi deneyimi + 1 Kasım 2026 onay devri (25.10.2026 gece)

Durum: **yerelde hazır, commit edilmedi, canlıya çıkmadı.** Commit, canlı yetki değişikliği, migration, deploy ve TestFlight
için Orhan'ın açık onayı bekleniyor. Görünüm (renk, kart, tipografi) değiştirilmedi; mevcut bileşenler kullanıldı.

## 1. Ekteki sorunun kök nedeni

İlhami Şahin hesabında firma Teknocenter, unvan "Proje direktörü" göründüğü hâlde personel ana ekranı açılıyor, Onaylar ve
Personel Yönetimi görünmüyordu. Üç ayrı mekanizma birbirinden habersizdi:

| Katman | Neye bakıyordu | Sonuç |
|---|---|---|
| Mobil deneyim seçimi (`mantik/profil.js`) | yalnız `users.yonetim_profili` (SAHIP / YONETICI) ya da kişiye özel `personel_yonetimi` izni | rol `direktor` yalnız **unvan etiketi** üretiyordu ("Proje direktörü"); hesap "Şirket sahibi" profiliyle açılmadıysa personel ekranı |
| Onaycı bayrakları (`/hr/mobile-dashboard`) | **sabit e-postalar**: direktör = `duzgun.simsek@simsektel.com`, PM = Orhan; RM/PD/ODE = `AVANS_YETKI` listeleri; masraf = `MASRAF_PD_MAIL` | İlhami hiçbir listede yok → Onaylar sekmesi yok, hiçbir adımı onaylayamaz |
| Personel Yönetimi (`/yonetim/*`) | profil ya da `personel_yonetimi` izni | rol `direktor` için izin tanımı yoktu |

Ayrıca backend `rolsüz jeton → önbellek` yolunda profil 60 sn önbelleklenir; mobil `/auth/me`'yi her açılışta ve öne gelişte
çağırdığı için eski token / cihaz önbelleği yanlış paneli açmaz (deneyim her seferinde backend yanıtından seçilir).

**Düzeltme:** `ROL_IZINLERI.direktor = { personel_yonetimi: true }` — direktör rolü kendi firma kapsamında personel yönetimi
görür; **maaş ayrı izindir** (şirket sahibi profili ya da kişiye özel `maas_goruntule`), bu rolle açılmaz. Onay yetkisi ise
e-posta listesine isim eklenerek değil, **tarihli onay devri** yapısıyla verilir (aşağıda).

## 2. Tarihli onay devri — `backend/onayDevri.js`

Tablo `onay_devri (firma, adim, onayci_user_id, baslangic, bitis, aktif, aciklama, olusturan)`:

- **firma**: talebin üzerinde olduğu personelin firması (ERC / TEKNO / AHY). Kasa seçimi firmayı değiştirmez.
- **adim**: `AVANS_PD` (iş avansı direktör onayı), `MASRAF_PD` (masraf formu direktör onayı). Malzeme talebinde direktör adımı
  yoktur (PM → fiyat girişi → depo); devredilecek adım olmadığı için kapsama alınmadı.
- **onayci_user_id**: kalıcı kullanıcı kimliği (`users.id`) — isim/e-posta benzerliği yok.
- **yürürlük**: `baslangic` dahil, `bitis` hariç; **her istekte o anın saatiyle** hesaplanır (sunucu/uygulama yeniden başlatılmaz;
  satırlar 10 sn önbellekte, zaman kıyası her çağrıda). Saf kural `devirAktifMi(satır, an)` testte sınırla doğrulanır.

Kurallar:
- Aktif devir varsa o firmanın o adımını **yalnız devralan** onaylar: Düzgün ve ortak `teknocenter` hesabı Teknocenter'ın
  direktör adımını web/eski mobil/API'den de veremez (403, açık mesaj). Devir yoksa eski kural aynen (Şimşek/AHY değişmez).
- Devralan **yalnız kendi adımını** yapar: Rollout Müdürü / PM / muhasebe adımları korunur, zincir tek onaya inmez; muhasebenin
  ödeme adımı (`DIREKTOR_ONAY → TAMAMLANDI`) ayrı kalır.
- Yönlendirme ölçütü talebin oluşturulma tarihi değil **işlem anı**: devirden önce açılmış, hâlâ bekleyen talepler de devralana gider.
  Tamamlanmış onayların onaycı adı/tarihi değişmez; önceki adımlar yeniden başlatılmaz, mükerrer talep oluşmaz.
- Devralan hesap **yok/pasif** ise sessizce eski onaycıya dönülmez: adım kilitlenir, listede ve 403 yanıtında yapılandırma hatası
  açıkça yazılır.
- Düzgün'ün Teknocenter'daki RM/PM yetkileri ve diğer firmalardaki tüm yetkileri korunur (listesinde TEKNO TALEP/ROLLOUT
  aşamaları "tek adım ilerlet" olarak kalır).
- Çift dokunma / eş zamanlı istek: tüm onay UPDATE'leri `AND durum = <okunan durum>` ile; ikinci istek **409** ("az önce işlendi").
- Denetim izi: `islem_gecmisi` kaydında adım (`ROLLOUT/PM/DIREKTOR/ODEME`), `onay_kaynagi` (`eski` liste / `devir`) ve talebin
  firması; devir tanımları da `onay_devri` modülüyle geçmişe yazılır.

Uçlar: `GET /onay/bekleyen` (kullanıcının ŞU AN işlem yapabileceği kayıtlar: avans / masraf / malzeme; `sayac`, `devirler`,
`planli`, `yapilandirma_hatasi`), `GET/POST /admin/onay-devri`, `PUT /admin/onay-devri/:id/bitir` (tam admin; alt marka
yöneticisi yalnız kendi firması). `/auth/me` ve giriş yanıtına `onay` özeti eklendi (sekme ilk çizimden itibaren kalıcı).

Değişen mevcut uçlar: `PUT /hr/is-avans/:id/{onayla, direktor-onayla, pm-onayla, reddet}`, `PUT /hr/masraf-form/:id/{direktor-onayla,
geri-gonder, direktor-reddet}`, `GET /hr/mobile-dashboard` (eski mobil pano da süzülür), `/auth/me`, `/auth/login`.

## 3. Mobil (Omnix Field Operation)

- **Direktör ana sayfası** (`YonetimAnaSayfa`): 1) Onayınızı bekleyen işlemler (kalıcı kart; 0 iken "Bekleyen işlem yok";
  planlı devir bilgisi; yapılandırma hatası bandı) 2) belirgin **Personel Yönetimi** düğmesi 3) Saha ve iş durumu
  4) yetki dahilindeki şirket özeti 5) varsa "Kişisel işlemlerim". Kişisel puantaj/mesai kartı yok; otomatik personel kaydı üretilmez.
- **Onaylar sekmesi**: `/auth/me.onay.onayci` ile ilk çizimden itibaren kalıcı; rozet = şu an işlem yapılabilecek kayıt (+ Clean Up).
  Kategoriler: İş avansı, Masraf formları, Malzeme talepleri, Clean Up. Her kayıtta personel, tür, tarih, tutar, açıklama, onay
  aşaması ve firma rozeti. Masraf formu: İncele (kalemler + fişler büyütülebilir) · Onayla · Geri gönder · Reddet (PM/Direktör
  adımında). Onay sonrası liste, rozet, ana sayfa sayacı ve şirket özeti birlikte yenilenir; tek işlem kilidi + 409.
- **Personel Yönetimi**: alttan açılan sayfa (`presentation: modal`), "Personel adı yazın" alanı; arama **sunucuda firma
  kapsamıyla** (`/yonetim/personel?q=`), 300 ms bekleme, sıra numarası ile geç yanıt yeni sonucu ezmez, sayfalama, ayrı yükleniyor /
  sonuç yok / hata durumları, Türkçe harf ve büyük-küçük duyarsız ("End" → Ender Teke).
- **Personel Detayı**: sekmeler Genel Bakış · Avans & Masraf · Maaş · Puantaj (günlük kayıtlar eklendi) · Saha & İşler
  (atanan/devam eden ↔ tamamlanan) · Zimmet. Tüm bölümler aynı `personel.id`'den; veri anahtarı kişi + dönem olduğu için önceki
  kişinin verisi yeni kişide görünmez. Maaş yetkisi yoksa alan API yanıtında hiç yoktur ("yetki_yok").
- Hesap değişiminde bellekteki tüm veri (`VeriSaglayici` anahtarı kullanıcı+firma) sıfırlanır.

## 4. Yetki tablosu (yerel testle doğrulanan)

| İşlem | Personel | Düzgün (eski direktör, admin) | İlhami (direktor rolü, TEKNO) — devir öncesi | İlhami — devir sonrası |
|---|---|---|---|---|
| Yönetim ana sayfası / Personel Yönetimi | ✗ (403) | ✓ (ERC kapsamı) | ✓ (TEKNO+AHY bordro kapsamı) | ✓ |
| Başka firmanın personel detayı | ✗ | — | ✗ 404 | ✗ 404 |
| Maaş bölümü | ✗ | rolüne göre | ✗ `yetki_yok` (rol maaş açmaz) | ✗ (şirket sahibi profili/izin gerekir) |
| Onaylar sekmesi | ✗ | ✓ | ✓ (planlı devir bilgisi, 0 kayıt) | ✓ (TEKNO PM_ONAY avans + DIREKTOR_BEKLE masraf) |
| TEKNO avans direktör onayı | ✗ | ✓ | ✗ 403 | ✓ (yalnız PM_ONAY'da) |
| TEKNO avans direktör onayı (Düzgün) | — | ✓ | — | **✗ 403** (eski token dahil), listeden düşer |
| TEKNO TALEP/ROLLOUT aşaması | — | ✓ tek adım ilerletir (RM/PM) | ✗ | ✗ (zincir korunur) |
| ERC avans/masraf | — | ✓ değişmedi | ✗ | ✗ |
| TEKNO masraf direktör onayı | ✗ | ✓ → **✗ 403** | ✗ | ✓ |
| İkinci kez aynı onay | — | 409 | — | 409 |
| Devralan pasif | — | ✗ 403 "pasif / kilitli" + liste uyarısı | — | — |

## 5. Testler

`test/yerel/onay_devri.test.mjs` (yalnız 127.0.0.1:5099 sahte veri): sınır anı (31.10 23:59:59 ✗ / 01.11 00:00:00 ✓, Europe/Istanbul),
devir öncesi, devir sonrası (bekleyen eski talep dahil, Düzgün eski token 403, zincir, ERC değişmedi, geçmiş onay değişmedi,
409, denetim izi), direktör rolü + "End" araması + kapsam + maaş, normal personel, pasif devralan, devir bitince eski kural.
Sonuçlar: bkz. bölüm 7.

## 6. Canlıya alma önerisi (uygulanmadı — Orhan onayı sonrası)

1. **Hesap**: Admin → Kullanıcılar'da İlhami Şahin: Şirket içi · firma Teknocenter · rol **Proje direktörü** (`direktor`);
   istenirse profil "Şirket sahibi" (o zaman maaş da açılır). Mustafa Şahin: Şirket sahibi profili (önceki karar). E-posta
   `ilhami.şahin@simsektel.com` ("ş" yerine `s` önerilir; giriş adı olarak telefon klavyesinde daha kolay).
2. **Deploy**: API (server.js + onayDevri.js + omnixProfil.js) → tablo açılışta kendiliğinden oluşur (`onay_devri`, RLS açık).
   `backend/migrations/2026-10-26_onay_devri.sql` aynı ifadeleri + devir satırlarını içerir.
3. **Devir tanımı** (deploy'dan sonra, 1 Kasım'dan önce): `POST /admin/onay-devri` ×2 — `{firma:"TEKNO", adim:"AVANS_PD"|"MASRAF_PD",
   onayci_user_id:<İlhami id>, baslangic:"2026-11-01T00:00:00+03:00"}` (ya da migration dosyasındaki INSERT). Tarih gelince
   yönlendirme kendiliğinden değişir; yeniden başlatma gerekmez. Yanlışsa `PUT /admin/onay-devri/:id/bitir`.
4. **Mobil**: build 8 (Onaylar/Yönetim ekranları); build 7 bu ekranları içermez.
5. **Web paneli**: Admin → Kullanıcılar sayfasının altına "Onay devri (tarihli)" bölümü eklendi (yalnız tam admin): tanımlı
   devirler (durum: Yürürlükte / Planlı / Bitti / İptal / Devralan pasif — adım kilitli), yeni devir formu (firma, adım,
   devralan kullanıcı, yürürlük Türkiye saati, açıklama; onay sorusu), "Bitir / İptal et". SQL'e gerek kalmaz.

## 7. Sonuçlar ve ekran görüntüleri

**Yerel testler (25.10.2026 gece, taze tohum sonrası):** `onay_devri` 7/7 · `yetki` 9/9 · `profil` 8/8 · `uctan_uca` 9/9 ·
birim `npm test` 29/29. Mobil paket (`expo export`) ve web derlemesi (`vite build`) hatasız.

| # | Ekran | Dosya |
|---|---|---|
| 29 | İlhami — direktör ana sayfası: Onayınızı bekleyen işlemler (3 kayıt), Personel Yönetimi düğmesi, saha durumu, şirket özeti; Onaylar sekmesi rozetli | `teslim/ekran-goruntuleri/29-direktor-ana-sayfa.png` |
| 30 | Onaylar: devir bandı, iş avansı (Teknocenter rozeti, "Direktör onayı" aşaması), masraf formu kategorisi | `30-direktor-onaylar.png` |
| 31 | Masraf formu inceleme: akış, kalemler, Geri gönder / Reddet / Onayla | `31-direktor-masraf-inceleme.png` |
| 32 | Personel Yönetimi (alttan açılan sayfa): "End" → Ender Teke | `32-personel-yonetimi-arama.png` |
| 33 | Personel detayı — Genel Bakış + bu ay özeti, sekmeler | `33-personel-detay-genel.png` |
| 34 | Personel detayı — Puantaj (özet + günlük kayıtlar) | `34-personel-detay-puantaj.png` |
| 35 | Personel detayı — Maaş: yetki yok (direktör rolü maaş açmaz) | `35-personel-detay-maas-yetki-yok.png` |
| 36 | Normal personel (Mehmet Kaya, Teknocenter): personel ana ekranı, Onaylar sekmesi ve yönetim işlevleri yok | `36-personel-ana-sayfa-karsilastirma.png` |

**Bilerek bırakılanlar / notlar**
- Personel Yönetimi sayfası modal açıldığında üst güvenli alan payı bir kez daha uygulanıyor (üstte boşluk); işlev etkilenmiyor, görsel ince ayar.
- Malzeme talebinde direktör adımı yok; İlhami'nin ekranında malzeme kategorisi yalnız PM yetkisi olanlarda görünür.
- Devralanın KENDİ masraf formu direktör adımına gelirse kendi onayını veremez (kimse kendi adımını onaylamaz kuralı); bu durum için
  ayrıca karar gerekir (eski kuralda Düzgün'ün formları direktör adımını atlıyordu).
- Teknocenter'ın ortak `teknocenter` hesabı da devirden sonra direktör adımını veremez (devir yalnız devralanda).
- Masraf direktör onayı artık yalnız `DIREKTOR_BEKLE` durumundaki formu kabul eder (önceden durum kontrolü yoktu); web akışı bu
  düğmeyi zaten yalnız o durumda gösteriyor.
