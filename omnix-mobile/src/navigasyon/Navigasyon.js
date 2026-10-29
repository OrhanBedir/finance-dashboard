// Gezinme: az sayıda ana bölüm (Ana sayfa, Harcamalar, Saha, [Onaylar], Profil) + üstüne açılan ayrıntı ekranları.
// "Onaylar" sekmesi yalnız backend'in onaycı olarak işaretlediği kullanıcıya görünür (yetki yine backend'de denetlenir).
// 25.10.2026: deneyim backend'in doğruladığı profilden — personel | yönetim (şirket sahibi/yönetici) | taşeron | bağlantısız taşeron.
// Taşeron hesabı personel uçlarını (pano, avans, puantaj) hiç çağırmaz.
import React from "react";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { renk } from "../tema";
import { useOturum } from "../oturum/OturumSaglayici";
import { useVeri } from "../api/veri";
import { cleanupApi, onayApi, panoApi } from "../api/uclar";
import { AnaSayfa, onayciMi } from "../ekranlar/AnaSayfa";
import { HarcamalarEkrani } from "../ekranlar/HarcamalarEkrani";
import { MasrafFormEkrani } from "../ekranlar/MasrafFormEkrani";
import { KalemEkleEkrani } from "../ekranlar/KalemEkleEkrani";
import { AvansDetayEkrani, AvansTalepEkrani } from "../ekranlar/AvansEkranlari";
import { HesapHareketleriEkrani } from "../ekranlar/HesapHareketleriEkrani";
import { SahaEkrani } from "../ekranlar/SahaEkrani";
import { IsDetayEkrani } from "../ekranlar/IsDetayEkrani";
import { CleanupEkrani } from "../ekranlar/CleanupEkrani";
import { MalzemeDetayEkrani, MalzemeTalepEkrani } from "../ekranlar/MalzemeEkranlari";
import { StokIslemEkrani } from "../ekranlar/StokEkranlari";
import { OnayMasrafDetayEkrani, OnaylarEkrani } from "../ekranlar/OnaylarEkrani";
import { ProfilEkrani } from "../ekranlar/ProfilEkrani";
import { PersonelDetayEkrani, PersonelYonetimiEkrani, YonetimAnaSayfa } from "../ekranlar/YonetimEkranlari";
import { TaseronAnaSayfa, TaseronBaglantiYokEkrani, TaseronBelgelerEkrani, TaseronFaturaDetayEkrani, TaseronFaturalarEkrani,
  TaseronHakedisEkrani, TaseronIsDetayEkrani, TaseronIslerEkrani } from "../ekranlar/TaseronEkranlari";
import { deneyim as deneyimSec } from "../mantik/profil";

const Yigin = createNativeStackNavigator();
const Sekme = createBottomTabNavigator();

const IKON = { AnaSayfa: "home", Harcamalar: "wallet", Saha: "navigate", Onaylar: "checkmark-done", Profil: "person-circle",
  TaseronIsler: "briefcase", TaseronHakedis: "cash", TaseronFaturalar: "receipt" };
const sekmeSecenek = ({ route }) => ({
  headerShown: false,
  tabBarActiveTintColor: renk.lacivert,
  tabBarInactiveTintColor: renk.metinSoluk,
  tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
  tabBarStyle: { borderTopColor: renk.cizgi },
  tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? IKON[route.name] : `${IKON[route.name]}-outline`} size={size} color={color} />,
});

function TaseronSekmeleri() {
  return (
    <Sekme.Navigator screenOptions={sekmeSecenek}>
      <Sekme.Screen name="AnaSayfa" component={TaseronAnaSayfa} options={{ title: "Ana sayfa" }} />
      <Sekme.Screen name="TaseronIsler" component={TaseronIslerEkrani} options={{ title: "İşler" }} />
      <Sekme.Screen name="TaseronHakedis" component={TaseronHakedisEkrani} options={{ title: "Hakediş" }} />
      <Sekme.Screen name="TaseronFaturalar" component={TaseronFaturalarEkrani} options={{ title: "Faturalar" }} />
      <Sekme.Screen name="Profil" component={ProfilEkrani} />
    </Sekme.Navigator>
  );
}
function BagsizSekmeleri() {
  return (
    <Sekme.Navigator screenOptions={sekmeSecenek}>
      <Sekme.Screen name="AnaSayfa" component={TaseronBaglantiYokEkrani} options={{ title: "Ana sayfa" }} />
      <Sekme.Screen name="Profil" component={ProfilEkrani} />
    </Sekme.Navigator>
  );
}

function Sekmeler() {
  const { kullanici } = useOturum();
  // "Onaylar" sekmesi: /auth/me'deki onay özeti (eski onay listeleri + tarihli devir, planlı devir dahil) ilk çizimden
  // itibaren kalıcıdır — bekleyen kayıt yokken kaybolmaz. Rozet = şu an işlem yapılabilecek kayıt sayısı (+ Clean Up).
  const onay = useVeri("onayBekleyen", () => onayApi.bekleyen(), { odaktaYenile: false, etkin: deneyimSec(kullanici) !== "taseron" });
  const pano = useVeri("pano", () => panoApi.pano(kullanici), { odaktaYenile: false });
  // Clean Up onaycısı (bölge onaycıları) avans onaycısı olmasa da Onaylar sekmesini görür; yetkiyi backend söyler
  const cleanup = useVeri("cleanupOnay", () => cleanupApi.onayBekleyen(), { odaktaYenile: false });
  const onayci = !!kullanici?.onay?.onayci || !!onay.veri?.onayci || onayciMi(pano.veri) || !!cleanup.veri?.yetkili;
  const onayAdedi = (onay.veri?.sayac ?? ((pano.veri?.onayBekleyenAvanslar?.length || 0) + (pano.veri?.isPM ? pano.veri?.onayBekleyenMalzemeler?.length || 0 : 0)))
    + (cleanup.veri?.rows?.length || 0);
  return (
    <Sekme.Navigator screenOptions={sekmeSecenek}>
      <Sekme.Screen name="AnaSayfa" component={deneyimSec(kullanici) === "yonetim" ? YonetimAnaSayfa : AnaSayfa} options={{ title: "Ana sayfa" }} />
      <Sekme.Screen name="Harcamalar" component={HarcamalarEkrani} />
      <Sekme.Screen name="Saha" component={SahaEkrani} />
      {onayci ? <Sekme.Screen name="Onaylar" component={OnaylarEkrani} options={{ tabBarBadge: onayAdedi || undefined }} /> : null}
      <Sekme.Screen name="Profil" component={ProfilEkrani} />
    </Sekme.Navigator>
  );
}

const tema = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: renk.zemin, primary: renk.lacivert } };

export function Navigasyon() {
  const { kullanici } = useOturum();
  const d = deneyimSec(kullanici);
  if (d === "taseron" || d === "taseronBagsiz") {
    return (
      <NavigationContainer theme={tema}>
        <Yigin.Navigator key={d} screenOptions={{ headerShown: false }}>
          <Yigin.Screen name="Sekmeler" component={d === "taseron" ? TaseronSekmeleri : BagsizSekmeleri} />
          <Yigin.Screen name="TaseronIsDetay" component={TaseronIsDetayEkrani} />
          <Yigin.Screen name="TaseronFaturaDetay" component={TaseronFaturaDetayEkrani} />
          <Yigin.Screen name="TaseronBelgeler" component={TaseronBelgelerEkrani} />
        </Yigin.Navigator>
      </NavigationContainer>
    );
  }
  return (
    <NavigationContainer theme={tema}>
      <Yigin.Navigator key={d} screenOptions={{ headerShown: false }}>
        <Yigin.Screen name="Sekmeler" component={Sekmeler} />
        {/* Personel Yönetimi: iPhone'da alttan açılan geniş sayfa (sheet); personel değiştirmek için geri kaydırılır */}
        <Yigin.Screen name="PersonelYonetimi" component={PersonelYonetimiEkrani} options={{ presentation: "modal" }} />
        <Yigin.Screen name="PersonelDetay" component={PersonelDetayEkrani} />
        <Yigin.Screen name="OnayMasrafDetay" component={OnayMasrafDetayEkrani} />
        <Yigin.Screen name="MasrafForm" component={MasrafFormEkrani} />
        <Yigin.Screen name="KalemEkle" component={KalemEkleEkrani} options={{ gestureEnabled: false }} />
        <Yigin.Screen name="AvansTalep" component={AvansTalepEkrani} />
        <Yigin.Screen name="AvansDetay" component={AvansDetayEkrani} />
        <Yigin.Screen name="HesapHareketleri" component={HesapHareketleriEkrani} />
        <Yigin.Screen name="IsDetay" component={IsDetayEkrani} />
        <Yigin.Screen name="Cleanup" component={CleanupEkrani} />
        <Yigin.Screen name="MalzemeTalep" component={MalzemeTalepEkrani} />
        <Yigin.Screen name="MalzemeDetay" component={MalzemeDetayEkrani} />
        <Yigin.Screen name="StokIslem" component={StokIslemEkrani} />
      </Yigin.Navigator>
    </NavigationContainer>
  );
}
