// ═══ BoQ PAKET KAPSAMI + PAKET ÖNCELİKLİ TSSR DEĞERLENDİRMESİ (28.10.2026, Orhan) ═════════════════════════════
// Yeni ihalede paket bazlı çalışılır: TSSR'daki her küçük işi ayrı PR kalemine çevirmeden önce uygun ana paket seçilir,
// paketin SOW'unda geçen işler "pakete dahil" sayılır, yalnız paket dışında kalan ve dayanağı olan işler ek kalem önerilir.
// Bilgi tabanı: data/boq_paket_kapsam.json (scripts/paket_kapsam_uret.py — L4 SOW sayfaları, hücre referanslı, fiyatsız).
// Fiyat yalnız boq_katalog'dan (imzalı fiyat ekleri) gelir. Seçili BoQ sürümü esastır; 2025 kuralları 2026'ya taşınmaz.
// Belirsizlikte kesin hüküm verilmez: "Kontrol gerekli". Paketin SITE birimi ekipman adediyle çarpılmaz.
const KB = require("./data/boq_paket_kapsam.json");
const { kapsamIfadeleri, bantSinifi } = require("./sahaKimlik");

const KAYIT = {}; // surum|kod → kayıt
for (const k of KB.kayitlar) KAYIT[`${k.surum}|${k.kod}`] = k;
const kayitGetir = (surum, kod) => KAYIT[`${surum}|${String(kod || "").trim()}`] || null;

// ── İş etiketleri: SOW satırı, katalog açıklaması ve TSSR işi aynı sözlükle etiketlenir (tek kaynak) ───────────────
const ETIKET = [
  { k: "BBU_MONTAJ", ad: "BBU kurulumu", sow: /(?<!(existing|from|to|from the) )\bBBU\b(?![^,.;]*removal)(?! to antenna)|BBU installation|BBU Modernization/i },
  { k: "BBU_SOKUM", ad: "BBU sökümü", sow: /BBU removal|BBU Modernization|BBU dismantl/i },
  { k: "KART", ad: "Kart / board ilavesi", sow: /\bCard\b|board addition|Boards addition/i },
  { k: "DCDU", ad: "DCDU", sow: /\bDCDU\b/i },
  { k: "RRU_MONTAJ", ad: "RRU kurulumu", sow: /RRU installation|pcs RRU|Including[^.]*\bRRU\b|installation new[^.]*RRU|Additional RRU|RRU Modernization/i },
  { k: "RRU_SOKUM", ad: "Mevcut RRU sökümü", sow: /Existing RRU'?s?[^.]*dismantl|Removal existing[^.]*RRU|Removal[^.]*existing RRU|RRU dismantl|RRU Modernization/i },
  { k: "AAU_MONTAJ", ad: "AAU kurulumu", sow: /\bAAU\b(?![^.]*Excluded)/i },
  { k: "ANTEN_MONTAJ_SWAP", ad: "Anten ilave / swap", sow: /antenna addition\/swap|Antennas? Installation-dismantling-swap|antenna revision works|Antenna Swap|Antenna installation/i },
  { k: "JUMPER_RET", ad: "Jumper & RET", sow: /Jumper/i },
  { k: "COMBINER", ad: "Combiner / splitter / diplexer", sow: /Combiner|Splitter|diblexer|diplexer/i },
  { k: "FIBER", ad: "Fiber / F/O kablo", sow: /\bfiber\b|Fiber Optic|F\/O/i },
  { k: "YEDEK_FIBER", ad: "Yedek F/O", sow: /Spare Fiberoptic/i },
  { k: "DC_KABLO", ad: "DC / enerji kablosu", sow: /power and grounding cabling|DC,\s*Grounding cabling|\bDC cable\b(?! dismantle)|RRU DC cabling|all the cabling|related cables? .*DC cable/i },
  { k: "DC_KABLO_SOKUM", ad: "DC kablo sökümü", sow: /DC cable dismantle|DC Cable Dismantle/i },
  { k: "TOPRAKLAMA_KABLO", ad: "Topraklama kablosu", sow: /grounding cabling|Grounding cabling/i },
  { k: "ETIKET", ad: "Etiketleme", sow: /label/i },
  { k: "OFFSET_BORU", ad: "Boru / offset", sow: /pipe[^.]*offset|offsets? supply|support pipe|pole strength offset|Pole-offset|offset/i },
  { k: "RRU_SEHPA", ad: "RRU sehpa / çerçeve", sow: /RRU standing rack|RRU standing Frame|RRU Frame|RRU Poles/i },
  { k: "KABLO_MALZEME", ad: "Kablo montaj malzemesi", sow: /cable installation materials|cable duct|canalet|cable ladder|cable tie|paddle box/i },
  { k: "ROXTEC", ad: "Roxtec / kablo geçiş", sow: /Roxtec|Cable entry gland/i },
  { k: "TK_PLAKA", ad: "TK sertifika plakası", sow: /TK Certificate/i },
  { k: "ASBUILT", ad: "As-built", sow: /As-Built/i },
  { k: "NAKLIYE", ad: "Malzeme nakliyesi", sow: /Transportation of site material|transportation to warehouse/i },
  { k: "ENTEGRASYON", ad: "Entegrasyon / on-air", sow: /integration|on-?air/i },
  { k: "REKTIFIER_KART", ad: "Rektifiyer kart/modül ilavesi", sow: /Rectifier (card )?addition/i },
  { k: "DC_SARF", ad: "DC sarf (sigorta, bara)", sow: /DC consumable|circuit beaker|MK-03|busbar/i },
  { k: "ENVANTER", ad: "Envanter / ISDP-Atlas", sow: /Inventory Updating|ISDP|Atlas/i },
  { k: "VINC", ad: "Vinç kullanımı", sow: /^(standard )?crane usage/i },
  { k: "JUMPER_IZOLASYON", ad: "Cold shrink / izolasyon", sow: /cold shrink/i },
];
const ETIKET_AD = Object.fromEntries(ETIKET.map((e) => [e.k, e.ad]));
const HARIC_RX = /excluded|not included|hariç|dahil değil/i;

// Bir SOW satırının dahil / hariç etiketleri — "(… excluded)" ya da virgülle ayrılmış "…, AAU support Pole Excluded"
// yalnız o parçayı hariç tutar (satırın geri kalanı dahil kalır)
function sowSatiriEtiketle(metin) {
  const dahil = new Set(), haric = new Set();
  const parcalar = String(metin || "").split(/(\([^)]*\))/).flatMap((p) => (/^\(/.test(p) ? [p] : p.split(/[,;]/)));
  for (const p of parcalar) {
    const hedef = HARIC_RX.test(p) ? haric : dahil;
    for (const e of ETIKET) if (e.sow.test(p)) hedef.add(e.k);
  }
  // "Lifting(not crane)" / "Crane Usage not included" → vinç hariç
  if (/not crane|Crane Usage not included/i.test(metin)) { haric.add("VINC"); dahil.delete("VINC"); }
  for (const h of haric) dahil.delete(h);
  return { dahil: [...dahil], haric: [...haric] };
}

// Paket kaydının kapsamı: etiket → dayanak (SOW satır no + metin + hücre), koşullar (anten revizyonu, aynı ziyaret, adet aralığı)
const _kapsamOnbellek = {};
function paketKapsami(surum, kod) {
  const key = `${surum}|${kod}`;
  if (_kapsamOnbellek[key]) return _kapsamOnbellek[key];
  const k = kayitGetir(surum, kod);
  if (!k) return null;
  const dahil = {}, haric = {};
  for (const s of k.sow_satirlari) {
    const e = sowSatiriEtiketle(s.metin);
    for (const t of e.dahil) (dahil[t] = dahil[t] || []).push(s);
    for (const t of e.haric) (haric[t] = haric[t] || []).push(s);
  }
  const tumMetin = k.baslik_en + " " + k.sow_satirlari.map((s) => s.metin).join(" ");
  const aralik = (rx) => { const m = tumMetin.match(rx); return m ? { min: Number(m[1]), max: Number(m[2]) } : null; };
  const kapsam = {
    kod: k.kod, surum, tur: k.tur, baslik_en: k.baslik_en, baslik_tr: k.baslik_tr, birim: k.birim, ms: k.ms, kaynak: k.kaynak, kabul: k.kabul,
    anten_revizyonu: /without antenna revision/i.test(k.baslik_en) ? false : /with antenna revision/i.test(k.baslik_en) ? true : null,
    ayni_ziyaret: /same site visit/i.test(k.baslik_en) || /at the same time site visit with main installation/i.test(tumMetin),
    rru_araligi: aralik(/(\d+)\s*-\s*(\d+)\s*pcs RRU/i),
    anten_araligi: aralik(/(\d+)\s*-\s*(\d+)\s*pcs (?:Antenna|antenna) addition/i),
    rru_sokum_ust: (tumMetin.match(/up to (\d+) ?pcs[^.]*dismantle|Existing RRU'?s?[^.]*up to (\d+)/i) || []).slice(1).map(Number).find((x) => x > 0) || null,
    dahil, haric,
  };
  _kapsamOnbellek[key] = kapsam;
  return kapsam;
}

// ── TSSR işini etiketle ─────────────────────────────────────────────────────────────────────────────────────────
function isEtiketleri(is) {
  const t = `${is.ekipman || ""} ${is.aciklama || ""}`;
  const tur = String(is.tur || "");
  const anten = String(is.anten_cozumu || "").toUpperCase();
  const e = new Set();
  const montaj = ["MONTAJ", "ILAVE"].includes(tur), sokum = tur === "SOKUM", degisim = tur === "DEGISIM";
  if (/bant ilavesi|band addition|bant ilave/i.test(t)) e.add("BANT_ILAVESI");
  if (/\bBBU\b/i.test(t)) { if (montaj || degisim) e.add("BBU_MONTAJ"); if (sokum || degisim) e.add("BBU_SOKUM"); }
  if (/\bDCDU\b/i.test(t) && (montaj || degisim)) e.add("DCDU");
  if (/\bkart\b|board/i.test(t) && (montaj || degisim)) e.add("KART");
  if (/\bRRU\b|\bRFU\b/i.test(t) && !/jumper|cold\s*shrink/i.test(is.ekipman || "")) { if (montaj || degisim) e.add("RRU_MONTAJ"); if (sokum || degisim) e.add("RRU_SOKUM"); if (tur === "TASIMA") e.add("RRU_TASIMA"); }
  if (/\bAAU\b/i.test(t) && (montaj || degisim)) e.add("AAU_MONTAJ");
  if (/anten|antenna/i.test(is.ekipman || "") && anten !== "MEVCUT" && !e.has("BANT_ILAVESI") && (montaj || degisim || sokum)) e.add("ANTEN_MONTAJ_SWAP");
  if (/jumper|\bRET\b|\bRCU\b/i.test(t)) e.add("JUMPER_RET");
  if (/cold\s*shrink/i.test(t)) e.add("JUMPER_IZOLASYON");
  if (/combiner|splitter|dupl|diplex|diblex/i.test(t)) e.add("COMBINER");
  if (/yedek\s*(f\/o|fiber)|spare\s*f\/o/i.test(t)) e.add("YEDEK_FIBER");
  else if (/\bF\/O\b|fiber|CPRI/i.test(t)) e.add("FIBER");
  if (/(DC|enerji|power)\s*kablo|power cable|DC cable|\d+x\d+\s*mm/i.test(t)) e.add(sokum ? "DC_KABLO_SOKUM" : "DC_KABLO");
  if (/topraklama\s*kablo|grounding cable/i.test(t)) e.add("TOPRAKLAMA_KABLO");
  else if (/topraklama|grounding/i.test(t)) e.add("TOPRAKLAMA_SISTEM");
  if (/etiket|label/i.test(t)) e.add("ETIKET");
  if (/offset|anten borusu|pipe/i.test(t)) e.add("OFFSET_BORU");
  if (/sehpa|standing rack|RRU frame/i.test(t)) e.add("RRU_SEHPA");
  if (/roxtec|geçiş aparat/i.test(t)) e.add("ROXTEC");
  if (/rekt?ifi?er|rectifier/i.test(t)) e.add("REKTIFIER_KART");
  if (/TK\s*(plaka|sertifika)/i.test(t)) e.add("TK_PLAKA");
  if (/as-?built/i.test(t)) e.add("ASBUILT");
  if (/vin[cç]|crane/i.test(t)) e.add("VINC");
  if (/\bMW\b|mikrodalga|microwave/i.test(t)) e.add("MW");
  if (/LPRT|\bpole\b|direk/i.test(t) && !/offset/i.test(t)) e.add("POLE");
  if (/gizleme|camouflage|kamuflaj|baca/i.test(t)) e.add("GIZLEME");
  if (/kabinet|cabinet/i.test(t)) e.add("KABINET");
  return [...e];
}

// Katalog açıklamasının etiketleri (PR satırı "pakete dahil olabilir" kontrolü için)
function katalogEtiketleri(aciklama) { return sowSatiriEtiketle(aciklama).dahil; }

// ── Teknik kapsamdaki bantlar (kaynakta yazdığı gibi) ─────────────────────────────────────────────────────────────
function tssrBantlari(sonuc) {
  const kap = sonuc?.kapak?.teknik_kapsam || "";
  const bantlar = kapsamIfadeleri(kap).filter((x) => /^(NR|LC|L|U|G)\d/.test(x));
  for (const is of sonuc?.isler || []) {
    if (!["ILAVE", "MONTAJ"].includes(is.tur) || !/bant|band/i.test(`${is.ekipman} ${is.aciklama}`)) continue;
    for (const b of kapsamIfadeleri(is.bant || is.aciklama)) if (/^(NR|LC|L|U|G)\d/.test(b) && !bantlar.some((x) => bantSinifi(x) === bantSinifi(b))) bantlar.push(b);
  }
  return bantlar;
}

// Anten revizyonu kararı: belgedeki anten çözümü + dayanak (sayfa / alıntı)
function antenRevizyonu(sonuc) {
  const ilgili = (sonuc?.isler || []).filter((is) => is.anten_cozumu || /anten|antenna/i.test(is.ekipman || ""));
  const var_ = ilgili.find((is) => ["YENI", "DEGISIM"].includes(String(is.anten_cozumu).toUpperCase()) || isEtiketleri(is).includes("ANTEN_MONTAJ_SWAP"));
  if (var_) return { durum: "VAR", dayanak: { sayfa: var_.sayfa, alinti: var_.dayanak, bolum: var_.bolum } };
  const yok = ilgili.find((is) => String(is.anten_cozumu).toUpperCase() === "MEVCUT");
  if (yok) return { durum: "YOK", dayanak: { sayfa: yok.sayfa, alinti: yok.dayanak, bolum: yok.bolum } };
  return { durum: "BELIRSIZ", dayanak: null };
}

// ── Paket adayları (sürüme göre) ─────────────────────────────────────────────────────────────────────────────────
const AILE_2026 = {
  NR700: { ana: { VAR: "8812489289", YOK: "8812489291" }, ayni: { VAR: "8812489290", YOK: "8812489292" } },
  NR3500_AAU: { ana: { _: "8812489285" }, ayni: { _: "8812489286" } },
  NR3500_8T8R: { ana: { _: "8812489287" }, ayni: { _: "8812489288" } },
  LTE: { ana: { VAR: "8818274543", YOK: "8818274542" }, ayni: { _: "8818274283" } },
};
const AILE_2025 = {
  // 2025 BoQ'da NR700/NR3500 paketi YOK — co-located paketi (2025 SOW) değerlendirilir; 2026 paketleri buraya taşınmaz
  NR700: { ana: { VAR: "8818274543", YOK: "8818274542" }, ayni: { _: "8818274283" } },
  LTE: { ana: { VAR: "8818274543", YOK: "8818274542" }, ayni: { _: "8818274283" } },
};

function bantAilesi(bant, sonuc) {
  const b = bantSinifi(bant);
  if (b === "NR700") return "NR700";
  if (b === "NR3500") {
    const aau = (sonuc?.isler || []).some((is) => /\bAAU\b/i.test(`${is.ekipman} ${is.aciklama}`));
    const t8 = (sonuc?.isler || []).some((is) => /8T8R/i.test(`${is.ekipman} ${is.aciklama}`));
    return aau && !t8 ? "NR3500_AAU" : t8 && !aau ? "NR3500_8T8R" : "NR3500_?";
  }
  if (/^(L|U|G)\d/.test(b)) return "LTE";
  return null;
}

// Paket önerileri: { paketler:[{kod, aile, bant, rol, durum, neden, kosullar, alternatifler, ...}], notlar }
function paketSec(surum, sonuc) {
  const aileler = surum === "BOQ2026" ? AILE_2026 : surum === "BOQ2025" ? AILE_2025 : null;
  if (!aileler) return { paketler: [], notlar: ["BoQ sürümü seçilmemiş — paket değerlendirmesi yapılmadı."] };
  const bantlar = tssrBantlari(sonuc);
  const anten = antenRevizyonu(sonuc);
  const notlar = [];
  const kapsamMetni = sonuc?.kapak?.teknik_kapsam || "";
  const paketler = [];
  bantlar.forEach((bant, sira) => {
    let aile = bantAilesi(bant, sonuc);
    if (!aile) { notlar.push(`${bant}: bu bant için paket ailesi tanımlı değil — Kontrol gerekli.`); return; }
    if (aile === "NR3500_?") {
      paketler.push({ bant, aile: "NR3500", rol: sira === 0 ? "ANA" : "AYNI_ZIYARET", durum: "ALTERNATIF", kodlar: surum === "BOQ2026" ? ["8812489285", "8812489287"] : [],
        neden: `${bant}: AAU mı 8T8R anten işi mi olduğu TSSR'da doğrulanamadı — seçenekler gösteriliyor.` });
      return;
    }
    const tanim = aileler[aile];
    if (!tanim) { paketler.push({ bant, aile, rol: "ANA", durum: "YOK", kodlar: [], neden: `Seçili ${surum} BoQ'da ${bant} için paket bulunmuyor.` }); return; }
    // Rol: teknik kapsamdaki İLK paketlenebilir bant ana paket; aynı TSSR kapsamında birlikte yazılan sonrakiler "aynı ziyaret"
    const rol = paketler.some((p) => p.rol === "ANA") ? "AYNI_ZIYARET" : "ANA";
    const set = rol === "ANA" ? tanim.ana : tanim.ayni;
    let kodlar, durum, neden;
    if (set._) { kodlar = [set._]; durum = "ACIK"; }
    else if (anten.durum === "VAR" || anten.durum === "YOK") { kodlar = [set[anten.durum]]; durum = "ACIK"; }
    else { kodlar = [set.VAR, set.YOK]; durum = "ALTERNATIF"; }
    const antenMetni = anten.durum === "VAR" ? `anten revizyonu var (TSSR sayfa ${anten.dayanak?.sayfa || "?"})` : anten.durum === "YOK" ? `anten revizyonu yok — mevcut antenler kullanılıyor (TSSR sayfa ${anten.dayanak?.sayfa || "?"})` : "anten revizyonu belgede doğrulanamadı";
    neden = rol === "ANA"
      ? `TSSR teknik kapsamı ${kapsamMetni || bant}; ${bant} ana paket, ${antenMetni}.`
      : `${bant}, ana paket (${paketler.find((p) => p.rol === "ANA")?.bant}) ile aynı TSSR teknik kapsamında birlikte yazılmış (${kapsamMetni || "açıklama"}) — "aynı ziyaret" paketi adayı; birlikte ziyaret iş planında teyit edilmeli.`;
    paketler.push({ bant, aile, rol, durum, kodlar, neden, anten });
  });
  if (!bantlar.length) notlar.push("TSSR teknik kapsamında paketlenebilir bant/teknoloji bulunamadı — paket önerisi yapılmadı.");
  return { paketler, bantlar, anten, notlar };
}

module.exports = { KB, ETIKET, ETIKET_AD, kayitGetir, paketKapsami, sowSatiriEtiketle, isEtiketleri, katalogEtiketleri, tssrBantlari, antenRevizyonu, paketSec };
