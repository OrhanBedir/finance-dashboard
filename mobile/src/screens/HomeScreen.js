import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiGet } from "../api";

function fmtTL(val) {
  try {
    const n = Math.round(Number(val) || 0);
    const s = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return s + " ₺";
  } catch (_) {
    return "0 ₺";
  }
}

function fmtDate(d) {
  try {
    if (!d) return "";
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "";
    const g = String(dt.getDate()).padStart(2, "0");
    const aylar = ["Oca","Sub","Mar","Nis","May","Haz","Tem","Agu","Eyl","Eki","Kas","Ara"];
    return g + " " + (aylar[dt.getMonth()] || "") + " " + dt.getFullYear();
  } catch (_) {
    return "";
  }
}

const DURUM_MAP = {
  TASLAK:     { label: "Taslak",      bg: "#F3F4F6", fg: "#6B7280" },
  PM_BEKLE:   { label: "PM Onayinda", bg: "#FEF3C7", fg: "#92400E" },
  ONAYLANDI:  { label: "Onaylandi",   bg: "#D1FAE5", fg: "#065F46" },
  REDDEDILDI: { label: "Reddedildi",  bg: "#FEE2E2", fg: "#991B1B" },
  ODENDI:     { label: "Odendi",      bg: "#DBEAFE", fg: "#1E40AF" },
  TAMAMLANDI: { label: "Tamamlandi",  bg: "#DBEAFE", fg: "#1E40AF" },
  GONDERILDI: { label: "Gonderildi",  bg: "#FEF3C7", fg: "#92400E" },
  BEKLEMEDE:  { label: "Beklemede",   bg: "#FEF3C7", fg: "#92400E" },
};

function getBadge(durum) {
  return DURUM_MAP[durum] || { label: durum || "?", bg: "#F3F4F6", fg: "#6B7280" };
}

export default function HomeScreen({ user, onLogout, navigation }) {
  const [avanslar, setAvanslar] = useState([]);
  const [masraflar, setMasraflar] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async (isRefresh) => {
    try {
      if (isRefresh) setRefreshing(true);
      const email = encodeURIComponent(String(user && user.email ? user.email : "").toLowerCase().trim());
      const name  = encodeURIComponent(String(user && user.name  ? user.name  : "").trim());
      const data  = await apiGet("/hr/mobile-dashboard?email=" + email + "&name=" + name);
      if (data && typeof data === "object" && !data.error) {
        if (Array.isArray(data.avanslar))  setAvanslar(data.avanslar);
        if (Array.isArray(data.masraflar)) setMasraflar(data.masraflar);
      }
    } catch (err) {
      // sessizce devam et
    }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    fetchData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = () => {
    Alert.alert("Cikis", "Cikis yapmak istiyor musunuz?", [
      { text: "Iptal", style: "cancel" },
      {
        text: "Cikis Yap",
        style: "destructive",
        onPress: async () => {
          try {
            await AsyncStorage.multiRemove(["token", "user"]);
          } catch (_) {}
          onLogout();
        },
      },
    ]);
  };

  const initial = user && user.name ? String(user.name).charAt(0).toUpperCase() : "?";
  const firstName = user && user.name ? String(user.name).split(" ")[0] : "Kullanici";

  // Stats
  const pendingAvans = avanslar.reduce((s, a) => {
    try {
      if (!["TAMAMLANDI","REDDEDILDI","ODENDI"].includes(a.durum)) {
        return s + (Number(a.tutar) || 0);
      }
    } catch (_) {}
    return s;
  }, 0);

  const pendingMasraf = masraflar.reduce((s, m) => {
    try {
      if (!["TAMAMLANDI","ODENDI","REDDEDILDI"].includes(m.durum)) {
        return s + (Number(m.toplam_tutar || m.tutar) || 0);
      }
    } catch (_) {}
    return s;
  }, 0);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <View>
            <Text style={styles.htitle}>ERC Operasyon</Text>
            <Text style={styles.hsub}>Hakedis Takip</Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarTxt}>{initial}</Text>
          </View>
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1D4ED8" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View>
          <Text style={styles.htitle}>ERC Operasyon</Text>
          <Text style={styles.hsub}>Hakedis Takip</Text>
        </View>
        <TouchableOpacity onPress={handleLogout}>
          <View style={styles.avatar}>
            <Text style={styles.avatarTxt}>{initial}</Text>
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchData(true)}
            tintColor="#1D4ED8"
          />
        }
      >
        {/* Karsilama */}
        <Text style={styles.hi}>Merhaba, {firstName} 👋</Text>
        <Text style={styles.hiSub}>{user && user.role ? String(user.role) : "Personel"}</Text>

        {/* Stat Kartlari */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, styles.statBlue]}>
            <Text style={styles.statIcon}>💰</Text>
            <Text style={[styles.statVal, { color: "#1D4ED8" }]}>{fmtTL(pendingAvans)}</Text>
            <Text style={styles.statLabel}>Bekleyen Is Avansi</Text>
          </View>
          <View style={[styles.statCard, styles.statGreen]}>
            <Text style={styles.statIcon}>🧾</Text>
            <Text style={[styles.statVal, { color: "#059669" }]}>{fmtTL(pendingMasraf)}</Text>
            <Text style={styles.statLabel}>Bekleyen Masraf</Text>
          </View>
        </View>

        {/* Butonlar */}
        <Text style={styles.secTitle}>Hizli Islemler</Text>
        <View style={styles.btnGrid}>
          <TouchableOpacity
            style={[styles.actionBtn, { borderTopColor: "#1D4ED8" }]}
            onPress={() => navigation.navigate("IsAvans")}
            activeOpacity={0.8}
          >
            <Text style={styles.btnIcon}>💰</Text>
            <Text style={[styles.btnLabel, { color: "#1D4ED8" }]}>Is Avansi</Text>
            <Text style={styles.btnDesc}>Yeni talep olustur</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { borderTopColor: "#059669" }]}
            onPress={() => navigation.navigate("MasrafForm")}
            activeOpacity={0.8}
          >
            <Text style={styles.btnIcon}>🧾</Text>
            <Text style={[styles.btnLabel, { color: "#059669" }]}>Masraf Formu</Text>
            <Text style={styles.btnDesc}>Harcama girisi yap</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { borderTopColor: "#7C3AED" }]}
            onPress={() => Alert.alert("Yakinда", "Malzeme modulu yakinда aktif olacak.")}
            activeOpacity={0.8}
          >
            <Text style={styles.btnIcon}>📦</Text>
            <Text style={[styles.btnLabel, { color: "#7C3AED" }]}>Malzeme Talebi</Text>
            <Text style={styles.btnDesc}>Malzeme talep et</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { borderTopColor: "#D97706" }]}
            onPress={() => Alert.alert("Yakinда", "Bu ozellik yakinда aktif olacak.")}
            activeOpacity={0.8}
          >
            <Text style={styles.btnIcon}>🏗️</Text>
            <Text style={[styles.btnLabel, { color: "#D97706" }]}>Uzerimdeki</Text>
            <Text style={styles.btnDesc}>Malzemelerimi gor</Text>
          </TouchableOpacity>
        </View>

        {/* Is Avanslari */}
        <Text style={styles.secTitle}>Is Avanslаrim ({avanslar.length})</Text>
        {avanslar.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTxt}>Henuz is avansi talebiniz yok.</Text>
          </View>
        ) : (
          avanslar.slice(0, 5).map((a, idx) => {
            try {
              const b = getBadge(a.durum);
              return (
                <View key={a.id || idx} style={styles.card}>
                  <View style={styles.cardRow}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {String(a.proje || a.proje_kodu || a.gider_turu || "-")}
                    </Text>
                    <View style={[styles.badge, { backgroundColor: b.bg }]}>
                      <Text style={[styles.badgeTxt, { color: b.fg }]}>{b.label}</Text>
                    </View>
                  </View>
                  <View style={styles.cardRow}>
                    <Text style={styles.cardAmt}>{fmtTL(a.tutar)}</Text>
                    <Text style={styles.cardDate}>{fmtDate(a.created_at)}</Text>
                  </View>
                </View>
              );
            } catch (_) { return null; }
          })
        )}

        {/* Masraf Formlari */}
        <Text style={[styles.secTitle, { marginTop: 8 }]}>Masraf Formlarim ({masraflar.length})</Text>
        {masraflar.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTxt}>Henuz masraf formunuz yok.</Text>
          </View>
        ) : (
          masraflar.slice(0, 5).map((m, idx) => {
            try {
              const b = getBadge(m.durum);
              return (
                <View key={m.id || idx} style={styles.card}>
                  <View style={styles.cardRow}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {String(m.form_no || m.donem || "Masraf Formu")}
                    </Text>
                    <View style={[styles.badge, { backgroundColor: b.bg }]}>
                      <Text style={[styles.badgeTxt, { color: b.fg }]}>{b.label}</Text>
                    </View>
                  </View>
                  <View style={styles.cardRow}>
                    <Text style={styles.cardAmt}>{fmtTL(m.toplam_tutar || m.tutar)}</Text>
                    <Text style={styles.cardDate}>{fmtDate(m.created_at)}</Text>
                  </View>
                </View>
              );
            } catch (_) { return null; }
          })
        )}

        {/* Cikis */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutTxt}>🚪  Cikis Yap</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: "#F0F4FF" },
  center:     { flex: 1, justifyContent: "center", alignItems: "center" },
  header:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                backgroundColor: "#1D4ED8", paddingHorizontal: 20, paddingVertical: 16, paddingTop: 20 },
  htitle:     { color: "#fff", fontSize: 18, fontWeight: "800" },
  hsub:       { color: "#BFDBFE", fontSize: 12, marginTop: 2 },
  avatar:     { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.2)",
                borderWidth: 2, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  avatarTxt:  { color: "#fff", fontWeight: "700", fontSize: 16 },

  body:       { padding: 16, paddingBottom: 48 },
  hi:         { fontSize: 22, fontWeight: "800", color: "#111827", marginTop: 4 },
  hiSub:      { fontSize: 13, color: "#6B7280", marginTop: 3, marginBottom: 16 },

  statsRow:   { flexDirection: "row", marginBottom: 20 },
  statCard:   { flex: 1, borderRadius: 14, borderWidth: 1, padding: 14, alignItems: "center",
                marginHorizontal: 4,
                shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.06, shadowRadius: 6, elevation: 3 },
  statBlue:   { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" },
  statGreen:  { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" },
  statIcon:   { fontSize: 24, marginBottom: 6 },
  statVal:    { fontSize: 15, fontWeight: "800", marginBottom: 3, textAlign: "center" },
  statLabel:  { fontSize: 11, color: "#6B7280", textAlign: "center" },

  secTitle:   { fontSize: 16, fontWeight: "800", color: "#111827", marginBottom: 10 },

  btnGrid:    { flexDirection: "row", flexWrap: "wrap", marginBottom: 24, marginHorizontal: -5 },
  actionBtn:  { width: "48%", backgroundColor: "#fff", borderRadius: 14, padding: 14,
                borderTopWidth: 3, marginHorizontal: "1%", marginBottom: 10,
                shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.07, shadowRadius: 6, elevation: 3 },
  btnIcon:    { fontSize: 26, marginBottom: 8 },
  btnLabel:   { fontSize: 14, fontWeight: "800", marginBottom: 3 },
  btnDesc:    { fontSize: 11, color: "#9CA3AF" },

  card:       { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10,
                shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  cardRow:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  cardTitle:  { fontSize: 14, fontWeight: "700", color: "#111827", flex: 1, marginRight: 8 },
  cardAmt:    { fontSize: 15, fontWeight: "800", color: "#1D4ED8" },
  cardDate:   { fontSize: 12, color: "#9CA3AF" },

  badge:      { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  badgeTxt:   { fontSize: 11, fontWeight: "700" },

  emptyBox:   { backgroundColor: "#fff", borderRadius: 12, padding: 20, alignItems: "center",
                marginBottom: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  emptyTxt:   { fontSize: 13, color: "#9CA3AF" },

  logoutBtn:  { marginTop: 24, backgroundColor: "#FEE2E2", borderRadius: 12,
                paddingVertical: 14, alignItems: "center",
                borderWidth: 1, borderColor: "#FECACA" },
  logoutTxt:  { fontSize: 15, fontWeight: "700", color: "#DC2626" },
});
