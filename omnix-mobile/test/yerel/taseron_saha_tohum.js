// YALNIZ YEREL: Taşeron saha operasyonu uçtan uca testi için kurgu (gerçek kişi / firma verisi YOK).
// tohum.js + atama_tohum.js'ten SONRA, backend açıkken çalıştırılır. Yalnız 127.0.0.1 "omnix_test" veritabanına yazar.
// Kurgu: üç Teknocenter taşeronu (TEKNO_EMRAH 2 ekip, TEKNO_2KX, TEKNO_İZTAŞ) + adı benzeyen BAĞIMSIZ firmalar (2KX, İZTAŞ, AHY_VEDAT).
//   BU8001 EMRAH ekip 302 · BU8002 EMRAH ekip 303 · BU8003 EMRAH ekipsiz, konumsuz · BU8004_NR700 TEKNO_2KX / BU8004_L1800 bağımsız 2KX (aynı fiziksel saha)
//   BU8005_NR700 TEKNO_İZTAŞ / BU8005_LTE bağımsız İZTAŞ · BU8006 "Tekno_iztaş " (harf / boşluk farkı) · BU8007 EMRAH tamamlanmış + QC OK
//   BU8008 RF AHY_VEDAT, ENH TEKNO_EMRAH (salt okunur) · BU8009 RF boş + TEKNO_2KX Günlük İş kalemi · BU8010 EMRAH QC NOK
// Çalıştırma: NODE_PATH=<backend>/node_modules node test/yerel/taseron_saha_tohum.js
const { Client } = require("pg");
const bcrypt = require("bcrypt");
const SIFRE = "Omnix-Test-2026";
const E = {
  emrahSorumlu: "emrah.sorumlu@taseron.test", emrahCalisan1: "emrah.calisan1@taseron.test", emrahCalisan2: "emrah.calisan2@taseron.test",
  emrahVarsayilan: "emrah.firma@taseron.test", emrahEkipsiz: "emrah.ekipsiz@taseron.test",
  ikikx: "tekno2kx.sorumlu@taseron.test", iztas: "iztas.calisan@taseron.test", bagimsiz2kx: "bagimsiz2kx@taseron.test",
};
const KODLAR = ["BU8001_NR700", "BU8002_NR700", "BU8003_NR700", "BU8004_NR700", "BU8004_L1800", "BU8005_NR700", "BU8005_LTE", "BU8006_NR700", "BU8007_NR700", "BU8008_NR700", "BU8009_NR700", "BU8010_NR700"];

(async () => {
  const c = new Client({ host: "127.0.0.1", port: 55432, user: "postgres", database: "omnix_test" });
  if (c.host !== "127.0.0.1" || c.database !== "omnix_test") throw new Error("Yalnız yerel test veritabanı!");
  await c.connect();
  const q = (s, p) => c.query(s, p);
  const h = await bcrypt.hash(SIFRE, 8);
  // Temizlik
  for (const t of ["is_fiili_bildirim", "taseron_saha_bildirim"]) await q(`DELETE FROM ${t} WHERE site_code = ANY($1)`, [KODLAR]).catch(() => {});
  await q(`DELETE FROM is_atama WHERE site_codes && $1::text[]`, [KODLAR]).catch(() => {});
  await q(`DELETE FROM rollout_progress WHERE site_code = ANY($1)`, [KODLAR]);
  await q(`DELETE FROM master_works WHERE site_code = ANY($1)`, [KODLAR]).catch(() => {});
  await q(`DELETE FROM saha_konum WHERE fiziksel_id LIKE 'BU80%'`).catch(() => {});
  await q(`DELETE FROM taseron_saha_uye WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))`, [Object.values(E)]).catch(() => {});
  await q(`DELETE FROM ekipler WHERE ekip_no IN (303, 311, 321)`);
  // Firmalar
  for (const ad of ["TEKNO_EMRAH", "TEKNO_2KX", "TEKNO_İZTAŞ", "2KX", "İZTAŞ", "AHY_VEDAT"]) await q(`INSERT INTO subcons (subcon_name) VALUES ($1) ON CONFLICT (subcon_name) DO NOTHING`, [ad]);
  const id = Object.fromEntries((await q(`SELECT id, subcon_name FROM subcons WHERE subcon_name IN ('TEKNO_EMRAH','TEKNO_2KX','TEKNO_İZTAŞ','2KX','İZTAŞ')`)).rows.map((r) => [r.subcon_name, r.id]));
  await q(`UPDATE subcons SET ana_firma = 'TEKNO', aktif = true WHERE id = ANY($1)`, [[id.TEKNO_EMRAH, id.TEKNO_2KX]]);
  await q(`UPDATE subcons SET ana_firma = NULL, aktif = true WHERE id = ANY($1)`, [[id["TEKNO_İZTAŞ"], id["2KX"], id["İZTAŞ"]]]); // canlıdaki gibi ana firması boş
  await q(`DELETE FROM subcon_takma_ad WHERE subcon_id = ANY($1)`, [Object.values(id)]).catch(() => {});
  // Ekipler (firma bağı ekipler.firma_id)
  await q(`UPDATE ekipler SET firma_id = $1 WHERE ekip_no = 302`, [id.TEKNO_EMRAH]);
  await q(`INSERT INTO ekipler (ekip_no, ad, bolge, plaka, ekip_turu, firma_id, aktif) VALUES (303, 'Emrah Ekip 2', 'Bursa', '16EM303', 'DIS', $1, true)`, [id.TEKNO_EMRAH]);
  await q(`INSERT INTO ekipler (ekip_no, ad, bolge, plaka, ekip_turu, firma_id, aktif) VALUES (311, '2KX Ekip 1', 'Bursa', '16KX311', 'DIS', $1, true)`, [id.TEKNO_2KX]);
  await q(`INSERT INTO ekipler (ekip_no, ad, bolge, plaka, ekip_turu, firma_id, aktif) VALUES (321, 'İztaş Ekip 1', 'Bursa', '16IZ321', 'DIS', $1, true)`, [id["TEKNO_İZTAŞ"]]);
  // Taşeron hesapları
  // Hesaplar silinmeden güncellenir: kimlik (users.id) sabit kalır — sunucunun e-posta → kimlik önbelleği eski kimliğe düşmesin
  const kul = async (ad, e, firma, marka) => {
    const v = [ad, e, h, marka, firma, id[firma]];
    const u = await q(`UPDATE users SET name = $1, password_hash = $3, role = 'subcon', is_active = true, tenant = 'erc', status = 'active', marka = $4, subcon_name = $5,
      kullanici_tipi = 'TASERON', taseron_id = $6 WHERE email = $2 RETURNING id`, v);
    if (u.rows[0]) return u.rows[0].id;
    return (await q(`INSERT INTO users (name, email, password_hash, role, is_active, tenant, status, marka, subcon_name, kullanici_tipi, taseron_id)
      VALUES ($1,$2,$3,'subcon',true,'erc','active',$4,$5,'TASERON',$6) RETURNING id`, v)).rows[0].id;
  };
  const uye = (uid, firma, rol, ekip) => q(`INSERT INTO taseron_saha_uye (user_id, taseron_id, ekip_no, rol, ekleyen) VALUES ($1,$2,$3,$4,'tohum')`, [uid, id[firma], ekip, rol]);
  await uye(await kul("Emrah Sorumlu", E.emrahSorumlu, "TEKNO_EMRAH", "TEKNO"), "TEKNO_EMRAH", "SORUMLU", null);
  await uye(await kul("Emrah Çalışan Bir", E.emrahCalisan1, "TEKNO_EMRAH", "TEKNO"), "TEKNO_EMRAH", "CALISAN", 302);
  await uye(await kul("Emrah Çalışan İki", E.emrahCalisan2, "TEKNO_EMRAH", "TEKNO"), "TEKNO_EMRAH", "CALISAN", 303);
  await kul("Emrah Firma Hesabı", E.emrahVarsayilan, "TEKNO_EMRAH", "TEKNO"); // üyelik satırı yok → firma geneli
  await uye(await kul("Emrah Ekipsiz", E.emrahEkipsiz, "TEKNO_EMRAH", "TEKNO"), "TEKNO_EMRAH", "CALISAN", null);
  await kul("2KX Tekno Sorumlu", E.ikikx, "TEKNO_2KX", "TEKNO");
  await uye(await kul("İztaş Çalışan", E.iztas, "TEKNO_İZTAŞ", "TEKNO"), "TEKNO_İZTAŞ", "CALISAN", 321);
  await kul("Bağımsız 2KX", E.bagimsiz2kx, "2KX", "ERC");
  // Rollout
  for (const k of ["rf_note", "rf_not", "rf_started_date", "rf_finished_date", "onair_date"]) await q(`ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS ${k} ${/date/.test(k) ? "DATE" : "TEXT"}`);
  const rp = (sc, alanlar) => {
    const a = { site_type: sc.includes("NR700") ? "5G" : "LTE", bolge: "Bursa", il: "BURSA", project_code: "56A0TCT", ...alanlar };
    const k = Object.keys(a);
    return q(`INSERT INTO rollout_progress (site_code, ${k.join(", ")}) VALUES ($1, ${k.map((_, i) => `$${i + 2}`).join(", ")})`, [sc, ...k.map((x) => a[x])]);
  };
  await rp("BU8001_NR700", { rf_subcon: "TEKNO_EMRAH", rf_note: "Anahtar muhtarda" });
  await rp("BU8002_NR700", { rf_subcon: "TEKNO_EMRAH" });
  await rp("BU8003_NR700", { rf_subcon: "TEKNO_EMRAH" });
  await rp("BU8004_NR700", { rf_subcon: "TEKNO_2KX" });
  await rp("BU8004_L1800", { rf_subcon: "2KX", rf_note: "GIZLI-NOT-2KX", qc_durum: "NOK" });
  await rp("BU8005_NR700", { rf_subcon: "TEKNO_İZTAŞ" });
  await rp("BU8005_LTE", { rf_subcon: "İZTAŞ", rf_note: "GIZLI-NOT-IZTAS" });
  await rp("BU8006_NR700", { rf_subcon: "Tekno_iztaş " });
  await rp("BU8007_NR700", { rf_subcon: "TEKNO_EMRAH", qc_durum: "OK", installation_actual_start_date: "2026-10-20", installation_actual_end_date: "2026-10-22" });
  await rp("BU8008_NR700", { rf_subcon: "AHY_VEDAT", enh_subcon: "TEKNO_EMRAH", rf_note: "AHY-NOTU", qc_durum: "NOK" });
  await rp("BU8009_NR700", {});
  await rp("BU8010_NR700", { rf_subcon: "TEKNO_EMRAH", qc_durum: "NOK", installation_actual_start_date: "2026-10-25", installation_actual_end_date: "2026-10-27" });
  // Günlük İş kalemi (fiyatlı — yanıtta görünmemeli)
  await q(`INSERT INTO master_works (site_code, site_type, item_code, item_description, subcon_name, unit_price, done_qty) VALUES ('BU8009_NR700','5G','8818000001','Anten montajı','TEKNO_2KX', 99999, 1)`);
  // İş atamaları (montaj — ekipli). ekip_no / taseron_id sunucuda ilk plan / atama isteğinde eklenir; temiz veritabanında önceden açılır
  await q(`ALTER TABLE is_atama ADD COLUMN IF NOT EXISTS ekip_no INTEGER, ADD COLUMN IF NOT EXISTS taseron_id INTEGER`);
  // İş atamaları (montaj — ekipli)
  const at = (sc, ekip, firma) => q(`INSERT INTO is_atama (kategori, site_codes, bolge, personeller, plan_tarihi, atayan_email, atayan_ad, durum, ekip_no, taseron_id)
    VALUES ('NEW_SITE', $1, 'Bursa', '[]'::jsonb, CURRENT_DATE, 'tekno.yonetici@teknocenter.test', 'Tekno Yönetici', 'ATANDI', $2, $3)`, [[sc], ekip, id[firma]]);
  await at("BU8001_NR700", 302, "TEKNO_EMRAH");
  await at("BU8002_NR700", 303, "TEKNO_EMRAH");
  await at("BU8005_NR700", 321, "TEKNO_İZTAŞ");
  // Başka kaynaklı açık sorunlar: bağımsız 2KX'in notu ve Teknocenter iç notu — taşeron yanıtında METNİ görünmemeli
  await q(`INSERT INTO is_fiili_bildirim (site_code, olay, issue_turu, aciklama, bildiren_email, kanal) VALUES ('BU8004_L1800','ISSUE','Eksik malzeme','GIZLI-SORUN-2KX','x@2kx.test','mobil')`);
  await q(`INSERT INTO is_fiili_bildirim (site_code, olay, issue_turu, aciklama, bildiren_email, kanal) VALUES ('BU8004_NR700','ISSUE','Erişim','GIZLI-TEKNO-IC-NOT','tekno.yonetici@teknocenter.test','web')`);
  // Konumlar (BU8003 bilerek konumsuz)
  const kon = (fid, lat, lng) => q(`INSERT INTO saha_konum (fiziksel_id, lat, lng, kaynak, dogruluk, il) VALUES ($1,$2,$3,'TEST','KESIN','BURSA') ON CONFLICT (fiziksel_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, dogruluk = 'KESIN'`, [fid, lat, lng]);
  await kon("BU8001", 40.21, 29.05); await kon("BU8002", 40.19, 29.11); await kon("BU8004", 40.25, 28.95); await kon("BU8005", 40.15, 29.2);
  await kon("BU8006", 40.17, 29.0); await kon("BU8007", 40.23, 29.15); await kon("BU8008", 40.2, 28.9); await kon("BU8009", 40.28, 29.02); await kon("BU8010", 40.12, 29.08);
  await c.end();
  console.log("taşeron saha tohum tamam");
})().catch((e) => { console.error(e); process.exit(1); });
