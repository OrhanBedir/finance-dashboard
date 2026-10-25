// Uçtan uca API testi — YALNIZ yerel test sunucusuna (127.0.0.1:5099, sahte veri) karşı çalışır.
// Uygulamanın kullandığı uçları, aynı gövdelerle ve uygulamanın iş mantığı modülleriyle çağırır.
// Çalıştırma: YEREL_API=http://127.0.0.1:5099 node --test test/yerel/uctan_uca.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { hesapDurumu, yoldakiler } from "../../src/mantik/hesap.js";
import { avansEslesmesi } from "../../src/mantik/uzlastirma.js";
import { hataSinifla } from "../../src/mantik/hata.js";
import { kalemGonder } from "../../src/taslak/masrafGonder.js";

const API = process.env.YEREL_API;
const SIFRE = "Omnix-Test-2026";
if (!API || !/^http:\/\/127\.0\.0\.1:/.test(API)) { console.log("YEREL_API tanımlı değil — atlandı"); process.exit(0); }
const FIS = readFileSync(new URL("./fis.jpg", import.meta.url));

async function istek(token, yol, { method = "GET", govde, form } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (govde !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(API + yol, { method, headers: h, body: form || (govde !== undefined ? JSON.stringify(govde) : undefined) });
  const metin = await r.text();
  let veri; try { veri = JSON.parse(metin); } catch { veri = { _ham: metin }; }
  if (!r.ok || (veri && !Array.isArray(veri) && veri.ok === false)) throw hataSinifla(r.status, veri?.error || null);
  return veri;
}
const giris = async (e) => (await istek(null, "/auth/login", { method: "POST", govde: { email: e, password: SIFRE } }));

// Uygulamanın masrafApi'sinin node karşılığı (aynı yollar ve gövdeler)
function masrafApi(t, { kirpma = true } = {}) {
  const yukle = (yol, dosya) => { const f = new FormData(); f.append("dosya", new Blob([FIS], { type: "image/jpeg" }), dosya.ad || "fis.jpg"); return istek(t, yol, { method: "POST", form: f }); };
  return {
    form: (id) => istek(t, `/hr/masraf-form/${id}`),
    kalemEkle: (g) => istek(t, "/hr/masraf-kalem", { method: "POST", govde: g }),
    kalemGuncelle: (id, g) => istek(t, `/hr/masraf-kalem/${id}`, { method: "PUT", govde: g }),
    belgeYukle: (kid, d) => yukle(`/hr/masraf-belge/${kid}`, d),
    ...(kirpma ? {
      fisIsle: (kid, d) => yukle(`/hr/masraf-belge/${kid}/isle`, d),
      fisEkle: (kid, isl, sec) => istek(t, `/hr/masraf-belge/${kid}`, { method: "POST", govde: { isleme_id: isl, secimler: sec } }),
    } : {}),
  };
}
const depo = (t) => { const d = { t }; d.kaydet = async (x) => { d.t = JSON.parse(JSON.stringify(x)); return d.t; }; return d; };
let n = 0; const kimlik = () => `e2e${Date.now()}${++n}`.padEnd(12, "0");
const bugun = new Date().toISOString().slice(0, 10);

let ahmet, mehmet, orhan;
test.before(async () => {
  ahmet = await giris("saha.user@simsektel.com");
  mehmet = await giris("tekno.saha@teknocenter.test");
  orhan = await giris("orhan.bedir@simsektel.com");
});

test("giriş: firma kimliği backend oturumundan; pasif hesap reddedilir", async () => {
  const a = await istek(ahmet.token, "/auth/me");
  const m = await istek(mehmet.token, "/auth/me");
  assert.equal(m.user.marka, "TEKNO"); assert.equal(m.user.marka_ad, "Teknocenter");
  assert.equal(a.user.marka, "ERC"); assert.ok(a.user.marka_ad);
  await assert.rejects(giris("pasif@simsektel.com"), (e) => e.durumKodu === 403);
  await assert.rejects(giris("yok@yok.test"), (e) => e.durumKodu === 401);
  await assert.rejects(istek("bozuk.token", "/auth/me"), (e) => e.tur === "oturum");
});

test("hesap: negatif bakiye alacak olarak, pozitif bakiye avans olarak yorumlanır", async () => {
  const ha = await istek(ahmet.token, "/hr/is-avans/hesap");
  const d = hesapDurumu(ha.ozet.bakiye);
  assert.equal(ha.ozet.bakiye, -2250); assert.equal(d.tur, "alacak"); assert.equal(d.tutar, 2250);
  const y = yoldakiler(ha);
  assert.equal(y.avansTalepleri.adet, 1); assert.equal(y.onaydakiFormlar.adet, 1); assert.equal(y.masrafRozet, 1);
  const hm = await istek(mehmet.token, "/hr/is-avans/hesap");
  assert.equal(hm.ozet.bakiye, 3800); assert.equal(hesapDurumu(hm.ozet.bakiye).tur, "avans");
});

test("kapsam: Teknocenter personeli Şimşek personelinin verisini görmez (sorgu parametresi değiştirilse bile)", async () => {
  const avans = await istek(mehmet.token, "/hr/is-avans?email=saha.user%40simsektel.com");
  assert.ok(avans.every((r) => r.talep_eden_email !== "saha.user@simsektel.com"));
  const hesap = await istek(mehmet.token, "/hr/is-avans/hesap?email=saha.user%40simsektel.com");
  assert.equal(hesap.email, "tekno.saha@teknocenter.test");
  const pano = await istek(mehmet.token, "/hr/mobile-dashboard?email=saha.user%40simsektel.com&name=Ahmet");
  assert.equal(pano.personel?.email, "tekno.saha@teknocenter.test");
  const formlar = await istek(mehmet.token, "/hr/masraf-form");
  assert.ok(formlar.every((f) => f.talep_eden_email === "tekno.saha@teknocenter.test"));
});

test("kapsam: başkasının malzeme talebi / zimmeti / masraf formu görünmez (25.10.2026 backend düzeltmesi)", async () => {
  const mt = await istek(mehmet.token, "/malzeme/talepler?email=saha.user%40simsektel.com&name=x");
  assert.ok(!mt.some((x) => x.talep_eden_email === "saha.user@simsektel.com"), "başka kişinin e-postasıyla talep listesi");
  const mtTum = await istek(mehmet.token, "/malzeme/talepler");
  assert.ok(!mtTum.some((x) => x.talep_eden_email === "saha.user@simsektel.com"), "parametresiz talep listesi");
  const z = await istek(mehmet.token, "/malzeme/dagitim?personel_email=saha.user%40simsektel.com");
  assert.equal(z.length, 0, "başka kişinin zimmeti");
  const durum = async (tok, yol) => { try { await istek(tok, yol); return 200; } catch (e) { return e.durumKodu; } };
  const f = (await istek(ahmet.token, "/hr/masraf-form"))[0];
  assert.equal(await durum(mehmet.token, `/hr/masraf-form/${f.id}`), 403, "Teknocenter → Şimşek masraf formu");
  const g = (await istek(mehmet.token, "/hr/masraf-form"))[0];
  assert.equal(await durum(ahmet.token, `/hr/masraf-form/${g.id}`), 403, "Şimşek → Teknocenter masraf formu");
});

test("iş avansı: talep TALEP (Rollout Müdürü) ile başlar; bağlantı kopsa da uzlaştırma ikinci kaydı önler", async () => {
  const once = await istek(mehmet.token, "/hr/is-avans?email=tekno.saha%40teknocenter.test");
  const govde = { talep_eden_ad: "Mehmet Kaya", talep_eden_email: "tekno.saha@teknocenter.test", tarih: bugun, gider_turu: "Yakıt", bolge: "İzmir", proje: "TC - Türkcell", tutar: 1750.5, aciklama: "E2E yakıt", plaka: "35 TST 35", arac_km: 120500 };
  const r = await istek(mehmet.token, "/hr/is-avans", { method: "POST", govde });
  assert.equal(r.durum, "TALEP"); assert.equal(Number(r.tutar), 1750.5);
  // "yanıt kayboldu" senaryosu: uygulama tekrar göndermeden önce listeyi okur ve kaydı bulur
  const sonra = await istek(mehmet.token, "/hr/is-avans?email=tekno.saha%40teknocenter.test");
  const bulunan = avansEslesmesi(sonra, once.map((x) => x.id), govde);
  assert.equal(bulunan?.id, r.id);
});

test("masraf: taslağa devam → kalem + fiş (kırpma servisi, yapay zekâ anahtarı yokken orijinal) → çift ek yok → onaya gönder", async () => {
  const k = { email: "tekno.saha@teknocenter.test", name: "Mehmet Kaya" };
  const form = await istek(mehmet.token, "/hr/masraf-form", { method: "POST", govde: { talep_eden_email: k.email, talep_eden_ad: k.name, donem: bugun.slice(0, 7) } });
  assert.equal(form.durum, "TASLAK"); assert.equal(form.form_no, 104); // var olan taslak döner, yenisi açılmaz
  const api = masrafApi(mehmet.token);
  const d = depo({ id: "e2e", formId: form.id, alanlar: { kategori: "YAKIT", tarih: bugun, tutar: 900, aciklama: "E2E yakıt", plaka: "35 TST 35" }, fotolar: [{ uri: "fis.jpg", ad: "fis.jpg", mime: "image/jpeg" }], adim: {} });
  let kirpmaYaniti = null;
  const r = await kalemGonder({ taslak: d.t, kaydet: d.kaydet, api, kimlik, kirpmaSec: async (y) => { kirpmaYaniti = y; return [{ kirpma: "yok" }]; } });
  assert.ok(r.kalemId);
  assert.ok(kirpmaYaniti?.isleme_id, "kırpma servisi yanıt verdi");
  assert.equal(d.t.fotolar[0].durum, "yuklendi");
  // Aynı istek kimliğiyle tekrar (yanıt kaybolmuş gibi) → sunucu aynı eki döndürür
  const tekrar = await api.fisEkle(r.kalemId, kirpmaYaniti.isleme_id, [{ kirpma: "yok", istek_id: d.t.fotolar[0].istekler[0] }]);
  assert.equal(tekrar.zaten_var, true);
  const f2 = await api.form(form.id);
  const kalem = f2.kalemler.find((x) => x.id === r.kalemId);
  assert.equal(kalem.belgeler.length, 1, "fiş tek kez eklendi");
  assert.equal(kalem.plaka, "35 TST 35");

  // Eski sunucu davranışı (kırpma servisi yok): doğrudan yükleme
  const d2 = depo({ id: "e2e2", formId: form.id, alanlar: { kategori: "YEMEK", tarih: bugun, tutar: 180, aciklama: "E2E yemek" }, fotolar: [{ uri: "fis.jpg", ad: "fis2.jpg", mime: "image/jpeg" }], adim: {} });
  const r2 = await kalemGonder({ taslak: d2.t, kaydet: d2.kaydet, api: masrafApi(mehmet.token, { kirpma: false }), kimlik });
  assert.equal((await api.form(form.id)).kalemler.find((x) => x.id === r2.kalemId).belgeler.length, 1);

  // Fişsiz kalem
  const d3 = depo({ id: "e2e3", formId: form.id, alanlar: { kategori: "KOPRU", tarih: bugun, tutar: 95, aciklama: "Osmangazi" }, fotolar: [], fissiz: { aktif: true, aciklama: "HGS'den ödendi" }, adim: {} });
  const r3 = await kalemGonder({ taslak: d3.t, kaydet: d3.kaydet, api, kimlik });
  const k3 = (await api.form(form.id)).kalemler.find((x) => x.id === r3.kalemId);
  assert.equal(k3.fis_var, false); assert.equal(k3.fis_olmadan_aciklama, "HGS'den ödendi");

  // Onaya gönder; ikinci gönderim 422 → uygulama formu okuyup "gönderildi" sayar
  const g = await istek(mehmet.token, `/hr/masraf-form/${form.id}/submit`, { method: "PUT", govde: {} });
  assert.equal(g.durum, "ROLLOUT_BEKLE");
  await assert.rejects(istek(mehmet.token, `/hr/masraf-form/${form.id}/submit`, { method: "PUT", govde: {} }), (e) => e.durumKodu === 422);
  assert.notEqual((await api.form(form.id)).durum, "TASLAK");

  // Onaydaki forma uygulama kalem eklemez (kilit) ve fiş silinemez (backend)
  const d4 = depo({ id: "e2e4", formId: form.id, alanlar: { kategori: "YEMEK", tarih: bugun, tutar: 10 }, fotolar: [], fissiz: { aktif: true, aciklama: "x" }, adim: {} });
  await assert.rejects(kalemGonder({ taslak: d4.t, kaydet: d4.kaydet, api, kimlik }), (e) => e.kilit === true);
  const belgeId = kalem.belgeler[0].id;
  await assert.rejects(istek(mehmet.token, `/hr/masraf-belge/${belgeId}`, { method: "DELETE" }), (e) => e.durumKodu === 403);
  const hm = await istek(mehmet.token, "/hr/is-avans/hesap");
  assert.equal(yoldakiler(hm).onaydakiFormlar.adet, 1);
  assert.equal(hm.ozet.bakiye, 3800, "onaydaki form bakiyeye işlenmez");
});

test("onaycı: PM paneli yalnız yetkiliye; onay adımı backend'de ilerler", async () => {
  const p = await istek(orhan.token, `/hr/mobile-dashboard?email=orhan.bedir%40simsektel.com&name=Orhan`);
  assert.equal(p.isPM, true);
  const ahmetinki = p.onayBekleyenAvanslar.find((a) => a.talep_eden_email === "saha.user@simsektel.com");
  assert.ok(ahmetinki);
  const pa = await istek(ahmet.token, `/hr/mobile-dashboard?email=saha.user%40simsektel.com`);
  assert.equal(pa.isPM || pa.isDirektor || pa.isRM, false); assert.equal(pa.onayBekleyenAvanslar.length, 0);
  await assert.rejects(istek(ahmet.token, `/hr/is-avans/${ahmetinki.id}/onayla`, { method: "PUT", govde: { firma: "ERC" } }), (e) => e.durumKodu === 403);
  const r = await istek(orhan.token, `/hr/is-avans/${ahmetinki.id}/onayla`, { method: "PUT", govde: { firma: "ERC" } });
  assert.equal(r.durum, "PM_ONAY"); // RM + PM yetkisi tek dokunuşta; sıradaki: Proje Direktörü
  const h = await istek(ahmet.token, "/hr/is-avans/hesap");
  assert.equal(h.ozet.bakiye, -2250, "onaylanan ama ödenmeyen avans bakiyeye işlenmez");
});

test("malzeme: talep Rollout Müdürü onayıyla başlar; zimmet iadesi onaya düşer", async () => {
  const r = await istek(ahmet.token, "/malzeme/talepler", { method: "POST", govde: { talep_eden_email: "saha.user@simsektel.com", talep_eden_ad: "Ahmet Yılmaz", talep_tarihi: bugun, durum: "ROLLOUT_BEKLE", bolge: "Bursa", proje: "TC", site_id: "BU9999", notlar: "E2E", kalemler: [{ malzeme_adi: "Kablo", miktar: 10, birim: "Metre", birim_fiyat: 0, toplam_tutar: 0 }] } });
  assert.equal(r.durum, "ROLLOUT_BEKLE");
  const z = await istek(ahmet.token, "/malzeme/dagitim?personel_email=saha.user%40simsektel.com");
  const s = z.find((x) => x.durum === "PERSONELDE");
  const iade = await istek(ahmet.token, `/malzeme/dagitim/${s.id}/iade`, { method: "PUT", govde: { iade_miktar: 2, notlar: "E2E" } });
  assert.equal(iade.durum, "IADE_BEKLEMEDE"); assert.equal(Number(iade.iade_miktar), 2);
});

test("rollout işlerim: atanan iş listelenir, başlatılır, gün kapatılır", async () => {
  const require = createRequire(import.meta.url);
  const pg = require(require.resolve("pg", { paths: [process.env.NODE_PATH || ""] })); // yoksa test HATA verir, sessizce atlamaz
  const c = new pg.Client({ host: "127.0.0.1", port: 55432, user: "postgres", database: "omnix_test" });
  await c.connect();
  await istek(ahmet.token, "/is-atama/benim"); // tabloları oluşturur
  await c.query(`INSERT INTO is_kategori (kod, ad) VALUES ('MONTAJ','New Site Montaj') ON CONFLICT DO NOTHING`).catch(() => {});
  const id = (await c.query(`INSERT INTO is_atama (kategori, site_codes, personeller, plan_tarihi, atayan_ad, atayan_not) VALUES ('MONTAJ', '{BU1234}', $1, CURRENT_DATE, 'Merkez', 'Anahtar bekçide') RETURNING id`,
    [JSON.stringify([{ email: "saha.user@simsektel.com", ad: "Ahmet Yılmaz" }])])).rows[0].id;
  await c.end();
  const b = await istek(ahmet.token, "/is-atama/benim");
  assert.ok(b.bekleyen.some((x) => x.id === id));
  const m = await istek(mehmet.token, "/is-atama/benim");
  assert.ok(!m.bekleyen.some((x) => x.id === id), "başka firmanın personeline görünmez");
  await assert.rejects(istek(mehmet.token, `/is-atama/${id}/basla`, { method: "POST", govde: {} }), (e) => e.durumKodu === 403);
  const s = await istek(ahmet.token, `/is-atama/${id}/basla`, { method: "POST", govde: {} });
  assert.equal(s.row.durum, "BASLADI");
  const k = await istek(ahmet.token, `/is-atama/${id}/bitir`, { method: "POST", govde: { tamamlandi: false, sebep: "Yarın devam", not: null } });
  assert.equal(k.durum, "DEVAM");
});
