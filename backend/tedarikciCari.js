// ═══ TEDARİKÇİ CARİ HESABI — FATURA BORCU / ÖDEME / AVANS / MAHSUP (29.10.2026, Orhan) ═══════════════════════════════
// Teknocenter (alt marka) "Taşeron Faturaları / Avans ve Ödeme" ekranının sunucu tarafı. Paralel cari, ödeme defteri ya da
// fatura sistemi KURULMAZ; mevcut kayıtlar tek kaynaktır:
//   Fatura          invoice_entries (firma = TEKNO / AHY / Şimşek) — borç; ödenen_tutar faturaya uygulanan ödemedir
//   Ödeme / avans   taseron_odeme_log — bir gerçek ödeme = bir satır; dagilim = FIFO ile kapatılan faturalar, avans_tutar =
//                   faturaya uygulanamayan kısım (açık avans). Alt markada nakit akışı satırı marka_taseron_odeme'dir
//                   (odeme_log_id bağıyla; mahsup edilen kısım FATURA_ODEME, kalan AVANS) — eski ERC "Ödeme Gir" ile aynı yazım.
//   Mahsup          taseron_odeme_log islem_turu='MAHSUP' — açık avansı faturaya uygular; NAKİT ÇIKIŞI DEĞİLDİR (marka satırı yok)
//   Ortak ödeme     odeme_kayit / odeme_dagilim (araç kirası) — yalnız okunur
// Tedarikçi kimliği subcons.id'dir (firma kartı; subcon_name iş etiketi, gorunen_ad, unvan, subcon_takma_ad doğrulanmış diğer
// adlar). Eski kayıtların kimliği bu adlardan biriyle Türkçe harf / boşluk / noktalama duyarsız BİREBİR eşleşmeyle çözülür;
// benzerlik, önek (TEKNO_2KX ≈ 2KX) ya da tarih+tutar yakınlığıyla birleştirme YAPILMAZ. Birden çok karta uyan kayıt "kimlik
// belirsiz", hiçbirine uymayan "firma kartı yok" olarak listelenir; ödeme yalnız firma kartı olan tedarikçiye girilir.
// Firma kapsamı: /finance/marka-* yolları server.js "MARKA PANELİ FİRMA KAPSAMI" katmanından geçer — alt marka hesabının
// markası oturumdan zorlanır, ERC hesabı alt marka hedefinde hedef firma hakkı ister. Burada ayrıca kayıt firması doğrulanır.
// Ekran, önizleme, kayıt ve Excel aynı hesaplama fonksiyonunu (cariHesapla) kullanır.
"use strict";
const ExcelJS = require("exceljs");

const PARA = ["TRY", "USD", "EUR"];
const YONTEM = { BANKA: "Banka havalesi / EFT", KASA: "Kasa (nakit)", KART: "Kredi kartı", FIRMA: "Firma kendisi ödedi", DIGER: "Diğer" };
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const tl = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const temiz = (s, n = 300) => String(s ?? "").trim().replace(/\s+/g, " ").slice(0, n);
// Kimlik ve arama için katlama: Türkçe harf → ASCII, büyük/küçük ve harf/rakam dışı fark etmez ("Işık Ltd." = "ISIK LTD")
const katla = (s) => String(s || "").trim().toLocaleUpperCase("tr-TR")
  .replace(/İ/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C")
  .replace(/[^A-Z0-9]+/g, "");
const tarihMi = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const bugunTR = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
// FIFO sırası (ERC fifoTaseronMahsup ile aynı kural): fatura tarihi, boşsa sisteme giriş tarihi; eşitlikte giriş sırası (id)
const FIFO_KURAL = "En eski fatura önce kapanır: sıra fatura tarihine göredir (fatura tarihi boşsa sisteme giriş tarihi), aynı günde giriş sırası. Vade tarihi sırayı değiştirmez.";
const fifoAnahtar = (f) => `${f.fatura_tarihi || f.giris_tarihi || "9999-12-31"}|${String(f.id).padStart(10, "0")}`;

async function semaKur(pool) {
  const q = (s) => pool.query(s).catch((e) => console.error("[tedarikci-cari şema]", e.message));
  await q(`ALTER TABLE invoice_entries ADD COLUMN IF NOT EXISTS tedarikci_id INTEGER`);
  await q(`ALTER TABLE invoice_entries ADD COLUMN IF NOT EXISTS vade_tarihi DATE`);
  await q(`CREATE INDEX IF NOT EXISTS invoice_entries_tedarikci_idx ON invoice_entries (tedarikci_id)`);
  for (const s of ["tedarikci_id INTEGER", "firma_kod TEXT", "idem_key TEXT", "durum TEXT DEFAULT 'AKTIF'", "islem_turu TEXT",
    "yontem TEXT", "referans TEXT", "kasadan_dus BOOLEAN", "para_birimi TEXT", "tl_tutar NUMERIC", "created_by TEXT",
    "iptal_neden TEXT", "iptal_tarihi TIMESTAMP", "iptal_eden TEXT"]) await q(`ALTER TABLE taseron_odeme_log ADD COLUMN IF NOT EXISTS ${s}`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS taseron_odeme_log_idem_uq ON taseron_odeme_log (idem_key) WHERE idem_key IS NOT NULL`);
  for (const s of ["tedarikci_id INTEGER", "kasadan_dus BOOLEAN", "durum TEXT DEFAULT 'AKTIF'", "iptal_neden TEXT", "iptal_tarihi TIMESTAMP", "iptal_eden TEXT"])
    await q(`ALTER TABLE marka_taseron_odeme ADD COLUMN IF NOT EXISTS ${s}`);
  // Taşeron olmayan tedarikçi (otel, nakliyeci, malzemeci…) firma kartı: iş girişi / iş atama taşeron listelerine çıkmaz
  await q(`ALTER TABLE subcons ADD COLUMN IF NOT EXISTS tedarikci_turu TEXT`);
  // 02.11.2026 HAKEDİŞ ESASLI CARİ (TEKNO_EMRAH, TEKNO_SEYFİ): fatura yerine onaylı hakediş borç sayılır. cari_modeli='HAKEDIS'.
  await q(`ALTER TABLE subcons ADD COLUMN IF NOT EXISTS cari_modeli TEXT`);
  // Eski "Diğer Ödeme" (cashflow_odeme) kaydının taşeron avansına aktarımı: kayıt SİLİNMEZ, aktarıldı işaretlenir ve nakit
  // akışı/özet/P&L okumaları onu atlar (aynı para taşeron ödemesi olarak bir kez sayılır).
  for (const x of ["aktarim_log_id INTEGER", "aktarim_tarihi TIMESTAMP", "aktarim_eden TEXT"]) await q(`ALTER TABLE cashflow_odeme ADD COLUMN IF NOT EXISTS ${x}`);
  // Taşeron birim fiyatı (müşteri BoQ/PO'dan AYRI): yalnız açıkça tanımlanan fiyat kullanılır; değişiklik yeni satırdır.
  await q(`CREATE TABLE IF NOT EXISTS taseron_fiyat (id SERIAL PRIMARY KEY, firma_kod TEXT NOT NULL, tedarikci_id INTEGER,
    item_code TEXT NOT NULL, aciklama TEXT, birim TEXT, birim_fiyat NUMERIC NOT NULL, para_birimi TEXT DEFAULT 'TRY',
    gecerlilik_bas DATE NOT NULL, gecerlilik_bit DATE, kaynak TEXT, durum TEXT DEFAULT 'AKTIF', olusturan TEXT, created_at TIMESTAMP DEFAULT NOW(),
    iptal_eden TEXT, iptal_tarihi TIMESTAMP, iptal_neden TEXT)`);
  await q(`CREATE INDEX IF NOT EXISTS taseron_fiyat_idx ON taseron_fiyat (firma_kod, item_code)`);
  // Hakediş belgesi + kalemleri: kalem fiyatı onay anındaki görüntüdür (sonraki fiyat değişikliği eski hakedişi değiştirmez)
  await q(`CREATE TABLE IF NOT EXISTS taseron_hakedis_belge (id SERIAL PRIMARY KEY, firma_kod TEXT NOT NULL, tedarikci_id INTEGER NOT NULL,
    donem TEXT, hakedis_tarihi DATE, durum TEXT NOT NULL DEFAULT 'TASLAK', toplam NUMERIC DEFAULT 0, para_birimi TEXT DEFAULT 'TRY',
    aciklama TEXT, idem_key TEXT, olusturan TEXT, created_at TIMESTAMP DEFAULT NOW(), onaylayan TEXT, onay_tarihi TIMESTAMP,
    iptal_eden TEXT, iptal_tarihi TIMESTAMP, iptal_neden TEXT)`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS taseron_hakedis_belge_idem_uq ON taseron_hakedis_belge (idem_key) WHERE idem_key IS NOT NULL`);
  await q(`CREATE TABLE IF NOT EXISTS taseron_hakedis_kalem (id SERIAL PRIMARY KEY, belge_id INTEGER NOT NULL, master_works_id INTEGER NOT NULL,
    site_code TEXT, fiziksel_id TEXT, item_code TEXT, aciklama TEXT, miktar NUMERIC NOT NULL, birim_fiyat NUMERIC NOT NULL,
    tutar NUMERIC NOT NULL, para_birimi TEXT DEFAULT 'TRY', fiyat_id INTEGER, fiyat_kaynak TEXT)`);
  await q(`CREATE INDEX IF NOT EXISTS taseron_hakedis_kalem_mw_idx ON taseron_hakedis_kalem (master_works_id)`);
}

function kur(app, c) {
  const { pool, authMiddleware, islemGecmisiYaz, altMarkaKullanicisi, altMarkaMi, altMarkaInSql, markaProfil,
    maliYetkiKaydi, odemeYetkili, finansYazmaYetkili, markaFaturaKapsami, upload, uploadToStorage, utf8Name, ensureOdemeTablolari } = c;
  const KASA_ROLLER = c.MARKA_KASA_ROLLER;
  const hata = (res, kod, mesaj, ek) => res.status(kod).json({ ok: false, error: mesaj, ...(ek || {}) });
  const rolOf = (u) => String(u?.role || "").toLowerCase();
  const kim = (req) => String(req.user?.email || "").toLowerCase().trim() || null;
  const hataK = (kod, mesaj, ek) => Object.assign(new Error(mesaj), { kod, ek });

  // ── FİRMA ve YETKİ ────────────────────────────────────────────────────────────────────────────────────────────────
  // Firma kodu: alt marka (TEKNO / AHY) ya da SIMSEK. Alt marka hesabında katman zaten kendi markasını yazdı.
  function firmaKodu(req) {
    const v = String(req.query?.marka || req.body?.marka || "").trim().toUpperCase();
    if (altMarkaKullanicisi(req.user)) return String(req.user.marka || "").trim().toUpperCase();
    if (v === "SIMSEK" || v === "ERC") return "SIMSEK";
    return altMarkaMi(v) ? v : null;
  }
  // Görüntüleme: mevcut marka paneli kuralı (yönetim rolleri) + fiyat görme izni kapalı değil. Ekranı geliştirmek kimseye
  // yeni mali erişim açmaz: liste eskiden de bu rollere açıktı.
  function gorur(req, M) {
    const u = req.user || {};
    if (!M || req.izinler?.fiyat_goruntule === false) return false;
    if (M === "SIMSEK") return finansYazmaYetkili(u); // ERC Finans Paneli / Fatura Girişi kullanıcısı (mevcut finans kuralı)
    if (!KASA_ROLLER.includes(rolOf(u))) return false;
    if (altMarkaKullanicisi(u)) return String(u.marka || "").trim().toUpperCase() === M;
    return true; // ERC hesabı alt marka hedefinde: hedef firma hakkı MARKA PANELİ katmanında doğrulandı
  }
  // Ödeme / avans / mahsup / iptal: görüntüleme + mevcut ödeme işlem yetkisi + MALİ YETKİ MATRİSİ'nde doğrulanmış kişi.
  // Alt marka hesabı yalnız kendi kapsamlı matris kaydıyla (İlhami Şahin, Teknocenter ortak hesabı) — rol adı tek başına yetmez.
  function yazar(req, M) {
    if (!gorur(req, M) || !odemeYetkili(req)) return false;
    const u = req.user || {};
    const y = maliYetkiKaydi(u);
    if (altMarkaKullanicisi(u)) return !!y && y.kapsam === M;
    // 30.10.2026: fiyatı görüp değiştiremeyen (fiyat_degistirme=false; ör. Nurcan, Serdar) ödeme yazamaz
    if (req.izinler?.fiyat_degistirme === false) return false;
    return (!!y && y.kapsam === "ERC") || finansYazmaYetkili(u);
  }
  // Firma kartı tanımlama: ödeme yazarı ya da o firmanın fatura giriş yetkilisi
  const kartAcar = (req, M) => yazar(req, M) || (altMarkaKullanicisi(req.user) ? markaFaturaKapsami(req) === M : finansYazmaYetkili(req.user));
  const firmaSql = (M, col) => M === "SIMSEK"
    ? `UPPER(TRIM(COALESCE(${col},''))) NOT IN (${altMarkaInSql()})`
    : `UPPER(TRIM(COALESCE(${col},''))) = '${M}'`; // M yalnız koddaki marka listesinden gelir

  // ── FİRMA KARTI REHBERİ ───────────────────────────────────────────────────────────────────────────────────────────
  async function rehberOku(db) {
    const r = await db.query(`SELECT s.id, s.subcon_name, s.gorunen_ad, s.unvan, s.ana_firma, COALESCE(s.aktif,true) AS aktif,
        s.tedarikci_turu, s.kaynak, s.cari_modeli, COALESCE((SELECT ARRAY_AGG(t.ad ORDER BY t.ad) FROM subcon_takma_ad t WHERE t.subcon_id = s.id), '{}') AS takma
      FROM subcons s`).catch(() => db.query(`SELECT s.id, s.subcon_name, NULL AS gorunen_ad, NULL AS unvan, NULL AS ana_firma, true AS aktif,
        NULL AS tedarikci_turu, NULL AS kaynak, NULL AS cari_modeli, '{}'::text[] AS takma FROM subcons s`));
    const byId = new Map(), adIdx = new Map();
    for (const s of r.rows) {
      s.adlar = [...new Set([s.subcon_name, s.gorunen_ad, s.unvan, ...(s.takma || [])].filter((x) => temiz(x)))];
      s.katlar = [...new Set(s.adlar.map(katla).filter(Boolean))];
      byId.set(Number(s.id), s);
      for (const k of s.katlar) (adIdx.get(k) || adIdx.set(k, new Set()).get(k)).add(Number(s.id));
    }
    return { byId, coz: (ad) => [...(adIdx.get(katla(ad)) || [])] };
  }
  const kartAd = (s) => temiz(s?.gorunen_ad) || temiz(s?.subcon_name) || "—";
  // 01.11.2026: firma kartı kapsamı (arama, ad çözümü ve hareketi olmayan yeni kartın ödemeye kabulü aynı kuralı kullanır):
  // alt marka → firmaya bağlı kart (ana_firma) ya da firma önekli iş etiketi; Şimşek → alt markaya bağlı olmayan kart.
  const kartKapsamda = (s, M) => M === "SIMSEK"
    ? !(s.ana_firma && altMarkaMi(String(s.ana_firma).trim().toUpperCase()))
    : String(s.ana_firma || "").trim().toUpperCase() === M
      || (s.adlar || []).some((a) => String(a).trim().toUpperCase().startsWith(`${markaProfil(M).onek}_`));

  // ── CARİ HESAPLAMA (tek kaynak: ekran, önizleme, kayıt, Excel) ───────────────────────────────────────────────────────
  // ids: kilitlenecek fatura id'leri (kayıt anında FOR UPDATE ile yeniden okunur)
  async function cariHesapla(db, M, opt = {}) {
    await ensureOdemeTablolari();
    const R = opt.rehber || await rehberOku(db);
    const fat = (await db.query(`SELECT i.id, i.fatura_no, to_char(i.fatura_tarihi,'YYYY-MM-DD') AS fatura_tarihi,
        to_char(i.vade_tarihi,'YYYY-MM-DD') AS vade_tarihi, to_char(i.created_at,'YYYY-MM-DD') AS giris_tarihi,
        i.tedarikci, i.rf_montaj_firma, i.tedarikci_id, COALESCE(i.tutar,0) AS matrah, COALESCE(i.kdv,0) AS kdv,
        COALESCE(i.toplam_tutar,0) AS toplam, COALESCE(i.odenen_tutar,0) AS odenen, COALESCE(i.kalan_borc,0) AS kalan_kayitli,
        UPPER(COALESCE(NULLIF(i.currency,''),'TRY')) AS pb, UPPER(COALESCE(NULLIF(i.fatura_turu,''),'GELEN')) AS tur,
        i.bagli_fatura_id, UPPER(COALESCE(i.is_kalemi,'')) AS kalem, i.belge_path, COALESCE(i.note,'') AS note,
        (UPPER(COALESCE(i.is_kalemi,'')) = 'ARAC_KIRA' OR EXISTS (SELECT 1 FROM fatura_arac_kalem fk WHERE fk.fatura_id = i.id)) AS arac
      FROM invoice_entries i WHERE ${firmaSql(M, "i.firma")} ${opt.kilit ? "ORDER BY i.id FOR UPDATE" : ""}`)).rows;
    const fById = new Map(fat.map((f) => [Number(f.id), f]));
    const ortak = fat.length ? (await db.query(`SELECT d.fatura_id, d.tutar, k.id AS odeme_id, to_char(k.tarih,'YYYY-MM-DD') AS tarih
        FROM odeme_dagilim d JOIN odeme_kayit k ON k.id = d.odeme_id AND k.durum = 'AKTIF' WHERE d.fatura_id = ANY($1::int[])`,
      [fat.map((f) => Number(f.id))])).rows : [];
    const logSql = M === "SIMSEK"
      ? `UPPER(COALESCE(l.firma_kod,'SIMSEK')) = 'SIMSEK' AND l.id NOT IN (SELECT odeme_log_id FROM marka_taseron_odeme WHERE odeme_log_id IS NOT NULL)`
      : `(UPPER(COALESCE(l.firma_kod,'')) = '${M}' OR l.id IN (SELECT odeme_log_id FROM marka_taseron_odeme WHERE UPPER(marka) = '${M}' AND odeme_log_id IS NOT NULL))`;
    const loglar = (await db.query(`SELECT l.id, l.firma, l.tedarikci_id, COALESCE(l.tutar,0) AS tutar, to_char(l.tarih,'YYYY-MM-DD') AS tarih,
        COALESCE(l.aciklama,'') AS aciklama, l.dagilim, COALESCE(l.avans_tutar,0) AS avans_tutar, l.dekont_url,
        COALESCE(l.durum,'AKTIF') AS durum, l.islem_turu, l.yontem, l.referans, l.kasadan_dus, UPPER(COALESCE(l.para_birimi,'TRY')) AS pb,
        l.tl_tutar, l.created_by, l.idem_key, l.iptal_neden, l.iptal_eden, to_char(l.iptal_tarihi,'YYYY-MM-DD HH24:MI') AS iptal_tarihi,
        to_char(l.created_at,'YYYY-MM-DD HH24:MI') AS giris
      FROM taseron_odeme_log l WHERE ${logSql} ORDER BY l.tarih, l.id`)).rows;
    // Eski marka satırları (ödeme logu olmadan yazılmış avans / fatura ödemesi) — yalnız alt markada
    const eskiMarka = M === "SIMSEK" ? [] : (await db.query(`SELECT m.id, m.taseron_adi, m.tedarikci_id, UPPER(COALESCE(m.tip,'AVANS')) AS tip,
        COALESCE(m.tutar,0) AS tutar, to_char(m.tarih,'YYYY-MM-DD') AS tarih, COALESCE(m.aciklama,'') AS aciklama,
        COALESCE(m.durum,'AKTIF') AS durum, m.iptal_neden, m.iptal_eden, to_char(m.created_at,'YYYY-MM-DD HH24:MI') AS giris
      FROM marka_taseron_odeme m WHERE UPPER(m.marka) = $1 AND m.odeme_log_id IS NULL ORDER BY m.tarih, m.id`, [M])).rows;

    // Kimlik çözümü: açık kimlik (tedarikci_id) > ad eşleşmesi (tek karta) > hiçbiri (firma kartı yok) / çoklu (belirsiz)
    const kimlikAd = (id, adlar) => {
      if (id && R.byId.has(Number(id))) return { anahtar: `id:${Number(id)}`, id: Number(id), durum: "KART" };
      const adl = adlar.map((x) => temiz(x)).filter(Boolean);
      const ids = new Set(); adl.forEach((a) => R.coz(a).forEach((x) => ids.add(x)));
      if (ids.size === 1) { const x = [...ids][0]; return { anahtar: `id:${x}`, id: x, durum: "KART" }; }
      // 01.11.2026: aynı ad birden çok karta uyuyorsa önce BU firmanın kapsamındaki kart aranır (ör. Şimşek'in eski "İZTAŞ"
      // kartı ile Teknocenter'ın İztaş kartı); kapsamda tek kart varsa kimlik odur. Kapsam dışı çoklu eşleşme yine "belirsiz".
      if (ids.size > 1) { const icerde = [...ids].filter((x) => kartKapsamda(R.byId.get(x), M)); if (icerde.length === 1) return { anahtar: `id:${icerde[0]}`, id: icerde[0], durum: "KART" }; }
      const birincil = adl[0] || "—";
      if (ids.size > 1) return { anahtar: `ad:${katla(birincil)}`, id: null, durum: "BELIRSIZ", ad: birincil, adaylar: [...ids] };
      return { anahtar: `ad:${katla(birincil)}`, id: null, durum: "KIMLIKSIZ", ad: birincil };
    };
    const cari = new Map();
    const pbBos = () => ({ fatura: 0, iade: 0, iade_bagli: 0, uygulanan: 0, kalan: 0, avans_olusan: 0, mahsup: 0, iade_alacak: 0, fazla_odeme: 0,
      nakit: 0, matrah: 0, acik_fatura: 0, avans_acik: 0, alacak: 0, net: 0 });
    const satir = (k) => {
      if (!cari.has(k.anahtar)) {
        const s = k.id ? R.byId.get(k.id) : null;
        cari.set(k.anahtar, { anahtar: k.anahtar, id: k.id, kimlik: k.durum, ad: s ? kartAd(s) : k.ad, unvan: s?.unvan || null,
          etiketler: s ? s.adlar : [k.ad], etiket_katla: s ? s.katlar : [katla(k.ad)], ana_firma: s?.ana_firma || null,
          tur: s?.tedarikci_turu || (s ? "TASERON" : null), aktif: s ? s.aktif !== false : true,
          cari_modeli: String(s?.cari_modeli || "").toUpperCase() === "HAKEDIS" ? "HAKEDIS" : "FATURA", hakedisler: [],
          adaylar: (k.adaylar || []).map((x) => ({ id: x, ad: kartAd(R.byId.get(x)), unvan: R.byId.get(x)?.unvan || null })),
          pb: {}, faturalar: [], hareketler: [], uyarilar: [] });
      }
      const c0 = cari.get(k.anahtar);
      if (k.durum === "BELIRSIZ" && c0.kimlik !== "BELIRSIZ") { c0.kimlik = "BELIRSIZ"; c0.adaylar = (k.adaylar || []).map((x) => ({ id: x, ad: kartAd(R.byId.get(x)), unvan: R.byId.get(x)?.unvan || null })); }
      return c0;
    };
    const pbOf = (c0, pb) => c0.pb[pb] || (c0.pb[pb] = pbBos());
    // 02.11.2026: hakediş esaslı cari kartları (bu firmanın kapsamında, aktif) faturası/hareketi olmasa da listede görünür
    for (const s of R.byId.values()) if (String(s.cari_modeli || "").toUpperCase() === "HAKEDIS" && s.aktif !== false && kartKapsamda(s, M))
      satir({ anahtar: `id:${Number(s.id)}`, id: Number(s.id), durum: "KART" });
    // Onaylı hakedişler (borç). TASLAK ve İPTAL borç değildir; yalnız listede durumuyla görünür.
    const hk = M === "SIMSEK" ? [] : (await db.query(`SELECT b.id, b.tedarikci_id, b.donem, to_char(b.hakedis_tarihi,'YYYY-MM-DD') AS tarih, b.durum,
        COALESCE(b.toplam,0) AS toplam, UPPER(COALESCE(b.para_birimi,'TRY')) AS pb, b.aciklama, b.olusturan, b.onaylayan,
        to_char(b.onay_tarihi,'YYYY-MM-DD HH24:MI') AS onay_tarihi, b.iptal_neden, (SELECT COUNT(*)::int FROM taseron_hakedis_kalem k WHERE k.belge_id = b.id) AS kalem_sayisi
      FROM taseron_hakedis_belge b WHERE UPPER(b.firma_kod) = $1 ORDER BY b.hakedis_tarihi NULLS LAST, b.id`, [M]).catch(() => ({ rows: [] }))).rows;

    // Log dağılımı (AKTİF) fatura bazında — faturadaki ödenen tutarın kaynağını ayırmak için
    const logDag = new Map();
    const dagOku = (l) => { let d = l.dagilim; if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = []; } } return Array.isArray(d) ? d : []; };
    for (const l of loglar) {
      l._dag = dagOku(l).filter((d) => d && d.fatura_id && Number(d.odeme || 0) > 0).map((d) => ({ fatura_id: Number(d.fatura_id), fatura_no: d.fatura_no, odeme: r2(d.odeme) }));
      if (l.durum !== "AKTIF") continue;
      for (const d of l._dag) logDag.set(d.fatura_id, r2((logDag.get(d.fatura_id) || 0) + d.odeme));
    }
    const ortakF = new Map();
    for (const o of ortak) ortakF.set(Number(o.fatura_id), r2((ortakF.get(Number(o.fatura_id)) || 0) + Number(o.tutar)));
    // İade faturaları: bağlı olduğu (aynı firma) faturanın açık tutarını düşürür; bağsız iade alacak olarak kalır
    const iadeBagli = new Map();
    const fKimlik = new Map();
    for (const f of fat) fKimlik.set(Number(f.id), kimlikAd(f.tedarikci_id, [f.rf_montaj_firma, f.tedarikci]));
    for (const f of fat) {
      if (f.tur === "GELEN" || !f.bagli_fatura_id) continue;
      const h = fById.get(Number(f.bagli_fatura_id));
      if (h && h.tur === "GELEN" && h.pb === f.pb && fKimlik.get(Number(h.id)).anahtar === fKimlik.get(Number(f.id)).anahtar) {
        iadeBagli.set(Number(h.id), r2((iadeBagli.get(Number(h.id)) || 0) + Number(f.toplam))); f._bagli = true;
      }
    }
    for (const f of fat) {
      const k = fKimlik.get(Number(f.id));
      const c0 = satir(k); const P = pbOf(c0, f.pb);
      const toplam = r2(f.toplam), odenen = r2(f.odenen);
      const fx = { id: Number(f.id), fatura_no: f.fatura_no, fatura_tarihi: f.fatura_tarihi, vade_tarihi: f.vade_tarihi, giris_tarihi: f.giris_tarihi,
        tur: f.tur, pb: f.pb, matrah: r2(f.matrah), kdv: r2(f.kdv), toplam, odenen, kalem: f.kalem, arac: !!f.arac, belge: !!f.belge_path,
        tedarikci: f.tedarikci, rf_montaj_firma: f.rf_montaj_firma, kimlik: k.durum, kimlik_kaynak: f.tedarikci_id ? "SECIM" : "AD", note: f.note,
        log_odenen: logDag.get(Number(f.id)) || 0, ortak_odenen: ortakF.get(Number(f.id)) || 0, iade_bagli: iadeBagli.get(Number(f.id)) || 0 };
      if (f.tur === "GELEN") {
        fx.acik = r2(Math.max(0, toplam - odenen - fx.iade_bagli));
        fx.dogrudan = r2(odenen - fx.log_odenen - fx.ortak_odenen);
        const fazla = r2(Math.max(0, odenen + fx.iade_bagli - toplam));
        P.fatura += toplam; P.iade_bagli += fx.iade_bagli; P.uygulanan += odenen; P.kalan += fx.acik; P.fazla_odeme += fazla; P.matrah += fx.matrah;
        if (fx.acik > 0.009) P.acik_fatura += 1;
        if (fx.dogrudan > 0.009) { P.nakit += fx.dogrudan; c0.uyarilar.push({ tip: "FATURA_GIRISI_ODEME", fatura_id: fx.id, mesaj: `${fx.fatura_no}: fatura girişinde elle yazılmış ödenen tutar ${tl(fx.dogrudan)} ${f.pb} (ödeme kaydı yok) — uygulanmış ödeme sayıldı` }); }
        if (fx.dogrudan < -0.009) c0.uyarilar.push({ tip: "ODEME_FAZLA_KAYIT", fatura_id: fx.id, mesaj: `${fx.fatura_no}: ödeme kayıtlarının dağılımı (${tl(fx.log_odenen + fx.ortak_odenen)}) faturadaki ödenen tutarı (${tl(odenen)}) aşıyor — kontrol edin` });
        if (fazla > 0.009) c0.uyarilar.push({ tip: "FAZLA_ODEME", fatura_id: fx.id, mesaj: `${fx.fatura_no}: fatura tutarından ${tl(fazla)} ${f.pb} fazla ödenmiş — alacak olarak gösterildi` });
        if (Math.abs(r2(f.kalan_kayitli) - fx.acik) > 0.009 && !fx.arac) c0.uyarilar.push({ tip: "KALAN_TUTARSIZ", fatura_id: fx.id, mesaj: `${fx.fatura_no}: kayıtlı kalan borç ${tl(f.kalan_kayitli)}, hesaplanan ${tl(fx.acik)} — hesaplanan esas alındı` });
        if (fx.arac && fx.acik > 0.009) c0.uyarilar.push({ tip: "ARAC_KIRA", fatura_id: fx.id, mesaj: `${fx.fatura_no}: araç kirası faturası — FIFO dışında, faturanın 💳 Ödeme ekranından ödenir` });
      } else {
        fx.acik = 0;
        P.iade += toplam;
        if (!f._bagli) { P.iade_alacak += toplam; fx.alacak = true; }
      }
      if (k.durum === "BELIRSIZ") c0.uyarilar.push({ tip: "KIMLIK_BELIRSIZ", fatura_id: fx.id, mesaj: `${fx.fatura_no}: "${k.ad}" birden çok firma kartına uyuyor — faturanın tedarikçisini seçin` });
      c0.faturalar.push(fx);
    }
    // Ödeme logları
    for (const l of loglar) {
      const dagKim = [...new Set(l._dag.map((d) => fKimlik.get(d.fatura_id)?.anahtar).filter(Boolean))];
      let k = kimlikAd(l.tedarikci_id, [l.firma]);
      if (k.durum !== "KART" && dagKim.length === 1 && dagKim[0].startsWith("id:")) k = { anahtar: dagKim[0], id: Number(dagKim[0].slice(3)), durum: "KART" };
      const c0 = satir(k); const P = pbOf(c0, l.pb);
      const tur = l.islem_turu || (l._dag.length ? "ODEME" : "AVANS");
      const avans = r2(l.avans_tutar);
      if (l.durum === "AKTIF") {
        if (tur === "MAHSUP") P.mahsup += r2(l.tutar);
        else { P.nakit += r2(l.tutar); P.avans_olusan += avans; }
      }
      c0.hareketler.push({ kaynak: "LOG", id: Number(l.id), no: `Ö-${l.id}`, tarih: l.tarih, tur: tur === "MAHSUP" ? "MAHSUP" : (avans >= r2(l.tutar) - 0.009 ? "AVANS" : "FATURA_ODEME"),
        islem_turu: tur, tutar: r2(l.tutar), pb: l.pb, tl_tutar: l.tl_tutar != null ? r2(l.tl_tutar) : null, avans_tutar: avans,
        dagilim: l._dag.map((d) => ({ ...d, fatura_no: d.fatura_no || fById.get(d.fatura_id)?.fatura_no || `#${d.fatura_id}` })),
        aciklama: l.aciklama, yapan: l.created_by || null, dekont_url: l.dekont_url || null, durum: l.durum, yontem: l.yontem || null,
        referans: l.referans || null, kasadan_dus: l.kasadan_dus, giris: l.giris, iptal_neden: l.iptal_neden, iptal_eden: l.iptal_eden, iptal_tarihi: l.iptal_tarihi,
        yeni_kayit: !!l.idem_key, kimlik: k.durum });
      if (k.durum === "BELIRSIZ") c0.uyarilar.push({ tip: "KIMLIK_BELIRSIZ", log_id: Number(l.id), mesaj: `Ödeme Ö-${l.id}: "${l.firma}" birden çok firma kartına uyuyor — tedarikçiyi seçin` });
    }
    for (const m of eskiMarka) {
      const k = kimlikAd(m.tedarikci_id, [m.taseron_adi]);
      const c0 = satir(k); const P = pbOf(c0, "TRY");
      if (m.durum === "AKTIF") { P.nakit += r2(m.tutar); P.avans_olusan += r2(m.tutar); }
      c0.hareketler.push({ kaynak: "MARKA", id: Number(m.id), no: `M-${m.id}`, tarih: m.tarih, tur: m.tip === "FATURA_ODEME" ? "FATURA_ODEME" : "AVANS",
        islem_turu: "ESKI", tutar: r2(m.tutar), pb: "TRY", avans_tutar: r2(m.tutar), dagilim: [], aciklama: m.aciklama, yapan: null, dekont_url: null,
        durum: m.durum, giris: m.giris, iptal_neden: m.iptal_neden, iptal_eden: m.iptal_eden, yeni_kayit: false, kimlik: k.durum });
      if (m.durum === "AKTIF" && m.tip === "FATURA_ODEME") c0.uyarilar.push({ tip: "ESKI_BAGSIZ_ODEME", marka_id: Number(m.id), mesaj: `Eski ödeme M-${m.id} (${tl(m.tutar)} TL, ${m.tarih}) faturaya bağlanmamış — açık avans/alacak olarak gösterildi; "Avansı Faturalara Mahsup Et" ile kapatılabilir` });
    }
    // "Fatura girişinden" ödemeler geçmişte salt okunur satır olarak görünür
    for (const c0 of cari.values()) {
      for (const f of c0.faturalar) if (f.dogrudan > 0.009) c0.hareketler.push({ kaynak: "FATURA", id: f.id, no: `F-${f.id}`, tarih: f.fatura_tarihi, tur: "FATURA_GIRISI",
        islem_turu: "FATURA_GIRISI", tutar: f.dogrudan, pb: f.pb, avans_tutar: 0, dagilim: [{ fatura_id: f.id, fatura_no: f.fatura_no, odeme: f.dogrudan }],
        aciklama: "Fatura girişinde ödenen tutar (ayrı ödeme kaydı yok)", durum: "AKTIF", yeni_kayit: false });
      for (const o of ortak) { const f = c0.faturalar.find((x) => x.id === Number(o.fatura_id)); if (f) c0.hareketler.push({ kaynak: "ORTAK", id: Number(o.odeme_id), no: `O-${o.odeme_id}`,
        tarih: o.tarih, tur: "FATURA_ODEME", islem_turu: "ORTAK", tutar: r2(o.tutar), pb: f.pb, avans_tutar: 0, dagilim: [{ fatura_id: f.id, fatura_no: f.fatura_no, odeme: r2(o.tutar) }],
        aciklama: "Ortak ödeme kaydı (araç kirası ekranı)", durum: "AKTIF", yeni_kayit: false }); }
      // Hakediş esaslı cari: onaylı hakediş borçtur; açık avans tarih sırasıyla (eskiden yeniye) hakedişe mahsup edilir.
      // Mahsup HESAPLANIR (ayrı kayıt/nakit çıkışı yok); her bakiye hareketlerden yeniden üretilebilir.
      if (c0.id) for (const h of hk.filter((x) => Number(x.tedarikci_id) === c0.id)) c0.hakedisler.push({ ...h, toplam: r2(h.toplam) });
      // 03.11.2026 (Orhan): hakediş esaslı caride borç = YAPILAN İŞİN BEDELİ — fiziki tamamlanan miktar × iş tarihindeki taşeron
      // fiyatı (paket / kalem); elle hakediş onayı beklenmez. Hakediş belgeleri dönem dökümü olarak kalır, borca ayrıca eklenmez
      // (çift sayılmaz). Fiyatı tanımsız kalem borca girmez ve uyarı olarak gösterilir.
      if (c0.id && c0.cari_modeli === "HAKEDIS" && M !== "SIMSEK") {
        const s = R.byId.get(c0.id);
        const isler = s ? await hakedisIsleri(db, M, s, bugunTR()) : [];
        const fiz = isler.filter((x) => x.fiziki_qty > 0);
        c0.is_bedeli = fiz.filter((x) => x.fiyat).map((x) => ({ master_works_id: x.master_works_id, site_code: x.site_code, item_code: x.item_code,
          aciklama: x.aciklama, tarih: x.is_tarihi, tarih_kaynak: x.is_tarihi_kaynak, miktar: x.fiziki_qty, pb: x.fiyat.pb || "TRY",
          paket: x.fiyat.paket ? x.fiyat.paket.ad : null, tutar: kalemDeger(x, x.fiziki_qty) }));
        for (const b of c0.is_bedeli) { const P = pbOf(c0, b.pb); P.hakedis = r2((P.hakedis || 0) + b.tutar); }
        const fiyatsiz = fiz.filter((x) => !["VAR", "PAKET"].includes(x.fiyat_durum));
        if (fiyatsiz.length) c0.uyarilar.push({ tip: "FIYAT_TANIMSIZ", mesaj: `${fiyatsiz.length} gerçekleşen kalemde taşeron fiyatı tanımsız — borca eklenmedi (${[...new Set(fiyatsiz.map((x) => x.site_code))].slice(0, 5).join(", ")}${fiyatsiz.length > 5 ? "…" : ""})` });
        pbOf(c0, "TRY"); // işi / avansı olmasa da özet satırı görünür
      }
      for (const [pb, P] of Object.entries(c0.pb)) {
        for (const k of Object.keys(P)) P[k] = r2(P[k]);
        P.nakit = r2(P.nakit + c0.hareketler.filter((h) => h.kaynak === "ORTAK" && h.pb === pb).reduce((s, h) => s + h.tutar, 0));
        P.gecerli = r2(P.fatura - P.iade); // geçerli toplam fatura: GELEN − iade (KDV dahil ödenecek)
        P.avans_acik = r2(P.avans_olusan - P.mahsup);
        if (P.hakedis > 0.009) {
          P.hakedis_mahsup = r2(Math.min(Math.max(0, P.avans_acik), P.hakedis));
          P.hakedis_kalan = r2(P.hakedis - P.hakedis_mahsup);
          P.avans_acik = r2(P.avans_acik - P.hakedis_mahsup);
          P.kalan = r2(P.kalan + P.hakedis_kalan);
          // İş bazında karşılanma (FIFO, iş tarihine göre) — ekranda "ne kadarı ödendi" sütunu
          let kalanMahsup = P.hakedis_mahsup;
          for (const h of (c0.is_bedeli || []).filter((x) => x.pb === pb).sort((a, b) => String(a.tarih).localeCompare(String(b.tarih)) || a.master_works_id - b.master_works_id)) {
            h.karsilanan = r2(Math.min(kalanMahsup, h.tutar)); h.kalan = r2(h.tutar - h.karsilanan); kalanMahsup = r2(kalanMahsup - h.karsilanan);
          }
        } else { P.hakedis = P.hakedis || 0; P.hakedis_mahsup = 0; P.hakedis_kalan = 0; }
        P.alacak = r2(P.avans_acik + P.iade_alacak + P.fazla_odeme);
        P.net = r2(P.kalan - P.alacak);
        if (P.avans_acik < -0.009) c0.uyarilar.push({ tip: "AVANS_EKSI", mesaj: `${pb}: mahsup edilen tutar açık avansı ${tl(-P.avans_acik)} aşıyor — kayıtları kontrol edin` });
      }
      c0.faturalar.sort((a, b) => fifoAnahtar(a).localeCompare(fifoAnahtar(b)));
      c0.hareketler.sort((a, b) => String(b.tarih || "").localeCompare(String(a.tarih || "")) || b.id - a.id);
      c0.toplam_acik = Object.values(c0.pb).reduce((s, P) => s + (P.kalan > 0 ? 1 : 0), 0);
    }
    // 01.11.2026: tedarikçi bulma — hareketi olan cari satırı; yoksa bu firmanın kapsamındaki AKTİF firma kartı boş cari olarak
    // açılır (yeni tanımlanan taşerona ilk avans / ilk fatura buradan girilir). Kapsam dışı ya da pasif kart "bulunamadı".
    const bul = (anahtar) => {
      const k = String(anahtar || "");
      if (cari.has(k)) return cari.get(k);
      const m = /^id:(\d+)$/.exec(k); const s = m ? R.byId.get(Number(m[1])) : null;
      if (!s || s.aktif === false || !kartKapsamda(s, M)) return null;
      const c0 = satir({ anahtar: `id:${Number(s.id)}`, id: Number(s.id), durum: "KART" }); c0.toplam_acik = 0; return c0;
    };
    return { cari, R, fById, M, bul };
  }

  // FIFO dağıtımı (saf hesap): aynı firma + aynı tedarikçi + aynı para birimi, uygun (GELEN, araç kirası dışı, açık) faturalar
  function acikFaturalar(c0, pb, secili) {
    let l = (c0?.faturalar || []).filter((f) => f.tur === "GELEN" && !f.arac && f.pb === pb && f.acik > 0.009 && f.kimlik !== "BELIRSIZ");
    if (Array.isArray(secili) && secili.length) { const s = new Set(secili.map(Number)); l = l.filter((f) => s.has(f.id)); }
    return l.sort((a, b) => fifoAnahtar(a).localeCompare(fifoAnahtar(b)));
  }
  function fifoDagit(faturalar, tutar) {
    let kalan = r2(tutar); const dagilim = [];
    for (const f of faturalar) {
      if (kalan <= 0.009) break;
      const od = r2(Math.min(kalan, f.acik));
      dagilim.push({ fatura_id: f.id, fatura_no: f.fatura_no, fatura_tarihi: f.fatura_tarihi, vade_tarihi: f.vade_tarihi, kalan_once: f.acik, odeme: od, kalan_sonra: r2(f.acik - od) });
      kalan = r2(kalan - od);
    }
    return { dagilim, kalan: Math.max(0, kalan) };
  }
  // Ödeme isteğinin doğrulanması + dağıtım önizlemesi (kayıt ve önizleme aynı yolu kullanır)
  function odemePlani(veri, b) {
    const c0 = veri.bul(b.tedarikci);
    if (!c0) throw hataK(404, "Tedarikçi bu firmanın kayıtlarında bulunamadı");
    if (c0.kimlik !== "KART" || !c0.id) throw hataK(409, "Bu ad bir firma kartına bağlı değil ya da birden çok karta uyuyor — önce firma kartını seçin / oluşturun", { kimlik: c0.kimlik });
    const islem = String(b.islem || "").toUpperCase();
    if (!["FATURA_ODEME", "AVANS"].includes(islem)) throw hataK(400, "İşlem türü: Fatura Ödemesi ya da Avans");
    const pb = String(b.para_birimi || "TRY").toUpperCase();
    if (!PARA.includes(pb)) throw hataK(400, "Geçersiz para birimi");
    if (veri.M === "SIMSEK" && pb !== "TRY") throw hataK(400, "Şimşek ödemeleri bu ekrandan yalnız TL girilir");
    const tutar = r2(b.tutar);
    if (!(tutar > 0)) throw hataK(400, "Tutar sıfırdan büyük olmalı");
    if (!/^\d+(\.\d{1,2})?$/.test(String(b.tutar).trim())) throw hataK(400, "Tutar en fazla iki ondalık hane içerebilir");
    const acik = acikFaturalar(c0, pb, islem === "FATURA_ODEME" ? b.secili_fatura_ids : null);
    if (Array.isArray(b.secili_fatura_ids) && b.secili_fatura_ids.length && acik.length !== new Set(b.secili_fatura_ids.map(Number)).size)
      throw hataK(409, "Seçilen faturalardan biri bu tedarikçinin açık faturası değil (ödenmiş, iade, araç kirası ya da başka para birimi)");
    const acikToplam = r2(acik.reduce((s, f) => s + f.acik, 0));
    // 01.11.2026: açık faturası olmayan tedarikçiye "Fatura Ödemesi" girilmez — faturasız ödeme AVANS'tır (açıklama metni
    // işlem türünü değiştirmez; ekran bu yanıtla türü Avans'a çevirir). Avans fatura gelince mahsup edilir.
    if (islem === "FATURA_ODEME" && acikToplam <= 0.009)
      throw hataK(409, `Bu tedarikçinin ${pb} cinsinden açık faturası yok. Faturası henüz gelmemiş ödeme için işlem türünü "Avans" seçin; fatura gelince avans mahsup edilir.`, { avans_secin: true });
    const plan = islem === "AVANS" ? { dagilim: [], kalan: tutar } : fifoDagit(acik, tutar);
    const P = c0.pb[pb] || {};
    const baskaPb = Object.entries(c0.pb).filter(([k, v]) => k !== pb && (v.kalan > 0.009 || v.avans_acik > 0.009)).map(([k]) => k);
    const uyarilar = [];
    if (islem === "FATURA_ODEME" && plan.kalan > 0.009) uyarilar.push(acikToplam > 0
      ? `Ödeme açık fatura borcunu ${tl(plan.kalan)} ${pb} aşıyor. Aşan kısım AÇIK AVANS olarak kaydedilir (faturası olmayan tutar ödenmiş fatura sayılmaz); ileride gelen faturaya "Mahsup Et" ile uygulanır.`
      : `Bu tedarikçinin ${pb} cinsinden açık faturası yok. Tutarın tamamı AÇIK AVANS olur.`);
    if (islem === "AVANS" && acikToplam > 0.009) uyarilar.push(`Bu tedarikçinin ${tl(acikToplam)} ${pb} açık faturası var; avans faturaları KAPATMAZ. Faturaya ödüyorsanız "Fatura Ödemesi" seçin.`);
    if (baskaPb.length) uyarilar.push(`${baskaPb.join(", ")} cinsinden bakiyeler bu ödemeyle mahsup edilmez (farklı para birimleri kursuz birbirine karışmaz).`);
    return { c0, islem, pb, tutar, acik, acikToplam, plan, P, uyarilar,
      sonrasi: { kalan: r2((P.kalan || 0) - (tutar - plan.kalan)), avans_acik: r2((P.avans_acik || 0) + plan.kalan) } };
  }
  const planOzeti = (p) => ({ islem: p.islem, pb: p.pb, tutar: p.tutar, acik_borc: p.acikToplam, dagilim: p.plan.dagilim, avans: p.plan.kalan,
    fazla: p.islem === "FATURA_ODEME" ? p.plan.kalan : 0, uyarilar: p.uyarilar, sonrasi: p.sonrasi, kural: FIFO_KURAL,
    oncesi: { kalan: p.P.kalan || 0, avans_acik: p.P.avans_acik || 0, net: p.P.net || 0 } });
  const ayniPlan = (a, b) => a && Array.isArray(a.dagilim) && a.dagilim.length === b.dagilim.length && Math.abs(Number(a.avans || 0) - b.avans) < 0.01
    && a.dagilim.every((x, i) => Number(x.fatura_id) === b.dagilim[i].fatura_id && Math.abs(Number(x.odeme) - b.dagilim[i].odeme) < 0.01);

  // Fatura ödenen / kalan güncellemesi (kalan = toplam − ödenen − bağlı iade; negatif olmaz)
  async function faturaUygula(db, fid, delta, tarih) {
    await db.query(`UPDATE invoice_entries i SET odenen_tutar = GREATEST(0, COALESCE(i.odenen_tutar,0) + $2),
        kalan_borc = GREATEST(0, COALESCE(i.toplam_tutar,0) - GREATEST(0, COALESCE(i.odenen_tutar,0) + $2)
          - COALESCE((SELECT SUM(x.toplam_tutar) FROM invoice_entries x WHERE x.bagli_fatura_id = i.id AND UPPER(COALESCE(x.fatura_turu,'GELEN')) <> 'GELEN'),0)),
        odeme_tarihi = CASE WHEN $3::date IS NULL THEN i.odeme_tarihi ELSE $3::date END
      WHERE i.id = $1`, [fid, delta, tarih || null]);
  }
  async function islem(res, fn) {
    const cl = await pool.connect();
    try { await cl.query("BEGIN"); const s = await fn(cl); await cl.query("COMMIT"); return s; }
    catch (e) { await cl.query("ROLLBACK").catch(() => {}); if (!res.headersSent) hata(res, e.kod || 500, e.kod ? e.message : "İşlem tamamlanamadı: " + e.message, e.ek); return undefined; }
    finally { cl.release(); }
  }
  const kilitle = (db, ...p) => db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [p.join("|")]);

  // ── UÇLAR ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const kapi = (fnYetki, mesaj) => (req, res, next) => authMiddleware(req, res, () => {
    const M = firmaKodu(req);
    if (!M) return hata(res, 400, "Firma seçilmedi");
    if (!fnYetki(req, M)) return hata(res, 403, mesaj);
    req.cariFirma = M; next();
  });
  const okuKapi = kapi(gorur, "Bu firmanın cari hesaplarını görme yetkiniz yok");
  const yazKapi = kapi(yazar, "Ödeme kaydı yetkiniz yok — mali yetki matrisinde bu firma için onaylı kullanıcı olmalısınız");
  const kartKapi = kapi(kartAcar, "Firma kartı tanımlama yetkiniz yok");
  // Arama: cari görüntüleyen ya da (Şimşek) fatura girişi yapan finans kullanıcısı; fiyat görme yetkisi yoksa bakiye gönderilmez
  const aramaKapi = kapi((req, M) => gorur(req, M) || (M === "SIMSEK" && finansYazmaYetkili(req.user)), "Tedarikçi arama yetkiniz yok");

  // Arama: kullanıcı yazdıkça (Türkçe harf / büyük-küçük duyarsız) — görünen ad, resmi unvan, iş etiketi ve doğrulanmış diğer
  // adlarla. Alt marka hesabı: firmaya bağlı kartlar (ana_firma), firma önekli iş etiketleri ve firmanın kendi kayıtlarında
  // geçen tedarikçiler. Sonuçta yalnız BU firmanın bakiyesi döner; başka firmanın cari hareketi / borcu gönderilmez.
  app.get("/finance/marka-cari/tedarikci-ara", aramaKapi, async (req, res) => {
    try {
      const M = req.cariFirma;
      const bakiyeGorur = gorur(req, M);
      const q = katla(req.query.q);
      const v = await cariHesapla(pool, M);
      const onek = M === "SIMSEK" ? null : katla(markaProfil(M).onek);
      const sonuc = new Map();
      for (const c0 of v.cari.values()) sonuc.set(c0.anahtar, c0);
      for (const s of v.R.byId.values()) if (!sonuc.has(`id:${s.id}`) && kartKapsamda(s, M) && s.aktif !== false)
        sonuc.set(`id:${s.id}`, { anahtar: `id:${s.id}`, id: Number(s.id), kimlik: "KART", ad: kartAd(s), unvan: s.unvan || null, etiketler: s.adlar,
          etiket_katla: s.katlar, tur: s.tedarikci_turu || "TASERON", aktif: true, pb: {}, faturalar: [], hareketler: [], uyarilar: [] });
      const puan = (c0) => {
        if (!q) return 1;
        const k = c0.etiket_katla || [];
        if (k.some((x) => x === q)) return 4;
        if (k.some((x) => x.startsWith(q))) return 3;
        if ((c0.etiketler || []).some((a) => String(a).toLocaleUpperCase("tr-TR").split(/[\s_\-.]+/).some((w) => katla(w).startsWith(q)))) return 2;
        if (q.length >= 2 && k.some((x) => x.includes(q))) return 1;
        return 0;
      };
      const rows = [...sonuc.values()].map((c0) => ({ c0, p: puan(c0) })).filter((x) => x.p > 0)
        .sort((a, b) => b.p - a.p || (b.c0.faturalar.length + b.c0.hareketler.length) - (a.c0.faturalar.length + a.c0.hareketler.length) || a.c0.ad.localeCompare(b.c0.ad, "tr"))
        .slice(0, 25).map(({ c0 }) => ({ anahtar: c0.anahtar, id: c0.id, ad: c0.ad, unvan: c0.unvan, etiketler: c0.etiketler, kimlik: c0.kimlik, tur: c0.tur,
          adaylar: c0.adaylar || [], bakiye: bakiyeGorur ? Object.fromEntries(Object.entries(c0.pb).map(([pb, P]) => [pb, { kalan: P.kalan, alacak: P.alacak, net: P.net }])) : {},
          fatura_sayisi: c0.faturalar.length, onek_etiket: onek ? (c0.etiket_katla || []).some((x) => x.startsWith(onek)) : false }));
      res.json({ ok: true, firma: M, rows });
    } catch (e) { console.error("[cari ara]", e.message); hata(res, 500, "Arama yapılamadı"); }
  });

  // Yeni firma kartı (listede yoksa). Türkçe harf / boşluk / noktalama duyarsız aynı ad (iş etiketi, görünen ad, unvan, takma ad)
  // zaten varsa yeni kart açılmaz: mevcut kart önerilir (yalnız adı). Benzerlik birleştirme sebebi değildir.
  app.post("/finance/marka-cari/tedarikci", kartKapi, async (req, res) => {
    try {
      const M = req.cariFirma;
      const ad = temiz(req.body?.ad, 120), unvan = temiz(req.body?.unvan, 300);
      const tur = String(req.body?.tur || "TEDARIKCI").toUpperCase() === "TASERON" ? "TASERON" : "TEDARIKCI";
      if (ad.length < 2) return hata(res, 400, "Firma adı gerekli");
      const R = await rehberOku(pool);
      // 01.11.2026: aynı ad yalnız BU firmanın kapsamındaki kartla çakışırsa engellenir. Başka firmanın kartı (ör. Şimşek'in eski
      // "İZTAŞ" iş etiketi) Teknocenter'ın kendi İztaş carisini açmasına engel değildir; ad çözümü de firma kapsamına göre yapılır.
      const ayniHepsi = [...new Set([...R.coz(ad), ...(unvan ? R.coz(unvan) : [])])];
      const ayni = ayniHepsi.filter((id) => kartKapsamda(R.byId.get(id), M));
      if (ayni.length) return hata(res, 409, `"${ad}" adıyla kayıtlı firma kartı var — mevcut kartı seçin`, { mevcut: ayni.map((id) => ({ anahtar: `id:${id}`, id, ad: kartAd(R.byId.get(id)) })) });
      const ana = M === "SIMSEK" ? "ERC" : M;
      // İş etiketi (subcon_name) tekildir: başka firmada aynı etiket varsa alt markanın etiketi firma önekiyle yazılır (TEKNO_İZTAŞ)
      let etiket = ad.toLocaleUpperCase("tr-TR");
      const etiketVar = (await pool.query(`SELECT 1 FROM subcons WHERE subcon_name = $1 LIMIT 1`, [etiket])).rowCount > 0;
      if (etiketVar && M !== "SIMSEK") etiket = `${markaProfil(M).onek}_${etiket}`;
      const r = await pool.query(`INSERT INTO subcons (subcon_name, gorunen_ad, unvan, ana_firma, aktif, kaynak, olusturan, tedarikci_turu)
        VALUES ($1,$2,$3,$4,true,'CARI',$5,$6) RETURNING id, subcon_name, gorunen_ad, unvan, ana_firma`,
        [etiket, ad, unvan || null, ana, kim(req), tur === "TEDARIKCI" ? "TEDARIKCI" : null]);
      await islemGecmisiYaz(req, "firma", r.rows[0].id, "OLUSTURMA", null, { ad, unvan: unvan || null, ana_firma: ana, tur, _ekran: "Tedarikçi cari" }, null);
      res.json({ ok: true, tedarikci: { anahtar: `id:${r.rows[0].id}`, id: r.rows[0].id, ad, unvan: unvan || null, kimlik: "KART", tur } });
    } catch (e) {
      if (/duplicate key|subcons_subcon_name_key/.test(e.message)) return hata(res, 409, "Bu adla bir firma kartı zaten var");
      console.error("[cari kart]", e.message); hata(res, 500, "Firma kartı kaydedilemedi");
    }
  });

  // Firmanın tüm tedarikçi cari özetleri (ana panel tablosu) + kimlik sorunları
  app.get("/finance/marka-cari/liste", okuKapi, async (req, res) => {
    try {
      const v = await cariHesapla(pool, req.cariFirma);
      const rows = [...v.cari.values()].map((c0) => ({ anahtar: c0.anahtar, id: c0.id, ad: c0.ad, unvan: c0.unvan, kimlik: c0.kimlik, tur: c0.tur, cari_modeli: c0.cari_modeli,
        hakedis_sayisi: (c0.hakedisler || []).filter((h) => h.durum === "ONAYLI").length, is_sayisi: (c0.is_bedeli || []).length,
        etiketler: c0.etiketler, etiket_katla: c0.etiket_katla, adaylar: c0.adaylar, pb: c0.pb, fatura_sayisi: c0.faturalar.length,
        hareket_sayisi: c0.hareketler.length, uyari_sayisi: c0.uyarilar.length,
        // 03.11.2026: son ödemenin tutarı da (yalnız gösterim; cari hesabı değişmez)
        ...(() => { const h = c0.hareketler.find((x) => x.durum === "AKTIF" && x.islem_turu !== "MAHSUP");
          return { son_odeme: h?.tarih || null, son_odeme_tutar: h ? h.tutar : null, son_odeme_pb: h ? h.pb || "TRY" : null }; })() }))
        .sort((a, b) => (b.pb.TRY?.kalan || 0) - (a.pb.TRY?.kalan || 0) || a.ad.localeCompare(b.ad, "tr"));
      const toplam = {};
      for (const r of rows) for (const [pb, P] of Object.entries(r.pb)) {
        const T = toplam[pb] || (toplam[pb] = { fatura: 0, iade: 0, gecerli: 0, uygulanan: 0, kalan: 0, avans_acik: 0, alacak: 0, net: 0, nakit: 0, matrah: 0 });
        for (const k of Object.keys(T)) T[k] = r2(T[k] + (P[k] || 0));
      }
      const sorunlar = [...v.cari.values()].flatMap((c0) => c0.uyarilar.map((u) => ({ ...u, anahtar: c0.anahtar, ad: c0.ad })));
      // Fatura listesi sütunları (vade, kalan) için fatura bazında özet — ekranla aynı hesap
      const faturalar = {};
      for (const c0 of v.cari.values()) for (const f of c0.faturalar) faturalar[f.id] = { acik: f.acik, odenen: f.odenen, vade: f.vade_tarihi, pb: f.pb, tur: f.tur, anahtar: c0.anahtar };
      res.json({ ok: true, firma: req.cariFirma, rows, toplam, sorunlar, faturalar, kural: FIFO_KURAL, yazabilir: yazar(req, req.cariFirma), kart_acabilir: kartAcar(req, req.cariFirma) });
    } catch (e) { console.error("[cari liste]", e.message); hata(res, 500, "Cari liste alınamadı"); }
  });

  // Tek tedarikçinin cari özeti, açık faturaları ve ödeme / avans geçmişi
  app.get("/finance/marka-cari/ozet", okuKapi, async (req, res) => {
    try {
      const v = await cariHesapla(pool, req.cariFirma);
      // 01.11.2026: hareketi olmayan kart yalnız bu firmanın kapsamındaysa boş cari olarak döner (eski kapsamsız fallback kaldırıldı)
      const c0 = v.bul(req.query.tedarikci);
      if (!c0) return hata(res, 404, "Tedarikçi bu firmanın kayıtlarında bulunamadı");
      res.json({ ok: true, firma: req.cariFirma, cari: c0, kural: FIFO_KURAL, yazabilir: yazar(req, req.cariFirma) });
    } catch (e) { console.error("[cari ozet]", e.message); hata(res, 500, "Cari özet alınamadı"); }
  });

  // Dağıtım önizlemesi — kaydetmeden önce hangi faturaya ne kadar gideceği (kayıtla aynı hesap)
  app.post("/finance/marka-cari/onizleme", okuKapi, async (req, res) => {
    try {
      const v = await cariHesapla(pool, req.cariFirma);
      res.json({ ok: true, ...planOzeti(odemePlani(v, req.body || {})) });
    } catch (e) { if (e.kod) return hata(res, e.kod, e.message, e.ek); console.error("[cari onizleme]", e.message); hata(res, 500, "Önizleme hesaplanamadı"); }
  });

  // Ödeme / avans kaydı. Tek transaction: aynı idem_key ikinci kez kayıt üretmez; aynı firma + tedarikçi için ödemeler sıraya
  // girer (advisory lock) ve açık bakiye kilitli satırlardan yeniden hesaplanır — eşzamanlı iki ödeme borcu aşamaz.
  app.post("/finance/marka-cari/odeme", yazKapi, async (req, res) => {
    const M = req.cariFirma, b = req.body || {};
    const idem = temiz(b.idem_key, 120);
    if (idem.length < 8) return hata(res, 400, "İşlem anahtarı eksik (sayfayı yenileyin)");
    if (!tarihMi(b.tarih) || b.tarih > bugunTR()) return hata(res, 400, "Gerçek ödeme tarihi (dekonttaki tarih) zorunlu; ileri tarih girilemez");
    const yontem = String(b.yontem || "BANKA").toUpperCase();
    if (!YONTEM[yontem]) return hata(res, 400, "Geçersiz ödeme yöntemi");
    const sonuc = await islem(res, async (db) => {
      await kilitle(db, "cari-idem", idem);
      const ex = (await db.query(`SELECT id, dagilim, avans_tutar FROM taseron_odeme_log WHERE idem_key = $1`, [idem])).rows[0];
      if (ex) return { tekrar: true, log_id: ex.id };
      await kilitle(db, "cari", M, String(b.tedarikci || ""));
      const v = await cariHesapla(db, M, { kilit: true });
      const p = odemePlani(v, b);
      const oz = planOzeti(p);
      if (b.beklenen && !ayniPlan(b.beklenen, oz)) throw hataK(409, "Açık bakiye siz önizlemeye bakarken değişti — yeni dağıtımı kontrol edip tekrar kaydedin", { onizleme: oz, degisti: true });
      if (p.islem === "FATURA_ODEME" && p.plan.kalan > 0.009 && b.fazla_avans_onay !== true)
        throw hataK(409, `Ödeme açık fatura borcunu ${tl(p.plan.kalan)} ${p.pb} aşıyor. Aşan kısmın açık avans olarak kaydedilmesini onaylayın ya da tutarı düzeltin.`, { onizleme: oz, fazla: p.plan.kalan });
      let tlTutar = null;
      if (p.pb !== "TRY") {
        tlTutar = r2(b.tl_tutar);
        if (!(tlTutar > 0)) throw hataK(400, `${p.pb} ödemede nakit akışına yazılacak TL karşılığı (dekonttaki TL tutar) zorunlu`);
      }
      const kasadan = b.kasadan_dus === undefined || b.kasadan_dus === null ? true : !!b.kasadan_dus;
      for (const d of p.plan.dagilim) await faturaUygula(db, d.fatura_id, d.odeme, b.tarih);
      const dagJson = [...p.plan.dagilim.map((d) => ({ fatura_id: d.fatura_id, fatura_no: d.fatura_no, odeme: d.odeme, kalan_sonra: d.kalan_sonra })),
        ...(p.plan.kalan > 0.009 ? [{ fatura_no: "AVANS (fatura bekleniyor)", odeme: p.plan.kalan, avans: true }] : [])];
      const adi = p.c0.ad;
      const log = (await db.query(`INSERT INTO taseron_odeme_log (firma, tutar, tarih, aciklama, dagilim, avans_tutar, tedarikci_id, firma_kod, idem_key,
          durum, islem_turu, yontem, referans, kasadan_dus, para_birimi, tl_tutar, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'AKTIF',$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [adi, p.tutar, b.tarih, temiz(b.aciklama, 500) || null, JSON.stringify(dagJson), p.plan.kalan, p.c0.id, M, idem,
          p.islem === "AVANS" ? "AVANS" : "ODEME", yontem, temiz(b.referans, 120) || null, kasadan, p.pb, tlTutar, kim(req)])).rows[0];
      if (M !== "SIMSEK") {
        // Nakit akışı satırı (TL): mahsup edilen kısım FATURA_ODEME, kalan AVANS — ERC "Ödeme Gir" ile aynı yazım
        const mahsup = r2(p.tutar - p.plan.kalan);
        const oran = p.pb === "TRY" ? 1 : tlTutar / p.tutar;
        const mTl = r2(mahsup * oran), aTl = r2((p.pb === "TRY" ? p.plan.kalan : tlTutar - mTl));
        const ack = temiz(b.aciklama, 500) || `Ödeme Ö-${log.id}`;
        if (mahsup > 0.009) await db.query(`INSERT INTO marka_taseron_odeme (marka, taseron_adi, tip, tutar, tarih, aciklama, odeme_log_id, tedarikci_id, kasadan_dus, durum)
          VALUES ($1,$2,'FATURA_ODEME',$3,$4,$5,$6,$7,$8,'AKTIF')`, [M, adi, mTl, b.tarih, ack, log.id, p.c0.id, kasadan]);
        if (p.plan.kalan > 0.009) await db.query(`INSERT INTO marka_taseron_odeme (marka, taseron_adi, tip, tutar, tarih, aciklama, odeme_log_id, tedarikci_id, kasadan_dus, durum)
          VALUES ($1,$2,'AVANS',$3,$4,$5,$6,$7,$8,'AKTIF')`, [M, adi, aTl, b.tarih, ack, log.id, p.c0.id, kasadan]);
      }
      await islemGecmisiYaz(req, "tedarikci_odeme", log.id, "ODEME_OLUSTU", null,
        { firma: M, tedarikci_id: p.c0.id, tedarikci: adi, islem: p.islem, tutar: p.tutar, para_birimi: p.pb, tl_tutar: tlTutar, tarih: b.tarih, yontem,
          kasadan_dus: kasadan, avans: p.plan.kalan, dagilim: p.plan.dagilim.map((d) => `${d.fatura_no}: ${tl(d.odeme)}`).join(", ") }, temiz(b.aciklama, 500) || null);
      return { tekrar: false, log_id: log.id, ...oz };
    });
    if (sonuc) res.json({ ok: true, ...sonuc });
  });

  // Açık avansı faturalara mahsup et — yeni NAKİT ÇIKIŞI oluşmaz (avans ödendiği gün zaten nakit akışına düştü)
  app.post("/finance/marka-cari/mahsup", yazKapi, async (req, res) => {
    const M = req.cariFirma, b = req.body || {};
    const idem = temiz(b.idem_key, 120);
    if (idem.length < 8) return hata(res, 400, "İşlem anahtarı eksik (sayfayı yenileyin)");
    const tarih = tarihMi(b.tarih) ? b.tarih : bugunTR();
    const sonuc = await islem(res, async (db) => {
      await kilitle(db, "cari-idem", idem);
      const ex = (await db.query(`SELECT id FROM taseron_odeme_log WHERE idem_key = $1`, [idem])).rows[0];
      if (ex) return { tekrar: true, log_id: ex.id };
      await kilitle(db, "cari", M, String(b.tedarikci || ""));
      const v = await cariHesapla(db, M, { kilit: true });
      const c0 = v.bul(b.tedarikci);
      if (!c0 || c0.kimlik !== "KART") throw hataK(409, "Tedarikçi firma kartı seçilmeli");
      const pb = String(b.para_birimi || "TRY").toUpperCase();
      const P = c0.pb[pb];
      const avans = r2(P?.avans_acik || 0);
      if (!(avans > 0.009)) throw hataK(409, `${pb} cinsinden açık avans yok`);
      const acik = acikFaturalar(c0, pb, b.secili_fatura_ids);
      const acikTop = r2(acik.reduce((s, f) => s + f.acik, 0));
      if (!(acikTop > 0.009)) throw hataK(409, `${pb} cinsinden açık fatura yok`);
      const istenen = b.tutar != null && b.tutar !== "" ? r2(b.tutar) : Math.min(avans, acikTop);
      if (!(istenen > 0) || istenen - Math.min(avans, acikTop) > 0.009) throw hataK(400, `Mahsup tutarı en fazla ${tl(Math.min(avans, acikTop))} ${pb} olabilir`);
      const plan = fifoDagit(acik, istenen);
      if (b.beklenen && !ayniPlan(b.beklenen, { dagilim: plan.dagilim, avans: 0 })) throw hataK(409, "Bakiye değişti — mahsup önizlemesini yenileyin", { degisti: true });
      if (b.onizle === true) return { onizleme: true, dagilim: plan.dagilim, tutar: istenen, avans_acik: avans, acik_borc: acikTop, kural: FIFO_KURAL };
      for (const d of plan.dagilim) await faturaUygula(db, d.fatura_id, d.odeme, null);
      const log = (await db.query(`INSERT INTO taseron_odeme_log (firma, tutar, tarih, aciklama, dagilim, avans_tutar, tedarikci_id, firma_kod, idem_key,
          durum, islem_turu, para_birimi, created_by) VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,'AKTIF','MAHSUP',$9,$10) RETURNING id`,
        [c0.ad, istenen, tarih, temiz(b.aciklama, 500) || "Avans mahsubu (nakit çıkışı yok)", JSON.stringify(plan.dagilim.map((d) => ({ fatura_id: d.fatura_id, fatura_no: d.fatura_no, odeme: d.odeme, kalan_sonra: d.kalan_sonra }))),
          c0.id, M, idem, pb, kim(req)])).rows[0];
      await islemGecmisiYaz(req, "tedarikci_odeme", log.id, "MAHSUP", null, { firma: M, tedarikci_id: c0.id, tedarikci: c0.ad, tutar: istenen, para_birimi: pb,
        dagilim: plan.dagilim.map((d) => `${d.fatura_no}: ${tl(d.odeme)}`).join(", ") }, null);
      return { tekrar: false, log_id: log.id, dagilim: plan.dagilim, tutar: istenen };
    });
    if (sonuc) res.json({ ok: true, ...sonuc });
  });

  // İptal (ters işlem): kayıt silinmez, İPTAL olarak işaretlenir; faturalara uygulanan tutar geri açılır, nakit akışı satırı
  // İPTAL olur. Avans kısmı faturaya mahsup edilmişse önce o mahsup iptal edilmelidir (avans eksiye düşmez).
  async function iptalEt(req, res, kaynak) {
    const M = req.cariFirma, id = Number(req.params.id), neden = temiz(req.body?.neden, 500);
    if (!neden) return hata(res, 400, "İptal nedeni zorunlu");
    const sonuc = await islem(res, async (db) => {
      const v0 = await cariHesapla(db, M);
      let c0 = null, h = null;
      for (const x of v0.cari.values()) { const y = x.hareketler.find((z) => z.kaynak === kaynak && z.id === id); if (y) { c0 = x; h = y; break; } }
      if (!h) throw hataK(404, "Ödeme kaydı bu firmada bulunamadı");
      if (h.durum !== "AKTIF") return { zaten: true };
      await kilitle(db, "cari", M, c0.anahtar);
      const v = await cariHesapla(db, M, { kilit: true });
      const c1 = v.cari.get(c0.anahtar); const P = c1.pb[h.pb] || {};
      if (h.islem_turu !== "MAHSUP" && h.avans_tutar > 0.009 && r2((P.avans_acik || 0) - h.avans_tutar) < -0.009)
        throw hataK(409, `Bu ödemenin ${tl(h.avans_tutar)} ${h.pb} avans kısmı faturalara mahsup edilmiş. Önce ilgili mahsup işlemini iptal edin.`);
      if (kaynak === "LOG") {
        const l = (await db.query(`SELECT * FROM taseron_odeme_log WHERE id = $1 FOR UPDATE`, [id])).rows[0];
        if (!l || String(l.durum || "AKTIF") !== "AKTIF") return { zaten: true };
        for (const d of h.dagilim) if (v.fById.has(d.fatura_id)) await faturaUygula(db, d.fatura_id, -d.odeme, null);
        await db.query(`UPDATE taseron_odeme_log SET durum='IPTAL', iptal_neden=$2, iptal_tarihi=NOW(), iptal_eden=$3 WHERE id=$1`, [id, neden, kim(req)]);
        await db.query(`UPDATE marka_taseron_odeme SET durum='IPTAL', iptal_neden=$2, iptal_tarihi=NOW(), iptal_eden=$3 WHERE odeme_log_id=$1`, [id, neden, kim(req)]);
      } else {
        await db.query(`UPDATE marka_taseron_odeme SET durum='IPTAL', iptal_neden=$2, iptal_tarihi=NOW(), iptal_eden=$3 WHERE id=$1 AND UPPER(marka)=$4`, [id, neden, kim(req), M]);
      }
      await islemGecmisiYaz(req, kaynak === "LOG" ? "tedarikci_odeme" : "marka_taseron_odeme", id, "IPTAL", { durum: "AKTIF", tutar: h.tutar, tur: h.tur },
        { durum: "IPTAL", firma: M, tedarikci: c0.ad, geri_acilan: h.dagilim.map((d) => `${d.fatura_no}: ${tl(d.odeme)}`).join(", ") }, neden);
      return { zaten: false };
    });
    if (sonuc) res.json({ ok: true, ...sonuc });
  }
  app.post("/finance/marka-cari/odeme/:id/iptal", yazKapi, (req, res) => iptalEt(req, res, "LOG"));
  app.post("/finance/marka-cari/eski-odeme/:id/iptal", yazKapi, (req, res) => iptalEt(req, res, "MARKA"));

  // Dekont: yalnız bu firmanın ödeme kaydına; PDF / görsel, en fazla 10 MB
  app.post("/finance/marka-cari/odeme/:id/dekont", yazKapi, upload.single("file"), async (req, res) => {
    try {
      const M = req.cariFirma, id = Number(req.params.id);
      if (!req.file) return hata(res, 400, "Dosya yok");
      if (!/^(application\/pdf|image\/(png|jpe?g|webp|heic|heif))$/i.test(req.file.mimetype || "")) return hata(res, 400, "Yalnız PDF ya da fotoğraf yüklenebilir");
      if (req.file.size > 10 * 1024 * 1024) return hata(res, 400, "Dosya en fazla 10 MB olabilir");
      const v = await cariHesapla(pool, M);
      const var_ = [...v.cari.values()].some((c0) => c0.hareketler.some((h) => h.kaynak === "LOG" && h.id === id && h.islem_turu !== "MAHSUP"));
      if (!var_) return hata(res, 404, "Ödeme kaydı bu firmada bulunamadı");
      const ext = (utf8Name(req.file.originalname) || "").split(".").pop() || "pdf";
      let url;
      try { ({ url } = await uploadToStorage("odeme-dekontlar", `odeme-dekont/${id}_${Date.now()}.${ext}`, req.file.buffer, req.file.mimetype)); }
      catch (e) { console.error("[cari dekont]", e.message); return hata(res, 502, "Dekont depoya yüklenemedi — ödeme kaydı duruyor, dekontu geçmişten tekrar yükleyin"); }
      await pool.query(`UPDATE taseron_odeme_log SET dekont_url=$1 WHERE id=$2`, [url, id]);
      await islemGecmisiYaz(req, "tedarikci_odeme", id, "DEKONT", null, { dosya: utf8Name(req.file.originalname) }, null);
      res.json({ ok: true, dekont_url: url });
    } catch (e) { console.error("[cari dekont]", e.message); hata(res, 500, "Dekont kaydedilemedi"); }
  });

  // Kimlik düzeltme: eski faturanın / ödemenin tedarikçi kartı açıkça seçilir (birden çok karta uyan ya da kartsız kayıt).
  // Kullanıcı kararıdır; işlem geçmişine yazılır. Ödeme dağılımı varsa farklı tedarikçiye taşınamaz.
  app.put("/finance/marka-cari/fatura/:id/tedarikci", kartKapi, async (req, res) => {
    try {
      const M = req.cariFirma, id = Number(req.params.id), tid = Number(req.body?.tedarikci_id);
      const f = (await pool.query(`SELECT id, firma, fatura_no, tedarikci_id, COALESCE(odenen_tutar,0) AS odenen FROM invoice_entries WHERE id=$1 AND ${firmaSql(M, "firma")}`, [id])).rows[0];
      if (!f) return hata(res, 404, "Fatura bu firmada bulunamadı");
      const R = await rehberOku(pool);
      if (!R.byId.has(tid)) return hata(res, 400, "Firma kartı bulunamadı");
      if (Number(f.odenen) > 0.009 && f.tedarikci_id && Number(f.tedarikci_id) !== tid) return hata(res, 409, "Ödemesi olan faturanın tedarikçisi değiştirilemez — önce ödemeyi iptal edin");
      await pool.query(`UPDATE invoice_entries SET tedarikci_id=$2 WHERE id=$1`, [id, tid]);
      await islemGecmisiYaz(req, "fatura", id, "TEDARIKCI_KIMLIK", { tedarikci_id: f.tedarikci_id }, { tedarikci_id: tid, tedarikci: kartAd(R.byId.get(tid)), fatura_no: f.fatura_no }, temiz(req.body?.gerekce, 300) || null);
      res.json({ ok: true });
    } catch (e) { console.error("[cari kimlik]", e.message); hata(res, 500, "Kaydedilemedi"); }
  });
  app.put("/finance/marka-cari/odeme/:id/tedarikci", kartKapi, async (req, res) => {
    try {
      const M = req.cariFirma, id = Number(req.params.id), tid = Number(req.body?.tedarikci_id);
      const v = await cariHesapla(pool, M);
      const h = [...v.cari.values()].flatMap((c0) => c0.hareketler).find((x) => x.kaynak === "LOG" && x.id === id);
      if (!h) return hata(res, 404, "Ödeme kaydı bu firmada bulunamadı");
      if (!v.R.byId.has(tid)) return hata(res, 400, "Firma kartı bulunamadı");
      await pool.query(`UPDATE taseron_odeme_log SET tedarikci_id=$2 WHERE id=$1`, [id, tid]);
      await pool.query(`UPDATE marka_taseron_odeme SET tedarikci_id=$2 WHERE odeme_log_id=$1`, [id, tid]);
      await islemGecmisiYaz(req, "tedarikci_odeme", id, "TEDARIKCI_KIMLIK", null, { tedarikci_id: tid, tedarikci: kartAd(v.R.byId.get(tid)) }, temiz(req.body?.gerekce, 300) || null);
      res.json({ ok: true });
    } catch (e) { console.error("[cari kimlik]", e.message); hata(res, 500, "Kaydedilemedi"); }
  });

  // Faturanın işlem geçmişi (giriş, düzenleme, kimlik seçimi) — yalnız bu firmanın faturası
  app.get("/finance/marka-cari/fatura/:id/gecmis", okuKapi, async (req, res) => {
    try {
      const f = (await pool.query(`SELECT id FROM invoice_entries WHERE id=$1 AND ${firmaSql(req.cariFirma, "firma")}`, [Number(req.params.id)])).rows[0];
      if (!f) return hata(res, 404, "Fatura bu firmada bulunamadı");
      const r = await pool.query(`SELECT tip, eski, yeni, aciklama, kullanici, to_char(created_at,'YYYY-MM-DD HH24:MI') AS zaman FROM islem_gecmisi
        WHERE modul='fatura' AND kayit_id=$1 ORDER BY id DESC LIMIT 100`, [f.id]);
      res.json({ ok: true, rows: r.rows });
    } catch (e) { hata(res, 500, "Geçmiş alınamadı"); }
  });

  // Excel: cari ekstre + açık faturalar + ödeme/avans geçmişi + dağılımlar — ekrandaki hesapla aynı (cariHesapla)
  app.get("/finance/marka-cari/excel", okuKapi, async (req, res) => {
    try {
      const M = req.cariFirma;
      const v = await cariHesapla(pool, M);
      const anahtar = String(req.query.tedarikci || "");
      const liste = anahtar ? [v.bul(anahtar)].filter(Boolean) : [...v.cari.values()];
      if (anahtar && !liste.length) return hata(res, 404, "Tedarikçi bulunamadı");
      const firmaAd = M === "SIMSEK" ? "Şimşek Haberleşme" : markaProfil(M).ad;
      const wb = new ExcelJS.Workbook();
      const TUR = { AVANS: "Avans", FATURA_ODEME: "Fatura ödemesi", MAHSUP: "Avans mahsubu (nakit yok)", FATURA_GIRISI: "Fatura girişinde ödenen" };
      const sayfa = (ad, baslik, kolonlar, satirlar, sayisal) => {
        const ws = wb.addWorksheet(ad, { views: [{ state: "frozen", ySplit: 2, showGridLines: false }] });
        ws.columns = kolonlar.map(([, w]) => ({ width: w }));
        ws.mergeCells(1, 1, 1, kolonlar.length);
        Object.assign(ws.getCell(1, 1), { value: baslik });
        ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
        ws.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
        ws.getRow(1).height = 24;
        const h = ws.getRow(2);
        kolonlar.forEach(([t], i) => { const cl = h.getCell(i + 1); cl.value = t; cl.font = { bold: true, color: { argb: "FF1E3A5F" } };
          cl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } }; cl.alignment = { vertical: "middle", wrapText: true }; });
        for (const s of satirlar) {
          const row = ws.addRow(s.hucre || s);
          row.eachCell((cl, i) => { if (sayisal.includes(i - 1)) cl.numFmt = "#,##0.00"; cl.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } }; });
          if (s.kalin) row.font = { bold: true };
        }
        return ws;
      };
      // 1) Cari ekstre: kronolojik borç / alacak, yürüyen bakiye (pozitif = tedarikçiye borçluyuz)
      const ekstre = [];
      for (const c0 of liste) for (const pb of Object.keys(c0.pb).length ? Object.keys(c0.pb) : ["TRY"]) {
        const ol = [];
        for (const f of c0.faturalar.filter((x) => x.pb === pb)) ol.push({ t: f.fatura_tarihi || f.giris_tarihi, s: 0, a: f.tur === "GELEN" ? "Fatura" : "İade faturası", n: f.fatura_no, b: f.tur === "GELEN" ? f.toplam : 0, al: f.tur === "GELEN" ? 0 : f.toplam, ack: f.note || "" });
        // 03.11.2026: hakediş esaslı cari — borç gerçekleşen iştir (fatura değildir): iş kodu ve kalem bazında, iş tarihiyle
        for (const h of (c0.is_bedeli || []).filter((x) => x.pb === pb)) ol.push({ t: h.tarih, s: 0, a: "Gerçekleşen iş", n: h.site_code, b: h.tutar, al: 0, ack: `${h.item_code} ${h.aciklama || ""}${h.paket ? ` · ${h.paket} paket` : ` · ${h.miktar} adet`} · iş tarihi: ${h.tarih_kaynak}` });
        for (const h of c0.hareketler.filter((x) => x.pb === pb && x.durum === "AKTIF")) {
          if (h.islem_turu === "MAHSUP") ol.push({ t: h.tarih, s: 1, a: TUR.MAHSUP, n: h.no, b: 0, al: 0, ack: h.dagilim.map((d) => `${d.fatura_no}: ${tl(d.odeme)}`).join(", ") });
          else ol.push({ t: h.tarih, s: 1, a: TUR[h.tur] || h.tur, n: h.no, b: 0, al: h.tutar, ack: [h.aciklama, h.referans && `ref ${h.referans}`].filter(Boolean).join(" · ") });
        }
        ol.sort((x, y) => String(x.t).localeCompare(String(y.t)) || x.s - y.s);
        let bak = 0;
        for (const o of ol) { bak = r2(bak + o.b - o.al); ekstre.push([c0.ad, pb, o.t || "", o.a, o.n || "", o.b || null, o.al || null, bak, o.ack]); }
        const P = c0.pb[pb] || {};
        ekstre.push({ hucre: [c0.ad, pb, "", "NET CARİ BAKİYE", "", null, null, P.net || 0, `Kalan fatura borcu ${tl(P.kalan)} − açık avans/alacak ${tl(P.alacak)}`], kalin: true });
      }
      sayfa("Cari Ekstre", `${firmaAd} — Tedarikçi Cari Ekstresi${anahtar ? ` · ${liste[0].ad}` : ""} (${bugunTR().split("-").reverse().join(".")})`,
        [["Tedarikçi", 34], ["PB", 6], ["Tarih", 12], ["İşlem", 26], ["Belge / İşlem No", 18], ["Borç (fatura)", 15], ["Alacak (ödeme/iade)", 17], ["Bakiye", 15], ["Açıklama", 50]], ekstre, [5, 6, 7]);
      // 2) Özet
      sayfa("Özet", `${firmaAd} — Cari Özet`, [["Tedarikçi", 34], ["Firma kartı", 12], ["PB", 6], ["Toplam fatura (gelen)", 18], ["İade", 12], ["Faturalara uygulanan ödeme/mahsup", 20], ["Onaylı hakediş", 15], ["Hakedişe mahsup", 15], ["Kalan borç (fatura + hakediş)", 18], ["Açık avans / alacak", 16], ["Net cari bakiye", 15], ["Ödenen nakit", 14], ["Cari modeli", 16]],
        liste.flatMap((c0) => Object.entries(c0.pb).map(([pb, P]) => [c0.ad, c0.kimlik === "KART" ? "Var" : c0.kimlik === "BELIRSIZ" ? "Belirsiz" : "Yok", pb, P.fatura, P.iade, P.uygulanan, P.hakedis || 0, P.hakedis_mahsup || 0, P.kalan, P.alacak, P.net, P.nakit, c0.cari_modeli === "HAKEDIS" ? "Hakediş esaslı" : "Faturalı"])), [3, 4, 5, 6, 7, 8, 9, 10, 11]);
      // 3) Açık faturalar (FIFO sırası)
      sayfa("Açık Faturalar", `${firmaAd} — Açık Faturalar (FIFO sırası) · ${FIFO_KURAL}`, [["Tedarikçi", 34], ["Fatura No", 18], ["Fatura tarihi", 12], ["Vade", 12], ["PB", 6], ["Matrah", 14], ["KDV", 12], ["Toplam (ödenecek)", 16], ["Uygulanan ödeme", 15], ["Bağlı iade", 12], ["Kalan", 14], ["Not", 30]],
        liste.flatMap((c0) => c0.faturalar.filter((f) => f.tur === "GELEN" && f.acik > 0.009).map((f) => [c0.ad, f.fatura_no, f.fatura_tarihi || "", f.vade_tarihi || "", f.pb, f.matrah, f.kdv, f.toplam, f.odenen, f.iade_bagli, f.acik, f.arac ? "Araç kirası — ödeme ekranından" : ""])), [5, 6, 7, 8, 9, 10]);
      // 4) Ödeme / avans geçmişi
      const HUR = (h) => h.durum === "IPTAL" ? `İPTAL — ${h.iptal_neden || ""}` : "Aktif";
      sayfa("Ödeme-Avans Geçmişi", `${firmaAd} — Ödeme / Avans / Mahsup Geçmişi`, [["Tedarikçi", 34], ["Tarih", 12], ["İşlem No", 10], ["Tür", 24], ["Tutar", 14], ["PB", 6], ["TL karşılığı", 13], ["Faturaya uygulanan", 15], ["Açık avansa kalan", 15], ["Yöntem", 18], ["Referans", 14], ["Açıklama", 30], ["İşlemi yapan", 24], ["Dekont", 8], ["Durum", 20]],
        liste.flatMap((c0) => c0.hareketler.map((h) => [c0.ad, h.tarih || "", h.no, TUR[h.tur] || h.tur, h.tutar, h.pb, h.tl_tutar, r2(h.dagilim.reduce((s, d) => s + d.odeme, 0)), h.islem_turu === "MAHSUP" ? null : h.avans_tutar, YONTEM[h.yontem] || h.yontem || "", h.referans || "", h.aciklama || "", h.yapan || "", h.dekont_url ? "Var" : "", HUR(h)])), [4, 6, 7, 8]);
      // 5) Dağılımlar
      sayfa("Dağılımlar", `${firmaAd} — Ödeme Dağılımları (hangi ödeme hangi faturayı kapattı)`, [["Tedarikçi", 34], ["İşlem No", 10], ["İşlem tarihi", 12], ["Tür", 24], ["Fatura No", 18], ["Uygulanan", 14], ["PB", 6], ["Durum", 12]],
        liste.flatMap((c0) => c0.hareketler.flatMap((h) => h.dagilim.map((d) => [c0.ad, h.no, h.tarih || "", TUR[h.tur] || h.tur, d.fatura_no, d.odeme, h.pb, h.durum === "IPTAL" ? "İptal" : "Aktif"]))), [5]);
      const dosya = `${M}_Tedarikci_Cari${anahtar ? "_" + katla(liste[0].ad).slice(0, 30) : ""}_${bugunTR()}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${dosya}"`);
      await wb.xlsx.write(res); res.end();
    } catch (e) { console.error("[cari excel]", e.message); if (!res.headersSent) hata(res, 500, "Excel hazırlanamadı"); }
  });

  // ══ HAKEDİŞ ESASLI CARİ (02.11.2026, Orhan — TEKNO_EMRAH, TEKNO_SEYFİ) ═════════════════════════════════════════════
  // Fatura zorunlu değil: borç = ONAYLI hakediş. Hakediş, fiziki tamamlanan (master_works.tamamlanan_qty) ve kalem taşeronu bu
  // kartın adlarından biri olan kalemlerden kurulur; PR / iş ataması tek başına hakediş DEĞİLDİR. Fiyat yalnız taseron_fiyat
  // (bu firmanın taşeron fiyatı) — Huawei PO / BoQ satış fiyatı taşeron hakedişi sayılmaz; fiyatı olmayan kalem hakedişe
  // GİRMEZ ("Taşeron fiyatı tanımlanmadı" listesi). Onaylı hakedişin kalem fiyatı sabittir (sonraki fiyat değişikliği eski
  // hakedişi değiştirmez). Bu model yasal belge yükümlülüğünün yerine geçmez; muhasebe belgeleri ayrı süreçte yürür.
  const hakedisKart = (R, M, anahtar) => {
    const m = /^id:(\d+)$/.exec(String(anahtar || "")); const s = m ? R.byId.get(Number(m[1])) : null;
    if (!s || s.aktif === false || !kartKapsamda(s, M)) return null;
    return s;
  };
  async function fiyatBul(db, M, tid, kod, tarih) {
    const r = await db.query(`SELECT id, birim_fiyat, UPPER(COALESCE(para_birimi,'TRY')) AS pb, birim, kaynak, to_char(gecerlilik_bas,'YYYY-MM-DD') AS bas, tedarikci_id
      FROM taseron_fiyat WHERE UPPER(firma_kod) = $1 AND item_code = $2 AND COALESCE(durum,'AKTIF') = 'AKTIF'
        AND (tedarikci_id = $3 OR tedarikci_id IS NULL) AND gecerlilik_bas <= $4::date AND (gecerlilik_bit IS NULL OR gecerlilik_bit >= $4::date)
      ORDER BY (tedarikci_id IS NULL), gecerlilik_bas DESC, id DESC`, [M, String(kod || "").trim(), tid, tarih]);
    if (!r.rows.length) return null;
    const ilk = r.rows[0];
    // Aynı öncelik + aynı geçerlilik gününde farklı fiyat → belirsiz (ilk bulunan seçilmez)
    const es = r.rows.filter((x) => (x.tedarikci_id === null) === (ilk.tedarikci_id === null) && x.bas === ilk.bas);
    if (es.some((x) => Math.abs(Number(x.birim_fiyat) - Number(ilk.birim_fiyat)) > 0.009 || x.pb !== ilk.pb)) return { belirsiz: true, adaylar: es };
    return { id: ilk.id, fiyat: Number(ilk.birim_fiyat), pb: ilk.pb, birim: ilk.birim, kaynak: ilk.kaynak, bas: ilk.bas, ozel: ilk.tedarikci_id !== null };
  }
  // 02.11.2026 (Orhan) PAKET FİYATI: iş kodu (site_code) başına tek bedel — antenli / antensiz / triple (teknolojiden bağımsız).
  // Fiyat taseron_fiyat'ta item_code = PAKET_ANTENLI | PAKET_ANTENSIZ | PAKET_TRIPLE olarak tanımlanır. Bedeli iş kodunun ana
  // paket kalemi taşır; aynı iş kodunun diğer kalemleri (RRU söküm, etiket, TK plaka, teşvik, One Band…) pakete dahildir.
  // Paket fiyatı tanımlı değilse kalem bazlı fiyat aynen geçerlidir (diğer firmalar / faturalı tedarikçiler etkilenmez).
  const PAKET_RE = { TRIPLE: /triple band/i, ANTENLI: /\bwith antenna/i, ANTENSIZ: /\bwithout antenna/i };
  const paketTipi = (siteCode, ks) => {
    if (/_TRP/i.test(siteCode) || ks.some((x) => PAKET_RE.TRIPLE.test(x.item_description || ""))) return "TRIPLE";
    if (ks.some((x) => PAKET_RE.ANTENLI.test(x.item_description || ""))) return "ANTENLI";
    if (ks.some((x) => PAKET_RE.ANTENSIZ.test(x.item_description || ""))) return "ANTENSIZ";
    return null;
  };
  const PAKET_AD = { ANTENLI: "Antenli", ANTENSIZ: "Antensiz", TRIPLE: "Triple" };
  // Değer: paket ana kalemi miktar payı kadar paket bedeli (tam miktar = tam bedel), diğerleri miktar × birim fiyat
  const kalemDeger = (x, qty) => !x.fiyat ? 0 : x.fiyat.paket
    ? r2(x.fiyat.paket.bedel * Math.min(Math.max(0, qty), x.fiyat.paket.adet) / x.fiyat.paket.adet) : r2(qty * x.fiyat.fiyat);
  // Kartın gerçekleşen işleri: kalem bazında PR (done_qty), fiziki (tamamlanan_qty), hakedişe girmiş miktar, kalan ve fiyat
  async function hakedisIsleri(db, M, s, tarih) {
    const adlar = s.katlar;
    // 02.11.2026: fiyat İŞ TARİHİNE göre seçilir (hakediş günü değil). 03.11.2026 (Orhan): iş tarihi = fiilî MONTAJ BAŞLANGICI;
    // yoksa iş kodunun ilk iş girişi; o da yoksa montaj bitişi / tamamlanma (bitiş tarihleri toplu kapatmada sonradan girilebiliyor)
    const isSql = (rp) => `SELECT m.id, UPPER(TRIM(m.site_code)) AS site_code, TRIM(COALESCE(m.item_code,'')) AS item_code, m.item_description,
        COALESCE(m.done_qty,0)::numeric AS pr_qty, COALESCE(m.tamamlanan_qty,0)::numeric AS fiziki_qty, m.subcon_name, m.qc_durum,
        to_char(m.created_at,'YYYY-MM-DD') AS giris, ${rp ? "to_char(rp.installation_actual_start_date, 'YYYY-MM-DD')" : "NULL"} AS montaj,
        ${rp ? "to_char(COALESCE(rp.installation_actual_end_date, rp.tamamlanma_tarihi), 'YYYY-MM-DD')" : "NULL"} AS bitis
      FROM master_works m ${rp ? "LEFT JOIN rollout_progress rp ON UPPER(TRIM(rp.site_code)) = UPPER(TRIM(m.site_code))" : ""}
      WHERE m.subcon_name IS NOT NULL ORDER BY m.site_code, m.id`;
    const r = await db.query(isSql(true)).catch(() => db.query(isSql(false)));
    const kalemler = r.rows.filter((x) => adlar.includes(katla(x.subcon_name)));
    // İş kodunun tarihi: montaj başlangıcı → en erken iş girişi → montaj bitişi; hiçbiri yoksa hakediş günü
    const isTarihi = new Map();
    for (const sc of new Set(kalemler.map((x) => x.site_code))) {
      const ks = kalemler.filter((x) => x.site_code === sc);
      const t = ks.find((x) => x.montaj)?.montaj || ks.map((x) => x.giris).filter(Boolean).sort()[0] || ks.find((x) => x.bitis)?.bitis;
      if (t) isTarihi.set(sc, t);
    }
    const ids = kalemler.map((x) => Number(x.id));
    const kullanilan = new Map();
    if (ids.length) {
      const k = await db.query(`SELECT k.master_works_id AS id, SUM(k.miktar)::numeric AS m FROM taseron_hakedis_kalem k JOIN taseron_hakedis_belge b ON b.id = k.belge_id
        WHERE b.durum <> 'IPTAL' AND k.master_works_id = ANY($1::int[]) GROUP BY 1`, [ids]);
      k.rows.forEach((x) => kullanilan.set(Number(x.id), Number(x.m)));
    }
    // İş kodu başına paket: tip + tanımlı paket fiyatı varsa ana kalem bedeli taşır, diğerleri pakete dahil
    const paketler = new Map();
    for (const sc of [...new Set(kalemler.map((x) => x.site_code))]) {
      const ks = kalemler.filter((x) => x.site_code === sc);
      const tip = paketTipi(sc, ks); if (!tip) continue;
      const pf = await fiyatBul(db, M, s.id, `PAKET_${tip}`, isTarihi.get(sc) || tarih);
      if (!pf) continue;
      const re = PAKET_RE[tip];
      const adaylar = ks.filter((x) => re.test(x.item_description || ""));
      const ana = (adaylar.length ? adaylar : [...ks].sort((a, b) => Math.max(Number(a.pr_qty), Number(a.fiziki_qty)) - Math.max(Number(b.pr_qty), Number(b.fiziki_qty)) || Number(a.id) - Number(b.id)))[0];
      paketler.set(sc, { tip, pf, ana_id: Number(ana.id), adet: Math.max(Number(ana.pr_qty), Number(ana.fiziki_qty), 1) });
    }
    const out = [];
    for (const x of kalemler) {
      const giren = kullanilan.get(Number(x.id)) || 0;
      const kalan = r2(Math.max(0, Number(x.fiziki_qty) - giren));
      const pk = paketler.get(x.site_code);
      let fiyat, durum, paket_dahil = null;
      if (pk && pk.pf.belirsiz) { fiyat = null; durum = "BELIRSIZ"; }
      else if (pk && pk.ana_id === Number(x.id)) {
        fiyat = { ...pk.pf, fiyat: r2(pk.pf.fiyat / pk.adet), paket: { tip: pk.tip, ad: PAKET_AD[pk.tip], bedel: pk.pf.fiyat, adet: pk.adet } }; durum = "VAR";
      } else if (pk) { fiyat = null; durum = "PAKET"; paket_dahil = { tip: pk.tip, ad: PAKET_AD[pk.tip], ana_master_works_id: pk.ana_id }; }
      else {
        const f = x.item_code ? await fiyatBul(db, M, s.id, x.item_code, isTarihi.get(x.site_code) || tarih) : null;
        fiyat = f && !f.belirsiz ? f : null; durum = !f ? "TANIMSIZ" : f.belirsiz ? "BELIRSIZ" : "VAR";
      }
      const satir = { master_works_id: Number(x.id), site_code: x.site_code, fiziksel_id: String(x.site_code).split("_")[0], item_code: x.item_code,
        aciklama: x.item_description, etiket: x.subcon_name, pr_qty: Number(x.pr_qty), fiziki_qty: Number(x.fiziki_qty), hakediste: giren, kalan,
        qc: x.qc_durum || null, giris: x.giris, is_tarihi: isTarihi.get(x.site_code) || tarih, is_tarihi_kaynak: x.montaj ? "montaj başlangıcı" : x.giris ? "iş girişi" : "montaj bitişi",
        fiyat, fiyat_durum: durum, paket_dahil };
      satir.tutar = fiyat ? kalemDeger(satir, kalan) : null;
      out.push(satir);
    }
    return out;
  }
  app.get("/finance/marka-cari/hakedis/isler", okuKapi, async (req, res) => {
    try {
      const M = req.cariFirma; if (M === "SIMSEK") return hata(res, 400, "Hakediş esaslı cari yalnız alt marka firmalarında");
      const R = await rehberOku(pool); const s = hakedisKart(R, M, req.query.tedarikci);
      if (!s) return hata(res, 404, "Tedarikçi bu firmanın kayıtlarında bulunamadı");
      const tarih = tarihMi(req.query.tarih) ? req.query.tarih : bugunTR();
      const isler = await hakedisIsleri(pool, M, s, tarih);
      const fiyatGor = req.izinler?.fiyat_goruntule !== false;
      const rows = fiyatGor ? isler : isler.map((x) => ({ ...x, fiyat: null, tutar: null }));
      const ozet = { kalem: rows.length, is_kodu: new Set(rows.map((x) => x.site_code)).size, saha: new Set(rows.map((x) => x.fiziksel_id)).size,
        fiziki_kalem: rows.filter((x) => x.fiziki_qty > 0).length, hakedise_hazir: rows.filter((x) => x.kalan > 0.009 && x.fiyat_durum === "VAR").length,
        fiyat_bekleyen: rows.filter((x) => x.kalan > 0.009 && !["VAR", "PAKET"].includes(x.fiyat_durum)).length,
        hazir_tutar: fiyatGor ? r2(rows.reduce((t, x) => t + (x.kalan > 0.009 && x.tutar ? x.tutar : 0), 0)) : null,
        // Planlanan (PR/talep) ve fiziki gerçekleşen iş bedeli — yalnız taşeron fiyatı tanımlı kalemlerden; fiyatsız kalem SAYILMAZ
        plan_tutar: fiyatGor ? r2(rows.reduce((t, x) => t + kalemDeger(x, x.pr_qty), 0)) : null,
        fiziki_tutar: fiyatGor ? r2(rows.reduce((t, x) => t + kalemDeger(x, x.fiziki_qty), 0)) : null,
        paket_dahil_kalem: rows.filter((x) => x.fiyat_durum === "PAKET").length,
        fiyatsiz_kalem: rows.filter((x) => !["VAR", "PAKET"].includes(x.fiyat_durum)).length };
      res.json({ ok: true, firma: M, tedarikci: { id: s.id, ad: kartAd(s) }, tarih, ozet, rows });
    } catch (e) { console.error("[hakedis isler]", e.message); hata(res, 500, "İş listesi alınamadı"); }
  });
  // Hakediş taslağı: seçilen kalemlerin KALAN fiziki miktarı, tanımlı taşeron fiyatıyla. Fiyatsız/belirsiz kalem reddedilir.
  app.post("/finance/marka-cari/hakedis", yazKapi, async (req, res) => {
    const M = req.cariFirma, b = req.body || {};
    const idem = temiz(b.idem_key, 120);
    if (idem.length < 8) return hata(res, 400, "İşlem anahtarı eksik (sayfayı yenileyin)");
    const tarih = tarihMi(b.tarih) ? b.tarih : bugunTR();
    const sec = Array.isArray(b.master_works_ids) ? [...new Set(b.master_works_ids.map(Number).filter(Boolean))] : [];
    if (!sec.length) return hata(res, 400, "Hakedişe girecek kalem seçin");
    const sonuc = await islem(res, async (db) => {
      await kilitle(db, "hakedis-idem", idem);
      const ex = (await db.query(`SELECT id FROM taseron_hakedis_belge WHERE idem_key = $1`, [idem])).rows[0];
      if (ex) return { tekrar: true, belge_id: ex.id };
      const R = await rehberOku(db); const s = hakedisKart(R, M, b.tedarikci);
      if (!s) throw hataK(404, "Tedarikçi bu firmanın kayıtlarında bulunamadı");
      await kilitle(db, "hakedis", M, String(s.id));
      const isler = await hakedisIsleri(db, M, s, tarih);
      const secilen = isler.filter((x) => sec.includes(x.master_works_id));
      if (secilen.length !== sec.length) throw hataK(409, "Seçilen kalemlerden biri bu taşerona ait değil");
      const sorun = secilen.filter((x) => x.kalan <= 0.009 || x.fiyat_durum !== "VAR"); // pakete dahil kalem ayrıca girmez
      if (sorun.length) throw hataK(409, `Hakedişe giremeyen kalem: ${sorun.map((x) => `${x.site_code} ${x.item_code} (${x.kalan <= 0.009 ? "kalan fiziki miktar yok" : x.fiyat_durum === "BELIRSIZ" ? "fiyat belirsiz" : x.fiyat_durum === "PAKET" ? "pakete dahil — bedeli iş kodunun ana kaleminde" : "taşeron fiyatı tanımlanmadı"})`).join(", ")}`, { sorunlu: sorun.map((x) => x.master_works_id) });
      const pbs = [...new Set(secilen.map((x) => x.fiyat.pb))];
      if (pbs.length > 1) throw hataK(409, "Farklı para birimli kalemler aynı hakedişe girmez");
      const toplam = r2(secilen.reduce((t, x) => t + x.tutar, 0));
      const bl = (await db.query(`INSERT INTO taseron_hakedis_belge (firma_kod, tedarikci_id, donem, hakedis_tarihi, durum, toplam, para_birimi, aciklama, idem_key, olusturan)
        VALUES ($1,$2,$3,$4,'TASLAK',$5,$6,$7,$8,$9) RETURNING id`, [M, s.id, tarih.slice(0, 7), tarih, toplam, pbs[0], temiz(b.aciklama, 500) || null, idem, kim(req)])).rows[0];
      for (const x of secilen) await db.query(`INSERT INTO taseron_hakedis_kalem (belge_id, master_works_id, site_code, fiziksel_id, item_code, aciklama, miktar, birim_fiyat, tutar, para_birimi, fiyat_id, fiyat_kaynak)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [bl.id, x.master_works_id, x.site_code, x.fiziksel_id, x.item_code, x.aciklama, x.kalan, x.fiyat.fiyat, x.tutar, x.fiyat.pb, x.fiyat.id, (x.fiyat.paket ? `${x.fiyat.paket.ad} paket ${x.fiyat.paket.bedel} / iş kodu — ` : "") + (x.fiyat.kaynak || "") || null]);
      await islemGecmisiYaz(req, "taseron_hakedis", bl.id, "OLUSTURMA", null, { firma: M, tedarikci_id: s.id, tedarikci: kartAd(s), toplam, para_birimi: pbs[0], kalem: secilen.length, durum: "TASLAK" }, temiz(b.aciklama, 500) || null);
      return { tekrar: false, belge_id: bl.id, toplam, kalem: secilen.length };
    });
    if (sonuc) res.json({ ok: true, ...sonuc });
  });
  app.get("/finance/marka-cari/hakedis/:id", okuKapi, async (req, res) => {
    try {
      const b = (await pool.query(`SELECT * FROM taseron_hakedis_belge WHERE id=$1 AND UPPER(firma_kod)=$2`, [Number(req.params.id), req.cariFirma])).rows[0];
      if (!b) return hata(res, 404, "Hakediş bu firmada bulunamadı");
      const k = (await pool.query(`SELECT * FROM taseron_hakedis_kalem WHERE belge_id=$1 ORDER BY site_code, id`, [b.id])).rows;
      const g = (await pool.query(`SELECT tip, yeni, aciklama, kullanici, to_char(created_at,'YYYY-MM-DD HH24:MI') AS zaman FROM islem_gecmisi WHERE modul='taseron_hakedis' AND kayit_id=$1 ORDER BY id`, [b.id])).rows;
      const fiyatGor = req.izinler?.fiyat_goruntule !== false;
      res.json({ ok: true, belge: fiyatGor ? b : { ...b, toplam: null }, kalemler: fiyatGor ? k : k.map((x) => ({ ...x, birim_fiyat: null, tutar: null })), gecmis: g });
    } catch (e) { hata(res, 500, "Hakediş alınamadı"); }
  });
  // Onay: TASLAK → ONAYLI (borç olur; nakit çıkışı OLUŞMAZ). İptal: kayıt silinmez, İPTAL olur, kalemler yeniden hakedişe girebilir.
  async function hakedisDurum(req, res, yeni) {
    const M = req.cariFirma, id = Number(req.params.id), neden = temiz(req.body?.neden, 500);
    if (yeni === "IPTAL" && !neden) return hata(res, 400, "İptal nedeni zorunlu");
    const sonuc = await islem(res, async (db) => {
      const b = (await db.query(`SELECT * FROM taseron_hakedis_belge WHERE id=$1 AND UPPER(firma_kod)=$2 FOR UPDATE`, [id, M])).rows[0];
      if (!b) throw hataK(404, "Hakediş bu firmada bulunamadı");
      if (b.durum === yeni) return { zaten: true };
      if (yeni === "ONAYLI" && b.durum !== "TASLAK") throw hataK(409, `Yalnız taslak hakediş onaylanır (durum: ${b.durum})`);
      if (yeni === "IPTAL" && b.durum === "IPTAL") return { zaten: true };
      if (yeni === "ONAYLI") await db.query(`UPDATE taseron_hakedis_belge SET durum='ONAYLI', onaylayan=$2, onay_tarihi=NOW() WHERE id=$1`, [id, kim(req)]);
      else await db.query(`UPDATE taseron_hakedis_belge SET durum='IPTAL', iptal_eden=$2, iptal_tarihi=NOW(), iptal_neden=$3 WHERE id=$1`, [id, kim(req), neden]);
      await islemGecmisiYaz(req, "taseron_hakedis", id, yeni === "ONAYLI" ? "ONAY" : "IPTAL", { durum: b.durum }, { durum: yeni, toplam: Number(b.toplam) }, neden || null);
      return { zaten: false };
    });
    if (sonuc) res.json({ ok: true, ...sonuc });
  }
  app.post("/finance/marka-cari/hakedis/:id/onay", yazKapi, (req, res) => hakedisDurum(req, res, "ONAYLI"));
  app.post("/finance/marka-cari/hakedis/:id/iptal", yazKapi, (req, res) => hakedisDurum(req, res, "IPTAL"));

  // Taşeron fiyatları: liste (fiyat görme izni) / tanım (ödeme yazarı + fiyat değiştirme izni). Değişiklik = yeni satır;
  // eski satır silinmez, tanımlı fiyat yalnız iptal edilebilir (gerekçeli). Onaylı hakedişin kalem fiyatı etkilenmez.
  app.get("/finance/marka-cari/fiyat", okuKapi, async (req, res) => {
    try {
      const r = await pool.query(`SELECT f.*, to_char(f.gecerlilik_bas,'YYYY-MM-DD') AS bas, to_char(f.gecerlilik_bit,'YYYY-MM-DD') AS bit FROM taseron_fiyat f
        WHERE UPPER(f.firma_kod)=$1 ORDER BY f.item_code, f.gecerlilik_bas DESC, f.id DESC`, [req.cariFirma]);
      res.json({ ok: true, rows: r.rows });
    } catch (e) { hata(res, 500, "Fiyatlar alınamadı"); }
  });
  app.post("/finance/marka-cari/fiyat", yazKapi, async (req, res) => {
    try {
      const M = req.cariFirma, b = req.body || {};
      if (req.izinler?.fiyat_degistirme === false) return hata(res, 403, "Fiyat değiştirme yetkiniz yok");
      const kod = temiz(b.item_code, 40), fiyat = r2(b.birim_fiyat), pb = String(b.para_birimi || "TRY").toUpperCase();
      if (!kod) return hata(res, 400, "Kalem kodu gerekli");
      if (!(fiyat > 0)) return hata(res, 400, "Birim fiyat sıfırdan büyük olmalı");
      if (!PARA.includes(pb)) return hata(res, 400, "Geçersiz para birimi");
      if (!tarihMi(b.gecerlilik_bas)) return hata(res, 400, "Geçerlilik başlangıç tarihi gerekli");
      const kaynak = temiz(b.kaynak, 300); if (!kaynak) return hata(res, 400, "Fiyatın kaynağı / anlaşma açıklaması gerekli");
      let tid = null;
      if (b.tedarikci) { const R = await rehberOku(pool); const s = hakedisKart(R, M, b.tedarikci); if (!s) return hata(res, 404, "Tedarikçi bu firmanın kayıtlarında bulunamadı"); tid = s.id; }
      const r = await pool.query(`INSERT INTO taseron_fiyat (firma_kod, tedarikci_id, item_code, aciklama, birim, birim_fiyat, para_birimi, gecerlilik_bas, gecerlilik_bit, kaynak, olusturan)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [M, tid, kod, temiz(b.aciklama, 300) || null, temiz(b.birim, 20) || null, fiyat, pb, b.gecerlilik_bas, tarihMi(b.gecerlilik_bit) ? b.gecerlilik_bit : null, kaynak, kim(req)]);
      await islemGecmisiYaz(req, "taseron_fiyat", r.rows[0].id, "OLUSTURMA", null, { firma: M, tedarikci_id: tid, item_code: kod, birim_fiyat: fiyat, para_birimi: pb, gecerlilik_bas: b.gecerlilik_bas, kaynak }, null);
      res.json({ ok: true, id: r.rows[0].id });
    } catch (e) { console.error("[taseron fiyat]", e.message); hata(res, 500, "Fiyat kaydedilemedi"); }
  });

  // ══ ESKİ "DİĞER ÖDEME" KAYDININ TAŞERON AVANSINA AKTARIMI ══════════════════════════════════════════════════════════
  // Yeni nakit çıkışı OLUŞMAZ: aynı tarih/tutarla taşeron avansı (taseron_odeme_log + marka_taseron_odeme) yazılır ve eski
  // cashflow_odeme satırı SİLİNMEDEN aktarim_log_id ile işaretlenir; nakit akışı / özet / P&L okumaları işaretli satırı atlar.
  // Tekrar çalıştırma ikinci hareket üretmez (satır kilidi + aktarim_log_id + idem_key). Geri alma: avans İPTAL, işaret kalkar.
  app.get("/finance/marka-cari/aktarim/adaylar", yazKapi, async (req, res) => {
    try {
      const M = req.cariFirma; if (M === "SIMSEK") return hata(res, 400, "Yalnız alt marka firmalarında");
      const r = await pool.query(`SELECT id, to_char(tarih,'YYYY-MM-DD') AS tarih, tutar, aciklama, donem, aktarim_log_id, to_char(aktarim_tarihi,'YYYY-MM-DD HH24:MI') AS aktarim_tarihi, aktarim_eden
        FROM cashflow_odeme WHERE UPPER(COALESCE(marka,'ERC')) = $1 AND UPPER(COALESCE(kategori,'')) = 'DIGER' ORDER BY tarih, id`, [M]);
      res.json({ ok: true, rows: r.rows });
    } catch (e) { hata(res, 500, "Adaylar alınamadı"); }
  });
  app.post("/finance/marka-cari/aktarim", yazKapi, async (req, res) => {
    const M = req.cariFirma, b = req.body || {};
    if (M === "SIMSEK") return hata(res, 400, "Yalnız alt marka firmalarında");
    const cfId = Number(b.cashflow_id); if (!cfId) return hata(res, 400, "Aktarılacak ödeme kaydı seçin");
    const gerekce = temiz(b.gerekce, 500); if (!gerekce) return hata(res, 400, "Aktarım gerekçesi zorunlu");
    const sonuc = await islem(res, async (db) => {
      const cf = (await db.query(`SELECT id, kategori, to_char(tarih,'YYYY-MM-DD') AS tarih, tutar, aciklama, donem, aktarim_log_id, UPPER(COALESCE(marka,'ERC')) AS marka FROM cashflow_odeme WHERE id=$1 FOR UPDATE`, [cfId])).rows[0];
      if (!cf || cf.marka !== M) throw hataK(404, "Ödeme kaydı bu firmada bulunamadı");
      if (cf.aktarim_log_id) return { tekrar: true, log_id: cf.aktarim_log_id };
      if (String(cf.kategori || "").toUpperCase() !== "DIGER") throw hataK(409, "Yalnız 'Diğer Ödeme' kayıtları aktarılır");
      const R = await rehberOku(db); const s = hakedisKart(R, M, b.tedarikci);
      if (!s) throw hataK(404, "Tedarikçi bu firmanın kayıtlarında bulunamadı");
      const idem = `cf-aktarim-${cf.id}`;
      const ex = (await db.query(`SELECT id FROM taseron_odeme_log WHERE idem_key=$1`, [idem])).rows[0];
      if (ex) { await db.query(`UPDATE cashflow_odeme SET aktarim_log_id=$2 WHERE id=$1`, [cf.id, ex.id]); return { tekrar: true, log_id: ex.id }; }
      const ad = kartAd(s), ack = `${cf.aciklama || "Taşeron avansı"} · Diğer Ödeme #${cf.id}'den aktarıldı`;
      const log = (await db.query(`INSERT INTO taseron_odeme_log (firma, tutar, tarih, aciklama, dagilim, avans_tutar, tedarikci_id, firma_kod, idem_key,
          durum, islem_turu, yontem, kasadan_dus, para_birimi, created_by) VALUES ($1,$2,$3,$4,'[{"fatura_no":"AVANS (hakediş bekleniyor)","avans":true}]',$2,$5,$6,$7,'AKTIF','AVANS','KASA',true,'TRY',$8) RETURNING id`,
        [ad, Number(cf.tutar), cf.tarih, ack, s.id, M, idem, kim(req)])).rows[0];
      await db.query(`INSERT INTO marka_taseron_odeme (marka, taseron_adi, tip, tutar, tarih, aciklama, odeme_log_id, tedarikci_id, kasadan_dus, durum)
        VALUES ($1,$2,'AVANS',$3,$4,$5,$6,$7,true,'AKTIF')`, [M, ad, Number(cf.tutar), cf.tarih, ack, log.id, s.id]);
      await db.query(`UPDATE cashflow_odeme SET aktarim_log_id=$2, aktarim_tarihi=NOW(), aktarim_eden=$3 WHERE id=$1`, [cf.id, log.id, kim(req)]);
      const iz = { cashflow_id: cf.id, tarih: cf.tarih, tutar: Number(cf.tutar), eski_kategori: "DIGER", eski_aciklama: cf.aciklama, yeni: `Taşeron avansı · ${ad}`, odeme_log_id: log.id };
      await islemGecmisiYaz(req, "cashflow_odeme", cf.id, "TASERON_AKTARIM", { kategori: "DIGER", aktarim_log_id: null }, { aktarim_log_id: log.id, tedarikci: ad }, gerekce);
      await islemGecmisiYaz(req, "tedarikci_odeme", log.id, "AKTARIM", null, iz, gerekce);
      return { tekrar: false, log_id: log.id, ...iz };
    });
    if (sonuc) res.json({ ok: true, ...sonuc });
  });
  app.post("/finance/marka-cari/aktarim/:id/geri-al", yazKapi, async (req, res) => {
    const M = req.cariFirma, neden = temiz(req.body?.neden, 500);
    if (!neden) return hata(res, 400, "Geri alma nedeni zorunlu");
    const sonuc = await islem(res, async (db) => {
      const cf = (await db.query(`SELECT id, aktarim_log_id, UPPER(COALESCE(marka,'ERC')) AS marka FROM cashflow_odeme WHERE id=$1 FOR UPDATE`, [Number(req.params.id)])).rows[0];
      if (!cf || cf.marka !== M) throw hataK(404, "Ödeme kaydı bu firmada bulunamadı");
      if (!cf.aktarim_log_id) return { zaten: true };
      await db.query(`UPDATE taseron_odeme_log SET durum='IPTAL', iptal_neden=$2, iptal_tarihi=NOW(), iptal_eden=$3, idem_key = idem_key || '-geri-' || id WHERE id=$1`, [cf.aktarim_log_id, neden, kim(req)]);
      await db.query(`UPDATE marka_taseron_odeme SET durum='IPTAL', iptal_neden=$2, iptal_tarihi=NOW(), iptal_eden=$3 WHERE odeme_log_id=$1`, [cf.aktarim_log_id, neden, kim(req)]);
      await db.query(`UPDATE cashflow_odeme SET aktarim_log_id=NULL, aktarim_tarihi=NULL, aktarim_eden=NULL WHERE id=$1`, [cf.id]);
      await islemGecmisiYaz(req, "cashflow_odeme", cf.id, "TASERON_AKTARIM_GERI", { aktarim_log_id: cf.aktarim_log_id }, { aktarim_log_id: null }, neden);
      return { zaten: false };
    });
    if (sonuc) res.json({ ok: true, ...sonuc });
  });

  // 02.11.2026: Taşeron Hakedişi (yeşil bölüm) için firma kartının taşeron fiyatıyla iş bedeli — fiziki miktar × iş tarihindeki
  // taşeron fiyatı (paket ya da kalem). Firmada hiç taşeron fiyatı tanımlı değilse null (eski hesap kuralı aynen kalır).
  async function taseronBedeli(db, M, etiket) {
    const v = (await db.query(`SELECT 1 FROM taseron_fiyat WHERE UPPER(firma_kod)=$1 AND COALESCE(durum,'AKTIF')='AKTIF' LIMIT 1`, [M]).catch(() => ({ rows: [] }))).rows.length;
    if (!v) return null;
    const R = await rehberOku(db); const k = katla(etiket);
    const s = [...R.byId.values()].find((x) => x.aktif !== false && kartKapsamda(x, M) && (x.katlar || []).includes(k));
    if (!s) return null;
    const isler = (await hakedisIsleri(db, M, s, bugunTR())).filter((x) => katla(x.etiket) === k);
    const fizikiler = isler.filter((x) => x.fiziki_qty > 0);
    const detay = fizikiler.filter((x) => x.fiyat).map((x) => ({ site: x.site_code, kalem: x.fiyat.paket ? `${x.aciklama} (${x.fiyat.paket.ad} paket)` : x.aciklama,
      adet: x.fiyat.paket ? 1 : x.fiziki_qty, birim: x.fiyat.paket ? x.fiyat.paket.bedel : x.fiyat.fiyat, tutar: kalemDeger(x, x.fiziki_qty), qc: x.qc || "", tarih: x.is_tarihi }));
    return { kart: kartAd(s), bedel: r2(detay.reduce((t, d) => t + d.tutar, 0)), detay,
      fiyatsiz: fizikiler.filter((x) => !["VAR", "PAKET"].includes(x.fiyat_durum)).length, paket_dahil: fizikiler.filter((x) => x.fiyat_durum === "PAKET").length };
  }

  return { cariHesapla, rehberOku, katla, fifoDagit, taseronBedeli };
}

module.exports = { semaKur, kur, katla };
