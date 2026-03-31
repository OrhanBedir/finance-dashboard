import { useEffect, useMemo, useState, useCallback } from "react";
import "./App.css";

const API_BASE = "https://finance-dashboard-p27v9bgby-orhanbedirs-projects.vercel.app";

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

async function fetchJson(url, options = {}) {
  const token = localStorage.getItem("finance_token") || "";

  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  const text = await response.text();
  console.log("RAW RESPONSE:", text);

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
    <span className={`badge ${safeStatus.toLowerCase()}`}>
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

  if (!requestedQty || requested === 0) {
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
  const code = String(siteCode).toUpperCase().trim();

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

  if (
    code.startsWith("ES") ||
    code.startsWith("BO") ||
    code.startsWith("ZO") ||
    code.startsWith("KA") ||
    code.startsWith("Z")
  ) {
    return "Ankara";
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

      setSummary(summaryData.summary || null);
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
              <th>Currency</th>
              <th>Unit Price</th>
              <th>Total Done Amount</th>
              <th>Subcon</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <EmptyRow colSpan={12} />
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

function DailyEntry() {
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
  };

  const [form, setForm] = useState(initialForm);
  const [rows, setRows] = useState([]);
  const [siteEntries, setSiteEntries] = useState([]);
  const [projectCodes, setProjectCodes] = useState([]);
  const [itemOptions, setItemOptions] = useState([]);
  const [poRows, setPoRows] = useState([]);
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

  useEffect(() => {
    loadRows();
    loadProjectCodes();
    loadItems();
  }, []);

  useEffect(() => {
    loadSitePoRows(form.project_code, form.site_code);
    loadSiteEntries(form.project_code, form.site_code);
  }, [form.project_code, form.site_code]);

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
      setForm((prev) => ({
        ...prev,
        site_code: value.trim().toUpperCase(),
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

  const handleEdit = (row) => {
    setEditingId(row.id);
    setMessage("");

    setForm({
      site_type: row.site_type || "5G",
      project_code: row.project_code || "",
      site_code: row.site_code || "",
      item_code: row.item_code || "",
      item_description: row.item_description || "",
      done_qty: row.done_qty ?? "",
      subcon_name: row.subcon_name || "",
      onair_date: row.onair_date ? String(row.onair_date).slice(0, 10) : "",
      note: row.note || "",
    });

    setItemCodeSearch(row.item_code || "");
    setItemDescriptionSearch(row.item_description || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setMessage("");
    setItemCodeSearch("");
    setItemDescriptionSearch("");
    setForm(initialForm);
    setShowItemCodeList(false);
    setShowItemDescriptionList(false);
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
        site_type: form.site_type,
        project_code: form.project_code,
        site_code: form.site_code,
        item_code: form.item_code,
        item_description: form.item_description,
        done_qty: Number(form.done_qty || 0),
        subcon_name: form.subcon_name,
        onair_date: form.onair_date || null,
        note: form.note,
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
          marginBottom: "14px",
        }}
      >
        <h1 style={{ margin: 0 }}>📝 Günlük İş Girişi</h1>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            type="button"
            className={showBoqUpload ? "tab activeTab" : "tab"}
            onClick={() => {
              setShowBoqUpload((prev) => !prev);
              if (showHwPoUpload) setShowHwPoUpload(false);
              if (showCompletedImport) setShowCompletedImport(false);
            }}
          >
            BoQ Yükle
          </button>

          <button
            type="button"
            className={showHwPoUpload ? "tab activeTab" : "tab"}
            onClick={() => {
              setShowHwPoUpload((prev) => !prev);
              if (showBoqUpload) setShowBoqUpload(false);
              if (showCompletedImport) setShowCompletedImport(false);
            }}
          >
            HW PO Yükle
          </button>

          <button
            type="button"
            className={showCompletedImport ? "tab activeTab" : "tab"}
            onClick={() => {
              setShowCompletedImport((prev) => !prev);
              if (showBoqUpload) setShowBoqUpload(false);
              if (showHwPoUpload) setShowHwPoUpload(false);
            }}
          >
            Geçmiş İşleri Yükle
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

      <div className="entryPanel">
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
                      !["56A0SJC", "56A0QEF", "56A0NCD", "56A0TCT"].includes(
                        p.project_code,
                      ),
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
              <input
                type="date"
                name="onair_date"
                value={form.onair_date}
                onChange={handleChange}
              />
            </div>

            <div className="formGroup" style={{ position: "relative" }}>
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
                  {itemOptions.length === 0 ? "Kayıt bulunamadı" : "Seçiniz"}
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
            >
              <label>Item Description</label>

              <input
                type="text"
                value={itemDescriptionSearch}
                onChange={(e) => {
                  setItemDescriptionSearch(e.target.value);
                  setShowItemDescriptionList(true);
                }}
                onFocus={() => setShowItemDescriptionList(true)}
                placeholder="Item description filtrele..."
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
                  {itemOptions.length === 0 ? "Kayıt bulunamadı" : "Seçiniz"}
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

            <div className="formGroup formGroupWide">
              <label>Not</label>
              <textarea
                name="note"
                value={form.note}
                onChange={handleChange}
                placeholder="Ek not"
                rows={3}
              />
            </div>
          </div>

          <div className="entryActions" style={{ gap: "10px" }}>
            {editingId && (
              <button type="button" className="tab" onClick={handleCancelEdit}>
                Vazgeç
              </button>
            )}

            <button type="submit" className="saveButton" disabled={saving}>
              {saving ? "Kaydediliyor..." : editingId ? "Güncelle" : "Kaydet"}
            </button>
          </div>

          {message && <div className="entryMessage">{message}</div>}
        </form>
      </div>

      <div className="tableWrap">
        <h3 className="listTitle">Bu Saha İçin Açılmış PO Kalemleri</h3>
        <table>
          <thead>
            <tr>
              <th>PO No</th>
              <th>Project Code</th>
              <th>Site Code</th>
              <th>Item Code</th>
              <th>Item Description</th>
              <th>Requested Qty</th>
              <th>Due Qty</th>
              <th>Currency</th>
              <th>Unit Price</th>
            </tr>
          </thead>
          <tbody>
            {poRows.length === 0 ? (
              <EmptyRow colSpan={9} text="Bu saha için PO kalemi bulunamadı" />
            ) : (
              poRows.map((row, index) => (
                <tr key={`${row.po_no || "no-po"}-${row.item_code}-${index}`}>
                  <td>{row.po_no || "-"}</td>
                  <td>{row.project_code || "-"}</td>
                  <td>{row.site_code || "-"}</td>
                  <td>{row.item_code || "-"}</td>
                  <td>{row.item_description || "-"}</td>
                  <td>{row.requested_qty ?? "-"}</td>
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

      <div className="tableWrap">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "12px",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <h3 className="listTitle" style={{ margin: 0 }}>
            Bu Saha İçin Girilmiş İşler
          </h3>

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

        <table>
          <thead>
            <tr>
              <th>Saha Türü</th>
              <th>Project</th>
              <th>Site</th>
              <th>Item Code</th>
              <th>Açıklama</th>
              <th>Done Qty</th>
              <th>Requested Qty</th>
              <th>Fark</th>
              <th>Analiz</th>
              <th>Taşeron</th>
              <th>Not</th>
              <th>İşlem</th>
            </tr>
          </thead>
          <tbody>
            {siteEntries.length === 0 ? (
              <EmptyRow colSpan={13} text="Bu saha için giriş yapılmamış" />
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
                    <td>{row.item_description}</td>
                    <td>{row.done_qty}</td>
                    <td>{row.requested_qty ?? "-"}</td>
                    <td>{analysis.diff}</td>
                    <td>
                      <span className={`analysisBadge ${analysis.className}`}>
                        {analysis.label}
                      </span>
                    </td>
                    <td>{row.subcon_name}</td>
                    <td>{row.note}</td>
                    <td>
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          type="button"
                          className="tab"
                          style={{ padding: "8px 12px" }}
                          onClick={() => handleEdit(row)}
                        >
                          Düzenle
                        </button>

                        <button
                          type="button"
                          className="tab"
                          style={{
                            padding: "8px 12px",
                            background: "#fee2e2",
                            color: "#991b1b",
                          }}
                          onClick={() => handleDelete(row)}
                        >
                          Sil
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="tableWrap">
        <h3 className="listTitle">Son Girilen İşler</h3>
        <table>
          <thead>
            <tr>
              <th>Saha Türü</th>
              <th>Project</th>
              <th>Site</th>
              <th>Item Code</th>
              <th>Açıklama</th>
              <th>Done Qty</th>
              <th>Requested Qty</th>
              <th>Fark</th>
              <th>Analiz</th>
              <th>Currency</th>
              <th>Unit Price</th>
              <th>Status</th>
              <th>PO No</th>
              <th>Taşeron</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={15} text="Henüz iş girişi bulunamadı" />
            ) : (
              rows.map((row, index) => {
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
                    <td>{row.item_description}</td>
                    <td>{row.done_qty}</td>
                    <td>{row.requested_qty ?? "-"}</td>
                    <td>{analysis.diff}</td>
                    <td>
                      <span className={`analysisBadge ${analysis.className}`}>
                        {analysis.label}
                      </span>
                    </td>
                    <td>{row.currency || "-"}</td>
                    <td>
                      {Number(row.unit_price || 0) === 0
                        ? "-"
                        : formatMoneyByCurrency(row.unit_price, row.currency)}
                    </td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td>{row.po_no || "-"}</td>
                    <td>{row.subcon_name}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
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

function ManualInvoiceEntryInline({ onClose, onSaved }) {
  const initialForm = {
    invoice_no: "",
    invoice_type: "GIDEN",
    company_name: "",
    description: "",
    amount: "",
    currency: "TRY",
    invoice_date: "",
    due_date: "",
    status: "BEKLIYOR",
    note: "",
  };

  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      setMessage("");

      await fetchJson(`${API_BASE}/finance/invoice-entry/add`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...form,
          amount: Number(form.amount || 0),
        }),
      });

      setMessage("✅ Fatura kaydedildi");
      setForm(initialForm);

      if (onSaved) {
        await onSaved();
      }
    } catch (err) {
      console.error("MANUAL INVOICE SAVE ERROR:", err);
      setMessage(`❌ ${err.message}`);
    } finally {
      setSaving(false);
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
            🧾 Fatura Girişi
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

        <form onSubmit={handleSave}>
          <div className="formGrid">
            <div className="formGroup">
              <label>Fatura No</label>
              <input
                name="invoice_no"
                value={form.invoice_no}
                onChange={handleChange}
                placeholder="Fatura no"
              />
            </div>

            <div className="formGroup">
              <label>Fatura Türü</label>
              <select
                name="invoice_type"
                value={form.invoice_type}
                onChange={handleChange}
              >
                <option value="GELEN">Gelen</option>
                <option value="GIDEN">Giden</option>
              </select>
            </div>

            <div className="formGroup">
              <label>Firma</label>
              <input
                name="company_name"
                value={form.company_name}
                onChange={handleChange}
                placeholder="Firma adı"
                required
              />
            </div>

            <div className="formGroup">
              <label>Tutar</label>
              <input
                type="number"
                step="0.01"
                name="amount"
                value={form.amount}
                onChange={handleChange}
                placeholder="0"
                required
              />
            </div>

            <div className="formGroup">
              <label>Para Birimi</label>
              <select
                name="currency"
                value={form.currency}
                onChange={handleChange}
              >
                <option value="TRY">TRY</option>
                <option value="USD">USD</option>
              </select>
            </div>

            <div className="formGroup">
              <label>Durum</label>
              <select name="status" value={form.status} onChange={handleChange}>
                <option value="BEKLIYOR">Bekliyor</option>
                <option value="ODENDI">Ödendi</option>
                <option value="KISMI">Kısmi</option>
              </select>
            </div>

            <div className="formGroup">
              <label>Fatura Tarihi</label>
              <input
                type="date"
                name="invoice_date"
                value={form.invoice_date}
                onChange={handleChange}
              />
            </div>

            <div className="formGroup">
              <label>Vade Tarihi</label>
              <input
                type="date"
                name="due_date"
                value={form.due_date}
                onChange={handleChange}
              />
            </div>

            <div className="formGroup formGroupWide">
              <label>Açıklama</label>
              <input
                name="description"
                value={form.description}
                onChange={handleChange}
                placeholder="Açıklama"
              />
            </div>

            <div className="formGroup formGroupWide">
              <label>Not</label>
              <textarea
                name="note"
                value={form.note}
                onChange={handleChange}
                rows={3}
                placeholder="Not"
              />
            </div>
          </div>

          <div className="entryActions">
            <button type="submit" className="saveButton" disabled={saving}>
              {saving ? "Kaydediliyor..." : "Faturayı Kaydet"}
            </button>
          </div>

          {message && <div className="entryMessage">{message}</div>}
        </form>
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

function FinanceDashboard({ financeToken, financeUserEmail, onFinanceLogout }) {
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

  const [showPersonFilterList, setShowPersonFilterList] = useState(false);
  const [salaryRows, setSalaryRows] = useState([]);
  const [editingSalaryId, setEditingSalaryId] = useState(null);
  const [salarySearch, setSalarySearch] = useState("");
  const [manualInvoiceSearch, setManualInvoiceSearch] = useState("");
  const [manualInvoiceStatusFilter, setManualInvoiceStatusFilter] =
    useState("ALL");
  const [showInvoiceEntry, setShowInvoiceEntry] = useState(false);
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

  const [showInvoiceEntryModal, setShowInvoiceEntryModal] = useState(false);
  const [showSalaryModal, setShowSalaryModal] = useState(false);

  const [salaryFilterMonth, setSalaryFilterMonth] = useState(
    String(new Date().getMonth() + 1).padStart(2, "0"),
  );
  const [salaryFilterYear, setSalaryFilterYear] = useState(
    String(new Date().getFullYear()),
  );
  const [salaryFilterPersonel, setSalaryFilterPersonel] = useState("");

  const [invoiceForm, setInvoiceForm] = useState({
    bolge: "",
    proje: "",
    proje_kodu: "",
    fatura_no: "",
    fatura_tarihi: "",
    tedarikci: "",
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

  const handlePersonelExcelUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setPersonelUploadLoading(true);

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${API_BASE}/finance/personel/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Personel Excel yüklenemedi");
      }

      alert(`✅ ${data.inserted || 0} personel yüklendi`);

      const personelData = await fetchJson(`${API_BASE}/finance/personel/list`);
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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetchJson(`${API_BASE}/finance/salary/add`, {
          method: "POST",
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

  useEffect(() => {
    fetchJson(`${API_BASE}/finance/personel/list`)
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

    const kalanNetOdeme = Math.max(netMaas - avans, 0);
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

    setShowInvoiceEntryModal(true);
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

      if (editingInvoiceId) {
        await fetchJson(
          `${API_BASE}/finance/invoice-entry/${editingInvoiceId}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        );
      } else {
        await fetchJson(`${API_BASE}/finance/invoice-entry/add`, {
          method: "POST",
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
      });

      setSalaryRows((prev) => prev.filter((x) => x.id !== row.id));
    } catch (err) {
      console.error("SALARY SAVE ERROR:", err);
      alert(err.message || "Kaydedilemedi");
    }
  };

  const handleExportInvoiceDatabase = async () => {
    try {
      const response = await fetch(
        `${API_BASE}/finance/invoice-entry/export-excel`,
      );

      if (!response.ok) {
        throw new Error("Excel indirilemedi");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice_database_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("INVOICE EXPORT ERROR:", err);
      alert("Fatura database indirilemedi");
    }
  };

  const handleExportSalaryExcel = async () => {
    try {
      const response = await fetch(
        `${API_BASE}/finance/salary/export-excel?ay=${salaryFilterMonth}&yil=${salaryFilterYear}`,
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
      const data = await fetchJson(`${API_BASE}/finance/salary/list`);
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
        fetchJson(`${API_BASE}/finance/summary`),
        fetchJson(paymentsUrl),
        fetchJson(`${API_BASE}/finance/upcoming-payments`),
        fetchJson(`${API_BASE}/finance/invoice-entry/list`),
        fetchJson(`${API_BASE}/finance/salary/list`),
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

  const filteredDayTotal = useMemo(() => {
    return paymentRows.reduce((sum, row) => {
      const amount = Number(row.payment_amount || 0);
      return sum + amount;
    }, 0);
  }, [paymentRows]);

  const sortedPaymentRows = useMemo(() => {
    return [...paymentRows].sort((a, b) => {
      const dateA = new Date(a.payment_date || 0).getTime();
      const dateB = new Date(b.payment_date || 0).getTime();
      return dateB - dateA;
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
          onClick={() => setShowInvoiceEntryModal(true)}
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
      </div>

      {showUpload && (
        <FinanceUploadInline
          onClose={() => setShowUpload(false)}
          onUploaded={loadFinance}
        />
      )}

      {showInvoiceUpload && (
        <FinanceInvoiceUploadInline
          onClose={() => setShowInvoiceUpload(false)}
          onUploaded={loadFinance}
        />
      )}

      {showInvoiceEntry && (
        <ManualInvoiceEntryInline
          onClose={() => setShowInvoiceEntry(false)}
          onSaved={loadFinance}
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

        <div className="card cancel statCard">
          <div className="statLabel">Gider Kayıt</div>
          <div className="statValue">{summary.expense_count || 0}</div>
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

      <div className="tableWrap">
        <h3 className="listTitle">Manuel Fatura Kayıtları</h3>

        <table>
          <thead>
            <tr>
              <th>Fatura No</th>
              <th>Tür</th>
              <th>Firma</th>
              <th>Açıklama</th>
              <th>Tutar</th>
              <th>Fatura Tarihi</th>
              <th>Vade</th>
              <th>Durum</th>
              <th>Not</th>
            </tr>
          </thead>
          <tbody>
            {manualInvoiceRows.length === 0 ? (
              <EmptyRow colSpan={9} text="Henüz manuel fatura kaydı yok" />
            ) : (
              manualInvoiceRows.map((row, index) => (
                <tr key={row.id ?? index}>
                  <td>{row.invoice_no || "-"}</td>
                  <td>{row.invoice_type || "-"}</td>
                  <td>{row.company_name || "-"}</td>
                  <td>{row.description || "-"}</td>
                  <td>
                    {formatMoneyByCurrency(
                      row.amount || 0,
                      row.currency || "TRY",
                    )}
                  </td>
                  <td>{formatDateOnly(row.invoice_date)}</td>
                  <td>{formatDateOnly(row.due_date)}</td>
                  <td>{row.status || "-"}</td>
                  <td>{row.note || "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="tableWrap">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
            marginBottom: "12px",
          }}
        >
          <h3 className="listTitle" style={{ margin: 0 }}>
            HW Payment Kayıtları
          </h3>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <input
              type="date"
              value={paymentDateFilter}
              onChange={(e) => setPaymentDateFilter(e.target.value)}
            />

            <button
              type="button"
              className="tab"
              onClick={() => setPaymentDateFilter("")}
            >
              Filtreyi Temizle
            </button>
          </div>
        </div>

        {paymentDateFilter && (
          <div
            style={{
              marginBottom: "12px",
              fontWeight: 700,
              fontSize: "16px",
            }}
          >
            Seçilen Gün Toplamı:{" "}
            {formatMoneyByCurrency(filteredDayTotal || 0, "TRY")}
          </div>
        )}

        <table>
          <thead>
            <tr>
              <th>Invoice No</th>
              <th>Invoice Amount</th>
              <th>Payment Amount</th>
              <th>Remaining Amount</th>
              <th>Payment Date</th>
              <th>Due Date</th>
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
                  <td>{formatDateOnly(row.due_date)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="tableWrap">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
            marginBottom: "12px",
          }}
        >
          <h3 className="listTitle" style={{ margin: 0 }}>
            Manuel Fatura Kayıtları
          </h3>

          <button
            type="button"
            className="tab"
            onClick={handleExportInvoiceDatabase}
          >
            Fatura Database İndir
          </button>
        </div>

        <table>
          <thead>
            <tr>
              <th>Bölge</th>
              <th>Proje</th>
              <th>Proje Kodu</th>
              <th>Fatura No</th>
              <th>Fatura Tarihi</th>
              <th>Tedarikçi</th>
              <th>Fatura Kalemi</th>
              <th>İş Kalemi</th>
              <th>PO No</th>
              <th>Site ID</th>
              <th>Tutar</th>
              <th>KDV</th>
              <th>Toplam</th>
              <th>Ödenen</th>
              <th>Kalan Borç</th>
              <th>Not</th>
            </tr>
          </thead>
          <tbody>
            {manualInvoiceRows.length === 0 ? (
              <EmptyRow
                colSpan={16}
                text="Henüz manuel fatura kaydı bulunamadı"
              />
            ) : (
              manualInvoiceRows.map((row, index) => (
                <tr key={row.id ?? index}>
                  <td>{row.invoice_no || "-"}</td>
                  <td>{row.invoice_type || "-"}</td>
                  <td>{row.company_name || "-"}</td>
                  <td>{row.description || "-"}</td>

                  <td>
                    {formatMoneyByCurrency(row.amount || 0, row.currency)}
                  </td>

                  <td>{formatDateOnly(row.invoice_date)}</td>
                  <td>{formatDateOnly(row.due_date)}</td>

                  <td>{row.status || "-"}</td>
                  <td>{row.note || "-"}</td>
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
          onClick={() => setShowInvoiceEntryModal(false)}
        >
          <div
            style={{
              background: "#fff",
              width: "100%",
              maxWidth: "1200px",
              maxHeight: "90vh",
              overflow: "auto",
              borderRadius: "24px",
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
                marginBottom: "20px",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <h3 className="listTitle" style={{ margin: 0 }}>
                🧾 Fatura Girişi
              </h3>

              <button
                type="button"
                className="tab"
                onClick={() => setShowInvoiceEntryModal(false)}
              >
                Kapat
              </button>
            </div>

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
                style={{ justifyContent: "flex-end" }}
              >
                <button type="submit" className="saveButton">
                  Faturayı Kaydet
                </button>
              </div>
            </form>

            {/* 📊 ÖZET KARTLAR */}
            <div
              className="cards"
              style={{ marginTop: "18px", marginBottom: "18px" }}
            >
              <div className="card ok statCard">
                <div className="statLabel">Toplam Fatura</div>
                <div className="statValue">
                  {formatMoneyByCurrency(
                    manualInvoiceSummary.totalAmount,
                    "TRY",
                  )}
                </div>
              </div>

              <div className="card partial statCard">
                <div className="statLabel">Ödenen</div>
                <div className="statValue">
                  {formatMoneyByCurrency(manualInvoiceSummary.totalPaid, "TRY")}
                </div>
              </div>

              <div className="card cancel statCard">
                <div className="statLabel">Kalan Borç</div>
                <div className="statValue">
                  {formatMoneyByCurrency(
                    manualInvoiceSummary.totalRemaining,
                    "TRY",
                  )}
                </div>
              </div>

              <div className="card bekler statCard">
                <div className="statLabel">Bekleyen</div>
                <div className="statValue">
                  {manualInvoiceSummary.waitingCount}
                </div>
              </div>
            </div>

            {/* 🔍 ARAMA + FİLTRE */}
            <div className="toolbar" style={{ marginBottom: "16px" }}>
              <input
                className="search"
                placeholder="Fatura no, tedarikçi, proje, site ara"
                value={manualInvoiceSearch}
                onChange={(e) => setManualInvoiceSearch(e.target.value)}
              />

              <select
                className="select"
                value={manualInvoiceStatusFilter}
                onChange={(e) => setManualInvoiceStatusFilter(e.target.value)}
              >
                <option value="ALL">Tümü</option>
                <option value="BEKLIYOR">Bekliyor</option>
                <option value="KISMI">Kısmi</option>
                <option value="ODENDI">Ödendi</option>
              </select>

              <button
                type="button"
                className="tab"
                onClick={handleExportInvoiceDatabase}
              >
                Excel İndir
              </button>
            </div>

            {/* 📋 TABLO */}
            <div className="tableWrap">
              <h3 className="listTitle">Girilen Faturalar</h3>

              <table>
                <thead>
                  <tr>
                    <th>Bölge</th>
                    <th>Proje</th>

                    <th>Fatura No</th>
                    <th>Tedarikçi</th>
                    <th>Fatura Tarihi</th>
                    <th>Toplam</th>
                    <th>Ödenen</th>
                    <th>Kalan</th>
                    <th>Durum</th>
                    <th>İşlem</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredManualInvoiceRows.length === 0 ? (
                    <EmptyRow colSpan={9} text="Kayıt yok" />
                  ) : (
                    filteredManualInvoiceRows.map((row, i) => (
                      <tr key={row.id ?? i}>
                        <td>{row.bolge || "-"}</td>
                        <td>{row.proje || "-"}</td>

                        <td>{row.fatura_no || "-"}</td>
                        <td>{row.tedarikci || "-"}</td>
                        <td>{formatDateOnly(row.fatura_tarihi)}</td>
                        <td>
                          {formatMoneyByCurrency(row.toplam_tutar || 0, "TRY")}
                        </td>
                        <td>
                          {formatMoneyByCurrency(row.odenen_tutar || 0, "TRY")}
                        </td>
                        <td>
                          {formatMoneyByCurrency(row.kalan_borc || 0, "TRY")}
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              Number(row.kalan_borc || 0) > 0 ? "bekler" : "ok"
                            }`}
                          >
                            {Number(row.kalan_borc || 0) > 0
                              ? "Bekliyor"
                              : "Ödendi"}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="tab"
                            onClick={() => handleEditManualInvoice(row)}
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
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

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
      },
    };

    rows.forEach((row) => {
      const region = getRegion(row.site_code);
      if (!base[region]) return;

      const currency = normalizeCurrency(row.currency);
      const amount = Number(row.total_done_amount || 0);

      base[region].total_records += 1;

      if (currency === "USD") {
        base[region].total_usd += amount;
      } else {
        base[region].total_try += amount;
      }

      if (row.status === "PO_BEKLER") {
        if (currency === "USD") {
          base[region].po_bekler_usd += amount;
        } else {
          base[region].po_bekler_try += amount;
        }
      }

      if (row.status === "OK") {
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

  if (loading) return <div className="loading">Yükleniyor...</div>;
  if (errorMessage) return <div className="loading">{errorMessage}</div>;

  return (
    <>
      <h1>🗺️ Region Analysis</h1>

      <div className="regionCards">
        {regionSummary.length === 0 ? (
          <div className="loading">Bölge verisi bulunamadı</div>
        ) : (
          regionSummary.map((item) => {
            let regionClass = "tanimsiz";

            if (item.region === "Ankara") regionClass = "ankara";
            else if (item.region === "İzmir") regionClass = "izmir";
            else if (item.region === "Antalya") regionClass = "antalya";

            return (
              <div key={item.region} className={`regionCard ${regionClass}`}>
                <h3>📍 {item.region}</h3>
                <div className="regionLine">Kayıt: {item.total_records}</div>
                <div className="regionLine">
                  Toplam TRY: {formatMoneyByCurrency(item.total_try, "TRY")}
                </div>
                <div className="regionLine">
                  Toplam USD: {formatMoneyByCurrency(item.total_usd, "USD")}
                </div>
                <div className="regionLine">
                  PO Bekler TRY:{" "}
                  {formatMoneyByCurrency(item.po_bekler_try, "TRY")}
                </div>
                <div className="regionLine">
                  PO Bekler USD:{" "}
                  {formatMoneyByCurrency(item.po_bekler_usd, "USD")}
                </div>
                <div className="regionLine">
                  OK TRY: {formatMoneyByCurrency(item.ok_try, "TRY")}
                </div>
                <div className="regionLine">
                  OK USD: {formatMoneyByCurrency(item.ok_usd, "USD")}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Bölge</th>
              <th>Status</th>
              <th>Project Code</th>
              <th>Site Code</th>
              <th>Item Code</th>
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
            {rows.filter((row) => getRegion(row.site_code) !== "Tanımsız")
              .length === 0 ? (
              <EmptyRow colSpan={12} text="Tanımlı bölge kaydı bulunamadı" />
            ) : (
              rows
                .filter((row) => getRegion(row.site_code) !== "Tanımsız")
                .map((row, index) => (
                  <tr
                    key={
                      row.id ??
                      `${row.project_code}-${row.site_code}-${row.item_code}-${index}`
                    }
                  >
                    <td>{getRegion(row.site_code)}</td>
                    <td>
                      <StatusBadge status={row.status} />
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
  const handleFinanceLogin = async (e) => {
    e.preventDefault();

    try {
      setFinanceLoginLoading(true);
      setFinanceLoginError("");

      const response = await fetch(`${API_BASE}/finance-auth/login`, {
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

      setFinanceToken(data.token);
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

  const handleFinanceLogout = () => {
    localStorage.removeItem("finance_token");
    localStorage.removeItem("finance_user_email");
    setFinanceToken("");
    setFinanceUserEmail("");
    setPage("finance");
  };

  return (
    <div className="container">
      <div className="navTabs">
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
      </div>

      {page === "finance" &&
        (financeToken ? (
          <FinanceDashboard
            financeToken={financeToken}
            financeUserEmail={financeUserEmail}
            onFinanceLogout={handleFinanceLogout}
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

export default App;
