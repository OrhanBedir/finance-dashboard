// ═══ TAŞERON MOBİL "HAKEDİŞ VE CARİ" (05.11.2026, Orhan — TEKNO_EMRAH firma sorumlusu) ═══════════════════════════════
// Taşeron firma sorumlusu kendi firmasının yapılan iş bedelini, ödemelerini, açık avansını ve net carisini görür.
// AYRI hesap YOKTUR: yönetimin "Taşeron ve Tedarikçi Carileri" ekranıyla aynı motor (tedarikciCari.cariHesapla +
// hakedisIsleri) çağrılır; taşerona yalnız kendi firma kartının (users.taseron_id) satırı süzülerek verilir.
//   • Firma        : oturumdaki taşeron kaydı (omnixProfil.taseronKapsami) — istemciden firma parametresi ALINMAZ
//   • Ana firma    : subcons.ana_firma (TEKNO …) alt marka ise o firmanın carisi, değilse Şimşek carisi
//   • İş bedeli    : fiziki tamamlanan miktar × İŞ TARİHİNDEKİ taşeron fiyatı (montaj başlangıcı → ilk iş girişi → bitiş);
//                    fiyatı bulunamayan kalem sıfır sayılmaz, "Fiyat doğrulanamadı" olarak listelenir (borca girmez)
//   • Ödemeler     : taseron_odeme_log (+ bağlı marka satırı tek hareket) — mahsup nakit değildir, toplam ödemeye girmez
//   • Net          : motorun P.net değeri (kalan − açık avans/alacak); istemci yeniden hesaplamaz
// Gizlilik: Huawei PO / BoQ satış fiyatı, ana firma marjı, başka taşeronun kaydı, maaş YOK. Çalışan (CALISAN) hesabı bu
// uçlara giremez (taseronSaha.calisanKapisi). Montaj bildirimi QC / hakediş / ödeme yazmaz; bu uçlar yalnız okur.
"use strict";
const { qcEsasliOzet } = require("./tedarikciCari");

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const bugunTR = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const TUR_AD = { AVANS: "Avans", FATURA_ODEME: "Ödeme", MAHSUP: "Mahsup", FATURA_GIRISI: "Ödeme (fatura girişinden)" };
const FIYAT_DURUM_AD = { VAR: "Fiyat doğrulandı", PAKET: "Paket bedeline dahil", TANIMSIZ: "Fiyat doğrulanamadı", BELIRSIZ: "Fiyat belirsiz — aynı tarihte iki fiyat" };

// Net bakiyenin yönü taşeron açısından
function yon(net) {
  if (net > 0.009) return { kod: "ODENECEK", metin: "Firmanıza ödenecek" };
  if (net < -0.009) return { kod: "AVANS", metin: "Firmanızın açık avansı" };
  return { kod: "DENK", metin: "Hesap denk" };
}

function kur(app, { pool, authMiddleware, taseronKapsami, cariMotor, altMarkaMi }) {
  const hata = (res, kod, mesaj) => res.status(kod).json({ ok: false, error: mesaj });

  // Taşeron hesabı → firma kartı + ana firma kodu (cari motoru firması)
  async function kimlik(req) {
    const k = await taseronKapsami(req);
    if (k.kod) throw Object.assign(new Error(k.mesaj), { durum: k.kod });
    const ana = String(k.taseron.ana_firma || "").trim().toUpperCase();
    return { k, M: ana && altMarkaMi(ana) ? ana : "SIMSEK", id: Number(k.taseron.id) };
  }

  // Motor çıktısından bu firmanın cari satırı + iş listesi (yönetim ekranıyla aynı çağrılar)
  async function cariOku(K) {
    const v = await cariMotor.cariHesapla(pool, K.M);
    const c0 = v.cari.get(`id:${K.id}`) || v.bul(`id:${K.id}`);
    const s = v.R.byId.get(K.id);
    const isler = c0 && c0.cari_modeli === "HAKEDIS" && K.M !== "SIMSEK" && s ? await cariMotor.hakedisIsleri(pool, K.M, s, bugunTR()) : [];
    return { c0, s, isler };
  }

  // Hakediş satırları: fiziki ve plan miktarı ayrı, uygulanan tarife ve uyarılarla. Montaj / QC ayrı bilgi.
  async function hakedisSatirlari(isler) {
    const kodlar = [...new Set(isler.map((x) => x.site_code))];
    const rp = kodlar.length ? (await pool.query(`SELECT DISTINCT ON (UPPER(TRIM(site_code))) UPPER(TRIM(site_code)) AS kod, bolge, to_jsonb(rp)->>'il' AS il,
        to_char(installation_actual_start_date,'YYYY-MM-DD') AS mbas, to_char(installation_actual_end_date,'YYYY-MM-DD') AS mbit,
        UPPER(TRIM(COALESCE(qc_durum,''))) AS qc, to_char(qc_closed_date,'YYYY-MM-DD') AS qck
      FROM rollout_progress rp WHERE UPPER(TRIM(site_code)) = ANY($1::text[]) ORDER BY UPPER(TRIM(site_code)), updated_at DESC NULLS LAST`, [kodlar]).catch(() => ({ rows: [] }))).rows : [];
    const R = new Map(rp.map((x) => [x.kod, x]));
    return isler.map((x) => {
      const r = R.get(x.site_code) || {};
      const f = x.fiyat;
      const bedel = f && x.fiziki_qty > 0 ? cariMotor.kalemDeger(x, x.fiziki_qty) : null;
      const uyarilar = [];
      if (x.fiyat_durum === "TANIMSIZ" && x.fiziki_qty > 0) uyarilar.push("Fiyat doğrulanamadı — bedel borca eklenmedi");
      if (x.fiyat_durum === "BELIRSIZ") uyarilar.push("Aynı tarihte iki farklı fiyat var — Teknocenter netleştirecek");
      if (x.pr_qty > 0 && !(x.fiziki_qty > 0)) uyarilar.push("Fiziki miktar girilmemiş — bedel oluşmadı");
      if (x.is_tarihi_kaynak !== "montaj başlangıcı") uyarilar.push(`Montaj başlangıcı kayıtlı değil — tarife ${x.is_tarihi_kaynak} tarihine göre seçildi`);
      const montaj = r.mbit ? "TAMAMLANDI" : r.mbas ? "DEVAM" : "BEKLIYOR";
      return {
        master_works_id: x.master_works_id, fiziksel_id: x.fiziksel_id, site_code: x.site_code, il: r.il || null, bolge: r.bolge || null,
        item_code: x.item_code || null, aciklama: x.aciklama, paket: f?.paket ? `${f.paket.ad} paket` : x.paket_dahil ? `${x.paket_dahil.ad} paketine dahil` : null,
        is_tarihi: x.is_tarihi, is_tarihi_kaynak: x.is_tarihi_kaynak,
        tarife: f ? { baslangic: f.bas, kapsam: f.ozel ? "Firmanıza özel fiyat" : "Teknocenter taşeron tarifesi", birim: f.birim || null } : null,
        pr_miktar: x.pr_qty, fiziki_miktar: x.fiziki_qty,
        birim_bedel: f ? (f.paket ? f.paket.bedel : f.fiyat) : null, birim_bedel_turu: f?.paket ? "Paket (iş kodu başına)" : f ? "Birim" : null,
        bedel, para_birimi: f?.pb || "TRY", kdv: "KDV hariç",
        fiyat_durum: x.fiyat_durum, fiyat_durum_ad: FIYAT_DURUM_AD[x.fiyat_durum] || x.fiyat_durum,
        montaj: { durum: montaj, baslangic: r.mbas || null, bitis: r.mbit || null },
        qc: { kalem: x.qc || null, saha: r.qc || null, kapanis: r.qck || null },
        uyarilar,
      };
    });
  }

  // Ödeme / avans / mahsup hareketleri. Bir gerçek ödeme = bir satır (bağlı marka satırı motor tarafından tekilleşir).
  const hareketGorunum = (h) => ({
    id: `${h.kaynak}-${h.id}`, no: h.no, tarih: h.tarih, tutar: h.tutar, para_birimi: h.pb,
    tur: h.durum !== "AKTIF" ? "IPTAL" : h.islem_turu === "MAHSUP" ? "MAHSUP" : h.tur,
    tur_ad: h.durum !== "AKTIF" ? "İptal edildi (ters kayıt)" : TUR_AD[h.islem_turu === "MAHSUP" ? "MAHSUP" : h.tur] || h.tur,
    nakit: h.durum === "AKTIF" && h.islem_turu !== "MAHSUP",
    aciklama: h.aciklama || null, dagilim: (h.dagilim || []).map((d) => ({ fatura_no: d.fatura_no, tutar: d.odeme })),
    iptal_neden: h.durum !== "AKTIF" ? h.iptal_neden || null : null, belge_var: !!h.dekont_url,
  });

  // Kronolojik cari ekstre (yönetim Excel ekstresiyle aynı kural): borç = iş bedeli / fatura, alacak = ödeme / iade
  function ekstre(c0, pb) {
    const ol = [];
    for (const f of c0.faturalar.filter((x) => x.pb === pb)) ol.push({ tarih: f.fatura_tarihi || f.giris_tarihi, s: 0, islem: f.tur === "GELEN" ? "Fatura" : "İade faturası", no: f.fatura_no, borc: f.tur === "GELEN" ? f.toplam : 0, alacak: f.tur === "GELEN" ? 0 : f.toplam, aciklama: "KDV dahil" });
    for (const h of (c0.is_bedeli || []).filter((x) => x.pb === pb)) ol.push({ tarih: h.tarih, s: 0, islem: "Yapılan iş", no: h.site_code, borc: h.tutar, alacak: 0,
      aciklama: `${h.item_code || ""} ${h.paket ? `${h.paket} paket` : `${h.miktar} adet`} · KDV hariç · iş tarihi: ${h.tarih_kaynak}`.trim() });
    for (const h of c0.hareketler.filter((x) => x.pb === pb && x.durum === "AKTIF")) {
      if (h.islem_turu === "MAHSUP") ol.push({ tarih: h.tarih, s: 1, islem: "Mahsup (nakit değil)", no: h.no, borc: 0, alacak: 0, aciklama: (h.dagilim || []).map((d) => d.fatura_no).join(", ") });
      else ol.push({ tarih: h.tarih, s: 1, islem: TUR_AD[h.tur] || h.tur, no: h.no, borc: 0, alacak: h.tutar, aciklama: h.aciklama || "" });
    }
    ol.sort((a, b) => String(a.tarih).localeCompare(String(b.tarih)) || a.s - b.s);
    let bakiye = 0;
    return ol.map(({ s, ...o }) => { bakiye = r2(bakiye + o.borc - o.alacak); return { ...o, bakiye }; });
  }

  const kapi = (fn) => [authMiddleware, async (req, res) => {
    try { await fn(req, res, await kimlik(req)); }
    catch (e) { if (e.durum) return hata(res, e.durum, e.message); console.error("[taşeron cari]", e.message); hata(res, 500, "Cari bilgisi alınamadı. Lütfen tekrar deneyin."); }
  }];

  // İş kodu → Rollout QC (OK / NOK / boş) — QC esaslı hakedişte kalem QC'si ile çelişki kontrolü için
  async function rolloutQc(kodlar) {
    if (!kodlar.length) return new Map();
    const r = (await pool.query(`SELECT DISTINCT ON (UPPER(TRIM(site_code))) UPPER(TRIM(site_code)) AS kod, NULLIF(UPPER(TRIM(COALESCE(qc_durum,''))),'') AS qc
      FROM rollout_progress WHERE UPPER(TRIM(site_code)) = ANY($1::text[]) ORDER BY UPPER(TRIM(site_code)), updated_at DESC NULLS LAST`, [kodlar]).catch(() => ({ rows: [] }))).rows;
    return new Map(r.map((x) => [x.kod, x.qc]));
  }
  const QC_DURUM_AD = { QC_OK: "QC kapanmış — hak edildi", QC_BEKLIYOR: "Montaj yapıldı — QC bekliyor", TEYIT: "QC teyit bekliyor (kalem ve iş QC'si çelişkili)",
    PLAN: "Planlı — fiziki iş yok", PAKET: "Paket bedeline dahil", FIYATSIZ: "Fiyat doğrulanamadı" };

  app.get("/taseron-panel/cari", ...kapi(async (req, res, K) => {
    const { c0, isler } = await cariOku(K);
    res.set("Cache-Control", "private, no-store");
    if (!c0) return res.json({ ok: true, firma: { id: K.id, ad: K.k.taseron.unvan || K.k.taseron.subcon_name }, kart_yok: true, guncel: new Date().toISOString(),
      mesaj: "Firmanızın cari kartı henüz tanımlanmamış. Teknocenter muhasebesiyle görüşün." });
    const satirlar = await hakedisSatirlari(isler);
    const pbler = Object.keys(c0.pb).length ? Object.keys(c0.pb) : ["TRY"];
    const ozet = pbler.map((pb) => {
      const P = c0.pb[pb] || {};
      const plan = r2(isler.filter((x) => (x.fiyat?.pb || "TRY") === pb).reduce((t, x) => t + cariMotor.kalemDeger(x, x.pr_qty), 0));
      const net = r2(P.net || 0);
      return { para_birimi: pb, is_bedeli: r2(P.hakedis || 0), plan_bedeli: plan, odenen: r2(P.nakit || 0), hakedis_mahsup: r2(P.hakedis_mahsup || 0),
        hakedis_kalan: r2(P.hakedis_kalan || 0), fatura_toplam: r2(P.gecerli || 0), fatura_kalan: r2((P.kalan || 0) - (P.hakedis_kalan || 0)),
        kalan_alacak: r2(P.kalan || 0), acik_avans: r2(P.avans_acik || 0), iade_alacak: r2((P.iade_alacak || 0) + (P.fazla_odeme || 0)), net, yon: yon(net) };
    });
    const fiyatsiz = satirlar.filter((x) => x.fiziki_miktar > 0 && ["TANIMSIZ", "BELIRSIZ"].includes(x.fiyat_durum));
    // 06.11.2026 QC ESASLI HAKEDİŞ (ortak kaynak: tedarikciCari.qcEsasliOzet) — yalnız TRY hakediş esaslı caride; muhasebe carisi ayrı kalır
    const P0 = c0.pb.TRY || {};
    const qcRp = await rolloutQc([...new Set(isler.map((x) => x.site_code))]);
    const qce = c0.cari_modeli === "HAKEDIS" ? qcEsasliOzet(isler.filter((x) => (x.fiyat?.pb || "TRY") === "TRY"), qcRp, cariMotor.kalemDeger, r2(P0.nakit || 0)) : null;
    const qcSatir = new Map((qce?.satirlar || []).map((x) => [x.master_works_id, x]));
    for (const h of satirlar) { const q = qcSatir.get(h.master_works_id); if (q) { h.hakedis_durum = q.durum; h.hakedis_durum_ad = QC_DURUM_AD[q.durum]; } }
    const qc_esasli = qce ? { para_birimi: "TRY", ...Object.fromEntries(Object.entries(qce).filter(([k]) => k !== "satirlar")), yon: yon(qce.net),
      mutabakat: { muhasebe_is_bedeli: r2(P0.hakedis || 0), qc_hakedis: qce.qc_kapanmis, fark: r2((P0.hakedis || 0) - qce.qc_kapanmis),
        aciklama: "Muhasebe carisi borcu fiziki yapılan iş üzerinden tutar; QC esaslı hakediş yalnız QC'si kapanmış kalemleri sayar. Fark = montajı yapılmış QC bekleyen + teyit bekleyen işler.",
        muhasebe_net: r2(P0.net || 0), muhasebe_yon: yon(r2(P0.net || 0)) } } : null;
    res.json({
      ok: true, guncel: new Date().toISOString(),
      firma: { id: K.id, ad: K.k.taseron.unvan || c0.ad, model: c0.cari_modeli, model_ad: c0.cari_modeli === "HAKEDIS" ? "Hakediş esaslı cari (fatura zorunlu değil)" : "Faturalı cari" },
      donem: { ad: "Tüm dönem", baslangic: [...isler.map((x) => x.is_tarihi), ...c0.hareketler.map((h) => h.tarih)].filter(Boolean).sort()[0] || null, bitis: bugunTR() },
      kural: {
        is_bedeli: "Yapılan iş bedeli = fiziki tamamlanan miktar × iş tarihindeki taşeron fiyatı (KDV hariç). İş tarihi: montaj başlangıcı; yoksa ilk iş girişi; o da yoksa montaj bitişi.",
        tarife: "01.11.2026 ve sonrasında başlayan işler 01.11.2026 tarifesiyle; öncesi önceki anlaşmayla fiyatlanır. Eski işler yeni tarifeyle yeniden fiyatlanmaz.",
        qc: "Hak edilmiş bedel yalnız QC'si kapanmış (OK) iş kalemleridir. Montajı yapılmış ama QC'si kapanmamış iş 'QC bekleyen' olarak ayrı gösterilir. Aynı sahada başka iş ya da başka firmanın QC'si bu işi hakedişe almaz.",
        vergi: "İş bedeli ve hakediş KDV hariçtir. Ödemeler banka çıkışı tutarıdır (KDV ayrımı kayıtlı değil); faturalar KDV dahildir. Ödemeler, avans, mahsup ve iptaller muhasebe carisiyle aynı kayıtlardan gelir; QC esaslı net, ödemenin QC'si kapanmış hakedişe uygulanmasıyla bulunur.",
      },
      ozet, qc_esasli, satir_ozet: { toplam: satirlar.length, is_kodu: new Set(satirlar.map((x) => x.site_code)).size, fiziksel_saha: new Set(satirlar.map((x) => x.fiziksel_id)).size,
        fiyatsiz: fiyatsiz.length, paket_dahil: satirlar.filter((x) => x.fiyat_durum === "PAKET").length },
      hakedisler: satirlar,
      odemeler: c0.hareketler.map(hareketGorunum),
      hareketler: pbler.map((pb) => ({ para_birimi: pb, satirlar: ekstre(c0, pb) })),
      faturalar: c0.faturalar.map((f) => ({ id: f.id, fatura_no: f.fatura_no, tarih: f.fatura_tarihi, tur: f.tur === "GELEN" ? "Fatura" : "İade", toplam: f.toplam, odenen: f.odenen, acik: f.acik, para_birimi: f.pb, kdv: "KDV dahil" })),
      uyarilar: c0.uyarilar.filter((u) => ["FIYAT_TANIMSIZ", "AVANS_EKSI"].includes(u.tip)).map((u) => u.mesaj),
      fatura_bos_mesaj: c0.faturalar.length ? null : "Henüz fatura kaydı yok; hakediş ve ödemelerinizi diğer sekmelerden görebilirsiniz.",
    });
  }));

  // ── ATANAN İŞ BEDELLERİ (06.11.2026) — planlanan sözleşme bedeli (PR miktarı × iş tarihindeki taşeron fiyatı). Hak edilmiş alacak DEĞİL.
  // Fiziksel saha → tam iş kodu → kalem; paket ana kalemi bedeli taşır, pakete dahil kalemler bedelsiz (çift ücret yok). Yalnız firma sahibi.
  app.get("/taseron-panel/atanan-bedeller", ...kapi(async (req, res, K) => {
    const { c0, isler } = await cariOku(K);
    res.set("Cache-Control", "private, no-store");
    const tarih = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
    const bas = tarih(req.query.bas), bit = tarih(req.query.bit);
    const L = isler.filter((x) => x.pr_qty > 0 && (!bas || String(x.is_tarihi) >= bas) && (!bit || String(x.is_tarihi) <= bit));
    const sahalar = new Map();
    let toplam = 0, fiyatsiz = 0;
    for (const x of L) {
      const fid = x.fiziksel_id;
      const S = sahalar.get(fid) || { fiziksel_id: fid, isler: new Map(), ara_toplam: 0 };
      const I = S.isler.get(x.site_code) || { site_code: x.site_code, is_tarihi: x.is_tarihi, is_tarihi_kaynak: x.is_tarihi_kaynak, kalemler: [], toplam: 0, fiyat_eksik: false };
      const f = x.fiyat;
      const bedel = f ? cariMotor.kalemDeger(x, x.pr_qty) : null;
      if (!f && x.fiyat_durum !== "PAKET") { I.fiyat_eksik = true; fiyatsiz++; }
      I.kalemler.push({ item_code: x.item_code || null, aciklama: x.aciklama, miktar: x.pr_qty, birim: f?.birim || null,
        birim_bedel: f ? (f.paket ? f.paket.bedel : f.fiyat) : null, bedel_turu: f?.paket ? `${f.paket.ad} paket (iş kodu başına)` : f ? "Birim" : x.fiyat_durum === "PAKET" ? "Paket bedeline dahil" : "Fiyat belirlenemedi",
        bedel, tarife: f ? { baslangic: f.bas, kapsam: f.ozel ? "Firmanıza özel fiyat" : "Teknocenter taşeron tarifesi" } : null });
      if (bedel) { I.toplam = r2(I.toplam + bedel); S.ara_toplam = r2(S.ara_toplam + bedel); toplam = r2(toplam + bedel); }
      S.isler.set(x.site_code, I); sahalar.set(fid, S);
    }
    const liste = [...sahalar.values()].sort((a, b) => a.fiziksel_id.localeCompare(b.fiziksel_id)).map((S) => ({ ...S, isler: [...S.isler.values()].sort((a, b) => a.site_code.localeCompare(b.site_code)) }));
    res.json({ ok: true, baslik: "Planlanan iş bedeli — henüz hak edilmiş alacak değildir", firma: { id: K.id, ad: K.k.taseron.unvan || c0?.ad || K.k.taseron.subcon_name },
      donem: { bas, bit }, para_birimi: "TRY", kdv: "KDV hariç", toplam, fiziksel_saha: liste.length, is_kaydi: liste.reduce((t, S) => t + S.isler.length, 0),
      fiyatsiz_kalem: fiyatsiz, sahalar: liste,
      kural: "Bedel = PR (atanan) miktarı × iş tarihindeki taşeron işçilik fiyatı (KDV hariç, malzeme hariç). İş tarihi: montaj başlangıcı → ilk iş girişi → montaj bitişi. Fiyatı belirlenemeyen kalem toplama girmez." });
  }));

  // Ödeme dekontu: yalnız bu firmanın aktif / iptal hareketi ise; adres listede verilmez
  app.get("/taseron-panel/cari/odeme/:id/belge", ...kapi(async (req, res, K) => {
    const id = String(req.params.id || "");
    const { c0 } = await cariOku(K);
    const h = c0 && c0.hareketler.find((x) => `${x.kaynak}-${x.id}` === id);
    if (!h || !h.dekont_url) return hata(res, 404, "Belge bulunamadı");
    res.set("Cache-Control", "private, no-store");
    res.json({ ok: true, url: h.dekont_url, etiket: `${h.no} dekontu` });
  }));

  return { cariOku };
}

module.exports = { kur, yon };
