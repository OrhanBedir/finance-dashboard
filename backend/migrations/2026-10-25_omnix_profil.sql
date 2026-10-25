-- Omnix kullanıcı profilleri: şirket yönetimi + taşeron firma (25.10.2026, Orhan)
-- CANLIYA UYGULANMADI. Backend açılışta aynı ifadeleri (omnixProfil.semaKur) idempotent çalıştırır; bu dosya kayıt ve
-- elle uygulama içindir. Yalnız ekleme yapar: mevcut kolon/kayıt silinmez, mevcut kullanıcıların tipi DEĞİŞTİRİLMEZ
-- (kullanici_tipi NULL = eski hesap, davranış aynen sürer). Geri alma bölümü en altta.
BEGIN;

-- Kullanıcı tipi ve kalıcı bağlantılar
ALTER TABLE users ADD COLUMN IF NOT EXISTS kullanici_tipi  TEXT;     -- 'IC' | 'TASERON' | NULL (eski)
ALTER TABLE users ADD COLUMN IF NOT EXISTS taseron_id      INTEGER;  -- subcons.id (taşeron firma kullanıcısı)
ALTER TABLE users ADD COLUMN IF NOT EXISTS yonetim_profili TEXT;     -- 'PERSONEL' | 'YONETICI' | 'SAHIP' (şirket içi)

-- Taşeron ana kaydı: mevcut subcons tablosu kalıcı kimlik olur
ALTER TABLE subcons ADD COLUMN IF NOT EXISTS unvan     TEXT;            -- görünen yasal unvan
ALTER TABLE subcons ADD COLUMN IF NOT EXISTS ana_firma TEXT;            -- markalar.kod (NULL = henüz bağlanmamış)
ALTER TABLE subcons ADD COLUMN IF NOT EXISTS aktif     BOOLEAN DEFAULT true;

-- Taşeronun kayıtlarda geçen diğer yazımları (fatura tedarikçi adı, master_works.subcon_name …) — TAM eşleşme
CREATE TABLE IF NOT EXISTS subcon_takma_ad (
  id         SERIAL PRIMARY KEY,
  subcon_id  INTEGER NOT NULL REFERENCES subcons(id) ON DELETE CASCADE,
  ad         TEXT NOT NULL,
  ekleyen    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS subcon_takma_ad_ad_uq ON subcon_takma_ad (UPPER(TRIM(ad)));

-- İş atamasının taşeronu + atama anındaki anlaşılmış fiyat (sürümlü; revizyon nedeni ve yapan)
ALTER TABLE is_atama ADD COLUMN IF NOT EXISTS taseron_id INTEGER;
CREATE INDEX IF NOT EXISTS is_atama_taseron_idx ON is_atama (taseron_id);
CREATE TABLE IF NOT EXISTS is_atama_fiyat (
  id          SERIAL PRIMARY KEY,
  is_atama_id INTEGER NOT NULL,
  surum       INTEGER NOT NULL,
  taseron_id  INTEGER NOT NULL,
  kalemler    JSONB   NOT NULL,          -- [{kalem_kodu, aciklama, miktar, birim, birim_fiyat}]
  para_birimi TEXT    NOT NULL,          -- TRY | USD | EUR
  kdv_esasi   TEXT    NOT NULL,          -- HARIC | DAHIL
  toplam      NUMERIC NOT NULL,
  neden       TEXT,
  olusturan   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (is_atama_id, surum)
);

-- Supabase: yeni tablolar istemciden (anon/authenticated) doğrudan okunmasın — backend servis bağlantısıyla çalışır
ALTER TABLE subcon_takma_ad ENABLE ROW LEVEL SECURITY;
ALTER TABLE is_atama_fiyat  ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ── GERİ ALMA (gerekirse; önce backend eski sürüme dönülmeli) ──
-- BEGIN;
-- DROP TABLE IF EXISTS is_atama_fiyat;
-- DROP TABLE IF EXISTS subcon_takma_ad;
-- ALTER TABLE is_atama DROP COLUMN IF EXISTS taseron_id;
-- ALTER TABLE subcons DROP COLUMN IF EXISTS unvan, DROP COLUMN IF EXISTS ana_firma, DROP COLUMN IF EXISTS aktif;
-- ALTER TABLE users DROP COLUMN IF EXISTS kullanici_tipi, DROP COLUMN IF EXISTS taseron_id, DROP COLUMN IF EXISTS yonetim_profili;
-- COMMIT;
