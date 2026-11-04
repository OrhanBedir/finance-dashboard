-- GERİ DÖNÜŞ: 2026-11-04_taseron_saha.sql
-- DİKKAT: saha bildirimleri ve fotoğraf referansları silinir. Çalıştırmadan önce yedek alın:
--   CREATE TABLE yedek_taseron_saha_bildirim_YYYYMMDD AS SELECT * FROM taseron_saha_bildirim;
--   CREATE TABLE yedek_taseron_saha_bildirim_surum_YYYYMMDD AS SELECT * FROM taseron_saha_bildirim_surum;
--   CREATE TABLE yedek_taseron_saha_uye_YYYYMMDD AS SELECT * FROM taseron_saha_uye;
-- Rollout tarihleri, is_atama ve is_fiili_bildirim kayıtları bu tablolara bağlı değildir; geri dönüşte DEĞİŞMEZ
-- (montaj başlangıç/bitiş tarihleri Rollout'ta kalır — gerekirse Rollout ekranından yetkili düzeltir).
-- Sunucu açılışta tabloları yeniden oluşturur: kalıcı geri dönüş için önce taseronSaha modülünü devreden çıkarın.
BEGIN;
DROP TABLE IF EXISTS taseron_saha_bildirim_surum;
DROP TABLE IF EXISTS taseron_saha_bildirim;
DROP TABLE IF EXISTS taseron_saha_uye;
COMMIT;
