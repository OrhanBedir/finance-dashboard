// API ortamları açıkça ayrıdır (app.config.js → extra.apiOrtami). Ayrı bir test sunucusu olmadığı için
// "Omnix Test" (TestFlight) build'i CANLI API'yi kullanır; gerçek hesapla test Orhan'ın onayına bağlıdır.
import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra || {};

const API_ADRESLERI = {
  // Geliştirme: Mac'te DB'siz/yerel sahte veriyle çalışan backend (simülatör localhost'a doğrudan ulaşır)
  yerel: process.env.EXPO_PUBLIC_YEREL_API || "http://127.0.0.1:5099",
  canli: "https://erc-backend-zz5s.onrender.com",
};

export const APP_VARIANT = extra.appVariant || "development";
export const API_ORTAMI = extra.apiOrtami === "canli" ? "canli" : "yerel";
export const API_BASE = API_ADRESLERI[API_ORTAMI];
// Kullanıcıya teknik ayar gösterilmez; yalnız canlı olmayan build'lerde küçük bir "TEST" işareti çıkar.
export const TEST_ISARETI = APP_VARIANT !== "production" && !extra.magazaGorunumu;
export const SURUM = `${Constants.expoConfig?.version || "1.0.0"}`;
