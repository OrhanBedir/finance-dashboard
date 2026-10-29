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
        s.tedarikci_turu, s.kaynak, COALESCE((SELECT ARRAY_AGG(t.ad ORDER BY t.ad) FROM subcon_takma_ad t WHERE t.subcon_id = s.id), '{}') AS takma
      FROM subcons s`).catch(() => db.query(`SELECT s.id, s.subcon_name, NULL AS gorunen_ad, NULL AS unvan, NULL AS ana_firma, true AS aktif,
        NULL AS tedarikci_turu, NULL AS kaynak, '{}'::text[] AS takma FROM subcons s`));
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
          adaylar: (k.adaylar || []).map((x) => ({ id: x, ad: kartAd(R.byId.get(x)), unvan: R.byId.get(x)?.unvan || null })),
          pb: {}, faturalar: [], hareketler: [], uyarilar: [] });
      }
      const c0 = cari.get(k.anahtar);
      if (k.durum === "BELIRSIZ" && c0.kimlik !== "BELIRSIZ") { c0.kimlik = "BELIRSIZ"; c0.adaylar = (k.adaylar || []).map((x) => ({ id: x, ad: kartAd(R.byId.get(x)), unvan: R.byId.get(x)?.unvan || null })); }
      return c0;
    };
    const pbOf = (c0, pb) => c0.pb[pb] || (c0.pb[pb] = pbBos());

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
      for (const [pb, P] of Object.entries(c0.pb)) {
        for (const k of Object.keys(P)) P[k] = r2(P[k]);
        P.nakit = r2(P.nakit + c0.hareketler.filter((h) => h.kaynak === "ORTAK" && h.pb === pb).reduce((s, h) => s + h.tutar, 0));
        P.gecerli = r2(P.fatura - P.iade); // geçerli toplam fatura: GELEN − iade (KDV dahil ödenecek)
        P.avans_acik = r2(P.avans_olusan - P.mahsup);
        P.alacak = r2(P.avans_acik + P.iade_alacak + P.fazla_odeme);
        P.net = r2(P.kalan - P.alacak);
        if (P.avans_acik < -0.009) c0.uyarilar.push({ tip: "AVANS_EKSI", mesaj: `${pb}: mahsup edilen tutar açık avansı ${tl(-P.avans_acik)} aşıyor — kayıtları kontrol edin` });
      }
      c0.faturalar.sort((a, b) => fifoAnahtar(a).localeCompare(fifoAnahtar(b)));
      c0.hareketler.sort((a, b) => String(b.tarih || "").localeCompare(String(a.tarih || "")) || b.id - a.id);
      c0.toplam_acik = Object.values(c0.pb).reduce((s, P) => s + (P.kalan > 0 ? 1 : 0), 0);
    }
    return { cari, R, fById, M };
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
    const c0 = veri.cari.get(String(b.tedarikci || ""));
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
      const kapsamda = (s) => M === "SIMSEK"
        ? !(s.ana_firma && altMarkaMi(String(s.ana_firma).toUpperCase()))
        : String(s.ana_firma || "").toUpperCase() === M || s.adlar.some((a) => String(a).trim().toUpperCase().startsWith(`${markaProfil(M).onek}_`)) || false;
      const sonuc = new Map();
      for (const c0 of v.cari.values()) sonuc.set(c0.anahtar, c0);
      for (const s of v.R.byId.values()) if (!sonuc.has(`id:${s.id}`) && kapsamda(s) && s.aktif !== false)
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
      const ayni = [...new Set([...R.coz(ad), ...(unvan ? R.coz(unvan) : [])])];
      if (ayni.length) return hata(res, 409, `"${ad}" adıyla kayıtlı firma kartı var — mevcut kartı seçin`, { mevcut: ayni.map((id) => ({ anahtar: `id:${id}`, id, ad: kartAd(R.byId.get(id)) })) });
      const ana = M === "SIMSEK" ? "ERC" : M;
      const r = await pool.query(`INSERT INTO subcons (subcon_name, gorunen_ad, unvan, ana_firma, aktif, kaynak, olusturan, tedarikci_turu)
        VALUES ($1,$2,$3,$4,true,'CARI',$5,$6) RETURNING id, subcon_name, gorunen_ad, unvan, ana_firma`,
        [ad.toLocaleUpperCase("tr-TR"), ad, unvan || null, ana, kim(req), tur === "TEDARIKCI" ? "TEDARIKCI" : null]);
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
      const rows = [...v.cari.values()].map((c0) => ({ anahtar: c0.anahtar, id: c0.id, ad: c0.ad, unvan: c0.unvan, kimlik: c0.kimlik, tur: c0.tur,
        etiketler: c0.etiketler, etiket_katla: c0.etiket_katla, adaylar: c0.adaylar, pb: c0.pb, fatura_sayisi: c0.faturalar.length,
        hareket_sayisi: c0.hareketler.length, uyari_sayisi: c0.uyarilar.length,
        son_odeme: c0.hareketler.find((h) => h.durum === "AKTIF" && h.islem_turu !== "MAHSUP")?.tarih || null }))
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
      const c0 = v.cari.get(String(req.query.tedarikci || ""));
      if (!c0) {
        const id = Number(String(req.query.tedarikci || "").replace(/^id:/, ""));
        const s = id ? v.R.byId.get(id) : null;
        if (!s) return hata(res, 404, "Tedarikçi bulunamadı");
        return res.json({ ok: true, firma: req.cariFirma, cari: { anahtar: `id:${id}`, id, ad: kartAd(s), unvan: s.unvan || null, kimlik: "KART", etiketler: s.adlar, pb: {}, faturalar: [], hareketler: [], uyarilar: [] }, kural: FIFO_KURAL, yazabilir: yazar(req, req.cariFirma) });
      }
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
      const c0 = v.cari.get(String(b.tedarikci || ""));
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
      const liste = anahtar ? [v.cari.get(anahtar)].filter(Boolean) : [...v.cari.values()];
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
      sayfa("Özet", `${firmaAd} — Cari Özet`, [["Tedarikçi", 34], ["Firma kartı", 12], ["PB", 6], ["Toplam fatura (gelen)", 18], ["İade", 12], ["Faturalara uygulanan ödeme/mahsup", 20], ["Kalan fatura borcu", 16], ["Açık avans / alacak", 16], ["Net cari bakiye", 15], ["Ödenen nakit", 14]],
        liste.flatMap((c0) => Object.entries(c0.pb).map(([pb, P]) => [c0.ad, c0.kimlik === "KART" ? "Var" : c0.kimlik === "BELIRSIZ" ? "Belirsiz" : "Yok", pb, P.fatura, P.iade, P.uygulanan, P.kalan, P.alacak, P.net, P.nakit])), [3, 4, 5, 6, 7, 8, 9]);
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

  return { cariHesapla, rehberOku, katla, fifoDagit };
}

module.exports = { semaKur, kur, katla };
