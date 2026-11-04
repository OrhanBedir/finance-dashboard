-- TAŞERON SAHA OPERASYONU (04.11.2026, Orhan) — Teknocenter taşeronları (TEKNO_EMRAH, TEKNO_2KX, TEKNO_İZTAŞ) mobil saha ekranı
-- YALNIZ EKLEME: mevcut tablo / kolon değiştirilmez, veri silinmez. Sunucu açılışında aynı DDL IF NOT EXISTS ile kendiliğinden
-- çalışır (taseronSaha.semaKur); bu dosya elle / denetimli uygulama içindir. Geri dönüş: 2026-11-04_taseron_saha_geri.sql
BEGIN;

-- Taşeron hesabının firma içi rolü ve ekibi. Firma kimliği users.taseron_id (subcons.id) olarak kalır.
--   rol SORUMLU : firmanın bütün ekiplerinin işleri
--   rol CALISAN : yalnız kendi ekibinin işleri (ekip_no NULL ise ekibe ayrılmamış firma işleri); fiyat / hakediş / fatura uçları kapalı
-- Satırı olmayan taşeron hesabı eskisi gibi firma geneli görür (mevcut /taseron-panel davranışı değişmez).
CREATE TABLE IF NOT EXISTS taseron_saha_uye (
  user_id     INTEGER PRIMARY KEY,
  taseron_id  INTEGER NOT NULL,
  ekip_no     INTEGER,
  rol         TEXT NOT NULL DEFAULT 'CALISAN' CHECK (rol IN ('SORUMLU', 'CALISAN')),
  aktif       BOOLEAN NOT NULL DEFAULT true,
  ekleyen     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS taseron_saha_uye_firma_idx ON taseron_saha_uye (taseron_id, ekip_no);

-- Saha bildirimi: montaj başlangıcı / tamamlanması / kısmi iş + yapılan iş açıklaması (PR hazırlığına kaynak, PR DEĞİL)
CREATE TABLE IF NOT EXISTS taseron_saha_bildirim (
  id              BIGSERIAL PRIMARY KEY,
  site_code       TEXT NOT NULL,              -- tam iş kodu
  fiziksel_id     TEXT,                       -- fiziksel Site ID
  taseron_id      INTEGER NOT NULL,
  ekip_no         INTEGER,
  user_id         INTEGER,
  bildiren_email  TEXT,
  bildiren_ad     TEXT,
  tur             TEXT NOT NULL CHECK (tur IN ('BASLADI', 'TAMAMLANDI', 'KISMI')),
  standart        BOOLEAN,                    -- "atanan kapsam eksiksiz yapıldı" tek seçimi
  aciklama        TEXT,                       -- yapılan iş / saha açıklaması
  kalan_is        TEXT,
  sorun           TEXT,
  konum           JSONB,                      -- cihaz konumu (yardımcı; izin yoksa boş)
  fotolar         JSONB NOT NULL DEFAULT '[]'::jsonb,
  istek_anahtari  TEXT,
  surum           INTEGER NOT NULL DEFAULT 1,
  pr_durum        TEXT NOT NULL DEFAULT 'BEKLIYOR' CHECK (pr_durum IN ('BEKLIYOR', 'INCELENDI', 'PR_HAZIRLANIYOR', 'PR_HAZIRLANDI')),
  pr_ref          TEXT,
  inceleyen       TEXT,
  inceleme_notu   TEXT,
  inceleme_zamani TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS taseron_saha_bildirim_kod_idx ON taseron_saha_bildirim (site_code, created_at);
CREATE INDEX IF NOT EXISTS taseron_saha_bildirim_firma_idx ON taseron_saha_bildirim (taseron_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS taseron_saha_bildirim_istek_uq ON taseron_saha_bildirim (user_id, istek_anahtari) WHERE istek_anahtari IS NOT NULL;

-- Bildirim düzeltme geçmişi: önceki sürüm + değiştiren
CREATE TABLE IF NOT EXISTS taseron_saha_bildirim_surum (
  id           BIGSERIAL PRIMARY KEY,
  bildirim_id  BIGINT NOT NULL,
  surum        INTEGER NOT NULL,
  eski         JSONB NOT NULL,
  degistiren   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS taseron_saha_bildirim_surum_idx ON taseron_saha_bildirim_surum (bildirim_id, surum);

ALTER TABLE taseron_saha_uye ENABLE ROW LEVEL SECURITY;
ALTER TABLE taseron_saha_bildirim ENABLE ROW LEVEL SECURITY;
ALTER TABLE taseron_saha_bildirim_surum ENABLE ROW LEVEL SECURITY;

COMMIT;
