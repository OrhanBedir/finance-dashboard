// OPERASYON EKRANLARI — web (31.10.2026, Orhan)
//   RolloutHaftalikModal : Rollout Weekly Plan — ekipler satırda, günler sütunda; bugün vurgulu; çok günlük işler; müşteri Excel'i
//   PlanIsSecimi         : Plan Yap 3. adım iş seçimi — A) Depoda · atama bekleyen işler, B) Ekip üzerindeki malzemeler, C) diğer işler
// Kaynak: /operasyon/* ve /rollout/harita (sunucu kapsamı + yetkisi). Renk tek başına anlam taşımaz: her durum metinle yazılır.
import React, { useEffect, useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const LAC = "#1e3a5f";
const tokenAl = () => localStorage.getItem("finance_token") || localStorage.getItem("token") || "";
const tarihTR = (v) => (v ? new Date(String(v).length <= 10 ? v + "T12:00:00" : v).toLocaleDateString("tr-TR") : "—");
const zamanTR = (v) => (v ? new Date(v).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const gunEkle = (t, n) => { const d = new Date(`${t}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
async function opGet(yol) {
  const r = await fetch(API_BASE + yol, { headers: { Authorization: `Bearer ${tokenAl()}` } });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error || `Sunucu hatası (${r.status})`);
  return j;
}
async function dosyaIndir(yol, ad) {
  const r = await fetch(API_BASE + yol, { headers: { Authorization: `Bearer ${tokenAl()}` } });
  if (!r.ok) { const j = await r.json().catch(() => null); throw new Error(j?.error || "İndirilemedi"); }
  const b = await r.blob(); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = ad; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000);
}

// Fiilî durum renkleri (QC'den bağımsız) — harita, haftalık plan ve mobil aynı anlam
export const FIILI_RENK = {
  MAVI: { bg: "#dbeafe", fg: "#1e40af", kenar: "#2563eb", ad: "Planlandı / başlamadı", ik: "◷" },
  SARI: { bg: "#fef9c3", fg: "#713f12", kenar: "#eab308", ad: "Devam ediyor", ik: "▶" },
  YESIL: { bg: "#dcfce7", fg: "#14532d", kenar: "#16a34a", ad: "Fiziksel montaj tamamlandı", ik: "✓" },
  GRI: { bg: "#f1f5f9", fg: "#334155", kenar: "#94a3b8", ad: "Doğrulanmadı", ik: "?" },
};
export function FiiliAciklama({ style }) {
  return <div aria-label="Renk açıklaması" style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12.5, ...style }}>
    {Object.entries(FIILI_RENK).map(([k, v]) => <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 16, height: 16, borderRadius: 4, background: v.bg, border: `2px solid ${v.kenar}`, color: v.fg, fontSize: 10, fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{v.ik}</span>{v.ad}</span>)}
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 4, padding: "0 5px", fontWeight: 900 }}>⚠ Issue</span>issue / eksik malzeme</span>
    <span style={{ color: "#64748b" }}>QC ayrı alandır; tamamlanma ölçütü değildir.</span>
  </div>;
}

const ISTANBUL_BUGUN = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
const pazartesi = (t) => { const g = new Date(`${t}T12:00:00Z`).getUTCDay(); return gunEkle(t, -((g + 6) % 7)); };
const TIP_AD = { INHOUSE: "Inhouse", TASERON: "Taşeron", TANIMSIZ: "Ekip tipi tanımlanmadı" };

// Çoklu seçim çipleri
function Cipler({ secenekler, secili, setSecili, etiket }) {
  return <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }} role="group" aria-label={etiket}>
    <span style={{ fontSize: 12.5, fontWeight: 700, color: "#475569" }}>{etiket}:</span>
    {secenekler.map(([k, ad]) => { const s = secili.includes(k); return <button key={k} type="button" aria-pressed={s} onClick={() => setSecili(s ? secili.filter((x) => x !== k) : [...secili, k])}
      style={{ border: `1.5px solid ${s ? LAC : "#cbd5e1"}`, background: s ? LAC : "#fff", color: s ? "#fff" : "#1e293b", borderRadius: 999, padding: "4px 10px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{s ? "✓ " : ""}{ad}</button>; })}
    {secili.length > 0 && <button type="button" onClick={() => setSecili([])} style={{ border: "none", background: "none", color: "#1d4ed8", fontSize: 12.5, cursor: "pointer" }}>temizle</button>}
  </div>;
}

/* ═══ ROLLOUT WEEKLY PLAN ═══ */
export function RolloutHaftalikModal({ onClose }) {
  const [hafta, setHafta] = useState(pazartesi(ISTANBUL_BUGUN()));
  const [bolge, setBolge] = useState([]); const [firma, setFirma] = useState([]); const [tip, setTip] = useState([]); const [ekip, setEkip] = useState("");
  const [v, setV] = useState(null); const [hata, setHata] = useState(""); const [yukleniyor, setYukleniyor] = useState(false);
  const [detay, setDetay] = useState(null); const [sekme, setSekme] = useState("PLAN"); const [nerede, setNerede] = useState(null);
  const [mobil, setMobil] = useState(() => typeof window !== "undefined" && window.innerWidth < 760);
  useEffect(() => { const f = () => setMobil(window.innerWidth < 760); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  const qs = () => new URLSearchParams({ hafta, ...(bolge.length ? { bolge: bolge.join(",") } : {}), ...(firma.length ? { firma: firma.join(",") } : {}), ...(tip.length ? { tip: tip.join(",") } : {}), ...(ekip ? { ekip } : {}) }).toString();
  useEffect(() => { let iptal = false; setYukleniyor(true); setHata("");
    opGet(`/operasyon/haftalik?${qs()}`).then((d) => { if (!iptal) setV(d); }).catch((e) => { if (!iptal) setHata(e.message); }).finally(() => { if (!iptal) setYukleniyor(false); });
    return () => { iptal = true; }; }, [hafta, bolge.join(), firma.join(), tip.join(), ekip]); // eslint-disable-line
  useEffect(() => { if (sekme !== "NEREDE") return; setNerede(null); opGet(`/operasyon/ekipler-nerede?${qs()}`).then(setNerede).catch((e) => setNerede({ hata: e.message })); }, [sekme, bolge.join(), firma.join(), tip.join(), ekip]); // eslint-disable-line
  useEffect(() => { const f = (e) => { if (e.key === "Escape") (detay ? setDetay(null) : onClose()); }; window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [onClose, detay]);
  const bugun = v?.bugun || ISTANBUL_BUGUN();
  const gunler = v?.gunler || [];
  const isKartlari = (e, t) => e.kartlar.filter((k) => k.tarih === t && ["MONTAJ", "FAALIYET", "ATAMA"].includes(k.tur));
  const yolKartlari = (e, t) => e.kartlar.filter((k) => k.tarih === t && ["YOL", "TESLIM"].includes(k.tur));
  const IsKart = ({ k, e }) => {
    const R = FIILI_RENK[k.fiili?.renk || "MAVI"] || FIILI_RENK.GRI;
    return <button type="button" onClick={() => setDetay({ k, e })} title={`${k.site_code || k.ad} · ${k.is_turu || ""}`}
      style={{ display: "block", width: "100%", textAlign: "left", background: R.bg, color: R.fg, border: `1px solid ${R.kenar}`, borderLeft: `5px solid ${R.kenar}`, borderRadius: 8, padding: "6px 8px", marginBottom: 5, cursor: "pointer", fontSize: 13, lineHeight: 1.35 }}>
      <div style={{ display: "flex", gap: 4, alignItems: "baseline" }}><b style={{ fontSize: 15 }}>{k.fiziksel_id || k.ad || "—"}</b>
        {k.gun_toplam > 1 && <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 800, background: "rgba(255,255,255,.7)", borderRadius: 6, padding: "0 5px" }}>{k.gun_no > 1 ? "← " : ""}{k.gun_no}/{k.gun_toplam}{k.gun_no < k.gun_toplam ? " →" : ""}</span>}</div>
      {k.site_code && k.site_code !== k.fiziksel_id && <div style={{ fontSize: 11.5, wordBreak: "break-all", opacity: .9 }}>{k.site_code}</div>}
      <div>{k.ikon || ""} {k.is_turu || k.ad}</div>
      <div style={{ fontVariantNumeric: "tabular-nums" }}>{k.saatli ? `${k.bas}–${k.bit}` : "Tüm gün"} · <b>{R.ik} {k.fiili?.ad || R.ad}</b></div>
      {k.fiili?.issue && <div style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 4, padding: "0 4px", fontWeight: 800, marginTop: 2 }}>⚠ {k.fiili.issue.tur}</div>}
      {k.malzeme && <div style={{ fontSize: 11.5, opacity: .9 }}>📦 {k.malzeme.etiket}</div>}
    </button>;
  };
  const filtreler = v && <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", padding: "8px 14px", borderBottom: "1px solid #e2e8f0", background: "#fff" }}>
    <Cipler etiket="Bölge" secenekler={(v.secenekler.bolgeler.length ? v.secenekler.bolgeler : ["Ankara", "Bursa", "İzmir"]).map((b) => [b, b])} secili={bolge} setSecili={setBolge} />
    {/* 02.11.2026: firma çipi kaldırıldı — kapsam her zaman Teknocenter (sunucuda zorunlu) */}
    <Cipler etiket="Ekip tipi" secenekler={[["INHOUSE", "Inhouse"], ["TASERON", "Taşeron"], ["TANIMSIZ", "Tanımsız"]]} secili={tip} setSecili={setTip} />
    <select value={ekip} onChange={(e) => setEkip(e.target.value)} aria-label="Ekip" style={{ padding: "6px 8px", borderRadius: 8, border: "1.5px solid #cbd5e1" }}>
      <option value="">Tüm ekipler</option>{v.secenekler.ekipler.map((e) => <option key={e.ekip_no} value={e.ekip_no}>{e.ad}</option>)}</select>
  </div>;
  return <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.6)", zIndex: 1300, display: "flex", alignItems: "center", justifyContent: "center", padding: mobil ? 0 : 10 }}>
    <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Teknocenter Weekly Plan" style={{ background: "#f8fafc", borderRadius: mobil ? 0 : 14, width: "min(1500px,100%)", height: mobil ? "100%" : "min(940px,100%)", display: "flex", flexDirection: "column", overflow: "hidden", textAlign: "left", color: "#0f172a" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 14px", background: LAC, color: "#fff" }}>
        <b style={{ fontSize: 17 }}>📅 Teknocenter Weekly Plan</b><span style={{ fontSize: 12.5, opacity: .85 }} title="Yalnız Teknocenter kapsamı; sunucuda zorunlu">🏢 Teknocenter kapsamı</span>
        <div style={{ display: "flex", gap: 4 }}>
          {[["PLAN", "Haftalık plan"], ["NEREDE", "Ekipler nerede?"]].map(([k, ad]) => <button key={k} type="button" aria-pressed={sekme === k} onClick={() => setSekme(k)}
            style={{ background: sekme === k ? "#fff" : "transparent", color: sekme === k ? LAC : "#fff", border: "1px solid rgba(255,255,255,.6)", borderRadius: 8, padding: "4px 10px", fontWeight: 800, cursor: "pointer" }}>{ad}</button>)}
        </div>
        {sekme === "PLAN" && <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button type="button" onClick={() => setHafta(gunEkle(hafta, -7))} aria-label="Önceki hafta" style={opBtn}>‹ Önceki</button>
          <button type="button" onClick={() => setHafta(pazartesi(ISTANBUL_BUGUN()))} style={opBtn}>Bu hafta</button>
          <button type="button" onClick={() => setHafta(gunEkle(hafta, 7))} aria-label="Sonraki hafta" style={opBtn}>Sonraki ›</button>
          <span style={{ fontWeight: 700 }}>{tarihTR(hafta)} – {tarihTR(gunEkle(hafta, 6))}</span></div>}
        {sekme === "PLAN" && <button type="button" style={{ ...opBtn, background: "#fff", color: LAC }} onClick={() => dosyaIndir(`/operasyon/haftalik/excel?${qs()}`, `teknocenter_weekly_plan_${hafta}.xlsx`).catch((e) => setHata(e.message))}>⬇ Müşteri Excel'i</button>}
        <button type="button" onClick={onClose} style={{ ...opBtn, marginLeft: "auto" }} aria-label="Kapat (Esc)">✕</button>
      </div>
      {filtreler}
      <div style={{ padding: "6px 14px", background: "#fff", borderBottom: "1px solid #e2e8f0" }}><FiiliAciklama /></div>
      {hata && <div role="alert" style={{ color: "#991b1b", fontWeight: 700, padding: "8px 14px" }}>{hata}</div>}
      <div style={{ flex: 1, overflow: "auto", padding: mobil ? 8 : 0 }}>
        {sekme === "PLAN" && (yukleniyor && !v ? <div style={{ padding: 20, color: "#64748b" }}>Yükleniyor…</div> : v && (!v.ekipler.length ? <div style={{ padding: 20, color: "#64748b" }}>Filtreye uyan ekip yok.</div> : mobil ?
          // Mobil: gün gün, ekip kartları (sıkıştırılmış tablo değil)
          gunler.map((g) => <div key={g.tarih} style={{ marginBottom: 10, background: g.tarih === bugun ? "#eff6ff" : "#fff", border: `1px solid ${g.tarih === bugun ? "#93c5fd" : "#e2e8f0"}`, borderRadius: 12, padding: 10 }}>
            <div style={{ fontWeight: 900, fontSize: 16 }}>{g.ad} {tarihTR(g.tarih)}{g.tarih === bugun ? " · Bugün" : ""}{g.tatil ? " · Pazar (tatil)" : ""}</div>
            {v.ekipler.map((e) => { const l = isKartlari(e, g.tarih); if (!l.length) return null; return <div key={e.ekip_no} style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 800 }}>{e.ad} <span style={{ fontWeight: 600, color: "#64748b", fontSize: 12.5 }}>{TIP_AD[e.tip.kod]}{e.bolge ? ` · ${e.bolge}` : ""}</span></div>
              {l.map((k, i) => <IsKart key={i} k={k} e={e} />)}</div>; })}
            {!v.ekipler.some((e) => isKartlari(e, g.tarih).length) && <div style={{ color: "#94a3b8", fontSize: 13 }}>Plan yok</div>}
          </div>)
          : <table style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%", tableLayout: "fixed" }}>
            <thead><tr>
              <th style={{ ...thS, left: 0, zIndex: 3, width: 210 }}>Ekip</th>
              {gunler.map((g) => <th key={g.tarih} style={{ ...thS, width: 175, background: g.tarih === bugun ? "#dbeafe" : g.tatil ? "#f1f5f9" : "#e2e8f0" }}>
                {g.ad}<div style={{ fontWeight: 600, fontSize: 12 }}>{tarihTR(g.tarih)}{g.tarih === bugun ? " · Bugün" : ""}{g.tatil ? " · tatil" : ""}</div></th>)}
            </tr></thead>
            <tbody>{v.ekipler.map((e) => <tr key={e.ekip_no}>
              <td style={{ ...tdS, position: "sticky", left: 0, zIndex: 1, background: "#fff", width: 210 }}>
                <div style={{ fontWeight: 900, fontSize: 15 }}>{e.ad}</div>
                <div style={{ fontSize: 12, color: "#475569" }}>{TIP_AD[e.tip.kod]}{e.bolge ? ` · ${e.bolge}` : ""}{e.firma ? ` · ${e.firma === "SIMSEK" ? "Şimşek" : e.firma === "TEKNO" ? "Teknocenter" : e.firma}` : ""}</div>
                <div style={{ fontSize: 12 }}>Şef: {e.sef ? `${e.sef.ad}${e.sef.telefon ? ` · ${e.sef.telefon}` : ""}` : "kayıtlı değil"}</div>
                <div style={{ fontSize: 12 }}>Araç: {e.plaka || "kayıtlı değil"}</div>
                {e.son_bildirim && <div style={{ fontSize: 11.5, color: e.son_bildirim.eski ? "#b45309" : "#166534" }}>Son bildirim: {e.son_bildirim.site_code} · {zamanTR(e.son_bildirim.zaman)}{e.son_bildirim.eski ? " (eski)" : ""}</div>}
              </td>
              {gunler.map((g) => <td key={g.tarih} style={{ ...tdS, background: g.tarih === bugun ? "#eff6ff" : g.tatil ? "#f8fafc" : "#fff" }}>
                {isKartlari(e, g.tarih).map((k, i) => <IsKart key={i} k={k} e={e} />)}
                {yolKartlari(e, g.tarih).length > 0 && <div style={{ fontSize: 11.5, color: "#475569" }}>{yolKartlari(e, g.tarih).map((y, i) => <div key={i}>{y.tur === "YOL" ? "🚚" : "📦"} {y.bas}–{y.bit} {y.tur === "YOL" ? "yol" : "teslim alma"}{y.km ? ` · ${y.km} km` : ""}</div>)}</div>}
              </td>)}
            </tr>)}</tbody>
          </table>))}
        {sekme === "NEREDE" && <div style={{ padding: 12 }}>
          {!nerede && <div style={{ color: "#64748b" }}>Yükleniyor…</div>}
          {nerede?.hata && <div style={{ color: "#991b1b" }}>{nerede.hata}</div>}
          {nerede?.ok && <>
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "8px 12px", fontSize: 14, marginBottom: 10 }}>{nerede.not}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 10 }}>
              {nerede.ekipler.map((e) => { const s = e.son_bildirim; const k = s ? nerede.konumlar[s.fiziksel_idler[0]] : null; return <div key={e.ekip_no} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>{e.ad}</div>
                <div style={{ fontSize: 12.5, color: "#475569" }}>{TIP_AD[e.tip.kod]}{e.bolge ? ` · ${e.bolge}` : ""} · Şef: {e.sef ? `${e.sef.ad}${e.sef.telefon ? ` · ${e.sef.telefon}` : ""}` : "kayıtlı değil"} · {e.plaka || "plaka kayıtlı değil"}</div>
                <div style={{ marginTop: 6 }}>Son bildirilen çalışma: {s ? <b>{s.fiziksel_idler.join(", ")}</b> : <span style={{ color: "#64748b" }}>bildirim yok</span>}</div>
                {s && <div style={{ fontSize: 13, color: s.eski ? "#b45309" : "#166534" }}>{s.olay === "TAMAMLANDI" ? "Tamamlandı bildirimi" : s.olay === "BASLADI" ? "İşe başladı" : s.olay === "ISSUE" ? "Issue bildirimi" : s.olay === "CIKIS" ? "Çıkış yaptı" : s.olay} · {zamanTR(s.zaman)}{s.kim ? ` · ${s.kim}` : ""}{s.eski ? " · ESKİ BİLDİRİM (24 saatten eski)" : ""}</div>}
                <div style={{ fontSize: 13, marginTop: 4 }}>Bugün planlanan: {e.bugun_plan_fiziksel.length ? e.bugun_plan_fiziksel.join(", ") : "plan yok"}</div>
                {e.plan_farkli && <div style={{ color: "#9a3412", fontWeight: 800, fontSize: 13 }}>⚠ Planlanan saha ile bildirilen saha farklı</div>}
                {k ? <a href={`https://www.google.com/maps/search/?api=1&query=${k.lat},${k.lng}`} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>Bildirilen sahanın konumu ↗</a>
                  : s ? <div style={{ fontSize: 12.5, color: "#64748b" }}>Sahanın doğrulanmış koordinatı yok</div> : null}
              </div>; })}
            </div></>}
        </div>}
      </div>
      {detay && <div onClick={() => setDetay(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.35)", zIndex: 1310, display: "flex", justifyContent: "flex-end" }}>
        <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="İş detayı" style={{ width: "min(440px,100%)", height: "100%", background: "#fff", padding: 16, overflowY: "auto", boxShadow: "-8px 0 24px rgba(0,0,0,.15)" }}>
          <button type="button" onClick={() => setDetay(null)} style={{ ...opBtn, color: LAC, borderColor: "#cbd5e1" }}>✕ Kapat</button>
          <div style={{ fontSize: 28, fontWeight: 900, marginTop: 8 }}>{detay.k.fiziksel_id || detay.k.ad}</div>
          {detay.k.site_code && <code style={{ fontSize: 15, fontWeight: 800 }}>{detay.k.site_code}</code>}
          <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 12px", fontSize: 14.5, marginTop: 10 }}>
            <dt style={dtS}>İş türü</dt><dd style={ddS}>{detay.k.is_turu}</dd>
            <dt style={dtS}>Planlanan</dt><dd style={ddS}>{tarihTR(detay.k.tarih)} {detay.k.saatli ? `${detay.k.bas}–${detay.k.bit}` : "tüm gün"}{detay.k.gun_toplam > 1 ? ` · ${detay.k.gun_no}. gün / ${detay.k.gun_toplam}` : ""}</dd>
            <dt style={dtS}>Fiilî durum</dt><dd style={ddS}><b>{detay.k.fiili?.ad || "—"}</b>{detay.k.fiili?.issue && <div style={{ color: "#991b1b", fontWeight: 800 }}>⚠ {detay.k.fiili.issue.tur}{detay.k.fiili.issue.aciklama ? `: ${detay.k.fiili.issue.aciklama}` : ""}</div>}</dd>
            <dt style={dtS}>Son bildirim</dt><dd style={ddS}>{detay.k.fiili?.son_bildirim ? `${zamanTR(detay.k.fiili.son_bildirim)}${detay.k.fiili.son_bildirim_eski ? " (eski)" : ""}` : "yok"}</dd>
            <dt style={dtS}>QC (ayrı)</dt><dd style={ddS}>{detay.k.qc?.durum || "—"}{detay.k.qc?.kapanis ? ` · kapanış ${tarihTR(detay.k.qc.kapanis)}` : ""}</dd>
            <dt style={dtS}>Malzeme</dt><dd style={ddS}>{detay.k.malzeme?.etiket || "HW malzeme kaydı yok"}</dd>
            <dt style={dtS}>İl / bölge</dt><dd style={ddS}>{[detay.k.il, detay.k.bolge].filter(Boolean).join(" · ") || "—"}</dd>
            {detay.k.par && <><dt style={dtS}>PAR / kesinti</dt><dd style={ddS}>{detay.k.par.par_id ? `PAR ${detay.k.par.par_id}` : "PAR bekleniyor"}{detay.k.par.kesinti ? ` · kesinti ${detay.k.par.kesinti === "VAR" ? "var" : "yok"}` : ""}</dd></>}
            <dt style={dtS}>Ekip</dt><dd style={ddS}>{detay.e.ad} · {TIP_AD[detay.e.tip.kod]}</dd>
            <dt style={dtS}>Ekip şefi</dt><dd style={ddS}>{detay.e.sef ? `${detay.e.sef.ad}${detay.e.sef.telefon ? ` · ${detay.e.sef.telefon}` : ""}` : "kayıtlı değil"}</dd>
            <dt style={dtS}>Araç</dt><dd style={ddS}>{detay.e.plaka || "kayıtlı değil"}</dd>
          </dl>
        </div></div>}
    </div>
  </div>;
}
const opBtn = { background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.6)", borderRadius: 8, padding: "5px 10px", fontWeight: 800, cursor: "pointer" };
const thS = { position: "sticky", top: 0, zIndex: 2, padding: "8px 8px", textAlign: "left", fontSize: 14, borderBottom: "1px solid #cbd5e1", borderRight: "1px solid #e2e8f0", background: "#e2e8f0" };
const tdS = { verticalAlign: "top", padding: 6, borderBottom: "1px solid #e2e8f0", borderRight: "1px solid #f1f5f9", minHeight: 60 };
const dtS = { color: "#64748b" }; const ddS = { margin: 0 };

/* ═══ PLAN YAP · 3. ADIM İŞ SEÇİMİ ═══
   Props: isler (aday listesi; her biri { kod, fiziksel_id, bolge, il, site_type, kapsam_ad, anten, malzeme, fiili, atanan_ekip, mevcut… }),
          secim/setSecim (sıralı iş kodu listesi), ekip (seçili plan ekibi), gizliDahil/setGizliDahil, yenidenAta/setYenidenAta, satirAlanlari(x) */
export function PlanIsSecimi({ isler, secim, setSecim, ekip, gizliDahil, setGizliDahil, yenidenAta, setYenidenAta, satirAlanlari, mod, onGorunur }) {
  const [bolge, setBolge] = useState([]); const [arama, setArama] = useState(""); const [tip, setTip] = useState([]); const [ekipF, setEkipF] = useState("");
  const [yalnizSecili, setYalnizSecili] = useState(false);
  const q = arama.replace(/\s+/g, "").toLocaleUpperCase("tr-TR");
  const bolgeSec = [...new Set(["Ankara", "Bursa", "İzmir", ...isler.map((x) => x.bolge).filter(Boolean)])];
  const seciliSet = new Set(secim);
  const malzemeEkipleri = (x) => (x.malzeme?.ekipte || []).filter((e) => !e.baska_firma);
  const filtre = (x) => (!bolge.length || bolge.includes(x.bolge)) && (!q || x.kod.includes(q) || String(x.fiziksel_id || "").includes(q))
    && (!tip.length || tip.includes(x.atanan_ekip?.tip || malzemeEkipleri(x)[0]?.tip || "TANIMSIZ"))
    && (!ekipF || String(x.atanan_ekip?.ekip_no) === ekipF || malzemeEkipleri(x).some((e) => String(e.ekip_no) === ekipF))
    && (!yalnizSecili || seciliSet.has(x.kod));
  const gorunen = isler.filter(filtre);
  const gorunenSet = new Set(gorunen.map((x) => x.kod));
  const gorunurImza = gorunen.map((x) => x.kod).join("|");
  useEffect(() => { onGorunur && onGorunur(new Set(gorunurImza ? gorunurImza.split("|") : [])); }, [gorunurImza]); // eslint-disable-line
  const seciliGorunen = secim.filter((k) => gorunenSet.has(k)), seciliGizli = secim.filter((k) => !gorunenSet.has(k));
  // Bölümler
  const A = gorunen.filter((x) => ["DEPODA", "KISMEN_EKIP_DEPO"].includes(x.malzeme?.konum) && !x.malzeme?.montaj_basladi)
    .sort((a, b) => (a.malzeme.teslim === "TAM" ? 0 : 1) - (b.malzeme.teslim === "TAM" ? 0 : 1) || String(a.malzeme.ilk_gelis || "").localeCompare(String(b.malzeme.ilk_gelis || "")));
  const aSet = new Set(A.map((x) => x.kod));
  const Bgrup = {};
  for (const x of gorunen) if (!aSet.has(x.kod)) for (const e of malzemeEkipleri(x)) (Bgrup[e.ekip_no] = Bgrup[e.ekip_no] || { e, isler: [] }).isler.push(x);
  const bSet = new Set(Object.values(Bgrup).flatMap((g) => g.isler.map((x) => x.kod)));
  const C = gorunen.filter((x) => !aSet.has(x.kod) && !bSet.has(x.kod));
  const sec = (kod, s) => setSecim((sc) => (s ? (sc.includes(kod) ? sc : [...sc, kod]) : sc.filter((k) => k !== kod)));
  // "Filtrelenenlerin tümünü seç": eksik malzemeli (kısmi teslim) ve başka ekibe atanmış işler otomatik seçilmez
  const otomatikSecilebilir = (x) => x.malzeme?.teslim !== "KISMI" && !x.mevcut_atama;
  const topluSec = () => setSecim((sc) => [...sc, ...gorunen.filter(otomatikSecilebilir).map((x) => x.kod).filter((k) => !sc.includes(k))]);
  const atlanan = gorunen.filter((x) => !otomatikSecilebilir(x) && !seciliSet.has(x.kod)).length;
  const satir = (x) => {
    const s = seciliSet.has(x.kod);
    const baskaEkipte = ekip ? malzemeEkipleri(x).filter((e) => Number(e.ekip_no) !== Number(ekip.ekip_no)) : [];
    const mevcut = x.mevcut_atama && (!ekip || Number(x.mevcut_atama.ekip_no) !== Number(ekip.ekip_no)) ? x.mevcut_atama : null;
    return <div key={x.kod} style={{ borderTop: "1px solid #f1f5f9", padding: "8px", borderRadius: 8, background: s ? "#eff6ff" : "transparent", boxShadow: s ? "inset 3px 0 0 #1d4ed8" : "none" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <input type="checkbox" checked={s} onChange={(e) => sec(x.kod, e.target.checked)} aria-label={`${x.kod} seç`} style={{ width: 22, height: 22, accentColor: "#1d4ed8", cursor: "pointer", marginTop: 2 }} />
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}><b style={{ fontSize: 16 }}>{x.fiziksel_id}</b><code style={{ wordBreak: "break-all" }}>{x.kod}</code>
            {s && mod === "MANUEL" && <span style={{ fontSize: 12, fontWeight: 800, color: "#1d4ed8" }}>Sıra {secim.indexOf(x.kod) + 1}</span>}</div>
          <div style={{ fontSize: 13, color: "#475569" }}>{[x.bolge, x.il, x.site_type, x.kapsam_ad].filter(Boolean).join(" · ")}</div>
          <div style={{ fontSize: 13 }}>Anten: <b>{x.anten === "VAR" ? "Antenli" : x.anten === "YOK" ? "Antensiz" : "Doğrulanamadı"}</b>
            {x.malzeme ? <> · Malzeme: <b>{x.malzeme.etiket}</b>{x.malzeme.ilk_gelis ? ` · geliş ${tarihTR(x.malzeme.ilk_gelis)}` : ""}</> : " · HW malzeme kaydı yok"}
            {x.fiili ? <> · Montaj: <b>{x.fiili.ad}</b></> : null}</div>
          {x.malzeme?.teslim === "KISMI" && <div style={{ color: "#b45309", fontWeight: 800, fontSize: 13 }}>◐ Eksik malzeme{x.malzeme.eksik_aciklama ? `: ${x.malzeme.eksik_aciklama}` : ""} — otomatik plana alınmaz</div>}
          {x.mevcut_plan && <div style={{ fontSize: 13, color: "#1e40af" }}>Mevcut plan: {x.mevcut_plan}</div>}
          {s && baskaEkipte.length > 0 && <div style={{ color: "#9a3412", fontWeight: 800, fontSize: 13 }}>⚠ Malzeme {baskaEkipte.map((e) => e.ad).join(", ")} üzerinde — plan malzemeyi taşımaz; HW Malzeme Durumu'ndan devir kaydı gerekir</div>}
          {mevcut && <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: "#9a3412", fontWeight: 700, marginTop: 2 }}>
            <input type="checkbox" checked={yenidenAta.includes(x.kod)} onChange={(e) => setYenidenAta((l) => (e.target.checked ? [...l, x.kod] : l.filter((k) => k !== x.kod)))} />
            Zaten {mevcut.ad || "başka ekibe"} atanmış — mevcut atamayı iptal edip bu ekibe planla</label>}
        </div>
      </div>
      {s && satirAlanlari && satirAlanlari(x)}
    </div>;
  };
  return <div>
    <div style={{ position: "sticky", top: -16, zIndex: 3, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 12px", marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Cipler etiket="Bölge" secenekler={bolgeSec.map((b) => [b, b])} secili={bolge} setSecili={setBolge} />
        <input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Site ID / tam iş kodu ara" aria-label="Site ID ya da iş kodu ara"
          style={{ padding: "8px 10px", border: "1.5px solid #cbd5e1", borderRadius: 8, fontSize: 14, flex: "1 1 200px", minWidth: 160 }} />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Cipler etiket="Ekip tipi" secenekler={[["INHOUSE", "Inhouse"], ["TASERON", "Taşeron"], ["TANIMSIZ", "Tanımsız"]]} secili={tip} setSecili={setTip} />
        <select value={ekipF} onChange={(e) => setEkipF(e.target.value)} aria-label="Ekip" style={{ padding: "6px 8px", borderRadius: 8, border: "1.5px solid #cbd5e1" }}>
          <option value="">Tüm ekipler</option>{[...new Map(isler.flatMap((x) => [x.atanan_ekip, ...malzemeEkipleri(x)]).filter((e) => e && e.ekip_no).map((e) => [e.ekip_no, e])).values()].map((e) => <option key={e.ekip_no} value={e.ekip_no}>{e.ad}</option>)}</select>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13.5, cursor: "pointer" }}><input type="checkbox" role="switch" checked={yalnizSecili} onChange={(e) => setYalnizSecili(e.target.checked)} style={{ width: 18, height: 18 }} /> Yalnız seçilenler</label>
        <button type="button" className="rhmap-btn" onClick={topluSec} disabled={!gorunen.some((x) => otomatikSecilebilir(x) && !seciliSet.has(x.kod))}>Filtrelenenlerin tümünü seç</button>
        <button type="button" className="rhmap-btn" onClick={() => setSecim([])} disabled={!secim.length}>Tüm seçimleri kaldır</button>
      </div>
      <div aria-live="polite" style={{ fontSize: 13.5, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span><b>{secim.length}</b> seçili (toplam)</span><span><b>{seciliGorunen.length}</b> görünür seçili</span><span><b>{gorunen.length}</b> / {isler.length} iş görünüyor</span>
        {atlanan > 0 && <span style={{ color: "#b45309" }}>{atlanan} iş (eksik malzemeli / başka ekipte atanmış) toplu seçime girmez — tek tek seçin</span>}
        {seciliGizli.length > 0 && <label style={{ display: "inline-flex", gap: 6, alignItems: "center", background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: "3px 8px", color: "#9a3412", fontWeight: 700 }}>
          <input type="checkbox" checked={gizliDahil} onChange={(e) => setGizliDahil(e.target.checked)} />
          Filtre dışında kalan {seciliGizli.length} seçim korunuyor — {gizliDahil ? "plana DAHİL" : "plana dahil DEĞİL"}</label>}
      </div>
    </div>
    <Bolum baslik="A · Depoda · Atama bekleyen işler" alt="Malzemesi depoda, montaj başlamamış. Tam teslim olanlar önce; eksik malzemeliler işaretli." sayi={A}>{A.map(satir)}</Bolum>
    <Bolum baslik="B · Ekip üzerindeki malzemeler" alt="Malzemesi fiziksel olarak ekibe teslim edilmiş işler (HW Malzeme Durumu teslim kayıtları)." sayi={Object.values(Bgrup).flatMap((g) => g.isler)}>
      {Object.values(Bgrup).map(({ e, isler: l }) => {
        const saha = new Set(l.map((x) => x.fiziksel_id)).size;
        const yuk = l.filter((x) => x.fiili?.kod !== "TAMAMLANDI").length;
        return <div key={e.ekip_no} style={{ border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 8, overflow: "hidden" }}>
          <div style={{ background: "#f8fafc", padding: "8px 10px", fontWeight: 900 }}>{e.ad} — Malzemesi üzerinde {saha} saha / {l.length} iş
            <span style={{ fontWeight: 600, fontSize: 12.5, color: "#475569" }}> · {TIP_AD[e.tip] || "Ekip tipi tanımlanmadı"} · bekleyen iş yükü {yuk} iş</span>
            {ekip && Number(ekip.ekip_no) === Number(e.ekip_no) && <span style={{ marginLeft: 6, color: "#15803d", fontSize: 12.5 }}>✓ planlanan ekip</span>}</div>
          <div style={{ padding: "0 6px" }}>{l.map(satir)}</div></div>;
      })}
    </Bolum>
    <Bolum baslik="C · Diğer işler" alt="HW malzeme kaydı olmayan / eski kayıt (teyit bekleyen) işler. Kaybolmaz; isterseniz seçin." sayi={C} kapali>{C.map(satir)}</Bolum>
    {!gorunen.length && <div style={{ color: "#64748b", padding: 8 }}>{yalnizSecili && !secim.length ? "Henüz seçili iş yok." : "Filtreye uyan iş yok."}</div>}
  </div>;
}
function Bolum({ baslik, alt, sayi, children, kapali }) {
  const saha = new Set(sayi.map((x) => x.fiziksel_id)).size;
  return <details open={!kapali || undefined} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "8px 12px", marginBottom: 10 }}>
    <summary style={{ cursor: "pointer", fontWeight: 900, fontSize: 16 }}>{baslik} <span style={{ fontWeight: 600, fontSize: 13, color: "#475569" }}>({saha} saha / {sayi.length} iş)</span></summary>
    <div style={{ fontSize: 13, color: "#64748b", margin: "2px 0 6px" }}>{alt}</div>
    {children}
  </details>;
}
