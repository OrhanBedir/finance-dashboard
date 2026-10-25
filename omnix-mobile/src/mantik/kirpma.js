// Fiş köşe düzeltme hesapları (React Native'e bağımlı değil; node --test ile sınanır).
// Sunucu sözleşmesi (backend/fisKirpma.js koseDogrula + POST /hr/masraf-belge/:kalemId secimler):
//   kose = [[x,y] × 4], koordinatlar yanıttaki `olcu` (yönlendirilmiş fotoğraf ölçüsü) cinsinden,
//   sıra BELGEYE göre: sol üst, sağ üst, sağ alt, sol alt. Sunucu yalnız dönüş yönünü (saat yönü/tersi) düzeltir,
//   sıranın başını değiştirmez — bu yüzden "Döndür" köşe sırasını kaydırarak belgenin üst kenarını değiştirir.

// Fotoğrafı (olcu) verilen alana "contain" ile yerleştirir; kenar boşluğu tutamaklar için
export function yerlesimHesapla(olcu, alan, kenar = 22) {
  if (!olcu?.w || !olcu?.h || !alan?.w || !alan?.h) return null;
  const aw = Math.max(1, alan.w - kenar * 2), ah = Math.max(1, alan.h - kenar * 2);
  const oran = Math.min(aw / olcu.w, ah / olcu.h);
  const w = olcu.w * oran, h = olcu.h * oran;
  return { x: kenar + (aw - w) / 2, y: kenar + (ah - h) / 2, w, h, oran };
}

export const olcudenEkrana = (kose, y) => kose.map(([x, yy]) => ({ x: y.x + x * y.oran, y: y.y + yy * y.oran }));

export const ekrandanOlcuye = (noktalar, y) =>
  noktalar.map((p) => [Math.round(((p.x - y.x) / y.oran) * 10) / 10, Math.round(((p.y - y.y) / y.oran) * 10) / 10]);

// Sürüklenen nokta görüntünün dışına çıkmasın
export const sinirla = (p, y) => ({ x: Math.max(y.x, Math.min(y.x + y.w, p.x)), y: Math.max(y.y, Math.min(y.y + y.h, p.y)) });

// Başlangıç yoksa fotoğrafın %7 içeriden çerçevesi
export function varsayilanKose(olcu, pay = 0.07) {
  return [[olcu.w * pay, olcu.h * pay], [olcu.w * (1 - pay), olcu.h * pay], [olcu.w * (1 - pay), olcu.h * (1 - pay)], [olcu.w * pay, olcu.h * (1 - pay)]];
}

export function gecerliKose(k) {
  return Array.isArray(k) && k.length === 4 && k.every((p) => Array.isArray(p) && p.length >= 2 && p.every((v) => Number.isFinite(Number(v))));
}

// Belgenin üstü bir sonraki kenar olur: çıktı 90° saat yönünde döner
export const dondur = (k) => [k[3], k[0], k[1], k[2]];

// Köşeler çaprazlanmamış (dışbükey dörtgen) mi? Nokta {x,y} ya da [x,y] kabul edilir
export function disbukey(k) {
  const q = k.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p));
  let isaret = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-6) continue;
    if (!isaret) isaret = Math.sign(z); else if (Math.sign(z) !== isaret) return false;
  }
  return isaret !== 0;
}

// Sunucunun "çok küçük" reddinden önce kullanıcıyı uyarmak için (sunucu: alanın %0,4'ü ve 40 px)
export function yeterliBuyuk(k, olcu) {
  let alan = 0;
  for (let i = 0; i < 4; i++) { const [x1, y1] = k[i], [x2, y2] = k[(i + 1) % 4]; alan += x1 * y2 - x2 * y1; }
  return Math.abs(alan) / 2 >= olcu.w * olcu.h * 0.004;
}
