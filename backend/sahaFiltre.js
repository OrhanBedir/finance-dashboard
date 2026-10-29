// ═══ SAHA FİLTRELERİ · KAPSAM RENGİ · İŞ SÜRESİ (29.10.2026, Orhan — Rollout haritası + Plan Yap) ═════════════════════
// Saf fonksiyonlar (DB yok). Harita, filtreli Excel ve planlama AYNI kuralları buradan kullanır.
//
// MONTAJ DURUMU (Rollout RF iş kolu alanları):
//   malzeme OK      : malzeme_status = 'OK'
//   montaj başladı  : installation_actual_start_date | rf_started_date
//   montaj bitti    : installation_actual_end_date | rf_finished_date | onair_date (on-air kurulumun bittiğini gösterir)
//   QC OK           : qc_durum = 'OK' | qc_closed_date
//   QC NOK tek başına "montaj yapılmadı" DEĞİLDİR; montajı bitmiş ama QC bekleyen iş yeniden montaj adayı yapılmaz.
//   Çelişkili: QC OK ama montaj bitiş/başlangıç yok; bitiş başlangıçtan önce; montaj bitti ama malzeme OK değil … → BELIRSIZ.
// FİLTRELER:
//   MONTAJ_BEKLIYOR : malzeme OK + montaj bitmemiş (BASLAMADI | DEVAM) — QC'ye bakılmaz
//   QC_OK           : montaj bitti + QC OK
//   QC_NOK          : montaj başladı (bitmiş ya da devam) + QC OK değil — alt durum: "QC bekliyor (montaj tamam)" / "Montaj eksik"
//   CLEANUP         : Clean Up kaydı var, kalemleri bitmemiş ve onaya gönderilmemiş/onaylanmamış (TASLAK, REDDEDILDI)
"use strict";
const PK = require("./paketKapsam");

const dolu = (v) => v != null && String(v).trim() !== "" && v !== "N/A" && v !== "__NA__";
const gun = (v) => { if (!v) return null; if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10); const t = String(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };

function montajDurumu(r) {
  if (!r) return { kod: "KAYIT_YOK", ad: "Rollout kaydı yok", filtreler: [], belirsiz: null };
  const malzeme = String(r.malzeme_status || "").trim().toUpperCase() === "OK";
  const bas = gun(r.installation_actual_start_date) || gun(r.rf_started_date);
  const bit = gun(r.installation_actual_end_date) || gun(r.rf_finished_date) || gun(r.onair_date);
  const qcOk = String(r.qc_durum || "").trim().toUpperCase() === "OK" || !!gun(r.qc_closed_date);
  const celiski = [];
  if (qcOk && !bit) celiski.push(bas ? "QC OK ama montaj bitiş tarihi girilmemiş — montaj tamamlanmış sayıldı" : "QC OK görünüyor ama montaj başlangıç / bitiş tarihi yok — montaj tamamlanmış sayıldı");
  if (bas && bit && bit < bas) celiski.push(`Montaj bitişi (${bit}) başlangıçtan (${bas}) önce`);
  if (bit && !malzeme && !dolu(r.malzeme_status)) celiski.push("Montaj bitmiş görünüyor ama malzeme durumu boş");
  const filtreler = [];
  let kod, ad;
  if (bit || qcOk) { // QC kapanışı montajın bittiğini gösterir; yeniden montaj adayı yapılmaz
    if (qcOk) { kod = "TAMAM_QC_OK"; ad = "Montaj tamamlandı · QC OK"; filtreler.push("QC_OK"); }
    else { kod = "TAMAM_QC_BEKLIYOR"; ad = "Montaj tamamlandı · QC bekliyor"; filtreler.push("QC_NOK"); }
  } else if (bas) {
    kod = "DEVAM"; ad = "Montaj devam ediyor / eksik";
    if (malzeme) filtreler.push("MONTAJ_BEKLIYOR");
    if (!qcOk) filtreler.push("QC_NOK");
  } else if (malzeme) { kod = "BASLAMADI"; ad = "Malzeme OK · montaj başlamadı"; filtreler.push("MONTAJ_BEKLIYOR"); }
  else { kod = "MALZEME_BEKLIYOR"; ad = "Malzeme OK değil · montaj başlamadı"; }
  return { kod, ad, filtreler, belirsiz: celiski.length ? celiski : null, malzeme_ok: malzeme, baslangic: bas, bitis: bit, qc_ok: qcOk };
}

function cleanupBekliyor(c) {
  if (!c) return false;
  const durum = String(c.onay_durum || "TASLAK").toUpperCase();
  if (["ONAY_BEKLE", "ONAYLANDI"].includes(durum)) return false;
  const items = Array.isArray(c.items) ? c.items : [];
  return !(items.length && items.every((it) => it.tamamlandi)) || !c.completion_date;
}

// ── Kapsam rengi ────────────────────────────────────────────────────────────────────────────────────────────────
// STANDALONE (kırmızı, öncelikli) > ANTEN_VAR (sarı, zor) > ANTEN_YOK (yeşil, kolay) > BELIRSIZ (gri)
// Anten revizyonu tahmin edilmez: (1) PR kaleminin BoQ paketi (kalemde seçilmiş sürüm; sürüm yoksa iki sürüm aynı sonucu
// veriyorsa) başlığında "with / without antenna revision", (2) açık anten montaj kalemi (Antenna installation …).
const YARDIMCI_RX = /label|etiket|plaka|plate|sticker|auxiliary|transport|nakliye|crane|vin[çc]|incentive|te[şs]vik|holiday|sunday|material supply|consumable|marking/i;
const standaloneMi = (r, kod) => /^standalone/i.test(String(r?.site_type || "")) || /_NS_/i.test(String(kod || r?.site_code || ""));
function kalemAnten(k) {
  const kod = String(k.item_code || "").trim();
  const surumler = k.boq_surum ? [String(k.boq_surum).toUpperCase()] : ["BOQ2025", "BOQ2026"];
  const sonuc = surumler.map((s) => PK.paketKapsami(s, kod)).filter(Boolean).map((p) => p.anten_revizyonu).filter((x) => x !== null && x !== undefined);
  if (sonuc.length) {
    if (sonuc.every((x) => x === true)) return { durum: "VAR", dayanak: `${kod} paket başlığı: anten revizyonlu${k.boq_surum ? ` (${k.boq_surum})` : ""}` };
    if (sonuc.every((x) => x === false)) return { durum: "YOK", dayanak: `${kod} paket başlığı: anten revizyonsuz${k.boq_surum ? ` (${k.boq_surum})` : ""}` };
    return { durum: "CELISKI", dayanak: `${kod}: 2025 ve 2026 BoQ farklı — kalemde sürüm seçilmemiş` };
  }
  // GPS anteni sektör anteni değildir — anten revizyonu sayılmaz
  if (/\bantenna\b[^,]*\binstall|\binstall[^,]*\bantenna\b|anten montaj/i.test(String(k.item_description || "")) && !/dismantl|removal|söküm|\bgps\b/i.test(String(k.item_description || "")))
    return { durum: "VAR", dayanak: `${kod || "kalem"}: anten montaj kalemi` };
  return null;
}
function kapsamRengi(isler) {
  // isler: [{ row, kod, kalemler }]
  if (isler.some((x) => standaloneMi(x.row, x.kod))) return { renk: "STANDALONE", ad: "Standalone", dayanak: "Saha tipi Standalone / iş kodu _NS_" };
  let varD = null, yokD = null, belirsiz = null;
  for (const x of isler) {
    const sonuclar = (x.kalemler || []).map(kalemAnten).filter(Boolean);
    const v = sonuclar.find((s) => s.durum === "VAR"), y = sonuclar.find((s) => s.durum === "YOK"), c = sonuclar.find((s) => s.durum === "CELISKI");
    // PR'ın ana kalemleri yalnız RRU montaj / söküm ise anten işi PR kapsamında yok (doğrulanmış: kalem listesi)
    const ana = (x.kalemler || []).filter((k) => !YARDIMCI_RX.test(String(k.item_description || "")));
    const yalnizRru = ana.length > 0 && ana.every((k) => /\bRRU\b/i.test(k.item_description) && /install|dismantl|removal|montaj|söküm/i.test(k.item_description));
    if (v) varD = varD || `${x.kod}: ${v.dayanak}`;
    else if (c) belirsiz = belirsiz || `${x.kod}: ${c.dayanak}`;
    else if (y) yokD = yokD || `${x.kod}: ${y.dayanak}`;
    else if (yalnizRru) yokD = yokD || `${x.kod}: PR'da yalnız RRU montaj / söküm kalemleri var, anten kalemi yok`;
    else belirsiz = belirsiz || `${x.kod}: PR kaleminden anten kapsamı doğrulanamadı`;
  }
  if (varD) return { renk: "ANTEN_VAR", ad: "Anten değişimli / revizyonlu — zor", dayanak: varD };
  if (yokD && !belirsiz) return { renk: "ANTEN_YOK", ad: "Anten değişimsiz — kolay", dayanak: yokD };
  return { renk: "BELIRSIZ", ad: "İş kapsamı doğrulanamadı", dayanak: belirsiz || "PR kalemi yok" };
}

// ── İş süresi (Orhan'ın planlama varsayımları — yasal süre ya da bitiş garantisi değildir) ─────────────────────────
//   Standalone + pole montajı → 3 ekip-gün · Standalone, pole yok, outdoor kabinet + anten → 2
//   LTE (standalone değil), antenli montaj / değişim → 1 · Yalnız RRU montaj / söküm → 0,7 (günlük kapasitenin %70'i)
// Kapsamı bilinmeyen işe süre üretilmez. Montajı başlamış işte doğrulanmış kalan kapsam yoksa tam süre başlatılmaz.
function isSuresi({ row, kod, kalemler, montaj }) {
  const ana = (kalemler || []).filter((k) => !YARDIMCI_RX.test(String(k.item_description || "")));
  if (!ana.length) return { gun: null, kural: null, gerekce: "PR kalemi yok — kapsam bilinmiyor, süre üretilmedi" };
  if (montaj && montaj.kod === "DEVAM") return { gun: null, kural: null, gerekce: "Montaj başlamış; doğrulanmış kalan kapsam yok — kalan süreyi girin" };
  if (montaj && ["TAMAM_QC_OK", "TAMAM_QC_BEKLIYOR"].includes(montaj.kod)) return { gun: null, kural: null, gerekce: "Montaj tamamlanmış — montaj işi planlanmaz" };
  const metin = ana.map((k) => String(k.item_description || "")).join(" | ");
  const pole = /\bpole\b/i.test(metin) && !ana.filter((k) => /\bpole\b/i.test(k.item_description)).every((k) => /dismantl|removal/i.test(k.item_description));
  const kabin = /cabinet|kabin/i.test(metin);
  const anten = ana.some((k) => kalemAnten(k)?.durum === "VAR");
  if (standaloneMi(row, kod)) {
    if (pole) return { gun: 3, kural: "STANDALONE_POLE", gerekce: "Standalone + pole montajı → 3 ekip-gün" };
    if (kabin && anten) return { gun: 2, kural: "STANDALONE_KABIN_ANTEN", gerekce: "Standalone, pole yok; outdoor kabinet + anten → 2 ekip-gün" };
    return { gun: null, kural: null, gerekce: "Standalone ama pole / kabinet+anten kapsamı PR'dan doğrulanamadı" };
  }
  if (anten) return { gun: 1, kural: "LTE_ANTEN", gerekce: "Standalone değil, antenli montaj / değişim → 1 ekip-gün" };
  if (ana.every((k) => /\bRRU\b/i.test(k.item_description) && /install|dismantl|removal|montaj|söküm/i.test(k.item_description)))
    return { gun: 0.7, kural: "RRU", gerekce: "Yalnız RRU montaj / söküm → 0,7 ekip-gün (günlük kapasitenin %70'i)" };
  return { gun: null, kural: null, gerekce: "Kapsam süre kurallarından birine uymuyor — süreyi girin" };
}

module.exports = { montajDurumu, cleanupBekliyor, kapsamRengi, kalemAnten, isSuresi, standaloneMi, YARDIMCI_RX };
