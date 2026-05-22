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

export default function IsAvansScreen({ navigation, user }) {
  const [form, setForm] = useState({
    talep_eden: user?.name || "",
    proje: "",
    tutar: "",
    aciklama: "",
    banka_adi: "",
    iban: "",
  });
  const [loading, setLoading] = useState(false);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = async (durum = "TASLAK") => {
    if (!form.proje.trim()) {
      Alert.alert("Eksik Alan", "Proje kodu zorunludur.");
      return;
    }
    if (!form.tutar.trim() || isNaN(Number(form.tutar))) {
      Alert.alert("Eksik Alan", "Geçerli bir tutar giriniz.");
      return;
    }

    setLoading(true);
    try {
      const data = await apiPost(
        "/hr/is-avans",
        {
          talep_eden: form.talep_eden,
          talep_eden_email: user?.email || "",
          proje_kodu: form.proje.trim().toUpperCase(),
          tutar: Number(form.tutar),
          aciklama: form.aciklama.trim(),
          banka_adi: form.banka_adi.trim(),
          iban: form.iban.trim().toUpperCase(),
          durum,
        },
        true
      );

      if (data?.id || data?.ok !== false) {
        Alert.alert(
          "Başarılı",
          durum === "TASLAK"
            ? "Taslak olarak kaydedildi."
            : "İş Avans talebi gönderildi.",
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
          <Text style={styles.headerTitle}>İş Avans Talebi</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Field label="Talep Eden" value={form.talep_eden} onChangeText={(v) => set("talep_eden", v)} placeholder="Adınız Soyadınız" />
          <Field label="Proje Kodu *" value={form.proje} onChangeText={(v) => set("proje", v)} placeholder="Örn: AI0246_NS_AE" autoCapitalize="characters" />
          <Field
            label="Tutar (TL) *"
            value={form.tutar}
            onChangeText={(v) => set("tutar", v)}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />
          <Field label="Açıklama" value={form.aciklama} onChangeText={(v) => set("aciklama", v)} placeholder="Avans kullanım amacı..." multiline lines={3} />
          <Field label="Banka Adı" value={form.banka_adi} onChangeText={(v) => set("banka_adi", v)} placeholder="Ziraat Bankası" />
          <Field
            label="IBAN"
            value={form.iban}
            onChangeText={(v) => set("iban", v)}
            placeholder="TR00 0000 0000 0000 0000 0000 00"
            autoCapitalize="characters"
          />

          {/* Butonlar */}
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.btn, styles.btnGray, loading && styles.btnDisabled]}
              onPress={() => handleSubmit("TASLAK")}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#374151" size="small" />
              ) : (
                <Text style={styles.btnGrayText}>💾 Taslak Kaydet</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.btnBlue, loading && styles.btnDisabled]}
              onPress={() => handleSubmit("PM_BEKLE")}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.btnBlueText}>📤 Gönder</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChangeText, placeholder, keyboardType, multiline, lines, autoCapitalize }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && { height: (lines || 3) * 22 + 20, textAlignVertical: "top" }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        keyboardType={keyboardType || "default"}
        multiline={multiline}
        numberOfLines={lines}
        autoCapitalize={autoCapitalize || "none"}
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F0F4FF" },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1D4ED8",
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingTop: 18,
  },
  backBtn: { padding: 4, width: 60 },
  backText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  body: { padding: 20, paddingBottom: 40 },
  fieldWrap: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#111827",
  },
  btnRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  btn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: { opacity: 0.6 },
  btnGray: { backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#D1D5DB" },
  btnBlue: { backgroundColor: "#1D4ED8" },
  btnGrayText: { color: "#374151", fontWeight: "700", fontSize: 14 },
  btnBlueText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
