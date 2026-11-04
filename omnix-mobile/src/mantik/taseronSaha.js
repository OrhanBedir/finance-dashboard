// Taşeron saha ekranı — saf mantık (node testleriyle denetlenir). Hangi işin kime görüneceğine SUNUCU karar verir
// (/taseron-saha/isler); buradaki filtreler yalnız daraltır. Liste ve harita AYNI iş listesinden üretilir.

// Hızlı filtreler: montaj, QC ve sorun birbirinden bağımsız alanlardır (bir iş hem "tamamlanan" hem "sorun" olabilir)
export const FILTRELER = [
  { kod: "tumu", ad: "Tümü" },
  { kod: "montaj_bekleyen", ad: "Montaj bekleyen" },
  { kod: "devam", ad: "Başlayan / devam" },
  { kod: "tamamlanan", ad: "Tamamlanan" },
  { kod: "qc_ok", ad: "QC OK" },
  { kod: "sorun", ad: "Alarm / sorun" },
];
export function filtreUyar(is, kod) {
  switch (kod) {
    case "montaj_bekleyen": return is.montaj?.durum === "BEKLIYOR";
    case "devam": return ["DEVAM", "KISMI", "KONTROL"].includes(is.montaj?.durum);
    case "tamamlanan": return is.montaj?.durum === "TAMAMLANDI";
    case "qc_ok": return is.qc?.durum === "OK";
    case "sorun": return !!is.sorun?.var;
    default: return true;
  }
}
const kodT = (s) => String(s || "").toLocaleUpperCase("tr-TR").replace(/İ/g, "I").replace(/\s+/g, "");
export function suz(isler, { filtre = "tumu", arama = "" } = {}) {
  const q = kodT(arama);
  return (isler || []).filter((x) => filtreUyar(x, filtre) && (!q || kodT(x.kod).includes(q) || kodT(x.fiziksel_id).includes(q)));
}
export function sayac(isler) {
  const o = {};
  for (const f of FILTRELER) o[f.kod] = (isler || []).filter((x) => filtreUyar(x, f.kod)).length;
  return o;
}

// Montaj durumu → renk / ton (harita pini ve rozet aynı eşleşme)
export const MONTAJ_RENK = { BEKLIYOR: "MAVI", DEVAM: "SARI", KISMI: "SARI", KONTROL: "GRI", TAMAMLANDI: "YESIL" };
export const MONTAJ_TON = { BEKLIYOR: "bilgi", DEVAM: "uyari", KISMI: "uyari", KONTROL: "notr", TAMAMLANDI: "basari" };
export const HARITA_LEJANT = [
  { renk: "MAVI", ad: "Montaj bekliyor" }, { renk: "SARI", ad: "Devam / kısmi" }, { renk: "YESIL", ad: "Tamamlandı" }, { renk: "GRI", ad: "Kontrol gerekli" },
];
export const qcTon = (qc) => (qc?.durum === "OK" ? "basari" : qc?.durum === "NOK" ? "hata" : "notr");

// Harita: işler fiziksel sahaya göre toplanır; YALNIZ kayıtlı konumu olanlar haritaya girer (il merkezine yaklaşık balon yok —
// konumsuz iş yalnız listede). Pin rengi: sahadaki en çok dikkat isteyen montaj durumu.
const ONCELIK = ["SARI", "GRI", "MAVI", "YESIL"];
export function haritaSahalari(isler) {
  const m = new Map();
  for (const x of isler || []) {
    const g = m.get(x.fiziksel_id) || { id: x.fiziksel_id, il: x.il, konum: x.konum || null, isler: [], benim: false, taseronlar: [] };
    g.isler.push(x);
    if (!g.konum && x.konum) g.konum = x.konum;
    m.set(x.fiziksel_id, g);
  }
  return [...m.values()].map((g) => {
    const renk = ONCELIK.find((r) => g.isler.some((x) => MONTAJ_RENK[x.montaj?.durum] === r)) || "GRI";
    // il yalnız konumlu sahada verilir: harita katmanı konumsuz sahayı il merkezine "yaklaşık" koymasın
    return { ...g, il: g.konum ? g.il : null, il_adi: g.il, pin: { renk, ad: HARITA_LEJANT.find((l) => l.renk === renk)?.ad || "" }, sorun: g.isler.some((x) => x.sorun?.var) };
  });
}

// Montajı Tamamla formu — sunucu kuralının aynısı (sunucu yine doğrular)
export const BOS_TAMAMLA = { tur: null, standart: false, aciklama: "", kalan_is: "", sorun: "" };
export function tamamlaHatalari(f) {
  const h = {};
  if (!["TAM", "KISMI"].includes(f.tur)) h.tur = "Tam mı, kısmi mi seçin";
  const ac = String(f.aciklama || "").trim(), kalan = String(f.kalan_is || "").trim();
  if (f.tur === "TAM" && !f.standart && ac.length < 3) h.aciklama = "Yapılan işi kısaca yazın ya da \"Standart tam\" seçin";
  if (f.tur === "KISMI" && ac.length < 3) h.aciklama = "Bugün yapılan işi kısaca yazın";
  if (f.tur === "KISMI" && kalan.length < 3) h.kalan_is = "Kalan işi yazın — kısmi iş tamamlanmış sayılmaz";
  return h;
}
export function tamamlaGovdesi(f, kod, istekAnahtari) {
  const t = (s) => String(s || "").trim() || null;
  return { onay_kod: kod, tur: f.tur, standart: f.tur === "TAM" && !!f.standart, aciklama: t(f.aciklama), kalan_is: f.tur === "KISMI" ? t(f.kalan_is) : null,
    sorun: t(f.sorun), istek_anahtari: istekAnahtari };
}
