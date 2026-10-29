// Stok defteri miktar kuralları — sunucudaki miktarAyristir ile aynı (backend/malzemeStok.js):
// "12,5" / "12.5" / "1.234,5" kabul; en fazla 3 ondalık; sıfır / eksi / metin reddedilir. Sonuç sunucuya metin olarak gider.
export function miktarCoz(v) {
  if (v === null || v === undefined || String(v).trim() === "") return { hata: "Miktar girin" };
  let s = String(v).trim().replace(/\s+/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) { if ((s.match(/,/g) || []).length > 1) return { hata: `Miktar geçersiz: ${v}` }; s = s.replace(",", "."); }
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, "");
  if (s.startsWith("-")) return { hata: "Miktar eksi olamaz" };
  if (!/^\d+(\.\d+)?$/.test(s)) return { hata: `Miktar geçersiz: ${v}` };
  const [tam, ond = ""] = s.split(".");
  if (ond.length > 3 && /[1-9]/.test(ond.slice(3))) return { hata: "En fazla 3 ondalık basamak girin" };
  const metin = `${tam.replace(/^0+(?=\d)/, "")}.${(ond + "000").slice(0, 3)}`;
  if (Number(metin) <= 0) return { hata: "Miktar sıfırdan büyük olmalı" };
  return { metin, sayi: Number(metin) };
}

// Ekranda Türkçe biçim: 12.5 → "12,5"; 1250 → "1.250"
export function miktarGoster(n) {
  if (n === null || n === undefined || n === "") return "—";
  return Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 3 });
}

// Tüketim / iade ön kontrolü (sunucu yine de kesin denetler)
export function stokIslemKontrol({ tur, miktar, kullanilabilir, sahaKodu, tamSayi }) {
  const m = miktarCoz(miktar);
  if (m.hata) return m.hata;
  if (tamSayi && !Number.isInteger(m.sayi)) return "Bu malzeme adet ile tutulur; tam sayı girin";
  if (m.sayi > Number(kullanilabilir || 0) + 1e-9) return `Üzerinizde kullanılabilir ${miktarGoster(kullanilabilir)} var; daha fazlası girilemez`;
  if (tur === "tuketim" && !String(sahaKodu || "").trim()) return "Saha seçin";
  return null;
}
