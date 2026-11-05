// HW MALZEME DURUMU — web ekranı (31.10.2026, Orhan). Huawei saha malzemesinin kabulü, depo / ekip hareketleri ve geçmişi.
// Kaynak: /hw-malzeme/* (backend/hwMalzeme.js). Web ve mobil AYNI uçları kullanır. Yetki ve firma kapsamı sunucuda;
// düğme gizlemek yalnız kolaylıktır. Her yazma isteği bir istek anahtarı taşır: bağlantı koparsa aynı anahtarla tekrar
// denenir, ikinci kayıt oluşmaz; anahtar yalnız başarılı kayıttan sonra yenilenir.
// "Geldi" (kabul var), "tamamı geldi" (teslim tipi) ve "nerede" (depo / ekip / kullanıldı / iade) ayrı gösterilir.
import React, { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const LAC = "#1e3a5f";
const tokenAl = () => localStorage.getItem("finance_token") || localStorage.getItem("token") || "";
const yeniAnahtar = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
const bugun = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
const tarihTR = (v) => (v ? new Date(String(v).length <= 10 ? v + "T12:00:00" : v).toLocaleDateString("tr-TR") : "—");
const zamanTR = (v) => (v ? new Date(v).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const sayi = (v) => (v === null || v === undefined || v === "" ? "—" : Number(v).toLocaleString("tr-TR", { maximumFractionDigits: 3 }));

export async function hwApi(yol, { method = "GET", body, anahtar, form } = {}) {
  let r;
  try {
    r = await fetch(API_BASE + yol, {
      method, headers: form ? { Authorization: `Bearer ${tokenAl()}`, "x-istemci": "web" } : { "Content-Type": "application/json", Authorization: `Bearer ${tokenAl()}`, "x-istemci": "web" },
      body: form || (body ? JSON.stringify(anahtar ? { ...body, istek_anahtari: anahtar } : body) : undefined),
    });
  } catch {
    const e = new Error("Bağlantı kurulamadı. Kaydın alınıp alınmadığı doğrulanamadı — bilgiler duruyor, tekrar deneyin; ikinci kez kaydedilmez.");
    e.belirsiz = true; throw e;
  }
  const j = await r.json().catch(() => null);
  if (!r.ok || (j && j.ok === false)) { const e = new Error((j && j.error) || `Sunucu hatası (${r.status})`); e.http = r.status; e.ek = j; throw e; }
  return j;
}

// Konum / teslim rozetleri — renk tek başına anlam taşımaz, metin her zaman yazılı
const KONUM_R = { DEPODA: ["#dbeafe", "#1e40af", "🏬"], EKIPTE: ["#fef3c7", "#92400e", "👷"], KISMEN_EKIP_DEPO: ["#ffedd5", "#9a3412", "⇄"], KULLANILDI: ["#dcfce7", "#166534", "✓"],
  IADE: ["#f1f5f9", "#475569", "↩"], ESKI_TEYIT: ["#fee2e2", "#991b1b", "?"], YOK: ["#f1f5f9", "#64748b", "–"] };
export function HwRozet({ d, kucuk }) {
  if (!d) return null;
  const [bg, fg, ik] = KONUM_R[d.konum] || KONUM_R.YOK;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: bg, color: fg, borderRadius: 999, padding: kucuk ? "1px 8px" : "3px 10px", fontSize: kucuk ? 12 : 13.5, fontWeight: 800 }}>
    <span aria-hidden="true">{ik}</span>{d.etiket || d.konum_ad}</span>;
}
const Kart = ({ children, style }) => <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px", background: "#fff", marginBottom: 10, ...style }}>{children}</div>;
const etiketS = { display: "block", fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 3 };
const girdiS = { padding: "9px 10px", border: "1.5px solid #cbd5e1", borderRadius: 8, fontSize: 15, boxSizing: "border-box", width: "100%" };
const btn = (birincil) => ({ padding: "10px 16px", borderRadius: 10, border: birincil ? "none" : "1.5px solid #cbd5e1", background: birincil ? LAC : "#fff", color: birincil ? "#fff" : "#1e293b", fontWeight: 800, fontSize: 15, cursor: "pointer" });

// Kalem satırları düzenleyici (ad, kod, miktar, birim)
function KalemEditor({ kalemler, setKalemler, sabitAdlar }) {
  const S = (i, k, v) => setKalemler(kalemler.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return <div>
    {kalemler.map((k, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(140px,2fr) minmax(90px,1fr) 90px 90px auto", gap: 6, marginBottom: 6 }} className="hwm-kalem">
      <input style={girdiS} placeholder="Malzeme adı (ör. RRU5258)" value={k.ad} onChange={(e) => S(i, "ad", e.target.value)} list={sabitAdlar ? "hwm-adlar" : undefined} aria-label={`${i + 1}. kalem adı`} />
      <input style={girdiS} placeholder="HW kodu (varsa)" value={k.kod || ""} onChange={(e) => S(i, "kod", e.target.value)} aria-label={`${i + 1}. kalem kodu`} />
      <input style={girdiS} inputMode="decimal" placeholder="Miktar" value={k.miktar} onChange={(e) => S(i, "miktar", e.target.value)} aria-label={`${i + 1}. kalem miktarı`} />
      <select style={girdiS} value={k.birim || "Adet"} onChange={(e) => S(i, "birim", e.target.value)} aria-label="Birim">{["Adet", "Metre", "Set", "Takım", "Kg", "Rulo"].map((b) => <option key={b}>{b}</option>)}</select>
      <button type="button" style={{ ...btn(false), padding: "6px 10px" }} onClick={() => setKalemler(kalemler.filter((_, j) => j !== i))} disabled={kalemler.length <= 1} aria-label="Kalemi kaldır">✕</button>
    </div>)}
    {sabitAdlar && <datalist id="hwm-adlar">{sabitAdlar.map((a) => <option key={a} value={a} />)}</datalist>}
    <button type="button" style={{ ...btn(false), padding: "6px 12px", fontSize: 14 }} onClick={() => setKalemler([...kalemler, { ad: "", kod: "", miktar: "", birim: "Adet" }])}>+ Kalem ekle</button>
  </div>;
}

// Kabul formu (yeni kabul / düzeltme)
function KabulFormu({ is, secenekler, duzeltilen, onKaydedildi, onIptal }) {
  const [f, setF] = useState(() => duzeltilen ? { gelis_tarihi: duzeltilen.islem_tarihi, teslim_tipi: duzeltilen.teslim_tipi, depo_id: String(duzeltilen.hedef_id || ""), aciklama: duzeltilen.aciklama || "",
      eksik_aciklama: duzeltilen.eksik_aciklama || "", kapsam: duzeltilen.kapsam || "RF", belgeler: duzeltilen.belgeler || [], gerekce: "" }
    : { gelis_tarihi: bugun(), teslim_tipi: "", depo_id: String(secenekler?.depolar?.[0]?.id || ""), aciklama: "", eksik_aciklama: "", kapsam: "RF", belgeler: [], eski_kayit_teyidi: !!is?.durum?.eski_kayit });
  const [kalemler, setKalemler] = useState(() => duzeltilen ? duzeltilen.kalemler.map((k) => ({ ...k, miktar: String(k.miktar).replace(".", ",") })) : [{ ad: "", kod: "", miktar: "", birim: "Adet" }]);
  const [hata, setHata] = useState(""); const [bilgi, setBilgi] = useState(""); const [mukerrer, setMukerrer] = useState(null);
  const [gonderiliyor, setGonderiliyor] = useState(false); const [yukleniyor, setYukleniyor] = useState(false);
  const anahtar = useRef(yeniAnahtar());
  const F = (k, v) => { setF((x) => ({ ...x, [k]: v })); setMukerrer(null); };
  const belgeYukle = async (dosya) => {
    if (!dosya) return; setYukleniyor(true); setHata("");
    try { const fd = new FormData(); fd.append("dosya", dosya); const r = await hwApi("/hw-malzeme/belge", { method: "POST", form: fd }); F("belgeler", [...f.belgeler, r.belge]); }
    catch (e) { setHata(e.message); } finally { setYukleniyor(false); }
  };
  const gonder = async (mukerrerOnay = false) => {
    if (gonderiliyor) return;
    setHata(""); setBilgi("");
    if (!f.teslim_tipi) { setHata("Teslim tipini seçin: kısmi ya da tam"); return; }
    setGonderiliyor(true);
    try {
      const kal = kalemler.filter((k) => k.ad || k.kod || k.miktar).map((k) => ({ ...k, miktar: String(k.miktar).trim() }));
      let r;
      if (duzeltilen) r = await hwApi(`/hw-malzeme/islem/${duzeltilen.id}/duzelt`, { method: "POST", anahtar: anahtar.current, body: { gelis_tarihi: f.gelis_tarihi, teslim_tipi: f.teslim_tipi,
        aciklama: f.aciklama, eksik_aciklama: f.teslim_tipi === "KISMI" ? f.eksik_aciklama : null, belgeler: f.belgeler, kalemler: kal, gerekce: f.gerekce } });
      else r = await hwApi("/hw-malzeme/kabul", { method: "POST", anahtar: anahtar.current, body: { site_code: is.site_code, ...f, depo_id: Number(f.depo_id), kalemler: kal, mukerrer_onay: mukerrerOnay } });
      anahtar.current = yeniAnahtar();
      setBilgi(r.tekrar ? "Bu kayıt daha önce alınmıştı; ikinci kez işlenmedi." : "Kaydedildi.");
      onKaydedildi && onKaydedildi(r);
    } catch (e) {
      if (e.http === 409 && e.ek?.mukerrer) setMukerrer(e.ek.mukerrer);
      setHata(e.message);
    } finally { setGonderiliyor(false); }
  };
  return <Kart style={{ borderColor: "#bfdbfe" }}>
    <div style={{ fontWeight: 900, fontSize: 17, marginBottom: 8 }}>{duzeltilen ? `Kabul #${duzeltilen.id} düzelt` : "Malzeme kabulü (depoya giriş)"}</div>
    {is?.durum?.eski_kayit && !duzeltilen && <div style={{ background: "#fef2f2", color: "#991b1b", borderRadius: 8, padding: "8px 10px", marginBottom: 8, fontSize: 14 }}>
      Rollout'ta eski kayıt var: geliş {tarihTR(is.durum.eski_kayit.malzeme_gelis_tarihi)} — tamlığı ve yeri doğrulanmamış. Bu kabul eski kaydın teyidi olarak işaretlenir.</div>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
      <label><span style={etiketS}>Malzeme geliş tarihi</span><input type="date" max={bugun()} style={girdiS} value={f.gelis_tarihi} onChange={(e) => F("gelis_tarihi", e.target.value)} /></label>
      {!duzeltilen && <label><span style={etiketS}>Teslim alınan depo</span><select style={girdiS} value={f.depo_id} onChange={(e) => F("depo_id", e.target.value)}>
        <option value="">Seçin…</option>{(secenekler?.depolar || []).map((d) => <option key={d.id} value={d.id}>{d.ad}</option>)}</select></label>}
      {!duzeltilen && <label><span style={etiketS}>Kapsam</span><select style={girdiS} value={f.kapsam} onChange={(e) => F("kapsam", e.target.value)}>
        <option value="RF">RF / montaj malzemesi</option><option value="ENH">ENH (enerji) malzemesi</option></select></label>}
    </div>
    <div style={{ marginTop: 10 }}>
      <span style={etiketS}>Teslim durumu</span>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="radiogroup" aria-label="Teslim durumu">
        {[["TAM", "✓ Tamamı geldi"], ["KISMI", "◐ Kısmi teslim — eksik var"]].map(([k, ad]) => <button key={k} type="button" role="radio" aria-checked={f.teslim_tipi === k} onClick={() => F("teslim_tipi", k)}
          style={{ ...btn(f.teslim_tipi === k), background: f.teslim_tipi === k ? (k === "TAM" ? "#15803d" : "#b45309") : "#fff", flex: "1 1 200px" }}>{ad}</button>)}
      </div>
    </div>
    {f.teslim_tipi === "KISMI" && <label style={{ display: "block", marginTop: 10 }}><span style={etiketS}>Eksik kalan malzeme (zorunlu)</span>
      <input style={girdiS} value={f.eksik_aciklama} onChange={(e) => F("eksik_aciklama", e.target.value)} placeholder="ör. 1 adet AAU gelmedi" /></label>}
    <div style={{ marginTop: 12 }}><span style={etiketS}>Teslim alınan malzemeler ve miktarlar</span>
      <KalemEditor kalemler={kalemler} setKalemler={setKalemler} sabitAdlar={["RRU", "AAU", "BBU", "Anten", "Jumper", "Fiber", "DC kablo", "Outdoor kabinet", "Pole", "Montaj kiti"]} />
      {duzeltilen && <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Miktar değişirse eski kabul ters kaydedilir ve düzeltilmiş kabul yeni kayıt olur; ikisi de geçmişte görünür.</div>}
    </div>
    <label style={{ display: "block", marginTop: 10 }}><span style={etiketS}>Açıklama</span><input style={girdiS} value={f.aciklama} onChange={(e) => F("aciklama", e.target.value)} placeholder="İrsaliye no, teslim eden vb." /></label>
    <div style={{ marginTop: 10 }}>
      <span style={etiketS}>Teslim belgesi / fotoğraf</span>
      <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => { belgeYukle(e.target.files?.[0]); e.target.value = ""; }} disabled={yukleniyor} />
      {yukleniyor && <span style={{ marginLeft: 8, color: "#64748b" }}>Yükleniyor…</span>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>{f.belgeler.map((b, i) => <span key={i} style={{ background: "#f1f5f9", borderRadius: 8, padding: "3px 8px", fontSize: 13 }}>
        <a href={b.url} target="_blank" rel="noreferrer">{b.ad || `Belge ${i + 1}`}</a> <button type="button" onClick={() => F("belgeler", f.belgeler.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer" }} aria-label="Belgeyi kaldır">✕</button></span>)}</div>
    </div>
    {duzeltilen && <label style={{ display: "block", marginTop: 10 }}><span style={etiketS}>Düzeltme gerekçesi (zorunlu)</span><input style={girdiS} value={f.gerekce} onChange={(e) => F("gerekce", e.target.value)} /></label>}
    {hata && <div role="alert" style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 8, padding: "8px 10px", marginTop: 10, fontWeight: 700 }}>{hata}</div>}
    {bilgi && <div role="status" style={{ background: "#dcfce7", color: "#166534", borderRadius: 8, padding: "8px 10px", marginTop: 10, fontWeight: 700 }}>{bilgi}</div>}
    <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
      <button type="button" style={btn(true)} onClick={() => gonder(false)} disabled={gonderiliyor}>{gonderiliyor ? "Kaydediliyor…" : duzeltilen ? "Düzeltmeyi kaydet" : "Kabulü kaydet"}</button>
      {mukerrer && <button type="button" style={{ ...btn(true), background: "#b45309" }} onClick={() => gonder(true)} disabled={gonderiliyor}>Ayrı teslimat olarak kaydet</button>}
      {onIptal && <button type="button" style={btn(false)} onClick={onIptal}>Vazgeç</button>}
    </div>
  </Kart>;
}

// Depo / ekip hareketi formu
const HAREKET = {
  "ekibe-teslim": { ad: "Ekibe teslim", ac: "Depodan ekibe fiziksel teslim. Plan ataması teslim değildir; malzeme ancak bu kayıtla ekibe geçer." },
  "devir": { ad: "Ekipler arası devir", ac: "Bir ekipteki malzemeyi başka ekibe aktarır (gerekçe zorunlu). Yeni plan malzemeyi kendiliğinden taşımaz." },
  "depoya-donus": { ad: "Ekipten depoya dönüş", ac: "Ekipteki malzeme depoya geri alınır." },
  "kullanim": { ad: "Sahada kullanıldı", ac: "Malzeme montajda kullanıldı (ekipten ya da depodan)." },
  "iade": { ad: "Huawei'ye iade", ac: "Malzeme Huawei'ye iade edildi (gerekçe zorunlu)." },
};
function HareketFormu({ tur, is, secenekler, onKaydedildi, onIptal }) {
  const t = HAREKET[tur];
  const depoBakiye = (is?.bakiye || []).filter((b) => b.lok_tip === "DEPO"), ekipBakiye = (is?.bakiye || []).filter((b) => b.lok_tip === "EKIP");
  const ekipNolar = [...new Set(ekipBakiye.map((b) => b.lok_id))];
  const [f, setF] = useState({ depo_id: String(depoBakiye[0]?.lok_id || secenekler?.depolar?.[0]?.id || ""), ekip_no: "", kaynak_ekip_no: ekipNolar[0] || "", hedef_ekip_no: "",
    kaynak: ekipNolar.length && tur !== "ekibe-teslim" ? `EKIP:${ekipNolar[0]}` : "DEPO", tarih: bugun(), gerekce: "", aciklama: "", arac_plaka: "" });
  const [secim, setSecim] = useState({}); // anahtar → miktar (boş = tümü)
  const [hata, setHata] = useState(""); const [gonderiliyor, setGonderiliyor] = useState(false);
  const anahtar = useRef(yeniAnahtar());
  const F = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const kaynakLok = tur === "ekibe-teslim" ? `DEPO:${f.depo_id}` : tur === "devir" ? `EKIP:${f.kaynak_ekip_no}` : tur === "depoya-donus" ? `EKIP:${f.kaynak_ekip_no}` : f.kaynak;
  const kaynakKalemler = (is?.bakiye || []).filter((b) => `${b.lok_tip}:${b.lok_id}` === kaynakLok);
  const gonder = async () => {
    if (gonderiliyor) return; setHata(""); setGonderiliyor(true);
    try {
      const kalemler = kaynakKalemler.filter((k) => secim[k.anahtar] !== "0").map((k) => ({ ad: k.ad, kod: k.kod, birim: k.birim, miktar: String(secim[k.anahtar] ?? k.miktar).trim() }))
        .filter((k) => k.miktar && k.miktar !== "0");
      if (!kalemler.length) throw new Error("Taşınacak kalem yok");
      const [ktip, kid] = kaynakLok.split(":");
      const body = { site_code: is.site_code, tarih: f.tarih, gerekce: f.gerekce, aciklama: f.aciklama, kalemler };
      // 05.11.2026: araç (isteğe bağlı) — malzeme bu araca yüklendiyse seçilir; seçilmezse "ekipte, araç doğrulanmadı" kalır
      if (tur === "ekibe-teslim") Object.assign(body, { depo_id: Number(f.depo_id), ekip_no: Number(f.ekip_no), arac_plaka: f.arac_plaka || undefined });
      else if (tur === "devir") Object.assign(body, { kaynak_ekip_no: Number(f.kaynak_ekip_no), hedef_ekip_no: Number(f.hedef_ekip_no), arac_plaka: f.arac_plaka || undefined });
      else if (tur === "depoya-donus") Object.assign(body, { ekip_no: Number(f.kaynak_ekip_no), depo_id: Number(f.depo_id) });
      else Object.assign(body, ktip === "EKIP" ? { ekip_no: Number(kid) } : { depo_id: Number(kid) });
      const r = await hwApi(`/hw-malzeme/${tur}`, { method: "POST", anahtar: anahtar.current, body });
      anahtar.current = yeniAnahtar();
      onKaydedildi && onKaydedildi(r);
    } catch (e) { setHata(e.message); } finally { setGonderiliyor(false); }
  };
  const ekipSec = (k, liste, ad) => <label><span style={etiketS}>{ad}</span><select style={girdiS} value={f[k]} onChange={(e) => F(k, e.target.value)}>
    <option value="">Seçin…</option>{liste.map((e) => <option key={e.ekip_no} value={e.ekip_no}>{e.ad}{e.ekip_tipi ? ` · ${e.ekip_tipi.ad}` : ""}{e.bolge ? ` · ${e.bolge}` : ""}</option>)}</select></label>;
  const ekiptekiler = (secenekler?.ekipler || []).filter((e) => ekipNolar.includes(String(e.ekip_no)));
  return <Kart style={{ borderColor: "#fde68a" }}>
    <div style={{ fontWeight: 900, fontSize: 17 }}>{t.ad}</div>
    <div style={{ fontSize: 13.5, color: "#475569", marginBottom: 8 }}>{t.ac}</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
      {tur === "ekibe-teslim" && <><label><span style={etiketS}>Depo</span><select style={girdiS} value={f.depo_id} onChange={(e) => F("depo_id", e.target.value)}>
        {[...new Set(depoBakiye.map((b) => b.lok_id))].map((id) => <option key={id} value={id}>{depoBakiye.find((b) => b.lok_id === id)?.lok_ad}</option>)}</select></label>
        {ekipSec("ekip_no", secenekler?.ekipler || [], "Teslim alan ekip")}</>}
      {(tur === "devir" || tur === "depoya-donus") && ekipSec("kaynak_ekip_no", ekiptekiler, "Malzemenin bulunduğu ekip")}
      {tur === "devir" && ekipSec("hedef_ekip_no", (secenekler?.ekipler || []).filter((e) => String(e.ekip_no) !== String(f.kaynak_ekip_no)), "Devralan ekip")}
      {tur === "depoya-donus" && <label><span style={etiketS}>Depo</span><select style={girdiS} value={f.depo_id} onChange={(e) => F("depo_id", e.target.value)}>
        {(secenekler?.depolar || []).map((d) => <option key={d.id} value={d.id}>{d.ad}</option>)}</select></label>}
      {(tur === "kullanim" || tur === "iade") && <label><span style={etiketS}>Kaynak</span><select style={girdiS} value={f.kaynak} onChange={(e) => F("kaynak", e.target.value)}>
        {[...new Set((is?.bakiye || []).filter((b) => ["DEPO", "EKIP"].includes(b.lok_tip)).map((b) => `${b.lok_tip}:${b.lok_id}`))].map((l) =>
          <option key={l} value={l}>{(is.bakiye.find((b) => `${b.lok_tip}:${b.lok_id}` === l) || {}).lok_ad}</option>)}</select></label>}
      {(tur === "ekibe-teslim" || tur === "devir") && secenekler?.arac_baglantisi_hazir && <label><span style={etiketS}>Yüklendiği araç (isteğe bağlı)</span>
        <select style={girdiS} value={f.arac_plaka} onChange={(e) => F("arac_plaka", e.target.value)}>
          <option value="">Araç seçilmedi — yalnız ekibe</option>{(secenekler?.araclar || []).map((a) => <option key={a.id} value={a.plaka}>{a.plaka}{a.marka ? ` · ${[a.marka, a.model].filter(Boolean).join(" ")}` : ""}</option>)}</select></label>}
      <label><span style={etiketS}>İşlem tarihi</span><input type="date" max={bugun()} style={girdiS} value={f.tarih} onChange={(e) => F("tarih", e.target.value)} /></label>
    </div>
    {(tur === "ekibe-teslim" || tur === "devir") && <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 6 }}>
      {secenekler?.arac_baglantisi_hazir ? "Araç seçilirse malzeme araç panelinde “araçta (bağlantı doğrulandı)” görünür. Araç değişirse yeni devir / teslim kaydı gerekir." : "Araç bağlantısı için veritabanı kurulumu bekliyor; şimdilik yalnız ekibe teslim kaydedilir."}</div>}
    <div style={{ marginTop: 10 }}>
      <span style={etiketS}>Kalemler (boş bırakılan tamamı; 0 yazılan taşınmaz)</span>
      {!kaynakKalemler.length && <div style={{ color: "#b45309" }}>Seçilen kaynakta bu işe ait malzeme yok.</div>}
      {kaynakKalemler.map((k) => <div key={k.anahtar} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", borderTop: "1px solid #f1f5f9" }}>
        <span style={{ flex: 1 }}><b>{k.ad}</b>{k.kod ? <span style={{ color: "#64748b" }}> · {k.kod}</span> : null} — mevcut {sayi(k.miktar)} {k.birim}</span>
        <input style={{ ...girdiS, width: 110 }} inputMode="decimal" placeholder={String(k.miktar)} value={secim[k.anahtar] ?? ""} onChange={(e) => setSecim((s) => ({ ...s, [k.anahtar]: e.target.value }))} aria-label={`${k.ad} miktarı`} />
      </div>)}
    </div>
    {["devir", "iade"].includes(tur) && <label style={{ display: "block", marginTop: 10 }}><span style={etiketS}>Gerekçe (zorunlu)</span><input style={girdiS} value={f.gerekce} onChange={(e) => F("gerekce", e.target.value)} /></label>}
    {!["devir", "iade"].includes(tur) && <label style={{ display: "block", marginTop: 10 }}><span style={etiketS}>Açıklama</span><input style={girdiS} value={f.aciklama} onChange={(e) => F("aciklama", e.target.value)} /></label>}
    {hata && <div role="alert" style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 8, padding: "8px 10px", marginTop: 10, fontWeight: 700 }}>{hata}</div>}
    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
      <button type="button" style={btn(true)} onClick={gonder} disabled={gonderiliyor || !kaynakKalemler.length}>{gonderiliyor ? "Kaydediliyor…" : "Kaydet"}</button>
      <button type="button" style={btn(false)} onClick={onIptal}>Vazgeç</button>
    </div>
  </Kart>;
}

// İş kodu detayı
function IsDetay({ kod, secenekler, onGeri }) {
  const [is, setIs] = useState(null); const [hata, setHata] = useState(""); const [form, setForm] = useState(null); const [yenile, setYenile] = useState(0);
  const [tersHata, setTersHata] = useState("");
  useEffect(() => { let iptal = false; setHata(""); hwApi(`/hw-malzeme/is/${encodeURIComponent(kod)}`).then((d) => { if (!iptal) setIs(d); }).catch((e) => { if (!iptal) setHata(e.message); }); return () => { iptal = true; }; }, [kod, yenile]);
  const tamam = () => { setForm(null); setYenile((n) => n + 1); };
  const ters = async (x) => {
    const g = window.prompt(`#${x.id} ${x.tur_ad} kaydını iptal (ters kayıt) etmek üzeresiniz. Kayıt silinmez. Gerekçe yazın:`);
    if (!g) return; setTersHata("");
    try { await hwApi(`/hw-malzeme/islem/${x.id}/ters`, { method: "POST", anahtar: yeniAnahtar(), body: { gerekce: g } }); tamam(); } catch (e) { setTersHata(e.message); }
  };
  if (hata) return <Kart><div style={{ color: "#b91c1c", fontWeight: 700 }}>{hata}</div><button type="button" style={btn(false)} onClick={onGeri}>← Geri</button></Kart>;
  if (!is) return <Kart>Yükleniyor…</Kart>;
  const d = is.durum, yetki = is.hareket_yetkisi;
  const lokGrup = {}; for (const b of is.bakiye) (lokGrup[b.lok_ad] = lokGrup[b.lok_ad] || []).push(b);
  return <div>
    <button type="button" onClick={onGeri} style={{ background: "none", border: "none", color: "#1d4ed8", fontWeight: 800, cursor: "pointer", padding: 0, fontSize: 15, marginBottom: 8 }}>← Arama</button>
    <Kart>
      <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: ".01em" }}>{is.fiziksel_id || is.site_code}</div>
      <code style={{ fontSize: 16, fontWeight: 800 }}>{is.site_code}</code>
      <div style={{ color: "#475569", marginTop: 2 }}>{[is.bolge && `${is.bolge} bölgesi`, is.il, is.site_type].filter(Boolean).join(" · ")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, marginTop: 10 }}>
        <div style={{ background: "#f8fafc", borderRadius: 10, padding: 10 }}><div style={{ fontSize: 12.5, color: "#64748b" }}>Geldi mi?</div><b>{d.kabul_sayisi ? `Evet · ${d.kabul_sayisi} teslimat` : d.eski_kayit ? "Eski kayıt (teyit bekliyor)" : "Hayır"}</b>
          {d.ilk_gelis && <div style={{ fontSize: 13 }}>İlk geliş {tarihTR(d.ilk_gelis)}{d.son_gelis !== d.ilk_gelis ? ` · son ${tarihTR(d.son_gelis)}` : ""}</div>}</div>
        <div style={{ background: "#f8fafc", borderRadius: 10, padding: 10 }}><div style={{ fontSize: 12.5, color: "#64748b" }}>Tamamı geldi mi?</div><b>{d.teslim_ad}</b>{d.eksik_aciklama && <div style={{ fontSize: 13, color: "#b45309" }}>Eksik: {d.eksik_aciklama}</div>}</div>
        <div style={{ background: "#f8fafc", borderRadius: 10, padding: 10 }}><div style={{ fontSize: 12.5, color: "#64748b" }}>Nerede?</div><HwRozet d={d} /></div>
      </div>
      {is.rollout && <div style={{ fontSize: 13, color: "#475569", marginTop: 8 }}>Rollout Data: malzeme geliş {tarihTR(is.rollout.malzeme_gelis_tarihi)}{is.rollout.enh_malzeme_gelis_tarihi ? ` · ENH ${tarihTR(is.rollout.enh_malzeme_gelis_tarihi)}` : ""} · durum {is.rollout.malzeme_status || "boş"}</div>}
      {is.yansima.filter((y) => y.celiski).map((y, i) => <div key={i} style={{ color: "#b45309", fontSize: 13.5 }}>⚠ {y.celiski}</div>)}
      {yetki && !form && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button type="button" style={btn(true)} onClick={() => setForm({ tur: "kabul" })}>📦 Malzeme kabulü</button>
        {Object.entries(HAREKET).map(([k, v]) => <button key={k} type="button" style={btn(false)} onClick={() => setForm({ tur: k })}>{v.ad}</button>)}
      </div>}
      {!yetki && <div style={{ fontSize: 13, color: "#64748b", marginTop: 8 }}>Salt okunur: depo hareketi yetkiniz yok.</div>}
    </Kart>
    {form?.tur === "kabul" && <KabulFormu is={is} secenekler={secenekler} onKaydedildi={tamam} onIptal={() => setForm(null)} />}
    {form?.tur === "duzelt" && <KabulFormu is={is} secenekler={secenekler} duzeltilen={form.islem} onKaydedildi={tamam} onIptal={() => setForm(null)} />}
    {form && HAREKET[form.tur] && <HareketFormu tur={form.tur} is={is} secenekler={secenekler} onKaydedildi={tamam} onIptal={() => setForm(null)} />}
    <Kart>
      <div style={{ fontWeight: 900, marginBottom: 6 }}>Malzeme nerede? (kalem bazında)</div>
      {!is.bakiye.length && <div style={{ color: "#64748b" }}>Kayıtlı malzeme yok.</div>}
      {Object.entries(lokGrup).map(([lok, l]) => <div key={lok} style={{ padding: "6px 0", borderTop: "1px solid #f1f5f9" }}>
        <b>{lok}</b>: {l.map((b) => `${b.ad} ${sayi(b.miktar)} ${b.birim}`).join(" · ")}</div>)}
    </Kart>
    <Kart>
      <div style={{ fontWeight: 900, marginBottom: 6 }}>Hareketler ve değişiklik geçmişi</div>
      {tersHata && <div role="alert" style={{ color: "#991b1b", fontWeight: 700 }}>{tersHata}</div>}
      {is.islemler.slice().reverse().map((x) => <div key={x.id} style={{ padding: "8px 0", borderTop: "1px solid #f1f5f9", opacity: x.ters_islem_id ? 0.6 : 1 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
          <b>#{x.id} {x.tur_ad}</b>{x.teslim_tipi && <span>· {x.teslim_tipi === "TAM" ? "tam" : "kısmi"}</span>}
          <span style={{ color: "#475569" }}>{x.kaynak} → {x.hedef}{x.arac_plaka ? ` · 🚗 ${x.arac_plaka}` : ""} · {tarihTR(x.islem_tarihi)}</span>
          {x.ters_islem_id && <span style={{ color: "#991b1b", fontWeight: 700 }}>iptal edildi (#{x.ters_islem_id})</span>}
          {x.duzeltilen_islem_id && <span style={{ color: "#1d4ed8" }}>#{x.duzeltilen_islem_id} düzeltmesi</span>}
        </div>
        <div style={{ fontSize: 14 }}>{x.kalemler.map((k) => `${k.ad} ${sayi(k.miktar)} ${k.birim}`).join(" · ")}</div>
        <div style={{ fontSize: 12.5, color: "#64748b" }}>{x.kaydeden} · {zamanTR(x.zaman)} · {x.kanal === "mobil" ? "mobil" : "web"}{x.gerekce ? ` · ${x.gerekce}` : ""}{x.aciklama ? ` · ${x.aciklama}` : ""}{x.eski_kayit_teyidi ? " · eski kayıt teyidi" : ""}</div>
        {x.belgeler?.length > 0 && <div style={{ fontSize: 13 }}>{x.belgeler.map((b, i) => <a key={i} href={b.url} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>📎 {b.ad || `belge ${i + 1}`}</a>)}</div>}
        {x.gecmis?.length > 0 && <details style={{ fontSize: 13 }}><summary style={{ cursor: "pointer" }}>Değişiklikler ({x.gecmis.length})</summary>
          {x.gecmis.map((g, i) => <div key={i}>{zamanTR(g.zaman)} · {g.yapan}: {g.alan} {JSON.stringify(g.eski)} → {JSON.stringify(g.yeni)}{g.gerekce ? ` (${g.gerekce})` : ""}</div>)}</details>}
        {yetki && !x.ters_islem_id && x.tur !== "TERS" && <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          {x.tur === "KABUL" && <button type="button" style={{ ...btn(false), padding: "4px 10px", fontSize: 13 }} onClick={() => setForm({ tur: "duzelt", islem: x })}>Düzelt</button>}
          <button type="button" style={{ ...btn(false), padding: "4px 10px", fontSize: 13 }} onClick={() => ters(x)}>İptal et (ters kayıt)</button></div>}
      </div>)}
      {!is.islemler.length && <div style={{ color: "#64748b" }}>Henüz hareket yok.</div>}
    </Kart>
  </div>;
}

// Depo özeti — fiziksel saha / iş kaydı / malzeme miktarı AYRI
export function HwDepoOzet({ onSec }) {
  const [v, setV] = useState(null); const [hata, setHata] = useState(""); const [grup, setGrup] = useState("depoda_montaj_bekliyor");
  useEffect(() => { hwApi("/hw-malzeme/depo-ozet").then(setV).catch((e) => setHata(e.message)); }, []);
  if (hata) return <Kart><span style={{ color: "#b91c1c" }}>{hata}</span></Kart>;
  if (!v) return <Kart>Yükleniyor…</Kart>;
  const G = [["depoda_montaj_bekliyor", "Depoda · Montaj bekliyor", (x) => x.konum === "DEPODA" && x.teslim === "TAM" && !x.montaj_basladi],
    ["depoda_kismi", "Depoda · Kısmi teslim", (x) => x.konum === "DEPODA" && x.teslim === "KISMI"], ["ekipte", "Ekipte", (x) => x.konum === "EKIPTE"],
    ["kismen_ekip_depo", "Kısmen ekipte kısmen depoda", (x) => x.konum === "KISMEN_EKIP_DEPO"], ["kullanildi", "Kullanıldı", (x) => x.konum === "KULLANILDI"],
    ["iade", "İade", (x) => x.konum === "IADE"], ["eski_teyit", "Eski kayıt · teyit bekliyor", (x) => x.konum === "ESKI_TEYIT"]];
  const sec = G.find((g) => g[0] === grup);
  const liste = v.isler.filter(sec[2]);
  return <div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8 }}>
      {G.map(([k, ad]) => { const o = v.ozet[k]; return <button key={k} type="button" onClick={() => setGrup(k)} aria-pressed={grup === k}
        style={{ textAlign: "left", border: `2px solid ${grup === k ? LAC : "#e2e8f0"}`, borderRadius: 12, background: grup === k ? "#eff6ff" : "#fff", padding: 10, cursor: "pointer" }}>
        <div style={{ fontWeight: 800 }}>{ad}</div>
        <div style={{ fontSize: 14 }}><b style={{ fontSize: 20 }}>{o.fiziksel_saha}</b> saha · <b>{o.is_kaydi}</b> iş · {sayi(o.malzeme_miktari)} kalem adedi</div></button>; })}
    </div>
    <div style={{ fontSize: 12.5, color: "#64748b", margin: "6px 0 10px" }}>{v.aciklama}</div>
    <Kart>
      <div style={{ fontWeight: 900, marginBottom: 6 }}>{sec[1]} ({liste.length} iş)</div>
      {liste.map((x) => <div key={x.site_code} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "6px 0", borderTop: "1px solid #f1f5f9" }}>
        <button type="button" onClick={() => onSec && onSec(x.site_code)} style={{ background: "none", border: "none", color: "#1d4ed8", fontWeight: 900, cursor: "pointer", padding: 0, fontSize: 15 }}>{x.fiziksel_id}</button>
        <code>{x.site_code}</code><span style={{ color: "#475569", fontSize: 13 }}>{[x.bolge, x.il].filter(Boolean).join(" · ")}</span><HwRozet d={x} kucuk />
        {x.ilk_gelis && <span style={{ fontSize: 13 }}>geliş {tarihTR(x.ilk_gelis)}</span>}{x.eksik_aciklama && <span style={{ fontSize: 13, color: "#b45309" }}>eksik: {x.eksik_aciklama}</span>}
      </div>)}
      {!liste.length && <div style={{ color: "#64748b" }}>Bu grupta iş yok.</div>}
    </Kart>
  </div>;
}

function TeyitListesi({ onSec }) {
  const [v, setV] = useState(null); const [hata, setHata] = useState("");
  useEffect(() => { hwApi("/hw-malzeme/teyit-listesi").then(setV).catch((e) => setHata(e.message)); }, []);
  if (hata) return <Kart><span style={{ color: "#b91c1c" }}>{hata}</span></Kart>;
  if (!v) return <Kart>Yükleniyor…</Kart>;
  return <div>
    <Kart style={{ background: "#fffbeb", borderColor: "#fde68a" }}>Rollout'ta yalnız geliş tarihi olan işler <b>tam teslim</b> ya da <b>halen depoda</b> sayılmaz. Depoda sayım yapıp "Malzeme kabulü" ile
      teyit edin. Öneri sütunu yalnız montaj kayıtlarına dayalı bir ipucudur; kayıt yazılmaz. ({v.ozet.fiziksel_saha} saha · {v.ozet.is_kaydi} iş)</Kart>
    {v.celiskiler.length > 0 && <Kart style={{ borderColor: "#fecaca" }}><b>Rollout ile çelişen kayıtlar</b>{v.celiskiler.map((c) => <div key={c.site_code + c.kapsam} style={{ fontSize: 14 }}>
      <button type="button" onClick={() => onSec(c.site_code)} style={{ background: "none", border: "none", color: "#1d4ed8", fontWeight: 800, cursor: "pointer", padding: 0 }}>{c.site_code}</button> ({c.kapsam}): {c.celiski}</div>)}</Kart>}
    <Kart>
      {v.eski_kayitlar.map((x) => <div key={x.site_code} style={{ padding: "6px 0", borderTop: "1px solid #f1f5f9" }}>
        <button type="button" onClick={() => onSec(x.site_code)} style={{ background: "none", border: "none", color: "#1d4ed8", fontWeight: 900, cursor: "pointer", padding: 0, fontSize: 15 }}>{x.site_code}</button>
        <span style={{ color: "#475569", fontSize: 13 }}> · {[x.bolge, x.il].filter(Boolean).join(" · ")} · geliş {tarihTR(x.malzeme_gelis_tarihi || x.enh_malzeme_gelis_tarihi)} · durum {x.malzeme_status || "boş"}</span>
        <div style={{ fontSize: 13.5, color: x.oneri.kod === "TEYIT" ? "#991b1b" : "#92400e" }}>{x.oneri.ad}</div></div>)}
      {!v.eski_kayitlar.length && <div style={{ color: "#64748b" }}>Teyit bekleyen eski kayıt yok.</div>}
    </Kart>
  </div>;
}

export default function HwMalzemePanel({ onBack, baslangicKod = null }) {
  const [sekme, setSekme] = useState(baslangicKod ? "ARA" : "ARA");
  const [q, setQ] = useState(""); const [sonuclar, setSonuclar] = useState([]); const [araniyor, setAraniyor] = useState(false); const [hata, setHata] = useState("");
  const [secili, setSecili] = useState(baslangicKod); const [secenekler, setSecenekler] = useState(null);
  useEffect(() => { hwApi("/hw-malzeme/secenekler").then(setSecenekler).catch((e) => setHata(e.message)); }, []);
  useEffect(() => {
    const t = q.replace(/\s+/g, ""); if (t.length < 2) { setSonuclar([]); return; }
    let iptal = false; setAraniyor(true);
    const z = setTimeout(() => hwApi(`/hw-malzeme/ara?q=${encodeURIComponent(t)}`).then((d) => { if (!iptal) setSonuclar(d.sonuclar); }).catch((e) => { if (!iptal) setHata(e.message); }).finally(() => { if (!iptal) setAraniyor(false); }), 250);
    return () => { iptal = true; clearTimeout(z); };
  }, [q]);
  const ac = (kod) => { setSecili(kod); setSekme("ARA"); };
  const gruplu = useMemo(() => { const m = {}; for (const s of sonuclar) (m[s.fiziksel_id || s.site_code] = m[s.fiziksel_id || s.site_code] || []).push(s); return m; }, [sonuclar]);
  return <div style={{ maxWidth: 1100, margin: "0 auto", padding: "12px 12px 40px", color: "#0f172a", textAlign: "left" }}>
    <style>{`@media (max-width: 640px) { .hwm-kalem { grid-template-columns: 1fr 1fr !important; } }`}</style>
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
      {onBack && <button type="button" style={btn(false)} onClick={onBack}>← Geri</button>}
      <h2 style={{ margin: 0, fontSize: 22 }}>📦 HW Malzeme Durumu</h2>
      <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }} role="tablist">
        {[["ARA", "Site / iş ara"], ["DEPO", "Depodaki sahalar"], ["TEYIT", "Teyit listesi"]].map(([k, ad]) =>
          <button key={k} type="button" role="tab" aria-selected={sekme === k} onClick={() => { setSekme(k); if (k === "ARA") setSecili(null); }} style={{ ...btn(sekme === k), padding: "8px 14px" }}>{ad}</button>)}
      </div>
    </div>
    {hata && <div role="alert" style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 8 }}>{hata}</div>}
    {sekme === "ARA" && !secili && <Kart>
      <label><span style={etiketS}>Site ID ya da tam iş kodu</span>
        <input autoFocus style={{ ...girdiS, fontSize: 17 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ör. KA3737 ya da KA3737_NR700_MWA" /></label>
      {araniyor && <div style={{ color: "#64748b", marginTop: 6 }}>Aranıyor…</div>}
      {Object.entries(gruplu).map(([fiz, l]) => <div key={fiz} style={{ borderTop: "1px solid #f1f5f9", padding: "8px 0" }}>
        <div style={{ fontWeight: 900, fontSize: 17 }}>{fiz} <span style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>{l.length > 1 ? `${l.length} iş — her biri ayrı` : ""}</span></div>
        {l.map((s) => <button key={s.site_code} type="button" onClick={() => setSecili(s.site_code)}
          style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", width: "100%", textAlign: "left", border: "1px solid #e2e8f0", background: "#fff", borderRadius: 10, padding: "8px 10px", marginTop: 6, cursor: "pointer" }}>
          <code style={{ fontWeight: 800, fontSize: 15 }}>{s.site_code}</code><span style={{ color: "#64748b", fontSize: 13 }}>{[s.bolge, s.il, s.site_type].filter(Boolean).join(" · ")}</span><HwRozet d={s.durum} kucuk /></button>)}
      </div>)}
      {q.replace(/\s+/g, "").length >= 2 && !araniyor && !sonuclar.length && <div style={{ color: "#64748b", marginTop: 6 }}>Kapsamınızda eşleşen iş kodu yok.</div>}
    </Kart>}
    {sekme === "ARA" && secili && <IsDetay kod={secili} secenekler={secenekler} onGeri={() => setSecili(null)} />}
    {sekme === "DEPO" && <HwDepoOzet onSec={ac} />}
    {sekme === "TEYIT" && <TeyitListesi onSec={ac} />}
  </div>;
}
