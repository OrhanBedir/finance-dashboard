// ÇEVRİMDIŞI GÖNDERİM KUYRUĞU (02.11.2026, Orhan) — sahada bağlantı kopunca başla / bitir / issue bildirimleri cihazda bekler,
// bağlantı gelince AYNI istek anahtarıyla yeniden gönderilir (sunucu is_atama_istek ile ikinci kaydı engeller).
// Sunucu 409 + inceleme dönerse (iş bu arada başka ekibe aktarılmış / iptal edilmiş) kayıt kaybolmaz: "inceleme" listesine alınır,
// kullanıcıya açıkça gösterilir. 4xx (yetki / geçersiz) → kuyruktan düşer ve hata listesine yazılır; ağ hatası / 5xx → bekler.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "./api";

const ANAHTAR = "is_kuyruk_v1";
const INCELEME = "is_inceleme_v1";
const SON = "is_sync_v1";
const yeniAnahtar = () => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
let gonderiliyor = false;
const dinleyiciler = new Set();
const bildir = () => { for (const f of dinleyiciler) { try { f(); } catch (_) {} } };

export function kuyrukDinle(f) { dinleyiciler.add(f); return () => dinleyiciler.delete(f); }
async function oku(k) { try { return JSON.parse((await AsyncStorage.getItem(k)) || "[]"); } catch { return []; } }
async function yaz(k, v) { try { await AsyncStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
export async function kuyrukDurumu() {
  const [bekleyen, inceleme, son] = await Promise.all([oku(ANAHTAR), oku(INCELEME), AsyncStorage.getItem(SON).catch(() => null)]);
  return { bekleyen, inceleme, son_sync: son || null };
}
export async function incelemeTemizle(id) { const l = (await oku(INCELEME)).filter((x) => x.id !== id); await yaz(INCELEME, l); bildir(); }

// Tek deneme: ağ hatasında bilinmez → throw { aglagi: true }
async function gonder(item) {
  const token = await AsyncStorage.getItem("token");
  let res;
  try {
    res = await fetch(`${API_BASE}${item.path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}`, "x-istemci": "mobil" },
      body: JSON.stringify({ ...(item.body || {}), istek_anahtari: item.anahtar }) });
  } catch (e) { const h = new Error("Bağlantı yok"); h.aglagi = true; throw h; }
  const j = await res.json().catch(() => ({}));
  if (res.status >= 500) { const h = new Error(j.error || `Sunucu hatası ${res.status}`); h.aglagi = true; throw h; }
  if (res.status === 409 && j.inceleme) { const h = new Error(j.error || "İnceleme gerekiyor"); h.inceleme = true; throw h; }
  if (!res.ok || j.ok === false) { const h = new Error(j.error || `Hata ${res.status}`); h.http = res.status; throw h; }
  return j;
}

// Önce doğrudan dener; olmazsa kuyruğa alır. Dönen: { gonderildi: true, sonuc } | { kuyrukta: true } | throw (kalıcı hata / inceleme)
export async function kuyrukluGonder(path, body, aciklama) {
  const item = { id: yeniAnahtar(), anahtar: yeniAnahtar(), path, body, aciklama, zaman: new Date().toISOString() };
  try {
    const sonuc = await gonder(item);
    await yaz(SON, new Date().toISOString()); bildir();
    return { gonderildi: true, sonuc };
  } catch (e) {
    if (e.aglagi) { const l = await oku(ANAHTAR); l.push(item); await yaz(ANAHTAR, l); bildir(); return { kuyrukta: true, item }; }
    if (e.inceleme) { const l = await oku(INCELEME); l.push({ ...item, neden: e.message }); await yaz(INCELEME, l); bildir(); }
    throw e;
  }
}

// Bekleyenleri sırayla gönder (uygulama öne gelince / ekran açılınca / aralıklı). Sıra korunur; ilk ağ hatasında durur.
export async function kuyrukBosalt() {
  if (gonderiliyor) return { durdu: true };
  gonderiliyor = true;
  try {
    let l = await oku(ANAHTAR); let gonderilen = 0;
    while (l.length) {
      const item = l[0];
      try { await gonder(item); gonderilen++; l = l.slice(1); await yaz(ANAHTAR, l); await yaz(SON, new Date().toISOString()); }
      catch (e) {
        if (e.aglagi) break;
        l = l.slice(1); await yaz(ANAHTAR, l);
        const inc = await oku(INCELEME); inc.push({ ...item, neden: e.message, kalici: !e.inceleme }); await yaz(INCELEME, inc);
      }
    }
    bildir();
    return { gonderilen, bekleyen: l.length };
  } finally { gonderiliyor = false; }
}
