// Ekran iskeleti: güvenli alan (çentik / alt çizgi), üst başlık, kaydırma + çekip yenileme, klavye kaçınma.
import React, { useCallback } from "react";
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StatusBar, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { aralik, DOKUNMA, renk } from "../tema";
import { Metin } from "./temel";
import { BaglantiBandi } from "./BaglantiBandi";

export function UstBaslik({ baslik, altBaslik, geri = true, sag, onGeri }) {
  const nav = useNavigation();
  const ust = useSafeAreaInsets().top;
  useFocusEffect(useCallback(() => { StatusBar.setBarStyle("dark-content", true); }, []));
  return (
    <View style={{ backgroundColor: renk.yuzey, paddingTop: ust, borderBottomWidth: 0.5, borderBottomColor: renk.cizgi }}>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: 52, paddingHorizontal: aralik.xs }}>
        {geri ? (
          <Pressable onPress={onGeri || (() => nav.goBack())} hitSlop={8} accessibilityRole="button" accessibilityLabel="Geri"
            style={{ width: DOKUNMA, height: DOKUNMA, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="chevron-back" size={26} color={renk.lacivert} />
          </Pressable>
        ) : <View style={{ width: aralik.s }} />}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Metin tur="baslikM" numberOfLines={1} accessibilityRole="header" style={{ fontWeight: "700" }}>{baslik}</Metin>
          {altBaslik ? <Metin tur="minik" renk={renk.metinIkincil} numberOfLines={1}>{altBaslik}</Metin> : null}
        </View>
        <View style={{ minWidth: DOKUNMA, alignItems: "flex-end", paddingRight: aralik.xs }}>{sag}</View>
      </View>
      <BaglantiBandi />
    </View>
  );
}

export function Ekran({ baslik, altBaslik, geri, sag, ust, alt, children, yenileniyor, onYenile, kaydir = true, klavye = false, icerikStili }) {
  const kenar = useSafeAreaInsets();
  const govde = kaydir ? (
    <ScrollView
      contentContainerStyle={[{ padding: aralik.m, paddingBottom: (alt ? aralik.m : kenar.bottom + aralik.xxl) }, icerikStili]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      refreshControl={onYenile ? <RefreshControl refreshing={!!yenileniyor} onRefresh={onYenile} tintColor={renk.lacivert} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : <View style={[{ flex: 1 }, icerikStili]}>{children}</View>;

  return (
    <View style={{ flex: 1, backgroundColor: renk.zemin }}>
      {ust || (baslik !== undefined ? <UstBaslik baslik={baslik} altBaslik={altBaslik} geri={geri} sag={sag} /> : null)}
      {klavye ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          {govde}
          {alt ? <AltCubuk>{alt}</AltCubuk> : null}
        </KeyboardAvoidingView>
      ) : (
        <>
          {govde}
          {alt ? <AltCubuk>{alt}</AltCubuk> : null}
        </>
      )}
    </View>
  );
}

// Ekranın altına sabit eylem çubuğu (ör. "Onaya gönder")
export function AltCubuk({ children }) {
  const alt = useSafeAreaInsets().bottom;
  return (
    <View style={{ backgroundColor: renk.yuzey, borderTopWidth: 0.5, borderTopColor: renk.cizgi, paddingHorizontal: aralik.m, paddingTop: aralik.s, paddingBottom: Math.max(alt, aralik.s) }}>
      {children}
    </View>
  );
}
