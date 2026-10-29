// ═══ OMNIX KULLANICI PROFİLLERİ: ŞİRKET YÖNETİMİ + TAŞERON FİRMA (25.10.2026, Orhan) ════════════════════════
// Tek Omnix uygulamasında, doğrulanmış hesaba göre üç deneyim: şirket personeli, şirket sahibi / yönetici, dış taşeron.
// Veri kaynağı mevcut tablolar (is_atama, master_works, rollout_progress, invoice_entries, fatura_saha_kalem,
// bolge_fatura, taseron_odeme_log, personel, puantaj…); yeni bağımsız veri tabanı yok.
//
// Kimlik kuralları (isim benzerliği / "içerir" araması YOK):
//   users.kullanici_tipi  'IC' (şirket içi) | 'TASERON' (dış taşeron firma kullanıcısı) | NULL (eski hesap — davranış değişmez)
//   users.taseron_id      subcons.id — taşeronun kalıcı kimliği (aynı taşerona birden çok kullanıcı bağlanabilir)
//   users.marka           bağlı (ana) firma kodu — markalar.kod
//   users.yonetim_profili 'PERSONEL' | 'YONETICI' | 'SAHIP' (yalnız şirket içi; kendi firma kapsamında)
//   subcon_takma_ad       taşeronun kayıtlardaki diğer yazımları — TAM eşleşme (UPPER/TRIM), elle eklenir
//   is_atama.taseron_id   işin atandığı taşeron; is_atama_fiyat: atama anındaki anlaşılmış fiyat, sürümlü (revizyon nedeni + yapan)
// Taşerona Huawei satış fiyatı, şirket kârı ya da başka taşeronun fiyatı hiçbir uçtan gönderilmez.

const BIRIM_PARA = ["TRY", "USD", "EUR"];
const KDV_ESAS = ["HARIC", "DAHIL"];
const PROFILLER = ["PERSONEL", "YONETICI", "SAHIP"];
const TIPLER = ["IC", "TASERON"];
const yuvarla = (n) => Math.round(Number(n || 0) * 100) / 100;
const buyuk = (s) => String(s || "").trim().toLocaleUpperCase("tr-TR");
const sahaTemiz = (s) => String(s || "").replace(/\s+/g, "").toUpperCase();
const sadeAd = (s) => String(s || "").trim().replace(/[İIı]/g, "i").toLowerCase().replace(/[ş]/g, "s").replace(/[ğ]/g, "g").replace(/[ü]/g, "u").replace(/[ö]/g, "o").replace(/[ç]/g, "c");

async function semaKur(pool) {
  const q = (s) => pool.query(s).catch((e) => console.error("[omnix-profil şema]", e.message));
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kullanici_tipi TEXT`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS taseron_id INTEGER`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS yonetim_profili TEXT`);
  await q(`CREATE TABLE IF NOT EXISTS subcons (id SERIAL PRIMARY KEY, subcon_name TEXT UNIQUE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await q(`ALTER TABLE subcons ADD COLUMN IF NOT EXISTS unvan TEXT`);
  await q(`ALTER TABLE subcons ADD COLUMN IF NOT EXISTS ana_firma TEXT`);
  await q(`ALTER TABLE subcons ADD COLUMN IF NOT EXISTS aktif BOOLEAN DEFAULT true`);
  await q(`CREATE TABLE IF NOT EXISTS subcon_takma_ad (
    id SERIAL PRIMARY KEY, subcon_id INTEGER NOT NULL REFERENCES subcons(id) ON DELETE CASCADE,
    ad TEXT NOT NULL, ekleyen TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS subcon_takma_ad_ad_uq ON subcon_takma_ad (UPPER(TRIM(ad)))`);
  await q(`ALTER TABLE is_atama ADD COLUMN IF NOT EXISTS taseron_id INTEGER`);
  await q(`CREATE TABLE IF NOT EXISTS is_atama_fiyat (
    id SERIAL PRIMARY KEY, is_atama_id INTEGER NOT NULL, surum INTEGER NOT NULL, taseron_id INTEGER NOT NULL,
    kalemler JSONB NOT NULL, para_birimi TEXT NOT NULL, kdv_esasi TEXT NOT NULL, toplam NUMERIC NOT NULL,
    neden TEXT, olusturan TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (is_atama_id, surum))`);
  await q(`CREATE INDEX IF NOT EXISTS is_atama_taseron_idx ON is_atama (taseron_id)`);
}

// Kullanıcının profil alanları (to_jsonb: kolon henüz yoksa hata vermez, boş döner)
async function profilOku(pool, userId) {
  if (!userId) return { kullanici_tipi: null, taseron_id: null, yonetim_profili: null };
  const r = await pool.query(`SELECT to_jsonb(u)->>'kullanici_tipi' AS kullanici_tipi, (to_jsonb(u)->>'taseron_id')::int AS taseron_id,
      to_jsonb(u)->>'yonetim_profili' AS yonetim_profili, u.marka, u.role FROM users u WHERE u.id = $1`, [Number(userId)]);
  return r.rows[0] || { kullanici_tipi: null, taseron_id: null, yonetim_profili: null };
}

async function taseronBilgi(pool, id) {
  if (!id) return null;
  const r = await pool.query(`SELECT id, subcon_name, unvan, ana_firma, COALESCE(aktif, true) AS aktif FROM subcons WHERE id = $1`, [Number(id)]);
  return r.rows[0] || null;
}

// Taşeronun kayıtlarda geçen adları: ana ad + elle eklenmiş takma adlar (tam eşleşme için UPPER/TRIM)
async function taseronAdlari(pool, id) {
  const r = await pool.query(`SELECT UPPER(TRIM(subcon_name)) AS ad FROM subcons WHERE id = $1
    UNION SELECT UPPER(TRIM(ad)) FROM subcon_takma_ad WHERE subcon_id = $1`, [Number(id)]);
  return r.rows.map((x) => x.ad).filter(Boolean);
}

function kur(app, c) {
  // PM_KISISEL_EMAIL server.js'te bu modülden sonra tanımlı: istek anında c üzerinden okunur
  const { pool, authMiddleware, markaProfil, altMarkaKullanicisi, islemGecmisiYaz, isAtamaYetkiliMi, personelHesapEkstresi, pmKisiselEmailGorur } = c;
  const taseronSuz = async (req) => (c.taseronFirmaSuzgeci ? await c.taseronFirmaSuzgeci(req) : null);
  const hata = (res, kod, mesaj) => res.status(kod).json({ ok: false, error: mesaj });

  // ── TAŞERON KAPSAMI ──────────────────────────────────────────────────────────────────────────────
  // Taşeron paneli yalnız kullanici_tipi='TASERON' + geçerli taseron_id hesabına açılır. Bağlantı eksikse
  // "tüm veriler" varsayılanı YOK: 403. Ana firma: taşeron kaydı bir ana firmaya bağlıysa hesabın firması aynı olmalı.
  async function taseronKapsami(req) {
    const u = req.user;
    if (!u?.user_id && !u?.email) return { kod: 401, mesaj: "Oturum gerekli" };
    const p = await profilOku(pool, u.user_id);
    if (p.kullanici_tipi !== "TASERON") return { kod: 403, mesaj: "Bu bölüm yalnız taşeron firma hesaplarına açık" };
    if (!p.taseron_id) return { kod: 403, mesaj: "Hesabınız bir taşeron firmaya bağlı değil. Lütfen yöneticinizle görüşün." };
    const t = await taseronBilgi(pool, p.taseron_id);
    if (!t || !t.aktif) return { kod: 403, mesaj: "Bağlı olduğunuz taşeron kaydı pasif ya da bulunamadı" };
    const anaFirma = String(p.marka || u.marka || "ERC").toUpperCase();
    if (t.ana_firma && String(t.ana_firma).toUpperCase() !== anaFirma) return { kod: 403, mesaj: "Hesabınızın firma kapsamı taşeron kaydıyla uyuşmuyor" };
    const adlar = await taseronAdlari(pool, t.id);
    return { taseron: t, adlar, anaFirma };
  }
  const taseronKapisi = (fn) => [authMiddleware, async (req, res) => {
    try {
      const k = await taseronKapsami(req);
      if (k.kod) return hata(res, k.kod, k.mesaj);
      return await fn(req, res, k);
    } catch (e) { console.error("[taseron-panel]", e.message); return hata(res, 500, "Bilgiler alınamadı"); }
  }];

  async function anaFirmaAd(kod) {
    const r = await pool.query(`SELECT ad FROM markalar WHERE kod = $1 LIMIT 1`, [kod]).catch(() => ({ rows: [] }));
    return r.rows[0]?.ad || kod;
  }

  // Atamanın geçerli (son) fiyat sürümü; yalnız bu taşerona ait olanı
  async function guncelFiyat(isId, taseronId) {
    const r = await pool.query(`SELECT * FROM is_atama_fiyat WHERE is_atama_id = $1 AND taseron_id = $2 ORDER BY surum DESC LIMIT 1`, [isId, taseronId]);
    return r.rows[0] || null;
  }
  const fiyatGorunum = (f) => f ? {
    surum: f.surum, para_birimi: f.para_birimi, kdv_esasi: f.kdv_esasi, toplam: Number(f.toplam),
    kalemler: (f.kalemler || []).map((k) => ({ kalem_kodu: k.kalem_kodu || null, aciklama: k.aciklama, miktar: Number(k.miktar), birim: k.birim,
      birim_fiyat: Number(k.birim_fiyat), tutar: yuvarla(Number(k.miktar) * Number(k.birim_fiyat)) })),
    tarih: f.created_at, neden: f.neden || null,
  } : null;

  // Belge alanları (saha belgeleri): yalnız taşeronun kendi işine ait sahalar için, sunucu doğrulamasından sonra
  // Taşerona açık belge türleri: teknik saha belgeleri. Kabul, memnuniyet, perakende sözleşme/dekont gibi müşteri ve ödeme belgeleri verilmez.
  const TASERON_BELGE_ALANLARI = ["tssr_belge_url", "los_belge_url", "btk_belge_url", "emr_belge_url", "ysb_belge_url", "enh_proje_belge_url", "fsc_belge_url"];
  async function sahaBelgeleri(siteCodes) {
    if (!siteCodes?.length) return [];
    const alanlar = TASERON_BELGE_ALANLARI;
    const r = await pool.query(`SELECT UPPER(TRIM(site_code)) AS site_code, ${alanlar.map((a) => `to_jsonb(rp)->>'${a}' AS "${a}"`).join(", ")}
      FROM rollout_progress rp WHERE UPPER(TRIM(site_code)) = ANY($1::text[])`, [siteCodes]).catch(() => ({ rows: [] }));
    const out = [];
    for (const row of r.rows) for (const a of alanlar) {
      const urls = String(row[a] || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
      urls.forEach((url, i) => out.push({ site_code: row.site_code, alan: a, sira: i, etiket: belgeEtiketi(a), url }));
    }
    return out;
  }
  const belgeEtiketi = (a) => ({ tssr_belge_url: "TSSR", los_belge_url: "LOS", btk_belge_url: "BTK", emr_belge_url: "EMR", ysb_belge_url: "YSB",
    pac_belge_url: "PAC", enh_proje_belge_url: "Enerji projesi", kabul_dosya_url: "Kabul dosyası", hasarsizlik_belge_url: "Hasarsızlık",
    memnuniyet_belge_url: "Memnuniyet", fsc_belge_url: "FSC" }[a] || a.replace(/_url$/, "").replace(/_/g, " "));

  // ── HAKEDİŞ SATIRLARI ────────────────────────────────────────────────────────────────────────────
  // Yeni hesap kuralı icat edilmez: bedel = atamadaki ANLAŞILMIŞ birim fiyat × hakedişe esas miktar.
  //  • Kalem kodu varsa miktar ve QC mevcut kayıttan (master_works: COALESCE(tamamlanan_qty, done_qty), qc_durum —
  //    /finance/subcon-paket-bedel ile aynı: yalnız QC 'OK' faturalanabilir). Kayıt yoksa "miktar bekleniyor" (toplama girmez).
  //  • Paket kalem (kalem kodu yok): iş TAMAMLANDI ise anlaşılan miktar; QC sahanın Rollout QC durumundan.
  //  • İptal edilen iş hakedişe girmez; aynı saha + kalem iki işte geçerse ikinci satır "mükerrer" işaretlenir, toplanmaz.
  //  • Faturalandı mı: bu taşeronun bölge faturası (bolge_fatura) ya da faturasına bağlı saha kalemi (fatura_saha_kalem) varsa.
  //  • Para birimleri ayrı toplanır.
  async function hakedisSatirlari(k) {
    const isler = (await pool.query(`SELECT a.id, a.site_codes, a.durum, a.kategori, a.bitis_ts, a.updated_at, kt.ad AS kategori_ad
      FROM is_atama a LEFT JOIN is_kategori kt ON kt.kod = a.kategori WHERE a.taseron_id = $1 AND a.durum = 'TAMAMLANDI' ORDER BY a.id`, [k.taseron.id])
      .catch(() => ({ rows: [] }))).rows;
    if (!isler.length) return [];
    const sahalar = [...new Set(isler.flatMap((a) => (a.site_codes || []).map(sahaTemiz)))];
    const [mw, rp, bf, fsk] = await Promise.all([
      pool.query(`SELECT UPPER(TRIM(site_code)) AS site_code, UPPER(TRIM(item_code)) AS item_code,
          SUM(COALESCE(tamamlanan_qty, done_qty, 0)) AS miktar, BOOL_AND(UPPER(COALESCE(qc_durum,'')) = 'OK') AS qc_ok, COUNT(*)::int AS adet
        FROM master_works WHERE UPPER(TRIM(site_code)) = ANY($1::text[]) AND UPPER(TRIM(subcon_name)) = ANY($2::text[])
        GROUP BY 1, 2`, [sahalar, k.adlar]).catch(() => ({ rows: [] })),
      pool.query(`SELECT UPPER(TRIM(site_code)) AS site_code, MAX(qc_durum) AS qc_durum, MAX(qc_closed_date) AS qc_tarih
        FROM rollout_progress WHERE UPPER(TRIM(site_code)) = ANY($1::text[]) GROUP BY 1`, [sahalar]).catch(() => ({ rows: [] })),
      pool.query(`SELECT UPPER(TRIM(site_code)) AS site_code, UPPER(TRIM(COALESCE(item_code,''))) AS item_code, fatura_no
        FROM bolge_fatura WHERE UPPER(TRIM(site_code)) = ANY($1::text[]) AND UPPER(TRIM(taseron_adi)) = ANY($2::text[])`, [sahalar, k.adlar]).catch(() => ({ rows: [] })),
      pool.query(`SELECT UPPER(TRIM(f.site_code)) AS site_code, ie.fatura_no FROM fatura_saha_kalem f JOIN invoice_entries ie ON ie.id = f.fatura_id
        WHERE UPPER(TRIM(f.site_code)) = ANY($1::text[]) AND UPPER(TRIM(COALESCE(NULLIF(ie.rf_montaj_firma,''), ie.tedarikci))) = ANY($2::text[])`, [sahalar, k.adlar]).catch(() => ({ rows: [] })),
    ]);
    const satirlar = [];
    const gorulen = new Set();
    for (const a of isler) {
      const f = await guncelFiyat(a.id, k.taseron.id);
      const site = sahaTemiz((a.site_codes || [])[0]);
      const qcSaha = rp.rows.find((x) => x.site_code === site);
      if (!f) {
        satirlar.push({ is_id: a.id, site_code: site, kapsam: a.kategori_ad || a.kategori, tamamlanma: a.bitis_ts || a.updated_at, durum: "FIYAT_YOK",
          aciklama: "Bu işin fiyatı belirlenmemiş", para_birimi: null, tutar: null });
        continue;
      }
      for (const kl of f.kalemler || []) {
        const kod = buyuk(kl.kalem_kodu);
        const anahtar = `${site}|${kod || buyuk(kl.aciklama)}`;
        const s = { is_id: a.id, site_code: site, kapsam: a.kategori_ad || a.kategori, kalem: kl.aciklama, kalem_kodu: kl.kalem_kodu || null,
          tamamlanma: a.bitis_ts || a.updated_at, birim: kl.birim, birim_fiyat: Number(kl.birim_fiyat), anlasilan_miktar: Number(kl.miktar),
          para_birimi: f.para_birimi, kdv_esasi: f.kdv_esasi, fiyat_surum: f.surum };
        let miktar = null, qc = null, hesap = null;
        if (kod) {
          const m = mw.rows.find((x) => x.site_code === site && x.item_code === kod);
          if (m) { miktar = Number(m.miktar); qc = m.qc_ok ? "OK" : "BEKLIYOR"; hesap = `Gerçekleşen ${miktar} ${kl.birim || ""} × ${s.birim_fiyat} (anlaşılan birim fiyat)`; }
          else hesap = "Gerçekleşen miktar kaydı henüz yok";
        } else {
          miktar = s.anlasilan_miktar; qc = String(qcSaha?.qc_durum || "").toUpperCase() === "OK" ? "OK" : "BEKLIYOR";
          hesap = `Paket: ${miktar} ${kl.birim || ""} × ${s.birim_fiyat} (anlaşılan fiyat; iş tamamlandı)`;
        }
        s.miktar = miktar; s.qc = qc; s.hesap = hesap;
        s.tutar = miktar === null ? null : yuvarla(miktar * s.birim_fiyat);
        s.faturalandi = bf.rows.some((x) => x.site_code === site && (!kod || !x.item_code || x.item_code === kod)) || fsk.rows.some((x) => x.site_code === site);
        if (gorulen.has(anahtar)) { s.durum = "MUKERRER"; s.aciklama = "Aynı saha ve kalem başka bir işte de var; toplama alınmadı"; }
        else if (miktar === null) s.durum = "MIKTAR_BEKLIYOR";
        else if (qc !== "OK") s.durum = "QC_BEKLIYOR";
        else s.durum = "UYGUN";
        gorulen.add(anahtar);
        satirlar.push(s);
      }
    }
    return satirlar;
  }
  function hakedisToplamlari(satirlar) {
    const t = {};
    for (const s of satirlar) {
      if (!s.para_birimi || s.tutar === null || s.durum === "MUKERRER") continue;
      const p = (t[s.para_birimi] ||= { para_birimi: s.para_birimi, tamamlanan: 0, qc_bekleyen: 0, uygun: 0, uygun_faturalanan: 0, uygun_faturalanmayan: 0 });
      p.tamamlanan += s.tutar;
      if (s.durum === "QC_BEKLIYOR") p.qc_bekleyen += s.tutar;
      if (s.durum === "UYGUN") { p.uygun += s.tutar; if (s.faturalandi) p.uygun_faturalanan += s.tutar; else p.uygun_faturalanmayan += s.tutar; }
    }
    return Object.values(t).map((p) => Object.fromEntries(Object.entries(p).map(([a, v]) => [a, typeof v === "number" ? yuvarla(v) : v])));
  }

  // ── FATURALAR ───────────────────────────────────────────────────────────────────────────────────
  // Web'de girilen fatura (invoice_entries) ve ödeme (taseron_odeme_log) kayıtları — yeniden oluşturulmaz, yalnız okunur.
  const faturaDurum = (f) => Number(f.kalan_borc) <= 0.005 ? "ODENDI" : Number(f.odenen_tutar) > 0 ? "KISMI" : "BEKLIYOR";
  async function faturalar(k) {
    const r = await pool.query(`SELECT id, fatura_no, fatura_tarihi, COALESCE(toplam_tutar, 0) AS toplam_tutar, COALESCE(odenen_tutar, 0) AS odenen_tutar,
        COALESCE(kalan_borc, COALESCE(toplam_tutar,0) - COALESCE(odenen_tutar,0)) AS kalan_borc, COALESCE(NULLIF(currency,''), 'TRY') AS para_birimi,
        to_jsonb(ie)->>'odeme_tarihi' AS vade
      FROM invoice_entries ie WHERE UPPER(TRIM(COALESCE(NULLIF(rf_montaj_firma,''), tedarikci))) = ANY($1::text[])
        AND COALESCE(to_jsonb(ie)->>'fatura_turu', '') NOT IN ('IADE')
      ORDER BY fatura_tarihi DESC NULLS LAST, id DESC`, [k.adlar]).catch(() => ({ rows: [] }));
    return r.rows.map((f) => ({ ...f, toplam_tutar: Number(f.toplam_tutar), odenen_tutar: Number(f.odenen_tutar), kalan_borc: Number(f.kalan_borc), durum: faturaDurum(f) }));
  }

  // ── TAŞERON UÇLARI ──────────────────────────────────────────────────────────────────────────────
  app.get("/taseron-panel/profil", ...taseronKapisi(async (req, res, k) => {
    res.json({ ok: true, taseron: { id: k.taseron.id, ad: k.taseron.unvan || k.taseron.subcon_name, kod: k.taseron.subcon_name },
      ana_firma: { kod: k.anaFirma, ad: await anaFirmaAd(k.anaFirma) } });
  }));

  app.get("/taseron-panel/ozet", ...taseronKapisi(async (req, res, k) => {
    const is = await pool.query(`SELECT COUNT(*) FILTER (WHERE durum NOT IN ('TAMAMLANDI','IPTAL'))::int AS aktif,
        COUNT(*) FILTER (WHERE durum = 'TAMAMLANDI')::int AS tamamlanan, COUNT(*)::int AS toplam FROM is_atama WHERE taseron_id = $1`, [k.taseron.id]);
    const satirlar = await hakedisSatirlari(k);
    const fat = await faturalar(k);
    const fatToplam = {};
    for (const f of fat) {
      const p = (fatToplam[f.para_birimi] ||= { para_birimi: f.para_birimi, faturalanan: 0, odenen: 0, kalan: 0, adet: 0 });
      p.faturalanan += f.toplam_tutar; p.odenen += f.odenen_tutar; p.kalan += f.kalan_borc; p.adet++;
    }
    res.json({ ok: true, isler: is.rows[0], qc_bekleyen_satir: satirlar.filter((s) => s.durum === "QC_BEKLIYOR").length,
      hakedis: hakedisToplamlari(satirlar),
      faturalar: Object.values(fatToplam).map((p) => ({ ...p, faturalanan: yuvarla(p.faturalanan), odenen: yuvarla(p.odenen), kalan: yuvarla(p.kalan) })) });
  }));

  app.get("/taseron-panel/isler", ...taseronKapisi(async (req, res, k) => {
    const r = await pool.query(`SELECT a.id, a.kategori, kt.ad AS kategori_ad, a.site_codes, a.bolge, a.plan_tarihi, a.durum, a.baslama_ts, a.bitis_ts, a.atayan_not
      FROM is_atama a LEFT JOIN is_kategori kt ON kt.kod = a.kategori WHERE a.taseron_id = $1 ORDER BY (a.durum IN ('TAMAMLANDI','IPTAL')), a.plan_tarihi NULLS LAST, a.id DESC`, [k.taseron.id]);
    const rows = [];
    for (const a of r.rows) rows.push({ ...a, fiyat: fiyatGorunum(await guncelFiyat(a.id, k.taseron.id)) });
    res.json({ ok: true, rows });
  }));

  app.get("/taseron-panel/isler/:id", ...taseronKapisi(async (req, res, k) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return hata(res, 404, "İş bulunamadı");
    const r = await pool.query(`SELECT a.id, a.kategori, kt.ad AS kategori_ad, a.site_codes, a.bolge, a.plan_tarihi, a.durum, a.baslama_ts, a.bitis_ts, a.atayan_not
      FROM is_atama a LEFT JOIN is_kategori kt ON kt.kod = a.kategori WHERE a.id = $1 AND a.taseron_id = $2`, [id, k.taseron.id]);
    if (!r.rows[0]) return hata(res, 404, "İş bulunamadı"); // başka taşeronun işi: varlığı da söylenmez
    const a = r.rows[0];
    const surumler = await pool.query(`SELECT surum, created_at AS tarih, neden FROM is_atama_fiyat WHERE is_atama_id = $1 AND taseron_id = $2 ORDER BY surum`, [id, k.taseron.id]);
    const sahalar = await pool.query(`SELECT UPPER(TRIM(site_code)) AS site_code, MAX(project_code) AS proje, MAX(bolge) AS bolge, MAX(site_type) AS saha_tipi,
        MAX(qc_durum) AS qc_durum FROM rollout_progress WHERE UPPER(TRIM(site_code)) = ANY($1::text[]) GROUP BY 1`, [(a.site_codes || []).map(sahaTemiz)]).catch(() => ({ rows: [] }));
    const belgeler = (await sahaBelgeleri((a.site_codes || []).map(sahaTemiz))).map(({ url, ...b }) => b); // adres doğrudan verilmez
    res.json({ ok: true, row: { ...a, fiyat: fiyatGorunum(await guncelFiyat(id, k.taseron.id)), fiyat_gecmisi: surumler.rows, sahalar: sahalar.rows, belgeler } });
  }));

  // Belge indirme: önce iş + taşeron + saha doğrulanır, sonra yönlendirilir (adres listede verilmez)
  app.get("/taseron-panel/isler/:id/belge", ...taseronKapisi(async (req, res, k) => {
    const id = Number(req.params.id);
    const a = (await pool.query(`SELECT site_codes FROM is_atama WHERE id = $1 AND taseron_id = $2`, [id, k.taseron.id])).rows[0];
    if (!a) return hata(res, 404, "Belge bulunamadı");
    const site = sahaTemiz(req.query.site), alan = String(req.query.alan || ""), sira = Number(req.query.sira || 0);
    if (!(a.site_codes || []).map(sahaTemiz).includes(site)) return hata(res, 404, "Belge bulunamadı");
    const b = (await sahaBelgeleri([site])).find((x) => x.alan === alan && x.sira === sira);
    if (!b) return hata(res, 404, "Belge bulunamadı");
    res.set("Cache-Control", "private, no-store");
    // Mobil uygulama başlık taşıyamayan tarayıcıya geçmeden önce adresi doğrulanmış olarak JSON'la alır
    if (req.query.json === "1") return res.json({ ok: true, url: b.url, etiket: b.etiket });
    return res.redirect(b.url);
  }));

  // Belgeler: taşeronun açık / tamamlanan işlerindeki teknik saha belgeleri (adres verilmez; indirme /isler/:id/belge)
  app.get("/taseron-panel/belgeler", ...taseronKapisi(async (req, res, k) => {
    const r = await pool.query(`SELECT a.id, a.site_codes, a.durum, kt.ad AS kategori_ad FROM is_atama a LEFT JOIN is_kategori kt ON kt.kod = a.kategori
      WHERE a.taseron_id = $1 AND a.durum <> 'IPTAL' ORDER BY a.id DESC LIMIT 100`, [k.taseron.id]);
    const rows = [];
    for (const a of r.rows) {
      const b = await sahaBelgeleri((a.site_codes || []).map(sahaTemiz));
      for (const { url, ...x } of b) rows.push({ is_id: a.id, kapsam: a.kategori_ad, is_durum: a.durum, ...x });
    }
    res.json({ ok: true, rows });
  }));

  app.get("/taseron-panel/hakedis", ...taseronKapisi(async (req, res, k) => {
    const satirlar = await hakedisSatirlari(k);
    res.json({ ok: true, satirlar, toplamlar: hakedisToplamlari(satirlar) });
  }));

  app.get("/taseron-panel/faturalar", ...taseronKapisi(async (req, res, k) => {
    res.json({ ok: true, rows: await faturalar(k) });
  }));

  app.get("/taseron-panel/faturalar/:id", ...taseronKapisi(async (req, res, k) => {
    const id = Number(req.params.id);
    const f = (await faturalar(k)).find((x) => x.id === id);
    if (!f) return hata(res, 404, "Fatura bulunamadı"); // başka taşeronun faturası: varlığı da söylenmez
    const sk = await pool.query(`SELECT site_code, kalem_adi, miktar, birim, tutar FROM fatura_saha_kalem WHERE fatura_id = $1 ORDER BY id`, [id]).catch(() => ({ rows: [] }));
    const od = await pool.query(`SELECT l.id, l.tarih, d->>'tutar' AS tutar FROM taseron_odeme_log l, jsonb_array_elements(COALESCE(l.dagilim, '[]'::jsonb)) d
      WHERE UPPER(TRIM(l.firma)) = ANY($1::text[]) AND TRIM(d->>'fatura_no') = TRIM($2) ORDER BY l.tarih, l.id`, [k.adlar, String(f.fatura_no || "")]).catch(() => ({ rows: [] }));
    res.json({ ok: true, fatura: f,
      sahalar: sk.rows.map((x) => ({ ...x, miktar: x.miktar === null ? null : Number(x.miktar), tutar: x.tutar === null ? null : Number(x.tutar) })),
      saha_baglantisi_eksik: sk.rows.length === 0,
      odemeler: od.rows.map((o) => ({ referans: `Ödeme #${o.id}`, tarih: o.tarih, tutar: Number(o.tutar) })) });
  }));

  // ── YÖNETİM (ŞİRKET SAHİBİ / YÖNETİCİ) KAPSAMI ──────────────────────────────────────────────────────
  // Profil admin panelinden atanır (users.yonetim_profili) ya da kişiye özel izin (personel_yonetimi). Kapsam yalnız
  // kullanıcının kendi firmasının bordro kümesi (markaProfil.bordro); platform yönetimi anlamına gelmez.
  // Maaş ayrı izin: req.izinler.maas_goruntule (şirket sahibine varsayılan açık; yöneticide kapalı, kişiye özel açılır).
  async function yonetimKapsami(req) {
    const u = req.user;
    if (!u) return { kod: 401, mesaj: "Oturum gerekli" };
    const p = await profilOku(pool, u.user_id);
    if (p.kullanici_tipi === "TASERON") return { kod: 403, mesaj: "Bu bölüm şirket içi yöneticilere açık" };
    const profil = PROFILLER.includes(p.yonetim_profili) ? p.yonetim_profili : null;
    const izinli = profil === "YONETICI" || profil === "SAHIP" || req.izinler?.personel_yonetimi === true;
    if (!izinli || req.izinler?.personel_yonetimi === false) return { kod: 403, mesaj: "Personel yönetimi yetkiniz yok" };
    const marka = String(p.marka || u.marka || "ERC").toUpperCase();
    const bordro = altMarkaKullanicisi(u) ? markaProfil(marka).bordro : [marka];
    return { profil, marka, bordro, maas: req.izinler?.maas_goruntule !== false && (profil === "SAHIP" || req.izinler?.maas_goruntule === true) };
  }
  const yonetimKapisi = (fn) => [authMiddleware, async (req, res) => {
    try {
      const k = await yonetimKapsami(req);
      if (k.kod) return hata(res, k.kod, k.mesaj);
      return await fn(req, res, k);
    } catch (e) { console.error("[yonetim]", e.message); return hata(res, 500, "Bilgiler alınamadı"); }
  }];
  const kapsamSql = (alias, n) => `UPPER(COALESCE(${alias}.marka, 'ERC')) = ANY($${n}::text[])`;

  app.get("/yonetim/ozet", ...yonetimKapisi(async (req, res, k) => {
    const [pr, av, mf, is] = await Promise.all([
      pool.query(`SELECT COUNT(*) FILTER (WHERE aktif)::int AS aktif, COUNT(*) FILTER (WHERE NOT aktif)::int AS pasif FROM personel p WHERE ${kapsamSql("p", 1)}`, [k.bordro]),
      pool.query(`SELECT COUNT(*)::int AS adet, COALESCE(SUM(t.tutar), 0) AS tutar FROM is_avans_talep t JOIN personel p ON p.id = t.personel_id
        WHERE ${kapsamSql("p", 1)} AND t.durum NOT IN ('TAMAMLANDI','REDDEDILDI')`, [k.bordro]).catch(() => ({ rows: [{ adet: null, tutar: null }] })),
      pool.query(`SELECT COUNT(DISTINCT mf.id)::int AS adet FROM masraf_form mf JOIN personel p ON p.id = mf.personel_id
        WHERE ${kapsamSql("p", 1)} AND mf.durum IN ('ROLLOUT_BEKLE','MUHASEBE_BEKLE','PM_BEKLE','DIREKTOR_BEKLE')`, [k.bordro]).catch(() => ({ rows: [{ adet: null }] })),
      pool.query(`SELECT COUNT(DISTINCT a.id) FILTER (WHERE a.durum NOT IN ('TAMAMLANDI','IPTAL'))::int AS acik FROM is_atama a
        WHERE EXISTS (SELECT 1 FROM personel p, jsonb_array_elements(a.personeller) e WHERE LOWER(TRIM(p.email)) = LOWER(e->>'email') AND ${kapsamSql("p", 1)})`, [k.bordro]).catch(() => ({ rows: [{ acik: null }] })),
    ]);
    res.json({ ok: true, profil: k.profil, firma: { kod: k.marka, ad: await anaFirmaAd(k.marka) }, maas_yetkisi: k.maas,
      personel: pr.rows[0], onay_bekleyen: { avans: { adet: av.rows[0].adet, tutar: av.rows[0].tutar === null ? null : Number(av.rows[0].tutar) }, masraf: { adet: mf.rows[0].adet } },
      saha: { acik_is: is.rows[0].acik } });
  }));

  app.get("/yonetim/personel", ...yonetimKapisi(async (req, res, k) => {
    const sayfa = Math.max(1, Number(req.query.sayfa) || 1), limit = Math.min(50, Math.max(10, Number(req.query.limit) || 25));
    const kos = [kapsamSql("p", 1)], prm = [k.bordro];
    // Türkçe harf farkı (Ali / ALİ / ALI) aramayı bozmasın: iki taraf da sadeleştirilir
    if (req.query.q) { prm.push(`%${sadeAd(req.query.q)}%`); kos.push(`TRANSLATE(LOWER(p.ad_soyad), 'İIŞĞÜÖÇışğüöç', 'iisguocisguoc') LIKE $${prm.length}`); }
    if (req.query.aktif === "1" || req.query.aktif === "0") { prm.push(req.query.aktif === "1"); kos.push(`p.aktif = $${prm.length}`); }
    if (req.query.bolge) { prm.push(String(req.query.bolge)); kos.push(`p.bolge = $${prm.length}`); }
    if (req.query.ekip) { prm.push(String(req.query.ekip)); kos.push(`p.ekip_bilgisi = $${prm.length}`); }
    const where = kos.join(" AND ");
    const [r, n, f] = await Promise.all([
      pool.query(`SELECT p.id, p.ad_soyad, p.unvan, p.bolge, p.ekip_bilgisi AS ekip, p.aktif, UPPER(COALESCE(p.marka,'ERC')) AS firma
        FROM personel p WHERE ${where} ORDER BY p.aktif DESC, p.ad_soyad LIMIT ${limit} OFFSET ${(sayfa - 1) * limit}`, prm),
      pool.query(`SELECT COUNT(*)::int AS n FROM personel p WHERE ${where}`, prm),
      pool.query(`SELECT ARRAY_REMOVE(ARRAY_AGG(DISTINCT p.bolge), NULL) AS bolgeler, ARRAY_REMOVE(ARRAY_AGG(DISTINCT p.ekip_bilgisi), NULL) AS ekipler
        FROM personel p WHERE ${kapsamSql("p", 1)}`, [k.bordro]),
    ]);
    res.json({ ok: true, rows: r.rows, toplam: n.rows[0].n, sayfa, limit, filtreler: f.rows[0] });
  }));

  // Personel detayı: tüm bölümler AYNI kalıcı kimlikten (personel.id → email/user_id) beslenir; benzer isim eşleşmesi yok.
  // Her bölüm ayrı durumla döner: ok | yetki_yok | hata — bir bölüm alınamazsa diğerleri gösterilir, sıfır uydurulmaz.
  app.get("/yonetim/personel/:id", ...yonetimKapisi(async (req, res, k) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return hata(res, 404, "Personel bulunamadı");
    const p = (await pool.query(`SELECT p.id, p.ad_soyad, p.unvan, p.bolge, p.ekip_bilgisi AS ekip, p.telefon, LOWER(TRIM(COALESCE(p.email,''))) AS email,
        p.aktif, p.ise_giris_tarihi, p.isten_ayrilma_tarihi, UPPER(COALESCE(p.marka,'ERC')) AS firma, p.net_maas, p.user_id
      FROM personel p WHERE p.id = $1 AND ${kapsamSql("p", 2)}`, [id, k.bordro])).rows[0];
    if (!p) return hata(res, 404, "Personel bulunamadı"); // kapsam dışı: varlığı da söylenmez
    const bolum = async (fn) => { try { return { durum: "ok", veri: await fn() }; } catch (e) { console.error("[yonetim-detay]", e.message); return { durum: "hata" }; } };
    const kisiselGizli = p.email === c.PM_KISISEL_EMAIL && !pmKisiselEmailGorur(req.user?.email, req.user?.role);
    const donem = /^\d{4}-\d{2}$/.test(String(req.query.donem || "")) ? String(req.query.donem) : new Date().toISOString().slice(0, 7);
    const sonuc = { genel: { durum: "ok", veri: { id: p.id, ad_soyad: p.ad_soyad, unvan: p.unvan, firma: p.firma, firma_ad: await anaFirmaAd(p.firma),
      bolge: p.bolge, ekip: p.ekip, telefon: p.telefon, email: p.email || null, aktif: p.aktif, ise_giris_tarihi: p.ise_giris_tarihi, isten_ayrilma_tarihi: p.isten_ayrilma_tarihi } } };
    sonuc.hesap = kisiselGizli ? { durum: "yetki_yok" } : await bolum(async () => {
      const h = await personelHesapEkstresi(p.email, p.id);
      return { ozet: h.ozet, hareketler: h.hareketler.slice(-30), bekleyen: h.bekleyen };
    });
    sonuc.avans = kisiselGizli ? { durum: "yetki_yok" } : await bolum(async () => (await pool.query(`SELECT t.id, t.tarih, t.tutar, t.durum, t.gider_turu, t.odeme_tarihi
        FROM is_avans_talep t WHERE t.personel_id = $1 OR (t.personel_id IS NULL AND $2 <> '' AND LOWER(TRIM(t.talep_eden_email)) = $2)
        ORDER BY t.tarih DESC NULLS LAST, t.id DESC LIMIT 30`, [p.id, p.email])).rows.map((r) => ({ ...r, tutar: Number(r.tutar) })));
    sonuc.masraf = kisiselGizli ? { durum: "yetki_yok" } : await bolum(async () => (await pool.query(`SELECT mf.id, mf.form_no, mf.donem, mf.durum, mf.created_at,
        COALESCE(SUM(mk.tutar),0) AS tutar, COUNT(DISTINCT mk.id)::int AS kalem, COUNT(mb.id)::int AS belge
      FROM masraf_form mf LEFT JOIN masraf_kalem mk ON mk.form_id = mf.id LEFT JOIN masraf_belge mb ON mb.kalem_id = mk.id
      WHERE mf.personel_id = $1 OR (mf.personel_id IS NULL AND $2 <> '' AND LOWER(TRIM(mf.talep_eden_email)) = $2)
      GROUP BY mf.id ORDER BY mf.created_at DESC LIMIT 20`, [p.id, p.email])).rows.map((r) => ({ ...r, tutar: Number(r.tutar) })));
    // Maaş: yetki yoksa alan yanıtta HİÇ yok (yalnız ekranda gizleme değil)
    sonuc.maas = !k.maas || kisiselGizli ? { durum: "yetki_yok" } : await bolum(async () => {
      const od = await pool.query(`SELECT donem, tarih, COALESCE(bankadan,0) + COALESCE(elden,0) AS tutar, aciklama FROM maas_odeme
        WHERE personel_id = $1 ORDER BY tarih DESC, id DESC LIMIT 12`, [p.id]);
      return { net_maas: p.net_maas === null ? null : Number(p.net_maas), odemeler: od.rows.map((o) => ({ ...o, tutar: Number(o.tutar) })) };
    });
    sonuc.puantaj = await bolum(async () => {
      const r = await pool.query(`SELECT durum, COUNT(*)::int AS gun, COALESCE(SUM(fazla_mesai_saat),0) AS fazla_mesai_saat FROM puantaj
        WHERE personel_id = $1 AND TO_CHAR(tarih, 'YYYY-MM') = $2 GROUP BY durum`, [p.id, donem]);
      const g = (d) => r.rows.filter((x) => d.includes(x.durum)).reduce((t, x) => t + x.gun, 0);
      // Günlük kayıtlar (mobil Puantaj sekmesi): aynı personel, aynı dönem; mevcut puantaj satırları olduğu gibi
      const gunler = (await pool.query(`SELECT tarih, durum, COALESCE(fazla_mesai_saat,0) AS fazla_mesai_saat, to_jsonb(puantaj)->>'aciklama' AS aciklama FROM puantaj
        WHERE personel_id = $1 AND TO_CHAR(tarih, 'YYYY-MM') = $2 ORDER BY tarih`, [p.id, donem]).catch(() => ({ rows: [] }))).rows;
      return { donem, kayit_var: r.rows.length > 0, calisilan: g(["CALISDI"]), izin: g(["IZINLI", "IZIN", "YILLIK_IZIN", "RAPORLU", "DINLENME"]),
        devamsizlik: g(["GELMEDI"]), fazla_mesai_saat: Number(r.rows.reduce((t, x) => t + Number(x.fazla_mesai_saat), 0)), dagilim: r.rows,
        gunler: gunler.map((x) => ({ ...x, fazla_mesai_saat: Number(x.fazla_mesai_saat) })) };
    });
    sonuc.isler = !p.email ? { durum: "ok", veri: { atanan: [], not: "Personelin e-postası tanımlı değil" } } : await bolum(async () => {
      const r = await pool.query(`SELECT a.id, a.kategori, kt.ad AS kategori_ad, a.site_codes, a.durum, a.plan_tarihi, a.bitis_ts,
          (SELECT MAX(rp.qc_durum) FROM rollout_progress rp WHERE UPPER(TRIM(rp.site_code)) = ANY(a.site_codes)) AS qc_durum
        FROM is_atama a LEFT JOIN is_kategori kt ON kt.kod = a.kategori WHERE a.personeller @> $1::jsonb ORDER BY a.id DESC LIMIT 30`, [JSON.stringify([{ email: p.email }])]);
      return { atanan: r.rows };
    });
    sonuc.zimmet = await bolum(async () => (await pool.query(`SELECT d.id, d.malzeme_adi, d.miktar, d.birim, d.durum, d.verilme_tarihi, d.site_id
      FROM malzeme_dagitim d WHERE d.arsiv_tarihi IS NULL AND (d.alici_personel_id = $1 OR ($2 <> '' AND LOWER(TRIM(COALESCE(d.alici_personel_email,''))) = $2))
      ORDER BY d.verilme_tarihi DESC NULLS LAST, d.id DESC LIMIT 30`, [p.id, p.email])).rows);
    sonuc.isg = k.profil === "SAHIP" || req.izinler?.isg_goruntule === true ? await bolum(async () => (await pool.query(
      `SELECT egitim_turu, egitim_tarihi, bitis_tarihi FROM personel_isg WHERE personel_id = $1 ORDER BY egitim_tarihi DESC LIMIT 20`, [p.id])).rows) : { durum: "yetki_yok" };
    res.json({ ok: true, personel_id: p.id, bolumler: sonuc });
  }));

  // ── ADMİN: TAŞERON LİSTESİ VE TAKMA ADLAR (kullanıcı bağlama için; serbest metin yok) ──────────────────────
  const tamAdmin = (u) => ["admin", "platform_admin"].includes(String(u?.role || "").toLowerCase());
  app.get("/admin/taseronlar", authMiddleware, async (req, res) => {
    try {
      if (!tamAdmin(req.user)) return hata(res, 403, "Yetkiniz yok");
      const r = await pool.query(`SELECT s.id, s.subcon_name, s.unvan, s.ana_firma, COALESCE(s.aktif, true) AS aktif,
          (SELECT COUNT(*)::int FROM users u WHERE (to_jsonb(u)->>'taseron_id')::int = s.id) AS kullanici_sayisi,
          COALESCE((SELECT ARRAY_AGG(t.ad ORDER BY t.ad) FROM subcon_takma_ad t WHERE t.subcon_id = s.id), '{}') AS takma_adlar
        FROM subcons s ORDER BY s.subcon_name`);
      // Alt marka yöneticisi yalnız kendi firmasına bağlı (ya da henüz bağlanmamış) taşeronları görür
      const rows = altMarkaKullanicisi(req.user) ? r.rows.filter((s) => !s.ana_firma || markaProfil(req.user.marka).bordro.includes(String(s.ana_firma).toUpperCase())) : r.rows;
      res.json({ ok: true, rows });
    } catch (e) { hata(res, 500, e.message); }
  });
  app.post("/admin/taseronlar/:id/takma-ad", authMiddleware, async (req, res) => {
    try {
      if (!tamAdmin(req.user) || altMarkaKullanicisi(req.user)) return hata(res, 403, "Takma adı yalnız merkez yönetici ekleyebilir");
      const id = Number(req.params.id), ad = String(req.body?.ad || "").trim();
      if (!ad) return hata(res, 400, "Takma ad zorunlu");
      if (!(await taseronBilgi(pool, id))) return hata(res, 404, "Taşeron bulunamadı");
      const cak = await pool.query(`SELECT s.id FROM subcons s WHERE UPPER(TRIM(s.subcon_name)) = UPPER(TRIM($1)) AND s.id <> $2
        UNION SELECT t.subcon_id FROM subcon_takma_ad t WHERE UPPER(TRIM(t.ad)) = UPPER(TRIM($1))`, [ad, id]);
      if (cak.rows.length) return hata(res, 409, "Bu ad başka bir taşerona ait ya da zaten eklenmiş");
      await pool.query(`INSERT INTO subcon_takma_ad (subcon_id, ad, ekleyen) VALUES ($1, $2, $3)`, [id, ad, String(req.user?.email || "")]);
      await islemGecmisiYaz(req, "taseron", id, "TAKMA_AD", null, { ad }, null);
      res.json({ ok: true });
    } catch (e) { hata(res, 500, e.message); }
  });

  // ── İŞ ATAMA FİYATI (taşeron işleri) ──────────────────────────────────────────────────────────────
  // Fiyat atama anında sürüm 1 olarak saklanır; değişiklik yalnız yeni sürümle (neden zorunlu, yapan kaydedilir).
  // Eksik fiyat sıfır sayılmaz: kalemde miktar ve birim fiyat > 0 olmalı.
  function fiyatDogrula(f) {
    if (!f || typeof f !== "object") return { hata: "Fiyat bilgisi eksik" };
    const para = String(f.para_birimi || "TRY").toUpperCase(), kdv = String(f.kdv_esasi || "HARIC").toUpperCase();
    if (!BIRIM_PARA.includes(para)) return { hata: "Para birimi TRY, USD ya da EUR olmalı" };
    if (!KDV_ESAS.includes(kdv)) return { hata: "KDV esası HARIC ya da DAHIL olmalı" };
    const kalemler = (Array.isArray(f.kalemler) ? f.kalemler : []).map((k) => ({
      kalem_kodu: String(k?.kalem_kodu || "").trim() || null, aciklama: String(k?.aciklama || "").trim(),
      miktar: Number(String(k?.miktar ?? "").replace(",", ".")), birim: String(k?.birim || "").trim() || "Adet",
      birim_fiyat: Number(String(k?.birim_fiyat ?? "").replace(",", ".")) }));
    if (!kalemler.length) return { hata: "En az bir iş kalemi girin" };
    for (const k of kalemler) {
      if (!k.aciklama) return { hata: "Her kalemin açıklaması olmalı" };
      if (!(k.miktar > 0)) return { hata: `"${k.aciklama}" için miktar girin` };
      if (!(k.birim_fiyat > 0)) return { hata: `"${k.aciklama}" için anlaşılan birim fiyatı girin (sıfır olamaz)` };
    }
    const toplam = yuvarla(kalemler.reduce((t, k) => t + k.miktar * k.birim_fiyat, 0));
    return { para, kdv, kalemler, toplam };
  }
  async function fiyatKaydet(isId, taseronId, f, neden, kim) {
    const s = await pool.query(`SELECT COALESCE(MAX(surum), 0) + 1 AS s FROM is_atama_fiyat WHERE is_atama_id = $1`, [isId]);
    await pool.query(`INSERT INTO is_atama_fiyat (is_atama_id, surum, taseron_id, kalemler, para_birimi, kdv_esasi, toplam, neden, olusturan)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [isId, s.rows[0].s, taseronId, JSON.stringify(f.kalemler), f.para, f.kdv, f.toplam, neden || null, kim]);
    return s.rows[0].s;
  }

  app.put("/is-atama/:id/fiyat", authMiddleware, async (req, res) => {
    try {
      if (!isAtamaYetkiliMi(req)) return hata(res, 403, "İş atama yetkiniz yok");
      const id = Number(req.params.id);
      const a = (await pool.query(`SELECT id, taseron_id, durum FROM is_atama WHERE id = $1`, [id])).rows[0];
      if (!a) return hata(res, 404, "Kayıt yok");
      if (!a.taseron_id) return hata(res, 400, "Bu iş bir taşerona atanmamış");
      const neden = String(req.body?.neden || "").trim();
      const once = (await pool.query(`SELECT 1 FROM is_atama_fiyat WHERE is_atama_id = $1 LIMIT 1`, [id])).rows.length > 0;
      if (once && !neden) return hata(res, 400, "Fiyat revizyonu için neden yazın");
      const f = fiyatDogrula(req.body?.fiyat);
      if (f.hata) return hata(res, 400, f.hata);
      const surum = await fiyatKaydet(id, a.taseron_id, f, neden || "İlk fiyat", String(req.user?.email || "").toLowerCase());
      await islemGecmisiYaz(req, "is_atama", id, once ? "FIYAT_REVIZYON" : "FIYAT", null, { surum, toplam: f.toplam, para_birimi: f.para }, neden || null);
      res.json({ ok: true, surum });
    } catch (e) { hata(res, 500, e.message); }
  });

  // Atama formu için taşeron listesi (atama yetkilisine; yalnız aktif kayıtlar, kimlik + görünen ad)
  app.get("/is-atama/taseronlar", authMiddleware, async (req, res) => {
    try {
      if (!isAtamaYetkiliMi(req)) return hata(res, 403, "İş atama yetkiniz yok");
      const r = await pool.query(`SELECT id, subcon_name, unvan, ana_firma FROM subcons WHERE COALESCE(aktif, true) ORDER BY COALESCE(unvan, subcon_name)`);
      const suz = await taseronSuz(req);
      res.json({ ok: true, rows: r.rows.filter((x) => !suz || suz(x)).map((x) => ({ id: x.id, ad: x.unvan || x.subcon_name, kod: x.subcon_name, ana_firma: x.ana_firma })) });
    } catch (e) { hata(res, 500, e.message); }
  });

  // Fiyat önerisi: yalnız AYNI taşeronla daha önce anlaşılmış fiyat (aynı kalem kodu ya da açıklama). Yoksa boş döner —
  // yönetici açıkça belirler; Huawei fiyatı / başka taşeronun fiyatı önerilmez.
  app.get("/is-atama/fiyat-oneri", authMiddleware, async (req, res) => {
    try {
      if (!isAtamaYetkiliMi(req)) return hata(res, 403, "İş atama yetkiniz yok");
      const tid = Number(req.query.taseron_id);
      if (!tid) return hata(res, 400, "Taşeron seçin");
      const suz = await taseronSuz(req);
      if (suz) {
        const t = (await pool.query(`SELECT subcon_name, ana_firma FROM subcons WHERE id = $1`, [tid])).rows[0];
        if (!t || !suz(t)) return hata(res, 403, "Bu taşeron firmanızın kapsamında değil");
      }
      const r = await pool.query(`SELECT k->>'kalem_kodu' AS kalem_kodu, k->>'aciklama' AS aciklama, k->>'birim' AS birim, (k->>'birim_fiyat')::numeric AS birim_fiyat,
          f.para_birimi, f.kdv_esasi, f.created_at
        FROM is_atama_fiyat f, jsonb_array_elements(f.kalemler) k WHERE f.taseron_id = $1 ORDER BY f.created_at DESC LIMIT 200`, [tid]);
      const gor = new Set(), rows = [];
      for (const x of r.rows) { const a = buyuk(x.kalem_kodu || x.aciklama); if (gor.has(a)) continue; gor.add(a); rows.push({ ...x, birim_fiyat: Number(x.birim_fiyat) }); }
      res.json({ ok: true, rows });
    } catch (e) { hata(res, 500, e.message); }
  });

  return { taseronKapsami, yonetimKapsami, fiyatDogrula, fiyatKaydet, profilOku: (id) => profilOku(pool, id), taseronBilgi: (id) => taseronBilgi(pool, id) };
}

module.exports = { semaKur, kur, profilOku, taseronBilgi, taseronAdlari, PROFILLER, TIPLER };
