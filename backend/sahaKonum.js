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
  _tablo = true;
}

// TSSR analizinden konum yaz (elle girilmiş MANUEL konum TSSR ile ezilmez; çelişki uyarı olarak eklenir)
async function tssrdenKonumYaz(pool, siteCode, sonuc, belgeUrl) {
  const f = fizikselSaha(sonuc?.kapak?.site_id) || fizikselSaha(siteCode);
  if (!f) return null;
  const k = tssrKonumu(sonuc?.konum);
  if (!k) return null;
  await tabloHazirla(pool);
  const mevcut = (await pool.query(`SELECT kaynak, lat, lng FROM saha_konum WHERE fiziksel_id = $1`, [f.fiziksel_id])).rows[0];
  if (mevcut && mevcut.kaynak === "MANUEL") return { atlandi: "MANUEL konum korunuyor" };
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

// Karayolu mesafesi — yalnız ROTA_SERVIS_URL tanımlıysa (OSRM uyumlu: {url}/route/v1/driving/lng,lat;lng,lat). Önbellekli.
async function karayolu(pool, a, b, { fetchFn = fetch } = {}) {
  const url = process.env.ROTA_SERVIS_URL;
  if (!url) return { durum: "KAPALI", mesaj: "Karayolu mesafesi hesaplanmadı: yönlendirme servisi yapılandırılmadı (yalnız kuş uçuşu gösteriliyor)." };
  await tabloHazirla(pool);
  const anahtar = [a.lat, a.lng, b.lat, b.lng].map((x) => Number(x).toFixed(5)).join(",");
  const c = (await pool.query(`SELECT mesafe_m, sure_s, servis FROM saha_rota_onbellek WHERE anahtar = $1`, [anahtar])).rows[0];
  if (c) return { durum: "OK", km: Number(c.mesafe_m) / 1000, dakika: Number(c.sure_s) / 60, servis: c.servis, onbellek: true };
  try {
    const r = await fetchFn(`${url.replace(/\/$/, "")}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const rt = j?.routes?.[0];
    if (!rt) throw new Error("rota bulunamadı");
    await pool.query(`INSERT INTO saha_rota_onbellek (anahtar, mesafe_m, sure_s, servis) VALUES ($1,$2,$3,$4) ON CONFLICT (anahtar) DO NOTHING`, [anahtar, rt.distance, rt.duration, url]);
    return { durum: "OK", km: rt.distance / 1000, dakika: rt.duration / 60, servis: url, onbellek: false };
  } catch (e) { return { durum: "HATA", mesaj: `Yönlendirme servisi yanıt vermedi (${e.message}) — karayolu mesafesi gösterilemiyor.` }; }
}

module.exports = { TR_KUTU, tssrKonumu, tssrdenKonumYaz, kusUcusuKm, bursaDeposu, karayolu, tabloHazirla };
