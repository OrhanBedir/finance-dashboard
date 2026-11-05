// YALNIZ YEREL: Taşeron "Hakediş ve Cari" + "Yaptığımız Sahalar" testi için kurgu (gerçek kişi / firma verisi YOK).
// taseron_saha_tohum.js'ten SONRA, backend açıkken çalıştırılır. Yalnız 127.0.0.1 "omnix_test" veritabanına yazar.
// Kurgu (TEKNO_EMRAH hakediş esaslı, faturasız):
//   BU8101_NR700  antensiz Co-Located, montaj 31.10 başladı → ESKİ paket (25.000) · Rollout RF sütununda yalnız grup adı "TEKNO"
//   BU8102_NR700  NR700 antensiz, montaj 01.11 → 01.11 tarifesi (31.000) · QC NOK
//   BU8102_NR3500 aynı fiziksel saha, ikinci iş · fiyatı tanımsız → "Fiyat doğrulanamadı" · montaj başladı, bitiş yok, fiziki 1 → teyit
//   BU8103_NR700  yalnız plan (PR 1, fiziki 0, tarih yok) → listede yok, bedel yok
//   BU8104_NR700  antenli NR700, kısmi fiziki 0,5 → 17.500 · montaj devam
//   BU8105_NS     Smart QC "Executing", montaj kanıtı yok → "QC başladı — montaj teyit bekliyor"
//   Ödemeler: avans 40.000 (20.10) + 100.000 (29.10, bağlı marka satırıyla — tek sayılır) + 10.000 (04.11) + İPTAL 5.000 (sayılmaz)
//   TEKNO_2KX (başka firma): 1 iş 25.000, ödeme 10.000 → "Firmanıza ödenecek 15.000"; EMRAH ekranında görünmemeli
// Çalıştırma: NODE_PATH=<backend>/node_modules node test/yerel/taseron_cari_tohum.js
const { Client } = require("pg");
const bcrypt = require("bcrypt");
const SIFRE = "Omnix-Test-2026";
const KODLAR = ["BU8101_NR700", "BU8102_NR700", "BU8102_NR3500", "BU8103_NR700", "BU8104_NR700", "BU8105_NS_MWA", "BU8201_NR700"];

(async () => {
  const c = new Client({ host: "127.0.0.1", port: 55432, user: "postgres", database: "omnix_test" });
  if (c.host !== "127.0.0.1" || c.database !== "omnix_test") throw new Error("Yalnız yerel test veritabanı!");
  await c.connect();
  const q = (s, p) => c.query(s, p);
  const id = Object.fromEntries((await q(`SELECT id, subcon_name FROM subcons WHERE subcon_name IN ('TEKNO_EMRAH','TEKNO_2KX')`)).rows.map((r) => [r.subcon_name, r.id]));
  if (!id.TEKNO_EMRAH || !id.TEKNO_2KX) throw new Error("Önce taseron_saha_tohum.js çalıştırın");
  // Yerel temel şemada olmayan fatura / ortak ödeme tabloları (cari motoru okur) — asgari kolonlar
  await q(`CREATE TABLE IF NOT EXISTS invoice_entries (id SERIAL PRIMARY KEY, fatura_no TEXT, fatura_tarihi DATE, vade_tarihi DATE, created_at TIMESTAMPTZ DEFAULT now(),
    tedarikci TEXT, rf_montaj_firma TEXT, tedarikci_id INTEGER, tutar NUMERIC, kdv NUMERIC, toplam_tutar NUMERIC, odenen_tutar NUMERIC, kalan_borc NUMERIC, currency TEXT,
    fatura_turu TEXT, bagli_fatura_id INTEGER, is_kalemi TEXT, belge_path TEXT, note TEXT, firma TEXT, odeme_tarihi DATE)`);
  await q(`CREATE TABLE IF NOT EXISTS fatura_arac_kalem (id SERIAL PRIMARY KEY, fatura_id INTEGER)`);
  await q(`CREATE TABLE IF NOT EXISTS odeme_kayit (id SERIAL PRIMARY KEY, tarih DATE, durum TEXT DEFAULT 'AKTIF')`);
  await q(`CREATE TABLE IF NOT EXISTS odeme_dagilim (id SERIAL PRIMARY KEY, odeme_id INTEGER, fatura_id INTEGER, tutar NUMERIC)`);
  await q(`CREATE TABLE IF NOT EXISTS fatura_saha_kalem (id SERIAL PRIMARY KEY, fatura_id INTEGER, site_code TEXT, kalem_adi TEXT, miktar NUMERIC, birim TEXT, tutar NUMERIC)`);
  await q(`CREATE TABLE IF NOT EXISTS bolge_fatura (id SERIAL PRIMARY KEY, site_code TEXT, item_code TEXT, taseron_adi TEXT, fatura_no TEXT)`);
  // Temizlik (yalnız bu kurgunun kayıtları)
  for (const t of ["is_fiili_bildirim", "taseron_saha_bildirim"]) await q(`DELETE FROM ${t} WHERE site_code = ANY($1)`, [KODLAR]).catch(() => {});
  await q(`DELETE FROM rollout_progress WHERE site_code = ANY($1)`, [KODLAR]);
  await q(`DELETE FROM master_works WHERE site_code = ANY($1)`, [KODLAR]);
  await q(`ALTER TABLE rollout_is_kolu ADD COLUMN IF NOT EXISTS site_code TEXT, ADD COLUMN IF NOT EXISTS is_kolu TEXT, ADD COLUMN IF NOT EXISTS hw_status TEXT, ADD COLUMN IF NOT EXISTS aktif BOOLEAN DEFAULT true`);
  await q(`DELETE FROM rollout_is_kolu WHERE site_code = ANY($1)`, [KODLAR]);
  await q(`DELETE FROM taseron_fiyat WHERE UPPER(firma_kod) = 'TEKNO'`);
  await q(`DELETE FROM marka_taseron_odeme WHERE tedarikci_id = ANY($1)`, [[id.TEKNO_EMRAH, id.TEKNO_2KX]]);
  await q(`DELETE FROM taseron_odeme_log WHERE tedarikci_id = ANY($1)`, [[id.TEKNO_EMRAH, id.TEKNO_2KX]]);
  await q(`UPDATE subcons SET cari_modeli = 'HAKEDIS', gorunen_ad = subcon_name WHERE id = ANY($1)`, [[id.TEKNO_EMRAH, id.TEKNO_2KX]]);
  // Teknocenter muhasebe (yönetim tarafı karşılaştırması için; alt marka TEKNO → kendi firmasının carisini görür)
  const h = await bcrypt.hash(SIFRE, 8);
  const m = await q(`UPDATE users SET password_hash = $2, role = 'muhasebe', marka = 'TEKNO', is_active = true, tenant = 'erc', status = 'active' WHERE email = $1 RETURNING id`, ["tekno.muhasebe@teknocenter.test", h]);
  if (!m.rows[0]) await q(`INSERT INTO users (name, email, password_hash, role, is_active, tenant, status, marka) VALUES ('Tekno Muhasebe', $1, $2, 'muhasebe', true, 'erc', 'active', 'TEKNO')`, ["tekno.muhasebe@teknocenter.test", h]);
  // Fiyatlar: firma geneli 01.11.2026 tarifesi (seçili kalemler) + EMRAH'a özel eski paket (01.09–31.10)
  const fiyat = (kod, f, bas, bit, tid, ack) => q(`INSERT INTO taseron_fiyat (firma_kod, tedarikci_id, item_code, aciklama, birim, birim_fiyat, para_birimi, gecerlilik_bas, gecerlilik_bit, kaynak, olusturan)
    VALUES ('TEKNO',$1,$2,$3,'Saha',$4,'TRY',$5,$6,'yerel test','tohum')`, [tid, kod, ack, f, bas, bit]);
  await fiyat("8818274542", 25000, "2026-11-01", null, null, "Co-Located kurulum – anten revizyonu hariç");
  await fiyat("8812489291", 31000, "2026-11-01", null, null, "NR700 band ilavesi – anten revizyonu hariç");
  await fiyat("8812489289", 35000, "2026-11-01", null, null, "NR700 band ilavesi – anten revizyonu dahil");
  await fiyat("PAKET_ANTENSIZ", 25000, "2026-09-01", "2026-10-31", id.TEKNO_EMRAH, "Antensiz paket");
  await fiyat("PAKET_ANTENLI", 30000, "2026-09-01", "2026-10-31", id.TEKNO_EMRAH, "Antenli paket");
  // Günlük İş kalemleri (unit_price = Huawei fiyatı; taşeron yanıtında görünmemeli)
  const mw = (sc, kod, ack, firma, pr, fiz, qc) => q(`INSERT INTO master_works (site_code, site_type, item_code, item_description, subcon_name, unit_price, done_qty, tamamlanan_qty, qc_durum)
    VALUES ($1,'5G',$2,$3,$4,77777,$5,$6,$7)`, [sc, kod, ack, firma, pr, fiz, qc]);
  await mw("BU8101_NR700", "8818274542", "Co-Located Site without Antenna Revision Work ,per site", "TEKNO_EMRAH", 1, 1, "OK");
  await mw("BU8101_NR700", "8812184863", "Supply 3M Brand Marking Label ,per Pcs", "TEKNO_EMRAH", 3, 3, "OK");
  await mw("BU8102_NR700", "8812489291", "NR700 band addition without antenna revision works, per site", "TEKNO_EMRAH", 1, 1, "NOK");
  await mw("BU8102_NR3500", "8812489285", "NR3500 band addition with AAU, per site", "TEKNO_EMRAH", 1, 1, "NOK");
  await mw("BU8103_NR700", "8812489289", "NR700 band addition with antenna Revision works, per site", "TEKNO_EMRAH", 1, null, "NOK");
  await mw("BU8104_NR700", "8812489289", "NR700 band addition with antenna Revision works, per site", "TEKNO_EMRAH", 1, 0.5, "NOK");
  await mw("BU8201_NR700", "8818274542", "Co-Located Site without Antenna Revision Work ,per site", "TEKNO_2KX", 1, 1, "OK");
  // Rollout
  const rp = (sc, a) => { const k = Object.keys(a); return q(`INSERT INTO rollout_progress (site_code, site_type, bolge, il, project_code, ${k.join(", ")}) VALUES ($1,'5G','Ankara','BARTIN','56A0TCT', ${k.map((_, i) => `$${i + 2}`).join(", ")})`, [sc, ...k.map((x) => a[x])]); };
  await rp("BU8101_NR700", { rf_subcon: "TEKNO", installation_actual_start_date: "2026-10-31", installation_actual_end_date: "2026-11-01", qc_durum: "OK", qc_closed_date: "2026-11-02" });
  await rp("BU8102_NR700", { rf_subcon: "TEKNO_EMRAH", installation_actual_start_date: "2026-11-01", installation_actual_end_date: "2026-11-03", qc_durum: "NOK" });
  await rp("BU8102_NR3500", { rf_subcon: "TEKNO_EMRAH", installation_actual_start_date: "2026-11-02" });
  await rp("BU8103_NR700", { rf_subcon: "TEKNO_EMRAH" });
  await rp("BU8104_NR700", { rf_subcon: "TEKNO_EMRAH", installation_actual_start_date: "2026-11-03", qc_durum: "NOK" });
  await rp("BU8105_NS_MWA", { rf_subcon: "TEKNO_EMRAH", qc_durum: "NOK" });
  await rp("BU8201_NR700", { rf_subcon: "TEKNO_2KX", installation_actual_start_date: "2026-11-02", installation_actual_end_date: "2026-11-02", qc_durum: "OK", qc_closed_date: "2026-11-03" });
  await q(`INSERT INTO rollout_is_kolu (site_code, is_kolu, hw_status, aktif) VALUES ('BU8105_NS_MWA','NS_AI','Executing',true)`);
  // Ödemeler (taseron_odeme_log; 29.10 ödemesinin bağlı marka satırı var → tek hareket)
  const od = async (firma, tid, tutar, tarih, durum = "AKTIF", ack = null) => (await q(`INSERT INTO taseron_odeme_log (firma, tedarikci_id, tutar, tarih, avans_tutar, islem_turu, durum, firma_kod, aciklama, dagilim)
    VALUES ($1,$2,$3,$4,$3,'AVANS',$5,'TEKNO',$6,'[]'::jsonb) RETURNING id`, [firma, tid, tutar, tarih, durum, ack])).rows[0].id;
  await od("TEKNO_EMRAH", id.TEKNO_EMRAH, 40000, "2026-10-20", "AKTIF", "Taşeron avans");
  const l2 = await od("TEKNO_EMRAH", id.TEKNO_EMRAH, 100000, "2026-10-29", "AKTIF", "Taşeron avans");
  await q(`INSERT INTO marka_taseron_odeme (marka, taseron_adi, tedarikci_id, tip, tutar, tarih, durum, odeme_log_id) VALUES ('TEKNO','TEKNO_EMRAH',$1,'AVANS',100000,'2026-10-29','AKTIF',$2)`, [id.TEKNO_EMRAH, l2]);
  await od("TEKNO_EMRAH", id.TEKNO_EMRAH, 10000, "2026-11-04");
  await od("TEKNO_EMRAH", id.TEKNO_EMRAH, 5000, "2026-11-04", "IPTAL", "Hatalı giriş");
  await od("TEKNO_2KX", id.TEKNO_2KX, 10000, "2026-11-03", "AKTIF", "2KX avans");
  await c.end();
  console.log("taşeron cari tohum tamam");
})().catch((e) => { console.error(e); process.exit(1); });
