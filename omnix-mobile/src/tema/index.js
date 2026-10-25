// Omnix tasarım sistemi — renk, yazı, boşluk ve köşe değerleri tek yerde.
// Marka renkleri Omnix logosundan (omnix-logo.svg): lacivert #1e3a5f + altın #d99a2b.
import { Platform } from "react-native";

export const renk = {
  lacivert: "#1E3A5F",
  lacivertKoyu: "#14273F",
  lacivertAcik: "#2C5282",
  altin: "#D99A2B",
  altinAcik: "#F0B429",
  altinZemin: "#FBF3E4",

  zemin: "#F3F5F9",
  yuzey: "#FFFFFF",
  yuzeyIkincil: "#F7F9FC",
  cizgi: "#E2E7EF",
  cizgiKoyu: "#CBD3DF",

  metin: "#0F1B2D",
  metinIkincil: "#4A5A70",
  metinSoluk: "#7D8A9C",
  metinTers: "#FFFFFF",

  basari: "#15803D",
  basariZemin: "#E7F5EC",
  uyari: "#A15C07",
  uyariZemin: "#FDF2DF",
  hata: "#B42318",
  hataZemin: "#FDECEA",
  bilgi: "#1D4ED8",
  bilgiZemin: "#E8EFFD",
  notr: "#475467",
  notrZemin: "#EEF1F5",
};

// Durum tonları: rozet, bant ve ikonlarda aynı eşleşme kullanılır
export const ton = {
  basari: { on: renk.basari, zemin: renk.basariZemin },
  uyari: { on: renk.uyari, zemin: renk.uyariZemin },
  hata: { on: renk.hata, zemin: renk.hataZemin },
  bilgi: { on: renk.bilgi, zemin: renk.bilgiZemin },
  notr: { on: renk.notr, zemin: renk.notrZemin },
  marka: { on: renk.lacivert, zemin: "#E6ECF4" },
};

export const aralik = { xxs: 4, xs: 8, s: 12, m: 16, l: 20, xl: 24, xxl: 32 };
export const kose = { s: 8, m: 12, l: 16, tam: 999 };
// Saha kullanımı: dokunma alanı en az 48 pt (Apple önerisi 44)
export const DOKUNMA = 48;

const agirlik = { normal: "400", orta: "500", yari: "600", kalin: "700", ekstra: "800" };

export const yazi = {
  dev: { fontSize: 34, lineHeight: 40, fontWeight: agirlik.kalin, letterSpacing: -0.5 },
  baslikXL: { fontSize: 28, lineHeight: 34, fontWeight: agirlik.kalin, letterSpacing: -0.4 },
  baslikL: { fontSize: 22, lineHeight: 28, fontWeight: agirlik.kalin, letterSpacing: -0.2 },
  baslikM: { fontSize: 18, lineHeight: 24, fontWeight: agirlik.yari },
  govde: { fontSize: 16, lineHeight: 22, fontWeight: agirlik.normal },
  govdeKalin: { fontSize: 16, lineHeight: 22, fontWeight: agirlik.yari },
  kucuk: { fontSize: 14, lineHeight: 20, fontWeight: agirlik.normal },
  kucukKalin: { fontSize: 14, lineHeight: 20, fontWeight: agirlik.yari },
  etiket: { fontSize: 13, lineHeight: 18, fontWeight: agirlik.yari, letterSpacing: 0.1 },
  minik: { fontSize: 12, lineHeight: 16, fontWeight: agirlik.orta },
  // Tutarlar: rakamlar eşit genişlikte, böylece alt alta tutarlar hizalı durur
  tutar: { fontVariant: ["tabular-nums"] },
};

export const golge = Platform.select({
  ios: { shadowColor: "#0F1B2D", shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  default: { elevation: 2 },
});
