// Clean Up kaydı yardımcıları — React Native'e bağımlı değil (node --test ile sınanır).
// Kural backend ile aynı: "sonra" fotoğrafı yüklenen kalem tamamlanır; her kalemde "sonra" varsa onaya gönderilir;
// onaya gönderilmiş / onaylanmış kayıt kilitlidir; personel yalnız kendi yüklediği fotoğrafı, kilitlenmeden önce siler.
export const CLEANUP_KILITLI = ["ONAY_BEKLE", "ONAYLANDI"];

export const cleanupDurumu = (kayit) => kayit?.onay_durum || "TASLAK";
export const duzenlenebilir = (kayit) => !!kayit && !CLEANUP_KILITLI.includes(cleanupDurumu(kayit));
export const kalemMetni = (k) => String(k?.kalem || k?.aciklama || "").replace(/^[•\s]+/, "").trim() || "Eksik kalem";
export const kalemleri = (kayit) => (Array.isArray(kayit?.items) ? kayit.items : []);

export function kalemFotolari(k) {
  const f = Array.isArray(k?.fotolar) ? k.fotolar : [];
  return { once: f.filter((x) => x.tip === "once"), sonra: f.filter((x) => x.tip === "sonra") };
}

export function ilerleme(kayit) {
  const k = kalemleri(kayit);
  const sonraEksik = k.filter((x) => !kalemFotolari(x).sonra.length).length;
  return { toplam: k.length, tamam: k.filter((x) => x.tamamlandi).length, sonraEksik, gonderilebilir: k.length > 0 && sonraEksik === 0 };
}

export function fotoSilinebilir(foto, email, kayit) {
  const ben = String(email || "").toLowerCase().trim();
  return !!ben && duzenlenebilir(kayit) && String(foto?.kullanici || "").toLowerCase().trim() === ben;
}
