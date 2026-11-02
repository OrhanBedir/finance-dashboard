// ═══ ATANAN İŞ TUTARI — DETAY LİSTESİ + EXCEL (02.11.2026, Orhan — Teknocenter Bölge Analizi) ═══════════════════
// Kart değeri, bu liste ve Excel aynı sunucu hesabından (/finance/atanan-is → backend/atananIs.js) gelir; burada yeniden
// hesap yapılmaz, yalnız biçimlenir. Para birimleri ayrı gösterilir (TRY / USD kurla toplanmaz).
import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";

const sayi = (v, d = 2) => (v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString("tr-TR", { maximumFractionDigits: d }));
const PB = { TRY: "₺", USD: "$", EUR: "€" };
export const paraMetni = (o) => {
  const l = Object.entries(o || {}).filter(([, v]) => Number(v));
  return l.length ? l.map(([pb, v]) => `${PB[pb] || pb + " "}${sayi(v, 0)}`).join(" + ") : "—";
};
const DURUM = {
  DAHIL: "Hesapta",
  FIYATSIZ: "⚠️ Fiyat doğrulanamadı",
  INCELEME: "🔎 İnceleme",
  HARIC: "Hesaba alınmadı",
};
// 02.11.2026 (Orhan): tutarlar tek TL — USD kalem TCMB döviz satış kuruyla çevrilir; kur yoksa para birimleri ayrı kalır
export const tlMetni = (tl, o) => (tl === null || tl === undefined ? paraMetni(o) : `₺${sayi(tl, 0)}`);
const usdNotu = (o) => (Number(o?.USD || 0) ? ` (${paraMetni({ USD: o.USD })})` : "");
export const kurMetni = (oz) => (oz?.usd_cevrildi && oz?.kur?.usd_try ? `USD kalemler ${oz.kur.kaynak || "TCMB"} kuruyla TL'ye çevrildi (1 USD = ₺${sayi(oz.kur.usd_try, 4)})` : "");
export const durumMetni = (s) => (s.durum === "DAHIL" && s.kismi_fiyatsiz ? "⚠️ Kısmen fiyatsız" : DURUM[s.durum] || s.durum);
const poMetni = (s) => (s.po_satirlari || []).map((p) => `${p.po_no}${p.po_line_no ? " / " + p.po_line_no : ""}${p.shipment_no ? " / " + p.shipment_no : ""}`).join(" · ");
const boqSurum = (s) => (s.boq ? s.boq.surum : "");

// Tablo ve Excel'in ortak sütunları: [başlık, değer(s), sayısal mı, genişlik]
export const ATANAN_SUTUNLAR = [
  ["Durum", durumMetni, false, 18],
  ["Fiziksel Site ID", (s) => s.fiziksel_id || "", false, 14],
  ["İş Kodu", (s) => s.is_kodu, false, 24],
  ["PR Satır No", (s) => `#${s.id}`, false, 11],
  ["Kalem Kodu", (s) => s.item_code, false, 13],
  ["Kalem Açıklaması", (s) => s.aciklama, false, 44],
  ["Talep (PR) Miktarı", (s) => s.pr_qty, true, 12],
  ["Birim", (s) => s.birim || "", false, 8],
  ["Fiziki Gerçekleşen", (s) => (s.fiziki_qty === null ? "" : s.fiziki_qty), true, 12],
  ["Fiziki Durum", (s) => s.fiziki_durum, false, 18],
  ["QC", (s) => s.qc_durum, false, 6],
  ["PO No / Satır / Shipment", poMetni, false, 30],
  ["PO Miktarı", (s) => (s.po_satirlari?.length ? s.po_qty : ""), true, 10],
  ["PO ile Eşleşen", (s) => s.eslesen_qty || "", true, 10],
  ["PO Bekleyen (BoQ)", (s) => s.bekleyen_qty || "", true, 10],
  ["PO Birim Fiyatı", (s) => s.po_birim_fiyat ?? "", true, 14],
  ["BoQ Birim Fiyatı", (s) => s.boq?.birim_fiyat ?? "", true, 14],
  ["BoQ Sürümü", boqSurum, false, 12],
  ["Para Birimi", (s) => [...new Set([s.po_para, s.boq && s.bekleyen_qty > 0 ? s.boq.para : null].filter(Boolean))].join(" + "), false, 8],
  ["Fiyat Kaynağı", (s) => s.etiket, false, 40],
  ["PO − BoQ Birim Farkı", (s) => s.fark_po_boq ?? "", true, 14],
  ["Tutar ₺ (KDV Hariç)", (s) => tlMetni(s.tutar_tl, s.tutar) + usdNotu(s.tutar), false, 18],
  ["Hakediş Oranı", (s) => `%${Math.round(Number(s.hakedis_orani || 0) * 100)}`, false, 9],
  ["Teknocenter Tutarı ₺ (KDV Hariç)", (s) => tlMetni(s.firma_tutar_tl, s.firma_tutar), false, 18],
  ["Uyarı", (s) => [...(s.uyarilar || []),
    s.tutar_disarida ? `Hesaplanan ${tlMetni(s.tutar_disarida_tl, s.tutar_disarida)} toplama girmedi` : "",
    s.boq_neden && !s.boq && !(s.uyarilar || []).some((u) => u.includes(s.boq_neden)) ? "BoQ: " + s.boq_neden : "",
    (s.kaynak_gecmisi || []).length > 1 ? "Önceki kaynak: " + s.kaynak_gecmisi.slice(0, -1).map((g) => `${g.fiyat_kaynagi} (${g.zaman})`).join(" → ") : "",
  ].filter(Boolean).join(" · "), false, 60],
];

const FILTRELER = [
  ["tum", "Tümü", () => true],
  // Kalem sayıları özet kutularıyla aynı kural: miktarı doğrulanamayan kalem toplama girmez, yalnız "İnceleme"de
  ["po", "PO fiyatı", (s) => s.durum !== "HARIC" && !s.miktar_supheli && String(s.fiyat_kaynagi || "").startsWith("PO")],
  ["boq", "BoQ · PO bekleniyor", (s) => s.durum !== "HARIC" && !s.miktar_supheli && (s.fiyat_kaynagi === "BOQ" || s.fiyat_kaynagi === "PO+BOQ")],
  ["fiyatsiz", "Fiyat doğrulanamadı", (s) => !s.miktar_supheli && (s.fiyat_kaynagi === "YOK" || s.fiyat_kaynagi === "PO+YOK")],
  ["inceleme", "İnceleme", (s) => s.durum === "INCELEME"],
  ["baslamamis", "Fiziki başlamamış", (s) => s.durum !== "HARIC" && !(s.fiziki_qty > 0)],
  ["haric", "Hesaba alınmayan", (s) => s.durum === "HARIC"],
];

// Excel: kalem sayfası (sayılar sayı, tutarlar para birimine göre ayrı sütun) + özet sayfası
export function atananExcel(veri, exportStandardExcel, firma = "Teknocenter") {
  const satirlar = veri?.satirlar || [];
  const o = veri?.ozet || {};
  // Önce TL sütunları (kartla aynı toplam), sonra iz için asıl para birimi sütunları
  const pbs = [...new Set(satirlar.flatMap((s) => Object.keys(s.tutar || {})))].filter((pb) => pb !== "TRY");
  const sut = ATANAN_SUTUNLAR.filter(([b]) => !b.startsWith("Tutar ₺") && !b.startsWith("Teknocenter Tutarı"));
  const headers = [...sut.map(([b]) => b), "Tutar TL (KDV Hariç)", `${firma} Tutarı TL`, ...pbs.map((pb) => `Asıl Tutar ${pb}`)];
  const sayisal = new Set(sut.map(([, , n], i) => (n ? i : -1)).filter((i) => i >= 0));
  for (let j = 0; j < 2 + pbs.length; j++) sayisal.add(sut.length + j);
  const rows = satirlar.map((s) => [...sut.map(([, f, n]) => { const v = f(s); return n && v !== "" ? Number(v) : v; }),
    Number(s.tutar_tl || 0), Number(s.firma_tutar_tl || 0), ...pbs.map((pb) => Number(s.tutar?.[pb] || 0))]);
  const ozetSatir = (a, b) => [a, b];
  const ozet = [
    ozetSatir("Kapsam", `${o.kapsam?.kalem || 0} kalem · ${o.kapsam?.is_kaydi || 0} iş kaydı · ${o.kapsam?.fiziksel_saha || 0} fiziksel saha`),
    ozetSatir("Atanan İş Tutarı (toplam, TL)", tlMetni(o.toplam_tl, o.toplam)),
    ozetSatir("  · PO fiyatıyla", `${tlMetni(o.po_fiyatli_tl, o.po_fiyatli)} (${o.po_kalem || 0} kalem)`),
    ozetSatir("  · BoQ üzerinden geçici (PO bekleniyor)", `${tlMetni(o.boq_gecici_tl, o.boq_gecici)} (${o.boq_kalem || 0} kalem)`),
    ozetSatir(`${firma} tutarı (hakediş %${Math.round(Number(o.hakedis_orani || 0) * 100)})`, tlMetni(o.firma_tutar_tl, o.firma_tutar)),
    ozetSatir("Fiyat doğrulanamadı (toplamda YOK)", `${o.fiyatsiz?.kalem || 0} kalem · ${sayi(o.fiyatsiz?.pr_qty || 0)} miktar${o.toplam_eksik ? " — parasal toplam eksik" : ""}`),
    ozetSatir("Miktar doğrulanamadı (toplama eklenmedi)", `${o.miktar_supheli?.kalem || 0} kalem · ${paraMetni(o.miktar_supheli?.tutar_disarida)}`),
    ozetSatir("İnceleme gereken", `${o.inceleme?.kalem || 0} kalem`),
    ozetSatir("Hesaba alınmayan (PR miktarı 0)", `${o.haric?.kalem || 0} kalem`),
    ozetSatir("Fiziki başlamamış ama atanan", `${o.fiziki_baslamamis || 0} kalem`),
    ozetSatir("Para birimi", kurMetni(o) || (Number(o.toplam?.USD || 0) && o.toplam_tl === null ? "TCMB kuru alınamadı — USD ayrı gösterildi" : "Tüm kalemler TL")),
  ];
  return exportStandardExcel({
    title: `${firma} — Atanan İş Tutarı (PR talebi · fiyat PO, yoksa BoQ)`,
    sheetName: "Atanan İş Kalemleri", fileBase: `${firma} - Atanan Is Tutari`,
    headers, rows, colWidths: [...sut.map((c) => c[3]), ...pbs.flatMap(() => [16, 18])], numericCols: [...sayisal],
    extraSheets: [{ sheetName: "Özet", title: `${firma} — Atanan İş Tutarı Özeti`, headers: ["Başlık", "Değer"], rows: ozet, colWidths: [42, 70], numericCols: [] }],
  });
}

export function AtananIsModal({ veri, onClose, onExcel }) {
  const [filtre, setFiltre] = useState("tum");
  const [ara, setAra] = useState("");
  const satirlar = veri?.satirlar || [];
  const liste = useMemo(() => {
    const f = (FILTRELER.find((x) => x[0] === filtre) || FILTRELER[0])[2];
    const q = ara.trim().toLocaleUpperCase("tr-TR");
    return satirlar.filter(f).filter((s) => !q || `${s.fiziksel_id} ${s.is_kodu} ${s.item_code} ${s.aciklama} ${poMetni(s)}`.toLocaleUpperCase("tr-TR").includes(q))
      .sort((a, b) => String(a.fiziksel_id || a.is_kodu).localeCompare(String(b.fiziksel_id || b.is_kodu)) || a.is_kodu.localeCompare(b.is_kodu) || a.id - b.id);
  }, [satirlar, filtre, ara]);
  const o = veri?.ozet || {};
  const kutu = (baslik, deger, alt, renk) => (
    <div style={{ flex: "1 1 170px", border: "1px solid #e5e7eb", borderRadius: 10, padding: "8px 10px", background: "#fff" }}>
      <div style={{ fontSize: 11, color: "#6b7280" }}>{baslik}</div>
      <div style={{ fontWeight: 800, color: renk || "#111827", fontSize: 15 }}>{deger}</div>
      {alt && <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{alt}</div>}
    </div>
  );
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: "min(1400px, 98vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid #e5e7eb", background: "#f9fafb", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>📋 Atanan İş — Kalem Bazında</div>
          <span style={{ fontSize: 12, color: "#6b7280" }}>{liste.length} kalem gösteriliyor</span>
          <input value={ara} onChange={(e) => setAra(e.target.value)} placeholder="Saha / iş kodu / kalem / PO ara"
            style={{ marginLeft: "auto", padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13 }} />
          <button onClick={onExcel} style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>📥 Excel İndir</button>
          <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontWeight: 700 }}>✕</button>
        </div>
        <div style={{ display: "flex", gap: 8, padding: "10px 16px", flexWrap: "wrap", background: "#f8fafc", borderBottom: "1px solid #e5e7eb" }}>
          {kutu("Atanan İş Tutarı", tlMetni(o.toplam_tl, o.toplam), `${o.kapsam?.kalem || 0} kalem · ${o.kapsam?.is_kaydi || 0} iş kaydı · ${o.kapsam?.fiziksel_saha || 0} fiziksel saha`)}
          {kutu("PO fiyatıyla", tlMetni(o.po_fiyatli_tl, o.po_fiyatli), `${o.po_kalem || 0} kalem · doğrulanmış PO satırı`, "#047857")}
          {kutu("BoQ üzerinden geçici", tlMetni(o.boq_gecici_tl, o.boq_gecici), `${o.boq_kalem || 0} kalem · PO gelince PO fiyatına geçer`, "#b45309")}
          {kutu(`Teknocenter tutarı (%${Math.round(Number(o.hakedis_orani || 0) * 100)})`, tlMetni(o.firma_tutar_tl, o.firma_tutar), "hakediş oranı uygulanmış")}
          {(o.fiyatsiz?.kalem > 0 || o.miktar_supheli?.kalem > 0 || o.inceleme?.kalem > 0) &&
            kutu("⚠️ Toplama girmeyen / incelenecek", `${o.fiyatsiz?.kalem || 0} fiyatsız · ${o.miktar_supheli?.kalem || 0} miktar şüpheli`,
              `${o.inceleme?.kalem || 0} inceleme · ${o.haric?.kalem || 0} PR miktarı 0${o.toplam_eksik ? " · parasal toplam eksik" : ""}`, "#b91c1c")}
        </div>
        <div style={{ display: "flex", gap: 6, padding: "8px 16px", flexWrap: "wrap", borderBottom: "1px solid #e5e7eb" }}>
          {FILTRELER.map(([k, ad, f]) => (
            <button key={k} onClick={() => setFiltre(k)}
              style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid " + (filtre === k ? "#1d4ed8" : "#cbd5e1"), background: filtre === k ? "#eff6ff" : "#fff",
                color: filtre === k ? "#1d4ed8" : "#374151", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              {ad} ({satirlar.filter(f).length})
            </button>
          ))}
        </div>
        <div style={{ overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
            <thead>
              <tr>{ATANAN_SUTUNLAR.map(([b]) => (
                <th key={b} style={{ position: "sticky", top: 0, zIndex: 2, background: "#1f2937", color: "#fff", padding: "8px 10px", textAlign: "left", whiteSpace: "nowrap" }}>{b}</th>
              ))}</tr>
            </thead>
            <tbody>
              {liste.map((s, i) => (
                <tr key={s.id} style={{ background: s.durum === "HARIC" ? "#f3f4f6" : s.durum === "FIYATSIZ" || s.durum === "INCELEME" ? "#fff7ed" : i % 2 ? "#f9fafb" : "#fff" }}>
                  {ATANAN_SUTUNLAR.map(([b, f, n]) => {
                    const v = f(s);
                    return (
                      <td key={b} style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9", whiteSpace: b === "Kalem Açıklaması" || b === "Uyarı" ? "normal" : "nowrap",
                        minWidth: b === "Uyarı" ? 260 : b === "Kalem Açıklaması" ? 220 : undefined, textAlign: n ? "right" : "left",
                        color: b === "Fiyat Kaynağı" ? (String(v).startsWith("PO fiyatı") ? "#047857" : String(v).startsWith("BoQ") ? "#b45309" : "#b91c1c") : b === "Uyarı" ? "#b91c1c" : "#374151",
                        fontWeight: b.startsWith("Tutar ₺") || b === "İş Kodu" || b === "Fiyat Kaynağı" ? 700 : 400 }}>
                        {n && v !== "" ? sayi(v) : v === "" || v === null || v === undefined ? "—" : v}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {liste.length === 0 && <tr><td colSpan={ATANAN_SUTUNLAR.length} style={{ padding: 24, textAlign: "center", color: "#9ca3af" }}>Kayıt yok</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "8px 16px", fontSize: 11, color: "#64748b", borderTop: "1px solid #e5e7eb" }}>
          Kapsam: firmanın PR talebi (Günlük İş Girişi kalemi, PR miktarı &gt; 0). Fiziki tamamlanma, QC, PO ya da fatura şart değildir ve bu listeye girmek işi
          tamamlanmış / faturalanabilir yapmaz. Fiyat: doğrulanmış Huawei PO satırı (aynı proje + iş kodu + kalem); PO yoksa PR'daki BoQ sürümü ve fiyatı.
          Tutarlar KDV hariç ve TL'dir{kurMetni(o) ? `; ${kurMetni(o)}` : ""}.
        </div>
      </div>
    </div>,
    document.body,
  );
}
