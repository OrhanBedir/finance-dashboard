// ═══ MALZEME KATALOĞU + TEKNOCENTER TALEP KAPSAMI (29.10.2026, Orhan) ════════════════════════════════════════════
// Katalog = stok defterinin ürün kartı tablosu (malzeme_urun) — ikinci bir ürün listesi yoktur. Bu modül kartları
// zenginleştirir (İngilizce ad, teknik özellikler, üretici/model, BoQ bağlantıları, kaynak) ve şunları sağlar:
//   • Arama (ad, kod, teknik özellik, BoQ kodu) — FİYAT ALANI HİÇ DÖNMEZ (fiyat yalnız Fiyat Listesi ekranında, mali yetkiyle).
//   • Yeni malzeme tanımlama: benzer kayıt uyarısı + sunucuda normalize ad benzersizliği (eşzamanlı iki kayıtta biri 409).
//   • Kaynaklı içe alma (BoQ adayları / mevcut adlar): önce önizleme, sonra yetkili onayı; tekrar çalıştırma mükerrer üretmez
//     (malzeme_urun_kaynak: kaynak_tip + kaynak_anahtar benzersiz). Belirsiz eşleşme sessizce birleştirilmez.
//   • Mevcut malzeme adları (malzeme_fiyat_listesi) KORUNUR: tablo değiştirilmez, fiyat okunmaz/yazılmaz; katalog kartı
//     fiyat_listesi_id ile bağlanır.
// BoQ kodu stok kimliği değildir: bir kart birden fazla BoQ kalemine (farklı sürüm) bağlanabilir.
// Teknocenter saha kapsamı: Rollout iş kaydı (rollout_progress.site_code = tam iş kodu, ör. KA3737_NR700_MWA) MARKA
// ROLLOUT KAPSAMI kuralıyla (iş kolu taşeronu TEKNO/TEKNOCENTER/TEKNO_… ya da Günlük İş Girişi'nde TEKNO kalemi) seçilir.

const BIRIMLER = ["Adet", "Metre", "Kg", "Litre", "Kutu", "Paket", "Rulo", "Takım", "Top", "Çift", "M²", "M³"];
const BIRIM_ESLE = { ADET: "Adet", PCS: "Adet", AD: "Adet", METRE: "Metre", MT: "Metre", M: "Metre", KG: "Kg", LITRE: "Litre", LT: "Litre",
  KUTU: "Kutu", PAKET: "Paket", RULO: "Rulo", "TAKIM": "Takım", "TAKİM": "Takım", SET: "Takım", TOP: "Top", "ÇİFT": "Çift", CIFT: "Çift",
  "M²": "M²", M2: "M²", "M³": "M³", M3: "M³" };
const KATEGORILER = ["LPRT pole", "Aydınlatma direği (lamppost)", "AG / OG enerji direkleri", "Anten / MW ofset, konsol ve montaj aparatı",
  "Enerji ve topraklama kabloları", "RF feeder, jumper ve konnektör", "Fiber kablo, patch cord ve aksesuar", "Outdoor kabinet, pano ve dağıtım",
  "Sigorta, kesici, parafudr ve bağlantı", "AG / OG enerji hattı ekipmanı", "Kablo kanalı, tava, boru ve geçiş", "Etiket, plaka, levha ve sarf",
  "Kamuflaj / gizleme", "Saha altyapısı ve EHS (tedarik+montaj)", "Diğer BoQ malzemesi", "Genel"];
const TEKNIK_ETIKET = { kesit: "Kesit", kablo_tipi: "Kablo tipi", iletken: "İletken", iletken_tipi: "İletken tipi", damar: "Damar", gerilim: "Gerilim",
  kurulum: "Kurulum", feeder_cap: "Feeder çapı", uzunluk_m: "Uzunluk (m)", akim_a: "Akım (A)", rack_u: "Rack (U)", guc_kva: "Güç (kVA)",
  et_kalinligi_mm: "Et kalınlığı (mm)", ebat: "Ebat", tip: "Tip" };

const metin = (s, max = 500) => (s === null || s === undefined ? "" : String(s).trim().slice(0, max));
const UST = (s) => String(s || "").toLocaleUpperCase("tr").replace(/\s+/g, " ").trim();
// Mükerrer kontrolü anahtarı: büyük harf, noktalama/boşluk farkı yok sayılır; RAKAMLAR ve ölçüler korunur (farklı kesit = farklı ürün)
function normalAnahtar(ad) {
  return UST(ad).replace(/MM²|MM2/g, "MM2").replace(/(\d)\s*[X×]\s*(\d)/g, "$1X$2").replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(\d)\s+(MM2|MM|CM|MT|METRE|M|KVA|A|U)(?=\s|$|[^A-ZÇĞİÖŞÜ])/g, "$1$2").replace(/(\d)(MT|METRE)(?=\s|$|[^A-ZÇĞİÖŞÜ])/g, "$1M")
    .replace(/[^A-Z0-9ÇĞİÖŞÜ.+/X]+/g, " ").replace(/\s+/g, " ").trim();
}
const kelimeler = (a) => new Set(normalAnahtar(a).split(" ").filter((w) => w.length >= 2 && !/^\d/.test(w)));
const sayilar = (a) => [...normalAnahtar(a).matchAll(/\d+(?:[.X/+]\d+)*/g)].map((m) => m[0]).sort().join("|");
// Benzerlik: kelime Jaccard (içe almada ≥ 0,6; tanımlama uyarısında ≥ 0,5) ve sayısal ölçüler aynı (4x10 ≠ 4x16; 6m ≠ 8m)
function benzerMi(a, b) {
  if (sayilar(a) !== sayilar(b)) return 0;
  const x = kelimeler(a), y = kelimeler(b);
  if (!x.size || !y.size) return 0;
  let ortak = 0; for (const w of x) if (y.has(w)) ortak++;
  return ortak / (x.size + y.size - ortak);
}
// Olası mükerrer için öneri (karar yine kullanıcının): yalnız yazım / dolgu kelimesi farkı → eşle; tip harfi, malzeme cinsi, yer, renk ya da
// başka bir anlamlı kelime farkı → ayrı kart. Yanlış birleştirme iki ürünün stoğunu karıştırır; şüphede ayrı kart önerilir.
const DOLGU = new Set(["VE", "İLE", "ILE", "ADET", "TEMİNİ", "TEMINI", "TEMİN", "MALZEME", "MALZEMESİ", "MALZEMESI", "TİP", "TİPİ", "TIPI", "TYPE", "AND", "WITH", "OF", "FOR", "THE", "SET", "TAKIM"]);
const tumKelimeler = (a) => new Set(normalAnahtar(a).split(" ").filter(Boolean).map((w) => w.replace(/^[.+/]+|[.+/]+$/g, "")).filter(Boolean));
function mukerrerOneri(ad, benzer) {
  const x = tumKelimeler(ad), y = tumKelimeler(benzer.ad);
  const fark = [...[...x].filter((w) => !y.has(w)), ...[...y].filter((w) => !x.has(w))].filter((w) => !DOLGU.has(w));
  const birimFarki = benzer.temel_birim && benzer.temel_birim !== benzer.aday_birim;
  if (!fark.length && !birimFarki) return benzer.id
    ? { karar: `esle:${benzer.id}`, neden: "Yalnız yazım farkı var; mevcut karta kaynak olarak bağlanır" }
    : { karar: "atla", neden: "Bu içe almadaki başka bir satırla aynı; ikinci kart açılmaz" };
  if (!fark.length) return { karar: "yeni", neden: `Ad aynı ama birim farklı (${benzer.aday_birim} / ${benzer.temel_birim}); ayrı kart` };
  const tipHarfi = fark.filter((w) => /^[A-ZÇĞİÖŞÜ]$/.test(w));
  return { karar: "yeni", neden: tipHarfi.length ? `Tip farkı (${tipHarfi.join(" / ")}); ayrı kart` : `Farklı kelime: ${fark.slice(0, 4).join(", ")}; ayrı kart` };
}
const birimCoz = (b) => { const s = UST(b).replace(/\s/g, ""); return BIRIMLER.find((x) => UST(x) === s) || BIRIM_ESLE[s] || null; };
// Belirsiz tanım: kablo / iletken için kesit ya da tip; pole / direk / ofset için ölçü ya da tip
function belirsizlik(ad, teknik) {
  const a = UST(ad), t = teknik || {};
  const olcu = /\d/.test(a);
  if (/KABLO|İLETKEN|CABLE/.test(a) && !/KABLO BAĞI|KANAL|TAVA|PENCERE/.test(a) && !olcu && !t.kesit && !t.kablo_tipi && !t.feeder_cap)
    return "Kablo için kesit (ör. 4x10 mm²) ya da kablo tipi (NYY, NYAF, XLPE…) girin";
  if (/POLE|DİREK|DİREĞ|OFSET|OFFSET/.test(a) && !olcu && !t.uzunluk_m && !t.tip) return "Pole / direk / ofset için boy ya da tip girin";
  if (a.replace(/[^A-ZÇĞİÖŞÜ]/g, "").length < 4) return "Malzeme adı ayırt edici değil";
  return null;
}

async function semaKur(pool) {
  const q = (s) => pool.query(s);
  for (const k of ["ad_en TEXT", "teknik JSONB NOT NULL DEFAULT '{}'", "uretici TEXT", "model TEXT", "urun_kodu TEXT", "normal_anahtar TEXT", "kaynak_ozet TEXT"])
    await q(`ALTER TABLE malzeme_urun ADD COLUMN IF NOT EXISTS ${k}`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS malzeme_urun_normal_uq ON malzeme_urun (normal_anahtar) WHERE normal_anahtar IS NOT NULL`);
  await q(`CREATE SEQUENCE IF NOT EXISTS malzeme_urun_kod_seq START 1`);
  await q(`CREATE TABLE IF NOT EXISTS malzeme_urun_kaynak (
    id SERIAL PRIMARY KEY, urun_id INTEGER NOT NULL REFERENCES malzeme_urun(id), kaynak_tip TEXT NOT NULL, kaynak_anahtar TEXT NOT NULL,
    boq_kod TEXT, boq_surum TEXT, iliski TEXT, dosya TEXT, sayfa TEXT, satir INTEGER, url TEXT, fiyat_listesi_id INTEGER, ham JSONB,
    olusturan TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS malzeme_urun_kaynak_uq ON malzeme_urun_kaynak (kaynak_tip, kaynak_anahtar)`);
  await q(`CREATE INDEX IF NOT EXISTS malzeme_urun_kaynak_boq_idx ON malzeme_urun_kaynak (boq_kod)`);
  await q(`CREATE TABLE IF NOT EXISTS malzeme_katalog_ice_alma (id SERIAL PRIMARY KEY, kaynak TEXT, ozet JSONB, olusturan TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
  // Talep: firma + geri alınabilir arşiv; numara sayacı (silinen numara tekrar kullanılmaz)
  for (const k of ["firma TEXT", "arsiv_tarihi TIMESTAMPTZ", "arsiv_parti INTEGER", "arsiv_neden TEXT"]) await q(`ALTER TABLE malzeme_talepler ADD COLUMN IF NOT EXISTS ${k}`);
  for (const t of ["malzeme_dagitim", "sarf_kullanim"]) for (const k of ["arsiv_tarihi TIMESTAMPTZ", "arsiv_parti INTEGER"]) await q(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS ${k}`);
  await q(`ALTER TABLE malzeme_talep_kalemleri ADD COLUMN IF NOT EXISTS yeni_malzeme_onerisi BOOLEAN NOT NULL DEFAULT false`);
  await q(`CREATE TABLE IF NOT EXISTS malzeme_arsiv_parti (id SERIAL PRIMARY KEY, aciklama TEXT, ozet JSONB, olusturan TEXT,
    created_at TIMESTAMPTZ DEFAULT now(), geri_alma_tarihi TIMESTAMPTZ, geri_alan TEXT)`);
  await q(`CREATE TABLE IF NOT EXISTS malzeme_talep_no_sayac (yil INTEGER PRIMARY KEY, son INTEGER NOT NULL)`);
  for (const t of ["malzeme_urun_kaynak", "malzeme_katalog_ice_alma", "malzeme_arsiv_parti", "malzeme_talep_no_sayac"])
    await q(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
}

// Talep numarası: yıl sayacı yalnız artar (arşivlenen / silinen numara yeniden verilmez). İlk kullanımda mevcut en büyük numaradan başlar.
async function talepNoAl(db, yil) {
  await db.query(`INSERT INTO malzeme_talep_no_sayac (yil, son)
    SELECT $1::int, COALESCE(MAX(NULLIF(substring(talep_no FROM '^MT-' || $2::text || '-(\\d+)$'), '')::int), 0) FROM malzeme_talepler WHERE talep_no LIKE 'MT-' || $2::text || '-%'
    ON CONFLICT (yil) DO NOTHING`, [Number(yil), String(yil)]);
  const r = await db.query(`UPDATE malzeme_talep_no_sayac SET son = son + 1 WHERE yil = $1 RETURNING son`, [Number(yil)]);
  return `MT-${yil}-${String(r.rows[0].son).padStart(3, "0")}`;
}

function kur(app, c) {
  const { pool, authMiddleware, taseronMu, malzemeDepoYetkili, malzemeYonetici, stokOnayYetkili, firmaKapsami, teknoSahaKapsami, stokSema } = c;
  let hazir = null;
  const sema = () => (hazir = hazir || (async () => { await stokSema(); await semaKur(pool); })().catch((e) => { hazir = null; throw e; }));
  sema().catch((e) => console.error("[malzeme-katalog şema]", e.message));
  const hata = (res, e) => {
    if (e && e.http) return res.status(e.http).json({ ok: false, error: e.message, ...(e.ek || {}) });
    if (e && e.code === "23505") return res.status(409).json({ ok: false, error: "Bu malzeme zaten kayıtlı (aynı ad)" });
    console.error("[malzeme-katalog]", e); return res.status(500).json({ ok: false, error: "İşlem yapılamadı: " + (e?.message || "") });
  };
  const H = (mesaj, http = 400, ek = null) => Object.assign(new Error(mesaj), { http, ek });
  const kapi = (kural) => (req, res, next) => authMiddleware(req, res, async () => {
    try {
      await sema();
      const u = req.user;
      if (taseronMu(u) || u.kullanici_tipi === "TASERON") return res.status(403).json({ ok: false, error: "Taşeron hesabı malzeme kataloğunu kullanamaz" });
      if (kural === "yaz" && !malzemeDepoYetkili(u)) return res.status(403).json({ ok: false, error: "Malzeme tanımlama yetkiniz yok — talebe 'katalogda yok' satırı ekleyip onaycının tanımlamasını isteyin" });
      if (kural === "onay" && !stokOnayYetkili(u)) return res.status(403).json({ ok: false, error: "Katalog içe alma yalnız yetkili yöneticiye açıktır" });
      next();
    } catch (e) { hata(res, e); }
  });

  // Fiyatsız kart görünümü (fiyat_listesi_id bile dönmez)
  const KART_SQL = `SELECT u.id, u.kod, u.ad, u.ad_en, u.kategori, u.temel_birim, u.tam_sayi, u.tur, u.teknik, u.uretici, u.model, u.urun_kodu, u.aktif,
      COALESCE((SELECT json_agg(DISTINCT jsonb_build_object('kod', k.boq_kod, 'surum', k.boq_surum, 'iliski', k.iliski)) FROM malzeme_urun_kaynak k WHERE k.urun_id = u.id AND k.boq_kod IS NOT NULL), '[]') AS boq,
      COALESCE((SELECT json_agg(json_build_object('birim', b.birim, 'katsayi', b.katsayi)) FROM malzeme_urun_birim b WHERE b.urun_id = u.id), '[]') AS donusumler
    FROM malzeme_urun u`;
  const kartTemizle = (r) => ({ ...r, donusumler: (r.donusumler || []).map((d) => ({ ...d, katsayi: Number(d.katsayi) })),
    teknik_metin: Object.entries(r.teknik || {}).map(([k, v]) => `${TEKNIK_ETIKET[k] || k}: ${v}`).join(" · ") });

  app.get("/malzeme/katalog/kategoriler", kapi(null), async (req, res) => {
    try {
      const r = await pool.query(`SELECT COALESCE(kategori,'Genel') AS kategori, COUNT(*)::int AS adet FROM malzeme_urun WHERE aktif GROUP BY 1 ORDER BY 1`);
      const say = Object.fromEntries(r.rows.map((x) => [x.kategori, x.adet]));
      res.json({ ok: true, kategoriler: [...new Set([...KATEGORILER, ...Object.keys(say)])].map((k) => ({ kategori: k, adet: say[k] || 0 })), birimler: BIRIMLER, teknik_alanlar: TEKNIK_ETIKET });
    } catch (e) { hata(res, e); }
  });

  // Arama: ad / İngilizce ad / kod / teknik özellik / BoQ kodu; kategori filtresi. Fiyat dönmez.
  app.get("/malzeme/katalog", kapi(null), async (req, res) => {
    try {
      const qq = metin(req.query.q, 80), kat = metin(req.query.kategori, 80);
      const p = [], w = [req.query.pasif === "1" ? "TRUE" : "u.aktif"];
      if (kat) { p.push(kat); w.push(`COALESCE(u.kategori,'Genel') = $${p.length}`); }
      for (const parca of qq.split(/\s+/).filter(Boolean).slice(0, 6)) {
        p.push(`%${parca.toLocaleUpperCase("tr")}%`);
        const i = `$${p.length}`;
        w.push(`(UPPER(u.ad) LIKE ${i} OR UPPER(COALESCE(u.ad_en,'')) LIKE ${i} OR UPPER(u.kod) LIKE ${i} OR UPPER(u.teknik::text) LIKE ${i}
          OR UPPER(COALESCE(u.uretici,'') || ' ' || COALESCE(u.model,'') || ' ' || COALESCE(u.urun_kodu,'')) LIKE ${i}
          OR EXISTS (SELECT 1 FROM malzeme_urun_kaynak k WHERE k.urun_id = u.id AND k.boq_kod LIKE ${i}))`);
      }
      const lim = Math.min(Math.max(Number(req.query.limit) || 60, 1), 300);
      const r = await pool.query(`${KART_SQL} WHERE ${w.join(" AND ")} ORDER BY (UPPER(u.ad) LIKE $${p.length + 1}) DESC, u.kategori, u.ad LIMIT ${lim}`,
        [...p, `${qq.toLocaleUpperCase("tr")}%`]);
      res.json({ ok: true, rows: r.rows.map(kartTemizle), bulunamadi: r.rows.length === 0 });
    } catch (e) { hata(res, e); }
  });

  async function benzerler(db, ad, haric = null) {
    const r = await db.query(`SELECT id, kod, ad, temel_birim, kategori, teknik FROM malzeme_urun`);
    return r.rows.filter((x) => x.id !== haric).map((x) => ({ ...x, skor: benzerMi(ad, x.ad) })).filter((x) => x.skor >= 0.5)
      .sort((a, b) => b.skor - a.skor).slice(0, 8).map((x) => ({ id: x.id, kod: x.kod, ad: x.ad, temel_birim: x.temel_birim, kategori: x.kategori, benzerlik: Math.round(x.skor * 100) }));
  }
  app.get("/malzeme/katalog/benzer", kapi(null), async (req, res) => {
    try {
      const ad = metin(req.query.ad, 200);
      const tam = ad ? (await pool.query(`SELECT id, kod, ad FROM malzeme_urun WHERE normal_anahtar = $1 OR UPPER(ad) = $2`, [normalAnahtar(ad), UST(ad)])).rows : [];
      res.json({ ok: true, ayni: tam, benzer: ad ? await benzerler(pool, ad) : [] });
    } catch (e) { hata(res, e); }
  });

  async function kartEkle(db, b, email) {
    const ad = metin(b.ad, 200);
    if (!ad) throw H("Malzeme adı zorunlu");
    const birim = birimCoz(b.temel_birim || b.birim);
    if (!birim) throw H(`Birim seçin (${BIRIMLER.join(", ")})`);
    const kategori = metin(b.kategori, 80) || "Genel";
    const teknik = {};
    for (const [k, v] of Object.entries(b.teknik || {})) if (k in TEKNIK_ETIKET && metin(v, 60)) teknik[k] = metin(v, 60);
    const bel = b.belirsiz_onay ? null : belirsizlik(ad, teknik);
    if (bel) throw H(bel, 400, { alan: "teknik" });
    const r = await db.query(`INSERT INTO malzeme_urun (kod, ad, ad_en, temel_birim, tam_sayi, tur, kategori, teknik, uretici, model, urun_kodu, normal_anahtar, kaynak_ozet, olusturan)
      VALUES ('MLZ-' || lpad(nextval('malzeme_urun_kod_seq')::text, 6, '0'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [ad, metin(b.ad_en, 200) || null, birim, ["Adet", "Kutu", "Paket", "Rulo", "Takım", "Top", "Çift"].includes(birim), String(b.tur || "SARF").toUpperCase() === "EKIPMAN" ? "EKIPMAN" : "SARF",
        kategori, JSON.stringify(teknik), metin(b.uretici, 100) || null, metin(b.model, 100) || null, metin(b.urun_kodu, 100) || null, normalAnahtar(ad),
        metin(b.kaynak_ozet, 300) || null, email]);
    return r.rows[0];
  }
  async function kaynakEkle(db, urunId, k, email) {
    const r = await db.query(`INSERT INTO malzeme_urun_kaynak (urun_id, kaynak_tip, kaynak_anahtar, boq_kod, boq_surum, iliski, dosya, sayfa, satir, url, fiyat_listesi_id, ham, olusturan)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (kaynak_tip, kaynak_anahtar) DO NOTHING RETURNING id`,
      [urunId, k.kaynak_tip, k.kaynak_anahtar, k.boq_kod || null, k.boq_surum || null, k.iliski || null, k.dosya || null, k.sayfa || null, k.satir || null,
        k.url || null, k.fiyat_listesi_id || null, k.ham ? JSON.stringify(k.ham) : null, email]);
    return r.rows.length > 0;
  }

  // Yeni malzeme tanımlama (yetkili). Benzer kayıt varsa önce kullanıcıya gösterilir (benzer_onay:true ile kaydedilir).
  app.post("/malzeme/katalog", kapi("yaz"), async (req, res) => {
    const client = await pool.connect();
    try {
      const b = req.body || {};
      const ad = metin(b.ad, 200);
      if (!ad) throw H("Malzeme adı zorunlu");
      const ayni = (await client.query(`SELECT id, kod, ad, temel_birim FROM malzeme_urun WHERE normal_anahtar = $1 OR UPPER(ad) = $2`, [normalAnahtar(ad), UST(ad)])).rows;
      if (ayni.length) throw H("Bu malzeme zaten kayıtlı", 409, { mevcut: ayni[0] });
      const benzer = await benzerler(client, ad);
      if (benzer.length && b.benzer_onay !== true) throw H("Bu malzeme zaten kayıtlı olabilir. Benzer kayıtları kontrol edin; farklıysa onaylayarak kaydedin.", 409, { benzerler: benzer });
      await client.query("BEGIN");
      const kart = await kartEkle(client, b, req.user.email);
      if (b.kaynak_url || b.kaynak_ozet) await kaynakEkle(client, kart.id, { kaynak_tip: b.kaynak_url ? "URETICI" : "ELLE", kaynak_anahtar: `${b.kaynak_url ? "URL" : "ELLE"}:${kart.id}`, url: metin(b.kaynak_url, 500) || null, ham: { not: metin(b.kaynak_ozet, 300) } }, req.user.email);
      await client.query("COMMIT");
      const r = await pool.query(`${KART_SQL} WHERE u.id = $1`, [kart.id]);
      res.json({ ok: true, urun: kartTemizle(r.rows[0]) });
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); if (e.code === "23505") { const m = (await pool.query(`SELECT id, kod, ad, temel_birim FROM malzeme_urun WHERE normal_anahtar = $1`, [normalAnahtar(req.body?.ad)])).rows[0]; return res.status(409).json({ ok: false, error: "Bu malzeme az önce başka biri tarafından kaydedildi", mevcut: m || null }); } hata(res, e); }
    finally { client.release(); }
  });

  // Kart bilgisi düzenleme (ad, İngilizce ad, kategori, teknik, üretici, aktiflik). Birim stok defteri kuralıyla değişir (hareket varsa değişmez).
  app.put("/malzeme/katalog/:id", kapi("yaz"), async (req, res) => {
    try {
      const b = req.body || {};
      const u = (await pool.query(`SELECT * FROM malzeme_urun WHERE id = $1`, [Number(req.params.id)])).rows[0];
      if (!u) throw H("Malzeme bulunamadı", 404);
      const ad = b.ad !== undefined ? metin(b.ad, 200) : u.ad;
      if (!ad) throw H("Malzeme adı zorunlu");
      const teknik = { ...(u.teknik || {}) };
      if (b.teknik) for (const [k, v] of Object.entries(b.teknik)) if (k in TEKNIK_ETIKET) { if (metin(v, 60)) teknik[k] = metin(v, 60); else delete teknik[k]; }
      await pool.query(`UPDATE malzeme_urun SET ad = $2, ad_en = $3, kategori = $4, teknik = $5, uretici = $6, model = $7, urun_kodu = $8, aktif = $9, normal_anahtar = $10, updated_at = now() WHERE id = $1`,
        [u.id, ad, b.ad_en !== undefined ? metin(b.ad_en, 200) || null : u.ad_en, b.kategori !== undefined ? metin(b.kategori, 80) || "Genel" : u.kategori, JSON.stringify(teknik),
          b.uretici !== undefined ? metin(b.uretici, 100) || null : u.uretici, b.model !== undefined ? metin(b.model, 100) || null : u.model,
          b.urun_kodu !== undefined ? metin(b.urun_kodu, 100) || null : u.urun_kodu, typeof b.aktif === "boolean" ? b.aktif : u.aktif, normalAnahtar(ad)]);
      const r = await pool.query(`${KART_SQL} WHERE u.id = $1`, [u.id]);
      res.json({ ok: true, urun: kartTemizle(r.rows[0]) });
    } catch (e) { hata(res, e); }
  });

  // ── İçe alma: adaylar (BoQ betiğinin çıktısı) ya da mevcut adlar (fiyat listesi, eski depo, talep kalemleri) ─────────────
  async function mevcutAdaylar(db) {
    const out = [];
    const fl = await db.query(`SELECT id, malzeme_adi, birim, kategori FROM malzeme_fiyat_listesi ORDER BY id`).catch(() => ({ rows: [] }));
    for (const r of fl.rows) out.push({ ad: metin(r.malzeme_adi, 200), temel_birim: birimCoz(r.birim), birim_ham: r.birim, kategori: r.kategori && r.kategori !== "Genel" ? r.kategori : null,
      kaynaklar: [{ kaynak_tip: "MEVCUT_FIYAT_LISTESI", kaynak_anahtar: `FL:${r.id}`, fiyat_listesi_id: r.id }] });
    const ds = await db.query(`SELECT id, malzeme_adi, birim FROM depo_stok ORDER BY id`).catch(() => ({ rows: [] }));
    for (const r of ds.rows) out.push({ ad: metin(r.malzeme_adi, 200), temel_birim: birimCoz(r.birim), birim_ham: r.birim, kaynaklar: [{ kaynak_tip: "MEVCUT_DEPO", kaynak_anahtar: `DS:${r.id}` }] });
    const tk = await db.query(`SELECT MIN(id) AS id, TRIM(malzeme_adi) AS ad, MIN(birim) AS birim FROM malzeme_talep_kalemleri WHERE TRIM(COALESCE(malzeme_adi,'')) <> '' GROUP BY TRIM(malzeme_adi)`).catch(() => ({ rows: [] }));
    for (const r of tk.rows) out.push({ ad: metin(r.ad, 200), temel_birim: birimCoz(r.birim), birim_ham: r.birim, kaynaklar: [{ kaynak_tip: "MEVCUT_TALEP_KALEMI", kaynak_anahtar: `TK:${normalAnahtar(r.ad)}` }] });
    return out;
  }
  function bogAdaylari(liste) {
    return (Array.isArray(liste) ? liste : []).slice(0, 3000).map((a) => ({ ad: metin(a.ad, 200), ad_en: metin(a.ad_en, 200) || null, kategori: metin(a.kategori, 80) || null,
      temel_birim: birimCoz(a.temel_birim), birim_ham: a.temel_birim, teknik: a.teknik || {}, durum_kaynak: a.durum, uyarilar: a.uyarilar || [],
      kaynaklar: (a.kaynaklar || []).map((k) => ({ kaynak_tip: "BOQ", kaynak_anahtar: `${k.surum}:${k.boq_kod || k.boq_kod_ham}:${k.sayfa}:${k.satir}`, boq_kod: k.boq_kod || null,
        boq_surum: k.surum, iliski: k.iliski, dosya: k.dosya, sayfa: k.sayfa, satir: k.satir, ham: { tr: k.tr, en: k.en, birim: k.birim_ham, boq_kod_ham: k.boq_kod_ham } })) }));
  }
  // Sınıflandırma: ZATEN_ALINDI / ESLESEN / OLASI_MUKERRER / EKSIK_BIRIM / DOGRULANAMADI / YENI
  async function siniflandir(db, adaylar) {
    const mevcut = (await db.query(`SELECT id, kod, ad, temel_birim, normal_anahtar FROM malzeme_urun`)).rows;
    const anahtarlar = new Map(mevcut.map((m) => [m.normal_anahtar || normalAnahtar(m.ad), m]));
    const alinan = new Set((await db.query(`SELECT kaynak_tip || '|' || kaynak_anahtar AS k FROM malzeme_urun_kaynak`)).rows.map((r) => r.k));
    const buTur = new Map(); // aynı içe almada aynı ad → tek kart, kaynakları birleşir
    const sonuc = [];
    for (const a of adaylar) {
      if (!a.ad) continue;
      const na = normalAnahtar(a.ad);
      const yeniKaynak = a.kaynaklar.filter((k) => !alinan.has(`${k.kaynak_tip}|${k.kaynak_anahtar}`));
      const s = { anahtar: na, ad: a.ad, ad_en: a.ad_en || null, kategori: a.kategori || "Genel", temel_birim: a.temel_birim, birim_ham: a.birim_ham, teknik: a.teknik || {},
        kaynak_sayisi: a.kaynaklar.length, kaynaklar: yeniKaynak, uyarilar: [...(a.uyarilar || [])] };
      if (!yeniKaynak.length) { s.durum = "ZATEN_ALINDI"; sonuc.push(s); continue; }
      const es = anahtarlar.get(na);
      if (es) { s.durum = "ESLESEN"; s.eslesen = { id: es.id, kod: es.kod, ad: es.ad, temel_birim: es.temel_birim };
        if (a.temel_birim && es.temel_birim !== a.temel_birim) s.uyarilar.push(`Birim farklı: kaynak ${a.birim_ham || a.temel_birim}, katalog ${es.temel_birim} — kart birimi değişmez`); sonuc.push(s); continue; }
      const onceki = buTur.get(na);
      if (onceki) { onceki.kaynaklar.push(...yeniKaynak); onceki.kaynak_sayisi += a.kaynaklar.length;
        if (a.temel_birim && onceki.temel_birim && a.temel_birim !== onceki.temel_birim) onceki.uyarilar.push(`Aynı ad farklı birimle geçiyor: ${a.birim_ham}`); continue; }
      if (!a.temel_birim) { s.durum = "EKSIK_BIRIM"; s.uyarilar.push(`Birim çözülemedi: ${a.birim_ham || "(boş)"}`); sonuc.push(s); buTur.set(na, s); continue; }
      if (a.durum_kaynak === "DOGRULANAMADI") { s.durum = "DOGRULANAMADI"; sonuc.push(s); buTur.set(na, s); continue; }
      const adayBenzer = mevcut.map((m) => ({ m, skor: benzerMi(a.ad, m.ad) })).filter((x) => x.skor >= 0.6).sort((x, y) => y.skor - x.skor)[0]
        || [...buTur.values()].filter((x) => x.durum === "YENI").map((x) => ({ m: { id: null, kod: "(bu içe almada)", ad: x.ad, temel_birim: x.temel_birim }, skor: benzerMi(a.ad, x.ad) })).filter((x) => x.skor >= 0.6).sort((x, y) => y.skor - x.skor)[0];
      if (adayBenzer) { s.durum = "OLASI_MUKERRER"; s.benzer = { id: adayBenzer.m.id, kod: adayBenzer.m.kod, ad: adayBenzer.m.ad, temel_birim: adayBenzer.m.temel_birim, benzerlik: Math.round(adayBenzer.skor * 100) };
        s.oneri = mukerrerOneri(a.ad, { ...s.benzer, aday_birim: a.temel_birim }); sonuc.push(s); buTur.set(na, s); continue; }
      s.durum = "YENI"; sonuc.push(s); buTur.set(na, s);
    }
    return sonuc;
  }
  const ozetle = (s, haric) => {
    const say = (d) => s.filter((x) => x.durum === d).length;
    return { okunan: s.reduce((t, x) => t + x.kaynak_sayisi, 0) + (haric?.length || 0), aday_kart: s.length, yeni: say("YENI"), eslesen: say("ESLESEN"), olasi_mukerrer: say("OLASI_MUKERRER"),
      eksik_birim: say("EKSIK_BIRIM"), dogrulanamadi: say("DOGRULANAMADI"), zaten_alindi: say("ZATEN_ALINDI"),
      haric_hizmet: (haric || []).filter((h) => h.neden === "HIZMET").length, haric_paket: (haric || []).filter((h) => String(h.neden).startsWith("PAKET")).length,
      haric_hizmet_agirlikli: (haric || []).filter((h) => String(h.neden).startsWith("HİZMET AĞ")).length };
  };
  // kararlar: { [anahtar]: "yeni" | "esle:<urun_id>" | "atla" } — yalnız OLASI_MUKERRER / DOGRULANAMADI için; diğerleri kurala göre
  app.post("/malzeme/katalog/ice-al", kapi("onay"), async (req, res) => {
    const client = await pool.connect();
    try {
      const b = req.body || {};
      const kaynak = b.kaynak === "mevcut" ? "mevcut" : "boq";
      const adaylar = kaynak === "mevcut" ? await mevcutAdaylar(client) : bogAdaylari(b.adaylar);
      if (!adaylar.length) throw H("İçe alınacak aday yok");
      const haric = kaynak === "boq" && Array.isArray(b.haric) ? b.haric : [];
      if (b.uygula !== true) {
        const s = await siniflandir(client, adaylar);
        return res.json({ ok: true, onizleme: true, kaynak, ozet: ozetle(s, haric), satirlar: s.map((x) => ({ ...x, kaynaklar: x.kaynaklar.map((k) => ({ tip: k.kaynak_tip, boq_kod: k.boq_kod, surum: k.boq_surum, iliski: k.iliski, yer: k.sayfa ? `${k.sayfa} s.${k.satir}` : k.kaynak_anahtar })) })) });
      }
      await client.query("BEGIN");
      await client.query(`LOCK TABLE malzeme_urun_kaynak IN SHARE ROW EXCLUSIVE MODE`); // eşzamanlı iki içe alma aynı kaynağı iki kez işlemesin
      const s = await siniflandir(client, adaylar);
      const kararlar = b.kararlar || {};
      const sayac = { yeni_kart: 0, kaynak_baglandi: 0, atlandi: 0 };
      for (const x of s) {
        let hedef = null;
        if (x.durum === "ZATEN_ALINDI" || x.durum === "EKSIK_BIRIM") { sayac.atlandi++; continue; }
        if (x.durum === "ESLESEN") hedef = x.eslesen.id;
        else if (x.durum === "YENI") hedef = (await kartEkle(client, { ad: x.ad, ad_en: x.ad_en, temel_birim: x.temel_birim, kategori: x.kategori, teknik: x.teknik, belirsiz_onay: true,
          kaynak_ozet: kaynak === "mevcut" ? "Mevcut malzeme adı" : `BoQ ${[...new Set(x.kaynaklar.map((k) => k.boq_surum))].join(", ")}` }, req.user.email)).id, sayac.yeni_kart++;
        else {
          const k = String(kararlar[x.anahtar] || "atla");
          if (k === "yeni") { hedef = (await kartEkle(client, { ad: x.ad, ad_en: x.ad_en, temel_birim: x.temel_birim, kategori: x.kategori, teknik: x.teknik, belirsiz_onay: true }, req.user.email)).id; sayac.yeni_kart++; }
          else if (/^esle:\d+$/.test(k)) hedef = Number(k.slice(5));
          else { sayac.atlandi++; continue; }
        }
        for (const kk of x.kaynaklar) if (await kaynakEkle(client, hedef, kk, req.user.email)) sayac.kaynak_baglandi++;
      }
      const oz = { ...ozetle(s, haric), ...sayac };
      await client.query(`INSERT INTO malzeme_katalog_ice_alma (kaynak, ozet, olusturan) VALUES ($1,$2,$3)`, [kaynak, JSON.stringify(oz), req.user.email]);
      await client.query("COMMIT");
      res.json({ ok: true, uygulandi: true, ozet: oz });
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); hata(res, e); }
    finally { client.release(); }
  });

  // ── Teknocenter saha / iş seçimi: tam iş kodu (site_code) + Teknocenter'ın o işteki iş kolları ────────────────────
  app.get("/malzeme/tekno-sahalar", kapi(null), async (req, res) => {
    try {
      const K = await teknoSahaKapsami();
      if (!K) return res.json({ ok: true, rows: [] });
      const q = String(req.query.q || "").replace(/\s+/g, "").toUpperCase().slice(0, 40);
      const p = [`%${q}%`, ...K.params];
      const r = await pool.query(`SELECT r.site_code, r.project_code, r.bolge, r.il, r.site_type, to_jsonb(r) AS ham FROM rollout_progress r
        WHERE UPPER(REPLACE(TRIM(r.site_code),' ','')) LIKE $1 AND ${K.sql("r", 2)} ORDER BY r.site_code LIMIT 40`, p);
      const mw = r.rows.length ? (await pool.query(`SELECT UPPER(TRIM(site_code)) AS sc, COUNT(*)::int AS kalem FROM master_works
        WHERE UPPER(TRIM(site_code)) = ANY($1::text[]) AND UPPER(TRIM(COALESCE(subcon_name,''))) ~ $2 GROUP BY 1`, [r.rows.map((x) => String(x.site_code).trim().toUpperCase()), K.params[0]]).catch(() => ({ rows: [] }))).rows : [];
      const mwm = new Map(mw.map((x) => [x.sc, x.kalem]));
      const ALAN = { rf_subcon: "RF montaj", los_subcon: "LOS", tss_subcon: "TSS", tssr_subcon: "TSSR", btk_subcon: "BTK", trs_subcon: "TRS", enh_subcon: "Enerji",
        enh_proje_subcon: "Enerji proje", power_subcon: "Power", emr_subcon: "EMR", pac_subcon: "PAC", ysb_subcon: "YSB" };
      res.json({ ok: true, rows: r.rows.map((x) => {
        const isler = Object.entries(ALAN).filter(([k]) => K.esle(x.ham?.[k])).map(([, v]) => v);
        const kalem = mwm.get(String(x.site_code).trim().toUpperCase()) || 0;
        return { site_code: x.site_code, project_code: x.project_code, bolge: x.bolge, il: x.il, site_type: x.site_type,
          tekno_isleri: [...isler, ...(kalem ? [`Günlük iş kalemi (${kalem})`] : [])] };
      }) });
    } catch (e) { hata(res, e); }
  });

  return { talepNoAl: (db, yil) => talepNoAl(db, yil), sema, normalAnahtar, birimCoz };
}

module.exports = { kur, semaKur, normalAnahtar, benzerMi, mukerrerOneri, belirsizlik, BIRIMLER, KATEGORILER };
