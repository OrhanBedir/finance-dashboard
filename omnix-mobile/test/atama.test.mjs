// İş Atama form / özet / gövde mantığı (sunucu kurallarıyla aynı: tekil_site, saha_zorunlu, alt_tipler)
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOS_FORM, adimHatalari, formHatalari, govdeHazirla, ekiptenKisiler, isEkle, kisiEkle, kisiCikar, ozetSatirlari, kartAltSatir, zamanAyir, zamanBirlestir } from "../src/mantik/atama.js";

const NEW_SITE = { kod: "NEW_SITE", ad: "Yeni Saha Montajı", tekil_site: true, saha_zorunlu: true, alt_tipler: ["Standalone", "NR700"] };
const SURVEY = { kod: "SURVEY", ad: "Survey", tekil_site: false, saha_zorunlu: true, alt_tipler: [] };
const ARAC = { kod: "ARAC_BAKIM", ad: "Araç Bakım", tekil_site: false, saha_zorunlu: false, alt_tipler: [] };
const EKIP = { ekip_no: 3, ad: "Ekip 3", uyeler: [{ ad: "Ali", email: "ali@x.com", ulasir: true }, { ad: "Veli", email: null }, { ad: "Can", email: "can@x.com", ulasir: false }] };

test("kategori adımı: alt tip zorunlu", () => {
  assert.deepEqual(adimHatalari("kategori", { ...BOS_FORM }, null), ["İş kategorisi seçin"]);
  assert.equal(adimHatalari("kategori", { ...BOS_FORM, kategori: "NEW_SITE" }, NEW_SITE).length, 1);
  assert.equal(adimHatalari("kategori", { ...BOS_FORM, kategori: "NEW_SITE", alt_tip: "NR700" }, NEW_SITE).length, 0);
  assert.equal(adimHatalari("kategori", { ...BOS_FORM, kategori: "SURVEY" }, SURVEY).length, 0);
});

test("saha adımı: tekil / çoklu / sahasız", () => {
  const i1 = { site_code: "BU1234_NR700" }, i2 = { site_code: "BU1234_L1800_AE" };
  assert.equal(adimHatalari("saha", { ...BOS_FORM, isler: [] }, SURVEY).length, 1);
  assert.equal(adimHatalari("saha", { ...BOS_FORM, isler: [i1, i2] }, SURVEY).length, 0);
  assert.match(adimHatalari("saha", { ...BOS_FORM, isler: [i1, i2] }, NEW_SITE)[0], /tek iş kodu/);
  assert.equal(adimHatalari("saha", { ...BOS_FORM, isler: [] }, ARAC).length, 1);
  assert.equal(adimHatalari("saha", { ...BOS_FORM, isler: [], konum_aciklama: "Bursa depo" }, ARAC).length, 0);
  // tekil kategoride ikinci seçim öncekinin yerine geçer
  assert.deepEqual(isEkle([i1], i2, true), [i2]);
  assert.deepEqual(isEkle([i1], i2, false), [i1, i2]);
  assert.deepEqual(isEkle([i1], i1, false), [i1]);
});

test("ekip → kişiler: yalnız e-postalı üyeler, ulaşım bilgisi korunur", () => {
  const k = ekiptenKisiler(EKIP);
  assert.deepEqual(k.map((x) => x.email), ["ali@x.com", "can@x.com"]);
  assert.equal(k[1].ulasir, false);
  assert.equal(kisiEkle(k, { email: "ali@x.com", ad: "Ali" }).length, 2);
  assert.equal(kisiCikar(k, "ali@x.com").length, 1);
});

test("zaman adımı ve gövde: saat yalnız girildiyse gönderilir", () => {
  const f = { ...BOS_FORM, kategori: "SURVEY", isler: [{ site_code: "BU1234_NR700" }], personeller: ekiptenKisiler(EKIP), ekip_no: 3, plan_tarihi: "2026-11-05" };
  assert.deepEqual(formHatalari(f, SURVEY), []);
  const g = govdeHazirla(f);
  assert.equal(g.plan_baslangic, undefined);
  assert.deepEqual(g.site_codes, ["BU1234_NR700"]);
  assert.equal(g.ekip_no, 3);
  const s = govdeHazirla({ ...f, saatli: true, bas_saat: "09:00", bit_saat: "16:00" });
  assert.equal(s.plan_baslangic, "2026-11-05T09:00:00+03:00");
  assert.equal(zamanAyir(s.plan_bitis).saat, "16:00");
  assert.match(adimHatalari("zaman", { ...f, saatli: true, bas_saat: "17:00", bit_saat: "09:00" }, SURVEY)[0], /sonra/);
  assert.equal(zamanBirlestir("2026-11-05", "08:30"), "2026-11-05T08:30:00+03:00");
});

test("özet: ulaşmayan kişi uyarısı", () => {
  const f = { ...BOS_FORM, kategori: "SURVEY", isler: [{ site_code: "BU1234_NR700" }], personeller: ekiptenKisiler(EKIP), ekip_no: 3, plan_tarihi: "2026-11-05", atayan_not: "Anahtar depoda" };
  const o = ozetSatirlari(f, SURVEY, [EKIP]);
  assert.equal(o.find((x) => x.etiket === "Ekip").deger, "Ekip 3 · Ali, Can");
  assert.equal(o.find((x) => x.etiket === "Tarih").deger, "05.11.2026 (gün)");
  assert.match(o.find((x) => x.uyari).deger, /Can.*ULAŞMAZ/);
});

test("liste kartı alt satırı", () => {
  assert.equal(kartAltSatir({ ekip_ad: "Ekip 3", kisi_sayisi: 2, plan_tarihi: "2026-11-05", saatli: true, plan_baslangic: "2026-11-05T06:00:00.000Z" }), "Ekip 3 (2) · 05.11.2026 09:00");
  assert.equal(kartAltSatir({ kisiler: ["Ali", "Veli", "Can"], plan_tarihi: "2026-11-01", geciken: true }), "Ali, Veli +1 · 01.11.2026 · gecikti");
  assert.equal(kartAltSatir({ kisiler: [], taseron: true }), "Taşeron · tarihsiz");
});
