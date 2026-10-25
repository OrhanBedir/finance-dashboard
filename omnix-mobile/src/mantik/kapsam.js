// Kullanıcı/firma kapsamı: taslaklar ve yerel dosyalar bu anahtarın altında tutulur. Anahtar yalnız
// backend'in doğruladığı oturumdan (id + tenant + e-posta) üretilir; başka hesap aynı cihazda giriş yapınca
// farklı anahtar çıkar ve önceki kişinin taslakları ona AÇILMAZ.

export function kapsamAnahtari(kullanici) {
  if (!kullanici || kullanici.id === undefined || kullanici.id === null || !kullanici.email) return null;
  const temiz = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${temiz(kullanici.tenant || "erc")}_${temiz(kullanici.id)}_${temiz(kullanici.email)}`;
}

// Firma görünümü: ad backend oturumundan (marka_ad → tenant_name); sabit firma adı yazılmaz
export function firmaKimligi(kullanici) {
  if (!kullanici) return null;
  const ad = String(kullanici.marka_ad || kullanici.tenant_name || "").trim() || "Omnix";
  const logo = kullanici.marka_logo_url || kullanici.logo_url || null; // backend ileride verirse
  return { ad, kod: kullanici.marka || null, logo };
}

// Oturum tazelemede firma veya kişi değiştiyse ekranlar ve önbellek sıfırlanmalı
export function kimlikDegistiMi(eski, yeni) {
  if (!eski || !yeni) return true;
  return kapsamAnahtari(eski) !== kapsamAnahtari(yeni) || (eski.marka || null) !== (yeni.marka || null);
}
