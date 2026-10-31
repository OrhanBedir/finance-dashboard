-- Teknocenter iş avansı / masraf onay zinciri (31.10.2026) — UYGULANMADI, Orhan onayı bekliyor
-- Kod: backend/teknoOnay.js. Kural özeti (Orhan kararı 31.10.2026): bölge müdürü (personel kartı bölgesi; boşsa ekip bölgesi; o da
-- yoksa doğrudan Orhan) → Orhan → İlhami → Teknocenter muhasebesi. Depo personeli ve Hatice doğrudan Orhan. Ekip şefi aşaması YOK.
--
-- BÖLÜM 1 (yalnız sütun ekleme): sunucu açılışta teknoOnay.semaKur ile aynısını kendisi çalıştırır (ADD COLUMN IF NOT EXISTS);
--          mevcut satırlar değişmez. Elle çalıştırmak gerekmez.
-- BÖLÜM 2 (durum hizalama): Teknocenter zincirindeki ve Şimşek muhasebe kontrolünde (MUHASEBE_BEKLE) bekleyen masraf formları,
--          yeni zincirde bu ara adım olmadığı için PM_BEKLE (Orhan) yapılır. Uygulama mantığı bu formları zaten Orhan
--          aşamasında sayar; bu bölüm yalnız durum etiketini (eski mobil sürüm, raporlar) gerçek aşamayla eşler.
--          Onay tarihleri / onaylayanlar DEĞİŞMEZ; ödenmiş, reddedilmiş, arşivlenmiş kayda dokunulmaz.
--          Her değişiklik işlem geçmişine "Onay zincirine yönlendirildi" olarak, kullanıcı alanı 'sistem: tekno-onay geçişi' ile yazılır.
-- BÖLÜM 3 (bilgi): Beyazıt Bestami Dedeoğlu kayıt düzeltmesi 31.10.2026'da canlıda ayrıca uygulandı.
--
-- Uygulamadan önce önizlemeyi yeniden çalıştırın (canlı veri sürekli değişiyor). Bu dosya tek başına bir işlem (transaction) içindedir.

BEGIN;

-- ── BÖLÜM 1 ──────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE is_avans_talep ADD COLUMN IF NOT EXISTS pm_onaylayan TEXT,
  ADD COLUMN IF NOT EXISTS direktor_onaylayan TEXT, ADD COLUMN IF NOT EXISTS direktor_onay_kaynagi TEXT;
ALTER TABLE masraf_form ADD COLUMN IF NOT EXISTS pm_onaylayan TEXT,
  ADD COLUMN IF NOT EXISTS direktor_onaylayan TEXT, ADD COLUMN IF NOT EXISTS direktor_onay_kaynagi TEXT;

-- ── BÖLÜM 2 ──────────────────────────────────────────────────────────────────────────────────────
-- Zincir ölçütü (teknoOnay.js ile aynı): formun firması (personel markası → talep edenin personel / kullanıcı markası) TEKNO
-- ve formdaki tüm kalemler Teknocenter döneminde (markalar.devir_baslangic, TR günü).
CREATE TEMP TABLE _tekno_mf ON COMMIT DROP AS
SELECT mf.id, mf.durum
FROM masraf_form mf
LEFT JOIN personel p ON p.id = mf.personel_id
CROSS JOIN (SELECT (devir_baslangic AT TIME ZONE 'Europe/Istanbul')::date AS devir FROM markalar WHERE kod = 'TEKNO') m
WHERE mf.durum = 'MUHASEBE_BEKLE'
  AND UPPER(COALESCE(NULLIF(TRIM(p.marka),''),
        (SELECT COALESCE(NULLIF(TRIM(pp.marka),''),'ERC') FROM personel pp WHERE LOWER(TRIM(COALESCE(pp.email,''))) = LOWER(TRIM(COALESCE(mf.talep_eden_email,''))) AND pp.aktif ORDER BY pp.id DESC LIMIT 1),
        (SELECT COALESCE(NULLIF(TRIM(u.marka),''),'ERC') FROM users u WHERE LOWER(TRIM(u.email)) = LOWER(TRIM(COALESCE(mf.talep_eden_email,''))) ORDER BY u.id DESC LIMIT 1), 'ERC')) = 'TEKNO'
  AND NOT EXISTS (SELECT 1 FROM masraf_kalem mk WHERE mk.form_id = mf.id AND (mk.tarih IS NULL OR mk.tarih < m.devir));

-- Önizleme (31.10.2026 salt-okunur sayımda 11 form: 236, 283, 286, 291, 295, 296, 297, 299, 300, 302, 303)
SELECT mf.id, mf.form_no, mf.talep_eden_ad, mf.durum FROM masraf_form mf JOIN _tekno_mf t ON t.id = mf.id ORDER BY mf.id;

INSERT INTO islem_gecmisi (modul, kayit_id, tip, eski, yeni, aciklama, kullanici)
SELECT 'masraf', t.id, 'YONLENDIRME', jsonb_build_object('durum', 'MUHASEBE_BEKLE'),
       jsonb_build_object('durum', 'PM_BEKLE', 'akis', 'TEKNO', 'atlanan', 'Şimşek muhasebe kontrolü Teknocenter zincirinde yok (kontrol Teknocenter muhasebesinin arşiv adımında)'),
       'Teknocenter onay zincirine geçiş: form Orhan Bedir onayına yönlendirildi', 'sistem: tekno-onay geçişi'
FROM _tekno_mf t;

UPDATE masraf_form mf SET durum = 'PM_BEKLE'
FROM _tekno_mf t WHERE mf.id = t.id AND mf.durum = 'MUHASEBE_BEKLE';

-- İş avansı: 31.10.2026 önizlemesinde durum hizalaması gereken talep YOK (28 talep; 20'si PM_ONAY → artık İlhami Şahin,
-- 6'sı ROLLOUT_MUDUR_ONAY → Orhan Bedir, 2'si TALEP → Nurcan Kuş). Aşama kod tarafından hesaplanır; veri değişikliği gerekmez.

COMMIT;

-- ── BÖLÜM 3 — 31.10.2026'DA CANLIDA UYGULANDI (Orhan talimatı: "düzelt haber edersin"); tekrar çalıştırmayın ──────────
-- Beyazıt Bestami Dedeoğlu: personel kartı (35) e-postası giriş hesabıyla eşitlendi (beyazit.bestami@ → beyazit.bustami@) ve
-- kart kullanıcı 693'e bağlandı; açık 4 iş avansı (1760, 1761, 1776, 1777) karta bağlandı (onay durumları değişmedi).
-- Ödenmiş / reddedilmiş eski kayıtlara dokunulmadı. Yedek ve betik: Claude_Teslim/Tekno_Onay_Akisi_2026-10-31/canli_duzeltme/
