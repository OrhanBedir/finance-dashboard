-- 06.11.2026 RF taşeron portalı — ŞEMA (sunucu açılışında da IF NOT EXISTS ile kurulur; veri değiştirmez)
ALTER TABLE taseron_saha_uye ADD COLUMN IF NOT EXISTS finans BOOLEAN;           -- firma sahibi (finans) yetkisi; NULL = kapalı
ALTER TABLE subcons ADD COLUMN IF NOT EXISTS rf_portal BOOLEAN NOT NULL DEFAULT false; -- RF montaj taşeron portalı kapsamı
ALTER TABLE users ADD COLUMN IF NOT EXISTS oturum_gecersiz_ts TIMESTAMPTZ;      -- bu andan önce verilmiş token kabul edilmez
