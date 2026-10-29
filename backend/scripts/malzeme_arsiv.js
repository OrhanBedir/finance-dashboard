#!/usr/bin/env node
// MALZEME YÖNETİMİ — ESKİ OPERASYON KAYITLARI ARŞİVİ (29.10.2026). Kalıcı silme YAPMAZ.
//   onizle  [rapor.xlsx]                  → SALT-OKUNUR etki tablosu + kalıcı silme planı (SQL metni, çalıştırılmaz)
//   uygula  --onay EVET [--acik-dahil]    → geri alınabilir arşiv: önce yedek tablolar, sonra arsiv_tarihi / arsiv_parti
//   geri-al --parti N --onay EVET         → partinin arşivini kaldırır (kayıtlar aktif panele döner)
// Arşiv: kayıt SİLİNMEZ; aktif panelde / sayaçlarda / onay listelerinde görünmez, yönetici "Arşivi göster" ile görür.
// Kapsam: Teknocenter'a ait olmayan (firma boş ya da TEKNO dışı) talepler, eski dağıtım (zimmet) ve sarf kayıtları.
// DOKUNULMAZ: malzeme adları / fiyat listesi / fiyat geçmişi, eski depo_stok (paylaşılan depo), stok defteri (hareketler
// silinemez), fatura / ödeme / muhasebe / personel / diğer modüller, belge dosyaları. Stok defterine bağlı talep arşivlenmez.
// Açık durumdaki talepler (onayda / satın alınacak) varsayılan olarak ARŞİVLENMEZ: listelenir, karar Orhan'ındır.
// Canlı veritabanında (DATABASE_URL) uygula / geri-al ancak --canli-onayli bayrağıyla çalışır (Orhan'ın açık onayı).
const path = require("path");
const fs = require("fs");
const nm = (m) => { try { return require(require.resolve(m, { paths: [path.join(__dirname, ".."), process.cwd()] })); } catch { return require(m); } };
const pg = nm("pg");
const ExcelJS = nm("exceljs");

const ACIK = ["ROLLOUT_BEKLE", "NURCAN_ONAY", "PM_ONAY", "FIYAT_GIRISI", "DUZGUN_ONAY", "SATINALINACAK"];
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const bayrak = (k) => process.argv.includes(k);
const mod = process.argv[2];

function baglanti() {
  return new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : { host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER || "postgres", database: process.env.DB_NAME || "postgres", password: process.env.DB_PASSWORD });
}
const varMi = async (c, t) => (await c.query(`SELECT to_regclass($1) AS r`, [t])).rows[0].r !== null;
const kolonVar = async (c, t, k) => (await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`, [t, k])).rows.length > 0;

// Arşivlenecek talepler (kural tek yerde): Teknocenter dışı, arşivlenmemiş, stok defterine bağlı olmayan; açıklar bayrakla
async function hedefTalepler(c, acikDahil) {
  const stokVar = await varMi(c, "malzeme_hareket");
  const r = await c.query(`SELECT t.id, t.talep_no, t.durum, t.firma, t.talep_eden_ad, t.site_id, t.created_at,
      (SELECT COUNT(*) FROM malzeme_talep_kalemleri k WHERE k.talep_id = t.id)::int AS kalem,
      ${stokVar ? `(SELECT COUNT(*) FROM malzeme_hareket h WHERE h.talep_id = t.id)::int` : "0"} AS stok_hareket
    FROM malzeme_talepler t WHERE t.arsiv_tarihi IS NULL AND UPPER(COALESCE(t.firma,'')) <> 'TEKNO' ORDER BY t.id`);
  const satir = r.rows;
  return {
    arsivlenecek: satir.filter((t) => t.stok_hareket === 0 && (acikDahil || !ACIK.includes(t.durum))),
    acik_karar: satir.filter((t) => t.stok_hareket === 0 && !acikDahil && ACIK.includes(t.durum)),
    stoklu: satir.filter((t) => t.stok_hareket > 0),
  };
}

async function onizle(c, cikti) {
  for (const k of ["arsiv_tarihi"]) if (!(await kolonVar(c, "malzeme_talepler", k))) throw new Error("Arşiv kolonları yok — yeni backend henüz yayında değil (katalog şeması açılışta kurulur)");
  const h = await hedefTalepler(c, bayrak("--acik-dahil"));
  const ids = h.arsivlenecek.map((t) => t.id);
  const say = async (sql, p = []) => Number((await c.query(sql, p)).rows[0]?.n || 0);
  const kalem = await say(`SELECT COUNT(*) n FROM malzeme_talep_kalemleri WHERE talep_id = ANY($1::int[])`, [ids]);
  const fg = (await varMi(c, "malzeme_fiyat_gecmisi")) ? await say(`SELECT COUNT(*) n FROM malzeme_fiyat_gecmisi WHERE talep_id = ANY($1::int[])`, [ids]) : 0;
  const dagT = await say(`SELECT COUNT(*) n FROM malzeme_dagitim WHERE talep_id = ANY($1::int[])`, [ids]);
  const dag = (await c.query(`SELECT id, durum, malzeme_adi, miktar, birim, alici_personel_ad, tutanak_url FROM malzeme_dagitim WHERE arsiv_tarihi IS NULL ORDER BY id`)).rows;
  const sarf = await say(`SELECT COUNT(*) n FROM sarf_kullanim WHERE arsiv_tarihi IS NULL`);
  const depo = await say(`SELECT COUNT(*) n FROM depo_stok`);
  const fl = await say(`SELECT COUNT(*) n FROM malzeme_fiyat_listesi`);
  const urun = (await varMi(c, "malzeme_urun")) ? await say(`SELECT COUNT(*) n FROM malzeme_urun`) : 0;
  const har = (await varMi(c, "malzeme_hareket")) ? await say(`SELECT COUNT(*) n FROM malzeme_hareket`) : 0;
  const tekno = await say(`SELECT COUNT(*) n FROM malzeme_talepler WHERE UPPER(COALESCE(firma,'')) = 'TEKNO' AND arsiv_tarihi IS NULL`);
  const dosyalar = dag.filter((d) => d.tutanak_url);
  // Dosya başka kayıtta da kullanılıyor mu (aynı URL birden çok dağıtımda) — kalıcı silmede dosya silinmeden önce bakılır
  const dosyaKullanim = {};
  for (const d of dosyalar) dosyaKullanim[d.tutanak_url] = (dosyaKullanim[d.tutanak_url] || 0) + 1;
  const tablo = [
    { tablo: "malzeme_talepler (Teknocenter dışı, kapalı)", sayi: h.arsivlenecek.length, islem: "ARŞİV (geri alınabilir)", iliski: `${kalem} kalem, ${dagT} dağıtım bağı, ${fg} fiyat geçmişi bağı`, korunan: "Kayıt ve numara korunur; numara yeniden verilmez (yıl sayacı)" },
    { tablo: "malzeme_talepler (açık: onayda / satın alınacak)", sayi: h.acik_karar.length, islem: "KARAR BEKLİYOR (varsayılan: dokunulmaz)", iliski: "Tedarik sürüyor olabilir", korunan: "Tamamı aktif kalır; --acik-dahil ile arşivlenir" },
    { tablo: "malzeme_talepler (stok defterine bağlı)", sayi: h.stoklu.length, islem: "DOKUNULMAZ", iliski: "Mal kabul / teslim hareketi var", korunan: "Tamamı" },
    { tablo: "malzeme_talepler (firma TEKNO)", sayi: tekno, islem: "DOKUNULMAZ", iliski: "—", korunan: "Tamamı (yeni dönem)" },
    { tablo: "malzeme_talep_kalemleri", sayi: kalem, islem: "Talebiyle birlikte arşivde görünür (ayrı işlem yok)", iliski: "Talep", korunan: "Malzeme adları aynen" },
    { tablo: "malzeme_dagitim (eski zimmet)", sayi: dag.length, islem: "ARŞİV (geri alınabilir)", iliski: `${dag.filter((d) => d.durum === "PERSONELDE").length} kayıt 'personelde' — fiziksel malzeme sahada olabilir, açılış sayımına dahil edin`, korunan: `Belge dosyaları silinmez (${dosyalar.length} tutanak)` },
    { tablo: "sarf_kullanim", sayi: sarf, islem: "ARŞİV (geri alınabilir)", iliski: "—", korunan: "—" },
    { tablo: "depo_stok (eski / paylaşılan depo)", sayi: depo, islem: "DOKUNULMAZ (sıfırlanmaz)", iliski: "Şimşek deposu", korunan: "Tamamı — yalnız Teknocenter panelinde gizli" },
    { tablo: "malzeme_fiyat_listesi (malzeme adları + fiyat)", sayi: fl, islem: "DOKUNULMAZ", iliski: "Katalog kartları fiyat_listesi_id ile bağlanır", korunan: "Ad, kimlik, fiyat" },
    { tablo: "malzeme_fiyat_gecmisi", sayi: await say(`SELECT COUNT(*) n FROM malzeme_fiyat_gecmisi`).catch(() => 0), islem: "DOKUNULMAZ", iliski: "—", korunan: "Tamamı" },
    { tablo: "malzeme_urun (katalog) / stok defteri hareketleri", sayi: urun + har, islem: "DOKUNULMAZ", iliski: "Hareketler silinemez", korunan: "Tamamı" },
    { tablo: "Fatura, ödeme, muhasebe, personel, diğer modüller", sayi: null, islem: "DOKUNULMAZ", iliski: "Malzeme tablolarına bağlı kayıt yok (kod taraması)", korunan: "Tamamı" },
  ];
  console.log("\nTablo / kayıt türü | Kayıt | Yapılacak işlem | Etkilenen ilişkiler | Korunacak");
  for (const t of tablo) console.log(`${t.tablo} | ${t.sayi ?? "—"} | ${t.islem} | ${t.iliski} | ${t.korunan}`);
  const silmePlani = `-- KALICI SİLME PLANI (ÇALIŞTIRILMADI — yalnız Orhan'ın ayrı, açık onayıyla). Önce arşiv uygulanmış ve doğrulanmış olmalı.
-- 1) Yedek (aynı veritabanında; ayrıca pg_dump ile dışa alın):
--    CREATE TABLE yedek_kalici_talepler AS SELECT * FROM malzeme_talepler WHERE arsiv_parti = <PARTI>;
--    CREATE TABLE yedek_kalici_kalemler AS SELECT k.* FROM malzeme_talep_kalemleri k JOIN malzeme_talepler t ON t.id = k.talep_id WHERE t.arsiv_parti = <PARTI>;
--    CREATE TABLE yedek_kalici_dagitim AS SELECT * FROM malzeme_dagitim WHERE arsiv_parti = <PARTI>;
--    CREATE TABLE yedek_kalici_sarf AS SELECT * FROM sarf_kullanim WHERE arsiv_parti = <PARTI>;
-- 2) Silme sırası (çocuk → ebeveyn). fiyat_gecmisi.talep_id bağı KORUNUR (FK yok; talep numarası metin olarak durur):
--    DELETE FROM malzeme_dagitim WHERE arsiv_parti = <PARTI>;      -- tutanak dosyaları SİLİNMEZ (${dosyalar.length} adet; ${Object.values(dosyaKullanim).filter((n) => n > 1).length} dosya birden çok kayıtta)
--    DELETE FROM malzeme_talep_kalemleri WHERE talep_id IN (SELECT id FROM malzeme_talepler WHERE arsiv_parti = <PARTI>);
--    DELETE FROM malzeme_talepler WHERE arsiv_parti = <PARTI> AND NOT EXISTS (SELECT 1 FROM malzeme_hareket h WHERE h.talep_id = malzeme_talepler.id);
--    DELETE FROM sarf_kullanim WHERE arsiv_parti = <PARTI>;
--    Talep numarası sayacı (malzeme_talep_no_sayac) geri alınmaz → silinen numaralar yeniden verilmez.
-- 3) Geri dönüş: INSERT INTO malzeme_talepler SELECT * FROM yedek_kalici_talepler; (aynı sırayla kalemler, dağıtım, sarf)
`;
  if (cikti) {
    const wb = new ExcelJS.Workbook();
    const sayfa = (ad, kol, rows) => { const s = wb.addWorksheet(ad, { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });
      s.getRow(1).values = kol.map((k) => k[0]); s.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      s.getRow(1).eachCell((x) => { x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } }; }); kol.forEach((k, i) => { s.getColumn(i + 1).width = k[2]; });
      for (const r of rows) s.addRow(kol.map((k) => (typeof k[1] === "function" ? k[1](r) : r[k[1]]) ?? "")); };
    sayfa("Etki tablosu", [["Tablo / kayıt türü", "tablo", 46], ["Kayıt sayısı", "sayi", 12], ["Yapılacak işlem", "islem", 36], ["Etkilenen ilişkiler", "iliski", 56], ["Korunacak kayıtlar", "korunan", 50]], tablo);
    const tk = [["#", "id", 7], ["Talep no", "talep_no", 14], ["Durum", "durum", 15], ["Firma", "firma", 8], ["Talep eden", "talep_eden_ad", 24], ["Saha", "site_id", 18], ["Kalem", "kalem", 7], ["Tarih", (r) => new Date(r.created_at).toLocaleDateString("tr-TR"), 12]];
    sayfa("Arşivlenecek talepler", tk, h.arsivlenecek);
    sayfa("Açık talepler (karar)", tk, h.acik_karar);
    sayfa("Eski zimmet (arşiv)", [["#", "id", 7], ["Durum", "durum", 14], ["Malzeme", "malzeme_adi", 44], ["Miktar", "miktar", 9], ["Birim", "birim", 8], ["Personel", "alici_personel_ad", 24], ["Tutanak", "tutanak_url", 40]], dag);
    sayfa("Kalıcı silme planı", [["SQL (çalıştırılmadı)", "x", 160]], silmePlani.split("\n").map((x) => ({ x })));
    await wb.xlsx.writeFile(cikti);
    fs.writeFileSync(cikti.replace(/\.xlsx$/, "_kalici_silme_plani.sql"), silmePlani);
    console.log(`\nRapor: ${cikti}`);
  }
  return { tablo, h, dag: dag.length, sarf };
}

async function uygula(c) {
  if (process.argv[process.argv.indexOf("--onay") + 1] !== "EVET") throw new Error("Uygulamak için: uygula --onay EVET");
  await c.query("BEGIN");
  const h = await hedefTalepler(c, bayrak("--acik-dahil"));
  const ids = h.arsivlenecek.map((t) => t.id);
  const p = (await c.query(`INSERT INTO malzeme_arsiv_parti (aciklama, olusturan) VALUES ($1, $2) RETURNING id`,
    [arg("--aciklama") || "Malzeme Yönetimi Teknocenter'a geçiş — eski operasyon kayıtları", process.env.USER || "betik"])).rows[0].id;
  const y = `yedek_malzeme_arsiv_p${p}`;
  await c.query(`CREATE TABLE ${y}_talepler AS SELECT * FROM malzeme_talepler WHERE id = ANY($1::int[])`, [ids]);
  await c.query(`CREATE TABLE ${y}_kalemler AS SELECT * FROM malzeme_talep_kalemleri WHERE talep_id = ANY($1::int[])`, [ids]);
  await c.query(`CREATE TABLE ${y}_dagitim AS SELECT * FROM malzeme_dagitim WHERE arsiv_tarihi IS NULL`);
  await c.query(`CREATE TABLE ${y}_sarf AS SELECT * FROM sarf_kullanim WHERE arsiv_tarihi IS NULL`);
  for (const t of ["talepler", "kalemler", "dagitim", "sarf"]) await c.query(`ALTER TABLE ${y}_${t} ENABLE ROW LEVEL SECURITY`);
  const a = await c.query(`UPDATE malzeme_talepler SET arsiv_tarihi = now(), arsiv_parti = $2, arsiv_neden = $3 WHERE id = ANY($1::int[]) AND arsiv_tarihi IS NULL`, [ids, p, "Teknocenter öncesi operasyon kaydı"]);
  const d = await c.query(`UPDATE malzeme_dagitim SET arsiv_tarihi = now(), arsiv_parti = $1 WHERE arsiv_tarihi IS NULL`, [p]);
  const s = await c.query(`UPDATE sarf_kullanim SET arsiv_tarihi = now(), arsiv_parti = $1 WHERE arsiv_tarihi IS NULL`, [p]);
  const ozet = { parti: p, talep: a.rowCount, dagitim: d.rowCount, sarf: s.rowCount, acik_dokunulmayan: h.acik_karar.length, stoklu_dokunulmayan: h.stoklu.length, yedek_tablolari: `${y}_*` };
  await c.query(`UPDATE malzeme_arsiv_parti SET ozet = $2 WHERE id = $1`, [p, JSON.stringify(ozet)]);
  await c.query("COMMIT");
  console.log("ARŞİV UYGULANDI (kalıcı silme değil):", ozet);
  console.log(`Geri almak için: node backend/scripts/malzeme_arsiv.js geri-al --parti ${p} --onay EVET`);
}

async function geriAl(c) {
  const p = Number(arg("--parti"));
  if (!p || process.argv[process.argv.indexOf("--onay") + 1] !== "EVET") throw new Error("Kullanım: geri-al --parti N --onay EVET");
  await c.query("BEGIN");
  const pr = (await c.query(`SELECT * FROM malzeme_arsiv_parti WHERE id = $1 FOR UPDATE`, [p])).rows[0];
  if (!pr) throw new Error("Parti bulunamadı");
  if (pr.geri_alma_tarihi) throw new Error("Bu parti zaten geri alınmış");
  const a = await c.query(`UPDATE malzeme_talepler SET arsiv_tarihi = NULL, arsiv_parti = NULL, arsiv_neden = NULL WHERE arsiv_parti = $1`, [p]);
  const d = await c.query(`UPDATE malzeme_dagitim SET arsiv_tarihi = NULL, arsiv_parti = NULL WHERE arsiv_parti = $1`, [p]);
  const s = await c.query(`UPDATE sarf_kullanim SET arsiv_tarihi = NULL, arsiv_parti = NULL WHERE arsiv_parti = $1`, [p]);
  await c.query(`UPDATE malzeme_arsiv_parti SET geri_alma_tarihi = now(), geri_alan = $2 WHERE id = $1`, [p, process.env.USER || "betik"]);
  await c.query("COMMIT");
  console.log("GERİ ALINDI:", { parti: p, talep: a.rowCount, dagitim: d.rowCount, sarf: s.rowCount }, "(yedek tabloları duruyor)");
}

(async () => {
  if (!["onizle", "uygula", "geri-al"].includes(mod)) { console.error("Kullanım: malzeme_arsiv.js onizle [rapor.xlsx] | uygula --onay EVET [--acik-dahil] | geri-al --parti N --onay EVET"); process.exit(1); }
  if (mod !== "onizle" && process.env.DATABASE_URL && !bayrak("--canli-onayli")) { console.error("Canlı veritabanında değişiklik için Orhan'ın açık onayı ve --canli-onayli bayrağı gerekir."); process.exit(1); }
  const c = baglanti(); await c.connect();
  try {
    if (mod === "onizle") { await c.query("BEGIN READ ONLY"); await onizle(c, process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : null); await c.query("ROLLBACK"); }
    else if (mod === "uygula") await uygula(c);
    else await geriAl(c);
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); console.error("HATA:", e.message); process.exitCode = 1; }
  finally { await c.end(); }
})();
module.exports = { hedefTalepler, ACIK };
