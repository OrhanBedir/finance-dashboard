import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function HomeScreen({ user, onLogout, navigation }) {
  const handleLogout = async () => {
    Alert.alert("Çıkış", "Çıkış yapmak istediğinize emin misiniz?", [
      { text: "İptal", style: "cancel" },
      {
        text: "Çıkış Yap",
        style: "destructive",
        onPress: async () => {
          await AsyncStorage.removeItem("token");
          await AsyncStorage.removeItem("user");
          onLogout();
        },
      },
    ]);
  };

  const initial = (user?.name || "?").charAt(0).toUpperCase();

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>ERC Operasyon</Text>
          <Text style={styles.headerSub}>Hakediş Takip</Text>
        </View>
        <TouchableOpacity style={styles.avatarBtn} onPress={handleLogout}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* Karşılama */}
        <View style={styles.welcome}>
          <Text style={styles.welcomeHi}>Merhaba, {user?.name?.split(" ")[0] || "Kullanıcı"} 👋</Text>
          <Text style={styles.welcomeSub}>Ne yapmak istersiniz?</Text>
        </View>

        {/* Butonlar */}
        <View style={styles.grid}>
          <TouchableOpacity
            style={[styles.card, styles.cardBlue]}
            onPress={() => navigation.navigate("IsAvans")}
            activeOpacity={0.85}
          >
            <Text style={styles.cardIcon}>💰</Text>
            <Text style={styles.cardTitle}>İş Avans Talebi</Text>
            <Text style={styles.cardDesc}>Yeni iş avansı talep formu oluşturun</Text>
            <View style={styles.cardArrow}>
              <Text style={styles.cardArrowText}>→</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.card, styles.cardGreen]}
            onPress={() => navigation.navigate("MasrafForm")}
            activeOpacity={0.85}
          >
            <Text style={styles.cardIcon}>🧾</Text>
            <Text style={styles.cardTitle}>Masraf Formu</Text>
            <Text style={styles.cardDesc}>Harcama belgesi ve masraf girişi yapın</Text>
            <View style={styles.cardArrow}>
              <Text style={styles.cardArrowText}>→</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Bilgi */}
        <View style={styles.infoBox}>
          <Text style={styles.infoIcon}>ℹ️</Text>
          <Text style={styles.infoText}>
            Formlarınız kaydedildiğinde ilgili onay süreçleri otomatik başlar.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F0F4FF" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1D4ED8",
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingTop: 20,
  },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  headerSub: { color: "#BFDBFE", fontSize: 12, marginTop: 2 },
  avatarBtn: { padding: 4 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#ffffff30",
    borderWidth: 2,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontWeight: "700", fontSize: 16 },

  body: { padding: 20, paddingBottom: 40 },

  welcome: { marginBottom: 24 },
  welcomeHi: { fontSize: 22, fontWeight: "800", color: "#111827" },
  welcomeSub: { fontSize: 14, color: "#6B7280", marginTop: 4 },

  grid: { gap: 16 },

  card: {
    borderRadius: 16,
    padding: 22,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
    marginBottom: 16,
    position: "relative",
  },
  cardBlue: { backgroundColor: "#1D4ED8" },
  cardGreen: { backgroundColor: "#059669" },
  cardIcon: { fontSize: 36, marginBottom: 10 },
  cardTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#fff",
    marginBottom: 6,
  },
  cardDesc: {
    fontSize: 13,
    color: "#ffffff99",
    lineHeight: 19,
    marginBottom: 16,
  },
  cardArrow: {
    alignSelf: "flex-end",
    backgroundColor: "#ffffff25",
    borderRadius: 20,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  cardArrowText: { color: "#fff", fontSize: 18, fontWeight: "700" },

  infoBox: {
    flexDirection: "row",
    backgroundColor: "#EFF6FF",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 4,
  },
  infoIcon: { fontSize: 18, marginTop: 1 },
  infoText: { flex: 1, fontSize: 13, color: "#1E40AF", lineHeight: 19 },
});
