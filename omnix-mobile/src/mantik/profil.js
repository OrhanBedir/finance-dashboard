// Hangi deneyim: backend'in /auth/me ile doğruladığı profil alanlarından (telefonda saklanan role güvenilmez).
//   taseron        — dış taşeron firma kullanıcısı, taşeron kaydına bağlı
//   taseronBagsiz  — taşeron hesabı ama bağlantısı eksik/eski tip: hiçbir veri gösterilmez, yöneticiye yönlendirilir
//   yonetim        — şirket sahibi / yönetici (kendi firması)
//   personel       — şirket personeli (varsayılan)
export function deneyim(k) {
  if (!k) return "personel";
  const tas = k.kullanici_tipi === "TASERON" || String(k.role || "").toLowerCase() === "subcon";
  if (tas) return k.kullanici_tipi === "TASERON" && k.taseron?.id && k.taseron?.aktif !== false ? "taseron" : "taseronBagsiz";
  if (k.yonetim_profili === "SAHIP" || k.yonetim_profili === "YONETICI" || k.izinler?.personel_yonetimi === true) return "yonetim";
  return "personel";
}

// Taşeron saha rolü (/auth/me → taseron_saha): SORUMLU | CALISAN | KAPALI. Alan yoksa (eski sunucu) firma sorumlusu varsayılır —
// yetki her uçta sunucuda ayrıca doğrulanır; burada yalnız sekme seçimi yapılır.
export function sahaRolu(k) {
  const r = k?.taseron_saha?.rol;
  return r === "CALISAN" || r === "KAPALI" ? r : "SORUMLU";
}

// 05.11.2026: firma sorumlusunda "Saha ekranı" kapalıysa Sahalar sekmesi gizlenir; finans / iş görünümü kalır
export const sahaAcik = (k) => k?.taseron_saha?.saha_acik !== false && sahaRolu(k) !== "KAPALI";

// 06.11.2026 firma sahibi (finans) yetkisi — sunucu /auth/me taseron_saha.finans; alan yoksa (eski sunucu) sorumluya açık.
// Menü yalnız görünümdür: finans uçları sunucuda ayrıca kapalıdır.
export const finansVar = (k) => sahaRolu(k) === "SORUMLU" && k?.taseron_saha?.finans !== false;

export const profilAdi = (k) => ({ SAHIP: "Şirket sahibi", YONETICI: "Yönetici" }[k?.yonetim_profili] || null);
