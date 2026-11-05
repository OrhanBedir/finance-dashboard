// ═══ TAŞERON SAHA OPERASYONU (04.11.2026, Orhan) ═════════════════════════════════════════════════════════════════
// Omnix mobil → taşeron hesabı → "Sahalar" (Sahalarım listesi + Harita + iş detayı + Montaja Başla / Montajı Tamamla).
// Teknocenter'ın taşeronları (TEKNO_EMRAH, TEKNO_2KX, TEKNO_İZTAŞ …) için. AYRI bir kayıt sistemi değildir:
//   • Firma kimliği     : users.kullanici_tipi='TASERON' + users.taseron_id (subcons.id) — omnixProfil.taseronKapsami
//   • Ekip / rol        : taseron_saha_uye (SORUMLU = firmanın tüm ekipleri · CALISAN = kendi ekibi). Satırı olmayan taşeron
//                         hesabı firma geneli görür (mevcut /taseron-panel hakkıyla aynı). Ekip ↔ firma: ekipler.firma_id (tam id).
//   • İş seti           : Rollout iş kolu taşeron sütunları (üst kol mirasıyla) firmanın kayıtlı adlarına TAM eşit (Türkçe harf katlamalı)
//                         + Günlük İş kalemleri (master_works.subcon_name) + firmanın / firma ekiplerinin iş atamaları (is_atama).
//                         Ön ek / benzerlik YOK: TEKNO_2KX ≠ 2KX, TEKNO_İZTAŞ ≠ İZTAŞ.
//   • Montaj durumu     : fiiliDurum (is_fiili_bildirim → is_atama → Rollout tarihleri) — web haritası / Plan ile aynı kaynak.
//   • Montaja Başla     : is_fiili_bildirim BASLADI + Rollout installation_actual_start_date (isAtamaRolloutTarihYaz, boşsa) +
//                         firmanın açık montaj ataması BASLADI. İkinci başlangıç kaydı açılmaz (iş kodu kilidi + durum kontrolü).
//   • Montajı Tamamla   : TAM → TAMAMLANDI olayı + installation_actual_end_date; KISMI → bitiş YAZILMAZ (tamamlanmış sayılmaz).
//                         QC / Huawei kabulü / PR / hakediş / fatura YAZILMAZ; taşeron QC veremez, sorun / alarm kapatamaz.
//   • Rapor             : taseron_saha_bildirim (yapılan iş, kalan iş, sorun, foto) — Teknocenter PR hazırlığına KAYNAKTIR, PR değildir.
//                         Düzeltme sürüm geçmişiyle (taseron_saha_bildirim_surum); aynı rapordan ikinci PR engellenir.
// Gizlilik: hiçbir yanıtta PO / BoQ / taşeron fiyatı, hakediş, fatura, ödeme, cari, maaş, banka yok. Başka firmanın kayıtları,
// notları, raporları (aynı fiziksel sahada olsa bile) verilmez; kapsam dışı iş "bulunamadı" döner (varlığı söylenmez).
"use strict";

const crypto = require("crypto");
const multer = require("multer");
const bcrypt = require("bcrypt");
const { kalemKolu } = require("./taseronCozum");

const kodT = (s) => String(s || "").replace(/\s+/g, "").toUpperCase();
const temiz = (s, n = 2000) => String(s ?? "").trim().replace(/[ \t]+/g, " ").slice(0, n);
const iso = (v) => (v ? new Date(v).toISOString() : null);
const gun = (v) => { if (!v) return null; if (v instanceof Date) return isNaN(v) ? null : new Date(v.getTime() + 3 * 3600e3).toISOString().slice(0, 10); const t = String(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };
// SQL tarafı Türkçe harf katlama — server.js firmaKatla ile aynı sonuç (İ/ı → I, Ş → S …, boşluk tekilleşir)
const KATLA_SQL = (ifade) => `regexp_replace(translate(UPPER(TRIM(${ifade})), 'İŞĞÜÖÇışğüöç', 'ISGUOCISGUOC'), '\\s+', ' ', 'g')`;

const MONTAJ_AD = { BEKLIYOR: "Montaj bekliyor", DEVAM: "Montaj devam ediyor", KISMI: "Kısmi · devam edecek", TAMAMLANDI: "Montaj tamamlandı", KONTROL: "Kontrol gerekli" };
const PR_AD = { BEKLIYOR: "Teknocenter incelemesi bekliyor", INCELENDI: "Teknocenter inceledi", PR_HAZIRLANIYOR: "PR hazırlanıyor", PR_HAZIRLANDI: "PR hazırlandı" };
const TUR_AD = { BASLADI: "Montaja başlandı", TAMAMLANDI: "Montaj tamamlandı", KISMI: "Kısmi iş · devam edecek" };
const KOL_AD = { rf: "RF kurulum", los: "LOS", tss: "TSS", tssr: "TSSR", btk: "BTK", trs: "TRS (MW)", enh: "Enerji (ENH)", enh_proje: "ENH proje", power: "Power", emr: "EMR", pac: "PAC", ysb: "YSB" };
const ACIK_ATAMA = ["ATANDI", "BASLADI", "DEVAM", "ARA_VERILDI"];
const FOTO_MAX = 6;
const FOTO_BOYUT = 10 * 1024 * 1024;
const TR_KUTU = { latMin: 35.5, latMax: 42.5, lngMin: 25.5, lngMax: 45 };

async function semaKur(pool) {
  const q = (s) => pool.query(s).catch((e) => console.error("[taşeron saha şema]", e.message));
  await q(`CREATE TABLE IF NOT EXISTS taseron_saha_uye (user_id INTEGER PRIMARY KEY, taseron_id INTEGER NOT NULL, ekip_no INTEGER,
    rol TEXT NOT NULL DEFAULT 'CALISAN' CHECK (rol IN ('SORUMLU','CALISAN')), aktif BOOLEAN NOT NULL DEFAULT true, ekleyen TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await q(`CREATE INDEX IF NOT EXISTS taseron_saha_uye_firma_idx ON taseron_saha_uye (taseron_id, ekip_no)`);
  await q(`CREATE TABLE IF NOT EXISTS taseron_saha_bildirim (id BIGSERIAL PRIMARY KEY, site_code TEXT NOT NULL, fiziksel_id TEXT, taseron_id INTEGER NOT NULL,
    ekip_no INTEGER, user_id INTEGER, bildiren_email TEXT, bildiren_ad TEXT, tur TEXT NOT NULL CHECK (tur IN ('BASLADI','TAMAMLANDI','KISMI')), standart BOOLEAN,
    aciklama TEXT, kalan_is TEXT, sorun TEXT, konum JSONB, fotolar JSONB NOT NULL DEFAULT '[]'::jsonb, istek_anahtari TEXT, surum INTEGER NOT NULL DEFAULT 1,
    pr_durum TEXT NOT NULL DEFAULT 'BEKLIYOR' CHECK (pr_durum IN ('BEKLIYOR','INCELENDI','PR_HAZIRLANIYOR','PR_HAZIRLANDI')), pr_ref TEXT, inceleyen TEXT,
    inceleme_notu TEXT, inceleme_zamani TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await q(`CREATE INDEX IF NOT EXISTS taseron_saha_bildirim_kod_idx ON taseron_saha_bildirim (site_code, created_at)`);
  await q(`CREATE INDEX IF NOT EXISTS taseron_saha_bildirim_firma_idx ON taseron_saha_bildirim (taseron_id, created_at)`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS taseron_saha_bildirim_istek_uq ON taseron_saha_bildirim (user_id, istek_anahtari) WHERE istek_anahtari IS NOT NULL`);
  await q(`CREATE TABLE IF NOT EXISTS taseron_saha_bildirim_surum (id BIGSERIAL PRIMARY KEY, bildirim_id BIGINT NOT NULL, surum INTEGER NOT NULL, eski JSONB NOT NULL,
    degistiren TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await q(`CREATE INDEX IF NOT EXISTS taseron_saha_bildirim_surum_idx ON taseron_saha_bildirim_surum (bildirim_id, surum)`);
  for (const t of ["taseron_saha_uye", "taseron_saha_bildirim", "taseron_saha_bildirim_surum"]) await q(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
}

// ── SAF KURALLAR (birim testli) ──────────────────────────────────────────────────────────────────────────────────
// Satırda firmanın sahip olduğu iş kolları: taşeron sütunu boşsa üst kolun taşeronu geçerlidir (los/tss/… → rf; enh_proje/power → enh)
function firmaKollari(row, alanlar, firmaAdi, katla, adSet) {
  const etkin = {}, kollar = new Set();
  for (const L of alanlar) {
    const v = firmaAdi(row?.[L.subcon]) || (L.ust ? etkin[L.ust] : null) || null;
    etkin[L.kolu] = v;
    if (v && adSet.has(katla(v))) kollar.add(L.kolu);
  }
  return { kollar, etkin };
}
// CALISAN: kendi ekibinin işleri + kendisine doğrudan atananlar; ekibi yoksa ekibe ayrılmamış firma işleri.
// SORUMLU ve üyelik satırı olmayan (firma geneli) hesap: firmanın bütün işleri.
function gorunurMu(is, K) {
  if (K.rol !== "CALISAN") return true;
  if (is.bana) return true;
  return K.ekip_no == null ? is.ekip_no == null : Number(is.ekip_no) === Number(K.ekip_no);
}
function montajDurumu(fiili, sonBildirim) {
  const k = fiili?.kod;
  if (!k || ["YOK", "PLANLANDI", "BASLAMADI"].includes(k)) return "BEKLIYOR";
  if (k === "TAMAMLANDI") return "TAMAMLANDI";
  if (k === "DOGRULANMADI") return "KONTROL";
  return sonBildirim?.tur === "KISMI" ? "KISMI" : "DEVAM";
}
// Açık issue olayı (fiiliDurum ile aynı kural: GERI_AL son olayı geri alır; ISSUE_KAPANDI / TAMAMLANDI kapatır)
function acikIssue(olaylar) {
  const etkin = [];
  for (const o of [...olaylar].sort((a, b) => new Date(a.zaman) - new Date(b.zaman) || Number(a.id || 0) - Number(b.id || 0))) {
    if (o.olay === "GERI_AL") etkin.pop(); else etkin.push(o);
  }
  let acik = null;
  for (const o of etkin) { if (o.olay === "ISSUE") acik = o; else if (["ISSUE_KAPANDI", "TAMAMLANDI"].includes(o.olay)) acik = null; }
  return acik;
}
// Tamamla formu: TAM + "standart tam" → açıklama isteğe bağlı; TAM değilse açıklama zorunlu; KISMI → kalan iş zorunlu
function tamamlaDogrula(b) {
  const tur = String(b?.tur || "").toUpperCase();
  if (!["TAM", "KISMI"].includes(tur)) return { hata: "Tam mı, kısmi mi seçin" };
  const standart = tur === "TAM" && b?.standart === true;
  const aciklama = temiz(b?.aciklama), kalan = temiz(b?.kalan_is), sorun = temiz(b?.sorun, 1000);
  if (tur === "TAM" && !standart && aciklama.length < 3) return { hata: "Yapılan işi kısaca yazın ya da \"Standart tam\" seçin" };
  if (tur === "KISMI" && kalan.length < 3) return { hata: "Kalan işi yazın — kısmi iş tamamlanmış sayılmaz" };
  if (tur === "KISMI" && aciklama.length < 3) return { hata: "Bugün yapılan işi kısaca yazın" };
  return { tur, standart, aciklama: aciklama || null, kalan_is: kalan || null, sorun: sorun || null };
}
// 05.11.2026 QC ham durumu → etiket. Kaynaklar: Rollout qc_durum / qc_closed_date (OK = kapandı) ve Huawei Smart QC görev
// durumu (rollout_is_kolu.hw_status: To Be Executed / Executing / Rejected / Closed). qc_durum = NOK "QC başladı" DEĞİLDİR —
// NOK, başlamamış / reddedilmiş / bilinmeyen durumları birleştirir; başlangıç yalnız Smart QC görev durumundan okunur.
// RF montaj kalemi: taseronCozum RF kolu + paket kalemleri (Co-Located kurulum, band ilavesi, modernizasyon) — paket açıklamasında
// "installation" geçmediği için taseronCozum bunları kola bağlamıyor; burada yalnız montaj sahipliği kanıtı olarak kullanılır
const RF_MONTAJ_KALEMI = (d) => kalemKolu(d) === "rf" || /co-located site|band addition|band moderni[sz]ation/i.test(String(d || ""));
const QC_HW = { "TO BE EXECUTED": "BASLADI", EXECUTING: "BASLADI", REJECTED: "RED", CLOSED: "KAPANDI" };
const QC_AD = { KAPANDI: "QC kapandı (OK)", BASLADI: "QC başladı / kontrolde", RED: "QC reddedildi — düzeltme bekleniyor", BILINMIYOR: "QC kapanmadı · başlangıç bilgisi kaynakta yok", YOK: "QC kaydı yok" };
function qcEtiket({ qc_durum, qc_kapanis, hw = [] }) {
  const h = hw.map((x) => QC_HW[String(x || "").trim().toUpperCase()]).filter(Boolean);
  const qc = String(qc_durum || "").trim().toUpperCase();
  const kod = qc === "OK" || h.includes("KAPANDI") ? "KAPANDI" : h.includes("RED") ? "RED" : h.includes("BASLADI") ? "BASLADI" : qc ? "BILINMIYOR" : "YOK";
  return { kod, ad: QC_AD[kod], ham: [qc ? `Rollout QC: ${qc}` : null, ...hw.filter(Boolean).map((x) => `Smart QC: ${x}`)].filter(Boolean), tarih: kod === "KAPANDI" ? qc_kapanis || null : null };
}
// 05.11.2026 "Yaptığımız Sahalar": işin bu firma tarafından yapıldığının kanıtı ve sınıfı. Plan / atama tek başına kanıt DEĞİLDİR.
//   montaj: kart montaj durumu (fiiliDurum: Rollout tarihleri + bildirim olayları), fiziki: firmanın Günlük İş kalemlerinde
//   tamamlanan miktar, rapor: firmanın saha bildirimi, qc: qcEtiket kodu, montajBizde: ana montaj bu firmada mı
function gecmisSinif({ montaj, fiziki = 0, pr = 0, rapor = false, qc, montajBizde = true }) {
  const kanit = [];
  if (montaj === "TAMAMLANDI") kanit.push("Montaj bitişi kayıtlı");
  else if (["DEVAM", "KISMI", "KONTROL"].includes(montaj)) kanit.push("Montaj başlangıcı kayıtlı");
  if (fiziki > 0) kanit.push("Günlük İş'te fiziki miktar");
  if (rapor) kanit.push("Ekip saha raporu");
  const qcVar = ["BASLADI", "KAPANDI", "RED"].includes(qc);
  if (!kanit.length && !qcVar) return { sinif: "PLAN", kanit, teyit: null };
  if (!montajBizde) return { sinif: "KATILIM", kanit, teyit: "Ana montaj başka firmada — yalnız kendi iş kolunuz" };
  if (montaj === "TAMAMLANDI") return { sinif: "TAMAMLANDI", kanit, teyit: fiziki > 0 ? null : "Montaj bitişi var, Günlük İş fiziki miktarı girilmemiş" };
  if (["DEVAM", "KISMI", "KONTROL"].includes(montaj)) {
    if (fiziki > 0 && fiziki < pr) return { sinif: "KISMI", kanit, teyit: null }; // fiziki miktar PR'ın altında: kısmi iş
    if (fiziki > 0) return { sinif: "TEYIT", kanit, teyit: "Fiziki miktar girilmiş ama montaj bitişi yok — teyit bekliyor" };
    return { sinif: montaj === "KISMI" ? "KISMI" : "DEVAM", kanit, teyit: montaj === "KONTROL" ? "Montaj kaydı doğrulanmadı" : null };
  }
  if (fiziki > 0) return { sinif: "TEYIT", kanit, teyit: "Günlük İş'te fiziki miktar var, montaj tarihleri kayıtlı değil — teyit bekliyor" };
  return { sinif: "TEYIT", kanit: [...kanit, "QC kaydı"], teyit: "QC başladı — montaj tamamlanma kaydı teyit bekliyor" };
}
function konumDogrula(k) {
  if (!k || typeof k !== "object") return null;
  const lat = Number(k.lat), lng = Number(k.lng);
  if (!isFinite(lat) || !isFinite(lng) || lat < TR_KUTU.latMin || lat > TR_KUTU.latMax || lng < TR_KUTU.lngMin || lng > TR_KUTU.lngMax) return null;
  const d = Number(k.dogruluk_m);
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, dogruluk_m: isFinite(d) ? Math.round(d) : null, kaynak: "cihaz" };
}

// ── /auth/me ve CALISAN kapısı için üyelik okuma (30 sn önbellek) ────────────────────────────────────────────────
const _uyeOnbellek = new Map();
async function uyeOku(pool, userId, { taze = false } = {}) {
  const id = Number(userId || 0);
  if (!id) return null;
  const c = _uyeOnbellek.get(id);
  if (!taze && c && Date.now() - c.t < 30e3) return c.v;
  const r = await pool.query(`SELECT u.user_id, u.taseron_id, u.ekip_no, u.rol, u.aktif, e.ad AS ekip_ad, e.plaka AS ekip_plaka, (to_jsonb(e)->>'firma_id')::int AS ekip_firma_id
    FROM taseron_saha_uye u LEFT JOIN ekipler e ON e.ekip_no = u.ekip_no WHERE u.user_id = $1`, [id]).catch(() => ({ rows: [] }));
  const v = r.rows[0] || null;
  _uyeOnbellek.set(id, { t: Date.now(), v });
  return v;
}
// /auth/me → taseron_saha: mobil sekme seçimi için (yetki SUNUCUDA her uçta ayrıca doğrulanır)
async function sahaRolu(pool, userId, taseronId) {
  const u = await uyeOku(pool, userId).catch(() => null);
  if (!u) return { rol: "SORUMLU", varsayilan: true, saha_acik: true, ekip_no: null, ekip_ad: null };
  // 05.11.2026: "Saha ekranı" kapalı firma sorumlusu finans / iş görünümünü korur, yalnız Sahalar kapanır; kapalı çalışanın hiçbir sekmesi yok
  if (Number(u.taseron_id) !== Number(taseronId) || (!u.aktif && u.rol !== "SORUMLU")) return { rol: "KAPALI", varsayilan: false, saha_acik: false, ekip_no: null, ekip_ad: null };
  return { rol: u.rol, varsayilan: false, saha_acik: !!u.aktif, ekip_no: u.ekip_no ?? null, ekip_ad: u.ekip_ad || null };
}
// Çalışan hesabı firma özetine / hakedişe / faturaya / iş fiyatlarına giremez (firma sorumlusunun hakları sızmaz)
const CALISAN_KAPALI = /^\/taseron-panel\/(ozet|isler|belgeler|hakedis|faturalar|cari)(\/|$)/;
function calisanKapisi(pool) {
  return async (req, res, next) => {
    try {
      const u = req.user;
      if (!u || req.method === "OPTIONS" || !CALISAN_KAPALI.test(req.path)) return next();
      if (!(u.kullanici_tipi === "TASERON" || String(u.role || "").toLowerCase() === "subcon")) return next();
      const uye = await uyeOku(pool, u.user_id);
      // Saha ekranı kapalı (aktif=false) firma sorumlusu finans uçlarına girmeye devam eder; çalışan hiçbir durumda giremez
      if (uye && uye.rol !== "SORUMLU") return res.status(403).json({ ok: false, error: "Bu bölüm firma sorumlusuna açık" });
      next();
    } catch (e) { next(e); }
  };
}

function kur(app, deps) {
  const { pool, authMiddleware, taseronKapsami, planSenkron, fiiliDurum, sahaKimlik, islemGecmisiYaz, isAtamaRolloutTarihYaz, ROLLOUT_IS_KOLU_ALANLARI,
    rolloutFirmaAdi, firmaKatla, isAtamaYetkiliMi, taseronMu, mobilKonum, ozelYukle, ozelIndir, ozelSil, altMarkaKullanicisi, kapsamIsKodlari, firmaYonetebilir, hesapAcabilir, grupKodu, hakedisDurumu } = deps;
  const ALANLAR = ROLLOUT_IS_KOLU_ALANLARI;
  const H = (durum, mesaj, ek) => Object.assign(new Error(mesaj), { durum, mesaj, ek });
  const hata = (res, e) => {
    if (e && e.durum) return res.status(e.durum).json({ ok: false, error: e.mesaj || e.message, ...(e.ek || {}) });
    console.error("[taşeron saha]", e && e.message); res.status(500).json({ ok: false, error: "İşlem tamamlanamadı. Lütfen tekrar deneyin." });
  };
  const ben = (req) => String(req.user?.email || "").toLowerCase().trim();
  const fotoYukle = multer({ storage: multer.memoryStorage(), limits: { fileSize: FOTO_BOYUT, files: 1 },
    fileFilter: (req, f, cb) => cb(null, /^image\/(jpeg|jpg|png|heic|heif|webp)$/i.test(f.mimetype || "")) });

  // ── KİMLİK: firma (taseronKapsami) + ekip / rol (taseron_saha_uye) ──────────────────────────────────────────────
  async function kimlik(req) {
    const k = await taseronKapsami(req);
    if (k.kod) throw H(k.kod, k.mesaj);
    const firmaId = Number(k.taseron.id);
    const uye = await uyeOku(pool, req.user.user_id, { taze: true });
    if (uye && Number(uye.taseron_id) !== firmaId) throw H(403, "Ekip kaydınız firma hesabınızla uyuşmuyor. Lütfen Teknocenter ile görüşün.");
    if (uye && !uye.aktif) throw H(403, "Saha ekranı hesabınız için kapalı. Lütfen firma sorumlunuzla görüşün.");
    const ekipler = (await pool.query(`SELECT ekip_no, ad, plaka FROM ekipler WHERE (to_jsonb(ekipler)->>'firma_id')::int = $1 AND COALESCE(aktif, true) ORDER BY ekip_no`, [firmaId])
      .catch(() => ({ rows: [] }))).rows;
    const rol = uye ? uye.rol : "SORUMLU";
    const ekip_no = uye?.ekip_no ?? null;
    if (rol === "CALISAN" && ekip_no != null && !ekipler.some((e) => Number(e.ekip_no) === Number(ekip_no)))
      throw H(403, "Ekibiniz firmanıza bağlı görünmüyor. Lütfen Teknocenter ile görüşün.");
    const adlar = [...new Set(k.adlar)];
    return { taseron: k.taseron, firmaId, firmaAd: k.taseron.unvan || k.taseron.subcon_name, adlar, anaFirma: String(k.taseron.ana_firma || "").trim().toUpperCase() || null, adKatli: new Set(adlar.map(firmaKatla)),
      rol, varsayilan: !uye, ekip_no, ekipler, ekipNolar: ekipler.map((e) => Number(e.ekip_no)), email: ben(req), ad: req.user?.name || ben(req), userId: Number(req.user.user_id) };
  }
  const kapi = (fn) => [authMiddleware, async (req, res) => { try { const K = await kimlik(req); await fn(req, res, K); } catch (e) { hata(res, e); } }];

  // ── İŞ SETİ: firmanın işleri (iş kodu bazında) ──────────────────────────────────────────────────────────────────
  const SATIR_ALANLARI = ["site_type", "bolge", "il", "project_code", "installation_actual_start_date", "installation_actual_end_date", "rf_started_date", "rf_finished_date",
    "onair_date", "qc_durum", "qc_closed_date", "rf_note", "rf_not"];
  const satirSecimi = `rp.site_code, ${[...SATIR_ALANLARI, ...ALANLAR.map((L) => L.subcon)].map((a) => `to_jsonb(rp)->>'${a}' AS "${a}"`).join(", ")}`;
  async function isSeti(K, db = pool) {
    const katli = [...K.adKatli];
    const isler = new Map();
    const al = (kod) => { let x = isler.get(kod); if (!x) isler.set(kod, (x = { kod, row: null, rfBizim: false, rfBaska: null, rfGrup: false, kollar: new Set(), kalem: false, rfKalem: false, atamalar: [], bana: false })); return x; };
    // 05.11.2026: Rollout RF sütununda yalnız üst firma grup adı (ör. "TEKNO") yazılıysa ve Günlük İş'te bu iş kodunun RF montaj
    // kalemi bu firmanın tam adıyla kayıtlıysa montaj bu firmanındır (taseronCozum GRUP_ADI kuralı). Grup adı başka firma sayılmaz.
    const grupOnbellek = new Map();
    const grupBizim = async (ad) => {
      if (!grupKodu || !K.anaFirma || !ad) return false;
      if (!grupOnbellek.has(ad)) grupOnbellek.set(ad, await grupKodu(ad).catch(() => null));
      return String(grupOnbellek.get(ad) || "").toUpperCase() === K.anaFirma;
    };
    const satirIsle = async (x, r) => {
      const { kollar, etkin } = firmaKollari(r, ALANLAR, rolloutFirmaAdi, firmaKatla, K.adKatli);
      if (!kollar.has("rf") && etkin.rf && x.rfKalem && await grupBizim(etkin.rf)) { kollar.add("rf"); x.rfGrup = true; }
      kollar.forEach((k) => x.kollar.add(k));
      if (kollar.has("rf")) { x.row = r; x.rfBizim = true; x.rfBaska = null; }
      else if (!x.rfBizim) { if (!x.row) x.row = r; if (etkin.rf && !x.rfBaska) x.rfBaska = true; }
      return kollar.size;
    };
    // 0) Günlük İş kalemleri (fiyat okunmaz): RF montaj kalemi bu firmada mı (grup adı kuralı için önce okunur)
    const mw = (await db.query(`SELECT UPPER(TRIM(site_code)) AS kod, item_description FROM master_works WHERE ${KATLA_SQL("subcon_name")} = ANY($1::text[])`, [katli]).catch(() => ({ rows: [] }))).rows;
    for (const m of mw) if (kodT(m.kod)) { const x = al(kodT(m.kod)); x.kalem = true; if (RF_MONTAJ_KALEMI(m.item_description)) x.rfKalem = true; }
    // 1) Rollout: herhangi bir iş kolunda firma adı (tam eşitlik — ön süzgeç SQL'de, kesin karar JS'te üst kol mirasıyla)
    const kosul = ALANLAR.map((L) => `${KATLA_SQL(`to_jsonb(rp)->>'${L.subcon}'`)} = ANY($1::text[])`).join(" OR ");
    const rp = (await db.query(`SELECT ${satirSecimi} FROM rollout_progress rp WHERE ${kosul} ORDER BY rp.updated_at DESC NULLS LAST`, [katli])).rows;
    for (const r of rp) {
      const kod = kodT(r.site_code);
      if (!kod) continue;
      const { kollar } = firmaKollari(r, ALANLAR, rolloutFirmaAdi, firmaKatla, K.adKatli);
      if (kollar.size) await satirIsle(al(kod), r);
    }
    // 3) İş atamaları: firmaya ya da firmanın ekiplerine; ayrıca bu kullanıcıya doğrudan (başka firmaya bağlı atama hariç)
    const at = (await db.query(`SELECT a.id, a.kategori, kt.ad AS kategori_ad, COALESCE(kt.qc_yazar, false) AS qc_yazar, a.site_codes, a.durum, (to_jsonb(a)->>'ekip_no')::int AS ekip_no,
        a.taseron_id, a.personeller, a.plan_tarihi, a.baslama_ts, a.bitis_ts, a.created_at, a.updated_at
      FROM is_atama a LEFT JOIN is_kategori kt ON kt.kod = a.kategori
      WHERE COALESCE(a.durum, '') <> 'IPTAL' AND (a.taseron_id = $1 OR (to_jsonb(a)->>'ekip_no')::int = ANY($2::int[])
        OR ((a.taseron_id IS NULL OR a.taseron_id = $1) AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(a.personeller, '[]'::jsonb)) p WHERE LOWER(TRIM(p->>'email')) = $3)))
      ORDER BY a.updated_at DESC NULLS LAST, a.id DESC`, [K.firmaId, K.ekipNolar, K.email]).catch(() => ({ rows: [] }))).rows;
    for (const a of at) {
      const firmaninMi = Number(a.taseron_id) === K.firmaId || K.ekipNolar.includes(Number(a.ekip_no));
      const bana = (Array.isArray(a.personeller) ? a.personeller : []).some((p) => String(p?.email || "").toLowerCase().trim() === K.email);
      for (const s of a.site_codes || []) {
        const kod = kodT(s);
        if (!kod) continue;
        const x = al(kod);
        x.atamalar.push({ ...a, firmanin: firmaninMi });
        if (bana) x.bana = true;
      }
    }
    // Rollout satırı olmayan (yalnız kalem / atama ile gelen) işler: montaj tarihleri ve rf sahibi için satırı oku
    const eksik = [...isler.values()].filter((x) => !x.row).map((x) => x.kod);
    if (eksik.length) {
      const r2 = (await db.query(`SELECT ${satirSecimi} FROM rollout_progress rp WHERE UPPER(TRIM(rp.site_code)) = ANY($1::text[]) ORDER BY rp.updated_at DESC NULLS LAST`, [eksik])).rows;
      for (const r of r2) { const x = isler.get(kodT(r.site_code)); if (x) await satirIsle(x, r); }
    }
    for (const x of isler.values()) {
      const firmaAtamalari = x.atamalar.filter((a) => a.firmanin);
      const ekipli = firmaAtamalari.find((a) => K.ekipNolar.includes(Number(a.ekip_no)));
      x.ekip_no = ekipli ? Number(ekipli.ekip_no) : null;
      x.atama = firmaAtamalari[0] || x.atamalar[0] || null;
      const montajAtama = firmaAtamalari.find((a) => fiiliDurum.MONTAJ_KATEGORI.includes(a.kategori) && ACIK_ATAMA.includes(String(a.durum || "ATANDI").toUpperCase()));
      x.montajAtama = montajAtama || null;
      // Montaj bu firmada mı: RF kolu firmanın / RF boş + firmanın Günlük İş kalemi / firmaya açık montaj ataması
      x.montaj = x.rfBizim || (!x.rfBaska && x.kalem) || !!montajAtama;
      x.montajNeden = x.montaj ? null : x.rfBaska ? "Ana montaj başka firmada — bu işte yalnız kendi iş kolunuzu görürsünüz" : "Bu iş için montaj size atanmamış";
      // QC ve Rollout notu yalnız montaj (RF) bu firmadaysa ya da RF kolu kimseye yazılmamışsa
      x.qcGoster = x.rfBizim || (!x.rfBaska && x.montaj);
    }
    return isler;
  }

  // Liste / harita / detay kartı — aynı kural, aynı alanlar
  async function kartlar(K, liste, db = pool) {
    if (!liste.length) return [];
    const kodlar = liste.map((x) => x.kod);
    const rows = new Map(liste.filter((x) => x.row).map((x) => [x.kod, x.row]));
    const fiili = await fiiliDurum.durumHaritasi(db, kodlar, { rows });
    const olaylar = (await db.query(`SELECT id, site_code, olay, kanal, issue_turu, aciklama, zaman FROM is_fiili_bildirim WHERE site_code = ANY($1::text[]) ORDER BY zaman, id`, [kodlar])
      .catch(() => ({ rows: [] }))).rows;
    const son = new Map((await db.query(`SELECT DISTINCT ON (site_code) site_code, id, tur, created_at, inceleme_notu, pr_durum FROM taseron_saha_bildirim
      WHERE site_code = ANY($1::text[]) AND taseron_id = $2 AND tur IN ('TAMAMLANDI','KISMI') ORDER BY site_code, created_at DESC, id DESC`, [kodlar, K.firmaId])).rows.map((b) => [b.site_code, b]));
    const fid = (kod) => sahaKimlik.fizikselSaha(kod)?.fiziksel_id || kod;
    const ids = [...new Set(kodlar.map(fid))];
    const konumlar = new Map((await db.query(`SELECT * FROM saha_konum WHERE fiziksel_id = ANY($1)`, [ids]).catch(() => ({ rows: [] }))).rows.map((k) => [k.fiziksel_id, k]));
    const ekipAd = new Map(K.ekipler.map((e) => [Number(e.ekip_no), e.ad || `Ekip ${e.ekip_no}`]));
    const kanalBiz = `taseron:${K.firmaId}`;
    return liste.map((x) => {
      const f = fiili.get(x.kod) || null;
      const sb = son.get(x.kod) || null;
      const durum = montajDurumu(f, sb);
      const r = x.row || {};
      const sorunlar = [];
      const ev = acikIssue(olaylar.filter((o) => o.site_code === x.kod));
      if (ev) {
        const bizim = ev.kanal === kanalBiz;
        sorunlar.push({ kaynak: bizim ? "EKIP" : "KAYIT", etiket: bizim ? "Ekip bildirimi" : "Açık sorun kaydı", tur: ev.issue_turu || "Sorun", aciklama: bizim ? ev.aciklama : null, zaman: iso(ev.zaman) });
      } else if (f?.issue && x.montajAtama && String(x.montajAtama.durum).toUpperCase() === "ARA_VERILDI") {
        sorunlar.push({ kaynak: "ARA", etiket: "Ara verildi", tur: f.issue.tur, aciklama: null, zaman: f.issue.zaman });
      }
      const qc = x.qcGoster ? String(r.qc_durum || "").toUpperCase().trim() || null : null;
      if (qc === "NOK") sorunlar.push({ kaynak: "QC", etiket: "Doğrulanmış: QC NOK", tur: "QC NOK", aciklama: null, zaman: null });
      const kat = fid(x.kod);
      const konum = mobilKonum(konumlar.get(kat));
      const kollar = [...x.kollar].map((k) => KOL_AD[k] || k);
      return {
        kod: x.kod, fiziksel_id: kat, il: konumlar.get(kat)?.il || r.il || null, bolge: r.bolge || null, site_type: r.site_type || null,
        is_turu: x.atama?.kategori_ad || [r.site_type, kollar.join(", ")].filter(Boolean).join(" · ") || "Saha işi",
        kollar, ekip: x.ekip_no != null ? { no: x.ekip_no, ad: ekipAd.get(x.ekip_no) || `Ekip ${x.ekip_no}` } : null, bana: x.bana,
        montaj: { durum, ad: MONTAJ_AD[durum], baslama: f?.baslama || null, bitis: durum === "TAMAMLANDI" ? f?.bitis || null : null, kaynak: f?.kaynak || null, uyarilar: f?.uyarilar || [] },
        qc: x.qcGoster ? { durum: qc, ad: qc === "OK" ? "QC OK" : qc === "NOK" ? "QC NOK" : "QC bekleniyor", kapanis: gun(r.qc_closed_date) } : { durum: null, ad: "QC bilgisi bu firmada değil", gizli: true },
        sorun: { var: sorunlar.length > 0, kayitlar: sorunlar },
        konum, konum_yok: !konum,
        // Görünüm kapsamı (Bana atananlar / Ekibimin işleri / Firma işleri) ve sunucunun hesapladığı işlem yetkisi + engel nedeni
        kapsam: { bana: !!x.bana, ekibim: K.ekip_no != null && Number(x.ekip_no) === Number(K.ekip_no), firma: true },
        montaj_kaynagi: x.rfGrup ? "Rollout'ta grup adı (TEKNO) yazılı; Günlük İş montaj kalemi firmanızda" : null,
        islem: { montaj: x.montaj, neden: x.montajNeden, basla: x.montaj && durum === "BEKLIYOR", tamamla: x.montaj && ["DEVAM", "KISMI", "KONTROL"].includes(durum),
          engel: !x.montaj ? x.montajNeden : durum === "TAMAMLANDI" ? "Montaj tamamlanmış — yeni bildirim açılmaz" : durum === "BEKLIYOR" ? "Tamamlamak için önce montaja başlayın" : null },
        son_rapor: sb ? { id: Number(sb.id), tur: sb.tur, ad: TUR_AD[sb.tur], zaman: iso(sb.created_at), pr_durum: PR_AD[sb.pr_durum] || sb.pr_durum, teknocenter_notu: sb.inceleme_notu || null } : null,
      };
    });
  }
  const sayac = (k) => ({ toplam: k.length, montaj_bekleyen: k.filter((x) => x.montaj.durum === "BEKLIYOR").length,
    devam: k.filter((x) => ["DEVAM", "KISMI", "KONTROL"].includes(x.montaj.durum)).length, tamamlanan: k.filter((x) => x.montaj.durum === "TAMAMLANDI").length,
    qc_ok: k.filter((x) => x.qc.durum === "OK").length, sorun: k.filter((x) => x.sorun.var).length, konumsuz: k.filter((x) => !x.konum).length });
  const kimlikOzet = (K) => ({ firma: { id: K.firmaId, ad: K.firmaAd }, rol: K.rol, varsayilan: K.varsayilan,
    ekip: K.ekip_no != null ? { no: K.ekip_no, ad: K.ekipler.find((e) => Number(e.ekip_no) === Number(K.ekip_no))?.ad || `Ekip ${K.ekip_no}` } : null,
    ekipler: K.rol === "CALISAN" ? [] : K.ekipler.map((e) => ({ no: Number(e.ekip_no), ad: e.ad || `Ekip ${e.ekip_no}` })) });
  async function gorunurIs(K, kod, db = pool) {
    const isler = await isSeti(K, db);
    const x = isler.get(kodT(kod));
    if (!x || !gorunurMu(x, K)) throw H(404, "İş bulunamadı ya da size atanmamış");
    return x;
  }

  // ── SAHALARIM / HARİTA ─────────────────────────────────────────────────────────────────────────────────────────
  app.get("/taseron-saha/isler", ...kapi(async (req, res, K) => {
    const isler = [...(await isSeti(K)).values()].filter((x) => gorunurMu(x, K));
    let k = await kartlar(K, isler);
    const q = kodT(req.query.q || "").slice(0, 40);
    if (q) k = k.filter((x) => x.kod.includes(q) || String(x.fiziksel_id).includes(q));
    const SIRA = { KONTROL: 0, DEVAM: 1, KISMI: 1, BEKLIYOR: 2, TAMAMLANDI: 3 };
    k.sort((a, b) => Number(b.sorun.var) - Number(a.sorun.var) || SIRA[a.montaj.durum] - SIRA[b.montaj.durum] || a.kod.localeCompare(b.kod));
    res.set("Cache-Control", "private, no-store");
    res.json({ ok: true, ...kimlikOzet(K), isler: k, sayac: sayac(k), guncel: new Date().toISOString(),
      not: "Konumu kayıtlı olmayan iş yalnız listede görünür; haritada tahmini konum gösterilmez." });
  }));

  // ── YAPTIĞIMIZ SAHALAR (05.11.2026, Orhan) ───────────────────────────────────────────────────────────────────────
  // Firmanın bugüne kadar montaj yaptığı / katıldığı işler: kanıt (montaj tarihi, fiziki miktar, saha raporu) ve QC durumu.
  // Plan / atama tek başına listelenmez (yalnız sayısı verilir). Geçmiş kayıtlara hiçbir şey yazılmaz. Çalışan kendi ekibini görür;
  // bedel durumu (tutarsız) yalnız firma sorumlusuna. 1 Kasım öncesi işler de listelenir — tarife başlangıcı gizleme nedeni değildir.
  app.get("/taseron-saha/gecmis", ...kapi(async (req, res, K) => {
    const liste = [...(await isSeti(K)).values()].filter((x) => gorunurMu(x, K));
    const k = await kartlar(K, liste);
    const kodlar = k.map((x) => x.kod);
    const [mw, rap, hw] = kodlar.length ? await Promise.all([
      pool.query(`SELECT UPPER(TRIM(site_code)) AS kod, SUM(COALESCE(tamamlanan_qty,0))::numeric AS fiziki, SUM(COALESCE(done_qty,0))::numeric AS pr,
          COUNT(*)::int AS kalem, MIN(to_char(created_at,'YYYY-MM-DD')) AS giris FROM master_works
        WHERE UPPER(TRIM(site_code)) = ANY($1::text[]) AND ${KATLA_SQL("subcon_name")} = ANY($2::text[]) GROUP BY 1`, [kodlar, [...K.adKatli]]).catch(() => ({ rows: [] })),
      pool.query(`SELECT site_code AS kod, COUNT(*)::int AS n FROM taseron_saha_bildirim WHERE site_code = ANY($1::text[]) AND taseron_id = $2 AND tur IN ('TAMAMLANDI','KISMI') GROUP BY 1`, [kodlar, K.firmaId]).catch(() => ({ rows: [] })),
      pool.query(`SELECT UPPER(TRIM(site_code)) AS kod, array_agg(hw_status) FILTER (WHERE hw_status IS NOT NULL) AS hw FROM rollout_is_kolu
        WHERE UPPER(TRIM(site_code)) = ANY($1::text[]) AND is_kolu IN ('NS_AI','ONE_BAND') AND COALESCE(aktif, true) GROUP BY 1`, [kodlar]).catch(() => ({ rows: [] })),
    ]).then((x) => x.map((r) => new Map(r.rows.map((y) => [kodT(y.kod), y])))) : [new Map(), new Map(), new Map()];
    const ham = new Map(liste.map((x) => [x.kod, x]));
    const bedel = K.rol !== "CALISAN" && hakedisDurumu ? await hakedisDurumu(K, kodlar).catch(() => null) : null;
    const satirlar = [];
    let plan = 0;
    for (const x of k) {
      const r = ham.get(x.kod)?.row || {};
      const m = mw.get(x.kod);
      const qc = qcEtiket({ qc_durum: r.qc_durum, qc_kapanis: gun(r.qc_closed_date), hw: hw.get(x.kod)?.hw || [] });
      const g = gecmisSinif({ montaj: x.montaj.durum, fiziki: Number(m?.fiziki || 0), pr: Number(m?.pr || 0), rapor: !!rap.get(x.kod), qc: qc.kod, montajBizde: x.islem.montaj });
      if (g.sinif === "PLAN") { plan++; continue; }
      const b = bedel?.get(x.kod) || null;
      satirlar.push({ kod: x.kod, fiziksel_id: x.fiziksel_id, il: x.il, bolge: x.bolge, is_turu: x.is_turu, kollar: x.kollar,
        montaj: { durum: x.montaj.durum, ad: x.montaj.ad, baslama: gun(r.installation_actual_start_date) || x.montaj.baslama, bitis: gun(r.installation_actual_end_date) || x.montaj.bitis },
        qc, sinif: g.sinif, kanit: g.kanit, teyit: g.teyit, montaj_kaynagi: x.montaj_kaynagi,
        miktar: m ? { fiziki: Number(m.fiziki), pr: Number(m.pr), kalem: m.kalem } : null,
        bedel_durumu: b ? { kod: b.kod, ad: b.ad, tarife: b.tarife || null } : null });
    }
    const SIRA = { TEYIT: 0, DEVAM: 1, KISMI: 1, TAMAMLANDI: 2, KATILIM: 3 };
    satirlar.sort((a, b) => SIRA[a.sinif] - SIRA[b.sinif] || String(b.montaj.bitis || b.montaj.baslama || "").localeCompare(String(a.montaj.bitis || a.montaj.baslama || "")) || a.kod.localeCompare(b.kod));
    const saha = (f) => new Set(satirlar.filter(f).map((x) => x.fiziksel_id)).size;
    const montajli = (x) => x.sinif !== "KATILIM";
    res.set("Cache-Control", "private, no-store");
    res.json({ ok: true, ...kimlikOzet(K), guncel: new Date().toISOString(), satirlar,
      sayac: {
        montaj_tamamlanan_saha: saha((x) => x.sinif === "TAMAMLANDI"), montaj_tamamlanan_is: satirlar.filter((x) => x.sinif === "TAMAMLANDI").length,
        qc_baslayan_saha: saha((x) => montajli(x) && x.qc.kod === "BASLADI"), qc_kapanan_saha: saha((x) => montajli(x) && x.qc.kod === "KAPANDI"),
        devam_kismi_is: satirlar.filter((x) => ["DEVAM", "KISMI"].includes(x.sinif)).length, teyit_bekleyen_is: satirlar.filter((x) => x.sinif === "TEYIT").length,
        toplam_is: satirlar.length, toplam_saha: saha(() => true), katilim_is: satirlar.filter((x) => x.sinif === "KATILIM").length, kanitsiz_plan_is: plan,
      },
      not: "Fiziksel saha ile iş kaydı ayrı sayılır (aynı sahadaki NR700 ve NR3500 iki iştir). QC grupları montaj sayısıyla çakışabilir; kartlar toplanmaz. Yalnız plan / atama olan işler kanıt sayılmaz, listede gösterilmez.",
      qc_not: "QC başlangıcı yalnız Huawei Smart QC görev durumundan (To Be Executed / Executing) okunur; Rollout'taki QC NOK 'başladı' sayılmaz." });
  }));

  // ── İŞ DETAYI ──────────────────────────────────────────────────────────────────────────────────────────────────
  async function raporlar(K, kod, db = pool) {
    const kosul = K.rol === "CALISAN" ? `AND (b.user_id = $3 OR (b.ekip_no IS NOT DISTINCT FROM $4::int))` : "";
    const p = K.rol === "CALISAN" ? [kod, K.firmaId, K.userId, K.ekip_no] : [kod, K.firmaId];
    const r = (await db.query(`SELECT b.id, b.tur, b.standart, b.aciklama, b.kalan_is, b.sorun, b.fotolar, b.bildiren_ad, b.ekip_no, b.user_id, b.surum, b.pr_durum,
        b.inceleme_notu, b.inceleme_zamani, b.created_at, b.updated_at FROM taseron_saha_bildirim b WHERE b.site_code = $1 AND b.taseron_id = $2 ${kosul}
      ORDER BY b.created_at DESC, b.id DESC LIMIT 50`, p)).rows;
    const ekipAd = new Map(K.ekipler.map((e) => [Number(e.ekip_no), e.ad || `Ekip ${e.ekip_no}`]));
    return r.map((b) => ({ id: Number(b.id), tur: b.tur, tur_ad: TUR_AD[b.tur], standart: b.standart, aciklama: b.aciklama, kalan_is: b.kalan_is, sorun: b.sorun,
      fotolar: (b.fotolar || []).map((f) => ({ id: f.id, ad: f.ad || "Fotoğraf" })), bildiren: b.bildiren_ad, ekip: b.ekip_no != null ? ekipAd.get(Number(b.ekip_no)) || `Ekip ${b.ekip_no}` : null,
      benim: Number(b.user_id) === K.userId, surum: b.surum, pr_durum: b.pr_durum, pr_durum_ad: PR_AD[b.pr_durum] || b.pr_durum,
      duzeltilebilir: b.pr_durum === "BEKLIYOR" && b.tur !== "BASLADI" && (Number(b.user_id) === K.userId || K.rol !== "CALISAN"),
      teknocenter_notu: b.inceleme_notu || null, inceleme_zamani: iso(b.inceleme_zamani), zaman: iso(b.created_at), duzeltme: iso(b.updated_at) }));
  }
  async function detay(K, x, db = pool) {
    const [kart] = await kartlar(K, [x], db);
    const r = x.row || {};
    const notlar = x.qcGoster ? [r.rf_note, r.rf_not].map((s) => temiz(s, 1500)).filter(Boolean) : [];
    return { ...kart, rollout: { montaj_baslangic: gun(r.installation_actual_start_date), montaj_bitis: gun(r.installation_actual_end_date) },
      notlar, raporlar: await raporlar(K, x.kod, db),
      bilgi: "Montajı tamamlamak QC, Huawei kabulü, PR, hakediş ya da fatura anlamına gelmez." };
  }
  app.get("/taseron-saha/is/:kod", ...kapi(async (req, res, K) => {
    const x = await gorunurIs(K, req.params.kod);
    res.set("Cache-Control", "private, no-store");
    res.json({ ok: true, ...kimlikOzet(K), is: await detay(K, x) });
  }));

  // ── MONTAJA BAŞLA / MONTAJI TAMAMLA ────────────────────────────────────────────────────────────────────────────
  // Sıra: kapsam (firma + ekip + montaj bu firmada) → idempotent anahtar → iş kodu kilidi → güncel durum → yaz → sunucudaki son durum
  async function montajYaz(req, K, kod, tip, form) {
    const x0 = await gorunurIs(K, kod);
    if (!x0.montaj) throw H(403, x0.montajNeden || "Bu işte montaj işlemi yapamazsınız");
    const anahtar = temiz(req.body?.istek_anahtari, 100) || null;
    const konum = konumDogrula(req.body?.konum);
    return planSenkron.idempotent(pool, req, `taseron-saha-${tip}`, async () => {
      const c = await pool.connect();
      let sonuc, kayitId = null;
      try {
        await c.query("BEGIN");
        await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`taseron-saha:${x0.kod}`]);
        if (anahtar) {
          const ev = (await c.query(`SELECT id, tur FROM taseron_saha_bildirim WHERE user_id = $1 AND istek_anahtari = $2`, [K.userId, anahtar])).rows[0];
          if (ev) { await c.query("ROLLBACK"); return { ok: true, tekrar: true, bildirim_id: Number(ev.id), mesaj: "Bu bildirim daha önce alınmıştı; ikinci kez kaydedilmedi", is: await detay(K, await gorunurIs(K, x0.kod)) }; }
        }
        // Okumalar kilit alındıktan SONRA havuzdan: aynı iş kodunun yazarları da bu kilidi alıp commit ettikten sonra bırakır.
        // (İşlem içinde okunmaz: eksik yardımcı tablo okuması işlemi düşürmesin.)
        const x = await gorunurIs(K, x0.kod);
        const [kart] = await kartlar(K, [x]);
        const d = kart.montaj.durum;
        const ekipNo = K.ekip_no ?? x.ekip_no ?? null;
        const atamaId = x.montajAtama?.id || null;
        const kanal = `taseron:${K.firmaId}`;
        const olayYaz = (olay, ek = {}) => c.query(`INSERT INTO is_fiili_bildirim (is_atama_id, site_code, olay, issue_turu, aciklama, ekip_no, bildiren_email, bildiren_ad, kanal, istek_anahtari, zaman)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, clock_timestamp())`, [atamaId, x.kod, olay, ek.tur || null, ek.aciklama || null, ekipNo, K.email, K.ad, kanal, ek.anahtar || null]);
        const bildirimYaz = async (tur, f = {}) => (await c.query(`INSERT INTO taseron_saha_bildirim (site_code, fiziksel_id, taseron_id, ekip_no, user_id, bildiren_email, bildiren_ad, tur,
            standart, aciklama, kalan_is, sorun, konum, istek_anahtari) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          ON CONFLICT (user_id, istek_anahtari) WHERE istek_anahtari IS NOT NULL DO NOTHING RETURNING id`,
          [x.kod, kart.fiziksel_id, K.firmaId, ekipNo, K.userId, K.email, K.ad, tur, f.standart ?? null, f.aciklama || null, f.kalan_is || null, f.sorun || null,
            konum ? JSON.stringify(konum) : null, anahtar])).rows[0]?.id || null;
        if (tip === "basla") {
          if (d !== "BEKLIYOR") {
            await c.query("ROLLBACK");
            return { ok: true, zaten: true, mesaj: d === "TAMAMLANDI" ? "Bu işin montajı zaten tamamlanmış görünüyor" : "Montaj daha önce başlatılmış — yeni başlangıç kaydı açılmadı", is: await detay(K, x) };
          }
          kayitId = await bildirimYaz("BASLADI");
          await olayYaz("BASLADI", { anahtar });
          await isAtamaRolloutTarihYaz([x.kod], "installation_actual_start_date", c);
          if (atamaId) await c.query(`UPDATE is_atama SET durum = 'BASLADI', baslama_ts = COALESCE(baslama_ts, now()), updated_at = now() WHERE id = $1 AND durum = 'ATANDI'`, [atamaId]);
          sonuc = { mesaj: "Montaj başlangıcı kaydedildi" };
        } else {
          if (d === "TAMAMLANDI") { await c.query("ROLLBACK"); return { ok: true, zaten: true, mesaj: "Bu işin montajı zaten tamamlanmış görünüyor", is: await detay(K, x) }; }
          if (d === "BEKLIYOR") throw H(409, "Önce \"Montaja Başla\" ile başlangıcı kaydedin", { kod: "baslamadi" });
          if (form.tur === "TAM") {
            kayitId = await bildirimYaz("TAMAMLANDI", form);
            await olayYaz("TAMAMLANDI", { aciklama: form.aciklama, anahtar });
            if (form.sorun) await olayYaz("ISSUE", { tur: "Ekip bildirimi", aciklama: form.sorun, anahtar: anahtar ? `${anahtar}:sorun` : null }); // TAMAMLANDI'dan SONRA: açık kalır
            await isAtamaRolloutTarihYaz([x.kod], "installation_actual_start_date", c);
            await isAtamaRolloutTarihYaz([x.kod], "installation_actual_end_date", c);
            const a = x.montajAtama;
            if (a && (a.site_codes || []).length === 1)
              await c.query(`UPDATE is_atama SET durum = $2, baslama_ts = COALESCE(baslama_ts, now()), bitis_ts = COALESCE(bitis_ts, now()), updated_at = now() WHERE id = $1 AND durum IN ('ATANDI','BASLADI','DEVAM','ARA_VERILDI')`,
                [a.id, a.qc_yazar ? "QC_BEKLE" : "TAMAMLANDI"]);
            else if (a) await c.query(`UPDATE is_atama SET durum = 'DEVAM', updated_at = now() WHERE id = $1 AND durum IN ('ATANDI','BASLADI')`, [a.id]);
            sonuc = { mesaj: "Montaj tamamlandı olarak kaydedildi. QC ve kabul ayrıca yapılır." };
          } else {
            kayitId = await bildirimYaz("KISMI", form);
            if (form.sorun) await olayYaz("ISSUE", { tur: "Ekip bildirimi", aciklama: form.sorun, anahtar: anahtar ? `${anahtar}:sorun` : null });
            if (x.montajAtama) await c.query(`UPDATE is_atama SET durum = 'DEVAM', updated_at = now() WHERE id = $1 AND durum IN ('ATANDI','BASLADI')`, [x.montajAtama.id]);
            sonuc = { mesaj: "Kısmi iş kaydedildi — montaj devam ediyor olarak kalır" };
          }
        }
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally { c.release(); }
      await islemGecmisiYaz(req, "taseron_saha", kayitId, tip === "basla" ? "MONTAJ_BASLADI" : form.tur === "TAM" ? "MONTAJ_TAMAMLANDI" : "MONTAJ_KISMI", null,
        { site_code: x0.kod, taseron_id: K.firmaId, ekip_no: K.ekip_no ?? x0.ekip_no ?? null, ...(form ? { standart: form.standart, sorun: !!form.sorun } : {}) }, `${K.firmaAd} · ${x0.kod} · ${K.ad}`);
      return { ok: true, bildirim_id: kayitId ? Number(kayitId) : null, ...sonuc, is: await detay(K, await gorunurIs(K, x0.kod)) };
    });
  }
  app.post("/taseron-saha/is/:kod/basla", ...kapi(async (req, res, K) => {
    const kod = kodT(req.params.kod);
    // Yanlış sahaya dokunmayı önler: istemci onay ekranında gösterdiği iş kodunu geri gönderir
    if (kodT(req.body?.onay_kod) !== kod) throw H(400, "Saha ve iş kodu onayı eksik ya da uyuşmuyor");
    res.json(await montajYaz(req, K, kod, "basla", null));
  }));
  app.post("/taseron-saha/is/:kod/tamamla", ...kapi(async (req, res, K) => {
    const kod = kodT(req.params.kod);
    if (kodT(req.body?.onay_kod) !== kod) throw H(400, "Saha ve iş kodu onayı eksik ya da uyuşmuyor");
    const f = tamamlaDogrula(req.body);
    if (f.hata) throw H(400, f.hata);
    res.json(await montajYaz(req, K, kod, "tamamla", f));
  }));

  // ── RAPOR DÜZELTME (sürüm geçmişli; Teknocenter incelemeye alınca kilitli) ──────────────────────────────────────
  async function bildirimAl(K, id, db = pool, kilit = false) {
    const b = (await db.query(`SELECT * FROM taseron_saha_bildirim WHERE id = $1 AND taseron_id = $2 ${kilit ? "FOR UPDATE" : ""}`, [Number(id) || 0, K.firmaId])).rows[0];
    if (!b) throw H(404, "Rapor bulunamadı");
    const yetkili = Number(b.user_id) === K.userId || K.rol !== "CALISAN" || (K.ekip_no != null && Number(b.ekip_no) === Number(K.ekip_no));
    if (!yetkili) throw H(404, "Rapor bulunamadı");
    return b;
  }
  const surumOzet = (b) => ({ tur: b.tur, standart: b.standart, aciklama: b.aciklama, kalan_is: b.kalan_is, sorun: b.sorun, foto_sayisi: (b.fotolar || []).length,
    pr_durum: b.pr_durum, pr_ref: b.pr_ref, inceleme_notu: b.inceleme_notu, surum: b.surum });
  app.put("/taseron-saha/bildirim/:id", ...kapi(async (req, res, K) => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const b = await bildirimAl(K, req.params.id, c, true);
      if (Number(b.user_id) !== K.userId && K.rol === "CALISAN") throw H(403, "Yalnız kendi raporunuzu düzeltebilirsiniz");
      if (b.tur === "BASLADI") throw H(400, "Başlangıç kaydı düzeltilemez; saat düzeltmesi için Teknocenter ile görüşün");
      if (b.pr_durum !== "BEKLIYOR") throw H(409, "Teknocenter raporu incelemeye aldı. Düzeltme için Teknocenter ile görüşün.", { kod: "kilitli" });
      if (req.body?.surum != null && Number(req.body.surum) !== Number(b.surum)) throw H(409, "Rapor bu arada değişti. Ekranı yenileyip tekrar deneyin.", { kod: "surum_catisma", surum: b.surum });
      const f = tamamlaDogrula({ tur: b.tur === "TAMAMLANDI" ? "TAM" : "KISMI", standart: b.standart === true && req.body?.standart !== false,
        aciklama: req.body?.aciklama ?? b.aciklama, kalan_is: req.body?.kalan_is ?? b.kalan_is, sorun: req.body?.sorun ?? b.sorun });
      if (f.hata) throw H(400, f.hata);
      await c.query(`INSERT INTO taseron_saha_bildirim_surum (bildirim_id, surum, eski, degistiren) VALUES ($1,$2,$3,$4)`, [b.id, b.surum, JSON.stringify(surumOzet(b)), K.email]);
      await c.query(`UPDATE taseron_saha_bildirim SET standart = $2, aciklama = $3, kalan_is = $4, sorun = $5, surum = surum + 1, updated_at = now() WHERE id = $1`,
        [b.id, f.standart, f.aciklama, f.kalan_is, f.sorun]);
      await c.query("COMMIT");
      await islemGecmisiYaz(req, "taseron_saha", b.id, "RAPOR_DUZELTME", surumOzet(b), { aciklama: f.aciklama, kalan_is: f.kalan_is, sorun: f.sorun, standart: f.standart }, `${b.site_code} raporu düzeltildi`);
      const x = await gorunurIs(K, b.site_code).catch(() => null);
      res.json({ ok: true, mesaj: "Rapor düzeltildi (önceki sürüm saklandı)", is: x ? await detay(K, x) : null,
        not: "Rapordaki sorun metnini değiştirmek açık sorun kaydını kapatmaz; sorun kaydını Teknocenter kapatır." });
    } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
  }));

  // ── FOTOĞRAF (özel depo; adres istemciye verilmez, indirme yetki kontrollü) ─────────────────────────────────────
  app.post("/taseron-saha/bildirim/:id/foto", authMiddleware, (req, res, next) => fotoYukle.single("dosya")(req, res, (e) => {
    if (e) return res.status(400).json({ ok: false, error: e.code === "LIMIT_FILE_SIZE" ? "Fotoğraf 10 MB'tan büyük" : "Fotoğraf alınamadı" });
    next();
  }), async (req, res) => {
    try {
      const K = await kimlik(req);
      const b = await bildirimAl(K, req.params.id);
      if (b.tur === "BASLADI") throw H(400, "Fotoğraf tamamlama / kısmi iş raporuna eklenir");
      const anahtar = temiz(req.body?.istek_anahtari, 100) || null;
      const ev = anahtar && (b.fotolar || []).find((f) => f.anahtar === anahtar);
      if (ev) return res.json({ ok: true, tekrar: true, foto: { id: ev.id, ad: ev.ad }, foto_sayisi: (b.fotolar || []).length });
      if (!req.file) throw H(400, "Fotoğraf seçilmedi ya da biçimi desteklenmiyor (JPEG / PNG / HEIC)");
      if ((b.fotolar || []).length >= FOTO_MAX) throw H(400, `Bir rapora en çok ${FOTO_MAX} fotoğraf eklenir`);
      const uzanti = (req.file.mimetype.split("/")[1] || "jpg").replace("jpeg", "jpg");
      const d = await ozelYukle("taseron-saha", req.file.buffer, req.file.mimetype, uzanti);
      const foto = { id: crypto.randomBytes(8).toString("hex"), depo: d.depo, yol: d.yol, tip: req.file.mimetype, boyut: req.file.size, ad: temiz(req.body?.ad, 80) || `Fotoğraf ${(b.fotolar || []).length + 1}`,
        yukleyen: K.email, zaman: new Date().toISOString(), anahtar };
      const u = (await pool.query(`UPDATE taseron_saha_bildirim SET fotolar = fotolar || $2::jsonb, updated_at = now() WHERE id = $1 AND jsonb_array_length(fotolar) < $3 RETURNING jsonb_array_length(fotolar) AS n`,
        [b.id, JSON.stringify([foto]), FOTO_MAX])).rows[0];
      if (!u) { await ozelSil?.(d.depo, d.yol).catch(() => {}); throw H(400, `Bir rapora en çok ${FOTO_MAX} fotoğraf eklenir`); }
      await islemGecmisiYaz(req, "taseron_saha", b.id, "FOTO_EKLENDI", null, { foto: foto.id, ad: foto.ad }, `${b.site_code} raporuna fotoğraf`);
      res.json({ ok: true, foto: { id: foto.id, ad: foto.ad }, foto_sayisi: Number(u.n) });
    } catch (e) { hata(res, e); }
  });
  async function fotoGonder(res, b, fid) {
    const f = (b.fotolar || []).find((x) => x.id === String(fid));
    if (!f) throw H(404, "Fotoğraf bulunamadı");
    const buf = await ozelIndir(f.depo, f.yol);
    res.set("Cache-Control", "private, no-store");
    res.type(f.tip || "image/jpeg").send(Buffer.isBuffer(buf) ? buf : Buffer.from(await buf.arrayBuffer()));
  }
  app.get("/taseron-saha/bildirim/:id/foto/:fid", authMiddleware, async (req, res) => {
    try {
      if (taseronMu(req.user) || req.user?.kullanici_tipi === "TASERON") {
        const K = await kimlik(req);
        return await fotoGonder(res, await bildirimAl(K, req.params.id), req.params.fid);
      }
      await teknoKapisi(req);
      const b = await teknoBildirim(req, req.params.id);
      await fotoGonder(res, b, req.params.fid);
    } catch (e) { hata(res, e); }
  });

  // ── TEKNOCENTER TARAFI: raporlar iş koduna göre, PR hazırlığı (otomatik PR kalemi YOK) ────────────────────────────
  async function teknoKapisi(req) {
    if (taseronMu(req.user) || req.user?.kullanici_tipi === "TASERON") throw H(403, "Yetkiniz yok");
    if (!(isAtamaYetkiliMi(req) || req.izinler?.rollout_goruntule === true)) throw H(403, "Taşeron saha raporlarını görme yetkiniz yok");
  }
  // Alt marka (Teknocenter) hesabı: yalnız kendi Rollout kapsamındaki iş kodlarının raporları
  async function teknoKodlari(req) {
    if (!altMarkaKullanicisi(req.user)) return null;
    return (await kapsamIsKodlari(req)).kodlar;
  }
  async function teknoBildirim(req, id, db = pool, kilit = false) {
    const b = (await db.query(`SELECT * FROM taseron_saha_bildirim WHERE id = $1 ${kilit ? "FOR UPDATE" : ""}`, [Number(id) || 0])).rows[0];
    const kodlar = b ? await teknoKodlari(req) : null;
    if (!b || (kodlar && !kodlar.has(kodT(b.site_code)))) throw H(404, "Rapor bulunamadı");
    return b;
  }
  const teknoSatir = (b, ek = {}) => ({ id: Number(b.id), site_code: b.site_code, fiziksel_id: b.fiziksel_id, firma: { id: b.taseron_id, ad: b.firma_ad || null },
    ekip: b.ekip_no != null ? { no: b.ekip_no, ad: b.ekip_ad || `Ekip ${b.ekip_no}` } : null, bildiren: b.bildiren_ad, bildiren_email: b.bildiren_email,
    tur: b.tur, tur_ad: TUR_AD[b.tur], standart: b.standart, aciklama: b.aciklama, kalan_is: b.kalan_is, sorun: b.sorun,
    fotolar: (b.fotolar || []).map((f) => ({ id: f.id, ad: f.ad, zaman: f.zaman })), konum_var: !!b.konum, zaman: iso(b.created_at), duzeltme: iso(b.updated_at), surum: b.surum,
    pr_durum: b.pr_durum, pr_durum_ad: PR_AD[b.pr_durum], pr_ref: b.pr_ref, inceleyen: b.inceleyen, inceleme_notu: b.inceleme_notu, inceleme_zamani: iso(b.inceleme_zamani), ...ek });
  app.get("/taseron-saha/teknocenter/bildirimler", authMiddleware, async (req, res) => {
    try {
      await teknoKapisi(req);
      const kod = kodT(req.query.kod || "");
      const p = [], w = [];
      if (kod) { p.push(`%${kod}%`); w.push(`b.site_code LIKE $${p.length}`); }
      if (req.query.taseron_id) { p.push(Number(req.query.taseron_id)); w.push(`b.taseron_id = $${p.length}`); }
      if (req.query.pr_durum && PR_AD[req.query.pr_durum]) { p.push(req.query.pr_durum); w.push(`b.pr_durum = $${p.length}`); }
      if (!kod) { p.push(Math.min(Math.max(Number(req.query.gun) || 30, 1), 365)); w.push(`b.created_at > now() - make_interval(days => $${p.length}::int)`); }
      if (req.query.yalniz_rapor !== "0") w.push(`b.tur IN ('TAMAMLANDI','KISMI')`);
      const r = (await pool.query(`SELECT b.*, COALESCE(s.unvan, s.subcon_name) AS firma_ad, e.ad AS ekip_ad,
          (SELECT x.pr_ref FROM taseron_saha_bildirim x WHERE x.site_code = b.site_code AND x.id <> b.id AND x.pr_durum = 'PR_HAZIRLANDI' ORDER BY x.inceleme_zamani DESC LIMIT 1) AS ayni_saha_pr
        FROM taseron_saha_bildirim b LEFT JOIN subcons s ON s.id = b.taseron_id LEFT JOIN ekipler e ON e.ekip_no = b.ekip_no
        ${w.length ? `WHERE ${w.join(" AND ")}` : ""} ORDER BY b.created_at DESC, b.id DESC LIMIT 300`, p)).rows;
      const kodlar = await teknoKodlari(req);
      const rows = r.filter((b) => !kodlar || kodlar.has(kodT(b.site_code))).map((b) => teknoSatir(b, { ayni_saha_pr: b.ayni_saha_pr || null }));
      res.set("Cache-Control", "private, no-store");
      res.json({ ok: true, rows, bilgi: "Taşeron raporu PR değildir; PR kalemleri Günlük İş / PR akışında yetkili tarafından hazırlanır." });
    } catch (e) { hata(res, e); }
  });
  app.get("/taseron-saha/teknocenter/bildirim/:id/gecmis", authMiddleware, async (req, res) => {
    try {
      await teknoKapisi(req);
      const b = await teknoBildirim(req, req.params.id);
      const s = (await pool.query(`SELECT surum, eski, degistiren, created_at FROM taseron_saha_bildirim_surum WHERE bildirim_id = $1 ORDER BY surum`, [b.id])).rows;
      res.json({ ok: true, guncel: surumOzet(b), surumler: s.map((x) => ({ surum: x.surum, eski: x.eski, degistiren: x.degistiren, zaman: iso(x.created_at) })) });
    } catch (e) { hata(res, e); }
  });
  app.post("/taseron-saha/teknocenter/bildirim/:id/inceleme", authMiddleware, async (req, res) => {
    try {
      await teknoKapisi(req);
      const yeni = String(req.body?.pr_durum || "").toUpperCase();
      if (!["INCELENDI", "PR_HAZIRLANIYOR", "PR_HAZIRLANDI"].includes(yeni)) throw H(400, "Geçersiz inceleme durumu");
      const ref = temiz(req.body?.pr_ref, 80) || null, not = temiz(req.body?.not, 1000) || null;
      if (yeni === "PR_HAZIRLANDI" && !ref) throw H(400, "PR hazırlandı için PR / talep numarasını yazın");
      const sonuc = await planSenkron.idempotent(pool, req, "taseron-saha-inceleme", async () => {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const b = await teknoBildirim(req, req.params.id, c, true);
          if (b.tur === "BASLADI") throw H(400, "Başlangıç kaydı PR'a kaynak olmaz");
          if (b.pr_durum === "PR_HAZIRLANDI") {
            if (yeni === "PR_HAZIRLANDI" && ref === b.pr_ref) { await c.query("ROLLBACK"); return { ok: true, zaten: true, mesaj: "Bu rapor zaten bu PR ile işaretli" }; }
            throw H(409, `Bu rapordan PR zaten hazırlandı (${b.pr_ref}). İkinci PR açılmaz.`, { kod: "pr_var", pr_ref: b.pr_ref });
          }
          if (yeni === "PR_HAZIRLANDI" && req.body?.ayni_saha_onay !== true) {
            const d = (await c.query(`SELECT id, pr_ref FROM taseron_saha_bildirim WHERE site_code = $1 AND id <> $2 AND pr_durum = 'PR_HAZIRLANDI' LIMIT 1`, [b.site_code, b.id])).rows[0];
            if (d) throw H(409, `Aynı iş kodunun başka bir raporundan PR hazırlanmış (${d.pr_ref}). Mükerrer olmadığını doğrulayıp onaylayın.`, { kod: "ayni_saha_pr", pr_ref: d.pr_ref, bildirim_id: Number(d.id) });
          }
          await c.query(`INSERT INTO taseron_saha_bildirim_surum (bildirim_id, surum, eski, degistiren) VALUES ($1,$2,$3,$4)`, [b.id, b.surum, JSON.stringify(surumOzet(b)), ben(req)]);
          await c.query(`UPDATE taseron_saha_bildirim SET pr_durum = $2, pr_ref = COALESCE($3, pr_ref), inceleme_notu = COALESCE($4, inceleme_notu), inceleyen = $5, inceleme_zamani = now(),
            surum = surum + 1, updated_at = now() WHERE id = $1`, [b.id, yeni, ref, not, req.user?.name || ben(req)]);
          await c.query("COMMIT");
          await islemGecmisiYaz(req, "taseron_saha", b.id, "TEKNO_INCELEME", { pr_durum: b.pr_durum, pr_ref: b.pr_ref }, { pr_durum: yeni, pr_ref: ref, not }, `${b.site_code} raporu: ${PR_AD[yeni]}`);
          return { ok: true, mesaj: PR_AD[yeni] };
        } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
      });
      res.json(sonuc);
    } catch (e) { hata(res, e); }
  });

  // ── ÜYELİK YÖNETİMİ (Teknocenter / yönetici): taşeron hesabına rol + ekip ────────────────────────────────────────
  async function yonetimKapisi(req, taseronId) {
    if (taseronMu(req.user) || req.user?.kullanici_tipi === "TASERON" || !isAtamaYetkiliMi(req)) throw H(403, "Yetkiniz yok");
    const t = (await pool.query(`SELECT id, subcon_name, unvan, ana_firma FROM subcons WHERE id = $1`, [Number(taseronId) || 0])).rows[0];
    if (!t || !(await firmaYonetebilir(req, t))) throw H(404, "Taşeron firma bulunamadı");
    return t;
  }
  app.get("/taseron-saha/yonetim/firma/:id", authMiddleware, async (req, res) => {
    try {
      const t = await yonetimKapisi(req, req.params.id);
      const ekipler = (await pool.query(`SELECT ekip_no, ad, plaka, COALESCE(aktif, true) AS aktif FROM ekipler WHERE (to_jsonb(ekipler)->>'firma_id')::int = $1 ORDER BY ekip_no`, [t.id])).rows;
      const hesaplar = (await pool.query(`SELECT u.id, u.name, LOWER(u.email) AS email, COALESCE(u.is_active, true) AS aktif_hesap, m.rol, m.ekip_no, m.aktif, m.updated_at
        FROM users u LEFT JOIN taseron_saha_uye m ON m.user_id = u.id
        WHERE to_jsonb(u)->>'kullanici_tipi' = 'TASERON' AND (to_jsonb(u)->>'taseron_id')::int = $1 ORDER BY u.name`, [t.id])).rows;
      res.json({ ok: true, firma: { id: t.id, ad: t.unvan || t.subcon_name, kod: t.subcon_name, ana_firma: t.ana_firma || null }, ekipler,
        hesap_acabilir: !!(await hesapAcabilir(req)),
        hesaplar: hesaplar.map((h) => ({ ...h, rol: h.rol || "SORUMLU", varsayilan: !h.rol })),
        bilgi: "Üyelik satırı olmayan taşeron hesabı firma geneli (SORUMLU) görür. Çalışan hesabına ekip seçin." });
    } catch (e) { hata(res, e); }
  });
  app.put("/taseron-saha/yonetim/uye/:userId", authMiddleware, async (req, res) => {
    try {
      const uid = Number(req.params.userId) || 0;
      const u = (await pool.query(`SELECT id, name, to_jsonb(users)->>'kullanici_tipi' AS tip, (to_jsonb(users)->>'taseron_id')::int AS taseron_id FROM users WHERE id = $1`, [uid])).rows[0];
      if (!u || u.tip !== "TASERON" || !u.taseron_id) throw H(404, "Taşeron hesabı bulunamadı");
      const t = await yonetimKapisi(req, u.taseron_id);
      const rol = String(req.body?.rol || "").toUpperCase();
      if (!["SORUMLU", "CALISAN"].includes(rol)) throw H(400, "Rol SORUMLU ya da CALISAN olmalı");
      const ekipNo = req.body?.ekip_no == null || req.body.ekip_no === "" ? null : Number(req.body.ekip_no);
      if (ekipNo != null) {
        const e = (await pool.query(`SELECT 1 FROM ekipler WHERE ekip_no = $1 AND (to_jsonb(ekipler)->>'firma_id')::int = $2`, [ekipNo, t.id])).rows[0];
        if (!e) throw H(400, "Seçilen ekip bu firmaya bağlı değil");
      }
      const aktif = req.body?.aktif !== false;
      const eski = (await pool.query(`SELECT rol, ekip_no, aktif FROM taseron_saha_uye WHERE user_id = $1`, [uid])).rows[0] || null;
      await pool.query(`INSERT INTO taseron_saha_uye (user_id, taseron_id, ekip_no, rol, aktif, ekleyen) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (user_id) DO UPDATE SET taseron_id = EXCLUDED.taseron_id, ekip_no = EXCLUDED.ekip_no, rol = EXCLUDED.rol, aktif = EXCLUDED.aktif, updated_at = now()`,
        [uid, t.id, ekipNo, rol, aktif, ben(req)]);
      _uyeOnbellek.delete(uid);
      await islemGecmisiYaz(req, "taseron_saha_uye", uid, "UYELIK", eski, { rol, ekip_no: ekipNo, aktif, taseron_id: t.id }, `${u.name}: ${rol}${ekipNo != null ? ` · ekip ${ekipNo}` : ""}`);
      res.json({ ok: true, mesaj: "Saha rolü kaydedildi" });
    } catch (e) { hata(res, e); }
  });

  // ── FİRMA LİSTESİ + HESAP AÇMA / ŞİFRE (04.11.2026) ────────────────────────────────────────────────────────────
  // Firma listesi: yöneticinin kapsamındaki taşeron firmalar — ana firması olan, ekibi ya da taşeron hesabı bulunan (q ile hepsinde arama)
  app.get("/taseron-saha/yonetim/firmalar", authMiddleware, async (req, res) => {
    try {
      if (taseronMu(req.user) || req.user?.kullanici_tipi === "TASERON" || !isAtamaYetkiliMi(req)) throw H(403, "Yetkiniz yok");
      const q = temiz(req.query.q, 60).toLocaleUpperCase("tr-TR");
      const r = (await pool.query(`SELECT s.id, s.subcon_name, s.unvan, s.ana_firma,
          (SELECT COUNT(*)::int FROM ekipler e WHERE (to_jsonb(e)->>'firma_id')::int = s.id) AS ekip_sayisi,
          (SELECT COUNT(*)::int FROM users u WHERE to_jsonb(u)->>'kullanici_tipi' = 'TASERON' AND (to_jsonb(u)->>'taseron_id')::int = s.id) AS hesap_sayisi
        FROM subcons s WHERE COALESCE(s.aktif, true)
          AND (${q ? `UPPER(s.subcon_name) LIKE $1 OR UPPER(COALESCE(s.unvan,'')) LIKE $1` : `s.ana_firma IS NOT NULL
            OR EXISTS (SELECT 1 FROM ekipler e WHERE (to_jsonb(e)->>'firma_id')::int = s.id)
            OR EXISTS (SELECT 1 FROM users u WHERE to_jsonb(u)->>'kullanici_tipi' = 'TASERON' AND (to_jsonb(u)->>'taseron_id')::int = s.id)`})
        ORDER BY s.subcon_name LIMIT 200`, q ? [`%${q}%`] : [])).rows;
      const out = [];
      for (const t of r) if (await firmaYonetebilir(req, t)) out.push({ id: t.id, ad: t.unvan || t.subcon_name, kod: t.subcon_name, ana_firma: t.ana_firma, ekip_sayisi: t.ekip_sayisi, hesap_sayisi: t.hesap_sayisi });
      res.json({ ok: true, firmalar: out, hesap_acabilir: !!(await hesapAcabilir(req)) });
    } catch (e) { hata(res, e); }
  });
  const sifreHatasi = (s) => (String(s || "").length < 8 ? "Şifre en az 8 karakter olmalı" : !/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(s) || !/\d/.test(s) ? "Şifrede en az bir harf ve bir rakam olmalı" : null);
  // Hesap açma: taşeron kullanıcısı (kullanici_tipi TASERON + taseron_id) + saha rolü / ekibi tek işlemde. Şifreyi açan kişi
  // girer ve taşerona kendisi iletir (sunucu düz metin saklamaz, yanıtta döndürmez). Var olan kullanıcı adı → 409 (hesap ele geçirme yok).
  app.post("/taseron-saha/yonetim/hesap", authMiddleware, async (req, res) => {
    try {
      const t = await yonetimKapisi(req, req.body?.taseron_id);
      if (!(await hesapAcabilir(req))) throw H(403, "Hesap açma yetkiniz yok (kullanıcı yöneticisi ya da Teknocenter yöneticisi)");
      const ad = temiz(req.body?.ad, 120), kadi = temiz(req.body?.kullanici_adi, 120).toLowerCase(), sifre = String(req.body?.sifre || "");
      if (ad.length < 3) throw H(400, "Ad soyad zorunlu", { alan: "ad" });
      if (!/^[a-z0-9._@+-]{3,}$/.test(kadi)) throw H(400, "Kullanıcı adı en az 3 karakter; harf, rakam, nokta, @ ve - kullanılabilir", { alan: "kullanici_adi" });
      const sh = sifreHatasi(sifre); if (sh) throw H(400, sh, { alan: "sifre" });
      const rol = String(req.body?.rol || "CALISAN").toUpperCase();
      if (!["SORUMLU", "CALISAN"].includes(rol)) throw H(400, "Rol SORUMLU ya da CALISAN olmalı", { alan: "rol" });
      const ekipNo = req.body?.ekip_no == null || req.body.ekip_no === "" ? null : Number(req.body.ekip_no);
      if (ekipNo != null && !(await pool.query(`SELECT 1 FROM ekipler WHERE ekip_no = $1 AND (to_jsonb(ekipler)->>'firma_id')::int = $2`, [ekipNo, t.id])).rowCount)
        throw H(400, "Seçilen ekip bu firmaya bağlı değil", { alan: "ekip_no" });
      if ((await pool.query(`SELECT 1 FROM users WHERE LOWER(TRIM(email)) = $1`, [kadi])).rowCount) throw H(409, "Bu kullanıcı adı kullanılıyor; başka bir ad seçin", { alan: "kullanici_adi" });
      // Ana firma: taşeron kaydındaki ana firma; yoksa yöneticinin firması (alt marka) ya da formdaki seçim
      const ben_ = (await pool.query(`SELECT marka, tenant FROM users WHERE id = $1`, [Number(req.user.user_id) || 0])).rows[0] || {};
      let marka = String(t.ana_firma || "").toUpperCase() || (altMarkaKullanicisi(req.user) ? String(ben_.marka || "").toUpperCase() : String(req.body?.marka || "").toUpperCase()) || "ERC";
      if (!(await pool.query(`SELECT 1 FROM markalar WHERE kod = $1 AND COALESCE(aktif, true)`, [marka]).catch(() => ({ rowCount: 0 }))).rowCount && marka !== "ERC") throw H(400, "Geçersiz ana firma", { alan: "marka" });
      const hash = await bcrypt.hash(sifre, 10);
      const c = await pool.connect();
      let yeni;
      try {
        await c.query("BEGIN");
        yeni = (await c.query(`INSERT INTO users (name, email, password_hash, role, is_active, status, tenant, marka, subcon_name, kullanici_tipi, taseron_id)
          VALUES ($1,$2,$3,'subcon',true,'active',$4,$5,$6,'TASERON',$7) RETURNING id, name, email`, [ad, kadi, hash, ben_.tenant || "erc", marka, t.subcon_name, t.id])).rows[0];
        await c.query(`INSERT INTO taseron_saha_uye (user_id, taseron_id, ekip_no, rol, aktif, ekleyen) VALUES ($1,$2,$3,$4,true,$5)`, [yeni.id, t.id, ekipNo, rol, ben(req)]);
        await c.query("COMMIT");
      } catch (e) { await c.query("ROLLBACK").catch(() => {}); if (e.code === "23505") throw H(409, "Bu kullanıcı adı kullanılıyor", { alan: "kullanici_adi" }); throw e; } finally { c.release(); }
      await islemGecmisiYaz(req, "taseron_saha_uye", yeni.id, "HESAP_ACILDI", null, { taseron_id: t.id, rol, ekip_no: ekipNo, marka }, `${t.subcon_name}: ${ad} (${kadi}) hesabı açıldı`);
      // Alan adı "kullanici": "hesap" anahtarı gizlilik katmanında (banka hesabı) /taseron-saha yanıtlarından silinir
      res.json({ ok: true, mesaj: "Hesap açıldı. Kullanıcı adı ve şifreyi taşerona siz iletin.", kullanici: { id: yeni.id, ad: yeni.name, kullanici_adi: yeni.email, rol, ekip_no: ekipNo } });
    } catch (e) { hata(res, e); }
  });
  // Şifre sıfırlama (unutulan şifre) ve hesabı tamamen kapatma / açma — yalnız bu firmanın taşeron hesapları
  app.put("/taseron-saha/yonetim/hesap/:userId", authMiddleware, async (req, res) => {
    try {
      const uid = Number(req.params.userId) || 0;
      const u = (await pool.query(`SELECT id, name, to_jsonb(users)->>'kullanici_tipi' AS tip, (to_jsonb(users)->>'taseron_id')::int AS taseron_id FROM users WHERE id = $1`, [uid])).rows[0];
      if (!u || u.tip !== "TASERON" || !u.taseron_id) throw H(404, "Taşeron hesabı bulunamadı");
      const t = await yonetimKapisi(req, u.taseron_id);
      if (!(await hesapAcabilir(req))) throw H(403, "Hesap yönetme yetkiniz yok");
      const deg = {};
      if (req.body?.sifre !== undefined) {
        const sh = sifreHatasi(req.body.sifre); if (sh) throw H(400, sh, { alan: "sifre" });
        await pool.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [uid, await bcrypt.hash(String(req.body.sifre), 10)]); deg.sifre = "sıfırlandı";
      }
      if (typeof req.body?.hesap_aktif === "boolean") { await pool.query(`UPDATE users SET is_active = $2 WHERE id = $1`, [uid, req.body.hesap_aktif]); deg.hesap_aktif = req.body.hesap_aktif; }
      if (!Object.keys(deg).length) throw H(400, "Değişiklik yok");
      _uyeOnbellek.delete(uid);
      await islemGecmisiYaz(req, "taseron_saha_uye", uid, "HESAP_GUNCELLENDI", null, deg, `${t.subcon_name}: ${u.name} — ${Object.keys(deg).join(", ")}`);
      res.json({ ok: true, mesaj: deg.sifre ? "Şifre sıfırlandı. Yeni şifreyi taşerona siz iletin." : deg.hesap_aktif ? "Hesap açıldı" : "Hesap kapatıldı (giriş yapamaz)" });
    } catch (e) { hata(res, e); }
  });

  return { kimlik, isSeti, kartlar };
}

module.exports = { semaKur, kur, sahaRolu, calisanKapisi, uyeOku, firmaKollari, gorunurMu, montajDurumu, acikIssue, tamamlaDogrula, konumDogrula, qcEtiket, gecmisSinif, KATLA_SQL, MONTAJ_AD, PR_AD, QC_AD };
