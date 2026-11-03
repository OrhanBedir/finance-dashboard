// YALNIZ YEREL: İş Atama uçtan uca testi için Teknocenter kurgusu (gerçek kişi / firma verisi YOK).
// Yalnız 127.0.0.1 üzerindeki "omnix_test" veritabanına yazar. tohum.js'ten SONRA, backend açıkken çalıştırılır
// (ekipler / personel / rollout_progress kolonları backend açılışında oluşur). Çalıştırma: NODE_PATH=<backend>/node_modules node test/yerel/atama_tohum.js
const { Client } = require("pg");
const bcrypt = require("bcrypt");
const SIFRE = "Omnix-Test-2026";
const E = {
  teknoYonetici: "tekno.yonetici@teknocenter.test",   // alt marka (TEKNO) direktör — mobil / web İş Ata yetkisi
  sef1: "tekno.sef1@teknocenter.test", uye1: "tekno.uye1@teknocenter.test", // Ekip 301 (IC, TEKNO) — mobil hesabı var
  // tekno.uye2: e-postasız personel (mobil hesaba bağlanamaz)
  emrah1: "emrah.uye1@teknocenter.test",               // Ekip 302 (DIS, TEKNO_EMRAH) — hesabı var
  emrah2: "emrah.uye2@teknocenter.test",               // Ekip 302 — personel kartı var, hesabı YOK
};
const SAHALAR = ["BU7001_NR700", "BU7001_L1800_AE", "BU7002_NR700", "BU7003_NR700"]; // BU7003 → AHY (Tekno kapsamı DIŞI)

(async () => {
  const c = new Client({ host: "127.0.0.1", port: 55432, user: "postgres", database: "omnix_test" });
  if (c.host !== "127.0.0.1" || c.database !== "omnix_test") throw new Error("Yalnız yerel test veritabanı!");
  await c.connect();
  const q = (s, p) => c.query(s, p);
  const h = await bcrypt.hash(SIFRE, 8);
  // Temizlik
  await q(`DELETE FROM is_atama WHERE site_codes && $1::text[] OR atayan_email IN ($2,$3)`, [SAHALAR, E.teknoYonetici, "orhan.bedir@simsektel.com"]).catch(() => {});
  await q(`DELETE FROM users WHERE email = ANY($1)`, [Object.values(E)]);
  await q(`DELETE FROM personel WHERE email = ANY($1) OR ad_soyad IN ('Tekno Üye İki')`, [Object.values(E)]);
  await q(`DELETE FROM ekipler WHERE ekip_no IN (301, 302)`);
  await q(`DELETE FROM rollout_progress WHERE site_code = ANY($1)`, [SAHALAR]);
  // Marka: TEKNO alt marka (hw_yukleme=false → alt marka hesabı; taşeron öneki TEKNO)
  await q(`INSERT INTO markalar (tenant, kod, ad, hw_yukleme, aktif, taseron_onek, devir_baslangic, devralinan) VALUES ('erc','TEKNO','Teknocenter', false, true, 'TEKNO', '2026-10-14', 'AHY')
    ON CONFLICT (kod) DO UPDATE SET ad = EXCLUDED.ad, hw_yukleme = false, aktif = true, taseron_onek = 'TEKNO'`).catch((e) => console.log("markalar:", e.message));
  // Taşeron firmalar
  for (const ad of ["TEKNO", "TEKNO_EMRAH", "AHY_VEDAT"]) await q(`INSERT INTO subcons (subcon_name) VALUES ($1) ON CONFLICT (subcon_name) DO NOTHING`, [ad]);
  const emrahId = (await q(`SELECT id FROM subcons WHERE subcon_name = 'TEKNO_EMRAH'`)).rows[0].id;
  // Personel (ekip üyeleri) — marka TEKNO (alt marka bordrosu)
  const per = async (ad, e, unvan, ekip, plaka) => (await q(`INSERT INTO personel (ad_soyad, email, unvan, bolge, aktif, marka, firma_tipi, ekip_bilgisi, ekip_arac_plaka) VALUES ($1,$2,$3,'Bursa',true,'TEKNO','simsek',$4,$5) RETURNING id`, [ad, e, unvan, String(ekip), plaka || null])).rows[0].id;
  const sef1 = await per("Tekno Şef Bir", E.sef1, "Ekip Şefi", 301, "16TK301");
  await per("Tekno Üye Bir", E.uye1, "Saha Teknisyeni", 301, null);
  await per("Tekno Üye İki", null, "Saha Teknisyeni", 301, null); // e-postasız
  await per("Emrah Üye Bir", E.emrah1, "Saha Teknisyeni", 302, "16EM302");
  await per("Emrah Üye İki", E.emrah2, "Saha Teknisyeni", 302, null); // hesabı yok
  // Ekipler
  await q(`INSERT INTO ekipler (ekip_no, ad, bolge, plaka, ekip_turu, bagli_firma, aktif, sef_personel_id) VALUES (301, 'Tekno Ekip 1', 'Bursa', '16TK301', 'IC', 'TEKNO', true, $1)`, [sef1]);
  await q(`INSERT INTO ekipler (ekip_no, ad, bolge, plaka, ekip_turu, firma_id, aktif) VALUES (302, 'TEKNO_EMRAH', 'Bursa', '16EM302', 'DIS', $1, true)`, [emrahId]);
  // Kullanıcılar (mobil hesabı olanlar)
  const kul = async (ad, e, rol, marka) => q(`INSERT INTO users (name, email, password_hash, role, is_active, tenant, status, marka) VALUES ($1,$2,$3,$4,true,'erc','active',$5)`, [ad, e, h, rol, marka]);
  await kul("Tekno Yönetici", E.teknoYonetici, "direktor", "TEKNO");
  // Alt marka yöneticisi: İş Ata yetkisi için rol + rollout_goruntule + rollout_duzenle (canlıda yetki ayarıyla verilir)
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS yetki_ayar JSONB`);
  await q(`UPDATE users SET yetki_ayar = '{"rollout_goruntule":true,"rollout_duzenle":true}'::jsonb WHERE email = $1`, [E.teknoYonetici]);
  // Yerel şemada olmayan Huawei PR / PO tabloları (haritaVerisi ve saha varlık kontrolü okur) — boş olmaları yeterli
  await q(`CREATE TABLE IF NOT EXISTS master_works (id SERIAL PRIMARY KEY, site_code TEXT, site_type TEXT, item_code TEXT, item_description TEXT, subcon_name TEXT, onair_date DATE, qc_durum TEXT,
    tamamlanan_qty NUMERIC, done_qty NUMERIC, boq_surum TEXT, project_code TEXT, region TEXT, bolge TEXT, unit_price NUMERIC, qty NUMERIC, po_no TEXT, olusturan TEXT, created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS po_rows (id SERIAL PRIMARY KEY, site_code TEXT, item_code TEXT, item_description TEXT, project_code TEXT, po_no TEXT, requested_qty NUMERIC, unit_price NUMERIC, currency TEXT, created_at TIMESTAMP DEFAULT now())`);
  await kul("Tekno Şef Bir", E.sef1, "user", "TEKNO");
  await kul("Tekno Üye Bir", E.uye1, "user", "TEKNO");
  await kul("Emrah Üye Bir", E.emrah1, "user", "TEKNO");
  // Yerel şemada iş kolu taşeron kolonları yoktur (canlıda var) — eklenir
  for (const k of ["rf_subcon", "los_subcon", "tss_subcon", "tssr_subcon", "btk_subcon", "trs_subcon", "enh_subcon", "enh_proje_subcon", "power_subcon", "emr_subcon", "pac_subcon", "ysb_subcon"]) await q(`ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS ${k} TEXT`);
  // Rollout sahaları (rf iş kolu taşeronu → zorunlu Teknocenter kapsamı bunlardan türer)
  const rp = (sc, rf) => q(`INSERT INTO rollout_progress (site_code, site_type, bolge, il, project_code, rf_subcon) VALUES ($1,$2,'Bursa','BURSA','56A0TCT',$3)`, [sc, sc.includes("NR700") ? "5G" : "LTE", rf]);
  await rp("BU7001_NR700", "TEKNO"); await rp("BU7001_L1800_AE", "TEKNO"); await rp("BU7002_NR700", "TEKNO_EMRAH"); await rp("BU7003_NR700", "AHY_VEDAT");
  await c.end();
  console.log("atama tohum tamam");
})().catch((e) => { console.error(e); process.exit(1); });
