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
// 06.11.2026 durum grupları (sunucu iş.gruplar): bir iş birden çok gruba girebilir — sayaçlar toplanmaz
export const GRUP_FILTRELER = [
  { kod: "tumu", ad: "Tümü" },
  { kod: "atanan", ad: "Atanan · montaj bekliyor" },
  { kod: "devam", ad: "Montaj devam ediyor" },
  { kod: "qc_bekleyen", ad: "Montaj tamam · QC bekliyor" },
  { kod: "qc_ok", ad: "QC OK (kapanmış)" },
  { kod: "eksik", ad: "Eksik / Issue / Clean Up" },
];
export function filtreUyar(is, kod) {
  if (Array.isArray(is.gruplar) && ["atanan", "qc_bekleyen", "eksik"].includes(kod)) return is.gruplar.includes(kod);
  if (Array.isArray(is.gruplar) && kod === "devam") return is.gruplar.includes("devam");
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
// 05.11.2026: görünüm kapsamı (firma sorumlusu): Firma işleri / Ekibimin işleri / Bana atananlar — sunucunun iş.kapsam alanından
export const KAPSAMLAR = [{ kod: "firma", ad: "Firma işleri" }, { kod: "ekibim", ad: "Ekibimin işleri" }, { kod: "bana", ad: "Bana atananlar" }];
export const kapsamUyar = (is, kapsam) => !kapsam || kapsam === "firma" || !!is.kapsam?.[kapsam];
export function suz(isler, { filtre = "tumu", arama = "", kapsam = "firma" } = {}) {
  const q = kodT(arama);
  return (isler || []).filter((x) => filtreUyar(x, filtre) && kapsamUyar(x, kapsam) && (!q || kodT(x.kod).includes(q) || kodT(x.fiziksel_id).includes(q)));
}

// ── YAPTIĞIMIZ SAHALAR (/taseron-saha/gecmis) ── sınıf ve QC sunucudan; burada yalnız daraltılır
export const GECMIS_FILTRELER = [
  { kod: "tumu", ad: "Tümü" }, { kod: "tamamlandi", ad: "Montaj tamamlandı" }, { kod: "qc_basladi", ad: "QC başladı" },
  { kod: "qc_kapandi", ad: "QC kapandı" }, { kod: "devam", ad: "Devam ediyor" }, { kod: "teyit", ad: "Teyit bekliyor" },
];
export const GECMIS_SINIF = { TAMAMLANDI: { ad: "Montaj tamamlandı", ton: "basari" }, DEVAM: { ad: "Devam ediyor", ton: "uyari" }, KISMI: { ad: "Kısmi · devam edecek", ton: "uyari" },
  TEYIT: { ad: "Teyit bekliyor", ton: "notr" }, KATILIM: { ad: "Kendi iş kolunuz", ton: "bilgi" } };
export const QC_TON = { KAPANDI: "basari", BASLADI: "bilgi", RED: "hata", BILINMIYOR: "notr", YOK: "notr" };
export function gecmisUyar(x, kod) {
  switch (kod) {
    case "tamamlandi": return x.sinif === "TAMAMLANDI";
    case "qc_basladi": return x.qc?.kod === "BASLADI";
    case "qc_kapandi": return x.qc?.kod === "KAPANDI";
    case "devam": return ["DEVAM", "KISMI"].includes(x.sinif);
    case "teyit": return x.sinif === "TEYIT";
    default: return true;
  }
}
// Tarih süzgeci: montaj bitişi (yoksa başlangıcı) verilen günden sonra / önce
export function gecmisSuz(satirlar, { filtre = "tumu", arama = "", bolge = null, bas = null, bit = null } = {}) {
  const q = kodT(arama);
  return (satirlar || []).filter((x) => {
    const t = x.montaj?.bitis || x.montaj?.baslama || null;
    return gecmisUyar(x, filtre) && (!bolge || x.bolge === bolge || x.il === bolge) && (!q || kodT(x.kod).includes(q) || kodT(x.fiziksel_id).includes(q))
      && (!bas || (t && t >= bas)) && (!bit || (t && t <= bit));
  });
}
export function gecmisSayac(satirlar) {
  const o = {};
  for (const f of GECMIS_FILTRELER) o[f.kod] = (satirlar || []).filter((x) => gecmisUyar(x, f.kod)).length;
  return o;
}
export const bolgeler = (satirlar) => [...new Set((satirlar || []).map((x) => x.bolge || x.il).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr"));
export function sayac(isler) {
  const o = {};
  for (const f of [...FILTRELER, ...GRUP_FILTRELER]) o[f.kod] = (isler || []).filter((x) => filtreUyar(x, f.kod)).length;
  return o;
}

// ── YAKINIMDAKİ SAHALAR ── kuş uçuşu mesafe (karayolu değil), yalnız sunucunun verdiği yetkili iş listesinde ve kayıtlı konumu
// olan sahalarda. Konumu olmayan sahaya mesafe uydurulmaz. Yakınlık işlem yetkisi vermez (düğmeler yine sunucudan).
export const YAKIN_KM = [5, 10, 25, 50];
export function mesafeKm(a, b) {
  if (!a || !b || ![a.lat, a.lng, b.lat, b.lng].every((v) => Number.isFinite(Number(v)))) return null;
  const R = 6371, r = (d) => (Number(d) * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}
export function yakinSahalar(isler, konum, km) {
  if (!konum) return { yakin: [], konumsuz: (isler || []).filter((x) => !x.konum).length };
  const yakin = (isler || []).map((x) => ({ ...x, mesafe_km: mesafeKm(konum, x.konum) })).filter((x) => x.mesafe_km != null && x.mesafe_km <= km)
    .sort((a, b) => Number(!!b.sorun?.var || !!b.cleanup) - Number(!!a.sorun?.var || !!a.cleanup) || a.mesafe_km - b.mesafe_km);
  return { yakin, konumsuz: (isler || []).filter((x) => !x.konum).length };
}
// Yol tarifi bağlantısı (cihazın harita uygulaması) — yalnız kayıtlı konumda
export const yolTarifiAdresi = (k, platform = "ios") => (!k ? null : platform === "ios"
  ? `http://maps.apple.com/?daddr=${k.lat},${k.lng}` : `https://www.google.com/maps/dir/?api=1&destination=${k.lat},${k.lng}`);
export const bugunMu = (t, simdi = new Date()) => !!t && String(t).slice(0, 10) === new Date(simdi.getTime() + 3 * 3600e3).toISOString().slice(0, 10);

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
