// Fiş fotoğrafı: izin, kamera/galeri, küçültme ve kalıcı kopya. Hata başarı gibi gösterilmez; vazgeçmek hata değildir.
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File } from "expo-file-system";
import { fotoSakla, fotoSil } from "./taslakDepo";
import { FIS_AZAMI_BAYT, FIS_UZUN_KENAR } from "../mantik/sabitler";

function zamanSinirli(p, ms) {
  return Promise.race([p, new Promise((_, red) => setTimeout(() => red(new Error("zaman aşımı")), ms))]);
}

export class FisHatasi extends Error {
  constructor(mesaj, { ayarlar = false } = {}) {
    super(mesaj);
    this.name = "FisHatasi";
    this.ayarlar = ayarlar; // true → "Ayarları aç" önerilir (izin kalıcı reddedilmiş)
  }
}

async function izinIste(kamera) {
  const r = kamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (r.granted || r.status === "granted") return;
  const ne = kamera ? "Kamera" : "Fotoğraf";
  throw new FisHatasi(
    r.canAskAgain === false
      ? `${ne} izni kapalı. Fotoğraf eklemek için Ayarlar > Omnix bölümünden izin verin.`
      : `${ne} izni verilmedi. Fotoğraf eklemek için izin gerekiyor.`,
    { ayarlar: r.canAskAgain === false },
  );
}

/** @returns {Promise<null | {uri:string, ad:string, mime:string, boyut:number, genislik:number, yukseklik:number}>} */
export async function fisSec(kaynak, kapsam) {
  const kamera = kaynak === "kamera";
  await izinIste(kamera);
  // quality < 1: seçici JPEG'i kendisi yeniden sıkıştırır (dosya küçülür, sonraki adım takılsa da yükleme hafif kalır)
  const secenek = { mediaTypes: ["images"], quality: 0.8, allowsEditing: false, exif: false };
  let sonuc;
  try {
    sonuc = kamera ? await ImagePicker.launchCameraAsync(secenek) : await ImagePicker.launchImageLibraryAsync(secenek);
  } catch {
    throw new FisHatasi(kamera ? "Kamera açılamadı. Bu cihazda kamera kullanılamıyor olabilir." : "Galeri açılamadı.");
  }
  if (sonuc.canceled || !sonuc.assets?.[0]) return null; // kullanıcı vazgeçti
  const a = sonuc.assets[0];

  // Uzun kenar 2400 px'e indirilir, JPEG %85 — fiş okunur kalır, yükleme hızlanır, EXIF yönü uygulanır.
  // 24.10.2026 test: Expo Go 54 + iOS 26.5 simülatörde görüntü işleme (eski ve yeni API) dönmeden takıldı;
  // bu yüzden 8 sn zaman sınırı var, takılırsa seçicinin verdiği JPEG olduğu gibi kullanılır.
  const uzun = Math.max(a.width || 0, a.height || 0);
  let hazir = null;
  try {
    const baglam = ImageManipulator.manipulate(a.uri);
    if (uzun > FIS_UZUN_KENAR) baglam.resize((a.width || 0) >= (a.height || 0) ? { width: FIS_UZUN_KENAR, height: null } : { width: null, height: FIS_UZUN_KENAR });
    hazir = await zamanSinirli((async () => (await baglam.renderAsync()).saveAsync({ compress: 0.85, format: SaveFormat.JPEG }))(), 8000);
  } catch {
    hazir = null;
  }
  // Küçültme olmadıysa: seçicinin JPEG/PNG çıktısı olduğu gibi kullanılır (boyut sınırı aşağıda denetlenir)
  if (!hazir) {
    if (!/jpe?g|png/i.test(a.mimeType || a.uri || "")) throw new FisHatasi("Fotoğraf hazırlanamadı. Başka bir fotoğraf deneyin.");
    hazir = { uri: a.uri, width: a.width, height: a.height, orijinal: true };
  }
  const boyut = new File(hazir.uri).size;
  if (boyut > FIS_AZAMI_BAYT) {
    if (!hazir.orijinal) fotoSil(hazir.uri);
    throw new FisHatasi("Fotoğraf çok büyük. Daha yakından ya da daha düşük çözünürlükte çekin.");
  }
  const kalici = fotoSakla(kapsam, hazir.uri, "image/jpeg");
  if (!hazir.orijinal) fotoSil(hazir.uri);
  return { ...kalici, genislik: hazir.width, yukseklik: hazir.height };
}
