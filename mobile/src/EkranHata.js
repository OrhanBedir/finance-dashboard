import React from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";

/* 08.09.2026: Sahadaki personel bir ekranda siyah ekran görüyordu ve
   hatanın ne olduğu uzaktan anlaşılamıyordu. Üretim derlemesinde render
   hatası ekranı boş bırakır; bu sarmalayıcı hatayı yakalayıp mesajı ve
   ekran adını gösterir, "Geri dön" ile ana ekrana dönülür. */
export const UYGULAMA_SURUM = String(require("../app.json").expo.android.versionCode || "");

export default class EkranHata extends React.Component {
  constructor(props) { super(props); this.state = { hata: null }; }
  static getDerivedStateFromError(hata) { return { hata }; }
  componentDidCatch(hata, bilgi) {
    try { console.error("[EkranHata]", this.props.ekran, hata?.message, bilgi?.componentStack); } catch (_) {}
  }
  render() {
    if (!this.state.hata) return this.props.children;
    const h = this.state.hata;
    const nav = this.props.navigation;
    return (
      <View style={{ flex: 1, backgroundColor: "#fff7ed", padding: 24, paddingTop: 60 }}>
        <Text style={{ fontSize: 20, fontWeight: "800", color: "#9a3412" }}>Ekran açılamadı</Text>
        <Text style={{ marginTop: 6, color: "#7c2d12" }}>
          {this.props.ekran ? `${this.props.ekran} · ` : ""}v{UYGULAMA_SURUM}
        </Text>
        <ScrollView style={{ marginTop: 14, maxHeight: 220, backgroundColor: "#fff", borderRadius: 10, padding: 12 }}>
          <Text selectable style={{ fontSize: 12, color: "#111827" }}>{String(h?.message || h)}</Text>
          {h?.stack ? <Text selectable style={{ fontSize: 10, color: "#6b7280", marginTop: 8 }}>{String(h.stack).slice(0, 800)}</Text> : null}
        </ScrollView>
        <Text style={{ marginTop: 12, color: "#7c2d12", fontSize: 13 }}>
          Bu ekranın görüntüsünü ofise iletin. Uygulamanın güncel sürümü yüklü değilse app.omnix.global/mobil adresinden indirin.
        </Text>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
          <TouchableOpacity onPress={() => this.setState({ hata: null })}
            style={{ flex: 1, backgroundColor: "#fed7aa", borderRadius: 10, paddingVertical: 12, alignItems: "center" }}>
            <Text style={{ fontWeight: "800", color: "#9a3412" }}>Tekrar dene</Text>
          </TouchableOpacity>
          {nav ? (
            <TouchableOpacity onPress={() => { this.setState({ hata: null }); try { nav.canGoBack() ? nav.goBack() : nav.navigate("Home"); } catch (_) {} }}
              style={{ flex: 1, backgroundColor: "#1E3A5F", borderRadius: 10, paddingVertical: 12, alignItems: "center" }}>
              <Text style={{ fontWeight: "800", color: "#fff" }}>Geri dön</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }
}
