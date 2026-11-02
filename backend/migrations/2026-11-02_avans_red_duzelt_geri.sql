-- GERİ DÖNÜŞ: 2026-11-02_avans_red_duzelt.sql (02.11.2026). Yalnız eklenen yapılar kaldırılır; is_avans_talep'in mevcut
-- kolonları ve verisi DEĞİŞMEZ. Uyarı: is_avans_tur tablosundaki gönderim / red geçmişi silinir — önce yedek alın:
--   pg_dump -t is_avans_tur ...   (ya da COPY (SELECT * FROM is_avans_tur) TO STDOUT WITH CSV HEADER)
-- Yeniden gönderilmiş talepler (aktif_tur_no > 1) ana satırda kalır; sütun düşünce "kaçıncı gönderim" bilgisi kaybolur,
-- islem_gecmisi'ndeki YENIDEN_GONDERIM / RED kayıtları (tur_no alanıyla) yerinde kalır. Eski sürüm sunucu bu kolonları okumaz.
BEGIN;
DROP INDEX IF EXISTS is_avans_tur_istek_idx;
DROP INDEX IF EXISTS is_avans_tur_acik_idx;
DROP TABLE IF EXISTS is_avans_tur;
ALTER TABLE is_avans_talep DROP COLUMN IF EXISTS reddeden_user_id, DROP COLUMN IF EXISTS red_zamani, DROP COLUMN IF EXISTS red_asama,
  DROP COLUMN IF EXISTS surum, DROP COLUMN IF EXISTS aktif_tur_no;
COMMIT;
