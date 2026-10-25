-- Tarihli onay devri (25.10.2026) — Teknocenter direktör onayları 01.11.2026 00:00 (Europe/Istanbul) itibarıyla
-- Düzgün Şimşek'ten İlhami Şahin'e geçer. Tablo backend açılışında (onayDevri.semaKur) da oluşturulur; bu dosya
-- canlıda elle çalıştırmak ve geri almak için. UYGULANMADI — Orhan'ın açık onayıyla.
--
-- 1) Tablo (backend ile aynı ifadeler)
CREATE TABLE IF NOT EXISTS onay_devri (
  id SERIAL PRIMARY KEY,
  firma TEXT NOT NULL,                -- talebin üzerinde olduğu personelin firması: ERC / TEKNO / AHY
  adim TEXT NOT NULL,                 -- AVANS_PD (iş avansı direktör onayı) | MASRAF_PD (masraf formu direktör onayı)
  onayci_user_id INTEGER NOT NULL,    -- devralan KULLANICI KİMLİĞİ (users.id) — isim/e-posta eşleşmesi yok
  baslangic TIMESTAMPTZ NOT NULL,     -- yürürlük başlangıcı (dahil)
  bitis TIMESTAMPTZ,                  -- yürürlük bitişi (hariç); NULL = süresiz
  aciklama TEXT, olusturan TEXT, aktif BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE INDEX IF NOT EXISTS onay_devri_firma_adim_idx ON onay_devri (firma, adim);
ALTER TABLE onay_devri ENABLE ROW LEVEL SECURITY;

-- 2) Teknocenter devri (İlhami Şahin'in hesabı admin panelinden açıldıktan SONRA; e-posta Orhan'ın verdiği adres)
--    Not: hesap bulunamazsa INSERT hiç satır eklemez — kontrol: SELECT * FROM onay_devri;
INSERT INTO onay_devri (firma, adim, onayci_user_id, baslangic, aciklama, olusturan)
SELECT 'TEKNO', a.adim, u.id, TIMESTAMPTZ '2026-11-01 00:00:00+03', 'Teknocenter direktör onayları 01.11.2026 itibarıyla İlhami Şahin', 'migration-2026-10-26'
FROM users u, (VALUES ('AVANS_PD'), ('MASRAF_PD')) AS a(adim)
WHERE LOWER(TRIM(u.email)) IN ('ilhami.şahin@simsektel.com', 'ilhami.sahin@simsektel.com')
  AND COALESCE(u.is_active, true) AND COALESCE(u.status, 'active') = 'active'
  AND NOT EXISTS (SELECT 1 FROM onay_devri d WHERE d.firma = 'TEKNO' AND d.adim = a.adim AND d.aktif);

-- 3) Kontrol
-- SELECT d.*, u.email FROM onay_devri d JOIN users u ON u.id = d.onayci_user_id;

-- 4) Geri alma (devri iptal eder; geçmiş onaylar değişmez)
-- UPDATE onay_devri SET aktif = false WHERE firma = 'TEKNO' AND adim IN ('AVANS_PD','MASRAF_PD');
-- DROP TABLE onay_devri;  -- yalnız tamamen kaldırmak için
