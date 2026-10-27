// ═══ TSSR + BoQ AKILLI PR KONTROLÜ (27.10.2026, Orhan — Teknocenter) ═════════════════════════════════════════
// Girdi: yapay zekâ TSSR bulguları (tssrOkuma.js), seçilen BoQ sürümü kataloğu (boqKatalog.js), sahanın mevcut PR/PO
// kalemleri ve günlük iş girişleri. Çıktı: kaynağa bağlı öneriler (BoQ kodu + açıklama + birim + katalog fiyatı + gerekçe +
// TSSR dosyası/sayfa/alıntı + miktar belgede var mı + PR/PO'da var mı) ve yanlış/eksik talep uyarıları.
// Eşleme kuralları DETERMİNİSTİK ve açıklanabilirdir: iş türü + ekipman → katalog açıklamasında aranan kalıplar.
// Bant/teknoloji ifadesi tahminle başka koda çevrilmez: katalog açıklaması bir bant yazıyorsa TSSR'daki bantla aynı olmalı.
// Belirsiz durumda kesin "yanlış talep" denmez: "Kontrol gerekli" / "Olası kapsam uyuşmazlığı".
// TSSR'da bulunması faturalanabilirlik ya da müşteri onayı kanıtı değildir; "Talebe ekle" kullanıcı işlemidir.

const isoGun = (v) => { if (!v) return null; if (typeof v === "string") return v.slice(0, 10); const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); };
const BANTLAR = ["NR700", "NR3500", "NR2100", "NR1800", "L700", "L800", "L900", "L1800", "L2100", "L2600", "U900", "U2100", "G900", "G1800", "2600", "3500", "700", "800", "900", "1800", "2100"];
const bantCikar = (s) => {
  const u = String(s || "").toUpperCase().replace(/\s+/g, "");
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
  { ekipman: /modernization|modernizasyon|swap/i, tur: ["DEGISIM"], kalip: [/modernization/i, /band swap/i] },
  { ekipman: /survey|keşif|kesif/i, tur: ["DIGER"], kalip: [/site survey/i] },
  { ekipman: /gps/i, tur: ["MONTAJ", "ILAVE"], kalip: [/gps equipment/i] },
  { ekipman: /climber|tırman/i, tur: ["DIGER", "MONTAJ"], kalip: [/climber/i] },
];
const TUR_TR = { MONTAJ: "montaj", SOKUM: "söküm", DEGISIM: "değişim", ILAVE: "ilave", TASIMA: "taşıma", REVIZYON: "revizyon", DIGER: "iş" };

// Yükseklik/ölçü eşlemesi: TSSR işinde "7,2 m" varsa katalogda aynı sayı aranır
const sayilar = (s) => (String(s || "").replace(/,/g, ".").match(/\d+(?:\.\d+)?/g) || []).map(Number);

function kalemBul(katalog, is) {
  const metin = `${is.ekipman} ${is.aciklama}`;
  const kurallar = ESLEME.filter((k) => k.ekipman.test(metin) && k.tur.includes(is.tur) && !(k.lprtDegil && /lprt/i.test(metin)));
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

/* kontrol({ site, tssr, katalog, surum, surumOneri, prRows, poRows, kararlar })
   tssr: tssrOkuma.sahaTssrAnaliz çıktısı; katalog: boq_katalog satırları (seçilen sürüm, bölge)
   prRows: [{item_code, item_description, pr_qty, done_qty, boq_surum, created_at}] ; poRows: [{item_code, requested_qty, po_no}]
   kararlar: [{anahtar, karar, gerekce, kullanici, zaman}] (dikkate alınmayanlar) */
function kontrol({ site, tssr, katalog, surum, surumOneri, prRows = [], poRows = [], kararlar = [] }) {
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
  sonuc.tssr_belge = { dosya: guncel.dosya_adi, url: guncel.belge_url, tarih: S.belge_tarihi, revizyon: S.revizyon, site_id: S.site_id, proje: S.proje,
    sayfa_sayisi: S.sayfa_sayisi, eksik_sayfalar: S.eksik_sayfalar, revizyon_sayisi: tssr.revizyon_sayisi, is_sayisi: S.isler.length, model: S.model, kaynak: guncel.kaynak };
  if (S.site_id && site && S.site_id !== site) uyarilar.push({ tip: "SAHA", seviye: "KONTROL", anahtar: "tssr|saha", item_code: "",
    mesaj: `TSSR belgesindeki saha kodu (${S.site_id}) seçili sahadan (${site}) farklı görünüyor — doğru belge mi kontrol edin.`, dayanak: `${guncel.dosya_adi} sayfa 1` });
  if (S.eksik_sayfalar && S.eksik_sayfalar.length) uyarilar.push({ tip: "TSSR", seviye: "KONTROL", anahtar: "tssr|eksik_sayfa", item_code: "",
    mesaj: `TSSR'ın ${S.eksik_sayfalar.join(", ")}. sayfaları okunamadı — bulgular eksik olabilir.`, dayanak: guncel.dosya_adi });
  // 2) TSSR revizyonu, PR'ın dayandığından yeni
  const tssrTarih = S.belge_tarihi || null;
  if (tssrTarih) {
    const eskiPr = prRows.filter((r) => r.boq_secim_zaman || r.created_at).filter((r) => (isoGun(r.boq_secim_zaman || r.created_at) || "9999") < tssrTarih);
    if (eskiPr.length && (tssr.revizyon_sayisi || 0) > 1) uyarilar.push({ tip: "REVIZYON", seviye: "KONTROL", anahtar: "tssr|revizyon", item_code: "",
      mesaj: `Güncel TSSR (${S.belge_tarihi}${S.revizyon ? " · " + S.revizyon : ""}) ${eskiPr.length} PR kaleminin girildiği tarihten yeni — PR'ı güncel revizyona göre kontrol edin.`, dayanak: guncel.dosya_adi });
  }

  // 3) Her TSSR işi için katalogdan karşılık
  const prEslesen = new Set();
  S.isler.forEach((is, i) => {
    const anahtar = `is|${i + 1}|${is.tur}|${(is.ekipman || "").slice(0, 20)}`;
    const dayanak = { dosya: guncel.dosya_adi, url: guncel.belge_url, sayfa: is.sayfa, bolum: is.bolum, alinti: is.dayanak };
    const es = kalemBul(katalog || [], is);
    const karar = kararMap[anahtar] || null;
    const o = { anahtar, is: { sira: i + 1, tur: is.tur, tur_tr: TUR_TR[is.tur] || is.tur, aciklama: is.aciklama, teknoloji: is.teknoloji, bant: is.bant, ekipman: is.ekipman,
        miktar: is.miktar, miktar_ham: is.miktar_ham, birim: is.birim }, dayanak, miktar_belgede: is.miktar !== null, durum: es.durum, adaylar: [], karar };
    if (es.durum === "ACIK" || es.durum === "ALTERNATIF") {
      o.adaylar = es.adaylar.map((a, j) => {
        const pr = prMap[a.kod], po = poMap[a.kod];
        if (pr) prEslesen.add(a.kod);
        return { boq_kod: a.kod, aciklama: a.aciklama_en, aciklama_tr: a.aciklama_tr, birim: a.birim, para_birimi: a.para_birimi, birim_fiyat: a.birim_fiyat, bolge: a.bolge, surum: a.surum,
          kaynak: `${a.kaynak_dosya || ""} ${a.kaynak_sayfa || ""} ${a.kaynak_satir || ""}`.trim(), bant_durumu: a.bant_durumu,
          gerekce: `TSSR'da ${TUR_TR[is.tur] || is.tur} (${is.ekipman || "ekipman belirtilmemiş"}${is.bant ? ", " + is.bant : ""}) → katalog açıklaması "${a.aciklama_en}"${a.bant_durumu === "UYUMLU" ? " · bant uyumlu" : a.bant_durumu === "TSSR_BANTSIZ" ? " · TSSR'da bant yazmıyor, kalem bant içeriyor — kontrol edin" : ""}${j > 0 ? " · alternatif" : ""}`,
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
      // TSSR işi var, PR karşılığı yok
      if (!o.adaylar.some((a) => a.pr_var) && !karar) {
        uyarilar.push({ tip: "EKSIK", seviye: es.durum === "ACIK" ? "ONERI" : "KONTROL", anahtar: `eksik|${anahtar}`, item_code: es.durum === "ACIK" ? ilk.boq_kod : "", item_description: es.durum === "ACIK" ? ilk.aciklama : "",
          mesaj: es.durum === "ACIK"
            ? `TSSR sayfa ${is.sayfa || "?"}'de ${is.ekipman || ""} ${TUR_TR[is.tur] || ""} belirtiliyor; PR'da karşılık gelen kalem yok. ${ilk.boq_kod} kalemini kontrol edin.`
            : `TSSR sayfa ${is.sayfa || "?"}'de ${is.ekipman || ""} ${TUR_TR[is.tur] || ""} belirtiliyor; PR'da karşılık yok ve birden fazla aday kalem var — doğru kalemi seçin.`,
          dayanak: `${guncel.dosya_adi} sayfa ${is.sayfa || "?"}: “${is.dayanak}”` });
      }
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
  // Dikkate alınmayan kararları uyarılara işle
  uyarilar.forEach((u) => { if (kararMap[u.anahtar]) u.karar = kararMap[u.anahtar]; });
  const sira = { KONTROL: 0, ONERI: 1 };
  uyarilar.sort((a, b) => (sira[a.seviye] ?? 9) - (sira[b.seviye] ?? 9));
  sonuc.ozet = { is_sayisi: S.isler.length, acik: oneriler.filter((o) => o.durum === "ACIK").length, alternatif: oneriler.filter((o) => o.durum === "ALTERNATIF").length,
    dogrulanamayan: oneriler.filter((o) => !["ACIK", "ALTERNATIF"].includes(o.durum)).length, uyari: uyarilar.length, dikkate_alinmayan: uyarilar.filter((u) => u.karar).length };
  return sonuc;
}

module.exports = { kontrol, kalemBul, bantCikar, bantUyumu, ESLEME, TUR_TR };
