// Profil: kimlik, firma, sürüm, çıkış / hesap değiştir. Çıkışta bu kişinin taslakları telefondan silinir (önce uyarılır).
import React, { useState } from "react";
import { Alert, View } from "react-native";
import { aralik, renk } from "../tema";
import { BilgiSatiri, Buton, Kart, Metin } from "../bilesenler/temel";
import { FirmaLogosu } from "../bilesenler/marka";
import { Ekran } from "../bilesenler/Ekran";
import { useOturum } from "../oturum/OturumSaglayici";
import { firmaKimligi } from "../mantik/kapsam";
import { basHarfler } from "../mantik/bicim";
import { rolAdi } from "../mantik/durumlar";
import { profilAdi } from "../mantik/profil";
import { APP_VARIANT, SURUM } from "../config/ortam";

export function ProfilEkrani() {
  const { kullanici, cikisYap, bekleyenTaslakSayisi } = useOturum();
  const [bekle, setBekle] = useState(false);
  const firma = firmaKimligi(kullanici);

  const cikis = async () => {
    const n = await bekleyenTaslakSayisi();
    Alert.alert(
      "Çıkış yapılsın mı?",
      n ? `Telefonda gönderilmemiş ${n} kayıt var. Çıkış yaparsanız bu kayıtlar ve fotoğrafları bu telefondan silinir.` : "Bu telefondaki oturumunuz kapatılır.",
      [
        { text: "Vazgeç", style: "cancel" },
        { text: n ? "Sil ve çıkış yap" : "Çıkış yap", style: "destructive", onPress: async () => { setBekle(true); await cikisYap(); } },
      ],
    );
  };

  return (
    <Ekran baslik="Profil" geri={false}>
      <Kart style={{ alignItems: "center", paddingVertical: aralik.xl }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: renk.lacivert, alignItems: "center", justifyContent: "center" }}>
          <Metin tur="baslikL" renk="#fff">{basHarfler(kullanici?.name)}</Metin>
        </View>
        <Metin tur="baslikL" style={{ marginTop: aralik.s, textAlign: "center" }}>{kullanici?.name}</Metin>
        <Metin tur="kucuk" renk={renk.metinIkincil}>{kullanici?.email}</Metin>
      </Kart>
      <Kart style={{ marginTop: aralik.s }}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: aralik.s }}>
          <FirmaLogosu firma={firma} boyut={40} />
          <View style={{ marginLeft: aralik.s, flex: 1 }}>
            <Metin tur="govdeKalin">{firma?.ad}</Metin>
            <Metin tur="minik" renk={renk.metinIkincil}>Omnix Platformu</Metin>
          </View>
        </View>
        {kullanici?.taseron ? <BilgiSatiri etiket="Taşeron firma" deger={kullanici.taseron.ad} /> : null}
        <BilgiSatiri etiket="Rol" deger={kullanici?.kullanici_tipi === "TASERON" ? "Taşeron firma kullanıcısı" : profilAdi(kullanici) || rolAdi(kullanici?.role)} son />
      </Kart>
      <Buton baslik="Çıkış yap / hesap değiştir" ikon="log-out-outline" tur="tehlike" onPress={cikis} yukleniyor={bekle} style={{ marginTop: aralik.l }} />
      <Metin tur="minik" renk={renk.metinSoluk} style={{ textAlign: "center", marginTop: aralik.l }}>
        Omnix {SURUM}{APP_VARIANT !== "production" ? ` · ${APP_VARIANT === "test" ? "Test sürümü" : "Geliştirme sürümü"}` : ""}
      </Metin>
    </Ekran>
  );
}
