// Onay akışları ve durum adları — web'deki güncel kurguyla aynı sıra (backend durum kodları değişmez).
// Kişi adı yazılmaz (eski mobil "Nurcan / Orhan / Düzgün" gösteriyordu); Omnix çok firmalı olduğu için rol adı kullanılır.

// İŞ AVANSI: Personel → Rollout Müdürü → Proje Müdürü → Proje Direktörü → Muhasebe ödemesi.
// Muhasebe gerçekten ödeyince (TAMAMLANDI) avans personelin hesabına işlenir.
export const AVANS_ADIMLARI = ["Talep", "Rollout Müdürü", "Proje Müdürü", "Proje Direktörü", "Muhasebe ödemesi"];
const AVANS = {
  TALEP: { adim: 1, ad: "Rollout Müdürü onayında", ton: "uyari" },
  ROLLOUT_MUDUR_ONAY: { adim: 2, ad: "Proje Müdürü onayında", ton: "uyari" },
  PM_ONAY: { adim: 3, ad: "Proje Direktörü onayında", ton: "uyari" },
  DIREKTOR_ONAY: { adim: 4, ad: "Onaylandı · muhasebe ödemesi bekleniyor", ton: "bilgi" },
  MUHASEBE_ONAY: { adim: 4, ad: "Onaylandı · muhasebe ödemesi bekleniyor", ton: "bilgi" },
  TAMAMLANDI: { adim: 5, ad: "Ödendi · hesabınıza işlendi", ton: "basari", bitti: true },
  REDDEDILDI: { adim: -1, ad: "Reddedildi", ton: "hata", red: true },
};

// MASRAF FORMU: Personel → Rollout Müdürü → Muhasebe kontrolü → Proje Müdürü → Proje Direktörü → Muhasebe kapanışı (arşiv).
// Arşivlenen form tutarı avans bakiyesinden düşer; avans yoksa personel alacağı oluşur.
export const MASRAF_ADIMLARI = ["Taslak", "Rollout Müdürü", "Muhasebe kontrolü", "Proje Müdürü", "Proje Direktörü", "Kapanış"];
const MASRAF = {
  TASLAK: { adim: 0, ad: "Taslak · onaya gönderilmedi", ton: "notr", taslak: true },
  ROLLOUT_BEKLE: { adim: 1, ad: "Rollout Müdürü onayında", ton: "uyari", onayda: true },
  MUHASEBE_BEKLE: { adim: 2, ad: "Muhasebe kontrolünde", ton: "uyari", onayda: true },
  PM_BEKLE: { adim: 3, ad: "Proje Müdürü onayında", ton: "uyari", onayda: true },
  DIREKTOR_BEKLE: { adim: 4, ad: "Proje Direktörü onayında", ton: "uyari", onayda: true },
  TAMAMLANDI: { adim: 5, ad: "Onaylandı · muhasebe kapanışı bekleniyor", ton: "bilgi" },
  ARSIVLENDI: { adim: 6, ad: "Kapandı · hesabınıza işlendi", ton: "basari", bitti: true },
  REDDEDILDI: { adim: -1, ad: "Reddedildi / iade edildi", ton: "hata", red: true },
};

// MALZEME TALEBİ (web ile aynı başlangıç: ROLLOUT_BEKLE)
const MALZEME = {
  TASLAK: { ad: "Taslak", ton: "notr", taslak: true },
  NURCAN_ONAY: { ad: "Rollout Müdürü onayında", ton: "uyari" },
  ROLLOUT_BEKLE: { ad: "Rollout Müdürü onayında", ton: "uyari" },
  PM_ONAY: { ad: "Proje Müdürü onayında", ton: "uyari" },
  FIYAT_GIRISI: { ad: "Envanter / fiyat girişinde", ton: "bilgi" },
  DUZGUN_ONAY: { ad: "Proje Direktörü onayında", ton: "uyari" },
  ONAYLANDI: { ad: "Onaylandı", ton: "basari" },
  SATINALINACAK: { ad: "Satın alınacak", ton: "bilgi" },
  DEPODA: { ad: "Depoda · teslim alınabilir", ton: "basari", bitti: true },
  REDDEDILDI: { ad: "Reddedildi", ton: "hata", red: true },
};

const ZIMMET = {
  PERSONELDE: { ad: "Üzerinizde", ton: "bilgi", acik: true },
  SAHADA: { ad: "Sahada kullanılıyor", ton: "uyari", acik: true },
  IADE_BEKLEMEDE: { ad: "İade onayı bekleniyor", ton: "uyari" },
  DEPOYA_IADE: { ad: "Depoya iade edildi", ton: "basari" },
};

const IS = {
  ATANDI: { ad: "Atandı", ton: "bilgi" },
  BASLADI: { ad: "Sahadasınız", ton: "basari" },
  DEVAM: { ad: "Devam ediyor", ton: "uyari" },
  ARA_VERILDI: { ad: "Ara verildi", ton: "hata" },
  QC_BEKLE: { ad: "QC bekliyor", ton: "uyari" },
  TAMAMLANDI: { ad: "Tamamlandı", ton: "notr", bitti: true },
  IPTAL: { ad: "İptal edildi", ton: "hata", bitti: true },
};

// Clean Up kaydı onay durumu (rollout_cleanup.onay_durum; boş = TASLAK)
const CLEANUP = {
  TASLAK: { ad: "Devam ediyor", ton: "bilgi" },
  ONAY_BEKLE: { ad: "Onay bekliyor", ton: "uyari" },
  ONAYLANDI: { ad: "Onaylandı", ton: "basari", bitti: true },
  RED: { ad: "Reddedildi · düzeltin", ton: "hata", red: true },
};

const TABLO = { avans: AVANS, masraf: MASRAF, malzeme: MALZEME, zimmet: ZIMMET, is: IS, cleanup: CLEANUP };

// Bilinmeyen kod: ham kodu göstermek yerine okunur hale getir (geliştirici metni değil)
export function durumBilgisi(tur, kod) {
  const t = TABLO[tur] || {};
  if (t[kod]) return { kod, ...t[kod] };
  const ad = kod ? String(kod).replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toLocaleUpperCase("tr-TR")) : "Bilinmiyor";
  return { kod, ad, ton: "notr" };
}

export const MASRAF_ONAYDA = ["ROLLOUT_BEKLE", "MUHASEBE_BEKLE", "PM_BEKLE", "DIREKTOR_BEKLE"];

// Rol kodu → kullanıcıya gösterilen ad (rol yetkisi backend'den gelir; burası yalnız etiket)
const ROL_ADI = {
  platform_admin: "Platform yöneticisi", admin: "Yönetici", genel_mudur: "Genel müdür", direktor: "Proje direktörü",
  pm: "Proje müdürü", rollout_mudur: "Rollout müdürü", bolge_mudur: "Bölge müdürü", muhasebe: "Muhasebe",
  finance: "Finans", isg: "İSG sorumlusu", subcon: "Taşeron", user: "Personel",
};
export function rolAdi(rol) {
  return ROL_ADI[String(rol || "").toLowerCase()] || "Personel";
}
