// Telefonda saklanan taslaklar (gönderilmemiş avans talebi, masraf kalemi + fiş fotoğrafları, malzeme talebi).
// - Her kayıt kullanıcı/firma kapsamı anahtarının altındadır (mantik/kapsam.js); başka hesap göremez.
// - Fotoğraflar uygulamanın kendi belge klasörüne kopyalanır: galeri/kamera geçici dosyası silinse de kaybolmaz.
// - Gönderim adımları kayda yazılır (ör. kalem kaydedildi → kalemId); yeniden denemede kalınan yerden devam
//   edilir, aynı kayıt ikinci kez oluşturulmaz.
// Yeni uygulamanın deposu ve klasörü eski "ERC Operasyon" uygulamasından tamamen ayrıdır (farklı bundle).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";

const anahtar = (kapsam) => `omnix.v1.${kapsam}.taslaklar`;

function klasor(kapsam) {
  const d = new Directory(Paths.document, "omnix", kapsam, "fisler");
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

async function oku(kapsam) {
  try {
    const ham = await AsyncStorage.getItem(anahtar(kapsam));
    const veri = ham ? JSON.parse(ham) : {};
    return veri && typeof veri === "object" ? veri : {};
  } catch {
    return {};
  }
}

async function yaz(kapsam, veri) {
  await AsyncStorage.setItem(anahtar(kapsam), JSON.stringify(veri));
}

export const yeniKimlik = () => Crypto.randomUUID();

// Aynı anda iki kayıt (ör. yazarken otomatik kayıt + gönderim adımı) birbirinin üzerine yazmasın
let _kuyruk = Promise.resolve();
function sirayla(is) {
  const p = _kuyruk.then(is, is);
  _kuyruk = p.catch(() => {});
  return p;
}

export async function taslaklar(kapsam, tur) {
  if (!kapsam) return [];
  const v = await oku(kapsam);
  return Object.values(v)
    .filter((t) => !tur || t.tur === tur)
    .sort((a, b) => String(b.guncelleme || "").localeCompare(String(a.guncelleme || "")));
}

export async function taslak(kapsam, id) {
  if (!kapsam || !id) return null;
  const v = await oku(kapsam);
  return v[id] || null;
}

export function taslakKaydet(kapsam, kayit) {
  if (!kapsam) return Promise.reject(new Error("kapsam yok"));
  return sirayla(async () => {
    const v = await oku(kapsam);
    const id = kayit.id || yeniKimlik();
    const eski = v[id] || {};
    const yeni = { ...eski, ...kayit, id, guncelleme: new Date().toISOString() };
    // Fotoğraflar uri ile birleştirilir: otomatik kayıt yalnız temel alanları yazar, gönderim adım bilgisi
    // (durum, denendi, belgeId, istek kimlikleri) korunur; listeden çıkarılan fotoğraf düşer
    if (Array.isArray(kayit.fotolar) && Array.isArray(eski.fotolar)) {
      yeni.fotolar = kayit.fotolar.map((f) => ({ ...(eski.fotolar.find((x) => x.uri === f.uri) || {}), ...f }));
    }
    v[id] = yeni;
    await yaz(kapsam, v);
    return yeni;
  });
}

export function taslakSil(kapsam, id) {
  if (!kapsam || !id) return Promise.resolve();
  return sirayla(async () => {
    const v = await oku(kapsam);
    const t = v[id];
    delete v[id];
    await yaz(kapsam, v);
    (t?.fotolar || []).forEach((f) => fotoSil(f.uri));
  });
}

// Çıkışta: bu kullanıcının bütün taslakları ve fotoğrafları silinir
export function kapsamiTemizle(kapsam) {
  if (!kapsam) return Promise.resolve();
  return sirayla(async () => {
    await AsyncStorage.removeItem(anahtar(kapsam));
    try {
      const d = new Directory(Paths.document, "omnix", kapsam);
      if (d.exists) d.delete();
    } catch {}
  });
}

// Seçilen fotoğrafı kapsam klasörüne kopyalar → { uri, ad, mime, boyut }
export function fotoSakla(kapsam, kaynakUri, mime = "image/jpeg") {
  const uzanti = mime.includes("png") ? "png" : "jpg";
  const ad = `fis-${yeniKimlik()}.${uzanti}`;
  const hedef = new File(klasor(kapsam), ad);
  new File(kaynakUri).copy(hedef);
  return { uri: hedef.uri, ad, mime, boyut: hedef.size };
}

export function fotoVarMi(uri) {
  try { return !!uri && new File(uri).exists; } catch { return false; }
}

export function fotoSil(uri) {
  try { const f = new File(uri); if (f.exists) f.delete(); } catch {}
}
