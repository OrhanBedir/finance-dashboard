-- GERİ DÖNÜŞ: 2026-11-05_arac_operasyon.sql
-- DİKKAT: onaylı tüketim referansları, yakıt fiyatları ve malzeme hareketlerindeki araç bağlantıları kaybolur.
-- Çalıştırmadan önce yedek alın:
--   CREATE TABLE yedek_arac_tuketim_referans_YYYYMMDD AS SELECT * FROM arac_tuketim_referans;
--   CREATE TABLE yedek_yakit_fiyat_referans_YYYYMMDD AS SELECT * FROM yakit_fiyat_referans;
--   CREATE TABLE yedek_hw_malzeme_arac_YYYYMMDD AS SELECT id, arac_plaka, arac_id FROM hw_malzeme_islem WHERE arac_plaka IS NOT NULL;
-- Malzeme hareketleri, miktarlar, iş avansları, iş atamaları ve plan tarihleri bu geri dönüşten ETKİLENMEZ (yalnız araç kolonları düşer).
-- Uygulama bu tablolar / kolonlar yokken çökmez: yakıt analizi "kurulum bekliyor", malzeme ekranı "araç bağlantısı yok" der.
BEGIN;
-- Koruma fonksiyonunu araç kolonlarını anmayan önceki haline döndür (kolon düşmeden önce)
CREATE OR REPLACE FUNCTION hw_malzeme_islem_koru() RETURNS trigger LANGUAGE plpgsql AS $f$
  BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'hw_malzeme_islem kayıtları silinemez (ters kayıt kullanın)'; END IF;
    IF NEW.id <> OLD.id OR NEW.tur <> OLD.tur OR NEW.site_code <> OLD.site_code OR NEW.kaynak_tip <> OLD.kaynak_tip
       OR NEW.kaynak_id IS DISTINCT FROM OLD.kaynak_id OR NEW.hedef_tip <> OLD.hedef_tip OR NEW.hedef_id IS DISTINCT FROM OLD.hedef_id
       OR NEW.kapsam <> OLD.kapsam OR NEW.ters_edilen_id IS DISTINCT FROM OLD.ters_edilen_id OR NEW.created_at <> OLD.created_at
       OR (OLD.ters_islem_id IS NOT NULL AND NEW.ters_islem_id IS DISTINCT FROM OLD.ters_islem_id) THEN
      RAISE EXCEPTION 'hw_malzeme_islem: miktar / lokasyon / tür değiştirilemez (ters kayıt kullanın)';
    END IF;
    RETURN NEW;
  END $f$;
DROP INDEX IF EXISTS hw_malzeme_islem_arac_idx;
ALTER TABLE hw_malzeme_islem DROP COLUMN IF EXISTS arac_id;
ALTER TABLE hw_malzeme_islem DROP COLUMN IF EXISTS arac_plaka;
DROP TABLE IF EXISTS yakit_fiyat_referans;
DROP TABLE IF EXISTS arac_tuketim_referans;
COMMIT;
