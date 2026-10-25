// Gizlilik / yetki testi (25.10.2026) — YALNIZ yerel test sunucusuna (127.0.0.1:5099, sahte veri) karşı çalışır.
// Başka personelin malzeme talebi, zimmeti, masraf formu, bakiyesi ve iş ataması görünmemeli; depo / fiyat /
// onay işlemleri yalnız yetkilide; Clean Up kaydı onaya gönderilince kilitli. Ek sahte hesaplar burada açılır.
// Çalıştırma: YEREL_API=http://127.0.0.1:5099 NODE_PATH=../backend/node_modules node --test test/yerel/yetki.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const API = process.env.YEREL_API;
const SIFRE = "Omnix-Test-2026";
if (!API || !/^http:\/\/127\.0\.0\.1:/.test(API)) { console.log("YEREL_API tanımlı değil — atlandı"); process.exit(0); }
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const bcrypt = require("bcrypt");
const FIS = readFileSync(new URL("./fis.jpg", import.meta.url));

async function cagir(token, yol, { method = "GET", govde, form } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (govde !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(API + yol, { method, headers: h, body: form || (govde !== undefined ? JSON.stringify(govde) : undefined), redirect: "manual" });
  const metin = await r.text();
  let veri; try { veri = JSON.parse(metin); } catch { veri = { _ham: metin.slice(0, 80) }; }
  return { s: r.status, v: veri };
}
const giris = async (e) => {
  const r = await cagir(null, "/auth/login", { method: "POST", govde: { email: e, password: SIFRE } });
  assert.equal(r.s, 200, `${e} giriş: ${JSON.stringify(r.v)}`);
  return r.v.token;
};
const fotoForm = () => { const f = new FormData(); f.append("dosya", new Blob([FIS], { type: "image/jpeg" }), "fis.jpg"); return f; };

const t = {}; const id = {};
test.before(async () => {
  const c = new Client({ host: "127.0.0.1", port: 55432, user: "postgres", database: "omnix_test" });
  await c.connect();
  const h = await bcrypt.hash(SIFRE, 8);
  const ekle = async (ad, e, rol, ek = {}) => {
    await c.query(`DELETE FROM users WHERE email=$1`, [e]);
    await c.query(`INSERT INTO users (name,email,password_hash,role,is_active,tenant,status,marka,subcon_name,yetki_ayar)
      VALUES ($1,$2,$3,$4,true,'erc','active','ERC',$5,$6)`, [ad, e, h, rol, ek.subcon || null, ek.yetki ? JSON.stringify(ek.yetki) : null]);
  };
  await ekle("Veli Demir", "veli.saha@simsektel.com", "user");
  await ekle("Murat İstek", "murat.istek@simsektel.com", "user");
  await ekle("Rollout Müdürü", "rm.test@simsektel.com", "rollout_mudur");
  await ekle("İSG Sorumlusu", "isg.test@simsektel.com", "isg", { yetki: { malzeme_goruntule: true } });
  await ekle("Taşeron Firma", "taseron@firma.test", "subcon", { subcon: "FIRMA" });
  // Yerel şemada canlıda var olan ama boş veritabanında açılmayan alanlar (yalnız omnix_test)
  await c.query(`ALTER TABLE rollout_cleanup ADD COLUMN IF NOT EXISTS atanan_email TEXT, ADD COLUMN IF NOT EXISTS atanan_ad TEXT,
    ADD COLUMN IF NOT EXISTS onaya_gonderen TEXT, ADD COLUMN IF NOT EXISTS onaya_gonderme_tarihi TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS red_notu TEXT,
    ADD COLUMN IF NOT EXISTS onaylayan TEXT, ADD COLUMN IF NOT EXISTS onay_tarihi TIMESTAMPTZ`);
  await c.query(`INSERT INTO rollout_progress (project_code, site_code, site_type, bolge)
    SELECT 'TC', 'BU1234', 'Standalone', 'Bursa' WHERE NOT EXISTS (SELECT 1 FROM rollout_progress WHERE site_code='BU1234')`);
  await c.query(`DELETE FROM personel WHERE email='veli.saha@simsektel.com'`);
  await c.query(`INSERT INTO personel (ad_soyad,email,unvan,bolge,aktif,marka,firma_tipi) VALUES ('Veli Demir','veli.saha@simsektel.com','Teknisyen','Bursa',true,'ERC','simsek')`);
  const p = await c.query(`SELECT id, email FROM personel WHERE email IN ('saha.user@simsektel.com','orhan.bedir@simsektel.com')`);
  for (const r of p.rows) id[r.email] = r.id;
  id.ahmetTalep = (await c.query(`SELECT id FROM malzeme_talepler WHERE talep_no='MT-2026-901'`)).rows[0].id;
  id.ahmetZimmet = (await c.query(`SELECT id FROM malzeme_dagitim WHERE alici_personel_email='saha.user@simsektel.com' LIMIT 1`)).rows[0].id;
  id.ahmetPmForm = (await c.query(`SELECT id FROM masraf_form WHERE form_no=102`)).rows[0].id;
  // Testin kendi verisi (diğer testlerin sırasına bağlı kalmasın): Mehmet için taze TASLAK form, temiz fiyat satırı
  id.mehmetTaslak = (await c.query(`INSERT INTO masraf_form (personel_id, talep_eden_email, talep_eden_ad, donem, form_no, durum)
    SELECT id, 'tekno.saha@teknocenter.test', 'Mehmet Kaya', to_char(now(),'YYYY-MM'), 9104, 'TASLAK' FROM personel WHERE email='tekno.saha@teknocenter.test' LIMIT 1 RETURNING id`)).rows[0].id;
  await c.query(`DELETE FROM malzeme_fiyat_listesi WHERE malzeme_adi = 'Test kablosu'`).catch(() => {});
  await c.end();
  for (const [k, e] of Object.entries({ ahmet: "saha.user@simsektel.com", veli: "veli.saha@simsektel.com", mehmet: "tekno.saha@teknocenter.test",
    orhan: "orhan.bedir@simsektel.com", murat: "murat.istek@simsektel.com", rm: "rm.test@simsektel.com", isg: "isg.test@simsektel.com", taseron: "taseron@firma.test" }))
    t[k] = await giris(e);
});

test("malzeme: personel başkasının talebini / zimmetini göremez", async () => {
  const l = await cagir(t.veli, "/malzeme/talepler?email=saha.user%40simsektel.com&name=Ahmet%20Y%C4%B1lmaz");
  assert.equal(l.s, 200);
  assert.ok(!l.v.some((x) => x.id === id.ahmetTalep), "Veli, Ahmet'in talebini sorgu e-postasıyla görmemeli");
  const kendi = await cagir(t.ahmet, "/malzeme/talepler?email=saha.user%40simsektel.com&name=Ahmet%20Y%C4%B1lmaz");
  assert.ok(kendi.v.some((x) => x.id === id.ahmetTalep), "eski mobil sorgusu kendi talebini getirmeli");
  assert.equal((await cagir(t.veli, `/malzeme/talepler/${id.ahmetTalep}`)).s, 403);
  assert.equal((await cagir(t.ahmet, `/malzeme/talepler/${id.ahmetTalep}`)).s, 200);
  const z = await cagir(t.veli, "/malzeme/dagitim?personel_email=saha.user%40simsektel.com");
  assert.equal(z.s, 200); assert.equal(z.v.length, 0, "Veli başkasının zimmetini görmemeli");
  assert.equal((await cagir(t.veli, "/malzeme/dagitim?personel_ad=Ahmet")).v.length, 0);
  assert.equal((await cagir(t.ahmet, "/malzeme/dagitim?personel_email=saha.user%40simsektel.com")).v.length, 1);
  for (const yol of ["/malzeme/depo-stok", "/malzeme/dagitim/ozet", "/malzeme/sarf", "/malzeme/fiyat-gecmisi"])
    assert.equal((await cagir(t.veli, yol)).s, 403, yol);
  assert.equal((await cagir(t.veli, "/malzeme/site-codes?q=BU")).s, 200);
  assert.equal((await cagir(t.veli, "/malzeme/fiyat-listesi")).s, 200, "kişisel talep formu fiyat önerisini kullanır");
});

test("malzeme: personel depo / fiyat / onay / başkasının zimmeti üzerinde işlem yapamaz", async () => {
  const yaz = [
    ["POST", "/malzeme/fiyat-listesi", { malzeme_adi: "X", birim_fiyat: 1 }],
    ["POST", "/malzeme/depo-stok", { malzeme_adi: "X", toplam_miktar: 1 }],
    ["POST", "/malzeme/depo-stok-ekle", { malzeme_adi: "X", miktar: 1 }],
    ["POST", "/malzeme/sarf", { malzeme_adi: "X", miktar: 1 }],
    ["POST", "/malzeme/dagitim", { malzeme_adi: "X", miktar: 1 }],
    ["PUT", `/malzeme/talepler/${id.ahmetTalep}/durum`, { durum: "DEPODA" }],
    ["PUT", `/malzeme/talepler/${id.ahmetTalep}/kalem-dagitildi`, { kalem_id: 1 }],
    ["PUT", `/malzeme/dagitim/${id.ahmetZimmet}/iade`, { notlar: "x" }],
    ["PUT", `/malzeme/dagitim/${id.ahmetZimmet}/saha-cikis`, { saha_site_id: "BU1" }],
    ["PUT", `/malzeme/dagitim/${id.ahmetZimmet}/iade-onayla`, {}],
    ["PUT", `/malzeme/talepler/${id.ahmetTalep}`, { durum: "TASLAK" }],
    ["DELETE", `/malzeme/talepler/${id.ahmetTalep}`, undefined],
  ];
  for (const [method, yol, govde] of yaz) assert.equal((await cagir(t.veli, yol, { method, govde })).s, 403, `${method} ${yol}`);
});

test("malzeme: personel kendi talebini açar (kimlik oturumdan), ortak fiyatı değiştiremez, onaydakini düzenleyemez", async () => {
  assert.equal((await cagir(t.orhan, "/malzeme/fiyat-listesi", { method: "POST", govde: { malzeme_adi: "Test kablosu", birim: "Metre", birim_fiyat: 10 } })).s, 200);
  const r = await cagir(t.veli, "/malzeme/talepler", { method: "POST", govde: {
    talep_eden_email: "saha.user@simsektel.com", talep_eden_ad: "Sahte", durum: "ROLLOUT_BEKLE", site_id: "BU1234",
    kalemler: [{ malzeme_adi: "Test kablosu", miktar: 5, birim: "Metre", birim_fiyat: 999 }] } });
  assert.equal(r.s, 200);
  assert.equal(r.v.talep_eden_email, "veli.saha@simsektel.com", "başkası adına talep açılamamalı");
  const fl = await cagir(t.orhan, "/malzeme/fiyat-listesi");
  assert.equal(Number(fl.v.find((x) => x.malzeme_adi === "Test kablosu").birim_fiyat), 10, "personel talebi ortak fiyatı değiştirmemeli");
  assert.equal((await cagir(t.veli, `/malzeme/talepler/${r.v.id}`, { method: "PUT", govde: { durum: "TASLAK" } })).s, 403, "onaydaki talep");
  assert.equal((await cagir(t.veli, "/malzeme/talepler", { method: "POST", govde: { durum: "DEPODA" } })).s, 403);
  const tas = await cagir(t.veli, "/malzeme/talepler", { method: "POST", govde: { durum: "TASLAK", kalemler: [{ malzeme_adi: "Kablo bağı", miktar: 1 }] } });
  assert.equal((await cagir(t.veli, `/malzeme/talepler/${tas.v.id}`, { method: "PUT", govde: { durum: "ROLLOUT_BEKLE", kalemler: [{ malzeme_adi: "Kablo bağı", miktar: 2 }] } })).s, 200);
  const tas2 = await cagir(t.veli, "/malzeme/talepler", { method: "POST", govde: { durum: "TASLAK" } });
  assert.equal((await cagir(t.veli, `/malzeme/talepler/${tas2.v.id}`, { method: "DELETE" })).s, 200);
  assert.equal((await cagir(t.ahmet, `/malzeme/dagitim/${id.ahmetZimmet}/iade`, { method: "PUT", govde: { notlar: "kullanılmadı" } })).s, 200, "kendi zimmetini iade eder");
});

test("malzeme: depo sorumlusu, rollout müdürü, salt okunur izin, taşeron", async () => {
  assert.equal((await cagir(t.murat, "/malzeme/depo-stok")).s, 200);
  assert.equal((await cagir(t.murat, "/malzeme/depo-stok", { method: "POST", govde: { malzeme_adi: "Test kablosu", birim: "Metre", toplam_miktar: 100 } })).s, 200);
  assert.equal((await cagir(t.murat, "/malzeme/fiyat-listesi", { method: "POST", govde: { malzeme_adi: "Y", birim_fiyat: 1 } })).s, 403, "fiyat yalnız admin/PM");
  const hepsi = await cagir(t.rm, "/malzeme/talepler");
  assert.ok(hepsi.v.some((x) => x.id === id.ahmetTalep), "rollout müdürü tüm talepleri görür");
  assert.equal((await cagir(t.rm, `/malzeme/talepler/${id.ahmetTalep}/durum`, { method: "PUT", govde: { durum: "FIYAT_GIRISI", onay_notu: "test" } })).s, 200);
  assert.equal((await cagir(t.rm, "/malzeme/depo-stok", { method: "POST", govde: { malzeme_adi: "Z", toplam_miktar: 1 } })).s, 403);
  assert.ok((await cagir(t.isg, "/malzeme/talepler")).v.some((x) => x.id === id.ahmetTalep), "malzeme_goruntule izni tüm listeyi görür");
  assert.equal((await cagir(t.isg, "/malzeme/talepler", { method: "POST", govde: { durum: "TASLAK" } })).s, 403);
  for (const yol of ["/malzeme/talepler", "/malzeme/site-codes", "/malzeme/fiyat-listesi"]) assert.equal((await cagir(t.taseron, yol)).s, 403, `taşeron ${yol}`);
});

test("masraf: başkasının formu / Excel / PDF / listesi / bakiyesi görünmez", async () => {
  for (const ek of ["", "/excel", "/pdf"]) {
    assert.equal((await cagir(t.veli, `/hr/masraf-form/${id.ahmetPmForm}${ek}`)).s, 403, `başlıkla ${ek}`);
    assert.equal((await cagir(null, `/hr/masraf-form/${id.ahmetPmForm}${ek}?t=${t.veli}`)).s, 403, `?t= ile ${ek}`);
  }
  assert.equal((await cagir(t.ahmet, `/hr/masraf-form/${id.ahmetPmForm}`)).s, 200);
  assert.equal((await cagir(t.ahmet, `/hr/masraf-form/${id.ahmetPmForm}/excel`)).s, 200);
  assert.equal((await cagir(t.orhan, `/hr/masraf-form/${id.ahmetPmForm}`)).s, 200);
  const l = await cagir(t.veli, "/hr/masraf-formlari?email=saha.user%40simsektel.com");
  assert.equal(l.s, 200); assert.equal(l.v.length, 0, "Veli başkasının form listesini almamalı");
  assert.equal((await cagir(t.veli, "/hr/masraf-formlari")).v.length, 0);
  assert.ok((await cagir(t.ahmet, "/hr/masraf-formlari?email=saha.user%40simsektel.com")).v.length >= 2);
  assert.ok((await cagir(t.orhan, "/hr/masraf-formlari")).v.length >= 4, "tam görüş tüm formları alır");
  assert.equal((await cagir(t.veli, `/hr/masraf-form/bakiye/${id["saha.user@simsektel.com"]}`)).s, 403);
  const b = await cagir(t.ahmet, `/hr/masraf-form/bakiye/${id["saha.user@simsektel.com"]}`);
  assert.equal(b.s, 200); assert.equal(typeof b.v.bakiye, "number");
  assert.equal((await cagir(t.ahmet, `/hr/masraf-form/bakiye/${id["orhan.bedir@simsektel.com"]}`)).s, 403);
  assert.equal((await cagir(t.orhan, `/hr/masraf-form/bakiye/${id["saha.user@simsektel.com"]}`)).s, 200);
  assert.equal((await cagir(t.veli, "/hr/masraf-form/donem/2026-10/excel")).s, 403);
  assert.notEqual((await cagir(t.orhan, "/hr/masraf-form/donem/2026-10/excel")).s, 403);
});

test("masraf: onaya gönderilmiş forma personel kalem ekleyemez", async () => {
  const g = { form_id: id.ahmetPmForm, kategori: "YEMEK", tarih: "2026-10-20", tutar: 50, aciklama: "sonradan" };
  assert.equal((await cagir(t.ahmet, "/hr/masraf-kalem", { method: "POST", govde: g })).s, 400);
  assert.equal((await cagir(t.veli, "/hr/masraf-kalem", { method: "POST", govde: g })).s, 403);
  const k = await cagir(t.mehmet, "/hr/masraf-kalem", { method: "POST", govde: { ...g, form_id: id.mehmetTaslak } });
  assert.equal(k.s, 200, JSON.stringify(k.v));
  assert.equal((await cagir(t.mehmet, `/hr/masraf-kalem/${k.v.id}`, { method: "DELETE" })).s, 200);
});

test("ödeme hesabı: IBAN yalnız avans yetkilisine ve kapsamındaki personel için; kişi kendi kaydını görür", async () => {
  const c2 = new Client({ host: "127.0.0.1", port: 55432, user: "postgres", database: "omnix_test" });
  await c2.connect();
  await c2.query(`UPDATE personel SET iban='TR330006100519786457841326', banka_adi='Ziraat Bankası' WHERE id=$1`, [id["saha.user@simsektel.com"]]);
  await c2.end();
  const pid = id["saha.user@simsektel.com"];
  const r = await cagir(t.orhan, `/hr/personel-secim/${pid}/odeme-hesabi`);
  assert.equal(r.s, 200); assert.equal(r.v.iban, "TR330006100519786457841326"); assert.equal(r.v.banka_adi, "Ziraat Bankası");
  assert.equal((await cagir(t.rm, `/hr/personel-secim/${pid}/odeme-hesabi`)).s, 200, "rollout müdürü başkası adına avans açabilir");
  assert.equal((await cagir(t.veli, `/hr/personel-secim/${pid}/odeme-hesabi`)).s, 403, "personel başkasının IBAN'ını alamaz");
  assert.equal((await cagir(t.taseron, `/hr/personel-secim/${pid}/odeme-hesabi`)).s, 403);
  assert.equal((await cagir(t.isg, `/hr/personel-secim/${pid}/odeme-hesabi`)).s, 403, "İSG avans yetkilisi değil");
  const k = await cagir(t.ahmet, "/hr/personel-secim/kendim/odeme-hesabi");
  assert.equal(k.s, 200); assert.equal(k.v.iban, "TR330006100519786457841326");
  const y = await cagir(t.orhan, `/hr/personel-secim/${id["orhan.bedir@simsektel.com"]}/odeme-hesabi`);
  assert.ok([200, 404].includes(y.s));
  assert.equal((await cagir(t.orhan, "/hr/personel-secim/999999/odeme-hesabi")).s, 404);
});

test("iş atama: işi atanmayan personel detayı göremez", async () => {
  const r = await cagir(t.orhan, "/is-atama", { method: "POST", govde: { kategori: "SURVEY", site_codes: ["BU1234"],
    personeller: [{ email: "saha.user@simsektel.com", ad: "Ahmet Yılmaz" }], plan_tarihi: "2026-10-26" } });
  assert.equal(r.s, 200, JSON.stringify(r.v));
  const isId = r.v.row?.id || r.v.id;
  assert.equal((await cagir(t.ahmet, `/is-atama/${isId}`)).s, 200);
  assert.equal((await cagir(t.veli, `/is-atama/${isId}`)).s, 403);
  assert.equal((await cagir(t.orhan, `/is-atama/${isId}`)).s, 200);
});

test("Clean Up: fotoğraf silme yetkisi ve onaya gönderilince kilit", async () => {
  const site = "BU7777";
  const k = await cagir(t.orhan, "/rollout/cleanup", { method: "POST", govde: { site_code: site, items: [{ id: "k1", aciklama: "Etiket eksik" }],
    atanan_email: "saha.user@simsektel.com", atanan_ad: "Ahmet Yılmaz" } });
  assert.equal(k.s, 200, JSON.stringify(k.v));
  const f = await cagir(t.ahmet, `/rollout/cleanup/${site}/foto?item_id=k1&tip=sonra`, { method: "POST", form: fotoForm() });
  assert.equal(f.s, 200, JSON.stringify(f.v));
  const url = f.v.foto.url;
  const sil = (tok) => cagir(tok, `/rollout/cleanup/${site}/foto`, { method: "DELETE", govde: { item_id: "k1", url } });
  assert.equal((await sil(t.veli)).s, 403, "başkasının fotoğrafı");
  assert.equal((await cagir(t.ahmet, `/rollout/cleanup/${site}/onaya-gonder`, { method: "POST", govde: {} })).s, 200);
  assert.equal((await cagir(t.ahmet, `/rollout/cleanup/${site}/foto?item_id=k1&tip=sonra`, { method: "POST", form: fotoForm() })).s, 403, "kilitli kayda foto");
  assert.equal((await sil(t.ahmet)).s, 403, "kilitliyken kendi fotoğrafı");
  assert.equal((await cagir(t.ahmet, "/rollout/cleanup", { method: "POST", govde: { site_code: site, items: [] } })).s, 403, "kilitli kayıt üzerine yazma");
  assert.equal((await cagir(t.taseron, "/rollout/cleanup", { method: "POST", govde: { site_code: "BU8888", items: [] } })).s, 403);
  assert.equal((await cagir(t.orhan, `/rollout/cleanup/${site}/reddet`, { method: "PUT", govde: { not: "Fotoğraf net değil" } })).s, 200);
  assert.equal((await sil(t.ahmet)).s, 200, "red sonrası kendi fotoğrafını siler");
  assert.equal((await cagir(t.veli, `/rollout/cleanup/${k.v.row.id}`, { method: "DELETE" })).s, 403);
  assert.equal((await cagir(t.orhan, `/rollout/cleanup/${k.v.row.id}`, { method: "DELETE" })).s, 200);
});
