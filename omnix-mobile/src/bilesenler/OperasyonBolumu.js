// Ana sayfa "Operasyon" bölümü (03.11.2026): yalnız sunucunun İş Ata yetkisi verdiği hesapta görünür (/is-atama/yetkim).
// Menüyü gizlemek yetki değildir — her uç sunucuda ayrıca denetlenir. Saha personelinin "İşlerim" ekranı bundan ayrıdır.
import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { aralik, kose, renk } from "../tema";
import { BolumBasligi, Kart, Metin } from "./temel";
import { useVeri } from "../api/veri";
import { atamaApi } from "../api/uclar";

export function OperasyonBolumu({ navigation }) {
  const y = useVeri("isAtamaYetki", () => atamaApi.yetkim(), { odaktaYenile: false });
  if (!y.veri?.yetkili) return null;
  return (
    <View>
      <BolumBasligi baslik="Operasyon" />
      <Kart onPress={() => navigation.navigate("IsAtama")} erisimEtiketi="İş Atama: ekibe iş ata, atamaları yönet" style={{ backgroundColor: renk.lacivert, borderWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ width: 44, height: 44, borderRadius: kose.m, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="people" size={24} color={renk.altinAcik} />
          </View>
          <View style={{ flex: 1, marginLeft: aralik.s, minWidth: 0 }}>
            <Metin tur="govdeKalin" renk="#FFFFFF">İş Atama</Metin>
            <Metin tur="kucuk" renk="#C7D3E3" numberOfLines={1}>Ekibe iş ata · atamaları gör ve güncelle</Metin>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#C7D3E3" />
        </View>
      </Kart>
    </View>
  );
}
