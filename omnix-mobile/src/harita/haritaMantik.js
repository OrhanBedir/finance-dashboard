// Mobil saha haritası — saf mantık (ekrandan bağımsız, node testleriyle denetlenir).
// Veri /mobil/harita'dan gelir: kimin hangi sahaları göreceğine SUNUCU karar verir; buradaki filtreler yalnız daraltır.
import { ILLER, proj, SINIR } from "./iller.js";

// Pin renkleri (web haritasıyla aynı anlam): YESIL tamam · SARI takip/devam · MAVI başlamadı/planlandı · GRI doğrulanamadı
export const PIN_RENK = { YESIL: "#16A34A", SARI: "#E0A21B", MAVI: "#2563EB", GRI: "#8A97A8" };
export const PIN_AD = { YESIL: "Tamamlandı", SARI: "Devam / takip", MAVI: "Başlamadı / planlandı", GRI: "Doğrulanamadı" };
export const PIN_SIRA = ["SARI", "MAVI", "YESIL", "GRI"];

// İl adı eşleştirme: "AFYONKARAHİSAR" / "Afyon", "İÇEL" / "Mersin", "K.MARAŞ" / "Kahramanmaraş"
const IL_TAKMA = { AFYONKARAHISAR: "AFYON", ICEL: "MERSIN", KMARAS: "KAHRAMANMARAS", MARAS: "KAHRAMANMARAS", URFA: "SANLIURFA", ANTEP: "GAZIANTEP" };
export function ilAnahtar(ad) {
  const k = String(ad || "").toLocaleUpperCase("tr-TR")
    .replace(/[İI]/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C").replace(/Â/g, "A")
    .replace(/[^A-Z]/g, "");
  return IL_TAKMA[k] || k;
}
export const IL_MERKEZ = Object.fromEntries(ILLER.map((i) => [ilAnahtar(i.ad), { ad: i.ad, x: i.cx, y: i.cy }]));
export const ilAdi = (ad) => IL_MERKEZ[ilAnahtar(ad)]?.ad || (ad ? String(ad).toLocaleLowerCase("tr-TR").replace(/(^|\s)\S/g, (h) => h.toLocaleUpperCase("tr-TR")) : "");

// Sahanın haritadaki noktası: kesin konum → izdüşüm; yoksa il merkezi (yaklaşık); ikisi de yoksa null
export function sahaNoktasi(s) {
  if (s?.konum && Number.isFinite(s.konum.lat) && Number.isFinite(s.konum.lng)) { const [x, y] = proj(s.konum.lng, s.konum.lat); return { x, y, kesin: true }; }
  const m = IL_MERKEZ[ilAnahtar(s?.yaklasik_il || s?.il)];
  return m ? { x: m.x, y: m.y, kesin: false } : null;
}

const benzersiz = (dizi) => [...new Set(dizi.filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr"));
const sahaFirmalari = (s) => benzersiz([...(s.taseronlar || []), ...(s.isler || []).flatMap((x) => x.taseronlar || [])]);
const sahaEkipleri = (s) => benzersiz((s.isler || []).map((x) => x.atanan_ekip));
const sahaDurumlari = (s) => benzersiz((s.isler || []).map((x) => x.durum_ad));

// Filtre seçenekleri (her seçeneğin yanında saha sayısı)
export function secenekler(sahalar) {
  const say = (anahtarlar) => { const m = new Map(); for (const s of sahalar) for (const k of anahtarlar(s)) m.set(k, (m.get(k) || 0) + 1); return [...m.entries()].map(([deger, adet]) => ({ deger, adet })).sort((a, b) => a.deger.localeCompare(b.deger, "tr")); };
  return {
    bolge: say((s) => benzersiz([s.bolge])),
    il: say((s) => benzersiz([ilAdi(s.il || s.yaklasik_il)])),
    renk: PIN_SIRA.map((r) => ({ deger: r, ad: PIN_AD[r], adet: sahalar.filter((s) => (s.pin?.renk || "GRI") === r).length })).filter((x) => x.adet),
    durum: say(sahaDurumlari),
    firma: say(sahaFirmalari),
    ekip: say(sahaEkipleri),
  };
}

export const BOS_FILTRE = { arama: "", benim: false, bolge: [], il: [], renk: [], durum: [], firma: [], ekip: [] };
export const filtreSayisi = (f) => (f.benim ? 1 : 0) + ["bolge", "il", "renk", "durum", "firma", "ekip"].reduce((a, k) => a + (f[k]?.length ? 1 : 0), 0);

export function suz(sahalar, f = BOS_FILTRE) {
  const q = String(f.arama || "").trim().toLocaleUpperCase("tr-TR").replace(/\s+/g, "");
  const kes = (liste, degerler) => !liste?.length || degerler.some((d) => liste.includes(d));
  return sahalar.filter((s) => {
    if (f.benim && !s.benim) return false;
    if (!kes(f.bolge, [s.bolge])) return false;
    if (!kes(f.il, [ilAdi(s.il || s.yaklasik_il)])) return false;
    if (!kes(f.renk, [s.pin?.renk || "GRI"])) return false;
    if (!kes(f.durum, sahaDurumlari(s))) return false;
    if (!kes(f.firma, sahaFirmalari(s))) return false;
    if (!kes(f.ekip, sahaEkipleri(s))) return false;
    if (q) {
      const metin = [s.id, s.saha_adi, s.il, s.ilce, ...(s.isler || []).map((x) => x.site_code)].join(" ").toLocaleUpperCase("tr-TR").replace(/\s+/g, "");
      if (!metin.includes(q)) return false;
    }
    return true;
  });
}

// Çizim katmanları: kesin konumlu pinler + il başına yaklaşık konum balonları + konumu hiç olmayanlar (yalnız listede)
export function katmanlar(sahalar) {
  const pinler = [], iller = new Map(), konumsuz = [];
  for (const s of sahalar) {
    const n = sahaNoktasi(s);
    if (!n) { konumsuz.push(s); continue; }
    if (n.kesin) { pinler.push({ s, x: n.x, y: n.y }); continue; }
    const k = ilAnahtar(s.yaklasik_il || s.il);
    const g = iller.get(k) || { anahtar: k, ad: IL_MERKEZ[k].ad, x: n.x, y: n.y, sahalar: [] };
    g.sahalar.push(s); iller.set(k, g);
  }
  // Balon rengi: ildeki en çok dikkat isteyen durum (SARI > MAVI > GRI > YESIL)
  const oncelik = ["SARI", "MAVI", "GRI", "YESIL"];
  const balonlar = [...iller.values()].map((g) => ({ ...g, renk: oncelik.find((r) => g.sahalar.some((s) => (s.pin?.renk || "GRI") === r)) || "GRI",
    benim: g.sahalar.some((s) => s.benim) }));
  return { pinler, balonlar, konumsuz };
}

// Görünüm kutusu: verilen noktaları kenar boşluğuyla, ekran oranına uygun saran viewBox
export const TUM_TURKIYE = { x: SINIR.x - 10, y: SINIR.y - 10, w: SINIR.w + 20, h: SINIR.h + 20 };
export function sigdir(noktalar, oran, { enAz = 120, bosluk = 0.18 } = {}) {
  if (!noktalar.length) return oranla(TUM_TURKIYE, oran);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of noktalar) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  let w = Math.max(x1 - x0, enAz), h = Math.max(y1 - y0, enAz / 2);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  w *= 1 + bosluk * 2; h *= 1 + bosluk * 2;
  return oranla({ x: cx - w / 2, y: cy - h / 2, w, h }, oran);
}
// oran = genişlik / yükseklik (ekran). Kutu bu orana büyütülerek getirilir (içerik kırpılmaz)
export function oranla(k, oran) {
  if (!(oran > 0)) return k;
  const cx = k.x + k.w / 2, cy = k.y + k.h / 2;
  let w = k.w, h = k.h;
  if (w / h > oran) h = w / oran; else w = h * oran;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
// Yakınlaştırma sınırları: Türkiye'nin 1,6 katından uzak / ~6 km'den yakın görünüm yok
export function sinirla(k, oran) {
  const enFazlaW = TUM_TURKIYE.w * 1.6, enAzW = 6;
  let w = Math.min(Math.max(k.w, enAzW), enFazlaW);
  const s = w / k.w;
  const cx = k.x + k.w / 2, cy = k.y + k.h / 2;
  const h = oran > 0 ? w / oran : k.h * s;
  const x = Math.min(Math.max(cx - w / 2, TUM_TURKIYE.x - w * 0.6), TUM_TURKIYE.x + TUM_TURKIYE.w - w * 0.4);
  const y = Math.min(Math.max(cy - h / 2, TUM_TURKIYE.y - h * 0.6), TUM_TURKIYE.y + TUM_TURKIYE.h - h * 0.4);
  return { x, y, w, h };
}

// Yol tarifi bağlantısı: kesin konum → koordinat; yaklaşık → yalnız il araması (koordinat UYDURULMAZ)
export function yolTarifiAdresi(s, platform) {
  if (s?.konum) {
    const { lat, lng } = s.konum;
    return platform === "ios" ? `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  }
  const il = ilAdi(s?.yaklasik_il || s?.il);
  if (!il) return null;
  const q = encodeURIComponent([s.saha_adi, s.ilce, il].filter(Boolean).join(", "));
  return platform === "ios" ? `http://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}
