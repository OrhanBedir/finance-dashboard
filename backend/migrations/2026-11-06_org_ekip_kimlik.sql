-- TEK EKİP KİMLİĞİ (06.11.2026, Orhan) — organizasyon şeması gerçek ekip yapısı
-- YALNIZ EKLEME: ekipler tablosuna 6 boş kolon; mevcut tablo / veri değişmez. Sunucu açılışta aynı kolonları
-- orgEkip.semaKur ile (ADD COLUMN IF NOT EXISTS) kendisi de açar; bu dosya kayıt ve elle uygulama içindir.
-- Geri dönüş: 2026-11-06_org_ekip_kimlik_geri.sql
--   birlesen_ekip_no  mükerrer kayıt hangi ekibe birleştirildi (kayıt silinmez; aktif şemada ve seçicilerde görünmez)
--   eski_adlar        ekibin önceki görünen adları (ör. "TEKNO Ekip1") — geçmiş kayıtlarda izlenebilirlik
--   operasyon_bas/bit taşeron ekibinin operasyon bağlantısı tarihleri (firma kartı ayrı kalır)
--   teyit_zamani/eden ekip bilgilerinin son teyidi (kart ve müşteri çıktısı)
BEGIN;
ALTER TABLE ekipler ADD COLUMN IF NOT EXISTS birlesen_ekip_no INTEGER;
ALTER TABLE ekipler ADD COLUMN IF NOT EXISTS eski_adlar TEXT[];
ALTER TABLE ekipler ADD COLUMN IF NOT EXISTS operasyon_bas DATE;
ALTER TABLE ekipler ADD COLUMN IF NOT EXISTS operasyon_bit DATE;
ALTER TABLE ekipler ADD COLUMN IF NOT EXISTS teyit_zamani TIMESTAMPTZ;
ALTER TABLE ekipler ADD COLUMN IF NOT EXISTS teyit_eden TEXT;
COMMIT;
