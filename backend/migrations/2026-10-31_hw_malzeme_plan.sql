-- HW MALZEME + FİİLÎ ÇALIŞMA + OPERASYON (31.10.2026) — şema. UYGULANMADI: canlıda yalnız Orhan'ın açık onayıyla.
-- Not: Aynı ifadeler backend açılışında (hwMalzeme.semaKur, fiiliDurum.semaKur) "IF NOT EXISTS" ile çalışır; yani yeni
-- backend yayına alınınca bu tablolar BOŞ olarak kendiliğinden oluşur. Bu dosya elle uygulamak / incelemek / geri almak içindir.
-- Yalnız EKLEME yapar: mevcut tablolarda hiçbir kolon değişmez, hiçbir kayıt silinmez / dönüştürülmez.
-- Rollout'taki eski malzeme_gelis_tarihi / malzeme_status değerleri DEĞİŞMEZ; yeni kabul kaydı girildikçe o işin değeri güncellenir
-- (önceki değer hw_malzeme_rollout_yansima'da saklanır — geri alınabilir).
--
-- ═══ 1) ŞEMA ═══
BEGIN;
CREATE TABLE IF NOT EXISTS hw_malzeme_islem (
  id BIGSERIAL PRIMARY KEY, tur TEXT NOT NULL CHECK (tur IN ('KABUL','EKIBE_TESLIM','DEVIR','DEPOYA_DONUS','KULLANIM','IADE','TERS')),
  site_code TEXT NOT NULL, fiziksel_id TEXT, kapsam TEXT NOT NULL DEFAULT 'RF' CHECK (kapsam IN ('RF','ENH')),
  kaynak_tip TEXT NOT NULL, kaynak_id TEXT, hedef_tip TEXT NOT NULL, hedef_id TEXT,
  islem_tarihi DATE NOT NULL DEFAULT CURRENT_DATE, teslim_tipi TEXT CHECK (teslim_tipi IS NULL OR teslim_tipi IN ('KISMI','TAM')),
  eksik_aciklama TEXT, aciklama TEXT, belgeler JSONB NOT NULL DEFAULT '[]', eski_kayit_teyidi BOOLEAN NOT NULL DEFAULT false,
  ters_edilen_id BIGINT, ters_islem_id BIGINT, duzeltilen_islem_id BIGINT, gerekce TEXT,
  kaydeden_user_id INTEGER, kaydeden_email TEXT, kaydeden_ad TEXT, kanal TEXT, istek_anahtari TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS hw_malzeme_islem_site_idx ON hw_malzeme_islem (site_code);
CREATE INDEX IF NOT EXISTS hw_malzeme_islem_fiz_idx ON hw_malzeme_islem (fiziksel_id);
CREATE UNIQUE INDEX IF NOT EXISTS hw_malzeme_islem_ters_uq ON hw_malzeme_islem (ters_edilen_id) WHERE ters_edilen_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS hw_malzeme_islem_kalem (
  id BIGSERIAL PRIMARY KEY, islem_id BIGINT NOT NULL REFERENCES hw_malzeme_islem(id), anahtar TEXT NOT NULL,
  ad TEXT NOT NULL, kod TEXT, birim TEXT NOT NULL DEFAULT 'Adet', miktar NUMERIC(14,3) NOT NULL CHECK (miktar > 0));
CREATE INDEX IF NOT EXISTS hw_malzeme_islem_kalem_islem_idx ON hw_malzeme_islem_kalem (islem_id);
CREATE TABLE IF NOT EXISTS hw_malzeme_gecmis (
  id BIGSERIAL PRIMARY KEY, islem_id BIGINT NOT NULL, alan TEXT NOT NULL, eski JSONB, yeni JSONB, gerekce TEXT,
  yapan_email TEXT, yapan_ad TEXT, zaman TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS hw_malzeme_gecmis_islem_idx ON hw_malzeme_gecmis (islem_id);
CREATE TABLE IF NOT EXISTS hw_malzeme_istek (
  kullanici TEXT NOT NULL, anahtar TEXT NOT NULL, uc TEXT NOT NULL, govde_ozet TEXT NOT NULL, sonuc JSONB,
  created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (kullanici, anahtar));
CREATE TABLE IF NOT EXISTS hw_malzeme_rollout_yansima (
  site_code TEXT NOT NULL, kapsam TEXT NOT NULL, ilk_gelis_onceki DATE, status_onceki TEXT,
  yazilan_gelis DATE, yazilan_status TEXT, celiski TEXT, updated_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (site_code, kapsam));
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
DROP TRIGGER IF EXISTS hw_malzeme_islem_koru_trg ON hw_malzeme_islem;
CREATE TRIGGER hw_malzeme_islem_koru_trg BEFORE UPDATE OR DELETE ON hw_malzeme_islem FOR EACH ROW EXECUTE FUNCTION hw_malzeme_islem_koru();
CREATE OR REPLACE FUNCTION hw_malzeme_kalem_koru() RETURNS trigger LANGUAGE plpgsql AS $f$
  BEGIN RAISE EXCEPTION 'hw_malzeme_islem_kalem kayıtları değiştirilemez / silinemez (ters kayıt kullanın)'; END $f$;
DROP TRIGGER IF EXISTS hw_malzeme_kalem_koru_trg ON hw_malzeme_islem_kalem;
CREATE TRIGGER hw_malzeme_kalem_koru_trg BEFORE UPDATE OR DELETE ON hw_malzeme_islem_kalem FOR EACH ROW EXECUTE FUNCTION hw_malzeme_kalem_koru();
-- Fiilî çalışma bildirimi (QC'den bağımsız; mevcut is_atama başla / bitir / ara-ver akışı da buraya olay yazar)
CREATE TABLE IF NOT EXISTS is_fiili_bildirim (
  id BIGSERIAL PRIMARY KEY, is_atama_id INTEGER, site_code TEXT NOT NULL, olay TEXT NOT NULL CHECK (olay IN ('BASLADI','TAMAMLANDI','ISSUE','ISSUE_KAPANDI','GERI_AL')),
  issue_turu TEXT, aciklama TEXT, ekip_no INTEGER, bildiren_email TEXT, bildiren_ad TEXT, kanal TEXT, istek_anahtari TEXT,
  zaman TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS is_fiili_bildirim_site_idx ON is_fiili_bildirim (site_code, zaman);
CREATE INDEX IF NOT EXISTS is_fiili_bildirim_ekip_idx ON is_fiili_bildirim (ekip_no, zaman);
CREATE UNIQUE INDEX IF NOT EXISTS is_fiili_bildirim_istek_uq ON is_fiili_bildirim (bildiren_email, istek_anahtari) WHERE istek_anahtari IS NOT NULL;
ALTER TABLE hw_malzeme_islem ENABLE ROW LEVEL SECURITY;
ALTER TABLE hw_malzeme_islem_kalem ENABLE ROW LEVEL SECURITY;
ALTER TABLE hw_malzeme_gecmis ENABLE ROW LEVEL SECURITY;
ALTER TABLE hw_malzeme_istek ENABLE ROW LEVEL SECURITY;
ALTER TABLE hw_malzeme_rollout_yansima ENABLE ROW LEVEL SECURITY;
ALTER TABLE is_fiili_bildirim ENABLE ROW LEVEL SECURITY;
COMMIT;

-- ═══ 2) YETKİ (ayrı onay — canlı users.id teyidi gerekir) ═══
-- Emre (envanter sorumlusu): HW malzeme kabul + depo hareketi + operasyon görüntüleme (web + mobil aynı izin).
-- ÖNCE canlıda doğrula: SELECT id, email, role, yetki_ayar FROM users WHERE email ILIKE 'emre.akdegirmen@%';   -- [XXX] id teyit edilmedi
-- UPDATE users SET yetki_ayar = COALESCE(yetki_ayar,'{}'::jsonb) || '{"hw_malzeme_goruntule": true, "hw_malzeme_hareket": true, "operasyon_goruntule": true}'::jsonb
--   WHERE id = [XXX] AND LOWER(email) = 'emre.akdegirmen@simsektel.com';
-- Nurcan Kuş (users.id 2) ve Serdar Altınova (3): rollout_mudur rolü operasyon ekranlarını ve plan yapmayı zaten açar (İş Ata rolü);
--   ek ayar gerekmez. Hatice Omuş (rollout_mudur) aynı. İlhami Şahin (1694) / teknocenter (1285): direktor / admin rolü +
--   rollout_goruntule ile kendi Teknocenter kapsamında görür; HW malzeme hareketi KAPALI (alt markaya açılmaz).
-- Orhan (5, 121), Düzgün (6): admin — tümü açık.

-- ═══ 3) KONTROL ═══
-- SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'hw_malzeme_%' OR table_name = 'is_fiili_bildirim' ORDER BY 1;
-- SELECT tgname FROM pg_trigger WHERE tgname LIKE 'hw_malzeme_%';

-- ═══ 4) GERİ DÖNÜŞ ═══
-- A) Yazılımı geri almak (önerilen, veri kaybı yok): önceki backend sürümüne dönün. Yeni tablolar kalır, eski kod onları okumaz.
--    Rollout'a yazılan malzeme_gelis_tarihi / malzeme_status değerlerini eski haline almak için:
--    UPDATE rollout_progress r SET malzeme_gelis_tarihi = y.ilk_gelis_onceki, malzeme_status = y.status_onceki, updated_at = now()
--      FROM hw_malzeme_rollout_yansima y WHERE y.kapsam = 'RF' AND UPPER(TRIM(r.site_code)) = y.site_code;
--    UPDATE rollout_progress r SET enh_malzeme_gelis_tarihi = y.ilk_gelis_onceki FROM hw_malzeme_rollout_yansima y WHERE y.kapsam = 'ENH' AND UPPER(TRIM(r.site_code)) = y.site_code;
-- B) Tabloları tamamen kaldırmak (yalnız hiç gerçek kayıt yokken / test sonrası; geri alınamaz — önce yedek alın):
-- BEGIN;
-- DROP TRIGGER IF EXISTS hw_malzeme_islem_koru_trg ON hw_malzeme_islem; DROP TRIGGER IF EXISTS hw_malzeme_kalem_koru_trg ON hw_malzeme_islem_kalem;
-- DROP FUNCTION IF EXISTS hw_malzeme_islem_koru(); DROP FUNCTION IF EXISTS hw_malzeme_kalem_koru();
-- DROP TABLE IF EXISTS hw_malzeme_gecmis, hw_malzeme_istek, hw_malzeme_rollout_yansima, hw_malzeme_islem_kalem, hw_malzeme_islem, is_fiili_bildirim;
-- COMMIT;
