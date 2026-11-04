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
      const cagir = (t) => _istek(`${a.api}/reports/vehicle/locations/latest?_perPage=500`, { headers: { Authorization: t, Accept: "application/json" } }, fetchFn);
      let r = await cagir(tok);
      if (r.durum === 401) { tok = await _tokenAl(a, fetchFn); r = await cagir(tok); } // süresi dolmuş anahtar: bir kez yenile
      if (r.durum >= 300 || !Array.isArray(r.govde)) throw new Error(`Triomobil konum raporu alınamadı (HTTP ${r.durum})`);
      const veri = { ok: true, yapilandirildi: true, zaman: new Date(simdi).toISOString(), araclar: r.govde.map(kayitDuzenle).filter((k) => k.plaka_norm) };
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

const _sifirla = () => { _token = null; _onbellek = null; _bekleyen = null; }; // yalnız test

module.exports = { sonKonumlar, eslestir, plakaNorm, kayitDuzenle, yapilandirildi, ONBELLEK_MS, _sifirla };
