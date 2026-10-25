// Omnix giriş ekranı — firma seçimi YOK: firma, hesabın backend'deki kaydından gelir.
import React, { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { aralik, DOKUNMA, kose, renk, yazi } from "../tema";
import { Buton, Kart, Metin } from "../bilesenler/temel";
import { Bant } from "../bilesenler/durum";
import { OmnixYazi } from "../bilesenler/marka";
import { useOturum } from "../oturum/OturumSaglayici";
import { kullaniciMetniMi } from "../mantik/hata";

function girisHatasi(e) {
  if (e?.tur === "ag") return "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.";
  if (e?.tur === "zamanAsimi") return "Sunucu yanıt vermedi. Birkaç saniye sonra tekrar deneyin.";
  if (e?.durumKodu === 401 || e?.durumKodu === 400) return "E-posta veya şifre hatalı.";
  if (e?.durumKodu === 403 && kullaniciMetniMi(e?.sunucuMesaji)) return e.sunucuMesaji; // pasif / onay bekliyor
  return "Giriş yapılamadı. Lütfen tekrar deneyin.";
}

export function GirisEkrani() {
  const { girisYap, bildirim } = useOturum();
  const kenar = useSafeAreaInsets();
  const [eposta, setEposta] = useState("");
  const [sifre, setSifre] = useState("");
  const [goster, setGoster] = useState(false);
  const [hata, setHata] = useState(null);
  const [bekle, setBekle] = useState(false);
  const sifreRef = useRef(null);
  const kilit = useRef(false);

  const gonder = async () => {
    if (kilit.current) return;
    if (!eposta.trim() || !sifre) { setHata("E-posta ve şifrenizi girin."); return; }
    kilit.current = true;
    setBekle(true);
    setHata(null);
    try {
      await girisYap(eposta, sifre);
    } catch (e) {
      setHata(girisHatasi(e));
      setBekle(false);
    } finally {
      kilit.current = false;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: renk.lacivert }}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: kenar.top + aralik.xxl, paddingBottom: kenar.bottom + aralik.l, paddingHorizontal: aralik.l }}
          keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: "center", marginBottom: aralik.xl }}>
            <OmnixYazi acik boyut={34} />
            <Metin tur="kucuk" renk="#C7D3E3" style={{ marginTop: aralik.xs }}>Operasyon & Proje Platformu</Metin>
          </View>

          <Kart style={{ padding: aralik.l }}>
            <Metin tur="baslikL" accessibilityRole="header">Giriş yapın</Metin>
            <Metin tur="kucuk" renk={renk.metinIkincil} style={{ marginTop: 4, marginBottom: aralik.l }}>
              Şirketinizin size verdiği Omnix hesabıyla giriş yapın.
            </Metin>

            {bildirim ? <Bant tonAdi="uyari" metin={bildirim} style={{ marginBottom: aralik.m }} /> : null}

            <Metin tur="etiket" renk={renk.metinIkincil} style={{ marginBottom: 6 }}>E-posta / kullanıcı adı</Metin>
            <View style={kutu}>
              <Ionicons name="person-outline" size={18} color={renk.metinSoluk} style={{ marginLeft: aralik.s }} />
              <TextInput value={eposta} onChangeText={setEposta} autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
                textContentType="username" autoComplete="username" returnKeyType="next" onSubmitEditing={() => sifreRef.current?.focus()}
                placeholder="ornek@firma.com" placeholderTextColor={renk.metinSoluk} accessibilityLabel="E-posta veya kullanıcı adı"
                style={[yazi.govde, { flex: 1, color: renk.metin, paddingHorizontal: aralik.s, paddingVertical: 12 }]} />
            </View>

            <Metin tur="etiket" renk={renk.metinIkincil} style={{ marginBottom: 6, marginTop: aralik.m }}>Şifre</Metin>
            <View style={kutu}>
              <Ionicons name="lock-closed-outline" size={18} color={renk.metinSoluk} style={{ marginLeft: aralik.s }} />
              <TextInput ref={sifreRef} value={sifre} onChangeText={setSifre} secureTextEntry={!goster} autoCapitalize="none" autoCorrect={false}
                textContentType="password" autoComplete="password" returnKeyType="go" onSubmitEditing={gonder}
                placeholder="Şifreniz" placeholderTextColor={renk.metinSoluk} accessibilityLabel="Şifre"
                style={[yazi.govde, { flex: 1, color: renk.metin, paddingHorizontal: aralik.s, paddingVertical: 12 }]} />
              <Pressable onPress={() => setGoster((g) => !g)} hitSlop={8} accessibilityRole="button" accessibilityLabel={goster ? "Şifreyi gizle" : "Şifreyi göster"}
                style={{ width: DOKUNMA, height: DOKUNMA, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={goster ? "eye-off-outline" : "eye-outline"} size={20} color={renk.metinIkincil} />
              </Pressable>
            </View>

            {hata ? <Bant tonAdi="hata" metin={hata} style={{ marginTop: aralik.m }} /> : null}

            <Buton baslik="Giriş yap" onPress={gonder} yukleniyor={bekle} style={{ marginTop: aralik.l }} />
            <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: aralik.m, textAlign: "center" }}>
              Şifrenizi unuttuysanız şirket yöneticinizden sıfırlamasını isteyin.
            </Metin>
          </Kart>

          <View style={{ flex: 1 }} />
          <Metin tur="minik" renk="#93A6BF" style={{ textAlign: "center", marginTop: aralik.xl }}>© {new Date().getFullYear()} Omnix Platformu</Metin>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const kutu = { flexDirection: "row", alignItems: "center", minHeight: DOKUNMA + 2, borderRadius: kose.m, borderWidth: 1, borderColor: renk.cizgiKoyu, backgroundColor: renk.yuzey };
