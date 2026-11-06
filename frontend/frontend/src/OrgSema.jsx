// ORGANİZASYON ŞEMASI — KURUMSAL GÖRÜNÜM + MÜŞTERİ ÇIKTISI (06.11.2026, Orhan)
//   OrgYonetimSeridi   : bölgesel yönetim hiyerarşisi (müdür → süpervizör)
//   OrgEkipKart        : ekip kartı — ad, iç ekip / taşeron etiketi, bölge, şef, personel + görev, geçerli araç, durum, son teyit
//   OrgAracModal       : tarihli araç tahsisi (ekle / bitir / değiştir) — arac_tahsis; araç kaydı silinmez
//   OrgOperasyonModal  : taşeron ekibini operasyona bağla / operasyondan çıkar (firma kartı ve cari değişmez)
//   OrgBirlestirModal  : mükerrer ekip kaydını asıl ekip kimliğine birleştir (önizleme → onay; geri alınabilir)
//   OrgIndirModal      : "Güncel Organizasyonu İndir" — PDF / PNG / Excel TEK veri görüntüsünden (GET /org/cikti)
// Kaynak: /org/* (sunucu kapsamı + yetkisi). "Atanmadı" (kayıt yok) ile "Veri alınamadı" (okunamadı) ayrı gösterilir.
// Renk tek başına anlam taşımaz: iç ekip / taşeron, aktif / pasif, tahsisli / teyit bekliyor her zaman metinle yazılır.
import React, { useEffect, useMemo, useState } from "react";
import * as XLSXStyle from "xlsx-js-style";
import JSZip from "jszip";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const tokenAl = () => localStorage.getItem("token") || localStorage.getItem("finance_token") || "";
const LAC = "#1e3a5f", GRI = "#64748b", CIZGI = "#e2e8f0";
export const orgIstek2 = async (method, yol, govde) => {
  try {
    const r = await fetch(`${API_BASE}${yol}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAl()}` }, body: govde ? JSON.stringify(govde) : undefined });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j.ok !== false, status: r.status, j };
  } catch { return { ok: false, status: 0, j: { error: "Sunucuya ulaşılamadı" } }; }
};
const bugunTR = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const tarihTR = (v) => (v ? new Date(String(v).length <= 10 ? `${v}T12:00:00` : v).toLocaleDateString("tr-TR") : "—");
const zamanTR = (v) => (v ? new Date(v).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const INP = { width: "100%", padding: "8px 10px", border: "1.5px solid #d1d5db", borderRadius: "9px", fontSize: "13.5px", boxSizing: "border-box", background: "#fff", fontFamily: "inherit" };
const BTN = { ana: { background: LAC, color: "#fff", border: `1.5px solid ${LAC}` }, ikincil: { background: "#fff", color: LAC, border: "1.5px solid #cbd5e1" },
  tehlike: { background: "#fff1f2", color: "#be123c", border: "1.5px solid #fecdd3" }, yesil: { background: "#15803d", color: "#fff", border: "1.5px solid #15803d" } };
const btn = (tip = "ana", ek) => ({ ...(BTN[tip] || BTN.ana), borderRadius: "9px", padding: "8px 14px", fontSize: "13px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", ...(ek || {}) });
const Hata = ({ m }) => (m ? <div role="alert" style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: "9px", padding: "8px 12px", fontSize: "12.5px", fontWeight: 600, marginBottom: "10px" }}>{m}</div> : null);
const Bilgi = ({ children, renk = "mavi" }) => <div style={{ background: renk === "sari" ? "#fffbeb" : "#eff6ff", border: `1px solid ${renk === "sari" ? "#fde68a" : "#bfdbfe"}`, color: renk === "sari" ? "#92400e" : "#1e40af", borderRadius: "9px", padding: "8px 12px", fontSize: "12.5px", lineHeight: 1.5, marginBottom: "10px" }}>{children}</div>;
function Alan({ etiket, ipucu, children }) {
  return (
    <label style={{ display: "block", marginBottom: "11px" }}>
      <span style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#334155", marginBottom: "4px" }}>{etiket}</span>
      {children}
      {ipucu && <span style={{ display: "block", fontSize: "11.5px", color: GRI, marginTop: "3px" }}>{ipucu}</span>}
    </label>
  );
}
function Modal({ baslik, alt, onClose, children, altBar, genislik = 600 }) {
  useEffect(() => { const f = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 1160, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <div role="dialog" aria-modal="true" aria-label={typeof baslik === "string" ? baslik : undefined} onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: "16px", width: `min(${genislik}px, 96vw)`, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 25px 60px rgba(0,0,0,0.3)", textAlign: "left" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${CIZGI}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", background: "#f8fafc" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: "15.5px", color: "#0f172a" }}>{baslik}</div>
            {alt && <div style={{ fontSize: "12.5px", color: GRI, marginTop: "2px" }}>{alt}</div>}
          </div>
          <button onClick={onClose} aria-label="Kapat" style={{ background: CIZGI, border: "none", borderRadius: "8px", padding: "6px 11px", cursor: "pointer", fontWeight: 800 }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", padding: "14px 18px" }}>{children}</div>
        {altBar && <div style={{ padding: "12px 18px", borderTop: `1px solid ${CIZGI}`, display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap", background: "#fff" }}>{altBar}</div>}
      </div>
    </div>
  );
}

/* ═══ ORTAK METİNLER — ekran, PDF / PNG ve Excel aynı sözcükleri kullanır ═══ */
export const ORG_TUR = { IC: { ad: "İç ekip", kisa: "İÇ EKİP" }, DIS: { ad: "Taşeron ekibi", kisa: "TAŞERON" } };
const turAd = (t) => ORG_TUR[t]?.ad || "Tür seçilmedi";
// Araç durumu metni: tahsisli (tarihli kayıt) / teyit bekliyor (tarihsiz kart bilgisi) / Atanmadı / Veri alınamadı
export const orgAracMetni = (durum, plakalar) => durum === "VERI_YOK" ? "Veri alınamadı" : durum === "KAYIT_YOK" ? "Kayıt yok" : !plakalar.length ? "Atanmadı"
  : plakalar.join(", ") + (durum === "TAHSISLI" ? "" : " (teyit bekliyor)");
const KAYNAK_AD = { TAHSIS: "tarihli tahsis", PERSONEL_KARTI: "personel kartı", ARAC_KARTI: "araç kartı sürücüsü", EKIP_KAYDI: "ekip kaydı (eski alan)" };

/* ═══ BÖLGESEL YÖNETİM ŞERİDİ ═══ */
// ust: [{ ad, gorev }] üst yönetim (yoksa çizilmez — bilinmeyen kadro uydurulmaz); bolgeler: [{ ad, mudur:{ad,gorev}, supervizor:{ad,gorev}, ekip }]
export function OrgYonetimSeridi({ ust = [], destek = [], bolgeler = [] }) {
  const Kutu = ({ k, koyu, kucuk }) => (
    <div style={{ background: koyu ? LAC : "#fff", color: koyu ? "#fff" : "#0f172a", border: `1.5px solid ${koyu ? LAC : "#cbd5e1"}`, borderRadius: "10px", padding: kucuk ? "7px 12px" : "9px 16px", minWidth: kucuk ? "170px" : "210px", textAlign: "center", boxShadow: "0 1px 3px rgba(15,23,42,0.08)" }}>
      <div style={{ fontWeight: 800, fontSize: kucuk ? "12.5px" : "13.5px", lineHeight: 1.25 }}>{k.ad}</div>
      <div style={{ fontSize: "11px", fontWeight: 600, opacity: koyu ? 0.85 : 1, color: koyu ? "#fff" : GRI, marginTop: "2px" }}>{k.gorev}</div>
    </div>
  );
  const Cizgi = () => <div aria-hidden="true" style={{ width: "2px", height: "14px", background: "#94a3b8", margin: "0 auto" }} />;
  if (!ust.length && !bolgeler.length) return null;
  return (
    <div className="org-yonetim" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
      {ust.map((k, i) => <React.Fragment key={k.ad}>{i > 0 && <Cizgi />}<Kutu k={k} koyu /></React.Fragment>)}
      {destek.length > 0 && <><Cizgi /><div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>{destek.map((k) => <Kutu key={k.ad} k={k} kucuk />)}</div></>}
      {bolgeler.length > 0 && (ust.length > 0 || destek.length > 0) && <Cizgi />}
      <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", justifyContent: "center", width: "100%" }}>
        {bolgeler.map((b) => (
          <div key={b.ad} style={{ flex: "1 1 280px", maxWidth: "440px", background: "#f8fafc", border: `1px solid ${CIZGI}`, borderRadius: "12px", overflow: "hidden" }}>
            <div style={{ background: LAC, color: "#fff", fontSize: "12px", fontWeight: 800, letterSpacing: ".04em", padding: "6px 12px", textAlign: "center" }}>{b.ad.toLocaleUpperCase("tr-TR")} BÖLGE YÖNETİMİ{b.ekip != null ? ` · ${b.ekip} EKİP` : ""}</div>
            <div style={{ padding: "10px", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <Kutu k={b.mudur} koyu kucuk /><Cizgi /><Kutu k={b.supervizor} kucuk />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══ EKİP KARTI ═══ */
const Satir = ({ etiket, children, soluk }) => (
  <div style={{ display: "grid", gridTemplateColumns: "78px 1fr", gap: "8px", padding: "3px 0", fontSize: "12.5px", lineHeight: 1.4 }}>
    <span style={{ color: GRI, fontWeight: 600 }}>{etiket}</span>
    <span style={{ color: soluk ? "#94a3b8" : "#0f172a", fontWeight: soluk ? 500 : 600, overflowWrap: "anywhere" }}>{children}</span>
  </div>
);
export function OrgEkipKart({ e, menu, onClick, yonetici }) {
  const tur = ORG_TUR[e.tur];
  const sef = e.sef || e.sef_eski_kural || null;
  const arac = e.arac || { durum: "VERI_YOK", liste: [], uyarilar: [] };
  const etkin = e.etkin !== false;
  const turStil = e.tur === "DIS" ? { background: "#fef3c7", color: "#78350f", border: "1px solid #fcd34d" } : e.tur === "IC" ? { background: "#e0f2fe", color: "#0c4a6e", border: "1px solid #7dd3fc" } : { background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1" };
  return (
    <div className="org-kart" onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={(ev) => { if (onClick && ev.key === "Enter") onClick(); }}
      aria-label={`${e.ad} ekip kartı`} style={{ border: `1.5px solid ${CIZGI}`, borderRadius: "12px", background: "#fff", cursor: onClick ? "pointer" : "default", opacity: etkin ? 1 : 0.6, display: "flex", flexDirection: "column", breakInside: "avoid" }}>
      <div style={{ background: etkin ? LAC : "#64748b", color: "#fff", padding: "9px 10px 9px 12px", borderRadius: "10px 10px 0 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: "14px", lineHeight: 1.25, overflowWrap: "anywhere" }}>{e.ad || `Ekip ${e.ekip_no}`}</div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "5px" }}>
            <span style={{ ...turStil, fontSize: "10px", fontWeight: 800, letterSpacing: ".04em", borderRadius: "999px", padding: "1px 8px" }}>{tur?.kisa || "TÜR SEÇİLMEDİ"}</span>
            <span style={{ fontSize: "10px", fontWeight: 800, borderRadius: "999px", padding: "1px 8px", background: etkin ? "#dcfce7" : "#e2e8f0", color: etkin ? "#166534" : "#334155" }}>{e.aktif === false ? "PASİF" : e.firma_aktif === false ? "FİRMA PASİF" : "AKTİF"}</span>
          </div>
        </div>
        {menu}
      </div>
      <div style={{ padding: "9px 12px 6px", flex: 1 }}>
        {e.tur === "DIS" && e.firma_gorunen && !e.firma_ad_ayni && <Satir etiket="Firma">{e.firma_gorunen}</Satir>}
        {e.tur !== "IC" && e.tur !== "DIS" && e.taseron_adi && <Satir etiket="Firma (yazılı)">{e.taseron_adi}</Satir>}
        <Satir etiket="Bölge" soluk={!e.bolge}>{e.bolge || "Atanmadı"}</Satir>
        <Satir etiket="Ekip şefi" soluk={!sef}>{e.sef_gerekli ? <span style={{ color: "#b45309" }}>Şef ayrıldı — yeni şef seçin</span> : sef ? sef.ad_soyad : "Atanmadı"}</Satir>
        <Satir etiket="Araç" soluk={!arac.liste.length}>
          {arac.durum === "VERI_YOK" ? <span style={{ color: "#b45309" }}>Veri alınamadı</span> : !arac.liste.length ? "Atanmadı" : arac.liste.map((a) => (
            <span key={a.plaka_n} style={{ display: "inline-block", marginRight: "8px" }}>{a.plaka} <span style={{ fontSize: "10.5px", fontWeight: 700, color: a.dogrulanmis ? "#166534" : "#92400e" }}>{a.dogrulanmis ? "tahsisli" : "teyit bekliyor"}</span></span>
          ))}
        </Satir>
        <div style={{ borderTop: `1px dashed ${CIZGI}`, margin: "6px 0 4px" }} />
        <div style={{ fontSize: "11px", fontWeight: 700, color: GRI, letterSpacing: ".03em", marginBottom: "2px" }}>PERSONEL · {e.uyeler?.length || 0}</div>
        {(e.uyeler || []).map((p) => (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: "8px", padding: "2px 0", fontSize: "12.5px" }}>
            <span style={{ fontWeight: sef && sef.id === p.id ? 800 : 600, color: "#0f172a", overflowWrap: "anywhere" }}>{p.ad_soyad}</span>
            <span style={{ color: GRI, fontSize: "11.5px", textAlign: "right", flexShrink: 0, maxWidth: "48%" }}>{sef && sef.id === p.id ? "Ekip şefi" : (p.unvan || "").trim() || "—"}</span>
          </div>
        ))}
        {!(e.uyeler || []).length && <div style={{ fontSize: "12px", color: "#94a3b8", padding: "2px 0" }}>Atanmadı</div>}
        {yonetici && arac.uyarilar?.length > 0 && (
          <div style={{ marginTop: "6px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", padding: "5px 8px", fontSize: "11px", color: "#92400e", lineHeight: 1.45 }}>
            {arac.uyarilar.map((u) => <div key={u}>⚠ {u}</div>)}
          </div>
        )}
      </div>
      <div style={{ padding: "6px 12px 8px", borderTop: `1px solid #f1f5f9`, fontSize: "10.5px", color: e.teyit ? "#166534" : "#94a3b8", fontWeight: 600 }}>
        {e.teyit ? `Son teyit: ${zamanTR(e.teyit.zaman)}` : "Teyit edilmedi"}{e.updated_at ? ` · Güncelleme: ${tarihTR(e.updated_at)}` : ""}
        {e.eski_adlar?.length > 0 && yonetici ? <span style={{ color: "#94a3b8" }}> · Eski ad: {e.eski_adlar.join(", ")}</span> : null}
      </div>
    </div>
  );
}

/* ═══ ARAÇ TAHSİSİ ═══ */
export function OrgAracModal({ ekip, onClose, onBitti }) {
  const [sec, setSec] = useState(null), [hata, setHata] = useState(""), [bekle, setBekle] = useState(false);
  const [f, setF] = useState({ arac_id: "", bas: bugunTR(), surucu: "", gerekce: "", yerine: "" });
  const [bitir, setBitir] = useState(null); // { tahsis, bitis, gerekce }
  useEffect(() => { orgIstek2("GET", "/org/arac-secim").then((r) => (r.ok ? setSec(r.j) : setHata(r.j.error || "Araç listesi alınamadı"))); }, []);
  const tahsisler = (ekip.arac?.liste || []).flatMap((a) => a.kaynaklar.filter((k) => k.kaynak === "TAHSIS").map((k) => ({ ...k, plaka: a.plaka })));
  const tarihsiz = ekip.arac?.durum === "TAHSISLI" ? (ekip.arac.tarihsiz || []) : (ekip.arac?.liste || []);
  const ekle = async () => {
    setHata("");
    if (!f.arac_id) return setHata("Araç seçin");
    if (!f.gerekce.trim()) return setHata("Gerekçe yazın");
    setBekle(true);
    const r = await orgIstek2("POST", `/org/ekip/${ekip.ekip_no}/arac`, { arac_id: Number(f.arac_id), bas: f.bas, gerekce: f.gerekce, surucu_personel_id: f.surucu ? Number(f.surucu) : null, yerine_tahsis_id: f.yerine ? Number(f.yerine) : null });
    setBekle(false);
    if (!r.ok) return setHata(r.j.error || "Tahsis kaydedilemedi");
    onBitti();
  };
  const bitirKaydet = async () => {
    setHata("");
    if (!bitir.gerekce.trim()) return setHata("Bitiş gerekçesini yazın");
    setBekle(true);
    const r = await orgIstek2("POST", `/org/ekip/${ekip.ekip_no}/arac/${bitir.tahsis.tahsis_id}/bitir`, { bitis: bitir.bitis, gerekce: bitir.gerekce });
    setBekle(false);
    if (!r.ok) return setHata(r.j.error || "Tahsis bitirilemedi");
    onBitti();
  };
  return (
    <Modal baslik={`🚗 Araç Tahsisi — ${ekip.ad}`} alt="Tahsis tarihlidir: başlangıç, bitiş, yapan ve gerekçe saklanır. Araç kaydı silinmez." onClose={onClose} genislik={620}
      altBar={<button style={btn("ikincil")} onClick={onClose}>Kapat</button>}>
      <Hata m={hata} />
      {sec && !sec.kurulu && <Bilgi renk="sari">Tarihli araç tahsisi tablosu bu kurulumda açılmamış — tahsis girilemez.</Bilgi>}
      <div style={{ fontSize: "12px", fontWeight: 800, color: "#334155", marginBottom: "6px" }}>GEÇERLİ TAHSİSLER</div>
      {tahsisler.length === 0 && <div style={{ fontSize: "12.5px", color: "#94a3b8", marginBottom: "10px" }}>Tarihli tahsis yok.</div>}
      {tahsisler.map((t) => (
        <div key={t.tahsis_id} style={{ display: "flex", alignItems: "center", gap: "10px", border: `1px solid ${CIZGI}`, borderRadius: "9px", padding: "7px 10px", marginBottom: "6px", fontSize: "13px" }}>
          <b>{t.plaka}</b><span style={{ color: GRI }}>{tarihTR(t.bas)} – {t.bit ? tarihTR(t.bit) : "devam ediyor"}</span>
          <span style={{ flex: 1 }} />
          <button style={btn("ikincil", { padding: "5px 10px", fontSize: "12px" })} onClick={() => setF({ ...f, yerine: String(t.tahsis_id) })}>Başka araçla değiştir</button>
          <button style={btn("tehlike", { padding: "5px 10px", fontSize: "12px" })} onClick={() => setBitir({ tahsis: t, bitis: bugunTR(), gerekce: "" })}>Tahsisi bitir</button>
        </div>
      ))}
      {bitir && (
        <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: "10px", padding: "10px 12px", marginBottom: "10px" }}>
          <div style={{ fontSize: "12.5px", fontWeight: 700, marginBottom: "6px" }}>{bitir.tahsis.plaka} tahsisini bitir — araç kaydı ve geçmiş tahsis silinmez</div>
          <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: "8px" }}>
            <input type="date" value={bitir.bitis} max={bugunTR()} onChange={(e) => setBitir({ ...bitir, bitis: e.target.value })} style={INP} aria-label="Bitiş tarihi" />
            <input value={bitir.gerekce} onChange={(e) => setBitir({ ...bitir, gerekce: e.target.value })} placeholder="Gerekçe (zorunlu)" style={INP} />
          </div>
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "8px" }}>
            <button style={btn("ikincil")} onClick={() => setBitir(null)}>Vazgeç</button><button style={btn("tehlike")} disabled={bekle} onClick={bitirKaydet}>Tahsisi bitir</button>
          </div>
        </div>
      )}
      {tarihsiz.length > 0 && (
        <Bilgi renk="sari"><b>Tarihsiz kayıtlarda görünen plaka:</b> {tarihsiz.map((a) => `${a.plaka} (${a.kaynaklar.map((k) => KAYNAK_AD[k.kaynak] + (k.ad ? ` — ${k.ad}` : "")).join(", ")})${a.kayitli ? "" : " — araç kaydı yok"}`).join(" · ")}.
          {" "}Bunlar tahsis sayılmaz; aşağıdan tarihli tahsis girildiğinde geçerli araç o olur.</Bilgi>
      )}
      {(ekip.arac?.uyarilar || []).length > 0 && <Bilgi renk="sari">{ekip.arac.uyarilar.map((u) => <div key={u}>⚠ {u}</div>)}</Bilgi>}
      <div style={{ fontSize: "12px", fontWeight: 800, color: "#334155", margin: "12px 0 6px" }}>{f.yerine ? "ARACI DEĞİŞTİR — önceki tahsis yeni başlangıçtan bir gün önce biter" : "YENİ TAHSİS"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: "10px" }}>
        <Alan etiket="Araç">
          <select value={f.arac_id} onChange={(e) => setF({ ...f, arac_id: e.target.value })} style={INP} disabled={!sec?.kurulu}>
            <option value="">Araç seçin…</option>
            {(sec?.araclar || []).map((a) => <option key={a.id} value={a.id}>{a.plaka}{a.arac ? ` · ${a.arac}` : ""}{a.tahsisli.length ? ` — tahsisli: ${a.tahsisli.map((t) => t.ekip_ad || "kişi").join(", ")}` : ""}</option>)}
          </select>
        </Alan>
        <Alan etiket="Başlangıç"><input type="date" value={f.bas} onChange={(e) => setF({ ...f, bas: e.target.value })} style={INP} /></Alan>
      </div>
      <Alan etiket="Sürücü (isteğe bağlı)" ipucu="Yalnız bu ekibin güncel üyeleri.">
        <select value={f.surucu} onChange={(e) => setF({ ...f, surucu: e.target.value })} style={INP}><option value="">Belirtilmedi</option>{(ekip.uyeler || []).map((p) => <option key={p.id} value={p.id}>{p.ad_soyad}</option>)}</select>
      </Alan>
      <Alan etiket="Gerekçe (zorunlu)"><input value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} style={INP} placeholder="Ör. ekip aracı olarak teslim edildi" /></Alan>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
        {f.yerine && <button style={btn("ikincil")} onClick={() => setF({ ...f, yerine: "" })}>Değiştirmeyi bırak</button>}
        <button style={btn("ana", { opacity: bekle ? 0.6 : 1 })} disabled={bekle || !sec?.kurulu} onClick={ekle}>{f.yerine ? "Aracı değiştir" : "Tahsis et"}</button>
      </div>
    </Modal>
  );
}

/* ═══ OPERASYON BAĞLANTISI ═══ */
export function OrgOperasyonModal({ ekip, mod, operasyonlar, bolgeler, onClose, onBitti }) {
  const [on, setOn] = useState(null), [hata, setHata] = useState(""), [bekle, setBekle] = useState(false);
  const [f, setF] = useState({ tarih: bugunTR(), gerekce: "", uyeler: false, operasyon: ekip.operasyon_firma || "", bolge: ekip.bolge || "" });
  useEffect(() => { if (mod === "cikar") orgIstek2("GET", `/org/ekip/${ekip.ekip_no}/operasyon-onizleme`).then((r) => (r.ok ? setOn(r.j) : setHata(r.j.error || "Önizleme alınamadı"))); }, [ekip.ekip_no, mod]);
  const kaydet = async () => {
    setHata("");
    if (!f.gerekce.trim()) return setHata("Gerekçe yazın");
    setBekle(true);
    const r = mod === "cikar"
      ? await orgIstek2("POST", `/org/ekip/${ekip.ekip_no}/operasyon-cikar`, { tarih: f.tarih, gerekce: f.gerekce, onay: true, uyeler: f.uyeler ? "cikar" : undefined })
      : await orgIstek2("POST", `/org/ekip/${ekip.ekip_no}/operasyon-bagla`, { operasyon_firma: f.operasyon, bolge: f.bolge, tarih: f.tarih, gerekce: f.gerekce });
    setBekle(false);
    if (!r.ok) return setHata(r.j.error || "İşlem tamamlanamadı");
    onBitti();
  };
  if (mod === "bagla") return (
    <Modal baslik={`Operasyona bağla — ${ekip.ad}`} alt="Taşeron firmanın hukuki kimliği, carisi ve personelinin işvereni değişmez." onClose={onClose}
      altBar={<><button style={btn("ikincil")} onClick={onClose}>Vazgeç</button><button style={btn("ana")} disabled={bekle} onClick={kaydet}>Operasyona bağla</button></>}>
      <Hata m={hata} />
      <Alan etiket="Operasyonu yöneten firma" ipucu="Ekip bu firmanın operasyonunda görünür ve iş atanabilir.">
        <select value={f.operasyon} onChange={(e) => setF({ ...f, operasyon: e.target.value })} style={INP}><option value="">Seçin…</option>{operasyonlar.map((o) => <option key={o.kod} value={o.kod}>{o.ad}</option>)}</select>
      </Alan>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: "10px" }}>
        <Alan etiket="Bölge"><select value={f.bolge} onChange={(e) => setF({ ...f, bolge: e.target.value })} style={INP}><option value="">Bölge atanmadı</option>{bolgeler.map((b) => <option key={b} value={b}>{b}</option>)}</select></Alan>
        <Alan etiket="Başlangıç tarihi"><input type="date" value={f.tarih} onChange={(e) => setF({ ...f, tarih: e.target.value })} style={INP} /></Alan>
      </div>
      <Alan etiket="Gerekçe (zorunlu)"><input value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} style={INP} /></Alan>
    </Modal>
  );
  const engel = on?.engeller || [];
  return (
    <Modal baslik={`Operasyondan çıkar — ${ekip.ad}`} alt="Yalnız bu ekibin operasyon bağlantısı sona erer. Firma kartı, cari, fatura / hakediş kayıtları ve geçmiş işler değişmez." onClose={onClose} genislik={640}
      altBar={<><button style={btn("ikincil")} onClick={onClose}>Vazgeç</button><button style={btn("tehlike", { opacity: bekle || engel.length || !on ? 0.5 : 1 })} disabled={bekle || engel.length > 0 || !on} onClick={kaydet}>Operasyondan çıkar</button></>}>
      <Hata m={hata} />
      {!on && !hata && <div style={{ fontSize: "13px", color: GRI }}>Etkiler okunuyor…</div>}
      {on && (
        <>
          {engel.length > 0 && <div role="alert" style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: "9px", padding: "8px 12px", fontSize: "12.5px", fontWeight: 600, marginBottom: "10px" }}>Önce çözülmesi gerekenler:{engel.map((x) => <div key={x}>• {x}</div>)}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
            {[["Açık iş ataması", on.acik_isler.length, on.acik_isler.map((x) => `#${x.id} ${(x.site_codes || []).join(", ")}`).join(" · ")],
              ["Güncel personel", on.personel.length, on.personel.map((p) => p.ad_soyad).join(", ")],
              ["Geçerli araç tahsisi", on.arac_tahsisleri.length, on.arac_tahsisleri.map((t) => t.plaka).join(", ")],
              ["Ekipte duran malzeme", on.malzeme_veri === "VERI_YOK" ? "Veri alınamadı" : on.malzeme_bakiye, ""],
              ["Taşeron mobil hesabı", on.taseron_hesaplari.length, on.taseron_hesaplari.map((h) => h.name).join(", ")],
              ["Firmanın diğer ekipleri", on.firma_diger_ekipler.length, on.firma_diger_ekipler.map((x) => `${x.ad}${x.bolge ? ` (${x.bolge})` : ""}`).join(", ") || "—"]].map(([ad, n, ek]) => (
              <div key={ad} style={{ border: `1px solid ${CIZGI}`, borderRadius: "9px", padding: "7px 10px" }}>
                <div style={{ fontSize: "11px", color: GRI, fontWeight: 700 }}>{ad}</div>
                <div style={{ fontSize: "15px", fontWeight: 800, color: "#0f172a" }}>{n}</div>
                {ek && <div style={{ fontSize: "11px", color: GRI, overflowWrap: "anywhere" }}>{ek}</div>}
              </div>
            ))}
          </div>
          <Bilgi>Araç tahsisleri çıkış tarihinde sona erer (araç kaydı silinmez). {on.firma_diger_ekipler.length ? "Firmanın diğer ekipleri ve firma kartı etkilenmez. " : ""}Taşeron mobil hesapları kapatılmaz; gerekirse Taşeron Hesapları ekranından ayrıca kapatılır.</Bilgi>
          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: "10px" }}>
            <Alan etiket="Çıkış tarihi"><input type="date" value={f.tarih} max={bugunTR()} onChange={(e) => setF({ ...f, tarih: e.target.value })} style={INP} /></Alan>
            <Alan etiket="Gerekçe (zorunlu)"><input value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} style={INP} /></Alan>
          </div>
          {on.personel.length > 0 && (
            <label style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "12.5px", color: "#0f172a" }}>
              <input type="checkbox" checked={f.uyeler} onChange={(e) => setF({ ...f, uyeler: e.target.checked })} style={{ marginTop: "2px" }} />
              <span>{on.personel.length} kişinin ekip üyeliği de bu tarihte bitsin (personel kaydı ve uygulama hesabı silinmez).</span>
            </label>
          )}
        </>
      )}
    </Modal>
  );
}

/* ═══ MÜKERRER EKİP BİRLEŞTİRME ═══ */
export function OrgBirlestirModal({ kaynak, ekipler, onClose, onBitti }) {
  const adaylar = ekipler.filter((e) => e.ekip_no !== kaynak.ekip_no && e.tur === kaynak.tur && (e.operasyon_firma || "") === (kaynak.operasyon_firma || "") && (e.firma_id || null) === (kaynak.firma_id || null));
  const [hedef, setHedef] = useState(""), [on, setOn] = useState(null), [gerekce, setGerekce] = useState(""), [hata, setHata] = useState(""), [bekle, setBekle] = useState(false);
  useEffect(() => { setOn(null); setHata(""); if (hedef) orgIstek2("GET", `/org/ekip/${kaynak.ekip_no}/birlestir-onizleme?hedef=${hedef}`).then((r) => (r.ok ? setOn(r.j) : setHata(r.j.error || "Önizleme alınamadı"))); }, [hedef, kaynak.ekip_no]);
  const kaydet = async () => {
    setHata("");
    if (!gerekce.trim()) return setHata("Gerekçe yazın");
    setBekle(true);
    const r = await orgIstek2("POST", `/org/ekip/${kaynak.ekip_no}/birlestir`, { hedef_no: Number(hedef), gerekce, onay: true });
    setBekle(false);
    if (!r.ok) return setHata(r.j.error || "Birleştirilemedi");
    onBitti();
  };
  const bag = (b) => Object.entries(b || {}).filter(([k, v]) => Number(v) > 0 && k !== "acik_is_atama").map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(", ") || "bağlantı yok";
  return (
    <Modal baslik={`Mükerrer kaydı birleştir — ${kaynak.ad}`} alt="Bu kayıt (boş mükerrer) pasife alınır ve asıl ekibe bağlanır; asıl ekibin kimliği, personeli ve geçmişi değişmez. Geri alınabilir." onClose={onClose} genislik={640}
      altBar={<><button style={btn("ikincil")} onClick={onClose}>Vazgeç</button><button style={btn("ana", { opacity: !on?.uygun || bekle ? 0.5 : 1 })} disabled={!on?.uygun || bekle} onClick={kaydet}>Birleştir</button></>}>
      <Hata m={hata} />
      <Alan etiket="Asıl ekip (personeli ve geçmişi taşıyan kayıt)" ipucu="Yalnız aynı türde, aynı firmaya bağlı ekipler listelenir. Tür isimden tahmin edilmez.">
        <select value={hedef} onChange={(e) => setHedef(e.target.value)} style={INP}><option value="">Seçin…</option>{adaylar.map((e) => <option key={e.ekip_no} value={e.ekip_no}>#{e.ekip_no} {e.ad} — {e.uye_sayisi} kişi</option>)}</select>
      </Alan>
      {on && (
        <>
          {!on.uygun && <div role="alert" style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: "9px", padding: "8px 12px", fontSize: "12.5px", fontWeight: 600, marginBottom: "10px" }}>{on.engeller.map((x) => <div key={x}>• {x}</div>)}</div>}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px", marginBottom: "10px" }}>
            <tbody>
              {[["Korunan ekip kimliği", `#${on.hedef.ekip_no} ${on.hedef.ad} → adı “${on.sonuc.hedef.ad}” olur`], ["Eski ad izlenir", on.sonuc.hedef.eski_adlar.join(", ") || "—"],
                ["Asıl ekipteki kayıtlar", bag(on.hedef.baglanti) + " — aynen kalır"], ["İş etiketleri (tek ekipte)", on.sonuc.hedef.is_etiketleri.join(", ") || "—"],
                ["Etiketli iş kaydı", `${on.etiket_is.hedef_once ?? "?"} + ${on.etiket_is.kaynak ?? "?"} → ${on.etiket_is.sonra ?? "?"}`], ["Mükerrer kayıt", `#${on.kaynak.ekip_no} ${on.kaynak.ad} → pasif, silinmez (${bag(on.kaynak.baglanti)})`]].map(([a, b]) => (
                <tr key={a}><td style={{ padding: "5px 8px", color: GRI, fontWeight: 700, borderBottom: `1px solid #f1f5f9`, width: "38%" }}>{a}</td><td style={{ padding: "5px 8px", borderBottom: `1px solid #f1f5f9`, overflowWrap: "anywhere" }}>{b}</td></tr>
              ))}
            </tbody>
          </table>
          {on.uygun && <Alan etiket="Gerekçe (zorunlu)"><input value={gerekce} onChange={(e) => setGerekce(e.target.value)} style={INP} /></Alan>}
        </>
      )}
    </Modal>
  );
}

/* ═══ MÜŞTERİ ÇIKTISI — tek veri görüntüsü (GET /org/cikti) → PNG / PDF / Excel ═══ */
// Çıktıda maaş, maliyet, hakediş, kimlik no, telefon, e-posta, hesap / yetki ve iç not YOKTUR (sunucu göndermez).
const dosyaAdi = (v, uz) => `${String(v.kurum.ad).replace(/[^A-Za-z0-9ÇĞİÖŞÜçğıöşü]+/g, "_")}_Organizasyon_${v.tarih}${v.kapsam.bolge !== "Tüm bölgeler" ? "_" + v.kapsam.bolge : ""}.${uz}`;
const indir = (blob, ad) => { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = ad; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 3000); };
const ciktiAlt = (v) => `Üretim: ${zamanTR(v.uretim)} · Organizasyon tarihi: ${tarihTR(v.tarih)} · Kapsam: ${v.kapsam.operasyon_ad} / ${v.kapsam.bolge} · Son teyit: ${v.teyit.son ? zamanTR(v.teyit.son) : "teyit kaydı yok"}`;
const ciktiNot = (v) => [v.teyit.teyitsiz_ekip ? `${v.teyit.teyitsiz_ekip} ekibin bilgisi henüz teyit edilmedi (“teyit edilmedi” yazar).` : null,
  v.arac_veri === "VERI_YOK" ? "Araç bilgisi alınamadı; araç alanları doğrulanmış sayılmaz." : null,
  "“(teyit bekliyor)” yazan plakalar tarihli tahsis kaydına dayanmaz.", v.tarihsel.aciklama].filter(Boolean);

// Blok düzeni: her blok kendi yüksekliğini bilir ve verilen y'ye çizer; PNG tek uzun sayfa, PDF A4 yatay sayfalara bölünür.
const S = 2, GEN = 1600, KENAR = 44, SUTUN = 4, ARA = 16;
const yaz = (ctx, t, x, y, o = {}) => { ctx.font = `${o.kalin ? "bold " : ""}${o.boy || 13}px Arial, Helvetica, sans-serif`; ctx.fillStyle = o.renk || "#0f172a"; ctx.textAlign = o.hiza || "left"; ctx.textBaseline = "top"; ctx.fillText(t, x, y); };
const satirlar = (ctx, t, gen, o = {}) => { // sözcük kaydırma (uzun adlar kesilmez)
  ctx.font = `${o.kalin ? "bold " : ""}${o.boy || 13}px Arial, Helvetica, sans-serif`;
  const out = []; let s = "";
  for (const w of String(t || "").split(/\s+/)) {
    const d = s ? `${s} ${w}` : w;
    if (ctx.measureText(d).width <= gen || !s) s = d; else { out.push(s); s = w; }
    while (ctx.measureText(s).width > gen && s.length > 1) { let i = s.length - 1; while (i > 1 && ctx.measureText(s.slice(0, i)).width > gen) i--; out.push(s.slice(0, i)); s = s.slice(i); }
  }
  if (s) out.push(s);
  return out.length ? out : [""];
};
const kutu = (ctx, x, y, w, h, r, dolgu, cizgi) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); if (dolgu) { ctx.fillStyle = dolgu; ctx.fill(); } if (cizgi) { ctx.strokeStyle = cizgi; ctx.lineWidth = 1.5; ctx.stroke(); } };
function ciktiBloklari(v, yonetim) {
  const olc = document.createElement("canvas").getContext("2d");
  const bloklar = [];
  const icGen = GEN - KENAR * 2, kartGen = (icGen - ARA * (SUTUN - 1)) / SUTUN;
  // Başlık bandı
  bloklar.push({ h: 104, ciz: (ctx, y) => {
    ctx.fillStyle = LAC; ctx.fillRect(0, y, GEN, 84);
    yaz(ctx, v.kurum.ad.toLocaleUpperCase("tr-TR"), KENAR, y + 16, { boy: 28, kalin: true, renk: "#fff" });
    yaz(ctx, "SAHA ORGANİZASYON ŞEMASI", KENAR, y + 52, { boy: 14, kalin: true, renk: "#cbd5e1" });
    yaz(ctx, `${v.kapsam.operasyon_ad} · ${v.kapsam.bolge}`, GEN - KENAR, y + 18, { boy: 16, kalin: true, renk: "#fff", hiza: "right" });
    yaz(ctx, `Organizasyon tarihi: ${tarihTR(v.tarih)}`, GEN - KENAR, y + 44, { boy: 13, renk: "#cbd5e1", hiza: "right" });
    yaz(ctx, ciktiAlt(v), KENAR, y + 90, { boy: 11.5, renk: GRI });
  } });
  // Özet sayılar
  const oz = [["Ekip", v.sayilar.ekip], ["İç ekip", v.sayilar.ic_ekip], ["Taşeron ekibi", v.sayilar.taseron_ekip], ["Personel", v.sayilar.personel], ["Araç", v.arac_veri === "VERI_YOK" ? "—" : v.sayilar.arac]];
  bloklar.push({ h: 62, ciz: (ctx, y) => oz.forEach(([ad, n], i) => { const w = (icGen - ARA * (oz.length - 1)) / oz.length, x = KENAR + i * (w + ARA);
    kutu(ctx, x, y + 6, w, 46, 9, "#f8fafc", CIZGI); yaz(ctx, String(n), x + 14, y + 13, { boy: 22, kalin: true, renk: LAC }); yaz(ctx, ad, x + w - 14, y + 22, { boy: 12.5, kalin: true, renk: GRI, hiza: "right" }); }) });
  // Yönetim
  const yb = (yonetim?.bolgeler || []);
  if ((yonetim?.ust || []).length) bloklar.push({ h: 20 + yonetim.ust.length * 58 + ((yonetim.destek || []).length ? 62 : 0), ciz: (ctx, y) => {
    let yy = y + 8; const cx = GEN / 2;
    yonetim.ust.forEach((k, i) => { if (i) { ctx.fillStyle = "#94a3b8"; ctx.fillRect(cx - 1, yy - 12, 2, 12); } kutu(ctx, cx - 150, yy, 300, 46, 9, LAC); yaz(ctx, k.ad, cx, yy + 7, { boy: 14, kalin: true, renk: "#fff", hiza: "center" }); yaz(ctx, k.gorev, cx, yy + 26, { boy: 11.5, renk: "#cbd5e1", hiza: "center" }); yy += 58; });
    const d = yonetim.destek || [];
    if (d.length) { const w = Math.min(280, (icGen - ARA * (d.length - 1)) / d.length), top = d.length * w + (d.length - 1) * ARA, x0 = (GEN - top) / 2;
      ctx.fillStyle = "#94a3b8"; ctx.fillRect(cx - 1, yy - 12, 2, 12);
      d.forEach((k, i) => { const x = x0 + i * (w + ARA); kutu(ctx, x, yy, w, 46, 9, "#fff", "#cbd5e1"); yaz(ctx, k.ad, x + w / 2, yy + 7, { boy: 13, kalin: true, hiza: "center" }); yaz(ctx, k.gorev, x + w / 2, yy + 26, { boy: 11, renk: GRI, hiza: "center" }); }); }
  } });
  if (yb.length) bloklar.push({ h: 148, ciz: (ctx, y) => {
    const w = Math.min(520, (icGen - ARA * (yb.length - 1)) / yb.length), top = yb.length * w + (yb.length - 1) * ARA, x0 = (GEN - top) / 2;
    yb.forEach((b, i) => { const x = x0 + i * (w + ARA);
      kutu(ctx, x, y + 4, w, 134, 10, "#f8fafc", CIZGI); ctx.save(); ctx.beginPath(); ctx.roundRect(x, y + 4, w, 26, [10, 10, 0, 0]); ctx.clip(); ctx.fillStyle = LAC; ctx.fillRect(x, y + 4, w, 26); ctx.restore();
      yaz(ctx, `${b.ad.toLocaleUpperCase("tr-TR")} BÖLGE YÖNETİMİ`, x + w / 2, y + 10, { boy: 12, kalin: true, renk: "#fff", hiza: "center" });
      kutu(ctx, x + w / 2 - 130, y + 38, 260, 40, 8, LAC); yaz(ctx, b.mudur.ad, x + w / 2, y + 43, { boy: 13, kalin: true, renk: "#fff", hiza: "center" }); yaz(ctx, b.mudur.gorev, x + w / 2, y + 60, { boy: 10.5, renk: "#cbd5e1", hiza: "center" });
      ctx.fillStyle = "#94a3b8"; ctx.fillRect(x + w / 2 - 1, y + 78, 2, 10);
      kutu(ctx, x + w / 2 - 130, y + 88, 260, 40, 8, "#fff", "#cbd5e1"); yaz(ctx, b.supervizor.ad, x + w / 2, y + 93, { boy: 13, kalin: true, hiza: "center" }); yaz(ctx, b.supervizor.gorev, x + w / 2, y + 110, { boy: 10.5, renk: GRI, hiza: "center" }); });
  } });
  if (!v.tarihsel.uretilebildi) bloklar.push({ h: 70, ciz: (ctx, y) => { kutu(ctx, KENAR, y + 8, icGen, 50, 10, "#fffbeb", "#fde68a"); yaz(ctx, v.tarihsel.aciklama, KENAR + 16, y + 25, { boy: 13.5, kalin: true, renk: "#92400e" }); } });
  // Bölümler: kartlar 4 sütun, satır yüksekliği o satırın en yüksek kartı
  const kartYuk = (e) => { const ic = kartGen - 24; let h = 12 + satirlar(olc, e.ad, ic - 96, { boy: 15, kalin: true }).length * 19 + 12;
    h += 8 + (e.firma ? 19 : 0) + 19 * 3 + 12 + 18 + Math.max(1, e.uyeler.length) * 18 + 10 + 20; return h; };
  const kartCiz = (ctx, e, x, y, h) => {
    const ic = kartGen - 24, adS = satirlar(ctx, e.ad, ic - 96, { boy: 15, kalin: true }), bas = 12 + adS.length * 19 + 12;
    kutu(ctx, x, y, kartGen, h, 10, "#fff", "#cbd5e1");
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, kartGen, bas, [10, 10, 0, 0]); ctx.clip(); ctx.fillStyle = LAC; ctx.fillRect(x, y, kartGen, bas); ctx.restore();
    adS.forEach((s, i) => yaz(ctx, s, x + 12, y + 11 + i * 19, { boy: 15, kalin: true, renk: "#fff" }));
    const tk = ORG_TUR[e.tur]?.kisa || "TÜR SEÇİLMEDİ"; ctx.font = "bold 10px Arial"; const tw = ctx.measureText(tk).width + 16;
    kutu(ctx, x + kartGen - tw - 10, y + 11, tw, 18, 9, e.tur === "DIS" ? "#fef3c7" : "#e0f2fe"); yaz(ctx, tk, x + kartGen - 10 - tw / 2, y + 15, { boy: 10, kalin: true, renk: e.tur === "DIS" ? "#78350f" : "#0c4a6e", hiza: "center" });
    let yy = y + bas + 8;
    const sat = (et, deger, soluk) => { yaz(ctx, et, x + 12, yy, { boy: 12, renk: GRI }); yaz(ctx, satirlar(ctx, deger, ic - 80, { boy: 12.5, kalin: !soluk })[0], x + 92, yy, { boy: 12.5, kalin: !soluk, renk: soluk ? "#94a3b8" : "#0f172a" }); yy += 19; };
    if (e.firma) sat("Firma", e.firma);
    sat("Bölge", e.bolge || "Atanmadı", !e.bolge);
    sat("Ekip şefi", e.sef_durum === "KAYIT_YOK" ? "Kayıt yok" : e.sef || "Atanmadı", !e.sef);
    sat("Araç", orgAracMetni(e.arac_durum, e.araclar.map((a) => a.plaka)), !e.araclar.length);
    ctx.strokeStyle = CIZGI; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x + 12, yy + 4); ctx.lineTo(x + kartGen - 12, yy + 4); ctx.stroke(); ctx.setLineDash([]); yy += 12;
    yaz(ctx, `PERSONEL · ${e.uyeler.length}`, x + 12, yy, { boy: 10.5, kalin: true, renk: GRI }); yy += 18;
    if (!e.uyeler.length) { yaz(ctx, "Atanmadı", x + 12, yy, { boy: 12.5, renk: "#94a3b8" }); yy += 18; }
    for (const p of e.uyeler) { const g = p.sef ? "Ekip şefi" : p.gorev || "—"; ctx.font = "11.5px Arial"; const gw = Math.min(ctx.measureText(g).width, ic * 0.45);
      yaz(ctx, satirlar(ctx, p.ad, ic - gw - 10, { boy: 12.5, kalin: p.sef })[0], x + 12, yy, { boy: 12.5, kalin: p.sef }); yaz(ctx, satirlar(ctx, g, ic * 0.45, { boy: 11.5 })[0], x + kartGen - 12, yy + 1, { boy: 11.5, renk: GRI, hiza: "right" }); yy += 18; }
    yaz(ctx, e.teyit ? `Son teyit: ${zamanTR(e.teyit)}` : "Teyit edilmedi", x + 12, y + h - 20, { boy: 10.5, kalin: true, renk: e.teyit ? "#166534" : "#94a3b8" });
  };
  v.bolumler.forEach((b, bi) => {
    bloklar.push({ h: 46, baslik: true, ciz: (ctx, y) => { yaz(ctx, `${String.fromCharCode(65 + bi)}. ${b.baslik}`, KENAR, y + 14, { boy: 17, kalin: true, renk: LAC }); yaz(ctx, `${b.ekipler.length} ekip`, GEN - KENAR, y + 18, { boy: 12.5, kalin: true, renk: GRI, hiza: "right" });
      ctx.fillStyle = LAC; ctx.fillRect(KENAR, y + 40, icGen, 2); } });
    for (let i = 0; i < b.ekipler.length; i += SUTUN) { const sira = b.ekipler.slice(i, i + SUTUN), h = Math.max(...sira.map(kartYuk));
      bloklar.push({ h: h + ARA, ciz: (ctx, y) => sira.forEach((e, k) => kartCiz(ctx, e, KENAR + k * (kartGen + ARA), y + 8, h)) }); }
  });
  const notlar = ciktiNot(v);
  bloklar.push({ h: 20 + notlar.length * 17, ciz: (ctx, y) => notlar.forEach((n, i) => yaz(ctx, `• ${n}`, KENAR, y + 10 + i * 17, { boy: 11.5, renk: GRI })) });
  return bloklar;
}
function sayfaCiz(bloklar, yuk, altYazi) {
  const c = document.createElement("canvas"); c.width = GEN * S; c.height = Math.ceil(yuk) * S;
  const ctx = c.getContext("2d"); ctx.scale(S, S); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, GEN, yuk);
  let y = 0; for (const b of bloklar) { b.ciz(ctx, y); y += b.h; }
  if (altYazi) yaz(ctx, altYazi, GEN / 2, yuk - 24, { boy: 10.5, renk: "#94a3b8", hiza: "center" });
  return c;
}
const ALT = (v) => `${v.kurum.ad} · Sistem kayıtlarından ${zamanTR(v.uretim)} tarihinde üretilmiştir.`;
export function orgCiktiPng(v, yonetim) {
  const b = ciktiBloklari(v, yonetim), yuk = b.reduce((s, x) => s + x.h, 0) + 40;
  return new Promise((res) => sayfaCiz(b, yuk, ALT(v)).toBlob(res, "image/png"));
}
// PDF: A4 yatay; her sayfa bir JPEG görüntüsü (ek kitaplık gerekmez). Bölüm başlığı sayfa sonunda yalnız kalmaz.
export async function orgCiktiPdf(v, yonetim) {
  const b = ciktiBloklari(v, yonetim), SAYFA = Math.round(GEN * 210 / 297), kullan = SAYFA - 40;
  const sayfalar = [[]]; let y = 0;
  b.forEach((blok, i) => { const sonraki = b[i + 1]; const gerek = blok.h + (blok.baslik && sonraki ? sonraki.h : 0);
    if (y > 0 && y + Math.min(gerek, kullan) > kullan) { sayfalar.push([]); y = 0; } sayfalar[sayfalar.length - 1].push(blok); y += blok.h; });
  const jpgler = [];
  for (let i = 0; i < sayfalar.length; i++) { const c = sayfaCiz(sayfalar[i], Math.max(SAYFA, sayfalar[i].reduce((s, x) => s + x.h, 0) + 40), `${ALT(v)}  ·  Sayfa ${i + 1} / ${sayfalar.length}`);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92)); jpgler.push({ veri: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height }); }
  const enc = new TextEncoder(), parca = [], konum = []; let boy = 0;
  const ekle = (x) => { const u = typeof x === "string" ? enc.encode(x) : x; parca.push(u); boy += u.length; };
  const nesne = (n, govde, akis) => { konum[n] = boy; ekle(`${n} 0 obj\n${govde}\n`); if (akis) { ekle("stream\n"); ekle(akis); ekle("\nendstream\n"); } ekle("endobj\n"); };
  const PW = 841.89, PH = 595.28, N = jpgler.length;
  ekle("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  nesne(1, "<< /Type /Catalog /Pages 2 0 R >>");
  nesne(2, `<< /Type /Pages /Count ${N} /Kids [${jpgler.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>`);
  jpgler.forEach((j, i) => { const p = 3 + i * 3, ph = PW * j.h / j.w; // sayfa yüksekliği görüntü oranına göre (uzun sayfa kırpılmaz)
    const icerik = `q ${PW.toFixed(2)} 0 0 ${ph.toFixed(2)} 0 0 cm /Im0 Do Q`;
    nesne(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW.toFixed(2)} ${Math.max(PH, ph).toFixed(2)}] /Resources << /XObject << /Im0 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`);
    nesne(p + 1, `<< /Length ${icerik.length} >>`, icerik);
    nesne(p + 2, `<< /Type /XObject /Subtype /Image /Width ${j.w} /Height ${j.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${j.veri.length} >>`, j.veri); });
  const son = 3 + N * 3, xref = boy;
  ekle(`xref\n0 ${son}\n0000000000 65535 f \n` + Array.from({ length: son - 1 }, (_, i) => `${String(konum[i + 1]).padStart(10, "0")} 00000 n \n`).join(""));
  ekle(`trailer\n<< /Size ${son} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parca, { type: "application/pdf" });
}
// Excel: "Organizasyon" (özet + yönetim + ekipler) ve "Personel" (ekip bazında kişi listesi). Kılavuz çizgileri kapalı.
export async function orgCiktiExcel(v, yonetim) {
  const K = (c) => ({ style: "thin", color: { rgb: c } }), cer = (c = "CBD5E1") => ({ top: K(c), bottom: K(c), left: K(c), right: K(c) });
  const st = { baslik: { font: { bold: true, sz: 16, color: { rgb: "FFFFFF" }, name: "Arial" }, fill: { patternType: "solid", fgColor: { rgb: "1E3A5F" } }, alignment: { vertical: "center" } },
    alt: { font: { sz: 10, color: { rgb: "475569" }, name: "Arial" }, alignment: { wrapText: true, vertical: "center" } },
    bolum: { font: { bold: true, sz: 12, color: { rgb: "1E3A5F" }, name: "Arial" }, fill: { patternType: "solid", fgColor: { rgb: "E2E8F0" } }, alignment: { vertical: "center" } },
    th: { font: { bold: true, sz: 10, color: { rgb: "FFFFFF" }, name: "Arial" }, fill: { patternType: "solid", fgColor: { rgb: "334155" } }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border: cer("334155") },
    td: { font: { sz: 10, name: "Arial" }, alignment: { vertical: "center", wrapText: true }, border: cer() } };
  const sayfa = (satirListe, genislik, birlesim) => { const ws = XLSXStyle.utils.aoa_to_sheet(satirListe.map((r) => r.map((h) => h.v)));
    satirListe.forEach((r, ri) => r.forEach((h, ci) => { const a = XLSXStyle.utils.encode_cell({ r: ri, c: ci }); if (!ws[a]) ws[a] = { t: "s", v: "" }; if (h.s) ws[a].s = h.s; }));
    ws["!cols"] = genislik.map((w) => ({ wch: w })); ws["!merges"] = birlesim; ws["!rows"] = satirListe.map((r) => (r._h ? { hpt: r._h } : undefined)); return ws; };
  const N = 9, bos = (s) => Array.from({ length: N }, () => ({ v: "", s })), tam = (metin, s, h) => { const r = bos(s); r[0] = { v: metin, s }; r._h = h; return r; };
  const r1 = [], m1 = []; const birles = () => m1.push({ s: { r: r1.length - 1, c: 0 }, e: { r: r1.length - 1, c: N - 1 } });
  r1.push(tam(`${v.kurum.ad} — Saha Organizasyon Şeması`, st.baslik, 30)); birles();
  r1.push(tam(ciktiAlt(v), st.alt, 18)); birles();
  r1.push(tam(`Ekip: ${v.sayilar.ekip} (iç ekip ${v.sayilar.ic_ekip}, taşeron ekibi ${v.sayilar.taseron_ekip}) · Personel: ${v.sayilar.personel} · Araç: ${v.arac_veri === "VERI_YOK" ? "veri alınamadı" : v.sayilar.arac}`, st.alt, 18)); birles();
  for (const n of ciktiNot(v)) { r1.push(tam(`• ${n}`, st.alt, 16)); birles(); }
  r1.push(bos());
  const yon = [...(yonetim?.ust || []).map((k) => ["Proje yönetimi", k.gorev, k.ad]), ...(yonetim?.destek || []).map((k) => ["Proje destek", k.gorev, k.ad]),
    ...(yonetim?.bolgeler || []).flatMap((b) => [[`${b.ad} bölge yönetimi`, b.mudur.gorev, b.mudur.ad], [`${b.ad} bölge yönetimi`, b.supervizor.gorev, b.supervizor.ad]])];
  if (yon.length) { r1.push(tam("Yönetim", st.bolum, 22)); birles();
    r1.push(["Birim", "Görev", "Ad Soyad"].map((x) => ({ v: x, s: st.th })).concat(bos().slice(3)));
    for (const y of yon) r1.push(y.map((x) => ({ v: x, s: st.td })).concat(bos().slice(3)));
    r1.push(bos()); }
  const B = ["Ekip", "Tür", "Firma", "Bölge", "Ekip Şefi", "Personel Sayısı", "Araç", "Durum", "Son Teyit"];
  v.bolumler.forEach((b, bi) => { r1.push(tam(`${String.fromCharCode(65 + bi)}. ${b.baslik} — ${b.ekipler.length} ekip`, st.bolum, 22)); birles();
    r1.push(B.map((x) => ({ v: x, s: st.th })));
    for (const e of b.ekipler) r1.push([e.ad, turAd(e.tur), e.firma || (e.tur === "DIS" ? e.ad : "—"), e.bolge || "Atanmadı", e.sef_durum === "KAYIT_YOK" ? "Kayıt yok" : e.sef || "Atanmadı", e.uyeler.length,
      orgAracMetni(e.arac_durum, e.araclar.map((a) => a.plaka)), e.aktif ? "Aktif" : "Pasif", e.teyit ? zamanTR(e.teyit) : "Teyit edilmedi"].map((x) => ({ v: x, s: st.td })));
    r1.push(bos()); });
  if (!v.tarihsel.uretilebildi) { r1.push(tam(v.tarihsel.aciklama, st.alt, 30)); birles(); }
  const r2 = [["Ekip", "Tür", "Bölge", "Ad Soyad", "Görev"].map((x) => ({ v: x, s: st.th }))];
  for (const b of v.bolumler) for (const e of b.ekipler) { if (!e.uyeler.length) r2.push([e.ad, turAd(e.tur), e.bolge || "Atanmadı", "Atanmadı", "—"].map((x) => ({ v: x, s: st.td })));
    for (const p of e.uyeler) r2.push([e.ad, turAd(e.tur), e.bolge || "Atanmadı", p.ad, p.sef ? "Ekip şefi" : p.gorev || "—"].map((x) => ({ v: x, s: st.td }))); }
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, sayfa(r1, [28, 15, 26, 14, 28, 11, 30, 10, 20], m1), "Organizasyon");
  XLSXStyle.utils.book_append_sheet(wb, sayfa(r2, [28, 15, 14, 34, 28], []), "Personel");
  const zip = await JSZip.loadAsync(XLSXStyle.write(wb, { type: "array", bookType: "xlsx" }));
  const isler = [];
  zip.folder("xl/worksheets").forEach((ad, f) => { if (/^sheet\d+\.xml$/.test(ad)) isler.push(f.async("string").then((xml) => zip.file(`xl/worksheets/${ad}`, xml.replace(/<sheetView /g, '<sheetView showGridLines="0" ')))); });
  await Promise.all(isler);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// İndirme penceresi: kapsam / bölge / tarih seç → aynı veri görüntüsünden PDF, PNG, Excel
export function OrgIndirModal({ yonetimOf, onClose }) {
  const [f, setF] = useState({ operasyon: "", bolge: "", tarih: bugunTR() });
  const [v, setV] = useState(null), [hata, setHata] = useState(""), [bekle, setBekle] = useState("");
  useEffect(() => {
    let iptal = false; setHata("");
    orgIstek2("GET", `/org/cikti?operasyon=${encodeURIComponent(f.operasyon)}&bolge=${encodeURIComponent(f.bolge)}&tarih=${f.tarih}`).then((r) => { if (iptal) return; if (r.ok) setV(r.j); else { setV(null); setHata(r.j.error || "Çıktı verisi alınamadı"); } });
    return () => { iptal = true; };
  }, [f.operasyon, f.bolge, f.tarih]);
  const yonetim = useMemo(() => (v ? yonetimOf(v) : null), [v, yonetimOf]);
  const al = async (tur) => {
    if (!v) return; setBekle(tur); setHata("");
    try { const blob = tur === "pdf" ? await orgCiktiPdf(v, yonetim) : tur === "png" ? await orgCiktiPng(v, yonetim) : await orgCiktiExcel(v, yonetim); indir(blob, dosyaAdi(v, tur === "excel" ? "xlsx" : tur)); }
    catch (e) { setHata(`Dosya üretilemedi: ${e.message}`); }
    setBekle("");
  };
  const bos = v && !v.bolumler.length;
  return (
    <Modal baslik="⬇ Güncel Organizasyonu İndir" alt="PDF, PNG ve Excel aynı veri görüntüsünden üretilir. Çıktıda maaş, maliyet, hakediş, kimlik, telefon ve iç not bulunmaz." onClose={onClose} genislik={680}
      altBar={<><button style={btn("ikincil")} onClick={onClose}>Kapat</button>
        <button style={btn("ana", { opacity: !v || bos || bekle ? 0.5 : 1 })} disabled={!v || bos || !!bekle} onClick={() => al("pdf")}>{bekle === "pdf" ? "Hazırlanıyor…" : "PDF indir"}</button>
        <button style={btn("ana", { opacity: !v || bos || bekle ? 0.5 : 1 })} disabled={!v || bos || !!bekle} onClick={() => al("png")}>{bekle === "png" ? "Hazırlanıyor…" : "PNG indir"}</button>
        <button style={btn("yesil", { opacity: !v || bos || bekle ? 0.5 : 1 })} disabled={!v || bos || !!bekle} onClick={() => al("excel")}>{bekle === "excel" ? "Hazırlanıyor…" : "Excel indir"}</button></>}>
      <Hata m={hata} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 170px", gap: "10px" }}>
        <Alan etiket="Kapsam">
          <select value={f.operasyon} onChange={(e) => setF({ ...f, operasyon: e.target.value })} style={INP} disabled={!v?.secenekler?.operasyonlar?.length}>
            {v?.secenekler?.operasyonlar?.length ? <option value="">Tüm organizasyon</option> : <option value="">{v?.kapsam?.operasyon_ad || "…"}</option>}
            {(v?.secenekler?.operasyonlar || []).map((o) => <option key={o.kod} value={o.kod}>{o.ad} operasyonu</option>)}
          </select>
        </Alan>
        <Alan etiket="Bölge"><select value={f.bolge} onChange={(e) => setF({ ...f, bolge: e.target.value })} style={INP}><option value="">Tüm bölgeler</option>{(v?.secenekler?.bolgeler || []).map((b) => <option key={b} value={b}>{b}</option>)}</select></Alan>
        <Alan etiket="Organizasyon tarihi"><input type="date" value={f.tarih} max={bugunTR()} onChange={(e) => setF({ ...f, tarih: e.target.value || bugunTR() })} style={INP} /></Alan>
      </div>
      {v && (
        <div style={{ border: `1px solid ${CIZGI}`, borderRadius: "11px", overflow: "hidden" }}>
          <div style={{ background: LAC, color: "#fff", padding: "10px 14px" }}>
            <div style={{ fontWeight: 800, fontSize: "15px" }}>{v.kurum.ad} — Saha Organizasyon Şeması</div>
            <div style={{ fontSize: "11.5px", opacity: 0.85, marginTop: "2px" }}>{ciktiAlt(v)}</div>
          </div>
          <div style={{ padding: "10px 14px", fontSize: "12.5px", color: "#0f172a" }}>
            {bos ? <b style={{ color: "#92400e" }}>{v.tarihsel.aciklama || "Bu kapsamda aktif ekip yok."}</b> : (
              <>
                <div><b>{v.sayilar.ekip}</b> ekip ({v.sayilar.ic_ekip} iç ekip, {v.sayilar.taseron_ekip} taşeron ekibi) · <b>{v.sayilar.personel}</b> personel · <b>{v.arac_veri === "VERI_YOK" ? "araç verisi alınamadı" : `${v.sayilar.arac} araç`}</b></div>
                {v.bolumler.map((b, i) => <div key={b.kod} style={{ color: GRI, marginTop: "3px" }}>{String.fromCharCode(65 + i)}. {b.baslik}: {b.ekipler.map((e) => e.ad).join(", ")}</div>)}
              </>
            )}
            {ciktiNot(v).map((n) => <div key={n} style={{ color: "#92400e", marginTop: "4px" }}>• {n}</div>)}
          </div>
        </div>
      )}
    </Modal>
  );
}
