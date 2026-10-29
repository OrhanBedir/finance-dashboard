#!/usr/bin/env node
// MALZEME STOK DEFTERİ — ÖN KONTROL / UZLAŞTIRMA RAPORU (29.10.2026). VERİTABANINDA HİÇBİR ŞEYİ DEĞİŞTİRMEZ.
//   1) Eski kayıtları (depo_stok, sarf_kullanim, malzeme_dagitim, malzeme_talepler) kayıpsız okur, belirsiz durumları işaretler.
//   2) Ürün kartı önerisi ve AÇILIŞ SAYIM ŞABLONU üretir — miktar sütunu BOŞ bırakılır: eski kayıt tahmini stok sayılmaz,
//      yalnız "bilgi" sütununda gösterilir; kesin miktar fiziksel sayımla girilir.
//   3) Stok defteri açıldıysa: hareketlerden yeniden hesaplanan bakiye = malzeme_bakiye, eksi bakiye yok, bekleyen iade ve
//      açık rezervasyon toplamları kovalarla aynı mı — denetler.
// Güvenlik: tek transaction "BEGIN READ ONLY"; ayrıca istemci katmanında yazma sorguları veritabanına gitmeden reddedilir.
// Kullanım:
//   DATABASE_URL=… node backend/scripts/malzeme_on_kontrol.js <cikti.xlsx>      (canlıda yalnız Orhan'ın onayıyla)
//   DB_HOST=127.0.0.1 DB_PORT=55533 DB_NAME=stok_test node backend/scripts/malzeme_on_kontrol.js /tmp/rapor.xlsx
const path = require("path");
const nm = (m) => { try { return require(require.resolve(m, { paths: [path.join(__dirname, ".."), process.cwd()] })); } catch { return require(m); } };
const pg = nm("pg");
const ExcelJS = nm("exceljs");

const IZIN = /^\s*(SELECT|WITH|BEGIN|COMMIT|ROLLBACK|SET\s+(LOCAL\s+)?(statement_timeout|TIME\s+ZONE))\b/i;
const YAZMA = /\b(INSERT\s+INTO|UPDATE\s+[\w."]+\s+SET|DELETE\s+FROM|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY|MERGE|FOR\s+UPDATE|nextval|setval)\b/i;
const orj = pg.Client.prototype.query;
pg.Client.prototype.query = function (config, values, cb) {
  const t = String(typeof config === "string" ? config : (config && config.text) || "");
  if (t && (!IZIN.test(t) || YAZMA.test(t))) {
    const e = new Error("ön kontrol salt-okunurdur; yazma sorgusu engellendi: " + t.slice(0, 80));
    const f = typeof values === "function" ? values : cb;
    if (f) { process.nextTick(() => f(e)); return; }
    return Promise.reject(e);
  }
  return orj.call(this, config, values, cb);
};

const norm = (s) => String(s || "").toLocaleUpperCase("tr").replace(/\s+/g, " ").trim();
const n3 = (v) => Math.round(Number(v || 0) * 1000) / 1000;

(async () => {
  const cikti = process.argv[2] || `malzeme_on_kontrol_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const c = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : { host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER || "postgres", database: process.env.DB_NAME || "postgres", password: process.env.DB_PASSWORD });
  await c.connect();
  await c.query("BEGIN READ ONLY");
  await c.query("SET LOCAL statement_timeout = '60s'");
  const q = async (s, p) => (await c.query(s, p)).rows;
  const varMi = async (t) => (await q(`SELECT to_regclass($1) AS r`, [t]))[0].r !== null;
  const bulgular = []; // { seviye, konu, ayrinti, adet }
  const bul = (seviye, konu, ayrinti, adet = null) => bulgular.push({ seviye, konu, ayrinti, adet });

  // ── 1) Eski depo_stok ──
  const depo = (await varMi("depo_stok")) ? await q(`SELECT d.id, d.malzeme_adi, d.birim, d.toplam_miktar, d.updated_at,
      COALESCE((SELECT SUM(s.miktar) FROM sarf_kullanim s WHERE LOWER(s.malzeme_adi)=LOWER(d.malzeme_adi) AND s.islem_turu='CIKIS'),0) AS sarf_cikis,
      COALESCE((SELECT SUM(s.miktar) FROM sarf_kullanim s WHERE LOWER(s.malzeme_adi)=LOWER(d.malzeme_adi) AND s.islem_turu='REZERVE'),0) AS sarf_rezerve,
      COALESCE((SELECT SUM(s.miktar) FROM sarf_kullanim s WHERE LOWER(s.malzeme_adi)=LOWER(d.malzeme_adi) AND s.islem_turu='GIRIS'),0) AS sarf_giris
    FROM depo_stok d ORDER BY d.malzeme_adi`) : [];
  const ayniAd = {};
  for (const d of depo) (ayniAd[norm(d.malzeme_adi)] = ayniAd[norm(d.malzeme_adi)] || []).push(d);
  const tekrar = Object.values(ayniAd).filter((l) => l.length > 1);
  if (tekrar.length) bul("UYARI", "depo_stok'ta aynı adla birden çok satır", tekrar.map((l) => `${l[0].malzeme_adi} (${l.map((x) => x.birim).join("/")})`).join("; "), tekrar.length);
  const girisli = depo.filter((d) => Number(d.sarf_giris) > 0);
  if (girisli.length) bul("BELİRSİZ", "Sarf 'GIRIS' kayıtları eski depo kalan hesabına hiç yansımamış", "Eski ekran depoda_kalan = toplam − çıkış − rezerve; GIRIS dikkate alınmıyordu", girisli.length);
  const eksi = depo.filter((d) => Number(d.toplam_miktar) - Number(d.sarf_cikis) - Number(d.sarf_rezerve) < 0);
  if (eksi.length) bul("BELİRSİZ", "Eski hesapta eksiye düşen depo kalanı", eksi.map((d) => d.malzeme_adi).join("; "), eksi.length);

  // ── 2) Eski malzeme_dagitim ──
  const dag = (await varMi("malzeme_dagitim")) ? await q(`SELECT d.*, t.talep_no FROM malzeme_dagitim d LEFT JOIN malzeme_talepler t ON t.id = d.talep_id ORDER BY d.id`) : [];
  const kismiSaha = dag.filter((d) => d.durum === "SAHADA" && d.saha_kullanim_miktar != null && Number(d.saha_kullanim_miktar) < Number(d.miktar));
  if (kismiSaha.length) bul("BELİRSİZ", "Kısmi saha çıkışı: kalan miktar eski sistemde OTOMATİK depoya eklenmişti", "Malzeme fiziksel olarak personelde kalmış olabilir — sayımda doğrulayın", kismiSaha.length);
  const iadeBek = dag.filter((d) => d.durum === "IADE_BEKLEMEDE");
  if (iadeBek.length) bul("BELİRSİZ", "Bekleyen eski iade talepleri", "Eski 'iade onayla' ucu sorgu hatası nedeniyle stoğu artırıp durumu güncelleyememiş olabilir; fiziksel konumu sayımda belirleyin", iadeBek.length);
  const ozetSaha = dag.filter((d) => d.durum === "SAHADA");
  if (ozetSaha.length) bul("BİLGİ", "Eski saha özeti ilk teslim miktarını topluyordu", `SAHADA kayıtlarında teslim ${n3(ozetSaha.reduce((a, d) => a + Number(d.miktar), 0))}, gerçek kullanım ${n3(ozetSaha.reduce((a, d) => a + Number(d.saha_kullanim_miktar ?? d.miktar), 0))}`, ozetSaha.length);
  const adsiz = dag.filter((d) => !d.alici_personel_email && !d.alici_personel_id);
  if (adsiz.length) bul("UYARI", "E-postası / personel kimliği olmayan zimmet kayıtları (yalnız ad ile eşleşiyor)", adsiz.slice(0, 15).map((d) => `#${d.id} ${d.alici_personel_ad || d.alici_firma || "?"}`).join("; "), adsiz.length);

  // ── 3) Satın alma talepleri ──
  const tal = (await varMi("malzeme_talepler")) ? await q(`SELECT t.id, t.talep_no, t.durum, k.id AS kalem_id, k.malzeme_adi, k.miktar, k.birim, k.temin_turu, k.dagitim_yapildi
    FROM malzeme_talepler t JOIN malzeme_talep_kalemleri k ON k.talep_id = t.id WHERE t.durum IN ('DEPODA','SATINALINACAK') ORDER BY t.id, k.id`) : [];
  const depodaYeni = tal.filter((x) => x.durum === "DEPODA" && x.temin_turu === "Yeni Alım");
  if (depodaYeni.length) bul("BELİRSİZ", "DEPODA durumundaki 'Yeni Alım' kalemleri", "Eski sistemde DEPODA geçişi ve 'Satın Alındı' düğmesi aynı alımı iki kez stoğa ekleyebiliyordu; depo_stok miktarı kesin değildir", depodaYeni.length);
  const bekleyenAlim = tal.filter((x) => x.durum === "SATINALINACAK");
  if (bekleyenAlim.length) bul("BİLGİ", "Satın alınacak (henüz mal kabulü yapılmamış) kalemler", "Açılıştan sonra gelen mallar Stok Defteri › Mal Kabul ile girilir", bekleyenAlim.length);

  // ── 4) Ürün kartı önerisi (eski serbest adlardan) ──
  const kaynaklar = [];
  if (await varMi("malzeme_fiyat_listesi")) kaynaklar.push(...(await q(`SELECT malzeme_adi AS ad, birim, kategori, 'fiyat listesi' AS kaynak FROM malzeme_fiyat_listesi`)));
  kaynaklar.push(...depo.map((d) => ({ ad: d.malzeme_adi, birim: d.birim, kaynak: "depo_stok" })));
  kaynaklar.push(...dag.map((d) => ({ ad: d.malzeme_adi, birim: d.birim, kaynak: "dağıtım" })));
  const urunler = new Map();
  for (const k of kaynaklar) {
    const a = norm(k.ad); if (!a) continue;
    const u = urunler.get(a) || { ad: String(k.ad).trim(), birimler: new Set(), kaynaklar: new Set(), kategori: k.kategori || "" };
    if (k.birim) u.birimler.add(String(k.birim).trim()); u.kaynaklar.add(k.kaynak); urunler.set(a, u);
  }
  const defterUrun = (await varMi("malzeme_urun")) ? await q(`SELECT kod, ad FROM malzeme_urun`) : [];
  const defterAd = new Set(defterUrun.map((x) => norm(x.ad)));
  const cokBirim = [...urunler.values()].filter((u) => u.birimler.size > 1);
  if (cokBirim.length) bul("UYARI", "Aynı ad farklı birimlerle kullanılmış", cokBirim.slice(0, 20).map((u) => `${u.ad} (${[...u.birimler].join("/")})`).join("; "), cokBirim.length);

  // ── 5) Personel bazında eski "üzerinde" tahmini (KESİN DEĞİL) ──
  const perTah = new Map();
  for (const d of dag) {
    const anahtar = `${(d.alici_personel_email || "").toLowerCase() || "ad:" + norm(d.alici_personel_ad)}|${norm(d.malzeme_adi)}`;
    const e = perTah.get(anahtar) || { email: (d.alici_personel_email || "").toLowerCase(), ad: d.alici_personel_ad || d.alici_firma || "", malzeme: d.malzeme_adi, birim: d.birim, personelde: 0, iade_bekleyen: 0, kismi_saha_kalani: 0 };
    if (d.durum === "PERSONELDE") e.personelde += Number(d.miktar);
    if (d.durum === "IADE_BEKLEMEDE") e.iade_bekleyen += Number(d.iade_miktar || d.miktar);
    if (d.durum === "SAHADA" && d.saha_kullanim_miktar != null) e.kismi_saha_kalani += Math.max(0, Number(d.miktar) - Number(d.saha_kullanim_miktar));
    perTah.set(anahtar, e);
  }

  // ── 6) Stok defteri denetimi (açıldıysa) ──
  let defter = null;
  if (await varMi("malzeme_hareket")) {
    const yeniden = await q(`WITH d AS (
        SELECT hedef_tip t, hedef_id i, urun_id u, miktar m FROM malzeme_hareket WHERE hedef_tip IN ('DEPO','PERSONEL','IADE','REZERV','SAHA')
        UNION ALL SELECT kaynak_tip, kaynak_id, urun_id, -miktar FROM malzeme_hareket WHERE kaynak_tip IN ('DEPO','PERSONEL','IADE','REZERV','SAHA'))
      SELECT d.t, d.i, d.u, SUM(d.m) AS hesap, COALESCE(MAX(b.miktar),0) AS bakiye FROM d
      LEFT JOIN malzeme_bakiye b ON b.lok_tip = d.t AND b.lok_id = d.i AND b.urun_id = d.u GROUP BY d.t, d.i, d.u`);
    const yetim = await q(`SELECT b.* FROM malzeme_bakiye b WHERE b.miktar <> 0 AND NOT EXISTS (SELECT 1 FROM malzeme_hareket h WHERE h.urun_id = b.urun_id
      AND ((h.hedef_tip = b.lok_tip AND h.hedef_id = b.lok_id) OR (h.kaynak_tip = b.lok_tip AND h.kaynak_id = b.lok_id)))`);
    const iadeUyum = await q(`SELECT x.personel_id, x.urun_id, x.bek, COALESCE(b.miktar,0) AS kova FROM
      (SELECT personel_id, urun_id, SUM(miktar) bek FROM malzeme_iade WHERE durum='BEKLIYOR' GROUP BY 1,2) x
      FULL JOIN (SELECT lok_id::int AS personel_id, urun_id, miktar FROM malzeme_bakiye WHERE lok_tip='IADE' AND miktar <> 0) b USING (personel_id, urun_id)
      WHERE COALESCE(x.bek,0) <> COALESCE(b.miktar,0)`);
    const rezUyum = await q(`SELECT z.id, z.durum, COALESCE(b.miktar,0) AS kova FROM malzeme_rezervasyon z
      LEFT JOIN malzeme_bakiye b ON b.lok_tip='REZERV' AND b.lok_id = z.id::text WHERE (z.durum = 'ACIK') <> (COALESCE(b.miktar,0) > 0)`);
    const uyumsuz = yeniden.filter((x) => Math.abs(Number(x.hesap) - Number(x.bakiye)) > 1e-9);
    const eksiB = await q(`SELECT * FROM malzeme_bakiye WHERE miktar < 0`);
    const hs = await q(`SELECT tur, COUNT(*) adet, SUM(miktar) toplam FROM malzeme_hareket GROUP BY tur ORDER BY tur`);
    defter = { kova: yeniden.length, uyumsuz, yetim, iadeUyum, rezUyum, eksiB, hs };
    if (uyumsuz.length || yetim.length) bul("HATA", "Stok defteri: hareket toplamı ile bakiye tablosu uyuşmuyor", JSON.stringify([...uyumsuz, ...yetim].slice(0, 10)), uyumsuz.length + yetim.length);
    if (iadeUyum.length) bul("HATA", "Stok defteri: bekleyen iade toplamı ≠ iade kovası", JSON.stringify(iadeUyum.slice(0, 10)), iadeUyum.length);
    if (rezUyum.length) bul("HATA", "Stok defteri: rezervasyon durumu ≠ rezerve kovası", JSON.stringify(rezUyum.slice(0, 10)), rezUyum.length);
    if (eksiB.length) bul("HATA", "Stok defteri: eksi bakiye", JSON.stringify(eksiB.slice(0, 10)), eksiB.length);
    if (!uyumsuz.length && !yetim.length && !iadeUyum.length && !rezUyum.length && !eksiB.length) bul("TAMAM", "Stok defteri uzlaştırması", `${yeniden.length} kova hareketlerle birebir aynı; eksi bakiye yok`);
  } else bul("BİLGİ", "Stok defteri tabloları yok", "Yeni backend henüz yayında değil (tablolar ilk açılışta oluşur)");
  await c.query("ROLLBACK");
  await c.end();

  // ── Excel ──
  const wb = new ExcelJS.Workbook();
  const sayfa = (ad, kolonlar, satirlar, not) => {
    const ws = wb.addWorksheet(ad, { views: [{ state: "frozen", ySplit: 2, showGridLines: false }] });
    ws.getCell("A1").value = not || ad; ws.getCell("A1").font = { bold: true, color: { argb: "FF1E3A5F" } };
    ws.getRow(2).values = kolonlar.map((k) => k[0]); ws.getRow(2).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(2).eachCell((x) => { x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } }; });
    kolonlar.forEach((k, i) => { ws.getColumn(i + 1).width = k[2] || 16; });
    for (const s of satirlar) ws.addRow(kolonlar.map((k) => (typeof k[1] === "function" ? k[1](s) : s[k[1]]) ?? ""));
    return ws;
  };
  sayfa("Bulgular", [["Seviye", "seviye", 10], ["Konu", "konu", 60], ["Adet", "adet", 8], ["Ayrıntı", "ayrinti", 100]], bulgular,
    `Malzeme stok ön kontrolü — ${new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} · SALT-OKUNUR, veritabanında değişiklik yapılmadı`);
  sayfa("Eski Depo Stok", [["#", "id", 6], ["Malzeme", "malzeme_adi", 40], ["Birim", "birim", 8], ["Toplam (kayıt)", (d) => n3(d.toplam_miktar), 12], ["Sarf çıkış", (d) => n3(d.sarf_cikis), 10],
    ["Sarf rezerve", (d) => n3(d.sarf_rezerve), 10], ["Sarf giriş (hesaba girmemiş)", (d) => n3(d.sarf_giris), 14], ["Eski ekranın kalanı", (d) => n3(d.toplam_miktar - d.sarf_cikis - d.sarf_rezerve), 14]], depo,
  "Eski depo_stok — yalnız bilgi; kesin stok fiziksel sayımla belirlenir");
  sayfa("Eski Zimmet", [["#", "id", 6], ["Personel", "alici_personel_ad", 24], ["E-posta", "alici_personel_email", 28], ["Malzeme", "malzeme_adi", 34], ["Miktar", (d) => n3(d.miktar), 9], ["Birim", "birim", 8],
    ["Durum", "durum", 14], ["Saha kullanım", (d) => d.saha_kullanim_miktar == null ? "" : n3(d.saha_kullanim_miktar), 10], ["İade miktarı", (d) => d.iade_miktar == null ? "" : n3(d.iade_miktar), 10],
    ["Saha", (d) => d.saha_site_id || d.site_id || "", 12], ["Talep", "talep_no", 12], ["Verilme", (d) => d.verilme_tarihi ? new Date(d.verilme_tarihi).toLocaleDateString("tr-TR") : "", 11],
    ["Belirsizlik", (d) => d.durum === "IADE_BEKLEMEDE" ? "iade onayı hatası olabilir" : (d.durum === "SAHADA" && d.saha_kullanim_miktar != null && Number(d.saha_kullanim_miktar) < Number(d.miktar)) ? "kalan depoya otomatik eklenmişti" : "", 30]], dag);
  sayfa("Personel Tahmini", [["Personel", "ad", 24], ["E-posta", "email", 28], ["Malzeme", "malzeme", 34], ["Birim", "birim", 8], ["Eski: personelde", (x) => n3(x.personelde), 12],
    ["Eski: iade bekleyen", (x) => n3(x.iade_bekleyen), 12], ["Kısmi saha kalanı (depoya eklenmişti)", (x) => n3(x.kismi_saha_kalani), 16]],
  [...perTah.values()].filter((x) => x.personelde || x.iade_bekleyen || x.kismi_saha_kalani), "Eski kayıtlardan TAHMİN — kesin değildir, açılışta personelle birlikte sayılarak doğrulanmalıdır");
  sayfa("Ürün Önerisi", [["kod (doldurun)", () => "", 14], ["ad", "ad", 44], ["temel_birim", (u) => [...u.birimler][0] || "Adet", 12], ["tur (SARF/EKIPMAN)", () => "SARF", 12], ["kategori", "kategori", 14],
    ["min_stok", () => "", 10], ["Diğer birimler", (u) => [...u.birimler].slice(1).join(", "), 14], ["Kaynak", (u) => [...u.kaynaklar].join(", "), 22], ["Defterde var mı", (u) => defterAd.has(norm(u.ad)) ? "EVET" : "", 10]],
  [...urunler.values()].sort((a, b) => a.ad.localeCompare(b.ad, "tr")), "Ürün kartı önerisi (eski serbest adlardan) — kod verin, birimi kontrol edin; Stok Defteri › Ürünler › Toplu ekle (önce önizleme)");
  const sab = sayfa("Açılış Şablonu", [["urun_kodu", () => "", 14], ["miktar (SAYIM)", () => "", 14], ["birim", "birim", 10], ["personel_email (boş = depo)", "email", 30], ["Bilgi: malzeme", "malzeme", 34],
    ["Bilgi: personel", "ad", 22], ["Bilgi: eski kayıt tahmini", (x) => n3(x.personelde + x.iade_bekleyen + x.kismi_saha_kalani), 14]],
  [...perTah.values()].filter((x) => x.personelde || x.iade_bekleyen || x.kismi_saha_kalani), "AÇILIŞ ŞABLONU — miktar sütununu FİZİKSEL SAYIMLA doldurun; tahmin sütunu yalnız yol göstericidir ve yüklenmez");
  sab.getColumn(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
  if (defter) sayfa("Defter Denetimi", [["Hareket türü", "tur", 18], ["Adet", "adet", 8], ["Toplam miktar", (x) => n3(x.toplam), 14]], defter.hs,
    `Stok defteri: ${defter.kova} kova · uyumsuz ${defter.uyumsuz.length} · yetim ${defter.yetim.length} · iade ${defter.iadeUyum.length} · rezervasyon ${defter.rezUyum.length} · eksi ${defter.eksiB.length}`);
  await wb.xlsx.writeFile(cikti);
  console.log(`Ön kontrol raporu: ${cikti}`);
  for (const b of bulgular) console.log(`[${b.seviye}] ${b.konu}${b.adet != null ? ` (${b.adet})` : ""}`);
})().catch((e) => { console.error("ÖN KONTROL HATASI:", e.message); process.exit(1); });
