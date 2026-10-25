// Form seçenekleri — eski mobil uygulama ve web ile aynı değerler (backend bu metinleri olduğu gibi saklar).

export const GIDER_TURLERI = ["Yol", "Konaklama", "Akşam Yemeği", "Yakıt", "Malzeme", "Ekipman", "Diğer"];

export const BOLGELER = [
  "İstanbul", "Tekirdağ", "Edirne", "Kırklareli", "Çanakkale", "Bursa", "Balıkesir", "Kocaeli", "Sakarya", "Bolu", "Yalova", "Bilecik", "Düzce",
  "İzmir", "Manisa", "Aydın", "Denizli", "Muğla", "Uşak", "Afyonkarahisar", "Kütahya",
  "Ankara", "Konya", "Eskişehir", "Kayseri", "Sivas", "Yozgat", "Aksaray", "Nevşehir", "Niğde", "Kırşehir", "Kırıkkale", "Çankırı", "Karaman",
  "Antalya", "Isparta", "Burdur", "Mersin", "Adana", "Hatay", "Kahramanmaraş", "Osmaniye",
];

export const PROJELER = ["TT - Türk Telekom", "TC - Türkcell", "VF - Vodafone"];

// Masraf kategorileri: anahtar backend kodudur (YEMEK, YAKIT …)
export const MASRAF_KATEGORILERI = [
  { id: "YEMEK", ad: "Yiyecek / içecek", ikon: "restaurant-outline", aciklamaIpucu: "Proje veya iş adı", belgeIpucu: "Restoran / kafe adı" },
  { id: "YAKIT", ad: "Araç yakıt / bakım", ikon: "car-outline", aciklamaIpucu: "Kısa açıklama", belgeIpucu: "Yakıt bedeli, bakım faturası", plaka: true },
  { id: "KONAKLAMA", ad: "Konaklama", ikon: "bed-outline", aciklamaIpucu: "Kaç gece, kaç kişi, otel adı", belgeIpucu: "Otel faturası" },
  { id: "ULASIM", ad: "Ulaşım", ikon: "bus-outline", aciklamaIpucu: "Güzergâh, kişi sayısı, neden", belgeIpucu: "Bilet, taksi fişi" },
  { id: "KOPRU", ad: "Köprü / otoyol", ikon: "trail-sign-outline", aciklamaIpucu: "Geçiş detayı", belgeIpucu: "HGS/OGS dekontu", plaka: true },
  { id: "MALZEME", ad: "Malzeme / ekipman", ikon: "construct-outline", aciklamaIpucu: "Malzeme adı ve detayı", belgeIpucu: "Fatura / irsaliye no", siteId: true },
  { id: "DIGER", ad: "Diğer", ikon: "ellipsis-horizontal-circle-outline", aciklamaIpucu: "İşin detayı", belgeIpucu: "Fiş / fatura açıklaması" },
  { id: "TRAFIK_CEZA", ad: "Trafik cezası", ikon: "alert-circle-outline", aciklamaIpucu: "Ceza detayı", belgeIpucu: "Ceza belgesi", plaka: true },
];

export function kategori(kod) {
  return MASRAF_KATEGORILERI.find((k) => k.id === kod) || { id: kod, ad: kod || "Diğer", ikon: "receipt-outline" };
}

export const MALZEME_BIRIMLERI = ["Adet", "Metre", "Rulo", "Kutu", "Paket", "Kg", "Lt", "Takım", "Diğer"];
export const MALZEME_PROJELERI = ["TT", "TC", "VF", "Diğer"];

export const IS_DURDURMA_SEBEPLERI = ["Yarın devam", "Halk tepkisi", "Farklı sahaya yönlendirildi", "Eksik malzeme", "Hava / erişim sorunu", "Huawei / müşteri kaynaklı bekleme", "Diğer"];

// Fiş fotoğrafı sınırları: backend 20 MB kabul eder; telefonda küçültülüp gönderilir
export const FIS_UZUN_KENAR = 2400;
export const FIS_AZAMI_BAYT = 15 * 1024 * 1024;
