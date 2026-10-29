// ═══ KMZ KONUM KAYNAĞI (29.10.2026, Orhan — Rollout saha haritası · Türk Telekom KMZ) ═══════════════════════════════
// KMZ YALNIZ KONUM kaynağıdır: firma sahipliği, iş yılı, anten tipi, montaj durumu buradan okunmaz.
// Güvenlik (dosya güvenilmeyen veri):
//   • ZIP Node zlib ile açılır (dış kütüphane yok); girdi sayısı, girdi başı ve toplam açılmış boyut sınırlı (zip bombası).
//   • XML'de DOCTYPE / ENTITY tanımı olan KML okunmaz (dış varlık / varlık genişletme yok); yalnız 5 standart XML kaçışı çözülür.
//   • NetworkLink / Icon href'leri İZLENMEZ: yalnız arşivin içindeki .kml girdileri okunur; dış bağlantılar sayılıp raporlanır.
//   • Açıklamadaki HTML çalıştırılmaz, saklanmaz: tablo satırlarından düz metin alan/değer çıkarılır, etiketler atılır.
//   • Kişisel veri saklanmaz: kiralamacı / RF planlamacı adı gibi alanlar okunmaz.
// Saha kimliği: Placemark adı (EM_DE0051 → DE0051), ExtendedData ya da açıklamadaki "Site ID" alanı; kod sahaKimlik ile
// TAM eşleşmelidir (BO2851 ≠ BO28510; startsWith / körlemesine bölme yok). Tekrarlayıcı (REPEATER) noktaları saha değildir.
// Koordinat: KML sırası boylam,enlem[,yükseklik]. Geçersiz / ters / Türkiye dışı nokta DÜZELTİLMEZ, "geçersiz" sayılır.
"use strict";
const zlib = require("zlib");
const crypto = require("crypto");
const { fizikselSaha } = require("./sahaKimlik");
const { TR_KUTU, kusUcusuKm } = require("./sahaKonum");

const SINIR = { girdi: 5000, girdiBoyut: 60 * 1024 * 1024, toplamBoyut: 400 * 1024 * 1024 };
const MUKERRER_TOLERANS_M = 30;   // aynı Site ID'nin kopyaları bu kadar yakınsa tek nokta sayılır
const MEVCUT_TOLERANS_M = 100;    // mevcut doğrulanmış konumla fark bu kadar ya da azsa "uyumlu"

// ── ZIP (yalnız okuma; stored + deflate; zip64 yok) ────────────────────────────────────────────────────────────────
function zipGirdileri(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error("Dosya KMZ (ZIP) değil");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Dosya KMZ (ZIP) değil ya da bozuk");
  const adet = buf.readUInt16LE(eocd + 10), cdBoyut = buf.readUInt32LE(eocd + 12), cdOfs = buf.readUInt32LE(eocd + 16);
  if (adet === 0xffff || cdOfs === 0xffffffff) throw new Error("ZIP64 arşivi desteklenmiyor");
  if (adet > SINIR.girdi) throw new Error(`Arşivde çok fazla dosya var (${adet})`);
  if (cdOfs + cdBoyut > buf.length) throw new Error("ZIP dizini bozuk");
  const out = [];
  let p = cdOfs;
  for (let n = 0; n < adet; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("ZIP dizini bozuk");
    const yontem = buf.readUInt16LE(p + 10), saat = buf.readUInt16LE(p + 12), tarih = buf.readUInt16LE(p + 14);
    const sikisik = buf.readUInt32LE(p + 20), acik = buf.readUInt32LE(p + 24);
    const adU = buf.readUInt16LE(p + 28), ekU = buf.readUInt16LE(p + 30), yorumU = buf.readUInt16LE(p + 32), yerel = buf.readUInt32LE(p + 42);
    const ad = buf.slice(p + 46, p + 46 + adU).toString("utf8");
    const gun = tarih & 31, ay = (tarih >> 5) & 15, yil = 1980 + (tarih >> 9);
    const kayitTarihi = ay >= 1 && ay <= 12 && gun >= 1 ? `${yil}-${String(ay).padStart(2, "0")}-${String(gun).padStart(2, "0")}` : null;
    out.push({ ad, yontem, sikisik, acik, yerel, kayit_tarihi: kayitTarihi, kayit_saati: `${String(saat >> 11).padStart(2, "0")}:${String((saat >> 5) & 63).padStart(2, "0")}` });
    p += 46 + adU + ekU + yorumU;
  }
  return out;
}
function zipOku(buf, g) {
  if (g.acik > SINIR.girdiBoyut) throw new Error(`${g.ad}: açılmış boyut sınırı aşıldı`);
  const p = g.yerel;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error(`${g.ad}: yerel başlık bozuk`);
  const bas = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const veri = buf.slice(bas, bas + g.sikisik);
  if (g.yontem === 0) return veri;
  if (g.yontem === 8) return zlib.inflateRawSync(veri, { maxOutputLength: Math.min(SINIR.girdiBoyut, g.acik + 1024) });
  throw new Error(`${g.ad}: desteklenmeyen sıkıştırma (${g.yontem})`);
}

// ── XML / HTML yardımcıları (varlık genişletme YOK) ─────────────────────────────────────────────────────────────────
const XML_KACIS = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const kacisCoz = (s) => String(s || "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, k) => {
  if (k[0] === "#") { const c = k[1] === "x" || k[1] === "X" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(c) && c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ""; }
  return XML_KACIS[k.toLowerCase()] ?? m;
});
const metinAl = (s) => { const t = String(s || "").trim(); const c = t.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/); return c ? c[1] : kacisCoz(t); };
// HTML parçasından düz metin (etiket yürütülmez; <style>/<script> içeriği atılır)
const duzMetin = (h) => kacisCoz(String(h || "").replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const ilkEtiket = (xml, ad) => { const m = xml.match(new RegExp(`<${ad}\\b[^>]*>([\\s\\S]*?)</${ad}>`)); return m ? m[1] : null; };
const bos = (v) => v == null || v === "" || /^(nan|null|none|-)$/i.test(String(v).trim());

// Açıklama tablosu → { alan: değer } (yalnız düz metin; izin listesi dışındaki alanlar ATILIR)
const ALAN_IZIN = { "Description": "saha_adi", "İl": "il", "İlçe": "ilce", "Adres": "adres", "Durum": "saha_durum", "Saha Tipi": "saha_tipi", "Kategori": "kategori",
  "Site ID": "site_id", "SITE ID": "site_id", "SiteID": "site_id", "SITE_ID": "site_id", "Category": "plan_kategori", "Project": "plan_proje", "Atlas Proje Adı": "plan_proje" };
function aciklamaAlanlari(html) {
  const out = {};
  const rx = /<tr\b[^>]*>\s*<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>\s*<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m;
  while ((m = rx.exec(html))) {
    const k = duzMetin(m[1]).replace(/ /g, " "), v = duzMetin(m[2]);
    const hedef = ALAN_IZIN[k];
    if (hedef && !bos(v) && out[hedef] == null) out[hedef] = v.slice(0, 300);
  }
  return out;
}
function genisVeri(xml) {
  const out = {};
  const ed = ilkEtiket(xml, "ExtendedData");
  if (!ed) return out;
  const rx = /<Data\b[^>]*\bname="([^"]*)"[^>]*>[\s\S]*?<value>([\s\S]*?)<\/value>[\s\S]*?<\/Data>|<SimpleData\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/SimpleData>/g;
  let m;
  while ((m = rx.exec(ed))) {
    const k = kacisCoz(m[1] ?? m[3]).trim(), v = duzMetin(metinAl(m[2] ?? m[4]));
    const hedef = ALAN_IZIN[k];
    if (hedef && !bos(v) && out[hedef] == null) out[hedef] = v.slice(0, 300);
  }
  return out;
}

// ── Koordinat ───────────────────────────────────────────────────────────────────────────────────────────────────
const icinde = (lat, lng) => lat >= TR_KUTU.enlemMin && lat <= TR_KUTU.enlemMax && lng >= TR_KUTU.boylamMin && lng <= TR_KUTU.boylamMax;
// "boylam,enlem[,yük]" → { lat, lng, durum: GECERLI|TERS|GECERSIZ, neden }
function koordinatCoz(metin) {
  const ham = String(metin || "").trim();
  const ilk = ham.split(/\s+/)[0] || "";
  const p = ilk.split(",");
  if (p.length < 2) return { durum: "GECERSIZ", neden: "Koordinat yok", ham: ham.slice(0, 80) };
  const lng = Number(p[0]), lat = Number(p[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || (lat === 0 && lng === 0)) return { durum: "GECERSIZ", neden: "Koordinat sayı değil / sıfır", ham: ilk };
  if (icinde(lat, lng)) return { durum: "GECERLI", lat, lng, ham: ilk };
  if (icinde(lng, lat)) return { durum: "TERS", lat, lng, neden: "Enlem / boylam yer değiştirmiş görünüyor — düzeltilmedi", ham: ilk };
  return { durum: "GECERSIZ", lat, lng, neden: "Koordinat Türkiye sınırları dışında", ham: ilk };
}

// ── Saha kimliği ────────────────────────────────────────────────────────────────────────────────────────────────
// Kod TAM bir fiziksel saha kimliği olmalı: iş kapsamı eki (_NR700), lokasyon eki ya da fazladan karakter kabul edilmez.
function tamKimlik(kod) {
  const k = String(kod || "").trim().toUpperCase();
  const f = fizikselSaha(k);
  return f && f.tur === "STANDART" && !f.is_kapsami.length && f.lokasyon === 1 && f.fiziksel_id === k ? f.fiziksel_id : null;
}
// Placemark adı: "EM_" (emisyon) öneki yalnız ardından tam kimlik geliyorsa atılır
function addanKimlik(ad) {
  const a = String(ad || "").trim().toUpperCase();
  const m = a.match(/^EM_(.+)$/);
  return tamKimlik(m ? m[1] : a);
}

// ── KML dosyasından Point placemark'lar ────────────────────────────────────────────────────────────────────────
function kmlNoktalari(xml, dosya) {
  const sonuc = { noktalar: [], poligon: 0, cizgi: 0, dis_baglanti: 0, ic_baglanti: 0, guvensiz: false };
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) { sonuc.guvensiz = true; return sonuc; }
  const temiz = xml.replace(/<!--[\s\S]*?-->/g, "");
  for (const m of temiz.matchAll(/<NetworkLink\b[\s\S]*?<\/NetworkLink>/g)) {
    const link = ilkEtiket(m[0], "Link") || ilkEtiket(m[0], "Url") || "";
    const href = metinAl(ilkEtiket(link, "href") || "");
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) sonuc.dis_baglanti++; else if (href) sonuc.ic_baglanti++;
  }
  for (const m of temiz.matchAll(/<Placemark\b([^>]*)>([\s\S]*?)<\/Placemark>/g)) {
    const govde = m[2];
    const pmId = (m[1].match(/\bid="([^"]*)"/) || [])[1] || null;
    const noktalar = [...govde.matchAll(/<Point\b[^>]*>([\s\S]*?)<\/Point>/g)].map((x) => metinAl(ilkEtiket(x[1], "coordinates") || ""));
    if (!noktalar.length) {
      if (/<Polygon\b/.test(govde)) sonuc.poligon++; else if (/<LineString\b/.test(govde)) sonuc.cizgi++;
      continue;
    }
    const ad = duzMetin(metinAl(ilkEtiket(govde, "name") || ""));
    const aciklama = metinAl(ilkEtiket(govde, "description") || "");
    const alan = { ...aciklamaAlanlari(aciklama), ...genisVeri(govde) };
    const koord = noktalar.map(koordinatCoz);
    // Birden fazla Point: aynı yerde değilse belirsiz
    const gecerli = koord.filter((k) => k.durum === "GECERLI");
    let k = koord[0];
    if (koord.length > 1 && gecerli.length > 1 && gecerli.some((x) => kusUcusuKm(x, gecerli[0]) * 1000 > MUKERRER_TOLERANS_M))
      k = { ...gecerli[0], durum: "COKLU", neden: "Kayıtta birden fazla farklı nokta var" };
    sonuc.noktalar.push({ dosya, placemark_id: pmId, ad: ad.slice(0, 80), alan, koord: k });
  }
  return sonuc;
}

const TASINABILIR_RX = /^(MOBIL|KARAVAN)$/i;
const TEKRARLAYICI_RX = /REPEATER/i;

// ── KMZ'yi oku → benzersiz Site ID grupları + geçersiz / kodsuz / tekrarlayıcı sayıları (DB yok) ───────────────────
function kmzOku(buf, dosyaAdi = "") {
  const girdiler = zipGirdileri(buf);
  const kmlGirdileri = girdiler.filter((g) => /\.kml$/i.test(g.ad) && !g.ad.endsWith("/"));
  if (!kmlGirdileri.length) throw new Error("Arşivde KML dosyası yok");
  const ozet = { dosya_adi: String(dosyaAdi || "").slice(0, 200), sha256: crypto.createHash("sha256").update(buf).digest("hex"), boyut: buf.length,
    kml_sayisi: kmlGirdileri.length, diger_dosya: girdiler.length - kmlGirdileri.length, kml_guvensiz: [], kml_hatali: [], dis_baglanti: 0, ic_baglanti: 0,
    poligon: 0, cizgi: 0, okunan_nokta: 0, kayit_tarihleri: [] };
  const tarihler = new Set();
  let toplam = 0;
  const hamNoktalar = [];
  for (const g of kmlGirdileri) {
    toplam += g.acik;
    if (toplam > SINIR.toplamBoyut) throw new Error("Açılmış toplam boyut sınırı aşıldı");
    let xml;
    try { xml = zipOku(buf, g).toString("utf8"); } catch (e) { ozet.kml_hatali.push(`${g.ad}: ${e.message}`); continue; }
    const r = kmlNoktalari(xml, g.ad);
    if (r.guvensiz) { ozet.kml_guvensiz.push(g.ad); continue; }
    ozet.dis_baglanti += r.dis_baglanti; ozet.ic_baglanti += r.ic_baglanti; ozet.poligon += r.poligon; ozet.cizgi += r.cizgi;
    if (r.noktalar.length && g.kayit_tarihi) tarihler.add(g.kayit_tarihi);
    for (const n of r.noktalar) hamNoktalar.push({ ...n, kml_tarih: g.kayit_tarihi });
  }
  ozet.okunan_nokta = hamNoktalar.length;
  ozet.kayit_tarihleri = [...tarihler].sort();

  const gecersiz = [], kodsuz = [], tekrarlayici = [];
  const grup = new Map();
  for (const n of hamNoktalar) {
    const kat = n.alan.kategori || "";
    if (TEKRARLAYICI_RX.test(kat)) { tekrarlayici.push(n); continue; }
    // Site ID adaylarını gerçek alanlardan topla; birbirini tutmuyorsa belirsiz
    const adaylar = [...new Set([addanKimlik(n.ad), tamKimlik(n.alan.site_id)].filter(Boolean))];
    if (!adaylar.length) { kodsuz.push(n); continue; }
    if (adaylar.length > 1) n.kimlik_celiski = `Ad (${n.ad}) ile Site ID alanı (${n.alan.site_id}) farklı`;
    const id = adaylar[0];
    if (n.koord.durum === "GECERSIZ" || n.koord.durum === "TERS") { gecersiz.push({ ...n, fiziksel_id: id }); continue; }
    (grup.get(id) || grup.set(id, []).get(id)).push(n);
  }
  const gruplar = [];
  for (const [id, kayitlar] of grup) {
    // Açıklaması zengin (alanı en çok) kayıt temsilci; doc.kml gibi özet kopyalar yalnız koordinat tutarlılığına bakılır
    const temsil = [...kayitlar].sort((a, b) => Object.keys(b.alan).length - Object.keys(a.alan).length || (a.dosya === "doc.kml") - (b.dosya === "doc.kml"))[0];
    const alan = temsil.alan;
    const gecerli = kayitlar.filter((k) => k.koord.durum === "GECERLI");
    const nedenler = [];
    let enUzak = 0;
    for (const a of gecerli) for (const b of gecerli) enUzak = Math.max(enUzak, kusUcusuKm(a.koord, b.koord) * 1000);
    if (enUzak > MUKERRER_TOLERANS_M) nedenler.push(`Aynı Site ID ${kayitlar.length} kayıtta farklı koordinatlarla (en uzak ${Math.round(enUzak)} m) — mükerrer / çelişkili`);
    if (kayitlar.some((k) => k.koord.durum === "COKLU")) nedenler.push("Kayıtta birden fazla farklı nokta var");
    if (kayitlar.some((k) => k.kimlik_celiski)) nedenler.push(kayitlar.find((k) => k.kimlik_celiski).kimlik_celiski);
    const durum = String(alan.saha_durum || "").toUpperCase();
    if (!durum) nedenler.push(alan.plan_proje || alan.plan_kategori ? "Saha durumu yazmıyor; plan / aday saha noktası (kesin konum değil)" : "Saha durumu yazmıyor — kesin konum olduğu doğrulanamadı");
    else if (durum === "PLANNED") nedenler.push("Saha durumu PLANNED — konum kesinleşmemiş olabilir");
    else if (!["ACTIVE", "HALTED"].includes(durum)) nedenler.push(`Saha durumu tanınmıyor (${alan.saha_durum})`);
    if (TASINABILIR_RX.test(String(alan.saha_tipi || "").trim())) nedenler.push(`Saha tipi ${alan.saha_tipi} — taşınabilir saha, konum değişebilir`);
    const k = gecerli.find((x) => x === temsil)?.koord || gecerli[0]?.koord || temsil.koord;
    gruplar.push({ fiziksel_id: id, lat: k.lat, lng: k.lng, sinif: nedenler.length ? "BELIRSIZ" : "KABUL", nedenler, kayit_sayisi: kayitlar.length,
      kaynak: { kml_dosya: temsil.dosya, placemark_id: temsil.placemark_id, ad: temsil.ad, ham: k.ham, kopya_dosyalar: [...new Set(kayitlar.map((x) => x.dosya))].filter((d) => d !== temsil.dosya) },
      saha_adi: alan.saha_adi || "", il: alan.il || "", ilce: alan.ilce || "", adres: alan.adres || "", saha_durum: alan.saha_durum || "", saha_tipi: alan.saha_tipi || "",
      kml_tarih: temsil.kml_tarih || null });
  }
  gruplar.sort((a, b) => a.fiziksel_id.localeCompare(b.fiziksel_id));
  const kisa = (n) => ({ ad: n.ad, fiziksel_id: n.fiziksel_id || null, dosya: n.dosya, placemark_id: n.placemark_id, neden: n.koord.neden || "", ham: n.koord.ham || "" });
  return { ozet, gruplar, gecersiz: gecersiz.map(kisa), kodsuz: kodsuz.map((n) => ({ ad: n.ad, dosya: n.dosya, placemark_id: n.placemark_id })),
    tekrarlayici_sayisi: tekrarlayici.length };
}

// ── Sistemle eşleştir (saf): her grup için sınıf ────────────────────────────────────────────────────────────────
//  sistemIdler : Set — sistemdeki doğrulanmış fiziksel Site ID'ler (Rollout + Günlük İş Girişi iş kodlarından sahaKimlik ile)
//  teknoIdler  : Set — Teknocenter yetkili kapsamındaki fiziksel Site ID'ler
//  mevcut      : Map fiziksel_id → saha_konum satırı
// Sınıf: YENI (mevcut koordinat yok/geçersiz) · UYUMLU (≤100 m) · CELISKI (>100 m — kaynak seçimi gerekir) · BELIRSIZ · ESLESMEYEN
function eslestir(okuma, { sistemIdler, teknoIdler = new Set(), mevcut = new Map() }) {
  const satirlar = [];
  for (const g of okuma.gruplar) {
    const eslesti = sistemIdler.has(g.fiziksel_id);
    const tekno = teknoIdler.has(g.fiziksel_id);
    const m = mevcut.get(g.fiziksel_id);
    const mLat = m && m.lat != null ? Number(m.lat) : null, mLng = m && m.lng != null ? Number(m.lng) : null;
    const mGecerli = mLat != null && mLng != null && ["KESIN", "CELISKILI"].includes(m.dogruluk) && icinde(mLat, mLng);
    const fark = mGecerli ? Math.round(kusUcusuKm({ lat: mLat, lng: mLng }, g) * 1000) : null;
    let sinif, neden = g.nedenler.join("; ");
    if (!eslesti) sinif = "ESLESMEYEN";
    else if (g.sinif === "BELIRSIZ") sinif = "BELIRSIZ";
    else if (!mGecerli) { sinif = "YENI"; if (m) neden = m.lat == null ? "Mevcut kayıtta yalnız adres var" : `Mevcut koordinat kullanılamıyor (${m.dogruluk})`; }
    else if (m.kaynak === "KMZ" && fark <= MEVCUT_TOLERANS_M) { sinif = "UYUMLU"; neden = "Aynı KMZ konumu zaten kayıtlı"; }
    else if (fark <= MEVCUT_TOLERANS_M) { sinif = "UYUMLU"; neden = `Mevcut ${m.kaynak} konumuyla ${fark} m fark`; }
    else { sinif = "CELISKI"; neden = `Mevcut ${m.kaynak} konumundan ${fark >= 1000 ? `${(fark / 1000).toFixed(1)} km` : `${fark} m`} uzak — kaynak seçimi gerekir`; }
    satirlar.push({ ...g, sinif_kmz: g.sinif, sinif, neden, teknocenter: tekno,
      mevcut: m ? { lat: mLat, lng: mLng, kaynak: m.kaynak, dogruluk: m.dogruluk, fark_m: fark } : null });
  }
  const say = (s) => satirlar.filter((x) => x.sinif === s).length;
  const eslesen = satirlar.filter((x) => x.sinif !== "ESLESMEYEN");
  const ozet = {
    okunan_nokta: okuma.ozet.okunan_nokta, benzersiz_site: okuma.gruplar.length,
    eslesen_fiziksel_saha: eslesen.length, teknocenter_kapsaminda: eslesen.filter((x) => x.teknocenter).length,
    yeni_konum_adayi: say("YENI"), uyumlu: say("UYUMLU"), mevcut_ile_celisen: say("CELISKI"), belirsiz: say("BELIRSIZ"),
    eslesmeyen: say("ESLESMEYEN") + okuma.kodsuz.length, eslesmeyen_site: say("ESLESMEYEN"), kodsuz: okuma.kodsuz.length,
    tekrarlayici: okuma.tekrarlayici_sayisi, gecersiz: okuma.gecersiz.length,
    teknocenter_yeni: satirlar.filter((x) => x.teknocenter && x.sinif === "YENI").length,
    teknocenter_celisen: satirlar.filter((x) => x.teknocenter && x.sinif === "CELISKI").length,
  };
  return { ozet, satirlar };
}

module.exports = { kmzOku, eslestir, kmlNoktalari, koordinatCoz, addanKimlik, tamKimlik, aciklamaAlanlari, zipGirdileri, duzMetin,
  MUKERRER_TOLERANS_M, MEVCUT_TOLERANS_M, SINIR };
