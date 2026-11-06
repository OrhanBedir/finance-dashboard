// Taşeron saha operasyonu uçtan uca — YALNIZ yerel test sunucusu (127.0.0.1:5099, taseron_saha_tohum.js kurgusu). Canlıya istek gitmez.
// Doğrulanan: üç firmanın birbirinden yalıtımı; aynı fiziksel sahada farklı firma; çok ekipli kapsam (sorumlu / çalışan / ekipsiz / varsayılan);
// liste ve harita aynı veri; Montaja Başla → Rollout + fiilî durum + iş ataması; ikinci başlangıç yok; kısmi iş tamamlanmış sayılmaz;
// QC ve sorun bağımsız; çift gönderim / eş zamanlı gönderim tek kayıt; rapor düzeltme sürüm geçmişi; Teknocenter görünürlüğü + mükerrer PR
// engeli; fotoğraf erişimi; fiyat / başka firma verisi sızmaz; çalışan hesabı firma hakediş / fatura uçlarına giremez.
// Çalıştırma: YEREL_API=http://127.0.0.1:5099 NODE_PATH=../backend/node_modules node --test test/yerel/taseron_saha_uctan_uca.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const API = process.env.YEREL_API;
const SIFRE = "Omnix-Test-2026";
if (!API || !/^http:\/\/127\.0\.0\.1:/.test(API)) { console.log("YEREL_API tanımlı değil — atlandı"); process.exit(0); }
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const E = {
  emrah: "emrah.sorumlu@taseron.test", c1: "emrah.calisan1@taseron.test", c2: "emrah.calisan2@taseron.test", firma: "emrah.firma@taseron.test",
  ekipsiz: "emrah.ekipsiz@taseron.test", ikikx: "tekno2kx.sorumlu@taseron.test", iztas: "iztas.calisan@taseron.test", bag2kx: "bagimsiz2kx@taseron.test",
  tekno: "tekno.yonetici@teknocenter.test", erc: "orhan.bedir@simsektel.com",
};
let db;
const q = (s, p) => db.query(s, p);

async function istek(token, yol, { method = "GET", govde, form } = {}) {
  const h = { "x-istemci": "test" };
  if (token) h.Authorization = `Bearer ${token}`;
  if (govde !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(API + yol, { method, headers: h, body: form || (govde !== undefined ? JSON.stringify(govde) : undefined) });
  const tip = r.headers.get("content-type") || "";
  if (!/json/.test(tip)) return { durum: r.status, tip, boyut: (await r.arrayBuffer()).byteLength };
  const veri = await r.json();
  return { durum: r.status, veri };
}
const ok = async (...a) => { const r = await istek(...a); assert.equal(r.veri?.ok, true, `${a[1]} → ${r.durum} ${JSON.stringify(r.veri).slice(0, 300)}`); return r.veri; };
const giris = async (e) => (await ok(null, "/auth/login", { method: "POST", govde: { email: e, password: SIFRE } })).token;
const anahtar = () => `ts-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const kodlar = (v) => v.isler.map((x) => x.kod).sort();
const GIZLI = /GIZLI|AHY-NOTU|99999/;
const FIYAT_ANAHTARI = /"[^"]*(fiyat|price|tutar|hakedis|fatura|maas|maaş|iban|cari|payment_rate|marka_pay|odeme)[^"]*"\s*:/i;

const T = {};
test("kurulum: girişler", async () => {
  db = new Client({ host: "127.0.0.1", port: 55432, user: "postgres", database: "omnix_test" });
  await db.connect();
  for (const [k, e] of Object.entries(E)) T[k] = await giris(e);
});

test("üç firma yalıtımı + adı benzeyen bağımsız firmalar karışmaz", async () => {
  const em = await ok(T.emrah, "/taseron-saha/isler");
  assert.equal(em.firma.ad, "TEKNO_EMRAH");
  for (const k of ["BU8001_NR700", "BU8002_NR700", "BU8003_NR700", "BU8007_NR700", "BU8008_NR700", "BU8010_NR700"]) assert.ok(kodlar(em).includes(k), `EMRAH ${k} görmeli`);
  for (const k of ["BU8004_NR700", "BU8004_L1800", "BU8005_NR700", "BU8005_LTE", "BU8006_NR700", "BU8009_NR700"]) assert.ok(!kodlar(em).includes(k), `EMRAH ${k} görmemeli`);
  const kx = await ok(T.ikikx, "/taseron-saha/isler");
  assert.deepEqual(kodlar(kx), ["BU8004_NR700", "BU8009_NR700"], "TEKNO_2KX: kendi RF'i + Günlük İş kalemi; bağımsız 2KX satırı yok");
  const iz = await ok(T.iztas, "/taseron-saha/isler");
  assert.deepEqual(kodlar(iz), ["BU8005_NR700"], "İZTAŞ çalışanı ekip 321: yalnız kendi ekibi (BU8006 ekibe ayrılmamış → sorumluya)");
  const b2 = await ok(T.bag2kx, "/taseron-saha/isler");
  assert.deepEqual(kodlar(b2), ["BU8004_L1800"], "bağımsız 2KX TEKNO_2KX işlerini görmez");
  // Harf / boşluk farkı ("Tekno_iztaş ") aynı firma sayılır — ama ekibe ayrılmamış iş çalışana değil, firma geneline
  await q(`UPDATE taseron_saha_uye SET rol = 'SORUMLU' WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [E.iztas]);
  const izS = await ok(T.iztas, "/taseron-saha/isler");
  assert.deepEqual(kodlar(izS), ["BU8005_NR700", "BU8006_NR700"]);
  await q(`UPDATE taseron_saha_uye SET rol = 'CALISAN' WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [E.iztas]);
});

test("aynı fiziksel sahada farklı firma: başka firmanın notu / sorun metni / QC'si sızmaz", async () => {
  const d = await ok(T.ikikx, "/taseron-saha/is/BU8004_NR700");
  assert.equal(d.is.fiziksel_id, "BU8004");
  assert.ok(!GIZLI.test(JSON.stringify(d)), "başka kaynaktan metin sızdı");
  const s = d.is.sorun.kayitlar[0];
  assert.equal(s.etiket, "Açık sorun kaydı"); assert.equal(s.aciklama, null, "Teknocenter iç sorun metni taşerona verilmez");
  assert.equal((await istek(T.ikikx, "/taseron-saha/is/BU8004_L1800")).durum, 404, "bağımsız 2KX'in işi: bulunamadı");
  assert.equal((await istek(T.bag2kx, "/taseron-saha/is/BU8004_NR700")).durum, 404);
  // Salt okunur iş: RF başka firmada → montaj kapalı, RF notu ve QC gizli
  const ro = await ok(T.emrah, "/taseron-saha/is/BU8008_NR700");
  assert.equal(ro.is.islem.montaj, false); assert.match(ro.is.islem.neden, /başka firmada/);
  assert.equal(ro.is.qc.gizli, true); assert.deepEqual(ro.is.notlar, []);
  assert.ok(!GIZLI.test(JSON.stringify(ro)));
  const r = await istek(T.emrah, "/taseron-saha/is/BU8008_NR700/basla", { method: "POST", govde: { onay_kod: "BU8008_NR700", istek_anahtari: anahtar() } });
  assert.equal(r.durum, 403);
});

test("çok ekipli kapsam: çalışan kendi ekibi, ekipsiz çalışan ekibe ayrılmamış işler, varsayılan firma geneli", async () => {
  const c1 = await ok(T.c1, "/taseron-saha/isler");
  assert.deepEqual(kodlar(c1), ["BU8001_NR700"]); assert.equal(c1.rol, "CALISAN"); assert.equal(c1.ekip.no, 302); assert.deepEqual(c1.ekipler, []);
  assert.deepEqual(kodlar(await ok(T.c2, "/taseron-saha/isler")), ["BU8002_NR700"]);
  const es = kodlar(await ok(T.ekipsiz, "/taseron-saha/isler"));
  assert.ok(es.includes("BU8003_NR700") && !es.includes("BU8001_NR700") && !es.includes("BU8002_NR700"), "ekipsiz çalışan: ekibe ayrılmamış işler");
  assert.deepEqual(kodlar(await ok(T.firma, "/taseron-saha/isler")), kodlar(await ok(T.emrah, "/taseron-saha/isler")), "üyeliksiz hesap = firma geneli");
  // Başka ekibin işi: detay ve işlem sunucuda reddedilir
  assert.equal((await istek(T.c1, "/taseron-saha/is/BU8002_NR700")).durum, 404);
  assert.equal((await istek(T.c1, "/taseron-saha/is/BU8002_NR700/basla", { method: "POST", govde: { onay_kod: "BU8002_NR700", istek_anahtari: anahtar() } })).durum, 404);
  // Firma sorumlusunun hakları çalışana geçmez
  for (const yol of ["/taseron-panel/hakedis", "/taseron-panel/faturalar", "/taseron-panel/isler", "/taseron-panel/ozet"]) assert.equal((await istek(T.c1, yol)).durum, 403, yol);
  assert.equal((await istek(T.emrah, "/taseron-panel/hakedis")).durum, 200, "sorumlu firma paneline girer");
  const me = await ok(T.c1, "/auth/me");
  assert.equal(me.user.taseron_saha.rol, "CALISAN"); assert.equal(me.user.payment_rate, undefined); assert.equal(me.user.marka_pay, undefined);
});

test("liste ve harita aynı veri: konumsuz iş yalnız listede, tahmini konum yok; filtre sayaçları", async () => {
  const v = await ok(T.emrah, "/taseron-saha/isler");
  const b3 = v.isler.find((x) => x.kod === "BU8003_NR700");
  assert.equal(b3.konum, null); assert.equal(b3.konum_yok, true);
  const b1 = v.isler.find((x) => x.kod === "BU8001_NR700");
  assert.deepEqual(b1.konum, { lat: 40.21, lng: 29.05 });
  assert.equal(v.sayac.konumsuz, v.isler.filter((x) => !x.konum).length);
  assert.equal(v.sayac.qc_ok, 1); assert.equal(v.isler.find((x) => x.kod === "BU8007_NR700").montaj.durum, "TAMAMLANDI");
  const b10 = v.isler.find((x) => x.kod === "BU8010_NR700");
  assert.equal(b10.montaj.durum, "TAMAMLANDI", "QC NOK fiziksel tamamlanmayı geri almaz");
  // 06.11.2026: QC NOK eksik / sorun sayılmaz — "Montaj tamam · QC bekliyor" grubunda
  assert.equal(b10.sorun.var, false); assert.ok(b10.gruplar.includes("qc_bekleyen") && !b10.gruplar.includes("eksik"));
  const ara = await ok(T.emrah, "/taseron-saha/isler?q=bu8001");
  assert.deepEqual(kodlar(ara), ["BU8001_NR700"]);
});

test("Montaja Başla: onay, Rollout yansıması, ikinci başlangıç yok, çift / eş zamanlı gönderim tek kayıt", async () => {
  assert.equal((await istek(T.c1, "/taseron-saha/is/BU8001_NR700/basla", { method: "POST", govde: { istek_anahtari: anahtar() } })).durum, 400, "saha onayı zorunlu");
  assert.equal((await istek(T.c1, "/taseron-saha/is/BU8001_NR700/basla", { method: "POST", govde: { onay_kod: "BU8002_NR700", istek_anahtari: anahtar() } })).durum, 400, "yanlış saha onayı");
  const k = anahtar();
  const govde = { onay_kod: "BU8001_NR700", istek_anahtari: k };
  const [a, b] = await Promise.all([istek(T.c1, "/taseron-saha/is/BU8001_NR700/basla", { method: "POST", govde }), istek(T.c1, "/taseron-saha/is/BU8001_NR700/basla", { method: "POST", govde })]);
  assert.equal(a.veri.ok, true); assert.equal(b.veri.ok, true);
  const v = a.veri.is.montaj.durum === "DEVAM" ? a.veri : b.veri;
  assert.equal(v.is.montaj.durum, "DEVAM"); assert.ok(v.is.montaj.baslama);
  const tekrar = await ok(T.c1, "/taseron-saha/is/BU8001_NR700/basla", { method: "POST", govde });
  assert.equal(tekrar.tekrar, true);
  const ikinci = await ok(T.emrah, "/taseron-saha/is/BU8001_NR700/basla", { method: "POST", govde: { onay_kod: "BU8001_NR700", istek_anahtari: anahtar() } });
  assert.equal(ikinci.zaten, true, "sorumlunun ikinci başlangıcı yeni kayıt açmaz");
  assert.equal((await q(`SELECT COUNT(*)::int n FROM is_fiili_bildirim WHERE site_code = 'BU8001_NR700' AND olay = 'BASLADI'`)).rows[0].n, 1);
  assert.equal((await q(`SELECT COUNT(*)::int n FROM taseron_saha_bildirim WHERE site_code = 'BU8001_NR700' AND tur = 'BASLADI'`)).rows[0].n, 1);
  const r = (await q(`SELECT installation_actual_start_date s, installation_actual_end_date e, qc_durum FROM rollout_progress WHERE site_code = 'BU8001_NR700'`)).rows[0];
  assert.ok(r.s, "Rollout montaj başlangıcı yazıldı"); assert.equal(r.e, null); assert.equal(r.qc_durum, null);
  const fb = (await q(`SELECT ekip_no, bildiren_email, kanal FROM is_fiili_bildirim WHERE site_code = 'BU8001_NR700' AND olay = 'BASLADI'`)).rows[0];
  assert.equal(fb.ekip_no, 302); assert.equal(fb.bildiren_email, E.c1); assert.match(fb.kanal, /^taseron:\d+$/);
  assert.equal((await q(`SELECT durum FROM is_atama WHERE 'BU8001_NR700' = ANY(site_codes)`)).rows[0].durum, "BASLADI");
  // Web / Plan aynı kaynağı okur: Teknocenter fiilî durumu
  const h = await ok(T.tekno, "/taseron-saha/teknocenter/bildirimler?kod=BU8001&yalniz_rapor=0");
  assert.equal(h.rows.filter((x) => x.tur === "BASLADI").length, 1);
});

test("Montajı Tamamla: kısmi iş tamamlanmış sayılmaz; standart tam; sorun ve QC bağımsız", async () => {
  const yol = "/taseron-saha/is/BU8001_NR700/tamamla";
  assert.equal((await istek(T.c1, yol, { method: "POST", govde: { onay_kod: "BU8001_NR700", tur: "KISMI", aciklama: "Anten takıldı", istek_anahtari: anahtar() } })).durum, 400, "kalan iş zorunlu");
  assert.equal((await istek(T.c1, yol, { method: "POST", govde: { onay_kod: "BU8001_NR700", tur: "TAM", istek_anahtari: anahtar() } })).durum, 400, "standart değilse açıklama zorunlu");
  // Bağlantı koptu: yanıt telefona ulaşmadı → aynı istek anahtarıyla yeniden gönderim ikinci rapor açmaz
  const kk = anahtar();
  const kisimGovde = { onay_kod: "BU8001_NR700", tur: "KISMI", aciklama: "Anten ve RRU takıldı", kalan_is: "Enerji bağlantısı", istek_anahtari: kk };
  const kisim = await ok(T.c1, yol, { method: "POST", govde: kisimGovde });
  const yeniden = await ok(T.c1, yol, { method: "POST", govde: kisimGovde });
  assert.equal(yeniden.tekrar, true); assert.equal(yeniden.bildirim_id ?? kisim.bildirim_id, kisim.bildirim_id);
  assert.equal((await q(`SELECT COUNT(*)::int n FROM taseron_saha_bildirim WHERE site_code = 'BU8001_NR700' AND tur = 'KISMI'`)).rows[0].n, 1, "yeniden gönderim tek kayıt");
  assert.equal(kisim.is.montaj.durum, "KISMI"); assert.equal(kisim.is.montaj.bitis, null);
  assert.equal((await q(`SELECT installation_actual_end_date e FROM rollout_progress WHERE site_code = 'BU8001_NR700'`)).rows[0].e, null, "kısmi iş bitiş yazmaz");
  const v = await ok(T.c1, "/taseron-saha/isler");
  assert.equal(v.sayac.tamamlanan, 0); assert.equal(v.sayac.devam, 1);
  const tam = await ok(T.c1, yol, { method: "POST", govde: { onay_kod: "BU8001_NR700", tur: "TAM", standart: true, sorun: "Kapı kilidi kırık", istek_anahtari: anahtar() } });
  assert.equal(tam.is.montaj.durum, "TAMAMLANDI");
  assert.equal(tam.is.sorun.var, true); assert.equal(tam.is.sorun.kayitlar[0].etiket, "Ekip bildirimi"); assert.equal(tam.is.sorun.kayitlar[0].aciklama, "Kapı kilidi kırık");
  assert.equal(tam.is.qc.durum, null, "taşeron QC vermez");
  const r = (await q(`SELECT installation_actual_end_date e, qc_durum FROM rollout_progress WHERE site_code = 'BU8001_NR700'`)).rows[0];
  assert.ok(r.e); assert.equal(r.qc_durum, null);
  assert.ok(["TAMAMLANDI", "QC_BEKLE"].includes((await q(`SELECT durum FROM is_atama WHERE 'BU8001_NR700' = ANY(site_codes)`)).rows[0].durum));
  const tekrar = await ok(T.c1, yol, { method: "POST", govde: { onay_kod: "BU8001_NR700", tur: "TAM", standart: true, istek_anahtari: anahtar() } });
  assert.equal(tekrar.zaten, true);
  // Başlamamış işi tamamlama → 409
  assert.equal((await istek(T.c2, "/taseron-saha/is/BU8002_NR700/tamamla", { method: "POST", govde: { onay_kod: "BU8002_NR700", tur: "TAM", standart: true, istek_anahtari: anahtar() } })).durum, 409);
  // RF boş + Günlük İş kalemi: montaj bu firmada (TEKNO_2KX)
  const b9 = await ok(T.ikikx, "/taseron-saha/is/BU8009_NR700/basla", { method: "POST", govde: { onay_kod: "BU8009_NR700", istek_anahtari: anahtar() } });
  assert.equal(b9.is.montaj.durum, "DEVAM");
});

let raporId, fotoId;
test("rapor düzeltme sürüm geçmişi + fotoğraf + Teknocenter PR akışı (mükerrer engeli)", async () => {
  const d = await ok(T.c1, "/taseron-saha/is/BU8001_NR700");
  const tam = d.is.raporlar.find((x) => x.tur === "TAMAMLANDI");
  raporId = tam.id;
  assert.equal(tam.duzeltilebilir, true);
  const ed = await ok(T.c1, `/taseron-saha/bildirim/${raporId}`, { method: "PUT", govde: { aciklama: "Standart montaj, etiketler takıldı", surum: tam.surum } });
  assert.match(ed.mesaj, /önceki sürüm/);
  assert.equal((await istek(T.c1, `/taseron-saha/bildirim/${raporId}`, { method: "PUT", govde: { aciklama: "eski sürüm", surum: tam.surum } })).durum, 409, "sürüm çatışması");
  assert.equal((await istek(T.c2, `/taseron-saha/bildirim/${raporId}`, { method: "PUT", govde: { aciklama: "x" } })).durum, 404, "başka ekip düzeltemez");
  // Fotoğraf
  const fis = readFileSync(new URL("./fis.jpg", import.meta.url));
  const form = () => { const f = new FormData(); f.append("istek_anahtari", "foto-anahtar-1234"); f.append("dosya", new Blob([fis], { type: "image/jpeg" }), "foto.jpg"); return f; };
  const f1 = await ok(T.c1, `/taseron-saha/bildirim/${raporId}/foto`, { method: "POST", form: form() });
  const f2 = await ok(T.c1, `/taseron-saha/bildirim/${raporId}/foto`, { method: "POST", form: form() });
  assert.equal(f2.tekrar, true); assert.equal(f2.foto_sayisi, 1, "aynı fotoğraf iki kez eklenmez");
  fotoId = f1.foto.id;
  const g = await istek(T.c1, `/taseron-saha/bildirim/${raporId}/foto/${fotoId}`);
  assert.equal(g.durum, 200); assert.match(g.tip, /image/); assert.ok(g.boyut > 1000);
  assert.equal((await istek(T.ikikx, `/taseron-saha/bildirim/${raporId}/foto/${fotoId}`)).durum, 404, "başka firma fotoğrafı göremez");
  assert.equal((await istek(T.tekno, `/taseron-saha/bildirim/${raporId}/foto/${fotoId}`)).durum, 200, "Teknocenter görür");
  // Teknocenter: iş koduna göre rapor, firma / ekip / kişi / tarih / foto
  const tk = await ok(T.tekno, "/taseron-saha/teknocenter/bildirimler?kod=BU8001_NR700");
  const row = tk.rows.find((x) => x.id === raporId);
  assert.equal(row.firma.ad, "TEKNO_EMRAH"); assert.equal(row.ekip.no, 302); assert.equal(row.bildiren, "Emrah Çalışan Bir"); assert.equal(row.fotolar.length, 1);
  assert.equal(row.aciklama, "Standart montaj, etiketler takıldı");
  assert.ok(tk.rows.some((x) => x.tur === "KISMI"), "kısmi rapor da görünür");
  const gecmis = await ok(T.tekno, `/taseron-saha/teknocenter/bildirim/${raporId}/gecmis`);
  assert.equal(gecmis.surumler.length, 1); assert.equal(gecmis.surumler[0].eski.aciklama, null);
  // PR akışı
  assert.equal((await istek(T.tekno, `/taseron-saha/teknocenter/bildirim/${raporId}/inceleme`, { method: "POST", govde: { pr_durum: "PR_HAZIRLANDI" } })).durum, 400, "PR no zorunlu");
  await ok(T.tekno, `/taseron-saha/teknocenter/bildirim/${raporId}/inceleme`, { method: "POST", govde: { pr_durum: "PR_HAZIRLANDI", pr_ref: "PR-53901", not: "Etiket fotoğrafı eklendi, teşekkürler", istek_anahtari: anahtar() } });
  const ikinci = await istek(T.tekno, `/taseron-saha/teknocenter/bildirim/${raporId}/inceleme`, { method: "POST", govde: { pr_durum: "PR_HAZIRLANDI", pr_ref: "PR-99999" } });
  assert.equal(ikinci.durum, 409); assert.equal(ikinci.veri.kod, "pr_var");
  const kisim = tk.rows.find((x) => x.tur === "KISMI");
  const ayni = await istek(T.tekno, `/taseron-saha/teknocenter/bildirim/${kisim.id}/inceleme`, { method: "POST", govde: { pr_durum: "PR_HAZIRLANDI", pr_ref: "PR-53902" } });
  assert.equal(ayni.durum, 409); assert.equal(ayni.veri.kod, "ayni_saha_pr", "aynı iş kodundan ikinci PR onaysız açılmaz");
  // İnceleme sonrası taşeron düzeltemez; Teknocenter notu taşerona görünür (PR numarası görünmez)
  assert.equal((await istek(T.c1, `/taseron-saha/bildirim/${raporId}`, { method: "PUT", govde: { aciklama: "değişiklik" } })).durum, 409);
  const d2 = await ok(T.c1, "/taseron-saha/is/BU8001_NR700");
  const r2 = d2.is.raporlar.find((x) => x.id === raporId);
  assert.equal(r2.teknocenter_notu, "Etiket fotoğrafı eklendi, teşekkürler"); assert.equal(r2.pr_durum, "PR_HAZIRLANDI"); assert.equal(r2.pr_ref, undefined);
  assert.equal((await q(`SELECT COUNT(*)::int n FROM master_works WHERE site_code = 'BU8001_NR700'`)).rows[0].n, 0, "otomatik PR / Günlük İş kalemi oluşmaz");
});

test("yetki sınırları ve fiyat / başka firma sızıntısı", async () => {
  assert.equal((await istek(T.c1, "/taseron-saha/teknocenter/bildirimler")).durum, 403, "taşeron Teknocenter ucuna giremez");
  assert.equal((await istek(T.emrah, `/taseron-saha/teknocenter/bildirim/${raporId}/inceleme`, { method: "POST", govde: { pr_durum: "INCELENDI" } })).durum, 403);
  assert.equal((await istek(T.tekno, "/taseron-saha/isler")).durum, 403, "taşeron olmayan hesap taşeron saha listesine giremez");
  assert.equal((await istek(T.emrah, "/taseron-saha/yonetim/firma/1")).durum, 403);
  for (const [tok, yol] of [[T.emrah, "/taseron-saha/isler"], [T.ikikx, "/taseron-saha/isler"], [T.ikikx, "/taseron-saha/is/BU8009_NR700"], [T.c1, "/taseron-saha/is/BU8001_NR700"], [T.c1, "/auth/me"]]) {
    const r = await istek(tok, yol);
    const s = JSON.stringify(r.veri);
    assert.ok(!FIYAT_ANAHTARI.test(s), `${yol}: fiyat / mali alan: ${(s.match(FIYAT_ANAHTARI) || [])[0]}`);
    assert.ok(!GIZLI.test(s), `${yol}: gizli metin / fiyat değeri`);
  }
});

test("üyelik yönetimi: Teknocenter rol / ekip atar, başka firmanın ekibi reddedilir", async () => {
  const em = (await q(`SELECT id FROM subcons WHERE subcon_name = 'TEKNO_EMRAH'`)).rows[0].id;
  const f = await ok(T.tekno, `/taseron-saha/yonetim/firma/${em}`);
  assert.deepEqual(f.ekipler.map((e) => e.ekip_no).sort(), [302, 303]);
  const uid = f.hesaplar.find((h) => h.email === E.firma).id;
  assert.equal((await istek(T.tekno, `/taseron-saha/yonetim/uye/${uid}`, { method: "PUT", govde: { rol: "CALISAN", ekip_no: 311 } })).durum, 400, "2KX ekibi EMRAH hesabına verilemez");
  await ok(T.tekno, `/taseron-saha/yonetim/uye/${uid}`, { method: "PUT", govde: { rol: "CALISAN", ekip_no: 303 } });
  assert.deepEqual(kodlar(await ok(T.firma, "/taseron-saha/isler")), ["BU8002_NR700"]);
  await q(`DELETE FROM taseron_saha_uye WHERE user_id = $1`, [uid]);
});
test.after(() => db?.end());

test("hesap yönetimi: firma listesi, hesap açma (rol + ekip), mükerrer ad, kapsam, şifre sıfırlama, hesap kapatma", async () => {
  const em = (await q(`SELECT id FROM subcons WHERE subcon_name = 'TEKNO_EMRAH'`)).rows[0].id;
  const b2 = (await q(`SELECT id FROM subcons WHERE subcon_name = '2KX'`)).rows[0].id;
  // Her çalıştırmada yeni kullanıcı adı (hesap silinip aynı adla açılırsa sunucunun e-posta→kimlik önbelleği eski kimliği tutar)
  const ek = Date.now().toString(36), Y1 = `emrah.yeni.${ek}`, Y2 = `iztas.yeni.${ek}`;
  // Teknocenter yöneticisi yalnız kendi kapsamındaki firmaları görür
  // 06.11.2026: liste yalnız RF portalındaki firmalar; kapsama eklenecek firma araması (aday=1) yine yöneticinin kapsamıyla sınırlı
  const fl = await ok(T.tekno, "/taseron-saha/yonetim/firmalar?aday=1&q=2KX");
  assert.ok(fl.firmalar.some((f) => f.kod === "TEKNO_2KX") && !fl.firmalar.some((f) => f.kod === "2KX"), "bağımsız 2KX Teknocenter aday listesinde yok");
  assert.equal(fl.hesap_acabilir, true);
  assert.equal((await istek(T.emrah, "/taseron-saha/yonetim/firmalar")).durum, 403, "taşeron yönetim listesine giremez");
  // Hesap aç
  const zayif = await istek(T.tekno, "/taseron-saha/yonetim/hesap", { method: "POST", govde: { taseron_id: em, ad: "Emrah Yeni", kullanici_adi: Y1, sifre: "kisa", rol: "CALISAN", ekip_no: 303 } });
  assert.equal(zayif.durum, 400);
  assert.equal((await istek(T.tekno, "/taseron-saha/yonetim/hesap", { method: "POST", govde: { taseron_id: em, ad: "Emrah Yeni", kullanici_adi: Y1, sifre: "Saha2026x", rol: "CALISAN", ekip_no: 311 } })).durum, 400, "başka firmanın ekibi");
  assert.equal((await istek(T.tekno, "/taseron-saha/yonetim/hesap", { method: "POST", govde: { taseron_id: b2, ad: "X", kullanici_adi: Y1, sifre: "Saha2026x", rol: "CALISAN" } })).durum, 404, "kapsam dışı firma");
  const a = await ok(T.tekno, "/taseron-saha/yonetim/hesap", { method: "POST", govde: { taseron_id: em, ad: "Emrah Yeni", kullanici_adi: Y1, sifre: "Saha2026x", rol: "CALISAN", ekip_no: 303 } });
  assert.equal(a.kullanici.yetki, "CALISAN"); assert.equal(JSON.stringify(a).includes("Saha2026x"), false, "şifre yanıtta dönmez");
  assert.equal((await istek(T.tekno, "/taseron-saha/yonetim/hesap", { method: "POST", govde: { taseron_id: em, ad: "Başka", kullanici_adi: Y1, sifre: "Saha2026x", rol: "CALISAN", ekip_no: 303 } })).durum, 409, "aynı kullanıcı adı");
  assert.equal((await istek(T.tekno, "/taseron-saha/yonetim/hesap", { method: "POST", govde: { taseron_id: em, ad: "Erc Hesabı", kullanici_adi: E.erc, sifre: "Saha2026x", rol: "CALISAN", ekip_no: 303 } })).durum, 409, "var olan ERC hesabı ele geçirilemez");
  // Yeni hesap giriş yapar, yalnız kendi ekibini görür
  const tk = (await ok(null, "/auth/login", { method: "POST", govde: { email: Y1, password: "Saha2026x" } })).token;
  const v = await ok(tk, "/taseron-saha/isler");
  assert.equal(v.rol, "CALISAN"); assert.deepEqual(kodlar(v), ["BU8002_NR700"]);
  const u = (await q(`SELECT role, marka, kullanici_tipi, taseron_id FROM users WHERE email = $1`, [Y1])).rows[0];
  assert.deepEqual([u.role, u.marka, u.kullanici_tipi, u.taseron_id], ["subcon", "TEKNO", "TASERON", em]);
  // Şifre sıfırla → eski şifre geçmez, yeni geçer; hesap kapat → giriş yok
  await ok(T.tekno, `/taseron-saha/yonetim/hesap/${a.kullanici.id}`, { method: "PUT", govde: { sifre: "Yeni2026y" } });
  assert.notEqual((await istek(null, "/auth/login", { method: "POST", govde: { email: Y1, password: "Saha2026x" } })).durum, 200);
  await ok(null, "/auth/login", { method: "POST", govde: { email: Y1, password: "Yeni2026y" } });
  await ok(T.tekno, `/taseron-saha/yonetim/hesap/${a.kullanici.id}`, { method: "PUT", govde: { hesap_aktif: false } });
  assert.notEqual((await istek(null, "/auth/login", { method: "POST", govde: { email: Y1, password: "Yeni2026y" } })).durum, 200, "kapalı hesap giriş yapamaz");
  // ERC dışı / taşeron olmayan kullanıcıya şifre ucu çalışmaz
  const ercId = (await q(`SELECT id FROM users WHERE email = $1`, [E.erc])).rows[0].id;
  assert.equal((await istek(T.tekno, `/taseron-saha/yonetim/hesap/${ercId}`, { method: "PUT", govde: { sifre: "Ele2026gec" } })).durum, 404);
  // Ana firması boş taşeron (İZTAŞ) için ERC yöneticisi ana firmayı seçer
  const iz = (await q(`SELECT id FROM subcons WHERE subcon_name = 'TEKNO_İZTAŞ'`)).rows[0].id;
  const b = await ok(T.erc, "/taseron-saha/yonetim/hesap", { method: "POST", govde: { taseron_id: iz, ad: "İztaş Yeni", kullanici_adi: Y2, sifre: "Saha2026x", rol: "SORUMLU", marka: "TEKNO" } });
  assert.equal((await q(`SELECT marka FROM users WHERE id = $1`, [b.kullanici.id])).rows[0].marka, "TEKNO");
});
