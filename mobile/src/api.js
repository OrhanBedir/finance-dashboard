import AsyncStorage from "@react-native-async-storage/async-storage";

export const API_BASE = "https://erc-backend-zz5s.onrender.com";

async function getAuthHeaders(json = true) {
  const token = await AsyncStorage.getItem("token");
  const headers = {};
  if (json) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
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
  return res.json();
}

export async function apiPut(path, body = {}) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function apiDelete(path) {
  const headers = await getAuthHeaders(false);
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE", headers });
  return res.json();
}

// Multipart file upload (for receipt photos)
export async function apiUpload(path, fileUri, fileType = "image/jpeg", fieldName = "dosya") {
  const token = await AsyncStorage.getItem("token");
  const form = new FormData();
  const fileName = fileUri.split("/").pop() || "photo.jpg";
  form.append(fieldName, { uri: fileUri, type: fileType, name: fileName });
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: form,
  });
  return res.json();
}
