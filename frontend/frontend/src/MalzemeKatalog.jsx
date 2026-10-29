// MALZEME KATALOĞU + TEKNOCENTER TALEP BİLEŞENLERİ (29.10.2026, Orhan). Kaynak: /malzeme/katalog/*, /malzeme/tekno-sahalar.
//   TeknoSahaSecici        : yalnız Teknocenter'ın yetkili olduğu Rollout iş kayıtları (tam iş kodu); serbest metin kabul edilmez
//   MalzemeSecimPenceresi  : aramalı çoklu seçim (ad, kod, teknik özellik, BoQ kodu, kategori) + "listede yok" akışı
//   YeniMalzemeFormu       : benzer kayıt uyarılı tanımlama (yetkili); yetkisiz kullanıcı "katalogda yok" satırı ekler
//   TalepKalemEditoru      : talep taslağının kalemleri — birim katalogdan, aynı malzeme iki kez eklenmez
//   MalzemeKatalogPanel    : fiyatsız katalog listesi, düzenleme, kaynaklı içe alma önizlemesi (yönetici)
// Fiyat bu dosyada hiçbir yerde istenmez / gösterilmez (fiyat yalnız Fiyat Listesi ekranında, mali yetkiyle).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const LAC = "#1e3a5f";
const tokenAl = () => localStorage.getItem("finance_token") || localStorage.getItem("token") || "";
async function api(yol, { method = "GET", body } = {}) {
  let r;
  try { r = await fetch(API_BASE + yol, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAl()}` }, body: body ? JSON.stringify(body) : undefined }); }
  catch { const e = new Error("Bağlantı kurulamadı; bilgiler duruyor, tekrar deneyin."); e.belirsiz = true; throw e; }
  const j = await r.json().catch(() => null);
  if (!r.ok || (j && j.ok === false)) { const e = new Error((j && j.error) || `Sunucu hatası (${r.status})`); e.http = r.status; e.veri = j; throw e; }
  return j;
}
const sayiCoz = (v) => { const s = String(v ?? "").trim().replace(/\s/g, ""); const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s); return Number.isFinite(n) ? n : NaN; };
const sInput = { padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13, width: "100%", boxSizing: "border-box", background: "#fff" };
const sEt = { fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4, display: "block", textAlign: "left" };
function Btn({ children, tur = "ana", kucuk, ...p }) {
  const r = { ana: [LAC, "#fff"], yesil: ["#065f46", "#fff"], gri: ["#f1f5f9", "#334155"], mavi: ["#dbeafe", "#1d4ed8"], kirmizi: ["#fee2e2", "#b91c1c"] }[tur];
  return <button type="button" {...p} style={{ padding: kucuk ? "5px 10px" : "9px 16px", background: p.disabled ? "#cbd5e1" : r[0], color: r[1], border: "none", borderRadius: 8, fontWeight: 700, fontSize: kucuk ? 12 : 13, cursor: p.disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap", ...(p.style || {}) }}>{children}</button>;
}
function Uyari({ m, onKapat }) {
  if (!m) return null;
  const r = { hata: ["#fef2f2", "#b91c1c"], basari: ["#ecfdf5", "#065f46"], uyari: ["#fffbeb", "#92400e"], bilgi: ["#eff6ff", "#1e40af"] }[m.tur] || ["#eff6ff", "#1e40af"];
  return <div role="alert" style={{ background: r[0], color: r[1], borderRadius: 8, padding: "8px 12px", fontSize: 13, margin: "8px 0", display: "flex", gap: 8, textAlign: "left" }}><div style={{ flex: 1, whiteSpace: "pre-wrap" }}>{m.metin}</div>{onKapat && <button type="button" onClick={onKapat} style={{ border: "none", background: "none", cursor: "pointer", color: r[1] }}>✕</button>}</div>;
}
function Modal({ baslik, children, onKapat, genis }) {
  return <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }} onMouseDown={(e) => e.target === e.currentTarget && onKapat()}>
    <div style={{ background: "#fff", borderRadius: 14, padding: 16, width: "100%", maxWidth: genis ? 920 : 560, maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}><div style={{ fontWeight: 800, color: LAC, flex: 1, textAlign: "left" }}>{baslik}</div><button type="button" onClick={onKapat} style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer" }} aria-label="Kapat">✕</button></div>
      <div style={{ overflowY: "auto", flex: 1 }}>{children}</div></div></div>;
}
const kartEtiket = (k) => [k.teknik_metin, k.boq?.length ? `BoQ ${k.boq.map((b) => b.kod).join(", ")}` : null].filter(Boolean).join(" · ");

// ── Teknocenter saha / iş seçimi ───────────────────────────────────────────────────────────────────────────────────
export function TeknoSahaSecici({ deger, onSec, zorunlu }) {
  const [ara, setAra] = useState("");
  const [liste, setListe] = useState([]);
  const [acik, setAcik] = useState(false);
  const [hata, setHata] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  useEffect(() => {
    if (!acik) return;
    let iptal = false;
    setYukleniyor(true);
    const t = setTimeout(() => api(`/malzeme/tekno-sahalar?q=${encodeURIComponent(ara)}`).then((j) => { if (!iptal) { setListe(j.rows || []); setHata(null); } }).catch((e) => !iptal && setHata(e.message)).finally(() => !iptal && setYukleniyor(false)), 250);
    return () => { iptal = true; clearTimeout(t); };
  }, [ara, acik]);
  if (deger?.site_code) return <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #16a34a", borderRadius: 8, padding: "6px 10px", background: "#f0fdf4", textAlign: "left" }}>
    <div style={{ flex: 1 }}><b>{deger.site_code}</b><div style={{ fontSize: 11, color: "#475569" }}>{[deger.bolge, deger.project_code, ...(deger.tekno_isleri || [])].filter(Boolean).join(" · ")}</div></div>
    <button type="button" onClick={() => onSec(null)} style={{ border: "none", background: "none", cursor: "pointer", color: "#b91c1c" }} aria-label="Sahayı kaldır">✕</button></div>;
  return <div style={{ position: "relative" }}>
    <input value={ara} onChange={(e) => { setAra(e.target.value.toUpperCase()); setAcik(true); }} onFocus={() => setAcik(true)} onBlur={() => setTimeout(() => setAcik(false), 200)}
      placeholder={`Teknocenter işi ara (site / iş kodu)${zorunlu ? " *" : ""}`} style={sInput} autoComplete="off" />
    {acik && <div style={{ position: "absolute", zIndex: 300, top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #d1d5db", borderRadius: 8, maxHeight: 260, overflowY: "auto", boxShadow: "0 6px 16px rgba(0,0,0,0.14)", textAlign: "left" }}>
      {hata && <div style={{ padding: 10, color: "#b91c1c", fontSize: 12 }}>{hata}</div>}
      {yukleniyor && liste.length === 0 && <div style={{ padding: 10, color: "#6b7280", fontSize: 12 }}>Aranıyor…</div>}
      {!hata && !yukleniyor && liste.length === 0 && <div style={{ padding: 10, color: "#6b7280", fontSize: 12 }}>Teknocenter kapsamında eşleşen iş yok. Site ID'nin tam iş kodunu yazın (ör. KA3737_NR700).</div>}
      {liste.map((s) => <div key={s.site_code} onMouseDown={() => { onSec(s); setAra(""); setAcik(false); }} style={{ padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{s.site_code} <span style={{ fontWeight: 400, color: "#6b7280", fontSize: 11 }}>{[s.bolge, s.project_code].filter(Boolean).join(" · ")}</span></div>
        <div style={{ fontSize: 11, color: "#065f46" }}>Teknocenter işi: {(s.tekno_isleri || []).join(", ") || "—"}</div></div>)}
    </div>}
  </div>;
}

// ── Yeni malzeme tanımlama ─────────────────────────────────────────────────────────────────────────────────────────
const TEKNIK_ALANLAR = [["kesit", "Kesit (ör. 4x10 mm²)"], ["kablo_tipi", "Kablo tipi (NYY, NYAF, XLPE…)"], ["iletken", "İletken (Bakır / Alüminyum)"], ["uzunluk_m", "Boy / uzunluk (m)"],
  ["feeder_cap", "Feeder çapı (1/2\", 7/8\")"], ["akim_a", "Akım (A)"], ["tip", "Tip / model farkı"], ["ebat", "Ebat"]];
export function YeniMalzemeFormu({ baslangicAd = "", kategoriler = [], birimler = [], onKaydedildi, onIptal }) {
  const [f, setF] = useState({ ad: baslangicAd, kategori: "", temel_birim: "", teknik: {}, uretici: "", model: "", urun_kodu: "", kaynak_url: "", tur: "SARF" });
  const [benzer, setBenzer] = useState({ ayni: [], benzer: [] });
  const [mesaj, setMesaj] = useState(null);
  const [mesgul, setMesgul] = useState(false);
  const kilit = useRef(false);
  useEffect(() => {
    if (f.ad.trim().length < 3) { setBenzer({ ayni: [], benzer: [] }); return; }
    const t = setTimeout(() => api(`/malzeme/katalog/benzer?ad=${encodeURIComponent(f.ad)}`).then((j) => setBenzer({ ayni: j.ayni || [], benzer: j.benzer || [] })).catch(() => {}), 350);
    return () => clearTimeout(t);
  }, [f.ad]);
  const kaydet = async (benzerOnay = false) => {
    if (kilit.current) return; kilit.current = true; setMesgul(true); setMesaj(null);
    try {
      const j = await api("/malzeme/katalog", { method: "POST", body: { ...f, benzer_onay: benzerOnay } });
      onKaydedildi(j.urun);
    } catch (e) {
      if (e.veri?.benzerler) setBenzer((b) => ({ ...b, benzer: e.veri.benzerler, sor: true }));
      if (e.veri?.mevcut) setBenzer((b) => ({ ...b, ayni: [e.veri.mevcut] }));
      setMesaj({ tur: e.belirsiz ? "uyari" : "hata", metin: e.message });
    } finally { kilit.current = false; setMesgul(false); }
  };
  return <div style={{ textAlign: "left" }}>
    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
      <label><span style={sEt}>Malzeme adı *</span><input value={f.ad} onChange={(e) => setF({ ...f, ad: e.target.value })} style={sInput} autoFocus /></label>
      <label><span style={sEt}>Kategori *</span><select value={f.kategori} onChange={(e) => setF({ ...f, kategori: e.target.value })} style={sInput}><option value="">— seçin —</option>{kategoriler.map((k) => <option key={k}>{k}</option>)}</select></label>
      <label><span style={sEt}>Birim *</span><select value={f.temel_birim} onChange={(e) => setF({ ...f, temel_birim: e.target.value })} style={sInput}><option value="">— seçin —</option>{birimler.map((b) => <option key={b}>{b}</option>)}</select></label>
    </div>
    <div style={{ fontSize: 11, color: "#64748b", margin: "6px 0" }}>Ayırt edici teknik özellikleri girin (kablo için kesit / tip, pole için boy). Bilmediğiniz alanı boş bırakın — uydurmayın.</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 8 }}>
      {TEKNIK_ALANLAR.map(([k, et]) => <label key={k}><span style={sEt}>{et}</span><input value={f.teknik[k] || ""} onChange={(e) => setF({ ...f, teknik: { ...f.teknik, [k]: e.target.value } })} style={sInput} /></label>)}
      <label><span style={sEt}>Üretici (varsa)</span><input value={f.uretici} onChange={(e) => setF({ ...f, uretici: e.target.value })} style={sInput} /></label>
      <label><span style={sEt}>Model / ürün kodu (varsa)</span><input value={f.urun_kodu} onChange={(e) => setF({ ...f, urun_kodu: e.target.value })} style={sInput} /></label>
      <label style={{ gridColumn: "span 2" }}><span style={sEt}>Kaynak bağlantısı (varsa)</span><input value={f.kaynak_url} onChange={(e) => setF({ ...f, kaynak_url: e.target.value })} style={sInput} placeholder="https://…" /></label>
    </div>
    {(benzer.ayni.length > 0 || benzer.benzer.length > 0) && <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: 10, marginTop: 10, fontSize: 13 }}>
      <b style={{ color: "#92400e" }}>{benzer.ayni.length ? "Bu malzeme zaten kayıtlı:" : "Bu malzeme zaten kayıtlı olabilir:"}</b>
      {[...benzer.ayni, ...benzer.benzer].slice(0, 6).map((b) => <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        <span style={{ flex: 1 }}>{b.kod} · {b.ad} ({b.temel_birim}){b.benzerlik ? ` · %${b.benzerlik} benzer` : ""}</span>
        <Btn kucuk tur="mavi" onClick={() => onKaydedildi({ ...b, mevcut: true })}>Bunu kullan</Btn></div>)}
    </div>}
    <Uyari m={mesaj} />
    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
      <Btn onClick={() => kaydet(false)} disabled={mesgul || !f.ad.trim() || !f.kategori || !f.temel_birim || benzer.ayni.length > 0}>{mesgul ? "Kaydediliyor…" : "Malzemeyi tanımla"}</Btn>
      {benzer.sor && benzer.ayni.length === 0 && <Btn tur="gri" onClick={() => kaydet(true)} disabled={mesgul}>Farklı malzeme, yine de kaydet</Btn>}
      <Btn tur="gri" onClick={onIptal} disabled={mesgul}>Vazgeç</Btn>
    </div>
  </div>;
}

// ── Aramalı çoklu seçim penceresi ──────────────────────────────────────────────────────────────────────────────────
export function MalzemeSecimPenceresi({ onKapat, onEkle, talepteOlanlar = [], tanimlayabilir }) {
  const [ara, setAra] = useState("");
  const [kategori, setKategori] = useState("");
  const [meta, setMeta] = useState({ kategoriler: [], birimler: [] });
  const [sonuc, setSonuc] = useState({ rows: [], bulunamadi: false, yukleniyor: true });
  const [secili, setSecili] = useState(new Map());
  const [yeniForm, setYeniForm] = useState(false);
  const [hata, setHata] = useState(null);
  const [sayac, setSayac] = useState(0);
  useEffect(() => { api("/malzeme/katalog/kategoriler").then((j) => setMeta({ kategoriler: j.kategoriler.map((k) => k.kategori), birimler: j.birimler })).catch(() => {}); }, []);
  useEffect(() => {
    let iptal = false;
    setSonuc((s) => ({ ...s, yukleniyor: true }));
    const t = setTimeout(() => api(`/malzeme/katalog?q=${encodeURIComponent(ara)}&kategori=${encodeURIComponent(kategori)}&limit=120`)
      .then((j) => !iptal && (setSonuc({ rows: j.rows, bulunamadi: j.bulunamadi, yukleniyor: false }), setHata(null)))
      .catch((e) => !iptal && (setHata(e.message), setSonuc({ rows: [], bulunamadi: false, yukleniyor: false }))), 250);
    return () => { iptal = true; clearTimeout(t); };
  }, [ara, kategori, sayac]);
  const talepte = useMemo(() => new Set(talepteOlanlar.map(Number)), [talepteOlanlar]);
  const degistir = (k) => setSecili((m) => { const n = new Map(m); if (n.has(k.id)) n.delete(k.id); else n.set(k.id, k); return n; });
  return <Modal baslik="Malzeme seç" onKapat={onKapat} genis>
    {yeniForm ? <YeniMalzemeFormu baslangicAd={ara} kategoriler={meta.kategoriler} birimler={meta.birimler} onIptal={() => setYeniForm(false)}
      onKaydedildi={(u) => { setYeniForm(false); setAra(u.ad); setSayac((x) => x + 1); if (!u.mevcut) setSecili((m) => new Map(m).set(u.id, u)); }} /> : <>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input value={ara} onChange={(e) => setAra(e.target.value)} placeholder="Ad, kod, teknik özellik ya da BoQ kodu ile ara…" style={{ ...sInput, flex: "2 1 260px" }} autoFocus />
        <select value={kategori} onChange={(e) => setKategori(e.target.value)} style={{ ...sInput, flex: "1 1 200px" }}><option value="">Tüm kategoriler</option>{meta.kategoriler.map((k) => <option key={k}>{k}</option>)}</select>
      </div>
      <Uyari m={hata ? { tur: "hata", metin: hata } : null} />
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, maxHeight: "52vh", overflowY: "auto", textAlign: "left" }}>
        {sonuc.yukleniyor && <div style={{ padding: 14, color: "#6b7280" }}>Aranıyor…</div>}
        {!sonuc.yukleniyor && sonuc.bulunamadi && <div style={{ padding: 16, textAlign: "center" }}>
          <div style={{ color: "#92400e", fontWeight: 700, marginBottom: 8 }}>Malzeme listede bulunamadı. Yeni malzeme tanımlayın.</div>
          {tanimlayabilir ? <Btn onClick={() => setYeniForm(true)}>+ Yeni Malzeme Tanımla</Btn>
            : <><div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>Malzeme tanımlama yetkiniz yok. Talebe "katalogda yok" satırı ekleyin; onaycı tanımlar.</div>
              <Btn tur="mavi" onClick={() => { onEkle([], ara); onKapat(); }} disabled={!ara.trim()}>"{ara || "…"}" satırını katalogda yok olarak ekle</Btn></>}
        </div>}
        {sonuc.rows.map((k) => { const var_ = talepte.has(k.id); return <label key={k.id} style={{ display: "flex", gap: 10, padding: "8px 10px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: secili.has(k.id) ? "#eff6ff" : var_ ? "#f8fafc" : "#fff" }}>
          <input type="checkbox" checked={secili.has(k.id)} onChange={() => degistir(k)} style={{ marginTop: 3 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{k.ad} <span style={{ fontWeight: 400, color: "#64748b" }}>({k.temel_birim})</span>{var_ && <span style={{ marginLeft: 6, fontSize: 11, color: "#92400e", fontWeight: 700 }}>talepte var</span>}</div>
            <div style={{ fontSize: 11, color: "#475569" }}>{k.kod} · {k.kategori}{kartEtiket(k) ? ` · ${kartEtiket(k)}` : ""}</div>
          </div></label>; })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, fontSize: 13, textAlign: "left" }}><b>{secili.size}</b> malzeme seçili</div>
        {tanimlayabilir && !sonuc.bulunamadi && <Btn tur="gri" onClick={() => setYeniForm(true)}>+ Yeni Malzeme Tanımla</Btn>}
        <Btn onClick={() => { onEkle([...secili.values()]); onKapat(); }} disabled={!secili.size}>Seçilenleri Talebe Ekle</Btn>
      </div>
    </>}
  </Modal>;
}

// ── Talep kalemleri (taslak) ───────────────────────────────────────────────────────────────────────────────────────
export function TalepKalemEditoru({ kalemler, setKalemler, tanimlayabilir, dar }) {
  const [pencere, setPencere] = useState(false);
  const [vurgu, setVurgu] = useState(null);
  const [mesaj, setMesaj] = useState(null);
  const satirRef = useRef({});
  const ekle = (kartlar, katalogdaYokAd) => {
    if (katalogdaYokAd) {
      const ad = katalogdaYokAd.trim();
      if (kalemler.some((k) => !k.urun_id && k.malzeme_adi.toLocaleUpperCase("tr") === ad.toLocaleUpperCase("tr"))) { setMesaj({ tur: "uyari", metin: `"${ad}" talepte zaten var.` }); return; }
      setKalemler((l) => [...l.filter((k) => k.malzeme_adi || k.urun_id), { urun_id: null, malzeme_adi: ad, birim: "Adet", miktar: "", notlar: "", yeni_malzeme_onerisi: true }]);
      return;
    }
    const tekrar = kartlar.filter((k) => kalemler.some((x) => x.urun_id === k.id));
    const yeni = kartlar.filter((k) => !kalemler.some((x) => x.urun_id === k.id));
    if (yeni.length) setKalemler((l) => [...l.filter((k) => k.malzeme_adi || k.urun_id), ...yeni.map((k) => ({ urun_id: k.id, malzeme_adi: k.ad, birim: k.temel_birim, kod: k.kod, teknik_metin: k.teknik_metin || "", tam_sayi: k.tam_sayi, miktar: "", notlar: "" }))]);
    if (tekrar.length) {
      setMesaj({ tur: "uyari", metin: `${tekrar.map((k) => k.ad).join(", ")} talepte zaten var — ikinci satır eklenmedi; miktarı mevcut satırda değiştirin.` });
      setVurgu(tekrar[0].id);
      setTimeout(() => satirRef.current[tekrar[0].id]?.scrollIntoView?.({ behavior: "smooth", block: "center" }), 50);
    } else setMesaj(null);
  };
  const degis = (i, alan, v) => setKalemler((l) => l.map((x, j) => (j === i ? { ...x, [alan]: v } : x)));
  const dolu = kalemler.filter((k) => k.malzeme_adi || k.urun_id);
  return <div style={{ textAlign: "left" }}>
    <Uyari m={mesaj} onKapat={() => setMesaj(null)} />
    {dolu.length === 0 && <div style={{ padding: 14, border: "1px dashed #cbd5e1", borderRadius: 10, color: "#64748b", fontSize: 13, marginBottom: 8 }}>Henüz malzeme yok. "Katalogdan malzeme seç" ile ekleyin.</div>}
    {kalemler.map((k, i) => (!k.malzeme_adi && !k.urun_id) ? null : (
      <div key={k.urun_id ? `u${k.urun_id}` : `a${i}`} ref={(el) => { if (k.urun_id) satirRef.current[k.urun_id] = el; }}
        style={{ display: "grid", gridTemplateColumns: dar ? "1fr" : "minmax(240px,3fr) 120px 90px minmax(140px,2fr) 34px", gap: 8, alignItems: "center", padding: 8, marginBottom: 6, borderRadius: 8,
          border: `1px solid ${vurgu === k.urun_id && k.urun_id ? "#f59e0b" : "#e5e7eb"}`, background: vurgu === k.urun_id && k.urun_id ? "#fffbeb" : "#fff" }}>
        <div><div style={{ fontWeight: 700, fontSize: 13 }}>{k.malzeme_adi}</div>
          <div style={{ fontSize: 11, color: k.urun_id ? "#475569" : "#92400e" }}>{k.urun_id ? [k.kod, k.teknik_metin].filter(Boolean).join(" · ") : "Katalogda yok — onaycı tanımlayacak"}</div></div>
        <input inputMode="decimal" value={k.miktar} onChange={(e) => degis(i, "miktar", e.target.value)} placeholder="Miktar *" aria-label={`${k.malzeme_adi} miktar`}
          style={{ ...sInput, borderColor: k.miktar !== "" && !(sayiCoz(k.miktar) > 0) ? "#dc2626" : "#d1d5db" }} />
        {k.urun_id ? <div style={{ fontSize: 13, color: "#334155" }} title="Birim katalogdan gelir">{k.birim}</div>
          : <select value={k.birim} onChange={(e) => degis(i, "birim", e.target.value)} style={sInput}>{["Adet", "Metre", "Kg", "Litre", "Takım", "Paket", "Kutu", "Rulo", "M²", "M³"].map((b) => <option key={b}>{b}</option>)}</select>}
        <input value={k.notlar || ""} onChange={(e) => degis(i, "notlar", e.target.value)} placeholder={k.urun_id ? "Açıklama" : "Açıklama (ölçü / özellik) *"} style={sInput} />
        <button type="button" onClick={() => setKalemler((l) => l.filter((_, j) => j !== i))} style={{ border: "none", background: "none", color: "#b91c1c", cursor: "pointer", fontSize: 16 }} aria-label="Satırı sil">✕</button>
      </div>))}
    <Btn tur="mavi" onClick={() => setPencere(true)}>＋ Katalogdan malzeme seç</Btn>
    {pencere && <MalzemeSecimPenceresi onKapat={() => setPencere(false)} onEkle={ekle} talepteOlanlar={kalemler.filter((k) => k.urun_id).map((k) => k.urun_id)} tanimlayabilir={tanimlayabilir} />}
  </div>;
}
// Gönderim öncesi kontrol: istemci tarafı (sunucu yine kesin denetler)
export function kalemKontrol(kalemler) {
  const dolu = kalemler.filter((k) => k.malzeme_adi || k.urun_id);
  if (!dolu.length) return "En az bir malzeme ekleyin";
  for (const k of dolu) {
    const m = sayiCoz(k.miktar);
    if (!(m > 0)) return `"${k.malzeme_adi}" için geçerli bir miktar girin (virgüllü olabilir)`;
    if (Math.round(m * 1000) / 1000 !== m) return `"${k.malzeme_adi}": en fazla 3 ondalık`;
    if (k.tam_sayi && !Number.isInteger(m)) return `"${k.malzeme_adi}" ${k.birim} ile tutulur; tam sayı girin`;
    if (!k.urun_id && !String(k.notlar || "").trim()) return `Katalogda olmayan "${k.malzeme_adi}" için açıklama (ölçü / özellik) yazın`;
  }
  return null;
}
export const kalemGovde = (kalemler) => kalemler.filter((k) => k.malzeme_adi || k.urun_id).map((k) => ({ urun_id: k.urun_id || undefined, malzeme_adi: k.malzeme_adi, miktar: String(k.miktar).trim(), birim: k.birim, notlar: k.notlar || "" }));
// Sunucudan gelen kalemi editör biçimine çevirir (düzenleme)
export const kalemdenEditore = (k) => ({ urun_id: k.urun_id || null, malzeme_adi: k.malzeme_adi || "", birim: k.birim || "Adet", kod: k.urun_kod || "", tam_sayi: false,
  teknik_metin: k.urun_teknik ? Object.entries(k.urun_teknik).map(([a, b]) => `${a}: ${b}`).join(" · ") : "", miktar: k.miktar != null ? String(Number(k.miktar)).replace(".", ",") : "", notlar: k.notlar || "", yeni_malzeme_onerisi: !!k.yeni_malzeme_onerisi });

// ── Katalog ekranı (fiyatsız) + içe alma önizlemesi ───────────────────────────────────────────────────────────────
const DURUM_TR = { YENI: ["Yeni", "#065f46", "#d1fae5"], ESLESEN: ["Mevcutla eşleşti", "#1d4ed8", "#dbeafe"], OLASI_MUKERRER: ["Olası mükerrer", "#92400e", "#fef3c7"],
  EKSIK_BIRIM: ["Birim eksik", "#b91c1c", "#fee2e2"], DOGRULANAMADI: ["Doğrulanamadı", "#7c3aed", "#ede9fe"], ZATEN_ALINDI: ["Zaten alındı", "#6b7280", "#f3f4f6"] };
export function MalzemeKatalogPanel({ yetki }) {
  const [ara, setAra] = useState(""); const [kategori, setKategori] = useState("");
  const [meta, setMeta] = useState({ kategoriler: [], birimler: [] });
  const [rows, setRows] = useState(null);
  const [yeni, setYeni] = useState(false);
  const [duzen, setDuzen] = useState(null);
  const [mesaj, setMesaj] = useState(null);
  const [ice, setIce] = useState(null); // { kaynak, govde, sonuc, kararlar, filtre }
  const [mesgul, setMesgul] = useState(false);
  const [yenile, setYenile] = useState(0);
  useEffect(() => { api("/malzeme/katalog/kategoriler").then((j) => setMeta({ kategoriler: j.kategoriler.map((k) => k.kategori), birimler: j.birimler })).catch(() => {}); }, [yenile]);
  useEffect(() => { const t = setTimeout(() => api(`/malzeme/katalog?q=${encodeURIComponent(ara)}&kategori=${encodeURIComponent(kategori)}&limit=300${yetki?.depo ? "&pasif=1" : ""}`).then((j) => setRows(j.rows)).catch((e) => setMesaj({ tur: "hata", metin: e.message })), 250); return () => clearTimeout(t); }, [ara, kategori, yenile, yetki?.depo]);
  const onizle = async (kaynak, govde) => { setMesgul(true); setMesaj(null);
    try { const j = await api("/malzeme/katalog/ice-al", { method: "POST", body: { kaynak, ...govde } }); setIce({ kaynak, govde, sonuc: j, kararlar: {}, filtre: "" }); }
    catch (e) { setMesaj({ tur: "hata", metin: e.message }); } finally { setMesgul(false); } };
  const uygula = async () => {
    if (!window.confirm(`${ice.sonuc.ozet.yeni} yeni kart eklenecek, ${ice.sonuc.ozet.eslesen} eşleşen karta kaynak bağlanacak. Olası mükerrerlerde yalnız verdiğiniz kararlar uygulanır. Onaylıyor musunuz?`)) return;
    setMesgul(true);
    try { const j = await api("/malzeme/katalog/ice-al", { method: "POST", body: { kaynak: ice.kaynak, ...ice.govde, uygula: true, kararlar: ice.kararlar } });
      setMesaj({ tur: "basari", metin: `İçe alındı: ${j.ozet.yeni_kart} yeni kart, ${j.ozet.kaynak_baglandi} kaynak bağlandı, ${j.ozet.atlandi} atlandı. Fiyatlara dokunulmadı.` }); setIce(null); setYenile((x) => x + 1); }
    catch (e) { setMesaj({ tur: "hata", metin: e.message }); } finally { setMesgul(false); } };
  const satirlar = ice ? ice.sonuc.satirlar.filter((s) => !ice.filtre || s.durum === ice.filtre) : [];
  return <div style={{ textAlign: "left" }}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
      <input value={ara} onChange={(e) => setAra(e.target.value)} placeholder="Ad, kod, teknik özellik, BoQ kodu…" style={{ ...sInput, flex: "2 1 240px" }} />
      <select value={kategori} onChange={(e) => setKategori(e.target.value)} style={{ ...sInput, flex: "1 1 200px" }}><option value="">Tüm kategoriler</option>{meta.kategoriler.map((k) => <option key={k}>{k}</option>)}</select>
      {yetki?.depo && <Btn onClick={() => setYeni(true)}>+ Yeni Malzeme Tanımla</Btn>}
      {yetki?.onay && <>
        <label style={{ padding: "9px 14px", background: "#dbeafe", color: "#1d4ed8", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>BoQ adaylarını yükle (.json)…
          <input type="file" accept=".json,application/json" style={{ display: "none" }} onChange={async (e) => { const d = e.target.files?.[0]; e.target.value = ""; if (!d) return;
            try { const j = JSON.parse(await d.text()); await onizle("boq", { adaylar: j.adaylar, haric: (j.haric || []).map((h) => ({ neden: h.neden })) }); } catch (er) { setMesaj({ tur: "hata", metin: "Dosya okunamadı: " + er.message }); } }} /></label>
        <Btn tur="gri" onClick={() => onizle("mevcut", {})} disabled={mesgul}>Mevcut malzeme adlarını önizle</Btn></>}
    </div>
    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Katalog malzeme adı, birim ve teknik özellik içerir; fiyat içermez. Fiyatlar Fiyat Listesi ekranında, yalnız mali yetkiyle görünür.</div>
    <Uyari m={mesaj} onKapat={() => setMesaj(null)} />
    {ice && <div style={{ border: "1px solid #bfdbfe", borderRadius: 10, padding: 12, marginBottom: 12, background: "#f8fbff" }}>
      <div style={{ fontWeight: 800, color: LAC, marginBottom: 6 }}>İçe alma önizlemesi ({ice.kaynak === "boq" ? "BoQ" : "mevcut adlar"}) — henüz HİÇBİR ŞEY kaydedilmedi</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 12, marginBottom: 8 }}>
        {[["okunan", "Okunan kayıt"], ["yeni", "Yeni"], ["eslesen", "Mevcutla eşleşen"], ["olasi_mukerrer", "Olası mükerrer"], ["eksik_birim", "Eksik birim"], ["dogrulanamadi", "Doğrulanamayan"], ["zaten_alindi", "Zaten alındı"], ["haric_hizmet", "Hariç: hizmet"], ["haric_paket", "Hariç: paket"], ["haric_hizmet_agirlikli", "Hariç: hizmet ağırlıklı"]]
          .map(([k, et]) => <span key={k} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: "3px 10px" }}>{et}: <b>{ice.sonuc.ozet[k] ?? 0}</b></span>)}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>{["", ...Object.keys(DURUM_TR)].map((d) => <Btn key={d || "hepsi"} kucuk tur={ice.filtre === d ? "ana" : "gri"} onClick={() => setIce({ ...ice, filtre: d })}>{d ? DURUM_TR[d][0] : "Hepsi"}</Btn>)}</div>
      <div style={{ maxHeight: 360, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }}>
        {satirlar.slice(0, 400).map((s) => <div key={s.anahtar} style={{ display: "flex", gap: 8, padding: "6px 10px", borderBottom: "1px solid #f1f5f9", fontSize: 12, alignItems: "center" }}>
          <span style={{ padding: "2px 8px", borderRadius: 10, fontWeight: 700, color: DURUM_TR[s.durum][1], background: DURUM_TR[s.durum][2], whiteSpace: "nowrap" }}>{DURUM_TR[s.durum][0]}</span>
          <div style={{ flex: 1 }}><b>{s.ad}</b> ({s.temel_birim || s.birim_ham || "?"}) · {s.kategori}
            <div style={{ color: "#64748b" }}>{Object.entries(s.teknik || {}).map(([a, b]) => `${a}: ${b}`).join(" · ")} {s.kaynaklar.slice(0, 3).map((k) => k.boq_kod || k.yer).join(", ")}{s.uyarilar?.length ? ` · ⚠ ${s.uyarilar.join("; ")}` : ""}</div>
            {s.benzer && <div style={{ color: "#92400e" }}>Benzer: {s.benzer.kod} · {s.benzer.ad} (%{s.benzer.benzerlik})</div>}
            {s.eslesen && <div style={{ color: "#1d4ed8" }}>Eşleşen: {s.eslesen.kod} · {s.eslesen.ad}</div>}</div>
          {["OLASI_MUKERRER", "DOGRULANAMADI"].includes(s.durum) && <select value={ice.kararlar[s.anahtar] || "atla"} onChange={(e) => setIce({ ...ice, kararlar: { ...ice.kararlar, [s.anahtar]: e.target.value } })} style={{ ...sInput, width: 190 }}>
            <option value="atla">Atla (incelenecek)</option><option value="yeni">Ayrı yeni kart</option>{s.benzer?.id && <option value={`esle:${s.benzer.id}`}>Benzerle eşle (kaynak bağla)</option>}</select>}
        </div>)}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}><Btn tur="yesil" onClick={uygula} disabled={mesgul}>Onaylıyorum, içe al</Btn><Btn tur="gri" onClick={() => setIce(null)}>Vazgeç</Btn></div>
    </div>}
    {rows === null ? <div style={{ color: "#6b7280" }}>Yükleniyor…</div> : <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff" }}>
      <div style={{ padding: "6px 10px", fontSize: 12, color: "#64748b", borderBottom: "1px solid #e5e7eb" }}>{rows.length} malzeme{rows.length === 300 ? " (ilk 300 — aramayı daraltın)" : ""}</div>
      {rows.map((k) => <div key={k.id} style={{ display: "flex", gap: 8, padding: "7px 10px", borderBottom: "1px solid #f1f5f9", alignItems: "center", opacity: k.aktif ? 1 : 0.5 }}>
        <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 700 }}>{k.ad} <span style={{ fontWeight: 400, color: "#64748b" }}>({k.temel_birim})</span>{!k.aktif && " · pasif"}</div>
          <div style={{ fontSize: 11, color: "#475569" }}>{k.kod} · {k.kategori}{k.ad_en ? ` · EN: ${k.ad_en}` : ""}{kartEtiket(k) ? ` · ${kartEtiket(k)}` : ""}{k.uretici ? ` · ${k.uretici} ${k.urun_kodu || ""}` : ""}</div></div>
        {yetki?.depo && <Btn kucuk tur="gri" onClick={() => setDuzen({ ...k, teknik: { ...(k.teknik || {}) } })}>Düzenle</Btn>}
      </div>)}
    </div>}
    {yeni && <Modal baslik="Yeni malzeme tanımla" onKapat={() => setYeni(false)} genis><YeniMalzemeFormu kategoriler={meta.kategoriler} birimler={meta.birimler} onIptal={() => setYeni(false)}
      onKaydedildi={(u) => { setYeni(false); setMesaj({ tur: "basari", metin: u.mevcut ? `Mevcut kayıt: ${u.kod} · ${u.ad}` : `Tanımlandı: ${u.kod} · ${u.ad}` }); setYenile((x) => x + 1); }} /></Modal>}
    {duzen && <Modal baslik={`Düzenle · ${duzen.kod}`} onKapat={() => setDuzen(null)} genis>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr", gap: 8 }}>
        <label><span style={sEt}>Ad</span><input value={duzen.ad} onChange={(e) => setDuzen({ ...duzen, ad: e.target.value })} style={sInput} /></label>
        <label><span style={sEt}>İngilizce ad</span><input value={duzen.ad_en || ""} onChange={(e) => setDuzen({ ...duzen, ad_en: e.target.value })} style={sInput} /></label>
        <label><span style={sEt}>Kategori</span><select value={duzen.kategori || ""} onChange={(e) => setDuzen({ ...duzen, kategori: e.target.value })} style={sInput}>{meta.kategoriler.map((k) => <option key={k}>{k}</option>)}</select></label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 8, marginTop: 8 }}>
        {TEKNIK_ALANLAR.map(([k, et]) => <label key={k}><span style={sEt}>{et}</span><input value={duzen.teknik[k] || ""} onChange={(e) => setDuzen({ ...duzen, teknik: { ...duzen.teknik, [k]: e.target.value } })} style={sInput} /></label>)}
        <label><span style={sEt}>Üretici</span><input value={duzen.uretici || ""} onChange={(e) => setDuzen({ ...duzen, uretici: e.target.value })} style={sInput} /></label>
        <label><span style={sEt}>Ürün kodu</span><input value={duzen.urun_kodu || ""} onChange={(e) => setDuzen({ ...duzen, urun_kodu: e.target.value })} style={sInput} /></label>
      </div>
      <label style={{ display: "flex", gap: 8, fontSize: 13, margin: "10px 0" }}><input type="checkbox" checked={duzen.aktif} onChange={(e) => setDuzen({ ...duzen, aktif: e.target.checked })} /> Aktif (pasif malzeme yeni talepte seçilemez)</label>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>Birim: {duzen.temel_birim} — stok hareketi başladıktan sonra değiştirilemez.</div>
      <Btn onClick={async () => { try { await api(`/malzeme/katalog/${duzen.id}`, { method: "PUT", body: duzen }); setDuzen(null); setYenile((x) => x + 1); } catch (e) { setMesaj({ tur: "hata", metin: e.message }); setDuzen(null); } }}>Kaydet</Btn>
    </Modal>}
  </div>;
}

export { api as katalogApi, sayiCoz };
