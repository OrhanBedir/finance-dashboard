// ═══ ATANAN İŞ TUTARI — ORTAK HESAP (02.11.2026, Orhan — Teknocenter Bölge Analizi) ═══════════════════════════════
// "Atanan İş Tutarı" kartı, detay listesi ve Excel'i bu tek hesaptan beslenir.
// Kapsam: firmaya ait geçerli PR talebi = Günlük İş Girişi kalemi (master_works) — taşeron alanı firma adıyla eşleşir
//   (TEKNO / TEKNO_xxx) ve PR miktarı (grid "PR Qty" → master_works.done_qty) > 0. Fiziki tamamlanma (tamamlanan_qty =
//   grid "Done Qty"), QC, PO ya da fatura giriş ŞARTI DEĞİLDİR; bunlar yalnız bilgi sütunudur ve kalemin durumunu değiştirmez.
//   PR miktarı 0 olan satır (talep geri çekilmiş / iptal) hesaba alınmaz, "hesaba alınmayan" listesinde görünür.
// Fiyat önceliği (kalem başına, sessiz seçim yok):
//   1) Doğrulanmış Huawei PO satırı: aynı proje kodu + aynı tam iş kodu (site_code) + aynı kalem kodu (Bölge Analizi'nin
//      mevcut eşleştirme kuralı). İptal / sıfır miktarlı satır esas alınmaz; aynı PO/satır/shipment'ın mükerrer içe
//      alınmış kopyası bir kez sayılır. Birden çok geçerli satır aynı fiyat + para birimini taşıyorsa miktarlar toplanır
//      (07.08.2026 kuralı); farklı fiyat / para birimi, proje kodu farklı PO ya da aynı saha+kalemde birden çok PR satırı
//      (PO'nun hangi talebe ait olduğu belli değil) → BELİRSİZ: PO fiyatı kullanılmaz, kalem inceleme listesine düşer.
//   2) PO yoksa (ya da PO'nun karşılamadığı PR miktarı için) BoQ: PR satırında seçilmiş sürüm + fiyat anlık görüntüsü
//      (boq_surum / boq_birim_fiyat) — katalog sonradan değişse de bu fiyat korunur. Anlık görüntü yoksa sürüm, sürümlü
//      katalog kuralıyla (Rollout'taki gerçek malzeme geliş tarihi, sınır 12.10.2026) ve sahanın bölgesiyle bulunur; tarih
//      yoksa ama iki sürümde fiyat aynıysa o fiyat kullanılır. Hiçbir koşulda "en yeni BoQ" körlemesine uygulanmaz.
//   3) Fiyat bulunamazsa tutar 0 sayılmaz: "Fiyat doğrulanamadı" — toplamın eksik olduğu ayrıca belirtilir.
// Kısmi PO: PO'nun karşıladığı miktar PO fiyatıyla, kalan PR miktarı BoQ fiyatıyla; aynı miktar iki kez sayılmaz.
// PO miktarı PR'den fazlaysa PR miktarı esas kalır (PR değiştirilmez), fark uyarı olarak gösterilir.
// Para birimleri ayrı toplanır (TRY / USD); kur bu modülde uygulanmaz.
// Hakediş: firma payı (markalar.kirilim_yuzde → pay) tutara uygulanır; PO/BoQ birim fiyatı ile firmaya düşen tutar ayrı alanlardır.
// Bu modül hiçbir kaydı değiştirmez (PR, PO, katalog, fatura). Fiyat kaynağı geçmişi yalnız ayrı günlük tablosu varsa yazılır.

const BK = require("./boqKatalog");
const SK = require("./sahaKimlik");

const sNorm = (v) => String(v || "").replace(/\s+/g, "").toUpperCase();
const kNorm = (v) => String(v || "").trim();
const pNorm = (v) => String(v || "").trim();
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const para = (v) => BK.paraNormalize(v) || "TRY";
const yuvarla = (x) => Math.round(Number(x || 0) * 100) / 100;
const IPTAL_RX = /CANCEL|İPTAL|IPTAL|VOID|DELETED|REJECT/i;
// Saha/paket birimli kalemde bir iş kodunda 1'den fazla PR miktarı (ör. "NR700" yazılırken 700 girilmesi) doğrulanmadan toplanmaz
const PAKET_BIRIMLERI = new Set(["SITE"]);

function poAnahtar(p) { return `${kNorm(p.po_no)}|${kNorm(p.po_line_no)}|${kNorm(p.shipment_no)}`; }

// PO satırlarını kalem için ayıklar: geçerli / iptal / mükerrer
function poSatirlariniAyikla(satirlar) {
  const gecerli = new Map(), iptal = [];
  let mukerrer = 0;
  for (const p of satirlar) {
    const q = num(p.requested_qty);
    if (IPTAL_RX.test(String(p.po_status || "")) || !(q > 0)) { iptal.push(p); continue; }
    const k = poAnahtar(p);
    const once = gecerli.get(k);
    if (once) {
      mukerrer++;
      // Aynı PO/satır/shipment'ın en son yüklenen kopyası esas
      if (String(p.created_at || "") > String(once.created_at || "") || (String(p.created_at || "") === String(once.created_at || "") && Number(p.id) > Number(once.id))) gecerli.set(k, p);
      continue;
    }
    gecerli.set(k, p);
  }
  return { gecerli: [...gecerli.values()], iptal, mukerrer };
}

// BoQ fiyatı: kayıttaki anlık görüntü → sürüm kuralı → iki sürümde aynı fiyat. Döner {ok, ...} | {ok:false, neden}
function boqFiyati(k, { katalog, rollout, bolgeOf }) {
  if (k.boq_surum && num(k.boq_birim_fiyat) !== null) {
    return { ok: true, surum: k.boq_surum, birim_fiyat: Number(k.boq_birim_fiyat), para: para(k.boq_para_birimi), birim: k.boq_birim || null,
      bolge: k.boq_bolge || null, kaynak: "KAYIT", aciklama: `${k.boq_surum} · PR kaydındaki seçim (anlık görüntü)` };
  }
  const site = sNorm(k.site_code);
  const ro = rollout.get(site) || [];
  const bolge = BK.bolgeNormalize(ro.find((r) => r.bolge)?.bolge) || BK.bolgeNormalize(bolgeOf ? bolgeOf(site) : null);
  if (!bolge) return { ok: false, neden: "Sahanın BoQ bölgesi (Ankara / Bursa / İzmir) belirlenemedi" };
  const kod = kNorm(k.item_code);
  const adaylar = (surum) => {
    const l = katalog.filter((c) => c.surum === surum && kNorm(c.kod) === kod);
    const b = l.filter((c) => BK.bolgeNormalize(c.bolge) === bolge);
    const sec = b.length ? b : l.filter((c) => !c.bolge);
    const fiyatli = sec.filter((c) => num(c.birim_fiyat) !== null);
    const farkli = new Set(fiyatli.map((c) => `${Number(c.birim_fiyat)}|${para(c.para_birimi)}`));
    return { sec, fiyatli, farkli };
  };
  const tek = (surum, kaynak, aciklama) => {
    const a = adaylar(surum);
    if (!a.sec.length) return { ok: false, neden: `${kod} kalemi ${surum} kataloğunda (${bolge}) yok` };
    if (!a.fiyatli.length) return { ok: false, neden: `${kod} kalemi ${surum} kataloğunda fiyatsız` };
    if (a.farkli.size > 1) return { ok: false, belirsiz: true, neden: `${surum} kataloğunda ${kod} için ${a.farkli.size} farklı fiyat (ödeme kapsamı TE/PA) — seçim PR'da yapılmamış` };
    const c = a.fiyatli[0];
    return { ok: true, surum, birim_fiyat: Number(c.birim_fiyat), para: para(c.para_birimi), birim: c.birim || null, bolge, kaynak, aciklama };
  };
  // Sürüm PR'da seçilmiş ama anlık görüntüde fiyat yok (seçim anında o sürümün kataloğu henüz içe alınmamıştı):
  // seçilen sürüm korunur, fiyat aynı sürüm + bölgenin kataloğundan okunur (başka sürüme geçilmez)
  if (k.boq_surum) {
    const r = tek(String(k.boq_surum).toUpperCase(), "KAYIT_SURUM_KATALOG", `${k.boq_surum} · PR'da seçili sürüm; fiyat anlık görüntüde yoktu, aynı sürümün kataloğundan`);
    return r.ok ? r : { ...r, neden: `${k.boq_surum} seçili, kayıtta fiyat yok; katalog: ${r.neden}` };
  }
  const tarihler = [...new Set(ro.map((r) => r.malzeme_gelis_tarihi).filter(Boolean))];
  if (tarihler.length === 1) {
    const surum = BK.tariheGoreSurum(tarihler[0]);
    return tek(surum, "SURUM_KURALI", `${surum} · malzeme geliş tarihi ${BK.trGun(tarihler[0])} (PR'da sürüm seçilmemiş)`);
  }
  if (tarihler.length > 1) return { ok: false, belirsiz: true, neden: `Rollout'ta birden çok malzeme geliş tarihi (${tarihler.join(", ")}) — sürüm doğrulanamadı` };
  // Tarih yok: iki sürüm aynı fiyatı veriyorsa sürüm sonucu değiştirmez
  const a = tek("BOQ2025", "IKI_SURUM_AYNI", ""), b = tek("BOQ2026", "IKI_SURUM_AYNI", "");
  if (a.ok && b.ok && a.birim_fiyat === b.birim_fiyat && a.para === b.para)
    return { ...b, surum: "BOQ2025=BOQ2026", aciklama: "Malzeme geliş tarihi yok; iki BoQ sürümünde fiyat aynı" };
  return { ok: false, neden: "PR'da BoQ sürümü seçilmemiş ve Rollout'ta malzeme geliş tarihi yok — sürüm (2025 / 2026) doğrulanamadı" };
}

/* hesapla({ kalemler, poSatirlari, anahtarSayilari, rollout, katalog, pay, bolgeOf })
   kalemler: kapsamdaki master_works satırları (firma eşleşmesi çağıranda yapılmış)
   poSatirlari: kapsamdaki iş kodlarının po_rows satırları
   anahtarSayilari: Map "PROJE|SAHA|KALEM" → tüm firmalarda o anahtardaki PR satırı sayısı (yalnız sayı; başka firmanın verisi dönmez)
   rollout: Map SAHA → [{bolge, malzeme_gelis_tarihi}] · katalog: boq_katalog satırları · pay: firma hakediş oranı (0–1) */
function hesapla({ kalemler = [], poSatirlari = [], anahtarSayilari = new Map(), rollout = new Map(), katalog = [], pay = 1, bolgeOf = null }) {
  const poBySahaKalem = new Map();
  for (const p of poSatirlari) {
    const k = `${sNorm(p.site_code)}|${kNorm(p.item_code)}`;
    if (!poBySahaKalem.has(k)) poBySahaKalem.set(k, []);
    poBySahaKalem.get(k).push(p);
  }
  const satirlar = [];
  for (const m of kalemler) {
    const site = sNorm(m.site_code), kod = kNorm(m.item_code), proje = pNorm(m.project_code);
    const fs = SK.fizikselSaha(site);
    const pr = Number(m.done_qty || 0);
    const fizikiQty = m.tamamlanan_qty === null || m.tamamlanan_qty === undefined ? null : Number(m.tamamlanan_qty);
    const uyarilar = [];
    const tum = poBySahaKalem.get(`${site}|${kod}`) || [];
    const ayniProje = tum.filter((p) => pNorm(p.project_code) === proje);
    const digerProje = tum.filter((p) => pNorm(p.project_code) !== proje);
    const A = poSatirlariniAyikla(ayniProje);
    const D = poSatirlariniAyikla(digerProje);
    if (A.mukerrer) uyarilar.push(`${A.mukerrer} mükerrer PO satırı (aynı PO/satır/shipment) bir kez sayıldı`);
    if (A.iptal.length) uyarilar.push(`${A.iptal.length} iptal / sıfır miktarlı PO satırı esas alınmadı (${A.iptal.map((p) => `${kNorm(p.po_no)}/${kNorm(p.po_line_no)}`).join(", ")})`);

    const satir = {
      id: m.id, fiziksel_id: fs ? fs.fiziksel_id : null, is_kodu: site, proje_kodu: proje, item_code: kod,
      aciklama: m.item_description || m.boq_aciklama || "", subcon_name: m.subcon_name || "",
      pr_qty: pr, birim: m.boq_birim || null, fiziki_qty: fizikiQty,
      fiziki_durum: fizikiQty === null || fizikiQty <= 0 ? "Başlamadı / girilmedi" : fizikiQty >= pr ? "Fiziki tamamlandı" : "Kısmi",
      qc_durum: String(m.qc_durum || "").toUpperCase() === "OK" ? "OK" : "NOK",
      po_satirlari: [], po_qty: 0, eslesen_qty: 0, po_birim_fiyat: null, po_para: null,
      bekleyen_qty: 0, boq: null, boq_neden: null,
      fiyat_kaynagi: null, etiket: "", tutar: {}, po_tutar: {}, boq_tutar: {}, hakedis_orani: pay, firma_tutar: {},
      fark_po_boq: null, durum: "DAHIL", uyarilar,
    };

    if (!(pr > 0)) {
      satir.durum = "HARIC";
      satir.etiket = A.gecerli.length ? "PR miktarı 0 — PO açık (PO iptal edilmeli)" : "PR miktarı 0 — talep yok";
      satir.po_satirlari = A.gecerli.map((p) => ({ po_no: kNorm(p.po_no), po_line_no: kNorm(p.po_line_no), shipment_no: kNorm(p.shipment_no), qty: Number(p.requested_qty), birim_fiyat: num(p.unit_price), para: para(p.currency), po_status: p.po_status || "" }));
      satir.po_qty = A.gecerli.reduce((s, p) => s + Number(p.requested_qty || 0), 0);
      satirlar.push(satir);
      continue;
    }

    // ── PO eşleşmesi ─────────────────────────────────────────────────────────
    let poOk = false, belirsizNeden = null;
    const paylasim = anahtarSayilari.get(`${proje}|${site}|${kod}`) || 1;
    if (A.gecerli.length) {
      const fiyatlar = new Set(A.gecerli.map((p) => `${num(p.unit_price)}|${para(p.currency)}`));
      if (paylasim > 1) belirsizNeden = `Aynı iş kodu + kalem için ${paylasim} PR satırı var — PO miktarının hangi talebe ait olduğu doğrulanamadı`;
      else if (fiyatlar.size > 1) belirsizNeden = `PO satırları farklı birim fiyat / para birimi taşıyor (${[...fiyatlar].join(" · ")})`;
      else if (A.gecerli.some((p) => !(num(p.unit_price) > 0))) belirsizNeden = "PO satırında birim fiyat yok";
      else poOk = true;
    } else if (D.gecerli.length) {
      belirsizNeden = `PO aynı iş kodu + kalemde ama proje kodu farklı (${[...new Set(D.gecerli.map((p) => pNorm(p.project_code) || "boş"))].join(", ")} ≠ ${proje || "boş"})`;
    }
    const poListe = (poOk ? A.gecerli : belirsizNeden ? (A.gecerli.length ? A.gecerli : D.gecerli) : []);
    satir.po_satirlari = poListe.map((p) => ({ po_no: kNorm(p.po_no), po_line_no: kNorm(p.po_line_no), shipment_no: kNorm(p.shipment_no),
      qty: Number(p.requested_qty), birim_fiyat: num(p.unit_price), para: para(p.currency), po_status: p.po_status || "", proje_kodu: pNorm(p.project_code) }));
    satir.po_qty = poListe.reduce((s, p) => s + Number(p.requested_qty || 0), 0);
    if (belirsizNeden) { satir.durum = "INCELEME"; uyarilar.push(`PO eşleşmesi belirsiz: ${belirsizNeden} — PO fiyatı kullanılmadı`); }

    // ── BoQ (PO'nun karşılamadığı miktar ve karşılaştırma için) ─────────────────
    const boq = boqFiyati(m, { katalog, rollout, bolgeOf });
    if (boq.ok) { satir.boq = boq; if (!satir.birim && boq.birim) satir.birim = boq.birim; }
    else { satir.boq_neden = boq.neden; if (boq.belirsiz) uyarilar.push(`BoQ fiyatı belirsiz: ${boq.neden}`); }

    // ── Miktar doğrulaması (saha/paket biriminde 1'den büyük PR) ─────────────────
    const birimU = String(satir.birim || "").toUpperCase();
    if (PAKET_BIRIMLERI.has(birimU) && pr > 1) {
      satir.durum = "INCELEME";
      satir.miktar_supheli = true;
      uyarilar.push(`Miktar doğrulanamadı: ${birimU} birimli kalemde PR miktarı ${pr} — hesaplanan tutar toplama eklenmedi (PR değiştirilmedi)`);
    }

    // ── Tutar ────────────────────────────────────────────────────────────────
    const ekle = (o, pb, v) => { o[pb] = yuvarla((o[pb] || 0) + v); };
    if (poOk) {
      const p0 = A.gecerli[0];
      satir.po_birim_fiyat = Number(p0.unit_price);
      satir.po_para = para(p0.currency);
      satir.eslesen_qty = Math.min(pr, satir.po_qty);
      ekle(satir.po_tutar, satir.po_para, satir.eslesen_qty * satir.po_birim_fiyat);
      if (satir.po_qty > pr) uyarilar.push(`PO miktarı (${satir.po_qty}) PR miktarından (${pr}) fazla — PR miktarı esas alındı`);
    }
    satir.bekleyen_qty = yuvarla(pr - satir.eslesen_qty);
    if (satir.bekleyen_qty > 0) {
      if (boq.ok) ekle(satir.boq_tutar, boq.para, satir.bekleyen_qty * boq.birim_fiyat);
      else uyarilar.push(`Fiyat doğrulanamadı (${satir.bekleyen_qty} ${satir.birim || "adet"} PO dışında): ${boq.neden}`);
    }
    if (poOk && boq.ok) {
      if (boq.para === satir.po_para) satir.fark_po_boq = yuvarla(satir.po_birim_fiyat - boq.birim_fiyat);
      else uyarilar.push(`PO (${satir.po_para}) ve BoQ (${boq.para}) para birimi farklı — fark hesaplanmadı`);
    }
    for (const o of [satir.po_tutar, satir.boq_tutar]) for (const [pb, v] of Object.entries(o)) ekle(satir.tutar, pb, v);
    if (satir.miktar_supheli) {
      // Hesaplanan tutar yalnız bilgi olarak taşınır; kart, liste toplamı ve Excel'e girmez
      satir.tutar_disarida = satir.tutar; satir.tutar = {}; satir.po_tutar = {}; satir.boq_tutar = {};
    }
    for (const [pb, v] of Object.entries(satir.tutar)) satir.firma_tutar[pb] = yuvarla(v * pay);

    const fiyatsizKalan = satir.bekleyen_qty > 0 && !boq.ok;
    satir.fiyat_kaynagi = poOk && satir.bekleyen_qty > 0 ? (boq.ok ? "PO+BOQ" : "PO+YOK") : poOk ? "PO" : boq.ok ? "BOQ" : "YOK";
    const boqEtiket = boq.ok ? `BoQ fiyatı · PO bekleniyor (${boq.surum})` : "Fiyat doğrulanamadı";
    satir.etiket = poOk
      ? (satir.bekleyen_qty > 0 ? `PO fiyatı (${satir.eslesen_qty}) + ${boq.ok ? `BoQ fiyatı · PO bekleniyor (${satir.bekleyen_qty}, ${boq.surum})` : `fiyat doğrulanamadı (${satir.bekleyen_qty})`}` : "PO fiyatı")
      : boqEtiket;
    if (satir.durum === "DAHIL" && fiyatsizKalan && !poOk) satir.durum = "FIYATSIZ";
    else if (satir.durum === "DAHIL" && fiyatsizKalan) satir.kismi_fiyatsiz = true;
    satirlar.push(satir);
  }
  return { satirlar, ozet: ozetle(satirlar, pay) };
}

function ozetle(satirlar, pay) {
  const topla = (l, alan) => {
    const o = {};
    for (const s of l) for (const [pb, v] of Object.entries(s[alan] || {})) o[pb] = yuvarla((o[pb] || 0) + v);
    return o;
  };
  const say = (l) => ({ kalem: l.length, is_kaydi: new Set(l.map((s) => s.is_kodu)).size, fiziksel_saha: new Set(l.map((s) => s.fiziksel_id || s.is_kodu)).size });
  // Toplama giren: PR geçerli ve miktarı şüpheli olmayan kalemler (belirsiz PO → BoQ geçici olarak girer)
  const giren = satirlar.filter((s) => s.durum !== "HARIC" && !s.miktar_supheli);
  const fiyatsiz = giren.filter((s) => s.fiyat_kaynagi === "YOK" || s.fiyat_kaynagi === "PO+YOK");
  return {
    hakedis_orani: pay,
    kapsam: say(satirlar.filter((s) => s.durum !== "HARIC")),
    toplam: topla(giren, "tutar"),
    po_fiyatli: topla(giren, "po_tutar"),
    boq_gecici: topla(giren, "boq_tutar"),
    firma_tutar: topla(giren, "firma_tutar"),
    po_kalem: giren.filter((s) => s.fiyat_kaynagi.startsWith("PO")).length,
    boq_kalem: giren.filter((s) => s.fiyat_kaynagi === "BOQ" || s.fiyat_kaynagi === "PO+BOQ").length,
    fiyatsiz: { ...say(fiyatsiz), pr_qty: yuvarla(fiyatsiz.reduce((s, x) => s + (x.fiyat_kaynagi === "YOK" ? x.pr_qty : x.bekleyen_qty), 0)) },
    inceleme: say(satirlar.filter((s) => s.durum === "INCELEME")),
    miktar_supheli: { ...say(satirlar.filter((s) => s.miktar_supheli)), tutar_disarida: topla(satirlar.filter((s) => s.miktar_supheli), "tutar_disarida") },
    haric: say(satirlar.filter((s) => s.durum === "HARIC")),
    fiziki_baslamamis: satirlar.filter((s) => s.durum !== "HARIC" && (s.fiziki_qty === null || s.fiziki_qty <= 0)).length,
    toplam_eksik: fiyatsiz.length > 0,
  };
}

// ── Veri yükleme (salt okunur) ───────────────────────────────────────────────────────────────────
// eslesir(subcon_name) → firmanın kalemi mi (server.js subconRowMatches). Başka firmanın satırları istemciye dönmez.
async function yukle(pool, { eslesir, pay = 1, bolgeOf = null }) {
  const mw = await pool.query(`SELECT id, project_code, site_code, item_code, item_description, done_qty, tamamlanan_qty, subcon_name, qc_durum,
      boq_surum, boq_bolge, boq_birim, boq_para_birimi, boq_birim_fiyat, boq_aciklama, to_char(created_at,'YYYY-MM-DD') AS created_at
    FROM master_works WHERE COALESCE(TRIM(subcon_name),'') <> '' AND COALESCE(TRIM(site_code),'') <> '' ORDER BY id`);
  const kalemler = mw.rows.filter((r) => eslesir(r.subcon_name));
  const sahalar = [...new Set(kalemler.map((r) => sNorm(r.site_code)))];
  const kodlar = [...new Set(kalemler.map((r) => kNorm(r.item_code)))];
  if (!sahalar.length) return hesapla({ kalemler: [], pay });
  const [po, sayi, ro, kat] = await Promise.all([
    pool.query(`SELECT id, project_code, site_code, item_code, unit_price, currency, requested_qty, billed_qty, due_qty, po_no, po_line_no,
        shipment_no, po_status, to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS') AS created_at
      FROM po_rows WHERE UPPER(REGEXP_REPLACE(COALESCE(site_code,''),'\\s','','g')) = ANY($1::text[])`, [sahalar]),
    pool.query(`SELECT TRIM(COALESCE(project_code,'')) AS p, UPPER(REGEXP_REPLACE(COALESCE(site_code,''),'\\s','','g')) AS s, TRIM(COALESCE(item_code,'')) AS i,
        COUNT(*) FILTER (WHERE COALESCE(done_qty,0) > 0)::int AS n
      FROM master_works WHERE UPPER(REGEXP_REPLACE(COALESCE(site_code,''),'\\s','','g')) = ANY($1::text[]) GROUP BY 1,2,3`, [sahalar]),
    pool.query(`SELECT UPPER(REGEXP_REPLACE(COALESCE(site_code,''),'\\s','','g')) AS s, bolge, to_char(malzeme_gelis_tarihi,'YYYY-MM-DD') AS malzeme_gelis_tarihi
      FROM rollout_progress WHERE UPPER(REGEXP_REPLACE(COALESCE(site_code,''),'\\s','','g')) = ANY($1::text[])`, [sahalar]).catch(() => ({ rows: [] })),
    pool.query(`SELECT surum, kod, bolge, birim, para_birimi, birim_fiyat, kaynak_kapsam, odeme_kosulu FROM boq_katalog WHERE TRIM(kod) = ANY($1::text[])`, [kodlar]).catch(() => ({ rows: [] })),
  ]);
  const anahtarSayilari = new Map(sayi.rows.map((r) => [`${r.p}|${r.s}|${r.i}`, Number(r.n)]));
  const rollout = new Map();
  for (const r of ro.rows) { if (!rollout.has(r.s)) rollout.set(r.s, []); rollout.get(r.s).push(r); }
  return hesapla({ kalemler, poSatirlari: po.rows, anahtarSayilari, rollout, katalog: kat.rows, pay, bolgeOf });
}

// ── Fiyat kaynağı geçmişi (yalnız atanan_fiyat_kaynak_gecmis tablosu varsa; tabloyu bu kod OLUŞTURMAZ) ──────────────
// Kalemin kaynağı / PO satırları / birim fiyatı son kayıttan farklıysa yeni satır eklenir; eski satır silinmez.
async function kaynakGecmisiYaz(pool, satirlar, kullanici) {
  const var_ = await pool.query(`SELECT to_regclass('atanan_fiyat_kaynak_gecmis') IS NOT NULL AS v`).then((r) => r.rows[0]?.v).catch(() => false);
  if (!var_ || !satirlar.length) return { yazildi: 0, tablo: !!var_ };
  const ids = satirlar.map((s) => s.id);
  const son = await pool.query(`SELECT DISTINCT ON (master_id) master_id, imza FROM atanan_fiyat_kaynak_gecmis WHERE master_id = ANY($1::int[]) ORDER BY master_id, id DESC`, [ids]);
  const sonMap = new Map(son.rows.map((r) => [r.master_id, r.imza]));
  let yazildi = 0;
  for (const s of satirlar) {
    const imza = [s.fiyat_kaynagi || s.durum, s.po_birim_fiyat ?? "", s.po_para ?? "", s.po_satirlari.map((p) => `${p.po_no}/${p.po_line_no}/${p.shipment_no}`).join("+"), s.boq ? `${s.boq.surum}:${s.boq.birim_fiyat}${s.boq.para}` : ""].join("|");
    if (sonMap.get(s.id) === imza) continue;
    await pool.query(`INSERT INTO atanan_fiyat_kaynak_gecmis (master_id, is_kodu, item_code, imza, fiyat_kaynagi, po_birim_fiyat, po_para, po_satirlari, boq_surum, boq_birim_fiyat, boq_para, kullanici)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [s.id, s.is_kodu, s.item_code, imza, s.fiyat_kaynagi || s.durum, s.po_birim_fiyat, s.po_para, JSON.stringify(s.po_satirlari), s.boq?.surum || null, s.boq?.birim_fiyat ?? null, s.boq?.para || null, kullanici || null]);
    yazildi++;
  }
  return { yazildi, tablo: true };
}
async function kaynakGecmisiOku(pool, ids) {
  const var_ = await pool.query(`SELECT to_regclass('atanan_fiyat_kaynak_gecmis') IS NOT NULL AS v`).then((r) => r.rows[0]?.v).catch(() => false);
  if (!var_ || !ids.length) return new Map();
  const r = await pool.query(`SELECT master_id, fiyat_kaynagi, po_birim_fiyat, po_para, boq_surum, boq_birim_fiyat, boq_para, to_char(zaman,'DD.MM.YYYY HH24:MI') AS zaman
    FROM atanan_fiyat_kaynak_gecmis WHERE master_id = ANY($1::int[]) ORDER BY master_id, id`, [ids]);
  const m = new Map();
  for (const x of r.rows) { if (!m.has(x.master_id)) m.set(x.master_id, []); m.get(x.master_id).push(x); }
  return m;
}

module.exports = { hesapla, ozetle, yukle, boqFiyati, poSatirlariniAyikla, kaynakGecmisiYaz, kaynakGecmisiOku, PAKET_BIRIMLERI };
