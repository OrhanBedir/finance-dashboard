// Taşeron Hakediş ve Cari + Yaptığımız Sahalar — saf görünüm mantığı (tutar hesabı yok; sunucu değerleri aynen kullanılır)
import test from "node:test";
import assert from "node:assert/strict";
import { cariKartlari, hakedisArama } from "../src/mantik/taseronCari.js";
import { gecmisSayac, gecmisSuz, bolgeler, suz } from "../src/mantik/taseronSaha.js";
import { sahaAcik, sahaRolu } from "../src/mantik/profil.js";

test("cari kartları sunucu değerini aynen taşır; fatura yoksa açık fatura kartı yok", () => {
  const k = cariKartlari({ is_bedeli: 73500, odenen: 150000, hakedis_kalan: 0, acik_avans: 76500, fatura_toplam: 0, fatura_kalan: 0 });
  assert.deepEqual(k.map((x) => x.deger), [73500, 150000, 0, 76500]);
  assert.equal(k.find((x) => x.kod === "is_bedeli").not, "KDV hariç");
  assert.equal(cariKartlari({ is_bedeli: 1, odenen: 0, hakedis_kalan: 1, acik_avans: 0, fatura_toplam: 1180, fatura_kalan: 180 }).length, 5);
  assert.deepEqual(cariKartlari(null), [], "veri yoksa kart (ve sıfır) üretilmez");
});

test("hakediş arama: Site ID, iş kodu, kalem kodu", () => {
  const L = [{ site_code: "BI0009_NR3500_MWA", fiziksel_id: "BI0009", item_code: "8818274542" }, { site_code: "KA3057_NR700_MWA", fiziksel_id: "KA3057", item_code: "8812489289" }];
  assert.equal(hakedisArama(L, "bi0009").length, 1);
  assert.equal(hakedisArama(L, "88124").length, 1);
  assert.equal(hakedisArama(L, "").length, 2);
});

const G = [
  { kod: "BU1_NR700", fiziksel_id: "BU1", bolge: "Ankara", sinif: "TAMAMLANDI", qc: { kod: "KAPANDI" }, montaj: { baslama: "2026-10-20", bitis: "2026-10-22" } },
  { kod: "BU1_NR3500", fiziksel_id: "BU1", bolge: "Ankara", sinif: "TEYIT", qc: { kod: "BASLADI" }, montaj: { baslama: "2026-11-02", bitis: null } },
  { kod: "BU2_NR700", fiziksel_id: "BU2", bolge: "Bursa", sinif: "KISMI", qc: { kod: "BILINMIYOR" }, montaj: { baslama: "2026-11-03", bitis: null } },
];
test("Yaptığımız Sahalar filtreleri: QC grupları montaj sınıfından bağımsız; tarih / bölge / arama", () => {
  const s = gecmisSayac(G);
  assert.deepEqual(s, { tumu: 3, tamamlandi: 1, qc_basladi: 1, qc_kapandi: 1, devam: 1, teyit: 1 });
  assert.deepEqual(gecmisSuz(G, { filtre: "qc_basladi" }).map((x) => x.kod), ["BU1_NR3500"]);
  assert.deepEqual(gecmisSuz(G, { bolge: "Bursa" }).map((x) => x.kod), ["BU2_NR700"]);
  assert.deepEqual(gecmisSuz(G, { bas: "2026-11-01" }).map((x) => x.kod), ["BU1_NR3500", "BU2_NR700"], "1 Kasım öncesi gizlenmez; yalnız seçilirse süzülür");
  assert.deepEqual(gecmisSuz(G, { arama: "bu1" }).length, 2);
  assert.deepEqual(bolgeler(G), ["Ankara", "Bursa"]);
});

test("Sahalar kapsamı: firma / ekibim / bana", () => {
  const L = [{ kod: "A", fiziksel_id: "A", montaj: {}, qc: {}, sorun: {}, kapsam: { firma: true, ekibim: true, bana: false } },
    { kod: "B", fiziksel_id: "B", montaj: {}, qc: {}, sorun: {}, kapsam: { firma: true, ekibim: false, bana: true } }];
  assert.equal(suz(L, { kapsam: "firma" }).length, 2);
  assert.deepEqual(suz(L, { kapsam: "ekibim" }).map((x) => x.kod), ["A"]);
  assert.deepEqual(suz(L, { kapsam: "bana" }).map((x) => x.kod), ["B"]);
});

test("saha ekranı kapalı firma sorumlusu: rol korunur, Sahalar kapanır", () => {
  const k = { taseron_saha: { rol: "SORUMLU", saha_acik: false } };
  assert.equal(sahaRolu(k), "SORUMLU"); assert.equal(sahaAcik(k), false);
  assert.equal(sahaAcik({ taseron_saha: { rol: "SORUMLU", saha_acik: true } }), true);
  assert.equal(sahaAcik({}), true, "eski sunucu: alan yoksa açık");
  assert.equal(sahaAcik({ taseron_saha: { rol: "KAPALI" } }), false);
});

import { GRUP_FILTRELER, mesafeKm, yakinSahalar, yolTarifiAdresi, sayac as sahaSayac, filtreUyar } from "../src/mantik/taseronSaha.js";
import { finansVar } from "../src/mantik/profil.js";

test("durum grupları: bir iş birden çok gruba girebilir; QC bekleyen eksik sayılmaz", () => {
  const L = [{ kod: "A", gruplar: ["qc_bekleyen"], montaj: { durum: "TAMAMLANDI" }, qc: {}, sorun: {} },
    { kod: "B", gruplar: ["qc_ok", "eksik"], montaj: { durum: "TAMAMLANDI" }, qc: { durum: "OK" }, sorun: { var: true } },
    { kod: "C", gruplar: ["atanan"], montaj: { durum: "BEKLIYOR" }, qc: {}, sorun: {} }];
  const s = sahaSayac(L);
  assert.equal(s.qc_bekleyen, 1); assert.equal(s.eksik, 1); assert.equal(s.qc_ok, 1); assert.equal(s.atanan, 1);
  assert.equal(filtreUyar(L[0], "eksik"), false, "QC bekleyen iş eksik montaj değildir");
  assert.equal(GRUP_FILTRELER.length, 6);
});

test("yakınımdaki sahalar: kuş uçuşu, konumsuz sahaya mesafe yok, açık eksik önce", () => {
  const ben = { lat: 41.0, lng: 32.6 };
  assert.ok(Math.abs(mesafeKm(ben, { lat: 41.1, lng: 32.6 }) - 11.1) < 0.2);
  assert.equal(mesafeKm(ben, null), null);
  const L = [{ kod: "Y1", konum: { lat: 41.02, lng: 32.6 } }, { kod: "Y2", konum: { lat: 41.04, lng: 32.6 }, cleanup: { kalem: 2 } },
    { kod: "U", konum: { lat: 42.0, lng: 32.6 } }, { kod: "K", konum: null }];
  const r = yakinSahalar(L, ben, 10);
  assert.deepEqual(r.yakin.map((x) => x.kod), ["Y2", "Y1"]); assert.equal(r.konumsuz, 1);
  assert.deepEqual(yakinSahalar(L, null, 10).yakin, [], "konum izni yoksa liste boş, uydurma yok");
  assert.match(yolTarifiAdresi({ lat: 41, lng: 32 }, "android"), /destination=41,32/);
  assert.equal(yolTarifiAdresi(null), null);
});

test("finans menüsü: yalnız firma sahibi (sorumlu + finans)", () => {
  assert.equal(finansVar({ taseron_saha: { rol: "SORUMLU", finans: true } }), true);
  assert.equal(finansVar({ taseron_saha: { rol: "SORUMLU", finans: false } }), false, "operasyon sorumlusu");
  assert.equal(finansVar({ taseron_saha: { rol: "CALISAN", finans: true } }), false);
  assert.equal(finansVar({}), true, "eski sunucu / eski hesap");
});
