-- PLAN ↔ MOBİL İŞ ATAMASI SENKRONU (02.11.2026) — şema. UYGULANMADI: canlıda yalnız Orhan'ın açık onayıyla.
-- Aynı ifadeler backend açılışında (planSenkron.semaKur) IF NOT EXISTS ile çalışır; yeni backend yayına alınınca kendiliğinden oluşur.
-- Yalnız EKLEME: is_atama'ya 4 boş kolon, 2 yeni tablo. Mevcut atamalar, plan blokları ve gün kayıtları DEĞİŞMEZ.
BEGIN;
CREATE TABLE IF NOT EXISTS is_atama_istek (kullanici TEXT NOT NULL, anahtar TEXT NOT NULL, uc TEXT NOT NULL, sonuc JSONB, created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (kullanici, anahtar));
CREATE TABLE IF NOT EXISTS is_bildirim_inceleme (id BIGSERIAL PRIMARY KEY, is_atama_id INTEGER, site_code TEXT, uc TEXT NOT NULL, govde JSONB, neden TEXT,
  bildiren_email TEXT, bildiren_ad TEXT, kanal TEXT, istek_anahtari TEXT, durum TEXT NOT NULL DEFAULT 'BEKLIYOR', karar_veren TEXT, karar_zamani TIMESTAMPTZ, karar_notu TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS is_bildirim_inceleme_durum_idx ON is_bildirim_inceleme (durum, created_at);
ALTER TABLE is_atama ADD COLUMN IF NOT EXISTS iptal_nedeni TEXT, ADD COLUMN IF NOT EXISTS devir_hedef_atama_id INTEGER, ADD COLUMN IF NOT EXISTS devir_kaynak_atama_id INTEGER,
  ADD COLUMN IF NOT EXISTS plan_surum INTEGER NOT NULL DEFAULT 1;
ALTER TABLE is_atama_istek ENABLE ROW LEVEL SECURITY;
ALTER TABLE is_bildirim_inceleme ENABLE ROW LEVEL SECURITY;
COMMIT;
-- Kontrol: SELECT column_name FROM information_schema.columns WHERE table_name='is_atama' AND column_name IN ('iptal_nedeni','devir_hedef_atama_id','devir_kaynak_atama_id','plan_surum');
-- Geri dönüş (veri kaybı yok — kolonlar boş kalır): önceki backend sürümüne dönün. Tabloları kaldırmak (yalnız test sonrası):
-- BEGIN; DROP TABLE IF EXISTS is_bildirim_inceleme, is_atama_istek; ALTER TABLE is_atama DROP COLUMN IF EXISTS iptal_nedeni, DROP COLUMN IF EXISTS devir_hedef_atama_id,
--   DROP COLUMN IF EXISTS devir_kaynak_atama_id, DROP COLUMN IF EXISTS plan_surum; COMMIT;
