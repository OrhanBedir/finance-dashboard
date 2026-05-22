import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { apiPost } from "../api";

const KATEGORI_LIST = [
  "Yol & Ulaşım",
  "Konaklama",
  "Yemek",
  "Malzeme",
  "Yakıt",
  "Diğer",
];

export default function MasrafFormScreen({ navigation, user }) {
  const [kalemler, setKalemler] = useState([
    { kategori: "Diğer", aciklama: "", tutar: "", para_birimi: "TRY" },
  ]);
  const [loading, setLoading] = useState(false);
  const [activeKategori, setActiveKategori] = useState(null);

  const addKalem = () => {
    setKalemler((k) => [
      ...k,
      { kategori: "Diğer", aciklama: "", tutar: "", para_birimi: "TRY" },
    ]);
  };

  const removeKalem = (i) => {
    if (kalemler.length === 1) return;
    setKalemler((k) => k.filter((_, idx) => idx !== i));
  };

  const updateKalem = (i, key, val) => {
    setKalemler((k) =>
      k.map((item, idx) => (idx === i ? { ...item, [key]: val } : item))
    );
  };

  const toplamTL = kalemler
    .filter((k) => k.para_birimi === "TRY" && !isNaN(Number(k.tutar)))
    .reduce((s, k) => s + Number(k.tutar || 0), 0);

  const handleSubmit = async (durum = "TASLAK") => {
    const invalid = kalemler.find(
      (k) => !k.aciklama.trim() || !k.tutar.trim() || isNaN(Number(k.tutar))
    );
    if (invalid) {
      Alert.alert("Eksik Alan", "Tüm kalemlerde açıklama ve geçerli tutar girilmelidir.");
      return;
    }

    setLoading(true);
    try {
      const data = await apiPost(
        "/hr/masraf-form",
        {
          talep_eden: user?.name || "",
          talep_eden_email: user?.email || "",
          durum,
          kalemler: kalemler.map((k) => ({
            kategori: k.kategori,
            aciklama: k.aciklama.trim(),
            tutar: Number(k.tutar),
            para_birimi: k.para_birimi,
          })),
        },
        true
      );

      if (data?.id || data?.ok !== false) {
        Alert.alert(
          "Başarılı",
          durum === "TASLAK"
            ? "Masraf formu taslak olarak kaydedildi."
            : "Masraf formu gönderildi.",
          [{ text: "Tamam", onPress: () => navigation.goBack() }]
        );
      } else {
        Alert.alert("Hata", data?.error || "Kayıt başarısız.");
      }
    } catch (err) {
      Alert.alert("Bağlantı Hatası", "Sunucuya ulaşılamadı.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>‹ Geri</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Masraf Formu</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">

          {/* Kalemler */}
          {kalemler.map((kalem, i) => (
            <View key={i} style={styles.kalemCard}>
              <View style={styles.kalemHeader}>
                <Text style={styles.kalemNo}>Kalem {i + 1}</Text>
                {kalemler.length > 1 && (
                  <TouchableOpacity onPress={() => removeKalem(i)}>
                    <Text style={styles.removeText}>✕ Kaldır</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Kategori seçici */}
              <Text style={styles.label}>Kategori</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.kategoriRow}>
                {KATEGORI_LIST.map((kat) => (
                  <TouchableOpacity
                    key={kat}
                    style={[styles.kategoriChip, kalem.kategori === kat && styles.kategoriChipActive]}
                    onPress={() => updateKalem(i, "kategori", kat)}
                  >
                    <Text style={[styles.kategoriChipText, kalem.kategori === kat && styles.kategoriChipTextActive]}>
                      {kat}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Açıklama */}
              <Text style={styles.label}>Açıklama *</Text>
              <TextInput
                style={styles.input}
                value={kalem.aciklama}
                onChangeText={(v) => updateKalem(i, "aciklama", v)}
                placeholder="Harcama açıklaması..."
                placeholderTextColor="#9CA3AF"
                autoCorrect={false}
              />

              {/* Tutar + Para Birimi */}
              <View style={styles.tutarRow}>
                <View style={styles.tutarInput}>
                  <Text style={styles.label}>Tutar *</Text>
                  <TextInput
                    style={styles.input}
                    value={kalem.tutar}
                    onChangeText={(v) => updateKalem(i, "tutar", v)}
                    placeholder="0.00"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.paraBirimi}>
                  <Text style={styles.label}>Para Birimi</Text>
                  <View style={styles.currencyRow}>
                    {["TRY", "USD", "EUR"].map((c) => (
                      <TouchableOpacity
                        key={c}
                        style={[styles.currBtn, kalem.para_birimi === c && styles.currBtnActive]}
                        onPress={() => updateKalem(i, "para_birimi", c)}
                      >
                        <Text style={[styles.currText, kalem.para_birimi === c && styles.currTextActive]}>
                          {c}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            </View>
          ))}

          {/* Kalem Ekle */}
          <TouchableOpacity style={styles.addBtn} onPress={addKalem}>
            <Text style={styles.addBtnText}>+ Yeni Kalem Ekle</Text>
          </TouchableOpacity>

          {/* Toplam */}
          {toplamTL > 0 && (
            <View style={styles.totalBox}>
              <Text style={styles.totalLabel}>TRY Toplam</Text>
              <Text style={styles.totalAmount}>
                ₺{toplamTL.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
              </Text>
            </View>
          )}

          {/* Gönder Butonları */}
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.btn, styles.btnGray, loading && styles.btnDisabled]}
              onPress={() => handleSubmit("TASLAK")}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#374151" size="small" />
              ) : (
                <Text style={styles.btnGrayText}>💾 Taslak</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.btnGreen, loading && styles.btnDisabled]}
              onPress={() => handleSubmit("PM_BEKLE")}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.btnGreenText}>📤 Gönder</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F0FFF4" },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#059669",
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingTop: 18,
  },
  backBtn: { padding: 4, width: 60 },
  backText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },

  body: { padding: 16, paddingBottom: 40 },

  kalemCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  kalemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  kalemNo: { fontSize: 14, fontWeight: "700", color: "#059669" },
  removeText: { fontSize: 13, color: "#EF4444", fontWeight: "600" },

  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: "#111827",
  },

  kategoriRow: { marginBottom: 4 },
  kategoriChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "#F3F4F6",
    marginRight: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  kategoriChipActive: { backgroundColor: "#DCFCE7", borderColor: "#059669" },
  kategoriChipText: { fontSize: 13, color: "#6B7280", fontWeight: "500" },
  kategoriChipTextActive: { color: "#059669", fontWeight: "700" },

  tutarRow: { flexDirection: "row", gap: 12 },
  tutarInput: { flex: 1 },
  paraBirimi: { width: 130 },
  currencyRow: { flexDirection: "row", gap: 6, marginTop: 2 },
  currBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  currBtnActive: { backgroundColor: "#DCFCE7", borderColor: "#059669" },
  currText: { fontSize: 12, fontWeight: "600", color: "#6B7280" },
  currTextActive: { color: "#059669" },

  addBtn: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: "#059669",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 16,
  },
  addBtnText: { color: "#059669", fontWeight: "700", fontSize: 14 },

  totalBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#ECFDF5",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  totalLabel: { color: "#065F46", fontWeight: "700", fontSize: 15 },
  totalAmount: { color: "#059669", fontWeight: "800", fontSize: 17 },

  btnRow: { flexDirection: "row", gap: 12 },
  btn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: { opacity: 0.6 },
  btnGray: { backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#D1D5DB" },
  btnGreen: { backgroundColor: "#059669" },
  btnGrayText: { color: "#374151", fontWeight: "700", fontSize: 14 },
  btnGreenText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
