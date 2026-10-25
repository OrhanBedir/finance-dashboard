-- YALNIZ YEREL TEST: canlı şemanın kodda oluşturulmayan temel tabloları (kolonlar server.js sorgularından)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, name TEXT, email TEXT, password_hash TEXT, role TEXT DEFAULT 'user', is_active BOOLEAN DEFAULT true,
  subcon_name TEXT, payment_rate NUMERIC DEFAULT 0.8, tenant TEXT DEFAULT 'erc', status TEXT DEFAULT 'active', marka TEXT DEFAULT 'ERC',
  users_admin BOOLEAN DEFAULT false, yetki_ayar JSONB, reset_token TEXT, reset_token_expires TIMESTAMP, created_at TIMESTAMP DEFAULT now()
);
CREATE TABLE IF NOT EXISTS masraf_form (
  id SERIAL PRIMARY KEY, personel_id INTEGER, talep_eden_email TEXT, talep_eden_ad TEXT, donem TEXT, form_no INTEGER, durum TEXT DEFAULT 'TASLAK',
  pm_onay_tarihi DATE, pm_not TEXT, direktor_onay_tarihi DATE, direktor_not TEXT, rollout_onay_tarihi DATE, rollout_not TEXT,
  muhasebe_onay_tarihi DATE, muhasebe_not TEXT, arsiv_tarihi TIMESTAMP, red_aciklama TEXT, reddeden_email TEXT, odeme_tarihi DATE,
  created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now()
);
CREATE TABLE IF NOT EXISTS masraf_kalem (
  id SERIAL PRIMARY KEY, form_id INTEGER REFERENCES masraf_form(id) ON DELETE CASCADE, kategori TEXT, tarih DATE, belge_no TEXT, belge_aciklama TEXT,
  aciklama TEXT, tutar NUMERIC, fis_var BOOLEAN DEFAULT true, fis_olmadan_aciklama TEXT, tutar_uyari_aciklama TEXT, plaka TEXT,
  ceza_personel_id INTEGER, ceza_belge_url TEXT, odeme_belge_url TEXT, ceza_sirket BOOLEAN, maastan_kesildi BOOLEAN DEFAULT false,
  kesildi_donem TEXT, kesildi_tarihi DATE, created_at TIMESTAMP DEFAULT now()
);
CREATE TABLE IF NOT EXISTS masraf_belge (
  id SERIAL PRIMARY KEY, kalem_id INTEGER REFERENCES masraf_kalem(id) ON DELETE CASCADE, form_id INTEGER, dosya_adi TEXT, dosya_yolu TEXT,
  ocr_tutar NUMERIC, ocr_plaka TEXT, ocr_plaka_eslesti BOOLEAN, ocr_para TEXT, genislik INTEGER, yukseklik INTEGER, exif_yon INTEGER,
  kirpildi BOOLEAN, kaynak TEXT, kirpma JSONB, isleme_id INTEGER, aday_no INTEGER, kirpma_durum TEXT, istek_id TEXT, created_at TIMESTAMP DEFAULT now()
);
