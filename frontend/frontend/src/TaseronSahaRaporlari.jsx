// TAŞERON SAHA RAPORLARI — web, Teknocenter tarafı (04.11.2026, Orhan)
//   TaseronSahaRaporlari  : tek iş kodunun raporları (Rollout haritası → Saha Bilgileri iş kutusu)
//   TaseronSahaRaporModal : son raporlar — iş kodu / firma / PR durumu süzgeci (Rollout araç çubuğu)
// Kaynak /taseron-saha/teknocenter/* (yetki + Teknocenter kapsamı sunucuda). Rapor PR DEĞİLDİR: PR kalemleri Günlük İş / PR
// akışında elle hazırlanır; burada yalnız "incelendi / PR hazırlanıyor / PR hazırlandı (no)" işaretlenir. Aynı rapordan ikinci PR
// sunucuda reddedilir; aynı iş kodunun başka raporundan PR açılmışsa açık onay istenir. Her değişiklik sürüm geçmişine yazılır.
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const LAC = "#1e3a5f";
const tokenAl = () => localStorage.getItem("token") || localStorage.getItem("finance_token") || "";
const zamanTR = (v) => (v ? new Date(v).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
async function tsGet(yol) {
  const r = await fetch(API_BASE + yol, { headers: { Authorization: `Bearer ${tokenAl()}` } });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw Object.assign(new Error(j?.error || `Sunucu hatası (${r.status})`), { durum: r.status });
  return j;
}
async function tsPost(yol, govde) {
  const r = await fetch(API_BASE + yol, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAl()}` }, body: JSON.stringify(govde || {}) });
  const j = await r.json().catch(() => null);
  return { s: r.status, j };
}
const anahtar = () => `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const PR_RENK = { BEKLIYOR: ["#f1f5f9", "#334155"], INCELENDI: ["#e0f2fe", "#075985"], PR_HAZIRLANIYOR: ["#fef9c3", "#713f12"], PR_HAZIRLANDI: ["#dcfce7", "#14532d"] };
const TUR_RENK = { TAMAMLANDI: ["#dcfce7", "#14532d"], KISMI: ["#fef3c7", "#92400e"], BASLADI: ["#dbeafe", "#1e40af"] };
const rozet = ([bg, fg], metin) => <span style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 9px", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap" }}>{metin}</span>;

// Fotoğraf: yetkili istekle alınır (adres paylaşılmaz), küçük resim + tıklayınca büyük
function Foto({ raporId, f }) {
  const [url, setUrl] = useState(null);
  const [buyuk, setBuyuk] = useState(false);
  useEffect(() => {
    let iptal = false, u = null;
    fetch(`${API_BASE}/taseron-saha/bildirim/${raporId}/foto/${f.id}`, { headers: { Authorization: `Bearer ${tokenAl()}` } })
      .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b && !iptal) { u = URL.createObjectURL(b); setUrl(u); } }).catch(() => {});
    return () => { iptal = true; if (u) URL.revokeObjectURL(u); };
  }, [raporId, f.id]);
  return <>
    <button type="button" onClick={() => url && setBuyuk(true)} title={f.ad} style={{ width: 64, height: 64, padding: 0, border: "1px solid #cbd5e1", borderRadius: 8, overflow: "hidden", background: "#f1f5f9", cursor: url ? "zoom-in" : "default" }}>
      {url ? <img src={url} alt={f.ad} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 11, color: "#64748b" }}>…</span>}
    </button>
    {buyuk && createPortal(<div onClick={() => setBuyuk(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.85)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}>
      <img src={url} alt={f.ad} style={{ maxWidth: "94vw", maxHeight: "92vh", borderRadius: 8 }} /></div>, document.body)}
  </>;
}

function RaporSatiri({ r, onYenile, isKoduGoster }) {
  const [acik, setAcik] = useState(false);
  const [ref, setRef] = useState(r.pr_ref || "");
  const [not, setNot] = useState("");
  const [bekle, setBekle] = useState(false);
  const [mesaj, setMesaj] = useState(null);
  const [gecmis, setGecmis] = useState(null);
  const incele = async (pr_durum, ayni_saha_onay = false) => {
    if (bekle) return;
    if (pr_durum === "PR_HAZIRLANDI" && !ref.trim()) { setMesaj({ hata: true, metin: "PR / talep numarasını yazın" }); return; }
    setBekle(true); setMesaj(null);
    const { s, j } = await tsPost(`/taseron-saha/teknocenter/bildirim/${r.id}/inceleme`, { pr_durum, pr_ref: ref.trim() || null, not: not.trim() || null, ayni_saha_onay, istek_anahtari: anahtar() })
      .catch(() => ({ s: 0, j: null }));
    setBekle(false);
    if (s === 409 && j?.kod === "ayni_saha_pr") {
      if (window.confirm(`${j.error}\n\nBu rapordan da PR hazırlandı olarak işaretlensin mi?`)) return incele(pr_durum, true);
      return;
    }
    if (!j?.ok) { setMesaj({ hata: true, metin: j?.error || (s ? `Kaydedilemedi (${s})` : "Bağlantı yok — kaydedilmedi") }); return; }
    setMesaj({ metin: j.mesaj || "Kaydedildi" }); setNot("");
    onYenile?.();
  };
  const gecmisAc = async () => { try { setGecmis(await tsGet(`/taseron-saha/teknocenter/bildirim/${r.id}/gecmis`)); } catch (e) { setGecmis({ hata: e.message }); } };
  return <div style={{ borderTop: "1px solid #e2e8f0", padding: "8px 0", fontSize: 14 }}>
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {isKoduGoster && <code style={{ fontWeight: 900, fontSize: 14.5 }}>{r.site_code}</code>}
      {rozet(TUR_RENK[r.tur] || TUR_RENK.BASLADI, `${r.tur_ad}${r.standart ? " · standart tam" : ""}`)}
      {r.tur !== "BASLADI" && rozet(PR_RENK[r.pr_durum] || PR_RENK.BEKLIYOR, `${r.pr_durum_ad}${r.pr_ref ? ` · ${r.pr_ref}` : ""}`)}
      {r.ayni_saha_pr && r.pr_durum !== "PR_HAZIRLANDI" && rozet(["#fee2e2", "#991b1b"], `Bu iş kodunda PR var: ${r.ayni_saha_pr}`)}
    </div>
    <div style={{ color: "#475569", fontSize: 13, marginTop: 2 }}>
      <b>{r.firma?.ad || "—"}</b>{r.ekip ? ` · ${r.ekip.ad}` : " · ekip yok"} · {r.bildiren || r.bildiren_email} · {zamanTR(r.zaman)}{r.surum > 1 ? ` · ${r.surum}. sürüm` : ""}
    </div>
    {r.aciklama && <div style={{ marginTop: 3 }}>{r.aciklama}</div>}
    {r.kalan_is && <div style={{ marginTop: 2 }}><b>Kalan iş:</b> {r.kalan_is}</div>}
    {r.sorun && <div style={{ marginTop: 2, color: "#9a3412" }}><b>Ekip bildirimi (sorun):</b> {r.sorun}</div>}
    {r.fotolar?.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>{r.fotolar.map((f) => <Foto key={f.id} raporId={r.id} f={f} />)}</div>}
    {r.inceleme_notu && <div style={{ marginTop: 4, color: "#075985" }}><b>Teknocenter notu:</b> {r.inceleme_notu} <span style={{ color: "#64748b" }}>({r.inceleyen}, {zamanTR(r.inceleme_zamani)})</span></div>}
    {r.tur !== "BASLADI" && <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" onClick={() => setAcik((x) => !x)} style={btn(false)}>{acik ? "Kapat" : "İncele / PR durumu"}</button>
      <button type="button" onClick={gecmisAc} style={btn(false)}>Sürüm geçmişi</button>
    </div>}
    {acik && <div style={{ marginTop: 8, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 10 }}>
      <div style={{ fontSize: 12.5, color: "#475569", marginBottom: 6 }}>Bu rapor PR değildir. PR kalemlerini Günlük İş / PR ekranında hazırlayın; burada yalnız durumu ve PR numarasını işaretleyin.</div>
      <textarea value={not} onChange={(e) => setNot(e.target.value)} placeholder="Taşerona not (isteğe bağlı) — ekip raporunda görünür" rows={2}
        style={{ width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: 6, padding: 6, fontSize: 14 }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
        <button type="button" disabled={bekle || r.pr_durum === "PR_HAZIRLANDI"} onClick={() => incele("INCELENDI")} style={btn(false)}>İncelendi</button>
        <button type="button" disabled={bekle || r.pr_durum === "PR_HAZIRLANDI"} onClick={() => incele("PR_HAZIRLANIYOR")} style={btn(false)}>PR hazırlanıyor</button>
        <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="PR / talep no" disabled={r.pr_durum === "PR_HAZIRLANDI"}
          style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "6px 8px", fontSize: 14, width: 150 }} />
        <button type="button" disabled={bekle || r.pr_durum === "PR_HAZIRLANDI"} onClick={() => incele("PR_HAZIRLANDI")} style={btn(true)}>PR hazırlandı</button>
        {bekle && <span style={{ color: "#64748b" }}>Kaydediliyor…</span>}
      </div>
      {r.pr_durum === "PR_HAZIRLANDI" && <div style={{ marginTop: 6, color: "#14532d", fontSize: 13 }}>Bu rapordan PR hazırlandı ({r.pr_ref}); ikinci PR açılmaz.</div>}
      {mesaj && <div role="status" style={{ marginTop: 6, color: mesaj.hata ? "#b91c1c" : "#14532d", fontWeight: 700 }}>{mesaj.metin}</div>}
    </div>}
    {gecmis && <div style={{ marginTop: 6, fontSize: 13, background: "#f8fafc", borderRadius: 8, padding: 8 }}>
      {gecmis.hata ? <span style={{ color: "#b91c1c" }}>{gecmis.hata}</span> : !gecmis.surumler?.length ? "Değişiklik yok (1. sürüm)." :
        gecmis.surumler.map((s) => <div key={s.surum} style={{ borderTop: "1px dashed #e2e8f0", padding: "3px 0" }}>
          <b>{s.surum}. sürüm</b> · {s.degistiren} · {zamanTR(s.zaman)} — {[s.eski?.aciklama && `açıklama: ${s.eski.aciklama}`, s.eski?.kalan_is && `kalan: ${s.eski.kalan_is}`,
            s.eski?.sorun && `sorun: ${s.eski.sorun}`, `PR: ${s.eski?.pr_durum || "—"}${s.eski?.pr_ref ? ` (${s.eski.pr_ref})` : ""}`].filter(Boolean).join(" · ")}</div>)}
      <button type="button" onClick={() => setGecmis(null)} style={{ ...btn(false), marginTop: 4 }}>Gizle</button>
    </div>}
  </div>;
}
const btn = (birincil) => ({ background: birincil ? LAC : "#fff", color: birincil ? "#fff" : LAC, border: `1.5px solid ${LAC}`, borderRadius: 7, padding: "5px 11px", fontWeight: 700, fontSize: 13, cursor: "pointer" });

// Tek iş kodu: rapor yoksa hiçbir şey çizmez; yetki yoksa (403) sessizce gizlenir
export function TaseronSahaRaporlari({ kod }) {
  const [d, setD] = useState(null);
  const [n, setN] = useState(0);
  useEffect(() => { let iptal = false;
    tsGet(`/taseron-saha/teknocenter/bildirimler?kod=${encodeURIComponent(kod)}&yalniz_rapor=0`).then((j) => { if (!iptal) setD(j); }).catch((e) => { if (!iptal) setD(e.durum === 403 ? null : { hata: e.message }); });
    return () => { iptal = true; }; }, [kod, n]);
  const rows = (d?.rows || []).filter((r) => r.site_code === kod);
  if (!d || (!d.hata && !rows.length)) return null;
  return <div style={{ marginTop: 8 }}>
    <div style={{ fontWeight: 700, fontSize: 14.5 }}>Taşeron saha raporları ({rows.length})</div>
    {d.hata ? <div style={{ color: "#b91c1c" }}>{d.hata}</div> : rows.map((r) => <RaporSatiri key={r.id} r={r} onYenile={() => setN((x) => x + 1)} />)}
  </div>;
}

export function TaseronSahaRaporModal({ onClose }) {
  const [kod, setKod] = useState("");
  const [prDurum, setPrDurum] = useState("");
  const [gun, setGun] = useState(30);
  const [d, setD] = useState(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let iptal = false; setD((x) => (x ? { ...x, yukleniyor: true } : { yukleniyor: true }));
    const q = new URLSearchParams({ gun: String(gun), ...(kod.trim() ? { kod: kod.trim() } : {}), ...(prDurum ? { pr_durum: prDurum } : {}) });
    const t = setTimeout(() => tsGet(`/taseron-saha/teknocenter/bildirimler?${q}`).then((j) => { if (!iptal) setD(j); }).catch((e) => { if (!iptal) setD({ hata: e.message }); }), 300);
    return () => { iptal = true; clearTimeout(t); };
  }, [kod, prDurum, gun, n]);
  const rows = d?.rows || [];
  return createPortal(<div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 1300, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
    <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Taşeron saha raporları"
      style={{ background: "#fff", borderRadius: 14, width: "min(980px, 100%)", maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden", textAlign: "left" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid #e2e8f0", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 900, fontSize: 18, color: LAC }}>Taşeron saha raporları</div>
          <div style={{ fontSize: 12.5, color: "#64748b" }}>Montaj tamamlama / kısmi iş bildirimleri · PR hazırlığına kaynak, PR değildir</div>
        </div>
        <input value={kod} onChange={(e) => setKod(e.target.value)} placeholder="İş kodu / Site ID" style={{ border: "1px solid #cbd5e1", borderRadius: 7, padding: "7px 9px", fontSize: 14, width: 170 }} />
        <select value={prDurum} onChange={(e) => setPrDurum(e.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 7, padding: "7px 9px", fontSize: 14 }}>
          <option value="">Tüm durumlar</option><option value="BEKLIYOR">İnceleme bekliyor</option><option value="INCELENDI">İncelendi</option>
          <option value="PR_HAZIRLANIYOR">PR hazırlanıyor</option><option value="PR_HAZIRLANDI">PR hazırlandı</option>
        </select>
        <select value={gun} onChange={(e) => setGun(Number(e.target.value))} disabled={!!kod.trim()} style={{ border: "1px solid #cbd5e1", borderRadius: 7, padding: "7px 9px", fontSize: 14 }}>
          {[7, 30, 90, 365].map((g) => <option key={g} value={g}>Son {g} gün</option>)}
        </select>
        <button type="button" onClick={onClose} aria-label="Kapat" style={{ ...btn(false), fontSize: 16 }}>✕</button>
      </div>
      <div style={{ overflowY: "auto", padding: "4px 16px 16px" }}>
        {d?.hata && <div style={{ color: "#b91c1c", fontWeight: 700, padding: 10 }}>{d.hata}</div>}
        {d?.yukleniyor && !rows.length && <div style={{ padding: 10, color: "#64748b" }}>Yükleniyor…</div>}
        {d && !d.yukleniyor && !d.hata && !rows.length && <div style={{ padding: 10, color: "#64748b" }}>Bu süzgece uyan rapor yok.</div>}
        {rows.map((r) => <RaporSatiri key={r.id} r={r} isKoduGoster onYenile={() => setN((x) => x + 1)} />)}
      </div>
    </div>
  </div>, document.body);
}
