// ═══ PLAN YAP · 3. ADIM SİTE ID / İŞ KODU ARAMASI (02.11.2026, Orhan) ═══════════════════════════════════════════════
// Saf fonksiyonlar (DB yok). Kaynak: haritaVerisi (sunucuda ZORUNLU Teknocenter kapsamı) — ekranda yüklü liste değil.
// Eşleşme: fiziksel Site ID ya da tam iş kodu aranan metinle BAŞLAR; 3+ karakterde iş kodu içinde geçen de gelir (sonra sıralanır).
// Büyük/küçük harf ve Türkçe karakter: tr-TR büyük harf + İ/ı → I (Site ID'ler ASCII). Boşluklar yok sayılır.
// Sonuç saha bazında gruplanır; aynı Site ID altındaki her iş ayrı satırdır (saha seçmek işleri seçmez — istemci kararı).
// Plan adayı olmayan iş (fiilen tamamlanmış, ana montajı başka firmada) gizlenmez; nedeniyle döner, seçilemez.
"use strict";

const normal = (v) => String(v || "").replace(/\s+/g, "").toLocaleUpperCase("tr-TR").replace(/İ/g, "I").replace(/ı/g, "I");

// İş plan adayı mı? (Rollout haritasındaki Plan Yap aday kuralıyla aynı)
function planAdayDurumu(i) {
  if (i.planlanabilir === false || i.montaj?.kod === "BASKA_FIRMA") return { uygun: false, neden: "Ana montaj başka firmada — Teknocenter ekibine planlanamaz" };
  if (i.fiili?.kod === "TAMAMLANDI") return { uygun: false, neden: "Fiziksel montaj tamamlanmış — plan adayı değil" };
  if (["TAMAM_QC_OK", "TAMAM_QC_BEKLIYOR"].includes(i.montaj?.kod)) return { uygun: false, neden: "Montaj tamamlanmış — plan adayı değil" };
  return { uygun: true, neden: null };
}

// sahalar: haritaVerisi().sahalar → { sahalar: [...], toplam_saha, toplam_is, kalan_saha }
function planAra(sahalar, q, { offset = 0, limit = 15 } = {}) {
  const n = normal(q);
  if (n.length < 2) return { sahalar: [], toplam_saha: 0, toplam_is: 0, kalan_saha: 0, kisa: true };
  const eslesen = [];
  for (const s of sahalar || []) {
    const fid = normal(s.fiziksel_id);
    const sahaBas = fid.startsWith(n);
    const isler = (s.isler || []).map((i) => {
      const kod = normal(i.site_code);
      const puan = kod.startsWith(n) ? 0 : sahaBas ? 1 : n.length >= 3 && kod.includes(n) ? 2 : null;
      return puan === null ? null : { i, puan };
    }).filter(Boolean);
    if (!isler.length) continue;
    eslesen.push({ s, isler, puan: Math.min(...isler.map((x) => x.puan)) });
  }
  eslesen.sort((a, b) => a.puan - b.puan || String(a.s.fiziksel_id).localeCompare(String(b.s.fiziksel_id)));
  const bas = Math.max(0, Number(offset) || 0), adet = Math.min(Math.max(1, Number(limit) || 15), 50);
  const sayfa = eslesen.slice(bas, bas + adet).map(({ s, isler }) => ({
    fiziksel_id: s.fiziksel_id, bolge: s.operasyon_bolgesi || s.bolge || "", il: s.il || s.yaklasik?.il || "",
    konum: s.konum ? { lat: s.konum.lat, lng: s.konum.lng, dogruluk: s.konum.dogruluk } : null,
    isler: isler.sort((a, b) => a.puan - b.puan || String(a.i.site_code).localeCompare(String(b.i.site_code)))
      .map(({ i }) => ({ ...i, plan_aday: planAdayDurumu(i) })),
  }));
  return { sahalar: sayfa, toplam_saha: eslesen.length, toplam_is: eslesen.reduce((t, x) => t + x.isler.length, 0), kalan_saha: Math.max(0, eslesen.length - bas - sayfa.length) };
}

module.exports = { planAra, planAdayDurumu, normal };
