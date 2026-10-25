// Beklenmeyen ekran hatasında uygulama kapanmaz; kullanıcıya sade mesaj ve "Ana sayfaya dön" gösterilir.
import React from "react";
import { View } from "react-native";
import { aralik, renk } from "../tema";
import { Buton, Metin } from "./temel";

export class HataSiniri extends React.Component {
  constructor(p) { super(p); this.state = { hata: null, anahtar: 0 }; }
  static getDerivedStateFromError(hata) { return { hata }; }
  componentDidCatch(hata) { if (__DEV__) console.warn("[omnix] ekran hatası", hata?.message); }
  render() {
    if (!this.state.hata) return <React.Fragment key={this.state.anahtar}>{this.props.children}</React.Fragment>;
    return (
      <View style={{ flex: 1, backgroundColor: renk.zemin, alignItems: "center", justifyContent: "center", padding: aralik.xl }}>
        <Metin tur="baslikM" style={{ textAlign: "center", fontWeight: "700" }}>Bu ekran açılamadı</Metin>
        <Metin tur="kucuk" renk={renk.metinIkincil} style={{ textAlign: "center", marginTop: aralik.xs }}>
          Telefondaki taslaklarınız korunuyor. Ana sayfaya dönüp tekrar deneyin.
        </Metin>
        <Buton baslik="Ana sayfaya dön" onPress={() => this.setState((s) => ({ hata: null, anahtar: s.anahtar + 1 }))} style={{ marginTop: aralik.l, minWidth: 220 }} />
      </View>
    );
  }
}
