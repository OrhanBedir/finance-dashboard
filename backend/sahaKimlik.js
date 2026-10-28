// ═══ FİZİKSEL SAHA KİMLİĞİ ↔ İŞ KAYDI (28.10.2026, Orhan) ════════════════════════════════════════════════════
// Bir fiziksel sahanın sabit kimliği (KA3737) ile o sahadaki iş kayıtları (KA3737_NR700_MWA, KA3737_NR3500_MWA,
// KA3737_TRP_MB_MWA …) ayrı tutulur. Eşleme TEK yerden yapılır; startsWith ve "ilk alt çizgiden böl" kullanılmaz:
//   • Standart kod: 1–3 harf + 3–5 rakam (KA3737, Z1199, MUK002) ve ardından "_" / "(" / son. KA3737 ≠ KA37370.
//   • "(2.LOKASYON)" eki ayrı fiziksel konumdur: US1616_L1800_AE(2.LOKASYON) → US1616#2 (US1616 ile birleşmez).
//   • 5GEXP kodları (AFCAY_5GEXP_KON) standart değildir: kodun tamamı kimliktir, başka kayıtla birleştirilmez.
//   • Teşvik / onboarding gibi saha olmayan kayıtlar (W4_2026_INCENTIVE_SIMSEK, 01.31-SIMSEK-ONBOARDING-…) → null.
// İş kapsamı (NR700, NR3500, TRP_MB, LC900 …) kaynakta yazdığı biçimde korunur; birbirine dönüştürülmez.

const LOKASYON_RX = /\(\s*(\d+)\s*\.?\s*LOKASYON\s*\)/i;
const STANDART_RX = /^([A-Z]{1,3}\d{3,5})(?=_|\(|$)/;
const EXP_RX = /^[A-Z0-9]{4,6}_5GEXP_[A-Z]{3}$/;

const temizle = (v) => String(v || "").toLocaleUpperCase("tr-TR").replace(/İ/g, "I").replace(/\s+/g, "");

// → { fiziksel_id, kok, lokasyon, tur, is_kapsami: ["NR700"], ham } | null
function fizikselSaha(kod) {
  const ham = String(kod || "").trim();
  const k = temizle(ham);
  if (!k) return null;
  const lok = k.match(LOKASYON_RX);
  const govde = k.replace(LOKASYON_RX, "");
  const m = govde.match(STANDART_RX);
  if (m) {
    const kok = m[1];
    const lokasyon = lok ? Number(lok[1]) : 1;
    const kalan = govde.slice(kok.length).replace(/^_/, "");
    return { fiziksel_id: lokasyon > 1 ? `${kok}#${lokasyon}` : kok, kok, lokasyon, tur: "STANDART", is_kapsami: kalan ? kalan.split("_").filter(Boolean) : [], ham };
  }
  if (EXP_RX.test(govde)) return { fiziksel_id: govde, kok: govde, lokasyon: 1, tur: "5GEXP", is_kapsami: ["5GEXP"], ham };
  return null;
}

// İki kod aynı fiziksel sahayı mı gösteriyor? TSSR yalnız kök kodu yazabilir (KA3737) — kök kimlik eşleşmesi yeter.
// Döner: { ayni: true|false|null, neden }
function ayniFizikselSaha(a, b) {
  const x = fizikselSaha(a), y = fizikselSaha(b);
  if (!x || !y) return { ayni: null, neden: "Fiziksel saha kodu doğrulanamadı" };
  if (x.fiziksel_id === y.fiziksel_id) return { ayni: true, neden: `Aynı fiziksel saha (${x.fiziksel_id})` };
  // TSSR "KA3737" yazıp lokasyon belirtmiyorsa ve iş kaydı 2. lokasyonsa → belirsiz (kesin "farklı" denmez)
  // Belirsizlik yalnız lokasyonsuz taraf ÇIPLAK kök kodsa (TSSR "US1616") — iş kaydı "US1616_L1800_AE" 1. lokasyondur
  const ciplakLokasyonsuz = (f, ham) => !LOKASYON_RX.test(temizle(ham)) && !f.is_kapsami.length;
  if (x.kok === y.kok && (ciplakLokasyonsuz(x, a) || ciplakLokasyonsuz(y, b)))
    return { ayni: null, neden: `Kök kod aynı (${x.kok}) ama lokasyon numarası belgede doğrulanamadı` };
  return { ayni: false, neden: `Farklı fiziksel saha (${x.fiziksel_id} ≠ ${y.fiziksel_id})` };
}

// Teknik kapsam metnindeki bant/teknoloji ifadeleri — yazıldığı biçimde (NR700-LC900 → ["NR700","LC900"])
function kapsamIfadeleri(metin) {
  const t = temizle(metin).replace(/[–—]/g, "-");
  const out = [];
  const rx = /(NR\d{3,4}|LC\d{3,4}|L\d{3,4}|U\d{3,4}|G\d{3,4}|TRP(?:_[A-Z]+)?|DSS|5GEXP|NS|SINGLE|DUAL|TRIPLE|C-?BAND)/g;
  let m; while ((m = rx.exec(t))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// Bant sınıfı (yalnız KARŞILAŞTIRMA için; gösterimde orijinal ifade kullanılır): LC900/L900/LTE900 → L900
function bantSinifi(ifade) {
  const u = temizle(ifade).replace(/^LTE(?=\d)/, "L").replace(/^LC(?=\d)/, "L");
  return u;
}

// İş kaydının kapsamı TSSR teknik kapsamıyla uyumlu mu? (aynı fiziksel sahada NR3500 kaydı için NR700 TSSR'ı)
function isKapsamUyumu(isKodu, tssrKapsam) {
  const f = fizikselSaha(isKodu);
  const isIfade = (f?.is_kapsami || []).filter((x) => /^(NR|LC|L|U|G)\d|^TRP|^DSS/.test(x));
  const tssrIfade = kapsamIfadeleri(tssrKapsam);
  if (!isIfade.length || !tssrIfade.length) return { durum: "BELIRSIZ", is: isIfade, tssr: tssrIfade };
  const ts = new Set(tssrIfade.map(bantSinifi));
  const ortak = isIfade.filter((x) => ts.has(bantSinifi(x)));
  return { durum: ortak.length ? "UYUMLU" : "FARKLI", is: isIfade, tssr: tssrIfade, ortak };
}

module.exports = { fizikselSaha, ayniFizikselSaha, kapsamIfadeleri, bantSinifi, isKapsamUyumu };
