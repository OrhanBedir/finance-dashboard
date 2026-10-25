import test from "node:test";
import assert from "node:assert/strict";
import { kalemGonder } from "../src/taslak/masrafGonder.js";
import { ApiHatasi } from "../src/mantik/hata.js";

// Sahte sunucu: form + kalemler + belgeler bellekte; "kopma" ile isteğin işlenip yanıtın kaybolması taklit edilir
function sahteSunucu({ durum = "TASLAK", isleVar = false } = {}) {
  const s = { form: { id: 10, durum, kalemler: [{ id: 1, kategori: "YEMEK", tutar: 50, belgeler: [] }] }, sayac: { kalem: 0, belge: 0, isle: 0, ekle: 0 }, sonrakiId: 100, kop: {} };
  const kopar = (ad, islendiMi) => {
    if (s.kop[ad] === undefined) return false;
    const islendi = s.kop[ad]; delete s.kop[ad];
    if (!islendi) throw new ApiHatasi("ag", "ağ yok");
    return () => { throw new ApiHatasi("ag", "yanıt kayboldu"); };
  };
  const istekKimlikleri = new Map();
  s.api = {
    form: async () => JSON.parse(JSON.stringify(s.form)),
    kalemEkle: async (g) => {
      const k = kopar("kalem"); // false: normal, fonksiyon: işlendi ama yanıt kayboldu
      s.sayac.kalem++; const yeni = { id: s.sonrakiId++, ...g, belgeler: [] }; s.form.kalemler.push(yeni);
      if (k) k(); return yeni;
    },
    kalemGuncelle: async (id, g) => { const k = s.form.kalemler.find((x) => x.id === id); Object.assign(k, g); return k; },
    belgeYukle: async (kid) => {
      const k = kopar("belge");
      s.sayac.belge++; const b = { id: s.sonrakiId++, ocr_tutar: 300 }; s.form.kalemler.find((x) => x.id === kid).belgeler.push(b);
      if (k) k(); return b;
    },
    fisIsle: async () => {
      s.sayac.isle++;
      if (!isleVar) throw new ApiHatasi("bulunamadi", "Kayıt bulunamadı", { durumKodu: 404, sunucuMesaji: null });
      return { isleme_id: 55, durum: "GUVENILIR", adaylar: [{ no: 1 }] };
    },
    fisEkle: async (kid, isl, secimler) => {
      const k = kopar("ekle");
      const sonuc = secimler.map((sc) => {
        if (istekKimlikleri.has(sc.istek_id)) return { ...istekKimlikleri.get(sc.istek_id), zaten_var: true };
        s.sayac.ekle++; const b = { id: s.sonrakiId++, ocr_tutar: null }; istekKimlikleri.set(sc.istek_id, b);
        s.form.kalemler.find((x) => x.id === kid).belgeler.push(b); return b;
      });
      if (k) k(); return { ...sonuc[0], belgeler: sonuc };
    },
  };
  return s;
}

const taslakYap = (ek = {}) => ({ id: "t1", formId: 10, alanlar: { kategori: "YAKIT", tarih: "2026-10-24", tutar: 300, aciklama: "Bursa", plaka: "16 ab 1" }, fotolar: [{ uri: "f1", ad: "f1.jpg", mime: "image/jpeg", durum: "bekliyor" }], adim: {}, ...ek });
function depo(t) { const d = { t }; d.kaydet = async (x) => { d.t = JSON.parse(JSON.stringify(x)); return d.t; }; return d; }
let n = 0; const kimlik = () => `istek-${String(++n).padStart(6, "0")}`;

test("normal gönderim: bir kalem, bir fiş", async () => {
  const s = sahteSunucu(); const d = depo(taslakYap());
  const r = await kalemGonder({ taslak: d.t, kaydet: d.kaydet, api: s.api, kimlik });
  assert.equal(s.sayac.kalem, 1); assert.equal(s.sayac.belge, 1);
  assert.equal(d.t.fotolar[0].durum, "yuklendi");
  assert.equal(r.uyarilar.length, 0);
  assert.equal(s.form.kalemler.at(-1).plaka, "16 AB 1");
});

test("kalem kaydedildi ama yanıt kayboldu → tekrar denemede ikinci kalem oluşmaz", async () => {
  const s = sahteSunucu(); const d = depo(taslakYap());
  s.kop.kalem = true;
  await assert.rejects(kalemGonder({ taslak: d.t, kaydet: d.kaydet, api: s.api, kimlik }), (e) => e.sonucBelirsiz);
  assert.equal(d.t.adim.kalemDenendi, true);
  await kalemGonder({ taslak: d.t, kaydet: d.kaydet, api: s.api, kimlik });
  assert.equal(s.sayac.kalem, 1);
  assert.equal(s.form.kalemler.filter((k) => k.kategori === "YAKIT").length, 1);
  assert.equal(s.sayac.belge, 1);
});

test("istek sunucuya hiç ulaşmadı → tekrar denemede bir kez kaydedilir", async () => {
  const s = sahteSunucu(); const d = depo(taslakYap());
  s.kop.kalem = false;
  await assert.rejects(kalemGonder({ taslak: d.t, kaydet: d.kaydet, api: s.api, kimlik }));
  assert.equal(s.sayac.kalem, 0);
  await kalemGonder({ taslak: d.t, kaydet: d.kaydet, api: s.api, kimlik });
  assert.equal(s.sayac.kalem, 1);
});

test("fiş yüklendi ama yanıt kayboldu → ikinci kez yüklenmez", async () => {
  const s = sahteSunucu(); const d = depo(taslakYap());
  s.kop.belge = true;
  await assert.rejects(kalemGonder({ taslak: d.t, kaydet: d.kaydet, api: s.api, kimlik }));
  await kalemGonder({ taslak: d.t, kaydet: d.kaydet, api: s.api, kimlik });
  assert.equal(s.sayac.belge, 1);
  assert.equal(d.t.fotolar[0].durum, "yuklendi");
});

test("onaya gönderilmiş forma kalem eklenmez", async () => {
  const s = sahteSunucu({ durum: "PM_BEKLE" }); const d = depo(taslakYap());
  await assert.rejects(kalemGonder({ taslak: d.t, kaydet: d.kaydet, api: s.api, kimlik }), (e) => e.kilit === true);
  assert.equal(s.sayac.kalem, 0);
});

test("kırpma servisi yoksa (eski sunucu) doğrudan yüklemeye düşer", async () => {
  const s = sahteSunucu({ isleVar: false }); const d = depo(taslakYap());
  await kalemGonder({ taslak: d.t, kaydet: d.kaydet, api: s.api, kimlik, kirpmaSec: async () => [{ aday_no: 1 }] });
  assert.equal(s.sayac.isle, 1); assert.equal(s.sayac.belge, 1); assert.equal(d.t.kirpmaServisiYok, true);
});

test("kırpma servisi: yanıt kaybolunca aynı istek kimliğiyle tekrar → çift ek yok", async () => {
  const s = sahteSunucu({ isleVar: true }); const d = depo(taslakYap());
  s.kop.ekle = true;
  const sec = async () => [{ aday_no: 1 }];
  await assert.rejects(kalemGonder({ taslak: d.t, kaydet: d.kaydet, api: s.api, kimlik, kirpmaSec: sec }));
  await kalemGonder({ taslak: d.t, kaydet: d.kaydet, api: s.api, kimlik, kirpmaSec: sec });
  assert.equal(s.sayac.ekle, 1);
  assert.equal(s.sayac.belge, 0);
});

test("kırpma seçiminden vazgeçilirse taslak yarım kalır, fiş başarılı sayılmaz", async () => {
  const s = sahteSunucu({ isleVar: true }); const d = depo(taslakYap());
  const r = await kalemGonder({ taslak: d.t, kaydet: d.kaydet, api: s.api, kimlik, kirpmaSec: async () => null });
  assert.equal(r.yarim, true); assert.notEqual(d.t.fotolar[0].durum, "yuklendi");
});

test("fişsiz kalem açıklaması yazılır; OCR tutar farkı uyarı döner", async () => {
  const s = sahteSunucu(); const d = depo(taslakYap({ fotolar: [], fissiz: { aktif: true, aciklama: "Fiş verilmedi" } }));
  const r = await kalemGonder({ taslak: d.t, kaydet: d.kaydet, api: s.api, kimlik });
  const k = s.form.kalemler.find((x) => x.id === r.kalemId);
  assert.equal(k.fis_var, false); assert.equal(k.fis_olmadan_aciklama, "Fiş verilmedi");
  const s2 = sahteSunucu(); const d2 = depo(taslakYap({ alanlar: { ...taslakYap().alanlar, tutar: 500 } }));
  const r2 = await kalemGonder({ taslak: d2.t, kaydet: d2.kaydet, api: s2.api, kimlik });
  assert.equal(r2.uyarilar[0].tur, "tutar"); assert.equal(r2.uyarilar[0].ocr, 300);
});

test("kırpmada yeniden çek: eski fotoğraf eklenmez, yeni fotoğraf yeni istekle bir kez eklenir", async () => {
  const { fotoDegistir } = await import("../src/taslak/masrafGonder.js");
  const s = sahteSunucu({ isleVar: true }); const d = depo(taslakYap());
  const r1 = await kalemGonder({ taslak: d.t, kaydet: d.kaydet, api: s.api, kimlik, kirpmaSec: async () => ({ yenidenCek: true }) });
  assert.equal(r1.yenidenCek.index, 0); assert.equal(s.sayac.ekle, 0); assert.equal(s.sayac.belge, 0);
  d.t.fotolar = fotoDegistir(d.t.fotolar, 0, { uri: "f2", ad: "f2.jpg", mime: "image/jpeg", boyut: 10 });
  assert.equal(d.t.fotolar[0].denendi, undefined); assert.equal(d.t.fotolar[0].istekler, undefined);
  const r2 = await kalemGonder({ taslak: d.t, kaydet: d.kaydet, api: s.api, kimlik, kirpmaSec: async () => [{ aday_no: 1, kose: [[1, 1], [9, 1], [9, 9], [1, 9]] }] });
  assert.equal(r2.kalemId, r1.kalemId); assert.equal(s.sayac.kalem, 1); assert.equal(s.sayac.ekle, 1);
  assert.equal(s.form.kalemler.find((k) => k.id === r1.kalemId).belgeler.length, 1);
});
