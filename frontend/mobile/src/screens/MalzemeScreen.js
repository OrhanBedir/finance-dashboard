import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert, TextInput, Modal,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { apiGet, apiPut, apiPost } from "../api";

const BLUE   = "#1D4ED8";
const DARK   = "#1E3A5F";
const LIGHT  = "#EFF6FF";
const GREEN  = "#166534";
const RED    = "#991B1B";

const DURUM_MAP = {
  TASLAK:         { label: "Taslak",                    bg: "#F3F4F6", fg: "#6B7280" },
  NURCAN_ONAY:    { label: "Rollout Onayı",             bg: "#FEF3C7", fg: "#92400E" },
  ROLLOUT_BEKLE:  { label: "Rollout Onayı",             bg: "#FEF3C7", fg: "#92400E" },
  PM_ONAY:        { label: "PM Onayı Bekleniyor",       bg: "#DBEAFE", fg: "#1E40AF" },
  FIYAT_GIRISI:   { label: "Envanter Onayı",            bg: "#EDE9FE", fg: "#6D28D9" },
  DUZGUN_ONAY:    { label: "Direktör Onayı",            bg: "#FED7AA", fg: "#9A3412" },
  SATINALINACAK:  { label: "Satın Alınacak",            bg: "#FEF9C3", fg: "#713F12" },
  DEPODA:         { label: "Depoda",                    bg: "#D1FAE5", fg: "#065F46" },
  ONAYLANDI:      { label: "Onaylandı",                 bg: "#D1FAE5", fg: "#065F46" },
  REDDEDILDI:     { label: "Reddedildi",                bg: "#FEE2E2", fg: "#991B1B" },
};

const BOLGELER = ["İzmir","İstanbul","Ankara","Bursa","Antalya","Adana","Samsun","Trabzon","Erzurum","Diyarbakır","Diğer"];
const PROJELER = ["TT","TC","VF","Diğer"];
const BIRIMLER = ["Adet","Metre","Rulo","Kutu","Paket","Kg","Lt","Takım","Diğer"];

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

const emptyKalem = () => ({ malzeme_adi: "", miktar: 1, birim: "Adet", notlar: "" });
const emptyForm  = (user) => ({
  bolge: "", proje: "", site_id: "", notlar: "",
  talep_eden_ad: user?.name || user?.email || "",
  talep_eden_email: user?.email || "",
  talep_tarihi: new Date().toISOString().split("T")[0],
});

export default function MalzemeScreen({ user, navigation }) {
  const [talepler, setTalepler]           = useState([]);
  const [loading, setLoading]             = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [tab, setTab]                     = useState("bekleyen");
  const [detay, setDetay]                 = useState(null);
  const [detayKalemler, setDetayKalemler] = useState([]);
  const [detayLoading, setDetayLoading]   = useState(false);
  const [saving, setSaving]               = useState(false);
  const [onayNotu, setOnayNotu]           = useState("");
  const [showModal, setShowModal]         = useState(false);

  // ── YENİ TALEP FORMU ──
  const [showYeniForm, setShowYeniForm]   = useState(false);
  const [editingId, setEditingId]         = useState(null);
  const [yeniForm, setYeniForm]           = useState(() => emptyForm(user));
  const [yeniKalemler, setYeniKalemler]   = useState([emptyKalem()]);
  const [savingYeni, setSavingYeni]       = useState(false);
  const [bolgePicker, setBolgePicker]     = useState(false);
  const [projePicker, setProjectPicker]   = useState(false);

  const isPM = (user?.role || "").toLowerCase() === "pm" ||
               (user?.email || "").toLowerCase() === "orhan.bedir@simsektel.com";

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
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

  // Yeni talep formunu sıfırla ve aç
  const openYeniForm = () => {
    setYeniForm(emptyForm(user));
    setYeniKalemler([emptyKalem()]);
    setEditingId(null);
    setShowYeniForm(true);
  };

  // Taslağı düzenlemek için aç
  const openDuzenle = async (item) => {
    try {
      const data = await apiGet(`/malzeme/talepler/${item.id}`);
      setYeniForm({
        bolge: data.bolge || "", proje: data.proje || "",
        site_id: data.site_id || "", notlar: data.notlar || "",
        talep_eden_ad: data.talep_eden_ad || "",
        talep_eden_email: data.talep_eden_email || "",
        talep_tarihi: data.talep_tarihi ? data.talep_tarihi.split("T")[0] : new Date().toISOString().split("T")[0],
      });
      setYeniKalemler(data.kalemler?.length ? data.kalemler : [emptyKalem()]);
      setEditingId(item.id);
      setShowYeniForm(true);
    } catch (_) { Alert.alert("Hata", "Talep yüklenemedi."); }
  };

  const saveTalep = async (durum) => {
    const kalemlerDolu = yeniKalemler.filter(k => k.malzeme_adi.trim());
    if (!kalemlerDolu.length) {
      Alert.alert("Eksik Bilgi", "En az bir malzeme kalemi girin.");
      return;
    }
    setSavingYeni(true);
    try {
      const body = {
        ...yeniForm, durum,
        kalemler: kalemlerDolu.map(k => ({
          ...k,
          birim_fiyat: k.birim_fiyat || 0,
          toplam_tutar: (Number(k.miktar) || 0) * (Number(k.birim_fiyat) || 0),
        })),
      };
      if (editingId) {
        await apiPut(`/malzeme/talepler/${editingId}`, body);
      } else {
        await apiPost("/malzeme/talepler", body, true);
      }
      setShowYeniForm(false);
      load();
      Alert.alert("Tamam", durum === "TASLAK" ? "Taslak kaydedildi." : "Talep onaya gönderildi.");
    } catch (e) {
      Alert.alert("Hata", e.message || "Bir hata oluştu.");
    }
    setSavingYeni(false);
  };

  const handleSil = (id) => {
    Alert.alert("Talebi Sil", "Bu talebi silmek istediğinize emin misiniz?", [
      { text: "Vazgeç", style: "cancel" },
      { text: "Sil", style: "destructive", onPress: async () => {
        try {
          const { apiDelete } = await import("../api");
          await apiDelete(`/malzeme/talepler/${id}`);
          load();
        } catch (e) { Alert.alert("Hata", e.message); }
      }},
    ]);
  };

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

  const bekleyen  = isPM
    ? talepler.filter(t => t.durum === "PM_ONAY")
    : talepler.filter(t => !["DEPODA","REDDEDILDI","ONAYLANDI"].includes(t.durum));
  const displayed = tab === "bekleyen" ? bekleyen : talepler;

  // ── KALEM GÜNCELLEME HELPER ──
  const updateKalem = (idx, field, val) => {
    setYeniKalemler(prev => prev.map((k, i) => i === idx ? { ...k, [field]: val } : k));
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backTxt}>{"‹"}</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Malzeme Yönetimi</Text>
          <Text style={styles.headerSub}>{isPM ? "Talep Onay Paneli" : "Malzeme Taleplerim"}</Text>
        </View>
        {/* + Yeni Talep butonu */}
        <TouchableOpacity onPress={openYeniForm} style={styles.newBtn}>
          <Text style={styles.newBtnTxt}>＋ Yeni Talep</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, tab === "bekleyen" && styles.tabActive]}
          onPress={() => setTab("bekleyen")}
        >
          <Text style={[styles.tabTxt, tab === "bekleyen" && styles.tabTxtActive]}>
            {isPM ? "Bekleyen" : "Aktif"} {bekleyen.length > 0 ? `(${bekleyen.length})` : ""}
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
              <Text style={styles.emptyIcon}>{"📋"}</Text>
              <Text style={styles.emptyTxt}>
                {tab === "bekleyen" ? "Aktif talep yok." : "Talep bulunamadı."}
              </Text>
              <TouchableOpacity onPress={openYeniForm} style={styles.emptyNewBtn}>
                <Text style={styles.emptyNewBtnTxt}>＋ Yeni Talep Oluştur</Text>
              </TouchableOpacity>
            </View>
          ) : (
            displayed.map((item, idx) => (
              <TouchableOpacity
                key={item.id || idx}
                style={[styles.card, item.durum === "REDDEDILDI" && { borderLeftWidth: 3, borderLeftColor: "#DC2626" }]}
                onPress={() => openDetay(item)}
                activeOpacity={0.75}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.cardNo}>{item.talep_no || "—"}</Text>
                  {badge(item.durum)}
                </View>
                {isPM && <Text style={styles.cardAd} numberOfLines={1}>{item.talep_eden_ad || "—"}</Text>}
                {(item.bolge || item.proje || item.site_id) && (
                  <Text style={styles.cardSub} numberOfLines={1}>
                    {[item.bolge, item.proje, item.site_id].filter(Boolean).join(" · ")}
                  </Text>
                )}
                <View style={styles.cardFooter}>
                  <Text style={styles.cardKalem}>
                    {item.kalem_sayisi || 0} kalem
                  </Text>
                  <Text style={styles.cardDate}>{fmtDate(item.created_at)}</Text>
                </View>
                {item.durum === "REDDEDILDI" && item.red_notu && (
                  <View style={{ backgroundColor: "#FEE2E2", borderRadius: 6, padding: 6, marginTop: 6 }}>
                    <Text style={{ fontSize: 12, color: "#991B1B" }}>❌ {item.red_notu}</Text>
                  </View>
                )}
                {/* Taslak için düzenle/sil */}
                {item.durum === "TASLAK" && (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                    <TouchableOpacity onPress={(e) => { e.stopPropagation && e.stopPropagation(); openDuzenle(item); }}
                      style={{ backgroundColor: "#EFF6FF", borderRadius: 7, paddingHorizontal: 12, paddingVertical: 6 }}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: "#1D4ED8" }}>✏️ Düzenle</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={(e) => { e.stopPropagation && e.stopPropagation(); handleSil(item.id); }}
                      style={{ backgroundColor: "#FEE2E2", borderRadius: 7, paddingHorizontal: 12, paddingVertical: 6 }}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: "#DC2626" }}>🗑 Sil</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}

      {/* ── DETAY MODAL (PM Onay) ── */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
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
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 8 }}>
                {detay && badge(detay.durum)}
                {detay?.created_at && (
                  <Text style={{ fontSize: 12, color: "#6B7280" }}>{fmtDate(detay.created_at)}</Text>
                )}
              </View>

              <View style={styles.infoGrid}>
                {[
                  ["Bölge", detay?.bolge],
                  ["Proje", detay?.proje],
                  ["Site ID", detay?.site_id],
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
                  <View style={styles.actionRow}>
                    <TouchableOpacity style={[styles.rejectBtn, saving && { opacity: 0.5 }]} onPress={handleReddet} disabled={saving}>
                      <Text style={styles.rejectBtnTxt}>✗ Reddet</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.approveBtn, saving && { opacity: 0.5 }]} onPress={handleOnayla} disabled={saving}>
                      {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.approveBtnTxt}>✓ Onayla</Text>}
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── YENİ TALEP FORMU MODAL ── */}
      <Modal visible={showYeniForm} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: "#F8FAFC" }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            {/* Form Header */}
            <View style={[styles.modalHeader, { backgroundColor: DARK }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{editingId ? "Talebi Düzenle" : "Yeni Malzeme Talebi"}</Text>
                <Text style={styles.modalSub}>📦 Malzeme talep formu</Text>
              </View>
              <TouchableOpacity onPress={() => setShowYeniForm(false)}>
                <Text style={styles.modalClose}>{"✕"}</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>

              {/* Bölge & Proje */}
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.formLabel}>Bölge</Text>
                  <TouchableOpacity onPress={() => setBolgePicker(true)}
                    style={[styles.selectBtn, yeniForm.bolge && styles.selectBtnActive]}>
                    <Text style={[styles.selectBtnTxt, yeniForm.bolge && { color: "#1F2937" }]}>
                      {yeniForm.bolge || "Seçin…"}
                    </Text>
                    <Text style={{ fontSize: 12, color: "#9CA3AF" }}>▼</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.formLabel}>Proje</Text>
                  <TouchableOpacity onPress={() => setProjectPicker(true)}
                    style={[styles.selectBtn, yeniForm.proje && styles.selectBtnActive]}>
                    <Text style={[styles.selectBtnTxt, yeniForm.proje && { color: "#1F2937" }]}>
                      {yeniForm.proje || "Seçin…"}
                    </Text>
                    <Text style={{ fontSize: 12, color: "#9CA3AF" }}>▼</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Site ID */}
              <View style={{ marginBottom: 14 }}>
                <Text style={styles.formLabel}>Site ID</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="Örn: TR_IST_001"
                  placeholderTextColor="#9CA3AF"
                  value={yeniForm.site_id}
                  onChangeText={v => setYeniForm(p => ({ ...p, site_id: v }))}
                  autoCapitalize="characters"
                />
              </View>

              {/* Malzeme Kalemleri */}
              <View style={{ marginBottom: 14 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <Text style={[styles.formLabel, { marginBottom: 0, fontSize: 14 }]}>📦 Malzeme Kalemleri</Text>
                  <TouchableOpacity onPress={() => setYeniKalemler(p => [...p, emptyKalem()])}
                    style={{ backgroundColor: "#F0FDF4", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: "#BBF7D0" }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: "#15803D" }}>+ Kalem Ekle</Text>
                  </TouchableOpacity>
                </View>

                {yeniKalemler.map((k, i) => (
                  <View key={i} style={styles.kalemCard}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: "#6B7280" }}>Kalem {i + 1}</Text>
                      {yeniKalemler.length > 1 && (
                        <TouchableOpacity onPress={() => setYeniKalemler(p => p.filter((_, idx) => idx !== i))}>
                          <Text style={{ fontSize: 20, color: "#DC2626", lineHeight: 22 }}>✕</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <TextInput
                      style={[styles.formInput, { marginBottom: 8 }]}
                      placeholder="Malzeme adı *"
                      placeholderTextColor="#9CA3AF"
                      value={k.malzeme_adi}
                      onChangeText={v => updateKalem(i, "malzeme_adi", v)}
                    />
                    <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.formLabel, { fontSize: 11 }]}>Miktar</Text>
                        <TextInput
                          style={styles.formInput}
                          placeholder="1"
                          placeholderTextColor="#9CA3AF"
                          value={String(k.miktar)}
                          onChangeText={v => updateKalem(i, "miktar", Number(v) || 1)}
                          keyboardType="numeric"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.formLabel, { fontSize: 11 }]}>Birim</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}
                          style={{ marginTop: 0 }} contentContainerStyle={{ gap: 6, paddingTop: 2 }}>
                          {BIRIMLER.map(b => (
                            <TouchableOpacity key={b} onPress={() => updateKalem(i, "birim", b)}
                              style={{ backgroundColor: k.birim === b ? DARK : "#F3F4F6", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8 }}>
                              <Text style={{ fontSize: 12, fontWeight: "700", color: k.birim === b ? "#fff" : "#374151" }}>{b}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    </View>
                    <TextInput
                      style={[styles.formInput, { color: "#6B7280" }]}
                      placeholder="Not (isteğe bağlı)"
                      placeholderTextColor="#9CA3AF"
                      value={k.notlar || ""}
                      onChangeText={v => updateKalem(i, "notlar", v)}
                    />
                  </View>
                ))}
              </View>

              {/* Genel Not */}
              <View style={{ marginBottom: 24 }}>
                <Text style={styles.formLabel}>💬 Açıklama / Not</Text>
                <TextInput
                  style={[styles.formInput, { minHeight: 80, textAlignVertical: "top" }]}
                  placeholder="Talep ile ilgili açıklama…"
                  placeholderTextColor="#9CA3AF"
                  value={yeniForm.notlar}
                  onChangeText={v => setYeniForm(p => ({ ...p, notlar: v }))}
                  multiline
                  numberOfLines={3}
                />
              </View>

              {/* Butonlar */}
              <TouchableOpacity
                style={[styles.approveBtn, { marginBottom: 10, opacity: savingYeni ? 0.6 : 1 }]}
                onPress={() => saveTalep("ROLLOUT_BEKLE")}
                disabled={savingYeni}
              >
                {savingYeni
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.approveBtnTxt}>📤 Onaya Gönder</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.draftBtn, { opacity: savingYeni ? 0.6 : 1 }]}
                onPress={() => saveTalep("TASLAK")}
                disabled={savingYeni}
              >
                <Text style={styles.draftBtnTxt}>💾 Taslak Olarak Kaydet</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>

          {/* Bölge Picker */}
          <Modal visible={bolgePicker} transparent animationType="fade">
            <TouchableOpacity style={styles.pickerOverlay} onPress={() => setBolgePicker(false)} activeOpacity={1}>
              <View style={styles.pickerBox}>
                <Text style={styles.pickerTitle}>Bölge Seçin</Text>
                {BOLGELER.map(b => (
                  <TouchableOpacity key={b} onPress={() => { setYeniForm(p => ({ ...p, bolge: b })); setBolgePicker(false); }}
                    style={[styles.pickerItem, yeniForm.bolge === b && styles.pickerItemActive]}>
                    <Text style={[styles.pickerItemTxt, yeniForm.bolge === b && styles.pickerItemTxtActive]}>{b}</Text>
                    {yeniForm.bolge === b && <Text style={{ color: BLUE, fontWeight: "800" }}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableOpacity>
          </Modal>

          {/* Proje Picker */}
          <Modal visible={projePicker} transparent animationType="fade">
            <TouchableOpacity style={styles.pickerOverlay} onPress={() => setProjectPicker(false)} activeOpacity={1}>
              <View style={styles.pickerBox}>
                <Text style={styles.pickerTitle}>Proje Seçin</Text>
                {PROJELER.map(b => (
                  <TouchableOpacity key={b} onPress={() => { setYeniForm(p => ({ ...p, proje: b })); setProjectPicker(false); }}
                    style={[styles.pickerItem, yeniForm.proje === b && styles.pickerItemActive]}>
                    <Text style={[styles.pickerItemTxt, yeniForm.proje === b && styles.pickerItemTxtActive]}>{b}</Text>
                    {yeniForm.proje === b && <Text style={{ color: BLUE, fontWeight: "800" }}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableOpacity>
          </Modal>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: LIGHT },
  centered:         { flex: 1, justifyContent: "center", alignItems: "center" },
  header:           { backgroundColor: DARK, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14 },
  backBtn:          { marginRight: 12, padding: 4 },
  backTxt:          { fontSize: 28, color: "#fff", lineHeight: 30 },
  headerTitle:      { fontSize: 18, fontWeight: "800", color: "#fff" },
  headerSub:        { fontSize: 12, color: "#93C5FD", marginTop: 1 },
  newBtn:           { backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
  newBtnTxt:        { fontSize: 13, fontWeight: "700", color: "#fff" },
  tabRow:           { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tab:              { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive:        { borderBottomWidth: 2, borderBottomColor: BLUE },
  tabTxt:           { fontSize: 13, fontWeight: "600", color: "#6B7280" },
  tabTxtActive:     { color: BLUE },
  emptyBox:         { alignItems: "center", paddingVertical: 48 },
  emptyIcon:        { fontSize: 40, marginBottom: 8 },
  emptyTxt:         { fontSize: 14, color: "#9CA3AF", marginBottom: 16 },
  emptyNewBtn:      { backgroundColor: DARK, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
  emptyNewBtnTxt:   { fontSize: 14, fontWeight: "700", color: "#fff" },
  card:             { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardTop:          { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  cardNo:           { fontSize: 15, fontWeight: "800", color: DARK },
  cardAd:           { fontSize: 13, color: "#374151", fontWeight: "600", marginBottom: 2 },
  cardSub:          { fontSize: 12, color: "#6B7280", marginBottom: 6 },
  cardFooter:       { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  cardKalem:        { fontSize: 12, color: "#6B7280" },
  cardDate:         { fontSize: 12, color: "#9CA3AF" },
  // Modal
  modalSafe:        { flex: 1, backgroundColor: "#fff" },
  modalHeader:      { flexDirection: "row", alignItems: "flex-start", padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB", backgroundColor: DARK },
  modalTitle:       { fontSize: 18, fontWeight: "800", color: "#fff" },
  modalSub:         { fontSize: 12, color: "#93C5FD", marginTop: 2 },
  modalClose:       { fontSize: 22, color: "#93C5FD", padding: 4 },
  infoGrid:         { flexDirection: "row", flexWrap: "wrap", backgroundColor: "#F9FAFB", borderRadius: 10, padding: 12, marginBottom: 12, gap: 10 },
  infoItem:         { width: "47%" },
  infoLabel:        { fontSize: 11, color: "#9CA3AF", fontWeight: "700", textTransform: "uppercase", marginBottom: 2 },
  infoVal:          { fontSize: 13, color: "#1F2937", fontWeight: "600" },
  notBox:           { backgroundColor: "#FFFBEB", borderRadius: 8, padding: 10, marginBottom: 12 },
  notTxt:           { fontSize: 13, color: "#92400E" },
  sectionTitle:     { fontSize: 13, fontWeight: "800", color: "#374151", textTransform: "uppercase", marginBottom: 8, marginTop: 12, letterSpacing: 0.5 },
  kalemRow:         { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  kalemAdi:         { fontSize: 14, fontWeight: "600", color: "#1F2937", marginBottom: 2 },
  kalemNot:         { fontSize: 12, color: "#6B7280" },
  kalemMiktar:      { fontSize: 14, fontWeight: "700", color: DARK },
  kalemFiyat:       { fontSize: 11, color: "#6B7280", marginTop: 2 },
  noteInput:        { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, padding: 12, fontSize: 14, color: "#1F2937", minHeight: 80, textAlignVertical: "top", backgroundColor: "#FAFAFA", marginBottom: 16 },
  actionRow:        { flexDirection: "row", gap: 10, marginTop: 4 },
  rejectBtn:        { flex: 1, backgroundColor: "#FEE2E2", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  rejectBtnTxt:     { fontSize: 15, fontWeight: "800", color: "#991B1B" },
  approveBtn:       { backgroundColor: BLUE, borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  approveBtnTxt:    { fontSize: 15, fontWeight: "800", color: "#fff" },
  draftBtn:         { backgroundColor: "#F3F4F6", borderRadius: 10, paddingVertical: 14, alignItems: "center", borderWidth: 1.5, borderColor: "#D1D5DB" },
  draftBtnTxt:      { fontSize: 14, fontWeight: "700", color: "#374151" },
  // Form
  formLabel:        { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 },
  formInput:        { borderWidth: 1.5, borderColor: "#D1D5DB", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: "#1F2937", backgroundColor: "#fff" },
  selectBtn:        { borderWidth: 1.5, borderColor: "#D1D5DB", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: "#fff", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  selectBtnActive:  { borderColor: BLUE, backgroundColor: "#EFF6FF" },
  selectBtnTxt:     { fontSize: 15, color: "#9CA3AF" },
  kalemCard:        { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  // Picker
  pickerOverlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 32 },
  pickerBox:        { backgroundColor: "#fff", borderRadius: 16, overflow: "hidden" },
  pickerTitle:      { fontSize: 15, fontWeight: "800", color: DARK, padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  pickerItem:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  pickerItemActive: { backgroundColor: "#EFF6FF" },
  pickerItemTxt:    { fontSize: 15, color: "#374151" },
  pickerItemTxtActive: { fontWeight: "700", color: BLUE },
});
