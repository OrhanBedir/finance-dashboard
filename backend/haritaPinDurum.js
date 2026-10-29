// ═══ HARİTA PİN DURUMU + ANTEN / BANT DETAYI (29.10.2026, Orhan — Teknocenter saha haritası) ═══════════════════════
// Saf fonksiyonlar (DB yok). Önceki "antenli / antensiz" pin rengi kuralının YERİNE geçer: pin rengi İŞ DURUMUDUR,
// anten revizyonu ayrı gösterilir.
//
// İŞ DURUMU (yalnız görünümdeki firmanın — Teknocenter — kendi işi):
//   YESIL : montaj kapsamı tamamlanmış + gerekli QC onayı alınmış + açık issue / eksik kalem yok
//   SARI  : açık issue, kısmi / yarım montaj, QC NOK ya da QC onayı bekleyen tamamlanmış iş (takip gerekir)
//   MAVI  : başlamamış / planlanmış iş
//   GRI   : durum doğrulanamıyor (çelişkili tarih, fiziki miktar girilmemiş PR talebi, montaj kalemi olmayan iş …)
// Kaynak seçimi:
//   • Ana montaj (RF iş kolu) firmanın ise Rollout montaj / QC alanları (sahaFiltre.montajDurumu) + kendi kalemleri.
//   • Ana montaj başka firmada ya da Rollout kaydı yoksa YALNIZ firmanın Günlük İş Girişi kalemleri: başka firmanın biten ana işi
//     firmanın eksik kalemlerini yeşile çevirmez.
//   • Kalem: done_qty = PR (talep) miktarı, tamamlanan_qty = fiziki biten. PR talebi tek başına tamamlanma kanıtı DEĞİLDİR;
//     fiziki miktar girilmemişse (ve on-air / QC OK yoksa) kalem "doğrulanamadı" sayılır.
//   • QC NOK tek başına "yarım montaj" değildir: montaj bitmiş + QC NOK ayrı yazılır.
//   • Açık issue: İş Ata'da "Issue giderme" kategorisinde tamamlanmamış / iptal edilmemiş kayıt.
// Aynı pin altında birden çok iş: SARI (açık issue / eksik) > GRI (belirsiz — yeşil verilmez) > tümü YESIL → YESIL;
//   YESIL + MAVI karışık → SARI "Kısmen tamamlandı"; tümü MAVI → MAVI.
//
// ANTEN / BANT: bant iş kodundan (yazıldığı gibi; TRP başka teknolojiye çevrilmez). Anten revizyonu PR ana paketinin
// doğru BoQ sürümündeki başlığı / SOW'undan (sahaFiltre.kalemAnten); TSSR yalnız destekleyici. Çelişki ya da eksikte
// "Doğrulanamadı". NR700 / NR3500 olmak tek başına anten kanıtı değildir.
"use strict";
const PK = require("./paketKapsam");
const SF = require("./sahaFiltre");
const { fizikselSaha, isKapsamUyumu } = require("./sahaKimlik");

const gun = (v) => { if (!v) return null; if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10); const t = String(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };
const sayi = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

const PIN_AD = { YESIL: "Tamamlandı · QC uygun", SARI: "Takip gerekiyor", MAVI: "Başlamadı / planlandı", GRI: "Durum doğrulanamadı" };

// Kalem durumu: TAMAM | KISMI | BASLAMADI | BILINMIYOR (+ qc_ok)
function kalemDurumu(k) {
  const pr = sayi(k.pr_miktar), fz = sayi(k.fiziki_miktar);
  const qcOk = String(k.qc_durum || "").trim().toUpperCase() === "OK";
  const onair = gun(k.onair_date);
  let durum, aciklama;
  if (fz !== null) {
    if (fz <= 0) { durum = "BASLAMADI"; aciklama = `fiziki 0 / PR ${pr ?? "?"}`; }
    else if (pr !== null && pr > 0 && fz < pr) { durum = "KISMI"; aciklama = `fiziki ${fz} / PR ${pr}`; }
    else { durum = "TAMAM"; aciklama = `fiziki ${fz}${pr !== null ? ` / PR ${pr}` : ""}`; }
  } else if (onair) { durum = "TAMAM"; aciklama = `on-air ${onair} (fiziki miktar girilmemiş)`; }
  else if (qcOk) { durum = "TAMAM"; aciklama = "QC OK (fiziki miktar girilmemiş)"; }
  else { durum = "BILINMIYOR"; aciklama = `PR ${pr ?? "?"} · fiziki tamamlanan girilmemiş — talep tamamlanma kanıtı sayılmadı`; }
  return { durum, qc_ok: qcOk, aciklama };
}

// Açık issue atamaları
const acikIssue = (atamalar) => (atamalar || []).filter((a) => String(a.kategori || "").toUpperCase() === "ISSUE" && !["TAMAMLANDI", "IPTAL"].includes(String(a.durum || "").toUpperCase()));
const planliAtama = (atamalar) => (atamalar || []).find((a) => !["IPTAL"].includes(String(a.durum || "").toUpperCase()) && String(a.kategori || "").toUpperCase() !== "ISSUE");

// Tek iş kaydının pin durumu.
//  montaj   : sahaFiltre.montajDurumu çıktısı ya da { kod: "BASKA_FIRMA" } / { kod: "KAYIT_YOK" }
//  rfBizim  : ana montaj (RF iş kolu) görünümdeki firmanın mı (false → yalnız kalemler)
//  row      : Rollout satırı (QC NOK ayrımı için qc_durum) — maskeli olabilir
//  kalemler : firmanın kalemleri [{ item_code, item_description, pr_miktar, fiziki_miktar, qc_durum, onair_date }]
//  atamalar : bu iş kodunun iş atamaları
function isPinDurumu({ montaj, rfBizim, row, kalemler = [], atamalar = [] }) {
  const detay = [], eksik = [];
  const issues = acikIssue(atamalar).map((a) => ({ id: a.id, durum: a.durum, plan_tarihi: gun(a.plan_tarihi) }));
  const ana = kalemler.filter((k) => !SF.YARDIMCI_RX.test(String(k.item_description || "")));
  const kalemSet = (ana.length ? ana : kalemler).map((k) => ({ k, d: kalemDurumu(k) }));
  const kSay = (d) => kalemSet.filter((x) => x.d.durum === d).length;
  for (const x of kalemSet) if (x.d.durum !== "TAMAM" || !x.d.qc_ok) eksik.push(`${x.k.item_code || "kalem"}: ${x.d.aciklama}${x.d.durum === "TAMAM" && !x.d.qc_ok ? " · QC onaylı değil" : ""}`);
  let renk, ad, kaynak, qc = null;
  const plan = planliAtama(atamalar);
  const rolloutPlan = gun(row?.plan_start_date) || gun(row?.inst_plan_start_date);
  const baslamadiAd = () => (plan ? `Planlandı (İş atama #${plan.id}${gun(plan.plan_tarihi) ? ` · ${gun(plan.plan_tarihi)}` : ""})`
    : rolloutPlan ? `Planlandı (Rollout plan ${rolloutPlan})` : "Başlamadı");

  if (rfBizim && montaj && !["BASKA_FIRMA", "KAYIT_YOK"].includes(montaj.kod)) {
    kaynak = "Rollout RF montaj / QC";
    const qcNok = String(row?.qc_durum || "").trim().toUpperCase() === "NOK";
    if (montaj.kod === "TAMAM_QC_OK") { renk = "YESIL"; ad = "Montaj tamamlandı · QC OK"; qc = "OK"; }
    else if (montaj.kod === "TAMAM_QC_BEKLIYOR") { renk = "SARI"; ad = qcNok ? "Montaj tamamlandı · QC NOK" : "Montaj tamamlandı · QC onayı bekliyor"; qc = qcNok ? "NOK" : "Bekliyor";
      detay.push(qcNok ? "QC NOK: montaj bitmiş görünüyor, QC onayı yok (yarım montaj anlamına gelmez)" : "QC henüz kapanmadı"); }
    else if (montaj.kod === "DEVAM") { renk = "SARI"; ad = "Montaj başladı, bitmedi (kısmi)"; qc = qcNok ? "NOK" : null; }
    else { renk = "MAVI"; ad = baslamadiAd(); if (montaj.kod === "MALZEME_BEKLIYOR") detay.push("Malzeme OK değil"); }
    if (montaj.belirsiz && renk !== "SARI") { renk = "GRI"; ad = "Rollout tarihleri çelişkili"; detay.push(...montaj.belirsiz); }
    else if (montaj.belirsiz) detay.push(...montaj.belirsiz);
    // Kendi kalemlerinde açıkça eksik / kısmi olan varsa tamamlanmış sayılmaz
    if (renk === "YESIL" && (kSay("KISMI") || kSay("BASLAMADI"))) { renk = "SARI"; ad = "Montaj tamam · eksik kalem var"; }
    else if (kSay("KISMI") && renk !== "SARI") { renk = "SARI"; ad = "Kalem kısmen tamamlandı"; }
    // Rollout montajı başlamamış görünürken kalemde fiziki tamamlanma var → çelişkili, başlamadı da tamamlandı da denmez
    else if (renk === "MAVI" && kSay("TAMAM")) { renk = "GRI"; ad = "Rollout'ta montaj tarihi yok ama kalem tamamlanmış görünüyor"; detay.push("Rollout montaj tarihleri ile kalem fiziki miktarı çelişkili — kontrol edin"); }
  } else {
    kaynak = montaj?.kod === "BASKA_FIRMA" ? "Firmanın kendi kalemleri (ana montaj başka firmada)" : "Günlük İş Girişi kalemleri";
    if (!kalemSet.length) { renk = "GRI"; ad = montaj?.kod === "BASKA_FIRMA" ? "Ana montaj başka firmada · firmanın montaj kalemi yok" : "Montaj kaydı / kalemi yok"; }
    else {
      const t = kSay("TAMAM"), ks = kSay("KISMI"), b = kSay("BASLAMADI"), bil = kSay("BILINMIYOR"), n = kalemSet.length;
      const qcHepsi = kalemSet.filter((x) => x.d.durum === "TAMAM").every((x) => x.d.qc_ok);
      if (ks) { renk = "SARI"; ad = `Kalem kısmen tamamlandı (${ks}/${n})`; }
      else if (t && (b || bil)) { renk = bil && !b ? "GRI" : "SARI"; ad = bil && !b ? `${t}/${n} kalem tamam · diğerlerinin fiziki miktarı girilmemiş` : `Kısmen tamamlandı (${t}/${n} kalem)`; }
      else if (t === n) { if (qcHepsi) { renk = "YESIL"; ad = "Kalemler tamamlandı · QC OK"; qc = "OK"; } else { renk = "SARI"; ad = "Kalemler tamamlandı · QC onaylı değil"; qc = "NOK"; } }
      else if (bil) { renk = "GRI"; ad = "Fiziki tamamlanan miktar girilmemiş"; }
      else { renk = "MAVI"; ad = baslamadiAd(); }
    }
  }
  if (issues.length) { detay.unshift(`Açık issue: ${issues.map((i) => `İş atama #${i.id} (${i.durum})`).join(", ")}`); if (renk !== "SARI") { renk = "SARI"; ad = `Açık issue · ${ad}`; } }
  return { renk, renk_ad: PIN_AD[renk], ad, kaynak, qc, detay, eksik: eksik.slice(0, 20), acik_issue: issues };
}

// Pin (fiziksel saha) birleşik durumu: işler [{ pin }]
function pinBirlestir(isler) {
  const r = isler.map((x) => x.pin?.renk).filter(Boolean);
  if (!r.length) return { renk: "GRI", ad: PIN_AD.GRI, neden: "İş yok" };
  if (r.includes("SARI"))
    return { renk: "SARI", ad: PIN_AD.SARI, neden: isler.filter((x) => x.pin?.renk === "SARI").map((x) => `${x.site_code}: ${x.pin.ad}`).join(" · "), belirsiz_var: r.includes("GRI") };
  if (r.includes("GRI")) return { renk: "GRI", ad: PIN_AD.GRI, neden: isler.filter((x) => x.pin?.renk === "GRI").map((x) => `${x.site_code}: ${x.pin.ad}`).join(" · ") };
  if (r.every((x) => x === "YESIL")) return { renk: "YESIL", ad: PIN_AD.YESIL, neden: "Tüm işler tamamlandı ve QC uygun" };
  if (r.includes("YESIL")) return { renk: "SARI", ad: "Kısmen tamamlandı", neden: `${r.filter((x) => x === "YESIL").length} iş tamam, ${r.filter((x) => x === "MAVI").length} iş başlamadı` };
  return { renk: "MAVI", ad: PIN_AD.MAVI, neden: "İşler başlamadı / planlandı" };
}

// ── Anten / bant detayı ────────────────────────────────────────────────────────────────────────────────────────
const BANT_RX = /^(NR\d{3,4}|LC\d{3,4}|L\d{3,4}|U\d{3,4}|G\d{3,4}|TRP|DSS|5GEXP)$/;
function kodBantlari(kod) {
  const f = fizikselSaha(kod);
  return (f?.is_kapsami || []).filter((t) => BANT_RX.test(t));
}
// Ana paket: kalemlerden BoQ paketi kaydı olan; aynı ziyaret paketi değil olan önce. Sürüm kalemde yoksa iki sürüm aynı paketi vermeli.
function anaPaket(kalemler) {
  const adaylar = [];
  for (const k of kalemler || []) {
    const kod = String(k.item_code || "").trim();
    if (!kod) continue;
    const surumler = k.boq_surum ? [String(k.boq_surum).toUpperCase()] : ["BOQ2026", "BOQ2025"];
    const kayitlar = surumler.map((s) => PK.paketKapsami(s, kod)).filter((p) => p && p.tur === "PAKET");
    if (!kayitlar.length) continue;
    const p = kayitlar[0];
    adaylar.push({ kod, surum: k.boq_surum ? p.surum : null, surum_secili: !!k.boq_surum, baslik: p.baslik_tr || p.baslik_en, baslik_en: p.baslik_en,
      ayni_ziyaret: p.ayni_ziyaret, anten_revizyonu: p.anten_revizyonu,
      surum_celiski: !k.boq_surum && kayitlar.length > 1 && kayitlar.some((x) => x.anten_revizyonu !== p.anten_revizyonu) });
  }
  return adaylar.find((a) => !a.ayni_ziyaret) || adaylar[0] || null;
}
//  tssr: tssr_ai_analiz.sonuc (bu iş kodunun) ya da null
function isAntenDetayi({ kod, row, kalemler = [], tssr = null }) {
  const bantlar = kodBantlari(kod);
  const bantMetni = bantlar.length ? bantlar.join("+") : null;
  const standalone = SF.standaloneMi(row, kod);
  const paket = anaPaket(kalemler);
  // PR kaynağı: paket başlığı (kalemde seçili sürüm) / açık anten montaj kalemi / yalnız RRU kalemleri
  const sonuclar = (kalemler || []).map((k) => ({ k, s: SF.kalemAnten(k) })).filter((x) => x.s);
  const v = sonuclar.find((x) => x.s.durum === "VAR"), c = sonuclar.find((x) => x.s.durum === "CELISKI"), y = sonuclar.find((x) => x.s.durum === "YOK");
  const ana = (kalemler || []).filter((k) => !SF.YARDIMCI_RX.test(String(k.item_description || "")));
  const yalnizRru = ana.length > 0 && ana.every((k) => /\bRRU\b/i.test(k.item_description) && /install|dismantl|removal|montaj|söküm/i.test(k.item_description));
  let pr = null;
  if (c) pr = { durum: "CELISKI", dayanak: c.s.dayanak };
  else if (v) pr = { durum: "VAR", dayanak: v.s.dayanak };
  else if (y) pr = { durum: "YOK", dayanak: y.s.dayanak };
  else if (yalnizRru) pr = { durum: "YOK", dayanak: "PR'da yalnız RRU montaj / söküm kalemleri var, anten kalemi yok" };
  // TSSR (destekleyici): yalnız bu işin bandıyla uyumlu TSSR
  let ts = null;
  if (tssr) {
    const uyum = isKapsamUyumu(kod, tssr?.kapak?.teknik_kapsam || "");
    if (uyum.durum === "FARKLI") ts = { durum: "KULLANILMADI", not: `TSSR teknik kapsamı (${uyum.tssr.join("+")}) bu işin bandından farklı` };
    else { const a = PK.antenRevizyonu(tssr); ts = { durum: a.durum, sayfa: a.dayanak?.sayfa || null, not: a.durum === "VAR" ? "TSSR: yeni / değişen anten" : a.durum === "YOK" ? "TSSR: mevcut antenler kullanılıyor" : "TSSR'da anten çözümü yazmıyor" }; }
  }
  let anten, dayanak;
  if (pr?.durum === "VAR" || pr?.durum === "YOK") {
    if (ts && ["VAR", "YOK"].includes(ts.durum) && ts.durum !== pr.durum) { anten = "DOGRULANAMADI"; dayanak = `Çelişki: ${pr.dayanak} — ${ts.not}${ts.sayfa ? ` (s.${ts.sayfa})` : ""}`; }
    else { anten = pr.durum; dayanak = pr.dayanak + (ts && ts.durum === pr.durum ? ` · ${ts.not}${ts.sayfa ? ` (s.${ts.sayfa})` : ""} destekliyor` : ""); }
  } else if (pr?.durum === "CELISKI") { anten = "DOGRULANAMADI"; dayanak = pr.dayanak; }
  else {
    anten = "DOGRULANAMADI";
    dayanak = paket ? `${paket.kod} paket başlığı anten revizyonunu belirtmiyor` : "PR ana paketi yok";
    if (ts && ["VAR", "YOK"].includes(ts.durum)) dayanak += ` · ${ts.not}${ts.sayfa ? ` (s.${ts.sayfa})` : ""} — PR paketiyle doğrulanmadı`;
  }
  const antenAd = anten === "VAR" ? "Anten revizyonlu" : anten === "YOK" ? "Anten değişimsiz" : "anten kapsamı doğrulanamadı";
  const kisa = [standalone ? "Standalone" : null,
    anten === "DOGRULANAMADI" ? `${bantMetni || "Bant kodda yok"} · ${antenAd}` : `${antenAd} · ${bantMetni || "bant kodda yok"}`].filter(Boolean).join(" · ");
  return { bantlar, bant_metni: bantMetni, standalone, anten, anten_ad: anten === "DOGRULANAMADI" ? "Doğrulanamadı" : antenAd, dayanak, kisa,
    ana_paket: paket ? { kod: paket.kod, surum: paket.surum, surum_secili: paket.surum_secili, baslik: paket.baslik, ayni_ziyaret: paket.ayni_ziyaret } : null,
    tssr: ts };
}

module.exports = { isPinDurumu, pinBirlestir, kalemDurumu, isAntenDetayi, kodBantlari, anaPaket, PIN_AD };
