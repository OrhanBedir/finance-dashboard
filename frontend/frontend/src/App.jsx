import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import "./App.css";
import * as XLSX from "xlsx";
import * as XLSXStyle from "xlsx-js-style";
import JSZip from "jszip";
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

function RolloutDashboard({ currentUser }) {
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

  const handleExportExcel = async () => {
    const XLSX = await import("xlsx");
    const today = new Date().toISOString().split("T")[0];
    const regionLabel = regionFilter === "ALL" ? "Tüm Bölgeler" : regionFilter;

    const fd = (v) => {
      if (!v) return "";
      const d = new Date(v);
      if (isNaN(d)) return String(v);
      return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`;
    };

    // Ortak kimlik alanları
    const base = (r) => ({
      "Bölge":         r.bolge || "",
      "Site Type":     r.site_type || "",
      "Project Code":  r.project_code || "",
      "Site Code":     r.site_code || "",
      "İl":            r.il || "",
    });

    let data, sheetName, fileSuffix;

    if (typeFilter === "POWER") {
      // ⚡ POWER / Enerji kolonları
      fileSuffix = "Power_Enerji";
      sheetName  = "Power";
      data = filteredRows.map(r => ({
        ...base(r),
        "ENH Site Type":            r.enh_site_type || "",
        "ENH Proje Subcon":         r.enh_proje_subcon || "",
        "ENH Proje Hazır Tarihi":   fd(r.enh_proje_hazir),
        "ENH Proje Not":            r.enh_proje_not || "",
        "ENH Subcon":               r.enh_subcon || "",
        "ENH Plan Start Date":      fd(r.enh_plan_start_date),
        "ENH Actual End Date":      fd(r.enh_actual_end_date),
        "ENH Not":                  r.enh_not || "",
        "Power Subcon":             r.power_subcon || "",
        "Power Plan Start Date":    fd(r.power_plan_start_date),
        "Power Actual End Date":    fd(r.power_actual_end_date),
        "Abonelik Actual End Date": fd(r.abonelik_actual_end_date),
        "Horizon Actual End Date":  fd(r.tt_horizon_actual_end_date),
        "PAC Actual End Date":      fd(r.pac_actual_end_date),
      }));

    } else if (typeFilter === "SURVEY_BTK") {
      // 📋 Survey & BTK kolonları
      fileSuffix = "Survey_BTK";
      sheetName  = "Survey&BTK";
      data = filteredRows.map(r => ({
        ...base(r),
        "Malzeme Status":           r.malzeme_status || "",
        "LOS Subcon":               r.los_subcon || "",
        "LOS Plan Date":            fd(r.los_plan_date),
        "LOS Actual End Date":      fd(r.los_actual_end_date),
        "TSS Subcon":               r.tss_subcon || "",
        "TSS Plan Start Date":      fd(r.tss_plan_start_date),
        "TSS Actual End Date":      fd(r.tss_actual_end_date),
        "TSSR Subcon":              r.tssr_subcon || "",
        "TSSR Plan Start Date":     fd(r.tssr_plan_start_date),
        "TSSR Actual End Date":     fd(r.tssr_actual_end_date),
        "BTK Subcon":               r.btk_subcon || "",
        "BTK Plan Start Date":      fd(r.btk_plan_start_date),
        "BTK Actual End Date":      fd(r.btk_actual_end_date),
        "BTK Approval Status":      r.btk_approved || "",
        "GS Status":                r.gs_status || "",
        "Atlas Status":             r.atlas_status || "",
        "Survey Note":              r.survey_note || "",
        "EMR Plan Start Date":      fd(r.emr_plan_start_date),
        "EMR Actual End Date":      fd(r.emr_actual_end_date),
      }));

    } else {
      // Tüm kolonlar (ALL, 5G, DSS, LTE, STANDALONE)
      fileSuffix = typeFilter === "ALL" ? "Tum" : typeFilter;
      sheetName  = "Rollout Data";
      data = filteredRows.map(r => ({
        ...base(r),
        "Site Fiziksel Tip":        r.site_physical_type || "",
        "Malzeme Status":           r.malzeme_status || "",
        "RF Subcon":                r.rf_subcon || "",
        "Plan Start Date":          fd(r.plan_start_date),
        "Installation Start Date":  fd(r.installation_actual_start_date),
        "Installation End Date":    fd(r.installation_actual_end_date),
        "OnAir Date":               fd(r.onair_date),
        "QC Closed Date":           fd(r.qc_closed_date),
        "RF Not":                   r.rf_not || "",
        "LOS Subcon":               r.los_subcon || "",
        "LOS Plan Date":            fd(r.los_plan_date),
        "LOS Actual End Date":      fd(r.los_actual_end_date),
        "TSS Subcon":               r.tss_subcon || "",
        "TSS Plan Start Date":      fd(r.tss_plan_start_date),
        "TSS Actual End Date":      fd(r.tss_actual_end_date),
        "TSSR Subcon":              r.tssr_subcon || "",
        "TSSR Plan Start Date":     fd(r.tssr_plan_start_date),
        "TSSR Actual End Date":     fd(r.tssr_actual_end_date),
        "BTK Subcon":               r.btk_subcon || "",
        "BTK Plan Start Date":      fd(r.btk_plan_start_date),
        "BTK Actual End Date":      fd(r.btk_actual_end_date),
        "BTK Approval Status":      r.btk_approved || "",
        "GS Status":                r.gs_status || "",
        "Atlas Status":             r.atlas_status || "",
        "Survey Note":              r.survey_note || "",
        "EMR Plan Start Date":      fd(r.emr_plan_start_date),
        "EMR Actual End Date":      fd(r.emr_actual_end_date),
        "TRS Subcon":               r.trs_subcon || "",
        "TRS Plan Start Date":      fd(r.trs_plan_start_date),
        "TRS Actual End Date":      fd(r.trs_actual_end_date),
        "TRS Not":                  r.trs_not || "",
        "ENH Site Type":            r.enh_site_type || "",
        "ENH Proje Subcon":         r.enh_proje_subcon || "",
        "ENH Proje Hazır Tarihi":   fd(r.enh_proje_hazir),
        "ENH Proje Not":            r.enh_proje_not || "",
        "ENH Subcon":               r.enh_subcon || "",
        "ENH Plan Start Date":      fd(r.enh_plan_start_date),
        "ENH Actual End Date":      fd(r.enh_actual_end_date),
        "ENH Not":                  r.enh_not || "",
        "Power Subcon":             r.power_subcon || "",
        "Power Plan Start Date":    fd(r.power_plan_start_date),
        "Power Actual End Date":    fd(r.power_actual_end_date),
        "Abonelik Actual End Date": fd(r.abonelik_actual_end_date),
        "Horizon Actual End Date":  fd(r.tt_horizon_actual_end_date),
        "PAC Actual End Date":      fd(r.pac_actual_end_date),
      }));
    }

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    const fileName = `rollout_${regionLabel}_${fileSuffix}_${today}.xlsx`;
    XLSX.writeFile(wb, fileName);
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
    // DB migration + site type fix
    fetch(`${API_BASE}/migrate`).catch(() => {});
    fetch(`${API_BASE}/rollout/fix-site-types`).catch(() => {});
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
        typeFilter === "ALL" ? true :
        typeFilter === "POWER" ? true :        // Power: tüm site tipleri göster, Excel'de kolon filtresi
        typeFilter === "SURVEY_BTK" ? true :   // Survey&BTK: tüm site tipleri, kolon filtresi
        String(row.site_type || "").toUpperCase() === typeFilter;

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
          <option value="POWER">⚡ Power (Enerji)</option>
          <option value="SURVEY_BTK">📋 Survey &amp; BTK</option>
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
              <th colSpan="1">✏️</th>
              <th colSpan="1">📦</th>
              <th colSpan="5">MİLESTONE DURUM</th>

              <th colSpan="7">GENEL</th>

              <th colSpan="7">RF</th>

              <th colSpan="3">LOS</th>

              <th colSpan="3">TSS</th>

              <th colSpan="3">TSSR</th>

              <th colSpan="7">BTK</th>

              <th colSpan="4">EMR</th>

              <th colSpan="4">TRS</th>

              <th colSpan="5">ENH</th>

              <th colSpan="4">POWER</th>

              <th colSpan="4">KABUL</th>
            </tr>
            <tr>
              <th style={{ background:"#0f172a", color:"#fff", fontSize:"11px" }}>Güncelle</th>
              <th style={{ background:"#1e293b", color:"#fff", fontSize:"11px" }}>Belgeler</th>
              <th style={{ background:"#f0fdf4", color:"#166534", fontSize:"10px" }}>RF Rcv</th>
              <th style={{ background:"#f0fdf4", color:"#166534", fontSize:"10px" }}>RF Start</th>
              <th style={{ background:"#f0fdf4", color:"#166534", fontSize:"10px" }}>RF Fin</th>
              <th style={{ background:"#f0fdf4", color:"#166534", fontSize:"10px" }}>QC OK</th>
              <th style={{ background:"#f0fdf4", color:"#166534", fontSize:"10px" }}>Accept</th>

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

              <th>EMR Subcon</th>
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
              <EmptyRow colSpan={50} text="Rollout kaydı bulunamadı" />
            ) : (
              filteredRows.map((row, index) => {
                const ms_rfRcv   = !!(row.installation_actual_start_date || (String(row.malzeme_status||"").toUpperCase()==="OK"));
                const ms_rfStart = !!row.installation_actual_start_date;
                const ms_rfFin   = !!row.installation_actual_end_date;
                const ms_qcOk    = String(row.qc_durum||"").toUpperCase()==="OK";
                const ms_accept  = !!row.pac_actual_end_date;
                const ms = (v) => v ? "✅" : "⏳";
                const msTd = (v) => (
                  <td style={{ textAlign:"center", fontSize:"14px", background: v?"#f0fdf4":"#fafafa" }}>{ms(v)}</td>
                );
                const handleRowIndir = async () => {
                  const belgeler = [
                    { url: row.los_belge_url,       ad: "LOS" },
                    { url: row.tssr_belge_url,       ad: "TSSR" },
                    { url: row.btk_belge_url,        ad: "BTK" },
                    { url: row.emr_belge_url,        ad: "EMR" },
                    { url: row.pac_belge_url,        ad: "PAC" },
                    { url: row.enh_proje_belge_url,  ad: "ENH_Proje" },
                  ].filter(b => b.url);
                  if (!belgeler.length) { alert("Bu sahaya ait belge bulunamadı."); return; }
                  const JSZip = (await import("jszip")).default;
                  const zip = new JSZip();
                  let cnt = 0;
                  for (const { url, ad } of belgeler) {
                    try {
                      const r = await fetch(url); if (!r.ok) continue;
                      const buf = await r.arrayBuffer();
                      const ext = url.split("?")[0].split(".").pop() || "pdf";
                      zip.file(`${row.site_code}_${ad}.${ext}`, buf); cnt++;
                    } catch {}
                  }
                  if (!cnt) { alert("Belgeler indirilemedi."); return; }
                  const blob = await zip.generateAsync({ type:"blob", compression:"DEFLATE", compressionOptions:{ level:6 } });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob); a.download = `${row.site_code}_Belgeler.zip`; a.click(); URL.revokeObjectURL(a.href);
                };
                const hasBelge = !!(row.los_belge_url || row.tssr_belge_url || row.btk_belge_url || row.emr_belge_url || row.pac_belge_url || row.enh_proje_belge_url);
                return (
                <tr key={row.id}>
                  <td style={{ textAlign:"center" }}>
                    <button
                      onClick={() => { setSelectedRolloutSite(row.site_code); setShowRolloutEntryModal(true); }}
                      title="Kaydı güncelle"
                      style={{ background:"#2563eb", color:"#fff", border:"none", borderRadius:"6px", padding:"4px 8px", cursor:"pointer", fontSize:"13px" }}>
                      ✏️
                    </button>
                  </td>
                  <td style={{ textAlign:"center" }}>
                    <button onClick={handleRowIndir} title="Saha belgelerini ZIP indir"
                      style={{ background: hasBelge?"#1e293b":"#e5e7eb", color: hasBelge?"#fff":"#9ca3af", border:"none", borderRadius:"6px", padding:"4px 8px", cursor: hasBelge?"pointer":"default", fontSize:"13px" }}>
                      📦
                    </button>
                  </td>
                  {msTd(ms_rfRcv)}
                  {msTd(ms_rfStart)}
                  {msTd(ms_rfFin)}
                  {msTd(ms_qcOk)}
                  {msTd(ms_accept)}
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

                  <td>{row.emr_subcon}</td>
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
                );
              })
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

    // DSS: _DSS_ veya _GPS_ (GPS Readiness = DSS)
    if (code.includes("_DSS_") || code.includes("_GPS_")) return "DSS";

    // LTE: standart + _W2100_ / _W900_ / _W1900_
    if (
      code.includes("_L800_") || code.includes("_L2600_") || code.includes("_L2100_") ||
      code.includes("_L1800_") || code.includes("_LC1800_") || code.includes("_L900_") ||
      code.includes("_LTE_") || code.includes("_NR700_") || code.includes("_TRP_") ||
      code.includes("_W2100_") || code.includes("_W900_") || code.includes("_W1900_")
    ) return "LTE";

    // 5G: standart + _5GREADINESS_
    if (
      code.includes("_NR3500_") || code.includes("5GEXP") || code.includes("5GREADINESS")
    ) return "5G";

    // STANDALONE
    if (code.includes("_NS_")) return "STANDALONE";

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
    onair_date: "",
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
                <EmptyRow colSpan={16} text="Bu saha için giriş yapılmamış" />
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
  onGoToMalzeme,
  onGoToCashflow,
  currentUser,
}) {
  function parseDateTR(dateStr) {
    const [day, month, year] = dateStr.split(".");
    return new Date(`${year}-${month}-${day}`);
  }
  //Silinecek// Fatura takip

  const [showInvoiceExcelImport, setShowInvoiceExcelImport] = useState(false);

  const handleMaasAvansClick = () => {
    const password = prompt("Bu alana giriş için şifre giriniz:");
    const allowed = ["Orhan2026!", "Duzgun2026!"];
    if (allowed.includes(password)) {
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

  // ── Taşeron Ödeme Motoru ──────────────────────────────────────
  const [showOdemeModal,    setShowOdemeModal]    = useState(false);
  const [odemeModalFirma,   setOdemeModalFirma]   = useState("");
  const [odemeModalTutar,   setOdemeModalTutar]   = useState("");
  const [odemeModalTarih,   setOdemeModalTarih]   = useState(() => new Date().toISOString().slice(0,10));
  const [odemeModalAciklama,setOdemeModalAciklama]= useState("");
  const [odemeModalFirmalar,setOdemeModalFirmalar]= useState([]); // [{firma, toplam_kalan}]
  const [odemeModalCari,    setOdemeModalCari]    = useState(null); // {faturalar, toplamKalan}
  const [odemeModalLog,     setOdemeModalLog]     = useState([]);
  const [odemeModalLoading, setOdemeModalLoading] = useState(false);
  const [odemeModalSonuc,   setOdemeModalSonuc]   = useState(null);
  const [bankaInfo,         setBankaInfo]         = useState(null);  // seçili firma banka bilgisi
  const [showBankaCard,     setShowBankaCard]     = useState(false); // banka kartı açık mı
  const [bankaEditMode,     setBankaEditMode]     = useState(false); // düzenleme modu
  const [bankaForm,         setBankaForm]         = useState({ banka_adi:"", sube:"", hesap_no:"", iban:"", hesap_sahibi:"", aciklama:"" });
  const [ibanCopied,        setIbanCopied]        = useState(false);

  const [manualInvoiceRows, setManualInvoiceRows] = useState([]);
  const [overdueRows, setOverdueRows] = useState([]);
  const [showOverdueModal, setShowOverdueModal] = useState(false);
  const [summary, setSummary] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showInvoiceUpload, setShowInvoiceUpload] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paymentRows, setPaymentRows] = useState([]);
  const [paymentInvoiceFilter, setPaymentInvoiceFilter] = useState("");
  const [paymentDueDateFilter, setPaymentDueDateFilter] = useState("");

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
    odeme_tarihi: "",
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

  // ── Taşeron Ödeme Modal handlers ─────────────────────────────
  const loadOdemeModalFirmalar = async () => {
    try {
      const data = await fetchJson(`${API_BASE}/finance/taseron-firmalar`, { withAuth: true });
      setOdemeModalFirmalar(Array.isArray(data) ? data : []);
    } catch { setOdemeModalFirmalar([]); }
  };

  const loadOdemeModalCari = async (firma) => {
    if (!firma) { setOdemeModalCari(null); setOdemeModalLog([]); return; }
    try {
      const [cari, log] = await Promise.all([
        fetchJson(`${API_BASE}/finance/taseron-cari?firma=${encodeURIComponent(firma)}`, { withAuth: true }),
        fetchJson(`${API_BASE}/finance/taseron-odeme-gecmisi?firma=${encodeURIComponent(firma)}`, { withAuth: true }),
      ]);
      setOdemeModalCari(cari);
      setOdemeModalLog(Array.isArray(log) ? log : []);
    } catch { setOdemeModalCari(null); setOdemeModalLog([]); }
  };

  const handleOpenOdemeModal = async () => {
    setOdemeModalSonuc(null);
    setOdemeModalTutar("");
    setOdemeModalAciklama("");
    setOdemeModalTarih(new Date().toISOString().slice(0,10));
    // Arama kutusunda tekil tedarikçi varsa onu seç
    const q = (manualInvoiceSearch || "").trim().toLowerCase();
    await loadOdemeModalFirmalar();
    setShowOdemeModal(true);
    setShowBankaCard(false);
    setBankaEditMode(false);
    // Kısa gecikme sonrası filter match
    setTimeout(async () => {
      const firms = await fetchJson(`${API_BASE}/finance/taseron-firmalar`, { withAuth: true }).catch(()=>[]);
      const matched = (Array.isArray(firms) ? firms : []).filter(f => f.firma.toLowerCase().includes(q));
      if (q && matched.length === 1) {
        setOdemeModalFirma(matched[0].firma);
        await Promise.all([loadOdemeModalCari(matched[0].firma), loadBankaInfo(matched[0].firma)]);
      } else {
        setOdemeModalFirma("");
        setOdemeModalCari(null);
        setBankaInfo(null);
      }
    }, 100);
  };

  const loadBankaInfo = async (firma) => {
    if (!firma) { setBankaInfo(null); return; }
    try {
      const data = await fetchJson(`${API_BASE}/finance/taseron-banka?firma=${encodeURIComponent(firma)}`, { withAuth: true });
      setBankaInfo(data);
      if (data) setBankaForm({ banka_adi: data.banka_adi||"", sube: data.sube||"", hesap_no: data.hesap_no||"", iban: data.iban||"", hesap_sahibi: data.hesap_sahibi||"", aciklama: data.aciklama||"" });
      else setBankaForm({ banka_adi:"", sube:"", hesap_no:"", iban:"", hesap_sahibi:"", aciklama:"" });
    } catch { setBankaInfo(null); }
  };

  const handleSaveBanka = async () => {
    if (!odemeModalFirma) return;
    try {
      const saved = await fetchJson(`${API_BASE}/finance/taseron-banka`, {
        method:"POST", withAuth:true,
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ firma: odemeModalFirma, ...bankaForm }),
      });
      setBankaInfo(saved);
      setBankaEditMode(false);
    } catch(err) { alert(err.message); }
  };

  const handleOdemeModalFirmaChange = async (firma) => {
    setOdemeModalFirma(firma);
    setOdemeModalSonuc(null);
    setShowBankaCard(false);
    setBankaEditMode(false);
    await Promise.all([loadOdemeModalCari(firma), loadBankaInfo(firma)]);
  };

  const handleTaseronOdemeSubmit = async (e) => {
    e.preventDefault();
    if (!odemeModalFirma || !odemeModalTutar || !odemeModalTarih) return;
    setOdemeModalLoading(true);
    setOdemeModalSonuc(null);
    try {
      const result = await fetchJson(`${API_BASE}/finance/taseron-odeme`, {
        method: "POST", withAuth: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firma: odemeModalFirma,
          tutar: Number(odemeModalTutar),
          tarih: odemeModalTarih,
          aciklama: odemeModalAciklama,
        }),
      });
      setOdemeModalSonuc(result);
      setOdemeModalTutar("");
      setOdemeModalAciklama("");
      await loadOdemeModalCari(odemeModalFirma);
      await loadFinance();
    } catch(err) {
      setOdemeModalSonuc({ error: err.message });
    }
    setOdemeModalLoading(false);
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
      fatura_tarihi: row.fatura_tarihi ? String(row.fatura_tarihi).slice(0, 10) : "",
      odeme_tarihi: row.odeme_tarihi ? String(row.odeme_tarihi).slice(0, 10) : "",
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
        odeme_tarihi: invoiceForm.odeme_tarihi || null,
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
        odeme_tarihi: "",
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

  const filteredPaymentRows = useMemo(() => {
    return sortedPaymentRows.filter(row => {
      const invoiceMatch = !paymentInvoiceFilter ||
        (row.invoice_no || "").toLowerCase().includes(paymentInvoiceFilter.toLowerCase());
      const dueDateMatch = !paymentDueDateFilter ||
        (row.due_date || "").startsWith(paymentDueDateFilter);
      return invoiceMatch && dueDateMatch;
    });
  }, [sortedPaymentRows, paymentInvoiceFilter, paymentDueDateFilter]);

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
                fatura_tarihi: "", odeme_tarihi: "", tedarikci: "", rf_montaj_firma: "",
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

          {["orhan.bedir@simsektel.com","duzgun.simsek@simsektel.com"].includes((currentUser?.email||"").toLowerCase()) && (
            <button
              type="button"
              className="tab smallTab"
              onClick={onGoToCashflow}
            >
              💵 Nakit Akış
            </button>
          )}

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
                <tr key={index} style={row.amount < 0 ? { background:"#fff5f5" } : {}}>
                  <td>{row.day_name || "-"}</td>
                  <td>{formatDateOnly(row.due_date)}</td>
                  <td>
                    <div style={{ fontWeight:700, color: row.amount < 0 ? "#dc2626" : "#1a7f45" }}>
                      {formatMoneyByCurrency(row.amount || 0, row.currency || "TRY")}
                    </div>
                    {row.deduction_amount < 0 && (
                      <div style={{ fontSize:11, color:"#dc2626", marginTop:2 }}>
                        Brüt: {formatMoneyByCurrency(row.gross_amount || 0, row.currency || "TRY")}
                        &nbsp;|&nbsp;İade Kesinti: {formatMoneyByCurrency(row.deduction_amount || 0, row.currency || "TRY")}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:"12px", marginTop:"24px", marginBottom:"10px" }}>
        <h3 className="listTitle" style={{ margin:0 }}>Huawei Payment Kayıtları</h3>
        <div style={{ display:"flex", gap:"8px", alignItems:"center", flexWrap:"wrap" }}>
          <input
            type="text"
            placeholder="🔍 Invoice No ara..."
            value={paymentInvoiceFilter}
            onChange={e => setPaymentInvoiceFilter(e.target.value)}
            style={{ padding:"7px 10px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"13px", minWidth:"170px" }}
          />
          <input
            type="date"
            value={paymentDueDateFilter}
            onChange={e => setPaymentDueDateFilter(e.target.value)}
            style={{ padding:"7px 10px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"13px" }}
          />
          {(paymentInvoiceFilter || paymentDueDateFilter) && (
            <button
              onClick={() => { setPaymentInvoiceFilter(""); setPaymentDueDateFilter(""); }}
              style={{ padding:"7px 12px", border:"none", borderRadius:"8px", background:"#f3f4f6", fontSize:"13px", cursor:"pointer", color:"#6b7280" }}
            >✕ Temizle</button>
          )}
        </div>
      </div>

      {(paymentInvoiceFilter || paymentDueDateFilter) && (
        <div style={{ display:"flex", gap:"16px", marginBottom:"10px", padding:"10px 16px", background:"#f0f9ff", border:"1.5px solid #bae6fd", borderRadius:"10px", fontSize:"13px", flexWrap:"wrap" }}>
          <span>📋 <b>{filteredPaymentRows.length}</b> kayıt</span>
          <span>🧾 Invoice Toplam: <b>{formatMoneyByCurrency(filteredPaymentRows.reduce((s,r) => s + Number(r.invoice_amount||0), 0), filteredPaymentRows[0]?.currency)}</b></span>
          <span>✅ Ödenen: <b>{formatMoneyByCurrency(filteredPaymentRows.reduce((s,r) => s + Number(r.payment_amount||0), 0), filteredPaymentRows[0]?.currency)}</b></span>
          <span>⏳ Kalan: <b style={{ color: filteredPaymentRows.reduce((s,r) => s + Number(r.remaining_amount||0), 0) > 0 ? "#dc2626" : "#16a34a" }}>
            {formatMoneyByCurrency(filteredPaymentRows.reduce((s,r) => s + Number(r.remaining_amount||0), 0), filteredPaymentRows[0]?.currency)}
          </b></span>
        </div>
      )}

      <div
        className="tableWrap"
        style={{
          maxHeight: "50vh",
          overflowY: "auto",
          overflowX: "auto",
          marginTop: "4px",
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
            {filteredPaymentRows.length === 0 ? (
              <EmptyRow colSpan={6} text="Kayıt bulunamadı" />
            ) : (
              filteredPaymentRows.map((row, index) => {
                const isIade = String(row.invoice_no || "").startsWith("H01");
                return (
                <tr key={row.id ?? index} style={isIade ? { background:"#fff5f5" } : {}}>
                  <td style={isIade ? { color:"#dc2626", fontWeight:600 } : {}}>
                    {row.invoice_no || "-"}
                    {isIade && <span style={{ marginLeft:6, fontSize:11, background:"#fee2e2", color:"#dc2626", borderRadius:4, padding:"1px 5px" }}>İADE</span>}
                  </td>
                  <td style={isIade ? { color:"#dc2626" } : {}}>
                    {formatMoneyByCurrency(row.invoice_amount || 0, row.currency)}
                  </td>
                  <td style={isIade ? { color:"#dc2626" } : {}}>
                    {formatMoneyByCurrency(row.payment_amount || 0, row.currency)}
                  </td>
                  <td style={isIade ? { color:"#dc2626" } : {}}>
                    {formatMoneyByCurrency(row.remaining_amount || 0, row.currency)}
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
                );
              })
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
                    odeme_tarihi: "",
                    tedarikci: "",
                    rf_montaj_firma: "",
                    fatura_kalemi: "",
                    is_kalemi: "",
                    po_no: "",
                    site_id: "",
                    tutar: "",
                    kdv: "",
                    toplam_tutar: "",
                    odened_tutar: "",
                    kalan_borc: "",
                    note: "",
                  });
                  setShowInvoiceFormPanel(true);
                }}
              >
                Yeni Fatura Gir
              </button>
              <button
                type="button"
                onClick={handleOpenOdemeModal}
                style={{ padding:"9px 18px", background:"#7e22ce", color:"#fff", border:"none", borderRadius:"8px", fontSize:"14px", fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:"6px", whiteSpace:"nowrap" }}
              >
                💳 Ödeme Gir
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
                        <div>
                          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#7e22ce", marginBottom: "6px" }}>💸 Ödeme Tarihi</label>
                          <input type="date" name="odeme_tarihi" value={invoiceForm.odeme_tarihi} onChange={handleInvoiceFormChange}
                            style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #d8b4fe", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", background:"#fdf4ff" }} />
                          <div style={{ fontSize:"10px", color:"#9ca3af", marginTop:"3px" }}>Nakit Akış'ta taşeron satırı olarak görünür</div>
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

      {/* ── Taşeron Ödeme Motoru Modal ─────────────────────────── */}
      {showOdemeModal && (
        <div onClick={() => setShowOdemeModal(false)}
          style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:10000, display:"flex", alignItems:"center", justifyContent:"center", padding:"20px" }}>
          <div onClick={e=>e.stopPropagation()}
            style={{ background:"#fff", width:"100%", maxWidth:"1000px", maxHeight:"90vh", borderRadius:"20px", overflow:"hidden", display:"flex", flexDirection:"column", boxShadow:"0 20px 60px rgba(0,0,0,0.25)" }}>

            {/* Header */}
            <div style={{ background:"#7e22ce", color:"#fff", padding:"18px 24px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
              <div>
                <div style={{ fontWeight:800, fontSize:"18px" }}>💳 Taşeron Ödeme Girişi</div>
                <div style={{ fontSize:"12px", opacity:0.8, marginTop:"2px" }}>FIFO — en eski fatura önce kapatılır</div>
              </div>
              <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      const token = localStorage.getItem("finance_token") || localStorage.getItem("token") || "";
                      const url = `${API_BASE}/finance/taseron-odeme-excel${odemeModalFirma ? `?firma=${encodeURIComponent(odemeModalFirma)}` : ""}`;
                      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                      if (!res.ok) throw new Error("İndirme başarısız");
                      const blob = await res.blob();
                      const blobUrl = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = blobUrl;
                      const safeFirma = odemeModalFirma ? `_${odemeModalFirma.replace(/[^a-zA-Z0-9]/g,"_")}` : "_tum";
                      a.download = `taseron_odemeler${safeFirma}_${new Date().toISOString().slice(0,10)}.xlsx`;
                      a.click();
                      URL.revokeObjectURL(blobUrl);
                    } catch(err) { alert(err.message); }
                  }}
                  style={{ background:"rgba(255,255,255,0.2)", border:"1px solid rgba(255,255,255,0.4)", borderRadius:"8px", color:"#fff", padding:"6px 12px", fontWeight:700, fontSize:"13px", cursor:"pointer", display:"flex", alignItems:"center", gap:"5px" }}
                >
                  📥 Excel
                </button>
                <button onClick={() => setShowOdemeModal(false)} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:"8px", color:"#fff", padding:"6px 14px", cursor:"pointer", fontWeight:700 }}>✕ Kapat</button>
              </div>
            </div>

            <div style={{ display:"flex", flex:1, minHeight:0, overflow:"hidden" }}>
              {/* SOL — Firma seç + Cari */}
              <div style={{ width:"340px", flexShrink:0, borderRight:"1px solid #e5e7eb", padding:"20px", overflowY:"auto", background:"#fdf4ff" }}>
                <div style={{ marginBottom:"16px" }}>
                  <label style={{ display:"block", fontSize:"12px", fontWeight:700, color:"#6b21a8", marginBottom:"6px" }}>Taşeron Firmayı Seç</label>
                  <select value={odemeModalFirma} onChange={e=>handleOdemeModalFirmaChange(e.target.value)}
                    style={{ width:"100%", padding:"10px 12px", border:"1.5px solid #d8b4fe", borderRadius:"10px", fontSize:"14px", background:"#fff" }}>
                    <option value="">-- Firma Seçin --</option>
                    {odemeModalFirmalar.map(f => (
                      <option key={f.firma} value={f.firma}>{f.firma} — ₺{Number(f.toplam_kalan).toLocaleString("tr-TR",{maximumFractionDigits:0})} kalan</option>
                    ))}
                  </select>
                </div>

                {odemeModalCari && (
                  <>
                    <div style={{ background:"#7e22ce", color:"#fff", borderRadius:"12px", padding:"14px 16px", marginBottom:"10px" }}>
                      <div style={{ fontSize:"11px", opacity:0.8, marginBottom:"4px" }}>Toplam Açık Cari</div>
                      <div style={{ fontWeight:800, fontSize:"22px" }}>₺{Number(odemeModalCari.toplamKalan).toLocaleString("tr-TR",{maximumFractionDigits:0})}</div>
                    </div>

                    {/* Banka Bilgileri Butonu */}
                    <button
                      type="button"
                      onClick={() => { setShowBankaCard(v=>!v); setBankaEditMode(false); }}
                      style={{ width:"100%", marginBottom:"10px", padding:"9px 14px", background: showBankaCard ? "#1e3a5f" : "#fff", color: showBankaCard ? "#fff" : "#1e3a5f", border:"1.5px solid #1e3a5f", borderRadius:"10px", fontSize:"13px", fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"8px" }}
                    >
                      <span>🏦 Banka Bilgileri</span>
                      <span style={{ fontSize:"11px", opacity:0.7 }}>{showBankaCard ? "▲ Kapat" : "▼ Göster"}</span>
                    </button>

                    {/* Banka Kartı */}
                    {showBankaCard && (
                      <div style={{ background:"#fff", border:"1.5px solid #bfdbfe", borderRadius:"12px", padding:"14px", marginBottom:"12px", boxShadow:"0 2px 8px rgba(30,58,95,0.08)" }}>
                        {!bankaEditMode ? (
                          bankaInfo ? (
                            <>
                              {/* Kart görünümü */}
                              <div style={{ background:"linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%)", borderRadius:"10px", padding:"14px 16px", color:"#fff", marginBottom:"10px", position:"relative" }}>
                                <div style={{ fontSize:"10px", opacity:0.7, marginBottom:"2px", letterSpacing:"0.05em", textTransform:"uppercase" }}>Hesap Sahibi</div>
                                <div style={{ fontWeight:800, fontSize:"14px", marginBottom:"8px" }}>{bankaInfo.hesap_sahibi || odemeModalFirma}</div>
                                <div style={{ fontSize:"10px", opacity:0.7, marginBottom:"2px", letterSpacing:"0.05em", textTransform:"uppercase" }}>IBAN</div>
                                <div style={{ fontWeight:700, fontSize:"13px", letterSpacing:"0.08em", fontFamily:"monospace", marginBottom:"8px", display:"flex", alignItems:"center", gap:"8px" }}>
                                  {bankaInfo.iban || "—"}
                                  {bankaInfo.iban && (
                                    <button
                                      onClick={() => { navigator.clipboard.writeText(bankaInfo.iban); setIbanCopied(true); setTimeout(()=>setIbanCopied(false),2000); }}
                                      style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:"5px", color:"#fff", padding:"2px 7px", fontSize:"10px", cursor:"pointer", fontWeight:700 }}
                                    >{ibanCopied ? "✓" : "Kopyala"}</button>
                                  )}
                                </div>
                                <div style={{ display:"flex", gap:"20px" }}>
                                  <div>
                                    <div style={{ fontSize:"9px", opacity:0.6, textTransform:"uppercase" }}>Banka</div>
                                    <div style={{ fontSize:"12px", fontWeight:600 }}>{bankaInfo.banka_adi || "—"}</div>
                                  </div>
                                  {bankaInfo.sube && <div>
                                    <div style={{ fontSize:"9px", opacity:0.6, textTransform:"uppercase" }}>Şube</div>
                                    <div style={{ fontSize:"12px", fontWeight:600 }}>{bankaInfo.sube}</div>
                                  </div>}
                                  {bankaInfo.hesap_no && <div>
                                    <div style={{ fontSize:"9px", opacity:0.6, textTransform:"uppercase" }}>Hesap No</div>
                                    <div style={{ fontSize:"12px", fontWeight:600 }}>{bankaInfo.hesap_no}</div>
                                  </div>}
                                </div>
                              </div>
                              {bankaInfo.aciklama && <div style={{ fontSize:"11px", color:"#6b7280", marginBottom:"8px", fontStyle:"italic" }}>{bankaInfo.aciklama}</div>}
                              <button onClick={()=>setBankaEditMode(true)} style={{ width:"100%", padding:"7px", background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:"8px", color:"#1d4ed8", fontSize:"12px", fontWeight:700, cursor:"pointer" }}>✏️ Düzenle</button>
                            </>
                          ) : (
                            <div style={{ textAlign:"center", padding:"10px 0" }}>
                              <div style={{ fontSize:"13px", color:"#6b7280", marginBottom:"10px" }}>Henüz banka bilgisi eklenmemiş</div>
                              <button onClick={()=>setBankaEditMode(true)} style={{ padding:"8px 16px", background:"#1e3a5f", color:"#fff", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:700, cursor:"pointer" }}>+ Banka Bilgisi Ekle</button>
                            </div>
                          )
                        ) : (
                          /* Düzenleme formu */
                          <div>
                            <div style={{ fontWeight:700, fontSize:"13px", color:"#1e3a5f", marginBottom:"10px" }}>🏦 Banka Bilgilerini Düzenle</div>
                            {[
                              { label:"Hesap Sahibi", key:"hesap_sahibi", placeholder:"Firma adı veya kişi" },
                              { label:"Banka Adı", key:"banka_adi", placeholder:"Ziraat, Garanti, YKB..." },
                              { label:"Şube", key:"sube", placeholder:"Şube adı (opsiyonel)" },
                              { label:"Hesap No", key:"hesap_no", placeholder:"Hesap numarası (opsiyonel)" },
                              { label:"IBAN", key:"iban", placeholder:"TR00 0000 0000 0000..." },
                              { label:"Açıklama", key:"aciklama", placeholder:"Not..." },
                            ].map(f => (
                              <div key={f.key} style={{ marginBottom:"8px" }}>
                                <label style={{ display:"block", fontSize:"11px", fontWeight:600, color:"#374151", marginBottom:"3px" }}>{f.label}</label>
                                <input value={bankaForm[f.key]} onChange={e=>setBankaForm(p=>({...p,[f.key]:e.target.value}))} placeholder={f.placeholder}
                                  style={{ width:"100%", padding:"7px 10px", border:"1.5px solid #e5e7eb", borderRadius:"7px", fontSize:"12px", boxSizing:"border-box" }} />
                              </div>
                            ))}
                            <div style={{ display:"flex", gap:"8px", marginTop:"10px" }}>
                              <button onClick={handleSaveBanka} style={{ flex:1, padding:"8px", background:"#1e3a5f", color:"#fff", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:700, cursor:"pointer" }}>✅ Kaydet</button>
                              <button onClick={()=>setBankaEditMode(false)} style={{ padding:"8px 12px", background:"#f3f4f6", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:700, cursor:"pointer" }}>İptal</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}


                    <div style={{ fontSize:"12px", fontWeight:700, color:"#6b21a8", marginBottom:"8px" }}>Açık Faturalar (FIFO sırası)</div>
                    {odemeModalCari.faturalar.map((f,i) => (
                      <div key={f.id} style={{ background:"#fff", border:"1px solid #e9d5ff", borderRadius:"10px", padding:"10px 12px", marginBottom:"6px" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"3px" }}>
                          <span style={{ fontWeight:700, fontSize:"12px", color:"#374151" }}>{i+1}. {f.fatura_no || "—"}</span>
                          <span style={{ fontSize:"10px", color:"#9ca3af" }}>{f.fatura_tarihi ? String(f.fatura_tarihi).slice(0,10) : "—"}</span>
                        </div>
                        <div style={{ display:"flex", gap:"8px", fontSize:"11px" }}>
                          <span style={{ color:"#6b7280" }}>Toplam: <b>₺{Number(f.toplam_tutar).toLocaleString("tr-TR",{maximumFractionDigits:0})}</b></span>
                          <span style={{ color:"#16a34a" }}>Ödenen: <b>₺{Number(f.odenen_tutar).toLocaleString("tr-TR",{maximumFractionDigits:0})}</b></span>
                        </div>
                        <div style={{ marginTop:"4px", display:"flex", alignItems:"center", gap:"6px" }}>
                          <div style={{ flex:1, height:"5px", background:"#f3e8ff", borderRadius:"99px", overflow:"hidden" }}>
                            <div style={{ height:"100%", background:"#7e22ce", borderRadius:"99px", width:`${f.toplam_tutar>0?Math.min(100,Math.round((Number(f.odenen_tutar)/Number(f.toplam_tutar))*100)):0}%` }} />
                          </div>
                          <span style={{ fontSize:"10px", color:"#dc2626", fontWeight:700 }}>Kalan: ₺{Number(f.kalan_borc).toLocaleString("tr-TR",{maximumFractionDigits:0})}</span>
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {!odemeModalCari && odemeModalFirma && (
                  <div style={{ textAlign:"center", padding:"20px", color:"#9ca3af" }}>Açık fatura bulunamadı</div>
                )}
              </div>

              {/* SAĞ — Ödeme formu + geçmiş */}
              <div style={{ flex:1, padding:"20px", overflowY:"auto", display:"flex", flexDirection:"column", gap:"16px" }}>
                {/* Ödeme Formu */}
                <div style={{ background:"#fff", border:"1.5px solid #e9d5ff", borderRadius:"14px", padding:"20px" }}>
                  <div style={{ fontWeight:800, fontSize:"15px", color:"#6b21a8", marginBottom:"16px" }}>💳 Ödeme Kaydı</div>
                  <form onSubmit={handleTaseronOdemeSubmit}>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px", marginBottom:"12px" }}>
                      <div>
                        <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"5px" }}>Ödeme Tutarı (₺) *</label>
                        <div style={{ position:"relative" }}>
                          <span style={{ position:"absolute", left:"12px", top:"50%", transform:"translateY(-50%)", fontWeight:800, fontSize:"16px", color:"#7e22ce", pointerEvents:"none" }}>₺</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={odemeModalTutar ? Number(String(odemeModalTutar).replace(/\./g,"")).toLocaleString("tr-TR") : ""}
                            onChange={e => {
                              const raw = e.target.value.replace(/\./g,"").replace(/[^0-9]/g,"");
                              setOdemeModalTutar(raw);
                            }}
                            placeholder={odemeModalCari ? Number(odemeModalCari.toplamKalan).toLocaleString("tr-TR",{maximumFractionDigits:0}) : "0"}
                            required
                            style={{ width:"100%", padding:"12px 12px 12px 28px", border:"1.5px solid #d8b4fe", borderRadius:"10px", fontSize:"18px", fontWeight:800, boxSizing:"border-box", background:"#fdf4ff", color:"#7e22ce", letterSpacing:"0.5px" }}
                          />
                        </div>
                        {odemeModalCari && odemeModalTutar && Number(odemeModalTutar) > Number(odemeModalCari.toplamKalan) && (
                          <div style={{ fontSize:"11px", color:"#dc2626", marginTop:"3px" }}>⚠️ Girilen tutar toplam borcu aşıyor</div>
                        )}
                      </div>
                      <div>
                        <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"5px" }}>Ödeme Tarihi *</label>
                        <input type="date" value={odemeModalTarih} onChange={e=>setOdemeModalTarih(e.target.value)}
                          required style={{ width:"100%", padding:"10px 12px", border:"1.5px solid #e5e7eb", borderRadius:"10px", fontSize:"14px", boxSizing:"border-box" }} />
                      </div>
                    </div>
                    <div style={{ marginBottom:"12px" }}>
                      <label style={{ display:"block", fontSize:"12px", fontWeight:600, color:"#374151", marginBottom:"5px" }}>Açıklama (opsiyonel)</label>
                      <input type="text" value={odemeModalAciklama} onChange={e=>setOdemeModalAciklama(e.target.value)}
                        placeholder="Banka transferi, EFT vb."
                        style={{ width:"100%", padding:"10px 12px", border:"1.5px solid #e5e7eb", borderRadius:"10px", fontSize:"14px", boxSizing:"border-box" }} />
                    </div>
                    <button type="submit" disabled={!odemeModalFirma || !odemeModalTutar || odemeModalLoading}
                      style={{ width:"100%", padding:"12px", background: odemeModalFirma && odemeModalTutar ? "#7e22ce" : "#d1d5db", color:"#fff", border:"none", borderRadius:"10px", fontSize:"15px", fontWeight:800, cursor: odemeModalFirma && odemeModalTutar ? "pointer" : "not-allowed" }}>
                      {odemeModalLoading ? "⏳ Kaydediliyor..." : "✅ Ödemeyi Kaydet"}
                    </button>
                  </form>

                  {/* Sonuç */}
                  {odemeModalSonuc && !odemeModalSonuc.error && (
                    <div style={{ marginTop:"14px", background:"#f0fdf4", border:"1.5px solid #86efac", borderRadius:"10px", padding:"12px 16px" }}>
                      <div style={{ fontWeight:800, color:"#166534", marginBottom:"8px" }}>✅ Ödeme kaydedildi!</div>
                      {odemeModalSonuc.dagilim?.map((d,i) => (
                        <div key={i} style={{ fontSize:"12px", color:"#374151", padding:"4px 0", borderBottom:"1px solid #dcfce7" }}>
                          <b>{d.fatura_no}</b> → <span style={{ color:"#7e22ce" }}>₺{Number(d.odeme).toLocaleString("tr-TR",{maximumFractionDigits:0})} ödendi</span>
                          <span style={{ color:d.kalan_sonra>0?"#dc2626":"#16a34a", marginLeft:"8px" }}>
                            {d.kalan_sonra > 0 ? `(Kalan: ₺${Number(d.kalan_sonra).toLocaleString("tr-TR",{maximumFractionDigits:0})})` : "(✓ Kapatıldı)"}
                          </span>
                        </div>
                      ))}
                      {odemeModalSonuc.fazla > 0 && (
                        <div style={{ fontSize:"11px", color:"#dc2626", marginTop:"6px" }}>⚠️ ₺{Number(odemeModalSonuc.fazla).toLocaleString("tr-TR",{maximumFractionDigits:0})} fazla ödeme — fatura yok</div>
                      )}
                    </div>
                  )}
                  {odemeModalSonuc?.error && (
                    <div style={{ marginTop:"10px", background:"#fef2f2", border:"1.5px solid #fca5a5", borderRadius:"10px", padding:"10px 14px", color:"#dc2626", fontSize:"13px" }}>
                      ❌ {odemeModalSonuc.error}
                    </div>
                  )}
                </div>

                {/* Ödeme Geçmişi */}
                {odemeModalLog.length > 0 && (
                  <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:"14px", padding:"16px 20px" }}>
                    <div style={{ fontWeight:800, fontSize:"14px", color:"#374151", marginBottom:"12px" }}>📋 Ödeme Geçmişi</div>
                    <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
                      {odemeModalLog.map(log => (
                        <div key={log.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"10px 12px", background:"#f9fafb", borderRadius:"8px", border:"1px solid #f3f4f6" }}>
                          <div>
                            <div style={{ fontWeight:700, fontSize:"13px", color:"#1e3a5f" }}>
                              ₺{Number(log.tutar).toLocaleString("tr-TR",{maximumFractionDigits:0})}
                            </div>
                            {log.aciklama && <div style={{ fontSize:"11px", color:"#6b7280" }}>{log.aciklama}</div>}
                            {log.dagilim && Array.isArray(log.dagilim) && (
                              <div style={{ fontSize:"10px", color:"#9ca3af", marginTop:"3px" }}>
                                {log.dagilim.map((d,i)=><span key={i} style={{ marginRight:"6px" }}>{d.fatura_no}: ₺{Number(d.odeme).toLocaleString("tr-TR",{maximumFractionDigits:0})}</span>)}
                              </div>
                            )}
                          </div>
                          <div style={{ textAlign:"right", flexShrink:0, marginLeft:"10px" }}>
                            <div style={{ fontSize:"12px", fontWeight:600, color:"#374151" }}>{log.tarih ? String(log.tarih).slice(0,10) : "—"}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {odemeModalFirma && odemeModalLog.length === 0 && (
                  <div style={{ textAlign:"center", padding:"20px", color:"#9ca3af", fontSize:"13px" }}>Henüz ödeme kaydı yok</div>
                )}
              </div>
            </div>
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
  const isNurcan = currentUser?.email === "nurcan.kus@simsektel.com";
  const canEditAny = isPM || isDirektor || isNurcan;
  const todayStr = new Date().toISOString().split("T")[0];

  const [yilStr, ayStr] = puantajAy.split("-");
  const ayGunleri = Array.from({ length: new Date(Number(yilStr), Number(ayStr), 0).getDate() }, (_, i) => i+1);

  const TR_RESMI_TATIL = [
    "2024-01-01","2024-04-10","2024-04-11","2024-04-12","2024-04-23","2024-05-01","2024-05-19","2024-06-15","2024-06-16","2024-06-17","2024-06-18","2024-07-15","2024-08-30","2024-10-29",
    "2025-01-01","2025-03-30","2025-03-31","2025-04-01","2025-04-23","2025-05-01","2025-05-19","2025-06-06","2025-06-07","2025-06-08","2025-06-09","2025-07-15","2025-08-30","2025-10-29",
    "2026-01-01","2026-03-31","2026-04-01","2026-04-02","2026-04-23","2026-05-01","2026-05-19","2026-06-06","2026-06-07","2026-06-08","2026-06-09","2026-07-15","2026-08-30","2026-10-29",
    "2027-01-01","2027-03-20","2027-03-21","2027-03-22","2027-04-23","2027-05-01","2027-05-19","2027-05-27","2027-05-28","2027-05-29","2027-05-30","2027-07-15","2027-08-30","2027-10-29",
  ];

  const DURUMLAR = [
    { key:"CALISDI",    label:"✅", name:"ÇALIŞTI" },
    { key:"GELMEDI",    label:"❌", name:"GELMEDİ" },
    { key:"IZIN",       label:"🏖", name:"İZİN" },
    { key:"RAPOR",      label:"☪️", name:"RAPOR" },
    { key:"TATIL",      label:"⭕", name:"HAFTA TATİLİ" },
    { key:"DINLENME",   label:"💤", name:"DİNLENME" },
    { key:"RESMI_TATIL",label:"🎌", name:"RESMİ TATİL" },
  ];
  // TATIL kasıtlı olarak yok — transparent döndürmesi yerine defaultCellBg'ye düşsün (resmi tatil/pazar rengi görünsün)
  const DURUM_COLOR = { CALISDI:"#dcfce7", IZIN:"#dbeafe", RAPOR:"#fef3c7", GELMEDI:"#fee2e2", DINLENME:"#f3e8ff", RESMI_TATIL:"#dbeafe" };

  const [puantajOzet, setPuantajOzet] = useState([]);

  const loadPersonel = async () => {
    const r = await fetch(`${API_BASE}/hr/personel`);
    setPersonelList((await r.json()).filter(p => p.aktif));
  };
  const loadPuantaj = async () => {
    const [yil, ay] = puantajAy.split("-");
    const r = await fetch(`${API_BASE}/hr/puantaj?ay=${ay}&yil=${yil}`);
    setPuantajData(await r.json());
  };
  const loadPuantajOzet = async () => {
    const [yil, ay] = puantajAy.split("-");
    const r = await fetch(`${API_BASE}/hr/puantaj/ozet?ay=${ay}&yil=${yil}`);
    setPuantajOzet(await r.json());
  };

  useEffect(() => { loadPersonel(); }, []);
  useEffect(() => { loadPuantaj(); loadPuantajOzet(); }, [puantajAy]);

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

        <span style={{ fontSize:"12px", color:"#9ca3af" }}>Tıkla: ✅→❌→🏖→☪️→⭕→💤→🎌</span>

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
        const gelmedi = sc["GELMEDI"]||0;
        const pazarCalisdi = ayGunleri.filter(g => {
          const row = getPuantaj(sp.id, g);
          return row?.durum === "CALISDI" && new Date(Number(yilStr), Number(ayStr)-1, g).getDay() === 0;
        }).length;
        const dailyRate = (sp.net_maas||0) / 26;
        const hak = Math.round((sp.net_maas||0) - gelmedi * dailyRate + pazarCalisdi * dailyRate * 1.5);
        const pazarBonus = Math.round(pazarCalisdi * dailyRate * 1.5);
        const ozetRow = puantajOzet.find(o => o.personel_id === sp.id);
        const dinlenmeBakiye = ozetRow?.dinlenme_bakiye ?? pazarCalisdi;
        const tooltipText = [
          `Çalışılan gün: ${cal}`,
          `Gelmedi: ${gelmedi} gün (kesinti: ₺${Math.round(gelmedi*dailyRate).toLocaleString("tr-TR")})`,
          `Pazar çalışılan: ${pazarCalisdi} gün`,
          `Pazar primli: +₺${pazarBonus.toLocaleString("tr-TR")} (1.5x günlük)`,
          `Toplam hakediş: ₺${hak.toLocaleString("tr-TR")}`,
        ].join("\n");
        return (
          <div style={{ background:"#fff", borderRadius:"16px", padding:"18px 22px", boxShadow:"0 2px 8px rgba(0,0,0,0.08)", marginBottom:"16px", display:"flex", gap:"20px", alignItems:"center", flexWrap:"wrap" }}>
            <div style={{ minWidth:"110px" }}>
              <div style={{ fontWeight:700, fontSize:"15px" }}>{sp.ad_soyad}</div>
              <div style={{ fontSize:"12px", color:"#9ca3af", marginTop:"2px" }}>{sp.unvan}</div>
            </div>
            <div style={{ display:"flex", gap:"10px", flex:1, flexWrap:"wrap" }}>
              {[
                { label:"Çalışılan", emoji:"✅", val:cal, bg:"#dcfce7", tc:"#166534" },
                { label:"Gelmedi",   emoji:"❌", val:gelmedi, bg:"#fee2e2", tc:"#991b1b" },
                { label:"İzin",      emoji:"🏖", val:sc["IZIN"]||0,    bg:"#dbeafe", tc:"#1d4ed8" },
                { label:"Rapor",     emoji:"☪️", val:sc["RAPOR"]||0,   bg:"#fef3c7", tc:"#92400e" },
                { label:"Tatil",     emoji:"⭕", val:sc["TATIL"]||0,   bg:"#f1f5f9", tc:"#64748b" },
                { label:"Dinlenme",  emoji:"💤", val:sc["DINLENME"]||0, bg:"#f3e8ff", tc:"#7c3aed" },
              ].map(s=>(
                <div key={s.label} style={{ background:s.bg, borderRadius:"12px", padding:"10px 14px", textAlign:"center", minWidth:"70px" }}>
                  <div style={{ fontSize:"22px", fontWeight:800, color:s.tc }}>{s.val}</div>
                  <div style={{ fontSize:"10px", fontWeight:600, color:s.tc, marginTop:"2px" }}>{s.emoji} {s.label}</div>
                </div>
              ))}
              {dinlenmeBakiye > 0 && (
                <div style={{ background:"#fdf4ff", border:"2px solid #d8b4fe", borderRadius:"12px", padding:"10px 14px", textAlign:"center", minWidth:"70px" }}>
                  <div style={{ fontSize:"22px", fontWeight:800, color:"#7c3aed" }}>{dinlenmeBakiye}</div>
                  <div style={{ fontSize:"10px", fontWeight:600, color:"#7c3aed", marginTop:"2px" }}>💤 Bakiye</div>
                </div>
              )}
            </div>
            <div title={tooltipText} style={{ background:"linear-gradient(135deg,#15803d,#166534)", borderRadius:"14px", padding:"16px 22px", textAlign:"center", color:"#fff", minWidth:"140px", cursor:"help" }}>
              <div style={{ fontSize:"11px", fontWeight:600, opacity:0.8, marginBottom:"4px" }}>Bu Ay Hakediş ℹ️</div>
              <div style={{ fontSize:"26px", fontWeight:800, letterSpacing:"-0.5px" }}>₺{hak.toLocaleString("tr-TR")}</div>
              <div style={{ fontSize:"11px", opacity:0.7, marginTop:"4px" }}>{cal} gün · {pazarCalisdi > 0 ? `${pazarCalisdi} pazar` : "ref: 26 gün"}</div>
            </div>
          </div>
        );
      })()}

      {/* Legend */}
      <div style={{ display:"flex", gap:"10px", marginBottom:"14px", flexWrap:"wrap", alignItems:"center" }}>
        {DURUMLAR.map(d=><span key={d.key} style={{ fontSize:"13px" }}>{d.label} {d.name||d.key}</span>)}
        <span style={{ fontSize:"13px", color:"#7c3aed" }}>🟣 Pazar</span>
      </div>

      <div style={{ overflowX:"auto", borderRadius:"14px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
        <table style={{ borderCollapse:"collapse", width:"100%", background:"#fff", borderRadius:"14px", overflow:"hidden" }}>
          <thead>
            <tr style={{ background:"#f8fafc" }}>
              <th style={{ padding:"10px 14px", textAlign:"left", fontSize:"13px", fontWeight:700, position:"sticky", left:0, background:"#f8fafc", zIndex:2, minWidth:"150px", borderRight:"2px solid #e5e7eb" }}>Personel</th>
              {ayGunleri.map(g => {
                const d = new Date(Number(yilStr), Number(ayStr)-1, g).getDay();
                const thDate = `${puantajAy}-${String(g).padStart(2,"0")}`;
                const isResmiTatil = TR_RESMI_TATIL.includes(thDate);
                const thColor = isResmiTatil ? "#1d4ed8" : d===0 ? "#7c3aed" : "#374151";
                return (
                  <th key={g} style={{ padding:"4px 2px", fontSize:"11px", fontWeight:700, textAlign:"center", minWidth:"36px", width:"36px", color: thColor }}>
                    <div>{g}</div>
                    {d===0 && <div style={{ fontSize:"9px", fontWeight:500, lineHeight:1 }}>Paz</div>}
                    {d===6 && <div style={{ fontSize:"9px", fontWeight:500, lineHeight:1 }}>Cmt</div>}
                    {isResmiTatil && d!==0 && <div style={{ fontSize:"8px", lineHeight:1 }}>🎌</div>}
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
                    const dayOfWeek = new Date(Number(yilStr), Number(ayStr)-1, g).getDay();
                    const isResmiTatilCell = TR_RESMI_TATIL.includes(tarih);
                    const defaultCellBg = dayOfWeek===0 ? "#ede9fe" : isResmiTatilCell ? "#dbeafe" : dayOfWeek===6 ? "#f8fafc" : "transparent";
                    const cellBg = DURUM_COLOR[durum] || defaultCellBg;
                    const hasNot = !!(row?.not_aciklama || row?.belge_yolu);
                    const showNot = durum!=="CALISDI" && durum!=="TATIL" && durum!=="RESMI_TATIL" && row?.id;
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
   VERGİ HESABI — 2026 Türkiye oranları
   Net bankadan ödeme → brüt → tüm yükümlülükler
   ============================================================ */
function hesaplaVergi(netBankadan) {
  const net = Number(netBankadan) || 0;
  if (net <= 0) return null;

  // 2026 oranları
  const SGK_ISCI      = 0.14;
  const ISSIZLIK_ISCI = 0.01;
  const SGK_ISVEREN      = 0.205;
  const ISSIZLIK_ISVEREN = 0.02;
  const DAMGA         = 0.00759;

  // 2026 aylık gelir vergisi dilimleri (Resmi Gazete 2025 sonu ilanı)
  const DILIMLER = [
    { tavan: 19167,  oran: 0.15 },
    { tavan: 41667,  oran: 0.20 },
    { tavan: 108333, oran: 0.27 },
    { tavan: 400000, oran: 0.35 },
    { tavan: Infinity, oran: 0.40 },
  ];

  function gelirVergisi(matraha) {
    let vergi = 0, kalan = matraha, onceki = 0;
    for (const d of DILIMLER) {
      const dilimMiktar = Math.min(kalan, d.tavan - onceki);
      if (dilimMiktar <= 0) break;
      vergi += dilimMiktar * d.oran;
      kalan -= dilimMiktar;
      onceki = d.tavan;
    }
    return vergi;
  }

  // Binary search: net biliniyorken brüt'ü bul
  let lo = net, hi = net * 4;
  for (let i = 0; i < 60; i++) {
    const b = (lo + hi) / 2;
    const sgkI = b * SGK_ISCI;
    const issI = b * ISSIZLIK_ISCI;
    const matraha = b - sgkI - issI;
    const gv = gelirVergisi(matraha);
    const dv = b * DAMGA;
    const hesap = b - sgkI - issI - gv - dv;
    if (Math.abs(hesap - net) < 0.5) break;
    hesap > net ? hi = b : lo = b;
  }
  const brut = (lo + hi) / 2;

  const sgkIsci      = Math.round(brut * SGK_ISCI);
  const issizlikIsci = Math.round(brut * ISSIZLIK_ISCI);
  const matraha      = brut - sgkIsci - issizlikIsci;
  const gelirVrg     = Math.round(gelirVergisi(matraha));
  const damgaVrg     = Math.round(brut * DAMGA);
  const sgkIsveren      = Math.round(brut * SGK_ISVEREN);
  const issizlikIsveren = Math.round(brut * ISSIZLIK_ISVEREN);

  const toplamDevletOdemesi = sgkIsci + issizlikIsci + gelirVrg + damgaVrg + sgkIsveren + issizlikIsveren;
  const toplamIsverenMaliyet = Math.round(brut) + sgkIsveren + issizlikIsveren;

  return {
    brut: Math.round(brut), net: Math.round(net),
    sgk_isci: sgkIsci, issizlik_isci: issizlikIsci,
    gelir_vergisi: gelirVrg, damga_vergisi: damgaVrg,
    sgk_isveren: sgkIsveren, issizlik_isveren: issizlikIsveren,
    toplam_devlet: toplamDevletOdemesi,
    toplam_isveren_maliyet: toplamIsverenMaliyet,
  };
}

/* ============================================================
   HR DASHBOARD - Personel / Puantaj / Avans / ISG
   ============================================================ */
function HrDashboard({ onBack, currentUser }) {
  const _hrEmail = (currentUser?.email || "").toLowerCase();
  const _hrYetkili = _hrEmail === "orhan.bedir@simsektel.com" || _hrEmail === "duzgun.simsek@simsektel.com";
  const [personelUnlocked, setPersonelUnlocked] = useState(_hrYetkili);
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
  const [hrSearchText, setHrSearchText]         = useState("");
  const [hrSearchOpen, setHrSearchOpen]         = useState(false);
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
  const [isgBelgeDosya, setIsgBelgeDosya] = useState(null);
  const [notModal, setNotModal] = useState(null); // { puantajRow, personelAd, tarih }
  const [maasOdeModal, setMaasOdeModal] = useState(null); // personel object
  const [maasOdeHak, setMaasOdeHak] = useState(0); // bu ay gerçek hakediş (pazar primiyle)
  const [maasOdeList, setMaasOdeList] = useState([]);
  const [maasOdeForm, setMaasOdeForm] = useState({ donem:"", bankadan:"", elden:"", tarih:"", aciklama:"" });
  const [maasOdeSaving, setMaasOdeSaving] = useState(false);
  const [maasOdeEditId, setMaasOdeEditId] = useState(null); // düzenlenen ödeme id'si
  const [aylikOdemeler, setAylikOdemeler] = useState([]); // tüm personel bu ay ödeme özeti
  const [odemeTabloAcik, setOdemeTabloAcik] = useState(false); // ödeme takip tablosu açık/kapalı
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
  useEffect(() => { if (tab==="personel") { loadAvans(); loadIsAvans(); loadAylikOdemeler(); } }, [tab, puantajAy]);
  useEffect(() => { if (tab==="maas_avans") loadAvans(); }, [tab]);
  useEffect(() => { if (tab==="is_avans") loadIsAvans(); }, [tab]);
  useEffect(() => { if (tab==="personel" && hrPersonelFilter) loadMaasOde(hrPersonelFilter); else setMaasOdeList([]); }, [tab, hrPersonelFilter, puantajAy]);

  const handleSavePersonel = async (e) => {
    e.preventDefault();
    const method = editingPersonel ? "PUT" : "POST";
    const url = editingPersonel ? `${API_BASE}/hr/personel/${editingPersonel.id}` : `${API_BASE}/hr/personel`;
    await fetch(url, { method, headers: { "Content-Type":"application/json" }, body: JSON.stringify(pForm) });
    setShowPersonelForm(false); setEditingPersonel(null);
    loadPersonel();
    loadAylikOdemeler();
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
  const loadMaasOde = async (personelId) => {
    try {
      const res = await fetch(`${API_BASE}/hr/maas-odeme?personel_id=${personelId}`);
      const data = await res.json();
      setMaasOdeList(Array.isArray(data) ? data : []);
    } catch { setMaasOdeList([]); }
  };
  const loadAylikOdemeler = async () => {
    try {
      const res = await fetch(`${API_BASE}/hr/maas-odeme-aylik?donem=${puantajAy}`);
      const data = await res.json();
      setAylikOdemeler(Array.isArray(data) ? data : []);
    } catch { setAylikOdemeler([]); }
  };
  const handleSaveMaasOde = async (e) => {
    e.preventDefault();
    if (!maasOdeModal) return;
    setMaasOdeSaving(true);
    try {
      if (maasOdeEditId) {
        // Güncelleme (PUT)
        await fetch(`${API_BASE}/hr/maas-odeme/${maasOdeEditId}`, {
          method:"PUT", headers:{"Content-Type":"application/json"},
          body: JSON.stringify(maasOdeForm)
        });
        setMaasOdeEditId(null);
      } else {
        // Yeni kayıt (POST)
        await fetch(`${API_BASE}/hr/maas-odeme`, {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ personel_id: maasOdeModal.id, ...maasOdeForm, created_by: currentUser?.email })
        });
      }
      setMaasOdeForm({ donem:"", bankadan:"", elden:"", tarih:"", aciklama:"" });
      await loadMaasOde(maasOdeModal.id);
      loadAylikOdemeler();
    } catch (err) { alert("Kayıt sırasında hata: " + err.message); }
    setMaasOdeSaving(false);
  };
  const handleDeleteMaasOde = async (id) => {
    if (!window.confirm("Bu ödeme kaydı silinsin mi?")) return;
    try {
      await fetch(`${API_BASE}/hr/maas-odeme/${id}`, { method:"DELETE" });
      if (maasOdeModal) await loadMaasOde(maasOdeModal.id);
      loadAylikOdemeler();
    } catch { /* sessiz */ }
  };
  const handleBelgeUpload = async (personelId, tur, file) => {
    const fd = new FormData(); fd.append("dosya", file);
    await fetch(`${API_BASE}/hr/personel/${personelId}/belge/${tur}`, { method:"POST", body: fd });
    loadPersonelDetail(selectedPersonel);
  };
  const handleSaveIsg = async (e) => {
    e.preventDefault();
    let saved = null;
    try {
      const tur = isgTurleri.find(t=>t.tur===isgForm.egitim_turu);
      const res = await fetch(`${API_BASE}/hr/personel/${selectedPersonel.id}/isg`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({...isgForm, gecerlilik_yil: tur?.gecerlilik_yil || isgForm.gecerlilik_yil})
      });
      saved = await res.json();
      if (!res.ok) { alert("Kayıt hatası: " + (saved.error || res.status)); return; }
    } catch(err) { alert("Kayıt hatası: " + err.message); return; }

    // Kayıt başarılı — formu kapat ve listeyi yenile
    setShowIsgForm(false);
    setIsgForm({ egitim_turu:"", egitim_tarihi:"", gecerlilik_yil:2 });
    loadPersonelDetail(selectedPersonel);
    loadIsgUyarilar();

    // Belge upload — ayrı, başarısız olsa kayıt bozulmaz
    if (isgBelgeDosya && saved?.id) {
      try {
        await uploadIsgBelge(saved.id, isgBelgeDosya);
        loadPersonelDetail(selectedPersonel);
      } catch(err) { alert("Belge yükleme hatası: " + err.message); }
      finally { setIsgBelgeDosya(null); }
    } else { setIsgBelgeDosya(null); }
  };
  const uploadIsgBelge = async (isgId, file) => {
    const ext = file.name.split(".").pop();
    // Adım 1: Backend'den signed URL al
    let signedUrl, publicUrl;
    try {
      const signRes = await fetch(`${API_BASE}/hr/isg/signed-upload-url?isgId=${isgId}&ext=${ext}`);
      if (!signRes.ok) { const e=await signRes.json().catch(()=>({error:signRes.status})); throw new Error(e.error||signRes.status); }
      const d = await signRes.json();
      signedUrl = d.signedUrl; publicUrl = d.publicUrl;
    } catch(e) { throw new Error("Adım1 (signed URL): " + e.message); }
    // Adım 2: Dosyayı Supabase'e direkt yükle
    try {
      const upRes = await fetch(signedUrl, { method:"PUT", body: file, headers:{ "Content-Type": file.type, "x-upsert":"true" } });
      if (!upRes.ok) throw new Error(upRes.status);
    } catch(e) { throw new Error("Adım2 (Supabase PUT): " + e.message); }
    // Adım 3: Public URL'yi DB'ye kaydet
    try {
      const patchRes = await fetch(`${API_BASE}/hr/personel/${selectedPersonel.id}/isg/${isgId}/belge-url`, {
        method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ url: publicUrl })
      });
      if (!patchRes.ok) throw new Error(patchRes.status);
    } catch(e) { throw new Error("Adım3 (URL kaydet): " + e.message); }
  };
  const handleTumBelgeleriIndir = async () => {
    if (!selectedPersonel) return;
    const zip = new JSZip();
    const belgeAdiMap = {
      FOTOGRAF:"Fotograf", TC_KIMLIK:"TC_Kimlik", EHLIYET:"Ehliyet",
      SAGLIK_RAPORU:"Saglik_Raporu", SGK_BILDIRGE:"SGK_Bildirge", DIGER_BELGE:"Diger_Belge"
    };
    const fetchBuf = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.arrayBuffer();
    };
    let count = 0;
    // Personel belgeleri
    for (const b of personelBelgeler) {
      if (!b.dosya_yolu) continue;
      try {
        const ext = (b.dosya_yolu.split(".").pop().split("?")[0] || "bin").toLowerCase();
        const ad = (belgeAdiMap[b.belge_turu] || b.belge_turu) + "." + ext;
        const buf = await fetchBuf(b.dosya_yolu);
        zip.folder("Personel_Belgeleri").file(ad, buf);
        count++;
      } catch(e) {}
    }
    // ISG eğitim belgeleri
    for (const i of personelIsg) {
      if (!i.belge_yolu) continue;
      try {
        const ext = (i.belge_yolu.split(".").pop().split("?")[0] || "bin").toLowerCase();
        const ad = i.egitim_turu.replace(/[/\\:*?"<>|]/g, "_") + "." + ext;
        const buf = await fetchBuf(i.belge_yolu);
        zip.folder("ISG_Egitimleri").file(ad, buf);
        count++;
      } catch(e) {}
    }
    if (count === 0) { alert("İndirilecek belge bulunamadı."); return; }
    const blob = await zip.generateAsync({ type:"blob", compression:"DEFLATE", compressionOptions:{ level:6 } });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${selectedPersonel.ad_soyad.replace(/\s+/g,"_")}_Belgeler.zip`;
    a.click(); URL.revokeObjectURL(url);
  };
  const handleIsgBelgeUpload = async (personelId, isgId, file) => {
    try {
      await uploadIsgBelge(isgId, file);
      loadPersonelDetail(selectedPersonel);
    } catch(err) { alert("Belge yükleme hatası: " + err.message); }
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

  const TR_RESMI_TATIL_HR = [
    "2024-01-01","2024-04-10","2024-04-11","2024-04-12","2024-04-23","2024-05-01","2024-05-19","2024-06-15","2024-06-16","2024-06-17","2024-06-18","2024-07-15","2024-08-30","2024-10-29",
    "2025-01-01","2025-03-30","2025-03-31","2025-04-01","2025-04-23","2025-05-01","2025-05-19","2025-06-06","2025-06-07","2025-06-08","2025-06-09","2025-07-15","2025-08-30","2025-10-29",
    "2026-01-01","2026-03-31","2026-04-01","2026-04-02","2026-04-23","2026-05-01","2026-05-19","2026-06-06","2026-06-07","2026-06-08","2026-06-09","2026-07-15","2026-08-30","2026-10-29",
    "2027-01-01","2027-03-20","2027-03-21","2027-03-22","2027-04-23","2027-05-01","2027-05-19","2027-05-27","2027-05-28","2027-05-29","2027-05-30","2027-07-15","2027-08-30","2027-10-29",
  ];

  const DURUMLAR = [
    { key:"CALISDI",    label:"✅", color:"#22c55e", name:"ÇALIŞTI" },
    { key:"GELMEDI",    label:"❌", color:"#ef4444", name:"GELMEDİ" },
    { key:"IZIN",       label:"🏖", color:"#3b82f6", name:"İZİN" },
    { key:"RAPOR",      label:"☪️", color:"#f59e0b", name:"RAPOR" },
    { key:"TATIL",      label:"⭕", color:"#9ca3af", name:"HAFTA TATİLİ" },
    { key:"DINLENME",   label:"💤", color:"#7c3aed", name:"DİNLENME" },
    { key:"RESMI_TATIL",label:"🎌", color:"#1d4ed8", name:"RESMİ TATİL" },
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
        {[["personel","👤 Personel Maaş"],["maas_avans","💰 Maaş Avansı"],["is_avans","🏗 İş Avansı"],["puantaj","📋 Puantaj"],["isg","🎓 ISG / Belgeler"]].map(([k,l]) => (
          <button key={k} onClick={()=>{
            if (k === "personel" && !personelUnlocked) {
              const pwd = prompt("Personel bilgileri için şifre giriniz:");
              if (!["Orhan2026!","Duzgun2026!"].includes(pwd)) { alert("Yetkisiz erişim!"); return; }
              setPersonelUnlocked(true);
            }
            setTab(k);
          }} className={tab===k?"tab activeTab":"tab"} style={{ fontSize:"14px" }}>{l}</button>
        ))}
      </div>

      {/* ===== PERSONEL SEKMESİ ===== */}
      {tab==="personel" && !personelUnlocked && (
        <div style={{ textAlign:"center", padding:"60px 20px" }}>
          <div style={{ fontSize:"48px", marginBottom:"16px" }}>🔒</div>
          <div style={{ fontSize:"18px", fontWeight:700, color:"#1f2937", marginBottom:"8px" }}>Bu alan şifre korumalıdır</div>
          <div style={{ fontSize:"14px", color:"#6b7280", marginBottom:"24px" }}>Personel maaş bilgilerine erişmek için yetkili şifre gereklidir.</div>
          <button onClick={()=>{
            const pwd = prompt("Personel bilgileri için şifre giriniz:");
            if (["Orhan2026!","Duzgun2026!"].includes(pwd)) setPersonelUnlocked(true);
            else if (pwd !== null) alert("Yetkisiz erişim!");
          }} style={{ padding:"12px 28px", background:"#1f2937", color:"#fff", border:"none", borderRadius:"10px", fontSize:"15px", fontWeight:700, cursor:"pointer" }}>
            Şifre Gir
          </button>
        </div>
      )}
      {tab==="personel" && personelUnlocked && (
        <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"16px", flexWrap:"wrap", gap:"12px" }}>
                <div>
                  <h2 style={{ margin:0, fontSize:"20px" }}>
                    👤 Personel Listesi
                    <span style={{ marginLeft:"10px", fontSize:"13px", fontWeight:500, color:"#6b7280", background:"#f3f4f6", borderRadius:"20px", padding:"2px 10px" }}>
                      {personelList.filter(p=>p.aktif).length} aktif
                    </span>
                  </h2>
                  {/* Tam ay tahmini bütçe + an itibariyle — alt alta, aynı format */}
                  {(() => {
                    const ayAdi = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"][Number(ayStr)-1];
                    const labelSt = { fontSize:"13px", fontWeight:600, color:"#374151" };
                    const amountSt = (color) => ({ fontSize:"15px", fontWeight:800, color, marginLeft:"6px" });
                    return (
                      <div style={{ marginTop:"6px", display:"flex", flexDirection:"column", gap:"5px", alignItems:"flex-start" }}>
                        <div style={labelSt}>
                          📊 {ayAdi} {yilStr} Tahmini Maaş Bütçesi:
                          <span style={amountSt("#1e40af")}>
                            ₺{personelList.filter(p=>p.aktif).reduce((s,p) => s + Number(p.net_maas||0), 0).toLocaleString("tr-TR")}
                          </span>
                          <span style={{ fontSize:"11px", color:"#6b7280", marginLeft:"8px", fontWeight:500 }}>(tüm personel tam çalışırsa)</span>
                        </div>
                        <div style={labelSt}>
                          💰 An İtibariyle {ayAdi} {yilStr} Ayı Maaş Ödemesi Yapılacak:
                          <span style={amountSt("#15803d")}>
                            ₺{(ozet.length > 0
                              ? ozet.reduce((s,p) => s + Number(p.hakedilen_maas||0), 0)
                              : personelList.filter(p=>p.aktif).reduce((s,p) => s + Number(p.net_maas||0), 0)
                            ).toLocaleString("tr-TR")}
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                  {/* ── Maaş Ödeme Takip Paneli ── */}
                  {(() => {
                    const ayAdi = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"][Number(ayStr)-1];

                    // Nakdi maaş ödemeleri (maas_odeme tablosu)
                    const nakdiByPer = {};
                    aylikOdemeler.forEach(o => {
                      nakdiByPer[o.personel_id] = (nakdiByPer[o.personel_id]||0) + Number(o.toplam||0);
                    });

                    // Maaş avansları (avans_turu = 'MAAS' veya boş — İş avansı değil)
                    const avansMapByPer = {};
                    avansList
                      .filter(a => {
                        const tur = (a.avans_turu||"MAAS").toUpperCase();
                        return tur === "MAAS" && (a.tarih||"").startsWith(puantajAy);
                      })
                      .forEach(a => {
                        avansMapByPer[a.personel_id] = (avansMapByPer[a.personel_id]||0) + Number(a.tutar||0);
                      });

                    // Aktif personel + hakedişleri (tüm personel için toplamları hesapla)
                    const aktifPer = personelList.filter(p=>p.aktif);
                    const allRows = aktifPer.map(p => {
                      const ozO = ozet.find(o=>String(o.personel_id)===String(p.id));
                      const hakEdis  = ozO ? Number(ozO.hakedilen_maas||0) : Number(p.net_maas||0);
                      const avans    = avansMapByPer[p.id] || 0;
                      const nakdi    = nakdiByPer[p.id]    || 0;
                      const odenen   = avans + nakdi;
                      const kalan    = Math.max(0, hakEdis - odenen);
                      return { ...p, hakEdis, avans, nakdi, odenen, kalan };
                    });
                    // Tablo satırları: filtre seçiliyse sadece o personel
                    const perRows = hrPersonelFilter
                      ? allRows.filter(r=>String(r.id)===String(hrPersonelFilter))
                      : allRows;
                    // Toplamlar her zaman tüm personel üzerinden (filtreden bağımsız)
                    const topHak   = allRows.reduce((s,r)=>s+r.hakEdis,0);
                    const topOde   = allRows.reduce((s,r)=>s+r.odenen,0);
                    const topKalan = Math.max(0, topHak - topOde);
                    const tamamlandi = allRows.filter(r=>r.kalan===0 && r.odenen>0).length;
                    const bekleyen   = allRows.filter(r=>r.kalan>0).length;
                    return (
                      <div style={{ marginTop:"14px", background:"#fff", border:"1.5px solid #e5e7eb", borderRadius:"14px", overflow:"hidden" }}>
                        {/* ── Tıklanabilir başlık + özet ── */}
                        <div
                          onClick={()=>setOdemeTabloAcik(v=>!v)}
                          style={{ background:"#1e3a5f", padding:"0", cursor:"pointer", userSelect:"none" }}
                        >
                          {/* Üst bar: başlık + rozetler + ok */}
                          <div style={{ padding:"10px 18px", display:"flex", alignItems:"center", gap:"10px" }}>
                            <span style={{ color:"#fff", fontWeight:700, fontSize:"14px", flex:1 }}>
                              📋 {ayAdi} {yilStr} — Maaş Ödeme Durumu
                            </span>
                            <span style={{ background:"#dcfce7", color:"#166534", borderRadius:"20px", padding:"2px 10px", fontSize:"12px", fontWeight:700 }}>✅ {tamamlandi} tamamlandı</span>
                            {bekleyen>0 && <span style={{ background:"#fee2e2", color:"#991b1b", borderRadius:"20px", padding:"2px 10px", fontSize:"12px", fontWeight:700 }}>⏳ {bekleyen} bekliyor</span>}
                            <span style={{ color:"#93c5fd", fontSize:"16px", marginLeft:"6px", transition:"transform 0.25s", display:"inline-block", transform: odemeTabloAcik?"rotate(180deg)":"rotate(0deg)" }}>▼</span>
                          </div>
                          {/* Alt özet şeridi (her zaman görünür) */}
                          <div style={{ background:"rgba(0,0,0,0.25)", padding:"8px 18px", display:"flex", gap:"0" }}>
                            {[
                              { label:"Toplam Hakediş", val:`₺${topHak.toLocaleString("tr-TR")}`, color:"#93c5fd" },
                              { label:"Ödenen",         val:`₺${topOde.toLocaleString("tr-TR")}`, color:"#86efac" },
                              { label:"Kalan",          val: topKalan===0 ? "✅ Tamamlandı" : `₺${topKalan.toLocaleString("tr-TR")}`, color: topKalan===0?"#86efac":"#fca5a5" },
                            ].map((s,i)=>(
                              <div key={i} style={{ flex:1, textAlign:"center", borderRight: i<2?"1px solid rgba(255,255,255,0.1)":"none", padding:"4px 12px" }}>
                                <div style={{ fontSize:"10px", color:"rgba(255,255,255,0.55)", fontWeight:600, marginBottom:"2px" }}>{s.label}</div>
                                <div style={{ fontSize:"15px", fontWeight:800, color:s.color }}>{s.val}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* ── Açılır tablo ── */}
                        <div style={{
                          maxHeight: odemeTabloAcik ? "800px" : "0px",
                          overflow: "hidden",
                          transition: "max-height 0.35s ease",
                        }}>
                          <div style={{ overflowX:"auto" }}>
                            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"12px" }}>
                              <thead>
                                <tr style={{ background:"#f8fafc" }}>
                                  {["Personel","Ünvan","Hakediş","M.Avans","Nakdi Öd.","Toplam Öd.","Kalan"].map(h=>(
                                    <th key={h} style={{ padding:"8px 12px", fontWeight:700, color:"#374151", textAlign: h==="Personel"||h==="Ünvan" ? "left" : "right", borderBottom:"1.5px solid #e5e7eb", whiteSpace:"nowrap" }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {perRows.map((p,i)=>(
                                  <tr key={p.id} style={{ background: i%2===0?"#fff":"#f9fafb" }}>
                                    <td style={{ padding:"7px 12px", fontWeight:600, color:"#111827", whiteSpace:"nowrap" }}>{p.ad_soyad}</td>
                                    <td style={{ padding:"7px 12px", color:"#6b7280", whiteSpace:"nowrap" }}>{p.unvan||"-"}</td>
                                    <td style={{ padding:"7px 12px", textAlign:"right", fontWeight:600 }}>₺{p.hakEdis.toLocaleString("tr-TR")}</td>
                                    <td style={{ padding:"7px 12px", textAlign:"right", color: p.avans>0?"#92400e":"#9ca3af", fontWeight:600 }}>
                                      {p.avans>0 ? `₺${p.avans.toLocaleString("tr-TR")}` : "—"}
                                    </td>
                                    <td style={{ padding:"7px 12px", textAlign:"right", color: p.nakdi>0?"#1d4ed8":"#9ca3af", fontWeight:600 }}>
                                      {p.nakdi>0 ? `₺${p.nakdi.toLocaleString("tr-TR")}` : "—"}
                                    </td>
                                    <td style={{ padding:"7px 12px", textAlign:"right", color: p.odenen>0?"#166534":"#9ca3af", fontWeight:700 }}>
                                      {p.odenen>0 ? `₺${p.odenen.toLocaleString("tr-TR")}` : "—"}
                                    </td>
                                    <td style={{ padding:"7px 12px", textAlign:"right" }}>
                                      {p.kalan===0 && p.odenen>0
                                        ? <span style={{ color:"#166534", fontWeight:700 }}>✅ Tam</span>
                                        : p.kalan>0
                                          ? <span style={{ color:"#dc2626", fontWeight:800 }}>₺{p.kalan.toLocaleString("tr-TR")}</span>
                                          : <span style={{ color:"#9ca3af" }}>—</span>
                                      }
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div style={{ display:"flex", gap:"8px", alignItems:"center", flexWrap:"wrap", position:"sticky", top:"12px", alignSelf:"flex-start" }}>
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
                  {/* Arama + dropdown filtre */}
                  <div style={{ position:"relative", minWidth:"180px" }}>
                    <input
                      type="text"
                      placeholder="🔍 Personel ara..."
                      value={hrSearchText}
                      autoComplete="off"
                      onFocus={()=>setHrSearchOpen(true)}
                      onBlur={()=>setTimeout(()=>setHrSearchOpen(false),150)}
                      onChange={e=>{ setHrSearchText(e.target.value); setHrSearchOpen(true); if(!e.target.value){ setHrPersonelFilter(""); } }}
                      style={{ padding:"7px 10px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"13px", width:"100%", boxSizing:"border-box" }}
                    />
                    {hrSearchOpen && (
                      <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, right:0, background:"#fff", border:"1.5px solid #e5e7eb", borderRadius:"8px", boxShadow:"0 4px 16px rgba(0,0,0,0.12)", zIndex:999, maxHeight:"220px", overflowY:"auto" }}>
                        <div
                          onMouseDown={()=>{ setHrPersonelFilter(""); setHrSearchText(""); setHrSearchOpen(false); setOdemeTabloAcik(false); }}
                          style={{ padding:"8px 12px", fontSize:"13px", color:"#6b7280", cursor:"pointer", borderBottom:"1px solid #f3f4f6" }}
                          onMouseEnter={e=>e.currentTarget.style.background="#f9fafb"}
                          onMouseLeave={e=>e.currentTarget.style.background=""}
                        >👥 Tüm Personel</div>
                        {personelList.filter(p=>p.aktif && (!hrSearchText || p.ad_soyad.toLowerCase().includes(hrSearchText.toLowerCase()))).map(p=>(
                          <div key={p.id}
                            onMouseDown={()=>{ setHrPersonelFilter(String(p.id)); setHrSearchText(p.ad_soyad); setHrSearchOpen(false); setOdemeTabloAcik(true); }}
                            style={{ padding:"8px 12px", fontSize:"13px", color:"#1f2937", cursor:"pointer", borderBottom:"1px solid #f9fafb" }}
                            onMouseEnter={e=>e.currentTarget.style.background="#eff6ff"}
                            onMouseLeave={e=>e.currentTarget.style.background=""}
                          >{p.ad_soyad}</div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button style={{ padding:"7px 14px", background:"#16a34a", color:"#fff", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:600, cursor:"pointer" }}
                    onClick={() => {
                      const today = new Date().toISOString().slice(0,10);
                      const ayAdiEx = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"][new Date().getMonth()];
                      const fmtDate = v => { if (!v) return ""; const d = new Date(v); return isNaN(d)?String(v):`${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`; };
                      const fmtNum  = v => v ? Number(v).toLocaleString("tr-TR") : "0";

                      const headers = ["Ad Soyad","Unvan","Bölge","TC No","Doğum Tarihi","Telefon","E-Posta","İşe Giriş","Ayrılma Tarihi","Net Maaş (₺)","Bankadan (₺)","Elden (₺)","IBAN","Banka Adı","Hesap No","Durum"];
                      const cols    = [26,18,14,14,13,14,28,13,13,16,14,12,34,16,18,8];
                      const dateKeys = ["dogum_tarihi","ise_giris_tarihi","isten_ayrilma_tarihi"];
                      const numKeys  = ["net_maas","bankadan_gosterilen","elden_verilen"];
                      const keys     = ["ad_soyad","unvan","bolge","tc_no","dogum_tarihi","telefon","email","ise_giris_tarihi","isten_ayrilma_tarihi","net_maas","bankadan_gosterilen","elden_verilen","iban","banka_adi","banka_hesap_no","aktif"];

                      // Stil sabitleri
                      const headerS = {
                        fill:{ patternType:"solid", fgColor:{ rgb:"1E3A5F" } },
                        font:{ bold:true, color:{ rgb:"FFFFFF" }, sz:11, name:"Calibri" },
                        alignment:{ horizontal:"center", vertical:"center", wrapText:true },
                        border:{ top:{style:"medium",color:{rgb:"FFFFFF"}}, bottom:{style:"medium",color:{rgb:"FFFFFF"}}, left:{style:"thin",color:{rgb:"3B6EA5"}}, right:{style:"thin",color:{rgb:"3B6EA5"}} }
                      };
                      const cellS = (ri, isNum, isDurum, val) => ({
                        fill:{ patternType:"solid", fgColor:{ rgb: ri%2===0 ? "EFF6FF":"FFFFFF" } },
                        font:{ sz:10, name:"Calibri",
                          bold: isNum,
                          color:{ rgb: isDurum ? (val==="Aktif"?"166534":"991B1B") : isNum ? "1E3A8A" : "1F2937" }
                        },
                        alignment:{ horizontal: isNum?"right":isDurum?"center":"left", vertical:"center" },
                        border:{ top:{style:"thin",color:{rgb:"DBEAFE"}}, bottom:{style:"thin",color:{rgb:"DBEAFE"}}, left:{style:"thin",color:{rgb:"DBEAFE"}}, right:{style:"thin",color:{rgb:"DBEAFE"}} }
                      });

                      const wsData = [headers];
                      personelList.forEach(p => {
                        wsData.push(keys.map(k => {
                          if (k==="aktif") return p[k]?"Aktif":"Pasif";
                          if (dateKeys.includes(k)) return fmtDate(p[k]);
                          if (numKeys.includes(k)) return fmtNum(p[k]);
                          return p[k]||"";
                        }));
                      });

                      const ws = XLSXStyle.utils.aoa_to_sheet(wsData);
                      ws["!cols"] = cols.map(w=>({wch:w}));
                      ws["!rows"] = [{ hpt:26 }, ...personelList.map(()=>({hpt:20}))];

                      // Başlık stilleri
                      headers.forEach((_,ci) => {
                        const a = XLSXStyle.utils.encode_cell({r:0,c:ci});
                        if (ws[a]) ws[a].s = headerS;
                      });
                      // Veri satırı stilleri
                      personelList.forEach((_,ri) => {
                        keys.forEach((k,ci) => {
                          const a = XLSXStyle.utils.encode_cell({r:ri+1,c:ci});
                          if (!ws[a]) return;
                          const isNum = numKeys.includes(k);
                          const isDurum = k==="aktif";
                          ws[a].s = cellS(ri, isNum, isDurum, ws[a].v);
                        });
                      });

                      // Başlık satırı dondur
                      ws["!freeze"] = { xSplit:0, ySplit:1 };

                      const wb = XLSXStyle.utils.book_new();
                      XLSXStyle.utils.book_append_sheet(wb, ws, "Personel Listesi");

                      // Gridlines kapat: buffer → JSZip STORE → XML patch → download
                      const buf = XLSXStyle.write(wb, { type:"array", bookType:"xlsx" });
                      JSZip.loadAsync(buf).then(zip => {
                        const sheetFile = zip.file("xl/worksheets/sheet1.xml");
                        return sheetFile.async("string").then(xml => {
                          // Basit string replace — regex yerine güvenli
                          const patched = xml
                            .replace('<sheetView workbookViewId="0"/>', '<sheetView showGridLines="0" workbookViewId="0"/>')
                            .replace('<sheetView tabSelected="1" workbookViewId="0"/>', '<sheetView showGridLines="0" tabSelected="1" workbookViewId="0"/>');
                          zip.file("xl/worksheets/sheet1.xml", patched);
                          return zip.generateAsync({ type:"blob", compression:"STORE" });
                        });
                      }).then(blob => {
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url; a.download = `ERC_Personel_Listesi_${today}.xlsx`;
                        document.body.appendChild(a); a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                      });
                    }}>
                    📥 Excel İndir
                  </button>
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
                const gelmediSay = sc["GELMEDI"]||0;
                const pazarCalisdiHR = ayGunleri.filter(g => {
                  const row = getPuantaj(sp.id, g);
                  return row?.durum === "CALISDI" && new Date(Number(yilStr), Number(ayStr)-1, g).getDay() === 0;
                }).length;
                const dailyRateHR = (sp.net_maas||0) / 26;
                const gelmediKesinti = Math.round(gelmediSay * dailyRateHR);
                const ozetRowHR = ozet.find(o => o.personel_id === sp.id);
                const dinlenmeBakiyeHR = ozetRowHR?.dinlenme_bakiye ?? 0;
                const toplamPazarHR = ozetRowHR?.toplam_pazar_calisdi ?? 0;
                const toplamResmiTatilHR = ozetRowHR?.toplam_resmi_tatil_calisdi ?? 0;
                const toplamDinlenmeHR = ozetRowHR?.toplam_dinlenme ?? 0;
                const extraHakedisHR = ozetRowHR?.extra_hakedis ?? Math.round(dinlenmeBakiyeHR * dailyRateHR * 1.5);
                const tooltipExtra = [
                  `Pazar çalışma (toplam): ${toplamPazarHR} gün`,
                  `Resmi tatil çalışma (toplam): ${toplamResmiTatilHR} gün`,
                  `Dinlenme alınan (toplam): ${toplamDinlenmeHR} gün`,
                  `─────────────────`,
                  `Kalan bakiye: ${dinlenmeBakiyeHR} gün`,
                  `Günlük ücret × 1.5 = ₺${Math.round(dailyRateHR*1.5).toLocaleString("tr-TR")}`,
                  `Toplam extra hakediş: ₺${extraHakedisHR.toLocaleString("tr-TR")}`,
                ].join("\n");
                const maasAvans = avansList
                  .filter(a => String(a.personel_id)===String(sp.id) && (a.tarih||"").startsWith(puantajAy))
                  .reduce((s,a)=>s+Number(a.tutar||0), 0);
                const isAvans = isAvansList
                  .filter(a => String(a.personel_id)===String(sp.id) && (a.tarih||"").startsWith(puantajAy))
                  .reduce((s,a)=>s+Number(a.tutar||0), 0);
                const odenenBuAy = maasOdeList
                  .filter(o => o.donem === puantajAy)
                  .reduce((s,o)=>s+Number(o.bankadan||0)+Number(o.elden||0), 0);
                // Net ödenecek: net_maas bazlı (extra hakediş ayrı takip edilir)
                const netBase = Math.round((sp.net_maas||0) - gelmediKesinti);
                const net = netBase - maasAvans - odenenBuAy;
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
                        { label:"Gelmedi",   emoji:"❌", val:gelmediSay, bg:"#fee2e2", tc:"#991b1b" },
                        { label:"İzin",      emoji:"🏖", val:sc["IZIN"]||0,    bg:"#dbeafe", tc:"#1d4ed8" },
                        { label:"Rapor",     emoji:"☪️", val:sc["RAPOR"]||0,   bg:"#fef3c7", tc:"#92400e" },
                        { label:"H.Tatili",  emoji:"⭕", val:sc["TATIL"]||0,   bg:"#f1f5f9", tc:"#64748b" },
                        { label:"Dinlenme",  emoji:"💤", val:sc["DINLENME"]||0, bg:"#f3e8ff", tc:"#7c3aed" },
                      ].map(s=>(
                        <div key={s.label} style={{ background:s.bg, borderRadius:"12px", padding:"10px 14px", textAlign:"center", minWidth:"70px" }}>
                          <div style={{ fontSize:"22px", fontWeight:800, color:s.tc }}>{s.val}</div>
                          <div style={{ fontSize:"10px", fontWeight:600, color:s.tc, marginTop:"2px" }}>{s.emoji} {s.label}</div>
                        </div>
                      ))}
                      {dinlenmeBakiyeHR > 0 && (
                        <div style={{ background:"#fdf4ff", border:"2px solid #d8b4fe", borderRadius:"12px", padding:"10px 14px", textAlign:"center", minWidth:"70px" }}>
                          <div style={{ fontSize:"22px", fontWeight:800, color:"#7c3aed" }}>{dinlenmeBakiyeHR}</div>
                          <div style={{ fontSize:"10px", fontWeight:600, color:"#7c3aed", marginTop:"2px" }}>💤 Bakiye</div>
                        </div>
                      )}
                    </div>
                    {/* ── Yeni 4 satır kart tasarımı ── */}
                    {(() => {
                      const bankadan_gosterilen = Number(sp.bankadan_gosterilen||0);
                      const elden_verilen       = Number(sp.elden_verilen||0);
                      // Bu ay maas_odeme kayıtlarından banka / elden ayrımı
                      const buAyOdeme = maasOdeList.filter(o => o.donem === puantajAy);
                      const bankaOdenen = buAyOdeme.reduce((s,o)=>s+Number(o.bankadan||0), 0);
                      const eldenOdenen = buAyOdeme.reduce((s,o)=>s+Number(o.elden||0),    0);
                      const bankaKalan  = Math.max(0, bankadan_gosterilen - bankaOdenen);
                      const eldenKalan  = Math.max(0, elden_verilen       - eldenOdenen);
                      const toplamKalan = bankaKalan + eldenKalan;
                      const tamam       = toplamKalan <= 0;

                      const cardW = "220px";
                      const halfW = "107px";
                      const cardSt = (grad, extra={}) => ({
                        background: grad, borderRadius:"14px", padding:"12px 14px",
                        textAlign:"center", color:"#fff", ...extra,
                      });
                      const lbl = { fontSize:"10px", fontWeight:700, opacity:0.82, marginBottom:"3px", textTransform:"uppercase", letterSpacing:"0.04em" };
                      const amt = (sz=22) => ({ fontSize:`${sz}px`, fontWeight:800, lineHeight:1.1 });
                      const sub = { fontSize:"10px", opacity:0.68, marginTop:"3px" };

                      // Kalan progress bar helper
                      const ProgressBar = ({paid, total, color="#86efac"}) => {
                        const pct = total>0 ? Math.min(100,Math.round((paid/total)*100)) : (paid>0?100:0);
                        return (
                          <div style={{ marginTop:"5px" }}>
                            <div style={{ background:"rgba(255,255,255,0.2)", borderRadius:"99px", height:"4px", overflow:"hidden" }}>
                              <div style={{ width:`${pct}%`, height:"100%", background:color, borderRadius:"99px", transition:"width 0.4s" }} />
                            </div>
                            <div style={{ fontSize:"9px", opacity:0.65, marginTop:"2px" }}>{pct}% ödendi</div>
                          </div>
                        );
                      };

                      return (
                        <div style={{ display:"flex", flexDirection:"column", gap:"7px", width:cardW, flexShrink:0 }}>

                          {/* Satır 1 — Net Maaş (tam genişlik, yeşil) */}
                          <div style={cardSt("linear-gradient(135deg,#15803d,#22c55e)")}>
                            <div style={lbl}>💰 Net Maaş</div>
                            <div style={amt(24)}>₺{Number(sp.net_maas||0).toLocaleString("tr-TR")}</div>
                            <div style={sub}>{gelmediKesinti>0?`-₺${gelmediKesinti.toLocaleString("tr-TR")} kesinti (${gelmediSay} gün)`:`${cal} gün çalışıldı`}</div>
                            {extraHakedisHR > 0 && (
                              <div title={tooltipExtra} style={{ marginTop:"5px", fontSize:"10px", background:"rgba(255,255,255,0.2)", borderRadius:"8px", padding:"3px 8px", cursor:"help" }}>
                                ✨ Extra: ₺{extraHakedisHR.toLocaleString("tr-TR")} ({dinlenmeBakiyeHR} gün)
                              </div>
                            )}
                          </div>

                          {/* Satır 2 — Resmi / Elden planlanan (yarım genişlik, yeşil tonu) */}
                          <div style={{ display:"flex", gap:"7px" }}>
                            <div style={{ ...cardSt("linear-gradient(135deg,#166534,#16a34a)"), flex:1 }}>
                              <div style={lbl}>🏦 Resmi Ödeme</div>
                              <div style={amt(18)}>₺{bankadan_gosterilen.toLocaleString("tr-TR")}</div>
                              <div style={sub}>Bankadan</div>
                            </div>
                            <div style={{ ...cardSt("linear-gradient(135deg,#14532d,#15803d)"), flex:1 }}>
                              <div style={lbl}>💵 Elden Ödeme</div>
                              <div style={amt(18)}>₺{elden_verilen.toLocaleString("tr-TR")}</div>
                              <div style={sub}>Nakit</div>
                            </div>
                          </div>

                          {/* Satır 3 — Bankadan / Elden ödenen & kalan */}
                          <div style={{ display:"flex", gap:"7px" }}>
                            <div style={{ ...cardSt(bankaKalan<=0?"linear-gradient(135deg,#0f4c2a,#166534)":"linear-gradient(135deg,#1e3a5f,#2563eb)"), flex:1 }}>
                              <div style={lbl}>🏦 {bankaKalan<=0?"✓ Banka":"Banka Kalan"}</div>
                              <div style={amt(17)}>₺{bankaKalan.toLocaleString("tr-TR")}</div>
                              <div style={sub}>Ödenen: ₺{bankaOdenen.toLocaleString("tr-TR")}</div>
                              <ProgressBar paid={bankaOdenen} total={bankadan_gosterilen} />
                            </div>
                            <div style={{ ...cardSt(eldenKalan<=0?"linear-gradient(135deg,#0f4c2a,#166534)":"linear-gradient(135deg,#1e3a5f,#2563eb)"), flex:1 }}>
                              <div style={lbl}>💵 {eldenKalan<=0?"✓ Elden":"Elden Kalan"}</div>
                              <div style={amt(17)}>₺{eldenKalan.toLocaleString("tr-TR")}</div>
                              <div style={sub}>Ödenen: ₺{eldenOdenen.toLocaleString("tr-TR")}</div>
                              <ProgressBar paid={eldenOdenen} total={elden_verilen} />
                            </div>
                          </div>

                          {/* Satır 4 — Tamamlandı / Kalan (tam genişlik) */}
                          <div style={cardSt(tamam?"linear-gradient(135deg,#166534,#15803d)":"linear-gradient(135deg,#dc2626,#ef4444)")}>
                            <div style={lbl}>{tamam?"✅ Tamamlandı":"⏳ Kalan Ödeme"}</div>
                            <div style={amt(22)}>₺{toplamKalan.toLocaleString("tr-TR")}</div>
                            {(maasAvans>0||isAvans>0) && (
                              <div style={sub}>
                                {maasAvans>0?`Maaş avansı: ₺${maasAvans.toLocaleString("tr-TR")} · `:""}
                                {isAvans>0?`İş avansı: ₺${isAvans.toLocaleString("tr-TR")}`:""}
                              </div>
                            )}
                          </div>

                        </div>
                      );
                    })()}
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
                {personelList.filter(p => !hrPersonelFilter || String(p.id) === String(hrPersonelFilter)).map(p => (
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
                      <button onClick={()=>handleEditPersonel(p)} style={{ padding:"6px 12px", background:"#f3f4f6", color:"#374151", border:"none", borderRadius:"8px", fontSize:"12px", fontWeight:600, cursor:"pointer" }}>Düzenle</button>
                      <button onClick={()=>{ const now=new Date(); const pOzet=ozet.find(o=>String(o.personel_id)===String(p.id)); const hakVal=pOzet ? Number(pOzet.hakedilen_maas||0) : Number(p.net_maas||0); setMaasOdeModal(p); setMaasOdeHak(hakVal); setMaasOdeForm({ donem:`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`, bankadan:"", elden:"", tarih:now.toISOString().split("T")[0], aciklama:"" }); loadMaasOde(p.id); }} style={{ padding:"6px 12px", background:"#f0fdf4", color:"#166534", border:"none", borderRadius:"8px", fontSize:"12px", fontWeight:600, cursor:"pointer" }}>💰 Öde</button>
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

      {/* ===== MAAŞ ÖDEME MODAL ===== */}
      {maasOdeModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:"16px" }}>
          <div style={{ background:"#fff", borderRadius:"18px", padding:"28px", width:"100%", maxWidth:"600px", maxHeight:"90vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"16px" }}>
              <h3 style={{ margin:0, fontSize:"18px" }}>💰 Maaş Ödemesi — {maasOdeModal.ad_soyad}</h3>
              <button onClick={()=>setMaasOdeModal(null)} style={{ background:"none", border:"none", fontSize:"20px", cursor:"pointer", color:"#6b7280" }}>✕</button>
            </div>

            {/* Kalan özeti */}
            {(() => {
              const modalMaasAvans = avansList.filter(a => String(a.personel_id)===String(maasOdeModal.id) && (a.tarih||"").startsWith(puantajAy)).reduce((s,a)=>s+Number(a.tutar||0),0);
              const modalOdenen = maasOdeList.filter(o => o.donem===puantajAy).reduce((s,o)=>s+Number(o.bankadan||0)+Number(o.elden||0),0);
              const modalKalan = maasOdeHak - modalMaasAvans - modalOdenen;
              return (
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"8px", marginBottom:"16px", padding:"12px", background:"#f8fafc", borderRadius:"12px", textAlign:"center" }}>
                  <div>
                    <div style={{ fontSize:"10px", fontWeight:600, color:"#6b7280" }}>Bu Ay Hakediş</div>
                    <div style={{ fontSize:"16px", fontWeight:800, color:"#166534" }}>₺{maasOdeHak.toLocaleString("tr-TR")}</div>
                  </div>
                  <div>
                    <div style={{ fontSize:"10px", fontWeight:600, color:"#6b7280" }}>Ödendi (avans + nakdi)</div>
                    <div style={{ fontSize:"16px", fontWeight:800, color:"#92400e" }}>₺{(modalMaasAvans+modalOdenen).toLocaleString("tr-TR")}</div>
                  </div>
                  <div style={{ background: modalKalan<=0?"#dcfce7":"#eff6ff", borderRadius:"8px", padding:"4px" }}>
                    <div style={{ fontSize:"10px", fontWeight:600, color: modalKalan<=0?"#166534":"#1d4ed8" }}>{modalKalan<=0?"✅ Tamamlandı":"Kalan Ödeme"}</div>
                    <div style={{ fontSize:"16px", fontWeight:800, color: modalKalan<=0?"#166534":"#1d4ed8" }}>₺{Math.max(0,modalKalan).toLocaleString("tr-TR")}</div>
                  </div>
                </div>
              );
            })()}

            {/* Yeni / Düzenle ödeme formu */}
            <form onSubmit={handleSaveMaasOde} style={{ display:"grid", gap:"12px", marginBottom:"24px", padding:"16px", background: maasOdeEditId ? "#fffbeb" : "#f8fafc", borderRadius:"12px", border: maasOdeEditId ? "2px solid #fbbf24" : "none" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontWeight:700, fontSize:"14px", color: maasOdeEditId ? "#92400e" : "#374151" }}>
                  {maasOdeEditId ? "✏️ Ödemeyi Düzenle" : "Yeni Ödeme Ekle"}
                </div>
                {maasOdeEditId && (
                  <button type="button" onClick={()=>{ setMaasOdeEditId(null); setMaasOdeForm({ donem:"", bankadan:"", elden:"", tarih:"", aciklama:"" }); }}
                    style={{ background:"#fee2e2", color:"#991b1b", border:"none", borderRadius:"8px", padding:"4px 10px", fontSize:"12px", cursor:"pointer" }}>
                    ✕ İptal
                  </button>
                )}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px" }}>
                <div>
                  <div style={{ fontSize:"12px", fontWeight:600, color:"#6b7280", marginBottom:"4px" }}>Dönem (Ay)</div>
                  <input type="month" value={maasOdeForm.donem} onChange={e=>setMaasOdeForm(f=>({...f,donem:e.target.value}))} required style={{ width:"100%", padding:"8px 10px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"14px", boxSizing:"border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize:"12px", fontWeight:600, color:"#6b7280", marginBottom:"4px" }}>Ödeme Tarihi</div>
                  <input type="date" value={maasOdeForm.tarih} onChange={e=>setMaasOdeForm(f=>({...f,tarih:e.target.value}))} required style={{ width:"100%", padding:"8px 10px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"14px", boxSizing:"border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize:"12px", fontWeight:600, color:"#6b7280", marginBottom:"4px" }}>Bankadan (₺)</div>
                  <input type="number" value={maasOdeForm.bankadan} onChange={e=>setMaasOdeForm(f=>({...f,bankadan:e.target.value}))} placeholder="0" style={{ width:"100%", padding:"8px 10px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"14px", boxSizing:"border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize:"12px", fontWeight:600, color:"#6b7280", marginBottom:"4px" }}>Elden (₺)</div>
                  <input type="number" value={maasOdeForm.elden} onChange={e=>setMaasOdeForm(f=>({...f,elden:e.target.value}))} placeholder="0" style={{ width:"100%", padding:"8px 10px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"14px", boxSizing:"border-box" }} />
                </div>
              </div>
              <div>
                <div style={{ fontSize:"12px", fontWeight:600, color:"#6b7280", marginBottom:"4px" }}>Açıklama</div>
                <input type="text" value={maasOdeForm.aciklama} onChange={e=>setMaasOdeForm(f=>({...f,aciklama:e.target.value}))} placeholder="Opsiyonel not..." style={{ width:"100%", padding:"8px 10px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"14px", boxSizing:"border-box" }} />
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontSize:"13px", color:"#6b7280" }}>
                  Bankadan + Elden: <b>₺{(Number(maasOdeForm.bankadan||0)+Number(maasOdeForm.elden||0)).toLocaleString("tr-TR")}</b>
                </div>
                <button type="submit" disabled={maasOdeSaving} style={{ padding:"8px 20px", background: maasOdeEditId ? "#d97706" : "#166534", color:"#fff", border:"none", borderRadius:"8px", fontSize:"14px", fontWeight:600, cursor:"pointer" }}>
                  {maasOdeSaving ? "Kaydediliyor..." : maasOdeEditId ? "✏️ Güncelle" : "Kaydet"}
                </button>
              </div>

              {/* Vergi Hesabı — bankadan kısmından otomatik */}
              {Number(maasOdeForm.bankadan) > 0 && (() => {
                const v = hesaplaVergi(Number(maasOdeForm.bankadan));
                if (!v) return null;
                const elden = Number(maasOdeForm.elden||0);
                const TL = n => `₺${Math.round(n).toLocaleString("tr-TR")}`;
                return (
                  <div style={{ marginTop:"12px", background:"#fff", border:"1.5px solid #e5e7eb", borderRadius:"12px", overflow:"hidden" }}>
                    <div style={{ background:"#1e3a5f", color:"#fff", padding:"8px 14px", fontSize:"12px", fontWeight:700 }}>
                      📊 Vergi & Maliyet Hesabı — Bankadan {TL(v.net)} üzerinden (2026 oranları)
                    </div>
                    <div style={{ padding:"12px 14px", display:"grid", gap:"4px" }}>
                      {/* Brüt */}
                      <div style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", borderBottom:"1px solid #f3f4f6", fontSize:"13px" }}>
                        <span style={{ color:"#374151", fontWeight:600 }}>Brüt Maaş</span>
                        <span style={{ fontWeight:700 }}>{TL(v.brut)}</span>
                      </div>
                      {/* İşçi kesintileri */}
                      <div style={{ fontSize:"11px", color:"#6b7280", padding:"6px 0 2px", fontWeight:600 }}>İşçi Kesintileri (net'ten düşülen)</div>
                      {[
                        ["SGK İşçi Payı (%14)", v.sgk_isci],
                        ["İşsizlik İşçi (%1)", v.issizlik_isci],
                        ["Gelir Vergisi", v.gelir_vergisi],
                        ["Damga Vergisi (%0.759)", v.damga_vergisi],
                      ].map(([l,a])=>(
                        <div key={l} style={{ display:"flex", justifyContent:"space-between", fontSize:"12px", padding:"2px 0", color:"#6b7280" }}>
                          <span>{l}</span><span style={{ color:"#dc2626" }}>−{TL(a)}</span>
                        </div>
                      ))}
                      {/* İşveren kesintileri */}
                      <div style={{ fontSize:"11px", color:"#6b7280", padding:"6px 0 2px", fontWeight:600 }}>İşveren Ek Yükümlülükleri (ayrıca ödenen)</div>
                      {[
                        ["SGK İşveren Payı (%20.5)", v.sgk_isveren],
                        ["İşsizlik İşveren (%2)", v.issizlik_isveren],
                      ].map(([l,a])=>(
                        <div key={l} style={{ display:"flex", justifyContent:"space-between", fontSize:"12px", padding:"2px 0", color:"#6b7280" }}>
                          <span>{l}</span><span style={{ color:"#d97706" }}>+{TL(a)}</span>
                        </div>
                      ))}
                      {/* Özet */}
                      <div style={{ borderTop:"2px solid #e5e7eb", marginTop:"8px", paddingTop:"8px", display:"grid", gap:"4px" }}>
                        {[
                          ["Toplam Devlet Ödemesi (vergi+SGK)", v.toplam_devlet, "#7c3aed"],
                          ["İşverene Toplam Maliyet (bankadan)", v.toplam_isveren_maliyet, "#1d4ed8"],
                          elden > 0 && ["Elden Ödeme (vergisiz)", elden, "#6b7280"],
                          ["TOPLAM NAKİT ÇIKIŞI", v.toplam_isveren_maliyet + elden, "#166534"],
                        ].filter(Boolean).map(([l,a,c])=>(
                          <div key={l} style={{ display:"flex", justifyContent:"space-between", fontSize:"13px", fontWeight:700, color:c }}>
                            <span>{l}</span><span>{TL(a)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </form>

            {/* Geçmiş ödemeler */}
            <div style={{ fontWeight:700, fontSize:"14px", color:"#374151", marginBottom:"12px" }}>Ödeme Geçmişi</div>
            {maasOdeList.length === 0
              ? <div style={{ textAlign:"center", color:"#9ca3af", padding:"20px", fontSize:"14px" }}>Henüz ödeme kaydı yok.</div>
              : (() => {
                  const TL = n => `₺${Math.round(n).toLocaleString("tr-TR")}`;
                  // Tüm geçmiş ödemelerin vergi toplamları
                  let kumBankadan=0, kumElden=0, kumDevlet=0, kumIsverenMaliyet=0, kumToplamHazine=0;
                  const odemeKartlari = maasOdeList.map(od => {
                    const banka = Number(od.bankadan||0);
                    const elden = Number(od.elden||0);
                    const v = banka > 0 ? hesaplaVergi(banka) : null;
                    kumBankadan += banka; kumElden += elden;
                    if (v) { kumDevlet += v.toplam_devlet; kumIsverenMaliyet += v.toplam_isveren_maliyet; kumToplamHazine += v.toplam_isveren_maliyet + elden; }
                    else { kumToplamHazine += banka + elden; }
                    return (
                      <div key={od.id} style={{ background:"#f8fafc", borderRadius:"10px", overflow:"hidden" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 16px" }}>
                          <div>
                            <div style={{ fontWeight:700, fontSize:"14px" }}>{od.donem} <span style={{ fontWeight:400, color:"#6b7280", fontSize:"12px" }}>· {new Date(od.tarih).toLocaleDateString("tr-TR")}</span></div>
                            <div style={{ fontSize:"13px", marginTop:"2px" }}>
                              {banka>0 && <span style={{ marginRight:"10px" }}>🏦 {TL(banka)}</span>}
                              {elden>0 && <span>💵 {TL(elden)}</span>}
                            </div>
                            {od.aciklama && <div style={{ fontSize:"12px", color:"#6b7280", marginTop:"2px" }}>{od.aciklama}</div>}
                          </div>
                          <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                            <div style={{ fontWeight:700, color:"#166534", fontSize:"15px" }}>{TL(banka+elden)}</div>
                            <button onClick={()=>{ setMaasOdeEditId(od.id); setMaasOdeForm({ donem: od.donem, bankadan: String(od.bankadan||""), elden: String(od.elden||""), tarih: (od.tarih||"").split("T")[0], aciklama: od.aciklama||"" }); window.scrollTo({top:0}); }}
                              style={{ background:"#fef3c7", color:"#92400e", border:"none", borderRadius:"8px", padding:"4px 10px", fontSize:"12px", cursor:"pointer", fontWeight:600 }}>✏️ Düzenle</button>
                            <button onClick={()=>handleDeleteMaasOde(od.id)} style={{ background:"#fee2e2", color:"#991b1b", border:"none", borderRadius:"8px", padding:"4px 10px", fontSize:"12px", cursor:"pointer" }}>Sil</button>
                          </div>
                        </div>
                        {v && (
                          <div style={{ background:"#1e3a5f", color:"#fff", padding:"8px 16px", fontSize:"11px", display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"8px", textAlign:"center" }}>
                            <div><div style={{ opacity:0.7 }}>Brüt</div><div style={{ fontWeight:700 }}>{TL(v.brut)}</div><div style={{ fontSize:"9px", opacity:0.45, marginTop:"2px" }}>net'ten hesaplanan</div></div>
                            <div><div style={{ opacity:0.7 }}>SGK+İşsizlik İşçi</div><div style={{ fontWeight:700, color:"#fca5a5" }}>{TL(v.sgk_isci+v.issizlik_isci)}</div><div style={{ fontSize:"9px", opacity:0.5, marginTop:"2px" }}>%14 + %1 = %15</div></div>
                            <div><div style={{ opacity:0.7 }}>Gelir+Damga Vrg.</div><div style={{ fontWeight:700, color:"#fca5a5" }}>{TL(v.gelir_vergisi+v.damga_vergisi)}</div><div style={{ fontSize:"9px", opacity:0.5, marginTop:"2px" }}>dilimli + %0.759</div></div>
                            <div><div style={{ opacity:0.7 }}>SGK+İşsizlik İşv.</div><div style={{ fontWeight:700, color:"#fcd34d" }}>{TL(v.sgk_isveren+v.issizlik_isveren)}</div><div style={{ fontSize:"9px", opacity:0.5, marginTop:"2px" }}>%20.5 + %2 = %22.5</div></div>
                          </div>
                        )}
                        {v && (
                          <div style={{ background:"#0f2444", color:"#fff", padding:"6px 16px", fontSize:"11px", display:"flex", justifyContent:"space-between" }}>
                            <span>Devlet ödemesi: <b style={{color:"#a78bfa"}}>{TL(v.toplam_devlet)}</b></span>
                            <span>İşveren maliyeti: <b style={{color:"#60a5fa"}}>{TL(v.toplam_isveren_maliyet)}</b></span>
                            {elden>0 && <span>Elden (vergisiz): <b style={{color:"#9ca3af"}}>{TL(elden)}</b></span>}
                            <span>NAKİT ÇIKIŞI: <b style={{color:"#86efac"}}>{TL(v.toplam_isveren_maliyet+elden)}</b></span>
                          </div>
                        )}
                      </div>
                    );
                  });
                  return (
                    <div style={{ display:"grid", gap:"8px" }}>
                      {odemeKartlari}
                      {/* Kümülatif özet */}
                      <div style={{ background:"linear-gradient(135deg,#1e3a5f,#1d4ed8)", color:"#fff", borderRadius:"12px", padding:"14px 16px" }}>
                        <div style={{ fontWeight:700, fontSize:"13px", marginBottom:"10px", opacity:0.8 }}>📊 Toplam Maliyet Özeti</div>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"8px" }}>
                          {[
                            ["Net Bankadan Ödenen", TL(kumBankadan), "#86efac"],
                            ["Net Elden Ödenen (vergisiz)", TL(kumElden), "#d1d5db"],
                            ["Toplam Devlet Ödemesi", TL(kumDevlet), "#c4b5fd"],
                            ["Toplam İşveren Maliyeti", TL(kumIsverenMaliyet), "#93c5fd"],
                          ].map(([l,v,c])=>(
                            <div key={l} style={{ background:"rgba(255,255,255,0.08)", borderRadius:"8px", padding:"8px 12px" }}>
                              <div style={{ fontSize:"10px", opacity:0.7 }}>{l}</div>
                              <div style={{ fontSize:"16px", fontWeight:800, color:c }}>{v}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop:"10px", background:"rgba(255,255,255,0.12)", borderRadius:"8px", padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <span style={{ fontWeight:700, fontSize:"13px" }}>TOPLAM NAKİT ÇIKIŞI</span>
                          <span style={{ fontWeight:800, fontSize:"20px", color:"#86efac" }}>{TL(kumToplamHazine)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()
            }
          </div>
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
            {/* Puantaj personel filtresi */}
            <div style={{ position:"relative", minWidth:"180px" }}>
              <input
                type="text"
                placeholder="🔍 Personel ara..."
                value={hrSearchText}
                autoComplete="off"
                onFocus={()=>setHrSearchOpen(true)}
                onBlur={()=>setTimeout(()=>setHrSearchOpen(false),150)}
                onChange={e=>{ setHrSearchText(e.target.value); setHrSearchOpen(true); if(!e.target.value){ setHrPersonelFilter(""); } }}
                style={{ padding:"8px 10px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"13px", width:"100%", boxSizing:"border-box" }}
              />
              {hrSearchOpen && (
                <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, right:0, background:"#fff", border:"1.5px solid #e5e7eb", borderRadius:"8px", boxShadow:"0 4px 16px rgba(0,0,0,0.12)", zIndex:999, maxHeight:"220px", overflowY:"auto" }}>
                  <div onMouseDown={()=>{ setHrPersonelFilter(""); setHrSearchText(""); setHrSearchOpen(false); }}
                    style={{ padding:"8px 12px", fontSize:"13px", color:"#6b7280", cursor:"pointer", borderBottom:"1px solid #f3f4f6" }}
                    onMouseEnter={e=>e.currentTarget.style.background="#f9fafb"}
                    onMouseLeave={e=>e.currentTarget.style.background=""}>
                    👥 Tüm Personel
                  </div>
                  {personelList.filter(p=>p.aktif && (!hrSearchText || p.ad_soyad.toLowerCase().includes(hrSearchText.toLowerCase()))).map(p=>(
                    <div key={p.id} onMouseDown={()=>{ setHrPersonelFilter(String(p.id)); setHrSearchText(p.ad_soyad); setHrSearchOpen(false); }}
                      style={{ padding:"8px 12px", fontSize:"13px", color:"#1f2937", cursor:"pointer", borderBottom:"1px solid #f9fafb" }}
                      onMouseEnter={e=>e.currentTarget.style.background="#eff6ff"}
                      onMouseLeave={e=>e.currentTarget.style.background=""}>
                      {p.ad_soyad}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ fontSize:"13px", color:"#6b7280" }}>Hücreye tıkla: ✅→❌→🏖→☪️→⭕→💤→🎌</div>
            <a href={`${API_BASE}/hr/excel/puantaj?ay=${ayStr}&yil=${yilStr}${hrPersonelFilter ? `&personel_id=${hrPersonelFilter}` : ""}`}
              style={{ padding:"8px 14px", background:"#166534", color:"#fff", borderRadius:"8px", fontSize:"13px", fontWeight:600, textDecoration:"none" }}>
              📥 Excel İndir
            </a>
          </div>

          {/* Legend */}
          <div style={{ display:"flex", gap:"10px", marginBottom:"16px", flexWrap:"wrap" }}>
            {DURUMLAR.map(d=><span key={d.key} style={{ fontSize:"13px" }}>{d.label} {d.name||d.key}</span>)}
            <span style={{ fontSize:"13px", color:"#7c3aed" }}>🟣 Pazar</span>
          </div>

          <div style={{ overflowX:"auto", borderRadius:"14px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
            <table style={{ borderCollapse:"collapse", width:"100%", background:"#fff", borderRadius:"14px", overflow:"hidden" }}>
              <thead>
                <tr style={{ background:"#f8fafc" }}>
                  <th style={{ padding:"10px 14px", textAlign:"left", fontSize:"13px", fontWeight:700, position:"sticky", left:0, background:"#f8fafc", zIndex:2, minWidth:"150px" }}>Personel</th>
                  {ayGunleri.map(g=>{
                    const d = new Date(Number(yilStr), Number(ayStr)-1, g).getDay();
                    const thDate2 = `${puantajAy}-${String(g).padStart(2,"0")}`;
                    const isResmiTatilHdr = TR_RESMI_TATIL_HR.includes(thDate2);
                    const thColor2 = isResmiTatilHdr ? "#1d4ed8" : d===0 ? "#7c3aed" : "#374151";
                    return (
                      <th key={g} style={{ padding:"4px 2px", fontSize:"11px", fontWeight:700, textAlign:"center", minWidth:"36px", width:"36px", color: thColor2 }}>
                        <div>{g}</div>
                        {d===0 && <div style={{ fontSize:"9px", fontWeight:500, lineHeight:1 }}>Paz</div>}
                        {d===6 && <div style={{ fontSize:"9px", fontWeight:500, lineHeight:1 }}>Cmt</div>}
                        {isResmiTatilHdr && d!==0 && <div style={{ fontSize:"8px", lineHeight:1 }}>🎌</div>}
                      </th>
                    );
                  })}
                  <th style={{ padding:"10px 8px", fontSize:"12px", fontWeight:700, minWidth:"80px" }}>Çalışılan</th>
                  <th style={{ padding:"10px 8px", fontSize:"12px", fontWeight:700, minWidth:"110px" }}>Hakediş</th>
                </tr>
              </thead>
              <tbody>
                {personelList.filter(p=>p.aktif && (!hrPersonelFilter || String(p.id)===String(hrPersonelFilter))).map((p,pi) => {
                  const calisilan = ayGunleri.filter(g => getPuantaj(p.id,g)?.durum==="CALISDI").length;
                  const gelmediCount = ayGunleri.filter(g => getPuantaj(p.id,g)?.durum==="GELMEDI").length;
                  const pazarCalisdiCount = ayGunleri.filter(g => {
                    const row = getPuantaj(p.id, g);
                    return row?.durum==="CALISDI" && new Date(Number(yilStr), Number(ayStr)-1, g).getDay()===0;
                  }).length;
                  const dr = (p.net_maas||0) / 26;
                  const hakedilen = Math.round((p.net_maas||0) - gelmediCount * dr + pazarCalisdiCount * dr * 1.5);
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
                        const dayW = new Date(Number(yilStr), Number(ayStr)-1, g).getDay();
                        const isResmiTatilCell2 = TR_RESMI_TATIL_HR.includes(tarih);
                        const defaultBg2 = dayW===0 ? "#ede9fe" : isResmiTatilCell2 ? "#dbeafe" : dayW===6 ? "#f8fafc" : "transparent";
                        const DURUM_BG = { CALISDI:"#dcfce7", GELMEDI:"#fee2e2", IZIN:"#dbeafe", RAPOR:"#fef3c7", DINLENME:"#f3e8ff", RESMI_TATIL:"#dbeafe" };
                        const cellBg = DURUM_BG[durum] || defaultBg2;
                        const hasNot = !!(row?.not_aciklama || row?.belge_yolu);
                        const showNot2 = durum !== "CALISDI" && durum !== "TATIL" && durum !== "RESMI_TATIL" && row?.id;
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
                {ozet.filter(o => !hrPersonelFilter || String(o.personel_id) === String(hrPersonelFilter)).map(o => {
                  const tooltipOzet = [
                    `Çalışılan: ${o.calisilan_gun} gün`,
                    `Gelmedi: ${o.gelmedi_gun||0} gün (kesinti: ₺${Math.round((o.gelmedi_gun||0)*(o.net_maas||0)/26).toLocaleString("tr-TR")})`,
                    `Pazar çalışılan: ${o.pazar_calisdi||0} gün (+₺${(o.pazar_bonus||0).toLocaleString("tr-TR")} prim)`,
                    `Net Maaş: ₺${Number(o.net_maas||0).toLocaleString("tr-TR")}`,
                    `Hakediş: ₺${o.hakedilen_maas.toLocaleString("tr-TR")}`,
                  ].join("\n");
                  return (
                    <div key={o.personel_id} style={{ background:"#fff", borderRadius:"12px", padding:"12px 18px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)", display:"grid", gridTemplateColumns:"1fr auto auto auto auto auto auto", gap:"12px", alignItems:"center" }}>
                      <div style={{ fontWeight:600 }}>{o.ad_soyad}</div>
                      <div style={{ fontSize:"12px", color:"#6b7280" }}>{o.calisilan_gun} çalışılan{o.gelmedi_gun > 0 && <span style={{ color:"#ef4444" }}> · {o.gelmedi_gun} gelmedi</span>}{o.pazar_calisdi > 0 && <span style={{ color:"#7c3aed" }}> · {o.pazar_calisdi} pazar</span>}</div>
                      <div title={tooltipOzet} style={{ fontSize:"13px", cursor:"help" }}>Hakediş: <b>₺{o.hakedilen_maas.toLocaleString("tr-TR")}</b>{o.pazar_bonus > 0 && <span style={{ color:"#7c3aed", fontSize:"11px" }}> (+₺{o.pazar_bonus.toLocaleString("tr-TR")} prim)</span>}</div>
                      <div style={{ fontSize:"13px", color:"#3b82f6" }}>Banka: ₺{o.bankadan.toLocaleString("tr-TR")}</div>
                      <div style={{ fontSize:"13px", color:"#f59e0b" }}>Elden: ₺{o.elden.toLocaleString("tr-TR")}</div>
                      <div style={{ fontSize:"13px", color: o.avans>0?"#ef4444":"#9ca3af" }}>Avans: ₺{o.avans.toLocaleString("tr-TR")}</div>
                      {o.dinlenme_bakiye > 0 && <div style={{ fontSize:"12px", background:"#f3e8ff", color:"#7c3aed", padding:"3px 8px", borderRadius:"8px", fontWeight:600 }}>💤 Bakiye: {o.dinlenme_bakiye}</div>}
                    </div>
                  );
                })}
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

      {/* ===== ISG / BELGELER SEKMESİ ===== */}
      {tab==="isg" && (
        <div>
          {/* ISG Uyarı Bandı */}
          {isgUyarilar.length > 0 && (
            <div style={{ background:"#fef2f2", border:"1.5px solid #fca5a5", borderRadius:"12px", padding:"12px 16px", marginBottom:"16px", display:"flex", gap:"12px", alignItems:"flex-start", flexWrap:"wrap" }}>
              <span style={{ fontWeight:700, color:"#991b1b", fontSize:"14px" }}>⚠️ ISG Eğitim Uyarısı:</span>
              {isgUyarilar.map((u,i) => (
                <span key={i} style={{ background:"#fee2e2", color:"#991b1b", borderRadius:"8px", padding:"3px 10px", fontSize:"13px" }}>
                  {u.ad_soyad} — {u.egitim_turu} ({u.durum})
                </span>
              ))}
            </div>
          )}

          {/* Personel Seçici */}
          <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"20px" }}>
            <h2 style={{ margin:0, fontSize:"20px" }}>🎓 ISG / Belgeler</h2>
            <select
              value={selectedPersonel?.id || ""}
              onChange={e => {
                const p = personelList.find(x => String(x.id) === e.target.value);
                if (p) loadPersonelDetail(p); else setSelectedPersonel(null);
              }}
              style={{ padding:"8px 12px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"14px", minWidth:"200px" }}
            >
              <option value="">— Personel Seç —</option>
              {personelList.filter(p=>p.aktif).map(p => <option key={p.id} value={p.id}>{p.ad_soyad}</option>)}
            </select>
          </div>

          {!selectedPersonel ? (
            <div style={{ ...secSt, textAlign:"center", color:"#9ca3af", padding:"40px" }}>
              Belgelerini ve ISG kayıtlarını görmek için yukarıdan personel seçin.
            </div>
          ) : (
            <div>
              <div style={{ fontWeight:700, fontSize:"16px", marginBottom:"16px" }}>
                👤 {selectedPersonel.ad_soyad}
                <span style={{ marginLeft:"10px", background: selectedPersonel.aktif?"#dcfce7":"#f3f4f6", color: selectedPersonel.aktif?"#166534":"#6b7280", padding:"3px 12px", borderRadius:"20px", fontSize:"12px", fontWeight:700 }}>
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
                            <a href={mevcut.dosya_yolu} target="_blank" rel="noreferrer"
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
                    <div style={{ display:"flex", gap:"8px" }}>
                      <button onClick={handleTumBelgeleriIndir}
                        style={{ fontSize:"12px", padding:"4px 10px", borderRadius:"8px", background:"#064e3b", color:"#fff", border:"none", cursor:"pointer" }}>
                        📦 Tüm Belgeleri İndir
                      </button>
                      <button className="tab" onClick={()=>setShowIsgForm(true)} style={{ fontSize:"12px" }}>+ Eğitim Ekle</button>
                    </div>
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
                      <div style={{ marginBottom:"10px" }}>
                        <label style={labelSt}>Eğitim Belgesi (opsiyonel)</label>
                        <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e=>setIsgBelgeDosya(e.target.files[0]||null)}
                          style={{ width:"100%", fontSize:"13px", padding:"6px", border:"1px dashed #d1d5db", borderRadius:"8px", background:"#fff", cursor:"pointer" }} />
                        {isgBelgeDosya && <div style={{ fontSize:"11px", color:"#059669", marginTop:"4px" }}>📎 {isgBelgeDosya.name}</div>}
                      </div>
                      <div style={{ display:"flex", gap:"8px" }}>
                        <button type="submit" className="saveButton" style={{ flex:1 }}>Kaydet</button>
                        <button type="button" className="tab" onClick={()=>{setShowIsgForm(false);setIsgBelgeDosya(null);}}>İptal</button>
                      </div>
                    </form>
                  )}
                  {personelIsg.length===0
                    ? <div style={{ color:"#9ca3af", fontSize:"13px" }}>Henüz eğitim girilmemiş</div>
                    : personelIsg.map(eg => {
                        const suresi = new Date(eg.bitis_tarihi) < new Date() ? "DOLDU" : new Date(eg.bitis_tarihi) < new Date(Date.now()+30*864e5) ? "YAKLASAN" : "OK";
                        return (
                          <div key={eg.id} style={{ borderRadius:"8px", marginBottom:"8px", background: suresi==="DOLDU"?"#fef2f2": suresi==="YAKLASAN"?"#fffbeb":"#f0fdf4", overflow:"hidden" }}>
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 10px" }}>
                              <div>
                                <div style={{ fontWeight:600, fontSize:"13px" }}>{eg.egitim_turu}</div>
                                <div style={{ fontSize:"11px", color:"#9ca3af" }}>
                                  {eg.egitim_tarihi?.split("T")[0]} → {eg.bitis_tarihi?.split("T")[0]}
                                  {suresi==="DOLDU" && <span style={{ color:"#dc2626", fontWeight:700 }}> ⚠️ SÜRESİ DOLDU</span>}
                                  {suresi==="YAKLASAN" && <span style={{ color:"#d97706", fontWeight:700 }}> ⚠️ YAKLAŞIYOR</span>}
                                </div>
                              </div>
                              <div style={{ display:"flex", gap:"6px", alignItems:"center" }}>
                                {eg.belge_yolu
                                  ? <a href={eg.belge_yolu} target="_blank" rel="noreferrer" style={{ background:"#dbeafe", color:"#1d4ed8", border:"none", borderRadius:"6px", padding:"4px 8px", fontSize:"12px", textDecoration:"none", whiteSpace:"nowrap" }}>📎 Belge</a>
                                  : <label style={{ background:"#e0e7ff", color:"#4338ca", border:"none", borderRadius:"6px", padding:"4px 8px", fontSize:"12px", cursor:"pointer", whiteSpace:"nowrap" }}>
                                      📎 Yükle
                                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display:"none" }}
                                        onChange={e=>{ const f=e.target.files[0]; if(f) handleIsgBelgeUpload(selectedPersonel.id, eg.id, f); }} />
                                    </label>
                                }
                                <button onClick={()=>handleDeleteIsg(eg.id)} style={{ background:"#fee2e2", color:"#991b1b", border:"none", borderRadius:"6px", padding:"4px 8px", fontSize:"12px", cursor:"pointer" }}>Sil</button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                  }
                </div>
              </div>
            </div>
          )}
        </div>
      )}

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
    try {
      const r = await fetch(`${API_BASE}/hr/masraf-form`);
      const data = await r.json();
      const safeData = Array.isArray(data) ? data : [];
      setList(safeData);
      if (onPendingCount) {
        let cnt = 0;
        if (isPM)       cnt = safeData.filter(f => f.durum === "PM_BEKLE").length;
        if (isDirektor) cnt = safeData.filter(f => f.durum === "DIREKTOR_BEKLE").length;
        if (isMuhasebe) cnt = safeData.filter(f => f.durum === "TAMAMLANDI").length;
        onPendingCount(cnt);
      }
    } catch (err) {
      console.error("Masraf form listesi yüklenemedi:", err);
    }
  };

  const loadDetail = async (id) => {
    try {
      const r = await fetch(`${API_BASE}/hr/masraf-form/${id}`);
      const data = await r.json();
      setViewForm(data);
    } catch (err) {
      console.error("Form detayı yüklenemedi:", err);
    }
  };

  const loadPersonel = async () => {
    try {
      const r = await fetch(`${API_BASE}/hr/personel`);
      const data = await r.json();
      const safeData = Array.isArray(data) ? data : [];
      setPersonelList(safeData);
      if (currentUser?.email) {
        const match = safeData.find(p => (p.email || "").toLowerCase() === currentUser.email.toLowerCase());
        if (match) {
          setNfPersonelId(String(match.id));
        } else if (currentUser?.name) {
          const nameMatch = safeData.find(p =>
            (p.ad_soyad || "").toLowerCase() === currentUser.name.toLowerCase()
          );
          if (nameMatch) setNfPersonelId(String(nameMatch.id));
        }
      }
    } catch (err) {
      console.error("Personel listesi yüklenemedi:", err);
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
      const controller = new AbortController();
      const uploadTimeout = setTimeout(() => controller.abort(), 60000);
      let r;
      try {
        r = await fetch(`${API_BASE}/hr/masraf-belge/${kalemId}`, { method:"POST", body:fd, signal: controller.signal });
      } finally {
        clearTimeout(uploadTimeout);
      }
      if (!r.ok) {
        const errText = await r.text().catch(() => "Sunucu hatası");
        throw new Error(errText);
      }
      belge = await r.json();
    } catch (err) {
      setIsUploading(false);
      if (err.name === "AbortError") {
        alert("Yükleme zaman aşımına uğradı. Sunucu meşgul olabilir, lütfen tekrar deneyin.");
      } else {
        alert("Fiş yüklenemedi: " + err.message);
      }
      return;
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
      setOcrResult({ ocr_tutar: ocrAmt, ocr_plaka, ocr_plaka_eslesti, belgeId: belge.id, hasTutarUyari: true });
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
    // Personel sadece kendi formlarını görür
    if (!isApprover && f.talep_eden_email !== currentUser?.email) return false;
    // Onaylayıcılar başkasının TASLAK'larını görmez ama KENDİ TASLAK'larını görebilir
    if (isApprover && f.durum === "TASLAK" && f.talep_eden_email !== currentUser?.email) return false;
    if (filterDurum && f.durum !== filterDurum) return false;
    return true;
  });

  const totalKalem = kalemler.reduce((s,k)=>s+Number(k.tutar),0);
  const cardSt = { background:"#fff", borderRadius:"16px", boxShadow:"0 4px 20px rgba(0,0,0,0.07)", border:"1px solid #f3f4f6", padding:"24px" };

  // Tutar farkı kontrolü: OCR tutarı ile girilen tutar arasında %5 veya ₺10'dan fazla fark var mı?
  const tutarFarkiVar = (k) => {
    if (!k.belgeler?.length) return null;
    for (const b of k.belgeler) {
      if (!b.ocr_tutar) continue;
      const ocr = Number(b.ocr_tutar);
      const giris = Number(k.tutar);
      if (Math.abs(ocr - giris) > Math.max(giris * 0.05, 10)) return ocr;
    }
    return null;
  };

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
      <div style={{ maxWidth:"1400px", margin:"24px auto" }}>
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
                const ocrFark = tutarFarkiVar(k);
                const rowBg = ocrFark ? "#fef2f2" : !k.fis_var ? "#fff7ed" : i%2===0 ? "#fff" : "#fafafa";
                return (
                  <tr key={k.id} style={{ background: rowBg, borderBottom:"1px solid #f3f4f6", borderLeft: ocrFark ? "4px solid #dc2626" : "4px solid transparent" }}>
                    <td style={{ padding:"10px 12px" }}>{kat?.label||k.kategori}</td>
                    <td style={{ padding:"10px 12px", whiteSpace:"nowrap" }}>{k.tarih ? new Date(k.tarih).toLocaleDateString("tr-TR") : ""}</td>
                    <td style={{ padding:"10px 12px" }}>{k.belge_no||"—"}</td>
                    <td style={{ padding:"10px 12px" }}>{k.aciklama||k.belge_aciklama||"—"}{!k.fis_var&&<div style={{ fontSize:"11px",color:"#dc2626" }}>Fişsiz: {k.fis_olmadan_aciklama}</div>}</td>
                    <td style={{ padding:"10px 12px", fontWeight:700 }}>
                      ₺{Number(k.tutar).toLocaleString("tr-TR")}
                      {ocrFark && (
                        <div style={{ marginTop:"4px", background:"#dc2626", color:"#fff", borderRadius:"5px", padding:"2px 7px", fontSize:"10px", fontWeight:700, display:"inline-block" }}>
                          ⚠ Fiş: ₺{Number(ocrFark).toLocaleString("tr-TR")}
                        </div>
                      )}
                      {ocrFark && k.tutar_uyari_aciklama && (
                        <div style={{ fontSize:"10px", color:"#dc2626", marginTop:"2px", fontStyle:"italic" }}>"{k.tutar_uyari_aciklama}"</div>
                      )}
                    </td>
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
      <div style={{ maxWidth:"1400px", margin:"0 auto", padding:"16px" }}>
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
                  {katKalemler.map(k=>{
                    const ocrFarkM = tutarFarkiVar(k);
                    return (
                    <div key={k.id} style={{ padding:"10px 14px", borderBottom:"1px solid #f3f4f6", background: ocrFarkM ? "#fef2f2" : "#fff", borderLeft: ocrFarkM ? "3px solid #dc2626" : "3px solid transparent" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"4px" }}>
                        <div style={{ fontSize:"12px", color:"#6b7280" }}>{k.tarih ? new Date(k.tarih).toLocaleDateString("tr-TR"):""}{k.belge_no ? ` · #${k.belge_no}`:""}</div>
                        <div style={{ textAlign:"right" }}>
                          <div style={{ fontWeight:800, fontSize:"14px", color:"#1e3a5f" }}>₺{Number(k.tutar).toLocaleString("tr-TR")}</div>
                          {ocrFarkM && <div style={{ background:"#dc2626", color:"#fff", borderRadius:"4px", padding:"1px 6px", fontSize:"10px", fontWeight:700, marginTop:"2px" }}>⚠ Fiş: ₺{Number(ocrFarkM).toLocaleString("tr-TR")}</div>}
                        </div>
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
                    );
                  })}
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
                {katKalemler.map((k,i)=>{
                  const ocrFarkD = tutarFarkiVar(k);
                  return (
                  <div key={k.id} style={{ display:"grid", gridTemplateColumns:"108px 80px 180px 1fr 100px 72px", background: ocrFarkD ? "#fef2f2" : i%2===0?"#fff":"#f9fafb", borderBottom:"1px solid #f3f4f6", alignItems:"start", borderLeft: ocrFarkD ? "3px solid #dc2626" : "3px solid transparent" }}>
                    <div style={{ padding:"8px 8px", fontSize:"12px", color:"#374151" }}>{k.tarih ? new Date(k.tarih).toLocaleDateString("tr-TR"):""}</div>
                    <div style={{ padding:"8px 8px", fontSize:"12px", color:"#6b7280" }}>{k.belge_no||"—"}</div>
                    <div style={{ padding:"8px 8px", fontSize:"12px", color:"#374151" }}>{k.belge_aciklama||"—"}</div>
                    <div style={{ padding:"8px 8px", fontSize:"12px", color:"#374151" }}>
                      {k.aciklama||"—"}
                      {!k.fis_var && <div style={{ fontSize:"10px",color:"#dc2626",marginTop:"2px" }}>⚠ Fişsiz: {k.fis_olmadan_aciklama}</div>}
                      {(k.belgeler||[]).length>0 && <div style={{ fontSize:"10px",color:"#059669",marginTop:"2px" }}>📷 {k.belgeler.length} fiş</div>}
                    </div>
                    <div style={{ padding:"8px 8px", fontWeight:700, fontSize:"12px", textAlign:"right" }}>
                      ₺{Number(k.tutar).toLocaleString("tr-TR")}
                      {ocrFarkD && (
                        <div style={{ marginTop:"3px", background:"#dc2626", color:"#fff", borderRadius:"4px", padding:"1px 5px", fontSize:"9px", fontWeight:700 }}>
                          ⚠ Fiş: ₺{Number(ocrFarkD).toLocaleString("tr-TR")}
                        </div>
                      )}
                    </div>
                    <div style={{ padding:"6px 6px", display:"flex", gap:"3px", justifyContent:"center" }}>
                      <button onClick={()=>{ setExtraFotoModal(k.id); setUploadFile(null); }} title="Fiş fotoğrafı ekle"
                        style={{ padding:"4px 7px", background:"#eff6ff", color:"#1d4ed8", border:"none", borderRadius:"5px", fontSize:"12px", cursor:"pointer" }}>📷</button>
                      {!isLocked && <button onClick={()=>handleDeleteKalem(k.id)} title="Sil"
                        style={{ padding:"4px 7px", background:"#fee2e2", color:"#991b1b", border:"none", borderRadius:"5px", fontSize:"12px", cursor:"pointer" }}>✕</button>}
                    </div>
                  </div>
                  );
                })}
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
            <button onClick={()=>{
                setActiveForm(null);
                setKalemler([]);
                load(); // listeyi arka planda yenile
              }}
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
          const showTutarUyari = ocrResult?.hasTutarUyari && !ocrResult.tutarOk && !ocrResult.tutarSkipped;
          const showPlakaUyari = ocrResult && (ocrResult.tutarOk || ocrResult.tutarSkipped || !showTutarUyari) && ocrResult.ocr_plaka && ocrResult.ocr_plaka_eslesti === false && !ocrResult.plakaOnaylandi;

          if (showPlakaUyari) return (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
              <div style={{ background:"#fff", borderRadius:"16px", padding:"28px 24px", width:"90%", maxWidth:"420px", border:"3px solid #dc2626" }}>
                <div style={{ textAlign:"center", marginBottom:"16px" }}>
                  <div style={{ fontSize:"48px", marginBottom:"8px" }}>🚫</div>
                  <h3 style={{ margin:0, fontSize:"20px", color:"#dc2626", fontWeight:800 }}>Fiş Kabul Edilmedi</h3>
                </div>
                <div style={{ background:"#fef2f2", border:"1px solid #fecaca", borderRadius:"10px", padding:"14px 16px", marginBottom:"16px" }}>
                  <div style={{ fontSize:"13px", color:"#374151", marginBottom:"6px" }}>
                    Girilen plaka: <strong style={{ color:"#1e3a5f" }}>{kalemForm.aciklama || "—"}</strong>
                  </div>
                  <div style={{ fontSize:"13px", color:"#374151" }}>
                    Fişte okunan plaka: <strong style={{ color:"#dc2626" }}>{ocrResult.ocr_plaka}</strong>
                  </div>
                </div>
                <p style={{ fontSize:"13px", color:"#6b7280", margin:"0 0 20px", lineHeight:"1.5" }}>
                  Araç yakıt / bakım fişlerinde plaka bilgisi girilene ait olmalıdır. Lütfen doğru fişi yükleyin veya plaka bilgisini kontrol edin.
                </p>
                <button
                  onClick={async () => {
                    // Yüklenen belgeyi sil
                    if (ocrResult?.belgeId) {
                      await fetch(`${API_BASE}/hr/masraf-belge/${ocrResult.belgeId}`, { method:"DELETE" }).catch(()=>{});
                    }
                    closeFotoModal();
                    refreshActive(activeForm.id);
                  }}
                  style={{ width:"100%", padding:"13px", background:"#dc2626", color:"#fff", border:"none", borderRadius:"10px", fontWeight:700, fontSize:"15px", cursor:"pointer" }}>
                  Tamam — Fişi Sil ve Geri Dön
                </button>
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
                    <div style={{ background:"#f9fafb", borderRadius:"8px", padding:"8px", overflow:"auto", maxHeight:"55vh" }}>
                      <ReactCrop crop={crop} onChange={c => setCrop(c)} onComplete={c => setCompletedCrop(c)} style={{ width:"100%" }}>
                        <img ref={cropImgRef} src={cropSrc} alt="fiş" style={{ width:"100%", height:"auto", display:"block", maxHeight:"55vh", objectFit:"contain" }}
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
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px", position:"sticky", bottom:0, background:"#fff", paddingTop:"12px", marginTop:"4px" }}>
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
              <h3 style={{ margin:"0 0 8px" }}>📷 Ek Fiş Fotoğrafı</h3>
              <p style={{ fontSize:"12px", color:"#6b7280", margin:"0 0 14px" }}>Dosyadan seçin veya kameradan çekin</p>
              <div style={{ display:"flex", gap:"8px", marginBottom:"16px" }}>
                <label style={{ flex:1, padding:"12px", background:"#f0f9ff", color:"#1d4ed8", border:"1.5px solid #bfdbfe", borderRadius:"10px", fontWeight:600, fontSize:"14px", cursor:"pointer", textAlign:"center" }}>
                  🗂 Dosyadan Seç
                  <input key={`file-${extraFotoModal}`} type="file" accept="image/*,application/pdf"
                    style={{ display:"none" }}
                    onChange={e=>{ const f=e.target.files[0]; if(f) setUploadFile(f); e.target.value=""; }} />
                </label>
                <label style={{ flex:1, padding:"12px", background:"#f0fdf4", color:"#166534", border:"1.5px solid #bbf7d0", borderRadius:"10px", fontWeight:600, fontSize:"14px", cursor:"pointer", textAlign:"center" }}>
                  📷 Kamera
                  <input key={`cam-${extraFotoModal}`} type="file" accept="image/*" capture="environment"
                    style={{ display:"none" }}
                    onChange={e=>{ const f=e.target.files[0]; if(f) setUploadFile(f); e.target.value=""; }} />
                </label>
              </div>
              {uploadFile && <p style={{ fontSize:"13px", color:"#374151", margin:"0 0 12px", background:"#f0fdf4", padding:"8px 12px", borderRadius:"8px" }}>✅ Seçilen: {uploadFile.name}</p>}
              <div style={{ display:"flex", gap:"8px" }}>
                <button onClick={async()=>{
                  if(!uploadFile){ alert("Lütfen bir dosya seçin"); return; }
                  try {
                    const fd=new FormData(); fd.append("dosya",uploadFile);
                    const res = await fetch(`${API_BASE}/hr/masraf-belge/${extraFotoModal}`,{method:"POST",body:fd});
                    if(!res.ok) throw new Error("Yükleme başarısız");
                    setExtraFotoModal(null); setUploadFile(null);
                    refreshActive(activeForm.id);
                  } catch(err){ alert("Fiş yüklenemedi: " + err.message); }
                }}
                  style={{ flex:1, padding:"12px", background:"#1e3a5f", color:"#fff", border:"none", borderRadius:"10px", fontWeight:700, cursor:"pointer" }}>
                  ⬆️ Yükle
                </button>
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
    <div style={{ maxWidth:"1400px", margin:"24px auto" }}>
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
    <div style={{ maxWidth: "1400px", margin: "24px auto" }}>
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
      return Number(row.done_qty || 0) === 0 && Number(row.requested_qty || 0) > 0;
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

      // Başlık "Bölge - Tip" formatındaysa bölgeyi al, değilse boş bırak
      const regionName = String(detailTitle || "").includes(" - ")
        ? String(detailTitle || "").split(" - ")[0].trim()
        : "";
      const exportType = detailTitle.includes("Faturalanmamış")
        ? "NOT_INVOICED"
        : detailTitle.includes("İptal")
        ? "PO_IPTAL"
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

  const handleExportRegionExcel = () => {
    try {
      // Analiz değerini hesapla (tabloda görünen mantıkla aynı)
      const getAnaliz = (row) => {
        if (row.status === "PO_BEKLER") return "Eksik";
        if (Number(row.done_qty || 0) === 0) return "Giriş Yok";
        if (Number(row.done_qty || 0) === Number(row.requested_qty || 0)) return "Tamam";
        if (Number(row.done_qty || 0) > Number(row.requested_qty || 0)) return "Fazla";
        return "Eksik";
      };

      // sortedRows zaten filtreli — filtreyi yansıtır
      const data = sortedRows.map((row) => ({
        "Bölge":           getRegion(row.site_code, row.project_code),
        "Status":          row.status || "",
        "Analiz":          getAnaliz(row),
        "Project":         row.project_code || "",
        "Site Code":       row.site_code || "",
        "Item Description": row.item_description || "",
        "Item Code":       row.item_code || "",
        "OnAir Date":      row.onair_date || "",
        "Done Qty":        Number(row.done_qty || 0),
        "Requested Qty":   Number(row.requested_qty || 0),
        "Billed Qty":      Number(row.billed_qty || 0),
        "Currency":        row.currency || "",
        "Unit Price":      Number(row.unit_price || 0),
        "Şimşek Toplam Hakedis": Number(row.total_done_amount || 0),
        "Taşeron":         row.subcon_name || "",
      }));

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Region Analysis");

      // Sütun genişlikleri
      ws["!cols"] = [
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 22 },
        { wch: 45 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 14 },
        { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 18 },
      ];

      const dateStr = new Date().toISOString().slice(0, 10);
      const searchSuffix = regionSearch.trim() ? `-${regionSearch.trim().replace(/[^a-zA-Z0-9_]/g,"_")}` : "";
      XLSX.writeFile(wb, `region_analysis_${dateStr}${searchSuffix}.xlsx`);
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
                  {rows.filter(r => Number(r.done_qty||0) === 0 && Number(r.requested_qty||0) > 0).length} kalem →
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
                          PAC OK Fatura Bekler 20%
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
                          PAC NOK Fatura Bekler 20%
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


// ─── MALZEME YÖNETİMİ PANELİ ─────────────────────────────────────────────────
/* ============================================================
   NAKIT AKIŞ / CASH FLOW PANEL
   ============================================================ */
function CashFlowPanel({ currentUser, onBack }) {
  const token = localStorage.getItem("finance_token") || localStorage.getItem("token") || "";
  const headers = { Authorization: `Bearer ${token}` };

  const now = new Date();
  const [yil, setYil] = useState(String(now.getFullYear()));
  const [ay, setAy]   = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [hwReceived,  setHwReceived]  = useState({});  // gun→tutar (alınan)
  const [hwPending,   setHwPending]   = useState({});  // gun→tutar (bekleyen)
  const [hwDeduct,    setHwDeduct]    = useState({});  // gun→tutar (H01 kesinti)
  const [personelList,setPersonelList]= useState([]);
  const [araclar,     setAraclar]     = useState([]);
  const [ofisList,    setOfisList]    = useState([]);
  const [sarkanlar,   setSarkanlar]   = useState([]); // önceki aylardan sarkan ödemeler
  const [prevOzet,    setPrevOzet]    = useState([]); // önceki ay puantaj özeti (maaş hesabı için)
  const [taseronByDay,setTaseronByDay]= useState({}); // gun→toplam taşeron ödemesi
  const [taseronDet,  setTaseronDet]  = useState({}); // gun→[{firma,tutar,fatura_no}]
  const [taseronModal,setTaseronModal]= useState(null); // {gun, items, rect}
  const [loading,     setLoading]     = useState(false);

  const AY_ADLARI = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];

  useEffect(() => { loadData(); }, [ay, yil]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Önceki ayı hesapla (maaş tahakkuku önceki aya ait)
      const prevDate = new Date(Number(yil), Number(ay) - 2, 1);
      const prevYil  = String(prevDate.getFullYear());
      const prevAy   = String(prevDate.getMonth() + 1).padStart(2, "0");

      const [cfRes, perRes, aracRes, ofisRes, sarkanRes, prevOzetRes, taseronRes] = await Promise.all([
        fetch(`${API_BASE}/finance/cashflow-monthly?yil=${yil}&ay=${ay}`, { headers }),
        fetch(`${API_BASE}/hr/personel`, { headers }),
        fetch(`${API_BASE}/hr/araclar`, { headers }),
        fetch(`${API_BASE}/hr/ofis`, { headers }),
        fetch(`${API_BASE}/finance/sarkan-odemeler`, { headers }),
        fetch(`${API_BASE}/hr/puantaj/ozet?yil=${prevYil}&ay=${prevAy}`, { headers }),
        fetch(`${API_BASE}/finance/taseron-cashflow?yil=${yil}&ay=${ay}`, { headers }),
      ]);
      const cfData      = await cfRes.json();
      const perData     = await perRes.json();
      const aracData    = await aracRes.json();
      const ofisData    = await ofisRes.json();
      const sarkanData  = await sarkanRes.json();
      const prevOzetData= await prevOzetRes.json();
      const taseronData = await taseronRes.json();

      const toMap = (rows) => (rows||[]).reduce((m,r) => { m[r.gun]=(m[r.gun]||0)+Number(r.tutar||0); return m; }, {});
      setHwReceived(toMap(cfData.received));
      setHwPending(toMap(cfData.pending));
      setHwDeduct(toMap(cfData.deductions));
      setPersonelList(Array.isArray(perData) ? perData.filter(p => p.aktif) : []);
      setAraclar(Array.isArray(aracData) ? aracData.filter(a => a.durum === "AKTİF") : []);
      setOfisList(Array.isArray(ofisData?.rows) ? ofisData.rows : Array.isArray(ofisData) ? ofisData : []);
      setSarkanlar(Array.isArray(sarkanData) ? sarkanData : []);
      setPrevOzet(Array.isArray(prevOzetData) ? prevOzetData : []);
      setTaseronByDay(taseronData?.byDay || {});
      setTaseronDet(taseronData?.details || {});
    } catch(e) { console.error("CashFlow load error:", e); }
    setLoading(false);
  };

  const totalDays  = new Date(Number(yil), Number(ay), 0).getDate();
  const days       = Array.from({ length: totalDays }, (_, i) => i + 1);
  const getDayName = d => ["Paz","Pzt","Sal","Çar","Per","Cum","Cmt"][new Date(Number(yil), Number(ay)-1, d).getDay()];
  const isWeekend  = d => { const wd = new Date(Number(yil), Number(ay)-1, d).getDay(); return wd===0||wd===6; };

  // Önceki ay bilgileri (label'larda göstermek için)
  const prevDate2  = new Date(Number(yil), Number(ay) - 2, 1);
  const prevAyAdi  = AY_ADLARI[prevDate2.getMonth()];

  // Gider hesapları — maaş: önceki ayın hakedilen toplamı (tahakkuk esası)
  const prevMaasHakedilen = prevOzet.reduce((s,o) => s + Number(o.hakedilen_maas||0), 0);
  const totalMaas   = prevMaasHakedilen > 0
    ? prevMaasHakedilen
    : personelList.reduce((s,p) => s + Number(p.net_maas||0), 0); // fallback: puantaj yoksa net_maas
  const totalArac   = araclar.reduce((s,a) => s + Number(a.aylik_kira||0), 0);
  const totalTicket = personelList.length * 10000;
  const totalOfis   = ofisList.reduce((s,o) => s + Number(o.aylik_kira||0), 0);

  // ── Gecikmiş ödeme tespiti ──────────────────────────────────────
  const today       = new Date();
  const todayGun    = today.getDate();
  const todayYil    = today.getFullYear();
  const todayAy     = today.getMonth() + 1;
  const selYil      = Number(yil);
  const selAy       = Number(ay);
  const isPastMonth = selYil < todayYil || (selYil === todayYil && selAy < todayAy);
  const isCurrMonth = selYil === todayYil && selAy === todayAy;
  // Ödeme günü geçmiş mi?
  const paymentOverdue = (payDay) => isPastMonth || (isCurrMonth && todayGun > payDay);

  // Maaş gecikmesi: ödeme günü geçmiş VE maaş tutarı > 0 (sarkanlar'dan bağımsız)
  const maasOverdue = totalMaas > 0 && paymentOverdue(15);

  // ── Spillover (önceki aydan sarkan) ─────────────────────────────
  const totalSarkan  = sarkanlar.reduce((s,r) => s + Number(r.sarkan||0), 0);
  const hwDaysAll    = [...Object.keys(hwReceived), ...Object.keys(hwPending)]
                         .map(Number).filter(n => !isNaN(n) && n > 0);
  const firstHWDay   = hwDaysAll.length > 0 ? Math.min(...hwDaysAll) : null;

  // Kategoriler
  const hwDeductAbs = Object.fromEntries(Object.entries(hwDeduct).map(([k,v])=>[k,Math.abs(v)]));
  const KATEGORILER = [
    { key:"hw_received", label:"📥 HW Tahsilat (Alınan)",               type:"income",  color:"#bbf7d0", textColor:"#14532d", byDay: hwReceived },
    { key:"hw_pending",  label:"⏳ HW Tahsilat (Bekleyen)",              type:"income",  color:"#dcfce7", textColor:"#166534", byDay: hwPending  },
    { key:"hw_deduct",   label:"↩️ İade Kesinti (H01)",                  type:"expense", color:"#fee2e2", textColor:"#991b1b", byDay: hwDeductAbs },
    { key:"maas",        label:`👥 ${prevAyAdi} Maaşları`,               type:"expense", color:"#fecaca", textColor:"#7f1d1d", byDay: totalMaas>0   ? {15: totalMaas}   : {}, note: `${prevAyAdi} ayı hakedilen · Ödeme: 15. gün`, overdue: maasOverdue },
    { key:"arac",        label:`🚗 ${prevAyAdi} Araç Kiraları`,           type:"expense", color:"#fef3c7", textColor:"#92400e", byDay: totalArac>0   ? {10: totalArac}   : {}, note: `${prevAyAdi} kirası · Ödeme: 10. gün`,          overdue: totalArac>0 && paymentOverdue(10) },
    { key:"ticket",      label:"🎫 Ticket'lar",                           type:"expense", color:"#f3e8ff", textColor:"#6b21a8", byDay: totalTicket>0 ? {5:  totalTicket} : {}, note: `${personelList.length} kişi × ₺10.000 · 5. gün`, overdue: totalTicket>0 && paymentOverdue(5) },
    { key:"ofis",        label:`🏢 ${prevAyAdi} Depo & Ofis Kirası`,      type:"expense", color:"#fff7ed", textColor:"#9a3412", byDay: totalOfis>0   ? {5:  totalOfis}   : {}, note: `${prevAyAdi} kirası · Ödeme: 5. gün`,           overdue: totalOfis>0 && paymentOverdue(5) },
    ...(totalSarkan > 0 && firstHWDay ? [{
      key:"spillover",
      label:"⚠️ Önceki Ay Borcu",
      type:"expense",
      color:"#fff7ed",
      textColor:"#c2410c",
      byDay: { [firstHWDay]: totalSarkan },
      note: `${sarkanlar.length} aydan sarkan · HW geliri ile ödenmeli (${firstHWDay}. gün)`,
      overdue: true,
    }] : []),
    { key:"taseron",     label:"🔧 Taşeron Ödemeleri",                    type:"expense", color:"#fdf4ff", textColor:"#7e22ce", byDay: taseronByDay, isTaseron: true },
    { key:"diger",       label:"📋 Diğer Giderler",                       type:"expense", color:"#f1f5f9", textColor:"#475569", byDay: {} },
  ];

  // Günlük net ve kümülatif bakiye
  const dailyNet = {};
  days.forEach(d => {
    let net = 0;
    KATEGORILER.forEach(k => { const a = k.byDay[d]||0; net += k.type==="income" ? a : -a; });
    dailyNet[d] = net;
  });
  let cum = 0;
  const cumByDay = {};
  days.forEach(d => { cum += dailyNet[d]||0; cumByDay[d] = cum; });

  const totalGelir  = KATEGORILER.filter(k=>k.type==="income" ).reduce((s,k)=>s+Object.values(k.byDay).reduce((a,b)=>a+b,0),0);
  const totalGider  = KATEGORILER.filter(k=>k.type==="expense").reduce((s,k)=>s+Object.values(k.byDay).reduce((a,b)=>a+b,0),0);
  const netBakiye   = totalGelir - totalGider;

  const fmt = v => v===0 ? "" : Number(v).toLocaleString("tr-TR",{maximumFractionDigits:0});
  const fmtFull = v => `₺${Math.abs(v).toLocaleString("tr-TR",{maximumFractionDigits:0})}`;

  const thSt  = { padding:"6px 4px", fontSize:"11px", fontWeight:700, textAlign:"center", whiteSpace:"nowrap", background:"#1e3a5f", color:"#fff", position:"sticky", top:0, zIndex:2 };
  const tdSt  = { padding:"5px 4px", fontSize:"11px", textAlign:"center", whiteSpace:"nowrap", minWidth:"44px" };
  const rowLbl= { padding:"8px 14px", fontSize:"12px", fontWeight:700, whiteSpace:"nowrap", position:"sticky", left:0, zIndex:1, minWidth:"180px" };

  // ─── Excel Export ───────────────────────────────────────────────
  const handleExcelIndir = async () => {
    const XS = await import("xlsx-js-style");
    const JSZip = (await import("jszip")).default;
    const ayAdi = AY_ADLARI[Number(ay)-1];
    const wb = XS.utils.book_new();
    const rows = [];

    // Hücre stilleri
    const navy   = "1E3A5F";
    const darkNy = "0F172A";
    const wkEnd  = "2563EB";
    const hdrS   = (bg=navy) => ({ fill:{patternType:"solid",fgColor:{rgb:bg}}, font:{bold:true,color:{rgb:"FFFFFF"},sz:12,name:"Calibri"}, alignment:{horizontal:"center",vertical:"center",wrapText:true}, border:{top:{style:"thin",color:{rgb:"FFFFFF"}},bottom:{style:"thin",color:{rgb:"FFFFFF"}},left:{style:"thin",color:{rgb:"334D6E"}},right:{style:"thin",color:{rgb:"334D6E"}}} });
    const cellS  = (bg, tc="111827", bold=false) => ({ fill:{patternType:"solid",fgColor:{rgb:bg}}, font:{sz:12,name:"Calibri",bold,color:{rgb:tc.replace("#","")}}, alignment:{horizontal:"right",vertical:"center"}, border:{top:{style:"thin",color:{rgb:"E5E7EB"}},bottom:{style:"thin",color:{rgb:"E5E7EB"}},left:{style:"thin",color:{rgb:"E5E7EB"}},right:{style:"thin",color:{rgb:"E5E7EB"}}} });
    const lblS   = (bg, tc="1E3A5F", bold=true) => ({ fill:{patternType:"solid",fgColor:{rgb:bg}}, font:{sz:12,name:"Calibri",bold,color:{rgb:tc.replace("#","")}}, alignment:{horizontal:"left",vertical:"center"}, border:{top:{style:"thin",color:{rgb:"E5E7EB"}},bottom:{style:"thin",color:{rgb:"E5E7EB"}},left:{style:"thin",color:{rgb:"E5E7EB"}},right:{style:"thin",color:{rgb:"E5E7EB"}}} });

    // hex renk haritası (ABGR → RRGGBB)
    const hex = c => c.replace("#","").toUpperCase();

    // Başlık satırı: Kategori | gün 1..N | TOPLAM (sonda)
    const hdrRow = [
      { v:`${ayAdi} ${yil} — Nakit Akış`, s: hdrS(navy) },
      ...days.map(d => ({ v:`${d}\n${getDayName(d)}`, s: hdrS(isWeekend(d)?wkEnd:navy) })),
      { v:"TOPLAM", s: hdrS("0F172A") },
    ];
    rows.push(hdrRow);

    // Kategori satırları
    const ROW_COLORS = {
      hw_received:["BBFCD0","14532D"], hw_pending:["DCFCE7","166534"],
      hw_deduct:  ["FEE2E2","991B1B"], maas:["FECACA","7F1D1D"],
      arac:       ["FEF3C7","92400E"], ticket:["F3E8FF","6B21A8"],
      ofis:       ["FFF7ED","9A3412"], spillover:["FECACA","DC2626"],
      taseron:    ["FDF4FF","7E22CE"], diger:["F1F5F9","475569"],
    };
    KATEGORILER.forEach((kat, ki) => {
      const [rowBg, rowTc] = kat.overdue
        ? ["FECACA","DC2626"]
        : (ROW_COLORS[kat.key] || ["F9FAFB","374151"]);
      const rowTotal = Object.values(kat.byDay).reduce((a,b)=>a+Number(b),0);
      const sign = kat.type==="income" ? "+" : "-";
      const zebra = ki%2===0 ? "FAFAFA":"FFFFFF";
      const dataRow = [
        { v: kat.label.replace(/[\u{1F300}-\u{1FFFF}]/gu,"").trim(), s: lblS(rowBg, rowTc) },
        ...days.map(d => {
          const val = kat.byDay[d]||0;
          const bg = val!==0 ? rowBg : (isWeekend(d)?"F8F9FE":zebra);
          return { v: val!==0 ? `${sign}₺${val.toLocaleString("tr-TR",{maximumFractionDigits:0})}` : "", s: cellS(bg, val!==0?rowTc:"9CA3AF") };
        }),
        { v: rowTotal!==0 ? `${sign}₺${rowTotal.toLocaleString("tr-TR",{maximumFractionDigits:0})}` : "—", s: cellS(rowBg, rowTc, true) },
      ];
      rows.push(dataRow);
    });

    // Günlük Net satırı
    const netRow = [
      { v:"📊 Günlük Net", s: lblS("DBEAFE","1E40AF") },
      ...days.map(d => {
        const n = dailyNet[d]||0;
        const bg = n>0?"DCFCE7":n<0?"FEE2E2":"F0F9FF";
        const tc = n>0?"166534":n<0?"DC2626":"1E40AF";
        return { v: n!==0 ? `${n>0?"+":""}₺${Math.abs(n).toLocaleString("tr-TR",{maximumFractionDigits:0})}` : "", s: cellS(bg,tc,true) };
      }),
      { v: `${netBakiye>=0?"+":"-"}₺${Math.abs(netBakiye).toLocaleString("tr-TR",{maximumFractionDigits:0})}`, s: cellS("DBEAFE", netBakiye>=0?"166534":"DC2626", true) },
    ];
    rows.push(netRow);

    // Kümülatif Bakiye satırı
    const cumRow = [
      { v:"💰 Kümülatif Bakiye", s: hdrS(darkNy) },
      ...days.map(d => {
        const c = cumByDay[d]||0;
        return { v: `₺${Math.abs(c).toLocaleString("tr-TR",{maximumFractionDigits:0})}`, s: hdrS(c>=0?"0F4C2A":"7F1D1D") };
      }),
      { v:`₺${Math.abs(netBakiye).toLocaleString("tr-TR",{maximumFractionDigits:0})}`, s: hdrS("0F172A") },
    ];
    rows.push(cumRow);

    const ws = XS.utils.aoa_to_sheet(rows.map(r => r.map(c => c.v)));
    // Stiller uygula
    rows.forEach((row, ri) => {
      row.forEach((cell, ci) => {
        const addr = XS.utils.encode_cell({r:ri, c:ci});
        if (!ws[addr]) ws[addr] = { v:cell.v };
        ws[addr].s = cell.s;
      });
    });

    // Sütun genişlikleri: Kategori | gün 1..N | TOPLAM
    ws["!cols"] = [{ wch:28 }, ...days.map(()=>({ wch:10 })), { wch:16 }];
    ws["!rows"] = [{ hpt:32 }, ...rows.slice(1).map(()=>({ hpt:20 }))];

    XS.utils.book_append_sheet(wb, ws, `${ayAdi} ${yil}`);

    // Gridlines kapat + freeze (1. satır + A sütunu)
    const freezePane = `<pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/><selection pane="bottomRight"/>`;
    const buf = XS.write(wb, { type:"array", bookType:"xlsx" });
    JSZip.loadAsync(buf).then(zip => {
      return zip.file("xl/worksheets/sheet1.xml").async("string").then(xml => {
        const patched = xml
          .replace('<sheetView workbookViewId="0"/>', `<sheetView showGridLines="0" workbookViewId="0">${freezePane}</sheetView>`)
          .replace('<sheetView tabSelected="1" workbookViewId="0"/>', `<sheetView showGridLines="0" tabSelected="1" workbookViewId="0">${freezePane}</sheetView>`);
        zip.file("xl/worksheets/sheet1.xml", patched);
        return zip.generateAsync({ type:"blob", compression:"STORE" });
      });
    }).then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `NakitAkis_${ayAdi}_${yil}.xlsx`;
      a.click(); URL.revokeObjectURL(url);
    });
  };

  return (
    <div style={{ padding:"24px", maxWidth:"100%" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:"14px", marginBottom:"20px", flexWrap:"wrap" }}>
        {onBack && <button onClick={onBack} style={{ background:"#f3f4f6", border:"none", borderRadius:"50%", width:"36px", height:"36px", fontSize:"18px", cursor:"pointer" }}>←</button>}
        <div>
          <h2 style={{ margin:0, fontSize:"22px", fontWeight:800, color:"#1e3a5f" }}>💵 Nakit Akış</h2>
          <p style={{ margin:"4px 0 0", fontSize:"13px", color:"#6b7280" }}>Aylık gelir & gider takvimi</p>
        </div>
        {/* Filtreler */}
        <div style={{ marginLeft:"auto", display:"flex", gap:"8px", alignItems:"center" }}>
          <select value={yil} onChange={e=>setYil(e.target.value)} style={{ padding:"8px 12px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"13px", fontWeight:600 }}>
            {[2024,2025,2026,2027].map(y=><option key={y} value={y}>{y}</option>)}
          </select>
          <select value={ay} onChange={e=>setAy(e.target.value)} style={{ padding:"8px 12px", border:"1.5px solid #e5e7eb", borderRadius:"8px", fontSize:"13px", fontWeight:600, minWidth:"100px" }}>
            {AY_ADLARI.map((a,i)=><option key={i} value={String(i+1).padStart(2,"0")}>{a}</option>)}
          </select>
          <button onClick={handleExcelIndir} style={{ padding:"8px 18px", background:"#166534", color:"#fff", border:"none", borderRadius:"8px", fontSize:"13px", fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:"6px" }}>
            📥 Excel İndir
          </button>
          {loading && <span style={{ fontSize:"12px", color:"#6b7280" }}>⏳ Yükleniyor...</span>}
        </div>
      </div>

      {/* Özet kartları */}
      <div style={{ display:"flex", gap:"12px", marginBottom:"20px", flexWrap:"wrap" }}>
        {[
          { label:"💰 Toplam Gelir",  val:totalGelir,  bg:"#dcfce7", tc:"#166534", border:"#86efac" },
          { label:"📤 Toplam Gider",  val:totalGider,  bg:"#fee2e2", tc:"#991b1b", border:"#fca5a5" },
          { label:"📊 Net Bakiye",    val:netBakiye,   bg: netBakiye>=0?"#eff6ff":"#fff5f5", tc: netBakiye>=0?"#1e40af":"#dc2626", border: netBakiye>=0?"#93c5fd":"#fca5a5" },
          { label:"👥 Aktif Personel",val:personelList.length, bg:"#f5f3ff", tc:"#6d28d9", border:"#c4b5fd", isCount:true },
          { label:"🎫 Toplam Ticket", val:totalTicket, bg:"#faf5ff", tc:"#7c3aed", border:"#ddd6fe" },
        ].map(c=>(
          <div key={c.label} style={{ background:c.bg, border:`1.5px solid ${c.border}`, borderRadius:"12px", padding:"14px 18px", minWidth:"160px", flex:1 }}>
            <div style={{ fontSize:"11px", fontWeight:600, color:c.tc, marginBottom:"4px" }}>{c.label}</div>
            <div style={{ fontSize:"20px", fontWeight:800, color:c.tc }}>
              {c.isCount ? `${c.val} kişi` : fmtFull(c.val)}
            </div>
          </div>
        ))}
      </div>

      {/* ── Sarkan Ödemeler Bandı ── */}
      {sarkanlar.length > 0 && (
        <div style={{ marginBottom:"20px", background:"#fff7ed", border:"2px solid #fed7aa", borderRadius:"14px", padding:"14px 18px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"12px" }}>
            <span style={{ fontSize:"20px" }}>⚠️</span>
            <div>
              <div style={{ fontWeight:800, fontSize:"15px", color:"#9a3412" }}>Devredilen (Sarkan) Ödemeler</div>
              <div style={{ fontSize:"12px", color:"#c2410c", marginTop:"2px" }}>Önceki aylarda tam ödenmeyen maaş borçları — bu aya devredildi</div>
            </div>
            <div style={{ marginLeft:"auto", background:"#dc2626", color:"#fff", borderRadius:"10px", padding:"4px 14px", fontWeight:800, fontSize:"15px" }}>
              ₺{sarkanlar.reduce((s,r)=>s+Number(r.sarkan||0),0).toLocaleString("tr-TR")}
            </div>
          </div>
          <div style={{ display:"flex", gap:"10px", flexWrap:"wrap" }}>
            {sarkanlar.map(s => {
              const [sy, sm] = (s.donem||"").split("-");
              const ayAdi = AY_ADLARI[Number(sm)-1];
              const pct = s.butce > 0 ? Math.round((s.odenen/s.butce)*100) : 0;
              return (
                <div key={s.donem} style={{ background:"#fff", border:"1.5px solid #fed7aa", borderRadius:"10px", padding:"10px 14px", minWidth:"200px", flex:1 }}>
                  <div style={{ fontWeight:700, fontSize:"13px", color:"#9a3412", marginBottom:"6px" }}>{ayAdi} {sy}</div>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:"12px", color:"#6b7280", marginBottom:"4px" }}>
                    <span>Bütçe:</span><span style={{ fontWeight:600, color:"#374151" }}>₺{Number(s.butce).toLocaleString("tr-TR")}</span>
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:"12px", color:"#6b7280", marginBottom:"4px" }}>
                    <span>Ödenen:</span><span style={{ fontWeight:600, color:"#166534" }}>₺{Number(s.odenen).toLocaleString("tr-TR")}</span>
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:"12px", marginBottom:"8px" }}>
                    <span style={{ color:"#dc2626", fontWeight:600 }}>Eksik:</span>
                    <span style={{ fontWeight:800, color:"#dc2626" }}>₺{Number(s.sarkan).toLocaleString("tr-TR")}</span>
                  </div>
                  {/* İlerleme çubuğu */}
                  <div style={{ background:"#fecaca", borderRadius:"99px", height:"6px", overflow:"hidden" }}>
                    <div style={{ width:`${pct}%`, height:"100%", background:"#16a34a", borderRadius:"99px", transition:"width 0.4s" }} />
                  </div>
                  <div style={{ fontSize:"10px", color:"#9ca3af", marginTop:"3px", textAlign:"right" }}>{pct}% ödendi</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ana tablo */}
      <div style={{ overflowX:"auto", borderRadius:"14px", boxShadow:"0 2px 12px rgba(0,0,0,0.08)", background:"#fff" }}>
        <table style={{ borderCollapse:"collapse", width:"100%" }}>
          <thead>
            <tr>
              <th style={{ ...thSt, textAlign:"left", left:0, position:"sticky", zIndex:3, minWidth:"180px", background:"#1e3a5f" }}>Kategori</th>
              {days.map(d=>(
                <th key={d} style={{ ...thSt, background: isWeekend(d) ? "#2563eb" : "#1e3a5f", minWidth:"44px" }}>
                  <div>{d}</div>
                  <div style={{ fontSize:"9px", opacity:0.75 }}>{getDayName(d)}</div>
                </th>
              ))}
              <th style={{ ...thSt, background:"#0f172a", minWidth:"80px" }}>Toplam</th>
            </tr>
          </thead>
          <tbody>
            {KATEGORILER.map((kat, ki) => {
              const rowTotal = Object.values(kat.byDay).reduce((a,b)=>a+b,0);
              const rowBg    = kat.overdue ? "#fff5f5" : (ki%2===0 ? "#fafafa":"#fff");
              const lblBg    = kat.overdue ? "#fee2e2" : rowBg;
              const lblBorder= kat.overdue ? "2px solid #fca5a5" : "2px solid #e5e7eb";
              return (
                <tr key={kat.key} style={{ background: rowBg }}>
                  <td style={{ ...rowLbl, background: lblBg, color:kat.textColor, borderRight:lblBorder, borderBottom:"1px solid #f3f4f6" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:"5px" }}>
                      {kat.label}
                      {kat.overdue && <span title="Ödeme gecikmesi!" style={{ fontSize:"11px", color:"#dc2626", fontWeight:800, marginLeft:"4px" }}>❗</span>}
                    </div>
                    {kat.note && <div style={{ fontSize:"10px", color: kat.overdue ? "#ef4444" : "#9ca3af", fontWeight:400 }}>{kat.note}</div>}
                  </td>
                  {days.map(d => {
                    const val = kat.byDay[d] || 0;
                    const cellBg = val!==0
                      ? (kat.overdue ? "#fecaca" : kat.color)
                      : (kat.overdue ? "#fff5f5" : (isWeekend(d)?"#f8f9fe":"transparent"));
                    return (
                      <td key={d}
                        onClick={kat.isTaseron && val!==0 ? (e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setTaseronModal({ gun: d, items: taseronDet[d]||[], rect });
                        } : undefined}
                        style={{ ...tdSt, background: cellBg, borderBottom:"1px solid #f3f4f6", borderRight:"1px solid #f3f4f6", cursor: kat.isTaseron && val!==0 ? "pointer" : "default" }}>
                        {val!==0 && (
                          <div style={{ color: kat.overdue ? "#dc2626" : kat.textColor, fontWeight:700, fontSize:"10px" }}>
                            {kat.type==="income" ? "+" : "-"}{fmt(val)}
                            {kat.isTaseron && <div style={{ fontSize:"9px", opacity:0.7 }}>ℹ️</div>}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td style={{ ...tdSt, fontWeight:800, fontSize:"11px", color: kat.overdue ? "#dc2626" : kat.textColor, background: kat.overdue ? "#fecaca" : kat.color, borderLeft: kat.overdue ? "2px solid #fca5a5" : "2px solid #e5e7eb" }}>
                    {rowTotal>0 ? `${kat.type==="income"?"+ ":"- "}₺${rowTotal.toLocaleString("tr-TR",{maximumFractionDigits:0})}` : "—"}
                  </td>
                </tr>
              );
            })}

            {/* Günlük Net satırı */}
            <tr style={{ background:"#f0f9ff" }}>
              <td style={{ ...rowLbl, background:"#f0f9ff", color:"#1e40af", borderRight:"2px solid #e5e7eb", borderTop:"2px solid #93c5fd" }}>
                📊 Günlük Net
              </td>
              {days.map(d => {
                const n = dailyNet[d]||0;
                return (
                  <td key={d} style={{ ...tdSt, borderTop:"2px solid #93c5fd", borderRight:"1px solid #dbeafe", background: n>0?"#dcfce7":n<0?"#fee2e2":"#f0f9ff" }}>
                    {n!==0 && <span style={{ fontWeight:700, fontSize:"10px", color:n>0?"#166534":"#dc2626" }}>{n>0?"+":""}{fmt(n)}</span>}
                  </td>
                );
              })}
              <td style={{ ...tdSt, fontWeight:800, color: netBakiye>=0?"#166534":"#dc2626", background:"#dbeafe", borderLeft:"2px solid #93c5fd", borderTop:"2px solid #93c5fd" }}>
                {netBakiye>=0?"+":"-"}₺{Math.abs(netBakiye).toLocaleString("tr-TR",{maximumFractionDigits:0})}
              </td>
            </tr>

            {/* Kümülatif Bakiye satırı */}
            <tr style={{ background:"#1e3a5f" }}>
              <td style={{ ...rowLbl, background:"#1e3a5f", color:"#fff", borderRight:"2px solid #3b82f6" }}>
                💰 Kümülatif Bakiye
              </td>
              {days.map(d => {
                const c = cumByDay[d]||0;
                return (
                  <td key={d} style={{ ...tdSt, background: c>=0?"#0f4c2a":"#7f1d1d", color:"#fff", fontWeight:700, fontSize:"10px" }}>
                    {fmt(Math.abs(c))}
                  </td>
                );
              })}
              <td style={{ ...tdSt, background:"#0f172a", color:"#fff", fontWeight:800, fontSize:"12px" }}>
                {fmtFull(netBakiye)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Alt not */}
      <div style={{ marginTop:"12px", fontSize:"11px", color:"#9ca3af", display:"flex", gap:"16px", flexWrap:"wrap" }}>
        <span>📅 HW Tahsilat: Ödeme kayıtlarından gerçek veri</span>
        <span>👥 Maaş: <b>{prevAyAdi}</b> ayı hakedilen (önceki ay puantajından) · 15. gün ödenir</span>
        <span>🚗 Araç & 🏢 Ofis: <b>{prevAyAdi}</b> kirası · Sırasıyla 10. ve 5. gün</span>
        <span>🎫 Ticket: {personelList.length} kişi × ₺10.000 · 5. gün</span>
        <span>🔧 Taşeron: Fatura girişindeki ödeme tarihinden · Tutara tıkla → detay</span>
      </div>

      {/* Taşeron Detay Modal */}
      {taseronModal && (
        <div
          onClick={() => setTaseronModal(null)}
          style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(0,0,0,0.15)" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position:"fixed",
              top: Math.min(taseronModal.rect.bottom + 8, window.innerHeight - 320),
              left: Math.min(taseronModal.rect.left, window.innerWidth - 340),
              width:"320px",
              background:"#fff",
              borderRadius:"14px",
              boxShadow:"0 8px 32px rgba(0,0,0,0.18)",
              padding:"16px",
              zIndex:10000,
            }}
          >
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"12px" }}>
              <div>
                <div style={{ fontWeight:800, fontSize:"14px", color:"#7e22ce" }}>🔧 Taşeron Ödemeleri</div>
                <div style={{ fontSize:"11px", color:"#9ca3af" }}>{taseronModal.gun}. gün detayı</div>
              </div>
              <button onClick={() => setTaseronModal(null)} style={{ background:"#f3f4f6", border:"none", borderRadius:"50%", width:"28px", height:"28px", cursor:"pointer", fontSize:"14px" }}>✕</button>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:"6px", maxHeight:"220px", overflowY:"auto" }}>
              {taseronModal.items.map((it, i) => (
                <div key={i} style={{ background:"#fdf4ff", borderRadius:"10px", padding:"8px 12px", border:"1px solid #e9d5ff" }}>
                  <div style={{ fontWeight:700, fontSize:"13px", color:"#6b21a8" }}>{it.firma || "—"}</div>
                  {it.fatura_no && <div style={{ fontSize:"11px", color:"#9ca3af" }}>Fatura: {it.fatura_no}</div>}
                  {it.note && <div style={{ fontSize:"11px", color:"#78716c", fontStyle:"italic" }}>{it.note}</div>}
                  <div style={{ fontWeight:800, fontSize:"14px", color:"#7e22ce", marginTop:"4px" }}>
                    - ₺{Number(it.tutar).toLocaleString("tr-TR",{maximumFractionDigits:0})}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop:"10px", paddingTop:"10px", borderTop:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", fontWeight:800, fontSize:"13px" }}>
              <span style={{ color:"#374151" }}>Toplam</span>
              <span style={{ color:"#7e22ce" }}>- ₺{taseronModal.items.reduce((s,it)=>s+Number(it.tutar),0).toLocaleString("tr-TR",{maximumFractionDigits:0})}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MalzemeYonetimiPanel({ currentUser, onBack }) {
  const _email = (currentUser?.email || "").toLowerCase();
  const isAdmin    = currentUser?.role === "admin";
  const isPM       = _email === "orhan.bedir@simsektel.com";
  const isDirektor = _email === "duzgun.simsek@simsektel.com";
  const isNurcan   = _email === "nurcan.kus@simsektel.com";
  const isMurat    = _email === "murat.istek@simsektel.com";
  const canSeeDepo = isAdmin || isPM || isDirektor || isNurcan || isMurat;
  const canEditFiyat = isAdmin || isPM;

  const [tab, setTab] = useState("talepler");
  const [talepler, setTalepler] = useState([]);
  const [talepLoading, setTalepLoading] = useState(false);

  // Form görünümü: null=liste, "yeni"=yeni form, id=düzenleme
  const [formView, setFormView] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [siteCodeSuggestions, setSiteCodeSuggestions] = useState([]);
  const [showSiteDropdown, setShowSiteDropdown] = useState(false);
  const emptyForm = () => ({
    bolge: "", proje: "", site_type: "", site_id: "",
    talep_eden_ad: currentUser?.name || currentUser?.email || "",
    talep_eden_email: currentUser?.email || "",
    talep_edilen_personel: "", talep_edilen_personel_manuel: false,
    talep_edilen_firma: "",
    talep_tarihi: new Date().toISOString().split("T")[0],
    notlar: "",
  });
  const [talepForm, setTalepForm] = useState(emptyForm());
  const [talepKalemler, setTalepKalemler] = useState([{ malzeme_adi: "", miktar: 1, birim: "Adet", birim_fiyat: "", notlar: "" }]);
  const [saving, setSaving] = useState(false);

  // Detay modal
  const [detayModal, setDetayModal] = useState(null);
  const [detayKalemler, setDetayKalemler] = useState([]);
  const [onayNotu, setOnayNotu] = useState("");
  const [redModal, setRedModal] = useState(null);
  const [redNot, setRedNot] = useState("");

  // Depo
  const [depoStok, setDepoStok] = useState([]);
  const [sarfModal, setSarfModal] = useState(null);
  const [sarfForm, setSarfForm] = useState({ miktar:"", personel_ad:"", lokasyon:"", islem_turu:"CIKIS", notlar:"" });
  const [sarfListe, setSarfListe] = useState([]);
  const [depoEditModal, setDepoEditModal] = useState(null);
  const [depoEditForm, setDepoEditForm] = useState({});

  // Fiyat listesi
  const [fiyatListe, setFiyatListe] = useState([]);
  const [fiyatForm, setFiyatForm] = useState({ malzeme_adi:"", birim:"Adet", birim_fiyat:"", kategori:"Genel" });
  const [fiyatEditId, setFiyatEditId] = useState(null);

  // Personel listesi
  const [personelListe, setPersonelListe] = useState([]);

  const token = localStorage.getItem("finance_token") || localStorage.getItem("token") || "";
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const MALZEME_LISTESI = [
    "10M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )",
    "20M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )",
    "30M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )",
    "40M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )",
    "50M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )",
    "60M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )",
    "70M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )",
    "80M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )",
    "90M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )",
    "100M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )",
    "110M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )",
    "120M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )",
    "130M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )",
    "140M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )",
    "150M LC-LC SİNGLE MOD OUTDOOR OPTİK ( SİYAH )( HUAWEİ TİPİ )",
    "3M LC-LC PATCH CORT OPTİK ( SİNGLE MOD ) ( SARI )",
    "5M LC-LC PATCH CORT OPTİK ( SİNGLE MOD )( SARI )",
    "10M LC-LC PATCH CORT OPTİK ( SİNGLE MOD )( SARI )",
    "3M SC-LC PATCH CORT OPTİK ( SİNGLE MOD )( SARI )",
    "5M SC-LC PATCH CORT OPTİK ( SİNGLE MOD )( SARI )",
    "10M SC-LC PATCH CORT OPTİK ( SİNGLE MOD )( SARI )",
    "3M SC-SC PATCH CORT OPTİK( SİNGLE MOD )( SARI )",
    "5M SC-SC PATCH CORT OPTİK ( SİNGLE MOD )( SARI )",
    "10M SC-SC PATCH CORT OPTİK ( SİNGLE MOD )( SARI )",
    "3M 7-16 / 7-16 ( KALIN-KALIN ) JUMPER",
    "4M 7-16 / 7-16 ( KALIN-KALIN ) JUMPER",
    "5M 7-16 / 7-16 ( KALIN-KALIN ) JUMPER",
    "6M 7-16 / 7-16 ( KALIN-KALIN ) JUMPER",
    "8M 7-16 / 7-16 ( KALIN-KALIN ) JUMPER",
    "10M 7-16 / 7-16 ( KALIN-KALIN ) JUMPER",
    "3M 4,3-10 / 7-16 ( KALIN-İNCE ) JUMPER",
    "4M 4,3-10 / 7-16 ( KALIN-İNCE ) JUMPER",
    "5M 4,3-10 / 7-16 ( KALIN-İNCE ) JUMPER",
    "6M 4,3-10 / 7-16 ( KALIN-İNCE ) JUMPER",
    "8M 4,3-10 / 7-16 ( KALIN-İNCE ) JUMPER",
    "10M 4,3-10 / 7-16 ( KALIN-İNCE ) JUMPER",
    "3M 4,3-10 / 4,3-10 ( İNCE-İNCE ) JUMPER",
    "4M 4,3-10 / 4,3-10 ( İNCE-İNCE ) JUMPER",
    "5M 4,3-10 / 4,3-10 ( İNCE-İNCE ) JUMPER",
    "6M 4,3-10 / 4,3-10 ( İNCE-İNCE ) JUMPER",
    "8M 4,3-10 / 4,3-10 ( İNCE-İNCE ) JUMPER",
    "10M 4,3-10 / 4,3-10 ( İNCE-İNCE ) JUMPER",
    "2x6 DC TTR ENERJİ KABLOSU ( HUAWEİ TİPİ ) ( SİYAH-YUMUŞAK )",
    "2x10 DC TTR ENERJİ KABLOSU ( HUAWEİ TİPİ )( SİYAH-YUMUŞAK )",
    "2x16 DC TTR ENERJİ KABLOSU ( HUAWEİ TİPİ )( SİYAH-YUMUŞAK )",
    "2x25 DC TTR ENERJİ KABLOSU ( HUAWEİ TİPİ )( SİYAH-YUMUŞAK )",
    "1X50 DC ENERJİ KABLOSU ( ERICSSON TİPİ ) ( SİYAH )( H07RN-F )",
    "1X35mm NYAF TOPRAK KABLOSU ( BAKIR )",
    "1X50mm NYAF TOPRAK KABLOSU ( BAKIR )",
    "1X16MM NYAF MAVİ TOPRAK KABLOSU ( BAKIR )",
    "1X16MM NYAF SİYAH TOPRAK KABLOSU ( BAKIR )",
    "MKS-03",
    "16mm TOPRAKLAMA PABUCU",
    "25mm TOPRAKLAMA PABUCU",
    "35mm TOPRAKLAMA PABUCU",
    "50mm TOPRAKLAMA PABUCU",
    "AVEA TİPİ YUMA ASMA KİLİT",
    "AVEA TİPİ YUMA BAREL",
    "2x1,5 TTR KABLO",
    "3x1,5 TTR KABLO",
    "3x2,5 TTR KABLO",
    "4x1,5 TTR KABLO",
    "4x2,5 TTR KABLO",
    "CAT6 KABLO",
    "3M HAZIR ÇAKILI CAT6 KABLO",
    "5M HAZIR ÇAKILI CAT6 KABLO",
    "4x6 NYY KABLO",
    "4x10 NYY KABLO",
    "4x16 NYY KABLO",
    "4 LÜK YÜKSÜK",
    "6 LIK YÜKSÜK",
    "10 LUK YÜKSÜK",
    "16 LIK YÜKSÜK",
    "25 LİK YÜKSÜK",
    "35 LİK YÜKSÜK",
    "50 LİK YÜKSÜK",
    "AVEA TİPİ 2G 900 MARKİNG",
    "AVEA TİPİ 2G 1800 MARKİNG",
    "AVEA TİPİ 3G 900 MARKİNG",
    "AVEA TİPİ 3G 2100 MARKİNG",
    "AVEA TİPİ LTE 800 MARKİNG",
    "AVEA TİPİ LTE 1800 MARKİNG",
    "AVEA TİPİ LTE 2600 MARKİNG",
    "ROXTEK ( 16/18 ) ( 34 LÜK KİT )",
    "1/2 NORMAL FEEDERE GÖRE DÜZ 7,16 ( KALIN ) DİŞİ KONNEKTÖR",
    "1/2 NORMAL FEEDERE GÖRE DÜZ 7,16 ( KALIN ) ERKEK KONNEKTÖR",
    "1/2 FLEXİ FEEDERE GÖRE DÜZ 7,16 ( KALIN ) DİŞİ KONNEKTÖR",
    "1/2 FLEXİ FEEDERE GÖRE DÜZ 7,16 ( KALIN ) ERKEK KONNEKTÖR",
    "1/2 NORMAL FEEDERE GÖRE DÜZ 4,3-10 ( İNCE ) DİŞİ KONNEKTÖR",
    "1/2 NORMAL FEEDERE GÖRE DÜZ 4,3-10 ( İNCE ) ERKEK KONNEKTÖR",
    "1/2 FLEXİ FEEDERE GÖRE DÜZ 4,3-10 ( İNCE ) DİŞİ KONNEKTÖR",
    "1/2 FLEXİ FEEDERE GÖRE DÜZ 4,3-10 ( İNCE ) ERKEK KONNEKTÖR",
    "1/2 NORMAL FEEDERE GÖRE DÜZ N TYPE DİŞİ KONNEKTÖR",
    "1/2 NORMAL FEEDERE GÖRE DÜZ N TYPE ERKEK KONNEKTÖR",
    "1/2 FLEXİ FEEDERE GÖRE DÜZ N TYPE DİŞİ KONNEKTÖR",
    "1/2 FLEXİ FEEDERE GÖRE DÜZ N TYPE ERKEK KONNEKTÖR",
    "DIŞ RACK ( TAKIM )",
    "İÇ RACK ( TAKIM )",
    "COLD SHİRİNG",
    "7/8 FEEDER KABLO",
    "1/2 FEEDER KABLO",
    "10 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 2 TARAFI DA 2,5 İNÇ BORUYA GÖRE )",
    "20 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 2 TARAFI DA 2,5 İNÇ BORUYA GÖRE )",
    "30 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 2 TARAFI DA 2,5 İNÇ BORUYA GÖRE )",
    "40 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 2 TARAFI DA 2,5 İNÇ BORUYA GÖRE )",
    "50 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 2 TARAFI DA 2,5 İNÇ BORUYA GÖRE )",
    "10 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 1 TARAFI 2,5 İNÇ BORU- DİĞER TARAFI 4 İNÇ BORUYA GÖRE )",
    "20 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 1 TARAFI 2,5 İNÇ BORU- DİĞER TARAFI 4 İNÇ BORUYA GÖRE )",
    "30 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 1 TARAFI 2,5 İNÇ BORU- DİĞER TARAFI 4 İNÇ BORUYA GÖRE )",
    "40 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 1 TARAFI 2,5 İNÇ BORU- DİĞER TARAFI 4 İNÇ BORUYA GÖRE )",
    "50 CM LİK BORUDAN BORUYA AÇMA OFSET ( TAKIM )( 1 TARAFI 2,5 İNÇ BORU- DİĞER TARAFI 4 İNÇ BORUYA GÖRE )",
    "KULE ANTEN ASMA APARATI ( KULE OFSET )( TAKIM )",
    "ÇİÇEK ( YILDIZ OFSET ) ( 2,5 İNÇ BORUYA GÖRE )( TAKIM )",
    "ÇİÇEK ( YILDIZ OFSET ) ( 4 İNÇ BORUYA GÖRE )(TAKIM )",
    "PANEL ANTEN",
    "OMNİ ANTEN",
    "12 CORE İNDOOR ODF",
    "24 CORE İNDOOR ODF",
    "36 CORE İNDOOR ODF",
    "48 CORE İNDOOR ODF",
    "12 CORE OUTDOOR ODF",
    "24 CORE OUTDOOR ODF",
    "36 CORE OUTDOOR ODF",
    "48 CORE OUTDOOR ODF",
    "12 CORE FİBER KABLO",
    "24 CORE FİBER KABLO",
    "36 CORE FİBER KABLO",
    "48 CORE FİBER KABLO",
    "2X6-2X10 DC CLAMP ( HUAWEİ TİPİ )",
    "2X16-2X25 DC CLAMP ( HUAWEİ TİPİ )",
    "PLASTİK KABLO BAĞI ( KALIN )",
    "PLASTİK KABLO BAĞI ( İNCE )",
    "PLASTİK KABLO BAĞI ( KISA-KIL )",
    "DYMO KUTUCUK ( PVC )",
    "DYMO KARTUŞ ( SARI )",
    "SİYAH SİLİKON",
    "BEYAZ SİLİKON",
    "SİYAH İZOLELİ BANT",
    "5M ERİCSSON RET KABLOSU",
    "5M HUAWEİ RET KABLOSU",
    "SAYAÇ PANOSU",
    "UÇAK İKAZ",
    "SİYAH SPREY BOYA",
    "BEYAZ SPREY BOYA",
    "TURKUAZ SPREY BOYA",
    "GRİ SPREY BOYA",
    "MİNTİ YEŞİL SPREY BOYA",
    "3XC 25A GRUP SİGORTA",
    "3XC 32A GRUP SİGORTA",
    "3XC 40A GRUP SİGORTA",
    "3XC 63A GRUP SİGORTA",
    "3XB 25A GRUP SİGORTA",
    "3XB 32A GRUP SİGORTA",
    "3XB 40A GRUP SİGORTA",
    "3XB 63A GRUP SİGORTA",
    "4XC 25A GRUP SİGORTA",
    "4XC 32A GRUP SİGORTA",
    "4XC 40A GRUP SİGORTA",
    "4XC 63A GRUP SİGORTA",
    "4XB 25A GRUP SİGORTA",
    "4XB 32A GRUP SİGORTA",
    "4XB 40A GRUP SİGORTA",
    "4XB 63A GRUP SİGORTA",
    "4X25A 300MA YANGIN KORUMA SİGORTASI",
    "4X32A 300MA YANGIN KORUMA SİGORTASI",
    "4X40A 300MA YANGIN KORUMA SİGORTASI",
    "4X63A 300MA YANGIN KORUMA SİGORTASI",
    "4X25A 30MA KAÇAK AKIM SİGORTASI",
    "4X32A 30MA KAÇAK AKIM SİGORTASI",
    "4X40A 30MA KAÇAK AKIM SİGORTASI",
    "4X63A 30MA KAÇAK AKIM SİGORTASI",
    "1XC 16A MONOFAZE SİGORTA",
    "1XC 25A MONOFAZE SİGORTA",
    "1XC 32A MONOFAZE SİGORTA",
    "1XC 40A MONOFAZE SİGORTA",
    "1XC 63A MONOFAZE SİGORTA",
    "1XC 100A MONOFAZE SİGORTA",
    "1XC 125A MONOFAZE SİGORTA",
    "16A BIÇAKLI SİGORTA ( BOY 0 )",
    "25A BIÇAKLI SİGORTA ( BOY 0 )",
    "32A BIÇAKLI SİGORTA ( BOY 0 )",
    "40A BIÇAKLI SİGORTA ( BOY 0 )",
    "63A BIÇAKLI SİGORTA ( BOY 0 )",
    "100A BIÇAKLI SİGORTA ( BOY 0 )",
    "125A BIÇAKLI SİGORTA ( BOY 0 )",
    "NYY 3x4mm2 ENERJİ KABLOSU",
    "NYY 3x6mm2 ENERJİ KABLOSU",
    "NYY 3x10mm2 ENERJİ KABLOSU",
    "NYY 3x16mm2 ENERJİ KABLOSU",
    "NYY 3x35mm2 ENERJİ KABLOSU",
    "NYY 1x50mm2 ENERJİ KABLOSU",
    "NYY 1x95mm2 ENERJİ KABLOSU",
    "NYAF 1x50mm2 ESNEK TOPRAKLAMA İLETKENİ",
    "NYAF 1x16mm2 ESNEK TOPRAKLAMA İLETKENİ",
    "NYAF 1x6mm2 ESNEK TOPRAKLAMA İLETKENİ",
    "NH-FE 180 3x2.5mm2 YANMAZ ENERJİ KABLOSU",
    "DC 48V GÜÇ KABLOSU 2x35mm2",
    "BAKIR ÖRGÜLÜ TOPRAKLAMA İLETKENİ 35mm2",
    "HDPE Ø50/42mm TEK KATLI KABLO KORUMA BORUSU",
    "HDPE Ø63/53mm TEK KATLI KABLO KORUMA BORUSU",
    "HDPE Ø110/94mm ÇİFT KATLI KABLO KORUMA BORUSU",
    "HDPE Ø160/136mm ÇİFT KATLI KABLO KORUMA BORUSU",
    "HDPE Ø40/34mm MİKROKANAL BORUSU",
    "PVC BORU Ø32mm ELEKTRİK TESİSAT BORUSU",
    "PVC BORU Ø50mm ELEKTRİK TESİSAT BORUSU",
    "PVC BORU Ø75mm ELEKTRİK TESİSAT BORUSU",
    "GALVANİZLİ ÇELİK BORU 2'",
    "CORRUGATED BORU Ø32mm ESNEKLİK BORUSU",
    "3m STANDART ANTEN OFSETİ (GALVANİZLİ ÇELİK)",
    "6m STANDART ANTEN OFSETİ (GALVANİZLİ ÇELİK)",
    "1.5m KISA ANTEN OFSETİ (HOT DIP GALVANİZLİ)",
    "DUVAR TİPİ ANTEN MONTAJ KOL SETİ",
    "SEKTÖR ANTEN MONTAJ FLANŞI VE BAĞLANTI KİTİ",
    "ANTEN TAVAN MONTAJ KİTİ (3 NOKTA SABITLEME)",
    "U-BOLT M16 GALVANİZLİ KULE BAĞLANTI CİVATASI (4'LÜ SET)",
    "48 FİBER OPTİK KABLO G.652D LOOSE TUBE OUTDOOR",
    "96 FİBER OPTİK KABLO G.652D LOOSE TUBE OUTDOOR",
    "24 FİBER OPTİK KABLO G.652D LOOSE TUBE OUTDOOR",
    "12 FİBER OPTİK KABLO G.657A2 INDOOR/OUTDOOR",
    "4 FİBER OPTİK KABLO G.652D FİGÜR-8 HAVAI",
    "2M LC-LC SİNGLE MOD PATCH CORD (INDOOR)",
    "2M SC-LC SİNGLE MOD PATCH CORD (INDOOR)",
    "2M SC-SC SİNGLE MOD PATCH CORD (INDOOR)",
    "LC/UPC PİGTAİL 1.5M SİNGLE MOD G.652D",
    "SC/UPC PİGTAİL 1.5M SİNGLE MOD G.652D",
    "SC/APC PİGTAİL 1.5M SİNGLE MOD G.652D",
    "12 FİBER SC/UPC FANOUT SİNGLE MOD",
    "24 FİBER SC/UPC FANOUT SİNGLE MOD",
    "12 PORT LC DUPLEX FIBER OPTİK PATCH PANEL 19'",
    "24 PORT SC SIMPLEX FIBER OPTİK PATCH PANEL 19'",
    "48 PORT LC DUPLEX FIBER OPTİK PATCH PANEL 19'",
    "FIBER OPTİK SPLICE CLOSURE 48 FİBER 4 PORT",
    "FIBER OPTİK SPLICE CLOSURE 144 FİBER 6 PORT",
    "FIBER OPTİK SPLICE CLOSURE 288 FİBER 6 PORT",
    "FIBER OPTİK SONLANDIRMA KUTUSU 12 PORT SC",
    "FIBER OPTİK SONLANDIRMA KUTUSU 24 PORT SC",
    "ODF 19'",
    "FIBER OPTİK SPLICE TRAY (12 FİBER KAPASİTELİ)",
    "SC/LC ADAPTÖR SİNGLE MOD UPC",
    "SC/LC ADAPTÖR SİNGLE MOD APC",
    "BAKIR TOPRAKLAMA ÇUBUĞU 14mm x 1500mm",
    "BAKIR TOPRAKLAMA ÇUBUĞU 14mm x 2000mm",
    "BAKIR ŞERİT 30x3mm2 TOPRAKLAMA İLETKENİ",
    "BAKIR ŞERİT 25x3mm2 TOPRAKLAMA İLETKENİ",
    "TOPRAKLAMA RAYIÇ KLEMENSİ BUS BAR 100A",
    "TOPRAKLAMA RAYIÇ KLEMENSİ BUS BAR 200A",
    "TOPRAKLAMA PABUCİ CU 50mm2 M8",
    "TOPRAKLAMA PABUCİ CU 95mm2 M10",
    "GALVANİZLİ TOPRAKLAMA BAĞLANTISI KELEPÇE SETİ",
    "RF KOAKSIYEL FEEDER KABLO 1/2'",
    "RF KOAKSIYEL FEEDER KABLO 7/8'",
    "RF JUMPER KABLO 0.5M N(M)-N(M) SÜPER ESNEK",
    "RF JUMPER KABLO 1M N(M)-N(M) SÜPER ESNEK",
    "RF JUMPER KABLO 2M N(M)-N(M) SÜPER ESNEK",
    "N TİPİ KONNEKTÖR 1/2'",
    "N TİPİ KONNEKTÖR 7/8'",
    "7/16 DIN KONNEKTÖR 7/8'",
    "RF TOPRAKLAMA KİTİ 1/2'",
    "RF TOPRAKLAMA KİTİ 7/8'",
    "GALVANİZLİ KABLO KANALÜ 100x50mm (3m PARÇA)",
    "GALVANİZLİ KABLO KANALÜ 200x100mm (3m PARÇA)",
    "PVC KABLO KANALÜ 25x16mm (2m PARÇA)",
    "PVC KABLO KANALÜ 40x25mm (2m PARÇA)",
    "KABLO ASKISI GALVANİZLİ 50mm",
    "KABLO ASKISI GALVANİZLİ 75mm",
    "ÇELİK KABLO BAĞI TIE WRAP 250mm 100 ADET",
    "PVC SPIRAL KABLO KORUYUCU Ø20mm",
    "KABLO MERDİVENİ LADDER RACK 300mm",
    "KABLO MERDİVENİ LADDER RACK 600mm",
    "J-HOOK KABLO ASKI KANCASI Ø75mm",
    "OUTDOOR METAL KABIN IP55 600x800x300mm",
    "OUTDOOR METAL KABIN IP55 1000x800x300mm",
    "19'",
    "HAVALANDIRMA FAN KİTİ KABIN 230VAC",
    "SPD AŞIRI GERİLİM KORUYUCU TİP 2 40kA",
    "AC KABLO 3x2.5mm2 TESİSAT KABLOSU",
    "ALÇAK GERİLİM KABİN ANAHTARLAMA PANELI"
  ];

  const BOLGELER = ["İzmir","İstanbul","Ankara","Bursa","Antalya","Adana","Samsun","Trabzon","Erzurum","Diyarbakır","Diğer"];
  const PROJELER = ["TT","TC","VF","Diğer"];
  const SITE_TYPES = ["GF","RT","IB","OUT","Diğer"];
  const FIRMALAR = ["Şimşek","UBS","FEDERAL","2KX","Diğer"];

  // ── LOAD ──
  const loadTalepler = async () => {
    setTalepLoading(true);
    try { const r = await fetch(`${API_BASE}/malzeme/talepler`, { headers }); setTalepler(await r.json()); }
    catch {} finally { setTalepLoading(false); }
  };
  const loadDepoStok = async () => {
    try { const r = await fetch(`${API_BASE}/malzeme/depo-stok`, { headers }); setDepoStok(await r.json()); } catch {}
  };
  const loadFiyatListe = async () => {
    try {
      const r = await fetch(`${API_BASE}/malzeme/fiyat-listesi`, { headers });
      const d = await r.json();
      setFiyatListe(Array.isArray(d) ? d : []);
    } catch { setFiyatListe([]); }
  };

  const searchSiteCode = async (q) => {
    if (!q || q.length < 2) { setSiteCodeSuggestions([]); return; }
    try {
      const r = await fetch(`${API_BASE}/malzeme/site-codes?q=${encodeURIComponent(q)}`, { headers });
      const d = await r.json();
      setSiteCodeSuggestions(Array.isArray(d) ? d : []);
    } catch { setSiteCodeSuggestions([]); }
  };

  const deleteTalep = async (id) => {
    if (!window.confirm("Bu talebi silmek istediğinize emin misiniz?")) return;
    try {
      const r = await fetch(`${API_BASE}/malzeme/talepler/${id}`, { method:"DELETE", headers });
      const d = await r.json();
      if (d.error) { alert(d.error); return; }
      loadTalepler();
    } catch (e) { alert(e.message); }
  };
  const loadPersonel = async () => {
    try {
      const r = await fetch(`${API_BASE}/hr/personel`, { headers });
      const d = await r.json();
      setPersonelListe(Array.isArray(d) ? d : []);
    } catch {}
  };
  const loadDetay = async (id) => {
    try {
      const r = await fetch(`${API_BASE}/malzeme/talepler/${id}`, { headers });
      const d = await r.json();
      setDetayModal(d); setDetayKalemler(d.kalemler || []); setOnayNotu(d.onay_notu || "");
    } catch {}
  };
  const loadSarf = async (malzeme_adi) => {
    try { const r = await fetch(`${API_BASE}/malzeme/sarf?malzeme_adi=${encodeURIComponent(malzeme_adi)}`, { headers }); setSarfListe(await r.json()); } catch {}
  };

  useEffect(() => { loadTalepler(); loadFiyatListe(); loadPersonel(); }, []);
  useEffect(() => { if (tab === "depo") loadDepoStok(); }, [tab]);

  // ── TALEP KAYDET ──
  const saveTalep = async (durum) => {
    const kalemlerDolu = talepKalemler.filter(k => k.malzeme_adi.trim());
    if (!kalemlerDolu.length) { alert("En az bir malzeme kalemi girin"); return; }
    if (durum !== "TASLAK" && !talepForm.site_id?.trim()) {
      alert("⚠️ Onaya göndermeden önce Site ID giriniz.\nHuawei sisteminde PO olmadan malzeme çıkışı yapılamaz.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...talepForm,
        durum,
        kalemler: kalemlerDolu.map(k => ({
          ...k,
          birim_fiyat: k.birim_fiyat || 0,
          toplam_tutar: (Number(k.miktar)||0) * (Number(k.birim_fiyat)||0),
        })),
      };
      if (editingId) {
        await fetch(`${API_BASE}/malzeme/talepler/${editingId}`, { method: "PUT", headers, body: JSON.stringify(body) });
      } else {
        await fetch(`${API_BASE}/malzeme/talepler`, { method: "POST", headers, body: JSON.stringify(body) });
      }
      setFormView(null); setEditingId(null); setTalepForm(emptyForm());
      setTalepKalemler([{ malzeme_adi: "", miktar: 1, birim: "Adet", birim_fiyat: "", notlar: "" }]);
      loadTalepler();
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  // Düzenle: talebi yükle ve form aç
  const openEdit = async (t) => {
    try {
      const r = await fetch(`${API_BASE}/malzeme/talepler/${t.id}`, { headers });
      const d = await r.json();
      setTalepForm({
        bolge: d.bolge||"", proje: d.proje||"", site_type: d.site_type||"", site_id: d.site_id||"",
        talep_eden_ad: d.talep_eden_ad||"", talep_eden_email: d.talep_eden_email||"",
        talep_edilen_personel: d.talep_edilen_personel||"", talep_edilen_personel_manuel: false,
        talep_edilen_firma: d.talep_edilen_firma||"",
        talep_tarihi: d.talep_tarihi ? d.talep_tarihi.split("T")[0] : new Date().toISOString().split("T")[0],
        notlar: d.notlar||"",
      });
      setTalepKalemler(d.kalemler?.length ? d.kalemler : [{ malzeme_adi:"", miktar:1, birim:"Adet", birim_fiyat:"", notlar:"" }]);
      setEditingId(t.id);
      setFormView("form");
    } catch (e) { alert("Yüklenemedi"); }
  };

  // ── DURUM GÜNCELLE ──
  const updateDurum = async (id, durum, kalemler, not) => {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/malzeme/talepler/${id}/durum`, {
        method:"PUT", headers,
        body: JSON.stringify({ durum, kalemler, onay_notu: not }),
      });
      setDetayModal(null); loadTalepler();
      if (tab==="depo") loadDepoStok();
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  // ── EXCEL EXPORT ──
  const excelIndir = (t, kalemler) => {
    const durumLabel = {
      TASLAK:"Taslak", NURCAN_ONAY:"Nurcan Onayı Bekliyor", FIYAT_GIRISI:"Fiyat Girişi (Murat)",
      PM_ONAY:"PM Onayı (Orhan Bedir)", DUZGUN_ONAY:"Düzgün Onayı Bekliyor",
      ONAYLANDI:"Onaylandı", SATINALINACAK:"Satın Alınacak", DEPODA:"Depoda", REDDEDILDI:"Reddedildi"
    };
    const tarihFmt = (d) => {
      if (!d) return "";
      const dt = new Date(d);
      if (isNaN(dt)) return d;
      return `${String(dt.getDate()).padStart(2,"0")}.${String(dt.getMonth()+1).padStart(2,"0")}.${dt.getFullYear()}`;
    };
    const toplam = kalemler.reduce((s,k)=>s+Number(k.toplam_tutar||0),0);
    const rows = [
      ["ERC MÜHENDİSLİK - MALZEME TALEBİ", "", "", "", "", "", ""],
      [],
      ["TALEP NO",        t.talep_no||"",              "", "TARİH",       tarihFmt(t.talep_tarihi), "", ""],
      ["BÖLGE",           t.bolge||"-",                "", "PROJE",       t.proje||"-",             "SİTE TİPİ", t.site_type||"-"],
      ["SİTE ID",         t.site_id||"-",              "", "", "", "", ""],
      ["TALEP EDEN",      t.talep_eden_ad||"-",        "", "FİRMA",       t.talep_edilen_firma||"-","", ""],
      ["TALEP ED. PERS.", t.talep_edilen_personel||"-","", "DURUM",       durumLabel[t.durum]||t.durum||"-", "", ""],
      ["AÇIKLAMA",        t.notlar||"-",               "", "", "", "", ""],
      [],
      ["#", "MALZEME ADI", "MİKTAR", "BİRİM", "BİRİM FİYAT (₺)", "TOPLAM (₺)", "NOT"],
      ...kalemler.map((k,i) => [
        i+1,
        k.malzeme_adi||"",
        Number(k.miktar||0),
        k.birim||"Adet",
        Number(Number(k.birim_fiyat||0).toFixed(2)),
        Number(Number(k.toplam_tutar||0).toFixed(2)),
        k.notlar||""
      ]),
      [],
      ["", "", "", "", "GENEL TOPLAM (₺)", Number(toplam.toFixed(2)), ""],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Kolon genişlikleri
    ws["!cols"] = [
      { wch: 22 }, // A - etiket
      { wch: 36 }, // B - değer (malzeme adı)
      { wch: 3  }, // C - boşluk
      { wch: 18 }, // D - etiket2
      { wch: 22 }, // E - değer2
      { wch: 12 }, // F - site tipi etiket
      { wch: 12 }, // G - site tipi değer
    ];
    // Başlık birleştir (A1:G1)
    ws["!merges"] = [{ s:{r:0,c:0}, e:{r:0,c:6} }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Talep");
    XLSX.writeFile(wb, `${t.talep_no||"Malzeme_Talebi"}.xlsx`);
  };

  // ── SARF ──
  const handleSarfSubmit = async () => {
    if (!sarfForm.miktar) { alert("Miktar girin"); return; }
    setSaving(true);
    try {
      await fetch(`${API_BASE}/malzeme/sarf`, {
        method:"POST", headers,
        body: JSON.stringify({ malzeme_adi:sarfModal.malzeme_adi, miktar:Number(sarfForm.miktar), personel_ad:sarfForm.personel_ad, lokasyon:sarfForm.lokasyon, islem_turu:sarfForm.islem_turu, notlar:sarfForm.notlar, tarih:new Date().toISOString().split("T")[0] }),
      });
      setSarfModal(null); setSarfForm({miktar:"",personel_ad:"",lokasyon:"",islem_turu:"CIKIS",notlar:""}); loadDepoStok();
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  // ── FİYAT LİSTESİ ──
  const handleFiyatSave = async () => {
    if (!fiyatForm.malzeme_adi.trim()) { alert("Malzeme adı girin"); return; }
    setSaving(true);
    try {
      const url = fiyatEditId ? `${API_BASE}/malzeme/fiyat-listesi/${fiyatEditId}` : `${API_BASE}/malzeme/fiyat-listesi`;
      await fetch(url, { method:fiyatEditId?"PUT":"POST", headers, body:JSON.stringify(fiyatForm) });
      setFiyatForm({malzeme_adi:"",birim:"Adet",birim_fiyat:"",kategori:"Genel"}); setFiyatEditId(null); loadFiyatListe();
    } catch (e) { alert(e.message); }
    setSaving(false);
  };
  const handleFiyatDelete = async (id) => {
    if (!window.confirm("Bu malzemeyi silmek istediğinize emin misiniz?")) return;
    await fetch(`${API_BASE}/malzeme/fiyat-listesi/${id}`, { method:"DELETE", headers });
    loadFiyatListe();
  };

  // ── DURUM BADGE ──
  const durumBadge = (d) => {
    const map = {
      TASLAK:        { label:"Taslak",                   color:"#6b7280", bg:"#f3f4f6" },
      NURCAN_ONAY:   { label:"Nurcan Onayı Bekliyor",    color:"#f59e0b", bg:"#fef3c7" },
      FIYAT_GIRISI:  { label:"Fiyat Girişi (Murat)",     color:"#8b5cf6", bg:"#ede9fe" },
      PM_ONAY:       { label:"PM Onayı Bekliyor",         color:"#2563eb", bg:"#dbeafe" },
      DUZGUN_ONAY:   { label:"Düzgün Onayı Bekliyor",    color:"#0284c7", bg:"#e0f2fe" },
      ONAYLANDI:     { label:"Onaylandı",                 color:"#16a34a", bg:"#dcfce7" },
      SATINALINACAK: { label:"Satın Alınacak",            color:"#ea580c", bg:"#ffedd5" },
      DEPODA:        { label:"Depoda",                    color:"#15803d", bg:"#bbf7d0" },
      REDDEDILDI:    { label:"Reddedildi",                color:"#dc2626", bg:"#fee2e2" },
    };
    const s = map[d] || { label:d, color:"#6b7280", bg:"#f3f4f6" };
    return <span style={{ padding:"3px 10px",borderRadius:12,fontSize:12,fontWeight:700,color:s.color,background:s.bg,whiteSpace:"nowrap" }}>{s.label}</span>;
  };

  // ── KALEM SATIRI ──
  const renderKalemRow = (k, i) => {
    // Fiyat listesinden DB fiyatı (varsa)
    const fiyatAc = fiyatListe.find(f => f.malzeme_adi.toLowerCase() === k.malzeme_adi.toLowerCase());
    // Hardcoded MALZEME_LISTESI'nden autocomplete (API'ye bağımlı değil)
    const q = k.malzeme_adi.toLowerCase();
    const exactMatch = q.length > 0 && MALZEME_LISTESI.some(n => n.toLowerCase() === q);
    const suggestions = !exactMatch && q.length >= 1
      ? MALZEME_LISTESI.filter(n => n.toLowerCase().includes(q)).slice(0, 14)
      : [];
    const toplam = (Number(k.miktar)||0) * (Number(k.birim_fiyat)||0);
    return (
      <div key={i} style={{ display:"grid", gridTemplateColumns:"2fr 80px 100px 120px 100px 100px 36px", gap:8, marginBottom:10, alignItems:"start" }}>
        {/* Malzeme adı + autocomplete */}
        <div style={{ position:"relative" }}>
          <input placeholder="Malzeme adı yazın..." value={k.malzeme_adi}
            autoComplete="off"
            onChange={e => {
              const v = e.target.value;
              setTalepKalemler(prev => prev.map((x,j) => j===i ? {...x, malzeme_adi:v, birim_fiyat:""} : x));
            }}
            style={{ width:"100%",padding:"8px 10px",border:"1px solid #d1d5db",borderRadius:6,fontSize:13,boxSizing:"border-box" }} />
          {suggestions.length > 0 && (
            <div style={{ position:"absolute",top:"100%",left:0,right:0,zIndex:200,background:"#fff",border:"1px solid #d1d5db",borderRadius:6,boxShadow:"0 4px 16px rgba(0,0,0,0.15)",maxHeight:260,overflowY:"auto" }}>
              {suggestions.map((name, idx) => {
                const dbItem = fiyatListe.find(f => f.malzeme_adi.toLowerCase() === name.toLowerCase());
                return (
                  <div key={idx} style={{ padding:"8px 12px",cursor:"pointer",fontSize:12,borderBottom:"1px solid #f3f4f6",background:"#fff" }}
                    onMouseDown={e => {
                      e.preventDefault();
                      setTalepKalemler(prev => prev.map((x,j) => j===i ? {
                        ...x,
                        malzeme_adi: name,
                        birim: dbItem?.birim || k.birim,
                        birim_fiyat: dbItem?.birim_fiyat || ""
                      } : x));
                    }}>
                    <div style={{ wordBreak:"break-word", lineHeight:"1.5" }}>{name}</div>
                    {dbItem && Number(dbItem.birim_fiyat)>0 && (
                      <div style={{ color:"#9ca3af",fontSize:11,marginTop:2 }}>
                        {dbItem.birim} · ₺{Number(dbItem.birim_fiyat).toLocaleString("tr-TR")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {/* Miktar */}
        <input type="number" placeholder="Adet" value={k.miktar} min="0"
          onChange={e => setTalepKalemler(prev => prev.map((x,j) => j===i ? {...x, miktar:e.target.value} : x))}
          style={{ padding:"8px 6px",border:"1px solid #d1d5db",borderRadius:6,fontSize:13,textAlign:"center",width:"100%" }} />
        {/* Birim */}
        <select value={k.birim} onChange={e => setTalepKalemler(prev => prev.map((x,j) => j===i ? {...x, birim:e.target.value} : x))}
          style={{ padding:"8px 4px",border:"1px solid #d1d5db",borderRadius:6,fontSize:12,width:"100%" }}>
          {["Adet","Metre","Rulo","Kutu","Kg","Lt","Paket","Set","Takım"].map(u=><option key={u}>{u}</option>)}
        </select>
        {/* Birim Fiyat */}
        <div style={{ position:"relative" }}>
          <input type="number" placeholder="₺ Fiyat" value={k.birim_fiyat}
            onChange={e => setTalepKalemler(prev => prev.map((x,j) => j===i ? {...x, birim_fiyat:e.target.value} : x))}
            style={{ width:"100%",padding:"8px 8px",border:"1px solid #d1d5db",borderRadius:6,fontSize:13,boxSizing:"border-box" }} />
          {fiyatAc && Number(fiyatAc.birim_fiyat)>0 && !k.birim_fiyat && (
            <div style={{ position:"absolute",top:"100%",left:0,right:0,zIndex:100,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:4,padding:"4px 8px",fontSize:11,cursor:"pointer",whiteSpace:"nowrap" }}
              onMouseDown={e=>{e.preventDefault();setTalepKalemler(prev=>prev.map((x,j)=>j===i?{...x,birim_fiyat:fiyatAc.birim_fiyat}:x));}}>
              DB: ₺{Number(fiyatAc.birim_fiyat).toLocaleString("tr-TR")} kullan
            </div>
          )}
        </div>
        {/* Toplam */}
        <div style={{ padding:"8px 8px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:13,fontWeight:700,color:"#15803d",background:"#f0fdf4",textAlign:"right" }}>
          {toplam > 0 ? `₺${toplam.toLocaleString("tr-TR")}` : "—"}
        </div>
        {/* Not */}
        <input placeholder="Not" value={k.notlar}
          onChange={e => setTalepKalemler(prev => prev.map((x,j) => j===i ? {...x, notlar:e.target.value} : x))}
          style={{ padding:"8px 8px",border:"1px solid #d1d5db",borderRadius:6,fontSize:12 }} />
        {/* Sil */}
        <button onClick={() => setTalepKalemler(prev => prev.filter((_,j)=>j!==i))}
          style={{ padding:"8px",background:"#fee2e2",border:"none",borderRadius:6,color:"#dc2626",cursor:"pointer",fontWeight:700,fontSize:14 }}>✕</button>
      </div>
    );
  };

  // ── DETAY MODAL ──
  const renderDetayModal = () => {
    if (!detayModal) return null;
    const d = detayModal;
    const canNurcan   = isNurcan && d.durum==="NURCAN_ONAY";
    const canMurat    = isMurat  && d.durum==="FIYAT_GIRISI";
    const canPM       = isPM     && d.durum==="PM_ONAY";
    const canDuzgun   = isDirektor && d.durum==="DUZGUN_ONAY";
    const canOnay     = (isPM||isDirektor) && d.durum==="ONAYLANDI";
    const canDepoda   = (isPM||isDirektor||isNurcan) && d.durum==="SATINALINACAK";
    const canReddet   = (isNurcan||isPM||isDirektor) && ["NURCAN_ONAY","FIYAT_GIRISI","PM_ONAY","DUZGUN_ONAY"].includes(d.durum);
    const isOwner     = d.talep_eden_email === currentUser?.email;
    const canDuzenle  = isOwner && ["TASLAK","REDDEDILDI"].includes(d.durum);

    return (
      <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16,overflowY:"auto" }}>
        <div style={{ background:"#fff",borderRadius:16,width:"100%",maxWidth:760,maxHeight:"92vh",overflowY:"auto",padding:24 }}>
          {/* Başlık */}
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16 }}>
            <div>
              <div style={{ fontSize:20,fontWeight:800,marginBottom:2 }}>📋 {d.talep_no}</div>
              <div style={{ fontSize:12,color:"#6b7280" }}>
                {d.talep_eden_ad} · {d.talep_tarihi ? new Date(d.talep_tarihi).toLocaleDateString("tr-TR") : new Date(d.created_at).toLocaleDateString("tr-TR")}
              </div>
            </div>
            <div style={{ display:"flex",gap:8,alignItems:"center",flexWrap:"wrap" }}>
              {durumBadge(d.durum)}
              <button onClick={() => excelIndir(d, detayKalemler)}
                style={{ padding:"5px 12px",background:"#f0fdf4",color:"#15803d",border:"1px solid #bbf7d0",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:700 }}>
                📥 Excel
              </button>
              {canDuzenle && (
                <button onClick={() => { setDetayModal(null); openEdit(d); }}
                  style={{ padding:"5px 12px",background:"#dbeafe",color:"#1d4ed8",border:"none",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:700 }}>
                  ✏️ Düzenle
                </button>
              )}
              <button onClick={() => setDetayModal(null)} style={{ background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#6b7280" }}>✕</button>
            </div>
          </div>

          {/* Bilgi grid */}
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px 16px",marginBottom:16,background:"#f9fafb",borderRadius:10,padding:14 }}>
            {[["Bölge",d.bolge],["Proje",d.proje],["Site Tipi",d.site_type],
              ["Talep Eden",d.talep_eden_ad],["Talep Ed. Personel",d.talep_edilen_personel],["Firma",d.talep_edilen_firma]].map(([l,v])=>(
              <div key={l}>
                <div style={{ fontSize:11,color:"#9ca3af",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px" }}>{l}</div>
                <div style={{ fontSize:14,fontWeight:600,color:"#1f2937" }}>{v||"—"}</div>
              </div>
            ))}
          </div>
          {d.notlar && <div style={{ padding:"8px 14px",background:"#fffbeb",borderRadius:8,fontSize:13,marginBottom:14,color:"#92400e" }}>📝 {d.notlar}</div>}

          {/* Kalemler */}
          <div style={{ overflowX:"auto",marginBottom:16 }}>
            <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13 }}>
              <thead>
                <tr style={{ background:"#1e3a5f",color:"#fff" }}>
                  {["#","Malzeme Adı","Miktar","Birim","Birim Fiyat","Toplam","Temin Türü","Not"].map(h=>(
                    <th key={h} style={{ padding:"8px 10px",textAlign:"left",fontWeight:600,whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detayKalemler.map((k,i)=>(
                  <tr key={k.id} style={{ borderBottom:"1px solid #e5e7eb",background:i%2===0?"#fff":"#f9fafb" }}>
                    <td style={{ padding:"8px 10px",color:"#9ca3af" }}>{i+1}</td>
                    <td style={{ padding:"8px 10px",fontWeight:600 }}>{k.malzeme_adi}</td>
                    <td style={{ padding:"8px 10px",textAlign:"center" }}>{k.miktar}</td>
                    <td style={{ padding:"8px 10px" }}>{k.birim}</td>
                    <td style={{ padding:"8px 10px" }}>
                      {canMurat ? (
                        <input type="number" value={k.birim_fiyat}
                          onChange={e=>setDetayKalemler(prev=>prev.map((x,j)=>j===i?{...x,birim_fiyat:e.target.value,toplam_tutar:e.target.value*x.miktar}:x))}
                          style={{ width:90,padding:"4px 6px",border:"1px solid #d1d5db",borderRadius:4,fontSize:12 }} />
                      ) : (Number(k.birim_fiyat||0)>0 ? `₺${Number(k.birim_fiyat).toLocaleString("tr-TR")}` : "—")}
                    </td>
                    <td style={{ padding:"8px 10px",fontWeight:700,color:"#15803d" }}>
                      {Number(k.toplam_tutar||0)>0 ? `₺${Number(k.toplam_tutar).toLocaleString("tr-TR")}` : "—"}
                    </td>
                    <td style={{ padding:"8px 10px" }}>
                      {canMurat ? (
                        <select value={k.temin_turu} onChange={e=>setDetayKalemler(prev=>prev.map((x,j)=>j===i?{...x,temin_turu:e.target.value}:x))}
                          style={{ padding:"4px 6px",border:"1px solid #d1d5db",borderRadius:4,fontSize:12 }}>
                          <option value="">Seç</option>
                          <option value="Yeni Alım">Yeni Alım</option>
                          <option value="Depo Stok">Depo Stok</option>
                        </select>
                      ) : (k.temin_turu ? (
                        <span style={{ padding:"2px 8px",borderRadius:8,fontSize:11,fontWeight:700,
                          background:k.temin_turu==="Yeni Alım"?"#dbeafe":"#dcfce7",
                          color:k.temin_turu==="Yeni Alım"?"#1d4ed8":"#15803d" }}>{k.temin_turu}</span>
                      ) : "—")}
                    </td>
                    <td style={{ padding:"8px 10px",color:"#6b7280",fontSize:12 }}>{k.notlar}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background:"#f0f9ff",fontWeight:700 }}>
                  <td colSpan={5} style={{ padding:"8px 10px",textAlign:"right" }}>Genel Toplam:</td>
                  <td style={{ padding:"8px 10px",color:"#15803d",fontSize:15 }}>
                    ₺{detayKalemler.reduce((s,k)=>s+Number(k.toplam_tutar||0),0).toLocaleString("tr-TR")}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Onay notu */}
          {(canNurcan||canMurat||canPM||canDuzgun) && (
            <div style={{ marginBottom:14 }}>
              <label style={{ fontSize:13,fontWeight:600,display:"block",marginBottom:6 }}>Onay Notu (isteğe bağlı)</label>
              <textarea value={onayNotu} onChange={e=>setOnayNotu(e.target.value)} rows={2}
                style={{ width:"100%",padding:"8px 10px",border:"1px solid #d1d5db",borderRadius:8,fontSize:13,resize:"vertical",boxSizing:"border-box" }} />
            </div>
          )}

          {/* Aksiyon butonları */}
          <div style={{ display:"flex",gap:10,flexWrap:"wrap" }}>
            {canNurcan   && <button onClick={()=>updateDurum(d.id,"FIYAT_GIRISI",null,onayNotu)} disabled={saving} style={{ padding:"10px 18px",background:"#8b5cf6",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700 }}>✅ Onayla → Fiyat Girişi</button>}
            {canMurat    && <button onClick={()=>updateDurum(d.id,"PM_ONAY",detayKalemler,onayNotu)} disabled={saving} style={{ padding:"10px 18px",background:"#2563eb",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700 }}>✅ Fiyatları Kaydet → PM'e Gönder</button>}
            {canPM       && <button onClick={()=>updateDurum(d.id,"DUZGUN_ONAY",null,onayNotu)} disabled={saving} style={{ padding:"10px 18px",background:"#0284c7",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700 }}>✅ Onayla → Düzgün'e Gönder</button>}
            {canDuzgun   && <button onClick={()=>updateDurum(d.id,"ONAYLANDI",null,onayNotu)} disabled={saving} style={{ padding:"10px 18px",background:"#16a34a",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700 }}>✅ Onayla</button>}
            {canOnay     && <button onClick={()=>updateDurum(d.id,"SATINALINACAK",null,onayNotu)} disabled={saving} style={{ padding:"10px 18px",background:"#ea580c",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700 }}>🛒 Satın Alınacak</button>}
            {canDepoda   && <button onClick={()=>updateDurum(d.id,"DEPODA",null,onayNotu)} disabled={saving} style={{ padding:"10px 18px",background:"#15803d",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700 }}>📦 Depoya Girdi</button>}
            {canReddet   && <button onClick={()=>{setRedModal(d);setDetayModal(null);setRedNot("");}} style={{ padding:"10px 18px",background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700 }}>❌ Reddet</button>}
          </div>
        </div>
      </div>
    );
  };

  // ── FORM GÖRÜNÜMÜ ──
  if (formView === "form") {
    const toplamGenel = talepKalemler.reduce((s,k)=>s+(Number(k.miktar)||0)*(Number(k.birim_fiyat)||0),0);
    return (
      <div style={{ minHeight:"100vh",background:"#f1f5f9",fontFamily:"Inter,sans-serif" }}>
        {/* Header */}
        <div style={{ background:"#1e3a5f",color:"#fff",padding:"16px 20px",display:"flex",alignItems:"center",gap:12 }}>
          <button onClick={()=>{setFormView(null);setEditingId(null);setTalepForm(emptyForm());setTalepKalemler([{malzeme_adi:"",miktar:1,birim:"Adet",birim_fiyat:"",notlar:""}]);}}
            style={{ background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer",padding:0 }}>←</button>
          <div>
            <h1 style={{ margin:0,fontSize:18,fontWeight:800 }}>{editingId?"✏️ Talebi Düzenle":"➕ Yeni Malzeme Talebi"}</h1>
            {editingId && <div style={{ fontSize:12,opacity:0.75 }}>Talep #{editingId}</div>}
          </div>
        </div>

        <div style={{ maxWidth:880,margin:"0 auto",padding:20 }}>
          {/* Talep Bilgileri */}
          <div style={{ background:"#fff",borderRadius:12,padding:20,marginBottom:16,boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize:15,fontWeight:700,color:"#1e3a5f",marginBottom:14 }}>📋 Talep Bilgileri</div>
            {/* Satır 1: Bölge | Proje | Site Tipi */}
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12 }}>
              <div>
                <label style={{ fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5 }}>Bölge <span style={{color:"#dc2626"}}>*</span></label>
                <select value={talepForm.bolge} onChange={e=>setTalepForm(p=>({...p,bolge:e.target.value}))}
                  style={{ width:"100%",padding:"10px 10px",border:"1px solid #d1d5db",borderRadius:7,fontSize:13,boxSizing:"border-box",height:40 }}>
                  <option value="">Seçin...</option>
                  {BOLGELER.map(b=><option key={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5 }}>Proje <span style={{color:"#dc2626"}}>*</span></label>
                <select value={talepForm.proje} onChange={e=>setTalepForm(p=>({...p,proje:e.target.value}))}
                  style={{ width:"100%",padding:"10px 10px",border:"1px solid #d1d5db",borderRadius:7,fontSize:13,boxSizing:"border-box",height:40 }}>
                  <option value="">Seçin...</option>
                  {PROJELER.map(b=><option key={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5 }}>Site Tipi</label>
                <select value={talepForm.site_type} onChange={e=>setTalepForm(p=>({...p,site_type:e.target.value}))}
                  style={{ width:"100%",padding:"10px 10px",border:"1px solid #d1d5db",borderRadius:7,fontSize:13,boxSizing:"border-box",height:40 }}>
                  <option value="">Seçin...</option>
                  {SITE_TYPES.map(b=><option key={b}>{b}</option>)}
                </select>
              </div>
            </div>
            {/* Satır 2: Site ID (autocomplete) | Talep Eden | Talep Tarihi */}
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12 }}>
              <div style={{ position:"relative" }}>
                <label style={{ fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5 }}>Site ID <span style={{color:"#dc2626"}}>*</span></label>
                <input placeholder="Site kodu yazın..." value={talepForm.site_id||""}
                  onChange={e=>{
                    setTalepForm(p=>({...p,site_id:e.target.value}));
                    searchSiteCode(e.target.value);
                    setShowSiteDropdown(true);
                  }}
                  onBlur={()=>setTimeout(()=>setShowSiteDropdown(false),200)}
                  onFocus={()=>{ if(talepForm.site_id?.length>=2) setShowSiteDropdown(true); }}
                  style={{ width:"100%",padding:"10px 10px",border:`1px solid ${talepForm.site_id?"#16a34a":"#d1d5db"}`,borderRadius:7,fontSize:13,boxSizing:"border-box",height:40 }} />
                {showSiteDropdown && siteCodeSuggestions.length>0 && (
                  <div style={{ position:"absolute",top:"100%",left:0,right:0,zIndex:300,background:"#fff",border:"1px solid #d1d5db",borderRadius:7,boxShadow:"0 4px 16px rgba(0,0,0,0.15)",maxHeight:200,overflowY:"auto" }}>
                    {siteCodeSuggestions.map(s=>(
                      <div key={s.site_code} onMouseDown={e=>{
                        e.preventDefault();
                        setTalepForm(p=>({...p, site_id:s.site_code, site_type:s.site_type||p.site_type, bolge:s.bolge||p.bolge}));
                        setShowSiteDropdown(false);
                      }} style={{ padding:"8px 12px",cursor:"pointer",fontSize:12,borderBottom:"1px solid #f3f4f6",display:"flex",justifyContent:"space-between" }}>
                        <span style={{fontWeight:700}}>{s.site_code}</span>
                        <span style={{color:"#9ca3af"}}>{[s.bolge,s.site_type,s.project_code].filter(Boolean).join(" · ")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label style={{ fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5 }}>Talep Eden</label>
                <input value={talepForm.talep_eden_ad} readOnly
                  style={{ width:"100%",padding:"10px 10px",border:"1px solid #e5e7eb",borderRadius:7,fontSize:13,background:"#f9fafb",boxSizing:"border-box",height:40 }} />
              </div>
              <div>
                <label style={{ fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5 }}>Talep Tarihi</label>
                <input type="date" value={talepForm.talep_tarihi} onChange={e=>setTalepForm(p=>({...p,talep_tarihi:e.target.value}))}
                  style={{ width:"100%",padding:"10px 10px",border:"1px solid #d1d5db",borderRadius:7,fontSize:13,boxSizing:"border-box",height:40 }} />
              </div>
            </div>
            {/* Satır 3: Talep Edilen Firma | boş | boş */}
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12 }}>
              <div>
                <label style={{ fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5 }}>Talep Edilen Firma</label>
                <select value={talepForm.talep_edilen_firma} onChange={e=>setTalepForm(p=>({...p,talep_edilen_firma:e.target.value}))}
                  style={{ width:"100%",padding:"10px 10px",border:"1px solid #d1d5db",borderRadius:7,fontSize:13,boxSizing:"border-box",height:40 }}>
                  <option value="">Seçin...</option>
                  {FIRMALAR.map(b=><option key={b}>{b}</option>)}
                </select>
              </div>
              <div style={{ gridColumn:"span 2" }}>
                <label style={{ fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5 }}>Talep Edilen Personel</label>
                <div style={{ display:"flex",gap:8,height:40 }}>
                  {!talepForm.talep_edilen_personel_manuel ? (
                    <select value={talepForm.talep_edilen_personel} onChange={e=>setTalepForm(p=>({...p,talep_edilen_personel:e.target.value}))}
                      style={{ flex:1,padding:"10px 10px",border:"1px solid #d1d5db",borderRadius:7,fontSize:13,height:40,boxSizing:"border-box" }}>
                      <option value="">Personel listesinden seçin...</option>
                      {personelListe.map(p=><option key={p.id} value={p.ad_soyad}>{p.ad_soyad}</option>)}
                    </select>
                  ) : (
                    <input placeholder="Personel adı yazın..." value={talepForm.talep_edilen_personel}
                      onChange={e=>setTalepForm(p=>({...p,talep_edilen_personel:e.target.value}))}
                      style={{ flex:1,padding:"10px 10px",border:"1px solid #d1d5db",borderRadius:7,fontSize:13,height:40,boxSizing:"border-box" }} />
                  )}
                  <button type="button" onClick={()=>setTalepForm(p=>({...p,talep_edilen_personel_manuel:!p.talep_edilen_personel_manuel,talep_edilen_personel:""}))}
                    style={{ padding:"0 14px",background:"#f3f4f6",border:"1px solid #d1d5db",borderRadius:7,fontSize:12,cursor:"pointer",whiteSpace:"nowrap",height:40 }}>
                    ✏️ {talepForm.talep_edilen_personel_manuel?"Listeden Seç":"Manuel Gir"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Malzeme Kalemleri */}
          <div style={{ background:"#fff",borderRadius:12,padding:20,marginBottom:16,boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
              <div style={{ fontSize:15,fontWeight:700,color:"#1e3a5f" }}>📦 Malzeme Kalemleri</div>
              <button onClick={()=>setTalepKalemler(prev=>[...prev,{malzeme_adi:"",miktar:1,birim:"Adet",birim_fiyat:"",notlar:""}])}
                style={{ padding:"7px 14px",background:"#f0fdf4",color:"#15803d",border:"1px solid #bbf7d0",borderRadius:7,cursor:"pointer",fontSize:12,fontWeight:700 }}>
                + Kalem Ekle
              </button>
            </div>
            {/* Başlıklar */}
            <div style={{ display:"grid",gridTemplateColumns:"2fr 80px 100px 120px 100px 100px 36px",gap:8,marginBottom:6 }}>
              {["Malzeme Adı","Miktar","Birim","Birim Fiyat ₺","Toplam","Not",""].map(h=>(
                <div key={h} style={{ fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.3px",padding:"0 2px" }}>{h}</div>
              ))}
            </div>
            {talepKalemler.map((k,i)=>renderKalemRow(k,i))}
            {/* Genel Toplam */}
            {toplamGenel > 0 && (
              <div style={{ display:"flex",justifyContent:"flex-end",marginTop:12,paddingTop:12,borderTop:"2px solid #e5e7eb" }}>
                <div style={{ fontSize:16,fontWeight:800,color:"#15803d" }}>
                  Genel Toplam: ₺{toplamGenel.toLocaleString("tr-TR")}
                </div>
              </div>
            )}
          </div>

          {/* Açıklama */}
          <div style={{ background:"#fff",borderRadius:12,padding:20,marginBottom:20,boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
            <label style={{ fontSize:13,fontWeight:700,display:"block",marginBottom:8,color:"#1e3a5f" }}>💬 Açıklama / Not</label>
            <textarea value={talepForm.notlar} onChange={e=>setTalepForm(p=>({...p,notlar:e.target.value}))} rows={3}
              placeholder="Talep ile ilgili açıklama veya notunuzu yazın..."
              style={{ width:"100%",padding:"10px 12px",border:"1px solid #d1d5db",borderRadius:8,fontSize:13,resize:"vertical",boxSizing:"border-box" }} />
          </div>

          {/* Butonlar */}
          <div style={{ display:"flex",gap:12,justifyContent:"flex-end",paddingBottom:20 }}>
            <button onClick={()=>{setFormView(null);setEditingId(null);setTalepForm(emptyForm());setTalepKalemler([{malzeme_adi:"",miktar:1,birim:"Adet",birim_fiyat:"",notlar:""}]);}}
              style={{ padding:"12px 24px",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:9,cursor:"pointer",fontWeight:700 }}>
              İptal
            </button>
            <button onClick={()=>saveTalep("TASLAK")} disabled={saving}
              style={{ padding:"12px 24px",background:"#e5e7eb",color:"#374151",border:"2px solid #d1d5db",borderRadius:9,cursor:"pointer",fontWeight:700 }}>
              {saving?"Kaydediliyor...":"💾 Taslağa Kaydet"}
            </button>
            <button onClick={()=>{
              // Hiyerarşiye göre ilk onay adımını belirle:
              // Nurcan Kuş → Orhan Bedir - Murat İstek - Düzgün Şimşek - Murat İstek
              const submitDurum = isDirektor ? "ONAYLANDI"
                : isMurat    ? "DUZGUN_ONAY"
                : isPM       ? "FIYAT_GIRISI"   // Orhan → Nurcan'ı atla, Murat'a git
                : isNurcan   ? "PM_ONAY"         // Nurcan → kendini atla, Orhan'a git
                : "NURCAN_ONAY";                 // Diğerleri → Nurcan'dan başla
              saveTalep(submitDurum);
            }} disabled={saving}
              style={{ padding:"12px 28px",background:"#1e3a5f",color:"#fff",border:"none",borderRadius:9,cursor:"pointer",fontWeight:700,fontSize:15 }}>
              {saving?"Gönderiliyor...":"📤 Onaya Gönder"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── ANA GÖRÜNÜM (liste + sekmeler) ──
  return (
    <div style={{ minHeight:"100vh",background:"#f1f5f9",fontFamily:"Inter,sans-serif" }}>
      {/* Header */}
      <div style={{ background:"#1e3a5f",color:"#fff",padding:"16px 20px",display:"flex",alignItems:"center",gap:12 }}>
        <button onClick={onBack} style={{ background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer",padding:0 }}>←</button>
        <div>
          <h1 style={{ margin:0,fontSize:20,fontWeight:800 }}>📦 Malzeme Yönetimi</h1>
          <div style={{ fontSize:12,opacity:0.75 }}>Talep · Stok · Fiyat Listesi</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex",borderBottom:"2px solid #e2e8f0",background:"#fff",padding:"0 16px",gap:4 }}>
        {[["talepler","📋 Talepler"],
          ...(canSeeDepo?[["depo","🏭 Depo Stok"],["fiyat","💰 Fiyat Listesi"]]:[])
        ].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)}
            style={{ padding:"12px 16px",background:"none",border:"none",cursor:"pointer",fontWeight:tab===k?700:400,fontSize:14,
              color:tab===k?"#1e3a5f":"#6b7280",borderBottom:tab===k?"3px solid #1e3a5f":"3px solid transparent",marginBottom:-2 }}>
            {l}
          </button>
        ))}
      </div>

      <div style={{ padding:16,maxWidth:960,margin:"0 auto" }}>

        {/* ── TALEPLER SEKMESİ ── */}
        {tab==="talepler" && (
          <div>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
              <div style={{ fontSize:16,fontWeight:700,color:"#1e3a5f" }}>
                Malzeme Talepleri {talepLoading&&<span style={{fontSize:12,color:"#9ca3af"}}>yükleniyor…</span>}
              </div>
              <button onClick={()=>{setTalepForm(emptyForm());setTalepKalemler([{malzeme_adi:"",miktar:1,birim:"Adet",birim_fiyat:"",notlar:""}]);setEditingId(null);setFormView("form");}}
                style={{ padding:"10px 20px",background:"#1e3a5f",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:14 }}>
                + Yeni Talep
              </button>
            </div>
            {talepler.length===0&&!talepLoading&&<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}>Henüz talep yok.</div>}
            <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
              {talepler.map(t=>(
                <div key={t.id}
                  style={{ background:"#fff",borderRadius:12,padding:"14px 18px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)",
                    borderLeft:`4px solid ${t.durum==="TASLAK"?"#9ca3af":t.durum==="REDDEDILDI"?"#dc2626":t.durum==="DEPODA"?"#15803d":"#1e3a5f"}` }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap" }}>
                    <div style={{ cursor:"pointer",flex:1 }} onClick={()=>loadDetay(t.id)}>
                      <div style={{ fontWeight:700,fontSize:15,marginBottom:4 }}>{t.talep_no} · {t.talep_eden_ad}</div>
                      <div style={{ fontSize:12,color:"#6b7280",display:"flex",gap:12,flexWrap:"wrap" }}>
                        {t.bolge&&<span>📍 {t.bolge}</span>}
                        {t.proje&&<span>🏗 {t.proje}</span>}
                        {t.site_type&&<span>📡 {t.site_type}</span>}
                        {t.site_id&&<span>🔖 {t.site_id}</span>}
                        {t.talep_edilen_firma&&<span>🏢 {t.talep_edilen_firma}</span>}
                        <span>📅 {t.talep_tarihi ? new Date(t.talep_tarihi).toLocaleDateString("tr-TR") : new Date(t.created_at).toLocaleDateString("tr-TR")}</span>
                        <span>{Number(t.kalem_sayisi)} kalem</span>
                        {Number(t.toplam_tutar)>0&&<span style={{color:"#15803d",fontWeight:700}}>₺{Number(t.toplam_tutar).toLocaleString("tr-TR")}</span>}
                      </div>
                    </div>
                    <div style={{ display:"flex",gap:8,alignItems:"center",flexWrap:"wrap" }}>
                      {durumBadge(t.durum)}
                      {["TASLAK","REDDEDILDI"].includes(t.durum) && t.talep_eden_email===currentUser?.email && (<>
                        <button onClick={()=>openEdit(t)}
                          style={{ padding:"5px 12px",background:"#dbeafe",color:"#1d4ed8",border:"none",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:700 }}>
                          ✏️ Düzenle
                        </button>
                        <button onClick={e=>{e.stopPropagation();deleteTalep(t.id);}}
                          style={{ padding:"5px 12px",background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:700 }}>
                          🗑 Sil
                        </button>
                      </>)}
                      <span style={{color:"#9ca3af",fontSize:18,cursor:"pointer"}} onClick={()=>loadDetay(t.id)}>›</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── DEPO STOK ── */}
        {tab==="depo" && canSeeDepo && (
          <div>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
              <div style={{ fontSize:16,fontWeight:700,color:"#1e3a5f" }}>🏭 Depo Stok Durumu</div>
              {(isAdmin||isPM||isDirektor) && (
                <button onClick={()=>{setDepoEditModal({id:null});setDepoEditForm({malzeme_adi:"",birim:"Adet",toplam_miktar:"",aciklama:""});}}
                  style={{ padding:"9px 18px",background:"#1e3a5f",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:14 }}>
                  + Manuel Stok Girişi
                </button>
              )}
            </div>
            <div style={{ overflowX:"auto",background:"#fff",borderRadius:12,boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
              <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13 }}>
                <thead>
                  <tr style={{ background:"#1e3a5f",color:"#fff" }}>
                    {["Malzeme Adı","Toplam Stok","Birim","Depoda Kalan","Personelde","Rezerve","Açıklama",""].map(h=>(
                      <th key={h} style={{ padding:"10px 12px",textAlign:"left",fontWeight:600,whiteSpace:"nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {depoStok.length===0&&<tr><td colSpan={8} style={{padding:32,textAlign:"center",color:"#9ca3af"}}>Depo kaydı yok.</td></tr>}
                  {depoStok.map((s,i)=>(
                    <tr key={s.id} style={{ borderBottom:"1px solid #f0f4f8",background:i%2===0?"#fff":"#f8fafc" }}>
                      <td style={{ padding:"10px 12px",fontWeight:600 }}>{s.malzeme_adi}</td>
                      <td style={{ padding:"10px 12px",textAlign:"center" }}>{Number(s.toplam_miktar).toLocaleString("tr-TR")}</td>
                      <td style={{ padding:"10px 12px" }}>{s.birim}</td>
                      <td style={{ padding:"10px 12px",textAlign:"center",fontWeight:700,color:Number(s.depoda_kalan)<0?"#dc2626":"#15803d" }}>{Number(s.depoda_kalan).toLocaleString("tr-TR")}</td>
                      <td style={{ padding:"10px 12px",textAlign:"center",color:"#92400e" }}>{Number(s.personelde||0).toLocaleString("tr-TR")}</td>
                      <td style={{ padding:"10px 12px",textAlign:"center",color:"#7c3aed" }}>{Number(s.rezerve||0).toLocaleString("tr-TR")}</td>
                      <td style={{ padding:"10px 12px",color:"#6b7280",fontSize:12 }}>{s.aciklama}</td>
                      <td style={{ padding:"8px 10px" }}>
                        <div style={{ display:"flex",gap:6 }}>
                          <button onClick={()=>{setSarfModal(s);setSarfForm({miktar:"",personel_ad:"",lokasyon:"",islem_turu:"CIKIS",notlar:""});loadSarf(s.malzeme_adi);}}
                            style={{ padding:"5px 10px",background:"#dbeafe",color:"#1d4ed8",border:"none",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700 }}>📤 Sarf</button>
                          {(isAdmin||isPM)&&<button onClick={()=>{setDepoEditModal(s);setDepoEditForm({...s});}}
                            style={{ padding:"5px 10px",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:6,cursor:"pointer",fontSize:11 }}>✏️</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── FİYAT LİSTESİ ── */}
        {tab==="fiyat" && canSeeDepo && (
          <div>
            <div style={{ fontSize:16,fontWeight:700,color:"#1e3a5f",marginBottom:16 }}>💰 Malzeme Fiyat Listesi</div>
            {canEditFiyat && (
              <div style={{ background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:16 }}>
                <div style={{ fontSize:14,fontWeight:700,marginBottom:12 }}>{fiyatEditId?"✏️ Malzeme Düzenle":"➕ Yeni Malzeme Ekle"}</div>
                <div style={{ display:"grid",gridTemplateColumns:"2fr 100px 100px 130px auto",gap:8,alignItems:"end" }}>
                  <div>
                    <label style={{ fontSize:12,color:"#6b7280",display:"block",marginBottom:4 }}>Malzeme Adı</label>
                    <input value={fiyatForm.malzeme_adi} onChange={e=>setFiyatForm(p=>({...p,malzeme_adi:e.target.value}))} placeholder="Malzeme adı"
                      style={{ width:"100%",padding:"8px 10px",border:"1px solid #d1d5db",borderRadius:6,fontSize:13,boxSizing:"border-box" }} />
                  </div>
                  <div>
                    <label style={{ fontSize:12,color:"#6b7280",display:"block",marginBottom:4 }}>Birim</label>
                    <select value={fiyatForm.birim} onChange={e=>setFiyatForm(p=>({...p,birim:e.target.value}))}
                      style={{ width:"100%",padding:"8px 6px",border:"1px solid #d1d5db",borderRadius:6,fontSize:13 }}>
                      {["Adet","Metre","Rulo","Kutu","Kg","Lt","Paket","Set","Takım"].map(u=><option key={u}>{u}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize:12,color:"#6b7280",display:"block",marginBottom:4 }}>Birim Fiyat ₺</label>
                    <input type="number" value={fiyatForm.birim_fiyat} onChange={e=>setFiyatForm(p=>({...p,birim_fiyat:e.target.value}))} placeholder="0"
                      style={{ width:"100%",padding:"8px 10px",border:"1px solid #d1d5db",borderRadius:6,fontSize:13,boxSizing:"border-box" }} />
                  </div>
                  <div>
                    <label style={{ fontSize:12,color:"#6b7280",display:"block",marginBottom:4 }}>Kategori</label>
                    <input value={fiyatForm.kategori} onChange={e=>setFiyatForm(p=>({...p,kategori:e.target.value}))} placeholder="Genel"
                      style={{ width:"100%",padding:"8px 10px",border:"1px solid #d1d5db",borderRadius:6,fontSize:13,boxSizing:"border-box" }} />
                  </div>
                  <div style={{ display:"flex",gap:6 }}>
                    <button onClick={handleFiyatSave} disabled={saving}
                      style={{ padding:"8px 16px",background:"#1e3a5f",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontWeight:700,fontSize:13,whiteSpace:"nowrap" }}>
                      {fiyatEditId?"Güncelle":"Ekle"}
                    </button>
                    {fiyatEditId&&<button onClick={()=>{setFiyatEditId(null);setFiyatForm({malzeme_adi:"",birim:"Adet",birim_fiyat:"",kategori:"Genel"});}}
                      style={{ padding:"8px 12px",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:6,cursor:"pointer" }}>İptal</button>}
                  </div>
                </div>
              </div>
            )}
            <div style={{ overflowX:"auto",background:"#fff",borderRadius:12,boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
              <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13 }}>
                <thead>
                  <tr style={{ background:"#1e3a5f",color:"#fff" }}>
                    {["Malzeme Adı","Birim","Birim Fiyat","Kategori",""].map(h=>(
                      <th key={h} style={{ padding:"10px 14px",textAlign:"left",fontWeight:600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fiyatListe.length===0&&<tr><td colSpan={5} style={{padding:32,textAlign:"center",color:"#9ca3af"}}>Fiyat listesi boş.</td></tr>}
                  {fiyatListe.map((f,i)=>(
                    <tr key={f.id} style={{ borderBottom:"1px solid #f0f4f8",background:i%2===0?"#fff":"#f8fafc" }}>
                      <td style={{ padding:"9px 14px",fontWeight:600 }}>{f.malzeme_adi}</td>
                      <td style={{ padding:"9px 14px" }}>{f.birim}</td>
                      <td style={{ padding:"9px 14px",fontWeight:700,color:Number(f.birim_fiyat)>0?"#15803d":"#9ca3af" }}>
                        {Number(f.birim_fiyat)>0 ? `₺${Number(f.birim_fiyat).toLocaleString("tr-TR")}` : "—"}
                      </td>
                      <td style={{ padding:"9px 14px" }}><span style={{ padding:"2px 8px",borderRadius:8,background:"#f0f4ff",color:"#3730a3",fontSize:11,fontWeight:600 }}>{f.kategori}</span></td>
                      <td style={{ padding:"9px 10px" }}>
                        {canEditFiyat&&<div style={{ display:"flex",gap:6 }}>
                          <button onClick={()=>{setFiyatEditId(f.id);setFiyatForm({malzeme_adi:f.malzeme_adi,birim:f.birim,birim_fiyat:f.birim_fiyat,kategori:f.kategori});}}
                            style={{ padding:"4px 10px",background:"#f0f9ff",color:"#0284c7",border:"none",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700 }}>✏️</button>
                          <button onClick={()=>handleFiyatDelete(f.id)}
                            style={{ padding:"4px 10px",background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700 }}>🗑️</button>
                        </div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* DETAY MODAL */}
      {renderDetayModal()}

      {/* RED MODAL */}
      {redModal&&(
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:2100,display:"flex",alignItems:"center",justifyContent:"center",padding:16 }}>
          <div style={{ background:"#fff",borderRadius:16,width:"100%",maxWidth:420,padding:24 }}>
            <h3 style={{ margin:"0 0 16px",fontSize:18,fontWeight:800,color:"#dc2626" }}>❌ Talebi Reddet</h3>
            <textarea value={redNot} onChange={e=>setRedNot(e.target.value)} rows={3} placeholder="Red nedenini yazın..."
              style={{ width:"100%",padding:"10px 12px",border:"1px solid #fca5a5",borderRadius:8,fontSize:13,resize:"vertical",boxSizing:"border-box",marginBottom:16 }} />
            <div style={{ display:"flex",gap:10,justifyContent:"flex-end" }}>
              <button onClick={()=>setRedModal(null)} style={{ padding:"10px 20px",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700 }}>İptal</button>
              <button onClick={()=>{updateDurum(redModal.id,"REDDEDILDI",null,redNot);setRedModal(null);}}
                style={{ padding:"10px 20px",background:"#dc2626",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700 }}>Reddet</button>
            </div>
          </div>
        </div>
      )}

      {/* SARF MODAL */}
      {sarfModal&&(
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16 }}>
          <div style={{ background:"#fff",borderRadius:16,width:"100%",maxWidth:500,padding:24 }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
              <h3 style={{ margin:0,fontSize:18,fontWeight:800 }}>📤 Stok Hareketi — {sarfModal.malzeme_adi}</h3>
              <button onClick={()=>setSarfModal(null)} style={{ background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#6b7280" }}>✕</button>
            </div>
            <div style={{ display:"grid",gap:12,marginBottom:16 }}>
              <div>
                <label style={{ fontSize:12,fontWeight:600,display:"block",marginBottom:4 }}>İşlem Türü</label>
                <div style={{ display:"flex",gap:8 }}>
                  {[["CIKIS","📤 Çıkış","#dbeafe","#1d4ed8"],["GIRIS","📥 Giriş","#dcfce7","#15803d"],["REZERVE","🔒 Rezerve","#ede9fe","#7c3aed"]].map(([v,l,bg,c])=>(
                    <button key={v} onClick={()=>setSarfForm(p=>({...p,islem_turu:v}))}
                      style={{ flex:1,padding:"8px 0",background:sarfForm.islem_turu===v?bg:"#f9fafb",color:sarfForm.islem_turu===v?c:"#6b7280",border:`2px solid ${sarfForm.islem_turu===v?c:"#e5e7eb"}`,borderRadius:8,cursor:"pointer",fontWeight:sarfForm.islem_turu===v?700:400,fontSize:13 }}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                <div>
                  <label style={{ fontSize:12,fontWeight:600,display:"block",marginBottom:4 }}>Miktar ({sarfModal.birim})</label>
                  <input type="number" value={sarfForm.miktar} onChange={e=>setSarfForm(p=>({...p,miktar:e.target.value}))}
                    style={{ width:"100%",padding:"8px 10px",border:"1px solid #d1d5db",borderRadius:6,fontSize:13,boxSizing:"border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize:12,fontWeight:600,display:"block",marginBottom:4 }}>Personel / Firma</label>
                  <input value={sarfForm.personel_ad} onChange={e=>setSarfForm(p=>({...p,personel_ad:e.target.value}))} placeholder="Ad Soyad"
                    style={{ width:"100%",padding:"8px 10px",border:"1px solid #d1d5db",borderRadius:6,fontSize:13,boxSizing:"border-box" }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize:12,fontWeight:600,display:"block",marginBottom:4 }}>Lokasyon / Site</label>
                <input value={sarfForm.lokasyon} onChange={e=>setSarfForm(p=>({...p,lokasyon:e.target.value}))} placeholder="Site kodu"
                  style={{ width:"100%",padding:"8px 10px",border:"1px solid #d1d5db",borderRadius:6,fontSize:13,boxSizing:"border-box" }} />
              </div>
            </div>
            {sarfListe.length>0&&(
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:12,fontWeight:700,color:"#6b7280",marginBottom:6 }}>Son Hareketler</div>
                <div style={{ maxHeight:100,overflowY:"auto",border:"1px solid #e5e7eb",borderRadius:8 }}>
                  {sarfListe.slice(0,6).map(s=>(
                    <div key={s.id} style={{ display:"flex",justifyContent:"space-between",padding:"5px 10px",borderBottom:"1px solid #f3f4f6",fontSize:11 }}>
                      <span style={{ color:s.islem_turu==="CIKIS"?"#dc2626":s.islem_turu==="REZERVE"?"#7c3aed":"#15803d",fontWeight:700 }}>
                        {s.islem_turu==="CIKIS"?"📤":s.islem_turu==="REZERVE"?"🔒":"📥"} {s.miktar}
                      </span>
                      <span style={{ color:"#6b7280" }}>{s.personel_ad}</span>
                      <span style={{ color:"#9ca3af" }}>{new Date(s.created_at).toLocaleDateString("tr-TR")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display:"flex",gap:10,justifyContent:"flex-end" }}>
              <button onClick={()=>setSarfModal(null)} style={{ padding:"10px 20px",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700 }}>İptal</button>
              <button onClick={handleSarfSubmit} disabled={saving}
                style={{ padding:"10px 24px",background:"#1e3a5f",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700 }}>
                {saving?"Kaydediliyor...":"Kaydet"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DEPO DÜZENLE MODAL */}
      {depoEditModal&&(
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16 }}>
          <div style={{ background:"#fff",borderRadius:16,width:"100%",maxWidth:440,padding:24 }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
              <h3 style={{ margin:0,fontSize:18,fontWeight:800 }}>🏭 {depoEditModal.id?"Stok Düzenle":"Manuel Stok Girişi"}</h3>
              <button onClick={()=>setDepoEditModal(null)} style={{ background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#6b7280" }}>✕</button>
            </div>
            <div style={{ display:"grid",gap:12,marginBottom:16 }}>
              <div>
                <label style={{ fontSize:12,fontWeight:600,display:"block",marginBottom:4 }}>Malzeme Adı</label>
                <input value={depoEditForm.malzeme_adi||""} onChange={e=>setDepoEditForm(p=>({...p,malzeme_adi:e.target.value}))}
                  style={{ width:"100%",padding:"8px 10px",border:"1px solid #d1d5db",borderRadius:6,fontSize:13,boxSizing:"border-box" }} />
              </div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                <div>
                  <label style={{ fontSize:12,fontWeight:600,display:"block",marginBottom:4 }}>Toplam Stok</label>
                  <input type="number" value={depoEditForm.toplam_miktar||""} onChange={e=>setDepoEditForm(p=>({...p,toplam_miktar:e.target.value}))}
                    style={{ width:"100%",padding:"8px 10px",border:"1px solid #d1d5db",borderRadius:6,fontSize:13,boxSizing:"border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize:12,fontWeight:600,display:"block",marginBottom:4 }}>Birim</label>
                  <select value={depoEditForm.birim||"Adet"} onChange={e=>setDepoEditForm(p=>({...p,birim:e.target.value}))}
                    style={{ width:"100%",padding:"8px 6px",border:"1px solid #d1d5db",borderRadius:6,fontSize:13 }}>
                    {["Adet","Metre","Rulo","Kutu","Kg","Lt","Paket","Set","Takım"].map(u=><option key={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div style={{ display:"flex",gap:10,justifyContent:"flex-end" }}>
              <button onClick={()=>setDepoEditModal(null)} style={{ padding:"10px 20px",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700 }}>İptal</button>
              <button onClick={async()=>{
                setSaving(true);
                try {
                  if(depoEditModal.id){await fetch(`${API_BASE}/malzeme/depo-stok/${depoEditModal.id}`,{method:"PUT",headers,body:JSON.stringify({toplam_miktar:depoEditForm.toplam_miktar,birim:depoEditForm.birim,aciklama:depoEditForm.aciklama})});}
                  else{await fetch(`${API_BASE}/malzeme/depo-stok`,{method:"POST",headers,body:JSON.stringify(depoEditForm)});}
                  setDepoEditModal(null);loadDepoStok();
                }catch(e){alert(e.message);}
                setSaving(false);
              }} disabled={saving}
                style={{ padding:"10px 24px",background:"#1e3a5f",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700 }}>
                {saving?"Kaydediliyor...":"Kaydet"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
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
  // Rollout erişimi var ama Puantaj görmeyecek kullanıcılar (rol ne olursa olsun rollout gibi davranır)
  const _userEmail = (user?.email || "").toLowerCase().trim();
  const _PUANTAJ_HARIC = ["hatice.omus@simsektel.com"];
  const _ROLLOUT_OVERRIDE = ["hatice.omus@simsektel.com"]; // user rolünde olsa bile rollout gibi davranır
  const _isBolgeMudur = _userEmail === "nurcan.kus@simsektel.com" || _userEmail === "serdar.altinova@simsektel.com" || ["rollout_mudur","bolge_mudur"].includes((user?.role||"").toLowerCase());
  const isRollout = user?.role === "rollout" || user?.role === "admin" || _isBolgeMudur || _ROLLOUT_OVERRIDE.includes(_userEmail);
  const canSeePuantaj = isRollout && !_PUANTAJ_HARIC.includes(_userEmail);
  const isPersonel = user?.role === "user" && !_isBolgeMudur && !_ROLLOUT_OVERRIDE.includes(_userEmail);
  const canSeeMalzeme = [
    "nurcan.kus@simsektel.com",
    "murat.istek@simsektel.com",
    "serdar.altinova@simsektel.com",
  ].includes(_userEmail);
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
    const _ue = (u?.email||"").toLowerCase().trim();
    const bolgeMudurEmails = ["nurcan.kus@simsektel.com","serdar.altinova@simsektel.com"];
    const rolloutOverrideEmails = ["hatice.omus@simsektel.com"];
    const isBolge = bolgeMudurEmails.includes(_ue) || ["rollout_mudur","bolge_mudur"].includes((u?.role||"").toLowerCase());
    const isRolloutOverride = rolloutOverrideEmails.includes(_ue);
    if (u?.role === "user" && !isBolge && !isRolloutOverride) return "masraf";
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
  const handleResetPassword = async (userId, userName) => {
    const newPass = window.prompt(`${userName} için yeni şifre girin:`);
    if (!newPass || !newPass.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: newPass.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Şifre değiştirilemedi");
      alert(`${userName} şifresi başarıyla güncellendi.`);
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

      // Reset page based on the logged-in user's role so switching users works correctly
      const _lu = data.user;
      const _lue = (_lu?.email||"").toLowerCase().trim();
      const _bolgeMudurEmails = ["nurcan.kus@simsektel.com","serdar.altinova@simsektel.com"];
      const _rolloutOverrideEmails = ["hatice.omus@simsektel.com"];
      const _luIsBolge = _bolgeMudurEmails.includes(_lue) || ["rollout_mudur","bolge_mudur"].includes((_lu?.role||"").toLowerCase());
      const _luIsRolloutOverride = _rolloutOverrideEmails.includes(_lue);
      if (_lu?.role === "user" && !_luIsBolge && !_luIsRolloutOverride) setPage("masraf");
      else if (_luIsBolge) setPage("region");
      else setPage("finance");

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
        {/* Content area — default masraf, is_avans seçilince o gösterilir */}
        <div style={{ padding:"12px 12px 80px" }}>
          {page === "is_avans"
            ? <IsAvansPanel currentUser={user} onPendingCount={setPendingAvansCount} />
            : <MasrafFormuPanel currentUser={user} onPendingCount={setPendingMasrafCount} />
          }
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

            {canSeePuantaj && (
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

            {(canSeeMalzeme || isAdmin) && (
              <button
                className={page === "malzeme" ? "tab activeTab" : "tab"}
                onClick={() => setPage("malzeme")}
              >
                📦 Malzeme Yönetimi
              </button>
            )}


            {canSeeMalzeme && false && (
              <button
                className={page === "malzeme" ? "tab activeTab" : "tab"}
                onClick={() => setPage("malzeme")}
              >
                📦 Malzeme
              </button>
            )}

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
            onGoToMalzeme={() => setPage("malzeme")}
            onGoToCashflow={() => setPage("cashflow")}
            currentUser={user}
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
      {page === "malzeme" && <MalzemeYonetimiPanel currentUser={user} onBack={()=>setPage("finance")} />}
      {page === "cashflow" && ["orhan.bedir@simsektel.com","duzgun.simsek@simsektel.com"].includes(_userEmail) && <CashFlowPanel currentUser={user} onBack={()=>setPage("finance")} />}
      {page === "puantaj" && canSeePuantaj && <PuantajPanel currentUser={user} onBack={()=>setPage("hr")} />}
      {page === "executive" && <RolloutDashboard currentUser={user} />}
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
                  <option value="rollout_mudur">🏗 Rollout Müdürü</option>
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
                          onClick={() => handleResetPassword(u.id, u.name)}
                          style={{
                            padding: "6px 12px",
                            background: "#eff6ff",
                            color: "#1d4ed8",
                            border: "none", borderRadius: "8px",
                            fontSize: "12px", fontWeight: 600, cursor: "pointer",
                          }}
                          title="Şifre değiştir"
                        >
                          🔑 Şifre
                        </button>
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
      // Otomasyon: kurulum başlamışsa malzeme kesinlikle gelmiş demektir
      // Manuel fallback: malzeme_status = "OK" olarak elle girilmişse
      return getRowsByType(type).filter((r) => {
        const hasInstallStart = String(r.installation_actual_start_date || "").trim() !== "";
        const hasMalzemeOk = String(r.malzeme_status || "").toUpperCase().trim() === "OK";
        return hasInstallStart || hasMalzemeOk;
      }).length;
    }

    // PO Closed: backend summary'den gelen değeri kullan (site_po.due_qty = 0 kontrolü)
    if (item.key === "po_closed") {
      return backendValue;
    }
    if (
      ["5G", "DSS", "LTE", "STANDALONE", "STANDALONE_ABONE"].includes(type) &&
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

      if (type === "STANDALONE_ABONE") {
        return rowType === "STANDALONE" &&
          String(r.enh_site_type || "").trim().toLowerCase() === "abone";
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

    // po_closed için hafta bazlı sayım yapılamaz (tarih yok)
    if (item.key === "po_closed") return 0;

    // rf_equipment_received için tarih alanı yok ama installation_actual_start_date kullanabiliriz
    if (item.key === "rf_equipment_received") {
      return typeRows.filter((r) => {
        // Önce installation start date dene (otomasyon)
        const dateVal = String(r.installation_actual_start_date || "").trim();
        if (!dateVal) return false;
        const week = getWeekNumber(dateVal);
        return week && week <= weekNo;
      }).length;
    }

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

  const makeTable = (title, type, statusTitle, items, opts = {}) => {
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

            {!opts.hideTypeRow && (
              <tr className="excelTypeRow">
                <th>{type}</th>
                <th>{target}</th>
                <th></th>
                <th></th>
                <th></th>
                <th></th>
                <th></th>
              </tr>
            )}

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
          { label: "PO Status(Closed)", key: "po_closed" },
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
              label: "QC(Closed)",
              key: "qc_closed",
              dateField: "qc_closed_date",
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
          { label: "PO Status(Closed)", key: "po_closed" },
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
            label: "QC(Closed)",
            key: "qc_closed",
            dateField: "qc_closed_date",
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
        ], { hideTypeRow: true })}

        {makeTable(`${regionTitle} POWER PLAN TOTAL (Standalone - Abone)`, "STANDALONE_ABONE", "", [
          {
            label: "ENH Proje Plan Start Date",
            key: "enh_plan_start",
            dateField: "enh_plan_start_date",
          },
          {
            label: "ENH Proje Actual End Date",
            key: "enh_actual_end",
            dateField: "enh_actual_end_date",
          },
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
            label: "Abonelik Belgesi Actual End Date",
            key: "abonelik_end",
            dateField: "abonelik_actual_end_date",
          },
        ], { hideTypeRow: true })}
      </div>
    </div>
  );
}
function RolloutEntryModal({ siteCode, rows, onClose, onSaved }) {
  const existingRow = (() => {
    const raw = rows.find(
      (r) =>
        String(r.site_code || "").toUpperCase() ===
        String(siteCode || "").toUpperCase(),
    ) || {};
    // HTML <input type="date"> YYYY-MM-DD ister; DB'den ISO datetime gelebilir → normalize et
    const DATE_FIELDS = [
      "plan_start_date","inst_plan_start_date",
      "installation_actual_start_date","installation_actual_end_date","onair_date",
      "los_plan_date","los_actual_end_date",
      "tss_plan_start_date","tss_actual_end_date",
      "tssr_plan_start_date","tssr_actual_end_date",
      "btk_plan_start_date","btk_actual_end_date","btk_approved",
      "emr_plan_start_date","emr_actual_end_date",
      "trs_plan_start_date","trs_actual_end_date",
      "enh_plan_start_date","enh_actual_end_date","enh_proje_hazir",
      "power_plan_start_date","power_actual_end_date",
      "abonelik_actual_end_date","tt_horizon_actual_end_date",
      "pac_actual_end_date","tamamlanma_tarihi",
    ];
    const norm = { ...raw };
    for (const f of DATE_FIELDS) {
      const v = norm[f];
      if (v && v !== "__NA__") {
        const s = String(v);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
          const d = new Date(s);
          if (!isNaN(d.getTime())) norm[f] = d.toISOString().split("T")[0];
        }
      }
    }
    return norm;
  })();

  const [form, setForm] = useState({
    site_code: siteCode || existingRow.site_code || "",
    site_type: existingRow.site_type || "",
    site_physical_type: existingRow.site_physical_type || "",
    project_code: existingRow.project_code || "",
    malzeme_status: existingRow.malzeme_status || "",
    il: existingRow.il || "",

    rf_subcon: existingRow.rf_subcon || "",
    plan_start_date: /^h(uawei|w)$/i.test(existingRow.rf_subcon||"") && !existingRow.plan_start_date ? "__NA__" : existingRow.plan_start_date || "",
    installation_actual_start_date: /^h(uawei|w)$/i.test(existingRow.rf_subcon||"") && !existingRow.installation_actual_start_date ? "__NA__" : existingRow.installation_actual_start_date || "",
    installation_actual_end_date: /^h(uawei|w)$/i.test(existingRow.rf_subcon||"") && !existingRow.installation_actual_end_date ? "__NA__" : existingRow.installation_actual_end_date || "",
    onair_date: /^h(uawei|w)$/i.test(existingRow.rf_subcon||"") && !existingRow.onair_date ? "__NA__" : existingRow.onair_date || "",
    rf_not: existingRow.rf_not || "",
    atlas_status: existingRow.atlas_status || "",

    los_subcon: existingRow.los_subcon || "",
    los_plan_date: /^h(uawei|w)$/i.test(existingRow.los_subcon||"") && !existingRow.los_plan_date ? "__NA__" : existingRow.los_plan_date || "",
    los_actual_end_date: /^h(uawei|w)$/i.test(existingRow.los_subcon||"") && !existingRow.los_actual_end_date ? "__NA__" : existingRow.los_actual_end_date || "",

    tss_subcon: existingRow.tss_subcon || "",
    tss_plan_start_date: /^h(uawei|w)$/i.test(existingRow.tss_subcon||"") && !existingRow.tss_plan_start_date ? "__NA__" : existingRow.tss_plan_start_date || "",
    tss_actual_end_date: /^h(uawei|w)$/i.test(existingRow.tss_subcon||"") && !existingRow.tss_actual_end_date ? "__NA__" : existingRow.tss_actual_end_date || "",

    tssr_subcon: existingRow.tssr_subcon || "",
    tssr_plan_start_date: /^h(uawei|w)$/i.test(existingRow.tssr_subcon||"") && !existingRow.tssr_plan_start_date ? "__NA__" : existingRow.tssr_plan_start_date || "",
    tssr_actual_end_date: /^h(uawei|w)$/i.test(existingRow.tssr_subcon||"") && !existingRow.tssr_actual_end_date ? "__NA__" : existingRow.tssr_actual_end_date || "",

    btk_subcon: existingRow.btk_subcon || "",
    btk_plan_start_date: /^h(uawei|w)$/i.test(existingRow.btk_subcon||"") && !existingRow.btk_plan_start_date ? "__NA__" : existingRow.btk_plan_start_date || "",
    btk_actual_end_date: /^h(uawei|w)$/i.test(existingRow.btk_subcon||"") && !existingRow.btk_actual_end_date ? "__NA__" : existingRow.btk_actual_end_date || "",
    btk_approved: /^h(uawei|w)$/i.test(existingRow.btk_subcon||"") && !existingRow.btk_approved ? "__NA__" : existingRow.btk_approved || "",
    gs_status: existingRow.gs_status || "",
    survey_note: existingRow.survey_note || "",

    emr_subcon: existingRow.emr_subcon || "",
    emr_plan_start_date: /^h(uawei|w)$/i.test(existingRow.emr_subcon||"") && !existingRow.emr_plan_start_date ? "__NA__" : existingRow.emr_plan_start_date || "",
    emr_actual_end_date: /^h(uawei|w)$/i.test(existingRow.emr_subcon||"") && !existingRow.emr_actual_end_date ? "__NA__" : existingRow.emr_actual_end_date || "",

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
    tamamlanma_tarihi: existingRow.tamamlanma_tarihi || "",

    // ENH Proje: Abone değilse Subcon + Hazır Tarihi kilitli
    enh_proje_subcon: (() => {
      const t = String(existingRow.enh_site_type || "").toLowerCase();
      if (t && t !== "abone" && !existingRow.enh_proje_subcon) return "__NA__";
      return existingRow.enh_proje_subcon || "";
    })(),
    enh_proje_hazir: (() => {
      const t = String(existingRow.enh_site_type || "").toLowerCase();
      if (t && t !== "abone" && !existingRow.enh_proje_hazir) return "__NA__";
      return existingRow.enh_proje_hazir || "";
    })(),
    enh_proje_not: existingRow.enh_proje_not || "",
    enh_proje_belge_url: existingRow.enh_proje_belge_url || "",
    los_belge_url: existingRow.los_belge_url || "",
    tssr_belge_url: existingRow.tssr_belge_url || "",
    btk_belge_url: existingRow.btk_belge_url || "",
    emr_belge_url: existingRow.emr_belge_url || "",
    pac_belge_url: existingRow.pac_belge_url || "",
  });
  const [enhProjeBelgeFile, setEnhProjeBelgeFile] = useState(null);
  const [losBelgeFile, setLosBelgeFile] = useState(null);
  const [tssrBelgeFile, setTssrBelgeFile] = useState(null);
  const [btkBelgeFile, setBtkBelgeFile] = useState(null);
  const [emrBelgeFile, setEmrBelgeFile] = useState(null);
  const [pacBelgeFile, setPacBelgeFile] = useState(null);
  const [enhProjeSaving, setEnhProjeSaving] = useState(false);

  // Subcon HW mi? (HW, Huawei, huawei vb.)
  const isHw = (v) => /^h(uawei|w)$/i.test(String(v || "").trim());

  // HW subcon → ilgili alanları N/A işaretle
  const HW_NA_MAP = {
    rf_subcon:   ["plan_start_date", "installation_actual_start_date", "installation_actual_end_date", "onair_date"],
    los_subcon:  ["los_plan_date", "los_actual_end_date"],
    tss_subcon:  ["tss_plan_start_date", "tss_actual_end_date"],
    tssr_subcon: ["tssr_plan_start_date", "tssr_actual_end_date"],
    btk_subcon:  ["btk_plan_start_date", "btk_actual_end_date", "btk_approved"],
    emr_subcon:  ["emr_plan_start_date", "emr_actual_end_date"],
  };
  const NA_MARKER = "__NA__"; // DB'ye göndermeden önce null'a çevrilecek

  const handleChange = (field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Subcon HW ise bağlı alanları NA_MARKER yap
      if (field in HW_NA_MAP) {
        const naFields = HW_NA_MAP[field];
        if (isHw(value)) {
          naFields.forEach(f => { next[f] = NA_MARKER; });
        } else {
          naFields.forEach(f => {
            if (prev[f] === NA_MARKER) next[f] = "";
          });
        }
      }
      // ENH Site Type Abone değilse ENH Proje Subcon + Hazır Tarihi kilitle
      if (field === "enh_site_type") {
        const isAbone = String(value || "").toLowerCase() === "abone";
        if (!isAbone && value !== "") {
          if (!prev.enh_proje_subcon || prev.enh_proje_subcon === NA_MARKER) next.enh_proje_subcon = NA_MARKER;
          if (!prev.enh_proje_hazir || prev.enh_proje_hazir === NA_MARKER) next.enh_proje_hazir = NA_MARKER;
        } else {
          if (prev.enh_proje_subcon === NA_MARKER) next.enh_proje_subcon = "";
          if (prev.enh_proje_hazir === NA_MARKER) next.enh_proje_hazir = "";
        }
      }
      return next;
    });
  };

  const save = async () => {
    try {
      if (!form.site_code.trim()) {
        alert("Site Code zorunlu");
        return;
      }

      // NA_MARKER değerlerini null'a çevir (DATE kolonu N/A kabul etmez)
      const cleanForm = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v === "__NA__" ? null : v])
      );
      const result = await fetchJson(`${API_BASE}/rollout/update`, {
        method: "POST",
        withAuth: true,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(cleanForm),
      });

      console.log("ROLLOUT SAVE RESULT:", result);

      // Belge upload helper
      const uploadRolloutBelge = async (file, type, field) => {
        const ext = file.name.split(".").pop();
        const signRes = await fetch(`${API_BASE}/rollout/signed-upload-url?rolloutId=${result.row.id}&type=${type}&ext=${ext}`);
        if (!signRes.ok) throw new Error("Signed URL alınamadı");
        const { signedUrl, publicUrl } = await signRes.json();
        const upRes = await fetch(signedUrl, { method:"PUT", body: file, headers:{ "Content-Type": file.type, "x-upsert":"true" } });
        if (!upRes.ok) throw new Error("Supabase yükleme başarısız");
        await fetchJson(`${API_BASE}/rollout/${result.row.id}/belge-url`, {
          method:"POST", withAuth:true, headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ field, url: publicUrl })
        });
        return publicUrl;
      };

      // Tüm belge upload'ları
      const belgeUploads = [
        { file: enhProjeBelgeFile, type:"enh_proje", field:"enh_proje_belge_url", setter: setEnhProjeBelgeFile },
        { file: losBelgeFile,      type:"los",       field:"los_belge_url",       setter: setLosBelgeFile },
        { file: tssrBelgeFile,     type:"tssr",      field:"tssr_belge_url",      setter: setTssrBelgeFile },
        { file: btkBelgeFile,      type:"btk",       field:"btk_belge_url",       setter: setBtkBelgeFile },
        { file: emrBelgeFile,      type:"emr",       field:"emr_belge_url",       setter: setEmrBelgeFile },
        { file: pacBelgeFile,      type:"pac",       field:"pac_belge_url",       setter: setPacBelgeFile },
      ];
      if (result.row?.id) {
        setEnhProjeSaving(true);
        for (const { file, type, field, setter } of belgeUploads) {
          if (!file) continue;
          try {
            const url = await uploadRolloutBelge(file, type, field);
            setForm(prev => ({ ...prev, [field]: url }));
          } catch(e) { alert(`${type.toUpperCase()} belgesi yükleme hatası: ${e.message}`); }
          finally { setter(null); }
        }
        setEnhProjeSaving(false);
      }

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

  const input = (label, field, type = "text", naMsg = "Huawei sorumluluğunda") => {
    const isNA = form[field] === "__NA__";
    return (
      <label className="modalField">
        <span>{label}</span>
        {isNA ? (
          <div style={{
            background:"#f1f5f9", border:"1px solid #cbd5e1", borderRadius:"8px",
            padding:"8px 12px", color:"#94a3b8", fontSize:"13px", fontWeight:600,
            display:"flex", alignItems:"center", gap:"6px"
          }}>
            <span style={{ background:"#e2e8f0", color:"#64748b", padding:"2px 8px", borderRadius:"20px", fontSize:"11px" }}>N/A</span>
            {naMsg}
          </div>
        ) : type === "date" ? (
          <div style={{ display:"flex", alignItems:"center", gap:"4px" }}>
            <input
              type="date"
              value={form[field] || ""}
              onChange={(e) => handleChange(field, e.target.value)}
              style={{ flex:1 }}
            />
            {form[field] && (
              <button
                type="button"
                onClick={() => handleChange(field, "")}
                title="Tarihi temizle"
                style={{ background:"#fee2e2", color:"#dc2626", border:"none", borderRadius:"6px", padding:"4px 8px", cursor:"pointer", fontSize:"13px", lineHeight:1 }}
              >✕</button>
            )}
          </div>
        ) : (
          <input
            type={type}
            value={form[field] || ""}
            onChange={(e) => handleChange(field, e.target.value)}
          />
        )}
      </label>
    );
  };

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

  // Belge upload widget
  const belgeWidget = (urlField, file, setFile) => {
    const currentUrl = form[urlField];
    const accept = ".pdf,.jpg,.jpeg,.png,.dwg,.xlsx,.doc,.docx";
    return (
      <div style={{ marginTop:"8px" }}>
        {currentUrl ? (
          <div style={{ display:"flex", gap:"8px", alignItems:"center", flexWrap:"wrap" }}>
            <a href={currentUrl} target="_blank" rel="noreferrer"
              style={{ background:"#dbeafe", color:"#1d4ed8", padding:"5px 12px", borderRadius:"8px", fontSize:"12px", textDecoration:"none", fontWeight:600 }}>
              📄 Belgeyi Görüntüle
            </a>
            <label style={{ background:"#e0e7ff", color:"#4338ca", padding:"5px 12px", borderRadius:"8px", fontSize:"12px", cursor:"pointer", fontWeight:600 }}>
              🔄 Değiştir
              <input type="file" accept={accept} style={{ display:"none" }} onChange={e=>setFile(e.target.files[0]||null)} />
            </label>
            {file && <span style={{ fontSize:"11px", color:"#059669", fontWeight:600 }}>📎 {file.name}</span>}
          </div>
        ) : (
          <label style={{ display:"inline-flex", alignItems:"center", gap:"6px", background:"#f3f4f6", border:"1px dashed #9ca3af", borderRadius:"8px", padding:"7px 14px", cursor:"pointer", fontSize:"12px" }}>
            📎 Belge Ekle (PDF, JPG, PNG, DWG, Excel, Word)
            <input type="file" accept={accept} style={{ display:"none" }} onChange={e=>setFile(e.target.files[0]||null)} />
            {file && <span style={{ color:"#059669", fontWeight:600 }}>{file.name}</span>}
          </label>
        )}
      </div>
    );
  };

  // Tüm saha belgelerini ZIP olarak indir
  const handleSahaBelgeleriIndir = async () => {
    const belgeler = [
      { url: form.los_belge_url,       ad: "LOS" },
      { url: form.tssr_belge_url,      ad: "TSSR" },
      { url: form.btk_belge_url,       ad: "BTK" },
      { url: form.emr_belge_url,       ad: "EMR" },
      { url: form.pac_belge_url,       ad: "PAC" },
      { url: form.enh_proje_belge_url, ad: "ENH_Proje" },
    ].filter(b => b.url);
    if (belgeler.length === 0) { alert("Bu sahaya ait belge bulunamadı."); return; }
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    let count = 0;
    for (const { url, ad } of belgeler) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const buf = await r.arrayBuffer();
        const ext = url.split("?")[0].split(".").pop() || "pdf";
        zip.file(`${form.site_code}_${ad}.${ext}`, buf);
        count++;
      } catch {}
    }
    if (count === 0) { alert("Belgeler indirilemedi."); return; }
    const blob = await zip.generateAsync({ type:"blob", compression:"DEFLATE", compressionOptions:{ level:6 } });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${form.site_code}_Belgeler.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="rolloutModal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <h2>Rollout Veri Girişi</h2>
          <button onClick={onClose}>✕</button>
        </div>

        {/* ===== Temel Bilgiler ===== */}
        <div className="modalGrid">
          {input("Site Code", "site_code")}
          {select("Site Type", "site_type", ["5G", "DSS", "LTE", "STANDALONE"])}
          {select("Site Fiziksel Tip", "site_physical_type", ["Rooftop","Kule","Gizleme","VF Katılım","TT Katılım","TC Katılım"])}
          {input("Project Code", "project_code")}
          {input("Malzeme Status", "malzeme_status")}
          {input("İl", "il")}
        </div>

        {/* ===== RF ===== */}
        <div style={{ margin:"14px 0 0", padding:"14px 16px", background:"#f8fafc", borderRadius:"12px", border:"1px solid #e2e8f0" }}>
          <div style={{ fontWeight:700, fontSize:"13px", color:"#475569", marginBottom:"10px" }}>📡 RF / Kurulum</div>
          <div className="modalGrid">
            {input("RF Subcon", "rf_subcon")}
            {input("Plan Start Date", "plan_start_date", "date")}
            {input("Installation Start Date", "installation_actual_start_date", "date")}
            {input("Installation End Date", "installation_actual_end_date", "date")}
            {input("OnAir Date", "onair_date", "date")}
            {input("Tamamlanma Tarihi", "tamamlanma_tarihi", "date")}
            {input("RF Not", "rf_not")}
            {input("Atlas Status", "atlas_status")}
          </div>
        </div>

        {/* ===== LOS ===== */}
        <div style={{ margin:"14px 0 0", padding:"14px 16px", background:"#fff7ed", borderRadius:"12px", border:"1px solid #fed7aa" }}>
          <div style={{ fontWeight:700, fontSize:"13px", color:"#c2410c", marginBottom:"10px" }}>📡 LOS</div>
          <div className="modalGrid">
            {input("LOS Subcon", "los_subcon")}
            {input("LOS Plan Date", "los_plan_date", "date")}
            {input("LOS Actual End Date", "los_actual_end_date", "date")}
          </div>
          {belgeWidget("los_belge_url", losBelgeFile, setLosBelgeFile)}
        </div>

        {/* ===== TSS ===== */}
        <div style={{ margin:"14px 0 0", padding:"14px 16px", background:"#f8fafc", borderRadius:"12px", border:"1px solid #e2e8f0" }}>
          <div style={{ fontWeight:700, fontSize:"13px", color:"#475569", marginBottom:"10px" }}>🔧 TSS</div>
          <div className="modalGrid">
            {input("TSS Subcon", "tss_subcon")}
            {input("TSS Plan Start Date", "tss_plan_start_date", "date")}
            {input("TSS Actual End Date", "tss_actual_end_date", "date")}
          </div>
        </div>

        {/* ===== TSSR ===== */}
        <div style={{ margin:"14px 0 0", padding:"14px 16px", background:"#faf5ff", borderRadius:"12px", border:"1px solid #e9d5ff" }}>
          <div style={{ fontWeight:700, fontSize:"13px", color:"#7c3aed", marginBottom:"10px" }}>📋 TSSR</div>
          <div className="modalGrid">
            {input("TSSR Subcon", "tssr_subcon")}
            {input("TSSR Plan Start Date", "tssr_plan_start_date", "date")}
            {input("TSSR Actual End Date", "tssr_actual_end_date", "date")}
          </div>
          {belgeWidget("tssr_belge_url", tssrBelgeFile, setTssrBelgeFile)}
        </div>

        {/* ===== BTK ===== */}
        <div style={{ margin:"14px 0 0", padding:"14px 16px", background:"#fff1f2", borderRadius:"12px", border:"1px solid #fecdd3" }}>
          <div style={{ fontWeight:700, fontSize:"13px", color:"#be123c", marginBottom:"10px" }}>🏛️ BTK</div>
          <div className="modalGrid">
            {input("BTK Subcon", "btk_subcon")}
            {input("BTK Plan Start Date", "btk_plan_start_date", "date")}
            {input("BTK Actual End Date", "btk_actual_end_date", "date")}
            {input("BTK Approval Status", "btk_approved")}
            {input("GS Status", "gs_status")}
            {input("Survey Note", "survey_note")}
          </div>
          {belgeWidget("btk_belge_url", btkBelgeFile, setBtkBelgeFile)}
        </div>

        {/* ===== EMR ===== */}
        <div style={{ margin:"14px 0 0", padding:"14px 16px", background:"#f0fdfa", borderRadius:"12px", border:"1px solid #99f6e4" }}>
          <div style={{ fontWeight:700, fontSize:"13px", color:"#0f766e", marginBottom:"10px" }}>⚙️ EMR</div>
          <div className="modalGrid">
            {input("EMR Subcon", "emr_subcon")}
            {input("EMR Plan Start Date", "emr_plan_start_date", "date")}
            {input("EMR Actual End Date", "emr_actual_end_date", "date")}
          </div>
          {belgeWidget("emr_belge_url", emrBelgeFile, setEmrBelgeFile)}
        </div>

        {/* ===== ENH PROJE (Standalone - Abone) — Montajdan önce ===== */}
        <div style={{ margin:"16px 0 0", padding:"16px", background:"#f0fdf4", borderRadius:"12px", border:"1px solid #bbf7d0" }}>
          <div style={{ fontWeight:700, fontSize:"14px", color:"#166534", marginBottom:"12px" }}>
            🔌 ENH Proje Bilgileri (Standalone / Abone)
          </div>
          <div className="modalGrid">
            {select("ENH Site Type", "enh_site_type", ["Abone", "Süzme", "Abone + Süzme"])}
            {input("ENH Proje Subcon", "enh_proje_subcon", "text", "Sadece Abone tipinde gerekli")}
            {input("ENH Proje Hazır Tarihi", "enh_proje_hazir", "date", "Sadece Abone tipinde gerekli")}
            {input("ENH Proje Not", "enh_proje_not")}
          </div>
          {/* Belge eki */}
          {belgeWidget("enh_proje_belge_url", enhProjeBelgeFile, setEnhProjeBelgeFile)}
        </div>

        {/* ENH Montaj */}
        <div style={{ margin:"16px 0 0", padding:"16px", background:"#fffbeb", borderRadius:"12px", border:"1px solid #fde68a" }}>
          <div style={{ fontWeight:700, fontSize:"14px", color:"#92400e", marginBottom:"12px" }}>⚡ ENH Montaj</div>
          <div className="modalGrid">
            {input("ENH Subcon", "enh_subcon")}
            {input("ENH Plan Start Date", "enh_plan_start_date", "date")}
            {input("ENH Actual End Date", "enh_actual_end_date", "date")}
            {input("ENH Not", "enh_not")}
          </div>
        </div>

        {/* Power */}
        <div style={{ margin:"16px 0 0", padding:"16px", background:"#eff6ff", borderRadius:"12px", border:"1px solid #bfdbfe" }}>
          <div style={{ fontWeight:700, fontSize:"14px", color:"#1e40af", marginBottom:"12px" }}>🔋 Power</div>
          <div className="modalGrid">
            {input("Power Subcon", "power_subcon")}
            {input("Power Plan Start Date", "power_plan_start_date", "date")}
            {input("Power Actual End Date", "power_actual_end_date", "date")}
            {input("Abonelik Actual End Date", "abonelik_actual_end_date", "date")}
            {input("Horizon Actual End Date", "tt_horizon_actual_end_date", "date")}
            {input("PAC Actual End Date", "pac_actual_end_date", "date")}
          </div>
          <div style={{ marginTop:"10px" }}>
            <div style={{ fontSize:"12px", fontWeight:600, color:"#1e40af", marginBottom:"4px" }}>📎 PAC Belgesi</div>
            {belgeWidget("pac_belge_url", pacBelgeFile, setPacBelgeFile)}
          </div>
        </div>

        <div className="modalActions">
          <button className="tab" onClick={onClose}>
            Kapat
          </button>

          {existingRow.id && (
            <button
              className="tab"
              onClick={deleteRollout}
              style={{ background: "#fee2e2", color: "#991b1b", fontWeight: "700" }}
            >
              Kaydı Sil
            </button>
          )}

          <button
            className="tab"
            onClick={handleSahaBelgeleriIndir}
            style={{ background:"#1e293b", color:"#fff", fontWeight:700 }}
          >
            📦 Saha Belgelerini İndir
          </button>

          <button className="saveButton" onClick={save} disabled={enhProjeSaving}>
            {enhProjeSaving ? "⏳ Yükleniyor..." : "Kaydet"}
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
    const yetkiliEmails = ["orhan.bedir@simsektel.com", "nurcan.kus@simsektel.com"];
    if (!yetkiliEmails.includes((currentUser?.email || "").toLowerCase())) {
      alert("Bu işlem için yetkiniz bulunmamaktadır. Dosya silme yetkisi yalnızca Nurcan Kuş ve Orhan Bedir'e aittir.");
      return;
    }
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
            <div style={{ marginTop:"5px", display:"flex", alignItems:"center", gap:"8px" }}>
              <span style={{ fontSize:"13px", fontWeight:600, color:"#374151" }}>💰 Aylık Toplam Kira:</span>
              <span style={{ fontSize:"16px", fontWeight:800, color:"#1e40af", background:"#eff6ff", borderRadius:"8px", padding:"2px 12px" }}>
                ₺{araclar.filter(a=>a.durum==="AKTİF").reduce((s,a)=>s+Number(a.aylik_kira||0),0).toLocaleString("tr-TR")}
              </span>
            </div>
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
    const yetkiliEmails = ["orhan.bedir@simsektel.com", "nurcan.kus@simsektel.com"];
    if (!yetkiliEmails.includes((currentUser?.email || "").toLowerCase())) {
      alert("Bu işlem için yetkiniz bulunmamaktadır. Dosya silme yetkisi yalnızca Nurcan Kuş ve Orhan Bedir'e aittir.");
      return;
    }
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
