-- ═══ Fatura saha / kalem satırları + Akıllı Kontrol durumu (23.10.2026, Orhan) ═══
-- CANLIYA OTOMATİK UYGULANMAZ. Supabase SQL Editor'de Orhan'ın onayıyla bir kez çalıştırılır.
-- Uygulanana kadar: tek Site ID (invoice_entries.site_id) ve mevcut fatura akışları aynen çalışır;
-- saha/kalem satırı kaydı "veritabanı güncellemesi bekleniyor" yanıtı verir.
-- Geri alma: en alttaki DROP komutları (yalnız bu iki tabloyu siler; invoice_entries'e dokunmaz).

BEGIN;

-- Bir faturanın hangi sahaya / hangi kaleme ait olduğu. Bir fatura birden çok saha ve kalem taşıyabilir.
--   miktar / birim NULL  → "belirtilmemiş" (fatura toplamından tahmin EDİLMEZ)
--   tutar NULL           → bu satıra tutar dağıtılmamış (çok sahalı faturada saha maliyetine eklenmez, çift sayılmaz)
--   tutar                → KDV hariç, faturanın para biriminde; satır tutarları toplamı fatura tutarını aşamaz (uygulama kontrol eder)
CREATE TABLE IF NOT EXISTS fatura_saha_kalem (
  id          SERIAL PRIMARY KEY,
  fatura_id   INTEGER NOT NULL REFERENCES invoice_entries(id) ON DELETE CASCADE,
  site_code   TEXT    NOT NULL,
  kalem_adi   TEXT    NOT NULL,
  kategori    TEXT,
  miktar      NUMERIC CHECK (miktar IS NULL OR miktar > 0),
  birim       TEXT,
  tutar       NUMERIC CHECK (tutar IS NULL OR tutar >= 0),
  aciklama    TEXT,
  olusturan   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fatura_saha_kalem_site_idx   ON fatura_saha_kalem (UPPER(TRIM(site_code)));
CREATE INDEX IF NOT EXISTS fatura_saha_kalem_fatura_idx ON fatura_saha_kalem (fatura_id);

-- Akıllı Kontrol uyarısının kullanıcı tarafından işaretlenen durumu.
--   kaynak = 'kalem' (fatura_saha_kalem.id) | 'fatura' (satırı olmayan, yalnız site_id'li fatura → invoice_entries.id)
--   kaynak_imza: işaretlendiği andaki kaynak kaydın özeti; kaynak değişince uyarı "yeniden değerlendirilmeli" olur
CREATE TABLE IF NOT EXISTS akilli_kontrol_durum (
  id          SERIAL PRIMARY KEY,
  kaynak      TEXT    NOT NULL CHECK (kaynak IN ('kalem', 'fatura')),
  kaynak_id   INTEGER NOT NULL,
  site_code   TEXT    NOT NULL,
  durum       TEXT    NOT NULL CHECK (durum IN ('KONTROL_EDILDI', 'ILGILI_DEGIL', 'PR_TALEBI_OLUSTURULDU')),
  kaynak_imza TEXT    NOT NULL,
  aciklama    TEXT,
  kullanici   TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (kaynak, kaynak_id, site_code)
);
CREATE INDEX IF NOT EXISTS akilli_kontrol_durum_site_idx ON akilli_kontrol_durum (UPPER(TRIM(site_code)));

COMMIT;

-- Geri alma (gerekirse):
-- BEGIN; DROP TABLE IF EXISTS akilli_kontrol_durum; DROP TABLE IF EXISTS fatura_saha_kalem; COMMIT;
