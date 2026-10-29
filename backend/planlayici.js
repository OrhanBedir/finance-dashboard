// ═══ EKİP PLANLAYICI (29.10.2026, Orhan — Rollout haritası "Plan Yap") ══════════════════════════════════════════════
// Saf hesap (DB / ağ yok). Sunucu girdileri hazırlar (ekip, sahalar, karayolu süreleri, mevcut atamalar), bu modül gün gün
// takvim üretir; kayıt yalnız kullanıcı onayıyla /plan/onayla'da mevcut İş Ata sistemine yazılır.
// Kurallar (özet):
//  • Saatler Europe/Istanbul yerel saatidir (UTC+3, yaz saati yok); çıktı "YYYY-MM-DDTHH:MM:00+03:00".
//  • Pazar çalışılmaz. Resmî tatil görünür uyarıyla atlanır (sessizce çalışma günü sayılmaz).
//  • Çalışma penceresi (başlangıç–bitiş) ve mola girdidir; PAR / kesinti aralığı çalışma kapasitesi DEĞİLDİR, yalnız sahaya
//    erişim penceresidir. Geceye taşırma ve çalışma saatini uzatma yapılmaz.
//  • İş süresi ekip-gün × günlük üretim kapasitesi (saat). 0,7 gün = kapasitenin %70'i. Yol, teslim alma ve diğer faaliyetler
//    ayrıca eklenir; günlük montaj üretim kapasitesini aşmaz.
//  • Yol süresi yalnız verilen karayolu süresidir (rota servisi ya da kullanıcının MANUEL varsayımı); kuş uçuşu kullanılmaz.
//    Süre yoksa o bacak planlanmaz ve "Yol süresi doğrulanamadı" olarak istenir. Canlı trafik yoktur.
//  • Malzeme teslim alma: planlanan teslimden önce montaj başlamaz; malzeme ekipteyse depo yolu eklenmez. Depoda hazır olma
//    ile fiilen teslim alma ayrıdır. Planlanan teslim GERÇEKLEŞMİŞ teslim kaydı değildir.
//  • Konaklama: BOLGEDE (son sahada konaklanır, ertesi gün oradan) / DONUS (her akşam başlangıç noktasına dönüş — dönüş yolu
//    o günün kapasitesinden düşülür).
//  • Dönem dışına taşan iş "Sonraki döneme kalan" listesine girer (kaybolmaz).
"use strict";

// Resmî tatiller — puantaj modülündeki TR_TATIL listesiyle aynı (server.js · puantaj); arife yarım günleri dahil
const TR_TATIL = ["2026-01-01","2026-03-18","2026-03-19","2026-03-20","2026-03-21","2026-03-22","2026-04-23","2026-05-01","2026-05-19","2026-05-26","2026-05-27","2026-05-28","2026-05-29","2026-07-15","2026-08-30","2026-10-29",
  "2027-01-01","2027-03-08","2027-03-09","2027-03-10","2027-03-11","2027-03-12","2027-04-23","2027-05-01","2027-05-16","2027-05-17","2027-05-18","2027-05-19","2027-07-15","2027-08-30","2027-10-29"];
const GUN_AD = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

const dk = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const saat = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
const tarihMi = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const gunEkle = (t, n) => { const d = new Date(`${t}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const haftaGunu = (t) => new Date(`${t}T00:00:00Z`).getUTCDay();
const iso = (t, m) => `${t}T${saat(m)}:00+03:00`;
const yuvarla = (x) => Math.round(x);

// Varsayılan dönem: cumartesi / pazar hazırlanırsa sonraki pazartesi; bitiş o haftanın cumartesisi
function varsayilanDonem(bugun, baslangic) {
  let b = tarihMi(baslangic) ? baslangic : bugun;
  if (!tarihMi(baslangic)) { const g = haftaGunu(b); if (g === 6) b = gunEkle(b, 2); else if (g === 0) b = gunEkle(b, 1); }
  if (haftaGunu(b) === 0) b = gunEkle(b, 1);
  const bit = gunEkle(b, (6 - haftaGunu(b) + 7) % 7);
  return { baslangic: b, bitis: bit };
}

// Karayolu süresi tablosu: anahtar "A>B" → { dk, km, kaynak }
function yolAl(tablo, a, b) {
  if (a === b) return { dk: 0, km: 0, kaynak: "AYNI_NOKTA" };
  return tablo[`${a}>${b}`] || tablo[`${b}>${a}`] || null;
}

// Akıllı sıra: karayolu süresine göre en yakın komşu + 2-opt (açık yol). Süresi bilinmeyen sahalar sona, gerekçeyle.
function siraOner(baslangicAnahtar, isler, tablo) {
  const bilinen = isler.filter((x) => x.konum), konumsuz = isler.filter((x) => !x.konum);
  const kalan = [...bilinen], sira = []; let pos = baslangicAnahtar; const eksik = [];
  while (kalan.length) {
    let en = null;
    for (const x of kalan) { const y = yolAl(tablo, pos, x.anahtar); if (y && (!en || y.dk < en.y.dk)) en = { x, y }; }
    if (!en) { for (const x of kalan) eksik.push(x); break; }
    sira.push(en.x); kalan.splice(kalan.indexOf(en.x), 1); pos = en.x.anahtar;
  }
  const toplam = (s) => { let t = 0, p = baslangicAnahtar; for (const x of s) { const y = yolAl(tablo, p, x.anahtar); if (!y) return Infinity; t += y.dk; p = x.anahtar; } return t; };
  let iyi = sira, iyiT = toplam(sira), gelisti = true;
  while (gelisti && iyi.length > 2) {
    gelisti = false;
    for (let i = 0; i < iyi.length - 1; i++) for (let j = i + 1; j < iyi.length; j++) {
      const aday = [...iyi.slice(0, i), ...iyi.slice(i, j + 1).reverse(), ...iyi.slice(j + 1)];
      const t = toplam(aday);
      if (t + 0.5 < iyiT) { iyi = aday; iyiT = t; gelisti = true; }
    }
  }
  return { sira: [...iyi, ...eksik, ...konumsuz], toplamYolDk: Number.isFinite(iyiT) ? iyiT : null,
    gerekce: "Sıra karayolu sürelerine göre seçildi: başlangıçtan en yakın sahadan başlanıp her adımda en yakın sonraki saha alındı, sonra toplam yol süresini kısaltan yer değişimleri (2-opt) denendi. Kuş uçuşu mesafe kullanılmadı.",
    eksik: eksik.map((x) => x.kod), konumsuz: konumsuz.map((x) => x.kod) };
}

function planla(girdi) {
  const C = { bas: "08:00", bit: "18:00", molaBas: "12:00", molaDk: 60, kapasiteSaat: 8, minBlokDk: 60, surusPayYuzde: 0, ...(girdi.calisma || {}) };
  const basDk = dk(C.bas), bitDk = dk(C.bit), molaBasDk = dk(C.molaBas), molaDk = Math.max(0, Number(C.molaDk) || 0);
  const kapasiteDk = Math.max(30, Number(C.kapasiteSaat) * 60);
  const minBlok = Math.max(15, Number(C.minBlokDk) || 60);
  const pay = 1 + Math.max(0, Number(C.surusPayYuzde) || 0) / 100;
  const tatiller = new Set(girdi.tatiller || TR_TATIL);
  const tablo = girdi.yolTablosu || {};
  const donem = { ...varsayilanDonem(girdi.bugun || new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10), girdi.donem?.baslangic), ...(tarihMi(girdi.donem?.bitis) ? { bitis: girdi.donem.bitis } : {}) };
  const uyarilar = [], varsayimlar = [], eksikYollar = [], kalanlar = [];
  const gunler = new Map(); // tarih → { segmentler, montajDk }
  if (!(basDk != null && bitDk != null && bitDk > basDk)) return { hata: "Çalışma başlangıç / bitiş saati geçersiz" };
  varsayimlar.push(`Çalışma penceresi ${C.bas}–${C.bit}, mola ${C.molaBas} (${molaDk} dk), günlük üretim kapasitesi ${C.kapasiteSaat} saat, en kısa iş bloğu ${minBlok} dk`);
  varsayimlar.push(Number(C.surusPayYuzde) > 0 ? `Sürüş / mola payı: yol sürelerine %${C.surusPayYuzde} eklendi` : "Sürüş molası payı girilmedi (%0); canlı trafik bilgisi yok");
  varsayimlar.push(girdi.konaklama === "DONUS" ? "Her akşam başlangıç noktasına dönülür; dönüş yolu günlük kapasiteden düşülür" : "Ekip bölgede konaklar; ertesi gün son bulunduğu sahadan başlar");
  varsayimlar.push("İş süreleri Orhan'ın planlama varsayımlarıdır; kesin bitiş ya da gerçekleşme kaydı değildir");

  // ── Günlük boş aralıklar (mola + mevcut meşguliyetler + sabit faaliyetler düşülür) ──
  const mesgul = (girdi.mesgul || []).filter((m) => tarihMi(m.tarih));
  const sabitFaaliyet = (girdi.faaliyetler || []).filter((f) => tarihMi(f.tarih) && dk(f.saat) != null && Number(f.sureDk) > 0);
  const gunKaydi = (t) => {
    if (!gunler.has(t)) {
      const g = haftaGunu(t);
      gunler.set(t, { tarih: t, gun_adi: GUN_AD[g], segmentler: [], montajDk: 0, calisma: g !== 0 && !tatiller.has(t), not: g === 0 ? "Pazar — çalışma yok" : tatiller.has(t) ? "Resmî tatil — planlanmadı" : null });
    }
    return gunler.get(t);
  };
  const doluAraliklar = (t) => {
    const d = [];
    if (molaDk > 0 && molaBasDk != null) d.push([molaBasDk, molaBasDk + molaDk, "Mola"]);
    for (const m of mesgul) if (m.tarih === t) d.push([m.bas ? dk(m.bas) : basDk, m.bit ? dk(m.bit) : bitDk, m.aciklama || "Mevcut atama"]);
    for (const f of sabitFaaliyet) if (f.tarih === t) d.push([dk(f.saat), dk(f.saat) + Number(f.sureDk), f.ad || f.kategori || "Faaliyet"]);
    return d.sort((a, b) => a[0] - b[0]);
  };
  const bosAraliklar = (t, bas = basDk, son = bitDk) => {
    let parca = [[Math.max(bas, basDk), Math.min(son, bitDk)]];
    for (const [a, b] of doluAraliklar(t)) {
      const yeni = [];
      for (const [x, y] of parca) { if (b <= x || a >= y) yeni.push([x, y]); else { if (a > x) yeni.push([x, a]); if (b < y) yeni.push([b, y]); } }
      parca = yeni;
    }
    return parca.filter(([x, y]) => y > x);
  };
  const bosToplam = (t, from, to = bitDk) => bosAraliklar(t, from, to).reduce((s, [x, y]) => s + (y - x), 0);
  // Süreyi boş aralıklara yerleştir (mola / meşguliyet arasında bölünebilir). Dönen: bitiş dakikası ya da null
  const yerlestir = (t, from, sure, seg, sinir = bitDk) => {
    let kalanS = sure, cur = from; const parcalar = [];
    for (const [x, y] of bosAraliklar(t, from, sinir)) {
      if (kalanS <= 0) break;
      const a = Math.max(x, cur), b = Math.min(y, a + kalanS);
      if (b > a) { parcalar.push([a, b]); kalanS -= b - a; cur = b; }
    }
    if (kalanS > 0.5) return null;
    const G = gunKaydi(t);
    for (const [a, b] of parcalar) G.segmentler.push({ ...seg, bas: iso(t, a), bit: iso(t, b), bas_saat: saat(a), bit_saat: saat(b), dk: yuvarla(b - a) });
    return parcalar.length ? parcalar[parcalar.length - 1][1] : from;
  };
  const sonrakiCalismaGunu = (t) => {
    let n = gunEkle(t, 1);
    for (let i = 0; i < 14; i++) {
      const g = gunKaydi(n);
      if (g.calisma) return n;
      if (tatiller.has(n) && haftaGunu(n) !== 0) uyarilar.push(`${n} resmî tatil — plan bu günü atladı (gerekirse elle ekleyin)`);
      n = gunEkle(n, 1);
    }
    return n;
  };
  for (let t = donem.baslangic; t <= donem.bitis; t = gunEkle(t, 1)) gunKaydi(t);
  for (const t of [...gunler.keys()]) if (tatiller.has(t) && haftaGunu(t) !== 0) uyarilar.push(`${t} resmî tatil — çalışma günü sayılmadı`);
  for (const f of sabitFaaliyet) {
    const G = gunKaydi(f.tarih);
    if (f.tarih < donem.baslangic || f.tarih > donem.bitis) uyarilar.push(`"${f.ad || f.kategori}" plan dönemi dışında (${f.tarih})`);
    G.segmentler.push({ tur: "FAALIYET", ad: f.ad || f.kategori, kategori: f.kategori, kod: f.kod || null, konum: f.konum || null, aciklama: f.aciklama || null,
      bas: iso(f.tarih, dk(f.saat)), bit: iso(f.tarih, dk(f.saat) + Number(f.sureDk)), bas_saat: f.saat, bit_saat: saat(dk(f.saat) + Number(f.sureDk)), dk: Number(f.sureDk) });
  }

  // ── Durum ──
  let t = donem.baslangic; if (!gunKaydi(t).calisma) t = sonrakiCalismaGunu(t);
  let m = basDk, pos = "BASLANGIC", posAd = girdi.baslangicKonum?.ad || "Başlangıç";
  const yol = (a, b, aAd, bAd) => {
    const y = yolAl(tablo, a, b);
    if (!y) { if (!eksikYollar.some((e) => e.a === a && e.b === b)) eksikYollar.push({ a, b, a_ad: aAd, b_ad: bAd }); return null; }
    return { ...y, dk: Math.ceil(y.dk * pay) };
  };
  const donemBitti = () => t > donem.bitis;
  // Gün sonu: DONUS'ta başlangıca dönüş (rezerve edilmişti), sonra sonraki çalışma günü
  const gunuKapat = () => {
    if (girdi.konaklama === "DONUS" && pos !== "BASLANGIC") {
      const y = yol(pos, "BASLANGIC", posAd, girdi.baslangicKonum?.ad);
      if (y) { const son = yerlestir(t, m, y.dk, { tur: "YOL", ad: `${posAd} → ${girdi.baslangicKonum?.ad || "Başlangıç"} (dönüş)`, km: y.km, kaynak: y.kaynak }); if (son == null) uyarilar.push(`${t}: dönüş yolu çalışma penceresine sığmadı`); }
      pos = "BASLANGIC"; posAd = girdi.baslangicKonum?.ad || "Başlangıç";
    }
    t = sonrakiCalismaGunu(t); m = basDk;
  };
  const donusPayi = () => (girdi.konaklama === "DONUS" && pos !== "BASLANGIC" ? (yolAl(tablo, pos, "BASLANGIC")?.dk ?? 0) * pay : 0);

  // ── Malzeme teslimleri ──
  const malzeme = girdi.malzeme || { durum: "GEREKMIYOR" };
  const teslimler = malzeme.durum === "TESLIM" ? [...(malzeme.teslimler || [])].filter((x) => tarihMi(x.tarih) && dk(x.saat) != null)
    .sort((a, b) => (a.tarih + a.saat).localeCompare(b.tarih + b.saat)) : [];
  if (malzeme.durum === "TESLIM" && !teslimler.length) return { hata: "Malzeme teslim alınacak seçildi ama teslim tarihi / saati girilmedi" };
  if (malzeme.durum === "EKIPTE") varsayimlar.push("Malzeme ekipte / daha önce teslim alındı — depo ziyareti eklenmedi");
  if (malzeme.durum === "GEREKMIYOR") varsayimlar.push("Bu iş için malzeme teslim alma gerekmiyor");
  const teslimYap = (x, i) => {
    const anahtar = `TESLIM:${i}`, ad = x.nokta?.ad || "Teslim noktası";
    if (x.tarih < donem.baslangic || x.tarih > donem.bitis) uyarilar.push(`Malzeme teslimi (${x.tarih} ${x.saat}) plan dönemi dışında`);
    if (x.hazir?.tarih && (x.hazir.tarih + (x.hazir.saat || "00:00")) > (x.tarih + x.saat)) uyarilar.push(`${ad}: malzemenin depoda hazır olacağı zaman (${x.hazir.tarih} ${x.hazir.saat || ""}) teslim almadan sonra — teslim saatini kontrol edin`);
    // teslim gününe gel
    if (x.tarih > t || (x.tarih === t && false)) { while (t < x.tarih) { gunKaydi(t).not = gunKaydi(t).not || "Malzeme teslimi bekleniyor — montaj başlamaz"; gunuKapat(); } }
    if (!gunKaydi(t).calisma) t = sonrakiCalismaGunu(t);
    const hedef = dk(x.saat);
    const y = yol(pos, anahtar, posAd, ad);
    if (!y) return false;
    let cikis = Math.max(m, hedef - y.dk);
    if (hedef - y.dk < basDk) uyarilar.push(`${x.tarih}: ${x.saat} teslimine yetişmek için ${saat(hedef - y.dk)}'de yola çıkmak gerekir; çalışma ${C.bas}'de başladığı için teslim gecikir`);
    if (y.dk > 0) { const son = yerlestir(t, cikis, y.dk, { tur: "YOL", ad: `${posAd} → ${ad}`, km: y.km, kaynak: y.kaynak }); if (son == null) { uyarilar.push(`${x.tarih}: depo yolu çalışma penceresine sığmadı`); return false; } m = son; }
    const sure = Math.max(5, Number(x.sureDk) || 30);
    const tb = Math.max(m, hedef);
    if (x.nokta?.acilis && tb < dk(x.nokta.acilis)) uyarilar.push(`${ad} ${x.nokta.acilis}'de açılıyor; teslim ${saat(tb)}`);
    if (x.nokta?.kapanis && tb + sure > dk(x.nokta.kapanis)) uyarilar.push(`${ad} ${x.nokta.kapanis}'de kapanıyor; teslim ${saat(tb + sure)}'e kadar sürüyor`);
    const son = yerlestir(t, tb, sure, { tur: "TESLIM", ad: `Malzeme teslim alma — ${ad}`, aciklama: "Planlanan teslim (gerçekleşmiş teslim kaydı değildir)" });
    if (son == null) { uyarilar.push(`${x.tarih}: teslim alma çalışma penceresine sığmadı`); return false; }
    m = son; pos = anahtar; posAd = ad; return true;
  };
  let tIdx = 0;
  if (teslimler.length) { if (!teslimYap(teslimler[0], 0)) uyarilar.push("İlk malzeme teslimi planlanamadı — montaj planı teslim olmadan başlatılmadı"); tIdx = 1; }
  const ilkTeslimTamam = !teslimler.length || gunler.get(teslimler[0].tarih)?.segmentler.some((s) => s.tur === "TESLIM");

  // ── Sıra ──
  const isler = (girdi.isler || []).map((x) => ({ ...x, anahtar: `IS:${x.kod}` }));
  let sira = isler, siraBilgi = null;
  if (girdi.mod === "ASISTAN") { siraBilgi = siraOner(pos, isler, tablo); sira = siraBilgi.sira; }
  const kalanEkle = (x, kalanDk, neden) => kalanlar.push({ kod: x.kod, ad: x.ad, kalan_saat: kalanDk != null ? Math.round(kalanDk / 6) / 10 : null, neden });

  for (const x of sira) {
    if (!ilkTeslimTamam) { kalanEkle(x, null, "Malzeme teslimi planlanamadı"); continue; }
    if (donemBitti()) { kalanEkle(x, x.sureGun ? x.sureGun * kapasiteDk : null, "Plan dönemi doldu"); continue; }
    if (!(Number(x.sureGun) > 0)) { kalanEkle(x, null, x.sureGerekce || "İş süresi yok — süreyi girin"); continue; }
    if (!x.konum) { kalanEkle(x, x.sureGun * kapasiteDk, "Saha konumu yok — yol planlanamadı"); continue; }
    // Manuel planda kullanıcının verdiği en erken başlangıç (gün / saat): öncesine iş konmaz
    if (x.enErken?.tarih) {
      while (t < x.enErken.tarih && !donemBitti()) gunuKapat();
      if (t === x.enErken.tarih && x.enErken.saat && dk(x.enErken.saat) > m) m = dk(x.enErken.saat);
      if (x.enErken.tarih < donem.baslangic || x.enErken.tarih > donem.bitis) uyarilar.push(`${x.kod}: seçilen başlangıç (${x.enErken.tarih}) plan dönemi dışında`);
    }
    if (donemBitti()) { kalanEkle(x, x.sureGun * kapasiteDk, "Plan dönemi doldu"); continue; }
    let kalanDk = Number(x.sureGun) * kapasiteDk, ilkGun = true, varildi = false;
    const erisimBas = x.erisim?.bas ? dk(x.erisim.bas) : null, erisimBit = x.erisim?.bit ? dk(x.erisim.bit) : null;
    let guvenlik = 0;
    while (kalanDk > 0.5 && guvenlik++ < 60) {
      if (donemBitti()) break;
      // Ara teslimler (birden fazla teslim noktası): zamanı gelince yapılır
      while (tIdx < teslimler.length && (teslimler[tIdx].tarih < t || (teslimler[tIdx].tarih === t && dk(teslimler[tIdx].saat) <= m))) { teslimYap(teslimler[tIdx], tIdx); tIdx++; varildi = false; }
      // sahaya git
      if (!varildi || pos !== x.anahtar) {
        const y = yol(pos, x.anahtar, posAd, x.ad);
        if (!y) break;
        const gerek = y.dk + Math.min(minBlok, kalanDk) + (girdi.konaklama === "DONUS" ? (yolAl(tablo, x.anahtar, "BASLANGIC")?.dk ?? 0) * pay : 0);
        if (bosToplam(t, m) < gerek) {
          // Yalnız BOŞ bir çalışma gününe bile sığmıyorsa imkânsız; dolu (meşgul) gün atlanır
          const tamGun = bitDk - basDk - molaDk;
          if (tamGun < y.dk + (girdi.konaklama === "DONUS" ? (yolAl(tablo, x.anahtar, "BASLANGIC")?.dk ?? 0) * pay : 0) + 1) { uyarilar.push(`${x.kod}: yol tek çalışma gününe sığmıyor (${y.dk} dk)`); break; }
          // bugün yol + en az bir iş bloğu sığmıyor: BOLGEDE ise yol bugün yapılabilir (sığıyorsa), montaj ertesi gün
          if (girdi.konaklama !== "DONUS" && bosToplam(t, m) >= y.dk && y.dk >= 60) {
            const son = yerlestir(t, m, y.dk, { tur: "YOL", ad: `${posAd} → ${x.ad}`, km: y.km, kaynak: y.kaynak, kod: x.kod });
            if (son != null) { m = son; pos = x.anahtar; posAd = x.ad; varildi = true; gunKaydi(t).not = gunKaydi(t).not || "Yol + konaklama; montaj ertesi gün"; }
          }
          gunuKapat(); continue;
        }
        const son = yerlestir(t, m, y.dk, { tur: "YOL", ad: `${posAd} → ${x.ad}`, km: y.km, kaynak: y.kaynak, kod: x.kod });
        if (son == null) { gunuKapat(); continue; }
        m = son; pos = x.anahtar; posAd = x.ad; varildi = true;
      }
      // erişim penceresi (PAR / kesinti): çalışma yalnız bu aralıkta
      if (erisimBas != null && m < erisimBas) m = erisimBas;
      const sinir = Math.min(bitDk, erisimBit != null ? erisimBit : bitDk);
      const sonrakiTeslim = tIdx < teslimler.length && teslimler[tIdx].tarih === t ? dk(teslimler[tIdx].saat) - ((yolAl(tablo, x.anahtar, `TESLIM:${tIdx}`)?.dk ?? 0) * pay) : null;
      const ust = sonrakiTeslim != null ? Math.min(sinir, sonrakiTeslim) : sinir;
      const bos = bosToplam(t, m, ust) - donusPayi();
      const kapKalan = kapasiteDk - gunKaydi(t).montajDk;
      const blok = Math.min(kalanDk, bos, kapKalan);
      if (blok < Math.min(minBlok, kalanDk) - 0.5) { if (sonrakiTeslim != null) { m = Math.max(m, sonrakiTeslim); continue; } gunuKapat(); continue; }
      const parca = Math.floor(blok);
      const toplamDk = Number(x.sureGun) * kapasiteDk;
      const yapilan = toplamDk - kalanDk + parca;
      const son = yerlestir(t, m, parca, { tur: "MONTAJ", ad: x.ad, kod: x.kod, kategori: x.kategori || "NEW_SITE",
        aciklama: `${x.isAd || "Montaj"} — ${yapilan >= toplamDk - 0.5 ? (ilkGun ? "tamamı" : "son kısım") : `kısmi (${Math.round(yapilan / 6) / 10} / ${Math.round(toplamDk / 6) / 10} saat)`}`,
        sure_kaynak: x.sureKaynak || null }, ust);
      if (son == null) { gunuKapat(); continue; }
      gunKaydi(t).montajDk += parca; kalanDk -= parca; m = son; ilkGun = false;
      if (kalanDk > 0.5) gunuKapat();
    }
    if (kalanDk > 0.5) kalanEkle(x, kalanDk, donemBitti() ? "Plan dönemi doldu — kalan kısım sonraki döneme" : "Yol süresi / kapasite nedeniyle yerleştirilemedi");
  }
  // son gün dönüşü
  if (!donemBitti() && girdi.konaklama === "DONUS" && pos !== "BASLANGIC") {
    const y = yol(pos, "BASLANGIC", posAd, girdi.baslangicKonum?.ad);
    if (y) yerlestir(t, m, y.dk, { tur: "YOL", ad: `${posAd} → ${girdi.baslangicKonum?.ad || "Başlangıç"} (dönüş)`, km: y.km, kaynak: y.kaynak });
  }
  if (eksikYollar.length) uyarilar.push(`${eksikYollar.length} yol bacağının süresi doğrulanamadı — tahmini süreyi girin (MANUEL varsayım olarak işaretlenir)`);
  const liste = [...gunler.values()].sort((a, b) => a.tarih.localeCompare(b.tarih)).map((g) => {
    g.segmentler.sort((a, b) => a.bas.localeCompare(b.bas));
    const kullanilan = g.segmentler.filter((s) => s.tur !== "MOLA").reduce((s, x) => s + x.dk, 0);
    const pencere = g.calisma ? (bitDk - basDk - molaDk) : 0;
    return { ...g, donem_ici: g.tarih >= donem.baslangic && g.tarih <= donem.bitis, kullanilan_dk: kullanilan, pencere_dk: pencere, kalan_dk: Math.max(0, pencere - kullanilan),
      montaj_dk: g.montajDk, kapasite_dk: g.calisma ? kapasiteDk : 0 };
  });
  return { donem, gunler: liste, kalanlar, uyarilar: [...new Set(uyarilar)], varsayimlar, eksik_yollar: eksikYollar,
    sira: sira.map((x) => x.kod), sira_gerekce: siraBilgi?.gerekce || (girdi.mod === "MANUEL" ? "Sıra kullanıcının seçtiği sıradır" : null),
    toplam_yol_dk: siraBilgi?.toplamYolDk ?? null };
}

module.exports = { planla, siraOner, varsayilanDonem, TR_TATIL, dk, saat, gunEkle, haftaGunu };
