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
  Modal,
} from "react-native";
import { apiPost } from "../api";

const GIDER_TURLERI = ["Yol", "Konaklama", "Akşam Yemeği", "Yakıt", "Malzeme", "Ekipman", "Diğer"];

const BOLGELER = [
  // Marmara
  "İstanbul", "Tekirdağ", "Edirne", "Kırklareli", "Çanakkale",
  "Bursa", "Balıkesir", "Kocaeli", "Sakarya", "Bolu", "Yalova", "Bilecik", "Düzce",
  // Ege
  "İzmir", "Manisa", "Aydın", "Denizli", "Muğla", "Uşak", "Afyonkarahisar", "Kütahya",
  // İç Anadolu
  "Ankara", "Konya", "Eskişehir", "Kayseri", "Sivas", "Yozgat",
  "Aksaray", "Nevşehir", "Niğde", "Kırşehir", "Kırıkkale", "Çankırı", "Karaman",
  // Akdeniz
  "Antalya", "İsparta", "Burdur", "Mersin", "Adana", "Hatay", "Kahramanmaraş", "Osmaniye",
];

const PROJELER = ["TT - Türk Telekom", "TC - Türkcell", "VF - Vodafone"];

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
                "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

// ─── Reusable dropdown picker ─────────────────────────────────────────────────
function PickerField({ label, value, onSelect, options, placeholder, required }) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>
        {label}
        {required && <Text style={{ color: "#dc2626" }}> *</Text>}
      </Text>
      <TouchableOpacity style={styles.pickerBtn} onPress={() => setVisible(true)} activeOpacity={0.7}>
        <Text style={[styles.pickerText, !value && styles.pickerPlaceholder]}>
          {value || placeholder}
        </Text>
        <Text style={styles.pickerArrow}>▾</Text>
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setVisible(false)}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{label}</Text>
              <TouchableOpacity onPress={() => setVisible(false)} style={styles.modalCloseBtn}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
              {options.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[styles.optionRow, value === opt && styles.optionRowActive]}
                  onPress={() => { onSelect(opt); setVisible(false); }}
                >
                  <Text style={[styles.optionText, value === opt && styles.optionTextActive]}>
                    {opt}
                  </Text>
                  {value === opt && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ─── Date picker ─────────────────────────────────────────────────────────────
function DateField({ label, value, onDateChange, required }) {
  const [visible, setVisible] = useState(false);
  const d = value instanceof Date ? value : new Date();

  const adjust = (field, delta) => {
    const nd = new Date(d);
    if (field === "day")   nd.setDate(nd.getDate() + delta);
    if (field === "month") nd.setMonth(nd.getMonth() + delta);
    if (field === "year")  nd.setFullYear(nd.getFullYear() + delta);
    onDateChange(nd);
  };

  const displayStr = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>
        {label}
        {required && <Text style={{ color: "#dc2626" }}> *</Text>}
      </Text>
      <TouchableOpacity style={styles.pickerBtn} onPress={() => setVisible(true)} activeOpacity={0.7}>
        <Text style={styles.pickerText}>📅  {displayStr}</Text>
        <Text style={styles.pickerArrow}>▾</Text>
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: 280 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Tarih Seç</Text>
              <TouchableOpacity onPress={() => setVisible(false)} style={styles.modalCloseBtn}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.dateRow}>
              {/* Day */}
              <View style={styles.dateUnit}>
                <TouchableOpacity onPress={() => adjust("day", 1)} style={styles.dateArrowBtn}>
                  <Text style={styles.dateArrowText}>▲</Text>
                </TouchableOpacity>
                <Text style={styles.dateVal}>{d.getDate()}</Text>
                <TouchableOpacity onPress={() => adjust("day", -1)} style={styles.dateArrowBtn}>
                  <Text style={styles.dateArrowText}>▼</Text>
                </TouchableOpacity>
                <Text style={styles.dateUnitLabel}>Gün</Text>
              </View>

              <Text style={styles.dateSep}>/</Text>

              {/* Month */}
              <View style={styles.dateUnit}>
                <TouchableOpacity onPress={() => adjust("month", 1)} style={styles.dateArrowBtn}>
                  <Text style={styles.dateArrowText}>▲</Text>
                </TouchableOpacity>
                <Text style={[styles.dateVal, { fontSize: 15 }]}>{MONTHS[d.getMonth()]}</Text>
                <TouchableOpacity onPress={() => adjust("month", -1)} style={styles.dateArrowBtn}>
                  <Text style={styles.dateArrowText}>▼</Text>
                </TouchableOpacity>
                <Text style={styles.dateUnitLabel}>Ay</Text>
              </View>

              <Text style={styles.dateSep}>/</Text>

              {/* Year */}
              <View style={styles.dateUnit}>
                <TouchableOpacity onPress={() => adjust("year", 1)} style={styles.dateArrowBtn}>
                  <Text style={styles.dateArrowText}>▲</Text>
                </TouchableOpacity>
                <Text style={styles.dateVal}>{d.getFullYear()}</Text>
                <TouchableOpacity onPress={() => adjust("year", -1)} style={styles.dateArrowBtn}>
                  <Text style={styles.dateArrowText}>▼</Text>
                </TouchableOpacity>
                <Text style={styles.dateUnitLabel}>Yıl</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.dateConfirmBtn} onPress={() => setVisible(false)}>
              <Text style={styles.dateConfirmText}>Tamam</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Text input field ─────────────────────────────────────────────────────────
function Field({ label, value, onChangeText, placeholder, keyboardType, multiline, lines, autoCapitalize, required }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>
        {label}
        {required && <Text style={{ color: "#dc2626" }}> *</Text>}
      </Text>
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

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function IsAvansScreen({ navigation, user }) {
  const [form, setForm] = useState({
    talep_eden: user?.name || "",
    tarih:      new Date(),
    gider_turu: "",
    bolge:      "",
    proje:      "",
    tutar:      "",
    aciklama:   "",
    banka_adi:  "",
    iban:       "",
  });
  const [loading, setLoading] = useState(false);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = async (durum = "TASLAK") => {
    if (!form.gider_turu) {
      Alert.alert("Eksik Alan", "Gider türü seçiniz.");
      return;
    }
    if (!form.bolge) {
      Alert.alert("Eksik Alan", "Bölge seçiniz.");
      return;
    }
    if (!form.proje) {
      Alert.alert("Eksik Alan", "Proje seçiniz.");
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
          talep_eden_ad:    form.talep_eden,
          talep_eden_email: user?.email || "",
          tarih:            form.tarih instanceof Date
                              ? form.tarih.toISOString().split("T")[0]
                              : new Date().toISOString().split("T")[0],
          gider_turu:       form.gider_turu,
          bolge:            form.bolge,
          proje:            form.proje.trim(),
          tutar:            Number(form.tutar),
          aciklama:         form.aciklama.trim(),
          banka_adi:        form.banka_adi.trim(),
          iban:             form.iban.trim().toUpperCase(),
        },
        true
      );

      if (data?.id) {
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

          <Field
            label="Talep Eden"
            value={form.talep_eden}
            onChangeText={(v) => set("talep_eden", v)}
            placeholder="Adınız Soyadınız"
          />

          <DateField
            label="Tarih"
            value={form.tarih}
            onDateChange={(d) => set("tarih", d)}
            required
          />

          <PickerField
            label="Gider Türü"
            value={form.gider_turu}
            onSelect={(v) => set("gider_turu", v)}
            options={GIDER_TURLERI}
            placeholder="Seçiniz..."
            required
          />

          <PickerField
            label="Bölge"
            value={form.bolge}
            onSelect={(v) => set("bolge", v)}
            options={BOLGELER}
            placeholder="Şehir seçiniz..."
            required
          />

          <PickerField
            label="Proje"
            value={form.proje}
            onSelect={(v) => set("proje", v)}
            options={PROJELER}
            placeholder="Proje seçiniz..."
            required
          />

          <Field
            label="Tutar (TL)"
            value={form.tutar}
            onChangeText={(v) => set("tutar", v)}
            placeholder="0.00"
            keyboardType="decimal-pad"
            required
          />

          <Field
            label="Açıklama"
            value={form.aciklama}
            onChangeText={(v) => set("aciklama", v)}
            placeholder="Avans kullanım amacı..."
            multiline
            lines={3}
          />

          <Field
            label="Banka Adı"
            value={form.banka_adi}
            onChangeText={(v) => set("banka_adi", v)}
            placeholder="Ziraat Bankası"
          />

          <Field
            label="IBAN"
            value={form.iban}
            onChangeText={(v) => set("iban", v)}
            placeholder="TR00 0000 0000 0000 0000 0000 00"
            autoCapitalize="characters"
          />

          {/* Buttons */}
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

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#F0F4FF" },
  flex:   { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1D4ED8",
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingTop: 18,
  },
  backBtn:     { padding: 4, width: 60 },
  backText:    { color: "#fff", fontSize: 16, fontWeight: "600" },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  body:        { padding: 20, paddingBottom: 40 },

  // Field
  fieldWrap: { marginBottom: 16 },
  label:     { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
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

  // Picker button
  pickerBtn: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pickerText:        { fontSize: 15, color: "#111827", flex: 1 },
  pickerPlaceholder: { color: "#9CA3AF" },
  pickerArrow:       { fontSize: 14, color: "#6B7280", marginLeft: 8 },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "70%",
    paddingBottom: 32,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  modalTitle:    { fontSize: 16, fontWeight: "700", color: "#111827" },
  modalCloseBtn: { padding: 4 },
  modalClose:    { fontSize: 18, color: "#6B7280" },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F9FAFB",
  },
  optionRowActive: { backgroundColor: "#EFF6FF" },
  optionText:      { fontSize: 15, color: "#374151" },
  optionTextActive: { color: "#1D4ED8", fontWeight: "700" },
  checkmark:       { fontSize: 16, color: "#1D4ED8", fontWeight: "700" },

  // Date picker modal
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 20,
    gap: 8,
  },
  dateUnit: {
    alignItems: "center",
    minWidth: 72,
  },
  dateArrowBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  dateArrowText: { fontSize: 16, color: "#1D4ED8", fontWeight: "700" },
  dateVal: {
    fontSize: 20,
    fontWeight: "800",
    color: "#111827",
    marginVertical: 6,
    textAlign: "center",
  },
  dateUnitLabel: { fontSize: 11, color: "#9CA3AF", fontWeight: "600", marginTop: 4 },
  dateSep:       { fontSize: 22, color: "#D1D5DB", fontWeight: "300", marginBottom: 20 },
  dateConfirmBtn: {
    marginHorizontal: 20,
    backgroundColor: "#1D4ED8",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  dateConfirmText: { color: "#fff", fontWeight: "700", fontSize: 15 },

  // Buttons
  btnRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  btn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled:  { opacity: 0.6 },
  btnGray:      { backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#D1D5DB" },
  btnBlue:      { backgroundColor: "#1D4ED8" },
  btnGrayText:  { color: "#374151", fontWeight: "700", fontSize: 14 },
  btnBlueText:  { color: "#fff", fontWeight: "700", fontSize: 14 },
});
