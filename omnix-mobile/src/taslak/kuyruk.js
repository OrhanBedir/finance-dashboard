// ÇEVRİMDIŞI GÖNDERİM KUYRUĞU (03.11.2026, eski ERC Operasyon uygulamasından taşındı) — sahada bağlantı kopunca başla / bitir /
// issue bildirimleri cihazda bekler, bağlantı gelince AYNI istek anahtarıyla yeniden gönderilir (sunucu is_atama_istek ile ikinci
// kaydı engeller). Sunucu 409 + inceleme dönerse (iş bu arada başka ekibe aktarılmış / iptal edilmiş) kayıt kaybolmaz: "inceleme"
// listesine alınır ve kullanıcıya açıkça gösterilir. Diğer 4xx (yetki / geçersiz) → kuyruktan düşer, hata listesine yazılır;
// ağ hatası / zaman aşımı / 5xx → bekler. Kuyruk kişi + firma kapsamına (kapsam) bağlıdır; çıkışta kapsamla birlikte temizlenir.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../api/istemci";
import { yeniKimlik } from "./taslakDepo";

const K = (kapsam, ad) => `omnix:kuyruk:${kapsam || "genel"}:${ad}`;
let gonderiliyor = false;
const dinleyiciler = new Set();
const bildir = () => { for (const f of dinleyiciler) { try { f(); } catch (_) {} } };
export function kuyrukDinle(f) { dinleyiciler.add(f); return () => dinleyiciler.delete(f); }
async function oku(k) { try { return JSON.parse((await AsyncStorage.getItem(k)) || "[]"); } catch { return []; } }
async function yaz(k, v) { try { await AsyncStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }

export async function kuyrukDurumu(kapsam) {
  const [bekleyen, inceleme, son] = await Promise.all([oku(K(kapsam, "bekleyen")), oku(K(kapsam, "inceleme")), AsyncStorage.getItem(K(kapsam, "son")).catch(() => null)]);
  return { bekleyen, inceleme, son_sync: son || null };
}
export async function incelemeTemizle(kapsam, id) { await yaz(K(kapsam, "inceleme"), (await oku(K(kapsam, "inceleme"))).filter((x) => x.id !== id)); bildir(); }
export async function kuyrukTemizle(kapsam) { await Promise.all(["bekleyen", "inceleme", "son"].map((a) => AsyncStorage.removeItem(K(kapsam, a)).catch(() => {}))); bildir(); }

// Tek deneme. Sınıflama: sonucu belirsiz (ağ / zaman aşımı / sunucu) → bekler; 409 inceleme → inceleme; diğer 4xx → kalıcı hata
async function gonder(item) {
  try {
    return await api.post(item.yol, { ...(item.govde || {}), istek_anahtari: item.anahtar });
  } catch (e) {
    if (e?.sonucBelirsiz || e?.tur === "sunucu") { e.bekle = true; throw e; }
    if (e?.durumKodu === 409 && e?.govde?.inceleme) { e.inceleme = true; throw e; }
    throw e;
  }
}

// Önce doğrudan dener; olmazsa kuyruğa alır. Dönen: { gonderildi: true, sonuc } | { kuyrukta: true, item } | throw (kalıcı hata / inceleme)
export async function kuyrukluGonder(kapsam, { yol, govde, aciklama }) {
  const item = { id: yeniKimlik(), anahtar: `m-${yeniKimlik()}`, yol, govde, aciklama, zaman: new Date().toISOString() };
  try {
    const sonuc = await gonder(item);
    await yaz(K(kapsam, "son"), new Date().toISOString()); bildir();
    return { gonderildi: true, sonuc };
  } catch (e) {
    if (e.bekle) { const l = await oku(K(kapsam, "bekleyen")); l.push(item); await yaz(K(kapsam, "bekleyen"), l); bildir(); return { kuyrukta: true, item }; }
    if (e.inceleme) { const l = await oku(K(kapsam, "inceleme")); l.push({ ...item, neden: e.message }); await yaz(K(kapsam, "inceleme"), l); bildir(); }
    throw e;
  }
}

// Bekleyenleri sırayla gönder (uygulama öne gelince / ekran açılınca). Sıra korunur; ilk belirsiz hatada durur.
export async function kuyrukBosalt(kapsam) {
  if (gonderiliyor) return { durdu: true };
  gonderiliyor = true;
  try {
    let l = await oku(K(kapsam, "bekleyen")); let gonderilen = 0;
    while (l.length) {
      const item = l[0];
      try { await gonder(item); gonderilen++; l = l.slice(1); await yaz(K(kapsam, "bekleyen"), l); await yaz(K(kapsam, "son"), new Date().toISOString()); }
      catch (e) {
        if (e.bekle) break;
        l = l.slice(1); await yaz(K(kapsam, "bekleyen"), l);
        const inc = await oku(K(kapsam, "inceleme")); inc.push({ ...item, neden: e.message, kalici: !e.inceleme }); await yaz(K(kapsam, "inceleme"), inc);
      }
    }
    bildir();
    return { gonderilen, bekleyen: l.length };
  } finally { gonderiliyor = false; }
}
