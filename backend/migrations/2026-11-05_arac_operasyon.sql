-- ARAÇ VE EKİP OPERASYON MERKEZİ (05.11.2026, Orhan) — yakıt analizi referansları + malzeme teslim / devirinde araç bağlantısı
-- YALNIZ EKLEME: mevcut tablo / kolon / veri değiştirilmez, silinmez. Sunucu açılışta bu DDL'i ÇALIŞTIRMAZ (bilinçli): uygulama
-- tablo yoksa "kurulum bekliyor" der, çökmez. Canlıya yalnız Orhan'ın açık onayıyla uygulanır.
-- Geri dönüş: 2026-11-05_arac_operasyon_geri.sql
BEGIN;

-- 1) Resmî tüketim referansı (araç başına). Yapay zekâ önerisi ONERI olarak gelir; yetkili kullanıcı onaylayınca ONAYLI olur.
--    Yalnız ONAYLI kayıt yakıt analizinde kullanılır; her analiz açılışında internet araştırması yapılmaz.
--    Eski model araca güncel modelin tüketimi uygulanmaz: model_yili / motor / yakıt türü / şanzıman / versiyon zorunlu.
CREATE TABLE IF NOT EXISTS arac_tuketim_referans (
  id                 BIGSERIAL PRIMARY KEY,
  arac_id            INTEGER NOT NULL,
  plaka              TEXT NOT NULL,
  marka              TEXT,
  model              TEXT,
  model_yili         INTEGER,
  motor              TEXT,              -- hacim / güç (ör. 2.2 BlueHDi 140 hp)
  yakit_turu         TEXT,              -- DIZEL | BENZIN | LPG | ELEKTRIK | HIBRIT
  sanziman           TEXT,              -- MANUEL | OTOMATIK
  govde_versiyon     TEXT,              -- gövde / donanım versiyonu (ör. L3H2 Panelvan)
  l100               NUMERIC(6,2),      -- resmî karma tüketim L/100 km
  olcum_standardi    TEXT CHECK (olcum_standardi IS NULL OR olcum_standardi IN ('WLTP','NEDC')),
  eslesen_versiyon   TEXT,              -- belgede eşleşen versiyon adı (kelimesi kelimesine)
  kaynak_url         TEXT,              -- üreticinin resmî sitesi / resmî teknik belge
  belge_tarihi       DATE,
  guven              TEXT CHECK (guven IS NULL OR guven IN ('YUKSEK','ORTA','DUSUK')),
  durum              TEXT NOT NULL DEFAULT 'ONERI' CHECK (durum IN ('ONERI','ONAYLI','IPTAL','REDDEDILDI')),
  oneri_kaynagi      TEXT NOT NULL DEFAULT 'MANUEL' CHECK (oneri_kaynagi IN ('MANUEL','YAPAY_ZEKA')),
  oneri_ham          JSONB,             -- yapay zekâ yanıtının kendisi (denetim için)
  oneren_email       TEXT,
  dogrulama_tarihi   TIMESTAMPTZ,
  dogrulayan_email   TEXT,
  iptal_gerekce      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS arac_tuketim_referans_arac_idx ON arac_tuketim_referans (arac_id, created_at DESC);
-- Araç başına tek geçerli (ONAYLI) referans
CREATE UNIQUE INDEX IF NOT EXISTS arac_tuketim_referans_onayli_uq ON arac_tuketim_referans (arac_id) WHERE durum = 'ONAYLI';

-- 2) Yakıt birim fiyatı (tarihli, kaynaklı). Kaynağı olmayan fiyat girilmez; kayıt silinmez, iptal edilir.
CREATE TABLE IF NOT EXISTS yakit_fiyat_referans (
  id                 BIGSERIAL PRIMARY KEY,
  gecerlilik_tarihi  DATE NOT NULL,
  yakit_turu         TEXT NOT NULL,     -- DIZEL | BENZIN | LPG
  il                 TEXT,              -- fiyatın ait olduğu il (bilgi)
  birim_fiyat        NUMERIC(8,3) NOT NULL CHECK (birim_fiyat > 0),   -- TL / litre (KDV dahil pompa fiyatı)
  kaynak_ad          TEXT NOT NULL,     -- ör. "Opet il bazlı akaryakıt fiyatı", "EPDK"
  kaynak_url         TEXT,
  giren_email        TEXT,
  iptal              BOOLEAN NOT NULL DEFAULT false,
  iptal_gerekce      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS yakit_fiyat_referans_tarih_idx ON yakit_fiyat_referans (yakit_turu, gecerlilik_tarihi DESC);

-- 3) HW malzeme hareketinde araç bağlantısı: ekibe teslim / ekipler arası devirde depo sorumlusunun SEÇTİĞİ araç plakası.
--    "Ekipte" ile "bu araçta" ayrımı bundan gelir; ekibin bütün malzemesi mevcut aracına otomatik yüklenmiş sayılmaz.
--    Eski hareketlerde boş kalır (araç bağlantısı doğrulanmadı). Koruma tetikleyicisi bu alanın sonradan değişmesini engeller.
ALTER TABLE hw_malzeme_islem ADD COLUMN IF NOT EXISTS arac_plaka TEXT;
ALTER TABLE hw_malzeme_islem ADD COLUMN IF NOT EXISTS arac_id INTEGER;
CREATE INDEX IF NOT EXISTS hw_malzeme_islem_arac_idx ON hw_malzeme_islem (arac_plaka) WHERE arac_plaka IS NOT NULL;
CREATE OR REPLACE FUNCTION hw_malzeme_islem_koru() RETURNS trigger LANGUAGE plpgsql AS $f$
  BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'hw_malzeme_islem kayıtları silinemez (ters kayıt kullanın)'; END IF;
    IF NEW.id <> OLD.id OR NEW.tur <> OLD.tur OR NEW.site_code <> OLD.site_code OR NEW.kaynak_tip <> OLD.kaynak_tip
       OR NEW.kaynak_id IS DISTINCT FROM OLD.kaynak_id OR NEW.hedef_tip <> OLD.hedef_tip OR NEW.hedef_id IS DISTINCT FROM OLD.hedef_id
       OR NEW.kapsam <> OLD.kapsam OR NEW.ters_edilen_id IS DISTINCT FROM OLD.ters_edilen_id OR NEW.created_at <> OLD.created_at
       OR NEW.arac_plaka IS DISTINCT FROM OLD.arac_plaka OR NEW.arac_id IS DISTINCT FROM OLD.arac_id
       OR (OLD.ters_islem_id IS NOT NULL AND NEW.ters_islem_id IS DISTINCT FROM OLD.ters_islem_id) THEN
      RAISE EXCEPTION 'hw_malzeme_islem: miktar / lokasyon / tür / araç değiştirilemez (ters kayıt kullanın)';
    END IF;
    RETURN NEW;
  END $f$;

ALTER TABLE arac_tuketim_referans ENABLE ROW LEVEL SECURITY;
ALTER TABLE yakit_fiyat_referans ENABLE ROW LEVEL SECURITY;

COMMIT;
