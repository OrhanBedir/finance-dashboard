import AsyncStorage from "@react-native-async-storage/async-storage";

// 02.11.2026: yerel test için EXPO_PUBLIC_API_BASE ile değiştirilebilir (ör. Expo Go + yerel API); üretimde canlı adres
export const API_BASE = process.env.EXPO_PUBLIC_API_BASE || "https://erc-backend-zz5s.onrender.com";

async function getAuthHeaders(json = true) {
  const token = await AsyncStorage.getItem("token");
  const headers = {};
  if (json) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

// 29.08.2026: Token süresi dolunca ana ekran (auth'suz mobile-dashboard) veri
// göstermeye devam ediyor, ama onay/red uçları 401 dönüyor ve kullanıcı bunu
// göremiyordu — onaylar sessizce başarısız oluyordu. Artık 401'de token silinir
// ve kullanıcıya açık mesaj gösterilir (bir sonraki açılışta giriş ekranı gelir).
async function oturumHatasi(res) {
  if (res.status !== 401) return null;
  try { await AsyncStorage.multiRemove(["token", "user"]); } catch (_) {}
  return new Error("Oturumunuz sona erdi. Lütfen çıkış yapıp tekrar giriş yapın.");
}

export async function apiPost(path, body, useAuth = false) {
  const headers = { "Content-Type": "application/json" };
  if (useAuth) {
    const token = await AsyncStorage.getItem("token");
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function apiGet(path) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${path}`, { headers });
  const oturum = await oturumHatasi(res);
  if (oturum) throw oturum;
  return res.json();
}

export async function apiPut(path, body = {}) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  const oturum = await oturumHatasi(res);
  if (oturum) throw oturum;
  const data = await res.json().catch(() => ({}));
  // 22.08.2026: 4xx/5xx sessizce yutuluyordu — onay "basarili" gorunup
  // listede kaliyordu. Artik sunucu hatasi kullaniciya Alert ile gosterilir.
  if (!res.ok || (data && data.error)) {
    throw new Error((data && data.error) || `Sunucu hatasi (${res.status})`);
  }
  return data;
}

export async function apiDelete(path) {
  const headers = await getAuthHeaders(false);
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE", headers });
  const oturum = await oturumHatasi(res);
  if (oturum) throw oturum;
  return res.json();
}

// 24.10.2026: fiş işleme / ekleme isteği — bağlantı hatası (e.ag) sunucu hatasından (e.status) ayrılır,
// zaman aşımı vardır; çağıran fotoğrafı ve form bilgisini kaybetmeden tekrar deneyebilir.
export async function apiIstek(path, { method = "POST", body, dosya, zamanAsimiMs = 150000 } = {}) {
  const token = await AsyncStorage.getItem("token");
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let govde;
  if (dosya) {
    govde = new FormData();
    govde.append("dosya", { uri: dosya.uri, type: dosya.type || "image/jpeg", name: dosya.name || "fis.jpg" });
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    govde = JSON.stringify(body);
  }
  const ctrl = new AbortController();
  const zamanlayici = setTimeout(() => ctrl.abort(), zamanAsimiMs);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body: govde, signal: ctrl.signal });
  } catch (e) {
    const h = new Error(e?.name === "AbortError" ? "Sunucu zamanında yanıt vermedi" : "Sunucuya ulaşılamadı — internet bağlantınızı kontrol edin");
    h.ag = true;
    throw h;
  } finally { clearTimeout(zamanlayici); }
  const oturum = await oturumHatasi(res);
  if (oturum) throw oturum;
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data && data.error)) {
    const h = new Error((data && data.error) || `Sunucu hatası (${res.status})`);
    h.status = res.status;
    throw h;
  }
  return data;
}

// Multipart file upload (for receipt photos)
export async function apiUpload(path, fileUri, fileType = "image/jpeg", fieldName = "dosya", ekAlanlar = {}) {
  const token = await AsyncStorage.getItem("token");
  const form = new FormData();
  const fileName = fileUri.split("/").pop() || "photo.jpg";
  form.append(fieldName, { uri: fileUri, type: fileType, name: fileName });
  // 20.10.2026: dosya yanında metin alanları (ör. fiş kırpma künyesi)
  Object.entries(ekAlanlar || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") form.append(k, String(v)); });
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: form,
  });
  return res.json();
}
