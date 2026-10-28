// ═══ TAŞERON ÇÖZÜMLEME — Günlük İş Girişi ↔ Rollout (28.10.2026, Orhan) ══════════════════════════════════════════
// Kural: işi yapan taşeronun esas kaynağı Günlük İş Girişi'ndeki (master_works) ilgili iş kaleminin taşeron kaydıdır.
//  • Kalem, açıklamasından Rollout iş koluna (rf / trs / enh …) bağlanır; etiket / plaka / nakliye gibi yardımcı kalemler,
//    gizleme / GPS / as-built gibi Rollout'ta taşeron alanı olmayan işler taşeron belirlemez.
//  • Eşleşme TAM iş koduyla yapılır (BO2851_NR700_MWA ≠ BO2851_NR3500_MWA); fiziksel saha üzerinden taşınmaz.
//  • İş kolunda tek taşeron → tam adı (TEKNO_EMRAH). Birden fazla → seçim yapılmaz, "kontrol gerekli" + adaylar.
//    Kayıt yoksa Rollout'taki değer korunur (kaynak: Rollout).
//  • Üst firma grubu (TEKNO, TEKNOCENTER, AHY, ŞİMŞEK) taşeron adının yerine geçmez; grup yalnız filtre / kapsam içindir.
// Liste, Excel, saha başlığı ve eşitleme bu modülün TEK kuralını kullanır.
"use strict";

// Rollout iş kolları (ROLLOUT_IS_KOLU_ALANLARI ile aynı sıra)
const KOLLAR = ["rf", "los", "tss", "tssr", "btk", "trs", "enh", "enh_proje", "power", "emr", "pac", "ysb"];
// Taşeron belirlemeyen yardımcı kalemler
const YARDIMCI_RX = /label|etiket|plaka|plate|sticker|auxiliary|transport|nakliye|crane|vin[çc]|incentive|te[şs]vik|holiday|sunday|material supply|consumable/i;
// Açıklama → iş kolu (sıra önemli: özel → genel). Rollout'ta taşeron alanı olmayan kollar (gizleme, gps, asbuilt) ayrıca işaretlenir.
const KOL_DESEN = [
  ["asbuilt", /as[\s-]?built/i],
  ["gizleme", /camoufl|kamufl/i],
  ["gps", /\bgps\b/i],
  ["trs", /microwave|\bmw\b|site visit for mw|\bfsc\b/i],
  ["los", /\blos\b/i],
  ["ysb", /\bysb\b|yer se[çc]im|fenni mesul/i],
  ["enh_proje", /enh proje|energy project|elektrik projesi/i],
  ["enh", /energy line|lv power|power meter|admission for lv|power line|power supply and connection/i],
  ["tssr", /\btssr\b|site survey/i],
  ["btk", /\bbtk\b|tk certificate|tk permission/i],
  ["emr", /\bemr\b|\bemf\b/i],
  ["pac", /\bpac\b|acceptance/i],
  ["rf", /dbs\/bts system installation|new site installation|one band addition|installation|addition|moderni[sz]|swap|dismantl/i],
];
function kalemKolu(aciklama) {
  const d = String(aciklama || "");
  if (!d.trim() || YARDIMCI_RX.test(d)) return null;
  for (const [k, rx] of KOL_DESEN) if (rx.test(d)) return k;
  return null;
}

const adNorm = (v) => {
  const s = String(v ?? "").trim().toLocaleUpperCase("tr-TR").replace(/\s+/g, " ");
  return !s || s === "N/A" || s === "__NA__" || s === "-" ? null : s;
};
const katla = (v) => String(v || "").toLocaleUpperCase("tr-TR").replace(/İ/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G")
  .replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C").replace(/\s+/g, " ").trim();

// esleyiciler: server.js rolloutFirmaEsleyicileri() çıktısı [{ kod, esle(ad) }]
function grupOf(esleyiciler, ad) { return ad ? (esleyiciler.find((m) => m.esle(ad))?.kod || null) : null; }
// Yalın üst firma / grup adı mı (TEKNO, TEKNOCENTER, AHY, ŞİMŞEK, "ŞİMŞEK HABERLEŞME") — alt taşeron (TEKNO_EMRAH) değil
function grupAdiMi(esleyiciler, ad) { return !!ad && !/[_\-]/.test(ad) && !!grupOf(esleyiciler, ad); }

// Tek saha kodu için iş kolu çözümü. mwSatirlar: o kodun master_works satırları; rollout: rollout_progress satırı (ya da null)
function cozumle(mwSatirlar, rollout, esleyiciler) {
  const out = {};
  for (const kol of KOLLAR) {
    const kalemler = (mwSatirlar || []).filter((x) => kalemKolu(x.item_description) === kol && adNorm(x.subcon_name));
    const adlar = []; const gor = new Set();
    for (const x of kalemler) { const a = adNorm(x.subcon_name); if (!gor.has(katla(a))) { gor.add(katla(a)); adlar.push(a); } }
    const rv = adNorm(rollout?.[`${kol}_subcon`]);
    const kalemOzet = kalemler.map((x) => ({ id: x.id ?? null, item_code: x.item_code || null, aciklama: x.item_description, taseron: adNorm(x.subcon_name) }));
    if (!adlar.length) { if (rv) out[kol] = { durum: "GUNLUK_YOK", kaynak: "ROLLOUT", gorunen: rv, rollout: rv, adaylar: [], kalemler: [] }; continue; }
    if (adlar.length > 1) { out[kol] = { durum: "COKLU", kaynak: "COKLU", gorunen: rv, rollout: rv, adaylar: adlar, kalemler: kalemOzet }; continue; }
    const g = adlar[0];
    const durum = rv && katla(rv) === katla(g) ? "AYNI"
      : !rv ? "ROLLOUT_BOS"
      : grupAdiMi(esleyiciler, rv) && grupOf(esleyiciler, rv) === grupOf(esleyiciler, g) ? "GRUP_ADI"
      : "CELISKI";
    out[kol] = { durum, kaynak: "GUNLUK", gorunen: g, rollout: rv, adaylar: [g], kalemler: kalemOzet };
  }
  return out;
}

// master_works satırlarını iş koduna göre topla (TAM kod, UPPER/TRIM)
async function mwGetir(db, siteCodes) {
  const kodlar = siteCodes ? [...new Set(siteCodes.map((s) => String(s || "").replace(/\s+/g, "").toUpperCase()).filter(Boolean))] : null;
  if (kodlar && !kodlar.length) return new Map();
  const r = await db.query(`SELECT id, UPPER(TRIM(site_code)) AS sc, item_code, item_description, subcon_name FROM master_works
    WHERE COALESCE(TRIM(subcon_name),'') <> '' ${kodlar ? "AND UPPER(TRIM(site_code)) = ANY($1::text[])" : ""}`, kodlar ? [kodlar] : []);
  const m = new Map();
  for (const x of r.rows) (m.get(x.sc) || m.set(x.sc, []).get(x.sc)).push(x);
  return m;
}

// Okuma (liste / Excel): satırlara çözülmüş taşeron adı + _taseron_cozum. K (alt marka kapsamı) verilirse firmanın kendi
// iş kolu olmayan alan hiç değiştirilmez (başka firmanın iş kolu açılmaz, kapsam saklı satır değerinden gelir).
function uygula(rows, mwMap, esleyiciler, K = null, sahiplik = null) {
  return (rows || []).map((r) => {
    const sc = String(r.site_code || "").replace(/\s+/g, "").toUpperCase();
    const coz = cozumle(mwMap.get(sc) || [], r, esleyiciler);
    if (!Object.keys(coz).length) return r;
    const c = { ...r }; const meta = {};
    const sahip = K && sahiplik ? sahiplik(K, r) : null;
    for (const [kol, z] of Object.entries(coz)) {
      if (K && (sahip?.[kol] !== "BEN" || (z.gorunen && !K.esle(z.gorunen)))) continue;
      if (z.kaynak === "GUNLUK" && z.gorunen) c[`${kol}_subcon`] = z.gorunen;
      meta[kol] = { durum: z.durum, kaynak: z.kaynak, ...(z.durum === "COKLU" ? { adaylar: K ? z.adaylar.filter((a) => K.esle(a)) : z.adaylar } : {}),
        ...(z.rollout && z.rollout !== c[`${kol}_subcon`] ? { rollout: z.rollout } : {}) };
    }
    if (Object.keys(meta).length) c._taseron_cozum = meta;
    return c;
  });
}

module.exports = { KOLLAR, kalemKolu, cozumle, mwGetir, uygula, grupAdiMi, grupOf, adNorm, katla };
