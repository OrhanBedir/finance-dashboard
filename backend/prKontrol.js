// ═══ TSSR + BoQ AKILLI PR KONTROLÜ (27.10.2026, Orhan — Teknocenter) ═════════════════════════════════════════
// Girdi: yapay zekâ TSSR bulguları (tssrOkuma.js), seçilen BoQ sürümü kataloğu (boqKatalog.js), sahanın mevcut PR/PO
// kalemleri ve günlük iş girişleri. Çıktı: kaynağa bağlı öneriler (BoQ kodu + açıklama + birim + katalog fiyatı + gerekçe +
// TSSR dosyası/sayfa/alıntı + miktar belgede var mı + PR/PO'da var mı) ve yanlış/eksik talep uyarıları.
// Eşleme kuralları DETERMİNİSTİK ve açıklanabilirdir: iş türü + ekipman → katalog açıklamasında aranan kalıplar.
// Bant/teknoloji ifadesi tahminle başka koda çevrilmez: katalog açıklaması bir bant yazıyorsa TSSR'daki bantla aynı olmalı.
// Belirsiz durumda kesin "yanlış talep" denmez: "Kontrol gerekli" / "Olası kapsam uyuşmazlığı".
// TSSR'da bulunması faturalanabilirlik ya da müşteri onayı kanıtı değildir; "Talebe ekle" kullanıcı işlemidir.

const PK = require("./paketKapsam");
const SK = require("./sahaKimlik");
const isoGun = (v) => { if (!v) return null; if (typeof v === "string") return v.slice(0, 10); const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); };
const BANTLAR = ["NR700", "NR3500", "NR2100", "NR1800", "L700", "L800", "L900", "L1800", "L2100", "L2600", "U900", "U2100", "G900", "G1800", "2600", "3500", "700", "800", "900", "1800", "2100"];
const bantCikar = (s) => {
  // "LTE 900" / "LC900" (TT 2026 TSSR yazımı) → L900; "NR 700" → NR700
  const u = String(s || "").toUpperCase().replace(/\s+/g, "").replace(/LTE(?=\d)/g, "L").replace(/LC(?=\d)/g, "L");
  const b = new Set();
  for (const x of ["NR700", "NR3500", "NR2100", "NR1800", "L700", "L800", "L900", "L1800", "L2100", "L2600", "U900", "U2100", "G900", "G1800"]) if (u.includes(x)) b.add(x);
  return b;
};
const bantUyumu = (tssrBant, katalogMetin) => {
  const kb = bantCikar(katalogMetin);
  if (!kb.size) return "BANTSIZ";            // katalog kalemi bant yazmıyor → bant engeli yok
  const tb = bantCikar(tssrBant);
  if (!tb.size) return "TSSR_BANTSIZ";       // TSSR bant yazmıyor ama katalog bant yazıyor → belirsiz
  for (const x of tb) if (kb.has(x)) return "UYUMLU";
  return "FARKLI";
};

// İş türü + ekipman → katalog açıklama kalıpları (hepsi İngilizce BoQ metnine göre). `karsit`: aynı ekipmanın ters iş türü kalıbı.
const ESLEME = [
  { ekipman: /anten|antenna/i, tur: ["MONTAJ", "ILAVE"], kalip: [/antenna installation/i, /new antenna/i], karsit: [/antenna dismantl/i, /antenna (swap|replacement)/i] },
  { ekipman: /anten|antenna/i, tur: ["SOKUM"], kalip: [/antenna dismantl/i], karsit: [/antenna installation/i] },
  { ekipman: /anten|antenna/i, tur: ["DEGISIM"], kalip: [/antenna (swap|replacement|revision)/i, /with antenna revision/i], karsit: [/antenna installation\s*,/i, /antenna dismantl/i] },
  { ekipman: /anten|antenna/i, tur: ["TASIMA"], kalip: [/antenna relocation/i] },
  { ekipman: /\bRRU\b|\bRFU\b/i, tur: ["MONTAJ", "ILAVE"], kalip: [/additional rru|rru\/rfu installation|rru installation/i], karsit: [/rru dismantl/i] },
  { ekipman: /\bRRU\b|\bRFU\b/i, tur: ["SOKUM"], kalip: [/rru dismantl/i], karsit: [/rru.*installation/i] },
  { ekipman: /\bRRU\b/i, tur: ["TASIMA"], kalip: [/rru relocation/i] },
  { ekipman: /\bAAU\b/i, tur: ["MONTAJ", "ILAVE"], kalip: [/aau installation|with aau/i], karsit: [/aau dismantl/i] },
  { ekipman: /\bAAU\b/i, tur: ["SOKUM"], kalip: [/aau dismantl/i] },
  { ekipman: /\bBBU\b/i, tur: ["SOKUM"], kalip: [/bbu removal|bbu dismantl/i] },
  // 28.10.2026 (KA3737): BBU3900 → BBU5900 değişimi — BBU Modernization öncelikli; alternatif BBU installation + BBU Removal
  { ekipman: /\bBBU\b/i, tur: ["DEGISIM"], kalip: [/bbu modernization/i, /bbu instal+ation/i, /bbu removal/i], oncelik: /bbu modernization/i },
  { ekipman: /\bBBU\b|DBS|BTS/i, tur: ["MONTAJ"], kalip: [/dbs\/bts system installation|bbu installation/i] },
  { ekipman: /\bMW\b|microwave|mikrodalga/i, tur: ["MONTAJ", "ILAVE"], kalip: [/new microwave installation/i], karsit: [/microwave dismantl|mw dismantl/i] },
  { ekipman: /\bMW\b|microwave|mikrodalga/i, tur: ["DEGISIM"], kalip: [/mw swap|microwave swap|microwave replacement/i] },
  { ekipman: /\bMW\b|microwave|mikrodalga/i, tur: ["SOKUM"], kalip: [/microwave dismantl|mw dismantl/i] },
  { ekipman: /\bMW\b|microwave|mikrodalga/i, tur: ["TASIMA"], kalip: [/mw antenna relocation/i] },
  { ekipman: /vin[cç]|crane/i, tur: ["MONTAJ", "DIGER", "ILAVE", "DEGISIM", "SOKUM"], kalip: [/^(standard )?crane usage/i] },
  { ekipman: /topraklama|grounding/i, tur: ["MONTAJ", "ILAVE", "REVIZYON"], kalip: [/system grounding|grounding installation|grounding system/i] },
  { ekipman: /lprt/i, tur: ["MONTAJ", "ILAVE", "REVIZYON"], kalip: [/lprt pole/i], yukseklik: true },
  { ekipman: /pole|direk/i, tur: ["MONTAJ", "ILAVE", "REVIZYON"], kalip: [/lprt pole/i, /pole[- ]offset/i], yukseklik: true, lprtDegil: true },
  { ekipman: /offset|ofset/i, tur: ["MONTAJ", "ILAVE", "REVIZYON"], kalip: [/offset/i] },
  { ekipman: /kabinet|cabinet/i, tur: ["MONTAJ", "ILAVE"], kalip: [/outdoor cabinet.*installation/i], karsit: [/cabinet dismantl/i] },
  { ekipman: /kabinet|cabinet/i, tur: ["SOKUM"], kalip: [/cabinet dismantl/i] },
  { ekipman: /gizleme|camouflage|kamuflaj|baca|chimney/i, tur: ["MONTAJ", "ILAVE"], kalip: [/camouflage/i], karsit: [/camouflage dismantl/i], yukseklik: true },
  { ekipman: /gizleme|camouflage|kamuflaj/i, tur: ["SOKUM"], kalip: [/camouflage dismantl/i] },
  { ekipman: /kablo|cable|feeder|fiber/i, tur: ["SOKUM"], kalip: [/cable dismantl/i] },
  { ekipman: /kablo|cable|feeder/i, tur: ["MONTAJ", "ILAVE"], kalip: [/cable installation|feeder cable|supply of all type/i] },
  { ekipman: /çatı|cati|roof exit|roof/i, tur: ["MONTAJ", "ILAVE", "REVIZYON"], kalip: [/roof exit|roof (hatch|cover)/i] },
  { ekipman: /rack|raf|sehpa/i, tur: ["SOKUM"], kalip: [/rack dismantl|rack demont/i] },
  { ekipman: /rack|raf|sehpa/i, tur: ["MONTAJ", "ILAVE"], kalip: [/rack installation|standing rack/i] },
  { ekipman: /band|bant|one band|single band|dual band|triple band|modernization|modernizasyon/i, tur: ["ILAVE", "MONTAJ"], kalip: [/band addition/i] },
  // "swap" tek başına bant modernizasyonu değildir (anten swap'ı RRU/BBU Modernization'a eşlenmesin — ES0288 testi)
  { ekipman: /modernization|modernizasyon|band swap|bant de[ğg]i[şs]imi/i, tur: ["DEGISIM"], kalip: [/band modernization/i, /band swap/i] },
  { ekipman: /survey|keşif|kesif/i, tur: ["DIGER"], kalip: [/site survey/i] },
  { ekipman: /jumper/i, tur: ["MONTAJ", "ILAVE"], kalip: [/jumper/i] },
  { ekipman: /cold\s*shrink/i, tur: ["MONTAJ", "ILAVE"], kalip: [/cold shrink/i] },
  { ekipman: /gps/i, tur: ["MONTAJ", "ILAVE"], kalip: [/gps equipment/i] },
  { ekipman: /climber|tırman/i, tur: ["DIGER", "MONTAJ"], kalip: [/climber/i] },
];
const TUR_TR = { MONTAJ: "montaj", SOKUM: "söküm", DEGISIM: "değişim", ILAVE: "ilave", TASIMA: "taşıma", REVIZYON: "revizyon", DIGER: "iş" };

// Yükseklik/ölçü eşlemesi: TSSR işinde "7,2 m" varsa katalogda aynı sayı aranır
const sayilar = (s) => (String(s || "").replace(/,/g, ".").match(/\d+(?:\.\d+)?/g) || []).map(Number);

// Anten çözümü: model alanı (anten_cozumu) ya da belge ifadesi. MEVCUT → yeni anten montajı / "with antenna revision" kalemleri önerilmez,
// "without antenna revision" tercih edilir (28.10.2026, Orhan — KA3737: mevcut antenlere NR700 + LC900 ilavesi).
function antenCozumu(is) {
  const a = String(is.anten_cozumu || "").toUpperCase();
  if (["MEVCUT", "YENI", "DEGISIM", "YOK"].includes(a)) return a;
  const t = `${is.aciklama} ${is.dayanak}`;
  if (/yeni\s+(\S+\s+){0,2}anten|new\s+antenna/i.test(t)) return "YENI";
  if (/mevcut\s+(sekt[öo]r\s+)?anten|existing\s+antenna|mevcut\s+anten/i.test(t)) return "MEVCUT";
  return "";
}

function kalemBul(katalog, is) {
  const metin = `${is.ekipman} ${is.aciklama}`;
  const anten = antenCozumu(is);
  // Önce ekipman alanına uyan kurallar; yoksa açıklama da taranır (KA3737: "İnce-ince jumper, RRU başına 4" → jumper, RRU kurulumu değil)
  const uygun = (hedef) => ESLEME.filter((k) => k.ekipman.test(hedef) && k.tur.includes(is.tur) && !(k.lprtDegil && /lprt/i.test(metin))
    // mevcut anten kullanılıyorsa "anten montajı" kuralı (açıklamada "antenlere" geçse bile) uygulanmaz
    && !(anten === "MEVCUT" && k.kalip.some((rx) => String(rx) === String(/antenna installation/i))));
  const ekipmanKurallari = String(is.ekipman || "").trim() ? uygun(String(is.ekipman)) : [];
  const kurallar = ekipmanKurallari.length ? ekipmanKurallari : uygun(metin);
  if (!kurallar.length) return { durum: "KURAL_YOK", adaylar: [] };
  const adaylar = [];
  const bantNot = [];
  for (const kural of kurallar) {
    for (const k of katalog) {
      const d = String(k.aciklama_en || "");
      if (!kural.kalip.some((rx) => rx.test(d))) continue;
      const bant = bantUyumu(is.bant || is.teknoloji, d);
      if (bant === "FARKLI") { bantNot.push(k.kod); continue; } // bant uyuşmuyor → aday değil (tahminle çevrilmez)
      let puan = 1;
      if (kural.yukseklik) {
        // TSSR'da yükseklik/ölçü yazıyorsa aday kalemde aynı sayı olmalı (7,2 m → yalnız 7,2m; 6m/8m ya da ölçüsüz offset değil)
        const ts = sayilar(is.aciklama + " " + is.dayanak), ks = sayilar(d);
        if (ts.length) { if (ks.length && ts.some((x) => ks.includes(x))) puan += 2; else continue; }
      }
      if (bant === "UYUMLU") puan += 2;
      if (bant === "TSSR_BANTSIZ") puan -= 0.5;
      if (anten === "MEVCUT" && /\bwith antenna revision/i.test(d)) continue;           // mevcut anten → revizyonlu paket değil
      if (anten === "MEVCUT" && /without antenna revision/i.test(d)) puan += 2;
      if ((anten === "YENI" || anten === "DEGISIM") && /\bwith antenna revision/i.test(d)) puan += 2;
      if (kural.oncelik && kural.oncelik.test(d)) puan += 1;
      if (/band addition/i.test(d) && !/same site visit/i.test(d)) puan += 0.5;         // ana paket; "aynı ziyaret" varyantı alternatif kalır
      adaylar.push({ ...k, puan, bant_durumu: bant, kural: kural.kalip.map(String).join(" | ") });
    }
  }
  // Aynı kodu bir kez tut (en yüksek puan)
  const tek = {}; adaylar.forEach((a) => { if (!tek[a.kod] || tek[a.kod].puan < a.puan) tek[a.kod] = a; });
  const liste = Object.values(tek).sort((a, b) => b.puan - a.puan);
  if (!liste.length) return { durum: bantNot.length ? "BANT_UYUSMAZ" : "ESLESME_YOK", adaylar: [], bant_disi: bantNot.slice(0, 5) };
  const enIyi = liste[0];
  const esitler = liste.filter((a) => a.puan === enIyi.puan);
  return { durum: esitler.length === 1 && liste.length <= 3 ? "ACIK" : "ALTERNATIF", adaylar: liste.slice(0, 5) };
}

// PR satırının açıklamasına göre "ters iş" kontrolü (montaj yerine söküm vb.)
function karsitKalipVarMi(is, prAciklama) {
  const metin = `${is.ekipman} ${is.aciklama}`;
  for (const k of ESLEME) {
    if (!k.ekipman.test(metin) || !k.tur.includes(is.tur) || !k.karsit) continue;
    if (k.karsit.some((rx) => rx.test(prAciklama))) return k;
  }
  return null;
}

/* ═══ PAKET ÖNCELİKLİ DEĞERLENDİRME (28.10.2026) ═══════════════════════════════════════════════════════════════
   1) TSSR teknik kapsamındaki bantlardan seçili BoQ sürümünün paket ailesi seçilir (paketKapsam.paketSec).
   2) Her TSSR işi etiketlenir; seçilen paket(ler)in SOW'unda dahilse "PAKETE_DAHIL" (SOW satır + hücre dayanağı),
      SOW'da açıkça hariçse "EK_TALEP" (ayrı kalem önerilebilir), SOW'da hiç geçmiyorsa "EK_ADAY" (kapsam dayanağı yok →
      Kontrol gerekli; aday kalem yalnız bilgi). Bant ilavesinin kendisi "PAKET" satırıdır.
   3) Fiyat yalnız katalogdan; katalog boşsa "Katalog kullanıma hazır değil; paket eşleştirmesi tamamlanamadı."
   Paketin SITE birimi ekipman adediyle çarpılmaz (3 RRU ≠ 3 paket). */
const KATALOG_YOK_MESAJ = "Katalog kullanıma hazır değil; paket eşleştirmesi tamamlanamadı.";
function paketDegerlendir({ surum, S, katMap, katalogHazir, prMap, poMap, guncel }) {
  const sec = PK.paketSec(surum, S);
  const kapsamGetir = (kod) => PK.paketKapsami(surum, kod);
  const paketler = sec.paketler.map((p) => {
    const secenekler = (p.kodlar || []).map((kod) => {
      const kap = kapsamGetir(kod), kat = katMap[kod];
      return { kod, baslik: kap?.baslik_en || kat?.aciklama_en || "", baslik_tr: kap?.baslik_tr || "", birim: kat?.birim || kap?.birim || "",
        birim_fiyat: kat && kat.birim_fiyat !== null && kat.birim_fiyat !== undefined ? Number(kat.birim_fiyat) : null, para_birimi: kat?.para_birimi || "", bolge: kat?.bolge || "",
        katalog_kaynak: kat ? `${kat.kaynak_dosya || ""} · ${kat.kaynak_sayfa || ""} · ${kat.kaynak_satir || ""}` : "", katalogda: !!kat,
        sow_kaynak: kap?.kaynak || null, sow_var: !!kap, anten_revizyonu: kap ? kap.anten_revizyonu : null, ayni_ziyaret: kap ? kap.ayni_ziyaret : null,
        rru_araligi: kap?.rru_araligi || null, anten_araligi: kap?.anten_araligi || null, rru_sokum_ust: kap?.rru_sokum_ust || null,
        pr_var: !!prMap[kod], pr_qty: prMap[kod] ? Number(prMap[kod].pr_qty ?? 0) : null, po_var: !!poMap[kod], po_no: poMap[kod]?.po_no || "" };
    });
    let durum = p.durum, mesaj = "";
    if (secenekler.length && !katalogHazir) { durum = "KATALOG_YOK"; mesaj = KATALOG_YOK_MESAJ; }
    else if (secenekler.length && secenekler.every((x) => !x.katalogda)) { durum = "KATALOGDA_YOK"; mesaj = `Paket kodu seçili ${surum} kataloğunda fiyatlı bulunamadı — fiyat doğrulanamadı.`; }
    const antenD = p.anten?.dayanak;
    return { ...p, durum, mesaj, secenekler,
      tssr_dayanak: { dosya: guncel.dosya_adi, url: guncel.belge_url, kapak_sayfa: S.kapak?.sayfa || 1, teknik_kapsam: S.kapak?.teknik_kapsam || "", anten_sayfa: antenD?.sayfa || null, anten_alinti: antenD?.alinti || "" } };
  });
  const kullanilan = paketler.filter((p) => ["ACIK", "ALTERNATIF", "KATALOG_YOK", "KATALOGDA_YOK"].includes(p.durum) && p.secenekler.length);
  // Etiket bir pakette dahil mi? ALTERNATIF pakette tüm seçeneklerde dahilse dahil sayılır
  const dahilBul = (et) => {
    for (const p of kullanilan) {
      const kaps = p.secenekler.map((x) => kapsamGetir(x.kod)).filter(Boolean);
      if (kaps.length && kaps.every((k) => k.dahil[et])) return { paket_kod: p.secenekler[0].kod, paket_bant: p.bant, sow: kaps[0].dahil[et][0], kaynak: kaps[0].kaynak, alternatifli: kaps.length > 1 };
    }
    return null;
  };
  const haricBul = (et) => {
    for (const p of kullanilan) for (const x of p.secenekler) { const k = kapsamGetir(x.kod); if (k && k.haric[et]) return { paket_kod: x.kod, sow: k.haric[et][0], kaynak: k.kaynak }; }
    return null;
  };
  const sektor = S.sektor_sayisi || {};
  const isler = (S.isler || []).map((is, i) => {
    const et = PK.isEtiketleri(is);
    const base = { sira: i + 1, tur: is.tur, ekipman: is.ekipman, aciklama: is.aciklama, bant: is.bant, miktar: is.miktar, miktar_ham: is.miktar_ham, birim: is.birim, etiketler: et,
      etiket_adlari: et.map((x) => PK.ETIKET_AD[x] || x), tssr_dayanak: { dosya: guncel.dosya_adi, url: guncel.belge_url, sayfa: is.sayfa, bolum: is.bolum, alinti: is.dayanak } };
    // Sektör başına miktar → toplam (sektör sayısı belgede doğrulanmışsa; hesap ve iki kaynak gösterilir)
    if (is.sektor_basina && is.miktar !== null) {
      base.miktar_hesabi = sektor.deger
        ? { sektor_basina: is.miktar, sektor_sayisi: sektor.deger, toplam: is.miktar * sektor.deger, kaynak_1: `sayfa ${is.sayfa || "?"}: ${is.dayanak}`, kaynak_2: `sayfa ${sektor.sayfa || "?"}: ${sektor.dayanak}` }
        : { sektor_basina: is.miktar, sektor_sayisi: null, toplam: null, not: "Sektör sayısı belgede doğrulanamadı — toplam hesaplanmadı" };
    }
    if (et.includes("BANT_ILAVESI")) {
      const p = paketler.find((x) => SK.kapsamIfadeleri(is.bant || is.aciklama).some((b) => SK.bantSinifi(b) === SK.bantSinifi(x.bant)));
      return { ...base, durum: "PAKET", paket_bant: p?.bant || "", paket_kodlari: p ? p.secenekler.map((x) => x.kod) : [], neden: p ? "Bu iş paketin kendisidir (bant ilavesi)" : "Bant ilavesi için paket ailesi bulunamadı — Kontrol gerekli" };
    }
    if (!et.length) return { ...base, durum: "KONTROL", neden: "İş türü/ekipman paket kapsamıyla karşılaştırılamadı — Kontrol gerekli" };
    const dahil = et.map(dahilBul), haric = et.map(haricBul);
    if (kullanilan.length && dahil.every(Boolean)) {
      const r = { ...base, durum: "PAKETE_DAHIL", paket_kod: dahil[0].paket_kod, sow_dayanaklari: et.map((e, j) => ({ etiket: PK.ETIKET_AD[e] || e, no: dahil[j].sow.no, metin: dahil[j].sow.metin, hucre: dahil[j].kaynak?.sow_hucre, sayfa: dahil[j].kaynak?.sayfa, dosya: dahil[j].kaynak?.dosya, paket_kod: dahil[j].paket_kod })),
        neden: `Seçili paket SOW'unda geçiyor — ayrıca talep edilmez.` };
      // Adet aralığı: paket "1-4 pcs RRU" kapsar; TSSR'da daha fazlası yazıyorsa kontrol
      if (et.includes("RRU_MONTAJ")) {
        const kap = kapsamGetir(dahil[et.indexOf("RRU_MONTAJ")].paket_kod);
        const adet = r.miktar_hesabi?.toplam ?? is.miktar;
        if (kap?.rru_araligi && adet !== null && adet > kap.rru_araligi.max) { r.durum = "KONTROL"; r.neden = `Paket ${kap.rru_araligi.min}-${kap.rru_araligi.max} RRU kurulumunu kapsıyor; TSSR'da ${adet} RRU yazıyor — fazlası için kapsam kontrol edilmeli.`; }
      }
      return r;
    }
    const hrc = haric.find(Boolean);
    if (hrc) return { ...base, durum: "EK_TALEP", neden: `Paket SOW'u bu işi açıkça hariç tutuyor (${hrc.paket_kod} · ${hrc.kaynak?.sayfa} ${hrc.kaynak?.sow_hucre} satır ${hrc.sow.no}: "${hrc.sow.metin}") — ayrı kalem talep edilebilir.`, sow_haric: { ...hrc.sow, hucre: hrc.kaynak?.sow_hucre, paket_kod: hrc.paket_kod } };
    if (kullanilan.length && dahil.some(Boolean)) return { ...base, durum: "KONTROL", neden: `İşin bir kısmı paket SOW'unda geçiyor (${et.filter((e, j) => dahil[j]).map((e) => PK.ETIKET_AD[e] || e).join(", ")}), bir kısmı geçmiyor (${et.filter((e, j) => !dahil[j]).map((e) => PK.ETIKET_AD[e] || e).join(", ")}) — Kontrol gerekli.` };
    return { ...base, durum: kullanilan.length ? "EK_ADAY" : "PAKETSIZ", neden: kullanilan.length ? "Seçili paket SOW'unda bu iş geçmiyor; ayrı kalem için kapsam dayanağı doğrulanmadı — Kontrol gerekli." : "" };
  });
  return { paketler, isler, bantlar: sec.bantlar || [], anten: sec.anten || null, notlar: sec.notlar || [], katalog_hazir: katalogHazir };
}

/* kontrol({ site, tssr, katalog, surum, surumOneri, prRows, poRows, kararlar })
   tssr: tssrOkuma.sahaTssrAnaliz çıktısı; katalog: boq_katalog satırları (seçilen sürüm, bölge)
   prRows: [{item_code, item_description, pr_qty, done_qty, boq_surum, created_at}] ; poRows: [{item_code, requested_qty, po_no}]
   kararlar: [{anahtar, karar, gerekce, kullanici, zaman}] (dikkate alınmayanlar) */
function kontrol({ site, tssr, katalog, surum, surumOneri, prRows = [], poRows = [], kararlar = [], katalogHazir = null }) {
  if (katalogHazir === null) katalogHazir = Array.isArray(katalog) && katalog.length > 0;
  const oneriler = [], uyarilar = [];
  const prMap = {}; prRows.forEach((r) => { prMap[String(r.item_code).trim()] = r; });
  const poMap = {}; poRows.forEach((r) => { poMap[String(r.item_code).trim()] = r; });
  const katMap = {}; (katalog || []).forEach((k) => { katMap[k.kod] = katMap[k.kod] || k; });
  const kararMap = {}; (kararlar || []).forEach((k) => { kararMap[k.anahtar] = k; });
  const guncel = tssr && tssr.guncel ? tssr.guncel : null;
  const sonuc = { site, surum, tssr_durumu: tssr ? (tssr.tamamlandi ? "TAMAM" : "TAMAMLANAMADI") : "YOK", tssr_hata: tssr?.hata || "", tssr_belge: null, oneriler, uyarilar, kapsam_disi: [] };

  // 1) Yanlış BoQ sürümü (PR satırı seçilen/önerilen sürümden farklı sürümle kaydedilmiş)
  if (surumOneri && surumOneri.surum) {
    for (const r of prRows) {
      if (r.boq_surum && r.boq_surum !== surumOneri.surum) {
        uyarilar.push({ tip: "SURUM", seviye: "KONTROL", anahtar: `surum|${r.item_code}`, item_code: r.item_code, item_description: r.item_description || "",
          mesaj: `${r.item_code} kalemi ${r.boq_surum} sürümüyle kaydedilmiş; malzeme geliş tarihine göre önerilen sürüm ${surumOneri.surum}. Seçim gerekçesi: ${r.boq_secim_gerekce || "yazılmamış"}.`,
          dayanak: surumOneri.gerekce });
      }
    }
  } else if (surumOneri && surumOneri.durum !== "OK") {
    uyarilar.push({ tip: "SURUM", seviye: "KONTROL", anahtar: "surum|tarih", item_code: "", mesaj: "Malzeme geliş tarihi doğrulanamadı; BoQ seçimini kontrol edin.", dayanak: surumOneri.gerekce || "" });
  }

  if (!guncel) {
    if (tssr && tssr.belge_sayisi) sonuc.tssr_mesaj = "TSSR kontrolü tamamlanamadı — belge okunamadı; PR kalemleri TSSR ile karşılaştırılmadı.";
    else sonuc.tssr_mesaj = "Sahada TSSR belgesi yok — TSSR karşılaştırması yapılmadı.";
    return sonuc;
  }
  const S = guncel.sonuc;
  const kapak = S.kapak || {};
  sonuc.tssr_belge = { dosya: guncel.dosya_adi, url: guncel.belge_url, tarih: kapak.hazirlama_tarihi || S.belge_tarihi, revizyon: kapak.belge_surumu || S.revizyon, site_id: kapak.site_id || S.site_id, proje: S.proje,
    saha_adi: kapak.saha_adi || "", teknik_kapsam: kapak.teknik_kapsam || "", belge_surumu: kapak.belge_surumu || "", survey_tarihi: kapak.survey_tarihi || null, hazirlayan_firma: kapak.hazirlayan_firma || "",
    kapak_sayfa: kapak.sayfa || null, sayfa_sayisi: S.sayfa_sayisi, eksik_sayfalar: S.eksik_sayfalar, revizyon_sayisi: tssr.revizyon_sayisi, is_sayisi: S.isler.length, model: S.model, kaynak: guncel.kaynak,
    konum: S.konum || null, sektor_sayisi: S.sektor_sayisi || null, mevcut_ekipman: S.mevcut_ekipman || [] };
  // Fiziksel saha eşlemesi (sahaKimlik): TSSR "KA3737" ↔ iş kaydı "KA3737_NR700_MWA" aynı saha; KA3737 ≠ KA37370.
  // Yalnız tam metin farkı uyarı sebebi değildir; gerçek uyumsuzlukta uyarı, iş kapsamı farkında ayrı kontrol notu.
  const tssrSite = kapak.site_id || S.site_id;
  const esl = tssrSite ? SK.ayniFizikselSaha(tssrSite, site) : { ayni: null, neden: "TSSR'da Site ID okunamadı" };
  const kapUyum = SK.isKapsamUyumu(site, kapak.teknik_kapsam || S.proje || "");
  sonuc.saha_eslesme = { fiziksel_id: SK.fizikselSaha(site)?.fiziksel_id || null, tssr_site_id: tssrSite || "", is_kodu: site, durum: esl.ayni === true ? "AYNI" : esl.ayni === false ? "FARKLI" : "BELIRSIZ", neden: esl.neden, kapsam_uyumu: kapUyum };
  if (esl.ayni === false) uyarilar.push({ tip: "SAHA", seviye: "KONTROL", anahtar: "tssr|saha", item_code: "",
    mesaj: `TSSR başka bir fiziksel sahaya ait görünüyor: belgede ${tssrSite}, seçili iş kaydı ${site} (${esl.neden}). Doğru belge mi kontrol edin.`, dayanak: `${guncel.dosya_adi} sayfa ${kapak.sayfa || 1}` });
  else if (esl.ayni === null && tssrSite) uyarilar.push({ tip: "SAHA", seviye: "KONTROL", anahtar: "tssr|saha", item_code: "",
    mesaj: `TSSR saha kimliği doğrulanamadı (${esl.neden}).`, dayanak: `${guncel.dosya_adi} sayfa ${kapak.sayfa || 1}` });
  if (esl.ayni === true && kapUyum.durum === "FARKLI") uyarilar.push({ tip: "KAPSAM", seviye: "KONTROL", anahtar: "tssr|is_kapsami", item_code: "",
    mesaj: `Aynı fiziksel saha (${sonuc.saha_eslesme.fiziksel_id}), ama TSSR teknik kapsamı (${kapak.teknik_kapsam}) seçili iş kaydının kapsamıyla (${kapUyum.is.join(", ")}) örtüşmüyor — bu TSSR aynı sahadaki başka bir iş kaydına ait olabilir.`, dayanak: `${guncel.dosya_adi} sayfa ${kapak.sayfa || 1}` });
  if (S.eksik_sayfalar && S.eksik_sayfalar.length) uyarilar.push({ tip: "TSSR", seviye: "KONTROL", anahtar: "tssr|eksik_sayfa", item_code: "",
    mesaj: `TSSR'ın ${S.eksik_sayfalar.join(", ")}. sayfaları okunamadı — bulgular eksik olabilir.`, dayanak: guncel.dosya_adi });
  // 2) TSSR revizyonu, PR'ın dayandığından yeni
  const tssrTarih = S.belge_tarihi || null;
  if (tssrTarih) {
    const eskiPr = prRows.filter((r) => r.boq_secim_zaman || r.created_at).filter((r) => (isoGun(r.boq_secim_zaman || r.created_at) || "9999") < tssrTarih);
    if (eskiPr.length && (tssr.revizyon_sayisi || 0) > 1) uyarilar.push({ tip: "REVIZYON", seviye: "KONTROL", anahtar: "tssr|revizyon", item_code: "",
      mesaj: `Güncel TSSR (${S.belge_tarihi}${S.revizyon ? " · " + S.revizyon : ""}) ${eskiPr.length} PR kaleminin girildiği tarihten yeni — PR'ı güncel revizyona göre kontrol edin.`, dayanak: guncel.dosya_adi });
  }

  // 3) Paket öncelikli değerlendirme, ardından paket dışındaki işler için kalem karşılığı
  const paket = paketDegerlendir({ surum, S, katMap, katalogHazir, prMap, poMap, guncel });
  sonuc.paket = paket;
  const prEslesen = new Set();
  const eslesmeler = S.isler.map((is) => kalemBul(katalog || [], is));
  S.isler.forEach((is, i) => {
    const anahtar = `is|${i + 1}|${is.tur}|${(is.ekipman || "").slice(0, 20)}`;
    const dayanak = { dosya: guncel.dosya_adi, url: guncel.belge_url, sayfa: is.sayfa, bolum: is.bolum, alinti: is.dayanak };
    const pd = paket.isler[i] || {};
    // Pakete dahil iş ya da bant ilavesinin kendisi → ayrı kalem önerilmez (paketin içindeki iş tekrar talep ettirilmez)
    const paketKapsami = ["PAKETE_DAHIL", "PAKET"].includes(pd.durum);
    const kanitsizEk = pd.durum === "EK_ADAY"; // SOW'da geçmiyor ama kapsam dayanağı da yok → yalnız kontrol
    const es = paketKapsami ? { durum: pd.durum, adaylar: [] } : eslesmeler[i];
    const karar = kararMap[anahtar] || null;
    const o = { anahtar, is: { sira: i + 1, tur: is.tur, tur_tr: TUR_TR[is.tur] || is.tur, aciklama: is.aciklama, teknoloji: is.teknoloji, bant: is.bant, ekipman: is.ekipman,
        miktar: is.miktar, miktar_ham: is.miktar_ham, birim: is.birim, anten_cozumu: antenCozumu(is) }, dayanak, miktar_belgede: is.miktar !== null, durum: es.durum, adaylar: [], karar };
    o.paket_durumu = pd.durum || null;
    if (pd.durum === "PAKETE_DAHIL") o.paket_notu = `Pakete dahil: ${pd.paket_kod} SOW ${pd.sow_dayanaklari?.[0]?.hucre || ""} satır ${pd.sow_dayanaklari?.[0]?.no || "?"} — "${pd.sow_dayanaklari?.[0]?.metin || ""}". Ayrıca talep edilmez.`;
    if (pd.durum === "PAKET") o.paket_notu = `Bu iş paketin kendisidir (${(pd.paket_kodlari || []).join(" / ") || "paket bulunamadı"}).`;
    if (kanitsizEk) o.paket_notu = "Seçili paket SOW'unda bu iş geçmiyor; ayrı kalem için kapsam dayanağı doğrulanmadı — aday kalemler yalnız bilgi amaçlıdır (Kontrol gerekli).";
    if (pd.durum === "EK_TALEP") o.paket_notu = pd.neden;
    if (pd.miktar_hesabi) o.miktar_hesabi = pd.miktar_hesabi;
    if (es.durum === "ACIK" || es.durum === "ALTERNATIF") {
      o.adaylar = es.adaylar.map((a, j) => {
        const pr = prMap[a.kod], po = poMap[a.kod];
        if (pr) prEslesen.add(a.kod);
        return { boq_kod: a.kod, aciklama: a.aciklama_en, aciklama_tr: a.aciklama_tr, birim: a.birim, para_birimi: a.para_birimi, birim_fiyat: a.birim_fiyat, bolge: a.bolge, surum: a.surum,
          kaynak: `${a.kaynak_dosya || ""} ${a.kaynak_sayfa || ""} ${a.kaynak_satir || ""}`.trim(), bant_durumu: a.bant_durumu,
          gerekce: `TSSR'da ${TUR_TR[is.tur] || is.tur} (${is.ekipman || "ekipman belirtilmemiş"}${is.bant ? ", " + is.bant : ""}${antenCozumu(is) === "MEVCUT" ? ", mevcut anten" : ""}) → katalog açıklaması "${a.aciklama_en}"${a.bant_durumu === "UYUMLU" ? " · bant uyumlu" : a.bant_durumu === "TSSR_BANTSIZ" ? " · TSSR'da bant yazmıyor, kalem bant içeriyor — kontrol edin" : ""}${/same site visit/i.test(a.aciklama_en || "") ? " · aynı ziyarette başka ana paket varsa" : ""}${j > 0 ? " · alternatif" : ""}`,
          pr_var: !!pr, pr_qty: pr ? Number(pr.pr_qty ?? pr.done_qty ?? 0) : null, po_var: !!po, po_qty: po ? Number(po.requested_qty || 0) : null, po_no: po ? po.po_no : "" };
      });
      // Miktar uyuşmazlığı (belgede miktar yazıyorsa ve PR'da aynı kalem varsa)
      const ilk = o.adaylar[0];
      if (es.durum === "ACIK" && ilk && ilk.pr_var && is.miktar !== null && Math.abs(Number(ilk.pr_qty) - Number(is.miktar)) > 0.001) {
        uyarilar.push({ tip: "MIKTAR", seviye: "KONTROL", anahtar: `miktar|${ilk.boq_kod}`, item_code: ilk.boq_kod, item_description: ilk.aciklama,
          mesaj: `TSSR sayfa ${is.sayfa || "?"}'de ${is.ekipman || ""} ${TUR_TR[is.tur] || ""} miktarı ${is.miktar_ham} ${is.birim || ""} yazıyor; PR'da ${ilk.boq_kod} için ${ilk.pr_qty} girilmiş. Miktarı kontrol edin.`,
          dayanak: `${guncel.dosya_adi} sayfa ${is.sayfa || "?"}: “${is.dayanak}”` });
      }
      // Aynı saha/iş için mevcut PR/PO (olası mükerrer talep) — adaylardan biri PR/PO'da varsa
      const mv = o.adaylar.find((a) => a.pr_var || a.po_var);
      if (mv) {
        o.mevcut_not = `${mv.boq_kod}: ${mv.pr_var ? "PR'da var" : ""}${mv.pr_var && mv.po_var ? ", " : ""}${mv.po_var ? `PO açık (${mv.po_no || "no yok"})` : ""} — yeniden talep mükerrer olabilir.`;
      }
      // TSSR işi var, PR karşılığı yok (paket kapsamındaki RRU/jumper/kablo işleri hariç — onlar için yalnız paket notu)
      if (!o.adaylar.some((a) => a.pr_var) && !karar && !paketKapsami) {
        uyarilar.push({ tip: "EKSIK", seviye: es.durum === "ACIK" && !kanitsizEk ? "ONERI" : "KONTROL", anahtar: `eksik|${anahtar}`, item_code: es.durum === "ACIK" ? ilk.boq_kod : "", item_description: es.durum === "ACIK" ? ilk.aciklama : "",
          mesaj: es.durum === "ACIK"
            ? `TSSR sayfa ${is.sayfa || "?"}'de ${is.ekipman || ""} ${TUR_TR[is.tur] || ""} belirtiliyor; PR'da karşılık gelen kalem yok. ${ilk.boq_kod} kalemini kontrol edin.`
            : `TSSR sayfa ${is.sayfa || "?"}'de ${is.ekipman || ""} ${TUR_TR[is.tur] || ""} belirtiliyor; PR'da karşılık yok ve birden fazla aday kalem var — doğru kalemi seçin.`,
          dayanak: `${guncel.dosya_adi} sayfa ${is.sayfa || "?"}: “${is.dayanak}”` });
      }
    } else if (paketKapsami) {
      o.mesaj = o.paket_notu;
    } else if (!katalogHazir) {
      o.mesaj = KATALOG_YOK_MESAJ;
    } else {
      o.mesaj = es.durum === "BANT_UYUSMAZ"
        ? `Eşleşme doğrulanamadı — katalogda benzer kalemler var ama bant/teknoloji (${is.bant || is.teknoloji || "?"}) uyuşmuyor; tahminle başka banda çevrilmedi.`
        : es.durum === "KURAL_YOK" ? `Eşleşme doğrulanamadı — bu iş türü/ekipman için tanımlı eşleme kuralı yok (${is.tur}, ${is.ekipman || "?"}).`
        : `Eşleşme doğrulanamadı — seçili ${surum || ""} kataloğunda karşılık bulunamadı.`;
    }
    oneriler.push(o);
  });

  // 4) PR kalemlerinin TSSR işiyle ters düşmesi (montaj ↔ söküm, değişim ↔ yeni kurulum) ve bant uyuşmazlığı
  const tssrBantlar = new Set(); S.isler.forEach((is) => bantCikar(is.bant || is.teknoloji).forEach((b) => tssrBantlar.add(b)));
  for (const r of prRows) {
    const d = String(r.item_description || katMap[r.item_code]?.aciklama_en || "");
    for (const is of S.isler) {
      const k = karsitKalipVarMi(is, d);
      if (k) {
        uyarilar.push({ tip: "KAPSAM", seviye: "KONTROL", anahtar: `kapsam|${r.item_code}|${is.tur}`, item_code: r.item_code, item_description: d,
          mesaj: `TSSR sayfa ${is.sayfa || "?"}'de ${is.ekipman || ""} ${TUR_TR[is.tur] || ""} belirtiliyor. Seçtiğiniz kalem (${r.item_code} — ${d}) farklı bir iş türüne ait görünüyor. Olası kapsam uyuşmazlığı — ilgili BoQ kalemini kontrol edin.`,
          dayanak: `${guncel.dosya_adi} sayfa ${is.sayfa || "?"}: “${is.dayanak}”` });
        break;
      }
    }
    const kb = bantCikar(d);
    if (kb.size && tssrBantlar.size && ![...kb].some((b) => tssrBantlar.has(b))) {
      uyarilar.push({ tip: "BANT", seviye: "KONTROL", anahtar: `bant|${r.item_code}`, item_code: r.item_code, item_description: d,
        mesaj: `${r.item_code} kalemi ${[...kb].join("/")} bandına ait; TSSR'da yazan bant(lar): ${[...tssrBantlar].join(", ")}. Teknoloji/bant uyuşmazlığı olabilir — kontrol edin.`, dayanak: guncel.dosya_adi });
    }
    if (r.item_code && katalog && katalog.length && !katMap[r.item_code]) {
      uyarilar.push({ tip: "SURUM", seviye: "KONTROL", anahtar: `katalog|${r.item_code}`, item_code: r.item_code, item_description: d,
        mesaj: `${r.item_code} kalemi seçili ${surum} kataloğunda yok — başka sürüme ait ya da kaldırılmış olabilir.`, dayanak: "" });
    }
  }
  // 4b) Paket ↔ PR/PO: önerilen paket PR'da yok; pakete dahil bir kalem PR'da ayrıca talep edilmiş (mükerrer olabilir)
  const paketKodlari = new Set(paket.paketler.flatMap((p) => p.secenekler.map((x) => x.kod)));
  for (const p of paket.paketler) {
    if (!["ACIK", "ALTERNATIF"].includes(p.durum)) continue;
    const varOlan = p.secenekler.find((x) => x.pr_var || x.po_var);
    if (!varOlan) uyarilar.push({ tip: "PAKET", seviye: p.durum === "ACIK" ? "ONERI" : "KONTROL", anahtar: `paket|${p.bant}`, item_code: p.durum === "ACIK" ? p.secenekler[0].kod : "", item_description: p.secenekler[0]?.baslik || "",
      mesaj: p.durum === "ACIK" ? `${p.bant}: ${p.secenekler[0].kod} paketi adayı, PR'da yok. ${p.neden}` : `${p.bant}: birden fazla paket seçeneği var (${p.secenekler.map((x) => x.kod).join(" / ")}) — ${p.neden}`,
      dayanak: `${guncel.dosya_adi} sayfa ${p.tssr_dayanak?.kapak_sayfa || 1} (teknik kapsam ${p.tssr_dayanak?.teknik_kapsam || "-"})${p.tssr_dayanak?.anten_sayfa ? ` · anten dayanağı sayfa ${p.tssr_dayanak.anten_sayfa}` : ""}` });
  }
  const anaKapsamlar = paket.paketler.filter((p) => ["ACIK", "ALTERNATIF"].includes(p.durum)).map((p) => PK.paketKapsami(surum, p.secenekler[0].kod)).filter(Boolean);
  if (anaKapsamlar.length) for (const r of prRows) {
    const kod = String(r.item_code || "").trim();
    if (!kod || paketKodlari.has(kod)) continue;
    const et = PK.katalogEtiketleri(String(r.item_description || katMap[kod]?.aciklama_en || ""));
    if (!et.length) continue;
    const kap = anaKapsamlar.find((k) => et.every((e) => k.dahil[e]));
    if (kap) uyarilar.push({ tip: "DAHIL_MUKERRER", seviye: "KONTROL", anahtar: `dahil|${kod}`, item_code: kod, item_description: r.item_description || "",
      mesaj: `${kod} (${r.item_description || katMap[kod]?.aciklama_en || ""}) önerilen ${kap.kod} paketinin SOW'unda geçiyor (${et.map((e) => PK.ETIKET_AD[e] || e).join(", ")}) — ayrıca talep edilmesi mükerrer olabilir.`,
      dayanak: `${kap.kaynak.dosya} · ${kap.kaynak.sayfa} ${kap.kaynak.sow_hucre}: "${kap.dahil[et[0]][0].metin}"` });
  }

  // Dikkate alınmayan kararları uyarılara işle
  uyarilar.forEach((u) => { if (kararMap[u.anahtar]) u.karar = kararMap[u.anahtar]; });
  const sira = { KONTROL: 0, ONERI: 1 };
  uyarilar.sort((a, b) => (sira[a.seviye] ?? 9) - (sira[b.seviye] ?? 9));
  sonuc.ozet = { paket_sayisi: paket.paketler.filter((p) => ["ACIK", "ALTERNATIF"].includes(p.durum)).length, pakete_dahil: paket.isler.filter((x) => x.durum === "PAKETE_DAHIL").length,
    ek_talep: paket.isler.filter((x) => ["EK_TALEP", "EK_ADAY"].includes(x.durum)).length, kontrol: uyarilar.filter((u) => u.seviye === "KONTROL" && !u.karar).length, is_sayisi: S.isler.length, acik: oneriler.filter((o) => o.durum === "ACIK").length, alternatif: oneriler.filter((o) => o.durum === "ALTERNATIF").length,
    dogrulanamayan: oneriler.filter((o) => !["ACIK", "ALTERNATIF"].includes(o.durum)).length, uyari: uyarilar.length, dikkate_alinmayan: uyarilar.filter((u) => u.karar).length };
  return sonuc;
}

module.exports = { kontrol, paketDegerlendir, kalemBul, bantCikar, bantUyumu, antenCozumu, ESLEME, TUR_TR, KATALOG_YOK_MESAJ };
