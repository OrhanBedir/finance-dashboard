-- Atanan İş Tutarı — fiyat kaynağı geçmişi (02.11.2026) — UYGULANMADI, Orhan onayı bekliyor
-- Kod: backend/atananIs.js (kaynakGecmisiYaz / kaynakGecmisiOku). Tablo yoksa kod hiçbir şey yazmaz ve tabloyu KENDİSİ OLUŞTURMAZ;
-- hesap ve ekran tablo olmadan da çalışır. Tablo kurulunca /finance/atanan-is her açılışta, kalemin fiyat kaynağı
-- (PO / BoQ / fiyatsız), PO satırları ya da birim fiyatı son kayıttan farklıysa YENİ satır ekler — eski satır silinmez,
-- güncellenmez. Böylece PO geldiğinde (BoQ → PO), PO iptal / revize olduğunda (PO → BoQ ya da başka PO satırı) önceki kaynak izlenir.
-- PO dosyası her yüklemede po_rows'u baştan yazdığı için bu geçmiş başka yerde tutulmaz.
-- Mevcut tablolara (master_works, po_rows, boq_katalog, faturalar) DOKUNMAZ.

BEGIN;
CREATE TABLE IF NOT EXISTS atanan_fiyat_kaynak_gecmis (
  id SERIAL PRIMARY KEY,
  master_id INTEGER NOT NULL,          -- master_works.id (PR satırı)
  is_kodu TEXT,
  item_code TEXT,
  imza TEXT NOT NULL,                  -- kaynak|po fiyatı|para|po satırları|boq sürüm:fiyat — değişiklik karşılaştırması
  fiyat_kaynagi TEXT,                  -- PO / BOQ / PO+BOQ / PO+YOK / YOK / INCELEME
  po_birim_fiyat NUMERIC,
  po_para TEXT,
  po_satirlari JSONB,
  boq_surum TEXT,
  boq_birim_fiyat NUMERIC,
  boq_para TEXT,
  kullanici TEXT,
  zaman TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS atanan_fiyat_kaynak_gecmis_master ON atanan_fiyat_kaynak_gecmis (master_id, id DESC);
-- Supabase: tablo yalnız sunucudan (service rolü) okunur / yazılır
ALTER TABLE atanan_fiyat_kaynak_gecmis ENABLE ROW LEVEL SECURITY;
COMMIT;

-- GERİ DÖNÜŞ (yalnız bu tabloyu kaldırır; başka kayda dokunmaz):
-- BEGIN; DROP TABLE IF EXISTS atanan_fiyat_kaynak_gecmis; COMMIT;
