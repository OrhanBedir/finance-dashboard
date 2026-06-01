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

function fmtTLDecimal(val) {
  try {
    const n = Number(val) || 0;
    const parts = n.toFixed(2).split(".");
    const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return intPart + "," + parts[1] + " ₺";
  } catch (_) {
    return "0,00 ₺";
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

const AYLAR = ["Ocak","Subat","Mart","Nisan","Mayis","Haziran","Temmuz","Agustos","Eylul","Ekim","Kasim","Aralik"];

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
  const [avanslar, setAvanslar]         = useState([]);
  const [masraflar, setMasraflar]       = useState([]);
  const [puantaj, setPuantaj]           = useState(null);
  const [cezaKalemler, setCezaKalemler] = useState([]);
  const [avansKalan, setAvansKalan]     = useState(0);
  const [bekleyenMasrafTutar, setBekleyenMasrafTutar] = useState(0);
  const [personelUnvan, setPersonelUnvan] = useState("");
  const [ayYil, setAyYil]               = useState({ ay: 0, yil: 0 });
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);

  const fetchData = async (isRefresh) => {
    try {
      if (isRefresh) setRefreshing(true);
      const email = encodeURIComponent(String(user && user.email ? user.email : "").toLowerCase().trim());
      const name  = encodeURIComponent(String(user && user.name  ? user.name  : "").trim());
      const data  = await apiGet("/hr/mobile-dashboard?email=" + email + "&name=" + name);
      if (data && typeof data === "object" && !data.error) {
        if (Array.isArray(data.avanslar))      setAvanslar(data.avanslar);
        if (Array.isArray(data.masraflar))     setMasraflar(data.masraflar);
        if (data.puantaj)                      setPuantaj(data.puantaj);
        if (Array.isArray(data.cezaKalemler)) setCezaKalemler(data.cezaKalemler);
        if (typeof data.avansKalan === "number")          setAvansKalan(data.avansKalan);
        if (typeof data.bekleyenMasrafTutar === "number") setBekleyenMasrafTutar(data.bekleyenMasrafTutar);
        if (data.personel && data.personel.unvan)         setPersonelUnvan(data.personel.unvan);
        if (data.ay && data.yil) setAyYil({ ay: data.ay, yil: data.yil });
      }
    } catch (_) {}
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
          try { await AsyncStorage.multiRemove(["token", "user"]); } catch (_) {}
          onLogout();
        },
      },
    ]);
  };

  const initial   = user && user.name ? String(user.name).charAt(0).toUpperCase() : "?";
  const firstName = user && user.name ? String(user.name).split(" ")[0] : "Kullanici";
  const fullName  = user && user.name ? String(user.name) : "Kullanici";
  const roleLabel = personelUnvan || (user && user.role ? String(user.role) : "Personel");

  // Badge counts
  const pendingMasrafCount = masraflar.filter(m => {
    try { return !["TAMAMLANDI","ODENDI","REDDEDILDI"].includes(m.durum); } catch (_) { return false; }
  }).length;

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <View>
            <Text style={styles.htitle}>ERC Operasyon</Text>
            <Text style={styles.hsub}>Hakedis Takip</Text>
          </View>
          <View style={styles.avatar}><Text style={styles.avatarTxt}>{initial}</Text></View>
        </View>
        <View style={styles.center}><ActivityIndicator size="large" color="#1D4ED8" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* HEADER */}
      <View style={styles.header}>
        <View>
          <Text style={styles.htitle}>ERC Operasyon</Text>
          <Text style={styles.hsub}>Hakedis Takip</Text>
        </View>
        <TouchableOpacity onPress={handleLogout}>
          <View style={styles.avatar}><Text style={styles.avatarTxt}>{initial}</Text></View>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => fetchData(true)} tintColor="#1D4ED8" />
        }
      >
        {/* Karsilama */}
        <Text style={styles.hi}>Hos geldin {"👋"}</Text>
        <Text style={styles.hiName}>{fullName}</Text>
        <Text style={styles.hiRole}>{roleLabel}</Text>

        {/* Ana Stat Kartlar */}
        <View style={styles.bigCard}>
          <Text style={styles.bigCardLabel}>UZERIMDEKI IS AVANSI</Text>
          <Text style={styles.bigCardVal}>{fmtTLDecimal(avansKalan)}</Text>
          <Text style={styles.bigCardSub}>Sirketten alinan pesiN  henuz kapAtilmadi</Text>
        </View>

        <View style={[styles.bigCard, styles.bigCardBlue]}>
          <Text style={[styles.bigCardLabel, { color: "#1E40AF" }]}>ONAY BEKLEYEN MASRAF</Text>
          <Text style={[styles.bigCardVal, { color: "#1D4ED8" }]}>{fmtTLDecimal(bekleyenMasrafTutar)}</Text>
          <Text style={styles.bigCardSub}>
            {masraflar.filter(m => { try { return !["TAMAMLANDI","ODENDI","REDDEDILDI"].includes(m.durum); } catch (_) { return false; } }).length} form muhasebe onayinda
          </Text>
        </View>

        {/* Puantaj Ozeti */}
        {puantaj && (
          <View style={styles.puantajBox}>
            <Text style={styles.puantajTitle}>
              {"📅"} {AYLAR[(ayYil.ay - 1)] || ""} {ayYil.yil} — CALISMA OZETI
            </Text>
            <View style={styles.puantajRow}>
              <View style={styles.puantajCell}>
                <Text style={[styles.puantajNum, { color: "#16A34A" }]}>{puantaj.calisilan || 0}</Text>
                <Text style={styles.puantajLbl}>Calisilan</Text>
              </View>
              <View style={styles.puantajCell}>
                <Text style={[styles.puantajNum, { color: "#2563EB" }]}>{puantaj.dinlenme || 0}</Text>
                <Text style={styles.puantajLbl}>Dinlenme</Text>
              </View>
              <View style={styles.puantajCell}>
                <Text style={[styles.puantajNum, { color: "#DC2626" }]}>{puantaj.gelmedi || 0}</Text>
                <Text style={styles.puantajLbl}>Gelmedi</Text>
              </View>
              <View style={styles.puantajCell}>
                <Text style={[styles.puantajNum, { color: "#7C3AED" }]}>{puantaj.toplam_gun || 0}</Text>
                <Text style={styles.puantajLbl}>Toplam</Text>
              </View>
            </View>
            {(puantaj.fazla_mesai_gun > 0) && (
              <View style={styles.fazlaMesai}>
                <Text style={styles.fazlaMesaiTxt}>
                  {"⏰"} Fazla Mesai   {puantaj.fazla_mesai_gun || 0} gun
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Hizli Islemler */}
        <View style={styles.btnGrid}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnBlue]}
            onPress={() => navigation.navigate("IsAvans")}
            activeOpacity={0.8}
          >
            <Text style={styles.btnIcon}>{"💰"}</Text>
            <Text style={[styles.btnLabel, { color: "#1D4ED8" }]}>Is Avansi</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnDark]}
            onPress={() => navigation.navigate("MasrafForm")}
            activeOpacity={0.8}
          >
            <View>
              <Text style={styles.btnIcon}>{"📋"}</Text>
              {pendingMasrafCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeTxt}>{pendingMasrafCount}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.btnLabel, { color: "#fff" }]}>Masraf Formu</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.wideBtn}
          onPress={() => Alert.alert("Yakin", "Malzeme modulu yakin zamanda aktif olacak.")}
          activeOpacity={0.8}
        >
          <Text style={styles.wideBtnIcon}>{"🔧"}</Text>
          <Text style={styles.wideBtnTxt}>Malzeme Yonetimi</Text>
          <Text style={styles.wideBtnArrow}>{"›"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.wideBtn, { backgroundColor: "#1D4ED8", marginTop: 10 }]}
          onPress={() => Alert.alert("Yakin", "Uzerimdeki malzemeler modulu yakin zamanda aktif olacak.")}
          activeOpacity={0.8}
        >
          <Text style={styles.wideBtnIcon}>{"📦"}</Text>
          <Text style={[styles.wideBtnTxt, { color: "#fff" }]}>Uzerimdeki Malzemeler</Text>
          <Text style={[styles.wideBtnArrow, { color: "#93C5FD" }]}>{"›"}</Text>
        </TouchableOpacity>

        {/* Trafik Cezalari */}
        {cezaKalemler.length > 0 && (
          <View style={styles.cezaBox}>
            <Text style={styles.cezaTitle}>{"🚨"} TRAFIK CEZALARI</Text>
            {cezaKalemler.slice(0, 3).map((c, idx) => {
              try {
                return (
                  <View key={c.id || idx} style={styles.cezaRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cezaPlaka}>{c.plaka || "?"}</Text>
                      <Text style={styles.cezaAciklama} numberOfLines={1}>{c.aciklama || "Trafik cezasi"}</Text>
                      <Text style={styles.cezaTarih}>{fmtDate(c.tarih)}</Text>
                    </View>
                    <Text style={styles.cezaTutar}>{fmtTL(c.tutar)}</Text>
                  </View>
                );
              } catch (_) { return null; }
            })}
          </View>
        )}

        {/* Is Avanslarim */}
        <Text style={styles.secTitle}>Is Avanslarim ({avanslar.length})</Text>
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
                    <View style={[styles.badgePill, { backgroundColor: b.bg }]}>
                      <Text style={[styles.badgePillTxt, { color: b.fg }]}>{b.label}</Text>
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

        {/* Masraf Formlarim */}
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
                    <View style={[styles.badgePill, { backgroundColor: b.bg }]}>
                      <Text style={[styles.badgePillTxt, { color: b.fg }]}>{b.label}</Text>
                    </View>
                  </View>
                  <View style={styles.cardRow}>
                    <Text style={styles.cardAmt}>{fmtTLDecimal(m.toplam_tutar || m.tutar)}</Text>
                    <Text style={styles.cardDate}>{fmtDate(m.created_at)}</Text>
                  </View>
                </View>
              );
            } catch (_) { return null; }
          })
        )}

        {/* Cikis */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutTxt}>{"🚪"}  Cikis Yap</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: "#F0F4FF" },
  center:   { flex: 1, justifyContent: "center", alignItems: "center" },
  header:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
              backgroundColor: "#1D4ED8", paddingHorizontal: 20, paddingVertical: 16, paddingTop: 20 },
  htitle:   { color: "#fff", fontSize: 18, fontWeight: "800" },
  hsub:     { color: "#BFDBFE", fontSize: 12, marginTop: 2 },
  avatar:   { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.2)",
              borderWidth: 2, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  avatarTxt:{ color: "#fff", fontWeight: "700", fontSize: 16 },

  body:     { padding: 16, paddingBottom: 48 },

  hi:       { fontSize: 20, fontWeight: "700", color: "#374151", marginTop: 8 },
  hiName:   { fontSize: 26, fontWeight: "900", color: "#111827", marginTop: 2 },
  hiRole:   { fontSize: 13, color: "#6B7280", marginTop: 2, marginBottom: 16 },

  bigCard:  { backgroundColor: "#fff", borderRadius: 14, padding: 18, marginBottom: 12,
              borderLeftWidth: 5, borderLeftColor: "#F59E0B",
              shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 4 },
  bigCardBlue: { borderLeftColor: "#3B82F6" },
  bigCardLabel:{ fontSize: 11, fontWeight: "800", color: "#D97706", letterSpacing: 1, marginBottom: 6 },
  bigCardVal:  { fontSize: 30, fontWeight: "900", color: "#111827", marginBottom: 4 },
  bigCardSub:  { fontSize: 12, color: "#9CA3AF" },

  puantajBox: { backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 16,
                shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  puantajTitle:{ fontSize: 12, fontWeight: "800", color: "#374151", marginBottom: 12, letterSpacing: 0.5 },
  puantajRow: { flexDirection: "row", justifyContent: "space-around" },
  puantajCell:{ alignItems: "center", flex: 1,
                borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, paddingVertical: 10, marginHorizontal: 3 },
  puantajNum: { fontSize: 22, fontWeight: "900" },
  puantajLbl: { fontSize: 10, color: "#6B7280", marginTop: 3, fontWeight: "600" },
  fazlaMesai: { marginTop: 10, backgroundColor: "#FEF3C7", borderRadius: 8, padding: 10, alignItems: "center" },
  fazlaMesaiTxt:{ fontSize: 13, fontWeight: "700", color: "#92400E" },

  btnGrid:  { flexDirection: "row", marginBottom: 10 },
  actionBtn:{ flex: 1, borderRadius: 14, padding: 18, marginHorizontal: 5, alignItems: "center", justifyContent: "center",
              shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 3 },
  actionBtnBlue: { backgroundColor: "#EFF6FF", borderWidth: 1.5, borderColor: "#BFDBFE" },
  actionBtnDark: { backgroundColor: "#1E3A5F" },
  btnIcon:  { fontSize: 28, marginBottom: 8 },
  btnLabel: { fontSize: 14, fontWeight: "800" },

  badge:    { position: "absolute", top: -6, right: -10, backgroundColor: "#DC2626",
              borderRadius: 10, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeTxt: { color: "#fff", fontSize: 10, fontWeight: "800" },

  wideBtn:  { backgroundColor: "#1E3A5F", borderRadius: 14, paddingVertical: 16, paddingHorizontal: 20,
              flexDirection: "row", alignItems: "center", marginBottom: 0,
              shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 6, elevation: 3 },
  wideBtnIcon:{ fontSize: 22, marginRight: 12 },
  wideBtnTxt: { flex: 1, fontSize: 15, fontWeight: "800", color: "#fff" },
  wideBtnArrow:{ fontSize: 22, color: "#93C5FD", fontWeight: "300" },

  cezaBox:  { backgroundColor: "#FFF7ED", borderRadius: 14, padding: 14, marginTop: 16, marginBottom: 4,
              borderLeftWidth: 4, borderLeftColor: "#F97316" },
  cezaTitle:{ fontSize: 12, fontWeight: "800", color: "#C2410C", letterSpacing: 1, marginBottom: 10 },
  cezaRow:  { flexDirection: "row", alignItems: "center", marginBottom: 8, paddingBottom: 8,
              borderBottomWidth: 1, borderBottomColor: "#FED7AA" },
  cezaPlaka:{ fontSize: 13, fontWeight: "800", color: "#111827" },
  cezaAciklama:{ fontSize: 11, color: "#6B7280", marginTop: 1 },
  cezaTarih:{ fontSize: 10, color: "#9CA3AF", marginTop: 1 },
  cezaTutar:{ fontSize: 15, fontWeight: "800", color: "#DC2626" },

  secTitle: { fontSize: 16, fontWeight: "800", color: "#111827", marginTop: 20, marginBottom: 10 },

  card:     { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10,
              shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  cardRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  cardTitle:{ fontSize: 14, fontWeight: "700", color: "#111827", flex: 1, marginRight: 8 },
  cardAmt:  { fontSize: 15, fontWeight: "800", color: "#1D4ED8" },
  cardDate: { fontSize: 12, color: "#9CA3AF" },

  badgePill:{ borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  badgePillTxt:{ fontSize: 11, fontWeight: "700" },

  emptyBox: { backgroundColor: "#fff", borderRadius: 12, padding: 20, alignItems: "center",
              marginBottom: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  emptyTxt: { fontSize: 13, color: "#9CA3AF" },

  logoutBtn:{ marginTop: 24, backgroundColor: "#FEE2E2", borderRadius: 12,
              paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: "#FECACA" },
  logoutTxt:{ fontSize: 15, fontWeight: "700", color: "#DC2626" },
});
