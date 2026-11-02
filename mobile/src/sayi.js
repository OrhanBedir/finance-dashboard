// 24.10.2026 (Orhan): Türkçe klavyede ondalık ayırıcı virgül — "282,5" Number() ile NaN oluyor, masraf/avans
// tutarı "Geçerli bir tutar giriniz" hatası veriyordu. Kullanıcının yazdığı tutarı sayıya çevirir:
//   "282,5" → 282.5   "1.179,50" → 1179.5   "1179.50" → 1179.5   "1.179" → 1179 (binlik)   "₺ 45 000" → 45000
// Geçersizse NaN döner. Sonuç kuruşa (2 ondalık) yuvarlanır.
export function tutarOku(deger) {
  let s = String(deger ?? "").replace(/[₺\s]/g, "").replace(/TL$/i, "");
  if (!s) return NaN;
  if (s.includes(",") && s.includes(".")) {
    // Hangisi sonda ise ondalık ayırıcı odur; diğeri binlik
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = /^\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");   // "1.179" / "45.000" → binlik ayırıcı
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100) / 100;
}
