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
// Birim doğrulaması: dönem başı / sonu sayaç değeri (locations/history ilk–son nokta, aynı cihaz sayacı) ile toplam fark
// karşılaştırılır. Belgede mesafe ve süre birimi yazmadığı için birim, sayaçla tutarlılıktan belirlenir; tutmazsa açıkça yazılır.
const TR_OFSET_MS = 3 * 3600 * 1000;
const GECMIS_AZAMI_GUN = 92;
const GECMIS_ONBELLEK_MS = 10 * 60 * 1000;
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

// Toplam rapor farkını cihaz sayacıyla karşılaştırır → { durum, carpan, ... }. carpan: rapor farkını km'ye çevirir.
function birimDogrula(toplamHam, sayacBas, sayacBit) {
  if (sayacBas === null || sayacBit === null) return { durum: "DOGRULANAMADI", carpan: 1, neden: "Dönem başı / sonu sayaç değeri alınamadı" };
  const fark = sayacBit - sayacBas;
  if (fark < 0) return { durum: "DOGRULANAMADI", carpan: 1, sayac_fark: fark, neden: "Sayaç dönem içinde geri gitti (cihaz değişimi / sıfırlama olabilir)" };
  if (fark === 0 && toplamHam === 0) return { durum: "DOGRULANDI", carpan: 1, sayac_fark: 0 };
  const yakin = (a, b) => Math.abs(a - b) <= Math.max(1, b * 0.03);
  if (yakin(toplamHam, fark)) return { durum: "DOGRULANDI", carpan: 1, sayac_fark: fark };
  if (yakin(toplamHam / 1000, fark)) return { durum: "DOGRULANDI", carpan: 1 / 1000, sayac_fark: fark, neden: "Rapor farkı metre, sayaç km — km'ye çevrildi" };
  return { durum: "UYUMSUZ", carpan: 1, sayac_fark: fark, neden: "Günlük farkların toplamı cihaz sayacındaki değişimle tutmuyor" };
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
  const since = new Date(trGunBasMs(bas)).toISOString();
  const until = new Date(Math.min(trGunBasMs(gunEkle(bit, 1)), simdi)).toISOString();
  const zaman = `ts.since=${encodeURIComponent(since)}&ts.until=${encodeURIComponent(until)}`;
  // Dizi parametresi (_pull) biçimi belgede yazmıyor: önce tekrarlı, reddedilirse virgüllü, o da olmazsa _pull'suz istenir
  const PULL = ["ignition", "mileage", "idle", "speed"];
  const pullBicim = [PULL.map((p) => `_pull=${p}`).join("&"), `_pull=${PULL.join(",")}`, ""];
  let satirlar = null, sonHata = null;
  for (const pb of pullBicim) {
    const tum = []; let red = false;
    for (let sayfa = 1; sayfa <= 10; sayfa++) {
      const r = await al(`/reports/vehicle/driving/summary?vehicleId=${trioId}&${zaman}&_groupBy=hour&_perPage=500&_page=${sayfa}${pb ? `&${pb}` : ""}`);
      if (r.durum === 400) { red = true; sonHata = hata("sürüş özeti", r); break; }
      if (r.durum >= 300 || !Array.isArray(r.govde)) throw hata("sürüş özeti", r);
      tum.push(...r.govde);
      if (r.govde.length < 500) break;
    }
    if (!red) { satirlar = tum; break; }
  }
  if (!satirlar) throw sonHata || new Error("Triomobil sürüş özeti alınamadı");
  const { gunluk, sure_birimi } = saatlikToplaGunluk(satirlar, gunler);
  // Sayaç doğrulaması: dönemin ilk ve son konum noktası (cihaz sayacı)
  const nokta = async (sira) => {
    const r = await al(`/reports/vehicle/locations/history?vehicleId=${trioId}&${zaman}&_limit=1&_sortOrder=${sira}`).catch(() => null);
    const x = r && r.durum < 300 && Array.isArray(r.govde) ? r.govde[0] : null;
    return x ? { ts: x.ts || null, sayac: sayiVeyaNull(x.mileage) } : null;
  };
  const [ilk, son] = await Promise.all([nokta("ASC"), nokta("DESC")]);
  const toplamHam = [...gunluk.values()].reduce((t, d) => t + (d ? d.ham_delta : 0), 0);
  const dog = birimDogrula(toplamHam, ilk?.sayac ?? null, son?.sayac ?? null);
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
    dogrulama: { durum: dog.durum, neden: dog.neden || null, sayac_bas: ilk?.sayac ?? null, sayac_bit: son?.sayac ?? null, sayac_fark: dog.sayac_fark ?? null,
      sayac_bas_ts: ilk?.ts || null, sayac_bit_ts: son?.ts || null, km_carpan: dog.carpan },
    zaman: new Date(simdi).toISOString() };
  _gecmisOnbellek.set(anahtar, { zaman: simdi, veri });
  if (_gecmisOnbellek.size > 200) _gecmisOnbellek.delete(_gecmisOnbellek.keys().next().value);
  return veri;
}

const _sifirla = () => { _token = null; _onbellek = null; _bekleyen = null; _gecmisOnbellek.clear(); }; // yalnız test

module.exports = { sonKonumlar, eslestir, plakaNorm, kayitDuzenle, yapilandirildi, ONBELLEK_MS, _sifirla,
  aracGecmisi, saatlikToplaGunluk, birimDogrula, trGun, gunEkle, gunAraligi, GECMIS_AZAMI_GUN };
