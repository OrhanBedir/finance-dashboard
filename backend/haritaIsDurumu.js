// ═══ HARİTA İŞ YILI / DURUMU (28.10.2026, Orhan — "Teknocenter · 2026" görünümü) ═══════════════════════════════════
// Amaç: 2026'ya ait ATANMIŞ, DEVAM EDEN ve TAMAMLANAN işlerin hepsini göstermek (yalnız bitmiş sahalar değil).
// Kaynaklar ve öncelik (yalnız açıkça yazılmış tarih / sürüm; kayıt oluşturma, Excel yükleme, TSSR tarihi KULLANILMAZ):
//   1) Gerçekleşme   — Rollout iş kolu bitiş alanları (*_actual_end_date, *_finished_date, onair_date, qc_closed_date,
//                      tamamlanma_tarihi) + Günlük İş Girişi kaleminin on-air tarihi + iş atamasının bitişi (TAMAMLANDI)
//   2) Başlama       — Rollout *_actual_start_date / *_started_date + iş atamasının başlaması (BASLADI / ARA_VERILDI)
//   3) Atama / plan  — iş ataması plan tarihi (ATANDI) + Rollout plan tarihleri (*_plan_start_date, *_plan_date, plan_start_date)
//   4) İş yılı       — Günlük İş Girişi kaleminde seçilmiş BoQ sürümü BOQ2026 (sözleşme dönemi; tarih yoksa)
// Durum (yalnız seçilen yılın tarihleriyle): TAMAMLANDI > DEVAM_EDIYOR > ATANDI > KAYITLI (yalnız BoQ 2026).
// Seçilen yılda hiç kaynak yoksa: başka yılda tarih varsa DIGER_YIL, hiç kaynak yoksa YIL_DOGRULANAMADI (sessizce 2026 sayılmaz).
"use strict";

const TAMAM_RX = /(_actual_end_date|_finished_date)$|^(onair_date|qc_closed_date|tamamlanma_tarihi)$/;
const BASLA_RX = /(_actual_start_date|_started_date)$/;
const PLAN_RX = /(_plan_start_date|_plan_date)$|^(plan_start_date|inst_plan_start_date)$/;

const ALAN_AD = {
  installation_actual_start_date: "Kurulum başlangıç", installation_actual_end_date: "Kurulum bitiş", onair_date: "On-air", qc_closed_date: "QC kapanış",
  rf_started_date: "RF başlangıç", rf_finished_date: "RF bitiş", plan_start_date: "Plan başlangıç", inst_plan_start_date: "Kurulum planı",
  tamamlanma_tarihi: "Tamamlanma", asbuilt_finished_date: "As-built bitiş", enh_actual_end_date: "ENH bitiş", enh_plan_start_date: "ENH plan",
  tssr_actual_end_date: "TSSR bitiş", tssr_plan_start_date: "TSSR plan", btk_actual_end_date: "BTK bitiş", btk_plan_start_date: "BTK plan",
  trs_actual_end_date: "TRS bitiş", trs_plan_start_date: "TRS plan", los_actual_end_date: "LOS bitiş", los_plan_date: "LOS plan",
  tss_actual_end_date: "TSS bitiş", tss_plan_start_date: "TSS plan", power_actual_end_date: "Power bitiş", power_plan_start_date: "Power plan",
  emr_actual_end_date: "EMR bitiş", emr_plan_start_date: "EMR plan", pac_actual_end_date: "PAC bitiş", pac_plan_date: "PAC plan",
  ysb_actual_end_date: "YSB bitiş", ysb_plan_start_date: "YSB plan",
};
const DURUM_AD = { TAMAMLANDI: "Tamamlandı", DEVAM_EDIYOR: "Devam ediyor", ATANDI: "Atandı / planlandı", KAYITLI: "2026 işi (BoQ 2026)",
  DIGER_YIL: "2026 dışı", YIL_DOGRULANAMADI: "İş yılı doğrulanamadı" };

const gun = (v) => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
  const t = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};

// Firma eşleştiricisine göre iş kolu sahipliği (taşeron alanı boş kol üst kolu izler) → firmanın kolları
function firmaKollari(row, alanlar, esle) {
  const sahip = {}; const kollar = new Set();
  for (const L of alanlar) {
    const v = String(row?.[L.subcon] || "").trim();
    const dolu = v && v !== "N/A" && v !== "__NA__";
    sahip[L.kolu] = dolu ? esle(v) : (L.ust ? sahip[L.ust] : false);
    if (sahip[L.kolu]) kollar.add(L.kolu);
  }
  return kollar;
}

// Tek iş kaydının (iş kodu) yıl durumu.
//  row       : rollout_progress satırı (maskeli olabilir) ya da null (yalnız Günlük İş Girişi kaydı)
//  alanlar   : ROLLOUT_IS_KOLU_ALANLARI
//  kollar    : yalnız bu iş kollarının tarihleri (Set) — null: tüm kollar
//  kalemler  : bu iş kodunun (kapsamdaki) Günlük İş Girişi kalemleri [{onair_date, boq_surum, item_code}]
//  atamalar  : bu iş kodunu içeren iş atamaları [{id, durum, plan_tarihi, baslama_ts, bitis_ts, kategori}]
function isDurumu({ row, alanlar, kollar = null, kalemler = [], atamalar = [], yil = "2026" }) {
  const kanit = []; // { tur: TAMAM|BASLA|PLAN|BOQ, tarih, kaynak }
  if (row) {
    for (const L of alanlar) {
      if (kollar && !kollar.has(L.kolu)) continue;
      for (const a of L.alanlar) {
        const t = gun(row[a]); if (!t) continue;
        const tur = TAMAM_RX.test(a) ? "TAMAM" : BASLA_RX.test(a) ? "BASLA" : PLAN_RX.test(a) ? "PLAN" : null;
        if (tur) kanit.push({ tur, tarih: t, kaynak: `Rollout · ${ALAN_AD[a] || a}` });
      }
    }
  }
  for (const k of kalemler || []) {
    const t = gun(k.onair_date);
    if (t) kanit.push({ tur: "TAMAM", tarih: t, kaynak: `Günlük İş Girişi · ${k.item_code || "kalem"} on-air` });
    if (String(k.boq_surum || "").toUpperCase() === `BOQ${yil}`) kanit.push({ tur: "BOQ", tarih: null, kaynak: `Günlük İş Girişi · ${k.item_code || "kalem"} BoQ ${yil}` });
  }
  for (const a of atamalar || []) {
    const d = String(a.durum || "").toUpperCase();
    if (d === "IPTAL") continue;
    const ad = `İş atama #${a.id}${a.kategori ? ` (${a.kategori})` : ""}`;
    if (d === "TAMAMLANDI" && gun(a.bitis_ts)) kanit.push({ tur: "TAMAM", tarih: gun(a.bitis_ts), kaynak: `${ad} bitiş` });
    if (gun(a.baslama_ts)) kanit.push({ tur: "BASLA", tarih: gun(a.baslama_ts), kaynak: `${ad} başlama` });
    if (gun(a.plan_tarihi)) kanit.push({ tur: "PLAN", tarih: gun(a.plan_tarihi), kaynak: `${ad} plan` });
  }
  const buYil = (k) => k.tarih && k.tarih.startsWith(`${yil}-`);
  const sec = (tur) => kanit.filter((k) => k.tur === tur && buYil(k)).sort((x, y) => y.tarih.localeCompare(x.tarih));
  let durum, dayanak;
  const tm = sec("TAMAM"), bs = sec("BASLA"), pl = sec("PLAN"), bq = kanit.filter((k) => k.tur === "BOQ");
  if (tm.length) { durum = "TAMAMLANDI"; dayanak = tm[0]; }
  else if (bs.length) { durum = "DEVAM_EDIYOR"; dayanak = bs[0]; }
  else if (pl.length) { durum = "ATANDI"; dayanak = pl[0]; }
  else if (bq.length) { durum = "KAYITLI"; dayanak = bq[0]; }
  else if (kanit.some((k) => k.tarih)) {
    durum = "DIGER_YIL";
    dayanak = kanit.filter((k) => k.tarih).sort((x, y) => y.tarih.localeCompare(x.tarih))[0];
  } else { durum = "YIL_DOGRULANAMADI"; dayanak = null; }
  const yillar = [...new Set(kanit.filter((k) => k.tarih).map((k) => k.tarih.slice(0, 4)))].sort();
  return { durum, durum_ad: DURUM_AD[durum], yil_ici: ["TAMAMLANDI", "DEVAM_EDIYOR", "ATANDI", "KAYITLI"].includes(durum),
    dayanak, yillar, kanit_sayisi: kanit.length };
}

module.exports = { isDurumu, firmaKollari, DURUM_AD, ALAN_AD, gun };
