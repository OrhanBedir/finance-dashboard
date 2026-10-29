// ═══ FİYATSIZ BÖLGE ANALİZİ ÖLÇÜLERİ (29.10.2026, Orhan onayı) ══════════════════════════════════════
// Fiyat görme yetkisi olmayan backofis kullanıcısının Bölge Analizi kartları, detay listeleri ve Excel'i
// bu tek modülden hesaplanır — kart, modal ve Excel aynı ölçüyü kullanır. Sunucu bu kullanıcıya birim
// fiyat / tutar alanı göndermez; burada para hesabı yoktur.
//
// KALEM = proje kodu + saha kodu + item code anahtarı (sunucudaki PO birleşimiyle aynı anahtar:
//   TRIM(project) | UPPER(TRIM(site)) | TRIM(item)). Aynı sahaya aynı kalem için girilmiş birden çok PR satırı
//   tek kalemde toplanır (PR miktarı = satırların toplamı); PO miktarları (requested / billed / due) sunucuda
//   zaten anahtar başına toplandığı için bir kez alınır → PR/PO birleşimi işi çoğaltmaz. Aynı item code farklı
//   sahalarda ayrı kalemdir. /dashboard/result satırı Rollout'a site koduyla bağlandığı için aynı PR satırı
//   birden çok kez gelebilir → önce master_works.id ile tekilleştirilir.
// Ölçüler yalnız PR miktarı > 0 olan kalemler üzerinden (iptal / PR'sız satır sayılmaz).
//   PO'lu miktar      = min(PR, PO)
//   Faturalanan       = HW PO satırındaki billed miktar (PR miktarını aşan kısım sayılmaz: min(billed, PR))
//   PO'lu faturasız   = max(min(PR, PO) − faturalanan, 0)   → kısmi faturalanan kalemin kalanı
//   PO açılmamış      = PO miktarı 0 (PO bekler) ya da PR > PO (eksik PO; açılmamış kısım PR − PO)
// Farklı birimler (adet, metre…) asla toplanmaz: miktarlar birim bazında ayrı listelenir.

const sayi = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const yuvarla = (n) => Math.round(n * 1000) / 1000;
export const BIRIMSIZ = "(birim yok)";

export function kalemAnahtari(r) {
  return `${String(r.project_code || "").trim()}|${String(r.site_code || "").trim().toUpperCase()}|${String(r.item_code || "").trim()}`;
}

// rows: /dashboard/result satırları; bolgeAl(site_code, project_code) → bölge adı
export function fiyatsizKalemler(rows, bolgeAl = () => "") {
  const goruldu = new Set();
  const kalemler = new Map();
  for (const r of rows || []) {
    if (r?.id != null) { if (goruldu.has(r.id)) continue; goruldu.add(r.id); }
    const k = kalemAnahtari(r);
    let x = kalemler.get(k);
    if (!x) {
      x = {
        anahtar: k, project_code: r.project_code || "", site_code: r.site_code || "", item_code: r.item_code || "",
        item_description: r.item_description || "", birim: String(r.birim || "").trim() || BIRIMSIZ,
        bolge: bolgeAl(r.site_code, r.project_code) || "", subcon_name: r.subcon_name || "",
        po_no: r.po_no_all || r.po_no || "", pr: 0, po: sayi(r.requested_qty), billed: sayi(r.billed_qty), due: sayi(r.due_qty),
        pr_satir: 0, qc_durum: r.qc_durum || "", kabul_durum: r.kabul_durum || "",
      };
      kalemler.set(k, x);
    }
    x.pr += sayi(r.done_qty);
    x.pr_satir += 1;
    if (!x.qc_durum && r.qc_durum) x.qc_durum = r.qc_durum;
  }
  const out = [];
  for (const x of kalemler.values()) {
    if (x.pr <= 0) continue;
    const pr = yuvarla(x.pr);
    const polu = Math.min(pr, x.po);
    const faturalanan = Math.min(x.billed, pr);
    const kalan = Math.max(polu - faturalanan, 0);
    let durum;
    if (x.po <= 0) durum = "PO YOK";
    else if (pr > x.po) durum = faturalanan >= polu ? "EKSİK PO · PO'lu kısım faturalandı" : "EKSİK PO";
    else if (faturalanan >= pr) durum = "FATURALANDI";
    else if (faturalanan > 0) durum = "KISMİ FATURALANDI";
    else durum = "FATURA BEKLİYOR";
    out.push({ ...x, pr, polu: yuvarla(polu), faturalanan: yuvarla(faturalanan), kalan: yuvarla(kalan),
      po_acilmamis: yuvarla(x.po <= 0 ? pr : Math.max(pr - x.po, 0)), durum });
  }
  return out;
}

function birimDokum(kalemler, alan) {
  const m = new Map();
  for (const k of kalemler) {
    const v = sayi(k[alan]);
    if (v <= 0) continue;
    m.set(k.birim, yuvarla((m.get(k.birim) || 0) + v));
  }
  return [...m.entries()].map(([birim, miktar]) => ({ birim, miktar })).sort((a, b) => b.miktar - a.miktar);
}

export const poAcikFaturasizMi = (k) => k.po > 0 && k.kalan > 0;
export const poAcilmamisMi = (k) => k.po_acilmamis > 0;
export const faturalanmamisMi = (k) => k.faturalanan < k.pr;

// Kart değerleri (genel özet ve bölge kartı aynı fonksiyon)
export function fiyatsizOzet(kalemler) {
  const tamamlanan = kalemler;
  const faturalanan = kalemler.filter((k) => k.faturalanan > 0);
  const tam = kalemler.filter((k) => k.faturalanan >= k.pr);
  const kismi = faturalanan.filter((k) => k.faturalanan < k.pr);
  const poAcikFaturasiz = kalemler.filter(poAcikFaturasizMi);
  const poAcilmamis = kalemler.filter(poAcilmamisMi);
  const faturalanmamis = kalemler.filter(faturalanmamisMi);
  const saha = (l) => new Set(l.map((k) => String(k.site_code || "").trim().toUpperCase())).size;
  return {
    tamamlanan: { kalem: tamamlanan.length, saha: saha(tamamlanan), pr_satir: tamamlanan.reduce((s, k) => s + k.pr_satir, 0), birimler: birimDokum(tamamlanan, "pr") },
    faturalanan: { kalem: faturalanan.length, tam: tam.length, kismi: kismi.length, birimler: birimDokum(faturalanan, "faturalanan") },
    // Oran: tam faturalanan kalem / PR'ı olan kalem. Tutar ağırlıklı DEĞİLDİR; payda 0 ise oran tanımsız (null).
    oran: { pay: tam.length, payda: tamamlanan.length, yuzde: tamamlanan.length ? (tam.length / tamamlanan.length) * 100 : null, kismi: kismi.length },
    faturalanmamis: { kalem: faturalanmamis.length, saha: saha(faturalanmamis) },
    poAcikFaturasiz: { kalem: poAcikFaturasiz.length, saha: saha(poAcikFaturasiz), birimler: birimDokum(poAcikFaturasiz, "kalan") },
    poAcilmamis: { kalem: poAcilmamis.length, saha: saha(poAcilmamis), birimler: birimDokum(poAcilmamis, "po_acilmamis") },
  };
}

// Detay listesi + Excel sütunları (ekran ve Excel aynı tanım)
export const LISTE_SUTUNLARI = {
  poAcikFaturasiz: [
    ["Bölge", "bolge"], ["Saha", "site_code"], ["İş Kodu (Proje)", "project_code"], ["Item Code", "item_code"],
    ["Açıklama", "item_description"], ["Birim", "birim"], ["PO No", "po_no"], ["PR Miktarı", "pr"], ["PO Miktarı", "po"],
    ["Faturalanan", "faturalanan"], ["Kalan (PO'lu, faturasız)", "kalan"], ["Durum", "durum"],
  ],
  poAcilmamis: [
    ["Bölge", "bolge"], ["Saha", "site_code"], ["İş Kodu (Proje)", "project_code"], ["Item Code", "item_code"],
    ["Açıklama", "item_description"], ["Birim", "birim"], ["PO No", "po_no"], ["PR Miktarı", "pr"], ["PO Miktarı", "po"],
    ["PO Açılmamış Miktar", "po_acilmamis"], ["Durum", "durum"],
  ],
  faturalanmamis: [
    ["Bölge", "bolge"], ["Saha", "site_code"], ["İş Kodu (Proje)", "project_code"], ["Item Code", "item_code"],
    ["Açıklama", "item_description"], ["Birim", "birim"], ["PO No", "po_no"], ["PR Miktarı", "pr"], ["PO Miktarı", "po"],
    ["Faturalanan", "faturalanan"], ["Durum", "durum"],
  ],
  faturalanan: [
    ["Bölge", "bolge"], ["Saha", "site_code"], ["İş Kodu (Proje)", "project_code"], ["Item Code", "item_code"],
    ["Açıklama", "item_description"], ["Birim", "birim"], ["PO No", "po_no"], ["PR Miktarı", "pr"], ["Faturalanan", "faturalanan"], ["Durum", "durum"],
  ],
  tamamlanan: [
    ["Bölge", "bolge"], ["Saha", "site_code"], ["İş Kodu (Proje)", "project_code"], ["Item Code", "item_code"],
    ["Açıklama", "item_description"], ["Birim", "birim"], ["PR Miktarı", "pr"], ["PR Satırı", "pr_satir"], ["PO Miktarı", "po"], ["Durum", "durum"],
  ],
};
const LISTE_SUZGEC = {
  poAcikFaturasiz: poAcikFaturasizMi, poAcilmamis: poAcilmamisMi, faturalanmamis: faturalanmamisMi,
  faturalanan: (k) => k.faturalanan > 0, tamamlanan: () => true,
};
export function fiyatsizListe(kalemler, tur) {
  const f = LISTE_SUZGEC[tur] || (() => false);
  return kalemler.filter(f).sort((a, b) => (a.bolge || "").localeCompare(b.bolge || "", "tr") || a.site_code.localeCompare(b.site_code) || a.item_code.localeCompare(b.item_code));
}
export function fiyatsizExcelSatirlari(kalemler, tur) {
  const sut = LISTE_SUTUNLARI[tur] || [];
  return [sut.map(([b]) => b), ...fiyatsizListe(kalemler, tur).map((k) => sut.map(([, a]) => k[a] ?? ""))];
}
