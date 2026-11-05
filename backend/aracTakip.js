// 04.11.2026 (Orhan): Triomobil araç takip (GPS) bağlantısı — YALNIZ OKUMA.
// Triomobil "Salih ÇUBUKÇU" hesabındaki araçların (63AKR082, 63AKR853) son konumu ERC haritasında gösterilir.
// API: https://telematik.triomobil.com/fleet/v1 (Swagger: e-posta eki, destek talebi 170666)
//   POST /auth {username, password} → { token }  (48 saat geçerli, her kullanımda uzar, en çok 30 gün)
//   GET  /reports/vehicle/locations/latest      → [{ ts, vehicle:{_id, licensePlate}, location:{lat, lon, address},
//                                                    ignition:"ON"|"OFF", mileage, speed }]
// Kullanıcı adı / şifre koda yazılmaz: Render ortam değişkeni TRIOMOBIL_USERNAME + TRIOMOBIL_PASSWORD
// (Orhan girer). Yalnız GET raporu çağrılır; araç / alarm / komut yazan uçlar hiç kullanılmaz.

const VARSAYILAN_API = "https://telematik.triomobil.com/fleet/v1";
const ONBELLEK_MS = 60 * 1000;      // Triomobil'e en çok dakikada bir istek (tüm kullanıcılar aynı yanıtı paylaşır)
const ZAMAN_ASIMI_MS = 15 * 1000;
const SAYFA_BOYUTU = 50;   // Swagger: trait:pagination:_perPage maximum 50
const SAYFA_SINIRI = 20;   // en çok 1000 araç

const ayar = (env = process.env) => ({
  api: String(env.TRIOMOBIL_API || VARSAYILAN_API).replace(/\/+$/, ""),
  kullanici: String(env.TRIOMOBIL_USERNAME || "").trim(),
  sifre: String(env.TRIOMOBIL_PASSWORD || ""),
});
const yapilandirildi = (env) => { const a = ayar(env); return !!(a.kullanici && a.sifre); };

// Plaka karşılaştırması: büyük harf, boşluk / tire / nokta yok ("63 AKR 082" = "63AKR082")
const plakaNorm = (p) => String(p || "").toLocaleUpperCase("tr-TR").replace(/[^0-9A-ZÇĞİÖŞÜ]/g, "");

let _token = null;           // { deger, api, kullanici }
let _onbellek = null;        // { zaman, veri }
let _bekleyen = null;        // aynı anda gelen istekler tek çağrıyı bekler

async function _istek(url, secenek = {}, fetchFn = fetch) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ZAMAN_ASIMI_MS);
  try {
    const r = await fetchFn(url, { ...secenek, signal: ac.signal });
    const metin = await r.text();
    let govde = null; try { govde = metin ? JSON.parse(metin) : null; } catch { govde = metin; }
    return { durum: r.status, govde };
  } catch (e) {
    throw new Error(e?.name === "AbortError" ? "Triomobil yanıt vermedi (zaman aşımı)" : `Triomobil'e bağlanılamadı: ${e.message}`);
  } finally { clearTimeout(t); }
}

async function _tokenAl(a, fetchFn) {
  const r = await _istek(`${a.api}/auth`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username: a.kullanici, password: a.sifre }) }, fetchFn);
  if (r.durum === 401 || r.durum === 403) throw new Error("Triomobil kullanıcı adı / şifresi kabul edilmedi");
  const tok = r.govde && typeof r.govde === "object" ? r.govde.token : null;
  if (r.durum >= 300 || !tok) throw new Error(`Triomobil oturum açılamadı (HTTP ${r.durum})`);
  _token = { deger: String(tok), api: a.api, kullanici: a.kullanici };
  return _token.deger;
}

// Bir Triomobil kaydını ERC biçimine çevirir (eksik alan null)
function kayitDuzenle(x) {
  const lat = Number(x?.location?.lat), lon = Number(x?.location?.lon);
  const konumVar = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
  const sayi = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const kontak = x?.ignition === "ON" ? "ACIK" : x?.ignition === "OFF" ? "KAPALI" : null;
  return {
    trio_id: x?.vehicle?._id || null,
    plaka: String(x?.vehicle?.licensePlate || "").trim(),
    plaka_norm: plakaNorm(x?.vehicle?.licensePlate),
    lat: konumVar ? lat : null,
    lng: konumVar ? lon : null,
    adres: x?.location?.address ? String(x.location.address) : null,
    hiz: sayi(x?.speed),           // km/s
    kontak,
    km: sayi(x?.mileage),          // Triomobil sayaç değeri (birimi ilk canlı yanıtta teyit edilecek)
    son_sinyal: x?.ts || null,
  };
}

// Sonuç her zaman { ok, yapilandirildi, zaman, araclar[] } ya da { ok:false, error }
async function sonKonumlar({ env = process.env, fetchFn = fetch, simdi = Date.now(), zorla = false } = {}) {
  if (!yapilandirildi(env)) return { ok: true, yapilandirildi: false, araclar: [] };
  if (!zorla && _onbellek && simdi - _onbellek.zaman < ONBELLEK_MS) return _onbellek.veri;
  if (_bekleyen) return _bekleyen;
  _bekleyen = (async () => {
    const a = ayar(env);
    try {
      let tok = _token && _token.api === a.api && _token.kullanici === a.kullanici ? _token.deger : await _tokenAl(a, fetchFn);
      // 04.11.2026 canlı düzeltmeler: _perPage en çok 50 (500 → HTTP 400); rapor vehicleId İSTER ("Either `vehicleId` or
      // `trackerId` query-string parameter should be specified") → önce GET /vehicles ile hesabın araç kimlikleri alınır,
      // sonra konum raporu bu kimliklerle (50'lik gruplar) istenir. Adres yalnız _pull=location.address ile gelir.
      const al = async (yol, ad) => {
        let r = await _istek(`${a.api}${yol}`, { headers: { Authorization: tok, Accept: "application/json" } }, fetchFn);
        if (r.durum === 401) { tok = await _tokenAl(a, fetchFn); r = await _istek(`${a.api}${yol}`, { headers: { Authorization: tok, Accept: "application/json" } }, fetchFn); } // süresi dolmuş anahtar: bir kez yenile
        return r;
      };
      const hata = (ad, r) => {
        const ayrinti = typeof r.govde === "string" ? r.govde.slice(0, 160) : r.govde && typeof r.govde === "object" ? JSON.stringify(r.govde).slice(0, 160) : "";
        return new Error(`Triomobil ${ad} alınamadı (HTTP ${r.durum}${ayrinti ? `: ${ayrinti}` : ""})`);
      };
      // 1) Araç listesi (sayfa sayfa)
      const kimlikler = [];
      for (let sayfa = 1; sayfa <= SAYFA_SINIRI; sayfa++) {
        const r = await al(`/vehicles?_perPage=${SAYFA_BOYUTU}&_page=${sayfa}`);
        if (r.durum >= 300 || !Array.isArray(r.govde)) throw hata("araç listesi", r);
        for (const v of r.govde) if (v && /^[0-9a-fA-F]{24}$/.test(String(v._id || ""))) kimlikler.push(String(v._id));
        if (r.govde.length < SAYFA_BOYUTU) break;
      }
      // 2) Son konumlar: kimlikler 50'lik gruplar halinde (vehicleId tekrarlı parametre). Triomobil grubu 400 ile
      //    reddederse (dizi biçimi uyuşmazlığı) o grup araç başına tek tek sorulur.
      const konumSor = (ids) => al(`/reports/vehicle/locations/latest?${ids.map((id) => `vehicleId=${id}`).join("&")}&_perPage=${SAYFA_BOYUTU}&_page=1&_pull=location.address`);
      const tum = [];
      for (let i = 0; i < kimlikler.length; i += SAYFA_BOYUTU) {
        const grup = kimlikler.slice(i, i + SAYFA_BOYUTU);
        const r = await konumSor(grup);
        if (r.durum < 300 && Array.isArray(r.govde)) { tum.push(...r.govde); continue; }
        if (r.durum !== 400 || grup.length === 1) throw hata("konum raporu", r);
        for (const id of grup) {
          const t = await konumSor([id]);
          if (t.durum >= 300 || !Array.isArray(t.govde)) throw hata("konum raporu", t);
          tum.push(...t.govde);
        }
      }
      const veri = { ok: true, yapilandirildi: true, zaman: new Date(simdi).toISOString(), araclar: tum.map(kayitDuzenle).filter((k) => k.plaka_norm) };
      _onbellek = { zaman: simdi, veri };
      return veri;
    } catch (e) {
      // Son başarılı veri varsa onu "eski" işaretiyle döndür (ekran boş kalmasın)
      if (_onbellek) return { ..._onbellek.veri, eski: true, uyari: e.message };
      return { ok: false, yapilandirildi: true, error: e.message };
    } finally { _bekleyen = null; }
  })();
  return _bekleyen;
}

// ERC araçlarıyla plaka eşleştirmesi: araclar = [{id, plaka, firma, ...}] → { eslesen[], eslesmeyen_trio[] }
function eslestir(erc, trio) {
  const harita = new Map((erc || []).map((a) => [plakaNorm(a.plaka), a]));
  const eslesen = [], eslesmeyen = [];
  for (const t of trio || []) {
    const a = harita.get(t.plaka_norm);
    // ERC kaydı esas: plaka ERC yazımıyla döner, Triomobil'deki yazım plaka_trio'da kalır
    if (a) eslesen.push({ ...t, plaka_trio: t.plaka, arac_id: a.id, plaka: a.plaka, firma: a.firma || null, marka: a.marka || null,
      model: a.model || null, surucu: a.surucu || null, bolge: a.bolge || null });
    else eslesmeyen.push(t);
  }
  return { eslesen, eslesmeyen };
}

// ═══ ARAÇ GEÇMİŞİ: GÜNLÜK KİLOMETRE (04.11.2026, Orhan) ═══════════════════════════════════════════════════
// Kaynak: Triomobil "Driving Summary" raporu (GET /reports/vehicle/driving/summary) — cihazın kendi kilometre sayacından
// hesaplanan mileage.delta + kontak açık/kapalı + rölanti süreleri. GPS noktasından mesafe ÜRETİLMEZ.
// Gün sınırı Türkiye saati (UTC+3, yaz saati yok): rapor SAATLİK (_groupBy=hour) istenir, saatler TR gününe toplanır —
// Triomobil'in "gün" gruplamasının hangi saat dilimini kullandığı belgede yazmadığı için ona güvenilmez.
// Rapor satırı olmayan gün "Veri yok" (null), satırı olup farkı 0 olan gün ölçülmüş "0 km".
// Canlıda doğrulanan sınırlar (04.11.2026): rapor TEK İSTEKTE EN ÇOK 7 GÜN ("Maximum allowed interval is 7 day(s)") → dönem
// 7 TR günlük pencerelere bölünür. Konum geçmişinde (locations/history) sayaç alanı 0 geldiği için sayaç karşılaştırması
// yapılamaz; birim, cihazın kendi süreleriyle tutarlılıktan doğrulanır: toplam mesafe / hareket süresi = makul ortalama hız mı.
// Geçmiş başlangıcı (canlı, salt okunur): 63AKR853 16.09.2026, 63AKR082 21.09.2026 (öncesinde satır yok → "Veri yok").
const TR_OFSET_MS = 3 * 3600 * 1000;
const GECMIS_AZAMI_GUN = 92;
const GECMIS_ONBELLEK_MS = 10 * 60 * 1000;
const PENCERE_GUN = 7; // Triomobil sürüş özeti tek istek sınırı
const _gecmisOnbellek = new Map(); // anahtar → { zaman, veri }
const trGun = (ms) => new Date(ms + TR_OFSET_MS).toISOString().slice(0, 10);
const trGunBasMs = (gun) => Date.parse(`${gun}T00:00:00+03:00`);
const gunEkle = (gun, n) => new Date(Date.parse(`${gun}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const gunAraligi = (bas, bit) => { const l = []; for (let g = bas; g <= bit; g = gunEkle(g, 1)) l.push(g); return l; };
const sayiVeyaNull = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

// Saatlik rapor satırlarını TR günlerine toplar. Süre birimi: bir saatlik dilimde kontak açık + kapalı toplamı
// 3600'ü belirgin aşıyorsa milisaniyedir (aksi halde saniye). Dönen süreler her zaman SANİYE.
function saatlikToplaGunluk(satirlar, gunler) {
  const g = new Map(gunler.map((d) => [d, null]));
  let msMi = false;
  for (const s of satirlar) {
    const on = sayiVeyaNull(s?.ignition?.on?.duration?.total) || 0, off = sayiVeyaNull(s?.ignition?.off?.duration?.total) || 0;
    if (on + off > 3600 * 1.5) { msMi = true; break; }
  }
  const bolen = msMi ? 1000 : 1;
  for (const s of satirlar) {
    const t = Date.parse(s?.ts?.since || "");
    if (!Number.isFinite(t)) continue;
    const gun = trGun(t);
    if (!g.has(gun)) continue;
    const d = g.get(gun) || { ham_delta: 0, kontak_acik_sn: 0, kontak_kapali_sn: 0, rolanti_sn: 0, max_hiz: null, satir: 0, sure_var: false };
    const delta = sayiVeyaNull(s?.mileage?.delta);
    if (delta !== null) d.ham_delta += delta;
    const on = sayiVeyaNull(s?.ignition?.on?.duration?.total), off = sayiVeyaNull(s?.ignition?.off?.duration?.total), idle = sayiVeyaNull(s?.idle?.duration?.total);
    if (on !== null) { d.kontak_acik_sn += on / bolen; d.sure_var = true; }
    if (off !== null) { d.kontak_kapali_sn += off / bolen; d.sure_var = true; }
    if (idle !== null) { d.rolanti_sn += idle / bolen; d.sure_var = true; }
    const mx = sayiVeyaNull(s?.speed?.max?.measurement);
    if (mx !== null) d.max_hiz = Math.max(d.max_hiz ?? 0, mx);
    d.satir++;
    g.set(gun, d);
  }
  return { gunluk: g, sure_birimi: msMi ? "ms" : "sn" };
}

// Birim doğrulaması (hız tutarlılığı): toplam ham fark / hareket saati = ortalama hız. Kara aracı için 2–160 km/s makuldür.
// Ham fark km ise doğrudan, metre ise /1000 ile bu aralığa düşer; ikisi de tutmazsa UYUMSUZ (değer gösterilir, uyarı verilir).
// → { durum, carpan, ortalama_hiz, neden }. carpan: ham farkı km'ye çevirir. Sayaç karşılaştırması YAPILMAZ (kaynakta sayaç yok).
function birimDogrula(toplamHam, hareketSn) {
  if (!toplamHam) return { durum: "DOGRULANDI", carpan: 1, ortalama_hiz: null, neden: "Dönemde hareket yok" };
  if (!hareketSn || hareketSn < 60) return { durum: "DOGRULANAMADI", carpan: 1, ortalama_hiz: null, neden: "Hareket süresi yok; birim süreyle karşılaştırılamadı" };
  const saat = hareketSn / 3600, makul = (v) => v >= 2 && v <= 160;
  const km = toplamHam / saat, m = toplamHam / 1000 / saat;
  if (makul(km)) return { durum: "DOGRULANDI", carpan: 1, ortalama_hiz: Math.round(km) };
  if (makul(m)) return { durum: "DOGRULANDI", carpan: 1 / 1000, ortalama_hiz: Math.round(m), neden: "Rapor farkı metre — km'ye çevrildi" };
  return { durum: "UYUMSUZ", carpan: 1, ortalama_hiz: Math.round(km), neden: "Mesafe ile hareket süresi birbiriyle tutarsız" };
}

// Tek aracın dönem istatistiği. trioId: Triomobil araç kimliği (son konum raporundan). bas/bit: TR günleri (YYYY-MM-DD).
async function aracGecmisi({ trioId, bas, bit, env = process.env, fetchFn = fetch, simdi = Date.now() } = {}) {
  if (!yapilandirildi(env)) return { ok: true, yapilandirildi: false };
  if (!/^[0-9a-fA-F]{24}$/.test(String(trioId || ""))) return { ok: false, error: "Triomobil araç kimliği bulunamadı" };
  const bugun = trGun(simdi);
  if (bit > bugun) bit = bugun;
  if (bas > bit) return { ok: false, error: "Başlangıç tarihi bitişten sonra olamaz" };
  const gunler = gunAraligi(bas, bit);
  if (gunler.length > GECMIS_AZAMI_GUN) return { ok: false, error: `En çok ${GECMIS_AZAMI_GUN} günlük dönem seçilebilir` };
  const anahtar = `${trioId}|${bas}|${bit}`;
  const ob = _gecmisOnbellek.get(anahtar);
  // Bugünü içeren dönem 10 dk, tamamen geçmiş dönem 6 saat önbellekte kalır (geçmiş gün değişmez)
  if (ob && simdi - ob.zaman < (bit === bugun ? GECMIS_ONBELLEK_MS : 6 * 3600 * 1000)) return ob.veri;
  const a = ayar(env);
  let tok = _token && _token.api === a.api && _token.kullanici === a.kullanici ? _token.deger : await _tokenAl(a, fetchFn);
  const al = async (yol) => {
    let r = await _istek(`${a.api}${yol}`, { headers: { Authorization: tok, Accept: "application/json" } }, fetchFn);
    if (r.durum === 401) { tok = await _tokenAl(a, fetchFn); r = await _istek(`${a.api}${yol}`, { headers: { Authorization: tok, Accept: "application/json" } }, fetchFn); }
    return r;
  };
  const hata = (ad, r) => { const ay = typeof r.govde === "string" ? r.govde.slice(0, 160) : r.govde && typeof r.govde === "object" ? JSON.stringify(r.govde).slice(0, 160) : ""; return new Error(`Triomobil ${ad} alınamadı (HTTP ${r.durum}${ay ? `: ${ay}` : ""})`); };
  // Dizi parametresi (_pull) biçimi belgede yazmıyor: önce tekrarlı, reddedilirse virgüllü, o da olmazsa _pull'suz istenir.
  // İlk pencerede kabul edilen biçim sonraki pencerelerde de kullanılır.
  const PULL = ["ignition", "mileage", "idle", "speed"];
  let pullBicim = [PULL.map((p) => `_pull=${p}`).join("&"), `_pull=${PULL.join(",")}`, ""];
  const pencereOku = async (pBas, pBit) => {
    const since = new Date(trGunBasMs(pBas)).toISOString();
    const until = new Date(Math.min(trGunBasMs(gunEkle(pBit, 1)), simdi)).toISOString();
    const zaman = `ts.since=${encodeURIComponent(since)}&ts.until=${encodeURIComponent(until)}`;
    let sonHata = null;
    for (const pb of pullBicim) {
      const tum = []; let red = false;
      for (let sayfa = 1; sayfa <= 10; sayfa++) {
        const r = await al(`/reports/vehicle/driving/summary?vehicleId=${trioId}&${zaman}&_groupBy=hour&_perPage=500&_page=${sayfa}${pb ? `&${pb}` : ""}`);
        if (r.durum === 400) { red = true; sonHata = hata("sürüş özeti", r); break; }
        if (r.durum >= 300 || !Array.isArray(r.govde)) throw hata("sürüş özeti", r);
        tum.push(...r.govde);
        if (r.govde.length < 500) break;
      }
      if (!red) { pullBicim = [pb]; return tum; }
      if (/interval|range/i.test(sonHata.message)) break; // aralık reddi _pull biçiminden değil — diğer biçimleri denemeye gerek yok
    }
    throw sonHata || new Error("Triomobil sürüş özeti alınamadı");
  };
  const satirlar = [];
  for (let i = 0; i < gunler.length; i += PENCERE_GUN) {
    const p = gunler.slice(i, i + PENCERE_GUN);
    satirlar.push(...(await pencereOku(p[0], p[p.length - 1])));
  }
  const { gunluk, sure_birimi } = saatlikToplaGunluk(satirlar, gunler);
  const toplamHam = [...gunluk.values()].reduce((t, d) => t + (d ? d.ham_delta : 0), 0);
  const hareketToplam = [...gunluk.values()].reduce((t, d) => t + (d && d.sure_var ? Math.max(0, d.kontak_acik_sn - d.rolanti_sn) : 0), 0);
  const maxHiz = [...gunluk.values()].reduce((m, d) => (d && d.max_hiz !== null ? Math.max(m ?? 0, d.max_hiz) : m), null);
  const dog = birimDogrula(toplamHam, hareketToplam);
  const yuvarla = (v) => Math.round(v * 10) / 10;
  const satirGun = gunler.map((tarih) => {
    const d = gunluk.get(tarih);
    if (!d) return { tarih, veri: false, km: null };
    const hareket = d.sure_var ? Math.max(0, d.kontak_acik_sn - d.rolanti_sn) : null;
    return { tarih, veri: true, km: yuvarla(d.ham_delta * dog.carpan), kontak_acik_sn: d.sure_var ? Math.round(d.kontak_acik_sn) : null,
      rolanti_sn: d.sure_var ? Math.round(d.rolanti_sn) : null, hareket_sn: hareket === null ? null : Math.round(hareket),
      kontak_kapali_sn: d.sure_var ? Math.round(d.kontak_kapali_sn) : null, max_hiz: d.max_hiz };
  });
  const veriliGun = satirGun.filter((x) => x.veri);
  const toplam = yuvarla(veriliGun.reduce((t, x) => t + x.km, 0));
  const enFazla = veriliGun.reduce((m, x) => (m === null || x.km > m.km ? x : m), null);
  const veri = { ok: true, yapilandirildi: true, kaynak: "Triomobil sürüş özeti (cihaz kilometre sayacı; saatlik veri Türkiye gününe toplandı)",
    bas, bit, gun_sayisi: gunler.length, veri_gun_sayisi: veriliGun.length, eksik_gun_sayisi: gunler.length - veriliGun.length,
    toplam_km: toplam, ortalama_km: veriliGun.length ? yuvarla(toplam / veriliGun.length) : null,
    en_fazla: enFazla && enFazla.km > 0 ? { tarih: enFazla.tarih, km: enFazla.km } : null,
    ilk_veri_gunu: veriliGun[0]?.tarih || null, gunler: satirGun, sure_var: veriliGun.some((x) => x.kontak_acik_sn !== null), sure_birimi,
    dogrulama: { durum: dog.durum, yontem: "HIZ_TUTARLILIGI", neden: dog.neden || null, ortalama_hiz: dog.ortalama_hiz, max_hiz: maxHiz, km_carpan: dog.carpan },
    pencere_sayisi: Math.ceil(gunler.length / PENCERE_GUN),
    zaman: new Date(simdi).toISOString() };
  _gecmisOnbellek.set(anahtar, { zaman: simdi, veri });
  if (_gecmisOnbellek.size > 200) _gecmisOnbellek.delete(_gecmisOnbellek.keys().next().value);
  return veri;
}

// ═══ GÜNLÜK GÜZERGÂH (05.11.2026, Orhan — Canlı İzle) ════════════════════════════════════════════════════════
// Kaynak: Triomobil GET /reports/vehicle/locations/history (resmî Swagger): vehicleId (tek), ts.since / ts.until, _limit
// (en çok 5000, varsayılan 1000), _sortOrder, X-TRIO-MIN-TS-DIFF başlığı (iki nokta arası en az saniye, en çok 120).
// Belgede sayfa (_page) parametresi YOK: 5000 noktayla dolan yanıttan sonra son noktanın zamanından devam edilir (en çok
// GUZ_AZAMI_PARCA kez); yine dolarsa yanıt "eksik" işaretlenir, sessizce kesilmez. Yanıt şeması belgede tanımlı değil:
// alanlar canlı son konum raporuyla aynı kabul edilir (ts, location.lat/lon, speed, ignition) — canlıda ilk açılışta teyit edilir.
// Çizgi yalnız ölçülmüş noktalardır: GPS boşluğu (GUZ_BOSLUK_DK) ya da gerçek dışı sıçrama (> GUZ_SICRAMA_KMH) varsa çizgi KESİLİR.
// Km bu çizgiden hesaplanmaz (km = sürüş özeti). Bugün 60 sn, geçmiş gün 6 sa önbellekte; aynı anda gelen istekler birleşir.
// TRIO_GUZ_LIMIT yalnız yerel testte parça sınırını küçültmek içindir (en çok 5000 — sağlayıcı sınırı)
const GUZ_MIN_TS_DIFF = 30, GUZ_LIMIT = Math.min(5000, Number(process.env.TRIO_GUZ_LIMIT) || 5000), GUZ_AZAMI_PARCA = 6, GUZ_BOSLUK_DK = 10, GUZ_SICRAMA_KMH = 200, GUZ_HAREKET_KMH = 5, GUZ_DURAK_DK = 3, GUZ_PARK_KAYMA_KM = 0.5;
const _guzOnbellek = new Map(), _guzBekleyen = new Map();
const haversineKm = (a, b) => { const R = 6371, r = (d) => d * Math.PI / 180; const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

// Saf: ham noktalar → { parcalar (kesik çizgiler), duraklar, zaman çizelgesi, ilk hareket, başlangıç / son nokta }
function guzergahIsle(ham, { simdi = Date.now() } = {}) {
  const n = [];
  for (const x of ham) {
    const lat = Number(x?.location?.lat), lng = Number(x?.location?.lon), t = Date.parse(x?.ts || "");
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0) || !Number.isFinite(t)) continue;
    const hiz = sayiVeyaNull(x?.speed);
    const kontak = x?.ignition === "ON" ? "ACIK" : x?.ignition === "OFF" ? "KAPALI" : null;
    n.push({ ts: new Date(t).toISOString(), t, lat, lng, hiz, kontak });
  }
  n.sort((a, b) => a.t - b.t);
  const durumOf = (p) => (p.hiz !== null && p.hiz >= GUZ_HAREKET_KMH ? "HAREKET" : p.kontak === "KAPALI" ? "PARK" : p.kontak === "ACIK" ? "ROLANTI" : "BILINMIYOR");
  // 05.11.2026 canlı gözlem: kontak kapalı parkta cihaz ~60 dk'da bir "uyanma" noktası gönderiyor (hareket halinde ~30 sn).
  // Önceki nokta park ve araç yerinden oynamadıysa (≤ GUZ_PARK_KAYMA_KM) aradaki uzun süre GPS boşluğu SAYILMAZ: park sürer.
  // Kontak kapalıyken araç uzağa gitmişse (çekici vb.) yine boşluktur.
  const uyku = (a, b) => durumOf(a) === "PARK" && haversineKm(a, b) <= GUZ_PARK_KAYMA_KM;
  const parcalar = []; let p = [];
  const kesikler = [];
  for (let i = 0; i < n.length; i++) {
    const a = n[i - 1], b = n[i];
    if (a) {
      const dk = (b.t - a.t) / 60000, km = haversineKm(a, b), hiz = dk > 0 ? km / (dk / 60) : Infinity;
      const bosluk = dk > GUZ_BOSLUK_DK && !uyku(a, b);
      if (bosluk) kesikler.push({ tur: "BOSLUK", bas: a.ts, bit: b.ts, dk: Math.round(dk) });
      else if (km > 0.5 && hiz > GUZ_SICRAMA_KMH) kesikler.push({ tur: "SICRAMA", bas: a.ts, bit: b.ts, km: Math.round(km * 10) / 10 });
      if (bosluk || (km > 0.5 && hiz > GUZ_SICRAMA_KMH)) { if (p.length) parcalar.push(p); p = []; }
    }
    p.push({ ts: b.ts, lat: b.lat, lng: b.lng, hiz: b.hiz, kontak: b.kontak, durum: durumOf(b) });
  }
  if (p.length) parcalar.push(p);
  // Duraklar: ardışık hareketsiz noktalar (≥ GUZ_DURAK_DK); tür kontak durumundan
  const duraklar = []; let d = null;
  // Tür, süreye göre: iki nokta arasındaki süre önceki noktanın durumuna yazılır; ikisi de ≥ %25 ise KARISIK
  const kapat = (son) => { if (d && (d.t2 - d.t1) / 60000 >= GUZ_DURAK_DK) { const top = d.parkSn + d.rolSn || 1;
    const tur = d.parkSn / top >= 0.25 && d.rolSn / top >= 0.25 ? "KARISIK" : d.parkSn >= d.rolSn ? (d.parkSn ? "PARK" : "BILINMIYOR") : "KONTAK_ACIK_DURUS";
    duraklar.push({ bas: new Date(d.t1).toISOString(), bit: new Date(d.t2).toISOString(), sure_sn: Math.round((d.t2 - d.t1) / 1000), lat: d.lat, lng: d.lng, tur,
      park_sn: Math.round(d.parkSn), rolanti_sn: Math.round(d.rolSn), devam: !!son }); } d = null; };
  for (let i = 0; i < n.length; i++) {
    const x = n[i], s = durumOf(x), o = n[i - 1];
    if (s === "HAREKET") { kapat(false); continue; }
    if (d && (x.t - d.t2) / 60000 > GUZ_BOSLUK_DK && !(o && uyku(o, x))) kapat(false); // gerçek boşluk durağı böler
    if (!d) d = { t1: x.t, t2: x.t, lat: x.lat, lng: x.lng, parkSn: 0, rolSn: 0, son: s };
    const ara = (x.t - d.t2) / 1000;
    if (d.son === "PARK") d.parkSn += ara; else if (d.son === "ROLANTI") d.rolSn += ara;
    d.t2 = x.t; d.son = s;
  }
  kapat(true);
  const ilkHareket = n.find((x) => durumOf(x) === "HAREKET") || null;
  // Zaman çizelgesi: duraklar arası hareket blokları (yolculuk) — yalnız ölçülmüş noktalardan
  const cizelge = [];
  let onceki = ilkHareket ? ilkHareket.t : null;
  for (const du of duraklar) {
    const b = Date.parse(du.bas);
    if (onceki !== null && b > onceki) cizelge.push({ tur: "YOLCULUK", bas: new Date(onceki).toISOString(), bit: du.bas, sure_sn: Math.round((b - onceki) / 1000) });
    cizelge.push({ tur: du.tur, bas: du.bas, bit: du.bit, sure_sn: du.sure_sn, devam: du.devam });
    onceki = Date.parse(du.bit);
  }
  const son = n[n.length - 1] || null;
  if (onceki !== null && son && son.t > onceki && durumOf(son) === "HAREKET") cizelge.push({ tur: "YOLCULUK", bas: new Date(onceki).toISOString(), bit: son.ts, sure_sn: Math.round((son.t - onceki) / 1000), devam: true });
  return {
    nokta_sayisi: n.length, parcalar, kesikler, duraklar, cizelge,
    ilk_hareket: ilkHareket ? ilkHareket.ts : null,
    baslangic: n[0] ? { ts: n[0].ts, lat: n[0].lat, lng: n[0].lng } : null,
    son: son ? { ts: son.ts, lat: son.lat, lng: son.lng, hiz: son.hiz, kontak: son.kontak, yas_sn: Math.round((simdi - son.t) / 1000) } : null,
  };
}

async function aracGuzergah({ trioId, gun, env = process.env, fetchFn = fetch, simdi = Date.now() } = {}) {
  if (!yapilandirildi(env)) return { ok: true, yapilandirildi: false };
  if (!/^[0-9a-fA-F]{24}$/.test(String(trioId || ""))) return { ok: false, error: "Triomobil araç kimliği bulunamadı" };
  const bugun = trGun(simdi);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(gun || ""))) gun = bugun;
  if (gun > bugun) return { ok: false, error: "Gelecek gün için güzergâh yok" };
  const anahtar = `${trioId}|${gun}`;
  const ob = _guzOnbellek.get(anahtar);
  if (ob && simdi - ob.zaman < (gun === bugun ? ONBELLEK_MS : 6 * 3600 * 1000)) return ob.veri;
  if (_guzBekleyen.has(anahtar)) return _guzBekleyen.get(anahtar);
  const is = (async () => {
    const a = ayar(env);
    let tok = _token && _token.api === a.api && _token.kullanici === a.kullanici ? _token.deger : await _tokenAl(a, fetchFn);
    const basl = () => ({ Authorization: tok, Accept: "application/json", "X-TRIO-MIN-TS-DIFF": String(GUZ_MIN_TS_DIFF) });
    const al = async (yol) => {
      let r = await _istek(`${a.api}${yol}`, { headers: basl() }, fetchFn);
      if (r.durum === 401) { tok = await _tokenAl(a, fetchFn); r = await _istek(`${a.api}${yol}`, { headers: basl() }, fetchFn); }
      return r;
    };
    const until = new Date(Math.min(trGunBasMs(gunEkle(gun, 1)), simdi)).toISOString();
    let since = new Date(trGunBasMs(gun)).toISOString();
    const ham = []; let eksik = false, parca = 0;
    for (; parca < GUZ_AZAMI_PARCA; parca++) {
      const r = await al(`/reports/vehicle/locations/history?vehicleId=${trioId}&ts.since=${encodeURIComponent(since)}&ts.until=${encodeURIComponent(until)}&_limit=${GUZ_LIMIT}&_sortOrder=ASC`);
      if (r.durum >= 300 || !Array.isArray(r.govde)) {
        const ay = typeof r.govde === "string" ? r.govde.slice(0, 160) : r.govde && typeof r.govde === "object" ? JSON.stringify(r.govde).slice(0, 160) : "";
        throw new Error(`Triomobil konum geçmişi alınamadı (HTTP ${r.durum}${ay ? `: ${ay}` : ""})`);
      }
      ham.push(...r.govde);
      if (r.govde.length < GUZ_LIMIT) break;
      const sonTs = Date.parse(r.govde[r.govde.length - 1]?.ts || "");
      if (!Number.isFinite(sonTs)) { eksik = true; break; }
      since = new Date(sonTs + 1000).toISOString();
      if (parca === GUZ_AZAMI_PARCA - 1) eksik = true;
    }
    const g = guzergahIsle(ham, { simdi });
    const veri = { ok: true, yapilandirildi: true, gun, bugun: gun === bugun, ...g, eksik,
      eksik_not: eksik ? `Nokta sayısı sağlayıcı sınırına ulaştı (${GUZ_LIMIT} × ${GUZ_AZAMI_PARCA}); günün sonu eksik olabilir` : null,
      istek_sayisi: Math.min(parca + 1, GUZ_AZAMI_PARCA), min_ts_diff_sn: GUZ_MIN_TS_DIFF,
      yenileme: gun === bugun ? { sn: Math.round(ONBELLEK_MS / 1000), not: `Gerçek zamanlı akış yok; yaklaşık ${Math.round(ONBELLEK_MS / 1000)} saniyede bir yenilenir` } : null,
      kaynak: "Triomobil konum geçmişi (ölçülmüş GPS noktaları; km bu çizgiden hesaplanmaz)", zaman: new Date(simdi).toISOString() };
    _guzOnbellek.set(anahtar, { zaman: simdi, veri });
    if (_guzOnbellek.size > 100) _guzOnbellek.delete(_guzOnbellek.keys().next().value);
    return veri;
  })();
  _guzBekleyen.set(anahtar, is);
  try { return await is; } finally { _guzBekleyen.delete(anahtar); }
}

const _sifirla = () => { _token = null; _onbellek = null; _bekleyen = null; _gecmisOnbellek.clear(); _guzOnbellek.clear(); _guzBekleyen.clear(); }; // yalnız test

module.exports = { sonKonumlar, eslestir, plakaNorm, kayitDuzenle, yapilandirildi, ONBELLEK_MS, _sifirla,
  aracGecmisi, saatlikToplaGunluk, birimDogrula, trGun, gunEkle, gunAraligi, GECMIS_AZAMI_GUN,
  aracGuzergah, guzergahIsle, GUZ_LIMIT, GUZ_MIN_TS_DIFF };
