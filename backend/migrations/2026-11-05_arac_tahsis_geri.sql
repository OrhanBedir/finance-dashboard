-- GERİ DÖNÜŞ: 2026-11-05_arac_tahsis.sql
-- DİKKAT: girilen tarihli araç tahsisleri kaybolur. Önce yedek alın:
--   CREATE TABLE yedek_arac_tahsis_YYYYMMDD AS SELECT * FROM arac_tahsis;
-- İş atamaları, plaka alanları, plan segmentleri, malzeme ve yakıt kayıtları ETKİLENMEZ (bu tablo yalnız okuma anında kullanılır).
BEGIN;
DROP TABLE IF EXISTS arac_tahsis;
COMMIT;
