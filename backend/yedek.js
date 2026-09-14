/* ═══════════════════════════════════════════════════════════════════════
   OTOMATİK SİSTEM YEDEĞİ (14.09.2026, Orhan kararı)
   public şemadaki TÜM tablolar tek Excel dosyasına yazılır (her tablo bir
   sayfa) ve e-posta ekinde gönderilir:
     • 3 günde bir → Nurcan Kuş, Düzgün Şimşek, Eren Can Şimşek
     • 7 günde bir → Orhan Bedir
   Fotoğraf/belge dosyaları (Supabase deposu, ~2,7 GB) yedeğe GİRMEZ — e-posta
   boyutuna sığmaz; onlar depoda durur (14.09.2026 kararı).
   SMTP bilgileri ortam değişkenlerinden okunur; eksikse iş hiç çalışmaz.
   ═══════════════════════════════════════════════════════════════════════ */

const YEDEK_TIPLERI = {
  "3GUN": {
    gun: Number(process.env.YEDEK_GUN_3 || 3),
    alicilar: (process.env.YEDEK_ALICI_3GUN ||
      "nurcan.kus@simsektel.com,duzgun.simsek@simsektel.com,eren.simsek@simsektel.com"),
    ad: "3 günlük yedek",
  },
  HAFTA: {
    gun: Number(process.env.YEDEK_GUN_HAFTA || 7),
    alicilar: (process.env.YEDEK_ALICI_HAFTA || "orhan.bedir@simsektel.com"),
    ad: "Haftalık yedek",
  },
};

const epostalar = (s) => String(s || "").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter((x) => x.includes("@"));

function smtpAyari() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  return {
    host: SMTP_HOST,
    port,
    secure: String(process.env.SMTP_SECURE || (port === 465 ? "true" : "false")) === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    from: process.env.SMTP_FROM || SMTP_USER,
    // Kurumsal sunucuların kendi imzalı sertifikası olabiliyor
    tls: { rejectUnauthorized: String(process.env.SMTP_TLS_KATI || "false") === "true" },
  };
}

async function yedekTablolar(pool) {
  const r = await pool.query(
    `SELECT c.relname AS tablo, COALESCE(s.n_live_tup, 0) AS satir
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname`);
  return r.rows;
}

const SATIR_SINIRI = Number(process.env.YEDEK_SATIR_SINIRI || 50000);

// Parola özetleri yedekte maskelenir — geri yüklemede gerekmez, e-postayla dolaşmamalı
const GIZLI_KOLONLAR = /^(password|password_hash|parola|sifre|hash|token|api_key|secret)$/i;
function hucre(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v;
  if (Buffer.isBuffer(v)) return "[ikili veri]";
  if (typeof v === "object") { try { return JSON.stringify(v).slice(0, 32000); } catch { return "[nesne]"; } }
  if (typeof v === "string" && v.length > 32000) return v.slice(0, 32000) + "…";
  return v;
}

/** Tüm tabloları tek workbook'a yazar → { buffer, tablo, satir, atlanan[] } */
async function yedekExcelUret(pool) {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERC Sistem Yedeği";
  wb.created = new Date();
  const tablolar = await yedekTablolar(pool);
  const ozet = wb.addWorksheet("YEDEK ÖZETİ", { views: [{ showGridLines: false }] });
  ozet.columns = [
    { header: "Tablo", key: "t", width: 34 },
    { header: "Satır", key: "s", width: 12 },
    { header: "Sayfa", key: "p", width: 34 },
    { header: "Not", key: "n", width: 40 },
  ];
  ozet.getRow(1).font = { bold: true };
  const kullanilan = new Set(["YEDEK ÖZETİ"]);
  const atlanan = [];
  let toplamSatir = 0, yazilanTablo = 0;

  for (const { tablo } of tablolar) {
    let ad = String(tablo).replace(/[\\/*?:[\]]/g, "_").slice(0, 31);
    let i = 2;
    while (kullanilan.has(ad)) ad = (String(tablo).slice(0, 27) + "_" + i++).slice(0, 31);
    kullanilan.add(ad);
    try {
      const guvenliAd = '"' + String(tablo).replace(/"/g, '""') + '"';
      const { rows, fields } = await pool.query(`SELECT * FROM public.${guvenliAd} LIMIT ${SATIR_SINIRI}`);
      const basliklar = (fields || []).map((f) => f.name);
      const ws = wb.addWorksheet(ad, { views: [{ showGridLines: false, state: "frozen", ySplit: 1 }] });
      if (basliklar.length) {
        ws.addRow(basliklar);
        ws.getRow(1).font = { bold: true, size: 10 };
        ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
        for (const r of rows) ws.addRow(basliklar.map((b) => (GIZLI_KOLONLAR.test(b) && r[b] ? "[gizli]" : hucre(r[b]))));
        ws.columns.forEach((c) => { c.width = 18; });
      }
      toplamSatir += rows.length; yazilanTablo++;
      ozet.addRow({ t: tablo, s: rows.length, p: ad, n: rows.length >= SATIR_SINIRI ? `İlk ${SATIR_SINIRI} satır` : "" });
    } catch (e) {
      atlanan.push({ tablo, hata: e.message });
      ozet.addRow({ t: tablo, s: 0, p: ad, n: "HATA: " + e.message });
    }
  }
  const buffer = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), tablo: yazilanTablo, satir: toplamSatir, atlanan };
}

async function yedekTablo(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS yedek_log (
    id SERIAL PRIMARY KEY,
    tip TEXT NOT NULL,
    gonderim_ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    alicilar TEXT,
    dosya_adi TEXT,
    boyut_kb INTEGER,
    tablo_sayisi INTEGER,
    satir_sayisi INTEGER,
    durum TEXT,
    hata TEXT
  )`);
  await pool.query(`ALTER TABLE yedek_log ENABLE ROW LEVEL SECURITY`).catch(() => {});
}

/** Yedeği üretip e-posta ile gönderir. tip: "3GUN" | "HAFTA" */
async function yedekGonder(pool, tip) {
  const kural = YEDEK_TIPLERI[tip];
  if (!kural) throw new Error("Bilinmeyen yedek tipi: " + tip);
  const ayar = smtpAyari();
  if (!ayar) throw new Error("SMTP ayarları eksik (SMTP_HOST / SMTP_USER / SMTP_PASS)");
  const alicilar = epostalar(kural.alicilar);
  if (!alicilar.length) throw new Error("Alıcı tanımlı değil");

  await yedekTablo(pool);
  const bugun = new Date().toLocaleDateString("tr-TR").replace(/\./g, "-");
  const { buffer, tablo, satir, atlanan } = await yedekExcelUret(pool);
  const dosyaAdi = `ERC_Sistem_Yedegi_${bugun}.xlsx`;
  const boyutKb = Math.round(buffer.length / 1024);

  const nodemailer = require("nodemailer");
  const transporter = nodemailer.createTransport(ayar);
  const govde = `ERC sistem yedeği ektedir.

Tarih: ${new Date().toLocaleString("tr-TR")}
Kapsam: ${tablo} tablo · ${satir.toLocaleString("tr-TR")} satır (her tablo ayrı sayfa)
Dosya: ${dosyaAdi} (${boyutKb.toLocaleString("tr-TR")} KB)
${atlanan.length ? `Okunamayan tablo: ${atlanan.map((a) => a.tablo).join(", ")}\n` : ""}
Not: Saha fotoğrafları ve belgeleri bu yedeğe dahil değildir; dosya deposunda tutulur.

Bu e-posta ERC sisteminden otomatik gönderilmiştir.`;

  try {
    await transporter.sendMail({
      from: ayar.from,
      to: alicilar.join(", "),
      subject: `ERC Sistem Yedeği — ${new Date().toLocaleDateString("tr-TR")} (${kural.ad})`,
      text: govde,
      attachments: [{ filename: dosyaAdi, content: buffer }],
    });
    await pool.query(
      `INSERT INTO yedek_log (tip, alicilar, dosya_adi, boyut_kb, tablo_sayisi, satir_sayisi, durum)
       VALUES ($1,$2,$3,$4,$5,$6,'OK')`,
      [tip, alicilar.join(", "), dosyaAdi, boyutKb, tablo, satir]);
    console.log(`YEDEK ${tip} gönderildi → ${alicilar.join(", ")} (${boyutKb} KB)`);
    return { ok: true, dosyaAdi, boyutKb, tablo, satir, alicilar };
  } catch (e) {
    await pool.query(
      `INSERT INTO yedek_log (tip, alicilar, dosya_adi, boyut_kb, tablo_sayisi, satir_sayisi, durum, hata)
       VALUES ($1,$2,$3,$4,$5,$6,'HATA',$7)`,
      [tip, alicilar.join(", "), dosyaAdi, boyutKb, tablo, satir, e.message]).catch(() => {});
    throw e;
  }
}

/** Zamanı gelen yedekleri gönderir (saatte bir çağrılır) */
async function yedekKontrol(pool) {
  if (String(process.env.YEDEK_AKTIF || "true") !== "true") return;
  if (!smtpAyari()) return; // SMTP tanımlanana kadar sessiz bekler
  await yedekTablo(pool);
  for (const [tip, kural] of Object.entries(YEDEK_TIPLERI)) {
    try {
      const son = await pool.query(
        `SELECT MAX(gonderim_ts) AS ts FROM yedek_log WHERE tip = $1 AND durum = 'OK'`, [tip]);
      const sonTs = son.rows[0]?.ts ? new Date(son.rows[0].ts) : null;
      const gecen = sonTs ? (Date.now() - sonTs.getTime()) / 86400000 : Infinity;
      if (gecen >= kural.gun) await yedekGonder(pool, tip);
    } catch (e) {
      console.error(`YEDEK ${tip} HATA:`, e.message);
    }
  }
}

function yedekBaslat(pool) {
  // İlk kontrol açılıştan 3 dk sonra, sonra saatte bir
  setTimeout(() => yedekKontrol(pool).catch(() => {}), 3 * 60 * 1000);
  setInterval(() => yedekKontrol(pool).catch(() => {}), 60 * 60 * 1000);
}

module.exports = { yedekExcelUret, yedekGonder, yedekKontrol, yedekBaslat, yedekTablo, smtpAyari, YEDEK_TIPLERI };
