// ═══ İŞ AVANSI — ÖDEME SINIFI + PERSONEL ÖDEME ÖZETİ (03.11.2026, Orhan) ═══════════════════════════════════════════
// Tek hesap kaynağı: liste satırına eklenen alanlar (web "Personel Avans Özeti" bunları toplar) ve Excel özet sayfası
// aynı fonksiyonları kullanır. Durum adı tahmini yoktur: ERC ve Teknocenter onay zincirleri durum alanını AYNI anlamda tutar
// (teknoOnay.DURUM.avans): TALEP → ROLLOUT_MUDUR_ONAY → PM_ONAY (onay sürecinde) → DIREKTOR_ONAY (tüm onaylar tamam, ödeme
// bekler) → TAMAMLANDI (ödendi). Ödeme uçları güncellemeyi "WHERE durum = DIREKTOR_ONAY" ile yapar → çift ödeme olmaz.
//   HAZIR   : DIREKTOR_ONAY — gerekli bütün onaylar tamam, ödeme bekliyor ("Şimdi yatırılacak")
//   ONAY    : TALEP / ROLLOUT_MUDUR_ONAY / PM_ONAY — onay zinciri sürüyor; şimdi ödenemez
//   ODENDI  : TAMAMLANDI
//   HARIC   : REDDEDILDI, taslak / bilinmeyen durum — ödeme ihtiyacına girmez
// Kalan: ödeme modülü kısmi ödeme yazmaz; is_avans_talep.odenen_tutar varsa (mutabakat kuralıyla aynı) tutar − ödenen.
// Yeniden gönderilen talep TEK satırdır (turlar is_avans_tur'da) → eski onay turu ikinci kez sayılmaz.
// Para birimi: talepte para birimi alanı yok → TRY; farklı para birimi gelirse ayrı toplanır, kurla birleştirilmez.
// Kişi: paranın üzerine yazıldığı personel (personel_id, kalıcı kimlik); personel seçilmemiş talepte talep eden (e-posta).

const ONAY_DURUMLARI = ["TALEP", "ROLLOUT_MUDUR_ONAY", "PM_ONAY"];
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

function odemeSinifi(t) {
  const d = String(t?.durum || "").toUpperCase();
  if (d === "DIREKTOR_ONAY") return "HAZIR";
  if (ONAY_DURUMLARI.includes(d)) return "ONAY";
  if (d === "TAMAMLANDI") return "ODENDI";
  return "HARIC";
}
function kalanTutar(t) {
  const s = odemeSinifi(t);
  if (s !== "HAZIR" && s !== "ONAY") return 0;
  const tutar = Number(t.tutar || 0), odenen = Math.min(tutar, Math.max(0, Number(t.odenen_tutar || 0)));
  return r2(tutar - odenen);
}
function kisiAnahtari(t) {
  if (t?.personel_id !== null && t?.personel_id !== undefined && String(t.personel_id) !== "") return `P:${t.personel_id}`;
  const e = String(t?.talep_eden_email || "").toLowerCase().trim();
  return e ? `E:${e}` : `T:${t?.id}`;
}
// Liste satırına eklenen alanlar (sunucu tek kaynak)
function satiraEkle(t) {
  return { ...t, odeme_sinifi: odemeSinifi(t), kalan_tutar: kalanTutar(t), para_birimi: t.para_birimi || "TRY", kisi_anahtari: kisiAnahtari(t),
    kisi_ad: t.personel_ad || t.talep_eden_ad || t.talep_eden_email || null };
}
// Özet: satırlar zaten filtrelenmiş olmalı. Kimliğe göre tekilleştirilir. Para birimi başına { tutar, adet, ids }.
function ozetle(satirlar) {
  const tekil = new Map(); for (const t of satirlar || []) if (!tekil.has(t.id)) tekil.set(t.id, t);
  const bos = () => ({});
  const ekle = (hedef, pb, tutar, id) => { const x = hedef[pb] || (hedef[pb] = { tutar: 0, adet: 0, ids: [] }); x.tutar = r2(x.tutar + tutar); x.adet += 1; x.ids.push(id); };
  const genel = { hazir: bos(), onay: bos(), toplam: bos(), odenen: bos() };
  const kisiler = new Map();
  for (const t0 of tekil.values()) {
    const t = t0.odeme_sinifi ? t0 : satiraEkle(t0);
    const pb = t.para_birimi || "TRY";
    const k = kisiler.get(t.kisi_anahtari) || { anahtar: t.kisi_anahtari, ad: t.kisi_ad, personel_id: t.personel_id ?? null, hazir: bos(), onay: bos(), toplam: bos(), odenen: bos(), kayit: 0 };
    k.kayit += 1;
    for (const hedef of [genel, k]) {
      if (t.odeme_sinifi === "HAZIR") { ekle(hedef.hazir, pb, t.kalan_tutar, t.id); ekle(hedef.toplam, pb, t.kalan_tutar, t.id); }
      else if (t.odeme_sinifi === "ONAY") { ekle(hedef.onay, pb, t.kalan_tutar, t.id); ekle(hedef.toplam, pb, t.kalan_tutar, t.id); }
      else if (t.odeme_sinifi === "ODENDI") ekle(hedef.odenen, pb, Number(t.tutar || 0), t.id);
    }
    kisiler.set(t.kisi_anahtari, k);
  }
  return { ...genel, kayit: tekil.size, kisi_sayisi: kisiler.size, kisiler: [...kisiler.values()].sort((a, b) => String(a.ad || "").localeCompare(String(b.ad || ""), "tr")) };
}

module.exports = { ONAY_DURUMLARI, odemeSinifi, kalanTutar, kisiAnahtari, satiraEkle, ozetle };
