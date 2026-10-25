// Biçimlendirme yardımcıları — React Native'e bağımlı değil (node --test ile sınanır).

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const AYLAR_KISA = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

function binlik(tamSayiMetni) {
  return tamSayiMetni.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// 12345.6 → "12.345,60 ₺". Değer sayı değilse null döner: çağıran "—" gösterir, asla sahte 0 göstermez.
export function tl(deger, { kurus = true, isaret = false } = {}) {
  if (deger === null || deger === undefined || deger === "") return null;
  const n = Number(deger);
  if (!Number.isFinite(n)) return null;
  const mutlak = Math.abs(n);
  const [tam, ondalik] = mutlak.toFixed(kurus ? 2 : 0).split(".");
  const govde = kurus ? `${binlik(tam)},${ondalik}` : binlik(tam);
  const on = n < 0 ? "−" : isaret && n > 0 ? "+" : "";
  return `${on}${govde} ₺`;
}

// Kullanıcının yazdığı tutar: "1.234,50" / "1234,5" / "1234.50" → 1234.5 ; geçersizse null
export function tutarCoz(metin) {
  if (metin === null || metin === undefined) return null;
  let s = String(metin).trim().replace(/\s|₺|TL/gi, "");
  if (!s) return null;
  const virgul = s.lastIndexOf(","), nokta = s.lastIndexOf(".");
  if (virgul > -1 && nokta > -1) {
    // Hangisi sonda ise ondalık ayırıcı odur
    s = virgul > nokta ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (virgul > -1) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (nokta > -1) {
    // "1.234" binlik mi ondalık mı? Noktadan sonra tam 3 hane ve birden çok grup/uzun tam kısım → binlik
    const parca = s.split(".");
    if (parca.length > 2 || (parca[1].length === 3 && parca[0].length >= 1 && parca.length === 2 && !/^0$/.test(parca[0]))) {
      s = parca.join("");
    }
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function tarihNesnesi(d) {
  if (!d) return null;
  if (d instanceof Date) return isNaN(d.getTime()) ? null : d;
  const s = String(d);
  // "2026-10-24" yalnız tarih: yerel gün olarak yorumla (UTC kayması olmasın)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  return isNaN(t.getTime()) ? null : t;
}

export function tarih(d, { yil = true } = {}) {
  const t = tarihNesnesi(d);
  if (!t) return null;
  return `${t.getDate()} ${AYLAR_KISA[t.getMonth()]}${yil ? ` ${t.getFullYear()}` : ""}`;
}

export function tarihUzun(d) {
  const t = tarihNesnesi(d);
  return t ? `${t.getDate()} ${AYLAR[t.getMonth()]} ${t.getFullYear()}` : null;
}

export function saat(d) {
  const t = tarihNesnesi(d);
  return t ? `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` : null;
}

// Para birimiyle tutar: 1250 TRY → "1.250,00 ₺", USD → "1.250,00 $". Farklı birimler asla tek toplamda birleştirilmez.
const SEMBOL = { TRY: "₺", TL: "₺", USD: "$", EUR: "€" };
export function para(deger, birim = "TRY") {
  const t = tl(deger);
  if (t === null) return null;
  const s = SEMBOL[String(birim || "TRY").toUpperCase()] || String(birim || "");
  return t.replace(/ ₺$/, ` ${s}`);
}

// "2026-10" → "Ekim 2026"
export function donem(d) {
  const m = String(d || "").match(/^(\d{4})-(\d{1,2})/);
  return m ? `${AYLAR[Number(m[2]) - 1] || m[2]} ${m[1]}` : null;
}

export function ayAdi(ay) {
  return AYLAR[Number(ay) - 1] || "";
}

// Yerel tarih → "YYYY-MM-DD" (toISOString UTC'ye çevirip gece yarısı bir gün geri kaydırıyordu)
export function isoGun(d = new Date()) {
  const t = tarihNesnesi(d) || new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export function basHarfler(ad) {
  const p = String(ad || "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  const ilk = p[0][0] || "";
  const son = p.length > 1 ? p[p.length - 1][0] : "";
  return (ilk + son).toLocaleUpperCase("tr-TR");
}

export function plakaDuzelt(p) {
  return String(p || "").toLocaleUpperCase("tr-TR").replace(/\s+/g, " ").trim();
}

// IBAN: boşluklar atılır, büyük harf. Görünüm 4'lü gruplar ("TR12 0006 …")
export function ibanDuzelt(v) {
  return String(v || "").replace(/\s+/g, "").toUpperCase();
}
export function ibanGoster(v) {
  return ibanDuzelt(v).replace(/(.{4})/g, "$1 ").trim();
}
// Türkiye IBAN'ı: TR + 24 hane, ISO 13616 mod-97 kontrol hanesi
export function ibanGecerli(v) {
  const s = ibanDuzelt(v);
  if (!/^TR\d{24}$/.test(s)) return false;
  const yeniden = s.slice(4) + s.slice(0, 4);
  const sayisal = yeniden.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let kalan = 0;
  for (const ch of sayisal) kalan = (kalan * 10 + Number(ch)) % 97;
  return kalan === 1;
}
