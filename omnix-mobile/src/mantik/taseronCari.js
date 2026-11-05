// Taşeron "Hakediş ve Cari" — saf görünüm yardımcıları. Bütün tutarlar sunucudaki yönetim cari motorundan gelir
// (/taseron-panel/cari); burada hiçbir bakiye yeniden hesaplanmaz, vergi esası farklı tutarlar birbirinden çıkarılmaz.
export const YON_TON = { ODENECEK: "basari", AVANS: "uyari", DENK: "notr" };
export const CARI_SEKMELER = [
  { kod: "hakedis", ad: "Hakedişler" }, { kod: "odeme", ad: "Ödemeler" }, { kod: "hareket", ad: "Cari hareketler" }, { kod: "fatura", ad: "Faturalar" },
];
export const ODEME_TON = { AVANS: "bilgi", FATURA_ODEME: "basari", MAHSUP: "notr", IPTAL: "hata", FATURA_GIRISI: "basari" };
export const FIYAT_TON = { VAR: "basari", PAKET: "notr", TANIMSIZ: "uyari", BELIRSIZ: "uyari" };
// Ana kartlar: sunucu özetinden, sıra ve vergi esası etiketiyle. Değer yoksa null (ekranda "—"), asla 0 uydurulmaz.
export function cariKartlari(o) {
  if (!o) return [];
  const k = [
    { kod: "is_bedeli", ad: "Yapılan iş bedeli", deger: o.is_bedeli, not: "KDV hariç" },
    { kod: "odenen", ad: "Toplam gerçekleşen ödeme", deger: o.odenen, not: "Ödenen tutar" },
    { kod: "hakedis_kalan", ad: "Kalan hakediş alacağı", deger: o.hakedis_kalan, not: "Avans mahsubundan sonra" },
    { kod: "acik_avans", ad: "Açık avans", deger: o.acik_avans, not: "İşe mahsup bekleyen" },
  ];
  if (o.fatura_toplam) k.push({ kod: "fatura_kalan", ad: "Açık fatura", deger: o.fatura_kalan, not: "KDV dahil" });
  return k;
}
export const hakedisArama = (satirlar, arama) => {
  const q = String(arama || "").toLocaleUpperCase("tr-TR").replace(/İ/g, "I").replace(/\s+/g, "");
  return !q ? satirlar || [] : (satirlar || []).filter((x) => String(x.site_code).includes(q) || String(x.fiziksel_id).includes(q) || String(x.item_code || "").includes(q));
};
