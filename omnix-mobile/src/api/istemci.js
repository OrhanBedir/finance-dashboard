// Omnix API istemcisi. Token yalnız bellekte ve SecureStore'da (Keychain) tutulur; her istek zaman aşımına
// bağlıdır; 401 gelince oturum düşürülür (taslaklar korunur) ve kullanıcı giriş ekranına yönlenir.
import { API_BASE } from "../config/ortam";
import { ApiHatasi, agHatasi, hataSinifla, zamanAsimiHatasi } from "../mantik/hata";

let _token = null;
let _oturumDustu = null;

export function tokenAyarla(t) { _token = t || null; }
export function oturumDustuDinleyicisi(fn) { _oturumDustu = fn; }

async function govdeOku(res) {
  const metin = await res.text().catch(() => "");
  if (!metin) return null;
  try { return JSON.parse(metin); } catch { return { _ham: metin }; }
}

/**
 * @param {string} yol  — "/hr/is-avans" gibi
 * @param {{ method?: string, govde?: any, form?: FormData, zamanAsimiMs?: number, kimliksiz?: boolean }} secenek
 */
export async function istek(yol, { method = "GET", govde, form, zamanAsimiMs = 30000, kimliksiz = false } = {}) {
  const basliklar = { Accept: "application/json" };
  const kullanilanToken = kimliksiz ? null : _token;
  if (kullanilanToken) basliklar.Authorization = `Bearer ${kullanilanToken}`;
  let body;
  if (form) body = form;
  else if (govde !== undefined) { basliklar["Content-Type"] = "application/json"; body = JSON.stringify(govde); }

  const ctrl = new AbortController();
  const zamanlayici = setTimeout(() => ctrl.abort(), zamanAsimiMs);
  let res;
  try {
    res = await fetch(`${API_BASE}${yol}`, { method, headers: basliklar, body, signal: ctrl.signal });
  } catch (e) {
    throw e?.name === "AbortError" ? zamanAsimiHatasi() : agHatasi();
  } finally {
    clearTimeout(zamanlayici);
  }

  const veri = await govdeOku(res);
  const sunucuMesaji = veri && typeof veri === "object" ? (veri.error || veri.mesaj || null) : null;

  if (res.status === 401 && !kimliksiz) {
    const h = hataSinifla(401, sunucuMesaji);
    // Çıkış/hesap değişiminden sonra dönen eski isteğin 401'i yeni oturumu düşürmesin
    if (_oturumDustu && kullanilanToken && kullanilanToken === _token) _oturumDustu(h.message);
    throw h;
  }
  if (!res.ok) throw hataSinifla(res.status, sunucuMesaji);
  // Bazı eski uçlar hata durumunda 200 + { ok:false, error } döndürür
  if (veri && typeof veri === "object" && !Array.isArray(veri) && (veri.ok === false || (veri.error && !veri.id))) {
    throw hataSinifla(400, sunucuMesaji);
  }
  if (veri && veri._ham !== undefined) throw new ApiHatasi("sunucu", "Sunucudan beklenmeyen bir yanıt geldi. Lütfen tekrar deneyin.");
  return veri;
}

export const api = {
  get: (yol, s) => istek(yol, { ...s, method: "GET" }),
  post: (yol, govde, s) => istek(yol, { ...s, method: "POST", govde }),
  put: (yol, govde, s) => istek(yol, { ...s, method: "PUT", govde: govde ?? {} }),
  sil: (yol, govde, s) => istek(yol, { ...s, method: "DELETE", govde }),
  // Dosya yükleme: alan adı "dosya" (backend multer.single("dosya"))
  yukle: (yol, dosya, ekAlanlar = {}, s) => {
    const form = new FormData();
    form.append("dosya", { uri: dosya.uri, type: dosya.mime || "image/jpeg", name: dosya.ad || "fis.jpg" });
    Object.entries(ekAlanlar).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") form.append(k, String(v)); });
    return istek(yol, { ...s, method: "POST", form, zamanAsimiMs: s?.zamanAsimiMs || 150000 });
  },
};
