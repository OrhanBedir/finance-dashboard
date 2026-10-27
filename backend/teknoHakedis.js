// ═══ TEKNO_2KX TAŞERON HAKEDİŞİ — REFERANS KARŞILAŞTIRMASI (27.10.2026, Orhan) ═════════════════════════════════
// 2KX, AHY döneminde "AHY_2KX" ekibi olarak AHY paket/kalem anlaşmasıyla (ahyTaseronBedel: Ağustos 2026 listesi) hakediş
// aldı; Teknocenter devrinden sonra aynı firma "TEKNO_2KX" etiketiyle çalışıyor. Bu modül TEKNO_2KX işlerini (yalnız bu
// etiket — ILIKE '%2KX%' ile 2KX HABERLEŞME / AHY_2KX / ŞİMŞEK_2KX kapsama ALINMAZ) kalem kalem:
//   Mevcut bedel      → marka hakediş katmanının bugün ürettiği (ahyTaseronBedel, TEKNO önekiyle)
//   Referans bedel    → AHY anlaşması kural tablosu (REFERANS_AHY): kalem bazlı mı / saha paketi mi, birim, KDV hariç TL
//   Hesaplanan bedel  → referans kuralın TEKNO_2KX işine uygulanması
// ile karşılaştırır. Huawei BoQ (müşteri fiyatı) ayrı tutulur; yeni BoQ seçildi diye taşeron fiyatı değişmez.
// Referansı olmayan kalemler "eksik eşleşme" olarak listelenir — tahmin ya da başka taşeronun (Şimşek–2KX seed tablosu,
// FERRUMX…) fiyatı UYGULANMAZ; Şimşek–2KX seed fiyatı yalnız BİLGİ sütunu olarak gösterilir.
// Geçmiş fatura/ödeme/mutabakat/QC kayıtlarına dokunulmaz; farklar ayrı önizleme + izlenebilir işlem olarak hazırlanır.

const TASERON = "TEKNO_2KX";
// AHY anlaşması (2026-08) — ahyTaseronBedel ile aynı kaynak; kod bazlı açık liste (kalem bazlı / saha paketi)
const REFERANS_AHY = [
  // Orhan (27.10.2026): "2KX'in taşeron fiyatları AHY'de zaten belliydi, bunlar paket fiyatlar; güncel fiyatları taşeronlara daha belirlemedik"
  { kod: "8818274543", kalip: /co-located site with antenna/i, ad: "Co-Located Site with Antenna Revision", tur: "PAKET", birim: "SITE", bedel: 26500 },
  { kod: "8818274542", kalip: /co-located site without antenna/i, ad: "Co-Located Site without Antenna Revision", tur: "PAKET", birim: "SITE", bedel: 22000 },
  { kod: "8812184609", kalip: /rru dismantling/i, ad: "RRU dismantling", tur: "KALEM", birim: "PCS", bedel: 400 },
  { kod: "8818286456", kalip: /dc cable dismantle/i, ad: "DC Cable Dismantle", tur: "KALEM", birim: "PCS", bedel: 1500 },
  { kod: "8818278108", kalip: /7[.,]2\s*m\s*lprt/i, ad: "Installation of 7,2m LPRT pole", tur: "KALEM", birim: "PCS", bedel: 8000 },
  { kod: "8818264135", kalip: /6\s*m\s*lprt/i, ad: "Installation service 6m LPRT Pole", tur: "KALEM", birim: "PCS", bedel: 7000 },
  { kod: "8818274283", kalip: /one band addition/i, ad: "One Band Addition at the same site visit", tur: "KALEM", birim: "PCS", bedel: 12000 },
  { kod: "88123MGE", kalip: /gps equipment/i, ad: "GPS equipment, antenna and feeder installation", tur: "KALEM", birim: "SET", bedel: 2500 },
];
// Standalone (NS) saha paketi: Antenna Installation ya da outdoor cabinet kalemi varsa; MW de yapıldıysa radyolu
const REFERANS_NS = { radyolu: 52000, radyosuz: 40000, tetik: [/antenna installation\s*,\s*per pcs/i, /outdoor cabinet family installation/i], radyo: /new microwave installation/i };
const KDV = "TL + KDV (bedeller KDV hariç)";

function siteTipi(site) {
  if (/NR700|TRP/.test(site)) return "CO_LOCATED";
  if (/(^|[_\-])NS([_\-]|$)|NS_MERKEZ/.test(site)) return "STANDALONE";
  return "DIGER";
}

/* karsilastir({ rows, mevcutHesap, seed })
   rows: master_works TEKNO_2KX satırları [{site, item, kalem, fq, qc_ok, po_price, po_cur}]
   mevcutHesap: ahyTaseronBedel(rows) çıktısı (mevcut katman) → {TEKNO_2KX:{bedel, detay[]}}
   seed: taseron_2kx_pricing satırları (bilgi sütunu) */
function karsilastir({ rows, mevcutHesap, seed = [], usdKur = 0 }) {
  const seedMap = {};
  for (const s of seed) if (String(s.rule_key || "").startsWith("PER_ITEM_")) seedMap[String(s.item_code).trim()] = Number(s.unit_price);
  const seedPaket = {}; for (const s of seed) seedPaket[s.rule_key] = Number(s.unit_price);
  const mevcutDetay = (mevcutHesap && mevcutHesap[TASERON] && mevcutHesap[TASERON].detay) || [];
  const mevcutBySite = {};
  mevcutDetay.forEach((d) => { (mevcutBySite[d.site] = mevcutBySite[d.site] || []).push(d); });

  const bySite = {};
  rows.forEach((r) => { (bySite[r.site] = bySite[r.site] || []).push(r); });
  const satirlar = [], eksik = [], sahaOzet = [];
  let topMevcut = 0, topHesap = 0, topHw = 0;
  for (const [site, items] of Object.entries(bySite).sort((a, b) => a[0].localeCompare(b[0]))) {
    const tip = siteTipi(site);
    const mevcutSite = (mevcutBySite[site] || []).reduce((s, d) => s + Number(d.tutar || 0), 0);
    let hesapSite = 0;
    const kullanilan = new Set();
    if (tip === "STANDALONE") {
      const paketVar = items.some((i) => Number(i.fq) > 0 && REFERANS_NS.tetik.some((rx) => rx.test(i.kalem)));
      if (paketVar) {
        const radyolu = items.some((i) => Number(i.fq) > 0 && REFERANS_NS.radyo.test(i.kalem));
        const bedel = radyolu ? REFERANS_NS.radyolu : REFERANS_NS.radyosuz;
        hesapSite += bedel;
        const mevcutPaket = (mevcutBySite[site] || []).find((d) => /paket/i.test(d.kalem));
        satirlar.push({ site, tip, item_code: "(paket)", kalem: radyolu ? "New Site Radyolu (saha paketi)" : "New Site Radyosuz (saha paketi)", adet: 1, birim: "SITE",
          hw_fiyat: null, mevcut: mevcutPaket ? Number(mevcutPaket.tutar) : 0, referans_birim: bedel, referans_tur: "PAKET", hesaplanan: bedel,
          fark: bedel - (mevcutPaket ? Number(mevcutPaket.tutar) : 0), gerekce: `AHY anlaşması: Standalone saha paketi (${radyolu ? "MW dahil 52.000" : "MW'siz 40.000"} ${KDV}); tetik: ${items.filter((i) => REFERANS_NS.tetik.some((rx) => rx.test(i.kalem))).map((i) => i.item).join(", ")}`, qc: items.every((i) => i.qc_ok) ? "OK" : "NOK" });
        items.forEach((i) => { if (REFERANS_NS.tetik.some((rx) => rx.test(i.kalem)) || REFERANS_NS.radyo.test(i.kalem) || /dbs\/bts system installation/i.test(i.kalem)) kullanilan.add(i.item); });
      }
    }
    for (const i of items) {
      if (kullanilan.has(i.item)) continue;
      const fq = Number(i.fq || 0);
      const hwTl = fq * Number(i.po_price || 0) * (String(i.po_cur || "TRY").toUpperCase() === "USD" ? usdKur : 1);
      topHw += hwTl;
      const ref = REFERANS_AHY.find((r) => r.kod === i.item) || REFERANS_AHY.find((r) => r.kalip.test(i.kalem));
      const nrm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const mevcutSatir = (mevcutBySite[site] || []).find((d) => ref && (nrm(d.kalem) === nrm(ref.ad) || nrm(ref.ad).startsWith(nrm(d.kalem)) || nrm(d.kalem).startsWith(nrm(ref.ad))));
      const mevcut = mevcutSatir ? Number(mevcutSatir.tutar) : 0;
      if (!ref) {
        if (fq > 0) eksik.push({ site, tip, item_code: i.item, kalem: i.kalem, adet: fq, qc: i.qc_ok ? "OK" : "NOK", hw_fiyat: Number(i.po_price || 0), hw_para: i.po_cur || "TRY",
          mevcut: 0, simsek_2kx_seed_bilgi: seedMap[i.item] ?? null,
          gerekce: tip === "STANDALONE" && /antenna installation|outdoor cabinet|dbs\/bts|new microwave/i.test(i.kalem)
            ? "Standalone paket tetiği yok (paket kalemi girilmemiş) — referans anlaşmada bu kalem tek başına fiyatlanmamış"
            : "AHY anlaşmasında bu kalem için bedel tanımlı değil — kaynak bedel olmadan hesaplanmadı (tahmin/başka taşeron fiyatı kullanılmadı)" });
        continue;
      }
      const hesap = fq * ref.bedel;
      hesapSite += hesap;
      satirlar.push({ site, tip, item_code: i.item, kalem: i.kalem, adet: fq, birim: ref.birim, hw_fiyat: Number(i.po_price || 0), hw_para: i.po_cur || "TRY",
        mevcut, referans_birim: ref.bedel, referans_tur: ref.tur, hesaplanan: hesap, fark: hesap - mevcut,
        gerekce: `AHY anlaşması ${ref.tur === "PAKET" ? "saha paketi" : "kalem bazlı"}: ${ref.ad} ${ref.bedel.toLocaleString("tr-TR")} ${KDV} × ${fq} ${ref.birim}${mevcutSatir ? "" : fq > 0 ? " — mevcut katmanda bu satır için bedel üretilmemiş" : " — fiziki miktar 0"}`,
        qc: i.qc_ok ? "OK" : "NOK", simsek_2kx_seed_bilgi: seedMap[i.item] ?? null });
    }
    topMevcut += mevcutSite; topHesap += hesapSite;
    sahaOzet.push({ site, tip, kalem_sayisi: items.length, mevcut: Math.round(mevcutSite), hesaplanan: Math.round(hesapSite), fark: Math.round(hesapSite - mevcutSite) });
  }
  const farkli = satirlar.filter((s) => Math.abs(s.fark) >= 1);
  // Geçmiş düzeltme önizlemesi: fark olan sahalar için taseron_hakedis (saha bazlı override) satır taslağı — uygulanmaz
  const duzeltme = sahaOzet.filter((s) => Math.abs(s.fark) >= 1).map((s) => ({ taseron_adi: TASERON, site_code: s.site, item_code: "", hakedis_bedeli: s.hesaplanan,
    item_description: `TEKNO_2KX referans düzeltmesi (AHY anlaşması) — önceki ${s.mevcut.toLocaleString("tr-TR")} → ${s.hesaplanan.toLocaleString("tr-TR")} TL`, mevcut: s.mevcut }));
  return { taseron: TASERON, kaynak: "AHY anlaşması (ahyTaseronBedel kural listesi, 2026-08) — kalem bazlı + Standalone saha paketi, TL, KDV hariç",
    kapsam_notu: "Yalnız subcon_name = 'TEKNO_2KX' satırları; '2KX HABERLEŞME…', 'AHY_2KX', 'ŞİMŞEK_2KX' kapsam dışı",
    usd_kur: usdKur, satirlar, eksik, saha_ozet: sahaOzet, farkli_satir: farkli.length,
    toplam: { mevcut: Math.round(topMevcut), hesaplanan: Math.round(topHesap), fark: Math.round(topHesap - topMevcut), hw_hakedis_tl: Math.round(topHw) },
    duzeltme_onizleme: duzeltme, referans: REFERANS_AHY.map(({ kalip, ...r }) => r), referans_ns: { radyolu: REFERANS_NS.radyolu, radyosuz: REFERANS_NS.radyosuz },
    seed_paket_bilgi: { "8818274542": seedPaket.PACKAGE_LTE5G_8818274542 ?? null, "8818274543": seedPaket.PACKAGE_LTE5G_8818274543 ?? null } };
}

module.exports = { TASERON, REFERANS_AHY, REFERANS_NS, karsilastir, siteTipi };
