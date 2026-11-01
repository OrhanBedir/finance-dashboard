// ═══ FİİLÎ ÇALIŞMA DURUMU (31.10.2026, Orhan — QC'den bağımsız fiziksel montaj takibi) ════════════════════════════
// Saha ekibinin bildirdiği gerçek durum: "İşe başladım" → DEVAM, "Fiziksel montaj tamamlandı" → TAMAMLANDI, issue / engel
// bildirimi → ayrı etiket. Bu görünümde tamamlanma ölçütü QC DEĞİLDİR: mevcut mobil "bitir" akışında QC tamamlanmadığı için
// QC_BEKLE olan iş fiziksel olarak TAMAMLANDI sayılır; QC NOK fiziksel biten işi geri almaz. QC ayrı alan olarak gösterilir,
// Rollout QC alanları ve QC raporlarının anlamı değişmez.
// Kaynak önceliği (iş kodu bazında, birleştirilmez):
//   1) is_fiili_bildirim (iş kodu bazında olay: BASLADI / TAMAMLANDI / ISSUE / ISSUE_KAPANDI) — çok sahalı atamada saha ayrımı
//   2) is_atama (bu iş kodunu içeren, iptal edilmemiş montaj ataması): BASLADI/DEVAM/ARA_VERILDI → DEVAM, TAMAMLANDI/QC_BEKLE → TAMAMLANDI
//   3) Rollout montaj tarihleri (installation_actual_start/end, rf_started/finished, on-air) — "Rollout tarihi" kaynağıyla
// Renk: MAVI planlandı/başlamadı · SARI devam ediyor · YESIL tamamlandı · GRI doğrulanmadı. Issue / eksik malzeme ayrı etiket.
// "Ekip şu anda nerede?" = ekibin bildirdiği SON çalışma sahası (canlı GPS değildir); 24 saatten eski bildirim "eski" işaretlenir.
"use strict";

const MONTAJ_KATEGORI = ["NEW_SITE", "ENH_MONTAJ", "POWER", "GIZLEME", "MW", "GPS", "ISSUE"];
const ESKI_SAAT = 24;
const kodTemizle = (s) => String(s || "").replace(/\s+/g, "").toUpperCase();
const gun = (v) => { if (!v) return null; if (v instanceof Date) return isNaN(v) ? null : new Date(v.getTime() + 3 * 3600e3).toISOString().slice(0, 10); const t = String(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };
const iso = (v) => (v ? new Date(v).toISOString() : null);
const RENK = { PLANLANDI: "MAVI", BASLAMADI: "MAVI", DEVAM: "SARI", TAMAMLANDI: "YESIL", DOGRULANMADI: "GRI", YOK: "GRI" };
const AD = { PLANLANDI: "Planlandı · başlamadı", BASLAMADI: "Başlamadı", DEVAM: "Fiziksel montaj devam ediyor", TAMAMLANDI: "Fiziksel montaj tamamlandı",
  DOGRULANMADI: "Durum doğrulanmadı", YOK: "Plan / bildirim yok" };

async function semaKur(pool) {
  const q = (s) => pool.query(s).catch((e) => console.error("[fiili şema]", e.message));
  await q(`CREATE TABLE IF NOT EXISTS is_fiili_bildirim (
    id BIGSERIAL PRIMARY KEY, is_atama_id INTEGER, site_code TEXT NOT NULL, olay TEXT NOT NULL CHECK (olay IN ('BASLADI','TAMAMLANDI','ISSUE','ISSUE_KAPANDI','GERI_AL')),
    issue_turu TEXT, aciklama TEXT, ekip_no INTEGER, bildiren_email TEXT, bildiren_ad TEXT, kanal TEXT, istek_anahtari TEXT,
    zaman TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await q(`CREATE INDEX IF NOT EXISTS is_fiili_bildirim_site_idx ON is_fiili_bildirim (site_code, zaman)`);
  await q(`CREATE INDEX IF NOT EXISTS is_fiili_bildirim_ekip_idx ON is_fiili_bildirim (ekip_no, zaman)`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS is_fiili_bildirim_istek_uq ON is_fiili_bildirim (bildiren_email, istek_anahtari) WHERE istek_anahtari IS NOT NULL`);
  await q(`ALTER TABLE is_fiili_bildirim ENABLE ROW LEVEL SECURITY`);
}

// Saf hesap: tek iş kodu
function durumHesapla({ kod, olaylar = [], atamalar = [], row = null, simdi = Date.now() }) {
  const ol = [...olaylar].sort((a, b) => new Date(a.zaman) - new Date(b.zaman));
  const at = atamalar.filter((a) => a.durum !== "IPTAL" && MONTAJ_KATEGORI.includes(a.kategori));
  const sonAtama = [...at].sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))[0] || null;
  let kodD = null, kaynak = null, baslama = null, bitis = null;
  // 1) iş kodu bazında olaylar (GERI_AL son olayı iptal eder)
  const etkin = [];
  for (const o of ol) { if (o.olay === "GERI_AL") etkin.pop(); else etkin.push(o); }
  const durumOlay = etkin.filter((o) => ["BASLADI", "TAMAMLANDI"].includes(o.olay));
  if (durumOlay.length) {
    const s = durumOlay[durumOlay.length - 1];
    kodD = s.olay === "TAMAMLANDI" ? "TAMAMLANDI" : "DEVAM"; kaynak = "Ekip bildirimi";
    baslama = iso(durumOlay.find((o) => o.olay === "BASLADI")?.zaman || null); bitis = s.olay === "TAMAMLANDI" ? iso(s.zaman) : null;
  }
  // 2) iş ataması (mobil başla / bitir)
  if (!kodD && sonAtama) {
    const d = String(sonAtama.durum || "").toUpperCase();
    if (["TAMAMLANDI", "QC_BEKLE"].includes(d) || sonAtama.bitis_ts) { kodD = "TAMAMLANDI"; bitis = iso(sonAtama.bitis_ts); }
    else if (["BASLADI", "DEVAM", "ARA_VERILDI"].includes(d) || sonAtama.baslama_ts) kodD = "DEVAM";
    else kodD = "PLANLANDI";
    baslama = iso(sonAtama.baslama_ts); kaynak = `İş ataması #${sonAtama.id}`;
  }
  // 3) Rollout tarihleri
  const rBas = gun(row?.installation_actual_start_date) || gun(row?.rf_started_date);
  const rBit = gun(row?.installation_actual_end_date) || gun(row?.rf_finished_date) || gun(row?.onair_date);
  const uyarilar = [];
  if (!kodD) {
    if (rBit) { kodD = "TAMAMLANDI"; kaynak = "Rollout montaj bitiş tarihi"; bitis = rBit; baslama = rBas; }
    else if (rBas) { kodD = "DEVAM"; kaynak = "Rollout montaj başlangıç tarihi"; baslama = rBas; }
    else kodD = "YOK";
  } else if (kodD !== "TAMAMLANDI" && rBit) {
    uyarilar.push(`Rollout'ta montaj bitiş tarihi (${rBit}) var ama ekip bildirimi "${AD[kodD]}" — kontrol edin`);
    kodD = "DOGRULANMADI";
  }
  if (bitis && baslama && String(bitis).slice(0, 10) < String(baslama).slice(0, 10)) { uyarilar.push("Bitiş başlangıçtan önce"); kodD = "DOGRULANMADI"; }
  // Issue: son ISSUE açık mı (sonrasında ISSUE_KAPANDI ya da TAMAMLANDI yoksa)
  let issue = null;
  for (const o of etkin) {
    if (o.olay === "ISSUE") issue = { tur: o.issue_turu || "Issue", aciklama: o.aciklama || null, zaman: iso(o.zaman), bildiren: o.bildiren_ad || o.bildiren_email || null };
    else if (["ISSUE_KAPANDI", "TAMAMLANDI"].includes(o.olay)) issue = null;
  }
  if (!issue && sonAtama && String(sonAtama.durum).toUpperCase() === "ARA_VERILDI")
    issue = { tur: sonAtama.durdurma_sebebi || "Ara verildi", aciklama: null, zaman: iso(sonAtama.updated_at), bildiren: null };
  const sonOlay = ol[ol.length - 1] || null;
  const sonBildirim = [sonOlay?.zaman, sonAtama?.baslama_ts, sonAtama?.bitis_ts].filter(Boolean).map((z) => new Date(z)).sort((a, b) => b - a)[0] || null;
  const qc = { durum: row?.qc_durum || null, kapanis: gun(row?.qc_closed_date) };
  return { kod: kodD, ad: AD[kodD], renk: RENK[kodD], kaynak, baslama, bitis, issue, uyarilar,
    plan_tarihi: gun(sonAtama?.plan_baslangic || sonAtama?.plan_tarihi), atama_id: sonAtama?.id || null, ekip_no: sonAtama?.ekip_no ?? null,
    son_bildirim: sonBildirim ? sonBildirim.toISOString() : null, son_bildirim_eski: sonBildirim ? (simdi - sonBildirim.getTime()) / 3600e3 > ESKI_SAAT : null,
    qc, qc_not: "QC ayrı alandır; fiziksel tamamlanmayı değiştirmez", is_kodu: kod };
}

// Toplu: kodlar → Map(kod → durum). rows: Map(kod → rollout satırı)
async function durumHaritasi(db, kodlar, { rows = new Map(), simdi } = {}) {
  const k = [...new Set(kodlar.map(kodTemizle).filter(Boolean))];
  const out = new Map();
  if (!k.length) return out;
  const ol = (await db.query(`SELECT * FROM is_fiili_bildirim WHERE site_code = ANY($1::text[]) ORDER BY zaman`, [k]).catch(() => ({ rows: [] }))).rows;
  const at = (await db.query(`SELECT id, kategori, durum, plan_tarihi, to_jsonb(a)->>'plan_baslangic' AS plan_baslangic, (to_jsonb(a)->>'ekip_no')::int AS ekip_no,
      baslama_ts, bitis_ts, durdurma_sebebi, site_codes, created_at, updated_at FROM is_atama a WHERE site_codes && $1::text[]`, [k]).catch(() => ({ rows: [] }))).rows;
  for (const kod of k) out.set(kod, durumHesapla({ kod, olaylar: ol.filter((o) => o.site_code === kod),
    atamalar: at.filter((a) => (a.site_codes || []).some((s) => kodTemizle(s) === kod)), row: rows.get(kod) || null, simdi }));
  return out;
}

// Ekip son konum bildirimi: ekip_no → { site_code, olay, zaman, eski, planlanan (bugünkü plan sahası) }
async function ekipSonBildirim(db, ekipNolar, { simdi = Date.now() } = {}) {
  const out = new Map();
  if (!ekipNolar.length) return out;
  const r = (await db.query(`SELECT DISTINCT ON (ekip_no) ekip_no, site_code, olay, zaman, bildiren_ad FROM is_fiili_bildirim
    WHERE ekip_no = ANY($1::int[]) ORDER BY ekip_no, zaman DESC`, [ekipNolar]).catch(() => ({ rows: [] }))).rows;
  // Bildirim tablosunda olmayanlar için mobil başla/bitir (is_atama_gun) — ekip_no iş atamasından
  const g = (await db.query(`SELECT DISTINCT ON ((to_jsonb(a)->>'ekip_no')::int) (to_jsonb(a)->>'ekip_no')::int AS ekip_no, a.site_codes, GREATEST(gg.baslama, COALESCE(gg.bitis, gg.baslama)) AS zaman,
      CASE WHEN gg.bitis IS NOT NULL THEN 'CIKIS' ELSE 'BASLADI' END AS olay, gg.personel_ad
    FROM is_atama_gun gg JOIN is_atama a ON a.id = gg.is_atama_id WHERE (to_jsonb(a)->>'ekip_no')::int = ANY($1::int[])
    ORDER BY (to_jsonb(a)->>'ekip_no')::int, GREATEST(gg.baslama, COALESCE(gg.bitis, gg.baslama)) DESC`, [ekipNolar]).catch(() => ({ rows: [] }))).rows;
  for (const no of ekipNolar) {
    const a = r.find((x) => Number(x.ekip_no) === Number(no)), b = g.find((x) => Number(x.ekip_no) === Number(no));
    const sec = a && (!b || new Date(a.zaman) >= new Date(b.zaman)) ? { site_code: a.site_code, olay: a.olay, zaman: a.zaman, kim: a.bildiren_ad }
      : b ? { site_code: (b.site_codes || []).join(", "), olay: b.olay, zaman: b.zaman, kim: b.personel_ad } : null;
    if (sec) out.set(Number(no), { ...sec, zaman: iso(sec.zaman), eski: (simdi - new Date(sec.zaman).getTime()) / 3600e3 > ESKI_SAAT,
      not: "Ekibin bildirdiği son çalışma sahası — canlı GPS konumu değildir" });
  }
  return out;
}

module.exports = { semaKur, durumHesapla, durumHaritasi, ekipSonBildirim, MONTAJ_KATEGORI, RENK, AD, ESKI_SAAT };
