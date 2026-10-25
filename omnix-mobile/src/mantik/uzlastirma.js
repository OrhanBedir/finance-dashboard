// Çift kayıt önleme (uzlaştırma). Mevcut backend uçları istemci anahtarı (idempotency key) almıyor; bu yüzden
// bağlantı koptuğunda isteğin sunucuya ulaşıp ulaşmadığı belirsizdir. Tekrar göndermeden ÖNCE sunucudaki
// güncel liste okunur ve aynı kayıt bulunursa yeniden oluşturulmaz.
//
// Eşleşme kuralı: gönderimden önce bilinmeyen (yeni) bir kayıt + aynı alanlar.

const sayiEsit = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const metinEsit = (a, b) => String(a ?? "").trim() === String(b ?? "").trim();
// Sunucu DATE alanını saat dilimli döndürebilir ("2026-10-23T21:00:00.000Z" = Türkiye'de 24 Ekim); yerel güne çevrilir
function gunAnahtari(v) {
  const s = String(v ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = new Date(s);
  if (isNaN(t.getTime())) return s.slice(0, 10);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}
const gunEsit = (a, b) => gunAnahtari(a) === gunAnahtari(b);

// İş avansı: önceki id kümesinde olmayan, tutar + gider türü + açıklama + tarih aynı kayıt
export function avansEslesmesi(sunucuListesi, oncekiIdler, gonderilen) {
  const once = new Set((oncekiIdler || []).map(String));
  return (sunucuListesi || []).find((r) =>
    !once.has(String(r.id)) &&
    sayiEsit(r.tutar, gonderilen.tutar) &&
    metinEsit(r.gider_turu, gonderilen.gider_turu) &&
    metinEsit(r.aciklama || "", gonderilen.aciklama || "") &&
    (!gonderilen.tarih || !r.tarih || gunEsit(r.tarih, gonderilen.tarih))
  ) || null;
}

// Masraf kalemi: aynı formdaki yeni kalem (kategori + tarih + tutar + açıklama)
export function kalemEslesmesi(kalemler, oncekiIdler, gonderilen) {
  const once = new Set((oncekiIdler || []).map(String));
  return (kalemler || []).find((k) =>
    !once.has(String(k.id)) &&
    metinEsit(k.kategori, gonderilen.kategori) &&
    sayiEsit(k.tutar, gonderilen.tutar) &&
    metinEsit(k.aciklama || "", gonderilen.aciklama || "") &&
    (!gonderilen.tarih || !k.tarih || gunEsit(k.tarih, gonderilen.tarih))
  ) || null;
}

// Fiş: yükleme sonrası kalemin belge sayısı arttıysa yükleme sunucuya ulaşmıştır
export function yeniBelge(kalem, oncekiBelgeIdler) {
  const once = new Set((oncekiBelgeIdler || []).map(String));
  return (kalem?.belgeler || []).find((b) => b && !once.has(String(b.id))) || null;
}

// Malzeme talebi: yeni talep + aynı not + aynı kalem sayısı
export function malzemeEslesmesi(liste, oncekiIdler, gonderilen) {
  const once = new Set((oncekiIdler || []).map(String));
  return (liste || []).find((t) =>
    !once.has(String(t.id)) &&
    metinEsit(t.notlar || "", gonderilen.notlar || "") &&
    Number(t.kalem_sayisi ?? -1) === (gonderilen.kalemler || []).length
  ) || null;
}
