// ═══ HW MALZEME DURUMU (31.10.2026, Orhan — Huawei saha malzemesi kabulü, depo / ekip takibi) ═════════════════════
// Huawei'nin bir iş için gönderdiği saha malzemesi (RRU, anten, kabinet, kablo …) İŞ KODU (tam iş kodu, KA3737_NR700_MWA)
// bazında izlenir; fiziksel saha (KA3737) yalnız gruplama içindir — aynı Site ID altındaki iki işin malzemesi birbirine geçmez.
// Sarf stok defteri (malzemeStok.js, personel zimmeti) AYRI bir defterdir; bu modül ona yazmaz.
//
// Tek kayıt kaynağı: hw_malzeme_islem (başlık) + hw_malzeme_islem_kalem (kalem × miktar). Kayıtlar SİLİNMEZ; düzeltme
// ters kayıt + yeni kayıtla yapılır, başlık alanı düzeltmesi hw_malzeme_gecmis'e (eski/yeni, kim, ne zaman) yazılır.
//   KABUL         HUAWEI → DEPO        malzeme depoya geldi (kısmi / tam; geliş tarihi; belge / fotoğraf)
//   EKIBE_TESLIM  DEPO   → EKIP        fiziksel teslim (Emre kaydeder) — PLAN ATAMASI TESLİM DEĞİLDİR, stoğu düşürmez
//   DEVIR         EKIP   → EKIP        ekipler arası aktarım: her zaman ayrı kayıt (yeni plan malzemeyi sessizce taşımaz)
//   DEPOYA_DONUS  EKIP   → DEPO        ekipten depoya geri alma
//   KULLANIM      EKIP|DEPO → SAHA     sahada kullanıldı (montaja girdi)
//   IADE          EKIP|DEPO → HUAWEI   Huawei'ye iade
//   TERS          bir işlemin tersine kaydı (gerekçeli); orijinal silinmez
// Bakiye her zaman hareketlerden hesaplanır (ayrı bakiye tablosu yok → uzlaştırma farkı oluşmaz). Eş zamanlı işlemler iş kodu
// başına pg_advisory_xact_lock ile sıraya girer; kaynak lokasyonda yeterli miktar yoksa işlem reddedilir (çift düşüm olmaz).
// Her yazma isteği istek_anahtari ister: aynı anahtar ikinci kez işlenmez (çift tıklama, bağlantı kopması, mobil yeniden
// gönderim). Gerçek ikinci teslimat yeni anahtarla gelir ve ayrı hareket olur; 15 dk içinde aynı içerikli kabul "olası
// mükerrer" uyarısı verir ve açık onay ister.
//
// Rollout Data yansıması: KABUL kayıtları rollout_progress.malzeme_gelis_tarihi (ENH: enh_malzeme_gelis_tarihi) ve
// malzeme_status alanlarına yazılır. Montaj tarihleri, QC, PR / PO ve miktarlar DEĞİŞMEZ. Montajı başlamış / bitmiş işte
// malzeme_status geri çekilmez. Rollout'taki eski değer hw_malzeme_rollout_yansima'da saklanır (geri alınabilir); başkası
// sonradan elle değiştirdiyse üzerine yazılmaz, "çelişki" olarak teyit listesine düşer.
// Eski kayıt: Rollout'ta yalnız geliş tarihi olan iş TAM TESLİM ya da DEPODA SAYILMAZ — "Eski kayıt · teyit bekliyor".
"use strict";
const crypto = require("crypto");

const ISLEM_TURLERI = ["KABUL", "EKIBE_TESLIM", "DEVIR", "DEPOYA_DONUS", "KULLANIM", "IADE", "TERS"];
const TUR_TR = { KABUL: "Malzeme kabulü (depoya giriş)", EKIBE_TESLIM: "Ekibe teslim", DEVIR: "Ekipler arası devir", DEPOYA_DONUS: "Ekipten depoya dönüş",
  KULLANIM: "Sahada kullanıldı", IADE: "Huawei'ye iade", TERS: "Ters kayıt (düzeltme / iptal)" };
const LOK_TR = { HUAWEI: "Huawei", DEPO: "Depo", EKIP: "Ekip", SAHA: "Sahada kullanıldı", IADE: "İade edildi" };
const TAKIPLI = ["DEPO", "EKIP"]; // bakiyesi denetlenen (malzemenin fiziksel olarak durduğu) lokasyonlar
const MUKERRER_DK = 15;

class HwHata extends Error { constructor(mesaj, http = 400, ek = null) { super(mesaj); this.http = http; this.ek = ek; } }

const kodTemizle = (s) => String(s || "").replace(/\s+/g, "").toUpperCase();
const temiz = (s, n = 500) => String(s ?? "").trim().replace(/\s+/g, " ").slice(0, n);
const tarihMi = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const bugun = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const gunStr = (v) => { if (!v) return null; if (v instanceof Date) return isNaN(v) ? null : new Date(v.getTime() + 3 * 3600e3).toISOString().slice(0, 10); const t = String(v).slice(0, 10); return tarihMi(t) ? t : null; };
const yuvarla = (n) => Math.round(Number(n) * 1000) / 1000;

// "12,5" / "12.5" → 12.5 ; geçersiz / ≤0 → hata
function miktar(v, alan) {
  let s = typeof v === "number" ? String(v) : String(v ?? "").trim().replace(/\s+/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", "."); else s = s.replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(s) || !(Number(s) > 0)) throw new HwHata(`${alan}: miktar sıfırdan büyük bir sayı olmalı (en çok 3 ondalık) — "${v}"`);
  return Number(s);
}
// Kalem anahtarı: Huawei malzeme kodu varsa kod, yoksa ad (büyük harf, boşluk tek) + birim
function kalemAnahtari(k) {
  const kod = temiz(k.kod, 80).toUpperCase(), ad = temiz(k.ad, 200).toLocaleUpperCase("tr-TR");
  const birim = temiz(k.birim || "Adet", 20).toLocaleUpperCase("tr-TR");
  return `${kod || ad}|${birim}`;
}
function kalemlerAyristir(liste, { zorunlu = true } = {}) {
  if (!Array.isArray(liste) || !liste.length) { if (zorunlu) throw new HwHata("En az bir malzeme kalemi girin (malzeme adı ve miktar)"); return []; }
  if (liste.length > 200) throw new HwHata("Tek işlemde en çok 200 kalem");
  const birlesik = new Map();
  liste.forEach((k, i) => {
    const ad = temiz(k?.ad, 200), kod = temiz(k?.kod, 80);
    if (!ad && !kod) throw new HwHata(`${i + 1}. kalem: malzeme adı ya da kodu yazın`);
    const birim = temiz(k?.birim || "Adet", 20) || "Adet";
    const m = miktar(k?.miktar, `${i + 1}. kalem (${ad || kod})`);
    const an = kalemAnahtari({ ad, kod, birim });
    const v = birlesik.get(an);
    if (v) v.miktar = yuvarla(v.miktar + m); else birlesik.set(an, { anahtar: an, ad: ad || kod, kod: kod || null, birim, miktar: m });
  });
  return [...birlesik.values()];
}
const lokStr = (tip, id) => (id == null || id === "" ? tip : `${tip}:${id}`);
const ozet = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 32);

// ── Şema (açılışta IF NOT EXISTS; aynı ifadeler migrations/2026-10-31_hw_malzeme_plan.sql'de) ────────────────────
async function semaKur(pool) {
  const q = (s) => pool.query(s).catch((e) => console.error("[hw malzeme şema]", e.message));
  await q(`CREATE TABLE IF NOT EXISTS hw_malzeme_islem (
    id BIGSERIAL PRIMARY KEY, tur TEXT NOT NULL CHECK (tur IN ('KABUL','EKIBE_TESLIM','DEVIR','DEPOYA_DONUS','KULLANIM','IADE','TERS')),
    site_code TEXT NOT NULL, fiziksel_id TEXT, kapsam TEXT NOT NULL DEFAULT 'RF' CHECK (kapsam IN ('RF','ENH')),
    kaynak_tip TEXT NOT NULL, kaynak_id TEXT, hedef_tip TEXT NOT NULL, hedef_id TEXT,
    islem_tarihi DATE NOT NULL DEFAULT CURRENT_DATE, teslim_tipi TEXT CHECK (teslim_tipi IS NULL OR teslim_tipi IN ('KISMI','TAM')),
    eksik_aciklama TEXT, aciklama TEXT, belgeler JSONB NOT NULL DEFAULT '[]', eski_kayit_teyidi BOOLEAN NOT NULL DEFAULT false,
    ters_edilen_id BIGINT, ters_islem_id BIGINT, duzeltilen_islem_id BIGINT, gerekce TEXT,
    kaydeden_user_id INTEGER, kaydeden_email TEXT, kaydeden_ad TEXT, kanal TEXT, istek_anahtari TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await q(`CREATE INDEX IF NOT EXISTS hw_malzeme_islem_site_idx ON hw_malzeme_islem (site_code)`);
  await q(`CREATE INDEX IF NOT EXISTS hw_malzeme_islem_fiz_idx ON hw_malzeme_islem (fiziksel_id)`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS hw_malzeme_islem_ters_uq ON hw_malzeme_islem (ters_edilen_id) WHERE ters_edilen_id IS NOT NULL`);
  await q(`CREATE TABLE IF NOT EXISTS hw_malzeme_islem_kalem (
    id BIGSERIAL PRIMARY KEY, islem_id BIGINT NOT NULL REFERENCES hw_malzeme_islem(id), anahtar TEXT NOT NULL,
    ad TEXT NOT NULL, kod TEXT, birim TEXT NOT NULL DEFAULT 'Adet', miktar NUMERIC(14,3) NOT NULL CHECK (miktar > 0))`);
  await q(`CREATE INDEX IF NOT EXISTS hw_malzeme_islem_kalem_islem_idx ON hw_malzeme_islem_kalem (islem_id)`);
  await q(`CREATE TABLE IF NOT EXISTS hw_malzeme_gecmis (
    id BIGSERIAL PRIMARY KEY, islem_id BIGINT NOT NULL, alan TEXT NOT NULL, eski JSONB, yeni JSONB, gerekce TEXT,
    yapan_email TEXT, yapan_ad TEXT, zaman TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await q(`CREATE INDEX IF NOT EXISTS hw_malzeme_gecmis_islem_idx ON hw_malzeme_gecmis (islem_id)`);
  await q(`CREATE TABLE IF NOT EXISTS hw_malzeme_istek (
    kullanici TEXT NOT NULL, anahtar TEXT NOT NULL, uc TEXT NOT NULL, govde_ozet TEXT NOT NULL, sonuc JSONB,
    created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (kullanici, anahtar))`);
  await q(`CREATE TABLE IF NOT EXISTS hw_malzeme_rollout_yansima (
    site_code TEXT NOT NULL, kapsam TEXT NOT NULL, ilk_gelis_onceki DATE, status_onceki TEXT,
    yazilan_gelis DATE, yazilan_status TEXT, celiski TEXT, updated_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (site_code, kapsam))`);
  // Kayıtlar silinmez / değiştirilmez: yalnız ters_islem_id bir kez doldurulabilir; başlık düzeltmesi (açıklama, belge,
  // teslim tipi, geliş tarihi, eksik açıklaması) hw_malzeme_gecmis'e yazılarak yapılır — miktar ve lokasyon değişmez.
  // 05.11.2026: araç bağlantısı kolonları (arac_plaka / arac_id) yalnız migrations/2026-11-05_arac_operasyon.sql ile eklenir;
  // varsa koruma onları da kilitler (açılışta fonksiyon yeniden yazıldığında migration'ın koruması kaybolmasın)
  const aracKol = await aracKolonuVar(pool, true);
  await q(`CREATE OR REPLACE FUNCTION hw_malzeme_islem_koru() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'hw_malzeme_islem kayıtları silinemez (ters kayıt kullanın)'; END IF;
      IF NEW.id <> OLD.id OR NEW.tur <> OLD.tur OR NEW.site_code <> OLD.site_code OR NEW.kaynak_tip <> OLD.kaynak_tip
         OR NEW.kaynak_id IS DISTINCT FROM OLD.kaynak_id OR NEW.hedef_tip <> OLD.hedef_tip OR NEW.hedef_id IS DISTINCT FROM OLD.hedef_id
         OR NEW.kapsam <> OLD.kapsam OR NEW.ters_edilen_id IS DISTINCT FROM OLD.ters_edilen_id OR NEW.created_at <> OLD.created_at
         ${aracKol ? "OR NEW.arac_plaka IS DISTINCT FROM OLD.arac_plaka OR NEW.arac_id IS DISTINCT FROM OLD.arac_id" : ""}
         OR (OLD.ters_islem_id IS NOT NULL AND NEW.ters_islem_id IS DISTINCT FROM OLD.ters_islem_id) THEN
        RAISE EXCEPTION 'hw_malzeme_islem: miktar / lokasyon / tür değiştirilemez (ters kayıt kullanın)';
      END IF;
      RETURN NEW;
    END $f$`);
  await q(`DROP TRIGGER IF EXISTS hw_malzeme_islem_koru_trg ON hw_malzeme_islem`);
  await q(`CREATE TRIGGER hw_malzeme_islem_koru_trg BEFORE UPDATE OR DELETE ON hw_malzeme_islem FOR EACH ROW EXECUTE FUNCTION hw_malzeme_islem_koru()`);
  await q(`CREATE OR REPLACE FUNCTION hw_malzeme_kalem_koru() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN RAISE EXCEPTION 'hw_malzeme_islem_kalem kayıtları değiştirilemez / silinemez (ters kayıt kullanın)'; END $f$`);
  await q(`DROP TRIGGER IF EXISTS hw_malzeme_kalem_koru_trg ON hw_malzeme_islem_kalem`);
  await q(`CREATE TRIGGER hw_malzeme_kalem_koru_trg BEFORE UPDATE OR DELETE ON hw_malzeme_islem_kalem FOR EACH ROW EXECUTE FUNCTION hw_malzeme_kalem_koru()`);
  for (const t of ["hw_malzeme_islem", "hw_malzeme_islem_kalem", "hw_malzeme_gecmis", "hw_malzeme_istek", "hw_malzeme_rollout_yansima"])
    await q(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
}

// Araç bağlantısı kolonu (migration 2026-11-05) var mı — 5 dk önbellek; yoksa teslim / devirde plaka kabul edilmez
let _aracKol = null;
async function aracKolonuVar(db, tazele = false) {
  if (!tazele && _aracKol && Date.now() - _aracKol.t < 300000) return _aracKol.v;
  const r = await db.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'hw_malzeme_islem' AND column_name = 'arac_plaka'`).catch(() => ({ rows: [] }));
  _aracKol = { t: Date.now(), v: r.rows.length > 0 };
  return _aracKol.v;
}

// ── Bakiye: iş kodu → lokasyon → kalem (hareketlerden) ─────────────────────────────────────────────────────────
// TERS işlemi orijinalin kaynak/hedefini ters çevirerek yazılır; bu yüzden toplam doğrudan hareketlerden çıkar.
async function bakiyeler(db, kodlar) {
  if (!kodlar.length) return new Map();
  const r = await db.query(`SELECT i.site_code, i.kaynak_tip, i.kaynak_id, i.hedef_tip, i.hedef_id, k.anahtar, k.ad, k.kod, k.birim, k.miktar
    FROM hw_malzeme_islem i JOIN hw_malzeme_islem_kalem k ON k.islem_id = i.id WHERE i.site_code = ANY($1::text[])`, [kodlar]);
  const out = new Map();
  for (const x of r.rows) {
    const s = out.get(x.site_code) || out.set(x.site_code, { lok: new Map(), kalemAd: new Map() }).get(x.site_code);
    s.kalemAd.set(x.anahtar, { ad: x.ad, kod: x.kod, birim: x.birim });
    const ekle = (lok, d) => { const m = s.lok.get(lok) || s.lok.set(lok, new Map()).get(lok); m.set(x.anahtar, yuvarla((m.get(x.anahtar) || 0) + d)); };
    ekle(lokStr(x.kaynak_tip, x.kaynak_id), -Number(x.miktar));
    ekle(lokStr(x.hedef_tip, x.hedef_id), Number(x.miktar));
  }
  return out;
}
const lokToplam = (m) => yuvarla([...(m?.values() || [])].reduce((a, b) => a + Math.max(0, b), 0));

// ── Durum hesabı (saf): teslim tamlığı ≠ geldi bilgisi ≠ malzemenin yeri ────────────────────────────────────────
// girdi: { islemler (bu iş kodunun, ters edilmemiş + ters dahil), bakiye ({lok}), row (rollout satırı), montaj (fiili), ekipAd }
function durumHesapla({ islemler = [], bakiye = null, row = null, montaj = null, ekipAd = (n) => `Ekip ${n}` }) {
  const aktifKabul = islemler.filter((i) => i.tur === "KABUL" && !i.ters_islem_id);
  const gelisler = aktifKabul.map((i) => gunStr(i.islem_tarihi)).filter(Boolean).sort();
  const sonKabul = [...aktifKabul].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
  const teslim = !aktifKabul.length ? null : aktifKabul.some((i) => i.teslim_tipi === "TAM") ? "TAM" : "KISMI";
  const lok = bakiye?.lok || new Map();
  let depoda = 0; const depolar = [], ekipte = [];
  let kullanildi = 0, iade = 0;
  for (const [l, m] of lok) {
    const t = lokToplam(m); if (!(t > 0)) continue;
    const [tip, id] = l.split(":");
    if (tip === "DEPO") { depoda = yuvarla(depoda + t); depolar.push({ depo_id: id ? Number(id) : null, miktar: t }); }
    else if (tip === "EKIP") ekipte.push({ ekip_no: Number(id), ad: ekipAd(Number(id)), miktar: t });
    else if (tip === "SAHA") kullanildi = yuvarla(kullanildi + t);
    else if (tip === "IADE") iade = yuvarla(iade + t);
  }
  const ekipteT = yuvarla(ekipte.reduce((a, x) => a + x.miktar, 0));
  const eskiTarih = gunStr(row?.malzeme_gelis_tarihi);
  let konum, konum_ad;
  if (!aktifKabul.length && !islemler.length) {
    if (eskiTarih) { konum = "ESKI_TEYIT"; konum_ad = `Eski kayıt · geliş ${eskiTarih} · tamlık ve yer teyit bekliyor`; }
    else { konum = "YOK"; konum_ad = "Malzeme kaydı yok"; }
  } else if (depoda > 0 && ekipteT > 0) { konum = "KISMEN_EKIP_DEPO"; konum_ad = `Kısmen ekipte (${ekipte.map((e) => e.ad).join(", ")}), kısmen depoda`; }
  else if (ekipteT > 0) { konum = "EKIPTE"; konum_ad = `Ekipte · ${ekipte.map((e) => e.ad).join(", ")}`; }
  else if (depoda > 0) { konum = "DEPODA"; konum_ad = "Depoda"; }
  else if (kullanildi > 0) { konum = "KULLANILDI"; konum_ad = "Sahada kullanıldı"; }
  else if (iade > 0) { konum = "IADE"; konum_ad = "Huawei'ye iade edildi"; }
  else { konum = "YOK"; konum_ad = "Bakiye yok"; }
  const montajBasladi = !!(montaj && (["DEVAM", "TAMAMLANDI"].includes(montaj.kod) || montaj.baslama || montaj.bitis));
  // Birleşik etiket: "Depoda · Montaj bekliyor" yalnız tam teslim + depoda + montaj başlamamışsa
  let etiket = konum_ad;
  if (konum === "DEPODA" && teslim === "TAM" && !montajBasladi) etiket = "Depoda · Montaj bekliyor";
  else if (konum === "DEPODA" && teslim === "KISMI") etiket = "Depoda · Kısmi teslim (eksik var)";
  else if (konum === "EKIPTE" && teslim === "KISMI") etiket = `${konum_ad} · kısmi teslim`;
  return {
    teslim, teslim_ad: teslim === "TAM" ? "Tamamı geldi" : teslim === "KISMI" ? "Kısmi teslim · eksik var" : eskiTarih && !islemler.length ? "Teyit bekliyor (eski kayıt)" : "Gelmedi",
    ilk_gelis: gelisler[0] || null, son_gelis: gelisler[gelisler.length - 1] || null, kabul_sayisi: aktifKabul.length,
    eksik_aciklama: sonKabul?.teslim_tipi === "KISMI" ? sonKabul.eksik_aciklama || null : null,
    konum, konum_ad, etiket, depoda, depolar, ekipte, kullanildi, iade,
    eski_kayit: !islemler.length && !!eskiTarih ? { malzeme_gelis_tarihi: eskiTarih, malzeme_status: row?.malzeme_status || null } : null,
    montaj_basladi: montajBasladi, montaj_bekliyor: (konum === "DEPODA" || konum === "EKIPTE" || konum === "KISMEN_EKIP_DEPO") && !montajBasladi,
  };
}

// Toplu durum (harita / plan / depo özeti): kodlar → Map(kod → durum). rows: Map(kod → rollout satırı), montajMap: Map(kod → fiili)
async function durumHaritasi(db, kodlar, { rows = new Map(), montajMap = new Map(), ekipAd } = {}) {
  const k = [...new Set(kodlar.map(kodTemizle).filter(Boolean))];
  if (!k.length) return new Map();
  const tablo = (await db.query(`SELECT to_regclass('public.hw_malzeme_islem') AS t`)).rows[0]?.t;
  const isl = tablo ? (await db.query(`SELECT id, site_code, tur, teslim_tipi, eksik_aciklama, islem_tarihi, ters_islem_id, created_at FROM hw_malzeme_islem WHERE site_code = ANY($1::text[])`, [k])).rows : [];
  const bak = tablo ? await bakiyeler(db, k) : new Map();
  const ad = ekipAd || await ekipAdlari(db);
  const out = new Map();
  for (const kod of k) out.set(kod, durumHesapla({ islemler: isl.filter((x) => x.site_code === kod), bakiye: bak.get(kod), row: rows.get(kod) || null, montaj: montajMap.get(kod) || null, ekipAd: ad }));
  return out;
}
async function ekipAdlari(db) {
  const r = await db.query(`SELECT ekip_no, ad FROM ekipler`).catch(() => ({ rows: [] }));
  const m = new Map(r.rows.map((x) => [Number(x.ekip_no), x.ad || `Ekip ${x.ekip_no}`]));
  return (n) => m.get(Number(n)) || `Ekip ${n}`;
}

// ── Rollout yansıması ─────────────────────────────────────────────────────────────────────────────────────────
async function rolloutYansit(client, siteCode, kapsam) {
  const kol = kapsam === "ENH" ? "enh_malzeme_gelis_tarihi" : "malzeme_gelis_tarihi";
  const isl = (await client.query(`SELECT teslim_tipi, islem_tarihi FROM hw_malzeme_islem WHERE site_code = $1 AND kapsam = $2 AND tur = 'KABUL' AND ters_islem_id IS NULL`, [siteCode, kapsam])).rows;
  const ro = (await client.query(`SELECT id, ${kol} AS gelis, malzeme_status, installation_actual_start_date, installation_actual_end_date, rf_started_date, rf_finished_date, onair_date
    FROM rollout_progress WHERE UPPER(TRIM(site_code)) = $1`, [siteCode]).catch(() => ({ rows: [] }))).rows;
  if (!ro.length) return { yazildi: false, neden: "Rollout kaydı yok" };
  const yan = (await client.query(`SELECT * FROM hw_malzeme_rollout_yansima WHERE site_code = $1 AND kapsam = $2`, [siteCode, kapsam])).rows[0] || null;
  const ilk = isl.map((x) => gunStr(x.islem_tarihi)).filter(Boolean).sort()[0] || null;
  const tam = isl.some((x) => x.teslim_tipi === "TAM");
  const mevcutGelis = gunStr(ro[0].gelis), mevcutStatus = ro[0].malzeme_status ?? null;
  const montajBasladi = ro.some((r) => r.installation_actual_start_date || r.installation_actual_end_date || r.rf_started_date || r.rf_finished_date || r.onair_date);
  // Başkası (Rollout ekranı / Excel) bizim son yazdığımızdan sonra değiştirdiyse üzerine yazılmaz
  const celiski = [];
  const gelisBizim = !yan || (gunStr(yan.yazilan_gelis) === mevcutGelis);
  let yeniGelis = mevcutGelis;
  if (ilk && ilk !== mevcutGelis) {
    if (!yan || gelisBizim) yeniGelis = ilk; else celiski.push(`Rollout geliş tarihi elle ${mevcutGelis || "boş"} yapılmış; kabul kaydı ${ilk} — kontrol edin`);
  } else if (!ilk && yan && gelisBizim) yeniGelis = gunStr(yan.ilk_gelis_onceki); // tüm kabuller ters edildi → önceki değere dön
  let yeniStatus = mevcutStatus;
  if (kapsam === "RF") {
    const hedef = tam ? "OK" : ilk ? "KISMI" : null;
    const statusBizim = !yan || (yan.yazilan_status ?? null) === mevcutStatus;
    if (hedef && hedef !== mevcutStatus) {
      if (hedef === "KISMI" && String(mevcutStatus || "").toUpperCase() === "OK" && montajBasladi) celiski.push("Montaj başlamış iş: malzeme durumu OK'den KISMI'ya çekilmedi");
      else if (!yan || statusBizim || !String(mevcutStatus || "").trim()) yeniStatus = hedef;
      else celiski.push(`Rollout malzeme durumu elle "${mevcutStatus}" yapılmış; kabul kaydına göre ${hedef} — kontrol edin`);
    } else if (!hedef && yan && statusBizim && !montajBasladi) yeniStatus = yan.status_onceki ?? null;
  }
  const degisti = yeniGelis !== mevcutGelis || yeniStatus !== mevcutStatus;
  if (degisti) await client.query(`UPDATE rollout_progress SET ${kol} = $2::date${kapsam === "RF" ? ", malzeme_status = $3" : ""}, updated_at = NOW() WHERE UPPER(TRIM(site_code)) = $1`,
    kapsam === "RF" ? [siteCode, yeniGelis, yeniStatus] : [siteCode, yeniGelis]);
  await client.query(`INSERT INTO hw_malzeme_rollout_yansima (site_code, kapsam, ilk_gelis_onceki, status_onceki, yazilan_gelis, yazilan_status, celiski, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT (site_code, kapsam) DO UPDATE SET yazilan_gelis = EXCLUDED.yazilan_gelis, yazilan_status = EXCLUDED.yazilan_status,
      celiski = EXCLUDED.celiski, updated_at = now()`,
    [siteCode, kapsam, yan ? yan.ilk_gelis_onceki : mevcutGelis, yan ? yan.status_onceki : mevcutStatus, yeniGelis, kapsam === "RF" ? yeniStatus : null, celiski.join(" · ") || null]);
  return { yazildi: degisti, gelis: yeniGelis, status: yeniStatus, celiski };
}

// ── Modül kurulumu (uçlar) ─────────────────────────────────────────────────────────────────────────────────────
// deps: { pool, authMiddleware, upload, uploadToStorage, kapsamIsKodlari(req) → { kodlar:Set, rows:Map, K } , yetki: { goruntule(req), hareket(req) },
//         ekipKapsamda(req, ekip_no) → bool, montajFiili(kodlar) → Map }
function kur(app, deps) {
  const { pool, authMiddleware } = deps;
  let hazir = null;
  const sema = () => (hazir = hazir || semaKur(pool).catch((e) => { hazir = null; throw e; }));
  sema().catch(() => {});
  const kullaniciAnahtari = (req) => String(req.user?.email || req.user?.user_id || req.user?.id || "").toLowerCase().trim();
  const yapan = (req) => ({ id: Number(req.user?.user_id || req.user?.id || 0) || null, email: String(req.user?.email || "").toLowerCase().trim() || null,
    ad: temiz(req.user?.name || req.user?.ad_soyad || req.user?.email, 120) || null });
  const hata = (res, e) => {
    if (e instanceof HwHata) return res.status(e.http).json({ ok: false, error: e.message, ...(e.ek || {}) });
    console.error("HW MALZEME ERROR:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  };
  const goruntuleKapi = (req) => { if (!deps.yetki.goruntule(req)) throw new HwHata("HW Malzeme Durumu görüntüleme yetkiniz yok", 403); };
  const hareketKapi = (req) => { if (!deps.yetki.hareket(req)) throw new HwHata("Depo hareketi (malzeme kabul / teslim / devir / iade) yetkiniz yok", 403); };
  async function kapsamdaMi(req, kod) {
    const k = await deps.kapsamIsKodlari(req);
    if (!k.kodlar.has(kod)) throw new HwHata(`${kod}: iş kodu bulunamadı ya da erişim kapsamınızda değil`, 403);
    return k;
  }
  async function depoDogrula(db, depoId) {
    const id = Number(depoId);
    if (!Number.isInteger(id) || id <= 0) throw new HwHata("Depoyu seçin");
    const r = await db.query(`SELECT id, ad, tur FROM ofis_depo WHERE id = $1`, [id]).catch(() => ({ rows: [] }));
    if (!r.rows.length) throw new HwHata("Depo kaydı bulunamadı");
    return r.rows[0];
  }
  async function ekipDogrula(db, req, no) {
    const n = Number(no);
    if (!Number.isInteger(n) || n <= 0) throw new HwHata("Ekibi seçin");
    const r = await db.query(`SELECT ekip_no, ad, COALESCE(aktif,true) AS aktif, ekip_turu, bagli_firma FROM ekipler WHERE ekip_no = $1`, [n]);
    if (!r.rows.length) throw new HwHata("Ekip kaydı bulunamadı");
    if (!(await deps.ekipKapsamda(req, r.rows[0]))) throw new HwHata("Bu ekip erişim kapsamınızda değil", 403);
    return r.rows[0];
  }

  // Ortak yazma çerçevesi: istek anahtarı + iş kodu kilidi + transaction
  async function yaz(req, uc, govde, siteCode, fn) {
    await sema();
    const anahtar = temiz(req.body?.istek_anahtari, 100);
    if (anahtar.length < 8) throw new HwHata("istek_anahtari eksik (en az 8 karakter) — sayfayı yenileyip tekrar deneyin");
    const kim = kullaniciAnahtari(req);
    const gozet = ozet({ uc, govde });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ins = await client.query(`INSERT INTO hw_malzeme_istek (kullanici, anahtar, uc, govde_ozet) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING anahtar`, [kim, anahtar, uc, gozet]);
      if (!ins.rows.length) {
        const ev = (await client.query(`SELECT uc, govde_ozet, sonuc FROM hw_malzeme_istek WHERE kullanici = $1 AND anahtar = $2`, [kim, anahtar])).rows[0];
        await client.query("ROLLBACK");
        if (ev.uc !== uc || ev.govde_ozet !== gozet) throw new HwHata("Bu istek anahtarı farklı bir işlem için kullanılmış — formu yenileyin", 409);
        return { ...(ev.sonuc || {}), tekrar: true, mesaj: "Bu kayıt daha önce alınmıştı; ikinci kez işlenmedi" };
      }
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`hwm:${siteCode}`]);
      const sonuc = await fn(client);
      await client.query(`UPDATE hw_malzeme_istek SET sonuc = $3 WHERE kullanici = $1 AND anahtar = $2`, [kim, anahtar, JSON.stringify(sonuc)]);
      await client.query("COMMIT");
      return sonuc;
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
    finally { client.release(); }
  }
  async function islemEkle(client, req, x) {
    const y = yapan(req);
    const fiz = deps.fizikselSaha(x.site_code)?.fiziksel_id || null;
    // Araç bağlantısı (teslim / devir): kolon migration'la eklendiyse kayıtla BİRLİKTE yazılır (sonradan değiştirilemez)
    const arac = x.arac && await aracKolonuVar(client) ? x.arac : null;
    const ekKol = arac ? ", arac_plaka, arac_id" : "", ekDeg = arac ? ",$23,$24" : "";
    const r = await client.query(`INSERT INTO hw_malzeme_islem (tur, site_code, fiziksel_id, kapsam, kaynak_tip, kaynak_id, hedef_tip, hedef_id, islem_tarihi, teslim_tipi,
        eksik_aciklama, aciklama, belgeler, eski_kayit_teyidi, ters_edilen_id, duzeltilen_islem_id, gerekce, kaydeden_user_id, kaydeden_email, kaydeden_ad, kanal, istek_anahtari${ekKol})
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22${ekDeg}) RETURNING *`,
      [x.tur, x.site_code, fiz, x.kapsam || "RF", x.kaynak_tip, x.kaynak_id ?? null, x.hedef_tip, x.hedef_id ?? null, x.islem_tarihi || bugun(), x.teslim_tipi || null,
        x.eksik_aciklama || null, x.aciklama || null, JSON.stringify(x.belgeler || []), !!x.eski_kayit_teyidi, x.ters_edilen_id || null, x.duzeltilen_islem_id || null,
        x.gerekce || null, y.id, y.email, y.ad, temiz(req.headers?.["x-istemci"] || req.body?.kanal || "web", 20), temiz(req.body?.istek_anahtari, 100) || null,
        ...(arac ? [arac.plaka, arac.id] : [])]);
    const isl = r.rows[0];
    for (const k of x.kalemler) await client.query(`INSERT INTO hw_malzeme_islem_kalem (islem_id, anahtar, ad, kod, birim, miktar) VALUES ($1,$2,$3,$4,$5,$6)`,
      [isl.id, k.anahtar, k.ad, k.kod, k.birim, k.miktar]);
    return isl;
  }
  // Kaynak lokasyondaki bakiye: kalemler boşsa tüm bakiye taşınır; verildiyse her kalem bakiyeyi aşamaz
  async function kaynaktanKalemler(client, siteCode, kaynak, istenen) {
    const b = (await bakiyeler(client, [siteCode])).get(siteCode);
    const m = b?.lok.get(kaynak) || new Map();
    const mevcut = [...m.entries()].filter(([, v]) => v > 0).map(([anahtar, v]) => ({ anahtar, ...b.kalemAd.get(anahtar), miktar: v }));
    if (!istenen || !istenen.length) {
      if (!mevcut.length) throw new HwHata("Kaynakta bu işe ait malzeme yok");
      return mevcut;
    }
    const out = kalemlerAyristir(istenen);
    for (const k of out) {
      const v = m.get(k.anahtar) || 0;
      if (k.miktar > v + 1e-9) throw new HwHata(`${k.ad}: kaynakta ${v} ${k.birim} var, ${k.miktar} istendi — miktar bakiyeyi aşamaz`, 409, { bakiye: mevcut });
    }
    return out;
  }
  const islemOzet = (isl, kalemler) => ({ id: Number(isl.id), tur: isl.tur, tur_ad: TUR_TR[isl.tur], site_code: isl.site_code, islem_tarihi: gunStr(isl.islem_tarihi),
    teslim_tipi: isl.teslim_tipi, kalemler: kalemler.map((k) => ({ ad: k.ad, kod: k.kod, birim: k.birim, miktar: Number(k.miktar) })) });

  // ── Arama: Site ID / tam iş kodu ──
  app.get("/hw-malzeme/ara", authMiddleware, async (req, res) => {
    try {
      goruntuleKapi(req); await sema();
      const q = kodTemizle(req.query.q).slice(0, 40);
      if (q.length < 2) return res.json({ ok: true, sonuclar: [] });
      const k = await deps.kapsamIsKodlari(req);
      const esles = [...k.kodlar].filter((x) => x.includes(q)).sort((a, b) => (a.startsWith(q) ? 0 : 1) - (b.startsWith(q) ? 0 : 1) || a.localeCompare(b)).slice(0, 30);
      const d = await durumHaritasi(pool, esles, { rows: k.rows });
      res.json({ ok: true, sonuclar: esles.map((kod) => { const r = k.rows.get(kod); return { site_code: kod, fiziksel_id: deps.fizikselSaha(kod)?.fiziksel_id || null,
        bolge: r?.bolge || null, il: r?.il || null, site_type: r?.site_type || null, durum: d.get(kod) }; }) });
    } catch (e) { hata(res, e); }
  });

  // ── İş kodu detayı: durum, bakiye (lokasyon × kalem), işlemler, geçmiş ──
  app.get("/hw-malzeme/is/:kod", authMiddleware, async (req, res) => {
    try {
      goruntuleKapi(req); await sema();
      const kod = kodTemizle(req.params.kod);
      const k = await kapsamdaMi(req, kod);
      const ekipAd = await ekipAdlari(pool);
      const montajMap = deps.montajFiili ? await deps.montajFiili([kod]) : new Map();
      const durum = (await durumHaritasi(pool, [kod], { rows: k.rows, montajMap, ekipAd })).get(kod);
      const isl = (await pool.query(`SELECT * FROM hw_malzeme_islem WHERE site_code = $1 ORDER BY created_at, id`, [kod])).rows;
      const kal = isl.length ? (await pool.query(`SELECT * FROM hw_malzeme_islem_kalem WHERE islem_id = ANY($1::bigint[]) ORDER BY id`, [isl.map((x) => x.id)])).rows : [];
      const gec = isl.length ? (await pool.query(`SELECT * FROM hw_malzeme_gecmis WHERE islem_id = ANY($1::bigint[]) ORDER BY zaman`, [isl.map((x) => x.id)])).rows : [];
      const depoAd = new Map((await pool.query(`SELECT id, ad FROM ofis_depo`).catch(() => ({ rows: [] }))).rows.map((x) => [String(x.id), x.ad]));
      const lokAd = (tip, id) => tip === "DEPO" ? (depoAd.get(String(id)) || `Depo ${id ?? ""}`.trim()) : tip === "EKIP" ? ekipAd(id) : LOK_TR[tip] || tip;
      const b = (await bakiyeler(pool, [kod])).get(kod);
      const bakiye = [];
      if (b) for (const [l, m] of b.lok) {
        const [tip, id] = l.split(":"); if (!TAKIPLI.includes(tip) && !["SAHA", "IADE"].includes(tip)) continue;
        for (const [an, v] of m) if (v > 0) bakiye.push({ lok_tip: tip, lok_id: id ?? null, lok_ad: lokAd(tip, id), ...b.kalemAd.get(an), anahtar: an, miktar: v });
      }
      const yan = (await pool.query(`SELECT * FROM hw_malzeme_rollout_yansima WHERE site_code = $1`, [kod])).rows;
      const r = k.rows.get(kod);
      res.json({ ok: true, site_code: kod, fiziksel_id: deps.fizikselSaha(kod)?.fiziksel_id || null, bolge: r?.bolge || null, il: r?.il || null, site_type: r?.site_type || null,
        rollout: r ? { malzeme_gelis_tarihi: gunStr(r.malzeme_gelis_tarihi), enh_malzeme_gelis_tarihi: gunStr(r.enh_malzeme_gelis_tarihi), malzeme_status: r.malzeme_status ?? null } : null,
        durum, bakiye, yansima: yan.map((y) => ({ kapsam: y.kapsam, celiski: y.celiski })),
        islemler: isl.map((x) => ({ ...islemOzet(x, kal.filter((c) => String(c.islem_id) === String(x.id))), kaynak: lokAd(x.kaynak_tip, x.kaynak_id), hedef: lokAd(x.hedef_tip, x.hedef_id),
          kaynak_tip: x.kaynak_tip, kaynak_id: x.kaynak_id, hedef_tip: x.hedef_tip, hedef_id: x.hedef_id, kapsam: x.kapsam,
          eksik_aciklama: x.eksik_aciklama, aciklama: x.aciklama, belgeler: x.belgeler || [], gerekce: x.gerekce, eski_kayit_teyidi: x.eski_kayit_teyidi,
          ters_edilen_id: x.ters_edilen_id ? Number(x.ters_edilen_id) : null, ters_islem_id: x.ters_islem_id ? Number(x.ters_islem_id) : null,
          duzeltilen_islem_id: x.duzeltilen_islem_id ? Number(x.duzeltilen_islem_id) : null,
          kaydeden: x.kaydeden_ad || x.kaydeden_email, kanal: x.kanal, zaman: x.created_at, arac_plaka: x.arac_plaka || null,
          gecmis: gec.filter((g) => String(g.islem_id) === String(x.id)).map((g) => ({ alan: g.alan, eski: g.eski, yeni: g.yeni, gerekce: g.gerekce, yapan: g.yapan_ad || g.yapan_email, zaman: g.zaman })) })),
        hareket_yetkisi: !!deps.yetki.hareket(req) });
    } catch (e) { hata(res, e); }
  });

  // ── KABUL: Huawei → Depo ──
  app.post("/hw-malzeme/kabul", authMiddleware, async (req, res) => {
    try {
      hareketKapi(req);
      const b = req.body || {};
      const kod = kodTemizle(b.site_code);
      if (!kod) throw new HwHata("Site ID / tam iş kodu seçin");
      await kapsamdaMi(req, kod);
      if (!tarihMi(b.gelis_tarihi)) throw new HwHata("Malzeme geliş tarihini girin");
      if (b.gelis_tarihi > bugun()) throw new HwHata("Geliş tarihi bugünden ileri olamaz");
      if (!["KISMI", "TAM"].includes(b.teslim_tipi)) throw new HwHata("Teslim tipini seçin: kısmi ya da tam");
      const kapsam = b.kapsam === "ENH" ? "ENH" : "RF";
      const kalemler = kalemlerAyristir(b.kalemler);
      const depo = await depoDogrula(pool, b.depo_id);
      const belgeler = (Array.isArray(b.belgeler) ? b.belgeler : []).slice(0, 20).map((x) => ({ url: temiz(x?.url, 1000), ad: temiz(x?.ad, 200) || null, tur: temiz(x?.tur, 40) || null }))
        .filter((x) => /^https?:\/\//i.test(x.url));
      if (b.teslim_tipi === "KISMI" && !temiz(b.eksik_aciklama)) throw new HwHata("Kısmi teslimde eksik kalan malzemeyi yazın");
      const govde = { kod, gelis: b.gelis_tarihi, tip: b.teslim_tipi, kapsam, depo: depo.id, kalemler: kalemler.map((k) => [k.anahtar, k.miktar]) };
      const sonuc = await yaz(req, "kabul", govde, kod, async (client) => {
        // Olası mükerrer: başka anahtarla, 15 dk içinde aynı iş + tarih + kalemler
        if (b.mukerrer_onay !== true) {
          const son = (await client.query(`SELECT i.id, i.created_at, array_agg(k.anahtar || '=' || k.miktar::float8 ORDER BY k.anahtar) AS imza FROM hw_malzeme_islem i
              JOIN hw_malzeme_islem_kalem k ON k.islem_id = i.id WHERE i.site_code = $1 AND i.tur = 'KABUL' AND i.ters_islem_id IS NULL AND i.islem_tarihi = $2
                AND i.created_at > now() - ($3 || ' minutes')::interval GROUP BY i.id`, [kod, b.gelis_tarihi, String(MUKERRER_DK)])).rows;
          const imza = kalemler.map((k) => `${k.anahtar}=${k.miktar}`).sort();
          const ayni = son.find((s) => JSON.stringify(s.imza) === JSON.stringify(imza));
          if (ayni) throw new HwHata(`Olası mükerrer: aynı iş, aynı tarih ve aynı kalemlerle #${ayni.id} numaralı kabul ${MUKERRER_DK} dk içinde kaydedildi. Gerçekten ikinci bir teslimatsa "Ayrı teslimat olarak kaydet" ile onaylayın.`, 409, { mukerrer: { islem_id: Number(ayni.id) } });
        }
        const isl = await islemEkle(client, req, { tur: "KABUL", site_code: kod, kapsam, kaynak_tip: "HUAWEI", hedef_tip: "DEPO", hedef_id: String(depo.id), islem_tarihi: b.gelis_tarihi,
          teslim_tipi: b.teslim_tipi, eksik_aciklama: b.teslim_tipi === "KISMI" ? temiz(b.eksik_aciklama, 1000) : null, aciklama: temiz(b.aciklama, 1000) || null, belgeler,
          eski_kayit_teyidi: b.eski_kayit_teyidi === true, kalemler });
        const yansima = await rolloutYansit(client, kod, kapsam);
        return { ok: true, islem: islemOzet(isl, kalemler), rollout: yansima };
      });
      res.json(sonuc);
    } catch (e) { hata(res, e); }
  });

  // ── Lokasyonlar arası hareketler ──
  const hareketTanim = {
    "ekibe-teslim": { tur: "EKIBE_TESLIM", kaynak: async (b) => ({ tip: "DEPO", id: String((await depoDogrula(pool, b.depo_id)).id) }), hedef: async (b, req) => ({ tip: "EKIP", id: String((await ekipDogrula(pool, req, b.ekip_no)).ekip_no) }) },
    "devir": { tur: "DEVIR", kaynak: async (b, req) => ({ tip: "EKIP", id: String((await ekipDogrula(pool, req, b.kaynak_ekip_no)).ekip_no) }), hedef: async (b, req) => ({ tip: "EKIP", id: String((await ekipDogrula(pool, req, b.hedef_ekip_no)).ekip_no) }), gerekceZorunlu: true },
    "depoya-donus": { tur: "DEPOYA_DONUS", kaynak: async (b, req) => ({ tip: "EKIP", id: String((await ekipDogrula(pool, req, b.ekip_no)).ekip_no) }), hedef: async (b) => ({ tip: "DEPO", id: String((await depoDogrula(pool, b.depo_id)).id) }) },
    "kullanim": { tur: "KULLANIM", kaynak: async (b, req) => (b.ekip_no ? { tip: "EKIP", id: String((await ekipDogrula(pool, req, b.ekip_no)).ekip_no) } : { tip: "DEPO", id: String((await depoDogrula(pool, b.depo_id)).id) }), hedef: async () => ({ tip: "SAHA", id: null }) },
    "iade": { tur: "IADE", kaynak: async (b, req) => (b.ekip_no ? { tip: "EKIP", id: String((await ekipDogrula(pool, req, b.ekip_no)).ekip_no) } : { tip: "DEPO", id: String((await depoDogrula(pool, b.depo_id)).id) }), hedef: async () => ({ tip: "IADE", id: null }), gerekceZorunlu: true },
  };
  for (const [yol, t] of Object.entries(hareketTanim)) {
    app.post(`/hw-malzeme/${yol}`, authMiddleware, async (req, res) => {
      try {
        hareketKapi(req);
        const b = req.body || {};
        const kod = kodTemizle(b.site_code);
        if (!kod) throw new HwHata("Site ID / tam iş kodu seçin");
        await kapsamdaMi(req, kod);
        const kaynak = await t.kaynak(b, req), hedef = await t.hedef(b, req);
        if (kaynak.tip === hedef.tip && kaynak.id === hedef.id) throw new HwHata("Kaynak ve hedef aynı olamaz");
        const tarih = tarihMi(b.tarih) ? b.tarih : bugun();
        if (tarih > bugun()) throw new HwHata("İşlem tarihi bugünden ileri olamaz");
        // 05.11.2026: teslim / devirde malzemenin yüklendiği araç (isteğe bağlı) — depo sorumlusunun açık seçimi; kapsam sunucuda
        let arac = null;
        if (["EKIBE_TESLIM", "DEVIR"].includes(t.tur) && String(b.arac_plaka || "").trim()) {
          if (!(await aracKolonuVar(pool))) throw new HwHata("Araç bağlantısı için veritabanı kurulumu bekliyor (migration 2026-11-05) — plakasız kaydedin", 409);
          if (!deps.aracDogrula) throw new HwHata("Araç doğrulaması yapılandırılmamış", 500);
          arac = await deps.aracDogrula(req, b.arac_plaka);
          if (!arac) throw new HwHata("Araç bulunamadı ya da erişim kapsamınızda değil", 403);
        }
        const gerekce = temiz(b.gerekce || b.aciklama, 1000);
        if (t.gerekceZorunlu && gerekce.length < 3) throw new HwHata(t.tur === "DEVIR" ? "Ekipler arası devrin gerekçesini yazın" : "İade gerekçesini yazın");
        const govde = { kod, kaynak, hedef, tarih, arac: arac?.plaka || null, kalemler: Array.isArray(b.kalemler) ? b.kalemler.map((k) => [kalemAnahtari(k), String(k.miktar)]) : "TUMU" };
        const sonuc = await yaz(req, yol, govde, kod, async (client) => {
          const kalemler = await kaynaktanKalemler(client, kod, lokStr(kaynak.tip, kaynak.id), b.kalemler);
          const isl = await islemEkle(client, req, { tur: t.tur, site_code: kod, kaynak_tip: kaynak.tip, kaynak_id: kaynak.id, hedef_tip: hedef.tip, hedef_id: hedef.id,
            islem_tarihi: tarih, aciklama: temiz(b.aciklama, 1000) || null, gerekce: gerekce || null, kalemler, arac,
            belgeler: (Array.isArray(b.belgeler) ? b.belgeler : []).slice(0, 20).filter((x) => /^https?:\/\//i.test(String(x?.url || ""))).map((x) => ({ url: temiz(x.url, 1000), ad: temiz(x.ad, 200) || null })) });
          return { ok: true, islem: { ...islemOzet(isl, kalemler), arac_plaka: isl.arac_plaka || null } };
        });
        res.json(sonuc);
      } catch (e) { hata(res, e); }
    });
  }

  // ── Ters kayıt (iptal) — orijinal silinmez; kaynağa dönüş bakiyesi yetmiyorsa (malzeme sonradan taşındı) reddedilir ──
  async function tersYaz(client, req, isl, gerekce, duzeltme = false) {
    if (isl.tur === "TERS") throw new HwHata("Ters kaydın tersi alınamaz");
    if (isl.ters_islem_id) throw new HwHata("Bu işlem zaten ters edilmiş");
    const kal = (await client.query(`SELECT anahtar, ad, kod, birim, miktar FROM hw_malzeme_islem_kalem WHERE islem_id = $1`, [isl.id])).rows.map((k) => ({ ...k, miktar: Number(k.miktar) }));
    if (TAKIPLI.includes(isl.hedef_tip)) {
      const b = (await bakiyeler(client, [isl.site_code])).get(isl.site_code);
      const m = b?.lok.get(lokStr(isl.hedef_tip, isl.hedef_id)) || new Map();
      for (const k of kal) if ((m.get(k.anahtar) || 0) + 1e-9 < k.miktar)
        throw new HwHata(`${k.ad}: malzeme bu işlemden sonra başka yere taşınmış — önce sonraki hareketi geri alın`, 409);
    }
    const t = await islemEkle(client, req, { tur: "TERS", site_code: isl.site_code, kapsam: isl.kapsam, kaynak_tip: isl.hedef_tip, kaynak_id: isl.hedef_id, hedef_tip: isl.kaynak_tip,
      hedef_id: isl.kaynak_id, islem_tarihi: bugun(), gerekce: `${duzeltme ? "Düzeltme" : "İptal"}: ${gerekce}`, ters_edilen_id: isl.id, kalemler: kal });
    await client.query(`UPDATE hw_malzeme_islem SET ters_islem_id = $2 WHERE id = $1`, [isl.id, t.id]);
    return t;
  }
  app.post("/hw-malzeme/islem/:id/ters", authMiddleware, async (req, res) => {
    try {
      hareketKapi(req);
      const gerekce = temiz(req.body?.gerekce, 1000);
      if (gerekce.length < 3) throw new HwHata("İptal gerekçesini yazın");
      const isl = (await pool.query(`SELECT * FROM hw_malzeme_islem WHERE id = $1`, [Number(req.params.id) || 0])).rows[0];
      if (!isl) throw new HwHata("İşlem bulunamadı", 404);
      await kapsamdaMi(req, isl.site_code);
      const sonuc = await yaz(req, "ters", { id: Number(isl.id) }, isl.site_code, async (client) => {
        const g = (await client.query(`SELECT * FROM hw_malzeme_islem WHERE id = $1`, [isl.id])).rows[0];
        const t = await tersYaz(client, req, g, gerekce);
        const yansima = g.tur === "KABUL" ? await rolloutYansit(client, g.site_code, g.kapsam) : null;
        return { ok: true, ters_islem_id: Number(t.id), rollout: yansima };
      });
      res.json(sonuc);
    } catch (e) { hata(res, e); }
  });

  // ── Kabul düzeltme: başlık alanları geçmişe yazılarak; kalem/miktar değişirse ters + yeni kabul (aynı işlemde) ──
  app.post("/hw-malzeme/islem/:id/duzelt", authMiddleware, async (req, res) => {
    try {
      hareketKapi(req);
      const b = req.body || {};
      const gerekce = temiz(b.gerekce, 1000);
      if (gerekce.length < 3) throw new HwHata("Düzeltme gerekçesini yazın");
      const isl = (await pool.query(`SELECT * FROM hw_malzeme_islem WHERE id = $1`, [Number(req.params.id) || 0])).rows[0];
      if (!isl) throw new HwHata("İşlem bulunamadı", 404);
      if (isl.tur !== "KABUL") throw new HwHata("Yalnız kabul kaydı düzeltilir; diğer hareketleri iptal edip yeniden girin");
      if (isl.ters_islem_id) throw new HwHata("İptal edilmiş kayıt düzeltilemez");
      await kapsamdaMi(req, isl.site_code);
      if (b.gelis_tarihi !== undefined && (!tarihMi(b.gelis_tarihi) || b.gelis_tarihi > bugun())) throw new HwHata("Geliş tarihi geçersiz");
      if (b.teslim_tipi !== undefined && !["KISMI", "TAM"].includes(b.teslim_tipi)) throw new HwHata("Teslim tipi geçersiz");
      const yeniKalem = Array.isArray(b.kalemler) ? kalemlerAyristir(b.kalemler) : null;
      const sonuc = await yaz(req, "duzelt", { id: Number(isl.id), b: { ...b, istek_anahtari: undefined } }, isl.site_code, async (client) => {
        const g = (await client.query(`SELECT * FROM hw_malzeme_islem WHERE id = $1`, [isl.id])).rows[0];
        if (g.ters_islem_id) throw new HwHata("Kayıt bu arada iptal edilmiş");
        const y = yapan(req);
        const eskiKal = (await client.query(`SELECT anahtar, miktar FROM hw_malzeme_islem_kalem WHERE islem_id = $1 ORDER BY anahtar`, [g.id])).rows.map((k) => [k.anahtar, Number(k.miktar)]);
        const kalemDegisti = yeniKalem && JSON.stringify(eskiKal) !== JSON.stringify(yeniKalem.map((k) => [k.anahtar, k.miktar]).sort((a, c) => a[0].localeCompare(c[0])));
        const alanlar = { teslim_tipi: b.teslim_tipi, islem_tarihi: b.gelis_tarihi, aciklama: b.aciklama !== undefined ? temiz(b.aciklama, 1000) || null : undefined,
          eksik_aciklama: b.eksik_aciklama !== undefined ? temiz(b.eksik_aciklama, 1000) || null : undefined,
          belgeler: Array.isArray(b.belgeler) ? b.belgeler.slice(0, 20).filter((x) => /^https?:\/\//i.test(String(x?.url || ""))).map((x) => ({ url: temiz(x.url, 1000), ad: temiz(x.ad, 200) || null, tur: temiz(x.tur, 40) || null })) : undefined };
        const sonTip = alanlar.teslim_tipi || g.teslim_tipi;
        const sonEksik = alanlar.eksik_aciklama !== undefined ? alanlar.eksik_aciklama : g.eksik_aciklama;
        if (sonTip === "KISMI" && !sonEksik) throw new HwHata("Kısmi teslimde eksik kalan malzemeyi yazın");
        let hedefIslem = g;
        if (kalemDegisti) {
          // Miktar düzeltmesi: eski kabul ters edilir, düzeltilmiş kabul yeni kayıt olur (iki kayıt da geçmişte görünür)
          await tersYaz(client, req, g, gerekce, true);
          const yeni = await islemEkle(client, req, { tur: "KABUL", site_code: g.site_code, kapsam: g.kapsam, kaynak_tip: "HUAWEI", hedef_tip: "DEPO", hedef_id: g.hedef_id,
            islem_tarihi: alanlar.islem_tarihi || gunStr(g.islem_tarihi), teslim_tipi: sonTip, eksik_aciklama: sonTip === "KISMI" ? sonEksik : null,
            aciklama: alanlar.aciklama !== undefined ? alanlar.aciklama : g.aciklama, belgeler: alanlar.belgeler || g.belgeler || [], eski_kayit_teyidi: g.eski_kayit_teyidi,
            duzeltilen_islem_id: g.id, gerekce, kalemler: yeniKalem });
          await client.query(`INSERT INTO hw_malzeme_gecmis (islem_id, alan, eski, yeni, gerekce, yapan_email, yapan_ad) VALUES ($1,'kalemler',$2,$3,$4,$5,$6)`,
            [yeni.id, JSON.stringify(eskiKal), JSON.stringify(yeniKalem.map((k) => [k.anahtar, k.miktar])), gerekce, y.email, y.ad]);
          hedefIslem = yeni;
        } else {
          const set = [], val = [g.id];
          for (const [alan, v] of Object.entries(alanlar)) {
            if (v === undefined) continue;
            const eski = alan === "islem_tarihi" ? gunStr(g[alan]) : g[alan];
            if (JSON.stringify(eski ?? null) === JSON.stringify(v ?? null)) continue;
            val.push(alan === "belgeler" ? JSON.stringify(v) : v); set.push(`${alan} = $${val.length}`);
            await client.query(`INSERT INTO hw_malzeme_gecmis (islem_id, alan, eski, yeni, gerekce, yapan_email, yapan_ad) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [g.id, alan, JSON.stringify(eski ?? null), JSON.stringify(v ?? null), gerekce, y.email, y.ad]);
          }
          if (sonTip === "TAM" && g.eksik_aciklama && alanlar.eksik_aciklama === undefined) { val.push(null); set.push(`eksik_aciklama = $${val.length}`); }
          if (!set.length) throw new HwHata("Değişiklik yok");
          await client.query(`UPDATE hw_malzeme_islem SET ${set.join(", ")} WHERE id = $1`, val);
        }
        const yansima = await rolloutYansit(client, g.site_code, g.kapsam);
        return { ok: true, islem_id: Number(hedefIslem.id), kalem_duzeltmesi: !!kalemDegisti, rollout: yansima };
      });
      res.json(sonuc);
    } catch (e) { hata(res, e); }
  });

  // ── Belge / fotoğraf yükleme (kabul formu) ──
  if (deps.upload && deps.uploadToStorage) app.post("/hw-malzeme/belge", authMiddleware, deps.upload.single("dosya"), async (req, res) => {
    try {
      hareketKapi(req);
      const f = req.file;
      if (!f) throw new HwHata("Dosya seçin");
      if (f.size > 15 * 1024 * 1024) throw new HwHata("Dosya en çok 15 MB olabilir");
      if (!/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/i.test(f.mimetype || "")) throw new HwHata("Yalnız fotoğraf (JPG/PNG/WEBP/HEIC) ya da PDF");
      const ad = temiz(f.originalname || "belge", 120).replace(/[^\w.\-]+/g, "_");
      const { url } = await deps.uploadToStorage("hw-malzeme-belge", ad, f.buffer, f.mimetype);
      res.json({ ok: true, belge: { url, ad: f.originalname || ad, tur: /pdf/i.test(f.mimetype) ? "PDF" : "FOTO" } });
    } catch (e) { hata(res, e); }
  });

  // ── Depo özeti: fiziksel saha / iş kaydı / malzeme miktarı AYRI ──
  app.get("/hw-malzeme/depo-ozet", authMiddleware, async (req, res) => {
    try {
      goruntuleKapi(req); await sema();
      const k = await deps.kapsamIsKodlari(req);
      const kodlar = (await pool.query(`SELECT DISTINCT site_code FROM hw_malzeme_islem`)).rows.map((x) => x.site_code).filter((x) => k.kodlar.has(x));
      const eskiler = [...k.rows.values()].filter((r) => r.malzeme_gelis_tarihi && !kodlar.includes(kodTemizle(r.site_code))).map((r) => kodTemizle(r.site_code));
      const montajMap = deps.montajFiili ? await deps.montajFiili([...kodlar, ...eskiler]) : new Map();
      const ekipAd = await ekipAdlari(pool);
      const d = await durumHaritasi(pool, [...kodlar, ...eskiler], { rows: k.rows, montajMap, ekipAd });
      const isler = [...d.entries()].map(([kod, x]) => { const r = k.rows.get(kod); return { site_code: kod, fiziksel_id: deps.fizikselSaha(kod)?.fiziksel_id || kod,
        bolge: r?.bolge || null, il: r?.il || null, site_type: r?.site_type || null, montaj: montajMap.get(kod) || null, ...x }; });
      const grup = (f) => { const l = isler.filter(f); return { is_kaydi: l.length, fiziksel_saha: new Set(l.map((x) => x.fiziksel_id)).size, malzeme_miktari: yuvarla(l.reduce((a, x) => a + x.depoda + x.ekipte.reduce((s, e) => s + e.miktar, 0), 0)) }; };
      res.json({ ok: true, ozet: {
        depoda_montaj_bekliyor: grup((x) => x.konum === "DEPODA" && x.teslim === "TAM" && !x.montaj_basladi),
        depoda_kismi: grup((x) => x.konum === "DEPODA" && x.teslim === "KISMI"),
        ekipte: grup((x) => x.konum === "EKIPTE"), kismen_ekip_depo: grup((x) => x.konum === "KISMEN_EKIP_DEPO"),
        kullanildi: grup((x) => x.konum === "KULLANILDI"), iade: grup((x) => x.konum === "IADE"), eski_teyit: grup((x) => x.konum === "ESKI_TEYIT") },
        aciklama: "Fiziksel saha = Site ID (KA3737); iş kaydı = tam iş kodu (KA3737_NR700_MWA); malzeme miktarı = kalem adetlerinin toplamı (farklı birimler toplanır, yalnız büyüklük göstergesidir).",
        isler });
    } catch (e) { hata(res, e); }
  });

  // ── Eski kayıt teyit listesi: Rollout'ta yalnız geliş tarihi olan işler + yansıma çelişkileri ──
  app.get("/hw-malzeme/teyit-listesi", authMiddleware, async (req, res) => {
    try {
      goruntuleKapi(req); await sema();
      const k = await deps.kapsamIsKodlari(req);
      const kayitli = new Set((await pool.query(`SELECT DISTINCT site_code FROM hw_malzeme_islem`)).rows.map((x) => x.site_code));
      const eskiler = [...k.rows.values()].filter((r) => (r.malzeme_gelis_tarihi || r.enh_malzeme_gelis_tarihi) && !kayitli.has(kodTemizle(r.site_code)));
      const montajMap = deps.montajFiili ? await deps.montajFiili(eskiler.map((r) => kodTemizle(r.site_code))) : new Map();
      const liste = eskiler.map((r) => {
        const kod = kodTemizle(r.site_code), m = montajMap.get(kod);
        // Kanıta göre öneri (kayıt YAZILMAZ): montaj bitmişse "kullanılmış olabilir", başladıysa "sahada/ekipte olabilir", yoksa teyit
        const oneri = m?.kod === "TAMAMLANDI" ? { kod: "KULLANILMIS_OLABILIR", ad: "Montaj tamamlanmış — malzeme büyük olasılıkla kullanıldı (teyit edin)" }
          : m?.kod === "DEVAM" ? { kod: "SAHADA_OLABILIR", ad: "Montaj başlamış — malzeme ekipte / sahada olabilir (teyit edin)" }
          : { kod: "TEYIT", ad: "Tamlık ve bulunduğu yer bilinmiyor — depoda sayım ile teyit edin" };
        return { site_code: kod, fiziksel_id: deps.fizikselSaha(kod)?.fiziksel_id || kod, bolge: r.bolge || null, il: r.il || null,
          malzeme_gelis_tarihi: gunStr(r.malzeme_gelis_tarihi), enh_malzeme_gelis_tarihi: gunStr(r.enh_malzeme_gelis_tarihi), malzeme_status: r.malzeme_status ?? null, montaj: m || null, oneri };
      }).sort((a, c) => a.site_code.localeCompare(c.site_code));
      const celiskiler = (await pool.query(`SELECT site_code, kapsam, celiski, updated_at FROM hw_malzeme_rollout_yansima WHERE celiski IS NOT NULL`)).rows.filter((x) => k.kodlar.has(x.site_code));
      res.json({ ok: true, eski_kayitlar: liste, celiskiler, ozet: { is_kaydi: liste.length, fiziksel_saha: new Set(liste.map((x) => x.fiziksel_id)).size } });
    } catch (e) { hata(res, e); }
  });

  // ── Seçenekler: depolar, ekipler (kapsamdaki) ──
  app.get("/hw-malzeme/secenekler", authMiddleware, async (req, res) => {
    try {
      goruntuleKapi(req);
      const depolar = (await pool.query(`SELECT id, ad, bolge, tur FROM ofis_depo WHERE UPPER(COALESCE(durum,'AKTİF')) <> 'PASİF' ORDER BY (tur ILIKE '%depo%') DESC, id`).catch(() => ({ rows: [] }))).rows;
      const e = (await pool.query(`SELECT ekip_no, ad, bolge, ekip_turu, bagli_firma, COALESCE(aktif,true) AS aktif FROM ekipler WHERE COALESCE(aktif,true) ORDER BY ad`).catch(() => ({ rows: [] }))).rows;
      const ekipler = [];
      for (const x of e) if (await deps.ekipKapsamda(req, x)) ekipler.push({ ekip_no: x.ekip_no, ad: x.ad, bolge: x.bolge, ekip_tipi: ekipTipi(x) });
      // 05.11.2026: teslim / devirde seçilebilecek araçlar (kapsamdaki aktif araçlar) + kurulum durumu
      const araclar = deps.aracListesi ? await deps.aracListesi(req).catch(() => []) : [];
      res.json({ ok: true, depolar, ekipler, araclar, arac_baglantisi_hazir: await aracKolonuVar(pool), hareket_yetkisi: !!deps.yetki.hareket(req) });
    } catch (e) { hata(res, e); }
  });
}

// Ekip tipi YALNIZ ekip kaydından: IC → inhouse, DIS → taşeron, boş → tanımlanmadı (isimden tahmin yok)
function ekipTipi(e) {
  const t = String(e?.ekip_turu || "").toUpperCase();
  return t === "IC" ? { kod: "INHOUSE", ad: "Inhouse" } : t === "DIS" ? { kod: "TASERON", ad: "Taşeron" } : { kod: "TANIMSIZ", ad: "Ekip tipi tanımlanmadı" };
}

module.exports = { kur, semaKur, aracKolonuVar, durumHesapla, durumHaritasi, bakiyeler, kalemlerAyristir, kalemAnahtari, miktar, rolloutYansit, ekipTipi, ekipAdlari, HwHata, TUR_TR, LOK_TR };
