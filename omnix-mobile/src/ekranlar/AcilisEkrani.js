// Omnix açılış ve "firma bilgileriniz doğrulanıyor" ekranı. Firma backend doğrulayana kadar hiçbir firma
// adı/logosu gösterilmez; bağlantı yoksa panel açılmaz, tekrar deneme sunulur.
import React from "react";
import { ActivityIndicator, StatusBar, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { aralik, renk } from "../tema";
import { Buton, Metin } from "../bilesenler/temel";
import { OmnixYazi } from "../bilesenler/marka";

export function AcilisEkrani({ mod = "acilis", onTekrar, onCikis }) {
  const kenar = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: renk.lacivert, paddingTop: kenar.top, paddingBottom: kenar.bottom + aralik.l }}>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: aralik.xl }}>
        <OmnixYazi acik boyut={34} />
        <Metin tur="kucuk" renk="#C7D3E3" style={{ marginTop: aralik.s }}>Operasyon & Proje Platformu</Metin>
        {mod === "baglantiYok" ? (
          <View style={{ marginTop: aralik.xxl, alignItems: "center" }}>
            <Ionicons name="cloud-offline-outline" size={32} color={renk.altinAcik} />
            <Metin tur="govdeKalin" renk="#FFFFFF" style={{ marginTop: aralik.s, textAlign: "center" }}>Firma bilgileriniz doğrulanamadı</Metin>
            <Metin tur="kucuk" renk="#C7D3E3" style={{ marginTop: 4, textAlign: "center" }}>
              İnternet bağlantınızı kontrol edip tekrar deneyin. Telefondaki taslaklarınız korunur.
            </Metin>
            <Buton baslik="Tekrar dene" ikon="refresh" tur="vurgu" onPress={onTekrar} style={{ marginTop: aralik.l, alignSelf: "stretch", minWidth: 220 }} />
            <Buton baslik="Farklı hesapla giriş" tur="metin" onPress={onCikis} style={{ marginTop: aralik.xs }} />
          </View>
        ) : (
          <View style={{ marginTop: aralik.xxl, alignItems: "center" }} accessibilityLiveRegion="polite">
            <ActivityIndicator color={renk.altinAcik} />
            {mod === "dogrulaniyor" ? (
              <Metin tur="kucuk" renk="#C7D3E3" style={{ marginTop: aralik.s }}>Firma bilgileriniz doğrulanıyor…</Metin>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}
