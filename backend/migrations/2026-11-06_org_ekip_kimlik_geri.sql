-- GERİ DÖNÜŞ: 2026-11-06_org_ekip_kimlik.sql
-- DİKKAT: önce birleştirilmiş ekipler geri alınmalı (Organizasyon Şeması → birleştirmeyi geri al, ya da teslim klasöründeki
-- geri_al betiği); aksi halde birleştirme izi (birlesen_ekip_no, eski_adlar) kaybolur. Kolonlar boşsa güvenle kaldırılır.
BEGIN;
ALTER TABLE ekipler DROP COLUMN IF EXISTS birlesen_ekip_no;
ALTER TABLE ekipler DROP COLUMN IF EXISTS eski_adlar;
ALTER TABLE ekipler DROP COLUMN IF EXISTS operasyon_bas;
ALTER TABLE ekipler DROP COLUMN IF EXISTS operasyon_bit;
ALTER TABLE ekipler DROP COLUMN IF EXISTS teyit_zamani;
ALTER TABLE ekipler DROP COLUMN IF EXISTS teyit_eden;
COMMIT;
