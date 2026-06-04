import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert, TextInput, Modal, KeyboardAvoidingView, Platform,
} from "react-native";
import { apiGet, apiPut, apiPost } from "../api";

const BLUE   = "#1D4ED8";
const DARK   = "#1E3A5F";
const LIGHT  = "#EFF6FF";
const GREEN  = "#166534";
const RED    = "#991B1B";

const DURUM_MAP = {
  TASLAK:         { label: "Taslak",                    bg: "#F3F4F6", fg: "#6B7280" },
  NURCAN_ONAY:    { label: "Nurcan Onayı",              bg: "#FEF3C7", fg: "#92400E" },
  ROLLOUT_BEKLE:  { label: "Rollout Onayı",             bg: "#FEF3C7", fg: "#92400E" },
  PM_ONAY:        { label: "PM Onayı Bekleniyor",       bg: "#DBEAFE", fg: "#1E40AF" },
  FIYAT_GIRISI:   { label: "Envanter Onayı",            bg: "#EDE9FE", fg: "#6D28D9" },
  DUZGUN_ONAY:    { label: "Direktör Onayı",            bg: "#FED7AA", fg: "#9A3412" },
  SATINALINACAK:  { label: "Satın Alınacak",            bg: "#FEF9C3", fg: "#713F12" },
  DEPODA:         { label: "Depoda",                    bg: "#D1FAE5", fg: "#065F46" },
  ONAYLANDI:      { label: "Onaylandı",                 bg: "#D1FAE5", fg: "#065F46" },
  REDDEDILDI:     { label: "Reddedildi",                bg: "#FEE2E2", fg: "#991B1B" },
};

function badge(durum) {
  const d = DURUM_MAP[durum] || { label: durum || "?", bg: "#F3F4F6", fg: "#6B7280" };
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

export default function MalzemeScreen({ user, navigation }) {
  const [talepler, setTalepler]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [tab, setTab]                 = useState("bekleyen"); // "bekleyen" | "tumumu"
  const [detay, setDetay]             = useState(null);
  const [detayKalemler, setDetayKalemler] = useState([]);
  const [detayLoading, setDetayLoading]   = useState(false);
  const [saving, setSaving]           = useState(false);
  const [onayNotu, setOnayNotu]       = useState("");
  const [showModal, setShowModal]     = useState(false);

  const isPM = (user?.role || "").toLowerCase() === "pm" ||
               (user?.email || "").toLowerCase() === "orhan.bedir@simsektel.com";

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      // For PM: load all; for others: load their own
      let url = "/malzeme/talepler";
      if (!isPM) {
        const em = encodeURIComponent((user?.email || "").toLowerCase());
        const nm = encodeURIComponent(user?.name || "");
        url = `/malzeme/talepler?email=${em}&name=${nm}`;
      }
      const data = await apiGet(url);
      setTalepler(Array.isArray(data) ? data : []);
    } catch (_) {}
    setLoading(false);
    setRefreshing(false);
  }, [isPM, user]);

  useEffect(() => { load(); }, [load]);

  const openDetay = async (item) => {
    setDetay(item);
    setOnayNotu("");
    setShowModal(true);
    setDetayLoading(true);
    try {
      const data = await apiGet(`/malzeme/talepler/${item.id}`);
      setDetayKalemler(data.kalemler || []);
    } catch (_) { setDetayKalemler([]); }
    setDetayLoading(false);
  };

  const handleDurumGuncelle = async (durum) => {
    if (!detay) return;
    setSaving(true);
    try {
      await apiPut(`/malzeme/talepler/${detay.id}/durum`, {
        durum,
        onay_notu: onayNotu || undefined,
      });
      setShowModal(false);
      setDetay(null);
      load();
      Alert.alert("Tamam", durum === "REDDEDILDI" ? "Talep reddedildi." : "Talep onaylandı.");
    } catch (e) {
      Alert.alert("Hata", e.message || "Bir hata oluştu.");
    }
    setSaving(false);
  };

  const handleOnayla = () => {
    Alert.alert(
      "Talebi Onayla",
      `"${detay?.talep_no}" talebini onaylayarak Envanter aşamasına göndereceksiniz.`,
      [
        { text: "Vazgeç", style: "cancel" },
        { text: "Onayla", onPress: () => handleDurumGuncelle("FIYAT_GIRISI") },
      ]
    );
  };

  const handleReddet = () => {
    Alert.alert(
      "Talebi Reddet",
      `"${detay?.talep_no}" talebini reddedeceksiniz.`,
      [
        { text: "Vazgeç", style: "cancel" },
        { text: "Reddet", style: "destructive", onPress: () => handleDurumGuncelle("REDDEDILDI") },
      ]
    );
  };

  const bekleyen = talepler.filter(t => t.durum === "PM_ONAY");
  const displayed = tab === "bekleyen" ? bekleyen : talepler;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backTxt}>{"‹"}</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Malzeme Yönetimi</Text>
          <Text style={styles.headerSub}>Talep Onay Paneli</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, tab === "bekleyen" && styles.tabActive]}
          onPress={() => setTab("bekleyen")}
        >
          <Text style={[styles.tabTxt, tab === "bekleyen" && styles.tabTxtActive]}>
            Bekleyen {bekleyen.length > 0 ? `(${bekleyen.length})` : ""}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === "tumumu" && styles.tabActive]}
          onPress={() => setTab("tumumu")}
        >
          <Text style={[styles.tabTxt, tab === "tumumu" && styles.tabTxtActive]}>
            Tüm Talepler {talepler.length > 0 ? `(${talepler.length})` : ""}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BLUE} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
        >
          {displayed.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>{"📦"}</Text>
              <Text style={styles.emptyTxt}>
                {tab === "bekleyen" ? "Bekleyen talep yok." : "Talep bulunamadı."}
              </Text>
            </View>
          ) : (
            displayed.map((item, idx) => (
              <TouchableOpacity
                key={item.id || idx}
                style={styles.card}
                onPress={() => openDetay(item)}
                activeOpacity={0.75}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.cardNo}>{item.talep_no || "—"}</Text>
                  {badge(item.durum)}
                </View>
                <Text style={styles.cardAd} numberOfLines={1}>{item.talep_eden_ad || "—"}</Text>
                {(item.bolge || item.proje) && (
                  <Text style={styles.cardSub} numberOfLines={1}>
                    {[item.bolge, item.proje].filter(Boolean).join(" · ")}
                  </Text>
                )}
                <View style={styles.cardFooter}>
                  <Text style={styles.cardKalem}>
                    {item.kalem_sayisi || 0} kalem
                  </Text>
                  <Text style={styles.cardDate}>{fmtDate(item.created_at)}</Text>
                </View>
                {item.notlar ? (
                  <Text style={styles.cardNot} numberOfLines={2}>📝 {item.notlar}</Text>
                ) : null}
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}

      {/* Detail Modal */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{detay?.talep_no || "Detay"}</Text>
                <Text style={styles.modalSub}>{detay?.talep_eden_ad || ""}</Text>
              </View>
              <TouchableOpacity onPress={() => { setShowModal(false); setDetay(null); }}>
                <Text style={styles.modalClose}>{"✕"}</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
              {/* Status */}
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 8 }}>
                {detay && badge(detay.durum)}
                {detay?.created_at && (
                  <Text style={{ fontSize: 12, color: "#6B7280" }}>{fmtDate(detay.created_at)}</Text>
                )}
              </View>

              {/* Info Grid */}
              <View style={styles.infoGrid}>
                {[
                  ["Bölge", detay?.bolge],
                  ["Proje", detay?.proje],
                  ["Site Tipi", detay?.site_type],
                  ["Talep Edilen", detay?.talep_edilen_personel || detay?.talep_edilen_firma],
                ].filter(([, v]) => v).map(([l, v]) => (
                  <View key={l} style={styles.infoItem}>
                    <Text style={styles.infoLabel}>{l}</Text>
                    <Text style={styles.infoVal}>{v}</Text>
                  </View>
                ))}
              </View>

              {detay?.notlar ? (
                <View style={styles.notBox}>
                  <Text style={styles.notTxt}>📝 {detay.notlar}</Text>
                </View>
              ) : null}

              {/* Kalemler */}
              <Text style={styles.sectionTitle}>Malzeme Kalemleri</Text>
              {detayLoading ? (
                <ActivityIndicator color={BLUE} style={{ marginVertical: 16 }} />
              ) : detayKalemler.length === 0 ? (
                <Text style={{ color: "#9CA3AF", fontSize: 13, marginBottom: 16 }}>Kalem bulunamadı.</Text>
              ) : (
                detayKalemler.map((k, idx) => (
                  <View key={k.id || idx} style={styles.kalemRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.kalemAdi}>{k.malzeme_adi}</Text>
                      {k.notlar ? <Text style={styles.kalemNot}>{k.notlar}</Text> : null}
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={styles.kalemMiktar}>{k.miktar} {k.birim}</Text>
                      {Number(k.birim_fiyat) > 0 && (
                        <Text style={styles.kalemFiyat}>
                          {Number(k.birim_fiyat).toLocaleString("tr-TR")} ₺/{k.birim}
                        </Text>
                      )}
                    </View>
                  </View>
                ))
              )}

              {/* Onay notu (only for PM on PM_ONAY items) */}
              {isPM && detay?.durum === "PM_ONAY" && (
                <>
                  <Text style={styles.sectionTitle}>Onay Notu (isteğe bağlı)</Text>
                  <TextInput
                    style={styles.noteInput}
                    placeholder="Notunuzu girin..."
                    placeholderTextColor="#9CA3AF"
                    value={onayNotu}
                    onChangeText={setOnayNotu}
                    multiline
                    numberOfLines={3}
                  />

                  {/* Action Buttons */}
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.rejectBtn, saving && { opacity: 0.5 }]}
                      onPress={handleReddet}
                      disabled={saving}
                    >
                      <Text style={styles.rejectBtnTxt}>✗ Reddet</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.approveBtn, saving && { opacity: 0.5 }]}
                      onPress={handleOnayla}
                      disabled={saving}
                    >
                      {saving ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.approveBtnTxt}>✓ Onayla</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}
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
  backBtn:        { marginRight: 12, padding: 4 },
  backTxt:        { fontSize: 28, color: "#fff", lineHeight: 30 },
  headerTitle:    { fontSize: 18, fontWeight: "800", color: "#fff" },
  headerSub:      { fontSize: 12, color: "#93C5FD", marginTop: 1 },
  tabRow:         { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tab:            { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive:      { borderBottomWidth: 2, borderBottomColor: BLUE },
  tabTxt:         { fontSize: 13, fontWeight: "600", color: "#6B7280" },
  tabTxtActive:   { color: BLUE },
  emptyBox:       { alignItems: "center", paddingVertical: 48 },
  emptyIcon:      { fontSize: 40, marginBottom: 8 },
  emptyTxt:       { fontSize: 14, color: "#9CA3AF" },
  card:           { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardTop:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  cardNo:         { fontSize: 15, fontWeight: "800", color: DARK },
  cardAd:         { fontSize: 13, color: "#374151", fontWeight: "600", marginBottom: 2 },
  cardSub:        { fontSize: 12, color: "#6B7280", marginBottom: 6 },
  cardFooter:     { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  cardKalem:      { fontSize: 12, color: "#6B7280" },
  cardDate:       { fontSize: 12, color: "#9CA3AF" },
  cardNot:        { fontSize: 12, color: "#92400E", backgroundColor: "#FFFBEB", padding: 6, borderRadius: 6, marginTop: 6 },
  // Modal
  modalSafe:      { flex: 1, backgroundColor: "#fff" },
  modalHeader:    { flexDirection: "row", alignItems: "flex-start", padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB", backgroundColor: DARK },
  modalTitle:     { fontSize: 18, fontWeight: "800", color: "#fff" },
  modalSub:       { fontSize: 12, color: "#93C5FD", marginTop: 2 },
  modalClose:     { fontSize: 22, color: "#93C5FD", padding: 4 },
  infoGrid:       { flexDirection: "row", flexWrap: "wrap", backgroundColor: "#F9FAFB", borderRadius: 10, padding: 12, marginBottom: 12, gap: 10 },
  infoItem:       { width: "47%" },
  infoLabel:      { fontSize: 11, color: "#9CA3AF", fontWeight: "700", textTransform: "uppercase", marginBottom: 2 },
  infoVal:        { fontSize: 13, color: "#1F2937", fontWeight: "600" },
  notBox:         { backgroundColor: "#FFFBEB", borderRadius: 8, padding: 10, marginBottom: 12 },
  notTxt:         { fontSize: 13, color: "#92400E" },
  sectionTitle:   { fontSize: 13, fontWeight: "800", color: "#374151", textTransform: "uppercase", marginBottom: 8, marginTop: 12, letterSpacing: 0.5 },
  kalemRow:       { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  kalemAdi:       { fontSize: 14, fontWeight: "600", color: "#1F2937", marginBottom: 2 },
  kalemNot:       { fontSize: 12, color: "#6B7280" },
  kalemMiktar:    { fontSize: 14, fontWeight: "700", color: DARK },
  kalemFiyat:     { fontSize: 11, color: "#6B7280", marginTop: 2 },
  noteInput:      { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, padding: 12, fontSize: 14, color: "#1F2937", minHeight: 80, textAlignVertical: "top", backgroundColor: "#FAFAFA", marginBottom: 16 },
  actionRow:      { flexDirection: "row", gap: 10, marginTop: 4 },
  rejectBtn:      { flex: 1, backgroundColor: "#FEE2E2", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  rejectBtnTxt:   { fontSize: 15, fontWeight: "800", color: "#991B1B" },
  approveBtn:     { flex: 2, backgroundColor: BLUE, borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  approveBtnTxt:  { fontSize: 15, fontWeight: "800", color: "#fff" },
});
