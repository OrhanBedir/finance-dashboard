// Tarihli onay devri + direktör deneyimi testi (25.10.2026) — YALNIZ yerel test sunucusuna (127.0.0.1:5099, sahte veri).
// Senaryo: Teknocenter direktör onayları belirli bir tarihten itibaren Düzgün'den İlhami'ye geçer.
//  - devir öncesi: eski kural (Düzgün onaylar, İlhami 403; planlı devir İlhami'nin ekranında bildirilir)
//  - devir sonrası: yalnız İlhami (daha önce açılmış bekleyen talep dahil); Düzgün API'den de veremez, listesinden düşer;
//    RM/PM adımları atlanmaz; ERC akışı değişmez; tamamlanmış onaylar değişmez; çift onay 409
//  - devralan hesap pasifse adım kilitlenir ve hata açıkça söylenir (sessizce eski onaycıya dönülmez)
//  - direktör rolü: yönetim deneyimi (personel_yonetimi), "End" → Ender Teke, kapsam dışı personel 404, maaş ayrı izin
// Çalıştırma: YEREL_API=http://127.0.0.1:5099 NODE_PATH=../backend/node_modules node --test test/yerel/onay_devri.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const API = process.env.YEREL_API;
const SIFRE = "Omnix-Test-2026";
if (!API || !/^http:\/\/127\.0\.0\.1:/.test(API)) { console.log("YEREL_API tanımlı değil — atlandı"); process.exit(0); }
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const bcrypt = require("bcrypt");
const { devirAktifMi } = require("../../../backend/onayDevri.js");

async function cagir(token, yol, { method = "GET", govde } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (govde !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(API + yol, { method, headers: h, body: govde !== undefined ? JSON.stringify(govde) : undefined });
  const metin = await r.text();
  let veri; try { veri = JSON.parse(metin); } catch { veri = { _ham: metin.slice(0, 80) }; }
  return { s: r.status, v: veri };
}
const giris = async (e) => {
  const r = await cagir(null, "/auth/login", { method: "POST", govde: { email: e, password: SIFRE } });
  assert.equal(r.s, 200, `${e} giriş: ${JSON.stringify(r.v)}`);
  return r.v.token;
};
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const ONBELLEK_BEKLE = 11000; // onayDevri satır önbelleği 10 sn; zaman kıyası her çağrıda

let c; const t = {}; const id = {};
test.before(async () => {
  c = new Client({ host: "127.0.0.1", port: 55432, user: "postgres", database: "omnix_test" });
  await c.connect();
  const h = await bcrypt.hash(SIFRE, 8);
  const kul = async (ad, e, rol, marka) => {
    await c.query(`DELETE FROM users WHERE email=$1`, [e]);
    const r = await c.query(`INSERT INTO users (name,email,password_hash,role,is_active,tenant,status,marka) VALUES ($1,$2,$3,$4,true,'erc','active',$5) RETURNING id`, [ad, e, h, rol, marka]);
    return r.rows[0].id;
  };
  id.ilhami = await kul("İlhami Şahin", "ilhami", "direktor", "TEKNO");
  id.duzgun = await kul("Düzgün Şimşek", "duzgun.simsek@simsektel.com", "admin", "ERC");
  await c.query(`UPDATE users SET marka='TEKNO', role='user' WHERE email='tekno.saha@teknocenter.test'`);
  await c.query(`UPDATE personel SET marka='TEKNO' WHERE email='tekno.saha@teknocenter.test'`);
  // Bu testin kendi personeli (diğer testlerin bakiye/form sayılarını bozmamak için): Ender Teke (TEKNO), Kadir Yılmaz (ERC)
  const per = async (ad, e, marka) => {
    await c.query(`DELETE FROM is_avans_talep WHERE personel_id IN (SELECT id FROM personel WHERE email=$1)`, [e]);
    await c.query(`DELETE FROM masraf_kalem WHERE form_id IN (SELECT id FROM masraf_form WHERE personel_id IN (SELECT id FROM personel WHERE email=$1))`, [e]);
    await c.query(`DELETE FROM masraf_form WHERE personel_id IN (SELECT id FROM personel WHERE email=$1)`, [e]);
    await c.query(`DELETE FROM puantaj WHERE personel_id IN (SELECT id FROM personel WHERE email=$1)`, [e]);
    await c.query(`DELETE FROM personel WHERE email=$1`, [e]);
    return (await c.query(`INSERT INTO personel (ad_soyad,email,unvan,bolge,aktif,marka,firma_tipi) VALUES ($1,$2,'Saha Teknisyeni','İzmir',true,$3,'simsek') RETURNING id`, [ad, e, marka])).rows[0].id;
  };
  id.ender = await per("Ender Teke", "ender.teke@teknocenter.test", "TEKNO");
  id.kadir = await per("Kadir Yılmaz", "kadir.erc@simsektel.com", "ERC");
  // Önceki koşunun kalıntıları
  await c.query(`DELETE FROM islem_gecmisi WHERE modul='avans' AND kayit_id IN (SELECT id FROM is_avans_talep WHERE aciklama LIKE 'DEVIR-TEST%')`);
  await c.query(`DELETE FROM is_avans_talep WHERE aciklama LIKE 'DEVIR-TEST%'`);
  await c.query(`DELETE FROM masraf_kalem WHERE form_id IN (SELECT id FROM masraf_form WHERE form_no IN (7901,7902))`);
  await c.query(`DELETE FROM masraf_form WHERE form_no IN (7901,7902)`);
  await c.query(`DELETE FROM onay_devri WHERE aciklama LIKE 'DEVIR-TEST%' OR firma='TEKNO'`);
  const avans = async (pid, email, ad, durum, etiket, ek = "") => (await c.query(`INSERT INTO is_avans_talep (personel_id,talep_eden_email,talep_eden_ad,tutar,aciklama,durum,tarih,gider_turu,bolge,proje${ek ? "," + ek.split("=")[0] : ""})
    VALUES ($1,$2,$3,1500,$4,$5,CURRENT_DATE,'Yakıt','İzmir','TC - Türkcell'${ek ? "," + ek.split("=")[1] : ""}) RETURNING id`, [pid, email, ad, `DEVIR-TEST ${etiket}`, durum])).rows[0].id;
  const E = ["ender.teke@teknocenter.test", "Ender Teke"], K = ["kadir.erc@simsektel.com", "Kadir Yılmaz"];
  id.A1 = await avans(id.ender, ...E, "PM_ONAY", "A1");
  id.A2 = await avans(id.ender, ...E, "PM_ONAY", "A2");
  id.A3 = await avans(id.ender, ...E, "TALEP", "A3");
  id.A4 = await avans(id.kadir, ...K, "PM_ONAY", "A4");
  id.A5 = await avans(id.ender, ...E, "TAMAMLANDI", "A5", "direktor_onay_tarihi=DATE '2026-10-01'");
  id.A6 = await avans(id.ender, ...E, "PM_ONAY", "A6");
  id.A7 = await avans(id.kadir, ...K, "PM_ONAY", "A7");
  const masraf = async (pid, email, ad, no) => {
    const f = (await c.query(`INSERT INTO masraf_form (personel_id,talep_eden_email,talep_eden_ad,donem,form_no,durum) VALUES ($1,$2,$3,to_char(CURRENT_DATE,'YYYY-MM'),$4,'DIREKTOR_BEKLE') RETURNING id`, [pid, email, ad, no])).rows[0].id;
    await c.query(`INSERT INTO masraf_kalem (form_id,kategori,tarih,tutar,aciklama) VALUES ($1,'YAKIT',CURRENT_DATE,850,'DEVIR-TEST kalem')`, [f]);
    return f;
  };
  id.M1 = await masraf(id.ender, ...E, 7901);
  id.M2 = await masraf(id.kadir, ...K, 7902);
  t.ilhami = await giris("ilhami"); t.duzgun = await giris("duzgun.simsek@simsektel.com");
  t.orhan = await giris("orhan.bedir@simsektel.com"); t.personel = await giris("tekno.saha@teknocenter.test");
});
test.after(async () => { await c.end(); });

test("sınır: 31.10.2026 23:59:59 yürürlükte değil, 01.11.2026 00:00:00 (Europe/Istanbul) yürürlükte", () => {
  const satir = { aktif: true, baslangic: "2026-11-01T00:00:00+03:00", bitis: null };
  assert.equal(devirAktifMi(satir, new Date("2026-10-31T23:59:59+03:00")), false);
  assert.equal(devirAktifMi(satir, new Date("2026-11-01T00:00:00+03:00")), true);
  assert.equal(devirAktifMi(satir, new Date("2026-10-31T21:00:00Z")), true); // aynı an, UTC yazımı
  assert.equal(devirAktifMi({ ...satir, bitis: "2027-01-01T00:00:00+03:00" }, new Date("2027-01-01T00:00:00+03:00")), false); // bitiş hariç
  assert.equal(devirAktifMi({ ...satir, aktif: false }, new Date("2026-12-01T00:00:00+03:00")), false);
});

test("devir öncesi: planlı devir tanımlanır, eski kural sürer (Düzgün onaylar, İlhami 403)", async () => {
  const bas = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 saat sonra
  for (const adim of ["AVANS_PD", "MASRAF_PD"]) {
    const r = await cagir(t.orhan, "/admin/onay-devri", { method: "POST", govde: { firma: "TEKNO", adim, onayci_user_id: id.ilhami, baslangic: bas, aciklama: `DEVIR-TEST ${adim}` } });
    assert.equal(r.s, 200, JSON.stringify(r.v)); id[adim] = r.v.row.id;
  }
  assert.equal((await cagir(t.personel, "/admin/onay-devri", { method: "POST", govde: { firma: "TEKNO", adim: "AVANS_PD", onayci_user_id: id.ilhami, baslangic: bas } })).s, 403, "personel devir tanımlayamaz");
  const i = await cagir(t.ilhami, "/onay/bekleyen");
  assert.equal(i.s, 200); assert.equal(i.v.onayci, true, "planlı devir: sekme kalıcı"); assert.equal(i.v.sayac, 0);
  assert.equal(i.v.planli.length, 2); assert.equal(i.v.devirler.length, 0);
  assert.equal((await cagir(t.ilhami, `/hr/is-avans/${id.A1}/direktor-onayla`, { method: "PUT", govde: {} })).s, 403, "devir başlamadan İlhami onaylayamaz");
  const d = await cagir(t.duzgun, "/onay/bekleyen");
  const ids = d.v.kategoriler.avans.rows.map((r) => r.id);
  assert.ok(ids.includes(id.A1) && ids.includes(id.A4), "Düzgün devir öncesi TEKNO ve ERC PM_ONAY taleplerini görür");
  const o = await cagir(t.duzgun, `/hr/is-avans/${id.A4}/direktor-onayla`, { method: "PUT", govde: { firma: "ERC" } });
  assert.equal(o.s, 200, JSON.stringify(o.v)); assert.equal(o.v.durum, "DIREKTOR_ONAY");
});

test("devir sonrası: bekleyen TEKNO talepleri İlhami'ye geçer; Düzgün eski token ile de veremez; zincir korunur", async () => {
  await c.query(`UPDATE onay_devri SET baslangic = NOW() - INTERVAL '1 hour' WHERE id = ANY($1)`, [[id.AVANS_PD, id.MASRAF_PD]]);
  await bekle(ONBELLEK_BEKLE);
  // Düzgün (devirden önce alınmış token): TEKNO PM_ONAY listesinden düşer, API 403; RM/PM adımı ve ERC işleri sürer
  const d = await cagir(t.duzgun, "/onay/bekleyen");
  const dRows = d.v.kategoriler.avans.rows;
  assert.ok(!dRows.some((r) => r.id === id.A1 || r.id === id.A2), "TEKNO direktör adımı Düzgün'ün listesinden kalktı");
  const a3 = dRows.find((r) => r.id === id.A3);
  assert.ok(a3 && a3.uc === "onayla" && a3.adim === "RM", "Düzgün TEKNO talebinin Rollout adımını hâlâ görür (tek adım ilerletir)");
  assert.equal((await cagir(t.duzgun, `/hr/is-avans/${id.A1}/direktor-onayla`, { method: "PUT", govde: {} })).s, 403);
  assert.equal((await cagir(t.duzgun, `/hr/is-avans/${id.A1}/onayla`, { method: "PUT", govde: {} })).s, 403, "genel onay ucu da PD adımını Düzgün'e vermez");
  const pano = await cagir(t.duzgun, "/hr/mobile-dashboard");
  assert.ok(!(pano.v.onayBekleyenAvanslar || []).some((r) => r.id === id.A1), "eski mobil pano da süzülür");
  // İlhami: yalnız PM_ONAY'daki TEKNO talepleri; TALEP aşamasındaki ve ERC talepleri yok
  const i = await cagir(t.ilhami, "/onay/bekleyen");
  assert.equal(i.v.devirler.length, 2); assert.equal(i.v.planli.length, 0);
  const iRows = i.v.kategoriler.avans.rows;
  const a1 = iRows.find((r) => r.id === id.A1);
  assert.ok(a1 && a1.adim === "PD" && a1.uc === "direktor-onayla" && a1.onay_kaynagi === "devir" && a1.talep_firma === "TEKNO", JSON.stringify(a1));
  assert.ok(iRows.some((r) => r.id === id.A2));
  assert.ok(!iRows.some((r) => r.id === id.A3), "Rollout adımındaki talep İlhami'ye gelmez (zincir korunur)");
  assert.ok(!iRows.some((r) => r.id === id.A4), "ERC talebi İlhami'ye gelmez");
  assert.equal((await cagir(t.ilhami, `/hr/is-avans/${id.A3}/direktor-onayla`, { method: "PUT", govde: {} })).s, 403, "RM/PM adımları atlanamaz");
  assert.equal((await cagir(t.ilhami, `/hr/is-avans/${id.A3}/onayla`, { method: "PUT", govde: {} })).s, 403);
  assert.equal((await cagir(t.ilhami, `/hr/is-avans/${id.A7}/direktor-onayla`, { method: "PUT", govde: {} })).s, 403, "başka firmanın talebi");
  assert.equal((await cagir(t.ilhami, `/hr/is-avans/${id.A4}/direktor-onayla`, { method: "PUT", govde: {} })).s, 409, "zaten işlenmiş talep");
  const ok = await cagir(t.ilhami, `/hr/is-avans/${id.A1}/direktor-onayla`, { method: "PUT", govde: { firma: "TEKNO" } });
  assert.equal(ok.s, 200, JSON.stringify(ok.v)); assert.equal(ok.v.durum, "DIREKTOR_ONAY");
  const tekrar = await cagir(t.ilhami, `/hr/is-avans/${id.A1}/direktor-onayla`, { method: "PUT", govde: {} });
  assert.ok([400, 409].includes(tekrar.s), "aynı talep iki kez işlenmez");
  const log = (await c.query(`SELECT kullanici, yeni FROM islem_gecmisi WHERE modul='avans' AND kayit_id=$1 AND tip='ONAY' ORDER BY id DESC LIMIT 1`, [id.A1])).rows[0];
  const yeni = typeof log.yeni === "string" ? JSON.parse(log.yeni) : log.yeni;
  assert.equal(log.kullanici, "ilhami"); assert.equal(yeni.onay_kaynagi, "devir"); assert.equal(yeni.adim, "DIREKTOR"); assert.equal(yeni.firma, "TEKNO");
  const a5 = (await c.query(`SELECT durum, direktor_onay_tarihi::text AS tarih FROM is_avans_talep WHERE id=$1`, [id.A5])).rows[0];
  assert.equal(a5.durum, "TAMAMLANDI"); assert.equal(a5.tarih, "2026-10-01"); // geçmiş onay değişmedi
  // ERC akışı değişmedi: Düzgün TAMAMLANDI (ödeme) adımını ERC talebinde sürdürür
  assert.equal((await cagir(t.duzgun, `/hr/is-avans/${id.A4}/onayla`, { method: "PUT", govde: {} })).v.durum, "TAMAMLANDI");
  // Masraf formu direktör adımı
  const im = i.v.kategoriler.masraf.rows;
  assert.ok(im.some((r) => r.id === id.M1 && r.adim === "DIREKTOR" && r.onay_kaynagi === "devir"), "TEKNO masraf formu İlhami'de");
  assert.ok(!im.some((r) => r.id === id.M2), "ERC masraf formu İlhami'de değil");
  assert.equal((await cagir(t.duzgun, `/hr/masraf-form/${id.M1}/direktor-onayla`, { method: "PUT", govde: {} })).s, 403);
  assert.equal((await cagir(t.ilhami, `/hr/masraf-form/${id.M2}/direktor-onayla`, { method: "PUT", govde: {} })).s, 403);
  assert.equal((await cagir(t.ilhami, `/hr/masraf-form/${id.M1}`)).s, 200, "onaycı formu inceleyebilir");
  const mo = await cagir(t.ilhami, `/hr/masraf-form/${id.M1}/direktor-onayla`, { method: "PUT", govde: { direktor_not: "ok" } });
  assert.equal(mo.s, 200, JSON.stringify(mo.v)); assert.equal(mo.v.durum, "TAMAMLANDI");
  assert.equal((await cagir(t.ilhami, `/hr/masraf-form/${id.M1}/direktor-onayla`, { method: "PUT", govde: {} })).s, 409);
  assert.equal((await cagir(t.duzgun, `/hr/masraf-form/${id.M2}/direktor-onayla`, { method: "PUT", govde: {} })).v.durum, "TAMAMLANDI", "ERC masraf akışı Düzgün'de");
  // Sayaç yenilendi
  assert.equal((await cagir(t.ilhami, "/onay/bekleyen")).v.sayac, 2); // A2 + A6
});

test("direktör rolü: yönetim deneyimi, kapsamlı personel arama ('End' → Ender Teke), maaş ayrı izin", async () => {
  const me = await cagir(t.ilhami, "/auth/me");
  assert.equal(me.v.user.izinler?.personel_yonetimi, true, "direktör rolü personel yönetimi görür");
  assert.equal(me.v.user.izinler?.maas_goruntule, false, "maaş rolle açılmaz");
  assert.equal(me.v.user.onay?.onayci, true);
  const ara = await cagir(t.ilhami, "/yonetim/personel?q=End");
  assert.equal(ara.s, 200, JSON.stringify(ara.v));
  assert.ok(ara.v.rows.some((r) => r.ad_soyad === "Ender Teke" && r.firma === "TEKNO"), JSON.stringify(ara.v.rows));
  assert.ok(ara.v.rows.every((r) => ["TEKNO", "AHY"].includes(r.firma)), "yalnız kendi firma kapsamı");
  assert.ok((await cagir(t.ilhami, "/yonetim/personel?q=ENDER")).v.rows.some((r) => r.ad_soyad === "Ender Teke"), "büyük harf");
  assert.equal((await cagir(t.ilhami, `/yonetim/personel/${id.kadir}`)).s, 404, "ERC personeli kimlikle de alınamaz");
  const det = await cagir(t.ilhami, `/yonetim/personel/${id.ender}`);
  assert.equal(det.s, 200); assert.equal(det.v.bolumler.genel.veri.ad_soyad, "Ender Teke");
  assert.equal(det.v.bolumler.maas.durum, "yetki_yok"); assert.ok(!("veri" in det.v.bolumler.maas));
  assert.equal(det.v.bolumler.puantaj.durum, "ok"); assert.ok(Array.isArray(det.v.bolumler.puantaj.veri.gunler));
  assert.ok(det.v.bolumler.avans.veri.some((a) => a.id === id.A2), "seçilen kişinin avansı kendi kimliğinden");
});

test("normal personel: yönetim ve onay işlevleri kapalı", async () => {
  const o = await cagir(t.personel, "/onay/bekleyen");
  assert.equal(o.v.onayci, false); assert.equal(o.v.sayac, 0);
  assert.equal((await cagir(t.personel, "/yonetim/ozet")).s, 403);
  assert.equal((await cagir(t.personel, `/hr/is-avans/${id.A2}/direktor-onayla`, { method: "PUT", govde: {} })).s, 403);
  assert.equal((await cagir(t.personel, `/yonetim/personel/${id.ender}`)).s, 403);
});

test("devralan hesap pasifse adım kilitlenir; hata açıkça söylenir; sessizce Düzgün'e dönülmez", async () => {
  await c.query(`UPDATE users SET is_active=false WHERE id=$1`, [id.ilhami]);
  await bekle(ONBELLEK_BEKLE);
  const r = await cagir(t.duzgun, `/hr/is-avans/${id.A2}/direktor-onayla`, { method: "PUT", govde: {} });
  assert.equal(r.s, 403); assert.match(String(r.v.error), /pasif|kilitli/i);
  const d = await cagir(t.duzgun, "/onay/bekleyen");
  assert.ok(d.v.yapilandirma_hatasi.length >= 1, "yapılandırma hatası listede görünür");
  assert.ok(!d.v.kategoriler.avans.rows.some((x) => x.id === id.A2));
  await c.query(`UPDATE users SET is_active=true WHERE id=$1`, [id.ilhami]);
  await bekle(ONBELLEK_BEKLE);
  assert.equal((await cagir(t.ilhami, `/hr/is-avans/${id.A2}/direktor-onayla`, { method: "PUT", govde: { firma: "TEKNO" } })).s, 200);
});

test("devir bitirilince eski kural geri gelir; admin listesi durumları gösterir", async () => {
  const l = await cagir(t.orhan, "/admin/onay-devri");
  assert.equal(l.s, 200);
  assert.ok(l.v.rows.some((x) => x.id === id.AVANS_PD && x.durum === "yururlukte" && x.onayci_email === "ilhami"));
  assert.equal((await cagir(t.orhan, `/admin/onay-devri/${id.AVANS_PD}/bitir`, { method: "PUT", govde: {} })).s, 200);
  await bekle(ONBELLEK_BEKLE);
  assert.equal((await cagir(t.ilhami, `/hr/is-avans/${id.A6}/direktor-onayla`, { method: "PUT", govde: {} })).s, 403);
  assert.equal((await cagir(t.duzgun, `/hr/is-avans/${id.A6}/direktor-onayla`, { method: "PUT", govde: { firma: "TEKNO" } })).s, 200);
});
