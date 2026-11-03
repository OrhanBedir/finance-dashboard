// İş Atama uçtan uca — YALNIZ yerel test sunucusu (127.0.0.1:5099, atama_tohum.js kurgusu). Canlıya hiçbir istek gitmez.
// Doğrulanan zincir: mobil atama → web /is-atama/liste → doğru personelin /is-atama/benim; web ataması → mobil liste; ekip ve tekil
// kişi seçimi; tek / çoklu saha ve sahasız faaliyet; aynı Site ID'de farklı işler; tarih / ekip değişikliği, iptal, başlanmış iş devri;
// mobil başla / bitir / issue → yönetici listesi ve Weekly Plan; yetkisiz erişim ve Tekno kapsamı; çift gönderim, eş zamanlı atama.
// Çalıştırma: YEREL_API=http://127.0.0.1:5099 node --test test/yerel/atama_uctan_uca.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { govdeHazirla, BOS_FORM, ekiptenKisiler } from "../../src/mantik/atama.js";

const API = process.env.YEREL_API;
const SIFRE = "Omnix-Test-2026";
if (!API || !/^http:\/\/127\.0\.0\.1:/.test(API)) { console.log("YEREL_API tanımlı değil — atlandı"); process.exit(0); }
const E = { erc: "orhan.bedir@simsektel.com", tekno: "tekno.yonetici@teknocenter.test", sef1: "tekno.sef1@teknocenter.test", uye1: "tekno.uye1@teknocenter.test", emrah1: "emrah.uye1@teknocenter.test", personel: "saha.user@simsektel.com" };

async function istek(token, yol, { method = "GET", govde } = {}) {
  const h = { "x-istemci": "test" };
  if (token) h.Authorization = `Bearer ${token}`;
  if (govde !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(API + yol, { method, headers: h, body: govde !== undefined ? JSON.stringify(govde) : undefined });
  const metin = await r.text(); let veri; try { veri = JSON.parse(metin); } catch { veri = { _ham: metin }; }
  return { durum: r.status, veri };
}
const ok = async (...a) => { const r = await istek(...a); assert.equal(r.veri?.ok, true, `${a[1]} → ${r.durum} ${JSON.stringify(r.veri).slice(0, 300)}`); return r.veri; };
const giris = async (e) => (await ok(null, "/auth/login", { method: "POST", govde: { email: e, password: SIFRE } })).token;
const anahtar = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const bugun = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const gunEkle = (g, n) => { const d = new Date(`${g}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

let T = {};
test("girişler ve yetki", async () => {
  for (const [k, e] of Object.entries(E)) T[k] = await giris(e);
  assert.equal((await ok(T.erc, "/is-atama/yetkim")).yetkili, true);
  assert.equal((await ok(T.tekno, "/is-atama/yetkim")).yetkili, true, "Teknocenter direktörü İş Ata yetkili olmalı");
  assert.equal((await ok(T.sef1, "/is-atama/yetkim")).yetkili, false, "ekip şefi (user) yetkili değil");
  // yetkisiz: mobil uçlar 403 (menü gizlemek değil, API)
  for (const yol of ["/mobil/is-atama/baslangic", "/mobil/is-atama/liste", "/mobil/is-atama/ara?q=BU70"]) assert.equal((await istek(T.sef1, yol)).durum, 403, yol);
  assert.equal((await istek(T.sef1, "/mobil/is-atama", { method: "POST", govde: { kategori: "SURVEY", site_codes: ["BU7001_NR700"], personeller: [{ email: E.uye1, ad: "x" }] } })).durum, 403);
});

let B;
test("başlangıç verisi: kategoriler, Tekno ekipleri, ulaşım", async () => {
  B = await ok(T.erc, "/mobil/is-atama/baslangic");
  assert.ok(B.kategoriler.find((k) => k.kod === "NEW_SITE")?.tekil_site);
  assert.equal(B.kategoriler.find((k) => k.kod === "ARAC_BAKIM")?.saha_zorunlu, false);
  const e301 = B.ekipler.find((e) => e.ekip_no === 301), e302 = B.ekipler.find((e) => e.ekip_no === 302);
  assert.ok(e301 && e302, "iki Tekno ekibi");
  assert.equal(e301.tip, "INHOUSE"); assert.equal(e302.tip, "TASERON");
  assert.equal(e301.sef?.ad, "Tekno Şef Bir"); assert.equal(e301.plaka, "16TK301");
  assert.equal(e301.uyeler.find((u) => u.ad === "Tekno Üye İki").ulasir, false, "e-postasız üye ulaşmaz");
  assert.equal(e302.uyeler.find((u) => u.ad === "Emrah Üye İki").ulasir, false, "hesabı olmayan üye ulaşmaz");
  assert.match(e302.ulasim.mesaj, /Emrah Üye İki/);
  assert.ok(B.kisiler.some((k) => k.email === E.uye1));
  // Tekno yöneticisi: yalnız kendi firma ekipleri / personeli
  const BT = await ok(T.tekno, "/mobil/is-atama/baslangic");
  assert.deepEqual(BT.ekipler.map((e) => e.ekip_no).sort(), [301, 302]);
  assert.ok(BT.kisiler.every((k) => /teknocenter\.test$/.test(k.email)), "alt marka yalnız kendi bordrosu");
});

test("arama: 2 karakter, aynı sahada farklı işler, Tekno kapsamı dışı görünmez", async () => {
  const r = await ok(T.erc, "/mobil/is-atama/ara?q=BU70");
  const s1 = r.sahalar.find((s) => s.fiziksel_id === "BU7001");
  assert.ok(s1, "BU7001"); assert.deepEqual(s1.isler.map((i) => i.site_code).sort(), ["BU7001_L1800_AE", "BU7001_NR700"]);
  assert.ok(r.sahalar.find((s) => s.fiziksel_id === "BU7002"), "TEKNO_EMRAH sahası kapsamda");
  assert.ok(!r.sahalar.find((s) => s.fiziksel_id === "BU7003"), "AHY sahası Tekno kapsamı dışında");
  assert.equal((await ok(T.erc, "/mobil/is-atama/ara?q=B")).kisa, true);
});

let A1, A2;
test("mobil atama (ekip) → web listesi → ekibin İşlerim ekranı; not görünür; ulaşmayan belirtilir", async () => {
  const e301 = B.ekipler.find((e) => e.ekip_no === 301);
  const f = { ...BOS_FORM, kategori: "NEW_SITE", alt_tip: "NR700", isler: [{ site_code: "BU7001_NR700" }], ekip_no: 301, personeller: ekiptenKisiler(e301), plan_tarihi: gunEkle(bugun(), 1), atayan_not: "Anahtar bekçide" };
  const g = govdeHazirla(f);
  const k = await ok(T.erc, "/mobil/is-atama/kontrol", { method: "POST", govde: g });
  assert.equal(k.uygun, true); assert.equal(k.mukerrer.length, 0);
  const anah = anahtar();
  const r = await ok(T.erc, "/mobil/is-atama", { method: "POST", govde: { ...g, istek_anahtari: anah } });
  A1 = r.row.id;
  assert.equal(r.row.ekip_no, 301); assert.equal(r.row.arac_plaka, "16TK301");
  assert.deepEqual(r.ulasim.ulasan.map((x) => x.email).sort(), [E.sef1, E.uye1]);
  assert.equal(r.ulasim.eksik.length, 0, "e-postasız üye zaten listeye girmez");
  // çift gönderim: aynı anahtar → aynı kayıt, ikinci kayıt yok
  const r2 = await ok(T.erc, "/mobil/is-atama", { method: "POST", govde: { ...g, istek_anahtari: anah } });
  assert.equal(r2.tekrar, true); assert.equal(r2.row.id, A1);
  // web listesinde
  const web = await ok(T.erc, "/is-atama/liste?durum=ACIK");
  assert.ok(web.rows.find((x) => x.id === A1), "web İş Atama listesinde");
  // ekibin İşlerim ekranında (sef1 ve uye1), başkasında değil
  const b1 = await ok(T.sef1, "/is-atama/benim"); const is1 = b1.bekleyen.find((x) => x.id === A1);
  assert.ok(is1, "şef İşlerim'de"); assert.equal(is1.atayan_not, "Anahtar bekçide");
  assert.ok((await ok(T.uye1, "/is-atama/benim")).bekleyen.find((x) => x.id === A1));
  assert.ok(!(await ok(T.emrah1, "/is-atama/benim")).bekleyen.find((x) => x.id === A1), "başka ekipte yok");
  // mobil yönetici listesi (gelecek)
  const m = await ok(T.erc, "/mobil/is-atama/liste?filtre=gelecek");
  const kart = m.rows.find((x) => x.id === A1); assert.ok(kart); assert.equal(kart.ekip_ad, "Tekno Ekip 1"); assert.equal(kart.saatli, false);
  // mükerrer: aynı kategori + iş kodunda ikinci açık atama 409
  const d = await istek(T.erc, "/mobil/is-atama", { method: "POST", govde: { ...g, istek_anahtari: anahtar() } });
  assert.equal(d.durum, 409); assert.equal(d.veri.mukerrer[0].id, A1);
  // kontrol ucu da önceden gösterir
  assert.equal((await ok(T.erc, "/mobil/is-atama/kontrol", { method: "POST", govde: g })).uygun, false);
});

test("tekil kategori çoklu saha reddi; çoklu saha (SURVEY) tekil kişi seçimi; saatli görev Weekly Plan'da saatli", async () => {
  const d = await istek(T.erc, "/mobil/is-atama", { method: "POST", govde: { kategori: "NEW_SITE", alt_tip: "NR700", site_codes: ["BU7001_L1800_AE", "BU7002_NR700"], personeller: [{ email: E.emrah1, ad: "Emrah Üye Bir" }], plan_tarihi: gunEkle(bugun(), 2) } });
  assert.equal(d.durum, 400); assert.match(d.veri.error, /tek saha/);
  const gun = gunEkle(bugun(), 1);
  const r = await ok(T.erc, "/mobil/is-atama", { method: "POST", govde: { kategori: "SURVEY", site_codes: ["BU7001_L1800_AE", "BU7002_NR700"], personeller: [{ email: E.emrah1, ad: "Emrah Üye Bir" }],
    plan_baslangic: `${gun}T09:00:00+03:00`, plan_bitis: `${gun}T12:00:00+03:00`, istek_anahtari: anahtar() } });
  A2 = r.row.id;
  assert.equal(r.row.ekip_no, 302, "tek kişi tek ekibin üyesi → ekip çözüldü");
  assert.equal(String(r.row.plan_tarihi).slice(0, 10), gun);
  const det = await ok(T.erc, `/mobil/is-atama/${A2}`);
  assert.equal(det.row.planli, true, "saatli görev → plan bloğu");
  // Weekly Plan: ekip 302 sütununda saatli kart
  const hp = await ok(T.erc, `/operasyon/haftalik?hafta=${gun}&telefon=0`);
  const e302 = hp.ekipler.find((e) => Number(e.ekip_no) === 302);
  const kart = (e302?.kartlar || []).find((k) => k.atama_id === A2);
  assert.ok(kart, "Weekly Plan'da"); assert.equal(kart.saatli, true); assert.equal(kart.bas, "09:00");
  // Gün bazlı atama (A1) Weekly Plan'da saatsiz
  const k1 = (hp.ekipler.find((e) => Number(e.ekip_no) === 301)?.kartlar || []).find((k) => k.atama_id === A1);
  assert.ok(k1, "A1 Weekly Plan'da"); assert.equal(k1.saatli, false);
});

test("sahasız faaliyet (ARAC_BAKIM): Site ID yok, yer / açıklama ile", async () => {
  const d = await istek(T.erc, "/mobil/is-atama", { method: "POST", govde: { kategori: "ARAC_BAKIM", site_codes: [], personeller: [{ email: E.sef1, ad: "Tekno Şef Bir" }], plan_tarihi: gunEkle(bugun(), 3) } });
  assert.equal(d.durum, 400); assert.match(d.veri.error, /açıklama/);
  const r = await ok(T.erc, "/mobil/is-atama", { method: "POST", govde: { kategori: "ARAC_BAKIM", site_codes: [], konum_aciklama: "Bursa depo — periyodik bakım", personeller: [{ email: E.sef1, ad: "Tekno Şef Bir" }], plan_tarihi: gunEkle(bugun(), 3), istek_anahtari: anahtar() } });
  assert.equal(r.row.konum_aciklama, "Bursa depo — periyodik bakım");
  assert.ok((await ok(T.erc, "/mobil/is-atama/liste?filtre=gelecek")).rows.find((x) => x.id === r.row.id));
});

test("Tekno kapsamı: AHY sahasına mobilden atama 403; Tekno yöneticisi kendi dışına 403", async () => {
  const d = await istek(T.erc, "/mobil/is-atama", { method: "POST", govde: { kategori: "SURVEY", site_codes: ["BU7003_NR700"], personeller: [{ email: E.uye1, ad: "x" }], plan_tarihi: gunEkle(bugun(), 1) } });
  assert.equal(d.durum, 403, JSON.stringify(d.veri));
  const d2 = await istek(T.tekno, "/mobil/is-atama", { method: "POST", govde: { kategori: "SURVEY", site_codes: ["BU7003_NR700"], personeller: [{ email: E.uye1, ad: "x" }], plan_tarihi: gunEkle(bugun(), 1) } });
  assert.equal(d2.durum, 403);
  // Tekno yöneticisi ERC personeline atayamaz
  const d3 = await istek(T.tekno, "/mobil/is-atama", { method: "POST", govde: { kategori: "SURVEY", site_codes: ["BU7001_L1800_AE"], personeller: [{ email: E.personel, ad: "Ahmet" }], plan_tarihi: gunEkle(bugun(), 1) } });
  assert.equal(d3.durum, 403);
  // Tekno yöneticisi liste / detayda yalnız kapsam
  assert.ok((await ok(T.tekno, `/mobil/is-atama/${A1}`)).row);
});

test("web ataması → mobil yönetici listesinde; web PUT tarih değişince plan bloğu kayar", async () => {
  const gun = gunEkle(bugun(), 4);
  const w = await ok(T.erc, "/is-atama", { method: "POST", govde: { kategori: "MW", site_codes: ["BU7002_NR700"], personeller: [{ email: E.emrah1, ad: "Emrah Üye Bir" }], plan_tarihi: gun } });
  const id = w.row.id;
  const m = await ok(T.erc, "/mobil/is-atama/liste?filtre=gelecek");
  assert.ok(m.rows.find((x) => x.id === id), "web ataması mobil listede");
  // A2 (saatli) tarihini web PUT ile değiştir → segment aynı saatle yeni güne
  const yeni = gunEkle(bugun(), 5);
  await ok(T.erc, `/is-atama/${A2}`, { method: "PUT", govde: { plan_tarihi: yeni } }); // web ucu geriye uyumlu (ham DATE döner); mobil detay normalize eder
  const det = await ok(T.erc, `/mobil/is-atama/${A2}`);
  assert.equal(det.row.plan_tarihi, yeni);
  assert.equal(det.row.segmentler.length > 0, true);
  assert.equal(new Date(new Date(det.row.segmentler[0].bas).getTime() + 3 * 3600e3).toISOString().slice(0, 16), `${yeni}T09:00`);
  // eski sürümle güncelleme → 409
  const eski = await istek(T.erc, `/mobil/is-atama/${A2}`, { method: "PUT", govde: { atayan_not: "x", plan_surum: 1 } });
  assert.equal(eski.durum, 409);
});

test("mobil düzenleme: tarih / not; kişi değişikliği; iptal gerekçesiz 400, gerekçeli ok", async () => {
  const det = await ok(T.erc, `/mobil/is-atama/${A1}`);
  const yeni = gunEkle(bugun(), 2);
  const r = await ok(T.erc, `/mobil/is-atama/${A1}`, { method: "PUT", govde: { plan_tarihi: yeni, atayan_not: "Anahtar bekçide · sabah 9", plan_surum: det.row.plan_surum, gerekce: "ekip yarın başka işte" } });
  assert.equal(String(r.row.plan_tarihi).slice(0, 10), yeni); assert.equal(r.row.atayan_not, "Anahtar bekçide · sabah 9");
  assert.ok(r.row.gecmis.some((g) => g.tip === "PLAN_ZAMAN"));
  assert.equal((await ok(T.sef1, "/is-atama/benim")).bekleyen.find((x) => x.id === A1).atayan_not, "Anahtar bekçide · sabah 9", "not ekibin İşlerim detayında");
  // kişi çıkar (başlanmamış)
  const r2 = await ok(T.erc, `/mobil/is-atama/${A1}`, { method: "PUT", govde: { personeller: [{ email: E.sef1, ad: "Tekno Şef Bir" }], plan_surum: r.row.plan_surum } });
  assert.deepEqual(r2.row.personeller.map((p) => p.email), [E.sef1]);
  assert.ok(!(await ok(T.uye1, "/is-atama/benim")).bekleyen.find((x) => x.id === A1), "çıkarılan kişinin listesinden kalktı");
  // iptal
  const g = await istek(T.erc, `/mobil/is-atama/${A1}/iptal`, { method: "POST", govde: {} });
  assert.equal(g.durum, 400);
  const ip = await ok(T.erc, `/mobil/is-atama/${A1}/iptal`, { method: "POST", govde: { gerekce: "Saha ertelendi", plan_surum: r2.row.plan_surum } });
  assert.equal(ip.row.durum, "IPTAL"); assert.equal(ip.row.iptal_nedeni, "IPTAL");
  assert.ok(!(await ok(T.sef1, "/is-atama/benim")).bekleyen.find((x) => x.id === A1), "iptal → aktif listeden kalktı");
  assert.ok((await ok(T.erc, "/mobil/is-atama/liste?filtre=iptal")).rows.find((x) => x.id === A1));
  // tamamlanmış / iptal iş yeniden düzenlenmez
  assert.equal((await istek(T.erc, `/mobil/is-atama/${A1}`, { method: "PUT", govde: { atayan_not: "y" } })).durum, 400);
});

test("ekip değişikliği (başlanmamış) → eski ekipten kalkar, yeni ekibe gelir; malzeme devri yok", async () => {
  const det = await ok(T.erc, `/mobil/is-atama/${A2}`);
  const r = await ok(T.erc, `/mobil/is-atama/${A2}/devret`, { method: "POST", govde: { yeni_ekip_no: 301, gerekce: "Emrah ekibi başka işte", plan_surum: det.row.plan_surum } });
  assert.equal(r.eski_atama_id, A2); const yeni = r.yeni_atama_id;
  assert.ok(!(await ok(T.emrah1, "/is-atama/benim")).bekleyen.find((x) => x.id === A2), "eski ekipten kalktı");
  assert.ok((await ok(T.sef1, "/is-atama/benim")).bekleyen.find((x) => x.id === yeni), "yeni ekipte");
  const e = await ok(T.erc, `/mobil/is-atama/${A2}`);
  assert.equal(e.row.durum, "IPTAL"); assert.equal(e.row.iptal_nedeni, "DEVIR"); assert.equal(e.row.devir_hedef, yeni);
  A2 = yeni;
});

test("ekip başla / issue / gün kapat / tamamla → yönetici listesi + Weekly Plan; çift başla tek kayıt; başlanmış işte devir gerekçeli", async () => {
  const k1 = anahtar();
  const b1 = await ok(T.sef1, `/is-atama/${A2}/basla`, { method: "POST", govde: { istek_anahtari: k1 } });
  const b2 = await ok(T.sef1, `/is-atama/${A2}/basla`, { method: "POST", govde: { istek_anahtari: k1 } });
  assert.equal(b2.tekrar, true, "aynı anahtar ikinci kez işlenmez");
  assert.equal(b1.row.durum, "BASLADI");
  let m = await ok(T.erc, "/mobil/is-atama/liste?filtre=devam");
  assert.equal(m.rows.find((x) => x.id === A2)?.durum, "BASLADI", "yönetici listesinde BASLADI");
  // issue
  await ok(T.sef1, "/is-fiili/bildir", { method: "POST", govde: { is_atama_id: A2, site_code: "BU7001_L1800_AE", olay: "ISSUE", issue_turu: "Malzeme eksik", aciklama: "Jumper yok", istek_anahtari: anahtar() } });
  const det = await ok(T.erc, `/mobil/is-atama/${A2}`);
  assert.equal(det.row.fiili["BU7001_L1800_AE"]?.issue != null, true, "issue fiilî durumda");
  assert.equal(det.row.son_bildirimler.find((x) => x.site_code === "BU7001_L1800_AE")?.olay, "ISSUE");
  // başlanmış işte kişi değişikliği PUT ile olmaz → devir akışı
  const p = await istek(T.erc, `/mobil/is-atama/${A2}`, { method: "PUT", govde: { personeller: [{ email: E.emrah1, ad: "Emrah" }], plan_surum: det.row.plan_surum } });
  assert.equal(p.durum, 409); assert.equal(p.veri.kalan_devir_gerekli, true);
  const d0 = await istek(T.erc, `/mobil/is-atama/${A2}/devret`, { method: "POST", govde: { yeni_ekip_no: 302, gerekce: "Kalan iş Emrah'a", plan_surum: det.row.plan_surum } });
  assert.equal(d0.durum, 409); assert.equal(d0.veri.kalan_devir_gerekli, true, "kalan_devir onayı olmadan taşınmaz");
  // gün kapat (devam)
  const c1 = await ok(T.sef1, `/is-atama/${A2}/bitir`, { method: "POST", govde: { tamamlandi: false, sebep: "Yarın devam", calisanlar: [{ email: E.sef1, ad: "Tekno Şef Bir" }], istek_anahtari: anahtar() } });
  assert.equal(c1.row.durum, "DEVAM");
  const gunler = (await ok(T.erc, `/mobil/is-atama/${A2}`)).row.gunler.length;
  assert.ok(gunler >= 1, "gün kaydı");
  // kalan işi devret (gerekçeli): eski gün kayıtları korunur, yeni atama
  const dv = await ok(T.erc, `/mobil/is-atama/${A2}/devret`, { method: "POST", govde: { yeni_ekip_no: 302, gerekce: "Kalan iş Emrah'a", kalan_devir: true, ulasim_onay: true } });
  const yeni = dv.yeni_atama_id;
  const eskiDet = await ok(T.erc, `/mobil/is-atama/${A2}`);
  assert.equal(eskiDet.row.iptal_nedeni, "KALAN_DEVIR"); assert.equal(eskiDet.row.gunler.length, gunler, "önceki çalışma kayıtları silinmedi");
  assert.ok((await ok(T.emrah1, "/is-atama/benim")).bekleyen.find((x) => x.id === yeni), "yeni ekipte");
  // eski ekipten geç bildirim → inceleme (409), kaybolmaz
  const gec = await istek(T.sef1, `/is-atama/${A2}/basla`, { method: "POST", govde: { istek_anahtari: anahtar() } });
  assert.equal(gec.durum, 409); assert.equal(gec.veri.inceleme, true);
  assert.ok((await ok(T.erc, "/plan/inceleme")).bekleyen.some((x) => x.is_atama_id === A2));
  // yeni ekip tamamlar → yönetici listesi tamamlanan; fiziksel tamamlanma ve QC ayrı
  await ok(T.emrah1, `/is-atama/${yeni}/basla`, { method: "POST", govde: { istek_anahtari: anahtar() } });
  const bt = await ok(T.emrah1, `/is-atama/${yeni}/bitir`, { method: "POST", govde: { tamamlandi: true, calisanlar: [{ email: E.emrah1, ad: "Emrah Üye Bir" }], istek_anahtari: anahtar() } });
  assert.equal(bt.row.durum, "TAMAMLANDI");
  m = await ok(T.erc, "/mobil/is-atama/liste?filtre=tamamlanan");
  assert.ok(m.rows.find((x) => x.id === yeni));
  assert.equal((await istek(T.erc, `/mobil/is-atama/${yeni}/iptal`, { method: "POST", govde: { gerekce: "deneme" } })).durum, 400, "tamamlanmış iş iptal edilmez");
});

test("eş zamanlı web + mobil atama aynı işe → yalnız biri geçer", async () => {
  const g = { kategori: "GPS", site_codes: ["BU7002_NR700"], personeller: [{ email: E.emrah1, ad: "Emrah Üye Bir" }], plan_tarihi: gunEkle(bugun(), 6) };
  const [a, b] = await Promise.all([istek(T.erc, "/mobil/is-atama", { method: "POST", govde: { ...g, istek_anahtari: anahtar() } }), istek(T.tekno, "/is-atama", { method: "POST", govde: g })]);
  const durumlar = [a.durum, b.durum].sort();
  assert.deepEqual(durumlar, [200, 409], JSON.stringify([a.veri, b.veri]).slice(0, 300));
  const acik = (await ok(T.erc, "/is-atama/liste?durum=ACIK&kategori=GPS")).rows.filter((x) => (x.site_codes || []).includes("BU7002_NR700"));
  assert.equal(acik.length, 1, "tek açık GPS ataması");
});
