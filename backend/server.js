require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
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
  for (const line of lines) {
    if (/^[\s*]*(TOPLAM|NAK[İI]T|TUTAR|GENEL TOPLAM|TOTAL)/i.test(line)) {
      const nums = (line.match(TR_NUM_RE) || []).map(parseTrNumber).filter(n => n >= 1 && n <= 999999);
      if (nums.length) { amount = Math.max(...nums); break; }
    }
  }
  if (!amount) {
    for (const line of lines) {
      if (/TOPLAM|NAK[İI]T|TUTAR|TOTAL/i.test(line)) {
        const nums = (line.match(TR_NUM_RE) || []).map(parseTrNumber).filter(n => n >= 1 && n <= 999999);
        if (nums.length) { amount = Math.max(...nums); break; }
      }
    }
  }
  if (!amount) {
    const allNums = (text.match(TR_NUM_RE) || []).map(parseTrNumber).filter(n => n >= 1 && n <= 999999);
    if (allNums.length) amount = Math.max(...allNums);
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

function applySubconFilter(req, rows) {
  const userRole = String(req.user?.role || "").toLowerCase();
  const userSubcon = String(req.user?.subcon_name || "")
    .trim()
    .toLowerCase();

  if (userRole !== "subcon" || !userSubcon) {
    return rows || [];
  }

  return (rows || []).filter(
    (row) =>
      String(row.subcon_name || "")
        .trim()
        .toLowerCase() === userSubcon,
  );
}

const pool = require("./db");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ ok: false, error: "Yetkiniz yok" });
  }
  next();
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

// TÜM KULLANICILARI LİSTELE
app.get("/admin/users", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, email, role, is_active, created_at
      FROM users
      ORDER BY id DESC
    `);

    res.json({ ok: true, users: result.rows });
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

    const hashed = await bcrypt.hash(password, 10);

    // Aynı email varsa şifre + aktif güncelle, yoksa yeni kayıt ekle
    const existing = await pool.query(
      `SELECT id FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1`,
      [email]
    );
    let result;
    if (existing.rows.length > 0) {
      result = await pool.query(
        `UPDATE users SET name=$1, password_hash=$2, role=$3, is_active=true
         WHERE id=$4 RETURNING id, name, email, role, is_active`,
        [name, hashed, role, existing.rows[0].id]
      );
    } else {
      result = await pool.query(
        `INSERT INTO users (name, email, password_hash, role, is_active)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id, name, email, role, is_active`,
        [name, email, hashed, role],
      );
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
      const { role } = req.body;

      if (!role || !["admin", "user", "rollout_mudur", "genel_mudur"].includes(role)) {
        return res.status(400).json({ ok: false, error: "Geçersiz rol" });
      }

      const result = await pool.query(
        `
      UPDATE users
      SET role = $1
      WHERE id = $2
      RETURNING id, name, email, role, is_active, created_at
      `,
        [role, id],
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

// AKTİF / PASİF
app.put(
  "/admin/users/:id/status",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { is_active } = req.body;

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
      SELECT id, name, email, password_hash, role, is_active, subcon_name, payment_rate
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

    if (!user.is_active) {
      return res.status(403).json({
        ok: false,
        error: "Kullanıcı pasif durumda",
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        ok: false,
        error: "Kullanıcı pasif durumda",
      });
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
      userRole === "genel_mudur";

    const scope =
      isAdminUser || financeAllowedUsers.includes(userEmail)
        ? "finance"
        : "app";

    const token = jwt.sign(
      {
        user_id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        subcon_name: user.subcon_name || null,
        scope,
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

    const EXCLUDED_ITEMS = [
      "8812184870",
      "8812184927",
      "8812184930",
      "8812184919",
      "8818274546",
    ];

    function normalizeText(value) {
      return String(value || "")
        .trim()
        .toUpperCase();
    }

    function normalizeStatus(value) {
      const v = normalizeText(value);

      if (!v) return null;
      if (v === "CLOSED" || v === "OK") return "OK";
      if (v === "EXECUTING" || v === "NOK") return "NOK";

      return "NOK";
    }

    function getSiteTypeFromCode(siteCode) {
      const code = normalizeText(siteCode);

      if (code.includes("_NS_")) return "STANDALONE";
      if (code.includes("_DSS_")) return "DSS";
      if (code.includes("_TRP_") || code.includes("_NR700_")) return "TRP";
      if (code.includes("_NR3500_") || code.includes("_5G_")) return "5G";
      if (
        code.includes("_L1800_") ||
        code.includes("_L2600_") ||
        code.includes("_L900_") ||
        code.includes("_LTE_")
      ) {
        return "LTE";
      }

      return "OTHER";
    }

    function getRuleByTemplate(siteCode, templateName) {
      const siteType = getSiteTypeFromCode(siteCode);
      const template = normalizeText(templateName);

      if (siteType === "STANDALONE") {
        if (template.includes("STANDALONE AI")) {
          return { type: "ALL_EXCEPT_SPECIAL" };
        }

        if (template.includes("TRS QUALITY CHECK LIST")) {
          return { type: "ONLY_8818274546" };
        }
      }

      if (siteType === "DSS") {
        if (
          template.includes("DSS-GPS READINESS TASK") ||
          template.includes("DSS READINESS TASK")
        ) {
          return { type: "ALL_EXCEPT_SPECIAL" };
        }
      }

      if (siteType === "LTE") {
        if (template.includes("KONTROL CHECKLIST")) {
          return { type: "ALL_EXCEPT_SPECIAL" };
        }
      }

      if (siteType === "5G") {
        if (
          template.includes("5G READINESS QC CHECKLIST") ||
          template.includes("5G READINESS YENI POLE")
        ) {
          return { type: "ALL_EXCEPT_SPECIAL" };
        }
      }

      if (siteType === "TRP") {
        if (template.includes("MODERNIZASYON LOWCOST TASK")) {
          return { type: "ALL_EXCEPT_SPECIAL" };
        }
      }

      return null;
    }

    let updatedCount = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];

      const siteId = row[COL_SITE_ID];
      const statusRaw = row[COL_STATUS];
      const templateName = row[COL_TEMPLATE];

      const firstSubmitRaw = row[COL_FIRST_SUBMIT];
      const qcCloseTimeRaw = row[COL_CLOSE_TIME];

      const siteCode = String(siteId || "")
        .trim()
        .toUpperCase();
      const qcDurum = normalizeStatus(statusRaw);

      const firstSubmitDateOnly = toDateOnly(firstSubmitRaw);
      const qcClosedDateOnly = toDateOnly(qcCloseTimeRaw);

      if (!siteCode || !qcDurum) {
        continue;
      }

      /* 🔥 Rollout Data QC otomatik güncelleme */
      /* 🔥 Rollout Data QC otomatik güncelleme */
      await pool.query(
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

          qc_closed_date = CASE
            WHEN $2 = 'OK' THEN COALESCE(qc_closed_date, $4)
            ELSE qc_closed_date
          END,

          malzeme_status = CASE
            WHEN $2 = 'OK' AND COALESCE(malzeme_status, '') = ''
            THEN 'OK'
            ELSE malzeme_status
          END,

          updated_at = NOW()
        WHERE UPPER(TRIM(COALESCE(site_code, ''))) = $1
        `,
        [siteCode, qcDurum, firstSubmitDateOnly, qcClosedDateOnly],
      );

      /* Eski master_works kuralı aynen devam */
      if (!templateName) {
        continue;
      }

      const rule = getRuleByTemplate(siteCode, templateName);

      if (!rule) {
        continue;
      }
      if (rule.type === "ONLY_8818274546") {
        const result = await pool.query(
          `
            UPDATE master_works
            SET qc_durum = $1
            WHERE UPPER(TRIM(COALESCE(site_code, ''))) = $2
              AND TRIM(COALESCE(item_code, '')) = '8818274546'
            `,
          [qcDurum, siteCode],
        );

        updatedCount += result.rowCount || 0;
      }

      if (rule.type === "ALL_EXCEPT_SPECIAL") {
        const result = await pool.query(
          `
            UPDATE master_works
            SET qc_durum = $1
            WHERE UPPER(TRIM(COALESCE(site_code, ''))) = $2
              AND TRIM(COALESCE(item_code, '')) <> ALL($3::text[])
            `,
          [qcDurum, siteCode, EXCLUDED_ITEMS],
        );

        updatedCount += result.rowCount || 0;
      }
    }

    return res.json({
      ok: true,
      updatedCount,
      message: "QC verileri master kayıtlara işlendi",
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
    const validPassword = String(
      process.env.FINANCE_TEMP_PASSWORD || "",
    ).trim();

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

    if (password !== validPassword) {
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
        subcon_name: user.subcon_name,
        payment_rate: Number(user.payment_rate || 0.8),
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

    if (decoded.scope !== "finance") {
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
  const result = await pool.query(`
    SELECT
      p.invoice_no,
      p.due_date,
      COALESCE(p.remaining_amount, 0) AS remaining_amount,
      COALESCE(p.currency, 'TRY') AS currency
    FROM hw_payment_rows p
    WHERE COALESCE(p.remaining_amount, 0) > 0
      AND p.due_date IS NOT NULL
    ORDER BY p.due_date ASC
  `);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(today);
  const day = endOfWeek.getDay();
  const diffToSunday = day === 0 ? 0 : 7 - day;
  endOfWeek.setDate(endOfWeek.getDate() + diffToSunday);
  endOfWeek.setHours(23, 59, 59, 999);

  const monthlyUpcoming = {};
  for (let i = 1; i <= 12; i += 1) {
    monthlyUpcoming[i] = 0;
  }

  let todayTotal = 0;
  let weekTotal = 0;
  let overdueTotal = 0;

  const groupedMap = new Map();

  for (const row of result.rows) {
    const amount = Number(row.remaining_amount || 0);
    if (amount <= 0) continue;

    const dueDate = new Date(row.due_date);
    dueDate.setHours(0, 0, 0, 0);

    if (Number.isNaN(dueDate.getTime())) continue;

    if (dueDate < today) {
      overdueTotal += amount;
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
        currency: row.currency || "TRY",
      });
    }

    groupedMap.get(key).amount += amount;
  }

  const rows = [...groupedMap.values()].sort(
    (a, b) => new Date(a.due_date) - new Date(b.due_date),
  );

  return {
    rows,
    summary: {
      today_total: todayTotal,
      week_total: weekTotal,
      overdue_total: overdueTotal,
    },
    monthlyUpcoming,
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
function inferCurrencyByItemAndPrice(itemCode, currency, unitPrice) {
  const code = String(itemCode || "").trim();
  const curr = normalizeCurrency(currency);
  const price = Number(unitPrice || 0);

  // 7,2m LPRT pole özel kuralı:
  // Eski PO'larda 42.379 TL, yeni PO'larda 947/986 USD geliyor.
  if (code === "8818278098") {
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
  const code = String(siteCode || "")
    .trim()
    .toUpperCase();

  const project = String(projectCode || "")
    .trim()
    .toUpperCase();

  // 🔴 1) TT PROJESİ (56A0SJC) ÖZEL KURAL
  if (project === "56A0SJC") {
    if (code.endsWith("_IZM")) return "İzmir";
    if (code.endsWith("_KON")) return "Konya";
    if (code.endsWith("_ANT")) return "Antalya";
    if (code.endsWith("_ANK")) return "Ankara";
  }

  // 🟡 2) NORMAL HUAWEI KURALLARI
  if (
    code.startsWith("ES") ||
    code.startsWith("BO") ||
    code.startsWith("ZO") ||
    code.startsWith("KA") ||
    code.includes("_ANK") ||
    code.startsWith("AN")
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
    code.includes("_IZM") // bunu da ekledik
  ) {
    return "İzmir";
  }

  if (
    code.startsWith("AT") ||
    code.startsWith("IP") ||
    code.startsWith("BU") ||
    code.startsWith("AF") ||
    code.includes("_ANT") // bunu da ekledik
  ) {
    return "Antalya";
  }

  return "DİĞER";
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

/* ================== COMMON CTE ================== */
const COMMON_MATCH_CTES = `
  WITH best_site_po AS (
    SELECT DISTINCT ON (project_code, site_code, item_code)
      *
    FROM po_rows
    WHERE COALESCE(TRIM(item_code), '') <> ''
    ORDER BY
      project_code,
      site_code,
      item_code,
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
      COALESCE(m.subcon_name, '') AS subcon_name,
      m.onair_date,
      COALESCE(m.note, '') AS note,
      COALESCE(m.qc_durum, '') AS qc_durum,
      COALESCE(m.kabul_durum, '') AS kabul_durum,
      COALESCE(m.kabul_not, '') AS kabul_not,
      m.created_at,

      COALESCE(site_po.requested_qty, 0) AS requested_qty,
      COALESCE(site_po.billed_qty, 0) AS billed_qty,
      COALESCE(site_po.due_qty, 0) AS due_qty,
      COALESCE(site_po.po_no, '') AS po_no,

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
        WHEN COALESCE(site_po.requested_qty, 0) = 0 THEN 'PO_BEKLER'
        WHEN COALESCE(m.done_qty, 0) < COALESCE(site_po.requested_qty, 0) THEN 'PARTIAL'
        ELSE 'OK'
      END AS status,

      COALESCE(m.done_qty, 0) *
      CASE
        WHEN site_po.id IS NOT NULL THEN COALESCE(site_po.unit_price, 0)
        ELSE COALESCE(item_po.unit_price, 0)
      END AS total_done_amount

    FROM master_works m
    LEFT JOIN best_site_po site_po
      ON TRIM(COALESCE(site_po.project_code, '')) = TRIM(COALESCE(m.project_code, ''))
     AND UPPER(TRIM(COALESCE(site_po.site_code, ''))) = UPPER(TRIM(COALESCE(m.site_code, '')))
     AND TRIM(COALESCE(site_po.item_code, '')) = TRIM(COALESCE(m.item_code, ''))

    LEFT JOIN best_item_po item_po
      ON TRIM(COALESCE(item_po.item_code, '')) = TRIM(COALESCE(m.item_code, ''))

    LEFT JOIN best_boq
      ON TRIM(COALESCE(best_boq.s_bom_code, '')) = TRIM(COALESCE(m.item_code, ''))

    ${extraWhere}
    ${extraOrder}
  `;
}

app.get("/", (req, res) => {
  res.send("Finance backend çalışıyor");
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
        upload_batch TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

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
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

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
          SUM(COALESCE(payment_amount, 0)) AS total
        FROM hw_payment_rows
        WHERE EXTRACT(YEAR FROM payment_date) = $1
          AND payment_date IS NOT NULL
        GROUP BY EXTRACT(MONTH FROM payment_date)
        ORDER BY month_no
        `,
        [year],
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
        SELECT SUM(COALESCE(payment_amount, 0)) AS total_collections
        FROM hw_payment_rows
        WHERE EXTRACT(YEAR FROM payment_date) = $1
          AND payment_date IS NOT NULL
        `,
        [year],
      ),

      pool.query(
        `
        SELECT SUM(COALESCE(payment_amount, 0)) AS this_month_collections
        FROM hw_payment_rows
        WHERE EXTRACT(YEAR FROM payment_date) = $1
          AND EXTRACT(MONTH FROM payment_date) = $2
          AND payment_date IS NOT NULL
        `,
        [year, month],
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
        total_collections: Number(
          totalCollectionsResult.rows[0]?.total_collections || 0,
        ),
        this_month_collections: Number(
          thisMonthCollectionsResult.rows[0]?.this_month_collections || 0,
        ),
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
        COALESCE(site_po.requested_qty, 0) AS requested_qty,
        COALESCE(site_po.billed_qty, 0) AS billed_qty,
        COALESCE(site_po.due_qty, 0) AS due_qty,
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
    const userRole = String(req.user?.role || "").toLowerCase();
    const userSubcon = String(req.user?.subcon_name || "").trim();

    const extraWhere =
      userRole === "subcon" && userSubcon
        ? "WHERE LOWER(TRIM(COALESCE(m.subcon_name, ''))) = LOWER(TRIM($1))"
        : "";

    const params = userRole === "subcon" && userSubcon ? [userSubcon] : [];

    const result = await pool.query(buildMasterJoinedQuery(extraWhere), params);

    let rows = (result.rows || []).map((row) => ({
      ...row,
      currency: normalizeCurrency(row.currency),
    }));

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
app.post("/finance/invoice-entry/add", async (req, res) => {
  try {
    const {
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
      note,
    } = req.body;

    const result = await pool.query(
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
      RETURNING *
      `,
      [
        bolge || null,
        proje || null,
        proje_kodu || null,
        fatura_no || null,
        fatura_tarihi || null,
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
      ],
    );

    res.json({
      ok: true,
      row: result.rows[0],
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
      SELECT *
      FROM invoice_entries
      ORDER BY fatura_tarihi DESC NULLS LAST, id DESC
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
app.post("/hw-po/upload", upload.single("file"), async (req, res) => {
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
      const poNo = getCell(r, ["PO No", "PO", "Purchase Order", "PO Number"]);

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
          upload_batch
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
        ? String(siteCode).trim().toUpperCase()
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

    const normalizedSiteCode = String(siteCode).trim().toUpperCase();

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
    const autoRegion = getRegionFromSiteCode(data.site_code);
    const autoSiteType = getSiteTypeFromSiteCode(data.site_code);
    const autoCity = getCityFromSiteCode(data.site_code);

    if (!data.site_code) {
      return res.status(400).json({ error: "site_code zorunlu" });
    }

    const result = await pool.query(
      `
      INSERT INTO rollout_progress (
        site_code, site_type, bolge, il, site_physical_type,
        enh_site_type, atlas_status, gs_status, rf_not, survey_note,
        enh_not, qc_closed_date,
        enh_proje_subcon, enh_proje_hazir, enh_proje_not
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (site_code)
      DO UPDATE SET
        site_type = EXCLUDED.site_type,
        bolge = EXCLUDED.bolge,
        il = EXCLUDED.il,
        site_physical_type = EXCLUDED.site_physical_type,
        enh_site_type = EXCLUDED.enh_site_type,
        atlas_status = EXCLUDED.atlas_status,
        gs_status = EXCLUDED.gs_status,
        rf_not = EXCLUDED.rf_not,
        survey_note = EXCLUDED.survey_note,
        enh_not = EXCLUDED.enh_not,
        qc_closed_date = EXCLUDED.qc_closed_date,
        enh_proje_subcon = EXCLUDED.enh_proje_subcon,
        enh_proje_hazir = EXCLUDED.enh_proje_hazir,
        enh_proje_not = EXCLUDED.enh_proje_not,
        updated_at = NOW()
      RETURNING *
      `,
      [
        data.site_code, autoSiteType, autoRegion, autoCity,
        data.site_physical_type || null, data.enh_site_type || null,
        data.atlas_status || null, data.gs_status || null,
        data.rf_not || null, data.survey_note || null,
        data.enh_not || null, data.qc_closed_date || null,
        data.enh_proje_subcon || null,
        data.enh_proje_hazir || null,
        data.enh_proje_not || null,
      ],
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

    worksheet.columns = [
      { header: "Bölge", key: "bolge", width: 16 },
      { header: "Site Type", key: "site_type", width: 14 },
      { header: "Site Fiziksel Tip", key: "site_physical_type", width: 20 },
      { header: "Project Code", key: "project_code", width: 18 },
      { header: "Site Code", key: "site_code", width: 24 },
      { header: "Malzeme Status", key: "malzeme_status", width: 18 },
      { header: "İl", key: "il", width: 16 },
      { header: "RF Subcon", key: "rf_subcon", width: 22 },
      { header: "Plan Start Date", key: "plan_start_date", width: 18 },
      {
        header: "Installation Start Date",
        key: "installation_actual_start_date",
        width: 24,
      },
      {
        header: "Installation End Date",
        key: "installation_actual_end_date",
        width: 24,
      },
      { header: "OnAir Date", key: "onair_date", width: 18 },
      { header: "QC Closed Date", key: "qc_closed_date", width: 18 },
      { header: "RF Not", key: "rf_not", width: 35 },
      { header: "LOS Subcon", key: "los_subcon", width: 22 },
      { header: "LOS Plan Date", key: "los_plan_date", width: 18 },
      { header: "LOS Actual End Date", key: "los_actual_end_date", width: 22 },
      { header: "TSS Subcon", key: "tss_subcon", width: 22 },
      { header: "TSS Plan Start Date", key: "tss_plan_start_date", width: 22 },
      { header: "TSS Actual End Date", key: "tss_actual_end_date", width: 22 },
      { header: "TSSR Subcon", key: "tssr_subcon", width: 22 },
      {
        header: "TSSR Plan Start Date",
        key: "tssr_plan_start_date",
        width: 22,
      },
      {
        header: "TSSR Actual End Date",
        key: "tssr_actual_end_date",
        width: 22,
      },
      { header: "BTK Subcon", key: "btk_subcon", width: 22 },
      { header: "BTK Plan Start Date", key: "btk_plan_start_date", width: 22 },
      { header: "BTK Actual End Date", key: "btk_actual_end_date", width: 22 },
      { header: "BTK Approved by BTK", key: "btk_approved", width: 22 },
      { header: "GS Status", key: "gs_status", width: 18 },
      { header: "Survey Note", key: "survey_note", width: 35 },
      { header: "ENH Subcon", key: "enh_subcon", width: 22 },
      { header: "ENH Site Type", key: "enh_site_type", width: 18 },
      { header: "ENH Plan Start Date", key: "enh_plan_start_date", width: 22 },
      { header: "ENH Actual End Date", key: "enh_actual_end_date", width: 22 },
      { header: "ENH Not", key: "enh_not", width: 35 },
      { header: "Power Subcon", key: "power_subcon", width: 22 },
      {
        header: "Power Plan Start Date",
        key: "power_plan_start_date",
        width: 24,
      },
      {
        header: "Power Actual End Date",
        key: "power_actual_end_date",
        width: 24,
      },
      {
        header: "Abonelik Actual End Date",
        key: "abonelik_end_date",
        width: 24,
      },
      {
        header: "Horizon Actual End Date",
        key: "tt_horizon_end_date",
        width: 24,
      },
      { header: "PAC Actual End Date", key: "pac_end_date", width: 24 },
    ];

    worksheet.spliceRows(1, 0, []);

    const lastCol = worksheet.getColumn(worksheet.columns.length).letter;

    worksheet.mergeCells(`A1:${lastCol}1`);
    const titleCell = worksheet.getCell("A1");

    titleCell.value = `ROLLOUT DATA RAPORU - ${
      region && region !== "ALL" ? region : "Tüm Bölgeler"
    } (${new Date().toLocaleDateString("tr-TR")})`;

    titleCell.font = {
      bold: true,
      size: 16,
      color: { argb: "FFFFFFFF" },
    };

    titleCell.alignment = {
      horizontal: "center",
      vertical: "middle",
    };

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
        wrapText: true,
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

    result.rows.forEach((row) => {
      worksheet.addRow({
        ...row,
        site_type: getSiteTypeFromSiteCode(row.site_code),
      });
    });

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber < 3) return;

      row.eachCell((cell) => {
        const headerCell = worksheet.getRow(2).getCell(cell.col).value;
        const header =
          typeof headerCell === "object"
            ? headerCell?.richText?.[0]?.text || headerCell?.text
            : headerCell;

        if (header === "Site Type") {
          const value = String(cell.value || "").toUpperCase();

          if (value === "DSS") {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFFDE9D9" },
            };
            cell.font = { bold: true };
          }

          if (value === "LTE") {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFDDEBF7" },
            };
            cell.font = { bold: true };
          }

          if (value === "5G") {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFE2EFDA" },
            };
            cell.font = { bold: true };
          }
        }
      });
    });

    worksheet.views = [
      {
        state: "frozen",
        ySplit: 2,
        showGridLines: false,
      },
    ];

    worksheet.autoFilter = {
      from: "A2",
      to: `${lastCol}2`,
    };

    const safeRegion =
      region && region !== "ALL" && region !== "Tüm Bölgeler" ? region : "ALL";

    const fileName = `rollout_${safeRegion}_${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    // 🔥 Tüm Excel alanını tablo gibi çiz
    for (let i = 1; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);

      for (let j = 1; j <= worksheet.columnCount; j++) {
        const cell = row.getCell(j);

        if (cell.value === null || cell.value === undefined) {
          cell.value = "";
        }

        cell.border = {
          top: { style: "thin", color: { argb: "FFD9D9D9" } },
          left: { style: "thin", color: { argb: "FFD9D9D9" } },
          bottom: { style: "thin", color: { argb: "FFD9D9D9" } },
          right: { style: "thin", color: { argb: "FFD9D9D9" } },
        };
      }
    }
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

      const installEnd = qcOk
        ? r.installation_actual_end_date || r.onair_date || qcClosedDate || null
        : r.installation_actual_end_date || null;

      const onairDate = qcOk
        ? r.onair_date || r.installation_actual_end_date || qcClosedDate || null
        : r.onair_date || null;

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
        ? String(siteCode).trim().toUpperCase()
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
        return statusOk && qcOk && billedZero && diff === 0;
      }

      if (type === "20_fac_ok") {
        return statusOk && progressedQty > 0 && kabulOk;
      }

      if (type === "20_fac_nok") {
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
        const facBase = Number(row.due_qty || 0) * Number(row.unit_price || 0);

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
        currency: row.currency || "TRY",
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
    const siteCode = String(m.site_code || "")
      .trim()
      .toUpperCase();
    const itemCode = String(m.item_code || "").trim();

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

    if (duplicateCheck.rows.length > 0) {
      await pool.query(
        `
        UPDATE master_works
        SET
          done_qty = $1,
          subcon_name = $2,
          onair_date = $3,
          qc_durum = $4,
          kabul_durum = $5,
          kabul_not = $6,
          note = $7
        WHERE
          project_code = $8
          AND site_code = $9
          AND item_code = $10
        `,
        [
          parseNumber(m.done_qty),
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
        subcon_name,
        onair_date,
        note,
        qc_durum,
        kabul_durum,
        kabul_not
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
      `,
      [
        m.site_type || "5G",
        projectCode,
        siteCode,
        itemCode,
        m.item_description ? String(m.item_description).trim() : null,
        parseNumber(m.done_qty),
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
        tedarikci = $6,
        rf_montaj_firma = $7, -- ✅ EKLENDİ
        fatura_kalemi = $8,
        is_kalemi = $9,
        po_no = $10,
        site_id = $11,
        tutar = $12,
        kdv = $13,
        toplam_tutar = $14,
        odenen_tutar = $15,
        kalan_borc = $16,
        note = $17
      WHERE id = $18
      RETURNING *
      `,
      [
        bolge || null,
        proje || null,
        proje_kodu || null,
        fatura_no || null,
        fatura_tarihi || null,
        tedarikci || null,
        rf_montaj_firma || null, // ✅
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
        subcon_name = $7,
        onair_date = $8,
        note = $9,
        qc_durum = $10,
        kabul_durum = $11,
        kabul_not = $12
      WHERE id = $13
      RETURNING *
      `,
      [
        m.site_type || "5G",
        m.project_code ? String(m.project_code).trim() : null,
        m.site_code ? String(m.site_code).trim().toUpperCase() : null,
        m.item_code ? String(m.item_code).trim() : null,
        m.item_description ? String(m.item_description).trim() : null,
        parseNumber(m.done_qty),
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

  const paymentRate =
    String(subconName || "")
      .trim()
      .toLowerCase() === "federal"
      ? 0.8
      : String(subconName || "")
            .trim()
            .toLowerCase() === "ubs"
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
      { header: "Bölge", key: "region", width: 14 },
      { header: "Project Code", key: "project_code", width: 16 },
      { header: "Site Code", key: "site_code", width: 22 },
      { header: "Item Code", key: "item_code", width: 16 },
      { header: "Item Description", key: "item_description", width: 45 },
      { header: "Done Qty", key: "done_qty", width: 12 },
      { header: "Requested Qty", key: "requested_qty", width: 14 },
      { header: "OnAir Date", key: "onair_date", width: 14 },
      { header: "Subcon Name", key: "subcon_name", width: 20 },
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

      sheet.addRow({
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
      headerRowNumber: 2,
      freezeRow: 2,
      filterFrom: "A2",
      filterTo: "P2",
      statusColumn: "B",
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

      if (subconName === "federal") {
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
      rows = rows.filter(
        (row) => String(row.status || "").toUpperCase() === "PO_BEKLER",
      );
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
    ];

    worksheet.spliceRows(1, 0, []);
    worksheet.mergeCells("A1:L1");
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

      const hakedisTL =
        curr === "USD" ? hakedisRaw * Number(usdTryRate || 0) : hakedisRaw;

      const faturayaHazirTL =
        curr === "USD"
          ? faturayaHazirRaw * Number(usdTryRate || 0)
          : faturayaHazirRaw;

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
    });
  } catch (err) {
    console.error("SUBCON HAKEDIS SUMMARY ERROR:", err);
    res.status(500).json({
      ok: false,
      error: err.message || "Taşeron hakediş özeti alınamadı",
    });
  }
});

/* ================== FINANCE HW PAYMENT UPLOAD ================== */
app.post(
  "/finance/hw-payment/upload",
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

      let inserted = 0;

      for (let i = 1; i < rows.length; i++) {
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
            currency
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
          ],
        );

        inserted++;
      }

      res.json({
        ok: true,
        inserted,
        message: "HW Payment raporu yüklendi",
        sheet_name: firstSheetName,
      });
    } catch (err) {
      console.error("FINANCE HW PAYMENT UPLOAD ERROR:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  },
);

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

      // Excel'i düz satır-satır oku
      const rawRows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: null,
      });

      if (!rawRows || rawRows.length < 3) {
        return res.status(400).json({
          ok: false,
          error: "Excel içinde yeterli veri bulunamadı",
        });
      }

      await ensureHwInvoiceTable();
      await pool.query(`DELETE FROM hw_invoice_rows`);

      let inserted = 0;

      // İlk 2 satırı geçiyoruz, veri 3. satırdan itibaren başlıyor
      const dataRows = rawRows.slice(2);

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
           upload_batch
         )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          `,
          [
            invoiceNo,
            finalAmount,
            invoiceDate,
            null,
            currency,
            terms,
            invoiceStatus,
            req.file.filename,
          ],
        );

        inserted++;
      }

      return res.json({
        ok: true,
        inserted,
        message: "HW Fatura raporu yüklendi",
        sheet_name: firstSheetName,
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

/* ================== FINANCE UPCOMING COLLECTIONS ================== */
app.get("/finance/upcoming-payments", async (req, res) => {
  try {
    const upcomingData = await buildUpcomingCollectionsData();
    const overdueData = await buildOverdueInvoicesData();

    const todayReceivedResult = await pool.query(`
      SELECT COALESCE(SUM(COALESCE(payment_amount, 0)), 0) AS today_received_total
      FROM hw_payment_rows
      WHERE payment_date IS NOT NULL
        AND payment_date::date = CURRENT_DATE
    `);

    res.json({
      ok: true,
      rows: upcomingData.rows,
      overdue_rows: overdueData.rows,
      summary: {
        ...upcomingData.summary,
        today_received_total: Number(
          todayReceivedResult.rows[0]?.today_received_total || 0,
        ),
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

/* ===== FATURA BELGE UPLOAD & VIEW ===== */

// DB kolonu ekle (idempotent)
pool.query(`ALTER TABLE invoice_entries ADD COLUMN IF NOT EXISTS belge_path TEXT`).catch(() => {});

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

// ISG eğitim türleri (sabit liste)
const ISG_EGITIM_TURLERI = [
  { tur: "Temel İSG Eğitimi", gecerlilik_yil: 2 },
  { tur: "İlk Yardım Eğitimi", gecerlilik_yil: 3 },
  { tur: "Yangın Söndürme ve Tahliye Eğitimi", gecerlilik_yil: 1 },
  { tur: "Yüksekte Çalışma Eğitimi", gecerlilik_yil: 3 },
  { tur: "Elektrik İş Güvenliği Eğitimi", gecerlilik_yil: 3 },
  { tur: "KKD Kullanımı Eğitimi", gecerlilik_yil: 2 },
  { tur: "Elle Taşıma İşleri Eğitimi", gecerlilik_yil: 2 },
  { tur: "Ergonomi Eğitimi", gecerlilik_yil: 2 },
  { tur: "Acil Durum ve Tahliye Eğitimi", gecerlilik_yil: 1 },
  { tur: "Kimyasal Maddeler Eğitimi", gecerlilik_yil: 2 },
  { tur: "Gürültü ve Titreşim Eğitimi", gecerlilik_yil: 2 },
  { tur: "Anten ve Baz İstasyonu Güvenliği", gecerlilik_yil: 2 },
  { tur: "İş Ekipmanları Kullanımı Eğitimi", gecerlilik_yil: 3 },
  { tur: "Kazı ve Zemin Güvenliği Eğitimi", gecerlilik_yil: 2 },
  { tur: "Trafik ve Karayolu Güvenliği", gecerlilik_yil: 2 },
  { tur: "Stres ve Zorbalık Önleme Eğitimi", gecerlilik_yil: 2 },
  { tur: "Ortam Ölçümleri Bilgilendirme", gecerlilik_yil: 2 },
  { tur: "İş Kazası ve Ramak Kala Bildirimi", gecerlilik_yil: 2 },
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
    const r = await pool.query("SELECT * FROM personel ORDER BY aktif DESC, ad_soyad ASC");
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/hr/personel", async (req, res) => {
  try {
    const { ad_soyad, tc_no, dogum_tarihi, telefon, email, unvan, bolge, ise_giris_tarihi,
      net_maas, bankadan_gosterilen, elden_verilen, iban, banka_adi, banka_hesap_no } = req.body;
    const r = await pool.query(
      `INSERT INTO personel (ad_soyad,tc_no,dogum_tarihi,telefon,email,unvan,bolge,ise_giris_tarihi,
        net_maas,bankadan_gosterilen,elden_verilen,iban,banka_adi,banka_hesap_no)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [ad_soyad,tc_no||null,dogum_tarihi||null,telefon,email,unvan,bolge,ise_giris_tarihi||null,
       net_maas||0,bankadan_gosterilen||0,elden_verilen||0,iban,banka_adi,banka_hesap_no]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/hr/personel/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { ad_soyad, tc_no, dogum_tarihi, telefon, email, unvan, bolge, ise_giris_tarihi,
      isten_ayrilma_tarihi, net_maas, bankadan_gosterilen, elden_verilen, iban, banka_adi,
      banka_hesap_no, aktif } = req.body;
    const r = await pool.query(
      `UPDATE personel SET ad_soyad=$1,tc_no=$2,dogum_tarihi=$3,telefon=$4,email=$5,unvan=$6,
        bolge=$7,ise_giris_tarihi=$8,isten_ayrilma_tarihi=$9,net_maas=$10,bankadan_gosterilen=$11,
        elden_verilen=$12,iban=$13,banka_adi=$14,banka_hesap_no=$15,aktif=$16 WHERE id=$17 RETURNING *`,
      [ad_soyad,tc_no||null,dogum_tarihi||null,telefon,email,unvan,bolge,ise_giris_tarihi||null,
       isten_ayrilma_tarihi||null,net_maas||0,bankadan_gosterilen||0,elden_verilen||0,
       iban,banka_adi,banka_hesap_no,aktif!==undefined?aktif:true,id]
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
    const fname = `personel-${id}-${tur}-${Date.now()}${path.extname(req.file.originalname).toLowerCase()}`;
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
    const fname = `isg-${req.params.isgId}-${Date.now()}${path.extname(req.file.originalname).toLowerCase()}`;
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
      const fname = `puantaj_${Date.now()}${path.extname(req.file.originalname)}`;
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
    const personelList = await pool.query("SELECT * FROM personel WHERE aktif=true OR isten_ayrilma_tarihi IS NOT NULL ORDER BY ad_soyad");

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
      // Base salary minus GELMEDI deductions, plus Sunday overtime bonus (1.5x daily rate)
      const hakedilen = Math.round(netMaas - gelmedi * dailyRate + pazarCalisdi * dailyRate * 1.5);
      const pazarBonus = Math.round(pazarCalisdi * dailyRate * 1.5);

      const bankaDailyRate = (Number(p.bankadan_gosterilen) || 0) / REFERANS_GUN;
      const eldenDailyRate = (Number(p.elden_verilen) || 0) / REFERANS_GUN;
      const bankadan = Math.round((Number(p.bankadan_gosterilen) || 0) - gelmedi * bankaDailyRate);
      const elden = Math.round((Number(p.elden_verilen) || 0) - gelmedi * eldenDailyRate);

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
    const { personel_id, tarih, tutar, aciklama, avans_turu = "MAAS" } = req.body;
    const r = await pool.query(
      "INSERT INTO avans (personel_id,tarih,tutar,aciklama,avans_turu) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [personel_id, tarih, tutar, aciklama, avans_turu]
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

app.delete("/hr/maas-odeme/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM maas_odeme WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ISG uyarı özeti (süresi biten/bitecek eğitimler)
app.get("/hr/isg/uyarilar", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT i.*, p.ad_soyad, p.unvan,
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
    const { ay, yil } = req.query;
    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook();

    // ── Açıklama sayfası (ilk sayfa) ──
    const wsAciklama = wb.addWorksheet("Açıklama");
    wsAciklama.columns = [{ width: 22 }, { width: 40 }];
    const aciklamaBaslik = wsAciklama.addRow(["PUANTAJ SİMGELERİ AÇIKLAMASI"]);
    aciklamaBaslik.getCell(1).font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
    aciklamaBaslik.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
    wsAciklama.mergeCells(`A1:B1`);
    aciklamaBaslik.getCell(1).alignment = { horizontal: "center" };
    wsAciklama.addRow([]);
    const aciklamalar = [
      ["✅  ÇALIŞTI",    "Personel o gün çalışmıştır.",           "FFD1FAE5"],
      ["❌  GELMEDİ",    "Personel o gün işe gelmemiştir (ücretsiz).", "FFFEE2E2"],
      ["🏖  İZİN",       "Yıllık izin kullanılmıştır (ücretli).", "FFDBEAFE"],
      ["☪️  RAPOR",      "Sağlık raporu / hastalık izni.",         "FFFEF3C7"],
      ["⭕  TATİL",      "Hafta tatili veya girilmemiş gün.",      "FFF9FAFB"],
      ["💤  DİNLENME",   "Pazar fazla mesai karşılığı dinlenme.",  "FFF3E8FF"],
      ["🎌  RESMİ TATİL","Ulusal veya dini resmi tatil günü.",     "FFDBEAFE"],
    ];
    for (const [simge, aciklama, renk] of aciklamalar) {
      const r = wsAciklama.addRow([simge, aciklama]);
      r.getCell(1).font = { bold: true };
      r.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: renk } }; c.alignment = { vertical: "middle" }; });
      r.height = 22;
    }
    wsAciklama.addRow([]);
    const notSatir = wsAciklama.addRow(["NOT:", "Maaş bilgileri bu Excel'e dahil edilmemiştir."]);
    notSatir.getCell(1).font = { bold: true, color: { argb: "FFB91C1C" } };
    notSatir.getCell(2).font = { italic: true, color: { argb: "FF6B7280" } };

    // ── Puantaj sayfası ──
    const ws = wb.addWorksheet("Puantaj");

    const totalDays = new Date(Number(yil), Number(ay), 0).getDate();
    const personelList = await pool.query("SELECT * FROM personel WHERE aktif=true ORDER BY ad_soyad");
    const puantajRows = await pool.query(
      `SELECT id, personel_id, tarih, durum, not_aciklama, belge_yolu FROM puantaj
       WHERE EXTRACT(MONTH FROM tarih)=$1 AND EXTRACT(YEAR FROM tarih)=$2`, [ay, yil]
    );

    const ayGunleri = Array.from({ length: totalDays }, (_, i) => i + 1);
    const headers = ["Personel", "Unvan", ...ayGunleri.map(g => String(g)), "Çalışılan"];
    const headerRow = ws.addRow(headers);
    headerRow.eachCell(cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "center" };
    });

    const DURUM_LABEL = { CALISDI:"✅", GELMEDI:"❌", IZIN:"🏖", RAPOR:"☪️", TATIL:"⭕", DINLENME:"💤", RESMI_TATIL:"🎌" };
    const DURUM_COLOR = { CALISDI:"FFD1FAE5", GELMEDI:"FFFEE2E2", IZIN:"FFDBEAFE", RAPOR:"FFFEF3C7", TATIL:"FFF9FAFB", DINLENME:"FFF3E8FF", RESMI_TATIL:"FFDBEAFE" };

    // ── Notlar sayfası ──
    const wsNot = wb.addWorksheet("Notlar");
    const notHeaders = wsNot.addRow(["Personel", "Tarih", "Durum", "Not", "Belge"]);
    notHeaders.eachCell(cell => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF991B1B" } };
    });
    wsNot.columns = [{ width: 22 }, { width: 14 }, { width: 14 }, { width: 50 }, { width: 30 }];

    for (const p of personelList.rows) {
      const rowData = [p.ad_soyad, p.unvan || ""];
      let calisilan = 0;

      for (const g of ayGunleri) {
        const tarih = `${yil}-${String(ay).padStart(2,"0")}-${String(g).padStart(2,"0")}`;
        const pr = puantajRows.rows.find(x => x.personel_id === p.id && x.tarih?.toISOString?.().startsWith(tarih));
        const durum = pr?.durum || "TATIL";
        if (durum === "CALISDI") calisilan++;
        rowData.push(DURUM_LABEL[durum] || "");
        if (pr?.not_aciklama || pr?.belge_yolu) {
          const notRow = wsNot.addRow([p.ad_soyad, tarih, durum, pr.not_aciklama || "", pr.belge_yolu || ""]);
          notRow.getCell(4).alignment = { wrapText: true };
          const notRenk = { GELMEDI:"FFFEE2E2", RAPOR:"FFFEF3C7", IZIN:"FFDBEAFE" }[durum];
          if (notRenk) notRow.eachCell(c => { c.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:notRenk } }; });
        }
      }

      rowData.push(calisilan);
      const excelRow = ws.addRow(rowData);
      excelRow.getCell(1).font = { bold: true };

      for (const g of ayGunleri) {
        const tarih = `${yil}-${String(ay).padStart(2,"0")}-${String(g).padStart(2,"0")}`;
        const pr = puantajRows.rows.find(x => x.personel_id === p.id && x.tarih?.toISOString?.().startsWith(tarih));
        const durum = pr?.durum || "TATIL";
        const cell = excelRow.getCell(g + 2); // +2 = Personel + Unvan
        cell.alignment = { horizontal: "center" };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DURUM_COLOR[durum] || "FFF9FAFB" } };
        if (pr?.not_aciklama) cell.note = { texts: [{ text: pr.not_aciklama }] };
      }
    }

    ws.columns.forEach((col, i) => { col.width = i < 2 ? 20 : i < 2 + totalDays ? 5 : 10; });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=puantaj_${yil}_${String(ay).padStart(2,"0")}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/hr/excel/isg", async (req, res) => {
  try {
    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("ISG Eğitimleri");

    const personelList = await pool.query("SELECT * FROM personel WHERE aktif=true ORDER BY ad_soyad");
    const isgList = await pool.query(`
      SELECT i.*, p.ad_soyad, p.unvan FROM personel_isg i
      JOIN personel p ON i.personel_id=p.id
      WHERE p.aktif=true ORDER BY p.ad_soyad, i.egitim_turu
    `);

    const headers = ["Personel", "Unvan", "Eğitim Türü", "Başlangıç", "Bitiş", "Durum"];
    const hr = ws.addRow(headers);
    hr.eachCell(cell => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
      cell.alignment = { horizontal: "center" };
    });

    const now = new Date();
    const soon = new Date(Date.now() + 30 * 86400000);

    for (const eg of isgList.rows) {
      const bitis = new Date(eg.bitis_tarihi);
      const expired = bitis < now;
      const expiring = bitis < soon && !expired;
      const durum = expired ? "SÜRESİ DOLDU" : expiring ? "YAKLAŞIYOR (30 gün)" : "Geçerli";
      const r = ws.addRow([
        eg.ad_soyad, eg.unvan || "",
        eg.egitim_turu,
        eg.egitim_tarihi?.toISOString?.().split("T")[0] || "",
        eg.bitis_tarihi?.toISOString?.().split("T")[0] || "",
        durum,
      ]);
      if (expired) {
        r.eachCell(cell => { cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFFEE2E2" } }; });
        r.getCell(6).font = { bold: true, color: { argb: "FF991B1B" } };
      } else if (expiring) {
        r.eachCell(cell => { cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFFFFBEB" } }; });
        r.getCell(6).font = { bold: true, color: { argb: "FF92400E" } };
      }
    }

    ws.columns.forEach((col, i) => { col.width = [22, 16, 36, 14, 14, 22][i] || 16; });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=isg_egitimler.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
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

app.get("/hr/is-avans", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT t.*, p.ad_soyad as personel_ad
      FROM is_avans_talep t
      LEFT JOIN personel p ON t.personel_id = p.id
      ORDER BY t.created_at DESC
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/hr/is-avans", async (req, res) => {
  try {
    const { personel_id, talep_eden_email, talep_eden_ad, tutar, aciklama, not_aciklama, tarih, gider_turu, bolge, proje } = req.body;
    const r = await pool.query(
      `INSERT INTO is_avans_talep (personel_id,talep_eden_email,talep_eden_ad,tutar,aciklama,not_aciklama,tarih,gider_turu,bolge,proje)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [personel_id || null, talep_eden_email, talep_eden_ad, tutar, aciklama, not_aciklama, tarih, gider_turu || null, bolge || null, proje || null]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/hr/is-avans/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { personel_id, tutar, aciklama, not_aciklama, tarih, gider_turu, bolge, proje } = req.body;
    const check = await pool.query("SELECT durum FROM is_avans_talep WHERE id=$1", [id]);
    if (!check.rows[0] || check.rows[0].durum !== "TALEP") {
      return res.status(400).json({ error: "Sadece TALEP durumundaki kayıtlar düzenlenebilir" });
    }
    const r = await pool.query(
      `UPDATE is_avans_talep SET personel_id=$1,tutar=$2,aciklama=$3,not_aciklama=$4,tarih=$5,gider_turu=$6,bolge=$7,proje=$8 WHERE id=$9 RETURNING *`,
      [personel_id || null, tutar, aciklama, not_aciklama, tarih, gider_turu || null, bolge || null, proje || null, id]
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

app.put("/hr/is-avans/:id/onayla", async (req, res) => {
  try {
    const { id } = req.params;
    const row = await pool.query("SELECT * FROM is_avans_talep WHERE id=$1", [id]);
    if (!row.rows[0]) return res.status(404).json({ error: "Kayıt bulunamadı" });
    const talep = row.rows[0];
    const today = new Date().toISOString().split("T")[0];
    let updateSql, updateParams;

    if (talep.durum === "TALEP") {
      updateSql = "UPDATE is_avans_talep SET durum='PM_ONAY', pm_onay_tarihi=$1 WHERE id=$2 RETURNING *";
      updateParams = [today, id];
    } else if (talep.durum === "PM_ONAY") {
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

    const { email, durum, gider_turu, bolge, proje, baslangic, bitis } = req.query;
    const conditions = [];
    const params = [];
    if (email) { conditions.push(`t.talep_eden_email = $${params.length+1}`); params.push(email); }
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
    ws.mergeCells("A1:M1");
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
      TALEP: "Talep Edildi", PM_ONAY: "PM Onayında", DIREKTOR_ONAY: "Direktör Onayında",
      TAMAMLANDI: "Tamamlandı ✓", REDDEDILDI: "Reddedildi ✗"
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
        cell.alignment = { vertical: "middle", wrapText: ci === 8 || ci === 9 };

        // Row background
        let bg = isEven ? "FFFFFFFF" : "FFF0F4FF";
        if (t.durum === "TAMAMLANDI") bg = isEven ? "FFD1FAE5" : "FFBCF0DA";
        else if (t.durum === "REDDEDILDI") bg = isEven ? "FFFEE2E2" : "FFFECACA";
        else if (t.durum === "PM_ONAY" || t.durum === "DIREKTOR_ONAY") bg = isEven ? "FFFEF3C7" : "FFFDE68A";

        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        cell.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } };

        if (ci === 7) { // Tutar column
          cell.numFmt = '#,##0.00 ₺';
          cell.alignment = { horizontal: "right", vertical: "middle" };
          cell.font = { name: "Arial", size: 10, bold: true };
        }
        if (ci === 10) cell.alignment = { horizontal: "center", vertical: "middle" }; // Durum
        if (ci === 0) cell.alignment = { horizontal: "center", vertical: "middle" };  // ID
      });

      row.height = 18;
    });

    // Totals row
    const totRow = ws.getRow(list.rows.length + 3);
    totRow.getCell(7).value = "TOPLAM:";
    totRow.getCell(7).font = { bold: true, name: "Arial" };
    totRow.getCell(7).alignment = { horizontal: "right" };
    totRow.getCell(8).value = { formula: `SUM(H3:H${list.rows.length + 2})` };
    totRow.getCell(8).numFmt = '#,##0.00 ₺';
    totRow.getCell(8).font = { bold: true, name: "Arial", color: { argb: "FF166534" } };
    totRow.getCell(8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
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

// POST create form
app.post("/hr/masraf-form", async (req, res) => {
  try {
    const { personel_id, talep_eden_email, talep_eden_ad, donem } = req.body;
    const noRes = await pool.query(`SELECT COALESCE(MAX(form_no), 0) + 1 AS next_no FROM masraf_form`);
    const nextNo = noRes.rows[0].next_no;
    const { rows } = await pool.query(
      `INSERT INTO masraf_form (personel_id,talep_eden_email,talep_eden_ad,donem,form_no)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [personel_id, talep_eden_email, talep_eden_ad, donem, nextNo]
    );
    res.json(rows[0]);
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
    const { form_id, kategori, tarih, belge_no, belge_aciklama, aciklama, tutar, fis_var, fis_olmadan_aciklama } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO masraf_kalem (form_id,kategori,tarih,belge_no,belge_aciklama,aciklama,tutar,fis_var,fis_olmadan_aciklama)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [form_id, kategori, tarih, belge_no||null, belge_aciklama||null, aciklama||null, tutar, fis_var!==false, fis_olmadan_aciklama||null]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT update kalem (fis_var, tutar_uyari_aciklama etc)
app.put("/hr/masraf-kalem/:id", async (req, res) => {
  try {
    const { fis_var, fis_olmadan_aciklama, tutar_uyari_aciklama } = req.body;
    const { rows } = await pool.query(
      `UPDATE masraf_kalem
       SET fis_var = COALESCE($1, fis_var),
           fis_olmadan_aciklama = COALESCE($2, fis_olmadan_aciklama),
           tutar_uyari_aciklama = COALESCE($3, tutar_uyari_aciklama)
       WHERE id=$4 RETURNING *`,
      [fis_var ?? null, fis_olmadan_aciklama||null, tutar_uyari_aciklama||null, req.params.id]
    );
    res.json(rows[0]);
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
    const fname = `${Date.now()}-${req.file.originalname}`;
    const { url } = await uploadToStorage("masraf-belgeler", fname, req.file.buffer, req.file.mimetype);
    const { rows } = await pool.query(
      `INSERT INTO masraf_belge (kalem_id, form_id, dosya_adi, dosya_yolu)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [kalemId, form_id, req.file.originalname, url]
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
      [norm,marka,model,yil,tip,kiralama_firmasi,sozlesme_no,
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
       marka,model,yil,tip,kiralama_firmasi,sozlesme_no,
       kira_baslangic||null,kira_bitis||null,aylik_kira||null,bolge,surucu,
       sigorta_bitis||null,muayene_bitis||null,durum,notlar,aktif??null]
    );
    res.json(rows[0]);
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
    const fname = `${Date.now()}-${req.file.originalname}`;
    const { url } = await uploadToStorage("arac-belgeler", fname, req.file.buffer, req.file.mimetype);
    const { rows } = await pool.query(
      "INSERT INTO arac_belgeler (arac_id,belge_turu,dosya_adi,dosya_yolu,aciklama) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [req.params.id, belge_turu, req.file.originalname, url, aciklama||null]
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

// ─── OFİS & DEPO ─────────────────────────────────────────────────────────────
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
    const fname = `${Date.now()}-${req.file.originalname}`;
    const { url } = await uploadToStorage("ofis-belgeler", fname, req.file.buffer, req.file.mimetype);
    const { rows } = await pool.query(
      "INSERT INTO ofis_belgeler (ofis_id,belge_turu,dosya_adi,dosya_yolu,aciklama) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [req.params.id, belge_turu||'DIGER', req.file.originalname, url, aciklama||null]
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
    const { rows } = await pool.query(
      `UPDATE masraf_form SET durum='PM_BEKLE' WHERE id=$1 AND durum='TASLAK' RETURNING *`,
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
    const { direktor_not } = req.body;
    const formRes = await pool.query(
      `UPDATE masraf_form SET durum='TAMAMLANDI', direktor_not=$1, direktor_onay_tarihi=NOW() WHERE id=$2 RETURNING *`,
      [direktor_not||null, req.params.id]
    );
    const form = formRes.rows[0];
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
    const rows = kalemler.rows;

    const KATS = [
      { key: "YEMEK", label: "YİYECEK VE İÇECEK GİDERLERİ", aciklamaLabel: "AÇIKLAMA (PROJE VEYA İŞ ADI)" },
      { key: "YAKIT", label: "ARAÇ YAKIT VE BAKIM GİDERLERİ", aciklamaLabel: "AÇIKLAMA (ARAÇ PLAKA NO)" },
      { key: "KONAKLAMA", label: "KONAKLAMA GİDERLERİ", aciklamaLabel: "AÇIKLAMA (KAÇ GECE, KİŞİ SAYISI)" },
      { key: "ULASIM", label: "ULAŞIM GİDERLERİ", aciklamaLabel: "AÇIKLAMA (BİNİŞ SAATİ, GÜZERGAH)" },
      { key: "KOPRU", label: "KÖPRÜ / OTOYOL GEÇİŞ GİDERLERİ", aciklamaLabel: "AÇIKLAMA (GEÇİŞ DETAYI)" },
      { key: "MALZEME", label: "MALZEME GİDERLERİ", aciklamaLabel: "AÇIKLAMA (MALZEME DETAYI)" },
      { key: "DIGER", label: "DİĞER GİDERLER", aciklamaLabel: "AÇIKLAMA (İŞİN DETAYI)" },
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

// PUT arsivle
app.put("/hr/masraf-form/:id/arsivle", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE masraf_form SET durum='ARSIVLENDI' WHERE id=$1 AND durum='TAMAMLANDI' RETURNING *`,
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

// ── Otomatik migration: her deploy/restart'ta eksik kolonları ekle ──
const AUTO_MIGRATIONS = [
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
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS power_subcon TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS power_plan_start_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS power_actual_end_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS abonelik_actual_end_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS abonelik_end_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tt_horizon_actual_end_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS pac_actual_end_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS pac_belge_url TEXT",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS tamamlanma_tarihi DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS qc_closed_date DATE",
  "ALTER TABLE rollout_progress ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
];

(async () => {
  try {
    for (const sql of AUTO_MIGRATIONS) {
      await pool.query(sql).catch(() => {});
    }
    console.log("✅ Auto-migrations tamamlandı");
  } catch (e) {
    console.error("Migration hatası:", e.message);
  }
})();

// ─── TAŞERON KULLANICI SEED ───────────────────────────────────────────────────
const SUBCON_USERS = [
  { name: "Zeki Sandal",  email: "zsandal@ubstasarimmakine.com.tr", subcon_name: "UBS",     payment_rate: 0.75 },
  { name: "Burhan Koçak", email: "b.kocak@federalgroups.com",       subcon_name: "Federal", payment_rate: 0.80 },
];

(async () => {
  for (const u of SUBCON_USERS) {
    try {
      const existing = await pool.query(
        "SELECT id, subcon_name, payment_rate FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1",
        [u.email.toLowerCase()]
      );
      if (existing.rows.length === 0) {
        const hash = await bcrypt.hash("123456", 10);
        await pool.query(
          `INSERT INTO users (name, email, password_hash, role, is_active, subcon_name, payment_rate)
           VALUES ($1, $2, $3, 'subcon', true, $4, $5)`,
          [u.name, u.email, hash, u.subcon_name, u.payment_rate]
        );
        console.log(`✅ ${u.subcon_name} kullanıcısı oluşturuldu: ${u.email}`);
      } else if (existing.rows[0].subcon_name !== u.subcon_name || Number(existing.rows[0].payment_rate) !== u.payment_rate) {
        await pool.query(
          `UPDATE users SET subcon_name = $1, payment_rate = $2, role = 'subcon', is_active = true
           WHERE LOWER(TRIM(email)) = $3`,
          [u.subcon_name, u.payment_rate, u.email.toLowerCase()]
        );
        console.log(`✅ ${u.subcon_name} kullanıcısı güncellendi: ${u.email}`);
      } else {
        console.log(`ℹ️  ${u.subcon_name} kullanıcısı zaten doğru`);
      }
    } catch (e) {
      console.error(`${u.subcon_name} seed hatası:`, e.message);
    }
  }
})();

if (process.env.NODE_ENV !== "production" || process.env.LOCAL_SERVER) {
  app.listen(PORT, () => {
    console.log(`Server çalışıyor: ${PORT}`);
  });
}

module.exports = app;
