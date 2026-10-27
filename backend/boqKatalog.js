// ═══ SÜRÜMLÜ BoQ KATALOĞU (27.10.2026, Orhan — Teknocenter / HW Frame 2026-27) ═══════════════════════════════
// İki ayrı katalog yan yana durur; eski fiyatların üzerine yazılmaz:
//   BOQ2025 — "2025 BoQ — Eski fiyat listesi"            (Desktop/Şimşek/BoQ/BoQ .xlsx, Sheet1 bölge fiyatları)
//   BOQ2026 — "2026 BoQ — 12 Ekim 2026 ve sonrası"       (FPA3621TUR26101510697339 Appendix 5.x birim fiyat ekleri +
//                                                         2026-2027 Integrated Frame BOQ L3 kod/açıklama/birim)
// Aynı kod iki sürümde farklı açıklama/fiyat taşıyabilir — benzersizlik (surum, kod, bolge) üzerindedir.
// Varsayılan sürüm, sahanın GERÇEK malzeme geliş tarihine göre önerilir (sınır 12.10.2026 00:00 Europe/Istanbul);
// Excel yükleme, kayıt oluşturma, TSSR ya da PR tarihi esas alınmaz. PR satırına seçilen sürüm ve o anki
// fiyat/açıklama/birim yazılır (anlık görüntü) — katalog sonradan değişse de geçmiş PR yeniden fiyatlanmaz.
const crypto = require("crypto");

const SURUMLER = [
  { kod: "BOQ2025", ad: "2025 BoQ — Eski fiyat listesi", kisa: "2025 BoQ", baslangic: null, bitis: "2026-10-11",
    kaynak: "Şimşek/BoQ/BoQ .xlsx (Sheet1, bölge bazlı birim fiyat)" },
  { kod: "BOQ2026", ad: "2026 BoQ — 12 Ekim 2026 ve sonrası", kisa: "2026 BoQ", baslangic: "2026-10-12", bitis: null,
    kaynak: "HW Frame 2026-27 (FPA3621TUR26101510697339) Appendix 5.1–5.7 + 2026-2027 Integrated Frame BOQ (L3)" },
];
const SINIR_TARIHI = "2026-10-12"; // yeni BoQ bu günden (dahil) itibaren — 00:00 Europe/Istanbul
const BOLGELER = ["Ankara", "Bursa", "Izmir"];

const surumBul = (kod) => SURUMLER.find((s) => s.kod === String(kod || "").trim().toUpperCase()) || null;

// Bölge adı normalize: "İzmir"/"IZMIR"/"B3" → "Izmir"; bilinmeyen → null
function bolgeNormalize(v) {
  const s = String(v || "").trim().toLocaleUpperCase("tr-TR").replace(/İ/g, "I").replace(/Ü/g, "U");
  if (!s) return null;
  if (s === "B1" || s.startsWith("ANKARA")) return "Ankara";
  if (s === "B2" || s.startsWith("BURSA")) return "Bursa";
  if (s === "B3" || s.startsWith("IZMIR")) return "Izmir";
  return null;
}

// Tarihi Europe/Istanbul gününe indirger ("YYYY-MM-DD"); DATE kolonları zaten gün olarak gelir
function istanbulGunu(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  // DATE kolonu pg'den UTC gece yarısı Date nesnesi olarak gelebilir → UTC gününü al
  if (typeof v !== "string" && d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) return d.toISOString().slice(0, 10);
  try {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" });
    return f.format(d);
  } catch { return d.toISOString().slice(0, 10); }
}
const trGun = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "");

// Tek bir tarih için sürüm önerisi
function tariheGoreSurum(tarih) {
  const g = istanbulGunu(tarih);
  if (!g) return null;
  return g >= SINIR_TARIHI ? "BOQ2026" : "BOQ2025";
}

// Sahanın malzeme geliş tarihi kaynakları (rollout_progress: RF ve ENH ayrı kolon) → öneri.
// Birden fazla farklı tarih, eksik tarih ya da çelişki → "DOGRULANAMADI" (sessiz karar yok).
async function malzemeGelisTarihi(pool, site, { kapsam = "RF" } = {}) {
  const s = String(site || "").replace(/\s+/g, "").toUpperCase();
  const out = { site: s, kapsam, durum: "YOK", tarih: null, kaynak: "", adaylar: [], mesaj: "" };
  if (!s) return out;
  let r;
  try {
    r = await pool.query(
      `SELECT malzeme_status, malzeme_gelis_tarihi, enh_malzeme_gelis_tarihi, bolge
         FROM rollout_progress WHERE UPPER(TRIM(site_code)) = $1 LIMIT 1`, [s]);
  } catch (e) { out.durum = "DOGRULANAMADI"; out.mesaj = `Rollout kaydı okunamadı: ${e.message}`; return out; }
  const row = r.rows[0];
  if (!row) { out.mesaj = "Saha Rollout Data'da yok — malzeme geliş tarihi bilinmiyor."; return out; }
  out.bolge = row.bolge || null;
  const rf = istanbulGunu(row.malzeme_gelis_tarihi);
  const enh = istanbulGunu(row.enh_malzeme_gelis_tarihi);
  if (rf) out.adaylar.push({ kaynak: "Rollout · RF malzeme geliş tarihi", tarih: rf });
  if (enh) out.adaylar.push({ kaynak: "Rollout · ENH malzeme geliş tarihi", tarih: enh });
  const secilen = kapsam === "ENH" ? (enh || null) : (rf || null);
  if (secilen) {
    out.durum = "OK"; out.tarih = secilen;
    out.kaynak = kapsam === "ENH" ? "Rollout · ENH malzeme geliş tarihi" : "Rollout · RF malzeme geliş tarihi";
  } else if (kapsam === "ENH" && rf) {
    out.durum = "DOGRULANAMADI"; out.mesaj = "ENH kapsamı için ayrı malzeme geliş tarihi girilmemiş; RF tarihi ENH için esas alınmaz.";
  } else if (kapsam === "RF" && enh) {
    out.durum = "DOGRULANAMADI"; out.mesaj = "RF malzeme geliş tarihi girilmemiş (yalnız ENH tarihi var).";
  } else {
    out.durum = String(row.malzeme_status || "").toUpperCase() === "OK" ? "DOGRULANAMADI" : "YOK";
    out.mesaj = String(row.malzeme_status || "").toUpperCase() === "OK"
      ? "Rollout'ta malzeme durumu OK ama geliş TARİHİ girilmemiş — Rollout Veri Girişi'nden malzeme geliş tarihini girin."
      : "Malzeme geliş tarihi girilmemiş.";
  }
  return out;
}

// Saha için sürüm önerisi (RF varsayılan; ENH tarihi farklıysa ayrıca döner)
async function surumOner(pool, site) {
  const rf = await malzemeGelisTarihi(pool, site, { kapsam: "RF" });
  const enh = await malzemeGelisTarihi(pool, site, { kapsam: "ENH" });
  const yap = (m) => {
    if (m.durum !== "OK") return { surum: null, durum: m.durum, tarih: null, kaynak: m.kaynak, gerekce: m.mesaj || "Malzeme geliş tarihi doğrulanamadı; BoQ seçimini kontrol edin." };
    const surum = tariheGoreSurum(m.tarih);
    return { surum, durum: "OK", tarih: m.tarih, kaynak: m.kaynak,
      gerekce: `Malzeme geliş tarihi: ${trGun(m.tarih)} → ${surumBul(surum).kisa} öneriliyor.` };
  };
  const oRf = yap(rf), oEnh = yap(enh);
  return { site: rf.site, bolge: rf.bolge || null, sinir: SINIR_TARIHI, rf: oRf, enh: oEnh,
    onerilen: oRf.surum, durum: oRf.durum, gerekce: oRf.gerekce,
    enh_farkli: !!(oRf.surum && oEnh.surum && oRf.surum !== oEnh.surum) };
}

// ── Şema ────────────────────────────────────────────────────────────────────────
async function tabloHazirla(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS boq_katalog (
    id SERIAL PRIMARY KEY,
    surum TEXT NOT NULL,
    kod TEXT NOT NULL,
    aciklama_en TEXT,
    aciklama_tr TEXT,
    birim TEXT,
    para_birimi TEXT,
    bolge TEXT,
    birim_fiyat NUMERIC,
    kapsam TEXT,
    ms TEXT,
    odeme_kosulu TEXT,
    kaynak_kapsam TEXT,
    kaynak_dosya TEXT,
    kaynak_sayfa TEXT,
    kaynak_satir TEXT,
    notlar TEXT,
    ice_alma_id INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  // Aynı kod, aynı bölge iki ayrı ödeme kapsamında (TE eki P1/P2 ↔ Power Access eki P3) farklı fiyatla geçebilir → anahtar ödeme koşulunu da içerir
  await pool.query(`ALTER TABLE boq_katalog ADD COLUMN IF NOT EXISTS kaynak_kapsam TEXT`);
  await pool.query(`DROP INDEX IF EXISTS boq_katalog_surum_kod_bolge`); await pool.query(`DROP INDEX IF EXISTS boq_katalog_surum_kod_bolge_odeme`); // önceki yerel deneme anahtarları
  // Aynı kod + bölge + ödeme koşulu hem TE ekinde hem Power Access ekinde (farklı fiyat/para birimi) → kaynak kapsamı (TE/PA) da anahtarda
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS boq_katalog_surum_kod_bolge_odeme_kapsam ON boq_katalog (surum, kod, COALESCE(bolge,''), COALESCE(odeme_kosulu,''), COALESCE(kaynak_kapsam,''))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS boq_katalog_ice_alma (
    id SERIAL PRIMARY KEY, surum TEXT NOT NULL, kullanici TEXT, kalem_sayisi INTEGER, onizleme_anahtari TEXT,
    ozet JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS boq_secim_log (
    id SERIAL PRIMARY KEY, site_code TEXT, item_code TEXT, master_id INTEGER, surum TEXT, onerilen_surum TEXT,
    oneri_gerekce TEXT, aykiri BOOLEAN DEFAULT false, gerekce TEXT, kullanici TEXT, zaman TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`ALTER TABLE master_works
    ADD COLUMN IF NOT EXISTS boq_surum TEXT,
    ADD COLUMN IF NOT EXISTS boq_bolge TEXT,
    ADD COLUMN IF NOT EXISTS boq_birim TEXT,
    ADD COLUMN IF NOT EXISTS boq_para_birimi TEXT,
    ADD COLUMN IF NOT EXISTS boq_birim_fiyat NUMERIC,
    ADD COLUMN IF NOT EXISTS boq_aciklama TEXT,
    ADD COLUMN IF NOT EXISTS boq_secim_gerekce TEXT,
    ADD COLUMN IF NOT EXISTS boq_secim_kullanici TEXT,
    ADD COLUMN IF NOT EXISTS boq_secim_zaman TIMESTAMPTZ`);
  // Gerçek malzeme teslim/varış tarihi (RF ve ENH ayrı) — Excel yükleme / kayıt tarihi DEĞİL
  await pool.query(`ALTER TABLE rollout_progress
    ADD COLUMN IF NOT EXISTS malzeme_gelis_tarihi DATE,
    ADD COLUMN IF NOT EXISTS enh_malzeme_gelis_tarihi DATE`);
}

// ── Sayı / birim ayrıştırma (TR "37.500,00" / EN "37,500.00" / "4722" / "0.45") ─────────────────────
function fiyatAyristir(v) {
  if (v === null || v === undefined) return { deger: null, bos: true };
  if (typeof v === "number") return Number.isFinite(v) ? { deger: v, bos: false } : { deger: null, supheli: true };
  let s = String(v).trim();
  if (!s) return { deger: null, bos: true };
  s = s.replace(/\s/g, "").replace(/(TL|TRY|USD|\$|₺|€)/gi, "");
  if (!/^[\d.,-]+$/.test(s)) return { deger: null, supheli: true, ham: v };
  const virgulSon = s.lastIndexOf(","), noktaSon = s.lastIndexOf(".");
  if (virgulSon >= 0 && noktaSon >= 0) s = virgulSon > noktaSon ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (virgulSon >= 0) s = (s.match(/,/g) || []).length > 1 || /,\d{3}$/.test(s) && s.length > 6 && !/,\d{1,2}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? { deger: n, bos: false } : { deger: null, supheli: true, ham: v };
}
const BIRIM_ESLE = { PCS: "PCS", PC: "PCS", ADET: "PCS", SITE: "SITE", SAHA: "SITE", SET: "SET", M: "M", METRE: "M", "M*M": "M2", M2: "M2", "M²": "M2",
  M3: "M3", "CU.M.": "M3", HOP: "HOP", DAY: "DAY", GUN: "DAY", GÜN: "DAY", SECTOR: "SECTOR", KG: "KG", KM: "KM", TON: "TON", HOUR: "HOUR", SAAT: "HOUR", LOT: "LOT", "M*M*M": "M3" };
function birimNormalize(v) {
  const s = String(v || "").trim().toLocaleUpperCase("tr-TR").replace(/İ/g, "I").replace(/\s+/g, "").replace(/ /g, "");
  if (!s) return { birim: null, bos: true };
  return BIRIM_ESLE[s] ? { birim: BIRIM_ESLE[s] } : { birim: s, supheli: true };
}
function paraNormalize(v) {
  const s = String(v || "").trim().toUpperCase();
  if (!s) return null;
  if (["TRY", "TL", "₺"].includes(s)) return "TRY";
  if (["USD", "$", "US$"].includes(s)) return "USD";
  if (["EUR", "€"].includes(s)) return "EUR";
  return s;
}

// ── Önizleme (saf hesap; DB'ye yazmaz) ───────────────────────────────────────────────────────
// kalemler: [{kod, aciklama_en, aciklama_tr, birim, para_birimi, bolge, birim_fiyat, kapsam, ms, odeme_kosulu, kaynak_dosya, kaynak_sayfa, kaynak_satir, notlar}]
// mevcutDiger: öteki sürümün {kod|bolge → kayıt} haritası (değişen kalemler için)
function onizle(surum, kalemler, mevcutDiger = {}, mevcutAyni = {}) {
  const S = surumBul(surum);
  const hatalar = [];
  if (!S) hatalar.push("Bilinmeyen sürüm: " + surum);
  const temiz = [];
  const kodSayac = {};
  const eksikFiyat = [], supheliFiyat = [], eksikBirim = [], supheliBirim = [], eksikPara = [], kodsuz = [];
  (Array.isArray(kalemler) ? kalemler : []).forEach((k, i) => {
    const kod = String(k.kod ?? k.item_code ?? "").trim();
    const ref = `${k.kaynak_dosya || "?"} / ${k.kaynak_sayfa || "?"} / ${k.kaynak_satir || "satır " + (i + 1)}`;
    if (!kod) { kodsuz.push({ sira: i + 1, aciklama: k.aciklama_en || k.aciklama_tr || "", ref }); return; }
    const bolge = bolgeNormalize(k.bolge) || null;
    const f = fiyatAyristir(k.birim_fiyat ?? k.unit_price);
    const b = birimNormalize(k.birim ?? k.unit);
    const para = paraNormalize(k.para_birimi ?? k.currency);
    const kaynakKapsam = String(k.kaynak_kapsam || "").trim().toUpperCase() || (/for PA|Power Access/i.test(String(k.kaynak_dosya || "")) ? "PA" : "TE");
    const anahtar = kod + "|" + (bolge || "") + "|" + String(k.odeme_kosulu || "") + "|" + kaynakKapsam;
    kodSayac[anahtar] = (kodSayac[anahtar] || 0) + 1;
    if (f.bos) eksikFiyat.push({ kod, bolge, ref });
    if (f.supheli) supheliFiyat.push({ kod, bolge, ham: f.ham, ref });
    if (f.deger !== null && f.deger <= 0) supheliFiyat.push({ kod, bolge, ham: k.birim_fiyat, ref, neden: "sıfır/negatif" });
    if (b.bos) eksikBirim.push({ kod, bolge, ref });
    if (b.supheli) supheliBirim.push({ kod, bolge, ham: k.birim, ref });
    if (!para) eksikPara.push({ kod, bolge, ref });
    temiz.push({
      surum: S ? S.kod : surum, kod, bolge,
      aciklama_en: String(k.aciklama_en ?? k.boq_items_en ?? "").trim() || null,
      aciklama_tr: String(k.aciklama_tr ?? "").trim() || null,
      birim: b.birim, para_birimi: para,
      birim_fiyat: f.deger, // boş fiyat SIFIR sayılmaz → null kalır
      kapsam: String(k.kapsam ?? k.business_type ?? "").trim() || null,
      ms: String(k.ms ?? "").trim() || null,
      odeme_kosulu: String(k.odeme_kosulu ?? "").trim() || null,
      kaynak_kapsam: kaynakKapsam,
      kaynak_dosya: String(k.kaynak_dosya ?? "").trim() || null,
      kaynak_sayfa: String(k.kaynak_sayfa ?? "").trim() || null,
      kaynak_satir: String(k.kaynak_satir ?? "").trim() || null,
      notlar: String(k.notlar ?? "").trim() || null,
    });
  });
  const tekrarKodlar = Object.entries(kodSayac).filter(([, n]) => n > 1).map(([a, n]) => { const [kod, bolge, odeme, kapsam] = a.split("|"); return { kod, bolge: bolge || null, odeme_kosulu: odeme || null, kaynak_kapsam: kapsam || null, adet: n }; });
  // Aynı kod + bölge farklı ödeme kapsamında (TE ↔ Power Access) — hata değil, bilgi
  const kapsamCakisma = {};
  temiz.forEach((k) => { const a = k.kod + "|" + (k.bolge || ""); (kapsamCakisma[a] = kapsamCakisma[a] || []).push(k); });
  const cokKapsamli = Object.values(kapsamCakisma).filter((l) => l.length > 1).map((l) => ({ kod: l[0].kod, bolge: l[0].bolge, kayitlar: l.map((x) => ({ odeme_kosulu: x.odeme_kosulu, para_birimi: x.para_birimi, birim_fiyat: x.birim_fiyat, kaynak: `${x.kaynak_dosya || ""} ${x.kaynak_sayfa || ""} ${x.kaynak_satir || ""}`.trim() })) }));
  // Öteki sürüme göre değişen kalemler (fiyat / açıklama / birim) + yalnız bu sürümde olanlar
  const degisen = [], yeni = [], ayniSurumdeDegisen = [];
  for (const k of temiz) {
    const a = k.kod + "|" + (k.bolge || "");
    const o = mevcutDiger[a] || mevcutDiger[k.kod + "|"];
    if (!o) { yeni.push({ kod: k.kod, bolge: k.bolge, aciklama: k.aciklama_en }); continue; }
    const fark = [];
    if (o.birim_fiyat !== null && k.birim_fiyat !== null && Math.abs(Number(o.birim_fiyat) - Number(k.birim_fiyat)) > 0.004) fark.push("fiyat");
    if ((o.birim || "") !== (k.birim || "")) fark.push("birim");
    if ((o.para_birimi || "") !== (k.para_birimi || "")) fark.push("para birimi");
    if ((o.aciklama_en || "").trim().toLowerCase() !== (k.aciklama_en || "").trim().toLowerCase()) fark.push("açıklama");
    if (fark.length) degisen.push({ kod: k.kod, bolge: k.bolge, fark, eski: { fiyat: o.birim_fiyat, birim: o.birim, para: o.para_birimi, aciklama: o.aciklama_en }, yeni: { fiyat: k.birim_fiyat, birim: k.birim, para: k.para_birimi, aciklama: k.aciklama_en } });
    const m = mevcutAyni[a];
    if (m && (Number(m.birim_fiyat ?? -1) !== Number(k.birim_fiyat ?? -1) || (m.birim || "") !== (k.birim || ""))) ayniSurumdeDegisen.push({ kod: k.kod, bolge: k.bolge, eski: m.birim_fiyat, yeni: k.birim_fiyat });
  }
  const ozet = {
    surum: S ? S.kod : surum, surum_ad: S ? S.ad : null, okunan: temiz.length, kodsuz: kodsuz.length,
    benzersiz_kod: new Set(temiz.map((k) => k.kod)).size, bolgeli: temiz.filter((k) => k.bolge).length,
    tekrar_kod: tekrarKodlar.length, eksik_fiyat: eksikFiyat.length, supheli_fiyat: supheliFiyat.length,
    eksik_birim: eksikBirim.length, supheli_birim: supheliBirim.length, eksik_para_birimi: eksikPara.length,
    diger_surume_gore_degisen: degisen.length, yalniz_bu_surumde: yeni.length, mevcut_kayda_gore_degisen: ayniSurumdeDegisen.length, cok_kapsamli_kod: cokKapsamli.length,
    para_dagilimi: temiz.reduce((m, k) => { const p = k.para_birimi || "?"; m[p] = (m[p] || 0) + 1; return m; }, {}),
  };
  const anahtar = crypto.createHash("sha256").update(JSON.stringify(temiz)).digest("hex").slice(0, 24);
  return { ok: hatalar.length === 0, hatalar, ozet, onizleme_anahtari: anahtar, kalemler: temiz,
    tekrar_kodlar: tekrarKodlar, eksik_fiyat: eksikFiyat, supheli_fiyat: supheliFiyat, eksik_birim: eksikBirim, supheli_birim: supheliBirim,
    eksik_para_birimi: eksikPara, kodsuz, degisen, yeni: yeni.slice(0, 500), ayni_surumde_degisen: ayniSurumdeDegisen, cok_kapsamli: cokKapsamli };
}

async function surumHaritasi(pool, surum) {
  const r = await pool.query(`SELECT kod, bolge, aciklama_en, birim, para_birimi, birim_fiyat FROM boq_katalog WHERE surum = $1`, [surum]);
  const m = {};
  for (const x of r.rows) { m[x.kod + "|" + (x.bolge || "")] = m[x.kod + "|" + (x.bolge || "")] || x; }
  return m;
}
async function onizleDb(pool, surum, kalemler) {
  const S = surumBul(surum);
  const diger = S ? SURUMLER.find((x) => x.kod !== S.kod) : null;
  const [mD, mA] = await Promise.all([diger ? surumHaritasi(pool, diger.kod) : {}, S ? surumHaritasi(pool, S.kod) : {}]);
  const o = onizle(surum, kalemler, mD, mA);
  o.diger_surum = diger ? diger.kod : null;
  o.mevcut_kayit_sayisi = Object.keys(mA).length;
  return o;
}

// İçe alma: önizleme anahtarı eşleşmeli; sürümün mevcut satırları tek işlemde değiştirilir (öteki sürüme dokunulmaz)
async function iceAl(pool, { surum, kalemler, onizleme_anahtari, kullanici }) {
  const o = await onizleDb(pool, surum, kalemler);
  if (!o.ok) { const e = new Error(o.hatalar.join("; ")); e.http = 400; throw e; }
  if (o.onizleme_anahtari !== onizleme_anahtari) { const e = new Error("Önizleme anahtarı uyuşmuyor — önce yeniden önizleyin"); e.http = 409; throw e; }
  if (o.tekrar_kodlar.length) { const e = new Error(`Tekrarlanan kod var (${o.tekrar_kodlar.slice(0, 5).map((t) => t.kod).join(", ")}) — içe alınmadı`); e.http = 400; throw e; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ia = await client.query(`INSERT INTO boq_katalog_ice_alma (surum, kullanici, kalem_sayisi, onizleme_anahtari, ozet) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [o.ozet.surum, kullanici || null, o.kalemler.length, onizleme_anahtari, JSON.stringify(o.ozet)]);
    const iaId = ia.rows[0].id;
    await client.query(`DELETE FROM boq_katalog WHERE surum = $1`, [o.ozet.surum]);
    for (const k of o.kalemler) {
      if (!k.kod) continue; // kodsuz satır (Excel'de kod yok) kataloğa yazılmaz — önizlemede listelenir
      await client.query(`INSERT INTO boq_katalog (surum, kod, aciklama_en, aciklama_tr, birim, para_birimi, bolge, birim_fiyat, kapsam, ms, odeme_kosulu, kaynak_kapsam, kaynak_dosya, kaynak_sayfa, kaynak_satir, notlar, ice_alma_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [k.surum, k.kod, k.aciklama_en, k.aciklama_tr, k.birim, k.para_birimi, k.bolge, k.birim_fiyat, k.kapsam, k.ms, k.odeme_kosulu, k.kaynak_kapsam, k.kaynak_dosya, k.kaynak_sayfa, k.kaynak_satir, k.notlar, iaId]);
    }
    await client.query("COMMIT");
    return { ok: true, ice_alma_id: iaId, eklenen: o.kalemler.filter((k) => k.kod).length, kodsuz_atlanan: o.kodsuz.length, ozet: o.ozet };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  finally { client.release(); }
}

// ── Sürüm durumu / arama / kalem getirme ──────────────────────────────────────────────────────
async function surumDurumu(pool) {
  const r = await pool.query(`SELECT surum, COUNT(*)::int AS kalem, COUNT(DISTINCT kod)::int AS kod, COUNT(*) FILTER (WHERE birim_fiyat IS NOT NULL)::int AS fiyatli,
      MAX(created_at) AS son FROM boq_katalog GROUP BY surum`).catch(() => ({ rows: [] }));
  const m = {}; r.rows.forEach((x) => { m[x.surum] = x; });
  return { sinir: SINIR_TARIHI, surumler: SURUMLER.map((s) => ({ ...s, kalem: m[s.kod]?.kalem || 0, kod_sayisi: m[s.kod]?.kod || 0, fiyatli: m[s.kod]?.fiyatli || 0, son_ice_alma: m[s.kod]?.son || null, hazir: (m[s.kod]?.kalem || 0) > 0 })) };
}
async function katalogVarMi(pool, surum) {
  const r = await pool.query(`SELECT 1 FROM boq_katalog WHERE surum = $1 LIMIT 1`, [surum]).catch(() => ({ rows: [] }));
  return r.rows.length > 0;
}
// Bölge fiyatı varsa o, yoksa bölgesiz satır
async function kalemGetir(pool, surum, kod, bolge, { kapsam = null } = {}) {
  const b = bolgeNormalize(bolge);
  const pa = String(kapsam || "").toUpperCase() === "POWER" || String(kapsam || "").toUpperCase() === "ENH";
  const r = await pool.query(`SELECT * FROM boq_katalog WHERE surum = $1 AND kod = $2 AND (bolge = $3 OR bolge IS NULL)
     ORDER BY CASE WHEN bolge = $3 THEN 0 ELSE 1 END, CASE WHEN COALESCE(kaynak_kapsam,'TE') = 'PA' THEN ${pa ? 0 : 1} ELSE ${pa ? 1 : 0} END LIMIT 1`, [surum, String(kod || "").trim(), b]);
  return r.rows[0] || null;
}
async function katalogAra(pool, { surum, q = "", bolge = null, limit = 60, kodlar = null }) {
  const S = surumBul(surum);
  if (!S) return [];
  const b = bolgeNormalize(bolge);
  const params = [S.kod, b];
  let where = `surum = $1 AND (bolge = $2 OR bolge IS NULL)`;
  if (Array.isArray(kodlar) && kodlar.length) { params.push(kodlar); where += ` AND kod = ANY($${params.length})`; }
  else if (String(q || "").trim()) { params.push("%" + String(q).trim().toLowerCase() + "%"); where += ` AND (LOWER(kod) LIKE $${params.length} OR LOWER(COALESCE(aciklama_en,'')) LIKE $${params.length} OR LOWER(COALESCE(aciklama_tr,'')) LIKE $${params.length})`; }
  params.push(Math.min(Number(limit) || 60, 2000));
  const r = await pool.query(`SELECT DISTINCT ON (kod, COALESCE(kaynak_kapsam,'TE')) kod, aciklama_en, aciklama_tr, birim, para_birimi, bolge, birim_fiyat, kapsam, ms, odeme_kosulu, kaynak_kapsam, kaynak_dosya, kaynak_sayfa, kaynak_satir, surum
      FROM boq_katalog WHERE ${where} ORDER BY kod, COALESCE(kaynak_kapsam,'TE'), CASE WHEN bolge = $2 THEN 0 ELSE 1 END LIMIT $${params.length}`, params);
  return r.rows;
}

// PR satırı için anlık görüntü + sunucu doğrulaması.
// Döner: { ok, snapshot:{...} | null, hata, katalog_yok }
async function prSnapshot(pool, { surum, kod, bolge, kapsam = null }) {
  const S = surumBul(surum);
  if (!S) return { ok: false, hata: `Geçersiz BoQ sürümü: ${surum}` };
  if (!(await katalogVarMi(pool, S.kod))) return { ok: true, snapshot: null, katalog_yok: true, uyari: `${S.ad} kataloğu henüz içe alınmamış — fiyat anlık görüntüsü yazılamadı` };
  const k = await kalemGetir(pool, S.kod, kod, bolge, { kapsam });
  if (!k) return { ok: false, hata: `${kod} kalemi ${S.kisa} kataloğunda yok — bu sürümde geçerli bir kalem seçin` };
  return { ok: true, snapshot: { boq_surum: S.kod, boq_bolge: k.bolge || null, boq_birim: k.birim || null, boq_para_birimi: k.para_birimi || null,
    boq_birim_fiyat: k.birim_fiyat === null ? null : Number(k.birim_fiyat), boq_aciklama: k.aciklama_en || null }, fiyat_yok: k.birim_fiyat === null };
}

module.exports = { SURUMLER, SINIR_TARIHI, BOLGELER, surumBul, bolgeNormalize, istanbulGunu, tariheGoreSurum, trGun,
  malzemeGelisTarihi, surumOner, tabloHazirla, fiyatAyristir, birimNormalize, paraNormalize, onizle, onizleDb, iceAl,
  surumDurumu, katalogVarMi, kalemGetir, katalogAra, prSnapshot };
