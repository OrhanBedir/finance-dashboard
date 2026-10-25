// Tarihli onay devri (25.10.2026, Orhan): bir firmanın belirli bir onay adımı, yürürlük tarihinden itibaren
// belirli bir KULLANICI KİMLİĞİNE (users.id) devredilir. İlk kullanım: Teknocenter direktör onayları
// 01.11.2026 00:00 (Europe/Istanbul) itibarıyla Düzgün Şimşek'ten İlhami Şahin'e geçer.
//
// Kurallar
//  - Yürürlük her istekte O ANIN saatiyle hesaplanır (sunucu / uygulama yeniden başlatılmaz; önbellek yalnız satırları
//    tutar, zaman karşılaştırması her çağrıda yapılır).
//  - Aktif devir varsa o adımı yalnız devralan onaylar: eski e-posta listesindeki kişiler (Düzgün, ortak hesap) o
//    firmanın o adımını API'den de veremez. Devir yoksa eski kural aynen geçerlidir (Şimşek/AHY akışları değişmez).
//  - Devralan yalnız kendi adımını yapar: önceki Rollout Müdürü / PM adımları atlanmaz, muhasebenin ödeme adımı ayrıdır.
//  - Yönlendirme ölçütü talebin OLUŞTURULMA tarihi değil, işlemin yapıldığı an: devirden önce açılmış ve hâlâ bekleyen
//    talepler de devralana gider. Tamamlanmış onayların onaycı adı / tarihi değişmez (geçmişe yazılmaz).
//  - Devralan hesap yoksa / pasifse sessizce eski onaycıya dönülmez: adım kilitlenir, hata açıkça söylenir.
//  - Talebin firması = talebin üzerinde olduğu PERSONELİN firması (marka); personel bağlı değilse talep edenin
//    kullanıcı firması; o da yoksa seçilen kasa; hiçbiri yoksa ERC. Kasa seçimi ("hangi firmanın kasasından") firmayı değiştirmez.
const ADIMLAR = {
  AVANS_PD: { ad: "İş avansı · direktör onayı", modul: "avans" },
  MASRAF_PD: { ad: "Masraf formu · direktör onayı", modul: "masraf" },
};
const ONBELLEK_MS = 10 * 1000;

const firmaKodu = (v) => {
  const k = String(v || "").trim().toUpperCase();
  return !k || k === "SIMSEK" || k === "ŞİMŞEK" ? "ERC" : k;
};
const _eposta = (u) => String(u?.email || "").toLowerCase().trim();
const _rol = (u) => String(u?.role || "").toLowerCase();
const _uid = (u) => Number(u?.user_id || u?.id || 0) || null;

// Saf kural: satır şu anda yürürlükte mi? (başlangıç dahil, bitiş hariç) — testler sınırı bununla doğrular
function devirAktifMi(row, an = new Date()) {
  if (!row || row.aktif === false) return false;
  const t = an instanceof Date ? an.getTime() : new Date(an).getTime();
  const b = new Date(row.baslangic).getTime();
  if (!Number.isFinite(b) || t < b) return false;
  if (row.bitis) { const s = new Date(row.bitis).getTime(); if (Number.isFinite(s) && t >= s) return false; }
  return true;
}
const devirPlanliMi = (row, an = new Date()) => !!row && row.aktif !== false && new Date(row.baslangic).getTime() > (an instanceof Date ? an.getTime() : new Date(an).getTime());

async function semaKur(pool) {
  const q = (s) => pool.query(s).catch((e) => console.error("[onay-devri şema]", e.message));
  await q(`CREATE TABLE IF NOT EXISTS onay_devri (
    id SERIAL PRIMARY KEY, firma TEXT NOT NULL, adim TEXT NOT NULL, onayci_user_id INTEGER NOT NULL,
    baslangic TIMESTAMPTZ NOT NULL, bitis TIMESTAMPTZ, aciklama TEXT, olusturan TEXT, aktif BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW())`);
  await q(`CREATE INDEX IF NOT EXISTS onay_devri_firma_adim_idx ON onay_devri (firma, adim)`);
  await q(`ALTER TABLE onay_devri ENABLE ROW LEVEL SECURITY`);
}

// Avans / masraf satırının firması (SQL): personel markası → talep edenin kullanıcı markası → kasa → ERC
const avansFirmaSql = (t = "t", p = "p") => `UPPER(COALESCE(NULLIF(TRIM(${p}.marka),''),
  (SELECT COALESCE(NULLIF(TRIM(u.marka),''),'ERC') FROM users u WHERE LOWER(TRIM(u.email)) = LOWER(TRIM(COALESCE(${t}.talep_eden_email,''))) ORDER BY u.id DESC LIMIT 1),
  NULLIF(TRIM(${t}.firma),''), 'ERC'))`;
const masrafFirmaSql = (mf = "mf", p = "p") => `UPPER(COALESCE(NULLIF(TRIM(${p}.marka),''),
  (SELECT COALESCE(NULLIF(TRIM(pp.marka),''),'ERC') FROM personel pp WHERE LOWER(TRIM(COALESCE(pp.email,''))) = LOWER(TRIM(COALESCE(${mf}.talep_eden_email,''))) AND pp.aktif ORDER BY pp.id DESC LIMIT 1),
  (SELECT COALESCE(NULLIF(TRIM(u.marka),''),'ERC') FROM users u WHERE LOWER(TRIM(u.email)) = LOWER(TRIM(COALESCE(${mf}.talep_eden_email,''))) ORDER BY u.id DESC LIMIT 1), 'ERC'))`;

function kur(app, c) {
  const { pool, authMiddleware, islemGecmisiYaz } = c;
  const hata = (res, kod, mesaj) => res.status(kod).json({ ok: false, error: mesaj });
  let _on = { t: 0, rows: [] };
  const sifirla = () => { _on = { t: 0, rows: [] }; };

  // Tüm aktif satırlar + onaycı hesabın durumu (küçük tablo; zaman süzgeci JS'te, her çağrıda)
  async function satirlar() {
    if (Date.now() - _on.t < ONBELLEK_MS) return _on.rows;
    const r = await pool.query(`SELECT d.*, u.email AS onayci_email, u.name AS onayci_ad, u.role AS onayci_rol,
        (u.id IS NOT NULL AND COALESCE(u.is_active,true) AND COALESCE(u.status,'active') = 'active' AND COALESCE(u.role,'') <> 'subcon') AS onayci_aktif
      FROM onay_devri d LEFT JOIN users u ON u.id = d.onayci_user_id WHERE d.aktif ORDER BY d.baslangic DESC, d.id DESC`).catch(() => ({ rows: [] }));
    _on = { t: Date.now(), rows: r.rows };
    return r.rows;
  }
  // Bir firmanın bir adımı şu anda kimde? → { devir: satır|null, hata: null|mesaj }
  async function adimOnaycisi(firma, adim, an = new Date()) {
    const f = firmaKodu(firma);
    const d = (await satirlar()).find((x) => firmaKodu(x.firma) === f && x.adim === adim && devirAktifMi(x, an)) || null;
    if (!d) return { devir: null, hata: null };
    if (!d.onayci_aktif) return { devir: d, hata: `${ADIMLAR[adim]?.ad || adim} ${f} firması için devredilmiş ancak devralan hesap (#${d.onayci_user_id}) bulunamıyor ya da pasif. Yönetici onay devrini düzeltene kadar bu adım kilitlidir.` };
    return { devir: d, hata: null };
  }
  const kullaniciDevirleri = async (userId, an = new Date()) => (await satirlar()).filter((x) => Number(x.onayci_user_id) === Number(userId) && devirAktifMi(x, an));
  const kullaniciPlanli = async (userId, an = new Date()) => (await satirlar()).filter((x) => Number(x.onayci_user_id) === Number(userId) && devirPlanliMi(x, an));

  // Adım yetkisi: devir varsa yalnız devralan; yoksa eski kural. kaynak: "devir" | "eski"
  async function adimYetkisi(req, firma, adim, eskiKural) {
    const { devir, hata: h } = await adimOnaycisi(firma, adim);
    if (devir) {
      if (h) return { izin: false, kaynak: "devir", hata: h, devir };
      return { izin: _uid(req.user) === Number(devir.onayci_user_id), kaynak: "devir", devir, hata: null };
    }
    return { izin: !!eskiKural, kaynak: "eski", devir: null, hata: null };
  }
  const avansPdYetkisi = (req, firma) => adimYetkisi(req, firma, "AVANS_PD", c.eskiAvansYetkisi(req, "PD"));
  const masrafPdYetkisi = (req, firma) => adimYetkisi(req, firma, "MASRAF_PD", c.eskiMasrafPdYetkisi(req.user));

  async function talepFirmasiAvans(talep) {
    if (!talep) return "ERC";
    const r = await pool.query(`SELECT ${avansFirmaSql("t", "p")} AS firma FROM is_avans_talep t LEFT JOIN personel p ON p.id = t.personel_id WHERE t.id = $1`, [talep.id]).catch(() => ({ rows: [] }));
    return firmaKodu(r.rows[0]?.firma || talep.firma);
  }
  async function talepFirmasiMasraf(form) {
    if (!form) return "ERC";
    const r = await pool.query(`SELECT ${masrafFirmaSql("mf", "p")} AS firma FROM masraf_form mf LEFT JOIN personel p ON p.id = mf.personel_id WHERE mf.id = $1`, [form.id]).catch(() => ({ rows: [] }));
    return firmaKodu(r.rows[0]?.firma);
  }

  // ── Bekleyen işlemler: kullanıcının ŞU AN işlem yapabileceği kayıtlar (mobil Onaylar + ana sayfa sayacı) ──
  async function avansBekleyenler(req) {
    const u = req.user || {};
    const rm = c.eskiAvansYetkisi(req, "RM"), pm = c.eskiAvansYetkisi(req, "PM"), pdEski = c.eskiAvansYetkisi(req, "PD");
    const devirPd = (req.devirler || []).filter((d) => d.adim === "AVANS_PD").map((d) => firmaKodu(d.firma));
    if (!rm && !pm && !pdEski && !devirPd.length) return { rows: [], yetkili: false, hatalar: [] };
    const r = await pool.query(`SELECT t.id, t.tutar, t.aciklama, t.not_aciklama, t.gider_turu, t.bolge, t.proje, t.durum, t.tarih, t.created_at,
        t.talep_eden_ad, t.talep_eden_email, t.plaka, t.arac_km, t.firma, p.ad_soyad AS personel_ad, p.unvan AS personel_unvan, ${avansFirmaSql("t", "p")} AS talep_firma
      FROM is_avans_talep t LEFT JOIN personel p ON p.id = t.personel_id
      WHERE t.durum IN ('TALEP','ROLLOUT_MUDUR_ONAY','PM_ONAY') ${c.pmKisiselEmailGorur(_eposta(u), _rol(u)) ? "" : `AND NOT ${c.pmAvansSahibiSql("t", "p")}`}
      ORDER BY t.created_at ASC LIMIT 100`);
    const rows = [], hatalar = [];
    for (const x of r.rows) {
      const firma = firmaKodu(x.talep_firma);
      const pd = await avansPdYetkisi(req, firma);
      if (pd.hata && (pdEski || devirPd.includes(firma)) && !hatalar.includes(pd.hata)) hatalar.push(pd.hata);
      let adim = null, uc = null;
      if (x.durum === "PM_ONAY") { if (pd.izin) { adim = "PD"; uc = "direktor-onayla"; } }
      else if (pd.izin && pd.kaynak === "eski") { adim = x.durum === "TALEP" ? "RM" : "PM"; uc = "direktor-onayla"; } // eski direktör zinciri tek seferde tamamlar
      else if (x.durum === "TALEP" && rm) { adim = "RM"; uc = "onayla"; }
      else if (x.durum === "ROLLOUT_MUDUR_ONAY" && pm) { adim = "PM"; uc = "onayla"; }
      else if (x.durum === "TALEP" && pm) { adim = "PM"; uc = "onayla"; } // PM, RM adımını da kapsar (mevcut zincir)
      if (!adim) continue;
      rows.push({ ...x, tutar: Number(x.tutar), talep_firma: firma, adim, uc, onay_kaynagi: adim === "PD" ? pd.kaynak : "eski" });
    }
    return { rows, yetkili: true, hatalar };
  }
  async function masrafBekleyenler(req) {
    const u = req.user || {};
    const kap = c.masrafAdimYetkileri(u); // { ROLLOUT_BEKLE, MUHASEBE_BEKLE, PM_BEKLE } eski listeler
    const pdEski = c.eskiMasrafPdYetkisi(u);
    const devirPd = (req.devirler || []).filter((d) => d.adim === "MASRAF_PD").map((d) => firmaKodu(d.firma));
    const durumlar = Object.entries(kap).filter(([, v]) => v).map(([k]) => k);
    if (pdEski || devirPd.length) durumlar.push("DIREKTOR_BEKLE");
    if (!durumlar.length) return { rows: [], yetkili: false, hatalar: [] };
    const r = await pool.query(`SELECT mf.id, mf.form_no, mf.donem, mf.durum, mf.created_at, mf.talep_eden_ad, mf.talep_eden_email, mf.personel_id,
        p.ad_soyad AS personel_ad, ${masrafFirmaSql("mf", "p")} AS talep_firma,
        COALESCE((SELECT SUM(mk.tutar) FROM masraf_kalem mk WHERE mk.form_id = mf.id),0) AS tutar,
        COALESCE((SELECT COUNT(*) FROM masraf_kalem mk WHERE mk.form_id = mf.id),0)::int AS kalem,
        COALESCE((SELECT COUNT(*) FROM masraf_belge mb JOIN masraf_kalem mk ON mk.id = mb.kalem_id WHERE mk.form_id = mf.id),0)::int AS belge
      FROM masraf_form mf LEFT JOIN personel p ON p.id = mf.personel_id WHERE mf.durum = ANY($1) ORDER BY mf.created_at ASC LIMIT 100`, [durumlar]);
    const rows = [], hatalar = [];
    for (const x of r.rows) {
      const firma = firmaKodu(x.talep_firma);
      if (x.durum === "DIREKTOR_BEKLE") {
        const pd = await masrafPdYetkisi(req, firma);
        if (pd.hata && (pdEski || devirPd.includes(firma)) && !hatalar.includes(pd.hata)) hatalar.push(pd.hata);
        if (!pd.izin) continue;
        rows.push({ ...x, tutar: Number(x.tutar), talep_firma: firma, adim: "DIREKTOR", onay_kaynagi: pd.kaynak });
      } else {
        rows.push({ ...x, tutar: Number(x.tutar), talep_firma: firma, adim: { ROLLOUT_BEKLE: "ROLLOUT", MUHASEBE_BEKLE: "MUHASEBE", PM_BEKLE: "PM" }[x.durum], onay_kaynagi: "eski" });
      }
    }
    return { rows, yetkili: true, hatalar };
  }
  async function malzemeBekleyenler(req) {
    if (!c.malzemePmMi(req.user)) return { rows: [], yetkili: false };
    const r = await pool.query(`SELECT t.id, t.talep_no, t.talep_eden_ad, t.talep_eden_email, t.durum, t.bolge, t.proje, t.site_id, t.notlar, t.created_at,
        COALESCE((SELECT COUNT(*) FROM malzeme_talep_kalemleri k WHERE k.talep_id = t.id),0)::int AS kalem_sayisi
      FROM malzeme_talepler t WHERE t.durum = 'PM_ONAY' ORDER BY t.created_at ASC LIMIT 50`).catch(() => ({ rows: [] }));
    return { rows: r.rows.map((x) => ({ ...x, adim: "PM" })), yetkili: true };
  }
  // Oturum özeti (/auth/me, giriş): sekme görünürlüğü ilk çizimde doğru olsun diye yetkiler burada da döner
  async function onayOzeti(req) {
    const u = req.user || {};
    const uid = _uid(u);
    const devirler = uid ? await kullaniciDevirleri(uid) : [];
    const planli = uid ? await kullaniciPlanli(uid) : [];
    const avans = ["RM", "PM", "PD"].some((a) => c.eskiAvansYetkisi(req, a)) || devirler.some((d) => d.adim === "AVANS_PD");
    const masraf = Object.values(c.masrafAdimYetkileri(u)).some(Boolean) || c.eskiMasrafPdYetkisi(u) || devirler.some((d) => d.adim === "MASRAF_PD");
    const malzeme = !!c.malzemePmMi(u);
    const kisa = (d) => ({ firma: firmaKodu(d.firma), adim: d.adim, adim_ad: ADIMLAR[d.adim]?.ad || d.adim, baslangic: d.baslangic, bitis: d.bitis });
    return { onayci: avans || masraf || malzeme || planli.length > 0, yetkiler: { avans, masraf, malzeme }, devirler: devirler.map(kisa), planli: planli.map(kisa) };
  }

  app.get("/onay/bekleyen", authMiddleware, async (req, res) => {
    try {
      if (_rol(req.user) === "subcon") return hata(res, 403, "Taşeron hesabı onay vermez");
      const [a, m, z, o] = await Promise.all([avansBekleyenler(req), masrafBekleyenler(req), malzemeBekleyenler(req), onayOzeti(req)]);
      const hatalar = [...new Set([...a.hatalar, ...m.hatalar])];
      res.json({ ok: true, ...o, sayac: a.rows.length + m.rows.length + z.rows.length, yapilandirma_hatasi: hatalar,
        kategoriler: { avans: { yetkili: a.yetkili, rows: a.rows }, masraf: { yetkili: m.yetkili, rows: m.rows }, malzeme: { yetkili: z.yetkili, rows: z.rows } } });
    } catch (e) { console.error("[onay/bekleyen]", e.message); return hata(res, 500, "Onay listesi alınamadı"); }
  });

  // ── Yönetim: devir tanımları (yalnız tam admin; alt marka yöneticisi yalnız kendi firması) ──
  const tamAdmin = (u) => ["admin", "platform_admin"].includes(_rol(u));
  const firmaYetkisi = (u, firma) => _rol(u) === "platform_admin" || (tamAdmin(u) && (!c.altMarkaKullanicisi(u) || firmaKodu(u.marka) === firmaKodu(firma)));
  app.get("/admin/onay-devri", authMiddleware, async (req, res) => {
    try {
      if (!tamAdmin(req.user)) return hata(res, 403, "Yetkiniz yok");
      const r = await pool.query(`SELECT d.*, u.email AS onayci_email, u.name AS onayci_ad,
          (u.id IS NOT NULL AND COALESCE(u.is_active,true) AND COALESCE(u.status,'active') = 'active') AS onayci_aktif
        FROM onay_devri d LEFT JOIN users u ON u.id = d.onayci_user_id ORDER BY d.aktif DESC, d.baslangic DESC, d.id DESC`);
      const an = new Date();
      const rows = r.rows.filter((x) => firmaYetkisi(req.user, x.firma)).map((x) => ({ ...x, adim_ad: ADIMLAR[x.adim]?.ad || x.adim,
        durum: !x.aktif ? "iptal" : !x.onayci_aktif ? "onayci_pasif" : devirAktifMi(x, an) ? "yururlukte" : devirPlanliMi(x, an) ? "planli" : "bitti" }));
      res.json({ ok: true, rows, adimlar: Object.entries(ADIMLAR).map(([kod, a]) => ({ kod, ad: a.ad })), simdi: an.toISOString() });
    } catch (e) { return hata(res, 500, e.message); }
  });
  app.post("/admin/onay-devri", authMiddleware, async (req, res) => {
    try {
      if (!tamAdmin(req.user)) return hata(res, 403, "Yetkiniz yok");
      const b = req.body || {};
      const firma = firmaKodu(b.firma), adim = String(b.adim || "").toUpperCase();
      if (!ADIMLAR[adim]) return hata(res, 400, "Geçersiz onay adımı");
      if (!firmaYetkisi(req.user, firma)) return hata(res, 403, "Bu firma için devir tanımlayamazsınız");
      const uid = Number(b.onayci_user_id);
      if (!Number.isInteger(uid) || uid <= 0) return hata(res, 400, "Devralan kullanıcı seçin");
      const u = (await pool.query(`SELECT id, email, name, role, is_active, status, marka FROM users WHERE id = $1`, [uid])).rows[0];
      if (!u || u.is_active === false || String(u.status || "active") !== "active") return hata(res, 400, "Devralan kullanıcı bulunamadı ya da pasif");
      if (_rol(u) === "subcon") return hata(res, 400, "Taşeron hesabı onaycı olamaz");
      const bas = new Date(b.baslangic); if (!Number.isFinite(bas.getTime())) return hata(res, 400, "Yürürlük başlangıcı gerekli (ör. 2026-11-01T00:00:00+03:00)");
      const bit = b.bitis ? new Date(b.bitis) : null; if (bit && (!Number.isFinite(bit.getTime()) || bit <= bas)) return hata(res, 400, "Bitiş başlangıçtan sonra olmalı");
      const r = await pool.query(`INSERT INTO onay_devri (firma, adim, onayci_user_id, baslangic, bitis, aciklama, olusturan) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [firma, adim, uid, bas.toISOString(), bit ? bit.toISOString() : null, b.aciklama ? String(b.aciklama).slice(0, 500) : null, _eposta(req.user)]);
      sifirla();
      await islemGecmisiYaz(req, "onay_devri", r.rows[0].id, "OLUSTURMA", null, { firma, adim, onayci: u.email, baslangic: bas.toISOString(), bitis: bit ? bit.toISOString() : null }, b.aciklama || null);
      res.json({ ok: true, row: r.rows[0] });
    } catch (e) { return hata(res, 500, e.message); }
  });
  app.put("/admin/onay-devri/:id/bitir", authMiddleware, async (req, res) => {
    try {
      if (!tamAdmin(req.user)) return hata(res, 403, "Yetkiniz yok");
      const id = Number(req.params.id);
      const d = (await pool.query(`SELECT * FROM onay_devri WHERE id = $1`, [id])).rows[0];
      if (!d) return hata(res, 404, "Devir bulunamadı");
      if (!firmaYetkisi(req.user, d.firma)) return hata(res, 403, "Bu firma için yetkiniz yok");
      const bit = req.body?.bitis ? new Date(req.body.bitis) : new Date();
      if (!Number.isFinite(bit.getTime())) return hata(res, 400, "Geçersiz bitiş");
      // Henüz başlamamış devir: iptal (aktif=false); başlamış devir: bitiş tarihi yazılır (geçmiş onaylar değişmez)
      const r = devirPlanliMi(d) ? await pool.query(`UPDATE onay_devri SET aktif = false WHERE id = $1 RETURNING *`, [id])
        : await pool.query(`UPDATE onay_devri SET bitis = $2 WHERE id = $1 RETURNING *`, [id, bit.toISOString()]);
      sifirla();
      await islemGecmisiYaz(req, "onay_devri", id, "DUZENLEME", { aktif: d.aktif, bitis: d.bitis }, { aktif: r.rows[0].aktif, bitis: r.rows[0].bitis }, req.body?.aciklama || null);
      res.json({ ok: true, row: r.rows[0] });
    } catch (e) { return hata(res, 500, e.message); }
  });

  return { ADIMLAR, firmaKodu, devirAktifMi, satirlar, sifirla, adimOnaycisi, kullaniciDevirleri, kullaniciPlanli, adimYetkisi, avansPdYetkisi, masrafPdYetkisi,
    talepFirmasiAvans, talepFirmasiMasraf, avansBekleyenler, masrafBekleyenler, malzemeBekleyenler, onayOzeti };
}

module.exports = { ADIMLAR, firmaKodu, devirAktifMi, devirPlanliMi, semaKur, kur, avansFirmaSql, masrafFirmaSql };
