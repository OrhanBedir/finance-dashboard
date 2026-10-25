// Bağlantı kesilince üstte ince bant: kullanıcı neyin kaybolmadığını bilsin.
import React from "react";
import { View } from "react-native";
import { useNetworkState } from "expo-network";
import { Ionicons } from "@expo/vector-icons";
import { aralik, renk } from "../tema";
import { Metin } from "./temel";

export function useCevrimici() {
  const s = useNetworkState();
  // Bilinmiyorsa (ilk an) çevrimiçi varsay; yanlış "çevrimdışı" uyarısı göstermeyelim
  return !(s.isConnected === false || s.isInternetReachable === false);
}

export function BaglantiBandi() {
  const cevrimici = useCevrimici();
  if (cevrimici) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: renk.uyariZemin, paddingHorizontal: aralik.m, paddingVertical: 6 }}
      accessibilityLiveRegion="polite">
      <Ionicons name="cloud-offline-outline" size={16} color={renk.uyari} style={{ marginRight: 6 }} />
      <Metin tur="minik" renk={renk.uyari} style={{ flex: 1 }}>Çevrimdışısınız. Girdikleriniz telefonda saklanır; bağlantı gelince gönderebilirsiniz.</Metin>
    </View>
  );
}
