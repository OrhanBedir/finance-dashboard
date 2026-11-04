// Taşeron saha ekranı saf mantığı: filtreler bağımsız, liste = harita, konumsuz iş haritaya girmez, form kuralları sunucuyla aynı
import test from "node:test";
import assert from "node:assert/strict";
import { filtreUyar, haritaSahalari, sayac, suz, tamamlaGovdesi, tamamlaHatalari } from "../src/mantik/taseronSaha.js";

const is = (kod, montaj, ek = {}) => ({ kod, fiziksel_id: kod.split("_")[0], montaj: { durum: montaj }, qc: { durum: ek.qc || null }, sorun: { var: !!ek.sorun },
  konum: ek.konum === undefined ? { lat: 40.2, lng: 29.1 } : ek.konum, il: "BURSA" });
const L = [is("BU1_NR700", "BEKLIYOR"), is("BU1_L1800", "DEVAM", { sorun: true }), is("BU2_NR700", "KISMI"), is("BU3_NR700", "TAMAMLANDI", { qc: "OK", sorun: true }),
  is("BU4_NR700", "KONTROL", { konum: null })];

test("filtreler: montaj / QC / sorun bağımsız; kısmi iş tamamlanan sayılmaz", () => {
  const s = sayac(L);
  assert.deepEqual(s, { tumu: 5, montaj_bekleyen: 1, devam: 3, tamamlanan: 1, qc_ok: 1, sorun: 2 });
  assert.equal(filtreUyar(L[2], "tamamlanan"), false);
  assert.ok(filtreUyar(L[3], "tamamlanan") && filtreUyar(L[3], "sorun") && filtreUyar(L[3], "qc_ok"));
});

test("arama: Site ID ya da tam iş kodu; filtreyle birlikte", () => {
  assert.deepEqual(suz(L, { arama: "bu1" }).map((x) => x.kod), ["BU1_NR700", "BU1_L1800"]);
  assert.deepEqual(suz(L, { arama: "bu1_l18", filtre: "sorun" }).map((x) => x.kod), ["BU1_L1800"]);
  assert.deepEqual(suz(L, { arama: "BU1", filtre: "montaj_bekleyen" }).map((x) => x.kod), ["BU1_NR700"]);
});

test("harita: aynı fiziksel sahanın işleri tek pin; konumsuz iş haritada noktasız kalır (uydurma konum yok)", () => {
  const h = haritaSahalari(L);
  const bu1 = h.find((x) => x.id === "BU1");
  assert.equal(bu1.isler.length, 2); assert.equal(bu1.pin.renk, "SARI", "devam eden iş bekleyenden önce"); assert.equal(bu1.sorun, true);
  const bu4 = h.find((x) => x.id === "BU4");
  assert.equal(bu4.konum, null); assert.equal(bu4.il, null); assert.equal(bu4.yaklasik_il, undefined, "il merkezine yaklaşık balon yok");
  assert.equal(h.reduce((a, x) => a + x.isler.length, 0), L.length, "liste ve harita aynı işler");
});

test("Montajı Tamamla formu", () => {
  assert.ok(tamamlaHatalari({ tur: null }).tur);
  assert.ok(tamamlaHatalari({ tur: "TAM", standart: false, aciklama: "" }).aciklama);
  assert.deepEqual(tamamlaHatalari({ tur: "TAM", standart: true, aciklama: "" }), {});
  const k = tamamlaHatalari({ tur: "KISMI", aciklama: "Anten takıldı", kalan_is: "" });
  assert.ok(k.kalan_is && !k.aciklama);
  const g = tamamlaGovdesi({ tur: "KISMI", standart: true, aciklama: " Anten ", kalan_is: "Enerji", sorun: "" }, "BU1_NR700", "anahtar-123456");
  assert.deepEqual(g, { onay_kod: "BU1_NR700", tur: "KISMI", standart: false, aciklama: "Anten", kalan_is: "Enerji", sorun: null, istek_anahtari: "anahtar-123456" });
});

test("harita katmanı: konumsuz saha pin / balon olmaz, 'konumsuz' sayılır", async () => {
  const { katmanlar } = await import("../src/harita/haritaMantik.js");
  const k = katmanlar(haritaSahalari(L));
  assert.equal(k.balonlar.length, 0); assert.deepEqual(k.konumsuz.map((s) => s.id), ["BU4"]); assert.equal(k.pinler.length, 3);
});
