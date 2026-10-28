// ═══ ORGANİZASYON: FİRMA / EKİP / ÜYELİK YÖNETİMİ (28.10.2026, Orhan) ═══════════════════════════════════════════
// Organizasyon şeması, saha ekip kartları, ekip detayı ve Excel/PNG çıktıları TEK kaynaktan beslenir: GET /org/yapi.
// Paralel firma / personel sistemi kurulmaz; mevcut kimlikler kullanılır:
//   Firma (dış taşeron)  subcons.id — subcon_name iş kayıtlarındaki (master_works.subcon_name) operasyon etiketidir,
//                        DEĞİŞTİRİLMEZ. Görünen ad (gorunen_ad) ve resmi unvan (unvan) ayrı alanlardır; ad düzeltmesi
//                        kimliği, iş etiketlerini, hakediş eşleşmelerini ve geçmiş tutarları etkilemez.
//   Firma (kendi firma)  markalar.kod (ERC / TEKNO …) — kendi ekipleri ekipler.ekip_turu='IC' + bagli_firma
//   Ekip                 ekipler.ekip_no — firma bağlantısı ekipler.firma_id (subcons.id); ad, bölge, açıklama ayrı alanlar
//   Ekip şefi            ekipler.sef_personel_id (yoksa eski kural: ünvanında "şef" geçen üye — yalnız gösterim)
//   Üyelik               personel.ekip_bilgisi GÜNCEL ekibi gösterir (bir kişi aynı anda tek ekipte — mevcut kural);
//                        ekip_uyelik başlangıç / bitiş geçmişini tutar. Ekipten çıkarmak personeli silmez.
// Aktif / pasif: firma (subcons.aktif) ve ekip (ekipler.aktif) ayrı. Pasif firma/ekipte yeni ekip, üye ve iş ataması
// açılmaz (iş ataması kuralı /is-atama'da zaten var); mevcut işler, finans kayıtları ve belgeler değişmez.
// Her değişiklik islem_gecmisi'ne (modul 'firma' | 'ekip') yapan, zaman, önceki/yeni değer ve gerekçeyle yazılır.

const BOLGELER = ["İzmir", "Ankara", "Bursa", "Antalya"];
const ACIK_IS_DURUM = "a.durum NOT IN ('TAMAMLANDI','IPTAL')";
const temiz = (s, n = 200) => String(s ?? "").trim().replace(/\s+/g, " ").slice(0, n);
// Mükerrer kontrolü için katlama: Türkçe büyük harf → ASCII, harf/rakam dışı atılır ("Işık", "IŞIK", "ISIK" aynı)
const katla = (s) => String(s || "").trim().toLocaleUpperCase("tr-TR")
  .replace(/İ/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C")
  .replace(/[^A-Z0-9]+/g, "");
const buyuk = (s) => temiz(s).toLocaleUpperCase("tr-TR");
const bugun = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const tarihMi = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

async function semaKur(pool) {
  const q = (s) => pool.query(s).catch((e) => console.error("[org şema]", e.message));
  await q(`ALTER TABLE ekipler ADD COLUMN IF NOT EXISTS firma_id INTEGER`);
  await q(`ALTER TABLE ekipler ADD COLUMN IF NOT EXISTS sef_personel_id INTEGER`);
  await q(`ALTER TABLE subcons ADD COLUMN IF NOT EXISTS gorunen_ad TEXT`);
  await q(`ALTER TABLE subcons ADD COLUMN IF NOT EXISTS kaynak TEXT`);
  await q(`ALTER TABLE subcons ADD COLUMN IF NOT EXISTS olusturan TEXT`);
  await q(`CREATE TABLE IF NOT EXISTS ekip_uyelik (
    id SERIAL PRIMARY KEY, personel_id INTEGER NOT NULL, ekip_no INTEGER NOT NULL,
    baslangic DATE, bitis DATE, baslatan TEXT, bitiren TEXT, baslangic_gerekce TEXT, bitis_gerekce TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await q(`CREATE INDEX IF NOT EXISTS ekip_uyelik_personel_idx ON ekip_uyelik (personel_id)`);
  await q(`CREATE INDEX IF NOT EXISTS ekip_uyelik_ekip_idx ON ekip_uyelik (ekip_no)`);
  // Bir kişinin aynı anda tek açık üyeliği olabilir (personel.ekip_bilgisi tek değer — mevcut kural)
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS ekip_uyelik_acik_uq ON ekip_uyelik (personel_id) WHERE bitis IS NULL`);
}

function kur(app, c) {
  const { pool, authMiddleware, islemGecmisiYaz, altMarkaKullanicisi, detectTenant } = c;
  const hata = (res, kod, mesaj, ek) => res.status(kod).json({ ok: false, error: mesaj, ...(ek || {}) });
  const rolOf = (u) => String(u?.role || "").toLowerCase();

  // ── YETKİ ───────────────────────────────────────────────────────────────────────────────────────────────────
  // Görme: ERC kiracısındaki şirket içi herkes (bugünkü davranış — şema herkese açık); taşeron ve başka kiracı göremez.
  // Yönetme (org_yonet) ve silme (org_sil): kullanıcı yetki ayarı (users.yetki_ayar) ya da ERC tam admin rolü varsayılanı.
  // Bu izinler maaş, bordro, finans ya da kullanıcı yetkisi VERMEZ (onlar ayrı izin / kapılardır).
  // Alt marka hesabı (Teknocenter vb.) yalnız kendi firmasının (bagli_firma) ekiplerini görür ve — izni varsa — yönetir.
  function orgYetki(req) {
    const u = req.user || {};
    if (rolOf(u) === "subcon") return { gor: false };
    const tenant = String(u.tenant || detectTenant(u.email, u.subcon_name) || "").toLowerCase();
    if (tenant !== "erc") return { gor: false };
    const alt = altMarkaKullanicisi(u) ? String(u.marka || "").toUpperCase() : null;
    const iz = req.izinler || {};
    const tamAdmin = ["admin", "platform_admin"].includes(rolOf(u)) && !alt;
    const yonet = iz.org_yonet === true || (iz.org_yonet !== false && tamAdmin);
    const sil = yonet && (iz.org_sil === true || (iz.org_sil !== false && tamAdmin));
    return { gor: true, yonet, sil, marka: alt };
  }
  const gorKapisi = [authMiddleware, (req, res, next) => (orgYetki(req).gor ? next() : hata(res, 403, "Organizasyon bilgisine erişim yetkiniz yok"))];
  const yonetKapisi = [authMiddleware, (req, res, next) => (orgYetki(req).yonet ? next() : hata(res, 403, "Organizasyon / ekip yönetimi yetkiniz yok"))];
  const silKapisi = [authMiddleware, (req, res, next) => (orgYetki(req).sil ? next() : hata(res, 403, "Kayıt silme yetkiniz yok"))];
  // Alt marka kapsamı: ekip yalnız kendi firmasının iç ekibiyse erişilebilir; firma (taşeron) işlemleri ERC'ye aittir
  const ekipKapsamda = (req, e) => { const m = orgYetki(req).marka; return !m || (e && e.ekip_turu === "IC" && String(e.bagli_firma || "").toUpperCase() === m); };
  const firmaIslemiKapsamda = (req) => !orgYetki(req).marka;
  const kim = (req) => String(req.user?.email || "").toLowerCase().trim() || null;

  // ── OKUMA YARDIMCILARI ──────────────────────────────────────────────────────────────────────────────────────
  const firmaGorunen = (f) => (f ? temiz(f.gorunen_ad) || temiz(f.subcon_name) : null);
  async function firmaOku(id, db = pool) {
    const r = await db.query(`SELECT id, subcon_name, unvan, gorunen_ad, ana_firma, COALESCE(aktif,true) AS aktif, kaynak, created_at FROM subcons WHERE id=$1`, [Number(id)]);
    return r.rows[0] || null;
  }
  async function ekipOku(no, db = pool) {
    const r = await db.query(`SELECT * FROM ekipler WHERE ekip_no=$1`, [Number(no)]);
    return r.rows[0] || null;
  }
  // Ekipte sayılan kişi: aktif, ayrılış tarihi gelmemiş, güncel ekibi bu ekip (şema / kart / Excel aynı kural)
  const UYE_SQL = `SELECT p.id, p.ad_soyad, p.unvan, p.telefon, p.ekip_arac_plaka, p.ekip_bilgisi, COALESCE(p.firma_tipi,'simsek') AS firma_tipi,
      p.alt_yuklenici, COALESCE(p.marka,'ERC') AS marka,
      (SELECT to_char(u.baslangic,'YYYY-MM-DD') FROM ekip_uyelik u WHERE u.personel_id=p.id AND u.bitis IS NULL LIMIT 1) AS uyelik_baslangic
    FROM personel p
    WHERE COALESCE(p.aktif,true) AND p.birlestirildi_personel_id IS NULL
      AND (p.isten_ayrilma_tarihi IS NULL OR p.isten_ayrilma_tarihi > CURRENT_DATE)
      AND TRIM(COALESCE(p.ekip_bilgisi,'')) <> ''`;
  async function uyeleriOku(db = pool) {
    const r = await db.query(UYE_SQL).catch(async (e) => {
      // birlestirildi_personel_id kolonu olmayan kurulum (eski şema) — aynı kural, kolonsuz
      if (!/birlestirildi_personel_id/.test(e.message)) throw e;
      return db.query(UYE_SQL.replace("AND p.birlestirildi_personel_id IS NULL", ""));
    });
    return r.rows;
  }
  const sefMiUnvan = (p) => /şef|sef/i.test(String(p?.unvan || ""));

  // Tek kaynak: firmalar + ekipler (+ üyeler, şef, durum, kişi sayısı)
  async function yapiOku(req) {
    const y = orgYetki(req);
    const [ek, uy, mk] = await Promise.all([
      pool.query(`SELECT * FROM ekipler ORDER BY (ekip_sira IS NULL), ekip_sira, ekip_no`),
      uyeleriOku(),
      pool.query(`SELECT kod, ad FROM markalar`).catch(() => ({ rows: [] })),
    ]);
    const firmaIdleri = [...new Set(ek.rows.map((e) => e.firma_id).filter(Boolean))];
    const fq = await pool.query(`SELECT id, subcon_name, unvan, gorunen_ad, ana_firma, COALESCE(aktif,true) AS aktif, kaynak
      FROM subcons WHERE id = ANY($1::int[]) OR kaynak = 'ORG' ORDER BY id`, [firmaIdleri]);
    const firmaMap = new Map(fq.rows.map((f) => [f.id, f]));
    const markaAd = new Map(mk.rows.map((m) => [String(m.kod).toUpperCase(), m.ad]));
    if (!markaAd.has("ERC")) markaAd.set("ERC", "Şimşek Haberleşme");
    const uyeMap = new Map();
    for (const p of uy) { const k = String(p.ekip_bilgisi).trim(); if (!uyeMap.has(k)) uyeMap.set(k, []); uyeMap.get(k).push(p); }
    let ekipler = ek.rows.map((e) => {
      const f = e.firma_id ? firmaMap.get(e.firma_id) : null;
      const uyeler = (uyeMap.get(String(e.ekip_no)) || []).sort((a, b) =>
        (Number(b.id === e.sef_personel_id) - Number(a.id === e.sef_personel_id)) || (sefMiUnvan(b) - sefMiUnvan(a)) || String(a.ad_soyad).localeCompare(String(b.ad_soyad), "tr"));
      const sef = e.sef_personel_id ? uyeler.find((p) => p.id === e.sef_personel_id) || null : null;
      const firmaAktif = f ? f.aktif !== false : true;
      return {
        ...e,
        firma_gorunen: f ? firmaGorunen(f) : null,
        firma_aktif: firmaAktif,
        firma_bagli: !!f,
        bagli_firma_ad: e.ekip_turu === "IC" && e.bagli_firma ? markaAd.get(String(e.bagli_firma).toUpperCase()) || e.bagli_firma : null,
        etkin: e.aktif !== false && firmaAktif,
        uye_sayisi: uyeler.length,
        sef: sef ? { id: sef.id, ad_soyad: sef.ad_soyad } : null,
        sef_eski_kural: !e.sef_personel_id ? (uyeler.find(sefMiUnvan) ? { id: uyeler.find(sefMiUnvan).id, ad_soyad: uyeler.find(sefMiUnvan).ad_soyad } : null) : null,
        sef_gerekli: !!e.sef_personel_id && !sef,
        uyeler,
      };
    });
    if (y.marka) ekipler = ekipler.filter((e) => ekipKapsamda(req, e));
    // Firma kartları: kayıtlı dış taşeron firmaları + firma kaydına bağlanmamış eski ekiplerin serbest taşeron adı
    // + kendi firmamızın ekipleri (markalar). Kayıt olmayan gruplar düzenlenemez; ekip "Düzenle" ile firmaya bağlanır.
    const firmalar = [];
    if (!y.marka) {
      for (const f of fq.rows) {
        const list = ekipler.filter((e) => e.firma_id === f.id);
        firmalar.push({ tip: "TASERON", id: f.id, anahtar: `F${f.id}`, ad: firmaGorunen(f), subcon_name: f.subcon_name, unvan: f.unvan || null,
          gorunen_ad: f.gorunen_ad || null, aktif: f.aktif !== false, kaynak: f.kaynak || null,
          ekip_sayisi: list.length, aktif_ekip: list.filter((e) => e.aktif !== false).length, kisi: list.reduce((s, e) => s + e.uye_sayisi, 0) });
      }
    }
    const serbest = new Map();
    for (const e of ekipler) {
      if (e.firma_id) continue;
      const key = e.ekip_turu === "IC" ? `M:${String(e.bagli_firma || "ERC").toUpperCase()}` : temiz(e.taseron_adi) ? `S:${katla(e.taseron_adi)}` : "M:ERC";
      if (!serbest.has(key)) serbest.set(key, { tip: key.startsWith("M:") ? "KENDI" : "BAGLANMAMIS", id: null, anahtar: key,
        ad: key.startsWith("M:") ? (markaAd.get(key.slice(2)) || key.slice(2)) : temiz(e.taseron_adi), aktif: true, ekip_sayisi: 0, aktif_ekip: 0, kisi: 0 });
      const g = serbest.get(key); g.ekip_sayisi++; if (e.aktif !== false) g.aktif_ekip++; g.kisi += e.uye_sayisi;
      e.firma_anahtar = key;
    }
    for (const e of ekipler) if (e.firma_id) e.firma_anahtar = `F${e.firma_id}`;
    firmalar.push(...serbest.values());
    return { firmalar, ekipler, bolgeler: BOLGELER, izinler: { yonet: y.yonet, sil: y.sil, marka: y.marka || null } };
  }

  app.get("/org/yapi", gorKapisi, async (req, res) => {
    try { res.json({ ok: true, ...(await yapiOku(req)) }); }
    catch (e) { console.error("[org/yapi]", e.message); hata(res, 500, "Organizasyon bilgisi alınamadı"); }
  });

  // ── FİRMA (dış taşeron) ─────────────────────────────────────────────────────────────────────────────────────
  // Mükerrer kontrolü: katlanmış ad (Türkçe harf / boşluk / noktalama duyarsız) subcon_name, görünen ad, resmi unvan ya da
  // takma adlardan biriyle AYNIYSA yeni kayıt açılmaz → mevcut firma önerilir. Yalnız benzerlik (önek) uyarıdır, birleştirme yapılmaz.
  async function firmaMukerrer(ad, haricId = null) {
    const k = katla(ad);
    if (!k) return { ayni: [], benzer: [] };
    const r = await pool.query(`SELECT s.id, s.subcon_name, s.gorunen_ad, s.unvan, COALESCE(s.aktif,true) AS aktif,
        ARRAY(SELECT t.ad FROM subcon_takma_ad t WHERE t.subcon_id = s.id) AS takma FROM subcons s`).catch(() => ({ rows: [] }));
    const ayni = [], benzer = [];
    for (const f of r.rows) {
      if (haricId && f.id === haricId) continue;
      const adlar = [f.subcon_name, f.gorunen_ad, f.unvan, ...(f.takma || [])].map(katla).filter(Boolean);
      const ozet = { id: f.id, ad: firmaGorunen(f), unvan: f.unvan || null, aktif: f.aktif };
      if (adlar.includes(k)) ayni.push(ozet);
      else if (k.length >= 3 && adlar.some((a) => a.startsWith(k) || k.startsWith(a))) benzer.push(ozet);
    }
    return { ayni, benzer: benzer.slice(0, 5) };
  }
  async function firmaOlustur(db, req, { ad, unvan, gerekce }) {
    const subconName = buyuk(ad);
    const r = await db.query(`INSERT INTO subcons (subcon_name, gorunen_ad, unvan, ana_firma, aktif, kaynak, olusturan)
      VALUES ($1,$2,$3,'ERC',true,'ORG',$4) RETURNING id, subcon_name, gorunen_ad, unvan, aktif`, [subconName, temiz(ad), temiz(unvan, 300) || null, kim(req)]);
    await islemGecmisiYaz(req, "firma", r.rows[0].id, "OLUSTURMA", null, { ad: temiz(ad), unvan: temiz(unvan, 300) || null, durum: "Aktif" }, gerekce || null);
    return r.rows[0];
  }
  app.get("/org/firma/kontrol", yonetKapisi, async (req, res) => {
    try { res.json({ ok: true, ...(await firmaMukerrer(req.query.ad, Number(req.query.haric) || null)) }); }
    catch (e) { hata(res, 500, "Kontrol yapılamadı"); }
  });
  app.post("/org/firma", yonetKapisi, async (req, res) => {
    try {
      if (!firmaIslemiKapsamda(req)) return hata(res, 403, "Taşeron firma kaydı yalnız ana firma tarafından açılır");
      const ad = temiz(req.body?.ad, 120), unvan = temiz(req.body?.unvan, 300), gerekce = temiz(req.body?.gerekce, 500);
      if (ad.length < 2) return hata(res, 400, "Firma adı gerekli");
      const m = await firmaMukerrer(ad);
      if (m.ayni.length) return hata(res, 409, `"${ad}" zaten kayıtlı: ${m.ayni.map((x) => x.ad).join(", ")}. Mevcut firmayı kullanın.`, { mevcut: m.ayni });
      const f = await firmaOlustur(pool, req, { ad, unvan, gerekce });
      res.json({ ok: true, firma: f, benzer: m.benzer });
    } catch (e) {
      if (/subcons_subcon_name_key|duplicate key/.test(e.message)) return hata(res, 409, "Bu adla bir firma kaydı zaten var");
      console.error("[org/firma]", e.message); hata(res, 500, "Firma kaydedilemedi");
    }
  });
  // A) Adı düzelt: aynı firmanın görünen adı. Kimlik (id), operasyon etiketi (subcon_name), iş etiketleri ve hakediş eşleşmeleri değişmez.
  // B) Resmi unvan değişikliği: aynı tüzel kişinin unvanı — ayrı işlem tipi (UNVAN), belge/gerekçe ile izlenir.
  app.put("/org/firma/:id", yonetKapisi, async (req, res) => {
    try {
      if (!firmaIslemiKapsamda(req)) return hata(res, 403, "Taşeron firma kaydı yalnız ana firma tarafından değiştirilir");
      const f = await firmaOku(req.params.id);
      if (!f) return hata(res, 404, "Firma bulunamadı");
      const islem = String(req.body?.islem || "");
      const gerekce = temiz(req.body?.gerekce, 500);
      if (!gerekce) return hata(res, 400, "Gerekçe yazın");
      if (islem === "ad_duzelt") {
        const yeni = temiz(req.body?.gorunen_ad, 120);
        if (yeni.length < 2) return hata(res, 400, "Yeni görünen ad gerekli");
        const m = await firmaMukerrer(yeni, f.id);
        if (m.ayni.length) return hata(res, 409, `"${yeni}" başka bir firmanın adı: ${m.ayni.map((x) => x.ad).join(", ")}. Farklı bir firmaysa "Yeni firmayla çalış" kullanın.`, { mevcut: m.ayni });
        await pool.query(`UPDATE subcons SET gorunen_ad=$2 WHERE id=$1`, [f.id, yeni]);
        await islemGecmisiYaz(req, "firma", f.id, "AD_DUZELT", { ad: firmaGorunen(f) }, { ad: yeni }, gerekce);
        return res.json({ ok: true, firma: await firmaOku(f.id) });
      }
      if (islem === "unvan") {
        const yeni = temiz(req.body?.unvan, 300);
        if (yeni.length < 2) return hata(res, 400, "Yeni resmi unvan gerekli");
        const belge = temiz(req.body?.belge, 300);
        await pool.query(`UPDATE subcons SET unvan=$2 WHERE id=$1`, [f.id, yeni]);
        await islemGecmisiYaz(req, "firma", f.id, "UNVAN", { unvan: f.unvan || null }, { unvan: yeni, belge: belge || null, gecerlilik: tarihMi(req.body?.tarih) ? req.body.tarih : null }, gerekce);
        return res.json({ ok: true, firma: await firmaOku(f.id) });
      }
      hata(res, 400, "Geçersiz işlem");
    } catch (e) { console.error("[org/firma put]", e.message); hata(res, 500, "Firma güncellenemedi"); }
  });

  // Pasife alma önizlemesi: bağlı aktif ekipler, mevcut personel atamaları, açık / planlı iş atamaları, bağlı taşeron hesapları
  async function acikIsler({ taseronId, ekipNolar }) {
    const out = [];
    if (taseronId) {
      const r = await pool.query(`SELECT a.id, a.kategori, a.durum, a.site_codes, to_char(a.plan_tarihi,'YYYY-MM-DD') AS plan_tarihi FROM is_atama a
        WHERE a.taseron_id=$1 AND ${ACIK_IS_DURUM} ORDER BY a.plan_tarihi NULLS LAST, a.id`, [taseronId]).catch(() => ({ rows: [] }));
      out.push(...r.rows.map((x) => ({ ...x, kaynak: "firma" })));
    }
    if (ekipNolar?.length) {
      const em = await pool.query(`SELECT DISTINCT LOWER(TRIM(email)) AS e FROM personel WHERE TRIM(COALESCE(ekip_bilgisi,'')) = ANY($1::text[]) AND COALESCE(aktif,true) AND COALESCE(email,'')<>''`,
        [ekipNolar.map(String)]).catch(() => ({ rows: [] }));
      const mailler = em.rows.map((x) => x.e);
      if (mailler.length) {
        const r = await pool.query(`SELECT DISTINCT a.id, a.kategori, a.durum, a.site_codes, to_char(a.plan_tarihi,'YYYY-MM-DD') AS plan_tarihi FROM is_atama a,
            jsonb_array_elements(COALESCE(a.personeller,'[]'::jsonb)) k WHERE ${ACIK_IS_DURUM} AND LOWER(TRIM(k->>'email')) = ANY($1::text[])`, [mailler]).catch(() => ({ rows: [] }));
        for (const x of r.rows) if (!out.some((o) => o.id === x.id)) out.push({ ...x, kaynak: "ekip personeli" });
      }
    }
    return out;
  }
  app.get("/org/firma/:id/pasif-onizleme", yonetKapisi, async (req, res) => {
    try {
      if (!firmaIslemiKapsamda(req)) return hata(res, 403, "Yetkiniz yok");
      const f = await firmaOku(req.params.id);
      if (!f) return hata(res, 404, "Firma bulunamadı");
      const y = await yapiOku(req);
      const ekipler = y.ekipler.filter((e) => e.firma_id === f.id);
      const hesaplar = await pool.query(`SELECT id, name, email FROM users WHERE to_jsonb(users)->>'taseron_id' = $1 AND COALESCE(is_active,true)`, [String(f.id)]).catch(() => ({ rows: [] }));
      res.json({ ok: true, firma: { id: f.id, ad: firmaGorunen(f), aktif: f.aktif },
        aktif_ekipler: ekipler.filter((e) => e.aktif !== false).map((e) => ({ ekip_no: e.ekip_no, ad: e.ad, bolge: e.bolge, uye_sayisi: e.uye_sayisi })),
        personel: ekipler.flatMap((e) => e.uyeler.map((p) => ({ id: p.id, ad_soyad: p.ad_soyad, ekip_no: e.ekip_no, ekip_ad: e.ad }))),
        acik_isler: await acikIsler({ taseronId: f.id, ekipNolar: ekipler.map((e) => e.ekip_no) }),
        taseron_hesaplari: hesaplar.rows });
    } catch (e) { console.error("[org/firma onizleme]", e.message); hata(res, 500, "Önizleme alınamadı"); }
  });
  // Durum: { aktif, gerekce, onay:true, ekipleri_de:boolean } — mevcut işler / finans / belgeler değişmez, iptal edilmez
  async function firmaDurumYaz(db, req, f, aktif, gerekce, ekipleriDe) {
    await db.query(`UPDATE subcons SET aktif=$2 WHERE id=$1`, [f.id, aktif]);
    await islemGecmisiYaz(req, "firma", f.id, "DURUM", { durum: f.aktif !== false ? "Aktif" : "Pasif" }, { durum: aktif ? "Aktif" : "Pasif" }, gerekce);
    const etkilenen = [];
    if (!aktif && ekipleriDe) {
      const r = await db.query(`UPDATE ekipler SET aktif=false, updated_at=NOW() WHERE firma_id=$1 AND aktif IS DISTINCT FROM false RETURNING ekip_no`, [f.id]);
      for (const e of r.rows) { etkilenen.push(e.ekip_no); await islemGecmisiYaz(req, "ekip", e.ekip_no, "DURUM", { durum: "Aktif" }, { durum: "Pasif" }, `Firma pasife alındı: ${gerekce}`); }
    }
    return etkilenen;
  }
  app.post("/org/firma/:id/durum", yonetKapisi, async (req, res) => {
    try {
      if (!firmaIslemiKapsamda(req)) return hata(res, 403, "Yetkiniz yok");
      const f = await firmaOku(req.params.id);
      if (!f) return hata(res, 404, "Firma bulunamadı");
      const aktif = req.body?.aktif === true, gerekce = temiz(req.body?.gerekce, 500);
      if (typeof req.body?.aktif !== "boolean") return hata(res, 400, "aktif true/false olmalı");
      if (!gerekce) return hata(res, 400, "Gerekçe yazın");
      if (!aktif && req.body?.onay !== true) return hata(res, 400, "Pasife alma etkisini önizleyip onaylayın");
      if ((f.aktif !== false) === aktif) return res.json({ ok: true, degisiklik: false });
      const etkilenen = await firmaDurumYaz(pool, req, f, aktif, gerekce, !!req.body?.ekipleri_de);
      res.json({ ok: true, pasiflenen_ekipler: etkilenen });
    } catch (e) { console.error("[org/firma durum]", e.message); hata(res, 500, "Durum değiştirilemedi"); }
  });
  // B) Yeni firmayla çalış: eski firma adı DEĞİŞMEZ; eski firma (+ekipleri) isteğe bağlı pasife alınır, yeni firma ve
  // ekipleri ayrı kimlikle açılır. Eski işler, PR/PO, hakediş, fatura, ödeme ve personel geçmişi yeni firmaya AKTARILMAZ.
  app.post("/org/firma/:id/yeni-firma", yonetKapisi, async (req, res) => {
    const db = await pool.connect();
    try {
      if (!firmaIslemiKapsamda(req)) return hata(res, 403, "Yetkiniz yok");
      const eski = await firmaOku(req.params.id, db);
      if (!eski) return hata(res, 404, "Firma bulunamadı");
      const ad = temiz(req.body?.yeni_ad, 120), gerekce = temiz(req.body?.gerekce, 500);
      if (ad.length < 2) return hata(res, 400, "Yeni firma adı gerekli");
      if (!gerekce) return hata(res, 400, "Gerekçe yazın");
      const m = await firmaMukerrer(ad);
      if (m.ayni.length) return hata(res, 409, `"${ad}" zaten kayıtlı: ${m.ayni.map((x) => x.ad).join(", ")}`, { mevcut: m.ayni });
      const ekipler = (Array.isArray(req.body?.ekipler) ? req.body.ekipler : []).map((e) => ({ ad: temiz(e?.ad, 80), bolge: temiz(e?.bolge, 40) })).filter((e) => e.ad).slice(0, 20);
      const adlar = ekipler.map((e) => katla(e.ad));
      if (new Set(adlar).size !== adlar.length) return hata(res, 400, "Yeni ekip adları birbirinden farklı olmalı");
      await db.query("BEGIN");
      const yeni = await firmaOlustur(db, req, { ad, unvan: req.body?.yeni_unvan, gerekce: `${firmaGorunen(eski)} yerine çalışılacak firma — ${gerekce}` });
      const acilan = [];
      for (const e of ekipler) acilan.push(await ekipOlustur(db, req, { firma_id: yeni.id, ad: e.ad, bolge: e.bolge, gerekce: `${ad} ile çalışmaya başlandı` }));
      let pasiflenen = [];
      if (req.body?.eski_pasif === true && eski.aktif !== false)
        pasiflenen = await firmaDurumYaz(db, req, eski, false, `${ad} ile çalışmaya geçildi — ${gerekce}`, req.body?.eski_ekipler_pasif !== false);
      await islemGecmisiYaz(req, "firma", eski.id, "YENI_FIRMA", null, { yeni_firma: ad, yeni_firma_id: yeni.id }, `Eski firmanın adı ve geçmiş kayıtları değiştirilmedi — ${gerekce}`);
      await db.query("COMMIT");
      res.json({ ok: true, yeni_firma: yeni, ekipler: acilan, pasiflenen_ekipler: pasiflenen });
    } catch (e) {
      await db.query("ROLLBACK").catch(() => {});
      console.error("[org/yeni-firma]", e.message); hata(res, e.kullanici ? 409 : 500, e.kullanici ? e.message : "İşlem tamamlanamadı");
    } finally { db.release(); }
  });
  // Silme: yalnız bu ekrandan açılmış, hiç kullanılmamış (ekip, kullanıcı, iş, iş kaydı, personel, fatura bağı yok) hatalı kayıt
  app.delete("/org/firma/:id", silKapisi, async (req, res) => {
    try {
      if (!firmaIslemiKapsamda(req)) return hata(res, 403, "Yetkiniz yok");
      const f = await firmaOku(req.params.id);
      if (!f) return hata(res, 404, "Firma bulunamadı");
      if (f.kaynak !== "ORG") return hata(res, 409, "Bu firma iş kayıtlarından gelen bir kayıttır — silinemez, pasife alın");
      const say = async (sql, p) => Number((await pool.query(sql, p).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n || 0);
      const n = await say(`SELECT COUNT(*) n FROM ekipler WHERE firma_id=$1`, [f.id]) + await say(`SELECT COUNT(*) n FROM is_atama WHERE taseron_id=$1`, [f.id])
        + await say(`SELECT COUNT(*) n FROM users WHERE to_jsonb(users)->>'taseron_id' = $1`, [String(f.id)])
        + await say(`SELECT COUNT(*) n FROM master_works WHERE UPPER(TRIM(subcon_name)) = UPPER(TRIM($1))`, [f.subcon_name])
        + await say(`SELECT COUNT(*) n FROM personel WHERE UPPER(TRIM(COALESCE(alt_yuklenici,''))) = UPPER(TRIM($1))`, [f.subcon_name])
        + await say(`SELECT COUNT(*) n FROM subcon_takma_ad WHERE subcon_id=$1`, [f.id]);
      if (n) return hata(res, 409, "Firma kullanılmış (ekip, iş, kullanıcı ya da kayıt bağlı) — silinemez, pasife alın");
      await islemGecmisiYaz(req, "firma", f.id, "SILME", { ad: firmaGorunen(f) }, null, temiz(req.body?.gerekce, 500) || "Hatalı kayıt");
      await pool.query(`DELETE FROM subcons WHERE id=$1`, [f.id]);
      res.json({ ok: true });
    } catch (e) { console.error("[org/firma sil]", e.message); hata(res, 500, "Silinemedi"); }
  });

  // ── EKİP ────────────────────────────────────────────────────────────────────────────────────────────────────
  // Mesajlarda ekip "Firma — Ekip adı" olarak anılır (ekranlardaki ad kuralıyla aynı; TEKNO ekip adı kendi başına tam addır)
  async function ekipTamAd(e) {
    const ad = e.ad || `Ekip ${e.ekip_no}`;
    if (/^TEKNO\b/i.test(ad)) return ad;
    const f = e.firma_id ? firmaGorunen(await firmaOku(e.firma_id)) : temiz(e.taseron_adi);
    return f ? `${f} — ${ad}` : ad;
  }
  const kullaniciHatasi = (m) => Object.assign(new Error(m), { kullanici: true });
  async function ekipAdMukerrer(db, { firma_id, bagli_firma, taseron_adi, ad }, haricNo) {
    const r = await db.query(`SELECT ekip_no, ad, firma_id, bagli_firma, ekip_turu, taseron_adi FROM ekipler WHERE ekip_no <> $1`, [Number(haricNo) || 0]);
    const k = katla(ad);
    return r.rows.find((e) => katla(e.ad) === k && (firma_id ? e.firma_id === firma_id
      : bagli_firma ? e.ekip_turu === "IC" && String(e.bagli_firma || "").toUpperCase() === bagli_firma
        : !e.firma_id && katla(e.taseron_adi) === katla(taseron_adi))) || null;
  }
  async function ekipOlustur(db, req, { firma_id, bagli_firma, ad, bolge, aciklama, gerekce }) {
    ad = temiz(ad, 80); bolge = temiz(bolge, 40); bagli_firma = bagli_firma ? String(bagli_firma).toUpperCase() : null;
    if (ad.length < 1) throw kullaniciHatasi("Ekip adı gerekli");
    let firma = null;
    if (firma_id) {
      firma = await firmaOku(firma_id, db);
      if (!firma) throw kullaniciHatasi("Firma bulunamadı");
      if (firma.aktif === false) throw kullaniciHatasi(`${firmaGorunen(firma)} pasif — pasif firmaya yeni ekip açılamaz`);
    } else if (!bagli_firma) throw kullaniciHatasi("Firma seçin");
    const ayni = await ekipAdMukerrer(db, { firma_id: firma?.id, bagli_firma: firma ? null : bagli_firma, ad });
    if (ayni) throw kullaniciHatasi(`Bu firmada "${ayni.ad}" adlı bir ekip zaten var (Ekip ${ayni.ekip_no})`);
    const no = (await db.query(`SELECT COALESCE(MAX(ekip_no),0)+1 AS n FROM ekipler`)).rows[0].n;
    const r = await db.query(`INSERT INTO ekipler (ekip_no, ad, bolge, aciklama, firma_id, taseron_adi, ekip_turu, bagli_firma, aktif)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING *`,
      [no, ad, bolge || null, temiz(aciklama, 500) || null, firma?.id || null, firma ? firmaGorunen(firma) : null, firma ? "DIS" : "IC", firma ? null : bagli_firma]);
    await islemGecmisiYaz(req, "ekip", no, "OLUSTURMA", null, { ad, firma: firma ? firmaGorunen(firma) : bagli_firma, bolge: bolge || null, durum: "Aktif" }, gerekce || null);
    return r.rows[0];
  }
  app.post("/org/ekip", yonetKapisi, async (req, res) => {
    try {
      const b = req.body || {};
      const m = orgYetki(req).marka;
      if (m && (b.firma_id || String(b.bagli_firma || "").toUpperCase() !== m)) return hata(res, 403, "Yalnız kendi firmanızın ekibini açabilirsiniz");
      if (b.bolge && !BOLGELER.includes(temiz(b.bolge))) return hata(res, 400, "Geçersiz bölge");
      const e = await ekipOlustur(pool, req, { firma_id: Number(b.firma_id) || null, bagli_firma: b.bagli_firma, ad: b.ad, bolge: b.bolge, aciklama: b.aciklama, gerekce: temiz(b.gerekce, 500) });
      res.json({ ok: true, ekip: e });
    } catch (e) { if (e.kullanici) return hata(res, 409, e.message); console.error("[org/ekip]", e.message); hata(res, 500, "Ekip açılamadı"); }
  });
  // Düzenle: ad, firma bağlantısı, bölge, açıklama (ayrı alanlar). Firma bağlantısı değişince eski ekip adı / iş etiketleri korunur.
  app.put("/org/ekip/:no", yonetKapisi, async (req, res) => {
    try {
      const e = await ekipOku(req.params.no);
      if (!e) return hata(res, 404, "Ekip bulunamadı");
      if (!ekipKapsamda(req, e)) return hata(res, 403, "Bu ekip firmanızın kapsamında değil");
      const b = req.body || {};
      const yeni = {
        ad: "ad" in b ? temiz(b.ad, 80) : e.ad,
        bolge: "bolge" in b ? (temiz(b.bolge, 40) || null) : e.bolge,
        aciklama: "aciklama" in b ? (temiz(b.aciklama, 500) || null) : e.aciklama,
        firma_id: "firma_id" in b ? (Number(b.firma_id) || null) : e.firma_id,
      };
      if (!yeni.ad) return hata(res, 400, "Ekip adı boş olamaz");
      if (yeni.bolge && !BOLGELER.includes(yeni.bolge) && yeni.bolge !== e.bolge) return hata(res, 400, "Geçersiz bölge");
      if (yeni.firma_id !== e.firma_id && orgYetki(req).marka) return hata(res, 403, "Firma bağlantısını değiştiremezsiniz");
      let firma = null;
      if (yeni.firma_id) {
        firma = await firmaOku(yeni.firma_id);
        if (!firma) return hata(res, 404, "Firma bulunamadı");
        if (yeni.firma_id !== e.firma_id && firma.aktif === false) return hata(res, 409, `${firmaGorunen(firma)} pasif — pasif firmaya ekip bağlanamaz`);
      }
      const ayni = await ekipAdMukerrer(pool, { firma_id: yeni.firma_id, bagli_firma: !yeni.firma_id && e.ekip_turu === "IC" ? String(e.bagli_firma || "").toUpperCase() : null, taseron_adi: e.taseron_adi, ad: yeni.ad }, e.ekip_no);
      if (ayni) return hata(res, 409, `Bu firmada "${ayni.ad}" adlı bir ekip zaten var (Ekip ${ayni.ekip_no})`);
      const gerekce = temiz(b.gerekce, 500);
      const eskiFirma = e.firma_id ? await firmaOku(e.firma_id) : null;
      const eskiOz = { ad: e.ad, bolge: e.bolge, aciklama: e.aciklama, firma: eskiFirma ? firmaGorunen(eskiFirma) : (e.taseron_adi || null) };
      const yeniOz = { ad: yeni.ad, bolge: yeni.bolge, aciklama: yeni.aciklama, firma: firma ? firmaGorunen(firma) : (e.taseron_adi || null) };
      if (JSON.stringify(eskiOz) === JSON.stringify(yeniOz)) return res.json({ ok: true, degisiklik: false });
      if (yeni.firma_id !== e.firma_id && !gerekce) return hata(res, 400, "Firma bağlantısı değişikliği için gerekçe yazın");
      // Firmaya ilk bağlanan eski ekip dış taşeron sayılır (türü boşsa); kendi ekibi (IC) türü korunur
      const tur = yeni.firma_id && !e.ekip_turu ? "DIS" : e.ekip_turu;
      const r = await pool.query(`UPDATE ekipler SET ad=$2, bolge=$3, aciklama=$4, firma_id=$5, ekip_turu=$6, updated_at=NOW() WHERE ekip_no=$1 RETURNING *`,
        [e.ekip_no, yeni.ad, yeni.bolge, yeni.aciklama, yeni.firma_id, tur]);
      await islemGecmisiYaz(req, "ekip", e.ekip_no, "DUZENLEME", eskiOz, yeniOz, gerekce || null);
      res.json({ ok: true, ekip: r.rows[0] });
    } catch (e) { console.error("[org/ekip put]", e.message); hata(res, 500, "Ekip güncellenemedi"); }
  });
  app.get("/org/ekip/:no/pasif-onizleme", yonetKapisi, async (req, res) => {
    try {
      const y = await yapiOku(req);
      const e = y.ekipler.find((x) => x.ekip_no === Number(req.params.no));
      if (!e) return hata(res, 404, "Ekip bulunamadı");
      res.json({ ok: true, ekip: { ekip_no: e.ekip_no, ad: e.ad, aktif: e.aktif !== false },
        personel: e.uyeler.map((p) => ({ id: p.id, ad_soyad: p.ad_soyad })), acik_isler: await acikIsler({ ekipNolar: [e.ekip_no] }) });
    } catch (e) { hata(res, 500, "Önizleme alınamadı"); }
  });
  app.post("/org/ekip/:no/durum", yonetKapisi, async (req, res) => {
    try {
      const e = await ekipOku(req.params.no);
      if (!e) return hata(res, 404, "Ekip bulunamadı");
      if (!ekipKapsamda(req, e)) return hata(res, 403, "Bu ekip firmanızın kapsamında değil");
      if (typeof req.body?.aktif !== "boolean") return hata(res, 400, "aktif true/false olmalı");
      const aktif = req.body.aktif, gerekce = temiz(req.body?.gerekce, 500);
      if (!gerekce) return hata(res, 400, "Gerekçe yazın");
      if (!aktif && req.body?.onay !== true) return hata(res, 400, "Pasife alma etkisini önizleyip onaylayın");
      if (aktif && e.firma_id) { const f = await firmaOku(e.firma_id); if (f && f.aktif === false) return hata(res, 409, `${firmaGorunen(f)} pasif — önce firmayı aktif edin`); }
      if ((e.aktif !== false) === aktif) return res.json({ ok: true, degisiklik: false });
      await pool.query(`UPDATE ekipler SET aktif=$2, updated_at=NOW() WHERE ekip_no=$1`, [e.ekip_no, aktif]);
      await islemGecmisiYaz(req, "ekip", e.ekip_no, "DURUM", { durum: e.aktif !== false ? "Aktif" : "Pasif" }, { durum: aktif ? "Aktif" : "Pasif" }, gerekce);
      res.json({ ok: true });
    } catch (e) { console.error("[org/ekip durum]", e.message); hata(res, 500, "Durum değiştirilemedi"); }
  });
  app.put("/org/ekip/:no/sef", yonetKapisi, async (req, res) => {
    try {
      const e = await ekipOku(req.params.no);
      if (!e) return hata(res, 404, "Ekip bulunamadı");
      if (!ekipKapsamda(req, e)) return hata(res, 403, "Bu ekip firmanızın kapsamında değil");
      const pid = req.body?.personel_id ? Number(req.body.personel_id) : null;
      const uyeler = (await uyeleriOku()).filter((p) => String(p.ekip_bilgisi).trim() === String(e.ekip_no));
      const yeni = pid ? uyeler.find((p) => p.id === pid) : null;
      if (pid && !yeni) return hata(res, 409, "Şef olarak yalnız bu ekibin güncel üyesi seçilebilir");
      const eski = e.sef_personel_id ? uyeler.find((p) => p.id === e.sef_personel_id) || { ad_soyad: `#${e.sef_personel_id}` } : null;
      await pool.query(`UPDATE ekipler SET sef_personel_id=$2, updated_at=NOW() WHERE ekip_no=$1`, [e.ekip_no, pid]);
      await islemGecmisiYaz(req, "ekip", e.ekip_no, "SEF", { sef: eski?.ad_soyad || null }, { sef: yeni?.ad_soyad || null }, temiz(req.body?.gerekce, 500) || null);
      res.json({ ok: true });
    } catch (e) { console.error("[org/sef]", e.message); hata(res, 500, "Şef değiştirilemedi"); }
  });

  // ── ÜYELİK ──────────────────────────────────────────────────────────────────────────────────────────────────
  // Açık üyelik satırı yoksa (bu sistemden önceki atama) başlangıcı bilinmeyen bir satır açılır — geçmiş uydurulmaz.
  async function acikUyelik(db, personelId, ekipNo) {
    const r = await db.query(`SELECT * FROM ekip_uyelik WHERE personel_id=$1 AND bitis IS NULL`, [personelId]);
    if (r.rows[0]) return r.rows[0];
    if (!ekipNo) return null;
    const ins = await db.query(`INSERT INTO ekip_uyelik (personel_id, ekip_no, baslangic, baslatan, baslangic_gerekce)
      VALUES ($1,$2,NULL,NULL,'Bu kayıttan önceki atama (başlangıç tarihi bilinmiyor)') RETURNING *`, [personelId, Number(ekipNo)]);
    return ins.rows[0];
  }
  async function uyelikBitir(db, req, p, { tarih, gerekce, tip }) {
    const eskiNo = Number(String(p.ekip_bilgisi || "").trim()) || null;
    if (!eskiNo) return null;
    const u = await acikUyelik(db, p.id, eskiNo);
    if (u) await db.query(`UPDATE ekip_uyelik SET bitis=$2, bitiren=$3, bitis_gerekce=$4, updated_at=NOW() WHERE id=$1`, [u.id, tarih, kim(req), gerekce || null]);
    // Ekip şefi ayrılırsa şef kaydı bırakılır (kişi artık üye değil) → kartta kalıcı "Ekip şefi ayrıldı — yeni şef seçin" uyarısı
    const sq = await db.query(`SELECT ekip_no FROM ekipler WHERE ekip_no=$1 AND sef_personel_id=$2`, [eskiNo, p.id]);
    await islemGecmisiYaz(req, "ekip", eskiNo, tip || "UYE_CIKAR", { uye: p.ad_soyad }, { bitis: tarih, ...(sq.rows.length ? { sef: "— (şef ayrıldı)" } : {}) }, gerekce || null);
    return { ekip_no: eskiNo, sef_ayrildi: sq.rows.length > 0 };
  }
  // Araç ataması kişiye yazılıdır; ekipten çıkınca mevcut kuraldaki gibi araç bağı da çözülür (araç kartı sürücüsü temizlenir)
  async function aracBagiCoz(db, p) {
    if (!p.ekip_arac_plaka) return;
    await db.query(`UPDATE personel SET ekip_arac_plaka=NULL WHERE id=$1`, [p.id]);
    await db.query(`UPDATE araclar SET surucu=NULL WHERE plaka=$1 AND surucu=$2`, [p.ekip_arac_plaka, p.ad_soyad]).catch(() => {});
  }
  // Ekleme / taşıma: { personel_id, baslangic?, gerekce?, tasima_onayi?, firma_farki_onayi? }
  app.post("/org/ekip/:no/uye", yonetKapisi, async (req, res) => {
    const db = await pool.connect();
    try {
      const e = await ekipOku(req.params.no, db);
      if (!e) return hata(res, 404, "Ekip bulunamadı");
      if (!ekipKapsamda(req, e)) return hata(res, 403, "Bu ekip firmanızın kapsamında değil");
      if (e.aktif === false) return hata(res, 409, "Ekip pasif — pasif ekibe personel eklenemez");
      const firma = e.firma_id ? await firmaOku(e.firma_id, db) : null;
      if (firma && firma.aktif === false) return hata(res, 409, `${firmaGorunen(firma)} pasif — pasif firmanın ekibine personel eklenemez`);
      const pid = Number(req.body?.personel_id);
      const p = (await db.query(`SELECT id, ad_soyad, aktif, ekip_bilgisi, ekip_arac_plaka, COALESCE(firma_tipi,'simsek') AS firma_tipi, alt_yuklenici, COALESCE(marka,'ERC') AS marka,
          (isten_ayrilma_tarihi IS NOT NULL AND isten_ayrilma_tarihi <= CURRENT_DATE) AS ayrildi FROM personel WHERE id=$1`, [pid])).rows[0];
      if (!p) return hata(res, 404, "Personel bulunamadı");
      if (p.aktif === false || p.ayrildi) return hata(res, 409, `${p.ad_soyad} aktif çalışan değil`);
      const m = orgYetki(req).marka;
      if (m && String(p.marka).toUpperCase() !== m && !(m === "TEKNO" && String(p.marka).toUpperCase() === "AHY")) return hata(res, 403, "Bu personel firmanızın kapsamında değil");
      const mevcutNo = String(p.ekip_bilgisi || "").trim();
      if (mevcutNo === String(e.ekip_no)) return res.json({ ok: true, degisiklik: false });
      const tarih = tarihMi(req.body?.baslangic) ? req.body.baslangic : bugun();
      const gerekce = temiz(req.body?.gerekce, 500);
      // Çakışma: kişi başka bir ekipteyse sessizce taşınmaz — mevcut atama gösterilir, açık onay istenir
      if (mevcutNo) {
        const diger = await ekipOku(mevcutNo, db);
        if (req.body?.tasima_onayi !== true)
          return hata(res, 409, `${p.ad_soyad} şu an ${diger ? await ekipTamAd(diger) : `Ekip ${mevcutNo}`} ekibinde. Taşımak için onaylayın.`,
            { cakisma: { ekip_no: Number(mevcutNo), ad: diger?.ad || null, sef_mi: diger?.sef_personel_id === p.id } });
        if (diger && !ekipKapsamda(req, diger)) return hata(res, 403, "Kişinin mevcut ekibi firmanızın kapsamında değil");
      }
      // Firma farkı: taşeron personelinin kayıtlı firması ekibin firmasından farklıysa uyarı (firma değişikliği ayrı İK işlemidir)
      if (firma && p.firma_tipi === "taseron" && katla(p.alt_yuklenici) && ![firma.subcon_name, firma.gorunen_ad, firma.unvan].map(katla).includes(katla(p.alt_yuklenici))
        && req.body?.firma_farki_onayi !== true)
        return hata(res, 409, `${p.ad_soyad} kayıtlarda "${p.alt_yuklenici}" firmasının personeli; ekip ${firmaGorunen(firma)} firmasına bağlı. Personelin firması bu işlemle değişmez — yine de eklemek için onaylayın.`, { firma_farki: { personel_firma: p.alt_yuklenici, ekip_firma: firmaGorunen(firma) } });
      await db.query("BEGIN");
      let eskiBilgi = null;
      if (mevcutNo) { eskiBilgi = await uyelikBitir(db, req, p, { tarih, gerekce: gerekce || `Ekip ${e.ekip_no} ekibine taşındı`, tip: "UYE_TASI_CIKIS" }); await aracBagiCoz(db, p); }
      await db.query(`UPDATE personel SET ekip_bilgisi=$2 WHERE id=$1`, [p.id, String(e.ekip_no)]);
      await db.query(`INSERT INTO ekip_uyelik (personel_id, ekip_no, baslangic, baslatan, baslangic_gerekce) VALUES ($1,$2,$3,$4,$5)`, [p.id, e.ekip_no, tarih, kim(req), gerekce || null]);
      await islemGecmisiYaz(req, "ekip", e.ekip_no, mevcutNo ? "UYE_TASI_GIRIS" : "UYE_EKLE", mevcutNo ? { onceki_ekip: `Ekip ${mevcutNo}` } : null, { uye: p.ad_soyad, baslangic: tarih }, gerekce || null);
      await db.query("COMMIT");
      res.json({ ok: true, onceki: eskiBilgi });
    } catch (err) { await db.query("ROLLBACK").catch(() => {}); console.error("[org/uye]", err.message); hata(res, 500, "Personel eklenemedi"); }
    finally { db.release(); }
  });
  // Ekipten çıkar: personel silinmez; özlük, İSG, eğitim, puantaj ve geçmiş ekip kayıtları korunur, yalnız üyelik biter
  app.post("/org/ekip/:no/uye/:pid/cikar", yonetKapisi, async (req, res) => {
    const db = await pool.connect();
    try {
      const e = await ekipOku(req.params.no, db);
      if (!e) return hata(res, 404, "Ekip bulunamadı");
      if (!ekipKapsamda(req, e)) return hata(res, 403, "Bu ekip firmanızın kapsamında değil");
      const p = (await db.query(`SELECT id, ad_soyad, ekip_bilgisi, ekip_arac_plaka FROM personel WHERE id=$1`, [Number(req.params.pid)])).rows[0];
      if (!p || String(p.ekip_bilgisi || "").trim() !== String(e.ekip_no)) return hata(res, 409, "Kişi bu ekibin güncel üyesi değil");
      const gerekce = temiz(req.body?.gerekce, 500);
      if (!gerekce) return hata(res, 400, "Gerekçe yazın");
      const tarih = tarihMi(req.body?.bitis) ? req.body.bitis : bugun();
      await db.query("BEGIN");
      const s = await uyelikBitir(db, req, p, { tarih, gerekce, tip: "UYE_CIKAR" });
      await aracBagiCoz(db, p);
      await db.query(`UPDATE personel SET ekip_bilgisi=NULL WHERE id=$1`, [p.id]);
      await db.query("COMMIT");
      res.json({ ok: true, sef_gerekli: !!s?.sef_ayrildi });
    } catch (err) { await db.query("ROLLBACK").catch(() => {}); console.error("[org/cikar]", err.message); hata(res, 500, "Çıkarılamadı"); }
    finally { db.release(); }
  });
  // Personel seçimi (yalnız ad / ünvan / firma / güncel ekip — maaş, kimlik, banka alanı yok)
  app.get("/org/personel-secim", yonetKapisi, async (req, res) => {
    try {
      const m = orgYetki(req).marka;
      const r = await pool.query(`SELECT p.id, p.ad_soyad, p.unvan, COALESCE(p.firma_tipi,'simsek') AS firma_tipi, p.alt_yuklenici, COALESCE(p.marka,'ERC') AS marka,
          NULLIF(TRIM(COALESCE(p.ekip_bilgisi,'')),'') AS ekip_no
        FROM personel p WHERE COALESCE(p.aktif,true) AND (p.isten_ayrilma_tarihi IS NULL OR p.isten_ayrilma_tarihi > CURRENT_DATE)
        ORDER BY p.ad_soyad`);
      res.json({ ok: true, personel: m ? r.rows.filter((p) => String(p.marka).toUpperCase() === m || (m === "TEKNO" && String(p.marka).toUpperCase() === "AHY")) : r.rows });
    } catch (e) { hata(res, 500, "Personel listesi alınamadı"); }
  });
  app.get("/org/personel/:id/uyelikler", gorKapisi, async (req, res) => {
    try {
      const r = await pool.query(`SELECT u.id, u.ekip_no, e.ad AS ekip_ad, to_char(u.baslangic,'YYYY-MM-DD') AS baslangic, to_char(u.bitis,'YYYY-MM-DD') AS bitis,
          u.baslatan, u.bitiren, u.baslangic_gerekce, u.bitis_gerekce FROM ekip_uyelik u LEFT JOIN ekipler e ON e.ekip_no=u.ekip_no
        WHERE u.personel_id=$1 ORDER BY u.id`, [Number(req.params.id)]);
      res.json({ ok: true, uyelikler: r.rows });
    } catch (e) { hata(res, 500, "Üyelik geçmişi alınamadı"); }
  });

  // ── GEÇMİŞ / SİLME ──────────────────────────────────────────────────────────────────────────────────────────
  app.get("/org/gecmis/:modul/:id", yonetKapisi, async (req, res) => {
    try {
      const modul = String(req.params.modul);
      if (!["firma", "ekip"].includes(modul)) return hata(res, 400, "Geçersiz istek");
      if (modul === "firma" && !firmaIslemiKapsamda(req)) return hata(res, 403, "Yetkiniz yok");
      if (modul === "ekip") { const e = await ekipOku(req.params.id); if (e && !ekipKapsamda(req, e)) return hata(res, 403, "Yetkiniz yok"); }
      const r = await pool.query(`SELECT id, tip, eski, yeni, aciklama AS gerekce, COALESCE(kullanici,'—') AS kullanici,
          to_char(created_at,'YYYY-MM-DD HH24:MI') AS zaman FROM islem_gecmisi WHERE modul=$1 AND kayit_id=$2 ORDER BY id DESC LIMIT 300`, [modul, Number(req.params.id)]);
      res.json({ ok: true, kayitlar: r.rows });
    } catch (e) { hata(res, 500, "Geçmiş alınamadı"); }
  });
  // Ekip silme: ayrı izin (org_sil) + hiç kullanılmamış olmalı (üye/üyelik geçmişi, iş etiketiyle iş kaydı, çalışma dönemi bağı yok)
  async function ekipKullanimi(no) {
    const say = async (sql, p) => Number((await pool.query(sql, p).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n || 0);
    const e = await ekipOku(no);
    if (!e) return null;
    const etiketler = (e.is_etiketleri || []).map((x) => String(x).toUpperCase());
    return await say(`SELECT COUNT(*) n FROM personel WHERE TRIM(COALESCE(ekip_bilgisi,''))=$1`, [String(no)])
      + await say(`SELECT COUNT(*) n FROM ekip_uyelik WHERE ekip_no=$1`, [Number(no)])
      + await say(`SELECT COUNT(*) n FROM personel_calisma_donemi WHERE TRIM(COALESCE(ekip_bilgisi,''))=$1`, [String(no)])
      + (etiketler.length ? await say(`SELECT COUNT(*) n FROM master_works WHERE UPPER(TRIM(subcon_name)) = ANY($1::text[])`, [etiketler]) : 0);
  }
  app.delete("/org/ekip/:no", silKapisi, async (req, res) => {
    try {
      const e = await ekipOku(req.params.no);
      if (!e) return hata(res, 404, "Ekip bulunamadı");
      if (!ekipKapsamda(req, e)) return hata(res, 403, "Bu ekip firmanızın kapsamında değil");
      if (await ekipKullanimi(e.ekip_no)) return hata(res, 409, "Ekip kullanılmış (personel, üyelik geçmişi ya da iş kaydı var) — silinemez, pasife alın");
      await islemGecmisiYaz(req, "ekip", e.ekip_no, "SILME", { ad: e.ad, bolge: e.bolge }, null, temiz(req.body?.gerekce, 500) || "Hatalı kayıt");
      await pool.query(`DELETE FROM ekipler WHERE ekip_no=$1`, [e.ekip_no]);
      res.json({ ok: true });
    } catch (err) { console.error("[org/ekip sil]", err.message); hata(res, 500, "Silinemedi"); }
  });

  // İK personel formu / işten ayrılma gibi mevcut akışlar ekip_bilgisi'ni doğrudan değiştirir: geçmiş kaybolmasın diye
  // üyelik satırı aynı anda kapatılır / açılır (akış engellenmez).
  async function uyelikSenkron(req, personelId, eskiNo, yeniNo, { tarih, gerekce } = {}) {
    const e0 = String(eskiNo || "").trim(), e1 = String(yeniNo || "").trim();
    if (e0 === e1) return;
    const t = tarihMi(tarih) ? tarih : bugun();
    try {
      if (e0) {
        const u = await acikUyelik(pool, personelId, e0);
        if (u) await pool.query(`UPDATE ekip_uyelik SET bitis=$2, bitiren=$3, bitis_gerekce=$4, updated_at=NOW() WHERE id=$1`, [u.id, t, kim(req), gerekce || "İK kaydından değişti"]);
      }
      if (e1 && Number(e1)) await pool.query(`INSERT INTO ekip_uyelik (personel_id, ekip_no, baslangic, baslatan, baslangic_gerekce) VALUES ($1,$2,$3,$4,$5)`,
        [personelId, Number(e1), t, kim(req), gerekce || "İK kaydından atandı"]);
    } catch (err) { console.error("[org uyelik senkron]", err.message); }
  }

  return { orgYetki, yonetKapisi, silKapisi, ekipKapsamda, uyelikSenkron, ekipKullanimi, firmaGorunen };
}

module.exports = { semaKur, kur, katla, BOLGELER };
