-- MALZEME STOK DEFTERİ (29.10.2026) — şema. UYGULANMADI: canlıda yalnız Orhan'ın açık onayıyla.
-- Not: Aynı ifadeler backend açılışında (malzemeStok.semaKur) "IF NOT EXISTS" ile çalışır; yani yeni backend'in yayına alınması
-- bu tabloları BOŞ olarak oluşturur. Bu dosya elle uygulamak / incelemek / geri almak içindir.
-- Yalnız EKLEME yapar: mevcut tablolarda tek değişiklik malzeme_talep_kalemleri.urun_id (boş, NULL) kolonudur.
-- Eski kayıtlar (depo_stok, sarf_kullanim, malzeme_dagitim) DEĞİŞTİRİLMEZ, DÖNÜŞTÜRÜLMEZ; stok açılış sayımıyla başlar.
--
-- ═══ 1) ŞEMA ═══
BEGIN;
CREATE TABLE IF NOT EXISTS malzeme_urun (
  id SERIAL PRIMARY KEY, kod TEXT NOT NULL, ad TEXT NOT NULL, temel_birim TEXT NOT NULL,
  tam_sayi BOOLEAN NOT NULL DEFAULT false, tur TEXT NOT NULL DEFAULT 'SARF' CHECK (tur IN ('SARF','EKIPMAN')),
  kategori TEXT, min_stok NUMERIC(14,3) CHECK (min_stok IS NULL OR min_stok >= 0), aktif BOOLEAN NOT NULL DEFAULT true,
  eski_adlar TEXT[] NOT NULL DEFAULT '{}', fiyat_listesi_id INTEGER, aciklama TEXT, olusturan TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS malzeme_urun_kod_uq ON malzeme_urun (UPPER(kod));
CREATE UNIQUE INDEX IF NOT EXISTS malzeme_urun_ad_uq ON malzeme_urun (UPPER(ad));
CREATE TABLE IF NOT EXISTS malzeme_urun_birim (
  id SERIAL PRIMARY KEY, urun_id INTEGER NOT NULL REFERENCES malzeme_urun(id), birim TEXT NOT NULL,
  katsayi NUMERIC(14,6) NOT NULL CHECK (katsayi > 0), olusturan TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS malzeme_urun_birim_uq ON malzeme_urun_birim (urun_id, LOWER(birim));
CREATE TABLE IF NOT EXISTS malzeme_depo (
  id SERIAL PRIMARY KEY, kod TEXT NOT NULL, ad TEXT NOT NULL, firma TEXT NOT NULL DEFAULT 'ERC', aktif BOOLEAN NOT NULL DEFAULT true,
  acilis_id INTEGER, acilis_tarihi DATE, olusturan TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS malzeme_depo_kod_uq ON malzeme_depo (UPPER(kod));
CREATE TABLE IF NOT EXISTS malzeme_hareket (
  id BIGSERIAL PRIMARY KEY,
  tur TEXT NOT NULL CHECK (tur IN ('ACILIS','GIRIS','TESLIM','TUKETIM','IADE_TALEP','IADE_ONAY','IADE_RED','IADE_IPTAL',
    'REZERVE','REZERV_TESLIM','REZERV_IPTAL','SAYIM_DUZELTME','TERS')),
  urun_id INTEGER NOT NULL REFERENCES malzeme_urun(id),
  miktar NUMERIC(14,3) NOT NULL CHECK (miktar > 0),
  girilen_miktar NUMERIC(14,3), girilen_birim TEXT,
  kaynak_tip TEXT NOT NULL, kaynak_id TEXT, hedef_tip TEXT NOT NULL, hedef_id TEXT,
  depo_id INTEGER, personel_id INTEGER, saha_kodu TEXT, firma TEXT,
  islem_tarihi DATE NOT NULL DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  islem_yapan_user_id INTEGER, islem_yapan_email TEXT, islem_yapan_ad TEXT,
  aciklama TEXT, belge_tip TEXT, belge_id TEXT, belge_no TEXT,
  iade_id INTEGER, rezervasyon_id INTEGER, acilis_id INTEGER, talep_id INTEGER, talep_kalem_id INTEGER,
  ters_edilen_id BIGINT, ters_hareket_id BIGINT, birim_fiyat NUMERIC(14,4), istek_anahtari TEXT);
CREATE INDEX IF NOT EXISTS malzeme_hareket_urun_id_idx ON malzeme_hareket (urun_id);
CREATE INDEX IF NOT EXISTS malzeme_hareket_personel_id_idx ON malzeme_hareket (personel_id);
CREATE INDEX IF NOT EXISTS malzeme_hareket_saha_kodu_idx ON malzeme_hareket (saha_kodu);
CREATE INDEX IF NOT EXISTS malzeme_hareket_depo_id_idx ON malzeme_hareket (depo_id);
CREATE INDEX IF NOT EXISTS malzeme_hareket_islem_tarihi_idx ON malzeme_hareket (islem_tarihi);
CREATE INDEX IF NOT EXISTS malzeme_hareket_talep_kalem_id_idx ON malzeme_hareket (talep_kalem_id);
CREATE INDEX IF NOT EXISTS malzeme_hareket_tur_idx ON malzeme_hareket (tur);
CREATE UNIQUE INDEX IF NOT EXISTS malzeme_hareket_ters_uq ON malzeme_hareket (ters_edilen_id) WHERE ters_edilen_id IS NOT NULL;
CREATE OR REPLACE FUNCTION malzeme_hareket_koru() RETURNS trigger LANGUAGE plpgsql AS $f$
  BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'malzeme_hareket kayıtları silinemez (ters kayıt kullanın)'; END IF;
    IF OLD.ters_hareket_id IS NULL AND NEW.ters_hareket_id IS NOT NULL
       AND (to_jsonb(NEW) - 'ters_hareket_id') = (to_jsonb(OLD) - 'ters_hareket_id') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'malzeme_hareket kayıtları değiştirilemez (ters kayıt kullanın)';
  END $f$;
DROP TRIGGER IF EXISTS malzeme_hareket_koru_trg ON malzeme_hareket;
CREATE TRIGGER malzeme_hareket_koru_trg BEFORE UPDATE OR DELETE ON malzeme_hareket FOR EACH ROW EXECUTE FUNCTION malzeme_hareket_koru();
CREATE TABLE IF NOT EXISTS malzeme_bakiye (
  lok_tip TEXT NOT NULL, lok_id TEXT NOT NULL, urun_id INTEGER NOT NULL REFERENCES malzeme_urun(id),
  miktar NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (miktar >= 0), updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (lok_tip, lok_id, urun_id));
CREATE TABLE IF NOT EXISTS malzeme_iade (
  id SERIAL PRIMARY KEY, personel_id INTEGER NOT NULL, urun_id INTEGER NOT NULL REFERENCES malzeme_urun(id),
  miktar NUMERIC(14,3) NOT NULL CHECK (miktar > 0), depo_id INTEGER, firma TEXT,
  durum TEXT NOT NULL DEFAULT 'BEKLIYOR' CHECK (durum IN ('BEKLIYOR','ONAYLANDI','REDDEDILDI','IPTAL')),
  talep_aciklama TEXT, talep_eden_email TEXT, talep_tarihi TIMESTAMPTZ DEFAULT now(),
  karar_veren_email TEXT, karar_veren_ad TEXT, karar_tarihi TIMESTAMPTZ, karar_aciklama TEXT,
  talep_hareket_id BIGINT, karar_hareket_id BIGINT, kaynak TEXT);
CREATE INDEX IF NOT EXISTS malzeme_iade_durum_idx ON malzeme_iade (durum, personel_id);
CREATE TABLE IF NOT EXISTS malzeme_rezervasyon (
  id SERIAL PRIMARY KEY, depo_id INTEGER NOT NULL, urun_id INTEGER NOT NULL REFERENCES malzeme_urun(id),
  miktar NUMERIC(14,3) NOT NULL CHECK (miktar > 0), personel_id INTEGER, talep_id INTEGER, talep_kalem_id INTEGER,
  durum TEXT NOT NULL DEFAULT 'ACIK' CHECK (durum IN ('ACIK','KAPANDI','IPTAL')), aciklama TEXT, olusturan TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), kapanis_tarihi TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS malzeme_istek (
  kullanici TEXT NOT NULL, anahtar TEXT NOT NULL, uc TEXT NOT NULL, govde_ozet TEXT NOT NULL, sonuc JSONB,
  created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (kullanici, anahtar));
CREATE TABLE IF NOT EXISTS malzeme_acilis (
  id SERIAL PRIMARY KEY, depo_id INTEGER NOT NULL, sayim_tarihi DATE NOT NULL,
  durum TEXT NOT NULL DEFAULT 'TASLAK' CHECK (durum IN ('TASLAK','UYGULANDI','IPTAL')),
  aciklama TEXT, kaynak_dosya TEXT, satir_sayisi INTEGER, hata_sayisi INTEGER, icerik_ozet TEXT,
  olusturan_email TEXT, olusturma TIMESTAMPTZ DEFAULT now(), onaylayan_email TEXT, onay_tarihi TIMESTAMPTZ, iptal_aciklama TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS malzeme_acilis_depo_uq ON malzeme_acilis (depo_id) WHERE durum = 'UYGULANDI';
CREATE TABLE IF NOT EXISTS malzeme_acilis_satir (
  id SERIAL PRIMARY KEY, acilis_id INTEGER NOT NULL REFERENCES malzeme_acilis(id), satir_no INTEGER NOT NULL, ham JSONB,
  urun_id INTEGER, lok_tip TEXT, personel_id INTEGER, girilen_miktar NUMERIC(14,3), girilen_birim TEXT, miktar NUMERIC(14,3), hata TEXT);
ALTER TABLE malzeme_talep_kalemleri ADD COLUMN IF NOT EXISTS urun_id INTEGER;
ALTER TABLE malzeme_urun ENABLE ROW LEVEL SECURITY;
ALTER TABLE malzeme_urun_birim ENABLE ROW LEVEL SECURITY;
ALTER TABLE malzeme_depo ENABLE ROW LEVEL SECURITY;
ALTER TABLE malzeme_hareket ENABLE ROW LEVEL SECURITY;
ALTER TABLE malzeme_bakiye ENABLE ROW LEVEL SECURITY;
ALTER TABLE malzeme_iade ENABLE ROW LEVEL SECURITY;
ALTER TABLE malzeme_rezervasyon ENABLE ROW LEVEL SECURITY;
ALTER TABLE malzeme_istek ENABLE ROW LEVEL SECURITY;
ALTER TABLE malzeme_acilis ENABLE ROW LEVEL SECURITY;
ALTER TABLE malzeme_acilis_satir ENABLE ROW LEVEL SECURITY;COMMIT;

-- ═══ 2) KONTROL ═══
-- SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'malzeme_%' ORDER BY 1;
-- SELECT tgname FROM pg_trigger WHERE tgname = 'malzeme_hareket_koru_trg';
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'malzeme_%' AND relkind = 'r';
-- Ön kontrol / uzlaştırma (salt-okunur): node backend/scripts/malzeme_on_kontrol.js rapor.xlsx

-- ═══ 3) GERİ DÖNÜŞ ═══
-- A) Yazılımı geri almak (önerilen, veri kaybı yok): önceki backend sürümüne dönün. Yeni tablolar kalır, eski kod onları
--    okumaz. DİKKAT: eski kod eski hatalarıyla (çift düşüm, iade onay hatası) geri gelir; açılıştan sonra yapılan teslim /
--    tüketim / iade hareketleri eski ekranlarda GÖRÜNMEZ — geri dönüş kararı verilirse o anın Excel dökümünü alın
--    (Stok Defteri › Excel) ve depo sayımını eski ekrana elle işleyin.
-- B) Açılışı geri almak (hareket başlamadan, yalnız açılış yanlışsa): açılış hareketleri silinmez; yönetici her ACILIS
--    hareketi için ters kayıt yapar (Stok Defteri › Hareketler › Ters kayıt) ya da tablolar tamamen kaldırılır (C).
-- C) Tabloları tamamen kaldırmak (yalnız hiç gerçek hareket yokken / test sonrası; geri alınamaz — önce yedek alın):
-- BEGIN;
-- DROP TRIGGER IF EXISTS malzeme_hareket_koru_trg ON malzeme_hareket;
-- DROP FUNCTION IF EXISTS malzeme_hareket_koru();
-- DROP TABLE IF EXISTS malzeme_acilis_satir, malzeme_acilis, malzeme_istek, malzeme_rezervasyon, malzeme_iade,
--   malzeme_bakiye, malzeme_hareket, malzeme_depo, malzeme_urun_birim, malzeme_urun;
-- ALTER TABLE malzeme_talep_kalemleri DROP COLUMN IF EXISTS urun_id;
-- COMMIT;
