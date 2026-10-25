// Omnix logosu (web'deki omnix-logo.svg ile aynı çizim) ve giriş sonrası firma kimliği.
import React from "react";
import { Image, View } from "react-native";
import Svg, { G, Path } from "react-native-svg";
import { aralik, kose, renk } from "../tema";
import { Metin } from "./temel";
import { basHarfler } from "../mantik/bicim";
import { TEST_ISARETI } from "../config/ortam";

export function OmnixLogo({ boyut = 48, acik = false }) {
  const cizgi = acik ? "#FFFFFF" : renk.lacivert;
  const dolgu = acik ? renk.altinAcik : renk.altin;
  return (
    <Svg width={boyut} height={boyut} viewBox="0 0 48 48" accessibilityLabel="Omnix">
      <G fill="none" stroke={cizgi} strokeWidth={2.1} strokeLinejoin="round">
        <Path d="M14.91 5.62 L24 10.88 L24 21.38 L14.91 26.62 L5.81 21.38 L5.81 10.88 Z" />
        <Path d="M33.09 5.62 L42.19 10.88 L42.19 21.38 L33.09 26.62 L24 21.38 L24 10.88 Z" />
      </G>
      <Path d="M24 21.38 L33.09 26.62 L33.09 37.12 L24 42.38 L14.91 37.12 L14.91 26.62 Z" fill={dolgu} />
    </Svg>
  );
}

export function OmnixYazi({ acik = false, boyut = 28 }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <OmnixLogo boyut={boyut * 1.3} acik={acik} />
      <Metin style={{ fontSize: boyut, lineHeight: boyut * 1.2, fontWeight: "800", letterSpacing: -0.6, marginLeft: 8 }} renk={acik ? "#FFFFFF" : renk.lacivert}>Omnix</Metin>
      {TEST_ISARETI ? (
        <View style={{ marginLeft: 8, backgroundColor: renk.altin, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
          <Metin tur="minik" renk="#1F1403" style={{ fontWeight: "800" }}>TEST</Metin>
        </View>
      ) : null}
    </View>
  );
}

// Firma logosu: backend logo adresi verirse görsel, vermezse firma adının baş harfleriyle marka kutusu
export function FirmaLogosu({ firma, boyut = 44 }) {
  if (firma?.logo) {
    return <Image source={{ uri: firma.logo }} style={{ width: boyut, height: boyut, borderRadius: kose.m }} accessibilityLabel={`${firma.ad} logosu`} />;
  }
  return (
    <View style={{ width: boyut, height: boyut, borderRadius: kose.m, backgroundColor: renk.altin, alignItems: "center", justifyContent: "center" }}
      accessibilityLabel={`${firma?.ad || ""} logosu`}>
      <Metin style={{ fontSize: boyut * 0.38, fontWeight: "800", color: "#1F1403" }} maxFontSizeMultiplier={1}>{basHarfler(firma?.ad)}</Metin>
    </View>
  );
}

// "Teknocenter / Hakediş & Operasyon Takip · Omnix Platformu"
export function FirmaBasligi({ firma, acik = true, alt = "Hakediş & Operasyon Takip · Omnix Platformu" }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flex: 1, minWidth: 0 }}>
      <FirmaLogosu firma={firma} />
      <View style={{ marginLeft: aralik.s, flex: 1, minWidth: 0 }}>
        <Metin tur="baslikM" renk={acik ? "#FFFFFF" : renk.metin} numberOfLines={1} style={{ fontWeight: "700" }}>{firma?.ad}</Metin>
        <Metin tur="minik" renk={acik ? "#C7D3E3" : renk.metinIkincil} numberOfLines={1}>{alt}</Metin>
      </View>
    </View>
  );
}
