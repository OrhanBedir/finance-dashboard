// ═══ PLAN ↔ MOBİL İŞ ATAMASI SENKRONU (02.11.2026, Orhan) ═══════════════════════════════════════════════════════════
// Plan Yap onayı zaten is_atama (iş kodu başına tek kayıt, personeller = ekibin e-postalı üyeleri) + is_atama_plan_segment
// (günlük bloklar) yazar; mobil "Rollout · İşlerim" (/is-atama/benim) bu kaydı personel e-postasıyla görür. Bu modül zincirin
// eksik halkalarını tamamlar — AYRI bir atama sistemi kurmaz:
//   • Ulaşım kontrolü  : onay ÖNCESİ ekip üyelerinin mobil hesabı (users) var mı; eksikse kime ulaşacağı / kimde eksik açıkça
//   • İdempotent işlem : başla / bitir / fiilî bildirim istek anahtarıyla tekrar edilince ikinci kayıt oluşmaz (is_atama_istek)
//   • Eski ekipten geç bildirim: iptal / devredilmiş atamaya çevrimdışı birikmiş bildirim gelirse kaydı KAYBETMEDEN
//                        is_bildirim_inceleme'ye yazılır, 409 "İnceleme gerekiyor" döner; yeni atama ezilmez
//   • Plan değişikliği : tarih/saat (aynı atama güncellenir), başlanmamış işi ekip değiştir (eski IPTAL+devir izi, yeni atama),
//                        başlanmış işte "kalan işi devret" (gerekçeli; eski ekibin gün kayıtları ve bildirimleri korunur),
//                        iptal. Tamamlanmış iş yeniden açılmaz. Plan ekibini değiştirmek malzemeyi devretmez (uyarı).
//   • Mobil geçmiş     : iptal / aktarılan atamalar "gecmis" listesinde (eski mobil sürüm bu alanı yok sayar)
// Bütün yetki ve Teknocenter kapsamı sunucuda (deps ile server.js'ten gelir).
"use strict";

const kodT = (s) => String(s || "").replace(/\s+/g, "").toUpperCase();
const temiz = (s, n = 500) => String(s ?? "").trim().replace(/\s+/g, " ").slice(0, n);
const yerel = (ts) => { const d = new Date(new Date(ts).getTime() + 3 * 3600e3); return { tarih: d.toISOString().slice(0, 10), saat: d.toISOString().slice(11, 16) }; };
const tsMi = (v) => !isNaN(new Date(v).getTime());
const gunEkle = (t, n) => { const d = new Date(`${t}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const haftaGunu = (t) => new Date(`${t}T00:00:00Z`).getUTCDay();
const ISTANBUL = "+03:00";

async function semaKur(pool) {
  const q = (s) => pool.query(s).catch((e) => console.error("[plan senkron şema]", e.message));
  await q(`CREATE TABLE IF NOT EXISTS is_atama_istek (kullanici TEXT NOT NULL, anahtar TEXT NOT NULL, uc TEXT NOT NULL, sonuc JSONB, created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (kullanici, anahtar))`);
  await q(`CREATE TABLE IF NOT EXISTS is_bildirim_inceleme (id BIGSERIAL PRIMARY KEY, is_atama_id INTEGER, site_code TEXT, uc TEXT NOT NULL, govde JSONB, neden TEXT,
    bildiren_email TEXT, bildiren_ad TEXT, kanal TEXT, istek_anahtari TEXT, durum TEXT NOT NULL DEFAULT 'BEKLIYOR', karar_veren TEXT, karar_zamani TIMESTAMPTZ, karar_notu TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await q(`ALTER TABLE is_atama ADD COLUMN IF NOT EXISTS iptal_nedeni TEXT, ADD COLUMN IF NOT EXISTS devir_hedef_atama_id INTEGER, ADD COLUMN IF NOT EXISTS devir_kaynak_atama_id INTEGER,
    ADD COLUMN IF NOT EXISTS plan_surum INTEGER NOT NULL DEFAULT 1`);
  await q(`CREATE INDEX IF NOT EXISTS is_bildirim_inceleme_durum_idx ON is_bildirim_inceleme (durum, created_at)`);
  await q(`ALTER TABLE is_atama_istek ENABLE ROW LEVEL SECURITY`);
  await q(`ALTER TABLE is_bildirim_inceleme ENABLE ROW LEVEL SECURITY`);
}

// ── Ulaşım: ekibin üyeleri mobil hesaba bağlı mı? (planEkipleri çıktısı + users) ─────────────────────────────────
// Dönen: { ulasan: [{ad,email}], eksik: [{ad, neden}], sef_ulasir, mesaj }
async function ekipUlasim(pool, ekip) {
  const uyeler = ekip?.uyeler || [];
  const mailler = uyeler.map((u) => String(u.email || "").toLowerCase().trim()).filter(Boolean);
  const r = mailler.length ? (await pool.query(`SELECT LOWER(TRIM(email)) AS email, is_active, status FROM users WHERE LOWER(TRIM(email)) = ANY($1::text[])`, [mailler])).rows : [];
  const aktif = new Set(r.filter((x) => x.is_active !== false && String(x.status || "active") === "active").map((x) => x.email));
  const pasif = new Set(r.filter((x) => !aktif.has(x.email)).map((x) => x.email));
  const ulasan = [], eksik = [];
  for (const u of uyeler) {
    const e = String(u.email || "").toLowerCase().trim();
    if (!e) eksik.push({ ad: u.ad, neden: "personel kartında e-posta yok — mobil hesaba bağlanamaz" });
    else if (pasif.has(e)) eksik.push({ ad: u.ad, email: e, neden: "mobil hesabı pasif" });
    else if (!aktif.has(e)) eksik.push({ ad: u.ad, email: e, neden: "bu e-postayla mobil hesap yok" });
    else ulasan.push({ ad: u.ad, email: e, sef: !!(ekip.sef && ekip.sef.ad === u.ad) });
  }
  const sefUlasir = ekip?.sef ? ulasan.some((x) => x.ad === ekip.sef.ad) : null;
  const mesaj = !uyeler.length ? `${ekip?.ad}: ekipte kayıtlı üye yok — atama kimseye ulaşmaz`
    : !ulasan.length ? `${ekip?.ad}: hiçbir üyenin mobil hesabı yok — atama kimseye ulaşmaz (${eksik.map((x) => x.ad).join(", ")})`
    : eksik.length ? `${ekip?.ad}: atama ${ulasan.map((x) => x.ad).join(", ")} hesabına ulaşır; ${eksik.map((x) => `${x.ad} (${x.neden})`).join(", ")} ulaşmaz`
    : `${ekip?.ad}: atama ${ulasan.length} üyenin mobil hesabına ulaşır (${ulasan.map((x) => x.ad).join(", ")})`;
  return { ulasan, eksik, sef_ulasir: sefUlasir, mesaj, ulasir: ulasan.length > 0 };
}

// ── İdempotent istek: anahtar varsa önceki sonucu döndür; yoksa fn çalıştırıp sonucu sakla ───────────────────────
async function idempotent(pool, req, uc, fn) {
  const anahtar = temiz(req.body?.istek_anahtari, 100);
  const kim = String(req.user?.email || req.user?.user_id || "").toLowerCase().trim();
  if (anahtar.length < 8 || !kim) return fn();
  const ev = (await pool.query(`SELECT sonuc FROM is_atama_istek WHERE kullanici = $1 AND anahtar = $2`, [kim, anahtar]).catch(() => ({ rows: [] }))).rows[0];
  if (ev && ev.sonuc) return { ...ev.sonuc, tekrar: true, mesaj: "Bu işlem daha önce alınmıştı; ikinci kez işlenmedi" };
  const sonuc = await fn();
  if (sonuc && sonuc.ok !== false && sonuc._http !== 409)
    await pool.query(`INSERT INTO is_atama_istek (kullanici, anahtar, uc, sonuc) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [kim, anahtar, uc, JSON.stringify(sonuc)]).catch(() => {});
  return sonuc;
}

// ── Eski ekipten / iptal edilmiş atamaya gelen bildirim: kaybetmeden incelemeye al ──────────────────────────────
async function incelemeyeAl(pool, req, row, uc, govde, neden) {
  await pool.query(`INSERT INTO is_bildirim_inceleme (is_atama_id, site_code, uc, govde, neden, bildiren_email, bildiren_ad, kanal, istek_anahtari)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [row?.id || null, (row?.site_codes || [])[0] || govde?.site_code || null, uc, JSON.stringify(govde || {}), neden,
    String(req.user?.email || "").toLowerCase(), req.user?.name || null, temiz(req.headers?.["x-istemci"] || "web", 20), temiz(req.body?.istek_anahtari, 100) || null]).catch((e) => console.error("INCELEME:", e.message));
  return { ok: false, inceleme: true, error: `İnceleme gerekiyor: ${neden}. Bildiriminiz kaybolmadı; ofis değerlendirecek.` };
}
// Atama bu bildirimi kabul edemez mi? (iptal / devredilmiş) → neden; değilse null
function kapaliNeden(row) {
  if (!row) return null;
  if (row.durum === "IPTAL") return row.iptal_nedeni === "DEVIR" ? "iş başka ekibe aktarılmış" : row.iptal_nedeni === "KALAN_DEVIR" ? "işin kalan kısmı başka ekibe devredilmiş" : "atama iptal edilmiş";
  return null;
}

// ── Plan blokları: bas..bit arasında günlük MONTAJ dilimleri (08:00–18:00, Pazar atlanır) ────────────────────────
function gunlukBloklar(bas, bit, pencere = { bas: "08:00", bit: "18:00" }) {
  const a = yerel(bas), b = yerel(bit);
  const out = [];
  let t = a.tarih;
  for (let g = 0; g < 60 && t <= b.tarih; g++) {
    if (haftaGunu(t) !== 0 || t === a.tarih) {
      const s = t === a.tarih ? a.saat : pencere.bas, e = t === b.tarih ? b.saat : pencere.bit;
      if (s < e) out.push({ bas: `${t}T${s}:00${ISTANBUL}`, bit: `${t}T${e}:00${ISTANBUL}` });
    }
    t = gunEkle(t, 1);
  }
  return out;
}

function kur(app, deps) {
  const { pool, authMiddleware, isAtamaDetay, isAtamaYetkiliMi, planEkipleri, planTablolar, islemGecmisiYaz, hwMalzeme, fiiliDurum, kapsamIsKodlari, altMarkaKullanicisi, isAtamaPersonelKapsamHatasi } = deps;
  semaKur(pool).catch(() => {});
  const hata = (res, e) => { if (e && e.durum) return res.status(e.durum).json({ ok: false, error: e.mesaj || e.message, ...(e.ek || {}) }); console.error("PLAN SENKRON:", e.message); res.status(500).json({ ok: false, error: e.message }); };
  const H = (durum, mesaj, ek) => Object.assign(new Error(mesaj), { durum, mesaj, ek });
  const ben = (req) => String(req.user?.email || "").toLowerCase().trim();
  // Atama kapsam / yetki: İş Ata yetkisi + Teknocenter kapsamındaki iş kodları (haritayla aynı)
  async function atamaAl(req, id) {
    if (!isAtamaYetkiliMi(req)) throw H(403, "Plan değişikliği için İş Ata yetkisi gerekir");
    await planTablolar();
    const row = await isAtamaDetay(Number(id));
    if (!row) throw H(404, "Atama bulunamadı");
    const kp = await kapsamIsKodlari(req);
    const kodlar = (row.site_codes || []).map(kodT);
    if (kodlar.length && !kodlar.every((k) => kp.kodlar.has(k))) throw H(403, "Bu iş Teknocenter kapsamınızda değil");
    return row;
  }
  const baslamisMi = (row) => !!row.baslama_ts || ["BASLADI", "DEVAM", "ARA_VERILDI"].includes(row.durum);
  const bitmisMi = (row) => ["TAMAMLANDI", "QC_BEKLE"].includes(row.durum) || !!row.bitis_ts;
  async function segmentleriYenile(client, row, bas, bit, ekip) {
    await client.query(`DELETE FROM is_atama_plan_segment WHERE is_atama_id = $1 AND tur = 'MONTAJ'`, [row.id]);
    const kod = (row.site_codes || [])[0] || null;
    const mailler = (ekip?.uyeler || row.personeller || []).map((u) => String(u.email || "").toLowerCase()).filter(Boolean);
    for (const b of gunlukBloklar(bas, bit)) await client.query(`INSERT INTO is_atama_plan_segment (plan_id, is_atama_id, ekip_no, arac_plaka, personeller, tur, ad, site_code, kategori, bas, bit, aciklama)
      VALUES ($1,$2,$3,$4,$5,'MONTAJ',$6,$7,$8,$9,$10,$11)`, [row.plan_id || null, row.id, ekip ? ekip.ekip_no : row.ekip_no, ekip ? ekip.plaka || null : row.arac_plaka || null, mailler,
      kod ? (deps.fizikselSaha(kod)?.fiziksel_id || kod) : row.kategori, kod, row.kategori, b.bas, b.bit, "Plan değişikliğiyle güncellendi"]);
  }
  const malzemeUyarisi = async (row, yeniEkipNo) => {
    const kod = kodT((row.site_codes || [])[0]); if (!kod) return null;
    const d = (await hwMalzeme.durumHaritasi(pool, [kod]).catch(() => new Map())).get(kod);
    const baska = (d?.ekipte || []).filter((e) => Number(e.ekip_no) !== Number(yeniEkipNo));
    return baska.length ? `Malzeme ${baska.map((e) => e.ad).join(", ")} üzerinde — plan ekibini değiştirmek malzemeyi devretmez; HW Malzeme Durumu'ndan ayrı DEVİR kaydı gerekir` : null;
  };

  // ── Tarih / saat değişikliği: AYNI atama güncellenir, mükerrer açılmaz ──
  app.post("/plan/atama/:id/zaman", authMiddleware, async (req, res) => {
    try {
      const row = await atamaAl(req, req.params.id);
      const b = req.body || {};
      if (!tsMi(b.bas) || !tsMi(b.bit) || new Date(b.bit) <= new Date(b.bas)) throw H(400, "Başlangıç ve bitiş zamanı girin (bitiş başlangıçtan sonra)");
      if (bitmisMi(row)) throw H(400, "Tamamlanmış iş yeniden planlanmaz; yeniden çalışma gerekiyorsa gerekçeli yeni iş / ziyaret oluşturun");
      if (row.durum === "IPTAL") throw H(400, "İptal edilmiş / aktarılmış atama değiştirilemez");
      if (b.plan_surum != null && Number(b.plan_surum) !== Number(row.plan_surum || 1)) throw H(409, "Bu atama bu arada başkası tarafından değiştirildi — ekranı yenileyip tekrar deneyin", { plan_surum: row.plan_surum });
      const gerekce = temiz(b.gerekce, 500);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`atama:${row.id}`]);
        const eski = { plan_tarihi: row.plan_tarihi, plan_baslangic: row.plan_baslangic, plan_bitis: row.plan_bitis };
        await client.query(`UPDATE is_atama SET plan_tarihi = $2::date, plan_baslangic = $3, plan_bitis = $4, plan_surum = COALESCE(plan_surum,1) + 1,
            atayan_not = CONCAT_WS(E'\\n', NULLIF(atayan_not,''), $5::text), updated_at = NOW() WHERE id = $1`,
          [row.id, yerel(b.bas).tarih, b.bas, b.bit, `${new Date().toLocaleDateString("tr-TR")} Plan değişti: ${yerel(b.bas).tarih} ${yerel(b.bas).saat}–${yerel(b.bit).tarih} ${yerel(b.bit).saat}${gerekce ? ` (${gerekce})` : ""} — ${req.user?.name || ben(req)}`]);
        await segmentleriYenile(client, row, b.bas, b.bit, null);
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
      await islemGecmisiYaz(req, "is_atama", row.id, "PLAN_ZAMAN", eskiZaman(row), { plan_baslangic: b.bas, plan_bitis: b.bit, gerekce });
      res.json({ ok: true, row: await isAtamaDetay(row.id), bildirim: { tur: "PLAN_DEGISTI", alicilar: (row.personeller || []).map((p) => p.email) } });
    } catch (e) { hata(res, e); }
  });
  const eskiZaman = (row) => ({ plan_tarihi: row.plan_tarihi, plan_baslangic: row.plan_baslangic, plan_bitis: row.plan_bitis });

  // ── Ekip değiştir: başlanmamış → taşı; başlanmış → "kalan işi devret" (kalan_devir: true + gerekçe) ──
  app.post("/plan/atama/:id/ekip-degistir", authMiddleware, async (req, res) => {
    try {
      const row = await atamaAl(req, req.params.id);
      const b = req.body || {};
      const gerekce = temiz(b.gerekce, 500);
      if (bitmisMi(row)) throw H(400, "Tamamlanmış iş başka ekibe taşınmaz; yeniden çalışma gerekiyorsa gerekçeli yeni iş / ziyaret oluşturun");
      if (row.durum === "IPTAL") throw H(400, "İptal edilmiş / aktarılmış atama taşınamaz");
      const ekip = (await planEkipleri(req, b.yeni_ekip_no))[0];
      if (!ekip) throw H(403, "Yeni ekip bulunamadı ya da kapsamınızda değil");
      if (Number(ekip.ekip_no) === Number(row.ekip_no)) throw H(400, "İş zaten bu ekipte");
      const kisiHata = await isAtamaPersonelKapsamHatasi(req, ekip.uyeler.filter((u) => u.email).map((u) => ({ email: u.email, ad: u.ad })));
      if (kisiHata) throw H(403, kisiHata);
      const ulasim = await ekipUlasim(pool, ekip);
      if (!ulasim.ulasir && b.ulasim_onay !== true) throw H(409, ulasim.mesaj, { ulasim, ulasim_onay_gerekli: true });
      const basladi = baslamisMi(row);
      if (basladi && b.kalan_devir !== true) throw H(409, `Bu işte ${row.durum === "ARA_VERILDI" ? "ara verilmiş" : "çalışma başlamış"} — sessizce taşınmaz. Mevcut ilerlemeyi inceleyip "Kalan işi devret" ile gerekçeli devredin.`,
        { kalan_devir_gerekli: true, ilerleme: { durum: row.durum, baslama: row.baslama_ts, gunler: (row.gunler || []).length, not: row.kapanis_not || null } });
      if (gerekce.length < 3) throw H(400, basladi ? "Kalan işi devir gerekçesi zorunlu" : "Ekip değişikliği gerekçesi yazın");
      if (b.plan_surum != null && Number(b.plan_surum) !== Number(row.plan_surum || 1)) throw H(409, "Bu atama bu arada değiştirildi — yenileyip tekrar deneyin");
      const malzemeUyari = await malzemeUyarisi(row, ekip.ekip_no);
      const kisiler = ekip.uyeler.filter((u) => u.email).map((u) => ({ email: u.email, ad: u.ad }));
      const bas = b.bas && tsMi(b.bas) ? b.bas : row.plan_baslangic, bit = b.bit && tsMi(b.bit) ? b.bit : row.plan_bitis;
      const client = await pool.connect();
      let yeniId;
      try {
        await client.query("BEGIN");
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`atama:${row.id}`]);
        const guncel = (await client.query(`SELECT durum, plan_surum FROM is_atama WHERE id = $1 FOR UPDATE`, [row.id])).rows[0];
        if (!guncel || guncel.durum === "IPTAL" || ["TAMAMLANDI", "QC_BEKLE"].includes(guncel.durum)) throw H(409, "Atama bu arada değişti — yenileyin");
        const neden = basladi ? "KALAN_DEVIR" : "DEVIR";
        const ins = await client.query(`INSERT INTO is_atama (kategori, alt_tip, site_codes, bolge, personeller, plan_tarihi, atayan_email, atayan_ad, atayan_not, plan_id, plan_baslangic, plan_bitis,
            ekip_no, arac_plaka, plan_detay, konum_aciklama, devir_kaynak_atama_id, taseron_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
          [row.kategori, row.alt_tip || null, row.site_codes || [], row.bolge || ekip.bolge || null, JSON.stringify(kisiler), bas ? yerel(bas).tarih : row.plan_tarihi, ben(req), req.user?.name || null,
            `${basladi ? "Kalan iş devri" : "Ekip değişikliği"}: ${row.ekip_no ? `ekip #${row.ekip_no}` : "önceki atama"} → ${ekip.ad} — ${gerekce}${basladi ? ` · önceki ilerleme: ${row.durum}, ${(row.gunler || []).length} gün kaydı` : ""}`,
            row.plan_id || null, bas || null, bit || null, ekip.ekip_no, ekip.plaka || null,
            JSON.stringify({ ...(row.plan_detay || {}), devir: { kaynak_atama_id: row.id, tur: neden, gerekce, onceki_durum: row.durum, onceki_gun_sayisi: (row.gunler || []).length, kalan_sure_gun: b.kalan_sure_gun != null ? Number(b.kalan_sure_gun) : null } }),
            row.konum_aciklama || null, row.id, null]);
        yeniId = ins.rows[0].id;
        await client.query(`UPDATE is_atama SET durum = 'IPTAL', iptal_nedeni = $2, devir_hedef_atama_id = $3, plan_surum = COALESCE(plan_surum,1) + 1,
            kapanis_not = CONCAT_WS(E'\\n', NULLIF(kapanis_not,''), $4::text), updated_at = NOW() WHERE id = $1`,
          [row.id, neden, yeniId, `${new Date().toLocaleDateString("tr-TR")} ${basladi ? "Kalan iş" : "İş"} ${ekip.ad} ekibine aktarıldı (#${yeniId}) — ${gerekce} (${req.user?.name || ben(req)})`]);
        // Plan blokları: gelecekteki MONTAJ blokları yeni atamaya / ekibe geçer; geçmiş (çalışılmış) bloklar eski atamada kalır
        const now = new Date().toISOString();
        if (basladi) await client.query(`UPDATE is_atama_plan_segment SET is_atama_id = $2, ekip_no = $3, arac_plaka = $4, personeller = $5 WHERE is_atama_id = $1 AND tur = 'MONTAJ' AND bas >= $6`,
          [row.id, yeniId, ekip.ekip_no, ekip.plaka || null, kisiler.map((k) => k.email), now]);
        else await client.query(`UPDATE is_atama_plan_segment SET is_atama_id = $2, ekip_no = $3, arac_plaka = $4, personeller = $5 WHERE is_atama_id = $1`,
          [row.id, yeniId, ekip.ekip_no, ekip.plaka || null, kisiler.map((k) => k.email)]);
        if (b.bas && b.bit) { const yeniRow = { id: yeniId, site_codes: row.site_codes, kategori: row.kategori, plan_id: row.plan_id, ekip_no: ekip.ekip_no, arac_plaka: ekip.plaka }; await segmentleriYenile(client, yeniRow, bas, bit, ekip); }
        if (row.kategori === "CLEANUP" && kisiler[0]) await client.query(`UPDATE rollout_cleanup SET atanan_email = $2, atanan_ad = $3, is_atama_id = $4, updated_at = NOW() WHERE is_atama_id = $1`, [row.id, kisiler[0].email, kisiler[0].ad, yeniId]);
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
      await islemGecmisiYaz(req, "is_atama", row.id, basladi ? "KALAN_DEVIR" : "EKIP_DEGISTIR", { ekip_no: row.ekip_no, durum: row.durum }, { yeni_atama_id: yeniId, ekip_no: ekip.ekip_no, gerekce });
      await islemGecmisiYaz(req, "is_atama", yeniId, "OLUSTURMA", null, { kaynak_atama_id: row.id, ekip_no: ekip.ekip_no, personeller: kisiler.map((k) => k.email), tur: basladi ? "KALAN_DEVIR" : "DEVIR" });
      res.json({ ok: true, eski_atama_id: row.id, yeni_atama_id: yeniId, row: await isAtamaDetay(yeniId), ulasim, uyarilar: [malzemeUyari].filter(Boolean),
        bildirim: { tur: "EKIP_DEGISTI", eski_alicilar: (row.personeller || []).map((p) => p.email), yeni_alicilar: kisiler.map((k) => k.email) } });
    } catch (e) { hata(res, e); }
  });

  // ── İptal: plandan çıkar (başlanmışsa onay ister) ──
  app.post("/plan/atama/:id/iptal", authMiddleware, async (req, res) => {
    try {
      const row = await atamaAl(req, req.params.id);
      const gerekce = temiz(req.body?.gerekce, 500);
      if (gerekce.length < 3) throw H(400, "İptal gerekçesi yazın");
      if (bitmisMi(row)) throw H(400, "Tamamlanmış iş iptal edilmez");
      if (row.durum === "IPTAL") return res.json({ ok: true, tekrar: true, row });
      if (baslamisMi(row) && req.body?.baslamis_onay !== true) throw H(409, "Bu işte çalışma başlamış — iptal için açık onay gerekir; ekibin gün kayıtları korunur", { baslamis_onay_gerekli: true });
      await pool.query(`UPDATE is_atama SET durum = 'IPTAL', iptal_nedeni = 'IPTAL', plan_surum = COALESCE(plan_surum,1) + 1, kapanis_not = CONCAT_WS(E'\\n', NULLIF(kapanis_not,''), $2::text), updated_at = NOW() WHERE id = $1`,
        [row.id, `${new Date().toLocaleDateString("tr-TR")} Plandan çıkarıldı — ${gerekce} (${req.user?.name || ben(req)})`]);
      await islemGecmisiYaz(req, "is_atama", row.id, "IPTAL", { durum: row.durum }, { durum: "IPTAL", gerekce });
      res.json({ ok: true, row: await isAtamaDetay(row.id), bildirim: { tur: "IPTAL", alicilar: (row.personeller || []).map((p) => p.email) } });
    } catch (e) { hata(res, e); }
  });

  // ── İnceleme kuyruğu (ofis): bekleyen geç bildirimler ──
  app.get("/plan/inceleme", authMiddleware, async (req, res) => {
    try {
      if (!isAtamaYetkiliMi(req)) throw H(403, "Yetkiniz yok");
      const kp = await kapsamIsKodlari(req);
      const r = (await pool.query(`SELECT * FROM is_bildirim_inceleme WHERE durum = 'BEKLIYOR' ORDER BY created_at DESC LIMIT 200`)).rows.filter((x) => !x.site_code || kp.kodlar.has(kodT(x.site_code)));
      res.json({ ok: true, bekleyen: r });
    } catch (e) { hata(res, e); }
  });
  app.post("/plan/inceleme/:id/karar", authMiddleware, async (req, res) => {
    try {
      if (!isAtamaYetkiliMi(req)) throw H(403, "Yetkiniz yok");
      const karar = String(req.body?.karar || "").toUpperCase();
      if (!["KAPAT", "NOT_AL"].includes(karar)) throw H(400, "Karar: KAPAT ya da NOT_AL");
      const r = await pool.query(`UPDATE is_bildirim_inceleme SET durum = $2, karar_veren = $3, karar_zamani = NOW(), karar_notu = $4 WHERE id = $1 AND durum = 'BEKLIYOR' RETURNING id`,
        [Number(req.params.id), karar === "KAPAT" ? "KAPATILDI" : "NOT_ALINDI", ben(req), temiz(req.body?.not, 500) || null]);
      if (!r.rows.length) throw H(404, "Kayıt yok ya da zaten karara bağlanmış");
      res.json({ ok: true });
    } catch (e) { hata(res, e); }
  });
}

module.exports = { kur, semaKur, ekipUlasim, idempotent, incelemeyeAl, kapaliNeden, gunlukBloklar };
