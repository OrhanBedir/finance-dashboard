// Taşeron "Hakediş ve Cari" + "Yaptığımız Sahalar" + firma sorumlusu saha işlemi — YALNIZ yerel test sunucusu (127.0.0.1:5099).
// Kurgu: taseron_saha_tohum.js + taseron_cari_tohum.js. Canlıya istek gitmez.
// Doğrulanan: faturasız ama hakedişli firma; 31 Ekim / 1 Kasım tarife sınırı; fiyatsız kalem sıfır sayılmaz; kısmi fiziki miktar;
// avans + bağlı marka satırı çift sayılmaz; iptal ödeme toplama girmez; mobil ve yönetim (Teknocenter muhasebe) aynı bakiye;
// başka firma kayıtları görünmez; çalışan finans uçlarına giremez; Huawei fiyatı sızmaz; Yaptığımız Sahalar sayımları ve QC eşlemesi
// (QC NOK "başladı" sayılmaz); grup adı (TEKNO) yazılı Rollout işi firmanın montajı sayılır; sorumlu + saha açık → başlat / tamamla;
// saha kapalı → 403 ama finans açık; tamamlama QC'yi ve cariyi değiştirmez; tekrar gönderim tek kayıt.
// Çalıştırma: YEREL_API=http://127.0.0.1:5099 NODE_PATH=../backend/node_modules node --test test/yerel/taseron_cari_uctan_uca.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const API = process.env.YEREL_API;
const SIFRE = "Omnix-Test-2026";
if (!API || !/^http:\/\/127\.0\.0\.1:/.test(API)) { console.log("YEREL_API tanımlı değil — atlandı"); process.exit(0); }
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const E = { emrah: "emrah.sorumlu@taseron.test", c1: "emrah.calisan1@taseron.test", ikikx: "tekno2kx.sorumlu@taseron.test", muhasebe: "tekno.muhasebe@teknocenter.test" };
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
const giris = async (e) => (await ok(null, "/auth/login", { method: "POST", govde: { email: e, password: SIFRE } })).token;
const T = {};

test("kurulum", async () => {
  db = new Client({ host: "127.0.0.1", port: 55432, user: "postgres", database: "omnix_test" });
  await db.connect();
  for (const [k, e] of Object.entries(E)) T[k] = await giris(e);
});

test("faturasız ama hakedişli firma: iş bedeli, ödeme, açık avans, net yön", async () => {
  const c = await ok(T.emrah, "/taseron-panel/cari");
  assert.equal(c.firma.ad, "TEKNO_EMRAH");
  assert.equal(c.firma.model, "HAKEDIS");
  const o = c.ozet.find((x) => x.para_birimi === "TRY");
  assert.equal(o.is_bedeli, 73500, "25.000 (eski paket) + 31.000 (01.11) + 17.500 (kısmi 0,5 × 35.000)");
  assert.equal(o.odenen, 150000, "40.000 + 100.000 (bağlı marka satırı tek) + 10.000; iptal 5.000 sayılmaz");
  assert.equal(o.hakedis_mahsup, 73500);
  assert.equal(o.hakedis_kalan, 0);
  assert.equal(o.acik_avans, 76500);
  assert.equal(o.net, -76500);
  assert.equal(o.yon.metin, "Firmanızın açık avansı");
  assert.equal(c.faturalar.length, 0);
  assert.match(c.fatura_bos_mesaj, /Henüz fatura kaydı yok/);
  assert.ok(c.hakedisler.length > 0, "fatura yokken hakediş görünmeye devam eder");
});

test("31 Ekim / 1 Kasım tarife sınırı, fiyatsız kalem, kısmi miktar, paket dahil, aynı sahada iki iş", async () => {
  const c = await ok(T.emrah, "/taseron-panel/cari");
  const s = (kod, item) => c.hakedisler.find((x) => x.site_code === kod && x.item_code === item);
  const eski = s("BU8101_NR700", "8818274542");
  assert.equal(eski.is_tarihi, "2026-10-31"); assert.equal(eski.tarife.baslangic, "2026-09-01"); assert.equal(eski.bedel, 25000);
  assert.equal(eski.is_tarihi_kaynak, "montaj başlangıcı");
  const yeni = s("BU8102_NR700", "8812489291");
  assert.equal(yeni.is_tarihi, "2026-11-01"); assert.equal(yeni.tarife.baslangic, "2026-11-01"); assert.equal(yeni.bedel, 31000);
  const fiyatsiz = s("BU8102_NR3500", "8812489285");
  assert.equal(fiyatsiz.bedel, null, "fiyatsız kalem sıfır TL değil, boş");
  assert.equal(fiyatsiz.fiyat_durum, "TANIMSIZ"); assert.ok(fiyatsiz.uyarilar.some((u) => /Fiyat doğrulanamadı/.test(u)));
  assert.equal(yeni.fiziksel_id, fiyatsiz.fiziksel_id, "aynı fiziksel saha, iki ayrı iş");
  const kismi = s("BU8104_NR700", "8812489289");
  assert.equal(kismi.fiziki_miktar, 0.5); assert.equal(kismi.pr_miktar, 1); assert.equal(kismi.bedel, 17500);
  const plan = s("BU8103_NR700", "8812489289");
  assert.equal(plan.bedel, null, "yalnız PR / plan: bedel yok"); assert.ok(plan.uyarilar.some((u) => /Fiziki miktar girilmemiş/.test(u)));
  assert.equal(s("BU8101_NR700", "8812184863").fiyat_durum, "PAKET", "etiket pakete dahil (çift ücret yok)");
  assert.ok(c.uyarilar.some((u) => /fiyatı tanımsız/.test(u)));
});

test("ödemeler: iptal ters kayıt, avans, ekstre son bakiyesi = net", async () => {
  const c = await ok(T.emrah, "/taseron-panel/cari");
  const ipt = c.odemeler.find((x) => x.tur === "IPTAL");
  assert.ok(ipt && ipt.nakit === false && ipt.tutar === 5000);
  assert.equal(c.odemeler.filter((x) => x.nakit).reduce((t, x) => t + x.tutar, 0), 150000);
  assert.equal(c.odemeler.filter((x) => x.tutar === 100000).length, 1, "bağlı marka satırı ayrı hareket değil");
  const e = c.hareketler.find((x) => x.para_birimi === "TRY").satirlar;
  assert.equal(e[e.length - 1].bakiye, -76500, "ekstrenin son bakiyesi net carinin aynısı");
});

test("yönetim ekranı (Teknocenter muhasebe) ile mobil aynı bakiye", async () => {
  const y = await ok(T.muhasebe, "/finance/marka-cari/liste?marka=TEKNO");
  const id = (await q(`SELECT id FROM subcons WHERE subcon_name='TEKNO_EMRAH'`)).rows[0].id;
  const P = y.rows.find((r) => r.id === id).pb.TRY;
  const o = (await ok(T.emrah, "/taseron-panel/cari")).ozet.find((x) => x.para_birimi === "TRY");
  assert.equal(o.is_bedeli, P.hakedis); assert.equal(o.odenen, P.nakit); assert.equal(o.net, P.net); assert.equal(o.acik_avans, P.avans_acik);
  const kx = (await q(`SELECT id FROM subcons WHERE subcon_name='TEKNO_2KX'`)).rows[0].id;
  const P2 = y.rows.find((r) => r.id === kx).pb.TRY;
  const o2 = (await ok(T.ikikx, "/taseron-panel/cari")).ozet.find((x) => x.para_birimi === "TRY");
  assert.equal(o2.net, P2.net); assert.equal(o2.net, 15000); assert.equal(o2.yon.metin, "Firmanıza ödenecek", "kısmi ödemeli hakediş");
});

test("gizlilik: başka firma yok, Huawei fiyatı yok, çalışan finans uçlarına giremez", async () => {
  const c = await istek(T.emrah, "/taseron-panel/cari");
  const j = JSON.stringify(c.veri);
  assert.ok(!/BU8201/.test(j), "TEKNO_2KX işi EMRAH carisinde yok");
  assert.ok(!/2KX avans/.test(j));
  assert.ok(!/77777/.test(j), "master_works.unit_price (Huawei) sızmaz");
  for (const yol of ["/taseron-panel/cari", "/taseron-panel/ozet", "/taseron-panel/hakedis", "/taseron-panel/faturalar"]) {
    const r = await istek(T.c1, yol);
    assert.equal(r.durum, 403, `çalışan ${yol} → 403`);
  }
  const g = await ok(T.c1, "/taseron-saha/gecmis");
  assert.ok(g.satirlar.every((x) => x.bedel_durumu === null), "çalışana bedel durumu yok");
  // Firma parametresi gönderilse de oturumdaki firma kullanılır
  const kx = (await q(`SELECT id FROM subcons WHERE subcon_name='TEKNO_2KX'`)).rows[0].id;
  const zorla = await ok(T.emrah, `/taseron-panel/cari?taseron_id=${kx}&marka=AHY`);
  assert.equal(zorla.firma.ad, "TEKNO_EMRAH");
});

test("Yaptığımız Sahalar: sayımlar, QC eşlemesi, grup adı, plan hariç", async () => {
  const g = await ok(T.emrah, "/taseron-saha/gecmis");
  const s = (k) => g.satirlar.find((x) => x.kod === k);
  assert.equal(s("BU8101_NR700").sinif, "TAMAMLANDI", "Rollout RF 'TEKNO' (grup adı) + Günlük İş kalemi EMRAH → firmanın montajı");
  assert.match(s("BU8101_NR700").montaj_kaynagi, /grup adı/);
  assert.equal(s("BU8101_NR700").qc.kod, "KAPANDI");
  assert.equal(s("BU8102_NR700").qc.kod, "BILINMIYOR", "QC NOK → 'başladı' DEĞİL");
  assert.equal(s("BU8105_NS_MWA").qc.kod, "BASLADI", "Smart QC Executing → QC başladı");
  assert.equal(s("BU8105_NS_MWA").sinif, "TEYIT"); assert.match(s("BU8105_NS_MWA").teyit, /montaj tamamlanma kaydı teyit/);
  assert.equal(s("BU8104_NR700").sinif, "KISMI");
  assert.equal(s("BU8102_NR3500").sinif, "TEYIT");
  assert.ok(!s("BU8103_NR700"), "yalnız plan listede yok");
  assert.equal(s("BU8102_NR3500").bedel_durumu.kod, "FIYAT_DOGRULANAMADI");
  assert.ok(g.sayac.kanitsiz_plan_is >= 1);
  assert.equal(g.sayac.qc_baslayan_saha, 1);
  assert.ok(g.sayac.toplam_saha < g.sayac.toplam_is, "fiziksel saha ≠ iş kaydı (BU8102 iki iş)");
  assert.ok(!g.satirlar.some((x) => x.kod === "BU8201_NR700"), "başka firmanın işi yok");
  const j = JSON.stringify(g);
  assert.ok(!/77777|"tutar"|"bedel":/.test(j), "geçmiş listesinde tutar yok");
});

test("firma sorumlusu + saha açık: başlat, kısmi, tam, tekrar gönderim; QC ve cari değişmez", async () => {
  const kod = "BU8001_NR700";
  const once = await ok(T.emrah, "/taseron-panel/cari");
  const qcOnce = (await q(`SELECT qc_durum FROM rollout_progress WHERE site_code = $1`, [kod])).rows[0].qc_durum;
  const is = await ok(T.emrah, `/taseron-saha/is/${kod}`);
  assert.equal(is.is.islem.basla, true); assert.equal(is.is.kapsam.firma, true);
  const anahtar = `cari-${Date.now()}`;
  await ok(T.emrah, `/taseron-saha/is/${kod}/basla`, { method: "POST", govde: { onay_kod: kod, istek_anahtari: anahtar } });
  const tekrar = await ok(T.emrah, `/taseron-saha/is/${kod}/basla`, { method: "POST", govde: { onay_kod: kod, istek_anahtari: anahtar } });
  assert.ok(tekrar.tekrar || tekrar.zaten, "tekrar gönderim yeni kayıt açmaz");
  const k = await ok(T.emrah, `/taseron-saha/is/${kod}/tamamla`, { method: "POST", govde: { onay_kod: kod, tur: "KISMI", aciklama: "Anten takıldı", kalan_is: "Kablo kaldı", istek_anahtari: `${anahtar}-k` } });
  assert.notEqual(k.is.montaj.durum, "TAMAMLANDI", "kısmi tamamlanmış sayılmaz");
  const t = await ok(T.emrah, `/taseron-saha/is/${kod}/tamamla`, { method: "POST", govde: { onay_kod: kod, tur: "TAM", standart: true, istek_anahtari: `${anahtar}-t` } });
  assert.equal(t.is.montaj.durum, "TAMAMLANDI");
  assert.equal(t.is.islem.tamamla, false); assert.match(t.is.islem.engel, /tamamlanmış/);
  const n = (await q(`SELECT COUNT(*)::int AS n FROM taseron_saha_bildirim WHERE site_code = $1 AND tur = 'BASLADI'`, [kod])).rows[0].n;
  assert.equal(n, 1, "tek başlangıç kaydı");
  assert.equal((await q(`SELECT qc_durum FROM rollout_progress WHERE site_code = $1`, [kod])).rows[0].qc_durum, qcOnce, "QC değişmedi");
  const sonra = await ok(T.emrah, "/taseron-panel/cari");
  assert.deepEqual(sonra.ozet, once.ozet, "montaj bildirimi hakediş / ödeme üretmez");
});

test("başka firma işi / kapsam dışı iş reddedilir", async () => {
  const r = await istek(T.emrah, "/taseron-saha/is/BU8201_NR700/basla", { method: "POST", govde: { onay_kod: "BU8201_NR700" } });
  assert.equal(r.durum, 404);
  const r2 = await istek(T.emrah, "/taseron-saha/is/BU8008_NR700/basla", { method: "POST", govde: { onay_kod: "BU8008_NR700" } });
  assert.equal(r2.durum, 403, "ana montaj başka firmada (AHY_VEDAT) → işlem yok");
});

test("firma sorumlusu + saha kapalı: saha 403, finans açık", async () => {
  const uid = (await q(`SELECT id FROM users WHERE email = $1`, [E.emrah])).rows[0].id;
  await q(`UPDATE taseron_saha_uye SET aktif = false WHERE user_id = $1`, [uid]);
  try {
    await new Promise((r) => setTimeout(r, 31000)); // üyelik önbelleği (30 sn)
    const s = await istek(T.emrah, "/taseron-saha/isler");
    assert.equal(s.durum, 403);
    const f = await istek(T.emrah, "/taseron-panel/cari");
    assert.equal(f.durum, 200, "saha kapalı firma sorumlusu finansı görmeye devam eder");
    const me = await ok(T.emrah, "/auth/me");
    assert.equal((me.user || me).taseron_saha?.rol, "SORUMLU"); assert.equal((me.user || me).taseron_saha?.saha_acik, false);
  } finally { await q(`UPDATE taseron_saha_uye SET aktif = true WHERE user_id = $1`, [uid]); }
});

test("kapanış: bu kurgunun kayıtları temizlenir (taşeron saha testinin beklediği iş listesi bozulmasın)", async () => {
  for (const t of ["master_works", "rollout_progress", "taseron_saha_bildirim", "is_fiili_bildirim", "rollout_is_kolu"]) await q(`DELETE FROM ${t} WHERE site_code LIKE 'BU81%' OR site_code LIKE 'BU82%'`).catch(() => {});
  await db.end();
});
