-- Omnix profil geçişi — SALT OKUNUR EŞLEŞTİRME RAPORU (25.10.2026). Hiçbir kaydı DEĞİŞTİRMEZ.
-- Çalıştırma (onaydan sonra): ~/.claude/scripts/salt_okunur_pg.js bekçisiyle. Sonuçlara bakılarak bağlantılar
-- admin panelinden TEK TEK, kalıcı kimlikle yapılır. Toplu tahminle tip/taşeron atanmaz.

-- 1) Eski tip taşeron hesapları ve subcons'ta TAM ad eşleşmesi olup olmadığı (eşleşme yoksa elle seçilmeli)
SELECT u.id, u.name, u.email, u.subcon_name, u.marka, u.is_active,
       s.id AS tam_eslesen_subcon_id, s.subcon_name AS tam_eslesen_ad
FROM users u
LEFT JOIN subcons s ON UPPER(TRIM(s.subcon_name)) = UPPER(TRIM(u.subcon_name))
WHERE LOWER(COALESCE(u.role,'')) = 'subcon'
ORDER BY u.subcon_name, u.id;

-- 2) Rolü subcon olmayan ama subcon_name taşıyan hesaplar (alt marka paneli / bağlı firma) — taşeron sayılmamalı mı, kontrol
SELECT id, name, email, role, marka, subcon_name FROM users
WHERE LOWER(COALESCE(role,'')) <> 'subcon' AND COALESCE(TRIM(subcon_name),'') <> '' ORDER BY marka, id;

-- 3) Kayıtlarda geçen taşeron adları ve subcons / takma ad karşılığı (karşılığı olmayanlar takma ad adayıdır)
WITH adlar AS (
  SELECT 'master_works' AS kaynak, UPPER(TRIM(subcon_name)) AS ad, COUNT(*) AS adet FROM master_works WHERE COALESCE(subcon_name,'') <> '' GROUP BY 2
  UNION ALL SELECT 'invoice_entries', UPPER(TRIM(COALESCE(NULLIF(rf_montaj_firma,''), tedarikci))), COUNT(*) FROM invoice_entries GROUP BY 2
  UNION ALL SELECT 'bolge_fatura', UPPER(TRIM(taseron_adi)), COUNT(*) FROM bolge_fatura GROUP BY 2
  UNION ALL SELECT 'taseron_odeme_log', UPPER(TRIM(firma)), COUNT(*) FROM taseron_odeme_log GROUP BY 2
)
SELECT a.kaynak, a.ad, a.adet,
       COALESCE(s.id, t.subcon_id) AS subcon_id,
       CASE WHEN s.id IS NOT NULL THEN 'ana ad' WHEN t.subcon_id IS NOT NULL THEN 'takma ad' ELSE 'KARŞILIKSIZ' END AS durum
FROM adlar a
LEFT JOIN subcons s ON UPPER(TRIM(s.subcon_name)) = a.ad
LEFT JOIN subcon_takma_ad t ON UPPER(TRIM(t.ad)) = a.ad
ORDER BY durum DESC, a.ad, a.kaynak;

-- 4) Şirket içi ekip etiketleri (ekipler.ekip_turu = 'IC') — bunlar dış taşeron DEĞİL; taşeron kullanıcısına bağlanmamalı
SELECT ekip_no, ad, ekip_turu, bagli_firma, is_etiketleri FROM ekipler WHERE ekip_turu = 'IC' ORDER BY ekip_no;

-- 5) Teknocenter şirket sahipleri — hesap DOĞRULAMA (ada bakarak yetki verilmez; sonuç Orhan'a sunulur)
--    Aday hesaplar: ad / e-posta benzerliği yalnız LİSTELEMEK içindir. Yetki, Orhan'ın teyit ettiği tek hesap id'sine verilir.
SELECT u.id, u.name, u.email, u.role, u.marka, u.is_active, u.created_at,
       (SELECT p.id FROM personel p WHERE p.user_id = u.id LIMIT 1) AS personel_id
FROM users u
WHERE TRANSLATE(LOWER(u.name), 'İIŞĞÜÖÇışğüöç', 'iisguocisguoc') LIKE '%sahin%'
   OR LOWER(u.email) IN ('ilhami.sahin@simsektel.com')
ORDER BY u.id;
SELECT p.id, p.ad_soyad, p.email, p.marka, p.aktif, p.user_id FROM personel p
WHERE TRANSLATE(LOWER(p.ad_soyad), 'İIŞĞÜÖÇışğüöç', 'iisguocisguoc') LIKE '%sahin%' ORDER BY p.id;
