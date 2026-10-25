// Onay akışı göstergesi: geçilen adımlar yeşil, bekleyen adım altın, sıradakiler gri. Altında düz Türkçe "Sıra kimde".
import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { aralik, renk } from "../tema";
import { Metin } from "./temel";
import { AVANS_ADIMLARI, MASRAF_ADIMLARI, durumBilgisi } from "../mantik/durumlar";

export function AkisAdimlari({ tur, durum, kompakt = false }) {
  const b = durumBilgisi(tur, durum);
  const adimlar = tur === "avans" ? AVANS_ADIMLARI : MASRAF_ADIMLARI;
  if (b.adim === undefined) return null;
  if (b.red) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: aralik.xs }}>
        <Ionicons name="close-circle" size={16} color={renk.hata} />
        <Metin tur="kucukKalin" renk={renk.hata} style={{ marginLeft: 6 }}>{b.ad}</Metin>
      </View>
    );
  }
  const etkin = b.adim;
  return (
    <View style={{ marginTop: aralik.xs }} accessible accessibilityLabel={`Onay durumu: ${b.ad}`}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {adimlar.map((ad, i) => {
          const gecti = i < etkin || b.bitti;
          const simdi = i === etkin && !b.bitti;
          return (
            <React.Fragment key={ad}>
              {i > 0 ? <View style={{ flex: 1, height: 2, backgroundColor: i <= etkin || b.bitti ? renk.basari : renk.cizgi }} /> : null}
              <View style={{
                width: kompakt ? 14 : 18, height: kompakt ? 14 : 18, borderRadius: 9,
                backgroundColor: gecti ? renk.basari : simdi ? renk.altinZemin : renk.yuzey,
                borderWidth: 2, borderColor: gecti ? renk.basari : simdi ? renk.altin : renk.cizgiKoyu,
                alignItems: "center", justifyContent: "center",
              }}>
                {gecti && !kompakt ? <Ionicons name="checkmark" size={11} color="#fff" /> : null}
              </View>
            </React.Fragment>
          );
        })}
      </View>
      {!kompakt ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
          {adimlar.map((ad, i) => (
            <Metin key={ad} tur="minik" renk={i === etkin && !b.bitti ? renk.uyari : renk.metinSoluk}
              style={{ fontSize: 10, lineHeight: 13, width: `${100 / adimlar.length}%`, textAlign: i === 0 ? "left" : i === adimlar.length - 1 ? "right" : "center" }}
              numberOfLines={2} maxFontSizeMultiplier={1.2}>{ad}</Metin>
          ))}
        </View>
      ) : null}
    </View>
  );
}
