// MALZEME STOK DEFTERİ — web ekranları (29.10.2026, Orhan). Tek stok kaynağı: /malzeme/stok/* (backend/malzemeStok.js).
//   StokDefteriPanel : depo / yönetim — ürün, personel, saha özetleri, bekleyenler, hareket dökümü, giriş / teslim / mal kabul /
//                      rezervasyon / sayım, ürün kartları, açılış sayımı, depolar, Excel.
//   StokBenimPanel   : personel — üzerimdeki malzeme, "Sahada kullandım", depoya iade, bekleyen iade, geçmiş.
// Yetki sunucuda denetlenir; düğme gizlemek yalnız kolaylıktır. Her yazma isteği bir istek anahtarı taşır: bağlantı koparsa
// aynı anahtarla tekrar denenir, ikinci kayıt oluşmaz. Anahtar yalnız başarılı kayıttan sonra yenilenir.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const LAC = "#1e3a5f";
const tokenAl = () => localStorage.getItem("finance_token") || localStorage.getItem("token") || "";
const yeniAnahtar = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
const bugun = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
export const sayi = (v) => (v === null || v === undefined || v === "" ? "—" : Number(v).toLocaleString("tr-TR", { maximumFractionDigits: 3 }));
const tarihTR = (v) => (v ? new Date(String(v).length <= 10 ? v + "T12:00:00" : v).toLocaleDateString("tr-TR") : "—");
const zamanTR = (v) => (v ? new Date(v).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

// Ağ hatası ile sunucu reddini ayırır: ağ hatasında sonuç bilinmez (anahtar korunur, tekrar güvenli)
async function api(yol, { method = "GET", body, anahtar } = {}) {
  let r;
  try {
    r = await fetch(API_BASE + yol, {
      method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAl()}` },
      body: body ? JSON.stringify(anahtar ? { ...body, istek_anahtari: anahtar } : body) : undefined,
    });
  } catch {
    const e = new Error("Bağlantı kurulamadı. Kayıt yapılıp yapılmadığı doğrulanamadı — bilgiler duruyor, tekrar deneyin; ikinci kez kaydedilmez.");
    e.belirsiz = true; throw e;
  }
  const j = await r.json().catch(() => null);
  if (!r.ok || (j && j.ok === false)) {
    const e = new Error((j && j.error) || `Sunucu hatası (${r.status})`);
    e.http = r.status; if (r.status >= 500) e.belirsiz = r.status === 502 || r.status === 503 || r.status === 504;
    throw e;
  }
  return j;
}
async function excelIndir(yol, ad) {
  const r = await fetch(API_BASE + yol, { headers: { Authorization: `Bearer ${tokenAl()}` } });
  if (!r.ok) { const j = await r.json().catch(() => null); throw new Error(j?.error || "Excel alınamadı"); }
  const b = await r.blob();
  const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = ad; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
// Bir formun istek anahtarı: başarıya kadar sabit
function useAnahtar() {
  const [k, setK] = useState(yeniAnahtar);
  return [k, useCallback(() => setK(yeniAnahtar()), [])];
}
// Çift tıklama kilidi + hata/başarı mesajı
function useIslem() {
  const kilit = useRef(false);
  const [mesgul, setMesgul] = useState(false);
  const [mesaj, setMesaj] = useState(null); // { tur: "hata"|"basari"|"uyari", metin }
  const calistir = useCallback(async (fn) => {
    if (kilit.current) return null;
    kilit.current = true; setMesgul(true); setMesaj(null);
    try { return await fn(); }
    catch (e) { setMesaj({ tur: e.belirsiz ? "uyari" : "hata", metin: e.message }); return null; }
    finally { kilit.current = false; setMesgul(false); }
  }, []);
  return { mesgul, mesaj, setMesaj, calistir };
}

// ── Küçük görsel parçalar ──────────────────────────────────────────────────────────────────────────────────────────
const sKart = { background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 14, marginBottom: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };
const sInput = { padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13, width: "100%", boxSizing: "border-box", background: "#fff" };
const sEtiket = { fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4, display: "block", textAlign: "left" };
const sTh = { padding: "8px 10px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#475569", background: "#f1f5f9", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" };
const sTd = { padding: "8px 10px", fontSize: 13, borderBottom: "1px solid #f1f5f9", verticalAlign: "top" };
const sTdN = { ...sTd, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
function Btn({ children, tur = "ana", kucuk, ...p }) {
  const renk = { ana: [LAC, "#fff"], yesil: ["#065f46", "#fff"], kirmizi: ["#fee2e2", "#b91c1c"], gri: ["#f1f5f9", "#334155"], mavi: ["#dbeafe", "#1d4ed8"] }[tur];
  return <button {...p} style={{ padding: kucuk ? "5px 10px" : "9px 16px", background: p.disabled ? "#cbd5e1" : renk[0], color: renk[1], border: "none", borderRadius: 8, fontWeight: 700,
    fontSize: kucuk ? 12 : 13, cursor: p.disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap", ...(p.style || {}) }}>{children}</button>;
}
function Mesaj({ m, onKapat }) {
  if (!m) return null;
  const r = { hata: ["#fef2f2", "#b91c1c", "#fecaca"], basari: ["#ecfdf5", "#065f46", "#a7f3d0"], uyari: ["#fffbeb", "#92400e", "#fde68a"], bilgi: ["#eff6ff", "#1e40af", "#bfdbfe"] }[m.tur] || [];
  return <div role="alert" style={{ background: r[0], color: r[1], border: `1px solid ${r[2]}`, borderRadius: 8, padding: "9px 12px", fontSize: 13, marginBottom: 10, display: "flex", gap: 8 }}>
    <div style={{ flex: 1, whiteSpace: "pre-wrap" }}>{m.metin}</div>{onKapat ? <button onClick={onKapat} style={{ background: "none", border: "none", cursor: "pointer", color: r[1] }}>✕</button> : null}</div>;
}
function Alan({ etiket, children, style }) { return <label style={{ display: "block", marginBottom: 10, textAlign: "left", ...style }}><span style={sEtiket}>{etiket}</span>{children}</label>; }
function Tablo({ kolonlar, satirlar, bos = "Kayıt yok", satirStil }) {
  return <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff" }}>
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr>{kolonlar.map((k) => <th key={k.b} style={{ ...sTh, textAlign: k.sayi ? "right" : "left" }}>{k.b}</th>)}</tr></thead>
      <tbody>{satirlar.length === 0 ? <tr><td colSpan={kolonlar.length} style={{ ...sTd, textAlign: "center", color: "#9ca3af", padding: 24 }}>{bos}</td></tr>
        : satirlar.map((s, i) => <tr key={s.id ?? s._k ?? i} style={satirStil ? satirStil(s) : undefined}>{kolonlar.map((k) => <td key={k.b} style={k.sayi ? sTdN : sTd}>{k.r ? k.r(s) : (k.sayi ? sayi(s[k.a]) : (s[k.a] ?? "—"))}</td>)}</tr>)}</tbody>
    </table></div>;
}
const Rozet = ({ metin, renk = "#1d4ed8", zemin = "#dbeafe" }) => <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700, color: renk, background: zemin, whiteSpace: "nowrap" }}>{metin}</span>;

function UrunSecici({ urunler, deger, onSec, yalnizSarf, style }) {
  const [ara, setAra] = useState("");
  const liste = useMemo(() => urunler.filter((u) => u.aktif !== false && (!yalnizSarf || u.tur === "SARF") &&
    (!ara || `${u.kod} ${u.ad}`.toLocaleUpperCase("tr").includes(ara.toLocaleUpperCase("tr")))), [urunler, ara, yalnizSarf]);
  return <div style={{ display: "flex", gap: 6, ...style }}>
    <input placeholder="Ara…" value={ara} onChange={(e) => setAra(e.target.value)} style={{ ...sInput, width: 90, flex: "0 0 90px" }} />
    <select value={deger || ""} onChange={(e) => onSec(e.target.value ? Number(e.target.value) : null)} style={sInput}>
      <option value="">— ürün seçin —</option>
      {liste.map((u) => <option key={u.id} value={u.id}>{u.kod} · {u.ad} ({u.temel_birim}){u.tur === "EKIPMAN" ? " · ekipman" : ""}</option>)}
    </select></div>;
}
function BirimSecici({ urun, deger, onSec }) {
  if (!urun) return <select disabled style={sInput}><option>—</option></select>;
  const birimler = [urun.temel_birim, ...(urun.donusumler || []).map((d) => d.birim)];
  return <select value={deger || urun.temel_birim} onChange={(e) => onSec(e.target.value)} style={sInput}>
    {birimler.map((b) => <option key={b} value={b}>{b}{b !== urun.temel_birim ? ` (1 = ${sayi(urun.donusumler.find((d) => d.birim === b)?.katsayi)} ${urun.temel_birim})` : ""}</option>)}
  </select>;
}
function SahaSecici({ deger, onSec, kisisel }) {
  const [oneri, setOneri] = useState({ atanan: [], diger: [] });
  const [acik, setAcik] = useState(false);
  useEffect(() => {
    let iptal = false;
    const t = setTimeout(async () => {
      try {
        if (kisisel) { const j = await api(`/malzeme/stok/sahalarim?q=${encodeURIComponent(deger || "")}`); if (!iptal) setOneri({ atanan: j.atanan || [], diger: j.diger || [] }); }
        else if ((deger || "").length >= 2) {
          const r = await fetch(`${API_BASE}/malzeme/site-codes?q=${encodeURIComponent(deger)}`, { headers: { Authorization: `Bearer ${tokenAl()}` } });
          const j = await r.json(); if (!iptal) setOneri({ atanan: [], diger: (Array.isArray(j) ? j : []).map((x) => ({ saha_kodu: x.site_code, bolge: x.bolge })) });
        }
      } catch { /* öneri alınamadı; sunucu kayıtta yine doğrular */ }
    }, 250);
    return () => { iptal = true; clearTimeout(t); };
  }, [deger, kisisel]);
  const hepsi = [...oneri.atanan.map((x) => ({ ...x, atanan: true })), ...oneri.diger];
  return <div style={{ position: "relative" }}>
    <input value={deger || ""} onChange={(e) => { onSec(e.target.value.toUpperCase().replace(/\s+/g, "")); setAcik(true); }} onFocus={() => setAcik(true)} onBlur={() => setTimeout(() => setAcik(false), 200)}
      placeholder="Saha kodu (listeden seçin)" style={sInput} autoComplete="off" />
    {acik && hepsi.length > 0 && <div style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #d1d5db", borderRadius: 8, maxHeight: 220, overflowY: "auto", boxShadow: "0 6px 16px rgba(0,0,0,0.12)" }}>
      {hepsi.map((x) => <div key={x.saha_kodu} onMouseDown={() => { onSec(x.saha_kodu); setAcik(false); }} style={{ padding: "8px 10px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between" }}>
        <b>{x.saha_kodu}</b><span style={{ color: x.atanan ? "#065f46" : "#9ca3af", fontSize: 11 }}>{x.atanan ? "size atanan" : (x.bolge || "")}</span></div>)}
    </div>}
  </div>;
}

// ═══ DEPO / YÖNETİM: STOK DEFTERİ ═══════════════════════════════════════════════════════════════════════════════════
export function StokDefteriPanel({ baslangic }) {
  const [ayar, setAyar] = useState(null);
  const [hata, setHata] = useState(null);
  const [ekran, setEkran] = useState(baslangic?.ekran || "ozet");
  const [urunler, setUrunler] = useState([]);
  const [personeller, setPersoneller] = useState([]);
  const [yenile, setYenile] = useState(0);
  const tazele = useCallback(() => setYenile((x) => x + 1), []);
  useEffect(() => {
    (async () => {
      try {
        const a = await api("/malzeme/stok/ayar"); setAyar(a);
        const [u, p] = await Promise.all([api("/malzeme/stok/urunler?aktif=hepsi"), api("/malzeme/stok/personeller").catch(() => ({ rows: [] }))]);
        setUrunler(u.rows || []); setPersoneller(p.rows || []);
      } catch (e) { setHata(e.message); }
    })();
  }, [yenile]);
  useEffect(() => { if (baslangic?.ekran) setEkran(baslangic.ekran); }, [baslangic]);
  if (hata) return <Mesaj m={{ tur: "hata", metin: hata }} />;
  if (!ayar) return <div style={{ padding: 30, color: "#6b7280" }}>Stok defteri yükleniyor…</div>;
  const Y = ayar.yetki;
  const sekmeler = [["ozet", "Ürün Stoku"], ["personel", "Personel Stoku"], ["saha", "Saha Tüketimi"], ["bekleyen", "Bekleyenler"], ["hareket", "Hareket Dökümü"],
    ...(Y.depo ? [["islem", "Giriş · Teslim · Kabul"], ["urun", "Ürünler"], ["acilis", "Açılış Sayımı"]] : []), ...(Y.onay ? [["depo", "Depolar"]] : [])];
  const ortak = { ayar, urunler, personeller, tazele, Y };
  return <div>
    {!ayar.defter_acik && <Mesaj m={{ tur: "uyari", metin: "Stok defteri henüz açılmadı. Önce depo(lar) tanımlanır, fiziksel sayım Açılış Sayımı ekranından önizlenip yönetici onayıyla uygulanır. Açılıştan önce stok hareketi yapılamaz; eski ekranlar yalnız geçmişi gösterir." }} />}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
      {sekmeler.map(([k, l]) => <button key={k} onClick={() => setEkran(k)} style={{ padding: "7px 12px", borderRadius: 18, border: `1px solid ${ekran === k ? LAC : "#cbd5e1"}`, background: ekran === k ? LAC : "#fff", color: ekran === k ? "#fff" : "#334155", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{l}</button>)}
    </div>
    {["ozet", "personel", "saha", "hareket"].includes(ekran) && <RaporEkrani tur={ekran} {...ortak} key={ekran + yenile} />}
    {ekran === "bekleyen" && <Bekleyenler {...ortak} key={"b" + yenile} />}
    {ekran === "islem" && <IslemEkrani {...ortak} baslangic={baslangic} />}
    {ekran === "urun" && <UrunEkrani {...ortak} />}
    {ekran === "acilis" && <AcilisEkrani {...ortak} />}
    {ekran === "depo" && <DepoEkrani {...ortak} />}
    <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 16 }}>Maliyet: {ayar.maliyet_yontemi}</div>
  </div>;
}

function RaporEkrani({ tur, ayar, urunler, personeller, Y }) {
  const [f, setF] = useState({ bas: "", bit: "", urun_id: "", personel_id: "", saha: "", depo_id: "", firma: "", tur: "" });
  const [satirlar, setSatirlar] = useState(null);
  const islem = useIslem();
  const [tersHedef, setTersHedef] = useState(null);
  const sorgu = useMemo(() => new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString(), [f]);
  const yukle = useCallback(async () => {
    const yol = { ozet: "ozet", personel: "personel", saha: "saha", hareket: "hareketler" }[tur];
    try { const j = await api(`/malzeme/stok/${yol}?${sorgu}`); setSatirlar(j.rows || []); } catch (e) { islem.setMesaj({ tur: "hata", metin: e.message }); setSatirlar([]); }
  }, [tur, sorgu]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(yukle, 200); return () => clearTimeout(t); }, [yukle]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const [tersAnahtar, tersYenile] = useAnahtar();
  const ters = () => islem.calistir(async () => {
    await api(`/malzeme/stok/hareket/${tersHedef.id}/ters`, { method: "POST", body: { gerekce: tersHedef.gerekce }, anahtar: tersAnahtar });
    tersYenile(); setTersHedef(null); islem.setMesaj({ tur: "basari", metin: `#${tersHedef.id} ters kayıtla düzeltildi.` }); yukle();
  });
  const firmalar = [...new Set(personeller.map((p) => p.firma))];
  const kolon = {
    ozet: [{ b: "Kod", a: "kod" }, { b: "Ürün", r: (s) => <span>{s.ad} {s.tur === "EKIPMAN" ? <Rozet metin="ekipman" renk="#7c3aed" zemin="#ede9fe" /> : null} {s.dusuk_stok ? <Rozet metin="düşük stok" renk="#b91c1c" zemin="#fee2e2" /> : null}</span> },
      { b: "Birim", a: "temel_birim" }, { b: "Depo kullanılabilir", a: "depo_kullanilabilir", sayi: 1 }, { b: "Rezerve", a: "rezerve", sayi: 1 }, { b: "Depo fiziksel", a: "depo_fiziksel", sayi: 1 },
      { b: "Personelde kullanılabilir", a: "personel_kullanilabilir", sayi: 1 }, { b: "İade bekleyen", a: "iade_bekleyen", sayi: 1 }, { b: "Tüketilen", a: "tuketilen", sayi: 1 }, { b: "Düşük stok eşiği", a: "min_stok", sayi: 1 }],
    personel: [{ b: "Personel", a: "ad_soyad" }, { b: "Firma", a: "firma" }, { b: "Ürün", r: (s) => `${s.kod} · ${s.urun_ad}` }, { b: "Birim", a: "temel_birim" },
      { b: "Kullanılabilir", a: "kullanilabilir", sayi: 1 }, { b: "İade bekleyen", a: "iade_bekleyen", sayi: 1 }, { b: "Üzerinde toplam", a: "toplam", sayi: 1 }, { b: "Tüketilen", a: "tuketilen", sayi: 1 }],
    saha: [{ b: "Saha", a: "saha_kodu" }, { b: "Ürün", r: (s) => `${s.kod} · ${s.urun_ad}` }, { b: "Birim", a: "temel_birim" }, { b: "Tüketilen", a: "tuketilen", sayi: 1 },
      { b: "Kayıt", a: "kayit_sayisi", sayi: 1 }, { b: "İlk", r: (s) => tarihTR(s.ilk_tarih) }, { b: "Son", r: (s) => tarihTR(s.son_tarih) }, { b: "Personel", a: "personeller" }],
    hareket: [{ b: "No", r: (s) => <span style={{ color: s.iptal_edildi ? "#9ca3af" : undefined, textDecoration: s.iptal_edildi ? "line-through" : undefined }}>#{s.id}</span> },
      { b: "Tarih", r: (s) => <span title={`Kayıt: ${zamanTR(s.created_at)}`}>{tarihTR(s.islem_tarihi)}</span> }, { b: "Tür", a: "tur_ad" }, { b: "Ürün", a: "urun_ad" },
      { b: "Miktar", r: (s) => `${sayi(s.miktar)} ${s.temel_birim}${s.girilen_birim && s.girilen_birim !== s.temel_birim ? ` (${sayi(s.girilen_miktar)} ${s.girilen_birim})` : ""}`, sayi: 1 },
      { b: "Nereden → nereye", r: (s) => <span style={{ fontSize: 12 }}>{s.nereden} → {s.nereye}</span> }, { b: "Kim", r: (s) => <span style={{ fontSize: 12 }}>{s.islem_yapan_ad || s.islem_yapan_email}</span> },
      { b: "Açıklama", r: (s) => <span style={{ fontSize: 12, color: "#475569" }}>{[s.aciklama, s.belge_no].filter(Boolean).join(" · ") || "—"}{s.iptal_edildi ? <> · <Rozet metin={`ters #${s.ters_hareket_id}`} renk="#92400e" zemin="#fef3c7" /></> : null}</span> },
      ...(Y.onay ? [{ b: "", r: (s) => !s.iptal_edildi && ["GIRIS", "TESLIM", "TUKETIM", "SAYIM_DUZELTME", "ACILIS", "REZERV_TESLIM"].includes(s.tur) ? <Btn kucuk tur="gri" onClick={() => setTersHedef({ ...s, gerekce: "" })}>Ters kayıt</Btn> : null }] : [])],
  }[tur];
  return <div>
    <div style={{ ...sKart, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 8, alignItems: "end" }}>
      <Alan etiket={tur === "ozet" || tur === "personel" ? "Tüketim başlangıç" : "Başlangıç"} style={{ marginBottom: 0 }}><input type="date" value={f.bas} onChange={set("bas")} style={sInput} /></Alan>
      <Alan etiket={tur === "ozet" || tur === "personel" ? "Tüketim bitiş" : "Bitiş"} style={{ marginBottom: 0 }}><input type="date" value={f.bit} onChange={set("bit")} style={sInput} /></Alan>
      <Alan etiket="Ürün" style={{ marginBottom: 0 }}><select value={f.urun_id} onChange={set("urun_id")} style={sInput}><option value="">Tümü</option>{urunler.map((u) => <option key={u.id} value={u.id}>{u.kod} · {u.ad}</option>)}</select></Alan>
      <Alan etiket="Personel" style={{ marginBottom: 0 }}><select value={f.personel_id} onChange={set("personel_id")} style={sInput}><option value="">Tümü</option>{personeller.map((p) => <option key={p.id} value={p.id}>{p.ad_soyad}</option>)}</select></Alan>
      <Alan etiket="Saha" style={{ marginBottom: 0 }}><input value={f.saha} onChange={(e) => setF((x) => ({ ...x, saha: e.target.value.toUpperCase() }))} placeholder="IZ1234" style={sInput} /></Alan>
      <Alan etiket="Depo" style={{ marginBottom: 0 }}><select value={f.depo_id} onChange={set("depo_id")} style={sInput}><option value="">Tümü</option>{ayar.depolar.map((d) => <option key={d.id} value={d.id}>{d.ad}</option>)}</select></Alan>
      <Alan etiket="Firma" style={{ marginBottom: 0 }}><select value={f.firma} onChange={set("firma")} style={sInput}><option value="">Tümü</option>{firmalar.map((x) => <option key={x}>{x}</option>)}</select></Alan>
      {tur === "hareket" && <Alan etiket="Hareket türü" style={{ marginBottom: 0 }}><select value={f.tur} onChange={set("tur")} style={sInput}><option value="">Tümü</option>{Object.entries(ayar.hareket_turleri).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Alan>}
      <Btn tur="yesil" onClick={() => islem.calistir(() => excelIndir(`/malzeme/stok/excel?${sorgu}`, `malzeme_stok_${bugun()}.xlsx`))} disabled={islem.mesgul}>⬇ Excel (filtreli)</Btn>
    </div>
    <Mesaj m={islem.mesaj} onKapat={() => islem.setMesaj(null)} />
    {tur === "ozet" && satirlar && satirlar.some((s) => s.dusuk_stok) && <Mesaj m={{ tur: "uyari", metin: `Düşük stok: ${satirlar.filter((s) => s.dusuk_stok).map((s) => `${s.ad} (${sayi(s.depo_kullanilabilir)} / eşik ${sayi(s.min_stok)} ${s.temel_birim})`).join(", ")}` }} />}
    {tur === "ozet" && <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Kullanılabilir: işlem yapılabilen miktar · Rezerve: depoda duran ama ayrılmış · Depo fiziksel = kullanılabilir + rezerve · İade bekleyen: personelin iade ettiği, depo henüz teslim almadı (kullanılamaz). Stoklar ANLIK; tüketilen sütunu tarih filtresine göre.</div>}
    {satirlar === null ? <div style={{ color: "#6b7280", padding: 16 }}>Yükleniyor…</div> : <Tablo kolonlar={kolon} satirlar={satirlar} />}
    {tersHedef && <Modal baslik={`Ters kayıt · #${tersHedef.id} ${tersHedef.tur_ad}`} onKapat={() => setTersHedef(null)}>
      <div style={{ fontSize: 13, marginBottom: 10 }}>{tersHedef.urun_ad}: {sayi(tersHedef.miktar)} {tersHedef.temel_birim} · {tersHedef.nereden} → {tersHedef.nereye}. Hareket silinmez; tersine bir kayıt eklenir.</div>
      <Alan etiket="Gerekçe (zorunlu)"><textarea value={tersHedef.gerekce} onChange={(e) => setTersHedef({ ...tersHedef, gerekce: e.target.value })} style={{ ...sInput, minHeight: 70 }} /></Alan>
      <Mesaj m={islem.mesaj} /><Btn onClick={ters} disabled={islem.mesgul || !tersHedef.gerekce.trim()}>{islem.mesgul ? "Kaydediliyor…" : "Ters kaydı oluştur"}</Btn>
    </Modal>}
  </div>;
}

function Modal({ baslik, children, onKapat }) {
  return <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onMouseDown={(e) => e.target === e.currentTarget && onKapat()}>
    <div style={{ background: "#fff", borderRadius: 14, padding: 18, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}><div style={{ fontWeight: 800, color: LAC, flex: 1 }}>{baslik}</div><button onClick={onKapat} style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer" }}>✕</button></div>
      {children}</div></div>;
}

function Bekleyenler({ ayar, Y, tazele }) {
  const [iadeler, setIadeler] = useState(null);
  const [rez, setRez] = useState([]);
  const [karar, setKarar] = useState(null); // { iade, onay, depo_id, aciklama, teyit }
  const islem = useIslem();
  const [k, kYenile] = useAnahtar();
  const yukle = useCallback(async () => {
    try { const [a, b] = await Promise.all([api("/malzeme/stok/iadeler?durum=BEKLIYOR"), api("/malzeme/stok/rezervasyonlar")]); setIadeler(a.rows); setRez(b.rows); }
    catch (e) { islem.setMesaj({ tur: "hata", metin: e.message }); setIadeler([]); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { yukle(); }, [yukle]);
  const acikDepolar = ayar.depolar.filter((d) => d.aktif && d.acilis_id);
  const kaydet = () => islem.calistir(async () => {
    const yol = `/malzeme/stok/iade/${karar.iade.id}/${karar.onay ? "onayla" : "reddet"}`;
    await api(yol, { method: "POST", body: karar.onay ? { depo_id: Number(karar.depo_id), aciklama: karar.aciklama } : { aciklama: karar.aciklama }, anahtar: k });
    kYenile(); setKarar(null); islem.setMesaj({ tur: "basari", metin: karar.onay ? "İade onaylandı; miktar depoya girdi." : "İade reddedildi; miktar personelin kullanılabilir stoğuna döndü." }); yukle();
  });
  const rezIptal = (r) => islem.calistir(async () => {
    if (!window.confirm(`#${r.id} rezervasyonu iptal edilsin mi? Kalan ${sayi(r.kalan)} ${r.temel_birim} depoda kullanılabilir olur.`)) return;
    await api(`/malzeme/stok/rezervasyon/${r.id}/iptal`, { method: "POST", body: {}, anahtar: yeniAnahtar() }); yukle();
  });
  return <div>
    <Mesaj m={islem.mesaj} onKapat={() => islem.setMesaj(null)} />
    <div style={{ fontWeight: 800, color: LAC, margin: "4px 0 8px" }}>Onay bekleyen iadeler ({iadeler?.length ?? "…"})</div>
    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>Onay yalnız malzeme depoya FİZİKSEL olarak teslim alındıktan sonra verilir. Ret gerekçeli olmalı; miktar personele döner.</div>
    <Tablo kolonlar={[{ b: "Talep", r: (s) => zamanTR(s.talep_tarihi) }, { b: "Personel", a: "personel_ad" }, { b: "Ürün", r: (s) => `${s.kod} · ${s.urun_ad}` },
      { b: "Miktar", r: (s) => `${sayi(s.miktar)} ${s.temel_birim}`, sayi: 1 }, { b: "Açıklama", a: "talep_aciklama" },
      { b: "", r: (s) => Y.depo ? <div style={{ display: "flex", gap: 6 }}><Btn kucuk tur="kirmizi" onClick={() => setKarar({ iade: s, onay: false, aciklama: "" })}>Reddet</Btn>
        <Btn kucuk tur="yesil" onClick={() => setKarar({ iade: s, onay: true, depo_id: s.depo_id || acikDepolar[0]?.id || "", aciklama: "", teyit: false })}>Teslim aldım · Onayla</Btn></div> : null }]}
    satirlar={iadeler || []} bos="Bekleyen iade yok" />
    <div style={{ fontWeight: 800, color: LAC, margin: "18px 0 8px" }}>Açık rezervasyonlar</div>
    <Tablo kolonlar={[{ b: "No", r: (s) => `#${s.id}` }, { b: "Tarih", r: (s) => zamanTR(s.created_at) }, { b: "Ürün", r: (s) => `${s.kod} · ${s.urun_ad}` }, { b: "Depo", a: "depo_ad" },
      { b: "Personel", a: "personel_ad" }, { b: "Rezerve", r: (s) => `${sayi(s.miktar)} ${s.temel_birim}`, sayi: 1 }, { b: "Kalan", r: (s) => `${sayi(s.kalan)} ${s.temel_birim}`, sayi: 1 }, { b: "Açıklama", a: "aciklama" },
      { b: "", r: (s) => Y.depo ? <Btn kucuk tur="gri" onClick={() => rezIptal(s)}>İptal</Btn> : null }]} satirlar={rez} bos="Açık rezervasyon yok" />
    {karar && <Modal baslik={karar.onay ? "İadeyi onayla (depoya giriş)" : "İadeyi reddet"} onKapat={() => setKarar(null)}>
      <div style={{ fontSize: 14, marginBottom: 12 }}><b>{karar.iade.personel_ad}</b> · {karar.iade.urun_ad}: <b>{sayi(karar.iade.miktar)} {karar.iade.temel_birim}</b></div>
      {karar.onay && <Alan etiket="Teslim alan depo"><select value={karar.depo_id} onChange={(e) => setKarar({ ...karar, depo_id: e.target.value })} style={sInput}>{acikDepolar.map((d) => <option key={d.id} value={d.id}>{d.ad}</option>)}</select></Alan>}
      <Alan etiket={karar.onay ? "Not (isteğe bağlı)" : "Ret gerekçesi (zorunlu)"}><textarea value={karar.aciklama} onChange={(e) => setKarar({ ...karar, aciklama: e.target.value })} style={{ ...sInput, minHeight: 60 }} /></Alan>
      {karar.onay && <label style={{ display: "flex", gap: 8, fontSize: 13, marginBottom: 12 }}><input type="checkbox" checked={karar.teyit} onChange={(e) => setKarar({ ...karar, teyit: e.target.checked })} /> Malzemeyi fiziksel olarak teslim aldım ve miktarı saydım.</label>}
      <Mesaj m={islem.mesaj} />
      <Btn tur={karar.onay ? "yesil" : "kirmizi"} style={karar.onay ? {} : { background: "#b91c1c", color: "#fff" }} onClick={kaydet}
        disabled={islem.mesgul || (karar.onay ? !karar.teyit || !karar.depo_id : !karar.aciklama.trim())}>{islem.mesgul ? "Kaydediliyor…" : karar.onay ? "Onayla" : "Reddet"}</Btn>
    </Modal>}
  </div>;
}

const bosKalem = () => ({ urun_id: null, miktar: "", birim: "", rezervasyon_id: "", talep_kalem_id: null });
function KalemSatirlari({ kalemler, setKalemler, urunler, rezervasyonlar }) {
  const degis = (i, k, v) => setKalemler((l) => l.map((x, j) => (j === i ? { ...x, [k]: v, ...(k === "urun_id" ? { birim: "", rezervasyon_id: "" } : {}) } : x)));
  return <div>{kalemler.map((x, i) => {
    const u = urunler.find((y) => y.id === x.urun_id);
    const rz = (rezervasyonlar || []).filter((r) => r.urun_id === x.urun_id);
    return <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(220px,3fr) 1fr 1fr" + (rezervasyonlar ? " 1.3fr" : "") + " auto", gap: 6, marginBottom: 6, alignItems: "center" }}>
      <UrunSecici urunler={urunler} deger={x.urun_id} onSec={(v) => degis(i, "urun_id", v)} />
      <input inputMode="decimal" placeholder="Miktar (12,5)" value={x.miktar} onChange={(e) => degis(i, "miktar", e.target.value)} style={sInput} />
      <BirimSecici urun={u} deger={x.birim} onSec={(v) => degis(i, "birim", v)} />
      {rezervasyonlar && <select value={x.rezervasyon_id} onChange={(e) => degis(i, "rezervasyon_id", e.target.value)} style={sInput} disabled={!rz.length}>
        <option value="">{rz.length ? "Rezervasyonsuz" : "Rezervasyon yok"}</option>{rz.map((r) => <option key={r.id} value={r.id}>#{r.id} · kalan {sayi(r.kalan)} {r.personel_ad ? `· ${r.personel_ad}` : ""}</option>)}</select>}
      <button onClick={() => setKalemler((l) => (l.length > 1 ? l.filter((_, j) => j !== i) : l))} style={{ border: "none", background: "none", color: "#b91c1c", cursor: "pointer", fontSize: 16 }} title="Satırı sil">✕</button>
    </div>;
  })}<Btn kucuk tur="mavi" onClick={() => setKalemler((l) => [...l, bosKalem()])}>+ Kalem</Btn></div>;
}
const kalemGovdesi = (l) => l.filter((x) => x.urun_id && String(x.miktar).trim()).map((x) => ({ urun_id: x.urun_id, miktar: String(x.miktar).trim(), birim: x.birim || undefined,
  rezervasyon_id: x.rezervasyon_id ? Number(x.rezervasyon_id) : undefined, talep_kalem_id: x.talep_kalem_id || undefined }));

function IslemEkrani({ ayar, urunler, personeller, Y, baslangic }) {
  const [tur, setTur] = useState(baslangic?.form || "teslim");
  const acikDepolar = ayar.depolar.filter((d) => d.aktif && d.acilis_id);
  return <div>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
      {[["teslim", "Personele teslim"], ["giris", "Depoya giriş"], ["mal-kabul", "Satın alma mal kabul"], ["rezervasyon", "Rezervasyon"], ["sayim", "Sayım düzeltmesi"], ["adina", "Personel adına tüketim / iade"]].map(([k, l]) =>
        <Btn key={k} kucuk tur={tur === k ? "ana" : "gri"} onClick={() => setTur(k)}>{l}</Btn>)}
    </div>
    {!acikDepolar.length ? <Mesaj m={{ tur: "uyari", metin: "Açılışı yapılmış depo yok. Önce Açılış Sayımı." }} /> :
      <div style={sKart}>{tur === "teslim" ? <TeslimFormu {...{ acikDepolar, urunler, personeller, baslangic }} /> : tur === "giris" ? <GirisFormu {...{ acikDepolar, urunler }} />
        : tur === "mal-kabul" ? <MalKabulFormu {...{ acikDepolar, urunler, Y, baslangic }} /> : tur === "rezervasyon" ? <RezervasyonFormu {...{ acikDepolar, urunler, personeller }} />
          : tur === "sayim" ? <SayimFormu {...{ acikDepolar, urunler, personeller }} /> : <AdinaFormu {...{ urunler, personeller }} />}</div>}
  </div>;
}
function DepoSec({ depolar, deger, onSec }) { return <select value={deger || ""} onChange={(e) => onSec(Number(e.target.value) || "")} style={sInput}><option value="">— depo —</option>{depolar.map((d) => <option key={d.id} value={d.id}>{d.kod} · {d.ad} ({d.firma})</option>)}</select>; }
function PersonelSec({ personeller, deger, onSec }) {
  const [ara, setAra] = useState("");
  const l = personeller.filter((p) => !ara || p.ad_soyad.toLocaleUpperCase("tr").includes(ara.toLocaleUpperCase("tr")));
  return <div style={{ display: "flex", gap: 6 }}><input placeholder="Ara…" value={ara} onChange={(e) => setAra(e.target.value)} style={{ ...sInput, width: 90, flex: "0 0 90px" }} />
    <select value={deger || ""} onChange={(e) => onSec(Number(e.target.value) || "")} style={sInput}><option value="">— personel —</option>{l.map((p) => <option key={p.id} value={p.id}>{p.ad_soyad} · {p.firma}{p.bolge ? ` · ${p.bolge}` : ""}</option>)}</select></div>;
}
function useFormGonder(yol, sifirla) {
  const islem = useIslem();
  const [k, kYenile] = useAnahtar();
  const gonder = (govde, basariMetni) => islem.calistir(async () => {
    const j = await api(yol, { method: "POST", body: govde, anahtar: k });
    kYenile(); sifirla && sifirla(j);
    islem.setMesaj({ tur: "basari", metin: (j.tekrar ? "Bu işlem daha önce kaydedilmişti (tekrar gönderim) — ikinci kez yazılmadı. " : "") + (typeof basariMetni === "function" ? basariMetni(j) : basariMetni) });
    return j;
  });
  return { ...islem, gonder };
}
function Ozet({ satirlar }) { return <div style={{ background: "#f8fafc", border: "1px dashed #94a3b8", borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 10 }}>{satirlar.map((s, i) => <div key={i}>{s}</div>)}</div>; }

function TeslimFormu({ acikDepolar, urunler, personeller, baslangic }) {
  const [f, setF] = useState({ depo_id: acikDepolar[0]?.id, personel_id: baslangic?.personel_id || "", aciklama: baslangic?.aciklama || "", saha_kodu: baslangic?.saha_kodu || "", talep_id: baslangic?.talep_id || "" });
  const [kalemler, setKalemler] = useState(baslangic?.kalemler?.length ? baslangic.kalemler : [bosKalem()]);
  const [rez, setRez] = useState([]);
  const [teyit, setTeyit] = useState(false);
  useEffect(() => { api("/malzeme/stok/rezervasyonlar").then((j) => setRez(j.rows || [])).catch(() => {}); }, []);
  const g = useFormGonder("/malzeme/stok/teslim", () => { setKalemler([bosKalem()]); setTeyit(false); setF((x) => ({ ...x, aciklama: "", saha_kodu: "" })); });
  const kal = kalemGovdesi(kalemler);
  const per = personeller.find((p) => p.id === f.personel_id);
  return <div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 10 }}>
      <Alan etiket="Depo"><DepoSec depolar={acikDepolar} deger={f.depo_id} onSec={(v) => setF({ ...f, depo_id: v })} /></Alan>
      <Alan etiket="Teslim alan personel"><PersonelSec personeller={personeller} deger={f.personel_id} onSec={(v) => setF({ ...f, personel_id: v })} /></Alan>
    </div>
    <span style={sEtiket}>Kalemler (kısmi teslim için yalnız verilen miktarı yazın)</span>
    <KalemSatirlari kalemler={kalemler} setKalemler={setKalemler} urunler={urunler} rezervasyonlar={rez.filter((r) => !f.personel_id || !r.personel_id || r.personel_id === f.personel_id)} />
    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 10 }}>
      <Alan etiket="Saha (isteğe bağlı, bilgi)"><SahaSecici deger={f.saha_kodu} onSec={(v) => setF({ ...f, saha_kodu: v })} /></Alan>
      <Alan etiket="Açıklama / tutanak"><input value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} style={sInput} /></Alan>
    </div>
    {per && kal.length > 0 && <Ozet satirlar={[`${per.ad_soyad} kişisine teslim edilecek (depodan hemen düşer, personelde hemen kullanılabilir):`,
      ...kal.map((x) => { const u = urunler.find((y) => y.id === x.urun_id); return `• ${u?.ad}: ${x.miktar} ${x.birim || u?.temel_birim}${x.rezervasyon_id ? ` (rezervasyon #${x.rezervasyon_id}'dan)` : ""}`; })]} />}
    <label style={{ display: "flex", gap: 8, fontSize: 13, marginBottom: 10 }}><input type="checkbox" checked={teyit} onChange={(e) => setTeyit(e.target.checked)} /> Malzeme personele fiziksel olarak teslim edildi.</label>
    <Mesaj m={g.mesaj} onKapat={() => g.setMesaj(null)} />
    <Btn onClick={() => g.gonder({ depo_id: f.depo_id, personel_id: f.personel_id, kalemler: kal, aciklama: f.aciklama, saha_kodu: f.saha_kodu || undefined, talep_id: f.talep_id || undefined }, (j) => `Teslim kaydedildi: ${j.personel?.ad_soyad}.`)}
      disabled={g.mesgul || !f.depo_id || !f.personel_id || !kal.length || !teyit}>{g.mesgul ? "Kaydediliyor…" : "Teslimi kaydet"}</Btn>
  </div>;
}
function GirisFormu({ acikDepolar, urunler }) {
  const [f, setF] = useState({ depo_id: acikDepolar[0]?.id, aciklama: "", belge_no: "", tarih: bugun() });
  const [kalemler, setKalemler] = useState([bosKalem()]);
  const g = useFormGonder("/malzeme/stok/giris", () => { setKalemler([bosKalem()]); setF((x) => ({ ...x, aciklama: "", belge_no: "" })); });
  const kal = kalemGovdesi(kalemler);
  return <div>
    <Mesaj m={{ tur: "bilgi", metin: "Satın alma talebine bağlı mallar için 'Satın alma mal kabul' kullanın. Bu form talep dışı girişler içindir (ör. Huawei'nin verdiği malzeme)." }} />
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
      <Alan etiket="Depo"><DepoSec depolar={acikDepolar} deger={f.depo_id} onSec={(v) => setF({ ...f, depo_id: v })} /></Alan>
      <Alan etiket="İrsaliye / belge no"><input value={f.belge_no} onChange={(e) => setF({ ...f, belge_no: e.target.value })} style={sInput} /></Alan>
      <Alan etiket="Tarih"><input type="date" max={bugun()} value={f.tarih} onChange={(e) => setF({ ...f, tarih: e.target.value })} style={sInput} /></Alan>
    </div>
    <KalemSatirlari kalemler={kalemler} setKalemler={setKalemler} urunler={urunler} />
    <Alan etiket="Açıklama — kaynak (zorunlu)" style={{ marginTop: 10 }}><input value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} style={sInput} /></Alan>
    <Mesaj m={g.mesaj} onKapat={() => g.setMesaj(null)} />
    <Btn onClick={() => g.gonder({ ...f, kalemler: kal }, "Depoya giriş kaydedildi.")} disabled={g.mesgul || !f.depo_id || !kal.length || !f.aciklama.trim()}>{g.mesgul ? "Kaydediliyor…" : "Girişi kaydet"}</Btn>
  </div>;
}
function MalKabulFormu({ acikDepolar, urunler, Y, baslangic }) {
  const [talepId, setTalepId] = useState(baslangic?.talep_id || "");
  const [veri, setVeri] = useState(null);
  const [miktar, setMiktar] = useState({}); // kalem_id → { urun_id, miktar, birim }
  const [f, setF] = useState({ depo_id: acikDepolar[0]?.id, belge_no: "", fazla_gerekce: "" });
  const yukleIslem = useIslem();
  const yukle = (id) => yukleIslem.calistir(async () => { const j = await api(`/malzeme/stok/kabul/${Number(id)}`); setVeri(j); setMiktar({}); });
  useEffect(() => { if (baslangic?.talep_id) yukle(baslangic.talep_id); }, [baslangic?.talep_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const g = useFormGonder("/malzeme/stok/mal-kabul", (j) => { setVeri((v) => ({ ...v, kalemler: j.kalemler })); setMiktar({}); });
  const kal = Object.entries(miktar).filter(([, v]) => String(v.miktar || "").trim()).map(([id, v]) => ({ talep_kalem_id: Number(id), urun_id: v.urun_id || undefined, miktar: String(v.miktar).trim(), birim: v.birim || undefined }));
  return <div>
    <div style={{ display: "flex", gap: 8, alignItems: "end", marginBottom: 10 }}>
      <Alan etiket="Satın alma talebi no (MT kaydının kimliği)" style={{ marginBottom: 0, flex: 1 }}><input value={talepId} onChange={(e) => setTalepId(e.target.value.replace(/\D/g, ""))} placeholder="ör. 412" style={sInput} /></Alan>
      <Btn onClick={() => yukle(talepId)} disabled={!talepId || yukleIslem.mesgul}>Getir</Btn>
    </div>
    <Mesaj m={yukleIslem.mesaj} />
    {veri && <>
      <div style={{ fontSize: 13, marginBottom: 8 }}><b>{veri.talep.talep_no}</b> · durum <Rozet metin={veri.talep.durum} /> {!["SATINALINACAK", "DEPODA"].includes(veri.talep.durum) && <span style={{ color: "#b91c1c" }}> — satın alma onayı tamamlanmadan mal kabul yapılamaz</span>}</div>
      <Tablo kolonlar={[{ b: "Kalem", r: (k) => <span>{k.malzeme_adi}<div style={{ fontSize: 11, color: "#64748b" }}>{k.temin_turu || ""}</div></span> },
        { b: "Sipariş", r: (k) => `${sayi(k.miktar)} ${k.birim}${k.siparis_temel != null && k.birim !== k.temel_birim ? ` = ${sayi(k.siparis_temel)} ${k.temel_birim}` : ""}` },
        { b: "Kabul edilen", r: (k) => `${sayi(k.kabul_edilen)} ${k.temel_birim || ""}`, sayi: 1 }, { b: "Kalan", r: (k) => k.kalan == null ? "—" : `${sayi(k.kalan)} ${k.temel_birim}`, sayi: 1 },
        { b: "Ürün", r: (k) => k.urun_id ? <span style={{ fontSize: 12 }}>{k.urun_ad}</span> : <UrunSecici urunler={urunler} deger={miktar[k.id]?.urun_id} onSec={(v) => setMiktar((m) => ({ ...m, [k.id]: { ...(m[k.id] || {}), urun_id: v } }))} /> },
        { b: "Bu teslimde gelen", r: (k) => { const u = urunler.find((y) => y.id === (k.urun_id || miktar[k.id]?.urun_id)); return <div style={{ display: "flex", gap: 4, minWidth: 180 }}>
          <input inputMode="decimal" value={miktar[k.id]?.miktar || ""} onChange={(e) => setMiktar((m) => ({ ...m, [k.id]: { ...(m[k.id] || {}), miktar: e.target.value } }))} style={{ ...sInput, width: 80 }} />
          <BirimSecici urun={u} deger={miktar[k.id]?.birim} onSec={(v) => setMiktar((m) => ({ ...m, [k.id]: { ...(m[k.id] || {}), birim: v } }))} /></div>; } }]} satirlar={veri.kalemler} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" + (Y.onay ? " 1.5fr" : ""), gap: 10, marginTop: 10 }}>
        <Alan etiket="Teslim alan depo"><DepoSec depolar={acikDepolar} deger={f.depo_id} onSec={(v) => setF({ ...f, depo_id: v })} /></Alan>
        <Alan etiket="İrsaliye no"><input value={f.belge_no} onChange={(e) => setF({ ...f, belge_no: e.target.value })} style={sInput} /></Alan>
        {Y.onay && <Alan etiket="Sipariş aşımı gerekçesi (yalnız yönetici, gerekirse)"><input value={f.fazla_gerekce} onChange={(e) => setF({ ...f, fazla_gerekce: e.target.value })} style={sInput} /></Alan>}
      </div>
      <Mesaj m={g.mesaj} onKapat={() => g.setMesaj(null)} />
      <Btn tur="yesil" onClick={() => g.gonder({ talep_id: veri.talep.id, depo_id: f.depo_id, belge_no: f.belge_no, fazla_gerekce: f.fazla_gerekce || undefined, kalemler: kal }, "Mal kabul kaydedildi; stok arttı.")}
        disabled={g.mesgul || !kal.length || !f.depo_id}>{g.mesgul ? "Kaydediliyor…" : "Mal kabulü kaydet"}</Btn>
    </>}
  </div>;
}
function RezervasyonFormu({ acikDepolar, urunler, personeller }) {
  const [f, setF] = useState({ depo_id: acikDepolar[0]?.id, urun_id: null, miktar: "", birim: "", personel_id: "", aciklama: "" });
  const g = useFormGonder("/malzeme/stok/rezervasyon", () => setF((x) => ({ ...x, miktar: "", aciklama: "" })));
  const u = urunler.find((y) => y.id === f.urun_id);
  return <div>
    <Mesaj m={{ tur: "bilgi", metin: "Rezervasyon fiziksel çıkış değildir: malzeme depoda kalır ama başka teslime kullanılamaz. Teslimde 'rezervasyondan' seçilir; depodan ikinci kez düşmez." }} />
    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
      <Alan etiket="Depo"><DepoSec depolar={acikDepolar} deger={f.depo_id} onSec={(v) => setF({ ...f, depo_id: v })} /></Alan>
      <Alan etiket="Ürün"><UrunSecici urunler={urunler} deger={f.urun_id} onSec={(v) => setF({ ...f, urun_id: v, birim: "" })} /></Alan>
      <Alan etiket="Miktar"><div style={{ display: "flex", gap: 6 }}><input inputMode="decimal" value={f.miktar} onChange={(e) => setF({ ...f, miktar: e.target.value })} style={sInput} /><BirimSecici urun={u} deger={f.birim} onSec={(v) => setF({ ...f, birim: v })} /></div></Alan>
      <Alan etiket="Kimin için (isteğe bağlı)"><PersonelSec personeller={personeller} deger={f.personel_id} onSec={(v) => setF({ ...f, personel_id: v })} /></Alan>
    </div>
    <Alan etiket="Açıklama"><input value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} style={sInput} /></Alan>
    <Mesaj m={g.mesaj} onKapat={() => g.setMesaj(null)} />
    <Btn onClick={() => g.gonder({ ...f, personel_id: f.personel_id || undefined, birim: f.birim || undefined }, (j) => `Rezervasyon #${j.rezervasyon?.id} açıldı.`)} disabled={g.mesgul || !f.urun_id || !f.miktar || !f.depo_id}>{g.mesgul ? "Kaydediliyor…" : "Rezerve et"}</Btn>
  </div>;
}
function SayimFormu({ acikDepolar, urunler, personeller }) {
  const [f, setF] = useState({ lokasyon_tip: "DEPO", depo_id: acikDepolar[0]?.id, personel_id: "", urun_id: null, sayilan_miktar: "", birim: "", gerekce: "", sayim_tarihi: bugun() });
  const g = useFormGonder("/malzeme/stok/sayim-duzeltme", () => setF((x) => ({ ...x, sayilan_miktar: "", gerekce: "" })));
  const u = urunler.find((y) => y.id === f.urun_id);
  return <div>
    <Mesaj m={{ tur: "bilgi", metin: "Sayılan fiziksel miktarı girin; kayıtla fark varsa gerekçeli düzeltme hareketi oluşur. Personel sayımında elindeki toplam (iade bekleyen dahil) sayılır." }} />
    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
      <Alan etiket="Nerede"><select value={f.lokasyon_tip} onChange={(e) => setF({ ...f, lokasyon_tip: e.target.value })} style={sInput}><option value="DEPO">Depo</option><option value="PERSONEL">Personel</option></select></Alan>
      {f.lokasyon_tip === "DEPO" ? <Alan etiket="Depo"><DepoSec depolar={acikDepolar} deger={f.depo_id} onSec={(v) => setF({ ...f, depo_id: v })} /></Alan>
        : <Alan etiket="Personel"><PersonelSec personeller={personeller} deger={f.personel_id} onSec={(v) => setF({ ...f, personel_id: v })} /></Alan>}
      <Alan etiket="Ürün"><UrunSecici urunler={urunler} deger={f.urun_id} onSec={(v) => setF({ ...f, urun_id: v, birim: "" })} /></Alan>
      <Alan etiket="Sayılan miktar (yoksa 0)"><div style={{ display: "flex", gap: 6 }}><input inputMode="decimal" value={f.sayilan_miktar} onChange={(e) => setF({ ...f, sayilan_miktar: e.target.value })} style={sInput} /><BirimSecici urun={u} deger={f.birim} onSec={(v) => setF({ ...f, birim: v })} /></div></Alan>
      <Alan etiket="Sayım tarihi"><input type="date" max={bugun()} value={f.sayim_tarihi} onChange={(e) => setF({ ...f, sayim_tarihi: e.target.value })} style={sInput} /></Alan>
      <Alan etiket="Gerekçe (zorunlu)"><input value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} style={sInput} /></Alan>
    </div>
    <Mesaj m={g.mesaj} onKapat={() => g.setMesaj(null)} />
    <Btn onClick={() => g.gonder({ ...f, birim: f.birim || undefined }, (j) => j.fark ? `Düzeltme kaydedildi (fark ${sayi(j.fark)}).` : "Fark yok; hareket oluşmadı.")} disabled={g.mesgul || !f.urun_id || f.sayilan_miktar === "" || !f.gerekce.trim()}>{g.mesgul ? "Kaydediliyor…" : "Sayımı işle"}</Btn>
  </div>;
}
function AdinaFormu({ urunler, personeller }) {
  const [f, setF] = useState({ tur: "tuketim", personel_id: "", urun_id: null, miktar: "", birim: "", saha_kodu: "", tarih: bugun(), aciklama: "" });
  const g = useFormGonder(f.tur === "tuketim" ? "/malzeme/stok/tuketim" : "/malzeme/stok/iade", () => setF((x) => ({ ...x, miktar: "", aciklama: "" })));
  const u = urunler.find((y) => y.id === f.urun_id);
  return <div>
    <Mesaj m={{ tur: "bilgi", metin: "Kağıt formdan giriş içindir: personelin kendi stoğundan düşer, açıklama zorunlu, kayıtta işlemi yapan olarak siz görünürsünüz." }} />
    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
      <Alan etiket="İşlem"><select value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })} style={sInput}><option value="tuketim">Sahada tüketim</option><option value="iade">Depoya iade talebi</option></select></Alan>
      <Alan etiket="Personel"><PersonelSec personeller={personeller} deger={f.personel_id} onSec={(v) => setF({ ...f, personel_id: v })} /></Alan>
      <Alan etiket="Ürün"><UrunSecici urunler={urunler} deger={f.urun_id} yalnizSarf={f.tur === "tuketim"} onSec={(v) => setF({ ...f, urun_id: v, birim: "" })} /></Alan>
      <Alan etiket="Miktar"><div style={{ display: "flex", gap: 6 }}><input inputMode="decimal" value={f.miktar} onChange={(e) => setF({ ...f, miktar: e.target.value })} style={sInput} /><BirimSecici urun={u} deger={f.birim} onSec={(v) => setF({ ...f, birim: v })} /></div></Alan>
      {f.tur === "tuketim" && <><Alan etiket="Saha"><SahaSecici deger={f.saha_kodu} onSec={(v) => setF({ ...f, saha_kodu: v })} /></Alan>
        <Alan etiket="Tarih"><input type="date" max={bugun()} value={f.tarih} onChange={(e) => setF({ ...f, tarih: e.target.value })} style={sInput} /></Alan></>}
    </div>
    <Alan etiket="Açıklama (zorunlu)"><input value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} style={sInput} /></Alan>
    <Mesaj m={g.mesaj} onKapat={() => g.setMesaj(null)} />
    <Btn onClick={() => g.gonder({ ...f, birim: f.birim || undefined }, f.tur === "tuketim" ? "Tüketim kaydedildi." : "İade talebi açıldı (Bekleyenler'den onaylayın).")}
      disabled={g.mesgul || !f.personel_id || !f.urun_id || !f.miktar || !f.aciklama.trim() || (f.tur === "tuketim" && !f.saha_kodu)}>{g.mesgul ? "Kaydediliyor…" : "Kaydet"}</Btn>
  </div>;
}

// Excel / CSV satırlarını okur (ilk sayfa, başlıklar küçük harfe çevrilir)
function excelOku(dosya) {
  return new Promise((ok, red) => {
    const fr = new FileReader();
    fr.onload = () => { try { const wb = XLSX.read(fr.result, { type: "array" }); const ws = wb.Sheets[wb.SheetNames[0]];
      const ham = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
      ok(ham.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).toLocaleLowerCase("tr").trim().replace(/\s*\(.*\)$/, "").replace(/\s+/g, "_"), typeof v === "string" ? v.trim() : v])))); }
    catch (e) { red(new Error("Dosya okunamadı: " + e.message)); } };
    fr.onerror = () => red(new Error("Dosya okunamadı")); fr.readAsArrayBuffer(dosya);
  });
}
function sablonIndir(ad, basliklar, ornek) {
  const ws = XLSX.utils.aoa_to_sheet([basliklar, ...ornek]); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Sayfa1"); XLSX.writeFile(wb, ad);
}

function UrunEkrani({ urunler, tazele, ayar }) {
  const [f, setF] = useState({ kod: "", ad: "", temel_birim: "Metre", tur: "SARF", kategori: "", min_stok: "" });
  const g = useFormGonder("/malzeme/stok/urun", () => { setF({ kod: "", ad: "", temel_birim: f.temel_birim, tur: "SARF", kategori: "", min_stok: "" }); tazele(); });
  const [don, setDon] = useState(null); // { urun, birim, katsayi }
  const gd = useIslem();
  const [esik, setEsik] = useState(null);
  const [toplu, setToplu] = useState(null); // { satirlar, onizleme }
  const gt = useIslem();
  const [kt, ktYenile] = useAnahtar();
  return <div>
    <div style={sKart}>
      <div style={{ fontWeight: 800, color: LAC, marginBottom: 8 }}>Yeni ürün kartı</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2.5fr 1fr 1fr 1fr 1fr", gap: 8 }}>
        <Alan etiket="Kod"><input value={f.kod} onChange={(e) => setF({ ...f, kod: e.target.value.toUpperCase() })} style={sInput} /></Alan>
        <Alan etiket="Ad"><input value={f.ad} onChange={(e) => setF({ ...f, ad: e.target.value })} style={sInput} /></Alan>
        <Alan etiket="Temel birim"><select value={f.temel_birim} onChange={(e) => setF({ ...f, temel_birim: e.target.value })} style={sInput}>{ayar.birimler.map((b) => <option key={b}>{b}</option>)}</select></Alan>
        <Alan etiket="Tür"><select value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })} style={sInput}><option value="SARF">Sarf (tüketilir)</option><option value="EKIPMAN">Ekipman (iade edilir)</option></select></Alan>
        <Alan etiket="Kategori"><input value={f.kategori} onChange={(e) => setF({ ...f, kategori: e.target.value })} style={sInput} /></Alan>
        <Alan etiket="Düşük stok eşiği"><input inputMode="decimal" value={f.min_stok} onChange={(e) => setF({ ...f, min_stok: e.target.value })} style={sInput} /></Alan>
      </div>
      <Mesaj m={g.mesaj} onKapat={() => g.setMesaj(null)} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Btn onClick={() => g.gonder(f, "Ürün eklendi.")} disabled={g.mesgul || !f.kod || !f.ad}>Ürünü ekle</Btn>
        <label style={{ ...{ padding: "9px 16px", background: "#dbeafe", color: "#1d4ed8", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" } }}>
          Excel'den toplu ekle…<input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={async (e) => {
            const d = e.target.files?.[0]; e.target.value = ""; if (!d) return;
            gt.calistir(async () => { const satirlar = (await excelOku(d)).map((r) => ({ kod: r.kod, ad: r.ad, temel_birim: r.temel_birim, tur: r.tur || "SARF", kategori: r.kategori, min_stok: r.min_stok || undefined }));
              const j = await api("/malzeme/stok/urun/toplu", { method: "POST", body: { urunler: satirlar, uygula: false } }); setToplu({ satirlar, onizleme: j }); ktYenile(); });
          }} /></label>
        <Btn tur="gri" onClick={() => sablonIndir("urun_sablonu.xlsx", ["kod", "ad", "temel_birim", "tur", "kategori", "min_stok"], [["KBL6", "6 mm² topraklama kablosu", "Metre", "SARF", "Kablo", "50"]])}>Şablon indir</Btn>
      </div>
      <Mesaj m={gt.mesaj} onKapat={() => gt.setMesaj(null)} />
    </div>
    {toplu && <div style={sKart}>
      <div style={{ fontWeight: 800, color: LAC, marginBottom: 6 }}>Toplu ekleme önizlemesi — {toplu.satirlar.length} satır, {toplu.onizleme.hata_sayisi} hatalı. Henüz HİÇBİR ŞEY kaydedilmedi.</div>
      <Tablo kolonlar={[{ b: "#", a: "satir" }, { b: "Kod", a: "kod" }, { b: "Ad", a: "ad" }, { b: "Birim", a: "temel_birim" }, { b: "Hata", r: (s) => s.hatalar.length ? <span style={{ color: "#b91c1c" }}>{s.hatalar.join("; ")}</span> : <span style={{ color: "#065f46" }}>✓</span> }]} satirlar={toplu.onizleme.satirlar} />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Btn tur="yesil" disabled={gt.mesgul || toplu.onizleme.hata_sayisi > 0} onClick={() => gt.calistir(async () => {
          if (!window.confirm(`${toplu.satirlar.length} ürün kartı eklenecek. Onaylıyor musunuz?`)) return;
          const j = await api("/malzeme/stok/urun/toplu", { method: "POST", body: { urunler: toplu.satirlar, uygula: true }, anahtar: kt });
          ktYenile(); setToplu(null); gt.setMesaj({ tur: "basari", metin: `${j.eklenen} ürün eklendi.` }); tazele(); })}>Onaylıyorum, ekle</Btn>
        <Btn tur="gri" onClick={() => setToplu(null)}>Vazgeç</Btn>
      </div></div>}
    <Tablo kolonlar={[{ b: "Kod", a: "kod" }, { b: "Ad", a: "ad" }, { b: "Birim", a: "temel_birim" }, { b: "Tür", r: (u) => u.tur === "EKIPMAN" ? "Ekipman" : "Sarf" }, { b: "Kategori", a: "kategori" },
      { b: "Dönüşümler", r: (u) => (u.donusumler || []).map((d) => `1 ${d.birim} = ${sayi(d.katsayi)} ${u.temel_birim}`).join(", ") || "—" }, { b: "Düşük stok eşiği", a: "min_stok", sayi: 1 },
      { b: "Durum", r: (u) => u.aktif ? "Aktif" : <span style={{ color: "#9ca3af" }}>Pasif</span> },
      { b: "", r: (u) => <div style={{ display: "flex", gap: 4 }}><Btn kucuk tur="gri" onClick={() => setDon({ urun: u, birim: "Kutu", katsayi: "" })}>+ Dönüşüm</Btn><Btn kucuk tur="gri" onClick={() => setEsik({ urun: u, min_stok: u.min_stok ?? "", aktif: u.aktif })}>Düzenle</Btn></div> }]} satirlar={urunler} />
    {don && <Modal baslik={`Birim dönüşümü · ${don.urun.ad}`} onKapat={() => setDon(null)}>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>Tanımlanan dönüşüm geçmiş hareketleri korumak için sonradan değiştirilemez.</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>1 <select value={don.birim} onChange={(e) => setDon({ ...don, birim: e.target.value })} style={{ ...sInput, width: 110 }}>{ayar.birimler.filter((b) => b !== don.urun.temel_birim).map((b) => <option key={b}>{b}</option>)}</select>
        = <input inputMode="decimal" value={don.katsayi} onChange={(e) => setDon({ ...don, katsayi: e.target.value })} style={{ ...sInput, width: 100 }} /> {don.urun.temel_birim}</div>
      <Mesaj m={gd.mesaj} />
      <Btn style={{ marginTop: 10 }} disabled={gd.mesgul || !don.katsayi} onClick={() => gd.calistir(async () => { await api(`/malzeme/stok/urun/${don.urun.id}/donusum`, { method: "POST", body: { birim: don.birim, katsayi: don.katsayi }, anahtar: yeniAnahtar() }); setDon(null); tazele(); })}>Kaydet</Btn>
    </Modal>}
    {esik && <Modal baslik={`Ürün · ${esik.urun.ad}`} onKapat={() => setEsik(null)}>
      <Alan etiket={`Düşük stok eşiği (${esik.urun.temel_birim}, boş = uyarı yok)`}><input inputMode="decimal" value={esik.min_stok} onChange={(e) => setEsik({ ...esik, min_stok: e.target.value })} style={sInput} /></Alan>
      <label style={{ display: "flex", gap: 8, fontSize: 13, marginBottom: 10 }}><input type="checkbox" checked={esik.aktif} onChange={(e) => setEsik({ ...esik, aktif: e.target.checked })} /> Aktif (pasif ürün yeni harekette seçilemez)</label>
      <Mesaj m={gd.mesaj} />
      <Btn disabled={gd.mesgul} onClick={() => gd.calistir(async () => { await api(`/malzeme/stok/urun/${esik.urun.id}`, { method: "PUT", body: { min_stok: esik.min_stok === "" ? null : esik.min_stok, aktif: esik.aktif }, anahtar: yeniAnahtar() }); setEsik(null); tazele(); })}>Kaydet</Btn>
    </Modal>}
  </div>;
}

function AcilisEkrani({ ayar, Y, tazele }) {
  const [liste, setListe] = useState([]);
  const [f, setF] = useState({ depo_id: ayar.depolar.find((d) => !d.acilis_id)?.id || "", sayim_tarihi: bugun(), aciklama: "" });
  const [satirlar, setSatirlar] = useState(null);
  const [dosyaAdi, setDosyaAdi] = useState("");
  const [onizleme, setOnizleme] = useState(null);
  const [teyit, setTeyit] = useState(false);
  const islem = useIslem();
  const [k, kYenile] = useAnahtar();
  const [ku, kuYenile] = useAnahtar();
  const yukle = useCallback(() => api("/malzeme/stok/acilis").then((j) => setListe(j.rows || [])).catch(() => {}), []);
  useEffect(() => { yukle(); }, [yukle]);
  const kapaliDepolar = ayar.depolar.filter((d) => d.aktif && !d.acilis_id);
  const onizle = () => islem.calistir(async () => {
    const j = await api("/malzeme/stok/acilis/onizleme", { method: "POST", body: { ...f, kaynak_dosya: dosyaAdi, satirlar }, anahtar: k });
    kYenile(); setOnizleme(j); setTeyit(false); yukle();
  });
  const uygula = () => islem.calistir(async () => {
    const j = await api(`/malzeme/stok/acilis/${onizleme.acilis.id}/uygula`, { method: "POST", body: { onay: true }, anahtar: ku });
    kuYenile(); islem.setMesaj({ tur: "basari", metin: `Açılış #${j.acilis_id} uygulandı: ${j.hareket_sayisi} açılış hareketi. Depo artık hareket alabilir.` }); setOnizleme(null); setSatirlar(null); yukle(); tazele();
  });
  return <div>
    <div style={sKart}>
      <div style={{ fontWeight: 800, color: LAC, marginBottom: 6 }}>Açılış sayımı (depo başına bir kez)</div>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>1) Depoyu ve personel üzerindekileri fiziksel olarak sayın · 2) Şablonu doldurun (urun_kodu, miktar, birim, personel_email — boş = depo) · 3) Önizleyin: hata raporu çıkar, hiçbir şey kaydedilmez · 4) Yönetici onaylar ve uygular. Uygulanmış açılış tekrar uygulanamaz; aynı personel iki açılışta sayılamaz. Eski kayıt tahmini otomatik stok sayılmaz.</div>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 2fr", gap: 10 }}>
        <Alan etiket="Depo"><DepoSec depolar={kapaliDepolar} deger={f.depo_id} onSec={(v) => setF({ ...f, depo_id: v })} /></Alan>
        <Alan etiket="Sayım tarihi"><input type="date" max={bugun()} value={f.sayim_tarihi} onChange={(e) => setF({ ...f, sayim_tarihi: e.target.value })} style={sInput} /></Alan>
        <Alan etiket="Açıklama (sayımı yapanlar)"><input value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} style={sInput} /></Alan>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ padding: "9px 16px", background: "#dbeafe", color: "#1d4ed8", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Sayım dosyası seç…
          <input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={async (e) => { const d = e.target.files?.[0]; e.target.value = ""; if (!d) return;
            islem.calistir(async () => { const r = await excelOku(d); setSatirlar(r.filter((x) => x.urun_kodu || x.miktar).map((x) => ({ urun_kodu: x.urun_kodu, miktar: x.miktar, birim: x.birim || undefined, personel_email: x.personel_email || undefined }))); setDosyaAdi(d.name); setOnizleme(null); }); }} /></label>
        <Btn tur="gri" onClick={() => sablonIndir("acilis_sayim_sablonu.xlsx", ["urun_kodu", "miktar", "birim", "personel_email"], [["KBL6", "100", "Metre", ""], ["KBL6", "12,5", "Metre", "ahmet@simsektel.com"]])}>Şablon indir</Btn>
        {satirlar && <span style={{ fontSize: 13 }}>{dosyaAdi}: <b>{satirlar.length}</b> satır okundu</span>}
        <Btn onClick={onizle} disabled={islem.mesgul || !satirlar?.length || !f.depo_id}>Önizle (kaydetmez)</Btn>
      </div>
      <Mesaj m={islem.mesaj} onKapat={() => islem.setMesaj(null)} />
    </div>
    {onizleme && <div style={sKart}>
      <div style={{ fontWeight: 800, color: onizleme.acilis.hata_sayisi ? "#b91c1c" : "#065f46", marginBottom: 6 }}>Önizleme #{onizleme.acilis.id}: {onizleme.acilis.satir_sayisi} satır, {onizleme.acilis.hata_sayisi} hatalı — {onizleme.mesaj}</div>
      <Tablo kolonlar={[{ b: "#", a: "satir" }, { b: "Ürün", a: "urun" }, { b: "Lokasyon", a: "lokasyon" }, { b: "Miktar", r: (s) => s.miktar == null ? "—" : `${sayi(s.miktar)} ${s.birim}`, sayi: 1 },
        { b: "Durum", r: (s) => s.hatalar.length ? <span style={{ color: "#b91c1c" }}>{s.hatalar.join("; ")}</span> : <span style={{ color: "#065f46" }}>✓</span> }]} satirlar={onizleme.satirlar} satirStil={(s) => s.hatalar.length ? { background: "#fef2f2" } : undefined} />
      {onizleme.acilis.hata_sayisi === 0 && (Y.onay ? <div style={{ marginTop: 10 }}>
        <label style={{ display: "flex", gap: 8, fontSize: 13, marginBottom: 10 }}><input type="checkbox" checked={teyit} onChange={(e) => setTeyit(e.target.checked)} /> Sayımı kontrol ettim; bu miktarlar {f.sayim_tarihi} tarihli fiziksel sayımdır. Açılış uygulandıktan sonra geri alınamaz (yalnız ters kayıtla düzeltilir).</label>
        <Btn tur="yesil" onClick={uygula} disabled={islem.mesgul || !teyit}>{islem.mesgul ? "Uygulanıyor…" : "Açılışı onayla ve uygula"}</Btn></div>
        : <Mesaj m={{ tur: "bilgi", metin: "Önizleme hatasız. Uygulama için yönetici onayı gerekir (Açılış Sayımı listesinden)." }} />)}
    </div>}
    <div style={{ fontWeight: 800, color: LAC, margin: "8px 0" }}>Açılış kayıtları</div>
    <Tablo kolonlar={[{ b: "No", r: (s) => `#${s.id}` }, { b: "Depo", a: "depo_ad" }, { b: "Sayım", r: (s) => tarihTR(String(s.sayim_tarihi).slice(0, 10)) }, { b: "Durum", r: (s) => <Rozet metin={s.durum} renk={s.durum === "UYGULANDI" ? "#065f46" : s.durum === "IPTAL" ? "#6b7280" : "#92400e"} zemin={s.durum === "UYGULANDI" ? "#d1fae5" : s.durum === "IPTAL" ? "#f3f4f6" : "#fef3c7"} /> },
      { b: "Satır / hata", r: (s) => `${s.satir_sayisi ?? "—"} / ${s.hata_sayisi ?? "—"}` }, { b: "Hazırlayan", a: "olusturan_email" }, { b: "Onaylayan", r: (s) => s.onaylayan_email ? `${s.onaylayan_email} · ${zamanTR(s.onay_tarihi)}` : "—" },
      { b: "", r: (s) => s.durum === "TASLAK" ? <div style={{ display: "flex", gap: 4 }}>
        {Y.onay && s.hata_sayisi === 0 ? <Btn kucuk tur="yesil" onClick={async () => { const j = await api(`/malzeme/stok/acilis/${s.id}`).catch((e) => islem.setMesaj({ tur: "hata", metin: e.message }));
          if (j) setOnizleme({ acilis: j.acilis, mesaj: "Hata yok.", satirlar: j.satirlar.map((x) => ({ satir: x.satir_no, urun: x.kod ? `${x.kod} · ${x.urun_ad}` : null, lokasyon: x.personel_ad ? `Personel: ${x.personel_ad}` : "Depo", miktar: x.miktar, birim: x.temel_birim, hatalar: x.hata ? [x.hata] : [] })) }); setF((x) => ({ ...x, sayim_tarihi: String(s.sayim_tarihi).slice(0, 10) })); }}>İncele / onayla</Btn> : null}
        <Btn kucuk tur="gri" onClick={() => islem.calistir(async () => { await api(`/malzeme/stok/acilis/${s.id}/iptal`, { method: "POST", body: { aciklama: "Vazgeçildi" }, anahtar: yeniAnahtar() }); yukle(); })}>İptal</Btn></div> : null }]} satirlar={liste} />
  </div>;
}

function DepoEkrani({ ayar, tazele }) {
  const [f, setF] = useState({ kod: "", ad: "", firma: "ERC" });
  const g = useFormGonder("/malzeme/stok/depo", () => { setF({ kod: "", ad: "", firma: "ERC" }); tazele(); });
  return <div>
    <div style={sKart}><div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr auto", gap: 8, alignItems: "end" }}>
      <Alan etiket="Kod" style={{ marginBottom: 0 }}><input value={f.kod} onChange={(e) => setF({ ...f, kod: e.target.value.toUpperCase() })} style={sInput} /></Alan>
      <Alan etiket="Ad" style={{ marginBottom: 0 }}><input value={f.ad} onChange={(e) => setF({ ...f, ad: e.target.value })} style={sInput} /></Alan>
      <Alan etiket="Firma" style={{ marginBottom: 0 }}><select value={f.firma} onChange={(e) => setF({ ...f, firma: e.target.value })} style={sInput}><option>ERC</option><option>TEKNO</option></select></Alan>
      <Btn onClick={() => g.gonder(f, "Depo tanımlandı. Hareket için açılış sayımı gerekir.")} disabled={g.mesgul || !f.kod || !f.ad}>Depo ekle</Btn>
    </div><Mesaj m={g.mesaj} onKapat={() => g.setMesaj(null)} /></div>
    <Tablo kolonlar={[{ b: "Kod", a: "kod" }, { b: "Ad", a: "ad" }, { b: "Firma", a: "firma" }, { b: "Açılış", r: (d) => d.acilis_id ? `#${d.acilis_id} · ${tarihTR(String(d.acilis_tarihi).slice(0, 10))}` : <span style={{ color: "#92400e" }}>Açılış bekliyor</span> }]} satirlar={ayar.depolar} />
  </div>;
}

// ═══ PERSONEL: MALZEMELERİM ═════════════════════════════════════════════════════════════════════════════════════════
const TASLAK_ANAHTARI = (e) => `stok_taslak_${String(e || "").toLowerCase()}`;
export function StokBenimPanel({ currentUser, eskiIcerik, onDurum }) {
  const [v, setV] = useState(null);
  const [hata, setHata] = useState(null);
  const [form, setForm] = useState(null); // { tur: "tuketim"|"iade", urun, miktar, birim, saha_kodu, tarih, aciklama, anahtar, kontrol }
  const [gecmisAcik, setGecmisAcik] = useState(false);
  const islem = useIslem();
  const yukle = useCallback(async () => { try { setV(await api("/malzeme/stok/benim?limit=60")); setHata(null); } catch (e) { setHata(e.message); } }, []);
  useEffect(() => { yukle(); }, [yukle]);
  useEffect(() => { if (v && onDurum) onDurum(!!v.defter_acik); }, [v, onDurum]);
  // Yarım kalan form (bağlantı hatası / sayfa yenileme) telefonda / tarayıcıda saklanır
  useEffect(() => { try { const t = JSON.parse(localStorage.getItem(TASLAK_ANAHTARI(currentUser?.email)) || "null"); if (t && t.urun) setForm({ ...t, kontrol: false }); } catch { /* yok */ } }, [currentUser?.email]);
  useEffect(() => { try { if (form) localStorage.setItem(TASLAK_ANAHTARI(currentUser?.email), JSON.stringify(form)); else localStorage.removeItem(TASLAK_ANAHTARI(currentUser?.email)); } catch { /* yok */ } }, [form, currentUser?.email]);
  if (hata) return <Mesaj m={{ tur: "hata", metin: hata }} />;
  if (!v) return <div style={{ padding: 20, color: "#6b7280" }}>Yükleniyor…</div>;
  if (!v.defter_acik) return <div><Mesaj m={{ tur: "uyari", metin: "Malzeme stok sistemi yeni stok defterine geçiyor. Depo sayımı ve açılış onayından sonra üzerinizdeki malzemeler burada görünecek; bu arada malzeme hareketi (iade / sahaya çıkış) yapılamaz. Aşağıdaki liste eski kayıttır." }} />{eskiIcerik}</div>;
  const kaydet = () => islem.calistir(async () => {
    const govde = form.tur === "tuketim" ? { urun_id: form.urun.urun_id, miktar: form.miktar, birim: form.birim || undefined, saha_kodu: form.saha_kodu, tarih: form.tarih, aciklama: form.aciklama }
      : { urun_id: form.urun.urun_id, miktar: form.miktar, birim: form.birim || undefined, aciklama: form.aciklama };
    const j = await api(`/malzeme/stok/${form.tur === "tuketim" ? "tuketim" : "iade"}`, { method: "POST", body: govde, anahtar: form.anahtar });
    setForm(null);
    islem.setMesaj({ tur: "basari", metin: (j.tekrar ? "Bu kayıt daha önce alınmıştı (ikinci kez yazılmadı). " : "") + (form.tur === "tuketim" ? `${j.saha_kodu} sahasında ${sayi(j.miktar)} ${j.birim} kullanım kaydedildi. Üzerinizde kalan: ${sayi(j.kalan)} ${j.birim}.` : `İade talebi gönderildi. Depo teslim alıp onaylayınca üzerinizden düşer.`) });
    yukle();
  });
  const geriCek = (i) => islem.calistir(async () => { if (!window.confirm("İade talebi geri çekilsin mi? Miktar yeniden kullanılabilir olur.")) return; await api(`/malzeme/stok/iade/${i.id}/iptal`, { method: "POST", body: {}, anahtar: yeniAnahtar() }); yukle(); });
  const bekleyen = v.iadeler.filter((i) => i.durum === "BEKLIYOR");
  return <div>
    <Mesaj m={islem.mesaj} onKapat={() => islem.setMesaj(null)} />
    {v.stok.length === 0 && <div style={{ ...sKart, textAlign: "center", color: "#6b7280" }}>Üzerinizde kayıtlı malzeme yok.</div>}
    {v.stok.map((s) => <div key={s.urun_id} style={sKart}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}><div style={{ fontWeight: 800, color: "#111827" }}>{s.ad}</div><div style={{ fontSize: 11, color: "#9ca3af" }}>{s.kod}{s.tur === "EKIPMAN" ? " · ekipman (tüketilmez, iade edilir)" : ""}</div></div>
        <div style={{ textAlign: "right" }}><div style={{ fontSize: 20, fontWeight: 800, color: "#065f46" }}>{sayi(s.kullanilabilir)} <span style={{ fontSize: 12 }}>{s.temel_birim}</span></div><div style={{ fontSize: 11, color: "#6b7280" }}>kullanılabilir</div>
          {s.iade_bekleyen > 0 && <div style={{ fontSize: 11, color: "#92400e", marginTop: 2 }}>+ {sayi(s.iade_bekleyen)} iade onayı bekliyor</div>}</div>
      </div>
      {s.kullanilabilir > 0 && <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {s.tur !== "EKIPMAN" && <Btn style={{ flex: 1 }} onClick={() => setForm({ tur: "tuketim", urun: s, miktar: "", birim: s.temel_birim, saha_kodu: "", tarih: bugun(), aciklama: "", anahtar: yeniAnahtar(), kontrol: false })}>Sahada kullandım</Btn>}
        <Btn tur="gri" style={{ flex: 1 }} onClick={() => setForm({ tur: "iade", urun: s, miktar: String(s.kullanilabilir).replace(".", ","), birim: s.temel_birim, aciklama: "", anahtar: yeniAnahtar(), kontrol: false })}>Depoya iade et</Btn>
      </div>}
    </div>)}
    {bekleyen.length > 0 && <><div style={{ fontWeight: 800, color: LAC, margin: "14px 0 6px" }}>Bekleyen iadelerim</div>
      {bekleyen.map((i) => <div key={i.id} style={{ ...sKart, display: "flex", alignItems: "center", gap: 8 }}><div style={{ flex: 1, fontSize: 13 }}><b>{i.urun_ad}</b> · {sayi(i.miktar)} {i.temel_birim}<div style={{ fontSize: 11, color: "#6b7280" }}>{zamanTR(i.talep_tarihi)} · depo onayı bekleniyor</div></div><Btn kucuk tur="gri" onClick={() => geriCek(i)} disabled={islem.mesgul}>Geri çek</Btn></div>)}</>}
    <button onClick={() => setGecmisAcik((x) => !x)} style={{ background: "none", border: "none", color: LAC, fontWeight: 700, cursor: "pointer", margin: "10px 0" }}>{gecmisAcik ? "▾" : "▸"} İşlem geçmişim</button>
    {gecmisAcik && <Tablo kolonlar={[{ b: "Tarih", r: (h) => tarihTR(h.islem_tarihi) }, { b: "İşlem", a: "tur_ad" }, { b: "Malzeme", a: "urun_ad" }, { b: "Miktar", r: (h) => `${sayi(h.miktar)} ${h.temel_birim}`, sayi: 1 },
      { b: "Saha / not", r: (h) => [h.saha_kodu, h.aciklama].filter(Boolean).join(" · ") || "—" }]} satirlar={v.hareketler} satirStil={(h) => h.iptal_edildi ? { opacity: 0.5, textDecoration: "line-through" } : undefined} />}
    {form && <Modal baslik={form.tur === "tuketim" ? `Sahada kullandım · ${form.urun.ad}` : `Depoya iade · ${form.urun.ad}`} onKapat={() => !islem.mesgul && setForm(null)}>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>Üzerinizde kullanılabilir: <b>{sayi(form.urun.kullanilabilir)} {form.urun.temel_birim}</b></div>
      {form.tur === "tuketim" && <Alan etiket="Saha kodu"><SahaSecici kisisel deger={form.saha_kodu} onSec={(x) => setForm({ ...form, saha_kodu: x, kontrol: false })} /></Alan>}
      <Alan etiket={`Miktar (${form.urun.temel_birim}; virgüllü yazabilirsiniz: 12,5)`}><input inputMode="decimal" autoFocus value={form.miktar} onChange={(e) => setForm({ ...form, miktar: e.target.value, kontrol: false })} style={{ ...sInput, fontSize: 18 }} /></Alan>
      {form.tur === "tuketim" && <Alan etiket="Tarih"><input type="date" max={bugun()} value={form.tarih} onChange={(e) => setForm({ ...form, tarih: e.target.value, kontrol: false })} style={sInput} /></Alan>}
      <Alan etiket="Açıklama"><input value={form.aciklama} onChange={(e) => setForm({ ...form, aciklama: e.target.value })} placeholder={form.tur === "tuketim" ? "Ör. topraklama hattı" : "Ör. iş bitti, artan"} style={sInput} /></Alan>
      {form.kontrol && <Ozet satirlar={form.tur === "tuketim" ? [<b key="a">{form.saha_kodu}</b>, `sahasında ${form.miktar} ${form.urun.temel_birim} ${form.urun.ad} kullanıldı olarak kaydedilecek (${tarihTR(form.tarih)}).`]
        : [`${form.miktar} ${form.urun.temel_birim} ${form.urun.ad} için depoya iade talebi açılacak. Bu miktar onaylanana kadar kullanılamaz.`]} />}
      <Mesaj m={islem.mesaj} />
      {!form.kontrol ? <Btn style={{ width: "100%" }} disabled={!String(form.miktar).trim() || (form.tur === "tuketim" && !form.saha_kodu)} onClick={() => { islem.setMesaj(null); setForm({ ...form, kontrol: true }); }}>Kontrol et</Btn>
        : <div style={{ display: "flex", gap: 8 }}><Btn tur="gri" style={{ flex: 1 }} disabled={islem.mesgul} onClick={() => setForm({ ...form, kontrol: false })}>Düzelt</Btn>
          <Btn tur="yesil" style={{ flex: 1.4 }} disabled={islem.mesgul} onClick={kaydet}>{islem.mesgul ? "Kaydediliyor…" : "Onayla ve kaydet"}</Btn></div>}
    </Modal>}
  </div>;
}
