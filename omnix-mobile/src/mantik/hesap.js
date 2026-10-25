// Kişisel hesap özeti — bakiye mobilde YENİDEN HESAPLANMAZ; /hr/is-avans/hesap (web ekstresiyle aynı uç)
// ne döndürüyorsa o gösterilir. Burada yalnız işaretin ANLAMI ve "yolda" kayıtların gruplanması var.
//
// Backend kuralı: bakiye = ödenen iş avansı + masraf ödemesi − arşivlenen masraf − avans iadesi
//   bakiye > 0 → personelin üzerinde kapatılmamış iş avansı var
//   bakiye < 0 → şirket personele borçlu (masraf alacağı) — "üzerimdeki avans" DEĞİLDİR
import { MASRAF_ONAYDA } from "./durumlar.js";

const ESIK = 0.005;

export function hesapDurumu(bakiye) {
  const n = Number(bakiye);
  if (bakiye === null || bakiye === undefined || !Number.isFinite(n)) {
    return { tur: "bilinmiyor", baslik: "Hesap bilgisi alınamadı", tutar: null, ton: "notr", aciklama: "Bağlantı kurulunca tekrar denenecek." };
  }
  if (n > ESIK) {
    return {
      tur: "avans", baslik: "Üzerinizdeki iş avansı", tutar: n, ton: "uyari",
      aciklama: "Şirketten aldığınız, henüz masraf formuyla kapatılmamış tutar.",
    };
  }
  if (n < -ESIK) {
    return {
      tur: "alacak", baslik: "Şirketten alacağınız", tutar: Math.abs(n), ton: "basari",
      aciklama: "Kapanan masraflarınız aldığınız avanstan fazla. Bu fark size ödenecek masraf alacağıdır.",
    };
  }
  return { tur: "kapali", baslik: "Hesabınız kapalı", tutar: 0, ton: "notr", aciklama: "Açık iş avansınız veya alacağınız yok." };
}

const topla = (liste) => liste.reduce((t, x) => t + (Number(x.tutar) || 0), 0);

// "Yolda" olanlar bakiyeye henüz işlenmez; anlamı ayrı ayrı yazılır ki rozet ile kart farklı şey saymasın.
export function yoldakiler(hesap) {
  const avanslar = hesap?.bekleyen?.avanslar || [];
  const formlar = hesap?.bekleyen?.formlar || [];
  const taslak = formlar.filter((f) => f.durum === "TASLAK");
  const onayda = formlar.filter((f) => MASRAF_ONAYDA.includes(f.durum));
  const kapanis = formlar.filter((f) => f.durum === "TAMAMLANDI");
  return {
    avansTalepleri: { adet: avanslar.length, tutar: topla(avanslar) },
    taslakFormlar: { adet: taslak.length, tutar: topla(taslak) },
    onaydakiFormlar: { adet: onayda.length, tutar: topla(onayda) },
    kapanisBekleyen: { adet: kapanis.length, tutar: topla(kapanis) },
    // Masraf rozeti tam olarak bu sayıdır: kullanıcının elindeki (taslak) + onaydaki formlar
    masrafRozet: taslak.length + onayda.length,
  };
}
