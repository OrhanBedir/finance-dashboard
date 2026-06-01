import React, { useState, useEffect, useCallback } from "react";
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

const STATUS_COLORS = {
  TASLAK:    { bg: "#F3F4F6", text: "#6B7280", label: "Taslak" },
  PM_BEKLE:  { bg: "#FEF3C7", text: "#92400E", label: "PM Onayında" },
  ONAYLANDI: { bg: "#D1FAE5", text: "#065F46", label: "Onaylandı" },
  REDDEDILDI:{ bg: "#FEE2E2", text: "#991B1B", label: "Reddedildi" },
  ODENDI:    { bg: "#DBEAFE", text: "#1E40AF", label: "Ödendi" },
  GONDERILDI:{ bg: "#FEF3C7", text: "#92400E", label: "Gönderildi" },
  BEKLEMEDE: { bg: "#FEF3C7", text: "#92400E", label: "Beklemede" },
};

function statusStyle(s) {
  return STATUS_COLORS[s] || { bg: "#F3F4F6", text: "#6B7280", label: s };
}

function fmtTL(val) {
  const n = Number(val) || 0;
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";
}

function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function HomeScreen({ user, onLogout, navigation }) {
  const [avanslar, setAvanslar]     = useState([]);
  const [masraflar, setMasraflar]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [av, ma] = await Promise.all([
        apiGet("/hr/is-avans"),
        apiGet("/hr/masraf"),
      ]);
      setAvanslar(Array.isArray(av) ? av : []);
      setMasraflar(Array.isArray(ma) ? ma : []);
    } catch (_) {}
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleLogout = () => {
    Alert.alert("Çıkış", "Çıkış yapmak istediğinize emin misiniz?", [
      { text: "İptal", style: "cancel" },
      {
        text: "Çıkış Yap",
        style: "destructive",
        onPress: async () => {
          await AsyncStorage.multiRemove(["token", "user"]);
          onLogout();
        },
      },
    ]);
  };

  // --- Stats ---
  const myEmail = user?.email?.toLowerCase() || "";
  const myAvanslar   = avanslar.filter(a => (a.talep_eden_email || "").toLowerCase() === myEmail);
  const myMasraflar  = masraflar.filter(m => (m.talep_eden_email || "").toLowerCase() === myEmail);

  const pendingAvans = myAvanslar
    .filter(a => !["ODENDI", "REDDEDILDI"].includes(a.durum))
    .reduce((s, a) => s + (Number(a.tutar) || 0), 0);

  const pendingMasraf = myMasraflar
    .filter(m => !["ODENDI", "REDDEDILDI"].includes(m.durum))
    .reduce((s, m) => s + (Number(m.toplam_tutar || m.tutar) || 0), 0);

  const recentAvanslar  = [...myAvanslar].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
  const recentMasraflar = [...myMasraflar].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);

  const initial = (user?.name || "?").charAt(0).toUpperCase();
  const isAdmin = ["admin", "muhasebe"].includes(user?.role?.toLowerCase());

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>ERC Operasyon</Text>
            <Text style={styles.headerSub}>Hakediş Takip</Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
        </View>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color="#1D4ED8" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>ERC Operasyon</Text>
          <Text style={styles.headerSub}>Hakediş Takip</Text>
        </View>
        <TouchableOpacity onPress={handleLogout} activeOpacity={0.8}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchData(true)} tintColor="#1D4ED8" />}
      >
        {/* Karşılama */}
        <View style={styles.welcomeRow}>
          <View>
            <Text style={styles.welcomeHi}>Merhaba, {user?.name?.split(" ")[0] || "Kullanıcı"} 👋</Text>
            <Text style={styles.welcomeSub}>{user?.role || "Personel"}</Text>
          </View>
        </View>

        {/* Stat Kartları */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" }]}>
            <Text style={styles.statIcon}>💰</Text>
            <Text style={[styles.statVal, { color: "#1D4ED8" }]}>{fmtTL(pendingAvans)}</Text>
            <Text style={styles.statLabel}>Bekleyen İş Avansı</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" }]}>
            <Text style={styles.statIcon}>🧾</Text>
            <Text style={[styles.statVal, { color: "#059669" }]}>{fmtTL(pendingMasraf)}</Text>
            <Text style={styles.statLabel}>Bekleyen Masraf</Text>
          </View>
        </View>

        {/* Hızlı İşlemler */}
        <Text style={styles.sectionTitle}>Hızlı İşlemler</Text>
        <View style={styles.actionGrid}>
          <ActionBtn
            icon="💰"
            label="İş Avansı"
            desc="Yeni talep oluştur"
            color="#1D4ED8"
            onPress={() => navigation.navigate("IsAvans")}
          />
          <ActionBtn
            icon="🧾"
            label="Masraf Formu"
            desc="Harcama girişi yap"
            color="#059669"
            onPress={() => navigation.navigate("MasrafForm")}
          />
          <ActionBtn
            icon="📦"
            label="Malzeme Talebi"
            desc="Malzeme talep et"
            color="#7C3AED"
            onPress={() => Alert.alert("Yakında", "Malzeme modülü yakında aktif olacak.")}
          />
          <ActionBtn
            icon="🏗️"
            label="Üzerimdeki"
            desc="Malzemelerimi gör"
            color="#D97706"
            onPress={() => Alert.alert("Yakında", "Bu özellik yakında aktif olacak.")}
          />
        </View>

        {/* İş Avanslarım */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>İş Avanslarım</Text>
          <Text style={styles.sectionCount}>{myAvanslar.length} kayıt</Text>
        </View>

        {recentAvanslar.length === 0 ? (
          <EmptyCard text="Henüz iş avansı talebiniz yok." />
        ) : (
          recentAvanslar.map((a) => {
            const st = statusStyle(a.durum);
            return (
              <View key={a.id} style={styles.listCard}>
                <View style={styles.listCardTop}>
                  <Text style={styles.listCardTitle} numberOfLines={1}>{a.proje_kodu || "—"}</Text>
                  <View style={[styles.badge, { backgroundColor: st.bg }]}>
                    <Text style={[styles.badgeText, { color: st.text }]}>{st.label}</Text>
                  </View>
                </View>
                <View style={styles.listCardRow}>
                  <Text style={styles.listCardAmount}>{fmtTL(a.tutar)}</Text>
                  <Text style={styles.listCardDate}>{fmtDate(a.created_at)}</Text>
                </View>
                {!!a.aciklama && (
                  <Text style={styles.listCardDesc} numberOfLines={1}>{a.aciklama}</Text>
                )}
              </View>
            );
          })
        )}

        {/* Masraf Formlarım */}
        <View style={[styles.sectionHeader, { marginTop: 8 }]}>
          <Text style={styles.sectionTitle}>Masraf Formlarım</Text>
          <Text style={styles.sectionCount}>{myMasraflar.length} kayıt</Text>
        </View>

        {recentMasraflar.length === 0 ? (
          <EmptyCard text="Henüz masraf formunuz yok." />
        ) : (
          recentMasraflar.map((m) => {
            const st = statusStyle(m.durum);
            return (
              <View key={m.id} style={styles.listCard}>
                <View style={styles.listCardTop}>
                  <Text style={styles.listCardTitle} numberOfLines={1}>{m.proje_kodu || m.aciklama || "Masraf Formu"}</Text>
                  <View style={[styles.badge, { backgroundColor: st.bg }]}>
                    <Text style={[styles.badgeText, { color: st.text }]}>{st.label}</Text>
                  </View>
                </View>
                <View style={styles.listCardRow}>
                  <Text style={styles.listCardAmount}>{fmtTL(m.toplam_tutar || m.tutar)}</Text>
                  <Text style={styles.listCardDate}>{fmtDate(m.created_at)}</Text>
                </View>
              </View>
            );
          })
        )}

        {/* Çıkış */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutText}>🚪  Çıkış Yap</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionBtn({ icon, label, desc, color, onPress }) {
  return (
    <TouchableOpacity style={[styles.actionBtn, { borderTopColor: color, borderTopWidth: 3 }]} onPress={onPress} activeOpacity={0.85}>
      <Text style={styles.actionIcon}>{icon}</Text>
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
      <Text style={styles.actionDesc}>{desc}</Text>
    </TouchableOpacity>
  );
}

function EmptyCard({ text }) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
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
  headerSub:   { color: "#BFDBFE", fontSize: 12, marginTop: 2 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#ffffff30",
    borderWidth: 2,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontWeight: "700", fontSize: 16 },

  body: { padding: 16, paddingBottom: 48 },

  welcomeRow: { marginBottom: 16 },
  welcomeHi:  { fontSize: 22, fontWeight: "800", color: "#111827" },
  welcomeSub: { fontSize: 13, color: "#6B7280", marginTop: 3 },

  statsRow: { flexDirection: "row", gap: 12, marginBottom: 20 },
  statCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
  },
  statIcon:  { fontSize: 24, marginBottom: 6 },
  statVal:   { fontSize: 15, fontWeight: "800", marginBottom: 3, textAlign: "center" },
  statLabel: { fontSize: 11, color: "#6B7280", textAlign: "center" },

  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle:  { fontSize: 16, fontWeight: "800", color: "#111827", marginBottom: 10 },
  sectionCount:  { fontSize: 12, color: "#9CA3AF", marginBottom: 10 },

  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 24,
  },
  actionBtn: {
    width: "47.5%",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 3,
  },
  actionIcon:  { fontSize: 26, marginBottom: 8 },
  actionLabel: { fontSize: 14, fontWeight: "800", marginBottom: 3 },
  actionDesc:  { fontSize: 11, color: "#9CA3AF" },

  listCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  listCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  listCardTitle: { fontSize: 14, fontWeight: "700", color: "#111827", flex: 1, marginRight: 8 },
  listCardRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  listCardAmount:{ fontSize: 15, fontWeight: "800", color: "#1D4ED8" },
  listCardDate:  { fontSize: 12, color: "#9CA3AF" },
  listCardDesc:  { fontSize: 12, color: "#6B7280", marginTop: 6 },

  badge: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 11, fontWeight: "700" },

  emptyCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderStyle: "dashed",
  },
  emptyText: { fontSize: 13, color: "#9CA3AF" },

  logoutBtn: {
    marginTop: 24,
    backgroundColor: "#FEE2E2",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  logoutText: { fontSize: 15, fontWeight: "700", color: "#DC2626" },
});
