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

export const profilAdi = (k) => ({ SAHIP: "Şirket sahibi", YONETICI: "Yönetici" }[k?.yonetim_profili] || null);
