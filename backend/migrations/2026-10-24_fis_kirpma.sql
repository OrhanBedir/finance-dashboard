-- ═══ Otomatik fiş kırpma: işlem kaydı + masraf_belge kırpma künyesi (24.10.2026, Orhan) ═══
-- server.js açılışta aynı komutları IF NOT EXISTS ile çalıştırır (masraf_belge künye sütunlarındaki mevcut uygulama gibi);
-- bu dosya kayıt ve deploy öncesi elle uygulama içindir. Mevcut satırlara dokunmaz (eski fişler yeniden işlenmez).
-- Geri alma: en alttaki komutlar (yalnız yeni tablo / sütunlar; mevcut fiş dosyaları ve masraf kayıtları değişmez).

BEGIN;

-- Mobilden gelen her fotoğrafın işlem kaydı. Orijinal fotoğraf ÖZEL depoda (erc-ozel kovası) tutulur;
-- orijinal_yol bir URL değil, depo içi anahtardır ve hiçbir liste yanıtında dönmez.
--   durum: ISLENIYOR | HAZIR (sonuc.durum: GUVENILIR / KONTROL / COKLU / FIS_YOK) | AI_HATA | EKLENDI | TEMIZLENDI
--   eklenmeyen ya da eki silinen işlemlerin orijinali 48 saat sonra temizlikte silinir (kayıt iz olarak kalır)
CREATE TABLE IF NOT EXISTS masraf_fis_isleme (
  id SERIAL PRIMARY KEY,
  kalem_id INTEGER, form_id INTEGER, kullanici_email TEXT NOT NULL,
  sha256 TEXT NOT NULL, orijinal_ad TEXT, mime TEXT, boyut INTEGER,
  genislik INTEGER, yukseklik INTEGER, exif_yon INTEGER,
  orijinal_depo TEXT, orijinal_yol TEXT,
  durum TEXT NOT NULL DEFAULT 'ISLENIYOR', sonuc JSONB, model TEXT, sure_ms INTEGER, hata TEXT, deneme INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now(), eklendi_at TIMESTAMP);
-- PostgREST (anon anahtar) üzerinden okunmasın; backend doğrudan bağlantıyla çalışır
ALTER TABLE masraf_fis_isleme ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS masraf_fis_isleme_anahtar_idx ON masraf_fis_isleme (kullanici_email, kalem_id, sha256);

-- Ek ↔ işlem ilişkisi ve kırpma durumu
--   kirpma_durum: OTOMATIK | KULLANICI | KIRPILMADI | MOBIL_ELLE (eski mobil, ölçü doğrulandı) | DOGRULANAMADI | NULL (eski kayıt)
--   istek_id: mobilin tekrar denemede aynı kalan istek kimliği → aynı fiş iki kez eklenmez
ALTER TABLE masraf_belge
  ADD COLUMN IF NOT EXISTS isleme_id INTEGER,
  ADD COLUMN IF NOT EXISTS aday_no INTEGER,
  ADD COLUMN IF NOT EXISTS kirpma_durum TEXT,
  ADD COLUMN IF NOT EXISTS istek_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS masraf_belge_istek_idx ON masraf_belge (istek_id) WHERE istek_id IS NOT NULL;

COMMIT;

-- Geri alma:
-- DROP INDEX IF EXISTS masraf_belge_istek_idx;
-- ALTER TABLE masraf_belge DROP COLUMN IF EXISTS istek_id, DROP COLUMN IF EXISTS kirpma_durum, DROP COLUMN IF EXISTS aday_no, DROP COLUMN IF EXISTS isleme_id;
-- DROP TABLE IF EXISTS masraf_fis_isleme;
