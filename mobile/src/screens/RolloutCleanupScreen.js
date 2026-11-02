import React, { useState, useCallback, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Modal,
  Alert, ActivityIndicator, Platform, Image, SafeAreaView, KeyboardAvoidingView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { apiGet, apiPost, apiPut, apiUpload } from "../api";

/* ═══ ROLLOUT · CLEAN UP (02.09.2026) ═══════════════════════════════════
   Ekip: site ID → eksik kalemler → her kalem için Önce/Sonra fotoğrafı →
   tümü bitince "Onaya Gönder". Yönetici: aynı ekran onay modunda açılır,
   fotoğrafları görür, Onayla / Reddet (not). Backend yetkiyi ayrıca kontrol eder.
   Expo SDK 54 ImagePicker: mediaTypes dizi ['images'], result.assets[0].uri */

const ONAY_YETKI = [
  "nurcan.kus@simsektel.com", "orhan.bedir@simsektel.com", "orhan.bedir@gmail.com",
  "serdar.altinova@simsektel.com", "duzgun.simsek@simsektel.com",
];
const AYLAR = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
const fmt = (d) => {
  if (!d) return "—";
  const t = new Date(d);
  if (isNaN(t)) return String(d).slice(0, 10);
  return `${t.getDate()} ${AYLAR[t.getMonth()]} ${t.getFullYear()}`;
};
const DURUM = {
  TASLAK:     { txt: "Devam ediyor",  bg: "#f1f5f9", ink: "#475569" },
  ONAY_BEKLE: { txt: "Onay bekliyor", bg: "#fef3c7", ink: "#b45309" },
  ONAYLANDI:  { txt: "Onaylandı",     bg: "#dcfce7", ink: "#166534" },
  RED:        { txt: "Reddedildi",    bg: "#fee2e2", ink: "#b91c1c" },
};

export default function RolloutCleanupScreen({ user, navigation, route }) {
  const paramSite = route?.params?.site || "";
  const onayModu = !!route?.params?.onayModu;
  // Onay yetkisi bölgeye göre backend'den gelir (kayit.onay_yetkim); liste yalnız yedek
  const [atananlar, setAtananlar] = useState([]);
  useEffect(() => {
    if (onayModu) return;
    apiGet("/rollout/cleanup/atananlarim").then((d) => setAtananlar(d && d.ok ? d.rows || [] : [])).catch(() => {});
  }, [onayModu]);

  const [site, setSite] = useState(paramSite);
  const [kayit, setKayit] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [arandi, setArandi] = useState(false);
  const [gonderiliyor, setGonderiliyor] = useState(null); // `${itemId}_${tip}`
  const [islem, setIslem] = useState(false);
  const [redModal, setRedModal] = useState(false);
  const [redNot, setRedNot] = useState("");
  const [buyukFoto, setBuyukFoto] = useState(null);

  const temizKod = (s) => String(s || "").replace(/\s+/g, "").toUpperCase();

  const getir = useCallback(async (kod) => {
    const s = temizKod(kod || site);
    if (!s || s.length < 4) { Alert.alert("Site ID", "Lütfen saha kodunu yazın (örn. IZ1900_L2100_AE)."); return; }
    setYukleniyor(true); setArandi(true);
    try {
      const d = await apiGet(`/rollout/cleanup/site/${encodeURIComponent(s)}`);
      if (d && d.ok) setKayit(d.row || null);
      else { setKayit(null); Alert.alert("Hata", d?.error || "Kayıt alınamadı"); }
    } catch (e) { setKayit(null); Alert.alert("Hata", e.message); }
    finally { setYukleniyor(false); }
  }, [site]);

  useEffect(() => { if (paramSite) getir(paramSite); }, [paramSite]); // eslint-disable-line

  const fotoCek = (item, tip) => {
    Alert.alert(
      `${tip === "once" ? "Önce" : "Sonra"} fotoğrafı`,
      String(item.kalem || "").replace(/^[•\s]+/, ""),
      [
        { text: "Kamera", onPress: () => secVeYukle(item, tip, true) },
        { text: "Galeri", onPress: () => secVeYukle(item, tip, false) },
        { text: "Vazgeç", style: "cancel" },
      ],
    );
  };

  const secVeYukle = async (item, tip, kameradan) => {
    const { status } = kameradan
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("İzin Gerekli", kameradan ? "Kamera erişimi gerekiyor." : "Galeri erişimi gerekiyor.");
      return;
    }
    const secenek = { mediaTypes: ["images"], quality: 0.8, allowsEditing: false };
    const result = kameradan
      ? await ImagePicker.launchCameraAsync(secenek)
      : await ImagePicker.launchImageLibraryAsync(secenek);
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const mime = asset.mimeType || (asset.uri.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");

    const anahtar = `${item.id}_${tip}`;
    setGonderiliyor(anahtar);
    try {
      const d = await apiUpload(
        `/rollout/cleanup/${encodeURIComponent(temizKod(kayit.site_code))}/foto?item_id=${encodeURIComponent(item.id)}&tip=${tip}`,
        asset.uri, mime, "dosya",
      );
      if (!d?.ok) throw new Error(d?.error || "Yüklenemedi");
      setKayit(d.row);
    } catch (e) {
      Alert.alert("Yükleme Hatası", e.message);
    } finally { setGonderiliyor(null); }
  };

  const onayaGonder = () => {
    Alert.alert("Onaya Gönder", "Tüm eksikler tamamlandı olarak yöneticiye gönderilecek. Devam?", [
      { text: "Vazgeç", style: "cancel" },
      { text: "Gönder", onPress: async () => {
        setIslem(true);
        try {
          const d = await apiPost(`/rollout/cleanup/${encodeURIComponent(temizKod(kayit.site_code))}/onaya-gonder`, {}, true);
          if (!d?.ok) throw new Error(d?.error || "Gönderilemedi");
          setKayit(d.row);
          Alert.alert("Gönderildi ✅", "Yönetici onayına düştü.");
        } catch (e) { Alert.alert("Hata", e.message); }
        finally { setIslem(false); }
      } },
    ]);
  };

  const onayla = () => {
    Alert.alert("Onayla", `${kayit.site_code} Clean Up işleri onaylansın mı?`, [
      { text: "Vazgeç", style: "cancel" },
      { text: "Onayla", onPress: async () => {
        setIslem(true);
        try {
          const d = await apiPut(`/rollout/cleanup/${encodeURIComponent(temizKod(kayit.site_code))}/onayla`, {});
          setKayit(d.row);
          Alert.alert("Onaylandı ✅", "", [{ text: "Tamam", onPress: () => onayModu && navigation.goBack() }]);
        } catch (e) { Alert.alert("Hata", e.message); }
        finally { setIslem(false); }
      } },
    ]);
  };

  const reddet = async () => {
    if (!redNot.trim()) { Alert.alert("Gerekçe", "Red gerekçesi yazın."); return; }
    setIslem(true);
    try {
      const d = await apiPut(`/rollout/cleanup/${encodeURIComponent(temizKod(kayit.site_code))}/reddet`, { not: redNot.trim() });
      setKayit(d.row); setRedModal(false); setRedNot("");
      Alert.alert("Reddedildi", "Ekip düzeltip yeniden gönderecek.", [{ text: "Tamam", onPress: () => onayModu && navigation.goBack() }]);
    } catch (e) { Alert.alert("Hata", e.message); }
    finally { setIslem(false); }
  };

  const items = Array.isArray(kayit?.items) ? kayit.items : [];
  const tamam = items.filter((x) => x.tamamlandi).length;
  const sonraHepsiVar = items.length > 0 && items.every((it) => (it.fotolar || []).some((f) => f.tip === "sonra"));
  const durum = kayit ? (DURUM[kayit.onay_durum] || DURUM.TASLAK) : null;
  const yetkili = !!kayit?.onay_yetkim || (!kayit && ONAY_YETKI.includes(String(user?.email || "").toLowerCase()));
  const duzenlenebilir = kayit && kayit.onay_durum !== "ONAYLANDI" && kayit.onay_durum !== "ONAY_BEKLE";

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backTxt}>‹</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{onayModu ? "Clean Up · Onay" : "Rollout · Clean Up"}</Text>
            <Text style={styles.sub}>{onayModu ? "Fotoğrafları inceleyip onaylayın" : "Eksik kalemler için önce / sonra fotoğrafı"}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {!onayModu && (
            <View style={styles.searchRow}>
              <TextInput
                value={site}
                onChangeText={(t) => setSite(t.toUpperCase())}
                placeholder="Site ID — örn. IZ1900_L2100_AE"
                placeholderTextColor="#94a3b8"
                autoCapitalize="characters"
                autoCorrect={false}
                style={styles.input}
                returnKeyType="search"
                onSubmitEditing={() => getir()}
              />
              <TouchableOpacity style={styles.getirBtn} onPress={() => getir()} disabled={yukleniyor}>
                {yukleniyor ? <ActivityIndicator color="#fff" /> : <Text style={styles.getirTxt}>Getir</Text>}
              </TouchableOpacity>
            </View>
          )}
          {onayModu && yukleniyor && <ActivityIndicator style={{ marginVertical: 20 }} color="#1E3A5F" />}

          {/* Bana atanan sahalar — ofis atadıysa elle yazmaya gerek yok */}
          {!onayModu && atananlar.length > 0 && (
            <View style={{ marginBottom: 14 }}>
              <Text style={styles.bolumBaslik}>BANA ATANAN SAHALAR ({atananlar.length})</Text>
              {atananlar.map((a) => {
                const its = Array.isArray(a.items) ? a.items : [];
                const t = its.filter((x) => x.tamamlandi).length;
                const d = DURUM[a.onay_durum] || DURUM.TASLAK;
                const secili = kayit && kayit.site_code === a.site_code;
                return (
                  <TouchableOpacity key={a.id} activeOpacity={0.85}
                    onPress={() => { setSite(a.site_code); getir(a.site_code); }}
                    style={[styles.atanan, secili && styles.atananSecili]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.atananKod}>{a.site_code}</Text>
                      <Text style={styles.atananAlt}>{a.bolge || "—"} · {its.length ? `${t}/${its.length} tamamlandı` : "kalem yok"}{a.red_notu ? " · ⚠ red var" : ""}</Text>
                    </View>
                    <View style={[styles.rozet, { backgroundColor: d.bg }]}><Text style={[styles.rozetTxt, { color: d.ink }]}>{d.txt}</Text></View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {arandi && !yukleniyor && !kayit && (
            <View style={styles.bos}>
              <Text style={styles.bosTxt}>Bu saha için Clean Up kaydı yok.</Text>
              <Text style={styles.bosAlt}>Kayıt ofisten (Rollout Data → Clean Up) açılır; eksikler girildikten sonra burada görünür.</Text>
            </View>
          )}

          {kayit && (
            <>
              <View style={styles.kart}>
                <View style={styles.kartBaslik}>
                  <Text style={styles.siteKod}>{kayit.site_code}</Text>
                  <View style={[styles.rozet, { backgroundColor: durum.bg }]}>
                    <Text style={[styles.rozetTxt, { color: durum.ink }]}>{durum.txt}</Text>
                  </View>
                </View>
                <Text style={styles.ilerleme}>{items.length ? `${tamam}/${items.length} kalem tamamlandı` : "Eksik kalem girilmemiş"}</Text>
                <View style={styles.tarihRow}>
                  {[["Ziyaret", kayit.visit_date], ["Bildirim", kayit.notification_date], ["Tamamlama", kayit.completion_date]].map(([l, v]) => (
                    <View key={l} style={styles.tarihKutu}>
                      <Text style={styles.tarihLbl}>{l}</Text>
                      <Text style={[styles.tarihVal, !v && { color: "#cbd5e1" }]}>{fmt(v)}</Text>
                    </View>
                  ))}
                </View>
                {items.length > 0 && (
                  <View style={styles.progressBg}>
                    <View style={[styles.progressFg, { width: `${Math.round((100 * tamam) / items.length)}%` }]} />
                  </View>
                )}
                {kayit.onay_durum === "RED" && kayit.red_notu ? (
                  <View style={styles.redKutu}>
                    <Text style={styles.redBaslik}>Red gerekçesi{kayit.onaylayan ? ` · ${kayit.onaylayan.split("@")[0]}` : ""}</Text>
                    <Text style={styles.redTxt}>{kayit.red_notu}</Text>
                  </View>
                ) : null}
                {kayit.onay_durum === "ONAY_BEKLE" && !onayModu ? (
                  <Text style={styles.bilgi}>Yönetici onayı bekleniyor{kayit.onaya_gonderme_tarihi ? ` · ${fmt(kayit.onaya_gonderme_tarihi)}` : ""}. Bu aşamada fotoğraf eklenemez.</Text>
                ) : null}
                {kayit.onay_durum === "ONAYLANDI" ? (
                  <Text style={[styles.bilgi, { color: "#166534" }]}>Onaylandı{kayit.onaylayan ? ` · ${kayit.onaylayan.split("@")[0]}` : ""}{kayit.onay_tarihi ? ` · ${fmt(kayit.onay_tarihi)}` : ""}</Text>
                ) : null}
              </View>

              <Text style={styles.bolumBaslik}>EKSİK KALEMLERİ</Text>
              {items.map((item) => {
                const once = (item.fotolar || []).filter((f) => f.tip === "once");
                const sonra = (item.fotolar || []).filter((f) => f.tip === "sonra");
                const busyOnce = gonderiliyor === `${item.id}_once`;
                const busySonra = gonderiliyor === `${item.id}_sonra`;
                return (
                  <View key={item.id} style={[styles.kalem, item.tamamlandi && styles.kalemOk]}>
                    <View style={styles.kalemUst}>
                      <Text style={styles.kalemIkon}>{item.tamamlandi ? "✅" : "⭕"}</Text>
                      <Text style={[styles.kalemTxt, item.tamamlandi && styles.kalemTxtOk]}>
                        {String(item.kalem || "").replace(/^[•\s]+/, "")}
                      </Text>
                    </View>

                    {(once.length > 0 || sonra.length > 0) && (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                        {[...once.map((f) => ({ ...f, e: "Önce" })), ...sonra.map((f) => ({ ...f, e: "Sonra" }))].map((f, i) => (
                          <TouchableOpacity key={`${f.url}-${i}`} style={styles.thumbWrap} onPress={() => setBuyukFoto(f)} activeOpacity={0.8}>
                            <Image source={{ uri: f.url }} style={[styles.thumb, onayModu && styles.thumbBuyuk]} />
                            <Text style={[styles.thumbLbl, f.e === "Sonra" && { color: "#166534" }]}>{f.e}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                    {onayModu && sonra.length === 0 && (
                      <Text style={[styles.ipucu, { color: "#b91c1c" }]}>Bu kalemde "sonra" fotoğrafı yok.</Text>
                    )}

                    {!onayModu && duzenlenebilir && (
                      <>
                        <View style={styles.fotoRow}>
                          <TouchableOpacity style={[styles.fotoBtn, styles.fotoBtnOnce]} onPress={() => fotoCek(item, "once")} disabled={!!gonderiliyor}>
                            {busyOnce ? <ActivityIndicator color="#b45309" /> : <Text style={styles.fotoBtnTxtOnce}>📷 Önce{once.length ? ` (${once.length})` : ""}</Text>}
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.fotoBtn, styles.fotoBtnSonra]} onPress={() => fotoCek(item, "sonra")} disabled={!!gonderiliyor}>
                            {busySonra ? <ActivityIndicator color="#fff" /> : <Text style={styles.fotoBtnTxtSonra}>📷 Sonra{sonra.length ? ` (${sonra.length})` : ""}</Text>}
                          </TouchableOpacity>
                        </View>
                        {!item.tamamlandi && <Text style={styles.ipucu}>"Sonra" fotoğrafı yüklenince kalem otomatik tamamlanır.</Text>}
                      </>
                    )}
                  </View>
                );
              })}

              {kayit.notlar ? (
                <View style={styles.not}>
                  <Text style={styles.notTxt}><Text style={{ fontWeight: "800" }}>Not: </Text>{kayit.notlar}</Text>
                </View>
              ) : null}

              {/* Ekip: Onaya Gönder */}
              {!onayModu && duzenlenebilir && items.length > 0 && (
                <TouchableOpacity
                  style={[styles.anaBtn, !sonraHepsiVar && styles.anaBtnPasif]}
                  onPress={sonraHepsiVar ? onayaGonder : () => Alert.alert("Eksik var", "Her kalem için en az bir \"Sonra\" fotoğrafı çekilmeli.")}
                  disabled={islem} activeOpacity={0.85}>
                  {islem ? <ActivityIndicator color="#fff" /> : (
                    <Text style={styles.anaBtnTxt}>
                      {kayit.onay_durum === "RED" ? "Düzeltildi — Tekrar Onaya Gönder" : "Onaya Gönder"}
                      {!sonraHepsiVar ? `  (${items.length - items.filter((it) => (it.fotolar || []).some((f) => f.tip === "sonra")).length} kalem eksik)` : ""}
                    </Text>
                  )}
                </TouchableOpacity>
              )}

              {/* Yönetici: Onayla / Reddet */}
              {yetkili && kayit.onay_durum === "ONAY_BEKLE" && (
                <View style={styles.onayRow}>
                  <TouchableOpacity style={[styles.onayBtn, { backgroundColor: "#DC2626" }]} onPress={() => setRedModal(true)} disabled={islem}>
                    <Text style={styles.onayBtnTxt}>✕ Reddet</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.onayBtn, { backgroundColor: "#16A34A" }]} onPress={onayla} disabled={islem}>
                    {islem ? <ActivityIndicator color="#fff" /> : <Text style={styles.onayBtnTxt}>✓ Onayla</Text>}
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </ScrollView>

        {/* Red gerekçesi */}
        <Modal visible={redModal} transparent animationType="fade" onRequestClose={() => setRedModal(false)}>
          <View style={styles.modalArka}>
            <View style={styles.modalKutu}>
              <Text style={styles.modalBaslik}>Red gerekçesi</Text>
              <TextInput value={redNot} onChangeText={setRedNot} multiline placeholder="Neyin düzeltilmesi gerekiyor?"
                placeholderTextColor="#94a3b8" style={styles.modalInput} />
              <View style={styles.onayRow}>
                <TouchableOpacity style={[styles.onayBtn, { backgroundColor: "#e2e8f0" }]} onPress={() => setRedModal(false)}>
                  <Text style={[styles.onayBtnTxt, { color: "#334155" }]}>Vazgeç</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.onayBtn, { backgroundColor: "#DC2626" }]} onPress={reddet} disabled={islem}>
                  {islem ? <ActivityIndicator color="#fff" /> : <Text style={styles.onayBtnTxt}>Reddet</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Büyük fotoğraf */}
        <Modal visible={!!buyukFoto} transparent animationType="fade" onRequestClose={() => setBuyukFoto(null)}>
          <TouchableOpacity style={styles.fotoArka} activeOpacity={1} onPress={() => setBuyukFoto(null)}>
            {buyukFoto && <Image source={{ uri: buyukFoto.url }} style={styles.fotoBuyuk} resizeMode="contain" />}
            {buyukFoto && <Text style={styles.fotoAlt}>{buyukFoto.e} · {fmt(buyukFoto.tarih)}{buyukFoto.kullanici ? ` · ${String(buyukFoto.kullanici).split("@")[0]}` : ""}</Text>}
          </TouchableOpacity>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f1f5f9" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#1E3A5F" },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  backTxt: { color: "#fff", fontSize: 26, lineHeight: 28, marginTop: -2 },
  title: { color: "#fff", fontSize: 17, fontWeight: "800" },
  sub: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 1 },
  searchRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  input: { flex: 1, backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#cbd5e1", borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 15, fontWeight: "600", color: "#0f172a" },
  getirBtn: { backgroundColor: "#1D4ED8", borderRadius: 12, paddingHorizontal: 18, height: 48, alignItems: "center", justifyContent: "center", minWidth: 80 },
  getirTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  bos: { backgroundColor: "#fff", borderRadius: 14, padding: 18, alignItems: "center", borderWidth: 1, borderColor: "#e2e8f0" },
  bosTxt: { fontWeight: "800", color: "#0f172a", fontSize: 14 },
  bosAlt: { color: "#64748b", fontSize: 12, marginTop: 6, textAlign: "center" },
  kart: { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#e2e8f0", marginBottom: 14 },
  kartBaslik: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  siteKod: { fontSize: 17, fontWeight: "900", color: "#0f172a", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  rozet: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  rozetTxt: { fontSize: 11.5, fontWeight: "800" },
  ilerleme: { fontSize: 12, color: "#64748b", fontWeight: "600", marginTop: 6 },
  tarihRow: { flexDirection: "row", gap: 6, marginTop: 10 },
  tarihKutu: { flex: 1, backgroundColor: "#f8fafc", borderRadius: 10, padding: 8, alignItems: "center" },
  tarihLbl: { fontSize: 10, color: "#94a3b8", fontWeight: "700" },
  tarihVal: { fontSize: 12.5, fontWeight: "800", color: "#1e3a5f", marginTop: 2 },
  progressBg: { height: 6, backgroundColor: "#e2e8f0", borderRadius: 3, marginTop: 12, overflow: "hidden" },
  progressFg: { height: 6, backgroundColor: "#16a34a" },
  redKutu: { backgroundColor: "#fef2f2", borderRadius: 10, padding: 10, marginTop: 12, borderWidth: 1, borderColor: "#fecaca" },
  redBaslik: { fontSize: 11, fontWeight: "800", color: "#b91c1c", marginBottom: 2 },
  redTxt: { fontSize: 13, color: "#7f1d1d" },
  bilgi: { fontSize: 12, color: "#b45309", fontWeight: "600", marginTop: 10 },
  bolumBaslik: { fontSize: 11, fontWeight: "800", color: "#475569", letterSpacing: 1, marginBottom: 8, marginLeft: 2 },
  atanan: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#e2e8f0", marginBottom: 8 },
  atananSecili: { borderColor: "#1D4ED8", backgroundColor: "#eff6ff" },
  atananKod: { fontSize: 14, fontWeight: "900", color: "#0f172a", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  atananAlt: { fontSize: 11.5, color: "#64748b", marginTop: 2 },
  kalem: { backgroundColor: "#fff", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#e2e8f0", marginBottom: 10 },
  kalemOk: { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" },
  kalemUst: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  kalemIkon: { fontSize: 16, marginTop: 1 },
  kalemTxt: { flex: 1, fontSize: 14, fontWeight: "600", color: "#0f172a", lineHeight: 20 },
  kalemTxtOk: { color: "#6b7280", textDecorationLine: "line-through", fontWeight: "500" },
  thumbWrap: { marginRight: 8, alignItems: "center" },
  thumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: "#e2e8f0" },
  thumbBuyuk: { width: 110, height: 110 },
  thumbLbl: { fontSize: 10, fontWeight: "700", color: "#b45309", marginTop: 2 },
  fotoRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  fotoBtn: { flex: 1, height: 42, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  fotoBtnOnce: { backgroundColor: "#fef3c7", borderWidth: 1, borderColor: "#fde68a" },
  fotoBtnSonra: { backgroundColor: "#16a34a" },
  fotoBtnTxtOnce: { color: "#b45309", fontWeight: "800", fontSize: 13.5 },
  fotoBtnTxtSonra: { color: "#fff", fontWeight: "800", fontSize: 13.5 },
  ipucu: { fontSize: 10.5, color: "#94a3b8", marginTop: 6 },
  not: { backgroundColor: "#fefce8", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#fef08a", marginTop: 4 },
  notTxt: { color: "#713f12", fontSize: 13 },
  anaBtn: { marginTop: 16, backgroundColor: "#1D4ED8", borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  anaBtnPasif: { backgroundColor: "#94a3b8" },
  anaBtnTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  onayRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  onayBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  onayBtnTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  modalArka: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "center", padding: 20 },
  modalKutu: { backgroundColor: "#fff", borderRadius: 16, padding: 18 },
  modalBaslik: { fontSize: 16, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  modalInput: { minHeight: 90, borderWidth: 1.5, borderColor: "#cbd5e1", borderRadius: 12, padding: 12, fontSize: 14, color: "#0f172a", textAlignVertical: "top" },
  fotoArka: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  fotoBuyuk: { width: "100%", height: "80%" },
  fotoAlt: { color: "#fff", marginTop: 10, fontWeight: "700" },
});
