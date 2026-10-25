// Şirket yönetimi + taşeron profilleri testi (25.10.2026) — YALNIZ yerel test sunucusu (127.0.0.1:5099, sahte veri).
// Hesaplar: Şimşek personeli, Teknocenter personeli, Teknocenter şirket sahibi, maaş izni olmayan yönetici, Taşeron A ve B,
// taşeron bağlantısı eksik hesap, Teknocenter alt marka yöneticisi, Nurcan (atama yetkilisi). Hepsi sahte.
// Çalıştırma: YEREL_API=http://127.0.0.1:5099 NODE_PATH=../backend/node_modules node --test test/yerel/profil.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const API = process.env.YEREL_API;
const SIFRE = "Omnix-Test-2026";
if (!API || !/^http:\/\/127\.0\.0\.1:/.test(API)) { console.log("YEREL_API tanımlı değil — atlandı"); process.exit(0); }
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const bcrypt = require("bcrypt");
const MIGRATION = readFileSync(new URL("../../../backend/migrations/2026-10-23_fatura_saha_kalem.sql", import.meta.url), "utf8");

async function cagir(token, yol, { method = "GET", govde } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (govde !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(API + yol, { method, headers: h, body: govde !== undefined ? JSON.stringify(govde) : undefined, redirect: "manual" });
  const metin = await r.text();
  let veri; try { veri = JSON.parse(metin); } catch { veri = { _ham: metin.slice(0, 80) }; }
  return { s: r.status, v: veri, konum: r.headers.get("location") };
}
const giris = async (e) => {
  const r = await cagir(null, "/auth/login", { method: "POST", govde: { email: e, password: SIFRE } });
  assert.equal(r.s, 200, `${e} giriş: ${JSON.stringify(r.v)}`);
  return r.v.token;
};

const t = {}, id = {};
let db;
test.before(async () => {
  db = new Client({ host: "127.0.0.1", port: 55432, user: "postgres", database: "omnix_test" });
  await db.connect();
  const q = (s, p) => db.query(s, p);
  // Yerel şemada olmayan (canlıda var olan) tablolar — asgari kolonlarla, yalnız omnix_test'te
  await q(`CREATE TABLE IF NOT EXISTS master_works (id SERIAL PRIMARY KEY, site_type TEXT, project_code TEXT, site_code TEXT, item_code TEXT, item_description TEXT,
    done_qty NUMERIC, tamamlanan_qty NUMERIC, subcon_name TEXT, qc_durum TEXT DEFAULT 'NOK', bolge TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS po_rows (id SERIAL PRIMARY KEY, site_code TEXT, item_code TEXT, unit_price NUMERIC)`);
  await q(`CREATE TABLE IF NOT EXISTS invoice_entries (id SERIAL PRIMARY KEY, fatura_no TEXT, fatura_tarihi DATE, tedarikci TEXT, rf_montaj_firma TEXT, site_id TEXT,
    toplam_tutar NUMERIC, odenen_tutar NUMERIC DEFAULT 0, kalan_borc NUMERIC, currency TEXT, fatura_turu TEXT, odeme_tarihi DATE)`);
  await q(`CREATE TABLE IF NOT EXISTS bolge_fatura (id SERIAL PRIMARY KEY, taseron_adi TEXT NOT NULL, site_code TEXT NOT NULL, item_code TEXT, item_description TEXT,
    fatura_no TEXT, fatura_tarihi DATE, fatura_miktari NUMERIC(18,2) DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
  await q(MIGRATION);
  await q(`ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS qc_durum TEXT`).catch(() => {});
  await q(`DELETE FROM rollout_progress WHERE site_code IN ('IZ7001','IZ7002')`);
  await q(`INSERT INTO rollout_progress (project_code, site_code, site_type, bolge, tssr_belge_url, qc_durum) VALUES
    ('TC', 'IZ7001', 'Standalone', 'İzmir', 'http://127.0.0.1:5098/belge/tssr-iz7001.pdf', 'NOK'), ('TC', 'IZ7002', 'Standalone', 'İzmir', NULL, 'OK')`);
  await q(`DELETE FROM master_works WHERE site_code IN ('IZ7001','IZ7002')`);
  await q(`DELETE FROM invoice_entries WHERE fatura_no LIKE 'PRF-%'`);
  await q(`DELETE FROM taseron_odeme_log WHERE firma IN ('TASERON_A','TASERON_B')`);
  await q(`DELETE FROM is_atama WHERE site_codes && ARRAY['IZ7001','IZ7002']`);

  // Sunucunun açılıştaki "AHY kullanıcısı yoksa saha ekibini AHY'ye taşı" göçü yerelde sahte hesapları taşıyabiliyor:
  // tohum hesaplarının firma/rolünü sabitle (yalnız yerel)
  await q(`UPDATE users SET marka='ERC', role='user' WHERE email='saha.user@simsektel.com'`);
  await q(`UPDATE users SET marka='ERC', role='admin' WHERE email='orhan.bedir@simsektel.com'`);
  await q(`UPDATE users SET marka='TEKNO', role='user' WHERE email='tekno.saha@teknocenter.test'`);
  await q(`UPDATE personel SET marka='ERC' WHERE email IN ('saha.user@simsektel.com','orhan.bedir@simsektel.com')`);
  await q(`UPDATE personel SET marka='TEKNO' WHERE email='tekno.saha@teknocenter.test'`);
  const h = await bcrypt.hash(SIFRE, 8);
  const kul = async (ad, e, rol, marka, ek = {}) => {
    await q(`DELETE FROM users WHERE email=$1`, [e]);
    const r = await q(`INSERT INTO users (name,email,password_hash,role,is_active,tenant,status,marka,subcon_name,kullanici_tipi,taseron_id,yonetim_profili,yetki_ayar)
      VALUES ($1,$2,$3,$4,true,'erc','active',$5,$6,$7,$8,$9,$10) RETURNING id`, [ad, e, h, rol, marka, ek.subcon || null, ek.tip || null, ek.taseron || null, ek.profil || null, ek.yetki ? JSON.stringify(ek.yetki) : null]);
    return r.rows[0].id;
  };
  // Taşeron kayıtları (kalıcı kimlik subcons.id) — A'nın kayıtlarda geçen ikinci yazımı takma ad olarak
  for (const ad of ["TASERON_A", "TASERON_B"]) await q(`INSERT INTO subcons (subcon_name) VALUES ($1) ON CONFLICT (subcon_name) DO NOTHING`, [ad]);
  const s = await q(`SELECT id, subcon_name FROM subcons WHERE subcon_name IN ('TASERON_A','TASERON_B')`);
  for (const r of s.rows) id[r.subcon_name] = r.id;
  await q(`UPDATE subcons SET unvan = CASE subcon_name WHEN 'TASERON_A' THEN 'A Telekom Ltd. Şti.' ELSE 'B Montaj A.Ş.' END, ana_firma = 'ERC', aktif = true WHERE id = ANY($1)`, [[id.TASERON_A, id.TASERON_B]]);
  await q(`DELETE FROM subcon_takma_ad WHERE subcon_id = ANY($1)`, [[id.TASERON_A, id.TASERON_B]]);

  id.sahip = await kul("İlhami Test", "sahip.tekno@teknocenter.test", "user", "TEKNO");
  id.yonetici = await kul("Yönetici Test", "yonetici.tekno@teknocenter.test", "user", "TEKNO", { profil: "YONETICI" });
  id.taseronA = await kul("A Saha Sorumlusu", "a@taseron-a.test", "subcon", "ERC");
  id.taseronA2 = await kul("A Muhasebe", "a2@taseron-a.test", "subcon", "ERC");
  id.taseronB = await kul("B Saha Sorumlusu", "b@taseron-b.test", "subcon", "ERC");
  id.eksik = await kul("Bağsız Taşeron", "eksik@taseron.test", "subcon", "ERC", { subcon: "TASERON_A", tip: "TASERON" });
  id.eski = await kul("Eski Taşeron", "eski@taseron.test", "subcon", "ERC", { subcon: "TASERON_A" }); // eski tip hesap (kullanici_tipi yok)
  id.teknoAdmin = await kul("Tekno Yönetici", "admin@teknocenter.test", "admin", "TEKNO");
  id.nurcan = await kul("Nurcan Test", "nurcan.kus@simsektel.com", "user", "ERC");
  // Teknocenter personeli (maaş + puantaj + maaş ödemesi) — İlhami'nin firma kapsamında
  await q(`DELETE FROM personel WHERE email = 'tekno.usta@teknocenter.test'`);
  id.teknoPersonel = (await q(`INSERT INTO personel (ad_soyad, email, unvan, bolge, aktif, marka, firma_tipi, net_maas) VALUES ('Ali Usta','tekno.usta@teknocenter.test','Teknisyen','İzmir',true,'TEKNO','simsek',42000) RETURNING id`)).rows[0].id;
  await q(`INSERT INTO puantaj (personel_id, tarih, durum, fazla_mesai_saat) VALUES ($1, date_trunc('month', now())::date, 'CALISDI', 2), ($1, date_trunc('month', now())::date + 1, 'GELMEDI', 0)`, [id.teknoPersonel]);
  await q(`INSERT INTO maas_odeme (personel_id, donem, bankadan, elden, tarih) VALUES ($1, to_char(now(), 'YYYY-MM'), 30000, 12000, now()::date)`, [id.teknoPersonel]);
  id.ahmetPersonel = (await q(`SELECT id FROM personel WHERE email='saha.user@simsektel.com'`)).rows[0].id;
  id.ahmetUser = (await q(`SELECT id FROM users WHERE email='saha.user@simsektel.com'`)).rows[0].id;
  id.orhanUser = (await q(`SELECT id FROM users WHERE email='orhan.bedir@simsektel.com'`)).rows[0].id;

  for (const [k, e] of Object.entries({ orhan: "orhan.bedir@simsektel.com", ahmet: "saha.user@simsektel.com", mehmet: "tekno.saha@teknocenter.test",
    sahip: "sahip.tekno@teknocenter.test", yonetici: "yonetici.tekno@teknocenter.test", taseronA: "a@taseron-a.test", taseronA2: "a2@taseron-a.test",
    taseronB: "b@taseron-b.test", eksik: "eksik@taseron.test", eski: "eski@taseron.test", teknoAdmin: "admin@teknocenter.test", nurcan: "nurcan.kus@simsektel.com" }))
    t[k] = await giris(e);
});
test.after(async () => { await db?.end(); });

test("admin: taşeron kullanıcısı listeden seçilen taşerona bağlanır; serbest metin / pasif / yanlış firma reddedilir", async () => {
  const liste = await cagir(t.orhan, "/admin/taseronlar");
  assert.equal(liste.s, 200);
  assert.ok(liste.v.rows.some((x) => x.id === id.TASERON_A));
  for (const [kim, tid] of [["taseronA", id.TASERON_A], ["taseronA2", id.TASERON_A], ["taseronB", id.TASERON_B]]) {
    const r = await cagir(t.orhan, `/admin/users/${id[kim]}`, { method: "PUT", govde: { kullanici_tipi: "TASERON", taseron_id: tid, marka: "ERC" } });
    assert.equal(r.s, 200, JSON.stringify(r.v));
    assert.equal(r.v.user.role, "subcon");
  }
  assert.equal((await cagir(t.orhan, `/admin/users/${id.eski}`, { method: "PUT", govde: { kullanici_tipi: "TASERON" } })).s, 400, "taşeron seçimi zorunlu");
  assert.equal((await cagir(t.orhan, `/admin/users/${id.eski}`, { method: "PUT", govde: { kullanici_tipi: "TASERON", taseron_id: 999999 } })).s, 400, "listede olmayan taşeron");
  assert.equal((await cagir(t.orhan, `/admin/users/${id.eski}`, { method: "PUT", govde: { kullanici_tipi: "TASERON", taseron_id: id.TASERON_A, marka: "TEKNO" } })).s, 400, "taşeron başka ana firmanın");
  // Takma ad: A'nın faturalarda geçen eski yazımı — yalnız tam eşleşme; aynı ad ikinci taşerona verilemez
  assert.equal((await cagir(t.orhan, `/admin/taseronlar/${id.TASERON_A}/takma-ad`, { method: "POST", govde: { ad: "A TELEKOM LTD" } })).s, 200);
  assert.equal((await cagir(t.orhan, `/admin/taseronlar/${id.TASERON_B}/takma-ad`, { method: "POST", govde: { ad: "a telekom ltd" } })).s, 409);
});

test("admin: şirket sahibi profilini yalnız merkez yönetici verir; kendini yükseltme ve alt marka kapsam aşımı yok", async () => {
  assert.equal((await cagir(t.teknoAdmin, `/admin/users/${id.sahip}`, { method: "PUT", govde: { yonetim_profili: "SAHIP" } })).s, 403, "alt marka yöneticisi sahip atayamaz");
  const r = await cagir(t.orhan, `/admin/users/${id.sahip}`, { method: "PUT", govde: { kullanici_tipi: "IC", yonetim_profili: "SAHIP" } });
  assert.equal(r.s, 200, JSON.stringify(r.v));
  assert.equal((await cagir(t.sahip, `/admin/users/${id.sahip}`, { method: "PUT", govde: { yonetim_profili: "PERSONEL" } })).s, 403);
  assert.equal((await cagir(t.orhan, `/admin/users/${id.orhanUser}`, { method: "PUT", govde: { yonetim_profili: "SAHIP" } })).s, 403, "kendi profilini değiştiremez");
  const lst = await cagir(t.teknoAdmin, "/admin/users");
  assert.equal(lst.s, 200);
  assert.ok(lst.v.users.every((u) => ["TEKNO", "AHY"].includes(String(u.marka || "ERC").toUpperCase())), "Teknocenter yöneticisi ERC kullanıcılarını görmemeli");
  assert.equal((await cagir(t.teknoAdmin, `/admin/users/${id.ahmetUser}`, { method: "PUT", govde: { role: "admin" } })).s, 403, "başka firmanın kullanıcısı");
  assert.equal((await cagir(t.teknoAdmin, `/admin/users/${id.ahmetUser}/yetkiler`, { method: "PUT", govde: { yetki_ayar: { maas_goruntule: true } } })).s, 403);
  assert.equal((await cagir(t.teknoAdmin, `/admin/users/${id.yonetici}/marka`, { method: "PUT", govde: { marka: "ERC" } })).s, 403, "başka firmaya taşıyamaz");
  // "aynı e-postayla yeniden ekle" ile hesap ele geçirme kapalı
  const ele = await cagir(t.teknoAdmin, "/admin/users", { method: "POST", govde: { name: "X", email: "orhan.bedir@simsektel.com", password: "Yeni-Sifre-1", role: "user" } });
  assert.equal(ele.s, 403, JSON.stringify(ele.v));
  assert.equal((await cagir(null, "/auth/login", { method: "POST", govde: { email: "orhan.bedir@simsektel.com", password: SIFRE } })).s, 200, "orhan'ın şifresi değişmemiş olmalı");
  const me = await cagir(t.sahip, "/auth/me");
  assert.equal(me.v.user.yonetim_profili, "SAHIP");
  assert.equal(me.v.user.izinler?.maas_goruntule, true);
});

test("iş atama: Nurcan taşerona fiyatlı atar; aynı sahada farklı taşeron fiyatları birbirine sızmaz; revizyon sürümlü", async () => {
  const fiyat = (bf) => ({ para_birimi: "TRY", kdv_esasi: "HARIC", kalemler: [{ kalem_kodu: "IT-SRV", aciklama: "Site survey", miktar: 1, birim: "Adet", birim_fiyat: bf }] });
  assert.equal((await cagir(t.nurcan, "/is-atama", { method: "POST", govde: { kategori: "SURVEY", site_codes: ["IZ7001"], taseron_id: id.TASERON_A,
    fiyat: { ...fiyat(0) } } })).s, 400, "sıfır fiyat kabul edilmez");
  const a = await cagir(t.nurcan, "/is-atama", { method: "POST", govde: { kategori: "SURVEY", site_codes: ["IZ7001"], taseron_id: id.TASERON_A, fiyat: fiyat(1000), plan_tarihi: "2026-10-28", atayan_not: "Anahtar ofiste" } });
  assert.equal(a.s, 200, JSON.stringify(a.v));
  id.isA = a.v.row.id;
  assert.equal(a.v.row.fiyat_surumleri, undefined, "fiyat iş detayının ortak gövdesinde yok");
  const b = await cagir(t.nurcan, "/is-atama", { method: "POST", govde: { kategori: "SURVEY", site_codes: ["IZ7001"], taseron_id: id.TASERON_B, fiyat: fiyat(1500) } });
  assert.equal(b.s, 200);
  id.isB = b.v.row.id;
  const la = await cagir(t.taseronA, "/taseron-panel/isler");
  assert.equal(la.s, 200);
  assert.deepEqual(la.v.rows.map((x) => x.id), [id.isA], "A yalnız kendi işini görür");
  assert.equal(la.v.rows[0].fiyat.toplam, 1000);
  assert.ok(!JSON.stringify(la.v).includes("1500"), "B'nin fiyatı A'ya sızmamalı");
  assert.equal((await cagir(t.taseronA, `/taseron-panel/isler/${id.isB}`)).s, 404, "başka taşeronun işi");
  assert.equal((await cagir(t.taseronA2, "/taseron-panel/isler")).v.rows.length, 1, "aynı taşerona bağlı ikinci kullanıcı da görür");
  // Revizyon: neden zorunlu, yeni sürüm; taşeron fiyatı değiştiremez
  assert.equal((await cagir(t.nurcan, `/is-atama/${id.isA}/fiyat`, { method: "PUT", govde: { fiyat: fiyat(1100) } })).s, 400);
  assert.equal((await cagir(t.nurcan, `/is-atama/${id.isA}/fiyat`, { method: "PUT", govde: { fiyat: fiyat(1100), neden: "Ek ölçüm" } })).v.surum, 2);
  assert.equal((await cagir(t.taseronA, `/is-atama/${id.isA}/fiyat`, { method: "PUT", govde: { fiyat: fiyat(5000), neden: "x" } })).s, 403);
  const d = await cagir(t.taseronA, `/taseron-panel/isler/${id.isA}`);
  assert.equal(d.v.row.fiyat.toplam, 1100);
  assert.equal(d.v.row.fiyat_gecmisi.length, 2);
  assert.equal(d.v.row.fiyat_gecmisi[1].neden, "Ek ölçüm");
  const oneri = await cagir(t.nurcan, `/is-atama/fiyat-oneri?taseron_id=${id.TASERON_B}`);
  assert.ok(oneri.v.rows.every((x) => x.birim_fiyat === 1500), "öneri yalnız aynı taşeronun anlaşılmış fiyatı");
  const yon = await cagir(t.nurcan, `/is-atama/${id.isA}`);
  assert.equal(yon.v.row.fiyat_surumleri.length, 2, "atama yetkilisi fiyat geçmişini görür");
});

test("belge: taşeron yalnız kendi işinin teknik belgesine sunucu doğrulamasıyla ulaşır", async () => {
  const d = await cagir(t.taseronA, `/taseron-panel/isler/${id.isA}`);
  assert.ok(d.v.row.belgeler.some((b) => b.alan === "tssr_belge_url"));
  assert.ok(d.v.row.belgeler.every((b) => !("url" in b)), "adres listede verilmez");
  const ok = await cagir(t.taseronA, `/taseron-panel/isler/${id.isA}/belge?site=IZ7001&alan=tssr_belge_url&sira=0`);
  assert.equal(ok.s, 302);
  assert.equal((await cagir(t.taseronB, `/taseron-panel/isler/${id.isA}/belge?site=IZ7001&alan=tssr_belge_url&sira=0`)).s, 404);
  assert.equal((await cagir(t.taseronA, `/taseron-panel/isler/${id.isA}/belge?site=IZ7001&alan=enh_perakende_dekont_url&sira=0`)).s, 404, "müşteri ödeme belgesi verilmez");
});

test("hakediş: tamamlanan iş QC bekliyorken kesin gösterilmez; QC OK olunca uygun tutara geçer", async () => {
  assert.equal((await cagir(t.taseronA, `/is-atama/${id.isA}/basla`, { method: "POST", govde: {} })).s, 200, "taşeron kendi işini başlatır");
  assert.equal((await cagir(t.taseronB, `/is-atama/${id.isA}/basla`, { method: "POST", govde: {} })).s, 403, "başkasının işi");
  const bit = await cagir(t.taseronA, `/is-atama/${id.isA}/bitir`, { method: "POST", govde: { tamamlandi: true, not: "Bitti" } });
  assert.equal(bit.s, 200, JSON.stringify(bit.v));
  await db.query(`INSERT INTO master_works (project_code, site_code, item_code, item_description, done_qty, subcon_name, qc_durum) VALUES ('TC','IZ7001','IT-SRV','Site survey',1,'TASERON_A','NOK')`);
  let h = await cagir(t.taseronA, "/taseron-panel/hakedis");
  assert.equal(h.s, 200);
  assert.equal(h.v.satirlar[0].durum, "QC_BEKLIYOR");
  assert.equal(h.v.toplamlar[0].uygun, 0);
  assert.equal(h.v.toplamlar[0].qc_bekleyen, 1100);
  await db.query(`UPDATE master_works SET qc_durum='OK' WHERE site_code='IZ7001' AND subcon_name='TASERON_A'`);
  h = await cagir(t.taseronA, "/taseron-panel/hakedis");
  assert.equal(h.v.satirlar[0].durum, "UYGUN");
  assert.equal(h.v.toplamlar[0].uygun, 1100);
  assert.equal(h.v.toplamlar[0].uygun_faturalanmayan, 1100);
  assert.match(h.v.satirlar[0].hesap, /1 .*× 1100/);
  assert.equal((await cagir(t.taseronB, "/taseron-panel/hakedis")).v.satirlar.length, 0, "B'nin tamamlanmış işi yok");
});

test("faturalar: web'de girilen fatura ve kısmi ödeme taşeronda aynı kayıttan; saha bağlantısı eksikse belirtilir", async () => {
  const f1 = (await db.query(`INSERT INTO invoice_entries (fatura_no, fatura_tarihi, tedarikci, toplam_tutar, odenen_tutar, kalan_borc, currency)
    VALUES ('PRF-A-1', '2026-10-20', 'TASERON_A', 1320, 500, 820, 'TRY') RETURNING id`)).rows[0].id;
  const f2 = (await db.query(`INSERT INTO invoice_entries (fatura_no, fatura_tarihi, tedarikci, toplam_tutar, odenen_tutar, kalan_borc, currency)
    VALUES ('PRF-A-2', '2026-10-22', 'A TELEKOM LTD', 600, 0, 600, 'TRY') RETURNING id`)).rows[0].id; // takma adla kayıtlı
  const fb = (await db.query(`INSERT INTO invoice_entries (fatura_no, fatura_tarihi, tedarikci, toplam_tutar, odenen_tutar, kalan_borc, currency)
    VALUES ('PRF-B-1', '2026-10-21', 'TASERON_B', 999, 0, 999, 'TRY') RETURNING id`)).rows[0].id;
  await db.query(`INSERT INTO fatura_saha_kalem (fatura_id, site_code, kalem_adi, miktar, birim, tutar) VALUES ($1, 'IZ7001', 'Site survey', 1, 'Adet', 1100)`, [f1]);
  await db.query(`INSERT INTO taseron_odeme_log (firma, tutar, tarih, dagilim) VALUES ('TASERON_A', 500, '2026-10-23', $1)`, [JSON.stringify([{ fatura_no: "PRF-A-1", tutar: 500 }])]);
  const l = await cagir(t.taseronA, "/taseron-panel/faturalar");
  assert.equal(l.s, 200);
  assert.deepEqual(l.v.rows.map((x) => x.fatura_no).sort(), ["PRF-A-1", "PRF-A-2"]);
  assert.equal(l.v.rows.find((x) => x.fatura_no === "PRF-A-1").durum, "KISMI");
  const d1 = await cagir(t.taseronA, `/taseron-panel/faturalar/${f1}`);
  assert.equal(d1.v.sahalar[0].site_code, "IZ7001");
  assert.equal(d1.v.odemeler[0].tutar, 500);
  assert.equal((await cagir(t.taseronA, `/taseron-panel/faturalar/${f2}`)).v.saha_baglantisi_eksik, true);
  assert.equal((await cagir(t.taseronA, `/taseron-panel/faturalar/${fb}`)).s, 404, "B'nin faturası");
  const h = await cagir(t.taseronA, "/taseron-panel/hakedis");
  assert.equal(h.v.toplamlar[0].uygun_faturalanan, 1100, "faturaya bağlı saha faturalanmış sayılır");
  const oz = await cagir(t.taseronA, "/taseron-panel/ozet");
  assert.equal(oz.v.isler.tamamlanan, 1);
  assert.equal(oz.v.faturalar[0].kalan, 1420);
});

test("taşeron kapsamı: bağlantısız / eski hesap tüm veriyi almaz; eski açık uçlar kapalı", async () => {
  for (const k of ["eksik", "eski", "ahmet"]) assert.equal((await cagir(t[k], "/taseron-panel/ozet")).s, 403, k);
  for (const [m, yol] of [["GET", "/taseron/fatura/list"], ["GET", "/is-atama/liste"], ["POST", "/rollout/1/belge-url"]])
    assert.equal((await cagir(t.taseronA, yol, { method: m, govde: m === "POST" ? {} : undefined })).s, 403, `${m} ${yol}`);
  assert.equal((await cagir(t.ahmet, "/taseron/fatura/list")).s, 403, "sıradan personel taşeron faturalarını göremez");
  assert.equal((await cagir(t.taseronA, "/yonetim/personel")).s, 403);
  assert.equal((await cagir(t.taseronA, "/hr/mobile-dashboard")).s !== 500, true);
});

test("yönetim: şirket sahibi kendi firmasını ve izinli maaşı görür; yönetici maaş göremez; personel yönetim uçlarına giremez", async () => {
  const oz = await cagir(t.sahip, "/yonetim/ozet");
  assert.equal(oz.s, 200, JSON.stringify(oz.v));
  assert.equal(oz.v.profil, "SAHIP");
  const l = await cagir(t.sahip, "/yonetim/personel?q=ali");
  assert.equal(l.s, 200);
  assert.deepEqual(l.v.rows.map((x) => x.id), [id.teknoPersonel]);
  const hepsi = await cagir(t.sahip, "/yonetim/personel");
  assert.ok(hepsi.v.rows.every((x) => ["TEKNO", "AHY"].includes(x.firma)), "yalnız kendi firma kapsamı");
  const d = await cagir(t.sahip, `/yonetim/personel/${id.teknoPersonel}`);
  assert.equal(d.s, 200);
  assert.equal(d.v.bolumler.maas.durum, "ok");
  assert.equal(d.v.bolumler.maas.veri.net_maas, 42000);
  assert.equal(d.v.bolumler.maas.veri.odemeler[0].tutar, 42000);
  assert.equal(d.v.bolumler.puantaj.veri.calisilan, 1);
  assert.equal(d.v.bolumler.puantaj.veri.devamsizlik, 1);
  assert.equal(d.v.bolumler.hesap.durum, "ok");
  assert.equal((await cagir(t.sahip, `/yonetim/personel/${id.ahmetPersonel}`)).s, 404, "başka firmanın personeli");
  const y = await cagir(t.yonetici, `/yonetim/personel/${id.teknoPersonel}`);
  assert.equal(y.s, 200);
  assert.equal(y.v.bolumler.maas.durum, "yetki_yok");
  assert.ok(!JSON.stringify(y.v).includes("42000") && !JSON.stringify(y.v).includes("net_maas"), "maaş alanı yanıtta hiç olmamalı");
  for (const k of ["ahmet", "mehmet"]) {
    assert.equal((await cagir(t[k], "/yonetim/personel")).s, 403, k);
    assert.equal((await cagir(t[k], `/yonetim/personel/${id.teknoPersonel}`)).s, 403, k);
  }
  // Sahibin maaşı kişiye özel kapatılırsa görünmez
  assert.equal((await cagir(t.orhan, `/admin/users/${id.sahip}/yetkiler`, { method: "PUT", govde: { yetki_ayar: { maas_goruntule: false } } })).s, 200);
  const k2 = await cagir(t.sahip, `/yonetim/personel/${id.teknoPersonel}`);
  assert.equal(k2.v.bolumler.maas.durum, "yetki_yok");
  await cagir(t.orhan, `/admin/users/${id.sahip}/yetkiler`, { method: "PUT", govde: { yetki_ayar: { maas_goruntule: null } } });
});
