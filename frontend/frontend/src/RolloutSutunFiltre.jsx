// 02.11.2026 (Orhan): Rollout Data tablosu — sütun bazlı hızlı filtre (Huawei paneli gibi).
// Huni düğmesi sütun başlıklarının hemen ÜZERİNDE, her sütunla hizalı bir filtre satırı açar. Her kutu yalnız kendi sütununda
// arar; filtreler birlikte (VE) çalışır. Filtre, ekrana zaten inmiş YETKİLİ satır kümesine uygulanır (sunucu firma kapsamı ve
// maske değişmez); seçim seçenekleri de yalnız bu kümeden üretilir — başka firmanın verisi açılmaz.
// ERC ve Teknocenter aynı RolloutDashboard bileşenini kullandığı için mantık tek yerde.
// Bileşenler modül düzeyindedir (render içinde tanımlanan bileşen her tuşta yeniden kurulur ve imleç kutudan düşer).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ── Ortak yardımcılar ───────────────────────────────────────────────────────────────────────────────────────────
// Türkçe harf katlama: "bartın" / "BARTIN" / "Bartın" / "BARTİN" aynı; İ/I/ı/i ve Ş/S, Ğ/G, Ü/U, Ö/O, Ç/C eşit sayılır.
export const sutunKatla = (v) => String(v ?? "").toLocaleUpperCase("tr-TR").replace(/̇/g, "")
  .replace(/İ/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C")
  .replace(/\s+/g, " ").trim();

// Tablodaki milestone hücreleriyle AYNI türetme (ekranda ✅ görünen sahada filtre de "Tamamlandı" der)
export function rolloutMilestone(row) {
  return {
    rfRcv: !!(row.installation_actual_start_date || (String(row.malzeme_status || "").toUpperCase() === "OK")),
    rfStart: !!row.installation_actual_start_date,
    rfFin: !!row.installation_actual_end_date,
    qcOk: String(row.qc_durum || "").toUpperCase() === "OK",
    accept: !!row.pac_actual_end_date,
  };
}

// Tarih → yerel gün anahtarı (YYYY-MM-DD). Tablo tarihleri new Date(..).toLocaleDateString ile gösterir; aynı dönüşüm.
// null = boş (ekranda boş görünen geçersiz değer dahil), "NA" = N/A (uygulanmaz)
export function tarihAnahtari(v) {
  if (v == null || v === "") return null;
  if (v === "N/A" || v === "__NA__") return "NA";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const gunTR = (k) => (k ? `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(0, 4)}` : "");

// ── Sütun tanımı: tablo gövdesindeki hücre sırasıyla BİREBİR aynı (58 sütun) ─────────────────────────────────────
// tip: null (işlem düğmesi — kutu yok) · metin ("içerir") · secim (gerçek değer listesi) · tarih · ms (milestone)
const M = (anahtar, ad) => ({ anahtar: `ms_${anahtar}`, ad, tip: "ms", deger: (r) => rolloutMilestone(r)[anahtar] });
const T = (alan, ad) => ({ anahtar: alan, ad, tip: "metin", deger: (r) => r[alan] });
const S = (alan, ad) => ({ anahtar: alan, ad, tip: "secim", deger: (r) => r[alan] });
const D = (alan, ad) => ({ anahtar: alan, ad, tip: "tarih", deger: (r) => r[alan] });
export const ROLLOUT_SUTUNLAR = [
  { anahtar: "_guncelle", ad: "Güncelle", tip: null },
  { anahtar: "_belgeler", ad: "Belgeler", tip: null },
  M("rfRcv", "RF Rcv"), M("rfStart", "RF Start"), M("rfFin", "RF Fin"), M("qcOk", "QC OK"), M("accept", "Accept"),
  S("bolge", "Bölge"), S("site_type", "Site Type"), S("site_physical_type", "Site Fiziksel Tip"), T("project_code", "Project Code"),
  { ...T("site_code", "Site Code"), sabit: true }, S("malzeme_status", "Malzeme Status"), T("il", "İl"),
  T("rf_subcon", "RF Subcon"), D("inst_plan_start_date", "Plan Start Date"), D("installation_actual_start_date", "Installation Start Date"),
  D("installation_actual_end_date", "Installation End Date"), D("onair_date", "OnAir Date"), D("qc_closed_date", "QC Closed Date"), T("rf_not", "RF Not"),
  T("los_subcon", "LOS Subcon"), D("los_plan_date", "LOS Plan Start Date"), D("los_actual_end_date", "LOS Actual End Date"),
  T("tss_subcon", "TSS Subcon"), D("tss_plan_start_date", "TSS Plan Start Date"), D("tss_actual_end_date", "TSS Actual End Date"),
  T("tssr_subcon", "TSSR Subcon"), D("tssr_plan_start_date", "TSSR Planned Start Date"), D("tssr_actual_end_date", "TSSR Actual End Date"),
  T("btk_subcon", "BTK Subcon"), D("btk_plan_start_date", "BTK Planned Start Date"), D("btk_actual_end_date", "BTK Actual End Date"),
  D("btk_approved", "BTK Approval Status"), S("gs_status", "GS Status"), S("atlas_status", "Atlas Status"),
  T("survey_note", "Survey Note"),
  T("emr_subcon", "EMR Subcon"), D("emr_plan_start_date", "EMR Plan Start Date"), D("emr_actual_end_date", "EMR Actual End Date"),
  T("ysb_subcon", "YSB Subcon"), D("ysb_plan_start_date", "YSB Plan Start Date"), D("ysb_actual_end_date", "YSB Actual End Date"),
  T("trs_subcon", "TRS Subcon"), D("trs_plan_start_date", "TRS Plan Start Date"), D("trs_actual_end_date", "TRS Actual End Date"), T("trs_not", "TRS Not"),
  S("enh_site_type", "ENH Site Type"), T("enh_subcon", "ENH Subcon"), D("enh_plan_start_date", "ENH Planned Start Date"),
  D("enh_actual_end_date", "ENH Actual End Date"), T("enh_not", "ENH Not"),
  T("power_subcon", "Power Subcon"), D("power_plan_start_date", "Power Project Planned Start Date"), D("power_actual_end_date", "Power Project Actual End Date"),
  D("abonelik_actual_end_date", "Abonelik"), D("tt_horizon_actual_end_date", "Horizon"), D("pac_actual_end_date", "PAC"),
];
const SUTUN = Object.fromEntries(ROLLOUT_SUTUNLAR.map((s) => [s.anahtar, s]));
const BOS = "__BOS__";

// Filtre değeri etkin mi (boş metin / "Tümü" / yarım tarih etkin sayılmaz)
export function sutunFiltreEtkin(s, f) {
  if (!s || !s.tip || f == null) return false;
  if (s.tip === "metin") return sutunKatla(f) !== "";
  if (s.tip === "secim" || s.tip === "ms") return f !== "";
  if (s.tip === "tarih") return !!f.mod && (f.mod === "gun" ? !!f.bas : f.mod === "aralik" ? !!(f.bas || f.bit) : true);
  return false;
}
export const sutunFiltreSayisi = (filtre) => Object.entries(filtre || {}).filter(([k, f]) => sutunFiltreEtkin(SUTUN[k], f)).length;

// Satırlara tüm etkin sütun filtrelerini VE ile uygular
export function sutunFiltreUygula(rows, filtre) {
  const etkin = Object.entries(filtre || {}).filter(([k, f]) => sutunFiltreEtkin(SUTUN[k], f)).map(([k, f]) => {
    const s = SUTUN[k];
    if (s.tip === "metin") { const q = sutunKatla(f); return (r) => sutunKatla(s.deger(r)).includes(q); }
    if (s.tip === "ms") return (r) => (f === "TAMAM") === !!s.deger(r);
    if (s.tip === "secim") return (r) => { const v = String(s.deger(r) ?? "").trim(); return f === BOS ? v === "" : sutunKatla(v) === sutunKatla(f); };
    // tarih
    return (r) => {
      const k2 = tarihAnahtari(s.deger(r));
      if (f.mod === "bos") return k2 === null;
      if (f.mod === "dolu") return k2 !== null && k2 !== "NA";
      if (f.mod === "na") return k2 === "NA";
      if (!k2 || k2 === "NA") return false;
      if (f.mod === "gun") return k2 === f.bas;
      return (!f.bas || k2 >= f.bas) && (!f.bit || k2 <= f.bit);
    };
  });
  if (!etkin.length) return rows;
  return rows.filter((r) => etkin.every((t) => t(r)));
}

// Seçim sütunlarının seçenekleri: yalnız verilen (yetkili) satırlardaki gerçek değerler + sayı; boş varsa "(Boş)"
export function sutunSecenekleri(rows) {
  const o = {};
  for (const s of ROLLOUT_SUTUNLAR) {
    if (s.tip !== "secim" && s.tip !== "tarih") continue;
    const say = new Map(); let bos = 0, na = 0;
    for (const r of rows || []) {
      if (s.tip === "tarih") { if (tarihAnahtari(s.deger(r)) === "NA") na++; continue; }
      const v = String(s.deger(r) ?? "").trim();
      if (!v) { bos++; continue; }
      const k = sutunKatla(v);
      const e = say.get(k); if (e) e.n++; else say.set(k, { deger: v, n: 1 });
    }
    o[s.anahtar] = s.tip === "tarih" ? { na }
      : { liste: [...say.values()].sort((a, b) => a.deger.localeCompare(b.deger, "tr")), bos };
  }
  return o;
}

// ── Görünüm parçaları ───────────────────────────────────────────────────────────────────────────────────────────
export function HuniIkon({ boyut = 14 }) {
  return (
    <svg width={boyut} height={boyut} viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ flex: "none" }}>
      <path d="M3 4.5h18l-7 8.2V19l-4 1.8v-8.1L3 4.5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

const Temizle = ({ ad, onClick }) => (
  <button type="button" className="rsfX" aria-label={`${ad} filtresini temizle`} title={`${ad} filtresini temizle`} onClick={onClick}>×</button>
);

// Metin kutusu: yerel değer + kısa bekleme (200 ms) ile üst duruma yazar → yazarken takılma yok, imleç kutuda kalır
function MetinKutu({ s, deger, onDegis }) {
  const [yerel, setYerel] = useState(deger || "");
  const zaman = useRef(null);
  const sonGonderilen = useRef(deger || "");
  useEffect(() => {
    // Dışarıdan değişim (tek / toplu temizleme): bekleyen yazımı iptal et, kutuyu eşitle
    if ((deger || "") !== sonGonderilen.current) { clearTimeout(zaman.current); sonGonderilen.current = deger || ""; setYerel(deger || ""); }
  }, [deger]);
  useEffect(() => () => clearTimeout(zaman.current), []);
  const gonder = (v) => { sonGonderilen.current = v; onDegis(s.anahtar, v); };
  return (
    <div className={`rsfKutu${yerel ? " rsfDolu" : ""}`}>
      <input type="text" size={1} value={yerel} placeholder="içerir…" aria-label={`${s.ad} sütununda ara`} spellCheck={false} autoComplete="off"
        onChange={(e) => { const v = e.target.value; setYerel(v); clearTimeout(zaman.current); zaman.current = setTimeout(() => gonder(v), 200); }}
        onKeyDown={(e) => { if (e.key === "Enter") { clearTimeout(zaman.current); gonder(yerel); } if (e.key === "Escape" && yerel) { clearTimeout(zaman.current); setYerel(""); gonder(""); } }} />
      {yerel && <Temizle ad={s.ad} onClick={() => { clearTimeout(zaman.current); setYerel(""); gonder(""); }} />}
    </div>
  );
}

function SecimKutu({ s, deger, onDegis, secenek }) {
  const ms = s.tip === "ms";
  const liste = secenek?.liste || [];
  // Seçili değer artık listede yoksa da görünsün (örn. üst filtre değişti) — kullanıcı neyin etkin olduğunu görür
  const eksik = !ms && deger && deger !== BOS && !liste.some((o) => sutunKatla(o.deger) === sutunKatla(deger));
  return (
    <div className={`rsfKutu${deger ? " rsfDolu" : ""}`}>
      <select value={deger || ""} aria-label={`${s.ad} filtresi`} onChange={(e) => onDegis(s.anahtar, e.target.value)}>
        <option value="">Tümü</option>
        {ms ? <>
          <option value="TAMAM">Tamamlandı</option>
          <option value="BEKLIYOR">Bekliyor</option>
        </> : <>
          {liste.map((o) => <option key={o.deger} value={o.deger}>{o.deger} ({o.n})</option>)}
          {eksik && <option value={deger}>{deger} (0)</option>}
          {(secenek?.bos > 0 || deger === BOS) && <option value={BOS}>(Boş){secenek?.bos ? ` (${secenek.bos})` : ""}</option>}
        </>}
      </select>
      {deger && <Temizle ad={s.ad} onClick={() => onDegis(s.anahtar, "")} />}
    </div>
  );
}

const TARIH_MOD = [["", "Tümü"], ["gun", "Belirli gün"], ["aralik", "Tarih aralığı"], ["bos", "Boş olanlar"], ["dolu", "Tarihi dolu olanlar"]];
export function tarihOzeti(f) {
  if (!f || !f.mod) return "";
  if (f.mod === "gun") return f.bas ? gunTR(f.bas) : "";
  if (f.mod === "aralik") return f.bas && f.bit ? `${gunTR(f.bas)} – ${gunTR(f.bit)}` : f.bas ? `${gunTR(f.bas)} →` : f.bit ? `→ ${gunTR(f.bit)}` : "";
  return { bos: "Boş", dolu: "Dolu", na: "N/A" }[f.mod] || "";
}

// Tarih kutusu: düğme + gövdeye taşınan küçük pencere (tablo kaydırma alanında kesilmez)
function TarihKutu({ s, deger, onDegis, secenek }) {
  const [acik, setAcik] = useState(false);
  const [konum, setKonum] = useState(null);
  const dugme = useRef(null), pencere = useRef(null);
  const f = deger || {};
  const ozet = sutunFiltreEtkin(s, f) ? tarihOzeti(f) : "";
  const ac = () => {
    const r = dugme.current?.getBoundingClientRect(); if (!r) return;
    const gen = 250;
    setKonum({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - gen - 8)), width: gen });
    setAcik(true);
  };
  useEffect(() => {
    if (!acik) return undefined;
    const disari = (e) => { if (!pencere.current?.contains(e.target) && !dugme.current?.contains(e.target)) setAcik(false); };
    const esc = (e) => { if (e.key === "Escape") { setAcik(false); dugme.current?.focus(); } };
    // Tablo / sayfa kayarsa pencere sütunundan ayrılmasın diye kapanır (pencerenin kendi içindeki kaydırma hariç)
    const kay = (e) => { if (!pencere.current?.contains(e.target)) setAcik(false); };
    document.addEventListener("mousedown", disari); document.addEventListener("keydown", esc);
    window.addEventListener("scroll", kay, true); window.addEventListener("resize", kay);
    return () => { document.removeEventListener("mousedown", disari); document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", kay, true); window.removeEventListener("resize", kay); };
  }, [acik]);
  const yaz = (yeni) => onDegis(s.anahtar, { ...f, ...yeni });
  const modlar = secenek?.na > 0 || f.mod === "na" ? [...TARIH_MOD, ["na", `N/A (uygulanmaz)${secenek?.na ? ` (${secenek.na})` : ""}`]] : TARIH_MOD;
  return (
    <div className={`rsfKutu${ozet ? " rsfDolu" : ""}`}>
      <button type="button" ref={dugme} className="rsfTarihDugme" aria-haspopup="dialog" aria-expanded={acik}
        aria-label={`${s.ad} tarih filtresi${ozet ? `: ${ozet}` : ""}`} title={ozet || "Tarihe göre süz"} onClick={() => (acik ? setAcik(false) : ac())}>
        <span className={ozet ? "" : "rsfYerTutucu"}>{ozet || "tarih…"}</span><span aria-hidden="true" className="rsfOk">▾</span>
      </button>
      {ozet && <Temizle ad={s.ad} onClick={() => { onDegis(s.anahtar, null); setAcik(false); }} />}
      {acik && konum && createPortal(
        <div ref={pencere} role="dialog" aria-label={`${s.ad} tarih filtresi`} className="rsfTarihPencere" style={{ top: konum.top, left: konum.left, width: konum.width }}>
          <div className="rsfTarihBaslik">{s.ad}</div>
          <label className="rsfTarihSatir">Ölçüt
            <select value={f.mod || ""} autoFocus onChange={(e) => yaz({ mod: e.target.value })}>
              {modlar.map(([k, ad]) => <option key={k} value={k}>{ad}</option>)}
            </select>
          </label>
          {f.mod === "gun" && <label className="rsfTarihSatir">Gün<input type="date" value={f.bas || ""} onChange={(e) => yaz({ bas: e.target.value })} /></label>}
          {f.mod === "aralik" && <>
            <label className="rsfTarihSatir">Başlangıç<input type="date" value={f.bas || ""} max={f.bit || undefined} onChange={(e) => yaz({ bas: e.target.value })} /></label>
            <label className="rsfTarihSatir">Bitiş<input type="date" value={f.bit || ""} min={f.bas || undefined} onChange={(e) => yaz({ bit: e.target.value })} /></label>
            <div className="rsfTarihNot">Yalnız biri dolarsa o günden sonrası / öncesi alınır (uç günler dahil).</div>
          </>}
          <div className="rsfTarihAlt">
            <button type="button" className="rsfTarihTemizle" disabled={!f.mod} onClick={() => onDegis(s.anahtar, null)}>Temizle</button>
            <button type="button" className="rsfTarihTamam" onClick={() => { setAcik(false); dugme.current?.focus(); }}>Tamam</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Filtre satırı: thead içinde, sütun adlarının hemen ÜSTÜNDE; her hücre kendi sütununun altında (aynı tablo → kaymaz)
export function RolloutSutunFiltreSatiri({ filtre, onDegis, secenekler }) {
  return (
    <tr className="rsfSatir">
      {ROLLOUT_SUTUNLAR.map((s) => (
        <th key={s.anahtar} className={`rsfHucre${s.sabit ? " siteIdCell" : ""}${s.tip === "ms" ? " rsfMs" : ""}`} scope="col">
          {s.tip === "metin" && <MetinKutu s={s} deger={filtre[s.anahtar]} onDegis={onDegis} />}
          {(s.tip === "secim" || s.tip === "ms") && <SecimKutu s={s} deger={filtre[s.anahtar]} onDegis={onDegis} secenek={secenekler[s.anahtar]} />}
          {s.tip === "tarih" && <TarihKutu s={s} deger={filtre[s.anahtar]} onDegis={onDegis} secenek={secenekler[s.anahtar]} />}
        </th>
      ))}
    </tr>
  );
}

// Huni düğmesi (araç çubuğu): satırı açar / kapatır; kapalıyken de etkin filtre sayısı görünür
export function SutunFiltreDugmesi({ acik, sayi, onClick }) {
  return (
    <button type="button" className={`rsfDugme${sayi ? " rsfDugmeDolu" : ""}${acik ? " rsfDugmeAcik" : ""}`} aria-pressed={acik} onClick={onClick}
      title={acik ? "Sütun filtre satırını gizle (filtreler korunur)" : "Sütun başlıklarının üstünde filtre kutularını aç"}>
      <HuniIkon /> Sütun filtreleri{sayi ? <span className="rsfRozet" aria-label={`${sayi} etkin filtre`}>{sayi}</span> : null}
    </button>
  );
}

// Tablonun üstündeki bilgi şeridi: etkin filtre sayısı, gösterilen / toplam, etkin filtre etiketleri, toplu temizleme
export function SutunFiltreBilgi({ filtre, gosterilen, ustSonrasi, toplam, onTemizle, onTekTemizle }) {
  const etkin = useMemo(() => ROLLOUT_SUTUNLAR.filter((s) => sutunFiltreEtkin(s, filtre[s.anahtar])), [filtre]);
  const etiket = (s) => {
    const f = filtre[s.anahtar];
    if (s.tip === "metin") return `“${String(f).trim()}”`;
    if (s.tip === "ms") return f === "TAMAM" ? "Tamamlandı" : "Bekliyor";
    if (s.tip === "secim") return f === BOS ? "(Boş)" : f;
    return tarihOzeti(f);
  };
  return (
    <div className="rsfBilgi" role="status" aria-live="polite">
      <span className="rsfBilgiSayi"><HuniIkon boyut={13} /> {etkin.length ? `${etkin.length} sütun filtresi etkin` : "Sütun filtresi yok"}</span>
      <span className="rsfBilgiAyrac" aria-hidden="true">·</span>
      <span>Gösterilen <b>{gosterilen}</b> / toplam <b>{toplam}</b> iş</span>
      {ustSonrasi !== toplam && <span className="rsfBilgiNot" title="Genel arama, bölge, saha tipi, ENH tipi ve firma/taşeron filtrelerinden sonra kalan iş">(üst filtreler sonrası {ustSonrasi})</span>}
      {etkin.map((s) => (
        <span key={s.anahtar} className="ftfEtiket rsfEtiket">
          {s.ad}: {etiket(s)}
          <button type="button" aria-label={`${s.ad} filtresini temizle`} onClick={() => onTekTemizle(s.anahtar)}>×</button>
        </span>
      ))}
      {etkin.length > 0 && <button type="button" className="rsfHepsiniTemizle" onClick={onTemizle}>Tüm sütun filtrelerini temizle</button>}
    </div>
  );
}
