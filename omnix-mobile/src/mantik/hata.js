// API hatalarını kullanıcıya gösterilecek sade Türkçe metne çevirir. Teknik metin (SQL, yığın izi,
// "Cannot POST", İngilizce sunucu hatası) asla ekrana çıkmaz.

export class ApiHatasi extends Error {
  constructor(tur, kullaniciMesaji, { durumKodu = null, sunucuMesaji = null } = {}) {
    super(kullaniciMesaji);
    this.name = "ApiHatasi";
    this.tur = tur; // ag | zamanAsimi | oturum | yetki | bulunamadi | dogrulama | sunucu
    this.durumKodu = durumKodu;
    this.sunucuMesaji = sunucuMesaji;
  }
  // Ağ / zaman aşımı: isteğin sunucuya ulaşıp ulaşmadığı BİLİNMİYOR — tekrar denemeden önce uzlaştırma gerekir
  get sonucBelirsiz() {
    return this.tur === "ag" || this.tur === "zamanAsimi";
  }
}

const TEKNIK = /column|relation|syntax|violates|null value|constraint|undefined|TypeError|ReferenceError|ECONN|ETIMEDOUT|Cannot (GET|POST|PUT|DELETE)|<html|<!DOCTYPE|at \w+ \(|invalid input|duplicate key|pg_|SELECT |INSERT |UPDATE /i;

export function kullaniciMetniMi(m) {
  if (!m || typeof m !== "string") return false;
  if (m.length > 240) return false;
  if (TEKNIK.test(m)) return false;
  // Türkçe harf ya da yaygın Türkçe sözcük içermeyen metin büyük ihtimalle İngilizce teknik mesajdır
  return /[çğıöşüÇĞİÖŞÜ]|\b(lütfen|yetki|zorunlu|bulunamadı|değil|yok|geçersiz|seçin|giriniz|hatalı|kayıt|form)\b/i.test(m);
}

export function hataSinifla(durumKodu, sunucuMesaji) {
  const okunur = kullaniciMetniMi(sunucuMesaji) ? sunucuMesaji : null;
  if (durumKodu === 401) return new ApiHatasi("oturum", "Oturumunuzun süresi doldu. Lütfen yeniden giriş yapın.", { durumKodu, sunucuMesaji });
  if (durumKodu === 403) return new ApiHatasi("yetki", okunur || "Bu işlem için yetkiniz yok.", { durumKodu, sunucuMesaji });
  if (durumKodu === 404) return new ApiHatasi("bulunamadi", okunur || "Kayıt bulunamadı. Silinmiş ya da taşınmış olabilir.", { durumKodu, sunucuMesaji });
  if (durumKodu === 413) return new ApiHatasi("dogrulama", "Dosya çok büyük. Daha küçük bir fotoğraf seçin.", { durumKodu, sunucuMesaji });
  if (durumKodu === 429) return new ApiHatasi("dogrulama", okunur || "Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin.", { durumKodu, sunucuMesaji });
  if (durumKodu >= 400 && durumKodu < 500) return new ApiHatasi("dogrulama", okunur || "Bilgiler kaydedilemedi. Lütfen alanları kontrol edin.", { durumKodu, sunucuMesaji });
  return new ApiHatasi("sunucu", "Sunucuda geçici bir sorun var. Biraz sonra tekrar deneyin.", { durumKodu, sunucuMesaji });
}

// "Telefonda saklandı" burada YAZILMAZ: yalnız gerçekten taslak saklayan ekranlar (masraf, avans, malzeme) kendi metninde söyler
export const agHatasi = () => new ApiHatasi("ag", "İnternet bağlantısı yok ya da sunucuya ulaşılamadı.");
export const zamanAsimiHatasi = () => new ApiHatasi("zamanAsimi", "Sunucu zamanında yanıt vermedi. İşlemin durumu kontrol edilecek; tekrar deneyebilirsiniz.");

// Okuma hatasının başlığı: yetki hatası bağlantı hatası gibi sunulmaz
export function okumaHataBasligi(e, varsayilan = "Bilgiler yüklenemedi") {
  if (e?.tur === "yetki") return "Bu bilgiyi görme yetkiniz yok";
  if (e?.tur === "oturum") return "Oturum sona erdi";
  if (e?.tur === "ag" || e?.tur === "zamanAsimi") return "Bağlantı kurulamadı";
  return varsayilan;
}

export function hataMetni(e, yedek = "Bir sorun oluştu. Lütfen tekrar deneyin.") {
  if (e instanceof ApiHatasi) return e.message;
  return yedek;
}
