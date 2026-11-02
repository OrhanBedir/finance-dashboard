import React, { useState, useEffect } from "react";
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
import { apiPost, apiGet, apiPut } from "../api";
import { tutarOku } from "../sayi";
import { AvansRedKutusu } from "../components/AvansRed";

// 02.11.2026: istek anahtarı — çift dokunma / bağlantı kopması sonrası aynı anahtarla tekrar: sunucu ikinci talep / tur açmaz
const istekAnahtariUret = () => `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

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
export default function IsAvansScreen({ navigation, user, route }) {
  // 02.11.2026 (Orhan): "Düzelt ve yeniden gönder" modu — reddedilen talep aynı kimlikle, düzeltme açıklaması zorunlu, yeni onay turu
  const duzelt = route?.params?.duzelt || null;
  const [duzeltAciklama, setDuzeltAciklama] = useState("");
  const [istekAnahtari, setIstekAnahtari] = useState(istekAnahtariUret());
  // "Kim için" (03.09.2026): yetkili (Nurcan/RM/PM/PD/muhasebe) başkası adına talep açar — web ile aynı
  const [personelSecim, setPersonelSecim] = useState({ yetkili: false, rows: [] });
  const [kimIcin, setKimIcin] = useState(null); // { id, ad_soyad }
  const [kimModal, setKimModal] = useState(false);
  const [kimAra, setKimAra] = useState("");
  useEffect(() => { apiGet("/hr/personel-secim").then((d) => { if (d && d.ok) setPersonelSecim({ yetkili: !!d.yetkili, rows: d.rows || [] }); }).catch(() => {}); }, []);
  const tarihOku = (v) => { if (!v) return new Date(); const d = new Date(String(v).slice(0, 10) + "T12:00:00"); return isNaN(d.getTime()) ? new Date() : d; };
  const [form, setForm] = useState({
    talep_eden: duzelt ? (duzelt.talep_eden_ad || user?.name || "") : (user?.name || ""),
    tarih:      duzelt ? tarihOku(duzelt.tarih) : new Date(),
    gider_turu: duzelt?.gider_turu || "",
    bolge:      duzelt?.bolge || "",
    proje:      duzelt?.proje || "",
    tutar:      duzelt ? String(duzelt.tutar ?? "") : "",
    aciklama:   duzelt?.aciklama || "",
    banka_adi:  "",
    iban:       "",
    plaka:      duzelt?.plaka || "",
    arac_km:    duzelt?.arac_km != null ? String(duzelt.arac_km) : "",
  });
  const [loading, setLoading] = useState(false);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  // Yakıt talebi araç otomatiği: kişinin org şemasındaki atanan aracı
  // (yoksa ekibinin aracı) sunucudan çekilir, Yakıt seçilince plakaya yazılır
  const [atananPlaka, setAtananPlaka] = useState("");
  useEffect(() => {
    if (!user?.email) return;
    let iptal = false;
    apiGet(`/hr/atanan-arac?email=${encodeURIComponent(user.email)}`)
      .then((d) => { if (!iptal && d?.plaka) setAtananPlaka(String(d.plaka).toUpperCase()); })
      .catch(() => {});
    return () => { iptal = true; };
  }, [user?.email]);

  // Üzerindeki iş avansı bakiyesi: tamamlanan avanslar − arşivlenen masraflar.
  // Sunucu kimliği token'dan alır; personel yalnız kendi bakiyesini görür.
  const [bakiye, setBakiye] = useState(null);
  const loadBakiye = () => {
    apiGet(`/hr/is-avans/bakiye`)
      .then((d) => { if (d && typeof d.bakiye !== "undefined") setBakiye(d); })
      .catch(() => {});
  };
  useEffect(() => { loadBakiye(); }, [user?.email]);
  useEffect(() => {
    if (form.gider_turu === "Yakıt" && atananPlaka && !form.plaka) set("plaka", atananPlaka);
  }, [form.gider_turu, atananPlaka]);

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
    const tutar = tutarOku(form.tutar);   // "282,5" gibi virgüllü tutar da geçerli (24.10.2026)
    if (!form.tutar.trim() || Number.isNaN(tutar)) {
      Alert.alert("Eksik Alan", "Geçerli bir tutar giriniz.");
      return;
    }
    if (form.gider_turu === "Yakıt" && !form.plaka.trim()) {
      Alert.alert("Eksik Alan", "Araç plakası giriniz.");
      return;
    }

    setLoading(true);
    // Düzelt ve yeniden gönder: aynı talep kimliği, düzeltme açıklaması zorunlu; onay/red geçmişi korunur, yeni tur açılır
    if (duzelt) {
      if (duzeltAciklama.trim().length < 3) { setLoading(false); Alert.alert("Eksik Alan", "Düzeltme / yeniden talep açıklaması zorunlu — neyi düzelttiğinizi yazın."); return; }
      try {
        const d = await apiPut(`/hr/is-avans/${duzelt.id}/yeniden-gonder`, {
          gonderim_aciklama: duzeltAciklama.trim(),
          tarih: form.tarih instanceof Date ? form.tarih.toISOString().split("T")[0] : undefined,
          gider_turu: form.gider_turu, bolge: form.bolge, proje: form.proje.trim(), tutar,
          aciklama: form.aciklama.trim(), plaka: form.plaka.trim().toUpperCase() || null,
          arac_km: form.arac_km.trim() ? Number(form.arac_km) : null,
          surum: duzelt.surum, istek_anahtari: istekAnahtari,
        });
        Alert.alert("Gönderildi", d?.tekrar ? "Bu gönderim zaten alınmıştı; talep onay sürecinde." : `Talep ${d?.tur_no || ""}. gönderim olarak yeniden onaya gönderildi.`,
          [{ text: "Tamam", onPress: () => navigation.goBack() }]);
      } catch (err) {
        Alert.alert("Gönderilemedi", err?.message || "Sunucuya ulaşılamadı.");
      } finally { setLoading(false); }
      return;
    }
    try {
      const data = await apiPost(
        "/hr/is-avans",
        {
          istek_anahtari:   istekAnahtari,
          talep_eden_ad:    form.talep_eden,
          talep_eden_email: user?.email || "",
          personel_id:      kimIcin ? kimIcin.id : undefined,
          tarih:            form.tarih instanceof Date
                              ? form.tarih.toISOString().split("T")[0]
                              : new Date().toISOString().split("T")[0],
          gider_turu:       form.gider_turu,
          bolge:            form.bolge,
          proje:            form.proje.trim(),
          tutar:            tutar,
          aciklama:         form.aciklama.trim(),
          banka_adi:        form.banka_adi.trim(),
          iban:             form.iban.trim().toUpperCase(),
          plaka:            form.plaka.trim().toUpperCase() || undefined,
          arac_km:          form.arac_km.trim() ? Number(form.arac_km) : null,
        },
        true
      );

      if (data?.id) {
        setIstekAnahtari(istekAnahtariUret()); // sonraki yeni talep için yeni anahtar
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
          <Text style={styles.headerTitle}>{duzelt ? "Düzelt ve Yeniden Gönder" : "İş Avans Talebi"}</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">

          {bakiye !== null && (
            <View style={[styles.bakiyeCard, { borderColor: bakiye.bakiye >= 0 ? "#16a34a" : "#dc2626", backgroundColor: bakiye.bakiye >= 0 ? "#f0fdf4" : "#fef2f2" }]}>
              <Text style={[styles.bakiyeLabel, { color: bakiye.bakiye >= 0 ? "#15803d" : "#b91c1c" }]}>ÜZERİNİZDEKİ İŞ AVANSI</Text>
              <Text style={[styles.bakiyeTutar, { color: bakiye.bakiye >= 0 ? "#15803d" : "#b91c1c" }]}>
                ₺{Number(bakiye.bakiye || 0).toLocaleString("tr-TR")}
              </Text>
              <Text style={styles.bakiyeDetay}>
                Alınan avans ₺{Number(bakiye.avans || 0).toLocaleString("tr-TR")}  ·  Masraf düşülen ₺{Number(bakiye.masraf || 0).toLocaleString("tr-TR")}
              </Text>
              {bakiye.bakiye < 0 && (
                <Text style={styles.bakiyeNot}>Masraflarınız avansı aştı — fark şirket tarafından ödenecek.</Text>
              )}
            </View>
          )}

          {duzelt && (
            <View style={{ marginBottom: 14 }}>
              <AvansRedKutusu t={duzelt} />
              <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 8 }}>Talep AV-{duzelt.id} aynı kimlikle devam eder; önceki açıklama ve red gerekçesi geçmişte korunur. Alanları düzeltin, ne değiştirdiğinizi yazın — talep ilk onay adımından yeniden başlar ({Number(duzelt.tur_no || 1) + 1}. gönderim).</Text>
              <View style={styles.fieldWrap}>
                <Text style={[styles.label, { color: "#7F1D1D", marginTop: 10 }]}>Düzeltme / yeniden talep açıklaması<Text style={{ color: "#dc2626" }}> *</Text></Text>
                <TextInput style={[styles.input, { height: 3 * 22 + 20, textAlignVertical: "top", borderColor: "#FCA5A5" }]} value={duzeltAciklama} onChangeText={setDuzeltAciklama}
                  placeholder="Örn. Tutarı 800 TL'ye düşürdüm, konaklama fişini ekledim" placeholderTextColor="#9CA3AF" multiline numberOfLines={3} autoCorrect={false} />
              </View>
            </View>
          )}
          {personelSecim.yetkili && !duzelt && (
            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6 }}>Kim için (opsiyonel)</Text>
              <TouchableOpacity onPress={() => setKimModal(true)} style={{ borderWidth: 1.5, borderColor: kimIcin ? "#1D4ED8" : "#e5e7eb", borderRadius: 10, padding: 12, backgroundColor: kimIcin ? "#eff6ff" : "#fff", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontSize: 14, color: kimIcin ? "#1e3a5f" : "#94a3b8", fontWeight: kimIcin ? "700" : "500" }}>{kimIcin ? `${kimIcin.ad_soyad}${kimIcin.unvan ? " · " + kimIcin.unvan : ""}` : "Kendim için (personel seçmek için dokun)"}</Text>
                {kimIcin ? <TouchableOpacity onPress={() => setKimIcin(null)}><Text style={{ color: "#b91c1c", fontWeight: "800" }}>✕</Text></TouchableOpacity> : <Text style={{ color: "#94a3b8" }}>▾</Text>}
              </TouchableOpacity>
              <Modal visible={kimModal} transparent animationType="slide" onRequestClose={() => setKimModal(false)}>
                <View style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" }}>
                  <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: "80%" }}>
                    <Text style={{ fontSize: 16, fontWeight: "800", color: "#0f172a", marginBottom: 8 }}>Kim için avans talep ediyorsunuz?</Text>
                    <TextInput value={kimAra} onChangeText={setKimAra} placeholder="Ad, ünvan veya bölge ara…" placeholderTextColor="#94a3b8" style={{ borderWidth: 1.5, borderColor: "#cbd5e1", borderRadius: 10, padding: 10, fontSize: 14, marginBottom: 8, color: "#0f172a" }} />
                    <ScrollView style={{ maxHeight: 380 }}>
                      {personelSecim.rows.filter((p) => !kimAra.trim() || `${p.ad_soyad} ${p.unvan || ""} ${p.bolge || ""}`.toLowerCase().includes(kimAra.toLowerCase())).map((p) => (
                        <TouchableOpacity key={p.id} onPress={() => { setKimIcin(p); setKimModal(false); setKimAra(""); }} style={{ paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" }}>
                          <Text style={{ fontSize: 14, fontWeight: "700", color: "#0f172a" }}>{p.ad_soyad}</Text>
                          <Text style={{ fontSize: 12, color: "#64748b" }}>{[p.unvan, p.bolge, (!p.marka || p.marka === "ERC") ? "Şimşek" : p.marka].filter(Boolean).join(" · ")}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    <TouchableOpacity onPress={() => setKimModal(false)} style={{ marginTop: 10, backgroundColor: "#e2e8f0", borderRadius: 12, paddingVertical: 13, alignItems: "center" }}><Text style={{ fontWeight: "800", color: "#334155" }}>Vazgeç</Text></TouchableOpacity>
                  </View>
                </View>
              </Modal>
            </View>
          )}
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

          {form.gider_turu === "Yakıt" && (
            <>
              <View style={styles.fieldWrap}>
                <Text style={styles.label}>
                  Araç (Plaka)<Text style={{ color: "#dc2626" }}> *</Text>
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    atananPlaka && form.plaka === atananPlaka && {
                      borderColor: "#2563eb", backgroundColor: "#eff6ff", fontWeight: "700",
                    },
                  ]}
                  value={form.plaka}
                  onChangeText={(v) => set("plaka", v.toUpperCase())}
                  placeholder="34ABC123"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
                {atananPlaka ? (
                  <Text style={{ fontSize: 12, color: "#2563eb", marginTop: 4 }}>
                    {form.plaka === atananPlaka
                      ? "🚗 Atanan aracınız — otomatik geldi"
                      : `Atanan aracınız: ${atananPlaka}`}
                  </Text>
                ) : null}
              </View>

              <Field
                label="Araç KM"
                value={form.arac_km}
                onChangeText={(v) => set("arac_km", v.replace(/[^0-9]/g, ""))}
                placeholder="Güncel kilometre (örn. 148500)"
                keyboardType="number-pad"
              />
            </>
          )}

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

          {!duzelt && (<>
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
          </>)}

          {/* Buttons */}
          <View style={styles.btnRow}>
            {!duzelt && (
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
            )}

            <TouchableOpacity
              style={[styles.btn, duzelt ? { backgroundColor: "#B91C1C" } : styles.btnBlue, loading && styles.btnDisabled]}
              onPress={() => handleSubmit("PM_BEKLE")}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.btnBlueText}>{duzelt ? "🔁 Yeniden Onaya Gönder" : "📤 Gönder"}</Text>
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
  bakiyeCard:  { borderWidth: 2, borderRadius: 14, padding: 16, marginBottom: 18 },
  bakiyeLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5, marginBottom: 4 },
  bakiyeTutar: { fontSize: 28, fontWeight: "800" },
  bakiyeDetay: { fontSize: 12, color: "#6b7280", marginTop: 6 },
  bakiyeNot:   { fontSize: 11, color: "#b91c1c", marginTop: 4, fontStyle: "italic" },

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
