import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert, TextInput, Modal,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { apiGet, apiPost, apiPut } from "../api";

const BLUE  = "#1D4ED8";
const DARK  = "#1E3A5F";
const LIGHT = "#EFF6FF";

const DAG_DURUM_MAP = {
  PERSONELDE:   { label: "Üzerimde",         bg: "#DBEAFE", fg: "#1E40AF" },
  SAHADA:       { label: "Sahada",            bg: "#FEF3C7", fg: "#92400E" },
  DEPOYA_IADE:  { label: "İade Edildi",       bg: "#D1FAE5", fg: "#065F46" },
};

const TALEP_DURUM_MAP = {
  TASLAK:         { label: "Taslak",              bg: "#F3F4F6", fg: "#6B7280" },
  PM_ONAY:        { label: "PM Onayı Bekleniyor", bg: "#DBEAFE", fg: "#1E40AF" },
  FIYAT_GIRISI:   { label: "Envanter Onayı",      bg: "#EDE9FE", fg: "#6D28D9" },
  DUZGUN_ONAY:    { label: "Direktör Onayı",      bg: "#FED7AA", fg: "#9A3412" },
  SATINALINACAK:  { label: "Satın Alınacak",      bg: "#FEF9C3", fg: "#713F12" },
  DEPODA:         { label: "Depoda",              bg: "#D1FAE5", fg: "#065F46" },
  ONAYLANDI:      { label: "Onaylandı",           bg: "#D1FAE5", fg: "#065F46" },
  REDDEDILDI:     { label: "Reddedildi",          bg: "#FEE2E2", fg: "#991B1B" },
};

function badge(durum, map) {
  const d = map[durum] || { label: durum || "?", bg: "#F3F4F6", fg: "#6B7280" };
  return (
    <View style={{ backgroundColor: d.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
      <Text style={{ fontSize: 11, fontWeight: "700", color: d.fg }}>{d.label}</Text>
    </View>
  );
}

function fmtDate(d) {
  if (!d) return "";
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "";
    const aylar = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
    return `${dt.getDate()} ${aylar[dt.getMonth()]} ${dt.getFullYear()}`;
  } catch (_) { return ""; }
}

const BIRIMLER = ["Adet", "Metre", "Kg", "Litre", "Paket", "Kutu", "Takım", "Set", "Role"];

export default function UzerimdekiMalzemelerScreen({ user, navigation }) {
  const [tab, setTab]               = useState("uzerimdeki"); // "uzerimdeki" | "taleplerim"
  const [dagitimlar, setDagitimlar] = useState([]);
  const [talepler, setTalepler]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showNewTalep, setShowNewTalep] = useState(false);

  // Yeni talep formu
  const [kalemler, setKalemler]     = useState([{ malzeme_adi: "", miktar: "", birim: "Adet" }]);
  const [talepNot, setTalepNot]     = useState("");
  const [submitting, setSubmitting] = useState(false);

  const email = (user?.email || "").toLowerCase();
  const name  = user?.name || "";

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const em = encodeURIComponent(email);
      const nm = encodeURIComponent(name);
      const [dagData, talepData] = await Promise.all([
        apiGet(`/malzeme/dagitim?personel_email=${em}`),
        apiGet(`/malzeme/talepler?email=${em}&name=${nm}`),
      ]);
      setDagitimlar(Array.isArray(dagData) ? dagData : []);
      setTalepler(Array.isArray(talepData) ? talepData : []);
    } catch (_) {}
    setLoading(false);
    setRefreshing(false);
  }, [email, name]);

  useEffect(() => { load(); }, [load]);

  const addKalem = () => {
    setKalemler(prev => [...prev, { malzeme_adi: "", miktar: "", birim: "Adet" }]);
  };

  const removeKalem = (idx) => {
    setKalemler(prev => prev.filter((_, i) => i !== idx));
  };

  const updateKalem = (idx, field, value) => {
    setKalemler(prev => prev.map((k, i) => i === idx ? { ...k, [field]: value } : k));
  };

  const submitTalep = async () => {
    const validKalemler = kalemler.filter(k => k.malzeme_adi.trim() && k.miktar);
    if (validKalemler.length === 0) {
      Alert.alert("Eksik Bilgi", "En az bir malzeme kalemi giriniz.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        talep_eden_email: email,
        talep_eden_ad:    name,
        durum:            "PM_ONAY",
        notlar:           talepNot,
        kalemler: validKalemler.map(k => ({
          malzeme_adi:  k.malzeme_adi.trim(),
          miktar:       Number(k.miktar) || 1,
          birim:        k.birim || "Adet",
          birim_fiyat:  0,
          toplam_tutar: 0,
        })),
      };
      await apiPost("/malzeme/talepler", payload);
      setShowNewTalep(false);
      setKalemler([{ malzeme_adi: "", miktar: "", birim: "Adet" }]);
      setTalepNot("");
      load();
      Alert.alert("Gönderildi", "Malzeme talebiniz PM onayına gönderildi.");
    } catch (e) {
      Alert.alert("Hata", e.message || "Bir hata oluştu.");
    }
    setSubmitting(false);
  };

  const handleIade = (item) => {
    Alert.alert(
      "İade Talebi",
      `${item.malzeme_adi} (${item.miktar} ${item.birim}) depoye iade edilsin mi?`,
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "İade Et",
          onPress: async () => {
            try {
              await apiPut(`/malzeme/dagitim/${item.id}/iade`, {});
              load();
              Alert.alert("Tamam", "İade talebi oluşturuldu.");
            } catch (e) {
              Alert.alert("Hata", e.message || "Bir hata oluştu.");
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backTxt}>{"‹"}</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Malzemelerim</Text>
          <Text style={styles.headerSub}>Üzerimdekiler & Taleplerim</Text>
        </View>
        <TouchableOpacity style={styles.newBtn} onPress={() => setShowNewTalep(true)}>
          <Text style={styles.newBtnTxt}>+ Talep</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, tab === "uzerimdeki" && styles.tabActive]}
          onPress={() => setTab("uzerimdeki")}
        >
          <Text style={[styles.tabTxt, tab === "uzerimdeki" && styles.tabTxtActive]}>
            Üzerimdekiler {dagitimlar.length > 0 ? `(${dagitimlar.length})` : ""}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === "taleplerim" && styles.tabActive]}
          onPress={() => setTab("taleplerim")}
        >
          <Text style={[styles.tabTxt, tab === "taleplerim" && styles.tabTxtActive]}>
            Taleplerim {talepler.length > 0 ? `(${talepler.length})` : ""}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={BLUE} /></View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
        >
          {/* --- Üzerimdekiler Tab --- */}
          {tab === "uzerimdeki" && (
            dagitimlar.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyIcon}>{"📦"}</Text>
                <Text style={styles.emptyTxt}>Üzerinizde kayıtlı malzeme yok.</Text>
              </View>
            ) : (
              dagitimlar.map((item, idx) => (
                <View key={item.id || idx} style={styles.card}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{item.malzeme_adi}</Text>
                    {badge(item.durum, DAG_DURUM_MAP)}
                  </View>
                  <View style={styles.cardRow}>
                    <Text style={styles.miktar}>{item.miktar} {item.birim}</Text>
                    <Text style={styles.cardDate}>{fmtDate(item.verilme_tarihi)}</Text>
                  </View>
                  {item.bolge && <Text style={styles.cardSub}>{item.bolge} {item.site_id ? `· ${item.site_id}` : ""}</Text>}
                  {item.notlar ? <Text style={styles.cardNot}>📝 {item.notlar}</Text> : null}

                  {item.durum === "PERSONELDE" && (
                    <TouchableOpacity style={styles.iadeBtn} onPress={() => handleIade(item)}>
                      <Text style={styles.iadeBtnTxt}>↩ Depoya İade Et</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))
            )
          )}

          {/* --- Taleplerim Tab --- */}
          {tab === "taleplerim" && (
            talepler.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyIcon}>{"📋"}</Text>
                <Text style={styles.emptyTxt}>Henüz talep oluşturmadınız.</Text>
                <TouchableOpacity style={styles.newTalepBtn} onPress={() => setShowNewTalep(true)}>
                  <Text style={styles.newTalepBtnTxt}>+ Yeni Talep Oluştur</Text>
                </TouchableOpacity>
              </View>
            ) : (
              talepler.map((item, idx) => (
                <View key={item.id || idx} style={styles.card}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardNo}>{item.talep_no || "—"}</Text>
                    {badge(item.durum, TALEP_DURUM_MAP)}
                  </View>
                  {(item.bolge || item.proje) && (
                    <Text style={styles.cardSub} numberOfLines={1}>
                      {[item.bolge, item.proje].filter(Boolean).join(" · ")}
                    </Text>
                  )}
                  <View style={styles.cardRow}>
                    <Text style={styles.cardKalem}>{item.kalem_sayisi || 0} kalem</Text>
                    <Text style={styles.cardDate}>{fmtDate(item.created_at)}</Text>
                  </View>
                  {item.notlar ? <Text style={styles.cardNot}>📝 {item.notlar}</Text> : null}
                </View>
              ))
            )
          )}
        </ScrollView>
      )}

      {/* New Talep Modal */}
      <Modal visible={showNewTalep} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Yeni Malzeme Talebi</Text>
              <TouchableOpacity onPress={() => setShowNewTalep(false)}>
                <Text style={styles.modalClose}>{"✕"}</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
              <Text style={styles.sectionLabel}>Malzeme Kalemleri</Text>

              {kalemler.map((k, idx) => (
                <View key={idx} style={styles.kalemForm}>
                  <View style={styles.kalemFormHeader}>
                    <Text style={styles.kalemFormIdx}>Kalem {idx + 1}</Text>
                    {kalemler.length > 1 && (
                      <TouchableOpacity onPress={() => removeKalem(idx)}>
                        <Text style={{ fontSize: 13, color: "#EF4444", fontWeight: "600" }}>Kaldır</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="Malzeme adı *"
                    placeholderTextColor="#9CA3AF"
                    value={k.malzeme_adi}
                    onChangeText={v => updateKalem(idx, "malzeme_adi", v)}
                  />
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      placeholder="Miktar *"
                      placeholderTextColor="#9CA3AF"
                      value={k.miktar}
                      onChangeText={v => updateKalem(idx, "miktar", v)}
                      keyboardType="numeric"
                    />
                    <View style={styles.birimContainer}>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        {BIRIMLER.map(b => (
                          <TouchableOpacity
                            key={b}
                            style={[styles.birimChip, k.birim === b && styles.birimChipActive]}
                            onPress={() => updateKalem(idx, "birim", b)}
                          >
                            <Text style={[styles.birimChipTxt, k.birim === b && styles.birimChipTxtActive]}>{b}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  </View>
                </View>
              ))}

              <TouchableOpacity style={styles.addKalemBtn} onPress={addKalem}>
                <Text style={styles.addKalemBtnTxt}>+ Kalem Ekle</Text>
              </TouchableOpacity>

              <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Not (isteğe bağlı)</Text>
              <TextInput
                style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]}
                placeholder="Talep notunuzu yazın..."
                placeholderTextColor="#9CA3AF"
                value={talepNot}
                onChangeText={setTalepNot}
                multiline
              />

              <TouchableOpacity
                style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
                onPress={submitTalep}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitBtnTxt}>📤 PM Onayına Gönder</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: LIGHT },
  centered:       { flex: 1, justifyContent: "center", alignItems: "center" },
  header:         { backgroundColor: DARK, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14 },
  backBtn:        { marginRight: 10, padding: 4 },
  backTxt:        { fontSize: 28, color: "#fff", lineHeight: 30 },
  headerTitle:    { fontSize: 17, fontWeight: "800", color: "#fff" },
  headerSub:      { fontSize: 12, color: "#93C5FD", marginTop: 1 },
  newBtn:         { backgroundColor: "#fff", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  newBtnTxt:      { fontSize: 13, fontWeight: "800", color: BLUE },
  tabRow:         { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tab:            { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive:      { borderBottomWidth: 2, borderBottomColor: BLUE },
  tabTxt:         { fontSize: 13, fontWeight: "600", color: "#6B7280" },
  tabTxtActive:   { color: BLUE },
  emptyBox:       { alignItems: "center", paddingVertical: 48 },
  emptyIcon:      { fontSize: 40, marginBottom: 8 },
  emptyTxt:       { fontSize: 14, color: "#9CA3AF", marginBottom: 16 },
  newTalepBtn:    { backgroundColor: BLUE, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 },
  newTalepBtnTxt: { color: "#fff", fontSize: 14, fontWeight: "700" },
  card:           { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardTop:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  cardTitle:      { fontSize: 15, fontWeight: "700", color: DARK, flex: 1, marginRight: 8 },
  cardNo:         { fontSize: 15, fontWeight: "800", color: DARK },
  cardRow:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
  miktar:         { fontSize: 16, fontWeight: "800", color: BLUE },
  cardSub:        { fontSize: 12, color: "#6B7280", marginTop: 2 },
  cardDate:       { fontSize: 12, color: "#9CA3AF" },
  cardKalem:      { fontSize: 12, color: "#6B7280" },
  cardNot:        { fontSize: 12, color: "#92400E", backgroundColor: "#FFFBEB", padding: 6, borderRadius: 6, marginTop: 6 },
  iadeBtn:        { marginTop: 10, backgroundColor: "#EFF6FF", borderRadius: 8, paddingVertical: 8, alignItems: "center", borderWidth: 1, borderColor: "#BFDBFE" },
  iadeBtnTxt:     { fontSize: 13, fontWeight: "700", color: BLUE },
  // Modal
  modalSafe:      { flex: 1, backgroundColor: "#fff" },
  modalHeader:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  modalTitle:     { fontSize: 18, fontWeight: "800", color: DARK },
  modalClose:     { fontSize: 22, color: "#9CA3AF" },
  sectionLabel:   { fontSize: 12, fontWeight: "800", color: "#374151", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  kalemForm:      { backgroundColor: "#F9FAFB", borderRadius: 10, padding: 12, marginBottom: 10 },
  kalemFormHeader:{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  kalemFormIdx:   { fontSize: 12, fontWeight: "700", color: "#6B7280", textTransform: "uppercase" },
  input:          { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 8, padding: 10, fontSize: 14, color: "#1F2937", backgroundColor: "#fff", marginBottom: 8 },
  birimContainer: { flex: 1.5, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 8, backgroundColor: "#fff", paddingHorizontal: 4, justifyContent: "center", maxHeight: 44, marginBottom: 8 },
  birimChip:      { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, marginHorizontal: 2 },
  birimChipActive:{ backgroundColor: BLUE },
  birimChipTxt:   { fontSize: 12, fontWeight: "600", color: "#374151" },
  birimChipTxtActive:{ color: "#fff" },
  addKalemBtn:    { borderWidth: 1.5, borderColor: BLUE, borderStyle: "dashed", borderRadius: 10, paddingVertical: 12, alignItems: "center", marginBottom: 4 },
  addKalemBtnTxt: { fontSize: 14, fontWeight: "700", color: BLUE },
  submitBtn:      { backgroundColor: BLUE, borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 20 },
  submitBtnTxt:   { fontSize: 16, fontWeight: "800", color: "#fff" },
});
