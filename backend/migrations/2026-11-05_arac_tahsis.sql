-- TARİHLİ ARAÇ TAHSİSİ (05.11.2026, Orhan) — "X kişisi / ekibi bu aracı hangi tarihler arasında kullanıyor?"
-- YALNIZ EKLEME: mevcut tablo / veri değişmez. Sunucu açılışta bu DDL'i ÇALIŞTIRMAZ; tablo yoksa araç paneli tahsis formunu
-- "kurulum bekliyor" diye kapatır ve yalnız atamadaki plaka (A) ile aday bağları (C) kullanır.
-- Geri dönüş: 2026-11-05_arac_tahsis_geri.sql
-- Kayıtlar silinmez; yanlış kayıt iptal edilir (iptal, gerekçe, kim, ne zaman). Geçmiş atamalar / plakalar bu tablodan DOLDURULMAZ;
-- araç paneli bağlantıyı okuma anında çözer (aracIliski.iliskiCoz).
BEGIN;
CREATE TABLE IF NOT EXISTS arac_tahsis (
  id             BIGSERIAL PRIMARY KEY,
  arac_id        INTEGER NOT NULL,
  plaka          TEXT NOT NULL,
  personel_id    INTEGER,                 -- kişi → araç (kalıcı personel kimliği)
  ekip_no        INTEGER,                 -- ya da ekip → araç
  bas            DATE NOT NULL,           -- Türkiye günü, dahil
  bit            DATE,                    -- boş = devam ediyor
  aciklama       TEXT,
  kaynak         TEXT NOT NULL DEFAULT 'MANUEL',
  giren_email    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  iptal          BOOLEAN NOT NULL DEFAULT false,
  iptal_gerekce  TEXT,
  iptal_eden     TEXT,
  iptal_zamani   TIMESTAMPTZ,
  CHECK (personel_id IS NOT NULL OR ekip_no IS NOT NULL),
  CHECK (bit IS NULL OR bit >= bas)
);
CREATE INDEX IF NOT EXISTS arac_tahsis_arac_idx ON arac_tahsis (arac_id, bas);
CREATE INDEX IF NOT EXISTS arac_tahsis_personel_idx ON arac_tahsis (personel_id) WHERE personel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS arac_tahsis_ekip_idx ON arac_tahsis (ekip_no) WHERE ekip_no IS NOT NULL;
ALTER TABLE arac_tahsis ENABLE ROW LEVEL SECURITY;
COMMIT;
