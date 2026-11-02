// Mobil saha haritası mantığı: il eşleştirme, filtreler, katmanlar, görünüm kutusu, yol tarifi
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOS_FILTRE, filtreSayisi, ilAdi, ilAnahtar, IL_MERKEZ, katmanlar, oranla, secenekler, sigdir, sinirla, suz, TUM_TURKIYE, yolTarifiAdresi } from "../src/harita/haritaMantik.js";
import { ILLER } from "../src/harita/iller.js";

const S = [
  { id: "BU1234", il: "BURSA", bolge: "Bursa", konum: { lat: 40.19, lng: 29.06 }, pin: { renk: "SARI", ad: "Takip gerekiyor" }, benim: true,
    taseronlar: ["TEKNO_EMRAH"], isler: [{ site_code: "BU1234_NR700", durum_ad: "Montaj devam", atanan_ekip: "Ekip 3", taseronlar: ["TEKNO_EMRAH"] }] },
  { id: "AN0001", il: null, yaklasik_il: "ANKARA", bolge: "Ankara", konum: null, pin: { renk: "MAVI" }, benim: false, taseronlar: [], isler: [{ site_code: "AN0001", durum_ad: "Planlandı" }] },
  { id: "AN0002", yaklasik_il: "Ankara", bolge: "Ankara", konum: null, pin: { renk: "YESIL" }, isler: [{ site_code: "AN0002" }] },
  { id: "AF0009", yaklasik_il: "AFYONKARAHİSAR", bolge: "İzmir", konum: null, pin: { renk: "GRI" }, isler: [] },
  { id: "XX0001", konum: null, isler: [] },
];

test("81 il ve il adı eşleştirme", () => {
  assert.equal(ILLER.length, 81);
  for (const il of ILLER) assert.ok(il.d.length > 20, il.ad);
  assert.equal(ilAnahtar("İZMİR"), ilAnahtar("İzmir"));
  assert.equal(ilAnahtar("AFYONKARAHİSAR"), ilAnahtar("Afyon"));
  assert.equal(ilAnahtar("İÇEL"), ilAnahtar("Mersin"));
  assert.equal(ilAnahtar("K.MARAŞ"), ilAnahtar("Kahramanmaraş"));
  assert.equal(ilAdi("ŞANLIURFA"), "Şanlıurfa");
  assert.ok(IL_MERKEZ[ilAnahtar("Iğdır")] && IL_MERKEZ[ilAnahtar("Çanakkale")]);
});

test("katmanlar: kesin pin, il balonu, konumsuz", () => {
  const k = katmanlar(S);
  assert.deepEqual(k.pinler.map((p) => p.s.id), ["BU1234"]);
  const an = k.balonlar.find((b) => b.ad === "Ankara");
  assert.equal(an.sahalar.length, 2);
  assert.equal(an.renk, "MAVI"); // MAVI, YESIL'den önce dikkat ister
  assert.ok(k.balonlar.find((b) => b.ad === "Afyon"));
  assert.deepEqual(k.konumsuz.map((s) => s.id), ["XX0001"]);
});

test("filtreler daraltır, birleşik çalışır", () => {
  assert.equal(suz(S, BOS_FILTRE).length, 5);
  assert.deepEqual(suz(S, { ...BOS_FILTRE, benim: true }).map((s) => s.id), ["BU1234"]);
  assert.deepEqual(suz(S, { ...BOS_FILTRE, bolge: ["Ankara"] }).map((s) => s.id), ["AN0001", "AN0002"]);
  assert.deepEqual(suz(S, { ...BOS_FILTRE, il: ["Ankara"], renk: ["YESIL"] }).map((s) => s.id), ["AN0002"]);
  assert.deepEqual(suz(S, { ...BOS_FILTRE, firma: ["TEKNO_EMRAH"] }).map((s) => s.id), ["BU1234"]);
  assert.deepEqual(suz(S, { ...BOS_FILTRE, ekip: ["Ekip 3"] }).map((s) => s.id), ["BU1234"]);
  assert.deepEqual(suz(S, { ...BOS_FILTRE, arama: "bu1234_nr" }).map((s) => s.id), ["BU1234"]);
  assert.equal(filtreSayisi({ ...BOS_FILTRE, benim: true, il: ["Ankara"] }), 2);
});

test("seçenekler sayılı gelir", () => {
  const o = secenekler(S);
  assert.deepEqual(o.il.find((x) => x.deger === "Ankara"), { deger: "Ankara", adet: 2 });
  assert.equal(o.renk.find((x) => x.deger === "SARI").adet, 1);
  assert.deepEqual(o.firma, [{ deger: "TEKNO_EMRAH", adet: 1 }]);
});

test("görünüm kutusu ekran oranında ve sınırlı", () => {
  const v = sigdir([{ x: 100, y: 100 }, { x: 300, y: 200 }], 0.5);
  assert.ok(Math.abs(v.w / v.h - 0.5) < 1e-9);
  assert.ok(v.x < 100 && v.x + v.w > 300 && v.y < 100 && v.y + v.h > 200);
  const bos = sigdir([], 2);
  assert.ok(Math.abs(bos.w / bos.h - 2) < 1e-9);
  const t = oranla(TUM_TURKIYE, 1);
  assert.equal(t.w, t.h);
  assert.ok(sinirla({ x: 0, y: 0, w: 1, h: 1 }, 1).w >= 6);
  assert.ok(sinirla({ x: 0, y: 0, w: 99999, h: 99999 }, 1).w <= TUM_TURKIYE.w * 1.6 + 1e-9);
});

test("yol tarifi: kesin konum koordinatla, yaklaşık yalnız il aramasıyla", () => {
  assert.equal(yolTarifiAdresi(S[0], "ios"), "http://maps.apple.com/?daddr=40.19,29.06&dirflg=d");
  assert.match(yolTarifiAdresi(S[0], "android"), /destination=40\.19,29\.06/);
  assert.equal(yolTarifiAdresi(S[1], "ios"), "http://maps.apple.com/?q=Ankara");
  assert.equal(yolTarifiAdresi(S[4], "ios"), null);
});
