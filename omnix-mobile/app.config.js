// Omnix mobil — uygulama yapılandırması (24.10.2026, Orhan)
//
// ESKİ UYGULAMADAN TAMAMEN AYRI KİMLİK: eski "ERC Operasyon" (ERC/mobile, com.simsektel.ercoperasyon,
// EAS projesi 90c62b24…, App Store Connect 6775361138) ile hiçbir kimlik paylaşılmaz. İki uygulama aynı
// iPhone'da yan yana kurulur; yerel depolama, anahtar zinciri ve dosyalar bundle kimliğine göre ayrıdır.
//
// Ortam (APP_VARIANT) — eas.json profilleri ayarlar:
//   development → "Omnix Geliştirme", bundle global.omnix.app.dev, yerel sahte backend (http://127.0.0.1:5099)
//   test        → "Omnix Test" (test rozetli ikon), bundle global.omnix.app, CANLI API (ayrı test sunucusu yok)
//   production  → "Omnix", bundle global.omnix.app, CANLI API
// EAS projesi: @orhanbedir/omnix (9f72c533…, 24.10.2026 — eski ERC Operasyon projesi 90c62b24… ile ilgisi yok).
// App Store adı "Omnix Field Operation" (mağazada "Omnix" adı başka geliştiricide); telefondaki simge adı "Omnix".

const VARIANT = process.env.APP_VARIANT || "development";

const ORTAM = {
  development: {
    ad: "Omnix Geliştirme",
    bundle: "global.omnix.app.dev",
    ikon: "./assets/icon-test.png",
    apiOrtami: "yerel",
  },
  test: {
    ad: "Omnix Test",
    bundle: "global.omnix.app",
    ikon: "./assets/icon-test.png",
    apiOrtami: "canli",
  },
  production: {
    ad: "Omnix",
    bundle: "global.omnix.app",
    ikon: "./assets/icon.png",
    apiOrtami: "canli",
  },
}[VARIANT];

if (!ORTAM) throw new Error(`Bilinmeyen APP_VARIANT: ${VARIANT}`);

module.exports = {
  expo: {
    name: ORTAM.ad,
    slug: "omnix",
    owner: "orhanbedir",
    scheme: "omnix",
    version: "1.0.0",
    orientation: "portrait",
    icon: ORTAM.ikon,
    userInterfaceStyle: "light",
    newArchEnabled: true,
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#1E3A5F",
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: ORTAM.bundle,
      buildNumber: "1",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription: "Masraf fişlerinin fotoğrafını çekmek için kamera kullanılır.",
        NSPhotoLibraryUsageDescription: "Masraf fişi fotoğraflarını galeriden seçmek için fotoğraflarınıza erişilir.",
      },
    },
    android: {
      package: ORTAM.bundle,
      versionCode: 1,
      edgeToEdgeEnabled: true,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#1E3A5F",
      },
    },
    plugins: [
      "expo-secure-store",
      [
        "expo-image-picker",
        {
          photosPermission: "Masraf fişi fotoğraflarını galeriden seçmek için fotoğraflarınıza erişilir.",
          cameraPermission: "Masraf fişlerinin fotoğrafını çekmek için kamera kullanılır.",
          microphonePermission: false,
        },
      ],
      [
        "expo-splash-screen",
        { image: "./assets/splash.png", imageWidth: 180, resizeMode: "contain", backgroundColor: "#1E3A5F" },
      ],
    ],
    extra: {
      appVariant: VARIANT,
      // Yalnız geliştirme sürümünde, App Store ekran görüntüsü çekimi için: TEST işareti gizlenir, API yerel kalır
      magazaGorunumu: VARIANT === "development" && process.env.OMNIX_MAGAZA_GORUNUMU === "1",
      apiOrtami: ORTAM.apiOrtami,
      eas: { projectId: "9f72c533-5414-48cd-b3f4-1857713d9981" },
    },
    // OTA güncelleme (expo-updates) ilk sürümde YOK. Eklenirse kanal adları "omnix-*" olmalı ve yalnız bu
    // projenin EAS kimliğine bağlanmalı — eski ERC Operasyon uygulamasına güncelleme gidemez.
  },
};
