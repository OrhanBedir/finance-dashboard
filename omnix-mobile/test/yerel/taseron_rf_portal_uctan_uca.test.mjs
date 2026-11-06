// RF taşeron portalı uçtan uca — YALNIZ yerel test sunucusu (127.0.0.1:5099). Kurgu: taseron_saha_tohum.js + taseron_cari_tohum.js.
// Doğrulanan: hesap listesi yalnız RF portalındaki firmalar (diğer kayıtlar korunur); kullanıcı adı düzeltmede aynı kimlik; mükerrer
// kontrol; kullanılmamış hesabı silme / kullanılmışı reddetme; yetki düşürme, hesap kapatma, şifre ve ad değişiminde eski token düşer;
// çalışan ve finanssız operasyon sorumlusu finans uçlarına giremez; firma sahibi yalnız kendi firması; QC esaslı hakediş (kısmi QC,
// çelişki = teyit, avans çift sayılmaz, muhasebe mutabakatı); atanan iş bedelleri (saha altında ayrı işler); durum grupları ve Clean Up.
// Çalıştırma: YEREL_API=http://127.0.0.1:5099 NODE_PATH=../backend/node_modules node --test test/yerel/taseron_rf_portal_uctan_uca.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const API = process.env.YEREL_API;
const SIFRE = "Omnix-Test-2026";
if (!API || !/^http:\/\/127\.0\.0\.1:/.test(API)) { console.log("YEREL_API tanımlı değil — atlandı"); process.exit(0); }
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const E = { emrah: "emrah.sorumlu@taseron.test", c1: "emrah.calisan1@taseron.test", ikikx: "tekno2kx.sorumlu@taseron.test", tekno: "tekno.yonetici@teknocenter.test" };
let db;
const q = (s, p) => db.query(s, p);
async function istek(token, yol, { method = "GET", govde } = {}) {
  const h = { "x-istemci": "test" };
  if (token) h.Authorization = `Bearer ${token}`;
  if (govde !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(API + yol, { method, headers: h, body: govde !== undefined ? JSON.stringify(govde) : undefined });
  return { durum: r.status, veri: await r.json().catch(() => null) };
}
const ok = async (...a) => { const r = await istek(...a); assert.equal(r.veri?.ok, true, `${a[1]} → ${r.durum} ${JSON.stringify(r.veri).slice(0, 300)}`); return r.veri; };
const giris = async (e, s = SIFRE) => (await ok(null, "/auth/login", { method: "POST", govde: { email: e, password: s } })).token;
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const T = {};
const ek = Date.now().toString(36);
let EM, IZ, KX;

test("kurulum", async () => {
  db = new Client({ host: "127.0.0.1", port: 55432, user: "postgres", database: "omnix_test" });
  await db.connect();
  for (const [k, e] of Object.entries(E)) T[k] = await giris(e);
  [EM, IZ, KX] = await Promise.all(["TEKNO_EMRAH", "TEKNO_İZTAŞ", "TEKNO_2KX"].map(async (n) => (await q(`SELECT id FROM subcons WHERE subcon_name = $1`, [n])).rows[0].id));
});

test("RF kapsamı: listede yalnız portal firmaları; diğer kayıtlar ve hesaplar korunur", async () => {
  const l = await ok(T.tekno, "/taseron-saha/yonetim/firmalar");
  assert.deepEqual(l.firmalar.map((f) => f.kod).sort(), ["TEKNO_EMRAH", "TEKNO_İZTAŞ"].sort());
  assert.ok(l.firmalar.every((f) => typeof f.aktif_hesap === "number"));
  assert.ok(l.kapsam_disi_hesaplar.some((h) => h.email === E.ikikx), "kapsam dışı firmanın hesabı bilgi listesinde");
  assert.equal((await q(`SELECT COUNT(*)::int AS n FROM subcons WHERE id = $1`, [KX])).rows[0].n, 1, "TEKNO_2KX kaydı silinmedi");
  await ok(E.ikikx && T.ikikx, "/taseron-saha/isler"); // kapsam dışı firmanın hesabı kapatılmadı, çalışmaya devam eder
  const r = await istek(T.tekno, "/taseron-saha/yonetim/hesap", { method: "POST", govde: { taseron_id: KX, ad: "Deneme Kişi", kullanici_adi: `kx.${ek}`, sifre: "Saha2026x", yetki: "CALISAN", ekip_no: 311 } });
  assert.equal(r.durum, 400, "portal dışı firmaya hesap açılmaz");
  assert.equal((await istek(T.emrah, "/taseron-saha/yonetim/firmalar")).durum, 403);
});

test("düzenle: kullanıcı adı düzeltmesi aynı kimlik, eski token düşer; mükerrer ad reddedilir", async () => {
  const a = await ok(T.tekno, "/taseron-saha/yonetim/hesap", { method: "POST", govde: { taseron_id: EM, ad: "Yazim Hatasi", kullanici_adi: `yanlis.${ek}`, sifre: "Saha2026x", yetki: "CALISAN", ekip_no: 302 } });
  const t1 = await giris(`yanlis.${ek}`, "Saha2026x");
  await ok(t1, "/taseron-saha/isler");
  await bekle(1100); // token iat (saniye) düzenlemeden önce kalsın
  const d = await ok(T.tekno, `/taseron-saha/yonetim/hesap/${a.kullanici.id}`, { method: "PUT", govde: { kullanici_adi: `dogru.${ek}`, ad: "Yazım Düzeltildi", gerekce: "e-posta yazım hatası" } });
  assert.match(d.mesaj, /oturum/i);
  const u = (await q(`SELECT id, email, name FROM users WHERE id = $1`, [a.kullanici.id])).rows[0];
  assert.equal(u.email, `dogru.${ek}`); assert.equal(u.name, "Yazım Düzeltildi");
  assert.equal((await istek(t1, "/taseron-saha/isler")).durum, 401, "eski token geçersiz");
  await giris(`dogru.${ek}`, "Saha2026x");
  assert.equal((await istek(T.tekno, `/taseron-saha/yonetim/hesap/${a.kullanici.id}`, { method: "PUT", govde: { kullanici_adi: E.c1 } })).durum, 409, "başka hesabın kullanıcı adı");
  const g = (await q(`SELECT eski, yeni, kullanici FROM islem_gecmisi WHERE modul = 'taseron_saha_uye' AND kayit_id = $1 AND tip = 'HESAP_GUNCELLENDI' ORDER BY id DESC LIMIT 1`, [String(a.kullanici.id)])).rows[0];
  assert.ok(g && JSON.stringify(g.eski).includes(`yanlis.${ek}`) && JSON.stringify(g.yeni).includes(`dogru.${ek}`), "önceki / yeni değer izlenebilir");
  assert.ok(!JSON.stringify(g).includes("Saha2026x"), "şifre geçmişe yazılmaz");
});

test("yetki düşürme / kapatma / şifre: eski token finans ve sahaya erişemez", async () => {
  const s = await ok(T.tekno, "/taseron-saha/yonetim/hesap", { method: "POST", govde: { taseron_id: EM, ad: "Sahip Deneme", kullanici_adi: `sahip.${ek}`, sifre: "Saha2026x", yetki: "SAHIP" } });
  let t = await giris(`sahip.${ek}`, "Saha2026x");
  await ok(t, "/taseron-panel/cari");
  await bekle(1100);
  await ok(T.tekno, `/taseron-saha/yonetim/hesap/${s.kullanici.id}`, { method: "PUT", govde: { yetki: "SORUMLU" } });
  assert.equal((await istek(t, "/taseron-panel/cari")).durum, 401, "yetki düşünce eski token düşer");
  t = await giris(`sahip.${ek}`, "Saha2026x");
  assert.equal((await istek(t, "/taseron-panel/cari")).durum, 403, "operasyon sorumlusu finans göremez");
  assert.equal((await istek(t, "/taseron-panel/atanan-bedeller")).durum, 403);
  const me = await ok(t, "/auth/me"); assert.equal((me.user || me).taseron_saha.finans, false);
  await ok(t, "/taseron-saha/isler");
  await bekle(1100);
  await ok(T.tekno, `/taseron-saha/yonetim/hesap/${s.kullanici.id}`, { method: "PUT", govde: { sifre: "Yeni2026y" } });
  assert.equal((await istek(t, "/taseron-saha/isler")).durum, 401, "şifre sıfırlanınca eski token düşer");
  t = await giris(`sahip.${ek}`, "Yeni2026y");
  await ok(T.tekno, `/taseron-saha/yonetim/hesap/${s.kullanici.id}`, { method: "PUT", govde: { hesap_aktif: false } });
  assert.equal((await istek(t, "/taseron-saha/isler")).durum, 401, "kapalı hesabın token'ı çalışmaz");
  assert.notEqual((await istek(null, "/auth/login", { method: "POST", govde: { email: `sahip.${ek}`, password: "Yeni2026y" } })).durum, 200);
});

test("silme: kullanılmamış hesap silinir; kullanılmış hesap reddedilir (kapat önerilir); firma kaydı korunur", async () => {
  const a = await ok(T.tekno, "/taseron-saha/yonetim/hesap", { method: "POST", govde: { taseron_id: EM, ad: "Yanlış Açılan", kullanici_adi: `sil.${ek}`, sifre: "Saha2026x", yetki: "CALISAN", ekip_no: 302 } });
  const b = await ok(T.tekno, `/taseron-saha/yonetim/hesap/${a.kullanici.id}/bagimlilik`);
  assert.equal(b.silinebilir, true);
  assert.equal((await istek(T.tekno, `/taseron-saha/yonetim/hesap/${a.kullanici.id}`, { method: "DELETE", govde: {} })).durum, 400, "gerekçe zorunlu");
  await ok(T.tekno, `/taseron-saha/yonetim/hesap/${a.kullanici.id}`, { method: "DELETE", govde: { gerekce: "yanlış açıldı" } });
  assert.equal((await q(`SELECT COUNT(*)::int AS n FROM users WHERE id = $1`, [a.kullanici.id])).rows[0].n, 0);
  assert.equal((await q(`SELECT COUNT(*)::int AS n FROM subcons WHERE id = $1`, [EM])).rows[0].n, 1, "firma silinmedi");
  const c = await ok(T.tekno, "/taseron-saha/yonetim/hesap", { method: "POST", govde: { taseron_id: EM, ad: "Kullanılmış", kullanici_adi: `kul.${ek}`, sifre: "Saha2026x", yetki: "CALISAN", ekip_no: 302 } });
  await q(`INSERT INTO taseron_saha_bildirim (site_code, taseron_id, user_id, tur, aciklama) VALUES ('BU8001_NR700', $1, $2, 'KISMI', 'test')`, [EM, c.kullanici.id]);
  const r = await istek(T.tekno, `/taseron-saha/yonetim/hesap/${c.kullanici.id}`, { method: "DELETE", govde: { gerekce: "deneme" } });
  assert.equal(r.durum, 409); assert.equal(r.veri.bagimlilik.saha_raporu, 1);
  await q(`DELETE FROM taseron_saha_bildirim WHERE user_id = $1`, [c.kullanici.id]);
});

test("çalışan: finans uçları kapalı, iş listesinde fiyat yok; firma sahibi yalnız kendi firması", async () => {
  for (const yol of ["/taseron-panel/cari", "/taseron-panel/atanan-bedeller", "/taseron-panel/ozet", "/taseron-panel/isler"]) assert.equal((await istek(T.c1, yol)).durum, 403, `çalışan ${yol}`);
  const j = JSON.stringify((await ok(T.c1, "/taseron-saha/isler")));
  assert.ok(!/"(fiyat|birim_fiyat|tutar|bedel|hakedis|odenen|avans)"\s*:/i.test(j), "çalışanın iş listesinde para alanı yok");
  const kx = await ok(T.ikikx, "/taseron-panel/cari");
  assert.equal(kx.firma.ad.includes("2KX"), true); assert.ok(!JSON.stringify(kx).includes("BU8101"), "başka firmanın işi yok");
});

test("QC esaslı hakediş: kısmi QC, çelişki teyit bekler, avans çift sayılmaz, muhasebe mutabakatı", async () => {
  let c = await ok(T.emrah, "/taseron-panel/cari");
  let qe = c.qc_esasli;
  assert.equal(qe.qc_kapanmis, 25000, "yalnız BU8101 (kalem QC OK)");
  assert.equal(qe.montaj_qc_bekleyen, 48500, "BU8102_NR700 31.000 + BU8104 17.500 (kalem QC NOK)");
  assert.equal(qe.odenen, 150000); assert.equal(qe.uygulanan, 25000); assert.equal(qe.kalan, 0); assert.equal(qe.acik_avans, 125000);
  assert.equal(qe.net, -125000); assert.equal(qe.yon.kod, "AVANS");
  assert.equal(qe.mutabakat.muhasebe_is_bedeli, 73500); assert.equal(qe.mutabakat.fark, 48500);
  assert.equal(c.ozet[0].odenen, qe.odenen, "ödeme muhasebe ile aynı kaynak (çift sayım yok)");
  const satir = (k) => c.hakedisler.find((h) => h.site_code === k && h.bedel);
  assert.equal(satir("BU8102_NR700").hakedis_durum, "QC_BEKLIYOR");
  assert.equal(satir("BU8101_NR700").hakedis_durum, "QC_OK");
  // Aynı fiziksel sahada başka işin QC'si (BU8101 OK) BU8102'yi hakedişe almaz; iş QC'si OK ama kalem NOK → çelişki → teyit
  await q(`UPDATE rollout_progress SET qc_durum = 'OK' WHERE site_code = 'BU8104_NR700'`);
  c = await ok(T.emrah, "/taseron-panel/cari"); qe = c.qc_esasli;
  assert.equal(qe.teyit, 17500); assert.equal(qe.qc_kapanmis, 25000, "teyit bekleyen hakedişe girmez");
  await q(`UPDATE rollout_progress SET qc_durum = 'NOK' WHERE site_code = 'BU8104_NR700'`);
});

test("atanan iş bedelleri: plan, saha altında ayrı işler, fiyatsız uyarı; dönem süzgeci", async () => {
  const a = await ok(T.emrah, "/taseron-panel/atanan-bedeller");
  assert.match(a.baslik, /henüz hak edilmiş alacak değildir/);
  const s = a.sahalar.find((x) => x.fiziksel_id === "BU8102");
  assert.deepEqual(s.isler.map((i) => i.site_code), ["BU8102_NR3500", "BU8102_NR700"], "aynı fiziksel sahada iki ayrı iş");
  assert.equal(s.isler.find((i) => i.site_code === "BU8102_NR3500").fiyat_eksik, true);
  assert.ok(a.fiyatsiz_kalem >= 1);
  assert.equal(a.toplam, a.sahalar.reduce((t, x) => t + x.ara_toplam, 0));
  const kasim = await ok(T.emrah, "/taseron-panel/atanan-bedeller?bas=2026-11-01");
  assert.ok(!kasim.sahalar.some((x) => x.fiziksel_id === "BU8101"), "31.10 işi 1 Kasım süzgecinde yok");
});

test("harita / liste grupları: QC bekleyen eksik değil; QC OK + açık Clean Up uyarısı kalır", async () => {
  await q(`DELETE FROM rollout_cleanup WHERE site_code = 'BU8101_NR700'`).catch(() => {});
  await q(`INSERT INTO rollout_cleanup (site_code, items, onay_durum) VALUES ('BU8101_NR700', '[{"ad":"etiket"},{"ad":"kablo"}]'::jsonb, 'TASLAK')`);
  const v = await ok(T.emrah, "/taseron-saha/isler");
  const b1 = v.isler.find((x) => x.kod === "BU8101_NR700");
  assert.ok(b1.gruplar.includes("qc_ok") && b1.gruplar.includes("eksik"), "QC OK ama Clean Up açık");
  assert.equal(b1.cleanup.kalem, 2);
  const b2 = v.isler.find((x) => x.kod === "BU8102_NR700");
  assert.ok(b2.gruplar.includes("qc_bekleyen") && !b2.gruplar.includes("eksik"));
  assert.ok(v.sayac.fiziksel_saha < v.sayac.toplam);
  await q(`DELETE FROM rollout_cleanup WHERE site_code = 'BU8101_NR700'`);
});

test("kapanış", async () => {
  for (const t of ["master_works", "rollout_progress", "taseron_saha_bildirim", "is_fiili_bildirim", "rollout_is_kolu"]) await q(`DELETE FROM ${t} WHERE site_code LIKE 'BU81%' OR site_code LIKE 'BU82%'`).catch(() => {});
  await db.end();
});
