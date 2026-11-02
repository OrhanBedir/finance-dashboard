import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  SafeAreaView, Alert, ActivityIndicator, KeyboardAvoidingView,
  Platform, Modal, Image,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import FisKirpma from "../components/FisKirpma";
import FisIsleme from "../components/FisIsleme";
import AkisAdim from "../components/AkisAdim";
import { apiGet, apiPost, apiPut, apiDelete, apiIstek, API_BASE } from "../api";
import { tutarOku } from "../sayi";

// ─── Category definitions (same as PC) ───────────────────────────────────────
const MASRAF_KATEGORILER = [
  { key: "YEMEK",      label: "🍽 Yiyecek / İçecek",      aciklamaPlaceholder: "Proje veya iş adı",               belgeAciklamaPlaceholder: "Restoran adı, Kafe, Yemek faturası..." },
  { key: "YAKIT",      label: "⛽ Araç Yakıt / Bakım",     aciklamaPlaceholder: "Araç plaka no",                   belgeAciklamaPlaceholder: "Yakıt Bedeli, Bakım Faturası..." },
  { key: "KONAKLAMA",  label: "🏨 Konaklama",              aciklamaPlaceholder: "Kaç gece, kişi sayısı, otel adı", belgeAciklamaPlaceholder: "Otel Faturası, Konaklama Makbuzu..." },
  { key: "ULASIM",     label: "🚌 Ulaşım",                 aciklamaPlaceholder: "Güzergah, kişi sayısı, neden",    belgeAciklamaPlaceholder: "Uçak Bileti, Otobüs / Taksi Fişi..." },
  { key: "KOPRU",      label: "🛣 Köprü / Otoyol Geçişi",  aciklamaPlaceholder: "Geçiş detayı, plaka",             belgeAciklamaPlaceholder: "HGS/OGS Dekont, Geçiş Makbuzu..." },
  { key: "MALZEME",    label: "🔧 Malzeme / Ekipman",      aciklamaPlaceholder: "Malzeme adı ve detayı",           belgeAciklamaPlaceholder: "Fatura / İrsaliye No...",              hasSiteId: true },
  { key: "DIGER",      label: "📦 Diğer",                  aciklamaPlaceholder: "İşin detayı",                     belgeAciklamaPlaceholder: "Fiş / Fatura Açıklaması..." },
  { key: "TRAFIK_CEZA",label: "🚔 Trafik Cezası",         aciklamaPlaceholder: "Ceza detayı",                     belgeAciklamaPlaceholder: "Ceza belgesi açıklaması...",           isTrafikCeza: true },
];

const MONTHS = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran",
                "Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];

const EMPTY_KALEM = { tarih: new Date(), belge_no: "", belge_aciklama: "", aciklama: "", tutar: "", site_id: "", plaka: "", ceza_personel_id: "" };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(d) {
  if (!(d instanceof Date)) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function toISODate(d) {
  if (!(d instanceof Date)) return new Date().toISOString().split("T")[0];
  return d.toISOString().split("T")[0];
}
function formatTL(n) {
  return Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
}

// ─── Date picker modal ────────────────────────────────────────────────────────
function DatePickerModal({ visible, value, onChange, onClose }) {
  const [d, setD] = useState(value instanceof Date ? value : new Date());
  const adjust = (field, delta) => {
    const nd = new Date(d);
    if (field === "day")   nd.setDate(nd.getDate() + delta);
    if (field === "month") nd.setMonth(nd.getMonth() + delta);
    if (field === "year")  nd.setFullYear(nd.getFullYear() + delta);
    setD(nd);
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={st.modalOverlay}>
        <View style={[st.modalSheet, { maxHeight: 300 }]}>
          <View style={st.modalHeader}>
            <Text style={st.modalTitle}>Tarih Seç</Text>
            <TouchableOpacity onPress={onClose}><Text style={st.modalClose}>✕</Text></TouchableOpacity>
          </View>
          <View style={st.dateRow}>
            {[
              { field: "day",   val: d.getDate(),           label: "Gün" },
              { field: "month", val: MONTHS[d.getMonth()],  label: "Ay",  small: true },
              { field: "year",  val: d.getFullYear(),        label: "Yıl" },
            ].map((item, idx) => (
              <React.Fragment key={item.field}>
                {idx > 0 && <Text style={st.dateSep}>/</Text>}
                <View style={st.dateUnit}>
                  <TouchableOpacity onPress={() => adjust(item.field, 1)} style={st.dateArrow}><Text style={st.dateArrowTxt}>▲</Text></TouchableOpacity>
                  <Text style={[st.dateVal, item.small && { fontSize: 14 }]}>{item.val}</Text>
                  <TouchableOpacity onPress={() => adjust(item.field, -1)} style={st.dateArrow}><Text style={st.dateArrowTxt}>▼</Text></TouchableOpacity>
                  <Text style={st.dateUnitLbl}>{item.label}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>
          <TouchableOpacity style={st.confirmBtn} onPress={() => { onChange(d); onClose(); }}>
            <Text style={st.confirmBtnTxt}>Tamam</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Picker modal ─────────────────────────────────────────────────────────────
function PickerModal({ visible, title, options, value, onSelect, onClose, getLabel }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={st.modalOverlay} activeOpacity={1} onPress={onClose}>
        <View style={st.modalSheet}>
          <View style={st.modalHeader}>
            <Text style={st.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose}><Text style={st.modalClose}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView bounces={false}>
            {options.map((opt) => {
              const lbl = getLabel ? getLabel(opt) : opt;
              const selected = value === (opt?.id ? String(opt.id) : opt);
              return (
                <TouchableOpacity key={opt?.id ?? opt} style={[st.optionRow, selected && st.optionRowActive]}
                  onPress={() => { onSelect(opt); onClose(); }}>
                  <Text style={[st.optionText, selected && st.optionTextActive]}>{lbl}</Text>
                  {selected && <Text style={st.checkmark}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// 24.10.2026: fişin kırpma durumu (web fiş görüntüleyicisiyle aynı etiketler)
const KIRPMA_ETIKET = { OTOMATIK: "✂️ Otomatik kırpıldı", KULLANICI: "✂️ Kullanıcı düzeltti", KIRPILMADI: "Kırpılmadı (orijinal)",
  MOBIL_ELLE: "✂️ Mobilde elle kırpıldı", DOGRULANAMADI: "Kırpma bilgisi doğrulanamadı" };
const kirpmaEtiketi = (b) => KIRPMA_ETIKET[b?.kirpma_durum] || (b?.kirpildi === true ? "✂️ Mobilde kırpılmış" : b?.kirpildi === false ? "Orijinal (kırpılmadan yüklendi)" : b?.kaynak === "web" ? "Web'den yüklendi (kırpılmadı)" : "Kırpma bilgisi yok (eski kayıt)");
const BEKLEYEN_FIS = "fis_bekleyen_v1";

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function MasrafFormScreen({ navigation, user }) {
  const [activeForm, setActiveForm]       = useState(null);
  const [kalemler, setKalemler]           = useState([]);
  const [openKats, setOpenKats]           = useState(new Set());
  const [addingKat, setAddingKat]         = useState(null);
  const [kalemForm, setKalemForm]         = useState({ ...EMPTY_KALEM });
  const [personelList, setPersonelList]   = useState([]);
  const [initializing, setInitializing]   = useState(true);
  const [submitting, setSubmitting]       = useState(false);

  // Photo / OCR flow
  const [fotoModal, setFotoModal]         = useState(null);  // { kalemId, kategori, tutar }
  const [ocrResult, setOcrResult]         = useState(null);
  const [fisGor, setFisGor]               = useState(null);   // eklenmiş fişi tam ekran gösterir
  const [fisOlmadan, setFisOlmadan]       = useState("");
  const [tutarAciklama, setTutarAciklama] = useState("");
  const [addingKalem, setAddingKalem]     = useState(false);

  // Sub-pickers
  const [datePicker, setDatePicker]       = useState(false);
  const [personelPicker, setPersonelPicker] = useState(false);

  const setKF = (key, val) => setKalemForm((f) => ({ ...f, [key]: val }));

  // ── Initialization: create form + load personel ──────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [formRes, personelRes] = await Promise.all([
          apiPost("/hr/masraf-form", {
            talep_eden_email: user?.email || "",
            talep_eden_ad:    user?.name  || "",
            donem: new Date().toISOString().slice(0, 7),
          }, true),
          apiGet("/hr/personel"),
        ]);
        if (formRes?.id) {
          setActiveForm(formRes);
          setKalemler(formRes.kalemler || []);
          // 24.10.2026: bağlantı/servis hatası ya da uygulama kapanması yüzünden eklenemeyen fiş fotoğrafı
          const bek = JSON.parse((await AsyncStorage.getItem(BEKLEYEN_FIS).catch(() => null)) || "null");
          const kalem = bek && bek.formId === formRes.id && Date.now() - bek.t < 24 * 3600e3 && (formRes.kalemler || []).find((k) => k.id === bek.kalemId);
          if (kalem) {
            Alert.alert("Yarım kalan fiş", "Daha önce çektiğiniz fiş fotoğrafı henüz masrafa eklenmedi. Şimdi işlensin mi?", [
              { text: "Sil", style: "destructive", onPress: () => AsyncStorage.removeItem(BEKLEYEN_FIS).catch(() => {}) },
              { text: "Devam", onPress: () => { setFotoModal({ kalemId: bek.kalemId, kategori: bek.kategori, tutar: bek.tutar }); fisIsle(bek.foto, bek.kalemId); } },
            ]);
          } else if (bek) AsyncStorage.removeItem(BEKLEYEN_FIS).catch(() => {});
        }
        if (Array.isArray(personelRes)) setPersonelList(personelRes.filter(p => p.aktif));
      } catch (e) {
        Alert.alert("Hata", "Form oluşturulamadı. İnternet bağlantınızı kontrol edin.");
      } finally {
        setInitializing(false);
      }
    })();
  }, []);

  const refreshForm = async (id) => {
    const data = await apiGet(`/hr/masraf-form/${id}`);
    if (data?.id) {
      setActiveForm(data);
      setKalemler(data.kalemler || []);
    }
  };

  const toggleKat = (key) => {
    setOpenKats((prev) => {
      const s = new Set(prev);
      s.has(key) ? s.delete(key) : s.add(key);
      return s;
    });
  };

  const startAdding = (katKey) => {
    setKalemForm({ ...EMPTY_KALEM });
    setAddingKat(katKey);
    setOpenKats((prev) => { const s = new Set(prev); s.add(katKey); return s; });
  };

  const cancelAdding = () => { setAddingKat(null); };

  // ── Add kalem ─────────────────────────────────────────────────────────────
  const handleAddKalem = async () => {
    const tutar = tutarOku(kalemForm.tutar);   // "282,5" gibi virgüllü tutar da geçerli
    if (Number.isNaN(tutar)) {
      Alert.alert("Eksik Alan", "Geçerli bir tutar giriniz.");
      return;
    }
    if (!activeForm?.id) return;
    setAddingKalem(true);
    try {
      const saved = await apiPost("/hr/masraf-kalem", {
        form_id:         activeForm.id,
        kategori:        addingKat,
        tarih:           toISODate(kalemForm.tarih),
        belge_no:        kalemForm.belge_no.trim() || null,
        belge_aciklama:  kalemForm.belge_aciklama.trim() || null,
        aciklama:        kalemForm.site_id
                           ? `Site ID: ${kalemForm.site_id}${kalemForm.aciklama ? " | " + kalemForm.aciklama : ""}`
                           : kalemForm.aciklama.trim() || null,
        tutar:           tutar,
        plaka:           kalemForm.plaka.trim().toUpperCase() || null,
        ceza_personel_id: kalemForm.ceza_personel_id || null,
        fis_var:         true,
      }, true);
      if (saved?.id) {
        setFotoModal({ kalemId: saved.id, kategori: addingKat, tutar });
        setOcrResult(null);
        setFisOlmadan("");
        setTutarAciklama("");
        setAddingKat(null);
        refreshForm(activeForm.id);
      } else {
        Alert.alert("Hata", saved?.error || "Kalem eklenemedi.");
      }
    } catch (e) {
      Alert.alert("Bağlantı Hatası", "Sunucuya ulaşılamadı.");
    } finally {
      setAddingKalem(false);
    }
  };

  // ── Delete kalem ──────────────────────────────────────────────────────────
  const handleDeleteKalem = (kid) => {
    Alert.alert("Kalem Sil", "Bu kalemi silmek istediğinize emin misiniz?", [
      { text: "Vazgeç", style: "cancel" },
      { text: "Sil", style: "destructive", onPress: async () => {
        await apiDelete(`/hr/masraf-kalem/${kid}`);
        refreshForm(activeForm.id);
      }},
    ]);
  };

  // ── Photo upload flow ─────────────────────────────────────────────────────
  // 24.10.2026 (Orhan): OTOMATİK FİŞ KIRPMA. Çekilen/seçilen fotoğraf hemen sunucuya gider; sunucu fişi
  // (yapay zekâ + klasik görüntü işleme) bulur, kırpılmış önizleme(ler) döner — henüz ek oluşmaz. Kullanıcı
  // onaylayınca ya da köşeleri düzeltince sunucu orijinalden kırpıp ek yapar. Fotoğraf yarım kalırsa
  // AsyncStorage'da tutulur (bağlantı/servis hatasında kaybolmaz); tekrar denemede aynı istek kimliği gider.
  const [fisIs, setFisIs] = useState(null);         // { foto, kalemId, asama, sonuc, hata, ekleHata, bekleyenEk }
  const [duzeltme, setDuzeltme] = useState(null);   // { aday } — köşe düzeltme / elle kırpma ekranı
  const fisIsRef = useRef(null);
  fisIsRef.current = fisIs;

  const closeFotoModal = () => {
    setFotoModal(null);
    setOcrResult(null);
    setFisOlmadan("");
    setTutarAciklama("");
    setFisIs(null);
    setDuzeltme(null);
  };

  const pickAndUpload = async (fromCamera) => {
    // Request permission
    const { status } = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("İzin Gerekli", fromCamera ? "Kamera erişimi gerekiyor." : "Galeri erişimi gerekiyor.");
      return;
    }
    // Sistem kırpması KAPALI (iOS'ta zorunlu kare — uzun fişin altı kesiliyordu); kırpma sunucuda yapılır.
    const secenek = { mediaTypes: "images", quality: 0.9, allowsEditing: false };
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync(secenek)
      : await ImagePicker.launchImageLibraryAsync(secenek);

    if (result.canceled || !result.assets?.[0]) return;
    const foto = result.assets[0].uri;
    AsyncStorage.setItem(BEKLEYEN_FIS, JSON.stringify({ formId: activeForm?.id, kalemId: fotoModal.kalemId,
      kategori: fotoModal.kategori, tutar: fotoModal.tutar, foto, t: Date.now() })).catch(() => {});
    fisIsle(foto, fotoModal.kalemId);
  };

  // Fotoğrafı sunucuda işlet (aynı fotoğraf tekrar gönderilirse sunucu önceki sonucu döner, model yeniden çalışmaz)
  const fisIsle = async (foto, kalemId) => {
    setDuzeltme(null);
    setFisIs({ foto, kalemId, asama: "isleniyor" });
    const ext = foto.split(".").pop()?.toLowerCase();
    try {
      const sonuc = await apiIstek(`/hr/masraf-belge/${kalemId}/isle`, {
        dosya: { uri: foto, type: ext === "png" ? "image/png" : "image/jpeg", name: foto.split("/").pop() || "fis.jpg" },
      });
      setFisIs({ foto, kalemId, asama: "sonuc", sonuc });
    } catch (e) {
      setFisIs({ foto, kalemId, asama: "hata", hata: e.message });
    }
  };

  const yeniIstekId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

  // Onaylanan seçimleri ek yap. Aynı seçim tekrar denenirse aynı istek kimlikleri gider → çift ek oluşmaz.
  const fisEkle = async (secimler) => {
    const is = fisIsRef.current;
    if (!is?.sonuc) return;
    const anahtar = JSON.stringify(secimler);
    const ek = is.bekleyenEk?.anahtar === anahtar ? is.bekleyenEk : { anahtar, liste: secimler.map((x) => ({ ...x, istek_id: yeniIstekId() })) };
    setFisIs({ ...is, asama: "ekleniyor", bekleyenEk: ek, ekleHata: null });
    try {
      const yanit = await apiIstek(`/hr/masraf-belge/${is.kalemId}`, { body: { isleme_id: is.sonuc.isleme_id, secimler: ek.liste } });
      AsyncStorage.removeItem(BEKLEYEN_FIS).catch(() => {});
      setDuzeltme(null);
      setFisIs(null);
      ocrKontrol(yanit.belgeler || [yanit]);
    } catch (e) {
      setDuzeltme(null);
      // Orijinalin saklama süresi dolmuşsa fotoğraf (telefondaki) yeniden işlenir
      if (e.status === 410) { fisIsle(is.foto, is.kalemId); return; }
      setFisIs({ ...is, asama: "sonuc", bekleyenEk: ek, ekleHata: e.message + (e.ag ? " — aynı düğmeyle tekrar deneyin" : "") });
    }
  };

  const fisKirpmadan = () => Alert.alert("Kırpmadan eklensin mi?", "Fotoğrafın tamamı (fişin çevresiyle birlikte) masrafa eklenecek ve \"Kırpılmadı\" olarak işaretlenecek.", [
    { text: "Vazgeç", style: "cancel" },
    { text: "Kırpmadan ekle", onPress: () => fisEkle([{ kirpma: "yok" }]) },
  ]);
  const fisIptal = () => { setFisIs(null); setDuzeltme(null); AsyncStorage.removeItem(BEKLEYEN_FIS).catch(() => {}); };

  // OCR kontrolü (tutar farkı / plaka) — birden fazla fiş eklendiyse tutarlar toplanır
  const ocrKontrol = (belgeler) => {
    const tutarlar = belgeler.map((b) => (b?.ocr_tutar ? Number(b.ocr_tutar) : null));
    const ocrAmt = tutarlar.length && tutarlar.every((t) => t) ? tutarlar.reduce((a, b) => a + b, 0) : null;
    const entered  = fotoModal?.tutar || 0;
    const mismatch = ocrAmt && entered && Math.abs(ocrAmt - entered) > Math.max(entered * 0.05, 10);
    const plakaB = fotoModal?.kategori === "YAKIT" ? belgeler.find((b) => b?.ocr_plaka && b.ocr_plaka_eslesti === false) : null;
    if (mismatch) {
      setOcrResult({ ocr_tutar: ocrAmt, belgeId: belgeler[0].id, hasTutarUyari: true });
    } else if (plakaB) {
      setOcrResult({ ocr_tutar: plakaB.ocr_tutar ? Number(plakaB.ocr_tutar) : null, ocr_plaka: plakaB.ocr_plaka, ocr_plaka_eslesti: false, belgeId: plakaB.id, hasPlateWarn: true });
    } else {
      closeFotoModal();
      refreshForm(activeForm.id);
    }
  };

  const handleFissiz = async () => {
    if (!fisOlmadan.trim()) { Alert.alert("Açıklama Gerekli", "Neden fiş olmadığını yazınız."); return; }
    await apiPut(`/hr/masraf-kalem/${fotoModal.kalemId}`, { fis_var: false, fis_olmadan_aciklama: fisOlmadan });
    closeFotoModal();
    refreshForm(activeForm.id);
  };

  const handleTutarUyariDevam = async () => {
    if (!tutarAciklama.trim()) { Alert.alert("Açıklama Gerekli", "Tutar farkını açıklayınız."); return; }
    await apiPut(`/hr/masraf-kalem/${fotoModal.kalemId}`, { tutar_uyari_aciklama: tutarAciklama });
    closeFotoModal();
    refreshForm(activeForm.id);
  };

  const handlePlateWarnOk = async () => {
    // Delete the mismatched receipt
    if (ocrResult?.belgeId) await apiDelete(`/hr/masraf-belge/${ocrResult.belgeId}`).catch(() => {});
    closeFotoModal();
    refreshForm(activeForm.id);
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = () => {
    if (kalemler.length === 0) { Alert.alert("Eksik", "En az bir masraf kalemi ekleyiniz."); return; }
    Alert.alert("Onaya Gönder", "Masraf formunu Birim Müdürü onayına göndermek istediğinize emin misiniz?", [
      { text: "Vazgeç", style: "cancel" },
      { text: "Gönder", onPress: async () => {
        setSubmitting(true);
        try {
          await apiPut(`/hr/masraf-form/${activeForm.id}/submit`);
          Alert.alert("Başarılı", "Masraf formu onaya gönderildi.", [
            { text: "Tamam", onPress: () => navigation.goBack() }
          ]);
        } catch {
          Alert.alert("Hata", "Gönderme başarısız.");
        } finally {
          setSubmitting(false);
        }
      }},
    ]);
  };

  const handleSaveDraft = () => {
    Alert.alert("Kaydedildi", "Masraf formu taslak olarak kaydedildi.", [
      { text: "Tamam", onPress: () => navigation.goBack() }
    ]);
  };

  // ── Totals ────────────────────────────────────────────────────────────────
  const totalKalem = kalemler.reduce((s, k) => s + Number(k.tutar || 0), 0);

  // ─────────────────────────────────────────────────────────────────────────
  if (initializing) {
    return (
      <SafeAreaView style={st.safe}>
        <View style={[st.flex, { alignItems: "center", justifyContent: "center" }]}>
          <ActivityIndicator color="#059669" size="large" />
          <Text style={{ marginTop: 12, color: "#6b7280", fontSize: 14 }}>Form hazırlanıyor...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.safe}>
      <KeyboardAvoidingView style={st.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        {/* Header */}
        <View style={st.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
            <Text style={st.backText}>‹ Geri</Text>
          </TouchableOpacity>
          <Text style={st.headerTitle}>Masraf Formu</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Form info bar */}
        <View style={st.infoBar}>
          <Text style={st.infoText}>
            {user?.name || user?.email} · {new Date().toLocaleDateString("tr-TR", { month: "long", year: "numeric" })}
          </Text>
          <Text style={[st.infoText, { fontWeight: "800", color: "#1e3a5f" }]}>
            ₺{formatTL(totalKalem)}
          </Text>
        </View>
        {/* 10.09.2026: formun onayı kimde — personel "nerede kaldı" diye sormasın */}
        {activeForm?.durum ? (
          <View style={{ paddingHorizontal: 16, paddingBottom: 8, backgroundColor: "#fff" }}>
            <AkisAdim durum={activeForm.durum} tip="MASRAF" />
          </View>
        ) : null}

        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">

          {/* Category sections */}
          {MASRAF_KATEGORILER.map((kat) => {
            const katKalemler = kalemler.filter((k) => k.kategori === kat.key);
            const katToplam   = katKalemler.reduce((s, k) => s + Number(k.tutar || 0), 0);
            const isOpen      = openKats.has(kat.key);
            const isAdding    = addingKat === kat.key;

            return (
              <View key={kat.key} style={st.katCard}>
                {/* Category header */}
                <TouchableOpacity style={st.katHeader} onPress={() => toggleKat(kat.key)} activeOpacity={0.85}>
                  <Text style={st.katLabel}>{kat.label.toUpperCase()}</Text>
                  <View style={st.katRight}>
                    {katToplam > 0 && <Text style={st.katToplam}>₺{formatTL(katToplam)}</Text>}
                    {katKalemler.length > 0 && (
                      <View style={st.katBadge}><Text style={st.katBadgeTxt}>{katKalemler.length}</Text></View>
                    )}
                    <Text style={st.katArrow}>{isOpen || isAdding ? "▲" : "▼"}</Text>
                  </View>
                </TouchableOpacity>

                {/* Existing items */}
                {(isOpen || isAdding) && katKalemler.map((k) => (
                  <View key={k.id} style={[st.kalemRow, !k.fis_var && st.kalemRowNoFis]}>
                    <View style={st.kalemRowLeft}>
                      <Text style={st.kalemTarih}>{k.tarih ? new Date(k.tarih).toLocaleDateString("tr-TR") : ""}{k.belge_no ? ` · #${k.belge_no}` : ""}</Text>
                      {k.belge_aciklama ? <Text style={st.kalemAciklama}>{k.belge_aciklama}</Text> : null}
                      {k.aciklama ? <Text style={st.kalemAciklamaGray}>{k.aciklama}</Text> : null}
                      {!k.fis_var && <Text style={st.kalemNoFis}>⚠ Fişsiz: {k.fis_olmadan_aciklama}</Text>}
                      {(k.belgeler?.length > 0) && (
                        <View style={st.fisSatir}>
                          {k.belgeler.filter((b) => String(b.dosya_yolu || "").startsWith("http")).map((b) => (
                            <TouchableOpacity key={b.id} onPress={() => setFisGor(b)}>
                              <Image source={{ uri: b.dosya_yolu }} style={st.fisKucuk} />
                            </TouchableOpacity>
                          ))}
                          <Text style={st.kalemFis}>📷 {k.belgeler.length} fiş · {[...new Set(k.belgeler.map(kirpmaEtiketi))].join(" / ")}</Text>
                        </View>
                      )}
                    </View>
                    <View style={st.kalemRowRight}>
                      <Text style={st.kalemTutar}>₺{formatTL(k.tutar)}</Text>
                      <View style={st.kalemBtns}>
                        <TouchableOpacity style={st.miniBtn} onPress={() => {
                          setFotoModal({ kalemId: k.id, kategori: k.kategori, tutar: Number(k.tutar) });
                          setOcrResult(null); setFisOlmadan(""); setTutarAciklama("");
                        }}>
                          <Text style={st.miniBtnTxt}>📷</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[st.miniBtn, st.miniBtnRed]} onPress={() => handleDeleteKalem(k.id)}>
                          <Text style={st.miniBtnTxt}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ))}

                {/* Empty state */}
                {(isOpen || isAdding) && katKalemler.length === 0 && !isAdding && (
                  <Text style={st.emptyKat}>Henüz kayıt yok</Text>
                )}

                {/* Add form */}
                {isAdding && (
                  <View style={st.addForm}>
                    {/* Date picker */}
                    <Text style={st.fieldLabel}>TARİH *</Text>
                    <TouchableOpacity style={st.pickerBtn} onPress={() => setDatePicker(true)}>
                      <Text style={st.pickerBtnTxt}>📅  {formatDate(kalemForm.tarih)}</Text>
                      <Text style={st.pickerArrow}>▾</Text>
                    </TouchableOpacity>
                    <DatePickerModal visible={datePicker} value={kalemForm.tarih}
                      onChange={(d) => setKF("tarih", d)} onClose={() => setDatePicker(false)} />

                    {/* Belge No */}
                    <Text style={st.fieldLabel}>BELGE NO</Text>
                    <TextInput style={st.inp} value={kalemForm.belge_no} onChangeText={(v) => setKF("belge_no", v)}
                      placeholder="Fatura / fiş no" placeholderTextColor="#9ca3af" autoCorrect={false} />

                    {/* Belge Açıklaması */}
                    <Text style={st.fieldLabel}>BELGE AÇIKLAMASI</Text>
                    <TextInput style={st.inp} value={kalemForm.belge_aciklama} onChangeText={(v) => setKF("belge_aciklama", v)}
                      placeholder={kat.belgeAciklamaPlaceholder} placeholderTextColor="#9ca3af" autoCorrect={false} />

                    {/* Site ID (MALZEME only) */}
                    {kat.hasSiteId && (
                      <>
                        <Text style={st.fieldLabel}>SİTE ID</Text>
                        <TextInput style={st.inp} value={kalemForm.site_id} onChangeText={(v) => setKF("site_id", v)}
                          placeholder="Örn: AI0246, TR-IST-001..." placeholderTextColor="#9ca3af" autoCorrect={false} />
                      </>
                    )}

                    {/* Trafik Ceza fields */}
                    {kat.isTrafikCeza && (
                      <>
                        <Text style={[st.fieldLabel, { color: "#c2410c" }]}>🚗 ARAÇ PLAKASI *</Text>
                        <TextInput style={st.inp} value={kalemForm.plaka} onChangeText={(v) => setKF("plaka", v.toUpperCase())}
                          placeholder="Örn: 34ABC123" placeholderTextColor="#9ca3af" autoCapitalize="characters" autoCorrect={false} />

                        <Text style={[st.fieldLabel, { color: "#c2410c" }]}>👤 CEZAYI ALAN PERSONEL</Text>
                        <TouchableOpacity style={st.pickerBtn} onPress={() => setPersonelPicker(true)}>
                          <Text style={[st.pickerBtnTxt, !kalemForm.ceza_personel_id && { color: "#9ca3af" }]}>
                            {kalemForm.ceza_personel_id
                              ? personelList.find((p) => String(p.id) === kalemForm.ceza_personel_id)?.ad_soyad || "Personel"
                              : "Personel seçiniz..."}
                          </Text>
                          <Text style={st.pickerArrow}>▾</Text>
                        </TouchableOpacity>
                        <PickerModal
                          visible={personelPicker}
                          title="Personel Seç"
                          options={personelList}
                          value={kalemForm.ceza_personel_id}
                          getLabel={(p) => p.ad_soyad}
                          onSelect={(p) => setKF("ceza_personel_id", String(p.id))}
                          onClose={() => setPersonelPicker(false)}
                        />
                      </>
                    )}

                    {/* Açıklama */}
                    <Text style={st.fieldLabel}>AÇIKLAMA — {kat.aciklamaPlaceholder.toUpperCase()}</Text>
                    <TextInput style={st.inp} value={kalemForm.aciklama} onChangeText={(v) => setKF("aciklama", v)}
                      placeholder={kat.aciklamaPlaceholder} placeholderTextColor="#9ca3af" autoCorrect={false} />

                    {/* Tutar */}
                    <Text style={[st.fieldLabel, { color: "#1e40af" }]}>MASRAF TUTARI (₺) *</Text>
                    <TextInput style={[st.inp, st.tutarInp]} value={kalemForm.tutar}
                      onChangeText={(v) => setKF("tutar", v)} placeholder="0.00"
                      placeholderTextColor="#9ca3af" keyboardType="decimal-pad" />

                    <View style={st.addFormBtns}>
                      <TouchableOpacity style={[st.addKalemBtn, addingKalem && st.btnDisabled]}
                        onPress={handleAddKalem} disabled={addingKalem}>
                        {addingKalem
                          ? <ActivityIndicator color="#fff" size="small" />
                          : <Text style={st.addKalemBtnTxt}>✓ Ekle + Fiş Yükle</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity style={st.cancelBtn} onPress={cancelAdding}>
                        <Text style={st.cancelBtnTxt}>İptal</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* "+" button */}
                {!isAdding && (
                  <TouchableOpacity style={st.addRowBtn} onPress={() => startAdding(kat.key)}>
                    <Text style={st.addRowBtnTxt}>+ Bu Bölüme Ekle</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}

          {/* Summary */}
          {kalemler.length > 0 && (
            <View style={st.summaryBox}>
              <Text style={st.summaryTitle}>İCMAL / SONUÇ</Text>
              {MASRAF_KATEGORILER.map((kat) => {
                const t = kalemler.filter((k) => k.kategori === kat.key).reduce((s, k) => s + Number(k.tutar || 0), 0);
                return t > 0 ? (
                  <View key={kat.key} style={st.summaryRow}>
                    <Text style={st.summaryKat}>{kat.label}</Text>
                    <Text style={st.summaryAmt}>₺{formatTL(t)}</Text>
                  </View>
                ) : null;
              })}
              <View style={st.summaryTotal}>
                <Text style={st.summaryTotalLbl}>GENEL TOPLAM</Text>
                <Text style={st.summaryTotalAmt}>₺{formatTL(totalKalem)}</Text>
              </View>
            </View>
          )}

          {/* Submit buttons */}
          <View style={st.btnRow}>
            <TouchableOpacity style={[st.btn, st.btnGray]} onPress={handleSaveDraft}>
              <Text style={st.btnGrayTxt}>💾 Taslak</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.btn, st.btnGreen, submitting && st.btnDisabled]}
              onPress={handleSubmit} disabled={submitting}>
              {submitting
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={st.btnGreenTxt}>🚀 Onaya Gönder</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Photo upload modal ─── */}
      {fotoModal && (() => {
        // Plate mismatch warning
        if (ocrResult?.hasPlateWarn) return (
          <Modal visible transparent animationType="fade">
            <View style={st.fullModal}>
              <View style={st.warningCard}>
                <Text style={{ fontSize: 48, textAlign: "center", marginBottom: 8 }}>🚫</Text>
                <Text style={[st.warningTitle, { color: "#dc2626" }]}>Fiş Kabul Edilmedi</Text>
                <View style={st.warningInfoBox}>
                  <Text style={st.warningInfoTxt}>Araç plakası ve fişteki plaka uyuşmuyor.</Text>
                  <Text style={st.warningInfoTxt}>Fişte okunan plaka: <Text style={{ fontWeight: "800", color: "#dc2626" }}>{ocrResult.ocr_plaka}</Text></Text>
                </View>
                <Text style={st.warningDesc}>Lütfen doğru fişi yükleyin veya plaka bilgisini kontrol edin.</Text>
                <TouchableOpacity style={[st.confirmBtn, { backgroundColor: "#dc2626" }]} onPress={handlePlateWarnOk}>
                  <Text style={st.confirmBtnTxt}>Tamam — Fişi Sil ve Geri Dön</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        );

        // Tutar mismatch warning
        if (ocrResult?.hasTutarUyari) return (
          <Modal visible transparent animationType="fade">
            <View style={st.fullModal}>
              <View style={st.warningCard}>
                <Text style={st.warningTitle}>⚠️ Tutar Farkı Var</Text>
                <View style={st.warningInfoBox}>
                  <View style={st.warningRow}>
                    <Text style={st.warningInfoTxt}>Girdiğiniz tutar</Text>
                    <Text style={{ fontWeight: "800", color: "#92400e" }}>₺{formatTL(fotoModal.tutar)}</Text>
                  </View>
                  <View style={st.warningRow}>
                    <Text style={st.warningInfoTxt}>Fişteki tutar (OCR)</Text>
                    <Text style={{ fontWeight: "800", color: "#dc2626" }}>₺{formatTL(ocrResult.ocr_tutar)}</Text>
                  </View>
                </View>
                <Text style={st.warningDesc}>Farkı açıklar mısınız? (zorunlu)</Text>
                <TextInput style={[st.inp, { marginBottom: 14 }]} value={tutarAciklama}
                  onChangeText={setTutarAciklama} placeholder="Örn: KDV hariç yazıyor..."
                  placeholderTextColor="#9ca3af" autoCorrect={false} />
                <TouchableOpacity style={st.confirmBtn} onPress={handleTutarUyariDevam}>
                  <Text style={st.confirmBtnTxt}>Devam Et</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.confirmBtn, { backgroundColor: "#f3f4f6", marginTop: 8 }]} onPress={closeFotoModal}>
                  <Text style={[st.confirmBtnTxt, { color: "#374151" }]}>Fiş Olmadan Devam Et</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        );

        // Main photo upload modal
        return (
          <Modal visible transparent animationType="slide" onRequestClose={() => {
            if (duzeltme) { if (fisIs?.asama !== "ekleniyor") setDuzeltme(null); }
            else if (fisIs) { if (!["isleniyor", "ekleniyor"].includes(fisIs.asama)) fisIptal(); }
            else closeFotoModal();
          }}>
            <View style={st.fullModal}>
              <View style={st.photoCard}>
                <Text style={st.photoTitle}>📷 Fiş / Fatura Yükle</Text>
                <Text style={st.photoSubtitle}>Masraf tutarı: <Text style={{ fontWeight: "800" }}>₺{formatTL(fotoModal.tutar)}</Text></Text>

                {(
                  <>
                    <TouchableOpacity style={[st.photoBtn, { backgroundColor: "#1e3a5f" }]} onPress={() => pickAndUpload(true)}>
                      <Text style={st.photoBtnTxt}>📸 Fotoğraf Çek</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[st.photoBtn, { backgroundColor: "#2563eb" }]} onPress={() => pickAndUpload(false)}>
                      <Text style={st.photoBtnTxt}>🖼 Galeriden Seç</Text>
                    </TouchableOpacity>

                    <View style={st.divider}><Text style={st.dividerTxt}>— veya —</Text></View>

                    <Text style={[st.fieldLabel, { color: "#dc2626", marginTop: 4 }]}>Fişsiz devam neden?</Text>
                    <TextInput style={[st.inp, { marginBottom: 8 }]} value={fisOlmadan}
                      onChangeText={setFisOlmadan} placeholder="Fiş alınamama sebebi..."
                      placeholderTextColor="#9ca3af" autoCorrect={false} />
                    <TouchableOpacity style={[st.photoBtn, { backgroundColor: "#f59e0b" }]} onPress={handleFissiz}>
                      <Text style={st.photoBtnTxt}>⚠ Fişsiz Devam Et</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={[st.photoBtn, { backgroundColor: "#f3f4f6" }]} onPress={closeFotoModal}>
                      <Text style={[st.photoBtnTxt, { color: "#374151" }]}>Sonra Yükle (Şimdi Kapat)</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
            {/* Fiş işleme + kırpma düzeltme aynı Modal'ın içinde katman (iOS ikinci Modal'ı göstermiyor) */}
            {fisIs && (
              <FisIsleme is={fisIs} onEkle={fisEkle} onDuzelt={(aday) => setDuzeltme({ aday })}
                onYenidenCek={() => { setFisIs(null); setDuzeltme(null); }}
                onTekrarDene={() => fisIsle(fisIs.foto, fisIs.kalemId)} onKirpmadan={fisKirpmadan} onIptal={fisIptal} />
            )}
            <FisKirpma gomulu gorunur={!!duzeltme && !!fisIs?.sonuc?.kaynak}
              uri={fisIs?.sonuc?.kaynak?.onizleme} olcu={fisIs?.sonuc?.olcu}
              baslangic={duzeltme?.aday?.kose || fisIs?.sonuc?.elle_baslangic}
              baslik={duzeltme?.aday ? "Kırpmayı düzelt" : "Elle kırp"} isliyor={fisIs?.asama === "ekleniyor"}
              onIptal={() => setDuzeltme(null)}
              onTamam={(kose) => fisEkle([{ ...(duzeltme?.aday ? { aday_no: duzeltme.aday.no } : {}), kose }])} />
          </Modal>
        );
      })()}

      {/* Eklenmiş fiş: web görüntüleyici, indirme ve PDF ile aynı dosya */}
      {fisGor && (
        <Modal visible animationType="fade" onRequestClose={() => setFisGor(null)}>
          <View style={st.fisGorKap}>
            <Image source={{ uri: fisGor.dosya_yolu }} style={{ flex: 1 }} resizeMode="contain" />
            <View style={st.fisGorAlt}>
              <Text style={st.fisGorTxt}>{kirpmaEtiketi(fisGor)}{fisGor.genislik ? ` · ${fisGor.genislik}×${fisGor.yukseklik} px` : ""}</Text>
              <TouchableOpacity onPress={() => setFisGor(null)} style={st.fisGorBtn}><Text style={st.fisGorBtnTxt}>Kapat</Text></TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: "#F0FFF4" },
  fisSatir: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4 },
  fisKucuk: { width: 34, height: 46, borderRadius: 4, backgroundColor: "#e5e7eb" },
  fisGorKap: { flex: 1, backgroundColor: "#000", paddingTop: Platform.OS === "ios" ? 50 : 20 },
  fisGorAlt: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, paddingBottom: Platform.OS === "ios" ? 34 : 16 },
  fisGorTxt: { color: "#e5e7eb", fontSize: 13, flex: 1 },
  fisGorBtn: { backgroundColor: "#1f2937", borderRadius: 9, paddingVertical: 9, paddingHorizontal: 16 },
  fisGorBtnTxt: { color: "#fff", fontWeight: "700" },
  flex:  { flex: 1 },
  body:  { padding: 12, paddingBottom: 40 },

  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#059669", paddingHorizontal: 16, paddingVertical: 14, paddingTop: 18,
  },
  backBtn:     { padding: 4, width: 60 },
  backText:    { color: "#fff", fontSize: 16, fontWeight: "600" },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },

  infoBar: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: "#ecfdf5", paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "#a7f3d0",
  },
  infoText: { fontSize: 12, color: "#374151", fontWeight: "600" },

  // Category card
  katCard:   { borderRadius: 10, marginBottom: 8, overflow: "hidden", borderWidth: 1, borderColor: "#e5e7eb" },
  katHeader: { backgroundColor: "#2563eb", padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  katLabel:  { color: "#fff", fontWeight: "700", fontSize: 12, flex: 1 },
  katRight:  { flexDirection: "row", alignItems: "center", gap: 8 },
  katToplam: { color: "#bfdbfe", fontWeight: "700", fontSize: 12 },
  katBadge:  { backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1 },
  katBadgeTxt: { color: "#fff", fontSize: 10, fontWeight: "700" },
  katArrow:  { color: "#bfdbfe", fontSize: 13 },

  // Kalem rows
  kalemRow: { flexDirection: "row", justifyContent: "space-between", padding: 12, borderBottomWidth: 1, borderBottomColor: "#f3f4f6", backgroundColor: "#fff" },
  kalemRowNoFis: { backgroundColor: "#fff7ed" },
  kalemRowLeft: { flex: 1, marginRight: 10 },
  kalemRowRight: { alignItems: "flex-end" },
  kalemTarih:   { fontSize: 11, color: "#6b7280", marginBottom: 2 },
  kalemAciklama: { fontSize: 13, color: "#374151" },
  kalemAciklamaGray: { fontSize: 12, color: "#6b7280" },
  kalemNoFis:   { fontSize: 11, color: "#dc2626", marginTop: 2 },
  kalemFis:     { fontSize: 11, color: "#059669", marginTop: 2 },
  kalemTutar:   { fontSize: 14, fontWeight: "800", color: "#1e3a5f", marginBottom: 4 },
  kalemBtns:    { flexDirection: "row", gap: 4 },
  miniBtn:      { backgroundColor: "#eff6ff", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6 },
  miniBtnRed:   { backgroundColor: "#fee2e2" },
  miniBtnTxt:   { fontSize: 13 },

  emptyKat: { padding: 12, fontSize: 12, color: "#9ca3af", fontStyle: "italic", backgroundColor: "#fff" },

  // Add item form
  addForm: { padding: 14, backgroundColor: "#f0f9ff", borderTopWidth: 2, borderTopColor: "#2563eb" },
  fieldLabel: { fontSize: 10, fontWeight: "800", color: "#1e40af", marginBottom: 4, marginTop: 10 },
  inp: {
    backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#d1d5db", borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: "#111827",
  },
  tutarInp: { fontSize: 20, fontWeight: "700", borderColor: "#2563eb", borderWidth: 2 },
  pickerBtn: {
    backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#d1d5db", borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 11, flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  pickerBtnTxt: { fontSize: 14, color: "#111827", flex: 1 },
  pickerArrow:  { fontSize: 13, color: "#6b7280" },
  addFormBtns:  { flexDirection: "row", gap: 8, marginTop: 12 },
  addKalemBtn:  { flex: 1, backgroundColor: "#1e3a5f", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  addKalemBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
  cancelBtn:  { backgroundColor: "#f3f4f6", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center" },
  cancelBtnTxt: { color: "#374151", fontWeight: "600", fontSize: 13 },

  // "+" row button
  addRowBtn:  { paddingVertical: 10, alignItems: "center", backgroundColor: "#f0f9ff", borderTopWidth: 1, borderTopColor: "#bfdbfe", borderStyle: "dashed" },
  addRowBtnTxt: { color: "#2563eb", fontWeight: "600", fontSize: 13 },

  // Summary
  summaryBox: { backgroundColor: "#1e3a5f", borderRadius: 10, padding: 16, marginTop: 4, marginBottom: 12 },
  summaryTitle: { color: "#93c5fd", fontSize: 10, fontWeight: "700", letterSpacing: 1, marginBottom: 10 },
  summaryRow:   { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  summaryKat:   { color: "#bfdbfe", fontSize: 13 },
  summaryAmt:   { color: "#bfdbfe", fontWeight: "600", fontSize: 13 },
  summaryTotal: { borderTopWidth: 1, borderTopColor: "#3b5a8a", paddingTop: 10, marginTop: 6, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryTotalLbl: { color: "#fff", fontWeight: "800", fontSize: 14 },
  summaryTotalAmt: { color: "#fff", fontWeight: "800", fontSize: 22 },

  // Bottom buttons
  btnRow:     { flexDirection: "row", gap: 12, marginTop: 4 },
  btn:        { flex: 1, borderRadius: 10, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  btnDisabled:{ opacity: 0.6 },
  btnGray:    { backgroundColor: "#f3f4f6", borderWidth: 1, borderColor: "#d1d5db" },
  btnGreen:   { backgroundColor: "#059669" },
  btnGrayTxt: { color: "#374151", fontWeight: "700", fontSize: 14 },
  btnGreenTxt:{ color: "#fff", fontWeight: "700", fontSize: 14 },

  // Modal shared
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalSheet:   { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "70%", paddingBottom: 32 },
  modalHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  modalTitle:   { fontSize: 16, fontWeight: "700", color: "#111827" },
  modalClose:   { fontSize: 18, color: "#6b7280" },
  optionRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#f9fafb" },
  optionRowActive:  { backgroundColor: "#ecfdf5" },
  optionText:       { fontSize: 15, color: "#374151" },
  optionTextActive: { color: "#059669", fontWeight: "700" },
  checkmark:        { fontSize: 16, color: "#059669", fontWeight: "700" },

  // Date picker
  dateRow:   { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 20, paddingVertical: 20, gap: 8 },
  dateUnit:  { alignItems: "center", minWidth: 72 },
  dateArrow: { paddingHorizontal: 16, paddingVertical: 7 },
  dateArrowTxt: { fontSize: 16, color: "#059669", fontWeight: "700" },
  dateVal:   { fontSize: 20, fontWeight: "800", color: "#111827", marginVertical: 6, textAlign: "center" },
  dateUnitLbl: { fontSize: 11, color: "#9ca3af", fontWeight: "600", marginTop: 4 },
  dateSep:   { fontSize: 22, color: "#d1d5db", fontWeight: "300", marginBottom: 20 },
  confirmBtn: { marginHorizontal: 20, backgroundColor: "#059669", borderRadius: 10, paddingVertical: 13, alignItems: "center", marginTop: 4 },
  confirmBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 15 },

  // Photo / warning modals
  fullModal:   { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  photoCard:   { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  photoTitle:  { fontSize: 18, fontWeight: "800", color: "#1e3a5f", marginBottom: 4 },
  photoSubtitle: { fontSize: 14, color: "#6b7280", marginBottom: 20 },
  photoBtn:    { borderRadius: 10, paddingVertical: 14, alignItems: "center", marginBottom: 10 },
  photoBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 14 },
  divider:     { alignItems: "center", marginVertical: 6 },
  dividerTxt:  { color: "#9ca3af", fontSize: 12 },

  warningCard: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  warningTitle:{ fontSize: 18, fontWeight: "800", color: "#1e3a5f", textAlign: "center", marginBottom: 14 },
  warningInfoBox: { backgroundColor: "#fef9c3", borderRadius: 10, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: "#fde047" },
  warningRow:  { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  warningInfoTxt: { fontSize: 13, color: "#713f12" },
  warningDesc: { fontSize: 13, color: "#6b7280", marginBottom: 12, lineHeight: 20 },
});
