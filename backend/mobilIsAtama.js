// ═══ MOBİL İŞ ATAMA (03.11.2026, Orhan) ══════════════════════════════════════════════════════════════════════════
// Omnix mobil → Ana sayfa → Operasyon → İş Atama. AYRI bir atama sistemi değildir: web "Rollout İş Atama" ile aynı is_atama
// kayıtları, aynı yetki (isAtamaYetkiliMi) ve aynı iş kuralları (isAtamaOlustur, planSenkron.islemler). Bu modül yalnız
// telefona uygun uçlar verir:
//   GET  /mobil/is-atama/baslangic      kategoriler, Teknocenter ekipleri (üye + mobil hesap ulaşımı), tek tek personel, yetki
//   GET  /mobil/is-atama/ara?q=         Site ID / iş kodu araması (haritaVerisi → ZORUNLU Teknocenter kapsamı; açık atama + fiilî durum)
//   POST /mobil/is-atama/kontrol        kayıt ÖNCESİ: mükerrer açık atama, kişi/ekip çakışmaları, mobil hesabı olmayanlar
//   POST /mobil/is-atama                atama oluştur (istek_anahtari ile tek kayıt; iş kodu kilidiyle çift atama engeli)
//   GET  /mobil/is-atama/liste          bugün / gelecek / devam / tamamlanan / iptal + arama + bölge / ekip / durum filtreleri
//   GET  /mobil/is-atama/:id            detay + geçmiş + son bildirim + plan sürümü
//   PUT  /mobil/is-atama/:id            tarih / saat / not / kişi değişikliği (plan_surum ile; başlanmış işte kişi değişikliği → devir akışı)
//   POST /mobil/is-atama/:id/iptal      gerekçeli iptal (planSenkron.iptalEt)
//   POST /mobil/is-atama/:id/devret     ekip ya da kişi değişikliği / kalan iş devri (planSenkron.ekipDegistir)
// Yetki her uçta sunucuda: taşeron 403, İş Ata yetkisi yoksa 403, alt marka (Teknocenter) kendi firma kapsamı; istemciden gelen
// yetki bayrağına güvenilmez. Fiyat / maaş alanı hiçbir yanıtta yok.
"use strict";

const kodT = (s) => String(s || "").replace(/\s+/g, "").toUpperCase();
const temiz = (s, n = 500) => String(s ?? "").trim().replace(/\s+/g, " ").slice(0, n);
const bugunTR = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const gunEkle = (t, n) => { const d = new Date(`${t}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const tarihMi = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").slice(0, 10));
const tsMi = (v) => v && !isNaN(new Date(v).getTime());
// DATE kolonları JSON'da UTC'ye kayar (yerel gece yarısı → bir önceki gün 21:00Z): mobil yanıtta YYYY-MM-DD metni verilir
const gunStr = (d) => (d ? (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.slice(0, 10)) && d.length <= 10 ? d : new Date(new Date(d).getTime() + 3 * 3600e3).toISOString().slice(0, 10)) : null);
const satirGun = (row) => (row ? { ...row, plan_tarihi: gunStr(row.plan_tarihi) } : row);
const ACIK = ["ATANDI", "BASLADI", "DEVAM", "ARA_VERILDI", "QC_BEKLE"];
const GECMIS_TIP = { OLUSTURMA: "Atama oluşturuldu", DUZENLEME: "Düzenlendi", PLAN_ZAMAN: "Tarih / saat değişti", EKIP_DEGISTIR: "Ekip değişti", KALAN_DEVIR: "Kalan iş devredildi",
  IPTAL: "İptal edildi", SILME: "Silindi", BASLAMA: "İşe başlandı", BITIS: "Gün kapatıldı / iş bitti" };

function kur(app, deps) {
  const { pool, authMiddleware, isAtamaYetkiliMi, isAtamaOlustur, isAtamaDetay, isAtamaTablolar, planTablolar, planEkipleri, planMesguliyet, planAra, haritaVerisi,
    kapsamIsKodlari, personelListesi, markaKapisi, markaIsAtamaSuz, rolloutKapsam, fiiliDurum, hwMalzeme, islemGecmisiYaz, planSenkron, taseronMu, rolloutFark } = deps;
  const H = (durum, mesaj, ek) => Object.assign(new Error(mesaj), { durum, mesaj, ek });
  const hata = (res, e) => { if (e && e.durum) return res.status(e.durum).json({ ok: false, error: e.mesaj || e.message, ...(e.ek || {}) }); console.error("MOBIL IS ATAMA:", e.message); res.status(500).json({ ok: false, error: e.message }); };
  const kapi = (req) => { if (taseronMu(req.user)) throw H(403, "Yetkiniz yok"); if (!isAtamaYetkiliMi(req)) throw H(403, "İş atama yetkiniz yok"); };
  const ben = (req) => String(req.user?.email || "").toLowerCase().trim();
  const kisiCoz = (liste) => { const out = []; for (const p of Array.isArray(liste) ? liste : []) { const e = String(p?.email || "").toLowerCase().trim(); if (e && !out.some((x) => x.email === e)) out.push({ email: e, ad: String(p?.ad || e).trim() }); } return out; };

  // Ekip kartları: üyeler + mobil hesap ulaşımı (planSenkron.ekipUlasim) — "atama personele ulaşmış" gibi gösterilmesin
  async function ekipKartlari(req) {
    const ekipler = await planEkipleri(req);
    const out = [];
    for (const e of ekipler) {
      const u = await planSenkron.ekipUlasim(pool, e);
      out.push({ ekip_no: e.ekip_no, ad: e.ad, bolge: e.bolge, tip: hwMalzeme.ekipTipi(e).kod, firma: e.firma, firma_adi: e.firma_adi, plaka: e.plaka, sef: e.sef ? { ad: e.sef.ad, telefon: e.sef.telefon } : null,
        uyeler: e.uyeler.map((x) => ({ ad: x.ad, email: x.email, unvan: x.unvan, ulasir: u.ulasan.some((y) => y.email === x.email), neden: u.eksik.find((y) => y.ad === x.ad)?.neden || null })),
        ulasim: { ulasir: u.ulasir, mesaj: u.mesaj, ulasan: u.ulasan.length, eksik: u.eksik.length } });
    }
    return out;
  }
  // Kişi → ekip eşlemesi (yalnız Teknocenter ekipleri); isimden değil kayıtlı e-postadan
  async function ekipUyeHaritasi(req) {
    const m = new Map();
    for (const e of await planEkipleri(req)) for (const u of e.uyeler || []) if (u.email) m.set(String(u.email).toLowerCase(), { ekip_no: e.ekip_no, ad: e.ad, plaka: e.plaka });
    return m;
  }

  app.get("/mobil/is-atama/baslangic", authMiddleware, async (req, res) => {
    try {
      kapi(req);
      await planTablolar();
      const kategoriler = (await pool.query(`SELECT kod, ad, ikon, tekil_site, qc_yazar, alt_tipler, COALESCE(saha_zorunlu,true) AS saha_zorunlu, sira FROM is_kategori WHERE aktif ORDER BY sira, ad`)).rows;
      const ekipler = await ekipKartlari(req);
      const uyeMail = new Set(ekipler.flatMap((e) => e.uyeler.map((u) => u.email).filter(Boolean)));
      const kisiler = (await personelListesi(req)).map((p) => ({ email: p.email, ad: p.ad, bolge: p.bolge, unvan: p.unvan, ekip: p.ekip_bilgisi || null, ekipte: uyeMail.has(String(p.email).toLowerCase()) }));
      const sebepler = (await pool.query(`SELECT kod, ad FROM is_durdurma_sebebi WHERE aktif ORDER BY sira`).catch(() => ({ rows: [] }))).rows;
      res.json({ ok: true, yetkili: true, bugun: bugunTR(), kategoriler, ekipler, kisiler, durdurma_sebepleri: sebepler });
    } catch (e) { hata(res, e); }
  });

  // Site ID / iş kodu araması: Plan Yap 3. adımla aynı kaynak (haritaVerisi — ZORUNLU Teknocenter kapsamı); 2+ karakter; kullanıcı başına 60 sn önbellek
  const _onbellek = new Map();
  app.get("/mobil/is-atama/ara", authMiddleware, async (req, res) => {
    try {
      kapi(req);
      const q = String(req.query.q || "").slice(0, 60);
      if (planAra.normal(q).length < 2) return res.json({ ok: true, kisa: true, sahalar: [], toplam_saha: 0 });
      const anahtar = [req.user?.email, req.user?.marka, req.user?.role, req.user?.tenant].join("|");
      let o = _onbellek.get(anahtar);
      if (!o || Date.now() - o.t > 60000) { const V = await haritaVerisi(req); o = { t: Date.now(), sahalar: V.sahalar }; _onbellek.set(anahtar, o); if (_onbellek.size > 200) _onbellek.delete(_onbellek.keys().next().value); }
      const sonuc = planAra.planAra(o.sahalar, q, { offset: req.query.offset, limit: req.query.limit || 12 });
      // Mevcut açık atamalar (iş kodu bazında) — mükerrer uyarısı ve "kimde" bilgisi
      const kodlar = sonuc.sahalar.flatMap((s) => s.isler.map((i) => kodT(i.site_code)));
      const acik = kodlar.length ? (await pool.query(`SELECT a.id, a.kategori, k.ad AS kategori_ad, a.durum, to_char(a.plan_tarihi,'YYYY-MM-DD') AS plan_tarihi, a.site_codes, a.personeller, (to_jsonb(a)->>'ekip_no')::int AS ekip_no
          FROM is_atama a LEFT JOIN is_kategori k ON k.kod = a.kategori WHERE a.durum = ANY($2::text[]) AND a.site_codes && $1::text[] ORDER BY a.plan_tarihi NULLS LAST, a.id`, [kodlar, ACIK])).rows : [];
      const sahalar = sonuc.sahalar.map((s) => ({ fiziksel_id: s.fiziksel_id, bolge: s.bolge, il: s.il, konum: s.konum,
        isler: s.isler.map((i) => ({ site_code: i.site_code, site_type: i.site_type || null, durum_ad: i.fiili?.ad || i.durum_ad || null, fiili: i.fiili ? { kod: i.fiili.kod, ad: i.fiili.ad, renk: i.fiili.renk, issue: i.fiili.issue || null } : null,
          atanan_ekip: i.atanan_ekip?.ad || null, taseronlar: i.taseronlar || [], plan_aday: i.plan_aday || null,
          acik_atamalar: acik.filter((a) => (a.site_codes || []).map(kodT).includes(kodT(i.site_code))).map((a) => ({ id: a.id, kategori: a.kategori, kategori_ad: a.kategori_ad, durum: a.durum, plan_tarihi: a.plan_tarihi, ekip_no: a.ekip_no, kisiler: (a.personeller || []).map((p) => p.ad || p.email) })) })) }));
      res.json({ ok: true, q, sahalar, toplam_saha: sonuc.toplam_saha, toplam_is: sonuc.toplam_is, kalan_saha: sonuc.kalan_saha });
    } catch (e) { hata(res, e); }
  });

  // Kayıt öncesi kontrol: aynı girdiyle çakışma / mükerrer / ulaşım — hiçbir şey yazmaz
  async function kontrolEt(req, b) {
    await planTablolar();
    const sites = [...new Set((Array.isArray(b.site_codes) ? b.site_codes : [b.site_codes]).map(kodT).filter(Boolean))];
    let kisiler = kisiCoz(b.personeller);
    let ekip = null;
    if (b.ekip_no != null && b.ekip_no !== "") { ekip = (await planEkipleri(req, Number(b.ekip_no)))[0] || null; if (!ekip) throw H(403, "Seçilen ekip bulunamadı ya da kapsamınızda değil"); if (!kisiler.length) kisiler = kisiCoz(ekip.uyeler); }
    const gun = tsMi(b.plan_baslangic) ? new Date(new Date(b.plan_baslangic).getTime() + 3 * 3600e3).toISOString().slice(0, 10) : tarihMi(b.plan_tarihi) ? String(b.plan_tarihi).slice(0, 10) : null;
    const uyarilar = [], engeller = [];
    // 1) Mükerrer: aynı kategori + iş kodunda açık atama (sunucu kayıtta 409 verir; burada önceden gösterilir)
    let mukerrer = [];
    if (sites.length && b.kategori) {
      mukerrer = (await pool.query(`SELECT id, durum, site_codes, personeller, to_char(plan_tarihi,'YYYY-MM-DD') AS plan_tarihi, atayan_ad FROM is_atama WHERE kategori = $1 AND durum = ANY($3::text[]) AND site_codes && $2::text[] ORDER BY id`, [String(b.kategori), sites, ACIK])).rows
        .map((x) => ({ id: x.id, durum: x.durum, site_codes: x.site_codes, plan_tarihi: x.plan_tarihi, atayan_ad: x.atayan_ad, kisiler: (x.personeller || []).map((p) => p.ad || p.email) }));
      for (const m of mukerrer) engeller.push(`#${m.id}: ${(m.site_codes || []).join(", ")} için açık ${b.kategori} ataması var (${m.kisiler.join(", ") || "taşeron"}${m.plan_tarihi ? `, ${m.plan_tarihi}` : ""}) — yeni atama yerine mevcut atamayı güncelleyin`);
    }
    // 2) Kişilerin o günkü diğer işleri + plan bloğu çakışmaları (planMesguliyet: plan blokları + saatsiz açık atamalar + araç bakım)
    let cakisma = [];
    if (gun && (kisiler.length || ekip)) {
      const sahte = { ekip_no: ekip ? ekip.ekip_no : -1, plaka: ekip?.plaka || null, uyeler: kisiler.map((p) => ({ ad: p.ad, email: p.email })) };
      const bas = tsMi(b.plan_baslangic) ? b.plan_baslangic : null, bit = tsMi(b.plan_bitis) ? b.plan_bitis : null;
      const m = await planMesguliyet(sahte, gun, gun);
      cakisma = m.filter((x) => !bas || !bit || !x.bas || !x.bit || (x.bas < new Date(new Date(bit).getTime() + 3 * 3600e3).toISOString().slice(11, 16) && x.bit > new Date(new Date(bas).getTime() + 3 * 3600e3).toISOString().slice(11, 16)));
      const digerIsler = (await pool.query(`SELECT a.id, a.kategori, k.ad AS kategori_ad, a.durum, a.site_codes, to_char(a.plan_tarihi,'YYYY-MM-DD') AS plan_tarihi, a.personeller
          FROM is_atama a LEFT JOIN is_kategori k ON k.kod = a.kategori WHERE a.durum = ANY($2::text[]) AND a.plan_tarihi = $1::date`, [gun, ACIK])).rows
        .filter((a) => (a.personeller || []).some((p) => kisiler.some((k) => k.email === String(p.email || "").toLowerCase())))
        .map((a) => ({ id: a.id, kategori_ad: a.kategori_ad || a.kategori, durum: a.durum, site_codes: a.site_codes, kisiler: (a.personeller || []).filter((p) => kisiler.some((k) => k.email === String(p.email || "").toLowerCase())).map((p) => p.ad || p.email) }));
      for (const d of digerIsler) uyarilar.push(`${d.kisiler.join(", ")}: aynı gün ${d.kategori_ad} · ${(d.site_codes || []).join(", ") || "sahasız"} (#${d.id}, ${d.durum})`);
      for (const c of cakisma) uyarilar.push(`${c.tarih} ${c.bas}–${c.bit}: ${c.aciklama}`);
      cakisma = [...digerIsler.map((d) => ({ tur: "ATAMA", ...d })), ...cakisma.map((c) => ({ tur: "PLAN", ...c }))];
    }
    // 3) Ulaşım: seçilen kişilerin mobil hesabı
    const ulasim = kisiler.length ? await planSenkron.ekipUlasim(pool, { ad: ekip ? ekip.ad : "Seçilen personel", uyeler: kisiler.map((p) => ({ ad: p.ad, email: p.email })), sef: ekip?.sef || null }) : null;
    if (ulasim && !ulasim.ulasir) uyarilar.push(ulasim.mesaj);
    else if (ulasim && ulasim.eksik.length) uyarilar.push(ulasim.mesaj);
    // 4) Malzeme başka ekipte mi (bilgi)
    if (sites.length && ekip) {
      const d = await hwMalzeme.durumHaritasi(pool, sites).catch(() => new Map());
      for (const sc of sites) { const baska = (d.get(sc)?.ekipte || []).filter((e) => Number(e.ekip_no) !== Number(ekip.ekip_no)); if (baska.length) uyarilar.push(`${sc}: malzeme ${baska.map((e) => e.ad).join(", ")} üzerinde — atama malzemeyi devretmez`); }
    }
    return { ok: true, gun, mukerrer, cakisma, ulasim, uyarilar, engeller, uygun: engeller.length === 0 };
  }
  app.post("/mobil/is-atama/kontrol", authMiddleware, async (req, res) => {
    try { kapi(req); res.json(await kontrolEt(req, req.body || {})); } catch (e) { hata(res, e); }
  });

  app.post("/mobil/is-atama", authMiddleware, async (req, res) => {
    try {
      kapi(req);
      const b = req.body || {};
      const sites = (Array.isArray(b.site_codes) ? b.site_codes : [b.site_codes]).map(kodT).filter(Boolean);
      const mk = await markaKapisi(req, String(b.kategori || ""), sites); if (mk) throw H(403, mk);
      // Ekip seçildi ama kişiler gönderilmediyse ekibin e-postalı üyeleri atanır (ulaşımı olmayanlar yanıtta açıkça belirtilir)
      let kisiler = kisiCoz(b.personeller);
      if (!kisiler.length && b.ekip_no != null && b.ekip_no !== "") { const e = (await planEkipleri(req, Number(b.ekip_no)))[0]; if (!e) throw H(403, "Seçilen ekip bulunamadı ya da kapsamınızda değil"); kisiler = kisiCoz(e.uyeler); }
      const { _http, ...cevap } = await isAtamaOlustur(req, { ...b, personeller: kisiler }, { kanal: "mobil", teknoKapsam: kapsamIsKodlari });
      res.status(_http || 200).json({ ...cevap, row: satirGun(cevap.row) });
    } catch (e) { hata(res, e); }
  });

  // Liste: kapsamdaki atamalar, telefon kartı alanlarıyla
  app.get("/mobil/is-atama/liste", authMiddleware, async (req, res) => {
    try {
      kapi(req);
      await planTablolar();
      const f = String(req.query.filtre || "bugun");
      const bugun = bugunTR();
      const where = [], params = [];
      if (f === "bugun") { where.push(`a.durum = ANY($1::text[]) AND (a.plan_tarihi <= $2::date OR a.durum IN ('BASLADI','DEVAM','ARA_VERILDI'))`); params.push(ACIK, bugun); }
      else if (f === "gelecek") { where.push(`a.durum = ANY($1::text[]) AND a.plan_tarihi > $2::date`); params.push(ACIK, bugun); }
      else if (f === "devam") { where.push(`a.durum IN ('BASLADI','DEVAM','ARA_VERILDI','QC_BEKLE')`); }
      else if (f === "tamamlanan") { where.push(`a.durum = 'TAMAMLANDI' AND a.updated_at > NOW() - INTERVAL '90 days'`); }
      else if (f === "iptal") { where.push(`a.durum = 'IPTAL' AND a.updated_at > NOW() - INTERVAL '90 days'`); }
      else if (f === "tumu") { where.push(`(a.durum = ANY($1::text[]) OR a.updated_at > NOW() - INTERVAL '90 days')`); params.push(ACIK); }
      if (req.query.durum) { params.push(String(req.query.durum).toUpperCase()); where.push(`a.durum = $${params.length}`); }
      if (req.query.kategori) { params.push(String(req.query.kategori)); where.push(`a.kategori = $${params.length}`); }
      if (req.query.bolge) { params.push(String(req.query.bolge)); where.push(`a.bolge = $${params.length}`); }
      if (req.query.q) { params.push(`%${kodT(req.query.q)}%`); where.push(`EXISTS (SELECT 1 FROM unnest(a.site_codes) sc WHERE UPPER(REPLACE(sc,' ','')) LIKE $${params.length}) OR UPPER(COALESCE(to_jsonb(a)->>'konum_aciklama','')) LIKE $${params.length}`); }
      const r = await pool.query(`SELECT a.id, a.kategori, k.ad AS kategori_ad, k.ikon AS kategori_ikon, a.alt_tip, a.site_codes, a.bolge, a.personeller, to_char(a.plan_tarihi,'YYYY-MM-DD') AS plan_tarihi,
          a.plan_baslangic, a.plan_bitis, a.ekip_no, a.arac_plaka, a.durum, a.baslama_ts, a.bitis_ts, a.atayan_ad, a.atayan_not, a.konum_aciklama, a.taseron_id, a.plan_surum, a.updated_at, a.iptal_nedeni,
          EXISTS (SELECT 1 FROM is_atama_plan_segment s WHERE s.is_atama_id = a.id) AS planli
        FROM is_atama a LEFT JOIN is_kategori k ON k.kod = a.kategori ${where.length ? "WHERE " + where.map((w) => `(${w})`).join(" AND ") : ""}
        ORDER BY CASE a.durum WHEN 'BASLADI' THEN 0 WHEN 'ARA_VERILDI' THEN 1 WHEN 'DEVAM' THEN 1 WHEN 'ATANDI' THEN 2 WHEN 'QC_BEKLE' THEN 3 ELSE 4 END,
          CASE WHEN a.durum IN ('TAMAMLANDI','IPTAL') THEN NULL ELSE a.plan_tarihi END ASC NULLS LAST, CASE WHEN a.durum IN ('TAMAMLANDI','IPTAL') THEN a.updated_at END DESC, a.id DESC LIMIT 500`, params);
      let rows = r.rows;
      const K = await rolloutKapsam(req);
      if (K) rows = await markaIsAtamaSuz(K, rows, ben(req));
      // ZORUNLU Teknocenter kapsamı: sahalı atamalar yalnız kapsamdaki iş kodlarıyla; sahasız faaliyetler yetkiliye açık
      const kp = await kapsamIsKodlari(req);
      rows = rows.filter((a) => !(a.site_codes || []).length || (a.site_codes || []).every((sc) => kp.kodlar.has(kodT(sc))));
      const uyeMap = await ekipUyeHaritasi(req);
      const ekipAd = new Map((await pool.query(`SELECT ekip_no, ad FROM ekipler`).catch(() => ({ rows: [] }))).rows.map((e) => [Number(e.ekip_no), e.ad || `Ekip ${e.ekip_no}`]));
      const kodlar = [...new Set(rows.flatMap((a) => (a.site_codes || []).map(kodT)))];
      const fiili = await fiiliDurum.durumHaritasi(pool, kodlar).catch(() => new Map());
      if (req.query.ekip_no) rows = rows.filter((a) => Number(a.ekip_no) === Number(req.query.ekip_no) || (a.personeller || []).some((p) => uyeMap.get(String(p.email || "").toLowerCase())?.ekip_no === Number(req.query.ekip_no)));
      const out = rows.map((a) => {
        const ekipNo = a.ekip_no || (a.personeller || []).map((p) => uyeMap.get(String(p.email || "").toLowerCase())?.ekip_no).find(Boolean) || null;
        const fd = (a.site_codes || []).map((sc) => fiili.get(kodT(sc))).filter(Boolean);
        const oncelik = ["YESIL", "SARI", "MAVI", "GRI"];
        const f1 = fd.sort((x, y) => oncelik.indexOf(x.renk) - oncelik.indexOf(y.renk))[0] || null;
        return { id: a.id, kategori: a.kategori, kategori_ad: a.kategori_ad || a.kategori, kategori_ikon: a.kategori_ikon, alt_tip: a.alt_tip, site_codes: a.site_codes || [], bolge: a.bolge, konum_aciklama: a.konum_aciklama,
          kisiler: (a.personeller || []).map((p) => p.ad || p.email), kisi_sayisi: (a.personeller || []).length, ekip_no: ekipNo, ekip_ad: ekipNo ? ekipAd.get(Number(ekipNo)) || `Ekip ${ekipNo}` : null, plaka: a.arac_plaka || null,
          plan_tarihi: a.plan_tarihi, plan_baslangic: a.plan_baslangic, plan_bitis: a.plan_bitis, saatli: !!a.plan_baslangic, planli: a.planli, durum: a.durum, iptal_nedeni: a.iptal_nedeni,
          baslama_ts: a.baslama_ts, bitis_ts: a.bitis_ts, atayan_ad: a.atayan_ad, not_var: !!a.atayan_not, taseron: !!a.taseron_id, plan_surum: a.plan_surum || 1, updated_at: a.updated_at,
          geciken: a.plan_tarihi && a.plan_tarihi < bugun && ["ATANDI"].includes(a.durum), fiili: f1 ? { kod: f1.kod, ad: f1.ad, renk: f1.renk, issue: f1.issue || null, son_bildirim: f1.son_bildirim || null } : null };
      });
      const bolgeler = [...new Set(out.map((x) => x.bolge).filter(Boolean))].sort();
      const ekipler = [...new Map(out.filter((x) => x.ekip_no).map((x) => [x.ekip_no, { ekip_no: x.ekip_no, ad: x.ekip_ad }])).values()].sort((a, b) => String(a.ad).localeCompare(String(b.ad), "tr"));
      res.json({ ok: true, filtre: f, bugun, rows: out, secenekler: { bolgeler, ekipler, durumlar: [...new Set(out.map((x) => x.durum))] } });
    } catch (e) { hata(res, e); }
  });

  // Detay: atama + plan sürümü + geçmiş + son fiilî bildirim + ulaşım + malzeme uyarısı
  async function detayAl(req, id) {
    const row = await planSenkron.islemler.atamaAl(req, id); // yetki + Teknocenter kapsamı (403/404)
    const ekipAd = row.ekip_no ? (await pool.query(`SELECT ad FROM ekipler WHERE ekip_no = $1`, [Number(row.ekip_no)]).catch(() => ({ rows: [] }))).rows[0]?.ad : null;
    const gecmis = (await pool.query(`SELECT id, tip, eski, yeni, aciklama, kullanici, created_at FROM islem_gecmisi WHERE modul = 'is_atama' AND kayit_id = $1 ORDER BY id`, [row.id]).catch(() => ({ rows: [] }))).rows
      .map((g) => ({ id: g.id, tip: g.tip, ad: GECMIS_TIP[g.tip] || g.tip, kullanici: g.kullanici, zaman: g.created_at, eski: g.eski, yeni: g.yeni, aciklama: g.aciklama }));
    const bildirimler = (await pool.query(`SELECT DISTINCT ON (site_code) * FROM is_fiili_bildirim WHERE is_atama_id = $1 ORDER BY site_code, id DESC`, [row.id]).catch((e) => { console.error("SON BILDIRIM:", e.message); return { rows: [] }; })).rows
      .map((x) => ({ site_code: x.site_code, olay: x.olay, issue_turu: x.issue_turu, aciklama: x.aciklama, bildiren_ad: x.bildiren_ad, bildiren_email: x.bildiren_email, kanal: x.kanal, created_at: x.created_at || x.zaman || null }));
    const kisiler = kisiCoz(row.personeller);
    const ulasim = kisiler.length ? await planSenkron.ekipUlasim(pool, { ad: ekipAd || "Atanan personel", uyeler: kisiler.map((p) => ({ ad: p.ad, email: p.email })), sef: null }) : null;
    const kodlar = (row.site_codes || []).map(kodT);
    const fiili = kodlar.length ? await fiiliDurum.durumHaritasi(pool, kodlar).catch(() => new Map()) : new Map();
    const malz = kodlar.length ? await hwMalzeme.durumHaritasi(pool, kodlar).catch(() => new Map()) : new Map();
    const segmentler = (await pool.query(`SELECT bas, bit, tur, ad FROM is_atama_plan_segment WHERE is_atama_id = $1 ORDER BY bas`, [row.id]).catch(() => ({ rows: [] }))).rows;
    const basladi = planSenkron.islemler.baslamisMi(row), bitti = planSenkron.islemler.bitmisMi(row);
    delete row.fiyat_surumleri;
    return { ok: true, row: { ...row, plan_tarihi: gunStr(row.plan_tarihi), ekip_ad: ekipAd || null, plan_surum: row.plan_surum || 1, planli: segmentler.length > 0, segmentler, gecmis, son_bildirimler: bildirimler, ulasim,
      fiili: Object.fromEntries(kodlar.map((k) => [k, fiili.get(k) ? { kod: fiili.get(k).kod, ad: fiili.get(k).ad, renk: fiili.get(k).renk, issue: fiili.get(k).issue || null, qc: fiili.get(k).qc || null } : null])),
      malzeme: Object.fromEntries(kodlar.map((k) => [k, malz.get(k) ? { etiket: malz.get(k).etiket, konum_ad: malz.get(k).konum_ad, ekipte: (malz.get(k).ekipte || []).map((e) => e.ad) } : null])),
      devir_hedef: row.devir_hedef_atama_id || null, devir_kaynak: row.devir_kaynak_atama_id || null,
      islemler: { duzenle: !bitti && row.durum !== "IPTAL", iptal: !bitti && row.durum !== "IPTAL", devret: !bitti && row.durum !== "IPTAL", kalan_devir_gerekli: basladi, baslamis: basladi, bitmis: bitti } } };
  }
  app.get("/mobil/is-atama/:id", authMiddleware, async (req, res) => {
    try { kapi(req); res.json(await detayAl(req, req.params.id)); } catch (e) { hata(res, e); }
  });

  // Düzenleme: tarih / saat (plan blokları da güncellenir), not, kişiler (başlanmamış işte); plan_surum eski ise 409
  app.put("/mobil/is-atama/:id", authMiddleware, async (req, res) => {
    try {
      kapi(req);
      const b = req.body || {};
      const row = await planSenkron.islemler.atamaAl(req, req.params.id);
      const mk = await markaKapisi(req, row.kategori, row.site_codes || []); if (mk) throw H(403, mk);
      if (planSenkron.islemler.bitmisMi(row)) throw H(400, "Tamamlanmış iş düzenlenmez; yeniden çalışma gerekiyorsa gerekçeli yeni iş / ziyaret oluşturun");
      if (row.durum === "IPTAL") throw H(400, "İptal edilmiş / aktarılmış atama düzenlenmez");
      if (b.plan_surum != null && Number(b.plan_surum) !== Number(row.plan_surum || 1)) throw H(409, "Bu atama bu arada başkası tarafından değiştirildi — ekranı yenileyip tekrar deneyin", { plan_surum: row.plan_surum });
      const basladi = planSenkron.islemler.baslamisMi(row);
      const yeniKisiler = Array.isArray(b.personeller) ? kisiCoz(b.personeller) : null;
      const kisiDegisti = yeniKisiler && yeniKisiler.map((p) => p.email).sort().join(",") !== kisiCoz(row.personeller).map((p) => p.email).sort().join(",");
      if (kisiDegisti && basladi) throw H(409, "Bu işte çalışma başlamış — kişi / ekip değişikliği için \"Kalan işi devret\" akışını kullanın (gerekçeli)", { kalan_devir_gerekli: true });
      if (kisiDegisti && !yeniKisiler.length && !row.taseron_id) throw H(400, "En az bir personel kalmalı");
      let sonuc = { ok: true };
      // Tarih / saat
      const bas = tsMi(b.plan_baslangic) ? new Date(b.plan_baslangic).toISOString() : null, bit = tsMi(b.plan_bitis) ? new Date(b.plan_bitis).toISOString() : null;
      const yeniGun = tarihMi(b.plan_tarihi) ? String(b.plan_tarihi).slice(0, 10) : null;
      const eskiGun = gunStr(row.plan_tarihi);
      if ((bas && bit) || (yeniGun && yeniGun !== eskiGun) || b.saat_kaldir === true) {
        let nb = bas, nt = bit;
        if (!nb && yeniGun && row.plan_baslangic && row.plan_bitis && b.saat_kaldir !== true) {
          // Yalnız gün değişti, saat korunur: aynı saatler yeni güne kaydırılır
          const kay = (ts) => { const d = new Date(ts); const y = new Date(new Date(ts).getTime() + 3 * 3600e3).toISOString().slice(0, 10); const fark = (new Date(`${yeniGun}T00:00:00Z`) - new Date(`${y}T00:00:00Z`)); return new Date(d.getTime() + fark).toISOString(); };
          nb = kay(row.plan_baslangic); nt = kay(row.plan_bitis);
        }
        if (nb && nt) sonuc = await planSenkron.islemler.zamanDegistir(req, row.id, { bas: nb, bit: nt, gerekce: temiz(b.gerekce, 500), plan_surum: row.plan_surum });
        else {
          // Saatsiz gün: blok yoksa yalnız gün; blok varsa (saat kaldırıldı) bloklar silinir → Weekly Plan'da tüm gün kartı
          await pool.query(`UPDATE is_atama SET plan_tarihi = $2::date, plan_baslangic = NULL, plan_bitis = NULL, plan_surum = COALESCE(plan_surum,1) + 1, updated_at = NOW() WHERE id = $1`, [row.id, yeniGun || eskiGun]);
          await pool.query(`DELETE FROM is_atama_plan_segment WHERE is_atama_id = $1 AND tur IN ('MONTAJ','FAALIYET')`, [row.id]);
          await islemGecmisiYaz(req, "is_atama", row.id, "PLAN_ZAMAN", { plan_tarihi: eskiGun, plan_baslangic: row.plan_baslangic, plan_bitis: row.plan_bitis }, { plan_tarihi: yeniGun || eskiGun, plan_baslangic: null, plan_bitis: null, gerekce: temiz(b.gerekce, 500) });
        }
      }
      // Not / kişiler / alt tip
      const guncel = (await pool.query(`SELECT personeller, atayan_not, alt_tip FROM is_atama WHERE id = $1`, [row.id])).rows[0];
      const set = [], prm = [row.id];
      if (typeof b.atayan_not === "string") { prm.push(temiz(b.atayan_not, 2000)); set.push(`atayan_not = $${prm.length}`); }
      if (typeof b.alt_tip === "string") { prm.push(b.alt_tip || null); set.push(`alt_tip = $${prm.length}`); }
      if (kisiDegisti) {
        const kh = await deps.isAtamaPersonelKapsamHatasi(req, yeniKisiler); if (kh) throw H(403, kh);
        prm.push(JSON.stringify(yeniKisiler)); set.push(`personeller = $${prm.length}::jsonb`);
        if (b.ekip_no !== undefined) { prm.push(b.ekip_no === null || b.ekip_no === "" ? null : Number(b.ekip_no)); set.push(`ekip_no = $${prm.length}`); }
      }
      if (set.length) {
        await pool.query(`UPDATE is_atama SET ${set.join(", ")}, plan_surum = COALESCE(plan_surum,1) + 1, updated_at = NOW() WHERE id = $1`, prm);
        if (kisiDegisti) await pool.query(`UPDATE is_atama_plan_segment SET personeller = $2 WHERE is_atama_id = $1`, [row.id, yeniKisiler.map((p) => p.email)]);
        if (kisiDegisti && row.kategori === "CLEANUP" && yeniKisiler[0]) await pool.query(`UPDATE rollout_cleanup SET atanan_email = $2, atanan_ad = $3, updated_at = NOW() WHERE is_atama_id = $1`, [row.id, yeniKisiler[0].email, yeniKisiler[0].ad]);
        const sonra = (await pool.query(`SELECT personeller, atayan_not, alt_tip FROM is_atama WHERE id = $1`, [row.id])).rows[0];
        const fark = rolloutFark(guncel, sonra);
        if (fark.degisti) await islemGecmisiYaz(req, "is_atama", row.id, "DUZENLEME", fark.eski, fark.yeni, temiz(b.gerekce, 500) || null);
      }
      const d = await detayAl(req, row.id);
      res.json({ ...sonuc, ...d, ulasim: d.row.ulasim });
    } catch (e) { hata(res, e); }
  });

  app.post("/mobil/is-atama/:id/iptal", authMiddleware, async (req, res) => {
    try {
      kapi(req);
      const row = await planSenkron.islemler.atamaAl(req, req.params.id);
      const mk = await markaKapisi(req, row.kategori, row.site_codes || []); if (mk) throw H(403, mk);
      const s = await planSenkron.islemler.iptalEt(req, req.params.id, req.body || {}); res.json({ ...s, row: satirGun(s.row) });
    } catch (e) { hata(res, e); }
  });
  app.post("/mobil/is-atama/:id/devret", authMiddleware, async (req, res) => {
    try {
      kapi(req);
      const row = await planSenkron.islemler.atamaAl(req, req.params.id);
      const mk = await markaKapisi(req, row.kategori, row.site_codes || []); if (mk) throw H(403, mk);
      const s = await planSenkron.islemler.ekipDegistir(req, req.params.id, req.body || {}); res.json({ ...s, row: satirGun(s.row) });
    } catch (e) { hata(res, e); }
  });
}

module.exports = { kur, ACIK, GECMIS_TIP };
