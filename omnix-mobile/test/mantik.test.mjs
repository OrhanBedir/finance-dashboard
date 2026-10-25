import test from "node:test";
import assert from "node:assert/strict";
import { tl, tutarCoz, tarih, donem, isoGun, basHarfler, ibanGecerli, ibanGoster, ibanDuzelt } from "../src/mantik/bicim.js";
import { hesapDurumu, yoldakiler } from "../src/mantik/hesap.js";
import { durumBilgisi, rolAdi } from "../src/mantik/durumlar.js";
import { hataSinifla, kullaniciMetniMi } from "../src/mantik/hata.js";
import { avansEslesmesi, kalemEslesmesi, yeniBelge, malzemeEslesmesi } from "../src/mantik/uzlastirma.js";
import { kapsamAnahtari, firmaKimligi, kimlikDegistiMi } from "../src/mantik/kapsam.js";

test("tl biçimi; geçersiz değer sahte 0 olmaz", () => {
  assert.equal(tl(12345.6), "12.345,60 ₺");
  assert.equal(tl(-500), "−500,00 ₺");
  assert.equal(tl(0), "0,00 ₺");
  assert.equal(tl(null), null);
  assert.equal(tl(undefined), null);
  assert.equal(tl("abc"), null);
});

test("tutar girişi Türkçe biçimleri çözer", () => {
  assert.equal(tutarCoz("1.234,50"), 1234.5);
  assert.equal(tutarCoz("1234,5"), 1234.5);
  assert.equal(tutarCoz("1234.50"), 1234.5);
  assert.equal(tutarCoz("1.234"), 1234);
  assert.equal(tutarCoz("250"), 250);
  assert.equal(tutarCoz("0"), null);
  assert.equal(tutarCoz("-5"), null);
  assert.equal(tutarCoz("12a"), null);
  assert.equal(tutarCoz(""), null);
});

test("tarih yardımcıları UTC kayması yapmaz", () => {
  assert.equal(tarih("2026-10-24"), "24 Eki 2026");
  assert.equal(donem("2026-05"), "Mayıs 2026");
  assert.equal(isoGun(new Date(2026, 0, 1, 0, 30)), "2026-01-01");
  assert.equal(basHarfler("orhan bedir"), "OB");
  assert.equal(basHarfler("İlkay"), "İ");
});

test("negatif bakiye personel alacağıdır, üzerimdeki avans değildir", () => {
  const a = hesapDurumu(-3250.5);
  assert.equal(a.tur, "alacak");
  assert.equal(a.tutar, 3250.5);
  assert.match(a.baslik, /alacağınız/);
  assert.equal(hesapDurumu(1200).tur, "avans");
  assert.equal(hesapDurumu(0).tur, "kapali");
  assert.equal(hesapDurumu(0.001).tur, "kapali");
  // Yüklenemeyen veri sıfır gibi gösterilmez
  const b = hesapDurumu(undefined);
  assert.equal(b.tur, "bilinmiyor");
  assert.equal(b.tutar, null);
});

test("masraf rozeti ile kart aynı kaynaktan sayar", () => {
  const y = yoldakiler({ bekleyen: { avanslar: [{ tutar: 1000 }], formlar: [
    { durum: "TASLAK", tutar: 100 }, { durum: "PM_BEKLE", tutar: 200 }, { durum: "ROLLOUT_BEKLE", tutar: 50 }, { durum: "TAMAMLANDI", tutar: 70 },
  ] } });
  assert.deepEqual(y.taslakFormlar, { adet: 1, tutar: 100 });
  assert.deepEqual(y.onaydakiFormlar, { adet: 2, tutar: 250 });
  assert.deepEqual(y.kapanisBekleyen, { adet: 1, tutar: 70 });
  assert.equal(y.masrafRozet, 3);
  assert.equal(yoldakiler(null).masrafRozet, 0);
});

test("durum adları rol adıyla, bilinmeyen kod okunur", () => {
  assert.equal(durumBilgisi("avans", "TALEP").ad, "Rollout Müdürü onayında");
  assert.equal(durumBilgisi("avans", "TAMAMLANDI").bitti, true);
  assert.equal(durumBilgisi("masraf", "ARSIVLENDI").adim, 6);
  assert.equal(durumBilgisi("masraf", "YENI_DURUM").ad, "Yeni durum");
  assert.equal(rolAdi("rollout_mudur"), "Rollout müdürü");
  assert.equal(rolAdi(undefined), "Personel");
});

test("teknik sunucu metni kullanıcıya gösterilmez", () => {
  assert.equal(kullaniciMetniMi('column "x" does not exist'), false);
  assert.equal(kullaniciMetniMi("Cannot POST /hr/x"), false);
  assert.equal(kullaniciMetniMi("Bu onay adımı için yetkiniz yok"), true);
  assert.equal(hataSinifla(500, "relation users does not exist").tur, "sunucu");
  assert.doesNotMatch(hataSinifla(500, "relation users does not exist").message, /relation/);
  assert.equal(hataSinifla(403, "Bu onay adımı için yetkiniz yok").message, "Bu onay adımı için yetkiniz yok");
  assert.equal(hataSinifla(401, "x").tur, "oturum");
  assert.equal(hataSinifla(422, "Form taslak durumunda değil veya bulunamadı").tur, "dogrulama");
});

test("uzlaştırma: bağlantı kopunca aynı kayıt bulunur, eskiler eşleşmez", () => {
  const liste = [{ id: 5, tutar: "1500.00", gider_turu: "Yakıt", aciklama: "Bursa", tarih: "2026-10-24T00:00:00.000Z" }, { id: 9, tutar: 1500, gider_turu: "Yakıt", aciklama: "Bursa", tarih: "2026-10-24" }];
  assert.equal(avansEslesmesi(liste, [5], { tutar: 1500, gider_turu: "Yakıt", aciklama: "Bursa", tarih: "2026-10-24" }).id, 9);
  assert.equal(avansEslesmesi(liste, [5, 9], { tutar: 1500, gider_turu: "Yakıt", aciklama: "Bursa" }), null);
  // Sunucu DATE'i saat dilimli dönerse (TR gece yarısı = önceki gün 21:00Z) aynı gün sayılır
  const tz = [{ id: 11, tutar: 100, gider_turu: "Yol", aciklama: "", tarih: new Date(2026, 9, 24).toISOString() }];
  assert.equal(avansEslesmesi(tz, [], { tutar: 100, gider_turu: "Yol", aciklama: "", tarih: "2026-10-24" }).id, 11);
  assert.equal(avansEslesmesi(liste, [5], { tutar: 1400, gider_turu: "Yakıt", aciklama: "Bursa" }), null);
  const kalemler = [{ id: 1, kategori: "YEMEK", tutar: "250.00", aciklama: null, tarih: "2026-10-24" }, { id: 2, kategori: "YAKIT", tutar: 900, aciklama: "34 AB 1", tarih: "2026-10-24" }];
  assert.equal(kalemEslesmesi(kalemler, [1], { kategori: "YAKIT", tutar: 900, aciklama: "34 AB 1", tarih: "2026-10-24" }).id, 2);
  assert.equal(kalemEslesmesi(kalemler, [1, 2], { kategori: "YAKIT", tutar: 900, aciklama: "34 AB 1" }), null);
  assert.equal(yeniBelge({ belgeler: [{ id: 3 }, { id: 4 }] }, [3]).id, 4);
  assert.equal(yeniBelge({ belgeler: [{ id: 3 }] }, [3]), null);
  assert.equal(malzemeEslesmesi([{ id: 7, notlar: "kablo", kalem_sayisi: 2 }], [], { notlar: "kablo", kalemler: [{}, {}] }).id, 7);
});

test("kapsam anahtarı kişi ve firmaya göre ayrılır", () => {
  const a = kapsamAnahtari({ id: 77, tenant: "erc", email: "saha.user@simsektel.com" });
  const b = kapsamAnahtari({ id: 1285, tenant: "erc", email: "teknocenter" });
  assert.notEqual(a, b);
  assert.equal(kapsamAnahtari(null), null);
  assert.equal(kapsamAnahtari({ id: 1 }), null);
  assert.equal(firmaKimligi({ marka_ad: "Teknocenter", tenant_name: "ERC" }).ad, "Teknocenter");
  assert.equal(firmaKimligi({ tenant_name: "2KX" }).ad, "2KX");
  assert.equal(firmaKimligi({}).ad, "Omnix");
  assert.equal(kimlikDegistiMi({ id: 1, email: "a", marka: "ERC" }, { id: 1, email: "a", marka: "TEKNO" }), true);
  assert.equal(kimlikDegistiMi({ id: 1, email: "a", marka: "ERC" }, { id: 1, email: "a", marka: "ERC", role: "admin" }), false);
});

test("IBAN: TR biçimi ve kontrol hanesi doğrulanır", () => {
  assert.equal(ibanGecerli("TR33 0006 1005 1978 6457 8413 26"), true);
  assert.equal(ibanGecerli("TR330006100519786457841327"), false);
  assert.equal(ibanGecerli("DE89370400440532013000"), false);
  assert.equal(ibanGecerli("TR33"), false);
  assert.equal(ibanDuzelt(" tr33 0006 "), "TR330006");
  assert.equal(ibanGoster("TR330006100519786457841326"), "TR33 0006 1005 1978 6457 8413 26");
});

test("deneyim: profil backend alanlarından; bağlantısız taşeron veri ekranına düşmez", async () => {
  const { deneyim } = await import("../src/mantik/profil.js");
  const { para } = await import("../src/mantik/bicim.js");
  assert.equal(deneyim({ role: "user" }), "personel");
  assert.equal(deneyim({ role: "user", yonetim_profili: "SAHIP" }), "yonetim");
  assert.equal(deneyim({ role: "user", yonetim_profili: "PERSONEL" }), "personel");
  assert.equal(deneyim({ role: "subcon", kullanici_tipi: "TASERON", taseron: { id: 3, aktif: true } }), "taseron");
  assert.equal(deneyim({ role: "subcon", kullanici_tipi: "TASERON", taseron: null }), "taseronBagsiz");
  assert.equal(deneyim({ role: "subcon", subcon_name: "FERRUMX" }), "taseronBagsiz", "eski tip taşeron hesabı");
  assert.equal(deneyim({ role: "subcon", kullanici_tipi: "TASERON", yonetim_profili: "SAHIP", taseron: { id: 3 } }), "taseron", "taşeron yönetim profili alamaz");
  assert.equal(para(1250, "USD"), "1.250,00 $");
  assert.equal(para(1250, "TRY"), "1.250,00 ₺");
  assert.equal(para(null, "EUR"), null);
});
