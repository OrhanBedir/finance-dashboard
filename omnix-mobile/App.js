// Omnix mobil — kök bileşen. Önce Omnix açılışı; oturum doğrulanınca kullanıcının kendi firma paneli.
import "react-native-gesture-handler";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { OturumSaglayici, useOturum } from "./src/oturum/OturumSaglayici";
import { VeriSaglayici } from "./src/api/veri";
import { AcilisEkrani } from "./src/ekranlar/AcilisEkrani";
import { GirisEkrani } from "./src/ekranlar/GirisEkrani";
import { Navigasyon } from "./src/navigasyon/Navigasyon";
import { HataSiniri } from "./src/bilesenler/HataSiniri";

function Kok() {
  const { durum, kapsam, kullanici, dogrula, cikisYap } = useOturum();
  if (durum === "acilis") return <AcilisEkrani mod="acilis" />;
  if (durum === "giris") return <GirisEkrani />;
  if (durum === "dogrulaniyor") return <AcilisEkrani mod="dogrulaniyor" />;
  if (durum === "baglantiYok") return <AcilisEkrani mod="baglantiYok" onTekrar={dogrula} onCikis={cikisYap} />;
  // Kişi veya firma değişince tüm ekranlar ve bellekteki veri sıfırdan kurulur
  return (
    <VeriSaglayici key={`${kapsam}:${kullanici?.marka || ""}`}>
      <HataSiniri>
        <Navigasyon />
      </HataSiniri>
    </VeriSaglayici>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <OturumSaglayici>
        <Kok />
      </OturumSaglayici>
    </SafeAreaProvider>
  );
}
