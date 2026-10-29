// ═══ SAHA KONUMU + DEPO MESAFESİ (28.10.2026, Orhan — Rollout saha haritası) ═══════════════════════════════════════
// Konum kaynağı önceliği: 1) TSSR'da açıkça yazan koordinat (TSSR_KOORDINAT)  2) açık adres → coğrafi kodlama (ADRES_KODLAMA,
// yaklaşık; YALNIZ yapılandırılmış ve Orhan'ın onayladığı servisle)  3) elle girilen (MANUEL). Kaynak, doğruluk ve belge
// sayfası saklanır; geçersiz / ters / çelişkili koordinat DÜZELTİLMEZ, işaretlenir. Bir fiziksel saha = bir konum (tek pin).
// Mesafe: kuş uçuşu (haversine) her zaman; karayolu yalnız yönlendirme servisi yapılandırılmışsa (ROTA_SERVIS_URL, OSRM uyumlu)
// — servis kapalıysa "karayolu hesaplanmadı" denir, kuş uçuşu karayolu diye etiketlenmez. Dış servislere SAHA ADRESİ gönderilmez
// (geocoding kapalı); rota servisine yalnız iki koordinat gider ve bu da env ile açılmadıkça yapılmaz.
const { fizikselSaha } = require("./sahaKimlik");

const TR_KUTU = { enlemMin: 35.5, enlemMax: 42.6, boylamMin: 25.4, boylamMax: 45.0 };
const icinde = (lat, lng) => lat >= TR_KUTU.enlemMin && lat <= TR_KUTU.enlemMax && lng >= TR_KUTU.boylamMin && lng <= TR_KUTU.boylamMax;

// TSSR konum alanlarından (normallestir çıktısı) tek konum + doğruluk durumu
function tssrKonumu(konum) {
  if (!konum) return null;
  const dms = Number.isFinite(konum.enlem_dms) && Number.isFinite(konum.boylam_dms) ? { lat: konum.enlem_dms, lng: konum.boylam_dms } : null;
  const ond = Number.isFinite(konum.enlem) && Number.isFinite(konum.boylam) ? { lat: konum.enlem, lng: konum.boylam } : null;
  const aday = ond || dms;
  const uyarilar = [];
  if (!aday) return konum.adres ? { lat: null, lng: null, dogruluk: "YOK", uyarilar: ["TSSR'da koordinat yok; yalnız adres var"], adres: konum.adres } : null;
  let dogruluk = "KESIN";
  if (dms && ond) {
    const fark = Math.max(Math.abs(dms.lat - ond.lat), Math.abs(dms.lng - ond.lng));
    if (fark > 0.0005) { dogruluk = "CELISKILI"; uyarilar.push(`Derece-dakika (${dms.lat.toFixed(5)}, ${dms.lng.toFixed(5)}) ile ondalık (${ond.lat.toFixed(5)}, ${ond.lng.toFixed(5)}) koordinat farklı — kontrol edin`); }
  }
  if (!icinde(aday.lat, aday.lng)) {
    if (icinde(aday.lng, aday.lat)) { dogruluk = "TERS_OLABILIR"; uyarilar.push("Enlem ve boylam yer değiştirmiş görünüyor — düzeltilmedi, kontrol edin"); }
    else { dogruluk = "GECERSIZ"; uyarilar.push("Koordinat Türkiye sınırları dışında — farklı koordinat sistemi ya da hatalı değer olabilir"); }
  }
  return { lat: aday.lat, lng: aday.lng, dogruluk, uyarilar, ham: `${konum.enlem_ham || konum.enlem_ondalik} / ${konum.boylam_ham || konum.boylam_ondalik}`, adres: konum.adres || "" };
}

let _tablo = false;
async function tabloHazirla(pool) {
  if (_tablo) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS saha_konum (
    fiziksel_id TEXT PRIMARY KEY, lat NUMERIC(10,7), lng NUMERIC(10,7), kaynak TEXT, dogruluk TEXT, uyarilar JSONB,
    belge_url TEXT, sayfa INTEGER, ham TEXT, adres TEXT, saha_adi TEXT, il TEXT, ilce TEXT, kaynak_site_code TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS saha_rota_onbellek (
    anahtar TEXT PRIMARY KEY, mesafe_m NUMERIC, sure_s NUMERIC, servis TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`);
  // 28.10.2026: güzergâh çizgisi (haritada yolu çizmek için; [[lng,lat],…], 5 ondalık)
  await pool.query(`ALTER TABLE saha_rota_onbellek ADD COLUMN IF NOT EXISTS geometri JSONB`);
  // 29.10.2026: KMZ konum kaynağı izi — kaynak dosya, KML kaydı, içe alma, dosya içi kayıt tarihi (konum tarihi; iş yılı değildir)
  await pool.query(`ALTER TABLE saha_konum ADD COLUMN IF NOT EXISTS kaynak_dosya TEXT, ADD COLUMN IF NOT EXISTS kml_kaydi TEXT,
    ADD COLUMN IF NOT EXISTS ice_alma_id INTEGER, ADD COLUMN IF NOT EXISTS ice_alma_zamani TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS kaynak_tarih DATE`);
  _tablo = true;
}

// TSSR analizinden konum yaz (elle girilmiş MANUEL konum TSSR ile ezilmez; çelişki uyarı olarak eklenir)
async function tssrdenKonumYaz(pool, siteCode, sonuc, belgeUrl) {
  const f = fizikselSaha(sonuc?.kapak?.site_id) || fizikselSaha(siteCode);
  if (!f) return null;
  const k = tssrKonumu(sonuc?.konum);
  if (!k) return null;
  await tabloHazirla(pool);
  const mevcut = (await pool.query(`SELECT kaynak, lat, lng, uyarilar FROM saha_konum WHERE fiziksel_id = $1`, [f.fiziksel_id])).rows[0];
  if (mevcut && mevcut.kaynak === "MANUEL") return { atlandi: "MANUEL konum korunuyor" };
  // 29.10.2026: onaylı KMZ konumu TSSR okumasıyla sessizce ezilmez; fark varsa uyarı olarak yazılır
  if (mevcut && mevcut.kaynak === "KMZ") {
    if (k.lat != null && k.dogruluk === "KESIN" && mevcut.lat != null) {
      const fark = Math.round(kusUcusuKm({ lat: Number(mevcut.lat), lng: Number(mevcut.lng) }, k) * 1000);
      if (fark > 100) {
        const not = `${siteCode} TSSR koordinatı (${k.lat.toFixed(6)}, ${k.lng.toFixed(6)}) KMZ konumundan ${fark} m farklı — KMZ korunuyor, kontrol edin`;
        const u = (Array.isArray(mevcut.uyarilar) ? mevcut.uyarilar : []).filter((x) => !String(x).startsWith(`${siteCode} TSSR koordinatı`));
        await pool.query(`UPDATE saha_konum SET uyarilar = $2 WHERE fiziksel_id = $1`, [f.fiziksel_id, JSON.stringify([...u, not])]);
      }
    }
    return { atlandi: "KMZ konumu korunuyor" };
  }
  await pool.query(`INSERT INTO saha_konum (fiziksel_id, lat, lng, kaynak, dogruluk, uyarilar, belge_url, sayfa, ham, adres, saha_adi, il, ilce, kaynak_site_code, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
      ON CONFLICT (fiziksel_id) DO UPDATE SET lat=EXCLUDED.lat, lng=EXCLUDED.lng, kaynak=EXCLUDED.kaynak, dogruluk=EXCLUDED.dogruluk, uyarilar=EXCLUDED.uyarilar,
        belge_url=EXCLUDED.belge_url, sayfa=EXCLUDED.sayfa, ham=EXCLUDED.ham, adres=EXCLUDED.adres, saha_adi=EXCLUDED.saha_adi, il=EXCLUDED.il, ilce=EXCLUDED.ilce,
        kaynak_site_code=EXCLUDED.kaynak_site_code, updated_at=NOW()`,
    [f.fiziksel_id, k.lat, k.lng, k.lat === null ? "ADRES" : "TSSR_KOORDINAT", k.dogruluk, JSON.stringify(k.uyarilar), belgeUrl || null, sonuc?.konum?.sayfa || null,
      k.ham || null, k.adres || null, sonuc?.kapak?.saha_adi || null, sonuc?.konum?.il || null, sonuc?.konum?.ilce || null, siteCode]);
  return { fiziksel_id: f.fiziksel_id, ...k };
}

// Kuş uçuşu (km) — WGS84 küre yaklaşımı
function kusUcusuKm(a, b) {
  const R = 6371.0088, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Bursa deposu: ofis_depo kaydından (tür DEPO, bölge Bursa, aktif, lat/lng dolu). Bulunamazsa eksik durumu döner — tahmin yok.
async function bursaDeposu(pool) {
  const r = await pool.query(`SELECT id, ad, adres, lat, lng, durum FROM ofis_depo
      WHERE UPPER(COALESCE(tur,'')) LIKE '%DEPO%' AND UPPER(COALESCE(bolge,'')) LIKE 'BURSA%' AND UPPER(COALESCE(durum,'AKTİF')) <> 'PASİF'
      ORDER BY id LIMIT 2`).catch(() => ({ rows: [] }));
  if (!r.rows.length) return { dogrulandi: false, mesaj: "Bursa deposu kaydı bulunamadı (ofis_depo). Depo adresini/koordinatını Admin → Ofis/Depo'dan girin." };
  if (r.rows.length > 1) return { dogrulandi: false, mesaj: "Birden fazla aktif Bursa deposu kaydı var — hangisinin esas alınacağı belirsiz." };
  const d = r.rows[0], lat = Number(d.lat), lng = Number(d.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !lat || !icinde(lat, lng)) return { dogrulandi: false, ad: d.ad, adres: d.adres, mesaj: "Bursa deposunun koordinatı kayıtlı değil ya da geçersiz." };
  return { dogrulandi: true, id: d.id, ad: d.ad, adres: d.adres, lat, lng, kaynak: "ofis_depo kaydı (Haritadan Gör ile girilen konum)" };
}

// Güzergâh çizgisi: OSRM GeoJSON LineString → [[lng,lat],…] (5 ondalık ≈ 1 m; geçersiz nokta atılır)
function cizgiAl(geo) {
  const k = Array.isArray(geo?.coordinates) ? geo.coordinates : [];
  return k.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map(([lng, lat]) => [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]);
}

// Karayolu mesafesi + güzergâh — yalnız ROTA_SERVIS_URL tanımlıysa (OSRM uyumlu: {url}/route/v1/driving/lng,lat;lng,lat). Önbellekli.
// Servise yalnız iki koordinat gider (depo + saha); güzergâh "simplified" (haritada çizmeye yeter, birkaç yüz nokta).
async function karayolu(pool, a, b, { fetchFn = fetch } = {}) {
  const url = process.env.ROTA_SERVIS_URL;
  if (!url) return { durum: "KAPALI", mesaj: "Karayolu mesafesi hesaplanmadı: yönlendirme servisi yapılandırılmadı (yalnız kuş uçuşu gösteriliyor)." };
  await tabloHazirla(pool);
  const anahtar = [a.lat, a.lng, b.lat, b.lng].map((x) => Number(x).toFixed(5)).join(",");
  const c = (await pool.query(`SELECT mesafe_m, sure_s, servis, geometri FROM saha_rota_onbellek WHERE anahtar = $1`, [anahtar])).rows[0];
  // Güzergâhı olmayan eski önbellek kaydı (28.10 öncesi) bir kez yeniden sorulur
  if (c && Array.isArray(c.geometri) && c.geometri.length > 1)
    return { durum: "OK", km: Number(c.mesafe_m) / 1000, dakika: Number(c.sure_s) / 60, servis: c.servis, cizgi: c.geometri, onbellek: true };
  try {
    const r = await fetchFn(`${url.replace(/\/$/, "")}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const rt = j?.routes?.[0];
    if (!rt) throw new Error("rota bulunamadı");
    const cizgi = cizgiAl(rt.geometry);
    await pool.query(`INSERT INTO saha_rota_onbellek (anahtar, mesafe_m, sure_s, servis, geometri, updated_at) VALUES ($1,$2,$3,$4,$5,NOW())
        ON CONFLICT (anahtar) DO UPDATE SET mesafe_m=EXCLUDED.mesafe_m, sure_s=EXCLUDED.sure_s, servis=EXCLUDED.servis, geometri=EXCLUDED.geometri, updated_at=NOW()`,
      [anahtar, rt.distance, rt.duration, url, cizgi.length > 1 ? JSON.stringify(cizgi) : null]);
    return { durum: "OK", km: rt.distance / 1000, dakika: rt.duration / 60, servis: url, cizgi: cizgi.length > 1 ? cizgi : null, onbellek: false };
  } catch (e) {
    // Servis o an yanıt vermezse eski (güzergâhsız) önbellek değeri yine gösterilir
    if (c) return { durum: "OK", km: Number(c.mesafe_m) / 1000, dakika: Number(c.sure_s) / 60, servis: c.servis, cizgi: null, onbellek: true };
    return { durum: "HATA", mesaj: `Yönlendirme servisi yanıt vermedi (${e.message}) — karayolu mesafesi gösterilemiyor.` };
  }
}

// Karayolu süre tablosu (planlama): noktalar [{ anahtar, lat, lng }] → { tablo: { "A>B": { dk, km, kaynak } }, durum, mesaj }.
// Önce önbellek (saha_rota_onbellek, yön bağımsız değil: A→B ayrı anahtar); eksik çiftler OSRM "table" servisiyle tek istekte
// sorulur. Servis kapalı / hatalıysa eksik çiftler tabloda olmaz — planlayıcı bunları "Yol süresi doğrulanamadı" olarak ister.
// Servise yalnız koordinatlar gider (saha adı / adresi gitmez).
async function karayoluTablo(pool, noktalar, { fetchFn = fetch } = {}) {
  const N = (noktalar || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const anahtar = (a, b) => [a.lat, a.lng, b.lat, b.lng].map((x) => Number(x).toFixed(5)).join(",");
  const tablo = {};
  if (N.length < 2) return { tablo, durum: "OK" };
  await tabloHazirla(pool);
  const ciftler = [];
  for (const a of N) for (const b of N) if (a !== b) ciftler.push([a, b]);
  const c = await pool.query(`SELECT anahtar, mesafe_m, sure_s FROM saha_rota_onbellek WHERE anahtar = ANY($1)`, [ciftler.map(([a, b]) => anahtar(a, b))]);
  const onb = new Map(c.rows.map((x) => [x.anahtar, x]));
  const eksik = [];
  for (const [a, b] of ciftler) {
    const r = onb.get(anahtar(a, b));
    if (r) tablo[`${a.anahtar}>${b.anahtar}`] = { dk: Number(r.sure_s) / 60, km: Math.round(Number(r.mesafe_m) / 100) / 10, kaynak: "ROTA_SERVISI" };
    else eksik.push([a, b]);
  }
  if (!eksik.length) return { tablo, durum: "OK" };
  const url = process.env.ROTA_SERVIS_URL;
  if (!url) return { tablo, durum: "KAPALI", mesaj: "Yönlendirme servisi yapılandırılmadı — yol süreleri doğrulanamadı" };
  try {
    const r = await fetchFn(`${url.replace(/\/$/, "")}/table/v1/driving/${N.map((p) => `${p.lng},${p.lat}`).join(";")}?annotations=duration,distance`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (!Array.isArray(j?.durations)) throw new Error("tablo yanıtı yok");
    for (const [a, b] of eksik) {
      const i = N.indexOf(a), k = N.indexOf(b);
      const s = j.durations?.[i]?.[k], m = j.distances?.[i]?.[k];
      if (!Number.isFinite(s)) continue;
      tablo[`${a.anahtar}>${b.anahtar}`] = { dk: s / 60, km: Number.isFinite(m) ? Math.round(m / 100) / 10 : null, kaynak: "ROTA_SERVISI" };
      await pool.query(`INSERT INTO saha_rota_onbellek (anahtar, mesafe_m, sure_s, servis) VALUES ($1,$2,$3,$4) ON CONFLICT (anahtar) DO NOTHING`,
        [anahtar(a, b), Number.isFinite(m) ? m : null, s, url]);
    }
    return { tablo, durum: "OK" };
  } catch (e) { return { tablo, durum: "HATA", mesaj: `Yönlendirme servisi yanıt vermedi (${e.message}) — eksik yol süreleri doğrulanamadı` }; }
}

module.exports = { TR_KUTU, tssrKonumu, tssrdenKonumYaz, kusUcusuKm, bursaDeposu, karayolu, karayoluTablo, cizgiAl, tabloHazirla };
