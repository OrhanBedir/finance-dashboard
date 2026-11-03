// İş Atama (yönetici) saf mantığı — ekrandan bağımsız, node testleriyle denetlenir.
// Kurallar sunucuyla AYNI (is_kategori: tekil_site, saha_zorunlu, alt_tipler): burada yalnız kullanıcıya erken uyarı verilir;
// kesin kontrol (kapsam, mükerrer, çakışma) sunucuda yapılır.

export const ADIMLAR = [
  { id: "kategori", ad: "Kategori" }, { id: "saha", ad: "Saha" }, { id: "kisi", ad: "Ekip" }, { id: "zaman", ad: "Tarih" }, { id: "ozet", ad: "Kontrol" },
];
export const BOS_FORM = { kategori: null, alt_tip: "", isler: [], konum_aciklama: "", ekip_no: null, personeller: [], plan_tarihi: "", saatli: false, bas_saat: "08:30", bit_saat: "17:30", atayan_not: "" };

export const sahasizMi = (kat) => !!kat && kat.saha_zorunlu === false;
export const tekilMi = (kat) => !!kat && !!kat.tekil_site;

// Bir adımın hataları (boş dizi = geçerli). kat: seçilen kategori nesnesi (sunucudan)
export function adimHatalari(adim, f, kat) {
  const h = [];
  if (adim === "kategori") {
    if (!f.kategori) h.push("İş kategorisi seçin");
    else if ((kat?.alt_tipler || []).length && !f.alt_tip) h.push(`${kat.ad} için tip seçin (${kat.alt_tipler.join(", ")})`);
  }
  if (adim === "saha") {
    if (sahasizMi(kat)) { if (!String(f.konum_aciklama || "").trim() && !(f.isler || []).length) h.push("Yer / açıklama yazın (bu faaliyette Site ID zorunlu değil)"); }
    else if (!(f.isler || []).length) h.push("En az bir iş kodu seçin");
    if (tekilMi(kat) && (f.isler || []).length > 1) h.push(`${kat.ad} için tek iş kodu seçilmeli`);
  }
  if (adim === "kisi") {
    if (!(f.personeller || []).length) h.push("Ekip ya da en az bir personel seçin");
  }
  if (adim === "zaman") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.plan_tarihi || ""))) h.push("Planlanan tarihi seçin");
    if (f.saatli) {
      if (!/^\d{2}:\d{2}$/.test(f.bas_saat || "") || !/^\d{2}:\d{2}$/.test(f.bit_saat || "")) h.push("Başlangıç ve bitiş saatini girin");
      else if (f.bit_saat <= f.bas_saat) h.push("Bitiş saati başlangıçtan sonra olmalı");
    }
  }
  return h;
}
export const formHatalari = (f, kat) => ADIMLAR.filter((a) => a.id !== "ozet").flatMap((a) => adimHatalari(a.id, f, kat));
export const adimTamam = (adim, f, kat) => adimHatalari(adim, f, kat).length === 0;

// Yerel saat → ISO (İstanbul, +03:00). Saat yalnız kullanıcı girdiyse üretilir.
export const zamanBirlestir = (gun, saat) => `${gun}T${saat}:00+03:00`;
export function zamanAyir(iso) {
  if (!iso) return null;
  const d = new Date(new Date(iso).getTime() + 3 * 3600e3);
  return { gun: d.toISOString().slice(0, 10), saat: d.toISOString().slice(11, 16) };
}

// Sunucuya gönderilecek gövde (kontrol ve oluşturma aynı gövdeyi kullanır)
export function govdeHazirla(f) {
  const g = { kategori: f.kategori, alt_tip: f.alt_tip || null, site_codes: (f.isler || []).map((i) => i.site_code), personeller: (f.personeller || []).map((p) => ({ email: p.email, ad: p.ad })),
    plan_tarihi: f.plan_tarihi || null, atayan_not: String(f.atayan_not || "").trim() || null, konum_aciklama: String(f.konum_aciklama || "").trim() || null };
  if (f.ekip_no != null) g.ekip_no = f.ekip_no;
  if (f.saatli && f.plan_tarihi) { g.plan_baslangic = zamanBirlestir(f.plan_tarihi, f.bas_saat); g.plan_bitis = zamanBirlestir(f.plan_tarihi, f.bit_saat); }
  return g;
}

// Ekip seçimi: ekibin e-postalı üyeleri kişi listesine; e-postasız üye seçilemez (mobil hesaba bağlanamaz)
export function ekiptenKisiler(ekip) {
  return (ekip?.uyeler || []).filter((u) => u.email).map((u) => ({ email: String(u.email).toLowerCase(), ad: u.ad, ekip_no: ekip.ekip_no, ulasir: u.ulasir !== false }));
}
export const kisiEkle = (liste, p) => (liste.some((x) => x.email === p.email) ? liste : [...liste, p]);
export const kisiCikar = (liste, email) => liste.filter((x) => x.email !== email);
export const isEkle = (liste, is, tekil) => (liste.some((x) => x.site_code === is.site_code) ? liste : tekil ? [is] : [...liste, is]);
export const isCikar = (liste, kod) => liste.filter((x) => x.site_code !== kod);

// Özet satırları (kontrol adımı)
export function ozetSatirlari(f, kat, ekipler = []) {
  const ekip = f.ekip_no != null ? ekipler.find((e) => Number(e.ekip_no) === Number(f.ekip_no)) : null;
  const ulasmayan = (f.personeller || []).filter((p) => p.ulasir === false);
  return [
    { etiket: "Kategori", deger: [kat?.ad || f.kategori, f.alt_tip].filter(Boolean).join(" · ") },
    { etiket: sahasizMi(kat) && !(f.isler || []).length ? "Yer / açıklama" : "İş kodları", deger: (f.isler || []).length ? f.isler.map((i) => i.site_code).join(", ") : f.konum_aciklama || "—" },
    { etiket: ekip ? "Ekip" : "Personel", deger: ekip ? `${ekip.ad} · ${(f.personeller || []).map((p) => p.ad).join(", ")}` : (f.personeller || []).map((p) => p.ad).join(", ") || "—" },
    { etiket: "Tarih", deger: f.plan_tarihi ? (f.saatli ? `${tarihTR(f.plan_tarihi)} · ${f.bas_saat}–${f.bit_saat}` : `${tarihTR(f.plan_tarihi)} (gün)`) : "—" },
    ...(f.atayan_not ? [{ etiket: "Not", deger: f.atayan_not }] : []),
    ...(ulasmayan.length ? [{ etiket: "Uyarı", deger: `${ulasmayan.map((p) => p.ad).join(", ")}: mobil hesabı yok — atama bu kişilere ULAŞMAZ`, uyari: true }] : []),
  ];
}
export const tarihTR = (g) => (g ? String(g).slice(0, 10).split("-").reverse().join(".") : "");

// Liste kartı alt satırı: ekip / kişiler · tarih · fiilî durum
export function kartAltSatir(r) {
  const kim = r.ekip_ad ? `${r.ekip_ad}${r.kisi_sayisi ? ` (${r.kisi_sayisi})` : ""}` : (r.kisiler || []).slice(0, 2).join(", ") + ((r.kisiler || []).length > 2 ? ` +${r.kisiler.length - 2}` : "");
  const z = r.plan_tarihi ? (r.saatli && r.plan_baslangic ? `${tarihTR(r.plan_tarihi)} ${zamanAyir(r.plan_baslangic)?.saat || ""}` : tarihTR(r.plan_tarihi)) : "tarihsiz";
  return [kim || (r.taseron ? "Taşeron" : "—"), z, r.geciken ? "gecikti" : null].filter(Boolean).join(" · ");
}

// Liste filtre sekmeleri
export const LISTE_FILTRELERI = [
  { id: "bugun", ad: "Bugün" }, { id: "gelecek", ad: "Gelecek" }, { id: "devam", ad: "Devam eden" }, { id: "tamamlanan", ad: "Tamamlanan" }, { id: "iptal", ad: "İptal" },
];

// Taslak: form telefonda saklanır (bağlantı kesilince kaybolmaz); tamamlanınca silinir
export const TASLAK_TURU = "isAtama";
