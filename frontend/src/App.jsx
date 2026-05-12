import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import "./App.css";
import * as XLSX from "xlsx";
import "react-datepicker/dist/react-datepicker.css";
import DatePicker from "react-datepicker";
import ReactCrop, { centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import towerIcon from "./assets/tower.svg";

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
  const { withAuth = true, ...fetchOptions } = options;

  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("finance_token") ||
    "";

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

function getRegion(siteCode = "", projectCode = "") {
  const code = String(siteCode || "")
    .trim()
    .toUpperCase();
  const project = String(projectCode || "")
    .trim()
    .toUpperCase();

  if (
    code.startsWith("ES") ||
    code.startsWith("BO") ||
    code.startsWith("ZO") ||
    code.startsWith("KA") ||
    code.startsWith("BI") ||
    code.startsWith("AN") ||
    code.startsWith("CN") ||
    code.includes("_ANK")
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

  // Project code üzerinden yedek bölge tahmini
  if (project.includes("ANK")) return "Ankara";
  if (project.includes("IZM") || project.includes("IZ")) return "İzmir";
  if (project.includes("ANT")) return "Antalya";

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

function RolloutUploadInline({ onClose, onUploaded }) {
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

      const response = await fetch(`${API_BASE}/rollout/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Rollout upload sırasında hata oluştu");
      }

      setMessage("✅ Rollout data başarıyla yüklendi");
      setFile(null);

      const input = document.getElementById("rollout-upload-input");
      if (input) input.value = "";

      if (onUploaded) {
        await onUploaded();
      }
    } catch (err) {
      console.error("ROLLOUT UPLOAD ERROR:", err);
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
            📡 Rollout Excel Yükle
          </h3>

          <button type="button" className="tab" onClick={onClose}>
            Kapat
          </button>
        </div>

        <div className="formGrid">
          <div className="formGroup formGroupWide">
            <label>Rollout / Huawei Atanan Sahalar Excel Dosyası</label>
            <input
              id="rollout-upload-input"
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
            {uploading ? "Yükleniyor..." : "Rollout Excel Yükle"}
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

function RolloutDashboard() {
  const exportExcel = () => {
    const regionParam =
      selectedRegion && selectedRegion !== "Tüm Bölgeler"
        ? selectedRegion
        : "ALL";

    const url = `${API_BASE}/export/excel?region=${regionParam}`;

    window.open(url, "_blank");
  };
  const formatDate = (dateStr) => {
    if (!dateStr) return "";

    // 🔥 EKLE BURAYI
    if (dateStr === "N/A") return "N/A";

    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "";

    return d.toLocaleDateString("tr-TR");
  };
  const renderDate = (value) => (
    <span style={{ color: value === "N/A" ? "#999" : "inherit" }}>
      {formatDate(value)}
    </span>
  );

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summaryRows, setSummaryRows] = useState([]);
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [qcFilter, setQcFilter] = useState("ALL");
  const [errorMessage, setErrorMessage] = useState("");
  const [showRolloutEntryModal, setShowRolloutEntryModal] = useState(false);
  const [selectedRolloutSite, setSelectedRolloutSite] = useState("");

  const handleExportExcel = () => {
    const region = regionFilter || "ALL";

    const url = `${API_BASE}/export/excel?region=${encodeURIComponent(region)}`;

    window.open(url, "_blank");
  };

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage("");

      const data = await fetchJson(`${API_BASE}/rollout/list`, {
        withAuth: true,
      });

      setRows(data.rows || []);
      const summaryData = await fetchJson(
        `${API_BASE}/rollout/summary?region=${encodeURIComponent(regionFilter)}`,
        { withAuth: true },
      );
      setSummaryRows(summaryData.rows || []);
    } catch (err) {
      console.error("ROLLOUT LOAD ERROR:", err);
      setRows([]);
      setErrorMessage(err.message || "Rollout data alınamadı");
    } finally {
      setLoading(false);
    }
  }, [regionFilter]);

  useEffect(() => {
    loadData();
  }, [regionFilter]);

  useEffect(() => {
    const handleDataUpdate = () => {
      console.log("DATA UPDATED EVENT ALINDI");
      loadData();
    };

    window.addEventListener("dataUpdated", handleDataUpdate);

    return () => {
      window.removeEventListener("dataUpdated", handleDataUpdate);
    };
  }, [loadData]);

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase().trim();

    return rows.filter((row) => {
      const rowRegion = row.bolge || row.region || "";

      const regionOk =
        regionFilter === "ALL" ||
        rowRegion.toLowerCase().trim() === regionFilter.toLowerCase().trim();

      const typeOk =
        typeFilter === "ALL"
          ? true
          : String(row.site_type || "").toUpperCase() === typeFilter;

      const qcOk =
        qcFilter === "ALL"
          ? true
          : String(row.qc_durum || "").toUpperCase() === qcFilter;

      const text = `
        ${row.site_type || ""}
        ${row.project_code || ""}
        ${row.project_name || ""}
        ${row.site_code || ""}
        ${row.city || ""}
        ${row.bolge || ""}
        ${row.region || ""}
        ${row.malzeme_status || ""}
        ${row.hw_status || ""}
        ${row.qc_durum || ""}
        ${row.qc_aciklama || ""}
      `.toLowerCase();

      const searchOk = q ? text.includes(q) : true;

      return regionOk && typeOk && qcOk && searchOk;
    });
  }, [rows, search, regionFilter, typeFilter, qcFilter]);

  const summary = useMemo(() => {
    const total = filteredRows.length;
    const completed = filteredRows.filter(
      (r) =>
        String(r.hw_status || "")
          .toUpperCase()
          .includes("DONE") ||
        String(r.hw_status || "")
          .toUpperCase()
          .includes("OK") ||
        String(r.onair_date || "").trim(),
    ).length;

    const materialReady = filteredRows.filter((r) =>
      String(r.malzeme_status || "")
        .toLowerCase()
        .includes("bekler")
        ? false
        : String(r.malzeme_status || "").trim(),
    ).length;

    const qcOk = filteredRows.filter(
      (r) => String(r.qc_durum || "").toUpperCase() === "OK",
    ).length;

    const standalone = filteredRows.filter(
      (r) => String(r.site_type || "").toUpperCase() === "STANDALONE",
    ).length;

    return { total, completed, materialReady, qcOk, standalone };
  }, [filteredRows]);

  if (loading) return <div className="loading">Yükleniyor...</div>;

  return (
    <>
      <h1 className="rolloutTitle">
        <img src={towerIcon} alt="Baz istasyonu" />
        <span>Rollout Data</span>
      </h1>

      {errorMessage && (
        <div className="entryMessage" style={{ color: "#b91c1c" }}>
          {errorMessage}
        </div>
      )}

      <RolloutSummaryTables
        summaryRows={summaryRows}
        rows={rows}
        regionFilter={regionFilter}
      />

      <div
        style={{
          display: "flex",
          gap: "12px",
          flexWrap: "wrap",
          margin: "20px 0",
          alignItems: "center",
        }}
      >
        <input
          className="search"
          placeholder="Site, proje, il, durum ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: "1 1 320px" }}
        />

        <select
          className="select"
          value={regionFilter}
          onChange={(e) => setRegionFilter(e.target.value)}
        >
          <option value="ALL">Tüm Bölgeler</option>
          <option value="İzmir">İzmir</option>
          <option value="Antalya">Antalya</option>
          <option value="Ankara">Ankara</option>
        </select>

        <select
          className="select"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="ALL">Tüm Site Tipleri</option>
          <option value="STANDALONE">Standalone</option>
          <option value="LTE">LTE</option>
          <option value="5G">5G</option>
          <option value="DSS">DSS</option>
        </select>

        <div className="qcActionBox">
          <button
            className="saveButton"
            onClick={() => {
              const site = search.trim();

              if (!site) {
                alert("Lütfen önce Site Code giriniz");
                return;
              }

              setSelectedRolloutSite(site);
              setShowRolloutEntryModal(true);
            }}
          >
            Veri Gir
          </button>
          <button
            onClick={handleExportExcel}
            style={{
              background: "#2e7d32",
              color: "#fff",
              border: "none",
              padding: "10px 16px",
              borderRadius: "8px",
              marginLeft: "10px",
              cursor: "pointer",
              fontWeight: "700",
            }}
          >
            Excel İndir
          </button>
        </div>
      </div>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th colSpan="7">GENEL</th>

              <th colSpan="7">RF</th>

              <th colSpan="3">LOS</th>

              <th colSpan="3">TSS</th>

              <th colSpan="3">TSSR</th>

              <th colSpan="7">BTK</th>

              <th colSpan="3">EMR</th>

              <th colSpan="4">TRS</th>

              <th colSpan="5">ENH</th>

              <th colSpan="4">POWER</th>

              <th colSpan="4">KABUL</th>
            </tr>
            <tr>
              <th>Bölge</th>
              <th>Site Type</th>
              <th>Site Fiziksel Tip</th>
              <th>Project Code</th>
              <th>Site Code</th>
              <th>Malzeme Status</th>
              <th>İl</th>

              <th>RF Subcon</th>
              <th>Plan Start Date</th>
              <th>Installation Start Date</th>
              <th>Installation End Date</th>
              <th>OnAir Date</th>
              <th>QC Closed Date</th>
              <th className="rfNoteCell">RF Not</th>

              <th>LOS Subcon</th>
              <th>LOS Plan Start Date</th>
              <th>LOS Actual End Date</th>

              <th>TSS Subcon</th>
              <th>TSS Plan Start Date</th>
              <th>TSS Actual End Date</th>

              <th>TSSR Subcon</th>
              <th>TSSR Planned Start Date</th>
              <th>TSSR Actual End Date</th>

              <th>BTK Subcon</th>
              <th>BTK Planned Start Date</th>
              <th>BTK Actual End Date</th>
              <th>BTK Approval Status</th>
              <th>GS Status</th>
              <th>Atlas Status</th>

              <th>Survey Note</th>

              <th>EMR Plan Start Date</th>
              <th>EMR Actual End Date</th>

              <th>TRS Subcon</th>
              <th>TRS Plan Start Date</th>
              <th>TRS Actual End Date</th>
              <th>TRS Not</th>

              <th>ENH Site Type</th>
              <th>ENH Subcon</th>
              <th>ENH Planned Start Date</th>
              <th>ENH Actual End Date</th>
              <th>ENH Not</th>

              <th>Power Subcon</th>
              <th>Power Project Planned Start Date</th>
              <th>Power Project Actual End Date</th>

              <th>Abonelik</th>
              <th>Horizon</th>
              <th>PAC</th>
            </tr>
          </thead>

          <tbody>
            {filteredRows.length === 0 ? (
              <EmptyRow colSpan={44} text="Rollout kaydı bulunamadı" />
            ) : (
              filteredRows.map((row, index) => (
                <tr key={row.id}>
                  <td>{row.bolge}</td>
                  <td>{row.site_type}</td>
                  <td>{row.site_physical_type}</td>
                  <td>{row.project_code}</td>
                  <td>{row.site_code}</td>
                  <td>{row.malzeme_status}</td>
                  <td>{row.il}</td>

                  <td>{row.rf_subcon}</td>
                  <td>{formatDate(row.inst_plan_start_date)}</td>
                  <td>{formatDate(row.installation_actual_start_date)}</td>
                  <td>{formatDate(row.installation_actual_end_date)}</td>
                  <td>{formatDate(row.onair_date)}</td>
                  <td>{formatDate(row.qc_closed_date)}</td>
                  <td className="rfNoteCell">{row.rf_not}</td>

                  <td>{row.los_subcon}</td>
                  <td>{renderDate(row.los_plan_date)}</td>
                  <td>{renderDate(row.los_actual_end_date)}</td>

                  <td>{row.tss_subcon}</td>
                  <td>{formatDate(row.tss_plan_start_date)}</td>
                  <td>{formatDate(row.tss_actual_end_date)}</td>

                  <td>{row.tssr_subcon}</td>
                  <td>{formatDate(row.tssr_plan_start_date)}</td>
                  <td>{formatDate(row.tssr_actual_end_date)}</td>

                  <td>{row.btk_subcon}</td>
                  <td>{formatDate(row.btk_plan_start_date)}</td>
                  <td>{formatDate(row.btk_actual_end_date)}</td>
                  <td>{formatDate(row.btk_approved)}</td>
                  <td>{row.gs_status}</td>
                  <td>{row.atlas_status}</td>

                  <td>{row.survey_note}</td>

                  <td>{formatDate(row.emr_plan_start_date)}</td>
                  <td>{formatDate(row.emr_actual_end_date)}</td>

                  <td>{row.trs_subcon}</td>
                  <td>{renderDate(row.trs_plan_start_date)}</td>
                  <td>{renderDate(row.trs_actual_end_date)}</td>
                  <td>{row.trs_not}</td>

                  <td>{row.enh_site_type}</td>
                  <td>{row.enh_subcon}</td>
                  <td>{renderDate(row.enh_plan_start_date)}</td>
                  <td>{renderDate(row.enh_actual_end_date)}</td>
                  <td>{row.enh_not}</td>

                  <td>{row.power_subcon}</td>
                  <td>{renderDate(row.power_plan_start_date)}</td>
                  <td>{renderDate(row.power_actual_end_date)}</td>

                  <td>{renderDate(row.abonelik_actual_end_date)}</td>
                  <td>{renderDate(row.tt_horizon_actual_end_date)}</td>
                  <td>{renderDate(row.pac_actual_end_date)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {showRolloutEntryModal && (
        <RolloutEntryModal
          siteCode={selectedRolloutSite}
          rows={rows}
          onClose={() => setShowRolloutEntryModal(false)}
          onSaved={() => {
            setShowRolloutEntryModal(false);
            loadData();
          }}
        />
      )}
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
  const [showRolloutUpload, setShowRolloutUpload] = useState(false);

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
  const [showDailyIslemlerMenu, setShowDailyIslemlerMenu] = useState(false);
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
        window.dispatchEvent(new Event("dataUpdated"));

        setMessage("✅ Kayıt başarıyla güncellendi");
      } else {
        await fetchJson(`${API_BASE}/master/add`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        window.dispatchEvent(new Event("dataUpdated"));

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

  const handleAddSiteAndOpenModal = async () => {
    const siteCode = String(siteSearchCode || "")
      .trim()
      .toUpperCase();

    if (!siteCode) {
      alert("Site Code giriniz");
      return;
    }

    try {
      const addRes = await fetch(`/rollout/add-site`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          site_code: siteCode,
        }),
      });

      const addData = await addRes.json();

      if (!addRes.ok) {
        alert(addData?.error || "Rollout site eklenemedi");
        return;
      }

      // ✅ önce formu doldur
      setForm((prev) => ({
        ...prev,
        site_code: siteCode,
      }));

      // ✅ sonra modal aç
      handleOpenEntryModal();
    } catch (err) {
      console.error(err);
      alert("İşlem sırasında hata oluştu");
    }
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

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", display: "inline-block" }}>
            <button
              type="button"
              className={showDailyIslemlerMenu ? "tab uploadTab activeTab" : "tab uploadTab"}
              onClick={() => setShowDailyIslemlerMenu((prev) => !prev)}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              ⚡ İşlemler {showDailyIslemlerMenu ? "▲" : "▼"}
            </button>

            {showDailyIslemlerMenu && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  right: 0,
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: "10px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                  zIndex: 999,
                  minWidth: "200px",
                  overflow: "hidden",
                }}
              >
                {[
                  {
                    label: "📊 QC Yükle",
                    action: () => {
                      setShowQcUpload((prev) => !prev);
                      setShowBoqUpload(false);
                      setShowHwPoUpload(false);
                      setShowCompletedImport(false);
                      setShowDailyIslemlerMenu(false);
                    },
                  },
                  {
                    label: "📋 BoQ Yükle",
                    action: () => {
                      setShowBoqUpload((prev) => !prev);
                      setShowQcUpload(false);
                      setShowHwPoUpload(false);
                      setShowCompletedImport(false);
                      setShowDailyIslemlerMenu(false);
                    },
                  },
                  {
                    label: "🚀 Rollout Yükle",
                    action: () => {
                      setShowRolloutUpload(true);
                      setShowDailyIslemlerMenu(false);
                    },
                  },
                  {
                    label: "✅ Tamamlanan Import",
                    action: () => {
                      setShowCompletedImport((prev) => !prev);
                      setShowBoqUpload(false);
                      setShowQcUpload(false);
                      setShowHwPoUpload(false);
                      setShowDailyIslemlerMenu(false);
                    },
                  },
                ].map((item, i, arr) => (
                  <button
                    key={i}
                    type="button"
                    onClick={item.action}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "11px 16px",
                      background: "transparent",
                      border: "none",
                      borderBottom: i < arr.length - 1 ? "1px solid #f3f4f6" : "none",
                      fontSize: "14px",
                      color: "#1f2937",
                      cursor: "pointer",
                      fontWeight: "500",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            className="excelBtn"
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
      {showRolloutUpload && (
        <RolloutUploadInline
          onClose={() => setShowRolloutUpload(false)}
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

function InvoiceBelgeUploader({ invoiceId, currentBelge }) {
  const [belge, setBelge] = useState(currentBelge || null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const fileRef = useRef();

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!invoiceId) {
      setPreview({ file, name: file.name });
      return;
    }
    setUploading(true);
    const fd = new FormData();
    fd.append("belge", file);
    try {
      const r = await fetch(`${API_BASE}/invoice-entries/${invoiceId}/belge`, { method: "POST", body: fd });
      const d = await r.json();
      if (d.ok) setBelge(d.filename);
      else alert("Yükleme hatası: " + d.error);
    } catch (err) {
      alert("Hata: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!invoiceId || !belge) return;
    if (!window.confirm("Belge silinsin mi?")) return;
    await fetch(`${API_BASE}/invoice-entries/${invoiceId}/belge`, { method: "DELETE" });
    setBelge(null);
  };

  if (!invoiceId) {
    return (
      <div style={{ color: "#9ca3af", fontSize: "13px", padding: "16px", textAlign: "center", border: "2px dashed #e5e7eb", borderRadius: "10px" }}>
        Faturayı kaydettikten sonra belge ekleyebilirsiniz.
      </div>
    );
  }

  return (
    <div>
      {belge ? (
        <div style={{ border: "1.5px solid #d1fae5", borderRadius: "10px", padding: "14px 16px", background: "#f0fdf4", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "28px" }}>📄</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: "13px", color: "#166534" }}>Belge Mevcut</div>
              <div style={{ fontSize: "11px", color: "#9ca3af" }}>{belge}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <a href={`${API_BASE.replace("/api", "")}/fatura-belgeler/${belge}`} target="_blank" rel="noreferrer"
              style={{ padding: "6px 12px", background: "#166534", color: "#fff", borderRadius: "8px", fontSize: "12px", fontWeight: 600, textDecoration: "none" }}>
              Görüntüle
            </a>
            <button onClick={handleDelete} style={{ padding: "6px 12px", background: "#fee2e2", color: "#991b1b", border: "none", borderRadius: "8px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
              Sil
            </button>
          </div>
        </div>
      ) : (
        <label style={{ display: "block", border: "2px dashed #d1d5db", borderRadius: "10px", padding: "24px", textAlign: "center", cursor: "pointer", background: uploading ? "#f9fafb" : "#fff", transition: "border-color 0.2s" }}
          onMouseEnter={e => e.currentTarget.style.borderColor = "#6b7280"}
          onMouseLeave={e => e.currentTarget.style.borderColor = "#d1d5db"}>
          <input ref={fileRef} type="file" accept="image/*,.pdf" capture="environment" onChange={handleFile} style={{ display: "none" }} />
          <div style={{ fontSize: "32px", marginBottom: "8px" }}>{uploading ? "⏳" : "📸"}</div>
          <div style={{ fontWeight: 600, fontSize: "14px", color: "#374151" }}>{uploading ? "Yükleniyor..." : "Fatura Fotoğrafı / PDF Ekle"}</div>
          <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>Kameradan çek veya dosya seç</div>
        </label>
      )}
    </div>
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
  user,
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
  onGoToAdmin,
  onGoToHr,
  onGoToAraclar,
  onGoToOfis,
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
  const [showFinanceIslemlerMenu, setShowFinanceIslemlerMenu] = useState(false);
  const [showFinanceHwPoUpload, setShowFinanceHwPoUpload] = useState(false);

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
        Bölge: getRegion(row.site_code, row.project_code) || "",
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
    belge_path: "",
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
          <h1 style={{ margin: "0 0 6px 0" }}>🏗️ ERC Dashboard</h1>
          <div style={{ fontSize: "14px", color: "#6b7280" }}>
            Giriş yapan: <b>{user?.name || financeUserEmail}</b>
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            className="tab smallTab"
            onClick={onGoToAdmin}
          >
            👑 Admin Panel
          </button>

          <button
            type="button"
            className={showInvoiceEntryModal ? "tab activeTab smallTab" : "tab smallTab"}
            onClick={() => {
              setShowInvoiceEntryModal(true);
              setShowInvoiceFormPanel(false);
              setShowInvoiceUpload(false);
              setShowUpload(false);
              setEditingInvoiceId(null);
              setInvoiceForm({
                bolge: "", proje: "", proje_kodu: "", fatura_no: "",
                fatura_tarihi: "", tedarikci: "", rf_montaj_firma: "",
                fatura_kalemi: "", is_kalemi: "", po_no: "", site_id: "",
                tutar: "", kdv: "", toplam_tutar: "", odenen_tutar: "",
                kalan_borc: "", note: "",
              });
            }}
          >
            🧾 Fatura Girişi
          </button>

          <button
            type="button"
            className="tab smallTab"
            onClick={onGoToHr}
          >
            👤 Maaş & Avans
          </button>

          <button
            type="button"
            className="tab smallTab"
            onClick={onGoToAraclar}
          >
            🚗 Araçlar
          </button>

          <button
            type="button"
            className="tab smallTab"
            onClick={onGoToOfis}
          >
            🏢 Ofis & Depo
          </button>

          <button
            type="button"
            className="tab smallTab"
            onClick={handleShowSubconSummary}
          >
            🏗️ Taşeron Hakediş
          </button>

          <div style={{ position: "relative", display: "inline-block" }}>
          <button
            type="button"
            className={showFinanceIslemlerMenu ? "tab activeTab smallTab" : "tab smallTab"}
            onClick={() => setShowFinanceIslemlerMenu((prev) => !prev)}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            ⚡ İşlemler {showFinanceIslemlerMenu ? "▲" : "▼"}
          </button>

          {showFinanceIslemlerMenu && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: "10px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                zIndex: 999,
                minWidth: "200px",
                overflow: "hidden",
              }}
            >
              {[
                {
                  label: "📤 HW Payment Yükle",
                  action: () => {
                    setShowUpload((prev) => !prev);
                    if (showInvoiceUpload) setShowInvoiceUpload(false);
                    setShowFinanceIslemlerMenu(false);
                  },
                },
                {
                  label: "🧾 HW Fatura Yükle",
                  action: () => {
                    setShowInvoiceUpload((prev) => !prev);
                    if (showUpload) setShowUpload(false);
                    setShowFinanceIslemlerMenu(false);
                  },
                },
                {
                  label: "🔩 HW PO Yükle",
                  action: () => {
                    setShowFinanceHwPoUpload((prev) => !prev);
                    setShowFinanceIslemlerMenu(false);
                  },
                },
              ].map((item, i, arr) => (
                <button
                  key={i}
                  type="button"
                  onClick={item.action}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "11px 16px",
                    background: "transparent",
                    border: "none",
                    borderBottom: i < arr.length - 1 ? "1px solid #f3f4f6" : "none",
                    fontSize: "14px",
                    color: "#1f2937",
                    cursor: "pointer",
                    fontWeight: "500",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
          </div>
        </div>
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

      {showFinanceHwPoUpload && (
        <HWPoUploadInline
          onClose={() => setShowFinanceHwPoUpload(false)}
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
          <div
            style={{
              background: "#4caf50",
              color: "#fff",
              padding: "22px",
              borderRadius: "14px",
              minWidth: "260px",
              textAlign: "center",
              fontWeight: 700,
            }}
          >
            <div style={{ fontSize: "16px", marginBottom: "10px" }}>
              Bugün Tahsil Edilen
            </div>
            <div style={{ fontSize: "22px" }}>
              {formatMoneyByCurrency(
                upcomingSummary.today_received_total || 0,
                "TRY",
              )}
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
                              {row.belge_path && (
                                <a
                                  href={`http://localhost:5001/fatura-belgeler/${row.belge_path}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{
                                    padding: "5px 10px",
                                    background: "#f0fdf4",
                                    color: "#166534",
                                    border: "1px solid #bbf7d0",
                                    borderRadius: "6px",
                                    fontSize: "12px",
                                    fontWeight: 600,
                                    textDecoration: "none",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  📄 Belge
                                </a>
                              )}

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

                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "24px", background: "#f8fafc" }}>
                  <form onSubmit={handleSaveManualInvoice}>

                    {/* BÖLÜM 1: Proje Bilgileri */}
                    <div style={{ background: "#fff", borderRadius: "14px", padding: "20px 24px", marginBottom: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#3b82f6", display: "inline-block" }} />
                        Proje Bilgileri
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px" }}>
                        {[
                          { label: "Bölge", name: "bolge", placeholder: "Antalya / İzmir / Ankara" },
                          { label: "Proje", name: "proje", placeholder: "TT / TC" },
                          { label: "Proje Kodu", name: "proje_kodu", placeholder: "56A0QEF" },
                        ].map(f => (
                          <div key={f.name}>
                            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>{f.label}</label>
                            <input name={f.name} value={invoiceForm[f.name]} onChange={handleInvoiceFormChange} placeholder={f.placeholder}
                              style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box" }} />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* BÖLÜM 2: Fatura Bilgileri */}
                    <div style={{ background: "#fff", borderRadius: "14px", padding: "20px 24px", marginBottom: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#8b5cf6", display: "inline-block" }} />
                        Fatura Bilgileri
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px" }}>
                        {[
                          { label: "Fatura No *", name: "fatura_no", placeholder: "ABC2025/001" },
                          { label: "Tedarikçi *", name: "tedarikci", placeholder: "Firma adı" },
                          { label: "RF Montaj Firma", name: "rf_montaj_firma", placeholder: "Subcon firma adı" },
                          { label: "Fatura Kalemi", name: "fatura_kalemi", placeholder: "Malzeme / Hizmet" },
                          { label: "İş Kalemi", name: "is_kalemi", placeholder: "KONAKLAMA / PROJE" },
                          { label: "PO No", name: "po_no", placeholder: "PO numarası" },
                          { label: "Site ID", name: "site_id", placeholder: "BU8944" },
                        ].map(f => (
                          <div key={f.name}>
                            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>{f.label}</label>
                            <input name={f.name} value={invoiceForm[f.name]} onChange={handleInvoiceFormChange} placeholder={f.placeholder}
                              style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box" }} />
                          </div>
                        ))}
                        <div>
                          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>Fatura Tarihi</label>
                          <input type="date" name="fatura_tarihi" value={invoiceForm.fatura_tarihi} onChange={handleInvoiceFormChange}
                            style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box" }} />
                        </div>
                      </div>
                    </div>

                    {/* BÖLÜM 3: Finansal Bilgiler */}
                    <div style={{ background: "#fff", borderRadius: "14px", padding: "20px 24px", marginBottom: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
                        Finansal Bilgiler
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: "14px" }}>
                        {[
                          { label: "Tutar (₺)", name: "tutar" },
                          { label: "KDV (₺)", name: "kdv" },
                          { label: "Toplam Tutar (₺) *", name: "toplam_tutar" },
                          { label: "Ödenen Tutar (₺)", name: "odenen_tutar" },
                          { label: "Kalan Borç (₺)", name: "kalan_borc" },
                        ].map(f => (
                          <div key={f.name}>
                            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>{f.label}</label>
                            <input type="number" step="0.01" name={f.name} value={invoiceForm[f.name]} onChange={handleInvoiceFormChange} placeholder="0"
                              style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box" }} />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* BÖLÜM 4: Not + Fatura Fotoğrafı */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
                      <div style={{ background: "#fff", borderRadius: "14px", padding: "20px 24px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />
                          Not / Açıklama
                        </div>
                        <textarea name="note" value={invoiceForm.note} onChange={handleInvoiceFormChange} placeholder="Ödeme planı, açıklama, notlar..." rows={5}
                          style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", resize: "vertical", boxSizing: "border-box" }} />
                      </div>

                      <div style={{ background: "#fff", borderRadius: "14px", padding: "20px 24px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
                          Fatura Belgesi (PDF / Fotoğraf)
                        </div>
                        <InvoiceBelgeUploader invoiceId={editingInvoiceId} currentBelge={invoiceForm.belge_path} />
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                      <button type="button" className="tab"
                        onClick={() => { setShowInvoiceFormPanel(false); setEditingInvoiceId(null); }}>
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
                    className="excelBtn"
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

/* ============================================================
   PUANTAJ PANEL - Sadece Rollout Müdürü için (maaş bilgisi yok)
   ============================================================ */
function PuantajPanel({ currentUser, onBack }) {
  const [puantajAy, setPuantajAy] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  });
  const [personelList, setPersonelList] = useState([]);
  const [puantajData, setPuantajData] = useState([]);
  const [notModal, setNotModal] = useState(null);
  const [notText, setNotText] = useState("");
  const [notFile, setNotFile] = useState(null);
  const [notSaving, setNotSaving] = useState(false);
  const [personelFilter, setPersonelFilter] = useState(""); // "" = hepsi

  const isPM = currentUser?.email === "orhan.bedir@simsektel.com";
  const isDirektor = currentUser?.email === "duzgun.simsek@simsektel.com";
  const canEditAny = isPM || isDirektor;
  const todayStr = new Date().toISOString().split("T")[0];

  const [yilStr, ayStr] = puantajAy.split("-");
  const ayGunleri = Array.from({ length: new Date(Number(yilStr), Number(ayStr), 0).getDate() }, (_, i) => i+1);

  const DURUMLAR = [
    { key:"CALISDI", label:"✅" },
    { key:"GELMEDI", label:"❌" },
    { key:"IZIN",    label:"🏖" },
    { key:"RAPOR",   label:"☪️" },
    { key:"TATIL",   label:"⭕" },
  ];
  const DURUM_COLOR = { CALISDI:"#dcfce7", IZIN:"#dbeafe", RAPOR:"#fef3c7", TATIL:"transparent", GELMEDI:"#fee2e2" };

  const loadPersonel = async () => {
    const r = await fetch(`${API_BASE}/hr/personel`);
    setPersonelList((await r.json()).filter(p => p.aktif));
  };
  const loadPuantaj = async () => {
    const [yil, ay] = puantajAy.split("-");
    const r = await fetch(`${API_BASE}/hr/puantaj?ay=${ay}&yil=${yil}`);
    setPuantajData(await r.json());
  };

  useEffect(() => { loadPersonel(); }, []);
  useEffect(() => { loadPuantaj(); }, [puantajAy]);

  const getPuantaj = (personelId, gun) => {
    const tarih = `${puantajAy}-${String(gun).padStart(2,"0")}`;
    return puantajData.find(p => p.personel_id === personelId && (p.tarih||"").startsWith(tarih));
  };
  const nextDurum = (current) => {
    const keys = DURUMLAR.map(d=>d.key);
    const idx = keys.indexOf(current||"TATIL");
    return keys[(idx+1)%keys.length];
  };

  const handlePuantaj = (personelId, tarih, durum) => {
    setPuantajData(prev => {
      const idx = prev.findIndex(p => p.personel_id===personelId && (p.tarih||"").startsWith(tarih));
      if (idx>=0) { const u=[...prev]; u[idx]={...u[idx],durum}; return u; }
      return [...prev, { personel_id:personelId, tarih:tarih+"T00:00:00.000Z", durum }];
    });
    fetch(`${API_BASE}/hr/puantaj`, { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ personel_id:personelId, tarih, durum, created_by: currentUser?.email||"" }) })
      .then(r=>r.json())
      .then(saved => {
        setPuantajData(prev => {
          const idx = prev.findIndex(p => p.personel_id===personelId && (p.tarih||"").startsWith(tarih));
          if (idx>=0) { const u=[...prev]; u[idx]={...u[idx], id:saved.id, not_aciklama:saved.not_aciklama, belge_yolu:saved.belge_yolu}; return u; }
          return prev;
        });
      })
      .catch(console.error);
  };

  const openNotModal = (row, personelAd, tarih) => { setNotModal({row,personelAd,tarih}); setNotText(row?.not_aciklama||""); setNotFile(null); };
  const handleSaveNot = async () => {
    if (!notModal?.row?.id) return;
    setNotSaving(true);
    const fd = new FormData(); fd.append("not_aciklama", notText); if (notFile) fd.append("belge", notFile);
    const r = await fetch(`${API_BASE}/hr/puantaj/${notModal.row.id}/not`, { method:"PUT", body:fd });
    const updated = await r.json();
    setPuantajData(prev => prev.map(p => p.id===updated.id ? {...p, not_aciklama:updated.not_aciklama, belge_yolu:updated.belge_yolu} : p));
    setNotSaving(false); setNotModal(null);
  };
  const handleDeleteNot = async () => {
    if (!notModal?.row?.id) return;
    await fetch(`${API_BASE}/hr/puantaj/${notModal.row.id}/not`, { method:"DELETE" });
    setPuantajData(prev => prev.map(p => p.id===notModal.row.id ? {...p, not_aciklama:null, belge_yolu:null} : p));
    setNotModal(null);
  };

  return (
    <div style={{ maxWidth:"1400px", margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"16px", flexWrap:"wrap" }}>
        {onBack && <button onClick={onBack} style={{ background:"#f3f4f6", border:"1px solid #d1d5db", borderRadius:"8px", padding:"7px 14px", fontSize:"13px", fontWeight:600, color:"#374151", cursor:"pointer" }}>← Geri</button>}
        <h2 style={{ margin:0, fontSize:"22px", fontWeight:700, color:"#1f2937" }}>📋 Puantaj Girişi</h2>

        {/* Yıl seçici */}
        <select value={yilStr} onChange={e=>setPuantajAy(`${e.target.value}-${ayStr}`)}
          style={{ padding:"8px 10px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"14px" }}>
          {[2024,2025,2026,2027].map(y=><option key={y} value={y}>{y}</option>)}
        </select>

        {/* Ay seçici */}
        <select value={ayStr} onChange={e=>setPuantajAy(`${yilStr}-${e.target.value}`)}
          style={{ padding:"8px 10px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"14px" }}>
          {["01","02","03","04","05","06","07","08","09","10","11","12"].map((m,i)=>(
            <option key={m} value={m}>{["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"][i]}</option>
          ))}
        </select>

        {/* Personel filtresi */}
        <select value={personelFilter} onChange={e=>setPersonelFilter(e.target.value)}
          style={{ padding:"8px 10px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"14px", minWidth:"160px" }}>
          <option value="">👥 Tüm Personel</option>
          {personelList.map(p=><option key={p.id} value={p.id}>{p.ad_soyad}</option>)}
        </select>

        <span style={{ fontSize:"12px", color:"#9ca3af" }}>Tıkla: ✅→❌→🏖→☪️→⭕</span>

        <a href={`${API_BASE}/hr/excel/puantaj?ay=${ayStr}&yil=${yilStr}`}
          style={{ padding:"8px 14px", background:"#166534", color:"#fff", borderRadius:"8px", fontSize:"13px", fontWeight:600, textDecoration:"none", marginLeft:"auto" }}>
          📥 Excel İndir
        </a>
      </div>

      {personelFilter && (() => {
        const sp = personelList.find(p => String(p.id) === String(personelFilter));
        if (!sp) return null;
        const sc = {};
        ayGunleri.forEach(g => { const durum = getPuantaj(sp.id,g)?.durum||"TATIL"; sc[durum]=(sc[durum]||0)+1; });
        const cal = sc["CALISDI"]||0;
        const hak = Math.round((cal/ayGunleri.length)*(sp.net_maas||0));
        return (
          <div style={{ background:"#fff", borderRadius:"16px", padding:"18px 22px", boxShadow:"0 2px 8px rgba(0,0,0,0.08)", marginBottom:"16px", display:"flex", gap:"20px", alignItems:"center", flexWrap:"wrap" }}>
            <div style={{ minWidth:"110px" }}>
              <div style={{ fontWeight:700, fontSize:"15px" }}>{sp.ad_soyad}</div>
              <div style={{ fontSize:"12px", color:"#9ca3af", marginTop:"2px" }}>{sp.unvan}</div>
            </div>
            <div style={{ display:"flex", gap:"10px", flex:1, flexWrap:"wrap" }}>
              {[
                { label:"Çalışılan", emoji:"✅", val:cal, bg:"#dcfce7", tc:"#166534" },
                { label:"Gelmedi",   emoji:"❌", val:sc["GELMEDI"]||0, bg:"#fee2e2", tc:"#991b1b" },
                { label:"İzin",      emoji:"🏖", val:sc["IZIN"]||0,    bg:"#dbeafe", tc:"#1d4ed8" },
                { label:"Rapor",     emoji:"☪️", val:sc["RAPOR"]||0,   bg:"#fef3c7", tc:"#92400e" },
                { label:"Tatil",     emoji:"⭕", val:sc["TATIL"]||0,   bg:"#f1f5f9", tc:"#64748b" },
              ].map(s=>(
                <div key={s.label} style={{ background:s.bg, borderRadius:"12px", padding:"10px 14px", textAlign:"center", minWidth:"70px" }}>
                  <div style={{ fontSize:"22px", fontWeight:800, color:s.tc }}>{s.val}</div>
                  <div style={{ fontSize:"10px", fontWeight:600, color:s.tc, marginTop:"2px" }}>{s.emoji} {s.label}</div>
                </div>
              ))}
            </div>
            <div style={{ background:"linear-gradient(135deg,#15803d,#166534)", borderRadius:"14px", padding:"16px 22px", textAlign:"center", color:"#fff", minWidth:"140px" }}>
              <div style={{ fontSize:"11px", fontWeight:600, opacity:0.8, marginBottom:"4px" }}>Bu Ay Hakediş</div>
              <div style={{ fontSize:"26px", fontWeight:800, letterSpacing:"-0.5px" }}>₺{hak.toLocaleString("tr-TR")}</div>
              <div style={{ fontSize:"11px", opacity:0.7, marginTop:"4px" }}>{cal} / {ayGunleri.length} gün</div>
            </div>
          </div>
        );
      })()}

      <div style={{ overflowX:"auto", borderRadius:"14px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
        <table style={{ borderCollapse:"collapse", width:"100%", background:"#fff", borderRadius:"14px", overflow:"hidden" }}>
          <thead>
            <tr style={{ background:"#f8fafc" }}>
              <th style={{ padding:"10px 14px", textAlign:"left", fontSize:"13px", fontWeight:700, position:"sticky", left:0, background:"#f8fafc", zIndex:2, minWidth:"150px", borderRight:"2px solid #e5e7eb" }}>Personel</th>
              {ayGunleri.map(g => {
                const d = new Date(Number(yilStr), Number(ayStr)-1, g).getDay();
                return (
                  <th key={g} style={{ padding:"4px 2px", fontSize:"11px", fontWeight:700, textAlign:"center", minWidth:"36px", width:"36px", color: d===0||d===6?"#ef4444":"#374151" }}>
                    <div>{g}</div>
                    {d===0 && <div style={{ fontSize:"9px", fontWeight:500, color:"#ef4444", lineHeight:1 }}>Paz</div>}
                    {d===6 && <div style={{ fontSize:"9px", fontWeight:500, color:"#ef4444", lineHeight:1 }}>Cmt</div>}
                  </th>
                );
              })}
              <th style={{ padding:"10px 8px", fontSize:"12px", fontWeight:700, minWidth:"90px", borderLeft:"2px solid #e5e7eb" }}>Çalışılan</th>
            </tr>
          </thead>
          <tbody>
            {personelList.filter(p => !personelFilter || String(p.id) === String(personelFilter)).map((p, pi) => {
              const calisilan = ayGunleri.filter(g => getPuantaj(p.id,g)?.durum==="CALISDI").length;
              const rowBg = pi%2===0?"#fff":"#fafafa";
              return (
                <tr key={p.id} style={{ borderTop:"1px solid #f3f4f6", background:rowBg }}>
                  <td style={{ padding:"10px 14px", fontWeight:600, fontSize:"13px", position:"sticky", left:0, background:rowBg, zIndex:1, borderRight:"2px solid #e5e7eb" }}>
                    {p.ad_soyad}<br/><span style={{ fontSize:"11px", color:"#9ca3af", fontWeight:400 }}>{p.unvan}</span>
                  </td>
                  {ayGunleri.map(g => {
                    const row = getPuantaj(p.id, g);
                    const durum = row?.durum || "TATIL";
                    const label = DURUMLAR.find(x=>x.key===durum)?.label || "";
                    const tarih = `${puantajAy}-${String(g).padStart(2,"0")}`;
                    const isWeekend = [0,6].includes(new Date(Number(yilStr), Number(ayStr)-1, g).getDay());
                    const cellBg = DURUM_COLOR[durum] || (isWeekend?"#f1f5f9":"transparent");
                    const hasNot = !!(row?.not_aciklama || row?.belge_yolu);
                    const showNot = durum!=="CALISDI" && durum!=="TATIL" && row?.id;
                    const cellEditable = canEditAny || tarih === todayStr;
                    return (
                      <td key={g} style={{ padding:"0", background:cellBg, border:"1px solid #f0f0f0", minWidth:"36px", width:"36px", userSelect:"none" }}>
                        <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
                          <div onClick={()=>{ if(!cellEditable) return; handlePuantaj(p.id, tarih, nextDurum(row?.durum)); }}
                            title={!cellEditable ? "Geçmiş tarihe müdahale yetkisi yok" : ""}
                            style={{ flex:1, minHeight: showNot?"30px":"44px", display:"flex", alignItems:"center", justifyContent:"center", cursor: cellEditable?"pointer":"not-allowed", fontSize:"18px", opacity: cellEditable?1:0.6 }}>
                            {label}
                          </div>
                          {showNot && (
                            <div onClick={()=>openNotModal(row, p.ad_soyad, tarih)}
                              title={hasNot ? (row.not_aciklama||"Belge var") : "Not ekle"}
                              style={{ height:"14px", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:"11px", background: hasNot?"#fef3c7":"rgba(0,0,0,0.04)", borderTop:"1px solid rgba(0,0,0,0.06)" }}>
                              {hasNot?"📝":"+ not"}
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td style={{ padding:"8px", textAlign:"center", fontWeight:700, color:"#1f2937", borderLeft:"2px solid #e5e7eb", fontSize:"14px" }}>
                    {calisilan}<span style={{ color:"#9ca3af", fontWeight:400, fontSize:"11px" }}>/{ayGunleri.length}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Not Modalı */}
      {notModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center" }}
          onClick={()=>setNotModal(null)}>
          <div style={{ background:"#fff", borderRadius:"16px", padding:"24px", width:"440px", boxShadow:"0 20px 50px rgba(0,0,0,0.2)" }}
            onClick={e=>e.stopPropagation()}>
            <div style={{ fontWeight:700, fontSize:"16px", marginBottom:"4px" }}>📝 Devamsızlık Notu</div>
            <div style={{ fontSize:"13px", color:"#6b7280", marginBottom:"16px" }}>
              {notModal.personelAd} — {notModal.tarih}
              {notModal.row?.durum && <span style={{ marginLeft:8, fontWeight:600, color:"#374151" }}>({notModal.row.durum})</span>}
            </div>
            <div style={{ marginBottom:"12px" }}>
              <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"6px" }}>Açıklama</label>
              <textarea value={notText} onChange={e=>setNotText(e.target.value)}
                placeholder="Sebebi yazın..." rows={3}
                style={{ width:"100%", padding:"10px 12px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"14px", resize:"vertical", boxSizing:"border-box" }} />
            </div>
            <div style={{ marginBottom:"16px" }}>
              <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"6px" }}>Belge / E-posta Eki</label>
              <input type="file" onChange={e=>setNotFile(e.target.files[0])} style={{ fontSize:"13px" }} />
              {notModal.row?.belge_yolu && !notFile && (
                <div style={{ marginTop:"6px", fontSize:"12px" }}>
                  <a href={`http://localhost:5001/puantaj-belgeler/${notModal.row.belge_yolu}`} target="_blank" rel="noreferrer" style={{ color:"#1d4ed8", fontWeight:600 }}>Mevcut belge →</a>
                </div>
              )}
            </div>
            <div style={{ display:"flex", gap:"8px", justifyContent:"flex-end" }}>
              {(notModal.row?.not_aciklama || notModal.row?.belge_yolu) && (
                <button type="button" onClick={handleDeleteNot}
                  style={{ padding:"8px 14px", background:"#fee2e2", color:"#991b1b", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>Notu Sil</button>
              )}
              <button type="button" onClick={()=>setNotModal(null)}
                style={{ padding:"8px 14px", background:"#f3f4f6", color:"#374151", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>Vazgeç</button>
              <button type="button" onClick={handleSaveNot} disabled={notSaving}
                style={{ padding:"8px 16px", background:"#1f2937", color:"#fff", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>
                {notSaving?"Kaydediliyor...":"Kaydet"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   HR DASHBOARD - Personel / Puantaj / Avans / ISG
   ============================================================ */
function HrDashboard({ onBack, currentUser }) {
  const [tab, setTab] = useState("personel");
  const [personelList, setPersonelList] = useState([]);
  const [isgTurleri, setIsgTurleri] = useState([]);
  const [isgUyarilar, setIsgUyarilar] = useState([]);
  const [selectedPersonel, setSelectedPersonel] = useState(null);
  const [showPersonelForm, setShowPersonelForm] = useState(false);
  const [editingPersonel, setEditingPersonel] = useState(null);
  const [personelIsg, setPersonelIsg] = useState([]);
  const [personelBelgeler, setPersonelBelgeler] = useState([]);
  const [showIsgForm, setShowIsgForm] = useState(false);
  const [puantajAy, setPuantajAy] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  });
  const [hrPersonelFilter, setHrPersonelFilter] = useState("");
  const [puantajData, setPuantajData] = useState([]);
  const [ozet, setOzet] = useState([]);
  const [avansList, setAvansList] = useState([]);
  const [avansForm, setAvansForm] = useState({ personel_id: "", tarih: new Date().toISOString().split("T")[0], tutar: "", aciklama: "" });
  const [isAvansList, setIsAvansList] = useState([]);
  const [isAvansForm, setIsAvansForm] = useState({ personel_id: "", tarih: new Date().toISOString().split("T")[0], tutar: "", aciklama: "" });
  const [pForm, setPForm] = useState({
    ad_soyad:"", tc_no:"", dogum_tarihi:"", telefon:"", email:"", unvan:"", bolge:"",
    ise_giris_tarihi:"", isten_ayrilma_tarihi:"", net_maas:"", bankadan_gosterilen:"",
    elden_verilen:"", iban:"", banka_adi:"", banka_hesap_no:"", aktif: true,
  });
  const [isgForm, setIsgForm] = useState({ egitim_turu:"", egitim_tarihi:"", gecerlilik_yil:2 });
  const [notModal, setNotModal] = useState(null); // { puantajRow, personelAd, tarih }
  const [notText, setNotText] = useState("");
  const [notFile, setNotFile] = useState(null);
  const [notSaving, setNotSaving] = useState(false);

  const loadPersonel = async () => {
    const r = await fetch(`${API_BASE}/hr/personel`);
    setPersonelList(await r.json());
  };
  const loadIsgUyarilar = async () => {
    const r = await fetch(`${API_BASE}/hr/isg/uyarilar`);
    setIsgUyarilar(await r.json());
  };
  const loadIsgTurleri = async () => {
    const r = await fetch(`${API_BASE}/hr/isg-egitim-turleri`);
    setIsgTurleri(await r.json());
  };
  const loadPuantaj = async () => {
    const [yil, ay] = puantajAy.split("-");
    const r = await fetch(`${API_BASE}/hr/puantaj?ay=${ay}&yil=${yil}`);
    setPuantajData(await r.json());
  };
  const loadOzet = async () => {
    const [yil, ay] = puantajAy.split("-");
    const r = await fetch(`${API_BASE}/hr/puantaj/ozet?ay=${ay}&yil=${yil}`);
    setOzet(await r.json());
  };
  const loadAvans = async () => {
    const r = await fetch(`${API_BASE}/hr/avans?turu=MAAS`);
    setAvansList(await r.json());
  };
  const loadIsAvans = async () => {
    const r = await fetch(`${API_BASE}/hr/avans?turu=IS`);
    setIsAvansList(await r.json());
  };
  const loadPersonelDetail = async (p) => {
    setSelectedPersonel(p);
    const [bi, isg] = await Promise.all([
      fetch(`${API_BASE}/hr/personel/${p.id}/belgeler`).then(r=>r.json()),
      fetch(`${API_BASE}/hr/personel/${p.id}/isg`).then(r=>r.json()),
    ]);
    setPersonelBelgeler(bi);
    setPersonelIsg(isg);
  };

  useEffect(() => { loadPersonel(); loadIsgTurleri(); loadIsgUyarilar(); }, []);
  useEffect(() => { if (tab==="puantaj" || tab==="personel") { loadPuantaj(); loadOzet(); } }, [tab, puantajAy]);
  useEffect(() => { if (tab==="personel") { loadAvans(); loadIsAvans(); } }, [tab, puantajAy]);
  useEffect(() => { if (tab==="maas_avans") loadAvans(); }, [tab]);
  useEffect(() => { if (tab==="is_avans") loadIsAvans(); }, [tab]);

  const handleSavePersonel = async (e) => {
    e.preventDefault();
    const method = editingPersonel ? "PUT" : "POST";
    const url = editingPersonel ? `${API_BASE}/hr/personel/${editingPersonel.id}` : `${API_BASE}/hr/personel`;
    await fetch(url, { method, headers: { "Content-Type":"application/json" }, body: JSON.stringify(pForm) });
    setShowPersonelForm(false); setEditingPersonel(null);
    loadPersonel();
  };
  const handleEditPersonel = (p) => {
    setEditingPersonel(p);
    setPForm({ ...p, dogum_tarihi: p.dogum_tarihi?.split("T")[0]||"", ise_giris_tarihi: p.ise_giris_tarihi?.split("T")[0]||"", isten_ayrilma_tarihi: p.isten_ayrilma_tarihi?.split("T")[0]||"" });
    setShowPersonelForm(true);
  };
  const handleToggleAktif = async (p) => {
    await fetch(`${API_BASE}/hr/personel/${p.id}`, { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify({...p, aktif: !p.aktif}) });
    loadPersonel();
  };
  const handleDeletePersonel = async (p) => {
    if (!window.confirm(`${p.ad_soyad} silinsin mi?`)) return;
    await fetch(`${API_BASE}/hr/personel/${p.id}`, { method:"DELETE" });
    loadPersonel();
  };
  const handleBelgeUpload = async (personelId, tur, file) => {
    const fd = new FormData(); fd.append("dosya", file);
    await fetch(`${API_BASE}/hr/personel/${personelId}/belge/${tur}`, { method:"POST", body: fd });
    loadPersonelDetail(selectedPersonel);
  };
  const handleSaveIsg = async (e) => {
    e.preventDefault();
    const tur = isgTurleri.find(t=>t.tur===isgForm.egitim_turu);
    await fetch(`${API_BASE}/hr/personel/${selectedPersonel.id}/isg`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({...isgForm, gecerlilik_yil: tur?.gecerlilik_yil || isgForm.gecerlilik_yil})
    });
    setShowIsgForm(false);
    loadPersonelDetail(selectedPersonel);
    loadIsgUyarilar();
  };
  const handleDeleteIsg = async (isgId) => {
    if (!window.confirm("Silinsin mi?")) return;
    await fetch(`${API_BASE}/hr/personel/${selectedPersonel.id}/isg/${isgId}`, { method:"DELETE" });
    loadPersonelDetail(selectedPersonel);
    loadIsgUyarilar();
  };
  const handlePuantaj = (personelId, tarih, durum) => {
    // Optimistic update — anında göster
    setPuantajData(prev => {
      const idx = prev.findIndex(p => p.personel_id === personelId && (p.tarih || "").startsWith(tarih));
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], durum };
        return updated;
      }
      return [...prev, { personel_id: personelId, tarih: tarih + "T00:00:00.000Z", durum }];
    });
    // Arka planda kaydet — dönen id ile state'i güncelle
    fetch(`${API_BASE}/hr/puantaj`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ personel_id:personelId, tarih, durum }) })
      .then(r => r.json())
      .then(saved => {
        setPuantajData(prev => {
          const idx = prev.findIndex(p => p.personel_id === personelId && (p.tarih || "").startsWith(tarih));
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], id: saved.id, not_aciklama: saved.not_aciklama, belge_yolu: saved.belge_yolu };
            return updated;
          }
          return prev;
        });
        loadOzet();
      })
      .catch(console.error);
  };
  const openNotModal = (row, personelAd, tarih) => {
    setNotModal({ row, personelAd, tarih });
    setNotText(row?.not_aciklama || "");
    setNotFile(null);
  };
  const handleSaveNot = async () => {
    if (!notModal?.row?.id) return;
    setNotSaving(true);
    const fd = new FormData();
    fd.append("not_aciklama", notText);
    if (notFile) fd.append("belge", notFile);
    const r = await fetch(`${API_BASE}/hr/puantaj/${notModal.row.id}/not`, { method:"PUT", body: fd });
    const updated = await r.json();
    setPuantajData(prev => prev.map(p => p.id === updated.id ? { ...p, not_aciklama: updated.not_aciklama, belge_yolu: updated.belge_yolu } : p));
    setNotSaving(false);
    setNotModal(null);
  };
  const handleDeleteNot = async () => {
    if (!notModal?.row?.id) return;
    await fetch(`${API_BASE}/hr/puantaj/${notModal.row.id}/not`, { method:"DELETE" });
    setPuantajData(prev => prev.map(p => p.id === notModal.row.id ? { ...p, not_aciklama: null, belge_yolu: null } : p));
    setNotModal(null);
  };

  const handleSaveAvans = async (e) => {
    e.preventDefault();
    await fetch(`${API_BASE}/hr/avans`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ ...avansForm, avans_turu:"MAAS" }) });
    setAvansForm({ personel_id:"", tarih: new Date().toISOString().split("T")[0], tutar:"", aciklama:"" });
    loadAvans();
  };
  const handleSaveIsAvans = async (e) => {
    e.preventDefault();
    await fetch(`${API_BASE}/hr/avans`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ ...isAvansForm, avans_turu:"IS" }) });
    setIsAvansForm({ personel_id:"", tarih: new Date().toISOString().split("T")[0], tutar:"", aciklama:"" });
    loadIsAvans();
  };

  // Puantaj yardımcıları
  const [yilStr, ayStr] = puantajAy.split("-");
  const ayGunleri = Array.from({ length: new Date(Number(yilStr), Number(ayStr), 0).getDate() }, (_, i) => i+1);
  const DURUMLAR = [
    { key:"CALISDI", label:"✅", color:"#22c55e" },
    { key:"GELMEDI", label:"❌", color:"#ef4444" },
    { key:"IZIN",    label:"🏖", color:"#3b82f6" },
    { key:"RAPOR",   label:"☪️", color:"#f59e0b" },
    { key:"TATIL",   label:"⭕", color:"#9ca3af" },
  ];
  const getPuantaj = (personelId, gun) => {
    const tarih = `${puantajAy}-${String(gun).padStart(2,"0")}`;
    return puantajData.find(p => p.personel_id===personelId && p.tarih?.startsWith(tarih));
  };
  const nextDurum = (current) => {
    const keys = DURUMLAR.map(d=>d.key);
    const idx = keys.indexOf(current||"TATIL");
    return keys[(idx+1)%keys.length];
  };

  const BELGE_TURLERI = [
    { key:"fotograf", label:"📷 Fotoğraf" },
    { key:"tc_kimlik", label:"🪪 TC Kimlik" },
    { key:"ehliyet", label:"🚗 Ehliyet" },
    { key:"saglik_raporu", label:"🏥 Sağlık Raporu" },
    { key:"sgk_bildirge", label:"📋 SGK Bildirge" },
    { key:"diger", label:"📎 Diğer Belge" },
  ];

  const inputSt = { padding:"9px 12px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"14px", width:"100%", boxSizing:"border-box" };
  const labelSt = { display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"5px" };
  const secSt = { background:"#fff", borderRadius:"14px", padding:"20px 24px", marginBottom:"16px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" };

  return (
    <div style={{ maxWidth:"1400px", margin:"0 auto" }}>
      {/* Başlık + Geri */}
      <div style={{ display:"flex", alignItems:"center", gap:"16px", marginBottom:"20px" }}>
        {onBack && (
          <button className="tab" onClick={onBack} style={{ fontSize:"13px" }}>← Finance</button>
        )}
        <h2 style={{ margin:0, fontSize:"22px", fontWeight:700, color:"#1f2937" }}>👤 İnsan Kaynakları Modülü</h2>
      </div>
      {/* ISG Uyarı Bandı */}
      {isgUyarilar.length > 0 && (
        <div style={{ background:"#fef2f2", border:"1px solid #fecaca", borderRadius:"12px", padding:"12px 20px", marginBottom:"16px", display:"flex", alignItems:"center", gap:"12px", flexWrap:"wrap" }}>
          <span style={{ fontSize:"20px" }}>🚨</span>
          <span style={{ fontWeight:700, color:"#991b1b", fontSize:"14px" }}>ISG Eğitim Uyarısı:</span>
          {isgUyarilar.map((u,i) => (
            <span key={i} style={{ background: u.durum==="SURESI_DOLDU"?"#fee2e2":"#fef3c7", color: u.durum==="SURESI_DOLDU"?"#991b1b":"#92400e", padding:"3px 10px", borderRadius:"20px", fontSize:"12px", fontWeight:600 }}>
              {u.ad_soyad} — {u.egitim_turu} {u.durum==="SURESI_DOLDU"?"(SÜRESİ DOLDU!)":"(30 gün kaldı)"}
            </span>
          ))}
        </div>
      )}

      {/* Sekmeler */}
      <div style={{ display:"flex", gap:"8px", marginBottom:"20px" }}>
        {[["personel","👤 Personel"],["puantaj","📋 Puantaj"],["maas_avans","💰 Maaş Avansı"],["is_avans","🏗 İş Avansı"],["isg","🎓 ISG Eğitimler"]].map(([k,l]) => (
          <button key={k} onClick={()=>setTab(k)} className={tab===k?"tab activeTab":"tab"} style={{ fontSize:"14px" }}>{l}</button>
        ))}
      </div>

      {/* ===== PERSONEL SEKMESİ ===== */}
      {tab==="personel" && (
        <div>
          {selectedPersonel ? (
            /* Personel Detay */
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"20px" }}>
                <button className="tab" onClick={()=>setSelectedPersonel(null)}>← Geri</button>
                <h2 style={{ margin:0, fontSize:"20px" }}>👤 {selectedPersonel.ad_soyad}</h2>
                <span style={{ background: selectedPersonel.aktif?"#dcfce7":"#f3f4f6", color: selectedPersonel.aktif?"#166534":"#6b7280", padding:"3px 12px", borderRadius:"20px", fontSize:"12px", fontWeight:700 }}>
                  {selectedPersonel.aktif?"Aktif":"Pasif"}
                </span>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"16px" }}>
                {/* Belgeler */}
                <div style={secSt}>
                  <div style={{ fontWeight:700, marginBottom:"14px", color:"#374151" }}>📂 Personel Belgeleri</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px" }}>
                    {BELGE_TURLERI.map(bt => {
                      const mevcut = personelBelgeler.find(b=>b.belge_turu===bt.key);
                      return (
                        <div key={bt.key} style={{ border:"1.5px solid #e5e7eb", borderRadius:"10px", padding:"10px 12px", background: mevcut?"#f0fdf4":"#fafafa" }}>
                          <div style={{ fontSize:"13px", fontWeight:600, color:"#374151", marginBottom:"8px" }}>{bt.label}</div>
                          {mevcut ? (
                            <a href={`http://localhost:5001/personel-belgeler/${mevcut.dosya_yolu}`} target="_blank" rel="noreferrer"
                              style={{ fontSize:"12px", color:"#166534", fontWeight:600 }}>Görüntüle →</a>
                          ) : (
                            <label style={{ fontSize:"12px", color:"#6b7280", cursor:"pointer" }}>
                              <input type="file" style={{display:"none"}} onChange={e=>handleBelgeUpload(selectedPersonel.id,bt.key,e.target.files[0])} />
                              + Yükle
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ISG Eğitimleri */}
                <div style={secSt}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"14px" }}>
                    <div style={{ fontWeight:700, color:"#374151" }}>🎓 ISG Eğitimleri</div>
                    <button className="tab" onClick={()=>setShowIsgForm(true)} style={{ fontSize:"12px" }}>+ Eğitim Ekle</button>
                  </div>
                  {showIsgForm && (
                    <form onSubmit={handleSaveIsg} style={{ background:"#f8fafc", borderRadius:"10px", padding:"14px", marginBottom:"12px" }}>
                      <div style={{ marginBottom:"8px" }}>
                        <label style={labelSt}>Eğitim Türü</label>
                        <select value={isgForm.egitim_turu} onChange={e=>{const t=isgTurleri.find(x=>x.tur===e.target.value); setIsgForm(f=>({...f,egitim_turu:e.target.value,gecerlilik_yil:t?.gecerlilik_yil||2}));}} style={inputSt} required>
                          <option value="">Seç...</option>
                          {isgTurleri.map(t=><option key={t.tur} value={t.tur}>{t.tur} ({t.gecerlilik_yil} yıl)</option>)}
                        </select>
                      </div>
                      <div style={{ marginBottom:"8px" }}>
                        <label style={labelSt}>Eğitim Tarihi</label>
                        <input type="date" value={isgForm.egitim_tarihi} onChange={e=>setIsgForm(f=>({...f,egitim_tarihi:e.target.value}))} style={inputSt} required />
                      </div>
                      <div style={{ display:"flex", gap:"8px" }}>
                        <button type="submit" className="saveButton" style={{ flex:1 }}>Kaydet</button>
                        <button type="button" className="tab" onClick={()=>setShowIsgForm(false)}>İptal</button>
                      </div>
                    </form>
                  )}
                  {personelIsg.length===0 ? <div style={{ color:"#9ca3af", fontSize:"13px" }}>Henüz eğitim girilmemiş</div> : (
                    personelIsg.map(eg => {
                      const suresi = new Date(eg.bitis_tarihi) < new Date() ? "DOLDU" : new Date(eg.bitis_tarihi) < new Date(Date.now()+30*864e5) ? "YAKLASAN" : "OK";
                      return (
                        <div key={eg.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 10px", borderRadius:"8px", marginBottom:"6px", background: suresi==="DOLDU"?"#fef2f2": suresi==="YAKLASAN"?"#fffbeb":"#f0fdf4" }}>
                          <div>
                            <div style={{ fontWeight:600, fontSize:"13px" }}>{eg.egitim_turu}</div>
                            <div style={{ fontSize:"11px", color:"#9ca3af" }}>
                              {eg.egitim_tarihi?.split("T")[0]} → {eg.bitis_tarihi?.split("T")[0]}
                              {suresi==="DOLDU" && <span style={{ color:"#dc2626", fontWeight:700 }}> ⚠️ SÜRESİ DOLDU</span>}
                              {suresi==="YAKLASAN" && <span style={{ color:"#d97706", fontWeight:700 }}> ⚠️ YAKLAŞIYOR</span>}
                            </div>
                          </div>
                          <button onClick={()=>handleDeleteIsg(eg.id)} style={{ background:"#fee2e2", color:"#991b1b", border:"none", borderRadius:"6px", padding:"4px 8px", fontSize:"12px", cursor:"pointer" }}>Sil</button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Personel Listesi */
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"16px", flexWrap:"wrap", gap:"12px" }}>
                <h2 style={{ margin:0, fontSize:"20px" }}>👤 Personel Listesi</h2>
                <div style={{ display:"flex", gap:"8px", alignItems:"center", flexWrap:"wrap" }}>
                  <select value={yilStr} onChange={e=>setPuantajAy(`${e.target.value}-${ayStr}`)}
                    style={{ padding:"7px 10px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"13px" }}>
                    {[2024,2025,2026,2027].map(y=><option key={y} value={y}>{y}</option>)}
                  </select>
                  <select value={ayStr} onChange={e=>setPuantajAy(`${yilStr}-${e.target.value}`)}
                    style={{ padding:"7px 10px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"13px" }}>
                    {["01","02","03","04","05","06","07","08","09","10","11","12"].map((m,i)=>(
                      <option key={m} value={m}>{["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"][i]}</option>
                    ))}
                  </select>
                  <select value={hrPersonelFilter} onChange={e=>setHrPersonelFilter(e.target.value)}
                    style={{ padding:"7px 10px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"13px", minWidth:"150px" }}>
                    <option value="">👥 Tüm Personel</option>
                    {personelList.filter(p=>p.aktif).map(p=><option key={p.id} value={p.id}>{p.ad_soyad}</option>)}
                  </select>
                  <button className="saveButton" onClick={()=>{ setEditingPersonel(null); setPForm({ ad_soyad:"",tc_no:"",dogum_tarihi:"",telefon:"",email:"",unvan:"",bolge:"",ise_giris_tarihi:"",isten_ayrilma_tarihi:"",net_maas:"",bankadan_gosterilen:"",elden_verilen:"",iban:"",banka_adi:"",banka_hesap_no:"",aktif:true }); setShowPersonelForm(true); }}>
                    + Personel Ekle
                  </button>
                </div>
              </div>

              {hrPersonelFilter && (() => {
                const sp = personelList.find(p => String(p.id) === String(hrPersonelFilter));
                if (!sp) return null;
                const sc = {};
                ayGunleri.forEach(g => { const durum = getPuantaj(sp.id,g)?.durum||"TATIL"; sc[durum]=(sc[durum]||0)+1; });
                const cal = sc["CALISDI"]||0;
                const hak = Math.round((cal/ayGunleri.length)*(sp.net_maas||0));
                const maasAvans = avansList
                  .filter(a => String(a.personel_id)===String(sp.id) && (a.tarih||"").startsWith(puantajAy))
                  .reduce((s,a)=>s+Number(a.tutar||0), 0);
                const isAvans = isAvansList
                  .filter(a => String(a.personel_id)===String(sp.id) && (a.tarih||"").startsWith(puantajAy))
                  .reduce((s,a)=>s+Number(a.tutar||0), 0);
                const net = hak - maasAvans;
                return (
                  <div style={{ background:"#fff", borderRadius:"16px", padding:"18px 22px", boxShadow:"0 2px 8px rgba(0,0,0,0.08)", marginBottom:"20px", display:"flex", gap:"20px", alignItems:"center", flexWrap:"wrap" }}>
                    <div style={{ minWidth:"130px" }}>
                      <div style={{ fontWeight:700, fontSize:"15px" }}>{sp.ad_soyad}</div>
                      <div style={{ fontSize:"12px", color:"#9ca3af", marginTop:"2px" }}>{sp.unvan}</div>
                      <div style={{ fontSize:"12px", color:"#6b7280", marginTop:"4px" }}>Net Maaş: <b>₺{Number(sp.net_maas||0).toLocaleString("tr-TR")}</b></div>
                    </div>
                    <div style={{ display:"flex", gap:"10px", flex:1, flexWrap:"wrap" }}>
                      {[
                        { label:"Çalışılan", emoji:"✅", val:cal, bg:"#dcfce7", tc:"#166534" },
                        { label:"Gelmedi",   emoji:"❌", val:sc["GELMEDI"]||0, bg:"#fee2e2", tc:"#991b1b" },
                        { label:"İzin",      emoji:"🏖", val:sc["IZIN"]||0,    bg:"#dbeafe", tc:"#1d4ed8" },
                        { label:"Rapor",     emoji:"☪️", val:sc["RAPOR"]||0,   bg:"#fef3c7", tc:"#92400e" },
                        { label:"Tatil",     emoji:"⭕", val:sc["TATIL"]||0,   bg:"#f1f5f9", tc:"#64748b" },
                      ].map(s=>(
                        <div key={s.label} style={{ background:s.bg, borderRadius:"12px", padding:"10px 14px", textAlign:"center", minWidth:"70px" }}>
                          <div style={{ fontSize:"22px", fontWeight:800, color:s.tc }}>{s.val}</div>
                          <div style={{ fontSize:"10px", fontWeight:600, color:s.tc, marginTop:"2px" }}>{s.emoji} {s.label}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:"8px", minWidth:"160px" }}>
                      <div style={{ background:"linear-gradient(135deg,#15803d,#166534)", borderRadius:"12px", padding:"12px 18px", textAlign:"center", color:"#fff" }}>
                        <div style={{ fontSize:"10px", fontWeight:600, opacity:0.8 }}>Bu Ay Hakediş</div>
                        <div style={{ fontSize:"22px", fontWeight:800 }}>₺{hak.toLocaleString("tr-TR")}</div>
                        <div style={{ fontSize:"10px", opacity:0.7 }}>{cal} / {ayGunleri.length} gün</div>
                      </div>
                      {maasAvans > 0 && (
                        <div style={{ background:"#fef3c7", borderRadius:"12px", padding:"8px 18px", textAlign:"center" }}>
                          <div style={{ fontSize:"10px", fontWeight:600, color:"#92400e" }}>Maaş Avansı</div>
                          <div style={{ fontSize:"18px", fontWeight:800, color:"#92400e" }}>-₺{maasAvans.toLocaleString("tr-TR")}</div>
                        </div>
                      )}
                      {isAvans > 0 && (
                        <div style={{ background:"#f3e8ff", borderRadius:"12px", padding:"8px 18px", textAlign:"center" }}>
                          <div style={{ fontSize:"10px", fontWeight:600, color:"#7e22ce" }}>İş Avansı</div>
                          <div style={{ fontSize:"18px", fontWeight:800, color:"#7e22ce" }}>₺{isAvans.toLocaleString("tr-TR")}</div>
                        </div>
                      )}
                      {maasAvans > 0 && (
                        <div style={{ background:"linear-gradient(135deg,#1d4ed8,#2563eb)", borderRadius:"12px", padding:"8px 18px", textAlign:"center", color:"#fff" }}>
                          <div style={{ fontSize:"10px", fontWeight:600, opacity:0.8 }}>Net Ödenecek</div>
                          <div style={{ fontSize:"20px", fontWeight:800 }}>₺{net.toLocaleString("tr-TR")}</div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {showPersonelForm && (
                <div style={{ ...secSt, marginBottom:"20px", background:"#f8fafc", border:"1.5px solid #e5e7eb" }}>
                  <div style={{ fontWeight:700, fontSize:"15px", marginBottom:"16px" }}>{editingPersonel?"✏️ Personel Düzenle":"➕ Yeni Personel"}</div>
                  <form onSubmit={handleSavePersonel}>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"12px", marginBottom:"12px" }}>
                      {[["Ad Soyad *","ad_soyad"],["TC No","tc_no"],["Telefon","telefon"],["E-posta","email"],
                        ["Unvan","unvan"],["Bölge","bolge"],["IBAN","iban"],["Banka Adı","banka_adi"],["Banka Hesap No","banka_hesap_no"]
                      ].map(([l,n])=>(
                        <div key={n}>
                          <label style={labelSt}>{l}</label>
                          <input value={pForm[n]||""} onChange={e=>setPForm(f=>({...f,[n]:e.target.value}))} style={inputSt} required={n==="ad_soyad"} />
                        </div>
                      ))}
                      {[["Doğum Tarihi","dogum_tarihi"],["İşe Giriş","ise_giris_tarihi"],["İşten Ayrılma","isten_ayrilma_tarihi"]].map(([l,n])=>(
                        <div key={n}>
                          <label style={labelSt}>{l}</label>
                          <input type="date" value={pForm[n]||""} onChange={e=>setPForm(f=>({...f,[n]:e.target.value}))} style={inputSt} />
                        </div>
                      ))}
                      {[["Net Maaş (₺)","net_maas"],["Bankadan Gösterilen (₺)","bankadan_gosterilen"],["Elden Verilen (₺)","elden_verilen"]].map(([l,n])=>(
                        <div key={n}>
                          <label style={labelSt}>{l}</label>
                          <input type="number" value={pForm[n]||""} onChange={e=>setPForm(f=>({...f,[n]:e.target.value}))} style={inputSt} />
                        </div>
                      ))}
                    </div>
                    <div style={{ display:"flex", gap:"8px", justifyContent:"flex-end" }}>
                      <button type="button" className="tab" onClick={()=>setShowPersonelForm(false)}>Vazgeç</button>
                      <button type="submit" className="saveButton">Kaydet</button>
                    </div>
                  </form>
                </div>
              )}

              <div style={{ display:"grid", gap:"10px" }}>
                {personelList.map(p => (
                  <div key={p.id} style={{ background:"#fff", borderRadius:"14px", padding:"16px 20px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)", display:"grid", gridTemplateColumns:"44px 1fr auto auto auto", alignItems:"center", gap:"16px", opacity: p.aktif?1:0.6 }}>
                    <div style={{ width:44, height:44, borderRadius:"12px", background: p.aktif?"linear-gradient(135deg,#60a5fa,#3b82f6)":"#e5e7eb", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"18px", fontWeight:700, color:"#fff" }}>
                      {p.ad_soyad.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontWeight:700, fontSize:"15px" }}>{p.ad_soyad}</div>
                      <div style={{ fontSize:"12px", color:"#9ca3af" }}>{p.unvan} {p.bolge && `· ${p.bolge}`}</div>
                      <div style={{ fontSize:"12px", color:"#6b7280", marginTop:"2px" }}>Net: <b>₺{Number(p.net_maas||0).toLocaleString("tr-TR")}</b> · Banka: ₺{Number(p.bankadan_gosterilen||0).toLocaleString("tr-TR")} · Elden: ₺{Number(p.elden_verilen||0).toLocaleString("tr-TR")}</div>
                    </div>
                    <span style={{ background:p.aktif?"#dcfce7":"#f3f4f6", color:p.aktif?"#166534":"#6b7280", padding:"3px 12px", borderRadius:"20px", fontSize:"12px", fontWeight:700 }}>{p.aktif?"Aktif":"Pasif"}</span>
                    <div style={{ display:"flex", gap:"6px" }}>
                      <button onClick={()=>loadPersonelDetail(p)} style={{ padding:"6px 12px", background:"#eff6ff", color:"#1d4ed8", border:"none", borderRadius:"8px", fontSize:"12px", fontWeight:600, cursor:"pointer" }}>Detay / Belgeler</button>
                      <button onClick={()=>handleEditPersonel(p)} style={{ padding:"6px 12px", background:"#f3f4f6", color:"#374151", border:"none", borderRadius:"8px", fontSize:"12px", fontWeight:600, cursor:"pointer" }}>Düzenle</button>
                      <button onClick={()=>handleToggleAktif(p)} style={{ padding:"6px 12px", background:p.aktif?"#fef3c7":"#f0fdf4", color:p.aktif?"#92400e":"#166534", border:"none", borderRadius:"8px", fontSize:"12px", fontWeight:600, cursor:"pointer" }}>
                        {p.aktif?"Pasife Al":"Aktif Et"}
                      </button>
                    </div>
                    <button onClick={()=>handleDeletePersonel(p)} style={{ padding:"6px 10px", background:"#fee2e2", color:"#991b1b", border:"none", borderRadius:"8px", fontSize:"12px", cursor:"pointer" }}>Sil</button>
                  </div>
                ))}
                {personelList.length===0 && <div style={{ ...secSt, textAlign:"center", color:"#9ca3af" }}>Henüz personel eklenmemiş. "Personel Ekle" butonuna tıklayın.</div>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== PUANTAJ SEKMESİ ===== */}
      {tab==="puantaj" && (
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:"16px", marginBottom:"20px", flexWrap:"wrap" }}>
            <h2 style={{ margin:0 }}>📋 Puantaj</h2>
            <select value={yilStr} onChange={e=>setPuantajAy(`${e.target.value}-${ayStr}`)}
              style={{ padding:"8px 12px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"14px" }}>
              {[2024,2025,2026,2027].map(y=><option key={y} value={y}>{y}</option>)}
            </select>
            <select value={ayStr} onChange={e=>setPuantajAy(`${yilStr}-${e.target.value}`)}
              style={{ padding:"8px 12px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"14px" }}>
              {["01","02","03","04","05","06","07","08","09","10","11","12"].map((m,i)=>(
                <option key={m} value={m}>{["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"][i]}</option>
              ))}
            </select>
            <div style={{ fontSize:"13px", color:"#6b7280" }}>Hücreye tıkla: ✅→🏖→☪️→⭕→❌→✅</div>
            <a href={`${API_BASE}/hr/excel/puantaj?ay=${ayStr}&yil=${yilStr}`}
              style={{ padding:"8px 14px", background:"#166534", color:"#fff", borderRadius:"8px", fontSize:"13px", fontWeight:600, textDecoration:"none" }}>
              📥 Excel İndir
            </a>
          </div>

          {/* Legend */}
          <div style={{ display:"flex", gap:"10px", marginBottom:"16px", flexWrap:"wrap" }}>
            {DURUMLAR.map(d=><span key={d.key} style={{ fontSize:"13px" }}>{d.label} {d.key}</span>)}
          </div>

          <div style={{ overflowX:"auto", borderRadius:"14px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
            <table style={{ borderCollapse:"collapse", width:"100%", background:"#fff", borderRadius:"14px", overflow:"hidden" }}>
              <thead>
                <tr style={{ background:"#f8fafc" }}>
                  <th style={{ padding:"10px 14px", textAlign:"left", fontSize:"13px", fontWeight:700, position:"sticky", left:0, background:"#f8fafc", zIndex:2, minWidth:"150px" }}>Personel</th>
                  {ayGunleri.map(g=>{
                    const d = new Date(Number(yilStr), Number(ayStr)-1, g).getDay();
                    return (
                      <th key={g} style={{ padding:"4px 2px", fontSize:"11px", fontWeight:700, textAlign:"center", minWidth:"36px", width:"36px", color: d===0||d===6?"#ef4444":"#374151" }}>
                        <div>{g}</div>
                        {d===0 && <div style={{ fontSize:"9px", fontWeight:500, color:"#ef4444", lineHeight:1 }}>Paz</div>}
                        {d===6 && <div style={{ fontSize:"9px", fontWeight:500, color:"#ef4444", lineHeight:1 }}>Cmt</div>}
                      </th>
                    );
                  })}
                  <th style={{ padding:"10px 8px", fontSize:"12px", fontWeight:700, minWidth:"80px" }}>Çalışılan</th>
                  <th style={{ padding:"10px 8px", fontSize:"12px", fontWeight:700, minWidth:"110px" }}>Hakediş</th>
                </tr>
              </thead>
              <tbody>
                {personelList.filter(p=>p.aktif && (!hrPersonelFilter || String(p.id)===String(hrPersonelFilter))).map((p,pi) => {
                  const calisilan = ayGunleri.filter(g=>{
                    const row = getPuantaj(p.id, g);
                    return row?.durum==="CALISDI";
                  }).length;
                  const hakedilen = Math.round((calisilan/ayGunleri.length)*p.net_maas);
                  const rowBg = pi%2===0?"#fff":"#fafafa";
                  return (
                    <tr key={p.id} style={{ borderTop:"1px solid #f3f4f6", background: rowBg }}>
                      <td style={{ padding:"8px 14px", fontWeight:600, fontSize:"13px", position:"sticky", left:0, background: rowBg, zIndex:1, borderRight:"2px solid #e5e7eb" }}>
                        {p.ad_soyad}<br/><span style={{ fontSize:"11px", color:"#9ca3af", fontWeight:400 }}>{p.unvan}</span>
                      </td>
                      {ayGunleri.map(g=>{
                        const row = getPuantaj(p.id, g);
                        const durum = row?.durum || "TATIL";
                        const d = DURUMLAR.find(x=>x.key===durum);
                        const tarih = `${puantajAy}-${String(g).padStart(2,"0")}`;
                        const isWeekend = new Date(Number(yilStr), Number(ayStr)-1, g).getDay() === 0 || new Date(Number(yilStr), Number(ayStr)-1, g).getDay() === 6;
                        const cellBg = durum==="CALISDI" ? "#dcfce7" : durum==="GELMEDI" ? "#fee2e2" : durum==="IZIN" ? "#dbeafe" : durum==="RAPOR" ? "#fef3c7" : isWeekend ? "#f1f5f9" : "transparent";
                        const hasNot = !!(row?.not_aciklama || row?.belge_yolu);
                        const showNot2 = durum !== "CALISDI" && durum !== "TATIL" && row?.id;
                        return (
                          <td key={g} style={{ padding:"0", background: cellBg, border:"1px solid #f0f0f0", minWidth:"36px", width:"36px", userSelect:"none" }}>
                            <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
                              <div
                                onClick={()=>handlePuantaj(p.id, tarih, nextDurum(row?.durum))}
                                style={{ flex:1, minHeight: showNot2?"30px":"42px", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:"18px" }}
                              >
                                {d?.label||""}
                              </div>
                              {showNot2 && (
                                <div
                                  onClick={()=>openNotModal(row, p.ad_soyad, tarih)}
                                  title={hasNot ? (row.not_aciklama || "Belge var") : "Not ekle"}
                                  style={{ height:"14px", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:"11px", background: hasNot?"#fef3c7":"rgba(0,0,0,0.04)", borderTop:"1px solid rgba(0,0,0,0.06)" }}
                                >
                                  {hasNot ? "📝" : "+ not"}
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td style={{ padding:"8px", textAlign:"center", fontWeight:700, color:"#1f2937", borderLeft:"2px solid #e5e7eb" }}>{calisilan}/{ayGunleri.length}</td>
                      <td style={{ padding:"8px", textAlign:"right", fontWeight:700, color:"#166534", fontSize:"13px" }}>₺{hakedilen.toLocaleString("tr-TR")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Ay Özeti */}
          {ozet.length > 0 && (
            <div style={{ marginTop:"24px" }}>
              <h3 style={{ marginBottom:"12px" }}>💰 Ay Özeti</h3>
              <div style={{ display:"grid", gap:"8px" }}>
                {ozet.map(o => (
                  <div key={o.personel_id} style={{ background:"#fff", borderRadius:"12px", padding:"12px 18px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)", display:"grid", gridTemplateColumns:"1fr auto auto auto auto auto", gap:"16px", alignItems:"center" }}>
                    <div style={{ fontWeight:600 }}>{o.ad_soyad}</div>
                    <div style={{ fontSize:"13px" }}>{o.calisilan_gun}/{o.toplam_gun} gün</div>
                    <div style={{ fontSize:"13px" }}>Hakediş: <b>₺{o.hakedilen_maas.toLocaleString("tr-TR")}</b></div>
                    <div style={{ fontSize:"13px", color:"#3b82f6" }}>Banka: ₺{o.bankadan.toLocaleString("tr-TR")}</div>
                    <div style={{ fontSize:"13px", color:"#f59e0b" }}>Elden: ₺{o.elden.toLocaleString("tr-TR")}</div>
                    <div style={{ fontSize:"13px", color: o.avans>0?"#ef4444":"#9ca3af" }}>Avans: ₺{o.avans.toLocaleString("tr-TR")}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Not Modalı */}
          {notModal && (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center" }}
              onClick={()=>setNotModal(null)}>
              <div style={{ background:"#fff", borderRadius:"16px", padding:"24px", width:"440px", boxShadow:"0 20px 50px rgba(0,0,0,0.2)" }}
                onClick={e=>e.stopPropagation()}>
                <div style={{ fontWeight:700, fontSize:"16px", marginBottom:"4px" }}>📝 Devamsızlık Notu</div>
                <div style={{ fontSize:"13px", color:"#6b7280", marginBottom:"16px" }}>
                  {notModal.personelAd} — {notModal.tarih}
                  {notModal.row?.durum && <span style={{ marginLeft:8, fontWeight:600, color:"#374151" }}>({notModal.row.durum})</span>}
                </div>
                <div style={{ marginBottom:"12px" }}>
                  <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"6px" }}>Açıklama</label>
                  <textarea
                    value={notText}
                    onChange={e=>setNotText(e.target.value)}
                    placeholder="Sebebi yazın... (izin belgesi, rapor no, vs.)"
                    rows={3}
                    style={{ width:"100%", padding:"10px 12px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"14px", resize:"vertical", boxSizing:"border-box" }}
                  />
                </div>
                <div style={{ marginBottom:"16px" }}>
                  <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"6px" }}>Belge / E-posta Eki</label>
                  <input type="file" onChange={e=>setNotFile(e.target.files[0])}
                    style={{ fontSize:"13px" }} />
                  {notModal.row?.belge_yolu && !notFile && (
                    <div style={{ marginTop:"6px", fontSize:"12px" }}>
                      Mevcut belge: <a href={`http://localhost:5001/puantaj-belgeler/${notModal.row.belge_yolu}`} target="_blank" rel="noreferrer" style={{ color:"#1d4ed8", fontWeight:600 }}>Görüntüle →</a>
                    </div>
                  )}
                </div>
                <div style={{ display:"flex", gap:"8px", justifyContent:"flex-end" }}>
                  {(notModal.row?.not_aciklama || notModal.row?.belge_yolu) && (
                    <button type="button" onClick={handleDeleteNot}
                      style={{ padding:"8px 14px", background:"#fee2e2", color:"#991b1b", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>
                      Notu Sil
                    </button>
                  )}
                  <button type="button" onClick={()=>setNotModal(null)}
                    style={{ padding:"8px 14px", background:"#f3f4f6", color:"#374151", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>
                    Vazgeç
                  </button>
                  <button type="button" onClick={handleSaveNot} disabled={notSaving}
                    style={{ padding:"8px 16px", background:"#1f2937", color:"#fff", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>
                    {notSaving ? "Kaydediliyor..." : "Kaydet"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== İŞ AVANSI SEKMESİ ===== */}
      {tab==="is_avans" && <IsAvansPanel currentUser={currentUser} onPendingCount={()=>{}} />}

      {/* ===== AVANS SEKMESİ ===== */}
      {(tab==="maas_avans") && (() => {
        const isMaas = tab === "maas_avans";
        const list = isMaas ? avansList : isAvansList;
        const form = isMaas ? avansForm : isAvansForm;
        const setForm = isMaas ? setAvansForm : setIsAvansForm;
        const onSave = isMaas ? handleSaveAvans : handleSaveIsAvans;
        const reload = isMaas ? loadAvans : loadIsAvans;
        return (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"340px 1fr", gap:"20px", alignItems:"start" }}>
            <div style={secSt}>
              <div style={{ fontWeight:700, fontSize:"15px", marginBottom:"16px" }}>
                {isMaas ? "➕ Maaş Avansı Girişi" : "➕ İş Avansı Girişi"}
              </div>
              {!isMaas && <div style={{ fontSize:"12px", color:"#6b7280", marginBottom:"12px", background:"#f0fdf4", padding:"8px 12px", borderRadius:"8px" }}>İş avansı maaştan kesilmez. Ayrı takip edilir.</div>}
              <form onSubmit={onSave}>
                <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                  <div>
                    <label style={labelSt}>Personel</label>
                    <select value={form.personel_id} onChange={e=>setForm(f=>({...f,personel_id:e.target.value}))} style={inputSt} required>
                      <option value="">Seç...</option>
                      {personelList.filter(p=>p.aktif).map(p=><option key={p.id} value={p.id}>{p.ad_soyad}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelSt}>Tarih</label>
                    <input type="date" value={form.tarih} onChange={e=>setForm(f=>({...f,tarih:e.target.value}))} style={inputSt} required />
                  </div>
                  <div>
                    <label style={labelSt}>Tutar (₺)</label>
                    <input type="number" value={form.tutar} onChange={e=>setForm(f=>({...f,tutar:e.target.value}))} style={inputSt} required />
                  </div>
                  <div>
                    <label style={labelSt}>Açıklama</label>
                    <input value={form.aciklama} onChange={e=>setForm(f=>({...f,aciklama:e.target.value}))} style={inputSt} />
                  </div>
                  <button type="submit" className="saveButton">Kaydet</button>
                </div>
              </form>
            </div>

            <div style={{ ...secSt, padding:0, overflow:"hidden" }}>
              <div style={{ padding:"16px 20px", borderBottom:"1px solid #f3f4f6", fontWeight:700 }}>
                {isMaas ? "💰 Maaş Avansı Kayıtları" : "🏗 İş Avansı Kayıtları"}
              </div>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead>
                    <tr style={{ background:"#f8fafc" }}>
                      {["Personel","Tarih","Tutar","Açıklama","Durum",""].map(h=>(
                        <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:"12px", fontWeight:700, color:"#6b7280" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((a,i) => (
                      <tr key={a.id} style={{ borderTop:"1px solid #f3f4f6", background: i%2===0?"#fff":"#fafafa" }}>
                        <td style={{ padding:"10px 14px", fontWeight:600, fontSize:"14px" }}>{a.ad_soyad}</td>
                        <td style={{ padding:"10px 14px", fontSize:"13px" }}>{a.tarih?.split("T")[0]}</td>
                        <td style={{ padding:"10px 14px", fontWeight:700, color:"#1f2937" }}>₺{Number(a.tutar).toLocaleString("tr-TR")}</td>
                        <td style={{ padding:"10px 14px", fontSize:"13px", color:"#6b7280" }}>{a.aciklama}</td>
                        <td style={{ padding:"10px 14px" }}>
                          <span style={{ background:a.odendi?"#dcfce7":"#fef3c7", color:a.odendi?"#166534":"#92400e", padding:"3px 10px", borderRadius:"20px", fontSize:"12px", fontWeight:600 }}>
                            {a.odendi?"Ödendi":"Bekliyor"}
                          </span>
                        </td>
                        <td style={{ padding:"10px 14px" }}>
                          {!a.odendi && (
                            <button onClick={async()=>{ await fetch(`${API_BASE}/hr/avans/${a.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({odendi:true,odeme_tarihi:new Date().toISOString().split("T")[0]})}); reload(); }}
                              style={{ padding:"4px 10px", background:"#dcfce7", color:"#166534", border:"none", borderRadius:"6px", fontSize:"12px", fontWeight:600, cursor:"pointer" }}>
                              Ödendi İşaretle
                            </button>
                          )}
                          <button onClick={async()=>{ if(!window.confirm("Silinsin mi?"))return; await fetch(`${API_BASE}/hr/avans/${a.id}`,{method:"DELETE"}); reload(); }}
                            style={{ marginLeft:"6px", padding:"4px 10px", background:"#fee2e2", color:"#991b1b", border:"none", borderRadius:"6px", fontSize:"12px", cursor:"pointer" }}>
                            Sil
                          </button>
                        </td>
                      </tr>
                    ))}
                    {list.length===0 && <tr><td colSpan={6} style={{ padding:"24px", textAlign:"center", color:"#9ca3af" }}>Kayıt yok</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ===== ISG SEKMESİ ===== */}
      {tab==="isg" && (
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:"16px", marginBottom:"16px" }}>
            <h2 style={{ margin:0 }}>🎓 ISG Eğitim Takibi</h2>
            <a href={`${API_BASE}/hr/excel/isg`}
              style={{ padding:"8px 14px", background:"#166534", color:"#fff", borderRadius:"8px", fontSize:"13px", fontWeight:600, textDecoration:"none" }}>
              📥 ISG Excel İndir
            </a>
          </div>
          {isgUyarilar.length > 0 ? (
            <div>
              <div style={{ marginBottom:"16px", fontWeight:700, color:"#991b1b" }}>⚠️ Dikkat Gerektiren Eğitimler</div>
              <div style={{ display:"grid", gap:"8px" }}>
                {isgUyarilar.map(u => (
                  <div key={u.id} style={{ background: u.durum==="SURESI_DOLDU"?"#fef2f2":"#fffbeb", borderRadius:"12px", padding:"12px 18px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div>
                      <div style={{ fontWeight:700, color: u.durum==="SURESI_DOLDU"?"#991b1b":"#92400e" }}>{u.ad_soyad} — {u.egitim_turu}</div>
                      <div style={{ fontSize:"12px", color:"#9ca3af", marginTop:"2px" }}>Bitiş: {u.bitis_tarihi?.split("T")[0]}</div>
                    </div>
                    <span style={{ background: u.durum==="SURESI_DOLDU"?"#fee2e2":"#fef3c7", color: u.durum==="SURESI_DOLDU"?"#991b1b":"#92400e", padding:"4px 12px", borderRadius:"20px", fontSize:"12px", fontWeight:700 }}>
                      {u.durum==="SURESI_DOLDU"?"🔴 SÜRESİ DOLDU":"🟡 30 GÜN KALDI"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ ...secSt, textAlign:"center", color:"#166534", background:"#f0fdf4" }}>
              ✅ Tüm ISG eğitimleri güncel, sorun yok.
            </div>
          )}
          <div style={{ marginTop:"20px", color:"#6b7280", fontSize:"13px" }}>
            Personel eğitimlerini düzenlemek için <b>👤 Personel</b> sekmesinden personeli seçin → Detay / Belgeler.
          </div>
        </div>
      )}
    </div>
  );
}

const GIDER_TURLERI = ["Yol","Konaklama","Akşam Yemeği","Yakıt","Malzeme","Ekipman","Diğer"];
const BOLGELER = ["İzmir","Antalya","Ankara"];
const PROJELER = ["TT - Türk Telekom","TC - Türkcell","VF - Vodafone"];

const MASRAF_KATEGORILER = [
  { key: "YEMEK",     label: "🍽 Yiyecek / İçecek",       aciklamaPlaceholder: "Proje veya iş adı",              belgeAciklamaPlaceholder: "Restoran adı, Kafe, Yemek faturası..." },
  { key: "YAKIT",     label: "⛽ Araç Yakıt / Bakım",      aciklamaPlaceholder: "Araç plaka no",                  belgeAciklamaPlaceholder: "Yakıt Bedeli, Bakım Faturası..." },
  { key: "KONAKLAMA", label: "🏨 Konaklama",               aciklamaPlaceholder: "Kaç gece, kişi sayısı, otel adı", belgeAciklamaPlaceholder: "Otel Faturası, Konaklama Makbuzu..." },
  { key: "ULASIM",    label: "🚌 Ulaşım",                  aciklamaPlaceholder: "Güzergah, kişi sayısı, neden",   belgeAciklamaPlaceholder: "Uçak Bileti, Otobüs / Taksi Fişi..." },
  { key: "KOPRU",     label: "🛣 Köprü / Otoyol Geçişi",   aciklamaPlaceholder: "Geçiş detayı, plaka",            belgeAciklamaPlaceholder: "HGS/OGS Dekont, Geçiş Makbuzu..." },
  { key: "MALZEME",   label: "🔧 Malzeme / Ekipman",       aciklamaPlaceholder: "Malzeme adı ve detayı",          belgeAciklamaPlaceholder: "Fatura / İrsaliye No...", hasSiteId: true },
  { key: "DIGER",     label: "📦 Diğer",                   aciklamaPlaceholder: "İşin detayı",                    belgeAciklamaPlaceholder: "Fiş / Fatura Açıklaması..." },
];

function MasrafFormuPanel({ currentUser, onPendingCount }) {
  const isPM       = currentUser?.email === "orhan.bedir@simsektel.com";
  const isDirektor = currentUser?.email === "duzgun.simsek@simsektel.com";
  const isMuhasebe = currentUser?.email === "muhasebe@simsektel.com";
  const isApprover = isPM || isDirektor || isMuhasebe;
  const isMobile   = typeof window !== "undefined" && window.innerWidth < 768;

  const [list, setList]           = useState([]);
  const [personelList, setPersonelList] = useState([]);
  const [bakiye, setBakiye]       = useState(null);
  const [viewForm, setViewForm]   = useState(null); // form detail view
  const [showNewForm, setShowNewForm] = useState(false);
  const [filterDurum, setFilterDurum] = useState("");
  const [notModal, setNotModal]   = useState(null); // {id, action}
  const [notText, setNotText]     = useState("");
  const [redModal, setRedModal]   = useState(null);
  const [redText, setRedText]     = useState("");

  // New form state
  const today = new Date().toISOString().split("T")[0];
  const thisMonth = today.slice(0,7);
  const [nfPersonelId, setNfPersonelId] = useState("");
  const [nfDonem, setNfDonem]     = useState(thisMonth);
  const [activeForm, setActiveForm] = useState(null); // saved form being edited
  const [kalemForm, setKalemForm] = useState({ kategori:"YEMEK", tarih:today, belge_no:"", belge_aciklama:"", aciklama:"", tutar:"", site_id:"" });
  const [openKats, setOpenKats] = useState(new Set()); // collapsed by default
  const toggleKat = (key) => setOpenKats(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });
  const [kalemler, setKalemler]   = useState([]);
  const [fotoModal, setFotoModal] = useState(null); // kalem id waiting for photo after new kalem add
  const [extraFotoModal, setExtraFotoModal] = useState(null);
  const [uploadFile, setUploadFile] = useState(null);
  const [fisOlmadanAciklama, setFisOlmadanAciklama] = useState("");
  const [pendingKalemTutar, setPendingKalemTutar] = useState(null); // entered amount for OCR comparison
  const [pendingKalemKategori, setPendingKalemKategori] = useState(null);
  const [ocrResult, setOcrResult] = useState(null); // {ocr_tutar, ocr_plaka, ocr_plaka_eslesti, belgeId}
  const [tutarUyariAciklama, setTutarUyariAciklama] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [cropSrc, setCropSrc] = useState(null);       // base64 of selected image
  const [crop, setCrop] = useState(null);
  const [completedCrop, setCompletedCrop] = useState(null);
  const cropImgRef = useRef(null);
  const cropCanvasRef = useRef(null);
  const [listLoading, setListLoading] = useState(false);

  const load = async () => {
    const r = await fetch(`${API_BASE}/hr/masraf-form`);
    const data = await r.json();
    setList(data);
    if (onPendingCount) {
      let cnt = 0;
      if (isPM)       cnt = data.filter(f => f.durum === "PM_BEKLE").length;
      if (isDirektor) cnt = data.filter(f => f.durum === "DIREKTOR_BEKLE").length;
      if (isMuhasebe) cnt = data.filter(f => f.durum === "TAMAMLANDI").length;
      onPendingCount(cnt);
    }
  };

  const loadDetail = async (id) => {
    const r = await fetch(`${API_BASE}/hr/masraf-form/${id}`);
    const data = await r.json();
    setViewForm(data);
  };

  const loadPersonel = async () => {
    const r = await fetch(`${API_BASE}/hr/personel`);
    const data = await r.json();
    setPersonelList(data);
    if (currentUser?.email) {
      const match = data.find(p => (p.email || "").toLowerCase() === currentUser.email.toLowerCase());
      if (match) setNfPersonelId(String(match.id));
    }
  };

  const loadBakiye = async (pid) => {
    if (!pid) return setBakiye(null);
    const r = await fetch(`${API_BASE}/hr/masraf-form/bakiye/${pid}`);
    setBakiye(await r.json());
  };

  useEffect(() => { load(); loadPersonel(); }, []);
  useEffect(() => { if (nfPersonelId) loadBakiye(nfPersonelId); }, [nfPersonelId]);

  // Reload kalemler when activeForm changes
  const refreshActive = async (fid) => {
    const r = await fetch(`${API_BASE}/hr/masraf-form/${fid}`);
    const data = await r.json();
    setActiveForm(data);
    setKalemler(data.kalemler || []);
  };

  const handleCreateForm = async () => {
    if (!nfPersonelId) return alert("Personel seçin");
    try {
      const pid = personelList.find(p => p.id == nfPersonelId);
      const r = await fetch(`${API_BASE}/hr/masraf-form`, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          personel_id: nfPersonelId,
          talep_eden_email: currentUser?.email,
          talep_eden_ad: pid?.ad_soyad || currentUser?.ad || currentUser?.email,
          donem: nfDonem
        })
      });
      if (!r.ok) { const e = await r.json(); return alert("Hata: " + (e.error||r.status)); }
      const form = await r.json();
      if (!form.id) return alert("Form oluşturulamadı, backend'i yeniden başlatın.");
      setActiveForm(form);
      setKalemler([]);
      loadBakiye(nfPersonelId);
      setShowNewForm(false);
      load();
    } catch(e) {
      alert("Bağlantı hatası — backend çalışıyor mu? node server.js");
    }
  };

  const handleAddKalem = async () => {
    if (!kalemForm.tutar || !kalemForm.tarih) return alert("Tarih ve tutar zorunlu");
    if (!activeForm) return alert("Önce form oluşturun");
    const r = await fetch(`${API_BASE}/hr/masraf-kalem`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ ...kalemForm, form_id: activeForm.id, fis_var: true, aciklama: kalemForm.site_id ? `Site ID: ${kalemForm.site_id}${kalemForm.aciklama ? " | " + kalemForm.aciklama : ""}` : kalemForm.aciklama })
    });
    const saved = await r.json();
    // Ask for photo upload
    setFotoModal(saved.id);
    setPendingKalemTutar(Number(kalemForm.tutar));
    setPendingKalemKategori(kalemForm.kategori);
    setOcrResult(null);
    setTutarUyariAciklama("");
    setKalemForm(k => ({ ...k, belge_no:"", belge_aciklama:"", aciklama:"", tutar:"", site_id:"" }));
    refreshActive(activeForm.id);
  };

  const handleDeleteKalem = async (kid) => {
    if (!window.confirm("Bu kalemi silmek istediğinize emin misiniz?")) return;
    await fetch(`${API_BASE}/hr/masraf-kalem/${kid}`, { method:"DELETE" });
    refreshActive(activeForm.id);
  };

  const closeFotoModal = () => {
    if (cropSrc?.startsWith("blob:")) URL.revokeObjectURL(cropSrc);
    setFotoModal(null);
    setUploadFile(null);
    setOcrResult(null);
    setTutarUyariAciklama("");
    setFisOlmadanAciklama("");
    setCropSrc(null);
    setCrop(null);
    setCompletedCrop(null);
  };

  const handleUploadFoto = async (kalemId, file, fis_var, fisAciklama, tutarUyariAciklamaOverride) => {
    if (!fis_var) {
      // Fişsiz ilerleme
      await fetch(`${API_BASE}/hr/masraf-kalem/${kalemId}`, {
        method: "PUT",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ fis_var: false, fis_olmadan_aciklama: fisAciklama })
      }).catch(()=>{});
      closeFotoModal();
      refreshActive(activeForm.id);
      return;
    }

    // Upload file and get OCR results
    setIsUploading(true);
    const fd = new FormData();
    fd.append("dosya", file);
    let belge;
    try {
      const r = await fetch(`${API_BASE}/hr/masraf-belge/${kalemId}`, { method:"POST", body:fd });
      belge = await r.json();
    } finally {
      setIsUploading(false);
    }

    const { ocr_tutar, ocr_plaka, ocr_plaka_eslesti } = belge;

    // Check tutar mismatch (>5% fark veya 10 TL'den fazla)
    const entered = pendingKalemTutar || 0;
    const ocrAmt = ocr_tutar ? Number(ocr_tutar) : null;
    const hasMismatch = ocrAmt && entered &&
      (Math.abs(ocrAmt - entered) > Math.max(entered * 0.05, 10));

    // Check plate for YAKIT
    const hasPlateWarning = pendingKalemKategori === "YAKIT" && ocr_plaka && ocr_plaka_eslesti === false;

    if (hasMismatch && !tutarUyariAciklamaOverride) {
      // Show mismatch warning — keep modal open in "uyari" state
      setOcrResult({ ocr_tutar: ocrAmt, ocr_plaka, ocr_plaka_eslesti, belgeId: belge.id });
      return; // Modal switches to warning UI
    }

    if (hasPlateWarning) {
      setOcrResult({ ocr_tutar: ocrAmt, ocr_plaka, ocr_plaka_eslesti, belgeId: belge.id });
      return; // Modal switches to plate warning UI
    }

    // Save tutar warning note if provided
    if (tutarUyariAciklamaOverride && belge.id) {
      await fetch(`${API_BASE}/hr/masraf-kalem/${kalemId}`, {
        method: "PUT",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ tutar_uyari_aciklama: tutarUyariAciklamaOverride })
      }).catch(()=>{});
    }

    closeFotoModal();
    refreshActive(activeForm.id);
  };

  const handleTutarUyariDevam = async () => {
    if (!tutarUyariAciklama.trim()) return alert("Fark için açıklama zorunlu.");
    // Check plate warning after tutar approved
    if (pendingKalemKategori === "YAKIT" && ocrResult?.ocr_plaka && ocrResult?.ocr_plaka_eslesti === false) {
      // Stay in plate warning phase — mark tutar as ok
      setOcrResult(r => ({ ...r, tutarOk: true, tutarAciklama: tutarUyariAciklama }));
      return;
    }
    await fetch(`${API_BASE}/hr/masraf-kalem/${fotoModal}`, {
      method: "PUT",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ tutar_uyari_aciklama: tutarUyariAciklama })
    }).catch(()=>{});
    closeFotoModal();
    refreshActive(activeForm.id);
  };

  const handlePlakaUyariDevam = async () => {
    if (ocrResult?.tutarAciklama) {
      await fetch(`${API_BASE}/hr/masraf-kalem/${fotoModal}`, {
        method: "PUT",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ tutar_uyari_aciklama: ocrResult.tutarAciklama })
      }).catch(()=>{});
    }
    closeFotoModal();
    refreshActive(activeForm.id);
  };

  const handleSubmit = async () => {
    if (!activeForm) return;
    if (kalemler.length === 0) return alert("En az bir masraf kalemi ekleyin");
    if (!window.confirm("Masraf formunu PM onayına göndermek istediğinize emin misiniz?")) return;
    await fetch(`${API_BASE}/hr/masraf-form/${activeForm.id}/submit`, { method:"PUT" });
    setActiveForm(null);
    setKalemler([]);
    load();
  };

  const handlePMOnayla = async () => {
    await fetch(`${API_BASE}/hr/masraf-form/${notModal.id}/pm-onayla`, {
      method:"PUT", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ pm_not: notText })
    });
    setNotModal(null); setNotText(""); load();
    if (viewForm?.id === notModal.id) loadDetail(notModal.id);
  };

  const handleDirektorOnayla = async () => {
    await fetch(`${API_BASE}/hr/masraf-form/${notModal.id}/direktor-onayla`, {
      method:"PUT", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ direktor_not: notText })
    });
    setNotModal(null); setNotText(""); load();
    if (viewForm?.id === notModal.id) loadDetail(notModal.id);
  };

  const handleReddet = async () => {
    if (!redText.trim()) return alert("Red açıklaması girilmeden reddedilemez!");
    const ep = isPM ? "pm-reddet" : "direktor-reddet";
    try {
      const r = await fetch(`${API_BASE}/hr/masraf-form/${redModal}/${ep}`, {
        method:"PUT", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ red_aciklama: redText, reddeden_email: currentUser?.email })
      });
      if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error || `Sunucu hatası (${r.status})`); }
      setRedModal(null); setRedText(""); load();
      if (viewForm?.id === redModal) loadDetail(redModal);
    } catch(err) { alert("Reddetme başarısız: " + err.message); }
  };

  const durumBadge = (durum) => {
    const map = {
      TASLAK:         { bg:"#f3f4f6", color:"#374151", label:"Taslak" },
      PM_BEKLE:       { bg:"#fef9c3", color:"#713f12", label:"PM Onayı Bekleniyor" },
      DIREKTOR_BEKLE: { bg:"#fed7aa", color:"#92400e", label:"Direktör Onayında" },
      TAMAMLANDI:     { bg:"#dcfce7", color:"#166534", label:"Onaylandı ✓" },
      ARSIVLENDI:     { bg:"#ede9fe", color:"#5b21b6", label:"🗂 Arşivlendi" },
      REDDEDILDI:     { bg:"#fee2e2", color:"#991b1b", label:"Reddedildi" },
    };
    const s = map[durum] || { bg:"#f3f4f6", color:"#6b7280", label: durum };
    return <span style={{ background:s.bg, color:s.color, borderRadius:"20px", padding:"3px 12px", fontSize:12, fontWeight:600, whiteSpace:"nowrap" }}>{s.label}</span>;
  };

  const myPending = isPM ? list.filter(f=>f.durum==="PM_BEKLE").length
    : isDirektor ? list.filter(f=>f.durum==="DIREKTOR_BEKLE").length
    : isMuhasebe ? list.filter(f=>f.durum==="TAMAMLANDI").length : 0;

  const visibleList = list.filter(f => {
    if (!isApprover && f.talep_eden_email !== currentUser?.email) return false;
    if (isApprover && f.durum === "TASLAK") return false;
    if (filterDurum && f.durum !== filterDurum) return false;
    return true;
  });

  const totalKalem = kalemler.reduce((s,k)=>s+Number(k.tutar),0);
  const cardSt = { background:"#fff", borderRadius:"16px", boxShadow:"0 4px 20px rgba(0,0,0,0.07)", border:"1px solid #f3f4f6", padding:"24px" };

  // ── Detail view ──
  if (viewForm) {
    const vToplam = (viewForm.kalemler||[]).reduce((s,k)=>s+Number(k.tutar),0);
    const needsPMAction = isPM && viewForm.durum === "PM_BEKLE";
    const needsDirektorAction = isDirektor && viewForm.durum === "DIREKTOR_BEKLE";
    const isOwner = currentUser?.email === viewForm.talep_eden_email;
    const canDelete = (isOwner || isPM) && viewForm.durum !== "TAMAMLANDI";

    const handleDeleteView = async () => {
      if (!window.confirm("Bu masraf formu silinecek. Emin misiniz?")) return;
      await fetch(`${API_BASE}/hr/masraf-form/${viewForm.id}`, { method: "DELETE" });
      setViewForm(null);
      load();
    };

    return (
      <div style={{ maxWidth:"900px", margin:"24px auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"16px" }}>
          <button onClick={()=>setViewForm(null)} style={{ background:"#f3f4f6", border:"1px solid #d1d5db", cursor:"pointer", color:"#374151", fontSize:"13px", fontWeight:600, padding:"7px 16px", borderRadius:"8px" }}>← Listeye Dön</button>
          {canDelete && (
            <button onClick={handleDeleteView} style={{ background:"#fee2e2", border:"1px solid #fca5a5", cursor:"pointer", color:"#dc2626", fontSize:"13px", fontWeight:600, padding:"7px 16px", borderRadius:"8px" }}>🗑 Formu Sil</button>
          )}
        </div>
        <div style={{ ...cardSt, marginBottom:"16px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div>
              <h2 style={{ margin:"0 0 4px", fontSize:"20px" }}>🧾 Masraf Formu #{viewForm.id}</h2>
              <div style={{ color:"#6b7280", fontSize:"14px" }}>{viewForm.talep_eden_ad} · {viewForm.donem} · {viewForm.personel_ad}</div>
            </div>
            <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
              {durumBadge(viewForm.durum)}
              <a href={`${API_BASE}/hr/masraf-form/${viewForm.id}/excel`} style={{ padding:"8px 14px", background:"#166534", color:"#fff", borderRadius:"8px", fontSize:"13px", fontWeight:600, textDecoration:"none" }}>📥 Excel</a>
              {(viewForm.kalemler||[]).some(k=>(k.belgeler||[]).length>0) && (
                <a href={`${API_BASE}/hr/masraf-form/${viewForm.id}/pdf`} style={{ padding:"8px 14px", background:"#7c3aed", color:"#fff", borderRadius:"8px", fontSize:"13px", fontWeight:600, textDecoration:"none" }}>📄 PDF Fişler</a>
              )}
            </div>
          </div>
          {viewForm.red_aciklama && <div style={{ marginTop:"12px", background:"#fee2e2", borderRadius:"8px", padding:"10px 14px", color:"#991b1b", fontSize:"13px" }}>❌ Red: {viewForm.red_aciklama}</div>}
          {viewForm.pm_not && <div style={{ marginTop:"8px", background:"#fef9c3", borderRadius:"8px", padding:"8px 12px", color:"#713f12", fontSize:"13px" }}>PM Notu: {viewForm.pm_not}</div>}
          {viewForm.direktor_not && <div style={{ marginTop:"8px", background:"#d1fae5", borderRadius:"8px", padding:"8px 12px", color:"#065f46", fontSize:"13px" }}>Direktör Notu: {viewForm.direktor_not}</div>}
        </div>

        {/* Kalemler */}
        <div style={{ ...cardSt, marginBottom:"16px" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"13px" }}>
            <thead>
              <tr style={{ background:"#f9fafb" }}>
                {["Kategori","Tarih","Belge No","Açıklama","Tutar","Fiş"].map(h=>(
                  <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, color:"#374151", borderBottom:"2px solid #e5e7eb" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(viewForm.kalemler||[]).map((k,i)=>{
                const kat = MASRAF_KATEGORILER.find(m=>m.key===k.kategori);
                return (
                  <tr key={k.id} style={{ background: !k.fis_var?"#fff7ed": i%2===0?"#fff":"#fafafa", borderBottom:"1px solid #f3f4f6" }}>
                    <td style={{ padding:"10px 12px" }}>{kat?.label||k.kategori}</td>
                    <td style={{ padding:"10px 12px", whiteSpace:"nowrap" }}>{k.tarih ? new Date(k.tarih).toLocaleDateString("tr-TR") : ""}</td>
                    <td style={{ padding:"10px 12px" }}>{k.belge_no||"—"}</td>
                    <td style={{ padding:"10px 12px" }}>{k.aciklama||k.belge_aciklama||"—"}{!k.fis_var&&<div style={{ fontSize:"11px",color:"#dc2626" }}>Fişsiz: {k.fis_olmadan_aciklama}</div>}</td>
                    <td style={{ padding:"10px 12px", fontWeight:700 }}>₺{Number(k.tutar).toLocaleString("tr-TR")}</td>
                    <td style={{ padding:"10px 12px" }}>
                      {(k.belgeler||[]).length > 0
                        ? <div style={{ display:"flex", gap:"4px", flexWrap:"wrap" }}>
                            {k.belgeler.map(b=>(
                              <a key={b.id} href={b.dosya_yolu?.startsWith("http") ? b.dosya_yolu : `${API_BASE}/hr/masraf-belge/file/${b.dosya_yolu}`} target="_blank" rel="noreferrer"
                                 style={{ fontSize:"11px", background:"#eff6ff", color:"#1d4ed8", padding:"2px 8px", borderRadius:"6px", textDecoration:"none" }}>
                                📷 Fiş
                              </a>
                            ))}
                          </div>
                        : <span style={{ color:"#f59e0b", fontSize:"12px" }}>—</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background:"#1e3a5f" }}>
                <td colSpan={4} style={{ padding:"12px", fontWeight:700, color:"#fff", textAlign:"right" }}>TOPLAM</td>
                <td style={{ padding:"12px", fontWeight:700, color:"#fff", fontSize:"16px" }}>₺{vToplam.toLocaleString("tr-TR")}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Onay aksiyonları */}
        {(needsPMAction || needsDirektorAction) && (
          <div style={{ display:"flex", gap:"12px" }}>
            <button onClick={()=>{ setNotModal({ id: viewForm.id, action: needsPMAction?"pm":"dir" }); setNotText(""); }}
              style={{ padding:"12px 24px", background:"#166534", color:"#fff", border:"none", borderRadius:"10px", fontWeight:700, fontSize:"14px", cursor:"pointer" }}>
              ✅ Onayla {needsPMAction?"(PM)":"(Direktör)"}
            </button>
            <button onClick={()=>{ setRedModal(viewForm.id); setRedText(""); }}
              style={{ padding:"12px 24px", background:"#dc2626", color:"#fff", border:"none", borderRadius:"10px", fontWeight:700, fontSize:"14px", cursor:"pointer" }}>
              ❌ Reddet
            </button>
          </div>
        )}

        {/* Red modal — viewForm'un early return'ü nedeniyle buraya eklenmeli */}
        {redModal && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:2000 }}
            onClick={()=>{setRedModal(null);setRedText("");}}>
            <div style={{ background:"#fff", borderRadius:"16px", padding:"28px", width:"90%", maxWidth:"420px" }}
              onClick={e=>e.stopPropagation()}>
              <h3 style={{ margin:"0 0 16px" }}>❌ Red Nedeni</h3>
              <textarea value={redText} onChange={e=>setRedText(e.target.value)} rows={3} placeholder="Red nedenini açıklayın (zorunlu)"
                style={{ width:"100%", padding:"10px 12px", borderRadius:"10px", border:"1.5px solid #e5e7eb", fontSize:"14px", boxSizing:"border-box", resize:"vertical" }} />
              <div style={{ display:"flex", gap:"10px", marginTop:"14px" }}>
                <button onClick={handleReddet} style={{ flex:1, padding:"12px", background:"#dc2626", color:"#fff", border:"none", borderRadius:"10px", fontWeight:700, cursor:"pointer" }}>Reddet</button>
                <button onClick={()=>{setRedModal(null);setRedText("");}} style={{ padding:"12px 20px", background:"#f3f4f6", color:"#374151", border:"none", borderRadius:"10px", cursor:"pointer" }}>Vazgeç</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── New / Edit form (TASLAK only) ──
  if (activeForm) {
    const canDownload = isPM || isDirektor || isMuhasebe;
    const isLocked = activeForm.durum !== "TASLAK";
    const inp = { width:"100%", padding:"8px 10px", borderRadius:"8px", border:"1.5px solid #d1d5db", fontSize:"13px", boxSizing:"border-box", background:"#fff", color:"#1f2937" };
    return (
      <div style={{ maxWidth:"860px", margin:"0 auto", padding:"16px" }}>
        {/* Üst başlık - Excel tarzı */}
        <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:"12px", marginBottom:"12px", overflow:"hidden" }}>
          <div style={{ background:"#1e3a5f", padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ color:"#fff" }}>
              <div style={{ fontWeight:800, fontSize:"18px", letterSpacing:"1px" }}>MASRAF FORMU</div>
              <div style={{ fontSize:"12px", opacity:0.8, marginTop:"2px" }}>{activeForm.personel_ad || activeForm.talep_eden_ad} · Dönem: {activeForm.donem}</div>
            </div>
            <div style={{ textAlign:"right", color:"#93c5fd", fontSize:"11px" }}>
              <div>Doküman Kodu: MF.{String(activeForm.form_no || activeForm.id).padStart(3, "0")}</div>
              {bakiye !== null && (
                <div style={{ marginTop:"6px", color:"#fff" }}>
                  <span style={{ fontWeight:700, fontSize:"16px" }}>İş Avansı: ₺{Number(bakiye.bakiye).toLocaleString("tr-TR")}</span>
                </div>
              )}
            </div>
          </div>
          <div style={{ padding:"10px 20px", background:"#f9fafb", display:"flex", gap:"16px", alignItems:"center", borderTop:"1px solid #e5e7eb" }}>
            <button onClick={()=>{ setActiveForm(null); setKalemler([]); load(); }}
              style={{ padding:"6px 14px", background:"none", border:"1px solid #d1d5db", borderRadius:"8px", fontSize:"13px", cursor:"pointer", color:"#374151" }}>← Geri</button>
            {isLocked && <span style={{ fontSize:"12px", color:"#dc2626", fontWeight:600 }}>🔒 Onaya gönderildi — düzenleme kapalı</span>}
            <div style={{ marginLeft:"auto", display:"flex", gap:"8px" }}>
              {canDownload && <a href={`${API_BASE}/hr/masraf-form/${activeForm.id}/excel`} style={{ padding:"7px 14px", background:"#166534", color:"#fff", borderRadius:"8px", fontSize:"12px", fontWeight:700, textDecoration:"none" }}>📥 Excel</a>}
              {canDownload && <a href={`${API_BASE}/hr/masraf-form/${activeForm.id}/pdf`} style={{ padding:"7px 14px", background:"#7c3aed", color:"#fff", borderRadius:"8px", fontSize:"12px", fontWeight:700, textDecoration:"none" }}>📄 PDF Fişler</a>}
            </div>
          </div>
        </div>

        {/* Kategori bölümleri - Excel sütun formatı */}
        {MASRAF_KATEGORILER.map(kat => {
          const katKalemler = kalemler.filter(k => k.kategori === kat.key);
          const katToplam = katKalemler.reduce((s,k)=>s+Number(k.tutar),0);
          const isAdding = !isLocked && kalemForm.kategori === kat.key;
          const isOpen = openKats.has(kat.key) || isAdding;
          return (
            <div key={kat.key} style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:"10px", marginBottom:"10px", overflow:"hidden" }}>
              {/* Bölüm başlığı — tıklanabilir */}
              <div onClick={()=>toggleKat(kat.key)} style={{ background:"#2563eb", padding:"9px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", userSelect:"none" }}>
                <span style={{ color:"#fff", fontWeight:700, fontSize:"13px", textTransform:"uppercase" }}>{kat.label}</span>
                <div style={{ display:"flex", gap:"12px", alignItems:"center" }}>
                  {katToplam > 0 && <span style={{ color:"#bfdbfe", fontWeight:700, fontSize:"13px" }}>₺{katToplam.toLocaleString("tr-TR")}</span>}
                  {katKalemler.length > 0 && <span style={{ background:"rgba(255,255,255,0.2)", color:"#fff", borderRadius:"10px", fontSize:"11px", padding:"1px 7px", fontWeight:700 }}>{katKalemler.length}</span>}
                  <span style={{ color:"#bfdbfe", fontSize:"14px" }}>{isOpen ? "▲" : "▼"}</span>
                </div>
              </div>

              {!isOpen && null}
              {isOpen && <>
              {/* Kayıtlı satırlar — mobil kart / masaüstü grid */}
              {isMobile ? (
                <>
                  {katKalemler.length === 0 && !isAdding && (
                    <div style={{ padding:"10px 16px", fontSize:"12px", color:"#9ca3af", fontStyle:"italic" }}>Henüz kayıt yok</div>
                  )}
                  {katKalemler.map(k=>(
                    <div key={k.id} style={{ padding:"10px 14px", borderBottom:"1px solid #f3f4f6", background:"#fff" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"4px" }}>
                        <div style={{ fontSize:"12px", color:"#6b7280" }}>{k.tarih ? new Date(k.tarih).toLocaleDateString("tr-TR"):""}{k.belge_no ? ` · #${k.belge_no}`:""}</div>
                        <div style={{ fontWeight:800, fontSize:"14px", color:"#1e3a5f" }}>₺{Number(k.tutar).toLocaleString("tr-TR")}</div>
                      </div>
                      {k.belge_aciklama && <div style={{ fontSize:"13px", color:"#374151", marginBottom:"2px" }}>{k.belge_aciklama}</div>}
                      {k.aciklama && <div style={{ fontSize:"12px", color:"#6b7280" }}>{k.aciklama}</div>}
                      {!k.fis_var && <div style={{ fontSize:"11px", color:"#dc2626", marginTop:"2px" }}>⚠ Fişsiz: {k.fis_olmadan_aciklama}</div>}
                      {(k.belgeler||[]).length>0 && <div style={{ fontSize:"11px", color:"#059669", marginTop:"2px" }}>📷 {k.belgeler.length} fiş eklendi</div>}
                      <div style={{ display:"flex", gap:"6px", marginTop:"8px" }}>
                        <button onClick={()=>{ setExtraFotoModal(k.id); setUploadFile(null); }}
                          style={{ padding:"6px 12px", background:"#eff6ff", color:"#1d4ed8", border:"none", borderRadius:"7px", fontSize:"12px", fontWeight:600, cursor:"pointer" }}>📷 Fiş Ekle</button>
                        {!isLocked && <button onClick={()=>handleDeleteKalem(k.id)}
                          style={{ padding:"6px 12px", background:"#fee2e2", color:"#991b1b", border:"none", borderRadius:"7px", fontSize:"12px", fontWeight:600, cursor:"pointer" }}>✕ Sil</button>}
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <>
                {/* Sütun başlıkları - sadece masaüstü */}
                <div style={{ display:"grid", gridTemplateColumns:"108px 80px 180px 1fr 100px 72px", background:"#dbeafe", borderBottom:"1px solid #bfdbfe" }}>
                  {["TARİH","BELGE NO","BELGE AÇIKLAMASI",`AÇIKLAMA (${kat.aciklamaPlaceholder.toUpperCase()})`, "MASRAF TUTARI",""].map((h,i)=>(
                    <div key={i} style={{ padding:"5px 8px", fontSize:"10px", fontWeight:800, color:"#1e40af" }}>{h}</div>
                  ))}
                </div>
                {katKalemler.length === 0 && !isAdding && (
                  <div style={{ padding:"10px 16px", fontSize:"12px", color:"#9ca3af", fontStyle:"italic" }}>Henüz kayıt yok</div>
                )}
                {katKalemler.map((k,i)=>(
                  <div key={k.id} style={{ display:"grid", gridTemplateColumns:"108px 80px 180px 1fr 100px 72px", background: i%2===0?"#fff":"#f9fafb", borderBottom:"1px solid #f3f4f6", alignItems:"start" }}>
                    <div style={{ padding:"8px 8px", fontSize:"12px", color:"#374151" }}>{k.tarih ? new Date(k.tarih).toLocaleDateString("tr-TR"):""}</div>
                    <div style={{ padding:"8px 8px", fontSize:"12px", color:"#6b7280" }}>{k.belge_no||"—"}</div>
                    <div style={{ padding:"8px 8px", fontSize:"12px", color:"#374151" }}>{k.belge_aciklama||"—"}</div>
                    <div style={{ padding:"8px 8px", fontSize:"12px", color:"#374151" }}>
                      {k.aciklama||"—"}
                      {!k.fis_var && <div style={{ fontSize:"10px",color:"#dc2626",marginTop:"2px" }}>⚠ Fişsiz: {k.fis_olmadan_aciklama}</div>}
                      {(k.belgeler||[]).length>0 && <div style={{ fontSize:"10px",color:"#059669",marginTop:"2px" }}>📷 {k.belgeler.length} fiş</div>}
                    </div>
                    <div style={{ padding:"8px 8px", fontWeight:700, fontSize:"12px", textAlign:"right" }}>₺{Number(k.tutar).toLocaleString("tr-TR")}</div>
                    <div style={{ padding:"6px 6px", display:"flex", gap:"3px", justifyContent:"center" }}>
                      <button onClick={()=>{ setExtraFotoModal(k.id); setUploadFile(null); }} title="Fiş fotoğrafı ekle"
                        style={{ padding:"4px 7px", background:"#eff6ff", color:"#1d4ed8", border:"none", borderRadius:"5px", fontSize:"12px", cursor:"pointer" }}>📷</button>
                      {!isLocked && <button onClick={()=>handleDeleteKalem(k.id)} title="Sil"
                        style={{ padding:"4px 7px", background:"#fee2e2", color:"#991b1b", border:"none", borderRadius:"5px", fontSize:"12px", cursor:"pointer" }}>✕</button>}
                    </div>
                  </div>
                ))}
                </>
              )}

              {/* Toplam satırı */}
              {katKalemler.length > 0 && (
                <div style={{ display:"flex", justifyContent:"flex-end", padding:"6px 16px", background:"#eff6ff", borderTop:"1px solid #bfdbfe" }}>
                  <span style={{ fontSize:"11px", color:"#1e40af", marginRight:"8px", fontWeight:600 }}>
                    {kat.label.split(" GİDER")[0]} Toplamı:
                  </span>
                  <span style={{ fontWeight:800, fontSize:"13px", color:"#1e3a5f" }}>₺{katToplam.toLocaleString("tr-TR")}</span>
                </div>
              )}

              {/* Satır ekleme formu */}
              {!isLocked && (
                isAdding ? (
                  <div style={{ padding:"14px 16px", background:"#f0f9ff", borderTop:"2px solid #2563eb" }}>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px", marginBottom:"10px" }}>
                      <div>
                        <div style={{ fontSize:"10px", fontWeight:700, color:"#1e40af", marginBottom:"3px" }}>TARİH *</div>
                        <input type="date" value={kalemForm.tarih} onChange={e=>setKalemForm(k=>({...k,tarih:e.target.value}))} style={inp} />
                      </div>
                      <div>
                        <div style={{ fontSize:"10px", fontWeight:700, color:"#1e40af", marginBottom:"3px" }}>BELGE NO</div>
                        <input value={kalemForm.belge_no} onChange={e=>setKalemForm(k=>({...k,belge_no:e.target.value}))} placeholder="Fatura / fiş no" style={inp} />
                      </div>
                    </div>
                    <div style={{ marginBottom:"10px" }}>
                      <div style={{ fontSize:"10px", fontWeight:700, color:"#1e40af", marginBottom:"3px" }}>BELGE AÇIKLAMASI</div>
                      <input value={kalemForm.belge_aciklama} onChange={e=>setKalemForm(k=>({...k,belge_aciklama:e.target.value}))} placeholder={kat.belgeAciklamaPlaceholder || "Belge açıklaması..."} style={inp} />
                    </div>
                    {kat.hasSiteId && (
                      <div style={{ marginBottom:"10px" }}>
                        <div style={{ fontSize:"10px", fontWeight:700, color:"#1e40af", marginBottom:"3px" }}>SİTE ID</div>
                        <input value={kalemForm.site_id} onChange={e=>setKalemForm(k=>({...k,site_id:e.target.value}))} placeholder="Örn: AI0246, TR-IST-001..." style={inp} />
                      </div>
                    )}
                    <div style={{ marginBottom:"10px" }}>
                      <div style={{ fontSize:"10px", fontWeight:700, color:"#1e40af", marginBottom:"3px" }}>AÇIKLAMA — {kat.aciklamaPlaceholder}</div>
                      <input value={kalemForm.aciklama} onChange={e=>setKalemForm(k=>({...k,aciklama:e.target.value}))} placeholder={kat.aciklamaPlaceholder} style={inp} />
                    </div>
                    <div style={{ marginBottom:"12px" }}>
                      <div style={{ fontSize:"10px", fontWeight:700, color:"#1e40af", marginBottom:"3px" }}>MASRAF TUTARI (₺) *</div>
                      <input type="number" value={kalemForm.tutar} onChange={e=>setKalemForm(k=>({...k,tutar:e.target.value}))} placeholder="0.00"
                        style={{ ...inp, fontSize:"18px", fontWeight:700, border:"2px solid #2563eb" }} />
                    </div>
                    <div style={{ display:"flex", gap:"8px" }}>
                      <button onClick={handleAddKalem}
                        style={{ flex:1, padding:"11px", background:"#1e3a5f", color:"#fff", border:"none", borderRadius:"8px", fontWeight:700, fontSize:"13px", cursor:"pointer" }}>
                        ✓ Ekle + Fiş Fotoğrafı Yükle
                      </button>
                      <button onClick={()=>setKalemForm(k=>({...k,kategori:""}))}
                        style={{ padding:"11px 16px", background:"#f3f4f6", border:"none", borderRadius:"8px", cursor:"pointer", fontSize:"13px" }}>İptal</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={()=>{ setKalemForm(k=>({...k, kategori:kat.key, belge_no:"", belge_aciklama:"", aciklama:"", tutar:"", site_id:"" })); setOpenKats(prev=>{ const s=new Set(prev); s.add(kat.key); return s; }); }}
                    style={{ width:"100%", padding:"9px", background:"#f0f9ff", border:"none", borderTop:"1px dashed #93c5fd", color:"#2563eb", fontWeight:600, fontSize:"13px", cursor:"pointer", textAlign:"center" }}>
                    + Bu Bölüme Satır Ekle
                  </button>
                )
              )}
              </>}
            </div>
          );
        })}

        {/* İCMAL / GENEL TOPLAM */}
        <div style={{ background:"#1e3a5f", borderRadius:"10px", padding:"16px 20px", marginBottom:"14px" }}>
          <div style={{ color:"#93c5fd", fontSize:"11px", fontWeight:700, marginBottom:"10px", letterSpacing:"1px" }}>İCMAL / SONUÇ</div>
          {MASRAF_KATEGORILER.map(kat=>{
            const t = kalemler.filter(k=>k.kategori===kat.key).reduce((s,k)=>s+Number(k.tutar),0);
            return t>0 ? (
              <div key={kat.key} style={{ display:"flex", justifyContent:"space-between", color:"#bfdbfe", fontSize:"13px", marginBottom:"4px" }}>
                <span>{kat.label}</span><span style={{ fontWeight:600 }}>₺{t.toLocaleString("tr-TR")}</span>
              </div>
            ) : null;
          })}
          <div style={{ borderTop:"1px solid #3b5a8a", marginTop:"10px", paddingTop:"10px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ color:"#fff", fontWeight:800, fontSize:"15px" }}>GENEL TOPLAM</span>
            <span style={{ color:"#fff", fontWeight:800, fontSize:"24px" }}>₺{totalKalem.toLocaleString("tr-TR")}</span>
          </div>
        </div>

        {/* Alt butonlar */}
        {!isLocked && (
          <div style={{ display:"flex", gap:"12px" }}>
            <button onClick={()=>{ setActiveForm(null); setKalemler([]); load(); }}
              style={{ padding:"13px 20px", background:"#f3f4f6", color:"#374151", border:"none", borderRadius:"10px", fontWeight:600, fontSize:"14px", cursor:"pointer" }}>
              💾 Kaydet (Taslak)
            </button>
            <button onClick={handleSubmit}
              style={{ padding:"13px 24px", background:"#1e3a5f", color:"#fff", border:"none", borderRadius:"10px", fontWeight:700, fontSize:"14px", cursor:"pointer", flex:1 }}>
              🚀 Birim Müdürü Onayına İlet
            </button>
          </div>
        )}

        {/* Fiş fotoğrafı upload modal */}
        {fotoModal && (() => {
          const showTutarUyari = ocrResult && !ocrResult.tutarOk && !ocrResult.tutarSkipped;
          const showPlakaUyari = ocrResult && (ocrResult.tutarOk || ocrResult.tutarSkipped || !showTutarUyari) && ocrResult.ocr_plaka && ocrResult.ocr_plaka_eslesti === false && !ocrResult.plakaOnaylandi;

          if (showPlakaUyari) return (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
              <div style={{ background:"#fff", borderRadius:"16px", padding:"28px 24px", width:"90%", maxWidth:"400px" }}>
                <h3 style={{ margin:"0 0 12px", fontSize:"18px" }}>⚠️ Plaka Sistemde Kayıtlı Değil</h3>
                <p style={{ fontSize:"14px", color:"#374151", margin:"0 0 8px" }}>
                  Fişte okunan plaka: <strong style={{ color:"#dc2626" }}>{ocrResult.ocr_plaka}</strong>
                </p>
                <p style={{ fontSize:"13px", color:"#6b7280", margin:"0 0 20px" }}>
                  Bu plaka firma araç filonuzda bulunmuyor. Yine de ilerletmek istiyor musunuz?
                </p>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
                  <button onClick={handlePlakaUyariDevam}
                    style={{ padding:"12px", background:"#f59e0b", color:"#fff", border:"none", borderRadius:"10px", fontWeight:700, cursor:"pointer" }}>
                    Yine de Devam Et
                  </button>
                  <button onClick={closeFotoModal}
                    style={{ padding:"12px", background:"#f3f4f6", color:"#374151", border:"none", borderRadius:"10px", fontWeight:600, cursor:"pointer" }}>
                    İptal
                  </button>
                </div>
              </div>
            </div>
          );

          if (showTutarUyari) return (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
              <div style={{ background:"#fff", borderRadius:"16px", padding:"28px 24px", width:"90%", maxWidth:"420px" }}>
                <h3 style={{ margin:"0 0 12px", fontSize:"18px" }}>⚠️ Tutar Farkı Tespit Edildi</h3>
                <div style={{ background:"#fef9c3", border:"1px solid #fde047", borderRadius:"10px", padding:"12px 16px", marginBottom:"16px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"4px" }}>
                    <span style={{ fontSize:"13px", color:"#713f12" }}>Girdiğiniz tutar</span>
                    <strong style={{ color:"#92400e" }}>₺{Number(pendingKalemTutar||0).toLocaleString("tr-TR")}</strong>
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between" }}>
                    <span style={{ fontSize:"13px", color:"#713f12" }}>Fişteki tutar (OCR)</span>
                    <strong style={{ color:"#dc2626" }}>₺{Number(ocrResult.ocr_tutar||0).toLocaleString("tr-TR")}</strong>
                  </div>
                </div>
                <p style={{ fontSize:"13px", color:"#6b7280", margin:"0 0 8px" }}>Farkı açıklar mısınız? (zorunlu)</p>
                <input
                  value={tutarUyariAciklama}
                  onChange={e => setTutarUyariAciklama(e.target.value)}
                  placeholder="Örn: Fiş üzerinde KDV hariç yazıyor, gerçek tutar doğru"
                  style={{ width:"100%", padding:"10px 12px", border:"1px solid #d1d5db", borderRadius:"8px", fontSize:"14px", marginBottom:"16px", boxSizing:"border-box" }}
                />
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
                  <button onClick={handleTutarUyariDevam}
                    style={{ padding:"12px", background:"#1e3a5f", color:"#fff", border:"none", borderRadius:"10px", fontWeight:700, cursor:"pointer" }}>
                    Açıklamayla Devam Et
                  </button>
                  <button onClick={closeFotoModal}
                    style={{ padding:"12px", background:"#f3f4f6", color:"#374151", border:"none", borderRadius:"10px", fontWeight:600, cursor:"pointer" }}>
                    İptal
                  </button>
                </div>
              </div>
            </div>
          );

          // Default: file selector
          return (
            <div onClick={closeFotoModal} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:1000 }}>
              <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:"20px 20px 0 0", padding:"28px 24px", width:"100%", maxWidth:"480px", position:"relative", maxHeight:"90vh", overflowY:"auto" }}>
                <button onClick={closeFotoModal}
                  style={{ position:"absolute", top:"16px", right:"16px", background:"#f3f4f6", border:"none", borderRadius:"50%", width:"30px", height:"30px", fontSize:"16px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                <h3 style={{ margin:"0 0 8px", fontSize:"18px" }}>📷 Fiş Fotoğrafı Yükle</h3>
                <p style={{ fontSize:"13px", color:"#6b7280", margin:"0 0 12px" }}>Fişi çekin veya dosya seçin. Kırpma yapabilirsiniz.</p>
                {/* Gizli inputlar */}
                <input id="fis-camera-input" type="file" accept="image/*" capture="environment"
                  style={{ position:"absolute", opacity:0, width:0, height:0, pointerEvents:"none" }}
                  onChange={e => {
                    const f = e.target.files[0];
                    if (!f) return;
                    if (cropSrc?.startsWith("blob:")) URL.revokeObjectURL(cropSrc);
                    const url = URL.createObjectURL(f);
                    e.target.value = "";
                    setCropSrc(url);
                    setCrop(null);
                    setCompletedCrop(null);
                  }} />
                <input id="fis-file-input" type="file" accept="image/*,application/pdf"
                  style={{ position:"absolute", opacity:0, width:0, height:0, pointerEvents:"none" }}
                  onChange={e => {
                    const f = e.target.files[0];
                    if (!f) return;
                    if (cropSrc?.startsWith("blob:")) URL.revokeObjectURL(cropSrc);
                    const url = URL.createObjectURL(f);
                    e.target.value = "";
                    setCropSrc(url);
                    setCrop(null);
                    setCompletedCrop(null);
                  }} />
                {!cropSrc && (
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px", marginBottom:"12px" }}>
                    <button onClick={()=>document.getElementById("fis-camera-input").click()}
                      style={{ padding:"12px", background:"#1e3a5f", color:"#fff", border:"none", borderRadius:"10px", fontWeight:600, fontSize:"14px", cursor:"pointer" }}>
                      📷 Kameradan Çek
                    </button>
                    <button onClick={()=>document.getElementById("fis-file-input").click()}
                      style={{ padding:"12px", background:"#f0f9ff", color:"#1d4ed8", border:"1.5px solid #bfdbfe", borderRadius:"10px", fontWeight:600, fontSize:"14px", cursor:"pointer" }}>
                      🗂 Dosyadan Seç
                    </button>
                  </div>
                )}
                {cropSrc && (
                  <div style={{ marginBottom:"12px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"8px" }}>
                      <p style={{ fontSize:"12px", color:"#374151", margin:0, fontWeight:600 }}>✂️ Kırpın, ardından "Onayla" ya tıklayın:</p>
                      <button onClick={()=>{ if(cropSrc?.startsWith("blob:")) URL.revokeObjectURL(cropSrc); setCropSrc(null);setCrop(null);setCompletedCrop(null);}}
                        style={{ fontSize:"12px", color:"#6b7280", background:"#f3f4f6", border:"none", borderRadius:"6px", padding:"4px 10px", cursor:"pointer" }}>
                        ↩ Yeniden Seç
                      </button>
                    </div>
                    <div style={{ maxHeight:"320px", overflowY:"auto", background:"#f9fafb", borderRadius:"8px", padding:"8px" }}>
                      <ReactCrop crop={crop} onChange={c => setCrop(c)} onComplete={c => setCompletedCrop(c)} style={{ maxWidth:"100%" }}>
                        <img ref={cropImgRef} src={cropSrc} alt="fiş" style={{ maxWidth:"100%", display:"block" }}
                          onLoad={e => {
                            const { width, height } = e.currentTarget;
                            const c = centerCrop(makeAspectCrop({ unit:"%", width:90 }, width/height, width, height), width, height);
                            setCrop(c); setCompletedCrop(c);
                          }} />
                      </ReactCrop>
                    </div>
                    <canvas ref={cropCanvasRef} style={{ display:"none" }} />
                  </div>
                )}
                {isUploading && (
                  <p style={{ fontSize:"13px", color:"#1d4ed8", background:"#dbeafe", padding:"10px 14px", borderRadius:"8px", margin:"0 0 12px" }}>
                    🔍 Fiş okunuyor, lütfen bekleyin...
                  </p>
                )}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
                  <button disabled={isUploading || !cropSrc} onClick={async () => {
                    if (!cropSrc) return;
                    let fileToUpload;
                    if (completedCrop && cropImgRef.current && completedCrop.width > 0) {
                      const img = cropImgRef.current;
                      const canvas = document.createElement("canvas");
                      const scaleX = img.naturalWidth / img.width;
                      const scaleY = img.naturalHeight / img.height;
                      canvas.width = completedCrop.width * scaleX;
                      canvas.height = completedCrop.height * scaleY;
                      const ctx = canvas.getContext("2d");
                      ctx.drawImage(img, completedCrop.x * scaleX, completedCrop.y * scaleY, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
                      const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.92));
                      fileToUpload = new File([blob], "fis.jpg", { type: "image/jpeg" });
                    } else {
                      const resp = await fetch(cropSrc);
                      const blob = await resp.blob();
                      fileToUpload = new File([blob], "fis.jpg", { type: blob.type });
                    }
                    if (cropSrc?.startsWith("blob:")) URL.revokeObjectURL(cropSrc);
                    setUploadFile(fileToUpload);
                    handleUploadFoto(fotoModal, fileToUpload, true, null);
                  }}
                    style={{ padding:"12px", background: (isUploading || !cropSrc) ? "#9ca3af" : "#1e3a5f", color:"#fff", border:"none", borderRadius:"10px", fontWeight:700, cursor: (isUploading || !cropSrc) ? "not-allowed" : "pointer" }}>
                    {isUploading ? "Okunuyor..." : "✓ Onayla ve Yükle"}
                  </button>
                  <button disabled={isUploading} onClick={()=>{ const a=prompt("Fiş olmadan ilerlemek için açıklama giriniz:"); if(a!==null) handleUploadFoto(fotoModal,null,false,a); }}
                    style={{ padding:"12px", background:"#fee2e2", color:"#991b1b", border:"none", borderRadius:"10px", fontWeight:600, cursor:"pointer" }}>
                    Fişsiz İlerlet
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Ek fiş fotoğrafı */}
        {extraFotoModal && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:1000 }}>
            <div style={{ background:"#fff", borderRadius:"20px 20px 0 0", padding:"28px 24px", width:"100%", maxWidth:"480px" }}>
              <h3 style={{ margin:"0 0 16px" }}>📷 Ek Fiş Fotoğrafı</h3>
              <input type="file" accept="image/*,application/pdf" capture="environment" onChange={e=>setUploadFile(e.target.files[0])} style={{ marginBottom:"16px", width:"100%" }} />
              <div style={{ display:"flex", gap:"8px" }}>
                <button onClick={async()=>{ if(uploadFile){ const fd=new FormData(); fd.append("dosya",uploadFile); await fetch(`${API_BASE}/hr/masraf-belge/${extraFotoModal}`,{method:"POST",body:fd}); } setExtraFotoModal(null); setUploadFile(null); refreshActive(activeForm.id); }}
                  style={{ flex:1, padding:"12px", background:"#1e3a5f", color:"#fff", border:"none", borderRadius:"10px", fontWeight:700, cursor:"pointer" }}>Yükle</button>
                <button onClick={()=>{setExtraFotoModal(null);setUploadFile(null);}}
                  style={{ padding:"12px 20px", background:"#f3f4f6", border:"none", borderRadius:"10px", cursor:"pointer" }}>Vazgeç</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── List view ──
  return (
    <div style={{ maxWidth:"1100px", margin:"24px auto" }}>
      {myPending > 0 && (
        <div style={{ background:"#fffbeb", border:"2px solid #f59e0b", borderRadius:"12px", padding:"12px 18px", marginBottom:"16px", display:"flex", alignItems:"center", gap:"10px" }}>
          <span style={{ fontSize:"20px" }}>⏳</span>
          <span style={{ fontWeight:700, color:"#92400e", fontSize:"14px" }}>{myPending} adet masraf formu onayınızı bekliyor</span>
          <span style={{ fontSize:"12px", color:"#78350f" }}>— Aşağıdaki listeden inceleyebilirsiniz</span>
        </div>
      )}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"20px" }}>
        <h2 style={{ margin:0, fontSize:"22px", fontWeight:700 }}>🧾 Masraf Formları</h2>
        {!isMuhasebe && (
          <button onClick={()=>setShowNewForm(true)} style={{ padding:"10px 18px", background:"#1f2937", color:"#fff", border:"none", borderRadius:"10px", fontWeight:600, fontSize:"14px", cursor:"pointer" }}>
            + Yeni Masraf Formu
          </button>
        )}
      </div>

      {/* Kişisel masraf özeti (personel için) */}
      {!isApprover && (() => {
        const myForms = list.filter(f => f.talep_eden_email === currentUser?.email);
        if (!myForms.length) return null;
        const total = myForms.reduce((s, f) => s + Number(f.toplam_tutar || 0), 0);
        const counts = {
          TASLAK: myForms.filter(f => f.durum === "TASLAK").length,
          BEKLEMEDE: myForms.filter(f => ["PM_BEKLE","DIREKTOR_BEKLE"].includes(f.durum)).length,
          TAMAMLANDI: myForms.filter(f => f.durum === "TAMAMLANDI").length,
          ARSIVLENDI: myForms.filter(f => f.durum === "ARSIVLENDI").length,
          REDDEDILDI: myForms.filter(f => f.durum === "REDDEDILDI").length,
        };
        return (
          <div style={{ display:"flex", gap:"10px", marginBottom:"16px", flexWrap:"wrap", alignItems:"stretch" }}>
            <div style={{ flex:"1 1 180px", background:"#f0f9ff", border:"2px solid #0ea5e9", borderRadius:"14px", padding:"14px 20px" }}>
              <div style={{ fontSize:"11px", fontWeight:800, color:"#0369a1", letterSpacing:"0.5px", marginBottom:"4px" }}>TOPLAM MASRAF</div>
              <div style={{ fontSize: isMobile?"20px":"26px", fontWeight:800, color:"#0c4a6e" }}>
                ₺{total.toLocaleString("tr-TR", { minimumFractionDigits:2, maximumFractionDigits:2 })}
              </div>
              <div style={{ fontSize:"11px", color:"#6b7280", marginTop:"4px" }}>{myForms.length} form</div>
            </div>
            <div style={{ flex:"2 1 320px", background:"#fff", border:"1.5px solid #e5e7eb", borderRadius:"14px", padding:"14px 20px", display:"flex", gap:"18px", alignItems:"center", flexWrap:"wrap" }}>
              {counts.TASLAK > 0 && <div style={{ textAlign:"center" }}><div style={{ fontSize:"18px", fontWeight:800, color:"#6b7280" }}>{counts.TASLAK}</div><div style={{ fontSize:"10px", color:"#9ca3af", fontWeight:600 }}>Taslak</div></div>}
              {counts.BEKLEMEDE > 0 && <div style={{ textAlign:"center" }}><div style={{ fontSize:"18px", fontWeight:800, color:"#d97706" }}>{counts.BEKLEMEDE}</div><div style={{ fontSize:"10px", color:"#d97706", fontWeight:600 }}>Onay Bekliyor</div></div>}
              {counts.TAMAMLANDI > 0 && <div style={{ textAlign:"center" }}><div style={{ fontSize:"18px", fontWeight:800, color:"#16a34a" }}>{counts.TAMAMLANDI}</div><div style={{ fontSize:"10px", color:"#16a34a", fontWeight:600 }}>Onaylandı</div></div>}
              {counts.ARSIVLENDI > 0 && <div style={{ textAlign:"center" }}><div style={{ fontSize:"18px", fontWeight:800, color:"#059669" }}>{counts.ARSIVLENDI}</div><div style={{ fontSize:"10px", color:"#059669", fontWeight:600 }}>Arşivlendi</div></div>}
              {counts.REDDEDILDI > 0 && <div style={{ textAlign:"center" }}><div style={{ fontSize:"18px", fontWeight:800, color:"#dc2626" }}>{counts.REDDEDILDI}</div><div style={{ fontSize:"10px", color:"#dc2626", fontWeight:600 }}>Reddedildi</div></div>}
            </div>
          </div>
        );
      })()}

      {/* Filters + Muhasebe toplu indir */}
      <div style={{ background:"#fff", borderRadius:"12px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)", padding:"14px 18px", marginBottom:"16px", display:"flex", gap:"12px", alignItems:"center", flexWrap:"wrap" }}>
        <select value={filterDurum} onChange={e=>setFilterDurum(e.target.value)}
          style={{ padding:"8px 12px", borderRadius:"10px", border:"1.5px solid #e5e7eb", fontSize:"14px" }}>
          <option value="">Tüm Durumlar</option>
          {!isApprover && <option value="TASLAK">Taslak</option>}
          <option value="PM_BEKLE">PM Onayı Bekleniyor</option>
          <option value="DIREKTOR_BEKLE">Direktör Onayında</option>
          <option value="TAMAMLANDI">Onaylandı</option>
          <option value="ARSIVLENDI">Arşivlendi</option>
          <option value="REDDEDILDI">Reddedildi</option>
        </select>
        {filterDurum && <button onClick={()=>setFilterDurum("")} style={{ padding:"8px 12px", background:"#f3f4f6", border:"none", borderRadius:"8px", cursor:"pointer", fontSize:"13px" }}>Temizle</button>}
        {isMuhasebe && (() => {
          const [dlDonem, setDlDonem] = [nfDonem, setNfDonem];
          return (
            <div style={{ display:"flex", gap:"8px", alignItems:"center", marginLeft:"auto" }}>
              <input type="month" value={nfDonem} onChange={e=>setNfDonem(e.target.value)}
                style={{ padding:"8px 10px", borderRadius:"10px", border:"1.5px solid #e5e7eb", fontSize:"13px" }} />
              <a href={`${API_BASE}/hr/masraf-form/donem/${nfDonem}/excel`}
                style={{ padding:"8px 14px", background:"#166534", color:"#fff", borderRadius:"10px", fontSize:"13px", fontWeight:700, textDecoration:"none", whiteSpace:"nowrap" }}>
                📥 Dönem Excel ({nfDonem})
              </a>
            </div>
          );
        })()}
      </div>

      {/* List */}
      {isMobile ? (
        <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
          {visibleList.length === 0 && <div style={{ textAlign:"center", color:"#9ca3af", padding:"32px" }}>Kayıt bulunamadı</div>}
          {visibleList.map(f => {
            const needsMyAction = (isPM && f.durum==="PM_BEKLE") || (isDirektor && f.durum==="DIREKTOR_BEKLE");
            const myPendingRow = !isApprover && f.talep_eden_email===currentUser?.email && ["PM_BEKLE","DIREKTOR_BEKLE"].includes(f.durum);
            const cardBorder = needsMyAction ? "3px solid #f59e0b" : myPendingRow ? "3px solid #f87171" : "3px solid #e5e7eb";
            const cardBg = needsMyAction ? "#fffbeb" : myPendingRow ? "#fef2f2" : "#fff";
            return (
              <div key={f.id} style={{ background:cardBg, border:cardBorder, borderRadius:"12px", padding:"14px 16px", boxShadow:"0 2px 8px rgba(0,0,0,0.05)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"8px" }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:"15px" }}>{f.personel_ad || f.talep_eden_ad}</div>
                    <div style={{ fontSize:"12px", color:"#6b7280" }}>#{f.id} · {f.donem}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    {durumBadge(f.durum)}
                    <div style={{ fontWeight:800, fontSize:"16px", color:"#1e3a5f", marginTop:"4px" }}>₺{Number(f.genel_toplam||0).toLocaleString("tr-TR")}</div>
                  </div>
                </div>
                {needsMyAction && <div style={{ fontSize:"12px", fontWeight:700, color:"#92400e", marginBottom:"8px" }}>⏳ Onayınızı bekliyor</div>}
                {myPendingRow && <div style={{ fontSize:"12px", fontWeight:700, color:"#b91c1c", marginBottom:"8px" }}>🕐 {f.durum==="PM_BEKLE"?"PM onayı bekleniyor":"Direktör onayı bekleniyor"}</div>}
                <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
                  <button onClick={()=>loadDetail(f.id)}
                    style={{ padding:"7px 14px", background:"#eff6ff", color:"#1d4ed8", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>İncele</button>
                  {f.durum==="TASLAK" && f.talep_eden_email===currentUser?.email && (
                    <button disabled={listLoading} onClick={async()=>{
                      setListLoading(true);
                      try { const r=await fetch(`${API_BASE}/hr/masraf-form/${f.id}`); const d=await r.json(); setActiveForm(d); setKalemler(d.kalemler||[]); loadBakiye(d.personel_id); }
                      finally { setListLoading(false); }
                    }} style={{ padding:"7px 14px", background: listLoading?"#9ca3af":"#d1fae5", color: listLoading?"#fff":"#065f46", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor: listLoading?"not-allowed":"pointer" }}>
                      {listLoading ? "Yükleniyor..." : "✏️ Düzenle"}
                    </button>
                  )}
                  {needsMyAction && (
                    <>
                      <button onClick={()=>{ setNotModal({id:f.id,action:isPM?"pm":"dir"}); setNotText(""); }}
                        style={{ padding:"7px 14px", background:"#dcfce7", color:"#166534", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>Onayla</button>
                      <button onClick={()=>{ setRedModal(f.id); setRedText(""); }}
                        style={{ padding:"7px 14px", background:"#fee2e2", color:"#991b1b", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>Reddet</button>
                    </>
                  )}
                  {isMuhasebe && f.durum==="TAMAMLANDI" && (
                    <button onClick={async()=>{ if(window.confirm("Arşivlensin mi?")){ await fetch(`${API_BASE}/hr/masraf-form/${f.id}/arsivle`,{method:"PUT"}); load(); } }}
                      style={{ padding:"7px 14px", background:"#ede9fe", color:"#5b21b6", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>🗂 Arşivle</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
      <div style={{ background:"#fff", borderRadius:"16px", boxShadow:"0 4px 20px rgba(0,0,0,0.07)", overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"13px" }}>
          <thead>
            <tr style={{ background:"#f9fafb" }}>
              {["#","Personel","Dönem","Toplam","Oluşturma","Durum","İşlemler"].map(h=>(
                <th key={h} style={{ padding:"12px 16px", textAlign:"left", fontWeight:600, color:"#374151", borderBottom:"2px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleList.length === 0 && (
              <tr><td colSpan={7} style={{ padding:"40px", textAlign:"center", color:"#9ca3af" }}>Kayıt bulunamadı</td></tr>
            )}
            {visibleList.map((f,i)=>{
              const needsMyAction = (isPM && f.durum==="PM_BEKLE") || (isDirektor && f.durum==="DIREKTOR_BEKLE");
              const myPendingRow = !isApprover && f.talep_eden_email===currentUser?.email && ["PM_BEKLE","DIREKTOR_BEKLE"].includes(f.durum);
              return (
                <tr key={f.id} style={{ borderBottom:"1px solid #f3f4f6", background: needsMyAction?"#fffbeb": myPendingRow?"#fef2f2": i%2===0?"#fff":"#fafafa", borderLeft: needsMyAction?"4px solid #f59e0b": myPendingRow?"4px solid #f87171":"4px solid transparent" }}>
                  <td style={{ padding:"12px 16px", color:"#9ca3af" }}>#{f.id}</td>
                  <td style={{ padding:"12px 16px", fontWeight:600 }}>{f.personel_ad || f.talep_eden_ad}</td>
                  <td style={{ padding:"12px 16px" }}>{f.donem}</td>
                  <td style={{ padding:"12px 16px", fontWeight:700 }}>₺{Number(f.genel_toplam||0).toLocaleString("tr-TR")}</td>
                  <td style={{ padding:"12px 16px", color:"#6b7280" }}>{f.created_at ? new Date(f.created_at).toLocaleDateString("tr-TR") : ""}</td>
                  <td style={{ padding:"12px 16px" }}>
                    {durumBadge(f.durum)}
                    {needsMyAction && <div style={{ fontSize:"10px", fontWeight:700, color:"#92400e", marginTop:"4px" }}>⏳ Onayınızı bekliyor</div>}
                    {myPendingRow && <div style={{ fontSize:"10px", fontWeight:700, color:"#b91c1c", marginTop:"4px" }}>🕐 {f.durum==="PM_BEKLE"?"PM onayı bekleniyor":"Direktör onayı bekleniyor"}</div>}
                  </td>
                  <td style={{ padding:"12px 16px" }}>
                    <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
                      <button onClick={()=>loadDetail(f.id)} style={{ padding:"4px 12px", background:"#eff6ff", color:"#1d4ed8", border:"none", borderRadius:"6px", fontSize:"12px", fontWeight:600, cursor:"pointer" }}>İncele</button>
                      {f.durum==="TASLAK" && f.talep_eden_email===currentUser?.email && (
                        <button disabled={listLoading} onClick={async()=>{
                          setListLoading(true);
                          try { const r=await fetch(`${API_BASE}/hr/masraf-form/${f.id}`); const d=await r.json(); setActiveForm(d); setKalemler(d.kalemler||[]); loadBakiye(d.personel_id); }
                          finally { setListLoading(false); }
                        }} style={{ padding:"4px 12px", background: listLoading?"#9ca3af":"#d1fae5", color: listLoading?"#fff":"#065f46", border:"none", borderRadius:"6px", fontSize:"12px", fontWeight:600, cursor: listLoading?"not-allowed":"pointer" }}>
                          {listLoading ? "Yükleniyor..." : "Düzenle"}
                        </button>
                      )}
                      {needsMyAction && (
                        <>
                          <button onClick={()=>{ setNotModal({id:f.id,action:isPM?"pm":"dir"}); setNotText(""); }}
                            style={{ padding:"4px 10px", background:"#dcfce7", color:"#166534", border:"none", borderRadius:"6px", fontSize:"12px", fontWeight:600, cursor:"pointer" }}>Onayla</button>
                          <button onClick={()=>{ setRedModal(f.id); setRedText(""); }}
                            style={{ padding:"4px 10px", background:"#fee2e2", color:"#991b1b", border:"none", borderRadius:"6px", fontSize:"12px", fontWeight:600, cursor:"pointer" }}>Reddet</button>
                        </>
                      )}
                      {(isPM || isDirektor || isMuhasebe) && <a href={`${API_BASE}/hr/masraf-form/${f.id}/excel`} style={{ padding:"4px 10px", background:"#f0fdf4", color:"#166534", borderRadius:"6px", fontSize:"12px", fontWeight:600, textDecoration:"none" }}>Excel</a>}
                      {isMuhasebe && f.durum==="TAMAMLANDI" && (
                        <button onClick={async()=>{ if(window.confirm("Bu formu arşivlendi olarak işaretleyeceksiniz. Emin misiniz?")){ await fetch(`${API_BASE}/hr/masraf-form/${f.id}/arsivle`,{method:"PUT"}); load(); } }}
                          style={{ padding:"4px 10px", background:"#ede9fe", color:"#5b21b6", border:"none", borderRadius:"6px", fontSize:"12px", fontWeight:600, cursor:"pointer" }}>🗂 Arşivle</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {/* New form modal */}
      {showNewForm && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:isMobile?"flex-end":"center", justifyContent:"center", zIndex:1000 }}>
          <div style={{ background:"#fff", borderRadius:isMobile?"16px 16px 0 0":"16px", padding:isMobile?"20px 16px 32px":"28px", width:"100%", maxWidth:isMobile?"100%":"420px", maxHeight:"90vh", overflowY:"auto" }}>
            <h3 style={{ margin:"0 0 20px", fontSize:"18px", fontWeight:700 }}>🧾 Yeni Masraf Formu</h3>
            <div style={{ display:"grid", gap:"14px" }}>
              <div>
                <label style={{ fontSize:"12px", fontWeight:600, display:"block", marginBottom:"4px" }}>Personel</label>
                <select value={nfPersonelId} onChange={e=>setNfPersonelId(e.target.value)}
                  disabled={true}
                  style={{ width:"100%", padding:"10px 12px", borderRadius:"10px", border:"1.5px solid #e5e7eb", fontSize:"14px", background:"#f9fafb" }}>
                  <option value="">Personel seçin...</option>
                  {personelList.filter(p=>p.aktif).map(p=><option key={p.id} value={p.id}>{p.ad_soyad}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize:"12px", fontWeight:600, display:"block", marginBottom:"4px" }}>Dönem</label>
                <input type="month" value={nfDonem} onChange={e=>setNfDonem(e.target.value)}
                  style={{ width:"100%", padding:"10px 12px", borderRadius:"10px", border:"1.5px solid #e5e7eb", fontSize:"14px", boxSizing:"border-box" }} />
              </div>
              {bakiye !== null && (
                <div style={{ background:"#f0fdf4", borderRadius:"10px", padding:"12px 16px", textAlign:"center" }}>
                  <div style={{ fontSize:"12px", color:"#6b7280" }}>İş Avansı Bakiye</div>
                  <div style={{ fontSize:"24px", fontWeight:800, color: bakiye.bakiye>=0?"#166534":"#dc2626" }}>₺{Number(bakiye.bakiye).toLocaleString("tr-TR")}</div>
                </div>
              )}
              <div style={{ display:"flex", gap:"10px" }}>
                <button onClick={handleCreateForm} style={{ flex:1, padding:"12px", background:"#1f2937", color:"#fff", border:"none", borderRadius:"10px", fontWeight:700, cursor:"pointer" }}>Oluştur</button>
                <button onClick={()=>setShowNewForm(false)} style={{ padding:"12px 20px", background:"#f3f4f6", color:"#374151", border:"none", borderRadius:"10px", cursor:"pointer" }}>Vazgeç</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Onay not modal */}
      {notModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
          <div style={{ background:"#fff", borderRadius:"16px", padding:"28px", width:"90%", maxWidth:"420px" }}>
            <h3 style={{ margin:"0 0 16px" }}>✅ Onay Notu (opsiyonel)</h3>
            <textarea value={notText} onChange={e=>setNotText(e.target.value)} rows={3} placeholder="Not eklemek ister misiniz?"
              style={{ width:"100%", padding:"10px 12px", borderRadius:"10px", border:"1.5px solid #e5e7eb", fontSize:"14px", boxSizing:"border-box", resize:"vertical" }} />
            <div style={{ display:"flex", gap:"10px", marginTop:"14px" }}>
              <button onClick={notModal.action==="pm"?handlePMOnayla:handleDirektorOnayla}
                style={{ flex:1, padding:"12px", background:"#166534", color:"#fff", border:"none", borderRadius:"10px", fontWeight:700, cursor:"pointer" }}>Onayla</button>
              <button onClick={()=>{setNotModal(null);setNotText("");}}
                style={{ padding:"12px 20px", background:"#f3f4f6", color:"#374151", border:"none", borderRadius:"10px", cursor:"pointer" }}>Vazgeç</button>
            </div>
          </div>
        </div>
      )}

      {/* Red modal */}
      {redModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
          <div style={{ background:"#fff", borderRadius:"16px", padding:"28px", width:"90%", maxWidth:"420px" }}>
            <h3 style={{ margin:"0 0 16px" }}>❌ Red Nedeni</h3>
            <textarea value={redText} onChange={e=>setRedText(e.target.value)} rows={3} placeholder="Red nedenini açıklayın (zorunlu)"
              style={{ width:"100%", padding:"10px 12px", borderRadius:"10px", border:"1.5px solid #e5e7eb", fontSize:"14px", boxSizing:"border-box", resize:"vertical" }} />
            <div style={{ display:"flex", gap:"10px", marginTop:"14px" }}>
              <button onClick={handleReddet} style={{ flex:1, padding:"12px", background:"#dc2626", color:"#fff", border:"none", borderRadius:"10px", fontWeight:700, cursor:"pointer" }}>Reddet</button>
              <button onClick={()=>{setRedModal(null);setRedText("");}} style={{ padding:"12px 20px", background:"#f3f4f6", color:"#374151", border:"none", borderRadius:"10px", cursor:"pointer" }}>Vazgeç</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IsAvansPanel({ currentUser, onPendingCount }) {
  const [list, setList] = useState([]);
  const [personelList, setPersonelList] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    personel_id: "", tutar: "", tarih: new Date().toISOString().split("T")[0],
    aciklama: "", not_aciklama: "", gider_turu: "", bolge: "", proje: ""
  });
  const [searchText, setSearchText] = useState("");
  const [filterDurum, setFilterDurum] = useState("");
  const [filterGider, setFilterGider] = useState("");
  const [filterBolge, setFilterBolge] = useState("");
  const [filterProje, setFilterProje] = useState("");
  const [filterBaslangic, setFilterBaslangic] = useState("");
  const [filterBitis, setFilterBitis] = useState("");
  const [redModal, setRedModal] = useState(null);
  const [redText, setRedText] = useState("");
  const [saving, setSaving] = useState(false);
  const [avansBakiye, setAvansBakiye] = useState(null);
  const [notTooltip, setNotTooltip] = useState({ visible: false, x: 0, y: 0, aciklama: "", not_aciklama: "" });

  const _email = (currentUser?.email || "").toLowerCase();
  const isPM = _email === "orhan.bedir@simsektel.com";
  const isDirektor = _email === "duzgun.simsek@simsektel.com";
  const isMuhasebe = _email === "muhasebe@simsektel.com";
  const isRolloutMudur = _email === "nurcan.kus@simsektel.com" || _email === "serdar.altinova@simsektel.com" || (currentUser?.role || "").toLowerCase() === "rollout_mudur";
  const isRequester = !isPM && !isDirektor && !isMuhasebe && !isRolloutMudur;
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  const loadBakiye = async () => {
    if (!currentUser?.email) return;
    const r = await fetch(`${API_BASE}/hr/is-avans/bakiye?email=${encodeURIComponent(currentUser.email)}`);
    if (r.ok) setAvansBakiye(await r.json());
  };

  const load = async () => {
    const r = await fetch(`${API_BASE}/hr/is-avans`);
    const data = await r.json();
    setList(data);
    if (onPendingCount) {
      const email = currentUser?.email;
      let cnt = 0;
      if (email === "orhan.bedir@simsektel.com") cnt = data.filter(t => t.durum === "TALEP").length;
      else if (email === "duzgun.simsek@simsektel.com") cnt = data.filter(t => t.durum === "PM_ONAY").length;
      else if (email === "muhasebe@simsektel.com") cnt = data.filter(t => t.durum === "DIREKTOR_ONAY").length;
      onPendingCount(cnt);
    }
  };

  const loadPersonel = async () => {
    const r = await fetch(`${API_BASE}/hr/personel`);
    setPersonelList(await r.json());
  };

  useEffect(() => { load(); loadPersonel(); loadBakiye(); }, []);

  const visibleList = list.filter(t => {
    if (isRequester && t.talep_eden_email !== currentUser?.email) return false;
    if (searchText) {
      const s = searchText.toLowerCase();
      if (!t.talep_eden_ad?.toLowerCase().includes(s) && !t.personel_ad?.toLowerCase().includes(s) && !t.aciklama?.toLowerCase().includes(s)) return false;
    }
    if (filterDurum && t.durum !== filterDurum) return false;
    if (filterGider && t.gider_turu !== filterGider) return false;
    if (filterBolge && t.bolge !== filterBolge) return false;
    if (filterProje && t.proje !== filterProje) return false;
    if (filterBaslangic && t.tarih?.split("T")[0] < filterBaslangic) return false;
    if (filterBitis && t.tarih?.split("T")[0] > filterBitis) return false;
    return true;
  });

  const openNew = () => {
    setEditingId(null);
    setForm({ personel_id: "", tutar: "", tarih: new Date().toISOString().split("T")[0], aciklama: "", not_aciklama: "", gider_turu: "", bolge: "", proje: "" });
    setShowModal(true);
  };

  const openEdit = (t) => {
    setEditingId(t.id);
    setForm({ personel_id: t.personel_id || "", tutar: t.tutar, tarih: t.tarih?.split("T")[0] || t.tarih, aciklama: t.aciklama || "", not_aciklama: t.not_aciklama || "", gider_turu: t.gider_turu || "", bolge: t.bolge || "", proje: t.proje || "" });
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        ...form,
        talep_eden_email: currentUser?.email,
        talep_eden_ad: currentUser?.name || currentUser?.email,
      };
      if (editingId) {
        await fetch(`${API_BASE}/hr/is-avans/${editingId}`, { method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body) });
      } else {
        await fetch(`${API_BASE}/hr/is-avans`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body) });
      }
      setShowModal(false);
      load();
    } catch (err) { alert(err.message); }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Bu talebi silmek istediğinize emin misiniz?")) return;
    await fetch(`${API_BASE}/hr/is-avans/${id}`, { method: "DELETE" });
    load();
  };

  const handleOnayla = async (id) => {
    await fetch(`${API_BASE}/hr/is-avans/${id}/onayla`, { method: "PUT" });
    load(); loadBakiye();
  };

  const handleReddet = async () => {
    if (!redText.trim()) { alert("Red açıklaması girilmeden reddedilemez!"); return; }
    try {
      const r = await fetch(`${API_BASE}/hr/is-avans/${redModal}/reddet`, {
        method: "PUT",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ red_aciklama: redText, reddeden_email: currentUser?.email })
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `Sunucu hatası (${r.status})`);
      }
      setRedModal(null);
      setRedText("");
      load(); loadBakiye();
    } catch (err) {
      alert("Reddetme işlemi başarısız: " + err.message);
    }
  };

  const durumBadge = (durum) => {
    const map = {
      TALEP: { bg: "#e5e7eb", color: "#374151", label: "Talep Edildi" },
      PM_ONAY: { bg: "#fed7aa", color: "#92400e", label: "Direktör Onayında" },
      DIREKTOR_ONAY: { bg: "#dcfce7", color: "#166534", label: "Onaylandı · Ödeme Bekler" },
      MUHASEBE_ONAY: { bg: "#fef9c3", color: "#713f12", label: "Muhasebe Onayında" },
      TAMAMLANDI: { bg: "#dcfce7", color: "#166534", label: "Tamamlandı" },
      REDDEDILDI: { bg: "#fee2e2", color: "#991b1b", label: "Reddedildi" },
    };
    const s = map[durum] || { bg: "#f3f4f6", color: "#6b7280", label: durum };
    return <span style={{ background: s.bg, color: s.color, borderRadius: "20px", padding: "3px 12px", fontSize: 12, fontWeight: 600 }}>{s.label}</span>;
  };

  const cardSt = { background: "#fff", borderRadius: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.07)", border: "1px solid #f3f4f6", padding: "24px" };

  const myPendingCount =
    isPM ? list.filter(t => t.durum === "TALEP").length :
    isDirektor ? list.filter(t => t.durum === "PM_ONAY").length :
    isMuhasebe ? list.filter(t => t.durum === "DIREKTOR_ONAY").length : 0;

  const NotTooltipEl = notTooltip.visible ? (() => {
    const TW = 300;
    const showRight = notTooltip.x + TW + 24 <= window.innerWidth;
    const left = Math.max(8, showRight ? notTooltip.x + 16 : notTooltip.x - TW - 16);
    const top = Math.max(8, Math.min(notTooltip.y - 8, window.innerHeight - 320));
    return (
      <div style={{ position:"fixed", zIndex:9999, left, top, width:`${TW}px`, background:"#fff", borderRadius:"14px", boxShadow:"0 4px 6px -1px rgba(0,0,0,0.1),0 10px 30px rgba(0,0,0,0.18)", border:"1px solid #e2e8f0", pointerEvents:"none", overflow:"hidden" }}>
        {notTooltip.aciklama && (
          <div style={{ padding:"12px 16px", borderBottom: notTooltip.not_aciklama ? "1px solid #f1f5f9" : "none" }}>
            <div style={{ fontSize:"10px", fontWeight:800, color:"#3b82f6", letterSpacing:"0.8px", textTransform:"uppercase", marginBottom:"5px" }}>● Açıklama</div>
            <div style={{ fontSize:"13px", color:"#1e293b", lineHeight:"1.6", whiteSpace:"pre-wrap" }}>{notTooltip.aciklama}</div>
          </div>
        )}
        {notTooltip.not_aciklama && (
          <div style={{ padding:"12px 16px", background: notTooltip.aciklama ? "#fafafa" : "#fff" }}>
            <div style={{ fontSize:"10px", fontWeight:800, color:"#d97706", letterSpacing:"0.8px", textTransform:"uppercase", marginBottom:"5px" }}>● Not</div>
            <div style={{ fontSize:"13px", color:"#374151", lineHeight:"1.6", whiteSpace:"pre-wrap" }}>{notTooltip.not_aciklama}</div>
          </div>
        )}
      </div>
    );
  })() : null;

  return (
    <div style={{ maxWidth: "1100px", margin: "24px auto" }}>
      {NotTooltipEl}
      {myPendingCount > 0 && (
        <div style={{ background:"#fffbeb", border:"2px solid #f59e0b", borderRadius:"12px", padding:"12px 18px", marginBottom:"16px", display:"flex", alignItems:"center", gap:"10px" }}>
          <span style={{ fontSize:"20px" }}>⏳</span>
          <span style={{ fontWeight:700, color:"#92400e", fontSize:"14px" }}>
            {myPendingCount} adet talep onayınızı bekliyor
          </span>
          <span style={{ fontSize:"12px", color:"#78350f" }}>— Aşağıdaki sarı satırlara bakın</span>
        </div>
      )}
      {/* Bakiye kutusu */}
      {avansBakiye !== null && (
        <div style={{ display:"flex", gap:"10px", marginBottom:"16px", flexWrap:"wrap" }}>
          <div style={{ flex:1, minWidth:"140px", background: avansBakiye.bakiye >= 0 ? "#f0fdf4" : "#fef2f2", border:`2px solid ${avansBakiye.bakiye >= 0 ? "#16a34a" : "#dc2626"}`, borderRadius:"14px", padding:"14px 20px" }}>
            <div style={{ fontSize:"11px", fontWeight:700, color: avansBakiye.bakiye >= 0 ? "#15803d" : "#b91c1c", letterSpacing:"0.5px", marginBottom:"4px" }}>İŞ AVANSI BAKİYE</div>
            <div style={{ fontSize: isMobile?"22px":"28px", fontWeight:800, color: avansBakiye.bakiye >= 0 ? "#15803d" : "#b91c1c" }}>
              {avansBakiye.bakiye < 0 ? "-" : ""}₺{Math.abs(avansBakiye.bakiye).toLocaleString("tr-TR", { minimumFractionDigits:2, maximumFractionDigits:2 })}
            </div>
            <div style={{ fontSize:"11px", color:"#6b7280", marginTop:"4px" }}>
              Toplam avans: ₺{Number(avansBakiye.avans).toLocaleString("tr-TR")} · Arşivlenen masraf: ₺{Number(avansBakiye.masraf).toLocaleString("tr-TR")}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h2 style={{ margin: 0, fontSize: isMobile?"18px":"22px", fontWeight: 700 }}>🏗 İş Avansı</h2>
        <div style={{ display: "flex", gap: "8px" }}>
          {!isMobile && (() => {
            const p = new URLSearchParams();
            if (isRequester) p.set("email", currentUser?.email || "");
            if (filterDurum) p.set("durum", filterDurum);
            if (filterGider) p.set("gider_turu", filterGider);
            if (filterBolge) p.set("bolge", filterBolge);
            if (filterProje) p.set("proje", filterProje);
            if (filterBaslangic) p.set("baslangic", filterBaslangic);
            if (filterBitis) p.set("bitis", filterBitis);
            const qs = p.toString();
            return <a href={`${API_BASE}/hr/is-avans/excel${qs ? "?" + qs : ""}`} style={{ padding: "10px 16px", background: "#166534", color: "#fff", borderRadius: "10px", fontWeight: 600, fontSize: "14px", textDecoration: "none" }}>📥 Excel</a>;
          })()}
          {!isMuhasebe && (
            <button onClick={openNew} style={{ padding: isMobile?"10px 16px":"10px 18px", background: "#1e3a5f", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 600, fontSize: "14px", cursor: "pointer" }}>
              + Yeni Talep
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ ...cardSt, padding: "16px 20px", marginBottom: "16px", display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Ara (isim, personel, açıklama...)"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          style={{ padding: "8px 14px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px", minWidth: "200px" }}
        />
        <input type="date" value={filterBaslangic} onChange={e => setFilterBaslangic(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px" }} />
        <span style={{ color: "#9ca3af" }}>—</span>
        <input type="date" value={filterBitis} onChange={e => setFilterBitis(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px" }} />
        <select value={filterGider} onChange={e => setFilterGider(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px", background: "#fff" }}>
          <option value="">Tüm Gider Türleri</option>
          {GIDER_TURLERI.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={filterBolge} onChange={e => setFilterBolge(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px", background: "#fff" }}>
          <option value="">Tüm Bölgeler</option>
          {BOLGELER.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={filterProje} onChange={e => setFilterProje(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px", background: "#fff" }}>
          <option value="">Tüm Projeler</option>
          {PROJELER.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filterDurum} onChange={e => setFilterDurum(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px", background: "#fff" }}>
          <option value="">Tüm Durumlar</option>
          <option value="TALEP">Talep Edildi</option>
          <option value="PM_ONAY">Direktör Onayında</option>
          <option value="DIREKTOR_ONAY">Onaylandı · Ödeme Bekler</option>
          <option value="TAMAMLANDI">Tamamlandı</option>
          <option value="REDDEDILDI">Reddedildi</option>
        </select>
        {(searchText || filterDurum || filterGider || filterBolge || filterProje || filterBaslangic || filterBitis) && (
          <button onClick={() => { setSearchText(""); setFilterDurum(""); setFilterGider(""); setFilterBolge(""); setFilterProje(""); setFilterBaslangic(""); setFilterBitis(""); }}
            style={{ padding: "8px 14px", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: "10px", cursor: "pointer", fontSize: "13px" }}>
            Temizle
          </button>
        )}
      </div>

      {/* List — kart (mobile) veya tablo (desktop) */}
      {isMobile ? (
        <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
          {visibleList.length === 0 && <div style={{ textAlign:"center", color:"#9ca3af", padding:"32px" }}>Kayıt bulunamadı</div>}
          {visibleList.map(t => {
            const needsMyAction = (isPM && t.durum==="TALEP") || (isDirektor && t.durum==="PM_ONAY") || (isMuhasebe && t.durum==="DIREKTOR_ONAY");
            const myPendingRequest = t.talep_eden_email===currentUser?.email && ["TALEP","PM_ONAY","DIREKTOR_ONAY"].includes(t.durum);
            const cardBorder = needsMyAction ? "3px solid #f59e0b" : myPendingRequest ? "3px solid #f87171" : "3px solid #e5e7eb";
            const cardBg = needsMyAction ? "#fffbeb" : myPendingRequest ? "#fef2f2" : "#fff";
            return (
              <div key={t.id} style={{ background:cardBg, border:cardBorder, borderRadius:"12px", padding:"14px 16px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"8px" }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:"14px" }}>{t.talep_eden_ad}</div>
                    <div style={{ fontSize:"12px", color:"#6b7280" }}>{formatDateOnly(t.tarih)}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    {durumBadge(t.durum)}
                    <div style={{ fontWeight:800, fontSize:"16px", color:"#1e3a5f", marginTop:"4px" }}>₺{Number(t.tutar).toLocaleString("tr-TR")}</div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:"6px", flexWrap:"wrap", marginBottom:"8px" }}>
                  {t.gider_turu && <span style={{ background:"#eff6ff", color:"#1d4ed8", padding:"2px 10px", borderRadius:"20px", fontSize:"12px", fontWeight:600 }}>{t.gider_turu}</span>}
                  {t.bolge && <span style={{ background:"#f3f4f6", color:"#374151", padding:"2px 10px", borderRadius:"20px", fontSize:"12px" }}>{t.bolge}</span>}
                  {t.proje && <span style={{ background:"#f0fdf4", color:"#166534", padding:"2px 10px", borderRadius:"20px", fontSize:"12px" }}>{t.proje}</span>}
                </div>
                {t.aciklama && <div style={{ fontSize:"13px", color:"#6b7280", marginBottom:"8px" }}>{t.aciklama}</div>}
                {t.red_aciklama && <div style={{ fontSize:"12px", color:"#dc2626", marginBottom:"8px" }}>Red: {t.red_aciklama}</div>}
                {needsMyAction && <div style={{ fontSize:"12px", fontWeight:700, color:"#92400e", marginBottom:"8px" }}>⏳ Onayınızı bekliyor</div>}
                <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
                  {t.talep_eden_email===currentUser?.email && t.durum==="TALEP" && (
                    <button onClick={()=>openEdit(t)} style={{ padding:"6px 14px", background:"#e0f2fe", color:"#0369a1", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>Düzenle</button>
                  )}
                  {t.talep_eden_email===currentUser?.email && t.durum==="REDDEDILDI" && (
                    <button onClick={()=>handleDelete(t.id)} style={{ padding:"6px 14px", background:"#fee2e2", color:"#991b1b", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>Sil</button>
                  )}
                  {isPM && t.durum!=="DIREKTOR_ONAY" && t.durum!=="TAMAMLANDI" && (
                    <button onClick={()=>handleDelete(t.id)} style={{ padding:"6px 14px", background:"#fee2e2", color:"#991b1b", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>Sil</button>
                  )}
                  {isPM && t.durum==="TALEP" && (
                    <>
                      <button onClick={()=>handleOnayla(t.id)} style={{ padding:"6px 14px", background:"#dcfce7", color:"#166534", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>Onayla</button>
                      <button onClick={()=>{setRedModal(t.id);setRedText("");}} style={{ padding:"6px 14px", background:"#fee2e2", color:"#991b1b", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>Reddet</button>
                    </>
                  )}
                  {isDirektor && t.durum==="PM_ONAY" && (
                    <>
                      <button onClick={()=>handleOnayla(t.id)} style={{ padding:"6px 14px", background:"#dcfce7", color:"#166534", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>Onayla</button>
                      <button onClick={()=>{setRedModal(t.id);setRedText("");}} style={{ padding:"6px 14px", background:"#fee2e2", color:"#991b1b", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>Reddet</button>
                    </>
                  )}
                  {isMuhasebe && t.durum==="DIREKTOR_ONAY" && (
                    <>
                      <button onClick={()=>{if(window.confirm("Tamamlandı olarak işaretlensin mi?"))handleOnayla(t.id);}} style={{ padding:"6px 14px", background:"#dcfce7", color:"#166534", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>Ödendi</button>
                      <button onClick={()=>{setRedModal(t.id);setRedText("");}} style={{ padding:"6px 14px", background:"#fee2e2", color:"#991b1b", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>Reddet</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
      <div style={{ ...cardSt, padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Tarih","Talep Eden","Gider Türü","Bölge","Proje","Personel","Tutar","Açıklama","Durum","İşlemler"].map(h => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: 700, color: "#6b7280", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleList.length === 0 && (
                <tr><td colSpan={10} style={{ padding: "32px", textAlign: "center", color: "#9ca3af" }}>Kayıt bulunamadı</td></tr>
              )}
              {visibleList.map((t, i) => {
                const needsMyAction =
                  (isPM && t.durum === "TALEP") ||
                  (isDirektor && t.durum === "PM_ONAY") ||
                  (isMuhasebe && t.durum === "DIREKTOR_ONAY");
                const myPendingRequest =
                  t.talep_eden_email === currentUser?.email &&
                  (t.durum === "TALEP" || t.durum === "PM_ONAY" || t.durum === "DIREKTOR_ONAY");
                const rowBg = needsMyAction ? "#fffbeb" : myPendingRequest ? "#fef2f2" : i % 2 === 0 ? "#fff" : "#fafafa";
                const rowBorder = needsMyAction ? "4px solid #f59e0b" : myPendingRequest ? "4px solid #f87171" : "4px solid transparent";
                return (
                <tr key={t.id} style={{ borderTop: "1px solid #f3f4f6", background: rowBg, borderLeft: rowBorder }}>
                  <td style={{ padding: "12px 16px", fontSize: "13px", whiteSpace: "nowrap" }}>{formatDateOnly(t.tarih)}</td>
                  <td style={{ padding: "12px 16px", fontWeight: 600, fontSize: "14px" }}>{t.talep_eden_ad}</td>
                  <td style={{ padding: "12px 16px", fontSize: "13px" }}>
                    {t.gider_turu ? <span style={{ background:"#eff6ff", color:"#1d4ed8", padding:"2px 10px", borderRadius:"20px", fontSize:"12px", fontWeight:600 }}>{t.gider_turu}</span> : "—"}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: "13px", color: "#6b7280" }}>{t.bolge || "—"}</td>
                  <td style={{ padding: "12px 16px", fontSize: "13px", color: "#374151", fontWeight: 600 }}>{t.proje || "—"}</td>
                  <td style={{ padding: "12px 16px", fontSize: "13px", color: "#6b7280" }}>{t.personel_ad || "—"}</td>
                  <td style={{ padding: "12px 16px", fontWeight: 700, fontSize: "14px", whiteSpace: "nowrap" }}>₺{Number(t.tutar).toLocaleString("tr-TR")}</td>
                  <td
                    style={{ padding: "12px 16px", fontSize: "13px", color: "#6b7280", maxWidth: "200px", cursor: (t.aciklama || t.not_aciklama) ? "pointer" : "default" }}
                    onMouseEnter={e => { if (t.aciklama || t.not_aciklama) setNotTooltip({ visible: true, x: e.clientX, y: e.clientY, aciklama: t.aciklama || "", not_aciklama: t.not_aciklama || "" }); }}
                    onMouseLeave={() => setNotTooltip(p => ({ ...p, visible: false }))}
                  >
                    <div style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {t.aciklama ? t.aciklama : <span style={{ color:"#d1d5db" }}>—</span>}
                    </div>
                    {t.not_aciklama && (
                      <div style={{ fontSize:"11px", color:"#d97706", marginTop:"2px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        📝 {t.not_aciklama.split(/\s+/)[0]}…
                      </div>
                    )}
                    {t.red_aciklama && <div style={{ color:"#dc2626", fontSize:"11px", marginTop:"2px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>Red: {t.red_aciklama}</div>}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    {durumBadge(t.durum)}
                    {needsMyAction && <div style={{ fontSize:"10px", fontWeight:700, color:"#92400e", marginTop:"4px" }}>⏳ Onayınızı bekliyor</div>}
                    {myPendingRequest && !needsMyAction && (
                      <div style={{ fontSize:"10px", fontWeight:700, color:"#b91c1c", marginTop:"4px" }}>
                        🕐 {t.durum === "TALEP" ? "PM onayı bekleniyor" : t.durum === "PM_ONAY" ? "Direktör onayı bekleniyor" : "Ödeme bekleniyor"}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {t.talep_eden_email === currentUser?.email && t.durum === "TALEP" && (
                        <button onClick={() => openEdit(t)} style={{ padding: "4px 10px", background: "#e0f2fe", color: "#0369a1", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Düzenle</button>
                      )}
                      {t.talep_eden_email === currentUser?.email && t.durum === "REDDEDILDI" && (
                        <button onClick={() => handleDelete(t.id)} style={{ padding: "4px 10px", background: "#fee2e2", color: "#991b1b", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Sil</button>
                      )}
                      {isPM && t.durum !== "DIREKTOR_ONAY" && t.durum !== "TAMAMLANDI" && (
                        <button onClick={() => handleDelete(t.id)} style={{ padding: "4px 10px", background: "#fee2e2", color: "#991b1b", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Sil</button>
                      )}
                      {isPM && t.durum === "TALEP" && (
                        <>
                          <button onClick={() => handleOnayla(t.id)} style={{ padding: "4px 10px", background: "#dcfce7", color: "#166534", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Onayla</button>
                          <button onClick={() => { setRedModal(t.id); setRedText(""); }} style={{ padding: "4px 10px", background: "#fee2e2", color: "#991b1b", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Reddet</button>
                        </>
                      )}
                      {isDirektor && t.durum === "PM_ONAY" && (
                        <>
                          <button onClick={() => handleOnayla(t.id)} style={{ padding: "4px 10px", background: "#dcfce7", color: "#166534", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Onayla</button>
                          <button onClick={() => { setRedModal(t.id); setRedText(""); }} style={{ padding: "4px 10px", background: "#fee2e2", color: "#991b1b", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Reddet</button>
                        </>
                      )}
                      {isMuhasebe && t.durum === "DIREKTOR_ONAY" && (
                        <>
                          <button onClick={() => { if (window.confirm("Bu talebi tamamlandı olarak işaretleyeceksiniz. Onaylıyor musunuz?")) handleOnayla(t.id); }} style={{ padding: "4px 12px", background: "#dcfce7", color: "#166534", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Ödendi / Tamamla</button>
                          <button onClick={() => { setRedModal(t.id); setRedText(""); }} style={{ padding: "4px 10px", background: "#fee2e2", color: "#991b1b", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Reddet</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* New/Edit Modal */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: isMobile?"flex-end":"center", justifyContent: "center" }}
          onClick={() => setShowModal(false)}>
          <div style={{ background: "#fff", borderRadius: isMobile?"16px 16px 0 0":"16px", padding: isMobile?"20px 16px 32px":"28px", width: "100%", maxWidth: isMobile?"100%":"480px", boxShadow: "0 20px 60px rgba(0,0,0,0.15)", maxHeight:"90vh", overflowY:"auto" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>{editingId ? "Talebi Düzenle" : "Yeni İş Avansı Talebi"}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>
            <form onSubmit={handleSave}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>
                  Personel
                  <select value={form.personel_id} onChange={e => setForm(f => ({...f, personel_id: e.target.value}))}
                    style={{ display: "block", width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px", marginTop: "4px", background: "#fff" }}>
                    <option value="">Seçiniz (opsiyonel)</option>
                    {personelList.filter(p => p.aktif).map(p => <option key={p.id} value={p.id}>{p.ad_soyad}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>
                  Gider Türü <span style={{ color: "#dc2626" }}>*</span>
                  <select required value={form.gider_turu} onChange={e => setForm(f => ({...f, gider_turu: e.target.value}))}
                    style={{ display: "block", width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px", marginTop: "4px", background: "#fff" }}>
                    <option value="">Seçiniz...</option>
                    {GIDER_TURLERI.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>
                    Bölge <span style={{ color: "#dc2626" }}>*</span>
                    <select required value={form.bolge} onChange={e => setForm(f => ({...f, bolge: e.target.value}))}
                      style={{ display: "block", width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px", marginTop: "4px", background: "#fff", boxSizing: "border-box" }}>
                      <option value="">Seçiniz...</option>
                      {BOLGELER.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>
                    Proje <span style={{ color: "#dc2626" }}>*</span>
                    <select required value={form.proje} onChange={e => setForm(f => ({...f, proje: e.target.value}))}
                      style={{ display: "block", width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px", marginTop: "4px", background: "#fff", boxSizing: "border-box" }}>
                      <option value="">Seçiniz...</option>
                      {PROJELER.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </label>
                </div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>
                  Tutar (₺) <span style={{ color: "#dc2626" }}>*</span>
                  <input type="number" min="1" required value={form.tutar} onChange={e => setForm(f => ({...f, tutar: e.target.value}))}
                    style={{ display: "block", width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px", marginTop: "4px", boxSizing: "border-box", background: "#fff", color: "#1f2937" }} />
                </label>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>
                  Tarih <span style={{ color: "#dc2626" }}>*</span>
                  <input type="date" required value={form.tarih} onChange={e => setForm(f => ({...f, tarih: e.target.value}))}
                    style={{ display: "block", width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px", marginTop: "4px", boxSizing: "border-box", background: "#fff", color: "#1f2937" }} />
                </label>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>
                  Açıklama
                  <input value={form.aciklama} onChange={e => setForm(f => ({...f, aciklama: e.target.value}))}
                    style={{ display: "block", width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px", marginTop: "4px", boxSizing: "border-box", background: "#fff", color: "#1f2937" }} />
                </label>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>
                  Not (opsiyonel)
                  <textarea value={form.not_aciklama} onChange={e => setForm(f => ({...f, not_aciklama: e.target.value}))} rows={3}
                    style={{ display: "block", width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px", marginTop: "4px", boxSizing: "border-box", resize: "vertical", background: "#fff", color: "#1f2937" }} />
                </label>
                <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                  <button type="button" onClick={() => setShowModal(false)}
                    style={{ flex: 1, padding: "11px", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: "10px", fontWeight: 600, cursor: "pointer" }}>
                    İptal
                  </button>
                  <button type="submit" disabled={saving}
                    style={{ flex: 2, padding: "11px", background: "#1f2937", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, cursor: "pointer" }}>
                    {saving ? "Kaydediliyor..." : "Kaydet"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Red Modal */}
      {redModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setRedModal(null)}>
          <div style={{ background: "#fff", borderRadius: "16px", padding: "28px", width: "100%", maxWidth: "400px", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px", fontSize: "18px", fontWeight: 700, color: "#991b1b" }}>Talebi Reddet</h3>
            <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>
              Red Açıklaması <span style={{ color: "#dc2626" }}>*</span>
              <textarea value={redText} onChange={e => setRedText(e.target.value)} rows={4} placeholder="Ret gerekçesini yazınız..."
                style={{ display: "block", width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px", marginTop: "6px", boxSizing: "border-box", resize: "vertical" }} />
            </label>
            <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
              <button onClick={() => setRedModal(null)}
                style={{ flex: 1, padding: "11px", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: "10px", fontWeight: 600, cursor: "pointer" }}>
                İptal
              </button>
              <button onClick={handleReddet}
                style={{ flex: 1, padding: "11px", background: "#dc2626", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, cursor: "pointer" }}>
                Reddet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RegionAnalysis({ isSubconUser, userSubconName, userPaymentRate }) {
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

  const openPoIptalModal = () => {
    const filtered = rows.filter((row) => {
      const reqQty = Number(row.requested_qty || 0);
      const doneQty = Number(row.done_qty || 0);
      return reqQty > doneQty;
    });
    setDetailTitle("⚠️ PO İptal Edilmeli");
    setDetailRows(filtered);
    setFilterText("");
    setDetailModalOpen(true);
  };

  const filteredRows = detailRows.filter((row) =>
    Object.values(row).some((val) =>
      String(val || "")
        .toLowerCase()
        .includes(filterText.toLowerCase()),
    ),
  );

  const filteredRowCount = filteredRows.length;

  const filteredRowTotal = filteredRows.reduce((sum, row) => {
    const currency = normalizeCurrency(row.currency);
    const unitPrice = Number(row.unit_price || 0);
    const doneQty = Number(row.done_qty || 0);
    const billedQty = Number(row.billed_qty || 0);

    const rawTotal = doneQty * unitPrice;

    return sum + (currency === "USD" ? rawTotal * usdRate : rawTotal);
  }, 0);

  // ✅ FAC OK 20%
  const getFacOk20RowsByRegion = (regionName) => {
    return rows.filter((row) => {
      const rowRegion = String(
        getRegion(row.site_code, row.project_code) || "",
      ).toLowerCase();

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
      const rowRegion = String(
        getRegion(row.site_code, row.project_code) || "",
      ).toLowerCase();

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
      const sameRegion =
        getRegion(row.site_code, row.project_code) === regionName;
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

      const data = await fetchJson(`${API_BASE}/dashboard/result`, {
        withAuth: true,
      });
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
      const rowRegion = String(
        getRegion(row.site_code, row.project_code) || "",
      ).toLowerCase();

      const statusOk = String(row.status || "").toUpperCase() === "OK";
      const qcOk = String(row.qc_durum || "").toUpperCase() === "OK";
      const billedZero = Number(row.billed_qty ?? row.billed ?? 0) === 0;

      const req = Number(row.requested_qty || 0);
      const due = Number(row.due_qty || 0);
      const diff = req - due;

      const rowSubcon = String(row.subcon_name || "")
        .trim()
        .toLowerCase();

      const currentUserSubcon = String(userSubconName || "")
        .trim()
        .toLowerCase();

      if (isSubconUser && rowSubcon !== currentUserSubcon) return false;

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
      const rowRegion = String(
        getRegion(row.site_code, row.project_code) || "",
      ).toLowerCase();

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
        subcon: isSubconUser ? userSubconName : "",
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
      const region = getRegion(row.site_code, row.project_code);
      if (!base[region]) return;

      const currency = normalizeCurrency(row.currency);
      const unitPrice = Number(row.unit_price || 0);
      const doneQty = Number(row.done_qty || 0);
      const amount = doneQty * unitPrice;

      const billedQty = Number(row.billed_qty || 0);

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
    const completed = regionSummary.reduce((sum, r) => {
      return (
        sum + Number(r.total_try || 0) + Number(r.total_usd || 0) * usdRate
      );
    }, 0);

    const invoiced = regionSummary.reduce((sum, r) => {
      return (
        sum + Number(r.billed_try || 0) + Number(r.billed_usd || 0) * usdRate
      );
    }, 0);

    const poOpened = regionSummary.reduce((sum, r) => {
      return sum + Number(r.ok_try || 0) + Number(r.ok_usd || 0) * usdRate;
    }, 0);

    const noPO = regionSummary.reduce((sum, r) => {
      return (
        sum +
        Number(r.po_bekler_try || 0) +
        Number(r.po_bekler_usd || 0) * usdRate
      );
    }, 0);

    const notInvoiced = regionSummary.reduce((sum, r) => {
      const regionCompleted =
        Number(r.total_try || 0) + Number(r.total_usd || 0) * usdRate;

      const regionBilled =
        Number(r.billed_try || 0) + Number(r.billed_usd || 0) * usdRate;

      return sum + Math.max(regionCompleted - regionBilled, 0);
    }, 0);

    const ratio = completed > 0 ? (invoiced / completed) * 100 : 0;

    return {
      completed,
      invoiced,
      ratio,
      notInvoiced,
      poOpenedNotInvoiced: Math.max(poOpened - invoiced, 0),
      noPO,
    };
  }, [regionSummary, usdRate]);

  const exportDetailRowsToExcel = async () => {
    try {
      if (!detailRows.length) {
        alert("İndirilecek kayıt bulunamadı");
        return;
      }

      const savedToken =
        localStorage.getItem("financeToken") || localStorage.getItem("token");

      const regionName = String(detailTitle || "")
        .split(" - ")[0]
        .trim();
      const exportType = detailTitle.includes("Faturalanmamış")
        ? "NOT_INVOICED"
        : "PO_BEKLER";

      const params = new URLSearchParams({
        region: regionName,
        type: exportType,
        subcon: isSubconUser ? userSubconName : "",
      });

      const response = await fetch(
        `${API_BASE}/export/detail-excel?${params.toString()}`,
        {
          method: "GET",
          headers: {
            Authorization: savedToken ? `Bearer ${savedToken}` : "",
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("DETAIL EXCEL EXPORT ERROR:", errorText);
        alert(`Excel indirilemedi:\n${errorText}`);
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `${regionName}_${exportType}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("DETAIL EXCEL EXPORT ERROR:", err);
      alert(`Excel indirilemedi:\n${err.message}`);
    }
  };

  const filteredRegionRows = useMemo(() => {
    const q = regionSearch.toLowerCase().trim();

    const cleanRows = rows.filter(
      (row) => getRegion(row.site_code, row.project_code) !== "Tanımsız",
    );

    if (!q) return cleanRows;

    return cleanRows.filter((row) => {
      const text = `
        ${getRegion(row.site_code, row.project_code) || ""}
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

  const regionFilteredRowCount = sortedRows.length;

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

  const getSubconRateByRow = (row) => {
    const subconName = String(row.subcon_name || userSubconName || "")
      .trim()
      .toLowerCase();

    const itemCode = String(row.item_code || "").trim();

    if (subconName === "federal") return 0.8;

    if (subconName === "ubs") {
      return ubsSpecial90Items.has(itemCode) ? 0.9 : 0.75;
    }

    return Number(userPaymentRate || 1);
  };

  const getRowTotalTRY = (row) => {
    const currency = normalizeCurrency(row.currency);
    const unitPrice = Number(row.unit_price || 0);
    const doneQty = Number(row.done_qty || 0);

    const rawTotal = Number(row.total_done_amount || 0) || doneQty * unitPrice;

    return currency === "USD" ? rawTotal * usdRate : rawTotal;
  };

  const regionFilteredRowTotal = sortedRows.reduce((sum, row) => {
    return sum + getRowTotalTRY(row);
  }, 0);

  const subconHakedisTotal = sortedRows.reduce((sum, row) => {
    const rowTotal = getRowTotalTRY(row);
    const rate = getSubconRateByRow(row);

    return sum + rowTotal * rate;
  }, 0);
  const searchHasValue = regionSearch.trim() !== "";

  const uniqueSubconsInFilteredRows = [
    ...new Set(
      sortedRows
        .map((row) => String(row.subcon_name || "").trim())
        .filter(Boolean),
    ),
  ];

  const singleFilteredSubcon =
    uniqueSubconsInFilteredRows.length === 1
      ? uniqueSubconsInFilteredRows[0]
      : "";

 

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const handleExportRegionExcel = async () => {
    try {
      const savedToken =
        localStorage.getItem("financeToken") || localStorage.getItem("token");

      const response = await fetch(`${API_BASE}/export/region-analysis`, {
        method: "GET",
        headers: {
          Authorization: savedToken ? `Bearer ${savedToken}` : "",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("REGION ANALYSIS EXPORT ERROR:", errorText);
        alert(`Excel indirilemedi:\n${errorText}`);
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `region_analysis_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("REGION ANALYSIS EXCEL ERROR:", err);
      alert(`Excel indirilemedi:\n${err.message}`);
    }
  };

  if (loading) return <div className="loading">Yükleniyor...</div>;
  if (errorMessage) return <div className="loading">{errorMessage}</div>;
  const detailThStyle = {
    position: "sticky",
    top: 0,
    zIndex: 5,
    padding: "16px",
    color: "#ffffff",
    background: "#1f2937",
    fontWeight: "700",
    textAlign: "left",
    borderBottom: "1px solid #374151",
    whiteSpace: "nowrap",
  };

  const subconRate =
    String(userSubconName || "").toLowerCase() === "federal"
      ? 0.8
      : String(userSubconName || "").toLowerCase() === "ubs"
        ? 0.75
        : 1;

  const subconSummary = {
    hakedis: executiveSummary.completed * subconRate,
    poBeklerHakedis: executiveSummary.noPO * subconRate,
    notInvoicedHakedis: executiveSummary.notInvoiced * subconRate,
  };

  return (
    <>
      <h1 style={{ marginBottom: "10px", textAlign: "center" }}>
        🗺️ Bölge Analizi
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
          {isSubconUser ? `${userSubconName} GENEL ÖZET` : "GENEL ÖZET"}
        </div>

        <div style={{ background: "#f9fafb" }}>
          {isSubconUser ? (
            <>
              <Row label="Toplam Hakediş" value={subconSummary.hakedis} />

              <Row label="Hakediş Oranı" value={subconRate * 100} isPercent />

              <Row label="Hakediş Tutarı" value={subconSummary.hakedis} />

              <Row
                label="PO Bekleyen Hakediş"
                value={subconSummary.poBeklerHakedis}
              />

              <Row
                label="Faturalanmamış Hakediş"
                value={subconSummary.notInvoicedHakedis}
              />
            </>
          ) : (
            <>
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
                label="Faturalanmamış İş"
                value={executiveSummary.notInvoiced}
              />
              <Row
                label="PO Açılmış Ama Faturalanmamış"
                value={executiveSummary.poOpenedNotInvoiced}
              />
              <Row label="PO Açılmamış İş" value={executiveSummary.noPO} />
              <div
                onClick={openPoIptalModal}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "10px 16px",
                  borderBottom: "1px solid #e5e7eb",
                  background: "#fff7ed",
                  cursor: "pointer",
                }}
              >
                <div style={{ color: "#b45309", fontWeight: 600 }}>⚠️ PO İptal Edilmeli</div>
                <div style={{ fontWeight: 700, color: "#b45309" }}>
                  {rows.filter(r => Number(r.requested_qty||0) > Number(r.done_qty||0)).length} kalem →
                </div>
              </div>
            </>
          )}
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
                  {isSubconUser ? (
                    <>
                      <div style={regionRowStyle}>
                        <span style={{ color: "#374151", textAlign: "left" }}>
                          Hakediş
                        </span>
                        <strong style={{ textAlign: "right" }}>
                          {formatTRY(completed * subconRate)}
                        </strong>
                      </div>

                      <div
                        style={{ ...regionRowStyle, cursor: "pointer" }}
                        onClick={() =>
                          openRegionDetail(item.region, "PO_BEKLER")
                        }
                      >
                        <span style={{ color: "#374151", textAlign: "left" }}>
                          PO Bekleyen Hakediş
                        </span>
                        <strong
                          style={{ color: "#dc2626", textAlign: "right" }}
                        >
                          {formatTRY(poBekler * subconRate)}
                        </strong>
                      </div>

                      <div
                        style={{
                          ...regionRowStyle,
                          cursor: "pointer",
                          borderBottom: "none",
                        }}
                        onClick={() =>
                          openRegionDetail(item.region, "NOT_INVOICED")
                        }
                      >
                        <span style={{ color: "#374151", textAlign: "left" }}>
                          Faturalanmamış Hakediş
                        </span>
                        <strong
                          style={{ color: "#dc2626", textAlign: "right" }}
                        >
                          {formatTRY(notBilled * subconRate)}
                        </strong>
                      </div>
                    </>
                  ) : (
                    <>
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
                        onClick={() =>
                          openRegionDetail(item.region, "PO_BEKLER")
                        }
                      >
                        <span style={{ color: "#374151", textAlign: "left" }}>
                          PO Açılmamış
                        </span>
                        <strong
                          style={{ color: "#dc2626", textAlign: "right" }}
                        >
                          {formatTRY(poBekler)}
                        </strong>
                      </div>

                      <div
                        style={{ ...regionRowStyle, cursor: "pointer" }}
                        onClick={() =>
                          openRegionDetail(item.region, "NOT_INVOICED")
                        }
                      >
                        <span style={{ color: "#374151", textAlign: "left" }}>
                          Faturalanmamış İş
                        </span>
                        <strong
                          style={{ color: "#dc2626", textAlign: "right" }}
                        >
                          {formatTRY(notBilled)}
                        </strong>
                      </div>

                      <div
                        style={{ ...regionRowStyle, cursor: "pointer" }}
                        onClick={() => openQcReadyModal(item.region, "80")}
                      >
                        <span style={{ color: "#374151", textAlign: "left" }}>
                          QC OK Fatura Kesilecek 80%
                        </span>
                        <strong
                          style={{ color: "#166534", textAlign: "right" }}
                        >
                          {formatTRY(getQcReady80TotalByRegion(item.region))}
                        </strong>
                      </div>

                      <div
                        style={{
                          ...regionRowStyle,
                          cursor: "pointer",
                          borderBottom: "none",
                        }}
                        onClick={() =>
                          openQcReadyModal(item.region, "20_fac_ok")
                        }
                      >
                        <span style={{ color: "#16a34a", textAlign: "left" }}>
                          FAC OK Fatura Bekler 20%
                        </span>
                        <strong
                          style={{ color: "#16a34a", textAlign: "right" }}
                        >
                          {formatTRY(getFacOk20TotalByRegion(item.region))}
                        </strong>
                      </div>

                      <div
                        style={{
                          ...regionRowStyle,
                          cursor: "pointer",
                          borderBottom: "none",
                        }}
                        onClick={() =>
                          openQcReadyModal(item.region, "20_fac_nok")
                        }
                      >
                        <span style={{ color: "#dc2626", textAlign: "left" }}>
                          FAC NOK Fatura Bekler 20%
                        </span>
                        <strong
                          style={{ color: "#dc2626", textAlign: "right" }}
                        >
                          {formatTRY(getFacNok20TotalByRegion(item.region))}
                        </strong>
                      </div>
                    </>
                  )}
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

            <div
              className="tableWrap"
              style={{
                marginBottom: 0,
                maxHeight: "58vh",
                overflowY: "auto",
                overflowX: "auto",
                border: "1px solid #e5e7eb",
                borderRadius: "16px",
                background: "#fff",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "separate",
                  borderSpacing: 0,
                }}
              >
                <thead>
                  <tr
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 5,
                      background: "#1f2937",
                    }}
                  >
                    <th
                      style={{
                        padding: "16px 14px",

                        fontSize: "13px",

                        fontWeight: "700",

                        color: "#fff",

                        textAlign: "left",

                        borderBottom: "1px solid #374151",

                        whiteSpace: "nowrap",

                        background: "#1f2937",
                      }}
                    >
                      Project
                    </th>
                    <th
                      style={{
                        padding: "16px 14px",

                        fontSize: "13px",

                        fontWeight: "700",

                        color: "#fff",

                        textAlign: "left",

                        borderBottom: "1px solid #374151",

                        whiteSpace: "nowrap",

                        background: "#1f2937",
                      }}
                    >
                      Site
                    </th>
                    <th
                      style={{
                        padding: "16px 14px",

                        fontSize: "13px",

                        fontWeight: "700",

                        color: "#fff",

                        textAlign: "left",

                        borderBottom: "1px solid #374151",

                        whiteSpace: "nowrap",

                        background: "#1f2937",
                      }}
                    >
                      Item Description
                    </th>
                    <th
                      style={{
                        padding: "16px 14px",

                        fontSize: "13px",

                        fontWeight: "700",

                        color: "#fff",

                        textAlign: "left",

                        borderBottom: "1px solid #374151",

                        whiteSpace: "nowrap",

                        background: "#1f2937",
                      }}
                    >
                      Açıklama
                    </th>
                    <th
                      style={{
                        padding: "16px 14px",

                        fontSize: "13px",

                        fontWeight: "700",

                        color: "#fff",

                        textAlign: "left",

                        borderBottom: "1px solid #374151",

                        whiteSpace: "nowrap",

                        background: "#1f2937",
                      }}
                    >
                      Req
                    </th>
                    <th
                      style={{
                        padding: "16px 14px",

                        fontSize: "13px",

                        fontWeight: "700",

                        color: "#fff",

                        textAlign: "left",

                        borderBottom: "1px solid #374151",

                        whiteSpace: "nowrap",

                        background: "#1f2937",
                      }}
                    >
                      Due
                    </th>
                    <th
                      style={{
                        padding: "16px 14px",

                        fontSize: "13px",

                        fontWeight: "700",

                        color: "#fff",

                        textAlign: "left",

                        borderBottom: "1px solid #374151",

                        whiteSpace: "nowrap",

                        background: "#1f2937",
                      }}
                    >
                      Done
                    </th>
                    <th
                      style={{
                        padding: "16px 14px",

                        fontSize: "13px",

                        fontWeight: "700",

                        color: "#fff",

                        textAlign: "left",

                        borderBottom: "1px solid #374151",

                        whiteSpace: "nowrap",

                        background: "#1f2937",
                      }}
                    >
                      Total
                    </th>
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
                        <tr
                          key={i}
                          style={{
                            background: i % 2 === 0 ? "#ffffff" : "#f9fafb",
                            transition: "all 0.2s ease",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = "#eef2ff")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background =
                              i % 2 === 0 ? "#ffffff" : "#f9fafb")
                          }
                        >
                          <td style={{ padding: "14px", textAlign: "left" }}>
                            {row.project_code || "-"}
                          </td>
                          <td style={{ padding: "14px", textAlign: "left" }}>
                            {row.site_code || "-"}
                          </td>
                          <td style={{ padding: "14px", textAlign: "left" }}>
                            <div style={{ fontWeight: "600" }}>
                              {row.item_description || "-"}
                            </div>
                            <div style={{ fontSize: "11px", color: "#999" }}>
                              {row.item_code}
                            </div>
                          </td>

                          <td style={{ padding: "14px", textAlign: "center" }}>
                            {row.requested_qty ?? "-"}
                          </td>
                          <td style={{ padding: "14px", textAlign: "center" }}>
                            {row.due_qty ?? "-"}
                          </td>
                          <td style={{ padding: "14px", textAlign: "center" }}>
                            {row.done_qty ?? "-"}
                          </td>
                          <td
                            style={{
                              padding: "14px",
                              textAlign: "right",
                              fontWeight: "600",
                            }}
                          >
                            {formatTRY(shownTotal)}
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
              overflow: "hidden",
              borderRadius: "20px",
              padding: "24px",
              boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "18px",
                marginBottom: "20px",
              }}
            >
              <h3
                className="listTitle"
                style={{
                  margin: 0,
                  fontSize: "24px",
                  fontWeight: "800",
                  color: "#111827",
                }}
              >
                {detailTitle}
              </h3>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "14px",
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "14px",
                    flexWrap: "wrap",
                    flex: "1 1 720px",
                  }}
                >
                  <input
                    type="text"
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    placeholder="Site ID ile filtrele"
                    style={{
                      flex: "1 1 520px",
                      minWidth: "320px",
                      padding: "16px 18px",
                      borderRadius: "18px",
                      border: "1px solid #d9dee7",
                      fontSize: "16px",
                      outline: "none",
                      background: "#fff",
                    }}
                  />

                  {!detailTitle.includes("İptal") && <div
                    style={{
                      minWidth: "220px",
                      padding: "14px 18px",
                      borderRadius: "18px",
                      background: "#f7f8fb",
                      border: "1px solid #e4e7ee",
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "14px",
                        color: "#6b7280",
                        marginBottom: "6px",
                      }}
                    >
                      Toplam Tutar
                    </div>
                    <div
                      style={{
                        fontWeight: "800",
                        fontSize: "22px",
                        color: "#111827",
                      }}
                    >
                      {formatTRY(filteredRowTotal)}
                    </div>
                  </div>}
                </div>

                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
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
            </div>

            <div
              className="tableWrap"
              style={{
                width: "100%",
                maxHeight: "58vh",
                overflowY: "auto",
                overflowX: "auto",
                borderRadius: "16px",
                border: "1px solid #e5e7eb",
                background: "#fff",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "14px",
                }}
              >
                <thead>
                  <tr style={{ background: "#1f2937" }}>
                    <th style={detailThStyle}>Status</th>
                    <th style={detailThStyle}>Project</th>
                    <th style={detailThStyle}>Site Code</th>
                    <th style={detailThStyle}>Item Code</th>
                    <th style={detailThStyle}>Item Description</th>
                    <th style={detailThStyle}>Done Qty</th>
                    <th style={detailThStyle}>Requested Qty</th>
                    <th style={detailThStyle}>Billed Qty</th>
                    <th style={detailThStyle}>Currency</th>
                    <th style={detailThStyle}>Unit Price</th>
                    <th style={detailThStyle}>Total Done Amount</th>
                    <th style={detailThStyle}>Subcon</th>
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
                        <td
                          style={{
                            padding: "14px",
                            textAlign: "left",
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          {row.project_code || "-"}
                        </td>

                        <td
                          style={{
                            padding: "14px",
                            textAlign: "left",
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          {row.site_code || "-"}
                        </td>

                        <td
                          style={{
                            padding: "14px",
                            textAlign: "left",
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          {row.item_code || "-"}
                        </td>

                        <td
                          style={{
                            padding: "14px",
                            textAlign: "left",
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          {row.item_description || "-"}
                        </td>

                        <td
                          style={{
                            padding: "14px",
                            textAlign: "center",
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          {row.done_qty ?? "-"}
                        </td>

                        <td
                          style={{
                            padding: "14px",
                            textAlign: "center",
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          {row.requested_qty ?? "-"}
                        </td>

                        <td
                          style={{
                            padding: "14px",
                            textAlign: "center",
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          {row.billed_qty ?? "-"}
                        </td>

                        <td
                          style={{
                            padding: "14px",
                            textAlign: "center",
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          {row.currency || "-"}
                        </td>
                        <td
                          style={{
                            padding: "14px",
                            textAlign: "right",
                            borderBottom: "1px solid #e5e7eb",
                            fontWeight: "600",
                          }}
                        >
                          {Number(row.unit_price || 0) === 0
                            ? "-"
                            : formatMoneyByCurrency(
                                row.unit_price,
                                row.currency,
                              )}
                        </td>
                        <td>
                          {(() => {
                            const unitPrice = Number(row.unit_price || 0);
                            const doneQty = Number(row.done_qty || 0);

                            const rawTotal =
                              Number(row.total_done_amount || 0) ||
                              doneQty * unitPrice;

                            return rawTotal === 0
                              ? "-"
                              : formatMoneyByCurrency(rawTotal, row.currency);
                          })()}
                        </td>
                        <td
                          style={{
                            padding: "14px",
                            textAlign: "left",
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          {row.subcon_name || "-"}
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

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
          margin: "30px auto 12px auto",
          maxWidth: "1200px",
          width: "100%",
        }}
      >
        <input
          type="text"
          placeholder="Bölge, status, proje, site, item, taşeron, OnAir Date ara"
          value={regionSearch}
          onChange={(e) => setRegionSearch(e.target.value)}
          style={{
            flex: "1 1 320px",
            minWidth: "280px",
            padding: "10px 14px",
            borderRadius: "8px",
            border: "1px solid #d1d5db",
          }}
        />

        <div
          style={{
            minWidth: "120px",
            padding: "10px 14px",
            borderRadius: "12px",
            background: "#f7f8fb",
            border: "1px solid #e4e7ee",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "12px", color: "#6b7280" }}>Toplam Satır</div>
          <div style={{ fontWeight: "700", fontSize: "20px" }}>
            {regionFilteredRowCount}
          </div>
        </div>

        <div
          style={{
            minWidth: "150px",
            padding: "10px 14px",
            borderRadius: "12px",
            background: "#f7f8fb",
            border: "1px solid #e4e7ee",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "12px", color: "#6b7280" }}>Toplam Tutar</div>
          <div style={{ fontWeight: "700", fontSize: "20px" }}>
            {formatTRY(regionFilteredRowTotal)}
          </div>
        </div>
        {isSubconUser && (
          <div
            style={{
              minWidth: "170px",
              padding: "10px 14px",
              borderRadius: "12px",
              background: "#f7f8fb",
              border: "1px solid #e4e7ee",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "12px", color: "#6b7280" }}>
              {`${userSubconName} Hakediş`}
            </div>
            <div
              style={{ fontWeight: "700", fontSize: "20px", color: "#166534" }}
            >
              {formatTRY(subconHakedisTotal)}
            </div>
          </div>
        )}

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
                Item Description
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
                  <td>{getRegion(row.site_code, row.project_code)}</td>
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
                  <td>
                    <div style={{ fontWeight: "600" }}>
                      {row.item_description || "-"}
                    </div>
                    <div style={{ fontSize: "11px", color: "#999" }}>
                      {row.item_code || ""}
                    </div>
                  </td>
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
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    password: "",
    role: "user",
  });
  const [token, setToken] = useState(localStorage.getItem("token") || "");

  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  });
  const isAdmin = user?.role === "admin";
  const _isBolgeMudur = user?.email === "nurcan.kus@simsektel.com" || user?.email === "serdar.altinova@simsektel.com" || ["rollout_mudur","bolge_mudur"].includes((user?.role||"").toLowerCase());
  const isRollout = user?.role === "rollout" || user?.role === "admin" || _isBolgeMudur;
  const isPersonel = user?.role === "user" && !_isBolgeMudur;
  const isSubconUser =
    String(user?.role || "").toLowerCase() === "subcon" ||
    String(user?.subcon_name || "").trim() !== "";

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
    padding: "14px 16px",
    marginBottom: "16px",
    borderRadius: "8px",
    border: "1px solid #ddd",
    fontSize: "15px",
    boxSizing: "border-box",
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

  const [page, setPage] = useState(() => {
    const u = (() => { try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; } })();
    const bolgeMudurEmails = ["nurcan.kus@simsektel.com","serdar.altinova@simsektel.com"];
    const isBolge = bolgeMudurEmails.includes(u?.email) || ["rollout_mudur","bolge_mudur"].includes((u?.role||"").toLowerCase());
    if (u?.role === "user" && !isBolge) return "masraf";
    if (isBolge) return "region";
    return "finance";
  });
  const [pendingAvansCount, setPendingAvansCount] = useState(0);
  const [pendingMasrafCount, setPendingMasrafCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    const fetchPending = async () => {
      try {
        // İş avansı bekleyenleri say
        const r = await fetch(`${API_BASE}/hr/is-avans`);
        const data = await r.json();
        if (Array.isArray(data)) {
          const email = user.email;
          let count = 0;
          if (email === "orhan.bedir@simsektel.com") count = data.filter(t => t.durum === "TALEP").length;
          else if (email === "duzgun.simsek@simsektel.com") count = data.filter(t => t.durum === "PM_ONAY").length;
          else if (email === "muhasebe@simsektel.com") count = data.filter(t => t.durum === "DIREKTOR_ONAY").length;
          setPendingAvansCount(count);
        }
        // Masraf formu bekleyenleri say
        const mr = await fetch(`${API_BASE}/hr/masraf-form`);
        const mdata = await mr.json();
        if (Array.isArray(mdata)) {
          const email = user.email;
          let mc = 0;
          if (email === "orhan.bedir@simsektel.com") mc = mdata.filter(f => f.durum === "PM_BEKLE").length;
          else if (email === "duzgun.simsek@simsektel.com") mc = mdata.filter(f => f.durum === "DIREKTOR_BEKLE").length;
          else if (email === "muhasebe@simsektel.com") mc = mdata.filter(f => f.durum === "TAMAMLANDI").length;
          setPendingMasrafCount(mc);
        }
      } catch {}
    };
    fetchPending();
  }, [user]);

  const [adminUsers, setAdminUsers] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");
  const loadAdminUsers = async () => {
    try {
      setAdminLoading(true);
      setAdminError("");

      const response = await fetch(`${API_BASE}/admin/users`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Kullanıcılar alınamadı");
      }

      setAdminUsers(data.users || []);
    } catch (err) {
      setAdminError(err.message || "Kullanıcılar alınamadı");
    } finally {
      setAdminLoading(false);
    }
  };

  const handleAdminRoleChange = async (userId, newRole) => {
    try {
      const response = await fetch(`${API_BASE}/admin/users/${userId}/role`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: newRole }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Rol güncellenemedi");
      }

      await loadAdminUsers();
    } catch (err) {
      alert(err.message || "Rol güncellenemedi");
    }
  };

  const handleCreateUser = async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(newUser),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      setNewUser({ name: "", email: "", password: "", role: "user" });
      loadAdminUsers();
    } catch (err) {
      alert(err.message);
    }
  };
  const handleToggleActive = async (userId) => {
    try {
      const response = await fetch(`${API_BASE}/admin/users/${userId}/active`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Durum güncellenemedi");
      }

      await loadAdminUsers();
    } catch (err) {
      alert(err.message || "Durum güncellenemedi");
    }
  };

  const toggleUserActive = async (id) => {
    try {
      await fetch(`${API_BASE}/admin/users/${id}/active`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      loadAdminUsers();
    } catch (err) {
      alert("Hata");
    }
  };

  const deleteUser = async (id) => {
    if (!confirm("Silmek istediğine emin misin?")) return;

    try {
      await fetch(`${API_BASE}/admin/users/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      loadAdminUsers();
    } catch (err) {
      alert("Silinemedi");
    }
  };

  const thStyle = {
    textAlign: "left",
    padding: "12px",
    borderBottom: "1px solid #e5e7eb",
    fontSize: "14px",
  };

  const tdStyle = {
    padding: "12px",
    borderBottom: "1px solid #e5e7eb",
    fontSize: "14px",
  };

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
      <div style={{ height: "100vh", background: "transparent" }}>
        {/* 🔹 HEADER */}
        <div
          style={{
            height: "60px",
            background: "#ffffff",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0 30px",
            borderBottom: "1px solid #eee",
            position: "relative",
            zIndex: 5,
          }}
        >
          {/* SOL */}
          <div style={{ fontWeight: "bold", fontSize: "18px" }}>
            ERC Mühendislik
          </div>

          {/* SAĞ */}
          <div style={{ color: "#666", fontSize: "14px" }}>
            ERC | Operasyon ve Hakediş Takip Sistemi
          </div>
        </div>

        {/* 🔹 ORTA LOGIN */}
        <div
          style={{
            height: "calc(100vh - 60px)",
            position: "relative",
            zIndex: 10,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <form
            onSubmit={handleFinanceLogin}
            style={{
              background: "#fff",
              padding: "clamp(32px, 5vw, 56px)",
              borderRadius: "16px",
              width: "min(480px, calc(100vw - 32px))",
              boxShadow: "0 10px 30px rgba(0,0,0,0.1)",
              position: "relative",
              zIndex: 20,
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
                padding: "15px",
                background: "#e53935",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                fontWeight: "bold",
                fontSize: "16px",
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

  if (isPersonel) {
    return (
      <div style={{ minHeight:"100vh", background:"#f8fafc" }}>
        {/* Mobile top bar */}
        <div style={{ background:"#1e3a5f", color:"#fff", padding:"14px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, zIndex:100, boxShadow:"0 2px 8px rgba(0,0,0,0.2)" }}>
          <span style={{ fontWeight:700, fontSize:"16px" }}>ERC Mühendislik</span>
          <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
            <span style={{ fontSize:"12px", opacity:0.8 }}>{user?.name || user?.email}</span>
            <button onClick={handleLogout} style={{ background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.3)", color:"#fff", borderRadius:"8px", padding:"6px 12px", fontSize:"12px", fontWeight:600, cursor:"pointer" }}>Çıkış</button>
          </div>
        </div>
        {/* Bottom navigation */}
        <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:100, background:"#fff", borderTop:"1px solid #e5e7eb", display:"flex", height:"64px", boxShadow:"0 -2px 10px rgba(0,0,0,0.08)" }}>
          <button onClick={()=>setPage("is_avans")} style={{ flex:1, border:"none", background:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"4px", color: page==="is_avans"?"#1e3a5f":"#9ca3af", fontWeight: page==="is_avans"?700:400, fontSize:"11px" }}>
            <span style={{ fontSize:"22px" }}>💳</span>İş Avansı
            {pendingAvansCount>0 && <span style={{ position:"absolute", top:"8px", background:"#dc2626", color:"#fff", borderRadius:"999px", fontSize:"9px", fontWeight:700, minWidth:"16px", height:"16px", display:"flex", alignItems:"center", justifyContent:"center", padding:"0 4px" }}>{pendingAvansCount}</span>}
          </button>
          <button onClick={()=>setPage("masraf")} style={{ flex:1, border:"none", background:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"4px", color: page==="masraf"?"#1e3a5f":"#9ca3af", fontWeight: page==="masraf"?700:400, fontSize:"11px" }}>
            <span style={{ fontSize:"22px" }}>🧾</span>Masraf Formu
            {pendingMasrafCount>0 && <span style={{ position:"absolute", top:"8px", background:"#dc2626", color:"#fff", borderRadius:"999px", fontSize:"9px", fontWeight:700, minWidth:"16px", height:"16px", display:"flex", alignItems:"center", justifyContent:"center", padding:"0 4px" }}>{pendingMasrafCount}</span>}
          </button>
        </div>
        {/* Content area */}
        <div style={{ padding:"12px 12px 80px" }}>
          {page === "is_avans" && <IsAvansPanel currentUser={user} onPendingCount={setPendingAvansCount} />}
          {page === "masraf" && <MasrafFormuPanel currentUser={user} onPendingCount={setPendingMasrafCount} />}
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
          paddingRight: "130px",
        }}
      >
        .
        {isSubconUser ? (
          <>
            <button
              className={page === "region" ? "tab activeTab" : "tab"}
              onClick={() => setPage("region")}
            >
              Bölge Analizi
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
          </>
        ) : (
          <>
            {isAdmin && (
              <button
                className={page === "finance" ? "tab activeTab" : "tab"}
                onClick={() => setPage("finance")}
              >
                Finans Paneli
              </button>
            )}

            <button
              className={page === "region" ? "tab activeTab" : "tab"}
              onClick={() => setPage("region")}
            >
              Bölge Analizi
            </button>

            <button
              className={page === "executive" ? "tab activeTab" : "tab"}
              onClick={() => setPage("executive")}
            >
              Rollout Data
            </button>

            <button
              className={page === "entry" ? "tab activeTab" : "tab"}
              onClick={() => setPage("entry")}
            >
              Günlük İş Girişi
            </button>

            {isRollout && (
              <button
                className={page === "puantaj" ? "tab activeTab" : "tab"}
                onClick={() => setPage("puantaj")}
              >
                📋 Puantaj
              </button>
            )}

            <button
              className={page === "is_avans" ? "tab activeTab" : "tab"}
              onClick={() => setPage("is_avans")}
              style={{ position: "relative" }}
            >
              İş Avansı
              {pendingAvansCount > 0 && (
                <span style={{ position:"absolute", top:"-6px", right:"-6px", background:"#dc2626", color:"#fff", borderRadius:"999px", fontSize:"11px", fontWeight:700, minWidth:"18px", height:"18px", display:"flex", alignItems:"center", justifyContent:"center", padding:"0 4px", lineHeight:1 }}>
                  {pendingAvansCount}
                </span>
              )}
            </button>

            <button
              className={page === "masraf" ? "tab activeTab" : "tab"}
              onClick={() => setPage("masraf")}
              style={{ position: "relative" }}
            >
              🧾 Masraf Formu
              {pendingMasrafCount > 0 && (
                <span style={{ position:"absolute", top:"-6px", right:"-6px", background:"#dc2626", color:"#fff", borderRadius:"999px", fontSize:"11px", fontWeight:700, minWidth:"18px", height:"18px", display:"flex", alignItems:"center", justifyContent:"center", padding:"0 4px", lineHeight:1 }}>
                  {pendingMasrafCount}
                </span>
              )}
            </button>

            {(token || financeToken) && (
              <div style={{ position:"absolute", right:0, top:"50%", transform:"translateY(-50%)", display:"flex", alignItems:"center", gap:"10px" }}>
                {user?.name && !isAdmin && !localStorage.getItem("financeToken") && (
                  <span style={{ fontSize:"13px", fontWeight:600, color:"#1e3a5f", background:"#f0f4ff", border:"1px solid #c7d7fc", borderRadius:"8px", padding:"7px 13px", whiteSpace:"nowrap" }}>
                    👤 {user.name}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleLogout}
                  style={{ background:"#dc3545", color:"#fff", border:"none", padding:"10px 16px", borderRadius:"8px", cursor:"pointer", fontWeight:"600", whiteSpace:"nowrap" }}
                >
                  Çıkış Yap
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {pendingAvansCount > 0 && page !== "is_avans" && (
        <div onClick={() => setPage("is_avans")} style={{ margin:"0 0 0 0", padding:"12px 24px", background:"#fef2f2", borderBottom:"2px solid #fca5a5", display:"flex", alignItems:"center", gap:"12px", cursor:"pointer" }}>
          <span style={{ fontSize:"20px" }}>🔔</span>
          <div>
            <span style={{ fontWeight:700, color:"#991b1b", fontSize:"14px" }}>
              {pendingAvansCount} adet iş avansı talebi onayınızı bekliyor
            </span>
            <span style={{ color:"#dc2626", fontSize:"13px", marginLeft:"8px" }}>→ İş Avansı'na git</span>
          </div>
        </div>
      )}

      {pendingMasrafCount > 0 && page !== "masraf" && (
        <div onClick={() => setPage("masraf")} style={{ margin:"0 0 0 0", padding:"12px 24px", background:"#fff7ed", borderBottom:"2px solid #fed7aa", display:"flex", alignItems:"center", gap:"12px", cursor:"pointer" }}>
          <span style={{ fontSize:"20px" }}>🧾</span>
          <div>
            <span style={{ fontWeight:700, color:"#92400e", fontSize:"14px" }}>
              {pendingMasrafCount} adet masraf formu onayınızı bekliyor
            </span>
            <span style={{ color:"#b45309", fontSize:"13px", marginLeft:"8px" }}>→ Masraf Formu'na git</span>
          </div>
        </div>
      )}

      {page === "finance" &&
        isAdmin &&
        (financeToken ? (
          <FinanceDashboard
            user={user}
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
            onGoToAdmin={() => { setPage("admin"); loadAdminUsers(); }}
            onGoToHr={() => setPage("hr")}
            onGoToAraclar={() => setPage("araclar")}
            onGoToOfis={() => setPage("ofis")}
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

      {page === "hr" && <HrDashboard onBack={() => setPage("finance")} currentUser={user} />}
      {page === "is_avans" && <IsAvansPanel currentUser={user} onPendingCount={setPendingAvansCount} />}
      {page === "masraf" && <MasrafFormuPanel currentUser={user} onPendingCount={setPendingMasrafCount} />}
      {page === "araclar" && <AraclarPanel currentUser={user} onBack={()=>setPage("finance")} />}
      {page === "ofis" && <OfisDepoPanel currentUser={user} onBack={()=>setPage("finance")} />}
      {page === "puantaj" && isRollout && <PuantajPanel currentUser={user} onBack={()=>setPage("hr")} />}
      {page === "executive" && <RolloutDashboard />}
      {page === "region" && (
        <RegionAnalysis
          isSubconUser={!isAdmin && !!user?.subcon_name}
          userSubconName={user?.subcon_name || ""}
          userPaymentRate={Number(user?.payment_rate || 0.8)}
        />
      )}
      {page === "entry" && <DailyEntry />}
      {page === "admin" && isAdmin && (
        <div style={{ maxWidth: "1100px", margin: "24px auto" }}>
          {/* Header */}
          <div style={{
            background: "linear-gradient(135deg, #1f2937 0%, #374151 100%)",
            borderRadius: "16px",
            padding: "28px 32px",
            marginBottom: "24px",
            display: "flex",
            alignItems: "center",
            gap: "16px",
            color: "#fff",
          }}>
            <div style={{ fontSize: "40px" }}>👑</div>
            <div>
              <h2 style={{ margin: 0, fontSize: "24px", fontWeight: 700 }}>Admin Panel</h2>
              <p style={{ margin: "4px 0 0", color: "#9ca3af", fontSize: "14px" }}>
                Kullanıcı yönetimi ve sistem ayarları
              </p>
            </div>
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <div style={{ fontSize: "28px", fontWeight: 700 }}>{adminUsers.length}</div>
              <div style={{ fontSize: "12px", color: "#9ca3af" }}>Toplam Kullanıcı</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "20px", alignItems: "start" }}>
            {/* Yeni Kullanıcı Formu */}
            <div style={{
              background: "#fff",
              borderRadius: "16px",
              padding: "24px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.07)",
              border: "1px solid #f3f4f6",
            }}>
              <h3 style={{ margin: "0 0 20px", fontSize: "16px", fontWeight: 700, color: "#1f2937", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ background: "#f3f4f6", borderRadius: "8px", padding: "6px 8px" }}>➕</span>
                Yeni Kullanıcı
              </h3>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <input
                  placeholder="Ad Soyad"
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  style={{ padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px", outline: "none" }}
                />
                <input
                  placeholder="E-posta adresi"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  style={{ padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px", outline: "none" }}
                />
                <input
                  placeholder="Şifre"
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  style={{ padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px", outline: "none" }}
                />
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  style={{ padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #e5e7eb", fontSize: "14px", background: "#fff", cursor: "pointer" }}
                >
                  <option value="user">👤 User</option>
                  <option value="admin">👑 Admin</option>
                </select>
                <button
                  onClick={handleCreateUser}
                  style={{
                    padding: "11px",
                    background: "#1f2937",
                    color: "#fff",
                    border: "none",
                    borderRadius: "10px",
                    fontWeight: "700",
                    fontSize: "14px",
                    cursor: "pointer",
                    marginTop: "4px",
                  }}
                >
                  Kullanıcı Ekle
                </button>
              </div>

              {adminError && (
                <div style={{ marginTop: "12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "10px 14px", color: "#b91c1c", fontSize: "13px", fontWeight: 600 }}>
                  {adminError}
                </div>
              )}
            </div>

            {/* Kullanıcı Listesi */}
            <div style={{
              background: "#fff",
              borderRadius: "16px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.07)",
              border: "1px solid #f3f4f6",
              overflow: "hidden",
            }}>
              <div style={{ padding: "20px 24px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#1f2937" }}>
                  Kullanıcılar
                </h3>
                <div style={{ display: "flex", gap: "8px" }}>
                  <span style={{ background: "#dcfce7", color: "#166534", fontSize: "12px", fontWeight: 600, padding: "4px 10px", borderRadius: "20px" }}>
                    {adminUsers.filter(u => u.is_active).length} Aktif
                  </span>
                  <span style={{ background: "#fee2e2", color: "#991b1b", fontSize: "12px", fontWeight: 600, padding: "4px 10px", borderRadius: "20px" }}>
                    {adminUsers.filter(u => !u.is_active).length} Pasif
                  </span>
                </div>
              </div>

              {adminLoading ? (
                <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af" }}>Yükleniyor...</div>
              ) : (
                <div>
                  {adminUsers.map((u, i) => (
                    <div key={u.id} style={{
                      display: "grid",
                      gridTemplateColumns: "44px 1fr auto auto",
                      alignItems: "center",
                      gap: "16px",
                      padding: "14px 24px",
                      borderBottom: i < adminUsers.length - 1 ? "1px solid #f9fafb" : "none",
                      background: "#fff",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "#f9fafb"}
                    onMouseLeave={e => e.currentTarget.style.background = "#fff"}
                    >
                      {/* Avatar */}
                      <div style={{
                        width: "44px", height: "44px",
                        borderRadius: "12px",
                        background: u.role === "admin" ? "linear-gradient(135deg,#fbbf24,#f59e0b)" : "linear-gradient(135deg,#60a5fa,#3b82f6)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "18px", fontWeight: 700, color: "#fff",
                        flexShrink: 0,
                      }}>
                        {u.name.charAt(0)}
                      </div>

                      {/* Info */}
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "14px", color: "#1f2937" }}>{u.name}</div>
                        <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "2px" }}>{u.email}</div>
                      </div>

                      {/* Badges */}
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <span style={{
                          background: u.role === "admin" ? "#fef3c7" : u.role === "rollout_mudur" ? "#f0fdf4" : "#eff6ff",
                          color: u.role === "admin" ? "#92400e" : u.role === "rollout_mudur" ? "#166534" : "#1e40af",
                          fontSize: "11px", fontWeight: 700, padding: "3px 10px",
                          borderRadius: "20px", textTransform: "uppercase", letterSpacing: "0.05em",
                        }}>
                          {u.role === "admin" ? "👑 Admin" : u.role === "rollout_mudur" ? "🏗 Rollout" : "👤 User"}
                        </span>
                        <span style={{
                          background: u.is_active ? "#dcfce7" : "#f3f4f6",
                          color: u.is_active ? "#166534" : "#6b7280",
                          fontSize: "11px", fontWeight: 700, padding: "3px 10px",
                          borderRadius: "20px",
                        }}>
                          {u.is_active ? "Aktif" : "Pasif"}
                        </span>
                      </div>

                      {/* Actions */}
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          onClick={() => handleToggleActive(u.id)}
                          style={{
                            padding: "6px 12px",
                            background: u.is_active ? "#fef3c7" : "#f0fdf4",
                            color: u.is_active ? "#92400e" : "#166534",
                            border: "none", borderRadius: "8px",
                            fontSize: "12px", fontWeight: 600, cursor: "pointer",
                          }}
                        >
                          {u.is_active ? "Pasife Al" : "Aktif Et"}
                        </button>
                        <select
                          value={u.role || "user"}
                          onChange={e => handleAdminRoleChange(u.id, e.target.value)}
                          style={{
                            padding: "6px 10px",
                            border: "1px solid #e5e7eb", borderRadius: "8px",
                            fontSize: "12px", fontWeight: 600, cursor: "pointer",
                            background: "#f9fafb", color: "#374151",
                          }}
                        >
                          <option value="user">👤 User</option>
                          <option value="admin">👑 Admin</option>
                          <option value="rollout_mudur">🏗 Rollout Müdürü</option>
                        </select>
                        <button
                          onClick={() => deleteUser(u.id)}
                          style={{
                            padding: "6px 12px",
                            background: "#fee2e2",
                            color: "#991b1b",
                            border: "none", borderRadius: "8px",
                            fontSize: "12px", fontWeight: 600, cursor: "pointer",
                          }}
                        >
                          🗑 Sil
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
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
function RolloutSummaryTables({ summaryRows, rows = [], regionFilter }) {
  if (!summaryRows || summaryRows.length === 0) return null;

  const regionTitle = regionFilter === "ALL" ? "Tüm Bölgeler" : regionFilter;

  const getWeekNumber = (dateValue) => {
    if (!dateValue) return null;
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return null;

    const oneJan = new Date(d.getFullYear(), 0, 1);
    return Math.ceil(((d - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
  };

  const getRow = (type) =>
    summaryRows.find(
      (r) => String(r.site_type || "").toUpperCase() === type.toUpperCase(),
    ) || {};
  const calcActualFromRows = (type, dateField) => {
    return getRowsByType(type).filter((r) => {
      if (!dateField) return true;
      return String(r[dateField] || "").trim() !== "";
    }).length;
  };
  const getSmartDateValue = (row, dateField) => {
    const qcOk = String(row.qc_durum || "").toUpperCase() === "OK";

    const materialOk =
      String(row.malzeme_status || "").toUpperCase() === "OK" ||
      String(row.malzeme_status || "").trim() !== "";

    const installationStart =
      row.installation_actual_start_date ||
      row.inst_actual_start_date ||
      row.install_start_date ||
      row.plan_start_date ||
      row.inst_plan_start_date ||
      row.rf_plan_start_date ||
      "";

    const installationEnd =
      row.installation_actual_end_date ||
      row.inst_actual_end_date ||
      row.install_end_date ||
      row.onair_date ||
      "";

    const onAir =
      row.onair_date ||
      row.installation_actual_end_date ||
      row.inst_actual_end_date ||
      row.install_end_date ||
      "";

    if (dateField === "plan_start_date") {
      return (
        row.plan_start_date ||
        row.inst_plan_start_date ||
        row.rf_plan_start_date ||
        installationStart ||
        installationEnd ||
        onAir ||
        (qcOk ? "SMART_OK" : "")
      );
    }

    if (dateField === "installation_actual_start_date") {
      return (
        row.installation_actual_start_date ||
        row.inst_actual_start_date ||
        row.install_start_date ||
        installationEnd ||
        onAir ||
        (qcOk ? "SMART_OK" : "")
      );
    }

    if (dateField === "installation_actual_end_date") {
      return (
        row.installation_actual_end_date ||
        row.inst_actual_end_date ||
        row.install_end_date ||
        row.onair_date ||
        (qcOk ? "SMART_OK" : "")
      );
    }

    if (dateField === "qc_closed_date") {
      return (
        row.qc_closed_date || row.qc_close_date || (qcOk ? "SMART_OK" : "")
      );
    }

    if (dateField === "pac_actual_end_date") {
      return row.pac_actual_end_date || row.pac_end_date || "";
    }

    if (dateField === "btk_approved" || dateField === "btk_certificate_date") {
      return row.btk_approved || row.btk_certificate_date || "";
    }

    if (dateField === "tssr_plan_start_date") {
      return row.tssr_plan_start_date || row.tssr_plan_date || "";
    }

    if (dateField === "tssr_actual_end_date") {
      return row.tssr_actual_end_date || row.tssr_end_date || "";
    }

    if (dateField === "btk_plan_start_date") {
      return row.btk_plan_start_date || row.btk_plan_date || "";
    }

    if (dateField === "btk_actual_end_date") {
      return row.btk_actual_end_date || row.btk_end_date || "";
    }

    if (dateField === "power_plan_start_date") {
      return row.power_plan_start_date || row.power_start_date || "";
    }

    if (dateField === "power_actual_end_date") {
      return row.power_actual_end_date || row.power_end_date || "";
    }

    if (dateField === "enh_plan_start_date") {
      return row.enh_plan_start_date || "";
    }

    if (dateField === "enh_actual_end_date") {
      return row.enh_actual_end_date || "";
    }

    if (dateField === "abonelik_actual_end_date") {
      return row.abonelik_actual_end_date || row.abonelik_end_date || "";
    }

    return row[dateField] || "";
  };

  const getActualValue = (type, item, data) => {
    const backendValue = Number(data[item.key] || 0);

    if (item.key === "rf_equipment_received") {
      return getRowsByType(type).filter((r) => {
        const status = String(r.malzeme_status || "")
          .toUpperCase()
          .trim();
        return status === "OK";
      }).length;
    }
    if (
      ["5G", "DSS", "LTE", "STANDALONE"].includes(type) &&
      item.key === "target"
    ) {
      const uniqueSites = new Set();

      getRowsByType(type).forEach((r) => {
        const siteCode = String(r.site_code || "")
          .trim()
          .toUpperCase();

        if (siteCode) {
          uniqueSites.add(siteCode);
        }
      });

      return uniqueSites.size;
    }
    const calculatedValue = item.dateField
      ? getRowsByType(type).filter((r) => {
          const value = getSmartDateValue(r, item.dateField);

          return String(value || "").trim() !== "";
        }).length
      : getRowsByType(type).length;

    return calculatedValue;
  };
  const getEffectivePlanStartDate = (row) => {
    return (
      row.plan_start_date ||
      row.inst_plan_start_date ||
      row.rf_plan_start_date ||
      row.onair_date ||
      ""
    );
  };

  const getRowRegion = (r) => {
    const detected = getRegion(r.site_code);

    if (detected && detected !== "Tanımsız") {
      return detected;
    }

    return String(r.bolge || r.region || "").trim();
  };

  const normalizeRegionName = (value) =>
    String(value || "")
      .trim()
      .toLocaleLowerCase("tr-TR");

  const getRowsByType = (type) =>
    rows.filter((r) => {
      const rowType = String(r.site_type || "")
        .toUpperCase()
        .trim();

      const siteCode = String(r.site_code || "")
        .toUpperCase()
        .trim();

      const detectedRegion = getRowRegion(r);

      const regionOk =
        regionFilter === "ALL" ||
        normalizeRegionName(detectedRegion) ===
          normalizeRegionName(regionFilter);

      if (!regionOk) return false;

      if (type === "5G") {
        return rowType === "5G" || siteCode.includes("_5GEXP_");
      }

      if (type === "DSS") {
        return rowType === "DSS" || siteCode.includes("_DSS_");
      }

      if (type === "LTE") {
        return (
          rowType === "LTE" ||
          siteCode.includes("L800") ||
          siteCode.includes("L1800") ||
          siteCode.includes("L2600") ||
          siteCode.includes("L2100") ||
          siteCode.includes("NR700") ||
          siteCode.includes("TRP")
        );
      }

      if (type === "STANDALONE") {
        return rowType === "STANDALONE";
      }

      return rowType === type;
    });

  const pct = (actual, target) =>
    target > 0
      ? `${Math.round((Number(actual || 0) / Number(target || 0)) * 100)}%`
      : "0%";

  const currentWeek = getWeekNumber(new Date());
  const previousWeek = currentWeek - 1;

  const weekCount = (type, item, weekNo) => {
    const typeRows = getRowsByType(type);

    if (!item.dateField) return Number(getRow(type)[item.key] || 0);

    return typeRows.filter((r) => {
      const value =
        item.dateField === "plan_start_date"
          ? getSmartDateValue(r, "plan_start_date")
          : getSmartDateValue(r, item.dateField);
      if (value === "SMART_OK") return false;
      const week = getWeekNumber(value);
      return week && week <= weekNo;
    }).length;
  };

  const makeTable = (title, type, statusTitle, items) => {
    const data = getRow(type);

    const target = getActualValue(type, { key: "target" }, data);

    return (
      <div className="excelSummaryBox" key={title}>
        <table className="excelSummaryTable">
          <colgroup>
            <col className="excelColLabel" />
            <col />
            <col />
            <col />
            <col />
            <col />
            <col />
          </colgroup>

          <thead></thead>

          <thead>
            <tr>
              <th colSpan="7" className="excelTitle">
                {title}
              </th>
            </tr>

            <tr className="excelHeader">
              <th></th>
              <th>Target</th>
              <th>Actual</th>
              <th>%</th>
              <th>Week{previousWeek}</th>
              <th>Week{currentWeek}</th>
              <th>Δ</th>
            </tr>

            <tr className="excelTypeRow">
              <th>{type}</th>
              <th>{target}</th>
              <th></th>
              <th></th>
              <th></th>
              <th></th>
              <th></th>
            </tr>

            <tr>
              <th colSpan="7" className="excelStatusTitle">
                {statusTitle || "RF STATUS"}
              </th>
            </tr>
          </thead>

          <tbody>
            {items.map((item) => {
              const actual = getActualValue(type, item, data);
              const week13 = weekCount(type, item, previousWeek);
              const week14 = weekCount(type, item, currentWeek);
              const delta = week14 - week13;

              return (
                <tr key={item.label}>
                  <td className="excelLabel">{item.label}</td>
                  <td>{target}</td>
                  <td className="excelActual">{actual}</td>
                  <td>{pct(actual, target)}</td>
                  <td>{week13}</td>
                  <td>{week14}</td>
                  <td className="excelDelta">{delta}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="excelSummarySection">
      <h2 className="summaryMainTitle">📊 {regionTitle} Genel Durum</h2>

      <div className="excelSummaryGrid">
        {makeTable(`${regionTitle} 5G PLAN TOTAL`, "5G", "RF STATUS", [
          {
            label: "RF Equipment (BTS@DBS) Received",
            key: "rf_equipment_received",
          },
          {
            label: "RF Installation Started",
            key: "rf_installation_started",
            dateField: "installation_actual_start_date",
          },
          {
            label: "RF Installation Finished",
            key: "rf_installation_finished",
            dateField: "installation_actual_end_date",
          },
          {
            label: "QC(Closed)",
            key: "qc_closed",
            dateField: "qc_closed_date",
          },
          {
            label: "Acceptance",
            key: "acceptance",
            dateField: "pac_actual_end_date",
          },
        ])}

        {makeTable(
          `${regionTitle} STANDALONE PLAN TOTAL`,
          "STANDALONE",
          "RF STATUS",
          [
            {
              label: "RF Equipment (BTS@DBS) Received",
              key: "rf_equipment_received",
            },
            {
              label: "RF Installation Started",
              key: "rf_installation_started",
              dateField: "installation_actual_start_date",
            },
            {
              label: "RF Installation Finished",
              key: "rf_installation_finished",
              dateField: "installation_actual_end_date",
            },
            {
              label: "Acceptance",
              key: "acceptance",
              dateField: "pac_actual_end_date",
            },
            { label: "PO Status(Closed)", key: "po_closed" },
          ],
        )}

        {makeTable(`${regionTitle} DSS PLAN TOTAL`, "DSS", "RF STATUS", [
          {
            label: "RF Equipment (BTS@DBS) Received",
            key: "rf_equipment_received",
          },
          {
            label: "RF Installation Started",
            key: "rf_installation_started",
            dateField: "installation_actual_start_date",
          },
          {
            label: "RF Installation Finished",
            key: "rf_installation_finished",
            dateField: "installation_actual_end_date",
          },
          {
            label: "QC(Closed)",
            key: "qc_closed",
            dateField: "qc_closed_date",
          },
          {
            label: "Acceptance",
            key: "acceptance",
            dateField: "pac_actual_end_date",
          },
        ])}

        {makeTable(`${regionTitle} LTE PLAN TOTAL`, "LTE", "RF STATUS", [
          {
            label: "RF Equipment (BTS@DBS) Received",
            key: "rf_equipment_received",
          },
          {
            label: "RF Installation Started",
            key: "rf_installation_started",
            dateField: "installation_actual_start_date",
          },
          {
            label: "RF Installation Finished",
            key: "rf_installation_finished",
            dateField: "installation_actual_end_date",
          },
          {
            label: "Acceptance",
            key: "acceptance",
            dateField: "pac_actual_end_date",
          },
          { label: "PO Status(Closed)", key: "po_closed" },
        ])}

        {makeTable(`${regionTitle} Survey&BTK PLAN TOTAL`, "DSS", "", [
          {
            label: "TSSR Plan Start Date",
            key: "tssr_plan_start",
            dateField: "tssr_plan_start_date",
          },
          {
            label: "TSSR Actual End Date",
            key: "tssr_actual_end",
            dateField: "tssr_actual_end_date",
          },
          {
            label: "BTK Plan Start Date",
            key: "btk_plan_start",
            dateField: "btk_plan_start_date",
          },
          {
            label: "BTK Actual End Date",
            key: "btk_actual_end",
            dateField: "btk_actual_end_date",
          },
          { label: "BTK Approved by BTK", key: "btk_approved" },
          { label: "BTK Certificate Date", key: "btk_certificate_date" },
        ])}

        {makeTable(`${regionTitle} POWER PLAN TOTAL`, "DSS", "", [
          {
            label: "POWER Project Plan Start Date",
            key: "power_plan_start",
            dateField: "power_plan_start_date",
          },
          {
            label: "POWER Project Actual End Date",
            key: "power_actual_end",
            dateField: "power_actual_end_date",
          },
          {
            label: "ENH Plan Start Date",
            key: "enh_plan_start",
            dateField: "enh_plan_start_date",
          },
          {
            label: "ENH Actual End Date",
            key: "enh_actual_end",
            dateField: "enh_actual_end_date",
          },
          {
            label: "Abonelik Belgesi Actual End Date",
            key: "abonelik_end",
            dateField: "abonelik_actual_end_date",
          },
        ])}
      </div>
    </div>
  );
}
function RolloutEntryModal({ siteCode, rows, onClose, onSaved }) {
  const existingRow =
    rows.find(
      (r) =>
        String(r.site_code || "").toUpperCase() ===
        String(siteCode || "").toUpperCase(),
    ) || {};

  const [form, setForm] = useState({
    site_code: siteCode || existingRow.site_code || "",
    site_type: existingRow.site_type || "",
    site_physical_type: existingRow.site_physical_type || "",
    project_code: existingRow.project_code || "",
    malzeme_status: existingRow.malzeme_status || "",
    il: existingRow.il || "",

    rf_subcon: existingRow.rf_subcon || "",
    plan_start_date: existingRow.plan_start_date || "",
    installation_actual_start_date:
      existingRow.installation_actual_start_date || "",
    installation_actual_end_date:
      existingRow.installation_actual_end_date || "",
    onair_date: existingRow.onair_date || "",
    rf_not: existingRow.rf_not || "",
    atlas_status: existingRow.atlas_status || "",

    los_subcon: existingRow.los_subcon || "",
    los_plan_date: existingRow.los_plan_date || "",
    los_actual_end_date: existingRow.los_actual_end_date || "",

    tss_subcon: existingRow.tss_subcon || "",
    tss_plan_start_date: existingRow.tss_plan_start_date || "",
    tss_actual_end_date: existingRow.tss_actual_end_date || "",

    tssr_subcon: existingRow.tssr_subcon || "",
    tssr_plan_start_date: existingRow.tssr_plan_start_date || "",
    tssr_actual_end_date: existingRow.tssr_actual_end_date || "",

    btk_subcon: existingRow.btk_subcon || "",
    btk_plan_start_date: existingRow.btk_plan_start_date || "",
    btk_actual_end_date: existingRow.btk_actual_end_date || "",
    btk_approved: existingRow.btk_approved || "",
    gs_status: existingRow.gs_status || "",
    survey_note: existingRow.survey_note || "",

    emr_plan_start_date: existingRow.emr_plan_start_date || "",
    emr_actual_end_date: existingRow.emr_actual_end_date || "",

    trs_subcon: existingRow.trs_subcon || "",
    trs_plan_start_date: existingRow.trs_plan_start_date || "",
    trs_actual_end_date: existingRow.trs_actual_end_date || "",
    trs_not: existingRow.trs_not || "",

    enh_subcon: existingRow.enh_subcon || "",
    enh_site_type: existingRow.enh_site_type || "",
    enh_plan_start_date: existingRow.enh_plan_start_date || "",
    enh_actual_end_date: existingRow.enh_actual_end_date || "",
    enh_not: existingRow.enh_not || "",

    power_subcon: existingRow.power_subcon || "",
    power_plan_start_date: existingRow.power_plan_start_date || "",
    power_actual_end_date: existingRow.power_actual_end_date || "",

    abonelik_actual_end_date: existingRow.abonelik_actual_end_date || "",
    tt_horizon_actual_end_date: existingRow.tt_horizon_actual_end_date || "",
    pac_actual_end_date: existingRow.pac_actual_end_date || "",
  });

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const save = async () => {
    try {
      if (!form.site_code.trim()) {
        alert("Site Code zorunlu");
        return;
      }

      const result = await fetchJson(`${API_BASE}/rollout/update`, {
        method: "POST",
        withAuth: true,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      console.log("ROLLOUT SAVE RESULT:", result);
      alert("Kayıt başarıyla kaydedildi");

      onSaved();
    } catch (err) {
      console.error("ROLLOUT SAVE ERROR:", err);
      alert(err.message || "Kayıt sırasında hata oluştu");
    }
  };

  const deleteRollout = async () => {
    if (!existingRow.id) {
      alert("Bu kayıt henüz database içinde yok");
      return;
    }

    const ok = window.confirm(
      `${form.site_code} rollout kaydını silmek istediğine emin misin?`,
    );

    if (!ok) return;

    try {
      await fetchJson(`${API_BASE}/rollout/${existingRow.id}`, {
        method: "DELETE",
        withAuth: true,
      });

      alert("Kayıt silindi");
      onSaved();
    } catch (err) {
      console.error("ROLLOUT DELETE FRONT ERROR:", err);
      alert(err.message || "Kayıt silinemedi");
    }
  };

  const input = (label, field, type = "text") => (
    <label className="modalField">
      <span>{label}</span>
      <input
        type={type}
        value={form[field] || ""}
        onChange={(e) => handleChange(field, e.target.value)}
      />
    </label>
  );

  const select = (label, field, options) => (
    <label className="modalField">
      <span>{label}</span>
      <select
        value={form[field] || ""}
        onChange={(e) => handleChange(field, e.target.value)}
      >
        <option value="">Seçiniz</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="rolloutModal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <h2>Rollout Veri Girişi</h2>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="modalGrid">
          {input("Site Code", "site_code")}
          {select("Site Type", "site_type", ["5G", "DSS", "LTE", "STANDALONE"])}
          {select("Site Fiziksel Tip", "site_physical_type", [
            "Rooftop",
            "Kule",
            "Gizleme",
            "VF Katılım",
            "TT Katılım",
          ])}
          {input("Project Code", "project_code")}
          {input("Malzeme Status", "malzeme_status")}
          {input("İl", "il")}

          {input("RF Subcon", "rf_subcon")}
          {input("Plan Start Date", "plan_start_date", "date")}
          {input(
            "Installation Start Date",
            "installation_actual_start_date",
            "date",
          )}
          {input(
            "Installation End Date",
            "installation_actual_end_date",
            "date",
          )}
          {input("OnAir Date", "onair_date", "date")}
          {input("RF Not", "rf_not")}
          {input("Atlas Status", "atlas_status")}

          {input("LOS Subcon", "los_subcon")}
          {input("LOS Plan Date", "los_plan_date", "date")}
          {input("LOS Actual End Date", "los_actual_end_date", "date")}

          {input("TSS Subcon", "tss_subcon")}
          {input("TSS Plan Start Date", "tss_plan_start_date", "date")}
          {input("TSS Actual End Date", "tss_actual_end_date", "date")}

          {input("TSSR Subcon", "tssr_subcon")}
          {input("TSSR Plan Start Date", "tssr_plan_start_date", "date")}
          {input("TSSR Actual End Date", "tssr_actual_end_date", "date")}

          {input("BTK Subcon", "btk_subcon")}
          {input("BTK Plan Start Date", "btk_plan_start_date", "date")}
          {input("BTK Actual End Date", "btk_actual_end_date", "date")}
          {input("BTK Approval Status", "btk_approved")}
          {input("GS Status", "gs_status")}
          {input("Survey Note", "survey_note")}

          {input("ENH Subcon", "enh_subcon")}
          {select("ENH Site Type", "enh_site_type", [
            "Abone",
            "Süzme",
            "Abone + Süzme",
          ])}
          {input("ENH Plan Start Date", "enh_plan_start_date", "date")}
          {input("ENH Actual End Date", "enh_actual_end_date", "date")}
          {input("ENH Not", "enh_not")}

          {input("Power Subcon", "power_subcon")}
          {input("Power Plan Start Date", "power_plan_start_date", "date")}
          {input("Power Actual End Date", "power_actual_end_date", "date")}

          {input(
            "Abonelik Actual End Date",
            "abonelik_actual_end_date",
            "date",
          )}
          {input(
            "Horizon Actual End Date",
            "tt_horizon_actual_end_date",
            "date",
          )}
          {input("PAC Actual End Date", "pac_actual_end_date", "date")}
        </div>

        <div className="modalActions">
          <button className="tab" onClick={onClose}>
            Kapat
          </button>

          {existingRow.id && (
            <button
              className="tab"
              onClick={deleteRollout}
              style={{
                background: "#fee2e2",
                color: "#991b1b",
                fontWeight: "700",
              }}
            >
              Kaydı Sil
            </button>
          )}

          <button className="saveButton" onClick={save}>
            Kaydet
          </button>
        </div>
      </div>
    </div>
  );
}
const ARAC_MARKALAR = {
  "Dacia":         ["Duster","Sandero","Logan","Jogger","Spring"],
  "Fiat":          ["Doblo","Fiorino","Egea","Tipo","Panda","500","Ducato","Scudo"],
  "Ford":          ["Transit","Transit Custom","Transit Connect","Focus","Fiesta","Ranger","Kuga","Puma","Tourneo"],
  "Hyundai":       ["i10","i20","i30","Tucson","Santa Fe","Kona","Ioniq","H-1","H350"],
  "Isuzu":         ["D-Max","N35","N75","NLR","NPR"],
  "Kia":           ["Picanto","Rio","Ceed","Sportage","Sorento","Stonic","Niro","Carnival"],
  "Mercedes-Benz": ["Sprinter","Vito","Citan","A Serisi","C Serisi","E Serisi","GLA","GLC","Axor","Actros"],
  "Mitsubishi":    ["L200","Outlander","ASX","Eclipse Cross","Colt","Pajero"],
  "Nissan":        ["Navara","NV200","NV400","Qashqai","Juke","Micra","X-Trail"],
  "Opel":          ["Combo","Vivaro","Movano","Astra","Corsa","Insignia","Crossland","Mokka"],
  "Peugeot":       ["Boxer","Partner","Expert","208","308","3008","5008","2008"],
  "Renault":       ["Master","Trafic","Kangoo","Clio","Megane","Captur","Duster","Taliant","Zoe"],
  "Skoda":         ["Octavia","Fabia","Karoq","Kodiaq","Superb","Scala"],
  "Suzuki":        ["Swift","Vitara","S-Cross","Jimny","Ignis"],
  "Toyota":        ["HiAce","ProAce","Land Cruiser","RAV4","C-HR","Corolla","Yaris","Hilux","Proace City"],
  "Volkswagen":    ["Transporter","Caravelle","Crafter","Caddy","Polo","Golf","Passat","Tiguan","T-Roc","T-Cross"],
  "Volvo":         ["FH","FM","FMX","FE","FL","XC60","XC90"],
  "Citroen":       ["Berlingo","Dispatch","Jumper","Jumpy","C3","C4","C5"],
  "Iveco":         ["Daily","Eurocargo","Stralis","S-Way"],
  "MAN":           ["TGE","TGL","TGM","TGS","TGX"],
  "Diger":         ["Diger"],
};
const ARAC_YIL = Array.from({length: 25}, (_, i) => 2026 - i);

// ─── ARAÇLAR PANELİ ───────────────────────────────────────────────────────────
function AraclarPanel({ currentUser, onBack }) {
  const isPM = currentUser?.email === "orhan.bedir@simsektel.com";
  const isDirektor = currentUser?.email === "duzgun.simsek@simsektel.com";
  const isMuhasebe = currentUser?.email === "muhasebe@simsektel.com";
  const canEdit = isPM || isDirektor || isMuhasebe;

  const [araclar, setAraclar] = useState([]);
  const [selected, setSelected] = useState(null); // detail/edit araç
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    plaka:"", marka:"", model:"", yil:"", tip:"Binek",
    kiralama_firmasi:"", sozlesme_no:"", kira_baslangic:"", kira_bitis:"",
    aylik_kira:"", bolge:"", surucu:"", sigorta_bitis:"", muayene_bitis:"",
    durum:"AKTİF", notlar:""
  });
  const [belgeUpload, setBelgeUpload] = useState({ turu:null, file:null }); // {turu, file}
  const [filter, setFilter] = useState("TUMU"); // TUMU | AKTİF | PASİF

  const load = async () => {
    const r = await fetch(`${API_BASE}/hr/araclar`);
    setAraclar(await r.json());
  };

  useEffect(() => { load(); }, []);

  const today = new Date();
  const dayDiff = (d) => d ? Math.ceil((new Date(d) - today) / 86400000) : null;

  const expiryColor = (d) => {
    const diff = dayDiff(d);
    if (diff === null) return "#9ca3af";
    if (diff < 0) return "#dc2626";
    if (diff <= 30) return "#f59e0b";
    return "#166534";
  };
  const expiryBg = (d) => {
    const diff = dayDiff(d);
    if (diff === null) return "#f3f4f6";
    if (diff < 0) return "#fee2e2";
    if (diff <= 30) return "#fef9c3";
    return "#dcfce7";
  };

  const openNew = () => {
    setForm({ plaka:"", marka:"", model:"", yil:"", tip:"Binek",
      kiralama_firmasi:"", sozlesme_no:"", kira_baslangic:"", kira_bitis:"",
      aylik_kira:"", bolge:"", surucu:"", sigorta_bitis:"", muayene_bitis:"",
      durum:"AKTİF", notlar:"" });
    setSelected(null);
    setShowForm(true);
  };

  const openEdit = (a) => {
    const fmt = (d) => d ? d.slice(0,10) : "";
    setForm({
      plaka: a.plaka||"", marka: a.marka||"", model: a.model||"", yil: a.yil||"",
      tip: a.tip||"Binek", kiralama_firmasi: a.kiralama_firmasi||"",
      sozlesme_no: a.sozlesme_no||"",
      kira_baslangic: fmt(a.kira_baslangic), kira_bitis: fmt(a.kira_bitis),
      aylik_kira: a.aylik_kira||"", bolge: a.bolge||"", surucu: a.surucu||"",
      sigorta_bitis: fmt(a.sigorta_bitis), muayene_bitis: fmt(a.muayene_bitis),
      durum: a.durum||"AKTİF", notlar: a.notlar||""
    });
    setSelected(a);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.plaka) return alert("Plaka zorunlu");
    const method = selected ? "PUT" : "POST";
    const url = selected ? `${API_BASE}/hr/araclar/${selected.id}` : `${API_BASE}/hr/araclar`;
    const r = await fetch(url, { method, headers:{"Content-Type":"application/json"}, body: JSON.stringify(form) });
    if (!r.ok) { const e = await r.json(); return alert(e.error); }
    setShowForm(false);
    load();
  };

  const handleBelgeUpload = async (aracId, turu, file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("dosya", file);
    fd.append("belge_turu", turu);
    await fetch(`${API_BASE}/hr/araclar/${aracId}/belge`, { method:"POST", body:fd });
    load();
    setBelgeUpload({ turu:null, file:null });
  };

  const handleBelgeSil = async (belgeId) => {
    if (!window.confirm("Bu belgeyi silmek istediğinizden emin misiniz?")) return;
    await fetch(`${API_BASE}/hr/arac-belge/${belgeId}`, { method:"DELETE" });
    load();
  };

  const getBelge = (arac, turu) => (arac.belgeler||[]).find(b => b.belge_turu === turu);

  const filtered = araclar.filter(a => filter === "TUMU" ? true : a.durum === filter);

  const TIPLER = ["Binek","Pickup","Minibüs","Panelvan","Kamyon","Motosiklet","Diğer"];
  const DURUMLAR = ["AKTİF","PASİF","SERVİSTE"];
  const aracModeller = ARAC_MARKALAR[form.marka] || [];
  const aSelSt = { width:"100%", padding:"9px 12px", border:"1px solid #d1d5db", borderRadius:"8px", fontSize:"14px", boxSizing:"border-box", background:"#fff" };
  const aInpSt = { width:"100%", padding:"9px 12px", border:"1px solid #d1d5db", borderRadius:"8px", fontSize:"14px", boxSizing:"border-box" };

  const BELGE_YUVALARI = [
    { turu:"SOZLESME", label:"📄 Kira Sözleşmesi" },
    { turu:"RUHSAT",   label:"📋 Ruhsat" },
    { turu:"SIGORTA",  label:"🛡 Sigorta Poliçesi" },
    { turu:"MUAYENE",  label:"🔧 Muayene Belgesi" },
  ];

  const detailArac = selected && araclar.find(a => a.id === selected.id);

  return (
    <div style={{ maxWidth:"1100px", margin:"0 auto", padding:"24px 16px" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"24px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"14px" }}>
          {onBack && <button onClick={onBack} style={{ background:"#f3f4f6", border:"none", borderRadius:"50%", width:"36px", height:"36px", fontSize:"18px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>←</button>}
          <div>
            <h2 style={{ margin:0, fontSize:"22px", fontWeight:800, color:"#1e3a5f" }}>🚗 Araç Filosu</h2>
            <p style={{ margin:"4px 0 0", fontSize:"13px", color:"#6b7280" }}>{araclar.filter(a=>a.durum==="AKTİF").length} aktif araç</p>
          </div>
        </div>
        <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
          {["TUMU","AKTİF","PASİF","SERVİSTE"].map(f => (
            <button key={f} onClick={()=>setFilter(f)}
              style={{ padding:"6px 14px", borderRadius:"20px", border:"none", cursor:"pointer", fontSize:"12px", fontWeight:600,
                background: filter===f ? "#1e3a5f" : "#f3f4f6", color: filter===f ? "#fff" : "#374151" }}>
              {f}
            </button>
          ))}
          {canEdit && (
            <button onClick={openNew}
              style={{ padding:"9px 18px", background:"#1e3a5f", color:"#fff", border:"none", borderRadius:"10px", fontWeight:700, cursor:"pointer", fontSize:"14px" }}>
              ＋ Araç Ekle
            </button>
          )}
        </div>
      </div>

      {/* Expiry warnings summary */}
      {(() => {
        const expiring = araclar.filter(a => {
          const sd = dayDiff(a.sigorta_bitis);
          const md = dayDiff(a.muayene_bitis);
          const kd = dayDiff(a.kira_bitis);
          return (sd !== null && sd <= 30) || (md !== null && md <= 30) || (kd !== null && kd <= 30);
        });
        if (!expiring.length) return null;
        return (
          <div style={{ background:"#fef9c3", border:"1px solid #fde047", borderRadius:"12px", padding:"12px 16px", marginBottom:"20px" }}>
            <strong style={{ color:"#713f12", fontSize:"13px" }}>⚠️ Yaklaşan Bitiş Tarihleri ({expiring.length} araç)</strong>
            <div style={{ marginTop:"6px", display:"flex", flexWrap:"wrap", gap:"6px" }}>
              {expiring.map(a => (
                <span key={a.id} onClick={()=>openEdit(a)} style={{ background:"#fff", border:"1px solid #fde047", borderRadius:"8px", padding:"4px 10px", fontSize:"12px", cursor:"pointer", color:"#92400e", fontWeight:600 }}>
                  {a.plaka}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Araç kartları */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(320px, 1fr))", gap:"16px" }}>
        {filtered.map(a => {
          const sd = dayDiff(a.sigorta_bitis);
          const md = dayDiff(a.muayene_bitis);
          const kd = dayDiff(a.kira_bitis);
          return (
            <div key={a.id} style={{ background:"#fff", borderRadius:"14px", boxShadow:"0 1px 6px rgba(0,0,0,0.08)", overflow:"hidden" }}>
              {/* Card header */}
              <div style={{ background: a.durum==="AKTİF" ? "#1e3a5f" : a.durum==="SERVİSTE" ? "#92400e" : "#6b7280", padding:"14px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ color:"#fff", fontWeight:900, fontSize:"20px", letterSpacing:"1px" }}>{a.plaka}</div>
                  <div style={{ color:"#bfdbfe", fontSize:"13px" }}>{a.marka} {a.model} {a.yil ? `(${a.yil})` : ""} · {a.tip}</div>
                </div>
                <span style={{ background:"rgba(255,255,255,0.15)", color:"#fff", borderRadius:"20px", padding:"4px 10px", fontSize:"12px", fontWeight:700 }}>{a.durum}</span>
              </div>
              {/* Card body */}
              <div style={{ padding:"14px 16px" }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px", marginBottom:"10px" }}>
                  {a.kiralama_firmasi && <div style={{ fontSize:"12px", color:"#6b7280" }}>🏢 {a.kiralama_firmasi}</div>}
                  {a.bolge && <div style={{ fontSize:"12px", color:"#6b7280" }}>📍 {a.bolge}</div>}
                  {a.surucu && <div style={{ fontSize:"12px", color:"#6b7280" }}>👤 {a.surucu}</div>}
                  {a.aylik_kira && <div style={{ fontSize:"12px", color:"#6b7280" }}>💰 ₺{Number(a.aylik_kira).toLocaleString("tr-TR")}/ay</div>}
                </div>
                {/* Expiry badges */}
                <div style={{ display:"flex", gap:"6px", flexWrap:"wrap", marginBottom:"10px" }}>
                  {a.kira_bitis && (
                    <span style={{ fontSize:"11px", fontWeight:600, padding:"3px 8px", borderRadius:"6px", background:expiryBg(a.kira_bitis), color:expiryColor(a.kira_bitis) }}>
                      📅 Kira: {new Date(a.kira_bitis).toLocaleDateString("tr-TR")}
                      {kd !== null && kd <= 60 && ` (${kd < 0 ? "GEÇTİ" : kd+" gün"})`}
                    </span>
                  )}
                  {a.sigorta_bitis && (
                    <span style={{ fontSize:"11px", fontWeight:600, padding:"3px 8px", borderRadius:"6px", background:expiryBg(a.sigorta_bitis), color:expiryColor(a.sigorta_bitis) }}>
                      🛡 Sigorta: {new Date(a.sigorta_bitis).toLocaleDateString("tr-TR")}
                      {sd !== null && sd <= 60 && ` (${sd < 0 ? "GEÇTİ" : sd+" gün"})`}
                    </span>
                  )}
                  {a.muayene_bitis && (
                    <span style={{ fontSize:"11px", fontWeight:600, padding:"3px 8px", borderRadius:"6px", background:expiryBg(a.muayene_bitis), color:expiryColor(a.muayene_bitis) }}>
                      🔧 Muayene: {new Date(a.muayene_bitis).toLocaleDateString("tr-TR")}
                      {md !== null && md <= 60 && ` (${md < 0 ? "GEÇTİ" : md+" gün"})`}
                    </span>
                  )}
                </div>
                {/* Belge durumu */}
                <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
                  {BELGE_YUVALARI.map(({ turu, label }) => {
                    const b = getBelge(a, turu);
                    return b ? (
                      <a key={turu} href={`${API_BASE}/hr/arac-belge/file/${b.dosya_yolu}?name=${encodeURIComponent(b.dosya_adi)}`}
                        style={{ fontSize:"11px", background:"#dcfce7", color:"#166534", padding:"3px 8px", borderRadius:"6px", textDecoration:"none", fontWeight:600 }}>
                        ✓ {label.replace(/^[^ ]+ /,"")}
                      </a>
                    ) : (
                      <span key={turu} style={{ fontSize:"11px", background:"#f3f4f6", color:"#9ca3af", padding:"3px 8px", borderRadius:"6px" }}>
                        — {label.replace(/^[^ ]+ /,"")}
                      </span>
                    );
                  })}
                </div>
                {/* Actions */}
                {canEdit && (
                  <button onClick={()=>openEdit(a)}
                    style={{ marginTop:"12px", width:"100%", padding:"8px", background:"#f3f4f6", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer", color:"#374151" }}>
                    ✏️ Düzenle / Belge Yükle
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"60px 0", color:"#9ca3af" }}>
            Henüz araç kaydı yok
          </div>
        )}
      </div>

      {/* Form / Detail Modal */}
      {showForm && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-start", justifyContent:"center", zIndex:500, overflowY:"auto", padding:"20px 16px" }}>
          <div style={{ background:"#fff", borderRadius:"16px", width:"100%", maxWidth:"640px", padding:"28px 24px", position:"relative" }}>
            <button onClick={()=>setShowForm(false)}
              style={{ position:"absolute", top:"16px", right:"16px", background:"#f3f4f6", border:"none", borderRadius:"50%", width:"32px", height:"32px", fontSize:"18px", cursor:"pointer" }}>✕</button>
            <h3 style={{ margin:"0 0 20px", fontSize:"18px", fontWeight:800, color:"#1e3a5f" }}>
              {selected ? `✏️ ${form.plaka}` : "🚗 Yeni Araç"}
            </h3>

            {/* Form fields */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px", marginBottom:"16px" }}>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>Plaka *</label>
                <input value={form.plaka||""} onChange={e=>setForm(f=>({...f,plaka:e.target.value.toUpperCase()}))} style={aInpSt} />
              </div>
              <div>
                <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>Marka</label>
                <select value={form.marka||""} onChange={e=>setForm(f=>({...f,marka:e.target.value,model:""}))} style={aSelSt}>
                  <option value="">Seçin</option>
                  {Object.keys(ARAC_MARKALAR).map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>Model</label>
                {aracModeller.length > 0
                  ? <select value={form.model||""} onChange={e=>setForm(f=>({...f,model:e.target.value}))} style={aSelSt}>
                      <option value="">Seçin</option>
                      {aracModeller.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  : <input value={form.model||""} onChange={e=>setForm(f=>({...f,model:e.target.value}))} placeholder="Model" style={aInpSt} />
                }
              </div>
              <div>
                <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>Yıl</label>
                <select value={form.yil||""} onChange={e=>setForm(f=>({...f,yil:e.target.value}))} style={aSelSt}>
                  <option value="">Seçin</option>
                  {ARAC_YIL.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>Kiralama Firması</label>
                <input value={form.kiralama_firmasi||""} onChange={e=>setForm(f=>({...f,kiralama_firmasi:e.target.value}))} style={aInpSt} />
              </div>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>Sözleşme No</label>
                <input value={form.sozlesme_no||""} onChange={e=>setForm(f=>({...f,sozlesme_no:e.target.value}))} style={aInpSt} />
              </div>
              <div>
                <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>Aylık Kira (₺)</label>
                <input type="number" value={form.aylik_kira||""} onChange={e=>setForm(f=>({...f,aylik_kira:e.target.value}))} style={aInpSt} />
              </div>
              <div>
                <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>Sürücü / Kullanan</label>
                <input value={form.surucu||""} onChange={e=>setForm(f=>({...f,surucu:e.target.value}))} style={aInpSt} />
              </div>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>Atandığı Bölge / Saha</label>
                <input value={form.bolge||""} onChange={e=>setForm(f=>({...f,bolge:e.target.value}))} style={aInpSt} />
              </div>
              <div>
                <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>Kira Başlangıç</label>
                <input type="date" value={form.kira_baslangic||""} onChange={e=>setForm(f=>({...f,kira_baslangic:e.target.value}))} style={aInpSt} />
              </div>
              <div>
                <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>Kira Bitiş</label>
                <input type="date" value={form.kira_bitis||""} onChange={e=>setForm(f=>({...f,kira_bitis:e.target.value}))} style={aInpSt} />
              </div>
              <div>
                <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>Sigorta Bitiş</label>
                <input type="date" value={form.sigorta_bitis||""} onChange={e=>setForm(f=>({...f,sigorta_bitis:e.target.value}))} style={aInpSt} />
              </div>
              <div>
                <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>Muayene Bitiş</label>
                <input type="date" value={form.muayene_bitis||""} onChange={e=>setForm(f=>({...f,muayene_bitis:e.target.value}))} style={aInpSt} />
              </div>
              <div>
                <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>Araç Tipi</label>
                <select value={form.tip} onChange={e=>setForm(f=>({...f,tip:e.target.value}))}
                  style={{ width:"100%", padding:"9px 12px", border:"1px solid #d1d5db", borderRadius:"8px", fontSize:"14px" }}>
                  {TIPLER.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>Durum</label>
                <select value={form.durum} onChange={e=>setForm(f=>({...f,durum:e.target.value}))}
                  style={{ width:"100%", padding:"9px 12px", border:"1px solid #d1d5db", borderRadius:"8px", fontSize:"14px" }}>
                  {DURUMLAR.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div style={{ gridColumn:"1 / -1" }}>
                <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>Notlar</label>
                <textarea value={form.notlar||""} onChange={e=>setForm(f=>({...f,notlar:e.target.value}))} rows={2}
                  style={{ width:"100%", padding:"9px 12px", border:"1px solid #d1d5db", borderRadius:"8px", fontSize:"14px", resize:"vertical", boxSizing:"border-box" }} />
              </div>
            </div>

            <button onClick={handleSave}
              style={{ width:"100%", padding:"13px", background:"#1e3a5f", color:"#fff", border:"none", borderRadius:"10px", fontWeight:700, fontSize:"15px", cursor:"pointer", marginBottom: selected ? "24px" : 0 }}>
              💾 Kaydet
            </button>

            {/* Belge yükleme — sadece düzenleme modunda */}
            {selected && detailArac && (
              <div style={{ borderTop:"1px solid #e5e7eb", paddingTop:"20px" }}>
                <h4 style={{ margin:"0 0 14px", fontSize:"15px", fontWeight:700, color:"#1e3a5f" }}>📁 Belgeler</h4>
                <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                  {BELGE_YUVALARI.map(({ turu, label }) => {
                    const b = getBelge(detailArac, turu);
                    return (
                      <div key={turu} style={{ background:"#f9fafb", border:"1px solid #e5e7eb", borderRadius:"10px", padding:"12px 14px", display:"flex", alignItems:"center", gap:"12px" }}>
                        <span style={{ fontWeight:700, fontSize:"13px", color:"#374151", minWidth:"150px" }}>{label}</span>
                        {b ? (
                          <>
                            <a href={`${API_BASE}/hr/arac-belge/file/${b.dosya_yolu}?name=${encodeURIComponent(b.dosya_adi)}`}
                              style={{ fontSize:"12px", color:"#1d4ed8", fontWeight:600, flex:1 }}>
                              📥 {b.dosya_adi}
                            </a>
                            {canEdit && (
                              <button onClick={()=>handleBelgeSil(b.id)}
                                style={{ background:"#fee2e2", color:"#dc2626", border:"none", borderRadius:"6px", padding:"4px 10px", fontSize:"12px", cursor:"pointer", fontWeight:600 }}>
                                Sil
                              </button>
                            )}
                          </>
                        ) : (
                          <span style={{ fontSize:"12px", color:"#9ca3af", flex:1 }}>— Henüz yüklenmedi</span>
                        )}
                        {canEdit && (
                          <label style={{ background:"#dbeafe", color:"#1d4ed8", borderRadius:"6px", padding:"5px 10px", fontSize:"12px", cursor:"pointer", fontWeight:600, whiteSpace:"nowrap" }}>
                            {b ? "Güncelle" : "Yükle"}
                            <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display:"none" }}
                              onChange={async e => { if(e.target.files[0]) await handleBelgeUpload(selected.id, turu, e.target.files[0]); e.target.value=""; }} />
                          </label>
                        )}
                      </div>
                    );
                  })}
                  {/* Diğer belgeler */}
                  {(detailArac.belgeler||[]).filter(b=>b.belge_turu==="DIGER").map(b => (
                    <div key={b.id} style={{ background:"#f9fafb", border:"1px solid #e5e7eb", borderRadius:"10px", padding:"12px 14px", display:"flex", alignItems:"center", gap:"12px" }}>
                      <span style={{ fontSize:"12px", color:"#6b7280", minWidth:"150px" }}>📎 Ek Belge</span>
                      <a href={`${API_BASE}/hr/arac-belge/file/${b.dosya_yolu}?name=${encodeURIComponent(b.dosya_adi)}`}
                        style={{ fontSize:"12px", color:"#1d4ed8", fontWeight:600, flex:1 }}>📥 {b.dosya_adi}</a>
                      {canEdit && (
                        <button onClick={()=>handleBelgeSil(b.id)}
                          style={{ background:"#fee2e2", color:"#dc2626", border:"none", borderRadius:"6px", padding:"4px 10px", fontSize:"12px", cursor:"pointer", fontWeight:600 }}>Sil</button>
                      )}
                    </div>
                  ))}
                  {canEdit && (
                    <label style={{ background:"#f0fdf4", border:"1px dashed #86efac", borderRadius:"10px", padding:"12px", textAlign:"center", cursor:"pointer", color:"#166534", fontSize:"13px", fontWeight:600 }}>
                      ➕ Ek Belge Yükle
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display:"none" }}
                        onChange={async e => { if(e.target.files[0]) await handleBelgeUpload(selected.id, "DIGER", e.target.files[0]); e.target.value=""; }} />
                    </label>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── OFİS & DEPO PANELİ ──────────────────────────────────────────────────────
function OfisDepoPanel({ currentUser, onBack }) {
  const isPM = currentUser?.email === "orhan.bedir@simsektel.com";
  const isDirektor = currentUser?.email === "duzgun.simsek@simsektel.com";
  const isMuhasebe = currentUser?.email === "muhasebe@simsektel.com";
  const canEdit = isPM || isDirektor || isMuhasebe;

  const [liste, setListe] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    tur:"OFİS", ad:"", bolge:"", adres:"", kiraya_veren:"", sozlesme_no:"",
    kira_baslangic:"", kira_bitis:"", aylik_kira:"", metrekare:"", kat:"",
    sorumlu:"", durum:"AKTİF", notlar:""
  });
  const [filter, setFilter] = useState("TUMU");

  const load = async () => {
    const r = await fetch(`${API_BASE}/hr/ofis`);
    setListe(await r.json());
  };
  useEffect(() => { load(); }, []);

  const today = new Date();
  const dayDiff = (d) => d ? Math.ceil((new Date(d) - today) / 86400000) : null;
  const expiryColor = (d) => { const n=dayDiff(d); if(n===null)return"#9ca3af"; if(n<0)return"#dc2626"; if(n<=30)return"#f59e0b"; return"#166534"; };
  const expiryBg = (d) => { const n=dayDiff(d); if(n===null)return"#f3f4f6"; if(n<0)return"#fee2e2"; if(n<=30)return"#fef9c3"; return"#dcfce7"; };

  const openNew = () => {
    setForm({ tur:"OFİS", ad:"", bolge:"", adres:"", kiraya_veren:"", sozlesme_no:"",
      kira_baslangic:"", kira_bitis:"", aylik_kira:"", metrekare:"", kat:"",
      sorumlu:"", durum:"AKTİF", notlar:"" });
    setSelected(null); setShowForm(true);
  };
  const openEdit = (o) => {
    const fmt = (d) => d ? d.slice(0,10) : "";
    setForm({ tur:o.tur||"OFİS", ad:o.ad||"", bolge:o.bolge||"", adres:o.adres||"",
      kiraya_veren:o.kiraya_veren||"", sozlesme_no:o.sozlesme_no||"",
      kira_baslangic:fmt(o.kira_baslangic), kira_bitis:fmt(o.kira_bitis),
      aylik_kira:o.aylik_kira||"", metrekare:o.metrekare||"", kat:o.kat||"",
      sorumlu:o.sorumlu||"", durum:o.durum||"AKTİF", notlar:o.notlar||""
    });
    setSelected(o); setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.ad) return alert("Ad zorunlu");
    const method = selected ? "PUT" : "POST";
    const url = selected ? `${API_BASE}/hr/ofis/${selected.id}` : `${API_BASE}/hr/ofis`;
    const r = await fetch(url, { method, headers:{"Content-Type":"application/json"}, body: JSON.stringify(form) });
    if (!r.ok) { const e = await r.json(); return alert(e.error); }
    setShowForm(false); load();
  };

  const handleBelgeUpload = async (ofisId, turu, file) => {
    if (!file) return;
    const fd = new FormData(); fd.append("dosya", file); fd.append("belge_turu", turu);
    await fetch(`${API_BASE}/hr/ofis/${ofisId}/belge`, { method:"POST", body:fd });
    load();
  };
  const handleBelgeSil = async (id) => {
    if (!window.confirm("Bu belgeyi silmek istediğinizden emin misiniz?")) return;
    await fetch(`${API_BASE}/hr/ofis-belge/${id}`, { method:"DELETE" }); load();
  };
  const getSozlesme = (o) => (o.belgeler||[]).find(b=>b.belge_turu==="SOZLESME");
  const getEkler = (o) => (o.belgeler||[]).filter(b=>b.belge_turu!=="SOZLESME");

  const turIcon = { "OFİS":"🏢", "DEPO":"🏭", "OFİS+DEPO":"🏗" };
  const filtered = liste.filter(o => filter==="TUMU" ? true : o.durum===filter);
  const detailOfis = selected && liste.find(o => o.id === selected.id);

  return (
    <div style={{ maxWidth:"1100px", margin:"0 auto", padding:"24px 16px" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"24px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"14px" }}>
          {onBack && <button onClick={onBack} style={{ background:"#f3f4f6", border:"none", borderRadius:"50%", width:"36px", height:"36px", fontSize:"18px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>←</button>}
          <div>
            <h2 style={{ margin:0, fontSize:"22px", fontWeight:800, color:"#1e3a5f" }}>🏢 Ofis & Depo</h2>
            <p style={{ margin:"4px 0 0", fontSize:"13px", color:"#6b7280" }}>{liste.filter(o=>o.durum==="AKTİF").length} aktif konum</p>
          </div>
        </div>
        <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
          {["TUMU","AKTİF","PASİF"].map(f => (
            <button key={f} onClick={()=>setFilter(f)}
              style={{ padding:"6px 14px", borderRadius:"20px", border:"none", cursor:"pointer", fontSize:"12px", fontWeight:600,
                background: filter===f ? "#1e3a5f" : "#f3f4f6", color: filter===f ? "#fff" : "#374151" }}>
              {f}
            </button>
          ))}
          {canEdit && (
            <button onClick={openNew}
              style={{ padding:"9px 18px", background:"#1e3a5f", color:"#fff", border:"none", borderRadius:"10px", fontWeight:700, cursor:"pointer", fontSize:"14px" }}>
              ＋ Ekle
            </button>
          )}
        </div>
      </div>

      {/* Kira bitiş uyarıları */}
      {(() => {
        const exp = liste.filter(o => { const d=dayDiff(o.kira_bitis); return d!==null && d<=30; });
        if (!exp.length) return null;
        return (
          <div style={{ background:"#fef9c3", border:"1px solid #fde047", borderRadius:"12px", padding:"12px 16px", marginBottom:"20px" }}>
            <strong style={{ color:"#713f12", fontSize:"13px" }}>⚠️ Kira Bitiş Yaklaşıyor ({exp.length} konum)</strong>
            <div style={{ marginTop:"6px", display:"flex", flexWrap:"wrap", gap:"6px" }}>
              {exp.map(o => (
                <span key={o.id} onClick={()=>openEdit(o)}
                  style={{ background:"#fff", border:"1px solid #fde047", borderRadius:"8px", padding:"4px 10px", fontSize:"12px", cursor:"pointer", color:"#92400e", fontWeight:600 }}>
                  {o.ad}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(300px, 1fr))", gap:"16px" }}>
        {filtered.map(o => (
          <div key={o.id} style={{ background:"#fff", borderRadius:"14px", boxShadow:"0 1px 6px rgba(0,0,0,0.08)", overflow:"hidden" }}>
            <div style={{ background: o.durum==="AKTİF" ? "#1e3a5f" : "#6b7280", padding:"14px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ color:"#fff", fontWeight:800, fontSize:"17px" }}>{turIcon[o.tur]||"🏢"} {o.ad}</div>
                <div style={{ color:"#bfdbfe", fontSize:"12px" }}>{o.tur} · {o.bolge}</div>
              </div>
              <span style={{ background:"rgba(255,255,255,0.15)", color:"#fff", borderRadius:"20px", padding:"3px 9px", fontSize:"11px", fontWeight:700 }}>{o.durum}</span>
            </div>
            <div style={{ padding:"14px 16px" }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px", marginBottom:"10px" }}>
                {o.adres && <div style={{ fontSize:"12px", color:"#6b7280", gridColumn:"1/-1" }}>📍 {o.adres}</div>}
                {o.kiraya_veren && <div style={{ fontSize:"12px", color:"#6b7280" }}>🏘 {o.kiraya_veren}</div>}
                {o.sorumlu && <div style={{ fontSize:"12px", color:"#6b7280" }}>👤 {o.sorumlu}</div>}
                {o.aylik_kira && <div style={{ fontSize:"12px", color:"#6b7280" }}>💰 ₺{Number(o.aylik_kira).toLocaleString("tr-TR")}/ay</div>}
                {o.metrekare && <div style={{ fontSize:"12px", color:"#6b7280" }}>📐 {o.metrekare} m²{o.kat ? ` · ${o.kat}. Kat` : ""}</div>}
              </div>
              <div style={{ display:"flex", gap:"6px", flexWrap:"wrap", marginBottom:"10px" }}>
                {o.kira_bitis && (
                  <span style={{ fontSize:"11px", fontWeight:600, padding:"3px 8px", borderRadius:"6px", background:expiryBg(o.kira_bitis), color:expiryColor(o.kira_bitis) }}>
                    📅 Kira: {new Date(o.kira_bitis).toLocaleDateString("tr-TR")}
                    {dayDiff(o.kira_bitis) !== null && dayDiff(o.kira_bitis) <= 60 && ` (${dayDiff(o.kira_bitis) < 0 ? "GEÇTİ" : dayDiff(o.kira_bitis)+" gün"})`}
                  </span>
                )}
              </div>
              <div style={{ display:"flex", gap:"6px" }}>
                {getSozlesme(o) ? (
                  <a href={`${API_BASE}/hr/ofis-belge/file/${getSozlesme(o).dosya_yolu}?name=${encodeURIComponent(getSozlesme(o).dosya_adi)}`}
                    style={{ fontSize:"11px", background:"#dcfce7", color:"#166534", padding:"3px 8px", borderRadius:"6px", textDecoration:"none", fontWeight:600 }}>
                    ✓ Sözleşme
                  </a>
                ) : (
                  <span style={{ fontSize:"11px", background:"#f3f4f6", color:"#9ca3af", padding:"3px 8px", borderRadius:"6px" }}>— Sözleşme yok</span>
                )}
                {getEkler(o).length > 0 && (
                  <span style={{ fontSize:"11px", background:"#dbeafe", color:"#1d4ed8", padding:"3px 8px", borderRadius:"6px", fontWeight:600 }}>
                    +{getEkler(o).length} ek belge
                  </span>
                )}
              </div>
              {canEdit && (
                <button onClick={()=>openEdit(o)}
                  style={{ marginTop:"12px", width:"100%", padding:"8px", background:"#f3f4f6", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer", color:"#374151" }}>
                  ✏️ Düzenle / Belge Yükle
                </button>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"60px 0", color:"#9ca3af" }}>Henüz kayıt yok</div>
        )}
      </div>

      {/* Form / Detail Modal */}
      {showForm && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-start", justifyContent:"center", zIndex:500, overflowY:"auto", padding:"20px 16px" }}>
          <div style={{ background:"#fff", borderRadius:"16px", width:"100%", maxWidth:"620px", padding:"28px 24px", position:"relative" }}>
            <button onClick={()=>setShowForm(false)}
              style={{ position:"absolute", top:"16px", right:"16px", background:"#f3f4f6", border:"none", borderRadius:"50%", width:"32px", height:"32px", fontSize:"18px", cursor:"pointer" }}>✕</button>
            <h3 style={{ margin:"0 0 20px", fontSize:"18px", fontWeight:800, color:"#1e3a5f" }}>
              {selected ? `✏️ ${form.ad}` : "🏢 Yeni Konum"}
            </h3>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px", marginBottom:"16px" }}>
              <div>
                <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>Tür</label>
                <select value={form.tur} onChange={e=>setForm(f=>({...f,tur:e.target.value}))}
                  style={{ width:"100%", padding:"9px 12px", border:"1px solid #d1d5db", borderRadius:"8px", fontSize:"14px" }}>
                  {["OFİS","DEPO","OFİS+DEPO"].map(t=><option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>Durum</label>
                <select value={form.durum} onChange={e=>setForm(f=>({...f,durum:e.target.value}))}
                  style={{ width:"100%", padding:"9px 12px", border:"1px solid #d1d5db", borderRadius:"8px", fontSize:"14px" }}>
                  {["AKTİF","PASİF"].map(d=><option key={d}>{d}</option>)}
                </select>
              </div>
              {[
                ["ad","Ad / Tanım *","text","1/-1"],["bolge","Bölge / Şehir","text","auto"],
                ["kiraya_veren","Kiraya Veren","text","auto"],["sozlesme_no","Sözleşme No","text","auto"],
                ["kira_baslangic","Kira Başlangıç","date","auto"],["kira_bitis","Kira Bitiş","date","auto"],
                ["aylik_kira","Aylık Kira (₺)","number","auto"],["metrekare","Alan (m²)","number","auto"],
                ["kat","Kat","text","auto"],["sorumlu","Sorumlu Kişi","text","auto"],
                ["adres","Adres","text","1/-1"],
              ].map(([k,l,t,gc]) => (
                <div key={k} style={{ gridColumn:gc }}>
                  <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>{l}</label>
                  <input type={t} value={form[k]||""} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))}
                    style={{ width:"100%", padding:"9px 12px", border:"1px solid #d1d5db", borderRadius:"8px", fontSize:"14px", boxSizing:"border-box" }} />
                </div>
              ))}
              <div style={{ gridColumn:"1/-1" }}>
                <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"4px" }}>Notlar</label>
                <textarea value={form.notlar||""} onChange={e=>setForm(f=>({...f,notlar:e.target.value}))} rows={2}
                  style={{ width:"100%", padding:"9px 12px", border:"1px solid #d1d5db", borderRadius:"8px", fontSize:"14px", resize:"vertical", boxSizing:"border-box" }} />
              </div>
            </div>
            <button onClick={handleSave}
              style={{ width:"100%", padding:"13px", background:"#1e3a5f", color:"#fff", border:"none", borderRadius:"10px", fontWeight:700, fontSize:"15px", cursor:"pointer", marginBottom: selected ? "24px" : 0 }}>
              💾 Kaydet
            </button>

            {selected && detailOfis && (
              <div style={{ borderTop:"1px solid #e5e7eb", paddingTop:"20px" }}>
                <h4 style={{ margin:"0 0 14px", fontSize:"15px", fontWeight:700, color:"#1e3a5f" }}>📁 Belgeler</h4>
                {/* Kira sözleşmesi */}
                {(() => {
                  const b = getSozlesme(detailOfis);
                  return (
                    <div style={{ background:"#f9fafb", border:"1px solid #e5e7eb", borderRadius:"10px", padding:"12px 14px", display:"flex", alignItems:"center", gap:"12px", marginBottom:"8px" }}>
                      <span style={{ fontWeight:700, fontSize:"13px", color:"#374151", minWidth:"160px" }}>📄 Kira Sözleşmesi</span>
                      {b ? (
                        <>
                          <a href={`${API_BASE}/hr/ofis-belge/file/${b.dosya_yolu}?name=${encodeURIComponent(b.dosya_adi)}`}
                            style={{ fontSize:"12px", color:"#1d4ed8", fontWeight:600, flex:1 }}>📥 {b.dosya_adi}</a>
                          {canEdit && <button onClick={()=>handleBelgeSil(b.id)} style={{ background:"#fee2e2", color:"#dc2626", border:"none", borderRadius:"6px", padding:"4px 10px", fontSize:"12px", cursor:"pointer" }}>Sil</button>}
                        </>
                      ) : <span style={{ fontSize:"12px", color:"#9ca3af", flex:1 }}>— Henüz yüklenmedi</span>}
                      {canEdit && (
                        <label style={{ background:"#dbeafe", color:"#1d4ed8", borderRadius:"6px", padding:"5px 10px", fontSize:"12px", cursor:"pointer", fontWeight:600 }}>
                          {b ? "Güncelle" : "Yükle"}
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display:"none" }}
                            onChange={async e => { if(e.target.files[0]) await handleBelgeUpload(selected.id,"SOZLESME",e.target.files[0]); e.target.value=""; }} />
                        </label>
                      )}
                    </div>
                  );
                })()}
                {/* Ek belgeler */}
                {getEkler(detailOfis).map(b => (
                  <div key={b.id} style={{ background:"#f9fafb", border:"1px solid #e5e7eb", borderRadius:"10px", padding:"12px 14px", display:"flex", alignItems:"center", gap:"12px", marginBottom:"8px" }}>
                    <span style={{ fontSize:"12px", color:"#6b7280", minWidth:"160px" }}>📎 {b.aciklama||b.dosya_adi}</span>
                    <a href={`${API_BASE}/hr/ofis-belge/file/${b.dosya_yolu}?name=${encodeURIComponent(b.dosya_adi)}`}
                      style={{ fontSize:"12px", color:"#1d4ed8", fontWeight:600, flex:1 }}>📥 {b.dosya_adi}</a>
                    {canEdit && <button onClick={()=>handleBelgeSil(b.id)} style={{ background:"#fee2e2", color:"#dc2626", border:"none", borderRadius:"6px", padding:"4px 10px", fontSize:"12px", cursor:"pointer" }}>Sil</button>}
                  </div>
                ))}
                {canEdit && (
                  <label style={{ display:"block", background:"#f0fdf4", border:"1px dashed #86efac", borderRadius:"10px", padding:"12px", textAlign:"center", cursor:"pointer", color:"#166534", fontSize:"13px", fontWeight:600 }}>
                    ➕ Ek Belge Yükle
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display:"none" }}
                      onChange={async e => { if(e.target.files[0]) await handleBelgeUpload(selected.id,"DIGER",e.target.files[0]); e.target.value=""; }} />
                  </label>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
