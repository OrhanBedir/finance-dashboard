// ═══ OPERASYON EKRANLARI (31.10.2026, Orhan) — Rollout Weekly Plan · Ekipler nerede? · fiilî çalışma bildirimi ═══════
// Web ve mobil AYNI uçları kullanır. Kaynaklar mevcut tablolardır (paralel sistem yok):
//   plan        is_atama_plan_segment (saatli plan blokları) + is_atama (saatsiz eski atamalar: plan_tarihi = tüm gün)
//   ekip        ekipler + personel (planEkipleri: şef, telefon, plaka, üyeler) — ekip tipi YALNIZ ekipler.ekip_turu'ndan
//   fiilî       fiiliDurum (is_fiili_bildirim + is_atama başla/bitir + Rollout tarihleri) — QC'den bağımsız
//   malzeme     hwMalzeme.durumHaritasi (HW malzeme kabul / teslim hareketleri)
// Kapsam (02.11.2026, Orhan): Weekly Plan ve "Ekipler nerede?" ERC yöneticisi dahil herkes için YALNIZ Teknocenter kapsamıdır —
// iş kodları haritayla aynı zorunlu firma süzgecinden (haritaFirmaSuzgeci → haritaKapsamSatirlari), ekipler Teknocenter iç ekipleri ve
// doğrulanmış Tekno taşeron ekipleri (planEkipleri). Başka firmanın işi, sahasız faaliyeti ya da ekibi kartta, sayıda ve Excel'de yer
// almaz. Fiyat / maaş hiçbir yanıtta ve Excel'de yok; iç notlar (atayan notu, kapanış notu) Excel'e yazılmaz.
"use strict";

const GUN_AD = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const tarihMi = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const bugun = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const gunEkle = (t, n) => { const d = new Date(`${t}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const haftaGunu = (t) => new Date(`${t}T00:00:00Z`).getUTCDay();
const pazartesi = (t) => gunEkle(t, -((haftaGunu(t) + 6) % 7));
const yerel = (ts) => { const d = new Date(new Date(ts).getTime() + 3 * 3600e3); return { tarih: d.toISOString().slice(0, 10), saat: d.toISOString().slice(11, 16) }; };
const kodT = (s) => String(s || "").replace(/\s+/g, "").toUpperCase();
const liste = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
const tr = (s) => String(s || "").toLocaleUpperCase("tr-TR").replace(/İ/g, "I");

function kur(app, deps) {
  const { pool, authMiddleware, planEkipleri, planTablolar, rolloutKapsam, haritaKapsamSatirlari, haritaFirmaSuzgeci, zorunluFirma, sahaKimlik, hwMalzeme, fiiliDurum, ExcelJS, planSenkron } = deps;
  fiiliDurum.semaKur(pool).catch(() => {});
  const gorKapi = (req, res) => {
    if (deps.taseronMu(req.user) || req.user?.kullanici_tipi === "TASERON") { res.status(403).json({ ok: false, error: "Yetkiniz yok" }); return false; }
    if (req.izinler?.operasyon_goruntule !== true) { res.status(403).json({ ok: false, error: "Operasyon ekranları görüntüleme yetkiniz yok" }); return false; }
    return true;
  };
  // İstekteki kapsam (aynı istekte bir kez): her hesapta zorunlu Teknocenter iş kodu kümesi (haritayla aynı süzgeç)
  async function kapsam(req) {
    if (req._opKapsam) return req._opKapsam;
    const K = await rolloutKapsam(req);
    const fs = await haritaFirmaSuzgeci(req, K);
    if (fs.hata) { const e = new Error(fs.hata[1]); e.durum = fs.hata[0]; throw e; }
    const { rows, yalnizGunluk } = await haritaKapsamSatirlari(K, fs.FM);
    const rowMap = new Map(rows.map((r) => [kodT(r.site_code), r]));
    const kodlar = new Set([...rowMap.keys(), ...yalnizGunluk]);
    return (req._opKapsam = { K, FM: fs.FM, rowMap, kodlar });
  }
  // Ekip Teknocenter'ın mı: iç ekip (bagli_firma TEKNO) ya da firma adı doğrulanmış eşleşme veren dış ekip (planEkipleri.firma)
  const teknoEkip = (e) => String(e.firma || "").toUpperCase() === String(zorunluFirma || "TEKNO").toUpperCase();
  const ekipFiltre = (q) => {
    const bolgeler = liste(q.bolge).map(tr), firmalar = liste(q.firma).map((x) => x.toUpperCase()), tipler = liste(q.tip).map((x) => x.toUpperCase()), ekipNo = liste(q.ekip).map(Number);
    return (e) => (!bolgeler.length || bolgeler.includes(tr(e.bolge))) && (!firmalar.length || firmalar.includes(String(e.firma || "").toUpperCase()))
      && (!tipler.length || tipler.includes(hwMalzeme.ekipTipi(e).kod)) && (!ekipNo.length || ekipNo.includes(Number(e.ekip_no)));
  };
  const ekipKart = (e, telefonGoster = true) => ({ ekip_no: e.ekip_no, ad: e.ad, bolge: e.bolge, firma: e.firma, firma_adi: e.firma_adi || null, tip: hwMalzeme.ekipTipi(e),
    sef: e.sef ? { ad: e.sef.ad, telefon: telefonGoster ? e.sef.telefon || null : null, kaynak: e.sef.kaynak } : null, plaka: e.plaka || null, uye_sayisi: (e.uyeler || []).length });

  // ── Haftalık plan verisi (ekran + Excel ortak) ──
  async function haftalikVeri(req) {
    await planTablolar();
    const bas = pazartesi(tarihMi(req.query.hafta) ? req.query.hafta : bugun());
    const bit = gunEkle(bas, 6);
    const kp = await kapsam(req);
    // Ekip kapsamı planEkipleri'nden (ekipler tablosundaki tipler: IC + DIS); ekip_turu'na eklenen yeni alanlar gerekmez
    const ekipler0 = await planEkipleri(req);
    const eTur = new Map((await pool.query(`SELECT ekip_no, ekip_turu FROM ekipler`).catch(() => ({ rows: [] }))).rows.map((x) => [Number(x.ekip_no), x.ekip_turu]));
    for (const e of ekipler0) e.ekip_turu = eTur.get(Number(e.ekip_no)) ?? e.ekip_turu ?? null;
    const ekipler = ekipler0.filter(teknoEkip).filter(ekipFiltre(req.query));
    const eMap = new Map(ekipler.map((e) => [Number(e.ekip_no), e]));
    const seg = (await pool.query(`SELECT s.*, a.durum AS atama_durum, a.kategori AS atama_kategori, a.plan_detay, k.ad AS kategori_ad, k.ikon
        FROM is_atama_plan_segment s LEFT JOIN is_atama a ON a.id = s.is_atama_id LEFT JOIN is_kategori k ON k.kod = COALESCE(s.kategori, a.kategori)
      WHERE s.ekip_no = ANY($1::int[]) AND s.bas < ($3::date + 1)::timestamptz AND s.bit > $2::date::timestamptz AND (a.id IS NULL OR a.durum <> 'IPTAL') ORDER BY s.bas`,
      [[...eMap.keys()], bas, bit]).catch(() => ({ rows: [] }))).rows;
    // Saatsiz (plan bloğu olmayan) atamalar: ekip_no'lu ya da ekip üyesine atanmış
    const uyeEkip = new Map(); for (const e of ekipler) for (const u of e.uyeler || []) if (u.email) uyeEkip.set(u.email, Number(e.ekip_no));
    const sz = (await pool.query(`SELECT a.id, a.kategori, a.durum, a.site_codes, to_char(a.plan_tarihi,'YYYY-MM-DD') AS plan_tarihi, (to_jsonb(a)->>'ekip_no')::int AS ekip_no,
        a.personeller, a.plan_detay, k.ad AS kategori_ad, k.ikon, to_jsonb(a)->>'konum_aciklama' AS konum_aciklama
      FROM is_atama a LEFT JOIN is_kategori k ON k.kod = a.kategori
      WHERE a.durum <> 'IPTAL' AND a.plan_tarihi BETWEEN $1 AND $2 AND NOT EXISTS (SELECT 1 FROM is_atama_plan_segment s WHERE s.is_atama_id = a.id)`, [bas, bit]).catch(() => ({ rows: [] }))).rows;
    // Kartlar
    const kartlar = [];
    const isKodlari = new Set();
    const kapsamda = (kod) => !kod || kp.kodlar.has(kod); // 02.11.2026: her hesapta zorunlu Tekno kapsamı (sahasız faaliyet yalnız Tekno ekibinde)
    // Aynı atamanın blokları: çok günlük devamlılık (gün x / toplam)
    const atamaGunleri = new Map();
    for (const s of seg) if (s.is_atama_id && ["MONTAJ", "FAALIYET"].includes(s.tur)) { const g = yerel(s.bas).tarih; const m = atamaGunleri.get(s.is_atama_id) || new Set(); m.add(g); atamaGunleri.set(s.is_atama_id, m); }
    const tumGunler = new Map();
    if (atamaGunleri.size) for (const x of (await pool.query(`SELECT is_atama_id, array_agg(DISTINCT to_char(bas + interval '3 hours','YYYY-MM-DD') ORDER BY to_char(bas + interval '3 hours','YYYY-MM-DD')) AS gunler
        FROM is_atama_plan_segment WHERE is_atama_id = ANY($1::int[]) AND tur IN ('MONTAJ','FAALIYET') GROUP BY is_atama_id`, [[...atamaGunleri.keys()]])).rows) tumGunler.set(x.is_atama_id, x.gunler);
    const birlesik = new Map(); // atama × gün → tek kart (molayla bölünen bloklar birleşir)
    for (const s of seg) {
      const kod = s.site_code ? kodT(s.site_code) : null;
      if (!kapsamda(kod)) continue;
      const y = yerel(s.bas), z = yerel(s.bit);
      if (["YOL", "TESLIM"].includes(s.tur)) {
        kartlar.push({ tur: s.tur, ekip_no: s.ekip_no, tarih: y.tarih, bas: y.saat, bit: y.tarih === z.tarih ? z.saat : "23:59", ad: s.ad, km: s.km != null ? Number(s.km) : null, yol_kaynak: s.yol_kaynak || null });
        continue;
      }
      const anah = `${s.is_atama_id || `s${s.id}`}|${y.tarih}`;
      const o = birlesik.get(anah);
      if (o) { if (y.saat < o.bas) o.bas = y.saat; const zb = y.tarih === z.tarih ? z.saat : "23:59"; if (zb > o.bit) o.bit = zb; continue; }
      if (kod) isKodlari.add(kod);
      const gunler = tumGunler.get(s.is_atama_id) || [y.tarih];
      const pd = s.plan_detay || {};
      const kart = { tur: s.tur, atama_id: s.is_atama_id, ekip_no: s.ekip_no, tarih: y.tarih, bas: y.saat, bit: y.tarih === z.tarih ? z.saat : "23:59", saatli: true,
        site_code: kod, fiziksel_id: kod ? sahaKimlik.fizikselSaha(kod)?.fiziksel_id || kod : null, kategori: s.kategori || s.atama_kategori, is_turu: s.kategori_ad || s.ad, ikon: s.ikon || null,
        ad: s.ad, gun_no: gunler.indexOf(y.tarih) + 1, gun_toplam: gunler.length, plan_durum: s.atama_durum || null,
        par: pd.par && (pd.par.par_id || pd.par.kesinti) ? pd.par : null, sure_gun: pd.sure_gun ?? null };
      birlesik.set(anah, kart); kartlar.push(kart);
    }
    for (const a of sz) {
      const kodlar = (a.site_codes || []).map(kodT).filter(Boolean);
      if (kodlar.some((k) => !kapsamda(k))) continue;
      let ekipNo = a.ekip_no && eMap.has(Number(a.ekip_no)) ? Number(a.ekip_no) : null;
      if (!ekipNo) for (const p of a.personeller || []) { const n = uyeEkip.get(String(p?.email || "").toLowerCase()); if (n) { ekipNo = n; break; } }
      if (!ekipNo) continue;
      for (const kod of kodlar.length ? kodlar : [null]) {
        if (kod) isKodlari.add(kod);
        kartlar.push({ tur: "ATAMA", atama_id: a.id, ekip_no: ekipNo, tarih: a.plan_tarihi, bas: null, bit: null, saatli: false, site_code: kod,
          fiziksel_id: kod ? sahaKimlik.fizikselSaha(kod)?.fiziksel_id || kod : null, kategori: a.kategori, is_turu: a.kategori_ad || a.kategori, ikon: a.ikon || null,
          ad: kod || a.konum_aciklama || a.kategori_ad, konum_aciklama: a.konum_aciklama || null, gun_no: 1, gun_toplam: 1, plan_durum: a.durum, par: a.plan_detay?.par || null });
      }
    }
    const kodList = [...isKodlari];
    const fiili = await fiiliDurum.durumHaritasi(pool, kodList, { rows: kp.rowMap });
    const malz = await hwMalzeme.durumHaritasi(pool, kodList, { rows: kp.rowMap, montajMap: fiili });
    for (const k of kartlar) if (k.site_code) {
      const f = fiili.get(k.site_code), m = malz.get(k.site_code), r = kp.rowMap.get(k.site_code);
      k.fiili = f ? { kod: f.kod, ad: f.ad, renk: f.renk, issue: f.issue, son_bildirim: f.son_bildirim, son_bildirim_eski: f.son_bildirim_eski } : null;
      k.malzeme = m ? { etiket: m.etiket, teslim: m.teslim, konum: m.konum } : null;
      k.il = r?.il || null; k.bolge = r?.bolge || null; k.qc = f?.qc || null;
    } else if (k.tur !== "YOL" && k.tur !== "TESLIM") k.fiili = { kod: k.plan_durum === "TAMAMLANDI" ? "TAMAMLANDI" : ["BASLADI", "DEVAM"].includes(k.plan_durum) ? "DEVAM" : "PLANLANDI",
      renk: k.plan_durum === "TAMAMLANDI" ? "YESIL" : ["BASLADI", "DEVAM"].includes(k.plan_durum) ? "SARI" : "MAVI" };
    const son = await fiiliDurum.ekipSonBildirim(pool, [...eMap.keys()]);
    const telefon = req.query.telefon !== "0";
    return { hafta_bas: bas, hafta_bit: bit, bugun: bugun(), gunler: Array.from({ length: 7 }, (_, i) => { const t = gunEkle(bas, i); return { tarih: t, ad: GUN_AD[haftaGunu(t)], tatil: haftaGunu(t) === 0 }; }),
      ekipler: ekipler.map((e) => ({ ...ekipKart(e, telefon), son_bildirim: son.get(Number(e.ekip_no)) || null,
        kartlar: kartlar.filter((k) => Number(k.ekip_no) === Number(e.ekip_no)).sort((a, b) => (a.tarih + (a.bas || "00:00")).localeCompare(b.tarih + (b.bas || "00:00"))) })),
      kapsam_firma: zorunluFirma || "TEKNO",
      secenekler: { bolgeler: [...new Set(ekipler0.filter(teknoEkip).map((e) => e.bolge).filter(Boolean))].sort(), firmalar: [...new Set(ekipler0.filter(teknoEkip).map((e) => e.firma).filter(Boolean))].sort(),
        ekipler: ekipler0.filter(teknoEkip).map((e) => ({ ekip_no: e.ekip_no, ad: e.ad, bolge: e.bolge, tip: hwMalzeme.ekipTipi(e).kod })) },
      renk_aciklama: { MAVI: "Planlandı / başlamadı", SARI: "Devam ediyor", YESIL: "Fiziksel montaj tamamlandı", GRI: "Doğrulanmadı" } };
  }

  app.get("/operasyon/haftalik", authMiddleware, async (req, res) => {
    try { if (!gorKapi(req, res)) return; res.json({ ok: true, ...(await haftalikVeri(req)) }); }
    catch (e) { if (!e.durum) console.error("HAFTALIK PLAN ERROR:", e.message); res.status(e.durum || 500).json({ ok: false, error: e.message }); }
  });

  // ── Müşteriye gönderilebilir haftalık Excel: fiyat / maaş / iç not YOK; gridlines kapalı ──
  app.get("/operasyon/haftalik/excel", authMiddleware, async (req, res) => {
    try {
      if (!gorKapi(req, res)) return;
      const K = await rolloutKapsam(req);
      if (K && !K.excel) return res.status(403).json({ ok: false, error: "Excel yetkiniz yok" });
      const v = await haftalikVeri(req);
      const fmt = (t) => t.split("-").reverse().join(".");
      const wb = new ExcelJS.Workbook(); wb.creator = "ERC / Omnix";
      const ws = wb.addWorksheet("Weekly Plan", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
      const KOL = [["Tarih", 11], ["Gün", 11], ["Ekip", 18], ["Ekip şefi", 20], ["Telefon", 15], ["Araç plakası", 12], ["Site ID", 10], ["Tam iş kodu", 26], ["İl", 13],
        ["Yapılacak iş", 26], ["Planlanan zaman", 15], ["Çok günlük iş", 12], ["PAR / kesinti", 24]];
      ws.columns = KOL.map(([, w]) => ({ width: w }));
      ws.mergeCells(1, 1, 1, KOL.length);
      ws.getCell(1, 1).value = `Teknocenter Weekly Plan · ${fmt(v.hafta_bas)} – ${fmt(v.hafta_bit)}`;
      ws.getCell(1, 1).font = { bold: true, size: 15, color: { argb: "FF1E3A5F" } };
      ws.mergeCells(2, 1, 2, KOL.length);
      const f = [liste(req.query.bolge).length ? `Bölge: ${liste(req.query.bolge).join(", ")}` : null, liste(req.query.firma).length ? `Firma: ${liste(req.query.firma).join(", ")}` : null,
        liste(req.query.tip).length ? `Ekip tipi: ${liste(req.query.tip).join(", ")}` : null].filter(Boolean).join(" · ");
      ws.getCell(2, 1).value = `Planlanan çalışmalardır; saatler Türkiye saatidir.${f ? ` Filtre: ${f}.` : ""} Hazırlanma: ${new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 16).replace("T", " ")}`;
      ws.getCell(2, 1).font = { italic: true, size: 9, color: { argb: "FF64748B" } };
      const h = ws.getRow(4); KOL.forEach(([ad], i) => { h.getCell(i + 1).value = ad; });
      h.font = { bold: true, color: { argb: "FFFFFFFF" } }; h.alignment = { vertical: "middle", wrapText: true }; h.height = 28;
      h.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } }; });
      let n = 5;
      const satirlar = [];
      for (const e of v.ekipler) for (const k of e.kartlar) {
        if (!["MONTAJ", "FAALIYET", "ATAMA"].includes(k.tur)) continue;
        const par = k.par ? [k.par.par_id ? `PAR ${k.par.par_id}` : "PAR bekleniyor", k.par.kesinti === "VAR" ? `kesinti var${k.par.kesinti_dk ? ` (${k.par.kesinti_dk} dk)` : ""}` : k.par.kesinti === "YOK" ? "kesinti yok" : null, k.par.bas && k.par.bit ? `${k.par.bas}–${k.par.bit}` : null].filter(Boolean).join(" · ") : "";
        satirlar.push([k.tarih, GUN_AD[haftaGunu(k.tarih)], e.ad, e.sef?.ad || "Kayıtlı değil", e.sef ? e.sef.telefon || "Kayıtlı değil" : "", e.plaka || "Kayıtlı değil",
          k.fiziksel_id || "—", k.site_code || (k.konum_aciklama ? `(${k.konum_aciklama})` : "—"), k.il || "", k.is_turu || k.ad || "",
          k.saatli ? `${k.bas}–${k.bit}` : "Tüm gün", k.gun_toplam > 1 ? `${k.gun_no}. gün / ${k.gun_toplam}` : "", par]);
      }
      satirlar.sort((a, b) => (a[0] + a[2] + a[10]).localeCompare(b[0] + b[2] + b[10]));
      for (const s of satirlar) {
        const r = ws.getRow(n++); s.forEach((x, i) => { r.getCell(i + 1).value = i === 0 ? fmt(x) : x; });
        r.alignment = { vertical: "top", wrapText: true };
        r.eachCell({ includeEmpty: true }, (c) => { c.border = { bottom: { style: "thin", color: { argb: "FFE2E8F0" } } }; if (n % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } }; });
      }
      if (!satirlar.length) ws.getCell(5, 1).value = "Bu hafta ve filtrede planlı çalışma yok.";
      ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: KOL.length } };
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="teknocenter_weekly_plan_${v.hafta_bas}.xlsx"`);
      await wb.xlsx.write(res); res.end();
    } catch (e) { if (!e.durum) console.error("HAFTALIK EXCEL ERROR:", e.message); res.status(e.durum || 500).json({ ok: false, error: e.message }); }
  });

  // ── Ekipler nerede? (bildirilen son çalışma sahası; canlı GPS değil) ──
  app.get("/operasyon/ekipler-nerede", authMiddleware, async (req, res) => {
    try {
      if (!gorKapi(req, res)) return;
      await planTablolar();
      const kp = await kapsam(req);
      const ekipler0 = await planEkipleri(req);
      const eTur = new Map((await pool.query(`SELECT ekip_no, ekip_turu FROM ekipler`).catch(() => ({ rows: [] }))).rows.map((x) => [Number(x.ekip_no), x.ekip_turu]));
      for (const e of ekipler0) e.ekip_turu = eTur.get(Number(e.ekip_no)) ?? e.ekip_turu ?? null;
      const ekipler = ekipler0.filter(teknoEkip).filter(ekipFiltre(req.query));
      const son = await fiiliDurum.ekipSonBildirim(pool, ekipler.map((e) => Number(e.ekip_no)));
      const g = bugun();
      const plan = (await pool.query(`SELECT ekip_no, site_code, bas, bit FROM is_atama_plan_segment s LEFT JOIN is_atama a ON a.id = s.is_atama_id
        WHERE s.ekip_no = ANY($1::int[]) AND s.tur IN ('MONTAJ','FAALIYET') AND s.bas < ($2::date + 1)::timestamptz AND s.bit > $2::date::timestamptz AND (a.id IS NULL OR a.durum <> 'IPTAL') ORDER BY s.bas`,
        [ekipler.map((e) => Number(e.ekip_no)), g]).catch(() => ({ rows: [] }))).rows;
      const fizIds = new Set();
      const out = ekipler.map((e) => {
        const s = son.get(Number(e.ekip_no)) || null;
        const sonKodlar = s ? s.site_code.split(",").map(kodT).filter((k) => kp.kodlar.has(k)) : [];
        const planKod = [...new Set(plan.filter((p) => Number(p.ekip_no) === Number(e.ekip_no) && p.site_code).map((p) => kodT(p.site_code)).filter((k) => kp.kodlar.has(k)))];
        const sonFiz = sonKodlar.map((k) => sahaKimlik.fizikselSaha(k)?.fiziksel_id || k), planFiz = planKod.map((k) => sahaKimlik.fizikselSaha(k)?.fiziksel_id || k);
        [...sonFiz, ...planFiz].forEach((x) => fizIds.add(x));
        return { ...ekipKart(e), son_bildirim: s && sonKodlar.length ? { site_codes: sonKodlar, fiziksel_idler: [...new Set(sonFiz)], olay: s.olay, zaman: s.zaman, eski: s.eski, kim: s.kim } : null,
          bugun_plan: planKod, bugun_plan_fiziksel: [...new Set(planFiz)],
          plan_farkli: !!(s && sonFiz.length && planFiz.length && !sonFiz.some((x) => planFiz.includes(x))) };
      });
      const kon = fizIds.size ? (await pool.query(`SELECT fiziksel_id, lat, lng, dogruluk, il FROM saha_konum WHERE fiziksel_id = ANY($1)`, [[...fizIds]]).catch(() => ({ rows: [] }))).rows : [];
      const kMap = Object.fromEntries(kon.filter((k) => k.lat != null && ["KESIN", "CELISKILI"].includes(k.dogruluk)).map((k) => [k.fiziksel_id, { lat: Number(k.lat), lng: Number(k.lng), il: k.il }]));
      res.json({ ok: true, ekipler: out, konumlar: kMap, bugun: g, not: "Konum, ekibin bildirdiği son çalışma sahasıdır — canlı GPS izlemesi değildir. 24 saatten eski bildirimler \"eski\" işaretlidir." });
    } catch (e) { if (!e.durum) console.error("EKIPLER NEREDE ERROR:", e.message); res.status(e.durum || 500).json({ ok: false, error: e.message }); }
  });

  // ── Fiilî çalışma bildirimi (mobil + panel): BASLADI / TAMAMLANDI / ISSUE / ISSUE_KAPANDI / GERI_AL ──
  // İş kodu bazında; QC'ye yazmaz. Yetki: işe atanmış personel (atama kaydı üzerinden), o işin taşeron hesabı ya da İş Ata yetkilisi.
  app.post("/is-fiili/bildir", authMiddleware, async (req, res) => {
    try {
      await fiiliDurum.semaKur(pool);
      const b = req.body || {};
      const olay = String(b.olay || "").toUpperCase();
      if (!["BASLADI", "TAMAMLANDI", "ISSUE", "ISSUE_KAPANDI", "GERI_AL"].includes(olay)) return res.status(400).json({ ok: false, error: "Geçersiz bildirim türü" });
      const kod = kodT(b.site_code);
      if (!kod) return res.status(400).json({ ok: false, error: "İş kodu eksik" });
      const anahtar = String(b.istek_anahtari || "").trim().slice(0, 100);
      if (anahtar.length < 8) return res.status(400).json({ ok: false, error: "istek_anahtari eksik" });
      const email = String(req.user?.email || "").toLowerCase().trim();
      const a = b.is_atama_id ? (await pool.query(`SELECT id, durum, site_codes, personeller, (to_jsonb(is_atama)->>'ekip_no')::int AS ekip_no, taseron_id FROM is_atama WHERE id = $1`, [Number(b.is_atama_id)])).rows[0] : null;
      if (b.is_atama_id && !a) return res.status(404).json({ ok: false, error: "İş ataması bulunamadı" });
      if (a && !(a.site_codes || []).map(kodT).includes(kod)) return res.status(400).json({ ok: false, error: "İş kodu bu atamada yok" });
      const yetkili = deps.isAtamaYetkiliMi(req);
      const atanan = a && (deps.isAtamaPersonelIcinde(a, email) || deps.taseronunIsiMi(req, a));
      if (!yetkili && !atanan) return res.status(403).json({ ok: false, error: "Bu iş size atanmamış" });
      if (yetkili && !atanan) { const kp = await kapsam(req); if (kp.K && !kp.kodlar.has(kod)) return res.status(403).json({ ok: false, error: "Bu iş erişim kapsamınızda değil" }); }
      // 02.11.2026: iptal / devredilmiş atamaya çevrimdışı gelen bildirim kaybolmaz → inceleme kuyruğu (409); yetkili ofis kullanıcısı için eski davranış
      if (a && a.durum === "IPTAL") {
        if (planSenkron && !yetkili) return res.status(409).json(await planSenkron.incelemeyeAl(pool, req, a, "fiili", { ...b, istek_anahtari: undefined }, planSenkron.kapaliNeden(a)));
        return res.status(400).json({ ok: false, error: "Atama iptal edilmiş" });
      }
      if (olay === "ISSUE" && String(b.aciklama || "").trim().length < 3 && !b.issue_turu) return res.status(400).json({ ok: false, error: "Issue türünü seçin ya da kısa açıklama yazın" });
      const ins = await pool.query(`INSERT INTO is_fiili_bildirim (is_atama_id, site_code, olay, issue_turu, aciklama, ekip_no, bildiren_email, bildiren_ad, kanal, istek_anahtari)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (bildiren_email, istek_anahtari) WHERE istek_anahtari IS NOT NULL DO NOTHING RETURNING id`,
        [a?.id || null, kod, olay, String(b.issue_turu || "").trim().slice(0, 80) || null, String(b.aciklama || "").trim().slice(0, 1000) || null,
          a?.ekip_no ?? (Number(b.ekip_no) || null), email, req.user?.name || null, String(req.headers?.["x-istemci"] || b.kanal || "web").slice(0, 20), anahtar]);
      const kp = await kapsam(req).catch(() => ({ rowMap: new Map() }));
      const d = (await fiiliDurum.durumHaritasi(pool, [kod], { rows: kp.rowMap })).get(kod);
      res.json({ ok: true, tekrar: !ins.rows.length, durum: d });
    } catch (e) { console.error("FIILI BILDIR ERROR:", e.message); res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get("/is-fiili/durum", authMiddleware, async (req, res) => {
    try {
      const kodlar = liste(req.query.kodlar).map(kodT).slice(0, 300);
      const email = String(req.user?.email || "").toLowerCase().trim();
      let izinli = kodlar;
      if (req.izinler?.operasyon_goruntule !== true) {
        // saha personeli: yalnız kendisine atanmış işler
        const r = (await pool.query(`SELECT site_codes FROM is_atama WHERE durum <> 'IPTAL' AND personeller @> $1::jsonb`, [JSON.stringify([{ email }])]).catch(() => ({ rows: [] }))).rows;
        const k = new Set(r.flatMap((x) => (x.site_codes || []).map(kodT)));
        izinli = kodlar.filter((x) => k.has(x));
      } else { const kp = await kapsam(req); if (kp.K) izinli = kodlar.filter((x) => kp.kodlar.has(x)); }
      const kp = req._opKapsam || { rowMap: new Map() };
      const d = await fiiliDurum.durumHaritasi(pool, izinli, { rows: kp.rowMap });
      res.json({ ok: true, durumlar: Object.fromEntries(d) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}

// Mevcut mobil başla / bitir uçlarından fiilî olay (iş kodu başına). Hata yutulur: ana akış etkilenmez.
async function atamaOlayYaz(pool, row, olay, req, ek = {}) {
  try {
    await require("./fiiliDurum").semaKur(pool);
    for (const s of row.site_codes || []) await pool.query(`INSERT INTO is_fiili_bildirim (is_atama_id, site_code, olay, issue_turu, aciklama, ekip_no, bildiren_email, bildiren_ad, kanal)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'atama')`, [row.id, kodT(s), olay, ek.issue_turu || null, ek.aciklama || null, row.ekip_no ?? null,
        String(req.user?.email || "").toLowerCase().trim() || null, req.user?.name || null]);
  } catch (e) { console.error("FIILI OLAY:", e.message); }
}

module.exports = { kur, atamaOlayYaz, pazartesi, GUN_AD };
