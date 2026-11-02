-- İş avansı red → düzelt → yeniden gönder; sürümlü onay turları (02.11.2026, Orhan şartnamesi) — UYGULANMADI, Orhan onayı bekliyor
-- Kod: backend/avansTur.js (+ server.js, teknoOnay.js, onayDevri.js). Geri dönüş: 2026-11-02_avans_red_duzelt_geri.sql
--
-- BÖLÜM 1 (yalnız ekleme — veri değişmez): sunucu açılışta avansTur.semaKur ile aynısını kendisi çalıştırır
--   (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS). Elle çalıştırmak gerekmez; yayınla birlikte otomatik uygulanır.
--   • is_avans_talep: aktif_tur_no (varsayılan 1), surum (varsayılan 1; iyimser kilit), red_asama, red_zamani, reddeden_user_id
--   • is_avans_tur: her gönderim (onay turu) ayrı satır — alanların anlık görüntüsü, değişen alanlar, düzeltme açıklaması, zincir özeti,
--     istek anahtarı (mükerrer gönderim engeli), sonuç (REDDEDILDI / ONAYLANDI / açık) ve red bilgisi (gerekçe, reddeden, aşama, zaman)
--   Mevcut 1744 kayıt değişmez; eski reddedilmiş kayıtlar tur satırı olmadan da okunur (uygulama 1. gönderimi talep anından sentezler;
--   gerekçe varsa gösterir, yoksa "Eski kayıtta red gerekçesi bulunmuyor" yazar — gerekçe uydurulmaz).
--
-- BÖLÜM 2 (isteğe bağlı, geriye doldurma): mevcut REDDEDILDI kayıtları için 1. tur satırı. UYGULANMASI ŞART DEĞİL — uygulama
--   bunu kayıt ilk kez yeniden gönderildiğinde zaten yapar. Yalnız raporlama tutarlılığı için; mevcut kolonlar DEĞİŞMEZ.
--   red_asama / red_zamani eski kayıtlarda bilinmediği için BOŞ bırakılır (uydurulmaz); islem_gecmisi'ndeki RED kaydı varsa
--   zamanı ve (Teknocenter zincirinde) aşaması oradan okunur.

BEGIN;

-- ── BÖLÜM 1 ──────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE is_avans_talep ADD COLUMN IF NOT EXISTS aktif_tur_no INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS surum INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS red_asama TEXT, ADD COLUMN IF NOT EXISTS red_zamani TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS reddeden_user_id INTEGER;

CREATE TABLE IF NOT EXISTS is_avans_tur (
  id SERIAL PRIMARY KEY,
  talep_id INTEGER NOT NULL REFERENCES is_avans_talep(id) ON DELETE CASCADE,
  tur_no INTEGER NOT NULL,
  gonderim_zamani TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  gonderen_email TEXT, gonderen_user_id INTEGER,
  gonderim_aciklama TEXT,
  alanlar JSONB, degisen JSONB, zincir JSONB,
  istek_anahtari TEXT,
  sonuc TEXT, sonuc_zamani TIMESTAMPTZ,
  red_aciklama TEXT, reddeden_email TEXT, reddeden_user_id INTEGER, red_asama TEXT, red_asama_tr TEXT, red_akis TEXT,
  UNIQUE (talep_id, tur_no));
CREATE UNIQUE INDEX IF NOT EXISTS is_avans_tur_acik_idx ON is_avans_tur (talep_id) WHERE sonuc IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS is_avans_tur_istek_idx ON is_avans_tur (istek_anahtari) WHERE istek_anahtari IS NOT NULL;
ALTER TABLE is_avans_tur ENABLE ROW LEVEL SECURITY;

-- ── BÖLÜM 2 (isteğe bağlı) ────────────────────────────────────────────────────────────────────────
-- Önizleme: tur satırı olmayan reddedilmiş kayıtlar (02.11.2026 salt-okunur sayım: 93 REDDEDILDI, 19'unda RED geçmiş kaydı var)
SELECT COUNT(*) AS tur_satiri_olmayan_red FROM is_avans_talep t WHERE t.durum = 'REDDEDILDI'
  AND NOT EXISTS (SELECT 1 FROM is_avans_tur x WHERE x.talep_id = t.id);
/*
INSERT INTO is_avans_tur (talep_id, tur_no, gonderim_zamani, gonderen_email, alanlar, sonuc, sonuc_zamani, red_aciklama, reddeden_email, red_asama, red_akis)
SELECT t.id, 1, COALESCE(t.created_at, NOW()), LOWER(TRIM(t.talep_eden_email)),
  jsonb_build_object('tutar', t.tutar, 'tarih', t.tarih, 'gider_turu', t.gider_turu, 'bolge', t.bolge, 'proje', t.proje, 'plaka', t.plaka,
    'arac_km', t.arac_km, 'aciklama', t.aciklama, 'not_aciklama', t.not_aciklama, 'son_odeme_tarihi', t.son_odeme_tarihi, 'firma', t.firma, 'personel_id', t.personel_id),
  'REDDEDILDI', g.created_at, t.red_aciklama, LOWER(TRIM(t.reddeden_email)), g.adim, g.akis
FROM is_avans_talep t
LEFT JOIN LATERAL (SELECT created_at, yeni->>'adim' AS adim, yeni->>'akis' AS akis FROM islem_gecmisi WHERE modul='avans' AND tip='RED' AND kayit_id=t.id ORDER BY id DESC LIMIT 1) g ON true
WHERE t.durum = 'REDDEDILDI' AND NOT EXISTS (SELECT 1 FROM is_avans_tur x WHERE x.talep_id = t.id)
ON CONFLICT (talep_id, tur_no) DO NOTHING;
*/

COMMIT;
