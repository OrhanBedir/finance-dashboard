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

// ── TAŞERON HESAPLARI (04.11.2026): firma → ekipler + hesaplar; rol / ekip / saha erişimi; yeni hesap; şifre sıfırlama ──
// Yetki sunucuda (/taseron-saha/yonetim/*): İş Ata yetkilisi + firma kapsamı; hesap açma / şifre yalnız kullanıcı yöneticisi ya da
// Teknocenter yöneticisi. Şifre sunucuda saklanmaz; açan kişi ekranda görür ve taşerona kendisi iletir.
const ROL_AD = { SORUMLU: "Firma sorumlusu — tüm ekipler", CALISAN: "Çalışan — yalnız kendi ekibi" };
const sifreUret = () => { const h = "abcdefghjkmnpqrstuvwxyz", r = "23456789"; const a = (s) => s[Math.floor(Math.random() * s.length)];
  return `${a(h).toUpperCase()}${Array.from({ length: 5 }, () => a(h)).join("")}${a(r)}${a(r)}${a(r)}`; };
async function tsIstek(yol, method, govde) {
  const r = await fetch(API_BASE + yol, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAl()}` }, body: JSON.stringify(govde || {}) });
  const j = await r.json().catch(() => null);
  return { s: r.status, j };
}
const girdi = { border: "1px solid #cbd5e1", borderRadius: 7, padding: "7px 9px", fontSize: 14, boxSizing: "border-box" };

function HesapSatiri({ h, ekipler, hesapAcabilir, onYenile }) {
  const [rol, setRol] = useState(h.rol || "SORUMLU");
  const [ekip, setEkip] = useState(h.ekip_no ?? "");
  const [saha, setSaha] = useState(h.aktif !== false);
  const [bekle, setBekle] = useState(false);
  const [mesaj, setMesaj] = useState(null);
  const [yeniSifre, setYeniSifre] = useState(null);
  const degisti = rol !== (h.rol || "SORUMLU") || String(ekip) !== String(h.ekip_no ?? "") || saha !== (h.aktif !== false) || h.varsayilan;
  const kaydet = async () => {
    if (bekle) return;
    if (rol === "CALISAN" && ekip === "" && ekipler.length && !window.confirm("Çalışan için ekip seçilmedi: yalnız ekibe ayrılmamış işleri görür. Devam edilsin mi?")) return;
    setBekle(true); setMesaj(null);
    const { s, j } = await tsIstek(`/taseron-saha/yonetim/uye/${h.id}`, "PUT", { rol, ekip_no: ekip === "" ? null : Number(ekip), aktif: saha }).catch(() => ({ s: 0, j: null }));
    setBekle(false);
    if (!j?.ok) return setMesaj({ hata: true, metin: j?.error || (s ? `Kaydedilemedi (${s})` : "Bağlantı yok — kaydedilmedi") });
    setMesaj({ metin: "Kaydedildi" }); onYenile?.();
  };
  const hesapGuncelle = async (govde, onayMetni) => {
    if (bekle || (onayMetni && !window.confirm(onayMetni))) return;
    setBekle(true); setMesaj(null);
    const { s, j } = await tsIstek(`/taseron-saha/yonetim/hesap/${h.id}`, "PUT", govde).catch(() => ({ s: 0, j: null }));
    setBekle(false);
    if (!j?.ok) return setMesaj({ hata: true, metin: j?.error || (s ? `Kaydedilemedi (${s})` : "Bağlantı yok — kaydedilmedi") });
    if (govde.sifre) setYeniSifre(govde.sifre);
    setMesaj({ metin: j.mesaj }); onYenile?.();
  };
  return <tr style={{ borderTop: "1px solid #e2e8f0", verticalAlign: "top" }}>
    <td style={{ padding: "8px 6px" }}><b>{h.name}</b><div style={{ color: "#64748b", fontSize: 12.5 }}>{h.email}</div>
      {h.varsayilan && <div style={{ color: "#92400e", fontSize: 12 }}>Rol tanımsız — firma geneli görür</div>}
      {!h.aktif_hesap && <div style={{ color: "#b91c1c", fontSize: 12, fontWeight: 700 }}>Hesap kapalı (giriş yapamaz)</div>}</td>
    <td style={{ padding: "8px 6px" }}><select value={rol} onChange={(e) => setRol(e.target.value)} style={girdi}>
      <option value="SORUMLU">Firma sorumlusu</option><option value="CALISAN">Çalışan</option></select></td>
    <td style={{ padding: "8px 6px" }}><select value={ekip} onChange={(e) => setEkip(e.target.value)} style={girdi}>
      <option value="">{rol === "SORUMLU" ? "— (tüm ekipler)" : "Ekip seçin"}</option>
      {ekipler.map((e) => <option key={e.ekip_no} value={e.ekip_no}>{e.ad || `Ekip ${e.ekip_no}`}</option>)}</select></td>
    <td style={{ padding: "8px 6px", textAlign: "center" }}><input type="checkbox" checked={saha} onChange={(e) => setSaha(e.target.checked)} aria-label="Saha ekranı açık" /></td>
    <td style={{ padding: "8px 6px" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" disabled={bekle || !degisti} onClick={kaydet} style={{ ...btn(true), opacity: bekle || !degisti ? 0.4 : 1, cursor: bekle || !degisti ? "default" : "pointer" }}>Kaydet</button>
        {hesapAcabilir && <button type="button" disabled={bekle} onClick={() => hesapGuncelle({ sifre: sifreUret() }, `${h.name} için yeni şifre üretilsin mi? Eski şifre geçersiz olur.`)} style={btn(false)}>Şifre sıfırla</button>}
        {hesapAcabilir && <button type="button" disabled={bekle} onClick={() => hesapGuncelle({ hesap_aktif: !h.aktif_hesap }, h.aktif_hesap ? `${h.name} hesabı kapatılsın mı? Uygulamaya giriş yapamaz.` : null)} style={btn(false)}>{h.aktif_hesap ? "Hesabı kapat" : "Hesabı aç"}</button>}
      </div>
      {yeniSifre && <div style={{ marginTop: 6, background: "#fef9c3", borderRadius: 6, padding: "6px 8px", fontSize: 13 }}>Yeni şifre: <code style={{ fontWeight: 900, fontSize: 14 }}>{yeniSifre}</code> — taşerona iletin; bu ekran kapanınca bir daha gösterilmez.</div>}
      {mesaj && <div role="status" style={{ marginTop: 4, fontSize: 13, color: mesaj.hata ? "#b91c1c" : "#14532d", fontWeight: 700 }}>{mesaj.metin}</div>}
    </td>
  </tr>;
}

function YeniHesap({ firma, ekipler, onAcildi }) {
  const varsayilanMarka = firma.ana_firma || (/^TEKNO/i.test(firma.kod || "") ? "TEKNO" : "");
  const [f, setF] = useState({ ad: "", kullanici_adi: "", sifre: sifreUret(), rol: "CALISAN", ekip_no: "", marka: varsayilanMarka });
  const [bekle, setBekle] = useState(false);
  const [hata, setHata] = useState(null);
  const [sonuc, setSonuc] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const hesapAcKapali = bekle || !f.ad.trim() || !f.kullanici_adi.trim() || (f.rol === "CALISAN" && ekipler.length > 0 && f.ekip_no === "") || (!firma.ana_firma && !f.marka);
  const ac = async () => {
    if (bekle) return;
    setBekle(true); setHata(null);
    const { s, j } = await tsIstek("/taseron-saha/yonetim/hesap", "POST", { taseron_id: firma.id, ...f, ekip_no: f.ekip_no === "" ? null : Number(f.ekip_no) }).catch(() => ({ s: 0, j: null }));
    setBekle(false);
    if (!j?.ok) return setHata(j?.error || (s ? `Hesap açılamadı (${s})` : "Bağlantı yok — hesap açılmadı"));
    setSonuc({ ad: f.ad, kullanici_adi: j.kullanici.kullanici_adi, sifre: f.sifre });
    setF({ ad: "", kullanici_adi: "", sifre: sifreUret(), rol: "CALISAN", ekip_no: "", marka: varsayilanMarka });
    onAcildi?.();
  };
  return <div style={{ marginTop: 14, border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
    <div style={{ fontWeight: 800, color: LAC, marginBottom: 8 }}>Yeni taşeron hesabı</div>
    {sonuc && <div style={{ background: "#dcfce7", borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 14 }}>
      <b>{sonuc.ad}</b> hesabı açıldı. Omnix Field Operation uygulamasında giriş bilgileri:<br />
      Kullanıcı adı: <code style={{ fontWeight: 900 }}>{sonuc.kullanici_adi}</code> · Şifre: <code style={{ fontWeight: 900 }}>{sonuc.sifre}</code><br />
      <span style={{ fontSize: 12.5, color: "#14532d" }}>Bu bilgileri taşerona siz iletin; şifre bir daha gösterilmez (unutulursa "Şifre sıfırla").</span>
      <div><button type="button" onClick={() => setSonuc(null)} style={{ ...btn(false), marginTop: 6 }}>Tamam</button></div></div>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
      <label style={{ fontSize: 13 }}>Ad soyad<input value={f.ad} onChange={(e) => set("ad", e.target.value)} style={{ ...girdi, width: "100%" }} /></label>
      <label style={{ fontSize: 13 }}>Kullanıcı adı<input value={f.kullanici_adi} onChange={(e) => set("kullanici_adi", e.target.value.toLowerCase().replace(/\s+/g, ""))} placeholder="ör. emrah.ali" style={{ ...girdi, width: "100%" }} autoComplete="off" /></label>
      <label style={{ fontSize: 13 }}>İlk şifre<div style={{ display: "flex", gap: 4 }}><input value={f.sifre} onChange={(e) => set("sifre", e.target.value)} style={{ ...girdi, flex: 1, minWidth: 0, fontFamily: "monospace" }} autoComplete="new-password" />
        <button type="button" onClick={() => set("sifre", sifreUret())} style={btn(false)} title="Yeni şifre üret">↻</button></div></label>
      <label style={{ fontSize: 13 }}>Rol<select value={f.rol} onChange={(e) => set("rol", e.target.value)} style={{ ...girdi, width: "100%" }}>
        <option value="CALISAN">Çalışan — kendi ekibi</option><option value="SORUMLU">Firma sorumlusu — tüm ekipler</option></select></label>
      <label style={{ fontSize: 13 }}>Ekip<select value={f.ekip_no} onChange={(e) => set("ekip_no", e.target.value)} style={{ ...girdi, width: "100%" }}>
        <option value="">{f.rol === "SORUMLU" ? "— (tüm ekipler)" : "Ekip seçin"}</option>
        {ekipler.map((e) => <option key={e.ekip_no} value={e.ekip_no}>{e.ad || `Ekip ${e.ekip_no}`}</option>)}</select></label>
      {!firma.ana_firma && <label style={{ fontSize: 13 }}>Ana firma<select value={f.marka} onChange={(e) => set("marka", e.target.value)} style={{ ...girdi, width: "100%" }}>
        <option value="">Seçin</option><option value="TEKNO">Teknocenter</option><option value="ERC">Şimşek (ERC)</option></select></label>}
    </div>
    <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" disabled={hesapAcKapali} onClick={ac} style={{ ...btn(true), opacity: hesapAcKapali ? 0.4 : 1 }}>{bekle ? "Açılıyor…" : "Hesabı aç"}</button>
      {f.rol === "CALISAN" && ekipler.length > 0 && f.ekip_no === "" && <span style={{ fontSize: 12.5, color: "#92400e" }}>Çalışan için ekip seçin</span>}
      {hata && <span role="alert" style={{ color: "#b91c1c", fontWeight: 700, fontSize: 13 }}>{hata}</span>}
    </div>
  </div>;
}

export function TaseronHesapModal({ onClose }) {
  const [q, setQ] = useState("");
  const [liste, setListe] = useState(null);
  const [secili, setSecili] = useState(null);
  const [detay, setDetay] = useState(null);
  const [n, setN] = useState(0);
  useEffect(() => { let iptal = false;
    const t = setTimeout(() => tsGet(`/taseron-saha/yonetim/firmalar${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`).then((j) => { if (!iptal) setListe(j); }).catch((e) => { if (!iptal) setListe({ hata: e.message }); }), 250);
    return () => { iptal = true; clearTimeout(t); }; }, [q]);
  useEffect(() => { if (!secili) return undefined; let iptal = false; setDetay((d) => (d?.firma?.id === secili ? d : null));
    tsGet(`/taseron-saha/yonetim/firma/${secili}`).then((j) => { if (!iptal) setDetay(j); }).catch((e) => { if (!iptal) setDetay({ hata: e.message }); });
    return () => { iptal = true; }; }, [secili, n]);
  const yenile = () => { setN((x) => x + 1); setQ((x) => x); };
  return createPortal(<div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 1300, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
    <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Taşeron hesapları"
      style={{ background: "#fff", borderRadius: 14, width: "min(1180px, 100%)", height: "min(860px, 100%)", display: "flex", flexDirection: "column", overflow: "hidden", textAlign: "left" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 900, fontSize: 18, color: LAC }}>Taşeron hesapları</div>
          <div style={{ fontSize: 12.5, color: "#64748b" }}>Omnix Field Operation uygulamasına giriş · firma, ekip ve rol (sorumlu tüm ekipleri, çalışan yalnız kendi ekibini görür)</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Kapat" style={{ ...btn(false), fontSize: 16 }}>✕</button>
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0, flexWrap: "wrap" }}>
        <div style={{ width: 300, maxWidth: "100%", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: 10 }}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Firma ara (ör. TEKNO_)" style={{ ...girdi, width: "100%" }} /></div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {liste?.hata && <div style={{ padding: 10, color: "#b91c1c" }}>{liste.hata}</div>}
            {!liste && <div style={{ padding: 10, color: "#64748b" }}>Yükleniyor…</div>}
            {liste?.firmalar?.length === 0 && <div style={{ padding: 10, color: "#64748b" }}>Firma bulunamadı. Adıyla arayın.</div>}
            {(liste?.firmalar || []).map((f) => <button key={f.id} type="button" onClick={() => setSecili(f.id)}
              style={{ display: "block", width: "100%", textAlign: "left", border: 0, borderBottom: "1px solid #f1f5f9", padding: "9px 12px", cursor: "pointer", background: secili === f.id ? "#e0e7ff" : "#fff" }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{f.kod}</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>{[f.ad !== f.kod ? f.ad : null, `${f.ekip_sayisi} ekip`, `${f.hesap_sayisi} hesap`].filter(Boolean).join(" · ")}</div>
            </button>)}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 320, overflowY: "auto", padding: 14 }}>
          {!secili && <div style={{ color: "#64748b" }}>Soldan bir taşeron firma seçin.</div>}
          {secili && !detay && <div style={{ color: "#64748b" }}>Yükleniyor…</div>}
          {detay?.hata && <div style={{ color: "#b91c1c", fontWeight: 700 }}>{detay.hata}</div>}
          {detay?.ok && <>
            <div style={{ fontWeight: 900, fontSize: 17 }}>{detay.firma.kod}{detay.firma.ad !== detay.firma.kod ? <span style={{ fontWeight: 400, color: "#64748b" }}> · {detay.firma.ad}</span> : null}</div>
            <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>Ekipler: {detay.ekipler.length ? detay.ekipler.map((e) => e.ad || `Ekip ${e.ekip_no}`).join(", ")
              : <span style={{ color: "#92400e", fontWeight: 700 }}>Bu firmaya bağlı ekip yok — çalışanlar ekibe ayrılamaz. Org şemasında ekip kartından firmayı seçin.</span>}</div>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 14 }}>
              <thead><tr style={{ textAlign: "left", color: "#475569", fontSize: 12.5 }}><th style={{ padding: 6 }}>Kişi</th><th style={{ padding: 6 }}>Rol</th><th style={{ padding: 6 }}>Ekip</th><th style={{ padding: 6 }}>Saha ekranı</th><th style={{ padding: 6 }}></th></tr></thead>
              <tbody>{detay.hesaplar.map((h) => <HesapSatiri key={`${h.id}-${h.rol}-${h.ekip_no}-${h.aktif}-${h.aktif_hesap}`} h={h} ekipler={detay.ekipler} hesapAcabilir={detay.hesap_acabilir} onYenile={yenile} />)}</tbody>
            </table>
            {!detay.hesaplar.length && <div style={{ color: "#64748b", marginTop: 8 }}>Bu firmanın henüz uygulama hesabı yok.</div>}
            {detay.hesap_acabilir ? <YeniHesap key={detay.firma.id} firma={detay.firma} ekipler={detay.ekipler} onAcildi={yenile} />
              : <div style={{ marginTop: 12, fontSize: 13, color: "#64748b" }}>Yeni hesap açma yetkiniz yok (kullanıcı yöneticisi ya da Teknocenter yöneticisi açabilir).</div>}
          </>}
        </div>
      </div>
    </div>
  </div>, document.body);
}
