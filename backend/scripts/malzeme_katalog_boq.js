#!/usr/bin/env node
// MALZEME KATALOĞU — BoQ'dan kaynaklı fiziksel malzeme adayları (29.10.2026). VERİTABANINA BAĞLANMAZ.
// Huawei 2026-2027 Frame BoQ dosyalarındaki satırları okur, fiziksel stok malzemesini hizmet / paket kalemlerinden ayırır ve
// her aday için kaynak (dosya, sayfa, satır, BoQ kodu, sürüm) ile birlikte JSON + önizleme Excel'i üretir. İçe alma ayrı
// adımdır: POST /malzeme/katalog/ice-al (önce önizleme, sonra yönetici onayı). Fiyat OKUNMAZ, YAZILMAZ: BoQ satış fiyatı
// malzemenin alış/depo fiyatı değildir.
//
// Ayrım kuralları
//   S (hizmet)                         → hariç (HIZMET)
//   Birim SITE / HOP / Package satırı  → hariç (PAKET — birden fazla malzeme içerir, reçete/BOM miktarı uydurulmaz)
//   M+S ama adında yalnız hizmet fiili  → hariç (HIZMET_AGIRLIKLI: söküm, revizyon, yer değişimi, kurulum… ve "temin" yok)
//   M (malzeme)                        → aday, ilişki MALZEME
//   M+S + temin/tedarik/fiziksel nesne  → aday, ilişki TEDARIK_MONTAJ (malzeme ile montaj hizmeti ilişkisi korunur)
//   M ama adında montaj fiili          → aday ama DOGRULANAMADI (incelemeye)
// Teknik özellikler yalnız kaynak metinde yazdığı ölçüde çıkarılır (kesit, uzunluk, feeder çapı, akım, U, kVA, et kalınlığı).
//
// Kullanım: node backend/scripts/malzeme_katalog_boq.js <BoQ klasörü> <cikti.json> [onizleme.xlsx]
const path = require("path");
const fs = require("fs");
const nm = (m) => { try { return require(require.resolve(m, { paths: [path.join(__dirname, ".."), process.cwd()] })); } catch { return require(m); } };
const ExcelJS = nm("exceljs");

const DOSYALAR = [
  { ad: "Türkiye 2026-2027 Integrated Frame BOQ for TE Tender.xlsx", sayfa: "L4-Item Specification", surum: "BOQ2026-TE",
    kol: { tur: 1, kod: 2, en: 4, tr: 5, birim: 6, ms: 7, sow: 12 } },
  { ad: "Türkiye 2026-2027 Integrated Frame BOQ for Power Access Tender3.xlsx", sayfa: "Aciklamalar", surum: "BOQ2026-PA",
    kol: { tur: 1, kod: 2, en: 4, tr: 5, birim: 6, ms: 7, sow: 9 } },
  { ad: "Türkiye 2026-2027 Integrated Frame BOQ for New Site Tender.xlsx", sayfa: "L4-Specification", surum: "BOQ2026-NS",
    kol: { tur: 1, kod: 2, en: 4, tr: 5, birim: 6, ms: 7, sow: 12 } },
];
const BIRIM = { PCS: "Adet", PC: "Adet", ADET: "Adet", M: "Metre", MT: "Metre", METRE: "Metre", SET: "Takım", "M*M": "M²", M2: "M²", "M²": "M²",
  "CU.M.": "M³", M3: "M³", "M³": "M³", KG: "Kg", LT: "Litre", L: "Litre" };
const PAKET_BIRIM = ["SITE", "HOP", "LINK", "SECTOR"];
const HIZMET_FIIL = /(söküm|sökül|demontaj|revizyon|yer değiş|taşınma|kurulumu|kurulum ve|devreye al|montajı(?!.*temin)|montajının|açılması|çalışması|ölçüm|hazırlanma|bakım|test|keşif|boyanma|izolasyon|kapatma|işleri|yapılması|yapımı|kullanımı|değişimi|kesme|açma ve|kapama|bağlantısı|bağlantı yapılması|hattı montajı)/i;
const TEMIN = /(temin|tedari|supply|temİn)/i;
const tr = (s) => String(s || "").replace(/\s+/g, " ").trim();
const UST = (s) => tr(s).toLocaleUpperCase("tr");
const hucre = (c) => { const x = c && c.value; if (x == null) return ""; if (typeof x === "object") { if (x.richText) return x.richText.map((t) => t.text).join(""); if (x.result !== undefined) return String(x.result); if (x.text) return x.text; return ""; } return String(x); };

// Ad temizliği: birim/ölçü kuyruğu ve tedarik/montaj kalıpları çıkarılır; ölçüler ve tipler korunur
function adTemizle(s) {
  let a = tr(s);
  // Not: JS \b Türkçe harfte (ı, ş, ğ) çalışmaz — kalıplar sona bakışla sınırlanır
  const SON = "(?=$|[\\s,;.)(])";
  a = a.replace(/^\s*malzeme\s+(tedari[ğg]i|ta[dt]ari[ğg]i)?\s*(ve\s+)?montajı\s+dahil\s*/i, "");
  a = a.replace(new RegExp("\\s*(temini|teminİ|temin|tedariği|tadariği|tedarik)\\s+ve\\s+(montajı|kurulumu|serimi|montaj)" + SON, "gi"), " ");
  a = a.replace(/^\s*malzeme\s+ta[dt]ari[ğg]i\s*/i, "");
  a = a.replace(new RegExp("\\s*[,;]?\\s*(adet|metre|m|set|takım|saha|metreküp|metrekare|m2|kg|hop)\\s+(bazlı|bazli|başına|başı)" + SON, "gi"), "");
  a = a.replace(/,?\s*malzeme ve montajı dahil/i, "");
  a = a.replace(/\s*(temini|teminİ|tedariği)(?=$|[\s,;.)(–-])/gi, " ").replace(/\s*–\s*$/, "");
  a = a.replace(/\s*[,;]?\s*(adet|metre|set|takım|saha|hop|m2|metre kare|kg)\s*(bazlı|başına|başı)\.?\s*$/i, "");
  a = a.replace(/\s*[,;]?\s*per\s+(pcs|pc|piece|m|meter|set|site|hop|m2|kg)\.?\s*$/i, "");
  a = a.replace(/^\s*(malzeme\s+)?tedari[ğg]i\s+ve\s+montajı\s+dahil\s*/i, "").replace(/^\s*tedarik\s+ve\s+kurulum\s*/i, "");
  a = a.replace(/^\s*supply\s+(and|&)\s+install(ation)?\s+(of\s+)?/i, "").replace(/^\s*supply\s+(of\s+)?/i, "");
  a = a.replace(/\s+(temini\s+ve\s+montajı|temin\s+ve\s+montajı|tedariği\s+ve\s+montajı|temini|teminİ|tedariği)\s*$/i, "");
  a = a.replace(/\s*(temini|tedariği)\s*(?=[,(]|$)/gi, " ").replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").replace(/[,;\s]+$/, "");
  return a.replace(/^hertipte\s+/i, "Her tipte ").trim();
}
// Kaynakta yazan teknik özellikler (yalnız metinde varsa)
function teknikCikar(ad, en) {
  const m = `${ad} | ${en}`;
  const t = {};
  const kesit = m.match(/(\d+\s*[xX×]\s*\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?(?:\s*\+\s*\d+(?:[.,]\d+)?)?)\s*(mm²|mm2|mm)?/);
  if (kesit && /kablo|cable|xlpe|nyy|nyaf|nyfgby|nym|enerji|energy|toprak/i.test(m) && !/pencere|roxtec|kanal|tava|boru/i.test(m)) t.kesit = kesit[1].replace(/\s+/g, "").replace(/[X×]/g, "x") + " mm²";
  const tip = m.match(/\b(NYY|NYAF|NYFGBY|NYM|XLPE|YVZ3V|YVŞV|N2XH|H07RN-F|TTR)\b/i); if (tip) t.kablo_tipi = tip[1].toUpperCase();
  const acsr = m.match(/\b(Aster|Pansy|Pigeon|Rose|Raven|Swallow)\b/i); if (acsr) t.iletken_tipi = acsr[1];
  if (/havai/i.test(m)) t.kurulum = "Havai"; else if (/yeraltı|yer altı|underground/i.test(m)) t.kurulum = "Yeraltı";
  if (/al[uü]min/i.test(m)) t.iletken = "Alüminyum"; else if (/bakır|copper/i.test(m)) t.iletken = "Bakır";
  const feeder = m.match(/(1\/2|7\/8|7\/16|4[.,]3-10|1\s*1\/4|1-1\/4)\s*["”'']?/); if (feeder && /feeder|konnekt|connector|jumper/i.test(m)) t.feeder_cap = feeder[1].replace(",", ".") + '"';
  const uz = m.match(/(?:Yükseklik\s*:\s*)?(\d+(?:[.,]\d+)?)\s*(m|mt|metre|metrelik)\b(?!m)/i); if (uz && /pole|direk|direğ|gizleme|ofset|offset|lprt|aydınlatma/i.test(m)) t.uzunluk_m = uz[1].replace(",", ".");
  const amp = m.match(/(\d+)\s*A\s*-\s*(\d+)\s*A/i) || m.match(/(\d+)\s*A\b/); if (amp && /sigorta|breaker|kesici|şalter|röle|kaçak/i.test(m)) t.akim_a = amp[2] ? `${amp[1]}-${amp[2]}` : amp[1];
  const u = m.match(/(\d+)\s*U\s*(?:to|-)\s*(\d+)\s*U/i) || m.match(/(\d+)\s*U\b/); if (u && /rack|kabinet|cabinet/i.test(m)) t.rack_u = u[2] ? `${u[1]}-${u[2]}` : u[1];
  const kva = m.match(/(\d+)\s*kVA/i); if (kva) t.guc_kva = kva[1];
  const et = m.match(/t\s*:\s*(\d+)\s*mm/i); if (et) t.et_kalinligi_mm = et[1];
  const ebat = m.match(/(\d+)\s*[xX]\s*(\d+)\s*(?:cm|mm)?\s*(ÇELİK|çelik)?\s*TAVA/i); if (ebat) t.ebat = `${ebat[1]}x${ebat[2]}`;
  return t;
}
function kategori(a, tur) {
  const m = UST(a) + " " + UST(tur);
  if (/AYDINLATMA DİREĞ/.test(m)) return "Aydınlatma direği (lamppost)";
  if (/AG DİREĞ|ENERJİ DİREĞ|TAŞIYICI DİREĞ|SONLANDIRICI DİREK|DURDURUCU DİREĞ|ZAVİYE DİREĞ|TRAFO DİREĞ/.test(m)) return "AG / OG enerji direkleri";
  if (/LPRT|\bPOLE\b|MONOPOL/.test(m) && !/OFSET|OFFSET|APARAT|KONSOL/.test(m)) return "LPRT pole";
  if (/OFSET|OFFSET|KONSOL|KELEPÇE|KLEMP|APARAT|YANKOL|SEHPA|BRAKET/.test(m)) return "Anten / MW ofset, konsol ve montaj aparatı";
  if (/FEEDER|JUMPER|KOAKS|KONNEKTÖR|CONNECTOR/.test(m)) return "RF feeder, jumper ve konnektör";
  if (/FİBER|FIBER|PATCH/.test(m)) return "Fiber kablo, patch cord ve aksesuar";
  if (/SİGORTA|KESİCİ|PARAFUDR|RÖLE|ŞALTER|KAÇAK AKIM|SEKSİYONER|DİSCONNECTOR|BREAKER/.test(m)) return "Sigorta, kesici, parafudr ve bağlantı";
  if (/İZOLATÖR|BUŞİNG|TERMİNAL KAPA|KOMPANZASYON|\bAOS\b|OSOS|TRAFO/.test(m)) return "AG / OG enerji hattı ekipmanı";
  if (/KABİNET|KABINET|PANO|PANEL|RACK|ACDB|DCDB|DAĞITIM|SAYAÇ|BUAT|KUTU|KABİN/.test(m)) return "Outdoor kabinet, pano ve dağıtım";
  if (/KANAL|TAVA|C-RAY|BORU|SPİRAL|SPIRAL|KANALET|MERDİVEN|ROXTEC|PENCERE/.test(m)) return "Kablo kanalı, tava, boru ve geçiş";
  if (/KABLO BAĞI/.test(m)) return "Etiket, plaka, levha ve sarf";
  if (/KABLO|CABLE|XLPE|NYY|NYAF|NYFGBY|NYM|İLETKEN|TOPRAK/.test(m)) return "Enerji ve topraklama kabloları";
  if (/ETİKET|PLAKA|LEVHA|KİLİT|UYARI/.test(m)) return "Etiket, plaka, levha ve sarf";
  if (/GİZLEME|KAMUFLAJ/.test(m)) return "Kamuflaj / gizleme";
  if (/KONTEYNER|SEPARASYON|SEPERASYON|BETON|ÇAKIL|ÇİM|KAPI|PARMAKLIK|ÇİT|KLİMA|COOLING|DAVLUMBAZ|YAŞAM HATTI|YÜRÜYÜŞ|KORKULUK/.test(m)) return "Saha altyapısı ve EHS (tedarik+montaj)";
  return "Diğer BoQ malzemesi";
}

(async () => {
  const [klasor, ciktiJson, ciktiXlsx] = process.argv.slice(2);
  if (!klasor || !ciktiJson) { console.error("Kullanım: malzeme_katalog_boq.js <BoQ klasörü> <cikti.json> [onizleme.xlsx]"); process.exit(1); }
  const okunan = [], adaylar = new Map(), haric = [];
  for (const d of DOSYALAR) {
    const yol = path.join(klasor, d.ad);
    if (!fs.existsSync(yol)) { console.error("Dosya yok:", yol); continue; }
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(yol);
    const ws = wb.getWorksheet(d.sayfa);
    ws.eachRow((r, satir) => {
      const g = (k) => tr(hucre(r.getCell(d.kol[k])));
      const ms = g("ms").toUpperCase().replace(/\s/g, ""), trAd = g("tr"), enAd = g("en"), birimHam = g("birim"), kodHam = g("kod"), tur = g("tur");
      if (!["M", "S", "M+S"].includes(ms) || !(trAd || enAd)) return; // başlık / grup satırı
      const kaynak = { dosya: d.ad, sayfa: d.sayfa, satir, surum: d.surum, boq_kod: /^\d{8,}$/.test(kodHam) ? kodHam : null, boq_kod_ham: kodHam, ms, birim_ham: birimHam, tur, tr: trAd, en: enAd };
      okunan.push(kaynak);
      const bU = birimHam.toUpperCase().replace(/\s/g, "");
      if (ms === "S") return haric.push({ ...kaynak, neden: "HIZMET" });
      if (PAKET_BIRIM.includes(bU) || /^PACKAGE/i.test(tur)) return haric.push({ ...kaynak, neden: "PAKET (saha/hop bazlı; içerdiği malzemeler ve miktarları kaynakta yok)" });
      const ad = adTemizle(trAd || enAd);
      // "temin" yalnız Türkçe addan okunur (İngilizcede "power supply" gibi ifadeler tedarik anlamına gelmez)
      // Ad hizmet fiiliyle başlıyorsa (ilk ~70 karakter) ya da "gerekli tüm malzemeler dahil" anahtar teslim hizmetse → hizmet ağırlıklı
      const bas = (trAd || enAd).slice(0, 70);
      const servisAgir = (HIZMET_FIIL.test(bas) && !TEMIN.test(bas)) || /gerekli tüm (malzeme|kablolama)/i.test(trAd);
      if (ms === "M+S" && servisAgir) return haric.push({ ...kaynak, neden: "HİZMET AĞIRLIKLI (söküm / revizyon / kurulum; temin yok)" });
      const birim = BIRIM[bU] || null;
      const durum = !birim ? "EKSIK_BIRIM" : (ms === "M" && servisAgir ? "DOGRULANAMADI" : "ADAY");
      const anahtar = UST(ad).replace(/[^A-Z0-9ÇĞİÖŞÜ/.,+]+/g, " ").trim();
      const mevcut = adaylar.get(anahtar);
      const bag = { boq_kod: kaynak.boq_kod, boq_kod_ham: kodHam, surum: d.surum, iliski: ms === "M" ? "MALZEME" : "TEDARIK_MONTAJ", dosya: d.ad, sayfa: d.sayfa, satir, tr: trAd, en: enAd, birim_ham: birimHam };
      if (mevcut) { mevcut.kaynaklar.push(bag); if (mevcut.temel_birim !== birim) mevcut.uyarilar.push(`Farklı kaynakta farklı birim: ${birimHam}`); return; }
      adaylar.set(anahtar, { ad, ad_en: adTemizle(enAd) || null, kategori: kategori(ad + " " + enAd, tur), temel_birim: birim, teknik: teknikCikar(trAd, enAd),
        durum, uyarilar: durum === "DOGRULANAMADI" ? ["'M' olarak işaretli ama adında montaj/hizmet ifadesi var — fiziksel malzeme olduğunu doğrulayın"] : durum === "EKSIK_BIRIM" ? [`Birim çözülemedi: ${birimHam || "(boş)"}`] : [],
        kaynaklar: [bag] });
    });
  }
  const liste = [...adaylar.values()].sort((a, b) => a.kategori.localeCompare(b.kategori, "tr") || a.ad.localeCompare(b.ad, "tr"));
  const ozet = { okunan: okunan.length, aday: liste.filter((x) => x.durum === "ADAY").length, dogrulanamadi: liste.filter((x) => x.durum === "DOGRULANAMADI").length,
    eksik_birim: liste.filter((x) => x.durum === "EKSIK_BIRIM").length, haric_hizmet: haric.filter((x) => x.neden === "HIZMET").length,
    haric_paket: haric.filter((x) => x.neden.startsWith("PAKET")).length, haric_hizmet_agirlikli: haric.filter((x) => x.neden.startsWith("HİZMET AĞ")).length };
  fs.writeFileSync(ciktiJson, JSON.stringify({ uretim: new Date().toISOString(), kaynak_klasor: klasor, ozet, adaylar: liste, haric }, null, 1));
  console.log("Özet:", ozet);
  if (ciktiXlsx) {
    const wb = new ExcelJS.Workbook();
    const sayfa = (ad, kol, rows) => { const s = wb.addWorksheet(ad, { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });
      s.getRow(1).values = kol.map((k) => k[0]); s.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      s.getRow(1).eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } }; }); kol.forEach((k, i) => { s.getColumn(i + 1).width = k[2]; });
      for (const r of rows) s.addRow(kol.map((k) => (typeof k[1] === "function" ? k[1](r) : r[k[1]]) ?? "")); };
    sayfa("Malzeme adayları", [["Durum", "durum", 14], ["Kategori", "kategori", 30], ["Ad (TR)", "ad", 60], ["Ad (EN)", "ad_en", 50], ["Birim", "temel_birim", 8],
      ["Teknik", (r) => Object.entries(r.teknik).map(([k, v]) => `${k}: ${v}`).join("; "), 34], ["BoQ kodları", (r) => r.kaynaklar.map((k) => `${k.boq_kod || k.boq_kod_ham} (${k.surum}, ${k.iliski})`).join("; "), 40],
      ["Kaynak", (r) => r.kaynaklar.map((k) => `${k.sayfa} s.${k.satir}`).join("; "), 26], ["Uyarı", (r) => r.uyarilar.join("; "), 50]], liste);
    sayfa("Hariç tutulanlar", [["Neden", "neden", 40], ["BoQ kodu", "boq_kod_ham", 14], ["M/S", "ms", 6], ["Birim", "birim_ham", 8], ["Ad (TR)", "tr", 70], ["Kaynak", (r) => `${r.surum} ${r.sayfa} s.${r.satir}`, 30]], haric);
    sayfa("Özet", [["Kalem", "k", 40], ["Adet", "v", 10]], Object.entries(ozet).map(([k, v]) => ({ k, v })));
    await wb.xlsx.writeFile(ciktiXlsx);
  }
})().catch((e) => { console.error("HATA:", e.message); process.exit(1); });
