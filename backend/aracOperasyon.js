// ═══ ARAÇ VE EKİP OPERASYON MERKEZİ (05.11.2026, Orhan) ═══════════════════════════════════════════════════════════
// Saha haritasında araca tıklayınca açılan sade kart + modüller (Canlı İzle, Yakıt Analizi, Araçtaki Malzemeler, Bugünkü /
// Haftalık Plan, Ekip ve Personel) için SAF hesaplar. Ayrı bir takip / stok sistemi yoktur; kaynaklar:
//   km, hareket / rölanti     Triomobil sürüş özeti (aracTakip.aracGecmisi) — cihaz sayacı; GPS çizgisinden km ÜRETİLMEZ
//   güzergâh                  Triomobil locations/history (aracTakip.aracGuzergah)
//   yakıt finansmanı          is_avans_talep (gider türü Yakıt, ödenmiş, plaka eşleşmesi) — ödeme tarihi esas
//   tüketim referansı         arac_tuketim_referans (yalnız ONAYLI, kaynaklı kayıt) — her açılışta internet araştırması YOK
//   yakıt birim fiyatı        yakit_fiyat_referans (tarihli, kaynaklı) — yoksa TL karşılaştırması üretilmez
//   malzeme                   hw_malzeme_islem defteri (ekip bakiyesi + teslim / devirde seçilen araç plakası)
//   plan / ekip               is_atama + is_atama_plan_segment (tarihli araç plakası), ekip_uyelik / personel.ekip_bilgisi
// Bu dosya veritabanına ya da ağa dokunmaz; server.js uçları veriyi okuyup buradaki fonksiyonlara verir.
"use strict";

// Yakıt analizi başlangıcı (T0): 1 Kasım 2026 00:00 Türkiye saati. Yalnız yakıt analizine aittir; genel araç geçmişi,
// iş atamaları ve avans kayıtları bu tarihten önce de durur, değiştirilmez. Sunucuda uygulanır (ekranda gizleme değil).
const YAKIT_T0 = "2026-11-01";

// Sınıflandırma eşikleri — açık, sürümlü, ortam değişkeniyle (YAKIT_ESIK_JSON) değiştirilebilir. Sektör standardı DEĞİLDİR;
// Orhan'ın kuralı: operasyon referansı = resmî L/100 km × 1,15. Bu %15 pay tek toleranstır: "yüksek avans" eşiği varsayılan
// olarak beklenen bedelin üstüne ek pay KOYMAZ (yuksek_avans_esik_yuzde = 0). Değiştirilirse sürüm de değiştirilmelidir.
const ESIK_VARSAYILAN = Object.freeze({
  surum: "v1 · 05.11.2026",
  operasyon_payi: 0.15,          // resmî tüketime eklenen operasyon payı (Orhan)
  yuksek_avans_esik_yuzde: 0,    // avans, beklenen bedeli bu yüzdeden FAZLA aşarsa "yüksek avans — inceleme önerilir"
  min_km: 300,                   // bunun altındaki dönemde kesin hüküm verilmez ("Veri yetersiz")
  min_veri_gun: 3,               // en az bu kadar km verisi olan gün
  fiyat_azami_yas_gun: 31,       // yakıt birim fiyatı bu kadar günden eskiyse o gün için fiyat yok sayılır
});
function esikler(env = process.env) {
  try {
    const ek = env.YAKIT_ESIK_JSON ? JSON.parse(env.YAKIT_ESIK_JSON) : null;
    return ek && typeof ek === "object" ? { ...ESIK_VARSAYILAN, ...ek } : { ...ESIK_VARSAYILAN };
  } catch { return { ...ESIK_VARSAYILAN }; }
}

const gunEkle = (gun, n) => new Date(Date.parse(`${gun}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const gunAraligi = (bas, bit) => { const l = []; for (let g = bas; g <= bit; g = gunEkle(g, 1)) l.push(g); return l; };
const isoGun = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const gunStr = (v) => { if (!v) return null; if (v instanceof Date) return isNaN(v) ? null : new Date(v.getTime() + 3 * 3600e3).toISOString().slice(0, 10); const t = String(v).slice(0, 10); return isoGun(t) ? t : null; };
const yuv = (v, n = 2) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10 ** n) / 10 ** n);
const plakaNorm = (p) => String(p || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
const AY_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const gunAd = (g) => `${Number(g.slice(8, 10))} ${AY_TR[Number(g.slice(5, 7)) - 1]}`;
const tl = (v) => `${Number(v).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} TL`;

// ── Dönem: istenen aralık → T0'a kırpılmış fiilî aralık ────────────────────────────────────────────────────────
// donem: bugun | 7 | 15 | 30 | ay | ozel. Bitiş bugünden ileri olamaz. T0'dan önce başlayan dönem T0'a çekilir ve
// yanıtta açıkça yazılır (eksik günler sıfır sayılmaz; T0 öncesi analize hiç girmez).
function donemCoz({ donem = "7", bas, bit, bugun, t0 = YAKIT_T0 } = {}) {
  const d = String(donem || "7").toLowerCase();
  let iBas, iBit = bugun;
  if (d === "bugun") iBas = bugun;
  else if (["7", "15", "30"].includes(d)) iBas = gunEkle(bugun, -(Number(d) - 1));
  else if (d === "ay") iBas = `${bugun.slice(0, 7)}-01`;
  else if (d === "ozel") {
    if (!isoGun(bas) || !isoGun(bit)) return { ok: false, error: "Özel dönem için başlangıç ve bitiş tarihi girin" };
    iBas = bas; iBit = bit;
  } else return { ok: false, error: "Geçersiz dönem" };
  if (iBas > iBit) return { ok: false, error: "Başlangıç tarihi bitişten sonra olamaz" };
  const gercekBit = iBit > bugun ? bugun : iBit;
  if (gercekBit < t0) return { ok: false, error: `Yakıt analizi ${gunAd(t0)} ${t0.slice(0, 4)} tarihinde başlar; seçilen dönem bu tarihten önce` };
  const gercekBas = iBas < t0 ? t0 : iBas;
  const gunler = gunAraligi(gercekBas, gercekBit);
  const kirpildi = gercekBas !== iBas;
  return { ok: true, donem: d, istenen_bas: iBas, istenen_bit: iBit, bas: gercekBas, bit: gercekBit, gun_sayisi: gunler.length,
    t0, t0_kirpildi: kirpildi, devam_ediyor: gercekBit === bugun, gunler,
    not: kirpildi ? `${gunAd(gercekBas)}–${gunAd(gercekBit)}: yakıt analizi ${gunAd(t0)} başladığı için ${gunler.length} günlük veri` : null };
}

// ── Yakıt avansı seçimi ──────────────────────────────────────────────────────────────────────────────────────
// Girdi: bu plakanın (normalize eşleşen) gider türü Yakıt olan TÜM iş avansı satırları (durumdan bağımsız).
// Sayılan: durum TAMAMLANDI (ödendi) + ödeme tarihi dolu. Tutar: odenen_tutar > 0 ise o (gerçekleşen ödeme), değilse tutar
// (bugün iş avansında kısmi ödeme yok — odenen_tutar alanı avans akışında doldurulmuyor; doldurulursa o esas alınır).
// Hariç: reddedilen / iptal / onay bekleyen (ödenmemiş) — listede gösterilmez. Ödendiği halde ödeme tarihi boş olan
// kayıt BAŞKA TARİHE TAŞINMAZ: "teyit listesi"ne düşer, toplama girmez. Olası mükerrer (aynı kişi + aynı tutar + aynı
// talep tarihi + aynı ödeme tarihi; ilk kayıt sayılır) toplama girmez, teyit listesinde gösterilir.
const YAKIT_RX = /^\s*yak[ıi]t\s*$/i; // gider türü TAM olarak "Yakıt" (doğrulanmış tür) — "Yakıt + yol" gibi karışık tür değil
function avansSec(satirlar) {
  const sayilan = [], teyit = [];
  const imzalar = new Map();
  const sirali = [...satirlar].sort((a, b) => Number(a.id) - Number(b.id));
  for (const r of sirali) {
    if (!YAKIT_RX.test(String(r.gider_turu || ""))) continue;
    const durum = String(r.durum || "").toUpperCase();
    if (durum !== "TAMAMLANDI") continue; // ödenmemiş / reddedilmiş / iptal
    const odenen = Number(r.odenen_tutar) > 0 ? Number(r.odenen_tutar) : Number(r.tutar || 0);
    const kayit = { id: Number(r.id), talep_tarihi: gunStr(r.tarih), odeme_tarihi: gunStr(r.odeme_tarihi), tutar: yuv(odenen),
      talep_tutari: yuv(r.tutar), kismi: Number(r.odenen_tutar) > 0 && Number(r.odenen_tutar) !== Number(r.tutar),
      kisi: r.kisi || null, aciklama: r.aciklama || null, arac_km: r.arac_km === null || r.arac_km === undefined || r.arac_km === "" ? null : Number(r.arac_km) };
    if (!kayit.odeme_tarihi) { teyit.push({ ...kayit, neden: "Ödendi görünüyor ama ödeme tarihi yok — hangi güne ait olduğu teyit edilmeli (toplama alınmadı)" }); continue; }
    const imza = [String(r.personel_id || r.talep_eden_email || "").toLowerCase(), kayit.tutar, kayit.talep_tarihi, kayit.odeme_tarihi].join("|");
    if (imzalar.has(imza)) { teyit.push({ ...kayit, neden: `Olası mükerrer: #${imzalar.get(imza)} ile aynı kişi, tutar, talep ve ödeme tarihi (toplama alınmadı)` }); continue; }
    imzalar.set(imza, kayit.id);
    sayilan.push(kayit);
  }
  return { sayilan, teyit };
}

// ── Fiyat: gün → geçerli birim fiyat (o güne kadar girilmiş en yeni, azami yaşı aşmamış, aynı yakıt türü) ──────────
function gunFiyati(fiyatlar, gun, yakitTuru, azamiYas) {
  const uygun = fiyatlar.filter((f) => !f.iptal && String(f.yakit_turu || "").toUpperCase() === String(yakitTuru || "").toUpperCase()
    && gunStr(f.gecerlilik_tarihi) && gunStr(f.gecerlilik_tarihi) <= gun && Number(f.birim_fiyat) > 0)
    .sort((a, b) => gunStr(b.gecerlilik_tarihi).localeCompare(gunStr(a.gecerlilik_tarihi)) || Number(b.id) - Number(a.id));
  const f = uygun[0];
  if (!f) return null;
  const yas = Math.round((Date.parse(`${gun}T12:00:00Z`) - Date.parse(`${gunStr(f.gecerlilik_tarihi)}T12:00:00Z`)) / 86400000);
  if (yas > azamiYas) return null;
  return { id: Number(f.id), birim_fiyat: Number(f.birim_fiyat), tarih: gunStr(f.gecerlilik_tarihi), kaynak: f.kaynak_ad || null, kaynak_url: f.kaynak_url || null };
}

// ── Yakıt analizi (deterministik) ───────────────────────────────────────────────────────────────────────────────
// Girdi:
//   donem       donemCoz sonucu (ok)
//   km          { gunler:[{tarih, veri, km, hareket_sn, rolanti_sn, kontak_acik_sn}], dogrulama } — T0..bit aralığı (kümülatif için)
//   avans       avansSec sonucu (T0..bit; ödeme tarihine göre)
//   referans    onaylı tüketim referansı ya da null
//   fiyatlar    yakit_fiyat_referans satırları
//   tutarGor    false ise TL değerleri, oranlar, durum ve TL içeren yorum yanıta HİÇ girmez (sızıntı yok)
function yakitAnalizi({ donem, km, avans, referans, fiyatlar = [], tutarGor = false, esik = ESIK_VARSAYILAN, kmHata = null }) {
  const opRef = referans && Number(referans.l100) > 0 ? yuv(Number(referans.l100) * (1 + esik.operasyon_payi), 3) : null;
  const kmGun = new Map((km?.gunler || []).map((g) => [g.tarih, g]));
  const avansGun = new Map();
  for (const a of avans?.sayilan || []) avansGun.set(a.odeme_tarihi, [...(avansGun.get(a.odeme_tarihi) || []), a]);
  const kumBas = donem.t0; // kümülatif seri her zaman T0'dan başlar
  const tumGunler = gunAraligi(kumBas, donem.bit);
  let kumAvans = 0, kumBeklenenTl = 0, kumBeklenenL = 0, kumTlTam = true;
  const seri = tumGunler.map((tarih) => {
    const k = kmGun.get(tarih) || null;
    const veri = !!(k && k.veri);
    const gunKm = veri ? Number(k.km) : null;
    const litre = veri && opRef ? yuv(gunKm * opRef / 100, 2) : null;
    const fiyat = veri && referans?.yakit_turu ? gunFiyati(fiyatlar, tarih, referans.yakit_turu, esik.fiyat_azami_yas_gun) : null;
    const beklenenTl = litre !== null && fiyat ? yuv(litre * fiyat.birim_fiyat, 2) : null;
    const av = avansGun.get(tarih) || [];
    const avTl = yuv(av.reduce((t, a) => t + a.tutar, 0), 2);
    kumAvans += avTl;
    if (litre !== null) kumBeklenenL += litre;
    if (beklenenTl !== null) kumBeklenenTl += beklenenTl; else if (veri && gunKm > 0) kumTlTam = false;
    const uyarilar = [];
    if (!veri) uyarilar.push(k ? "Km verisi yok" : "Km verisi yok (Triomobil satırı yok)");
    if (veri && gunKm > 0 && opRef && !fiyat) uyarilar.push("Bu gün için doğrulanmış yakıt fiyatı yok");
    if (tarih === donem.bit && donem.devam_ediyor) uyarilar.push("Gün devam ediyor");
    return { tarih, donemde: tarih >= donem.bas, veri, km: gunKm, olculmus_sifir: veri && gunKm === 0,
      hareket_sn: veri ? k.hareket_sn ?? null : null, rolanti_sn: veri ? k.rolanti_sn ?? null : null, kontak_acik_sn: veri ? k.kontak_acik_sn ?? null : null,
      beklenen_litre: litre, fiyat, beklenen_tl: beklenenTl, avans_tl: avTl, avanslar: av,
      kum_avans_tl: yuv(kumAvans), kum_beklenen_tl: kumTlTam ? yuv(kumBeklenenTl) : null, kum_beklenen_litre: opRef ? yuv(kumBeklenenL) : null,
      devam: tarih === donem.bit && donem.devam_ediyor, uyarilar };
  });
  const d = seri.filter((x) => x.donemde);
  const veriGun = d.filter((x) => x.veri);
  const toplamKm = yuv(veriGun.reduce((t, x) => t + x.km, 0), 1);
  const avansTl = yuv(d.reduce((t, x) => t + x.avans_tl, 0));
  const avansAdet = d.reduce((t, x) => t + x.avanslar.length, 0);
  const beklenenL = opRef ? yuv(veriGun.reduce((t, x) => t + (x.beklenen_litre || 0), 0), 1) : null;
  const fiyatsizGun = veriGun.filter((x) => x.km > 0 && opRef && !x.fiyat).map((x) => x.tarih);
  const beklenenTl = opRef && !fiyatsizGun.length ? yuv(veriGun.reduce((t, x) => t + (x.beklenen_tl || 0), 0)) : null;
  const farkTl = beklenenTl !== null ? yuv(avansTl - beklenenTl) : null;
  const farkYuzde = beklenenTl ? yuv((avansTl - beklenenTl) / beklenenTl * 100, 1) : null;
  const hareketSn = veriGun.reduce((t, x) => t + (x.hareket_sn || 0), 0), rolantiSn = veriGun.reduce((t, x) => t + (x.rolanti_sn || 0), 0);
  const eksikGun = d.filter((x) => !x.veri).map((x) => x.tarih);

  // Durum (deterministik, sırayla): karşılaştırma yapılamıyor → veri yetersiz → yüksek / uyumlu; dönem bugünü içeriyorsa
  // "dönem devam ediyor" ana durumdur, hesaplanan sonuç "ön değerlendirme" olarak ayrıca verilir.
  let durum, nedenler = [];
  if (kmHata) { durum = "KARSILASTIRMA_YOK"; nedenler.push(`Km verisi alınamadı: ${kmHata}`); }
  else if (!referans) { durum = "KARSILASTIRMA_YOK"; nedenler.push("Tüketim referansı doğrulanamadı (onaylı resmî referans yok)"); }
  else if (beklenenTl === null) { durum = "KARSILASTIRMA_YOK"; nedenler.push(fiyatsizGun.length ? `Doğrulanmış yakıt birim fiyatı eksik (${fiyatsizGun.length} gün)` : "Beklenen bedel hesaplanamadı"); }
  else if (toplamKm < esik.min_km || veriGun.length < esik.min_veri_gun) { durum = "VERI_YETERSIZ"; nedenler.push(`Dönemde ${toplamKm} km / ${veriGun.length} veri günü var; kesin değerlendirme için en az ${esik.min_km} km ve ${esik.min_veri_gun} gün gerekir`); }
  else durum = farkYuzde > esik.yuksek_avans_esik_yuzde ? "YUKSEK_AVANS" : "UYUMLU";
  let onDegerlendirme = null;
  if (donem.devam_ediyor && ["YUKSEK_AVANS", "UYUMLU"].includes(durum)) { onDegerlendirme = durum; durum = "DONEM_DEVAM"; }
  const DURUM_AD = { UYUMLU: "Referansla uyumlu", YUKSEK_AVANS: "Kilometreye göre yüksek yakıt avansı — inceleme önerilir", VERI_YETERSIZ: "Veri yetersiz",
    KARSILASTIRMA_YOK: "Karşılaştırma yapılamıyor", DONEM_DEVAM: "Dönem devam ediyor" };

  // Yorum: yalnız kanıtları sade Türkçe anlatır (şablon; tutar ÜRETMEZ — hepsi yukarıdaki hesaplardan)
  const cumle = [];
  cumle.push(`Seçilen dönemde (${gunAd(donem.bas)}–${gunAd(donem.bit)}) ${toplamKm.toLocaleString("tr-TR")} km yol${tutarGor ? ` ve ${tl(avansTl)} yakıt avansı ödemesi (${avansAdet} kayıt)` : ""} var.`);
  if (opRef && referans) cumle.push(`Doğrulanmış araç referansı ${String(referans.l100).replace(".", ",")} L/100 km; %${Math.round(esik.operasyon_payi * 100)} operasyon payıyla ${String(opRef).replace(".", ",")} L/100 km. Buna göre beklenen yakıt ${beklenenL?.toLocaleString("tr-TR")} litre${tutarGor && beklenenTl !== null ? `, bedeli ${tl(beklenenTl)}` : ""}.`);
  if (tutarGor && durum !== "KARSILASTIRMA_YOK" && farkTl !== null) {
    if ((onDegerlendirme || durum) === "YUKSEK_AVANS") cumle.push(`Avans referansın ${tl(farkTl)} (%${String(farkYuzde).replace(".", ",")}) üzerinde; dolum fişi ve dönem sonu depo / avans bakiyesi kontrolü önerilir.`);
    else cumle.push(`Avans referansla uyumlu (fark ${tl(farkTl)}, %${String(farkYuzde).replace(".", ",")}).`);
  }
  for (const n of nedenler) cumle.push(n + ".");
  const notlar = [
    "“Yüksek avans” gerçek tüketim fazlası ya da kötüye kullanım kanıtı değildir: ödenen avans paradır, pompadaki dolum değildir.",
    "Başlangıç bakiyesi bilinmiyor: 1 Kasım'daki depo seviyesi ve kullanılmamış avans kayıtlı değil; yakıt sonraki döneme kalmış olabilir.",
  ];
  if (rolantiSn > 0) notlar.push(`Dönemde ${Math.round(rolantiSn / 60)} dk rölanti var; rölantide yakılan yakıt km'ye yansımaz.`);
  if (eksikGun.length) notlar.push(`${eksikGun.length} günde km verisi yok; bu günler sıfır sayılmadı, beklenen ihtiyaç eksik kalabilir.`);
  if (donem.t0_kirpildi) notlar.push(donem.not);
  if (donem.devam_ediyor) notlar.push("Bugün devam ediyor; bugünün km ve avansı henüz tamamlanmadı.");
  if (opRef && fiyatsizGun.length) notlar.push("Yakıt birim fiyatı kaynağı eksik olduğu için TL karşılaştırması yapılmadı.");

  const ozet = {
    toplam_km: toplamKm, veri_gun: veriGun.length, eksik_gunler: eksikGun, hareket_sn: hareketSn, rolanti_sn: rolantiSn,
    referans_l100: referans ? Number(referans.l100) : null, operasyon_l100: opRef, beklenen_litre: beklenenL,
    fiyatsiz_gunler: fiyatsizGun,
    ...(tutarGor ? { avans_tl: avansTl, avans_adet: avansAdet, beklenen_tl: beklenenTl, fark_tl: farkTl, fark_yuzde: farkYuzde,
      avans_tl_km: toplamKm > 0 ? yuv(avansTl / toplamKm, 2) : null } : { avans_adet: avansAdet }),
  };
  const seriCikis = seri.map((x) => tutarGor ? x : {
    tarih: x.tarih, donemde: x.donemde, veri: x.veri, km: x.km, olculmus_sifir: x.olculmus_sifir, hareket_sn: x.hareket_sn, rolanti_sn: x.rolanti_sn,
    kontak_acik_sn: x.kontak_acik_sn, beklenen_litre: x.beklenen_litre, kum_beklenen_litre: x.kum_beklenen_litre, devam: x.devam,
    avans_adet: x.avanslar.length, avanslar: x.avanslar.map((a) => ({ id: a.id, talep_tarihi: a.talep_tarihi, odeme_tarihi: a.odeme_tarihi, arac_km: a.arac_km })),
    uyarilar: x.uyarilar.filter((u) => !/fiyat/i.test(u)) });
  return {
    durum: tutarGor ? durum : "YETKI_YOK",
    durum_ad: tutarGor ? DURUM_AD[durum] : "Yakıt avansı tutarlarını görme yetkiniz yok — yalnız km ve beklenen litre gösterilir",
    on_degerlendirme: tutarGor ? onDegerlendirme : null, on_degerlendirme_ad: tutarGor && onDegerlendirme ? DURUM_AD[onDegerlendirme] : null,
    yorum: tutarGor ? cumle.join(" ") : cumle.filter((c) => !/TL|avans/i.test(c)).join(" "),
    notlar, ozet, seri: seriCikis,
    teyit: tutarGor ? (avans?.teyit || []) : (avans?.teyit || []).map((t) => ({ id: t.id, talep_tarihi: t.talep_tarihi, odeme_tarihi: t.odeme_tarihi, neden: t.neden.replace(/tutar, /, "") })),
    formul: {
      operasyon_referansi: `resmî L/100 km × ${1 + esik.operasyon_payi}`,
      beklenen_litre: "doğrulanmış günlük km × operasyon referansı / 100 (yalnız km verisi olan günler)",
      beklenen_bedel: "her gün: beklenen litre × o gün geçerli doğrulanmış birim fiyat; günler toplanır (fiyatı olmayan gün varsa TL karşılaştırması yapılmaz)",
      avans: "ödeme tarihi dönem içinde olan, ödenmiş Yakıt iş avansları (talep tarihi ayrıca gösterilir)",
      fark: "avans − beklenen bedel; yüzde = fark / beklenen bedel",
    },
    esik: { ...esik },
  };
}

// ── Araçtaki malzemeler (defterden; saf) ──────────────────────────────────────────────────────────────────────────
// islemler: bu iş kodlarının hw_malzeme_islem satırları (kalemleriyle) — { id, tur, site_code, fiziksel_id, kaynak_tip, kaynak_id,
//   hedef_tip, hedef_id, islem_tarihi, ters_islem_id, ters_edilen_id, arac_plaka, created_at, kalemler:[{anahtar, ad, kod, birim, miktar}] }
// plaka: bu aracın normalize plakası. ekipler: bu aracı tarihli olarak kullanan ekip_no'lar (seçilen gün).
// fiili: Map(kod → fiiliDurum sonucu). Dönen her kalem durumu ayrı satırdır; farklı birimler TOPLANMAZ.
// "Ekipte" ile "bu araçta" ayrıdır: ekip bakiyesi yalnız ekibe son giriş hareketinde (teslim / devir) BU araç plakası seçilmişse
// "araçta (bağlantı doğrulandı)" sayılır. Ekibin tüm malzemesi mevcut aracına otomatik yüklenmiş SAYILMAZ.
function aracMalzemeleri({ islemler = [], plaka, ekipler = [], fiili = new Map(), ekipAd = (n) => `Ekip ${n}` }) {
  const P = plakaNorm(plaka);
  const ekipSet = new Set(ekipler.map(Number));
  const kodlar = [...new Set(islemler.map((i) => i.site_code))];
  const sonuc = [];
  for (const kod of kodlar) {
    const isl = islemler.filter((i) => i.site_code === kod).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || Number(a.id) - Number(b.id));
    const bak = new Map(); // lok → anahtar → miktar
    const kalemAd = new Map();
    const ekle = (lok, an, m) => { const x = bak.get(lok) || bak.set(lok, new Map()).get(lok); x.set(an, Math.round(((x.get(an) || 0) + m) * 1000) / 1000); };
    // Ekibe son GİRİŞ hareketi (ters edilmemiş): araç plakası taşıyor mu
    const sonGiris = new Map(); // ekip → islem
    let devirdenCikan = new Set(), depoyaDonen = false;
    for (const i of isl) {
      const kaynak = i.kaynak_id == null || i.kaynak_id === "" ? i.kaynak_tip : `${i.kaynak_tip}:${i.kaynak_id}`;
      const hedef = i.hedef_id == null || i.hedef_id === "" ? i.hedef_tip : `${i.hedef_tip}:${i.hedef_id}`;
      for (const k of i.kalemler || []) { kalemAd.set(k.anahtar, { ad: k.ad, kod: k.kod, birim: k.birim }); ekle(kaynak, k.anahtar, -Number(k.miktar)); ekle(hedef, k.anahtar, Number(k.miktar)); }
      if (i.tur !== "TERS" && !i.ters_islem_id && i.hedef_tip === "EKIP" && ["EKIBE_TESLIM", "DEVIR"].includes(i.tur)) sonGiris.set(String(i.hedef_id), i);
      if (i.tur === "DEVIR" && !i.ters_islem_id) devirdenCikan.add(String(i.kaynak_id));
      if (i.tur === "DEPOYA_DONUS" && !i.ters_islem_id) depoyaDonen = true;
    }
    const f = fiili.get(kod) || null;
    const sahadaBasladi = !!(f && ["DEVAM", "TAMAMLANDI"].includes(f.kod));
    const satirlar = [];
    for (const [lok, m] of bak) {
      const [tip, id] = lok.split(":");
      for (const [an, v] of m) {
        if (!(v > 0)) continue;
        const k = { ...kalemAd.get(an), anahtar: an, miktar: v };
        if (tip === "EKIP") {
          const g = sonGiris.get(String(id));
          const aracta = !!(g && plakaNorm(g.arac_plaka) === P && P);
          const buEkip = ekipSet.has(Number(id));
          if (!aracta && !buEkip) continue; // başka ekibin, bu araçla bağı olmayan malzemesi listelenmez
          satirlar.push({ ...k, lok_tip: "EKIP", ekip_no: Number(id), ekip_ad: ekipAd(Number(id)),
            durum: aracta ? "ARACTA" : "EKIPTE_ARAC_DOGRULANMADI",
            durum_ad: aracta ? `Araca yüklendi · araç bağlantısı doğrulandı (${g.tur === "DEVIR" ? "devir" : "teslim"} #${g.id}, ${gunStr(g.islem_tarihi).split("-").reverse().join(".")})` : "Ekibe teslim edildi · bu araçta olduğu doğrulanmadı",
            kullanim_teyidi: sahadaBasladi });
        } else if (tip === "DEPO") satirlar.push({ ...k, lok_tip: "DEPO", depo_id: id ? Number(id) : null, durum: depoyaDonen ? "DEPOYA_DONDU" : "DEPODA", durum_ad: depoyaDonen ? "Depoya döndü" : "Depoda · ekibe teslim bekliyor" });
        else if (tip === "SAHA") satirlar.push({ ...k, lok_tip: "SAHA", durum: "KULLANILDI", durum_ad: "Sahada kullanıldı" });
        else if (tip === "IADE") satirlar.push({ ...k, lok_tip: "IADE", durum: "IADE", durum_ad: "Huawei'ye iade edildi" });
      }
    }
    if (!satirlar.length) continue;
    // Kısmen kullanıldı: aynı kalemden hem SAHA hem EKIP bakiyesi varsa ekip satırı "kalan ekipte" olarak işaretlenir
    const sahadaAn = new Set(satirlar.filter((s) => s.durum === "KULLANILDI").map((s) => s.anahtar));
    for (const s of satirlar) if (s.lok_tip === "EKIP" && sahadaAn.has(s.anahtar)) { s.kismen_kullanildi = true; s.durum_ad += " · kısmen kullanıldı, kalan ekipte"; }
    const devredildi = [...devirdenCikan].some((e) => ekipSet.has(Number(e))) && !satirlar.some((s) => s.lok_tip === "EKIP" && ekipSet.has(s.ekip_no));
    sonuc.push({ site_code: kod, fiziksel_id: isl[0]?.fiziksel_id || null, fiili: f ? { kod: f.kod, ad: f.ad, baslama: f.baslama, bitis: f.bitis, kaynak: f.kaynak, qc: f.qc } : null,
      sahada_kullanim_teyidi: sahadaBasladi && satirlar.some((s) => s.lok_tip === "EKIP" && s.durum === "ARACTA"),
      baska_ekibe_devredildi: devredildi, kalemler: satirlar });
  }
  // Özet kartları (kalem satırı sayısı; farklı birimler toplanmaz)
  const say = (fn) => sonuc.reduce((t, s) => t + s.kalemler.filter(fn).length, 0);
  return {
    isler: sonuc.sort((a, b) => String(a.fiziksel_id || a.site_code).localeCompare(String(b.fiziksel_id || b.site_code)) || a.site_code.localeCompare(b.site_code)),
    ozet: {
      yuklu: say((k) => k.durum === "ARACTA"),                                  // araçtaki tüm kalemler (teyit bekleyenler dahil)
      kullanim_teyidi_bekleyen: say((k) => k.durum === "ARACTA" && k.kullanim_teyidi),
      ekipte_arac_dogrulanmadi: say((k) => k.durum === "EKIPTE_ARAC_DOGRULANMADI"),
      depoda_bekleyen: say((k) => k.durum === "DEPODA"),
      malzemeli_is: sonuc.filter((s) => s.kalemler.some((k) => k.durum === "ARACTA")).length,
    },
  };
}

module.exports = { YAKIT_T0, ESIK_VARSAYILAN, esikler, donemCoz, avansSec, gunFiyati, yakitAnalizi, aracMalzemeleri, plakaNorm, gunAraligi, gunEkle, gunStr };
