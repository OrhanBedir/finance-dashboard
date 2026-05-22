import AsyncStorage from "@react-native-async-storage/async-storage";

export const API_BASE = "https://finance-dashboard-staf.vercel.app";

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
  const token = await AsyncStorage.getItem("token");
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { headers });
  return res.json();
}
