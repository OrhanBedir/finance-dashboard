require("dotenv").config();

console.log("DB ENV:", {
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});
const express = require("express");
const cors = require("cors");
const pool = require("./db");
const multer = require("multer");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const app = express();

/* ================== MIDDLEWARE ================== */
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true });
});
app.use(express.urlencoded({ extended: true }));

/* ================== UPLOAD ================== */
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({ storage });

/* ================== HELPERS ================== */

app.get("/finance-auth/test-login", (req, res) => {
  res.json({
    ok: true,
    info: "Login endpoint POST çalışır",
    email: "orhan.bedir@simsektel.com",
    password: "simsek2026",
  });
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
      user: { email },
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

async function buildUpcomingCollectionsData() {
  const result = await pool.query(`
    SELECT
      p.invoice_no,
      p.due_date,
      p.payment_date,
      COALESCE(p.remaining_amount, 0) AS remaining_amount,
      COALESCE(p.currency, 'TRY') AS currency,
      i.invoice_date,
      COALESCE(i.terms, '') AS terms
    FROM hw_payment_rows p
    LEFT JOIN hw_invoice_rows i
      ON TRIM(COALESCE(i.invoice_no, '')) = TRIM(COALESCE(p.invoice_no, ''))
    WHERE COALESCE(p.remaining_amount, 0) > 0
    ORDER BY p.id ASC
  `);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(today);
  const day = endOfWeek.getDay();
  const diffToSunday = day === 0 ? 0 : 7 - day;
  endOfWeek.setDate(endOfWeek.getDate() + diffToSunday);
  endOfWeek.setHours(23, 59, 59, 999);

  const rows = [];
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

    let effectiveDueDate = null;

    // Önce payment tablosundaki due_date'i kullan
    if (row.due_date) {
      effectiveDueDate = new Date(row.due_date);
      effectiveDueDate.setHours(0, 0, 0, 0);
    }

    // due_date yoksa invoice_date + terms ile hesapla
    if (!effectiveDueDate && row.invoice_date) {
      const invoiceDateObj = new Date(row.invoice_date);
      invoiceDateObj.setHours(0, 0, 0, 0);

      const addDays = getTermDays(row.terms);
      const calculatedDue = new Date(invoiceDateObj);
      calculatedDue.setDate(calculatedDue.getDate() + addDays);
      calculatedDue.setHours(0, 0, 0, 0);

      effectiveDueDate = calculatedDue;
    }

    // Eğer invoice tarafı yoksa payment tablosundaki due_date'e düş
    if (!effectiveDueDate && row.due_date) {
      effectiveDueDate = new Date(row.due_date);
      effectiveDueDate.setHours(0, 0, 0, 0);
    }

    if (!effectiveDueDate || Number.isNaN(effectiveDueDate.getTime())) {
      continue;
    }

    const dueMonth = effectiveDueDate.getMonth() + 1;

    if (effectiveDueDate.getTime() < today.getTime()) {
      overdueTotal += amount;
      continue;
    }

    monthlyUpcoming[dueMonth] += amount;

    const dayNameEn = effectiveDueDate.toLocaleDateString("en-US", {
      weekday: "long",
    });

    const day_name =
      dayNameEn === "Monday"
        ? "Pazartesi"
        : dayNameEn === "Tuesday"
          ? "Salı"
          : dayNameEn === "Wednesday"
            ? "Çarşamba"
            : dayNameEn === "Thursday"
              ? "Perşembe"
              : dayNameEn === "Friday"
                ? "Cuma"
                : dayNameEn === "Saturday"
                  ? "Cumartesi"
                  : "Pazar";

    const yyyy = effectiveDueDate.getFullYear();
    const mm = String(effectiveDueDate.getMonth() + 1).padStart(2, "0");
    const dd = String(effectiveDueDate.getDate()).padStart(2, "0");
    const key = `${yyyy}-${mm}-${dd}`;

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        due_date: key,
        day_name,
        amount: 0,
        currency: row.currency || "TRY",
      });
    }

    const current = groupedMap.get(key);
    current.amount += amount;

    if (effectiveDueDate.getTime() === today.getTime()) {
      todayTotal += amount;
    }

    if (effectiveDueDate >= today && effectiveDueDate <= endOfWeek) {
      weekTotal += amount;
    }
  }

  groupedMap.forEach((value) => {
    rows.push(value);
  });

  rows.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

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
      COALESCE(remaining_amount, 0) AS remaining_amount,
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

function getRegion(siteCode) {
  const code = String(siteCode || "").toUpperCase();

  if (
    code.startsWith("ES") ||
    code.startsWith("BO") ||
    code.startsWith("ZO") ||
    code.startsWith("KA")
  ) {
    return "ANKARA";
  }

  if (
    code.startsWith("IZ") ||
    code.startsWith("US") ||
    code.startsWith("MU") ||
    code.startsWith("MN") ||
    code.startsWith("AI") ||
    code.startsWith("DE")
  ) {
    return "İZMİR";
  }

  if (
    code.startsWith("AT") ||
    code.startsWith("IP") ||
    code.startsWith("BU") ||
    code.startsWith("AF")
  ) {
    return "ANTALYA";
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
      m.created_at,

      COALESCE(site_po.requested_qty, 0) AS requested_qty,
      COALESCE(site_po.billed_qty, 0) AS billed_qty,
      COALESCE(site_po.due_qty, 0) AS due_qty,
      COALESCE(site_po.po_no, '') AS po_no,

      CASE
        WHEN site_po.id IS NOT NULL THEN COALESCE(site_po.unit_price, 0)
        ELSE COALESCE(item_po.unit_price, 0)
      END AS unit_price,

      COALESCE(best_boq.currency, 'TRY') AS currency,

      CASE
        WHEN COALESCE(site_po.requested_qty, 0) = 0 THEN 'PO_BEKLER'
        WHEN COALESCE(m.done_qty, 0) = 0 THEN 'CANCEL'
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
        `,
        [year],
      ),

      pool.query(
        `
        SELECT SUM(COALESCE(payment_amount, 0)) AS this_month_collections
        FROM hw_payment_rows
        WHERE EXTRACT(YEAR FROM payment_date) = $1
          AND EXTRACT(MONTH FROM payment_date) = $2
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
app.get("/dashboard/result", async (req, res) => {
  try {
    const result = await pool.query(buildMasterJoinedQuery());

    const rows = (result.rows || []).map((row) => ({
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

/* ================== MANUAL INVOICE EXCEL IMPORT ================== */
app.post(
  "/finance/invoice-entry/import-excel",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: "Dosya yok" });
      }

      const workbook = XLSX.readFile(req.file.path, { cellDates: true });
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

      for (const r of rows) {
        const bolge = getCell(r, ["Bölge", "Bolge"]);
        const proje = getCell(r, ["Proje"]);
        const projeKodu = getCell(r, ["Proje Kodu", "Project Code"]);
        const faturaNo = getCell(r, ["Fatura No"]);
        const faturaTarihi = getCell(r, ["Fatura Tarihi"]);
        const tedarikci = getCell(r, ["Tedarikçi", "Tedarikci"]);
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
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
          )
          `,
          [
            bolge ? String(bolge).trim() : null,
            proje ? String(proje).trim() : null,
            projeKodu ? String(projeKodu).trim() : null,
            faturaNo ? String(faturaNo).trim() : null,
            parseExcelDateFlexible(faturaTarihi),
            tedarikci ? String(tedarikci).trim() : null,
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
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
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

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("AVANS TALEP RAPORU");

    // Sütunlar
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
      { header: "Site ID", key: "site_id", width: 16 },
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

    // Başlık satırı
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

    // Header satırı
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

    // Veri satırları
    result.rows.forEach((row) => {
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

    // Filtre
    worksheet.autoFilter = {
      from: "A2",
      to: `${lastColumnLetter}2`,
    };

    // Freeze
    worksheet.views = [
      {
        state: "frozen",
        xSplit: 0,
        ySplit: 2,
        showGridLines: false,
      },
    ];

    // Genel stil
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber < 3) return; // header skip

      row.eachCell((cell) => {
        // BORDER
        cell.border = {
          top: { style: "thin", color: { argb: "E5E7EB" } },
          left: { style: "thin", color: { argb: "E5E7EB" } },
          bottom: { style: "thin", color: { argb: "E5E7EB" } },
          right: { style: "thin", color: { argb: "E5E7EB" } },
        };

        // ALIGNMENT
        cell.alignment = {
          vertical: "middle",
          horizontal: "left",
        };

        // 🎨 ZEBRA BACKGROUND (BURASI OLAY)
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb: rowNumber % 2 === 0 ? "F3F4F6" : "FFFFFF", // gri / beyaz
          },
        };
      });

      // 🔥 STATUS RENKLERİ (senin ekrandaki gibi)
      const statusCell = row.getCell(16);
      const status = String(statusCell.value || "").toUpperCase();

      if (status === "ÖDENDİ") {
        statusCell.font = { bold: true, color: { argb: "C55A11" } }; // turuncu
      } else if (status === "REDDEDİLDİ") {
        statusCell.font = { bold: true, color: { argb: "C00000" } }; // kırmızı
      } else if (status === "KISMİ") {
        statusCell.font = { bold: true, color: { argb: "9E480E" } };
      }
    });

    // Para kolonları format
    [11, 12, 13, 14, 15].forEach((colIndex) => {
      worksheet.getColumn(colIndex).numFmt = "#,##0";
    });

    // Tarih kolonları
    [2, 19].forEach((colIndex) => {
      worksheet.getColumn(colIndex).numFmt = "dd.mm.yyyy hh:mm:ss";
    });

    // Satır yükseklikleri
    for (let i = 3; i <= worksheet.rowCount; i++) {
      worksheet.getRow(i).height = 20;
    }

    const fileName = `invoice_database_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

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
app.post("/import/completed-works", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Dosya yok" });
    }

    const workbook = XLSX.readFile(req.file.path);
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

    let inserted = 0;

    for (const r of rows) {
      const terms = getCell(r, [
        "Terms",
        "Payment Terms",
        "Ödeme Şartı",
        "Term",
      ]);
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

      const normalizedSiteCode = siteCode
        ? String(siteCode).trim().toUpperCase()
        : "";
      const normalizedItemCode = itemCode ? String(itemCode).trim() : "";

      if (!normalizedSiteCode || !normalizedItemCode) continue;
      const duplicateCheck = await pool.query(
        `
        SELECT id
        FROM master_works
        WHERE project_code = $1
           AND site_code = $2
           AND item_code = $3
        LIMIT 1
        `,
        [projectCode, normalizedSiteCode, normalizedItemCode],
      );

      if (duplicateCheck.rows.length > 0) {
        continue; // varsa bu satırı atla
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
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
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
        ],
      );

      inserted++;
    }

    res.json({
      ok: true,
      inserted,
      sheet_name: firstSheetName,
      message: "Geçmiş işler başarıyla yüklendi",
    });
  } catch (err) {
    console.error("IMPORT COMPLETED WORKS ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================== HW PO UPLOAD ================== */
app.post("/hw-po/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Dosya yok" });
    }

    const workbook = XLSX.readFile(req.file.path);
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
      const poNo = getCell(r, ["PO No", "PO", "Purchase Order", "PO Number"]);

      if (!projectCode && !siteCode && !itemCode && !itemDescription) continue;

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
          normalizeCurrency(currency),
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

    const workbook = XLSX.readFile(req.file.path);

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

      const workbook = XLSX.readFile(req.file.path);
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
    const result = await pool.query(`
      SELECT
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
      FROM master_works
      ORDER BY id DESC
    `);

    const rows = result.rows || [];

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Tum_Isler");

    sheet.columns = [
      { header: "Saha Türü", key: "site_type", width: 14 },
      { header: "Project Code", key: "project_code", width: 16 },
      { header: "Site Code", key: "site_code", width: 22 },
      { header: "Item Code", key: "item_code", width: 16 },
      { header: "Item Description", key: "item_description", width: 45 },
      { header: "Done Qty", key: "done_qty", width: 12 },
      { header: "Subcon Name", key: "subcon_name", width: 18 },
      { header: "OnAir Date", key: "onair_date", width: 14 },
      { header: "QC Durum", key: "qc_durum", width: 12 },
      { header: "Kabul Durum", key: "kabul_durum", width: 14 },
      { header: "Kabul Not", key: "kabul_not", width: 35 },
      { header: "RF Not", key: "note", width: 35 },
    ];

    rows.forEach((row) => {
      sheet.addRow({
        site_type: row.site_type || "",
        project_code: row.project_code || "",
        site_code: row.site_code || "",
        item_code: row.item_code || "",
        item_description: row.item_description || "",
        done_qty: row.done_qty ?? "",
        subcon_name: row.subcon_name || "",
        onair_date: row.onair_date
          ? new Date(row.onair_date).toLocaleDateString("tr-TR")
          : "",
        qc_durum: row.qc_durum || "",
        kabul_durum: row.kabul_durum || "",
        kabul_not: row.kabul_not || "",
        note: row.note || "",
      });
    });

    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
      from: "A1",
      to: "L1",
    };

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=site_entries_all_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("EXPORT ALL SITE ENTRIES ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/master/add", async (req, res) => {
  try {
    const m = req.body;

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
        String(m.project_code || "").trim(),
        String(m.site_code || "")
          .trim()
          .toUpperCase(),
        String(m.item_code || "").trim(),
      ],
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "Bu item talep listesinde mevcut",
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
        m.site_type,
        m.project_code,
        m.site_code ? String(m.site_code).trim().toUpperCase() : null,
        m.item_code,
        m.item_description,
        Number(m.done_qty || 0),
        m.subcon_name,
        m.onair_date || null,
        m.note || null,
        m.qc_durum || "NOK",
        m.kabul_durum || "NOK",
        m.kabul_not || null,
      ],
    );

    res.json({ ok: true, data: result.rows[0] });
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
        fatura_kalemi = $7,
        is_kalemi = $8,
        po_no = $9,
        site_id = $10,
        tutar = $11,
        kdv = $12,
        toplam_tutar = $13,
        odenen_tutar = $14,
        kalan_borc = $15,
        note = $16
      WHERE id = $17
      RETURNING *
      `,
      [
        bolge || null,
        proje || null,
        proje_kodu || null,
        fatura_no || null,
        fatura_tarihi || null,
        tedarikci || null,
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
        note = $9
      WHERE id = $10
      RETURNING *
      `,
      [
        m.site_type,
        m.project_code,
        m.site_code ? String(m.site_code).trim().toUpperCase() : null,
        m.item_code,
        m.item_description,
        Number(m.done_qty || 0),
        m.subcon_name,
        m.onair_date || null,
        m.note,
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

/* ================== PO DASHBOARD SUMMARY ================== */
app.get("/dashboard/summary", async (req, res) => {
  try {
    const result = await fetchData();
    res.json({ ok: true, summary: result });
  } catch (err) {
    console.error("SUMMARY ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

async function fetchData() {
  const result = await pool.query(buildMasterJoinedQuery("", ""));

  let totalTry = 0;
  let totalUsd = 0;
  let okTry = 0;
  let okUsd = 0;
  let beklerTry = 0;
  let beklerUsd = 0;

  let ok = 0;
  let partial = 0;
  let cancel = 0;
  let bekler = 0;

  (result.rows || []).forEach((row) => {
    const done = Number(row.done_qty || 0);
    const req = Number(row.requested_qty || 0);
    const price = Number(row.unit_price || 0);
    const currency = normalizeCurrency(row.currency);
    const amount = done * price;

    if (currency === "USD") totalUsd += amount;
    else totalTry += amount;

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

  return {
    total_done_amount_try: totalTry,
    total_done_amount_usd: totalUsd,
    total_ok_amount_try: okTry,
    total_ok_amount_usd: okUsd,
    total_po_bekler_amount_try: beklerTry,
    total_po_bekler_amount_usd: beklerUsd,
    ok_count: ok,
    partial_count: partial,
    cancel_count: cancel,
    po_bekler_count: bekler,
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
      let region = "Tanımsız";
      const code = String(row.site_code || "")
        .toUpperCase()
        .trim();

      if (
        code.startsWith("IZ") ||
        code.startsWith("MU") ||
        code.startsWith("US") ||
        code.startsWith("MN") ||
        code.startsWith("DE") ||
        code.startsWith("AI")
      ) {
        region = "İzmir";
      } else if (
        code.startsWith("AT") ||
        code.startsWith("IP") ||
        code.startsWith("AF") ||
        code.startsWith("BU")
      ) {
        region = "Antalya";
      } else if (
        code.startsWith("ES") ||
        code.startsWith("BO") ||
        code.startsWith("ZO") ||
        code.startsWith("KA") ||
        code.startsWith("Z")
      ) {
        region = "Ankara";
      }

      worksheet.addRow({
        region,
        project_code: row.project_code || "",
        site_code: row.site_code || "",
        item_code: row.item_code || "",
        item_description: row.item_description || "",
        done_qty: Number(row.done_qty || 0),
        requested_qty: Number(row.requested_qty || 0),
        onair_date: row.onair_date || "",
        subcon_name: row.subcon_name || "",
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

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = {
      vertical: "middle",
      horizontal: "center",
    };

    const safeStatus = status || "ALL";
    const fileName = `dashboard_${safeStatus}_${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("EXPORT STATUS EXCEL ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
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

      const workbook = XLSX.readFile(req.file.path);
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
        COALESCE(remaining_amount, 0) AS remaining_amount,
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

      const workbook = XLSX.readFile(req.file.path);
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

    res.json({
      ok: true,
      rows: upcomingData.rows,
      overdue_rows: overdueData.rows,
      summary: {
        ...upcomingData.summary,
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

app.get("/finance/debug-tables", async (req, res) => {
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
        COALESCE(invoice_amount, 0) - COALESCE(paid_amount, 0) AS remaining_amount,
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
        COALESCE(remaining_amount, 0) AS remaining_amount,
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

app.listen(PORT, () => {
  console.log(`Server çalışıyor: ${PORT}`);
});

/* ================== START ================== */
