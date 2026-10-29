// ═══ MALZEME STOK DEFTERİ (29.10.2026, Orhan — sarf malzeme stok takibi, 02.11.2026 sahada kullanım) ═══════════════
// Tek stok hareket kaynağı: malzeme_hareket (silinmez, değiştirilmez) + malzeme_bakiye (hareketlerin anlık toplamı, aynı
// transaction'da güncellenir; uzlaştırma aracı ikisinin eşitliğini denetler). Eski depo_stok / sarf_kullanim /
// malzeme_dagitim tabloları GEÇMİŞ olarak okunur; stok hesabına katılmaz, kendiliğinden dönüştürülmez.
//
// Akış: Depo → Personel stoğu → Sahada tüketim / Onaylı depo iadesi
//   GIRIS / mal kabul  : DIŞ → DEPO
//   TESLIM             : DEPO → PERSONEL          (depodan teslim anında düşer, personelde hemen kullanılabilir)
//   TUKETIM            : PERSONEL → SAHA          (kısmi tüketimde kalan personelde kalır; depoya dönmez)
//   IADE_TALEP         : PERSONEL → IADE(personel) (depo henüz artmaz; ayrılan miktar ikinci kez kullanılamaz)
//   IADE_ONAY          : IADE → DEPO              (depo fiziksel teslim alıp onaylar)
//   IADE_RED / IPTAL   : IADE → PERSONEL          (ayrılan miktar yeniden kullanılabilir)
//   REZERVE            : DEPO → REZERV(rez.)      (fiziksel tüketim değil; depoda durur ama kullanılabilir değildir)
//   REZERV_TESLIM      : REZERV → PERSONEL        (rezervasyondan teslim; depodan ikinci kez düşmez)
//   REZERV_IPTAL       : REZERV → DEPO
//   ACILIS             : AÇILIŞ → DEPO / PERSONEL (onaylı sayım; depo başına bir kez)
//   SAYIM_DUZELTME     : DÜZELTME ↔ DEPO / PERSONEL (gerekçeli)
//   TERS               : bir hareketin tersine kaydı (yetkili + gerekçe); orijinal silinmez
// Miktarlar ürünün TEMEL BİRİMİNDE, 3 ondalık hassasiyetle tutulur. Kutu → adet gibi dönüşüm yalnız tanımlı katsayıyla.
// Maliyet: bu sürüm DEĞERLEME YAPMAZ. Mal kabul satırına o günkü alış fiyatı (talep kalemindeki) anlık görüntü olarak
// yazılır; geçmiş tüketimler güncel fiyatla yeniden hesaplanmaz. Fiyat yalnız fiyat yetkilisine döner.
//
// Kimlik her zaman oturumdan (JWT). Personel yalnız kendi stoğunda işlem yapar; istemcinin gönderdiği personel / firma
// bilgisine güvenilmez. Her yazma isteği istek_anahtari ister: aynı anahtar ikinci kez işlenmez (malzeme_istek, kalıcı).

const crypto = require("crypto");

const BIRIMLER = ["Adet", "Metre", "Kg", "Litre", "Kutu", "Paket", "Rulo", "Takım", "Top", "Çift", "M²", "M³"];
const TAM_SAYI_BIRIMLER = ["adet", "kutu", "paket", "rulo", "takım", "top", "çift"];
const TAKIPLI = ["DEPO", "PERSONEL", "IADE", "REZERV", "SAHA"]; // bakiyesi tutulan lokasyonlar
const HAREKET_TURLERI = ["ACILIS", "GIRIS", "TESLIM", "TUKETIM", "IADE_TALEP", "IADE_ONAY", "IADE_RED", "IADE_IPTAL",
  "REZERVE", "REZERV_TESLIM", "REZERV_IPTAL", "SAYIM_DUZELTME", "TERS"];
const TUR_TR = { ACILIS: "Açılış sayımı", GIRIS: "Depoya giriş", TESLIM: "Personele teslim", TUKETIM: "Sahada tüketim",
  IADE_TALEP: "İade talebi", IADE_ONAY: "İade onayı (depoya giriş)", IADE_RED: "İade reddi", IADE_IPTAL: "İade talebi iptali",
  REZERVE: "Rezervasyon", REZERV_TESLIM: "Rezervasyondan teslim", REZERV_IPTAL: "Rezervasyon iptali",
  SAYIM_DUZELTME: "Sayım düzeltmesi", TERS: "Ters kayıt (düzeltme)" };
const LOK_TR = { DEPO: "Depo", PERSONEL: "Personel", IADE: "İade bekleyen", REZERV: "Rezerve", SAHA: "Saha", DIS: "Dış (tedarik)",
  ACILIS: "Açılış sayımı", DUZELTME: "Sayım farkı" };
const SENTETIK_ZIMMET = 900000000; // eski uygulamalara sentetik "üzerimdeki" satır kimliği: 900000000 + ürün id
const SENTETIK_IADE = 800000000;   // eski uygulamalara bekleyen iade satır kimliği: 800000000 + iade id

class StokHatasi extends Error {
  constructor(mesaj, http = 400, ek = null) { super(mesaj); this.http = http; this.ek = ek; }
}

// ── Miktar ayrıştırma: "12,5" / "12.5" / "1.234,5" → "12.500" (string, 3 ondalık). Geçersiz → StokHatasi ──────────
function miktarAyristir(v, alan = "Miktar") {
  if (v === null || v === undefined || v === "") throw new StokHatasi(`${alan} zorunlu`);
  let s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v).trim().replace(/\s+/g, "");
  if (typeof v !== "number") {
    if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", "."); // 1.234,5 → 1234.5
    else if (s.includes(",")) { if ((s.match(/,/g) || []).length > 1) throw new StokHatasi(`${alan} geçersiz: ${v}`); s = s.replace(",", "."); }
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, ""); // 1.234.567 → 1234567
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new StokHatasi(`${alan} geçersiz: ${v}`);
  const [tam, ond = ""] = s.replace(/^-/, "").split(".");
  if (ond.length > 3 && /[1-9]/.test(ond.slice(3))) throw new StokHatasi(`${alan} en fazla 3 ondalık basamak olabilir: ${v}`);
  if (s.startsWith("-")) throw new StokHatasi(`${alan} negatif olamaz`);
  const norm = `${tam.replace(/^0+(?=\d)/, "")}.${(ond + "000").slice(0, 3)}`;
  if (Number(norm) <= 0) throw new StokHatasi(`${alan} sıfırdan büyük olmalı`);
  if (tam.length > 10) throw new StokHatasi(`${alan} çok büyük: ${v}`);
  return norm;
}
const n3 = (v) => (v === null || v === undefined ? 0 : Math.round(Number(v) * 1000) / 1000);
const sahaNorm = (s) => String(s || "").replace(/\s+/g, "").toUpperCase();
const metin = (s, max = 1000) => (s === null || s === undefined ? "" : String(s).trim().slice(0, max));
const gunGecerli = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) && !Number.isNaN(new Date(d + "T00:00:00Z").getTime());
// pg DATE kolonu yerel gece yarısı Date döner: toISOString bir gün geri kayar → yerel bileşenlerle YYYY-AA-GG
const gunStr = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : String(v || "").slice(0, 10));
const bugunTR = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });

async function semaKur(pool) {
  const q = (s) => pool.query(s);
  await q(`CREATE TABLE IF NOT EXISTS malzeme_urun (
    id SERIAL PRIMARY KEY, kod TEXT NOT NULL, ad TEXT NOT NULL, temel_birim TEXT NOT NULL,
    tam_sayi BOOLEAN NOT NULL DEFAULT false, tur TEXT NOT NULL DEFAULT 'SARF' CHECK (tur IN ('SARF','EKIPMAN')),
    kategori TEXT, min_stok NUMERIC(14,3) CHECK (min_stok IS NULL OR min_stok >= 0), aktif BOOLEAN NOT NULL DEFAULT true,
    eski_adlar TEXT[] NOT NULL DEFAULT '{}', fiyat_listesi_id INTEGER, aciklama TEXT, olusturan TEXT,
    created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now())`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS malzeme_urun_kod_uq ON malzeme_urun (UPPER(kod))`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS malzeme_urun_ad_uq ON malzeme_urun (UPPER(ad))`);
  await q(`CREATE TABLE IF NOT EXISTS malzeme_urun_birim (
    id SERIAL PRIMARY KEY, urun_id INTEGER NOT NULL REFERENCES malzeme_urun(id), birim TEXT NOT NULL,
    katsayi NUMERIC(14,6) NOT NULL CHECK (katsayi > 0), olusturan TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS malzeme_urun_birim_uq ON malzeme_urun_birim (urun_id, LOWER(birim))`);
  await q(`CREATE TABLE IF NOT EXISTS malzeme_depo (
    id SERIAL PRIMARY KEY, kod TEXT NOT NULL, ad TEXT NOT NULL, firma TEXT NOT NULL DEFAULT 'ERC', aktif BOOLEAN NOT NULL DEFAULT true,
    acilis_id INTEGER, acilis_tarihi DATE, olusturan TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS malzeme_depo_kod_uq ON malzeme_depo (UPPER(kod))`);
  await q(`CREATE TABLE IF NOT EXISTS malzeme_hareket (
    id BIGSERIAL PRIMARY KEY,
    tur TEXT NOT NULL CHECK (tur IN ('ACILIS','GIRIS','TESLIM','TUKETIM','IADE_TALEP','IADE_ONAY','IADE_RED','IADE_IPTAL',
      'REZERVE','REZERV_TESLIM','REZERV_IPTAL','SAYIM_DUZELTME','TERS')),
    urun_id INTEGER NOT NULL REFERENCES malzeme_urun(id),
    miktar NUMERIC(14,3) NOT NULL CHECK (miktar > 0),
    girilen_miktar NUMERIC(14,3), girilen_birim TEXT,
    kaynak_tip TEXT NOT NULL, kaynak_id TEXT, hedef_tip TEXT NOT NULL, hedef_id TEXT,
    depo_id INTEGER, personel_id INTEGER, saha_kodu TEXT, firma TEXT,
    islem_tarihi DATE NOT NULL DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    islem_yapan_user_id INTEGER, islem_yapan_email TEXT, islem_yapan_ad TEXT,
    aciklama TEXT, belge_tip TEXT, belge_id TEXT, belge_no TEXT,
    iade_id INTEGER, rezervasyon_id INTEGER, acilis_id INTEGER, talep_id INTEGER, talep_kalem_id INTEGER,
    ters_edilen_id BIGINT, ters_hareket_id BIGINT, birim_fiyat NUMERIC(14,4), istek_anahtari TEXT)`);
  for (const ix of ["urun_id", "personel_id", "saha_kodu", "depo_id", "islem_tarihi", "talep_kalem_id", "tur"])
    await q(`CREATE INDEX IF NOT EXISTS malzeme_hareket_${ix}_idx ON malzeme_hareket (${ix})`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS malzeme_hareket_ters_uq ON malzeme_hareket (ters_edilen_id) WHERE ters_edilen_id IS NOT NULL`);
  // Hareketler silinmez; yalnız ters kayıt bağlantısı (ters_hareket_id) bir kez yazılabilir
  await q(`CREATE OR REPLACE FUNCTION malzeme_hareket_koru() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'malzeme_hareket kayıtları silinemez (ters kayıt kullanın)'; END IF;
      IF OLD.ters_hareket_id IS NULL AND NEW.ters_hareket_id IS NOT NULL
         AND (to_jsonb(NEW) - 'ters_hareket_id') = (to_jsonb(OLD) - 'ters_hareket_id') THEN RETURN NEW; END IF;
      RAISE EXCEPTION 'malzeme_hareket kayıtları değiştirilemez (ters kayıt kullanın)';
    END $f$`);
  await q(`DROP TRIGGER IF EXISTS malzeme_hareket_koru_trg ON malzeme_hareket`);
  await q(`CREATE TRIGGER malzeme_hareket_koru_trg BEFORE UPDATE OR DELETE ON malzeme_hareket FOR EACH ROW EXECUTE FUNCTION malzeme_hareket_koru()`);
  await q(`CREATE TABLE IF NOT EXISTS malzeme_bakiye (
    lok_tip TEXT NOT NULL, lok_id TEXT NOT NULL, urun_id INTEGER NOT NULL REFERENCES malzeme_urun(id),
    miktar NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (miktar >= 0), updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (lok_tip, lok_id, urun_id))`);
  await q(`CREATE TABLE IF NOT EXISTS malzeme_iade (
    id SERIAL PRIMARY KEY, personel_id INTEGER NOT NULL, urun_id INTEGER NOT NULL REFERENCES malzeme_urun(id),
    miktar NUMERIC(14,3) NOT NULL CHECK (miktar > 0), depo_id INTEGER, firma TEXT,
    durum TEXT NOT NULL DEFAULT 'BEKLIYOR' CHECK (durum IN ('BEKLIYOR','ONAYLANDI','REDDEDILDI','IPTAL')),
    talep_aciklama TEXT, talep_eden_email TEXT, talep_tarihi TIMESTAMPTZ DEFAULT now(),
    karar_veren_email TEXT, karar_veren_ad TEXT, karar_tarihi TIMESTAMPTZ, karar_aciklama TEXT,
    talep_hareket_id BIGINT, karar_hareket_id BIGINT, kaynak TEXT)`);
  await q(`CREATE INDEX IF NOT EXISTS malzeme_iade_durum_idx ON malzeme_iade (durum, personel_id)`);
  await q(`CREATE TABLE IF NOT EXISTS malzeme_rezervasyon (
    id SERIAL PRIMARY KEY, depo_id INTEGER NOT NULL, urun_id INTEGER NOT NULL REFERENCES malzeme_urun(id),
    miktar NUMERIC(14,3) NOT NULL CHECK (miktar > 0), personel_id INTEGER, talep_id INTEGER, talep_kalem_id INTEGER,
    durum TEXT NOT NULL DEFAULT 'ACIK' CHECK (durum IN ('ACIK','KAPANDI','IPTAL')), aciklama TEXT, olusturan TEXT,
    created_at TIMESTAMPTZ DEFAULT now(), kapanis_tarihi TIMESTAMPTZ)`);
  await q(`CREATE TABLE IF NOT EXISTS malzeme_istek (
    kullanici TEXT NOT NULL, anahtar TEXT NOT NULL, uc TEXT NOT NULL, govde_ozet TEXT NOT NULL, sonuc JSONB,
    created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (kullanici, anahtar))`);
  await q(`CREATE TABLE IF NOT EXISTS malzeme_acilis (
    id SERIAL PRIMARY KEY, depo_id INTEGER NOT NULL, sayim_tarihi DATE NOT NULL,
    durum TEXT NOT NULL DEFAULT 'TASLAK' CHECK (durum IN ('TASLAK','UYGULANDI','IPTAL')),
    aciklama TEXT, kaynak_dosya TEXT, satir_sayisi INTEGER, hata_sayisi INTEGER, icerik_ozet TEXT,
    olusturan_email TEXT, olusturma TIMESTAMPTZ DEFAULT now(), onaylayan_email TEXT, onay_tarihi TIMESTAMPTZ, iptal_aciklama TEXT)`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS malzeme_acilis_depo_uq ON malzeme_acilis (depo_id) WHERE durum = 'UYGULANDI'`);
  await q(`CREATE TABLE IF NOT EXISTS malzeme_acilis_satir (
    id SERIAL PRIMARY KEY, acilis_id INTEGER NOT NULL REFERENCES malzeme_acilis(id), satir_no INTEGER NOT NULL, ham JSONB,
    urun_id INTEGER, lok_tip TEXT, personel_id INTEGER, girilen_miktar NUMERIC(14,3), girilen_birim TEXT, miktar NUMERIC(14,3), hata TEXT)`);
  await q(`ALTER TABLE malzeme_talep_kalemleri ADD COLUMN IF NOT EXISTS urun_id INTEGER`);
  for (const t of ["malzeme_urun", "malzeme_urun_birim", "malzeme_depo", "malzeme_hareket", "malzeme_bakiye", "malzeme_iade",
    "malzeme_rezervasyon", "malzeme_istek", "malzeme_acilis", "malzeme_acilis_satir"])
    await q(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
}

function kur(app, c) {
  const { pool, authMiddleware, optionalAuth, kendiPersonelKaydi, tenantContext, malzemeDepoYetkili, malzemeTamOkuma,
    malzemeFiyatYetkili, taseronMu, personelSahaKapsami } = c;
  const ExcelJS = require("exceljs");
  const stokOnayYetkili = (u) => (c.stokOnayYetkili ? c.stokOnayYetkili(u) : malzemeFiyatYetkili(u)); // ters kayıt, açılış onayı, depo tanımı, fazla kabul
  // Firma kapsamı (29.10.2026): alt marka yönetimi (Teknocenter) yalnız kendi firmasının deposu / personeli / hareketleriyle çalışır
  const fkOf = (req) => (c.firmaKapsami ? c.firmaKapsami(req.user) : null);
  const kapsamKontrol = (req, firma, ne) => { const fk = fkOf(req); if (fk && String(firma || "ERC").toUpperCase() !== fk) throw new StokHatasi(`${ne} firma kapsamınızda değil`, 403); };
  const kullaniciAnahtari = (u) => String(u?.user_id || u?.id || "") + ":" + String(u?.email || "").toLowerCase().trim();
  const testHataAcik = process.env.MALZEME_TEST_HATA === "1" && process.env.NODE_ENV !== "production";

  let semaHazir = null;
  const sema = () => (semaHazir = semaHazir || semaKur(pool).catch((e) => { semaHazir = null; throw e; }));
  sema().catch((e) => console.error("[malzeme-stok şema]", e.message));

  // ── Transaction: ERC havuzunda ayrı bağlantı; izole kiracıda modül kapalı ─────────────────────────────────────────
  async function islem(fn) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const sonuc = await fn(client);
      await client.query("COMMIT");
      return sonuc;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      if (e && e.code === "40P01") throw new StokHatasi("Eşzamanlı işlem çakıştı; işlem yapılmadı, tekrar deneyin", 409);
      if (e && e.code === "23514" && /malzeme_bakiye/.test(e.message || "")) throw new StokHatasi("Yetersiz stok: işlem stoğu eksiye düşürüyordu, yapılmadı", 409);
      throw e;
    } finally { client.release(); }
  }

  // ── Bakiye hareketi: tüm kova değişiklikleri sıralı uygulanır (kilit sırası sabit → kilitlenme azalır) ──────────
  async function hareketleriUygula(db, hareketler, req) {
    const delta = new Map();
    for (const h of hareketler) {
      if (!HAREKET_TURLERI.includes(h.tur)) throw new StokHatasi("Geçersiz hareket türü: " + h.tur);
      if (!(Number(h.miktar) > 0)) throw new StokHatasi("Hareket miktarı sıfırdan büyük olmalı");
      const ekle = (tip, id, isaret) => {
        if (!TAKIPLI.includes(tip)) return;
        const k = `${tip}|${id}|${h.urun_id}`;
        const e = delta.get(k) || { tip, id: String(id), urun_id: h.urun_id, dus: 0n, art: 0n };
        const m = BigInt(Math.round(Number(h.miktar) * 1000));
        if (isaret < 0) e.dus += m; else e.art += m;
        delta.set(k, e);
      };
      ekle(h.kaynak_tip, h.kaynak_id, -1);
      ekle(h.hedef_tip, h.hedef_id, +1);
    }
    const sirali = [...delta.values()].sort((a, b) => (a.tip + "|" + a.id + "|" + a.urun_id).localeCompare(b.tip + "|" + b.id + "|" + b.urun_id));
    for (const e of sirali) {
      const net = e.art - e.dus;
      const m = (x) => { const s = (x < 0n ? -x : x).toString().padStart(4, "0"); return `${s.slice(0, -3)}.${s.slice(-3)}`; };
      if (net < 0n) {
        const r = await db.query(`UPDATE malzeme_bakiye SET miktar = miktar - $4::numeric, updated_at = now()
          WHERE lok_tip = $1 AND lok_id = $2 AND urun_id = $3 AND miktar >= $4::numeric RETURNING miktar`, [e.tip, e.id, e.urun_id, m(net)]);
        if (!r.rows.length) {
          const mevcut = await db.query(`SELECT miktar FROM malzeme_bakiye WHERE lok_tip = $1 AND lok_id = $2 AND urun_id = $3`, [e.tip, e.id, e.urun_id]);
          const u = await db.query(`SELECT ad, temel_birim FROM malzeme_urun WHERE id = $1`, [e.urun_id]);
          const var_ = n3(mevcut.rows[0]?.miktar || 0);
          throw new StokHatasi(`Yetersiz stok: ${LOK_TR[e.tip] || e.tip} kullanılabilir miktarı ${var_} ${u.rows[0]?.temel_birim || ""}, istenen ${n3(m(net))} (${u.rows[0]?.ad || "ürün"})`, 409,
            { lokasyon: e.tip, lok_id: e.id, urun_id: e.urun_id, kullanilabilir: var_, istenen: n3(m(net)) });
        }
      } else if (net > 0n) {
        await db.query(`INSERT INTO malzeme_bakiye (lok_tip, lok_id, urun_id, miktar) VALUES ($1,$2,$3,$4::numeric)
          ON CONFLICT (lok_tip, lok_id, urun_id) DO UPDATE SET miktar = malzeme_bakiye.miktar + EXCLUDED.miktar, updated_at = now()`, [e.tip, e.id, e.urun_id, m(net)]);
      }
    }
    const u = req.user || {};
    const yazilan = [];
    for (let i = 0; i < hareketler.length; i++) {
      const h = hareketler[i];
      const r = await db.query(`INSERT INTO malzeme_hareket (tur, urun_id, miktar, girilen_miktar, girilen_birim, kaynak_tip, kaynak_id, hedef_tip, hedef_id,
          depo_id, personel_id, saha_kodu, firma, islem_tarihi, islem_yapan_user_id, islem_yapan_email, islem_yapan_ad, aciklama, belge_tip, belge_id, belge_no,
          iade_id, rezervasyon_id, acilis_id, talep_id, talep_kalem_id, ters_edilen_id, birim_fiyat, istek_anahtari)
        VALUES ($1,$2,$3::numeric,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14::date, CURRENT_DATE),$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29) RETURNING *`,
        [h.tur, h.urun_id, h.miktar, h.girilen_miktar || null, h.girilen_birim || null, h.kaynak_tip, h.kaynak_id == null ? null : String(h.kaynak_id),
          h.hedef_tip, h.hedef_id == null ? null : String(h.hedef_id), h.depo_id || null, h.personel_id || null, h.saha_kodu || null, h.firma || null,
          h.islem_tarihi || null, Number(u.user_id || u.id || 0) || null, String(u.email || "").toLowerCase() || null, u.name || null,
          h.aciklama || null, h.belge_tip || null, h.belge_id == null ? null : String(h.belge_id), h.belge_no || null, h.iade_id || null,
          h.rezervasyon_id || null, h.acilis_id || null, h.talep_id || null, h.talep_kalem_id || null, h.ters_edilen_id || null,
          h.birim_fiyat == null ? null : h.birim_fiyat, req._istekAnahtari || null]);
      yazilan.push(r.rows[0]);
      // Test kancası (yalnız yerel test ortamı, MALZEME_TEST_HATA=1): ilk hareketten sonra yapay hata → tümü geri alınmalı
      if (testHataAcik && req.headers["x-test-hata"] === "hareket-sonrasi" && i === 0) throw new Error("TEST: işlem ortasında yapay hata");
    }
    return yazilan;
  }

  // ── Ürün + birim çözümü: miktarı temel birime çevirir; tanımsız dönüşüm reddedilir ────────────────────────────────
  async function urunGetir(db, urunId, kilitle = false) {
    const id = Number(urunId);
    if (!Number.isInteger(id) || id <= 0) throw new StokHatasi("Ürün seçin (ürün kimliği geçersiz)");
    const r = await db.query(`SELECT * FROM malzeme_urun WHERE id = $1 ${kilitle ? "FOR SHARE" : ""}`, [id]);
    if (!r.rows.length) throw new StokHatasi("Ürün bulunamadı", 404);
    return r.rows[0];
  }
  async function temeleCevir(db, urun, girilen, birim) {
    const m = miktarAyristir(girilen);
    const b = metin(birim || urun.temel_birim, 30);
    let temel;
    if (b.toLocaleLowerCase("tr") === String(urun.temel_birim).toLocaleLowerCase("tr")) temel = m;
    else {
      const d = await db.query(`SELECT katsayi FROM malzeme_urun_birim WHERE urun_id = $1 AND LOWER(birim) = LOWER($2)`, [urun.id, b]);
      if (!d.rows.length) throw new StokHatasi(`"${urun.ad}" için ${b} → ${urun.temel_birim} dönüşümü tanımlı değil; miktarı ${urun.temel_birim} olarak girin ya da depo sorumlusu dönüşüm katsayısı tanımlasın`);
      const r = await db.query(`SELECT ROUND($1::numeric * $2::numeric, 3)::text AS t`, [m, d.rows[0].katsayi]);
      temel = r.rows[0].t;
      if (!(Number(temel) > 0)) throw new StokHatasi("Dönüştürülen miktar sıfır çıktı");
    }
    if (urun.tam_sayi && !/\.000$/.test(Number(temel).toFixed(3))) throw new StokHatasi(`"${urun.ad}" ${urun.temel_birim} cinsinden tam sayı olmalı (girilen ${n3(temel)})`);
    return { temel: Number(temel).toFixed(3), girilen: m, birim: b };
  }
  async function depoGetir(db, depoId) {
    const id = Number(depoId);
    if (!Number.isInteger(id) || id <= 0) throw new StokHatasi("Depo seçin");
    const r = await db.query(`SELECT * FROM malzeme_depo WHERE id = $1`, [id]);
    if (!r.rows.length) throw new StokHatasi("Depo bulunamadı", 404);
    const d = r.rows[0];
    if (!d.aktif) throw new StokHatasi("Depo pasif");
    return d;
  }
  const depoAcikMi = (d) => !!d.acilis_id;
  async function personelGetir(db, personelId) {
    const id = Number(personelId);
    if (!Number.isInteger(id) || id <= 0) throw new StokHatasi("Personel seçin");
    const r = await db.query(`SELECT id, ad_soyad, LOWER(TRIM(COALESCE(email,''))) AS email, UPPER(COALESCE(NULLIF(TRIM(marka),''),'ERC')) AS firma, aktif
      FROM personel WHERE id = $1`, [id]);
    if (!r.rows.length) throw new StokHatasi("Personel bulunamadı", 404);
    return r.rows[0];
  }
  // Saha kodu: rollout listesinde olmalı; alt marka personeli yalnız firma kapsamındaki ya da kendisine atanmış sahaya
  async function sahaDogrula(db, kod, personel) {
    const sc = sahaNorm(kod);
    if (!sc) throw new StokHatasi("Saha kodu zorunlu");
    if (!/^[A-Z0-9_\-./]{3,40}$/.test(sc)) throw new StokHatasi(`Saha kodu geçersiz: ${kod}`);
    const r = await db.query(`SELECT site_code FROM rollout_progress WHERE UPPER(REPLACE(TRIM(site_code),' ','')) = $1 LIMIT 1`, [sc]).catch(() => ({ rows: [] }));
    if (!r.rows.length) throw new StokHatasi(`Saha kodu sistemde bulunamadı: ${sc}. Listeden seçin.`);
    const K = await personelSahaKapsami(personel.firma);
    if (K) {
      const ic = await db.query(`SELECT 1 FROM rollout_progress r WHERE UPPER(REPLACE(TRIM(r.site_code),' ','')) = $1 AND ${K.sql("r", 2)} LIMIT 1`, [sc, ...K.params]).catch(() => ({ rows: [] }));
      const atanan = personel.email ? await db.query(`SELECT 1 FROM is_atama WHERE personeller @> $1::jsonb AND $2 = ANY(site_codes) LIMIT 1`,
        [JSON.stringify([{ email: personel.email }]), sc]).catch(() => ({ rows: [] })) : { rows: [] };
      if (!ic.rows.length && !atanan.rows.length) throw new StokHatasi(`Bu saha firmanızın kapsamında değil: ${sc}`, 403);
    }
    return sc;
  }

  // ── Tekrar isteğine karşı koruma: (kullanıcı, anahtar) kalıcı benzersiz; aynı anahtar → ilk sonucun aynısı ────────
  const ozet = (o) => crypto.createHash("sha256").update(JSON.stringify(o ?? {})).digest("hex");
  async function tekilIslem(req, res, uc, fn) {
    try {
      await sema();
      const anahtar = metin(req.headers["idempotency-key"] || req.body?.istek_anahtari, 120);
      if (!anahtar || anahtar.length < 8) throw new StokHatasi("istek_anahtari zorunlu (tekrar gönderimde çift kayıt olmaması için)");
      const kul = kullaniciAnahtari(req.user);
      const govde = { ...(req.body || {}) }; delete govde.istek_anahtari;
      const go = ozet({ uc, govde });
      req._istekAnahtari = anahtar;
      const sonuc = await islem(async (db) => {
        const ins = await db.query(`INSERT INTO malzeme_istek (kullanici, anahtar, uc, govde_ozet) VALUES ($1,$2,$3,$4)
          ON CONFLICT (kullanici, anahtar) DO NOTHING RETURNING kullanici`, [kul, anahtar, uc, go]);
        if (!ins.rows.length) {
          const eski = await db.query(`SELECT uc, govde_ozet, sonuc FROM malzeme_istek WHERE kullanici = $1 AND anahtar = $2`, [kul, anahtar]);
          const e = eski.rows[0];
          if (!e || e.uc !== uc || e.govde_ozet !== go) throw new StokHatasi("Bu istek anahtarı farklı bir işlem için kullanılmış", 409);
          return { ...(e.sonuc || {}), tekrar: true };
        }
        const s = await fn(db);
        await db.query(`UPDATE malzeme_istek SET sonuc = $3 WHERE kullanici = $1 AND anahtar = $2`, [kul, anahtar, JSON.stringify(s)]);
        return s;
      });
      res.json({ ok: true, ...sonuc });
    } catch (e) { hataDon(res, e); }
  }
  function hataDon(res, e) {
    if (e instanceof StokHatasi) return res.status(e.http).json({ ok: false, error: e.message, ...(e.ek ? { ayrinti: e.ek } : {}) });
    if (e && e.code === "23505") return res.status(409).json({ ok: false, error: "Aynı kayıt zaten var (benzersizlik kuralı)" });
    console.error("[malzeme-stok]", e);
    return res.status(500).json({ ok: false, error: "İşlem yapılamadı: " + (e?.message || "bilinmeyen hata") });
  }
  const yanit = (fn) => async (req, res) => { try { await sema(); await fn(req, res); } catch (e) { hataDon(res, e); } };

  // ── Yetki kapısı: /malzeme/stok/* — taşeron giremez, izole kiracıda modül kapalı; ayrıntılı kural her uçta ──────────
  const kapi = (kural) => (req, res, next) => authMiddleware(req, res, async () => {
    try {
      const u = req.user;
      if (tenantContext && tenantContext.getStore && tenantContext.getStore()) return res.status(403).json({ ok: false, error: "Stok defteri bu firma için henüz etkin değil" });
      if (taseronMu(u) || u.kullanici_tipi === "TASERON") return res.status(403).json({ ok: false, error: "Taşeron hesabı malzeme stok modülünü kullanamaz" });
      if (kural === "depo" && !malzemeDepoYetkili(u)) return res.status(403).json({ ok: false, error: "Depo işlemleri için yetkiniz yok" });
      if (kural === "onay" && !stokOnayYetkili(u)) return res.status(403).json({ ok: false, error: "Bu işlem yalnız yetkili yöneticiler tarafından yapılabilir" });
      if (kural === "rapor" && !(malzemeDepoYetkili(u) || malzemeTamOkuma(u, req))) return res.status(403).json({ ok: false, error: "Stok raporlarını görme yetkiniz yok" });
      if (kural === "personel" || kural === "personel-veya-depo") {
        const p = await kendiPersonelKaydi(u);
        if (p) req.benimPersonel = await personelGetir(pool, p.id);
        else if (kural === "personel-veya-depo" && malzemeDepoYetkili(u)) req.benimPersonel = null; // depo yetkilisi başkası adına girer
        else return res.status(403).json({ ok: false, error: "Personel kaydınız bulunamadı; İK'dan kullanıcı-personel eşleşmesini isteyin" });
      }
      next();
    } catch (e) { hataDon(res, e); }
  });

  const defterAcik = async (db = pool) => (await db.query(`SELECT 1 FROM malzeme_acilis WHERE durum = 'UYGULANDI' LIMIT 1`).catch(() => ({ rows: [] }))).rows.length > 0;

  // ═══ OKUMA ════════════════════════════════════════════════════════════════════════════════════════════════════
  app.get("/malzeme/stok/ayar", kapi(null), yanit(async (req, res) => {
    const u = req.user;
    const p = await kendiPersonelKaydi(u);
    const fk = fkOf(req);
    const depolar = (await pool.query(`SELECT id, kod, ad, firma, aktif, acilis_id, acilis_tarihi FROM malzeme_depo WHERE ($1::text IS NULL OR UPPER(firma) = $1) ORDER BY aktif DESC, kod`, [fk])).rows;
    res.json({ ok: true, defter_acik: await defterAcik(), depolar, birimler: BIRIMLER, hareket_turleri: TUR_TR, lokasyonlar: LOK_TR,
      yetki: { depo: malzemeDepoYetkili(u), onay: stokOnayYetkili(u), rapor: malzemeDepoYetkili(u) || malzemeTamOkuma(u, req), fiyat: malzemeFiyatYetkili(u), personel_id: p?.id || null, firma_kapsami: fk },
      maliyet_yontemi: "Bu sürümde stok değerlemesi yapılmaz; mal kabul satırında alış fiyatı anlık olarak saklanır. Geçmiş tüketimler güncel fiyatla yeniden hesaplanmaz." });
  }));

  app.get("/malzeme/stok/urunler", kapi(null), yanit(async (req, res) => {
    const q = metin(req.query.q, 80);
    const params = [];
    let w = "WHERE 1=1";
    if (req.query.aktif !== "hepsi") w += " AND u.aktif";
    if (q) { params.push(`%${q.toLocaleUpperCase("tr")}%`); w += ` AND (UPPER(u.ad) LIKE $${params.length} OR UPPER(u.kod) LIKE $${params.length} OR EXISTS (SELECT 1 FROM unnest(u.eski_adlar) a WHERE UPPER(a) LIKE $${params.length}))`; }
    const r = await pool.query(`SELECT u.id, u.kod, u.ad, u.temel_birim, u.tam_sayi, u.tur, u.kategori, u.min_stok, u.aktif, u.eski_adlar,
        COALESCE((SELECT json_agg(json_build_object('birim', b.birim, 'katsayi', b.katsayi) ORDER BY b.birim) FROM malzeme_urun_birim b WHERE b.urun_id = u.id), '[]') AS donusumler
      FROM malzeme_urun u ${w} ORDER BY u.ad LIMIT 500`, params);
    res.json({ ok: true, rows: r.rows.map((x) => ({ ...x, min_stok: x.min_stok == null ? null : n3(x.min_stok), donusumler: x.donusumler.map((d) => ({ ...d, katsayi: Number(d.katsayi) })) })) });
  }));

  // Teslim / filtre için personel listesi (yalnız ad, firma, bölge — maaş / iletişim / banka alanı yok)
  app.get("/malzeme/stok/personeller", kapi("rapor"), yanit(async (req, res) => {
    const r = await pool.query(`SELECT id, ad_soyad, UPPER(COALESCE(NULLIF(TRIM(marka),''),'ERC')) AS firma, bolge, unvan FROM personel
      WHERE aktif = true AND ($1::text IS NULL OR UPPER(COALESCE(NULLIF(TRIM(marka),''),'ERC')) = $1) ORDER BY ad_soyad LIMIT 2000`, [fkOf(req)]);
    res.json({ ok: true, rows: r.rows });
  }));

  // Ortak filtreler (rapor uçları): tarih, ürün, personel, saha, depo, firma, tür
  function filtre(req) {
    const f = {};
    if (gunGecerli(req.query.bas)) f.bas = req.query.bas;
    if (gunGecerli(req.query.bit)) f.bit = req.query.bit;
    for (const k of ["urun_id", "personel_id", "depo_id"]) if (Number(req.query[k]) > 0) f[k] = Number(req.query[k]);
    if (req.query.saha) f.saha = sahaNorm(req.query.saha);
    if (req.query.firma) f.firma = String(req.query.firma).trim().toUpperCase().slice(0, 20);
    if (req.query.tur && HAREKET_TURLERI.includes(String(req.query.tur))) f.tur = String(req.query.tur);
    const fk = fkOf(req); if (fk) f.firma = fk; // istemci firma filtresi kapsamı genişletemez
    return f;
  }

  async function urunOzeti(f) {
    const p = [];
    const ek = (v) => { p.push(v); return `$${p.length}`; };
    const depoKos = f.depo_id ? `AND b.lok_id = ${ek(String(f.depo_id))}` : "";
    const depoFirma = f.firma ? `AND EXISTS (SELECT 1 FROM malzeme_depo d WHERE d.id::text = b.lok_id AND UPPER(d.firma) = ${ek(f.firma)})` : "";
    const perKos = f.personel_id ? `AND b.lok_id = ${ek(String(f.personel_id))}` : "";
    const perFirma = f.firma ? `AND EXISTS (SELECT 1 FROM personel pp WHERE pp.id::text = b.lok_id AND UPPER(COALESCE(NULLIF(TRIM(pp.marka),''),'ERC')) = ${ek(f.firma)})` : "";
    const rezKos = (f.depo_id ? `AND EXISTS (SELECT 1 FROM malzeme_rezervasyon rz WHERE rz.id::text = b.lok_id AND rz.depo_id = ${ek(f.depo_id)})` : "")
      + (f.firma ? ` AND EXISTS (SELECT 1 FROM malzeme_rezervasyon rz JOIN malzeme_depo dz ON dz.id = rz.depo_id WHERE rz.id::text = b.lok_id AND UPPER(dz.firma) = ${ek(f.firma)})` : "");
    const tukKos = [f.bas ? `h.islem_tarihi >= ${ek(f.bas)}::date` : null, f.bit ? `h.islem_tarihi <= ${ek(f.bit)}::date` : null,
      f.personel_id ? `h.personel_id = ${ek(f.personel_id)}` : null, f.saha ? `h.saha_kodu = ${ek(f.saha)}` : null,
      f.firma ? `UPPER(COALESCE(h.firma,'')) = ${ek(f.firma)}` : null].filter(Boolean).join(" AND ");
    const urunKos = f.urun_id ? `AND u.id = ${ek(f.urun_id)}` : "";
    const r = await pool.query(`
      SELECT u.id AS urun_id, u.kod, u.ad, u.temel_birim, u.tur, u.kategori, u.min_stok, u.aktif,
        COALESCE((SELECT SUM(b.miktar) FROM malzeme_bakiye b WHERE b.urun_id = u.id AND b.lok_tip = 'DEPO' ${depoKos} ${depoFirma}),0) AS depo_kullanilabilir,
        COALESCE((SELECT SUM(b.miktar) FROM malzeme_bakiye b WHERE b.urun_id = u.id AND b.lok_tip = 'REZERV' ${rezKos}),0) AS rezerve,
        COALESCE((SELECT SUM(b.miktar) FROM malzeme_bakiye b WHERE b.urun_id = u.id AND b.lok_tip = 'PERSONEL' ${perKos} ${perFirma}),0) AS personel_kullanilabilir,
        COALESCE((SELECT SUM(b.miktar) FROM malzeme_bakiye b WHERE b.urun_id = u.id AND b.lok_tip = 'IADE' ${perKos} ${perFirma}),0) AS iade_bekleyen,
        COALESCE((SELECT SUM(CASE WHEN h.tur = 'TERS' THEN -h.miktar ELSE h.miktar END) FROM malzeme_hareket h
                  WHERE h.urun_id = u.id AND (h.hedef_tip = 'SAHA' OR h.kaynak_tip = 'SAHA') ${tukKos ? "AND " + tukKos : ""}),0) AS tuketilen
      FROM malzeme_urun u WHERE (u.aktif OR EXISTS (SELECT 1 FROM malzeme_bakiye b WHERE b.urun_id = u.id AND b.miktar > 0)) ${urunKos}
      ORDER BY u.ad`, p);
    return r.rows.map((x) => {
      const o = { ...x, min_stok: x.min_stok == null ? null : n3(x.min_stok) };
      for (const k of ["depo_kullanilabilir", "rezerve", "personel_kullanilabilir", "iade_bekleyen", "tuketilen"]) o[k] = n3(x[k]);
      o.depo_fiziksel = n3(o.depo_kullanilabilir + o.rezerve);
      o.personelde_toplam = n3(o.personel_kullanilabilir + o.iade_bekleyen);
      o.dusuk_stok = o.min_stok != null && o.depo_kullanilabilir < o.min_stok;
      return o;
    });
  }
  app.get("/malzeme/stok/ozet", kapi("rapor"), yanit(async (req, res) => res.json({ ok: true, rows: await urunOzeti(filtre(req)) })));

  async function personelStok(f) {
    const p = [];
    const ek = (v) => { p.push(v); return `$${p.length}`; };
    const w = [f.personel_id ? `x.personel_id = ${ek(f.personel_id)}` : null, f.urun_id ? `x.urun_id = ${ek(f.urun_id)}` : null,
      f.firma ? `UPPER(COALESCE(NULLIF(TRIM(pe.marka),''),'ERC')) = ${ek(f.firma)}` : null].filter(Boolean);
    const r = await pool.query(`
      WITH x AS (SELECT lok_id::int AS personel_id, urun_id,
          SUM(CASE WHEN lok_tip = 'PERSONEL' THEN miktar ELSE 0 END) AS kullanilabilir,
          SUM(CASE WHEN lok_tip = 'IADE' THEN miktar ELSE 0 END) AS iade_bekleyen
        FROM malzeme_bakiye WHERE lok_tip IN ('PERSONEL','IADE') GROUP BY lok_id, urun_id)
      SELECT x.personel_id, pe.ad_soyad, UPPER(COALESCE(NULLIF(TRIM(pe.marka),''),'ERC')) AS firma, pe.bolge,
        x.urun_id, u.kod, u.ad AS urun_ad, u.temel_birim, x.kullanilabilir, x.iade_bekleyen,
        COALESCE((SELECT SUM(CASE WHEN h.tur='TERS' THEN -h.miktar ELSE h.miktar END) FROM malzeme_hareket h WHERE h.personel_id = x.personel_id AND h.urun_id = x.urun_id
          AND (h.hedef_tip = 'SAHA' OR h.kaynak_tip = 'SAHA') ${f.bas ? `AND h.islem_tarihi >= ${ek(f.bas)}::date` : ""} ${f.bit ? `AND h.islem_tarihi <= ${ek(f.bit)}::date` : ""}),0) AS tuketilen
      FROM x JOIN personel pe ON pe.id = x.personel_id JOIN malzeme_urun u ON u.id = x.urun_id
      WHERE (x.kullanilabilir > 0 OR x.iade_bekleyen > 0) ${w.length ? "AND " + w.join(" AND ") : ""}
      ORDER BY pe.ad_soyad, u.ad`, p);
    return r.rows.map((x) => ({ ...x, kullanilabilir: n3(x.kullanilabilir), iade_bekleyen: n3(x.iade_bekleyen), toplam: n3(Number(x.kullanilabilir) + Number(x.iade_bekleyen)), tuketilen: n3(x.tuketilen) }));
  }
  app.get("/malzeme/stok/personel", kapi("rapor"), yanit(async (req, res) => res.json({ ok: true, rows: await personelStok(filtre(req)) })));

  async function sahaTuketim(f) {
    const p = [];
    const ek = (v) => { p.push(v); return `$${p.length}`; };
    const w = [f.bas ? `h.islem_tarihi >= ${ek(f.bas)}::date` : null, f.bit ? `h.islem_tarihi <= ${ek(f.bit)}::date` : null,
      f.urun_id ? `h.urun_id = ${ek(f.urun_id)}` : null, f.personel_id ? `h.personel_id = ${ek(f.personel_id)}` : null,
      f.saha ? `h.saha_kodu = ${ek(f.saha)}` : null, f.firma ? `UPPER(COALESCE(h.firma,'')) = ${ek(f.firma)}` : null].filter(Boolean);
    // Gerçek tüketim: TUKETIM hareketleri − ters kayıtları (SAHA'dan çıkan). İlk teslim miktarı DEĞİL.
    const r = await pool.query(`SELECT h.saha_kodu, h.urun_id, u.kod, u.ad AS urun_ad, u.temel_birim,
        SUM(CASE WHEN h.hedef_tip = 'SAHA' THEN h.miktar ELSE -h.miktar END) AS tuketilen, COUNT(*) FILTER (WHERE h.tur = 'TUKETIM') AS kayit_sayisi,
        MIN(h.islem_tarihi) AS ilk_tarih, MAX(h.islem_tarihi) AS son_tarih,
        string_agg(DISTINCT pe.ad_soyad, ', ') AS personeller
      FROM malzeme_hareket h JOIN malzeme_urun u ON u.id = h.urun_id LEFT JOIN personel pe ON pe.id = h.personel_id
      WHERE (h.hedef_tip = 'SAHA' OR h.kaynak_tip = 'SAHA') ${w.length ? "AND " + w.join(" AND ") : ""}
      GROUP BY h.saha_kodu, h.urun_id, u.kod, u.ad, u.temel_birim HAVING SUM(CASE WHEN h.hedef_tip = 'SAHA' THEN h.miktar ELSE -h.miktar END) <> 0
      ORDER BY h.saha_kodu, u.ad`, p);
    return r.rows.map((x) => ({ ...x, tuketilen: n3(x.tuketilen), kayit_sayisi: Number(x.kayit_sayisi) }));
  }
  app.get("/malzeme/stok/saha", kapi("rapor"), yanit(async (req, res) => res.json({ ok: true, rows: await sahaTuketim(filtre(req)) })));

  async function hareketListesi(f, { limit = 500, personelKilit = null, fiyat = false } = {}) {
    const p = [];
    const ek = (v) => { p.push(v); return `$${p.length}`; };
    const w = [f.bas ? `h.islem_tarihi >= ${ek(f.bas)}::date` : null, f.bit ? `h.islem_tarihi <= ${ek(f.bit)}::date` : null,
      f.urun_id ? `h.urun_id = ${ek(f.urun_id)}` : null, f.saha ? `h.saha_kodu = ${ek(f.saha)}` : null,
      f.depo_id ? `h.depo_id = ${ek(f.depo_id)}` : null, f.firma ? `UPPER(COALESCE(h.firma,'')) = ${ek(f.firma)}` : null,
      f.tur ? `h.tur = ${ek(f.tur)}` : null,
      (personelKilit || f.personel_id) ? `h.personel_id = ${ek(personelKilit || f.personel_id)}` : null].filter(Boolean);
    const r = await pool.query(`SELECT h.*, u.kod AS urun_kod, u.ad AS urun_ad, u.temel_birim, pe.ad_soyad AS personel_ad, d.ad AS depo_ad
      FROM malzeme_hareket h JOIN malzeme_urun u ON u.id = h.urun_id LEFT JOIN personel pe ON pe.id = h.personel_id LEFT JOIN malzeme_depo d ON d.id = h.depo_id
      ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY h.created_at DESC, h.id DESC LIMIT ${Math.min(Math.max(Number(limit) || 500, 1), 5000)}`, p);
    return r.rows.map((x) => {
      const o = { ...x, miktar: n3(x.miktar), girilen_miktar: x.girilen_miktar == null ? null : n3(x.girilen_miktar), tur_ad: TUR_TR[x.tur] || x.tur,
        nereden: lokAd(x.kaynak_tip, x.kaynak_id, x), nereye: lokAd(x.hedef_tip, x.hedef_id, x), iptal_edildi: !!x.ters_hareket_id };
      if (!fiyat) delete o.birim_fiyat;
      return o;
    });
  }
  function lokAd(tip, id, x) {
    if (tip === "DEPO") return `Depo: ${x.depo_ad || id}`;
    if (tip === "PERSONEL") return `Personel: ${x.personel_ad || id}`;
    if (tip === "IADE") return `İade bekleyen: ${x.personel_ad || id}`;
    if (tip === "REZERV") return `Rezerve #${id}`;
    if (tip === "SAHA") return `Saha: ${id}`;
    return LOK_TR[tip] || tip;
  }
  app.get("/malzeme/stok/hareketler", kapi("rapor"), yanit(async (req, res) =>
    res.json({ ok: true, rows: await hareketListesi(filtre(req), { limit: req.query.limit, fiyat: malzemeFiyatYetkili(req.user) }) })));

  app.get("/malzeme/stok/iadeler", kapi("rapor"), yanit(async (req, res) => {
    const durum = ["BEKLIYOR", "ONAYLANDI", "REDDEDILDI", "IPTAL"].includes(req.query.durum) ? req.query.durum : "BEKLIYOR";
    const r = await pool.query(`SELECT i.*, u.kod, u.ad AS urun_ad, u.temel_birim, pe.ad_soyad AS personel_ad, d.ad AS depo_ad
      FROM malzeme_iade i JOIN malzeme_urun u ON u.id = i.urun_id LEFT JOIN personel pe ON pe.id = i.personel_id LEFT JOIN malzeme_depo d ON d.id = i.depo_id
      WHERE i.durum = $1 AND ($2::text IS NULL OR UPPER(COALESCE(i.firma,'ERC')) = $2) ORDER BY i.talep_tarihi ${durum === "BEKLIYOR" ? "ASC" : "DESC"} LIMIT 500`, [durum, fkOf(req)]);
    res.json({ ok: true, rows: r.rows.map((x) => ({ ...x, miktar: n3(x.miktar) })) });
  }));

  app.get("/malzeme/stok/rezervasyonlar", kapi("rapor"), yanit(async (req, res) => {
    const r = await pool.query(`SELECT z.*, u.kod, u.ad AS urun_ad, u.temel_birim, pe.ad_soyad AS personel_ad, d.ad AS depo_ad,
        COALESCE((SELECT miktar FROM malzeme_bakiye b WHERE b.lok_tip = 'REZERV' AND b.lok_id = z.id::text AND b.urun_id = z.urun_id),0) AS kalan
      FROM malzeme_rezervasyon z JOIN malzeme_urun u ON u.id = z.urun_id LEFT JOIN personel pe ON pe.id = z.personel_id LEFT JOIN malzeme_depo d ON d.id = z.depo_id
      WHERE ($1::text = 'hepsi' OR z.durum = 'ACIK') AND ($2::text IS NULL OR UPPER(d.firma) = $2) ORDER BY z.created_at DESC LIMIT 500`, [req.query.durum === "hepsi" ? "hepsi" : "ACIK", fkOf(req)]);
    res.json({ ok: true, rows: r.rows.map((x) => ({ ...x, miktar: n3(x.miktar), kalan: n3(x.kalan) })) });
  }));

  // Satın alma talebi → mal kabul durumu (kalem bazında sipariş / kabul edilen / kalan)
  async function kabulDurumu(db, talepId) {
    const r = await db.query(`SELECT k.id, k.malzeme_adi, k.miktar, k.birim, k.temin_turu, k.urun_id, k.dagitim_yapildi, u.ad AS urun_ad, u.temel_birim,
        COALESCE((SELECT SUM(CASE WHEN h.tur='TERS' THEN -h.miktar ELSE h.miktar END) FROM malzeme_hareket h
          WHERE h.talep_kalem_id = k.id AND (h.tur = 'GIRIS' OR (h.tur = 'TERS' AND h.kaynak_tip = 'DEPO' AND h.hedef_tip = 'DIS'))),0) AS kabul_edilen,
        COALESCE((SELECT SUM(CASE WHEN h.tur='TERS' THEN -h.miktar ELSE h.miktar END) FROM malzeme_hareket h
          WHERE h.talep_kalem_id = k.id AND (h.tur IN ('TESLIM','REZERV_TESLIM') OR (h.tur = 'TERS' AND h.kaynak_tip = 'PERSONEL' AND h.hedef_tip IN ('DEPO','REZERV')))),0) AS teslim_edilen
      FROM malzeme_talep_kalemleri k LEFT JOIN malzeme_urun u ON u.id = k.urun_id WHERE k.talep_id = $1 ORDER BY k.id`, [Number(talepId)]);
    const out = [];
    for (const k of r.rows) {
      let siparis_temel = null;
      if (k.urun_id) {
        const urun = await urunGetir(db, k.urun_id);
        try { siparis_temel = n3((await temeleCevir(db, urun, k.miktar, k.birim)).temel); } catch { siparis_temel = null; }
      }
      out.push({ ...k, miktar: n3(k.miktar), siparis_temel, kabul_edilen: n3(k.kabul_edilen), teslim_edilen: n3(k.teslim_edilen),
        kalan: siparis_temel == null ? null : n3(siparis_temel - Number(k.kabul_edilen)) });
    }
    return out;
  }
  app.get("/malzeme/stok/kabul/:talepId", kapi("depo"), yanit(async (req, res) => {
    const t = await pool.query(`SELECT id, talep_no, durum, firma FROM malzeme_talepler WHERE id = $1`, [Number(req.params.talepId)]);
    if (!t.rows.length) throw new StokHatasi("Talep bulunamadı", 404);
    kapsamKontrol(req, t.rows[0].firma, "Talep");
    res.json({ ok: true, talep: t.rows[0], kalemler: await kabulDurumu(pool, req.params.talepId) });
  }));

  // ── Personelin kendi stoğu (mobil "Malzemelerim") ───────────────────────────────────────────────────────────────
  async function benimStok(pid) {
    const r = await pool.query(`SELECT u.id AS urun_id, u.kod, u.ad, u.temel_birim, u.tur, u.tam_sayi,
        COALESCE(SUM(CASE WHEN b.lok_tip='PERSONEL' THEN b.miktar END),0) AS kullanilabilir,
        COALESCE(SUM(CASE WHEN b.lok_tip='IADE' THEN b.miktar END),0) AS iade_bekleyen
      FROM malzeme_bakiye b JOIN malzeme_urun u ON u.id = b.urun_id
      WHERE b.lok_tip IN ('PERSONEL','IADE') AND b.lok_id = $1 GROUP BY u.id HAVING SUM(b.miktar) > 0 ORDER BY u.ad`, [String(pid)]);
    return r.rows.map((x) => ({ ...x, kullanilabilir: n3(x.kullanilabilir), iade_bekleyen: n3(x.iade_bekleyen), toplam: n3(Number(x.kullanilabilir) + Number(x.iade_bekleyen)) }));
  }
  app.get("/malzeme/stok/benim", kapi("personel"), yanit(async (req, res) => {
    const p = req.benimPersonel;
    const iadeler = await pool.query(`SELECT i.id, i.urun_id, u.ad AS urun_ad, u.temel_birim, i.miktar, i.durum, i.talep_tarihi, i.talep_aciklama, i.karar_aciklama, i.karar_tarihi
      FROM malzeme_iade i JOIN malzeme_urun u ON u.id = i.urun_id WHERE i.personel_id = $1 ORDER BY i.talep_tarihi DESC LIMIT 50`, [p.id]);
    res.json({ ok: true, personel: { id: p.id, ad_soyad: p.ad_soyad, firma: p.firma }, defter_acik: await defterAcik(),
      stok: await benimStok(p.id), iadeler: iadeler.rows.map((x) => ({ ...x, miktar: n3(x.miktar) })),
      hareketler: await hareketListesi({}, { limit: Number(req.query.limit) || 100, personelKilit: p.id }) });
  }));

  // Saha seçimi: kendisine atanan sahalar önce, sonra (arama varsa) kapsamındaki rollout sahaları
  app.get("/malzeme/stok/sahalarim", kapi("personel"), yanit(async (req, res) => {
    const p = req.benimPersonel;
    const q = sahaNorm(req.query.q).slice(0, 30);
    const at = p.email ? await pool.query(`SELECT DISTINCT unnest(site_codes) AS saha_kodu FROM is_atama
      WHERE personeller @> $1::jsonb AND (durum NOT IN ('TAMAMLANDI','IPTAL') OR updated_at > now() - interval '30 days')`, [JSON.stringify([{ email: p.email }])]).catch(() => ({ rows: [] })) : { rows: [] };
    const atanan = [...new Set(at.rows.map((x) => sahaNorm(x.saha_kodu)).filter(Boolean))].filter((s) => !q || s.includes(q)).slice(0, 30);
    let diger = [];
    if (q.length >= 2) {
      const K = await personelSahaKapsami(p.firma);
      const prm = [`%${q}%`];
      const r = await pool.query(`SELECT DISTINCT UPPER(REPLACE(TRIM(r.site_code),' ','')) AS saha_kodu, r.bolge FROM rollout_progress r
        WHERE UPPER(REPLACE(TRIM(r.site_code),' ','')) LIKE $1 ${K ? "AND " + K.sql("r", 2) : ""} ORDER BY 1 LIMIT 25`, K ? [...prm, ...K.params] : prm).catch(() => ({ rows: [] }));
      diger = r.rows.filter((x) => !atanan.includes(x.saha_kodu));
    }
    res.json({ ok: true, atanan: atanan.map((s) => ({ saha_kodu: s, atanan: true })), diger });
  }));

  // ═══ YAZMA — DEPO ═════════════════════════════════════════════════════════════════════════════════════════════
  app.post("/malzeme/stok/depo", kapi("onay"), (req, res) => tekilIslem(req, res, "depo", async (db) => {
    const kod = metin(req.body.kod, 20).toUpperCase(), ad = metin(req.body.ad, 100);
    const firma = fkOf(req) || metin(req.body.firma || "ERC", 20).toUpperCase();
    if (!kod || !ad) throw new StokHatasi("Depo kodu ve adı zorunlu");
    const r = await db.query(`INSERT INTO malzeme_depo (kod, ad, firma, olusturan) VALUES ($1,$2,$3,$4) RETURNING *`, [kod, ad, firma, req.user.email]);
    return { depo: r.rows[0] };
  }));

  async function urunEkle(db, b, email) {
    const kod = metin(b.kod, 40).toUpperCase(), ad = metin(b.ad, 200);
    const temel = metin(b.temel_birim, 30);
    if (!kod) throw new StokHatasi("Ürün kodu zorunlu");
    if (!ad) throw new StokHatasi("Ürün adı zorunlu");
    const birim = BIRIMLER.find((x) => x.toLocaleLowerCase("tr") === temel.toLocaleLowerCase("tr"));
    if (!birim) throw new StokHatasi(`Temel birim geçersiz: ${temel || "(boş)"} — ${BIRIMLER.join(", ")}`);
    const tur = String(b.tur || "SARF").toUpperCase();
    if (!["SARF", "EKIPMAN"].includes(tur)) throw new StokHatasi("Tür SARF ya da EKIPMAN olmalı");
    const tam = b.tam_sayi === undefined || b.tam_sayi === null || b.tam_sayi === "" ? TAM_SAYI_BIRIMLER.includes(birim.toLocaleLowerCase("tr")) : !!b.tam_sayi;
    const min = b.min_stok === undefined || b.min_stok === null || b.min_stok === "" ? null : (Number(String(b.min_stok).replace(",", ".")) === 0 ? "0" : miktarAyristir(b.min_stok, "Düşük stok eşiği"));
    const eski = Array.isArray(b.eski_adlar) ? b.eski_adlar.map((x) => metin(x, 200)).filter(Boolean).slice(0, 20) : [];
    const r = await db.query(`INSERT INTO malzeme_urun (kod, ad, temel_birim, tam_sayi, tur, kategori, min_stok, eski_adlar, aciklama, olusturan)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [kod, ad, birim, tam, tur, metin(b.kategori, 60) || null, min, eski, metin(b.aciklama, 500) || null, email]);
    return r.rows[0];
  }
  app.post("/malzeme/stok/urun", kapi("depo"), (req, res) => tekilIslem(req, res, "urun", async (db) => ({ urun: await urunEkle(db, req.body, req.user.email) })));

  // Toplu ürün ekleme: önce önizleme (uygula:false — hiçbir şey yazılmaz), sonra açık onayla uygula:true
  app.post("/malzeme/stok/urun/toplu", kapi("depo"), async (req, res) => {
    const liste = Array.isArray(req.body?.urunler) ? req.body.urunler.slice(0, 2000) : [];
    if (!liste.length) return res.status(400).json({ ok: false, error: "Ürün listesi boş" });
    if (req.body.uygula !== true) {
      try {
        await sema();
        const sonuc = [];
        const gorulen = new Set();
        for (let i = 0; i < liste.length; i++) {
          const b = liste[i] || {};
          const hatalar = [];
          const kod = metin(b.kod, 40).toUpperCase(), ad = metin(b.ad, 200);
          if (!kod) hatalar.push("kod boş"); if (!ad) hatalar.push("ad boş");
          if (!BIRIMLER.some((x) => x.toLocaleLowerCase("tr") === metin(b.temel_birim, 30).toLocaleLowerCase("tr"))) hatalar.push(`birim geçersiz (${b.temel_birim || "boş"})`);
          if (gorulen.has("K" + kod) || gorulen.has("A" + ad.toLocaleUpperCase("tr"))) hatalar.push("listede tekrar");
          gorulen.add("K" + kod); gorulen.add("A" + ad.toLocaleUpperCase("tr"));
          const v = await pool.query(`SELECT id, kod, ad FROM malzeme_urun WHERE UPPER(kod) = $1 OR UPPER(ad) = $2 LIMIT 1`, [kod, ad.toLocaleUpperCase("tr")]);
          if (v.rows.length) hatalar.push(`zaten var (#${v.rows[0].id} ${v.rows[0].kod})`);
          sonuc.push({ satir: i + 1, kod, ad, temel_birim: b.temel_birim, hatalar });
        }
        return res.json({ ok: true, onizleme: true, satirlar: sonuc, hata_sayisi: sonuc.filter((x) => x.hatalar.length).length });
      } catch (e) { return hataDon(res, e); }
    }
    return tekilIslem(req, res, "urun-toplu", async (db) => {
      const eklenen = [];
      for (let i = 0; i < liste.length; i++) {
        try { eklenen.push(await urunEkle(db, liste[i] || {}, req.user.email)); }
        catch (e) { throw new StokHatasi(`${i + 1}. satır: ${e.code === "23505" ? "ürün kodu/adı zaten var" : e.message}; hiçbir ürün eklenmedi`, 400); }
      }
      return { eklenen: eklenen.length };
    });
  });

  app.put("/malzeme/stok/urun/:id", kapi("depo"), (req, res) => tekilIslem(req, res, "urun-duzenle:" + req.params.id, async (db) => {
    const u = await urunGetir(db, req.params.id);
    const b = req.body || {};
    // Temel birim, hareket görmüş üründe değiştirilemez (geçmiş miktarların anlamı bozulur)
    if (b.temel_birim && b.temel_birim !== u.temel_birim) {
      const h = await db.query(`SELECT 1 FROM malzeme_hareket WHERE urun_id = $1 LIMIT 1`, [u.id]);
      if (h.rows.length) throw new StokHatasi("Hareket görmüş ürünün temel birimi değiştirilemez; yeni ürün tanımlayın");
      if (!BIRIMLER.includes(b.temel_birim)) throw new StokHatasi("Temel birim geçersiz");
    }
    const min = b.min_stok === undefined ? u.min_stok : (b.min_stok === null || b.min_stok === "" ? null : (Number(String(b.min_stok).replace(",", ".")) === 0 ? "0" : miktarAyristir(b.min_stok, "Düşük stok eşiği")));
    const r = await db.query(`UPDATE malzeme_urun SET ad = COALESCE(NULLIF($2,''), ad), temel_birim = COALESCE(NULLIF($3,''), temel_birim), kategori = $4,
        min_stok = $5, aktif = COALESCE($6, aktif), tur = COALESCE(NULLIF($7,''), tur), eski_adlar = COALESCE($8, eski_adlar), updated_at = now() WHERE id = $1 RETURNING *`,
      [u.id, metin(b.ad, 200), b.temel_birim || "", b.kategori === undefined ? u.kategori : metin(b.kategori, 60) || null, min,
        typeof b.aktif === "boolean" ? b.aktif : null, b.tur ? String(b.tur).toUpperCase() : "", Array.isArray(b.eski_adlar) ? b.eski_adlar.map((x) => metin(x, 200)).filter(Boolean) : null]);
    return { urun: r.rows[0] };
  }));

  app.post("/malzeme/stok/urun/:id/donusum", kapi("depo"), (req, res) => tekilIslem(req, res, "donusum:" + req.params.id, async (db) => {
    const u = await urunGetir(db, req.params.id);
    const birim = BIRIMLER.find((x) => x.toLocaleLowerCase("tr") === metin(req.body.birim, 30).toLocaleLowerCase("tr"));
    if (!birim) throw new StokHatasi("Birim geçersiz");
    if (birim === u.temel_birim) throw new StokHatasi("Temel birim için dönüşüm gerekmez");
    const k = Number(String(req.body.katsayi ?? "").replace(",", "."));
    if (!(k > 0) || !Number.isFinite(k)) throw new StokHatasi("Katsayı sıfırdan büyük olmalı (1 " + birim + " = kaç " + u.temel_birim + ")");
    const v = await db.query(`SELECT 1 FROM malzeme_urun_birim WHERE urun_id = $1 AND LOWER(birim) = LOWER($2)`, [u.id, birim]);
    if (v.rows.length) throw new StokHatasi("Bu birim için dönüşüm zaten tanımlı (geçmiş hareketleri korumak için değiştirilemez)");
    const r = await db.query(`INSERT INTO malzeme_urun_birim (urun_id, birim, katsayi, olusturan) VALUES ($1,$2,$3,$4) RETURNING *`, [u.id, birim, k, req.user.email]);
    return { donusum: r.rows[0] };
  }));

  const depoAcikZorunlu = (d) => { if (!depoAcikMi(d)) throw new StokHatasi(`"${d.ad}" deposunun açılış sayımı onaylanmadı; önce açılış yapın`, 409); };

  // Depoya giriş (satın alma talebi dışı: Huawei malzemesi, iade dışı bulunan vb.) — açıklama zorunlu
  app.post("/malzeme/stok/giris", kapi("depo"), (req, res) => tekilIslem(req, res, "giris", async (db) => {
    const d = await depoGetir(db, req.body.depo_id); kapsamKontrol(req, d.firma, "Depo"); depoAcikZorunlu(d);
    const kalemler = Array.isArray(req.body.kalemler) ? req.body.kalemler : [];
    if (!kalemler.length) throw new StokHatasi("En az bir kalem girin");
    const aciklama = metin(req.body.aciklama, 1000);
    if (!aciklama) throw new StokHatasi("Giriş açıklaması zorunlu (kaynak / irsaliye)");
    const hs = [];
    for (const k of kalemler) {
      const u = await urunGetir(db, k.urun_id, true);
      if (!u.aktif) throw new StokHatasi(`Ürün pasif: ${u.ad}`);
      const m = await temeleCevir(db, u, k.miktar, k.birim);
      hs.push({ tur: "GIRIS", urun_id: u.id, miktar: m.temel, girilen_miktar: m.girilen, girilen_birim: m.birim, kaynak_tip: "DIS", kaynak_id: null,
        hedef_tip: "DEPO", hedef_id: d.id, depo_id: d.id, firma: d.firma, islem_tarihi: gunGecerli(req.body.tarih) ? req.body.tarih : null,
        aciklama, belge_tip: req.body.belge_no ? "IRSALIYE" : null, belge_no: metin(req.body.belge_no, 60) || null });
    }
    return { hareketler: (await hareketleriUygula(db, hs, req)).map((h) => h.id) };
  }));

  // Mal kabul: satın alma talebinin kalemleri kısmi teslim alınabilir; toplam kabul siparişi aşamaz (yetkili + gerekçe hariç).
  // Talep onayı tek başına stok artırmaz; stok yalnız burada artar. Aynı istek anahtarı ikinci kez işlenmez.
  app.post("/malzeme/stok/mal-kabul", kapi("depo"), (req, res) => tekilIslem(req, res, "mal-kabul", async (db) => {
    const talepId = Number(req.body.talep_id);
    const t = await db.query(`SELECT * FROM malzeme_talepler WHERE id = $1 FOR UPDATE`, [talepId]);
    if (!t.rows.length) throw new StokHatasi("Talep bulunamadı", 404);
    const talep = t.rows[0];
    if (!["SATINALINACAK", "DEPODA"].includes(talep.durum)) throw new StokHatasi(`Talep satın alma onayını tamamlamadı (${talep.durum}); mal kabul yapılamaz`, 409);
    if (talep.arsiv_tarihi) throw new StokHatasi("Arşivlenmiş talep için mal kabul yapılamaz", 409);
    kapsamKontrol(req, talep.firma, "Talep");
    const d = await depoGetir(db, req.body.depo_id); kapsamKontrol(req, d.firma, "Depo"); depoAcikZorunlu(d);
    const kalemler = Array.isArray(req.body.kalemler) ? req.body.kalemler : [];
    if (!kalemler.length) throw new StokHatasi("Teslim alınan kalem yok");
    const fazlaGerekce = metin(req.body.fazla_gerekce, 500);
    const hs = [];
    for (const k of kalemler) {
      const kr = await db.query(`SELECT * FROM malzeme_talep_kalemleri WHERE id = $1 AND talep_id = $2 FOR UPDATE`, [Number(k.talep_kalem_id), talepId]);
      if (!kr.rows.length) throw new StokHatasi("Kalem bu talebe ait değil");
      const kalem = kr.rows[0];
      const urunId = Number(kalem.urun_id || k.urun_id);
      if (kalem.urun_id && k.urun_id && Number(k.urun_id) !== Number(kalem.urun_id)) throw new StokHatasi(`"${kalem.malzeme_adi}" kalemi daha önce başka ürünle eşleştirilmiş`);
      const u = await urunGetir(db, urunId, true);
      if (!kalem.urun_id) await db.query(`UPDATE malzeme_talep_kalemleri SET urun_id = $1 WHERE id = $2`, [u.id, kalem.id]);
      const m = await temeleCevir(db, u, k.miktar, k.birim);
      let siparis;
      try { siparis = Number((await temeleCevir(db, u, kalem.miktar, kalem.birim)).temel); }
      catch (e) { throw new StokHatasi(`"${kalem.malzeme_adi}" kaleminin sipariş birimi (${kalem.birim}) ürünün temel birimine dönüştürülemiyor: önce dönüşüm tanımlayın`); }
      const onceki = (await kabulDurumu(db, talepId)).find((x) => x.id === kalem.id)?.kabul_edilen || 0;
      const buIstekte = hs.filter((h) => h.talep_kalem_id === kalem.id).reduce((a, h) => a + Number(h.miktar), 0);
      if (onceki + buIstekte + Number(m.temel) > siparis + 1e-9) {
        if (!stokOnayYetkili(req.user) || !fazlaGerekce)
          throw new StokHatasi(`"${kalem.malzeme_adi}": toplam kabul siparişi aşıyor (sipariş ${n3(siparis)}, önceki kabul ${n3(onceki)}, bu kabul ${n3(m.temel)} ${u.temel_birim}). Fazla kabul yalnız yetkili yönetici ve gerekçeyle yapılabilir.`, 409);
      }
      hs.push({ tur: "GIRIS", urun_id: u.id, miktar: m.temel, girilen_miktar: m.girilen, girilen_birim: m.birim, kaynak_tip: "DIS", kaynak_id: null,
        hedef_tip: "DEPO", hedef_id: d.id, depo_id: d.id, firma: d.firma, islem_tarihi: gunGecerli(req.body.tarih) ? req.body.tarih : null,
        aciklama: [metin(req.body.aciklama, 500), onceki + buIstekte + Number(m.temel) > siparis + 1e-9 ? `FAZLA KABUL: ${fazlaGerekce}` : ""].filter(Boolean).join(" · ") || `Mal kabul ${talep.talep_no}`,
        belge_tip: "MALZEME_TALEP", belge_id: talepId, belge_no: metin(req.body.belge_no, 60) || talep.talep_no, talep_id: talepId, talep_kalem_id: kalem.id,
        birim_fiyat: Number(kalem.birim_fiyat) > 0 ? kalem.birim_fiyat : null });
    }
    const yaz = await hareketleriUygula(db, hs, req);
    // Tamamen kabul edilen "Yeni Alım" kalemleri işaretlenir; hepsi tamamsa talep DEPODA olur (stok etkisi yok, yalnız durum)
    const durum = await kabulDurumu(db, talepId);
    for (const k of durum) if (k.siparis_temel != null && k.kabul_edilen >= k.siparis_temel - 1e-9 && !k.dagitim_yapildi && k.temin_turu === "Yeni Alım")
      await db.query(`UPDATE malzeme_talep_kalemleri SET dagitim_yapildi = true WHERE id = $1`, [k.id]);
    const yeniAlim = durum.filter((k) => k.temin_turu === "Yeni Alım");
    if (talep.durum === "SATINALINACAK" && yeniAlim.length && yeniAlim.every((k) => k.siparis_temel != null && k.kabul_edilen >= k.siparis_temel - 1e-9))
      await db.query(`UPDATE malzeme_talepler SET durum = 'DEPODA', updated_at = now() WHERE id = $1`, [talepId]);
    return { hareketler: yaz.map((h) => h.id), kalemler: durum };
  }));

  // Personele teslim (kısmi / tam). Rezervasyondan teslimde depodan ikinci kez düşülmez.
  app.post("/malzeme/stok/teslim", kapi("depo"), (req, res) => tekilIslem(req, res, "teslim", async (db) => {
    const d = await depoGetir(db, req.body.depo_id); kapsamKontrol(req, d.firma, "Depo"); depoAcikZorunlu(d);
    const per = await personelGetir(db, req.body.personel_id);
    kapsamKontrol(req, per.firma, "Personel");
    if (!per.aktif) throw new StokHatasi("Personel pasif; teslim yapılamaz");
    const kalemler = Array.isArray(req.body.kalemler) ? req.body.kalemler : [];
    if (!kalemler.length) throw new StokHatasi("En az bir kalem girin");
    const talepId = Number(req.body.talep_id) || null;
    const hs = [];
    const rezKapat = [];
    for (const k of kalemler) {
      const u = await urunGetir(db, k.urun_id, true);
      if (!u.aktif) throw new StokHatasi(`Ürün pasif: ${u.ad}`);
      const m = await temeleCevir(db, u, k.miktar, k.birim);
      let kaynak_tip = "DEPO", kaynak_id = d.id, tur = "TESLIM", rezId = null;
      if (k.rezervasyon_id) {
        const z = await db.query(`SELECT * FROM malzeme_rezervasyon WHERE id = $1 FOR UPDATE`, [Number(k.rezervasyon_id)]);
        const rz = z.rows[0];
        if (!rz || rz.durum !== "ACIK") throw new StokHatasi("Rezervasyon açık değil");
        if (rz.urun_id !== u.id || rz.depo_id !== d.id) throw new StokHatasi("Rezervasyon bu ürün / depoya ait değil");
        if (rz.personel_id && rz.personel_id !== per.id) throw new StokHatasi("Rezervasyon başka personel adına");
        kaynak_tip = "REZERV"; kaynak_id = rz.id; tur = "REZERV_TESLIM"; rezId = rz.id; rezKapat.push(rz.id);
      }
      let talepKalemId = Number(k.talep_kalem_id) || null;
      if (talepKalemId) {
        const kr = await db.query(`SELECT id, urun_id FROM malzeme_talep_kalemleri WHERE id = $1 AND ($2::int IS NULL OR talep_id = $2) FOR UPDATE`, [talepKalemId, talepId]);
        if (!kr.rows.length) throw new StokHatasi("Talep kalemi bulunamadı");
        if (kr.rows[0].urun_id && kr.rows[0].urun_id !== u.id) throw new StokHatasi("Talep kalemi başka ürünle eşleştirilmiş");
        if (!kr.rows[0].urun_id) await db.query(`UPDATE malzeme_talep_kalemleri SET urun_id = $1 WHERE id = $2`, [u.id, talepKalemId]);
      }
      hs.push({ tur, urun_id: u.id, miktar: m.temel, girilen_miktar: m.girilen, girilen_birim: m.birim, kaynak_tip, kaynak_id, hedef_tip: "PERSONEL", hedef_id: per.id,
        depo_id: d.id, personel_id: per.id, firma: per.firma, saha_kodu: req.body.saha_kodu ? sahaNorm(req.body.saha_kodu) : null,
        islem_tarihi: gunGecerli(req.body.tarih) ? req.body.tarih : null, aciklama: metin(req.body.aciklama, 1000) || null,
        belge_tip: talepId ? "MALZEME_TALEP" : (req.body.tutanak_url ? "TUTANAK" : null), belge_id: talepId || null, belge_no: metin(req.body.tutanak_url, 500) || null,
        rezervasyon_id: rezId, talep_id: talepId, talep_kalem_id: talepKalemId });
    }
    const yaz = await hareketleriUygula(db, hs, req);
    for (const id of rezKapat) {
      const b = await db.query(`SELECT COALESCE(SUM(miktar),0) AS m FROM malzeme_bakiye WHERE lok_tip = 'REZERV' AND lok_id = $1`, [String(id)]);
      if (Number(b.rows[0].m) === 0) await db.query(`UPDATE malzeme_rezervasyon SET durum = 'KAPANDI', kapanis_tarihi = now() WHERE id = $1`, [id]);
    }
    if (talepId) {
      const durum = await kabulDurumu(db, talepId);
      for (const k of durum) if (k.temin_turu === "Depo Stok" && k.siparis_temel != null && k.teslim_edilen >= k.siparis_temel - 1e-9 && !k.dagitim_yapildi)
        await db.query(`UPDATE malzeme_talep_kalemleri SET dagitim_yapildi = true WHERE id = $1`, [k.id]);
    }
    return { hareketler: yaz.map((h) => h.id), personel: { id: per.id, ad_soyad: per.ad_soyad } };
  }));

  app.post("/malzeme/stok/rezervasyon", kapi("depo"), (req, res) => tekilIslem(req, res, "rezervasyon", async (db) => {
    const d = await depoGetir(db, req.body.depo_id); kapsamKontrol(req, d.firma, "Depo"); depoAcikZorunlu(d);
    const u = await urunGetir(db, req.body.urun_id, true);
    const m = await temeleCevir(db, u, req.body.miktar, req.body.birim);
    const per = req.body.personel_id ? await personelGetir(db, req.body.personel_id) : null;
    const z = await db.query(`INSERT INTO malzeme_rezervasyon (depo_id, urun_id, miktar, personel_id, talep_id, talep_kalem_id, aciklama, olusturan)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [d.id, u.id, m.temel, per?.id || null, Number(req.body.talep_id) || null, Number(req.body.talep_kalem_id) || null,
      metin(req.body.aciklama, 500) || null, req.user.email]);
    const rz = z.rows[0];
    await hareketleriUygula(db, [{ tur: "REZERVE", urun_id: u.id, miktar: m.temel, girilen_miktar: m.girilen, girilen_birim: m.birim, kaynak_tip: "DEPO", kaynak_id: d.id,
      hedef_tip: "REZERV", hedef_id: rz.id, depo_id: d.id, personel_id: per?.id || null, firma: d.firma, rezervasyon_id: rz.id, aciklama: rz.aciklama,
      talep_id: rz.talep_id, talep_kalem_id: rz.talep_kalem_id }], req);
    return { rezervasyon: { ...rz, miktar: n3(rz.miktar) } };
  }));

  app.post("/malzeme/stok/rezervasyon/:id/iptal", kapi("depo"), (req, res) => tekilIslem(req, res, "rez-iptal:" + req.params.id, async (db) => {
    const z = await db.query(`SELECT * FROM malzeme_rezervasyon WHERE id = $1 FOR UPDATE`, [Number(req.params.id)]);
    const rz = z.rows[0];
    if (!rz) throw new StokHatasi("Rezervasyon bulunamadı", 404);
    if (rz.durum !== "ACIK") throw new StokHatasi("Rezervasyon açık değil", 409);
    kapsamKontrol(req, (await depoGetir(db, rz.depo_id)).firma, "Rezervasyon deposu");
    const b = await db.query(`SELECT miktar FROM malzeme_bakiye WHERE lok_tip = 'REZERV' AND lok_id = $1 AND urun_id = $2`, [String(rz.id), rz.urun_id]);
    const kalan = b.rows[0]?.miktar;
    if (Number(kalan) > 0) await hareketleriUygula(db, [{ tur: "REZERV_IPTAL", urun_id: rz.urun_id, miktar: kalan, kaynak_tip: "REZERV", kaynak_id: rz.id, hedef_tip: "DEPO", hedef_id: rz.depo_id,
      depo_id: rz.depo_id, personel_id: rz.personel_id, rezervasyon_id: rz.id, aciklama: metin(req.body.aciklama, 500) || "Rezervasyon iptali" }], req);
    await db.query(`UPDATE malzeme_rezervasyon SET durum = 'IPTAL', kapanis_tarihi = now() WHERE id = $1`, [rz.id]);
    return { iade_edilen: n3(kalan || 0) };
  }));

  // İade kararı: onay = depo fiziksel olarak teslim aldı (IADE → DEPO); red = gerekçeli, miktar personele döner
  async function iadeKarar(db, req, onay) {
    const z = await db.query(`SELECT * FROM malzeme_iade WHERE id = $1 FOR UPDATE`, [Number(req.params.id)]);
    const i = z.rows[0];
    if (!i) throw new StokHatasi("İade talebi bulunamadı", 404);
    if (i.durum !== "BEKLIYOR") throw new StokHatasi(`İade talebi zaten sonuçlanmış (${i.durum})`, 409);
    kapsamKontrol(req, i.firma, "İade talebi");
    const gerekce = metin(req.body.aciklama || req.body.gerekce, 1000);
    let depo = null;
    if (onay) {
      depo = await depoGetir(db, req.body.depo_id || i.depo_id); kapsamKontrol(req, depo.firma, "Depo"); depoAcikZorunlu(depo);
    } else if (!gerekce) throw new StokHatasi("Ret gerekçesi zorunlu");
    const per = await personelGetir(db, i.personel_id);
    const [h] = await hareketleriUygula(db, [{ tur: onay ? "IADE_ONAY" : "IADE_RED", urun_id: i.urun_id, miktar: i.miktar, kaynak_tip: "IADE", kaynak_id: i.personel_id,
      hedef_tip: onay ? "DEPO" : "PERSONEL", hedef_id: onay ? depo.id : i.personel_id, depo_id: depo?.id || i.depo_id, personel_id: i.personel_id, firma: per.firma,
      iade_id: i.id, aciklama: gerekce || (onay ? "İade fiziksel olarak teslim alındı" : null), belge_tip: "IADE", belge_id: i.id }], req);
    const r = await db.query(`UPDATE malzeme_iade SET durum = $2, karar_veren_email = $3, karar_veren_ad = $4, karar_tarihi = now(), karar_aciklama = $5,
      karar_hareket_id = $6, depo_id = COALESCE($7, depo_id) WHERE id = $1 RETURNING *`,
      [i.id, onay ? "ONAYLANDI" : "REDDEDILDI", String(req.user.email || "").toLowerCase(), req.user.name || null, gerekce || null, h.id, depo?.id || null]);
    return { iade: { ...r.rows[0], miktar: n3(r.rows[0].miktar) } };
  }
  app.post("/malzeme/stok/iade/:id/onayla", kapi("depo"), (req, res) => tekilIslem(req, res, "iade-onay:" + req.params.id, (db) => iadeKarar(db, req, true)));
  app.post("/malzeme/stok/iade/:id/reddet", kapi("depo"), (req, res) => tekilIslem(req, res, "iade-red:" + req.params.id, (db) => iadeKarar(db, req, false)));

  // Gerekçeli sayım düzeltmesi: sayılan fiziksel miktar ile kayıt arasındaki fark DÜZELTME hareketiyle kapatılır
  app.post("/malzeme/stok/sayim-duzeltme", kapi("depo"), (req, res) => tekilIslem(req, res, "sayim", async (db) => {
    const gerekce = metin(req.body.gerekce, 1000);
    if (!gerekce) throw new StokHatasi("Sayım düzeltmesinde gerekçe zorunlu");
    const u = await urunGetir(db, req.body.urun_id, true);
    const tip = String(req.body.lokasyon_tip || "").toUpperCase();
    let lokId, depo = null, per = null;
    if (tip === "DEPO") { depo = await depoGetir(db, req.body.depo_id); kapsamKontrol(req, depo.firma, "Depo"); depoAcikZorunlu(depo); lokId = String(depo.id); }
    else if (tip === "PERSONEL") { per = await personelGetir(db, req.body.personel_id); kapsamKontrol(req, per.firma, "Personel"); lokId = String(per.id); }
    else throw new StokHatasi("Lokasyon DEPO ya da PERSONEL olmalı");
    const sayilanStr = String(req.body.sayilan_miktar ?? "").trim();
    if (!sayilanStr) throw new StokHatasi("Sayılan miktar zorunlu (hiç yoksa 0 yazın)");
    const sayilan = /^0+([.,]0*)?$/.test(sayilanStr) ? "0.000" : (await temeleCevir(db, u, sayilanStr, req.body.birim)).temel;
    const b = await db.query(`SELECT COALESCE(miktar,0) AS m FROM malzeme_bakiye WHERE lok_tip = $1 AND lok_id = $2 AND urun_id = $3 FOR UPDATE`, [tip, lokId, u.id]);
    const kayit = Number(b.rows[0]?.m || 0);
    // Personel sayımı: elindeki fiziksel = kullanılabilir + iade bekleyen; fark yalnız kullanılabilir kısma uygulanır
    let iadeBekleyen = 0;
    if (tip === "PERSONEL") iadeBekleyen = Number((await db.query(`SELECT COALESCE(miktar,0) AS m FROM malzeme_bakiye WHERE lok_tip = 'IADE' AND lok_id = $1 AND urun_id = $2`, [lokId, u.id])).rows[0]?.m || 0);
    const fark = Math.round((Number(sayilan) - kayit - iadeBekleyen) * 1000) / 1000;
    if (fark === 0) return { fark: 0, mesaj: "Fark yok; hareket oluşturulmadı" };
    const miktar = Math.abs(fark).toFixed(3);
    const yaz = await hareketleriUygula(db, [{ tur: "SAYIM_DUZELTME", urun_id: u.id, miktar,
      kaynak_tip: fark > 0 ? "DUZELTME" : tip, kaynak_id: fark > 0 ? null : lokId, hedef_tip: fark > 0 ? tip : "DUZELTME", hedef_id: fark > 0 ? lokId : null,
      depo_id: depo?.id || null, personel_id: per?.id || null, firma: depo?.firma || per?.firma || null,
      islem_tarihi: gunGecerli(req.body.sayim_tarihi) ? req.body.sayim_tarihi : null,
      aciklama: `Sayım: kayıt ${n3(kayit + iadeBekleyen)}, sayılan ${n3(sayilan)} ${u.temel_birim}. ${gerekce}`, belge_tip: "SAYIM" }], req);
    return { fark: n3(fark), hareketler: yaz.map((h) => h.id) };
  }));

  // Ters kayıt: hatalı hareketi silmeden düzeltir. İade / rezervasyon yaşam döngüsü hareketleri kendi akışıyla düzeltilir.
  app.post("/malzeme/stok/hareket/:id/ters", kapi("onay"), (req, res) => tekilIslem(req, res, "ters:" + req.params.id, async (db) => {
    const gerekce = metin(req.body.gerekce, 1000);
    if (!gerekce) throw new StokHatasi("Ters kayıtta gerekçe zorunlu");
    const r = await db.query(`SELECT * FROM malzeme_hareket WHERE id = $1 FOR UPDATE`, [Number(req.params.id)]);
    const h = r.rows[0];
    if (!h) throw new StokHatasi("Hareket bulunamadı", 404);
    if (h.ters_hareket_id) throw new StokHatasi("Bu hareket zaten ters kayıtla düzeltilmiş", 409);
    kapsamKontrol(req, h.firma, "Hareket");
    if (!["GIRIS", "TESLIM", "TUKETIM", "SAYIM_DUZELTME", "ACILIS", "REZERV_TESLIM"].includes(h.tur))
      throw new StokHatasi(`${TUR_TR[h.tur] || h.tur} hareketi ters kayıtla düzeltilemez; kendi akışını kullanın`);
    // Rezervasyondan teslimin tersi depoya döner (rezervasyon kapanmış olabilir)
    const geri = h.tur === "REZERV_TESLIM" ? { tip: "DEPO", id: h.depo_id } : { tip: h.kaynak_tip, id: h.kaynak_id };
    const [t] = await hareketleriUygula(db, [{ tur: "TERS", urun_id: h.urun_id, miktar: h.miktar, kaynak_tip: h.hedef_tip, kaynak_id: h.hedef_id,
      hedef_tip: geri.tip, hedef_id: geri.id, depo_id: h.depo_id, personel_id: h.personel_id, saha_kodu: h.saha_kodu, firma: h.firma,
      aciklama: `Ters kayıt #${h.id} (${TUR_TR[h.tur]}): ${gerekce}`, belge_tip: "TERS", belge_id: h.id, ters_edilen_id: h.id,
      talep_id: h.talep_id, talep_kalem_id: h.talep_kalem_id, rezervasyon_id: h.rezervasyon_id, acilis_id: h.acilis_id }], req);
    await db.query(`UPDATE malzeme_hareket SET ters_hareket_id = $2 WHERE id = $1`, [h.id, t.id]);
    return { ters_hareket_id: t.id };
  }));

  // ═══ YAZMA — PERSONEL (kendi stoğu; kimlik oturumdan) ═══════════════════════════════════════════════════════════
  // Depo yetkilisi kağıt formdan başkası adına girebilir (personel_id + açıklama zorunlu); personel yalnız kendi adına.
  async function islemPersoneli(db, req) {
    if (!req.benimPersonel || (req.body.personel_id && Number(req.body.personel_id) !== req.benimPersonel.id)) {
      if (!req.body.personel_id) throw new StokHatasi("Personel seçin");
      if (!malzemeDepoYetkili(req.user)) throw new StokHatasi("Yalnız kendi üzerinizdeki malzeme için işlem yapabilirsiniz", 403);
      if (!metin(req.body.aciklama)) throw new StokHatasi("Başkası adına kayıtta açıklama zorunlu");
      const p = await personelGetir(db, req.body.personel_id);
      kapsamKontrol(req, p.firma, "Personel");
      return p;
    }
    return req.benimPersonel;
  }
  const kapiPersonelVeyaDepo = kapi("personel-veya-depo");

  app.post("/malzeme/stok/tuketim", kapiPersonelVeyaDepo, (req, res) => tekilIslem(req, res, "tuketim", async (db) => {
    const per = await islemPersoneli(db, req);
    const u = await urunGetir(db, req.body.urun_id, true);
    if (u.tur === "EKIPMAN") throw new StokHatasi(`"${u.ad}" ekipmandır; sahada tüketilmez, işi bitince depoya iade edilir`);
    const m = await temeleCevir(db, u, req.body.miktar, req.body.birim);
    const saha = await sahaDogrula(db, req.body.saha_kodu, per);
    let tarih = req.body.tarih ? String(req.body.tarih).slice(0, 10) : bugunTR();
    if (!gunGecerli(tarih)) throw new StokHatasi("Tarih geçersiz");
    if (tarih > bugunTR()) throw new StokHatasi("İleri tarihli tüketim girilemez");
    const yaz = await hareketleriUygula(db, [{ tur: "TUKETIM", urun_id: u.id, miktar: m.temel, girilen_miktar: m.girilen, girilen_birim: m.birim,
      kaynak_tip: "PERSONEL", kaynak_id: per.id, hedef_tip: "SAHA", hedef_id: saha, personel_id: per.id, saha_kodu: saha, firma: per.firma,
      islem_tarihi: tarih, aciklama: metin(req.body.aciklama, 1000) || null }], req);
    const kalan = await db.query(`SELECT miktar FROM malzeme_bakiye WHERE lok_tip = 'PERSONEL' AND lok_id = $1 AND urun_id = $2`, [String(per.id), u.id]);
    return { hareket_id: yaz[0].id, saha_kodu: saha, miktar: n3(m.temel), birim: u.temel_birim, kalan: n3(kalan.rows[0]?.miktar || 0) };
  }));

  async function iadeTalepAc(db, req, per, urunId, girilen, birim, aciklama, kaynak) {
    const u = await urunGetir(db, urunId, true);
    const m = await temeleCevir(db, u, girilen, birim);
    const z = await db.query(`INSERT INTO malzeme_iade (personel_id, urun_id, miktar, depo_id, firma, talep_aciklama, talep_eden_email, kaynak)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [per.id, u.id, m.temel, Number(req.body.depo_id) || null, per.firma, aciklama || null,
      String(req.user.email || "").toLowerCase(), kaynak]);
    const i = z.rows[0];
    const [h] = await hareketleriUygula(db, [{ tur: "IADE_TALEP", urun_id: u.id, miktar: m.temel, girilen_miktar: m.girilen, girilen_birim: m.birim,
      kaynak_tip: "PERSONEL", kaynak_id: per.id, hedef_tip: "IADE", hedef_id: per.id, personel_id: per.id, firma: per.firma, iade_id: i.id,
      aciklama: aciklama || null, belge_tip: "IADE", belge_id: i.id }], req);
    await db.query(`UPDATE malzeme_iade SET talep_hareket_id = $2 WHERE id = $1`, [i.id, h.id]);
    return { iade: { ...i, miktar: n3(i.miktar), urun_ad: u.ad, temel_birim: u.temel_birim } };
  }
  app.post("/malzeme/stok/iade", kapiPersonelVeyaDepo, (req, res) => tekilIslem(req, res, "iade", async (db) => {
    const per = await islemPersoneli(db, req);
    return iadeTalepAc(db, req, per, req.body.urun_id, req.body.miktar, req.body.birim, metin(req.body.aciklama, 1000), "YENI");
  }));

  // Personel kendi bekleyen iadesini geri çekebilir (miktar yeniden kullanılabilir olur)
  app.post("/malzeme/stok/iade/:id/iptal", kapiPersonelVeyaDepo, (req, res) => tekilIslem(req, res, "iade-iptal:" + req.params.id, async (db) => {
    const z = await db.query(`SELECT * FROM malzeme_iade WHERE id = $1 FOR UPDATE`, [Number(req.params.id)]);
    const i = z.rows[0];
    if (!i) throw new StokHatasi("İade talebi bulunamadı", 404);
    if (i.personel_id !== req.benimPersonel?.id && !malzemeDepoYetkili(req.user)) throw new StokHatasi("Bu iade talebi size ait değil", 403);
    if (i.durum !== "BEKLIYOR") throw new StokHatasi(`İade talebi zaten sonuçlanmış (${i.durum})`, 409);
    const [h] = await hareketleriUygula(db, [{ tur: "IADE_IPTAL", urun_id: i.urun_id, miktar: i.miktar, kaynak_tip: "IADE", kaynak_id: i.personel_id,
      hedef_tip: "PERSONEL", hedef_id: i.personel_id, personel_id: i.personel_id, firma: i.firma, iade_id: i.id, aciklama: "Personel iade talebini geri çekti", belge_tip: "IADE", belge_id: i.id }], req);
    await db.query(`UPDATE malzeme_iade SET durum = 'IPTAL', karar_tarihi = now(), karar_veren_email = $2, karar_hareket_id = $3 WHERE id = $1`, [i.id, String(req.user.email || "").toLowerCase(), h.id]);
    return { iptal: i.id };
  }));

  // ═══ AÇILIŞ (fiziksel sayım) — önizleme → onay → uygula; depo başına bir kez; tekrar yüklenemez ═══════════════════
  // satirlar: [{ urun_kodu | urun_id, miktar, birim?, personel_id? | personel_email? }]  personel yoksa satır depoya aittir.
  app.post("/malzeme/stok/acilis/onizleme", kapi("depo"), (req, res) => tekilIslem(req, res, "acilis-onizleme", async (db) => {
    const d = await depoGetir(db, req.body.depo_id);
    kapsamKontrol(req, d.firma, "Depo");
    if (depoAcikMi(d)) throw new StokHatasi(`"${d.ad}" deposunun açılışı ${gunStr(d.acilis_tarihi)} tarihinde yapıldı; ikinci açılış yapılamaz (sayım düzeltmesi kullanın)`, 409);
    const tarih = String(req.body.sayim_tarihi || "").slice(0, 10);
    if (!gunGecerli(tarih)) throw new StokHatasi("Sayım tarihi zorunlu (YYYY-AA-GG)");
    if (tarih > bugunTR()) throw new StokHatasi("Sayım tarihi ileri bir tarih olamaz");
    const satirlar = Array.isArray(req.body.satirlar) ? req.body.satirlar.slice(0, 5000) : [];
    if (!satirlar.length) throw new StokHatasi("Sayım satırı yok");
    const a = await db.query(`INSERT INTO malzeme_acilis (depo_id, sayim_tarihi, aciklama, kaynak_dosya, olusturan_email, icerik_ozet)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [d.id, tarih, metin(req.body.aciklama, 1000) || null, metin(req.body.kaynak_dosya, 200) || null,
      String(req.user.email || "").toLowerCase(), ozet(satirlar)]);
    const ac = a.rows[0];
    const anahtarlar = new Set();
    let hata = 0;
    const cikti = [];
    for (let i = 0; i < satirlar.length; i++) {
      const s = satirlar[i] || {};
      const hatalar = [];
      let urun = null, per = null, m = null;
      try {
        const ur = s.urun_id ? await db.query(`SELECT * FROM malzeme_urun WHERE id = $1`, [Number(s.urun_id)])
          : await db.query(`SELECT * FROM malzeme_urun WHERE UPPER(kod) = UPPER($1)`, [metin(s.urun_kodu, 40)]);
        urun = ur.rows[0] || null;
        if (!urun) hatalar.push(`ürün bulunamadı (${s.urun_kodu || s.urun_id || "boş"})`);
        else if (!urun.aktif) hatalar.push("ürün pasif");
      } catch (e) { hatalar.push(e.message); }
      if (s.personel_id || s.personel_email) {
        const pr = s.personel_id ? await db.query(`SELECT id FROM personel WHERE id = $1`, [Number(s.personel_id)])
          : await db.query(`SELECT id FROM personel WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) AND aktif ORDER BY id DESC`, [metin(s.personel_email, 200)]);
        if (pr.rows.length > 1) hatalar.push("personel e-postası birden fazla kayıtla eşleşti; personel_id verin");
        else if (!pr.rows.length) hatalar.push(`personel bulunamadı (${s.personel_id || s.personel_email})`);
        else {
          per = await personelGetir(db, pr.rows[0].id);
          if (!per.aktif) hatalar.push("personel pasif");
          if (per.firma !== String(d.firma || "ERC").toUpperCase()) hatalar.push(`personel ${per.firma} firmasında; depo ${d.firma} — başka firmanın personeli bu açılışa yazılamaz`);
          const onceki = await db.query(`SELECT acilis_id FROM malzeme_hareket WHERE tur = 'ACILIS' AND hedef_tip = 'PERSONEL' AND hedef_id = $1 LIMIT 1`, [String(per.id)]);
          if (onceki.rows.length) hatalar.push(`personelin açılışı #${onceki.rows[0].acilis_id} ile zaten yapıldı`);
        }
      }
      if (urun) {
        try { m = await temeleCevir(db, urun, s.miktar, s.birim); } catch (e) { hatalar.push(e.message); }
      }
      const anahtar = `${urun?.id}|${per ? "P" + per.id : "D"}`;
      if (urun && anahtarlar.has(anahtar)) hatalar.push("aynı ürün + lokasyon listede iki kez var (tek satırda toplayın)");
      anahtarlar.add(anahtar);
      if (hatalar.length) hata++;
      await db.query(`INSERT INTO malzeme_acilis_satir (acilis_id, satir_no, ham, urun_id, lok_tip, personel_id, girilen_miktar, girilen_birim, miktar, hata)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ac.id, i + 1, JSON.stringify(s), urun?.id || null, per ? "PERSONEL" : "DEPO", per?.id || null,
        m?.girilen || null, m?.birim || null, m?.temel || null, hatalar.length ? hatalar.join("; ") : null]);
      cikti.push({ satir: i + 1, urun: urun ? `${urun.kod} · ${urun.ad}` : null, lokasyon: per ? `Personel: ${per.ad_soyad}` : `Depo: ${d.ad}`,
        miktar: m ? n3(m.temel) : null, birim: urun?.temel_birim || null, hatalar });
    }
    await db.query(`UPDATE malzeme_acilis SET satir_sayisi = $2, hata_sayisi = $3 WHERE id = $1`, [ac.id, satirlar.length, hata]);
    return { acilis: { ...ac, satir_sayisi: satirlar.length, hata_sayisi: hata }, satirlar: cikti,
      mesaj: hata ? `${hata} satırda hata var; açılış uygulanamaz. Dosyayı düzeltip yeniden önizleyin.` : "Hata yok. Uygulamak için yetkili onayı gerekir." };
  }));

  app.get("/malzeme/stok/acilis", kapi("depo"), yanit(async (req, res) => {
    const r = await pool.query(`SELECT a.*, d.ad AS depo_ad FROM malzeme_acilis a JOIN malzeme_depo d ON d.id = a.depo_id WHERE ($1::text IS NULL OR UPPER(d.firma) = $1) ORDER BY a.id DESC LIMIT 100`, [fkOf(req)]);
    res.json({ ok: true, rows: r.rows });
  }));
  app.get("/malzeme/stok/acilis/:id", kapi("depo"), yanit(async (req, res) => {
    const a = await pool.query(`SELECT a.*, d.ad AS depo_ad FROM malzeme_acilis a JOIN malzeme_depo d ON d.id = a.depo_id WHERE a.id = $1`, [Number(req.params.id)]);
    if (!a.rows.length) throw new StokHatasi("Açılış bulunamadı", 404);
    kapsamKontrol(req, (await depoGetir(pool, a.rows[0].depo_id)).firma, "Depo");
    const s = await pool.query(`SELECT s.*, u.kod, u.ad AS urun_ad, u.temel_birim, pe.ad_soyad AS personel_ad FROM malzeme_acilis_satir s
      LEFT JOIN malzeme_urun u ON u.id = s.urun_id LEFT JOIN personel pe ON pe.id = s.personel_id WHERE s.acilis_id = $1 ORDER BY s.satir_no`, [a.rows[0].id]);
    res.json({ ok: true, acilis: a.rows[0], satirlar: s.rows.map((x) => ({ ...x, miktar: x.miktar == null ? null : n3(x.miktar) })) });
  }));

  app.post("/malzeme/stok/acilis/:id/uygula", kapi("onay"), (req, res) => tekilIslem(req, res, "acilis-uygula:" + req.params.id, async (db) => {
    if (req.body.onay !== true) throw new StokHatasi("Açılışı uygulamak için açık onay (onay: true) gerekli");
    const a = await db.query(`SELECT * FROM malzeme_acilis WHERE id = $1 FOR UPDATE`, [Number(req.params.id)]);
    const ac = a.rows[0];
    if (!ac) throw new StokHatasi("Açılış bulunamadı", 404);
    if (ac.durum !== "TASLAK") throw new StokHatasi(`Açılış zaten ${ac.durum === "UYGULANDI" ? "uygulandı" : "iptal edildi"}; tekrar uygulanamaz`, 409);
    const d = (await db.query(`SELECT * FROM malzeme_depo WHERE id = $1 FOR UPDATE`, [ac.depo_id])).rows[0];
    kapsamKontrol(req, d.firma, "Depo");
    if (depoAcikMi(d)) throw new StokHatasi("Bu deponun açılışı zaten yapıldı", 409);
    const s = await db.query(`SELECT * FROM malzeme_acilis_satir WHERE acilis_id = $1 ORDER BY satir_no`, [ac.id]);
    if (s.rows.some((x) => x.hata)) throw new StokHatasi("Hatalı satır varken açılış uygulanamaz", 409);
    if (!s.rows.length) throw new StokHatasi("Açılışta satır yok", 409);
    for (const x of s.rows.filter((r) => r.personel_id)) {
      const onceki = await db.query(`SELECT 1 FROM malzeme_hareket WHERE tur = 'ACILIS' AND hedef_tip = 'PERSONEL' AND hedef_id = $1 LIMIT 1`, [String(x.personel_id)]);
      if (onceki.rows.length) throw new StokHatasi(`Personel #${x.personel_id} açılışı başka bir sayımda yapıldı; iki kez sayılamaz`, 409);
    }
    const hs = [];
    for (const x of s.rows) {
      const per = x.personel_id ? await personelGetir(db, x.personel_id) : null;
      hs.push({ tur: "ACILIS", urun_id: x.urun_id, miktar: x.miktar, girilen_miktar: x.girilen_miktar, girilen_birim: x.girilen_birim, kaynak_tip: "ACILIS", kaynak_id: null,
        hedef_tip: per ? "PERSONEL" : "DEPO", hedef_id: per ? per.id : d.id, depo_id: d.id, personel_id: per?.id || null, firma: per?.firma || d.firma,
        islem_tarihi: gunStr(ac.sayim_tarihi),
        aciklama: `Açılış sayımı #${ac.id}`, belge_tip: "ACILIS", belge_id: ac.id, acilis_id: ac.id });
    }
    await hareketleriUygula(db, hs, req);
    await db.query(`UPDATE malzeme_acilis SET durum = 'UYGULANDI', onaylayan_email = $2, onay_tarihi = now() WHERE id = $1`, [ac.id, String(req.user.email || "").toLowerCase()]);
    await db.query(`UPDATE malzeme_depo SET acilis_id = $2, acilis_tarihi = $3 WHERE id = $1`, [d.id, ac.id, gunStr(ac.sayim_tarihi)]);
    return { acilis_id: ac.id, hareket_sayisi: hs.length };
  }));

  app.post("/malzeme/stok/acilis/:id/iptal", kapi("depo"), (req, res) => tekilIslem(req, res, "acilis-iptal:" + req.params.id, async (db) => {
    const ac0 = (await db.query(`SELECT depo_id FROM malzeme_acilis WHERE id = $1`, [Number(req.params.id)])).rows[0];
    if (ac0) kapsamKontrol(req, (await depoGetir(db, ac0.depo_id)).firma, "Depo");
    const r = await db.query(`UPDATE malzeme_acilis SET durum = 'IPTAL', iptal_aciklama = $2 WHERE id = $1 AND durum = 'TASLAK' RETURNING id`, [Number(req.params.id), metin(req.body.aciklama, 500) || null]);
    if (!r.rows.length) throw new StokHatasi("Yalnız taslak açılış iptal edilebilir", 409);
    return { iptal: r.rows[0].id };
  }));

  // ═══ EXCEL — ekrandaki filtreyle aynı sorgular (özet / personel / saha / hareket) ═══════════════════════════════
  app.get("/malzeme/stok/excel", kapi("rapor"), yanit(async (req, res) => {
    const f = filtre(req);
    const [oz, per, saha, har] = await Promise.all([urunOzeti(f), personelStok(f), sahaTuketim(f), hareketListesi(f, { limit: 5000 })]);
    const wb = new ExcelJS.Workbook();
    wb.creator = "Omnix · Malzeme Stok Defteri";
    const sayfa = (ad, kolonlar, satirlar) => {
      const ws = wb.addWorksheet(ad, { views: [{ state: "frozen", ySplit: 3, showGridLines: false }] });
      ws.getCell("A1").value = `${ad} — ${new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}`;
      ws.getCell("A1").font = { bold: true, size: 12, color: { argb: "FF1E3A5F" } };
      ws.getCell("A2").value = "Filtre: " + (Object.entries(f).map(([k, v]) => `${k}=${v}`).join(", ") || "yok") + " · Miktarlar ürünün temel biriminde";
      ws.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF6B7280" } };
      ws.getRow(3).values = kolonlar.map((k) => k[0]);
      ws.getRow(3).font = { bold: true, color: { argb: "FFFFFFFF" } };
      ws.getRow(3).eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } }; });
      kolonlar.forEach((k, i) => { ws.getColumn(i + 1).width = k[2] || 14; if (k[3]) ws.getColumn(i + 1).numFmt = k[3]; });
      for (const s of satirlar) ws.addRow(kolonlar.map((k) => s[k[1]] ?? ""));
    };
    const M = "#,##0.###";
    sayfa("Ürün Özeti", [["Kod", "kod", 14], ["Ürün", "ad", 34], ["Birim", "temel_birim", 9], ["Depo kullanılabilir", "depo_kullanilabilir", 14, M], ["Rezerve", "rezerve", 10, M],
      ["Depo fiziksel", "depo_fiziksel", 12, M], ["Personel kullanılabilir", "personel_kullanilabilir", 14, M], ["İade bekleyen", "iade_bekleyen", 12, M],
      ["Tüketilen (dönem)", "tuketilen", 14, M], ["Düşük stok eşiği", "min_stok", 12, M], ["Düşük stok", "dusuk_txt", 10]], oz.map((x) => ({ ...x, dusuk_txt: x.dusuk_stok ? "EVET" : "" })));
    sayfa("Personel Stoku", [["Personel", "ad_soyad", 24], ["Firma", "firma", 9], ["Bölge", "bolge", 10], ["Kod", "kod", 12], ["Ürün", "urun_ad", 32], ["Birim", "temel_birim", 9],
      ["Kullanılabilir", "kullanilabilir", 12, M], ["İade bekleyen", "iade_bekleyen", 12, M], ["Üzerinde toplam", "toplam", 12, M], ["Tüketilen (dönem)", "tuketilen", 14, M]], per);
    sayfa("Saha Tüketimi", [["Saha", "saha_kodu", 16], ["Kod", "kod", 12], ["Ürün", "urun_ad", 32], ["Birim", "temel_birim", 9], ["Tüketilen", "tuketilen", 12, M],
      ["Kayıt", "kayit_sayisi", 8], ["İlk tarih", "ilk_tarih", 12, "dd.mm.yyyy"], ["Son tarih", "son_tarih", 12, "dd.mm.yyyy"], ["Personel", "personeller", 30]], saha);
    sayfa("Hareketler", [["No", "id", 8], ["Tarih", "islem_tarihi", 12, "dd.mm.yyyy"], ["Kayıt zamanı", "kayit", 18], ["Tür", "tur_ad", 20], ["Ürün", "urun_ad", 30], ["Miktar", "miktar", 10, M],
      ["Birim", "temel_birim", 8], ["Nereden", "nereden", 24], ["Nereye", "nereye", 24], ["Saha", "saha_kodu", 14], ["Personel", "personel_ad", 22], ["Firma", "firma", 8],
      ["İşlemi yapan", "islem_yapan_email", 26], ["Açıklama", "aciklama", 40], ["Belge", "belge_no", 16], ["Ters kayıtla düzeltildi", "ters_txt", 10]],
    har.map((x) => ({ ...x, kayit: new Date(x.created_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }), ters_txt: x.ters_hareket_id ? `#${x.ters_hareket_id}` : "" })));
    const ad = `malzeme_stok_${bugunTR()}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${ad}"`);
    await wb.xlsx.write(res);
    res.end();
  }));

  // ═══ ESKİ UYGULAMA UYUMLULUĞU (ERC mobil build ≤30, Omnix build ≤9, eski web) ═════════════════════════════════════
  // Eski stok yazma uçları (depo_stok / sarf_kullanim / malzeme_dagitim) artık stoğu DEĞİŞTİRMEZ: iki ayrı stok
  // kaynağı oluşmasın diye reddedilir ya da (iade) yeni deftere yönlendirilir. Okuma uçları geçmiş için açık kalır.
  const ESKI_RED = "Malzeme stoğu yeni Stok Defteri'ne taşındı. Bu işlem eski ekrandan yapılamaz; web'de Malzeme Yönetimi › Stok Defteri'ni ya da güncel mobil uygulamayı kullanın.";
  const eskiRed = (req, res) => res.status(409).json({ ok: false, error: ESKI_RED, eski_uc: true });
  for (const [m, yol] of [["post", "/malzeme/depo-stok"], ["put", "/malzeme/depo-stok/:id"], ["post", "/malzeme/depo-stok-ekle"], ["post", "/malzeme/sarf"],
    ["delete", "/malzeme/sarf/:id"], ["post", "/malzeme/dagitim"], ["put", "/malzeme/dagitim/:id/iade-onayla"], ["put", "/malzeme/dagitim/:id/iade-reddet"],
    ["put", "/malzeme/dagitim/:id/saha-cikis"]])
    app[m](yol, authMiddleware, eskiRed);

  // Eski mobil "Üzerimdeki malzemeler": defter açıldıktan sonra kişisel liste defterden üretilir (geçmiş zimmet satırları
  // stok sayılmaz). Satır kimlikleri sentetiktir; eski iade düğmesi aşağıdaki uçla deftere iade talebi açar.
  app.get("/malzeme/dagitim", authMiddleware, async (req, res, next) => {
    try {
      const u = req.user;
      if (fkOf(req) && (malzemeDepoYetkili(u) || malzemeTamOkuma(u, req))) return res.json([]); // eski dağıtım geçmişi Şimşek'e ait — alt marka yönetimi görmez
      if (malzemeDepoYetkili(u) || malzemeTamOkuma(u, req) || taseronMu(u)) return next(); // yönetim görünümü / ret eski katmanda
      if (!(await defterAcik())) return next();
      const p = await kendiPersonelKaydi(u);
      if (!p) return res.json([]);
      const stok = await benimStok(p.id);
      const bek = await pool.query(`SELECT i.id, i.miktar, i.talep_tarihi, u.ad, u.temel_birim FROM malzeme_iade i JOIN malzeme_urun u ON u.id = i.urun_id
        WHERE i.personel_id = $1 AND i.durum = 'BEKLIYOR' ORDER BY i.id`, [p.id]);
      const rows = [
        ...stok.filter((s) => s.kullanilabilir > 0).map((s) => ({ id: SENTETIK_ZIMMET + s.urun_id, malzeme_adi: s.ad, miktar: s.kullanilabilir, birim: s.temel_birim,
          durum: "PERSONELDE", verilme_tarihi: null, site_id: "", talep_no: null, kaynak: "STOK_DEFTERI" })),
        ...bek.rows.map((i) => ({ id: SENTETIK_IADE + i.id, malzeme_adi: i.ad, miktar: n3(i.miktar), iade_miktar: n3(i.miktar), birim: i.temel_birim,
          durum: "IADE_BEKLEMEDE", verilme_tarihi: null, site_id: "", talep_no: null, kaynak: "STOK_DEFTERI" })),
      ];
      res.json(rows);
    } catch (e) { hataDon(res, e); }
  });
  c._sema = sema;
  app.put("/malzeme/dagitim/:id/iade", authMiddleware, async (req, res) => {
    const id = Number(req.params.id);
    if (!(id > SENTETIK_ZIMMET)) return eskiRed(req, res);
    try {
      await sema();
      if (taseronMu(req.user)) return res.status(403).json({ ok: false, error: "Taşeron hesabı malzeme modülünü kullanamaz" });
      const p = await kendiPersonelKaydi(req.user);
      if (!p) return res.status(403).json({ ok: false, error: "Personel kaydınız bulunamadı" });
      const per = await personelGetir(pool, p.id);
      const urunId = id - SENTETIK_ZIMMET;
      // Eski uygulama istek anahtarı göndermez: dakikalık doğal anahtar (miktar yoksa "hepsi") → ağ tekrarında ilk sonuç döner
      const istenenGirdi = req.body?.iade_miktar ? miktarAyristir(req.body.iade_miktar, "İade miktarı") : null;
      req.body = { ...(req.body || {}), istek_anahtari: `eski-iade-${per.id}-${urunId}-${istenenGirdi || "hepsi"}-${Math.floor(Date.now() / 60000)}` };
      return tekilIslem(req, res, "eski-iade", async (db) => {
        const k = await db.query(`SELECT miktar FROM malzeme_bakiye WHERE lok_tip = 'PERSONEL' AND lok_id = $1 AND urun_id = $2`, [String(per.id), urunId]);
        const kullanilabilir = Number(k.rows[0]?.miktar || 0);
        const istenen = istenenGirdi || (kullanilabilir > 0 ? kullanilabilir.toFixed(3) : null);
        if (!istenen) throw new StokHatasi("İade edilecek kullanılabilir miktar yok", 409);
        const r = await iadeTalepAc(db, req, per, urunId, istenen, null, metin(req.body.notlar, 1000) || "Eski mobil uygulamadan iade talebi", "ESKI_MOBIL");
        return { id, durum: "IADE_BEKLEMEDE", iade_miktar: r.iade.miktar, ...r };
      });
    } catch (e) { hataDon(res, e); }
  });
  return { sema };
}

module.exports = { kur, semaKur, miktarAyristir, StokHatasi, TUR_TR, BIRIMLER };
