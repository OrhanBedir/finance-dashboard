require("dotenv").config();

// ── Global hata yakalayıcılar – server çökmesini önler ──────────────────────
process.on("unhandledRejection", (reason, promise) => {
  console.error("⚠️  Unhandled Promise Rejection:", reason?.message || reason);
});
process.on("uncaughtException", (err) => {
  console.error("⚠️  Uncaught Exception:", err.message);
});
// ────────────────────────────────────────────────────────────────────────────

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// ── RESEND EMAIL HELPER ──────────────────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY || "";
  if (!apiKey) { console.warn("RESEND_API_KEY not set, skipping email to:", to); return; }
  const fromEmail = process.env.FROM_EMAIL || "Omnix Platform <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromEmail, to: Array.isArray(to) ? to : [to], subject, html }),
    });
    const data = await res.json();
    if (!res.ok) console.error("Resend error:", data);
    else console.log("✅ Email sent to:", to);
  } catch (e) { console.error("sendEmail error:", e.message); }
}

const TENANT_CONFIG = {
  erc: {
    name: "ERC Mühendislik",
    display: "ERC | Operasyon ve Hakediş Takip Sistemi",
    owner_email: "duzgun.simsek@simsektel.com",
    domains: ["simsektel.com"],
  },
  "2kx": {
    name: "2KX Haberleşme Sistemleri",
    display: "2KX | Operasyon ve Hakediş Takip Sistemi",
    owner_email: "serdar.altinova@simsektel.com",
    domains: [],
  },
};

// Platform sahibi — yeni firma/kullanıcı kayıt taleplerinin onayı buraya gelir.
const PLATFORM_ADMIN_EMAIL = "orhan.bedir@gmail.com";

function detectTenant(email, subconName) {
  const s = String(subconName || "").toUpperCase();
  if (s.includes("2KX")) return "2kx";
  const domain = String(email || "").toLowerCase().split("@")[1] || "";
  if (domain === "simsektel.com") return "erc";
  return "erc";
}
// ────────────────────────────────────────────────────────────────────────────
const { createWorker } = require("tesseract.js");
const { detectRegion } = require("./utils/regionHelper");
const { applyPremiumExcelStyle } = require("./utils/excelStyle");
const { uploadToStorage, deleteFromStorage, supabase, BUCKET } = require("./supabase-storage");

// ─── OCR HELPER ──────────────────────────────────────────────────────────────

// Türkçe/OCR para formatı dönüştürücü
// Desteklenen: 3.000,00 | 3,000,00 (OCR) | 500,00 | 3.000 | 3000
function parseTrNumber(str) {
  if (!str) return 0;
  let s = str.trim().replace(/[*+]/g, "").trim();
  if (!s) return 0;

  const dotCount   = (s.match(/\./g) || []).length;
  const commaCount = (s.match(/,/g)  || []).length;

  // 3.000,00 → nokta=binlik, virgül=ondalık
  if (dotCount >= 1 && commaCount === 1) {
    return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  }

  // 3,000,00 → OCR nokta yerine virgül koymuş: virgül(ler)=binlik, son virgül=ondalık
  if (commaCount >= 2) {
    const parts    = s.split(",");
    const lastPart = parts[parts.length - 1];  // ondalık kısım
    const whole    = parts.slice(0, -1).join(""); // binlik virgülleri sil
    return parseFloat(whole + "." + lastPart) || 0;
  }

  // 500,00 → tek virgül, 2 basamak → ondalık
  if (commaCount === 1) {
    const dec = s.split(",")[1] || "";
    if (dec.length <= 2) return parseFloat(s.replace(",", ".")) || 0;
    // 44,640 gibi → muhtemelen litre, ondalık say
    return parseFloat(s.replace(",", ".")) || 0;
  }

  // 3.000 → tek nokta, 3 basamak sonra → binlik
  if (dotCount === 1) {
    const dec = s.split(".")[1] || "";
    if (dec.length === 3) return parseFloat(s.replace(".", "")) || 0;
    return parseFloat(s) || 0;
  }

  // Birden fazla nokta: 1.000.000 → binlik
  if (dotCount >= 2) {
    return parseFloat(s.replace(/\./g, "")) || 0;
  }

  return parseFloat(s) || 0;
}

// Türkçe/OCR para sayısı regex: 3.000,00 | 3,000,00 | 500,00 | 3.000 | 3000
const TR_NUM_RE = /[*+]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?(?!\d)/g;

function formatAd(ad) {
  const parts = (ad || "").trim().split(/\s+/);
  if (parts.length < 2) return (ad || "").toUpperCase();
  return parts.slice(0, -1).join(" ") + " " + parts[parts.length - 1].toUpperCase();
}

// DB'deki plakayı OCR okunmuş plakaya fuzzy eşleştir (1 karakter tolerans)
function plakaEsles(ocrRaw, dbPlakalar) {
  const normalize = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const ocr = normalize(ocrRaw);
  // Tam eşleşme önce
  const exact = dbPlakalar.find(p => normalize(p) === ocr);
  if (exact) return exact;
  // 1 karakter farkı tolerans (OCR hataları için)
  return dbPlakalar.find(p => {
    const db = normalize(p);
    if (Math.abs(db.length - ocr.length) > 1) return false;
    let diff = 0;
    const maxLen = Math.max(db.length, ocr.length);
    for (let i = 0; i < maxLen; i++) {
      if (db[i] !== ocr[i]) diff++;
      if (diff > 1) return false;
    }
    return true;
  }) || null;
}

function parseOcrText(text) {
  const lines = text.split("\n");
  let amount = null;
  const KEY_RE = /(GENEL\s*TOPLAM|TOPLAM|KRED[İI]|NAK[İI]T|TUTAR|TOTAL)/i;
  // Kimlik/no satırları: MERSİS, REF, ONAY, terminal vb. — tutar DEĞİLDİR,
  // fallback'te bunlardan sayı alınmaz (879 hatası: MERSİS 0879'dan geliyordu)
  const ID_RE = /(MERS[İI]S|REF|ONAY|TERM[İI]NAL|S[İI]C[İI]L|EK[ÜU]|Z\s*NO|F[İI][ŞS]\s*NO|[ÇC]EK\s*NO|MASA|K\.?\s*N\.?|VERG[İI]|V\.?D\.?|TAR[İI]H|SAAT|TEL|NO\s*[:.]|\bAID\b|BANKA|https?|WWW)/i;
  const numsOf = (s) => (s.match(TR_NUM_RE) || []).map(parseTrNumber).filter(n => n >= 1 && n <= 999999);
  // 1) Satır başında anahtar kelime; tutar aynı satırda yoksa (sütunlu fiş)
  //    bir sonraki satıra da bak
  for (let i = 0; i < lines.length; i++) {
    if (/^[\s*]*(GENEL\s*TOPLAM|TOPLAM|KRED[İI]|NAK[İI]T|TUTAR|TOTAL)/i.test(lines[i])) {
      let nums = numsOf(lines[i]);
      if (!nums.length && lines[i + 1] && !KEY_RE.test(lines[i + 1]) && !ID_RE.test(lines[i + 1])) {
        nums = numsOf(lines[i + 1]);
      }
      if (nums.length) { amount = Math.max(...nums); break; }
    }
  }
  // 2) Anahtar kelime satır içinde (kimlik satırları hariç)
  if (!amount) {
    for (const line of lines) {
      if (KEY_RE.test(line) && !ID_RE.test(line)) {
        const nums = numsOf(line);
        if (nums.length) { amount = Math.max(...nums); break; }
      }
    }
  }
  // 3) Son çare: kimlik/no satırları HARİÇ; önce ondalıklı (,00 biçimli)
  //    sayılar — çıplak no'lar (MERSİS, ref, onay) tutar sanılmaz
  if (!amount) {
    const decNums = [], anyNums = [];
    for (const line of lines) {
      if (ID_RE.test(line)) continue;
      for (const m of (line.match(TR_NUM_RE) || [])) {
        const n = parseTrNumber(m);
        if (n < 1 || n > 999999) continue;
        anyNums.push(n);
        if (/[.,]\d{2}$/.test(m)) decNums.push(n);
      }
    }
    const pool = decNums.length ? decNums : anyNums;
    if (pool.length) amount = Math.max(...pool);
  }
  // Türk plaka formatı: 2 rakam + 1-3 HARF (rakam değil) + 2-4 rakam
  // Örn: 16GB307, 34ABC1234, 06A1234
  const plateRe = /\b(\d{2})\s*([A-ZÇŞĞÜÖİ]{1,3})\s*(\d{2,4})\b/g;
  const rawPlates = [...text.matchAll(plateRe)]
    .map(m => (m[1] + m[2] + m[3]).toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .filter(p => p.length >= 5 && p.length <= 8);
  // En uzun eşleşmeyi önce al (gerçek plakalar genelde daha uzun)
  rawPlates.sort((a, b) => b.length - a.length);
  return { amount: amount || null, plaka: rawPlates[0] || null, rawPlates };
}

async function ocrFis(fileBuffer) {
  try {
    const apiKey = process.env.OCR_SPACE_KEY || "helloworld";
    const base64 = fileBuffer.toString("base64");
    const body = new URLSearchParams({
      base64Image: `data:image/jpeg;base64,${base64}`,
      language: "tur",
      isOverlayRequired: "false",
      detectOrientation: "true",
      scale: "true",
      OCREngine: "2",
    });
    const resp = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const json = await resp.json();
    const text = json?.ParsedResults?.[0]?.ParsedText || "";
    console.log("[OCR.space] text snippet:", text.slice(0, 200));
    return parseOcrText(text);
  } catch (e) {
    console.error("[OCR error]", e.message);
    return { amount: null, plaka: null, rawPlates: [] };
  }
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Token yok" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;

    next();
  } catch {
    return res.status(401).json({ error: "Geçersiz token" });
  }
}

// Taşeron adını kanonik forma indirir: 'AHY ELEKTRİK' ve 'AHY' aynı firmadır
function canonSub(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("federal")) return "federal";
  if (n.includes("ubs")) return "ubs";
  if (n.includes("ahy")) return "ahy";
  if (n.includes("2kx")) return "2kx";
  if (n.includes("ferrum")) return "ferrumx";
  return n.trim();
}

// Veri kapsamı: subcon rolü VEYA alt marka (hw_yukleme=false, ör. AHY yönetimi)
// VEYA yönetici olmayan taşeron-adlı kullanıcı (ör. 2KX Serdar gmail) yalnız
// kendi taşeron satırlarını görür. Dönen değer kapsam adı ya da null.
// Multer, dosya adını latin1 olarak çözer — Türkçe karakterli adlar
// "Ä°zmir SÃ¶zleÅŸme" gibi bozulur. UTF-8'e geri çevir (ASCII adlarda no-op).
function utf8Name(name) {
  const s = String(name || "");
  try {
    const fixed = Buffer.from(s, "latin1").toString("utf8");
    return fixed.includes("�") ? s : fixed;
  } catch { return s; }
}

function subconScope(req) {
  const name = String(req.user?.subcon_name || "").trim();
  if (!name) return null;
  const role = String(req.user?.role || "").toLowerCase();
  if (role === "subcon") return name;
  if (req.user?.hw_yukleme === false) return name; // alt marka tam paneli (info@ahyelektrik.com)
  if (!["admin", "platform_admin", "direktor", "muhasebe", "genel_mudur"].includes(role)) return name;
  return null;
}

// FERRUMX istisnası (07.08.2026): firma hem Şimşek'e direkt ("FERRUMX")
// hem AHY üzerinden ("AHY_FERRUMX") iş yapıyor. FERRUMX yöneticisi ikisini
// birlikte görür; AHY tarafı da AHY_FERRUMX'i görmeye devam eder (canon 'ahy').
function subconRowMatches(scopeName, rowSubcon) {
  const c = canonSub(scopeName);
  if (c === "ferrumx") return String(rowSubcon || "").toLowerCase().includes("ferrum");
  return canonSub(rowSubcon) === c;
}

function applySubconFilter(req, rows) {
  const scopeName = subconScope(req);
  if (!scopeName) return rows || [];
  return (rows || []).filter((row) => subconRowMatches(scopeName, row.subcon_name));
}

const pool = require("./db");
const { bindRequestToTenant, ensureTenantSchema, isIsolatedTenant, addIsolatedTenant, removeIsolatedTenant } = pool;
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/health", (req, res) => res.json({ ok: true, status: "running", v: "masraf-taslak-resume-v10" }));

function requireAdmin(req, res, next) {
  // platform_admin (uygulama sahibi) firma admininin yapabildiği her şeyi yapabilir.
  if (!req.user || (req.user.role !== "admin" && req.user.role !== "platform_admin")) {
    return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
  }
  next();
}

// Yalnızca platform sahibi (uygulamanın admini). Firma adminleri (role='admin')
// buradan geçemez → yeni firma onayı / tenant yönetimi gibi platform-seviyesi
// işlemler sadece platform_admin'e açıktır.
function requirePlatformAdmin(req, res, next) {
  if (!req.user || req.user.role !== "platform_admin") {
    return res.status(403).json({ ok: false, error: "Bu işlem yalnızca platform sahibine açıktır" });
  }
  next();
}

// ── FİRMA-BAZLI KULLANICI GÖRÜNÜRLÜĞÜ ────────────────────────────────────────
// Bir adminin başka bir kullanıcıyı görebilmesi/yönetebilmesi kuralı:
//  - platform_admin (uygulama sahibi) → tüm firmaların kullanıcıları
//  - izole firma admini → YALNIZCA kendi tenant'ının kullanıcıları
//  - ERC ailesi admini (erc / legacy 2kx / null) → izole OLMAYAN tüm kullanıcılar
//    (ERC'nin mevcut davranışı korunur; yeni izole firmaların kullanıcıları sızmaz)
function adminCanSeeUserTenant(reqUser, targetTenant) {
  if (reqUser?.role === "platform_admin") return true;
  const myTenant = String(reqUser?.tenant || "erc").toLowerCase();
  const tt = String(targetTenant || "erc").toLowerCase();
  if (isIsolatedTenant(myTenant)) return tt === myTenant;
  return !isIsolatedTenant(tt);
}
// İzole firma admini ise yeni oluşturduğu kullanıcı kendi firmasına ait olur;
// değilse (ERC ailesi) tenant null bırakılır → mevcut davranış korunur.
function adminCreateTenant(reqUser) {
  const myTenant = String(reqUser?.tenant || "").toLowerCase();
  return isIsolatedTenant(myTenant) ? myTenant : null;
}
// Bir mutasyon ucunda hedef kullanıcıyı görme yetkisini kontrol eder.
async function guardUserScope(req, res, id) {
  try {
    const r = await pool.query("SELECT tenant FROM users WHERE id=$1", [id]);
    if (r.rows.length === 0) {
      res.status(404).json({ ok: false, error: "Kullanıcı bulunamadı" });
      return false;
    }
    if (!adminCanSeeUserTenant(req.user, r.rows[0].tenant)) {
      res.status(403).json({ ok: false, error: "Bu kullanıcı sizin firmanıza ait değil" });
      return false;
    }
    return true;
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
    return false;
  }
}

function getWeekNumber(date) {
  const d = new Date(date);
  const oneJan = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
}

app.use((req, res, next) => {
  const origin = req.headers.origin;

  const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://finance-dashboard-topaz-three.vercel.app",
    "https://finance-dashboard.vercel.app",
    "https://finance-dashboard-3yns.vercel.app",
    "https://app.omnix.global",
  ];

  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }

  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// ── MULTI-TENANT BAĞLAM MIDDLEWARE ───────────────────────────────────────────
// İsteğin tenant'ını JWT'den (varsa) çözer. erc / token'sız istekler hiçbir
// değişikliğe uğramaz (varsayılan public havuzu). erc dışı tenant istekleri,
// isteğin tüm süresi boyunca o tenant'ın şemasına bağlanır → tüm pool.query
// çağrıları otomatik olarak o şemaya yönlenir. ERC yolu byte-for-byte aynıdır.
app.use((req, res, next) => {
  let tenant = "erc";
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(" ")[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      tenant = decoded.tenant || "erc";
    } catch {
      // Geçersiz/finance token → tenant çözülemedi, public'te kal (ERC davranışı).
    }
  }
  // Şema izolasyonu yalnızca allow-list'teki izole tenant'lar için devreye girer.
  // Diğer tüm istekler (ERC, legacy '2kx' taşeron görünümü, token'sız) public'te kalır.
  if (!isIsolatedTenant(tenant)) return next();
  bindRequestToTenant(tenant, res, () => { next(); }).catch((e) => {
    console.error("[tenant-middleware] bağlam hatası:", e.message);
    next();
  });
});

// TÜM KULLANICILARI LİSTELE
app.get("/admin/users", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, email, role, is_active, created_at, tenant, marka, subcon_name
      FROM users
      ORDER BY id DESC
    `);

    // Firma-bazlı görünürlük: admin sadece kendi kapsamındaki kullanıcıları görür.
    const visible = result.rows.filter((u) => adminCanSeeUserTenant(req.user, u.tenant));
    res.json({ ok: true, users: visible });
  } catch (err) {
    console.error("ADMIN USERS LIST ERROR:", err);
    res.status(500).json({ ok: false, error: "Kullanıcılar alınamadı" });
  }
});
app.post("/admin/users", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { name, password, role = "user" } = req.body;
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!name || !email || !password) {
      return res.status(400).json({
        ok: false,
        error: "Ad, email ve şifre zorunlu",
      });
    }

    // Marka (ERC / AHY vb.) — geçersizse ERC'ye düşer
    let marka = String(req.body.marka || "ERC").trim().toUpperCase();
    try {
      const mr = await pool.query("SELECT kod FROM markalar WHERE kod=$1 AND aktif=true", [marka]);
      if (!mr.rows.length) marka = "ERC";
    } catch { marka = "ERC"; }

    const hashed = await bcrypt.hash(password, 10);

    // Aynı email varsa şifre + aktif güncelle, yoksa yeni kayıt ekle
    const existing = await pool.query(
      `SELECT id FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1`,
      [email]
    );
    let result;
    if (existing.rows.length > 0) {
      result = await pool.query(
        `UPDATE users SET name=$1, password_hash=$2, role=$3, is_active=true, marka=$5
         WHERE id=$4 RETURNING id, name, email, role, is_active, marka`,
        [name, hashed, role, existing.rows[0].id, marka]
      );
    } else {
      // İzole firma admini eklerse kullanıcı kendi firmasına ait olur.
      const newTenant = adminCreateTenant(req.user);
      result = await pool.query(
        `INSERT INTO users (name, email, password_hash, role, is_active, tenant, marka)
         VALUES ($1, $2, $3, $4, true, $5, $6)
         RETURNING id, name, email, role, is_active, marka`,
        [name, email, hashed, role, newTenant, marka],
      );
    }

    // Personel rolündeki kullanıcı için İK personel kaydını da aç/güncelle —
    // İş Avansı ve diğer İK listeleri users değil personel tablosundan beslenir.
    // Kayıt açılmazsa yeni eklenen kullanıcı avans formlarında görünmez.
    if (String(role).toLowerCase() === "user") {
      try {
        const normName = String(name).trim().toLowerCase()
          .replace(/ı/g, "i").replace(/İ/g, "i").replace(/ğ/g, "g")
          .replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c");
        const pr = await pool.query(
          `SELECT id FROM personel
           WHERE LOWER(TRIM(email)) = $1
              OR LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                   TRIM(ad_soyad),'İ','I'),'Ş','S'),'Ğ','G'),'Ü','U'),'Ö','O'),'Ç','C'))
                 = REPLACE($2,'ı','i')
           LIMIT 1`,
          [email, normName]
        );
        if (pr.rows.length > 0) {
          await pool.query(
            `UPDATE personel SET email=$1, marka=$2, aktif=true WHERE id=$3`,
            [email, marka, pr.rows[0].id]
          );
        } else {
          await pool.query(
            `INSERT INTO personel (ad_soyad, email, marka, aktif, ise_giris_tarihi)
             VALUES ($1, $2, $3, true, CURRENT_DATE)`,
            [name, email, marka]
          );
        }
      } catch (e) {
        console.error("ADMIN USER PERSONEL SYNC ERROR:", e.message);
      }
    }

    res.json({ ok: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.put(
  "/admin/users/:id/active",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    console.log("ACTIVE ROUTE HIT:", req.params.id);

    try {
      const { id } = req.params;
      if (!(await guardUserScope(req, res, id))) return;

      const result = await pool.query(
        `
        UPDATE users
        SET is_active = NOT is_active
        WHERE id = $1
        RETURNING id, is_active
        `,
        [id],
      );

      if (result.rowCount === 0) {
        return res
          .status(404)
          .json({ ok: false, error: "Kullanıcı bulunamadı" });
      }

      console.log("ACTIVE TOGGLED:", result.rows[0]);

      res.json({ ok: true, user: result.rows[0] });
    } catch (err) {
      console.error("ACTIVE TOGGLE ERROR:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  },
);

app.delete(
  "/admin/users/:id",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!(await guardUserScope(req, res, id))) return;

      await pool.query(`DELETE FROM users WHERE id = $1`, [id]);

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  },
);

// YENİ KULLANICI EKLE
app.post("/admin/users", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role = "user",
      subcon_name = null,
      payment_rate = null,
    } = req.body;

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ ok: false, error: "Ad, email ve şifre zorunlu" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      INSERT INTO users (
        name,
        email,
        password_hash,
        role,
        is_active,
        subcon_name,
        payment_rate
      )
      VALUES ($1, $2, $3, $4, true, $5, $6)
      RETURNING id, name, email, role, is_active, created_at, subcon_name, payment_rate
      `,
      [name, email, passwordHash, role, subcon_name, payment_rate],
    );

    res.json({ ok: true, user: result.rows[0] });
  } catch (err) {
    console.error("ADMIN USER CREATE ERROR:", err);
    res.status(500).json({ ok: false, error: "Kullanıcı eklenemedi" });
  }
});

// ROL GÜNCELLE
app.put(
  "/admin/users/:id/role",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { role, subcon_name } = req.body;

      if (!role || !["admin", "user", "subcon", "rollout_mudur", "genel_mudur", "pm", "direktor", "muhasebe"].includes(role)) {
        return res.status(400).json({ ok: false, error: "Geçersiz rol" });
      }
      if (role === "subcon" && !String(subcon_name || "").trim()) {
        return res.status(400).json({ ok: false, error: "Taşeron rolü için taşeron adı zorunlu" });
      }
      if (!(await guardUserScope(req, res, id))) return;

      // Taşeron rolünde firma adı da yazılır; başka role geçilirse kapsam temizlenir
      const result = await pool.query(
        `
      UPDATE users
      SET role = $1,
          subcon_name = CASE WHEN $1 = 'subcon' THEN $3 ELSE NULL END
      WHERE id = $2
      RETURNING id, name, email, role, subcon_name, is_active, created_at
      `,
        [role, id, String(subcon_name || "").trim().toUpperCase() || null],
      );

      if (!result.rows.length) {
        return res
          .status(404)
          .json({ ok: false, error: "Kullanıcı bulunamadı" });
      }

      res.json({ ok: true, user: result.rows[0] });
    } catch (err) {
      console.error("ADMIN USER ROLE UPDATE ERROR:", err);
      res.status(500).json({ ok: false, error: "Rol güncellenemedi" });
    }
  },
);

// MARKA DEĞİŞTİR (ERC / AHY vb. — tenant içi white-label)
app.put(
  "/admin/users/:id/marka",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const marka = String(req.body.marka || "").trim().toUpperCase();
      const mr = await pool.query("SELECT kod FROM markalar WHERE kod=$1 AND aktif=true", [marka]);
      if (!mr.rows.length) return res.status(400).json({ ok: false, error: "Geçersiz marka" });
      if (!(await guardUserScope(req, res, id))) return;
      const result = await pool.query(
        "UPDATE users SET marka=$1 WHERE id=$2 RETURNING id, name, email, role, marka",
        [marka, id],
      );
      if (!result.rows.length) return res.status(404).json({ ok: false, error: "Kullanıcı bulunamadı" });
      res.json({ ok: true, user: result.rows[0] });
    } catch (err) {
      console.error("ADMIN USER MARKA UPDATE ERROR:", err);
      res.status(500).json({ ok: false, error: "Marka güncellenemedi" });
    }
  },
);

// MARKA LİSTESİ (admin panel dropdown'u için)
app.get("/admin/markalar", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT kod, ad, hw_yukleme, kirilim_yuzde FROM markalar WHERE aktif=true ORDER BY id",
    );
    res.json({ ok: true, markalar: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Markalar alınamadı" });
  }
});

// AKTİF / PASİF
app.put(
  "/admin/users/:id/status",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { is_active } = req.body;
      if (!(await guardUserScope(req, res, id))) return;

      const result = await pool.query(
        `
      UPDATE users
      SET is_active = $1
      WHERE id = $2
      RETURNING id, name, email, role, is_active, created_at
      `,
        [!!is_active, id],
      );

      if (!result.rows.length) {
        return res
          .status(404)
          .json({ ok: false, error: "Kullanıcı bulunamadı" });
      }

      res.json({ ok: true, user: result.rows[0] });
    } catch (err) {
      console.error("ADMIN USER STATUS UPDATE ERROR:", err);
      res.status(500).json({ ok: false, error: "Durum güncellenemedi" });
    }
  },
);

// ŞİFRE RESET
app.put(
  "/admin/users/:id/password",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { password } = req.body;

      if (!password) {
        return res.status(400).json({ ok: false, error: "Yeni şifre zorunlu" });
      }
      if (!(await guardUserScope(req, res, id))) return;

      const passwordHash = await bcrypt.hash(password, 10);

      const result = await pool.query(
        `
      UPDATE users
      SET password_hash = $1
      WHERE id = $2
      RETURNING id, name, email, role, is_active, created_at
      `,
        [passwordHash, id],
      );

      if (!result.rows.length) {
        return res
          .status(404)
          .json({ ok: false, error: "Kullanıcı bulunamadı" });
      }

      res.json({ ok: true, user: result.rows[0] });
    } catch (err) {
      console.error("ADMIN USER PASSWORD RESET ERROR:", err);
      res.status(500).json({ ok: false, error: "Şifre güncellenemedi" });
    }
  },
);

console.log("DB MODE:", process.env.DATABASE_URL ? "DATABASE_URL" : "LOCAL_DB");
console.log("DATABASE_URL EXISTS:", !!process.env.DATABASE_URL);
/* ================== MIDDLEWARE ================== */
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://finance-dashboard-topaz-three.vercel.app",
  "https://finance-dashboard.vercel.app",
  "https://finance-dashboard-3yns.vercel.app",
  "https://app.omnix.global",
];

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }

  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        error: "E-posta ve şifre zorunlu",
      });
    }

    const result = await pool.query(
      `
      SELECT id, name, email, password_hash, role, is_active, subcon_name, payment_rate, tenant, status, marka
      FROM users
      WHERE LOWER(TRIM(email)) = $1
      ORDER BY id DESC
      LIMIT 1
      `,
      [String(email).trim().toLowerCase()],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        ok: false,
        error: "Kullanıcı bulunamadı",
      });
    }

    const user = result.rows[0];

    // ── PLATFORM SAHİBİ OTOMATİK ONARIM ───────────────────────────────────────
    // Uygulamanın sahibi (orhan.bedir@gmail.com) giriş anında, eğer pasif veya
    // platform_admin değilse, otomatik olarak aktif + platform_admin yapılır.
    // Şifresine dokunulmaz. Böylece kayıt/deploy zamanlamasından bağımsız olarak
    // ilk giriş denemesinde platform sahibi yetkisiyle içeri girer.
    if (String(user.email || "").toLowerCase() === PLATFORM_ADMIN_EMAIL) {
      if (!user.is_active || user.role !== "platform_admin" || user.status !== "active") {
        try {
          await pool.query(
            `UPDATE users SET role='platform_admin', is_active=true, status='active' WHERE id=$1`,
            [user.id]
          );
        } catch (e) {
          console.error("[platform-admin] login onarımı:", e.message);
        }
        user.is_active = true;
        user.role = "platform_admin";
        user.status = "active";
      }
    }

    if (!user.is_active) {
      return res.status(403).json({
        ok: false,
        error: "Kullanıcı pasif durumda",
      });
    }

    const userStatus = String(user.status || 'active');
    if (userStatus === 'pending') {
      return res.status(403).json({ ok: false, error: "Hesabınız onay bekliyor. Şirket yöneticiniz onayladıktan sonra giriş yapabilirsiniz." });
    }
    if (userStatus === 'rejected') {
      return res.status(403).json({ ok: false, error: "Hesabınız onaylanmadı. Yöneticinizle iletişime geçin." });
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);

    if (!passwordOk) {
      return res.status(401).json({
        ok: false,
        error: "Şifre hatalı",
      });
    }

    const financeAllowedUsers = String(process.env.FINANCE_ALLOWED_USERS || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);

    const userEmail = String(user.email || "").toLowerCase();
    const userRole = String(user.role || "").toLowerCase();

    const isAdminUser =
      userEmail === "orhan@simsektel.com" ||
      userRole === "admin" ||
      userRole === "platform_admin" ||
      userRole === "genel_mudur";

    // Finans erişimi olan kullanıcılar: admin, FINANCE_ALLOWED_USERS listesi,
    // finance/muhasebe rolleri, veya hardcoded finans yetkilileri
    const FINANCE_HARDCODED = ["nurcan.kus@simsektel.com", "orhan@simsektel.com"];
    const scope =
      isAdminUser ||
      financeAllowedUsers.includes(userEmail) ||
      FINANCE_HARDCODED.includes(userEmail) ||
      userRole === "finance" ||
      userRole === "muhasebe"
        ? "finance"
        : "app";

    const userTenant = user.tenant || detectTenant(user.email, user.subcon_name);

    // Firma markası (white-label): kullanıcı giriş yapınca kendi firma adını
    // görür. erc/2kx yerleşik; izole firmalar tenant_registry'den okunur.
    let tenantName = TENANT_CONFIG[userTenant]?.name;
    if (!tenantName) {
      try {
        const tr = await pool.query("SELECT name FROM tenant_registry WHERE tenant=$1", [userTenant]);
        tenantName = tr.rows[0]?.name;
      } catch {}
    }
    tenantName = tenantName || (userTenant ? String(userTenant).toUpperCase() : "Omnix");

    // Marka katmanı: kullanıcının bağlı olduğu marka (ERC / AHY vb.).
    // marka_ad panelde tenant adının yerine gösterilir; hw_yukleme=false ise
    // HW yükleme menüleri gizlenir ve endpointler 403 döner.
    let markaKod = user.marka || null, markaAd = null, hwYukleme = true;
    if (markaKod) {
      try {
        const mr = await pool.query(
          "SELECT ad, hw_yukleme FROM markalar WHERE kod=$1 AND tenant=$2 AND aktif=true",
          [markaKod, userTenant],
        );
        if (mr.rows[0]) { markaAd = mr.rows[0].ad; hwYukleme = mr.rows[0].hw_yukleme !== false; }
      } catch {}
    }

    const token = jwt.sign(
      {
        user_id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        subcon_name: user.subcon_name || null,
        scope,
        tenant: userTenant,
        tenant_name: tenantName,
        marka: markaKod,
        marka_ad: markaAd,
        hw_yukleme: hwYukleme,
      },
      process.env.JWT_SECRET || "simsek_secret_degistir",
      { expiresIn: "7d" },
    );

    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        subcon_name: user.subcon_name,
        payment_rate: Number(user.payment_rate || 0.8),
        tenant: userTenant,
        tenant_name: tenantName,
        marka: markaKod,
        marka_ad: markaAd,
        hw_yukleme: hwYukleme,
      },
    });
  } catch (err) {
    console.error("AUTH LOGIN ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: "Giriş sırasında hata oluştu",
    });
  }
});

// GET /auth/me — oturum tazeleme: rol/marka bilgisi DB'den güncel döner.
// Admin panelde yapılan marka/rol değişiklikleri yeniden giriş GEREKTİRMEZ;
// uygulama her açılışta bunu çağırıp kullanıcı bilgisini yeniler.
app.get("/auth/me", authMiddleware, async (req, res) => {
  try {
    const email = String(req.user?.email || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ ok: false, error: "Oturum geçersiz" });
    const r = await pool.query(
      `SELECT id, name, email, role, is_active, subcon_name, payment_rate, tenant, status, marka
       FROM users WHERE LOWER(TRIM(email)) = $1 ORDER BY id DESC LIMIT 1`, [email]);
    const u = r.rows[0];
    if (!u || !u.is_active || String(u.status || "active") !== "active") {
      return res.status(401).json({ ok: false, error: "Kullanıcı pasif" });
    }
    const userTenant = u.tenant || detectTenant(u.email, u.subcon_name);
    let tenantName = TENANT_CONFIG[userTenant]?.name;
    if (!tenantName) {
      try {
        const tr = await pool.query("SELECT name FROM tenant_registry WHERE tenant=$1", [userTenant]);
        tenantName = tr.rows[0]?.name;
      } catch {}
    }
    tenantName = tenantName || (userTenant ? String(userTenant).toUpperCase() : "Omnix");
    let markaKod = u.marka || null, markaAd = null, hwYukleme = true;
    if (markaKod) {
      try {
        const mr = await pool.query(
          "SELECT ad, hw_yukleme FROM markalar WHERE kod=$1 AND tenant=$2 AND aktif=true",
          [markaKod, userTenant]);
        if (mr.rows[0]) { markaAd = mr.rows[0].ad; hwYukleme = mr.rows[0].hw_yukleme !== false; }
      } catch {}
    }
    res.json({ ok: true, user: {
      id: u.id, name: u.name, email: u.email, role: u.role,
      subcon_name: u.subcon_name, payment_rate: Number(u.payment_rate || 0.8),
      tenant: userTenant, tenant_name: tenantName,
      marka: markaKod, marka_ad: markaAd, hw_yukleme: hwYukleme,
    }});
  } catch (e) {
    console.error("AUTH ME ERROR:", e.message);
    res.status(500).json({ ok: false, error: "Oturum bilgisi alınamadı" });
  }
});

// POST /auth/register
app.post("/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ ok: false, error: "Ad, e-posta ve şifre zorunlu" });
    if (password.length < 6) return res.status(400).json({ ok: false, error: "Şifre en az 6 karakter olmalı" });
    const existing = await pool.query("SELECT id FROM users WHERE LOWER(TRIM(email)) = $1", [email.toLowerCase().trim()]);
    if (existing.rows.length > 0) return res.status(409).json({ ok: false, error: "Bu e-posta zaten kayıtlı" });
    const tenant = detectTenant(email, "");
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, is_active, status, tenant) VALUES ($1,$2,$3,'viewer',false,'pending',$4)`,
      [name, email.toLowerCase().trim(), hash, tenant]
    );
    const tConf = TENANT_CONFIG[tenant] || TENANT_CONFIG.erc;
    const appUrl = process.env.APP_URL || "https://app.omnix.global";
    // Onay her zaman platform sahibine (PLATFORM_ADMIN_EMAIL) gider; ayrıca ilgili
    // tenant sahibine de bilgi verilir. Tekrarlı adresler ayıklanır.
    const notifyTo = [...new Set([PLATFORM_ADMIN_EMAIL, tConf.owner_email].filter(Boolean))];
    await sendEmail({
      to: notifyTo,
      subject: `[Omnix] Yeni kayıt talebi — ${name}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><h2 style="color:#1e3a5f">Yeni Kullanıcı Kayıt Talebi</h2><p><strong>${name}</strong> (${email}) adlı kullanıcı Omnix platformuna kayıt olmak istiyor.</p><p>Bu kişi <strong>mevcut bir firmaya çalışan</strong> olarak mı yoksa <strong>yeni bir firma sahibi</strong> olarak mı eklenecek — onay ekranından seçebilirsiniz.</p><p><a href="${appUrl}" style="background:#1e3a5f;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Omnix'i Aç → Bekleyen Kullanıcılar</a></p></div>`,
    });
    res.json({ ok: true, message: "Kayıt talebiniz alındı. Şirket yöneticiniz onayladıktan sonra giriş yapabilirsiniz." });
  } catch (e) { console.error("REGISTER ERROR:", e.message); res.status(500).json({ ok: false, error: "Kayıt sırasında hata oluştu" }); }
});

// POST /auth/reset-password-request
app.post("/auth/reset-password-request", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ ok: false, error: "E-posta zorunlu" });
    const result = await pool.query("SELECT id, name FROM users WHERE LOWER(TRIM(email)) = $1", [email.toLowerCase().trim()]);
    if (result.rows.length === 0) return res.json({ ok: true, message: "E-posta adresiniz sistemde kayıtlıysa sıfırlama linki gönderildi." });
    const user = result.rows[0];
    const crypto = require("crypto");
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 3600000);
    await pool.query("UPDATE users SET reset_token=$1, reset_token_expires=$2 WHERE id=$3", [token, expires, user.id]);
    const appUrl = process.env.APP_URL || "https://app.omnix.global";
    await sendEmail({
      to: email.toLowerCase().trim(),
      subject: "[Omnix] Şifre Sıfırlama",
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><h2 style="color:#1e3a5f">Şifre Sıfırlama</h2><p>Merhaba ${user.name},</p><p>Şifre sıfırlama bağlantınız:</p><p style="margin:24px 0"><a href="${appUrl}?reset=${token}" style="background:#1e3a5f;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Şifremi Sıfırla</a></p><p style="color:#6b7280;font-size:13px">Bu link 1 saat geçerlidir.</p></div>`,
    });
    res.json({ ok: true, message: "E-posta adresiniz sistemde kayıtlıysa sıfırlama linki gönderildi." });
  } catch (e) { console.error("RESET REQUEST ERROR:", e.message); res.status(500).json({ ok: false, error: "Hata oluştu" }); }
});

// POST /auth/reset-password
app.post("/auth/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ ok: false, error: "Token ve yeni şifre zorunlu" });
    if (password.length < 6) return res.status(400).json({ ok: false, error: "Şifre en az 6 karakter olmalı" });
    const result = await pool.query("SELECT id FROM users WHERE reset_token=$1 AND reset_token_expires > NOW()", [token]);
    if (result.rows.length === 0) return res.status(400).json({ ok: false, error: "Geçersiz veya süresi dolmuş sıfırlama linki" });
    const hash = await bcrypt.hash(password, 10);
    await pool.query("UPDATE users SET password_hash=$1, reset_token=NULL, reset_token_expires=NULL WHERE id=$2", [hash, result.rows[0].id]);
    res.json({ ok: true, message: "Şifreniz başarıyla güncellendi. Giriş yapabilirsiniz." });
  } catch (e) { console.error("RESET PASSWORD ERROR:", e.message); res.status(500).json({ ok: false, error: "Hata oluştu" }); }
});

// GET /admin/pending-users
app.get("/admin/pending-users", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email, tenant, created_at FROM users WHERE status='pending' ORDER BY created_at DESC"
    );
    // Firma-bazlı görünürlük: izole firma admini sadece kendi bekleyenlerini,
    // platform sahibi hepsini, ERC ailesi admini izole olmayanları görür.
    const visible = result.rows.filter((u) => adminCanSeeUserTenant(req.user, u.tenant));
    res.json({ ok: true, rows: visible });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /admin/users/:id/approve
app.post("/admin/users/:id/approve", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name, email, tenant FROM users WHERE id=$1 AND status='pending'", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: "Kullanıcı bulunamadı" });
    const u = result.rows[0];
    if (!adminCanSeeUserTenant(req.user, u.tenant)) return res.status(403).json({ ok: false, error: "Bu kullanıcı sizin firmanıza ait değil" });
    await pool.query("UPDATE users SET status='active', is_active=true WHERE id=$1", [u.id]);
    const tConf = TENANT_CONFIG[u.tenant] || TENANT_CONFIG.erc;
    const appUrl = process.env.APP_URL || "https://app.omnix.global";
    await sendEmail({
      to: u.email,
      subject: `[Omnix] Hesabınız onaylandı`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><h2 style="color:#065f46">Hesabınız Onaylandı ✅</h2><p>Merhaba ${u.name}, <strong>${tConf.name}</strong> platformuna erişiminiz onaylandı.</p><p><a href="${appUrl}" style="background:#1e3a5f;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Omnix'e Git</a></p></div>`,
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /admin/users/:id/approve-company
// Bekleyen kullanıcıyı YENİ BİR İZOLE FİRMA SAHİBİ olarak onaylar:
//  - benzersiz tenant slug verilir ('erc'/'2kx' yasak)
//  - o tenant için boş şema provizyon edilir (ERC verisi kopyalanmaz)
//  - tenant_registry'ye yazılır + allow-list'e eklenir (anında izolasyon aktif)
//  - kullanıcı o tenant'ın admin'i yapılır (status active)
// Yalnızca platform sahibi (role='platform_admin') çağırabilir → yeni firma
// onayı firma adminlerine değil, uygulamanın sahibine aittir.
app.post("/admin/users/:id/approve-company", authMiddleware, requirePlatformAdmin, async (req, res) => {
  try {
    const { tenant_slug, tenant_name } = req.body || {};
    const slug = String(tenant_slug || "").toLowerCase().trim().replace(/[^a-z0-9_]/g, "");
    if (!slug) return res.status(400).json({ ok: false, error: "tenant_slug zorunlu" });
    if (slug === "erc" || slug === "2kx") return res.status(400).json({ ok: false, error: "Bu slug rezerve (erc/2kx kullanılamaz)" });

    // Platform sahibi herhangi bir kullanıcıyı (bekleyen VEYA mevcut) izole firma
    // sahibine dönüştürebilir. Sadece platform sahibi hesabı korunur.
    const result = await pool.query("SELECT id, name, email, role FROM users WHERE id=$1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: "Kullanıcı bulunamadı" });
    const u = result.rows[0];
    if (String(u.email || "").toLowerCase() === PLATFORM_ADMIN_EMAIL || u.role === "platform_admin") {
      return res.status(400).json({ ok: false, error: "Platform sahibi hesabı firmaya dönüştürülemez" });
    }

    // Slug başka bir firmaya aitse ve sahibi farklıysa engelle
    const existing = await pool.query("SELECT tenant, owner_email FROM tenant_registry WHERE tenant=$1", [slug]);
    if (existing.rows.length > 0 && String(existing.rows[0].owner_email || "").toLowerCase() !== u.email.toLowerCase()) {
      return res.status(409).json({ ok: false, error: "Bu slug zaten başka bir firmaya ait" });
    }

    // 1) Boş şema provizyonu (public yapısını kopyalar, veri kopyalamaz)
    const prov = await ensureTenantSchema(slug);
    if (!prov.ok) return res.status(500).json({ ok: false, error: prov.error || "Şema provizyonu başarısız" });

    // 2) Registry + allow-list (anında izolasyon)
    await pool.query(
      `INSERT INTO tenant_registry (tenant, name, owner_email, schema_name, isolated)
       VALUES ($1,$2,$3,$4,true)
       ON CONFLICT (tenant) DO UPDATE SET name=EXCLUDED.name, owner_email=EXCLUDED.owner_email, schema_name=EXCLUDED.schema_name, isolated=true`,
      [slug, tenant_name || slug, u.email, prov.schema]
    );
    addIsolatedTenant(slug);

    // 3) Kullanıcıyı bu tenant'ın admini yap + aktifleştir
    await pool.query(
      "UPDATE users SET status='active', is_active=true, tenant=$1, role='admin' WHERE id=$2",
      [slug, u.id]
    );

    const appUrl = process.env.APP_URL || "https://app.omnix.global";
    await sendEmail({
      to: u.email,
      subject: `[Omnix] Firma hesabınız onaylandı`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><h2 style="color:#065f46">Hesabınız Onaylandı ✅</h2><p>Merhaba ${u.name}, <strong>${tenant_name || slug}</strong> için Omnix platformuna erişiminiz onaylandı. Giriş yaptığınızda kendi firmanıza ait boş bir çalışma alanı göreceksiniz.</p><p><a href="${appUrl}" style="background:#1e3a5f;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Omnix'e Git</a></p></div>`,
    });

    res.json({ ok: true, tenant: slug, schema: prov.schema, tables_created: prov.tables_created });
  } catch (e) {
    console.error("APPROVE-COMPANY ERROR:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /admin/users/:id/reject
app.post("/admin/users/:id/reject", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name, email, tenant FROM users WHERE id=$1 AND status='pending'", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: "Kullanıcı bulunamadı" });
    const u = result.rows[0];
    if (!adminCanSeeUserTenant(req.user, u.tenant)) return res.status(403).json({ ok: false, error: "Bu kullanıcı sizin firmanıza ait değil" });
    await pool.query("UPDATE users SET status='rejected', is_active=false WHERE id=$1", [u.id]);
    const tConf = TENANT_CONFIG[u.tenant] || TENANT_CONFIG.erc;
    await sendEmail({
      to: u.email,
      subject: `[Omnix] Kayıt talebiniz hakkında`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><h2 style="color:#991b1b">Kayıt Talebiniz Onaylanmadı</h2><p>Merhaba ${u.name}, <strong>${tConf.name}</strong> platformuna kayıt talebiniz onaylanmadı. Daha fazla bilgi için yöneticinizle iletişime geçin.</p></div>`,
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET /platform/overview — platform sahibi konsolu: tüm firmalar + bekleyen
// kayıt sayısı + kullanıcı sayıları. Yalnızca platform_admin erişebilir.
// İzole firmayı platformdan kaldır: registry kaydı silinir + allow-list'ten
// çıkarılır + kullanıcıları pasife alınır. ŞEMA/VERİ SİLİNMEZ (geri dönülebilir).
app.delete("/platform/firms/:tenant", authMiddleware, requirePlatformAdmin, async (req, res) => {
  try {
    const tenant = String(req.params.tenant || "").toLowerCase().trim();
    if (!tenant || tenant === "erc" || tenant === "2kx") {
      return res.status(400).json({ ok: false, error: "Yerleşik firmalar kaldırılamaz" });
    }
    const r = await pool.query("DELETE FROM tenant_registry WHERE tenant=$1 RETURNING tenant, name", [tenant]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: "Firma bulunamadı" });
    removeIsolatedTenant(tenant);
    const u = await pool.query("UPDATE users SET is_active=false WHERE tenant=$1", [tenant]);
    res.json({ ok: true, removed: r.rows[0], deactivated_users: u.rowCount });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/platform/overview", authMiddleware, requirePlatformAdmin, async (req, res) => {
  try {
    // Kayıtlı izole firmalar
    let registry = [];
    try {
      const r = await pool.query(
        `SELECT tenant, name, owner_email, schema_name, isolated, created_at
         FROM tenant_registry ORDER BY created_at DESC`
      );
      registry = r.rows || [];
    } catch { registry = []; }

    // Tenant başına kullanıcı sayısı (users tablosu paylaşımlı/public)
    let counts = {};
    try {
      const c = await pool.query(
        `SELECT COALESCE(tenant,'erc') AS tenant, COUNT(*)::int AS n
         FROM users WHERE COALESCE(is_active,false)=true GROUP BY COALESCE(tenant,'erc')`
      );
      for (const row of c.rows) counts[row.tenant] = row.n;
    } catch { counts = {}; }

    // Bekleyen kayıt sayısı
    let pending = 0;
    try {
      const p = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE status='pending'`);
      pending = p.rows[0]?.n || 0;
    } catch { pending = 0; }

    // ERC + legacy 2KX her zaman listede (built-in firmalar)
    const builtins = [
      { tenant: "erc", name: "ERC Mühendislik", owner_email: "duzgun.simsek@simsektel.com", isolated: false, builtin: true },
      { tenant: "2kx", name: "2KX (Şimşek taşeronu)", owner_email: "serdar.altinova@simsektel.com", isolated: false, builtin: true },
    ];
    const firms = [
      ...builtins.map(b => ({ ...b, users: counts[b.tenant] || 0 })),
      ...registry.map(r => ({
        tenant: r.tenant, name: r.name, owner_email: r.owner_email,
        isolated: r.isolated, schema_name: r.schema_name, created_at: r.created_at,
        builtin: false, users: counts[r.tenant] || 0,
      })),
    ];

    // Tüm kullanıcılar (kimler kullanıyor) — platform sahibi hepsini görür/yönetir.
    let users = [];
    try {
      const u = await pool.query(
        `SELECT id, name, email, role, is_active, status, COALESCE(tenant,'erc') AS tenant, created_at
         FROM users ORDER BY COALESCE(is_active,false) DESC, id DESC`
      );
      // Firma adını eşle
      const nameByTenant = {};
      for (const f of firms) nameByTenant[f.tenant] = f.name;
      users = (u.rows || []).map(r => ({ ...r, firm: nameByTenant[r.tenant] || r.tenant }));
    } catch (e) { users = []; }

    // ERC tenant'ı içindeki markalar (white-label: ERC Mühendislik / AHY Elektrik)
    // + marka başına aktif kullanıcı sayısı — konsolda alt satır olarak gösterilir.
    let markalar = [];
    try {
      const m = await pool.query(`
        SELECT m.kod, m.ad, m.kirilim_yuzde,
          (SELECT COUNT(*)::int FROM users x
            WHERE COALESCE(x.tenant,'erc')='erc' AND COALESCE(x.marka,'ERC')=m.kod
              AND COALESCE(x.is_active,false)=true) AS users
        FROM markalar m WHERE m.tenant='erc' AND m.aktif=true ORDER BY m.id`);
      markalar = m.rows || [];
    } catch { markalar = []; }

    // ERC'nin alt taşeronları (2KX, Federal, UBS...) — kullanıcı kayıtlarından
    // otomatik: subcon_name + payment_rate (0.75 = %75 pay). Elle liste tutulmaz.
    let taseronlar = [];
    try {
      const t = await pool.query(`
        SELECT TRIM(subcon_name) AS ad,
          ROUND(MAX(COALESCE(payment_rate,0.8))*100)::int AS pay_yuzde,
          COUNT(*)::int AS users
        FROM users
        WHERE COALESCE(TRIM(subcon_name),'')<>'' AND COALESCE(is_active,false)=true
        GROUP BY TRIM(subcon_name) ORDER BY 1`);
      taseronlar = t.rows || [];
    } catch { taseronlar = []; }

    res.json({ ok: true, firms, pending_count: pending, users, markalar, taseronlar });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/rollout/mismatch-check", async (req, res) => {
  try {
    const masterResult = await pool.query(buildMasterJoinedQuery());
    const rolloutResult = await pool.query(`SELECT * FROM rollout_progress`);

    const rolloutSites = new Set(
      (rolloutResult.rows || []).map((r) =>
        String(r.site_code || "")
          .trim()
          .toUpperCase(),
      ),
    );

    const masterSitesMap = new Map();

    (masterResult.rows || []).forEach((row) => {
      const siteCode = String(row.site_code || "")
        .trim()
        .toUpperCase();
      const doneQty = Number(row.done_qty || 0);

      if (!siteCode || doneQty <= 0) return;

      if (!masterSitesMap.has(siteCode)) {
        masterSitesMap.set(siteCode, {
          site_code: row.site_code,
          project_code: row.project_code,
          site_type: row.site_type,
          subcon_name: row.subcon_name,
          done_qty: doneQty,
          onair_date: row.onair_date,
          status: row.status,
        });
      }
    });

    const masterSites = new Set(masterSitesMap.keys());

    const missingInRollout = [...masterSitesMap.values()].filter((row) => {
      const code = String(row.site_code || "")
        .trim()
        .toUpperCase();
      return !rolloutSites.has(code);
    });

    const rolloutWithoutWork = (rolloutResult.rows || []).filter((row) => {
      const code = String(row.site_code || "")
        .trim()
        .toUpperCase();
      return code && !masterSites.has(code);
    });

    res.json({
      ok: true,
      missingInRollout,
      rolloutWithoutWork,
      counts: {
        missingInRollout: missingInRollout.length,
        rolloutWithoutWork: rolloutWithoutWork.length,
      },
    });
  } catch (err) {
    console.error("AUTH LOGIN ERROR:", err.message);
    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

app.get("/create-admin", async (req, res) => {
  const bcrypt = require("bcrypt");

  const hash = await bcrypt.hash("123456", 10);

  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, $5)`,
    ["Orhan", "orhan.bedir@simsektel.com", hash, "admin", true],
  );

  res.send("ADMIN CREATED");
});
app.get("/rollout/missing-sites", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT
        cw.site_code,
        cw.site_type,
        cw.project_code
      FROM completed_works cw
      LEFT JOIN rollout_sites rs
        ON UPPER(TRIM(rs.site_code)) = UPPER(TRIM(cw.site_code))
      WHERE rs.id IS NULL
      ORDER BY cw.site_code
    `);

    res.json({ ok: true, rows: result.rows });
  } catch (err) {
    console.error("MISSING ROLLOUT SITES ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

/* ================== UPLOAD ================== */
const upload = multer({ storage: multer.memoryStorage() });

const uploadFaturaBelge = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".pdf", ".heic", ".heif"];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

/* ================== HELPERS ================== */

app.get("/finance-auth/test-login", (req, res) => {
  res.json({
    ok: true,
    info: "Login endpoint POST çalışır",
    email: "orhan.bedir@simsektel.com",
    password: "simsek2026",
  });
});

//QC Upload//

app.post("/qc/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Dosya yok" });
    }

    const workbook = XLSX.read(req.file.buffer);
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      return res
        .status(400)
        .json({ ok: false, error: "Excel içinde sheet bulunamadı" });
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const headers = rows[0] || [];

    function findColIndex(names, fallbackIndex) {
      const normalizedNames = names.map((x) =>
        String(x || "")
          .trim()
          .toUpperCase(),
      );

      const index = headers.findIndex((h) =>
        normalizedNames.includes(
          String(h || "")
            .trim()
            .toUpperCase(),
        ),
      );

      return index >= 0 ? index : fallbackIndex;
    }

    const COL_SITE_ID = findColIndex(["DU ID", "SITE ID", "Site ID"], 2);
    const COL_STATUS = findColIndex(["Status", "Task Status"], 7);
    const COL_TEMPLATE = findColIndex(["Template Name"], 15);
    // ISDP export'unda görev tipi: QC-TE = saha QC'si, QA = EHS/denetim.
    // Kolon eski excellerde yoksa -1 kalır ve tip filtresi uygulanmaz.
    const COL_BUSINESS = findColIndex(["Business Type", "BusinessType"], -1);
    const COL_FIRST_SUBMIT = findColIndex(
      ["First Submit to Approval Time", "First Submit Time"],
      26,
    );
    const COL_CLOSE_TIME = findColIndex(
      ["Actual Task Close Time", "Task Close Time"],
      27,
    );

    function parseQcExcelDate(value) {
      if (!value) return null;

      if (typeof value === "number") {
        const excelEpoch = new Date(1899, 11, 30);
        return new Date(excelEpoch.getTime() + value * 86400000);
      }

      const str = String(value).trim();
      if (!str) return null;

      const d = new Date(str.replace(" ", "T"));
      return Number.isNaN(d.getTime()) ? null : d;
    }

    function toDateOnly(value) {
      const d = parseQcExcelDate(value);
      return d && !Number.isNaN(d.getTime())
        ? d.toISOString().slice(0, 10)
        : null;
    }

    if (!rows.length) {
      return res
        .status(400)
        .json({ ok: false, error: "Excel içinde veri bulunamadı" });
    }

    // 2KX manuel takip kalemleri — blanket QC güncellemesine girmez.
    // (8818274546 mikrodalga çıkarıldı: artık ANA şablon kapsamında güncellenir)
    const EXCLUDED_ITEMS = [
      "8812184870",
      "8812184927",
      "8812184930",
      "8812184919",
    ];

    function normalizeText(value) {
      return String(value || "")
        .trim()
        .toUpperCase();
    }

    // GÜVENLİ durum çözümü (20.07.2026 vakası): tanınmayan değer NOK DEĞİL,
    // null döner ve satır ATLANIR. Eski kural yanlış kolon/format okunduğunda
    // tüm sistemi NOK'a çeviriyordu (662 saha ezilmişti).
    function normalizeStatus(value) {
      const v = normalizeText(value);
      if (!v) return null;
      if (v === "CLOSED" || v === "OK") return "OK";
      const NOK_DURUMLAR = [
        "EXECUTING", "NOK", "REVIEWING", "REJECTED",
        "TO BE EXECUTED", "TO BE REVIEWED", "PASS WITH ISSUES",
      ];
      if (NOK_DURUMLAR.includes(v)) return "NOK";
      return null; // Deleted / bilinmeyen / yanlış kolon → dokunma
    }

    // ── ŞABLON → KALEM KAPSAMI KURGUSU (17.07.2026, DE0334_NS_AE örneği) ──
    // Bir sahada birden çok QC görevi açılır; her şablon FARKLI kalemleri kapatır:
    //   TRS Quality CheckList   → 8812184600 (outdoor kabin) + 8818274546 (mikrodalga/TRS)
    //   AG OG Enerji Template   → yalnız enerji kalemleri (+ enh kapanış tarihi)
    //   5G Readiness Yeni Pole  → yalnız LPRT kalemleri (8818278108, 8818278098)
    //   STANDALONE AI / diğer ana şablonlar → yukarıdakiler DIŞINDA kalan kalemler
    // Saha (rollout) QC durumunu YALNIZ ana şablon belirler. QA görevleri
    // (EHS Audit vb.) hiçbir kapsamda QC belirleyemez; QC-CW/QC-TE geçerlidir.
    // Aynı saha+kapsamda birden çok satır varsa OK öncelikli birleştirilir.
    // 8818274546: New Microwave Installation (transmisyon) — standalone
    // sahalardaki 4 görevden TRS CheckList kapatınca bu kalem OK olur.
    // NOT (05.08.2026, MU3381 vakası): 8812184600 (TP48200 cabinet) ana
    // kalemdir, TRS kapsamına GİRMEZ — STANDALONE AI şablonu belirler.
    const ITEM_TRS = ["8818274546"];
    const ITEM_LPRT = ["8818278108", "8818278098"];
    const ITEM_ENERJI = ["8812184681", "8812184682", "8812184684", "8812184690", "8812184851", "8818278116"];
    // Gizleme QC'si (QC-CW "Gizleme" şablonu) yalnız gizleme kalemlerini kapatır —
    // IZ2683 vakası: Gizleme Closed iken sahanın tamamı OK'lanmıştı
    const ITEM_GIZLEME = ["8812184642", "8818274259"];
    // DSS-GPS Readiness şablonu yalnız GPS kalemini kapatır — CN0017 vakası:
    // GPS Closed iken STANDALONE AI Rejected olmasına rağmen saha OK'lanmıştı
    const ITEM_GPS = ["88123MGE"];
    // DSS sahalarında (site ID'de DSS/GPS) tek QC görevi DSS-GPS Readiness'tir;
    // kapandığında BBU Modernization da OK olur (KA3028 vakası, 07.08.2026).
    // Bu kalem yalnız DSS/GPS sahalarda kullanıldığı için diğer saha
    // tiplerinde ana şablonun belirlemesi sürer.
    const ITEM_BBU_DSS = ["8818270786"];
    const isDssSite = (sc) => /DSS|GPS/.test(String(sc || "").toUpperCase());
    const OZEL_ITEMLER = [...ITEM_TRS, ...ITEM_LPRT, ...ITEM_ENERJI, ...ITEM_GIZLEME, ...ITEM_GPS];
    const scopeOf = (t) => {
      if (t.includes("TRS QUALITY CHECK")) return "TRS";
      if (t.includes("AG OG ENERJI")) return "ENERJI";
      if (t.includes("5G READINESS YENI POLE")) return "LPRT";
      if (t.includes("GIZLEME") || t.includes("CAMOUFLAGE")) return "GIZLEME";
      if (t.includes("DSS-GPS") || t.includes("GPS READINES")) return "GPS";
      return "ANA";
    };

    const bySiteScope = new Map(); // "SITE|SCOPE" → {siteCode, scope, qcDurum, tarih...}

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];

      const siteCode = String(row[COL_SITE_ID] || "")
        .trim()
        .toUpperCase();
      const qcDurum = normalizeStatus(row[COL_STATUS]);

      if (!siteCode || !qcDurum) continue;

      // QA görevleri atlanır (EHS Audit "Closed" olsa bile QC sayılmaz —
      // GAHST_5GEXP_ANK vakası). QC-TE, QC-CW, QC-EHS geçerli.
      if (COL_BUSINESS >= 0) {
        const bt = normalizeText(row[COL_BUSINESS]);
        if (bt && !bt.startsWith("QC")) continue;
      }

      const templateNorm = normalizeText(row[COL_TEMPLATE]);
      const firstSubmitDateOnly = toDateOnly(row[COL_FIRST_SUBMIT]);
      const qcClosedDateOnly = toDateOnly(row[COL_CLOSE_TIME]);

      const scope = scopeOf(templateNorm);
      const key = `${siteCode}|${scope}`;
      const prev = bySiteScope.get(key);
      if (!prev || (prev.qcDurum !== "OK" && qcDurum === "OK")) {
        bySiteScope.set(key, { siteCode, scope, qcDurum, firstSubmitDateOnly, qcClosedDateOnly });
      } else if (prev.qcDurum === "OK" && qcDurum === "OK") {
        prev.firstSubmitDateOnly = prev.firstSubmitDateOnly || firstSubmitDateOnly;
        prev.qcClosedDateOnly = prev.qcClosedDateOnly || qcClosedDateOnly;
      }
    }

    let updatedCount = 0;
    let matchedSites = 0;
    const missingSites = [];

    // Özel kapsamlar: yalnız kendi kalemlerinin QC durumunu yazar
    for (const m of bySiteScope.values()) {
      if (m.scope === "ANA") continue;
      const items = m.scope === "TRS" ? ITEM_TRS
        : m.scope === "LPRT" ? ITEM_LPRT
        : m.scope === "GIZLEME" ? ITEM_GIZLEME
        : m.scope === "GPS" ? (isDssSite(m.siteCode) ? [...ITEM_GPS, ...ITEM_BBU_DSS] : ITEM_GPS)
        : ITEM_ENERJI;
      const r = await pool.query(
        `UPDATE master_works
           SET qc_durum = $1
         WHERE UPPER(TRIM(COALESCE(site_code, ''))) = $2
           AND TRIM(COALESCE(item_code, '')) = ANY($3::text[])`,
        [m.qcDurum, m.siteCode, items],
      );
      updatedCount += r.rowCount || 0;
      // Enerji QC OK → rollout enerji kapanış tarihi
      if (m.scope === "ENERJI" && m.qcDurum === "OK") {
        await pool.query(
          `UPDATE rollout_progress
             SET enh_qc_closed_date = COALESCE(enh_qc_closed_date, $2),
                 updated_at = NOW()
           WHERE UPPER(TRIM(COALESCE(site_code, ''))) = $1`,
          [m.siteCode, m.qcClosedDateOnly || m.firstSubmitDateOnly],
        );
      }
    }

    // Ana kapsam: saha QC'si (rollout) + özel kalemler dışındaki tüm kalemler
    const anaList = [...bySiteScope.values()].filter(m => m.scope === "ANA");
    for (const m of anaList) {
      const siteCode = m.siteCode;
      const ro = await pool.query(
        `
        UPDATE rollout_progress
        SET
          qc_durum = $2,

          plan_start_date = COALESCE(plan_start_date, $3),
          installation_actual_start_date = COALESCE(installation_actual_start_date, $3),

          installation_actual_end_date = CASE
            WHEN $2 = 'OK' THEN COALESCE(installation_actual_end_date, $4)
            ELSE installation_actual_end_date
          END,

          onair_date = CASE
            WHEN $2 = 'OK' THEN COALESCE(onair_date, $4)
            ELSE onair_date
          END,

          -- NOK gelince tarih temizlenir: QC "open" ise closed_date olmamalı
          qc_closed_date = CASE
            WHEN $2 = 'OK' THEN COALESCE(qc_closed_date, $4)
            ELSE NULL
          END,

          malzeme_status = CASE
            WHEN $2 = 'OK' AND COALESCE(malzeme_status, '') = ''
            THEN 'OK'
            ELSE malzeme_status
          END,

          updated_at = NOW()
        WHERE UPPER(TRIM(COALESCE(site_code, ''))) = $1
        `,
        [siteCode, m.qcDurum, m.firstSubmitDateOnly, m.qcClosedDateOnly],
      );

      const mw = await pool.query(
        `
          UPDATE master_works
          SET qc_durum = $1
          WHERE UPPER(TRIM(COALESCE(site_code, ''))) = $2
            AND TRIM(COALESCE(item_code, '')) <> ALL($3::text[])
          `,
        // Özel kapsam kalemleri (TRS/LPRT/enerji) kendi şablonlarından güncellenir;
        // 2KX manuel takip kalemleri de blanket güncellemenin dışındadır.
        // DSS sahalarında BBU Modernization da DSS-GPS Readiness'e bağlıdır.
        [m.qcDurum, siteCode, [...EXCLUDED_ITEMS, ...OZEL_ITEMLER, ...(isDssSite(siteCode) ? ITEM_BBU_DSS : [])]],
      );
      updatedCount += mw.rowCount || 0;

      if ((ro.rowCount || 0) + (mw.rowCount || 0) > 0) matchedSites++;
      else missingSites.push(siteCode);
    }

    // Teşhis: ana kapsamda kaç saha OK/NOK okundu — "0 OK + çok NOK" ya da
    // "hiç durum okunamadı" tablosu, Excel format/kolon sorununun işaretidir.
    const anaOk = anaList.filter(m => m.qcDurum === "OK").length;
    const anaNok = anaList.filter(m => m.qcDurum === "NOK").length;
    if (bySiteScope.size === 0) {
      return res.json({
        ok: true,
        updatedCount: 0,
        matchedSites: 0,
        missingSites: [],
        message: "⚠️ Hiçbir satırda tanınan QC durumu okunamadı — Excel formatı/Status kolonu beklenenden farklı olabilir. HİÇBİR kayıt değiştirilmedi. ISDP Task Explorer → Export Search Result çıktısını yükleyin.",
      });
    }
    return res.json({
      ok: true,
      updatedCount,
      matchedSites,
      missingSites,
      message:
        `QC işlendi: ${matchedSites} saha eşleşti (ana QC: ${anaOk} OK, ${anaNok} NOK)` +
        (anaOk === 0 && anaNok > 0
          ? " ⚠️ Hiç OK okunmadı — dosya doğru mu kontrol edin"
          : "") +
        (missingSites.length
          ? ` — ${missingSites.length} saha sistemde bulunamadı: ${missingSites.slice(0, 10).join(", ")}${missingSites.length > 10 ? "…" : ""}`
          : ""),
    });
  } catch (err) {
    console.error("QC UPLOAD ERROR:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/finance-auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body.password || "").trim();

    const allowedUsers = getAllowedFinanceUsers();

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        error: "Email ve şifre zorunlu",
      });
    }

    if (!allowedUsers.includes(email)) {
      return res.status(403).json({
        ok: false,
        error: "Bu kullanıcı için yetki yok",
      });
    }

    // Per-user password: users tablosunda kayıtlı bcrypt hash'i kontrol et
    const userResult = await pool.query(
      `SELECT id, password_hash, subcon_name, payment_rate
       FROM users
       WHERE LOWER(TRIM(email)) = $1 AND is_active = true
       LIMIT 1`,
      [email],
    );

    let authenticated = false;
    let userMeta = { subcon_name: null, payment_rate: 0.8 };

    if (userResult.rows.length > 0 && userResult.rows[0].password_hash) {
      const u = userResult.rows[0];
      authenticated = await bcrypt.compare(password, u.password_hash);
      userMeta = {
        subcon_name: u.subcon_name || null,
        payment_rate: Number(u.payment_rate || 0.8),
      };
    } else {
      // Fallback: ortak geçici şifre (eski kullanıcılar için)
      const validPassword = String(
        process.env.FINANCE_TEMP_PASSWORD || "",
      ).trim();
      authenticated = password === validPassword;
    }

    if (!authenticated) {
      return res.status(401).json({
        ok: false,
        error: "Şifre hatalı",
      });
    }

    const token = createFinanceToken(email);

    res.json({
      ok: true,
      token,
      user: {
        email,
        subcon_name: userMeta.subcon_name,
        payment_rate: userMeta.payment_rate,
      },
    });
  } catch (err) {
    console.error("FINANCE LOGIN ERROR:", err.message);
    res.status(500).json({
      ok: false,
      error: "Login sırasında hata oluştu",
    });
  }
});

app.get("/test", (req, res) => {
  res.json({ ok: true });
});

const https = require("https");

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`TCMB yanıt hatası: ${res.statusCode}`));
          }
        });
      })
      .on("error", reject);
  });
}

function parseTcmbUsdSellingRate(xmlText) {
  const usdBlockMatch = xmlText.match(
    /<Currency[^>]+CurrencyCode="USD"[\s\S]*?<\/Currency>/i,
  );

  if (!usdBlockMatch) {
    throw new Error("TCMB XML içinde USD bulunamadı");
  }

  const usdBlock = usdBlockMatch[0];

  const forexSellingMatch = usdBlock.match(
    /<ForexSelling>(.*?)<\/ForexSelling>/i,
  );

  if (!forexSellingMatch || !forexSellingMatch[1]) {
    throw new Error("USD ForexSelling değeri bulunamadı");
  }

  const rawRate = forexSellingMatch[1].trim().replace(",", ".");
  const rate = Number(rawRate);

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Geçersiz USD kuru");
  }

  return rate;
}

async function getTcmbUsdTrySellingRate() {
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, "0");
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const yyyy = String(today.getFullYear());

  const xmlUrl = `https://www.tcmb.gov.tr/kurlar/${yyyy}${mm}/${dd}${mm}${yyyy}.xml`;

  try {
    const xmlText = await fetchText(xmlUrl);
    return parseTcmbUsdSellingRate(xmlText);
  } catch (err) {
    // Hafta sonu / tatil için son 5 güne kadar geri git
    for (let i = 1; i <= 5; i += 1) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);

      const ddd = String(d.getDate()).padStart(2, "0");
      const mmm = String(d.getMonth() + 1).padStart(2, "0");
      const yyy = String(d.getFullYear());

      const fallbackUrl = `https://www.tcmb.gov.tr/kurlar/${yyy}${mmm}/${ddd}${mmm}${yyy}.xml`;

      try {
        const xmlText = await fetchText(fallbackUrl);
        return parseTcmbUsdSellingRate(xmlText);
      } catch (_) {
        // sıradaki güne geç
      }
    }

    throw new Error("TCMB USD kuru alınamadı");
  }
}

function toTlAmount(amount, currency, usdTryRate) {
  const numericAmount = Number(amount || 0);
  const curr = String(currency || "TRY").toUpperCase();

  if (!Number.isFinite(numericAmount)) return 0;
  if (curr === "USD") return numericAmount * usdTryRate;
  return numericAmount;
}

function getAllowedFinanceUsers() {
  return String(process.env.FINANCE_ALLOWED_USERS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function createFinanceToken(email) {
  return jwt.sign(
    { email, scope: "finance" },
    process.env.JWT_SECRET || "finance_secret",
    { expiresIn: "12h" },
  );
}

// HW yükleme koruması: hw_yukleme=false markadaki (ör. AHY) kullanıcılar
// HW payment/fatura/item/po/acceptance yükleyemez. Token yoksa veya
// çözülemezse eski davranış korunur (mevcut akışları bozmamak için) —
// frontend tüm yükleme çağrılarına token ekliyor.
async function requireHwYukleme(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return next();
    let decoded = null;
    for (const secret of [process.env.JWT_SECRET || "simsek_secret_degistir", process.env.JWT_SECRET || "finance_secret"]) {
      try { decoded = jwt.verify(token, secret); break; } catch {}
    }
    if (!decoded || !decoded.email) return next();
    // Platform sahibi her şeyi yapabilir — marka kısıtına tabi değildir
    if (String(decoded.role || "") === "platform_admin") return next();
    const r = await pool.query(
      `SELECT COALESCE(m.hw_yukleme, true) AS hw
       FROM users u
       LEFT JOIN markalar m ON m.kod = u.marka AND m.tenant = COALESCE(u.tenant,'erc')
       WHERE LOWER(TRIM(u.email)) = LOWER($1)
       ORDER BY u.id DESC LIMIT 1`,
      [String(decoded.email).trim()],
    );
    if (r.rows[0] && r.rows[0].hw === false) {
      return res.status(403).json({ ok: false, error: "HW yüklemeleri sadece ana yüklenici (ERC Mühendislik) tarafından yapılabilir" });
    }
  } catch (e) { console.error("requireHwYukleme:", e.message); }
  next();
}

function requireFinanceAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: "Yetkisiz erişim",
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "finance_secret",
    );

    // Finans yetkisi: scope=finance VEYA hardcoded finans e-postaları
    const FINANCE_EMAILS_HARDCODED = [
      "nurcan.kus@simsektel.com",
      "serdar.altinova@simsektel.com", // İzmir bölge müdürü (25.07.2026)
      "orhan@simsektel.com",
      "orhan.bedir@simsektel.com",
      "duzgun.simsek@simsektel.com",
    ];
    const decodedEmail = String(decoded.email || "").toLowerCase();
    const hasFinanceAccess =
      decoded.scope === "finance" ||
      FINANCE_EMAILS_HARDCODED.includes(decodedEmail);

    if (!hasFinanceAccess) {
      return res.status(403).json({
        ok: false,
        error: "Finance yetkisi yok",
      });
    }

    req.financeUser = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      ok: false,
      error: "Oturum geçersiz veya süresi dolmuş",
    });
  }
}

function findPaymentInfoByInvoiceNo(paymentMap, invoiceNo, currency) {
  const cleanInvoiceNo = String(invoiceNo || "").trim();
  const cleanCurrency = String(currency || "")
    .trim()
    .toUpperCase();

  if (!cleanInvoiceNo) return null;

  if (paymentMap.has(cleanInvoiceNo)) {
    return paymentMap.get(cleanInvoiceNo);
  }

  if (cleanCurrency === "USD") {
    const curVersion = `${cleanInvoiceNo}-cur`;
    if (paymentMap.has(curVersion)) {
      return paymentMap.get(curVersion);
    }
  }

  if (cleanInvoiceNo.endsWith("-cur")) {
    const normalVersion = cleanInvoiceNo.replace(/-cur$/i, "");
    if (paymentMap.has(normalVersion)) {
      return paymentMap.get(normalVersion);
    }
  }

  return null;
}

function getTermDays(terms) {
  const raw = String(terms || "")
    .trim()
    .toUpperCase();

  if (!raw) return 0;
  if (raw === "COD") return 4;

  if (raw === "PAY ON AGREEMENT") return 15;
  if (raw === "INV AC 15D") return 15;

  const match = raw.match(/(\d+)\s*D/);
  if (match) return Number(match[1]);

  return 0;
}

function toYmdLocal(value) {
  if (!value) return null;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

//Ekip Yaptığı İş //

function parseSafeDate(value) {
  if (!value) return null;

  if (value instanceof Date && !isNaN(value)) return value;

  const str = String(value).trim();

  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str);
    return isNaN(d) ? null : d;
  }

  // dd.mm.yyyy
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) {
    const [day, month, year] = str.split(".");
    const d = new Date(`${year}-${month}-${day}`);
    return isNaN(d) ? null : d;
  }

  // dd/mm/yyyy
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [day, month, year] = str.split("/");
    const d = new Date(`${year}-${month}-${day}`);
    return isNaN(d) ? null : d;
  }

  const d = new Date(str);
  return isNaN(d) ? null : d;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;

  if (typeof value === "number") return value;

  const cleaned = String(value)
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  const num = Number(cleaned);
  return isNaN(num) ? 0 : num;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR");
}

function getStartOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // pazar=0
  const diff = day === 0 ? -6 : 1 - day; // pazartesi başlangıç
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getEndOfWeek(date) {
  const start = getStartOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

function getStartOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function getEndOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

async function buildUpcomingCollectionsData() {
  // H01 iade faturaları (negatif remaining_amount) dahil — net ödeme hesabı için
  // TO_CHAR ile due_date her zaman "YYYY-MM-DD" string olarak döner (pg Date object sorununu önler)
  const result = await pool.query(`
    SELECT
      p.invoice_no,
      TO_CHAR(p.due_date, 'YYYY-MM-DD') AS due_date,
      COALESCE(p.remaining_amount, 0) AS remaining_amount,
      COALESCE(p.currency, 'TRY') AS currency
    FROM hw_payment_rows p
    WHERE COALESCE(p.remaining_amount, 0) != 0
      AND p.due_date IS NOT NULL
    ORDER BY p.due_date ASC
  `);

  // Fatura → taşeron payı (yalnız 2KX / AHY ayrımı; gerisi Şimşek/diğer).
  // Her fatura satırı: saha+item → master_works taşeronu; ağırlık = po_rows birim fiyat.
  // Aynı fatura birden çok taşerona yayılıyorsa birim fiyat oranıyla bölünür.
  const invAgg = new Map(); // invoice_no → { total, k2kx, kahy }
  try {
    const subRes = await pool.query(`
      SELECT h.invoice_no,
             COALESCE(p.unit_price, 0) AS w,
             (SELECT m.subcon_name FROM master_works m
                WHERE m.site_code = h.site_id AND m.item_code = h.item_code
                ORDER BY m.done_qty DESC NULLS LAST LIMIT 1) AS subcon
      FROM hw_invoice_items h
      LEFT JOIN po_rows p ON p.po_no = h.po_no AND p.po_line_no = h.line_no
      WHERE h.invoice_no IS NOT NULL AND h.invoice_no <> ''
    `);
    for (const r of subRes.rows) {
      const w = Number(r.w || 0);
      const c = canonSub(r.subcon);
      const a = invAgg.get(r.invoice_no) || { total: 0, k2kx: 0, kahy: 0 };
      a.total += w;
      if (c === "2kx") a.k2kx += w;
      else if (c === "ahy") a.kahy += w;
      invAgg.set(r.invoice_no, a);
    }
  } catch (e) {
    console.error("upcoming taşeron payı hesaplanamadı:", e.message);
  }

  // Türkiye saati (UTC+3) baz alınarak "bugün" hesaplanır
  const TR_OFFSET_MS = 3 * 60 * 60 * 1000;
  const nowTR = new Date(Date.now() + TR_OFFSET_MS);
  const today = new Date(Date.UTC(nowTR.getUTCFullYear(), nowTR.getUTCMonth(), nowTR.getUTCDate()));

  const endOfWeek = new Date(today);
  const day = endOfWeek.getUTCDay();
  const diffToSunday = day === 0 ? 0 : 7 - day;
  endOfWeek.setUTCDate(endOfWeek.getUTCDate() + diffToSunday);
  endOfWeek.setUTCHours(23, 59, 59, 999);

  const monthlyUpcoming = {};
  for (let i = 1; i <= 12; i += 1) {
    monthlyUpcoming[i] = 0;
  }

  let todayTotal = 0;
  let weekTotal = 0;
  let overduePaymentTotal = 0;

  const groupedMap = new Map();
  const overdueGroupedMap = new Map();

  // USD bekleyen tutarları TL'ye çevir (TCMB satış kuru). Alınamazsa 0 → USD satırı sayılmaz, TRY etkilenmez.
  let usdRate = 0;
  try { usdRate = Number(await getTcmbUsdTrySellingRate()) || 0; } catch { usdRate = 0; }

  for (const row of result.rows) {
    const rawAmt = Number(row.remaining_amount || 0);
    const amount = String(row.currency || "TRY").toUpperCase() === "USD" ? rawAmt * usdRate : rawAmt;
    if (amount === 0) continue;  // Sadece sıfırı atla; H01 negatifleri dahil et

    // due_date UTC gece yarısı olarak parse et (timezone kaymasını önle)
    const dueDate = new Date(row.due_date + 'T00:00:00Z');

    if (Number.isNaN(dueDate.getTime())) continue;

    if (dueDate < today) {
      overduePaymentTotal += amount;
      // Geciken satırları da grupla
      const key = row.due_date;
      const dayName = dueDate.toLocaleDateString("tr-TR", { weekday: "long" });
      const day_name = dayName.charAt(0).toLocaleUpperCase("tr-TR") + dayName.slice(1);
      if (!overdueGroupedMap.has(key)) {
        overdueGroupedMap.set(key, { due_date: key, day_name, amount: 0, gross_amount: 0, deduction_amount: 0, currency: "TRY" /* USD tutarlar TL'ye çevrildi */ });
      }
      const ov = overdueGroupedMap.get(key);
      ov.amount += amount;
      if (amount > 0) ov.gross_amount += amount;
      else ov.deduction_amount += amount;
      continue;
    }

    const monthNo = dueDate.getMonth() + 1;
    monthlyUpcoming[monthNo] += amount;

    if (dueDate.getTime() === today.getTime()) {
      todayTotal += amount;
    }

    if (dueDate >= today && dueDate <= endOfWeek) {
      weekTotal += amount;
    }

    const yyyy = dueDate.getFullYear();
    const mm = String(dueDate.getMonth() + 1).padStart(2, "0");
    const dd = String(dueDate.getDate()).padStart(2, "0");
    const key = `${yyyy}-${mm}-${dd}`;

    const dayName = dueDate.toLocaleDateString("tr-TR", {
      weekday: "long",
    });

    const day_name =
      dayName.charAt(0).toLocaleUpperCase("tr-TR") + dayName.slice(1);

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        due_date: key,
        day_name,
        amount: 0,
        gross_amount: 0,
        deduction_amount: 0,
        subcon_2kx: 0,
        subcon_ahy: 0,
        currency: "TRY" /* USD tutarlar TL'ye çevrildi */,
      });
    }

    const entry = groupedMap.get(key);
    entry.amount += amount;  // net (pozitif + negatif)
    if (amount > 0) {
      entry.gross_amount += amount;
    } else {
      entry.deduction_amount += amount;  // negatif → H01 kesintisi
    }

    // Taşeron payı: bu faturanın 2KX / AHY oranınca tutarı dağıt
    const ia = invAgg.get(row.invoice_no);
    if (ia && ia.total > 0) {
      entry.subcon_2kx += amount * (ia.k2kx / ia.total);
      entry.subcon_ahy += amount * (ia.kahy / ia.total);
    }
  }

  const rows = [...groupedMap.values()].sort(
    (a, b) => new Date(a.due_date) - new Date(b.due_date),
  );

  // Geciken ödemeler — en yakın tarih önce
  const overduePaymentRows = [...overdueGroupedMap.values()].sort(
    (a, b) => new Date(b.due_date) - new Date(a.due_date),
  );

  return {
    rows,
    overdue_payment_rows: overduePaymentRows,
    summary: {
      today_total: todayTotal,
      week_total: weekTotal,
      overdue_payment_total: overduePaymentTotal,
    },
    monthlyUpcoming,
    invAgg,   // fatura → 2KX/AHY pay oranları (bugün tahsil edilen dağılımı için)
    usdRate,
  };
}

async function buildOverdueInvoicesData() {
  await ensureHwInvoiceTable();

  const invoiceResult = await pool.query(`
    SELECT
      invoice_no,
      invoice_date,
      COALESCE(terms, '') AS terms,
      COALESCE(invoice_status, '') AS invoice_status
    FROM hw_invoice_rows
    WHERE invoice_no IS NOT NULL
      AND invoice_date IS NOT NULL
    ORDER BY invoice_date ASC, id ASC
  `);

  const paymentResult = await pool.query(`
    SELECT
      COALESCE(invoice_no, '') AS invoice_no,
      COALESCE(invoice_amount, 0) - COALESCE(payment_amount, 0) AS remaining_amount,
      COALESCE(currency, 'TRY') AS currency,
      payment_date,
      due_date,
      COALESCE(customer_name, '') AS customer_name,
      COALESCE(payment_method, '') AS payment_method,
      COALESCE(supplier_name, '') AS supplier_name
    FROM hw_payment_rows
  `);

  const paymentMap = new Map();

  paymentResult.rows.forEach((row) => {
    const key = String(row.invoice_no || "").trim();
    if (!key) return;
    paymentMap.set(key, row);
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const overdueRows = [];
  let overdueTotal = 0;

  for (const inv of invoiceResult.rows) {
    const invoiceNo = String(inv.invoice_no || "").trim();
    if (!invoiceNo) continue;

    const paymentInfo = findPaymentInfoByInvoiceNo(
      paymentMap,
      invoiceNo,
      inv.currency,
    );
    if (!paymentInfo) continue;

    const remainingAmount = Number(paymentInfo.remaining_amount || 0);
    if (remainingAmount <= 0) continue;

    const invoiceStatus = String(inv.invoice_status || "")
      .trim()
      .toUpperCase();

    // Sadece tamamen ödenmiş olanları çıkar
    if (invoiceStatus === "PAID BY HUAWEI") continue;

    const invoiceDateObj = new Date(inv.invoice_date);
    invoiceDateObj.setHours(0, 0, 0, 0);

    const addDays = getTermDays(inv.terms);
    const expectedDateObj = new Date(invoiceDateObj);
    expectedDateObj.setDate(expectedDateObj.getDate() + addDays);
    expectedDateObj.setHours(0, 0, 0, 0);

    // Termin henüz gelmemişse gecikmiş değildir
    if (expectedDateObj.getTime() > today.getTime()) continue;

    const yyyy = expectedDateObj.getFullYear();
    const mm = String(expectedDateObj.getMonth() + 1).padStart(2, "0");
    const dd = String(expectedDateObj.getDate()).padStart(2, "0");
    const expectedPaymentDate = `${yyyy}-${mm}-${dd}`;
    overdueTotal += remainingAmount;

    overdueRows.push({
      invoice_no: invoiceNo,
      invoice_date: inv.invoice_date,
      expected_payment_date: expectedPaymentDate,
      terms: inv.terms || "-",
      amount: remainingAmount,
      currency: paymentInfo.currency || "TRY",
      customer_name: paymentInfo.customer_name || "",
      payment_method: paymentInfo.payment_method || "",
      supplier_name: paymentInfo.supplier_name || "",
    });
  }

  overdueRows.sort((a, b) => {
    return (
      new Date(a.expected_payment_date) - new Date(b.expected_payment_date)
    );
  });

  return {
    rows: overdueRows,
    total: overdueTotal,
  };
}

function calculateExpectedPaymentDate(invoiceDate, terms) {
  if (!invoiceDate) return null;

  const base = new Date(invoiceDate);
  if (Number.isNaN(base.getTime())) return null;

  const rawTerms = String(terms || "")
    .trim()
    .toUpperCase();

  let addDays = 0;

  if (rawTerms === "COD") {
    addDays = 4;
  } else if (rawTerms === "PAY ON AGREEMENT") {
    addDays = 15;
  } else if (rawTerms === "INV AC 15D") {
    addDays = 15;
  } else {
    const match = rawTerms.match(/(\d+)\s*D/);
    if (match) {
      addDays = Number(match[1]);
    }
  }

  base.setDate(base.getDate() + addDays);
  return base.toISOString().slice(0, 10);
}

function parseExcelDateFlexible(value) {
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);

    if (!parsed) return null;

    const year = parsed.y < 2005 ? parsed.y + 26 : parsed.y; // Excel offset fix
    const month = String(parsed.m).padStart(2, "0");
    const day = String(parsed.d).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  if (!value) return null;

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;

    const year = parsed.y;
    const month = String(parsed.m).padStart(2, "0");
    const day = String(parsed.d).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const str = String(value).trim();
  if (!str) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) {
    const [day, month, year] = str.split(".");
    return `${year}-${month}-${day}`;
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [day, month, year] = str.split("/");
    return `${year}-${month}-${day}`;
  }

  if (/^\d{4}\/\d{2}\/\d{2}$/.test(str)) {
    const [year, month, day] = str.split("/");
    return `${year}-${month}-${day}`;
  }

  const d = new Date(str);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }

  return null;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;

  let str = String(value).trim();
  if (!str) return 0;

  str = str.replace(/\s/g, "");

  const hasDot = str.includes(".");
  const hasComma = str.includes(",");

  if (hasDot && hasComma) {
    if (str.lastIndexOf(",") > str.lastIndexOf(".")) {
      str = str.replace(/\./g, "").replace(",", ".");
      return Number(str) || 0;
    }

    str = str.replace(/,/g, "");
    return Number(str) || 0;
  }

  if (hasComma && !hasDot) {
    str = str.replace(",", ".");
    return Number(str) || 0;
  }

  if (hasDot && !hasComma) {
    return Number(str) || 0;
  }

  return Number(str) || 0;
}

function parseFinanceNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;

  let str = String(value).trim();
  if (!str) return 0;

  str = str.replace(/\s/g, "");
  str = str.replace(/₺|\$|€|TRY|USD/gi, "");

  const hasDot = str.includes(".");
  const hasComma = str.includes(",");

  if (hasDot && !hasComma) {
    return Number(str) || 0;
  }

  if (!hasDot && hasComma) {
    return Number(str.replace(",", ".")) || 0;
  }

  if (hasDot && hasComma && str.lastIndexOf(",") > str.lastIndexOf(".")) {
    return Number(str.replace(/\./g, "").replace(",", ".")) || 0;
  }

  if (hasDot && hasComma && str.lastIndexOf(".") > str.lastIndexOf(",")) {
    return Number(str.replace(/,/g, "")) || 0;
  }

  return Number(str) || 0;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getCell(row, possibleKeys = []) {
  const rowKeys = Object.keys(row || {});
  const normalizedMap = {};

  rowKeys.forEach((key) => {
    normalizedMap[normalizeText(key)] = row[key];
  });

  for (const key of possibleKeys) {
    const found = normalizedMap[normalizeText(key)];
    if (found !== undefined && found !== null && String(found).trim() !== "") {
      return found;
    }
  }

  return null;
}

function parseExcelDate(value) {
  if (!value) return null;

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;

    const year = parsed.y;
    const month = String(parsed.m).padStart(2, "0");
    const day = String(parsed.d).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const str = String(value).trim();
  if (!str) return null;

  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) {
    const [day, month, year] = str.split(".");
    return `${year}-${month}-${day}`;
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [day, month, year] = str.split("/");
    return `${year}-${month}-${day}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  const d = new Date(str);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }

  return null;
}

function normalizeCurrency(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase();

  if (raw === "USD" || raw === "$" || raw === "US$" || raw.includes("USD")) {
    return "USD";
  }

  if (raw === "TRY" || raw === "TL" || raw === "₺" || raw.includes("TRY")) {
    return "TRY";
  }

  return raw || "TRY";
}
// BOQ'da USD tanımlı kalemler — HW PO exportu bu kalemleri bazen "TRY"
// etiketler ama fiyat USD'dir (örn. 6m pole 931, bakır elektrot 7,31).
// Boot'ta boq_items'tan yüklenir; BOQ güncellenince deploy/restart yeniler.
let USD_BOQ_SET = new Set();
pool.query(`SELECT s_bom_code FROM boq_items WHERE UPPER(COALESCE(currency,''))='USD'`)
  .then(r => { USD_BOQ_SET = new Set(r.rows.map(x => String(x.s_bom_code || "").trim())); })
  .catch(() => {});

function inferCurrencyByItemAndPrice(itemCode, currency, unitPrice) {
  const code = String(itemCode || "").trim();
  const curr = normalizeCurrency(currency);
  const price = Number(unitPrice || 0);

  // BOQ'sunda USD olan kalem: fiyat >= 10.000 ise gerçek TL PO'dur
  // (kurdan çevrilerek açılmış, örn. 8818278098 → 42.379 TL); değilse USD.
  if (USD_BOQ_SET.has(code) || code === "8818278098") {
    if (price >= 10000) return "TRY";
    if (price > 0) return "USD";
  }

  return curr;
}

function detectSiteTypeFromSiteCode(siteCode) {
  const code = String(siteCode || "")
    .trim()
    .toUpperCase();

  if (code.includes("NR3500") || code.includes("5GEXP")) return "5G";
  if (code.includes("NS")) return "STANDALONE";

  if (
    code.includes("L800") ||
    code.includes("L2600") ||
    code.includes("L2100") ||
    code.includes("L1800") ||
    code.includes("L900") ||
    code.includes("NR700") ||
    code.includes("TRP")
  ) {
    return "LTE";
  }

  return "DİĞER";
}

function getRegion(siteCode, projectCode = "") {
  // Frontend'teki getRegion ile BİREBİR aynı tutulur — ekran ve Excel
  // exportları aynı bölge eşlemesini kullanmalı (BOHAS vakası, 05.08.2026)
  const code = String(siteCode || "").trim().toUpperCase();
  const project = String(projectCode || "").trim().toUpperCase();

  if (
    code.startsWith("ES") ||
    code.startsWith("BO") ||
    code.startsWith("ZO") ||
    code.startsWith("KA") ||
    code.startsWith("BI") ||
    code.startsWith("AN") ||
    code.startsWith("CN") ||
    code.startsWith("DU") ||
    code.includes("_ANK") ||
    code.includes("_KON")
  ) {
    return "Ankara";
  }

  if (
    code.startsWith("IZ") ||
    code.startsWith("US") ||
    code.startsWith("MU") ||
    code.startsWith("MN") ||
    code.startsWith("AI") ||
    code.startsWith("DE") ||
    code.includes("_IZM")
  ) {
    return "İzmir";
  }

  if (
    code.startsWith("AT") ||
    code.startsWith("IP") ||
    code.startsWith("BU") ||
    code.startsWith("AF") ||
    code.includes("_ANT")
  ) {
    return "Antalya";
  }

  if (project.includes("ANK")) return "Ankara";
  if (project.includes("IZM") || project.includes("IZ")) return "İzmir";
  if (project.includes("ANT")) return "Antalya";

  return "Tanımsız";
}

async function ensureHwAcceptanceTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hw_acceptance_rows (
      id SERIAL PRIMARY KEY,
      acceptance_no TEXT,
      po_no TEXT,
      po_line_no TEXT,
      shipment_no TEXT,
      status TEXT,
      current_handler TEXT,
      site_code TEXT,
      approval_progress TEXT,
      unit_price NUMERIC DEFAULT 0,
      requested_qty NUMERIC DEFAULT 0,
      acceptance_qty NUMERIC DEFAULT 0,
      site_name TEXT,
      project_name TEXT,
      engineering_code TEXT,
      item_code TEXT,
      milestone_type TEXT,
      acceptance_milestone TEXT,
      payment_pct TEXT,
      currency TEXT,
      upload_batch TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`ALTER TABLE hw_acceptance_rows ADD COLUMN IF NOT EXISTS currency TEXT`);
  await pool.query(`ALTER TABLE hw_acceptance_rows ADD COLUMN IF NOT EXISTS item_code TEXT`);
}

async function ensureHwInvoiceTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hw_invoice_rows (
      id SERIAL PRIMARY KEY,
      invoice_no TEXT,
      invoice_amount NUMERIC DEFAULT 0,
      invoice_date DATE,
      customer_name TEXT,
      currency TEXT DEFAULT 'TRY',
      upload_batch TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
   ALTER TABLE hw_invoice_rows
   ADD COLUMN IF NOT EXISTS terms TEXT
  `);

  await pool.query(`
    ALTER TABLE hw_invoice_rows
    ADD COLUMN IF NOT EXISTS invoice_status TEXT
  `);

  // Faturanın kesildiği andaki HW referans kuru (AH kolonu) — USD kalemlerde
  // taşeron faturası bu SABİT kurla hesaplanır, günlük kurla oynamaz
  await pool.query(`
    ALTER TABLE hw_invoice_rows
    ADD COLUMN IF NOT EXISTS reference_rate NUMERIC
  `);

  await pool.query(`
    ALTER TABLE hw_invoice_rows
    ADD COLUMN IF NOT EXISTS customer_name TEXT
  `);

  await pool.query(`
    ALTER TABLE hw_invoice_rows
    ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'TRY'
  `);

  await pool.query(`
    ALTER TABLE hw_invoice_rows
    ADD COLUMN IF NOT EXISTS upload_batch TEXT
  `);

  await pool.query(`
    ALTER TABLE hw_invoice_rows
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);
}

// Huawei'ye kesilen faturaların KALEM bazında detayı (hangi site+item'a fatura kesildi)
async function ensureHwInvoiceItemsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hw_invoice_items (
      id SERIAL PRIMARY KEY,
      invoice_no TEXT,
      site_id TEXT,
      po_no TEXT,
      release_no TEXT,
      line_no TEXT,
      po_qty NUMERIC,
      ac_qty NUMERIC,
      billed_qty NUMERIC,
      currency TEXT DEFAULT 'TRY',
      unit_price NUMERIC,
      tax_rate NUMERIC,
      acceptance_milestone TEXT,
      description TEXT,
      payment_terms TEXT,
      item_code TEXT,
      project_code TEXT,
      upload_batch TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // PDF eşleştirmesi için ek kolonlar (tablo zaten oluştuysa)
  await pool.query(`ALTER TABLE hw_invoice_items ADD COLUMN IF NOT EXISTS shipment_no TEXT`);
  await pool.query(`ALTER TABLE hw_invoice_items ADD COLUMN IF NOT EXISTS batch_id TEXT`);
  await pool.query(`ALTER TABLE hw_invoice_items ADD COLUMN IF NOT EXISTS upload_date DATE`);
  await pool.query(`ALTER TABLE hw_invoice_items ADD COLUMN IF NOT EXISTS invoiced_amount_incl NUMERIC`);
  await pool.query(`ALTER TABLE hw_invoice_items ADD COLUMN IF NOT EXISTS invoiced_amount_excl NUMERIC`);
  await pool.query(`ALTER TABLE hw_invoice_items ADD COLUMN IF NOT EXISTS invoice_matched_at TIMESTAMP`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_hw_invoice_items_site_item ON hw_invoice_items (site_id, item_code)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_hw_invoice_items_invoice ON hw_invoice_items (invoice_no)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_hw_invoice_items_pols ON hw_invoice_items (po_no, line_no, shipment_no)`);
}

/* ================== COMMON CTE ================== */
const COMMON_MATCH_CTES = `
  WITH best_site_po AS (
    -- Huawei aynı saha+kalem için birden fazla PO açabiliyor (ör. 2 gün vinç →
    -- 2 ayrı PO × 1 adet). Tek satır seçmek "requested 1 / done 2" gibi sahte
    -- fark üretiyordu; miktarlar artık saha+kalem bazında TOPLANIR, fiyat ve
    -- para birimi temsilci satırdan gelir (07.08.2026).
    SELECT DISTINCT ON (
        TRIM(COALESCE(project_code, '')),
        UPPER(TRIM(COALESCE(site_code, ''))),
        TRIM(COALESCE(item_code, '')))
      p.*,
      SUM(COALESCE(p.requested_qty, 0)) OVER w AS agg_requested_qty,
      SUM(COALESCE(p.billed_qty, 0)) OVER w AS agg_billed_qty,
      SUM(COALESCE(p.due_qty, 0)) OVER w AS agg_due_qty,
      COUNT(*) OVER w AS agg_po_count,
      string_agg(COALESCE(p.po_no, ''), ' + ') OVER w AS agg_po_no
    FROM po_rows p
    WHERE COALESCE(TRIM(p.item_code), '') <> ''
    WINDOW w AS (PARTITION BY
        TRIM(COALESCE(p.project_code, '')),
        UPPER(TRIM(COALESCE(p.site_code, ''))),
        TRIM(COALESCE(p.item_code, '')))
    ORDER BY
      TRIM(COALESCE(project_code, '')),
      UPPER(TRIM(COALESCE(site_code, ''))),
      TRIM(COALESCE(item_code, '')),
      COALESCE(unit_price, 0) DESC,
      COALESCE(requested_qty, 0) DESC,
      created_at DESC
  ),
  best_item_po AS (
    SELECT DISTINCT ON (item_code)
      *
    FROM po_rows
    WHERE COALESCE(TRIM(item_code), '') <> ''
    ORDER BY
      item_code,
      COALESCE(unit_price, 0) DESC,
      created_at DESC
  ),
  best_boq AS (
    SELECT DISTINCT ON (s_bom_code)
      *
    FROM boq_items
    WHERE COALESCE(TRIM(s_bom_code), '') <> ''
    ORDER BY
      s_bom_code,
      created_at DESC
  )
`;

function buildMasterJoinedQuery(
  extraWhere = "",
  extraOrder = "ORDER BY m.created_at DESC, m.id DESC",
) {
  return `
    ${COMMON_MATCH_CTES}
    SELECT
      m.id,
      m.site_type,
      m.project_code,
      m.site_code,
      m.item_code,
      COALESCE(NULLIF(TRIM(m.item_description), ''), best_boq.boq_items_en, '') AS item_description,
      COALESCE(m.done_qty, 0) AS done_qty,
      m.tamamlanan_qty,
      COALESCE(m.subcon_name, '') AS subcon_name,
      m.onair_date,
      COALESCE(m.note, '') AS note,
      COALESCE(m.qc_durum, '') AS qc_durum,
      COALESCE(m.kabul_durum, '') AS kabul_durum,
      COALESCE(m.kabul_not, '') AS kabul_not,
      m.created_at,

      COALESCE(site_po.agg_requested_qty, 0) AS requested_qty,
      COALESCE(site_po.agg_billed_qty, 0) AS billed_qty,
      COALESCE(site_po.agg_due_qty, 0) AS due_qty,
      COALESCE(site_po.po_no, '') AS po_no,
      COALESCE(site_po.agg_po_count, 0) AS po_adedi,
      COALESCE(site_po.agg_po_no, '') AS po_no_all,

      CASE
        WHEN TRIM(COALESCE(m.item_code, '')) = '8818278098' THEN 986.23
        WHEN site_po.id IS NOT NULL THEN COALESCE(site_po.unit_price, 0)
        ELSE COALESCE(item_po.unit_price, 0)
      END AS unit_price,

      CASE
        WHEN COALESCE(TRIM(best_boq.currency), '') <> ''
         THEN best_boq.currency
        WHEN site_po.id IS NOT NULL
         THEN COALESCE(site_po.currency, 'TRY')
        WHEN item_po.id IS NOT NULL
         THEN COALESCE(item_po.currency, 'TRY')
        ELSE 'TRY'
      END AS currency, 

      CASE
        WHEN COALESCE(m.done_qty, 0) = 0 THEN 'CANCEL'
        WHEN COALESCE(site_po.agg_requested_qty, 0) = 0 THEN 'PO_BEKLER'
        WHEN COALESCE(m.done_qty, 0) < COALESCE(site_po.agg_requested_qty, 0) THEN 'PARTIAL'
        ELSE 'OK'
      END AS status,

      COALESCE(m.done_qty, 0) *
      CASE
        WHEN TRIM(COALESCE(m.item_code, '')) = '8818278098' THEN 986.23
        WHEN site_po.id IS NOT NULL THEN COALESCE(site_po.unit_price, 0)
        ELSE COALESCE(item_po.unit_price, 0)
      END AS total_done_amount,

      (rp.pac_actual_end_date IS NOT NULL) AS pac_from_rollout,
      to_char(rp.qc_closed_date, 'YYYY-MM-DD') AS qc_closed_date

    FROM master_works m
    LEFT JOIN best_site_po site_po
      ON TRIM(COALESCE(site_po.project_code, '')) = TRIM(COALESCE(m.project_code, ''))
     AND UPPER(TRIM(COALESCE(site_po.site_code, ''))) = UPPER(TRIM(COALESCE(m.site_code, '')))
     AND TRIM(COALESCE(site_po.item_code, '')) = TRIM(COALESCE(m.item_code, ''))

    LEFT JOIN best_item_po item_po
      ON TRIM(COALESCE(item_po.item_code, '')) = TRIM(COALESCE(m.item_code, ''))

    LEFT JOIN best_boq
      ON TRIM(COALESCE(best_boq.s_bom_code, '')) = TRIM(COALESCE(m.item_code, ''))

    LEFT JOIN rollout_progress rp
      ON UPPER(TRIM(COALESCE(rp.site_code, ''))) = UPPER(TRIM(COALESCE(m.site_code, '')))

    ${extraWhere}
    ${extraOrder}
  `;
}

app.get("/", (req, res) => {
  res.send("Finance backend çalışıyor v05fd4ab");
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/debug/cors", (req, res) => {
  res.json({
    ok: true,
    origin: req.headers.origin || null,
  });
});

app.get("/debug/current-db", async (req, res) => {
  try {
    const dbName = await pool.query("SELECT current_database() AS db");
    const count = await pool.query(
      "SELECT COUNT(*)::int AS total FROM subcon_payables",
    );

    res.json({
      ok: true,
      db: dbName.rows[0]?.db,
      subcon_count: count.rows[0]?.total || 0,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get("/debug/counts", async (req, res) => {
  try {
    const tables = [
      "master_works",
      "po_rows",
      "boq_items",
      "rollout_progress",
      "invoice_entries",
      "hw_payment_rows",
      "hw_invoice_rows",
    ];

    const counts = {};

    for (const table of tables) {
      const r = await pool.query(`SELECT COUNT(*)::int AS total FROM ${table}`);
      counts[table] = r.rows[0].total;
    }

    res.json({ ok: true, counts });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
/* ================== FIX SITE TYPES ================== */
app.get("/rollout/fix-site-types", async (req, res) => {
  try {
    // Tüm "DİĞER" veya boş site_type kayıtlarını site_code'dan yeniden türet
    const rows = await pool.query(
      `SELECT id, site_code FROM rollout_progress WHERE UPPER(COALESCE(site_type,'')) IN ('DİĞER','DIGER','OTHER','')`
    );
    let fixed = 0, skipped = 0;
    for (const row of rows.rows) {
      const code = String(row.site_code || "").toUpperCase().trim();
      let newType = "";
      if (code.includes("_DSS_") || code.includes("_GPS_")) newType = "DSS";
      else if (code.includes("_L1800_") || code.includes("_L2600_") || code.includes("_L800_") ||
               code.includes("_LC1800_") || code.includes("_L2100_") || code.includes("_L900_") ||
               code.includes("_LTE_") || code.includes("_W2100_") || code.includes("_W900_") ||
               code.includes("_W1900_")) newType = "LTE";
      else if (code.includes("_NR3500_") || code.includes("_NR700_") || code.includes("_TRP_") ||
               code.includes("5GEXP") || code.includes("5GREADINESS")) newType = "5G";
      else if (code.includes("_NS_")) newType = "STANDALONE";

      if (newType) {
        await pool.query("UPDATE rollout_progress SET site_type=$1 WHERE id=$2", [newType, row.id]);
        fixed++;
      } else {
        skipped++;
      }
    }
    res.json({ ok: true, fixed, skipped, total: rows.rows.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ================== INSTANT MIGRATION ================== */
app.get("/migrate", async (req, res) => {
  const migrations = [
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS bolge TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS il TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS site_physical_type TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS project_code TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS malzeme_status TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS plan_start_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS installation_actual_start_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS installation_actual_end_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS onair_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS rf_not TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS atlas_status TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS qc_durum TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS qc_closed_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS los_subcon TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS los_plan_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS los_actual_end_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS los_belge_url TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tss_subcon TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tss_plan_start_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tss_actual_end_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tssr_subcon TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tssr_plan_start_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tssr_actual_end_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tssr_belge_url TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS btk_subcon TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS btk_plan_start_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS btk_actual_end_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS btk_approved TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS btk_certificate_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS btk_belge_url TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS gs_status TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS survey_note TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS emr_subcon TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS emr_plan_start_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS emr_actual_end_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS emr_belge_url TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS trs_subcon TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS trs_plan_start_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS trs_actual_end_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS trs_not TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_site_type TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_subcon TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_plan_start_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_actual_end_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_not TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_proje_subcon TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_proje_hazir DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_proje_not TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_proje_belge_url TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_qc_closed_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS suzme_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS power_subcon TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS power_plan_start_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS power_actual_end_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS abonelik_actual_end_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS abonelik_end_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tt_horizon_actual_end_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS pac_actual_end_date DATE",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS pac_belge_url TEXT",
    "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tamamlanma_tarihi DATE",
  ];
  const results = [];
  for (const sql of migrations) {
    try { await pool.query(sql); results.push({ ok: true, sql: sql.slice(0,60) }); }
    catch(e) { results.push({ ok: false, sql: sql.slice(0,60), err: e.message }); }
  }
  res.json({ done: true, results });
});

/* ================== DB SETUP ================== */
app.get("/setup-db", async (req, res) => {
  try {
    await pool.query(`
     CREATE TABLE IF NOT EXISTS supplier_advances (
       id SERIAL PRIMARY KEY,
       supplier_name TEXT NOT NULL,
       amount NUMERIC(14,2) NOT NULL DEFAULT 0,
       project_code TEXT,
       region TEXT,
       created_by TEXT,
       payment_date DATE,
       note TEXT,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS master_works (
       id SERIAL PRIMARY KEY,
       site_type TEXT,
       project_code TEXT,
       site_code TEXT,
       item_code TEXT,
       item_description TEXT,
       done_qty NUMERIC,
       subcon_name TEXT,
       onair_date DATE,
       note TEXT,
       qc_durum TEXT DEFAULT 'NOK',
       kabul_durum TEXT DEFAULT 'NOK',
       kabul_not TEXT,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
   `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rollout_sites (
        id SERIAL PRIMARY KEY,
        site_type TEXT,
        project_code TEXT,
        project_name TEXT,
        site_code TEXT NOT NULL,
        city TEXT,
        region TEXT,
        malzeme_status TEXT,
        hw_status TEXT,
        qc_durum TEXT,
        qc_aciklama TEXT,
        source_sheet TEXT,
        upload_batch TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_code, site_code, site_type)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS rollout_progress (
        id SERIAL PRIMARY KEY,
        site_code TEXT NOT NULL,
        site_type TEXT,

        rf_subcon TEXT,
        rf_started_date DATE,
        rf_finished_date DATE,
        rf_note TEXT,

        tss_subcon TEXT,
        tss_prepared_date DATE,
        tssr_subcon TEXT,
        tssr_sent_hw_date DATE,
        tssr_approved_date DATE,

        los_subcon TEXT,
        los_approved_date DATE,

        btk_subcon TEXT,
        btk_applied_date DATE,
        btk_approved_date DATE,

        gs_status TEXT,
        atlas_status TEXT,
        asbuilt_status TEXT,
        asbuilt_finished_date DATE,
        acceptance_docs TEXT,
        pac TEXT,

        survey_note TEXT,
        hakedis TEXT,
        btk_anten TEXT,
        montaj_anten TEXT,

        onair_date DATE,
        general_note TEXT,

        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(site_code, site_type)
      );
    `);

    // Eksik kolonlar — ALTER TABLE IF NOT EXISTS (idempotent)
    const missingCols = [
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS bolge TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS il TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS site_physical_type TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS project_code TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS malzeme_status TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS plan_start_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS installation_actual_start_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS installation_actual_end_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS onair_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS rf_not TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS atlas_status TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS qc_durum TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS qc_closed_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS los_plan_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS los_actual_end_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tss_plan_start_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tss_actual_end_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tssr_plan_start_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tssr_actual_end_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS btk_plan_start_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS btk_actual_end_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS btk_approved TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS btk_certificate_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_site_type TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_subcon TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_plan_start_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_actual_end_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_not TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_qc_closed_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS suzme_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS power_subcon TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS power_plan_start_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS power_actual_end_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS abonelik_actual_end_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS abonelik_end_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tt_horizon_actual_end_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS pac_actual_end_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS trs_subcon TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS trs_plan_start_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS trs_actual_end_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS trs_not TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS emr_subcon TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS emr_plan_start_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS emr_actual_end_date DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_proje_subcon TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_proje_hazir DATE",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_proje_not TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_proje_belge_url TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS los_belge_url TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tssr_belge_url TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS btk_belge_url TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS emr_belge_url TEXT",
      "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS pac_belge_url TEXT",
    ];
    for (const sql of missingCols) {
      await pool.query(sql).catch(() => {}); // sessizce atla, zaten varsa sorun değil
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS rollout_files (
        id SERIAL PRIMARY KEY,
        site_code TEXT NOT NULL,
        site_type TEXT,
        file_type TEXT NOT NULL,
        original_name TEXT,
        file_path TEXT NOT NULL,
        uploaded_by TEXT,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS rollout_cleanup (
        id SERIAL PRIMARY KEY,
        site_code TEXT NOT NULL UNIQUE,
        visit_date DATE,
        notification_date DATE,
        completion_date DATE,
        items JSONB DEFAULT '[]',
        notlar TEXT,
        screenshot_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS rollout_cleanup_site_code_idx ON rollout_cleanup (site_code);
    `).catch(() => {});

    await pool.query(`
      CREATE TABLE IF NOT EXISTS po_rows (
        id SERIAL PRIMARY KEY,
        project_code TEXT,
        site_code TEXT,
        item_code TEXT,
        item_description TEXT,
        unit_price NUMERIC,
        currency TEXT,
        requested_qty NUMERIC,
        billed_qty NUMERIC,
        due_qty NUMERIC,
        po_no TEXT,
        po_line_no TEXT,
        shipment_no TEXT,
        upload_batch TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`ALTER TABLE po_rows ADD COLUMN IF NOT EXISTS po_line_no TEXT`);
    await pool.query(`ALTER TABLE po_rows ADD COLUMN IF NOT EXISTS shipment_no TEXT`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS boq_items (
        id SERIAL PRIMARY KEY,
        s_bom_code TEXT,
        boq_items_en TEXT,
        currency TEXT,
        unit_price NUMERIC,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      ALTER TABLE master_works
      ADD COLUMN IF NOT EXISTS qc_durum TEXT DEFAULT 'NOK'
    `);

    await pool.query(`
      ALTER TABLE master_works
      ADD COLUMN IF NOT EXISTS kabul_durum TEXT DEFAULT 'NOK'
    `);

    await pool.query(`
      ALTER TABLE master_works
      ADD COLUMN IF NOT EXISTS kabul_not TEXT
    `);

    // Fiziki tamamlanan miktar (16.07.2026): done_qty PO talebine esas iş
    // miktarıdır; tamamlanan_qty sahada gerçekten biten miktar. NULL = done
    // ile aynı kabul edilir (eski kayıtlar için geriye dönük uyum).
    await pool.query(`
      ALTER TABLE master_works
      ADD COLUMN IF NOT EXISTS tamamlanan_qty NUMERIC
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS hw_payment_rows (
        id SERIAL PRIMARY KEY,
        invoice_no TEXT,
        invoice_amount NUMERIC DEFAULT 0,
        payment_amount NUMERIC DEFAULT 0,
        prepayment_amount NUMERIC DEFAULT 0,
        remaining_amount NUMERIC DEFAULT 0,
        payment_date DATE,
        due_date DATE,
        customer_name TEXT,
        payment_method TEXT,
        supplier_code TEXT,
        supplier_name TEXT,
        currency TEXT DEFAULT 'TRY',
        upload_batch TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await ensureHwInvoiceTable();
    await ensureHwAcceptanceTable();

    await pool.query(`
      CREATE TABLE IF NOT EXISTS finance_expenses (
        id SERIAL PRIMARY KEY,
        expense_date DATE,
        expense_type TEXT,
        description TEXT,
        amount NUMERIC DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoice_entries (
       id SERIAL PRIMARY KEY,
       bolge TEXT,
       proje TEXT,
       proje_kodu TEXT,
       fatura_no TEXT,
       fatura_tarihi DATE,
       tedarikci TEXT,
       fatura_kalemi TEXT,
       is_kalemi TEXT,
       po_no TEXT,
       site_id TEXT,
       tutar NUMERIC DEFAULT 0,
       kdv NUMERIC DEFAULT 0,
       toplam_tutar NUMERIC DEFAULT 0,
       odenen_tutar NUMERIC DEFAULT 0,
       kalan_borc NUMERIC DEFAULT 0,
       note TEXT,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
     );
   `);

    await pool.query(`
     CREATE TABLE IF NOT EXISTS personel_cards (
       id SERIAL PRIMARY KEY,
       ad_soyad TEXT NOT NULL,
       unvan TEXT,
       bolge TEXT,
       net_maas NUMERIC DEFAULT 0,
       banka_net_maas NUMERIC DEFAULT 0,
       elden_net_maas NUMERIC DEFAULT 0,
       aylik_isveren_maliyeti NUMERIC DEFAULT 0,
       aktif BOOLEAN DEFAULT true,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
     CREATE TABLE IF NOT EXISTS personel_salary_movements (
       id SERIAL PRIMARY KEY,
       personel_id INTEGER NOT NULL REFERENCES personel_cards(id) ON DELETE CASCADE,
       donem_ay INTEGER NOT NULL,
       donem_yil INTEGER NOT NULL,
       hareket_turu TEXT NOT NULL,
       odeme_kanali TEXT,
       tutar NUMERIC DEFAULT 0,
       aciklama TEXT,
       note TEXT,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
     );
   `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS subcon_payables (
        id SERIAL PRIMARY KEY,
        subcon_name TEXT,
        invoice_amount NUMERIC DEFAULT 0,
        paid_amount NUMERIC DEFAULT 0,
        note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Subcons master list
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subcons (
        id SERIAL PRIMARY KEY,
        subcon_name TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Normalize existing subcon names in master_works to UPPERCASE
    await pool.query(`
      UPDATE master_works
      SET subcon_name = UPPER(TRIM(subcon_name))
      WHERE subcon_name IS NOT NULL AND subcon_name != '';
    `);

    // Seed subcons table from master_works distinct values
    await pool.query(`
      INSERT INTO subcons (subcon_name)
      SELECT DISTINCT UPPER(TRIM(subcon_name))
      FROM master_works
      WHERE subcon_name IS NOT NULL AND TRIM(subcon_name) != ''
      ON CONFLICT (subcon_name) DO NOTHING;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS finance_salary (
       id SERIAL PRIMARY KEY,
       ad_soyad TEXT NOT NULL,
       unvan TEXT,
       net_maas NUMERIC DEFAULT 0,
       avans NUMERIC DEFAULT 0,
       kalan_net_odeme NUMERIC DEFAULT 0,
       bankaya_yatacak_net NUMERIC DEFAULT 0,
       elden_odenecek_net NUMERIC DEFAULT 0,
       banka_maliyeti NUMERIC DEFAULT 0,
       toplam_isveren_maliyeti NUMERIC DEFAULT 0,
       ay VARCHAR(7) NOT NULL,
       note TEXT,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
     );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS taseron_fatura (
        id SERIAL PRIMARY KEY,
        taseron_adi TEXT NOT NULL,
        fatura_no TEXT,
        fatura_tarihi DATE,
        toplam_tutar NUMERIC DEFAULT 0,
        kdv_tutar NUMERIC DEFAULT 0,
        genel_toplam NUMERIC DEFAULT 0,
        odenen_tutar NUMERIC DEFAULT 0,
        kalan_tutar NUMERIC DEFAULT 0,
        pdf_url TEXT,
        aciklama TEXT,
        durum TEXT DEFAULT 'bekliyor',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS taseron_fatura_kalem (
        id SERIAL PRIMARY KEY,
        fatura_id INTEGER REFERENCES taseron_fatura(id) ON DELETE CASCADE,
        site_id TEXT,
        saha_adi TEXT,
        kalem_aciklama TEXT,
        tutar NUMERIC DEFAULT 0,
        odenen NUMERIC DEFAULT 0,
        kalan NUMERIC DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS taseron_odeme (
        id SERIAL PRIMARY KEY,
        taseron_adi TEXT NOT NULL,
        fatura_id INTEGER REFERENCES taseron_fatura(id) ON DELETE SET NULL,
        tutar NUMERIC NOT NULL DEFAULT 0,
        odeme_tarihi DATE DEFAULT CURRENT_DATE,
        aciklama TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    res.json({ ok: true, message: "Tüm DB hazır ✅" });
  } catch (err) {
    console.error("SETUP DB ERROR FULL:", err);
    res.status(500).json({
      ok: false,
      error: err?.message || String(err) || "Setup DB hatası",
      detail: err?.stack || null,
    });
  }
});

/* ================== TEST ================== */
app.get("/test-boq", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM boq_items ORDER BY id DESC LIMIT 20",
    );
    res.json({ ok: true, rows: result.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/test-po-rows", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM po_rows ORDER BY id DESC LIMIT 20",
    );
    res.json({ ok: true, rows: result.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== FORCE RESET BOQ ================== */
app.get("/force-reset-boq", async (req, res) => {
  try {
    await pool.query(`DROP TABLE IF EXISTS boq_items`);

    await pool.query(`
      CREATE TABLE boq_items (
        id SERIAL PRIMARY KEY,
        s_bom_code TEXT,
        boq_items_en TEXT,
        currency TEXT,
        unit_price NUMERIC,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    res.json({ ok: true, message: "boq_items sıfırlandı ✅" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== FINANCE SUMMARY ================== */
app.get("/finance/summary", async (req, res) => {
  try {
    // Türkiye saati (UTC+3) baz alınarak yıl/ay belirlenir
    const TR_OFFSET_MS = 3 * 60 * 60 * 1000;
    const nowTR = new Date(Date.now() + TR_OFFSET_MS);
    const year  = nowTR.getUTCFullYear();
    const month = nowTR.getUTCMonth() + 1;

    // USD ödemeleri TL'ye çevirmek için TCMB satış kuru (alınamazsa 0 → USD satırları sayılmaz, TRY etkilenmez)
    let usdRate = 0;
    try { usdRate = Number(await getTcmbUsdTrySellingRate()) || 0; } catch { usdRate = 0; }

    const monthly_received = {};
    const monthly_invoiced = {};

    for (let i = 1; i <= 12; i += 1) {
      monthly_received[i] = 0;
      monthly_invoiced[i] = 0;
    }

    const upcomingData = await buildUpcomingCollectionsData();

    const [
      receivedResult,
      invoicedResult,
      totalCollectionsResult,
      thisMonthCollectionsResult,
      expenseCountResult,
    ] = await Promise.all([
      pool.query(
        `
        SELECT
          EXTRACT(MONTH FROM payment_date)::int AS month_no,
          SUM(CASE WHEN UPPER(COALESCE(currency,'TRY'))='USD'
                   THEN COALESCE(payment_amount, 0) * $2
                   ELSE COALESCE(payment_amount, 0) END) AS total
        FROM hw_payment_rows
        WHERE EXTRACT(YEAR FROM payment_date) = $1
          AND payment_date IS NOT NULL
        GROUP BY EXTRACT(MONTH FROM payment_date)
        ORDER BY month_no
        `,
        [year, usdRate],
      ),

      pool.query(
        `
        SELECT
          EXTRACT(MONTH FROM invoice_date)::int AS month_no,
          SUM(COALESCE(invoice_amount, 0)) AS total
        FROM hw_invoice_rows
        WHERE EXTRACT(YEAR FROM invoice_date) = $1
        GROUP BY EXTRACT(MONTH FROM invoice_date)
        ORDER BY month_no
        `,
        [year],
      ),

      pool.query(
        `
        SELECT SUM(CASE WHEN UPPER(COALESCE(currency,'TRY'))='USD'
                        THEN COALESCE(payment_amount, 0) * $2
                        ELSE COALESCE(payment_amount, 0) END) AS total_collections
        FROM hw_payment_rows
        WHERE EXTRACT(YEAR FROM payment_date) = $1
          AND payment_date IS NOT NULL
        `,
        [year, usdRate],
      ),

      pool.query(
        `
        SELECT SUM(CASE WHEN UPPER(COALESCE(currency,'TRY'))='USD'
                        THEN COALESCE(payment_amount, 0) * $3
                        ELSE COALESCE(payment_amount, 0) END) AS this_month_collections
        FROM hw_payment_rows
        WHERE EXTRACT(YEAR FROM payment_date) = $1
          AND EXTRACT(MONTH FROM payment_date) = $2
          AND payment_date IS NOT NULL
        `,
        [year, month, usdRate],
      ),

      pool.query(`
        SELECT COUNT(*) AS expense_count
        FROM finance_expenses
      `),
    ]);

    receivedResult.rows.forEach((row) => {
      monthly_received[row.month_no] = Number(row.total || 0);
    });

    invoicedResult.rows.forEach((row) => {
      monthly_invoiced[row.month_no] = Number(row.total || 0);
    });

    res.json({
      ok: true,
      summary: {
        total_collections: Number(totalCollectionsResult.rows[0]?.total_collections || 0),
        this_month_collections: Number(thisMonthCollectionsResult.rows[0]?.this_month_collections || 0),
        expense_count: Number(expenseCountResult.rows[0]?.expense_count || 0),
        monthly_received,
        monthly_invoiced,
        monthly_upcoming: upcomingData.monthlyUpcoming,
      },
    });
  } catch (error) {
    console.error("FINANCE SUMMARY ERROR:", error);
    res.status(500).json({
      ok: false,
      error: "Finance summary alınırken hata oluştu",
      detail: error.message,
    });
  }
});

app.get("/finance/invoices/list", async (req, res) => {
  try {
    await ensureHwInvoiceTable();

    const result = await pool.query(`
      SELECT
        id,
        invoice_no,
        COALESCE(invoice_amount, 0) AS invoice_amount,
        invoice_date,
        COALESCE(customer_name, '') AS customer_name,
        COALESCE(currency, 'TRY') AS currency
      FROM hw_invoice_rows
      ORDER BY invoice_date DESC NULLS LAST, id DESC
    `);

    res.json({ ok: true, rows: result.rows || [] });
  } catch (err) {
    console.error("FINANCE INVOICES LIST ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== LOOKUP PROJECT CODES ================== */
app.get("/lookup/project-codes", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT project_code
      FROM po_rows
      WHERE COALESCE(TRIM(project_code), '') <> ''
      ORDER BY project_code
    `);

    res.json({ ok: true, rows: result.rows });
  } catch (err) {
    console.error("LOOKUP PROJECT CODES ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== LOOKUP ITEMS FROM BOQ ================== */
app.get("/lookup/items", async (req, res) => {
  try {
    const { search = "" } = req.query;

    const result = await pool.query(
      `
      SELECT DISTINCT
        TRIM(COALESCE(s_bom_code, '')) AS item_code,
        TRIM(COALESCE(boq_items_en, '')) AS item_description,
        TRIM(COALESCE(currency, '')) AS currency,
        COALESCE(unit_price, 0) AS unit_price
      FROM boq_items
      WHERE TRIM(COALESCE(s_bom_code, '')) <> ''
        AND TRIM(COALESCE(boq_items_en, '')) <> ''
        AND (
          $1 = ''
          OR LOWER(TRIM(COALESCE(s_bom_code, ''))) LIKE LOWER('%' || TRIM($1) || '%')
          OR LOWER(TRIM(COALESCE(boq_items_en, ''))) LIKE LOWER('%' || TRIM($1) || '%')
        )
      ORDER BY TRIM(COALESCE(boq_items_en, '')) ASC
      `,
      [search],
    );

    const rows = (result.rows || []).map((row) => ({
      ...row,
      currency: normalizeCurrency(row.currency),
    }));

    res.json({ ok: true, rows });
  } catch (err) {
    console.error("LOOKUP ITEMS ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== LOOKUP SITE PO ROWS ================== */
app.get("/lookup/site-pos", async (req, res) => {
  try {
    const { site_code = "" } = req.query;

    if (!site_code) {
      return res.json({ ok: true, rows: [] });
    }

    const result = await pool.query(
      `
      ${COMMON_MATCH_CTES}
      SELECT
        site_po.po_no,
        site_po.project_code,
        site_po.site_code,
        site_po.item_code,
        COALESCE(NULLIF(TRIM(site_po.item_description), ''), best_boq.boq_items_en, '') AS item_description,
        COALESCE(site_po.agg_requested_qty, 0) AS requested_qty,
        COALESCE(site_po.agg_billed_qty, 0) AS billed_qty,
        COALESCE(site_po.agg_due_qty, 0) AS due_qty,
        COALESCE(site_po.agg_po_count, 0) AS po_adedi,
        COALESCE(site_po.agg_po_no, '') AS po_no_all,
        COALESCE(site_po.unit_price, 0) AS unit_price,
        COALESCE(best_boq.currency, 'TRY') AS currency
      FROM best_site_po site_po
      LEFT JOIN best_boq
        ON TRIM(COALESCE(best_boq.s_bom_code, '')) = TRIM(COALESCE(site_po.item_code, ''))
      WHERE UPPER(TRIM(COALESCE(site_po.site_code, ''))) = UPPER(TRIM($1))
      ORDER BY site_po.project_code ASC, item_description ASC
      `,
      [site_code],
    );

    const rows = (result.rows || []).map((row) => ({
      ...row,
      currency: normalizeCurrency(row.currency),
    }));

    res.json({ ok: true, rows });
  } catch (err) {
    console.error("LOOKUP SITE POS ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== MASTER BY SITE ================== */
app.get("/master/by-site", async (req, res) => {
  try {
    const { project_code = "", site_code = "" } = req.query;

    const query = buildMasterJoinedQuery(
      `
       WHERE ($1 = '' OR TRIM(COALESCE(m.project_code, '')) = TRIM($1))
       AND ($2 = '' OR UPPER(TRIM(COALESCE(m.site_code, ''))) = UPPER(TRIM($2)))
      `,
      "ORDER BY m.created_at DESC, m.id DESC",
    );

    const result = await pool.query(query, [project_code, site_code]);

    const rows = (result.rows || []).map((row) => ({
      ...row,
      currency: normalizeCurrency(row.currency),
    }));

    res.json({ ok: true, rows });
  } catch (err) {
    console.error("MASTER BY SITE ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== MASTER LIST DETAILED ================== */
app.get("/master/list-detailed", async (req, res) => {
  try {
    const result = await pool.query(buildMasterJoinedQuery());

    const rows = (result.rows || []).map((row) => ({
      ...row,
      currency: normalizeCurrency(row.currency),
    }));

    res.json({ ok: true, rows });
  } catch (err) {
    console.error("MASTER LIST DETAILED ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== DASHBOARD RESULT ================== */
app.get("/dashboard/result", authMiddleware, async (req, res) => {
  const isAdmin = req.user?.role === "admin";
  const subconName = req.user?.subcon_name || null;

  try {
    // Kapsam: subcon rolü VEYA alt marka (AHY yönetimi) yalnız kendi işlerini
    // görür — 'AHY' / 'AHY ELEKTRİK' yazımları canonSub ile eşlenir.
    const scopeName = subconScope(req);

    const result = await pool.query(buildMasterJoinedQuery(""), []);

    let rows = (result.rows || []).map((row) => ({
      ...row,
      currency: normalizeCurrency(row.currency),
    }));
    if (scopeName) {
      // FERRUMX kapsamı hem "FERRUMX" hem "AHY_FERRUMX" satırlarını içerir
      rows = rows.filter((row) => subconRowMatches(scopeName, row.subcon_name));
    }

    res.json({ ok: true, rows });
  } catch (err) {
    console.error("DASHBOARD RESULT ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== FINANCE SALARY ================== */

app.get("/finance/salary/payment-plan", async (req, res) => {
  try {
    const { ay, yil } = req.query;

    let sql = `
      SELECT
        id,
        ad_soyad,
        unvan,
        ay,
        COALESCE(net_maas, 0) AS net_maas,
        COALESCE(avans, 0) AS avans,
        COALESCE(kalan_net_odeme, 0) AS kalan_net_odeme,
        COALESCE(bankaya_yatacak_net, 0) AS bankaya_yatacak_net,
        COALESCE(elden_odenecek_net, 0) AS elden_odenecek_net,
        COALESCE(banka_maliyeti, 0) AS banka_maliyeti,
        COALESCE(toplam_isveren_maliyeti, 0) AS toplam_isveren_maliyeti,
        COALESCE(note, '') AS note,
        created_at
      FROM finance_salary
      WHERE 1=1
    `;

    const params = [];

    if (ay && yil) {
      params.push(`${yil}-${String(ay).padStart(2, "0")}`);
      sql += ` AND ay = $${params.length} `;
    } else if (yil) {
      params.push(`${yil}-%`);
      sql += ` AND ay LIKE $${params.length} `;
    }

    sql += ` ORDER BY ad_soyad ASC `;

    const result = await pool.query(sql, params);

    const rows = (result.rows || []).map((row) => {
      const netMaas = Number(row.net_maas || 0);
      const avans = Number(row.avans || 0);
      const kalan = Number(row.kalan_net_odeme || 0);

      let durum = "KAPANDI";
      if (avans > netMaas) durum = "FAZLA_ODEME";
      else if (kalan > 0) durum = "ALACAKLI";

      return {
        ...row,
        durum,
        fazla_odeme: avans > netMaas ? avans - netMaas : 0,
      };
    });

    const summary = rows.reduce(
      (acc, row) => {
        acc.toplam_net_maas += Number(row.net_maas || 0);
        acc.toplam_avans += Number(row.avans || 0);
        acc.toplam_kalan += Number(row.kalan_net_odeme || 0);
        acc.toplam_bankaya += Number(row.bankaya_yatacak_net || 0);
        acc.toplam_elden += Number(row.elden_odenecek_net || 0);
        acc.toplam_banka_maliyeti += Number(row.banka_maliyeti || 0);
        acc.toplam_isveren_maliyeti += Number(row.toplam_isveren_maliyeti || 0);

        if (row.durum === "ALACAKLI") acc.alacakli_sayisi += 1;
        if (row.durum === "FAZLA_ODEME") acc.fazla_odeme_sayisi += 1;
        if (row.durum === "KAPANDI") acc.kapandi_sayisi += 1;

        return acc;
      },
      {
        toplam_net_maas: 0,
        toplam_avans: 0,
        toplam_kalan: 0,
        toplam_bankaya: 0,
        toplam_elden: 0,
        toplam_banka_maliyeti: 0,
        toplam_isveren_maliyeti: 0,
        alacakli_sayisi: 0,
        fazla_odeme_sayisi: 0,
        kapandi_sayisi: 0,
      },
    );

    res.json({
      ok: true,
      rows,
      summary,
    });
  } catch (err) {
    console.error("SALARY PAYMENT PLAN ERROR:", err.message);
    res.status(500).json({
      ok: false,
      error: err.message || "Toplu ödeme planı alınamadı",
    });
  }
});

app.get("/finance/salary/list", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM finance_salary
      ORDER BY id DESC
    `);

    res.json({
      ok: true,
      rows: result.rows || [],
    });
  } catch (err) {
    console.error("SALARY LIST ERROR:", err.message);
    res.status(500).json({
      ok: false,
      error: err.message || "Salary list alınamadı",
    });
  }
});

app.get("/finance/salary/export-excel", async (req, res) => {
  try {
    const { ay, yil } = req.query;

    let sql = `
     SELECT
       id,
       ad_soyad,
       unvan,
       COALESCE(net_maas, 0) AS net_maas,
       COALESCE(avans, 0) AS avans,
       COALESCE(kalan_net_odeme, 0) AS kalan_net_odeme,
       COALESCE(bankaya_yatacak_net, 0) AS bankaya_yatacak_net,
       COALESCE(elden_odenecek_net, 0) AS elden_odenecek_net,
       COALESCE(banka_maliyeti, 0) AS banka_maliyeti,
       COALESCE(toplam_isveren_maliyeti, 0) AS toplam_isveren_maliyeti,
       ay,
       COALESCE(note, '') AS note,
       created_at
      FROM finance_salary
      WHERE 1=1
    `;

    const params = [];

    if (ay && yil) {
      params.push(`${yil}-${String(ay).padStart(2, "0")}`);
      sql += ` AND ay = $${params.length} `;
    } else if (yil) {
      params.push(`${yil}-%`);
      sql += ` AND ay LIKE $${params.length} `;
    }

    sql += ` ORDER BY ay DESC, ad_soyad ASC, id DESC `;

    const result = await pool.query(sql, params);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Maas_Avans");

    worksheet.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Ad Soyad", key: "ad_soyad", width: 24 },
      { header: "Ünvan", key: "unvan", width: 20 },
      { header: "Dönem", key: "ay", width: 14 },
      { header: "Net Maaş", key: "net_maas", width: 14 },
      { header: "Avans", key: "avans", width: 14 },
      { header: "Kalan Net Ödeme", key: "kalan_net_odeme", width: 18 },
      { header: "Bankaya Yatacak Net", key: "bankaya_yatacak_net", width: 18 },
      { header: "Elden Ödenecek Net", key: "elden_odenecek_net", width: 18 },
      { header: "Banka Maliyeti", key: "banka_maliyeti", width: 16 },
      {
        header: "Toplam İşveren Maliyeti",
        key: "toplam_isveren_maliyeti",
        width: 22,
      },
      { header: "Not", key: "note", width: 28 },
      { header: "Kayıt Zamanı", key: "created_at", width: 22 },
    ];

    worksheet.mergeCells("A1:M1");
    const titleCell = worksheet.getCell("A1");

    titleCell.value = `MAAŞ & AVANS RAPORU (${new Date().toLocaleDateString("tr-TR")})`;
    titleCell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    titleCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "1F4E78" },
    };
    worksheet.getRow(1).height = 28;

    const headerRow = worksheet.getRow(2);
    worksheet.columns.forEach((col, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = col.header;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "2F5D8A" },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "D9D9D9" } },
        left: { style: "thin", color: { argb: "D9D9D9" } },
        bottom: { style: "thin", color: { argb: "D9D9D9" } },
        right: { style: "thin", color: { argb: "D9D9D9" } },
      };
    });
    headerRow.height = 24;

    result.rows.forEach((row) => {
      worksheet.addRow({
        id: row.id,
        ad_soyad: row.ad_soyad || "",
        unvan: row.unvan || "",
        ay: row.ay || "",
        net_maas: Number(row.net_maas || 0),
        avans: Number(row.avans || 0),
        kalan_net_odeme: Number(row.kalan_net_odeme || 0),
        bankaya_yatacak_net: Number(row.bankaya_yatacak_net || 0),
        elden_odenecek_net: Number(row.elden_odenecek_net || 0),
        banka_maliyeti: Number(row.banka_maliyeti || 0),
        toplam_isveren_maliyeti: Number(row.toplam_isveren_maliyeti || 0),
        note: row.note || "",
        created_at: row.created_at,
      });
    });

    worksheet.autoFilter = {
      from: "A2",
      to: "M2",
    };

    worksheet.views = [
      {
        state: "frozen",
        xSplit: 0,
        ySplit: 2,
        showGridLines: false,
      },
    ];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber < 3) return;

      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "E5E7EB" } },
          left: { style: "thin", color: { argb: "E5E7EB" } },
          bottom: { style: "thin", color: { argb: "E5E7EB" } },
          right: { style: "thin", color: { argb: "E5E7EB" } },
        };

        cell.alignment = {
          vertical: "middle",
          horizontal: "left",
        };

        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb: rowNumber % 2 === 0 ? "F3F4F6" : "FFFFFF",
          },
        };
      });
    });

    [5, 6, 7, 8, 9, 10, 11].forEach((colIndex) => {
      worksheet.getColumn(colIndex).numFmt = "#,##0";
    });

    worksheet.getColumn(13).numFmt = "dd.mm.yyyy hh:mm:ss";

    const fileName = `maas_avans_${yil || "tum"}_${ay || "tum"}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    applyPremiumExcelStyle(worksheet, {
      headerRowNumber: 2,
      freezeRow: 2,
      filterFrom: "A2",
      filterTo: "P2",
      statusColumn: "B",
    });

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("SALARY EXPORT EXCEL ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/finance/supplier-advances", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        supplier_name,
        amount,
        project_code,
        region,
        created_by,
        payment_date,
        note,
        created_at
      FROM supplier_advances
      ORDER BY created_at DESC, id DESC
    `);

    const totalResult = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) AS total_advance
      FROM supplier_advances
    `);

    res.json({
      ok: true,
      rows: result.rows,
      total_advance: Number(totalResult.rows[0]?.total_advance || 0),
    });
  } catch (err) {
    console.error("SUPPLIER ADVANCES ERROR:", err);
    res.status(500).json({
      ok: false,
      error: "Taşeron avansları alınırken hata oluştu",
      detail: err.message,
    });
  }
});

async function syncRolloutTargets(siteCodesFilter = []) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    console.log("SYNC START");

    const filterSites = (siteCodesFilter || [])
      .map((x) =>
        String(x || "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean);

    const baseQuery = buildMasterJoinedQuery().replace(/;+\s*$/, "");

    const masterResult =
      filterSites.length > 0
        ? await client.query(
            `
        SELECT *
        FROM (${baseQuery}) AS mw
        WHERE UPPER(TRIM(COALESCE(mw.site_code, ''))) = ANY($1::text[])
        `,
            [filterSites],
          )
        : await client.query(baseQuery);

    console.log("MASTER RESULT GELDI:", masterResult.rows.length);

    const today = new Date().toISOString().slice(0, 10);

    const targetItemCodes = {
      "5G": ["8818274542", "8818274543", "8812184609", "8812184598"],
      LTE: ["8818274542", "8818274543", "8812184609", "8812184598"],
      DSS: ["88123MGE", "8818270797", "8812184697"],
      STANDALONE: ["8812184591", "8812184592"],
    };

    const detectType = (row) => {
      const siteCode = String(row.site_code || "").toUpperCase();
      const rowType = String(row.site_type || "").toUpperCase();

      if (
        rowType === "5G" ||
        siteCode.includes("_5GEXP_") ||
        siteCode.includes("NR3500")
      )
        return "5G";

      if (rowType === "DSS" || siteCode.includes("_DSS_")) return "DSS";

      if (
        rowType === "LTE" ||
        siteCode.includes("L800") ||
        siteCode.includes("L1800") ||
        siteCode.includes("L2600") ||
        siteCode.includes("L2100") ||
        siteCode.includes("NR700") ||
        siteCode.includes("TRP")
      )
        return "LTE";

      if (rowType === "STANDALONE") return "STANDALONE";

      return rowType || "";
    };

    const candidateMap = new Map();

    for (const row of masterResult.rows || []) {
      const siteCode = String(row.site_code || "")
        .trim()
        .toUpperCase();
      const itemCode = String(row.item_code || "").trim();
      const doneQty = Number(row.done_qty || 0);

      if (!siteCode || doneQty <= 0) continue;

      const siteType = detectType(row);
      const validCodes = targetItemCodes[siteType] || [];

      if (!validCodes.includes(itemCode)) continue;

      if (!candidateMap.has(siteCode)) {
        candidateMap.set(siteCode, {
          site_code: siteCode,
          site_type: siteType,
          project_code: row.project_code || "",
          il: row.il || row.city || "",
          bolge:
            row.bolge || row.region || getRegionFromSiteCode(siteCode) || "",
          rf_subcon: row.subcon_name || "",
          onair_date: row.onair_date || null,
          plan_start_date: row.onair_date || today,
        });
      }
    }

    const candidates = [...candidateMap.values()];

    let inserted = 0;
    let updated = 0;

    for (const row of candidates) {
      const existing = await client.query(
        `
        SELECT id, plan_start_date, onair_date
        FROM rollout_progress
        WHERE UPPER(TRIM(site_code)) = UPPER(TRIM($1))
        LIMIT 1
        `,
        [row.site_code],
      );

      if (existing.rows.length === 0) {
        await client.query(
          `
          INSERT INTO rollout_progress (
            site_code,
            site_type,
            project_code,
            il,
            bolge,
            rf_subcon,
            plan_start_date,
            onair_date,
            malzeme_status
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          `,
          [
            row.site_code,
            row.site_type,
            row.project_code,
            row.il,
            row.bolge,
            row.rf_subcon,
            row.plan_start_date,
            row.onair_date,
            "OK",
          ],
        );

        inserted += 1;
      } else {
        const old = existing.rows[0];

        await client.query(
          `
          UPDATE rollout_progress
          SET
            plan_start_date = COALESCE(plan_start_date, $1),
            onair_date = COALESCE(onair_date, $2),
            site_type = COALESCE(NULLIF(site_type, ''), $3),
            project_code = COALESCE(NULLIF(project_code, ''), $4),
            bolge = COALESCE(NULLIF(bolge, ''), $5),
            il = COALESCE(NULLIF(il, ''), $6),
            rf_subcon = COALESCE(NULLIF(rf_subcon, ''), $7),
            malzeme_status = COALESCE(NULLIF(malzeme_status, ''), 'OK'),
            updated_at = NOW()
          WHERE id = $8
          `,
          [
            row.plan_start_date,
            row.onair_date,
            row.site_type,
            row.project_code,
            row.bolge,
            row.il,
            row.rf_subcon,
            old.id,
          ],
        );

        updated += 1;
      }
    }

    await client.query("COMMIT");

    return {
      scanned: masterResult.rows.length,
      targetSites: candidates.length,
      inserted,
      updated,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

app.post("/rollout/auto-sync-targets", async (req, res) => {
  try {
    const result = await syncRolloutTargets();

    res.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    console.error("ROLLOUT AUTO SYNC ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/finance/invoices/apply-advance", async (req, res) => {
  const client = await pool.connect();

  try {
    const dbCheck = await client.query(`
      SELECT current_database() AS db, current_schema() AS schema
    `);
    console.log("APPLY_ADVANCE DB CHECK:", dbCheck.rows[0]);

    const tableCheck = await client.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_name = 'supplier_advances'
    `);
    console.log("SUPPLIER_ADVANCES TABLE CHECK:", tableCheck.rows);

    const {
      supplier_name,
      amount,
      payment_date,
      note,
      project_code,
      region,
      created_by,
    } = req.body;

    const advanceAmount = Number(amount || 0);

    if (!supplier_name || advanceAmount <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Tedarikçi ve geçerli tutar zorunludur",
      });
    }

    await client.query("BEGIN");

    const invoiceResult = await client.query(
      `
      SELECT
        id,
        tedarikci,
        fatura_no,
        fatura_tarihi,
        toplam_tutar,
        odenen_tutar,
        kalan_borc
      FROM invoice_entries
      WHERE TRIM(UPPER(COALESCE(tedarikci, ''))) = TRIM(UPPER($1))
        AND COALESCE(kalan_borc, 0) > 0
      ORDER BY fatura_tarihi ASC, id ASC
      `,
      [supplier_name],
    );

    let remainingAdvance = advanceAmount;
    const appliedRows = [];

    for (const invoice of invoiceResult.rows) {
      if (remainingAdvance <= 0) break;

      const currentRemaining = Number(invoice.kalan_borc || 0);
      if (currentRemaining <= 0) continue;

      const applyAmount = Math.min(remainingAdvance, currentRemaining);

      const newPaid = Number(invoice.odenen_tutar || 0) + applyAmount;
      const newRemaining = currentRemaining - applyAmount;

      await client.query(
        `
       UPDATE invoice_entries
       SET
       odenen_tutar = $1,
       kalan_borc = $2
       WHERE id = $3
      `,
        [newPaid, newRemaining, invoice.id],
      );

      appliedRows.push({
        invoice_id: invoice.id,
        invoice_no: invoice.fatura_no,
        applied_amount: applyAmount,
      });

      remainingAdvance -= applyAmount;
    }

    if (remainingAdvance > 0) {
      await client.query(
        `
        INSERT INTO supplier_advances (
          supplier_name,
          amount,
          project_code,
          region,
          created_by,
          payment_date,
          note
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        `,
        [
          supplier_name,
          remainingAdvance,
          project_code || null,
          region || null,
          created_by || null,
          payment_date || null,
          note || null,
        ],
      );
    }

    await client.query("COMMIT");

    res.json({
      ok: true,
      applied_rows: appliedRows,
      unapplied_advance: remainingAdvance,
      message:
        remainingAdvance > 0
          ? "Ödeme faturalara dağıtıldı, kalan tutar avans olarak kaydedildi."
          : "Ödeme faturalara başarıyla dağıtıldı.",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("APPLY ADVANCE ERROR:", err);
    res.status(500).json({
      ok: false,
      error: "Avans uygulanırken hata oluştu",
      detail: err.message,
    });
  } finally {
    client.release();
  }
});

app.post("/finance/salary/add", async (req, res) => {
  try {
    const {
      ad_soyad,
      unvan,
      net_maas,
      avans,
      kalan_net_odeme,
      bankaya_yatacak_net,
      elden_odenecek_net,
      banka_maliyeti,
      toplam_isveren_maliyeti,
      ay,
      note,
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO finance_salary (
        ad_soyad,
        unvan,
        net_maas,
        avans,
        kalan_net_odeme,
        bankaya_yatacak_net,
        elden_odenecek_net,
        banka_maliyeti,
        toplam_isveren_maliyeti,
        ay,
        note
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
      `,
      [
        ad_soyad,
        unvan || null,
        Number(net_maas || 0),
        Number(avans || 0),
        Number(kalan_net_odeme || 0),
        Number(bankaya_yatacak_net || 0),
        Number(elden_odenecek_net || 0),
        Number(banka_maliyeti || 0),
        Number(toplam_isveren_maliyeti || 0),
        ay,
        note || null,
      ],
    );

    res.json({
      ok: true,
      row: result.rows[0],
    });
  } catch (err) {
    console.error("SALARY ADD ERROR:", err.message);
    res.status(500).json({
      ok: false,
      error: err.message || "Salary kaydedilemedi",
    });
  }
});

app.put("/finance/salary/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      ad_soyad,
      unvan,
      net_maas,
      avans,
      kalan_net_odeme,
      bankaya_yatacak_net,
      elden_odenecek_net,
      banka_maliyeti,
      toplam_isveren_maliyeti,
      ay,
      note,
    } = req.body;

    const result = await pool.query(
      `
      UPDATE finance_salary
      SET
        ad_soyad = $1,
        unvan = $2,
        net_maas = $3,
        avans = $4,
        kalan_net_odeme = $5,
        bankaya_yatacak_net = $6,
        elden_odenecek_net = $7,
        banka_maliyeti = $8,
        toplam_isveren_maliyeti = $9,
        ay = $10,
        note = $11
      WHERE id = $12
      RETURNING *
      `,
      [
        ad_soyad,
        unvan || null,
        Number(net_maas || 0),
        Number(avans || 0),
        Number(kalan_net_odeme || 0),
        Number(bankaya_yatacak_net || 0),
        Number(elden_odenecek_net || 0),
        Number(banka_maliyeti || 0),
        Number(toplam_isveren_maliyeti || 0),
        ay,
        note || null,
        id,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Kayıt bulunamadı",
      });
    }

    res.json({
      ok: true,
      row: result.rows[0],
    });
  } catch (err) {
    console.error("SALARY UPDATE ERROR:", err.message);
    res.status(500).json({
      ok: false,
      error: err.message || "Salary güncellenemedi",
    });
  }
});

app.delete("/finance/salary/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM finance_salary WHERE id = $1 RETURNING id`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Kayıt bulunamadı",
      });
    }

    res.json({
      ok: true,
      message: "Kayıt silindi",
    });
  } catch (err) {
    console.error("SALARY DELETE ERROR:", err.message);
    res.status(500).json({
      ok: false,
      error: err.message || "Salary silinemedi",
    });
  }
});

// silinecek excel yükleme//

app.get("/debug/subcon-check", async (req, res) => {
  try {
    const totalWorks = await pool.query(`
      SELECT COUNT(*)::int AS total
      FROM master_works
    `);

    const filledSubcons = await pool.query(`
      SELECT COUNT(*)::int AS total
      FROM master_works
      WHERE COALESCE(TRIM(subcon_name), '') <> ''
    `);

    const sampleSubcons = await pool.query(`
      SELECT
        site_code,
        item_code,
        subcon_name,
        done_qty
      FROM master_works
      ORDER BY id DESC
      LIMIT 20
    `);

    res.json({
      ok: true,
      total_works: totalWorks.rows[0]?.total || 0,
      filled_subcon_count: filledSubcons.rows[0]?.total || 0,
      sample_rows: sampleSubcons.rows || [],
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== MANUAL INVOICE EXCEL IMPORT ================== */
app.post(
  "/finance/invoice-entry/import-excel",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: "Dosya yok" });
      }

      const workbook = XLSX.read(req.file.buffer, { cellDates: true });
      const firstSheetName = workbook.SheetNames[0];

      if (!firstSheetName) {
        return res.status(400).json({
          ok: false,
          error: "Excel içinde sheet bulunamadı",
        });
      }

      const sheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: null,
      });

      if (!rawRows.length || rawRows.length < 2) {
        return res.status(400).json({
          ok: false,
          error: "Excel içinde veri bulunamadı",
        });
      }

      // 2. satırı header kabul et
      const headers = rawRows[1];
      const dataRows = rawRows.slice(2);

      const rows = dataRows.map((row) => {
        const obj = {};
        headers.forEach((header, index) => {
          obj[header] = row[index];
        });
        return obj;
      });

      if (!rows.length) {
        return res.status(400).json({
          ok: false,
          error: "Excel içinde veri bulunamadı",
        });
      }

      let inserted = 0;

      for (const r of rows) {
        const bolge = getCell(r, ["Bölge", "Bolge"]);
        const proje = getCell(r, ["Proje"]);
        const projeKodu = getCell(r, ["Proje Kodu", "Project Code"]);
        const faturaNo = getCell(r, ["Fatura No"]);
        const faturaTarihi = getCell(r, ["Fatura Tarihi"]);
        const tedarikci = getCell(r, ["Tedarikçi", "Tedarikci"]);
        const rf_montaj_firma = getCell(r, [
          "RF Montaj Firma",
          "rf_montaj_firma",
        ]);

        const faturaKalemi = getCell(r, ["Fatura Kalemi"]);
        const isKalemi = getCell(r, ["İş Kalemi", "Is Kalemi"]);
        const poNo = getCell(r, ["PO No"]);
        const siteId = getCell(r, ["Site ID"]);
        const tutar = getCell(r, ["Tutar (₺)", "Tutar"]);
        const kdv = getCell(r, ["KDV (₺)", "KDV"]);
        const toplamTutar = getCell(r, ["Toplam Tutar (₺)", "Toplam Tutar"]);
        const odenenTutar = getCell(r, ["Ödenen Tutar (₺)", "Ödenen Tutar"]);
        const kalanBorc = getCell(r, ["Kalan Borç (₺)", "Kalan Borc"]);
        const note = getCell(r, ["Açıklama / Not", "Aciklama / Not", "Not"]);

        if (
          !faturaNo &&
          !tedarikci &&
          !toplamTutar &&
          !faturaKalemi &&
          !isKalemi
        ) {
          continue;
        }

        await pool.query(
          `
          INSERT INTO invoice_entries
          (
            bolge,
            proje,
            proje_kodu,
            fatura_no,
            fatura_tarihi,
            tedarikci,
            rf_montaj_firma,
            fatura_kalemi,
            is_kalemi,
            po_no,
            site_id,
            tutar,
            kdv,
            toplam_tutar,
            odenen_tutar,
            kalan_borc,
            note
          )
          VALUES
          (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
          )
          `,
          [
            bolge ? String(bolge).trim() : null,
            proje ? String(proje).trim() : null,
            projeKodu ? String(projeKodu).trim() : null,
            faturaNo ? String(faturaNo).trim() : null,
            parseExcelDateFlexible(faturaTarihi),
            tedarikci ? String(tedarikci).trim() : null,
            rf_montaj_firma ? String(rf_montaj_firma).trim() : null, // ✅
            faturaKalemi ? String(faturaKalemi).trim() : null,
            isKalemi ? String(isKalemi).trim() : null,
            poNo ? String(poNo).trim() : null,
            siteId ? String(siteId).trim() : null,
            parseFinanceNumber(tutar),
            parseFinanceNumber(kdv),
            parseFinanceNumber(toplamTutar),
            parseFinanceNumber(odenenTutar),
            parseFinanceNumber(kalanBorc),
            note ? String(note).trim() : null,
          ],
        );

        inserted++;
      }

      return res.json({
        ok: true,
        inserted,
        message: "Fatura Excel tek seferde içeri aktarıldı",
        sheet_name: firstSheetName,
      });
    } catch (err) {
      console.error("INVOICE ENTRY IMPORT EXCEL ERROR:", err);
      return res.status(500).json({
        ok: false,
        error: err.message || "Excel import sırasında hata oluştu",
      });
    }
  },
);

/* ================== MANUAL INVOICE ENTRY ================== */
// Mükerrer fatura kontrolü: aynı fatura no ikinci kez girilemez (panel fark etmez)
async function faturaNoMukerrerMi(fatura_no, haricId) {
  const no = String(fatura_no || "").trim();
  if (!no) return null;
  const r = await pool.query(
    `SELECT id, tedarikci, UPPER(COALESCE(firma,'')) AS firma FROM invoice_entries
     WHERE UPPER(TRIM(fatura_no)) = UPPER($1) ${haricId ? "AND id <> $2" : ""} LIMIT 1`,
    haricId ? [no, haricId] : [no]).catch(() => ({ rows: [] }));
  return r.rows[0] || null;
}

app.post("/finance/invoice-entry/add", async (req, res) => {
  try {
    const {
      bolge,
      proje,
      proje_kodu,
      fatura_no,
      fatura_tarihi,
      odeme_tarihi,
      tedarikci,
      rf_montaj_firma,
      fatura_kalemi,
      is_kalemi,
      po_no,
      site_id,
      tutar,
      kdv,
      toplam_tutar,
      odenen_tutar,
      kalan_borc,
      note,
      fatura_turu,
      bagli_fatura_id,
      currency,
      usd_kur,
      firma, // ŞİMŞEK (boş/SIMSEK) veya AHY — AHY seçilirse AHY taşeron panelinde görünür
      temp_belge_key, // PDF önceden yüklendiyse geçici dosya yolu
    } = req.body;
    const mukerrer = await faturaNoMukerrerMi(fatura_no);
    if (mukerrer) {
      return res.status(409).json({ ok: false,
        error: `Bu fatura numarası zaten kayıtlı (${mukerrer.tedarikci} · ${mukerrer.firma === "AHY" ? "AHY" : "Şimşek"} etiketi). Aynı faturayı ikinci kez girmeyin — iki panel de aynı kayıttan beslenir.` });
    }
    const firmaNorm = String(firma || "").toUpperCase() === "AHY" ? "AHY" : "SIMSEK";

    const result = await pool.query(
      `
      INSERT INTO invoice_entries
      (
        bolge,
        proje,
        proje_kodu,
        fatura_no,
        fatura_tarihi,
        odeme_tarihi,
        tedarikci,
        rf_montaj_firma,
        fatura_kalemi,
        is_kalemi,
        po_no,
        site_id,
        tutar,
        kdv,
        toplam_tutar,
        odenen_tutar,
        kalan_borc,
        note,
        fatura_turu,
        bagli_fatura_id,
        currency,
        usd_kur,
        firma
      )
      VALUES
      (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
      )
      RETURNING *
      `,
      [
        bolge || null,
        proje || null,
        proje_kodu || null,
        fatura_no || null,
        fatura_tarihi || null,
        odeme_tarihi || null,
        tedarikci || null,
        rf_montaj_firma || null,
        fatura_kalemi || null,
        is_kalemi || null,
        po_no || null,
        site_id || null,
        Number(tutar || 0),
        Number(kdv || 0),
        Number(toplam_tutar || 0),
        Number(odenen_tutar || 0),
        Number(kalan_borc || 0),
        note || null,
        fatura_turu || 'GELEN',
        bagli_fatura_id ? Number(bagli_fatura_id) : null,
        currency || 'TRY',
        Number(usd_kur || 1),
        firmaNorm,
      ],
    );

    const newRow = result.rows[0];

    // Geçici PDF varsa belge_path olarak bağla
    if (temp_belge_key && newRow.id) {
      const finalFilename = `fatura-${newRow.id}-${Date.now()}.pdf`;
      try {
        // Supabase storage: temp dosyayı kalıcı konuma kopyala
        const { data: srcData } = await supabase.storage.from(BUCKET).download(temp_belge_key);
        if (srcData) {
          const arrBuf = await srcData.arrayBuffer();
          const buf = Buffer.from(arrBuf);
          const { url } = await uploadToStorage("fatura-belgeler", finalFilename, buf, "application/pdf");
          await pool.query("UPDATE invoice_entries SET belge_path=$1 WHERE id=$2", [url, newRow.id]);
          newRow.belge_path = url;
          // Temp dosyayı sil
          supabase.storage.from(BUCKET).remove([temp_belge_key]).catch(() => {});
        }
      } catch (e) {
        console.error("[invoice-add] temp belge link error:", e.message);
      }
    }

    res.json({
      ok: true,
      row: newRow,
    });
  } catch (err) {
    console.error("MANUAL INVOICE ADD ERROR:", err);
    res.status(500).json({
      ok: false,
      error: err.message || "Fatura kaydedilemedi",
    });
  }
});

app.get("/finance/invoice-entry/list", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ie.*, bf.fatura_no AS bagli_fatura_no
      FROM invoice_entries ie
      LEFT JOIN invoice_entries bf ON bf.id = ie.bagli_fatura_id
      ORDER BY ie.created_at DESC
    `);

    res.json({ ok: true, rows: result.rows || [] });
  } catch (err) {
    console.error("INVOICE ENTRY LIST ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/finance/invoice-entry/export-excel", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        bolge,
        proje,
        proje_kodu,
        fatura_no,
        fatura_tarihi,
        tedarikci,
        fatura_kalemi,
        is_kalemi,
        po_no,
        site_id,
        COALESCE(tutar, 0) AS tutar,
        COALESCE(kdv, 0) AS kdv,
        COALESCE(toplam_tutar, 0) AS toplam_tutar,
        COALESCE(odenen_tutar, 0) AS odenen_tutar,
        COALESCE(kalan_borc, 0) AS kalan_borc,
        COALESCE(note, '') AS note,
        created_at
      FROM invoice_entries
      ORDER BY fatura_tarihi DESC NULLS LAST, id DESC
    `);

    const query = String(req.query.query || "")
      .toLowerCase()
      .trim();
    const status = String(req.query.status || "ALL").toUpperCase();

    const filteredRows = (result.rows || []).filter((row) => {
      const kalan = Number(row.kalan_borc || 0);
      const toplam = Number(row.toplam_tutar || 0);
      const odenen = Number(row.odenen_tutar || 0);

      let durum = "BEKLIYOR";
      if (kalan <= 0 && toplam > 0) durum = "ODENDI";
      else if (odenen > 0 && kalan > 0) durum = "KISMI";

      const statusOk =
        status === "ALL"
          ? true
          : status === "BEKLIYOR"
            ? kalan > 0
            : status === "ODENDI"
              ? kalan <= 0
              : true;

      const text = `
        ${row.id || ""}
        ${row.bolge || ""}
        ${row.proje || ""}
        ${row.proje_kodu || ""}
        ${row.fatura_no || ""}
        ${row.tedarikci || ""}
        ${row.fatura_kalemi || ""}
        ${row.is_kalemi || ""}
        ${row.po_no || ""}
        ${row.site_id || ""}
        ${row.note || ""}
        ${durum}
      `
        .toLowerCase()
        .trim();

      const searchOk = query ? text.includes(query) : true;

      return statusOk && searchOk;
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("FATURA TAKIP RAPORU");

    worksheet.columns = [
      { header: "Kayıt No", key: "id", width: 10 },
      { header: "Talep Tarihi", key: "fatura_tarihi", width: 20 },
      { header: "Tedarikçi", key: "tedarikci", width: 28 },
      { header: "Proje", key: "proje", width: 14 },
      { header: "Proje Kodu", key: "proje_kodu", width: 16 },
      { header: "Fatura No", key: "fatura_no", width: 24 },
      { header: "Fatura Kalemi", key: "fatura_kalemi", width: 24 },
      { header: "İş Kalemi", key: "is_kalemi", width: 22 },
      { header: "PO No", key: "po_no", width: 18 },
      { header: "Site ID", key: "site_id", width: 18 },
      { header: "Tutar", key: "tutar", width: 14 },
      { header: "KDV", key: "kdv", width: 14 },
      { header: "Toplam Tutar", key: "toplam_tutar", width: 16 },
      { header: "Ödenen Tutar", key: "odenen_tutar", width: 16 },
      { header: "Kalan Borç", key: "kalan_borc", width: 16 },
      { header: "Durum", key: "durum", width: 14 },
      { header: "Bölge", key: "bolge", width: 16 },
      { header: "Not", key: "note", width: 28 },
      { header: "Kayıt Zamanı", key: "created_at", width: 22 },
    ];

    const lastColumnLetter = "S";

    worksheet.mergeCells(`A1:${lastColumnLetter}1`);
    const titleCell = worksheet.getCell("A1");
    titleCell.value = `FATURA TAKİP RAPORU (${new Date().toLocaleDateString("tr-TR")})`;
    titleCell.font = {
      bold: true,
      size: 16,
      color: { argb: "FFFFFFFF" },
    };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    titleCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "1F4E78" },
    };
    worksheet.getRow(1).height = 28;

    const headerRow = worksheet.getRow(2);
    worksheet.columns.forEach((col, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = col.header;
      cell.font = {
        bold: true,
        color: { argb: "FFFFFFFF" },
      };
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "2F5D8A" },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "D9D9D9" } },
        left: { style: "thin", color: { argb: "D9D9D9" } },
        bottom: { style: "thin", color: { argb: "D9D9D9" } },
        right: { style: "thin", color: { argb: "D9D9D9" } },
      };
    });
    headerRow.height = 24;

    filteredRows.forEach((row) => {
      const toplam = Number(row.toplam_tutar || 0);
      const odenen = Number(row.odenen_tutar || 0);
      const kalan = Number(row.kalan_borc || 0);

      let durum = "BEKLİYOR";
      if (kalan <= 0 && toplam > 0) durum = "ÖDENDİ";
      else if (odenen > 0 && kalan > 0) durum = "KISMİ";

      worksheet.addRow({
        id: row.id,
        fatura_tarihi: row.fatura_tarihi,
        tedarikci: row.tedarikci || "",
        proje: row.proje || "",
        proje_kodu: row.proje_kodu || "",
        fatura_no: row.fatura_no || "",
        fatura_kalemi: row.fatura_kalemi || "",
        is_kalemi: row.is_kalemi || "",
        po_no: row.po_no || "",
        site_id: row.site_id || "",
        tutar: Number(row.tutar || 0),
        kdv: Number(row.kdv || 0),
        toplam_tutar: toplam,
        odenen_tutar: odenen,
        kalan_borc: kalan,
        durum,
        bolge: row.bolge || "",
        note: row.note || "",
        created_at: row.created_at,
      });
    });

    worksheet.autoFilter = {
      from: "A2",
      to: `${lastColumnLetter}2`,
    };

    worksheet.views = [
      {
        state: "frozen",
        xSplit: 0,
        ySplit: 2,
        showGridLines: false,
      },
    ];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber < 3) return;

      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "E5E7EB" } },
          left: { style: "thin", color: { argb: "E5E7EB" } },
          bottom: { style: "thin", color: { argb: "E5E7EB" } },
          right: { style: "thin", color: { argb: "E5E7EB" } },
        };

        cell.alignment = {
          vertical: "middle",
          horizontal: "left",
          wrapText: true,
        };

        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb: rowNumber % 2 === 0 ? "F3F4F6" : "FFFFFF",
          },
        };
      });

      const statusCell = row.getCell(16);
      const statusValue = String(statusCell.value || "").toUpperCase();

      if (statusValue === "ÖDENDİ") {
        statusCell.font = { bold: true, color: { argb: "C55A11" } };
      } else if (statusValue === "KISMİ") {
        statusCell.font = { bold: true, color: { argb: "9E480E" } };
      } else {
        statusCell.font = { bold: true, color: { argb: "C00000" } };
      }
    });

    [11, 12, 13, 14, 15].forEach((colIndex) => {
      worksheet.getColumn(colIndex).numFmt = "#,##0";
    });

    worksheet.getColumn(2).numFmt = "dd.mm.yyyy";
    worksheet.getColumn(19).numFmt = "dd.mm.yyyy hh:mm:ss";

    for (let i = 3; i <= worksheet.rowCount; i++) {
      worksheet.getRow(i).height = 20;
    }

    const safeQuery = query
      ? query
          .replace(/[^\wğüşöçıİĞÜŞÖÇ-]/gi, "_")
          .replace(/_+/g, "_")
          .replace(/^_+|_+$/g, "")
      : "";

    const fileName = safeQuery
      ? `invoice_database_${safeQuery}_${new Date().toISOString().slice(0, 10)}.xlsx`
      : `invoice_database_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    // safeQuery Türkçe karakter içerebilir → ASCII fallback + RFC 5987
    const invAscii = fileName.replace(/[^\x20-\x7E]/g, "_");
    res.setHeader("Content-Disposition", `attachment; filename="${invAscii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    applyPremiumExcelStyle(worksheet, {
      headerRowNumber: 2,
      freezeRow: 2,
      filterFrom: "A2",
      filterTo: "P2",
      statusColumn: "B",
    });

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("INVOICE EXPORT EXCEL ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/finance/invoice-entry/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM invoice_entries WHERE id = $1 RETURNING id`,
      [req.params.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Kayıt bulunamadı" });
    }

    res.json({ ok: true, message: "Kayıt silindi" });
  } catch (err) {
    console.error("INVOICE ENTRY DELETE ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== Personel Cartı Ekleme Endpoint ================== */

app.post("/finance/personel/add", async (req, res) => {
  try {
    const {
      ad_soyad,
      unvan,
      bolge,
      net_maas,
      banka_net_maas,
      elden_net_maas,
      aylik_isveren_maliyeti,
      aktif,
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO personel_cards
      (
        ad_soyad,
        unvan,
        bolge,
        net_maas,
        banka_net_maas,
        elden_net_maas,
        aylik_isveren_maliyeti,
        aktif
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
      [
        ad_soyad,
        unvan || null,
        bolge || null,
        Number(net_maas || 0),
        Number(banka_net_maas || 0),
        Number(elden_net_maas || 0),
        Number(aylik_isveren_maliyeti || 0),
        aktif === false ? false : true,
      ],
    );

    res.json({ ok: true, row: result.rows[0] });
  } catch (err) {
    console.error("PERSONEL ADD ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/finance/personel/list", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM personel_cards
      ORDER BY ad_soyad ASC, id DESC
    `);

    res.json({ ok: true, rows: result.rows || [] });
  } catch (err) {
    console.error("PERSONEL LIST ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/finance/personel-movement/add", async (req, res) => {
  try {
    const {
      personel_id,
      donem_ay,
      donem_yil,
      hareket_turu,
      odeme_kanali,
      tutar,
      aciklama,
      note,
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO personel_salary_movements
      (
        personel_id,
        donem_ay,
        donem_yil,
        hareket_turu,
        odeme_kanali,
        tutar,
        aciklama,
        note
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
      [
        Number(personel_id),
        Number(donem_ay),
        Number(donem_yil),
        hareket_turu,
        odeme_kanali || null,
        Number(tutar || 0),
        aciklama || null,
        note || null,
      ],
    );

    res.json({ ok: true, row: result.rows[0] });
  } catch (err) {
    console.error("PERSONEL MOVEMENT ADD ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/finance/personel-aylik-ozet", async (req, res) => {
  try {
    const now = new Date();
    const donem_ay = Number(req.query.donem_ay || now.getMonth() + 1);
    const donem_yil = Number(req.query.donem_yil || now.getFullYear());

    const result = await pool.query(
      `
      SELECT
        p.id,
        p.ad_soyad,
        p.unvan,
        p.bolge,
        COALESCE(p.net_maas, 0) AS net_maas,
        COALESCE(p.banka_net_maas, 0) AS banka_net_maas,
        COALESCE(p.elden_net_maas, 0) AS elden_net_maas,
        COALESCE(p.aylik_isveren_maliyeti, 0) AS aylik_isveren_maliyeti,
        COALESCE(SUM(
          CASE WHEN m.hareket_turu = 'AVANS' THEN COALESCE(m.tutar, 0) ELSE 0 END
        ), 0) AS bu_ay_avans,
        COALESCE(SUM(
          CASE WHEN m.hareket_turu = 'MAAS_ODEME' AND m.odeme_kanali = 'BANKA'
          THEN COALESCE(m.tutar, 0) ELSE 0 END
        ), 0) AS bu_ay_banka_odeme,
        COALESCE(SUM(
          CASE WHEN m.hareket_turu = 'MAAS_ODEME' AND m.odeme_kanali = 'ELDEN'
          THEN COALESCE(m.tutar, 0) ELSE 0 END
        ), 0) AS bu_ay_elden_odeme,
        COALESCE(SUM(
          CASE WHEN m.hareket_turu IN ('AVANS', 'MAAS_ODEME', 'EK_ODEME')
          THEN COALESCE(m.tutar, 0) ELSE 0 END
        ), 0) AS bu_ay_toplam_odenen
      FROM personel_cards p
      LEFT JOIN personel_salary_movements m
        ON p.id = m.personel_id
       AND m.donem_ay = $1
       AND m.donem_yil = $2
      WHERE COALESCE(p.aktif, true) = true
      GROUP BY
        p.id, p.ad_soyad, p.unvan, p.bolge,
        p.net_maas, p.banka_net_maas, p.elden_net_maas, p.aylik_isveren_maliyeti
      ORDER BY p.ad_soyad ASC
      `,
      [donem_ay, donem_yil],
    );

    const rows = (result.rows || []).map((row) => {
      const netMaas = Number(row.net_maas || 0);
      const toplamOdenen = Number(row.bu_ay_toplam_odenen || 0);

      return {
        ...row,
        kalan_net_alacak: netMaas - toplamOdenen,
      };
    });

    res.json({ ok: true, rows });
  } catch (err) {
    console.error("PERSONEL AYLIK OZET ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== IMPORT COMPLETED WORKS ================== */

/* ================== HW PO UPLOAD ================== */
// MARKA KAR/ZARAR ÖZETİ: alt markanın (AHY) kendi finans görünümü.
// Gelir = SADECE markanın (taşeron canon eşleşmeli) yaptığı işlerin hakedişi
// × pay (%90), onair tarihine göre aylıklanır — Bölge Analizi ile aynı kaynak.
// Gider = marka personelinin maaş ödemeleri + maaş/iş avansları (aylık).
app.get("/finance/marka-ozet", authMiddleware, async (req, res) => {
  try {
    const rol = String(req.user?.role || "").toLowerCase();
    if (!["admin", "platform_admin", "direktor", "muhasebe", "genel_mudur"].includes(rol)) {
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    }
    const marka = String(req.query.marka || "AHY").toUpperCase();
    let yuzde = 10;
    try {
      const m = await pool.query("SELECT kirilim_yuzde FROM markalar WHERE kod=$1 LIMIT 1", [marka]);
      if (m.rows[0]) yuzde = Number(m.rows[0].kirilim_yuzde || 10);
    } catch {}
    // Devir kurgusu (16.07.2026): Gelir = markanın Şimşek Haberleşme'ye
    // KESTİĞİ faturalar (invoice_entries, firma canon eşleşme, fatura tarihi
    // bazlı) — hakediş tahmini değil. Gider = devirden (15 Temmuz 2026) sonraki
    // nakit akışı: maaş + avanslar (ödeme tarihi) + kira/manuel (giriş zamanı).
    // GELİR KDV DAHİL okunur (07.08.2026): giderler nakit çıkışı olarak KDV
    // dahil kaydediliyor, kâr/zarar elma-elma olsun diye gelir de KDV dahil.
    // P&L şeridindeki hakediş × 1,20 kuralıyla da aynı hizada.
    const DEVIR = "2026-07-15";
    const [fatura, maas, mavans, iavans, kiralar, ofisk, manuel, taseronOd, yemekOd] = await Promise.all([
      pool.query(`SELECT to_char(fatura_tarihi,'YYYY-MM') AS ay,
          TRIM(COALESCE(NULLIF(rf_montaj_firma,''), tedarikci, '')) AS firma,
          COALESCE(NULLIF(toplam_tutar,0), tutar, 0) AS t
        FROM invoice_entries
        WHERE fatura_tarihi IS NOT NULL`),
      // Temmuz 2026 dönem maaşı: devir öncesi girenlerde %50 AHY payı,
      // 15.07+ girenlerde tamamı; Temmuz öncesi dönemler yansımaz.
      pool.query(`SELECT to_char(m.tarih,'YYYY-MM') AS ay,
          SUM((COALESCE(m.bankadan,0)+COALESCE(m.elden,0)) *
            CASE WHEN COALESCE(m.donem,'') = '2026-07'
                      AND (p.ise_giris_tarihi IS NULL OR p.ise_giris_tarihi::date < DATE '2026-07-15')
                 THEN 0.5 ELSE 1 END) AS t
        FROM maas_odeme m JOIN personel p ON p.id=m.personel_id
        WHERE COALESCE(p.marka,'ERC')=$1 AND m.tarih >= $2
          AND COALESCE(m.donem, to_char(m.tarih,'YYYY-MM')) >= '2026-07' GROUP BY 1`, [marka, DEVIR]),
      pool.query(`SELECT to_char(a.tarih,'YYYY-MM') AS ay, SUM(a.tutar) AS t
        FROM avans a JOIN personel p ON p.id=a.personel_id
        WHERE COALESCE(p.marka,'ERC')=$1 AND a.tarih >= $2
          AND UPPER(COALESCE(a.avans_turu,'MAAS'))='MAAS' GROUP BY 1`, [marka, DEVIR]),
      pool.query(`SELECT to_char(COALESCE(t.odeme_tarihi, t.direktor_onay_tarihi),'YYYY-MM') AS ay, SUM(t.tutar) AS t
        FROM is_avans_talep t
        WHERE UPPER(COALESCE(t.firma,'ERC'))=$1
          AND t.durum IN ('DIREKTOR_ONAY','TAMAMLANDI')
          AND COALESCE(t.odeme_tarihi, t.direktor_onay_tarihi) >= $2 GROUP BY 1`, [marka, DEVIR]),
      pool.query(`SELECT to_char(o.tarih,'YYYY-MM') AS ay, SUM(o.tutar) AS t
        FROM arac_kira_odemeler o
        WHERE o.created_at >= $1::date GROUP BY 1`, [DEVIR]).catch(() => ({ rows: [] })),
      pool.query(`SELECT to_char(o.tarih,'YYYY-MM') AS ay, SUM(o.tutar) AS t
        FROM ofis_kira_odemeler o
        WHERE o.created_at >= $1::date GROUP BY 1`, [DEVIR]).catch(() => ({ rows: [] })),
      pool.query(`SELECT to_char(tarih,'YYYY-MM') AS ay, SUM(tutar) AS t
        FROM cashflow_odeme
        WHERE UPPER(COALESCE(marka,'ERC')) = $1 GROUP BY 1`, [marka]).catch(() => ({ rows: [] })),
      // Taşeron ödemeleri (avans + fatura ödemesi) — nakit akışıyla tutarlı
      pool.query(`SELECT to_char(tarih,'YYYY-MM') AS ay, SUM(tutar) AS t
        FROM marka_taseron_odeme
        WHERE UPPER(marka) = $1 GROUP BY 1`, [marka]).catch(() => ({ rows: [] })),
      // Yemek kartı ödemeleri (cashflow kategori TICKET) — kalem dökümü için ayrı
      pool.query(`SELECT SUM(tutar) AS t FROM cashflow_odeme
        WHERE UPPER(COALESCE(marka,'ERC')) = $1 AND UPPER(COALESCE(kategori,'')) = 'TICKET'`, [marka]).catch(() => ({ rows: [] })),
    ]);
    const map = {};
    const rowOf = (ay) => (map[ay] = map[ay] || { ay, gelir_try: 0, gelir_usd: 0, maas: 0, maas_avans: 0, is_avans: 0, diger: 0 });
    const cMarka = canonSub(marka);
    for (const r of fatura.rows) {
      if (canonSub(r.firma) !== cMarka) continue;
      const amt = Number(r.t || 0);
      if (!amt || !r.ay) continue;
      const o = rowOf(r.ay);
      o.gelir_try = +(o.gelir_try + amt).toFixed(2);
    }
    maas.rows.forEach(r => { if (!r.ay) return; rowOf(r.ay).maas = Number(r.t || 0); });
    mavans.rows.forEach(r => { if (!r.ay) return; rowOf(r.ay).maas_avans = Number(r.t || 0); });
    iavans.rows.forEach(r => { if (!r.ay) return; rowOf(r.ay).is_avans = Number(r.t || 0); });
    kiralar.rows.forEach(r => { if (!r.ay) return; rowOf(r.ay).diger += Number(r.t || 0); });
    ofisk.rows.forEach(r => { if (!r.ay) return; rowOf(r.ay).diger += Number(r.t || 0); });
    manuel.rows.forEach(r => { if (!r.ay) return; rowOf(r.ay).diger += Number(r.t || 0); });
    taseronOd.rows.forEach(r => { if (!r.ay) return; rowOf(r.ay).diger += Number(r.t || 0); });
    const aylar = Object.values(map).sort((a, b) => b.ay.localeCompare(a.ay)).map(o => {
      const gider = o.maas + o.maas_avans + o.is_avans + o.diger;
      return { ...o, gider, net: +(o.gelir_try - gider).toFixed(2) };
    });
    // ── Gider kalem dökümü (P&L şeridinin dikey gelir tablosu için) ──
    const _top = (q) => (q.rows || []).reduce((sm, r) => sm + Number(r.t || 0), 0);
    const yemekToplam = _top(yemekOd);
    const gider_kalemleri = {
      maas: +( _top(maas) + _top(mavans) ).toFixed(2),          // maaş + maaş avansları
      arac_kira: +_top(kiralar).toFixed(2),
      ofis_kira: +_top(ofisk).toFixed(2),
      yemek: +yemekToplam.toFixed(2),
      taseron: +_top(taseronOd).toFixed(2),
      genel: +( _top(iavans) + Math.max(0, _top(manuel) - yemekToplam) ).toFixed(2), // iş avansları + manuel (yemek hariç)
    };
    // ── Proje P&L şeridi (kartların üstü) ──
    // Fiziki tamamlanan iş bedeli: Bölge Analizi ile aynı fiyat zinciri —
    // tamamlanan_qty (yoksa done_qty) × PO/BOQ birim fiyatı, para birimi ayrımlı.
    // USD işlerin HW'ye FATURALANMIŞ kısmı fatura anındaki sabit kurla
    // kilitlenir (kur oynasa da değişmez): kalem eşleşmesi varsa o faturanın
    // reference_rate'i, yoksa head dosyalarındaki ortalama sabit kur.
    // Yalnız faturalanmamış kalan USD güncel TCMB kuruyla döner.
    let fiziki = { try: 0, usd: 0, billed_tl: 0, billed_usd: 0, sabit_kur: 0 };
    try {
      const fr = await pool.query(`
        ${COMMON_MATCH_CTES}
        , item_ref AS (
          SELECT
            UPPER(TRIM(COALESCE(i.site_id, ''))) AS site_id,
            TRIM(COALESCE(i.item_code, '')) AS item_code,
            MAX(hr.reference_rate) AS ref_rate
          FROM hw_invoice_items i
          LEFT JOIN hw_invoice_rows hr
            ON regexp_replace(regexp_replace(TRIM(hr.invoice_no),'-.*$',''),'^(SIM\\d{4})0+','\\1')
             = regexp_replace(regexp_replace(TRIM(i.invoice_no),'-.*$',''),'^(SIM\\d{4})0+','\\1')
          WHERE i.invoice_no IS NOT NULL
          GROUP BY 1, 2
        ), avg_ref AS (
          SELECT AVG(reference_rate) AS r FROM hw_invoice_rows WHERE reference_rate IS NOT NULL
        )
        SELECT
          COALESCE(SUM(CASE WHEN t.cur <> 'USD' THEN t.fq * t.price ELSE 0 END), 0) AS try,
          COALESCE(SUM(CASE WHEN t.cur = 'USD' THEN (t.fq - LEAST(t.fq, t.bq)) * t.price ELSE 0 END), 0) AS usd,
          COALESCE(SUM(CASE WHEN t.cur = 'USD' THEN LEAST(t.fq, t.bq) * t.price * COALESCE(t.item_rate, t.avg_rate, 0) ELSE 0 END), 0) AS billed_tl,
          COALESCE(SUM(CASE WHEN t.cur = 'USD' THEN LEAST(t.fq, t.bq) * t.price ELSE 0 END), 0) AS billed_usd,
          MAX(t.avg_rate) AS sabit_kur
        FROM (
          SELECT
            GREATEST(0, CASE WHEN m.tamamlanan_qty IS NOT NULL THEN m.tamamlanan_qty ELSE COALESCE(m.done_qty, 0) END) AS fq,
            COALESCE(site_po.billed_qty, 0) AS bq,
            (CASE
              WHEN TRIM(COALESCE(m.item_code, '')) = '8818278098' THEN 986.23
              WHEN site_po.id IS NOT NULL THEN COALESCE(site_po.unit_price, 0)
              ELSE COALESCE(item_po.unit_price, 0)
            END) AS price,
            (CASE
              WHEN COALESCE(TRIM(best_boq.currency), '') <> '' THEN UPPER(TRIM(best_boq.currency))
              WHEN site_po.id IS NOT NULL THEN UPPER(COALESCE(site_po.currency, 'TRY'))
              WHEN item_po.id IS NOT NULL THEN UPPER(COALESCE(item_po.currency, 'TRY'))
              ELSE 'TRY'
            END) AS cur,
            ir.ref_rate AS item_rate,
            avg_ref.r AS avg_rate
          FROM master_works m
          LEFT JOIN best_site_po site_po
            ON TRIM(COALESCE(site_po.project_code, '')) = TRIM(COALESCE(m.project_code, ''))
           AND UPPER(TRIM(COALESCE(site_po.site_code, ''))) = UPPER(TRIM(COALESCE(m.site_code, '')))
           AND TRIM(COALESCE(site_po.item_code, '')) = TRIM(COALESCE(m.item_code, ''))
          LEFT JOIN best_item_po item_po
            ON TRIM(COALESCE(item_po.item_code, '')) = TRIM(COALESCE(m.item_code, ''))
          LEFT JOIN best_boq
            ON TRIM(COALESCE(best_boq.s_bom_code, '')) = TRIM(COALESCE(m.item_code, ''))
          LEFT JOIN item_ref ir
            ON ir.site_id = UPPER(TRIM(COALESCE(m.site_code, '')))
           AND ir.item_code = TRIM(COALESCE(m.item_code, ''))
          CROSS JOIN avg_ref
          -- Yalnız bu markanın taşeron ekipleri (örn. AHY, AHY-2 …) — Hakediş Kırılımı kuralı
          WHERE UPPER(TRIM(COALESCE(m.subcon_name, ''))) LIKE $1
        ) t
      `, [marka + "%"]);
      const r0 = fr.rows[0] || {};
      fiziki = {
        try: Number(r0.try || 0), usd: Number(r0.usd || 0),
        billed_tl: Number(r0.billed_tl || 0), billed_usd: Number(r0.billed_usd || 0),
        sabit_kur: Number(r0.sabit_kur || 0),
      };
    } catch (e) { console.error("MARKA OZET fiziki:", e.message); }
    let kur = 0;
    try { kur = Number(await getTcmbUsdTrySellingRate()) || 0; } catch {}

    // Planlı gider (bekleyen maaş): devirden (2026-07) bu yana tahakkuk etmiş
    // dönemlerin kalan net maaşları — İK panelindeki "NET Ödenecek" ile BİREBİR:
    // puantaj gelmedi kesintisi (net/26 × gün) + işe giriş pro-rata + maaş
    // versiyonu (personel_maas_gecmisi) + AHY devir oranı; fazla ödemeler
    // sonraki döneme devreder.
    let bekleyenMaas = 0;
    try {
      const buAyStr = new Date().toISOString().slice(0, 7);
      const donemler = [];
      // AHY: Haziran'dan başla — devirden (15.07) SONRA ödenmiş eski dönem
      // avansları fazla ödeme olarak Temmuz'a devretsin (İK getDevirFazla kuralı)
      let dd = marka === "AHY" ? new Date(Date.UTC(2026, 5, 1)) : new Date(Date.UTC(2026, 6, 1));
      while (dd.toISOString().slice(0, 7) < buAyStr) {
        donemler.push(dd.toISOString().slice(0, 7));
        dd = new Date(Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth() + 1, 1));
      }
      const carry = {}; // personel bazlı devir (fazla ödeme)
      for (const donem of donemler) {
        const [dy, dm] = donem.split("-").map(Number);
        const gunSay = new Date(Date.UTC(dy, dm, 0)).getUTCDate();
        const pr = await pool.query(`
          SELECT p.id, COALESCE(g.net_maas, p.net_maas, 0) AS net_maas, p.ise_giris_tarihi
          FROM personel p
          LEFT JOIN LATERAL (
            SELECT net_maas FROM personel_maas_gecmisi
            WHERE personel_id = p.id AND donem <= $2
            ORDER BY donem DESC LIMIT 1
          ) g ON true
          WHERE p.aktif = true AND UPPER(COALESCE(p.marka,'ERC')) = $1`, [marka, donem]);
        const gm = await pool.query(`
          SELECT personel_id, COUNT(*) FILTER (WHERE durum = 'GELMEDI') AS gelmedi
          FROM puantaj WHERE to_char(tarih,'YYYY-MM') = $1 GROUP BY personel_id`, [donem]);
        const od = await pool.query(
          `SELECT personel_id, SUM(COALESCE(bankadan,0)+COALESCE(elden,0)) AS t
             FROM maas_odeme
            WHERE COALESCE(donem, to_char(tarih,'YYYY-MM')) = $1
              ${marka === "AHY" ? "AND tarih >= '2026-07-15'" : ""}
            GROUP BY personel_id`, [donem]);
        const av = await pool.query(
          `SELECT personel_id, SUM(COALESCE(tutar,0)) AS t
             FROM avans
            WHERE UPPER(COALESCE(avans_turu,'MAAS')) = 'MAAS'
              AND COALESCE(NULLIF(donem,''), to_char(tarih,'YYYY-MM')) = $1
              ${marka === "AHY" ? "AND tarih >= '2026-07-15'" : ""}
            GROUP BY personel_id`, [donem]);
        const gmM = new Map(gm.rows.map(r => [String(r.personel_id), Number(r.gelmedi || 0)]));
        const odM = new Map(od.rows.map(r => [String(r.personel_id), Number(r.t || 0)]));
        const avM = new Map(av.rows.map(r => [String(r.personel_id), Number(r.t || 0)]));
        const REFERANS_GUN = 26; // İK puantaj hakediş referansı
        for (const p of pr.rows) {
          const gStr = p.ise_giris_tarihi
            ? new Date(p.ise_giris_tarihi).toISOString().slice(0, 10) : null;
          if (gStr && gStr.slice(0, 7) > donem) continue; // henüz işe girmemiş
          let girisF = 1;
          if (gStr && gStr.slice(0, 7) === donem)
            girisF = (gunSay - Number(gStr.slice(8, 10)) + 1) / gunSay;
          const net = Number(p.net_maas || 0);
          const gelmedi = gmM.get(String(p.id)) || 0;
          const hakedilen = Math.max(0, Math.round(net * girisF - gelmedi * (net / REFERANS_GUN)));
          let oran = 1;
          if (marka === "AHY") {
            if (donem < "2026-07") oran = 0;
            else if (donem === "2026-07") oran = (gStr && gStr >= "2026-07-15") ? 1 : 0.5;
          }
          const hak = Math.round(hakedilen * oran);
          const oden = (odM.get(String(p.id)) || 0) + (avM.get(String(p.id)) || 0);
          const dev = carry[p.id] || 0;
          bekleyenMaas += Math.max(0, hak - oden - dev);
          carry[p.id] = Math.max(0, oden + dev - hak);
        }
      }
    } catch (e) { console.error("MARKA OZET bekleyen maas:", e.message); }

    // Planlı taşeron gideri: TAŞERON BAZINDA fatura − ödeme (negatifler 0).
    // Bir firmanın fazla avansı başka firmanın ödenmemiş faturasını mahsuplaşmaz.
    // Ad eşleştirme kanonik anahtarla (NETELCOM ≈ AHY_NETELKOM ≈ tam ünvan).
    // "Fatura Kesilecek" hakediş kuralı tanımlanınca bu kaleme o da eklenecek.
    let bekleyenTaseron = 0;
    try {
      const [bf, bo] = await Promise.all([
        pool.query(`SELECT COALESCE(tedarikci,'') AS ad,
            (CASE WHEN COALESCE(toplam_tutar,0) > 0 THEN toplam_tutar ELSE COALESCE(tutar,0) END) AS t
          FROM invoice_entries WHERE UPPER(COALESCE(firma,'')) = $1`, [marka]),
        pool.query(`SELECT COALESCE(taseron_adi,'') AS ad, COALESCE(tutar,0) AS t
          FROM marka_taseron_odeme WHERE UPPER(marka) = $1
          UNION ALL
          SELECT COALESCE(i.tedarikci,''), COALESCE(i.odenen_tutar,0)
          FROM invoice_entries i
          WHERE UPPER(COALESCE(i.firma,'')) = $1 AND COALESCE(i.odenen_tutar,0) > 0
          AND NOT EXISTS (
            SELECT 1 FROM marka_taseron_odeme mo
            WHERE UPPER(mo.marka) = $1
              AND ABS(COALESCE(mo.tutar,0) - COALESCE(i.odenen_tutar,0)) < 1
              AND UPPER(split_part(TRIM(COALESCE(mo.taseron_adi,'')),' ',1)) = UPPER(split_part(TRIM(COALESCE(i.tedarikci,'')),' ',1))
          )`, [marka]).catch(() => ({ rows: [] })),
      ]);
      const grp = {};
      bf.rows.forEach(r => { const k = taseronCanonKey(r.ad); grp[k] = grp[k] || { f: 0, o: 0 }; grp[k].f += Number(r.t || 0); });
      bo.rows.forEach(r => { const k = taseronCanonKey(r.ad); grp[k] = grp[k] || { f: 0, o: 0 }; grp[k].o += Number(r.t || 0); });
      // RF ekip hakedişleri (bedel + %20 KDV): fatura kesilmemiş olsa da
      // yapılan iş borçtur — maaşlar gibi tahakkuk eder. Fatura kesilmişse
      // büyük olan esas alınır (çifte sayım olmaz).
      const bedelByCanon = {};
      try {
        const det = await pool.query(`
          WITH best_boq AS (
            SELECT DISTINCT ON (s_bom_code) * FROM boq_items
            WHERE COALESCE(TRIM(s_bom_code), '') <> '' ORDER BY s_bom_code, created_at DESC
          )
          SELECT UPPER(TRIM(m.subcon_name)) AS subcon,
            UPPER(TRIM(COALESCE(m.site_code,''))) AS site,
            COALESCE(NULLIF(TRIM(m.item_description),''), best_boq.boq_items_en, COALESCE(m.item_code,'')) AS kalem,
            GREATEST(0, CASE WHEN m.tamamlanan_qty IS NOT NULL THEN m.tamamlanan_qty ELSE COALESCE(m.done_qty,0) END) AS fq
          FROM master_works m
          LEFT JOIN best_boq ON TRIM(COALESCE(best_boq.s_bom_code,'')) = TRIM(COALESCE(m.item_code,''))
          WHERE UPPER(TRIM(COALESCE(m.subcon_name,''))) LIKE $1 || '\\_%'`, [marka]);
        const bm = ahyTaseronBedel(det.rows);
        for (const [subcon, v] of Object.entries(bm)) {
          const k = taseronCanonKey(subcon);
          bedelByCanon[k] = (bedelByCanon[k] || 0) + Number(v.bedel || 0) * 1.20; // KDV dahil
        }
      } catch (be) { console.error("BEKLEYEN TASERON BEDEL:", be.message); }
      const canonKeys = new Set([...Object.keys(grp), ...Object.keys(bedelByCanon)]);
      bekleyenTaseron = [...canonKeys].reduce((sm, k) => {
        const g = grp[k] || { f: 0, o: 0 };
        const taban = Math.max(g.f, bedelByCanon[k] || 0);
        return sm + Math.max(0, taban - g.o);
      }, 0);
    } catch {}

    res.json({ ok: true, marka, pay_yuzde: 100 - yuzde, gelir_kaynak: "fatura", aylar,
      fiziki, kur, gider_kalemleri, bekleyen_maas: Math.round(bekleyenMaas),
      bekleyen_taseron: Math.round(bekleyenTaseron) });
  } catch (e) {
    console.error("MARKA OZET ERROR:", e.message);
    res.status(500).json({ ok: false, error: "Marka özeti alınamadı" });
  }
});

// MARKA GÜNLÜK NAKİT AKIŞI: alt markanın (AHY) devir tarihinden (15 Temmuz 2026)
// itibaren günlük harcamaları — maaş ödemeleri + maaş/iş avansları.
app.get("/finance/marka-nakit", authMiddleware, async (req, res) => {
  try {
    const rol = String(req.user?.role || "").toLowerCase();
    if (!["admin", "platform_admin", "direktor", "muhasebe", "genel_mudur"].includes(rol)) {
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    }
    const marka = String(req.query.marka || "AHY").toUpperCase();
    const baslangic = "2026-07-15";     // maaş/avans devri: 15 Temmuz 2026 (ödeme tarihi bazlı)
    // Kira/manuel ödemeler: devirden SONRA sisteme girilen kayıtlar görünür
    // (ödeme tarihi ayın 1'i olabilir — ERC'nin devir öncesi eski girişleri sızmaz)
    const girisBaslangic = "2026-07-15";
    // NOT: Masraf formları nakit çıkışı DEĞİLDİR — iş avansını kapatırlar
    // (para avans ödendiğinde çıkmıştı; çifte sayım olmasın diye listelenmez).
    const [maas, avanslar, kiralar, ofisKiralar, manuel, taseronOdeme] = await Promise.all([
      // Maaş devri kuralı: Temmuz 2026 dönem maaşı, devir öncesi (15.07) işe
      // girmiş personelde %50 AHY'ye yansır (ilk yarı Şimşek'in). 15.07 ve
      // sonrası girenlerde tamamı; Temmuz öncesi dönem maaşları hiç yansımaz.
      pool.query(`SELECT to_char(m.tarih,'YYYY-MM-DD') AS tarih, p.ad_soyad,
          'MAAS_ODEME' AS tip,
          ROUND((COALESCE(m.bankadan,0)+COALESCE(m.elden,0)) *
            CASE WHEN COALESCE(m.donem,'') = '2026-07'
                      AND (p.ise_giris_tarihi IS NULL OR p.ise_giris_tarihi::date < DATE '2026-07-15')
                 THEN 0.5 ELSE 1 END, 2) AS tutar,
          (COALESCE(m.donem,'') ||
            CASE WHEN COALESCE(m.donem,'') = '2026-07'
                      AND (p.ise_giris_tarihi IS NULL OR p.ise_giris_tarihi::date < DATE '2026-07-15')
                 THEN ' · %50 devir payı' ELSE '' END) AS aciklama
        FROM maas_odeme m JOIN personel p ON p.id = m.personel_id
        WHERE COALESCE(p.marka,'ERC') = $1 AND m.tarih >= $2
          AND COALESCE(m.donem, to_char(m.tarih,'YYYY-MM')) >= '2026-07'`, [marka, baslangic]),
      // Maaş avansları: personel markası bazlı. İş avansları: ONAYDA SEÇİLEN
      // firmaya göre (is_avans_talep.firma) — ödeme/direktör onay tarihiyle.
      pool.query(`SELECT to_char(a.tarih,'YYYY-MM-DD') AS tarih, p.ad_soyad,
          'MAAS_AVANSI' AS tip, a.tutar, COALESCE(a.aciklama,'') AS aciklama
        FROM avans a JOIN personel p ON p.id = a.personel_id
        WHERE COALESCE(p.marka,'ERC') = $1 AND a.tarih >= $2
          AND UPPER(COALESCE(a.avans_turu,'MAAS')) = 'MAAS'
        UNION ALL
        SELECT to_char(COALESCE(t.odeme_tarihi, t.direktor_onay_tarihi),'YYYY-MM-DD') AS tarih,
          COALESCE(NULLIF(hp.ad_soyad,''), t.talep_eden_ad) AS ad_soyad,
          'IS_AVANSI' AS tip, t.tutar,
          -- Amaç odaklı açıklama: gider türü + açıklama (⚡AHY işareti temizlenir)
          -- + not; avans başka personel adınaysa talep eden parantezle eklenir
          CONCAT_WS(' · ',
            NULLIF(t.gider_turu,''),
            NULLIF(BTRIM(REGEXP_REPLACE(COALESCE(t.aciklama,''), '⚡\\s*AHY', '', 'g')),''),
            NULLIF(t.not_aciklama,''),
            CASE WHEN NULLIF(hp.ad_soyad,'') IS NOT NULL AND hp.ad_soyad <> t.talep_eden_ad
                 THEN 'talep: ' || t.talep_eden_ad END
          ) AS aciklama
        FROM is_avans_talep t
        LEFT JOIN personel hp ON hp.id = t.personel_id
        WHERE UPPER(COALESCE(t.firma,'ERC')) = $1
          AND t.durum IN ('DIREKTOR_ONAY','TAMAMLANDI')
          AND COALESCE(t.odeme_tarihi, t.direktor_onay_tarihi) >= $2`, [marka, baslangic]),
      pool.query(`SELECT to_char(o.tarih,'YYYY-MM-DD') AS tarih, a.plaka AS ad_soyad,
          'ARAC_KIRA' AS tip, o.tutar,
          (o.donem || COALESCE(' · '||o.aciklama,'')) AS aciklama,
          COALESCE(o.kasadan_dus, true) AS kasadan_dus
        FROM arac_kira_odemeler o JOIN araclar a ON a.id = o.arac_id
        WHERE o.created_at >= $1::date`, [girisBaslangic]),
      // Ofis/Depo kiraları: devirden sonra girilen ödemeler (araç kira kuralıyla aynı).
      // kasadan_dus=false → AHY kendi ödedi: nakit akışında görünür ama kasa bakiyesinden düşmez
      pool.query(`SELECT to_char(o.tarih,'YYYY-MM-DD') AS tarih, d.ad AS ad_soyad,
          'OFIS_KIRA' AS tip, o.tutar,
          (o.donem || COALESCE(' · '||o.aciklama,'')) AS aciklama,
          COALESCE(o.kasadan_dus, true) AS kasadan_dus
        FROM ofis_kira_odemeler o JOIN ofis_depo d ON d.id = o.ofis_id
        WHERE o.created_at >= $1::date`, [girisBaslangic]).catch(() => ({ rows: [] })),
      // Manuel ödemeler: yalnız bu MARKAYA girilenler (firma seçimi 16.07.2026,
      // eski/etiketsiz kayıtlar ERC sayılır — AHY görmez)
      pool.query(`SELECT to_char(tarih,'YYYY-MM-DD') AS tarih,
          COALESCE(NULLIF(aciklama,''),
            CASE kategori WHEN 'ARAC' THEN 'Araç kirası' WHEN 'TICKET' THEN 'Ticket/Yemek' ELSE 'Diğer ödeme' END) AS ad_soyad,
          CASE kategori WHEN 'ARAC' THEN 'ARAC_KIRA' WHEN 'TICKET' THEN 'TICKET' ELSE 'DIGER' END AS tip,
          tutar, COALESCE(donem,'') AS aciklama
        FROM cashflow_odeme
        WHERE UPPER(COALESCE(marka,'ERC')) = $1`, [marka]).catch(() => ({ rows: [] })),
      // Taşeron ödemeleri: AVANSLAR kasadaki nakitten çıkar (kasadan düşer);
      // FATURA ödemelerini AHY kendisi yapar — nakit akışında/giderde görünür,
      // kasa bakiyesinden DÜŞMEZ (araç/ofis kirasındaki kasadan_dus kurgusu)
      pool.query(`SELECT to_char(tarih,'YYYY-MM-DD') AS tarih, taseron_adi AS ad_soyad,
          'TASERON' AS tip, tutar,
          ((CASE UPPER(COALESCE(tip,'AVANS')) WHEN 'AVANS' THEN 'Avans' ELSE 'Fatura ödemesi (AHY ödedi)' END)
            || COALESCE(' · '||NULLIF(aciklama,''),'')) AS aciklama,
          (UPPER(COALESCE(tip,'AVANS')) = 'AVANS') AS kasadan_dus
        FROM marka_taseron_odeme
        WHERE UPPER(marka) = $1
        UNION ALL
        SELECT to_char(COALESCE(i.odeme_tarihi, i.fatura_tarihi),'YYYY-MM-DD') AS tarih,
          COALESCE(i.tedarikci,'') AS ad_soyad, 'TASERON' AS tip, COALESCE(i.odenen_tutar,0) AS tutar,
          ('Fatura ödemesi (AHY ödedi) · fatura girişinden: ' || COALESCE(i.fatura_no,'')) AS aciklama,
          false AS kasadan_dus
        FROM invoice_entries i
        WHERE UPPER(COALESCE(i.firma,'')) = $1 AND COALESCE(i.odenen_tutar,0) > 0
          -- Aynı ödeme AHY panelinden de girildiyse çift sayma (taşeron ilk kelime + tutar eşleşmesi)
          AND NOT EXISTS (
            SELECT 1 FROM marka_taseron_odeme mo
            WHERE UPPER(mo.marka) = $1
              AND ABS(COALESCE(mo.tutar,0) - COALESCE(i.odenen_tutar,0)) < 1
              AND UPPER(split_part(TRIM(COALESCE(mo.taseron_adi,'')),' ',1)) = UPPER(split_part(TRIM(COALESCE(i.tedarikci,'')),' ',1))
          )`, [marka]).catch(() => ({ rows: [] })),
    ]);
    const rows = [...maas.rows, ...avanslar.rows, ...kiralar.rows, ...ofisKiralar.rows, ...manuel.rows, ...taseronOdeme.rows]
      .map(r => ({ ...r, tutar: Number(r.tutar || 0) }))
      .sort((a, b) => b.tarih.localeCompare(a.tarih));
    res.json({ ok: true, baslangic, rows });
  } catch (e) {
    console.error("MARKA NAKIT ERROR:", e.message);
    res.status(500).json({ ok: false, error: "Nakit akışı alınamadı" });
  }
});

// MARKA KASA: kasaya manuel girilen nakit (elden/bankadan konan para).
// Kasa bakiyesi = girişler − nakit akışı harcamaları (frontend hesaplar).
async function ensureMarkaKasaTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marka_kasa (
      id SERIAL PRIMARY KEY,
      marka TEXT NOT NULL,
      tarih DATE NOT NULL,
      tutar NUMERIC NOT NULL,
      aciklama TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
}
const MARKA_KASA_ROLLER = ["admin", "platform_admin", "direktor", "muhasebe", "genel_mudur"];
app.get("/finance/marka-kasa", authMiddleware, async (req, res) => {
  try {
    if (!MARKA_KASA_ROLLER.includes(String(req.user?.role || "").toLowerCase()))
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    await ensureMarkaKasaTable();
    const marka = String(req.query.marka || "AHY").toUpperCase();
    const r = await pool.query(
      `SELECT id, to_char(tarih,'YYYY-MM-DD') AS tarih, tutar, COALESCE(aciklama,'') AS aciklama
       FROM marka_kasa WHERE UPPER(marka)=$1 ORDER BY tarih DESC, id DESC`, [marka]);
    const toplam = r.rows.reduce((s, x) => s + Number(x.tutar || 0), 0);
    res.json({ ok: true, rows: r.rows, toplam });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.post("/finance/marka-kasa", authMiddleware, async (req, res) => {
  try {
    if (!MARKA_KASA_ROLLER.includes(String(req.user?.role || "").toLowerCase()))
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    await ensureMarkaKasaTable();
    const marka = String(req.body.marka || "AHY").toUpperCase();
    const { tarih, tutar, aciklama } = req.body;
    const t = Number(tutar || 0);
    if (!tarih || !t) return res.status(400).json({ ok: false, error: "tarih ve tutar zorunlu" });
    const r = await pool.query(
      `INSERT INTO marka_kasa (marka, tarih, tutar, aciklama) VALUES ($1,$2,$3,$4) RETURNING *`,
      [marka, tarih, t, aciklama || null]);
    res.json({ ok: true, row: r.rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.delete("/finance/marka-kasa/:id", authMiddleware, async (req, res) => {
  try {
    if (!MARKA_KASA_ROLLER.includes(String(req.user?.role || "").toLowerCase()))
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    await pool.query(`DELETE FROM marka_kasa WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});


// MARKA BORÇ DEFTERİ: AHY'den Şimşek'in KENDİ harcamaları için aldığı borçlar
// ve geri ödemeleri. Kasa akışından ayrıdır — yalnız kayıt/mutabakat amaçlı.
async function ensureMarkaBorcTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marka_borc (
      id SERIAL PRIMARY KEY,
      marka TEXT NOT NULL,
      tip TEXT NOT NULL DEFAULT 'BORC', -- BORC: AHY'den alınan · ODEME: geri ödeme
      tarih DATE NOT NULL,
      tutar NUMERIC NOT NULL,
      aciklama TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
}
app.get("/finance/marka-borc", authMiddleware, async (req, res) => {
  try {
    if (!MARKA_KASA_ROLLER.includes(String(req.user?.role || "").toLowerCase()))
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    await ensureMarkaBorcTable();
    const marka = String(req.query.marka || "AHY").toUpperCase();
    const r = await pool.query(
      `SELECT id, tip, to_char(tarih,'YYYY-MM-DD') AS tarih, tutar, COALESCE(aciklama,'') AS aciklama
       FROM marka_borc WHERE UPPER(marka)=$1 ORDER BY tarih DESC, id DESC`, [marka]);
    const alinan = r.rows.filter(x => x.tip !== 'ODEME').reduce((s, x) => s + Number(x.tutar || 0), 0);
    const odenen = r.rows.filter(x => x.tip === 'ODEME').reduce((s, x) => s + Number(x.tutar || 0), 0);
    res.json({ ok: true, rows: r.rows, alinan, odenen, kalan: alinan - odenen });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.post("/finance/marka-borc", authMiddleware, async (req, res) => {
  try {
    if (!MARKA_KASA_ROLLER.includes(String(req.user?.role || "").toLowerCase()))
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    await ensureMarkaBorcTable();
    const marka = String(req.body.marka || "AHY").toUpperCase();
    const tip = String(req.body.tip || "BORC").toUpperCase() === "ODEME" ? "ODEME" : "BORC";
    const { tarih, tutar, aciklama } = req.body;
    const t = Number(tutar || 0);
    if (!tarih || !t) return res.status(400).json({ ok: false, error: "tarih ve tutar zorunlu" });
    const r = await pool.query(
      `INSERT INTO marka_borc (marka, tip, tarih, tutar, aciklama) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [marka, tip, tarih, t, aciklama || null]);
    res.json({ ok: true, row: r.rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.delete("/finance/marka-borc/:id", authMiddleware, async (req, res) => {
  try {
    if (!MARKA_KASA_ROLLER.includes(String(req.user?.role || "").toLowerCase()))
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    await pool.query(`DELETE FROM marka_borc WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// MARKA TAŞERON: AHY'nin taşeronlarının (AHY_OLCAY vb.) kestiği faturalar
// (invoice_entries.firma='AHY') + bu taşeronlara yapılan avans/fatura ödemeleri.
// Taşeron adı kanonik anahtarı: "NETELCOM", "NETELCOM TELEKOMÜNİKASYON SAN.
// VE TİC. LTD. ŞTİ." ve "AHY_NETELKOM" aynı taşerona işaret eder.
// Kural: AHY_ önekini at, TR harfleri sadeleştir, şirket tür kelimelerini at,
// ilk anlamlı kelimeyi al, K→C normalize et (NETELKOM/NETELCOM farkı).
function taseronCanonKey(ad) {
  let t = String(ad || "").toUpperCase()
    .replace(/İ/g, "I").replace(/Ş/g, "S").replace(/Ç/g, "C")
    .replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ö/g, "O");
  t = t.replace(/^AHY[_\s-]+/, "").replace(/[^A-Z0-9 ]/g, " ");
  t = t.replace(/\b(TELEKOMUNIKASYON|ILETISIM|HABERLESME|MAKINE|MAKINA|SANAYI|SAN|VE|TICARET|TIC|LIMITED|LTD|STI|SIRKETI|INSAAT|TURIZM|GIDA|ORGANIZASYON|RESTORAN|ELEKTRIK|ELEKTRONIK|MUHENDISLIK|HIZMETLERI|SISTEMLERI)\b/g, " ");
  t = t.trim().split(/\s+/)[0] || String(ad || "").toUpperCase().trim();
  return t.replace(/K/g, "C");
}

app.get("/finance/marka-taseron", authMiddleware, async (req, res) => {
  try {
    if (!MARKA_KASA_ROLLER.includes(String(req.user?.role || "").toLowerCase()))
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    const marka = String(req.query.marka || "AHY").toUpperCase();
    const [faturalar, odemeler] = await Promise.all([
      pool.query(`SELECT id, COALESCE(tedarikci,'') AS taseron_adi, fatura_no,
          to_char(fatura_tarihi,'YYYY-MM-DD') AS fatura_tarihi,
          COALESCE(tutar,0) AS tutar, COALESCE(kdv,0) AS kdv,
          COALESCE(toplam_tutar,0) AS toplam_tutar, COALESCE(note,'') AS note,
          COALESCE(is_kalemi,'') AS kategori
        FROM invoice_entries
        WHERE UPPER(COALESCE(firma,'')) = $1
        ORDER BY fatura_tarihi DESC NULLS LAST, id DESC`, [marka]),
      pool.query(`SELECT id, taseron_adi, UPPER(COALESCE(tip,'AVANS')) AS tip,
          COALESCE(tutar,0) AS tutar, to_char(tarih,'YYYY-MM-DD') AS tarih,
          COALESCE(aciklama,'') AS aciklama, fatura_id
        FROM marka_taseron_odeme
        WHERE UPPER(marka) = $1
        ORDER BY tarih DESC, id DESC`, [marka]).catch(() => ({ rows: [] })),
    ]);
    // Fatura girişinde "Ödenen Tutar" doldurulmuş faturalar da ödemedir —
    // finans panelinden girilen ödeme AHY panelinde borç bırakmasın
    let faturaOdemeleri = [];
    try {
      const fo = await pool.query(`SELECT (id * -1) AS id, COALESCE(tedarikci,'') AS taseron_adi,
          'FATURA_ODEME' AS tip, COALESCE(odenen_tutar,0) AS tutar,
          to_char(COALESCE(odeme_tarihi, fatura_tarihi),'YYYY-MM-DD') AS tarih,
          ('Fatura girişinde ödendi: ' || COALESCE(fatura_no,'')) AS aciklama,
          id AS fatura_id, 'FATURA' AS kaynak
        FROM invoice_entries i
        WHERE UPPER(COALESCE(i.firma,'')) = $1 AND COALESCE(i.odenen_tutar,0) > 0
          -- Aynı ödeme Avans/Ödeme olarak da girildiyse çift sayma
          AND NOT EXISTS (
            SELECT 1 FROM marka_taseron_odeme mo
            WHERE UPPER(mo.marka) = $1
              AND ABS(COALESCE(mo.tutar,0) - COALESCE(i.odenen_tutar,0)) < 1
              AND UPPER(split_part(TRIM(COALESCE(mo.taseron_adi,'')),' ',1)) = UPPER(split_part(TRIM(COALESCE(i.tedarikci,'')),' ',1))
          )`, [marka]);
      faturaOdemeleri = fo.rows;
    } catch {}
    const tumOdemeler = [...odemeler.rows, ...faturaOdemeleri]
      .sort((a, b) => String(b.tarih || '').localeCompare(String(a.tarih || '')));
    res.json({ ok: true, faturalar: faturalar.rows, odemeler: tumOdemeler });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// ── AHY taşeron bedeli hesap kuralı (2026-08 anlaşması) ──
// Co-located saha (site ID'de NR700/TRP): kalem bazlı birim fiyat × adet.
// Standalone saha (site ID'de NS / NS_MERKEZ): paket fiyat — Antenna
// Installation veya outdoor cabinet kalemi varsa; mikrodalga (New Microwave
// Installation) da yapıldıysa "Radyolu" 52.000, yoksa "Radyosuz" 40.000.
// 7,2m LPRT pole her iki saha tipinde de adet × 8.000 eklenir.
// Fiyatlar TL + KDV (KDV hariç döner). Yeni kalem çıkarsa buraya eklenecek.
const AHY_BEDEL_COLOCATED = [
  [/co-located site with antenna/i, 26500, "Co-Located Site with Antenna"],
  [/co-located site without antenna/i, 22000, "Co-Located Site without Antenna"],
  [/rru dismantling/i, 400, "RRU dismantling"],
  [/dc cable dismantle/i, 1500, "DC Cable Dismantle"],
  [/7[.,]2\s*m\s*lprt/i, 8000, "Installation of 7,2m LPRT pole"],
  [/6\s*m\s*lprt/i, 7000, "Installation service 6m LPRT Pole"],
  [/one band addition/i, 12000, "One Band Addition at the same site visit"],
];
function ahyTaseronBedel(rows) {
  // rows: [{subcon, site, kalem, fq}] → { [subcon]: { bedel, detay[] } }
  const bySiteKey = {};
  for (const r of rows) {
    const k = r.subcon + "|" + r.site;
    (bySiteKey[k] = bySiteKey[k] || { subcon: r.subcon, site: r.site, items: [] }).items.push(r);
  }
  const out = {};
  for (const g of Object.values(bySiteKey)) {
    const ek = (out[g.subcon] = out[g.subcon] || { bedel: 0, detay: [] });
    const qty = (rx) => g.items.filter(i => rx.test(i.kalem)).reduce((sm, i) => sm + Number(i.fq || 0), 0);
    const has = (rx) => g.items.some(i => rx.test(i.kalem) && Number(i.fq || 0) > 0);
    // QC: verilen regex'lere uyan, fiziki yapılmış (fq>0) ana kalemlerin TÜMÜ
    // QC OK ise "OK" — yardımcı kalemler (as-built, TK sertifika…) hesaba girmez
    const qcOf = (...rxs) => {
      const ana = g.items.filter(i => Number(i.fq || 0) > 0 && rxs.some(rx => rx.test(i.kalem)));
      if (!ana.length) return "";
      return ana.every(i => i.qc_ok === true) ? "OK" : "NOK";
    };
    const st = g.site;
    if (/NR700|TRP/.test(st)) {
      for (const [rx, fiyat, ad] of AHY_BEDEL_COLOCATED) {
        const q = qty(rx);
        if (q > 0) { ek.bedel += q * fiyat; ek.detay.push({ site: st, kalem: ad, adet: q, birim: fiyat, tutar: q * fiyat, qc: qcOf(rx) }); }
      }
    } else if (/(^|[_\-])NS([_\-]|$)|NS_MERKEZ/.test(st)) {
      const paketVar = has(/antenna installation\s*,\s*per pcs/i) || has(/outdoor cabinet family installation/i);
      if (paketVar) {
        const radyolu = has(/new microwave installation/i);
        const fiyat = radyolu ? 52000 : 40000;
        ek.bedel += fiyat;
        const anchors = [/antenna installation\s*,\s*per pcs/i, /outdoor cabinet family installation/i, /dbs\/bts system installation/i];
        if (radyolu) anchors.push(/new microwave installation/i);
        ek.detay.push({ site: st, kalem: radyolu ? "New Site Radyolu (paket)" : "New Site Radyosuz (paket)", adet: 1, birim: fiyat, tutar: fiyat, qc: qcOf(...anchors) });
      }
      const qL = qty(/7[.,]2\s*m\s*lprt/i);
      if (qL > 0) { ek.bedel += qL * 8000; ek.detay.push({ site: st, kalem: "Installation of 7,2m LPRT pole", adet: qL, birim: 8000, tutar: qL * 8000, qc: qcOf(/7[.,]2\s*m\s*lprt/i) }); }
      const qL6 = qty(/6\s*m\s*lprt/i);
      if (qL6 > 0) { ek.bedel += qL6 * 7000; ek.detay.push({ site: st, kalem: "Installation service 6m LPRT Pole", adet: qL6, birim: 7000, tutar: qL6 * 7000, qc: qcOf(/6\s*m\s*lprt/i) }); }
      // One Band Addition: LTE benzeri ekstra iş — paket fiyata dahil değildir
      const qOB = qty(/one band addition/i);
      if (qOB > 0) { ek.bedel += qOB * 12000; ek.detay.push({ site: st, kalem: "One Band Addition at the same site visit", adet: qOB, birim: 12000, tutar: qOB * 12000, qc: qcOf(/one band addition/i) }); }
    } else {
      // Diğer saha tipleri (L1800/L2100 One Band, co-located revizyon vb.):
      // anlaşma fiyat listesindeki kalemler adet bazlı uygulanır
      for (const [rx, fiyat, ad] of AHY_BEDEL_COLOCATED) {
        const q = qty(rx);
        if (q > 0) { ek.bedel += q * fiyat; ek.detay.push({ site: st, kalem: ad, adet: q, birim: fiyat, tutar: q * fiyat, qc: qcOf(rx) }); }
      }
    }
  }
  return out;
}

// "Fatura Kesilecek" kurgusu: markanın alt ekiplerinin (AHY_MURAT, AHY_NETELKOM…)
// yaptığı işlerin bedeli — ana marka ekibi (AHY) hariç, yalnız altçizgili ekipler.
// USD kalemlerde HW'ye faturalanan kısım sabit fatura kuruyla kilitli (P&L şeridi kuralı).
// Taşeron BEDELİ hesap kuralı ayrıca tanımlanacak; şimdilik yapılan iş bedeli döner.
app.get("/finance/marka-taseron-hakedis", authMiddleware, async (req, res) => {
  try {
    if (!MARKA_KASA_ROLLER.includes(String(req.user?.role || "").toLowerCase()))
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    const marka = String(req.query.marka || "AHY").toUpperCase();
    const r = await pool.query(`
      ${COMMON_MATCH_CTES}
      , item_ref AS (
        SELECT
          UPPER(TRIM(COALESCE(i.site_id, ''))) AS site_id,
          TRIM(COALESCE(i.item_code, '')) AS item_code,
          MAX(hr.reference_rate) AS ref_rate
        FROM hw_invoice_items i
        LEFT JOIN hw_invoice_rows hr
          ON regexp_replace(regexp_replace(TRIM(hr.invoice_no),'-.*$',''),'^(SIM\\d{4})0+','\\1')
           = regexp_replace(regexp_replace(TRIM(i.invoice_no),'-.*$',''),'^(SIM\\d{4})0+','\\1')
        WHERE i.invoice_no IS NOT NULL
        GROUP BY 1, 2
      ), avg_ref AS (
        SELECT AVG(reference_rate) AS r FROM hw_invoice_rows WHERE reference_rate IS NOT NULL
      )
      SELECT
        t.subcon,
        COUNT(*) FILTER (WHERE t.fq > 0) AS is_sayisi,
        COALESCE(SUM(CASE WHEN t.cur <> 'USD' THEN t.fq * t.price ELSE 0 END), 0) AS try,
        COALESCE(SUM(CASE WHEN t.cur = 'USD' THEN (t.fq - LEAST(t.fq, t.bq)) * t.price ELSE 0 END), 0) AS usd,
        COALESCE(SUM(CASE WHEN t.cur = 'USD' THEN LEAST(t.fq, t.bq) * t.price * COALESCE(t.item_rate, t.avg_rate, 0) ELSE 0 END), 0) AS billed_tl
      FROM (
        SELECT
          UPPER(TRIM(COALESCE(m.subcon_name, ''))) AS subcon,
          GREATEST(0, CASE WHEN m.tamamlanan_qty IS NOT NULL THEN m.tamamlanan_qty ELSE COALESCE(m.done_qty, 0) END) AS fq,
          COALESCE(site_po.billed_qty, 0) AS bq,
          (CASE
            WHEN TRIM(COALESCE(m.item_code, '')) = '8818278098' THEN 986.23
            WHEN site_po.id IS NOT NULL THEN COALESCE(site_po.unit_price, 0)
            ELSE COALESCE(item_po.unit_price, 0)
          END) AS price,
          (CASE
            WHEN COALESCE(TRIM(best_boq.currency), '') <> '' THEN UPPER(TRIM(best_boq.currency))
            WHEN site_po.id IS NOT NULL THEN UPPER(COALESCE(site_po.currency, 'TRY'))
            WHEN item_po.id IS NOT NULL THEN UPPER(COALESCE(item_po.currency, 'TRY'))
            ELSE 'TRY'
          END) AS cur,
          ir.ref_rate AS item_rate,
          avg_ref.r AS avg_rate
        FROM master_works m
        LEFT JOIN best_site_po site_po
          ON TRIM(COALESCE(site_po.project_code, '')) = TRIM(COALESCE(m.project_code, ''))
         AND UPPER(TRIM(COALESCE(site_po.site_code, ''))) = UPPER(TRIM(COALESCE(m.site_code, '')))
         AND TRIM(COALESCE(site_po.item_code, '')) = TRIM(COALESCE(m.item_code, ''))
        LEFT JOIN best_item_po item_po
          ON TRIM(COALESCE(item_po.item_code, '')) = TRIM(COALESCE(m.item_code, ''))
        LEFT JOIN best_boq
          ON TRIM(COALESCE(best_boq.s_bom_code, '')) = TRIM(COALESCE(m.item_code, ''))
        LEFT JOIN item_ref ir
          ON ir.site_id = UPPER(TRIM(COALESCE(m.site_code, '')))
         AND ir.item_code = TRIM(COALESCE(m.item_code, ''))
        CROSS JOIN avg_ref
        WHERE UPPER(TRIM(COALESCE(m.subcon_name, ''))) LIKE $1 || '\\_%'
      ) t
      GROUP BY t.subcon
      ORDER BY t.subcon
    `, [marka]);
    // Taşeron bedeli: kalem açıklamaları üzerinden hesap kuralı
    let bedelMap = {};
    try {
      const det = await pool.query(`
        WITH best_boq AS (
          SELECT DISTINCT ON (s_bom_code) * FROM boq_items
          WHERE COALESCE(TRIM(s_bom_code), '') <> '' ORDER BY s_bom_code, created_at DESC
        )
        SELECT UPPER(TRIM(m.subcon_name)) AS subcon,
          UPPER(TRIM(COALESCE(m.site_code,''))) AS site,
          COALESCE(NULLIF(TRIM(m.item_description),''), best_boq.boq_items_en, COALESCE(m.item_code,'')) AS kalem,
          GREATEST(0, CASE WHEN m.tamamlanan_qty IS NOT NULL THEN m.tamamlanan_qty ELSE COALESCE(m.done_qty,0) END) AS fq,
          (UPPER(TRIM(COALESCE(m.qc_durum,'NOK'))) = 'OK') AS qc_ok
        FROM master_works m
        LEFT JOIN best_boq ON TRIM(COALESCE(best_boq.s_bom_code,'')) = TRIM(COALESCE(m.item_code,''))
        WHERE UPPER(TRIM(COALESCE(m.subcon_name,''))) LIKE $1 || '\\_%'`, [marka]);
      bedelMap = ahyTaseronBedel(det.rows);
    } catch (e) { console.error("TASERON BEDEL ERROR:", e.message); }
    let kur = 0;
    try { kur = Number(await getTcmbUsdTrySellingRate()) || 0; } catch {}
    res.json({ ok: true, marka, kur,
      ekipler: r.rows.map(e => ({ ...e,
        bedel: Math.round(bedelMap[e.subcon]?.bedel || 0),
        bedel_detay: bedelMap[e.subcon]?.detay || [] })) });
  } catch (e) {
    console.error("MARKA TASERON HAKEDIS ERROR:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Taşeronun kendi paket bedeli (FERRUMX gibi paket fiyatla çalışanlar) ──
// Taşeron kullanıcısı kendi işlerinin bedelini AHY'nin gördüğü fiyat kuralıyla
// görür (radyolu 52.000 / radyosuz 40.000 + LPRT/One Band ekstraları).
// FERRUMX kapsamı hem "FERRUMX" (Şimşek'e direkt) hem "AHY_FERRUMX" (AHY
// üzerinden) satırlarını içerir; kaynak her satırda ayrıca döner. (07.08.2026)
app.get("/finance/subcon-paket-bedel", authMiddleware, async (req, res) => {
  try {
    const scopeName = subconScope(req) || String(req.query.sub || "").trim();
    if (!scopeName) return res.status(403).json({ ok: false, error: "Taşeron kapsamı yok" });
    const det = await pool.query(`
      WITH best_boq AS (
        SELECT DISTINCT ON (s_bom_code) * FROM boq_items
        WHERE COALESCE(TRIM(s_bom_code), '') <> '' ORDER BY s_bom_code, created_at DESC
      )
      SELECT UPPER(TRIM(m.subcon_name)) AS subcon,
        UPPER(TRIM(COALESCE(m.site_code,''))) AS site,
        COALESCE(NULLIF(TRIM(m.item_description),''), best_boq.boq_items_en, COALESCE(m.item_code,'')) AS kalem,
        GREATEST(0, CASE WHEN m.tamamlanan_qty IS NOT NULL THEN m.tamamlanan_qty ELSE COALESCE(m.done_qty,0) END) AS fq,
        (UPPER(TRIM(COALESCE(m.qc_durum,'NOK'))) = 'OK') AS qc_ok
      FROM master_works m
      LEFT JOIN best_boq ON TRIM(COALESCE(best_boq.s_bom_code,'')) = TRIM(COALESCE(m.item_code,''))
      WHERE COALESCE(TRIM(m.subcon_name),'') <> ''`);
    const kendi = det.rows.filter(r => subconRowMatches(scopeName, r.subcon));
    // Bedel motoru saha bazlı çalışır; kaynağı (FERRUMX / AHY_FERRUMX) korumak
    // için subcon alanını olduğu gibi geçiyoruz — her kayıt ayrı grup olur
    const bm = ahyTaseronBedel(kendi.map(r => ({ subcon: r.subcon, site: r.site, kalem: r.kalem, fq: r.fq, qc_ok: r.qc_ok })));
    // Yalnız QC OK kalemler faturalanabilir — firma QC kapanmadan fatura kesmez
    const detay = [];
    let toplam = 0;
    for (const [kaynak, v] of Object.entries(bm)) {
      (v.detay || [])
        .filter(d => String(d.qc || "").toUpperCase() === "OK")
        .forEach(d => { detay.push({ ...d, kaynak }); toplam += Number(d.tutar || 0); });
    }
    detay.sort((a, b) => String(a.kaynak).localeCompare(String(b.kaynak)) || String(a.site).localeCompare(String(b.site)));
    const kaynakOzet = {};
    detay.forEach(d => { kaynakOzet[d.kaynak] = (kaynakOzet[d.kaynak] || 0) + Number(d.tutar || 0); });
    // Taşeronun Şimşek'e kestiği faturalar (bolge_fatura) — kendi fatura geçmişi
    let faturalar = [];
    try {
      const fr = await pool.query(`SELECT fatura_no, to_char(fatura_tarihi,'YYYY-MM-DD') AS tarih,
          SUM(COALESCE(fatura_miktari,0)) AS tutar, COUNT(*) AS kalem
        FROM bolge_fatura
        WHERE COALESCE(TRIM(fatura_no),'') <> ''
        GROUP BY fatura_no, fatura_tarihi
        ORDER BY fatura_tarihi DESC NULLS LAST`);
      const c = canonSub(scopeName);
      const bf = await pool.query(`SELECT DISTINCT TRIM(taseron_adi) AS ad, TRIM(fatura_no) AS no FROM bolge_fatura WHERE COALESCE(TRIM(fatura_no),'') <> ''`);
      const kendiNo = new Set(bf.rows.filter(r => subconRowMatches(scopeName, r.ad)).map(r => r.no));
      faturalar = fr.rows.filter(r => kendiNo.has(String(r.fatura_no || "").trim()))
        .map(r => ({ fatura_no: r.fatura_no, tarih: r.tarih, kalem: Number(r.kalem || 0),
          tutar_kdv_dahil: Number(r.tutar || 0), tutar_kdv_haric: Number(r.tutar || 0) / 1.2 }));
    } catch (fe) { console.error("SUBCON PAKET FATURA:", fe.message); }
    res.json({ ok: true, taseron: scopeName, bedel: Math.round(toplam), detay, kaynak_ozet: kaynakOzet, faturalar });
  } catch (e) {
    console.error("SUBCON PAKET BEDEL ERROR:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── ERC (Şimşek) Taşeron Hesabı: yalnız STATE / 2KX / FERRUMX ──
// Bedel kuralları (06.08.2026, Orhan): STATE → Huawei hakedişinin %80'i,
// 2KX → %75'i (Şimşek kırılım anlaşmaları); FERRUMX → AHY paket kural
// motorunun birebir aynısı (ahyTaseronBedel). Fatura: invoice_entries'in
// Şimşek tarafı (AHY etiketli hariç). Ödeme: taseron_odeme_log (AHY marka
// panelinden yazılan satırlar hariç) + fatura girişindeki Ödenen Tutar.
const ercTaseronCanon = (ad) => {
  const u = String(ad || "").toUpperCase();
  if (u.includes("2KX")) return "2kx";
  if (u.includes("FERRUM")) return "ferrumx";
  if (u.includes("STATE")) return "state";
  return null;
};
app.get("/finance/erc-taseron-hakedis", authMiddleware, async (req, res) => {
  try {
    if (!MARKA_KASA_ROLLER.includes(String(req.user?.role || "").toLowerCase()))
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    let kur = 0;
    try { kur = Number(await getTcmbUsdTrySellingRate()) || 0; } catch {}
    const det = await pool.query(`
      WITH best_boq AS (
        SELECT DISTINCT ON (s_bom_code) * FROM boq_items
        WHERE COALESCE(TRIM(s_bom_code), '') <> '' ORDER BY s_bom_code, created_at DESC
      ), po AS (
        SELECT DISTINCT ON (UPPER(TRIM(site_code)), TRIM(item_code))
          UPPER(TRIM(site_code)) AS site, TRIM(item_code) AS item, unit_price, currency
        FROM po_rows ORDER BY UPPER(TRIM(site_code)), TRIM(item_code), id DESC
      )
      SELECT UPPER(TRIM(m.subcon_name)) AS subcon,
        UPPER(TRIM(COALESCE(m.site_code,''))) AS site,
        TRIM(COALESCE(m.item_code,'')) AS item,
        COALESCE(NULLIF(TRIM(m.item_description),''), best_boq.boq_items_en, COALESCE(m.item_code,'')) AS kalem,
        GREATEST(0, CASE WHEN m.tamamlanan_qty IS NOT NULL THEN m.tamamlanan_qty ELSE COALESCE(m.done_qty,0) END) AS fq,
        (UPPER(TRIM(COALESCE(m.qc_durum,'NOK'))) = 'OK') AS qc_ok,
        COALESCE(po.unit_price, 0) AS price, COALESCE(po.currency,'TRY') AS cur
      FROM master_works m
      LEFT JOIN best_boq ON TRIM(COALESCE(best_boq.s_bom_code,'')) = TRIM(COALESCE(m.item_code,''))
      LEFT JOIN po ON po.site = UPPER(TRIM(COALESCE(m.site_code,''))) AND po.item = TRIM(COALESCE(m.item_code,''))
      WHERE UPPER(TRIM(COALESCE(m.subcon_name,''))) NOT LIKE 'AHY\\_%'
        AND (UPPER(m.subcon_name) LIKE '%2KX%' OR UPPER(m.subcon_name) LIKE '%FERRUM%' OR UPPER(m.subcon_name) LIKE '%STATE%')`);
    const PCT = { state: 0.80, "2kx": 0.75 };
    const rowsByCanon = { state: [], "2kx": [], ferrumx: [] };
    const adlar = {};
    det.rows.forEach(r => {
      const c = ercTaseronCanon(r.subcon);
      if (!c) return;
      rowsByCanon[c].push(r);
      if (!adlar[c] || r.subcon.length > adlar[c].length) adlar[c] = r.subcon;
    });
    const sonuc = [];
    // 2KX as-built (8812184927): sabit 750 TL/adet — sahibi farklı, ayrı hesap
    // olarak döner; %75 kırılım hesabına GİRMEZ
    const ASBUILT_ITEM = "8812184927", ASBUILT_FIYAT = 750;
    let asbuiltRows = [];
    if (rowsByCanon["2kx"]) {
      asbuiltRows = rowsByCanon["2kx"].filter(r => r.item === ASBUILT_ITEM);
      rowsByCanon["2kx"] = rowsByCanon["2kx"].filter(r => r.item !== ASBUILT_ITEM);
    }
    for (const canon of ["state", "2kx", "ferrumx"]) {
      const rows = rowsByCanon[canon];
      let bedel = 0, detay = [];
      const isSayisi = rows.filter(r => Number(r.fq) > 0).length;
      if (canon === "ferrumx") {
        const bm = ahyTaseronBedel(rows.map(r => ({ subcon: "FERRUMX", site: r.site, kalem: r.kalem, fq: r.fq, qc_ok: r.qc_ok })));
        bedel = Math.round(bm.FERRUMX?.bedel || 0);
        detay = bm.FERRUMX?.detay || [];
      } else {
        const pct = PCT[canon];
        const bySite = {};
        rows.forEach(r => {
          if (Number(r.fq) <= 0) return;
          const tl = Number(r.fq) * Number(r.price) * (String(r.cur).toUpperCase() === "USD" ? kur : 1);
          const b = (bySite[r.site] = bySite[r.site] || { hak: 0, ok: true, n: 0 });
          b.hak += tl; b.n += 1;
          if (!r.qc_ok) b.ok = false;
        });
        Object.entries(bySite).sort((a, b) => a[0].localeCompare(b[0])).forEach(([site, v]) => {
          const pay = v.hak * pct;
          bedel += pay;
          detay.push({ site, kalem: `Saha hakedişi ₺${Math.round(v.hak).toLocaleString("tr-TR")} × %${Math.round(pct * 100)} (${v.n} kalem)`, adet: 1, birim: Math.round(pay), tutar: Math.round(pay), qc: v.ok ? "OK" : "NOK" });
        });
        bedel = Math.round(bedel);
      }
      sonuc.push({ canon, ad: adlar[canon] || canon.toUpperCase(), pct: canon === "ferrumx" ? null : PCT[canon], is_sayisi: isSayisi, bedel, bedel_detay: detay });
    }
    {
      // As-built aynı firmanın (2KX) hesabına dahildir; yalnız dökümde ayrı
      // gösterilir (Excel'de ayrı sayfa) — 2KX o bedeli as-built sahibine öder
      const asbDetay = [];
      let asbBedel = 0, asbAdet = 0;
      asbuiltRows.filter(r => Number(r.fq) > 0)
        .sort((a, b) => a.site.localeCompare(b.site))
        .forEach(r => {
          const q = Number(r.fq);
          asbAdet += q; asbBedel += q * ASBUILT_FIYAT;
          asbDetay.push({ site: r.site, kalem: "Site as-built documentation (sabit 750 TL)", adet: q, birim: ASBUILT_FIYAT, tutar: q * ASBUILT_FIYAT, qc: r.qc_ok ? "OK" : "NOK" });
        });
      const t2 = sonuc.find(x => x.canon === "2kx");
      if (t2) {
        t2.asbuilt = { adet: asbAdet, bedel: Math.round(asbBedel), detay: asbDetay };
        t2.bedel += Math.round(asbBedel);
        t2.is_sayisi += asbDetay.length;
      }
    }
    const fat = await pool.query(`SELECT id, COALESCE(tedarikci,'') AS taseron_adi, fatura_no,
        to_char(fatura_tarihi,'YYYY-MM-DD') AS fatura_tarihi,
        (CASE WHEN COALESCE(toplam_tutar,0) > 0 THEN toplam_tutar ELSE COALESCE(tutar,0) END) AS toplam_tutar,
        COALESCE(odenen_tutar,0) AS odenen_tutar
      FROM invoice_entries WHERE UPPER(COALESCE(firma,'')) <> 'AHY'`);
    const ode = await pool.query(`SELECT COALESCE(firma,'') AS ad, COALESCE(tutar,0) AS tutar
      FROM taseron_odeme_log
      WHERE id NOT IN (SELECT odeme_log_id FROM marka_taseron_odeme WHERE odeme_log_id IS NOT NULL)`);
    for (const t of sonuc) {
      const fs = fat.rows.filter(f => ercTaseronCanon(f.taseron_adi) === t.canon);
      t.faturalar = fs.map(f => ({ fatura_no: f.fatura_no, tarih: f.fatura_tarihi, tutar: Number(f.toplam_tutar || 0) }));
      t.fatura = fs.reduce((sm, f) => sm + Number(f.toplam_tutar || 0), 0);
      const logOde = ode.rows.filter(o => ercTaseronCanon(o.ad) === t.canon).reduce((sm, o) => sm + Number(o.tutar || 0), 0);
      // Fatura girişindeki Ödenen Tutar: aynı tutar ödeme geçmişinde de varsa çift sayma
      const faturaOde = fs.reduce((sm, f) => {
        const v = Number(f.odenen_tutar || 0);
        if (v <= 0) return sm;
        const zatenVar = ode.rows.some(o => ercTaseronCanon(o.ad) === t.canon && Math.abs(Number(o.tutar || 0) - v) < 1);
        return sm + (zatenVar ? 0 : v);
      }, 0);
      t.odenen = logOde + faturaOde;
    }
    res.json({ ok: true, kur, taseronlar: sonuc });
  } catch (e) {
    console.error("ERC TASERON HAKEDIS ERROR:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// AHY panelinden taşeron faturası girişi (invoice_entries'e firma etiketiyle yazar)
app.post("/finance/marka-taseron-fatura", authMiddleware, async (req, res) => {
  try {
    if (!MARKA_KASA_ROLLER.includes(String(req.user?.role || "").toLowerCase()))
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    const { marka, taseron_adi, fatura_no, fatura_tarihi, tutar, kdv, toplam_tutar, note, kategori } = req.body;
    const m = String(marka || "AHY").toUpperCase();
    if (!taseron_adi || !fatura_no || !Number(toplam_tutar || 0))
      return res.status(400).json({ ok: false, error: "Taşeron adı, fatura no ve toplam tutar zorunlu" });
    const mukerrer = await faturaNoMukerrerMi(fatura_no);
    if (mukerrer) {
      return res.status(409).json({ ok: false,
        error: `Bu fatura numarası zaten kayıtlı (${mukerrer.tedarikci} · ${mukerrer.firma === "AHY" ? "AHY" : "Şimşek"} etiketi). İki panel aynı kayıttan beslenir — tekrar girişe gerek yok.` });
    }
    const r = await pool.query(`INSERT INTO invoice_entries
        (tedarikci, rf_montaj_firma, fatura_no, fatura_tarihi, tutar, kdv, toplam_tutar, note, fatura_turu, firma, is_kalemi)
      VALUES ($1,$1,$2,$3,$4,$5,$6,$7,'GELEN',$8,$9) RETURNING id`,
      [String(taseron_adi).trim(), fatura_no, fatura_tarihi || null,
       Number(tutar || 0), Number(kdv || 0), Number(toplam_tutar || 0), note || null, m,
       String(kategori || "").toUpperCase() || null]);
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.put("/finance/marka-taseron-fatura/:id", authMiddleware, async (req, res) => {
  try {
    if (!MARKA_KASA_ROLLER.includes(String(req.user?.role || "").toLowerCase()))
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    const { marka, taseron_adi, fatura_no, fatura_tarihi, tutar, kdv, toplam_tutar, note, kategori } = req.body;
    const m = String(marka || "AHY").toUpperCase();
    if (!taseron_adi || !fatura_no || !Number(toplam_tutar || 0))
      return res.status(400).json({ ok: false, error: "Taşeron adı, fatura no ve toplam tutar zorunlu" });
    // Yalnız kendi markasının faturası güncellenebilir
    await pool.query(`UPDATE invoice_entries SET
        tedarikci=$1, rf_montaj_firma=$1, fatura_no=$2, fatura_tarihi=$3,
        tutar=$4, kdv=$5, toplam_tutar=$6, note=$7, is_kalemi=$8
      WHERE id=$9 AND UPPER(COALESCE(firma,''))=$10`,
      [String(taseron_adi).trim(), fatura_no, fatura_tarihi || null,
       Number(tutar || 0), Number(kdv || 0), Number(toplam_tutar || 0), note || null,
       String(kategori || "").toUpperCase() || null,
       req.params.id, m]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.delete("/finance/marka-taseron-fatura/:id", authMiddleware, async (req, res) => {
  try {
    if (!MARKA_KASA_ROLLER.includes(String(req.user?.role || "").toLowerCase()))
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    const marka = String(req.query.marka || "AHY").toUpperCase();
    // Yalnız kendi markasının faturasını silebilir
    await pool.query(`DELETE FROM invoice_entries WHERE id=$1 AND UPPER(COALESCE(firma,''))=$2`,
      [req.params.id, marka]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.post("/finance/marka-taseron-odeme", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!MARKA_KASA_ROLLER.includes(String(req.user?.role || "").toLowerCase()))
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    const { marka, taseron_adi, tip, tutar, tarih, aciklama, fatura_id } = req.body;
    if (!taseron_adi || !Number(tutar || 0) || !tarih)
      return res.status(400).json({ ok: false, error: "Taşeron adı, tutar ve tarih zorunlu" });
    const tipNorm = String(tip || "AVANS").toUpperCase() === "FATURA_ODEME" ? "FATURA_ODEME" : "AVANS";
    const adi = String(taseron_adi).trim();
    const tutarN = Number(tutar);
    await client.query("BEGIN");
    // ERC senkronu: FATURA_ODEME → açık faturaları FIFO kapat; AVANS → avans logu.
    // Her iki tipte de taseron_odeme_log'a yazılır (ERC ödeme geçmişi + nakit akışı)
    let dagilim, kalan;
    if (tipNorm === "FATURA_ODEME") {
      ({ dagilim, kalan } = await fifoTaseronMahsup(client, adi, tutarN, tarih));
    } else {
      dagilim = [{ fatura_no: "AVANS (fatura bekleniyor)", odeme: tutarN, avans: true }];
      kalan = tutarN;
    }
    const logIns = await client.query(`INSERT INTO taseron_odeme_log
        (firma, tutar, tarih, aciklama, dagilim, avans_tutar)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [adi, tutarN, tarih, aciklama || "AHY panelinden", JSON.stringify(dagilim), kalan > 0 ? kalan : 0]);
    const r = await client.query(`INSERT INTO marka_taseron_odeme
        (marka, taseron_adi, tip, tutar, tarih, aciklama, fatura_id, odeme_log_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [String(marka || "AHY").toUpperCase(), adi, tipNorm,
       tutarN, tarih, aciklama || null, fatura_id ? Number(fatura_id) : null, logIns.rows[0].id]);
    await client.query("COMMIT");
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});
app.put("/finance/marka-taseron-odeme/:id", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!MARKA_KASA_ROLLER.includes(String(req.user?.role || "").toLowerCase()))
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    const { taseron_adi, tip, tutar, tarih, aciklama } = req.body;
    if (!taseron_adi || !Number(tutar || 0) || !tarih)
      return res.status(400).json({ ok: false, error: "Taşeron adı, tutar ve tarih zorunlu" });
    const tipNorm = String(tip || "AVANS").toUpperCase() === "FATURA_ODEME" ? "FATURA_ODEME" : "AVANS";
    const adi = String(taseron_adi).trim();
    const tutarN = Number(tutar);
    await client.query("BEGIN");
    const curR = await client.query(`SELECT * FROM marka_taseron_odeme WHERE id=$1 FOR UPDATE`, [req.params.id]);
    const cur = curR.rows[0];
    if (!cur) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Kayıt bulunamadı" });
    }
    // ERC senkronu: eski log geri alınır (mahsuplar açılır), yeni değerlerle yeniden uygulanır
    if (cur.odeme_log_id) {
      const oldLogR = await client.query(`SELECT * FROM taseron_odeme_log WHERE id=$1 FOR UPDATE`, [cur.odeme_log_id]);
      if (oldLogR.rows[0]) {
        await revertTaseronLog(client, oldLogR.rows[0]);
        await client.query(`DELETE FROM taseron_odeme_log WHERE id=$1`, [cur.odeme_log_id]);
      }
    }
    let dagilim, kalan;
    if (tipNorm === "FATURA_ODEME") {
      ({ dagilim, kalan } = await fifoTaseronMahsup(client, adi, tutarN, tarih));
    } else {
      dagilim = [{ fatura_no: "AVANS (fatura bekleniyor)", odeme: tutarN, avans: true }];
      kalan = tutarN;
    }
    const logIns = await client.query(`INSERT INTO taseron_odeme_log
        (firma, tutar, tarih, aciklama, dagilim, avans_tutar)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [adi, tutarN, tarih, aciklama || "AHY panelinden", JSON.stringify(dagilim), kalan > 0 ? kalan : 0]);
    await client.query(`UPDATE marka_taseron_odeme SET
        taseron_adi=$1, tip=$2, tutar=$3, tarih=$4, aciklama=$5, odeme_log_id=$6
      WHERE id=$7`,
      [adi, tipNorm, tutarN, tarih, aciklama || null, logIns.rows[0].id, req.params.id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});
app.delete("/finance/marka-taseron-odeme/:id", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!MARKA_KASA_ROLLER.includes(String(req.user?.role || "").toLowerCase()))
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    await client.query("BEGIN");
    const curR = await client.query(`SELECT * FROM marka_taseron_odeme WHERE id=$1 FOR UPDATE`, [req.params.id]);
    const cur = curR.rows[0];
    if (cur && cur.odeme_log_id) {
      // ERC senkronu: bağlı log geri alınır ve silinir (mahsuplar açılır)
      const logR = await client.query(`SELECT * FROM taseron_odeme_log WHERE id=$1 FOR UPDATE`, [cur.odeme_log_id]);
      if (logR.rows[0]) {
        await revertTaseronLog(client, logR.rows[0]);
        await client.query(`DELETE FROM taseron_odeme_log WHERE id=$1`, [cur.odeme_log_id]);
      }
    }
    await client.query(`DELETE FROM marka_taseron_odeme WHERE id=$1`, [req.params.id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

// KÂR/ZARAR (P&L): alt markanın aylık gelir tablosu + nakit özeti.
// GELİR: Şimşek'e kesilen faturalar (fatura tarihi) · TAHSİLAT: aynı
// faturaların ödemesi (ödeme tarihi) · GİDER: nakit akışı kalemleri
// (maaş/avans/masraf/kira/diğer, devir kuralları marka-nakit ile aynı).
app.get("/finance/marka-pl", authMiddleware, async (req, res) => {
  try {
    const rol = String(req.user?.role || "").toLowerCase();
    if (!["admin", "platform_admin", "direktor", "muhasebe", "genel_mudur"].includes(rol)) {
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    }
    const marka = String(req.query.marka || "AHY").toUpperCase();
    const DEVIR = "2026-07-15";
    const cMarka = canonSub(marka);
    // NOT: Masraf formları gider DEĞİLDİR — iş avansını kapatırlar (çifte sayım
    // olmasın diye P&L ve nakit toplamlarına girmez; takibi avans bakiyesinde).
    const [fatura, tahsilat, maas, mavans, iavans, kiralar, ofisKira, manuel, taseronOd] = await Promise.all([
      pool.query(`SELECT to_char(fatura_tarihi,'YYYY-MM') AS ay,
          TRIM(COALESCE(NULLIF(rf_montaj_firma,''), tedarikci, '')) AS firma,
          COALESCE(NULLIF(tutar,0), toplam_tutar, 0) AS t
        FROM invoice_entries WHERE fatura_tarihi IS NOT NULL`),
      pool.query(`SELECT to_char(odeme_tarihi,'YYYY-MM') AS ay,
          TRIM(COALESCE(NULLIF(rf_montaj_firma,''), tedarikci, '')) AS firma,
          COALESCE(odenen_tutar, 0) AS t
        FROM invoice_entries
        WHERE odeme_tarihi IS NOT NULL AND COALESCE(odenen_tutar,0) > 0`),
      // Temmuz 2026 dönem maaşı: devir öncesi girenlerde %50 AHY payı,
      // 15.07+ girenlerde tamamı; Temmuz öncesi dönemler yansımaz.
      pool.query(`SELECT to_char(m.tarih,'YYYY-MM') AS ay,
          SUM((COALESCE(m.bankadan,0)+COALESCE(m.elden,0)) *
            CASE WHEN COALESCE(m.donem,'') = '2026-07'
                      AND (p.ise_giris_tarihi IS NULL OR p.ise_giris_tarihi::date < DATE '2026-07-15')
                 THEN 0.5 ELSE 1 END) AS t
        FROM maas_odeme m JOIN personel p ON p.id=m.personel_id
        WHERE COALESCE(p.marka,'ERC')=$1 AND m.tarih >= $2
          AND COALESCE(m.donem, to_char(m.tarih,'YYYY-MM')) >= '2026-07' GROUP BY 1`, [marka, DEVIR]),
      pool.query(`SELECT to_char(a.tarih,'YYYY-MM') AS ay, SUM(a.tutar) AS t
        FROM avans a JOIN personel p ON p.id=a.personel_id
        WHERE COALESCE(p.marka,'ERC')=$1 AND a.tarih >= $2
          AND UPPER(COALESCE(a.avans_turu,'MAAS'))='MAAS' GROUP BY 1`, [marka, DEVIR]),
      pool.query(`SELECT to_char(COALESCE(t.odeme_tarihi, t.direktor_onay_tarihi),'YYYY-MM') AS ay, SUM(t.tutar) AS t
        FROM is_avans_talep t
        WHERE UPPER(COALESCE(t.firma,'ERC'))=$1
          AND t.durum IN ('DIREKTOR_ONAY','TAMAMLANDI')
          AND COALESCE(t.odeme_tarihi, t.direktor_onay_tarihi) >= $2 GROUP BY 1`, [marka, DEVIR]),
      pool.query(`SELECT to_char(o.tarih,'YYYY-MM') AS ay, SUM(o.tutar) AS t
        FROM arac_kira_odemeler o
        WHERE o.created_at >= $1::date GROUP BY 1`, [DEVIR]).catch(() => ({ rows: [] })),
      pool.query(`SELECT to_char(o.tarih,'YYYY-MM') AS ay, SUM(o.tutar) AS t
        FROM ofis_kira_odemeler o
        WHERE o.created_at >= $1::date GROUP BY 1`, [DEVIR]).catch(() => ({ rows: [] })),
      pool.query(`SELECT to_char(tarih,'YYYY-MM') AS ay, kategori, SUM(tutar) AS t
        FROM cashflow_odeme
        WHERE UPPER(COALESCE(marka,'ERC')) = $1 GROUP BY 1,2`, [marka]).catch(() => ({ rows: [] })),
      // Taşeron ödemeleri (avans + fatura ödemesi) — nakit akışıyla tutarlı
      pool.query(`SELECT to_char(tarih,'YYYY-MM') AS ay, SUM(tutar) AS t
        FROM marka_taseron_odeme
        WHERE UPPER(marka) = $1 GROUP BY 1`, [marka]).catch(() => ({ rows: [] })),
    ]);
    const map = {};
    const rowOf = (ay) => (map[ay] = map[ay] || {
      ay, fatura: 0, tahsilat: 0,
      maas: 0, maas_avans: 0, is_avans: 0, kira: 0, taseron: 0, diger: 0,
    });
    for (const r of fatura.rows) {
      if (canonSub(r.firma) !== cMarka || !r.ay) continue;
      rowOf(r.ay).fatura += Number(r.t || 0);
    }
    for (const r of tahsilat.rows) {
      if (canonSub(r.firma) !== cMarka || !r.ay) continue;
      rowOf(r.ay).tahsilat += Number(r.t || 0);
    }
    maas.rows.forEach(r => { if (r.ay) rowOf(r.ay).maas += Number(r.t || 0); });
    mavans.rows.forEach(r => { if (r.ay) rowOf(r.ay).maas_avans += Number(r.t || 0); });
    iavans.rows.forEach(r => { if (r.ay) rowOf(r.ay).is_avans += Number(r.t || 0); });
    kiralar.rows.forEach(r => { if (r.ay) rowOf(r.ay).kira += Number(r.t || 0); });
    ofisKira.rows.forEach(r => { if (r.ay) rowOf(r.ay).kira += Number(r.t || 0); });
    manuel.rows.forEach(r => {
      if (!r.ay) return;
      if (String(r.kategori).toUpperCase() === "ARAC") rowOf(r.ay).kira += Number(r.t || 0);
      else rowOf(r.ay).diger += Number(r.t || 0);
    });
    taseronOd.rows.forEach(r => { if (r.ay) rowOf(r.ay).taseron += Number(r.t || 0); });
    // Aylar artan sırada; kümülatif alacak = Σ(fatura − tahsilat)
    let alacak = 0;
    const aylar = Object.values(map).sort((a, b) => a.ay.localeCompare(b.ay)).map(o => {
      const gider = o.maas + o.maas_avans + o.is_avans + o.kira + o.taseron + o.diger;
      const kar = +(o.fatura - gider).toFixed(2);
      const netNakit = +(o.tahsilat - gider).toFixed(2);
      alacak = +(alacak + o.fatura - o.tahsilat).toFixed(2);
      return { ...o, gider: +gider.toFixed(2), kar, netNakit, alacak };
    });
    res.json({ ok: true, marka, aylar });
  } catch (e) {
    console.error("MARKA PL ERROR:", e.message);
    res.status(500).json({ ok: false, error: "Kâr/Zarar raporu alınamadı" });
  }
});

// AYLIK SABİT GİDERLER: P&L panelinin alt bölümü — depo/ofis kiraları,
// araç kiraları (aktif olanlar) ve personel maaş toplamı (yalnız toplam;
// kişi bazlı maaş şifreli İK alanında kalır).
app.get("/finance/marka-sabit-giderler", authMiddleware, async (req, res) => {
  try {
    const rol = String(req.user?.role || "").toLowerCase();
    if (!["admin", "platform_admin", "direktor", "muhasebe", "genel_mudur"].includes(rol)) {
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    }
    const marka = String(req.query.marka || "AHY").toUpperCase();
    const [ofisler, araclar, maas] = await Promise.all([
      pool.query(`SELECT ad, COALESCE(aylik_kira,0) AS tutar FROM ofis_depo
        WHERE durum='AKTİF' AND COALESCE(aylik_kira,0) > 0 ORDER BY tutar DESC`).catch(() => ({ rows: [] })),
      pool.query(`SELECT plaka AS ad, COALESCE(aylik_kira,0) AS tutar FROM araclar
        WHERE durum='AKTİF' AND COALESCE(aylik_kira,0) > 0 ORDER BY tutar DESC`).catch(() => ({ rows: [] })),
      // Yalnız kadrolu (Şimşek tipi) personel — ISG için kayıtlı taşeron
      // ekipleri maaşlı kadro değildir, kişi sayısına girmez
      pool.query(`SELECT COUNT(*)::int AS kisi, COALESCE(SUM(net_maas),0) AS toplam FROM personel
        WHERE COALESCE(marka,'ERC')=$1 AND aktif = true
          AND COALESCE(firma_tipi,'simsek') = 'simsek'`, [marka]).catch(() => ({ rows: [{ kisi: 0, toplam: 0 }] })),
    ]);
    const t = (rows) => rows.reduce((s, r) => s + Number(r.tutar || 0), 0);
    const maasToplam = Number(maas.rows[0]?.toplam || 0);
    res.json({
      ok: true,
      ofisler: ofisler.rows,
      araclar: araclar.rows,
      maas: { kisi: Number(maas.rows[0]?.kisi || 0), toplam: maasToplam },
      toplam: t(ofisler.rows) + t(araclar.rows) + maasToplam,
    });
  } catch (e) {
    console.error("SABIT GIDER ERROR:", e.message);
    res.status(500).json({ ok: false, error: "Sabit giderler alınamadı" });
  }
});

// HAKEDİŞ KIRILIM RAPORU: HW'ye kesilen faturalar (hw_invoice_rows) üzerinden
// aylık ana yüklenici (ERC) / alt yüklenici (AHY) payı. Yüzde markalar
// tablosundan okunur (AHY.kirilim_yuzde = ERC payı, ör. 10).
app.get("/finance/kirilim-raporu", authMiddleware, async (req, res) => {
  try {
    // Yönetim seviyesi: admin, direktör, muhasebe, genel müdür, platform admin
    const rol = String(req.user?.role || "").toLowerCase();
    if (!["admin", "platform_admin", "direktor", "muhasebe", "genel_mudur"].includes(rol)) {
      return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    }
    let yuzde = 10;
    try {
      const m = await pool.query("SELECT kirilim_yuzde FROM markalar WHERE kod='AHY' LIMIT 1");
      if (m.rows[0]) yuzde = Number(m.rows[0].kirilim_yuzde || 10);
    } catch {}
    // Fatura → taşeron ataması: kalem dökümü (hw_invoice_items) + PO fiyat
    // ağırlığı ile her faturanın AHY* payı bulunur. Kırılım YALNIZ adı AHY ile
    // başlayan taşeronların (AHY, AHY_2KX, AHY_NETELKOM...) işlerine uygulanır;
    // diğer taşeron işleri ve dökümü yüklenmemiş faturalar ayrı raporlanır.
    const canonInvK = (v) => String(v || "").trim().toUpperCase()
      .replace(/-.*$/, "").replace(/^(SIM\d{4})0+/, "$1");
    const attr = new Map(); // canon invoice_no → { total, ahy }
    try {
      const subRes = await pool.query(`
        SELECT h.invoice_no,
               COALESCE(p.unit_price, 0) AS w,
               (SELECT m.subcon_name FROM master_works m
                  WHERE m.site_code = h.site_id AND m.item_code = h.item_code
                  ORDER BY m.done_qty DESC NULLS LAST LIMIT 1) AS subcon
        FROM hw_invoice_items h
        LEFT JOIN po_rows p ON p.po_no = h.po_no AND p.po_line_no = h.line_no
        WHERE h.invoice_no IS NOT NULL AND h.invoice_no <> ''
      `);
      for (const x of subRes.rows) {
        const w = Number(x.w || 0) || 1; // fiyat yoksa eşit ağırlık
        const key = canonInvK(x.invoice_no);
        const a = attr.get(key) || { total: 0, ahy: 0 };
        a.total += w;
        if (String(x.subcon || "").trim().toUpperCase().startsWith("AHY")) a.ahy += w;
        attr.set(key, a);
      }
    } catch (e) { console.error("kirilim taşeron atama:", e.message); }

    const r = await pool.query(`
      SELECT invoice_no, to_char(invoice_date,'YYYY-MM') AS ay,
             COALESCE(invoice_amount,0) AS tutar,
             UPPER(COALESCE(currency,'TRY')) AS cur
      FROM hw_invoice_rows
      WHERE invoice_date IS NOT NULL
    `);
    const ayMap = new Map();
    for (const x of r.rows) {
      const o = ayMap.get(x.ay) || { ay: x.ay, fatura_sayisi: 0, try_toplam: 0, usd_toplam: 0, diger_try: 0, diger_usd: 0, dokumsuz_try: 0, dokumsuz_usd: 0 };
      const isUsd = x.cur === "USD";
      const tutar = Number(x.tutar || 0);
      const a = attr.get(canonInvK(x.invoice_no));
      if (a && a.total > 0) {
        const ahyPay = tutar * (a.ahy / a.total);
        const digerPay = tutar - ahyPay;
        if (isUsd) { o.usd_toplam += ahyPay; o.diger_usd += digerPay; }
        else { o.try_toplam += ahyPay; o.diger_try += digerPay; }
        if (a.ahy > 0) o.fatura_sayisi += 1;
      } else {
        // Kalem dökümü yüklenmemiş: taşeronu bilinmiyor — ayrı gösterilir
        if (isUsd) o.dokumsuz_usd += tutar; else o.dokumsuz_try += tutar;
      }
      ayMap.set(x.ay, o);
    }
    const aylar = [...ayMap.values()].sort((a, b) => b.ay.localeCompare(a.ay)).map((x) => {
      const tryT = +x.try_toplam.toFixed(2), usdT = +x.usd_toplam.toFixed(2);
      return {
        ay: x.ay,
        fatura_sayisi: x.fatura_sayisi,
        try_toplam: tryT,
        usd_toplam: usdT,
        erc_try: +(tryT * yuzde / 100).toFixed(2),
        ahy_try: +(tryT * (100 - yuzde) / 100).toFixed(2),
        erc_usd: +(usdT * yuzde / 100).toFixed(2),
        ahy_usd: +(usdT * (100 - yuzde) / 100).toFixed(2),
        diger_try: +x.diger_try.toFixed(2),
        diger_usd: +x.diger_usd.toFixed(2),
        dokumsuz_try: +x.dokumsuz_try.toFixed(2),
        dokumsuz_usd: +x.dokumsuz_usd.toFixed(2),
      };
    });
    res.json({ ok: true, yuzde, aylar });
  } catch (e) {
    console.error("KIRILIM RAPORU ERROR:", e.message);
    res.status(500).json({ ok: false, error: "Kırılım raporu alınamadı" });
  }
});

app.post("/hw-po/upload", requireHwYukleme, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Dosya yok" });
    }

    const workbook = XLSX.read(req.file.buffer);
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      return res
        .status(400)
        .json({ ok: false, error: "Excel içinde sheet bulunamadı" });
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

    if (!rows.length) {
      return res
        .status(400)
        .json({ ok: false, error: "Excel içinde veri bulunamadı" });
    }

    await pool.query(`DELETE FROM po_rows`);

    let inserted = 0;

    for (const r of rows) {
      const projectCode = getCell(r, [
        "Project Code",
        "Project",
        "project_code",
        "Proje Kodu",
      ]);

      const siteCode = getCell(r, [
        "Site Code",
        "Site",
        "site_code",
        "Saha Kodu",
      ]);

      const itemCode = getCell(r, [
        "Item Code",
        "Item",
        "s_bom_code",
        "S-BOM Code",
        "BoQ Code",
        "Kalem Kodu",
      ]);

      const itemDescription = getCell(r, [
        "Item Description",
        "Description",
        "boq_items_en",
        "BoQ Items EN",
        "Kalem Açıklaması",
      ]);

      const requestedQty = getCell(r, [
        "Requested Qty",
        "Request Qty",
        "PO Qty",
        "QTY",
        "Talep Miktarı",
      ]);

      const billedQty = getCell(r, [
        "Billed Qty",
        "Billed Quantity",
        "Invoice Qty",
        "Faturalanan Miktar",
      ]);

      const dueQty = getCell(r, ["Due Qty", "Remaining Qty", "Kalan Miktar"]);
      const unitPrice = getCell(r, ["Unit Price", "Price", "Birim Fiyat"]);

      const currency = getCell(r, ["Currency", "Curr", "Para Birimi"]);
      const finalCurrency = inferCurrencyByItemAndPrice(
        itemCode,
        currency,
        parseNumber(unitPrice),
      );
      const poNo      = getCell(r, ["PO NO.", "PO No.", "PO No", "PO", "Purchase Order", "PO Number"]);
      const poLineNo  = getCell(r, ["PO Line NO.", "PO Line No.", "PO Line No", "POLineNo.", "POLineNo", "Line No"]);
      const shipmentNo = getCell(r, ["Shipment NO.", "Shipment No.", "Shipment No", "ShipmentNO.", "ShipmentNO", "Shipment"]);

      if (!projectCode && !siteCode && !itemCode && !itemDescription) continue;

      // Sadece izin verilen proje kodları
      const IZINLI_PROJELER = ['56A0SJC', '56A0QEF', '56A0NCD', '56A0TCT', '56A0819'];
      const pcTrimmed = projectCode ? String(projectCode).trim().toUpperCase() : '';
      if (!IZINLI_PROJELER.includes(pcTrimmed)) continue;

      // CANCELLED olan PO'ları alma
      const poStatus = getCell(r, ['PO Status', 'Status', 'po_status', 'Durum']);
      if (poStatus && String(poStatus).trim().toUpperCase() === 'CANCELLED') continue;

      await pool.query(
        `
        INSERT INTO po_rows
        (
          project_code,
          site_code,
          item_code,
          item_description,
          unit_price,
          currency,
          requested_qty,
          billed_qty,
          due_qty,
          po_no,
          po_line_no,
          shipment_no,
          upload_batch
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        `,
        [
          projectCode ? String(projectCode).trim() : null,
          siteCode ? String(siteCode).trim().toUpperCase() : null,
          itemCode ? String(itemCode).trim() : null,
          itemDescription ? String(itemDescription).trim() : null,
          parseNumber(unitPrice),
          finalCurrency,
          parseNumber(requestedQty),
          parseNumber(billedQty),
          parseNumber(dueQty),
          poNo ? String(poNo).trim() : null,
          poLineNo ? String(poLineNo).trim() : null,
          shipmentNo ? String(shipmentNo).trim() : null,
          req.file.filename,
        ],
      );

      inserted++;
    }

    res.json({
      ok: true,
      message: "Huawei PO listesi yüklendi",
      inserted,
      sheet_name: firstSheetName,
    });
  } catch (err) {
    console.error("HW PO UPLOAD ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/rollout/upload", upload.single("file"), async (req, res) => {
  try {
    const workbook = XLSX.read(req.file.buffer);

    const normalizeHeader = (value) =>
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");

    const get = (row, ...keys) => {
      const normalizedRow = {};

      Object.keys(row || {}).forEach((key) => {
        normalizedRow[normalizeHeader(key)] = row[key];
      });

      for (const key of keys) {
        const value = normalizedRow[normalizeHeader(key)];

        if (
          value !== undefined &&
          value !== null &&
          String(value).trim() !== ""
        ) {
          return value;
        }
      }

      return null;
    };

    function parseDateSafe(value) {
      if (!value) return null;
      if (typeof value === "string") {
        const v = value.trim();
        if (!v || v.toUpperCase() === "OK" || v === "00.00.00") return null;
      }
      if (typeof value === "number") {
        const excelDate = new Date(Math.round((value - 25569) * 86400 * 1000));
        return isNaN(excelDate) ? null : excelDate;
      }
      const d = new Date(value);
      return isNaN(d) ? null : d;
    }

    const allRows = [];
    const allowedSheets = ["5G", "DSS", "Standalone", "LTE"];

    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { defval: null });

      data.forEach((row) => {
        const siteCode = get(
          row,
          "site_code",
          "Site Code",
          "SITE CODE",
          "Site ID",
          "Saha Kodu",
        );
        const autoRegion = detectRegion(siteCode);
        if (!siteCode) return;

        allRows.push({
          bolge: get(row, "Bölge", "Bolge", "bolge", "region") || autoRegion,
          site_type:
            String(get(row, "site_type", "Site Type", "Saha Türü") || sheetName)
              .trim()
              .toUpperCase() === "STANDALONE"
              ? "Standalone"
              : String(
                  get(row, "site_type", "Site Type", "Saha Türü") || sheetName,
                ).trim(),
          project_code: get(row, "project_code", "Project Code"),
          site_code: siteCode,
          il: get(row, "il", "İl", "IL", "İL"),
          malzeme_status: get(row, "malzeme_status", "Malzeme Status"),

          rf_subcon: get(row, "rf_subcon", "RF Subcon"),
          plan_start_date: parseDateSafe(
            get(row, "plan_start_date", "Plan Start Date"),
          ),
          installation_actual_start_date: parseDateSafe(
            get(
              row,
              "installation_actual_start_date",
              "Installation Actual Start Date",
              "install_start_date",
              "Install Start",
            ),
          ),
          installation_actual_end_date: parseDateSafe(
            get(
              row,
              "installation_actual_end_date",
              "Installation Actual End Date",
              "install_end_date",
              "Install End",
            ),
          ),
          onair_date: parseDateSafe(
            get(row, "onair_date", "OnAir Date", "OnAir"),
          ),
          rf_not: get(row, "rf_not", "RF Not"),

          los_subcon: get(row, "los_subcon", "LOS Subcon"),
          los_plan_date: parseDateSafe(
            get(row, "los_plan_date", "LOS Plan Date"),
          ),
          los_actual_end_date: parseDateSafe(
            get(row, "los_actual_end_date", "LOS Actual End Date"),
          ),

          tss_subcon: get(row, "tss_subcon", "TSS Subcon"),
          tss_plan_start_date: parseDateSafe(
            get(row, "tss_plan_start_date", "TSS Plan Start Date"),
          ),
          tss_actual_end_date: parseDateSafe(
            get(row, "tss_actual_end_date", "TSS Actual End Date"),
          ),

          tssr_subcon: get(row, "tssr_subcon", "TSSR Subcon"),
          tssr_plan_start_date: parseDateSafe(
            get(row, "tssr_plan_start_date", "TSSR Plan Start Date"),
          ),
          tssr_actual_end_date: parseDateSafe(
            get(row, "tssr_actual_end_date", "TSSR Actual End Date"),
          ),

          btk_subcon: get(row, "btk_subcon", "BTK Subcon"),
          btk_plan_start_date: parseDateSafe(
            get(row, "btk_plan_start_date", "BTK Plan Start Date"),
          ),
          btk_actual_end_date: parseDateSafe(
            get(row, "btk_actual_end_date", "BTK Actual End Date"),
          ),
          btk_approved: parseDateSafe(
            get(row, "btk_approved", "BTK Approved by BTK"),
          ),
          btk_file_submit: parseDateSafe(
            get(row, "btk_file_submit", "BTK FILE SUBMIT TO IFIS"),
          ),
          btk_certificate_date: parseDateSafe(
            get(row, "btk_certificate_date", "BTK Certificate Date"),
          ),

          asbuilt_subcon: get(row, "asbuilt_subcon", "As-Built Subcon"),
          asbuilt_actual_end_date: parseDateSafe(
            get(row, "asbuilt_actual_end_date", "As-Built Actual End Date"),
          ),

          survey_note: get(row, "survey_note", "Survey Note"),

          emr_plan_start_date: parseDateSafe(
            get(row, "emr_plan_start_date", "EMR Plan Start Date"),
          ),
          emr_actual_end_date: parseDateSafe(
            get(row, "emr_actual_end_date", "EMR Actual End Date"),
          ),

          trs_subcon: get(row, "trs_subcon", "TRS Subcon"),
          trs_plan_start_date: parseDateSafe(
            get(row, "trs_plan_start_date", "TRS Plan Start Date"),
          ),
          trs_actual_end_date: parseDateSafe(
            get(row, "trs_actual_end_date", "TRS Actual End Date"),
          ),
          trs_not: get(row, "trs_not", "TRS Not"),

          enh_subcon: get(row, "enh_subcon", "ENH Subcon"),
          enh_plan_start_date: parseDateSafe(
            get(row, "enh_plan_start_date", "ENH Plan Start Date"),
          ),
          enh_actual_end_date: parseDateSafe(
            get(row, "enh_actual_end_date", "ENH Actual End Date"),
          ),
          enh_not: get(row, "enh_not", "ENH Not"),

          power_subcon: get(row, "power_subcon", "POWER Project Subcon"),
          power_plan_start_date: parseDateSafe(
            get(row, "power_plan_start_date", "POWER Project Plan Start Date"),
          ),
          power_actual_end_date: parseDateSafe(
            get(row, "power_actual_end_date", "POWER Project Actual End Date"),
          ),

          abonelik_end_date: parseDateSafe(
            get(row, "abonelik_end_date", "Abonelik Belgesi Actual End Date"),
          ),
          tt_horizon_end_date: parseDateSafe(
            get(row, "tt_horizon_end_date", "TT Horizon Actual End Date"),
          ),
          pac_end_date: parseDateSafe(
            get(row, "pac_end_date", "PAC Actual End Date"),
          ),
        });
      });
    });

    const regions = [...new Set(allRows.map((r) => r.bolge).filter(Boolean))];

    if (!regions.length) {
      console.log("⚠️ Bölge bulunamadı, delete yapılmadı");
    } else {
      console.log("Silinecek bölgeler:", regions);

      for (const region of regions) {
        await pool.query("DELETE FROM rollout_progress WHERE bolge = $1", [
          region,
        ]);
      }
    }

    console.log("Yüklenecek kayıt sayısı:", allRows.length);

    for (const r of allRows) {
      await pool.query(
        `
        INSERT INTO rollout_progress(
          bolge, site_type, project_code, site_code, il, malzeme_status,
          rf_subcon, plan_start_date, installation_actual_start_date, installation_actual_end_date, onair_date, rf_not,
          los_subcon, los_plan_date, los_actual_end_date,
          tss_subcon, tss_plan_start_date, tss_actual_end_date,
          tssr_subcon, tssr_plan_start_date, tssr_actual_end_date,
          btk_subcon, btk_plan_start_date, btk_actual_end_date, btk_approved, btk_file_submit, btk_certificate_date,
          asbuilt_subcon, asbuilt_actual_end_date,
          survey_note,
          emr_plan_start_date, emr_actual_end_date,
          trs_subcon, trs_plan_start_date, trs_actual_end_date, trs_not,
          enh_subcon, enh_plan_start_date, enh_actual_end_date, enh_not,
          power_subcon, power_plan_start_date, power_actual_end_date,
          abonelik_end_date, tt_horizon_end_date, pac_end_date
        ) VALUES(
          $1,$2,$3,$4,$5,$6,
          $7,$8,$9,$10,$11,$12,
          $13,$14,$15,
          $16,$17,$18,
          $19,$20,$21,
          $22,$23,$24,$25,$26,$27,
          $28,$29,
          $30,
          $31,$32,
          $33,$34,$35,$36,
          $37,$38,$39,$40,
          $41,$42,$43,
          $44,$45,$46
       )
       ON CONFLICT (site_code)
       DO UPDATE SET
          bolge = EXCLUDED.bolge,
          project_code = EXCLUDED.project_code,
          il = EXCLUDED.il,
          malzeme_status = EXCLUDED.malzeme_status,
          rf_subcon = EXCLUDED.rf_subcon,
          plan_start_date = EXCLUDED.plan_start_date,
          installation_actual_start_date = EXCLUDED.installation_actual_start_date,
          installation_actual_end_date = EXCLUDED.installation_actual_end_date,
          onair_date = EXCLUDED.onair_date,
          rf_not = EXCLUDED.rf_not,
          los_subcon = EXCLUDED.los_subcon,
          los_plan_date = EXCLUDED.los_plan_date,
          los_actual_end_date = EXCLUDED.los_actual_end_date,
          tss_subcon = EXCLUDED.tss_subcon,
          tss_plan_start_date = EXCLUDED.tss_plan_start_date,
          tss_actual_end_date = EXCLUDED.tss_actual_end_date,
          tssr_subcon = EXCLUDED.tssr_subcon,
          tssr_plan_start_date = EXCLUDED.tssr_plan_start_date,
          tssr_actual_end_date = EXCLUDED.tssr_actual_end_date,
          btk_subcon = EXCLUDED.btk_subcon,
          btk_plan_start_date = EXCLUDED.btk_plan_start_date,
          btk_actual_end_date = EXCLUDED.btk_actual_end_date,
          btk_approved = EXCLUDED.btk_approved,
          btk_file_submit = EXCLUDED.btk_file_submit,
          btk_certificate_date = EXCLUDED.btk_certificate_date,
          asbuilt_subcon = EXCLUDED.asbuilt_subcon,
          asbuilt_actual_end_date = EXCLUDED.asbuilt_actual_end_date,
          survey_note = EXCLUDED.survey_note,
          emr_plan_start_date = EXCLUDED.emr_plan_start_date,
          emr_actual_end_date = EXCLUDED.emr_actual_end_date,
          trs_subcon = EXCLUDED.trs_subcon,
          trs_plan_start_date = EXCLUDED.trs_plan_start_date,
          trs_actual_end_date = EXCLUDED.trs_actual_end_date,
          trs_not = EXCLUDED.trs_not,
          enh_subcon = EXCLUDED.enh_subcon,
          enh_plan_start_date = EXCLUDED.enh_plan_start_date,
          enh_actual_end_date = EXCLUDED.enh_actual_end_date,
          enh_not = EXCLUDED.enh_not,
          power_subcon = EXCLUDED.power_subcon,
          power_plan_start_date = EXCLUDED.power_plan_start_date,
          power_actual_end_date = EXCLUDED.power_actual_end_date,
          abonelik_end_date = EXCLUDED.abonelik_end_date,
          tt_horizon_end_date = EXCLUDED.tt_horizon_end_date,
          pac_end_date = EXCLUDED.pac_end_date
        `,
        Object.values(r),
      );
    }

    res.json({ ok: true, count: allRows.length });
  } catch (err) {
    console.error("ROLLOUT UPLOAD ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

function getRegionFromSiteCode(siteCode) {
  const code = String(siteCode || "")
    .toUpperCase()
    .trim();

  if (
    code.startsWith("ES") ||
    code.startsWith("BO") ||
    code.startsWith("ZO") ||
    code.startsWith("KA")
  ) {
    return "Ankara";
  }

  if (
    code.startsWith("IZ") ||
    code.startsWith("MU") ||
    code.startsWith("US") ||
    code.startsWith("MN") ||
    code.startsWith("DE") ||
    code.startsWith("AI")
  ) {
    return "İzmir";
  }

  if (
    code.startsWith("AT") ||
    code.startsWith("IP") ||
    code.startsWith("AF") ||
    code.startsWith("BU")
  ) {
    return "Antalya";
  }

  return "";
}

app.post("/import/completed-works", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Dosya yok" });
    }

    const workbook = XLSX.read(req.file.buffer);
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      return res.status(400).json({
        ok: false,
        error: "Excel içinde sheet bulunamadı",
      });
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

    if (!rows.length) {
      return res.status(400).json({
        ok: false,
        error: "Excel içinde veri bulunamadı",
      });
    }

    let inserted = 0;
    let updated = 0;
    let rolloutCreated = 0;

    for (const r of rows) {
      const siteType =
        getCell(r, ["Site Type", "site_type", "Saha Türü"]) || "5G";

      const projectCode = getCell(r, [
        "Project Code",
        "project_code",
        "Proje Kodu",
      ]);

      const siteCode = getCell(r, ["Site Code", "site_code", "Saha Kodu"]);

      const itemCode = getCell(r, ["Item Code", "item_code", "Kalem Kodu"]);

      const itemDescription = getCell(r, [
        "Item Description",
        "item_description",
        "Kalem Açıklaması",
      ]);

      const doneQty = getCell(r, ["Done Qty", "done_qty", "Tamamlanan Miktar"]);

      const subconName = getCell(r, ["Subcon Name", "subcon_name", "Taşeron"]);

      const onAirDate = getCell(r, ["OnAir Date", "onair_date", "Tarih"]);
      const note = getCell(r, ["Not", "Note", "note"]);

      const qcDurum = getCell(r, ["QC Durum", "qc_durum"]);
      const kabulDurum = getCell(r, ["Kabul Durum", "kabul_durum"]);
      const kabulNot = getCell(r, ["Kabul Not", "kabul_not"]);

      const normalizedSiteCode = siteCode
        ? String(siteCode).replace(/\s+/g, "").toUpperCase()
        : "";

      const normalizedItemCode = itemCode ? String(itemCode).trim() : "";

      if (!normalizedSiteCode || !normalizedItemCode) continue;

      // ✅ completed work içindeki saha rollout_sites içinde yoksa otomatik oluştur

      const duplicateCheck = await pool.query(
        `
        SELECT id
        FROM master_works
        WHERE project_code = $1
          AND site_code = $2
          AND item_code = $3
        LIMIT 1
        `,
        [
          projectCode ? String(projectCode).trim() : null,
          normalizedSiteCode,
          normalizedItemCode,
        ],
      );

      if (duplicateCheck.rows.length > 0) {
        await pool.query(
          `
          UPDATE master_works
          SET
            site_type = $1,
            item_description = $2,
            done_qty = $3,
            subcon_name = $4,
            onair_date = $5,
            qc_durum = $6,
            kabul_durum = $7,
            kabul_not = $8,
            note = $9
          WHERE
            project_code = $10
            AND site_code = $11
            AND item_code = $12
          `,
          [
            siteType ? String(siteType).trim() : "5G",
            itemDescription ? String(itemDescription).trim() : null,
            parseNumber(doneQty),
            subconName ? String(subconName).trim() : null,
            parseExcelDate(onAirDate),
            qcDurum || "NOK",
            kabulDurum || "NOK",
            kabulNot ? String(kabulNot).trim() : null,
            note ? String(note).trim() : null,
            projectCode ? String(projectCode).trim() : null,
            normalizedSiteCode,
            normalizedItemCode,
          ],
        );

        updated++;
        continue;
      }

      await pool.query(
        `
        INSERT INTO master_works
        (
          site_type,
          project_code,
          site_code,
          item_code,
          item_description,
          done_qty,
          subcon_name,
          onair_date,
          note,
          qc_durum,
          kabul_durum,
          kabul_not
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `,
        [
          siteType ? String(siteType).trim() : "5G",
          projectCode ? String(projectCode).trim() : null,
          normalizedSiteCode,
          normalizedItemCode,
          itemDescription ? String(itemDescription).trim() : null,
          parseNumber(doneQty),
          subconName ? String(subconName).trim() : null,
          parseExcelDate(onAirDate),
          note ? String(note).trim() : null,
          qcDurum || "NOK",
          kabulDurum || "NOK",
          kabulNot ? String(kabulNot).trim() : null,
        ],
      );

      inserted++;
    }

    const syncResult = await syncRolloutTargets();

    res.json({
      ok: true,
      inserted,
      updated,
      rolloutCreated,
      sheet_name: firstSheetName,
      message: "Geçmiş işler başarıyla yüklendi",
      rolloutSync: syncResult,
    });
  } catch (err) {
    console.error("IMPORT COMPLETED WORKS ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function getSiteTypeFromSiteCode(siteCode) {
  const code = String(siteCode || "")
    .toUpperCase()
    .trim();

  // DSS — _DSS_ veya _GPS_ (GPS Readiness = DSS)
  if (code.includes("_DSS_") || code.includes("_GPS_")) return "DSS";

  // LTE — standart pattern'ler + _W2100_ / _W900_ / _W1900_
  if (
    code.includes("_L1800_") ||
    code.includes("_L2600_") ||
    code.includes("_L800_") ||
    code.includes("_LC1800_") ||
    code.includes("_L2100_") ||
    code.includes("_L900_") ||
    code.includes("_LTE_") ||
    code.includes("_W2100_") ||
    code.includes("_W900_") ||
    code.includes("_W1900_")
  ) {
    return "LTE";
  }

  // 5G — standart pattern'ler + _5GREADINESS_
  if (
    code.includes("_NR3500_") ||
    code.includes("_NR700_") ||
    code.includes("_TRP_") ||
    code.includes("5GEXP") ||
    code.includes("5GREADINESS")
  ) {
    return "5G";
  }

  // STANDALONE
  if (code.includes("_NS_")) return "STANDALONE";

  return "";
}
function getCityFromSiteCode(siteCode) {
  const code = String(siteCode || "")
    .toUpperCase()
    .trim();

  if (code.startsWith("BO")) return "BOLU";
  if (code.startsWith("ES")) return "ESKİŞEHİR";
  if (code.startsWith("ZO")) return "ZONGULDAK";
  if (code.startsWith("KA")) return "KARABÜK";
  if (code.startsWith("BI")) return "BARTIN";
  if (code.startsWith("CN")) return "ÇANKIRI";

  if (code.startsWith("IZ")) return "İZMİR";
  if (code.startsWith("MU")) return "MUĞLA";
  if (code.startsWith("US")) return "UŞAK";
  if (code.startsWith("MN")) return "MANİSA";
  if (code.startsWith("DE")) return "DENİZLİ";
  if (code.startsWith("AI")) return "AYDIN";

  if (code.startsWith("AT")) return "ANTALYA";
  if (code.startsWith("IP")) return "ISPARTA";
  if (code.startsWith("AF")) return "AFYON";
  if (code.startsWith("BU")) return "BURDUR";

  return "";
}

app.post("/rollout/add-site", async (req, res) => {
  try {
    const { site_code, project_code, site_type } = req.body;

    if (!site_code) {
      return res.status(400).json({ ok: false, error: "site_code zorunlu" });
    }

    const normalizedSiteCode = String(siteCode).replace(/\s+/g, "").toUpperCase();

    const exists = await pool.query(
      `
      SELECT id
      FROM rollout_progress
      WHERE UPPER(TRIM(site_code)) = $1
      LIMIT 1
      `,
      [normalizedSiteCode],
    );

    if (exists.rowCount > 0) {
      return res.json({ ok: true, message: "Zaten var" });
    }

    await pool.query(
      `
      INSERT INTO rollout_progress (
        site_code,
        site_type,
        project_code,
        bolge,
        il,
        qc_durum,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
      `,
      [
        normalizedSiteCode,
        site_type || getSiteTypeFromSiteCode(normalizedSiteCode) || "5G",
        project_code || null,
        getRegionFromSiteCode(normalizedSiteCode) || null,
        getCityFromSiteCode(normalizedSiteCode) || null,
        "NOK",
      ],
    );

    res.json({ ok: true, message: "Site rollout'a eklendi" });
  } catch (err) {
    console.error("ROLLOUT ADD SITE ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/rollout/update", authMiddleware, async (req, res) => {
  try {
    const data = req.body || {};
    if (!data.site_code) return res.status(400).json({ error: "site_code zorunlu" });

    const autoRegion   = getRegionFromSiteCode(data.site_code);
    const autoSiteType = getSiteTypeFromSiteCode(data.site_code);
    const autoCity     = getCityFromSiteCode(data.site_code);

    // Null-safe yardımcı — boş string ve undefined → null
    const v  = (k)  => (data[k] === "" || data[k] === undefined ? null : data[k]);
    // Tarih alanı — "Invalid Date" da null'a çevir
    const vd = (k)  => {
      const val = data[k];
      if (!val || val === "" || val === "__NA__") return null;
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    };

    const result = await pool.query(
      `INSERT INTO rollout_progress (
        site_code, site_type, bolge, il, project_code, site_physical_type, malzeme_status,
        -- RF
        rf_subcon,
        plan_start_date, installation_actual_start_date, installation_actual_end_date,
        onair_date, qc_closed_date, rf_not, atlas_status,
        -- LOS
        los_subcon, los_plan_date, los_actual_end_date,
        -- TSS
        tss_subcon, tss_plan_start_date, tss_actual_end_date,
        -- TSSR
        tssr_subcon, tssr_plan_start_date, tssr_actual_end_date,
        -- BTK/Survey
        btk_subcon, btk_plan_start_date, btk_actual_end_date, btk_approved,
        gs_status, survey_note,
        -- EMR
        emr_subcon, emr_plan_start_date, emr_actual_end_date,
        -- TRS
        trs_subcon, trs_plan_start_date, trs_actual_end_date, trs_not,
        -- ENH
        enh_subcon, enh_site_type, enh_plan_start_date, enh_actual_end_date, enh_not,
        -- ENH Proje
        enh_proje_subcon, enh_proje_hazir, enh_proje_not,
        -- POWER
        power_subcon, power_plan_start_date, power_actual_end_date,
        abonelik_actual_end_date, tt_horizon_actual_end_date,
        pac_actual_end_date, tamamlanma_tarihi,
        suzme_date, pac_subcon, pac_plan_date
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,$12,$13,$14,$15,
        $16,$17,$18,
        $19,$20,$21,
        $22,$23,$24,
        $25,$26,$27,$28,$29,$30,
        $31,$32,$33,
        $34,$35,$36,$37,
        $38,$39,$40,$41,$42,
        $43,$44,$45,
        $46,$47,$48,$49,$50,$51,$52,$53,$54,$55
      )
      ON CONFLICT (site_code) DO UPDATE SET
        site_type = EXCLUDED.site_type,
        bolge = EXCLUDED.bolge,
        il = EXCLUDED.il,
        project_code = EXCLUDED.project_code,
        site_physical_type = EXCLUDED.site_physical_type,
        malzeme_status = EXCLUDED.malzeme_status,
        rf_subcon = EXCLUDED.rf_subcon,
        plan_start_date = EXCLUDED.plan_start_date,
        installation_actual_start_date = EXCLUDED.installation_actual_start_date,
        installation_actual_end_date = EXCLUDED.installation_actual_end_date,
        onair_date = EXCLUDED.onair_date,
        qc_closed_date = EXCLUDED.qc_closed_date,
        rf_not = EXCLUDED.rf_not,
        atlas_status = EXCLUDED.atlas_status,
        los_subcon = EXCLUDED.los_subcon,
        los_plan_date = EXCLUDED.los_plan_date,
        los_actual_end_date = EXCLUDED.los_actual_end_date,
        tss_subcon = EXCLUDED.tss_subcon,
        tss_plan_start_date = EXCLUDED.tss_plan_start_date,
        tss_actual_end_date = EXCLUDED.tss_actual_end_date,
        tssr_subcon = EXCLUDED.tssr_subcon,
        tssr_plan_start_date = EXCLUDED.tssr_plan_start_date,
        tssr_actual_end_date = EXCLUDED.tssr_actual_end_date,
        btk_subcon = EXCLUDED.btk_subcon,
        btk_plan_start_date = EXCLUDED.btk_plan_start_date,
        btk_actual_end_date = EXCLUDED.btk_actual_end_date,
        btk_approved = EXCLUDED.btk_approved,
        gs_status = EXCLUDED.gs_status,
        survey_note = EXCLUDED.survey_note,
        emr_subcon = EXCLUDED.emr_subcon,
        emr_plan_start_date = EXCLUDED.emr_plan_start_date,
        emr_actual_end_date = EXCLUDED.emr_actual_end_date,
        trs_subcon = EXCLUDED.trs_subcon,
        trs_plan_start_date = EXCLUDED.trs_plan_start_date,
        trs_actual_end_date = EXCLUDED.trs_actual_end_date,
        trs_not = EXCLUDED.trs_not,
        enh_subcon = EXCLUDED.enh_subcon,
        enh_site_type = EXCLUDED.enh_site_type,
        enh_plan_start_date = EXCLUDED.enh_plan_start_date,
        enh_actual_end_date = EXCLUDED.enh_actual_end_date,
        enh_not = EXCLUDED.enh_not,
        enh_proje_subcon = EXCLUDED.enh_proje_subcon,
        enh_proje_hazir = EXCLUDED.enh_proje_hazir,
        enh_proje_not = EXCLUDED.enh_proje_not,
        power_subcon = EXCLUDED.power_subcon,
        power_plan_start_date = EXCLUDED.power_plan_start_date,
        power_actual_end_date = EXCLUDED.power_actual_end_date,
        abonelik_actual_end_date = EXCLUDED.abonelik_actual_end_date,
        tt_horizon_actual_end_date = EXCLUDED.tt_horizon_actual_end_date,
        pac_actual_end_date = EXCLUDED.pac_actual_end_date,
        tamamlanma_tarihi = EXCLUDED.tamamlanma_tarihi,
        suzme_date = EXCLUDED.suzme_date,
        pac_subcon = EXCLUDED.pac_subcon,
        pac_plan_date = EXCLUDED.pac_plan_date,
        updated_at = NOW()
      RETURNING *`,
      [
        /* 1-7  */ data.site_code, autoSiteType, autoRegion, autoCity, v("project_code"), v("site_physical_type"), v("malzeme_status"),
        /* 8-15 */ v("rf_subcon"), vd("plan_start_date"), vd("installation_actual_start_date"), vd("installation_actual_end_date"),
                   vd("onair_date"), vd("qc_closed_date"), v("rf_not"), v("atlas_status"),
        /* 16-18 */ v("los_subcon"), vd("los_plan_date"), vd("los_actual_end_date"),
        /* 19-21 */ v("tss_subcon"), vd("tss_plan_start_date"), vd("tss_actual_end_date"),
        /* 22-24 */ v("tssr_subcon"), vd("tssr_plan_start_date"), vd("tssr_actual_end_date"),
        /* 25-30 */ v("btk_subcon"), vd("btk_plan_start_date"), vd("btk_actual_end_date"), vd("btk_approved"), v("gs_status"), v("survey_note"),
        /* 31-33 */ v("emr_subcon"), vd("emr_plan_start_date"), vd("emr_actual_end_date"),
        /* 34-37 */ v("trs_subcon"), vd("trs_plan_start_date"), vd("trs_actual_end_date"), v("trs_not"),
        /* 38-42 */ v("enh_subcon"), v("enh_site_type"), vd("enh_plan_start_date"), vd("enh_actual_end_date"), v("enh_not"),
        /* 43-45 */ v("enh_proje_subcon"), vd("enh_proje_hazir"), v("enh_proje_not"),
        /* 46-55 */ v("power_subcon"), vd("power_plan_start_date"), vd("power_actual_end_date"),
                    vd("abonelik_actual_end_date"), vd("tt_horizon_actual_end_date"),
                    vd("pac_actual_end_date"), vd("tamamlanma_tarihi"), vd("suzme_date"),
                    v("pac_subcon"), vd("pac_plan_date"),
      ]
    );

    res.json({ ok: true, row: result.rows[0] });
  } catch (err) {
    console.error("ROLLOUT UPDATE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});
// Generic rollout belge signed URL (type: los, tssr, btk, emr, pac, enh_proje)
const ROLLOUT_BELGE_FIELDS = ["los_belge_url","tssr_belge_url","btk_belge_url","emr_belge_url","pac_belge_url","enh_proje_belge_url"];
app.get("/rollout/signed-upload-url", async (req, res) => {
  try {
    const { rolloutId, type, ext } = req.query;
    const safeType = String(type||"doc").replace(/[^a-z0-9_-]/g,"");
    const filePath = `rollout-belgeler/${safeType}/rollout-${rolloutId}-${Date.now()}.${(ext||"pdf").replace(/^\./, "")}`;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(filePath);
    if (error) throw error;
    const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(filePath).data.publicUrl;
    res.json({ signedUrl: data.signedUrl, path: filePath, publicUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Legacy enh-proje endpoint (backward compat)
app.get("/rollout/enh-proje/signed-upload-url", async (req, res) => {
  try {
    const { rolloutId, ext } = req.query;
    const filePath = `rollout-belgeler/enh_proje/rollout-${rolloutId}-${Date.now()}.${(ext||"pdf").replace(/^\./, "")}`;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(filePath);
    if (error) throw error;
    const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(filePath).data.publicUrl;
    res.json({ signedUrl: data.signedUrl, path: filePath, publicUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Generic belge-url save
app.post("/rollout/:id/belge-url", async (req, res) => {
  try {
    const { field, url } = req.body;
    if (!ROLLOUT_BELGE_FIELDS.includes(field)) return res.status(400).json({ error: "Geçersiz alan" });
    await pool.query(`UPDATE rollout_progress SET ${field}=$1 WHERE id=$2`, [url, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Legacy enh-proje belge url
app.post("/rollout/:id/enh-proje-belge-url", async (req, res) => {
  try {
    const { url } = req.body;
    await pool.query("UPDATE rollout_progress SET enh_proje_belge_url=$1 WHERE id=$2", [url, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/rollout/:id", authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;

    const result = await pool.query(
      `
      DELETE FROM rollout_progress
      WHERE id = $1
      RETURNING *
      `,
      [id],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        error: "Silinecek rollout kaydı bulunamadı",
      });
    }

    res.json({
      ok: true,
      message: "Rollout kaydı silindi",
      deleted: result.rows[0],
    });
  } catch (err) {
    console.error("ROLLOUT DELETE ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});
// silinecek geçici yüklendi//
app.get("/debug/rollout-last", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, bolge, site_type, project_code, site_code, il,
        malzeme_status,
        plan_start_date,
        installation_actual_start_date,
        installation_actual_end_date,
        onair_date,
        tssr_plan_start_date,
        tssr_actual_end_date,
        btk_plan_start_date,
        btk_actual_end_date,
        btk_approved,
        btk_certificate_date,
        power_plan_start_date,
        power_actual_end_date,
        enh_plan_start_date,
        enh_actual_end_date,
        abonelik_end_date,
        tt_horizon_end_date,
        pac_end_date,
        updated_at
      FROM rollout_progress
      ORDER BY id DESC
      LIMIT 50
    `);

    res.json({ ok: true, rows: result.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
// silinecek geçici yüklendi//
app.get("/debug/rollout-summary-raw", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT bolge, site_type, COUNT(*)::int AS count
      FROM rollout_progress
      GROUP BY bolge, site_type
      ORDER BY bolge, site_type
    `);

    res.json({ ok: true, rows: result.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/export/excel", async (req, res) => {
  try {
    const { region } = req.query;

    let query = `SELECT * FROM rollout_progress`;
    let values = [];

    if (region && region !== "ALL" && region !== "Tüm Bölgeler") {
      query += ` WHERE LOWER(COALESCE(bolge,'')) = LOWER($1)`;
      values.push(region);
    }

    query += ` ORDER BY bolge ASC, site_type ASC, site_code ASC`;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).send("Data yok");
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Rollout Data");

    // Sütun tanımları — section bilgisi ile genişletildi
    // section: veri satırlarında ilgili grup rengini vermek için kullanılır
    const COL_DEFS = [
      { header: "Bölge",           key: "bolge",                          width: 16,  section: "info" },
      { header: "Site Type",       key: "site_type",                      width: 14,  section: "info" },
      { header: "Site Fiziksel",   key: "site_physical_type",             width: 18,  section: "info" },
      { header: "Project Code",    key: "project_code",                   width: 18,  section: "info" },
      { header: "Site Code",       key: "site_code",                      width: 24,  section: "info" },
      { header: "Malzeme Status",  key: "malzeme_status",                 width: 16,  section: "info" },
      { header: "İl",              key: "il",                             width: 14,  section: "info" },
      // RF
      { header: "RF Subcon",                key: "rf_subcon",                       width: 20, section: "rf" },
      { header: "Plan Start Date",          key: "plan_start_date",                 width: 18, section: "rf" },
      { header: "Install Start Date",       key: "installation_actual_start_date",  width: 20, section: "rf" },
      { header: "Install End Date",         key: "installation_actual_end_date",    width: 20, section: "rf" },
      { header: "OnAir Date",               key: "onair_date",                      width: 18, section: "rf" },
      { header: "QC Closed Date",           key: "qc_closed_date",                  width: 18, section: "rf" },
      { header: "RF Not",                   key: "rf_not",                          width: 32, section: "rf" },
      // LOS
      { header: "LOS Subcon",       key: "los_subcon",          width: 20, section: "los" },
      { header: "LOS Plan Date",    key: "los_plan_date",        width: 18, section: "los" },
      { header: "LOS Actual End",   key: "los_actual_end_date",  width: 18, section: "los" },
      // TSS
      { header: "TSS Subcon",       key: "tss_subcon",           width: 20, section: "tss" },
      { header: "TSS Plan Start",   key: "tss_plan_start_date",  width: 18, section: "tss" },
      { header: "TSS Actual End",   key: "tss_actual_end_date",  width: 18, section: "tss" },
      // TSSR
      { header: "TSSR Subcon",      key: "tssr_subcon",          width: 20, section: "tssr" },
      { header: "TSSR Plan Start",  key: "tssr_plan_start_date", width: 18, section: "tssr" },
      { header: "TSSR Actual End",  key: "tssr_actual_end_date", width: 18, section: "tssr" },
      // BTK
      { header: "BTK Subcon",         key: "btk_subcon",          width: 20, section: "btk" },
      { header: "BTK Plan Start",     key: "btk_plan_start_date", width: 18, section: "btk" },
      { header: "BTK Actual End",     key: "btk_actual_end_date", width: 18, section: "btk" },
      { header: "BTK Approved",       key: "btk_approved",        width: 18, section: "btk" },
      { header: "GS Status",          key: "gs_status",           width: 14, section: "btk" },
      { header: "Survey Note",        key: "survey_note",         width: 32, section: "btk" },
      // ENH
      { header: "ENH Subcon",        key: "enh_subcon",           width: 20 },
      { header: "ENH Site Type",     key: "enh_site_type",         width: 16 },
      { header: "ENH Plan Start",    key: "enh_plan_start_date",   width: 18 },
      { header: "ENH Actual End",    key: "enh_actual_end_date",   width: 18 },
      { header: "ENH QC Closed",     key: "enh_qc_closed_date",    width: 18 },
      { header: "ENH Not",           key: "enh_not",               width: 32 },
      // POWER
      { header: "Power Subcon",      key: "power_subcon",          width: 20 },
      { header: "Power Plan Start",  key: "power_plan_start_date", width: 18 },
      { header: "Power Actual End",  key: "power_actual_end_date", width: 18 },
      { header: "Süzme Tarihi",      key: "suzme_date",            width: 18 },
      { header: "Abonelik End Date", key: "abonelik_end_date",      width: 22 },
      { header: "Horizon End Date",  key: "tt_horizon_end_date",   width: 20 },
      { header: "PAC Actual End",    key: "pac_end_date",           width: 18 },
    ];

    // Sütun genişliklerini doğrudan ata (header auto-row oluşturmaması için columns.header kullanma)
    COL_DEFS.forEach((col, idx) => {
      const wsCol = worksheet.getColumn(idx + 1);
      wsCol.key   = col.key;
      wsCol.width = col.width;
    });

    const lastColNum = COL_DEFS.length;
    const lastColLetter = worksheet.getColumn(lastColNum).letter;

    // Satır 1: Başlık (merged, koyu lacivert)
    const titleRow = worksheet.getRow(1);
    titleRow.height = 28;
    const titleCell = titleRow.getCell(1);
    titleCell.value = `ROLLOUT DATA RAPORU — ${region && region !== "ALL" ? region : "Tüm Bölgeler"} (${new Date().toLocaleDateString("tr-TR")})`;
    titleCell.font  = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    titleCell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: "FF203864" } };
    worksheet.mergeCells(1, 1, 1, lastColNum);

    // Satır 2: Sütun başlıkları — tek tip koyu lacivert (qc_ready formatı)
    const headerRow = worksheet.getRow(2);
    headerRow.height = 24;
    COL_DEFS.forEach((col, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = col.header;
      cell.font  = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: "FF203864" } };
      cell.border = {
        top:    { style: "thin",   color: { argb: "FFB7C9E2" } },
        left:   { style: "thin",   color: { argb: "FFB7C9E2" } },
        bottom: { style: "medium", color: { argb: "FFB7C9E2" } },
        right:  { style: "thin",   color: { argb: "FFB7C9E2" } },
      };
    });

    // Veri satırlarını ekle — tarihleri JS Date nesnesi olarak ver (Excel native date)
    const DATE_KEYS = new Set([
      "plan_start_date","installation_actual_start_date","installation_actual_end_date",
      "onair_date","qc_closed_date","los_plan_date","los_actual_end_date",
      "tss_plan_start_date","tss_actual_end_date","tssr_plan_start_date","tssr_actual_end_date",
      "btk_plan_start_date","btk_actual_end_date","btk_approved",
      "enh_plan_start_date","enh_actual_end_date","enh_qc_closed_date",
      "power_plan_start_date","power_actual_end_date","suzme_date",
      "abonelik_end_date","tt_horizon_end_date","pac_end_date",
    ]);
    const toDate = (v) => {
      if (!v) return "";
      const d = new Date(v);
      return isNaN(d.getTime()) ? String(v) : d;
    };

    result.rows.forEach((row) => {
      const rowObj = { ...row, site_type: getSiteTypeFromSiteCode(row.site_code) };
      DATE_KEYS.forEach(k => { if (k in rowObj) rowObj[k] = toDate(rowObj[k]); });
      const excelRow = worksheet.addRow(rowObj);
      // Tarih hücrelerine format uygula
      COL_DEFS.forEach((col, idx) => {
        if (DATE_KEYS.has(col.key)) {
          const cell = excelRow.getCell(idx + 1);
          if (cell.value instanceof Date) cell.numFmt = "dd.mm.yyyy";
        }
      });
    });

    // Veri satırları: tek tip alternatif renk (qc_ready formatı — #F8FAFC / beyaz)
    worksheet.eachRow((exRow, rowNumber) => {
      if (rowNumber < 3) return;
      const isOdd = (rowNumber - 2) % 2 !== 0; // veri satırı 1,3,5... = açık; 2,4,6... = beyaz
      COL_DEFS.forEach((col, idx) => {
        const cell = exRow.getCell(idx + 1);

        cell.fill = {
          type: "pattern", pattern: "solid",
          fgColor: { argb: isOdd ? "FFF8FAFC" : "FFFFFFFF" },
        };
        cell.border = {
          top:    { style:"hair", color:{ argb:"FFD1D5DB" } },
          left:   { style:"hair", color:{ argb:"FFD1D5DB" } },
          bottom: { style:"hair", color:{ argb:"FFD1D5DB" } },
          right:  { style:"hair", color:{ argb:"FFD1D5DB" } },
        };
        cell.alignment = { vertical:"middle", wrapText:false };

        // QC Closed / ENH QC Closed / Süzme — tarihi varsa yeşil bold
        if (col.key === "qc_closed_date" || col.key === "enh_qc_closed_date" || col.key === "suzme_date") {
          if (cell.value instanceof Date) {
            cell.font = { bold:true, color:{ argb:"FF15803D" } };
          }
        }
        // Malzeme Status OK → yeşil
        if (col.key === "malzeme_status") {
          const val = String(cell.value || "").toUpperCase();
          if (val === "OK") cell.font = { bold:true, color:{ argb:"FF15803D" } };
        }
        // Site type: arka plan rengi
        if (col.key === "site_type") {
          const val = String(cell.value || "").toUpperCase();
          const typeColors = { "DSS":"FFFDE9D9", "LTE":"FFDDEBF7", "5G":"FFE2EFDA", "STANDALONE":"FFFEF9C3" };
          if (typeColors[val]) {
            cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb: typeColors[val] } };
            cell.font = { bold:true };
          }
        }
      });
    });

    worksheet.views = [{ state:"frozen", ySplit:2, showGridLines:false }];
    worksheet.autoFilter = { from:"A2", to:`${lastColLetter}2` };

    const safeRegion = region && region !== "ALL" && region !== "Tüm Bölgeler" ? region : "ALL";
    const fileName = `rollout_${safeRegion}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("EXPORT ERROR:", err);
    res.status(500).send("Export hatası: " + err.message);
  }
});

app.get("/rollout/list", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM rollout_progress
      ORDER BY site_type ASC, site_code ASC
    `);

    const rows = (result.rows || []).map((r) => {
      const normalizedSiteType =
        getSiteTypeFromSiteCode(r.site_code) || r.site_type;

      const qcOk = String(r.qc_durum || "").toUpperCase() === "OK";

      const qcClosedDate = qcOk
        ? r.qc_closed_date || null
        : r.qc_closed_date || null;

      const installStart =
        r.installation_actual_start_date || r.plan_start_date || null;

      // Installation End Date: SADECE gerçek tarih varsa göster
      // (onair_date fallback kaldırıldı — iki ayrı kavram; biri bitmişken diğeri boş olabilir)
      const installEnd = r.installation_actual_end_date || null;

      const onairDate = r.onair_date || null;

      const malzemeStatus =
        qcOk || onairDate || installEnd || installStart
          ? r.malzeme_status || "OK"
          : r.malzeme_status || null;

      const passiveValue =
        normalizedSiteType === "5G" || normalizedSiteType === "LTE"
          ? "N/A"
          : null;

      return {
        ...r,
        site_type: normalizedSiteType,
        bolge: getRegionFromSiteCode(r.site_code) || r.bolge,

        installation_actual_start_date: installStart,
        installation_actual_end_date: installEnd,
        onair_date: onairDate,
        qc_closed_date: qcClosedDate,
        malzeme_status: malzemeStatus,

        los_subcon: passiveValue || r.los_subcon,
        los_plan_date: passiveValue || r.los_plan_date,
        los_actual_end_date: passiveValue || r.los_actual_end_date,

        trs_subcon: passiveValue || r.trs_subcon,
        trs_plan_start_date: passiveValue || r.trs_plan_start_date,
        trs_actual_end_date: passiveValue || r.trs_actual_end_date,
        trs_not: passiveValue || r.trs_not,

        enh_site_type: passiveValue || r.enh_site_type,
        enh_subcon: passiveValue || r.enh_subcon,
        enh_plan_start_date: passiveValue || r.enh_plan_start_date,
        enh_actual_end_date: passiveValue || r.enh_actual_end_date,
        enh_not: passiveValue || r.enh_not,

        power_subcon: passiveValue || r.power_subcon,
        power_plan_start_date: passiveValue || r.power_plan_start_date,
        power_actual_end_date: passiveValue || r.power_actual_end_date,

        plan_week: r.plan_start_date ? getWeekNumber(r.plan_start_date) : null,
        install_week: installStart ? getWeekNumber(installStart) : null,
        onair_week: onairDate ? getWeekNumber(onairDate) : null,
      };
    });

    res.json({ ok: true, rows });
  } catch (err) {
    console.error("ROLLOUT LIST ERROR:", err);
    res.status(500).json({
      ok: false,
      error: err.message || "Rollout listesi alınamadı",
    });
  }
});

// ── Clean Up endpoints ────────────────────────────────────────────────────────

// GET /rollout/cleanup - list all
app.get("/rollout/cleanup", authMiddleware, async (req, res) => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS rollout_cleanup (
      id SERIAL PRIMARY KEY, site_code TEXT NOT NULL UNIQUE,
      visit_date DATE, notification_date DATE, completion_date DATE,
      items JSONB DEFAULT '[]', notlar TEXT, screenshot_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    const r = await pool.query("SELECT * FROM rollout_cleanup ORDER BY updated_at DESC");
    res.json({ ok: true, rows: r.rows });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /rollout/cleanup - upsert
app.post("/rollout/cleanup", authMiddleware, async (req, res) => {
  try {
    const { site_code, visit_date, notification_date, completion_date, items, notlar, screenshot_url } = req.body;
    if (!site_code) return res.status(400).json({ ok: false, error: "site_code zorunlu" });
    await pool.query(`CREATE TABLE IF NOT EXISTS rollout_cleanup (
      id SERIAL PRIMARY KEY, site_code TEXT NOT NULL UNIQUE,
      visit_date DATE, notification_date DATE, completion_date DATE,
      items JSONB DEFAULT '[]', notlar TEXT, screenshot_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    const r = await pool.query(`
      INSERT INTO rollout_cleanup (site_code, visit_date, notification_date, completion_date, items, notlar, screenshot_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (site_code) DO UPDATE SET
        visit_date=EXCLUDED.visit_date, notification_date=EXCLUDED.notification_date,
        completion_date=EXCLUDED.completion_date, items=EXCLUDED.items,
        notlar=EXCLUDED.notlar, screenshot_url=COALESCE(EXCLUDED.screenshot_url, rollout_cleanup.screenshot_url),
        updated_at=NOW()
      RETURNING *
    `, [site_code, visit_date||null, notification_date||null, completion_date||null,
        JSON.stringify(items||[]), notlar||null, screenshot_url||null]);
    res.json({ ok: true, row: r.rows[0] });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// DELETE /rollout/cleanup/:id
app.delete("/rollout/cleanup/:id", authMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM rollout_cleanup WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /rollout/cleanup/:id/screenshot - upload screenshot
app.post("/rollout/cleanup/:id/screenshot", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "Dosya yok" });
    const fileName = `cleanup_${req.params.id}_${Date.now()}.${utf8Name(req.file.originalname).split('.').pop()}`;
    const { url } = await uploadToStorage("cleanup-screenshots", fileName, req.file.buffer, req.file.mimetype);
    await pool.query("UPDATE rollout_cleanup SET screenshot_url=$1, updated_at=NOW() WHERE id=$2", [url, req.params.id]);
    res.json({ ok: true, url });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────

app.get("/rollout/summary", async (req, res) => {
  try {
    const region = req.query.region || "ALL";

    const whereRegion =
      region === "ALL" ? "" : "WHERE LOWER(COALESCE(bolge, '')) = LOWER($1)";

    const params = region === "ALL" ? [] : [region];

    const result = await pool.query(
      `
      SELECT
        CASE
          WHEN UPPER(COALESCE(site_type, '')) = 'STANDALONE' THEN 'Standalone'
          ELSE COALESCE(site_type, 'UNKNOWN')
        END AS site_type,

        COUNT(*)::int AS target,

        COUNT(*) FILTER (
          WHERE COALESCE(malzeme_status, '') <> ''
             OR qc_durum = 'OK'
             OR installation_actual_start_date IS NOT NULL
             OR installation_actual_end_date IS NOT NULL
             OR onair_date IS NOT NULL
             OR qc_closed_date IS NOT NULL
        )::int AS rf_equipment_received,

        COUNT(*) FILTER (
          WHERE installation_actual_start_date IS NOT NULL
             OR plan_start_date IS NOT NULL
        )::int AS rf_installation_started,

        COUNT(*) FILTER (
          WHERE installation_actual_end_date IS NOT NULL
             OR onair_date IS NOT NULL
             OR qc_closed_date IS NOT NULL
             OR qc_durum = 'OK'
        )::int AS rf_installation_finished,

        COUNT(*) FILTER (
          WHERE qc_closed_date IS NOT NULL
             OR qc_durum = 'OK'
        )::int AS qc_closed,

        COUNT(*) FILTER (
          WHERE pac_actual_end_date IS NOT NULL
             OR pac_end_date IS NOT NULL
             OR abonelik_actual_end_date IS NOT NULL
             OR abonelik_end_date IS NOT NULL
        )::int AS acceptance,

        COUNT(*) FILTER (WHERE tssr_plan_start_date IS NOT NULL)::int AS tssr_plan_start,
        COUNT(*) FILTER (WHERE tssr_actual_end_date IS NOT NULL)::int AS tssr_actual_end,
        COUNT(*) FILTER (WHERE btk_plan_start_date IS NOT NULL)::int AS btk_plan_start,
        COUNT(*) FILTER (WHERE btk_actual_end_date IS NOT NULL)::int AS btk_actual_end,
        COUNT(*) FILTER (WHERE btk_approved IS NOT NULL)::int AS btk_approved,
        COUNT(*) FILTER (WHERE btk_certificate_date IS NOT NULL)::int AS btk_certificate_date,

        COUNT(*) FILTER (WHERE power_plan_start_date IS NOT NULL)::int AS power_plan_start,
        COUNT(*) FILTER (WHERE power_actual_end_date IS NOT NULL)::int AS power_actual_end,
        COUNT(*) FILTER (WHERE enh_plan_start_date IS NOT NULL)::int AS enh_plan_start,
        COUNT(*) FILTER (WHERE enh_actual_end_date IS NOT NULL)::int AS enh_actual_end,
        COUNT(*) FILTER (WHERE enh_qc_closed_date IS NOT NULL)::int AS enh_qc_closed,
        COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(enh_site_type,''))) LIKE '%süzme%')::int AS suzme,
        COUNT(*) FILTER (
          WHERE abonelik_actual_end_date IS NOT NULL
             OR abonelik_end_date IS NOT NULL
        )::int AS abonelik_end,

        -- PO Closed: po_rows tablosunda bu site için tüm kalemlerin due_qty = 0 ise kapalı
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM po_rows sp
            WHERE UPPER(TRIM(sp.site_code)) = UPPER(TRIM(rollout_progress.site_code))
          )
          AND NOT EXISTS (
            SELECT 1 FROM po_rows sp2
            WHERE UPPER(TRIM(sp2.site_code)) = UPPER(TRIM(rollout_progress.site_code))
            AND COALESCE(sp2.due_qty, 0) > 0
          )
        )::int AS po_closed

      FROM rollout_progress
      ${whereRegion}
      GROUP BY
        CASE
          WHEN UPPER(COALESCE(site_type, '')) = 'STANDALONE' THEN 'Standalone'
          ELSE COALESCE(site_type, 'UNKNOWN')
        END
      ORDER BY site_type
      `,
      params,
    );

    res.json({ ok: true, rows: result.rows || [] });
  } catch (err) {
    console.error("ROLLOUT SUMMARY ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// silinecek test //
app.get("/test", (req, res) => {
  res.send("OK");
});

app.post("/update-row-note", async (req, res) => {
  try {
    const { project_code, site_code, item_code, qc_durum, note, kabul_not } =
      req.body;

    await pool.query(
      `
      UPDATE master_works
      SET 
        qc_durum = $1,
        note = $2,
        kabul_not = $3
      WHERE 
        project_code = $4
        AND site_code = $5
        AND item_code = $6
      `,
      [qc_durum, note, kabul_not, project_code, site_code, item_code],
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "update error" });
  }
});

app.post("/import/archive-restore", upload.single("file"), async (req, res) => {
  const client = await pool.connect();

  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Dosya yok" });
    }

    const workbook = XLSX.read(req.file.buffer, { cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

    if (!rows.length) {
      return res.status(400).json({ ok: false, error: "Excel boş" });
    }

    await client.query("BEGIN");

    let masterInserted = 0;
    let masterUpdated = 0;
    let poInserted = 0;

    for (const r of rows) {
      const siteType =
        getCell(r, ["Saha Türü", "Site Type", "site_type"]) || "5G";
      const projectCode = getCell(r, ["Project Code", "project_code"]);
      const siteCode = getCell(r, ["Site Code", "site_code"]);
      const itemCode = getCell(r, ["Item Code", "item_code"]);
      const itemDescription = getCell(r, [
        "Item Description",
        "item_description",
      ]);
      const doneQty = getCell(r, ["Done Qty", "done_qty"]);
      const requestedQty = getCell(r, ["Requested Qty", "requested_qty"]);
      const dueQty = getCell(r, ["Due Qty", "due_qty"]);
      const billedQty = getCell(r, [
        "Billed Quantity",
        "Billed Qty",
        "billed_qty",
      ]);
      const qcDurum = getCell(r, ["QC Durum", "qc_durum"]) || "NOK";
      const onAirDate = getCell(r, ["OnAir Date", "onair_date"]);
      const subconName = getCell(r, ["Subcon Name", "subcon_name", "Taşeron"]);
      const note = getCell(r, ["RF Not", "Not", "Note", "note"]);
      const kabulNot = getCell(r, ["Kabul Not", "kabul_not"]);

      const normalizedSiteCode = siteCode
        ? String(siteCode).replace(/\s+/g, "").toUpperCase()
        : "";
      const normalizedItemCode = itemCode ? String(itemCode).trim() : "";
      const normalizedProjectCode = projectCode
        ? String(projectCode).trim()
        : "";

      if (!normalizedSiteCode || !normalizedItemCode) continue;

      const existingMaster = await client.query(
        `
        SELECT id
        FROM master_works
        WHERE TRIM(COALESCE(project_code, '')) = TRIM($1)
          AND UPPER(TRIM(COALESCE(site_code, ''))) = UPPER(TRIM($2))
          AND TRIM(COALESCE(item_code, '')) = TRIM($3)
        LIMIT 1
        `,
        [normalizedProjectCode, normalizedSiteCode, normalizedItemCode],
      );

      if (existingMaster.rowCount > 0) {
        await client.query(
          `
          UPDATE master_works
          SET
            site_type = $1,
            item_description = $2,
            done_qty = $3,
            subcon_name = $4,
            onair_date = $5,
            qc_durum = $6,
            note = $7,
            kabul_not = $8
          WHERE id = $9
          `,
          [
            String(siteType).trim(),
            itemDescription ? String(itemDescription).trim() : null,
            parseNumber(doneQty),
            subconName ? String(subconName).trim() : null,
            parseExcelDate(onAirDate),
            String(qcDurum).trim(),
            note ? String(note).trim() : null,
            kabulNot ? String(kabulNot).trim() : null,
            existingMaster.rows[0].id,
          ],
        );

        masterUpdated++;
      } else {
        await client.query(
          `
          INSERT INTO master_works (
            site_type,
            project_code,
            site_code,
            item_code,
            item_description,
            done_qty,
            subcon_name,
            onair_date,
            qc_durum,
            note,
            kabul_not
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          `,
          [
            String(siteType).trim(),
            normalizedProjectCode || null,
            normalizedSiteCode,
            normalizedItemCode,
            itemDescription ? String(itemDescription).trim() : null,
            parseNumber(doneQty),
            subconName ? String(subconName).trim() : null,
            parseExcelDate(onAirDate),
            String(qcDurum).trim(),
            note ? String(note).trim() : null,
            kabulNot ? String(kabulNot).trim() : null,
          ],
        );

        masterInserted++;
      }

      const hasPoData =
        Number(parseNumber(requestedQty)) > 0 ||
        Number(parseNumber(dueQty)) > 0 ||
        Number(parseNumber(billedQty)) > 0;

      if (hasPoData) {
        const existingPo = await client.query(
          `
          SELECT id
          FROM po_rows
          WHERE TRIM(COALESCE(project_code, '')) = TRIM($1)
            AND UPPER(TRIM(COALESCE(site_code, ''))) = UPPER(TRIM($2))
            AND TRIM(COALESCE(item_code, '')) = TRIM($3)
          LIMIT 1
          `,
          [normalizedProjectCode, normalizedSiteCode, normalizedItemCode],
        );

        if (existingPo.rowCount > 0) {
          await client.query(
            `
            UPDATE po_rows
            SET
              item_description = $1,
              requested_qty = $2,
              due_qty = $3,
              billed_qty = $4
            WHERE id = $5
            `,
            [
              itemDescription ? String(itemDescription).trim() : null,
              parseNumber(requestedQty),
              parseNumber(dueQty),
              parseNumber(billedQty),
              existingPo.rows[0].id,
            ],
          );
        } else {
          await client.query(
            `
            INSERT INTO po_rows (
              project_code,
              site_code,
              item_code,
              item_description,
              requested_qty,
              due_qty,
              billed_qty,
              currency,
              unit_price,
              upload_batch
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            `,
            [
              normalizedProjectCode || null,
              normalizedSiteCode,
              normalizedItemCode,
              itemDescription ? String(itemDescription).trim() : null,
              parseNumber(requestedQty),
              parseNumber(dueQty),
              parseNumber(billedQty),
              "TRY",
              0,
              req.file.filename,
            ],
          );

          poInserted++;
        }
      }
    }

    await client.query("COMMIT");

    res.json({
      ok: true,
      sheet_name: sheetName,
      masterInserted,
      masterUpdated,
      poInserted,
      message: "Arşiv Excel güvenli şekilde geri yüklendi",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("ARCHIVE RESTORE ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

/* ================== BOQ UPLOAD ================== */
app.post("/boq/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Dosya yok" });
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS boq_items (
        id SERIAL PRIMARY KEY,
        s_bom_code TEXT,
        boq_items_en TEXT,
        currency TEXT,
        unit_price NUMERIC,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const workbook = XLSX.read(req.file.buffer);

    const sheetName =
      workbook.SheetNames.find(
        (name) => String(name).trim().toLowerCase() === "boq item",
      ) || workbook.SheetNames[0];

    if (!sheetName) {
      return res.status(400).json({
        ok: false,
        error: "Excel içinde sheet bulunamadı",
      });
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

    if (!rows || rows.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Excel içinde veri bulunamadı",
      });
    }

    await pool.query(`DELETE FROM boq_items`);

    let inserted = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];

      const leftCode = row[0];
      const leftDesc = row[1];
      const leftCurrency = row[2];

      const rightCode = row[5];
      const rightDesc = row[6];
      const rightCurrency = row[7];
      const rightUnitPrice = row[8];

      if (leftCode && leftDesc) {
        await pool.query(
          `
          INSERT INTO boq_items (s_bom_code, boq_items_en, currency, unit_price)
          VALUES ($1, $2, $3, $4)
          `,
          [
            String(leftCode).trim(),
            String(leftDesc).trim(),
            normalizeCurrency(leftCurrency),
            null,
          ],
        );
        inserted++;
      }

      if (rightCode && rightDesc) {
        await pool.query(
          `
          INSERT INTO boq_items (s_bom_code, boq_items_en, currency, unit_price)
          VALUES ($1, $2, $3, $4)
          `,
          [
            String(rightCode).trim(),
            String(rightDesc).trim(),
            normalizeCurrency(rightCurrency),
            parseNumber(rightUnitPrice),
          ],
        );
        inserted++;
      }
    }

    return res.json({
      ok: true,
      message: "BoQ başarıyla yüklendi",
      inserted,
      sheet_name: sheetName,
    });
  } catch (err) {
    console.error("BOQ UPLOAD ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "BoQ upload sırasında hata oluştu",
    });
  }
});

/* ================== PERSONEL MASTER EXCEL UPLOAD ================== */
app.post(
  "/finance/personel/upload",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: "Dosya yok" });
      }

      const workbook = XLSX.read(req.file.buffer);
      const firstSheetName = workbook.SheetNames[0];

      if (!firstSheetName) {
        return res
          .status(400)
          .json({ ok: false, error: "Excel içinde sheet bulunamadı" });
      }

      const sheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

      if (!rows.length) {
        return res
          .status(400)
          .json({ ok: false, error: "Excel içinde veri bulunamadı" });
      }

      await pool.query(`DELETE FROM personel_cards`);

      let inserted = 0;

      for (const r of rows) {
        const adSoyad = getCell(r, [
          "Ad Soyad",
          "ad_soyad",
          "Personel",
          "AdSoyad",
          "Name Surname",
        ]);

        const unvan = getCell(r, ["Ünvan", "unvan", "Title"]);

        const bolge = getCell(r, ["Bölge", "bolge", "Region"]);

        const netMaas = getCell(r, [
          "Net Maaş",
          "net_maas",
          "Net Maas",
          "Salary",
        ]);

        const bankaNetMaas = getCell(r, [
          "Bankaya Yatacak Net",
          "banka_net_maas",
          "Banka Net",
          "Banka Maaş",
        ]);

        const eldenNetMaas = getCell(r, [
          "Elden Ödenecek Net",
          "elden_net_maas",
          "Elden Net",
        ]);

        const aylikIsverenMaliyeti = getCell(r, [
          "Toplam İşveren Maliyeti",
          "aylik_isveren_maliyeti",
          "İşveren Maliyeti",
          "Isveren Maliyeti",
        ]);

        if (!adSoyad) continue;

        await pool.query(
          `
        INSERT INTO personel_cards
        (
          ad_soyad,
          unvan,
          bolge,
          net_maas,
          banka_net_maas,
          elden_net_maas,
          aylik_isveren_maliyeti,
          aktif
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `,
          [
            String(adSoyad).trim(),
            unvan ? String(unvan).trim() : null,
            bolge ? String(bolge).trim() : null,
            parseNumber(netMaas),
            parseNumber(bankaNetMaas),
            parseNumber(eldenNetMaas),
            parseNumber(aylikIsverenMaliyeti),
            true,
          ],
        );

        inserted++;
      }

      res.json({
        ok: true,
        inserted,
        message: "Personel listesi başarıyla yüklendi",
        sheet_name: firstSheetName,
      });
    } catch (err) {
      console.error("PERSONEL UPLOAD ERROR:", err.message);
      res.status(500).json({
        ok: false,
        error: err.message || "Personel listesi yüklenemedi",
      });
    }
  },
);

/* ================== MASTER ADD ================== */
app.get("/export/site-entry-excel-all", async (req, res) => {
  try {
    const result = await pool.query(
      buildMasterJoinedQuery("", "ORDER BY m.created_at DESC, m.id DESC"),
    );

    const rows = result.rows || [];

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Tum_Isler");

    sheet.columns = [
      { header: "Saha Türü", key: "site_type", width: 14 },
      { header: "Bölge", key: "region", width: 14 },
      { header: "Status", key: "status", width: 14 },
      { header: "Analiz", key: "analysis", width: 14 },
      { header: "Project Code", key: "project_code", width: 16 },
      { header: "Site Code", key: "site_code", width: 20 },
      { header: "Item Code", key: "item_code", width: 16 },
      { header: "Item Description", key: "item_description", width: 45 },
      { header: "Done Qty", key: "done_qty", width: 12 },
      { header: "Requested Qty", key: "requested_qty", width: 14 },
      { header: "Due Qty", key: "due_qty", width: 12 },
      { header: "Billed Quantity", key: "billed_qty", width: 14 },
      { header: "QC Durum", key: "qc_durum", width: 12 },
      { header: "OnAir Date", key: "onair_date", width: 14 },
      { header: "Subcon Name", key: "subcon_name", width: 18 },
      { header: "RF Not", key: "note", width: 35 },
      { header: "Kabul Not", key: "kabul_not", width: 35 },
    ];

    rows.forEach((row) => {
      const detectedSiteType = detectSiteTypeFromSiteCode(row.site_code || "");
      const region = getRegion(row.site_code || "", row.project_code || "");
      const analysis =
        String(row.status || "").toUpperCase() === "PO_BEKLER"
          ? "Eksik"
          : Number(row.done_qty || 0) === 0
            ? "Giriş Yok"
            : Number(row.done_qty || 0) === Number(row.requested_qty || 0)
              ? "Tamam"
              : Number(row.done_qty || 0) > Number(row.requested_qty || 0)
                ? "Fazla"
                : "Eksik";

      sheet.addRow({
        site_type: detectedSiteType,
        region,
        status: row.status || "",
        analysis,
        project_code: row.project_code || "",
        site_code: row.site_code || "",
        item_code: row.item_code || "",
        item_description: row.item_description || "",
        done_qty: row.done_qty ?? "",
        requested_qty: row.requested_qty ?? "",
        due_qty: row.due_qty ?? "",
        billed_qty: row.billed_qty ?? "",
        qc_durum: row.qc_durum || "",
        onair_date: row.onair_date
          ? new Date(row.onair_date).toLocaleDateString("tr-TR")
          : "",
        subcon_name: row.subcon_name || "",
        note: row.note || "",
        kabul_not: row.kabul_not || "",
      });
    });

    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
      from: "A1",
      to: "Q1",
    };

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=site_entries_all_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
    applyPremiumExcelStyle(sheet, {
      headerRowNumber: 1,
      freezeRow: 1,
      filterFrom: "A1",
      filterTo: "Q1",
      statusColumn: "C",
    });
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("EXPORT ALL SITE ENTRIES ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/export/qc-ready-excel", async (req, res) => {
  function safeFileName(value) {
    return String(value || "")
      .trim()
      .replace(/İ/g, "I")
      .replace(/I/g, "I")
      .replace(/ı/g, "i")
      .replace(/Ş/g, "S")
      .replace(/ş/g, "s")
      .replace(/Ğ/g, "G")
      .replace(/ğ/g, "g")
      .replace(/Ü/g, "U")
      .replace(/ü/g, "u")
      .replace(/Ö/g, "O")
      .replace(/ö/g, "o")
      .replace(/Ç/g, "C")
      .replace(/ç/g, "c")
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_-]/g, "");
  }

  try {
    const usdRate = await getTcmbUsdTrySellingRate();
    const region = String(req.query.region || "")
      .trim()
      .toLowerCase();
    const type = String(req.query.type || "").trim(); // "80", "20_fac_ok", "20_fac_nok"

    const subcon = String(req.query.subcon || "")
      .trim()
      .toLowerCase();

    const result = await pool.query(buildMasterJoinedQuery());

    const allRows = (result.rows || []).map((row) => ({
      ...row,
      currency: normalizeCurrency(row.currency),
    }));

    const filteredRows = allRows.filter((row) => {
      const rowRegion = String(
        getRegion(row.site_code, row.project_code) || "",
      ).toLowerCase();

      if (rowRegion !== region) return false;

      const rowSubcon = String(row.subcon_name || "")
        .trim()
        .toLowerCase();

      if (subcon && rowSubcon !== subcon) return false;

      const statusOk = String(row.status || "").toUpperCase() === "OK";
      const qcOk = String(row.qc_durum || "").toUpperCase() === "OK";
      const kabulOk = String(row.kabul_durum || "").toUpperCase() === "OK";
      const billedZero = Number(row.billed_qty ?? row.billed ?? 0) === 0;

      const reqQty = Number(row.requested_qty || 0);
      const dueQty = Number(row.due_qty || 0);
      const diff = reqQty - dueQty;
      const progressedQty = diff;

      if (type === "80") {
        // Fiziki tamamlanan boş/0 ise iş sahada yapılmamıştır — listeye girmez
        // (ekrandaki QC OK Fatura Kesilecek %80 kuralıyla birebir)
        if (Number(row.tamamlanan_qty || 0) <= 0) return false;
        return statusOk && qcOk && billedZero && diff === 0;
      }

      if (type === "20_fac_ok") {
        // QC OK şartı: QC kapanmadan fatura kesilemez (IZ2683 vakası).
        // due_qty>0: faturası tamamlanmış kalem listelenmez — frontend ile birebir.
        if (!qcOk) return false;
        if (row.pac_from_rollout) return Number(row.done_qty || 0) > 0 && dueQty > 0;
        return statusOk && progressedQty > 0 && dueQty > 0 && kabulOk;
      }

      if (type === "20_fac_nok") {
        // PAC OK sahaları NOK'a dahil edilmez (frontend ile birebir).
        if (row.pac_from_rollout) return false;
        return statusOk && progressedQty > 0 && !kabulOk;
      }

      return false;
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("QC_Ready");

    sheet.columns = [
      { header: "Project", key: "project_code", width: 16 },
      { header: "Site", key: "site_code", width: 22 },
      { header: "Item", key: "item_code", width: 16 },
      { header: "Açıklama", key: "item_description", width: 45 },
      { header: "Req", key: "requested_qty", width: 10 },
      { header: "Due", key: "due_qty", width: 10 },
      { header: "Done", key: "done_qty", width: 10 },
      { header: "Currency", key: "currency", width: 10 },
      { header: "Unit Price", key: "unit_price", width: 14 },
      { header: "QC Durum", key: "qc_durum", width: 12 },
      { header: "Kabul Durum", key: "kabul_durum", width: 12 },
      { header: "Taşeron", key: "subcon_name", width: 18 },
      { header: "OnAir", key: "onair_date", width: 14 },
      { header: "RF Not", key: "note", width: 28 },
      { header: "Kabul Not", key: "kabul_not", width: 28 },
      { header: "Raw Total", key: "raw_total", width: 16 },
      { header: "Shown Total", key: "shown_total", width: 16 },
    ];

    filteredRows.forEach((row) => {
      const currency = normalizeCurrency(row.currency);
      const rawBase =
        Number(row.total_done_amount || row.total_amount || row.total || 0) ||
        Number(row.done_qty || 0) * Number(row.unit_price || 0);

      const rawTotal = currency === "USD" ? rawBase * usdRate : rawBase;

      let shownTotal = 0;

      if (type === "80") {
        shownTotal = rawTotal * 0.8;
      } else if (type === "20_fac_ok" || type === "20_fac_nok") {
        // PAC satırları: done_qty × unit_price; klasik kabul satırları: due_qty × unit_price (frontend ile birebir).
        const facQty = row.pac_from_rollout ? Number(row.done_qty || 0) : Number(row.due_qty || 0);
        const facBase = facQty * Number(row.unit_price || 0);

        shownTotal = currency === "USD" ? facBase * usdRate : facBase;
      }

      sheet.addRow({
        project_code: row.project_code || "",
        site_code: row.site_code || "",
        item_code: row.item_code || "",
        item_description: row.item_description || "",
        requested_qty: row.requested_qty ?? "",
        due_qty: row.due_qty ?? "",
        done_qty: row.done_qty ?? "",
        currency: "TRY" /* USD tutarlar TL'ye çevrildi */,
        unit_price: Number(row.unit_price || 0),
        qc_durum: row.qc_durum || "",
        kabul_durum: row.kabul_durum || "",
        subcon_name: row.subcon_name || "",
        onair_date: row.onair_date
          ? new Date(row.onair_date).toLocaleDateString("tr-TR")
          : "",
        note: row.note || "",
        kabul_not: row.kabul_not || "",
        raw_total: rawTotal,
        shown_total: shownTotal,
      });
    });

    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
      from: "A1",
      to: "Q1",
    };

    const safeRegion = safeFileName(region);
    const safeType = safeFileName(type);

    res.attachment("qc_ready_export.xlsx");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    applyPremiumExcelStyle(sheet, {
      headerRowNumber: 1,
      freezeRow: 1,
      filterFrom: "A1",
      filterTo: "Q1",
      statusColumn: "J",
    });
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("QC READY EXCEL EXPORT ERROR:", err);
    res.status(500).send(`Excel oluşturulamadı: ${err.message}`);
  }
});

app.post("/master/add", async (req, res) => {
  try {
    const m = req.body;

    console.log("MASTER ADD GELDI:", {
      project_code: m.project_code,
      site_code: m.site_code,
      item_code: m.item_code,
    });

    const projectCode = String(m.project_code || "").trim();
    // Saha kodunda boşluk olamaz: "MU3848 _NS_AE" gibi girişler HW mutabakat
    // exportuna boşluklu gidiyordu — TÜM boşluklar silinir
    const siteCode = String(m.site_code || "")
      .replace(/\s+/g, "")
      .toUpperCase();
    const itemCode = String(m.item_code || "").trim();

    // Item Code zorunlu — kodsuz kayıt fiyat/PO/QC eşleşmesine giremez
    if (!itemCode) {
      return res.status(400).json({ ok: false, error: "Item Code zorunludur — listeden bir kalem seçin" });
    }

    console.log("DUPLICATE CHECK BASLIYOR");

    const duplicateCheck = await pool.query(
      `
      SELECT id
      FROM master_works
      WHERE project_code = $1
        AND site_code = $2
        AND item_code = $3
      LIMIT 1
      `,
      [projectCode, siteCode, itemCode],
    );

    console.log("DUPLICATE CHECK BITTI:", duplicateCheck.rows.length);

    // Tamamlanan (fiziki) miktar: boş gönderildiyse NULL kalır (= done kabul edilir)
    const tamamlananQty =
      m.tamamlanan_qty === undefined || m.tamamlanan_qty === null || m.tamamlanan_qty === ""
        ? null
        : parseNumber(m.tamamlanan_qty);

    if (duplicateCheck.rows.length > 0) {
      await pool.query(
        `
        UPDATE master_works
        SET
          done_qty = $1,
          tamamlanan_qty = $2,
          subcon_name = $3,
          onair_date = $4,
          qc_durum = $5,
          kabul_durum = $6,
          kabul_not = $7,
          note = $8
        WHERE
          project_code = $9
          AND site_code = $10
          AND item_code = $11
        `,
        [
          parseNumber(m.done_qty),
          tamamlananQty,
          m.subcon_name ? String(m.subcon_name).trim() : null,
          parseExcelDate(m.onair_date),
          m.qc_durum || "NOK",
          m.kabul_durum || "NOK",
          m.kabul_not ? String(m.kabul_not).trim() : null,
          m.note ? String(m.note).trim() : null,
          projectCode,
          siteCode,
          itemCode,
        ],
      );

      return res.json({
        ok: true,
        message: "Kayıt güncellendi",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO master_works
      (
        site_type,
        project_code,
        site_code,
        item_code,
        item_description,
        done_qty,
        tamamlanan_qty,
        subcon_name,
        onair_date,
        note,
        qc_durum,
        kabul_durum,
        kabul_not
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
      `,
      [
        m.site_type || "5G",
        projectCode,
        siteCode,
        itemCode,
        m.item_description ? String(m.item_description).trim() : null,
        parseNumber(m.done_qty),
        tamamlananQty,
        m.subcon_name ? String(m.subcon_name).trim() : null,
        parseExcelDate(m.onair_date),
        m.note ? String(m.note).trim() : null,
        m.qc_durum || "NOK",
        m.kabul_durum || "NOK",
        m.kabul_not ? String(m.kabul_not).trim() : null,
      ],
    );

    setImmediate(async () => {
      try {
        const syncResult = await syncRolloutTargets([siteCode]);
        console.log("BACKGROUND ROLLOUT SYNC OK:", syncResult);
      } catch (err) {
        console.error("BACKGROUND ROLLOUT SYNC ERROR:", err.message);
      }
    });

    const syncResult = {
      background: true,
      site_code: siteCode,
    };

    res.json({
      ok: true,
      data: result.rows[0],
      rolloutSync: syncResult,
    });
  } catch (err) {
    console.error("MASTER ADD ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== MASTER UPDATE ================== */

app.put("/finance/invoice-entry/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      bolge,
      proje,
      proje_kodu,
      fatura_no,
      fatura_tarihi,
      odeme_tarihi,
      tedarikci,
      rf_montaj_firma,
      fatura_kalemi,
      is_kalemi,
      po_no,
      site_id,
      tutar,
      kdv,
      toplam_tutar,
      odenen_tutar,
      kalan_borc,
      note,
      currency,
      usd_kur,
      firma, // ŞİMŞEK (SIMSEK) veya AHY — AHY taşeron panelinde görünür
    } = req.body;

    const result = await pool.query(
      `
      UPDATE invoice_entries
      SET
        bolge = $1,
        proje = $2,
        proje_kodu = $3,
        fatura_no = $4,
        fatura_tarihi = $5,
        odeme_tarihi = $6,
        tedarikci = $7,
        rf_montaj_firma = $8,
        fatura_kalemi = $9,
        is_kalemi = $10,
        po_no = $11,
        site_id = $12,
        tutar = $13,
        kdv = $14,
        toplam_tutar = $15,
        odenen_tutar = $16,
        kalan_borc = $17,
        note = $18,
        currency = $19,
        usd_kur = $20,
        firma = COALESCE($21, firma)
      WHERE id = $22
      RETURNING *
      `,
      [
        bolge || null,
        proje || null,
        proje_kodu || null,
        fatura_no || null,
        fatura_tarihi || null,
        odeme_tarihi || null,
        tedarikci || null,
        rf_montaj_firma || null,
        fatura_kalemi || null,
        is_kalemi || null,
        po_no || null,
        site_id || null,
        Number(tutar || 0),
        Number(kdv || 0),
        Number(toplam_tutar || 0),
        Number(odenen_tutar || 0),
        Number(kalan_borc || 0),
        note || null,
        currency || 'TRY',
        Number(usd_kur || 1),
        firma ? (String(firma).toUpperCase() === "AHY" ? "AHY" : "SIMSEK") : null,
        id,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Kayıt bulunamadı" });
    }

    res.json({ ok: true, row: result.rows[0] });
  } catch (err) {
    console.error("INVOICE ENTRY UPDATE ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.put("/master/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const m = req.body;

    const result = await pool.query(
      `
      UPDATE master_works
      SET
        site_type = $1,
        project_code = $2,
        site_code = $3,
        item_code = $4,
        item_description = $5,
        done_qty = $6,
        tamamlanan_qty = $7,
        subcon_name = $8,
        onair_date = $9,
        note = $10,
        qc_durum = $11,
        kabul_durum = $12,
        kabul_not = $13
      WHERE id = $14
      RETURNING *
      `,
      [
        m.site_type || "5G",
        m.project_code ? String(m.project_code).trim() : null,
        m.site_code ? String(m.site_code).trim().toUpperCase() : null,
        m.item_code ? String(m.item_code).trim() : null,
        m.item_description ? String(m.item_description).trim() : null,
        parseNumber(m.done_qty),
        m.tamamlanan_qty === undefined || m.tamamlanan_qty === null || m.tamamlanan_qty === ""
          ? null
          : parseNumber(m.tamamlanan_qty),
        m.subcon_name ? String(m.subcon_name).trim() : null,
        parseExcelDate(m.onair_date),
        m.note ? String(m.note).trim() : null,
        m.qc_durum || "NOK",
        m.kabul_durum || "NOK",
        m.kabul_not ? String(m.kabul_not).trim() : null,
        id,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Kayıt bulunamadı" });
    }

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error("MASTER UPDATE ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== MASTER DELETE ================== */
app.delete("/master/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const result = await pool.query(
      `DELETE FROM master_works WHERE id = $1 RETURNING id`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Kayıt bulunamadı" });
    }

    res.json({ ok: true, message: "Kayıt silindi" });
  } catch (err) {
    console.error("MASTER DELETE ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// geçici silinecek
app.get("/test-login", (req, res) => {
  res.json({ ok: true, message: "login endpoint çalışıyor" });
});

/* ================== PO DASHBOARD SUMMARY ================== */
app.get("/dashboard/summary", authMiddleware, async (req, res) => {
  try {
    const isAdmin = req.user?.role === "admin";
    const subconName = req.user?.subcon_name || null;

    console.log("SUMMARY USER DEBUG:", req.user);
    console.log("SUMMARY ADMIN DEBUG:", isAdmin);
    console.log("SUMMARY SUBCON DEBUG:", subconName);

    const result = await fetchData(isAdmin, subconName);

    res.json({ ok: true, summary: result });
  } catch (err) {
    console.error("SUMMARY ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

async function fetchData(isAdmin, subconName) {
  let query = buildMasterJoinedQuery("", "");
  let params = [];

  if (!isAdmin && subconName) {
    query += ` WHERE LOWER(TRIM(COALESCE(m.subcon_name, ''))) = LOWER(TRIM($1))`;
    params.push(subconName);
  }

  const result = await pool.query(query, params);

  let totalTry = 0;
  let totalUsd = 0;
  let okTry = 0;
  let okUsd = 0;
  let beklerTry = 0;
  let beklerUsd = 0;

  let billedTry = 0;
  let billedUsd = 0;

  let ok = 0;
  let partial = 0;
  let cancel = 0;
  let bekler = 0;

  (result.rows || []).forEach((row) => {
    const done = Number(row.done_qty || 0);
    const req = Number(row.requested_qty || 0);
    const billed = Number(row.billed_qty || 0);
    const price = Number(row.unit_price || 0);
    const currency = normalizeCurrency(row.currency);

    const amount = done * price;
    const billedAmount = billed * price;

    if (currency === "USD") {
      totalUsd += amount;
      billedUsd += billedAmount;
    } else {
      totalTry += amount;
      billedTry += billedAmount;
    }

    if (req === 0) {
      bekler++;
      if (currency === "USD") beklerUsd += amount;
      else beklerTry += amount;
    } else if (done === 0) {
      cancel++;
    } else if (done < req) {
      partial++;
    } else {
      ok++;
      if (currency === "USD") okUsd += amount;
      else okTry += amount;
    }
  });

  const completed = totalTry + totalUsd;
  const totalBilled = billedTry + billedUsd;
  const po_bekler = beklerTry + beklerUsd;
  const okAmount = okTry + okUsd;

  const notInvoiced = Math.max(completed - totalBilled, 0);
  const poOpenedButNotInvoiced = Math.max(okAmount - totalBilled, 0);

  const _scnLower = String(subconName || "").trim().toLowerCase();
  const paymentRate =
    _scnLower.includes("ahy") // AHY Elektrik %90 (2026-07 anlaşması)
      ? 0.9
      : _scnLower === "federal"
        ? 0.8
        : _scnLower === "ubs"
          ? 0.75
          : 1;

  const subcon_hakedis = completed * paymentRate;
  const po_bekler_hakedis = po_bekler * paymentRate;
  const not_invoiced_hakedis = notInvoiced * paymentRate;

  return {
    total_done_amount_try: totalTry,
    total_done_amount_usd: totalUsd,
    total_ok_amount_try: okTry,
    total_ok_amount_usd: okUsd,
    total_po_bekler_amount_try: beklerTry,
    total_po_bekler_amount_usd: beklerUsd,

    total_billed_amount_try: billedTry,
    total_billed_amount_usd: billedUsd,
    not_invoiced_amount: notInvoiced,
    po_opened_not_invoiced_amount: poOpenedButNotInvoiced,

    ok_count: ok,
    partial_count: partial,
    cancel_count: cancel,
    po_bekler_count: bekler,

    subcon_hakedis,
    po_bekler_hakedis,
    not_invoiced_hakedis,
    payment_rate: paymentRate,
  };
}

/* ================== EXPORT STATUS EXCEL ================== */

app.get("/export/site-entry-excel", async (req, res) => {
  try {
    const { project_code = "", site_code = "" } = req.query;

    const query = buildMasterJoinedQuery(
      `
      WHERE ($1 = '' OR TRIM(COALESCE(m.project_code, '')) = TRIM($1))
        AND ($2 = '' OR UPPER(TRIM(COALESCE(m.site_code, ''))) = UPPER(TRIM($2)))
      `,
      "ORDER BY m.created_at DESC, m.id DESC",
    );

    const result = await pool.query(query, [project_code, site_code]);

    const rows = (result.rows || []).map((row) => ({
      ...row,
      currency: normalizeCurrency(row.currency),
    }));

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Site Entries");

    worksheet.columns = [
      { header: "Saha Türü", key: "site_type", width: 14 },
      { header: "Bölge", key: "region", width: 14 },
      { header: "Status", key: "status", width: 14 },
      { header: "Analiz", key: "analysis", width: 14 },
      { header: "Project Code", key: "project_code", width: 16 },
      { header: "Site Code", key: "site_code", width: 22 },
      { header: "Item Code", key: "item_code", width: 16 },
      { header: "Item Description", key: "item_description", width: 45 },
      { header: "Done Qty", key: "done_qty", width: 12 },
      { header: "Requested Qty", key: "requested_qty", width: 14 },
      { header: "Due Qty", key: "due_qty", width: 12 },
      { header: "Billed Quantity", key: "billed_qty", width: 14 },
      { header: "QC Durum", key: "qc_durum", width: 12 },
      { header: "OnAir Date", key: "onair_date", width: 14 },
      { header: "Subcon Name", key: "subcon_name", width: 18 },
      { header: "RF Not", key: "note", width: 35 },
      { header: "Kabul Not", key: "kabul_not", width: 35 },
    ];

    rows.forEach((row) => {
      const siteCode = String(row.site_code || "").toUpperCase();

      let detectedSiteType = row.site_type || "";

      if (siteCode.includes("NS")) {
        detectedSiteType = "STANDALONE";
      } else if (siteCode.includes("NR3500") || siteCode.includes("5GEXP")) {
        detectedSiteType = "5G";
      } else if (
        siteCode.includes("L800") ||
        siteCode.includes("L2600") ||
        siteCode.includes("L2100") ||
        siteCode.includes("NR700") ||
        siteCode.includes("TRP") ||
        siteCode.includes("_L") ||
        siteCode.endsWith("L")
      ) {
        detectedSiteType = "LTE";
      }

      const region = getRegion(row.site_code);

      let analysis = "Eksik";
      const doneQty = Number(row.done_qty || 0);
      const reqQty = Number(row.requested_qty || 0);

      if (String(row.status || "").toUpperCase() === "PO_BEKLER") {
        analysis = "Eksik";
      } else if (doneQty === 0) {
        analysis = "Giriş Yok";
      } else if (doneQty === reqQty) {
        analysis = "Tamam";
      } else if (doneQty > reqQty) {
        analysis = "Fazla";
      }

      worksheet.addRow({
        site_type: detectedSiteType,
        region: region || "",
        status: row.status || "",
        analysis,
        project_code: row.project_code || "",
        site_code: row.site_code || "",
        item_code: row.item_code || "",
        item_description: row.item_description || "",
        done_qty: row.done_qty ?? "",
        requested_qty: row.requested_qty ?? "",
        due_qty: row.due_qty ?? "",
        billed_qty: row.billed_qty ?? "",
        qc_durum: row.qc_durum || "",
        onair_date: row.onair_date
          ? new Date(row.onair_date).toLocaleDateString("tr-TR")
          : "",
        subcon_name: row.subcon_name || "",
        note: row.note || "",
        kabul_not: row.kabul_not || "",
      });
    });

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = {
      vertical: "middle",
      horizontal: "center",
    };

    const fileName = `site_entries_${site_code || "all"}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    applyPremiumExcelStyle(worksheet, {
      headerRowNumber: 1,
      freezeRow: 1,
      filterFrom: "A1",
      filterTo: "Q1",
      statusColumn: "C",
    });
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("SITE ENTRY EXCEL EXPORT ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/export/status-excel", async (req, res) => {
  try {
    const { status = "ALL" } = req.query;

    const result = await pool.query(buildMasterJoinedQuery());

    let rows = (result.rows || []).map((row) => ({
      ...row,
      currency: normalizeCurrency(row.currency),
    }));

    if (status && status !== "ALL") {
      rows = rows.filter((r) => String(r.status) === String(status));
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Status Export");

    worksheet.columns = [
      { header: "Bölge", key: "region", width: 14 },
      { header: "Project Code", key: "project_code", width: 16 },
      { header: "Site Code", key: "site_code", width: 22 },
      { header: "Item Code", key: "item_code", width: 16 },
      { header: "Item Description", key: "item_description", width: 45 },
      { header: "Done Qty", key: "done_qty", width: 12 },
      { header: "Requested Qty", key: "requested_qty", width: 14 },
      { header: "OnAir Date", key: "onair_date", width: 14 },
    ];
    worksheet.spliceRows(1, 0, []);

    // 🔥 ÜST BAŞLIK
    const title = `DETAY RAPORU - ${region || "Tüm Bölgeler"} (${new Date().toLocaleDateString("tr-TR")})`;

    worksheet.mergeCells("A1:H1");

    const titleCell = worksheet.getCell("A1");
    titleCell.value = title;

    titleCell.font = {
      size: 14,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };

    titleCell.alignment = {
      vertical: "middle",
      horizontal: "center",
    };

    titleCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F4E78" },
    };

    worksheet.getRow(1).height = 25;

    worksheet.spliceRows(1, 0, []);
    worksheet.mergeCells("A1:H1");

    rows.forEach((row) => {
      worksheet.addRow({
        region: getRegion(row.site_code),
        project_code: row.project_code || "",
        site_code: row.site_code || "",
        item_code: row.item_code || "",
        item_description: row.item_description || "",
        done_qty: Number(row.done_qty || 0),
        requested_qty: Number(row.requested_qty || 0),
        onair_date: row.onair_date || "",
      });
    });

    worksheet.getRow(1).height = 24;

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber >= 3) {
        row.eachCell((cell) => {
          cell.alignment = {
            vertical: "middle",
            horizontal: "left",
            wrapText: true,
          };
          cell.border = {
            top: { style: "thin", color: { argb: "FFE5E5E5" } },
            left: { style: "thin", color: { argb: "FFE5E5E5" } },
            bottom: { style: "thin", color: { argb: "FFE5E5E5" } },
            right: { style: "thin", color: { argb: "FFE5E5E5" } },
          };
        });

        if (rowNumber % 2 === 0) {
          row.eachCell((cell) => {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF7F9FC" },
            };
          });
        }
      }
    });
    worksheet.views = [{ state: "frozen", ySplit: 2 }];

    worksheet.autoFilter = {
      from: "A2",
      to: "H2",
    };

    const headerRow = worksheet.getRow(2);
    headerRow.eachCell((cell) => {
      cell.font = {
        bold: true,
        size: 11,
        color: { argb: "FFFFFFFF" },
      };
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF3E648C" },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FFD9D9D9" } },
        left: { style: "thin", color: { argb: "FFD9D9D9" } },
        bottom: { style: "thin", color: { argb: "FFD9D9D9" } },
        right: { style: "thin", color: { argb: "FFD9D9D9" } },
      };
    });
    headerRow.height = 22;

    const safeStatus = status || "ALL";
    const fileName = `dashboard_${safeStatus}_${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    applyPremiumExcelStyle(worksheet, {
      headerRowNumber: 2,
      freezeRow: 2,
      filterFrom: "A2",
      filterTo: "P2",
      statusColumn: "B",
    });
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("EXPORT STATUS EXCEL ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

const ubsSpecial90Items = new Set([
  "8818168510",
  "8812184642",
  "8818274259",
  "8812184631",
  "8812184632",
  "8812184633",
  "8812184634",
  "8812184635",
  "8818168492",
  "8818168493",
  "8812184641",
]);

app.get("/export/region-analysis", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(buildMasterJoinedQuery());

    const rows = applySubconFilter(req, result.rows || []);
    const exportSubconName = String(req.user?.subcon_name || "").trim();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Region Analysis");

    // Kolonlar
    worksheet.columns = [
      { header: "Bölge", key: "bolge", width: 14 },
      { header: "Status", key: "status", width: 14 },
      { header: "Analiz", key: "analiz", width: 16 },
      { header: "Project", key: "project_code", width: 14 },
      { header: "Site Code", key: "site_code", width: 24 },
      { header: "Item Description", key: "item_description", width: 40 },
      { header: "Item Code", key: "item_code", width: 18 },
      { header: "OnAir Date", key: "onair_date", width: 16 },
      { header: "Done Qty", key: "done_qty", width: 12 },
      { header: "Requested Qty", key: "requested_qty", width: 14 },
      { header: "Billed Qty", key: "billed_qty", width: 12 },
      { header: "Currency", key: "currency", width: 10 },
      { header: "Unit Price", key: "unit_price", width: 14 },
      { header: "Şimşek Toplam Hakediş", key: "total_done_amount", width: 18 },
      {
        header: `${exportSubconName || "Taşeron"} Toplam Hakediş`,
        key: "subcon_hakedis",
        width: 22,
      },
      { header: "Subcon", key: "subcon_name", width: 18 },
    ];
    worksheet.spliceRows(1, 0, []);
    // Başlık
    worksheet.mergeCells("A1:P1");
    const titleCell = worksheet.getCell("A1");

    const titlePrefix = exportSubconName
      ? `${exportSubconName.toUpperCase()} REGION REPORT`
      : "GLOBAL REGION REPORT";

    titleCell.value = `${titlePrefix} (${new Date().toLocaleDateString("en-GB")})`;
    titleCell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    titleCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F4E78" },
    };
    worksheet.getRow(1).height = 24;

    // Header row
    const headerRow = worksheet.getRow(2);

    headerRow.eachCell((cell) => {
      cell.font = {
        bold: true,
        size: 11,
        color: { argb: "FFFFFFFF" }, // 🔥 BEYAZ YAZI
      };

      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
      };

      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF203864" }, // daha koyu mavi (Microsoft style)
      };

      cell.border = {
        top: { style: "thin", color: { argb: "FFCCCCCC" } },
        left: { style: "thin", color: { argb: "FFCCCCCC" } },
        bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
        right: { style: "thin", color: { argb: "FFCCCCCC" } },
      };
    });

    headerRow.height = 22;

    // Data rows
    rows.forEach((row) => {
      const subconName = String(row.subcon_name || "")
        .trim()
        .toLowerCase();

      const itemCode = String(row.item_code || "").trim();

      let subconRate = 1;

      if (subconName.includes("ahy")) {
        subconRate = 0.9; // AHY Elektrik %90 (2026-07 anlaşması)
      } else if (subconName === "federal") {
        subconRate = 0.8;
      } else if (subconName === "ubs") {
        subconRate = ubsSpecial90Items.has(itemCode) ? 0.9 : 0.75;
      }

      const totalDoneAmount = Number(row.total_done_amount || 0);
      const subconHakedis = totalDoneAmount * subconRate;
      worksheet.addRow({
        bolge: row.bolge || "",
        status: row.status || "",
        analiz: row.analiz || "",
        project_code: row.project_code || "",
        site_code: row.site_code || "",
        item_description: row.item_description || "",
        item_code: row.item_code || "",
        onair_date: row.onair_date || "",
        done_qty: Number(row.done_qty || 0),
        requested_qty: Number(row.requested_qty || 0),
        billed_qty: Number(row.billed_qty || 0),
        currency: row.currency || "",
        unit_price: Number(row.unit_price || 0),
        total_done_amount: Number(row.total_done_amount || 0),
        subcon_hakedis: subconHakedis,
        subcon_name: row.subcon_name || "",
      });
    });

    // Stil
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber >= 3) {
        row.eachCell((cell) => {
          cell.alignment = {
            vertical: "middle",
            horizontal: "left",
            wrapText: true,
          };
          cell.border = {
            top: { style: "thin", color: { argb: "FFE5E5E5" } },
            left: { style: "thin", color: { argb: "FFE5E5E5" } },
            bottom: { style: "thin", color: { argb: "FFE5E5E5" } },
            right: { style: "thin", color: { argb: "FFE5E5E5" } },
          };
        });
        worksheet.views = [
          {
            state: "frozen",
            ySplit: 2,
            showGridLines: false,
          },
        ];
      }
    });

    // Para kolonları
    ["M", "N", "O"].forEach((col) => {
      worksheet.getColumn(col).numFmt = "#,##0.00";
    });

    // Freeze
    worksheet.views = [
      {
        state: "frozen",
        ySplit: 2,
        showGridLines: false,
      },
    ];

    // Filter
    worksheet.autoFilter = {
      from: "A2",
      to: "P2",
    };

    // Response
    const fileName = `region_analysis_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    applyPremiumExcelStyle(worksheet, {
      headerRowNumber: 2,
      freezeRow: 2,
      filterFrom: "A2",
      filterTo: "P2",
      statusColumn: "B",
    });

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("REGION ANALYSIS EXCEL ERROR:", error);
    res.status(500).json({ ok: false, error: "Excel oluşturulamadı" });
  }
});

app.get("/export/detail-excel", authMiddleware, async (req, res) => {
  try {
    const { region = "", type = "", subcon = "" } = req.query;

    const result = await pool.query(buildMasterJoinedQuery());

    const filteredRows = applySubconFilter(req, result.rows || []);
    let rows = filteredRows.map((row) => ({
      ...row,
      currency: normalizeCurrency(row.currency),
    }));

    if (region) {
      rows = rows.filter(
        (row) =>
          String(getRegion(row.site_code) || "").toLowerCase() ===
          String(region).toLowerCase(),
      );
    }

    if (subcon && String(req.user?.role).toLowerCase() !== "subcon") {
      rows = rows.filter(
        (row) =>
          String(row.subcon_name || "")
            .trim()
            .toLowerCase() === String(subcon).trim().toLowerCase(),
      );
    }

    if (type === "PO_BEKLER") {
      // Hiç PO açılmamış (PO_BEKLER) + eksik açılmış (done > requested > 0)
      rows = rows.filter((row) => {
        if (String(row.status || "").toUpperCase() === "PO_BEKLER") return true;
        const done = Number(row.done_qty || 0);
        const req = Number(row.requested_qty || 0);
        return req > 0 && done > req;
      });
    }

    if (type === "PO_IPTAL") {
      // PO İptal Edilmeli: PO açılmış ama hiç iş yapılmamış
      rows = rows.filter(
        (row) => Number(row.done_qty || 0) === 0 && Number(row.requested_qty || 0) > 0,
      );
    }

    if (type === "NOT_INVOICED") {
      rows = rows.filter((row) => {
        const unitPrice = Number(row.unit_price || 0);
        const doneQty = Number(row.done_qty || 0);
        const billedQty = Number(row.billed_qty || 0);

        const completedAmount = doneQty * unitPrice;
        const billedAmount = billedQty * unitPrice;

        return completedAmount > billedAmount;
      });
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Detay");

    worksheet.columns = [
      { header: "Status", key: "status", width: 16 },
      { header: "QC Durum", key: "qc_durum", width: 14 },
      { header: "Kabul Durum", key: "kabul_durum", width: 14 },
      { header: "Kabul Not", key: "kabul_not", width: 24 },
      { header: "Project Code", key: "project_code", width: 16 },
      { header: "Site Code", key: "site_code", width: 22 },
      { header: "Item Code", key: "item_code", width: 18 },
      { header: "Item Description", key: "item_description", width: 45 },
      { header: "Done Qty", key: "done_qty", width: 12 },
      { header: "Requested Qty", key: "requested_qty", width: 14 },
      { header: "Billed Qty", key: "billed_qty", width: 12 },
      { header: "Subcon", key: "subcon_name", width: 20 },
      // PO listesinde: açılması gereken ek PO miktarı (done − requested)
      ...(type === "PO_BEKLER"
        ? [{ header: "Açılması Gereken PO Qty", key: "eksik_po", width: 20 }]
        : []),
    ];

    worksheet.spliceRows(1, 0, []);
    worksheet.mergeCells(1, 1, 1, worksheet.columnCount);
    const titleCell = worksheet.getCell("A1");

    titleCell.value = `DETAY RAPORU - ${region || "Tümü"} (${new Date().toLocaleDateString("tr-TR")})`;
    titleCell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    titleCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F4E78" },
    };
    worksheet.getRow(1).height = 24;

    rows.forEach((row) => {
      if (!row.item_code) {
        row.item_code = "";
      }

      worksheet.addRow({
        status: row.status || "",
        qc_durum: row.qc_durum || "NOK",
        kabul_durum: row.kabul_durum || "NOK",
        kabul_not: row.kabul_not || "",
        project_code: row.project_code || "",
        site_code: row.site_code || "",
        item_code: row.item_code || "",
        item_description: row.item_description || "",
        done_qty: row.done_qty ?? "",
        requested_qty: row.requested_qty ?? "",
        billed_qty: row.billed_qty ?? "",
        subcon_name: row.subcon_name || "",
        ...(type === "PO_BEKLER"
          ? { eksik_po: Math.max(0, Number(row.done_qty || 0) - Number(row.requested_qty || 0)) }
          : {}),
      });
    });

    const totalRows = worksheet.rowCount + 20;
    const totalCols = worksheet.columnCount;

    for (let i = 1; i <= totalRows; i++) {
      const row = worksheet.getRow(i);

      for (let j = 1; j <= totalCols; j++) {
        const cell = row.getCell(j);

        if (!cell.value) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF3F4F6" }, // 👈 çok premium açık gri
          };
        }
      }
    }

    const headerRow = worksheet.getRow(2);
    headerRow.eachCell((cell) => {
      cell.font = {
        bold: true,
        size: 11,
        color: { argb: "FFFFFFFF" },
      };
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF3E648C" },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FFD9D9D9" } },
        left: { style: "thin", color: { argb: "FFD9D9D9" } },
        bottom: { style: "thin", color: { argb: "FFD9D9D9" } },
        right: { style: "thin", color: { argb: "FFD9D9D9" } },
      };
    });
    headerRow.height = 22;

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber >= 3) {
        row.eachCell((cell) => {
          cell.alignment = {
            vertical: "middle",
            horizontal: "left",
            wrapText: true,
          };
          cell.border = {
            top: { style: "thin", color: { argb: "FFE5E5E5" } },
            left: { style: "thin", color: { argb: "FFE5E5E5" } },
            bottom: { style: "thin", color: { argb: "FFE5E5E5" } },
            right: { style: "thin", color: { argb: "FFE5E5E5" } },
          };
        });

        if (rowNumber % 2 === 0) {
          row.eachCell((cell) => {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF7F9FC" },
            };
          });
        }
      }
    });

    worksheet.views = [{ state: "frozen", ySplit: 2 }];
    worksheet.autoFilter = {
      from: "A2",
      to: "L2",
    };

    const typeLabel = type === "PO_IPTAL" ? "PO_Iptal_Edilmeli"
                    : type === "PO_BEKLER" ? "PO_Bekler"
                    : type === "NOT_INVOICED" ? "Faturalanmamis"
                    : type || "all";
    const regionLabel = (region || "").replace(/[^\x20-\x7EÀ-ɏ]/g, "").trim() || "Tum_Bolgeler";
    const fileName = `${regionLabel}_${typeLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    const safeFileName = fileName
      .replace(/İ/g, "I")
      .replace(/ı/g, "i")
      .replace(/ğ/g, "g")
      .replace(/Ğ/g, "G")
      .replace(/ü/g, "u")
      .replace(/Ü/g, "U")
      .replace(/ş/g, "s")
      .replace(/Ş/g, "S")
      .replace(/ö/g, "o")
      .replace(/Ö/g, "O")
      .replace(/ç/g, "c")
      .replace(/Ç/g, "C")
      .replace(/[^\x20-\x7E]/g, "");

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    applyPremiumExcelStyle(worksheet, {
      headerRowNumber: 2,
      freezeRow: 2,
      filterFrom: "A2",
      filterTo: "P2",
      statusColumn: "B",
    });
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("DETAIL EXCEL EXPORT ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== Taşeron Hakediş Analiz ================== */

const normalizeSubconName = (name) =>
  String(name || "")
    .trim()
    .toLocaleLowerCase("tr-TR");

app.get("/finance/subcon-hakedis-summary", async (req, res) => {
  try {
    const usdTryRate = await getTcmbUsdTrySellingRate();
    await ensureBolgeFaturaTable().catch(() => {});
    await ensureTaseronHakedisTable().catch(() => {});

    // bolge_fatura map: "site_code|item_code" → [{ fatura_no, fatura_tarihi, fatura_miktari }]
    const bfResult = await pool.query(`SELECT * FROM bolge_fatura ORDER BY created_at DESC`).catch(() => ({ rows: [] }));
    const bfMap = {};
    for (const bf of bfResult.rows) {
      // Boş kayıtları atla (fatura no yok VE miktar 0/boş) — fantom satırları sayma
      const hasFaturaNo = String(bf.fatura_no || '').trim() !== '';
      const hasMiktar = Number(bf.fatura_miktari || 0) > 0;
      if (!hasFaturaNo && !hasMiktar) continue;
      const key = `${String(bf.site_code||'').toUpperCase()}|${String(bf.item_code||'').trim()}|${String(bf.taseron_adi||'').toLowerCase()}`;
      if (!bfMap[key]) bfMap[key] = [];
      bfMap[key].push({ fatura_no: bf.fatura_no, fatura_tarihi: bf.fatura_tarihi, fatura_miktari: bf.fatura_miktari });
    }

    // taseron_hakedis map (manuel hakediş override): item bazlı → "SITE|ITEM|taseron", saha bazlı → "SITE||taseron"
    const thResult = await pool.query(`SELECT * FROM taseron_hakedis ORDER BY created_at DESC`).catch(() => ({ rows: [] }));
    const thMap = {};
    for (const th of thResult.rows) {
      const site = String(th.site_code || '').toUpperCase();
      const item = String(th.item_code || '').trim();
      const tas = String(th.taseron_adi || '').toLowerCase();
      const key = `${site}|${item}|${tas}`;
      // En güncel kayıt önce geldiği için yalnız ilkini (en yeni) tut
      if (!(key in thMap)) thMap[key] = Number(th.hakedis_bedeli || 0);
    }

    const detailResult = await pool.query(`
      SELECT
        mw.subcon_name,
        mw.done_qty,
        COALESCE(pr.requested_qty, 0) AS requested_qty,
        COALESCE(pr.billed_qty, 0) AS billed_qty,
        COALESCE(pr.unit_price, 0) AS unit_price,
        COALESCE(pr.currency, 'TRY') AS currency
      FROM master_works mw
      LEFT JOIN po_rows pr
        ON pr.project_code = mw.project_code
       AND pr.site_code = mw.site_code
       AND pr.item_code = mw.item_code
      WHERE mw.subcon_name IS NOT NULL
        AND TRIM(mw.subcon_name) <> ''
    `);

    const invoiceResult = await pool.query(`
      SELECT
        TRIM(COALESCE(NULLIF(rf_montaj_firma,''), tedarikci, '')) AS subcon_name,
        SUM(COALESCE(toplam_tutar, 0)) AS total_fatura,
        SUM(COALESCE(odenen_tutar, 0)) AS total_odenen
      FROM invoice_entries
      WHERE COALESCE(TRIM(NULLIF(rf_montaj_firma,'') ), TRIM(tedarikci), '') <> ''
      GROUP BY TRIM(COALESCE(NULLIF(rf_montaj_firma,''), tedarikci, ''))
    `);

    const map = new Map();

    for (const row of detailResult.rows) {
      const rawSubconName = String(row.subcon_name || "").trim();
      const subconName = normalizeSubconName(rawSubconName);
      if (!subconName) continue;

      const existing = map.get(subconName) || {
        subcon_name: rawSubconName,
        total_hakedis: 0,
        total_faturaya_hazir: 0,
        total_fatura: 0,
        total_odenen: 0,
        kalan_borc: 0,
        fazla_odeme: 0,
      };

      const doneQty = Number(row.done_qty || 0);
      const billedQty = Number(row.billed_qty || 0);
      const unitPrice = Number(row.unit_price || 0);
      const curr = String(row.currency || "TRY").toUpperCase();

      const hakedisRaw = doneQty * unitPrice;
      const faturayaHazirRaw = billedQty * unitPrice;

      // KDV %20 eklenerek hesapla (Kestiği Fatura KDV dahil olduğundan karşılaştırılabilir olsun)
      const KDV = 1.20;
      const hakedisTL =
        (curr === "USD" ? hakedisRaw * Number(usdTryRate || 0) : hakedisRaw) * KDV;

      const faturayaHazirTL =
        (curr === "USD"
          ? faturayaHazirRaw * Number(usdTryRate || 0)
          : faturayaHazirRaw) * KDV;

      existing.total_hakedis += hakedisTL;
      existing.total_faturaya_hazir += faturayaHazirTL;

      map.set(subconName, existing);
    }

    for (const row of invoiceResult.rows) {
      const rawSubconName = String(row.subcon_name || "").trim();
      const subconName = normalizeSubconName(rawSubconName);
      if (!subconName) continue;

      const existing = map.get(subconName) || {
        subcon_name: rawSubconName,
        total_hakedis: 0,
        total_faturaya_hazir: 0,
        total_fatura: 0,
        total_odenen: 0,
        kalan_borc: 0,
        fazla_odeme: 0,
      };

      existing.total_fatura = Number(row.total_fatura || 0);
      existing.total_odenen = Number(row.total_odenen || 0);

      map.set(subconName, existing);
    }

    const rows = Array.from(map.values()).map((row) => {
      const kalan_borc = Math.max(
        Number(row.total_fatura || 0) - Number(row.total_odenen || 0),
        0,
      );

      const fazla_odeme = Math.max(
        Number(row.total_odenen || 0) - Number(row.total_fatura || 0),
        0,
      );

      return {
        subcon_name: row.subcon_name,
        total_hakedis: Number((row.total_hakedis || 0).toFixed(2)),
        total_faturaya_hazir: Number(
          (row.total_faturaya_hazir || 0).toFixed(2),
        ),
        total_fatura: Number((row.total_fatura || 0).toFixed(2)),
        total_odenen: Number((row.total_odenen || 0).toFixed(2)),
        kalan_borc: Number(kalan_borc.toFixed(2)),
        fazla_odeme: Number(fazla_odeme.toFixed(2)),
      };
    });

    rows.sort((a, b) => a.subcon_name.localeCompare(b.subcon_name, "tr"));

    res.json({
      ok: true,
      usd_try_rate: Number(usdTryRate || 0),
      rows,
      bolge_fatura_map: bfMap,
      taseron_hakedis_map: thMap,
    });
  } catch (err) {
    console.error("SUBCON HAKEDIS SUMMARY ERROR:", err);
    res.status(500).json({
      ok: false,
      error: err.message || "Taşeron hakediş özeti alınamadı",
    });
  }
});

// GET /finance/subcon-hakedis-detail?subcon=Federal
// Taşeron mutabakat: kestiği fatura + unutulan (kesilebilir ama kesilmemiş) +
// gelecek ödeme planı (Huawei payment vade'sinden). Modal kartları için.
app.get("/finance/subcon-reconcile", async (req, res) => {
  try {
    const taseron = (req.query.taseron || "").trim();
    if (!taseron) {
      return res.status(400).json({ ok: false, error: "taseron gerekli" });
    }
    await ensureBolgeFaturaTable().catch(() => {});
    await ensureHwInvoiceItemsTable().catch(() => {});

    const tasUpper = taseron.toUpperCase().trim();
    const norm = (s) => String(s || "").toUpperCase().trim();
    const matchTas = (name) => {
      const n = norm(name);
      if (!n) return false;
      return n === tasUpper || n.includes(tasUpper) || tasUpper.includes(n);
    };
    const keyOf = (site, item) =>
      `${norm(site)}|${String(item || "").trim()}`;

    // 1) Taşeronun bize kestiği faturalar (bolge_fatura)
    const bf = await pool.query(`SELECT * FROM bolge_fatura`).catch(() => ({ rows: [] }));
    const invoiced = bf.rows.filter(
      (r) =>
        matchTas(r.taseron_adi) &&
        (String(r.fatura_no || "").trim() !== "" ||
          Number(r.fatura_miktari || 0) > 0),
    );
    const invoicedKeys = new Set(invoiced.map((r) => keyOf(r.site_code, r.item_code)));
    const invoicedTotal = invoiced.reduce(
      (s, r) => s + Number(r.fatura_miktari || 0),
      0,
    );

    // 2) Huawei'ye faturalanmış kalemler (site|item -> invoice_no'lar)
    const hw = await pool.query(
      `SELECT DISTINCT UPPER(TRIM(site_id)) AS site, TRIM(item_code) AS item, invoice_no
       FROM hw_invoice_items
       WHERE invoice_no IS NOT NULL AND TRIM(COALESCE(site_id,'')) <> ''`,
    ).catch(() => ({ rows: [] }));
    const hwInvByKey = new Map();
    hw.rows.forEach((r) => {
      const k = `${r.site}|${r.item}`;
      if (!hwInvByKey.has(k)) hwInvByKey.set(k, new Set());
      if (r.invoice_no) hwInvByKey.get(k).add(r.invoice_no);
    });

    // 3) Taşeronun yaptığı işler (master_works) — faturalanabilir kalemler
    const mw = await pool.query(
      `SELECT subcon_name, site_code, item_code, item_description, done_qty
       FROM master_works
       WHERE subcon_name IS NOT NULL AND TRIM(subcon_name) <> '' AND COALESCE(done_qty,0) > 0`,
    ).catch(() => ({ rows: [] }));

    // Unutulan = bu taşeron yaptı + Huawei'ye faturalanmış AMA taşeron bize kesmemiş
    // 2KX'in 5 özel itemi (başka firma yapıyor, manuel takip) listeye girmez
    const TWOKX_HIDDEN_ITEMS = new Set([
      "8812184927", "8812184919", "8812184920", "8812184930", "8812184870",
    ]);
    const isTwoKxTas = tasUpper.includes("2KX");
    const forgottenSeen = new Set();
    const forgotten = [];
    for (const r of mw.rows) {
      if (!matchTas(r.subcon_name)) continue;
      if (isTwoKxTas && TWOKX_HIDDEN_ITEMS.has(String(r.item_code || "").trim())) continue;
      const k = keyOf(r.site_code, r.item_code);
      if (!hwInvByKey.has(k)) continue; // Huawei'ye faturalanmamış → kesemez
      if (invoicedKeys.has(k)) continue; // zaten kesmiş
      if (forgottenSeen.has(k)) continue;
      forgottenSeen.add(k);
      forgotten.push({
        site_code: r.site_code,
        item_code: r.item_code,
        item_description: r.item_description,
        done_qty: Number(r.done_qty || 0),
        hw_invoice_nos: Array.from(hwInvByKey.get(k) || []).join(", "),
      });
    }

    // 4) Gelecek ödeme planı: kestiği faturalar → Huawei invoice → HW Payment vade
    const pay = await pool.query(
      `SELECT invoice_no, MIN(due_date) AS due_date
       FROM hw_payment_rows
       WHERE due_date IS NOT NULL AND invoice_no IS NOT NULL
       GROUP BY invoice_no`,
    ).catch(() => ({ rows: [] }));
    // Fatura no normalizasyonu: '-cur' eki atılır, SIM+yıl sonrası baştaki
    // sıfırlar kırpılır (kalem/head/payment dosyaları farklı doldurabiliyor)
    const canonInv = (v) => String(v || "").trim().toUpperCase()
      .replace(/-.*$/, "").replace(/^(SIM\d{4})0+/, "$1");
    const dueByInvoice = new Map();
    pay.rows.forEach((r) => {
      if (r.invoice_no)
        dueByInvoice.set(canonInv(r.invoice_no), r.due_date);
    });

    const payBuckets = new Map(); // due_date -> { amount, invoice_nos:Set }
    let unknownDue = 0;
    for (const r of invoiced) {
      const amt = Number(r.fatura_miktari || 0);
      if (amt <= 0) continue;
      const k = keyOf(r.site_code, r.item_code);
      const hwInvs = hwInvByKey.get(k);
      let due = null;
      let usedInv = null;
      if (hwInvs) {
        for (const inv of hwInvs) {
          if (dueByInvoice.has(canonInv(inv))) {
            due = dueByInvoice.get(canonInv(inv));
            usedInv = inv;
            break;
          }
        }
      }
      if (!due) {
        unknownDue += amt;
        continue;
      }
      const dueKey =
        due instanceof Date ? due.toISOString().slice(0, 10) : String(due).slice(0, 10);
      if (!payBuckets.has(dueKey))
        payBuckets.set(dueKey, { due_date: dueKey, amount: 0, invoice_nos: new Set() });
      const b = payBuckets.get(dueKey);
      b.amount += amt;
      if (usedInv) b.invoice_nos.add(usedInv);
    }
    const payments = Array.from(payBuckets.values())
      .map((b) => ({
        due_date: b.due_date,
        amount: b.amount,
        invoice_nos: Array.from(b.invoice_nos).join(", "),
      }))
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

    // Per-item map'ler (taşeron Excel'i için): site|item -> fatura bilgisi / vade
    const invoicedByKey = {};
    for (const r of invoiced) {
      const k = keyOf(r.site_code, r.item_code);
      if (!invoicedByKey[k]) {
        invoicedByKey[k] = {
          fatura_no: r.fatura_no || "",
          fatura_tarihi: r.fatura_tarihi
            ? String(r.fatura_tarihi).slice(0, 10)
            : "",
          fatura_miktari: 0,
        };
      }
      invoicedByKey[k].fatura_miktari += Number(r.fatura_miktari || 0);
      if (r.fatura_no && !invoicedByKey[k].fatura_no.includes(r.fatura_no)) {
        invoicedByKey[k].fatura_no = [invoicedByKey[k].fatura_no, r.fatura_no]
          .filter(Boolean)
          .join(", ");
      }
    }
    const dueByKey = {};
    for (const [k, invs] of hwInvByKey.entries()) {
      for (const inv of invs) {
        const due = dueByInvoice.get(canonInv(inv));
        if (due) {
          dueByKey[k] =
            due instanceof Date
              ? due.toISOString().slice(0, 10)
              : String(due).slice(0, 10);
          break;
        }
      }
    }

    // Şimşek tahsilat durumu: kalemin HW faturası Huawei tarafından ÖDENDİ mi?
    // (hw_payment_rows.payment_date dolu = para Şimşek'e geçti)
    const paidRes = await pool.query(
      `SELECT invoice_no, MAX(payment_date) AS pay_date
       FROM hw_payment_rows
       WHERE payment_date IS NOT NULL AND invoice_no IS NOT NULL
       GROUP BY invoice_no`,
    ).catch(() => ({ rows: [] }));
    const paidByInvoice = new Map();
    paidRes.rows.forEach((r) => {
      if (r.invoice_no) paidByInvoice.set(canonInv(r.invoice_no), r.pay_date);
    });
    const paidByKey = {};
    for (const [k, invs] of hwInvByKey.entries()) {
      for (const inv of invs) {
        const pd = paidByInvoice.get(canonInv(inv));
        if (pd) {
          paidByKey[k] = pd instanceof Date ? pd.toISOString().slice(0, 10) : String(pd).slice(0, 10);
          break;
        }
      }
    }

    return res.json({
      ok: true,
      taseron,
      invoiced_by_key: invoicedByKey,
      due_by_key: dueByKey,
      paid_by_key: paidByKey,
      invoiced: {
        count: invoiced.length,
        total: invoicedTotal,
        items: invoiced.map((r) => ({
          site_code: r.site_code,
          item_code: r.item_code,
          item_description: r.item_description,
          fatura_no: r.fatura_no,
          fatura_tarihi: r.fatura_tarihi,
          fatura_miktari: Number(r.fatura_miktari || 0),
        })),
      },
      forgotten: { count: forgotten.length, items: forgotten },
      payments,
      unknown_due_total: unknownDue,
    });
  } catch (err) {
    console.error("SUBCON RECONCILE ERROR:", err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || "Mutabakat alınamadı" });
  }
});

app.get("/finance/subcon-hakedis-detail", authMiddleware, async (req, res) => {
  try {
    const subconQ = (req.query.subcon || "").trim().toLowerCase();
    if (!subconQ || subconQ.length < 2) return res.json({ ok: true, rows: [], total_hakedis: 0 });
    const usdTryRate = await getTcmbUsdTrySellingRate();
    const result = await pool.query(`
      SELECT
        mw.site_code, mw.bolge, mw.project_code, mw.item_description, mw.item_code,
        COALESCE(mw.done_qty, 0) AS done_qty, mw.subcon_name,
        COALESCE(pr.unit_price, 0) AS unit_price,
        COALESCE(pr.currency, 'TRY') AS currency,
        COALESCE(mw.done_qty, 0) * COALESCE(pr.unit_price, 0) AS done_amount
      FROM master_works mw
      LEFT JOIN po_rows pr
        ON pr.project_code = mw.project_code
       AND pr.site_code = mw.site_code
       AND pr.item_code = mw.item_code
      WHERE LOWER(TRIM(mw.subcon_name)) LIKE $1 AND COALESCE(mw.done_qty, 0) > 0
      ORDER BY mw.bolge, mw.site_code
    `, [`%${subconQ}%`]);
    let totalHakedis = 0;
    const rows = result.rows.map(row => {
      const doneAmt = Number(row.done_amount || 0);
      const amtTL = String(row.currency||'TRY').toUpperCase() === 'USD' ? doneAmt * Number(usdTryRate || 0) : doneAmt;
      totalHakedis += amtTL;
      return { site_code: row.site_code, bolge: row.bolge, project_code: row.project_code, item_description: row.item_description, done_qty: Number(row.done_qty||0), unit_price: Number(row.unit_price||0), currency: row.currency, done_amount_tl: Math.round(amtTL*100)/100 };
    });
    res.json({ ok: true, rows, total_hakedis: Math.round(totalHakedis*100)/100, subcon: req.query.subcon });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/* ================== FINANCE HW PAYMENT UPLOAD ================== */
app.post(
  "/finance/hw-payment/upload",
  requireHwYukleme,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: "Dosya yok" });
      }

      const workbook = XLSX.read(req.file.buffer);
      const firstSheetName = workbook.SheetNames[0];

      if (!firstSheetName) {
        return res
          .status(400)
          .json({ ok: false, error: "Excel içinde sheet bulunamadı" });
      }

      const sheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

      if (!rows.length) {
        return res
          .status(400)
          .json({ ok: false, error: "Excel içinde veri bulunamadı" });
      }

      await pool.query(`DELETE FROM hw_payment_rows`);

      const uploadedAt = new Date().toISOString();
      let inserted = 0;

      // HW Excel has 2 header rows: row[0] = English, row[1] = Chinese → start at i=2
      const firstDataRow = (rows.length > 1 && typeof rows[1][0] === 'string' && /[一-鿿]/.test(String(rows[1][0] || ''))) ? 2 : 1;

      for (let i = firstDataRow; i < rows.length; i++) {
        const row = rows[i] || [];

        const invoiceNo = row[0];
        const invoiceAmount = row[1];
        const paymentAmount = row[2];
        const prepaymentAmount = row[3];
        const remainingAmount = row[4];

        const paymentDateRaw = row[5];
        const dueDateRaw = row[6];

        let paymentDate = parseExcelDateFlexible(paymentDateRaw);
        let dueDate = parseExcelDateFlexible(dueDateRaw);

        // Eğer Excel tarihi 2000 yılına düşürmüşse direkt bu yılı düzelt
        if (paymentDate) {
          const pay = new Date(paymentDate);
          if (pay.getFullYear() <= 2001) {
            pay.setFullYear(new Date().getFullYear());
            paymentDate = pay.toISOString().slice(0, 10);
          }
        }

        if (dueDate) {
          const due = new Date(dueDate);

          if (due.getFullYear() <= 2001) {
            const nowYear = new Date().getFullYear();
            due.setFullYear(nowYear);
            dueDate = due.toISOString().slice(0, 10);
          }
        }

        console.log("PAY RAW:", paymentDateRaw, "=>", paymentDate);
        console.log("DUE RAW:", dueDateRaw, "=>", dueDate);
        console.log("REQ BODY:", req.body);

        const customerName = row[7];
        const paymentMethod = row[8];
        const supplierCode = row[9];
        const supplierName = row[10];
        const currency = row[11];
        console.log("RAW DUE DATE:", dueDateRaw, "PARSED:", dueDate);

        if (
          !invoiceNo &&
          !invoiceAmount &&
          !paymentAmount &&
          !paymentDate &&
          !customerName
        ) {
          continue;
        }

        await pool.query(
          `
          INSERT INTO hw_payment_rows (
            invoice_no,
            invoice_amount,
            payment_amount,
            prepayment_amount,
            remaining_amount,
            payment_date,
            due_date,
            customer_name,
            payment_method,
            supplier_code,
            supplier_name,
            currency,
            upload_batch
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          `,
          [
            invoiceNo ? String(invoiceNo).trim() : null,
            parseFinanceNumber(invoiceAmount),
            parseFinanceNumber(paymentAmount),
            parseFinanceNumber(prepaymentAmount),
            parseFinanceNumber(remainingAmount),
            parseExcelDateFlexible(paymentDate),
            dueDate,
            customerName ? String(customerName).trim() : null,
            paymentMethod ? String(paymentMethod).trim() : null,
            supplierCode ? String(supplierCode).trim() : null,
            supplierName ? String(supplierName).trim() : null,
            normalizeCurrency(currency),
            uploadedAt,
          ],
        );

        inserted++;
      }

      res.json({
        ok: true,
        inserted,
        uploaded_at: uploadedAt,
        message: "HW Payment raporu yüklendi",
        sheet_name: firstSheetName,
      });
    } catch (err) {
      console.error("FINANCE HW PAYMENT UPLOAD ERROR:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  },
);

/* ================== HW PAYMENT LAST UPLOAD INFO ================== */
app.get("/finance/hw-payment/last-upload", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        upload_batch,
        COUNT(*) AS row_count,
        SUM(COALESCE(payment_amount, 0)) AS total_payment,
        MIN(payment_date) AS min_date,
        MAX(payment_date) AS max_date
      FROM hw_payment_rows
      WHERE upload_batch IS NOT NULL
      GROUP BY upload_batch
      ORDER BY upload_batch DESC
      LIMIT 1
    `);
    const row = result.rows[0];
    res.json({
      ok: true,
      last_upload: row ? {
        uploaded_at: row.upload_batch,
        row_count: Number(row.row_count),
        total_payment: Number(row.total_payment || 0),
        min_date: row.min_date,
        max_date: row.max_date,
      } : null,
    });
  } catch (err) {
    res.json({ ok: true, last_upload: null });
  }
});

/* ================== FINANCE DEBUG PAYMENTS (TEMP) ================== */
app.get("/finance/debug-payments", async (req, res) => {
  try {
    const monthStr = '2026-06';
    // Haziran günlük breakdown — hem received hem pending
    const juneBreakdown = await pool.query(`
      SELECT
        TO_CHAR(due_date, 'YYYY-MM-DD') AS due_day,
        COUNT(*) AS row_cnt,
        COUNT(CASE WHEN COALESCE(remaining_amount,0) > 0 THEN 1 END) AS positive_cnt,
        COUNT(CASE WHEN COALESCE(remaining_amount,0) < 0 THEN 1 END) AS negative_cnt,
        COUNT(CASE WHEN COALESCE(remaining_amount,0) = 0 THEN 1 END) AS zero_cnt,
        SUM(CASE WHEN COALESCE(remaining_amount,0) > 0 THEN remaining_amount ELSE 0 END) AS positive_sum,
        SUM(CASE WHEN COALESCE(remaining_amount,0) < 0 THEN remaining_amount ELSE 0 END) AS negative_sum
      FROM hw_payment_rows
      WHERE to_char(due_date, 'YYYY-MM') = $1
      GROUP BY due_day
      ORDER BY due_day
    `, [monthStr]);

    const receivedBreakdown = await pool.query(`
      SELECT
        TO_CHAR(payment_date, 'YYYY-MM-DD') AS pay_day,
        COUNT(*) AS row_cnt,
        SUM(COALESCE(payment_amount,0)) AS payment_sum
      FROM hw_payment_rows
      WHERE to_char(payment_date, 'YYYY-MM') = $1
        AND COALESCE(payment_amount,0) > 0
      GROUP BY pay_day
      ORDER BY pay_day
    `, [monthStr]);

    // Totals
    const totals = await pool.query(`
      SELECT
        COUNT(*) AS total_rows,
        SUM(COALESCE(invoice_amount,0)) AS total_invoice,
        SUM(COALESCE(payment_amount,0)) AS total_paid,
        SUM(COALESCE(remaining_amount,0)) AS total_remaining
      FROM hw_payment_rows
    `);

    res.json({
      ok: true,
      server_time: new Date().toISOString(),
      june_due_breakdown: juneBreakdown.rows,
      june_received_breakdown: receivedBreakdown.rows,
      totals: totals.rows[0],
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== FINANCE PAYMENTS LIST ================== */
app.get("/finance/payments/list", requireFinanceAuth, async (req, res) => {
  try {
    const { payment_date } = req.query;

    let sql = `
      SELECT
        id,
        invoice_no,
        COALESCE(invoice_amount, 0) AS invoice_amount,
        COALESCE(payment_amount, 0) AS payment_amount,
        COALESCE(prepayment_amount, 0) AS prepayment_amount,
        COALESCE(invoice_amount, 0) - COALESCE(payment_amount, 0) AS remaining_amount,
        payment_date,
        due_date,
        COALESCE(customer_name, '') AS customer_name,
        COALESCE(payment_method, '') AS payment_method,
        COALESCE(supplier_code, '') AS supplier_code,
        COALESCE(supplier_name, '') AS supplier_name,
        COALESCE(currency, 'TRY') AS currency
      FROM hw_payment_rows
    `;
    const params = [];

    if (payment_date) {
      sql += ` WHERE payment_date = $1 `;
      params.push(payment_date);
    }

    sql += ` ORDER BY payment_date DESC, id DESC `;

    const result = await pool.query(sql, params);

    res.json({
      ok: true,
      rows: result.rows || [],
    });
  } catch (error) {
    console.error("PAYMENTS LIST ERROR:", error);
    res.status(500).json({
      ok: false,
      error: "Payment kayıtları alınırken hata oluştu",
      detail: error.message,
    });
  }
});

/* ================== FINANCE HW INVOICE UPLOAD ================== */
app.post(
  "/finance/hw-invoice/upload",
  requireHwYukleme,
  upload.array("files"),
  async (req, res) => {
    try {
      const files = req.files && req.files.length ? req.files : (req.file ? [req.file] : []);
      if (!files.length) {
        return res.status(400).json({ ok: false, error: "Dosya yok" });
      }

      // Birden çok dosyanın (500'lük sayfa exportları) satırlarını birleştir;
      // her dosyada ilk 2 başlık satırı atlanır
      const dataRows = [];
      for (const f of files) {
        const workbook = XLSX.read(f.buffer);
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) continue;
        const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
          header: 1,
          defval: null,
        });
        if (rawRows && rawRows.length >= 3) dataRows.push(...rawRows.slice(2));
      }

      if (!dataRows.length) {
        return res.status(400).json({
          ok: false,
          error: "Excel içinde yeterli veri bulunamadı",
        });
      }

      await ensureHwInvoiceTable();
      await pool.query(`DELETE FROM hw_invoice_rows`);

      let inserted = 0;
      const seenInvoiceNos = new Set(); // dosyalar üst üste binerse tekilleştir

      for (const rowArr of dataRows) {
        if (!rowArr || rowArr.length === 0) continue;

        // Kolon indexleri
        const invoiceNoRaw = rowArr[0]; // A
        const invoiceDateRaw = rowArr[4]; // E
        const currencyRaw = rowArr[9]; // J
        const invoiceAmountInclTaxRaw = rowArr[12]; // M
        const invoiceStatusRaw = rowArr[18]; // S
        const termsRaw = rowArr[19]; // T
        const referenceRateRaw = rowArr[33]; // AH

        const invoiceNo = invoiceNoRaw ? String(invoiceNoRaw).trim() : null;
        const invoiceDate = parseExcelDateFlexible(invoiceDateRaw);
        const currency = normalizeCurrency(currencyRaw);
        const invoiceStatus = invoiceStatusRaw
          ? String(invoiceStatusRaw).trim()
          : null;
        const terms = termsRaw ? String(termsRaw).trim() : null;

        const invoiceAmountInclTax = parseFinanceNumber(
          invoiceAmountInclTaxRaw,
        );
        const referenceRate = parseFinanceNumber(referenceRateRaw);

        if (!invoiceNo && !invoiceDate && !invoiceAmountInclTaxRaw) {
          continue;
        }

        let finalAmount = invoiceAmountInclTax;

        if (currency === "USD") {
          finalAmount = invoiceAmountInclTax * (referenceRate || 0);
        }

        // Dosyalar üst üste biniyorsa aynı fatura ikinci kez eklenmesin
        if (invoiceNo) {
          if (seenInvoiceNos.has(invoiceNo)) continue;
          seenInvoiceNos.add(invoiceNo);
        }

        await pool.query(
          `
         INSERT INTO hw_invoice_rows
         (
           invoice_no,
           invoice_amount,
           invoice_date,
           customer_name,
           currency,
           terms,
           invoice_status,
           upload_batch,
           reference_rate
         )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          `,
          [
            invoiceNo,
            finalAmount,
            invoiceDate,
            null,
            currency,
            terms,
            invoiceStatus,
            files.map((f) => f.originalname).join(" + ").slice(0, 250),
            referenceRate || null,
          ],
        );

        inserted++;
      }

      return res.json({
        ok: true,
        inserted,
        message: "HW Fatura raporu yüklendi",
        file_count: files.length,
      });
    } catch (err) {
      console.error("FINANCE HW INVOICE UPLOAD ERROR:", err);
      return res.status(500).json({
        ok: false,
        error: err.message || "HW Fatura upload sırasında hata oluştu",
      });
    }
  },
);

/* ================== HW FATURA ITEM (KALEM) UPLOAD ================== */
// Manufacturer alanından site_id çek: "200000706586012<!>MN0426_NS_AE<!>MN0426_NS_AE" -> "MN0426_NS_AE"
function parseHwSiteId(manufacturer) {
  if (manufacturer === null || manufacturer === undefined) return null;
  const s = String(manufacturer);
  const parts = s.split("<!>");
  if (parts.length >= 2) return (parts[1] || "").trim() || null;
  return s.trim() || null;
}

// poCreateExp Excel'inde İngilizce başlık satırını bul ve kolon haritası çıkar
function buildHwItemColMap(rawRows) {
  const LABELS = {
    po_no: ["po no.", "po no"],
    release_no: ["release no.", "release no"],
    line_no: ["line no.", "line no"],
    shipment_no: ["shipment no.", "shipment no"],
    po_qty: ["po qty", "po qty."],
    ac_qty: ["ac qty.", "ac qty"],
    billed_qty: ["billed qty", "billed qty."],
    currency: ["currency"],
    unit_price: ["unit price"],
    tax_rate: ["tax rate"],
    acceptance_milestone: ["acceptance milestone"],
    description: ["description"],
    payment_terms: ["payment terms"],
    item_code: ["item code"],
    project_code: ["project code"],
    manufacturer: ["manufacturer"],
  };

  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
    const row = rawRows[i] || [];
    const hasPoNo = row.some(
      (c) => c != null && String(c).trim().toLowerCase() === "po no.",
    );
    if (hasPoNo) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx < 0) return null;

  const headerRow = rawRows[headerRowIdx] || [];
  const colMap = {};
  for (const [key, variants] of Object.entries(LABELS)) {
    for (let c = 0; c < headerRow.length; c++) {
      const cell = headerRow[c];
      if (cell == null) continue;
      const norm = String(cell).trim().toLowerCase();
      if (variants.includes(norm)) {
        if (colMap[key] === undefined) colMap[key] = c;
      }
    }
  }
  return { headerRowIdx, colMap };
}

app.post(
  "/finance/hw-invoice-items/upload",
  requireHwYukleme,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: "Dosya yok" });
      }
      // Fatura No artık opsiyonel — kesilen fatura no'ları PDF yüklemesi getirir.
      // Bu Excel "kalem master"ıdır (PO+Line+Shipment bazında).
      const invoiceNo = (req.body.invoice_no || "").toString().trim() || null;

      const workbook = XLSX.read(req.file.buffer);
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        return res
          .status(400)
          .json({ ok: false, error: "Excel içinde sheet bulunamadı" });
      }
      const sheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: null,
      });

      const mapInfo = buildHwItemColMap(rawRows);
      if (!mapInfo || mapInfo.colMap.po_no === undefined) {
        return res.status(400).json({
          ok: false,
          error:
            "Excel formatı tanınamadı (PO No. başlık satırı bulunamadı). Huawei poCreateExp dosyasını yükleyin.",
        });
      }
      const { headerRowIdx, colMap } = mapInfo;

      await ensureHwInvoiceItemsTable();

      // Her yükleme bir batch (parti): yanlış dosya yüklenirse sadece bu parti geri alınır
      const batchId = String(Date.now());
      const uploadDate = new Date().toISOString().slice(0, 10);

      const get = (rowArr, key) => {
        const idx = colMap[key];
        if (idx === undefined) return null;
        return rowArr[idx];
      };

      let inserted = 0;
      let skipped = 0;
      for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
        const rowArr = rawRows[i] || [];
        if (rowArr.length === 0) continue;

        const poNoRaw = get(rowArr, "po_no");
        const poNo = poNoRaw == null ? "" : String(poNoRaw).trim();
        // Boş satır / Çince başlık satırı / tekrar eden başlığı atla
        if (!poNo) {
          skipped++;
          continue;
        }
        const poNoLower = poNo.toLowerCase();
        if (poNoLower === "po no." || poNoLower === "po号") {
          skipped++;
          continue;
        }

        const siteId = parseHwSiteId(get(rowArr, "manufacturer"));
        const itemCode = (() => {
          const v = get(rowArr, "item_code");
          return v == null ? null : String(v).trim() || null;
        })();

        const txt = (key) => {
          const v = get(rowArr, key);
          return v == null ? null : String(v).trim() || null;
        };
        const num = (key) => {
          const v = get(rowArr, key);
          if (v == null || v === "") return null;
          return parseFinanceNumber(v);
        };

        const lineNo = txt("line_no");
        const shipmentNo = txt("shipment_no");

        // Upsert: aynı PO+Line+Shipment varsa master alanları güncelle,
        // ama önceden eşleşmiş invoice_no / faturalanan tutarı KORU.
        const existing = await pool.query(
          `SELECT id FROM hw_invoice_items
           WHERE po_no = $1
             AND line_no IS NOT DISTINCT FROM $2
             AND shipment_no IS NOT DISTINCT FROM $3
           LIMIT 1`,
          [poNo, lineNo, shipmentNo],
        );

        const masterVals = [
          siteId,
          txt("release_no"),
          num("po_qty"),
          num("ac_qty"),
          num("billed_qty"),
          normalizeCurrency(get(rowArr, "currency")) || "TRY",
          num("unit_price"),
          num("tax_rate"),
          txt("acceptance_milestone"),
          txt("description"),
          txt("payment_terms"),
          itemCode,
          txt("project_code"),
          req.file.filename || utf8Name(req.file.originalname) || null,
        ];

        if (existing.rows.length > 0) {
          await pool.query(
            `UPDATE hw_invoice_items SET
               site_id=$1, release_no=$2, po_qty=$3, ac_qty=$4, billed_qty=$5,
               currency=$6, unit_price=$7, tax_rate=$8, acceptance_milestone=$9,
               description=$10, payment_terms=$11, item_code=$12, project_code=$13,
               upload_batch=$14
             WHERE id=$15`,
            [...masterVals, existing.rows[0].id],
          );
        } else {
          await pool.query(
            `INSERT INTO hw_invoice_items
             (site_id, release_no, po_qty, ac_qty, billed_qty, currency,
              unit_price, tax_rate, acceptance_milestone, description,
              payment_terms, item_code, project_code, upload_batch,
              po_no, line_no, shipment_no, invoice_no, batch_id, upload_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
            [...masterVals, poNo, lineNo, shipmentNo, invoiceNo, batchId, uploadDate],
          );
        }
        inserted++;
      }

      return res.json({
        ok: true,
        invoice_no: invoiceNo,
        inserted,
        skipped,
        sheet_name: firstSheetName,
        message: `${inserted} kalem master'a kaydedildi`,
      });
    } catch (err) {
      console.error("HW INVOICE ITEMS UPLOAD ERROR:", err);
      return res.status(500).json({
        ok: false,
        error: err.message || "HW Fatura Item upload sırasında hata oluştu",
      });
    }
  },
);

// Yüklenen kalemleri listele (fatura no bazında özet + son kayıtlar)
app.get("/finance/hw-invoice-items", async (req, res) => {
  try {
    await ensureHwInvoiceItemsTable();
    // Sadece fatura kesilmiş (invoice_no dolu) kalemleri fatura bazında grupla
    const summary = await pool.query(`
      SELECT invoice_no,
             COUNT(*)::int AS item_count,
             COUNT(DISTINCT site_id)::int AS site_count,
             MIN(currency) AS currency,
             SUM(COALESCE(unit_price,0) * COALESCE(billed_qty, ac_qty, po_qty, 0)) AS total_amount,
             MAX(invoiced_amount_incl) AS invoiced_amount,
             MAX(COALESCE(invoice_matched_at, created_at)) AS uploaded_at
      FROM hw_invoice_items
      WHERE invoice_no IS NOT NULL
      GROUP BY invoice_no
      ORDER BY MAX(COALESCE(invoice_matched_at, created_at)) DESC
    `);
    const totals = await pool.query(`
      SELECT COUNT(*)::int AS total_items,
             COUNT(*) FILTER (WHERE invoice_no IS NOT NULL)::int AS invoiced_items,
             COUNT(*) FILTER (WHERE invoice_no IS NULL)::int AS uninvoiced_items,
             COUNT(DISTINCT invoice_no) FILTER (WHERE invoice_no IS NOT NULL)::int AS total_invoices,
             COUNT(DISTINCT site_id)::int AS total_sites
      FROM hw_invoice_items
    `);
    return res.json({
      ok: true,
      invoices: summary.rows,
      totals: totals.rows[0] || {},
    });
  } catch (err) {
    console.error("HW INVOICE ITEMS LIST ERROR:", err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || "Liste alınamadı" });
  }
});

// Tek bir faturanın kalem detayları
// Huawei'ye FATURALANMIŞ (invoice_no dolu) kalemlerin site_id|item_code anahtarları
// Taşeron "Fatura Kesilebilir" çarpıştırması için.
app.get("/finance/hw-invoice-items/billable-keys", async (req, res) => {
  try {
    await ensureHwInvoiceItemsTable();
    // reference_rate: faturanın kesildiği andaki HW kuru (head template AH kolonu)
    // — USD kalemlerde taşeron hesabı bu sabit kuru kullanır
    const r = await pool.query(`
      SELECT
        UPPER(TRIM(COALESCE(i.site_id, ''))) AS site_id,
        TRIM(COALESCE(i.item_code, '')) AS item_code,
        string_agg(DISTINCT i.invoice_no, ', ') AS invoice_nos,
        SUM(COALESCE(i.invoiced_amount_incl, 0)) AS invoiced_amount,
        MAX(hr.reference_rate) AS reference_rate,
        to_char(MIN(hr.invoice_date), 'YYYY-MM-DD') AS invoice_date
      FROM hw_invoice_items i
      -- Fatura no normalizasyonu: kalem dosyasında seri fazladan sıfırlı
      -- (SIM20260000000746), head'de kısa (SIM2026000000746) gelebiliyor;
      -- '-cur' gibi ekler de atılır — SIM+yıl sonrası baştaki sıfırlar kırpılır
      LEFT JOIN hw_invoice_rows hr
        ON regexp_replace(regexp_replace(TRIM(hr.invoice_no),'-.*$',''),'^(SIM\\d{4})0+','\\1')
         = regexp_replace(regexp_replace(TRIM(i.invoice_no),'-.*$',''),'^(SIM\\d{4})0+','\\1')
      WHERE i.invoice_no IS NOT NULL
        AND TRIM(COALESCE(i.site_id, '')) <> ''
      GROUP BY UPPER(TRIM(COALESCE(i.site_id, ''))), TRIM(COALESCE(i.item_code, ''))
    `);
    return res.json({ ok: true, keys: r.rows });
  } catch (err) {
    console.error("HW BILLABLE KEYS ERROR:", err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || "Anahtarlar alınamadı" });
  }
});

app.get("/finance/hw-invoice-items/:invoiceNo", async (req, res) => {
  try {
    await ensureHwInvoiceItemsTable();
    const result = await pool.query(
      `SELECT * FROM hw_invoice_items WHERE invoice_no = $1 ORDER BY site_id, line_no`,
      [req.params.invoiceNo],
    );
    return res.json({ ok: true, items: result.rows });
  } catch (err) {
    console.error("HW INVOICE ITEMS DETAIL ERROR:", err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || "Detay alınamadı" });
  }
});

// Manuel fatura ekle (PDF okunamadı / Excel'de yok ise)
app.post("/finance/hw-invoice-items/manual", async (req, res) => {
  try {
    await ensureHwInvoiceItemsTable();
    const b = req.body || {};
    const invoiceNo = (b.invoice_no || "").toString().trim();
    const siteId = (b.site_id || "").toString().trim() || null;
    if (!invoiceNo) {
      return res.status(400).json({ ok: false, error: "Fatura No gerekli" });
    }
    if (!siteId) {
      return res
        .status(400)
        .json({ ok: false, error: "Site ID gerekli (subcon eşlemesi için)" });
    }
    const poNo = (b.po_no || "").toString().trim() || null;
    const lineNo = (b.line_no || "").toString().trim() || null;
    const shipmentNo = (b.shipment_no || "").toString().trim() || null;
    const itemCode = (b.item_code || "").toString().trim() || null;
    const description = (b.description || "").toString().trim() || null;
    const currency = normalizeCurrency(b.currency) || "TRY";
    const unitPrice =
      b.unit_price === "" || b.unit_price == null
        ? null
        : parseFinanceNumber(b.unit_price);
    const qty =
      b.qty === "" || b.qty == null ? null : parseFinanceNumber(b.qty);
    const amountIncl =
      b.amount_incl === "" || b.amount_incl == null
        ? null
        : parseFinanceNumber(b.amount_incl);

    // Önce PO+Line+Shipment ile mevcut master'a bağlamayı dene
    let updated = { rows: [] };
    if (poNo) {
      updated = await pool.query(
        `UPDATE hw_invoice_items
           SET invoice_no = $1,
               invoiced_amount_incl = COALESCE($2, invoiced_amount_incl),
               invoice_matched_at = CURRENT_TIMESTAMP
         WHERE po_no = $3
           AND line_no IS NOT DISTINCT FROM $4
           AND shipment_no IS NOT DISTINCT FROM $5
         RETURNING id`,
        [invoiceNo, amountIncl, poNo, lineNo, shipmentNo],
      );
    }

    if (updated.rows.length > 0) {
      return res.json({
        ok: true,
        mode: "matched",
        matched: updated.rows.length,
        message: `Mevcut ${updated.rows.length} kaleme fatura no yazıldı`,
      });
    }

    // Eşleşmedi → manuel yeni kalem oluştur
    const batchId = "manual-" + Date.now();
    const uploadDate = new Date().toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO hw_invoice_items
       (invoice_no, site_id, po_no, line_no, shipment_no, item_code,
        description, currency, unit_price, billed_qty, ac_qty,
        invoiced_amount_incl, invoice_matched_at, batch_id, upload_date, upload_batch)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,CURRENT_TIMESTAMP,$12,$13,'MANUEL')`,
      [
        invoiceNo,
        siteId,
        poNo,
        lineNo,
        shipmentNo,
        itemCode,
        description,
        currency,
        unitPrice,
        qty,
        amountIncl,
        batchId,
        uploadDate,
      ],
    );
    return res.json({
      ok: true,
      mode: "created",
      message: `Manuel kalem eklendi (Fatura ${invoiceNo})`,
    });
  } catch (err) {
    console.error("HW INVOICE ITEMS MANUAL ERROR:", err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || "Manuel ekleme hatası" });
  }
});

// Yüklenen partileri (batch) listele — tarih, dosya, kalem sayısı
app.get("/finance/hw-invoice-items-batches", async (req, res) => {
  try {
    await ensureHwInvoiceItemsTable();
    const r = await pool.query(`
      SELECT batch_id,
             MIN(upload_date) AS upload_date,
             MAX(upload_batch) AS file_name,
             COUNT(*)::int AS item_count,
             COUNT(*) FILTER (WHERE invoice_no IS NOT NULL)::int AS invoiced_count,
             MIN(created_at) AS created_at
      FROM hw_invoice_items
      WHERE batch_id IS NOT NULL
      GROUP BY batch_id
      ORDER BY MIN(created_at) DESC
    `);
    return res.json({ ok: true, batches: r.rows });
  } catch (err) {
    console.error("HW INVOICE ITEMS BATCHES ERROR:", err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || "Parti listesi alınamadı" });
  }
});

// Tek bir partiyi (batch) sil — sadece o yüklemenin EKLEDİĞİ satırlar gider,
// güncellenmiş eski satırlar (kendi batch'inde) korunur.
app.delete("/finance/hw-invoice-items-batch", async (req, res) => {
  try {
    await ensureHwInvoiceItemsTable();
    const batchId = (req.query.batch_id || "").toString().trim();
    if (!batchId) {
      return res.status(400).json({ ok: false, error: "batch_id gerekli" });
    }
    const r = await pool.query(
      `DELETE FROM hw_invoice_items WHERE batch_id = $1`,
      [batchId],
    );
    return res.json({ ok: true, deleted: r.rowCount || 0, batch_id: batchId });
  } catch (err) {
    console.error("HW INVOICE ITEMS BATCH DELETE ERROR:", err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || "Parti silme hatası" });
  }
});

// Tüm kalem master'ını sıfırla (tam reset — nadiren)
app.delete("/finance/hw-invoice-items-clear", async (req, res) => {
  try {
    await ensureHwInvoiceItemsTable();
    const r = await pool.query(`DELETE FROM hw_invoice_items`);
    return res.json({ ok: true, deleted: r.rowCount || 0 });
  } catch (err) {
    console.error("HW INVOICE ITEMS CLEAR ERROR:", err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || "Temizleme hatası" });
  }
});

// Tüm kalemleri subcon_name (master_works'ten eşlenmiş) ile dök — Excel için
// NOT: /:invoiceNo route'u ile çakışmasın diye ayrı path
app.get("/finance/hw-invoice-items-export", async (req, res) => {
  try {
    await ensureHwInvoiceItemsTable();
    const result = await pool.query(`
      SELECT
        h.invoice_no,
        h.site_id,
        h.item_code,
        h.description,
        h.po_no,
        h.line_no,
        h.shipment_no,
        h.po_qty,
        h.ac_qty,
        h.billed_qty,
        h.currency,
        h.unit_price,
        h.tax_rate,
        h.acceptance_milestone,
        h.project_code,
        h.invoiced_amount_incl,
        sub.subcon_names,
        sub.done_qty_total,
        sub.item_desc_mw
      FROM hw_invoice_items h
      LEFT JOIN LATERAL (
        SELECT
          string_agg(DISTINCT NULLIF(TRIM(m.subcon_name), ''), ', ') AS subcon_names,
          SUM(COALESCE(m.done_qty, 0)) AS done_qty_total,
          MAX(NULLIF(TRIM(m.item_description), '')) AS item_desc_mw
        FROM master_works m
        WHERE UPPER(TRIM(COALESCE(m.site_code, ''))) = UPPER(TRIM(COALESCE(h.site_id, '')))
          AND TRIM(COALESCE(m.item_code, '')) = TRIM(COALESCE(h.item_code, ''))
      ) sub ON TRUE
      ORDER BY (h.invoice_no IS NULL), h.invoice_no, h.site_id, h.line_no
    `);
    return res.json({ ok: true, rows: result.rows });
  } catch (err) {
    console.error("HW INVOICE ITEMS EXPORT ERROR:", err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || "Export verisi alınamadı" });
  }
});

// Kesilen fatura PDF'lerini parse et: Fatura No + Not(PO/Line/Shipment) + tutar
// çıkar, PO+Line+Shipment ile kalem master'a eşleştir, invoice_no'yu yaz.
function parseHwInvoicePdfText(text) {
  const t = text || "";
  // Fatura No: SIM... veya GIB... gibi (büyük harf+rakam, 10+ uzunluk)
  let invoiceNo = null;
  const mFatura = t.match(/Fatura\s*No[:\s]*([A-Z]{2,5}\d{8,})/i);
  if (mFatura) invoiceNo = mFatura[1].trim();
  if (!invoiceNo) {
    const mAny = t.match(/\b([A-Z]{2,5}\d{10,})\b/);
    if (mAny) invoiceNo = mAny[1].trim();
  }
  // Not: PO Line Shipment — bir faturada BİRDEN ÇOK Not satırı olabilir
  // (örn "Not:3621HG3454795-8 1 2" ... "Not:3621HG3454795-8 30 2") → hepsini topla
  const notes = [];
  for (const m of t.matchAll(/Not:\s*([0-9A-Za-z\-]+)\s+(\d+)\s+(\d+)/g)) {
    notes.push({ poNo: m[1].trim(), lineNo: m[2].trim(), shipmentNo: m[3].trim() });
  }
  // Geriye dönük alanlar (ilk not)
  const poNo = notes[0]?.poNo || null;
  const lineNo = notes[0]?.lineNo || null;
  const shipmentNo = notes[0]?.shipmentNo || null;
  // Tutarlar: tüm "X,XX TL" değerleri; son değer = Ödenecek (KDV dahil)
  const tls = (t.match(/([\d.]+,\d{2})\s*TL/g) || []).map((s) =>
    parseFinanceNumber(s.replace(/\s*TL/i, "")),
  );
  const amountIncl = tls.length ? tls[tls.length - 1] : null;
  // KDV-hariç tahmini: ilk değer çoğu faturada Mal Hizmet (birim) tutarı
  const amountExcl = tls.length ? tls[0] : null;
  return { invoiceNo, notes, poNo, lineNo, shipmentNo, amountIncl, amountExcl };
}

const uploadHwPdfs = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 100 },
});
app.post(
  "/finance/hw-invoice-items/match-pdf",
  uploadHwPdfs.array("files"),
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ ok: false, error: "PDF gelmedi" });
      }
      await ensureHwInvoiceItemsTable();

      const results = [];
      let matchedCount = 0;
      for (const file of req.files) {
        const name = file.originalname || "dosya.pdf";
        const isPDF =
          name.toLowerCase().endsWith(".pdf") ||
          file.mimetype === "application/pdf";
        try {
          const text = await extractPdfText(file.buffer, isPDF);
          const parsed = parseHwInvoicePdfText(text);
          // Fatura no dosya adından da düşebilir (SIM2026000000724.pdf)
          if (!parsed.invoiceNo) {
            const mName = name.match(/([A-Z]{2,5}\d{8,})/i);
            if (mName) parsed.invoiceNo = mName[1];
          }

          if (!parsed.notes?.length || !parsed.invoiceNo) {
            results.push({
              file: name,
              matched: 0,
              invoice_no: parsed.invoiceNo,
              po_no: parsed.poNo,
              status: "Not satırı / Fatura No okunamadı",
            });
            continue;
          }

          // Faturadaki TÜM Not satırlarını (PO+Line+Shipment) eşle
          let fileMatched = 0;
          let autoCreated = 0;
          const missedNotes = [];
          for (const n of parsed.notes) {
            const upd = await pool.query(
              `UPDATE hw_invoice_items
                 SET invoice_no = $1,
                     invoiced_amount_incl = $2,
                     invoiced_amount_excl = $3,
                     invoice_matched_at = CURRENT_TIMESTAMP
               WHERE po_no = $4
                 AND line_no IS NOT DISTINCT FROM $5
                 AND shipment_no IS NOT DISTINCT FROM $6
               RETURNING id`,
              [
                parsed.invoiceNo,
                parsed.amountIncl,
                parsed.amountExcl,
                n.poNo,
                n.lineNo,
                n.shipmentNo,
              ],
            );
            if (upd.rows.length > 0) {
              fileMatched += upd.rows.length;
              continue;
            }
            // Kalem master'da yok → PO listesinden otomatik tamamla
            // (PDF-only akış: kullanıcı yalnız fatura PDF'lerini yükler)
            const po = await pool.query(
              `SELECT project_code, site_code, item_code, item_description,
                      unit_price, currency, requested_qty
                 FROM po_rows
                WHERE po_no = $1
                  AND (COALESCE($2,'') = '' OR COALESCE(po_line_no,'') = COALESCE($2,''))
                ORDER BY CASE WHEN COALESCE(shipment_no,'') = COALESCE($3,'') THEN 0 ELSE 1 END,
                         id DESC
                LIMIT 1`,
              [n.poNo, n.lineNo, n.shipmentNo],
            );
            if (po.rows[0]) {
              const p = po.rows[0];
              await pool.query(
                `INSERT INTO hw_invoice_items
                   (invoice_no, site_id, po_no, line_no, shipment_no,
                    po_qty, unit_price, currency, item_code, project_code, description,
                    upload_batch, batch_id, upload_date,
                    invoiced_amount_incl, invoiced_amount_excl, invoice_matched_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                         'PDF-otomatik','PDF-otomatik',CURRENT_DATE,$12,$13,CURRENT_TIMESTAMP)`,
                [
                  parsed.invoiceNo, p.site_code, n.poNo, n.lineNo, n.shipmentNo,
                  Number(p.requested_qty || 0), Number(p.unit_price || 0),
                  p.currency || "TRY", p.item_code, p.project_code, p.item_description,
                  parsed.amountIncl, parsed.amountExcl,
                ],
              );
              fileMatched += 1;
              autoCreated += 1;
            } else {
              missedNotes.push(`${n.poNo}/${n.lineNo}/${n.shipmentNo}`);
            }
          }

          matchedCount += fileMatched;
          results.push({
            file: name,
            matched: fileMatched,
            invoice_no: parsed.invoiceNo,
            po_no: parsed.poNo,
            line_no: parsed.notes.length > 1 ? `${parsed.notes.length} Not satırı` : parsed.lineNo,
            shipment_no: parsed.notes.length > 1 ? "" : parsed.shipmentNo,
            amount_incl: parsed.amountIncl,
            status:
              fileMatched === 0
                ? "Eşleşen kalem yok — PO/Line sistemdeki PO listesinde de bulunamadı"
                : missedNotes.length
                  ? `OK · ${fileMatched} eşleşti${autoCreated ? ` (${autoCreated} PO listesinden tamamlandı)` : ""}, ${missedNotes.length} eşleşmedi: ${missedNotes.slice(0, 3).join(", ")}${missedNotes.length > 3 ? "…" : ""}`
                  : `OK · ${fileMatched} kalem${autoCreated ? ` (${autoCreated} PO listesinden tamamlandı)` : ""}`,
          });
        } catch (e) {
          results.push({
            file: name,
            matched: 0,
            status: `Parse hatası: ${e.message}`,
          });
        }
      }

      const unmatched = results.filter((r) => r.matched === 0);
      return res.json({
        ok: true,
        total_files: req.files.length,
        matched_items: matchedCount,
        unmatched_count: unmatched.length,
        results,
      });
    } catch (err) {
      console.error("HW INVOICE PDF MATCH ERROR:", err);
      return res
        .status(500)
        .json({ ok: false, error: err.message || "PDF eşleştirme hatası" });
    }
  },
);

/* ================== ÇEK & SENET (KISITLI ERİŞİM) ================== */
// Firmanın verdiği çek/senetlerin vade takibi — icra/bloke riskine karşı.
// YALNIZ aşağıdaki kişiler erişebilir; menüde başkasına hiç görünmez.
pool.query(`CREATE TABLE IF NOT EXISTS cek_senet (
  id SERIAL PRIMARY KEY,
  tip TEXT NOT NULL DEFAULT 'CEK',
  karsi_taraf TEXT NOT NULL,
  tutar NUMERIC NOT NULL,
  banka TEXT,
  belge_no TEXT,
  duzenleme_tarihi DATE,
  vade_tarihi DATE NOT NULL,
  aciklama TEXT,
  durum TEXT DEFAULT 'BEKLIYOR',
  odeme_tarihi DATE,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`).catch(() => {});
// Ödendi işaretlenince Nakit Akışı'na (cashflow_odeme) düşen gider kaydının
// bağı — geri alınırsa oradaki satır da otomatik silinir.
pool.query(`ALTER TABLE cek_senet ADD COLUMN IF NOT EXISTS cashflow_id INTEGER`).catch(() => {});

const CEKSENET_YETKI = [
  "orhan.bedir@simsektel.com",
  "duzgun.simsek@simsektel.com",
  "muhasebe@simsektel.com",
  "erencan.simsek@simsektel.com",
];
function cekSenetYetkili(req) {
  return CEKSENET_YETKI.includes(String(req.user?.email || "").toLowerCase().trim());
}

app.get("/finance/cek-senet", authMiddleware, async (req, res) => {
  try {
    if (!cekSenetYetkili(req)) return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    const r = await pool.query(`
      SELECT id, tip, karsi_taraf, tutar, banka, belge_no,
        to_char(duzenleme_tarihi,'YYYY-MM-DD') AS duzenleme_tarihi,
        to_char(vade_tarihi,'YYYY-MM-DD') AS vade_tarihi,
        COALESCE(aciklama,'') AS aciklama, durum,
        to_char(odeme_tarihi,'YYYY-MM-DD') AS odeme_tarihi, created_by
      FROM cek_senet
      ORDER BY CASE durum WHEN 'BEKLIYOR' THEN 0 ELSE 1 END, vade_tarihi ASC, id
    `);
    res.json({ ok: true, rows: r.rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.post("/finance/cek-senet", authMiddleware, async (req, res) => {
  try {
    if (!cekSenetYetkili(req)) return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    const { tip, karsi_taraf, tutar, banka, belge_no, duzenleme_tarihi, vade_tarihi, aciklama } = req.body;
    if (!karsi_taraf || !Number(tutar || 0) || !vade_tarihi)
      return res.status(400).json({ ok: false, error: "Karşı taraf, tutar ve vade tarihi zorunlu" });
    const r = await pool.query(`INSERT INTO cek_senet
        (tip, karsi_taraf, tutar, banka, belge_no, duzenleme_tarihi, vade_tarihi, aciklama, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [String(tip || "CEK").toUpperCase() === "SENET" ? "SENET" : "CEK",
       String(karsi_taraf).trim(), Number(tutar), banka || null, belge_no || null,
       duzenleme_tarihi || null, vade_tarihi, aciklama || null,
       String(req.user?.email || "")]);
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.put("/finance/cek-senet/:id", authMiddleware, async (req, res) => {
  try {
    if (!cekSenetYetkili(req)) return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    const { tip, karsi_taraf, tutar, banka, belge_no, duzenleme_tarihi, vade_tarihi, aciklama } = req.body;
    if (!karsi_taraf || !Number(tutar || 0) || !vade_tarihi)
      return res.status(400).json({ ok: false, error: "Karşı taraf, tutar ve vade tarihi zorunlu" });
    await pool.query(`UPDATE cek_senet SET
        tip=$1, karsi_taraf=$2, tutar=$3, banka=$4, belge_no=$5,
        duzenleme_tarihi=$6, vade_tarihi=$7, aciklama=$8
      WHERE id=$9`,
      [String(tip || "CEK").toUpperCase() === "SENET" ? "SENET" : "CEK",
       String(karsi_taraf).trim(), Number(tutar), banka || null, belge_no || null,
       duzenleme_tarihi || null, vade_tarihi, aciklama || null, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.put("/finance/cek-senet/:id/odendi", authMiddleware, async (req, res) => {
  // Ödendi = nakit çıkışı gerçekleşti → Nakit Akışı'na otomatik gider satırı
  // (kategori CEKSENET, ödeme tarihiyle). Bağ cashflow_id'de tutulur.
  const client = await pool.connect();
  try {
    if (!cekSenetYetkili(req)) return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    const odemeTarihi = req.body?.odeme_tarihi || new Date().toISOString().slice(0, 10);
    await client.query("BEGIN");
    const cur = await client.query(`SELECT * FROM cek_senet WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (!cur.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ ok: false, error: "Kayıt bulunamadı" }); }
    const cs = cur.rows[0];
    if (cs.durum === "ODENDI") { await client.query("ROLLBACK"); return res.json({ ok: true }); }
    const acik = `${cs.tip === "SENET" ? "Senet" : "Çek"} ödemesi — ${cs.karsi_taraf}${cs.belge_no ? ` (${cs.belge_no})` : ""}${cs.banka ? ` · ${cs.banka}` : ""}`;
    const cf = await client.query(
      `INSERT INTO cashflow_odeme (kategori, tarih, tutar, donem, aciklama, marka)
       VALUES ('CEKSENET', $1, $2, to_char($1::date,'YYYY-MM'), $3, 'ERC') RETURNING id`,
      [odemeTarihi, cs.tutar, acik]);
    await client.query(`UPDATE cek_senet SET durum='ODENDI', odeme_tarihi=$1, cashflow_id=$2 WHERE id=$3`,
      [odemeTarihi, cf.rows[0].id, req.params.id]);
    await client.query("COMMIT");
    res.json({ ok: true, cashflow_id: cf.rows[0].id });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); res.status(500).json({ ok: false, error: e.message }); }
  finally { client.release(); }
});
app.put("/finance/cek-senet/:id/geri-al", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!cekSenetYetkili(req)) return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    await client.query("BEGIN");
    const cur = await client.query(`SELECT cashflow_id FROM cek_senet WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (cur.rows[0]?.cashflow_id)
      await client.query(`DELETE FROM cashflow_odeme WHERE id=$1`, [cur.rows[0].cashflow_id]);
    await client.query(`UPDATE cek_senet SET durum='BEKLIYOR', odeme_tarihi=NULL, cashflow_id=NULL WHERE id=$1`, [req.params.id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); res.status(500).json({ ok: false, error: e.message }); }
  finally { client.release(); }
});
app.delete("/finance/cek-senet/:id", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!cekSenetYetkili(req)) return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
    await client.query("BEGIN");
    const cur = await client.query(`SELECT cashflow_id FROM cek_senet WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (cur.rows[0]?.cashflow_id)
      await client.query(`DELETE FROM cashflow_odeme WHERE id=$1`, [cur.rows[0].cashflow_id]);
    await client.query(`DELETE FROM cek_senet WHERE id=$1`, [req.params.id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); res.status(500).json({ ok: false, error: e.message }); }
  finally { client.release(); }
});

/* ================== ZIRVE E-FATURA İÇE AKTAR ================== */
// Zirve e-Dönüşüm "Gelen Faturalar" Excel'i → invoice_entries senkronu.
// mode=preview: satırları analiz eder (DB'ye yazmaz); mode=commit:
// eşleşen + kullanıcının işaretlediği (accept_vkns) satırları upsert eder.
// Bir kez işaretlenen VKN zirve_taseron_vkn'e öğretilir, sonraki yüklemede
// otomatik eşleşir. Fatura no bazlı upsert — çift kayıt oluşmaz.
pool.query(`CREATE TABLE IF NOT EXISTS zirve_taseron_vkn (
  vkn TEXT PRIMARY KEY,
  taseron_adi TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`).catch(() => {});

const ZIRVE_TASERON_KEYS = ["FEDERAL", "UBS", "2KX", "NETELCOM", "NETELKOM", "FERRUM", "ETAS", "ETAŞ", "SURVEY", "AHY"];
const SIMSEK_VKN = "8110536413"; // Şimşek Haberleşme VKN — giden (iade) satır ayrımı için

app.post("/finance/zirve-import", requireFinanceAuth, upload.array("files"), async (req, res) => {
  try {
    const files = req.files && req.files.length ? req.files : (req.file ? [req.file] : []);
    if (!files.length) return res.status(400).json({ ok: false, error: "Dosya yok" });
    const mode = String(req.body.mode || "preview");
    let acceptVkns = [];
    try { acceptVkns = JSON.parse(req.body.accept_vkns || "[]"); } catch { acceptVkns = []; }
    const acceptSet = new Set(acceptVkns.map(String));

    // Tüm dosyaların satırlarını birleştir (fatura no bazlı tekilleştirilir)
    const rows = [];
    for (const f of files) {
      const workbook = XLSX.read(f.buffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows.push(...XLSX.utils.sheet_to_json(sheet, { defval: null }));
    }
    if (!rows.length) return res.status(400).json({ ok: false, error: "Excel boş" });

    const bilinen = await pool.query(`SELECT vkn, taseron_adi FROM zirve_taseron_vkn`);
    const vknMap = new Map(bilinen.rows.map((r) => [String(r.vkn), r.taseron_adi]));

    const parseTarih = (s) => {
      const t = String(s || "").trim();          // DD-MM-YYYY
      const m = t.match(/^(\d{2})-(\d{2})-(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
    };

    const vknFromUrn = (s) => {
      const m = String(s || "").match(/(\d{10,11})/);
      return m ? m[1] : "";
    };

    const items = [];
    for (const r of rows) {
      const gonderenVkn = String(r["Gönderen"] || "").trim() || vknFromUrn(r["Gönderen URN"]);
      const faturaNo = String(r["Fatura No"] || "").trim();
      const tarih = parseTarih(r["Fatura Tarihi"]);
      const dahil = Number(r["Vergiler Dahil Tutar"] || r["Fatura Toplamı"] || 0);
      const haric = Number(r["Vergiler Hariç Tutar"] || r["Mal Hizmet Tutarı"] || 0);
      const pb = String(r["Para Birimi"] || "TRY").trim().toUpperCase() || "TRY";
      const fatTuru = String(r["Fatura Türü"] || "").toUpperCase();

      // Satır yönü: gönderen biz isek GİDEN (iade adayı), değilse GELEN.
      // VKN + unvan çifte kontrol (Zirve hesap no'su VKN sanılmasın diye)
      const gonderenUnvanUp = String(r["Gönderen Unvanı"] || "").toUpperCase();
      const giden = gonderenVkn === SIMSEK_VKN ||
        gonderenUnvanUp.includes("ŞİMŞEK HABERLEŞME") ||
        gonderenUnvanUp.includes("SIMSEK HABERLESME");
      const vkn = giden
        ? (String(r["Alıcı"] || "").trim() || vknFromUrn(r["Alıcı URN"]))
        : gonderenVkn;
      const unvan = giden
        ? String(r["Alıcı Unvanı"] || "").trim()
        : String(r["Gönderen Unvanı"] || "").trim();
      if (!faturaNo || !unvan) continue;

      // Giden dosyada yalnız İADE'ler taşeron carisini ilgilendirir;
      // satış faturaları (HW/müşteri) kapsam dışıdır
      if (giden && !fatTuru.includes("IADE")) {
        items.push({ vkn, unvan, fatura_no: faturaNo, tarih, dahil, haric, pb, durum: "giden", taseron: null });
        continue;
      }

      let taseron = vknMap.get(vkn) || null;
      if (!taseron && ZIRVE_TASERON_KEYS.some((k) => unvan.toUpperCase().includes(k))) taseron = unvan;
      if (!taseron && acceptSet.has(vkn)) taseron = unvan;
      const iade = giden || fatTuru.includes("IADE");
      items.push({
        vkn, unvan, fatura_no: faturaNo, tarih, dahil, haric, pb,
        durum: taseron ? (iade ? "iade" : "eslesen") : "atlanan",
        taseron, iade,
      });
    }

    // Fatura no bazlı tekilleştir (aynı fatura birden çok dosyada/sayfada olabilir)
    const tekil = new Map();
    for (const it of items) tekil.set(`${it.fatura_no}|${it.iade ? "I" : "G"}`, it);
    const itemsTekil = [...tekil.values()];

    if (mode !== "commit") {
      return res.json({ ok: true, mode: "preview", items: itemsTekil });
    }

    // COMMIT: eşleşenleri upsert et, işaretlenen yeni VKN'leri öğren.
    // İade: kalan_borc = -toplam → taşeron carisinden otomatik düşer
    // (FIFO ödeme motoru kalan_borc>0 baktığı için iadeye ödeme dağıtmaz).
    let inserted = 0, updated = 0;
    for (const it of itemsTekil) {
      if (it.durum !== "eslesen" && it.durum !== "iade") continue;
      const firma = it.taseron.toUpperCase().includes("AHY") ? "AHY" : "SIMSEK";
      const mevcut = await pool.query(
        `SELECT id, COALESCE(odenen_tutar,0) AS odenen FROM invoice_entries WHERE fatura_no = $1 LIMIT 1`,
        [it.fatura_no],
      );
      const kdv = +(it.dahil - it.haric).toFixed(2);
      const turu = it.iade ? "IADE" : "GELEN";
      const notu = it.iade ? "Zirve içe aktarım (iade)" : "Zirve içe aktarım";
      if (mevcut.rows[0]) {
        const odenen = Number(mevcut.rows[0].odenen || 0);
        await pool.query(
          `UPDATE invoice_entries SET
             tedarikci=$1, rf_montaj_firma=$1, fatura_tarihi=$2,
             tutar=$3, kdv=$4, toplam_tutar=$5,
             kalan_borc=$6, fatura_turu=$7, currency=$8
           WHERE id=$9`,
          [it.taseron, it.tarih, it.haric, kdv, it.dahil,
           it.iade ? -it.dahil : Math.max(0, it.dahil - odenen),
           turu, it.pb, mevcut.rows[0].id],
        );
        updated++;
      } else {
        await pool.query(
          `INSERT INTO invoice_entries
             (tedarikci, rf_montaj_firma, fatura_no, fatura_tarihi,
              tutar, kdv, toplam_tutar, odenen_tutar, kalan_borc,
              note, fatura_turu, currency, firma)
           VALUES ($1,$1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,$11)`,
          [it.taseron, it.fatura_no, it.tarih, it.haric, kdv, it.dahil,
           it.iade ? -it.dahil : it.dahil, notu, turu, it.pb, firma],
        );
        inserted++;
      }
      // Yeni işaretlenen VKN'yi öğren
      if (it.vkn && !vknMap.has(it.vkn)) {
        await pool.query(
          `INSERT INTO zirve_taseron_vkn (vkn, taseron_adi) VALUES ($1,$2)
           ON CONFLICT (vkn) DO NOTHING`,
          [it.vkn, it.taseron],
        );
        vknMap.set(it.vkn, it.taseron);
      }
    }
    const atlanan = itemsTekil.filter((i) => i.durum === "atlanan").length;
    res.json({ ok: true, mode: "commit", inserted, updated, atlanan, items: itemsTekil });
  } catch (e) {
    console.error("ZIRVE IMPORT ERROR:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ================== FINANCE EXPENSE ADD ================== */
app.post("/finance/expense/add", async (req, res) => {
  try {
    const { expense_date, expense_type, description, amount } = req.body;

    const result = await pool.query(
      `
      INSERT INTO finance_expenses
      (expense_date, expense_type, description, amount)
      VALUES ($1,$2,$3,$4)
      RETURNING *
      `,
      [
        expense_date || null,
        expense_type || "Genel Gider",
        description || null,
        Number(amount || 0),
      ],
    );

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error("FINANCE EXPENSE ADD ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== FINANCE EXPENSE LIST ================== */
app.get("/finance/expenses/list", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM finance_expenses
      ORDER BY expense_date DESC NULLS LAST, id DESC
    `);

    res.json({ ok: true, rows: result.rows || [] });
  } catch (err) {
    console.error("FINANCE EXPENSE LIST ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/debug/db-check", async (req, res) => {
  try {
    const dbName = await pool.query(`SELECT current_database() AS db`);
    const sample = await pool.query(`
      SELECT invoice_no, payment_date, due_date
      FROM hw_payment_rows
      ORDER BY due_date ASC
      LIMIT 10
    `);

    res.json({
      ok: true,
      db: dbName.rows[0]?.db,
      rows: sample.rows,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== NAKİT AKIŞI MANUEL ÖDEMELER ==================
   Araç kirası / ticket-yemek / diğer ödemeler ödendikçe buradan girilir.
   Maaş ödemeleri İK'daki maas_odeme tablosundan otomatik gelir. */
async function ensureCashflowOdemeTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cashflow_odeme (
      id SERIAL PRIMARY KEY,
      kategori TEXT NOT NULL,
      tarih DATE NOT NULL,
      tutar NUMERIC NOT NULL,
      donem TEXT,
      aciklama TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
  // Firma ayrımı (16.07.2026): ERC (Şimşek) girişlerini AHY görmez. Eski
  // kayıtların tümü (bugünküler dahil) ERC sayılır.
  await pool.query(`ALTER TABLE cashflow_odeme ADD COLUMN IF NOT EXISTS marka TEXT DEFAULT 'ERC'`);
}

app.get("/finance/cashflow-odeme", requireFinanceAuth, async (req, res) => {
  try {
    await ensureCashflowOdemeTable();
    const { yil, ay } = req.query;
    if (!yil || !ay) return res.status(400).json({ ok: false, error: "yil ve ay gerekli" });
    // ERC Nakit Akışı YALNIZ ERC'yi gösterir: AHY işaretli manuel girişler
    // AHY panelinde; AHY personelinin devir (15.07.2026) sonrası maaş/avans
    // ödemeleri de AHY sorumluluğundadır, buraya yansımaz.
    const r = await pool.query(
      `SELECT id, kategori, TO_CHAR(tarih,'YYYY-MM-DD') AS tarih, tutar, donem, aciklama,
              UPPER(COALESCE(marka,'ERC')) AS marka
       FROM cashflow_odeme
       WHERE EXTRACT(YEAR FROM tarih)=$1 AND EXTRACT(MONTH FROM tarih)=$2
         AND UPPER(COALESCE(marka,'ERC'))='ERC'
       ORDER BY tarih, id`, [yil, ay]);
    // Maaş ödemeleri: İK'daki maas_odeme kayıtları (bu ay yapılan ödemeler)
    const m = await pool.query(
      `SELECT m.id, TO_CHAR(m.tarih,'YYYY-MM-DD') AS tarih,
              (COALESCE(m.bankadan,0)+COALESCE(m.elden,0)) AS tutar,
              m.donem, p.ad_soyad
       FROM maas_odeme m JOIN personel p ON p.id = m.personel_id
       WHERE EXTRACT(YEAR FROM m.tarih)=$1 AND EXTRACT(MONTH FROM m.tarih)=$2
         AND (COALESCE(p.marka,'ERC')='ERC' OR m.tarih < DATE '2026-07-15')`,
      [yil, ay]).catch(() => ({ rows: [] }));
    // Maaş avansları: avans tablosu (turu MAAS) — nakit çıkışı ÖDENDİĞİ GÜN
    // gerçekleşir (dönem hangi ayın maaşı olursa olsun), maaş satırına eklenir
    const mav = await pool.query(
      `SELECT ('MA' || a.id) AS id, TO_CHAR(a.tarih,'YYYY-MM-DD') AS tarih,
              a.tutar, COALESCE(a.donem, TO_CHAR(a.tarih,'YYYY-MM')) AS donem,
              (p.ad_soyad || ' · maaş avansı') AS ad_soyad
       FROM avans a JOIN personel p ON p.id = a.personel_id
       WHERE UPPER(COALESCE(a.avans_turu,'MAAS'))='MAAS'
         AND EXTRACT(YEAR FROM a.tarih)=$1 AND EXTRACT(MONTH FROM a.tarih)=$2
         AND (COALESCE(p.marka,'ERC')='ERC' OR a.tarih < DATE '2026-07-15')`,
      [yil, ay]).catch(() => ({ rows: [] }));
    // İş avansları: PD (Direktör) onayından geçenler — otomatik gider
    // Tarih: ödeme tarihi varsa o, yoksa direktör onay tarihi
    const av = await pool.query(
      `SELECT id,
              TO_CHAR(COALESCE(odeme_tarihi, direktor_onay_tarihi),'YYYY-MM-DD') AS tarih,
              tutar, talep_eden_ad, gider_turu, aciklama, durum
       FROM is_avans_talep
       WHERE durum IN ('DIREKTOR_ONAY','TAMAMLANDI')
         AND UPPER(COALESCE(firma,'ERC')) = 'ERC'
         AND COALESCE(odeme_tarihi, direktor_onay_tarihi) IS NOT NULL
         AND EXTRACT(YEAR FROM COALESCE(odeme_tarihi, direktor_onay_tarihi))=$1
         AND EXTRACT(MONTH FROM COALESCE(odeme_tarihi, direktor_onay_tarihi))=$2`,
      [yil, ay]).catch(() => ({ rows: [] }));
    res.json({ ok: true, odemeler: r.rows, maaslar: [...m.rows, ...mav.rows], avanslar: av.rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post("/finance/cashflow-odeme", requireFinanceAuth, async (req, res) => {
  try {
    await ensureCashflowOdemeTable();
    const { kategori, tarih, tutar, donem, aciklama, marka } = req.body;
    if (!kategori || !tarih || !tutar)
      return res.status(400).json({ ok: false, error: "kategori, tarih, tutar zorunlu" });
    const markaVal = String(marka || "ERC").toUpperCase() === "AHY" ? "AHY" : "ERC";
    const r = await pool.query(
      `INSERT INTO cashflow_odeme (kategori,tarih,tutar,donem,aciklama,marka)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [kategori, tarih, parseFinanceNumber(tutar), donem || null, aciklama || null, markaVal]);
    res.json({ ok: true, row: r.rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete("/finance/cashflow-odeme/:id", requireFinanceAuth, async (req, res) => {
  try {
    // Çek/senet ödemeleri otomatik kayıttır — buradan silinemez; Çek & Senet
    // panelinden "Geri Al" ile kaldırılır (aynı anda belge de BEKLIYOR'a döner).
    const k = await pool.query(`SELECT kategori FROM cashflow_odeme WHERE id=$1`, [req.params.id]);
    if (k.rows[0]?.kategori === "CEKSENET")
      return res.status(400).json({ ok: false, error: "Çek/Senet ödemesi buradan silinemez — Çek & Senet panelinden Geri Al kullanın" });
    await pool.query(`DELETE FROM cashflow_odeme WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ================== FINANCE CASHFLOW MONTHLY ================== */
app.get("/finance/cashflow-monthly", requireFinanceAuth, async (req, res) => {
  try {
    const { yil, ay } = req.query;
    if (!yil || !ay) return res.status(400).json({ ok: false, error: "yil ve ay gerekli" });

    const monthStr = `${yil}-${String(ay).padStart(2,"0")}`;

    // USD kayıtları TL'ye çevir (TCMB satış kuru) — Gelecek Ödemeler paneli ile tutarlı
    let usdRate = 0;
    try { usdRate = Number(await getTcmbUsdTrySellingRate()) || 0; } catch { usdRate = 0; }
    const AMT = (col, idx = 2) =>
      `CASE WHEN UPPER(COALESCE(currency,'TRY'))='USD' THEN COALESCE(${col},0) * $${idx} ELSE COALESCE(${col},0) END`;

    // 1) Gerçekleşen ödemeler — payment_date bu ayda, payment_amount > 0
    const received = await pool.query(`
      SELECT
        EXTRACT(DAY FROM payment_date)::int AS gun,
        SUM(${AMT("payment_amount")}) AS tutar
      FROM hw_payment_rows
      WHERE to_char(payment_date, 'YYYY-MM') = $1
        AND COALESCE(payment_amount, 0) > 0
      GROUP BY gun
      ORDER BY gun
    `, [monthStr, usdRate]);

    // Türkiye saati ile bugünün tarihi
    const todayTR = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" }));
    const todayStr = `${todayTR.getFullYear()}-${String(todayTR.getMonth()+1).padStart(2,'0')}-${String(todayTR.getDate()).padStart(2,'0')}`;

    // 2a) Gelecek bekleyen tahsilat — due_date bu ayda, DUE_DATE > BUGÜN, remaining_amount > 0
    const pending = await pool.query(`
      SELECT
        EXTRACT(DAY FROM due_date)::int AS gun,
        SUM(${AMT("remaining_amount", 3)}) AS tutar
      FROM hw_payment_rows
      WHERE to_char(due_date, 'YYYY-MM') = $1
        AND COALESCE(remaining_amount, 0) > 0
        AND due_date > $2::date
      GROUP BY gun
      ORDER BY gun
    `, [monthStr, todayStr, usdRate]);

    // 2b) Geciken/bugün vadeli ödenmemiş — due_date bu ayda, DUE_DATE <= BUGÜN, remaining_amount > 0
    const overdueHw = await pool.query(`
      SELECT
        EXTRACT(DAY FROM due_date)::int AS gun,
        SUM(${AMT("remaining_amount", 3)}) AS tutar
      FROM hw_payment_rows
      WHERE to_char(due_date, 'YYYY-MM') = $1
        AND COALESCE(remaining_amount, 0) > 0
        AND due_date <= $2::date
      GROUP BY gun
      ORDER BY gun
    `, [monthStr, todayStr, usdRate]);

    // 3) Kesintiler — iki kaynak:
    //   a) Mahsup edilmiş: payment_amount < 0 VE remaining = 0 → payment_date bazlı
    //   b) Bekleyen: remaining_amount < 0 → due_date bazlı
    //   İki set birbirini dışladığı için toplama güvenlidir.
    const deductions = await pool.query(`
      SELECT gun, SUM(tutar)::numeric AS tutar FROM (
        SELECT
          EXTRACT(DAY FROM payment_date)::int AS gun,
          SUM(${AMT("payment_amount")}) AS tutar
        FROM hw_payment_rows
        WHERE to_char(payment_date, 'YYYY-MM') = $1
          AND COALESCE(payment_amount, 0) < 0
          AND COALESCE(remaining_amount, 0) = 0
        GROUP BY gun

        UNION ALL

        SELECT
          EXTRACT(DAY FROM due_date)::int AS gun,
          SUM(${AMT("remaining_amount")}) AS tutar
        FROM hw_payment_rows
        WHERE to_char(due_date, 'YYYY-MM') = $1
          AND COALESCE(remaining_amount, 0) < 0
        GROUP BY gun
      ) t
      GROUP BY gun
      ORDER BY gun
    `, [monthStr, usdRate]);

    res.json({
      ok: true,
      received:     received.rows,    // payment_date bazlı alınan
      pending:      pending.rows,     // due_date > bugün
      overdue_hw:   overdueHw.rows,   // due_date <= bugün, henüz tahsil edilmemiş
      deductions:   deductions.rows,  // negatif remaining (iade/kesinti)
    });
  } catch(e) {
    console.error("CASHFLOW MONTHLY ERROR:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ================== FINANCE UPCOMING COLLECTIONS ================== */
app.get("/finance/upcoming-payments", async (req, res) => {
  try {
    const upcomingData = await buildUpcomingCollectionsData();
    const overdueData = await buildOverdueInvoicesData();

    // Bugün tahsil edilenler satır bazında: fatura → 2KX/AHY payı dağıtılır
    const todayReceivedResult = await pool.query(`
      SELECT invoice_no,
             COALESCE(payment_amount, 0) AS amt,
             UPPER(COALESCE(currency, 'TRY')) AS currency
      FROM hw_payment_rows
      WHERE payment_date IS NOT NULL
        AND payment_date::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Istanbul')::date
        AND COALESCE(payment_amount, 0) <> 0
    `);
    let todayReceived = 0, todayR2kx = 0, todayRAhy = 0;
    for (const r of todayReceivedResult.rows) {
      const amt = r.currency === "USD"
        ? Number(r.amt) * Number(upcomingData.usdRate || 0)
        : Number(r.amt);
      todayReceived += amt;
      const ia = upcomingData.invAgg?.get?.(r.invoice_no);
      if (ia && ia.total > 0) {
        todayR2kx += amt * (ia.k2kx / ia.total);
        todayRAhy += amt * (ia.kahy / ia.total);
      }
    }

    res.json({
      ok: true,
      rows: upcomingData.rows,
      overdue_payment_rows: upcomingData.overdue_payment_rows,  // hw_payment_rows geciken
      overdue_rows: overdueData.rows,                           // hw_invoice_rows geciken
      summary: {
        today_total: upcomingData.summary.today_total,
        week_total: upcomingData.summary.week_total,
        overdue_payment_total: upcomingData.summary.overdue_payment_total,
        today_received_total: todayReceived,
        today_received_2kx: todayR2kx,
        today_received_ahy: todayRAhy,
        overdue_total: overdueData.total,
      },
    });
  } catch (err) {
    console.error("UPCOMING PAYMENTS ERROR:", err);
    res.status(500).json({
      ok: false,
      error: "Gelecek tahsilat planı alınırken hata oluştu",
      detail: err.message,
    });
  }
});

app.get("/finance/debug-tables", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Yetkiniz yok" });
  }
  try {
    const tables = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    res.json({ ok: true, tables: tables.rows || [] });
  } catch (err) {
    console.error("DEBUG TABLES ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== SUBCON PAYABLES ================== */
app.get("/finance/subcon-payables", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        subcon_name,
        COALESCE(invoice_amount, 0) AS invoice_amount,
        COALESCE(paid_amount, 0) AS paid_amount,
        COALESCE(invoice_amount, 0) - COALESCE(payment_amount, 0) AS remaining_amount,
        COALESCE(note, '') AS note
      FROM subcon_payables
      ORDER BY subcon_name ASC
    `);

    res.json({ ok: true, rows: result.rows || [] });
  } catch (err) {
    console.error("SUBCON PAYABLES ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/finance/subcon-payables/add", async (req, res) => {
  try {
    const { subcon_name, invoice_amount, paid_amount, note } = req.body;

    const result = await pool.query(
      `
      INSERT INTO subcon_payables
      (subcon_name, invoice_amount, paid_amount, note)
      VALUES ($1,$2,$3,$4)
      RETURNING *
      `,
      [
        subcon_name,
        Number(invoice_amount || 0),
        Number(paid_amount || 0),
        note || null,
      ],
    );

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error("SUBCON PAYABLE ADD ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== FINANCE OVERDUE INVOICES ================== */
app.get("/finance/overdue-invoices", async (req, res) => {
  try {
    await ensureHwInvoiceTable();

    const invoiceResult = await pool.query(`
     SELECT
       invoice_no,
       invoice_date,
       COALESCE(terms, '') AS terms,
       COALESCE(invoice_status, '') AS invoice_status,
       COALESCE(currency, 'TRY') AS currency
      FROM hw_invoice_rows
      WHERE invoice_no IS NOT NULL
       AND invoice_date IS NOT NULL
      ORDER BY invoice_date ASC, id ASC
    `);

    const paymentResult = await pool.query(`
      SELECT
        COALESCE(invoice_no, '') AS invoice_no,
        COALESCE(invoice_amount, 0) - COALESCE(payment_amount, 0) AS remaining_amount,
        COALESCE(currency, 'TRY') AS currency,
        payment_date,
        due_date,
        COALESCE(customer_name, '') AS customer_name,
        COALESCE(payment_method, '') AS payment_method,
        COALESCE(supplier_name, '') AS supplier_name
      FROM hw_payment_rows
    `);

    const paymentMap = new Map();

    paymentResult.rows.forEach((row) => {
      const key = String(row.invoice_no || "").trim();
      if (!key) return;
      paymentMap.set(key, row);
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const overdueRows = [];

    for (const inv of invoiceResult.rows) {
      const invoiceNo = String(inv.invoice_no || "").trim();
      if (!invoiceNo) continue;

      const paymentInfo = findPaymentInfoByInvoiceNo(
        paymentMap,
        invoiceNo,
        inv.currency,
      );
      if (!paymentInfo) continue;

      const remainingAmount = Number(paymentInfo.remaining_amount || 0);
      if (remainingAmount <= 0) continue;

      const invoiceStatus = String(inv.invoice_status || "")
        .trim()
        .toUpperCase();

      if (invoiceStatus === "PAID BY HUAWEI") continue;

      const invoiceDateObj = new Date(inv.invoice_date);
      invoiceDateObj.setHours(0, 0, 0, 0);

      const addDays = getTermDays(inv.terms);
      const expectedDateObj = new Date(invoiceDateObj);
      expectedDateObj.setDate(expectedDateObj.getDate() + addDays);
      expectedDateObj.setHours(0, 0, 0, 0);

      if (expectedDateObj.getTime() > today.getTime()) continue;

      const yyyy = expectedDateObj.getFullYear();
      const mm = String(expectedDateObj.getMonth() + 1).padStart(2, "0");
      const dd = String(expectedDateObj.getDate()).padStart(2, "0");
      const expectedPaymentDate = `${yyyy}-${mm}-${dd}`;

      overdueRows.push({
        invoice_no: invoiceNo,
        invoice_date: inv.invoice_date,
        expected_payment_date: expectedPaymentDate,
        terms: inv.terms || "-",
        amount: remainingAmount,
        currency: paymentInfo.currency || "TRY",
        customer_name: paymentInfo.customer_name || "",
        payment_method: paymentInfo.payment_method || "",
        supplier_name: paymentInfo.supplier_name || "",
      });
    }

    overdueRows.sort((a, b) => {
      return (
        new Date(a.expected_payment_date) - new Date(b.expected_payment_date)
      );
    });

    res.json({
      ok: true,
      rows: overdueRows,
    });
  } catch (err) {
    console.error("OVERDUE INVOICES ERROR:", err);
    res.status(500).json({
      ok: false,
      error: "Geciken faturalar alınırken hata oluştu",
      detail: err.message,
    });
  }
});
const PORT = process.env.PORT || 5001;

app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() as now");
    res.json({
      ok: true,
      message: "Local DB bağlantısı başarılı",
      time: result.rows[0].now,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      message: "DB bağlantı hatası",
      error: err.message,
    });
  }
});

/* ===== TAŞERON FATURA TABLOSU — STARTUP MIGRATION ===== */
pool.query(`
  CREATE TABLE IF NOT EXISTS taseron_fatura (
    id SERIAL PRIMARY KEY,
    taseron_adi TEXT NOT NULL,
    fatura_no TEXT,
    fatura_tarihi DATE,
    toplam_tutar NUMERIC DEFAULT 0,
    kdv_tutar NUMERIC DEFAULT 0,
    genel_toplam NUMERIC DEFAULT 0,
    odenen_tutar NUMERIC DEFAULT 0,
    kalan_tutar NUMERIC DEFAULT 0,
    pdf_url TEXT,
    aciklama TEXT,
    durum TEXT DEFAULT 'bekliyor',
    created_at TIMESTAMP DEFAULT NOW()
  );
`).catch(e => console.error("taseron_fatura startup migration:", e.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS taseron_fatura_kalem (
    id SERIAL PRIMARY KEY,
    fatura_id INTEGER REFERENCES taseron_fatura(id) ON DELETE CASCADE,
    site_id TEXT,
    saha_adi TEXT,
    kalem_aciklama TEXT,
    tutar NUMERIC DEFAULT 0,
    odenen NUMERIC DEFAULT 0,
    kalan NUMERIC DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
  );
`).catch(e => console.error("taseron_fatura_kalem startup migration:", e.message));

/* ===== FATURA BELGE UPLOAD & VIEW ===== */

// DB kolonları ekle (idempotent)
pool.query(`ALTER TABLE invoice_entries ADD COLUMN IF NOT EXISTS belge_path TEXT`).catch(() => {});
pool.query(`ALTER TABLE invoice_entries ADD COLUMN IF NOT EXISTS odeme_tarihi DATE`).catch(() => {});
pool.query(`ALTER TABLE invoice_entries ADD COLUMN IF NOT EXISTS fatura_turu TEXT DEFAULT 'GELEN'`).catch(() => {});
pool.query(`ALTER TABLE invoice_entries ADD COLUMN IF NOT EXISTS bagli_fatura_id INTEGER`).catch(() => {});

// ─── FATURA PARSE HELPERs ────────────────────────────────────────────────────
function parseTurkishInvoice(rawText) {
  // ── Yardımcı: TR para sayısı → JS float ──────────────────────────────────
  const parseTRNum = (s) => {
    if (!s) return "";
    s = s.replace(/\s|TL|₺/g, "").trim();
    if (!s) return "";
    // 66.666,67 → nokta=binlik, virgül=ondalık
    if (/\d\.\d{3},\d/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    // 66,666.67 → virgül=binlik, nokta=ondalık (OCR bazen ters çevirir)
    else if (/\d,\d{3}\.\d/.test(s)) s = s.replace(/,/g, "");
    // 66.666 → son 3 basamak → binlik nokta
    else if (/^\d+\.\d{3}$/.test(s)) s = s.replace(".", "");
    // 66,67 tek virgül → ondalık
    else s = s.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(s);
    return isNaN(n) ? "" : String(Math.round(n * 100) / 100);
  };

  // ── E-fatura PDF'leri iki sütun içerir: etiketler bir sütunda, değerler
  //    diğer sütunda → pdfminer bunları ayrı satırlar olarak verir.
  //    findAfterLabel: etiketi bul, ardından gelen satırlarda değeri ara ──────
  const lines = rawText.split(/\n/).map(l => l.trim()).filter(Boolean);
  const flat  = rawText.replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s{2,}/g, " ");

  // Etiketten sonra ilk geçerli satırı döndür
  const findAfterLabel = (labelRe, valueRe) => {
    for (let i = 0; i < lines.length; i++) {
      if (labelRe.test(lines[i])) {
        // Aynı satırda değer var mı? (tek-satır format)
        const inLine = lines[i].match(valueRe);
        if (inLine) return inLine[1] || inLine[0];
        // Sonraki satırlarda ara (en fazla 5 satır)
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          const m = lines[j].match(valueRe);
          if (m) return m[1] || m[0];
        }
      }
    }
    return "";
  };

  // flat içinde tek-satır formatı için arama
  const findFlat = (patterns) => {
    for (const p of patterns) {
      const m = flat.match(p);
      if (m) for (let i = 1; i < m.length; i++) if (m[i]?.trim()) return m[i].trim();
    }
    return "";
  };

  // ── E-FATURA TABLOSU: Konum tabanlı eşleme ──────────────────────────────────
  // pdfminer e-fatura'yı sütun-önce okur:
  //   Özelleştirme No: / Senaryo: / Fatura Tipi: / Fatura No: / Fatura Tarihi: / Fatura Saati:
  //   ...ardından değerler:
  //   TR1.2 / TICARIFATURA / SATIS / ERS2026000000115 / 18-05-2026 / 20:43:54
  // Çözüm: etiketi bul, kaçıncı sırada olduğunu say, aynı sıradaki değeri al.
  const EF_LABEL_ORDER = [
    "Özelleştirme No:", "Senaryo:", "Fatura Tipi:",
    "Fatura No:", "Fatura Tarihi:", "Fatura Saati:",
  ];
  const efIdx = {}; // label → satır indeksi
  for (let i = 0; i < lines.length; i++) {
    const norm = lines[i].replace(/\s+/g, " ").trim();
    for (const lbl of EF_LABEL_ORDER) {
      if (norm.toLowerCase() === lbl.toLowerCase()) { efIdx[lbl] = i; break; }
    }
  }
  let efFaturaNo = "", efTarihi = "";
  const efFound = EF_LABEL_ORDER.filter(l => l in efIdx);
  if (efFound.length >= 3 && "Fatura No:" in efIdx) {
    const lastLabelLine = Math.max(...efFound.map(l => efIdx[l]));
    // Son etiketten sonraki satırlardaki değerleri topla
    const vals = [];
    for (let i = lastLabelLine + 1; i < lines.length && vals.length < efFound.length; i++) {
      if (lines[i].trim()) vals.push(lines[i].trim());
    }
    // Satır sırasına göre etiket → değer eşleme
    const sortedEfLabels = efFound.slice().sort((a, b) => efIdx[a] - efIdx[b]);
    sortedEfLabels.forEach((lbl, i) => {
      const val = vals[i] || "";
      if (lbl === "Fatura No:") efFaturaNo = val;
      if (lbl === "Fatura Tarihi:") {
        // Konum kaymasında (örn. araya "Düzenleme Tarihi:" girince) değer tarih
        // olmayabilir — tarih DEĞİLSE boş bırak ki alttaki genel arama çalışsın
        const dm = val.match(/(\d{2}[-./]\d{2}[-./]\d{4})/);
        efTarihi = dm ? dm[1] : "";
      }
    });
    // Konum eşleşmesi tarih bulamadıysa değer sütunundaki İLK tarihi al
    // (saat değil: GG-AA-YYYY deseni yalnız tarihe uyar)
    if (!efTarihi) {
      for (const v of vals) {
        const dm = String(v).match(/(\d{2}[-./]\d{2}[-./]\d{4})/);
        if (dm) { efTarihi = dm[1]; break; }
      }
    }
  }

  // ── FATURA NO ──────────────────────────────────────────────────────────────
  // EF_LABEL_ORDER bazen bilinen sahte değerler verebilir (SATIS, TICARIFATURA vb.)
  // Önce geçersiz değerleri temizle, SONRA fallback ara — aksi halde fallback hiç çalışmaz.
  let fatura_no = efFaturaNo;
  if (/^[0-9a-f\-]{30,}$/i.test(fatura_no)) fatura_no = "";       // ETTN UUID
  if (/^(TICARIFATURA|EARSIVFATURA|SATIS|ALIS|TR\d\.\d)$/i.test(fatura_no)) fatura_no = "";
  if (fatura_no && !/\d/.test(fatura_no)) fatura_no = "";          // salt harfse temizle

  // EFA/EFT/ERS/GIB stili e-fatura numarası — öncelikli arama (en spesifik)
  if (!fatura_no) {
    const m = flat.match(/\b((?:EFA|EFT|ERS|EAR|EAK|GIB|INV)\d{8,})\b/i);
    if (m) fatura_no = m[1].toUpperCase();
  }
  // "Fatura No:" etiketinden sonraki satırı ara
  if (!fatura_no) fatura_no = findAfterLabel(
    /fatura\s*no\s*:?\s*$/i,
    /^(?=.*\d)([A-Z0-9][A-Z0-9\/\-]{4,39})$/i
  );
  // findFlat fallback: yıl bazlı fatura no formatı (ERS2026xxx, ETS2026xxx vb.)
  if (!fatura_no) fatura_no = findFlat([
    /FATURA\s*NO\s*[:\|]?\s*([A-Z]{1,8}(?:20|19)\d{2}\d{4,})/i,
  ]);
  // Son çare: metinde herhangi bir yıl bazlı fatura no ara
  if (!fatura_no) {
    const m = flat.match(/\b([A-Z]{2,8}(?:20|19)\d{2}\d{4,})\b/);
    if (m) fatura_no = m[1];
  }

  // ── FATURA TARİHİ ──────────────────────────────────────────────────────────
  // Önce e-fatura konum tabanlı sonuç, yoksa genel arama
  let dateRaw = efTarihi;
  // Etiket-yakınlık araması: "Fatura Tarihi" geçen satırda ya da sonraki birkaç
  // satırda ilk tarihi al. PDF metin çıkarımı sütunları ayrı satırlara dökebilir
  // ve metin sırası görsel sırayla eşleşmez — genel "ilk tarih" yedeği bu yüzden
  // faturanın alt notlarındaki tarihleri (C-IN/C-OUT vb.) yakalayabiliyordu.
  const DATE_RX = /(\d{1,2}[-./]\d{1,2}[-./]\d{4})/;
  if (!dateRaw) {
    for (const lblRx of [/fatura\s*tar[iİıI]h/i, /d[üuÜU]zenleme\s*tar[iİıI]h/i]) {
      const li = lines.findIndex(l => lblRx.test(l));
      if (li === -1) continue;
      for (let j = li; j < Math.min(lines.length, li + 8); j++) {
        const dm = lines[j].match(DATE_RX);
        if (dm) { dateRaw = dm[1]; break; }
      }
      if (dateRaw) break;
    }
  }
  if (!dateRaw) dateRaw = findAfterLabel(
    /^fatura\s*tar[iİ]h[iİ]\s*:?\s*$/i,
    /(\d{2}[-./]\d{2}[-./]\d{4})/
  );
  if (!dateRaw) dateRaw = findFlat([
    /FATURA\s*TAR[İI]H[İI]\s*[:\|]?\s*(\d{2}[-./]\d{2}[-./]\d{4})/i,
    /D[ÜÜ]ZENLEME\s*TAR[İI]H[İI]\s*[:\|]?\s*(\d{2}[-./]\d{2}[-./]\d{4})/i,
    /(\d{2}[-./]\d{2}[-./]\d{4})/,
  ]);
  let fatura_tarihi = "";
  if (dateRaw) {
    const p = dateRaw.split(/[-./]/);
    if (p[2]?.length === 4) fatura_tarihi = `${p[2]}-${p[1].padStart(2,"0")}-${p[0].padStart(2,"0")}`;
  }

  // ── TEDARİKÇİ (satıcı/kesici) ──────────────────────────────────────────────
  // E-fatura'da "SAYIN" → alıcı, ondan önce gelen ilk ad → satıcı
  // Satıcı genellikle metnin en başında, TCKN/VKN bilgileriyle birlikte gelir
  let tedarikci = "";
  // 1) SATICI etiketi ile başlayan satır
  tedarikci = findFlat([
    /(?:SATICI\s*[Üü]NVAN[Iiİ]|SATICI\s*AD[Iİ]|SATICI)[^:]*:\s*([^\|]{5,80}?)(?:\s{3,}|VKN|V\.K|$)/i,
    /UNVANI\s*:\s*([^\|]{5,60})/i,
  ]);
  // 2) e-fatura PDF: TCKN/VKN/Vergi Dairesi bloğundan önceki ilk isim satırı
  if (!tedarikci) {
    // Metni satırlara böl, SAYIN'dan önceki kısmı al
    const sayinIdx = lines.findIndex(l => /^SAYIN$/i.test(l));
    const sellerLines = sayinIdx > 0 ? lines.slice(0, sayinIdx) : lines;
    // İlk gerçek isim satırı (sadece harf ve boşluk, en az 3 kelime veya en az 10 karakter)
    for (const l of sellerLines) {
      if (/^[A-ZÇŞĞÜÖİa-zçşğüöı\s\.]{8,70}$/.test(l) && !/^(SUBENO|MERSISNO|HIZMETNO|TICARETSICILNO|e-FATURA|e-ARŞİV|SAYIN)$/i.test(l)) {
        tedarikci = l.toUpperCase();
        break;
      }
    }
  }
  // 3) Firma adı satırlarını birleştir (Limited Şirketi vs.)
  if (tedarikci && !/LTD|A\.Ş|ANONİM|LİMİTED/i.test(tedarikci)) {
    // Tedarikçi satırından sonraki satır unvan eki olabilir
    const tIdx = lines.findIndex(l => l.toUpperCase().includes(tedarikci.split(" ")[0]));
    if (tIdx >= 0 && tIdx + 1 < lines.length) {
      const next = lines[tIdx + 1].trim();
      if (/LTD|A\.Ş|ANONİM|LİMİTED|TİCARET|SANAYİ|ŞİRKETİ/i.test(next)) {
        tedarikci = (tedarikci + " " + next.toUpperCase()).trim();
      }
    }
  }

  // ── TUTARLAR ───────────────────────────────────────────────────────────────
  // e-fatura'da etiket ve tutar ayrı satırlarda olabilir.
  // Özel durum: "Hesaplanan GERÇEK USULDE KATMA" + "DEĞER VERGİSİ(%20)" gibi
  // iki satıra bölünmüş etiketler için bitişik satırları da kontrol et.
  const findAmount = (labelRe) => {
    for (let i = 0; i < lines.length; i++) {
      const matchSingle   = labelRe.test(lines[i]);
      // İki satır birleşik eşleme (etiket iki satıra bölünmüşse)
      const matchCombined = !matchSingle && i + 1 < lines.length
                            && labelRe.test(lines[i] + " " + lines[i + 1]);
      if (matchSingle || matchCombined) {
        // Aynı satırda sayı: tek-satır eşleşmesinde kontrol et.
        if (matchSingle) {
          const m = lines[i].match(/([\d.]+,\d{2})/);
          if (m) return m[1];
        }
        // matchCombined: etiket lines[i+1] içinde olabilir, değer de aynı satırda olabilir.
        // Önce lines[i+1]'i kontrol et, sonra i+2'den ileriye bak.
        if (matchCombined) {
          const mNext = lines[i + 1].match(/([\d.]+,\d{2})/);
          if (mNext) return mNext[1];
        }
        // Sayıyı sonraki 1-3 satırda ara
        const searchFrom = matchCombined ? i + 2 : i + 1;
        for (let j = searchFrom; j < Math.min(searchFrom + 3, lines.length); j++) {
          const m2 = lines[j].match(/([\d.]+,\d{2})/);
          if (m2) return m2[1];
        }
      }
    }
    // flat metin araması (alternation'ı (?:...) ile grupla)
    const flatM = flat.match(new RegExp("(?:" + labelRe.source + ")[^\\d]{0,50}(\\d[\\d.,]+)", "i"));
    if (flatM) for (let k = 1; k < flatM.length; k++) if (flatM[k]?.trim()) return flatM[k].trim();
    return "";
  };

  // toplam: "Ödenecek Tutar" veya "Vergiler Dahil Toplam Tutar" — TOPLAM\s*TUTAR yok
  // (çünkü "Mal Hizmet Toplam Tutarı" da eşleşir ve yanlış değer verir)
  const toplam_raw  = findAmount(/[ÖO]DENECEK\s*TUTAR|VERGiLER\s*DAHiL\s*TOPLAM|VERGİLER\s*DAHİL\s*TOPLAM|GENEL\s*TOPLAM/i);
  // kdv: önce en spesifik "Hesaplanan KDV" etiketini ara (tablo başlığı olan
  // "KDV Tutarı" veya "KDV %20" daha önce yanlış eşleşmesin diye).
  let kdv_raw = findAmount(/HESAPLANAN\s*KDV|KATMA\s*DE[ĞG]ER\s*VERG|DEĞER\s*VERGİSİ|DEGER\s*VERGISI/i);
  if (!kdv_raw) kdv_raw = findAmount(/KDV\s*TUTARI|KDV\s*%\d/i);
  // matrah: "Mal Hizmet Toplam Tutarı" + genel TOPLAM\s*TUTAR
  const matrah_raw  = findAmount(/MAL\s*H[İI]ZMET\s*TOPLAM|MATRAH|KDV\s*HAR[İI][ÇC]|ARA\s*TOPLAM|TOPLAM\s*TUTAR/i);

  console.log("[parseTurkishInvoice]", { fatura_no, fatura_tarihi, tedarikci, toplam_raw, kdv_raw, matrah_raw });

  return {
    fatura_no,
    fatura_tarihi,
    tedarikci,
    tutar:        parseTRNum(matrah_raw),
    kdv:          parseTRNum(kdv_raw),
    toplam_tutar: parseTRNum(toplam_raw),
  };
}

// PDF metin çıkarma — önce Python pdfminer (dijital PDF), yoksa OCR.space
async function extractPdfText(pdfBuffer, isPDF) {
  // ── 1. Python pdfminer (dijital/e-fatura PDF'leri için en iyi) ────────────
  if (isPDF) {
    try {
      const { execFile } = require("child_process");
      const os = require("os");
      const tmpFile = path.join(os.tmpdir(), `invoice_${Date.now()}.pdf`);
      require("fs").writeFileSync(tmpFile, pdfBuffer);
      const text = await new Promise((resolve, reject) => {
        execFile("python3", [
          "-c",
          // sys.stdout.reconfigure: UTF-8 zorla (Render gibi ortamlarda LANG=C olabilir)
          `import sys; sys.stdout.reconfigure(encoding='utf-8'); from pdfminer.high_level import extract_text; print(extract_text(sys.argv[1]))`,
          tmpFile,
        ], {
          timeout: 15000,
          maxBuffer: 5 * 1024 * 1024,
          encoding: "utf8",
          env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
        }, (err, stdout, stderr) => {
          try { require("fs").unlinkSync(tmpFile); } catch (_) {}
          if (err) return reject(err);
          resolve(stdout);
        });
      });
      if (text && text.trim().length > 50) {
        console.log("[invoice-parse] pdfminer snippet:", text.slice(0, 300));
        return text;
      }
    } catch (e) {
      console.warn("[invoice-parse] pdfminer failed, falling back to OCR:", e.message);
    }
  }

  // ── 2. OCR.space (taramalı PDF veya resim için fallback) ──────────────────
  try {
    const apiKey = process.env.OCR_SPACE_KEY || "helloworld";
    const base64 = pdfBuffer.toString("base64");
    const mimeType = isPDF ? "application/pdf" : "image/jpeg";
    const body = new URLSearchParams({
      base64Image: `data:${mimeType};base64,${base64}`,
      language: "tur",
      isOverlayRequired: "false",
      detectOrientation: "true",
      scale: "true",
      OCREngine: "2",
    });
    const ocrResp = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(20000),
    });
    const ocrJson = await ocrResp.json();
    const text = (ocrJson?.ParsedResults || []).map(r => r.ParsedText || "").join("\n");
    console.log("[invoice-parse] OCR snippet:", text.slice(0, 300));
    return text;
  } catch (e) {
    console.error("[invoice-parse] OCR error:", e.message);
    return "";
  }
}

// POST /invoice-parse — PDF/resim yükle, metin çıkar, fatura alanlarını doldur
const uploadInvoiceParse = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
app.post("/invoice-parse", authMiddleware, uploadInvoiceParse.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Dosya gelmedi" });
  const ext = path.extname(utf8Name(req.file.originalname)).toLowerCase();
  const isPDF = ext === ".pdf" || req.file.mimetype === "application/pdf";

  let pdfBuffer = req.file.buffer;
  if (!isPDF) {
    // Resmi PDF'e dönüştür
    const PDFDocument = require("pdfkit");
    pdfBuffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ autoFirstPage: false, margin: 20 });
      const chunks = [];
      doc.on("data", c => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      try {
        const img = doc.openImage(req.file.buffer);
        const maxW = 555, maxH = 802;
        const ratio = Math.min(maxW / img.width, maxH / img.height);
        doc.addPage({ size: [img.width * ratio + 40, img.height * ratio + 40] });
        doc.image(req.file.buffer, 20, 20, { width: img.width * ratio });
        doc.end();
      } catch (e) { reject(e); }
    });
  }

  // Supabase'e geçici yükle — temp_key olarak gerçek storage yolunu dön
  let tempUrl = null, tempKey = null;
  try {
    const { url, filePath } = await uploadToStorage("fatura-belgeler", `tmp-${Date.now()}.pdf`, pdfBuffer, "application/pdf");
    tempUrl = url;
    tempKey = filePath; // "fatura-belgeler/TIMESTAMP-tmp-xxx.pdf" — invoice-add'de bu yol kullanılacak
  } catch (e) {
    console.error("[invoice-parse] storage error:", e.message);
  }

  const pdfText = await extractPdfText(pdfBuffer, isPDF);
  const parsed  = parseTurkishInvoice(pdfText);
  // İş Kalemi tahmini: fatura metninden kategori yakala (chip seçicide otomatik seçilir)
  try {
    const low = String(pdfText || "").toLocaleLowerCase("tr");
    if (/konaklama|otel\b|oda\/room|hotel/.test(low)) parsed.is_kalemi = "KONAKLAMA";
    else if (/vin[çc]\b|vin[çc] hizmet|mobil vin[çc]/.test(low)) parsed.is_kalemi = "VINC";
    else if (/nakliye|lojistik|ta[şs][ıi]mac[ıi]l[ıi]k/.test(low)) parsed.is_kalemi = "NAKLIYE";
  } catch {}
  res.json({ ok: true, parsed, temp_key: tempKey, temp_url: tempUrl });
});

app.post(
  "/invoice-entries/:id/belge",
  uploadFaturaBelge.single("belge"),
  async (req, res) => {
    const { id } = req.params;
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Dosya gelmedi" });

    const PDFDocument = require("pdfkit");
    const ext = path.extname(file.originalname).toLowerCase();
    const pdfFilename = `fatura-${id}-${Date.now()}.pdf`;

    try {
      let pdfBuffer;
      if (ext === ".pdf") {
        pdfBuffer = file.buffer;
      } else {
        pdfBuffer = await new Promise((resolve, reject) => {
          const doc = new PDFDocument({ autoFirstPage: false, margin: 20 });
          const chunks = [];
          doc.on("data", c => chunks.push(c));
          doc.on("end", () => resolve(Buffer.concat(chunks)));
          doc.on("error", reject);

          const img = doc.openImage(file.buffer);
          const maxW = 555, maxH = 802;
          const ratio = Math.min(maxW / img.width, maxH / img.height);
          const w = img.width * ratio, h = img.height * ratio;

          doc.addPage({ size: [w + 40, h + 40] });
          doc.image(file.buffer, 20, 20, { width: w, height: h });
          doc.end();
        });
      }

      const { url } = await uploadToStorage("fatura-belgeler", pdfFilename, pdfBuffer, "application/pdf");
      await pool.query(
        "UPDATE invoice_entries SET belge_path = $1 WHERE id = $2",
        [url, id]
      );

      res.json({ ok: true, filename: pdfFilename, url });
    } catch (err) {
      console.error("Belge upload hatası:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

app.delete("/invoice-entries/:id/belge", async (req, res) => {
  const { id } = req.params;
  try {
    const r = await pool.query("SELECT belge_path FROM invoice_entries WHERE id=$1", [id]);
    const belge = r.rows[0]?.belge_path;
    if (belge) await deleteFromStorage(belge);
    await pool.query("UPDATE invoice_entries SET belge_path = NULL WHERE id=$1", [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ===== HR MODULE - PERSONEL + ISG + PUANTAJ + AVANS ===== */

const uploadPersonelBelge = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const uploadPuantajBelge = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ISG eğitim türleri (sabit liste) — rfq_kolon: Huawei RFQ Excel kolonuyla eşleşme
const ISG_EGITIM_TURLERI = [
  // ── RFQ ana eğitimler ──
  { tur: "Sağlık Raporu",              gecerlilik_yil: 1, rfq_kolon: "saglik" },
  { tur: "HUAWEI 10 Mutlak Kural",     gecerlilik_yil: 1, rfq_kolon: "hw10" },
  { tur: "Temel İSG",                  gecerlilik_yil: 1, rfq_kolon: "temel_isg" },
  { tur: "ELEKTRİK İSG",              gecerlilik_yil: 1, rfq_kolon: "elektrik", kosullu: true },
  { tur: "Yüksekte Çalışma",          gecerlilik_yil: 2, rfq_kolon: "yuksek", kosullu: true },
  { tur: "Kurtarma Eğitimi",          gecerlilik_yil: 2, rfq_kolon: "kurtarma" },
  { tur: "Güvenli Sürüş",             gecerlilik_yil: 2, rfq_kolon: "guvensurus", kosullu: true },
  { tur: "İlkyardım",                  gecerlilik_yil: 3, rfq_kolon: "ilkyardim" },
  // ── Huawei / saha özel ──
  { tur: "RF İSG Eğitimi",             gecerlilik_yil: 1, rfq_kolon: "rf_isg" },
  { tur: "Mesleki Yeterlilik Belgesi", gecerlilik_yil: 5 },
  { tur: "Araç Kullanma Taahhütnamesi",gecerlilik_yil: 99 },
  { tur: "Sağlık Taahhütnamesi",       gecerlilik_yil: 1 },
  { tur: "SGK Giriş Bildirgesi",       gecerlilik_yil: 99 },
  { tur: "Ek 2 Belgesi",               gecerlilik_yil: 99 },
  // ── Ek eğitimler ──
  { tur: "Temel İSG Eğitimi",          gecerlilik_yil: 2 },
  { tur: "İlk Yardım Eğitimi",         gecerlilik_yil: 3 },
  { tur: "Yangın Söndürme ve Tahliye Eğitimi", gecerlilik_yil: 1 },
  { tur: "Yüksekte Çalışma Eğitimi",   gecerlilik_yil: 3 },
  { tur: "Elektrik İş Güvenliği Eğitimi", gecerlilik_yil: 3 },
  { tur: "KKD Kullanımı Eğitimi",      gecerlilik_yil: 2 },
  { tur: "Elle Taşıma İşleri Eğitimi", gecerlilik_yil: 2 },
  { tur: "Ergonomi Eğitimi",           gecerlilik_yil: 2 },
  { tur: "Acil Durum ve Tahliye Eğitimi", gecerlilik_yil: 1 },
  { tur: "Kimyasal Maddeler Eğitimi",  gecerlilik_yil: 2 },
  { tur: "Gürültü ve Titreşim Eğitimi",gecerlilik_yil: 2 },
  { tur: "Anten ve Baz İstasyonu Güvenliği", gecerlilik_yil: 2 },
  { tur: "İş Ekipmanları Kullanımı Eğitimi", gecerlilik_yil: 3 },
  { tur: "Kazı ve Zemin Güvenliği Eğitimi",  gecerlilik_yil: 2 },
  { tur: "Trafik ve Karayolu Güvenliği",     gecerlilik_yil: 2 },
  { tur: "Stres ve Zorbalık Önleme Eğitimi", gecerlilik_yil: 2 },
  { tur: "Ortam Ölçümleri Bilgilendirme",    gecerlilik_yil: 2 },
  { tur: "İş Kazası ve Ramak Kala Bildirimi",gecerlilik_yil: 2 },
];

app.get("/hr/isg-egitim-turleri", (req, res) => res.json(ISG_EGITIM_TURLERI));

// DB tablolarını oluştur (idempotent)
pool.query(`
  CREATE TABLE IF NOT EXISTS personel (
    id SERIAL PRIMARY KEY,
    ad_soyad TEXT NOT NULL,
    tc_no TEXT,
    dogum_tarihi DATE,
    telefon TEXT,
    email TEXT,
    unvan TEXT,
    bolge TEXT,
    ise_giris_tarihi DATE,
    isten_ayrilma_tarihi DATE,
    net_maas NUMERIC DEFAULT 0,
    bankadan_gosterilen NUMERIC DEFAULT 0,
    elden_verilen NUMERIC DEFAULT 0,
    iban TEXT,
    banka_adi TEXT,
    banka_hesap_no TEXT,
    aktif BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS personel_belgeler (
    id SERIAL PRIMARY KEY,
    personel_id INTEGER NOT NULL REFERENCES personel(id) ON DELETE CASCADE,
    belge_turu TEXT NOT NULL,
    dosya_yolu TEXT NOT NULL,
    yuklenme_tarihi TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS personel_isg (
    id SERIAL PRIMARY KEY,
    personel_id INTEGER NOT NULL REFERENCES personel(id) ON DELETE CASCADE,
    egitim_turu TEXT NOT NULL,
    egitim_tarihi DATE,
    gecerlilik_yil INTEGER DEFAULT 2,
    bitis_tarihi DATE,
    belge_yolu TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS puantaj (
    id SERIAL PRIMARY KEY,
    personel_id INTEGER NOT NULL REFERENCES personel(id) ON DELETE CASCADE,
    tarih DATE NOT NULL,
    durum TEXT NOT NULL DEFAULT 'CALISDI',
    created_by TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(personel_id, tarih)
  );
  ALTER TABLE puantaj ADD COLUMN IF NOT EXISTS fazla_mesai_saat NUMERIC DEFAULT 0;
  CREATE TABLE IF NOT EXISTS avans (
    id SERIAL PRIMARY KEY,
    personel_id INTEGER NOT NULL REFERENCES personel(id) ON DELETE CASCADE,
    tarih DATE NOT NULL,
    tutar NUMERIC DEFAULT 0,
    aciklama TEXT,
    odendi BOOLEAN DEFAULT false,
    odeme_tarihi DATE,
    created_at TIMESTAMP DEFAULT NOW()
  );
  ALTER TABLE avans ADD COLUMN IF NOT EXISTS avans_turu TEXT DEFAULT 'MAAS';
  CREATE TABLE IF NOT EXISTS maas_odeme (
    id SERIAL PRIMARY KEY,
    personel_id INTEGER NOT NULL REFERENCES personel(id) ON DELETE CASCADE,
    donem TEXT NOT NULL,
    bankadan NUMERIC DEFAULT 0,
    elden NUMERIC DEFAULT 0,
    tarih DATE NOT NULL,
    aciklama TEXT,
    created_by TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );
`).catch(e => console.error("HR tablo hatası:", e.message));

// ---- PERSONEL CRUD ----
app.get("/hr/personel", async (req, res) => {
  try {
    const donem = String(req.query.donem || "").trim(); // 'YYYY-MM' — o ay geçerli maaşla döner
    if (/^\d{4}-\d{2}$/.test(donem)) {
      const r = await pool.query(`
        SELECT p.*,
          COALESCE(g.net_maas, p.net_maas) AS net_maas,
          COALESCE(g.bankadan_gosterilen, p.bankadan_gosterilen) AS bankadan_gosterilen,
          COALESCE(g.elden_verilen, p.elden_verilen) AS elden_verilen,
          g.donem AS maas_gecerli_donem
        FROM personel p
        LEFT JOIN LATERAL (
          SELECT net_maas, bankadan_gosterilen, elden_verilen, donem
          FROM personel_maas_gecmisi
          WHERE personel_id = p.id AND donem <= $1
          ORDER BY donem DESC LIMIT 1
        ) g ON true
        ORDER BY p.aktif DESC, p.ad_soyad ASC`, [donem]);
      return res.json(r.rows);
    }
    const r = await pool.query("SELECT * FROM personel ORDER BY aktif DESC, ad_soyad ASC");
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Maaş geçmişi (Excel "Maaş Geçmişi" sayfası için): kim, hangi aydan itibaren, ne maaş
app.get("/hr/maas-gecmisi", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT g.personel_id, g.donem, g.net_maas, g.bankadan_gosterilen, g.elden_verilen, g.created_at, p.ad_soyad
      FROM personel_maas_gecmisi g JOIN personel p ON p.id = g.personel_id
      ORDER BY p.ad_soyad ASC, g.donem ASC`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/hr/personel", async (req, res) => {
  try {
    const { ad_soyad, tc_no, dogum_tarihi, telefon, email, unvan, bolge, ise_giris_tarihi,
      net_maas, bankadan_gosterilen, elden_verilen, iban, banka_adi, banka_hesap_no,
      ekip_bilgisi, alt_yuklenici, firma_tipi, isdp_account, iresource_giris,
      kkd_zimmet_tarihi, mesleki_yeterlilik_durum, mesleki_yeterlilik_tarihi,
      elektrik_isi, yuksekte_calisma, arac_kullanim, marka } = req.body;
    const r = await pool.query(
      `INSERT INTO personel (ad_soyad,tc_no,dogum_tarihi,telefon,email,unvan,bolge,ise_giris_tarihi,
        net_maas,bankadan_gosterilen,elden_verilen,iban,banka_adi,banka_hesap_no,
        ekip_bilgisi,alt_yuklenici,firma_tipi,isdp_account,iresource_giris,
        kkd_zimmet_tarihi,mesleki_yeterlilik_durum,mesleki_yeterlilik_tarihi,
        elektrik_isi,yuksekte_calisma,arac_kullanim,marka)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING *`,
      [ad_soyad,tc_no||null,dogum_tarihi||null,telefon,email,unvan,bolge,ise_giris_tarihi||null,
       net_maas||0,bankadan_gosterilen||0,elden_verilen||0,iban,banka_adi,banka_hesap_no,
       ekip_bilgisi||null,alt_yuklenici||null,firma_tipi||"simsek",isdp_account||null,iresource_giris||null,
       kkd_zimmet_tarihi||null,mesleki_yeterlilik_durum||null,mesleki_yeterlilik_tarihi||null,
       elektrik_isi||false,yuksekte_calisma||false,arac_kullanim||false,String(marka||"ERC").toUpperCase()]
    );
    // Taban maaş kaydı: tüm aylar için geçerli başlangıç değeri
    try {
      await pool.query(
        `INSERT INTO personel_maas_gecmisi (personel_id,donem,net_maas,bankadan_gosterilen,elden_verilen)
         VALUES ($1,'1900-01',$2,$3,$4) ON CONFLICT (personel_id,donem) DO NOTHING`,
        [r.rows[0].id, net_maas||0, bankadan_gosterilen||0, elden_verilen||0]
      );
    } catch {}
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/hr/personel/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { ad_soyad, tc_no, dogum_tarihi, telefon, email, unvan, bolge, ise_giris_tarihi,
      isten_ayrilma_tarihi, net_maas, bankadan_gosterilen, elden_verilen, iban, banka_adi,
      banka_hesap_no, aktif,
      ekip_bilgisi, alt_yuklenici, firma_tipi, isdp_account, iresource_giris,
      kkd_zimmet_tarihi, mesleki_yeterlilik_durum, mesleki_yeterlilik_tarihi,
      elektrik_isi, yuksekte_calisma, arac_kullanim, marka, maas_donem } = req.body;
    // MAAŞ VERSİYONLAMA: maaş alanları değiştiyse eski değeri taban kaydında
    // koru, yeni değeri seçilen dönemden (maas_donem, yoksa içinde bulunulan ay)
    // itibaren geçerli yap → geçmiş aylar eski maaşla hesaplanmaya devam eder.
    try {
      const oldR = await pool.query("SELECT net_maas, bankadan_gosterilen, elden_verilen FROM personel WHERE id=$1", [id]);
      if (oldR.rows[0]) {
        const o = oldR.rows[0];
        const changed = Number(o.net_maas||0) !== Number(net_maas||0)
          || Number(o.bankadan_gosterilen||0) !== Number(bankadan_gosterilen||0)
          || Number(o.elden_verilen||0) !== Number(elden_verilen||0);
        if (changed) {
          const hist = await pool.query("SELECT COUNT(*)::int AS n FROM personel_maas_gecmisi WHERE personel_id=$1", [id]);
          if (hist.rows[0].n === 0) {
            await pool.query(
              `INSERT INTO personel_maas_gecmisi (personel_id,donem,net_maas,bankadan_gosterilen,elden_verilen)
               VALUES ($1,'1900-01',$2,$3,$4) ON CONFLICT (personel_id,donem) DO NOTHING`,
              [id, o.net_maas||0, o.bankadan_gosterilen||0, o.elden_verilen||0]
            );
          }
          const now = new Date();
          const efDonem = /^\d{4}-\d{2}$/.test(String(maas_donem||"")) ? maas_donem
            : `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
          await pool.query(
            `INSERT INTO personel_maas_gecmisi (personel_id,donem,net_maas,bankadan_gosterilen,elden_verilen)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (personel_id,donem) DO UPDATE SET net_maas=$3, bankadan_gosterilen=$4, elden_verilen=$5`,
            [id, efDonem, net_maas||0, bankadan_gosterilen||0, elden_verilen||0]
          );
        }
      }
    } catch (e) { console.error("maas gecmisi:", e.message); }
    const r = await pool.query(
      `UPDATE personel SET ad_soyad=$1,tc_no=$2,dogum_tarihi=$3,telefon=$4,email=$5,unvan=$6,
        bolge=$7,ise_giris_tarihi=$8,isten_ayrilma_tarihi=$9,net_maas=$10,bankadan_gosterilen=$11,
        elden_verilen=$12,iban=$13,banka_adi=$14,banka_hesap_no=$15,aktif=$16,
        ekip_bilgisi=$17,alt_yuklenici=$18,firma_tipi=$19,isdp_account=$20,iresource_giris=$21,
        kkd_zimmet_tarihi=$22,mesleki_yeterlilik_durum=$23,mesleki_yeterlilik_tarihi=$24,
        elektrik_isi=$25,yuksekte_calisma=$26,arac_kullanim=$27,marka=COALESCE($28,marka)
       WHERE id=$29 RETURNING *`,
      [ad_soyad,tc_no||null,dogum_tarihi||null,telefon,email,unvan,bolge,ise_giris_tarihi||null,
       isten_ayrilma_tarihi||null,net_maas||0,bankadan_gosterilen||0,elden_verilen||0,
       iban,banka_adi,banka_hesap_no,aktif!==undefined?aktif:true,
       ekip_bilgisi||null,alt_yuklenici||null,firma_tipi||"simsek",isdp_account||null,iresource_giris||null,
       kkd_zimmet_tarihi||null,mesleki_yeterlilik_durum||null,mesleki_yeterlilik_tarihi||null,
       elektrik_isi||false,yuksekte_calisma||false,arac_kullanim||false,
       marka?String(marka).toUpperCase():null,id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/hr/personel/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM personel WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- PERSONEL BELGE ----
app.post("/hr/personel/:id/belge/:tur", uploadPersonelBelge.single("dosya"), async (req, res) => {
  try {
    const { id, tur } = req.params;
    if (!req.file) return res.status(400).json({ error: "Dosya gelmedi" });
    const old = await pool.query("SELECT dosya_yolu FROM personel_belgeler WHERE personel_id=$1 AND belge_turu=$2", [id, tur]);
    if (old.rows[0]) {
      await deleteFromStorage(old.rows[0].dosya_yolu);
      await pool.query("DELETE FROM personel_belgeler WHERE personel_id=$1 AND belge_turu=$2", [id, tur]);
    }
    const fname = `personel-${id}-${tur}-${Date.now()}${path.extname(utf8Name(req.file.originalname)).toLowerCase()}`;
    const { url } = await uploadToStorage("personel-belgeler", fname, req.file.buffer, req.file.mimetype);
    await pool.query("INSERT INTO personel_belgeler (personel_id,belge_turu,dosya_yolu) VALUES ($1,$2,$3)",
      [id, tur, url]);
    res.json({ ok: true, dosya: url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/hr/personel/:id/belgeler", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM personel_belgeler WHERE personel_id=$1", [req.params.id]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- ISG EĞİTİMLER ----
app.get("/hr/personel/:id/isg", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM personel_isg WHERE personel_id=$1 ORDER BY egitim_tarihi DESC", [req.params.id]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/hr/personel/:id/isg", async (req, res) => {
  try {
    const { egitim_turu, egitim_tarihi, gecerlilik_yil } = req.body;
    const bitis = new Date(egitim_tarihi);
    bitis.setFullYear(bitis.getFullYear() + parseInt(gecerlilik_yil));
    const r = await pool.query(
      `INSERT INTO personel_isg (personel_id,egitim_turu,egitim_tarihi,gecerlilik_yil,bitis_tarihi)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, egitim_turu, egitim_tarihi, gecerlilik_yil, bitis.toISOString().split("T")[0]]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/hr/personel/:id/isg/:isgId", async (req, res) => {
  try {
    await pool.query("DELETE FROM personel_isg WHERE id=$1 AND personel_id=$2", [req.params.isgId, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ISG belge yükleme
app.post("/hr/personel/:id/isg/:isgId/belge", uploadPersonelBelge.single("dosya"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Dosya gelmedi" });
    const fname = `isg-${req.params.isgId}-${Date.now()}${path.extname(utf8Name(req.file.originalname)).toLowerCase()}`;
    const { url } = await uploadToStorage("isg-belgeler", fname, req.file.buffer, req.file.mimetype);
    await pool.query("UPDATE personel_isg SET belge_yolu=$1 WHERE id=$2", [url, req.params.isgId]);
    res.json({ ok: true, dosya: url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Signed URL — browser Supabase'e direkt upload yapar (Vercel body limitini aşmak için)
app.get("/hr/isg/signed-upload-url", async (req, res) => {
  try {
    const { isgId, ext } = req.query;
    const filePath = `isg-belgeler/isg-${isgId}-${Date.now()}.${(ext||"jpg").replace(/^\./, "")}`;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(filePath);
    if (error) throw error;
    const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(filePath).data.publicUrl;
    res.json({ signedUrl: data.signedUrl, path: filePath, publicUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch("/hr/personel/:id/isg/:isgId/belge-url", async (req, res) => {
  try {
    const { url } = req.body;
    await pool.query("UPDATE personel_isg SET belge_yolu=$1 WHERE id=$2", [url, req.params.isgId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/hr/personel/:id/isg/:isgId/belge-url", async (req, res) => {
  try {
    const { url } = req.body;
    await pool.query("UPDATE personel_isg SET belge_yolu=$1 WHERE id=$2", [url, req.params.isgId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- PUANTAJ ----
app.get("/hr/puantaj", async (req, res) => {
  try {
    const { ay, yil } = req.query;
    const r = await pool.query(
      `SELECT p.*, per.ad_soyad, per.unvan, per.net_maas, per.bankadan_gosterilen, per.elden_verilen, per.aktif
       FROM puantaj p JOIN personel per ON p.personel_id = per.id
       WHERE EXTRACT(MONTH FROM p.tarih)=$1 AND EXTRACT(YEAR FROM p.tarih)=$2
       ORDER BY per.ad_soyad, p.tarih`,
      [ay, yil]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/hr/puantaj", async (req, res) => {
  try {
    const { personel_id, tarih, durum, created_by } = req.body;
    const r = await pool.query(
      `INSERT INTO puantaj (personel_id,tarih,durum,created_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (personel_id,tarih) DO UPDATE SET durum=$3, created_by=$4 RETURNING *`,
      [personel_id, tarih, durum||"CALISDI", created_by||""]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Puantaj not + belge güncelle
app.put("/hr/puantaj/:id/not", uploadPuantajBelge.single("belge"), async (req, res) => {
  try {
    const { id } = req.params;
    const { not_aciklama } = req.body;
    if (req.file) {
      const fname = `puantaj_${Date.now()}${path.extname(utf8Name(req.file.originalname))}`;
      const { url } = await uploadToStorage("puantaj-belgeler", fname, req.file.buffer, req.file.mimetype);
      await pool.query("UPDATE puantaj SET not_aciklama=$1, belge_yolu=$2 WHERE id=$3", [not_aciklama||"", url, id]);
    } else {
      await pool.query("UPDATE puantaj SET not_aciklama=$1 WHERE id=$2", [not_aciklama||"", id]);
    }
    const r = await pool.query("SELECT * FROM puantaj WHERE id=$1", [id]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Puantaj not sil
app.delete("/hr/puantaj/:id/not", async (req, res) => {
  try {
    const { id } = req.params;
    const row = await pool.query("SELECT belge_yolu FROM puantaj WHERE id=$1", [id]);
    const belge = row.rows[0]?.belge_yolu;
    if (belge) await deleteFromStorage(belge);
    await pool.query("UPDATE puantaj SET not_aciklama=NULL, belge_yolu=NULL WHERE id=$1", [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ay özeti: her personel için hakediş hesabı
app.get("/hr/puantaj/ozet", async (req, res) => {
  try {
    const { ay, yil } = req.query;
    // O ayın geçerli maaşıyla hesapla (maaş geçmişi versiyonlaması)
    const _ozetDonem = `${yil}-${String(ay).padStart(2, "0")}`;
    const personelList = await pool.query(`
      SELECT p.*,
        COALESCE(g.net_maas, p.net_maas) AS net_maas,
        COALESCE(g.bankadan_gosterilen, p.bankadan_gosterilen) AS bankadan_gosterilen,
        COALESCE(g.elden_verilen, p.elden_verilen) AS elden_verilen
      FROM personel p
      LEFT JOIN LATERAL (
        SELECT net_maas, bankadan_gosterilen, elden_verilen
        FROM personel_maas_gecmisi
        WHERE personel_id = p.id AND donem <= $1
        ORDER BY donem DESC LIMIT 1
      ) g ON true
      WHERE p.aktif=true OR p.isten_ayrilma_tarihi IS NOT NULL
      ORDER BY p.ad_soyad`, [_ozetDonem]);

    // Individual records to detect Sundays
    const puantajRows = await pool.query(
      `SELECT personel_id, durum, tarih FROM puantaj
       WHERE EXTRACT(MONTH FROM tarih)=$1 AND EXTRACT(YEAR FROM tarih)=$2`, [ay, yil]
    );

    // TR resmi tatiller (2024-2027)
    const TR_TATIL = ["2024-01-01","2024-04-23","2024-05-01","2024-05-19","2024-07-15","2024-08-30","2024-10-29","2024-03-29","2024-03-30","2024-03-31","2024-04-01","2024-04-02","2024-04-03","2024-06-16","2024-06-17","2024-06-18","2024-06-19","2025-01-01","2025-03-29","2025-03-30","2025-03-31","2025-04-01","2025-04-02","2025-04-23","2025-05-01","2025-05-19","2025-06-06","2025-06-07","2025-06-08","2025-06-09","2025-07-15","2025-08-30","2025-10-29","2026-01-01","2026-03-18","2026-03-19","2026-03-20","2026-03-21","2026-03-22","2026-04-23","2026-05-01","2026-05-19","2026-05-26","2026-05-27","2026-05-28","2026-05-29","2026-07-15","2026-08-30","2026-10-29","2027-01-01","2027-03-08","2027-03-09","2027-03-10","2027-03-11","2027-03-12","2027-04-23","2027-05-01","2027-05-19","2027-05-16","2027-05-17","2027-05-18","2027-05-19","2027-07-15","2027-08-30","2027-10-29"];

    // Cumulative all-time: total Sundays worked, resmi tatil worked, and total DINLENME days given
    const bakiyeRows = await pool.query(
      `SELECT personel_id,
        COUNT(*) FILTER (WHERE durum='CALISDI' AND EXTRACT(DOW FROM tarih)=0) AS pazar_calisdi_toplam,
        COUNT(*) FILTER (WHERE durum='DINLENME') AS dinlenme_toplam
       FROM puantaj GROUP BY personel_id`
    );

    // Cumulative resmi tatil çalışma (CALISDI on a known resmi tatil date)
    const tatilCalisdi = {};
    {
      const allCalisdi = await pool.query(`SELECT personel_id, tarih FROM puantaj WHERE durum='CALISDI'`);
      allCalisdi.rows.forEach(r => {
        const d = (r.tarih||"").toString().slice(0,10);
        if (TR_TATIL.includes(d)) {
          tatilCalisdi[r.personel_id] = (tatilCalisdi[r.personel_id]||0) + 1;
        }
      });
    }

    const avansList = await pool.query(
      `SELECT personel_id, SUM(tutar) as toplam FROM avans
       WHERE EXTRACT(MONTH FROM tarih)=$1 AND EXTRACT(YEAR FROM tarih)=$2 AND avans_turu='MAAS' GROUP BY personel_id`, [ay, yil]
    );

    const REFERANS_GUN = 26;
    const totalDays = new Date(yil, ay, 0).getDate();

    const ozet = personelList.rows.map(p => {
      const pRows = puantajRows.rows.filter(r => r.personel_id === p.id);

      const calisilan = pRows.filter(r => r.durum === "CALISDI").length;
      const gelmedi = pRows.filter(r => r.durum === "GELMEDI").length;
      const dinlenme = pRows.filter(r => r.durum === "DINLENME").length;

      // Count CALISDI entries that fall on a Sunday (DOW=0)
      const pazarCalisdi = pRows.filter(r => {
        if (r.durum !== "CALISDI") return false;
        return new Date(r.tarih).getDay() === 0;
      }).length;

      const netMaas = Number(p.net_maas) || 0;
      const dailyRate = netMaas / REFERANS_GUN;
      // İşe giriş bu ayın İÇİNDEYSE giriş öncesi günler hakedişe girmez:
      // taban maaş kalan takvim günü oranıyla kısılır (Ender/Selçuk vakası —
      // puantajda giriş öncesi gün kaydı olmadığından kesinti hiç oluşmuyordu)
      let girisFactor = 1;
      if (p.ise_giris_tarihi) {
        const g = new Date(p.ise_giris_tarihi);
        if (!Number.isNaN(g.getTime()) && g.getFullYear() === Number(yil) && (g.getMonth() + 1) === Number(ay)) {
          girisFactor = (totalDays - g.getDate() + 1) / totalDays;
        }
      }
      // Pazar/resmi tatil bonusu maaşa EKLENMEZ — dinlenme bakiyesine birikir
      const hakedilen = Math.max(0, Math.round(netMaas * girisFactor - gelmedi * dailyRate));
      const pazarBonus = 0; // Artık maaşa yansımıyor, dinlenme hakkı olarak birikiyor

      const bankaDailyRate = (Number(p.bankadan_gosterilen) || 0) / REFERANS_GUN;
      const eldenDailyRate = (Number(p.elden_verilen) || 0) / REFERANS_GUN;
      const bankadan = Math.max(0, Math.round((Number(p.bankadan_gosterilen) || 0) * girisFactor - gelmedi * bankaDailyRate));
      const elden = Math.max(0, Math.round((Number(p.elden_verilen) || 0) * girisFactor - gelmedi * eldenDailyRate));

      const avansRow = avansList.rows.find(a => a.personel_id === p.id);
      const avans = Number(avansRow?.toplam || 0);

      // Cumulative DİNLENME balance
      const bakiye = bakiyeRows.rows.find(r => r.personel_id === p.id);
      const toplamPazarCalisdi = parseInt(bakiye?.pazar_calisdi_toplam || 0);
      const toplamDinlenme = parseInt(bakiye?.dinlenme_toplam || 0);
      const toplamResmiTatilCalisdi = tatilCalisdi[p.id] || 0;
      // dinlenme bakiye: (pazar + resmi tatil) - dinlenme alınanlar
      const toplamExtraGun = toplamPazarCalisdi + toplamResmiTatilCalisdi;
      const dinlenmeBakiye = Math.max(0, toplamExtraGun - toplamDinlenme);
      const extraHakedis = Math.round(dinlenmeBakiye * (netMaas / REFERANS_GUN) * 1.5);

      return {
        personel_id: p.id, ad_soyad: p.ad_soyad, unvan: p.unvan, aktif: p.aktif,
        net_maas: p.net_maas, bankadan_gosterilen: p.bankadan_gosterilen, elden_verilen: p.elden_verilen,
        calisilan_gun: calisilan, gelmedi_gun: gelmedi, pazar_calisdi: pazarCalisdi,
        pazar_bonus: pazarBonus, dinlenme_gun: dinlenme, toplam_gun: totalDays,
        hakedilen_maas: hakedilen, bankadan, elden, avans,
        kalan: hakedilen - avans,
        dinlenme_bakiye: dinlenmeBakiye,
        toplam_pazar_calisdi: toplamPazarCalisdi,
        toplam_resmi_tatil_calisdi: toplamResmiTatilCalisdi,
        toplam_dinlenme: toplamDinlenme,
        extra_hakedis: extraHakedis,
      };
    }).filter(p => p.aktif);

    res.json(ozet);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- AVANS ----
app.get("/hr/avans", async (req, res) => {
  try {
    const { personel_id, turu } = req.query;
    const conditions = [];
    const params = [];
    if (personel_id) { params.push(personel_id); conditions.push(`a.personel_id=$${params.length}`); }
    if (turu) { params.push(turu); conditions.push(`a.avans_turu=$${params.length}`); }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const r = await pool.query(
      `SELECT a.*, p.ad_soyad FROM avans a JOIN personel p ON a.personel_id=p.id ${where} ORDER BY a.tarih DESC`,
      params
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/hr/avans", async (req, res) => {
  try {
    await pool.query(`ALTER TABLE avans ADD COLUMN IF NOT EXISTS donem TEXT`).catch(() => {});
    const { personel_id, tarih, tutar, aciklama, avans_turu = "MAAS", donem = null } = req.body;
    // Maaş avansında donem = hangi ay maaşından kesilecek (YYYY-MM); tarih = fiili ödeme günü
    const r = await pool.query(
      "INSERT INTO avans (personel_id,tarih,tutar,aciklama,avans_turu,donem) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [personel_id, tarih, tutar, aciklama, avans_turu, donem]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/hr/avans/:id", async (req, res) => {
  try {
    const { odendi, odeme_tarihi } = req.body;
    const r = await pool.query(
      "UPDATE avans SET odendi=$1, odeme_tarihi=$2 WHERE id=$3 RETURNING *",
      [odendi, odeme_tarihi||null, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/hr/avans/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM avans WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- MAAŞ ÖDEME ----
app.get("/hr/maas-odeme", async (req, res) => {
  try {
    const { personel_id } = req.query;
    const r = await pool.query(
      `SELECT m.*, p.ad_soyad FROM maas_odeme m JOIN personel p ON m.personel_id=p.id
       WHERE m.personel_id=$1 ORDER BY m.donem DESC, m.created_at DESC`,
      [personel_id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/hr/maas-odeme", async (req, res) => {
  try {
    const { personel_id, donem, bankadan, elden, tarih, aciklama, created_by } = req.body;
    const r = await pool.query(
      `INSERT INTO maas_odeme (personel_id,donem,bankadan,elden,tarih,aciklama,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [personel_id, donem, bankadan||0, elden||0, tarih, aciklama||"", created_by||""]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/hr/maas-odeme/:id", async (req, res) => {
  try {
    const { donem, bankadan, elden, tarih, aciklama } = req.body;
    const r = await pool.query(
      `UPDATE maas_odeme SET donem=$1, bankadan=$2, elden=$3, tarih=$4, aciklama=$5 WHERE id=$6 RETURNING *`,
      [donem, bankadan||0, elden||0, tarih, aciklama||"", req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/hr/maas-odeme/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM maas_odeme WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Aylık tüm personel ödeme özeti (personel maaş ödeme takibi için)
app.get("/hr/maas-odeme-aylik", async (req, res) => {
  try {
    const { donem } = req.query;
    if (!donem) return res.status(400).json({ error: "donem required (YYYY-MM)" });
    const r = await pool.query(`
      SELECT m.id, m.personel_id, m.bankadan, m.elden, m.tarih, m.aciklama, m.created_at,
             p.ad_soyad, p.net_maas,
             (COALESCE(m.bankadan,0) + COALESCE(m.elden,0)) AS toplam
      FROM maas_odeme m
      JOIN personel p ON m.personel_id = p.id
      WHERE m.donem = $1
      ORDER BY p.ad_soyad, m.tarih
    `, [donem]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Taşeron ödemeleri: fatura girişlerindeki odeme_tarihi'ne göre aylık özet
app.get("/finance/taseron-cashflow", requireFinanceAuth, async (req, res) => {
  try {
    const { yil, ay } = req.query;
    if (!yil || !ay) return res.status(400).json({ error: "yil ve ay zorunlu" });

    // Sadece odeme_tarihi o ay olan, odenen_tutar > 0 kayıtlar
    const result = await pool.query(`
      SELECT
        id,
        EXTRACT(DAY FROM odeme_tarihi)::int AS gun,
        TRIM(COALESCE(NULLIF(rf_montaj_firma,''), tedarikci, '')) AS firma,
        COALESCE(odenen_tutar, 0) AS tutar,
        fatura_no,
        fatura_tarihi,
        note
      FROM invoice_entries
      WHERE EXTRACT(YEAR FROM odeme_tarihi) = $1
        AND EXTRACT(MONTH FROM odeme_tarihi) = $2
        AND COALESCE(odenen_tutar, 0) > 0
        AND odeme_tarihi IS NOT NULL

      UNION ALL

      -- Faturasız avans ödemeleri (taseron_odeme_log.avans_tutar > 0)
      SELECT
        (l.id + 90000000) AS id,
        EXTRACT(DAY FROM l.tarih)::int AS gun,
        l.firma,
        COALESCE(l.avans_tutar, 0) AS tutar,
        'AVANS' AS fatura_no,
        l.tarih AS fatura_tarihi,
        COALESCE(l.aciklama, 'Avans — fatura bekleniyor') AS note
      FROM taseron_odeme_log l
      WHERE EXTRACT(YEAR FROM l.tarih) = $1
        AND EXTRACT(MONTH FROM l.tarih) = $2
        AND COALESCE(l.avans_tutar, 0) > 0

      ORDER BY gun ASC, firma ASC
    `, [Number(yil), Number(ay)]);

    // Gün bazlı toplam (cashflow grid için)
    const byDay = {};
    const details = {}; // gun → [{firma, tutar, fatura_no}, ...]
    result.rows.forEach(r => {
      const g = r.gun;
      byDay[g] = (byDay[g] || 0) + Number(r.tutar);
      if (!details[g]) details[g] = [];
      details[g].push({ id: r.id, firma: r.firma, tutar: Number(r.tutar), fatura_no: r.fatura_no, note: r.note });
    });

    res.json({ byDay, details });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Taşeron ödemesini nakit akışından kaldır: FATURA SİLİNMEZ, sadece ödeme
// bilgisi sıfırlanır (odenen_tutar=0, odeme_tarihi=NULL) — yanlış giriş
// Fatura Girişi'nden yeniden yazılabilir.
app.put("/finance/invoice-entries/:id/odeme-sil", requireFinanceAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE invoice_entries SET odenen_tutar=0, odeme_tarihi=NULL
       WHERE id=$1 RETURNING id, fatura_no`,
      [req.params.id],
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: "Kayıt bulunamadı" });
    res.json({ ok: true, kayit: r.rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Sarkan ödemeler: önceki aylarda eksik kalan maaş ödemeleri
app.get("/finance/sarkan-odemeler", requireFinanceAuth, async (req, res) => {
  try {
    // Toplam aktif personel bütçesi (şu anki net_maas toplamı)
    const butceRes = await pool.query(
      `SELECT COALESCE(SUM(net_maas),0) AS toplam FROM personel WHERE aktif=true`
    );
    const butce = Number(butceRes.rows[0].toplam);
    if (butce === 0) return res.json([]);

    // Son 6 ayın puantaj verisi olan dönemleri bul
    const donemRes = await pool.query(`
      SELECT DISTINCT to_char(to_date(yil||'-'||lpad(ay::text,2,'0'), 'YYYY-MM'), 'YYYY-MM') AS donem
      FROM puantaj
      WHERE to_char(to_date(yil||'-'||lpad(ay::text,2,'0'), 'YYYY-MM'), 'YYYY-MM') < to_char(NOW(), 'YYYY-MM')
      ORDER BY donem DESC
      LIMIT 6
    `).catch(() => ({ rows: [] }));

    if (donemRes.rows.length === 0) return res.json([]);

    const donemler = donemRes.rows.map(r => r.donem);

    // Her dönem için toplam ödenen
    const odemeRes = await pool.query(`
      SELECT donem, COALESCE(SUM(COALESCE(bankadan,0)+COALESCE(elden,0)),0) AS odenen
      FROM maas_odeme
      WHERE donem = ANY($1)
      GROUP BY donem
    `, [donemler]);

    const odemeMap = {};
    odemeRes.rows.forEach(r => { odemeMap[r.donem] = Number(r.odenen); });

    const sarkanlar = donemler.map(donem => {
      const odenen = odemeMap[donem] || 0;
      const sarkan = Math.max(0, butce - odenen);
      return { donem, butce, odenen, sarkan };
    }).filter(s => s.sarkan > 0);

    res.json(sarkanlar);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ISG uyarı özeti (süresi biten/bitecek eğitimler)
// GET /hr/isg/matris — tüm personel × tüm ISG eğitimler (matrix view için)
app.get("/hr/isg/matris", async (req, res) => {
  try {
    const personelRows = await pool.query(
      "SELECT id,ad_soyad,unvan,aktif,firma_tipi,elektrik_isi,yuksekte_calisma,arac_kullanim,ekip_bilgisi,alt_yuklenici,COALESCE(marka,'ERC') AS marka FROM personel ORDER BY aktif DESC, ad_soyad ASC"
    );
    const isgRows = await pool.query(
      "SELECT * FROM personel_isg ORDER BY personel_id, egitim_turu, bitis_tarihi DESC"
    );
    // Her personel için son geçerli eğitimi bul
    const map = {};
    for (const eg of isgRows.rows) {
      const key = `${eg.personel_id}__${eg.egitim_turu}`;
      if (!map[key]) map[key] = eg; // ORDER BY bitis_tarihi DESC → ilk = en yeni
    }
    const result = personelRows.rows.map(p => ({
      ...p,
      egitimler: Object.values(map).filter(e => e.personel_id === p.id),
    }));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/hr/isg/uyarilar", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT i.*, p.ad_soyad, p.unvan, COALESCE(p.marka,'ERC') AS marka,
        CASE WHEN i.bitis_tarihi < NOW() THEN 'SURESI_DOLDU'
             WHEN i.bitis_tarihi < NOW() + INTERVAL '30 days' THEN 'YAKLASAN'
             ELSE 'GECERLI' END AS durum
      FROM personel_isg i JOIN personel p ON i.personel_id=p.id
      WHERE p.aktif=true AND (i.bitis_tarihi < NOW() + INTERVAL '30 days')
      ORDER BY i.bitis_tarihi ASC
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- HR EXCEL EXPORTS ----
app.get("/hr/excel/puantaj", async (req, res) => {
  try {
    const { ay, yil, personel_id } = req.query;
    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook();
    wb.creator = "ERC Dashboard";
    wb.created = new Date();

    const NAVY       = "FF1E3A5F";
    const WHITE      = "FFFFFFFF";
    const LIGHT_BLUE = "FFEFF6FF";

    const DURUM_LABEL = { CALISDI:"✅", GELMEDI:"❌", IZIN:"🏖", RAPOR:"☪️", TATIL:"⭕", DINLENME:"💤", RESMI_TATIL:"🎌" };
    const DURUM_COLOR = { CALISDI:"FFD1FAE5", GELMEDI:"FFFEE2E2", IZIN:"FFDBEAFE", RAPOR:"FFFEF3C7", TATIL:"FFF9FAFB", DINLENME:"FFF3E8FF", RESMI_TATIL:"FFDBEAFE" };
    const WEEKEND_BG  = "FFFFF7ED"; // cumartesi/pazar kolonları

    // ── Açıklama sayfası ──
    const wsAciklama = wb.addWorksheet("Açıklama");
    wsAciklama.views = [{ showGridLines: false }];
    wsAciklama.columns = [{ width: 24 }, { width: 46 }];

    const aciklamaBaslik = wsAciklama.addRow(["PUANTAJ SİMGELERİ AÇIKLAMASI", ""]);
    wsAciklama.mergeCells("A1:B1");
    aciklamaBaslik.height = 28;
    aciklamaBaslik.getCell(1).font = { bold: true, size: 13, color: { argb: WHITE }, name: "Calibri" };
    aciklamaBaslik.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    aciklamaBaslik.getCell(1).alignment = { horizontal: "center", vertical: "middle" };

    wsAciklama.addRow([]);
    const aciklamalar = [
      ["✅  ÇALIŞTI",    "Personel o gün çalışmıştır.",                "FFD1FAE5"],
      ["❌  GELMEDİ",    "Personel o gün işe gelmemiştir (ücretsiz).", "FFFEE2E2"],
      ["🏖  İZİN",       "Yıllık izin kullanılmıştır (ücretli).",      "FFDBEAFE"],
      ["☪️  RAPOR",      "Sağlık raporu / hastalık izni.",              "FFFEF3C7"],
      ["⭕  TATİL",      "Hafta tatili veya girilmemiş gün.",           "FFF1F5F9"],
      ["💤  DİNLENME",   "Pazar fazla mesai karşılığı dinlenme.",       "FFF3E8FF"],
      ["🎌  RESMİ TATİL","Ulusal veya dini resmi tatil günü.",          "FFDBEAFE"],
    ];
    for (const [simge, aciklama, renk] of aciklamalar) {
      const r = wsAciklama.addRow([simge, aciklama]);
      r.height = 22;
      r.getCell(1).font = { bold: true, name: "Calibri", size: 11 };
      r.getCell(2).font = { name: "Calibri", size: 11 };
      r.eachCell(c => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: renk } };
        c.alignment = { vertical: "middle" };
        c.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
      });
    }
    wsAciklama.addRow([]);
    const notSatir = wsAciklama.addRow(["NOT:", "Maaş bilgileri bu Excel'e dahil edilmemiştir."]);
    notSatir.getCell(1).font = { bold: true, color: { argb: "FFB91C1C" }, name: "Calibri" };
    notSatir.getCell(2).font = { italic: true, color: { argb: "FF6B7280" }, name: "Calibri" };

    // ── Puantaj sayfası ──
    const ws = wb.addWorksheet("Puantaj");
    ws.views = [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 1 }];

    const totalDays = new Date(Number(yil), Number(ay), 0).getDate();
    const ayAdi = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"][Number(ay)-1];

    // Ay-farkındalıklı arşiv: seçili ayda çalışan personeli al (ayrılan personel
    // ayrıldığı aya kadarki Excel'lerde görünür, sonraki aylarda görünmez).
    const monthStart = `${yil}-${String(ay).padStart(2, "0")}-01`;
    const monthEnd = `${yil}-${String(ay).padStart(2, "0")}-${String(totalDays).padStart(2, "0")}`;
    const queryParams = [monthStart, monthEnd];
    let personelQuery = `SELECT * FROM personel
       WHERE (firma_tipi IS NULL OR firma_tipi = 'simsek')
         AND (ise_giris_tarihi IS NULL OR ise_giris_tarihi <= $2)
         AND (isten_ayrilma_tarihi IS NULL OR isten_ayrilma_tarihi >= $1)`;
    if (personel_id) {
      queryParams.push(personel_id);
      personelQuery += ` AND id=$3`;
    }
    personelQuery += " ORDER BY ad_soyad";
    const personelList = await pool.query(personelQuery, queryParams);

    const puantajRows = await pool.query(
      `SELECT id, personel_id, tarih, durum, not_aciklama, belge_yolu FROM puantaj
       WHERE EXTRACT(MONTH FROM tarih)=$1 AND EXTRACT(YEAR FROM tarih)=$2`, [ay, yil]
    );

    const ayGunleri = Array.from({ length: totalDays }, (_, i) => i + 1);

    // Başlık satırı
    const headers = ["Personel", "Unvan", ...ayGunleri.map(g => {
      const d = new Date(Number(yil), Number(ay)-1, g).getDay();
      return d===0 ? `${g}\nPaz` : d===6 ? `${g}\nCmt` : String(g);
    }), "Çalışılan"];
    const headerRow = ws.addRow(headers);
    headerRow.height = 30;
    headerRow.eachCell((cell, colNo) => {
      const g = colNo - 2; // gün index
      const isWeekend = g >= 1 && g <= totalDays && [0,6].includes(new Date(Number(yil), Number(ay)-1, g).getDay());
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isWeekend ? "FF2563EB" : NAVY } };
      cell.font = { bold: true, color: { argb: WHITE }, name: "Calibri", size: colNo <= 2 ? 11 : 9 };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = { right: { style: "thin", color: { argb: "FF3B6EA5" } } };
    });

    // Notlar sayfası
    const wsNot = wb.addWorksheet("Notlar");
    wsNot.views = [{ showGridLines: false }];
    const notHeaders = wsNot.addRow(["Personel", "Tarih", "Durum", "Not / Açıklama", "Belge"]);
    notHeaders.height = 24;
    notHeaders.eachCell(cell => {
      cell.font = { bold: true, color: { argb: WHITE }, name: "Calibri" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    wsNot.columns = [{ width: 24 }, { width: 14 }, { width: 14 }, { width: 52 }, { width: 30 }];

    for (const [pi, p] of personelList.rows.entries()) {
      const rowData = [p.ad_soyad, p.unvan || ""];
      let calisilan = 0;

      for (const g of ayGunleri) {
        const tarih = `${yil}-${String(ay).padStart(2,"0")}-${String(g).padStart(2,"0")}`;
        const pr = puantajRows.rows.find(x => x.personel_id === p.id && x.tarih?.toISOString?.().startsWith(tarih));
        const durum = pr?.durum || "TATIL";
        if (durum === "CALISDI") calisilan++;
        rowData.push(DURUM_LABEL[durum] || "⭕");
        if (pr?.not_aciklama || pr?.belge_yolu) {
          const notRow = wsNot.addRow([p.ad_soyad, tarih, durum, pr.not_aciklama || "", pr.belge_yolu || ""]);
          notRow.height = 20;
          notRow.getCell(4).alignment = { wrapText: true };
          const notRenk = { GELMEDI:"FFFEE2E2", RAPOR:"FFFEF3C7", IZIN:"FFDBEAFE" }[durum];
          if (notRenk) notRow.eachCell(c => { c.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:notRenk } }; c.border = { bottom:{ style:"thin", color:{ argb:"FFE5E7EB" } } }; });
        }
      }

      rowData.push(calisilan);
      const excelRow = ws.addRow(rowData);
      excelRow.height = 20;
      const isEven = pi % 2 === 0;

      // İsim & Unvan sütunları
      excelRow.getCell(1).font = { bold: true, name: "Calibri", size: 10 };
      excelRow.getCell(2).font = { name: "Calibri", size: 10, color: { argb: "FF6B7280" } };
      excelRow.getCell(1).fill = { type:"pattern", pattern:"solid", fgColor:{ argb: isEven ? LIGHT_BLUE : "FFFFFFFF" } };
      excelRow.getCell(2).fill = { type:"pattern", pattern:"solid", fgColor:{ argb: isEven ? LIGHT_BLUE : "FFFFFFFF" } };

      // Gün hücreleri
      for (const g of ayGunleri) {
        const tarih = `${yil}-${String(ay).padStart(2,"0")}-${String(g).padStart(2,"0")}`;
        const pr = puantajRows.rows.find(x => x.personel_id === p.id && x.tarih?.toISOString?.().startsWith(tarih));
        const durum = pr?.durum || "TATIL";
        const dayOfWeek = new Date(Number(yil), Number(ay)-1, g).getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const cell = excelRow.getCell(g + 2);
        cell.alignment = { horizontal: "center", vertical: "middle" };
        const bgColor = DURUM_COLOR[durum] || "FFF1F5F9";
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isWeekend && durum==="TATIL" ? WEEKEND_BG : bgColor } };
        cell.font = { name: "Calibri", size: 10 };
        cell.border = { right: { style: "hair", color: { argb: "FFE5E7EB" } }, bottom: { style: "hair", color: { argb: "FFE5E7EB" } } };
        if (pr?.not_aciklama) cell.note = { texts: [{ text: pr.not_aciklama }] };
      }

      // Çalışılan sütunu
      const calCell = excelRow.getCell(ayGunleri.length + 3);
      calCell.font = { bold: true, name: "Calibri", size: 11, color: { argb: "FF1E3A5F" } };
      calCell.alignment = { horizontal: "center", vertical: "middle" };
      calCell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb: isEven ? "FFE0F2FE" : "FFCFFAFE" } };
      calCell.border = { left: { style: "medium", color: { argb: "FF93C5FD" } } };
    }

    // Kolon genişlikleri
    ws.getColumn(1).width = 22;
    ws.getColumn(2).width = 16;
    for (let g = 1; g <= totalDays; g++) ws.getColumn(g + 2).width = 4.5;
    ws.getColumn(totalDays + 3).width = 10;

    const ayPad = String(ay).padStart(2,"0");
    // Türkçe karakterler (Mayıs, Şubat, Ağustos...) HTTP header'da geçersiz → ASCII fallback + RFC 5987 UTF-8
    const puantajFileName = `ERC_Puantaj_${ayAdi}_${yil}.xlsx`;
    const puantajAscii = puantajFileName.replace(/[^\x20-\x7E]/g, "_");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${puantajAscii}"; filename*=UTF-8''${encodeURIComponent(puantajFileName)}`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { console.error("PUANTAJ EXCEL ERROR:", e.message); res.status(500).json({ error: e.message }); }
});

// ── Yardımcı: Excel tarih serial → "YYYY-MM-DD" (ExcelJS bazen sayı döner)
function excelDateFmt(v) {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().split("T")[0];
  return String(v).split("T")[0];
}

// ── Kalan gün hesapla
function kalanGun(bitisDateStr) {
  if (!bitisDateStr) return null;
  const bitis = new Date(bitisDateStr);
  const now = new Date();
  return Math.round((bitis - now) / 86400000);
}

// ── ARGB renk: kırmızı/sarı/yeşil
function kalanGunArgb(gun) {
  if (gun === null || gun === undefined) return null;
  if (gun < 0)   return "FFFEE2E2"; // kırmızı
  if (gun <= 30) return "FFFFFBEB"; // sarı
  return "FFF0FDF4"; // yeşil
}

// ── Hücreyi renklendir
function rfqCell(ws, rowNo, colNo, value, bgArgb, bold, fontArgb) {
  const cell = ws.getCell(rowNo, colNo);
  cell.value = value ?? "";
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  if (bgArgb) cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb: bgArgb } };
  if (bold || fontArgb) cell.font = { bold: !!bold, color: fontArgb ? { argb: fontArgb } : undefined, name:"Calibri", size:9 };
  else cell.font = { name:"Calibri", size:9 };
  cell.border = {
    top:{ style:"thin", color:{ argb:"FFD1D5DB" } },
    bottom:{ style:"thin", color:{ argb:"FFD1D5DB" } },
    left:{ style:"thin", color:{ argb:"FFD1D5DB" } },
    right:{ style:"thin", color:{ argb:"FFD1D5DB" } },
  };
  return cell;
}

// GET /hr/excel/isg?tip=hw|simsek&personel_id=X
app.get("/hr/excel/isg", async (req, res) => {
  try {
    const { tip, personel_id } = req.query; // tip: "hw" (aktif) | "simsek" (tümü)
    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook();
    wb.creator = "ERC Dashboard";
    wb.created = new Date();

    const ws = wb.addWorksheet("RFQ", { views:[{ showGridLines:false }] });

    // ── Personel listesi ──
    let pQuery = "SELECT * FROM personel";
    const pParams = [];
    if (personel_id) {
      pQuery += " WHERE id=$1";
      pParams.push(personel_id);
    } else if (tip === "hw") {
      pQuery += " WHERE aktif=true";
    }
    // tip==="simsek" → tüm personeller (aktif+pasif)
    pQuery += " ORDER BY aktif DESC, ad_soyad ASC";
    const personelRows = await pool.query(pQuery, pParams);

    // ── ISG eğitimleri ──
    const isgRows = await pool.query(
      "SELECT * FROM personel_isg ORDER BY personel_id, egitim_turu, bitis_tarihi DESC"
    );
    const isgByPersonel = {};
    for (const eg of isgRows.rows) {
      const pid = eg.personel_id;
      if (!isgByPersonel[pid]) isgByPersonel[pid] = {};
      if (!isgByPersonel[pid][eg.egitim_turu]) isgByPersonel[pid][eg.egitim_turu] = eg;
    }

    // ── Satır 1: Başlık ──
    const NAVY  = "FF1E3A5F";
    const WHITE = "FFFFFFFF";
    const ORANGE= "FFD97706";
    const RED   = "FF991B1B";
    const GREEN = "FF166534";

    ws.mergeCells("A1:AZ1");
    const r1 = ws.getCell("A1");
    r1.value = `${tip === "hw" ? "ŞIMŞEK HABERLEŞME" : "ŞİMŞEK HABERLEŞME"}  RFQ TABLOSU`;
    r1.font = { bold:true, size:14, color:{ argb:WHITE }, name:"Calibri" };
    r1.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:NAVY } };
    r1.alignment = { horizontal:"center", vertical:"middle" };
    ws.getRow(1).height = 28;

    // ── Satır 2: ISG Sorumlusu ──
    ws.mergeCells("A2:H2");
    ws.getCell("A2").value = "Firma ISG Sorumlusu : Sultan Yeniçeri";
    ws.mergeCells("I2:R2");
    ws.getCell("I2").value = "Mail Adresi : sultan.yeniceri@simsektel.com";
    ws.mergeCells("S2:AZ2");
    ws.getCell("S2").value = "Telefon No: 5330165678";
    for (const ref of ["A2","I2","S2"]) {
      const c = ws.getCell(ref);
      c.font = { bold:true, size:10, name:"Calibri" };
      c.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFEFF6FF" } };
      c.alignment = { vertical:"middle" };
      c.border = { bottom:{ style:"medium", color:{ argb:NAVY } } };
    }
    ws.getRow(2).height = 22;

    // ── Satır 3: Başlıklar (52 kolon) ──
    const HEADERS = [
      "Sıra No","Çalışma Durumu","Ekip Bilgisi","Adı Soyadı","TC Kimlik Numarası",
      "Firma Adı","Alt Yüklenici","Görevi","Mesleki Yeterlilik Durumu","Mesleki Yeterlilik Tarihi",
      "İşe Giriş (SGK) Tarihi",
      "Sağlık Raporu Tarihi","Sağlık Raporu Geçerlilik Tarihi (1 YIL)","Geçerlilik Süresi\n(Kalan Gün)","Sağlık Raporu Alınan Yer",
      "KKD Zimmet Tarihi",
      "HUAWEI 10 Mutlak Kural /\nBaşlangıç Eğitimi Tarihi","HUAWEI 10 Mutlak Kural /\nGeçerlilik Tarihi","HUAWEI 10 Mutlak Kural\nKalan Gün",
      "Temel İSG\nEğitim Tarihi","Temel İSG\nGeçerlilik Tarihi (1 YIL)","Geçerlilik Süresi\n(Kalan Gün)","Temel İSG\nEğitim Firması",
      "ELEKTRİK işi yapacak mı?","EİSG Eğitim Tarihi","ELEKTRİK Eğitim Geçerlilik Tarihi (1 YIL)","Geçerlilik Süresi\n(Kalan Gün)","ELEKTRİK\nEğitim Firması",
      "Yüksekte Çalışacak mı","Y. ÇALIŞMA Eğitim Tarihi","Y.ÇALIŞMA Geçerlilik Tarihi (2 YIL)","Geçerlilik Süresi\n(Kalan Gün)","Y. ÇALIŞMA Eğitim Firması",
      "Kurtarma Eğitimi Var mı","Kurtarma Eğitim Tarihi","Kurtarma Geçerlilik Tarihi (2 YIL)","Geçerlilik Süresi\n(Kalan Gün)","Kurtarma Eğitim Firması",
      "ARAÇ kullanacak mı?","GÜVENLİ SÜRÜŞ\nEğitim Tarihi","GÜV. SÜRÜŞ\nGeçerlilik Tarihi(2 YIL)","Geçerlilik Süresi\n(Kalan Gün)","GÜV. SÜRÜŞ\nEğitim Firması",
      "İlkyardım Eğitimi Var mı?","İLKYARDIM\nEğitim Tarihi","İLKYARDIM\nGeçerlilik Tarihi (3 YIL)","Geçerlilik Süresi\n(Kalan Gün)","İLKYARDIM\nEğitim Firma",
      "Mail Adresi","Telefon","ISDP Account","İresource Girişi Yapıldı mı?"
    ];

    const hRow = ws.getRow(3);
    hRow.height = 52;
    HEADERS.forEach((h, i) => {
      const cell = hRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold:true, color:{ argb:WHITE }, name:"Calibri", size:9 };
      cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:NAVY } };
      cell.alignment = { horizontal:"center", vertical:"middle", wrapText:true };
      cell.border = { top:{ style:"thin", color:{ argb:"FF3B6EA5" } }, bottom:{ style:"thin", color:{ argb:"FF3B6EA5" } }, left:{ style:"thin", color:{ argb:"FF3B6EA5" } }, right:{ style:"thin", color:{ argb:"FF3B6EA5" } } };
    });

    // ── Veri satırları ──
    const now = new Date();
    for (const [pi, p] of personelRows.rows.entries()) {
      const rowNo = pi + 4;
      const isg = isgByPersonel[p.id] || {};
      const bg = pi % 2 === 0 ? "FFFFFFFF" : "FFEFF6FF";

      // ISG eğitimlerine kısayol
      const saglik   = isg["Sağlık Raporu"];
      const hw10     = isg["HUAWEI 10 Mutlak Kural"];
      const temelIsg = isg["Temel İSG"];
      const elektrik = isg["ELEKTRİK İSG"];
      const yuksek   = isg["Yüksekte Çalışma"];
      const kurtarma = isg["Kurtarma Eğitimi"];
      const surus    = isg["Güvenli Sürüş"];
      const ilkYardim= isg["İlkyardım"];

      const saglikGun   = kalanGun(saglik?.bitis_tarihi);
      const hw10Gun     = kalanGun(hw10?.bitis_tarihi);
      const temelGun    = kalanGun(temelIsg?.bitis_tarihi);
      const elektrikGun = kalanGun(elektrik?.bitis_tarihi);
      const yuksekGun   = kalanGun(yuksek?.bitis_tarihi);
      const kurtarmaGun = kalanGun(kurtarma?.bitis_tarihi);
      const surusGun    = kalanGun(surus?.bitis_tarihi);
      const ilkYardimGun= kalanGun(ilkYardim?.bitis_tarihi);

      const calismaDurumu = p.aktif ? "Uygun Değil" : "Pasif"; // gerçek durum kullanıcı girer

      const vals = [
        pi + 1,
        calismaDurumu,
        p.ekip_bilgisi || "",
        p.ad_soyad,
        p.tc_no || "",
        "HUAWEI",
        p.alt_yuklenici || "ŞİMŞEK HABERLEŞME",
        p.unvan || "",
        p.mesleki_yeterlilik_durum || "",
        excelDateFmt(p.mesleki_yeterlilik_tarihi),
        excelDateFmt(p.ise_giris_tarihi),
        // Sağlık
        excelDateFmt(saglik?.egitim_tarihi),
        excelDateFmt(saglik?.bitis_tarihi),
        saglikGun !== null ? `${saglikGun} Gün` : "",
        "",  // Sağlık Raporu Alınan Yer
        // KKD
        excelDateFmt(p.kkd_zimmet_tarihi),
        // HUAWEI 10
        excelDateFmt(hw10?.egitim_tarihi),
        excelDateFmt(hw10?.bitis_tarihi),
        hw10Gun !== null ? `${hw10Gun} Gün` : "",
        // Temel ISG
        excelDateFmt(temelIsg?.egitim_tarihi),
        excelDateFmt(temelIsg?.bitis_tarihi),
        temelGun !== null ? `${temelGun} Gün` : "",
        "",  // Temel ISG Eğitim Firması
        // ELEKTRİK
        p.elektrik_isi ? "Evet" : "Hayır",
        excelDateFmt(elektrik?.egitim_tarihi),
        excelDateFmt(elektrik?.bitis_tarihi),
        elektrikGun !== null ? `${elektrikGun} Gün` : "",
        "",  // Elektrik Eğitim Firması
        // Yüksekte
        p.yuksekte_calisma ? "Evet" : "Hayır",
        excelDateFmt(yuksek?.egitim_tarihi),
        excelDateFmt(yuksek?.bitis_tarihi),
        yuksekGun !== null ? `${yuksekGun} Gün` : "",
        "",  // Yüksekte Çalışma Eğitim Firması
        // Kurtarma
        kurtarma ? "Evet" : "Hayır",
        excelDateFmt(kurtarma?.egitim_tarihi),
        excelDateFmt(kurtarma?.bitis_tarihi),
        kurtarmaGun !== null ? `${kurtarmaGun} Gün` : "",
        "",  // Kurtarma Eğitim Firması
        // Güvenli Sürüş
        p.arac_kullanim ? "Evet" : "Hayır",
        excelDateFmt(surus?.egitim_tarihi),
        excelDateFmt(surus?.bitis_tarihi),
        surusGun !== null ? `${surusGun} Gün` : "",
        "",  // Sürüş Eğitim Firması
        // İlkyardım
        ilkYardim ? "Evet" : "Hayır",
        excelDateFmt(ilkYardim?.egitim_tarihi),
        excelDateFmt(ilkYardim?.bitis_tarihi),
        ilkYardimGun !== null ? `${ilkYardimGun} Gün` : "",
        "",  // İlkyardım Eğitim Firma
        // İletişim
        p.email || "",
        p.telefon || "",
        p.isdp_account || "",
        p.iresource_giris || "",
      ];

      const row = ws.getRow(rowNo);
      row.height = 18;
      vals.forEach((v, i) => {
        const colNo = i + 1;
        // "Kalan Gün" kolonlarına özel renklendirme
        const isKalanGunCol = [14,19,22,27,32,37,42,47].includes(colNo);
        let cellBg = bg;
        let bold = false;
        let fontColor;
        if (isKalanGunCol) {
          const gunVal = parseInt(String(v));
          if (!isNaN(gunVal)) {
            cellBg = kalanGunArgb(gunVal);
            if (gunVal < 0)   { bold = true; fontColor = "FF991B1B"; }
            else if (gunVal <= 30) { bold = true; fontColor = "FF92400E"; }
            else { bold = true; fontColor = "FF166534"; }
          }
        }
        rfqCell(ws, rowNo, colNo, v, cellBg, bold, fontColor);
      });
    }

    // ── Kolon genişlikleri ──
    const COL_WIDTHS = [
      6,14,10,22,16, 10,20,16,14,14, 14, // 1-11
      14,14,10,18, 14, // 12-16
      14,14,10, // 17-19
      14,14,10,16, // 20-23
      10,14,14,10,16, // 24-28
      10,14,14,10,16, // 29-33
      10,14,14,10,16, // 34-38
      10,14,14,10,16, // 39-43
      10,14,14,10,16, // 44-48
      22,14,18,14,    // 49-52
    ];
    COL_WIDTHS.forEach((w, i) => { if (ws.getColumn(i+1)) ws.getColumn(i+1).width = w; });

    const fname = tip === "simsek"
      ? `Simsek_ISG_RFQ_${new Date().toISOString().split("T")[0]}.xlsx`
      : `Huawei_RFQ_${new Date().toISOString().split("T")[0]}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=${fname}`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { console.error("RFQ EXCEL ERROR:", e.message); res.status(500).json({ error: e.message }); }
});

// ============================================================
// İŞ AVANSI TALEPLERİ
// ============================================================
pool.query(`
  CREATE TABLE IF NOT EXISTS is_avans_talep (
    id SERIAL PRIMARY KEY,
    personel_id INTEGER REFERENCES personel(id) ON DELETE SET NULL,
    talep_eden_email TEXT NOT NULL,
    talep_eden_ad TEXT NOT NULL,
    tutar NUMERIC NOT NULL,
    aciklama TEXT,
    not_aciklama TEXT,
    durum TEXT DEFAULT 'TALEP',
    tarih DATE NOT NULL,
    pm_onay_tarihi DATE,
    direktor_onay_tarihi DATE,
    muhasebe_onay_tarihi DATE,
    odeme_tarihi DATE,
    reddeden_email TEXT,
    red_aciklama TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );
  ALTER TABLE is_avans_talep ADD COLUMN IF NOT EXISTS gider_turu TEXT;
  ALTER TABLE is_avans_talep ADD COLUMN IF NOT EXISTS bolge TEXT;
  ALTER TABLE is_avans_talep ADD COLUMN IF NOT EXISTS proje TEXT;
  ALTER TABLE is_avans_talep ADD COLUMN IF NOT EXISTS reddeden_email TEXT;
  ALTER TABLE is_avans_talep ADD COLUMN IF NOT EXISTS red_aciklama TEXT;
  ALTER TABLE is_avans_talep ADD COLUMN IF NOT EXISTS rollout_mudur_onay_tarihi DATE;
  ALTER TABLE is_avans_talep ADD COLUMN IF NOT EXISTS plaka TEXT;
  ALTER TABLE is_avans_talep ADD COLUMN IF NOT EXISTS firma TEXT;
`).catch(e => console.error("is_avans_talep tablo hatası:", e.message));

// GET iş avansı bakiye for a personel by email
app.get("/hr/is-avans/bakiye", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "email gerekli" });
    // Avans: kişi PERSONEL olarak atandıysa ona göre say (talep eden değil, alıcı)
    const avansRes = await pool.query(
      `SELECT COALESCE(SUM(t.tutar),0) as toplam
       FROM is_avans_talep t
       JOIN personel p ON p.id = t.personel_id
       WHERE LOWER(p.email)=LOWER($1) AND t.durum='TAMAMLANDI'`,
      [email]
    );
    // Eğer personel kaydı yoksa talep_eden_email ile fallback
    const avansResFallback = await pool.query(
      `SELECT COALESCE(SUM(tutar),0) as toplam FROM is_avans_talep
       WHERE LOWER(talep_eden_email)=LOWER($1) AND durum='TAMAMLANDI'
       AND personel_id IS NULL`,
      [email]
    );
    const masrafRes = await pool.query(
      `SELECT COALESCE(SUM(mk.tutar),0) as toplam FROM masraf_kalem mk
       JOIN masraf_form mf ON mf.id = mk.form_id
       WHERE LOWER(mf.talep_eden_email)=LOWER($1) AND mf.durum='ARSIVLENDI'`,
      [email]
    );
    const avans = Number(avansRes.rows[0].toplam) + Number(avansResFallback.rows[0].toplam);
    const masraf = Number(masrafRes.rows[0].toplam);
    res.json({ avans, masraf, bakiye: avans - masraf });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Personel bazlı iş avansı bakiyeleri (yönetici görünümü):
// bakiye = TAMAMLANDI iş avansları − ARŞİVLENDİ masraf formları.
// Muhasebe formu arşivleyince tutar avanstan otomatik düşer; personelin
// avansı yoksa bakiye eksiye iner (şirket personele borçlu).
app.get("/hr/is-avans/bakiyeler", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT p.id, p.ad_soyad, p.aktif, COALESCE(p.marka,'ERC') AS marka,
        COALESCE(av.toplam,0) AS avans,
        COALESCE(ms.toplam,0) AS masraf,
        COALESCE(av.toplam,0) - COALESCE(ms.toplam,0) AS bakiye
      FROM personel p
      LEFT JOIN (
        SELECT personel_id, SUM(tutar) AS toplam
        FROM is_avans_talep
        WHERE durum='TAMAMLANDI' AND personel_id IS NOT NULL
        GROUP BY personel_id
      ) av ON av.personel_id = p.id
      LEFT JOIN (
        SELECT LOWER(mf.talep_eden_email) AS email, SUM(mk.tutar) AS toplam
        FROM masraf_kalem mk JOIN masraf_form mf ON mf.id = mk.form_id
        WHERE mf.durum='ARSIVLENDI'
        GROUP BY 1
      ) ms ON ms.email = LOWER(COALESCE(p.email,''))
      WHERE COALESCE(av.toplam,0) <> 0 OR COALESCE(ms.toplam,0) <> 0
      ORDER BY bakiye ASC, p.ad_soyad ASC
    `);
    res.json({ ok: true, rows: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/hr/is-avans", async (req, res) => {
  try {
    const { email, name } = req.query;
    let query, params;
    if (email) {
      // personelId bul: önce email ile, sonra name ile (mobil user.email = kullanıcı adı olabilir)
      const normTr = s => (s||'').toLowerCase()
        .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ğ/g,'g')
        .replace(/ü/g,'u').replace(/ş/g,'s').replace(/ö/g,'o').replace(/ç/g,'c');
      let personelId = null;
      // email gerçek email gibi görünüyorsa personel tablosunda ara
      if (email.includes('@')) {
        const pr = await pool.query(
          `SELECT id FROM personel WHERE LOWER(TRIM(email))=LOWER(TRIM($1)) AND aktif=true LIMIT 1`,
          [email]
        );
        personelId = pr.rows[0]?.id || null;
      }
      // email eşleşmedi ve name varsa isimle ara
      if (!personelId && name) {
        const normName = normTr(name.trim());
        const pr = await pool.query(
          `SELECT id FROM personel WHERE aktif=true
             AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
               TRIM(ad_soyad),'İ','I'),'Ş','S'),'Ğ','G'),'Ü','U'),'Ö','O'),'Ç','C'))
               = REPLACE($1,'ı','i') LIMIT 1`,
          [normName]
        );
        personelId = pr.rows[0]?.id || null;
      }
      // Hem talep_eden_email hem de personel_id üzerinden eşleştir
      if (personelId) {
        query = `SELECT t.*, p.ad_soyad as personel_ad, p.email as personel_email
                 FROM is_avans_talep t
                 LEFT JOIN personel p ON t.personel_id = p.id
                 WHERE LOWER(t.talep_eden_email)=LOWER($1)
                    OR t.personel_id=$2
                 ORDER BY t.created_at DESC`;
        params = [email, personelId];
      } else {
        query = `SELECT t.*, p.ad_soyad as personel_ad, p.email as personel_email
                 FROM is_avans_talep t
                 LEFT JOIN personel p ON t.personel_id = p.id
                 WHERE LOWER(t.talep_eden_email)=LOWER($1)
                    OR LOWER(p.email)=LOWER($1)
                 ORDER BY t.created_at DESC`;
        params = [email];
      }
    } else {
      query = `SELECT t.*, p.ad_soyad as personel_ad, p.email as personel_email
               FROM is_avans_talep t
               LEFT JOIN personel p ON t.personel_id = p.id
               ORDER BY t.created_at DESC`;
      params = [];
    }
    const r = await pool.query(query, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/hr/is-avans", async (req, res) => {
  try {
    const {
      personel_id,
      talep_eden_email,
      talep_eden_ad, talep_eden,          // mobil "talep_eden" gönderebilir
      tutar,
      aciklama,
      not_aciklama,
      tarih,
      gider_turu,
      bolge,
      proje, proje_kodu,                  // mobil "proje_kodu" gönderebilir
      banka_adi,
      iban,
      plaka,
      firma,                              // talep anında AHY / ERC seçimi
    } = req.body;
    const firmaFinal = String(firma || "").toUpperCase() === "AHY" ? "AHY"
      : String(firma || "").toUpperCase() === "ERC" ? "ERC" : null;

    const adFinal    = talep_eden_ad || talep_eden || "";
    const projeFinal = proje || proje_kodu || null;
    const tarihFinal = tarih || new Date().toISOString().split("T")[0]; // bugün default

    if (!adFinal)           return res.status(400).json({ error: "talep_eden_ad zorunlu" });
    if (!talep_eden_email)  return res.status(400).json({ error: "talep_eden_email zorunlu" });
    if (!tutar)             return res.status(400).json({ error: "tutar zorunlu" });

    // Herkes Rollout Manager'dan başlar.
    // İSTİSNA: Talep sahibi Rollout onaycısının kendisi (Orhan) ise, kendi talebi
    // kendi onayına düşmesin → doğrudan Proje Direktörü (Düzgün Şimşek) onayına gitsin.
    // Bunun için durum PM_ONAY başlar (Rollout+PM aşamaları otomatik geçilir).
    const today = new Date().toISOString().split("T")[0];
    const requesterEmail = String(talep_eden_email || "").toLowerCase().trim();
    const isRolloutApprover = requesterEmail === "orhan.bedir@simsektel.com";
    const durumFinal = isRolloutApprover ? "PM_ONAY" : "TALEP";
    const pmOnayTarihi = isRolloutApprover ? today : null;

    // banka_adi / iban kolonları yoksa ekle (ilk çalışmada oluşturulur)
    await pool.query(`
      ALTER TABLE is_avans_talep
        ADD COLUMN IF NOT EXISTS banka_adi TEXT,
        ADD COLUMN IF NOT EXISTS iban      TEXT
    `).catch(() => {});

    // Personel seçilmediyse avansın alıcısı talep edendir: e-postasından
    // personel kaydını bulup bağla — kişisel bakiye (mobil "üzerimdeki iş
    // avansı") ve personel avans bakiyeleri doğru işlesin
    let personelIdFinal = personel_id || null;
    if (!personelIdFinal && talep_eden_email) {
      const pf = await pool.query(
        `SELECT id FROM personel WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) AND aktif = true LIMIT 1`,
        [talep_eden_email]).catch(() => ({ rows: [] }));
      personelIdFinal = pf.rows[0]?.id || null;
    }

    const r = await pool.query(
      `INSERT INTO is_avans_talep
         (personel_id,talep_eden_email,talep_eden_ad,tutar,aciklama,not_aciklama,tarih,gider_turu,bolge,proje,banka_adi,iban,durum,pm_onay_tarihi,plaka,firma)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [
        personelIdFinal,
        talep_eden_email,
        adFinal,
        tutar,
        aciklama || null,
        not_aciklama || null,
        tarihFinal,
        gider_turu || null,
        bolge || null,
        projeFinal,
        banka_adi || null,
        iban || null,
        durumFinal,
        pmOnayTarihi,
        plaka ? String(plaka).trim().toUpperCase().replace(/\s+/g, " ") : null,
        firmaFinal,
      ]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/hr/is-avans/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { personel_id, tutar, aciklama, not_aciklama, tarih, gider_turu, bolge, proje, plaka } = req.body;
    const check = await pool.query("SELECT durum FROM is_avans_talep WHERE id=$1", [id]);
    if (!check.rows[0] || check.rows[0].durum !== "TALEP") {
      return res.status(400).json({ error: "Sadece TALEP durumundaki kayıtlar düzenlenebilir" });
    }
    const r = await pool.query(
      `UPDATE is_avans_talep SET personel_id=$1,tutar=$2,aciklama=$3,not_aciklama=$4,tarih=$5,gider_turu=$6,bolge=$7,proje=$8,plaka=$9 WHERE id=$10 RETURNING *`,
      [personel_id || null, tutar, aciklama, not_aciklama, tarih, gider_turu || null, bolge || null, proje || null,
       plaka ? String(plaka).trim().toUpperCase().replace(/\s+/g, " ") : null, id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/hr/is-avans/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM is_avans_talep WHERE id=$1", [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Onaylarken firma seçimi (16.07.2026 kurgusu): PM (Orhan) onaylarken —
// talep Orhan'ınsa Direktör (Düzgün) onaylarken — AHY/ŞİMŞEK seçer.
// firma='AHY' → AHY nakit akışına, 'ERC' → Şimşek nakit akışına düşer.
function normalizeAvansFirma(v) {
  const s = String(v || "").toUpperCase().trim();
  if (s === "AHY") return "AHY";
  if (s === "ERC" || s === "SIMSEK" || s === "ŞİMŞEK") return "ERC";
  return null;
}

// İş avansı onay yetkileri — adım bazlı (28.07 olayı: muhasebe/yetkisiz
// çağrılar zinciri tek başına tamamlayabiliyordu; artık her adım kilitli)
const AVANS_YETKI = {
  RM:  ["nurcan.kus@simsektel.com","serdar.altinova@simsektel.com","murat.istek@simsektel.com","orhan.bedir@simsektel.com","duzgun.simsek@simsektel.com","info@ahyelektrik.com"],
  PM:  ["orhan.bedir@simsektel.com","duzgun.simsek@simsektel.com","info@ahyelektrik.com"],
  PD:  ["duzgun.simsek@simsektel.com","info@ahyelektrik.com"],
  ODE: ["muhasebe@simsektel.com","orhan.bedir@simsektel.com","duzgun.simsek@simsektel.com","info@ahyelektrik.com"],
};
function avansYetkili(req, adim) {
  const email = String(req.user?.email || "").toLowerCase().trim();
  const rol = String(req.user?.role || "").toLowerCase();
  if (adim === "ODE" && rol === "muhasebe") return true;
  return (AVANS_YETKI[adim] || []).includes(email);
}

app.put("/hr/is-avans/:id/onayla", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const firmaSecim = normalizeAvansFirma(req.body?.firma);
    const row = await pool.query("SELECT * FROM is_avans_talep WHERE id=$1", [id]);
    if (!row.rows[0]) return res.status(404).json({ error: "Kayıt bulunamadı" });
    const talep = row.rows[0];
    const ADIM = { TALEP: "RM", ROLLOUT_MUDUR_ONAY: "PM", PM_ONAY: "PD", DIREKTOR_ONAY: "ODE" }[talep.durum];
    if (ADIM && !avansYetkili(req, ADIM)) {
      return res.status(403).json({ error: "Bu onay adımı için yetkiniz yok" });
    }
    if (firmaSecim) {
      await pool.query("UPDATE is_avans_talep SET firma=$1 WHERE id=$2", [firmaSecim, id]);
    }
    const today = new Date().toISOString().split("T")[0];
    let updateSql, updateParams;

    if (talep.durum === "TALEP") {
      // Rollout Manager onaylıyor
      updateSql = "UPDATE is_avans_talep SET durum='ROLLOUT_MUDUR_ONAY', rollout_mudur_onay_tarihi=$1 WHERE id=$2 RETURNING *";
      updateParams = [today, id];
    } else if (talep.durum === "ROLLOUT_MUDUR_ONAY") {
      // PM onaylıyor
      updateSql = "UPDATE is_avans_talep SET durum='PM_ONAY', pm_onay_tarihi=$1 WHERE id=$2 RETURNING *";
      updateParams = [today, id];
    } else if (talep.durum === "PM_ONAY") {
      // Direktör onaylıyor
      updateSql = "UPDATE is_avans_talep SET durum='DIREKTOR_ONAY', direktor_onay_tarihi=$1 WHERE id=$2 RETURNING *";
      updateParams = [today, id];
    } else if (talep.durum === "DIREKTOR_ONAY") {
      updateSql = "UPDATE is_avans_talep SET durum='TAMAMLANDI', muhasebe_onay_tarihi=$1, odeme_tarihi=$1 WHERE id=$2 RETURNING *";
      updateParams = [today, id];
      const updated = await pool.query(updateSql, updateParams);
      // Insert into avans table
      if (talep.personel_id) {
        await pool.query(
          `INSERT INTO avans (personel_id,tarih,tutar,aciklama,avans_turu,odendi,odeme_tarihi)
           VALUES ($1,$2,$3,$4,'IS',true,$5)`,
          [talep.personel_id, talep.tarih, talep.tutar, talep.aciklama || "İş Avansı", today]
        );
      }
      return res.json(updated.rows[0]);
    } else {
      return res.status(400).json({ error: "Bu durumda onay yapılamaz" });
    }

    const updated = await pool.query(updateSql, updateParams);
    res.json(updated.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PM — TALEP veya ROLLOUT_MUDUR_ONAY'ı doğrudan PM_ONAY'a taşır
app.put("/hr/is-avans/:id/pm-onayla", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!avansYetkili(req, "PM")) {
      return res.status(403).json({ error: "PM onayı için yetkiniz yok" });
    }
    const row = await pool.query("SELECT * FROM is_avans_talep WHERE id=$1", [id]);
    if (!row.rows[0]) return res.status(404).json({ error: "Kayıt bulunamadı" });
    const talep = row.rows[0];
    if (!["TALEP","ROLLOUT_MUDUR_ONAY"].includes(talep.durum)) {
      return res.status(400).json({ error: "Bu durumda PM onayı yapılamaz" });
    }
    const firmaSecim = normalizeAvansFirma(req.body?.firma);
    const today = new Date().toISOString().split("T")[0];
    const updated = await pool.query(
      "UPDATE is_avans_talep SET durum='PM_ONAY', rollout_mudur_onay_tarihi=COALESCE(rollout_mudur_onay_tarihi,$1), pm_onay_tarihi=$1, firma=COALESCE($3, firma) WHERE id=$2 RETURNING *",
      [today, id, firmaSecim]
    );
    res.json(updated.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Direktör — yalnızca PM_ONAY aşamasındaki talebi DIREKTOR_ONAY'a taşır
app.put("/hr/is-avans/:id/direktor-onayla", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!avansYetkili(req, "PD")) {
      return res.status(403).json({ error: "Direktör onayı için yetkiniz yok" });
    }
    const row = await pool.query("SELECT * FROM is_avans_talep WHERE id=$1", [id]);
    if (!row.rows[0]) return res.status(404).json({ error: "Kayıt bulunamadı" });
    const talep = row.rows[0];
    if (talep.durum !== "PM_ONAY") {
      return res.status(400).json({ error: "Bu durumda direktör onayı yapılamaz" });
    }
    const firmaSecim = normalizeAvansFirma(req.body?.firma);
    const today = new Date().toISOString().split("T")[0];
    const updated = await pool.query(
      "UPDATE is_avans_talep SET durum='DIREKTOR_ONAY', pm_onay_tarihi=$1, direktor_onay_tarihi=$1, firma=COALESCE($3, firma) WHERE id=$2 RETURNING *",
      [today, id, firmaSecim]
    );
    res.json(updated.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/hr/is-avans/:id/duzenle", async (req, res) => {
  try {
    const { id } = req.params;
    const { tutar } = req.body;
    if (!tutar || isNaN(Number(tutar))) return res.status(400).json({ error: "Geçerli tutar giriniz" });
    const row = await pool.query("SELECT * FROM is_avans_talep WHERE id=$1", [id]);
    if (!row.rows[0]) return res.status(404).json({ error: "Kayıt bulunamadı" });
    const updated = await pool.query(
      "UPDATE is_avans_talep SET tutar=$1 WHERE id=$2 RETURNING *",
      [Number(tutar), id]
    );
    res.json(updated.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/hr/is-avans/:id/reddet", async (req, res) => {
  try {
    const { id } = req.params;
    const { red_aciklama, reddeden_email } = req.body;
    const r = await pool.query(
      "UPDATE is_avans_talep SET durum='REDDEDILDI', red_aciklama=$1, reddeden_email=$2 WHERE id=$3 RETURNING *",
      [red_aciklama, reddeden_email, id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/hr/is-avans/excel", async (req, res) => {
  try {
    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook();
    wb.creator = "ERC Sistem";

    const ws = wb.addWorksheet("İş Avansı Talepleri");

    const { email, durum, gider_turu, bolge, proje, baslangic, bitis, firma } = req.query;
    const conditions = [];
    const params = [];
    if (email) { conditions.push(`t.talep_eden_email = $${params.length+1}`); params.push(email); }
    if (firma) { conditions.push(`UPPER(COALESCE(t.firma,'')) = $${params.length+1}`); params.push(String(firma).toUpperCase()); }
    if (durum) { conditions.push(`t.durum = $${params.length+1}`); params.push(durum); }
    if (gider_turu) { conditions.push(`t.gider_turu = $${params.length+1}`); params.push(gider_turu); }
    if (bolge) { conditions.push(`t.bolge = $${params.length+1}`); params.push(bolge); }
    if (proje) { conditions.push(`t.proje = $${params.length+1}`); params.push(proje); }
    if (baslangic) { conditions.push(`t.tarih >= $${params.length+1}`); params.push(baslangic); }
    if (bitis) { conditions.push(`t.tarih <= $${params.length+1}`); params.push(bitis); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const list = await pool.query(`
      SELECT t.*, p.ad_soyad as personel_ad
      FROM is_avans_talep t
      LEFT JOIN personel p ON t.personel_id = p.id
      ${where}
      ORDER BY t.tarih DESC, t.created_at DESC
    `, params);

    // Title row
    ws.mergeCells("A1:O1");
    const titleCell = ws.getCell("A1");
    titleCell.value = "İŞ AVANSI TALEP RAPORU";
    titleCell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" }, name: "Arial" };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(1).height = 28;

    // Header row
    const colDefs = [
      { header: "Kayıt No",         key: "id",         width: 10 },
      { header: "Tarih",            key: "tarih",       width: 13 },
      { header: "Talep Eden",       key: "talep_eden",  width: 20 },
      { header: "Personel",         key: "personel",    width: 20 },
      { header: "Gider Türü",       key: "gider",       width: 16 },
      { header: "Bölge",            key: "bolge",       width: 13 },
      { header: "Proje",            key: "proje",       width: 18 },
      { header: "Firma",            key: "firma",       width: 11 },
      { header: "Plaka",            key: "plaka",       width: 12 },
      { header: "Tutar (₺)",        key: "tutar",       width: 13 },
      { header: "Açıklama",         key: "aciklama",    width: 28 },
      { header: "Not",              key: "not",         width: 22 },
      { header: "Durum",            key: "durum",       width: 18 },
      { header: "Onay Tarihi",      key: "onay",        width: 14 },
      { header: "Ödeme Tarihi",     key: "odeme",       width: 14 },
    ];

    const headerRow = ws.getRow(2);
    colDefs.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = col.header;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = { bottom: { style: "thin", color: { argb: "FF1D4ED8" } } };
      ws.getColumn(i + 1).width = col.width;
    });
    headerRow.height = 22;

    const durumLabels = {
      TALEP: "Talep Edildi",
      ROLLOUT_MUDUR_ONAY: "Rollout Müdür Onayında",
      PM_ONAY: "PM Onayında",
      DIREKTOR_ONAY: "Direktör Onayında",
      TAMAMLANDI: "Tamamlandı ✓",
      REDDEDILDI: "Reddedildi ✗"
    };

    const fmtDate = v => v ? (v.toISOString?.().split("T")[0] || String(v).split("T")[0]) : "";

    list.rows.forEach((t, idx) => {
      const rowNum = idx + 3;
      const row = ws.getRow(rowNum);
      const isEven = idx % 2 === 0;

      const values = [
        t.id,
        fmtDate(t.tarih),
        t.talep_eden_ad || "",
        t.personel_ad || "",
        t.gider_turu || "",
        t.bolge || "",
        t.proje || "",
        t.firma === "AHY" ? "AHY" : t.firma ? "ŞİMŞEK" : "",
        t.plaka || "",
        Number(t.tutar),
        t.aciklama || "",
        t.not_aciklama || "",
        durumLabels[t.durum] || t.durum,
        fmtDate(t.direktor_onay_tarihi || t.pm_onay_tarihi),
        fmtDate(t.odeme_tarihi),
      ];

      values.forEach((val, ci) => {
        const cell = row.getCell(ci + 1);
        cell.value = val;
        cell.font = { name: "Arial", size: 10 };
        cell.alignment = { vertical: "middle", wrapText: ci === 10 || ci === 11 };

        // Row background
        let bg = isEven ? "FFFFFFFF" : "FFF0F4FF";
        if (t.durum === "TAMAMLANDI") bg = isEven ? "FFD1FAE5" : "FFBCF0DA";
        else if (t.durum === "REDDEDILDI") bg = isEven ? "FFFEE2E2" : "FFFECACA";
        else if (t.durum === "PM_ONAY" || t.durum === "DIREKTOR_ONAY") bg = isEven ? "FFFEF3C7" : "FFFDE68A";

        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        cell.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } };

        if (ci === 9) { // Tutar column
          cell.numFmt = '#,##0.00 ₺';
          cell.alignment = { horizontal: "right", vertical: "middle" };
          cell.font = { name: "Arial", size: 10, bold: true };
        }
        if (ci === 7 && val === "AHY") { // Firma: AHY vurgusu
          cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF92400E" } };
          cell.alignment = { horizontal: "center", vertical: "middle" };
        }
        if (ci === 7 && val === "ŞİMŞEK") cell.alignment = { horizontal: "center", vertical: "middle" };
        if (ci === 8) cell.alignment = { horizontal: "center", vertical: "middle" };  // Plaka
        if (ci === 12) cell.alignment = { horizontal: "center", vertical: "middle" }; // Durum
        if (ci === 0) cell.alignment = { horizontal: "center", vertical: "middle" };  // ID
      });

      row.height = 18;
    });

    // Totals row
    const totRow = ws.getRow(list.rows.length + 3);
    totRow.getCell(9).value = "TOPLAM:";
    totRow.getCell(9).font = { bold: true, name: "Arial" };
    totRow.getCell(9).alignment = { horizontal: "right" };
    totRow.getCell(10).value = { formula: `SUM(J3:J${list.rows.length + 2})` };
    totRow.getCell(10).numFmt = '#,##0.00 ₺';
    totRow.getCell(10).font = { bold: true, name: "Arial", color: { argb: "FF166534" } };
    totRow.getCell(10).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
    totRow.height = 20;

    // Freeze panes: freeze title + header
    ws.views = [{ state: "frozen", xSplit: 0, ySplit: 2, topLeftCell: "A3" }];

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=is_avans_talepleri.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── MASRAF FORMU ────────────────────────────────────────────────────────────

const masrafUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ok = /\.(jpg|jpeg|png|gif|webp|heic|pdf)$/i.test(file.originalname);
    cb(null, ok);
  }
});

// GET all forms (with totals)
app.get("/hr/masraf-form", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT mf.*, p.ad_soyad as personel_ad,
        COALESCE(SUM(mk.tutar),0) as genel_toplam
      FROM masraf_form mf
      LEFT JOIN personel p ON p.id = mf.personel_id
      LEFT JOIN masraf_kalem mk ON mk.form_id = mf.id
      GROUP BY mf.id, p.ad_soyad
      ORDER BY mf.created_at DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET masraf forms filtered by email (mobile app)
// ── Mobil Dashboard: email ile tek seferde tüm kişisel veriler ──────────────
app.get("/hr/mobile-dashboard", async (req, res) => {
  try {
    const { email, name } = req.query;
    if (!email) return res.status(400).json({ error: "email gerekli" });

    const now = new Date();
    const ay  = now.getMonth() + 1;
    const yil = now.getFullYear();

    // Türkçe karakter normalizasyonu (ı→i, İ→i, ğ→g, ü→u, ş→s, ö→o, ç→c)
    const normTr = s => (s||'').toLowerCase()
      .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ğ/g,'g')
      .replace(/ü/g,'u').replace(/ş/g,'s').replace(/ö/g,'o').replace(/ç/g,'c');

    // 1. Personel bilgisi — önce email, sonra ad_soyad ile fallback
    let personelRes = await pool.query(
      "SELECT id, ad_soyad, unvan, bolge, email FROM personel WHERE LOWER(TRIM(email))=LOWER(TRIM($1)) AND aktif=true LIMIT 1",
      [email]
    );
    if (!personelRes.rows[0] && name) {
      // Türkçe normalize edilerek ad_soyad ile dene (ı/i, İ/i farkını aşar)
      const normName = normTr(name.trim());
      personelRes = await pool.query(
        `SELECT id, ad_soyad, unvan, bolge, email FROM personel
         WHERE aktif=true
           AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
             TRIM(ad_soyad),'İ','I'),'Ş','S'),'Ğ','G'),'Ü','U'),'Ö','O'),'Ç','C'))
             = REPLACE($1,'ı','i')
         LIMIT 1`,
        [normName]
      );
    }
    const personel = personelRes.rows[0] || null;
    const personelId = personel?.id || null;
    // Avans/masraf sorgularında gerçek email'i kullan (personel tablosundaki),
    // yoksa gönderilen email ile dene
    const queryEmail = personel?.email || email;

    // 2. Bu ay puantaj özeti
    let puantaj = { calisilan: 0, dinlenme: 0, gelmedi: 0, toplam_gun: 0, fazla_mesai_gun: 0 };
    if (personelId) {
      const pRes = await pool.query(
        `SELECT durum, COUNT(*)::int as sayi FROM puantaj
         WHERE personel_id=$1 AND EXTRACT(MONTH FROM tarih)=$2 AND EXTRACT(YEAR FROM tarih)=$3
         GROUP BY durum`,
        [personelId, ay, yil]
      );
      pRes.rows.forEach(r => {
        if (r.durum === 'CALISDI')   puantaj.calisilan  = r.sayi;
        if (r.durum === 'DINLENME')  puantaj.dinlenme   = r.sayi;
        if (r.durum === 'GELMEDI')   puantaj.gelmedi    = r.sayi;
      });
      puantaj.toplam_gun = puantaj.calisilan + puantaj.dinlenme + puantaj.gelmedi;
      // Hafta sonu (Cumartesi=6, Pazar=0) veya resmi tatilde CALISDI kayıtları = fazla mesai günleri
      // DOW: 0=Pazar, 6=Cumartesi — hafta sonu CALISDI kayıtları = fazla mesai
      const fmRes = await pool.query(
        `SELECT COUNT(*)::int as sayi FROM puantaj
         WHERE personel_id=$1
           AND EXTRACT(MONTH FROM tarih)=$2
           AND EXTRACT(YEAR FROM tarih)=$3
           AND durum = 'CALISDI'
           AND EXTRACT(DOW FROM tarih) IN (0, 6)`,
        [personelId, ay, yil]
      );
      // Ayrıca resmi tatil olarak işaretlenmiş çalışılan günler (RESMI_TATIL durumunda CALISDI olarak girilmiş)
      // Bunu DINLENME sayısıyla da destekliyoruz (her DINLENME = 1 fazla mesai günü karşılığı)
      const fazlaHaftaSonu = Number(fmRes.rows[0]?.sayi || 0);
      puantaj.fazla_mesai_gun = fazlaHaftaSonu + puantaj.dinlenme;
    }

    // 3. İş avansları (son 5) — kendi açtıkları + personel olarak adına açılanlar
    const avansRes = await pool.query(
      `SELECT t.id, t.tutar, t.aciklama, t.gider_turu, t.bolge, t.proje, t.durum, t.tarih, t.created_at,
              t.talep_eden_ad, p.ad_soyad as personel_ad
       FROM is_avans_talep t
       LEFT JOIN personel p ON p.id = t.personel_id
       WHERE LOWER(t.talep_eden_email)=LOWER($1)
          OR (t.personel_id IS NOT NULL AND t.personel_id = $2)
       ORDER BY t.created_at DESC LIMIT 5`,
      [queryEmail, personelId]
    );
    const avanslar = avansRes.rows;
    const bekleyenAvans = avanslar.filter(a => !['TAMAMLANDI','REDDEDILDI'].includes(a.durum)).length;

    // 4. Masraf formları (son 5)
    const masrafRes = await pool.query(
      `SELECT mf.id, mf.durum, mf.created_at, mf.donem, mf.form_no,
        COALESCE(SUM(mk.tutar),0) as toplam_tutar,
        COUNT(mk.id)::int as kalem_sayisi
       FROM masraf_form mf
       LEFT JOIN masraf_kalem mk ON mk.form_id = mf.id
       WHERE LOWER(mf.talep_eden_email)=LOWER($1)
       GROUP BY mf.id ORDER BY mf.created_at DESC LIMIT 5`,
      [queryEmail]
    );
    const masraflar = masrafRes.rows;
    const bekleyenMasraf = masraflar.filter(f => !['TAMAMLANDI','ODENDI','REDDEDILDI'].includes(f.durum)).length;

    // 5. Ödenmemiş trafik cezaları
    let cezalar = [];
    let toplamCeza = 0;
    if (personelId) {
      const cezaRes = await pool.query(
        `SELECT id, tutar, aciklama, tarih FROM avans
         WHERE personel_id=$1 AND avans_turu='TRAFIK_CEZA' AND odendi=false ORDER BY tarih DESC`,
        [personelId]
      );
      cezalar = cezaRes.rows;
      toplamCeza = cezalar.reduce((s, c) => s + Number(c.tutar || 0), 0);
    }

    // 5b. Masraf formundaki TRAFIK_CEZA kalemleri:
    //     - Bu kişinin oluşturduğu formlardan VEYA
    //     - ceza_personel_id ile bu kişiye atanmış olanlar
    const cezaKalemRes = await pool.query(
      `SELECT mk.id, mk.tutar, mk.aciklama, mk.tarih, mk.plaka, mk.ceza_belge_url, mk.odeme_belge_url,
              mf.id as form_id, mf.durum as form_durum
       FROM masraf_kalem mk
       JOIN masraf_form mf ON mf.id = mk.form_id
       WHERE mk.kategori='TRAFIK_CEZA'
         AND COALESCE(mk.maastan_kesildi, false) = false
         AND (LOWER(mf.talep_eden_email)=LOWER($1) OR ($2::int IS NOT NULL AND mk.ceza_personel_id=$2::int))
       ORDER BY mk.tarih DESC LIMIT 20`,
      [queryEmail, personelId]
    );
    const cezaKalemler = cezaKalemRes.rows;

    // 6. İş avansı bakiye — avans tablosundan (web ile aynı hesaplama)
    let avansToplamOnaylanan = 0;
    if (personelId) {
      const bakiyeAvansRes = await pool.query(
        `SELECT COALESCE(SUM(tutar),0) as toplam FROM avans
         WHERE personel_id=$1 AND avans_turu='IS'`,
        [personelId]
      );
      avansToplamOnaylanan = Number(bakiyeAvansRes.rows[0].toplam);
    }
    const bakiyeMasrafRes = await pool.query(
      `SELECT COALESCE(SUM(mk.tutar),0) as toplam FROM masraf_kalem mk
       JOIN masraf_form mf ON mf.id = mk.form_id
       WHERE LOWER(mf.talep_eden_email)=LOWER($1) AND mf.durum='ARSIVLENDI'`,
      [queryEmail]
    );
    const masrafToplamArsiv    = Number(bakiyeMasrafRes.rows[0].toplam);
    const avansKalan           = avansToplamOnaylanan - masrafToplamArsiv;

    // 7. Bekleyen masraf toplam tutarı (sadece onaya gönderilmiş formlar — TASLAK hariç)
    const ONAY_DURUMLAR = ['PM_BEKLE','DIREKTOR_BEKLE'];
    const bekleyenMasrafTutar = masraflar
      .filter(f => ONAY_DURUMLAR.includes(f.durum))
      .reduce((s, f) => s + Number(f.toplam_tutar || 0), 0);

    // 8. Taslak masraf toplam tutarı (ayrıca gönder)
    const taslakMasrafTutar = masraflar
      .filter(f => f.durum === 'TASLAK')
      .reduce((s, f) => s + Number(f.toplam_tutar || 0), 0);
    const taslakMasrafCount = masraflar.filter(f => f.durum === 'TASLAK').length;

    // Bekleyen sayısını da sadece onaya gönderilmişlerle sınırla
    const bekleyenMasrafCount = masraflar.filter(f => ONAY_DURUMLAR.includes(f.durum)).length;

    // 9. Kullanıcının rolüne göre onay bekleyen iş avansları
    //    PM  → durum='TALEP' olanlar
    //    Direktör → TALEP + ROLLOUT_MUDUR_ONAY + PM_ONAY olanlar (direktor-onayla hepsini kabul eder)
    //    PM      → TALEP + ROLLOUT_MUDUR_ONAY olanlar (pm-onayla hepsini kabul eder)
    const PM_EMAIL_CONST       = 'orhan.bedir@simsektel.com';
    const DIREKTOR_EMAIL_CONST = 'duzgun.simsek@simsektel.com';
    const userEmailLower = (queryEmail || '').toLowerCase().trim();
    const isPM       = userEmailLower === PM_EMAIL_CONST.toLowerCase();
    const isDirektor = userEmailLower === DIREKTOR_EMAIL_CONST.toLowerCase();

    let onayBekleyenAvanslar = [];
    if (isPM || isDirektor) {
      const bekleyenDurumlar = isDirektor
        ? ['TALEP', 'ROLLOUT_MUDUR_ONAY', 'PM_ONAY']
        : ['TALEP', 'ROLLOUT_MUDUR_ONAY'];
      const onayRes = await pool.query(
        `SELECT id, tutar, aciklama, gider_turu, bolge, proje, durum, tarih, created_at,
                talep_eden_ad, talep_eden_email
         FROM is_avans_talep
         WHERE durum = ANY($1)
         ORDER BY created_at ASC
         LIMIT 20`,
        [bekleyenDurumlar]
      );
      onayBekleyenAvanslar = onayRes.rows;
    }

    // 10. PM için onay bekleyen malzeme talepleri (durum='PM_ONAY')
    let onayBekleyenMalzemeler = [];
    if (isPM) {
      const malzRes = await pool.query(
        `SELECT t.id, t.talep_no, t.talep_eden_ad, t.talep_eden_email,
                t.durum, t.bolge, t.proje, t.site_id, t.notlar, t.created_at,
                COALESCE((SELECT COUNT(*) FROM malzeme_talep_kalemleri k WHERE k.talep_id=t.id),0)::int AS kalem_sayisi
         FROM malzeme_talepler t
         WHERE t.durum = 'PM_ONAY'
         ORDER BY t.created_at ASC
         LIMIT 20`
      );
      onayBekleyenMalzemeler = malzRes.rows;
    }

    res.json({
      personel, personelBulundu: !!personelId, ay, yil,
      puantaj,
      avanslar, bekleyenAvans,
      masraflar, bekleyenMasraf: bekleyenMasrafCount, bekleyenMasrafTutar,
      taslakMasrafTutar, taslakMasrafCount,
      cezalar, toplamCeza, cezaKalemler,
      avansKalan, avansToplamOnaylanan,
      onayBekleyenAvanslar, isPM, isDirektor,
      onayBekleyenMalzemeler,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/hr/masraf-formlari", async (req, res) => {
  try {
    const { email } = req.query;
    const whereClause = email ? `WHERE mf.talep_eden_email = $1` : '';
    const params = email ? [email] : [];
    const { rows } = await pool.query(`
      SELECT mf.id, mf.durum, mf.created_at, mf.donem, mf.form_no,
        mf.talep_eden_email, mf.talep_eden_ad,
        COALESCE(SUM(mk.tutar),0) as toplam_tutar,
        COUNT(mk.id)::int as kalem_sayisi
      FROM masraf_form mf
      LEFT JOIN masraf_kalem mk ON mk.form_id = mf.id
      ${whereClause}
      GROUP BY mf.id
      ORDER BY mf.created_at DESC
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET personel masraf bakiye — MUST be before /:id to avoid "bakiye" being matched as an id
app.get("/hr/masraf-form/bakiye/:personelId", async (req, res) => {
  try {
    const pid = req.params.personelId;
    const avansRes = await pool.query(
      `SELECT COALESCE(SUM(tutar),0) as toplam FROM avans WHERE personel_id=$1 AND avans_turu='IS'`,
      [pid]
    );
    const masrafRes = await pool.query(
      `SELECT COALESCE(SUM(mk.tutar),0) as toplam FROM masraf_kalem mk
       JOIN masraf_form mf ON mf.id = mk.form_id
       WHERE mf.personel_id=$1 AND mf.durum='TAMAMLANDI'`,
      [pid]
    );
    const avans = Number(avansRes.rows[0].toplam);
    const masraf = Number(masrafRes.rows[0].toplam);
    res.json({ avans, masraf, bakiye: avans - masraf });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET single form with items and files
app.get("/hr/masraf-form/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const form = await pool.query(`
      SELECT mf.*, p.ad_soyad as personel_ad FROM masraf_form mf
      LEFT JOIN personel p ON p.id = mf.personel_id WHERE mf.id=$1`, [id]);
    if (!form.rows[0]) return res.status(404).json({ error: "Bulunamadı" });
    const kalemler = await pool.query(`
      SELECT mk.*, COALESCE(json_agg(mb.*) FILTER (WHERE mb.id IS NOT NULL), '[]') as belgeler
      FROM masraf_kalem mk
      LEFT JOIN masraf_belge mb ON mb.kalem_id = mk.id
      WHERE mk.form_id=$1 GROUP BY mk.id ORDER BY mk.tarih, mk.id`, [id]);
    res.json({ ...form.rows[0], kalemler: kalemler.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST create form (veya mevcut TASLAK'ı döndür)
app.post("/hr/masraf-form", async (req, res) => {
  try {
    const {
      personel_id, talep_eden_email,
      talep_eden_ad, talep_eden,   // mobil "talep_eden" alias
      donem,
      durum,                        // mobil başlangıç durumu
      kalemler,                     // mobil all-in-one kalem dizisi
    } = req.body;

    const adSoyad = talep_eden_ad || talep_eden || null;
    const now = new Date();
    const formDonem = donem || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    const formDurum = durum || "TASLAK";

    // Mevcut TASLAK formu varsa onu döndür (yeni oluşturma)
    if (talep_eden_email && formDurum === "TASLAK") {
      const existingDraft = await pool.query(
        `SELECT mf.* FROM masraf_form mf
         WHERE LOWER(mf.talep_eden_email) = LOWER($1) AND mf.durum = 'TASLAK'
         ORDER BY mf.created_at DESC LIMIT 1`,
        [talep_eden_email]
      );
      if (existingDraft.rows.length > 0) {
        const draft = existingDraft.rows[0];
        const kalemlerRes = await pool.query(
          `SELECT mk.*, COALESCE(json_agg(mb.*) FILTER (WHERE mb.id IS NOT NULL), '[]') as belgeler
           FROM masraf_kalem mk
           LEFT JOIN masraf_belge mb ON mb.kalem_id = mk.id
           WHERE mk.form_id=$1 GROUP BY mk.id ORDER BY mk.tarih, mk.id`,
          [draft.id]
        );
        return res.json({ ...draft, kalemler: kalemlerRes.rows });
      }
    }

    const noRes = await pool.query(`SELECT COALESCE(MAX(form_no), 0) + 1 AS next_no FROM masraf_form`);
    const nextNo = noRes.rows[0].next_no;
    const { rows } = await pool.query(
      `INSERT INTO masraf_form (personel_id,talep_eden_email,talep_eden_ad,donem,form_no,durum)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [personel_id||null, talep_eden_email, adSoyad, formDonem, nextNo, formDurum]
    );
    const form = rows[0];

    // Mobil all-in-one: kalemler dizisi varsa hepsini kaydet
    if (Array.isArray(kalemler) && kalemler.length > 0) {
      const KAT_NORM = {
        "Yemek":"YEMEK","yemek":"YEMEK","Yakıt":"YAKIT","yakıt":"YAKIT","Yakit":"YAKIT",
        "Konaklama":"KONAKLAMA","konaklama":"KONAKLAMA",
        "Yol & Ulaşım":"ULASIM","Ulaşım":"ULASIM","Yol":"ULASIM",
        "Malzeme":"MALZEME","malzeme":"MALZEME","Köprü":"KOPRU",
        "Trafik Cezaşı":"TRAFIK_CEZA","trafik cezaşı":"TRAFIK_CEZA",
        "Diğer":"DIGER","diğer":"DIGER","Diger":"DIGER",
      };
      for (const k of kalemler) {
        const katNorm = KAT_NORM[k.kategori] || k.kategori || "DIGER";
        await pool.query(
          `INSERT INTO masraf_kalem (form_id,kategori,tarih,aciklama,tutar,fis_var)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [form.id, katNorm, k.tarih||now.toISOString().split("T")[0],
           k.aciklama||"", Number(k.tutar)||0, k.fis_var!==false]
        );
      }
    }

    res.json(form);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE form
app.delete("/hr/masraf-form/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM masraf_form WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST add kalem
app.post("/hr/masraf-kalem", async (req, res) => {
  try {
    const { form_id, tarih, belge_no, belge_aciklama, aciklama, tutar, fis_var, fis_olmadan_aciklama, plaka, ceza_personel_id } = req.body;
    // Mobil Türkçe kategori adlarını büyük harfe normalize et
    const KAT_NORMALIZE = {
      "Yemek":"YEMEK","yemek":"YEMEK","Yakıt":"YAKIT","yakıt":"YAKIT","Yakit":"YAKIT",
      "Konaklama":"KONAKLAMA","konaklama":"KONAKLAMA",
      "Yol & Ulaşım":"ULASIM","Ulaşım":"ULASIM","Yol":"ULASIM","ulasim":"ULASIM",
      "Malzeme":"MALZEME","malzeme":"MALZEME","Köprü":"KOPRU","Köprü/Otoyol":"KOPRU",
      "Trafik Cezası":"TRAFIK_CEZA","trafik cezası":"TRAFIK_CEZA","Trafik Cezasi":"TRAFIK_CEZA",
      "Diğer":"DIGER","diğer":"DIGER","Diger":"DIGER",
    };
    const kategori = KAT_NORMALIZE[req.body.kategori] || req.body.kategori;
    const { rows } = await pool.query(
      `INSERT INTO masraf_kalem (form_id,kategori,tarih,belge_no,belge_aciklama,aciklama,tutar,fis_var,fis_olmadan_aciklama,plaka,ceza_personel_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [form_id, kategori, tarih, belge_no||null, belge_aciklama||null, aciklama||null, tutar, fis_var!==false, fis_olmadan_aciklama||null, plaka||null, ceza_personel_id||null]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT update kalem (fis_var, tutar_uyari_aciklama etc)
app.put("/hr/masraf-kalem/:id", async (req, res) => {
  try {
    const { fis_var, fis_olmadan_aciklama, tutar_uyari_aciklama, tutar } = req.body;
    // tutar gönderildiyse düzelt (yanlış/eksik girilen bedeli elle düzeltme)
    const tutarVal = (tutar === undefined || tutar === null || tutar === "")
      ? null
      : parseFinanceNumber(tutar);
    const { rows } = await pool.query(
      `UPDATE masraf_kalem
       SET fis_var = COALESCE($1, fis_var),
           fis_olmadan_aciklama = COALESCE($2, fis_olmadan_aciklama),
           tutar_uyari_aciklama = COALESCE($3, tutar_uyari_aciklama),
           tutar = COALESCE($5, tutar)
       WHERE id=$4 RETURNING *`,
      [fis_var ?? null, fis_olmadan_aciklama||null, tutar_uyari_aciklama||null, req.params.id, tutarVal]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT ceza_personel_id güncelle (Trafik Ceza kalemi için)
// ceza_personel_id = personel id    → o personele yaz, avans kaydı oluştur
// ceza_personel_id = "sirket"       → şirket gideri, ceza_sirket=true, avans yok
// ceza_personel_id = "" / null      → atanmadı
app.put("/hr/masraf-kalem/:id/ceza-personel", async (req, res) => {
  try {
    const { ceza_personel_id } = req.body;
    const kalemId = req.params.id;
    const isSirket = ceza_personel_id === "sirket";

    // ceza_sirket kolonu henüz migration'dan eklenmemiş olabilir — güvenli güncelle
    let kalem;
    try {
      const { rows } = await pool.query(
        "UPDATE masraf_kalem SET ceza_personel_id=$1, ceza_sirket=$2 WHERE id=$3 RETURNING *",
        [isSirket ? null : (ceza_personel_id || null), isSirket, kalemId]
      );
      kalem = rows[0];
    } catch {
      // ceza_sirket kolonu yoksa sadece personel_id güncelle
      const { rows } = await pool.query(
        "UPDATE masraf_kalem SET ceza_personel_id=$1 WHERE id=$2 RETURNING *",
        [isSirket ? null : (ceza_personel_id || null), kalemId]
      );
      kalem = rows[0];
    }
    // Not: avans tablosu artık trafik ceza için kullanılmıyor,
    // GET /hr/trafik-ceza masraf_kalem'den direkt okuyor.

    res.json(kalem);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE kalem
app.delete("/hr/masraf-kalem/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM masraf_kalem WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST upload belge for kalem
app.post("/hr/masraf-belge/:kalemId", masrafUpload.single("dosya"), async (req, res) => {
  try {
    const { kalemId } = req.params;
    if (!req.file) return res.status(400).json({ error: "Dosya yok" });
    const kalem = await pool.query("SELECT form_id, kategori, aciklama FROM masraf_kalem WHERE id=$1", [kalemId]);
    if (!kalem.rows[0]) return res.status(404).json({ error: "Kalem bulunamadı" });
    const { form_id, kategori, aciklama: kalemAciklama } = kalem.rows[0];

    // 1. Upload first — guaranteed regardless of OCR
    const fname = `${Date.now()}-${utf8Name(req.file.originalname)}`;
    const { url } = await uploadToStorage("masraf-belgeler", fname, req.file.buffer, req.file.mimetype);
    const { rows } = await pool.query(
      `INSERT INTO masraf_belge (kalem_id, form_id, dosya_adi, dosya_yolu)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [kalemId, form_id, utf8Name(req.file.originalname), url]
    );
    const belgeId = rows[0].id;

    // 2. OCR with strict timeout — runs after upload is saved
    const fileBuffer = req.file.buffer;
    const ocrTimeout = new Promise(resolve => setTimeout(() => resolve(null), 8000));
    const ocrResult = await Promise.race([ocrFis(fileBuffer), ocrTimeout]);

    let ocrTutar = null, matchedPlaka = null, ocrPlakaEslesti = null;
    if (ocrResult) {
      ocrTutar = ocrResult.amount;
      let ocrPlaka = ocrResult.plaka;
      const rawPlates = ocrResult.rawPlates || [];
      if (kategori === "YAKIT" && (ocrPlaka || rawPlates.length)) {
        const enteredPlaka = (kalemAciklama || "").replace(/^Site ID:\s*[^|]+\|\s*/i, "").trim();
        const candidates = rawPlates.length ? rawPlates : [ocrPlaka];
        if (enteredPlaka) {
          for (const cand of candidates) {
            const found = plakaEsles(cand, [enteredPlaka]);
            if (found) { matchedPlaka = found; ocrPlakaEslesti = true; break; }
          }
          if (ocrPlakaEslesti === null) { matchedPlaka = ocrPlaka; ocrPlakaEslesti = false; }
        } else {
          // No entered plate — skip plate check
          matchedPlaka = ocrPlaka;
          ocrPlakaEslesti = null;
        }
      }
    }

    // 3. Update with OCR results (even if null)
    const updated = await pool.query(
      `UPDATE masraf_belge SET ocr_tutar=$1, ocr_plaka=$2, ocr_plaka_eslesti=$3 WHERE id=$4 RETURNING *`,
      [ocrTutar, matchedPlaka, ocrPlakaEslesti, belgeId]
    );
    res.json(updated.rows[0]);
  } catch (e) {
    console.error("MASRAF BELGE UPLOAD ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE belge
app.delete("/hr/masraf-belge/:id", async (req, res) => {
  try {
    const b = await pool.query("SELECT dosya_yolu FROM masraf_belge WHERE id=$1", [req.params.id]);
    if (b.rows[0]) await deleteFromStorage(b.rows[0].dosya_yolu);
    await pool.query("DELETE FROM masraf_belge WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /hr/masraf-kalem/:id/ceza-belge — ceza belgesi upload
app.post("/hr/masraf-kalem/:id/ceza-belge", authMiddleware, masrafUpload.single("file"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: "Dosya gerekli" });
    const fname = `${Date.now()}-${utf8Name(req.file.originalname)}`;
    const { url } = await uploadToStorage("masraf-belgeler", fname, req.file.buffer, req.file.mimetype);
    await pool.query("UPDATE masraf_kalem SET ceza_belge_url=$1 WHERE id=$2", [url, id]);
    res.json({ ok: true, url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /hr/masraf-kalem/:id/odeme-belge — ödeme belgesi upload
app.post("/hr/masraf-kalem/:id/odeme-belge", authMiddleware, masrafUpload.single("file"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: "Dosya gerekli" });
    const fname = `${Date.now()}-${utf8Name(req.file.originalname)}`;
    const { url } = await uploadToStorage("masraf-belgeler", fname, req.file.buffer, req.file.mimetype);
    await pool.query("UPDATE masraf_kalem SET odeme_belge_url=$1 WHERE id=$2", [url, id]);
    res.json({ ok: true, url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /hr/trafik-ceza — kişiye ait tüm trafik ceza kalemleri (masraf_kalem tablosundan, tüm durumlar)
app.get("/hr/trafik-ceza", async (req, res) => {
  try {
    const { personel_id } = req.query;
    if (!personel_id) return res.status(400).json({ error: "personel_id gerekli" });

    // masraf_kalem tablosundan direkt oku — avans tablosuna bağımlılık yok
    // REDDEDILDI formlar hariç hepsi göster
    // donem (YYYY-MM) verilirse: kesilmemiş cezalar HER ay görünür; kesilen ceza
    // SADECE kesildiği donem'de görünür (o ay düşüş uygulandı), sonraki aylarda görünmez.
    // includeKesildi=1 ise tüm kesilenler gelir (geçmiş görünümü).
    const includeKesildi = String(req.query.includeKesildi || "") === "1";
    const donem = (req.query.donem || "").toString().trim() || null;
    let kesildiFilter = "";
    const params = [personel_id];
    if (includeKesildi) {
      kesildiFilter = "";
    } else if (donem) {
      params.push(donem);
      kesildiFilter =
        "AND (COALESCE(mk.maastan_kesildi, false) = false OR mk.kesildi_donem = $2)";
    } else {
      kesildiFilter = "AND COALESCE(mk.maastan_kesildi, false) = false";
    }
    const r = await pool.query(
      `SELECT mk.id, mk.tutar, mk.aciklama, mk.tarih, mk.plaka,
              mf.id as masraf_form_id, mf.durum as form_durum,
              COALESCE(mk.maastan_kesildi, false) AS maastan_kesildi,
              mk.kesildi_tarihi, mk.kesildi_donem,
              CASE WHEN mf.durum IN ('TAMAMLANDI','ARSIVLENDI') THEN 'ONAYLANDI' ELSE 'BEKLEMEDE' END as kaynak
       FROM masraf_kalem mk
       JOIN masraf_form mf ON mf.id = mk.form_id
       WHERE mk.ceza_personel_id=$1
         AND mk.kategori='TRAFIK_CEZA'
         AND mf.durum NOT IN ('REDDEDILDI')
         ${kesildiFilter}
       ORDER BY mk.tarih DESC`,
      params
    );

    const list = r.rows;
    const toplam = list.reduce((s,x) => s + Number(x.tutar||0), 0);
    res.json({ list, toplam });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /hr/trafik-ceza/:id/kesildi — maaş ödemesinde kesildi olarak işaretle
// (bir daha sonraki aylarda görünmez). kesildi=false ile geri alınabilir.
app.put("/hr/trafik-ceza/:id/kesildi", async (req, res) => {
  try {
    const kesildi = req.body.kesildi !== false; // varsayılan true
    const donem = (req.body.donem || "").toString().trim() || null;
    const r = await pool.query(
      `UPDATE masraf_kalem
         SET maastan_kesildi=$1,
             kesildi_tarihi=CASE WHEN $1 THEN CURRENT_DATE ELSE NULL END,
             kesildi_donem=CASE WHEN $1 THEN $2 ELSE NULL END
       WHERE id=$3 AND kategori='TRAFIK_CEZA'
       RETURNING id, maastan_kesildi, kesildi_tarihi, kesildi_donem`,
      [kesildi, donem, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Ceza bulunamadı" });
    res.json({ ok: true, ...r.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Redirect masraf belge file requests (dosya_yolu is now a full Supabase URL)
app.get("/hr/masraf-belge/file/:filename", async (req, res) => {
  try {
    const b = await pool.query("SELECT dosya_yolu FROM masraf_belge WHERE dosya_adi=$1 ORDER BY id DESC LIMIT 1", [req.params.filename]);
    if (b.rows[0]?.dosya_yolu?.startsWith("http")) return res.redirect(b.rows[0].dosya_yolu);
    res.status(404).json({ error: "Dosya yok" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── ARAÇ FİLOSU ─────────────────────────────────────────────────────────────
const aracUpload = multer({ storage: multer.memoryStorage() });
const ofisUpload = multer({ storage: multer.memoryStorage() });

// ── YEMEK KARTLARI (Pluxee) ─────────────────────────────────────────────
// İK panelindeki kart listesi + dönem bazlı ödeme takibi. Ödemeler
// cashflow_odeme'ye (kategori TICKET, firma etiketiyle) otomatik yazılır —
// ERC Nakit Akışı, AHY Nakit Akışı ve Kâr/Zarar panelleri oradan beslenir.
async function ensureYemekKartiTables() {
  await pool.query(`CREATE TABLE IF NOT EXISTS yemek_kartlari (
    id SERIAL PRIMARY KEY,
    ad_soyad TEXT NOT NULL,
    kart_no TEXT,
    aylik_tutar NUMERIC DEFAULT 0,
    firma TEXT DEFAULT 'AHY',
    aktif BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS yemek_karti_odemeler (
    id SERIAL PRIMARY KEY,
    kart_id INTEGER REFERENCES yemek_kartlari(id) ON DELETE CASCADE,
    donem TEXT NOT NULL,
    tutar NUMERIC DEFAULT 0,
    tarih DATE DEFAULT CURRENT_DATE,
    firma TEXT DEFAULT 'AHY',
    cashflow_id INTEGER,
    aciklama TEXT,
    created_at TIMESTAMP DEFAULT now(),
    UNIQUE (kart_id, donem))`);
}

app.get("/hr/yemek-kartlari", async (req, res) => {
  try {
    await ensureYemekKartiTables();
    const [kartlar, odemeler] = await Promise.all([
      pool.query(`SELECT * FROM yemek_kartlari ORDER BY ad_soyad`),
      pool.query(`SELECT o.*, to_char(o.tarih,'YYYY-MM-DD') AS tarih_str FROM yemek_karti_odemeler o ORDER BY o.donem DESC, o.id`),
    ]);
    res.json({ ok: true, kartlar: kartlar.rows, odemeler: odemeler.rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post("/hr/yemek-kartlari", async (req, res) => {
  try {
    await ensureYemekKartiTables();
    const { ad_soyad, kart_no, aylik_tutar, firma } = req.body;
    if (!String(ad_soyad || "").trim()) return res.status(400).json({ ok: false, error: "Ad soyad zorunlu" });
    const r = await pool.query(
      `INSERT INTO yemek_kartlari (ad_soyad, kart_no, aylik_tutar, firma) VALUES ($1,$2,$3,$4) RETURNING *`,
      [String(ad_soyad).trim().toUpperCase(), kart_no || null, Number(aylik_tutar || 0),
       String(firma || "AHY").toUpperCase() === "SIMSEK" ? "SIMSEK" : "AHY"]);
    res.json({ ok: true, kart: r.rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.put("/hr/yemek-kartlari/:id", async (req, res) => {
  try {
    await ensureYemekKartiTables();
    const alanlar = [];
    const vals = [];
    const izinli = { ad_soyad: "text", kart_no: "text", aylik_tutar: "num", firma: "firma", aktif: "bool" };
    for (const [k, tip] of Object.entries(izinli)) {
      if (!(k in req.body)) continue;
      let v = req.body[k];
      if (tip === "num") v = Number(v || 0);
      if (tip === "bool") v = !!v;
      if (tip === "firma") v = String(v || "AHY").toUpperCase() === "SIMSEK" ? "SIMSEK" : "AHY";
      if (tip === "text") v = v === null ? null : String(v);
      vals.push(v); alanlar.push(`${k}=$${vals.length}`);
    }
    if (!alanlar.length) return res.status(400).json({ ok: false, error: "Güncellenecek alan yok" });
    vals.push(req.params.id);
    const r = await pool.query(`UPDATE yemek_kartlari SET ${alanlar.join(", ")} WHERE id=$${vals.length} RETURNING *`, vals);
    res.json({ ok: true, kart: r.rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete("/hr/yemek-kartlari/:id", async (req, res) => {
  try {
    await ensureYemekKartiTables();
    // Karta bağlı ödemelerin nakit akışı kayıtlarını da temizle
    const cfs = await pool.query(`SELECT cashflow_id FROM yemek_karti_odemeler WHERE kart_id=$1 AND cashflow_id IS NOT NULL`, [req.params.id]);
    for (const r of cfs.rows) await pool.query(`DELETE FROM cashflow_odeme WHERE id=$1`, [r.cashflow_id]).catch(() => {});
    await pool.query(`DELETE FROM yemek_kartlari WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Dönem ödemesi (upsert): nakit akışına TICKET kaydı açar/günceller
app.post("/hr/yemek-kartlari/:id/ode", async (req, res) => {
  try {
    await ensureYemekKartiTables();
    await ensureCashflowOdemeTable();
    const { donem, tutar, tarih, firma } = req.body;
    if (!donem || !Number(tutar || 0)) return res.status(400).json({ ok: false, error: "Dönem ve tutar zorunlu" });
    const kq = await pool.query(`SELECT * FROM yemek_kartlari WHERE id=$1`, [req.params.id]);
    if (!kq.rows[0]) return res.status(404).json({ ok: false, error: "Kart bulunamadı" });
    const kart = kq.rows[0];
    const f = String(firma || kart.firma || "AHY").toUpperCase() === "SIMSEK" ? "SIMSEK" : "AHY";
    const cfMarka = f === "AHY" ? "AHY" : "ERC"; // Şimşek ödemeleri ERC nakit akışında
    const t = tarih || new Date().toISOString().slice(0, 10);
    const acik = `${kart.ad_soyad} · yemek kartı`;
    const mevcut = await pool.query(`SELECT * FROM yemek_karti_odemeler WHERE kart_id=$1 AND donem=$2`, [req.params.id, donem]);
    let cashflowId = mevcut.rows[0]?.cashflow_id || null;
    if (cashflowId) {
      await pool.query(`UPDATE cashflow_odeme SET tarih=$1, tutar=$2, donem=$3, aciklama=$4, marka=$5 WHERE id=$6`,
        [t, Number(tutar), donem, acik, cfMarka, cashflowId]).catch(() => {});
    } else {
      const cf = await pool.query(
        `INSERT INTO cashflow_odeme (kategori, tarih, tutar, donem, aciklama, marka) VALUES ('TICKET',$1,$2,$3,$4,$5) RETURNING id`,
        [t, Number(tutar), donem, acik, cfMarka]);
      cashflowId = cf.rows[0].id;
    }
    const r = await pool.query(`
      INSERT INTO yemek_karti_odemeler (kart_id, donem, tutar, tarih, firma, cashflow_id)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (kart_id, donem) DO UPDATE SET tutar=$3, tarih=$4, firma=$5, cashflow_id=$6
      RETURNING *`, [req.params.id, donem, Number(tutar), t, f, cashflowId]);
    res.json({ ok: true, odeme: r.rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete("/hr/yemek-kartlari/:id/ode/:donem", async (req, res) => {
  try {
    await ensureYemekKartiTables();
    const r = await pool.query(`DELETE FROM yemek_karti_odemeler WHERE kart_id=$1 AND donem=$2 RETURNING cashflow_id`,
      [req.params.id, req.params.donem]);
    if (r.rows[0]?.cashflow_id)
      await pool.query(`DELETE FROM cashflow_odeme WHERE id=$1`, [r.rows[0].cashflow_id]).catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get("/hr/araclar", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT a.*, json_agg(b ORDER BY b.belge_turu) FILTER (WHERE b.id IS NOT NULL) as belgeler
    FROM araclar a
    LEFT JOIN arac_belgeler b ON b.arac_id = a.id
    GROUP BY a.id ORDER BY a.plaka
  `);
  res.json(rows);
});

app.post("/hr/araclar", async (req, res) => {
  try {
    const { plaka, marka, model, yil, tip, kiralama_firmasi, sozlesme_no,
            kira_baslangic, kira_bitis, aylik_kira, bolge, surucu,
            sigorta_bitis, muayene_bitis, durum, notlar } = req.body;
    const norm = (plaka || "").replace(/\s+/g, "").toUpperCase();
    const { rows } = await pool.query(
      `INSERT INTO araclar (plaka,marka,model,yil,tip,kiralama_firmasi,sozlesme_no,
        kira_baslangic,kira_bitis,aylik_kira,bolge,surucu,sigorta_bitis,muayene_bitis,durum,notlar,aktif)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true)
       ON CONFLICT (plaka) DO UPDATE SET
         marka=$2,model=$3,yil=$4,tip=$5,kiralama_firmasi=$6,sozlesme_no=$7,
         kira_baslangic=$8,kira_bitis=$9,aylik_kira=$10,bolge=$11,surucu=$12,
         sigorta_bitis=$13,muayene_bitis=$14,durum=$15,notlar=$16,aktif=true
       RETURNING *`,
      // yil integer kolonu: boş string "" gelirse null'a çevrilir (form "Seçin" kalabilir)
      [norm,marka,model,yil||null,tip,kiralama_firmasi,sozlesme_no,
       kira_baslangic||null,kira_bitis||null,aylik_kira||null,bolge,surucu,
       sigorta_bitis||null,muayene_bitis||null,durum||'AKTİF',notlar]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/hr/araclar/:id", async (req, res) => {
  try {
    const { plaka,marka,model,yil,tip,kiralama_firmasi,sozlesme_no,
            kira_baslangic,kira_bitis,aylik_kira,bolge,surucu,
            sigorta_bitis,muayene_bitis,durum,notlar,aktif } = req.body;
    const { rows } = await pool.query(
      `UPDATE araclar SET plaka=COALESCE($2,plaka),marka=$3,model=$4,yil=$5,tip=$6,
        kiralama_firmasi=$7,sozlesme_no=$8,kira_baslangic=$9,kira_bitis=$10,
        aylik_kira=$11,bolge=$12,surucu=$13,sigorta_bitis=$14,muayene_bitis=$15,
        durum=$16,notlar=$17,aktif=COALESCE($18,aktif) WHERE id=$1 RETURNING *`,
      [req.params.id,plaka?plaka.replace(/\s+/g,"").toUpperCase():null,
       marka,model,yil||null,tip,kiralama_firmasi,sozlesme_no,
       kira_baslangic||null,kira_bitis||null,aylik_kira||null,bolge,surucu,
       sigorta_bitis||null,muayene_bitis||null,durum,notlar,aktif??null]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sadece durum güncelle (AKTİF/PASİF/SERVİSTE) — diğer alanları bozmadan
app.put("/hr/araclar/:id/durum", async (req, res) => {
  try {
    const { durum } = req.body;
    if (!["AKTİF", "PASİF", "SERVİSTE"].includes(durum))
      return res.status(400).json({ error: "Geçersiz durum" });
    const { rows } = await pool.query(
      `UPDATE araclar SET durum=$1, aktif=$2 WHERE id=$3 RETURNING *`,
      [durum, durum === "AKTİF", req.params.id]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Araç kira ödemesi: dönem başına bir kayıt (tekrar gönderilirse günceller)
// kasadan_dus=false → kirayı AHY kendi ödedi: nakit akışında ve giderde
// görünür, kasa bakiyesinden düşmez (ofis kira kurgusuyla aynı)
pool.query(`ALTER TABLE arac_kira_odemeler ADD COLUMN IF NOT EXISTS kasadan_dus BOOLEAN DEFAULT true`).catch(() => {});

app.post("/hr/araclar/:id/kira-ode", async (req, res) => {
  try {
    const { id } = req.params;
    const { donem, tutar, tarih, aciklama, kasadan_dus } = req.body;
    if (!/^\d{4}-\d{2}$/.test(String(donem || ""))) return res.status(400).json({ error: "Geçersiz dönem (YYYY-AA)" });
    const r = await pool.query(
      `INSERT INTO arac_kira_odemeler (arac_id, donem, tutar, tarih, aciklama, kasadan_dus)
       VALUES ($1,$2,$3,COALESCE($4::date, CURRENT_DATE),$5,COALESCE($6, true))
       ON CONFLICT (arac_id, donem) DO UPDATE SET tutar=$3, tarih=COALESCE($4::date, CURRENT_DATE), aciklama=$5,
         kasadan_dus=COALESCE($6, arac_kira_odemeler.kasadan_dus)
       RETURNING *`,
      [id, donem, Number(tutar || 0), tarih || null, aciklama || null,
       kasadan_dus === undefined || kasadan_dus === null ? null : !!kasadan_dus],
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Hatalı girilen kira ödemesini geri al (dönem bazlı)
app.delete("/hr/araclar/:id/kira-ode", async (req, res) => {
  try {
    const donem = String(req.query.donem || "");
    if (!/^\d{4}-\d{2}$/.test(donem)) return res.status(400).json({ error: "Geçersiz dönem (YYYY-AA)" });
    const r = await pool.query(
      `DELETE FROM arac_kira_odemeler WHERE arac_id=$1 AND donem=$2 RETURNING *`,
      [req.params.id, donem],
    );
    if (!r.rows.length) return res.status(404).json({ error: "Bu dönem için ödeme kaydı yok" });
    res.json({ ok: true, silinen: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/hr/arac-kira-odemeler", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT o.*, a.plaka FROM arac_kira_odemeler o
      JOIN araclar a ON a.id = o.arac_id
      ORDER BY o.donem DESC, a.plaka`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/hr/araclar/:id", async (req, res) => {
  await pool.query("UPDATE araclar SET aktif=false WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// Araç belge upload — turu: SOZLESME | RUHSAT | SIGORTA | MUAYENE | DIGER
app.post("/hr/araclar/:id/belge", aracUpload.single("dosya"), async (req, res) => {
  try {
    const { belge_turu, aciklama } = req.body;
    if (!req.file) return res.status(400).json({ error: "Dosya yok" });
    if (["SOZLESME","RUHSAT","SIGORTA","MUAYENE"].includes(belge_turu)) {
      const old = await pool.query("SELECT dosya_yolu FROM arac_belgeler WHERE arac_id=$1 AND belge_turu=$2", [req.params.id, belge_turu]);
      for (const r of old.rows) await deleteFromStorage(r.dosya_yolu);
      await pool.query("DELETE FROM arac_belgeler WHERE arac_id=$1 AND belge_turu=$2", [req.params.id, belge_turu]);
    }
    const fname = `${Date.now()}-${utf8Name(req.file.originalname)}`;
    const { url } = await uploadToStorage("arac-belgeler", fname, req.file.buffer, req.file.mimetype);
    const { rows } = await pool.query(
      "INSERT INTO arac_belgeler (arac_id,belge_turu,dosya_adi,dosya_yolu,aciklama) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [req.params.id, belge_turu, utf8Name(req.file.originalname), url, aciklama||null]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/hr/arac-belge/:id", async (req, res) => {
  try {
    const b = await pool.query("SELECT dosya_yolu FROM arac_belgeler WHERE id=$1", [req.params.id]);
    if (b.rows[0]) await deleteFromStorage(b.rows[0].dosya_yolu);
    await pool.query("DELETE FROM arac_belgeler WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/hr/arac-belge/file/:filename", async (req, res) => {
  try {
    const b = await pool.query("SELECT dosya_yolu FROM arac_belgeler WHERE dosya_adi=$1 ORDER BY id DESC LIMIT 1", [req.params.filename]);
    if (b.rows[0]?.dosya_yolu?.startsWith("http")) return res.redirect(b.rows[0].dosya_yolu);
    res.status(404).json({ error: "Dosya yok" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── EKİP YÖNETİMİ (Organizasyon Şeması) ────────────────────────────────────
// Ekip = numara + araç plakası (+ bölge). Personel ataması personel.ekip_bilgisi
// alanında tutulur; org şeması Excel'i bu verilerden canlı "Ekipler" sayfası üretir.
pool.query(`CREATE TABLE IF NOT EXISTS ekipler (
  ekip_no INTEGER PRIMARY KEY,
  plaka TEXT,
  bolge TEXT,
  aciklama TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`).catch(() => {});
// Ekip adı (örn. "ENH Ekibi") + üye bazlı araç ataması (araç kişiye yazılır)
pool.query(`ALTER TABLE ekipler ADD COLUMN IF NOT EXISTS ad TEXT`).catch(() => {});
pool.query(`ALTER TABLE personel ADD COLUMN IF NOT EXISTS ekip_arac_plaka TEXT`).catch(() => {});

// Ekip taşeron etiketi: kutucukta ekip adının altında görünür (örn. taşeron ekipler)
pool.query(`ALTER TABLE ekipler ADD COLUMN IF NOT EXISTS taseron_adi TEXT`).catch(() => {});

app.get("/hr/ekipler", async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM ekipler ORDER BY ekip_no`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/hr/ekipler", async (req, res) => {
  try {
    const no = Number(req.body.ekip_no || 0);
    if (!no || no < 1) return res.status(400).json({ error: "Geçerli ekip no gerekli" });
    const r = await pool.query(
      `INSERT INTO ekipler (ekip_no, plaka, bolge, aciklama, ad, taseron_adi)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (ekip_no) DO UPDATE SET plaka=$2, bolge=$3, aciklama=$4, ad=$5, taseron_adi=$6, updated_at=NOW()
       RETURNING *`,
      [no, req.body.plaka || null, req.body.bolge || null, req.body.aciklama || null, req.body.ad || null,
       (req.body.taseron_adi || "").trim() || null]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/hr/ekipler/:no", async (req, res) => {
  try {
    const no = Number(req.params.no);
    await pool.query(`DELETE FROM ekipler WHERE ekip_no=$1`, [no]);
    // Silinen ekibe atanmış personelin ataması temizlenir
    await pool.query(`UPDATE personel SET ekip_bilgisi=NULL WHERE ekip_bilgisi=$1`, [String(no)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Personel → ekip ataması (yalnız ekip_bilgisi alanını günceller)
app.put("/hr/personel/:id/ekip", async (req, res) => {
  try {
    const sets = [], vals = [req.params.id];
    if ("ekip_bilgisi" in req.body) {
      const v = req.body.ekip_bilgisi;
      vals.push(v === null || v === undefined || v === "" ? null : String(v));
      sets.push(`ekip_bilgisi=$${vals.length}`);
      // Ekipten çıkarılınca araç ataması da temizlenir
      if (v === null || v === undefined || v === "") sets.push(`ekip_arac_plaka=NULL`);
    }
    if ("ekip_arac_plaka" in req.body) {
      const a = req.body.ekip_arac_plaka;
      vals.push(a === null || a === undefined || a === "" ? null : String(a).trim().toUpperCase());
      sets.push(`ekip_arac_plaka=$${vals.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: "Güncellenecek alan yok" });
    const onceQ = await pool.query(`SELECT ad_soyad, ekip_arac_plaka FROM personel WHERE id=$1`, [req.params.id]);
    const once = onceQ.rows[0] || {};
    const r = await pool.query(
      `UPDATE personel SET ${sets.join(", ")} WHERE id=$1 RETURNING id, ad_soyad, ekip_bilgisi, ekip_arac_plaka`,
      vals);
    if (!r.rows.length) return res.status(404).json({ error: "Personel bulunamadı" });
    const yeni = r.rows[0];
    // ── Araç Yönetimi senkronu: org şemasındaki atama araç kartına yansır ──
    // Atanan aracın sürücüsü = üye, bölgesi = ekibin bölgesi; atama
    // kaldırılınca/değişince eski aracın sürücüsü temizlenir.
    try {
      if (once.ekip_arac_plaka && once.ekip_arac_plaka !== yeni.ekip_arac_plaka) {
        await pool.query(`UPDATE araclar SET surucu=NULL WHERE plaka=$1 AND surucu=$2`,
          [once.ekip_arac_plaka, once.ad_soyad]);
      }
      if (yeni.ekip_arac_plaka) {
        const ek = await pool.query(`SELECT bolge FROM ekipler WHERE ekip_no::text = $1 LIMIT 1`,
          [String(yeni.ekip_bilgisi || "")]).catch(() => ({ rows: [] }));
        await pool.query(`UPDATE araclar SET surucu=$2, bolge=COALESCE(NULLIF($3,''), bolge) WHERE plaka=$1`,
          [yeni.ekip_arac_plaka, yeni.ad_soyad, ek.rows[0]?.bolge || ""]);
      }
    } catch (se) { console.error("ARAC SENKRON:", se.message); }
    res.json(yeni);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── OFİS & DEPO ─────────────────────────────────────────────────────────────
// Kira ödemeleri: araç kira sistemiyle aynı kurgu (dönem bazlı upsert + geri al)
pool.query(`
  CREATE TABLE IF NOT EXISTS ofis_kira_odemeler (
    id SERIAL PRIMARY KEY,
    ofis_id INTEGER NOT NULL,
    donem TEXT NOT NULL,
    tutar NUMERIC NOT NULL DEFAULT 0,
    tarih DATE NOT NULL DEFAULT CURRENT_DATE,
    aciklama TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (ofis_id, donem)
  )`).then(() =>
  // kasadan_dus=false → kirayı AHY kendi ödedi: nakit akışında görünür,
  // kasa bakiyesinden düşmez (İzmir depo Temmuz 2026 istisnası gibi)
  pool.query(`ALTER TABLE ofis_kira_odemeler ADD COLUMN IF NOT EXISTS kasadan_dus BOOLEAN DEFAULT true`)
).catch(() => {});

app.post("/hr/ofis/:id/kira-ode", async (req, res) => {
  try {
    const { donem, tutar, tarih, aciklama } = req.body;
    if (!/^\d{4}-\d{2}$/.test(String(donem || ""))) return res.status(400).json({ error: "Geçersiz dönem (YYYY-AA)" });
    const r = await pool.query(
      `INSERT INTO ofis_kira_odemeler (ofis_id, donem, tutar, tarih, aciklama)
       VALUES ($1,$2,$3,COALESCE($4::date, CURRENT_DATE),$5)
       ON CONFLICT (ofis_id, donem) DO UPDATE SET tutar=$3, tarih=COALESCE($4::date, CURRENT_DATE), aciklama=$5
       RETURNING *`,
      [req.params.id, donem, Number(tutar || 0), tarih || null, aciklama || null],
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/hr/ofis/:id/kira-ode", async (req, res) => {
  try {
    const donem = String(req.query.donem || "");
    if (!/^\d{4}-\d{2}$/.test(donem)) return res.status(400).json({ error: "Geçersiz dönem (YYYY-AA)" });
    const r = await pool.query(
      `DELETE FROM ofis_kira_odemeler WHERE ofis_id=$1 AND donem=$2 RETURNING *`,
      [req.params.id, donem],
    );
    if (!r.rows.length) return res.status(404).json({ error: "Bu dönem için ödeme kaydı yok" });
    res.json({ ok: true, silinen: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/hr/ofis-kira-odemeler", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT o.*, d.ad FROM ofis_kira_odemeler o
      JOIN ofis_depo d ON d.id = o.ofis_id
      ORDER BY o.donem DESC, d.ad`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/hr/ofis", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT o.*, json_agg(b ORDER BY b.created_at) FILTER (WHERE b.id IS NOT NULL) as belgeler
    FROM ofis_depo o
    LEFT JOIN ofis_belgeler b ON b.ofis_id = o.id
    GROUP BY o.id ORDER BY o.ad
  `);
  res.json(rows);
});

app.post("/hr/ofis", async (req, res) => {
  try {
    const { tur,ad,bolge,adres,kiraya_veren,sozlesme_no,kira_baslangic,kira_bitis,
            aylik_kira,metrekare,kat,sorumlu,durum,notlar } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO ofis_depo (tur,ad,bolge,adres,kiraya_veren,sozlesme_no,kira_baslangic,
        kira_bitis,aylik_kira,metrekare,kat,sorumlu,durum,notlar)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [tur||'OFİS',ad,bolge,adres,kiraya_veren,sozlesme_no,
       kira_baslangic||null,kira_bitis||null,aylik_kira||null,metrekare||null,kat,sorumlu,durum||'AKTİF',notlar]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/hr/ofis/:id", async (req, res) => {
  try {
    const { tur,ad,bolge,adres,kiraya_veren,sozlesme_no,kira_baslangic,kira_bitis,
            aylik_kira,metrekare,kat,sorumlu,durum,notlar } = req.body;
    const { rows } = await pool.query(
      `UPDATE ofis_depo SET tur=$2,ad=$3,bolge=$4,adres=$5,kiraya_veren=$6,sozlesme_no=$7,
        kira_baslangic=$8,kira_bitis=$9,aylik_kira=$10,metrekare=$11,kat=$12,
        sorumlu=$13,durum=$14,notlar=$15 WHERE id=$1 RETURNING *`,
      [req.params.id,tur,ad,bolge,adres,kiraya_veren,sozlesme_no,
       kira_baslangic||null,kira_bitis||null,aylik_kira||null,metrekare||null,kat,sorumlu,durum,notlar]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/hr/ofis/:id", async (req, res) => {
  await pool.query("UPDATE ofis_depo SET durum='PASİF' WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

app.post("/hr/ofis/:id/belge", ofisUpload.single("dosya"), async (req, res) => {
  try {
    const { belge_turu, aciklama } = req.body;
    if (!req.file) return res.status(400).json({ error: "Dosya yok" });
    if (belge_turu === "SOZLESME") {
      const old = await pool.query("SELECT dosya_yolu FROM ofis_belgeler WHERE ofis_id=$1 AND belge_turu='SOZLESME'", [req.params.id]);
      for (const r of old.rows) await deleteFromStorage(r.dosya_yolu);
      await pool.query("DELETE FROM ofis_belgeler WHERE ofis_id=$1 AND belge_turu='SOZLESME'", [req.params.id]);
    }
    const fname = `${Date.now()}-${utf8Name(req.file.originalname)}`;
    const { url } = await uploadToStorage("ofis-belgeler", fname, req.file.buffer, req.file.mimetype);
    const { rows } = await pool.query(
      "INSERT INTO ofis_belgeler (ofis_id,belge_turu,dosya_adi,dosya_yolu,aciklama) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [req.params.id, belge_turu||'DIGER', utf8Name(req.file.originalname), url, aciklama||null]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/hr/ofis-belge/:id", async (req, res) => {
  try {
    const b = await pool.query("SELECT dosya_yolu FROM ofis_belgeler WHERE id=$1", [req.params.id]);
    if (b.rows[0]) await deleteFromStorage(b.rows[0].dosya_yolu);
    await pool.query("DELETE FROM ofis_belgeler WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/hr/ofis-belge/file/:filename", async (req, res) => {
  try {
    const b = await pool.query("SELECT dosya_yolu FROM ofis_belgeler WHERE dosya_adi=$1 ORDER BY id DESC LIMIT 1", [req.params.filename]);
    if (b.rows[0]?.dosya_yolu?.startsWith("http")) return res.redirect(b.rows[0].dosya_yolu);
    res.status(404).json({ error: "Dosya yok" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT submit for approval (TASLAK → PM_BEKLE)
app.put("/hr/masraf-form/:id/submit", async (req, res) => {
  try {
    // PM'in (Orhan Bedir) kendi formu kendi onayına düşmesin: PM adımı
    // otomatik geçilir, form doğrudan Proje Direktörü (Düzgün Şimşek) onayına gider.
    const f = await pool.query("SELECT talep_eden_email FROM masraf_form WHERE id=$1", [req.params.id]);
    const isPM = String(f.rows[0]?.talep_eden_email || "").toLowerCase() === "orhan.bedir@simsektel.com";
    const { rows } = await pool.query(
      isPM
        ? `UPDATE masraf_form SET durum='DIREKTOR_BEKLE', pm_onay_tarihi=NOW(), pm_not='PM formu — PM adımı otomatik geçildi' WHERE id=$1 AND durum='TASLAK' RETURNING *`
        : `UPDATE masraf_form SET durum='PM_BEKLE' WHERE id=$1 AND durum='TASLAK' RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(422).json({ error: "Form taslak durumunda değil veya bulunamadı" });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT PM onayla (PM_BEKLE → PM_ONAY)
app.put("/hr/masraf-form/:id/pm-onayla", async (req, res) => {
  try {
    const { pm_not } = req.body;
    const { rows } = await pool.query(
      `UPDATE masraf_form SET durum='DIREKTOR_BEKLE', pm_not=$1, pm_onay_tarihi=NOW() WHERE id=$2 RETURNING *`,
      [pm_not||null, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT PM reddet
app.put("/hr/masraf-form/:id/pm-reddet", async (req, res) => {
  try {
    const { red_aciklama, reddeden_email } = req.body;
    const { rows } = await pool.query(
      `UPDATE masraf_form SET durum='REDDEDILDI', red_aciklama=$1, reddeden_email=$2 WHERE id=$3 RETURNING *`,
      [red_aciklama, reddeden_email, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT Direktör onayla (DIREKTOR_BEKLE → TAMAMLANDI) + avans düş
app.put("/hr/masraf-form/:id/direktor-onayla", async (req, res) => {
  try {
    const id = req.params.id;
    const { direktor_not } = req.body;
    const formRes = await pool.query(
      `UPDATE masraf_form SET durum='TAMAMLANDI', direktor_not=$1, direktor_onay_tarihi=NOW() WHERE id=$2 RETURNING *`,
      [direktor_not||null, id]
    );
    const form = formRes.rows[0];

    // TRAFIK_CEZA kalemleri için avans oluştur
    const cezaKalemler = await pool.query(
      `SELECT * FROM masraf_kalem WHERE form_id=$1 AND kategori='TRAFIK_CEZA' AND ceza_personel_id IS NOT NULL`,
      [id]
    );
    for (const k of cezaKalemler.rows) {
      await pool.query(
        `INSERT INTO avans (personel_id, tarih, tutar, aciklama, avans_turu, odendi) VALUES ($1, NOW(), $2, $3, 'TRAFIK_CEZA', false)`,
        [k.ceza_personel_id, k.tutar, `Trafik Cezası - ${k.plaka || 'Plaka yok'} (Masraf #${id})`]
      );
    }

    res.json(form);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT Direktör reddet
app.put("/hr/masraf-form/:id/direktor-reddet", async (req, res) => {
  try {
    const { red_aciklama, reddeden_email } = req.body;
    const { rows } = await pool.query(
      `UPDATE masraf_form SET durum='REDDEDILDI', red_aciklama=$1, reddeden_email=$2 WHERE id=$3 RETURNING *`,
      [red_aciklama, reddeden_email, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET masraf-form Excel (single form)
app.get("/hr/masraf-form/:id/excel", async (req, res) => {
  try {
    const formRes = await pool.query(`
      SELECT mf.*, p.ad_soyad as personel_ad FROM masraf_form mf
      LEFT JOIN personel p ON p.id = mf.personel_id WHERE mf.id=$1`, [req.params.id]);
    if (!formRes.rows[0]) return res.status(404).json({ error: "Bulunamadı" });
    const form = formRes.rows[0];
    const kalemler = await pool.query("SELECT * FROM masraf_kalem WHERE form_id=$1 ORDER BY tarih,id", [form.id]);

    // Mobil'den gelen Türkçe kategori adlarını Excel key'lerine normalize et
    const MOBIL_KAT_MAP = {
      "Yemek": "YEMEK", "yemek": "YEMEK",
      "Yakıt": "YAKIT", "yakıt": "YAKIT", "Yakit": "YAKIT",
      "Konaklama": "KONAKLAMA", "konaklama": "KONAKLAMA",
      "Yol & Ulaşım": "ULASIM", "Ulaşım": "ULASIM", "Yol": "ULASIM",
      "Malzeme": "MALZEME", "malzeme": "MALZEME",
      "Köprü": "KOPRU", "Köprü/Otoyol": "KOPRU",
      "Trafik Cezası": "TRAFIK_CEZA", "trafik cezası": "TRAFIK_CEZA", "Trafik Cezasi": "TRAFIK_CEZA",
      "Diğer": "DIGER", "diğer": "DIGER", "Diger": "DIGER",
    };
    const rows = kalemler.rows.map(r => ({
      ...r,
      kategori: MOBIL_KAT_MAP[r.kategori] || r.kategori,
    }));

    const KATS = [
      { key: "YEMEK",       label: "YİYECEK VE İÇECEK GİDERLERİ",      aciklamaLabel: "AÇIKLAMA (PROJE VEYA İŞ ADI)" },
      { key: "YAKIT",       label: "ARAÇ YAKIT VE BAKIM GİDERLERİ",     aciklamaLabel: "AÇIKLAMA (ARAÇ PLAKA NO)" },
      { key: "KONAKLAMA",   label: "KONAKLAMA GİDERLERİ",               aciklamaLabel: "AÇIKLAMA (KAÇ GECE, KİŞİ SAYISI)" },
      { key: "ULASIM",      label: "ULAŞIM GİDERLERİ",                  aciklamaLabel: "AÇIKLAMA (BİNİŞ SAATİ, GÜZERGAH)" },
      { key: "KOPRU",       label: "KÖPRÜ / OTOYOL GEÇİŞ GİDERLERİ",   aciklamaLabel: "AÇIKLAMA (GEÇİŞ DETAYI)" },
      { key: "MALZEME",     label: "MALZEME GİDERLERİ",                 aciklamaLabel: "AÇIKLAMA (MALZEME DETAYI)" },
      { key: "TRAFIK_CEZA", label: "TRAFİK CEZASI GİDERLERİ",          aciklamaLabel: "AÇIKLAMA (PLAKA / CEZA DETAYI)" },
      { key: "DIGER",       label: "DİĞER GİDERLER",                    aciklamaLabel: "AÇIKLAMA (İŞİN DETAYI)" },
    ];

    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Masraf Formu");

    ws.columns = [
      { width: 3 }, { width: 13 }, { width: 12 }, { width: 30 }, { width: 40 }, { width: 5 }, { width: 16 }
    ];

    const navy = "FF1E3A5F", white = "FFFFFFFF", headerBlue = "FF2563EB";
    const boldWhite = { bold: true, color: { argb: white }, name: "Arial", size: 11 };
    const boldNavy = { bold: true, color: { argb: "FF1E3A5F" }, name: "Arial", size: 10 };
    const thinLine = { style: "thin", color: { argb: "FFB0B8C1" } };
    const cellBorder = { top: thinLine, left: thinLine, bottom: thinLine, right: thinLine };

    const mergeAndStyle = (r, c1, c2, val, fill, font, align = "center") => {
      if (c1 !== c2) ws.mergeCells(r, c1, r, c2);
      const cell = ws.getCell(r, c1);
      cell.value = val;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill || white } };
      if (font) cell.font = font;
      cell.alignment = { horizontal: align, vertical: "middle", wrapText: true };
      cell.border = cellBorder;
    };

    const applyBorder = (r, cols) => {
      cols.forEach(c => { ws.getCell(r, c).border = cellBorder; });
    };

    // Row 1: Title
    ws.addRow([]);
    ws.getRow(1).height = 30;
    mergeAndStyle(1, 2, 5, "MASRAF FORMU", navy, { bold: true, color: { argb: white }, name: "Arial", size: 14 });
    mergeAndStyle(1, 7, 7, `Doküman Kodu: MF.${String(form.form_no || form.id).padStart(3,"0")}`, null, boldNavy, "right");

    // Row 2: donem + date + rev
    ws.addRow([]);
    ws.getRow(2).height = 18;
    mergeAndStyle(2, 2, 5, `Dönem: ${form.donem}`, null, boldNavy, "left");
    mergeAndStyle(2, 7, 7, `Oluşturma: ${new Date(form.created_at).toLocaleDateString("tr-TR")}`, null, { name: "Arial", size: 9, italic: true }, "right");

    // Row 3: Personel
    ws.addRow([]);
    ws.getRow(3).height = 18;
    mergeAndStyle(3, 2, 5, `Personel: ${formatAd(form.personel_ad || form.talep_eden_ad)}`, null, boldNavy, "left");

    let currentRow = 4;
    const totals = {};

    for (const kat of KATS) {
      const katRows = rows.filter(r => r.kategori === kat.key);
      totals[kat.key] = katRows.reduce((s, r) => s + Number(r.tutar), 0);

      // Category header
      ws.getRow(currentRow).height = 20;
      mergeAndStyle(currentRow, 2, 7, kat.label, headerBlue, boldWhite);
      currentRow++;

      // Column headers
      ws.getRow(currentRow).height = 18;
      const colHeaders = ["TARİH", "BELGE NO", "BELGE AÇIKLAMASI", kat.aciklamaLabel, "", "MASRAF TUTARI"];
      [2, 3, 4, 5, 6, 7].forEach((col, i) => {
        const cell = ws.getCell(currentRow, col);
        cell.value = colHeaders[i];
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1D5DB" } };
        cell.font = { bold: true, name: "Arial", size: 9 };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = cellBorder;
      });
      currentRow++;

      if (katRows.length === 0) {
        ws.mergeCells(currentRow, 2, currentRow, 6);
        ws.getCell(currentRow, 2).value = "—";
        ws.getCell(currentRow, 2).alignment = { horizontal: "center" };
        ws.getCell(currentRow, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: white } };
        ws.getCell(currentRow, 7).value = 0;
        ws.getCell(currentRow, 7).numFmt = "#,##0.00 ₺";
        ws.getCell(currentRow, 7).alignment = { horizontal: "right" };
        ws.getCell(currentRow, 7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: white } };
        applyBorder(currentRow, [2, 7]);
        currentRow++;
      } else {
        for (const kalem of katRows) {
          ws.getRow(currentRow).height = 16;
          ws.getCell(currentRow, 2).value = kalem.tarih ? new Date(kalem.tarih).toLocaleDateString("tr-TR") : "";
          ws.getCell(currentRow, 3).value = kalem.belge_no || "";
          ws.getCell(currentRow, 4).value = kalem.belge_aciklama || "";
          ws.mergeCells(currentRow, 5, currentRow, 6);
          ws.getCell(currentRow, 5).value = kalem.aciklama || "";
          ws.getCell(currentRow, 5).alignment = { wrapText: true };
          ws.getCell(currentRow, 7).value = Number(kalem.tutar);
          ws.getCell(currentRow, 7).numFmt = "#,##0.00 ₺";
          ws.getCell(currentRow, 7).alignment = { horizontal: "right" };
          if (!kalem.fis_var) {
            ws.getCell(currentRow, 2).font = { color: { argb: "FFDC2626" }, italic: true, name: "Arial", size: 9 };
          }
          [2, 3, 4, 5, 7].forEach(c => {
            ws.getCell(currentRow, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: white } };
            ws.getCell(currentRow, c).border = cellBorder;
          });
          currentRow++;
        }
      }

      // Subtotal row
      ws.getRow(currentRow).height = 18;
      mergeAndStyle(currentRow, 2, 6, `${kat.label.replace("GİDERLERİ","").trim()} Toplamı`, "FFF3F4F6", boldNavy, "right");
      ws.getCell(currentRow, 7).value = totals[kat.key];
      ws.getCell(currentRow, 7).numFmt = "#,##0.00 ₺";
      ws.getCell(currentRow, 7).font = { bold: true, name: "Arial", size: 10 };
      ws.getCell(currentRow, 7).alignment = { horizontal: "right" };
      ws.getCell(currentRow, 7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
      ws.getCell(currentRow, 7).border = cellBorder;
      currentRow++;
    }

    // ICMAL
    ws.getRow(currentRow).height = 22;
    mergeAndStyle(currentRow, 2, 7, "İCMAL / SONUÇ", navy, boldWhite);
    currentRow++;

    const genToplam = Object.values(totals).reduce((s, v) => s + v, 0);
    for (const kat of KATS) {
      ws.getRow(currentRow).height = 16;
      mergeAndStyle(currentRow, 2, 6, kat.label, null, { name: "Arial", size: 9 }, "left");
      ws.getCell(currentRow, 7).value = totals[kat.key];
      ws.getCell(currentRow, 7).numFmt = "#,##0.00 ₺";
      ws.getCell(currentRow, 7).alignment = { horizontal: "right" };
      ws.getCell(currentRow, 7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: white } };
      ws.getCell(currentRow, 7).border = cellBorder;
      currentRow++;
    }

    // Genel Toplam
    ws.getRow(currentRow).height = 20;
    mergeAndStyle(currentRow, 2, 6, "GENEL TOPLAM", navy, boldWhite, "right");
    ws.getCell(currentRow, 7).value = genToplam;
    ws.getCell(currentRow, 7).numFmt = "#,##0.00 ₺";
    ws.getCell(currentRow, 7).font = { bold: true, color: { argb: white }, name: "Arial", size: 11 };
    ws.getCell(currentRow, 7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
    ws.getCell(currentRow, 7).alignment = { horizontal: "right", vertical: "middle" };
    ws.getCell(currentRow, 7).border = cellBorder;
    currentRow += 2;

    // İmza alanı
    ws.getRow(currentRow).height = 18;
    mergeAndStyle(currentRow, 2, 3, "HARCAMAYI YAPAN", "FFE0F2FE", { bold: true, name: "Arial", size: 9 });
    mergeAndStyle(currentRow, 4, 5, "BİRİM YÖNETİCİSİ (PM)", "FFD1FAE5", { bold: true, name: "Arial", size: 9 });
    mergeAndStyle(currentRow, 6, 7, "GENEL MÜDÜR", "FFFEF3C7", { bold: true, name: "Arial", size: 9 });
    currentRow++;

    ws.getRow(currentRow).height = 30;
    mergeAndStyle(currentRow, 2, 3, form.talep_eden_ad, null, { name: "Arial", size: 10 });
    const pmAd = form.pm_onay_tarihi ? `Orhan Bedir\n${new Date(form.pm_onay_tarihi).toLocaleDateString("tr-TR")}` : "—";
    const dirAd = form.direktor_onay_tarihi ? `Düzgün Şimşek\n${new Date(form.direktor_onay_tarihi).toLocaleDateString("tr-TR")}` : "—";
    mergeAndStyle(currentRow, 4, 5, pmAd, null, { name: "Arial", size: 10 });
    mergeAndStyle(currentRow, 6, 7, dirAd, null, { name: "Arial", size: 10 });
    currentRow++;

    ws.getRow(currentRow).height = 18;
    mergeAndStyle(currentRow, 2, 3, "Tarih / İmza", null, { italic: true, color: { argb: "FF9CA3AF" }, name: "Arial", size: 8 });
    mergeAndStyle(currentRow, 4, 5, form.pm_not || "", null, { italic: true, color: { argb: "FF374151" }, name: "Arial", size: 8 });
    mergeAndStyle(currentRow, 6, 7, form.direktor_not || "", null, { italic: true, color: { argb: "FF374151" }, name: "Arial", size: 8 });

    // Frozen panes
    ws.views = [{ state: "frozen", xSplit: 0, ySplit: 3, topLeftCell: "A4", showGridLines: false }];

    const donemSafe = form.donem.replace(/[^0-9\-]/g, "");
    const adSafe = (form.talep_eden_ad||"masraf").replace(/[^a-zA-Z0-9_\-]/g, "_");
    const fname = `masraf_formu_${adSafe}_${donemSafe}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"; filename*=UTF-8''${encodeURIComponent(fname)}`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET PDF of all receipts for a form
app.get("/hr/masraf-form/:id/pdf", async (req, res) => {
  try {
    const PDFDocument = require("pdfkit");
    const belgeler = await pool.query(
      `SELECT mb.*, mk.kategori, mk.tutar, mk.tarih FROM masraf_belge mb
       JOIN masraf_kalem mk ON mk.id = mb.kalem_id
       WHERE mb.form_id=$1 ORDER BY mk.tarih, mb.id`, [req.params.id]
    );
    const formRes = await pool.query("SELECT * FROM masraf_form WHERE id=$1", [req.params.id]);
    const form = formRes.rows[0];

    const doc = new PDFDocument({ size: "A4", margin: 20 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="masraf_fisleri_${req.params.id}.pdf"`);
    doc.pipe(res);

    const imgFiles = belgeler.rows.filter(b => /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(b.dosya_yolu));
    const sharp = require("sharp");
    const margin = 20;
    const gap = 12;
    const labelH = 20;
    const pageW = doc.page.width;   // 595 pt (A4 portrait)
    const pageH = doc.page.height;  // 842 pt

    // Fetch, trim and rotate each image to portrait orientation
    const trimmed = [];
    for (const img of imgFiles) {
      try {
        let rawBuf;
        if (img.dosya_yolu.startsWith("http")) {
          const fetch = require("node-fetch");
          const resp = await fetch(img.dosya_yolu);
          rawBuf = Buffer.from(await resp.arrayBuffer());
        } else { continue; }

        // No crop — use full image, rotate landscape to portrait
        const meta0 = await sharp(rawBuf).metadata();
        const origW = meta0.width || 800, origH = meta0.height || 1200;
        let pipeline = sharp(rawBuf);
        if (origW > origH) pipeline = pipeline.rotate(90);

        const buf = await pipeline.jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
        trimmed.push({ buf: buf.data, w: buf.info.width, h: buf.info.height, meta: img });
      } catch {
        try {
          if (img.dosya_yolu.startsWith("http")) {
            const fetch = require("node-fetch");
            const resp = await fetch(img.dosya_yolu);
            const rawBuf = Buffer.from(await resp.arrayBuffer());
            const info = await sharp(rawBuf).metadata();
            const w0 = info.width || 400, h0 = info.height || 600;
            const isLandscape = w0 > h0;
            const buf = await sharp(rawBuf)
              .rotate(isLandscape ? 90 : 0)
              .jpeg({ quality: 88 })
              .toBuffer({ resolveWithObject: true });
            trimmed.push({ buf: buf.data, w: buf.info.width, h: buf.info.height, meta: img });
          }
        } catch {}
      }
    }

    // Layout: 2×2 grid (4 per page) on portrait A4
    const cols = 2, rows = 2;
    const availW = pageW - margin * 2;
    const availH = pageH - margin * 2;
    const slotW = (availW - gap * (cols - 1)) / cols;
    const slotH = (availH - gap * (rows - 1) - labelH * rows) / rows;

    let firstPage = true;
    for (let i = 0; i < trimmed.length; i++) {
      const posInPage = i % 4;
      if (posInPage === 0) {
        if (!firstPage) doc.addPage();
        firstPage = false;
      }
      const col = posInPage % cols;
      const row = Math.floor(posInPage / cols);
      const { buf, w, h, meta } = trimmed[i];
      const scale = Math.min(slotW / w, slotH / h);
      const imgW = Math.round(w * scale);
      const imgH = Math.round(h * scale);
      const x = margin + col * (slotW + gap) + (slotW - imgW) / 2;
      const y = margin + row * (slotH + labelH + gap) + (slotH - imgH) / 2;
      try {
        doc.image(buf, x, y, { width: imgW, height: imgH });
        doc.fontSize(7).font("Helvetica").fillColor("#444")
           .text(
             `${meta.kategori} · ₺${Number(meta.tutar).toLocaleString("tr-TR")} · ${new Date(meta.tarih).toLocaleDateString("tr-TR")}`,
             x, y + imgH + 3, { width: imgW, align: "center" }
           );
      } catch {}
    }

    if (trimmed.length === 0) {
      doc.fontSize(14).text("Bu forma ait fiş fotoğrafı bulunamadı.", margin, 100, { align: "center" });
    }
    doc.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT arsivle — arsiv_tarihi nakit akışına düşme günüdür (AHY marka-nakit)
pool.query(`ALTER TABLE masraf_form ADD COLUMN IF NOT EXISTS arsiv_tarihi TIMESTAMP`).catch(() => {});
// Fatura firması: ŞİMŞEK (varsayılan/boş) veya AHY — AHY taşeron faturaları paneli
pool.query(`ALTER TABLE invoice_entries ADD COLUMN IF NOT EXISTS firma TEXT`).catch(() => {});
// Marka (AHY) taşeronlarına yapılan avans/fatura ödemeleri — nakit akışına düşer
pool.query(`CREATE TABLE IF NOT EXISTS marka_taseron_odeme (
  id SERIAL PRIMARY KEY,
  marka TEXT NOT NULL,
  taseron_adi TEXT NOT NULL,
  tip TEXT DEFAULT 'AVANS',
  tutar NUMERIC NOT NULL,
  tarih DATE NOT NULL,
  aciklama TEXT,
  fatura_id INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`).catch(() => {});
// tamamlanan_qty boot garantisi: /setup-db içindeki ALTER yalnız elle çağrılınca
// çalışıyor — buildMasterJoinedQuery bu kolonu kullandığı için açılışta garanti et
pool.query(`ALTER TABLE master_works ADD COLUMN IF NOT EXISTS tamamlanan_qty NUMERIC`).catch(() => {});
app.put("/hr/masraf-form/:id/arsivle", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE masraf_form SET durum='ARSIVLENDI', arsiv_tarihi=NOW() WHERE id=$1 AND durum='TAMAMLANDI' RETURNING *`,
      [req.params.id]
    );
    res.json(rows[0] || { error: "Güncellenemedi" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET dönem bazlı toplu Excel (Muhasebe için)
app.get("/hr/masraf-form/donem/:donem/excel", async (req, res) => {
  try {
    const { donem } = req.params;
    const formsRes = await pool.query(`
      SELECT mf.*, p.ad_soyad as personel_ad FROM masraf_form mf
      LEFT JOIN personel p ON p.id = mf.personel_id
      WHERE mf.donem=$1 AND mf.durum IN ('TAMAMLANDI','ARSIVLENDI')
      ORDER BY mf.talep_eden_ad, mf.id`, [donem]);
    const forms = formsRes.rows;

    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook();

    if (forms.length === 0) {
      const ws = wb.addWorksheet("Boş");
      ws.getCell("A1").value = `${donem} döneminde onaylanmış masraf formu yok.`;
    }

    for (const form of forms) {
      const kalemler = await pool.query(
        "SELECT * FROM masraf_kalem WHERE form_id=$1 ORDER BY tarih,id", [form.id]
      );
      const rows = kalemler.rows;
      const sheetName = `${form.talep_eden_ad.slice(0,15)}_${form.id}`.replace(/[\\/*?:\[\]]/g,"");
      const ws = wb.addWorksheet(sheetName);

      ws.columns = [
        { width: 3 }, { width: 13 }, { width: 12 }, { width: 30 }, { width: 38 }, { width: 5 }, { width: 16 }
      ];

      const navy = "FF1E3A5F", white = "FFFFFFFF", headerBlue = "FF2563EB";
      const boldWhite = { bold: true, color: { argb: white }, name: "Arial", size: 11 };
      const boldNavy = { bold: true, color: { argb: navy }, name: "Arial", size: 10 };
      const thinLine2 = { style: "thin", color: { argb: "FFB0B8C1" } };
      const cellBorder2 = { top: thinLine2, left: thinLine2, bottom: thinLine2, right: thinLine2 };

      const mergeAndStyle = (r, c1, c2, val, fill, font, align = "center") => {
        if (c1 !== c2) ws.mergeCells(r, c1, r, c2);
        const cell = ws.getCell(r, c1);
        cell.value = val;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill || white } };
        if (font) cell.font = font;
        cell.alignment = { horizontal: align, vertical: "middle", wrapText: true };
        cell.border = cellBorder2;
      };

      const applyBorder2 = (r, cols) => {
        cols.forEach(c => {
          ws.getCell(r, c).border = cellBorder2;
          ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: white } };
        });
      };

      ws.addRow([]); ws.getRow(1).height = 30;
      mergeAndStyle(1, 2, 5, "MASRAF FORMU", navy, { bold: true, color: { argb: white }, name: "Arial", size: 14 });
      mergeAndStyle(1, 7, 7, `Doküman Kodu: MF.${String(form.form_no || form.id).padStart(3,"0")}`, null, boldNavy, "right");
      ws.addRow([]); ws.getRow(2).height = 18;
      mergeAndStyle(2, 2, 5, `Dönem: ${form.donem}`, null, boldNavy, "left");
      mergeAndStyle(2, 7, 7, `Oluşturma: ${new Date(form.created_at).toLocaleDateString("tr-TR")}`, null, { name:"Arial", size:9, italic:true }, "right");
      ws.addRow([]); ws.getRow(3).height = 18;
      mergeAndStyle(3, 2, 5, `Personel: ${formatAd(form.personel_ad || form.talep_eden_ad)}`, null, boldNavy, "left");

      const KATS = [
        { key:"YEMEK", label:"YİYECEK VE İÇECEK GİDERLERİ", aciklamaLabel:"AÇIKLAMA (PROJE VEYA İŞ ADI)" },
        { key:"YAKIT", label:"ARAÇ YAKIT VE BAKIM GİDERLERİ", aciklamaLabel:"AÇIKLAMA (ARAÇ PLAKA NO)" },
        { key:"KONAKLAMA", label:"KONAKLAMA GİDERLERİ", aciklamaLabel:"AÇIKLAMA (KAÇ GECE, KİŞİ SAYISI)" },
        { key:"ULASIM", label:"ULAŞIM GİDERLERİ", aciklamaLabel:"AÇIKLAMA (BİNİŞ SAATİ, GÜZERGAH)" },
        { key:"KOPRU", label:"KÖPRÜ / OTOYOL GEÇİŞ GİDERLERİ", aciklamaLabel:"AÇIKLAMA (GEÇİŞ DETAYI)" },
        { key:"MALZEME", label:"MALZEME GİDERLERİ", aciklamaLabel:"AÇIKLAMA (MALZEME DETAYI)" },
        { key:"DIGER", label:"DİĞER GİDERLER", aciklamaLabel:"AÇIKLAMA (İŞİN DETAYI)" },
      ];

      let currentRow = 4;
      const totals = {};

      for (const kat of KATS) {
        const katRows = rows.filter(r => r.kategori === kat.key);
        totals[kat.key] = katRows.reduce((s, r) => s + Number(r.tutar), 0);

        ws.getRow(currentRow).height = 20;
        mergeAndStyle(currentRow, 2, 7, kat.label, headerBlue, boldWhite);
        currentRow++;

        ws.getRow(currentRow).height = 16;
        ["TARİH","BELGE NO","BELGE AÇIKLAMASI",kat.aciklamaLabel,"","MASRAF TUTARI"].forEach((h,i)=>{
          const col = [2,3,4,5,6,7][i];
          const cell = ws.getCell(currentRow, col);
          cell.value = h;
          cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFD1D5DB" } };
          cell.font = { bold:true, name:"Arial", size:9 };
          cell.alignment = { horizontal:"center", vertical:"middle" };
          cell.border = cellBorder2;
        });
        currentRow++;

        if (katRows.length === 0) {
          ws.mergeCells(currentRow, 2, currentRow, 6);
          ws.getCell(currentRow, 2).value = "—";
          ws.getCell(currentRow, 2).alignment = { horizontal:"center" };
          ws.getCell(currentRow, 7).value = 0;
          ws.getCell(currentRow, 7).numFmt = "#,##0.00 ₺";
          applyBorder2(currentRow, [2, 7]);
          currentRow++;
        } else {
          for (const kalem of katRows) {
            ws.getRow(currentRow).height = 16;
            ws.getCell(currentRow,2).value = kalem.tarih ? new Date(kalem.tarih).toLocaleDateString("tr-TR") : "";
            ws.getCell(currentRow,3).value = kalem.belge_no||"";
            ws.getCell(currentRow,4).value = kalem.belge_aciklama||"";
            ws.mergeCells(currentRow, 5, currentRow, 6);
            ws.getCell(currentRow,5).value = kalem.aciklama||"";
            ws.getCell(currentRow,5).alignment = { wrapText:true };
            ws.getCell(currentRow,7).value = Number(kalem.tutar);
            ws.getCell(currentRow,7).numFmt = "#,##0.00 ₺";
            ws.getCell(currentRow,7).alignment = { horizontal:"right" };
            if (!kalem.fis_var) ws.getCell(currentRow,2).font = { color:{ argb:"FFDC2626" }, italic:true, name:"Arial", size:9 };
            [2,3,4,5,7].forEach(c => {
              ws.getCell(currentRow,c).border = cellBorder2;
              ws.getCell(currentRow,c).fill = { type:"pattern", pattern:"solid", fgColor:{ argb:white } };
            });
            currentRow++;
          }
        }

        ws.getRow(currentRow).height = 18;
        mergeAndStyle(currentRow, 2, 6, `${kat.label.split(" GİDERLER")[0]} Toplamı`, "FFF3F4F6", boldNavy, "right");
        ws.getCell(currentRow,7).value = totals[kat.key];
        ws.getCell(currentRow,7).numFmt = "#,##0.00 ₺";
        ws.getCell(currentRow,7).font = { bold:true, name:"Arial", size:10 };
        ws.getCell(currentRow,7).alignment = { horizontal:"right" };
        ws.getCell(currentRow,7).fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFF3F4F6" } };
        ws.getCell(currentRow,7).border = cellBorder2;
        currentRow++;
      }

      const genToplam = Object.values(totals).reduce((s,v)=>s+v,0);
      ws.getRow(currentRow).height = 22;
      mergeAndStyle(currentRow, 2, 7, "İCMAL / SONUÇ", navy, boldWhite);
      currentRow++;
      for (const kat of KATS) {
        mergeAndStyle(currentRow, 2, 6, kat.label, null, { name:"Arial", size:9 }, "left");
        ws.getCell(currentRow,7).value = totals[kat.key];
        ws.getCell(currentRow,7).numFmt = "#,##0.00 ₺";
        ws.getCell(currentRow,7).alignment = { horizontal:"right" };
        ws.getCell(currentRow,7).fill = { type:"pattern", pattern:"solid", fgColor:{ argb:white } };
        ws.getCell(currentRow,7).border = cellBorder2;
        currentRow++;
      }
      ws.getRow(currentRow).height = 20;
      mergeAndStyle(currentRow, 2, 6, "GENEL TOPLAM", navy, boldWhite, "right");
      ws.getCell(currentRow,7).value = genToplam;
      ws.getCell(currentRow,7).numFmt = "#,##0.00 ₺";
      ws.getCell(currentRow,7).font = { bold:true, color:{ argb:white }, name:"Arial", size:11 };
      ws.getCell(currentRow,7).fill = { type:"pattern", pattern:"solid", fgColor:{ argb:navy } };
      ws.getCell(currentRow,7).alignment = { horizontal:"right", vertical:"middle" };
      ws.getCell(currentRow,7).border = cellBorder2;
      currentRow += 2;

      ws.getRow(currentRow).height = 18;
      mergeAndStyle(currentRow, 2, 3, "HARCAMAYI YAPAN", "FFE0F2FE", { bold:true, name:"Arial", size:9 });
      mergeAndStyle(currentRow, 4, 5, "BİRİM YÖNETİCİSİ (PM)", "FFD1FAE5", { bold:true, name:"Arial", size:9 });
      mergeAndStyle(currentRow, 6, 7, "GENEL MÜDÜR", "FFFEF3C7", { bold:true, name:"Arial", size:9 });
      currentRow++;
      ws.getRow(currentRow).height = 30;
      mergeAndStyle(currentRow, 2, 3, form.talep_eden_ad, null, { name:"Arial", size:10 });
      const pmAd = form.pm_onay_tarihi ? `Orhan Bedir\n${new Date(form.pm_onay_tarihi).toLocaleDateString("tr-TR")}` : "—";
      const dirAd = form.direktor_onay_tarihi ? `Düzgün Şimşek\n${new Date(form.direktor_onay_tarihi).toLocaleDateString("tr-TR")}` : "—";
      mergeAndStyle(currentRow, 4, 5, pmAd, null, { name:"Arial", size:10 });
      mergeAndStyle(currentRow, 6, 7, dirAd, null, { name:"Arial", size:10 });
      currentRow++;
      ws.getRow(currentRow).height = 18;
      mergeAndStyle(currentRow, 2, 3, "Tarih / İmza", null, { italic:true, color:{ argb:"FF9CA3AF" }, name:"Arial", size:8 });
      mergeAndStyle(currentRow, 4, 5, form.pm_not||"", null, { italic:true, color:{ argb:"FF374151" }, name:"Arial", size:8 });
      mergeAndStyle(currentRow, 6, 7, form.direktor_not||"", null, { italic:true, color:{ argb:"FF374151" }, name:"Arial", size:8 });

      ws.views = [{ state:"frozen", xSplit:0, ySplit:3, topLeftCell:"A4", showGridLines: false }];
    }

    const donemSafe = donem.replace(/[^0-9\-]/g,"");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="masraf_formlar_${donemSafe}.xlsx"; filename*=UTF-8''masraf_formlar_${donemSafe}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// MALZEME YÖNETİMİ API
// ─────────────────────────────────────────────────────────────────────────────

// GET /malzeme/fiyat-listesi
app.get("/malzeme/fiyat-listesi", authMiddleware, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM malzeme_fiyat_listesi ORDER BY kategori, malzeme_adi");
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /malzeme/fiyat-listesi

app.post("/malzeme/fiyat-listesi", authMiddleware, async (req, res) => {
  try {
    const { malzeme_adi, birim, birim_fiyat, kategori } = req.body;
    const r = await pool.query(
      `INSERT INTO malzeme_fiyat_listesi (malzeme_adi, birim, birim_fiyat, kategori)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [malzeme_adi, birim || "Adet", birim_fiyat || 0, kategori || "Genel"]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /malzeme/fiyat-listesi/:id
app.put("/malzeme/fiyat-listesi/:id", authMiddleware, async (req, res) => {
  try {
    const { malzeme_adi, birim, birim_fiyat, kategori } = req.body;
    const r = await pool.query(
      `UPDATE malzeme_fiyat_listesi SET malzeme_adi=$1, birim=$2, birim_fiyat=$3, kategori=$4
       WHERE id=$5 RETURNING *`,
      [malzeme_adi, birim, birim_fiyat, kategori, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /malzeme/fiyat-listesi/:id
app.delete("/malzeme/fiyat-listesi/:id", authMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM malzeme_fiyat_listesi WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /malzeme/talepler
app.get("/malzeme/talepler", authMiddleware, async (req, res) => {
  try {
    const { email, name } = req.query;
    let whereClause = "";
    let params = [];

    if (email) {
      const normTr = s => (s||'').toLowerCase()
        .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ğ/g,'g')
        .replace(/ü/g,'u').replace(/ş/g,'s').replace(/ö/g,'o').replace(/ç/g,'c');

      // Try to find personel_id by email or name
      let personelId = null;
      if (email.includes('@')) {
        const pr = await pool.query(
          `SELECT id FROM personel WHERE LOWER(TRIM(email))=LOWER(TRIM($1)) AND aktif=true LIMIT 1`, [email]
        );
        personelId = pr.rows[0]?.id || null;
      }
      if (!personelId && name) {
        const normName = normTr(name.trim());
        const pr = await pool.query(
          `SELECT id FROM personel WHERE aktif=true
             AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
               TRIM(ad_soyad),'İ','I'),'Ş','S'),'Ğ','G'),'Ü','U'),'Ö','O'),'Ç','C'))
               = REPLACE($1,'ı','i') LIMIT 1`,
          [normName]
        );
        personelId = pr.rows[0]?.id || null;
      }

      if (personelId) {
        // Hem kendi açtıkları hem de kendisine açılanlar
        whereClause = `WHERE LOWER(t.talep_eden_email)=LOWER($1) OR t.talep_edilen_personel=$2`;
        params = [email, String(personelId)];
      } else {
        whereClause = `WHERE LOWER(t.talep_eden_email)=LOWER($1)`;
        params = [email];
      }
    }

    const r = await pool.query(
      `SELECT t.*,
        COALESCE((SELECT SUM(k.toplam_tutar) FROM malzeme_talep_kalemleri k WHERE k.talep_id = t.id),0) AS toplam_tutar,
        COALESCE((SELECT COUNT(*) FROM malzeme_talep_kalemleri k WHERE k.talep_id = t.id),0) AS kalem_sayisi
       FROM malzeme_talepler t
       ${whereClause}
       ORDER BY t.created_at DESC`,
      params
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /malzeme/talepler/:id
app.get("/malzeme/talepler/:id", authMiddleware, async (req, res) => {
  try {
    const t = await pool.query("SELECT * FROM malzeme_talepler WHERE id=$1", [req.params.id]);
    const k = await pool.query("SELECT * FROM malzeme_talep_kalemleri WHERE talep_id=$1 ORDER BY id", [req.params.id]);
    res.json({ ...t.rows[0], kalemler: k.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /malzeme/talepler
app.post("/malzeme/talepler", authMiddleware, async (req, res) => {
  try {
    const { talep_eden_email, talep_eden_ad, notlar, kalemler, durum: istenenDurum,
            bolge, proje, site_type, site_id, talep_edilen_personel, talep_edilen_firma, talep_tarihi } = req.body;
    const yil = new Date().getFullYear();
    const sayac = await pool.query(
      "SELECT COUNT(*)+1 AS sira FROM malzeme_talepler WHERE EXTRACT(YEAR FROM created_at)=$1", [yil]
    );
    const talep_no = `MT-${yil}-${String(sayac.rows[0].sira).padStart(3,"0")}`;
    const durum = istenenDurum || "TASLAK";
    const t = await pool.query(
      `INSERT INTO malzeme_talepler
         (talep_no, talep_eden_email, talep_eden_ad, durum, notlar,
          bolge, proje, site_type, site_id, talep_edilen_personel, talep_edilen_firma, talep_tarihi)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [talep_no, talep_eden_email, talep_eden_ad, durum, notlar||"",
       bolge||"", proje||"", site_type||"", site_id||"", talep_edilen_personel||"", talep_edilen_firma||"",
       talep_tarihi || new Date().toISOString().split("T")[0]]
    );
    const tId = t.rows[0].id;
    if (Array.isArray(kalemler)) {
      for (const k of kalemler) {
        await pool.query(
          `INSERT INTO malzeme_talep_kalemleri (talep_id, malzeme_adi, miktar, birim, birim_fiyat, toplam_tutar, temin_turu, notlar)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [tId, k.malzeme_adi, k.miktar, k.birim||"Adet", k.birim_fiyat||0,
           k.toplam_tutar||(k.miktar*(k.birim_fiyat||0)), k.temin_turu||"", k.notlar||""]
        );
      }
    }
    // Fiyat listesine yeni fiyat varsa güncelle
    for (const k of (kalemler||[])) {
      if (k.birim_fiyat && Number(k.birim_fiyat) > 0) {
        await pool.query(
          `UPDATE malzeme_fiyat_listesi SET birim_fiyat=$1 WHERE LOWER(malzeme_adi)=LOWER($2)`,
          [k.birim_fiyat, k.malzeme_adi]
        ).catch(()=>{});
      }
    }
    res.json(t.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /malzeme/talepler/:id (talebi güncelle - taslak düzenleme)
app.put("/malzeme/talepler/:id", authMiddleware, async (req, res) => {
  try {
    const { notlar, kalemler, durum: istenenDurum,
            bolge, proje, site_type, site_id, talep_edilen_personel, talep_edilen_firma, talep_tarihi } = req.body;
    const durum = istenenDurum || "TASLAK";
    await pool.query(
      `UPDATE malzeme_talepler SET durum=$1, notlar=$2, bolge=$3, proje=$4, site_type=$5, site_id=$6,
       talep_edilen_personel=$7, talep_edilen_firma=$8, talep_tarihi=$9
       WHERE id=$10`,
      [durum, notlar||"", bolge||"", proje||"", site_type||"", site_id||"",
       talep_edilen_personel||"", talep_edilen_firma||"",
       talep_tarihi||new Date().toISOString().split("T")[0], req.params.id]
    );
    // kalem güncelle
    if (Array.isArray(kalemler)) {
      await pool.query("DELETE FROM malzeme_talep_kalemleri WHERE talep_id=$1", [req.params.id]);
      for (const k of kalemler) {
        await pool.query(
          `INSERT INTO malzeme_talep_kalemleri (talep_id, malzeme_adi, miktar, birim, birim_fiyat, toplam_tutar, temin_turu, notlar)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [req.params.id, k.malzeme_adi, k.miktar, k.birim||"Adet", k.birim_fiyat||0,
           k.toplam_tutar||(k.miktar*(k.birim_fiyat||0)), k.temin_turu||"", k.notlar||""]
        );
      }
      for (const k of kalemler) {
        if (k.birim_fiyat && Number(k.birim_fiyat) > 0) {
          await pool.query(
            `UPDATE malzeme_fiyat_listesi SET birim_fiyat=$1 WHERE LOWER(malzeme_adi)=LOWER($2)`,
            [k.birim_fiyat, k.malzeme_adi]
          ).catch(()=>{});
        }
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /malzeme/ara?q=... — malzeme adı autocomplete (fiyat listesi + geçmiş taleplerden)
app.get("/malzeme/ara", authMiddleware, async (req, res) => {
  try {
    const q = `%${(req.query.q || "").toUpperCase()}%`;
    const r = await pool.query(`
      SELECT malzeme_adi, birim, birim_fiyat
      FROM malzeme_fiyat_listesi
      WHERE UPPER(malzeme_adi) LIKE $1
      UNION
      SELECT DISTINCT malzeme_adi, birim, NULL AS birim_fiyat
      FROM malzeme_talep_kalemleri
      WHERE UPPER(malzeme_adi) LIKE $1
        AND malzeme_adi IS NOT NULL AND malzeme_adi != ''
        AND NOT EXISTS (
          SELECT 1 FROM malzeme_fiyat_listesi fl
          WHERE UPPER(fl.malzeme_adi) = UPPER(malzeme_talep_kalemleri.malzeme_adi)
        )
      ORDER BY malzeme_adi
      LIMIT 15
    `, [q]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /malzeme/site-codes — rollout_progress'teki tüm site kodları (autocomplete için)
app.get("/malzeme/site-codes", authMiddleware, async (req, res) => {
  try {
    const q = req.query.q ? `%${req.query.q.toUpperCase()}%` : "%";
    const r = await pool.query(
      `SELECT DISTINCT site_code, site_type, bolge, project_code
       FROM rollout_progress
       WHERE site_code IS NOT NULL AND site_code != ''
         AND UPPER(site_code) LIKE $1
       ORDER BY site_code
       LIMIT 20`,
      [q]
    );
    res.json(r.rows);
  } catch (e) { res.json([]); }
});

// DELETE /malzeme/talepler/:id — talebi sil (sadece TASLAK veya REDDEDILDI)
app.delete("/malzeme/talepler/:id", authMiddleware, async (req, res) => {
  try {
    const t = await pool.query("SELECT * FROM malzeme_talepler WHERE id=$1", [req.params.id]);
    if (!t.rows.length) return res.status(404).json({ error: "Bulunamadı" });
    const durum = t.rows[0].durum;
    if (!["TASLAK","REDDEDILDI"].includes(durum)) {
      return res.status(400).json({ error: "Sadece Taslak veya Reddedildi talepler silinebilir" });
    }
    await pool.query("DELETE FROM malzeme_talep_kalemleri WHERE talep_id=$1", [req.params.id]);
    await pool.query("DELETE FROM malzeme_talepler WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// GET /malzeme/bekleyen-count (rol bazlı bildirim sayısı)
app.get("/malzeme/bekleyen-count", authMiddleware, async (req, res) => {
  try {
    const role = (req.user?.role || "").toLowerCase();
    const email = (req.user?.email || "").toLowerCase();
    let durum = "FIYAT_GIRISI"; // default: Murat
    if (role === "rollout_mudur" || role === "bolge_mudur") durum = "ROLLOUT_BEKLE";
    else if (email === "orhan.bedir@simsektel.com") durum = "PM_ONAY";
    else if (email === "duzgun.simsek@simsektel.com") durum = "DUZGUN_ONAY";
    const r = await pool.query(
      "SELECT COUNT(*) FROM malzeme_talepler WHERE durum=$1", [durum]
    );
    res.json({ count: Number(r.rows[0].count) });
  } catch (e) { res.json({ count: 0 }); }
});

// PUT /malzeme/talepler/:id/durum  – durum güncelle + isteğe bağlı kalem güncelleme
app.put("/malzeme/talepler/:id/durum", authMiddleware, async (req, res) => {
  try {
    const { durum, notlar, kalemler, onay_notu } = req.body;
    const fields = ["durum=$1"];
    const vals = [durum];
    let idx = 2;
    if (notlar !== undefined) { fields.push(`notlar=$${idx++}`); vals.push(notlar); }
    if (onay_notu !== undefined) { fields.push(`onay_notu=$${idx++}`); vals.push(onay_notu); }
    vals.push(req.params.id);
    await pool.query(`UPDATE malzeme_talepler SET ${fields.join(",")} WHERE id=$${idx}`, vals);

    // Kalem fiyatları + temin türü + düzeltme güncelle (Murat aşaması)
    if (Array.isArray(kalemler)) {
      for (const k of kalemler) {
        await pool.query(
          `UPDATE malzeme_talep_kalemleri
           SET birim_fiyat=$1, toplam_tutar=$2, temin_turu=$3, notlar=$4,
               malzeme_adi=COALESCE(NULLIF($5,''), malzeme_adi),
               miktar=COALESCE(NULLIF($6::text,'')::numeric, miktar),
               birim=COALESCE(NULLIF($7,''), birim)
           WHERE id=$8`,
          [
            k.birim_fiyat||0,
            k.toplam_tutar||(k.miktar*(k.birim_fiyat||0)),
            k.temin_turu||"",
            k.notlar||"",
            k.malzeme_adi||"",
            k.miktar != null ? String(k.miktar) : "",
            k.birim||"",
            k.id
          ]
        );
      }
    }

    // Depo stok güncelle: DEPODA durumuna geçince Yeni Alım kalemlerini depoya ekle + fiyat geçmişi kaydet
    if (durum === "DEPODA") {
      // Talep no'yu al
      const talepInfo = await pool.query("SELECT talep_no FROM malzeme_talepler WHERE id=$1", [req.params.id]);
      const talepNo = talepInfo.rows[0]?.talep_no || null;
      const bugun = new Date().toISOString().split("T")[0];

      const kalemleriDB = await pool.query(
        "SELECT * FROM malzeme_talep_kalemleri WHERE talep_id=$1", [req.params.id]
      );
      for (const k of kalemleriDB.rows) {
        // Depo stok güncelle
        const existing = await pool.query(
          "SELECT id, toplam_miktar FROM depo_stok WHERE LOWER(malzeme_adi)=LOWER($1) AND LOWER(birim)=LOWER($2)",
          [k.malzeme_adi, k.birim]
        );
        if (existing.rows.length > 0) {
          await pool.query(
            "UPDATE depo_stok SET toplam_miktar=toplam_miktar+$1, updated_at=NOW() WHERE id=$2",
            [k.miktar, existing.rows[0].id]
          );
        } else {
          await pool.query(
            "INSERT INTO depo_stok (malzeme_adi, birim, toplam_miktar) VALUES ($1,$2,$3)",
            [k.malzeme_adi, k.birim, k.miktar]
          );
        }

        // Fiyat geçmişi kaydet (sadece fiyat girilmişse)
        if (k.birim_fiyat && Number(k.birim_fiyat) > 0) {
          await pool.query(
            `INSERT INTO malzeme_fiyat_gecmisi (malzeme_adi, birim, birim_fiyat, talep_id, talep_no, miktar, tarih)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [k.malzeme_adi, k.birim||"Adet", k.birim_fiyat, req.params.id, talepNo, k.miktar||1, bugun]
          );

          // Fiyat listesini güncelle: son_fiyat her zaman güncellenir, ilk_fiyat sadece boşsa
          const fiyatExist = await pool.query(
            "SELECT id, ilk_fiyat FROM malzeme_fiyat_listesi WHERE LOWER(malzeme_adi)=LOWER($1)",
            [k.malzeme_adi]
          );
          if (fiyatExist.rows.length > 0) {
            const row = fiyatExist.rows[0];
            await pool.query(
              `UPDATE malzeme_fiyat_listesi
               SET birim_fiyat=$1, son_fiyat=$1, son_fiyat_tarihi=$2,
                   ilk_fiyat=COALESCE(ilk_fiyat,$1),
                   ilk_fiyat_tarihi=COALESCE(ilk_fiyat_tarihi,$2)
               WHERE id=$3`,
              [k.birim_fiyat, bugun, fiyatExist.rows[0].id]
            );
          } else {
            // Fiyat listesinde yoksa ekle
            await pool.query(
              `INSERT INTO malzeme_fiyat_listesi (malzeme_adi, birim, birim_fiyat, kategori, ilk_fiyat, ilk_fiyat_tarihi, son_fiyat, son_fiyat_tarihi)
               VALUES ($1,$2,$3,'Genel',$3,$4,$3,$4)`,
              [k.malzeme_adi, k.birim||"Adet", k.birim_fiyat, bugun]
            );
          }
        }
      }
    }

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /malzeme/depo-stok
app.get("/malzeme/depo-stok", authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        d.*,
        COALESCE(SUM(CASE WHEN s.islem_turu='CIKIS' THEN s.miktar ELSE 0 END),0) AS personelde,
        COALESCE(SUM(CASE WHEN s.islem_turu='REZERVE' THEN s.miktar ELSE 0 END),0) AS rezerve,
        d.toplam_miktar
          - COALESCE(SUM(CASE WHEN s.islem_turu='CIKIS' THEN s.miktar ELSE 0 END),0)
          - COALESCE(SUM(CASE WHEN s.islem_turu='REZERVE' THEN s.miktar ELSE 0 END),0)
          AS depoda_kalan
      FROM depo_stok d
      LEFT JOIN sarf_kullanim s ON LOWER(s.malzeme_adi)=LOWER(d.malzeme_adi)
      GROUP BY d.id
      ORDER BY d.malzeme_adi
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /malzeme/fiyat-gecmisi — malzeme fiyat geçmişi
app.get("/malzeme/fiyat-gecmisi", authMiddleware, async (req, res) => {
  try {
    const { malzeme_adi } = req.query;
    if (!malzeme_adi) {
      // Tüm malzemelerin son 2 fiyatı (özet)
      const r = await pool.query(`
        SELECT DISTINCT ON (malzeme_adi) malzeme_adi, birim, birim_fiyat, talep_no, tarih
        FROM malzeme_fiyat_gecmisi
        ORDER BY malzeme_adi, tarih DESC, id DESC
      `);
      return res.json(r.rows);
    }
    const r = await pool.query(
      `SELECT * FROM malzeme_fiyat_gecmisi WHERE LOWER(malzeme_adi)=LOWER($1) ORDER BY tarih DESC, id DESC`,
      [malzeme_adi]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /malzeme/depo-stok (manuel stok girişi/düzenleme)
app.post("/malzeme/depo-stok", authMiddleware, async (req, res) => {
  try {
    const { malzeme_adi, birim, toplam_miktar, aciklama } = req.body;
    const existing = await pool.query(
      "SELECT id FROM depo_stok WHERE LOWER(malzeme_adi)=LOWER($1)", [malzeme_adi]
    );
    let r;
    if (existing.rows.length > 0) {
      r = await pool.query(
        "UPDATE depo_stok SET birim=$1, toplam_miktar=$2, aciklama=$3 WHERE id=$4 RETURNING *",
        [birim, toplam_miktar, aciklama, existing.rows[0].id]
      );
    } else {
      r = await pool.query(
        "INSERT INTO depo_stok (malzeme_adi, birim, toplam_miktar, aciklama) VALUES ($1,$2,$3,$4) RETURNING *",
        [malzeme_adi, birim||"Adet", toplam_miktar||0, aciklama||""]
      );
    }
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /malzeme/depo-stok/:id
app.put("/malzeme/depo-stok/:id", authMiddleware, async (req, res) => {
  try {
    const { toplam_miktar, birim, aciklama } = req.body;
    const r = await pool.query(
      "UPDATE depo_stok SET toplam_miktar=$1, birim=$2, aciklama=$3 WHERE id=$4 RETURNING *",
      [toplam_miktar, birim, aciklama, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /malzeme/sarf
app.get("/malzeme/sarf", authMiddleware, async (req, res) => {
  try {
    const { malzeme_adi } = req.query;
    let q = "SELECT * FROM sarf_kullanim";
    const params = [];
    if (malzeme_adi) { q += " WHERE LOWER(malzeme_adi)=LOWER($1)"; params.push(malzeme_adi); }
    q += " ORDER BY created_at DESC";
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /malzeme/sarf (personel stok çıkış/giriş/rezerve)
app.post("/malzeme/sarf", authMiddleware, async (req, res) => {
  try {
    const { malzeme_adi, miktar, personel_email, personel_ad, lokasyon, tarih, islem_turu, talep_id, notlar } = req.body;
    const r = await pool.query(
      `INSERT INTO sarf_kullanim (malzeme_adi, miktar, personel_email, personel_ad, lokasyon, tarih, islem_turu, talep_id, notlar)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [malzeme_adi, miktar, personel_email||"", personel_ad||"", lokasyon||"", tarih||new Date().toISOString().split("T")[0], islem_turu||"CIKIS", talep_id||null, notlar||""]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /malzeme/sarf/:id
app.delete("/malzeme/sarf/:id", authMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM sarf_kullanim WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MALZEME DAĞITIM SİSTEMİ ─────────────────────────────────────────────────

// GET /malzeme/dagitim — tüm dağıtım kayıtları (Murat/PM/admin görür)
app.get("/malzeme/dagitim", authMiddleware, async (req, res) => {
  try {
    const { personel_email, personel_ad, durum } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    let idx = 1;
    if (personel_email) {
      // email ile eşleştir VEYA users tablosundan bu email'e ait kişiyle eşleştir
      // Hem stored email hem de users tablosundaki email'e göre ara
      where += ` AND (
        LOWER(d.alici_personel_email) = LOWER($${idx})
        OR (d.alici_personel_email = '' AND LOWER(d.alici_personel_ad) = (
          SELECT LOWER(name) FROM users WHERE LOWER(email)=LOWER($${idx}) LIMIT 1
        ))
        OR (d.alici_personel_email = '' AND d.alici_personel_id IN (
          SELECT id FROM personel WHERE LOWER(email)=LOWER($${idx}) LIMIT 1
        ))
      )`;
      params.push(personel_email.toLowerCase());
      idx++;
    }
    if (personel_ad) {
      where += ` AND LOWER(d.alici_personel_ad) ILIKE LOWER($${idx++})`;
      params.push(`%${personel_ad}%`);
    }
    if (durum) {
      where += ` AND d.durum=$${idx++}`;
      params.push(durum);
    }
    const r = await pool.query(`
      SELECT d.*, t.talep_no, t.bolge as talep_bolge
      FROM malzeme_dagitim d
      LEFT JOIN malzeme_talepler t ON t.id = d.talep_id
      ${where}
      ORDER BY d.verilme_tarihi DESC, d.id DESC
    `, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /malzeme/dagitim — malzeme çıkışı yap (Murat yapar)
app.post("/malzeme/dagitim", authMiddleware, async (req, res) => {
  try {
    const {
      talep_id, malzeme_adi, miktar, birim,
      alici_tipi, alici_personel_id, alici_personel_ad, alici_personel_email,
      alici_firma, site_id, bolge, verilme_tarihi, notlar
    } = req.body;

    // Depo stoktan düş
    const stok = await pool.query(
      "SELECT id, toplam_miktar FROM depo_stok WHERE LOWER(malzeme_adi)=LOWER($1)",
      [malzeme_adi]
    );
    if (stok.rows.length > 0) {
      await pool.query(
        "UPDATE depo_stok SET toplam_miktar=GREATEST(0,toplam_miktar-$1), updated_at=NOW() WHERE id=$2",
        [miktar, stok.rows[0].id]
      );
    }

    const r = await pool.query(
      `INSERT INTO malzeme_dagitim
        (talep_id, malzeme_adi, miktar, birim, alici_tipi, alici_personel_id, alici_personel_ad, alici_personel_email, alici_firma, site_id, bolge, verilme_tarihi, notlar, durum, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PERSONELDE',$14) RETURNING *`,
      [talep_id||null, malzeme_adi, miktar, birim||"Adet",
       alici_tipi||"PERSONEL", alici_personel_id||null, alici_personel_ad||"", (alici_personel_email||"").toLowerCase(),
       alici_firma||"", site_id||"", bolge||"",
       verilme_tarihi||new Date().toISOString().split("T")[0], notlar||"",
       req.user?.email||""]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /malzeme/dagitim/:id/tutanak — tutanak URL güncelle
app.put("/malzeme/dagitim/:id/tutanak", authMiddleware, async (req, res) => {
  try {
    const { tutanak_url } = req.body;
    const r = await pool.query(
      "UPDATE malzeme_dagitim SET tutanak_url=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [tutanak_url, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /malzeme/dagitim/:id/saha-cikis — personel sahaya çıkış yapar (miktar ile)
app.put("/malzeme/dagitim/:id/saha-cikis", authMiddleware, async (req, res) => {
  try {
    const { saha_site_id, saha_kullanim_miktar, saha_notlar } = req.body;
    if (!saha_site_id) return res.status(400).json({ error: "Site ID zorunludur" });
    // Mevcut kaydı al
    const dag = await pool.query("SELECT * FROM malzeme_dagitim WHERE id=$1", [req.params.id]);
    if (!dag.rows.length) return res.status(404).json({ error: "Bulunamadı" });
    const d = dag.rows[0];
    const kullanilan = saha_kullanim_miktar ? Number(saha_kullanim_miktar) : d.miktar;
    if (kullanilan <= 0) return res.status(400).json({ error: "Miktar 0'dan büyük olmalı" });
    if (kullanilan > d.miktar) return res.status(400).json({ error: `Miktarı aşıyor (max: ${d.miktar})` });

    // Kullanılan miktarı SAHADA olarak güncelle
    const r = await pool.query(
      `UPDATE malzeme_dagitim
       SET durum='SAHADA', saha_site_id=$1, saha_cikis_tarihi=CURRENT_DATE,
           saha_kullanim_miktar=$2, saha_notlar=$3, updated_at=NOW()
       WHERE id=$4 RETURNING *`,
      [saha_site_id, kullanilan, saha_notlar||"", req.params.id]
    );

    // Eğer kalan varsa depoya geri ekle
    const kalan = d.miktar - kullanilan;
    if (kalan > 0) {
      const stok = await pool.query(
        "SELECT id FROM depo_stok WHERE LOWER(malzeme_adi)=LOWER($1)", [d.malzeme_adi]
      );
      if (stok.rows.length > 0) {
        await pool.query("UPDATE depo_stok SET toplam_miktar=toplam_miktar+$1, updated_at=NOW() WHERE id=$2", [kalan, stok.rows[0].id]);
      } else {
        await pool.query("INSERT INTO depo_stok (malzeme_adi, birim, toplam_miktar) VALUES ($1,$2,$3)", [d.malzeme_adi, d.birim, kalan]);
      }
    }

    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /malzeme/dagitim/:id/iade — personel depoya iade talebi gönderir (Murat onayına gider)
app.put("/malzeme/dagitim/:id/iade", authMiddleware, async (req, res) => {
  try {
    const { notlar, iade_miktar } = req.body;
    const dag = await pool.query("SELECT * FROM malzeme_dagitim WHERE id=$1", [req.params.id]);
    if (!dag.rows.length) return res.status(404).json({ error: "Bulunamadı" });
    const d = dag.rows[0];
    const miktar = iade_miktar ? Number(iade_miktar) : d.miktar;

    // Murat onayına gönder (stok henüz güncellenmez)
    const r = await pool.query(
      "UPDATE malzeme_dagitim SET durum='IADE_BEKLEMEDE', iade_miktar=$1, saha_notlar=$2, iade_talep_tarihi=NOW(), updated_at=NOW() WHERE id=$3 RETURNING *",
      [miktar, notlar||"", req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /malzeme/dagitim/:id/iade-onayla — Murat İstek iadeyi onaylar, stok güncellenir
app.put("/malzeme/dagitim/:id/iade-onayla", authMiddleware, async (req, res) => {
  try {
    const dag = await pool.query("SELECT * FROM malzeme_dagitim WHERE id=$1", [req.params.id]);
    if (!dag.rows.length) return res.status(404).json({ error: "Bulunamadı" });
    const d = dag.rows[0];
    if (d.durum !== "IADE_BEKLEMEDE") return res.status(400).json({ error: "Bu kayıt iade beklemede değil" });

    const iadeMiktar = d.iade_miktar || d.miktar;

    // Depoya geri ekle
    const stok = await pool.query(
      "SELECT id FROM depo_stok WHERE LOWER(malzeme_adi)=LOWER($1)", [d.malzeme_adi]
    );
    if (stok.rows.length > 0) {
      await pool.query("UPDATE depo_stok SET toplam_miktar=toplam_miktar+$1, updated_at=NOW() WHERE id=$2", [iadeMiktar, stok.rows[0].id]);
    } else {
      await pool.query("INSERT INTO depo_stok (malzeme_adi, birim, toplam_miktar) VALUES ($1,$2,$3)", [d.malzeme_adi, d.birim, iadeMiktar]);
    }

    const r = await pool.query(
      "UPDATE malzeme_dagitim SET durum='DEPOYA_IADE', iade_onay_tarihi=NOW(), updated_at=NOW() WHERE id=$2 RETURNING *",
      [req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /malzeme/dagitim/:id/iade-reddet — Murat İstek iadeyi reddeder
app.put("/malzeme/dagitim/:id/iade-reddet", authMiddleware, async (req, res) => {
  try {
    const { notlar } = req.body;
    const r = await pool.query(
      "UPDATE malzeme_dagitim SET durum='PERSONELDE', iade_miktar=NULL, saha_notlar=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [notlar||"", req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /malzeme/talepler/:id/kalem-dagitildi — kalem dağıtım tamamlandı işaretle
app.put("/malzeme/talepler/:id/kalem-dagitildi", authMiddleware, async (req, res) => {
  try {
    const { kalem_id } = req.body;
    if (!kalem_id) return res.status(400).json({ error: "kalem_id gerekli" });
    await pool.query(
      "UPDATE malzeme_talep_kalemleri SET dagitim_yapildi = true WHERE id = $1",
      [kalem_id]
    );
    // Tüm kalemler tamamlandıysa talebi DEPODA yap
    const kalemleri = await pool.query(
      "SELECT dagitim_yapildi FROM malzeme_talep_kalemleri WHERE talep_id = $1",
      [req.params.id]
    );
    const allDone = kalemleri.rows.length > 0 && kalemleri.rows.every(k => k.dagitim_yapildi);
    if (allDone) {
      await pool.query(
        "UPDATE malzeme_talepler SET durum = 'DEPODA', updated_at = NOW() WHERE id = $1",
        [req.params.id]
      );
    }
    res.json({ ok: true, allDone });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /malzeme/depo-stok-ekle — satın alınan malzemeyi depoya ekle
app.post("/malzeme/depo-stok-ekle", authMiddleware, async (req, res) => {
  try {
    const { malzeme_adi, birim, miktar } = req.body;
    if (!malzeme_adi || !miktar) return res.status(400).json({ error: "malzeme_adi ve miktar gerekli" });
    const existing = await pool.query(
      "SELECT id FROM depo_stok WHERE LOWER(malzeme_adi) = LOWER($1)",
      [malzeme_adi]
    );
    if (existing.rows.length > 0) {
      await pool.query(
        "UPDATE depo_stok SET toplam_miktar = toplam_miktar + $1, updated_at = NOW() WHERE id = $2",
        [miktar, existing.rows[0].id]
      );
    } else {
      await pool.query(
        "INSERT INTO depo_stok (malzeme_adi, birim, toplam_miktar) VALUES ($1, $2, $3)",
        [malzeme_adi, birim || "Adet", miktar]
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /malzeme/dagitim/ozet — personel bazlı özet (Murat Excel için)
app.get("/malzeme/dagitim/ozet", authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        COALESCE(alici_personel_ad, alici_firma, 'Bilinmiyor') as alici,
        alici_tipi, alici_personel_email, alici_firma,
        malzeme_adi, birim,
        SUM(CASE WHEN durum='PERSONELDE' THEN miktar ELSE 0 END) as personelde,
        SUM(CASE WHEN durum='SAHADA' THEN miktar ELSE 0 END) as sahada,
        SUM(CASE WHEN durum='DEPOYA_IADE' THEN miktar ELSE 0 END) as iade,
        MIN(verilme_tarihi) as ilk_verilme,
        MAX(verilme_tarihi) as son_verilme
      FROM malzeme_dagitim
      GROUP BY alici, alici_tipi, alici_personel_email, alici_firma, malzeme_adi, birim
      HAVING SUM(CASE WHEN durum='PERSONELDE' THEN miktar ELSE 0 END) > 0
         OR  SUM(CASE WHEN durum='SAHADA' THEN miktar ELSE 0 END) > 0
      ORDER BY alici, malzeme_adi
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Otomatik migration: her deploy/restart'ta eksik kolonları ekle ──
const AUTO_MIGRATIONS = [
  // ── Malzeme Yönetimi tabloları ──
  `CREATE TABLE IF NOT EXISTS malzeme_fiyat_listesi (
    id SERIAL PRIMARY KEY,
    malzeme_adi TEXT NOT NULL,
    birim TEXT NOT NULL DEFAULT 'Adet',
    birim_fiyat NUMERIC(12,2) DEFAULT 0,
    kategori TEXT DEFAULT 'Genel',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS malzeme_talepler (
    id SERIAL PRIMARY KEY,
    talep_no TEXT UNIQUE,
    talep_eden_email TEXT,
    talep_eden_ad TEXT,
    durum TEXT DEFAULT 'NURCAN_ONAY',
    notlar TEXT,
    onay_notu TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS malzeme_talep_kalemleri (
    id SERIAL PRIMARY KEY,
    talep_id INTEGER REFERENCES malzeme_talepler(id) ON DELETE CASCADE,
    malzeme_adi TEXT,
    miktar NUMERIC(12,3),
    birim TEXT DEFAULT 'Adet',
    birim_fiyat NUMERIC(12,2) DEFAULT 0,
    toplam_tutar NUMERIC(12,2) DEFAULT 0,
    temin_turu TEXT DEFAULT '',
    notlar TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS depo_stok (
    id SERIAL PRIMARY KEY,
    malzeme_adi TEXT NOT NULL,
    birim TEXT DEFAULT 'Adet',
    toplam_miktar NUMERIC(12,3) DEFAULT 0,
    aciklama TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS sarf_kullanim (
    id SERIAL PRIMARY KEY,
    malzeme_adi TEXT,
    miktar NUMERIC(12,3),
    personel_email TEXT,
    personel_ad TEXT,
    lokasyon TEXT,
    tarih DATE,
    islem_turu TEXT DEFAULT 'CIKIS',
    talep_id INTEGER,
    notlar TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  "ALTER TABLE malzeme_talepler ADD COLUMN IF NOT EXISTS onay_notu TEXT",
  "ALTER TABLE malzeme_talepler ADD COLUMN IF NOT EXISTS bolge TEXT",
  "ALTER TABLE malzeme_talepler ADD COLUMN IF NOT EXISTS proje TEXT",
  "ALTER TABLE malzeme_talepler ADD COLUMN IF NOT EXISTS site_type TEXT",
  "ALTER TABLE malzeme_talepler ADD COLUMN IF NOT EXISTS talep_edilen_personel TEXT",
  "ALTER TABLE malzeme_talepler ADD COLUMN IF NOT EXISTS talep_edilen_firma TEXT",
  "ALTER TABLE malzeme_talepler ADD COLUMN IF NOT EXISTS talep_tarihi DATE DEFAULT CURRENT_DATE",
  "ALTER TABLE malzeme_talepler ADD COLUMN IF NOT EXISTS site_id TEXT",
  // ── Rollout progress kolonları ──
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS bolge TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS il TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS site_physical_type TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS project_code TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS malzeme_status TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS plan_start_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS installation_actual_start_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS installation_actual_end_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS onair_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS rf_not TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS atlas_status TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS qc_durum TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS qc_closed_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS los_subcon TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS los_plan_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS los_actual_end_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS los_belge_url TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tss_subcon TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tss_plan_start_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tss_actual_end_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tssr_subcon TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tssr_plan_start_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tssr_actual_end_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tssr_belge_url TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS btk_subcon TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS btk_plan_start_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS btk_actual_end_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS btk_approved TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS btk_certificate_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS btk_belge_url TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS gs_status TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS survey_note TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS emr_subcon TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS emr_plan_start_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS emr_actual_end_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS emr_belge_url TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS trs_subcon TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS trs_plan_start_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS trs_actual_end_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS trs_not TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_site_type TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_subcon TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_plan_start_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_actual_end_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_not TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_proje_subcon TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_proje_hazir DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_proje_not TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_proje_belge_url TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS enh_qc_closed_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS suzme_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS power_subcon TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS power_plan_start_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS power_actual_end_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS abonelik_actual_end_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS abonelik_end_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tt_horizon_actual_end_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS pac_subcon TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS pac_plan_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS pac_actual_end_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS pac_belge_url TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tamamlanma_tarihi DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS qc_closed_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
  // ── Malzeme dağıtım yeni kolonlar ──
  "ALTER TABLE malzeme_dagitim ADD COLUMN IF NOT EXISTS saha_kullanim_miktar NUMERIC(12,3)",
  "ALTER TABLE malzeme_dagitim ADD COLUMN IF NOT EXISTS iade_miktar NUMERIC(12,3)",
  "ALTER TABLE malzeme_dagitim ADD COLUMN IF NOT EXISTS iade_talep_tarihi TIMESTAMP",
  "ALTER TABLE malzeme_dagitim ADD COLUMN IF NOT EXISTS iade_onay_tarihi TIMESTAMP",
  // ── Trafik Ceza kolonları ──
  "ALTER TABLE masraf_kalem ADD COLUMN IF NOT EXISTS plaka TEXT",
  "ALTER TABLE masraf_kalem ADD COLUMN IF NOT EXISTS ceza_personel_id INTEGER",
  "ALTER TABLE masraf_kalem ADD COLUMN IF NOT EXISTS ceza_belge_url TEXT",
  "ALTER TABLE masraf_kalem ADD COLUMN IF NOT EXISTS odeme_belge_url TEXT",
  "ALTER TABLE masraf_kalem ADD COLUMN IF NOT EXISTS ceza_sirket BOOLEAN DEFAULT FALSE",
  "ALTER TABLE masraf_kalem ADD COLUMN IF NOT EXISTS maastan_kesildi BOOLEAN DEFAULT FALSE",
  "ALTER TABLE masraf_kalem ADD COLUMN IF NOT EXISTS kesildi_tarihi DATE",
  "ALTER TABLE masraf_kalem ADD COLUMN IF NOT EXISTS kesildi_donem TEXT",
  `CREATE TABLE IF NOT EXISTS malzeme_fiyat_gecmisi (
  id SERIAL PRIMARY KEY,
  malzeme_adi TEXT NOT NULL,
  birim TEXT DEFAULT 'Adet',
  birim_fiyat NUMERIC(12,2) NOT NULL,
  talep_id INTEGER,
  talep_no TEXT,
  miktar NUMERIC(12,3),
  tarih DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`,
  "ALTER TABLE malzeme_fiyat_listesi ADD COLUMN IF NOT EXISTS ilk_fiyat NUMERIC(12,2) DEFAULT NULL",
  "ALTER TABLE malzeme_fiyat_listesi ADD COLUMN IF NOT EXISTS ilk_fiyat_tarihi DATE DEFAULT NULL",
  "ALTER TABLE malzeme_fiyat_listesi ADD COLUMN IF NOT EXISTS son_fiyat NUMERIC(12,2) DEFAULT NULL",
  "ALTER TABLE malzeme_fiyat_listesi ADD COLUMN IF NOT EXISTS son_fiyat_tarihi DATE DEFAULT NULL",
  // Malzeme dağıtım sistemi
  `CREATE TABLE IF NOT EXISTS malzeme_dagitim (
  id SERIAL PRIMARY KEY,
  talep_id INTEGER REFERENCES malzeme_talepler(id) ON DELETE SET NULL,
  malzeme_adi TEXT NOT NULL,
  miktar NUMERIC(12,3) NOT NULL,
  birim TEXT DEFAULT 'Adet',
  alici_tipi TEXT NOT NULL DEFAULT 'PERSONEL',  -- 'PERSONEL' veya 'TASERON'
  alici_personel_id INTEGER,
  alici_personel_ad TEXT,
  alici_personel_email TEXT,
  alici_firma TEXT,
  site_id TEXT,
  bolge TEXT,
  verilme_tarihi DATE DEFAULT CURRENT_DATE,
  tutanak_url TEXT,
  durum TEXT DEFAULT 'PERSONELDE',  -- 'PERSONELDE', 'SAHADA', 'DEPOYA_IADE'
  saha_site_id TEXT,
  saha_cikis_tarihi DATE,
  saha_notlar TEXT,
  notlar TEXT,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`,
  "ALTER TABLE malzeme_talepler ADD COLUMN IF NOT EXISTS talep_tipi TEXT DEFAULT 'SATIN_ALMA'",
  "ALTER TABLE malzeme_talep_kalemleri ADD COLUMN IF NOT EXISTS dagitim_yapildi BOOLEAN DEFAULT FALSE",
  // ── Personel ISG / RFQ alanları ──
  "ALTER TABLE personel ADD COLUMN IF NOT EXISTS ekip_bilgisi TEXT",
  "ALTER TABLE personel ADD COLUMN IF NOT EXISTS alt_yuklenici TEXT",
  "ALTER TABLE personel ADD COLUMN IF NOT EXISTS firma_tipi TEXT DEFAULT 'simsek'",
  "ALTER TABLE personel ADD COLUMN IF NOT EXISTS isdp_account TEXT",
  "ALTER TABLE personel ADD COLUMN IF NOT EXISTS iresource_giris TEXT",
  "ALTER TABLE personel ADD COLUMN IF NOT EXISTS kkd_zimmet_tarihi DATE",
  "ALTER TABLE personel ADD COLUMN IF NOT EXISTS mesleki_yeterlilik_durum TEXT",
  "ALTER TABLE personel ADD COLUMN IF NOT EXISTS mesleki_yeterlilik_tarihi DATE",
  "ALTER TABLE personel ADD COLUMN IF NOT EXISTS elektrik_isi BOOLEAN DEFAULT FALSE",
  "ALTER TABLE personel ADD COLUMN IF NOT EXISTS yuksekte_calisma BOOLEAN DEFAULT FALSE",
  "ALTER TABLE personel ADD COLUMN IF NOT EXISTS arac_kullanim BOOLEAN DEFAULT FALSE",
  "ALTER TABLE invoice_entries ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'TRY'",
  "ALTER TABLE invoice_entries ADD COLUMN IF NOT EXISTS usd_kur NUMERIC(12,4) DEFAULT 1",
  "UPDATE users SET role='rollout_mudur' WHERE LOWER(email)='nurcan.kus@simsektel.com' AND role='muhasebe'",
  "ALTER TABLE po_rows ADD COLUMN IF NOT EXISTS po_line_no TEXT",
  "ALTER TABLE po_rows ADD COLUMN IF NOT EXISTS shipment_no TEXT",
];

(async () => {
  try {
    for (const sql of AUTO_MIGRATIONS) {
      await pool.query(sql).catch(() => {});
    }
    console.log("✅ Auto-migrations tamamlandı");

    // Finans paneli kullanıcıları — bireysel şifre ile
    const FINANCE_USERS_SEED = [
      { name: "Nurcan Kuş", email: "nurcan.kus@simsektel.com", password: "$2b$10$90Grc3rIvK0U6a2GCybeS.15rjIYq9NK47ozNYuZE5kTgrsRJInCe" },
    ];
    for (const u of FINANCE_USERS_SEED) {
      await pool.query(
        `INSERT INTO users (name, email, password_hash, role, is_active)
         VALUES ($1, $2, $3, 'rollout_mudur', true)
         ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               is_active = true`,
        // Rol GÜNCELLENMEZ — admin panelden değiştirilebilsin
        [u.name, u.email.toLowerCase(), u.password],
      ).catch(() => {});
    }
    console.log("✅ Finance kullanıcıları hazır");
  } catch (e) {
    console.error("Migration hatası:", e.message);
  }
})();

// ─── MALZEME FİYAT LİSTESİ SEED (189 malzeme) ────────────────────────────────
(async () => {
  try {
    const count = await pool.query("SELECT COUNT(*) FROM malzeme_fiyat_listesi");
    if (Number(count.rows[0].count) === 0) {
      const MALZEME_SEED = [
        '10M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )',
        '20M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )',
        '30M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )',
        '40M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )',
        '50M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )',
        '60M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )',
        '70M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )',
        '80M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )',
        '90M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )',
        '100M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )',
        '110M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )',
        '120M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )',
        '130M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )',
        '140M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )',
        '150M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )',
        '3M LC-LC PATCH CORT OPTİK ( SİNGLE MOD ) ( SARI )',
        '5M LC-LC PATCH CORT OPTİK ( SİNGLE MOD )( SARI )',
        '10M LC-LC PATCH CORT OPTİK ( SİNGLE MOD )( SARI )',
        '3M SC-LC PATCH CORT OPTİK ( SİNGLE MOD )( SARI )',
        '5M SC-LC PATCH CORT OPTİK ( SİNGLE MOD )( SARI )',
        '10M SC-LC PATCH CORT OPTİK ( SİNGLE MOD )( SARI )',
        '3M SC-SC PATCH CORT OPTİK( SİNGLE MOD )( SARI )',
        '5M SC-SC PATCH CORT OPTİK ( SİNGLE MOD )( SARI )',
        '10M SC-SC PATCH CORT OPTİK ( SİNGLE MOD )( SARI )',
        '3M 7-16 / 7-16 ( KALIN-KALIN ) JUMPER',
        '4M 7-16 / 7-16 ( KALIN-KALIN ) JUMPER',
        '5M 7-16 / 7-16 ( KALIN-KALIN ) JUMPER',
        '6M 7-16 / 7-16 ( KALIN-KALIN ) JUMPER',
        '8M 7-16 / 7-16 ( KALIN-KALIN ) JUMPER',
        '10M 7-16 / 7-16 ( KALIN-KALIN ) JUMPER',
        '3M 4,3-10 / 7-16 ( KALIN-İNCE ) JUMPER',
        '4M 4,3-10 / 7-16 ( KALIN-İNCE ) JUMPER',
        '5M 4,3-10 / 7-16 ( KALIN-İNCE ) JUMPER',
        '6M 4,3-10 / 7-16 ( KALIN-İNCE ) JUMPER',
        '8M 4,3-10 / 7-16 ( KALIN-İNCE ) JUMPER',
        '10M 4,3-10 / 7-16 ( KALIN-İNCE ) JUMPER',
        '3M 4,3-10 / 4,3-10 ( İNCE-İNCE ) JUMPER',
        '4M 4,3-10 / 4,3-10 ( İNCE-İNCE ) JUMPER',
        '5M 4,3-10 / 4,3-10 ( İNCE-İNCE ) JUMPER',
        '6M 4,3-10 / 4,3-10 ( İNCE-İNCE ) JUMPER',
        '8M 4,3-10 / 4,3-10 ( İNCE-İNCE ) JUMPER',
        '10M 4,3-10 / 4,3-10 ( İNCE-İNCE ) JUMPER',
        '2x6 DC TTR ENERJİ KABLOSU ( HUAWEİ TİPİ ) ( SİYAH-YUMUŞAK )',
        '2x10 DC TTR ENERJİ KABLOSU ( HUAWEİ TİPİ )( SİYAH-YUMUŞAK )',
        '2x16 DC TTR ENERJİ KABLOSU ( HUAWEİ TİPİ )( SİYAH-YUMUŞAK )',
        '2x25 DC TTR ENERJİ KABLOSU ( HUAWEİ TİPİ )( SİYAH-YUMUŞAK )',
        '1X50 DC ENERJİ KABLOSU ( ERICSSON TİPİ ) ( SİYAH )( H07RN-F )',
        '1X35mm NYAF TOPRAK KABLOSU ( BAKIR )',
        '1X50mm NYAF TOPRAK KABLOSU ( BAKIR )',
        '1X16MM NYAF MAVİ TOPRAK KABLOSU ( BAKIR )',
        '1X16MM NYAF SİYAH TOPRAK KABLOSU ( BAKIR )',
        'MKS-03',
        '16mm TOPRAKLAMA PABUCU',
        '25mm TOPRAKLAMA PABUCU',
        '35mm TOPRAKLAMA PABUCU',
        '50mm TOPRAKLAMA PABUCU',
        'AVEA TİPİ YUMA ASMA KİLİT',
        'AVEA TİPİ YUMA BAREL',
        '2x1,5 TTR KABLO',
        '3x1,5 TTR KABLO',
        '3x2,5 TTR KABLO',
        '4x1,5 TTR KABLO',
        '4x2,5 TTR KABLO',
        'CAT6 KABLO',
        '3M HAZIR ÇAKILI CAT6 KABLO',
        '5M HAZIR ÇAKILI CAT6 KABLO',
        '4x6 NYY KABLO',
        '4x10 NYY KABLO',
        '4x16 NYY KABLO',
        '4 LÜK YÜKSÜK',
        '6 LIK YÜKSÜK',
        '10 LUK YÜKSÜK',
        '16 LIK YÜKSÜK',
        '25 LİK YÜKSÜK',
        '35 LİK YÜKSÜK',
        '50 LİK YÜKSÜK',
        'AVEA TİPİ 2G 900 MARKİNG',
        'AVEA TİPİ 2G 1800 MARKİNG',
        'AVEA TİPİ 3G 900 MARKİNG',
        'AVEA TİPİ 3G 2100 MARKİNG',
        'AVEA TİPİ LTE 800 MARKİNG',
        'AVEA TİPİ LTE 1800 MARKİNG',
        'AVEA TİPİ LTE 2600 MARKİNG',
        'ROXTEK ( 16/18 ) ( 34 LÜK KİT )',
        '1/2 NORMAL FEEDERE GÖRE DÜZ 7,16 ( KALIN ) DİŞİ KONNEKTÖR',
        '1/2 NORMAL FEEDERE GÖRE DÜZ 7,16 ( KALIN ) ERKEK KONNEKTÖR',
        '1/2 FLEXİ FEEDERE GÖRE DÜZ 7,16 ( KALIN ) DİŞİ KONNEKTÖR',
        '1/2 FLEXİ FEEDERE GÖRE DÜZ 7,16 ( KALIN ) ERKEK KONNEKTÖR',
        '1/2 NORMAL FEEDERE GÖRE DÜZ 4,3-10 ( İNCE ) DİŞİ KONNEKTÖR',
        '1/2 NORMAL FEEDERE GÖRE DÜZ 4,3-10 ( İNCE ) ERKEK KONNEKTÖR',
        '1/2 FLEXİ FEEDERE GÖRE DÜZ 4,3-10 ( İNCE ) DİŞİ KONNEKTÖR',
        '1/2 FLEXİ FEEDERE GÖRE DÜZ 4,3-10 ( İNCE ) ERKEK KONNEKTÖR',
        '1/2 NORMAL FEEDERE GÖRE DÜZ N TYPE DİŞİ KONNEKTÖR',
        '1/2 NORMAL FEEDERE GÖRE DÜZ N TYPE ERKEK KONNEKTÖR',
        '1/2 FLEXİ FEEDERE GÖRE DÜZ N TYPE DİŞİ KONNEKTÖR',
        '1/2 FLEXİ FEEDERE GÖRE DÜZ N TYPE ERKEK KONNEKTÖR',
        'DIŞ RACK ( TAKIM )',
        'İÇ RACK ( TAKIM )',
        'COLD SHİRİNG',
        '7/8 FEEDER KABLO',
        '1/2 FEEDER KABLO',
        "1M 2,5'' GALVANİZ BORU",
        "2M 2,5'' GALVANİZ BORU",
        "2,5M 2,5'' GALVANİZ BORU",
        "3M 2,5'' GALVANİZ BORU",
        '10 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 2 TARAFI DA 2,5 İNÇ BORUYA GÖRE )',
        '20 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 2 TARAFI DA 2,5 İNÇ BORUYA GÖRE )',
        '30 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 2 TARAFI DA 2,5 İNÇ BORUYA GÖRE )',
        '40 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 2 TARAFI DA 2,5 İNÇ BORUYA GÖRE )',
        '50 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 2 TARAFI DA 2,5 İNÇ BORUYA GÖRE )',
        '10 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 1 TARAFI 2,5 İNÇ BORU- DİĞER TARAFI 4 İNÇ BORUYA GÖRE )',
        '20 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 1 TARAFI 2,5 İNÇ BORU- DİĞER TARAFI 4 İNÇ BORUYA GÖRE )',
        '30 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 1 TARAFI 2,5 İNÇ BORU- DİĞER TARAFI 4 İNÇ BORUYA GÖRE )',
        '40 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 1 TARAFI 2,5 İNÇ BORU- DİĞER TARAFI 4 İNÇ BORUYA GÖRE )',
        '50 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 1 TARAFI 2,5 İNÇ BORU- DİĞER TARAFI 4 İNÇ BORUYA GÖRE )',
        'KULE ANTEN ASMA APARATI ( KULE OFSET )( TAKIM )',
        'ÇİÇEK ( YILDIZ OFSET ) ( 2,5 İNÇ BORUYA GÖRE )( TAKIM )',
        'ÇİÇEK ( YILDIZ OFSET ) ( 4 İNÇ BORUYA GÖRE )(TAKIM )',
        'PANEL ANTEN',
        'OMNİ ANTEN',
        '12 CORE İNDOOR ODF',
        '24 CORE İNDOOR ODF',
        '36 CORE İNDOOR ODF',
        '48 CORE İNDOOR ODF',
        '12 CORE OUTDOOR ODF',
        '24 CORE OUTDOOR ODF',
        '36 CORE OUTDOOR ODF',
        '48 CORE OUTDOOR ODF',
        '12 CORE FİBER KABLO',
        '24 CORE FİBER KABLO',
        '36 CORE FİBER KABLO',
        '48 CORE FİBER KABLO',
        '2X6-2X10 DC CLAMP ( HUAWEİ TİPİ )',
        '2X16-2X25 DC CLAMP ( HUAWEİ TİPİ )',
        'PLASTİK KABLO BAĞI ( KALIN )',
        'PLASTİK KABLO BAĞI ( İNCE )',
        'PLASTİK KABLO BAĞI ( KISA-KIL )',
        'DYMO KUTUCUK ( PVC )',
        'DYMO KARTUŞ ( SARI )',
        'SİYAH SİLİKON',
        'BEYAZ SİLİKON',
        'SİYAH İZOLELİ BANT',
        '5M ERİCSSON RET KABLOSU',
        '5M HUAWEİ RET KABLOSU',
        'SAYAÇ PANOSU',
        'UÇAK İKAZ',
        'SİYAH SPREY BOYA',
        'BEYAZ SPREY BOYA',
        'TURKUAZ SPREY BOYA',
        'GRİ SPREY BOYA',
        'MİNTİ YEŞİL SPREY BOYA',
        '3XC 25A GRUP SİGORTA',
        '3XC 32A GRUP SİGORTA',
        '3XC 40A GRUP SİGORTA',
        '3XC 63A GRUP SİGORTA',
        '3XB 25A GRUP SİGORTA',
        '3XB 32A GRUP SİGORTA',
        '3XB 40A GRUP SİGORTA',
        '3XB 63A GRUP SİGORTA',
        '4XC 25A GRUP SİGORTA',
        '4XC 32A GRUP SİGORTA',
        '4XC 40A GRUP SİGORTA',
        '4XC 63A GRUP SİGORTA',
        '4XB 25A GRUP SİGORTA',
        '4XB 32A GRUP SİGORTA',
        '4XB 40A GRUP SİGORTA',
        '4XB 63A GRUP SİGORTA',
        '4X25A 300MA YANGIN KORUMA SİGORTASI',
        '4X32A 300MA YANGIN KORUMA SİGORTASI',
        '4X40A 300MA YANGIN KORUMA SİGORTASI',
        '4X63A 300MA YANGIN KORUMA SİGORTASI',
        '4X25A 30MA KAÇAK AKIM SİGORTASI',
        '4X32A 30MA KAÇAK AKIM SİGORTASI',
        '4X40A 30MA KAÇAK AKIM SİGORTASI',
        '4X63A 30MA KAÇAK AKIM SİGORTASI',
        '1XC 16A MONOFAZE SİGORTA',
        '1XC 25A MONOFAZE SİGORTA',
        '1XC 32A MONOFAZE SİGORTA',
        '1XC 40A MONOFAZE SİGORTA',
        '1XC 63A MONOFAZE SİGORTA',
        '1XC 100A MONOFAZE SİGORTA',
        '1XC 125A MONOFAZE SİGORTA',
        '16A BIÇAKLI SİGORTA ( BOY 0 )',
        '25A BIÇAKLI SİGORTA ( BOY 0 )',
        '32A BIÇAKLI SİGORTA ( BOY 0 )',
        '40A BIÇAKLI SİGORTA ( BOY 0 )',
        '63A BIÇAKLI SİGORTA ( BOY 0 )',
        '100A BIÇAKLI SİGORTA ( BOY 0 )',
        '125A BIÇAKLI SİGORTA ( BOY 0 )',
      ];
      for (const m of MALZEME_SEED) {
        await pool.query(
          `INSERT INTO malzeme_fiyat_listesi (malzeme_adi, birim, birim_fiyat, kategori)
           VALUES ($1, 'Adet', 0, 'Genel') ON CONFLICT DO NOTHING`,
          [m]
        ).catch(() => {});
      }
      console.log(`✅ ${MALZEME_SEED.length} malzeme fiyat listesine eklendi`);
    } else {
      console.log(`ℹ️  Malzeme fiyat listesi zaten dolu (${count.rows[0].count} kayıt)`);
    }
    // GSM altyapı malzemeleri — her zaman eksik olanları ekle
    const GSM_SEED = [
      { adi:"NYY 3x4mm2 ENERJİ KABLOSU", birim:"Metre", kategori:"Enerji Kablo" },
      { adi:"NYY 3x6mm2 ENERJİ KABLOSU", birim:"Metre", kategori:"Enerji Kablo" },
      { adi:"NYY 3x10mm2 ENERJİ KABLOSU", birim:"Metre", kategori:"Enerji Kablo" },
      { adi:"NYY 3x16mm2 ENERJİ KABLOSU", birim:"Metre", kategori:"Enerji Kablo" },
      { adi:"NYY 3x35mm2 ENERJİ KABLOSU", birim:"Metre", kategori:"Enerji Kablo" },
      { adi:"NYY 1x50mm2 ENERJİ KABLOSU", birim:"Metre", kategori:"Enerji Kablo" },
      { adi:"NYY 1x95mm2 ENERJİ KABLOSU", birim:"Metre", kategori:"Enerji Kablo" },
      { adi:"NYAF 1x50mm2 ESNEK TOPRAKLAMA İLETKENİ", birim:"Metre", kategori:"Topraklama" },
      { adi:"NYAF 1x16mm2 ESNEK TOPRAKLAMA İLETKENİ", birim:"Metre", kategori:"Topraklama" },
      { adi:"NYAF 1x6mm2 ESNEK TOPRAKLAMA İLETKENİ", birim:"Metre", kategori:"Topraklama" },
      { adi:"NH-FE 180 3x2.5mm2 YANMAZ ENERJİ KABLOSU", birim:"Metre", kategori:"Enerji Kablo" },
      { adi:"DC 48V GÜÇ KABLOSU 2x35mm2", birim:"Metre", kategori:"Enerji Kablo" },
      { adi:"BAKIR ÖRGÜLÜ TOPRAKLAMA İLETKENİ 35mm2", birim:"Metre", kategori:"Topraklama" },
      { adi:"HDPE Ø50/42mm TEK KATLI KABLO KORUMA BORUSU", birim:"Metre", kategori:"Boru" },
      { adi:"HDPE Ø63/53mm TEK KATLI KABLO KORUMA BORUSU", birim:"Metre", kategori:"Boru" },
      { adi:"HDPE Ø110/94mm ÇİFT KATLI KABLO KORUMA BORUSU", birim:"Metre", kategori:"Boru" },
      { adi:"HDPE Ø160/136mm ÇİFT KATLI KABLO KORUMA BORUSU", birim:"Metre", kategori:"Boru" },
      { adi:"HDPE Ø40/34mm MİKROKANAL BORUSU", birim:"Metre", kategori:"Boru" },
      { adi:"PVC BORU Ø32mm ELEKTRİK TESİSAT BORUSU", birim:"Metre", kategori:"Boru" },
      { adi:"PVC BORU Ø50mm ELEKTRİK TESİSAT BORUSU", birim:"Metre", kategori:"Boru" },
      { adi:"PVC BORU Ø75mm ELEKTRİK TESİSAT BORUSU", birim:"Metre", kategori:"Boru" },
      { adi:"GALVANİZLİ ÇELİK BORU 2\" KABLO KORUMA BORUSU", birim:"Metre", kategori:"Boru" },
      { adi:"CORRUGATED BORU Ø32mm ESNEKLİK BORUSU", birim:"Metre", kategori:"Boru" },
      { adi:"3m STANDART ANTEN OFSETİ (GALVANİZLİ ÇELİK)", birim:"Adet", kategori:"Ofset" },
      { adi:"6m STANDART ANTEN OFSETİ (GALVANİZLİ ÇELİK)", birim:"Adet", kategori:"Ofset" },
      { adi:"1.5m KISA ANTEN OFSETİ (HOT DIP GALVANİZLİ)", birim:"Adet", kategori:"Ofset" },
      { adi:"DUVAR TİPİ ANTEN MONTAJ KOL SETİ", birim:"Set", kategori:"Ofset" },
      { adi:"SEKTÖR ANTEN MONTAJ FLANŞI VE BAĞLANTI KİTİ", birim:"Set", kategori:"Ofset" },
      { adi:"ANTEN TAVAN MONTAJ KİTİ (3 NOKTA SABITLEME)", birim:"Set", kategori:"Ofset" },
      { adi:"U-BOLT M16 GALVANİZLİ KULE BAĞLANTI CİVATASI (4'LÜ SET)", birim:"Set", kategori:"Ofset" },
      { adi:"48 FİBER OPTİK KABLO G.652D LOOSE TUBE OUTDOOR", birim:"Metre", kategori:"Fiber Optik" },
      { adi:"96 FİBER OPTİK KABLO G.652D LOOSE TUBE OUTDOOR", birim:"Metre", kategori:"Fiber Optik" },
      { adi:"24 FİBER OPTİK KABLO G.652D LOOSE TUBE OUTDOOR", birim:"Metre", kategori:"Fiber Optik" },
      { adi:"12 FİBER OPTİK KABLO G.657A2 INDOOR/OUTDOOR", birim:"Metre", kategori:"Fiber Optik" },
      { adi:"4 FİBER OPTİK KABLO G.652D FİGÜR-8 HAVAI", birim:"Metre", kategori:"Fiber Optik" },
      { adi:"2M LC-LC SİNGLE MOD PATCH CORD (INDOOR)", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"2M SC-LC SİNGLE MOD PATCH CORD (INDOOR)", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"2M SC-SC SİNGLE MOD PATCH CORD (INDOOR)", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"LC/UPC PİGTAİL 1.5M SİNGLE MOD G.652D", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"SC/UPC PİGTAİL 1.5M SİNGLE MOD G.652D", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"SC/APC PİGTAİL 1.5M SİNGLE MOD G.652D", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"12 FİBER SC/UPC FANOUT SİNGLE MOD", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"24 FİBER SC/UPC FANOUT SİNGLE MOD", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"12 PORT LC DUPLEX FIBER OPTİK PATCH PANEL 19\" 1U", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"24 PORT SC SIMPLEX FIBER OPTİK PATCH PANEL 19\" 1U", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"48 PORT LC DUPLEX FIBER OPTİK PATCH PANEL 19\" 2U", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"FIBER OPTİK SPLICE CLOSURE 48 FİBER 4 PORT", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"FIBER OPTİK SPLICE CLOSURE 144 FİBER 6 PORT", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"FIBER OPTİK SPLICE CLOSURE 288 FİBER 6 PORT", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"FIBER OPTİK SONLANDIRMA KUTUSU 12 PORT SC", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"FIBER OPTİK SONLANDIRMA KUTUSU 24 PORT SC", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"ODF 19\" RACK TİPİ 12U FİBER DAĞITIM ÇERÇEVESİ", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"FIBER OPTİK SPLICE TRAY (12 FİBER KAPASİTELİ)", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"SC/LC ADAPTÖR SİNGLE MOD UPC", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"SC/LC ADAPTÖR SİNGLE MOD APC", birim:"Adet", kategori:"Fiber Optik" },
      { adi:"BAKIR TOPRAKLAMA ÇUBUĞU 14mm x 1500mm", birim:"Adet", kategori:"Topraklama" },
      { adi:"BAKIR TOPRAKLAMA ÇUBUĞU 14mm x 2000mm", birim:"Adet", kategori:"Topraklama" },
      { adi:"BAKIR ŞERİT 30x3mm2 TOPRAKLAMA İLETKENİ", birim:"Metre", kategori:"Topraklama" },
      { adi:"BAKIR ŞERİT 25x3mm2 TOPRAKLAMA İLETKENİ", birim:"Metre", kategori:"Topraklama" },
      { adi:"TOPRAKLAMA RAYIÇ KLEMENSİ BUS BAR 100A", birim:"Adet", kategori:"Topraklama" },
      { adi:"TOPRAKLAMA RAYIÇ KLEMENSİ BUS BAR 200A", birim:"Adet", kategori:"Topraklama" },
      { adi:"TOPRAKLAMA PABUCİ CU 50mm2 M8", birim:"Adet", kategori:"Topraklama" },
      { adi:"TOPRAKLAMA PABUCİ CU 95mm2 M10", birim:"Adet", kategori:"Topraklama" },
      { adi:"GALVANİZLİ TOPRAKLAMA BAĞLANTISI KELEPÇE SETİ", birim:"Set", kategori:"Topraklama" },
      { adi:"RF KOAKSIYEL FEEDER KABLO 1/2\"", birim:"Metre", kategori:"RF" },
      { adi:"RF KOAKSIYEL FEEDER KABLO 7/8\"", birim:"Metre", kategori:"RF" },
      { adi:"RF JUMPER KABLO 0.5M N(M)-N(M) SÜPER ESNEK", birim:"Adet", kategori:"RF" },
      { adi:"RF JUMPER KABLO 1M N(M)-N(M) SÜPER ESNEK", birim:"Adet", kategori:"RF" },
      { adi:"RF JUMPER KABLO 2M N(M)-N(M) SÜPER ESNEK", birim:"Adet", kategori:"RF" },
      { adi:"N TİPİ KONNEKTÖR 1/2\" KOAKSIYEL KABLO İÇİN", birim:"Adet", kategori:"RF" },
      { adi:"N TİPİ KONNEKTÖR 7/8\" KOAKSIYEL KABLO İÇİN", birim:"Adet", kategori:"RF" },
      { adi:"7/16 DIN KONNEKTÖR 7/8\" KOAKSIYEL KABLO İÇİN", birim:"Adet", kategori:"RF" },
      { adi:"RF TOPRAKLAMA KİTİ 1/2\" KABLO", birim:"Adet", kategori:"RF" },
      { adi:"RF TOPRAKLAMA KİTİ 7/8\" KABLO", birim:"Adet", kategori:"RF" },
      { adi:"GALVANİZLİ KABLO KANALÜ 100x50mm (3m PARÇA)", birim:"Adet", kategori:"Kablo Yönetimi" },
      { adi:"GALVANİZLİ KABLO KANALÜ 200x100mm (3m PARÇA)", birim:"Adet", kategori:"Kablo Yönetimi" },
      { adi:"PVC KABLO KANALÜ 25x16mm (2m PARÇA)", birim:"Adet", kategori:"Kablo Yönetimi" },
      { adi:"PVC KABLO KANALÜ 40x25mm (2m PARÇA)", birim:"Adet", kategori:"Kablo Yönetimi" },
      { adi:"KABLO ASKISI GALVANİZLİ 50mm", birim:"Adet", kategori:"Kablo Yönetimi" },
      { adi:"KABLO ASKISI GALVANİZLİ 75mm", birim:"Adet", kategori:"Kablo Yönetimi" },
      { adi:"ÇELİK KABLO BAĞI TIE WRAP 250mm 100 ADET", birim:"Paket", kategori:"Kablo Yönetimi" },
      { adi:"PVC SPIRAL KABLO KORUYUCU Ø20mm", birim:"Metre", kategori:"Kablo Yönetimi" },
      { adi:"KABLO MERDİVENİ LADDER RACK 300mm", birim:"Metre", kategori:"Kablo Yönetimi" },
      { adi:"KABLO MERDİVENİ LADDER RACK 600mm", birim:"Metre", kategori:"Kablo Yönetimi" },
      { adi:"J-HOOK KABLO ASKI KANCASI Ø75mm", birim:"Adet", kategori:"Kablo Yönetimi" },
      { adi:"OUTDOOR METAL KABIN IP55 600x800x300mm", birim:"Adet", kategori:"Kabin" },
      { adi:"OUTDOOR METAL KABIN IP55 1000x800x300mm", birim:"Adet", kategori:"Kabin" },
      { adi:"19\" RACK DOLABI 42U AÇIK TİP", birim:"Adet", kategori:"Kabin" },
      { adi:"19\" RACK DOLABI 42U KAPALI TİP", birim:"Adet", kategori:"Kabin" },
      { adi:"HAVALANDIRMA FAN KİTİ KABIN 230VAC", birim:"Adet", kategori:"Kabin" },
      { adi:"SPD AŞIRI GERİLİM KORUYUCU TİP 2 40kA", birim:"Adet", kategori:"Kabin" },
      { adi:"AC KABLO 3x2.5mm2 TESİSAT KABLOSU", birim:"Metre", kategori:"Enerji Kablo" },
      { adi:"ALÇAK GERİLİM KABİN ANAHTARLAMA PANELI", birim:"Adet", kategori:"Kabin" },
    ];
    let added = 0;
    for (const m of GSM_SEED) {
      const exists = await pool.query(
        "SELECT 1 FROM malzeme_fiyat_listesi WHERE LOWER(malzeme_adi)=LOWER($1)", [m.adi]
      );
      if (!exists.rows.length) {
        await pool.query(
          `INSERT INTO malzeme_fiyat_listesi (malzeme_adi, birim, birim_fiyat, kategori)
           VALUES ($1, $2, 0, $3)`,
          [m.adi, m.birim, m.kategori]
        ).catch(() => {});
        added++;
      }
    }
    if (added > 0) console.log(`✅ ${added} yeni GSM malzeme eklendi`);
  } catch (e) {
    console.error('Malzeme seed hatası:', e.message);
  }
})();

// ─── TAŞERON KULLANICI SEED ───────────────────────────────────────────────────
const SUBCON_USERS = [
  { name: "Zeki Sandal",     email: "zsandal@ubstasarimmakine.com.tr", subcon_name: "UBS",     payment_rate: 0.75, password: "123456" },
  { name: "Burhan Koçak",    email: "b.kocak@federalgroups.com",       subcon_name: "Federal", payment_rate: 0.80, password: "123456" },
  // AHY teknik kullanıcısı ("ahy") kaldırıldı (16.07.2026): giriş artık
  // yalnız info@ahyelektrik.com ile — aşağıdaki cleanup eski kaydı siler.
  // Serdar Altınova seed'den çıkarıldı (14.07.2026): simsektel hesabı artık
  // ERC bölge müdürü — startup migration yönetiyor, seed rol/şifre ezmesin.
];

(async () => {
  for (const u of SUBCON_USERS) {
    try {
      const hash = await bcrypt.hash(u.password || "123456", 10);
      await pool.query(
        `INSERT INTO users (name, email, password_hash, role, is_active, subcon_name, payment_rate)
         VALUES ($1, $2, $3, 'subcon', true, $4, $5)
         ON CONFLICT (email) DO UPDATE SET
           name          = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash,
           role          = 'subcon',
           is_active     = true,
           subcon_name   = EXCLUDED.subcon_name,
           payment_rate  = EXCLUDED.payment_rate`,
        [u.name, u.email, hash, u.subcon_name, u.payment_rate]
      );
      console.log(`✅ ${u.subcon_name} kullanıcısı upsert edildi: ${u.email}`);
    } catch (e) {
      console.error(`${u.subcon_name} seed hatası:`, e.message);
    }
  }
  try {
    const del = await pool.query(`DELETE FROM users WHERE LOWER(email)='ahy'`);
    if (del.rowCount) console.log("🗑 'ahy' teknik kullanıcısı silindi (giriş: info@ahyelektrik.com)");
  } catch (e) {
    console.error("ahy cleanup hatası:", e.message);
  }
})();

/* ═══════════════════════════════════════════════════════════════
   TAŞERON ÖDEME MOTORU
   ═══════════════════════════════════════════════════════════════ */

// Tablo + kolon garantisi (idempotent)
pool.query(`
  CREATE TABLE IF NOT EXISTS taseron_odeme_log (
    id          SERIAL PRIMARY KEY,
    firma       TEXT NOT NULL,
    tutar       NUMERIC NOT NULL DEFAULT 0,
    tarih       DATE NOT NULL,
    aciklama    TEXT,
    dagilim     JSONB,          -- [{fatura_no, tutar}, ...]
    created_at  TIMESTAMP DEFAULT NOW()
  );
`).catch(e => console.error("taseron_odeme_log tablo hatası:", e.message));

// dekont_url kolonu ekle
pool.query(`ALTER TABLE taseron_odeme_log ADD COLUMN IF NOT EXISTS avans_tutar NUMERIC DEFAULT 0;`)
  .catch(e => console.error("taseron_odeme_log avans_tutar hatası:", e.message));
pool.query(`ALTER TABLE taseron_odeme_log ADD COLUMN IF NOT EXISTS dekont_url TEXT;`)
  .catch(e => console.error("dekont_url kolonu:", e.message));

// ── OMNIX MULTI-TENANT MIGRATIONS ─────────────────────────────────────────
pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant TEXT DEFAULT 'erc'`).catch(() => {});
pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`).catch(() => {});
pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT`).catch(() => {});
pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP`).catch(() => {});
pool.query(`UPDATE users SET tenant='2kx' WHERE UPPER(TRIM(COALESCE(subcon_name,''))) LIKE '%2KX%' AND (tenant IS NULL OR tenant='erc')`).catch(() => {});

// ── MARKA KATMANI (tenant içi white-label: ERC / AHY Elektrik vb.) ──────────
// Aynı tenant verisini paylaşan firmalar. hw_yukleme=false olan markanın
// kullanıcıları HW yükleme (payment/fatura/item/po/acceptance) yapamaz.
// kirilim_yuzde: ana yüklenici (ERC) payı — hakediş kırılım raporunda kullanılır.
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS markalar (
      id SERIAL PRIMARY KEY,
      tenant TEXT DEFAULT 'erc',
      kod TEXT UNIQUE NOT NULL,
      ad TEXT NOT NULL,
      hw_yukleme BOOLEAN DEFAULT false,
      kirilim_yuzde NUMERIC DEFAULT 0,
      aktif BOOLEAN DEFAULT true
    )`);
    await pool.query(`INSERT INTO markalar (tenant,kod,ad,hw_yukleme,kirilim_yuzde) VALUES ('erc','ERC','ERC Mühendislik',true,0) ON CONFLICT (kod) DO NOTHING`);
    await pool.query(`INSERT INTO markalar (tenant,kod,ad,hw_yukleme,kirilim_yuzde) VALUES ('erc','AHY','AHY Elektrik',false,10) ON CONFLICT (kod) DO NOTHING`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS marka TEXT DEFAULT 'ERC'`);
    // Bir defalık migration: hiç AHY kullanıcısı yoksa saha ekibini AHY'ye taşı.
    // Yönetim + muhasebe ERC'de kalır. Sonradan admin panelden düzeltilebilir;
    // AHY kullanıcısı oluştuğu için bu blok bir daha çalışmaz.
    const chk = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE marka='AHY'`);
    if (chk.rows[0].n === 0) {
      const mig = await pool.query(`UPDATE users SET marka='AHY'
        WHERE COALESCE(tenant,'erc')='erc'
          AND LOWER(COALESCE(role,'user')) NOT IN ('admin','platform_admin','muhasebe','finance','direktor','genel_mudur')`);
      console.log(`[marka] Saha ekibi AHY markasına taşındı: ${mig.rowCount} kullanıcı`);
    }
    // E-posta domain garantisi: @ahyelektrik.com uzantılı HER kullanıcı AHY
    // markalıdır — dropdown seçimi unutulsa/karışsa bile her açılışta düzelir.
    await pool.query(`UPDATE users SET marka='AHY'
      WHERE LOWER(email) LIKE '%@ahyelektrik.com' AND COALESCE(marka,'ERC') <> 'AHY'`);
    // Personel garantisi: Erencan Şimşek + Tuğçe Yelmen ERC'de kalır (SSK ve
    // kayıtları Şimşek'te), diğer kadro AHY'nin İK/ödeme görünümüne yansır.
    await pool.query(`UPDATE personel SET marka='ERC'
      WHERE (ad_soyad ILIKE '%ERENCAN%' OR ad_soyad ILIKE '%YELMEN%') AND COALESCE(marka,'ERC') <> 'ERC'`);
    // ARAÇ KİRA ÖDEMELERİ: dönem bazlı 'kira ödendi' kayıtları — nakit akışına düşer
    await pool.query(`CREATE TABLE IF NOT EXISTS arac_kira_odemeler (
      id SERIAL PRIMARY KEY,
      arac_id INTEGER NOT NULL,
      donem TEXT NOT NULL,
      tutar NUMERIC DEFAULT 0,
      tarih DATE DEFAULT CURRENT_DATE,
      aciklama TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (arac_id, donem)
    )`);
    // ARAÇ DEVRİ (bir defalık, 15.07.2026): eski araçlardan yalnız sürücüsü
    // Orhan Bedir olan aktif kalır; diğerleri PASİFE alınır (silinmez —
    // kayıt/belge geçmişi durur, gerekirse panelden 'Aktif Et' ile geri döner).
    // Not etiketi sayesinde migration bir daha çalışmaz; 15 Temmuz sonrası
    // eklenen yeni araçlara dokunulmaz.
    const aracChk = await pool.query(`SELECT COUNT(*)::int AS n FROM araclar WHERE COALESCE(notlar,'') LIKE '%[AHY devri%'`);
    if (aracChk.rows[0].n === 0) {
      const aracMig = await pool.query(`UPDATE araclar
        SET aktif=false, durum='PASİF',
            notlar = COALESCE(notlar,'') || ' [AHY devri: 15.07.2026 öncesi araç, pasife alındı]'
        WHERE COALESCE(aktif,true)=true AND COALESCE(surucu,'') NOT ILIKE '%orhan%'`);
      if (aracMig.rowCount > 0) console.log(`[araç devri] Pasife alınan eski araç: ${aracMig.rowCount}`);
    }
    // Yönetim garantisi: platform sahibi + ERC yönetimi + muhasebe + bölge
    // müdürleri (Nurcan, Serdar) her açılışta ERC markasında kalır.
    await pool.query(`UPDATE users SET marka='ERC'
      WHERE LOWER(email) IN ('orhan.bedir@gmail.com','orhan.bedir@simsektel.com','orhan@simsektel.com','duzgun.simsek@simsektel.com','muhasebe@simsektel.com','nurcan.kus@simsektel.com','serdar.altinova@simsektel.com')
        AND COALESCE(marka,'ERC') <> 'ERC'`);
    // SERDAR ALTINOVA iki kimlik kurgusu (14.07.2026):
    // gmail → 2KX görünümü (2KX Paneli + taşeron kapsamı, izole firma kaldırıldı)
    // simsektel → ERC bölge müdürü (2KX bağı kaldırıldı, tam ERC menüsü)
    await pool.query(`UPDATE users SET is_active=true, status='active', tenant='2kx',
        subcon_name='2KX HABERLEŞME SİSTEMLERİ MÜHENDİSLİK İNŞAAT LİMİTED ŞİRKETİ',
        payment_rate=0.75, role='rollout_mudur', marka='ERC'
      WHERE LOWER(email)='serdaraltinova@gmail.com'`);
    await pool.query(`UPDATE users SET is_active=true, status='active', tenant='erc',
        subcon_name=NULL, role='rollout_mudur', marka='ERC'
      WHERE LOWER(email)='serdar.altinova@simsektel.com'`);
    // AHY iş görünümü: Bölge Analizi'nde yalnız taşeronu 'AHY ELEKTRİK' olan
    // sahaları %90 kırılımla görür (UBS/Federal/2KX ile aynı mekanizma).
    await pool.query(`UPDATE users SET subcon_name='AHY ELEKTRİK', payment_rate=0.90
      WHERE LOWER(email) LIKE '%@ahyelektrik.com'
        AND (COALESCE(subcon_name,'') <> 'AHY ELEKTRİK' OR COALESCE(payment_rate,0) <> 0.90)`);
    // Eski AHY taşeron hesapları da (%80'lik dönem) yeni %90 orana çekilir
    await pool.query(`UPDATE users SET payment_rate=0.90
      WHERE UPPER(COALESCE(subcon_name,'')) LIKE '%AHY%' AND COALESCE(payment_rate,0) <> 0.90`);
    // Personel de marka'ya ayrılır: İK panelleri marka-bazlı izole görünür.
    // Bir defalık: Şimşek maaşlı kadro AHY'ye (kadro AHY'ye geçti);
    // Tuğçe Yelmen (ERC'de kalan muhasebeci) ve taşeron ISG kayıtları ERC'de kalır.
    await pool.query(`ALTER TABLE personel ADD COLUMN IF NOT EXISTS marka TEXT DEFAULT 'ERC'`);
    const pchk = await pool.query(`SELECT COUNT(*)::int AS n FROM personel WHERE marka='AHY'`);
    if (pchk.rows[0].n === 0) {
      const pmig = await pool.query(`UPDATE personel SET marka='AHY'
        WHERE COALESCE(firma_tipi,'simsek')='simsek' AND ad_soyad NOT ILIKE '%YELMEN%'`);
      console.log(`[marka] Personel AHY markasına taşındı: ${pmig.rowCount} kayıt`);
    }
    // MAAŞ GEÇMİŞİ: maaş dönem bazlı versiyonlanır. Ay M için geçerli maaş =
    // donem <= M olan en son kayıt; hiç kayıt yoksa personel tablosundaki değer.
    // Maaş güncellenince eski değer '1900-01' taban kaydı olarak korunur,
    // yeni değer seçilen dönemden itibaren geçerli olur → geçmiş aylar bozulmaz.
    await pool.query(`CREATE TABLE IF NOT EXISTS personel_maas_gecmisi (
      id SERIAL PRIMARY KEY,
      personel_id INTEGER NOT NULL,
      donem TEXT NOT NULL,
      net_maas NUMERIC DEFAULT 0,
      bankadan_gosterilen NUMERIC DEFAULT 0,
      elden_verilen NUMERIC DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (personel_id, donem)
    )`);
  } catch (e) { console.error("markalar migration hatası:", e.message); }
})();

// ── İZOLE TENANT KAYIT DEFTERİ (registry) ───────────────────────────────────
// İzole (kendi şemasında, sıfırdan veri giren) firmaların kaydı. Onayda buraya
// eklenir; startup'ta hafızadaki allow-list'e yüklenir. 'erc' ve legacy '2kx'
// asla burada izole olarak yer almaz.
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_registry (
        tenant      TEXT PRIMARY KEY,
        name        TEXT,
        owner_email TEXT,
        schema_name TEXT,
        isolated    BOOLEAN DEFAULT true,
        created_at  TIMESTAMP DEFAULT NOW()
      )
    `);
    const { rows } = await pool.query(
      `SELECT tenant FROM tenant_registry WHERE isolated = true`
    );
    let n = 0;
    for (const r of rows) { if (addIsolatedTenant(r.tenant)) n++; }
    if (n > 0) console.log(`[tenant] ${n} izole tenant allow-list'e yüklendi.`);
  } catch (e) {
    console.error("[tenant-registry] başlatma hatası:", e.message);
  }
})();

// ── PLATFORM SAHİBİ (super-admin) ROLÜ ──────────────────────────────────────
// Uygulamanın sahibi orhan.bedir@gmail.com, kendi gmail adresiyle kayıt olup
// onay beklerken VEYA zaten kayıtlıyken otomatik olarak 'platform_admin' rolüne
// yükseltilir ve aktifleştirilir (şifresine dokunulmaz — kendi belirlediği
// şifre korunur). Bu rol, firma adminlerinin (role='admin') üstündedir ve yeni
// firma onaylarını yalnızca bu hesap yapabilir. ERC verisi etkilenmez:
// gmail adresi tenant='erc' olduğu için public şemada kalır (izole değildir).
(async () => {
  try {
    const PLATFORM_OWNER = "orhan.bedir@gmail.com";
    const r = await pool.query(
      `UPDATE users SET role='platform_admin', is_active=true, status='active'
       WHERE LOWER(email)=$1 RETURNING id`,
      [PLATFORM_OWNER]
    );
    if (r.rowCount > 0) {
      console.log(`[platform] ${PLATFORM_OWNER} platform_admin olarak ayarlandı.`);
    }
    // ERC firma admini: duzgun.simsek@simsektel.com (kayıtlıysa admin yapılır).
    await pool.query(
      `UPDATE users SET role='admin', is_active=true
       WHERE LOWER(email)='duzgun.simsek@simsektel.com' AND role NOT IN ('admin','platform_admin')`
    ).catch(() => {});
  } catch (e) {
    console.error("[platform-admin] başlatma hatası:", e.message);
  }
})();

// ── FİRMA ADI STANDARTILAŞTIRMA ─────────────────────────────────────────────
// Sistemdeki kısa / kırpık firma adlarını tam resmi adlarıyla güncelle.
// Tüm tablolarda ILIKE ile eşleştirir; subcons UNIQUE kısıtı için merge yapar.
(async () => {
  const RENAMES = [
    {
      pattern: "UBS%",
      canonical: "UBS HABERLEŞME TASARIM MAKİNE MÜHENDİSLİK SANAYİ VE TİCARET LİMİTED ŞİRKETİ",
    },
    {
      pattern: "2KX%",
      canonical: "2KX HABERLEŞME SİSTEMLERİ MÜHENDİSLİK İNŞAAT LİMİTED ŞİRKETİ",
    },
  ];

  // Boşluk/sekme/satır normalleştirerek ILIKE karşılaştırması
  const normalExpr = (col) =>
    `UPPER(TRIM(REGEXP_REPLACE(${col}, '\\s+', ' ', 'g')))`;

  const simpleTables = [
    { table: "master_works",      col: "subcon_name" },
    { table: "supplier_advances", col: "subcon_name" },
    { table: "subcon_payables",   col: "subcon_name" },
    { table: "invoice_entries",   col: "tedarikci" },
    { table: "invoice_entries",   col: "rf_montaj_firma" },
    { table: "taseron_fatura",    col: "taseron_adi" },
    { table: "taseron_odeme",     col: "taseron_adi" },
    { table: "taseron_odeme_log", col: "firma" },
    { table: "taseron_banka",     col: "firma" },
    { table: "hw_acceptance_rows",col: "current_handler" },
    { table: "users",             col: "subcon_name" },
  ];

  for (const { pattern, canonical } of RENAMES) {
    for (const { table, col } of simpleTables) {
      await pool.query(
        `UPDATE ${table} SET ${col} = $1 WHERE ${normalExpr(col)} ILIKE $2 AND ${col} IS NOT NULL AND ${col} != $1`,
        [canonical, pattern]
      ).catch(e => {
        if (!e.message.includes("does not exist")) {
          console.error(`[firma-rename] ${table}.${col}:`, e.message);
        }
      });
    }

    // subcons (UNIQUE NOT NULL): önce yeni adı ekle, sonra eskisini sil
    await pool.query(
      `INSERT INTO subcons (subcon_name) VALUES ($1) ON CONFLICT (subcon_name) DO NOTHING`,
      [canonical]
    ).catch(() => {});
    await pool.query(
      `DELETE FROM subcons WHERE ${normalExpr("subcon_name")} ILIKE $1 AND subcon_name != $2`,
      [pattern, canonical]
    ).catch(e => console.error(`[firma-rename] subcons:`, e.message));
  }
  console.log("[startup] Firma adı standartilaştırma tamamlandı.");
})();

// Firmalar listesi (kalan borcu olanlar — Ödeme Gir dropdown)
app.get("/finance/taseron-firmalar", requireFinanceAuth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        TRIM(COALESCE(NULLIF(rf_montaj_firma,''), tedarikci, '')) AS firma,
        COUNT(*)::int AS fatura_sayisi,
        COALESCE(SUM(toplam_tutar),0) AS toplam_tutar,
        COALESCE(SUM(odenen_tutar),0) AS toplam_odenen,
        COALESCE(SUM(kalan_borc),0)   AS toplam_kalan
      FROM invoice_entries
      WHERE COALESCE(TRIM(COALESCE(NULLIF(rf_montaj_firma,''), tedarikci, '')), '') <> ''
      GROUP BY TRIM(COALESCE(NULLIF(rf_montaj_firma,''), tedarikci, ''))
      HAVING COALESCE(SUM(kalan_borc),0) > 0
      ORDER BY firma ASC
    `);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Tüm firmalar listesi (arama/datalist için — kalan borç 0 olanlar dahil).
// Fatura firmalarına ek olarak ödeme loglarında geçen firmalar da listelenir:
// elle yazılan yeni taşeron, ilk ödeme kaydından sonra öneri listesine girer.
app.get("/finance/taseron-firmalar-all", requireFinanceAuth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT firma, SUM(toplam_kalan) AS toplam_kalan FROM (
        SELECT
          TRIM(COALESCE(NULLIF(rf_montaj_firma,''), tedarikci, '')) AS firma,
          COALESCE(SUM(kalan_borc),0) AS toplam_kalan
        FROM invoice_entries
        WHERE COALESCE(TRIM(COALESCE(NULLIF(rf_montaj_firma,''), tedarikci, '')), '') <> ''
        GROUP BY TRIM(COALESCE(NULLIF(rf_montaj_firma,''), tedarikci, ''))

        UNION ALL

        SELECT TRIM(firma) AS firma, 0 AS toplam_kalan
        FROM taseron_odeme_log
        WHERE COALESCE(TRIM(firma),'') <> ''
        GROUP BY TRIM(firma)
      ) t
      GROUP BY firma
      ORDER BY toplam_kalan DESC, firma ASC
    `);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Ödeme dekontu yükle
app.post("/finance/odeme-dekont/:id", requireFinanceAuth, upload.single("file"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: "Dosya yok" });
    const ext = (utf8Name(req.file.originalname) || "").split(".").pop() || "pdf";
    const filename = `odeme-dekont/${id}_${Date.now()}.${ext}`;
    const { url } = await uploadToStorage("odeme-dekontlar", filename, req.file.buffer, req.file.mimetype);
    await pool.query(`UPDATE taseron_odeme_log SET dekont_url=$1 WHERE id=$2`, [url, id]);
    res.json({ ok: true, dekont_url: url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Firma cari detayı (ödenmemiş faturalar FIFO sırası)
app.get("/finance/taseron-cari", requireFinanceAuth, async (req, res) => {
  try {
    const { firma } = req.query;
    if (!firma) return res.status(400).json({ error: "firma zorunlu" });

    const r = await pool.query(`
      SELECT id, fatura_no, fatura_tarihi, toplam_tutar, odenen_tutar,
             COALESCE(kalan_borc,0) AS kalan_borc, odeme_tarihi, note,
             COALESCE(currency,'TRY') AS currency,
             COALESCE(usd_kur,1) AS usd_kur
      FROM invoice_entries
      WHERE TRIM(COALESCE(NULLIF(rf_montaj_firma,''), tedarikci, '')) = $1
        AND COALESCE(kalan_borc,0) > 0
      ORDER BY COALESCE(fatura_tarihi, created_at) ASC
    `, [firma]);

    const toplamKalan = r.rows.reduce((s, row) => {
      const kalan = Number(row.kalan_borc || 0);
      const kur = Number(row.usd_kur || 1);
      return s + (row.currency === 'USD' ? kalan * kur : kalan);
    }, 0);
    res.json({ faturalar: r.rows, toplamKalan });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Firma ödeme geçmişi
app.get("/finance/taseron-odeme-gecmisi", requireFinanceAuth, async (req, res) => {
  try {
    const { firma } = req.query;
    if (!firma) return res.status(400).json({ error: "firma zorunlu" });
    const r = await pool.query(`
      SELECT id, firma, tutar, tarih, aciklama, dagilim, dekont_url, created_at
      FROM taseron_odeme_log
      WHERE firma = $1
      ORDER BY tarih DESC, created_at DESC
      LIMIT 50
    `, [firma]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Taşeron Banka Bilgileri ────────────────────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS taseron_banka (
    id           SERIAL PRIMARY KEY,
    firma        TEXT NOT NULL UNIQUE,
    banka_adi    TEXT,
    sube         TEXT,
    hesap_no     TEXT,
    iban         TEXT,
    hesap_sahibi TEXT,
    aciklama     TEXT,
    created_at   TIMESTAMP DEFAULT NOW(),
    updated_at   TIMESTAMP DEFAULT NOW()
  );
`).catch(e => console.error("taseron_banka tablo hatası:", e.message));

app.get("/finance/taseron-banka", requireFinanceAuth, async (req, res) => {
  try {
    const { firma } = req.query;
    if (firma) {
      const r = await pool.query("SELECT * FROM taseron_banka WHERE firma = $1", [firma]);
      return res.json(r.rows[0] || null);
    }
    const r = await pool.query("SELECT * FROM taseron_banka ORDER BY firma ASC");
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/finance/taseron-banka", requireFinanceAuth, async (req, res) => {
  try {
    const { firma, banka_adi, sube, hesap_no, iban, hesap_sahibi, aciklama } = req.body;
    if (!firma) return res.status(400).json({ error: "firma zorunlu" });
    const r = await pool.query(`
      INSERT INTO taseron_banka (firma, banka_adi, sube, hesap_no, iban, hesap_sahibi, aciklama)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (firma) DO UPDATE SET
        banka_adi    = EXCLUDED.banka_adi,
        sube         = EXCLUDED.sube,
        hesap_no     = EXCLUDED.hesap_no,
        iban         = EXCLUDED.iban,
        hesap_sahibi = EXCLUDED.hesap_sahibi,
        aciklama     = EXCLUDED.aciklama,
        updated_at   = NOW()
      RETURNING *
    `, [firma, banka_adi||null, sube||null, hesap_no||null, iban||null, hesap_sahibi||null, aciklama||null]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Taşeron ödeme Excel export
app.get("/finance/taseron-odeme-excel", requireFinanceAuth, async (req, res) => {
  try {
    const { firma } = req.query;
    const params = [];
    let where = "";
    if (firma) {
      params.push(firma);
      where = "WHERE firma = $1";
    }

    const r = await pool.query(`
      SELECT firma, tutar, tarih, aciklama, dagilim, created_at
      FROM taseron_odeme_log ${where}
      ORDER BY firma ASC, tarih DESC, created_at DESC
    `, params);

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Taşeron Ödemeleri");

    const cols = [
      { header: "Firma",         key: "firma",     width: 30 },
      { header: "Ödeme Tarihi",  key: "tarih",     width: 16 },
      { header: "Tutar (₺)",     key: "tutar",     width: 18 },
      { header: "Açıklama",      key: "aciklama",  width: 28 },
      { header: "Dağılım (Faturalar)", key: "dagilim", width: 55 },
    ];
    ws.columns = cols;

    // Başlık satırı
    ws.mergeCells("A1:E1");
    const title = ws.getCell("A1");
    const now = new Date().toLocaleDateString("tr-TR");
    title.value = firma
      ? `TAŞERON ÖDEME RAPORU — ${firma.toUpperCase()} (${now})`
      : `TAŞERON ÖDEME RAPORU — TÜM FİRMALAR (${now})`;
    title.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    title.alignment = { horizontal: "center", vertical: "middle" };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "7E22CE" } };
    ws.getRow(1).height = 28;

    // Kolon başlıkları
    const hdr = ws.getRow(2);
    cols.forEach((col, i) => {
      const cell = hdr.getCell(i + 1);
      cell.value = col.header;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "6D28D9" } };
      cell.border = {
        top: { style: "thin", color: { argb: "D9D9D9" } },
        left: { style: "thin", color: { argb: "D9D9D9" } },
        bottom: { style: "thin", color: { argb: "D9D9D9" } },
        right: { style: "thin", color: { argb: "D9D9D9" } },
      };
    });
    hdr.height = 22;

    // Firma gruplamaları
    let lastFirma = null;
    let firmaStart = 3;
    const firmaGroups = [];

    r.rows.forEach((row, idx) => {
      const rowNum = idx + 3;
      const dagilimStr = Array.isArray(row.dagilim)
        ? row.dagilim.map(d => `${d.fatura_no}: ₺${Number(d.odeme).toLocaleString("tr-TR",{maximumFractionDigits:0})}`).join(" | ")
        : "";

      const isEven = idx % 2 === 0;
      const bgColor = isEven ? "FAF5FF" : "FFFFFF";

      const newRow = ws.addRow({
        firma: row.firma || "",
        tarih: row.tarih ? String(row.tarih).slice(0, 10) : "",
        tutar: Number(row.tutar || 0),
        aciklama: row.aciklama || "",
        dagilim: dagilimStr,
      });

      newRow.eachCell((cell, colNum) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
        cell.border = {
          top: { style: "thin", color: { argb: "E9D5FF" } },
          left: { style: "thin", color: { argb: "E9D5FF" } },
          bottom: { style: "thin", color: { argb: "E9D5FF" } },
          right: { style: "thin", color: { argb: "E9D5FF" } },
        };
        // Tutar sütunu sağa hizalı, bold
        if (colNum === 3) {
          cell.alignment = { horizontal: "right" };
          cell.font = { bold: true, color: { argb: "6D28D9" } };
          cell.numFmt = '#,##0';
        }
      });

      // Firma gruplaması için izle
      if (row.firma !== lastFirma) {
        if (lastFirma !== null) firmaGroups.push({ firma: lastFirma, start: firmaStart, end: rowNum - 1 });
        lastFirma = row.firma;
        firmaStart = rowNum;
      }
    });

    if (lastFirma !== null) firmaGroups.push({ firma: lastFirma, start: firmaStart, end: r.rows.length + 2 });

    // Toplam satırları (firma bazında)
    firmaGroups.forEach(g => {
      const totalRow = ws.addRow({
        firma: `TOPLAM — ${g.firma}`,
        tarih: "",
        tutar: { formula: `SUM(C${g.start}:C${g.end})` },
        aciklama: "",
        dagilim: `${g.end - g.start + 1} ödeme`,
      });
      totalRow.eachCell((cell, colNum) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "7E22CE" } };
        if (colNum === 3) { cell.alignment = { horizontal: "right" }; cell.numFmt = '#,##0'; }
      });
    });

    ws.autoFilter = { from: "A2", to: "E2" };
    ws.views = [{ state: "frozen", xSplit: 0, ySplit: 2, showGridLines: false }];

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const safeFirma = firma ? `_${firma.replace(/[^a-zA-Z0-9]/g, "_")}` : "_tum";
    res.setHeader("Content-Disposition", `attachment; filename=taseron_odemeler${safeFirma}_${new Date().toISOString().slice(0,10)}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch(e) {
    console.error("TASERON ODEME EXCEL ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Taşeron ödeme senkron yardımcıları ──────────────────────────────
// FIFO mahsup: firmanın açık faturalarını eskiden yeniye kapatır.
// Transaction client'ı ile çağrılır; { dagilim, kalan } döner
// (kalan > 0 → faturaya mahsup edilemeyen kısım = AVANS).
async function fifoTaseronMahsup(client, firma, odemeAmount, tarih) {
  const faturalar = await client.query(`
    SELECT id, fatura_no, toplam_tutar, odenen_tutar,
           COALESCE(kalan_borc, 0) AS kalan_borc
    FROM invoice_entries
    WHERE TRIM(COALESCE(NULLIF(rf_montaj_firma,''), tedarikci, '')) = $1
      AND COALESCE(kalan_borc, 0) > 0
    ORDER BY COALESCE(fatura_tarihi, created_at) ASC
    FOR UPDATE
  `, [firma]);
  let kalan = odemeAmount;
  const dagilim = [];
  for (const fatura of faturalar.rows) {
    if (kalan <= 0) break;
    const faturaBorcu = Number(fatura.kalan_borc);
    const buFaturaOdeme = Math.min(kalan, faturaBorcu);
    const yeniOdenen = Number(fatura.odenen_tutar || 0) + buFaturaOdeme;
    const yeniKalan  = faturaBorcu - buFaturaOdeme;
    await client.query(`UPDATE invoice_entries
      SET odenen_tutar=$1, kalan_borc=$2, odeme_tarihi=$3 WHERE id=$4`,
      [yeniOdenen, yeniKalan, tarih, fatura.id]);
    dagilim.push({ fatura_id: fatura.id, fatura_no: fatura.fatura_no, odeme: buFaturaOdeme, kalan_sonra: yeniKalan });
    kalan -= buFaturaOdeme;
  }
  if (kalan > 0) dagilim.push({ fatura_no: "AVANS (fatura bekleniyor)", odeme: kalan, avans: true });
  return { dagilim, kalan };
}
// Ödeme logunu geri al: dagilim'deki fatura mahsuplarını açar
async function revertTaseronLog(client, log) {
  let dagilim = [];
  try { dagilim = Array.isArray(log.dagilim) ? log.dagilim : JSON.parse(log.dagilim || "[]"); } catch { dagilim = []; }
  for (const d of dagilim) {
    if (!d.fatura_id || !Number(d.odeme || 0)) continue;
    await client.query(`UPDATE invoice_entries SET
        odenen_tutar = GREATEST(0, COALESCE(odenen_tutar,0) - $1),
        kalan_borc   = COALESCE(kalan_borc,0) + $1
      WHERE id = $2`, [Number(d.odeme), d.fatura_id]);
  }
}
pool.query(`ALTER TABLE marka_taseron_odeme ADD COLUMN IF NOT EXISTS odeme_log_id INTEGER`).catch(() => {});

// FIFO ödeme dağıtım motoru
app.post("/finance/taseron-odeme", requireFinanceAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { firma, tutar, tarih, aciklama, firma_marka } = req.body;
    if (!firma || !tutar || !tarih) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "firma, tutar ve tarih zorunlu" });
    }
    // AHY seçildiyse ödeme AHY Taşeron Faturaları paneline + AHY nakit akışına da düşer
    const isAhyOdeme = String(firma_marka || "").toUpperCase() === "AHY";

    const odemeAmount = Number(tutar);
    if (odemeAmount <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Ödeme tutarı sıfırdan büyük olmalı" });
    }

    // Açık faturalar FIFO kapatılır; kalan kısım AVANS olur
    const { dagilim, kalan } = await fifoTaseronMahsup(client, firma, odemeAmount, tarih);

    // Ödeme logu kaydet
    const logIns = await client.query(`
      INSERT INTO taseron_odeme_log (firma, tutar, tarih, aciklama, dagilim, avans_tutar)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
    `, [firma, odemeAmount, tarih, aciklama || null, JSON.stringify(dagilim), kalan > 0 ? kalan : 0]);
    const logId = logIns.rows[0].id;

    // AHY ödemesi: AHY Taşeron Faturaları paneli + AHY nakit akışına da yaz
    // (avans kısmı AVANS, faturaya mahsup kısmı FATURA_ODEME olarak ayrı satır;
    // odeme_log_id bağıyla iki taraf senkron kalır)
    if (isAhyOdeme) {
      const mahsup = odemeAmount - kalan;
      if (mahsup > 0) {
        await client.query(`INSERT INTO marka_taseron_odeme
            (marka, taseron_adi, tip, tutar, tarih, aciklama, odeme_log_id)
          VALUES ('AHY', $1, 'FATURA_ODEME', $2, $3, $4, $5)`,
          [firma, mahsup, tarih, aciklama || "ERC ödeme girişinden", logId]);
      }
      if (kalan > 0) {
        await client.query(`INSERT INTO marka_taseron_odeme
            (marka, taseron_adi, tip, tutar, tarih, aciklama, odeme_log_id)
          VALUES ('AHY', $1, 'AVANS', $2, $3, $4, $5)`,
          [firma, kalan, tarih, aciklama || "ERC ödeme girişinden", logId]);
      }
    }

    await client.query("COMMIT");

    res.json({
      ok: true,
      log_id: logId, // form içinden dekont yüklemek için
      odenen: odemeAmount - kalan,
      avans: kalan > 0 ? kalan : 0,
      fazla: 0,
      dagilim,
    });
  } catch(e) {
    await client.query("ROLLBACK");
    console.error("TASERON ODEME ERROR:", e.message);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Taşeron ödemesini sil: fatura mahsupları geri açılır, varsa AHY kopyası da silinir
app.delete("/finance/taseron-odeme/:id", requireFinanceAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const logR = await client.query(`SELECT * FROM taseron_odeme_log WHERE id=$1 FOR UPDATE`, [req.params.id]);
    const log = logR.rows[0];
    if (!log) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Ödeme kaydı bulunamadı" });
    }
    // Fatura mahsuplarını geri aç
    await revertTaseronLog(client, log);
    // AHY kopyasını sil: önce odeme_log_id bağıyla; eski kayıtlar için
    // (bağ yoksa) taşeron+tarih+tip+tutar eşleşmesiyle en yeni kayıt
    const linked = await client.query(`DELETE FROM marka_taseron_odeme WHERE odeme_log_id=$1`, [req.params.id]);
    if (linked.rowCount === 0) {
      const avans = Number(log.avans_tutar || 0);
      const mahsup = Number(log.tutar || 0) - avans;
      const silAhy = async (tip, tutar) => {
        if (tutar <= 0) return;
        await client.query(`DELETE FROM marka_taseron_odeme WHERE id IN (
            SELECT id FROM marka_taseron_odeme
            WHERE marka='AHY' AND taseron_adi=$1 AND tarih=$2::date AND UPPER(COALESCE(tip,'AVANS'))=$3 AND tutar=$4
            ORDER BY id DESC LIMIT 1)`,
          [log.firma, log.tarih, tip, tutar]);
      };
      await silAhy("AVANS", avans);
      await silAhy("FATURA_ODEME", mahsup);
    }
    await client.query(`DELETE FROM taseron_odeme_log WHERE id=$1`, [req.params.id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("TASERON ODEME SIL ERROR:", e.message);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get("/", (req, res) => {
  res.json({ ok: true, service: "erc-backend" });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ── SUBCONS MASTER LIST ──────────────────────────────────────────────────────
app.get("/subcons", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT subcon_name FROM subcons ORDER BY subcon_name ASC"
    );
    res.json({ subcons: result.rows.map(r => r.subcon_name) });
  } catch (err) {
    console.error("GET /subcons ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/subcons", async (req, res) => {
  try {
    const name = (req.body.subcon_name || "").trim().toUpperCase();
    if (!name) return res.status(400).json({ error: "subcon_name boş olamaz" });
    await pool.query(
      "INSERT INTO subcons (subcon_name) VALUES ($1) ON CONFLICT (subcon_name) DO NOTHING",
      [name]
    );
    res.json({ ok: true, subcon_name: name });
  } catch (err) {
    console.error("POST /subcons ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ========================= TAŞERON FATURA YÖNETİMİ ========================= */

app.get("/taseron/fatura/list", authMiddleware, async (req, res) => {
  try {
    const { taseron, durum } = req.query;
    let sql = `SELECT tf.*, (SELECT COUNT(*) FROM taseron_fatura_kalem k WHERE k.fatura_id = tf.id) AS kalem_count FROM taseron_fatura tf WHERE 1=1`;
    const params = [];
    if (taseron) { params.push(`%${taseron}%`); sql += ` AND LOWER(tf.taseron_adi) LIKE LOWER($${params.length})`; }
    if (durum) { params.push(durum); sql += ` AND tf.durum = $${params.length}`; }
    sql += ` ORDER BY tf.created_at DESC`;
    const result = await pool.query(sql, params);
    res.json({ ok: true, rows: result.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get("/taseron/fatura/:id", authMiddleware, async (req, res) => {
  try {
    const fatura = await pool.query(`SELECT * FROM taseron_fatura WHERE id=$1`, [req.params.id]);
    if (!fatura.rows[0]) return res.status(404).json({ ok: false, error: "Fatura bulunamadı" });
    const kalemler = await pool.query(`SELECT * FROM taseron_fatura_kalem WHERE fatura_id=$1 ORDER BY id`, [req.params.id]);
    res.json({ ok: true, fatura: fatura.rows[0], kalemler: kalemler.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post("/taseron/fatura/add", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { taseron_adi, fatura_no, fatura_tarihi, toplam_tutar, kdv_tutar, genel_toplam, aciklama, kalemler } = req.body;
    const gt = Number(genel_toplam || 0) || (Number(toplam_tutar || 0) + Number(kdv_tutar || 0));
    const faturaRes = await client.query(
      `INSERT INTO taseron_fatura (taseron_adi, fatura_no, fatura_tarihi, toplam_tutar, kdv_tutar, genel_toplam, kalan_tutar, aciklama, durum)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,'bekliyor') RETURNING *`,
      [taseron_adi, fatura_no || null, fatura_tarihi || null, Number(toplam_tutar || 0), Number(kdv_tutar || 0), gt, aciklama || null]
    );
    const faturaId = faturaRes.rows[0].id;
    if (Array.isArray(kalemler) && kalemler.length > 0) {
      for (const k of kalemler) {
        const t = Number(k.tutar || 0);
        await client.query(
          `INSERT INTO taseron_fatura_kalem (fatura_id, site_id, saha_adi, kalem_aciklama, tutar, odenen, kalan) VALUES ($1,$2,$3,$4,$5,0,$5)`,
          [faturaId, k.site_id || null, k.saha_adi || null, k.kalem_aciklama || null, t]
        );
      }
    }
    await client.query("COMMIT");
    const full = await pool.query(`SELECT * FROM taseron_fatura WHERE id=$1`, [faturaId]);
    const fullK = await pool.query(`SELECT * FROM taseron_fatura_kalem WHERE fatura_id=$1 ORDER BY id`, [faturaId]);
    res.json({ ok: true, fatura: full.rows[0], kalemler: fullK.rows });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ ok: false, error: err.message });
  } finally { client.release(); }
});

app.put("/taseron/fatura/:id", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { id } = req.params;
    const { taseron_adi, fatura_no, fatura_tarihi, toplam_tutar, kdv_tutar, genel_toplam, aciklama, kalemler } = req.body;
    const gt = Number(genel_toplam || 0) || (Number(toplam_tutar || 0) + Number(kdv_tutar || 0));
    let totalOdenen = 0;
    if (Array.isArray(kalemler)) totalOdenen = kalemler.reduce((s, k) => s + Number(k.odenen || 0), 0);
    const durum = totalOdenen >= gt ? 'odendi' : totalOdenen > 0 ? 'kismi' : 'bekliyor';
    await client.query(
      `UPDATE taseron_fatura SET taseron_adi=$1, fatura_no=$2, fatura_tarihi=$3, toplam_tutar=$4, kdv_tutar=$5, genel_toplam=$6, odenen_tutar=$7, kalan_tutar=$8, aciklama=$9, durum=$10 WHERE id=$11`,
      [taseron_adi, fatura_no || null, fatura_tarihi || null, Number(toplam_tutar || 0), Number(kdv_tutar || 0), gt, totalOdenen, Math.max(gt - totalOdenen, 0), aciklama || null, durum, id]
    );
    if (Array.isArray(kalemler)) {
      await client.query(`DELETE FROM taseron_fatura_kalem WHERE fatura_id=$1`, [id]);
      for (const k of kalemler) {
        const t = Number(k.tutar || 0);
        const o = Number(k.odenen || 0);
        await client.query(
          `INSERT INTO taseron_fatura_kalem (fatura_id, site_id, saha_adi, kalem_aciklama, tutar, odenen, kalan) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, k.site_id || null, k.saha_adi || null, k.kalem_aciklama || null, t, o, Math.max(t - o, 0)]
        );
      }
    }
    await client.query("COMMIT");
    const full = await pool.query(`SELECT * FROM taseron_fatura WHERE id=$1`, [id]);
    const fullK = await pool.query(`SELECT * FROM taseron_fatura_kalem WHERE fatura_id=$1 ORDER BY id`, [id]);
    res.json({ ok: true, fatura: full.rows[0], kalemler: fullK.rows });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ ok: false, error: err.message });
  } finally { client.release(); }
});

app.delete("/taseron/fatura/:id", authMiddleware, async (req, res) => {
  try {
    await pool.query(`DELETE FROM taseron_fatura WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

function parseTaseronFaturaText(text, filenameHint) {
  // ── Yapılandırılmış alanlar için sofistike parseri kullan ──────────────────
  // parseTurkishInvoice e-fatura 2-sütunlu düzenini doğru işler
  const parsed = parseTurkishInvoice(text);

  const parseNum = s => {
    if (!s) return 0;
    s = String(s).replace(/\s|TL|₺/g, "").trim();
    if (!s) return 0;
    if (/\d\.\d{3},\d/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else if (/\d,\d{3}\.\d/.test(s)) s = s.replace(/,/g, "");
    else if (/^\d+\.\d{3}$/.test(s)) s = s.replace(".", "");
    else s = s.replace(/\./g, "").replace(",", ".");
    return parseFloat(s) || 0;
  };

  let fatura_no    = parsed.fatura_no    || null;
  let fatura_tarihi= parsed.fatura_tarihi|| null;
  let taseron_adi  = parsed.tedarikci    || null;
  let toplam_tutar = parseNum(parsed.tutar);
  let kdv_tutar    = parseNum(parsed.kdv);
  let genel_toplam = parseNum(parsed.toplam_tutar);

  // ── Dosya adından fatura no fallback ─────────────────────────────────────
  // Örn: "ETS2026000000007.pdf" → fatura_no = "ETS2026000000007"
  if (!fatura_no && filenameHint) {
    const fnBase = filenameHint.replace(/\.[^.]+$/, ""); // uzantıyı çıkar
    // Yıl bazlı format: ETS2026000000007, ERS2026000000115, FAT2025000001 vb.
    const fnM = fnBase.match(/([A-Z]{2,8}(?:20|19)\d{2}\d{4,})/i);
    if (fnM) fatura_no = fnM[1].toUpperCase();
    // Yoksa dosya adının tamamını fatura no olarak al (mantıklı görünüyorsa)
    else if (/^[A-Z0-9\-\/]{5,40}$/i.test(fnBase)) fatura_no = fnBase.toUpperCase();
  }

  // ── Tutar dengeleme ────────────────────────────────────────────────────────
  if (!toplam_tutar && genel_toplam && kdv_tutar) toplam_tutar = Math.round((genel_toplam - kdv_tutar) * 100) / 100;
  if (!genel_toplam && toplam_tutar && kdv_tutar) genel_toplam = Math.round((toplam_tutar + kdv_tutar) * 100) / 100;

  // ── Site ID / kalem çıkarma ────────────────────────────────────────────────
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const siteMap = new Map();
  const sitePattern = /\b([A-Z]{2,5}[-_]?[0-9]{3,8})\b/g;
  for (const line of lines) {
    sitePattern.lastIndex = 0;
    const siteMatch = sitePattern.exec(line);
    if (siteMatch) {
      const sid = siteMatch[0].toUpperCase().replace(/\s+/g, "");
      const amounts = [...line.matchAll(/([\d]{1,3}(?:\.[\d]{3})*,[\d]{2})/g)].map(m => parseNum(m[1]));
      if (amounts.length > 0) {
        const amt = amounts[amounts.length - 1];
        if (amt > 0) siteMap.set(sid, (siteMap.get(sid) || 0) + amt);
      }
    }
  }
  const kalemler = Array.from(siteMap.entries()).map(([site_id, tutar]) => ({ site_id, saha_adi: "", kalem_aciklama: "", tutar }));

  console.log("[parseTaseronFaturaText]", { fatura_no, fatura_tarihi, taseron_adi, toplam_tutar, kdv_tutar, genel_toplam, kalemCount: kalemler.length });
  return { fatura_no, fatura_tarihi, toplam_tutar, kdv_tutar, genel_toplam, taseron_adi, kalemler };
}

const uploadTaseronFaturaParse = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
app.post("/taseron/fatura/pdf-parse", authMiddleware, uploadTaseronFaturaParse.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "Dosya gelmedi" });
  const isPDF = utf8Name(req.file.originalname).toLowerCase().endsWith(".pdf") || req.file.mimetype === "application/pdf";
  try {
    const rawText = await extractPdfText(req.file.buffer, isPDF);
    // Dosya adını fatura no fallback olarak gönder (ETS2026000000007.pdf gibi)
    const result = parseTaseronFaturaText(rawText, utf8Name(req.file.originalname));
    res.json({ ok: true, ...result, raw_snippet: rawText.slice(0, 500) });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post("/taseron/odeme/add", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { taseron_adi, fatura_id, tutar, odeme_tarihi, aciklama } = req.body;
    if (!tutar || Number(tutar) <= 0) throw new Error("Geçerli tutar giriniz");
    const odemeRes = await client.query(
      `INSERT INTO taseron_odeme (taseron_adi, fatura_id, tutar, odeme_tarihi, aciklama) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [taseron_adi, fatura_id || null, Number(tutar), odeme_tarihi || null, aciklama || null]
    );
    if (fatura_id) {
      const kalemler = await client.query(`SELECT * FROM taseron_fatura_kalem WHERE fatura_id=$1 AND kalan > 0 ORDER BY id`, [fatura_id]);
      let remaining = Number(tutar);
      for (const k of kalemler.rows) {
        if (remaining <= 0) break;
        const kalan = Number(k.kalan || 0);
        const pay = Math.min(remaining, kalan);
        await client.query(`UPDATE taseron_fatura_kalem SET odenen=$1, kalan=$2 WHERE id=$3`, [Number(k.odenen || 0) + pay, Math.max(kalan - pay, 0), k.id]);
        remaining -= pay;
      }
      const totals = await client.query(`SELECT SUM(odenen) as total_odenen, SUM(kalan) as total_kalan FROM taseron_fatura_kalem WHERE fatura_id=$1`, [fatura_id]);
      const totalOdenen = Number(totals.rows[0]?.total_odenen || 0);
      const totalKalan = Number(totals.rows[0]?.total_kalan || 0);
      const durum = totalKalan <= 0 ? 'odendi' : totalOdenen > 0 ? 'kismi' : 'bekliyor';
      await client.query(`UPDATE taseron_fatura SET odenen_tutar=$1, kalan_tutar=$2, durum=$3 WHERE id=$4`, [totalOdenen, totalKalan, durum, fatura_id]);
    }
    await client.query("COMMIT");
    res.json({ ok: true, odeme: odemeRes.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ ok: false, error: err.message });
  } finally { client.release(); }
});

app.get("/taseron/odeme/list", authMiddleware, async (req, res) => {
  try {
    const { taseron, fatura_id } = req.query;
    let sql = `SELECT o.*, tf.fatura_no FROM taseron_odeme o LEFT JOIN taseron_fatura tf ON tf.id = o.fatura_id WHERE 1=1`;
    const params = [];
    if (taseron) { params.push(`%${taseron}%`); sql += ` AND LOWER(o.taseron_adi) LIKE LOWER($${params.length})`; }
    if (fatura_id) { params.push(fatura_id); sql += ` AND o.fatura_id=$${params.length}`; }
    sql += ` ORDER BY o.created_at DESC`;
    const result = await pool.query(sql, params);
    res.json({ ok: true, rows: result.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.delete("/taseron/odeme/:id", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const odeme = await client.query(`SELECT * FROM taseron_odeme WHERE id=$1`, [req.params.id]);
    if (!odeme.rows[0]) throw new Error("Ödeme bulunamadı");
    const { tutar, fatura_id } = odeme.rows[0];
    await client.query(`DELETE FROM taseron_odeme WHERE id=$1`, [req.params.id]);
    if (fatura_id) {
      const kalemler = await client.query(`SELECT * FROM taseron_fatura_kalem WHERE fatura_id=$1 ORDER BY id DESC`, [fatura_id]);
      let toReturn = Number(tutar);
      for (const k of kalemler.rows) {
        if (toReturn <= 0) break;
        const odenen = Number(k.odenen || 0);
        const ret = Math.min(toReturn, odenen);
        await client.query(`UPDATE taseron_fatura_kalem SET odenen=$1, kalan=$2 WHERE id=$3`, [odenen - ret, Number(k.kalan || 0) + ret, k.id]);
        toReturn -= ret;
      }
      const totals = await client.query(`SELECT SUM(odenen) as total_odenen, SUM(kalan) as total_kalan FROM taseron_fatura_kalem WHERE fatura_id=$1`, [fatura_id]);
      const totalOdenen = Number(totals.rows[0]?.total_odenen || 0);
      const totalKalan = Number(totals.rows[0]?.total_kalan || 0);
      const durum = totalKalan <= 0 ? 'odendi' : totalOdenen > 0 ? 'kismi' : 'bekliyor';
      await client.query(`UPDATE taseron_fatura SET odenen_tutar=$1, kalan_tutar=$2, durum=$3 WHERE id=$4`, [totalOdenen, totalKalan, durum, fatura_id]);
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ ok: false, error: err.message });
  } finally { client.release(); }
});

app.get("/taseron/hakedis-ozet/:taseron_adi", authMiddleware, async (req, res) => {
  try {
    const taseron = req.params.taseron_adi;
    const faturalar = await pool.query(
      `SELECT tf.*, COALESCE(json_agg(k ORDER BY k.id) FILTER (WHERE k.id IS NOT NULL), '[]') AS kalemler
       FROM taseron_fatura tf LEFT JOIN taseron_fatura_kalem k ON k.fatura_id = tf.id
       WHERE LOWER(TRIM(tf.taseron_adi)) = LOWER(TRIM($1))
       GROUP BY tf.id ORDER BY tf.fatura_tarihi DESC NULLS LAST`, [taseron]
    );
    const odemeler = await pool.query(
      `SELECT * FROM taseron_odeme WHERE LOWER(TRIM(taseron_adi)) = LOWER(TRIM($1)) ORDER BY odeme_tarihi DESC NULLS LAST`, [taseron]
    );
    const totFatura = faturalar.rows.reduce((s, r) => s + Number(r.genel_toplam || 0), 0);
    const totOdeme = odemeler.rows.reduce((s, r) => s + Number(r.tutar || 0), 0);
    res.json({ ok: true, taseron_adi: taseron, total_fatura: totFatura, total_odeme: totOdeme, kalan_borc: Math.max(totFatura - totOdeme, 0), fazla_odeme: Math.max(totOdeme - totFatura, 0), faturalar: faturalar.rows, odemeler: odemeler.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get("/taseron/hakedis-excel/:taseron_adi", authMiddleware, async (req, res) => {
  try {
    const taseron = req.params.taseron_adi;
    const faturalar = await pool.query(
      `SELECT tf.*, COALESCE(json_agg(k ORDER BY k.id) FILTER (WHERE k.id IS NOT NULL), '[]') AS kalemler
       FROM taseron_fatura tf LEFT JOIN taseron_fatura_kalem k ON k.fatura_id = tf.id
       WHERE LOWER(TRIM(tf.taseron_adi)) = LOWER(TRIM($1))
       GROUP BY tf.id ORDER BY tf.fatura_tarihi NULLS LAST`, [taseron]
    );
    const odemeler = await pool.query(`SELECT * FROM taseron_odeme WHERE LOWER(TRIM(taseron_adi)) = LOWER(TRIM($1)) ORDER BY odeme_tarihi NULLS LAST`, [taseron]);
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Taşeron Hakediş");
    ws.addRow([`${taseron} — Taşeron Hakediş Raporu`]);
    ws.getRow(1).font = { bold: true, size: 14 };
    ws.addRow([]);
    ws.addRow(["FATURALAR"]);
    ws.getRow(3).font = { bold: true };
    const hdr = ws.addRow(["Fatura No", "Tarih", "Matrah (TL)", "KDV (TL)", "Genel Toplam (TL)", "Ödenen (TL)", "Kalan (TL)", "Durum"]);
    hdr.font = { bold: true };
    hdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    for (const f of faturalar.rows) {
      ws.addRow([f.fatura_no || "-", f.fatura_tarihi ? String(f.fatura_tarihi).slice(0, 10) : "-", Number(f.toplam_tutar || 0), Number(f.kdv_tutar || 0), Number(f.genel_toplam || 0), Number(f.odened_tutar || 0), Number(f.kalan_tutar || 0), f.durum === 'odendi' ? 'Ödendi' : f.durum === 'kismi' ? 'Kısmi' : 'Bekliyor']);
      if (Array.isArray(f.kalemler) && f.kalemler.length > 0) {
        const kHdr = ws.addRow(["", "Site ID", "Saha Adı", "Kalem", "Tutar (TL)", "Ödenen (TL)", "Kalan (TL)"]);
        kHdr.font = { italic: true, color: { argb: "FF6B7280" } };
        for (const k of f.kalemler) {
          if (!k) continue;
          ws.addRow(["", k.site_id || "-", k.saha_adi || "-", k.kalem_aciklama || "-", Number(k.tutar || 0), Number(k.odenen || 0), Number(k.kalan || 0)]);
        }
      }
    }
    ws.addRow([]);
    ws.addRow(["ÖDEMELER"]);
    ws.getLastRow().font = { bold: true };
    const oHdr = ws.addRow(["Tarih", "Fatura No", "Tutar (TL)", "Açıklama"]);
    oHdr.font = { bold: true };
    oHdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
    for (const o of odemeler.rows) ws.addRow([o.odeme_tarihi ? String(o.odeme_tarihi).slice(0, 10) : "-", o.fatura_no || "-", Number(o.tutar || 0), o.aciklama || "-"]);
    const totFatura = faturalar.rows.reduce((s, r) => s + Number(r.genel_toplam || 0), 0);
    const totOdeme = odemeler.rows.reduce((s, r) => s + Number(r.tutar || 0), 0);
    ws.addRow([]);
    ws.addRow(["ÖZET"]);
    ws.getLastRow().font = { bold: true };
    ws.addRow(["Toplam Fatura (TL)", totFatura]);
    ws.addRow(["Toplam Ödeme (TL)", totOdeme]);
    const kalanRow = ws.addRow(["Kalan Borç (TL)", Math.max(totFatura - totOdeme, 0)]);
    kalanRow.font = { bold: true, color: { argb: Math.max(totFatura - totOdeme, 0) > 0 ? "FFDC2626" : "FF16A34A" } };
    ws.columns.forEach(col => { col.width = 20; });
    const safeFileName = taseron.replace(/[^a-zA-Z0-9_-]/g, "_");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFileName}_hakedis.xlsx"; filename*=UTF-8''${encodeURIComponent(taseron + "_hakedis.xlsx")}`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get("/taseron/qc-kalemler/:taseron_adi", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT mw.site_code, mw.bolge, mw.project_code, mw.item_code, mw.item_description,
        COALESCE(mw.done_qty, 0) AS done_qty, mw.subcon_name, mw.qc_durum,
        COALESCE(pr.unit_price, 0) AS unit_price, COALESCE(pr.currency, 'TRY') AS currency,
        COALESCE(mw.done_qty, 0) * COALESCE(pr.unit_price, 0) AS tutar
      FROM master_works mw
      LEFT JOIN po_rows pr ON pr.project_code = mw.project_code AND pr.site_code = mw.site_code AND pr.item_code = mw.item_code
      WHERE LOWER(TRIM(mw.subcon_name)) = LOWER(TRIM($1)) AND mw.qc_durum = 'OK' AND COALESCE(mw.done_qty, 0) > 0
      ORDER BY mw.bolge, mw.site_code`, [req.params.taseron_adi]);
    res.json({ ok: true, rows: result.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
/* ========================= / TAŞERON FATURA YÖNETİMİ ========================= */

/* ========================= BÖLGE FATURA GİRİŞİ ========================= */
// Bölge analizi panelinden FEDERAL/UBS için fatura girişi
async function ensureBolgeFaturaTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bolge_fatura (
      id           SERIAL PRIMARY KEY,
      taseron_adi  TEXT NOT NULL,
      site_code    TEXT NOT NULL,
      item_code    TEXT,
      item_description TEXT,
      fatura_no    TEXT,
      fatura_tarihi DATE,
      fatura_miktari NUMERIC(18,2) DEFAULT 0,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// Site koduna göre kalem listesi — master_works + po_rows join (Bölge Analizi ile aynı kaynak)
app.get("/bolge-fatura/site-items", requireFinanceAuth, async (req, res) => {
  try {
    const siteCode = String(req.query.site_code || "").trim().toUpperCase();
    if (!siteCode) return res.json({ ok: true, items: [] });

    // Önce master_works + po_rows join ile dene (Bölge Analizi'nin kaynağı)
    const result = await pool.query(`
      SELECT DISTINCT
        mw.item_code,
        COALESCE(mw.item_description, pr.item_description) AS item_description,
        COALESCE(pr.unit_price, 0)        AS unit_price,
        COALESCE(pr.currency, 'TRY')      AS currency,
        COALESCE(pr.billed_qty, 0)        AS billed_qty,
        COALESCE(mw.done_qty, 0)          AS done_qty
      FROM master_works mw
      LEFT JOIN po_rows pr
        ON  pr.project_code = mw.project_code
        AND UPPER(TRIM(pr.site_code))   = UPPER(TRIM(mw.site_code))
        AND TRIM(pr.item_code)          = TRIM(mw.item_code)
      WHERE UPPER(TRIM(mw.site_code)) = $1
        AND mw.item_code IS NOT NULL
      ORDER BY item_description
    `, [siteCode]);

    // Hiç sonuç yoksa doğrudan po_rows'a bak
    if (result.rows.length === 0) {
      const fallback = await pool.query(`
        SELECT DISTINCT
          item_code,
          item_description,
          COALESCE(unit_price, 0)   AS unit_price,
          COALESCE(currency, 'TRY') AS currency,
          COALESCE(billed_qty, 0)   AS billed_qty,
          0                         AS done_qty
        FROM po_rows
        WHERE UPPER(TRIM(site_code)) = $1
          AND item_description IS NOT NULL
        ORDER BY item_description
      `, [siteCode]);
      return res.json({ ok: true, items: fallback.rows });
    }

    res.json({ ok: true, items: result.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Fatura listesi (taseron_adi ile filtrele)
app.get("/bolge-fatura/list", requireFinanceAuth, async (req, res) => {
  try {
    await ensureBolgeFaturaTable();
    const taseron = req.query.taseron_adi ? String(req.query.taseron_adi).trim() : null;
    const result = taseron
      ? await pool.query(`SELECT * FROM bolge_fatura WHERE LOWER(TRIM(taseron_adi))=LOWER($1) ORDER BY created_at DESC`, [taseron])
      : await pool.query(`SELECT * FROM bolge_fatura ORDER BY created_at DESC`);
    res.json({ ok: true, rows: result.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Fatura ekle
app.post("/bolge-fatura/add", requireFinanceAuth, async (req, res) => {
  try {
    await ensureBolgeFaturaTable();
    const { taseron_adi, site_code, item_code, item_description, fatura_no, fatura_tarihi, fatura_miktari } = req.body;
    if (!taseron_adi || !site_code) return res.status(400).json({ ok: false, error: "Taşeron ve site kodu zorunlu" });
    if (!String(fatura_no || '').trim() && !(Number(fatura_miktari || 0) > 0)) {
      return res.status(400).json({ ok: false, error: "Fatura No veya Fatura Miktarı girilmeli (boş fatura kaydedilemez)" });
    }
    const result = await pool.query(`
      INSERT INTO bolge_fatura (taseron_adi, site_code, item_code, item_description, fatura_no, fatura_tarihi, fatura_miktari)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
    `, [taseron_adi, site_code.toUpperCase(), item_code||null, item_description||null,
        fatura_no||null, fatura_tarihi||null, Number(fatura_miktari||0)]);
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Belirli bir saha için girilmiş tüm fatura kayıtları (her taşeron/kalem) — modal'da göster/düzelt/sil
app.get("/bolge-fatura/by-site", requireFinanceAuth, async (req, res) => {
  try {
    await ensureBolgeFaturaTable();
    const site = String(req.query.site_code || "").trim().toUpperCase();
    if (!site) return res.json({ ok: true, rows: [] });
    const result = await pool.query(
      `SELECT id, taseron_adi, site_code, item_code, item_description, fatura_no, fatura_tarihi, fatura_miktari, created_at
       FROM bolge_fatura WHERE UPPER(TRIM(site_code))=$1 ORDER BY taseron_adi, created_at DESC`,
      [site]
    );
    res.json({ ok: true, rows: result.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Fatura güncelle (düzelt)
app.put("/bolge-fatura/:id", requireFinanceAuth, async (req, res) => {
  try {
    await ensureBolgeFaturaTable();
    const { taseron_adi, site_code, item_code, item_description, fatura_no, fatura_tarihi, fatura_miktari } = req.body;
    if (!taseron_adi || !site_code) return res.status(400).json({ ok: false, error: "Taşeron ve site kodu zorunlu" });
    if (!String(fatura_no || '').trim() && !(Number(fatura_miktari || 0) > 0)) {
      return res.status(400).json({ ok: false, error: "Fatura No veya Fatura Miktarı girilmeli" });
    }
    const result = await pool.query(
      `UPDATE bolge_fatura SET taseron_adi=$1, site_code=$2, item_code=$3, item_description=$4, fatura_no=$5, fatura_tarihi=$6, fatura_miktari=$7
       WHERE id=$8 RETURNING id`,
      [taseron_adi, site_code.toUpperCase(), item_code||null, item_description||null, fatura_no||null, fatura_tarihi||null, Number(fatura_miktari||0), req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: "Kayıt bulunamadı" });
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Fatura sil
app.delete("/bolge-fatura/:id", requireFinanceAuth, async (req, res) => {
  try {
    await ensureBolgeFaturaTable();
    await pool.query(`DELETE FROM bolge_fatura WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/* ========================= TAŞERON HAKEDİŞ (MANUEL) ========================= */
// Taşeronun saha/kalem bazında hak ettiği bedelin manuel girişi (sistemdeki hesaplamayı override eder)
async function ensureTaseronHakedisTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS taseron_hakedis (
      id            SERIAL PRIMARY KEY,
      taseron_adi   TEXT NOT NULL,
      site_code     TEXT NOT NULL,
      item_code     TEXT,
      item_description TEXT,
      hakedis_bedeli NUMERIC(18,2) DEFAULT 0,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// Manuel hakediş ekle/güncelle (upsert: aynı taseron+site+item varsa yenile)
app.post("/taseron-hakedis/add", requireFinanceAuth, async (req, res) => {
  try {
    await ensureTaseronHakedisTable();
    const { taseron_adi, site_code, item_code, item_description, hakedis_bedeli } = req.body || {};
    if (!taseron_adi || !site_code) return res.status(400).json({ ok: false, error: "Taşeron ve site kodu zorunlu" });
    if (!(Number(hakedis_bedeli || 0) > 0)) return res.status(400).json({ ok: false, error: "Hakediş bedeli girilmeli" });
    const site = String(site_code).toUpperCase();
    const item = item_code ? String(item_code).trim() : null;
    // Aynı kayıt varsa sil (upsert mantığı)
    if (item) {
      await pool.query(`DELETE FROM taseron_hakedis WHERE UPPER(site_code)=$1 AND TRIM(COALESCE(item_code,''))=$2 AND LOWER(TRIM(taseron_adi))=LOWER($3)`, [site, item, taseron_adi]);
    } else {
      await pool.query(`DELETE FROM taseron_hakedis WHERE UPPER(site_code)=$1 AND COALESCE(item_code,'')='' AND LOWER(TRIM(taseron_adi))=LOWER($2)`, [site, taseron_adi]);
    }
    const result = await pool.query(`
      INSERT INTO taseron_hakedis (taseron_adi, site_code, item_code, item_description, hakedis_bedeli)
      VALUES ($1,$2,$3,$4,$5) RETURNING id
    `, [taseron_adi, site, item, item_description || null, Number(hakedis_bedeli || 0)]);
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Manuel hakediş listesi (opsiyonel taseron filtresi)
app.get("/taseron-hakedis/list", requireFinanceAuth, async (req, res) => {
  try {
    await ensureTaseronHakedisTable();
    const taseron = req.query.taseron_adi ? String(req.query.taseron_adi).trim() : null;
    const result = taseron
      ? await pool.query(`SELECT * FROM taseron_hakedis WHERE LOWER(TRIM(taseron_adi))=LOWER($1) ORDER BY created_at DESC`, [taseron])
      : await pool.query(`SELECT * FROM taseron_hakedis ORDER BY created_at DESC`);
    res.json({ ok: true, rows: result.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Manuel hakediş sil
app.delete("/taseron-hakedis/:id", requireFinanceAuth, async (req, res) => {
  try {
    await ensureTaseronHakedisTable();
    await pool.query(`DELETE FROM taseron_hakedis WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
/* ========================= / TAŞERON HAKEDİŞ (MANUEL) ========================= */

// Fatura Kesilecek Excel — taşeron için Billed Qty > 0 olan kalemler
app.get("/bolge-fatura/kesilecek-excel/:taseron_adi", requireFinanceAuth, async (req, res) => {
  try {
    await ensureBolgeFaturaTable();
    const taseron = req.params.taseron_adi;
    const result = await pool.query(`
      SELECT
        pr.site_code,
        pr.item_code,
        pr.item_description,
        COALESCE(pr.billed_qty, 0) AS billed_qty,
        COALESCE(pr.unit_price, 0) AS unit_price,
        COALESCE(pr.currency, 'TRY') AS currency,
        COALESCE(pr.billed_qty, 0) * COALESCE(pr.unit_price, 0) * 0.80 AS fatura_kesilecek,
        bf.fatura_no,
        bf.fatura_tarihi,
        bf.fatura_miktari
      FROM po_rows pr
      LEFT JOIN bolge_fatura bf
        ON UPPER(TRIM(bf.site_code)) = UPPER(TRIM(pr.site_code))
       AND TRIM(bf.item_code) = TRIM(pr.item_code)
       AND LOWER(TRIM(bf.taseron_adi)) = LOWER($1)
      WHERE COALESCE(pr.billed_qty, 0) > 0
        AND pr.item_description IS NOT NULL
      ORDER BY pr.site_code, pr.item_description
    `, [taseron]);

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Fatura Kesilecek");
    ws.addRow([`${taseron} — Fatura Kesilecek Listesi`]).font = { bold: true, size: 13 };
    ws.addRow([]);
    const hdr = ws.addRow([
      "Site Code", "Item Code", "Item Description",
      "Billed Qty", "Unit Price (TRY)", "Fatura Kesilecek (%80)",
      "Fatura No", "Fatura Tarihi", "Fatura Miktarı (KDV Dahil)"
    ]);
    hdr.font = { bold: true };
    hdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    hdr.font = { bold: true, color: { argb: "FFFFFFFF" } };

    for (const r of result.rows) {
      ws.addRow([
        r.site_code, r.item_code, r.item_description,
        Number(r.billed_qty), Number(r.unit_price),
        Math.round(Number(r.fatura_kesilecek) * 100) / 100,
        r.fatura_no || "", r.fatura_tarihi ? String(r.fatura_tarihi).slice(0,10) : "",
        Number(r.fatura_miktari || 0)
      ]);
    }
    ws.columns = [
      {width:22},{width:16},{width:45},{width:12},{width:16},{width:20},{width:18},{width:14},{width:22}
    ];
    const safe = taseron.replace(/[^a-zA-Z0-9_-]/g,"_");
    res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition",`attachment; filename="${safe}_fatura_kesilecek.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
/* ========================= / BÖLGE FATURA GİRİŞİ ========================= */

// ── Admin: belirli bir saha için QC verisini sıfırla ───────────────────────
// DELETE /admin/clear-qc/:siteCode — qc_durum + qc_closed_date temizler
app.delete("/admin/clear-qc/:siteCode", authMiddleware, async (req, res) => {
  try {
    const siteCode = String(req.params.siteCode || "").trim().toUpperCase();
    if (!siteCode) return res.status(400).json({ ok: false, error: "Site kodu gerekli" });
    const result = await pool.query(
      `UPDATE rollout_progress
         SET qc_durum = NULL,
             qc_closed_date = NULL,
             updated_at = NOW()
       WHERE UPPER(TRIM(COALESCE(site_code, ''))) = $1
       RETURNING site_code, qc_durum, qc_closed_date`,
      [siteCode]
    );
    if (result.rowCount === 0) return res.status(404).json({ ok: false, error: "Saha bulunamadı: " + siteCode });
    res.json({ ok: true, cleared: result.rowCount, rows: result.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/* ============ HW ACCEPTANCE — ONAY BEKLEYENLER (taşeron bazlı) ============
   Acceptance Excel'inde taşeron adı yok; eşleşme sistem üzerinden yapılır:
   satırın site_code'u master_works'te hangi taşerona atanmışsa o taşeronundur.
   Alt marka / subcon kullanıcıları yalnız kendi sahalarını görür. */
// Processed export kolonları (red takibi) — boot garantisi
pool.query(`ALTER TABLE hw_acceptance_rows ADD COLUMN IF NOT EXISTS project_code TEXT`).catch(() => {});
pool.query(`ALTER TABLE hw_acceptance_rows ADD COLUMN IF NOT EXISTS rejected_reason TEXT`).catch(() => {});
pool.query(`ALTER TABLE hw_acceptance_rows ADD COLUMN IF NOT EXISTS approver TEXT`).catch(() => {});
pool.query(`ALTER TABLE hw_acceptance_rows ADD COLUMN IF NOT EXISTS application_processed TIMESTAMP`).catch(() => {});
pool.query(`ALTER TABLE hw_acceptance_rows ADD COLUMN IF NOT EXISTS item_description TEXT`).catch(() => {});

// Reddedilen acceptance kalemleri (varsayılan son 4 gün, yeni → eski)
app.get("/hw-acceptance/rejected", authMiddleware, async (req, res) => {
  try {
    await ensureHwAcceptanceTable();
    const days = Math.min(60, Math.max(1, parseInt(req.query.days, 10) || 4));
    const r = await pool.query(`
      SELECT a.site_code, a.project_code, a.acceptance_no, a.po_no,
        COALESCE(a.unit_price,0) * COALESCE(NULLIF(a.acceptance_qty,0), a.requested_qty, 0) AS tutar,
        COALESCE(a.currency,'USD') AS currency,
        COALESCE(NULLIF(a.rejected_reason,''),'—') AS rejected_reason,
        COALESCE(NULLIF(a.approver,''),'—') AS approver,
        to_char(a.application_processed,'DD.MM.YYYY') AS islem_tarihi,
        a.application_processed,
        COALESCE(NULLIF(a.item_description,''),
          (SELECT p.item_description FROM po_rows p
            WHERE p.po_no = a.po_no
              AND (COALESCE(a.po_line_no,'')='' OR COALESCE(p.po_line_no,'')=COALESCE(a.po_line_no,''))
            LIMIT 1), '—') AS item_description,
        (SELECT m.subcon_name FROM master_works m
          WHERE UPPER(TRIM(COALESCE(m.site_code,''))) = UPPER(TRIM(COALESCE(a.site_code,'')))
            AND COALESCE(m.subcon_name,'') <> '' LIMIT 1) AS subcon_name
      FROM hw_acceptance_rows a
      WHERE UPPER(COALESCE(a.status,'')) LIKE '%REJECT%'
        AND a.application_processed >= NOW() - make_interval(days => $1)
      ORDER BY a.application_processed DESC NULLS LAST, a.site_code
    `, [days]);
    let rows = r.rows;
    const scopeName = subconScope(req) || String(req.query.sub || "").trim();
    if (scopeName) {
      rows = rows.filter((row) => subconRowMatches(scopeName, row.subcon_name));
    }
    res.json({ ok: true, rows });
  } catch (e) {
    console.error("HW REJECTED ERROR:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/hw-acceptance/onay-bekleyen", authMiddleware, async (req, res) => {
  try {
    await ensureHwAcceptanceTable();
    // Para birimi: acceptance excel'inde currency kolonu yok (tabloda 'USD'
    // default'u basılıyordu) — gerçek birim PO satırından (po_no+line) türetilir
    const r = await pool.query(`
      SELECT a.site_code, a.acceptance_no, a.po_no, a.status,
        a.milestone_type, a.acceptance_milestone,
        COALESCE(a.approval_progress,'') AS approval_progress,
        COALESCE(a.current_handler,'') AS current_handler,
        COALESCE(a.acceptance_qty,0) AS qty,
        COALESCE(a.unit_price,0) AS unit_price,
        COALESCE(a.acceptance_qty,0)*COALESCE(a.unit_price,0) AS tutar,
        UPPER(COALESCE(
          (SELECT p.currency FROM po_rows p
            WHERE p.po_no = a.po_no
              AND (a.po_line_no IS NULL OR a.po_line_no = '' OR p.po_line_no = a.po_line_no)
            ORDER BY CASE WHEN p.po_line_no = a.po_line_no THEN 0 ELSE 1 END
            LIMIT 1),
          'TRY')) AS currency,
        (SELECT m.subcon_name FROM master_works m
          WHERE UPPER(TRIM(COALESCE(m.site_code,''))) = UPPER(TRIM(COALESCE(a.site_code,'')))
            AND COALESCE(m.subcon_name,'') <> '' LIMIT 1) AS subcon_name
      FROM hw_acceptance_rows a
      WHERE UPPER(COALESCE(a.status,'')) LIKE '%PENDING%'
      ORDER BY a.site_code
    `);
    let rows = r.rows;
    const scopeName = subconScope(req) || String(req.query.sub || "").trim();
    if (scopeName) {
      rows = rows.filter((row) => subconRowMatches(scopeName, row.subcon_name));
    }
    // Son acceptance yüklemesinin zamanı — kartta "güncel mi?" sorusuna cevap
    const son = await pool.query(
      `SELECT to_char(MAX(created_at) AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI') AS son_yukleme
       FROM hw_acceptance_rows`).catch(() => ({ rows: [{}] }));
    res.json({ ok: true, rows, son_yukleme: son.rows[0]?.son_yukleme || null });
  } catch (e) {
    console.error("HW ONAY BEKLEYEN ERROR:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ================== HW ACCEPTANCE UPLOAD ================== */
app.post("/hw-acceptance/upload", requireHwYukleme, upload.single("file"), async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureHwAcceptanceTable();
    if (!req.file) return res.status(400).json({ ok: false, error: "Dosya yok" });

    const workbook = XLSX.read(req.file.buffer);
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return res.status(400).json({ ok: false, error: "Excel içinde sheet bulunamadı" });

    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    if (!rows.length) return res.status(400).json({ ok: false, error: "Excel içinde veri bulunamadı" });

    // İlk satırın kolon adlarını logla (debug)
    const detectedColumns = rows[0] ? Object.keys(rows[0]) : [];
    console.log("HW ACCEPTANCE EXCEL KOLONLARI:", detectedColumns);

    // Statü-segment bazlı sil-yaz: Pending export'u pending'leri, Processed
    // (ACCEPTANCE_*) export'u rejected/approved satırları yeniler — iki dosya
    // akışı birbirini silmez.
    const statusSets = new Set(
      rows.map((r) => String(r["Status"] || "").trim().toUpperCase()).filter(Boolean),
    );
    // Tek transaction: yükleme bitene kadar eski veri görünür, yarı boş
    // anlık görüntü oluşmaz; hata olursa eski veri korunur
    await client.query("BEGIN");
    if (statusSets.size === 0) {
      await client.query(`DELETE FROM hw_acceptance_rows`);
    } else {
      await client.query(
        `DELETE FROM hw_acceptance_rows WHERE UPPER(COALESCE(status,'')) = ANY($1)`,
        [[...statusSets]],
      );
    }

    const batchName = new Date().toISOString();
    let inserted = 0;

    for (const r of rows) {
      const poNo           = String(r["PONo."]  || r["PONo"]  || "").trim();
      const poLineNo       = String(r["POLineNo."] || r["POLineNo"] || "").trim();
      const shipmentNo     = String(r["ShipmentNO."] || r["ShipmentNO"] || "").trim();
      const acceptanceNo   = String(r["AcceptanceNO."] || r["AcceptanceNO"] || "").trim();
      const status         = String(r["Status"] || "").trim();
      const currentHandler = String(r["CurrentHandler"] || "").trim();
      const siteCode       = String(r["SiteCode"] || "").trim().toUpperCase();
      const approvalProgress = String(r["ApprovalProgress"] || "").trim();
      const unitPrice      = parseFloat(r["UnitPrice"] || 0) || 0;
      const requestedQty   = parseFloat(r["RequestedQty"] || 0) || 0;
      const acceptanceQty  = parseFloat(r["AcceptanceQty"] || 0) || 0;
      const siteName       = String(r["SiteName"] || "").trim();
      const projectName    = String(r["ProjectName"] || "").trim();
      const engineeringCode = String(r["EngineeringCode"] || "").trim();
      // BOQ ile eşleşecek item code — olası kolon adları deneniyor
      // ServiceCode yeni Excel formatında BOQ s_bom_code'una karşılık gelir
      const itemCode       = String(
        r["ServiceCode"] || r["Service Code"] ||
        r["ItemCode"] || r["Item Code"] || r["Item No"] || r["ItemNo"] ||
        r["Item No."] || r["MaterialCode"] || r["Material Code"] ||
        r["MaterialNo"] || r["Material No."] || r["BOQItemCode"] ||
        r["BOQ Item Code"] || r["S-BOM Code"] || r["SBOMCode"] || ""
      ).trim();
      const milestoneType  = String(r["MilestoneType"] || "").trim();
      const acceptanceMilestone = String(r["AcceptanceMilestone"] || "").trim();
      const paymentPct     = String(r["Payment Percentage"] || "").trim();
      // Processed (ACCEPTANCE_*) export alanları — red takibi için
      const itemDescription = String(r["Item Description"] || r["ItemDescription"] || "").trim();
      const projectCode    = String(r["ProjectCode"] || r["Project Code"] || "").trim();
      const rejectedReason = String(r["Rejected reason"] || r["RejectedReason"] || "").trim();
      const approver       = String(r["Approver"] || "").trim();
      const appProcessedRaw = r["ApplicationProcessed"] || r["Application Processed"] || null;
      let appProcessed = null;
      if (appProcessedRaw) {
        const d = new Date(appProcessedRaw);
        if (!isNaN(d.getTime())) appProcessed = d.toISOString();
      }

      if (!poNo && !acceptanceNo) continue;

      await client.query(`
        INSERT INTO hw_acceptance_rows (
          acceptance_no, po_no, po_line_no, shipment_no,
          status, current_handler, site_code, approval_progress,
          unit_price, requested_qty, acceptance_qty,
          site_name, project_name, engineering_code, item_code,
          milestone_type, acceptance_milestone, payment_pct, upload_batch,
          project_code, rejected_reason, approver, application_processed, item_description
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
      `, [
        acceptanceNo || null, poNo || null, poLineNo || null, shipmentNo || null,
        status || null, currentHandler || null, siteCode || null, approvalProgress || null,
        unitPrice, requestedQty, acceptanceQty,
        siteName || null, projectName || null, engineeringCode || null, itemCode || null,
        milestoneType || null, acceptanceMilestone || null, paymentPct || null, batchName,
        projectCode || null, rejectedReason || null, approver || null, appProcessed,
        itemDescription || null
      ]);
      inserted++;
    }

    await client.query("COMMIT");
    res.json({ ok: true, message: "HW Acceptance listesi yüklendi", inserted, detectedColumns });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("HW ACCEPTANCE UPLOAD ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

/* ================== HW ACCEPTANCE DEBUG ================== */
app.get("/hw-acceptance/debug-codes", async (req, res) => {
  try {
    await ensureHwAcceptanceTable();
    const engCodes = await pool.query(`
      SELECT DISTINCT engineering_code, item_code, po_no
      FROM hw_acceptance_rows
      WHERE status ILIKE '%pending%'
      ORDER BY engineering_code NULLS LAST
      LIMIT 30
    `);
    const bomCodes = await pool.query(`
      SELECT DISTINCT s_bom_code, currency FROM boq_items ORDER BY s_bom_code LIMIT 30
    `);
    const poMatch = await pool.query(`
      SELECT DISTINCT
        a.po_no, a.po_line_no, a.shipment_no,
        p.item_code, p.po_line_no AS p_line, p.shipment_no AS p_ship,
        p.currency AS po_currency,
        b.currency AS boq_currency
      FROM hw_acceptance_rows a
      LEFT JOIN po_rows p
        ON TRIM(p.po_no) = TRIM(a.po_no)
        AND TRIM(p.po_line_no) = TRIM(a.po_line_no)
        AND TRIM(p.shipment_no) = TRIM(a.shipment_no)
      LEFT JOIN boq_items b ON TRIM(b.s_bom_code) = TRIM(p.item_code)
      WHERE a.status ILIKE '%pending%'
      LIMIT 20
    `);
    res.json({
      hw_engineering_codes: engCodes.rows,
      boq_s_bom_codes: bomCodes.rows,
      po_join_sample: poMatch.rows,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ================== HW ACCEPTANCE SUMMARY ================== */
app.get("/hw-acceptance/summary", async (req, res) => {
  try {
    await ensureHwAcceptanceTable();
    // Acceptance satırlarını po_rows ile join ederek currency al
    // po_no: "3621HG3454795-40" → exact match önce, sonra prefix (son -XX kısmı kesilince) denenir
    const result = await pool.query(`
      SELECT
        a.acceptance_no,
        a.po_no,
        a.po_line_no,
        a.shipment_no,
        a.current_handler,
        a.approval_progress,
        a.site_code,
        a.site_name,
        a.acceptance_milestone,
        a.milestone_type,
        a.unit_price,
        a.acceptance_qty,
        a.status,
        a.engineering_code,
        a.item_code,
        COALESCE(
          -- 1. item_code (ServiceCode) direkt BOQ ile eşleşme — en güvenilir kaynak
          (SELECT b.currency FROM boq_items b
             WHERE TRIM(b.s_bom_code) = TRIM(a.item_code)
               AND a.item_code IS NOT NULL AND a.item_code != ''
             LIMIT 1),
          -- 2. engineering_code direkt BOQ ile eşleşme
          (SELECT b.currency FROM boq_items b
             WHERE TRIM(b.s_bom_code) = TRIM(a.engineering_code)
               AND a.engineering_code IS NOT NULL AND a.engineering_code != ''
             LIMIT 1),
          -- 3. PO tablosundan 3'lü anahtar ile item_code bul → BOQ'dan currency al
          (SELECT b.currency FROM po_rows p
             JOIN boq_items b ON TRIM(b.s_bom_code) = TRIM(p.item_code)
             WHERE TRIM(p.po_no)       = TRIM(a.po_no)
               AND TRIM(p.po_line_no)  = TRIM(a.po_line_no)
               AND TRIM(p.shipment_no) = TRIM(a.shipment_no)
             LIMIT 1),
          -- 4. po_no + po_line_no ile eşleşme
          (SELECT b.currency FROM po_rows p
             JOIN boq_items b ON TRIM(b.s_bom_code) = TRIM(p.item_code)
             WHERE TRIM(p.po_no)      = TRIM(a.po_no)
               AND TRIM(p.po_line_no) = TRIM(a.po_line_no)
             LIMIT 1),
          -- 5. Sadece po_no ile eşleşme (son fallback)
          (SELECT b.currency FROM po_rows p
             JOIN boq_items b ON TRIM(b.s_bom_code) = TRIM(p.item_code)
             WHERE TRIM(p.po_no) = TRIM(a.po_no)
             LIMIT 1)
        ) AS currency
      FROM hw_acceptance_rows a
      WHERE a.status ILIKE '%pending%'
      ORDER BY a.current_handler, a.po_no
    `);

    if (!result.rows.length) {
      return res.json({ total_usd: 0, total_try: 0, total_count: 0, by_handler: [], last_upload: null });
    }

    // Son yükleme tarihi
    const batchRes = await pool.query(`SELECT MAX(upload_batch) AS last_upload FROM hw_acceptance_rows`);
    const lastUpload = batchRes.rows[0]?.last_upload || null;

    let total_usd = 0;
    let total_try = 0;
    const handlerMap = {};

    // AcceptanceMilestone'a göre beklenen ödeme yüzdesini ve KDV'yi belirle.
    // Ekranda her iki milestone da KDV DAHİL gösterilir (kullanıcı kdv'li görmek istiyor).
    // AC2 (Customer Acc / Acceptance / PAC): genel bedelin %20'si + KDV (×1.20)
    // AC1 (Huawei Acceptance): genel bedelin %80'i + KDV (×1.20)
    function getMilestoneFactor(milestone) {
      const m = String(milestone || '').toUpperCase();
      if (m.includes('AC2')) return { pct: 0.20, kdv: 1.20, label: 'AC2 %20+KDV' };
      if (m.includes('AC1')) return { pct: 0.80, kdv: 1.20, label: 'AC1 %80+KDV' };
      return { pct: 1.00, kdv: 1.00, label: '' };
    }

    for (const row of result.rows) {
      const qty       = parseFloat(row.acceptance_qty) || 1;
      const price     = parseFloat(row.unit_price) || 0;
      const milestone = row.acceptance_milestone || row.milestone_type || '';
      const { pct, kdv, label } = getMilestoneFactor(milestone);
      const lineTotal = price * qty * pct * kdv;

      // currency: SQL COALESCE'tan gelen değer; NULL ise engineering_code+price ile tahmin et
      const currency  = inferCurrencyByItemAndPrice(
        row.engineering_code || row.item_code,
        row.currency,
        price
      );
      const isTry     = currency === 'TRY' || currency === 'TL';

      if (isTry) total_try += lineTotal;
      else        total_usd += lineTotal;

      // Handler adını sayısal suffix'ten arındır ("Tolgahan Unal 84294958" → "Tolgahan Unal")
      const handlerRaw = row.current_handler || 'Bilinmiyor';
      const handlerName = handlerRaw.replace(/\s+\d{6,}$/, '').trim();

      if (!handlerMap[handlerName]) {
        handlerMap[handlerName] = {
          handler: handlerName,
          progress: row.approval_progress || '0/0',
          count: 0,
          total_usd: 0,
          total_try: 0,
          items: []
        };
      }

      handlerMap[handlerName].count++;
      if (isTry) handlerMap[handlerName].total_try += lineTotal;
      else        handlerMap[handlerName].total_usd += lineTotal;

      handlerMap[handlerName].items.push({
        acceptance_no: row.acceptance_no,
        po_no: row.po_no,
        site_code: row.site_code,
        site_name: row.site_name,
        milestone,
        milestone_label: label,
        line_total: lineTotal,
        currency,
        progress: row.approval_progress
      });
    }

    // USD'yi TRY'ye çevirerek sırala
    const sortRate = await getTcmbUsdTrySellingRate().catch(() => 40);
    const by_handler = Object.values(handlerMap)
      .sort((a, b) =>
        (b.total_usd * sortRate + b.total_try) - (a.total_usd * sortRate + a.total_try)
      );

    res.json({
      total_usd:   Math.round(total_usd   * 100) / 100,
      total_try:   Math.round(total_try   * 100) / 100,
      total_count: result.rows.length,
      by_handler,
      last_upload: lastUpload
    });
  } catch (err) {
    console.error("HW ACCEPTANCE SUMMARY ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   2KX HABERLEŞME — FİYATLANDIRMA TABLOSU + SEED
   ═══════════════════════════════════════════════════════════════ */

pool.query(`
  CREATE TABLE IF NOT EXISTS taseron_2kx_pricing (
    id               SERIAL PRIMARY KEY,
    rule_key         TEXT UNIQUE NOT NULL,
    item_code        TEXT NOT NULL,
    item_description TEXT,
    unit_price       NUMERIC NOT NULL,
    rule_description TEXT,
    notes            TEXT,
    updated_at       TIMESTAMP DEFAULT NOW()
  );
`).catch(e => console.error("taseron_2kx_pricing tablo hatası:", e.message));

(async () => {
  const RULES = [
    { rule_key: "PACKAGE_LTE5G_8818274542", item_code: "8818274542", item_description: "LTE/5G Ana Paket",                   unit_price: 25500, rule_description: "LTE veya 5G sahada bu kalem varsa site paketi" },
    { rule_key: "PACKAGE_LTE5G_8818274543", item_code: "8818274543", item_description: "LTE/5G Gelişmiş Paket",              unit_price: 29500, rule_description: "LTE veya 5G sahada bu kalem varsa site paketi" },
    { rule_key: "PACKAGE_SA_NO_UPGRADE",    item_code: "8812184592", item_description: "Standalone Paketi (Upgrade Yok)",    unit_price: 40000, rule_description: "SA sahada 8812184592/591 var, 8818274546 yok" },
    { rule_key: "PACKAGE_SA_WITH_UPGRADE",  item_code: "8812184592", item_description: "Standalone Paketi (Upgrade Dahil)", unit_price: 52000, rule_description: "SA sahada 8812184592/591 var, 8818274546 da var" },
    { rule_key: "PER_ITEM_8812184927",      item_code: "8812184927", item_description: "Ek Kalem 8812184927",               unit_price:   750, rule_description: "Kalem bazlı" },
    { rule_key: "PER_ITEM_8812184697",      item_code: "8812184697", item_description: "Ek Kalem 8812184697",               unit_price:   900, rule_description: "Kalem bazlı" },
    { rule_key: "PER_ITEM_88123MGE",        item_code: "88123MGE",   item_description: "Ek Kalem 88123MGE",                 unit_price:  2500, rule_description: "Kalem bazlı" },
    { rule_key: "PER_ITEM_8818270786",      item_code: "8818270786", item_description: "Ek Kalem 8818270786",               unit_price:  9500, rule_description: "Kalem bazlı" },
    { rule_key: "PER_ITEM_8818274283",      item_code: "8818274283", item_description: "Ek Kalem 8818274283",               unit_price: 14000, rule_description: "Kalem bazlı" },
    { rule_key: "PER_ITEM_8812184609",      item_code: "8812184609", item_description: "Ek Kalem 8812184609",               unit_price:   500, rule_description: "Kalem bazlı" },
    { rule_key: "PER_ITEM_8812184598",      item_code: "8812184598", item_description: "Ek Kalem 8812184598",               unit_price:  1500, rule_description: "Kalem bazlı" },
    { rule_key: "PER_ITEM_8818264118",      item_code: "8818264118", item_description: "Ek Kalem 8818264118",               unit_price:   700, rule_description: "Kalem bazlı" },
    { rule_key: "PER_ITEM_8812184597",      item_code: "8812184597", item_description: "Ek Kalem 8812184597",               unit_price:  1000, rule_description: "Kalem bazlı" },
    { rule_key: "PER_ITEM_8818264113",      item_code: "8818264113", item_description: "Ek Kalem 8818264113",               unit_price:   500, rule_description: "Kalem bazlı" },
    { rule_key: "PER_ITEM_8812184613",      item_code: "8812184613", item_description: "Ek Kalem 8812184613",               unit_price:   500, rule_description: "Kalem bazlı" },
  ];
  try {
    for (const r of RULES) {
      await pool.query(
        `INSERT INTO taseron_2kx_pricing (rule_key, item_code, item_description, unit_price, rule_description)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (rule_key) DO UPDATE SET
           item_code        = EXCLUDED.item_code,
           item_description = EXCLUDED.item_description,
           unit_price       = EXCLUDED.unit_price,
           rule_description = EXCLUDED.rule_description,
           updated_at       = NOW()`,
        [r.rule_key, r.item_code, r.item_description, r.unit_price, r.rule_description]
      );
    }
    console.log("✅ 2KX fiyatlandırma kuralları seed tamamlandı");
  } catch (e) {
    console.error("2KX fiyatlandırma seed hatası:", e.message);
  }
})();

/* ── 2KX API ─────────────────────────────────────────────────────── */

// 2KX özel item'ları için manuel fiyat (5 item: farklı firma yapıyor)
async function ensureTwokxManualPricesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS twokx_manual_prices (
      id SERIAL PRIMARY KEY,
      site_code TEXT NOT NULL,
      item_code TEXT NOT NULL,
      unit_price NUMERIC,
      currency TEXT DEFAULT 'TRY',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (site_code, item_code)
    );
  `);
}

// GET /2kx/manual-prices — özel item manuel fiyatları
app.get("/2kx/manual-prices", authMiddleware, async (req, res) => {
  try {
    await ensureTwokxManualPricesTable();
    const r = await pool.query(
      `SELECT site_code, item_code, unit_price, currency, updated_at
       FROM twokx_manual_prices ORDER BY site_code, item_code`,
    );
    return res.json({ ok: true, prices: r.rows });
  } catch (err) {
    console.error("2KX MANUAL PRICES GET ERROR:", err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || "Fiyatlar alınamadı" });
  }
});

// POST /2kx/manual-prices — tek fiyat upsert (admin)
app.post("/2kx/manual-prices", authMiddleware, requireAdmin, async (req, res) => {
  try {
    await ensureTwokxManualPricesTable();
    const siteCode = (req.body.site_code || "").toString().trim();
    const itemCode = (req.body.item_code || "").toString().trim();
    if (!siteCode || !itemCode) {
      return res
        .status(400)
        .json({ ok: false, error: "site_code ve item_code gerekli" });
    }
    const unitPrice =
      req.body.unit_price === "" || req.body.unit_price == null
        ? null
        : parseFinanceNumber(req.body.unit_price);
    const currency = normalizeCurrency(req.body.currency) || "TRY";
    await pool.query(
      `INSERT INTO twokx_manual_prices (site_code, item_code, unit_price, currency, updated_at)
       VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)
       ON CONFLICT (site_code, item_code)
       DO UPDATE SET unit_price = EXCLUDED.unit_price,
                     currency = EXCLUDED.currency,
                     updated_at = CURRENT_TIMESTAMP`,
      [siteCode, itemCode, unitPrice, currency],
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("2KX MANUAL PRICES POST ERROR:", err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || "Fiyat kaydedilemedi" });
  }
});

// GET /2kx/pricing — tüm fiyat kuralları
app.get("/2kx/pricing", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM taseron_2kx_pricing ORDER BY id");
    res.json({ ok: true, rules: result.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /2kx/pricing/:id — fiyat güncelle (admin veya 2KX kullanıcısı)
app.put("/2kx/pricing/:id", authMiddleware, async (req, res) => {
  const userRole = String(req.user?.role || "").toLowerCase();
  const userSubcon = String(req.user?.subcon_name || "").toUpperCase();
  const is2KX = userSubcon.includes("2KX");
  if (userRole !== "admin" && !is2KX) {
    return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
  }
  const { unit_price, item_description, notes } = req.body;
  try {
    await pool.query(
      `UPDATE taseron_2kx_pricing SET unit_price=$1, item_description=$2, notes=$3, updated_at=NOW() WHERE id=$4`,
      [Number(unit_price), item_description || null, notes || null, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /2kx/pricing — yeni kural ekle (sadece admin)
app.post("/2kx/pricing", authMiddleware, requireAdmin, async (req, res) => {
  const { rule_key, item_code, item_description, unit_price, rule_description, notes } = req.body;
  if (!rule_key || !item_code || unit_price == null) {
    return res.status(400).json({ ok: false, error: "rule_key, item_code ve unit_price zorunlu" });
  }
  try {
    const r = await pool.query(
      `INSERT INTO taseron_2kx_pricing (rule_key, item_code, item_description, unit_price, rule_description, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [rule_key, item_code, item_description || null, Number(unit_price), rule_description || null, notes || null]
    );
    res.json({ ok: true, rule: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /2kx/dashboard — 2KX hakediş paneli ana endpoint
app.get("/2kx/dashboard", authMiddleware, async (req, res) => {
  try {
    // 1. Tüm fiyatlandırma kurallarını al
    const pricingResult = await pool.query("SELECT * FROM taseron_2kx_pricing ORDER BY id");
    const pricingRules = pricingResult.rows;
    const pricingMap = {}; // rule_key -> unit_price
    const perItemMap = {}; // item_code -> unit_price (PER_ITEM_ kuralları için)
    for (const rule of pricingRules) {
      pricingMap[rule.rule_key] = Number(rule.unit_price);
      if (rule.rule_key.startsWith("PER_ITEM_")) {
        perItemMap[String(rule.item_code).trim()] = Number(rule.unit_price);
      }
    }

    // 2. USD kurunu al
    let usdRate = 40;
    try { usdRate = await getTcmbUsdTrySellingRate(); } catch (_) {}

    // 3. 2KX iş kalemlerini çek
    const worksResult = await pool.query(`
      SELECT
        m.site_code,
        m.site_type,
        m.item_code,
        m.item_description,
        m.done_qty,
        m.qc_durum,
        m.kabul_durum,
        p.requested_qty,
        p.unit_price      AS po_unit_price,
        p.currency        AS po_currency,
        p.billed_qty,
        b.unit_price      AS boq_unit_price,
        b.currency        AS boq_currency,
        b.boq_items_en    AS boq_description
      FROM master_works m
      LEFT JOIN po_rows p ON p.site_code = m.site_code AND TRIM(p.item_code) = TRIM(m.item_code)
      LEFT JOIN boq_items b ON TRIM(b.s_bom_code) = TRIM(m.item_code)
      WHERE m.subcon_name ILIKE '%2KX%'
      ORDER BY m.site_code, m.item_code
    `);

    // 4. Fatura toplamını al
    const invoiceResult = await pool.query(
      `SELECT COALESCE(SUM(genel_toplam), 0) AS total FROM taseron_fatura WHERE taseron_adi ILIKE '%2KX%'`
    );
    const totalInvoiced = Number(invoiceResult.rows[0]?.total || 0);

    // 5. Site bazlı gruplama ve hesaplama
    const siteMap = {};
    for (const row of worksResult.rows) {
      const sc = row.site_code;
      if (!siteMap[sc]) {
        siteMap[sc] = { site_code: sc, site_type: row.site_type || "", items: [] };
      }
      siteMap[sc].items.push(row);
    }

    let totalHakedis = 0;
    let totalQcOk = 0;
    const sites = [];

    for (const [siteCode, siteData] of Object.entries(siteMap)) {
      const siteTech = String(siteData.site_type || "").toLowerCase();
      const isLTE = (siteTech.includes("lte") || siteTech.includes("4g")) && !siteTech.includes("standalone");
      const is5G = siteTech.includes("5g") || siteTech.includes("nr");
      const isSA = siteTech.includes("standalone") || siteTech.includes(" sa") || siteTech.endsWith("sa");

      const itemCodes = siteData.items.map(i => String(i.item_code || "").trim());

      // Paket fiyat hesabı
      let packagePrice = 0;
      let packageTriggerCode = null;

      if (isLTE || is5G) {
        if (itemCodes.includes("8818274542")) {
          packagePrice = pricingMap["PACKAGE_LTE5G_8818274542"] || 0;
          packageTriggerCode = "8818274542";
        } else if (itemCodes.includes("8818274543")) {
          packagePrice = pricingMap["PACKAGE_LTE5G_8818274543"] || 0;
          packageTriggerCode = "8818274543";
        }
      }
      if (isSA) {
        const hasTrigger = itemCodes.includes("8812184592") || itemCodes.includes("8812184591");
        const triggerCode = itemCodes.includes("8812184592") ? "8812184592" : "8812184591";
        const hasUpgrade = itemCodes.includes("8818274546");
        if (hasTrigger && hasUpgrade) {
          packagePrice = pricingMap["PACKAGE_SA_WITH_UPGRADE"] || 0;
          packageTriggerCode = triggerCode;
        } else if (hasTrigger && !hasUpgrade) {
          packagePrice = pricingMap["PACKAGE_SA_NO_UPGRADE"] || 0;
          packageTriggerCode = triggerCode;
        }
      }

      // Kalem bazlı hesaplamalar
      let siteTotal = packagePrice;
      const enrichedItems = [];
      let packageIsQcOk = false;

      for (const item of siteData.items) {
        const itemCode = String(item.item_code || "").trim();
        const doneQty = Number(item.done_qty || 0);
        const qcOk = String(item.qc_durum || "").toUpperCase() === "OK";

        // Huawei fiyatı
        const rawPoPrice = Number(item.po_unit_price || 0);
        const rawBoqPrice = Number(item.boq_unit_price || 0);
        const huaweiRawPrice = rawPoPrice > 0 ? rawPoPrice : rawBoqPrice;
        const huaweiCurrency = rawPoPrice > 0
          ? String(item.po_currency || "TRY").toUpperCase()
          : String(item.boq_currency || "TRY").toUpperCase();
        const huaweiUnitPriceTry = huaweiCurrency === "USD" ? huaweiRawPrice * usdRate : huaweiRawPrice;
        const huaweiTotal = huaweiUnitPriceTry * doneQty;

        // 2KX taşeron fiyatı
        let taseronUnitPrice = 0;
        let taseronTotal = 0;
        let priceType = "included";

        if (itemCode === packageTriggerCode) {
          taseronUnitPrice = packagePrice;
          taseronTotal = packagePrice; // paket tek seferlik
          priceType = "package";
          if (qcOk) packageIsQcOk = true;
        } else if (perItemMap[itemCode] !== undefined) {
          taseronUnitPrice = perItemMap[itemCode];
          taseronTotal = taseronUnitPrice * doneQty;
          priceType = "per_item";
          if (itemCode !== packageTriggerCode) {
            siteTotal += taseronTotal;
          }
        }

        enrichedItems.push({
          ...item,
          item_code: itemCode,
          huawei_unit_price: huaweiUnitPriceTry,
          huawei_total: huaweiTotal,
          taseron_unit_price: taseronUnitPrice,
          taseron_total: taseronTotal,
          price_type: priceType,
          qc_ok: qcOk,
        });
      }

      // QC OK toplamı
      let siteQcOkTotal = packageIsQcOk ? packagePrice : 0;
      for (const item of enrichedItems) {
        if (item.price_type === "per_item" && item.qc_ok) {
          siteQcOkTotal += item.taseron_total;
        }
      }

      totalHakedis += siteTotal;
      totalQcOk += siteQcOkTotal;

      sites.push({
        site_code: siteCode,
        site_type: siteData.site_type,
        package_price: packagePrice,
        package_trigger_code: packageTriggerCode,
        total_hakedis: siteTotal,
        qc_ok_hakedis: siteQcOkTotal,
        items: enrichedItems,
      });
    }

    res.json({
      ok: true,
      summary: {
        total_hakedis: totalHakedis,
        total_qc_ok: totalQcOk,
        total_invoiced: totalInvoiced,
        usd_rate: usdRate,
      },
      sites,
      pricing: pricingRules,
    });
  } catch (e) {
    console.error("2KX DASHBOARD ERROR:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server çalışıyor: ${PORT}`);
});

module.exports = app;
// deploy trigger Mon Jun  8 13:27:48 +03 2026

