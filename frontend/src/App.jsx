import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import "./App.css";
import * as XLSX from "xlsx";
import "react-datepicker/dist/react-datepicker.css";
import DatePicker from "react-datepicker";

function Row({ label, value, isPercent, isNegativeHighlight, isPlainNumber }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "10px 16px",
        borderBottom: "1px solid #e5e7eb",
        background: "#fff",
      }}
    >
      <div style={{ color: "#374151" }}>{label}</div>

      <div
        style={{
          fontWeight: "600",
          color: isNegativeHighlight ? "#dc2626" : "#111827",
        }}
      >
        {isPercent
          ? `%${Number(value || 0).toFixed(1)}`
          : isPlainNumber
            ? formatNumber(value || 0)
            : formatMoneyByCurrency(value || 0, "TRY")}
      </div>
    </div>
  );
}

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";

function normalizeCurrency(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase();
  if (raw === "USD" || raw === "$" || raw.includes("USD")) return "USD";
  return "TRY";
}

function findPaymentInfoByInvoiceNo(paymentMap, invoiceNo, currency) {
  const cleanInvoiceNo = String(invoiceNo || "").trim();
  const cleanCurrency = String(currency || "")
    .trim()
    .toUpperCase();

  if (!cleanInvoiceNo) return null;

  // birebir eşleşme
  if (paymentMap.has(cleanInvoiceNo)) {
    return paymentMap.get(cleanInvoiceNo);
  }

  // USD ise -cur'lı halini de kontrol et
  if (cleanCurrency === "USD") {
    const curVersion = `${cleanInvoiceNo}-cur`;
    if (paymentMap.has(curVersion)) {
      return paymentMap.get(curVersion);
    }
  }

  // invoice_no zaten -cur ile geldiyse normal halini de kontrol et
  if (cleanInvoiceNo.toLowerCase().endsWith("-cur")) {
    const normalVersion = cleanInvoiceNo.replace(/-cur$/i, "");
    if (paymentMap.has(normalVersion)) {
      return paymentMap.get(normalVersion);
    }
  }

  return null;
}

function formatMoneyByCurrency(value, currency = "TRY") {
  const safeCurrency = normalizeCurrency(currency);

  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: safeCurrency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatDateOnly(value) {
  if (!value) return "";

  const str = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [year, month, day] = str.split("-");
    return `${day}.${month}.${year}`;
  }

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    const day = String(parsed.getDate()).padStart(2, "0");
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const year = parsed.getFullYear();
    return `${day}.${month}.${year}`;
  }

  return str;
}
//Silinecek//Fatura bilgi yükle//
function InvoiceEntryExcelUploadInline({ onClose, onUploaded }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const handleUpload = async () => {
    if (!file) {
      setMessage("❌ Lütfen bir Excel dosyası seç");
      return;
    }

    try {
      setUploading(true);
      setMessage("");

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(
        `${API_BASE}/finance/invoice-entry/import-excel`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("finance_token") || ""}`,
          },
          body: formData,
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        throw new Error(
          data.error || "Fatura Excel import sırasında hata oluştu",
        );
      }

      setMessage(
        `✅ Excel başarıyla içeri alındı. Eklenen kayıt: ${data.inserted || 0}`,
      );
      setFile(null);

      const input = document.getElementById("invoice-entry-excel-upload-input");
      if (input) input.value = "";

      if (onUploaded) {
        await onUploaded();
      }
    } catch (err) {
      console.error("INVOICE ENTRY EXCEL IMPORT ERROR:", err);
      setMessage(`❌ ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="entryPanel" style={{ marginBottom: "18px" }}>
      <div className="entryForm">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "14px",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <h3 className="listTitle" style={{ margin: 0 }}>
            📥 Fatura Excel İçe Aktar
          </h3>

          <button
            type="button"
            className="tab"
            onClick={onClose}
            style={{ padding: "10px 14px" }}
          >
            Kapat
          </button>
        </div>

        <div className="formGrid">
          <div className="formGroup formGroupWide">
            <label>Fatura Takip Excel Dosyası</label>
            <input
              id="invoice-entry-excel-upload-input"
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>

        <div className="entryActions">
          <button
            type="button"
            className="saveButton"
            onClick={handleUpload}
            disabled={uploading}
          >
            {uploading ? "Yükleniyor..." : "Exceli İçeri Al"}
          </button>
        </div>

        {message && <div className="entryMessage">{message}</div>}
      </div>
    </div>
  );
}

async function fetchJson(url, options = {}) {
  const { withAuth = false, ...fetchOptions } = options;

  const token = localStorage.getItem("finance_token") || "";

  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      ...(fetchOptions.headers || {}),
      ...(withAuth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (response.status === 401) {
    localStorage.removeItem("finance_token");
    localStorage.removeItem("finance_user_email");
    window.location.reload();
    throw new Error("Oturum süresi dolmuş");
  }

  const text = await response.text();
  console.log("RAW RESPONSE:", url, text);

  let data = {};
  try {
    data = JSON.parse(text);
  } catch {}

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || text || "İşlem sırasında hata oluştu");
  }

  return data;
}

function StatusBadge({ status }) {
  const safeStatus = String(status || "").toUpperCase();

  return (
    <span className={`statusBadge status-${safeStatus.toLowerCase()}`}>
      {safeStatus || "-"}
    </span>
  );
}

function EmptyRow({ colSpan, text = "Kayıt bulunamadı" }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ textAlign: "center", padding: "16px" }}>
        {text}
      </td>
    </tr>
  );
}

function getQtyAnalysis(doneQty, requestedQty) {
  const done = Number(doneQty || 0);
  const requested = Number(requestedQty || 0);

  if (requested === 0 && done > 0) {
    return {
      diff: "-",
      label: "PO Bekliyor",
      className: "analysis-waiting",
    };
  }

  const diff = done - requested;

  if (diff === 0) {
    return {
      diff: 0,
      label: "Tamam",
      className: "analysis-complete",
    };
  }

  if (diff < 0) {
    return {
      diff,
      label: "Eksik",
      className: "analysis-missing",
    };
  }

  return {
    diff,
    label: "Fazla",
    className: "analysis-over",
  };
}

function getRegion(siteCode = "") {
  const code = String(siteCode || "")
    .trim()
    .toUpperCase();

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
    code.startsWith("DE")
  ) {
    return "İzmir";
  }

  if (
    code.startsWith("AT") ||
    code.startsWith("IP") ||
    code.startsWith("BU") ||
    code.startsWith("AF")
  ) {
    return "Antalya";
  }

  return "Tanımsız";
}

function BoQUploadInline({ onClose, onUploaded }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const handleUpload = async () => {
    if (!file) {
      setMessage("❌ Lütfen bir Excel dosyası seç");
      return;
    }

    try {
      setUploading(true);
      setMessage("");

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${API_BASE}/boq/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "BoQ upload sırasında hata oluştu");
      }

      setMessage(
        `✅ BoQ başarıyla yüklendi. Eklenen kayıt: ${data.inserted || 0}`,
      );
      setFile(null);

      const input = document.getElementById("inline-boq-upload-input");
      if (input) input.value = "";

      if (onUploaded) {
        await onUploaded();
      }
    } catch (err) {
      console.error("BOQ UPLOAD ERROR:", err);
      setMessage(`❌ ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="entryPanel" style={{ marginBottom: "18px" }}>
      <div className="entryForm">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "14px",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <h3 className="listTitle" style={{ margin: 0 }}>
            📤 BoQ Upload
          </h3>
          <button
            type="button"
            className="tab"
            onClick={onClose}
            style={{ padding: "10px 14px" }}
          >
            Kapat
          </button>
        </div>

        <div className="formGrid">
          <div className="formGroup formGroupWide">
            <label>BoQ Excel Dosyası</label>
            <input
              id="inline-boq-upload-input"
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>

        <div className="entryActions">
          <button
            type="button"
            className="saveButton"
            onClick={handleUpload}
            disabled={uploading}
          >
            {uploading ? "Yükleniyor..." : "BoQ Yükle"}
          </button>
        </div>

        {message && <div className="entryMessage">{message}</div>}
      </div>
    </div>
  );
}

function CompletedWorksImportInline({ onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const handleUpload = async () => {
    if (!file) {
      setMessage("❌ Lütfen bir Excel dosyası seç");
      return;
    }

    try {
      setUploading(true);
      setMessage("");

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${API_BASE}/import/completed-works`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Geçmiş işler yüklenirken hata oluştu");
      }

      setMessage(
        `✅ Geçmiş işler yüklendi. Eklenen kayıt: ${data.inserted || 0}`,
      );

      setFile(null);

      const input = document.getElementById("completed-works-upload-input");
      if (input) input.value = "";

      if (onImported) {
        await onImported();
      }
    } catch (err) {
      console.error("COMPLETED WORKS IMPORT ERROR:", err);
      setMessage(`❌ ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="entryPanel" style={{ marginBottom: "18px" }}>
      <div className="entryForm">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "14px",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <h3 className="listTitle" style={{ margin: 0 }}>
            📥 Geçmiş İşleri Yükle
          </h3>
          <button
            type="button"
            className="tab"
            onClick={onClose}
            style={{ padding: "10px 14px" }}
          >
            Kapat
          </button>
        </div>

        <div className="formGrid">
          <div className="formGroup formGroupWide">
            <label>Geçmiş Tamamlanan İşler Excel Dosyası</label>
            <input
              id="completed-works-upload-input"
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>

        <div className="entryActions">
          <button
            type="button"
            className="saveButton"
            onClick={handleUpload}
            disabled={uploading}
          >
            {uploading ? "Yükleniyor..." : "Geçmiş İşleri Yükle"}
          </button>
        </div>

        {message && <div className="entryMessage">{message}</div>}
      </div>
    </div>
  );
}

function HWPoUploadInline({ onClose, onUploaded }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const handleUpload = async () => {
    if (!file) {
      setMessage("❌ Lütfen bir Excel dosyası seç");
      return;
    }

    try {
      setUploading(true);
      setMessage("");

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${API_BASE}/hw-po/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "HW PO upload sırasında hata oluştu");
      }

      setMessage(
        `✅ Huawei PO listesi yüklendi. Eklenen kayıt: ${data.inserted || 0}`,
      );

      setFile(null);

      const input = document.getElementById("inline-hwpo-upload-input");
      if (input) input.value = "";

      if (onUploaded) {
        await onUploaded();
      }
    } catch (err) {
      console.error("HW PO UPLOAD ERROR:", err);
      setMessage(`❌ ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="entryPanel" style={{ marginBottom: "18px" }}>
      <div className="entryForm">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "14px",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <h3 className="listTitle" style={{ margin: 0 }}>
            📄 HW_PO Upload
          </h3>
          <button
            type="button"
            className="tab"
            onClick={onClose}
            style={{ padding: "10px 14px" }}
          >
            Kapat
          </button>
        </div>

        <div className="formGrid">
          <div className="formGroup formGroupWide">
            <label>Huawei PO Excel Dosyası</label>
            <input
              id="inline-hwpo-upload-input"
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>

        <div className="entryActions">
          <button
            type="button"
            className="saveButton"
            onClick={handleUpload}
            disabled={uploading}
          >
            {uploading ? "Yükleniyor..." : "HW_PO Yükle"}
          </button>
        </div>

        {message && <div className="entryMessage">{message}</div>}
      </div>
    </div>
  );
}

function formatDateTR(date) {
  if (!date) return "";
  const d = new Date(date);
  return d.toLocaleDateString("tr-TR");
}

function ExecutiveDashboard() {
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const handleExportStatus = async (status) => {
    try {
      const response = await fetch(
        `${API_BASE}/export/status-excel?status=${encodeURIComponent(status)}`,
      );

      if (!response.ok) {
        throw new Error("Excel indirilemedi");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `dashboard_${status}_${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("EXPORT ERROR:", err);
      alert("Excel indirilemedi");
    }
  };

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage("");

      const [summaryData, resultData] = await Promise.all([
        fetchJson(`${API_BASE}/dashboard/summary`),
        fetchJson(`${API_BASE}/dashboard/result`),
      ]);

      setSummary(summaryData || null);
      setRows(resultData.rows || []);
    } catch (err) {
      console.error("DASHBOARD LOAD ERROR:", err);
      setSummary(null);
      setRows([]);
      setErrorMessage(err.message || "Veri alınamadı");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const filteredRows = useMemo(() => {
    const lowerSearch = search.toLowerCase().trim();

    return rows.filter((row) => {
      const statusOk =
        statusFilter === "ALL" ? true : String(row.status) === statusFilter;

      const text =
        `${row.project_code || ""} ${row.site_code || ""} ${row.item_code || ""} ${
          row.item_description || ""
        } ${row.subcon_name || ""}`.toLowerCase();

      const searchOk = lowerSearch ? text.includes(lowerSearch) : true;
      return statusOk && searchOk;
    });
  }, [rows, statusFilter, search]);

  if (loading) return <div className="loading">Yükleniyor...</div>;

  if (!summary) {
    return (
      <div className="loading">
        {errorMessage ? `Veri alınamadı: ${errorMessage}` : "Veri alınamadı."}
      </div>
    );
  }

  return (
    <>
      <h1>📊 PO Dashboard</h1>

      {summary && (
        <div
          style={{
            padding: "20px",
            background: "#111",
            color: "#fff",
            borderRadius: "8px",
          }}
        >
          <h2>📊 Finance Summary</h2>

          <p>Total Collections: {summary.total_collections || 0}</p>
          <p>This Month: {summary.this_month_collections || 0}</p>
          <p>Expense Count: {summary.expense_count || 0}</p>
        </div>
      )}

      <div className="cards">
        <div
          className="card ok"
          onClick={() => handleExportStatus("OK")}
          style={{ cursor: "pointer" }}
          title="OK kayıtlarını Excel indir"
        >
          OK: {summary.ok_count || 0}
        </div>

        <div
          className="card bekler"
          onClick={() => handleExportStatus("PO_BEKLER")}
          style={{ cursor: "pointer" }}
          title="PO Bekler kayıtlarını Excel indir"
        >
          PO Bekler: {summary.po_bekler_count || 0}
        </div>

        <div
          className="card cancel"
          onClick={() => handleExportStatus("CANCEL")}
          style={{ cursor: "pointer" }}
          title="Cancel kayıtlarını Excel indir"
        >
          Cancel: {summary.cancel_count || 0}
        </div>

        <div
          className="card partial"
          onClick={() => handleExportStatus("PARTIAL")}
          style={{ cursor: "pointer" }}
          title="Partial kayıtlarını Excel indir"
        >
          Partial: {summary.partial_count || 0}
        </div>
      </div>

      <div className="financeTopGrid"></div>

      <div className="toolbar">
        <input
          className="search"
          placeholder="Proje, site, item, açıklama, taşeron ara"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <button
          type="button"
          className="tab"
          onClick={() => handleExportStatus("ALL")}
        >
          Tümünü Excel İndir
        </button>

        <select
          className="select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="ALL">Tümü</option>
          <option value="OK">OK</option>
          <option value="PO_BEKLER">PO Bekler</option>
          <option value="CANCEL">Cancel</option>
          <option value="PARTIAL">Partial</option>
        </select>
      </div>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Project Code</th>
              <th>Site Code</th>
              <th>Item Code</th>
              <th>Item Description</th>
              <th>Done Qty</th>
              <th>Requested Qty</th>
              <th>Billed Qty</th>
              <th>Due Qty</th>
              <th>Currency</th>
              <th>Unit Price</th>
              <th>Total Done Amount</th>
              <th>Subcon</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <EmptyRow colSpan={13} />
            ) : (
              filteredRows.map((row, index) => (
                <tr
                  key={
                    row.id ??
                    `${row.project_code}-${row.site_code}-${row.item_code}-${index}`
                  }
                >
                  <td>
                    <StatusBadge status={row.status} />
                  </td>
                  <td>{row.project_code || "-"}</td>
                  <td>{row.site_code || "-"}</td>
                  <td>{row.item_code || "-"}</td>
                  <td title={row.item_description}>
                    <div className="desc-cell">{row.item_description}</div>
                  </td>
                  <td>{row.done_qty ?? "-"}</td>
                  <td>{row.requested_qty ?? "-"}</td>
                  <td>{row.billed_qty ?? "-"}</td>
                  <td>{row.due_qty ?? "-"}</td>
                  <td>{row.currency || "-"}</td>
                  <td>
                    {Number(row.unit_price || 0) === 0
                      ? "-"
                      : formatMoneyByCurrency(row.unit_price, row.currency)}
                  </td>
                  <td>
                    {Number(row.total_done_amount || 0) === 0
                      ? "-"
                      : formatMoneyByCurrency(
                          row.total_done_amount,
                          row.currency,
                        )}
                  </td>
                  <td>{row.subcon_name || "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function parseTRDateToDate(value) {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;

  const [day, month, year] = parts.map(Number);
  if (!day || !month || !year) return null;

  const d = new Date(year, month - 1, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }

  return d;
}

function formatDateToTR(date) {
  if (!date) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

function useUsdRate() {
  const [usdRate, setUsdRate] = useState(45);

  useEffect(() => {
    const fetchRate = async () => {
      try {
        const res = await fetch("https://open.er-api.com/v6/latest/USD");
        const data = await res.json();

        if (data?.rates?.TRY) {
          setUsdRate(data.rates.TRY);
        }
      } catch (err) {
        console.error("USD RATE ERROR:", err);
      }
    };

    fetchRate();
  }, []);

  return usdRate;
}

function DailyEntry() {
  const usdRate = useUsdRate();
  function getTodayTR() {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}.${month}.${year}`;
  }

  function detectSiteTypeFromSiteCode(siteCode) {
    const code = String(siteCode || "").toUpperCase();

    if (code.includes("NR3500") || code.includes("5GEXP")) {
      return "5G";
    }

    if (code.includes("NS")) {
      return "STANDALONE";
    }

    if (
      code.includes("L800") ||
      code.includes("L2600") ||
      code.includes("L2100") ||
      code.includes("NR700") ||
      code.includes("TRP") ||
      code.includes("L")
    ) {
      return "LTE";
    }

    return "5G";
  }

  const initialForm = {
    site_type: "5G",
    project_code: "",
    site_code: "",
    item_code: "",
    item_description: "",
    done_qty: "",
    subcon_name: "",
    onair_date: getTodayTR(),
    note: "",

    qc_durum: "NOK",
    kabul_durum: "NOK",
    kabul_not: "",
  };

  const [showEntryModal, setShowEntryModal] = useState(false);
  const [siteSearchCode, setSiteSearchCode] = useState("");

  const [showQcUpload, setShowQcUpload] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [rows, setRows] = useState([]);
  const [siteEntries, setSiteEntries] = useState([]);

  const [projectCodes, setProjectCodes] = useState([]);
  const [itemOptions, setItemOptions] = useState([]);
  const [poRows, setPoRows] = useState([]);

  const normalizeCurrency = (value) => {
    const raw = String(value || "")
      .trim()
      .toUpperCase();

    if (raw === "USD" || raw === "$" || raw === "US$" || raw.includes("USD")) {
      return "USD";
    }

    return "TRY";
  };

  const convertToTRY = (amount, currency) => {
    const num = Number(amount || 0);
    return normalizeCurrency(currency) === "USD" ? num * usdRate : num;
  };
  const uniquePoItemCodes = [
    ...new Set(
      poRows.map((row) => String(row.item_code || "").trim()).filter(Boolean),
    ),
  ];

  const poSummary = poRows.reduce(
    (acc, row) => {
      const qty = Number(row.requested_qty || 0);
      const price = convertToTRY(row.unit_price, row.currency);

      acc.totalAmount += qty * price;
      return acc;
    },
    { totalAmount: 0 },
  );

  poSummary.totalQty = uniquePoItemCodes.length;

  const uniqueEntryItemCodes = [
    ...new Set(
      siteEntries
        .map((row) => String(row.item_code || "").trim())
        .filter(Boolean),
    ),
  ];

  const entrySummary = siteEntries.reduce(
    (acc, row) => {
      const qty = Number(row.done_qty || 0);
      const price = convertToTRY(row.unit_price, row.currency);

      acc.totalAmount += qty * price;
      return acc;
    },
    { totalAmount: 0 },
  );

  entrySummary.totalQty = uniqueEntryItemCodes.length;

  const farkQty = poSummary.totalQty - entrySummary.totalQty;
  const farkTutar = poSummary.totalAmount - entrySummary.totalAmount;
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showBoqUpload, setShowBoqUpload] = useState(false);
  const [showHwPoUpload, setShowHwPoUpload] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [showCompletedImport, setShowCompletedImport] = useState(false);
  const [itemCodeSearch, setItemCodeSearch] = useState("");
  const [itemDescriptionSearch, setItemDescriptionSearch] = useState("");
  const [showItemCodeList, setShowItemCodeList] = useState(false);
  const [showItemDescriptionList, setShowItemDescriptionList] = useState(false);
  const itemCodeBoxRef = useRef(null);
  const itemDescriptionBoxRef = useRef(null);

  const loadRows = async () => {
    try {
      const data = await fetchJson(`${API_BASE}/master/list-detailed`);
      setRows(data.rows || []);
    } catch (err) {
      console.error("MASTER LIST DETAILED ERROR:", err);
      setRows([]);
    }
  };

  const loadProjectCodes = async () => {
    try {
      const data = await fetchJson(`${API_BASE}/lookup/project-codes`);
      setProjectCodes(data.rows || []);
    } catch (err) {
      console.error("LOOKUP PROJECT CODES ERROR:", err);
      setProjectCodes([]);
    }
  };

  const handleExportExcel = async () => {
    try {
      const params = new URLSearchParams({
        project_code: form.project_code || "",
        site_code: form.site_code || "",
      });

      const response = await fetch(
        `${API_BASE}/export/site-entry-excel?${params.toString()}`,
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("EXPORT ERROR STATUS:", response.status);
        console.error("EXPORT ERROR BODY:", errorText);
        alert(`Excel indirilemedi: ${response.status}`);
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `site_entries_${form.site_code || "all"}_${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("SITE ENTRY EXCEL ERROR:", err);
      alert(`Excel indirilemedi: ${err.message}`);
    }
  };

  const loadItems = async () => {
    try {
      const data = await fetchJson(`${API_BASE}/lookup/items`);

      const cleaned = (data.rows || []).filter(
        (x) => x.item_code && x.item_description,
      );

      const uniqueMap = new Map();

      cleaned.forEach((item) => {
        const key = `${String(item.item_code).trim()}___${String(
          item.item_description,
        ).trim()}`;

        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, {
            item_code: String(item.item_code).trim(),
            item_description: String(item.item_description).trim(),
            currency: item.currency || null,
            unit_price: item.unit_price || null,
          });
        }
      });

      setItemOptions(Array.from(uniqueMap.values()));
    } catch (err) {
      console.error("LOOKUP ITEMS ERROR:", err);
      setItemOptions([]);
    }
  };

  const loadSitePoRows = async (projectCode, siteCode) => {
    if (!siteCode) {
      setPoRows([]);
      return;
    }

    try {
      const params = new URLSearchParams({
        project_code: projectCode || "",
        site_code: siteCode || "",
      });

      const data = await fetchJson(
        `${API_BASE}/lookup/site-pos?${params.toString()}`,
      );

      setPoRows(data.rows || []);
    } catch (err) {
      console.error("LOOKUP SITE POS ERROR:", err);
      setPoRows([]);
    }
  };

  const loadSiteEntries = async (projectCode, siteCode) => {
    if (!siteCode) {
      setSiteEntries([]);
      return;
    }

    try {
      const params = new URLSearchParams({
        project_code: projectCode || "",
        site_code: siteCode || "",
      });

      const data = await fetchJson(
        `${API_BASE}/master/by-site?${params.toString()}`,
      );

      setSiteEntries(data.rows || []);
    } catch (err) {
      console.error("MASTER BY SITE ERROR:", err);
      setSiteEntries([]);
    }
  };

  const refreshAll = async () => {
    await Promise.all([
      loadRows(),
      loadProjectCodes(),
      loadItems(),
      loadSiteEntries(form.project_code, form.site_code),
      loadSitePoRows(form.project_code, form.site_code),
    ]);
  };

  const handleExportAllEntriesExcel = async () => {
    try {
      const response = await fetch(`${API_BASE}/export/site-entry-excel-all`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("EXPORT ALL ERROR:", errorText);
        alert("Tüm işler Excel indirilemedi");
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `site_entries_all_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("EXPORT ALL SITE ENTRIES ERROR:", err);
      alert("Tüm işler Excel indirilemedi");
    }
  };

  useEffect(() => {
    loadRows();
    loadProjectCodes();
    loadItems();
  }, []);

  useEffect(() => {
    loadSitePoRows(form.project_code, form.site_code);
    loadSiteEntries(form.project_code, form.site_code);
  }, [form.project_code, form.site_code]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        itemCodeBoxRef.current &&
        !itemCodeBoxRef.current.contains(e.target)
      ) {
        setShowItemCodeList(false);
      }

      if (
        itemDescriptionBoxRef.current &&
        !itemDescriptionBoxRef.current.contains(e.target)
      ) {
        setShowItemDescriptionList(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;

    if (name === "project_code") {
      setItemCodeSearch("");
      setItemDescriptionSearch("");

      setForm((prev) => ({
        ...prev,
        project_code: value,
        item_code: "",
        item_description: "",
      }));
      return;
    }

    if (name === "item_code") {
      const selected = itemOptions.find(
        (x) => String(x.item_code).trim() === String(value).trim(),
      );

      setForm((prev) => ({
        ...prev,
        item_code: value,
        item_description: selected?.item_description || "",
      }));

      setItemCodeSearch(value);
      setItemDescriptionSearch(selected?.item_description || "");
      return;
    }

    if (name === "site_code") {
      const upperValue = value.trim().toUpperCase();

      setForm((prev) => ({
        ...prev,
        site_code: upperValue,
        site_type: detectSiteTypeFromSiteCode(upperValue),
      }));
      return;
    }

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleDescriptionChange = (e) => {
    const selectedDesc = e.target.value;

    const selected = itemOptions.find(
      (x) => String(x.item_description).trim() === String(selectedDesc).trim(),
    );

    setItemDescriptionSearch(selectedDesc);
    setItemCodeSearch(selected?.item_code || "");

    setForm((prev) => ({
      ...prev,
      item_description: selectedDesc,
      item_code: selected?.item_code || "",
    }));
  };

  const handleSiteSearchChange = (e) => {
    const value = e.target.value.trim().toUpperCase();
    setSiteSearchCode(value);

    setForm((prev) => ({
      ...prev,
      site_code: value,
      site_type: detectSiteTypeFromSiteCode(value),
    }));
  };

  const filteredItemCodes = useMemo(() => {
    const q = itemCodeSearch.toLowerCase().trim();

    const list = !q
      ? itemOptions
      : itemOptions.filter((item) =>
          String(item.item_code || "")
            .toLowerCase()
            .includes(q),
        );

    return list.slice(0, 30);
  }, [itemOptions, itemCodeSearch]);

  const filteredItemDescriptions = useMemo(() => {
    const q = itemDescriptionSearch.toLowerCase().trim();

    const list = !q
      ? itemOptions
      : itemOptions.filter((item) =>
          String(item.item_description || "")
            .toLowerCase()
            .includes(q),
        );

    return list.slice(0, 30);
  }, [itemOptions, itemDescriptionSearch]);

  const handleOpenEntryModal = () => {
    if (!siteSearchCode) {
      alert("Önce Site Code gir");
      return;
    }

    setForm((prev) => ({
      ...prev,
      site_code: siteSearchCode,
    }));

    setShowEntryModal(true);
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setMessage("");

    setForm({
      site_type: detectSiteTypeFromSiteCode(row.site_code),
      project_code: row.project_code || "",
      site_code: row.site_code || "",
      item_code: row.item_code || "",
      item_description: row.item_description || "",
      done_qty: row.done_qty ?? "",
      subcon_name: row.subcon_name || "",
      onair_date: row.onair_date ? String(row.onair_date).slice(0, 10) : "",
      note: row.note || "",
      qc_durum: row.qc_durum || "NOK",
      kabul_durum: row.kabul_durum || "NOK",
      kabul_not: row.kabul_not || "",
    });

    setItemCodeSearch(row.item_code || "");
    setItemDescriptionSearch(row.item_description || "");
    setShowEntryModal(true);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setMessage("");
    setItemCodeSearch("");
    setItemDescriptionSearch("");
    setForm(initialForm);
    setShowItemCodeList(false);
    setShowItemDescriptionList(false);
    setShowEntryModal(false);
  };

  const handleDelete = async (row) => {
    const ok = window.confirm(
      `${row.site_code} / ${row.item_code} kaydını silmek istediğine emin misin?`,
    );

    if (!ok) return;

    try {
      await fetchJson(`${API_BASE}/master/${row.id}`, {
        method: "DELETE",
      });

      setMessage("✅ Kayıt silindi");

      if (editingId === row.id) {
        setEditingId(null);
        setForm(initialForm);
      }

      await Promise.all([
        loadRows(),
        loadSiteEntries(form.project_code, form.site_code),
        loadSitePoRows(form.project_code, form.site_code),
      ]);
    } catch (err) {
      console.error("MASTER DELETE ERROR:", err);
      setMessage(`❌ ${err.message}`);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    setShowItemCodeList(false);
    setShowItemDescriptionList(false);

    try {
      const payload = {
        site_type: detectSiteTypeFromSiteCode(form.site_code),
        project_code: form.project_code,
        site_code: form.site_code,
        item_code: form.item_code,
        item_description: form.item_description,
        done_qty: Number(form.done_qty || 0),
        subcon_name: form.subcon_name,
        onair_date: form.onair_date || null,
        note: form.note,
        qc_durum: form.qc_durum,
        kabul_durum: form.kabul_durum,
        kabul_not: form.kabul_not,
      };

      if (editingId) {
        await fetchJson(`${API_BASE}/master/${editingId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        setMessage("✅ Kayıt başarıyla güncellendi");
      } else {
        await fetchJson(`${API_BASE}/master/add`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        setMessage("✅ Kayıt başarıyla eklendi");
      }

      const currentProject = form.project_code;
      const currentSite = form.site_code;
      const currentSubcon = form.subcon_name;
      const currentOnAirDate = form.onair_date;

      setItemCodeSearch("");
      setItemDescriptionSearch("");

      setForm({
        ...initialForm,
        site_type: "5G",
        project_code: currentProject,
        site_code: currentSite,
        subcon_name: currentSubcon,
        onair_date: currentOnAirDate,
      });

      setEditingId(null);

      setShowEntryModal(false);

      await Promise.all([
        loadRows(),
        loadSiteEntries(currentProject, currentSite),
        loadSitePoRows(currentProject, currentSite),
      ]);
    } catch (err) {
      console.error("MASTER SAVE ERROR:", err);
      setMessage(`❌ ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleItemCodePick = (item) => {
    setForm((prev) => ({
      ...prev,
      item_code: item.item_code || "",
      item_description: item.item_description || "",
    }));

    setItemCodeSearch(item.item_code || "");
    setItemDescriptionSearch(item.item_description || "");
    setShowItemCodeList(false);
  };

  const handleItemDescriptionPick = (item) => {
    setForm((prev) => ({
      ...prev,
      item_code: item.item_code || "",
      item_description: item.item_description || "",
    }));

    setItemCodeSearch(item.item_code || "");
    setItemDescriptionSearch(item.item_description || "");
    setShowItemDescriptionList(false);
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
          marginBottom: "8px",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "28px", lineHeight: 1.1 }}>
          📋 Günlük İş Girişi
        </h1>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            type="button"
            className={showQcUpload ? "tab activeTab" : "tab"}
            onClick={() => {
              setShowQcUpload((prev) => !prev);
              setShowBoqUpload(false);
              setShowHwPoUpload(false);
              setShowCompletedImport(false);
            }}
          >
            QC Yükle
          </button>

          <button
            type="button"
            className={showBoqUpload ? "tab activeTab" : "tab"}
            onClick={() => {
              setShowBoqUpload((prev) => !prev);
              setShowQcUpload(false);
              setShowHwPoUpload(false);
              setShowCompletedImport(false);
            }}
          >
            BoQ Yükle
          </button>

          <button
            type="button"
            className={showHwPoUpload ? "tab activeTab" : "tab"}
            onClick={() => {
              setShowHwPoUpload((prev) => !prev);
              setShowBoqUpload(false);
              setShowQcUpload(false);
              setShowCompletedImport(false);
            }}
          >
            HW PO Yükle
          </button>

          <button
            type="button"
            className={showCompletedImport ? "tab activeTab" : "tab"}
            onClick={() => {
              setShowCompletedImport((prev) => !prev);
              setShowBoqUpload(false);
              setShowQcUpload(false);
              setShowHwPoUpload(false);
            }}
          >
            Tamamlanan Import
          </button>

          <button
            type="button"
            className="tab"
            onClick={handleExportAllEntriesExcel}
          >
            Tüm İşleri Excel İndir
          </button>
        </div>
      </div>

      {showBoqUpload && (
        <BoQUploadInline
          onClose={() => setShowBoqUpload(false)}
          onUploaded={refreshAll}
        />
      )}

      {showHwPoUpload && (
        <HWPoUploadInline
          onClose={() => setShowHwPoUpload(false)}
          onUploaded={refreshAll}
        />
      )}

      {showCompletedImport && (
        <CompletedWorksImportInline
          onClose={() => setShowCompletedImport(false)}
          onImported={refreshAll}
        />
      )}

      {showQcUpload && (
        <QCUploadInline
          onClose={() => setShowQcUpload(false)}
          onUploaded={refreshAll}
        />
      )}

      <div className="entryPanel">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "end",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{ display: "flex", justifyContent: "center", width: "100%" }}
          >
            <div style={{ width: "420px" }}>
              <label
                style={{
                  display: "block",
                  fontWeight: "700",
                  marginBottom: "8px",
                  color: "#374151",
                  textAlign: "center",
                }}
              >
                Site Code
              </label>

              <div style={{ display: "flex", gap: "10px" }}>
                <input
                  value={siteSearchCode}
                  onChange={handleSiteSearchChange}
                  placeholder="Site ID giriniz"
                  style={{
                    flex: 1,
                    padding: "12px 14px",
                    border: "1px solid #d1d5db",
                    borderRadius: "10px",
                    fontSize: "14px",
                    outline: "none",
                  }}
                />

                <button
                  type="button"
                  className="saveButton"
                  onClick={handleOpenEntryModal}
                  disabled={!siteSearchCode}
                  style={{
                    padding: "12px 18px",
                    borderRadius: "10px",
                  }}
                >
                  Veri Gir
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="tableWrap">
        <h3 className="listTitle">Bu Saha İçin Açılmış PO Kalemleri</h3>
        <div style={{ marginBottom: "10px", fontSize: "14px" }}>
          <strong>Toplam Adet:</strong> {poSummary.totalQty} &nbsp; | &nbsp;
          <strong>Toplam Tutar:</strong> {formatTRY(poSummary.totalAmount)}
        </div>

        <div
          style={{
            maxHeight: "38vh",
            overflowY: "auto",
            overflowX: "auto",
          }}
        >
          <table>
            <thead>
              <tr>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  PO No
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Project Code
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Site Code
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Item Code
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Item Description
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Requested Qty
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Due Qty
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Currency
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Unit Price
                </th>
              </tr>
            </thead>
            <tbody>
              {poRows.length === 0 ? (
                <EmptyRow
                  colSpan={9}
                  text="Bu saha için PO kalemi bulunamadı"
                />
              ) : (
                poRows.map((row, index) => (
                  <tr key={`${row.po_no || "no-po"}-${row.item_code}-${index}`}>
                    <td>{row.po_no || "-"}</td>
                    <td>{row.project_code || "-"}</td>
                    <td>{row.site_code || "-"}</td>
                    <td>{row.item_code || "-"}</td>
                    <td>{row.item_description || "-"}</td>
                    <td>{row.requested_qty ?? "-"}</td>
                    <td>{row.due_qty ?? "-"}</td>
                    <td>{row.currency || "-"}</td>
                    <td>
                      {Number(row.unit_price || 0) === 0
                        ? "-"
                        : formatMoneyByCurrency(row.unit_price, row.currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tableWrap">
        <div className="tableWrap">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr auto",
              alignItems: "center",
              gap: "12px",
              marginBottom: "14px",
            }}
          >
            <div style={{ fontSize: "14px", textAlign: "left" }}>
              <strong>Toplam Adet:</strong> {entrySummary.totalQty} {" | "}
              <strong>Toplam Tutar:</strong>{" "}
              {formatTRY(entrySummary.totalAmount)}
            </div>

            <h3
              className="listTitle"
              style={{ margin: 0, textAlign: "center" }}
            >
              Bu Saha İçin Girilmiş İşler
            </h3>

            <div style={{ fontSize: "14px", textAlign: "right" }}>
              <strong>Fark Adet:</strong> {farkQty} {" | "}
              <strong>Fark Tutar:</strong> {formatTRY(farkTutar)}
            </div>

            <button
              type="button"
              onClick={handleExportExcel}
              style={{
                padding: "10px 16px",
                background: "#e5e7eb",
                border: "none",
                borderRadius: "8px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              Excel İndir
            </button>
          </div>
        </div>

        <div
          style={{
            maxHeight: "38vh",
            overflowY: "auto",
            overflowX: "auto",
          }}
        >
          <table>
            <thead>
              <tr>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Saha Türü
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Project
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Site
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Item Code
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Açıklama
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Done Qty
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Requested Qty
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Fark
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Analiz
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Taşeron
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  OnAir
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  RF Not
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  İşlem
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  QC Durum
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Kabul Durum
                </th>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f3f4f6",
                    zIndex: 2,
                  }}
                >
                  Kabul Not
                </th>
              </tr>
            </thead>
            <tbody>
              {siteEntries.length === 0 ? (
                <EmptyRow colSpan={15} text="Bu saha için giriş yapılmamış" />
              ) : (
                siteEntries.map((row, index) => {
                  const analysis = getQtyAnalysis(
                    row.done_qty,
                    row.requested_qty,
                  );

                  return (
                    <tr key={`${row.id}-${index}`}>
                      <td>{row.site_type}</td>
                      <td>{row.project_code}</td>
                      <td>{row.site_code}</td>
                      <td>{row.item_code}</td>
                      <td title={row.item_description}>
                        <div className="desc-cell">{row.item_description}</div>
                      </td>
                      <td>{row.done_qty}</td>
                      <td>{row.requested_qty ?? "-"}</td>
                      <td>{analysis.diff}</td>
                      <td>
                        <span className={`analysisBadge ${analysis.className}`}>
                          {analysis.label}
                        </span>
                      </td>
                      <td>{row.subcon_name}</td>
                      <td>{formatDateTR(row.onair_date)}</td>
                      <td>{row.note}</td>
                      <td>
                        <td>
                          <div
                            style={{
                              display: "flex",
                              gap: "8px",
                              flexWrap: "nowrap",
                              justifyContent: "center",
                              alignItems: "center",
                            }}
                          >
                            <button
                              type="button"
                              className="tab"
                              style={{
                                padding: "8px 14px",
                                minWidth: "86px",
                                borderRadius: "10px",
                                fontWeight: "600",
                                whiteSpace: "nowrap",
                              }}
                              onClick={() => handleEdit(row)}
                              title="Kaydı düzenle"
                            >
                              Düzenle
                            </button>

                            <button
                              type="button"
                              className="tab"
                              style={{
                                padding: "8px 14px",
                                minWidth: "70px",
                                borderRadius: "10px",
                                fontWeight: "600",
                                whiteSpace: "nowrap",
                                background: "#fee2e2",
                                color: "#991b1b",
                              }}
                              onClick={() => handleDelete(row)}
                              title="Kaydı sil"
                            >
                              Sil
                            </button>
                          </div>
                        </td>
                      </td>
                      <td>{row.qc_durum || "-"}</td>
                      <td>{row.kabul_durum || "-"}</td>
                      <td>{row.kabul_not || "-"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showEntryModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999,
            padding: "20px",
          }}
          onClick={handleCancelEdit}
        >
          <div
            style={{
              background: "#fff",
              width: "100%",
              maxWidth: "1100px",
              maxHeight: "90vh",
              overflow: "auto",
              borderRadius: "20px",
              padding: "24px",
              boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
                flexWrap: "wrap",
                marginBottom: "18px",
              }}
            >
              <h3 style={{ margin: 0 }}>
                {editingId ? "Kaydı Düzenle" : "Yeni Veri Girişi"}
              </h3>

              <button type="button" className="tab" onClick={handleCancelEdit}>
                Kapat
              </button>
            </div>

            <form className="entryForm" onSubmit={handleSave}>
              <div className="formGrid">
                <div className="formGroup">
                  <label>Saha Türü</label>
                  <select
                    name="site_type"
                    value={form.site_type}
                    onChange={handleChange}
                  >
                    <option value="5G">5G</option>
                    <option value="DSS">DSS</option>
                    <option value="LTE">LTE</option>
                    <option value="STANDALONE">STANDALONE</option>
                    <option value="Diğer">Diğer</option>
                  </select>
                </div>

                <div className="formGroup">
                  <label>Project Code</label>
                  <select
                    name="project_code"
                    value={form.project_code}
                    onChange={handleChange}
                    required
                  >
                    <option value="">Seçiniz</option>
                    <option value="56A0SJC">56A0SJC</option>
                    <option value="56A0QEF">56A0QEF</option>
                    <option value="56A0NCD">56A0NCD</option>
                    <option value="56A0TCT">56A0TCT</option>
                    {projectCodes
                      .filter(
                        (p) =>
                          ![
                            "56A0SJC",
                            "56A0QEF",
                            "56A0NCD",
                            "56A0TCT",
                          ].includes(p.project_code),
                      )
                      .map((p, i) => (
                        <option
                          key={`${p.project_code}-${i}`}
                          value={p.project_code}
                        >
                          {p.project_code}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="formGroup">
                  <label>Site Code</label>
                  <input
                    name="site_code"
                    value={form.site_code}
                    onChange={handleChange}
                    placeholder="Örn: AT8227_NS_WM"
                    required
                  />
                </div>

                <div className="formGroup">
                  <label>Done Qty</label>
                  <input
                    type="number"
                    step="0.01"
                    name="done_qty"
                    value={form.done_qty}
                    onChange={handleChange}
                    placeholder="Örn: 2"
                    required
                  />
                </div>

                <div className="formGroup">
                  <label>Subcon Name</label>
                  <input
                    name="subcon_name"
                    value={form.subcon_name}
                    onChange={handleChange}
                    placeholder="Taşeron adı"
                  />
                </div>

                <div className="formGroup">
                  <label>OnAir Date</label>
                  <DatePicker
                    selected={parseTRDateToDate(form.onair_date)}
                    onChange={(date) =>
                      setForm((prev) => ({
                        ...prev,
                        onair_date: formatDateToTR(date),
                      }))
                    }
                    dateFormat="dd.MM.yyyy"
                    placeholderText="GG.AA.YYYY"
                    className="datePickerInput"
                    isClearable
                    showPopperArrow={false}
                  />
                </div>

                <div
                  className="formGroup"
                  style={{ position: "relative" }}
                  ref={itemCodeBoxRef}
                >
                  <label>Item Code</label>

                  <input
                    type="text"
                    value={itemCodeSearch}
                    onChange={(e) => {
                      setItemCodeSearch(e.target.value);
                      setShowItemCodeList(true);
                    }}
                    onFocus={() => setShowItemCodeList(true)}
                    placeholder="Item code filtrele..."
                    disabled={itemOptions.length === 0}
                  />

                  {showItemCodeList && filteredItemCodes.length > 0 && (
                    <div className="filterDropdown">
                      {filteredItemCodes.map((item, idx) => (
                        <div
                          key={`${item.item_code}-${idx}`}
                          className="filterDropdownItem"
                          onMouseDown={() => handleItemCodePick(item)}
                        >
                          {item.item_code}
                        </div>
                      ))}
                    </div>
                  )}

                  <select
                    name="item_code"
                    value={form.item_code}
                    onChange={handleChange}
                    required
                    disabled={itemOptions.length === 0}
                    style={{ marginTop: "8px" }}
                  >
                    <option value="">
                      {itemOptions.length === 0
                        ? "Kayıt bulunamadı"
                        : "Seçiniz"}
                    </option>
                    {itemOptions.map((item, idx) => (
                      <option
                        key={`${item.item_code}-${idx}`}
                        value={item.item_code}
                      >
                        {item.item_code}
                      </option>
                    ))}
                  </select>
                </div>

                <div
                  className="formGroup formGroupWide"
                  style={{ position: "relative" }}
                  ref={itemDescriptionBoxRef}
                >
                  <label className="itemDescLabel">
                    🔎 Item Description (Buradan arayın)
                  </label>

                  <input
                    className="itemDescHighlight"
                    type="text"
                    value={itemDescriptionSearch}
                    onChange={(e) => {
                      setItemDescriptionSearch(e.target.value);
                      setShowItemDescriptionList(true);
                    }}
                    onFocus={() => setShowItemDescriptionList(true)}
                    placeholder="🔎 Aramak için item description yazın..."
                    disabled={itemOptions.length === 0}
                  />

                  {showItemDescriptionList &&
                    filteredItemDescriptions.length > 0 && (
                      <div className="filterDropdown">
                        {filteredItemDescriptions.map((item, idx) => (
                          <div
                            key={`${item.item_code}-${idx}`}
                            className="filterDropdownItem"
                            onMouseDown={() => handleItemDescriptionPick(item)}
                          >
                            {item.item_description}
                          </div>
                        ))}
                      </div>
                    )}

                  <select
                    name="item_description"
                    value={form.item_description}
                    onChange={handleDescriptionChange}
                    required
                    disabled={itemOptions.length === 0}
                    style={{ marginTop: "8px" }}
                  >
                    <option value="">
                      {itemOptions.length === 0
                        ? "Kayıt bulunamadı"
                        : "Seçiniz"}
                    </option>
                    {itemOptions.map((item, idx) => (
                      <option
                        key={`${item.item_code}-${idx}`}
                        value={item.item_description}
                      >
                        {item.item_description}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="formGroup">
                  <label>QC Durum</label>
                  <select
                    name="qc_durum"
                    value={form.qc_durum}
                    onChange={handleChange}
                  >
                    <option value="OK">OK</option>
                    <option value="NOK">NOK</option>
                  </select>
                </div>

                <div className="formGroup">
                  <label>Kabul Durum</label>
                  <select
                    name="kabul_durum"
                    value={form.kabul_durum}
                    onChange={handleChange}
                  >
                    <option value="OK">OK</option>
                    <option value="NOK">NOK</option>
                  </select>
                </div>

                <div className="formGroup formGroupWide">
                  <label>Kabul Not</label>
                  <textarea
                    name="kabul_not"
                    value={form.kabul_not}
                    onChange={handleChange}
                    placeholder="Kabul ile ilgili not"
                    rows={3}
                  />
                </div>

                <div className="formGroup formGroupWide">
                  <label>RF Not</label>
                  <textarea
                    name="note"
                    value={form.note}
                    onChange={handleChange}
                    placeholder="RF ile ilgili not giriniz"
                    rows={3}
                  />
                </div>
              </div>

              <div className="entryActions" style={{ gap: "10px" }}>
                <button
                  type="button"
                  className="tab"
                  onClick={handleCancelEdit}
                >
                  Kapat
                </button>

                <button type="submit" className="saveButton" disabled={saving}>
                  {saving
                    ? "Kaydediliyor..."
                    : editingId
                      ? "Güncelle"
                      : "Kaydet"}
                </button>
              </div>

              {message && <div className="entryMessage">{message}</div>}
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function FinanceUploadInline({ onClose, onUploaded }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const handleUpload = async () => {
    if (!file) {
      setMessage("❌ Lütfen bir Excel dosyası seç");
      return;
    }

    try {
      setUploading(true);
      setMessage("");

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${API_BASE}/finance/hw-payment/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("finance_token")}`,
        },
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        throw new Error(
          data.error || "HW Payment upload sırasında hata oluştu",
        );
      }

      setMessage(
        `✅ HW Payment raporu yüklendi. Eklenen kayıt: ${data.inserted || 0}`,
      );
      setFile(null);

      const input = document.getElementById("finance-hw-payment-upload-input");
      if (input) input.value = "";

      if (onUploaded) {
        await onUploaded();
      }
    } catch (err) {
      console.error("FINANCE UPLOAD ERROR:", err);
      setMessage(`❌ ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="entryPanel" style={{ marginBottom: "18px" }}>
      <div className="entryForm">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "14px",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <h3 className="listTitle" style={{ margin: 0 }}>
            💳 HW Payment Upload
          </h3>
          <button
            type="button"
            className="tab"
            onClick={onClose}
            style={{ padding: "10px 14px" }}
          >
            Kapat
          </button>
        </div>

        <div className="formGrid">
          <div className="formGroup formGroupWide">
            <label>HW Payment Excel Dosyası</label>
            <input
              id="finance-hw-payment-upload-input"
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>

        <div className="entryActions">
          <button
            type="button"
            className="saveButton"
            onClick={handleUpload}
            disabled={uploading}
          >
            {uploading ? "Yükleniyor..." : "HW Payment Yükle"}
          </button>
        </div>

        {message && <div className="entryMessage">{message}</div>}
      </div>
    </div>
  );
}

function FinanceInvoiceUploadInline({ onClose, onUploaded }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const handleUpload = async () => {
    if (!file) {
      setMessage("❌ Lütfen bir Excel dosyası seç");
      return;
    }

    try {
      setUploading(true);
      setMessage("");

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${API_BASE}/finance/hw-invoice/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("finance_token")}`,
        },
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "HW Fatura upload sırasında hata oluştu");
      }

      setMessage(
        `✅ HW Fatura raporu yüklendi. Eklenen kayıt: ${data.inserted || 0}`,
      );

      setFile(null);

      const input = document.getElementById("finance-hw-invoice-upload-input");
      if (input) input.value = "";

      if (onUploaded) {
        await onUploaded();
      }
    } catch (err) {
      console.error("FINANCE INVOICE UPLOAD ERROR:", err);
      setMessage(`❌ ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="entryPanel" style={{ marginBottom: "18px" }}>
      <div className="entryForm">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "14px",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <h3 className="listTitle" style={{ margin: 0 }}>
            🧾 HW Fatura Upload
          </h3>
          <button
            type="button"
            className="tab"
            onClick={onClose}
            style={{ padding: "10px 14px" }}
          >
            Kapat
          </button>
        </div>

        <div className="formGrid">
          <div className="formGroup formGroupWide">
            <label>HW Fatura Excel Dosyası</label>
            <input
              id="finance-hw-invoice-upload-input"
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>

        <div className="entryActions">
          <button
            type="button"
            className="saveButton"
            onClick={handleUpload}
            disabled={uploading}
          >
            {uploading ? "Yükleniyor..." : "HW Fatura Yükle"}
          </button>
        </div>

        {message && <div className="entryMessage">{message}</div>}
      </div>
    </div>
  );
}

function formatTLInput(value) {
  const numeric = String(value || "").replace(/[^\d]/g, "");
  if (!numeric) return "";
  return "₺" + Number(numeric).toLocaleString("tr-TR");
}

function parseTLInput(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function formatDonemLabel(value) {
  if (!value) return "";

  const [year, month] = value.split("-");

  const months = [
    "Ocak",
    "Şubat",
    "Mart",
    "Nisan",
    "Mayıs",
    "Haziran",
    "Temmuz",
    "Ağustos",
    "Eylül",
    "Ekim",
    "Kasım",
    "Aralık",
  ];

  return `${months[Number(month) - 1]} ${year}`;
}

function FinanceDashboard({
  financeToken,
  financeUserEmail,
  onFinanceLogout,
  advanceModalOpen,
  setAdvanceModalOpen,
  advanceForm,
  setAdvanceForm,
  handleApplyAdvance,
  supplierAdvances,
  supplierAdvanceTotal,
}) {
  function parseDateTR(dateStr) {
    const [day, month, year] = dateStr.split(".");
    return new Date(`${year}-${month}-${day}`);
  }
  //Silinecek// Fatura takip

  const [showInvoiceExcelImport, setShowInvoiceExcelImport] = useState(false);

  const handleMaasAvansClick = () => {
    const password = prompt("Bu alana giriş için şifre giriniz:");

    if (password === "simsek2026") {
      setShowSalaryModal(true);
    } else {
      alert("Yetkisiz erişim!");
    }
  };
  function getSalaryStatus(row) {
    const netMaas = Number(row.net_maas || 0);
    const avans = Number(row.avans || 0);
    const kalan = Number(row.kalan_net_odeme || 0);

    if (avans > netMaas) {
      return {
        text: `Fazla Ödeme - ${formatTRY(avans - netMaas)}`,
        className: "cancel",
      };
    }

    if (kalan > 0) {
      return {
        text: `Alacaklı - ${formatTRY(kalan)}`,
        className: "bekler",
      };
    }

    return {
      text: "Kapandı",
      className: "ok",
    };
  }

  const [usdTryRate, setUsdTryRate] = useState(0);
  const [subconDetailRows, setSubconDetailRows] = useState([]);
  const [selectedSubcontractor, setSelectedSubcontractor] = useState("");

  const [subconFilter, setSubconFilter] = useState("");
  const [subconSummaryRows, setSubconSummaryRows] = useState([]);
  const [showSubconSummaryModal, setShowSubconSummaryModal] = useState(false);

  const [supplierSuggestions, setSupplierSuggestions] = useState([]);
  const [showSupplierSuggestions, setShowSupplierSuggestions] = useState(false);

  const [showSubconModal, setShowSubconModal] = useState(false);
  const [subconRows, setSubconRows] = useState([]);

  const [showPersonFilterList, setShowPersonFilterList] = useState(false);
  const [salaryRows, setSalaryRows] = useState([]);
  const [editingSalaryId, setEditingSalaryId] = useState(null);

  const [manualInvoiceSearch, setManualInvoiceSearch] = useState("");
  const [manualInvoiceStatusFilter, setManualInvoiceStatusFilter] =
    useState("ALL");

  const [manualInvoiceRows, setManualInvoiceRows] = useState([]);
  const [overdueRows, setOverdueRows] = useState([]);
  const [showOverdueModal, setShowOverdueModal] = useState(false);
  const [summary, setSummary] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showInvoiceUpload, setShowInvoiceUpload] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paymentRows, setPaymentRows] = useState([]);

  const [errorMessage, setErrorMessage] = useState("");
  const [paymentDateFilter, setPaymentDateFilter] = useState("");
  const [upcomingRows, setUpcomingRows] = useState([]);
  const [upcomingSummary, setUpcomingSummary] = useState({
    today_total: 0,
    week_total: 0,
    overdue_total: 0,
  });

  const [showInvoiceFormPanel, setShowInvoiceFormPanel] = useState(false);
  const [showInvoiceEntryModal, setShowInvoiceEntryModal] = useState(false);
  const [showSalaryModal, setShowSalaryModal] = useState(false);

  const [salaryFilterMonth, setSalaryFilterMonth] = useState(
    String(new Date().getMonth() + 1).padStart(2, "0"),
  );
  const [salaryFilterYear, setSalaryFilterYear] = useState(
    String(new Date().getFullYear()),
  );
  const [salaryFilterPersonel, setSalaryFilterPersonel] = useState("");

  const normalizeSubconName = (value) =>
    String(value || "")
      .trim()
      .toLocaleUpperCase("tr-TR");

  const recalculatedSubconSummaryRows = useMemo(() => {
    const detailMap = new Map();

    (subconDetailRows || []).forEach((row) => {
      const subconName = normalizeSubconName(row.subcon_name);
      if (!subconName) return;

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

      if (!detailMap.has(subconName)) {
        detailMap.set(subconName, {
          subcon_name: subconName,
          total_hakedis: 0,
          total_faturaya_hazir: 0,
        });
      }

      const existing = detailMap.get(subconName);
      existing.total_hakedis += hakedisTL;
      existing.total_faturaya_hazir += faturayaHazirTL;
    });

    return (subconSummaryRows || []).map((summaryRow) => {
      const subconName = normalizeSubconName(summaryRow.subcon_name);
      const recalculated = detailMap.get(subconName);

      return {
        ...summaryRow,
        total_hakedis: Number(recalculated?.total_hakedis || 0),
        total_faturaya_hazir: Number(recalculated?.total_faturaya_hazir || 0),
        total_fatura: Number(summaryRow.total_fatura || 0),
        total_odenen: Number(summaryRow.total_odenen || 0),
        kalan_borc: Number(summaryRow.kalan_borc || 0),
        fazla_odeme: Number(summaryRow.fazla_odeme || 0),
      };
    });
  }, [subconDetailRows, subconSummaryRows, usdTryRate]);

  const filteredSubconSummaryRows = useMemo(() => {
    const q = subconFilter.toLowerCase().trim();

    if (!q) return recalculatedSubconSummaryRows;

    return recalculatedSubconSummaryRows.filter((row) =>
      (row.subcon_name || "").toLowerCase().includes(q),
    );
  }, [recalculatedSubconSummaryRows, subconFilter]);

  const subcontractorPeriodStats = useMemo(() => {
    if (!selectedSubcontractor) return null;

    const now = new Date();

    const weekAgo = new Date();
    weekAgo.setDate(now.getDate() - 7);

    const monthAgo = new Date();
    monthAgo.setMonth(now.getMonth() - 1);

    let weekDoneQty = 0;
    let monthDoneQty = 0;
    let weekJobCount = 0;
    let monthJobCount = 0;

    (subconDetailRows || []).forEach((row) => {
      if (row.subcon_name !== selectedSubcontractor) return;

      const doneQty = Number(row.done_qty || 0);
      const unitPrice = Number(row.unit_price || 0);

      const curr = String(row.currency || "TRY").toUpperCase();

      let total = doneQty * unitPrice;

      if (curr === "USD") {
        total = total * Number(usdTryRate || 0);
      }

      const date = row.onair_date ? new Date(row.onair_date) : null;

      if (date && date >= weekAgo) {
        weekDoneQty += total;
        weekJobCount += 1;
      }

      if (date && date >= monthAgo) {
        monthDoneQty += total;
        monthJobCount += 1;
      }
    });

    return {
      weekDoneQty,
      monthDoneQty,
      weekJobCount,
      monthJobCount,
    };
  }, [selectedSubcontractor, subconDetailRows, usdTryRate]);

  const selectedSubcontractorSummary = useMemo(() => {
    if (!selectedSubcontractor) return null;

    return recalculatedSubconSummaryRows.find(
      (row) => row.subcon_name === selectedSubcontractor,
    );
  }, [selectedSubcontractor, recalculatedSubconSummaryRows]);

  const totalRow = useMemo(
    () =>
      filteredSubconSummaryRows.reduce(
        (acc, row) => {
          acc.total_hakedis += Number(row.total_hakedis || 0);
          acc.total_faturaya_hazir += Number(row.total_faturaya_hazir || 0);
          acc.total_fatura += Number(row.total_fatura || 0);
          acc.total_odenen += Number(row.total_odenen || 0);
          acc.kalan_borc += Number(row.kalan_borc || 0);
          acc.fazla_odeme += Number(row.fazla_odeme || 0);
          return acc;
        },
        {
          total_hakedis: 0,
          total_faturaya_hazir: 0,
          total_fatura: 0,
          total_odenen: 0,
          kalan_borc: 0,
          fazla_odeme: 0,
        },
      ),
    [filteredSubconSummaryRows],
  );

  const filteredSubconDetailRows = useMemo(() => {
    const q = subconFilter.toLowerCase().trim();

    let rows = subconDetailRows || [];

    if (q) {
      rows = rows.filter((row) =>
        (row.subcon_name || "").toLowerCase().includes(q),
      );
    }

    return rows;
  }, [subconDetailRows, subconFilter]);

  const handleExportFilteredSubconExcel = () => {
    if (!filteredSubconDetailRows.length) {
      alert("İndirilecek kayıt bulunamadı");
      return;
    }

    const excelRows = filteredSubconDetailRows.map((row) => {
      const billedQty = Number(row.billed_qty || 0);
      const doneQty = Number(row.done_qty || 0);
      const unitPrice = Number(row.unit_price || 0);
      const rawTotal = doneQty * unitPrice;
      const curr = String(row.currency || "TRY").toUpperCase();
      const totalTl =
        curr === "USD" ? rawTotal * Number(usdTryRate || 0) : rawTotal;

      return {
        Bölge: getRegion(row.site_code) || "",
        Status: row.status || "",
        Project: row.project_code || "",
        Site: row.site_code || "",
        Item: row.item_code || "",
        "Item Description": row.item_description || "",
        Done: doneQty,
        Req: Number(row.requested_qty || 0),
        Analiz: getQtyAnalysis(row.done_qty, row.requested_qty).label,
        Billed: billedQty,
        Curr: curr,
        Unit: unitPrice,
        Total: Number(totalTl.toFixed(2)),
        Subcon: row.subcon_name || "",
        OnAir: formatDateTR(row.onair_date),
        QC: row.qc_durum || "",
        Kabul: row.kabul_durum || "",
        "RF Not": row.kabul_not || "",
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(excelRows);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Subcon Detail");

    const safeName = subconFilter
      ? subconFilter.replace(/[^\wğüşöçıİĞÜŞÖÇ -]/gi, "").replace(/\s+/g, "_")
      : "tum_taseronlar";

    XLSX.writeFile(
      workbook,
      `subcon_detail_${safeName}_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  };

  const supplierOptions = useMemo(() => {
    const names = (manualInvoiceRows || [])
      .map((x) => String(x.tedarikci || "").trim())
      .filter(Boolean);

    return [...new Set(names)].sort((a, b) => a.localeCompare(b, "tr"));
  }, [manualInvoiceRows]);

  const filterSupplierSuggestions = (value) => {
    const q = String(value || "")
      .toLowerCase()
      .trim();

    if (!q) {
      setSupplierSuggestions([]);
      return;
    }

    const filtered = supplierOptions
      .filter((name) => name.toLowerCase().includes(q))
      .slice(0, 8);

    setSupplierSuggestions(filtered);
  };

  const loadSubconDetailRows = async () => {
    try {
      const data = await fetchJson(`${API_BASE}/master/list-detailed`);
      setSubconDetailRows(data.rows || []);
    } catch (err) {
      console.error("SUBCON DETAIL LOAD ERROR:", err);
      alert(err.message || "Taşeron detay verisi alınamadı");
    }
  };

  const [invoiceForm, setInvoiceForm] = useState({
    bolge: "",
    proje: "",
    proje_kodu: "",
    fatura_no: "",
    fatura_tarihi: "",
    tedarikci: "",
    rf_montaj_firma: "",
    fatura_kalemi: "",
    is_kalemi: "",
    po_no: "",
    site_id: "",
    tutar: "",
    kdv: "",
    toplam_tutar: "",
    odenen_tutar: "",
    kalan_borc: "",
    note: "",
  });

  const [salaryForm, setSalaryForm] = useState({
    ad_soyad: "",
    unvan: "",
    net_maas: "",
    avans: "",
    kalan_net_odeme: "",
    bankaya_yatacak_net: "",
    elden_odenecek_net: "",
    banka_maliyeti: "",
    toplam_isveren_maliyeti: "",
    ay: "",
    note: "",
  });

  const [personnelMaster, setPersonnelMaster] = useState([]);
  const [selectedPerson, setSelectedPerson] = useState("");

  const [personelUploadLoading, setPersonelUploadLoading] = useState(false);

  const handleShowSubconModal = async () => {
    try {
      const data = await fetchJson(`${API_BASE}/finance/subcon-payables`);
      setSubconRows(data.rows || []);
      setShowSubconModal(true);
    } catch (err) {
      console.error("SUBCON PAYABLES LOAD ERROR:", err);
      alert(err.message || "Taşeron ödeme durumu alınamadı");
    }
  };

  const handlePersonelExcelUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setPersonelUploadLoading(true);

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${API_BASE}/finance/personel/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("finance_token") || ""}`,
        },
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Personel Excel yüklenemedi");
      }

      alert(`✅ ${data.inserted || 0} personel yüklendi`);

      const personelData = await fetchJson(
        `${API_BASE}/finance/personel/list`,
        {
          withAuth: true,
        },
      );
      setPersonnelMaster(personelData.rows || []);
    } catch (err) {
      console.error("PERSONEL EXCEL UPLOAD ERROR:", err);
      alert(err.message || "Personel yükleme hatası");
    } finally {
      setPersonelUploadLoading(false);
      e.target.value = "";
    }
  };

  const handleSaveSalary = async () => {
    try {
      const payload = {
        ad_soyad: salaryForm.ad_soyad,
        unvan: salaryForm.unvan,
        net_maas: Number(salaryForm.net_maas || 0),
        avans: Number(salaryForm.avans || 0),
        kalan_net_odeme: Number(salaryForm.kalan_net_odeme || 0),
        bankaya_yatacak_net: Number(salaryForm.bankaya_yatacak_net || 0),
        elden_odenecek_net: Number(salaryForm.elden_odenecek_net || 0),
        banka_maliyeti: Number(salaryForm.banka_maliyeti || 0),
        toplam_isveren_maliyeti: Number(
          salaryForm.toplam_isveren_maliyeti || 0,
        ),
        ay: salaryForm.ay,
        note: salaryForm.note,
      };

      if (!payload.ad_soyad || !payload.ay) {
        alert("Personel ve dönem zorunlu");
        return;
      }

      if (editingSalaryId) {
        await fetchJson(`${API_BASE}/finance/salary/${editingSalaryId}`, {
          method: "PUT",
          withAuth: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetchJson(`${API_BASE}/finance/salary/add`, {
          method: "POST",
          withAuth: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      setEditingSalaryId(null);
      await loadFinance();

      setSalaryForm({
        ad_soyad: "",
        unvan: "",
        net_maas: "",
        avans: "",
        kalan_net_odeme: "",
        bankaya_yatacak_net: "",
        elden_odenecek_net: "",
        banka_maliyeti: "",
        toplam_isveren_maliyeti: "",
        ay: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
        note: "",
      });
    } catch (err) {
      console.error("SALARY SAVE ERROR:", err);
      alert(err.message || "Kaydedilemedi");
    }
  };

  const filteredSalaryRows = useMemo(() => {
    return (salaryRows || []).filter((row) => {
      const rowAy = String(row.ay || "");
      const [rowYear = "", rowMonth = ""] = rowAy.split("-");

      const monthOk = salaryFilterMonth ? rowMonth === salaryFilterMonth : true;
      const yearOk = salaryFilterYear ? rowYear === salaryFilterYear : true;

      const personelText = `${row.ad_soyad || ""} ${row.unvan || ""}`
        .toLowerCase()
        .trim();

      const personelOk = salaryFilterPersonel
        ? personelText.includes(salaryFilterPersonel.toLowerCase().trim())
        : true;

      return monthOk && yearOk && personelOk;
    });
  }, [salaryRows, salaryFilterMonth, salaryFilterYear, salaryFilterPersonel]);

  const filteredPersonnelMaster = useMemo(() => {
    const q = salaryFilterPersonel.toLowerCase().trim();

    if (!q) return personnelMaster || [];

    return (personnelMaster || []).filter((p) => {
      const text = `${p.ad_soyad || ""} ${p.unvan || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [personnelMaster, salaryFilterPersonel]);

  const salaryRemainingSummary = useMemo(() => {
    return filteredSalaryRows.reduce(
      (sum, row) => sum + Math.max(Number(row.kalan_net_odeme || 0), 0),
      0,
    );
  }, [filteredSalaryRows]);

  const monthOptions = [
    { value: "01", label: "Ocak" },
    { value: "02", label: "Şubat" },
    { value: "03", label: "Mart" },
    { value: "04", label: "Nisan" },
    { value: "05", label: "Mayıs" },
    { value: "06", label: "Haziran" },
    { value: "07", label: "Temmuz" },
    { value: "08", label: "Ağustos" },
    { value: "09", label: "Eylül" },
    { value: "10", label: "Ekim" },
    { value: "11", label: "Kasım" },
    { value: "12", label: "Aralık" },
  ];

  const currentYear = new Date().getFullYear();

  const yearOptions = Array.from({ length: 6 }, (_, i) =>
    String(currentYear - 2 + i),
  );

  const selectedYear = salaryForm.ay
    ? salaryForm.ay.split("-")[0]
    : String(currentYear);

  const selectedMonth = salaryForm.ay
    ? salaryForm.ay.split("-")[1]
    : String(new Date().getMonth() + 1).padStart(2, "0");

  useEffect(() => {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");

    setSalaryForm((prev) => ({
      ...prev,
      ay: `${year}-${month}`, // DB için
    }));
  }, []);

  const handleShowSubconSummary = async () => {
    try {
      const [summaryData, detailData] = await Promise.all([
        fetchJson(`${API_BASE}/finance/subcon-hakedis-summary`),
        fetchJson(`${API_BASE}/master/list-detailed`),
      ]);

      setSubconSummaryRows(summaryData.rows || []);
      setUsdTryRate(Number(summaryData.usd_try_rate || 0));
      setSubconDetailRows(detailData.rows || []);
      setShowSubconSummaryModal(true);
    } catch (err) {
      console.error("SUBCON SUMMARY LOAD ERROR:", err);
      alert(err.message || "Taşeron hakediş özeti alınamadı");
    }
  };

  useEffect(() => {
    if (showInvoiceEntryModal) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }

    return () => {
      document.body.style.overflow = "auto";
    };
  }, [showInvoiceEntryModal]);

  useEffect(() => {
    fetchJson(`${API_BASE}/finance/personel/list`, { withAuth: true })
      .then((data) => setPersonnelMaster(data.rows || []))
      .catch((err) => {
        console.error("PERSONNEL MASTER LOAD ERROR:", err);
        setPersonnelMaster([]);
      });
  }, []);

  useEffect(() => {
    const netMaas = Number(
      String(salaryForm.net_maas || "0").replace(/[^\d]/g, ""),
    );
    const avans = Number(String(salaryForm.avans || "0").replace(/[^\d]/g, ""));
    const elden = Number(
      String(salaryForm.elden_odenecek_net || "0").replace(/[^\d]/g, ""),
    );
    const bankaMaliyeti = Number(
      String(salaryForm.banka_maliyeti || "0").replace(/[^\d]/g, ""),
    );

    const bankayaYatacakNet = Math.max(kalanNetOdeme - elden, 0);
    const toplamIsverenMaliyeti = bankaMaliyeti + elden;

    setSalaryForm((prev) => ({
      ...prev,
      kalan_net_odeme: String(kalanNetOdeme),
      bankaya_yatacak_net: String(bankayaYatacakNet),
      toplam_isveren_maliyeti: String(toplamIsverenMaliyeti),
    }));
  }, [
    salaryForm.net_maas,
    salaryForm.avans,
    salaryForm.elden_odenecek_net,
    salaryForm.banka_maliyeti,
  ]);

  useEffect(() => {
    const net = Number(salaryForm.net_maas || 0);
    const avans = Number(salaryForm.avans || 0);

    setSalaryForm((prev) => ({
      ...prev,
      kalan_maas: net - avans,
    }));
  }, [salaryForm.net_maas, salaryForm.avans]);

  useEffect(() => {
    const kalan = Number(salaryForm.kalan_maas || 0);
    const banka = Number(salaryForm.banka_net || 0);

    setSalaryForm((prev) => ({
      ...prev,
      elden_net: kalan - banka,
    }));
  }, [salaryForm.banka_net, salaryForm.kalan_maas]);

  useEffect(() => {
    if (showSubconSummaryModal) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [showSubconSummaryModal]);

  const kalanNetOdeme = useMemo(() => {
    const netMaas = Number(salaryForm.net_maas || 0);
    const avans = Number(salaryForm.avans || 0);
    return netMaas - avans;
  }, [salaryForm.net_maas, salaryForm.avans]);

  const [editingInvoiceId, setEditingInvoiceId] = useState(null);

  const handleInvoiceFormChange = (e) => {
    const { name, value } = e.target;

    setInvoiceForm((prev) => {
      const updated = {
        ...prev,
        [name]: value,
      };

      const tutar = Number(updated.tutar || 0);
      const kdv = Number(updated.kdv || 0);
      const toplam_tutar = Number(updated.toplam_tutar || 0);
      const odenen_tutar = Number(updated.odenen_tutar || 0);

      if (name === "tutar" || name === "kdv") {
        updated.toplam_tutar = String(tutar + kdv);
      }

      const yeniToplam = Number(updated.toplam_tutar || 0);
      updated.kalan_borc = String(yeniToplam - odenen_tutar);

      return updated;
    });
  };

  const handleDeleteManualInvoice = async (row) => {
    const ok = window.confirm(`${row.fatura_no || "Bu kayıt"} silinsin mi?`);

    if (!ok) return;

    try {
      await fetchJson(`${API_BASE}/finance/invoice-entry/${row.id}`, {
        method: "DELETE",
        withAuth: true,
      });

      await loadFinance();
    } catch (err) {
      console.error("MANUAL INVOICE DELETE ERROR:", err);
      alert(err.message || "Kayıt silinemedi");
    }
  };
  const handleEditManualInvoice = (row) => {
    setEditingInvoiceId(row.id);

    setInvoiceForm({
      bolge: row.bolge || "",
      proje: row.proje || "",
      proje_kodu: row.proje_kodu || "",
      fatura_no: row.fatura_no || "",
      fatura_tarihi: row.fatura_tarihi
        ? String(row.fatura_tarihi).slice(0, 10)
        : "",
      tedarikci: row.tedarikci || "",
      rf_montaj_firma: row.rf_montaj_firma || "",
      fatura_kalemi: row.fatura_kalemi || "",
      is_kalemi: row.is_kalemi || "",
      po_no: row.po_no || "",
      site_id: row.site_id || "",
      tutar: row.tutar ?? "",
      kdv: row.kdv ?? "",
      toplam_tutar: row.toplam_tutar ?? "",
      odenen_tutar: row.odenen_tutar ?? "",
      kalan_borc: row.kalan_borc ?? "",
      note: row.note || "",
    });

    setShowUpload(false);
    setShowInvoiceUpload(false);
    setShowInvoiceEntryModal(true);
    setShowInvoiceFormPanel(true);
  };

  const handleSaveManualInvoice = async (e) => {
    if (e) e.preventDefault();

    if (
      !invoiceForm.fatura_no ||
      !invoiceForm.tedarikci ||
      !invoiceForm.toplam_tutar
    ) {
      alert("Fatura no, tedarikçi ve toplam tutar zorunlu");
      return;
    }

    try {
      if (
        !invoiceForm.fatura_no ||
        !invoiceForm.tedarikci ||
        !invoiceForm.toplam_tutar
      ) {
        alert("Fatura no, tedarikçi ve toplam tutar zorunlu");
        return;
      }

      const payload = {
        bolge: invoiceForm.bolge,
        proje: invoiceForm.proje,
        proje_kodu: invoiceForm.proje_kodu,
        fatura_no: invoiceForm.fatura_no,
        fatura_tarihi: invoiceForm.fatura_tarihi || null,
        tedarikci: invoiceForm.tedarikci,
        rf_montaj_firma: invoiceForm.rf_montaj_firma,
        fatura_kalemi: invoiceForm.fatura_kalemi,
        is_kalemi: invoiceForm.is_kalemi,
        po_no: invoiceForm.po_no,
        site_id: invoiceForm.site_id,
        tutar: Number(invoiceForm.tutar || 0),
        kdv: Number(invoiceForm.kdv || 0),
        toplam_tutar: Number(invoiceForm.toplam_tutar || 0),
        odenen_tutar: Number(invoiceForm.odenen_tutar || 0),
        kalan_borc: Number(invoiceForm.kalan_borc || 0),
        note: invoiceForm.note,
      };
      console.log("MANUAL INVOICE PAYLOAD:", payload);

      if (editingInvoiceId) {
        await fetchJson(
          `${API_BASE}/finance/invoice-entry/${editingInvoiceId}`,
          {
            method: "PUT",
            withAuth: true,
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        );
      } else {
        await fetchJson(`${API_BASE}/finance/invoice-entry/add`, {
          method: "POST",
          withAuth: true,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      }

      setInvoiceForm({
        bolge: "",
        proje: "",
        proje_kodu: "",
        fatura_no: "",
        fatura_tarihi: "",
        tedarikci: "",
        rf_montaj_firma: "",
        fatura_kalemi: "",
        is_kalemi: "",
        po_no: "",
        site_id: "",
        tutar: "",
        kdv: "",
        toplam_tutar: "",
        odenen_tutar: "",
        kalan_borc: "",
        note: "",
      });
      setEditingInvoiceId(null);
      setShowInvoiceFormPanel(false);

      await loadFinance();
    } catch (err) {
      console.error("MANUAL INVOICE SAVE ERROR:", err);
      alert(err.message || "Fatura kaydedilemedi");
    }
  };

  const handleEditSalary = (row) => {
    setEditingSalaryId(row.id);
    setSalaryForm({
      ad_soyad: row.ad_soyad || "",
      unvan: row.unvan || "",
      net_maas: String(row.net_maas || ""),
      avans: String(row.avans || ""),
      kalan_net_odeme: String(row.kalan_net_odeme || ""),
      bankaya_yatacak_net: String(row.bankaya_yatacak_net || ""),
      elden_odenecek_net: String(row.elden_odenecek_net || ""),
      banka_maliyeti: String(row.banka_maliyeti || ""),
      toplam_isveren_maliyeti: String(row.toplam_isveren_maliyeti || ""),
      ay: row.ay || "",
      note: row.note || "",
    });
  };

  const handleDeleteSalary = async (row) => {
    const ok = window.confirm(`${row.ad_soyad || "Bu kayıt"} silinsin mi?`);
    if (!ok) return;

    try {
      await fetchJson(`${API_BASE}/finance/salary/${row.id}`, {
        method: "DELETE",
        withAuth: true,
      });

      setSalaryRows((prev) => prev.filter((x) => x.id !== row.id));
    } catch (err) {
      console.error("SALARY SAVE ERROR:", err);
      alert(err.message || "Kaydedilemedi");
    }
  };

  const handleExportInvoiceDatabase = async () => {
    try {
      const params = new URLSearchParams();

      if (manualInvoiceSearch?.trim()) {
        params.append("query", manualInvoiceSearch.trim());
      }

      if (manualInvoiceStatusFilter && manualInvoiceStatusFilter !== "ALL") {
        params.append("status", manualInvoiceStatusFilter);
      }

      const queryString = params.toString();
      const url = `${API_BASE}/finance/invoice-entry/export-excel${queryString ? `?${queryString}` : ""}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("finance_token") || ""}`,
        },
      });

      if (!response.ok) {
        throw new Error("Excel indirilemedi");
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `invoice_database_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error("INVOICE EXPORT ERROR:", err);
      alert(err.message || "Fatura database indirilemedi");
    }
  };

  const handleExportSalaryExcel = async () => {
    try {
      const response = await fetch(
        `${API_BASE}/finance/salary/export-excel?ay=${salaryFilterMonth}&yil=${salaryFilterYear}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("finance_token") || ""}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error("Maaş Excel indirilemedi");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `maas_avans_raporu_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("SALARY EXPORT ERROR:", err);
      alert("Maaş Excel indirilemedi");
    }
  };

  const monthNames = [
    "Ocak",
    "Şubat",
    "Mart",
    "Nisan",
    "Mayıs",
    "Haziran",
    "Temmuz",
    "Ağustos",
    "Eylül",
    "Ekim",
    "Kasım",
    "Aralık",
  ];

  const currentMonth = new Date().getMonth() + 1;
  const thisMonthInvoiced = summary?.monthly_invoiced?.[currentMonth] || 0;

  const loadSalaryRows = async () => {
    try {
      const data = await fetchJson(`${API_BASE}/finance/salary/list`, {
        withAuth: true,
      });
      setSalaryRows(data.rows || []);
    } catch (err) {
      console.error("SALARY LIST ERROR:", err);
      setSalaryRows([]);
    }
  };

  const loadFinance = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage("");

      const paymentsUrl = paymentDateFilter
        ? `${API_BASE}/finance/payments/list?payment_date=${encodeURIComponent(
            paymentDateFilter,
          )}`
        : `${API_BASE}/finance/payments/list`;

      const [
        summaryData,
        paymentsData,
        upcomingData,
        manualInvoiceData,
        salaryData,
      ] = await Promise.all([
        fetchJson(`${API_BASE}/finance/summary`, { withAuth: true }),
        fetchJson(paymentsUrl, { withAuth: true }),
        fetchJson(`${API_BASE}/finance/upcoming-payments`, { withAuth: true }),
        fetchJson(`${API_BASE}/finance/invoice-entry/list`, { withAuth: true }),
        fetchJson(`${API_BASE}/finance/salary/list`, { withAuth: true }),
      ]);

      console.log("MANUAL INVOICE DATA:", manualInvoiceData.rows);
      setSalaryRows(salaryData.rows || []);
      setManualInvoiceRows(manualInvoiceData.rows || []);
      setSummary(summaryData.summary || null);
      setPaymentRows(paymentsData.rows || []);
      setUpcomingRows(upcomingData.rows || []);
      setOverdueRows(upcomingData.overdue_rows || []);
      setUpcomingSummary(
        upcomingData.summary || {
          today_total: 0,
          week_total: 0,
          overdue_total: 0,
        },
      );
    } catch (err) {
      console.error("FINANCE LOAD ERROR:", err);
      setSummary(null);
      setPaymentRows([]);
      setUpcomingRows([]);
      setUpcomingSummary({
        today_total: 0,
        week_total: 0,
        overdue_total: 0,
      });
      setErrorMessage(err.message || "Finance verisi alınamadı");
    } finally {
      setLoading(false);
    }
  }, [paymentDateFilter]);

  const handleShowOverdues = async () => {
    setShowOverdueModal(true);
  };

  useEffect(() => {
    loadFinance();
  }, [loadFinance]);

  const sortedPaymentRows = useMemo(() => {
    return [...paymentRows].sort((a, b) => {
      // boş kontrol
      const aEmpty = !a.due_date;
      const bEmpty = !b.due_date;

      // 🚨 boşlar en alta
      if (aEmpty && !bEmpty) return 1;
      if (!aEmpty && bEmpty) return -1;
      if (aEmpty && bEmpty) return 0;

      // 📅 dolular kendi arasında sıralansın (büyükten küçüğe)
      return String(b.due_date).localeCompare(String(a.due_date));
    });
  }, [paymentRows]);

  const filteredManualInvoiceRows = useMemo(() => {
    const q = manualInvoiceSearch.toLowerCase().trim();

    return manualInvoiceRows.filter((row) => {
      const statusOk =
        manualInvoiceStatusFilter === "ALL"
          ? true
          : Number(row.kalan_borc || 0) > 0
            ? manualInvoiceStatusFilter === "BEKLIYOR"
            : manualInvoiceStatusFilter === "ODENDI";

      const text = `
      ${row.bolge || ""}
      ${row.proje || ""}
      ${row.proje_kodu || ""}
      ${row.fatura_no || ""}
      ${row.tedarikci || ""}
      ${row.fatura_kalemi || ""}
      ${row.is_kalemi || ""}
      ${row.site_id || ""}
      ${row.po_no || ""}
    `.toLowerCase();

      const searchOk = q ? text.includes(q) : true;

      return statusOk && searchOk;
    });
  }, [manualInvoiceRows, manualInvoiceSearch, manualInvoiceStatusFilter]);

  const manualInvoiceSummary = useMemo(() => {
    return filteredManualInvoiceRows.reduce(
      (acc, row) => {
        const total = Number(row.toplam_tutar || 0);
        const paid = Number(row.odenen_tutar || 0);
        const remaining = Number(row.kalan_borc || 0);

        acc.totalAmount += total;
        acc.totalPaid += paid;
        acc.totalRemaining += remaining;

        if (remaining > 0) acc.waitingCount += 1;
        if (paid > 0) acc.paidCount += 1;

        return acc;
      },
      {
        totalAmount: 0,
        totalPaid: 0,
        totalRemaining: 0,
        waitingCount: 0,
        paidCount: 0,
      },
    );
  }, [filteredManualInvoiceRows]);

  if (loading) return <div className="loading">Yükleniyor...</div>;

  if (!summary) {
    return (
      <div className="loading">
        {errorMessage ? `Veri alınamadı: ${errorMessage}` : "Veri alınamadı."}
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          marginBottom: "14px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ margin: "0 0 6px 0" }}>💰 Finance Dashboard</h1>
          <div style={{ fontSize: "14px", color: "#6b7280" }}>
            Giriş yapan: {financeUserEmail}
          </div>
        </div>

        <button type="button" className="tab" onClick={onFinanceLogout}>
          Çıkış Yap
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: "10px",
          flexWrap: "wrap",
          justifyContent: "flex-start",
          alignItems: "center",
        }}
      >
        {/* BUTONLAR AYNI KALACAK */}
        <button
          type="button"
          className={showUpload ? "tab activeTab smallTab" : "tab smallTab"}
          onClick={() => {
            setShowUpload((prev) => !prev);
            if (showInvoiceUpload) setShowInvoiceUpload(false);
          }}
        >
          HW Payment Yükle
        </button>

        <button
          type="button"
          className={
            showInvoiceUpload ? "tab activeTab smallTab" : "tab smallTab"
          }
          onClick={() => {
            setShowInvoiceUpload((prev) => !prev);
            if (showUpload) setShowUpload(false);
          }}
        >
          HW Fatura Yükle
        </button>

        <button
          type="button"
          className={
            showInvoiceEntryModal ? "tab activeTab smallTab" : "tab smallTab"
          }
          onClick={() => {
            setShowInvoiceEntryModal(true);
            setShowInvoiceFormPanel(false);
            setShowInvoiceUpload(false);
            setShowUpload(false);
            setEditingInvoiceId(null);

            setInvoiceForm({
              bolge: "",
              proje: "",
              proje_kodu: "",
              fatura_no: "",
              fatura_tarihi: "",
              tedarikci: "",
              rf_montaj_firma: "",
              fatura_kalemi: "",
              is_kalemi: "",
              po_no: "",
              site_id: "",
              tutar: "",
              kdv: "",
              toplam_tutar: "",
              odenen_tutar: "",
              kalan_borc: "",
              note: "",
            });
          }}
        >
          Fatura Girişi
        </button>

        <button
          type="button"
          className={
            showSalaryModal ? "tab activeTab smallTab" : "tab smallTab"
          }
          onClick={handleMaasAvansClick}
        >
          Maaş & Avans
        </button>
        <button
          type="button"
          className="tab smallTab"
          onClick={() => {
            handleShowSubconSummary();
          }}
        >
          Taşeron Hakediş
        </button>
      </div>

      {showUpload && (
        <FinanceUploadInline
          onClose={() => setShowUpload(false)}
          onUploaded={loadFinance}
        />
      )}

      {showInvoiceExcelImport && (
        <InvoiceEntryExcelUploadInline
          onClose={() => setShowInvoiceExcelImport(false)}
          onUploaded={loadFinance}
        />
      )}

      {showInvoiceUpload && (
        <FinanceInvoiceUploadInline
          onClose={() => setShowInvoiceUpload(false)}
          onUploaded={loadFinance}
        />
      )}

      <div className="cards">
        <div className="card ok statCard">
          <div className="statLabel">
            {new Date().getFullYear()} Toplam Tahsilat
          </div>
          <div className="statValue">
            {formatMoneyByCurrency(summary.total_collections || 0, "TRY")}
          </div>
        </div>

        <div className="card bekler statCard">
          <div className="statLabel">Bu Ay Tahsilat</div>
          <div className="statValue">
            {formatMoneyByCurrency(summary.this_month_collections || 0, "TRY")}
          </div>
        </div>

        <div className="card partial statCard">
          <div className="statLabel">Bu Ay Kesilen Fatura</div>
          <div className="statValue">
            {formatMoneyByCurrency(thisMonthInvoiced || 0, "TRY")}
          </div>
        </div>

        <div
          className="card cancel statCard"
          onClick={handleShowSubconModal}
          style={{ cursor: "pointer" }}
        >
          <div className="statLabel">Gider Kayıt</div>
          <div className="statValue">
            {formatMoneyByCurrency(
              manualInvoiceSummary.totalRemaining || 0,
              "TRY",
            )}
          </div>
        </div>
      </div>

      <div className="tableWrap">
        <h3 className="listTitle">Aylık Tahsilat Özeti</h3>
        <table>
          <thead>
            <tr>
              <th></th>
              {monthNames.map((m) => (
                <th key={m}>{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ fontWeight: 700 }}>Tahsilat Yapılan</td>
              {monthNames.map((m, idx) => (
                <td key={`received-${m}`}>
                  {formatMoneyByCurrency(
                    summary.monthly_received?.[idx + 1] || 0,
                    "TRY",
                  )}
                </td>
              ))}
            </tr>

            <tr>
              <td style={{ fontWeight: 700 }}>Gelecek</td>
              {monthNames.map((m, idx) => (
                <td key={`upcoming-${m}`}>
                  {formatMoneyByCurrency(
                    summary.monthly_upcoming?.[idx + 1] || 0,
                    "TRY",
                  )}
                </td>
              ))}
            </tr>

            <tr>
              <td style={{ fontWeight: 700 }}>Kesilen Fatura</td>
              {monthNames.map((m, idx) => (
                <td key={`invoiced-${m}`}>
                  {formatMoneyByCurrency(
                    summary.monthly_invoiced?.[idx + 1] || 0,
                    "TRY",
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="tableWrap">
        <h3 className="listTitle">Gelecek Tahsilat Planı</h3>

        <div className="cards" style={{ marginBottom: "18px" }}>
          <div className="card ok statCard">
            <div className="statLabel">Bugün Gelecek</div>
            <div className="statValue">
              {formatMoneyByCurrency(upcomingSummary.today_total || 0, "TRY")}
            </div>
          </div>

          <div className="card bekler statCard">
            <div className="statLabel">Bu Hafta Gelecek</div>
            <div className="statValue">
              {formatMoneyByCurrency(upcomingSummary.week_total || 0, "TRY")}
            </div>
          </div>

          <div
            className="card cancel statCard"
            onClick={handleShowOverdues}
            style={{ cursor: "pointer" }}
          >
            <div className="statLabel">Geciken Ödeme</div>
            <div className="statValue">
              {formatMoneyByCurrency(upcomingSummary.overdue_total || 0, "TRY")}
            </div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Gün</th>
              <th>Tarih</th>
              <th>Gelecek Tutar</th>
            </tr>
          </thead>
          <tbody>
            {upcomingRows.length === 0 ? (
              <EmptyRow colSpan={3} text="Gelecek tahsilat bulunamadı" />
            ) : (
              upcomingRows.map((row, index) => (
                <tr key={index}>
                  <td>{row.day_name || "-"}</td>
                  <td>{formatDateOnly(row.due_date)}</td>
                  <td>
                    {formatMoneyByCurrency(
                      row.amount || 0,
                      row.currency || "TRY",
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h3 className="listTitle">Huawei Payment Kayıtları</h3>

      <div
        className="tableWrap"
        style={{
          maxHeight: "50vh",
          overflowY: "auto",
          overflowX: "auto",
          marginTop: "12px",
        }}
      >
        <table>
          <thead>
            <tr>
              <th
                style={{
                  position: "sticky",
                  top: 0,
                  background: "#f3f4f6",
                  zIndex: 2,
                }}
              >
                Invoice No
              </th>
              <th
                style={{
                  position: "sticky",
                  top: 0,
                  background: "#f3f4f6",
                  zIndex: 2,
                }}
              >
                Invoice Amount
              </th>
              <th
                style={{
                  position: "sticky",
                  top: 0,
                  background: "#f3f4f6",
                  zIndex: 2,
                }}
              >
                Payment Amount
              </th>
              <th
                style={{
                  position: "sticky",
                  top: 0,
                  background: "#f3f4f6",
                  zIndex: 2,
                }}
              >
                Remaining Amount
              </th>
              <th
                style={{
                  position: "sticky",
                  top: 0,
                  background: "#f3f4f6",
                  zIndex: 2,
                }}
              >
                Payment Date
              </th>
              <th
                style={{
                  position: "sticky",
                  top: 0,
                  background: "#f3f4f6",
                  zIndex: 2,
                }}
              >
                Due Date
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedPaymentRows.length === 0 ? (
              <EmptyRow colSpan={6} text="Henüz payment kaydı bulunamadı" />
            ) : (
              sortedPaymentRows.map((row, index) => (
                <tr key={row.id ?? index}>
                  <td>{row.invoice_no || "-"}</td>
                  <td>
                    {formatMoneyByCurrency(
                      row.invoice_amount || 0,
                      row.currency,
                    )}
                  </td>
                  <td>
                    {formatMoneyByCurrency(
                      row.payment_amount || 0,
                      row.currency,
                    )}
                  </td>
                  <td>
                    {formatMoneyByCurrency(
                      row.remaining_amount || 0,
                      row.currency,
                    )}
                  </td>
                  <td>{formatDateOnly(row.payment_date)}</td>

                  <td
                    style={{
                      color:
                        new Date(row.due_date) < new Date() ? "red" : "inherit",
                    }}
                  >
                    {row.due_date ? formatDateOnly(row.due_date) : "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showOverdueModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999,
            padding: "20px",
          }}
          onClick={() => setShowOverdueModal(false)}
        >
          <div
            style={{
              background: "#fff",
              width: "100%",
              maxWidth: "1100px",
              maxHeight: "80vh",
              overflow: "auto",
              borderRadius: "18px",
              padding: "20px",
              boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <h3 className="listTitle" style={{ margin: 0 }}>
                Geciken Faturalar
              </h3>

              <button
                type="button"
                className="tab"
                onClick={() => setShowOverdueModal(false)}
              >
                Kapat
              </button>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Invoice No</th>
                  <th>Fatura Tarihi</th>
                  <th>Beklenen Ödeme Tarihi</th>
                  <th>Terms</th>
                  <th>Tutar</th>
                </tr>
              </thead>

              <tbody>
                {overdueRows.length === 0 ? (
                  <EmptyRow colSpan={5} text="Geciken fatura bulunamadı" />
                ) : (
                  overdueRows.map((row, index) => (
                    <tr key={`${row.invoice_no || "overdue"}-${index}`}>
                      <td>{row.invoice_no || "-"}</td>
                      <td>{formatDateOnly(row.invoice_date)}</td>
                      <td>{formatDateOnly(row.expected_payment_date)}</td>
                      <td>{row.terms || "-"}</td>
                      <td>
                        {formatMoneyByCurrency(
                          row.amount || 0,
                          row.currency || "TRY",
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showInvoiceEntryModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999,
            padding: "20px",
          }}
          onClick={() => {
            setShowInvoiceEntryModal(false);
            setShowInvoiceFormPanel(false);
            setEditingInvoiceId(null);
          }}
        >
          <div
            style={{
              background: "#fff",
              width: "100%",
              maxWidth: "1280px",
              height: "90vh",
              borderRadius: "24px",
              padding: 0,
              boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* HEADER */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "20px 24px",
                borderBottom: "1px solid #e5e7eb",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              <h3 className="listTitle" style={{ margin: 0 }}>
                🧾 Fatura Girişi
              </h3>

              <button
                type="button"
                className="tab"
                onClick={() => {
                  setShowInvoiceEntryModal(false);
                  setShowInvoiceFormPanel(false);
                  setEditingInvoiceId(null);
                }}
              >
                Kapat
              </button>
            </div>

            {/* TOOLBAR */}
            <div
              style={{
                padding: "16px 24px",
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                gap: "12px",
                flexWrap: "wrap",
                alignItems: "center",
                background: "#f8fafc",
                flexShrink: 0,
              }}
            >
              <input
                type="text"
                value={manualInvoiceSearch}
                onChange={(e) => setManualInvoiceSearch(e.target.value)}
                placeholder="Tedarikçi / fatura no / proje / site / PO ara"
                style={{
                  flex: "1 1 360px",
                  minWidth: "280px",
                }}
              />

              <select
                value={manualInvoiceStatusFilter}
                onChange={(e) => setManualInvoiceStatusFilter(e.target.value)}
                style={{ minWidth: "180px" }}
              >
                <option value="ALL">Tüm Durumlar</option>
                <option value="BEKLIYOR">Bekleyenler</option>
                <option value="ODENDI">Ödenenler</option>
              </select>

              <button
                type="button"
                className="tab"
                onClick={handleExportInvoiceDatabase}
              >
                Excel İndir
              </button>

              <button
                type="button"
                className="saveButton"
                onClick={() => {
                  setEditingInvoiceId(null);
                  setInvoiceForm({
                    bolge: "",
                    proje: "",
                    proje_kodu: "",
                    fatura_no: "",
                    fatura_tarihi: "",
                    tedarikci: "",
                    rf_montaj_firma: "",
                    fatura_kalemi: "",
                    is_kalemi: "",
                    po_no: "",
                    site_id: "",
                    tutar: "",
                    kdv: "",
                    toplam_tutar: "",
                    odenen_tutar: "",
                    kalan_borc: "",
                    note: "",
                  });
                  setShowInvoiceFormPanel(true);
                }}
              >
                Yeni Fatura Gir
              </button>
            </div>

            {/* SUMMARY */}
            <div
              style={{
                padding: "16px 24px",
                display: "flex",
                gap: "12px",
                flexWrap: "wrap",
                borderBottom: "1px solid #e5e7eb",
                flexShrink: 0,
              }}
            >
              <div className="card ok statCard" style={{ minWidth: "220px" }}>
                <div className="statLabel">Toplam Tutar</div>
                <div className="statValue">
                  {formatMoneyByCurrency(
                    manualInvoiceSummary.totalAmount || 0,
                    "TRY",
                  )}
                </div>
              </div>

              <div
                className="card bekler statCard"
                style={{ minWidth: "220px" }}
              >
                <div className="statLabel">Toplam Ödenen</div>
                <div className="statValue">
                  {formatMoneyByCurrency(
                    manualInvoiceSummary.totalPaid || 0,
                    "TRY",
                  )}
                </div>
              </div>

              <div
                className="card cancel statCard"
                style={{ minWidth: "220px" }}
              >
                <div className="statLabel">Kalan Borç</div>
                <div className="statValue">
                  {formatMoneyByCurrency(
                    manualInvoiceSummary.totalRemaining || 0,
                    "TRY",
                  )}
                </div>
              </div>
            </div>

            {/* TABLE */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflow: "auto",
                padding: "16px 24px 24px 24px",
              }}
            >
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr>
                      <th>Bölge</th>
                      <th>Proje</th>
                      <th>Proje Kodu</th>
                      <th>Fatura No</th>
                      <th>Fatura Tarihi</th>
                      <th>Tedarikçi</th>
                      <th>PO No</th>
                      <th>Site ID</th>
                      <th>Toplam</th>
                      <th>Ödenen</th>
                      <th>Kalan</th>
                      <th>İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredManualInvoiceRows.length === 0 ? (
                      <EmptyRow colSpan={12} text="Kayıt bulunamadı" />
                    ) : (
                      filteredManualInvoiceRows.map((row, index) => (
                        <tr key={row.id ?? index}>
                          <td>{row.bolge || "-"}</td>
                          <td>{row.proje || "-"}</td>
                          <td>{row.proje_kodu || "-"}</td>
                          <td>{row.fatura_no || "-"}</td>
                          <td>{formatDateOnly(row.fatura_tarihi)}</td>
                          <td>{row.tedarikci || "-"}</td>
                          <td>{row.po_no || "-"}</td>
                          <td>{row.site_id || "-"}</td>
                          <td>{formatTRY(row.toplam_tutar || 0)}</td>
                          <td>{formatTRY(row.odenen_tutar || 0)}</td>
                          <td>{formatTRY(row.kalan_borc || 0)}</td>
                          <td>
                            <div style={{ display: "flex", gap: "8px" }}>
                              <button
                                type="button"
                                className="tab"
                                onClick={() => {
                                  handleEditManualInvoice(row);
                                  setShowInvoiceFormPanel(true);
                                }}
                              >
                                Düzenle
                              </button>

                              <button
                                type="button"
                                className="tab danger"
                                onClick={() => handleDeleteManualInvoice(row)}
                              >
                                Sil
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* FORM PANEL */}
            {showInvoiceFormPanel && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(255,255,255,0.96)",
                  zIndex: 20,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "20px 24px",
                    borderBottom: "1px solid #e5e7eb",
                    flexShrink: 0,
                  }}
                >
                  <h3 className="listTitle" style={{ margin: 0 }}>
                    {editingInvoiceId
                      ? "🧾 Fatura Düzenle"
                      : "🧾 Yeni Fatura Girişi"}
                  </h3>

                  <button
                    type="button"
                    className="tab"
                    onClick={() => {
                      setShowInvoiceFormPanel(false);
                      setEditingInvoiceId(null);
                    }}
                  >
                    Geri Dön
                  </button>
                </div>

                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    padding: "24px",
                  }}
                >
                  <form onSubmit={handleSaveManualInvoice}>
                    <div className="formGrid">
                      <div className="formGroup">
                        <label>Bölge</label>
                        <input
                          name="bolge"
                          value={invoiceForm.bolge}
                          onChange={handleInvoiceFormChange}
                          placeholder="Antalya / İzmir / Ankara"
                        />
                      </div>

                      <div className="formGroup">
                        <label>Proje</label>
                        <input
                          name="proje"
                          value={invoiceForm.proje}
                          onChange={handleInvoiceFormChange}
                          placeholder="TT / TC"
                        />
                      </div>

                      <div className="formGroup">
                        <label>Proje Kodu</label>
                        <input
                          name="proje_kodu"
                          value={invoiceForm.proje_kodu}
                          onChange={handleInvoiceFormChange}
                          placeholder="56A0QEF"
                        />
                      </div>

                      <div className="formGroup">
                        <label>Fatura No</label>
                        <input
                          name="fatura_no"
                          value={invoiceForm.fatura_no}
                          onChange={handleInvoiceFormChange}
                          placeholder="Fatura no"
                        />
                      </div>

                      <div className="formGroup">
                        <label>Fatura Tarihi</label>
                        <input
                          type="date"
                          name="fatura_tarihi"
                          value={invoiceForm.fatura_tarihi}
                          onChange={handleInvoiceFormChange}
                        />
                      </div>

                      <div className="formGroup">
                        <label>Tedarikçi</label>
                        <input
                          name="tedarikci"
                          value={invoiceForm.tedarikci}
                          onChange={handleInvoiceFormChange}
                          placeholder="Firma / Tedarikçi"
                        />
                      </div>

                      <div className="formGroup">
                        <label>Fatura Kalemi</label>
                        <input
                          name="fatura_kalemi"
                          value={invoiceForm.fatura_kalemi}
                          onChange={handleInvoiceFormChange}
                          placeholder="Örn: Oda/Room (Konaklama)"
                        />
                      </div>

                      <div className="formGroup">
                        <label>İş Kalemi</label>
                        <input
                          name="is_kalemi"
                          value={invoiceForm.is_kalemi}
                          onChange={handleInvoiceFormChange}
                          placeholder="Örn: KONAKLAMA / PROJE"
                        />
                      </div>

                      <div className="formGroup">
                        <label>PO No</label>
                        <input
                          name="po_no"
                          value={invoiceForm.po_no}
                          onChange={handleInvoiceFormChange}
                          placeholder="PO numarası"
                        />
                      </div>

                      <div className="formGroup">
                        <label>Site ID</label>
                        <input
                          name="site_id"
                          value={invoiceForm.site_id}
                          onChange={handleInvoiceFormChange}
                          placeholder="BU8944"
                        />
                      </div>

                      <div className="formGroup">
                        <label>Tutar (₺)</label>
                        <input
                          type="number"
                          step="0.01"
                          name="tutar"
                          value={invoiceForm.tutar}
                          onChange={handleInvoiceFormChange}
                          placeholder="0"
                        />
                      </div>

                      <div className="formGroup">
                        <label>KDV (₺)</label>
                        <input
                          type="number"
                          step="0.01"
                          name="kdv"
                          value={invoiceForm.kdv}
                          onChange={handleInvoiceFormChange}
                          placeholder="0"
                        />
                      </div>

                      <div className="formGroup">
                        <label>Toplam Tutar (₺)</label>
                        <input
                          type="number"
                          step="0.01"
                          name="toplam_tutar"
                          value={invoiceForm.toplam_tutar}
                          onChange={handleInvoiceFormChange}
                          placeholder="0"
                        />
                      </div>

                      <div className="formGroup">
                        <label>Ödenen Tutar (₺)</label>
                        <input
                          type="number"
                          step="0.01"
                          name="odenen_tutar"
                          value={invoiceForm.odenen_tutar}
                          onChange={handleInvoiceFormChange}
                          placeholder="0"
                        />
                      </div>

                      <div className="formGroup">
                        <label>Kalan Borç (₺)</label>
                        <input
                          type="number"
                          step="0.01"
                          name="kalan_borc"
                          value={invoiceForm.kalan_borc}
                          onChange={handleInvoiceFormChange}
                          placeholder="0"
                        />
                      </div>

                      <div className="formGroup">
                        <label>RF Montaj Firma</label>
                        <input
                          name="rf_montaj_firma"
                          value={invoiceForm.rf_montaj_firma}
                          onChange={handleInvoiceFormChange}
                          placeholder="Subcon Name ile aynı firma adı"
                        />
                      </div>

                      <div className="formGroup formGroupWide">
                        <label>Not</label>
                        <textarea
                          name="note"
                          value={invoiceForm.note}
                          onChange={handleInvoiceFormChange}
                          placeholder="Not"
                          rows={3}
                        />
                      </div>
                    </div>

                    <div
                      className="entryActions"
                      style={{
                        justifyContent: "flex-end",
                        display: "flex",
                        gap: "10px",
                        marginTop: "16px",
                      }}
                    >
                      <button
                        type="button"
                        className="tab"
                        onClick={() => {
                          setShowInvoiceFormPanel(false);
                          setEditingInvoiceId(null);
                        }}
                      >
                        Vazgeç
                      </button>

                      <button type="submit" className="saveButton">
                        {editingInvoiceId ? "Güncelle" : "Faturayı Kaydet"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showSubconModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999,
            padding: "20px",
          }}
          onClick={() => setShowSubconModal(false)}
        >
          <div
            style={{
              background: "#fff",
              width: "100%",
              maxWidth: "1100px",
              maxHeight: "85vh",
              overflow: "auto",
              borderRadius: "20px",
              padding: "24px",
              boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "18px",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <h3 className="listTitle" style={{ margin: 0 }}>
                RF Subcon Ödeme Durumu
              </h3>

              <button
                type="button"
                className="tab"
                onClick={() => setShowSubconModal(false)}
              >
                Kapat
              </button>
            </div>

            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Subcon</th>
                    <th>Fatura Tutarı (KDV Dahil)</th>
                    <th>Yapılan Ödeme</th>
                    <th>Kalan Ödeme</th>
                  </tr>
                </thead>
                <tbody>
                  {subconRows.length === 0 ? (
                    <EmptyRow
                      colSpan={4}
                      text="Taşeron ödeme kaydı bulunamadı"
                    />
                  ) : (
                    subconRows.map((row, index) => (
                      <tr key={row.id ?? index}>
                        <td>{row.subcon_name || "-"}</td>
                        <td>
                          {formatMoneyByCurrency(
                            row.invoice_amount || 0,
                            "TRY",
                          )}
                        </td>
                        <td>
                          {formatMoneyByCurrency(row.paid_amount || 0, "TRY")}
                        </td>
                        <td>
                          {formatMoneyByCurrency(
                            row.remaining_amount || 0,
                            "TRY",
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showSalaryModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999,
            padding: "20px",
          }}
          onClick={() => setShowSalaryModal(false)}
        >
          <div
            style={{
              background: "#fff",
              width: "100%",
              maxWidth: "1100px",
              maxHeight: "85vh",
              overflow: "auto",
              borderRadius: "20px",
              padding: "24px",
              boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* HEADER */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
                flexWrap: "wrap",
                marginBottom: "18px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  flexWrap: "wrap",
                }}
              >
                <h3 className="listTitle" style={{ margin: 0 }}>
                  👤 Maaş & Avans Takibi
                </h3>

                <label className="tab smallTab" style={{ cursor: "pointer" }}>
                  {personelUploadLoading
                    ? "Yükleniyor..."
                    : "Personel Maaş Güncelle"}
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handlePersonelExcelUpload}
                    style={{ display: "none" }}
                  />
                </label>

                <button
                  type="button"
                  className="tab smallTab"
                  onClick={handleExportSalaryExcel}
                >
                  Excel İndir
                </button>
              </div>

              <button
                type="button"
                className="tab"
                onClick={() => setShowSalaryModal(false)}
              >
                Kapat
              </button>
            </div>

            <div
              style={{
                display: "flex",
                gap: "12px",
                flexWrap: "wrap",
                alignItems: "end",
                marginBottom: "20px",
                padding: "16px",
                border: "1px solid #e5e7eb",
                borderRadius: "16px",
                background: "#f8fafc",
              }}
            >
              <div style={{ flex: "2 1 260px", position: "relative" }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: "6px",
                    fontWeight: 600,
                  }}
                >
                  Personel Filtrele
                </label>

                <input
                  type="text"
                  value={salaryFilterPersonel}
                  onChange={(e) => {
                    setSalaryFilterPersonel(e.target.value);
                    setShowPersonFilterList(true);
                  }}
                  onFocus={() => setShowPersonFilterList(true)}
                  placeholder="Ad soyad veya ünvan ara"
                  style={{ width: "100%" }}
                />

                {showPersonFilterList && (
                  <div
                    style={{
                      position: "absolute",
                      top: "78px",
                      left: 0,
                      right: 0,
                      background: "#fff",
                      border: "1px solid #d1d5db",
                      borderRadius: "12px",
                      boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
                      zIndex: 50,
                      maxHeight: "220px",
                      overflowY: "auto",
                    }}
                  >
                    {filteredPersonnelMaster.length === 0 ? (
                      <div
                        style={{
                          padding: "12px 14px",
                          color: "#6b7280",
                        }}
                      >
                        Sonuç bulunamadı
                      </div>
                    ) : (
                      filteredPersonnelMaster.map((p, i) => (
                        <div
                          key={i}
                          onMouseDown={() => {
                            setSalaryFilterPersonel(p.ad_soyad || "");
                            setSelectedPerson(p.ad_soyad || "");
                            setShowPersonFilterList(false);

                            setSalaryForm((prev) => ({
                              ...prev,
                              ad_soyad: p.ad_soyad || "",
                              unvan: p.unvan || "",
                              net_maas: String(p.net_maas || 0),
                              bankaya_yatacak_net: String(
                                p.banka_net_maas || 0,
                              ),
                              elden_odenecek_net: String(p.elden_net_maas || 0),
                              toplam_isveren_maliyeti: String(
                                p.aylik_isveren_maliyeti || 0,
                              ),
                            }));
                          }}
                          style={{
                            padding: "12px 14px",
                            cursor: "pointer",
                            borderBottom:
                              i !== filteredPersonnelMaster.length - 1
                                ? "1px solid #f1f5f9"
                                : "none",
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>{p.ad_soyad}</div>
                          <div style={{ fontSize: "13px", color: "#6b7280" }}>
                            {p.unvan || "-"}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div style={{ flex: "1 1 160px" }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: "6px",
                    fontWeight: 600,
                  }}
                >
                  Ay
                </label>
                <select
                  value={salaryFilterMonth}
                  onChange={(e) => setSalaryFilterMonth(e.target.value)}
                  style={{ width: "100%" }}
                >
                  {monthOptions.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ flex: "1 1 160px" }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: "6px",
                    fontWeight: 600,
                  }}
                >
                  Yıl
                </label>
                <select
                  value={salaryFilterYear}
                  onChange={(e) => setSalaryFilterYear(e.target.value)}
                  style={{ width: "100%" }}
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ flex: "0 1 auto" }}>
                <button
                  type="button"
                  className="tab"
                  onClick={() => {
                    setSalaryFilterPersonel("");
                    setSalaryFilterMonth(
                      String(new Date().getMonth() + 1).padStart(2, "0"),
                    );
                    setSalaryFilterYear(String(new Date().getFullYear()));
                    setShowPersonFilterList(false);
                  }}
                >
                  Filtreyi Temizle
                </button>
              </div>
            </div>

            <div
              style={{
                marginBottom: "20px",
                display: "flex",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  minWidth: "280px",
                  background: "#fff7ed",
                  border: "1px solid #fdba74",
                  borderRadius: "18px",
                  padding: "18px 20px",
                  boxShadow: "0 4px 14px rgba(0,0,0,0.04)",
                }}
              >
                <div
                  style={{
                    fontSize: "15px",
                    fontWeight: 700,
                    color: "#9a3412",
                    marginBottom: "8px",
                  }}
                >
                  Bu Ay Ödenmesi Gereken Bakiye
                </div>

                <div
                  style={{
                    fontSize: "30px",
                    fontWeight: 800,
                    color: "#c2410c",
                  }}
                >
                  {formatTRY(salaryRemainingSummary)}
                </div>

                <div
                  style={{
                    marginTop: "6px",
                    fontSize: "13px",
                    color: "#7c2d12",
                  }}
                >
                  Seçili ay ve yıla göre kalan net ödeme toplamı
                </div>
              </div>
            </div>

            {/* FORM */}
            <div className="formGrid">
              <div className="formGroup">
                <label>Personel</label>
                <select
                  value={selectedPerson}
                  onChange={(e) => {
                    const name = e.target.value;
                    setSelectedPerson(name);

                    const person = personnelMaster.find(
                      (p) => p.ad_soyad === name,
                    );

                    if (person) {
                      setSalaryForm((prev) => ({
                        ...prev,
                        ad_soyad: person.ad_soyad || "",
                        unvan: person.unvan || "",
                        net_maas: String(person.net_maas || 0),
                        bankaya_yatacak_net: String(person.banka_net_maas || 0),
                        elden_odenecek_net: String(person.elden_net_maas || 0),
                        toplam_isveren_maliyeti: String(
                          person.aylik_isveren_maliyeti || 0,
                        ),
                      }));
                    }
                  }}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: "10px",
                    border: "1px solid #ddd",
                  }}
                >
                  <option value="">Personel Seç</option>
                  {filteredPersonnelMaster.length === 0 ? (
                    <option value="" disabled>
                      Sonuç bulunamadı
                    </option>
                  ) : (
                    filteredPersonnelMaster.map((p, i) => (
                      <option key={i} value={p.ad_soyad}>
                        {p.ad_soyad} {p.unvan ? `- ${p.unvan}` : ""}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="formGroup">
                <label>Ünvan</label>
                <input
                  value={salaryForm.unvan}
                  onChange={(e) =>
                    setSalaryForm((prev) => ({
                      ...prev,
                      unvan: e.target.value,
                    }))
                  }
                  placeholder="Ekip Şefi"
                />
              </div>

              <div className="formGroup">
                <label>Net Maaş</label>
                <input
                  type="text"
                  value={formatTLInput(salaryForm.net_maas)}
                  onChange={(e) =>
                    setSalaryForm((prev) => ({
                      ...prev,
                      net_maas: parseTLInput(e.target.value),
                    }))
                  }
                  placeholder="₺0"
                />
              </div>

              <div className="formGroup">
                <label>Bu Ay Verilen Avans</label>
                <input
                  type="text"
                  value={formatTLInput(salaryForm.avans)}
                  onChange={(e) =>
                    setSalaryForm((prev) => ({
                      ...prev,
                      avans: parseTLInput(e.target.value),
                    }))
                  }
                  placeholder="₺0"
                />
              </div>

              <div className="formGroup">
                <label>Kalan Net Ödeme</label>
                <input
                  type="text"
                  value={formatTLInput(salaryForm.kalan_net_odeme)}
                  readOnly
                  placeholder="₺0"
                />
              </div>

              <div className="formGroup">
                <label>Bankaya Yatacak Net</label>
                <input
                  type="text"
                  value={formatTLInput(salaryForm.bankaya_yatacak_net)}
                  readOnly
                  placeholder="₺0"
                />
              </div>

              <div className="formGroup">
                <label>Elden Ödenecek Net</label>
                <input
                  type="text"
                  value={formatTLInput(salaryForm.elden_odenecek_net)}
                  onChange={(e) =>
                    setSalaryForm((prev) => ({
                      ...prev,
                      elden_odenecek_net: parseTLInput(e.target.value),
                    }))
                  }
                  placeholder="₺0"
                />
              </div>

              <div className="formGroup">
                <label>Banka Maliyeti</label>
                <input
                  type="text"
                  value={formatTLInput(salaryForm.banka_maliyeti)}
                  onChange={(e) =>
                    setSalaryForm((prev) => ({
                      ...prev,
                      banka_maliyeti: parseTLInput(e.target.value),
                    }))
                  }
                  placeholder="₺0"
                />
              </div>

              <div className="formGroup">
                <label>Toplam İşveren Maliyeti</label>
                <input
                  type="text"
                  value={formatTLInput(salaryForm.toplam_isveren_maliyeti)}
                  readOnly
                  placeholder="₺0"
                />
              </div>

              <div className="formGroup">
                <label>Dönem</label>

                <div style={{ display: "flex", gap: "10px" }}>
                  <select
                    value={selectedMonth}
                    onChange={(e) =>
                      setSalaryForm((prev) => ({
                        ...prev,
                        ay: `${selectedYear}-${e.target.value}`,
                      }))
                    }
                    style={{ flex: 1 }}
                  >
                    {monthOptions.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={selectedYear}
                    onChange={(e) =>
                      setSalaryForm((prev) => ({
                        ...prev,
                        ay: `${e.target.value}-${selectedMonth}`,
                      }))
                    }
                    style={{ flex: 1 }}
                  >
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="formGroup formGroupWide">
                <label>Not</label>
                <textarea
                  rows={3}
                  value={salaryForm.note}
                  onChange={(e) =>
                    setSalaryForm((prev) => ({
                      ...prev,
                      note: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            {/* BUTTON */}
            <div className="entryActions">
              <button
                type="button"
                className="saveButton"
                onClick={handleSaveSalary}
              >
                {editingSalaryId ? "Güncelle" : "Kaydet"}
              </button>
            </div>

            <div className="tableWrap" style={{ marginTop: "20px" }}>
              <h3 className="listTitle">Maaş & Avans Kayıtları</h3>

              <table>
                <thead>
                  <tr>
                    <th>Personel</th>
                    <th>Ünvan</th>
                    <th>Dönem</th>
                    <th>Net Maaş</th>
                    <th>Avans</th>
                    <th>Kalan</th>
                    <th>Durum</th>
                    <th>İşlem</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredSalaryRows.length === 0 ? (
                    <EmptyRow colSpan={8} text="Kayıt yok" />
                  ) : (
                    filteredSalaryRows.map((row, i) => {
                      const status = getSalaryStatus(row);

                      return (
                        <tr key={row.id ?? i}>
                          <td>{row.ad_soyad}</td>
                          <td>{row.unvan}</td>
                          <td>{formatDonemLabel(row.ay)}</td>
                          <td>{formatTRY(row.net_maas)}</td>
                          <td>{formatTRY(row.avans)}</td>
                          <td>{formatTRY(row.kalan_net_odeme)}</td>

                          <td>
                            <span className={`badge ${status.className}`}>
                              {status.text}
                            </span>
                          </td>

                          <td>
                            <button
                              className="tab"
                              onClick={() => handleEditSalary(row)}
                            >
                              Düzenle
                            </button>

                            <button
                              className="tab danger"
                              onClick={() => handleDeleteSalary(row)}
                            >
                              Sil
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {advanceModalOpen && (
        <div
          onClick={() => {
            setAdvanceModalOpen(false);
            setShowSupplierSuggestions(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "20px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "760px",
              background: "#fff",
              borderRadius: "20px",
              padding: "24px",
              boxShadow: "0 20px 50px rgba(0,0,0,0.18)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "18px",
              }}
            >
              <h2 style={{ margin: 0 }}>💸 Avans Gir</h2>
              <button
                type="button"
                className="tab"
                onClick={() => setAdvanceModalOpen(false)}
              >
                Kapat
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "14px",
              }}
            >
              <div style={{ gridColumn: "1 / span 2" }}>
                <label style={{ fontWeight: 600 }}>Tedarikçi</label>
                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    value={advanceForm.supplier_name}
                    onChange={(e) => {
                      const value = e.target.value;

                      setAdvanceForm((prev) => ({
                        ...prev,
                        supplier_name: value,
                      }));

                      const filtered = (manualInvoiceRows || [])
                        .map((x) => x.tedarikci)
                        .filter(Boolean)
                        .filter((v, i, arr) => arr.indexOf(v) === i)
                        .filter((name) =>
                          name.toLowerCase().includes(value.toLowerCase()),
                        );

                      setSupplierSuggestions(value ? filtered.slice(0, 8) : []);
                    }}
                    onFocus={() => {
                      filterSupplierSuggestions(advanceForm.supplier_name);
                      setShowSupplierSuggestions(true);
                    }}
                    placeholder="Tedarikçi adı"
                  />

                  {supplierSuggestions.length > 0 && (
                    <div
                      style={{
                        border: "1px solid #ddd",
                        borderRadius: "10px",
                        marginTop: "6px",
                        background: "#fff",
                        maxHeight: "180px",
                        overflowY: "auto",
                        boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
                      }}
                    >
                      {supplierSuggestions.map((name, i) => (
                        <div
                          key={i}
                          style={{
                            padding: "10px 12px",
                            cursor: "pointer",
                            borderBottom:
                              i !== supplierSuggestions.length - 1
                                ? "1px solid #f1f1f1"
                                : "none",
                          }}
                          onClick={() => {
                            setAdvanceForm((prev) => ({
                              ...prev,
                              supplier_name: name,
                            }));
                            setSupplierSuggestions([]);
                          }}
                        >
                          {name}
                        </div>
                      ))}
                    </div>
                  )}

                  {showSupplierSuggestions &&
                    supplierSuggestions.length > 0 && (
                      <div
                        style={{
                          position: "absolute",
                          top: "100%",
                          left: 0,
                          right: 0,
                          marginTop: "6px",
                          background: "#fff",
                          border: "1px solid #d1d5db",
                          borderRadius: "12px",
                          boxShadow: "0 10px 24px rgba(0,0,0,0.10)",
                          maxHeight: "220px",
                          overflowY: "auto",
                          zIndex: 10000,
                        }}
                      >
                        {supplierSuggestions.map((name, index) => (
                          <div
                            key={`${name}-${index}`}
                            onMouseDown={() => {
                              setAdvanceForm((prev) => ({
                                ...prev,
                                supplier_name: name,
                              }));
                              setShowSupplierSuggestions(false);
                            }}
                            style={{
                              padding: "10px 12px",
                              cursor: "pointer",
                              borderBottom:
                                index !== supplierSuggestions.length - 1
                                  ? "1px solid #f1f5f9"
                                  : "none",
                            }}
                          >
                            {name}
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              </div>

              <div>
                <label style={{ fontWeight: 600 }}>Tutar (₺)</label>
                <input
                  type="number"
                  value={advanceForm.amount}
                  onChange={(e) =>
                    setAdvanceForm((prev) => ({
                      ...prev,
                      amount: e.target.value,
                    }))
                  }
                  placeholder="0"
                />
              </div>

              <div>
                <label style={{ fontWeight: 600 }}>Ödeme Tarihi</label>
                <input
                  type="date"
                  value={advanceForm.payment_date}
                  onChange={(e) =>
                    setAdvanceForm((prev) => ({
                      ...prev,
                      payment_date: e.target.value,
                    }))
                  }
                />
              </div>

              <div>
                <label style={{ fontWeight: 600 }}>Project Code</label>
                <input
                  type="text"
                  value={advanceForm.project_code}
                  onChange={(e) =>
                    setAdvanceForm((prev) => ({
                      ...prev,
                      project_code: e.target.value,
                    }))
                  }
                  placeholder="56A0QEF"
                />
              </div>

              <div>
                <label style={{ fontWeight: 600 }}>Bölge</label>
                <input
                  type="text"
                  value={advanceForm.region}
                  onChange={(e) =>
                    setAdvanceForm((prev) => ({
                      ...prev,
                      region: e.target.value,
                    }))
                  }
                  placeholder="ANKARA / İZMİR / ANTALYA"
                />
              </div>

              <div style={{ gridColumn: "1 / span 2" }}>
                <label style={{ fontWeight: 600 }}>Not</label>
                <textarea
                  value={advanceForm.note}
                  onChange={(e) =>
                    setAdvanceForm((prev) => ({
                      ...prev,
                      note: e.target.value,
                    }))
                  }
                  placeholder="Açıklama"
                  rows={4}
                />
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "20px",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  background: "#fee2e2",
                  color: "#991b1b",
                  padding: "12px 16px",
                  borderRadius: "14px",
                  fontWeight: 700,
                }}
              >
                Toplam Avans:{" "}
                {formatMoneyByCurrency(supplierAdvanceTotal || 0, "TRY")}
              </div>

              <button
                type="button"
                className="saveButton"
                onClick={handleApplyAdvance}
              >
                Avansı Kaydet
              </button>
            </div>

            {supplierAdvances?.length > 0 && (
              <div style={{ marginTop: "22px" }}>
                <h3 style={{ marginBottom: "10px" }}>
                  Taşeron Avans Hareketleri
                </h3>
                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Tedarikçi</th>
                        <th>Tutar</th>
                        <th>Project Code</th>
                        <th>Bölge</th>
                        <th>Kullanıcı</th>
                        <th>Tarih</th>
                        <th>Not</th>
                      </tr>
                    </thead>
                    <tbody>
                      {supplierAdvances.map((row, index) => (
                        <tr key={row.id || index}>
                          <td>{row.supplier_name || "-"}</td>
                          <td>
                            {formatMoneyByCurrency(row.amount || 0, "TRY")}
                          </td>
                          <td>{row.project_code || "-"}</td>
                          <td>{row.region || "-"}</td>
                          <td>{row.created_by || "-"}</td>
                          <td>{row.payment_date || "-"}</td>
                          <td>{row.note || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showSubconSummaryModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
            overflowY: "auto",
            zIndex: 9999,
            padding: "20px",
          }}
          onClick={() => setShowSubconSummaryModal(false)}
        >
          <div
            style={{
              background: "#fff",
              width: "100%",
              maxWidth: "1200px",
              maxHeight: "85vh",
              overflowY: "auto",
              overflowX: "hidden",
              borderRadius: "20px",
              padding: "24px",
              boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* SAĞ TARAF */}

            <div style={{ marginBottom: "18px" }}>
              {/* 1. SATIR */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  alignItems: "center",
                  gap: "16px",
                  marginBottom: "14px",
                }}
              >
                {/* SOL */}
                <h3 className="listTitle" style={{ margin: 0 }}>
                  Taşeron Bazlı İş Tamamlama & Faturalama Özeti
                </h3>

                {/* ORTA */}
                <div
                  style={{ display: "flex", gap: "12px", alignItems: "center" }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#0e7490",
                      background: "#ecfeff",
                      border: "1px solid #67e8f9",
                      padding: "6px 10px",
                      borderRadius: "8px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    USD/TRY: {usdTryRate ? usdTryRate.toFixed(4) : "-"}
                  </div>

                  <input
                    type="text"
                    placeholder="Taşeron ara..."
                    value={subconFilter}
                    onChange={(e) => setSubconFilter(e.target.value)}
                    style={{
                      width: "220px",
                      padding: "10px",
                      borderRadius: "8px",
                      border: "1px solid #ddd",
                    }}
                  />
                </div>

                {/* SAĞ */}
                <div
                  style={{
                    display: "flex",
                    gap: "10px",
                    justifyContent: "flex-end",
                    whiteSpace: "nowrap",
                  }}
                >
                  <button
                    type="button"
                    className="tab"
                    onClick={handleExportFilteredSubconExcel}
                  >
                    Excel İndir
                  </button>

                  <button
                    type="button"
                    className="tab"
                    onClick={() => setShowSubconSummaryModal(false)}
                  >
                    Kapat
                  </button>
                </div>
              </div>

              {/* 2. SATIR (KARTLAR) */}
              {selectedSubcontractor && subcontractorPeriodStats && (
                <div
                  style={{
                    display: "flex",
                    gap: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      background: "#16a34a",
                      color: "#fff",
                      padding: "10px 14px",
                      borderRadius: "10px",
                      minWidth: "150px",
                    }}
                  >
                    <div style={{ fontSize: "12px" }}>Bu Hafta</div>
                    <div style={{ fontSize: "16px", fontWeight: 700 }}>
                      {formatMoneyByCurrency(
                        subcontractorPeriodStats.weekDoneQty || 0,
                        "TRY",
                      )}
                    </div>
                    <div style={{ fontSize: "12px" }}>
                      {subcontractorPeriodStats.weekJobCount || 0} kayıt
                    </div>
                  </div>

                  <div
                    style={{
                      background: "#f97316",
                      color: "#fff",
                      padding: "10px 14px",
                      borderRadius: "10px",
                      minWidth: "150px",
                    }}
                  >
                    <div style={{ fontSize: "12px" }}>Bu Ay</div>
                    <div style={{ fontSize: "16px", fontWeight: 700 }}>
                      {formatMoneyByCurrency(
                        subcontractorPeriodStats.monthDoneQty || 0,
                        "TRY",
                      )}
                    </div>
                    <div style={{ fontSize: "12px" }}>
                      {subcontractorPeriodStats.monthJobCount || 0} kayıt
                    </div>
                  </div>

                  <div
                    style={{
                      background: "#1f2937",
                      color: "#fff",
                      padding: "10px 14px",
                      borderRadius: "10px",
                      minWidth: "150px",
                    }}
                  >
                    <div style={{ fontSize: "12px" }}>Toplam</div>
                    <div style={{ fontSize: "16px", fontWeight: 700 }}>
                      {formatMoneyByCurrency(
                        selectedSubcontractorSummary?.total_hakedis || 0,
                        "TRY",
                      )}
                    </div>
                    <div style={{ fontSize: "12px" }}>genel toplam</div>
                  </div>
                </div>
              )}
            </div>

            <div
              className="tableWrap"
              style={{
                maxHeight: "55vh",
                overflowY: "auto",
                overflowX: "auto",
                marginTop: "12px",
              }}
            >
              <table>
                <thead>
                  <tr>
                    <th>Taşeron</th>
                    <th>Tamamlanan İş Bedeli</th>
                    <th>HW’ye Kesilen Fatura Bedeli</th>
                    <th>Kestiği Fatura</th>
                    <th>Ödenen</th>
                    <th>Kalan Borç</th>
                    <th>Fazla Ödeme</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredSubconSummaryRows.length === 0 ? (
                    <EmptyRow colSpan={7} text="Taşeron özeti bulunamadı" />
                  ) : (
                    <>
                      {filteredSubconSummaryRows.map((row, index) => (
                        <tr
                          key={`${row.subcon_name}-${index}`}
                          onClick={() =>
                            setSelectedSubcontractor(row.subcon_name || "")
                          }
                          style={{ cursor: "pointer" }}
                        >
                          <td>{row.subcon_name || "-"}</td>
                          <td>
                            {formatMoneyByCurrency(
                              row.total_hakedis || 0,
                              "TRY",
                            )}
                          </td>
                          <td>
                            {formatMoneyByCurrency(
                              row.total_faturaya_hazir || 0,
                              "TRY",
                            )}
                          </td>
                          <td>
                            {formatMoneyByCurrency(
                              row.total_fatura || 0,
                              "TRY",
                            )}
                          </td>
                          <td>
                            {formatMoneyByCurrency(
                              row.total_odenen || 0,
                              "TRY",
                            )}
                          </td>
                          <td
                            style={{
                              color:
                                Number(row.kalan_borc || 0) > 0
                                  ? "#b45309"
                                  : "#111827",
                              fontWeight: 700,
                            }}
                          >
                            {formatMoneyByCurrency(row.kalan_borc || 0, "TRY")}
                          </td>
                          <td
                            style={{
                              color:
                                Number(row.fazla_odeme || 0) > 0
                                  ? "#dc2626"
                                  : "#111827",
                              fontWeight: 700,
                            }}
                          >
                            {formatMoneyByCurrency(row.fazla_odeme || 0, "TRY")}
                          </td>
                        </tr>
                      ))}

                      <tr style={{ fontWeight: 800, background: "#f3f4f6" }}>
                        <td>TOPLAM</td>
                        <td>
                          {formatMoneyByCurrency(totalRow.total_hakedis, "TRY")}
                        </td>
                        <td>
                          {formatMoneyByCurrency(
                            totalRow.total_faturaya_hazir,
                            "TRY",
                          )}
                        </td>
                        <td>
                          {formatMoneyByCurrency(totalRow.total_fatura, "TRY")}
                        </td>
                        <td>
                          {formatMoneyByCurrency(totalRow.total_odenen, "TRY")}
                        </td>
                        <td>
                          {formatMoneyByCurrency(totalRow.kalan_borc, "TRY")}
                        </td>
                        <td>
                          {formatMoneyByCurrency(totalRow.fazla_odeme, "TRY")}
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function parseTurkishNumber(value) {
  if (!value) return 0;

  return Number(
    String(value)
      .replace(/\./g, "") // 1.000.000 → 1000000
      .replace(",", "."), // 123,45 → 123.45
  );
}

function formatNumber(value) {
  return new Intl.NumberFormat("tr-TR").format(Number(value || 0));
}

function formatTRY(value) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function RegionAnalysis() {
  const [filterText, setFilterText] = useState("");
  const [regionSearch, setRegionSearch] = useState("");
  const [sortConfig, setSortConfig] = useState({
    key: null,
    direction: "asc",
  });
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailTitle, setDetailTitle] = useState("");
  const [detailRows, setDetailRows] = useState([]);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const usdRate = useUsdRate();

  const [qcReadyModalOpen, setQcReadyModalOpen] = useState(false);
  const [qcReadyModalRegion, setQcReadyModalRegion] = useState("");
  const [qcReadyType, setQcReadyType] = useState("");

  const openQcReadyModal = (regionName, type) => {
    setQcReadyModalRegion(regionName);
    setQcReadyType(type);
    setQcReadyModalOpen(true);
  };

  const filteredRows = detailRows.filter((row) =>
    Object.values(row).some((val) =>
      String(val || "")
        .toLowerCase()
        .includes(filterText.toLowerCase()),
    ),
  );

  // ✅ FAC OK 20%
  const getFacOk20RowsByRegion = (regionName) => {
    return rows.filter((row) => {
      const rowRegion = String(getRegion(row.site_code) || "").toLowerCase();

      const statusOk = String(row.status || "").toUpperCase() === "OK";
      const kabulOk = String(row.kabul_durum || "").toUpperCase() === "OK";

      const reqQty = Number(row.requested_qty || 0);
      const dueQty = Number(row.due_qty || 0);
      const progressedQty = reqQty - dueQty;

      return (
        rowRegion === String(regionName).toLowerCase() &&
        statusOk &&
        progressedQty > 0 &&
        kabulOk
      );
    });
  };

  // ❌ FAC NOK 20%
  const getFacNok20RowsByRegion = (regionName) => {
    return rows.filter((row) => {
      const rowRegion = String(getRegion(row.site_code) || "").toLowerCase();

      const statusOk = String(row.status || "").toUpperCase() === "OK";
      const kabulOk = String(row.kabul_durum || "").toUpperCase() === "OK";

      const reqQty = Number(row.requested_qty || 0);
      const dueQty = Number(row.due_qty || 0);
      const progressedQty = reqQty - dueQty;

      return (
        rowRegion === String(regionName).toLowerCase() &&
        statusOk &&
        progressedQty > 0 &&
        !kabulOk
      );
    });
  };

  const getFacOk20TotalByRegion = (regionName) => {
    return getFacOk20RowsByRegion(regionName).reduce((sum, row) => {
      const base = Number(row.due_qty || 0) * Number(row.unit_price || 0);

      const total =
        normalizeCurrency(row.currency) === "USD" ? base * usdRate : base;

      return sum + total;
    }, 0);
  };

  const getFacNok20TotalByRegion = (regionName) => {
    return getFacNok20RowsByRegion(regionName).reduce((sum, row) => {
      const base = Number(row.due_qty || 0) * Number(row.unit_price || 0);

      const total =
        normalizeCurrency(row.currency) === "USD" ? base * usdRate : base;

      return sum + total;
    }, 0);
  };

  const regionRowStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 16px",
    borderBottom: "1px solid #e5e7eb",
    fontSize: "15px",
  };

  const openRegionDetail = (regionName, type) => {
    const filtered = rows.filter((row) => {
      const sameRegion = getRegion(row.site_code) === regionName;
      if (!sameRegion) return false;

      const unitPrice = Number(row.unit_price || 0);
      const doneQty = Number(row.done_qty || 0);
      const billedQty = Number(row.billed_qty || 0);

      const completedAmount = doneQty * unitPrice;
      const billedAmount = billedQty * unitPrice;

      if (type === "NOT_INVOICED") {
        return completedAmount > billedAmount;
      }

      if (type === "PO_BEKLER") {
        return String(row.status || "").toUpperCase() === "PO_BEKLER";
      }

      return false;
    });

    setDetailTitle(
      type === "NOT_INVOICED"
        ? `${regionName} - Faturalanmamış İşler`
        : `${regionName} - PO Açılmamış İşler`,
    );
    setDetailRows(filtered);
    setDetailModalOpen(true);
  };

  const loadRegionData = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage("");

      const data = await fetchJson(`${API_BASE}/dashboard/result`);
      setRows(data.rows || []);
    } catch (err) {
      console.error("REGION RESULT ERROR:", err);
      setRows([]);
      setErrorMessage(err.message || "Bölge verisi alınamadı");
    } finally {
      setLoading(false);
    }
  }, []);

  const getQcReady80RowsByRegion = (regionName) => {
    return rows.filter((row) => {
      const rowRegion = String(getRegion(row.site_code) || "").toLowerCase();

      const statusOk = String(row.status || "").toUpperCase() === "OK";
      const qcOk = String(row.qc_durum || "").toUpperCase() === "OK";
      const billedZero = Number(row.billed_qty ?? row.billed ?? 0) === 0;

      const req = Number(row.requested_qty || 0);
      const due = Number(row.due_qty || 0);
      const diff = req - due;

      return (
        rowRegion === String(regionName).toLowerCase() &&
        statusOk &&
        qcOk &&
        billedZero &&
        diff === 0
      );
    });
  };

  const getQcReady20RowsByRegion = (regionName) => {
    return rows.filter((row) => {
      const rowRegion = String(getRegion(row.site_code) || "").toLowerCase();

      const statusOk = String(row.status || "").toUpperCase() === "OK";
      const qcOk = String(row.qc_durum || "").toUpperCase() === "OK";
      const billedZero = Number(row.billed_qty ?? row.billed ?? 0) === 0;

      const req = Number(row.requested_qty || 0);
      const due = Number(row.due_qty || 0);
      const diff = req - due;

      return (
        rowRegion === String(regionName).toLowerCase() &&
        statusOk &&
        qcOk &&
        billedZero &&
        diff !== 0
      );
    });
  };

  const getQcReady80TotalByRegion = (regionName) => {
    return getQcReady80RowsByRegion(regionName).reduce((sum, row) => {
      const base =
        Number(row.total_done_amount || row.total_amount || row.total || 0) ||
        Number(row.done_qty || 0) * Number(row.unit_price || 0);

      const total =
        normalizeCurrency(row.currency) === "USD" ? base * usdRate : base;

      return sum + total * 0.8;
    }, 0);
  };

  const getQcReady20TotalByRegion = (regionName) => {
    return getQcReady20RowsByRegion(regionName).reduce((sum, row) => {
      const total =
        Number(row.total_done_amount || row.total_amount || row.total || 0) ||
        Number(row.done_qty || 0) * Number(row.unit_price || 0);

      return sum + total * 0.2;
    }, 0);
  };

  const qcReadyModalRows =
    qcReadyType === "80"
      ? getQcReady80RowsByRegion(qcReadyModalRegion)
      : qcReadyType === "20_fac_ok"
        ? getFacOk20RowsByRegion(qcReadyModalRegion)
        : qcReadyType === "20_fac_nok"
          ? getFacNok20RowsByRegion(qcReadyModalRegion)
          : [];

  const qcReadyModalTotal = qcReadyModalRows.reduce((sum, row) => {
    const currency = normalizeCurrency(row.currency);

    const rawBase =
      Number(row.total_done_amount || row.total_amount || row.total || 0) ||
      Number(row.done_qty || 0) * Number(row.unit_price || 0);

    const rawTotal = currency === "USD" ? rawBase * usdRate : rawBase;

    const facBase = Number(row.due_qty || 0) * Number(row.unit_price || 0);
    const total20 = currency === "USD" ? facBase * usdRate : facBase;

    const total80 = rawTotal * 0.8;

    const shownTotal = qcReadyType === "80" ? total80 : total20;

    return sum + shownTotal;
  }, 0);

  const handleExportQcReadyExcel = async () => {
    try {
      const params = new URLSearchParams({
        region: qcReadyModalRegion || "",
        type: qcReadyType || "",
      });

      const response = await fetch(
        `${API_BASE}/export/qc-ready-excel?${params.toString()}`,
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("QC READY EXPORT ERROR:", errorText);
        alert(`Excel indirilemedi: ${errorText}`);
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `qc_ready_${qcReadyModalRegion}_${qcReadyType}_${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("QC READY EXCEL ERROR:", err);
      alert("Excel indirilemedi");
    }
  };

  useEffect(() => {
    loadRegionData();
  }, [loadRegionData]);

  const regionSummary = useMemo(() => {
    const base = {
      Ankara: {
        region: "Ankara",
        total_records: 0,
        total_try: 0,
        total_usd: 0,
        po_bekler_try: 0,
        po_bekler_usd: 0,
        ok_try: 0,
        ok_usd: 0,
        billed_try: 0,
        billed_usd: 0,
      },
      İzmir: {
        region: "İzmir",
        total_records: 0,
        total_try: 0,
        total_usd: 0,
        po_bekler_try: 0,
        po_bekler_usd: 0,
        ok_try: 0,
        ok_usd: 0,
        billed_try: 0,
        billed_usd: 0,
      },
      Antalya: {
        region: "Antalya",
        total_records: 0,
        total_try: 0,
        total_usd: 0,
        po_bekler_try: 0,
        po_bekler_usd: 0,
        ok_try: 0,
        ok_usd: 0,
        billed_try: 0,
        billed_usd: 0,
      },
    };

    rows.forEach((row) => {
      const region = getRegion(row.site_code);
      if (!base[region]) return;

      const currency = normalizeCurrency(row.currency);
      const amount = Number(row.total_done_amount || 0);

      const billedQty = Number(row.billed_qty || 0);
      const unitPrice = Number(row.unit_price || 0);
      const billedAmount = billedQty * unitPrice;

      base[region].total_records += 1;

      if (currency === "USD") {
        base[region].total_usd += amount;
        base[region].billed_usd += billedAmount;
      } else {
        base[region].total_try += amount;
        base[region].billed_try += billedAmount;
      }

      if (String(row.status || "").toUpperCase() === "PO_BEKLER") {
        if (currency === "USD") {
          base[region].po_bekler_usd += amount;
        } else {
          base[region].po_bekler_try += amount;
        }
      }

      if (String(row.status || "").toUpperCase() === "OK") {
        if (currency === "USD") {
          base[region].ok_usd += amount;
        } else {
          base[region].ok_try += amount;
        }
      }
    });

    return [base.Ankara, base.İzmir, base.Antalya].filter(
      (r) => r.total_records > 0,
    );
  }, [rows]);

  const topSummary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        const currency = normalizeCurrency(row.currency);
        const unitPrice = Number(row.unit_price || 0);
        const doneQty = Number(row.done_qty || 0);
        const billedQty = Number(row.billed_qty || 0);

        const completedAmount = doneQty * unitPrice;
        const invoicedAmount = billedQty * unitPrice;

        if (currency === "USD") {
          acc.completedUSD += completedAmount;
          acc.invoicedUSD += invoicedAmount;
        } else {
          acc.completedTRY += completedAmount;
          acc.invoicedTRY += invoicedAmount;
        }

        return acc;
      },
      {
        completedTRY: 0,
        completedUSD: 0,
        invoicedTRY: 0,
        invoicedUSD: 0,
      },
    );
  }, [rows]);

  const executiveSummary = useMemo(() => {
    const completed =
      Number(topSummary.completedTRY || 0) +
      Number(topSummary.completedUSD || 0) * usdRate;

    const invoiced =
      Number(topSummary.invoicedTRY || 0) +
      Number(topSummary.invoicedUSD || 0) * usdRate;

    const totalPO = regionSummary.reduce((sum, r) => {
      const poTRY =
        Number(r.po_bekler_try || 0) +
        Number(r.po_bekler_usd || 0) * usdRate +
        Number(r.ok_try || 0) +
        Number(r.ok_usd || 0) * usdRate;

      return sum + poTRY;
    }, 0);

    const ratio = completed > 0 ? (invoiced / completed) * 100 : 0;

    return {
      completed,
      invoiced,
      ratio,
      notInvoiced: Math.max(completed - invoiced, 0),
      poOpenedNotInvoiced: Math.max(totalPO - invoiced, 0),
      noPO: Math.max(completed - totalPO, 0),
    };
  }, [topSummary, regionSummary, usdRate]);

  const exportDetailRowsToExcel = () => {
    if (!detailRows.length) {
      alert("İndirilecek kayıt bulunamadı");
      return;
    }

    const excelRows = detailRows.map((row) => ({
      Status: row.status || "",
      "QC Durum": row.qc_durum || "NOK",
      "Kabul Durum": row.kabul_durum || "NOK",
      "Kabul Not": row.kabul_not || "",
      "Project Code": row.project_code || "",
      "Site Code": row.site_code || "",
      "Item Code": row.item_code || "",
      "Item Description": row.item_description || "",
      "Done Qty": row.done_qty ?? "",
      "Requested Qty": row.requested_qty ?? "",
      "Billed Qty": row.billed_qty ?? "",
      Subcon: row.subcon_name || "",
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Detay");

    const fileDate = new Date().toISOString().slice(0, 10);

    const normalizedRegion = String(detailTitle || "")
      .split(" - ")[0]
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
      .replace(/\s+/g, "_");

    const fileLabel = detailTitle.includes("Faturalanmamış")
      ? "Faturalanmamis_Isler"
      : "PO_Bekleyen_Isler";

    XLSX.writeFile(
      workbook,
      `${normalizedRegion}_${fileLabel}_${fileDate}.xlsx`,
    );
  };

  const filteredRegionRows = useMemo(() => {
    const q = regionSearch.toLowerCase().trim();

    const cleanRows = rows.filter(
      (row) => getRegion(row.site_code) !== "Tanımsız",
    );

    if (!q) return cleanRows;

    return cleanRows.filter((row) => {
      const text = `
        ${getRegion(row.site_code) || ""}
        ${row.status || ""}
        ${row.project_code || ""}
        ${row.site_code || ""}
        ${row.item_code || ""}
        ${row.item_description || ""}
        ${row.subcon_name || ""}
        ${row.onair_date || ""}
      `.toLowerCase();

      return text.includes(q);
    });
  }, [rows, regionSearch]);

  const sortedRows = useMemo(() => {
    const sortable = [...filteredRegionRows];

    if (sortConfig.key) {
      sortable.sort((a, b) => {
        const aVal = a[sortConfig.key] ?? "";
        const bVal = b[sortConfig.key] ?? "";

        if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return sortable;
  }, [filteredRegionRows, sortConfig]);

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const handleExportRegionExcel = () => {
    if (!filteredRegionRows.length) {
      alert("İndirilecek kayıt bulunamadı");
      return;
    }

    const excelRows = filteredRegionRows.map((row) => ({
      Bölge: getRegion(row.site_code) || "",
      Status: row.status || "",
      "Project Code": row.project_code || "",
      "Site Code": row.site_code || "",
      "Item Code": row.item_code || "",
      "Item Description": row.item_description || "",
      "OnAir Date": formatDateTR(row.onair_date),
      "Done Qty": row.done_qty ?? "",
      "Requested Qty": row.requested_qty ?? "",
      "Billed Qty": row.billed_qty ?? "",
      Currency: row.currency || "",
      "Unit Price":
        Number(row.unit_price || 0) === 0 ? "" : Number(row.unit_price || 0),
      "Total Done Amount":
        Number(row.total_done_amount || 0) === 0
          ? ""
          : Number(row.total_done_amount || 0),
      Subcon: row.subcon_name || "",
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Region Analysis");

    XLSX.writeFile(
      workbook,
      `region_analysis_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  };

  if (loading) return <div className="loading">Yükleniyor...</div>;
  if (errorMessage) return <div className="loading">{errorMessage}</div>;

  return (
    <>
      <h1 style={{ marginBottom: "10px", textAlign: "center" }}>
        🗺️ Region Analysis
      </h1>

      <div
        style={{
          maxWidth: "520px",
          margin: "10px auto 30px auto",
          borderRadius: "16px",
          overflow: "hidden",
          boxShadow: "0 12px 30px rgba(0,0,0,0.08)",
          border: "1px solid #e5e7eb",
        }}
      >
        <div
          style={{
            background: "#1f2937",
            color: "#fff",
            padding: "10px 16px",
            fontWeight: "600",
            fontSize: "16px",
            textAlign: "center",
          }}
        >
          GENEL ÖZET
        </div>

        <div style={{ background: "#f9fafb" }}>
          <Row
            label="Tamamlanan İş Tutarı"
            value={executiveSummary.completed}
          />
          <Row
            label="Kesilen Fatura Tutarı"
            value={executiveSummary.invoiced}
          />
          <Row
            label="Faturalandırma Oranı"
            value={executiveSummary.ratio}
            isPercent
          />
          <Row
            label="Faturalandırılmamış İş"
            value={executiveSummary.notInvoiced}
            isNegativeHighlight
          />
          <Row
            label="PO Açılmış Ama Faturalanmamış"
            value={executiveSummary.poOpenedNotInvoiced}
          />
          <Row
            label="PO Açılmamış İş"
            value={executiveSummary.noPO}
            isNegativeHighlight
          />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "24px",
          maxWidth: "1200px",
          margin: "20px auto",
        }}
      >
        {regionSummary.length === 0 ? (
          <div className="loading">Bölge verisi bulunamadı</div>
        ) : (
          regionSummary.map((item) => {
            const totalUSDTRY = (item.total_usd || 0) * usdRate;
            const completed = (item.total_try || 0) + totalUSDTRY;
            const billed =
              (item.billed_try || 0) + (item.billed_usd || 0) * usdRate;
            const poBekler =
              (item.po_bekler_try || 0) + (item.po_bekler_usd || 0) * usdRate;
            const okAmount = (item.ok_try || 0) + (item.ok_usd || 0) * usdRate;
            const notBilled = Math.max(completed - billed, 0);
            const ratio = completed > 0 ? (billed / completed) * 100 : 0;

            return (
              <div
                key={item.region}
                style={{
                  borderRadius: "16px",
                  overflow: "hidden",
                  boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                }}
              >
                <div
                  style={{
                    background: "#1f2937",
                    color: "#fff",
                    padding: "12px 16px",
                    fontWeight: "700",
                    fontSize: "20px",
                    textAlign: "center",
                  }}
                >
                  {item.region}
                </div>

                <div style={{ background: "#f9fafb" }}>
                  <div style={regionRowStyle}>
                    <span style={{ color: "#374151", textAlign: "left" }}>
                      Toplam İş
                    </span>
                    <strong style={{ textAlign: "right" }}>
                      {formatTRY(completed)}
                    </strong>
                  </div>

                  <div style={regionRowStyle}>
                    <span style={{ color: "#374151", textAlign: "left" }}>
                      Kesilen Fatura
                    </span>
                    <strong style={{ textAlign: "right" }}>
                      {formatTRY(billed)}
                    </strong>
                  </div>

                  <div style={regionRowStyle}>
                    <span style={{ color: "#374151", textAlign: "left" }}>
                      Faturalandırma Oranı
                    </span>
                    <strong style={{ textAlign: "right" }}>
                      %{ratio.toFixed(1)}
                    </strong>
                  </div>

                  <div style={regionRowStyle}>
                    <span style={{ color: "#374151", textAlign: "left" }}>
                      PO Açılmış
                    </span>
                    <strong style={{ textAlign: "right" }}>
                      {formatTRY(okAmount)}
                    </strong>
                  </div>

                  <div
                    style={{ ...regionRowStyle, cursor: "pointer" }}
                    onClick={() => openRegionDetail(item.region, "PO_BEKLER")}
                  >
                    <span style={{ color: "#374151", textAlign: "left" }}>
                      PO Açılmamış
                    </span>
                    <strong style={{ color: "#dc2626", textAlign: "right" }}>
                      {formatTRY(poBekler)}
                    </strong>
                  </div>

                  <div
                    style={{
                      ...regionRowStyle,
                      cursor: "pointer",
                    }}
                    onClick={() =>
                      openRegionDetail(item.region, "NOT_INVOICED")
                    }
                  >
                    <span style={{ color: "#374151", textAlign: "left" }}>
                      Faturalanmamış İş
                    </span>
                    <strong style={{ color: "#dc2626", textAlign: "right" }}>
                      {formatTRY(notBilled)}
                    </strong>
                  </div>

                  <div
                    style={{
                      ...regionRowStyle,
                      cursor: "pointer",
                    }}
                    onClick={() => openQcReadyModal(item.region, "80")}
                  >
                    <span style={{ color: "#374151", textAlign: "left" }}>
                      QC OK Fatura Kesilecek 80%
                    </span>
                    <strong style={{ color: "#166534", textAlign: "right" }}>
                      {formatTRY(getQcReady80TotalByRegion(item.region))}
                    </strong>
                  </div>

                  <div
                    style={{
                      ...regionRowStyle,
                      cursor: "pointer",
                      borderBottom: "none",
                    }}
                    onClick={() => openQcReadyModal(item.region, "20_fac_ok")}
                  >
                    <span style={{ color: "#16a34a", textAlign: "left" }}>
                      FAC OK Fatura Bekler 20%
                    </span>
                    <strong style={{ color: "#16a34a", textAlign: "right" }}>
                      {formatTRY(getFacOk20TotalByRegion(item.region))}
                    </strong>
                  </div>

                  <div
                    style={{
                      ...regionRowStyle,
                      cursor: "pointer",
                      borderBottom: "none",
                    }}
                    onClick={() => openQcReadyModal(item.region, "20_fac_nok")}
                  >
                    <span style={{ color: "#dc2626", textAlign: "left" }}>
                      FAC NOK Fatura Bekler 20%
                    </span>
                    <strong style={{ color: "#dc2626", textAlign: "right" }}>
                      {formatTRY(getFacNok20TotalByRegion(item.region))}
                    </strong>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {qcReadyModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999,
            padding: "20px",
          }}
          onClick={() => setQcReadyModalOpen(false)}
        >
          <div
            style={{
              background: "#fff",
              width: "100%",
              maxWidth: "1100px",
              maxHeight: "85vh",
              overflow: "auto",
              borderRadius: "20px",
              padding: "24px",
              boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <h3 style={{ margin: 0 }}>
                QC OK Fatura Kesilecek {qcReadyType}% - {qcReadyModalRegion}
              </h3>

              <div
                style={{
                  display: "flex",
                  gap: "16px",
                  marginBottom: "12px",
                  marginTop: "8px",
                }}
              >
                <div
                  style={{
                    background: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    borderRadius: "10px",
                    padding: "8px 12px",
                  }}
                >
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>
                    Toplam Satır
                  </div>
                  <div style={{ fontWeight: "600" }}>
                    {qcReadyModalRows.length}
                  </div>
                </div>

                <div
                  style={{
                    background: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    borderRadius: "10px",
                    padding: "8px 12px",
                  }}
                >
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>
                    Toplam Tutar ({qcReadyType}%)
                  </div>
                  <div style={{ fontWeight: "600" }}>
                    {formatTRY(qcReadyModalTotal)}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="tab"
                  onClick={handleExportQcReadyExcel}
                >
                  Excel İndir
                </button>

                <button
                  type="button"
                  className="tab"
                  onClick={() => setQcReadyModalOpen(false)}
                >
                  Kapat
                </button>
              </div>
            </div>

            <div className="tableWrap" style={{ marginBottom: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Site</th>
                    <th>Item</th>
                    <th>Açıklama</th>
                    <th>Req</th>
                    <th>Due</th>
                    <th>Done</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {qcReadyModalRows.length === 0 ? (
                    <tr>
                      <td colSpan="8">Kayıt bulunamadı</td>
                    </tr>
                  ) : (
                    qcReadyModalRows.map((row, i) => {
                      const rawTotal =
                        Number(
                          row.total_done_amount ||
                            row.total_amount ||
                            row.total ||
                            0,
                        ) ||
                        Number(row.done_qty || 0) * Number(row.unit_price || 0);

                      const total80 = rawTotal * 0.8;
                      const total20 =
                        Number(row.due_qty || 0) * Number(row.unit_price || 0);

                      const shownTotal =
                        qcReadyType === "80" ? total80 : total20;

                      return (
                        <tr key={i}>
                          <td>{row.project_code || "-"}</td>
                          <td>{row.site_code || "-"}</td>
                          <td>{row.item_code || "-"}</td>
                          <td>{row.item_description || "-"}</td>
                          <td>{row.requested_qty ?? "-"}</td>
                          <td>{row.due_qty ?? "-"}</td>
                          <td>{row.done_qty ?? "-"}</td>
                          <td>{formatTRY(shownTotal)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {detailModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999,
            padding: "20px",
          }}
          onClick={() => setDetailModalOpen(false)}
        >
          <div
            style={{
              background: "#fff",
              width: "100%",
              maxWidth: "1400px",
              maxHeight: "85vh",
              overflow: "auto",
              borderRadius: "20px",
              padding: "24px",
              boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "18px",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <h3 className="listTitle" style={{ margin: 0 }}>
                {detailTitle}
              </h3>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <input
                  type="text"
                  placeholder="Detay içinde ara..."
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  style={{
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: "1px solid #d1d5db",
                    minWidth: "260px",
                  }}
                />

                <button
                  type="button"
                  className="tab"
                  onClick={exportDetailRowsToExcel}
                >
                  Excel İndir
                </button>

                <button
                  type="button"
                  className="tab"
                  onClick={() => setDetailModalOpen(false)}
                >
                  Kapat
                </button>
              </div>
            </div>

            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Project Code</th>
                    <th>Site Code</th>
                    <th>Item Code</th>
                    <th>Item Description</th>
                    <th>Done Qty</th>
                    <th>Requested Qty</th>
                    <th>Billed Qty</th>
                    <th>Currency</th>
                    <th>Unit Price</th>
                    <th>Total Done Amount</th>
                    <th>Subcon</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan="12"
                        style={{ textAlign: "center", padding: "20px" }}
                      >
                        Kayıt bulunamadı
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row, index) => (
                      <tr
                        key={
                          row.id ??
                          `${row.project_code}-${row.site_code}-${row.item_code}-${index}`
                        }
                      >
                        <td>
                          <StatusBadge status={row.status} />
                        </td>
                        <td>{row.project_code || "-"}</td>
                        <td>{row.site_code || "-"}</td>
                        <td>{row.item_code || "-"}</td>
                        <td>{row.item_description || "-"}</td>
                        <td>{row.done_qty ?? "-"}</td>
                        <td>{row.requested_qty ?? "-"}</td>
                        <td>{row.billed_qty ?? "-"}</td>
                        <td>{row.currency || "-"}</td>
                        <td>
                          {Number(row.unit_price || 0) === 0
                            ? "-"
                            : formatMoneyByCurrency(
                                row.unit_price,
                                row.currency,
                              )}
                        </td>
                        <td>
                          {Number(row.total_done_amount || 0) === 0
                            ? "-"
                            : formatMoneyByCurrency(
                                row.total_done_amount,
                                row.currency,
                              )}
                        </td>
                        <td>{row.subcon_name || "-"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          margin: "30px auto 12px auto",
          gap: "12px",
          flexWrap: "wrap",
          maxWidth: "1200px",
        }}
      >
        <input
          type="text"
          placeholder="Bölge, status, proje, site, item, taşeron, OnAir Date ara"
          value={regionSearch}
          onChange={(e) => setRegionSearch(e.target.value)}
          style={{
            padding: "10px 14px",
            borderRadius: "8px",
            border: "1px solid #d1d5db",
            minWidth: "320px",
          }}
        />

        <button type="button" className="tab" onClick={handleExportRegionExcel}>
          Excel İndir
        </button>
      </div>

      <div
        className="tableWrap"
        style={{
          maxWidth: "1200px",
          margin: "0 auto 40px auto",
          maxHeight: "60vh",
          overflowY: "auto",
          overflowX: "auto",
          background: "#fff",
          borderRadius: "16px",
          boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
          border: "1px solid #e5e7eb",
        }}
      >
        <table>
          <thead>
            <tr>
              <th>Bölge</th>
              <th>Status</th>
              <th>Analiz</th>
              <th
                onClick={() => handleSort("project_code")}
                style={{ cursor: "pointer" }}
              >
                Project
              </th>
              <th
                onClick={() => handleSort("site_code")}
                style={{ cursor: "pointer" }}
              >
                Site
              </th>
              <th
                onClick={() => handleSort("item_code")}
                style={{ cursor: "pointer" }}
              >
                Item
              </th>
              <th
                onClick={() => handleSort("done_qty")}
                style={{ cursor: "pointer" }}
              >
                Done
              </th>
              <th
                onClick={() => handleSort("requested_qty")}
                style={{ cursor: "pointer" }}
              >
                Req
              </th>
              <th
                onClick={() => handleSort("billed_qty")}
                style={{ cursor: "pointer" }}
              >
                Billed
              </th>
              <th>Curr</th>
              <th
                onClick={() => handleSort("unit_price")}
                style={{ cursor: "pointer" }}
              >
                Unit
              </th>
              <th
                onClick={() => handleSort("total_done_amount")}
                style={{ cursor: "pointer" }}
              >
                Total
              </th>
              <th
                onClick={() => handleSort("subcon_name")}
                style={{ cursor: "pointer" }}
              >
                Subcon
              </th>
              <th>QC</th>
              <th>RF Not</th>
              <th>Kabul Not</th>

              <th
                onClick={() => handleSort("onair_date")}
                style={{ cursor: "pointer" }}
              >
                OnAir
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td
                  colSpan="17"
                  style={{ textAlign: "center", padding: "20px" }}
                >
                  Tanımlı bölge kaydı bulunamadı
                </td>
              </tr>
            ) : (
              sortedRows.map((row, index) => (
                <tr
                  key={
                    row.id ??
                    `${row.project_code}-${row.site_code}-${row.item_code}-${index}`
                  }
                >
                  <td>{getRegion(row.site_code)}</td>
                  <td>
                    <span
                      style={{
                        padding: "6px 12px",
                        borderRadius: "20px",
                        fontSize: "12px",
                        fontWeight: "600",
                        display: "inline-block",
                        background:
                          row.status === "OK"
                            ? "#e6f4ea"
                            : row.status === "PARTIAL"
                              ? "#fff4e5"
                              : row.status === "CANCEL"
                                ? "#fdecea"
                                : row.status === "PO_BEKLER"
                                  ? "#fff8db"
                                  : "#f3f3f3",
                        color:
                          row.status === "OK"
                            ? "#2e7d32"
                            : row.status === "PARTIAL"
                              ? "#ed6c02"
                              : row.status === "CANCEL"
                                ? "#d32f2f"
                                : row.status === "PO_BEKLER"
                                  ? "#a16207"
                                  : "#555",
                      }}
                    >
                      {row.status || "-"}
                    </span>
                  </td>
                  <td>
                    {row.status === "PO_BEKLER"
                      ? "Eksik"
                      : Number(row.done_qty || 0) === 0
                        ? "Giriş Yok"
                        : Number(row.done_qty || 0) ===
                            Number(row.requested_qty || 0)
                          ? "Tamam"
                          : Number(row.done_qty || 0) >
                              Number(row.requested_qty || 0)
                            ? "Eksik"
                            : "Fazla"}
                  </td>
                  <td>{row.project_code || "-"}</td>
                  <td>{row.site_code || "-"}</td>
                  <td>{row.item_code || "-"}</td>
                  <td>{row.done_qty ?? "-"}</td>
                  <td>{row.requested_qty ?? "-"}</td>
                  <td>{row.billed_qty ?? "-"}</td>
                  <td>{row.currency || "-"}</td>
                  <td>
                    {Number(row.unit_price || 0) === 0
                      ? "-"
                      : formatMoneyByCurrency(row.unit_price, row.currency)}
                  </td>
                  <td>
                    {Number(row.total_done_amount || 0) === 0
                      ? "-"
                      : formatMoneyByCurrency(
                          row.total_done_amount,
                          row.currency,
                        )}
                  </td>
                  <td>{row.subcon_name || "-"}</td>
                  <td>
                    <select
                      value={row.qc_durum || ""}
                      onChange={(e) =>
                        handleUpdate(row, { qc_durum: e.target.value })
                      }
                    >
                      <option value="">-</option>
                      <option value="OK">OK</option>
                      <option value="NOK">NOK</option>
                    </select>
                  </td>
                  <td>{row.note || "-"}</td>
                  <td>{row.kabul_not || "-"}</td>
                  <td>{formatDateTR(row.onair_date)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");

  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  });

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("finance_token");
    localStorage.removeItem("finance_user_email");

    setToken("");
    setUser(null);

    if (typeof setFinanceToken === "function") {
      setFinanceToken("");
    }

    if (typeof setFinanceUserEmail === "function") {
      setFinanceUserEmail("");
    }

    window.location.reload();
  };

  const inputStyle = {
    width: "100%",

    padding: "12px",

    marginBottom: "15px",

    borderRadius: "8px",

    border: "1px solid #ddd",
  };

  const [supplierSuggestions, setSupplierSuggestions] = useState([]);
  const [advanceModalOpen, setAdvanceModalOpen] = useState(false);
  const [showSupplierSuggestions, setShowSupplierSuggestions] = useState(false);

  const [advanceForm, setAdvanceForm] = useState({
    supplier_name: "",
    amount: "",
    payment_date: new Date().toISOString().slice(0, 10),
    note: "",
    project_code: "",
    region: "",
    created_by: "Orhan",
  });

  const [supplierAdvances, setSupplierAdvances] = useState([]);
  const [supplierAdvanceTotal, setSupplierAdvanceTotal] = useState(0);

  const [page, setPage] = useState("finance");

  const [financeToken, setFinanceToken] = useState(
    localStorage.getItem("finance_token") || "",
  );

  const [financeUserEmail, setFinanceUserEmail] = useState(
    localStorage.getItem("finance_user_email") || "",
  );

  const [financeLoginEmail, setFinanceLoginEmail] = useState("");
  const [financeLoginPassword, setFinanceLoginPassword] = useState("");
  const [financeLoginError, setFinanceLoginError] = useState("");
  const [financeLoginLoading, setFinanceLoginLoading] = useState(false);

  const loadSupplierAdvances = async () => {
    try {
      const response = await fetch(`${API_BASE}/finance/supplier-advances`);
      const data = await response.json();

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Avanslar alınamadı");
      }

      setSupplierAdvances(data.rows || []);
      setSupplierAdvanceTotal(Number(data.total_advance || 0));
    } catch (err) {
      console.error("LOAD ADVANCES ERROR:", err);
    }
  };

  useEffect(() => {
    loadSupplierAdvances();
  }, []);

  const handleApplyAdvance = async () => {
    try {
      const payload = {
        ...advanceForm,
        amount: Number(advanceForm.amount || 0),
      };

      if (!payload.supplier_name || payload.amount <= 0) {
        alert("Tedarikçi ve geçerli tutar zorunlu");
        return;
      }

      const response = await fetch(
        `${API_BASE}/finance/invoices/apply-advance`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        },
      );

      const data = await response.json();

      if (!response.ok || data.ok === false) {
        console.error("APPLY ADVANCE RESPONSE:", data);
        throw new Error(data.detail || data.error || "Avans uygulanamadı");
      }

      alert(data.message || "Avans başarıyla işlendi");

      setAdvanceModalOpen(false);
      setSupplierSuggestions([]);
      setAdvanceForm({
        supplier_name: "",
        amount: "",
        payment_date: new Date().toISOString().slice(0, 10),
        note: "",
        project_code: "",
        region: "",
        created_by: "Orhan",
      });
      setSupplierSuggestions([]);
      setShowSupplierSuggestions(false);

      await loadSupplierAdvances();
    } catch (err) {
      console.error("APPLY ADVANCE FRONT ERROR:", err);
      alert(err.message || "Avans uygulanamadı");
    }
  };

  const handleFinanceLogin = async (e) => {
    e.preventDefault();

    try {
      setFinanceLoginLoading(true);
      setFinanceLoginError("");

      const response = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: financeLoginEmail,
          password: financeLoginPassword,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Giriş başarısız");
      }

      localStorage.setItem("finance_token", data.token);
      localStorage.setItem("finance_user_email", data.user.email);

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));

      setFinanceToken(data.token);
      setToken(data.token);
      setUser(data.user);
      setFinanceUserEmail(data.user.email);

      setFinanceLoginEmail("");
      setFinanceLoginPassword("");
      setFinanceLoginError("");
    } catch (err) {
      setFinanceLoginError(err.message || "Giriş başarısız");
    } finally {
      setFinanceLoginLoading(false);
    }
  };

  const handleFinanceLogout = () => {
    localStorage.removeItem("finance_token");
    localStorage.removeItem("finance_user_email");
    setFinanceToken("");
    setFinanceUserEmail("");
    setPage("finance");
  };

  if (!financeToken) {
    return (
      <div style={{ height: "100vh", background: "#f3f4f6" }}>
        {/* 🔹 HEADER */}
        <div
          style={{
            height: "60px",
            background: "#fff",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0 30px",
            borderBottom: "1px solid #eee",
          }}
        >
          {/* SOL */}
          <div style={{ fontWeight: "bold", fontSize: "18px" }}>
            Şimşek Haberleşme
          </div>

          {/* SAĞ */}
          <div style={{ color: "#666", fontSize: "14px" }}>
            Rollout Dashboard
          </div>
        </div>

        {/* 🔹 ORTA LOGIN */}
        <div
          style={{
            height: "calc(100vh - 60px)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <form
            onSubmit={handleFinanceLogin}
            style={{
              background: "#fff",
              padding: "40px",
              borderRadius: "16px",
              width: "360px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.1)",
            }}
          >
            <h2 style={{ textAlign: "center", marginBottom: "10px" }}>
              Hoş Geldiniz
            </h2>

            <p
              style={{
                textAlign: "center",
                marginBottom: "24px",
                color: "#6b7280",
              }}
            >
              Hesabınızla giriş yapın
            </p>

            <input
              type="email"
              placeholder="E-posta"
              value={financeLoginEmail}
              onChange={(e) => setFinanceLoginEmail(e.target.value)}
              style={inputStyle}
            />

            <input
              type="password"
              placeholder="Şifre"
              value={financeLoginPassword}
              onChange={(e) => setFinanceLoginPassword(e.target.value)}
              style={inputStyle}
            />

            <button
              type="submit"
              style={{
                width: "100%",
                padding: "12px",
                background: "#e53935",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                fontWeight: "bold",
                cursor: "pointer",
              }}
            >
              Giriş Yap
            </button>
            {financeLoginError && (
              <div
                style={{
                  marginTop: "12px",
                  color: "#b91c1c",
                  fontWeight: "600",
                  textAlign: "center",
                }}
              >
                {financeLoginError}
              </div>
            )}
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div
        className="navTabs"
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
          marginBottom: "24px",
          position: "relative",
        }}
      >
        <button
          className={page === "finance" ? "tab activeTab" : "tab"}
          onClick={() => setPage("finance")}
        >
          Finance Dashboard
        </button>

        <button
          className={page === "region" ? "tab activeTab" : "tab"}
          onClick={() => setPage("region")}
        >
          Region Analysis
        </button>

        <button
          className={page === "executive" ? "tab activeTab" : "tab"}
          onClick={() => setPage("executive")}
        >
          Executive Dashboard
        </button>

        <button
          className={page === "entry" ? "tab activeTab" : "tab"}
          onClick={() => setPage("entry")}
        >
          Günlük İş Girişi
        </button>

        <button
          type="button"
          className="tab"
          onClick={() =>
            window.open("https://avans-po-sistemi.vercel.app/", "_blank")
          }
        >
          Avans Talep
        </button>

        {(token || financeToken) && (
          <button
            type="button"
            onClick={handleLogout}
            style={{
              position: "absolute",
              right: "0",
              top: "50%",
              transform: "translateY(-50%)",
              background: "#dc3545",
              color: "#fff",
              border: "none",
              padding: "10px 16px",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: "600",
            }}
          >
            Çıkış Yap
          </button>
        )}
      </div>

      {page === "finance" &&
        (financeToken ? (
          <FinanceDashboard
            financeToken={financeToken}
            financeUserEmail={financeUserEmail}
            onFinanceLogout={handleFinanceLogout}
            advanceModalOpen={advanceModalOpen}
            setAdvanceModalOpen={setAdvanceModalOpen}
            advanceForm={advanceForm}
            setAdvanceForm={setAdvanceForm}
            handleApplyAdvance={handleApplyAdvance}
            supplierAdvances={supplierAdvances}
            supplierAdvanceTotal={supplierAdvanceTotal}
          />
        ) : (
          <div
            style={{
              maxWidth: "420px",
              margin: "40px auto",
              background: "#fff",
              borderRadius: "20px",
              padding: "24px",
              boxShadow: "0 20px 50px rgba(0,0,0,0.08)",
            }}
          >
            <h2 style={{ marginBottom: "18px", textAlign: "center" }}>
              🔐 Finance Login
            </h2>

            <form onSubmit={handleFinanceLogin}>
              <div style={{ display: "grid", gap: "12px" }}>
                <input
                  type="email"
                  placeholder="E-posta"
                  value={financeLoginEmail}
                  onChange={(e) => setFinanceLoginEmail(e.target.value)}
                />

                <input
                  type="password"
                  placeholder="Şifre"
                  value={financeLoginPassword}
                  onChange={(e) => setFinanceLoginPassword(e.target.value)}
                />

                <button type="submit" className="saveButton">
                  {financeLoginLoading ? "Giriş yapılıyor..." : "Giriş Yap"}
                </button>

                {financeLoginError && (
                  <div style={{ color: "#b91c1c", fontWeight: 600 }}>
                    {financeLoginError}
                  </div>
                )}
              </div>
            </form>
          </div>
        ))}

      {page === "executive" && <ExecutiveDashboard />}
      {page === "region" && <RegionAnalysis />}
      {page === "entry" && <DailyEntry />}
    </div>
  );
}

function QCUploadInline({ onClose, onUploaded }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleUpload = async () => {
    if (!file) {
      alert("Dosya seç");
      return;
    }

    try {
      setLoading(true);

      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${API_BASE}/qc/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Upload hatası");
      }

      alert(`✅ ${data.updatedCount} kayıt güncellendi`);

      if (onUploaded) onUploaded();
      onClose();
    } catch (err) {
      console.error(err);
      alert(`❌ ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="uploadBox">
      <h3>QC Excel Yükle</h3>

      <input
        type="file"
        accept=".xlsx, .xls"
        onChange={(e) => setFile(e.target.files[0])}
      />

      <div style={{ marginTop: "10px", display: "flex", gap: "10px" }}>
        <button onClick={handleUpload} className="saveButton">
          {loading ? "Yükleniyor..." : "Yükle"}
        </button>

        <button onClick={onClose} className="tab">
          Kapat
        </button>
      </div>
    </div>
  );
}
// TEST ORHAN 123

export default App;
