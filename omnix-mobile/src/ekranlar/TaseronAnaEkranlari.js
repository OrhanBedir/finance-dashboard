// RF taşeron ana ekranları (06.11.2026, Orhan):
//   • Firma sahibi: firma adı + tarih, Atanan / Devam / QC bekleyen / QC OK kartları, İşlerim, Saha Haritası, Atanan İş Bedelleri, Finansal Özet
//   • Çalışan (ve finanssız operasyon sorumlusu): ekip adı, bugünkü atamalar, devam eden işler, eksik / Clean Up işleri, harita
// İş verisi /taseron-saha/isler (kapsam sunucuda); finans özeti yalnız firma sahibinde /taseron-panel/cari (çalışana sunucu 403).
import React, { useCallback, useMemo } from "react";
import { Pressable, RefreshControl, ScrollView, StatusBar, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { aralik, renk, yazi } from "../tema";
import { BilgiSatiri, BolumBasligi, Kart, Metin, Rozet, IkonKutu } from "../bilesenler/temel";
import { BosDurum, HataDurum, IskeletKart } from "../bilesenler/durum";
import { BaglantiBandi } from "../bilesenler/BaglantiBandi";
import { useOturum } from "../oturum/OturumSaglayici";
import { useVeri } from "../api/veri";
import { taseronPanelApi, taseronSahaApi } from "../api/uclar";
import { MONTAJ_TON, bugunMu } from "../mantik/taseronSaha";
import { finansVar, sahaAcik } from "../mantik/profil";
import { basHarfler, para, tarih } from "../mantik/bicim";

function Ust({ baslik, alt, kullanici, navigation }) {
  const kenar = useSafeAreaInsets();
  return (
    <View style={{ backgroundColor: renk.lacivert, paddingTop: kenar.top + aralik.xs, paddingHorizontal: aralik.m, paddingBottom: 64 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Metin tur="baslikL" renk="#FFFFFF" numberOfLines={1}>{baslik}</Metin>
          <Metin tur="kucuk" renk="#C7D3E3" numberOfLines={1}>{alt}</Metin>
        </View>
        <Pressable onPress={() => navigation.navigate("Profil")} accessibilityRole="button" accessibilityLabel="Profil ve çıkış"
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" }}>
          <Metin tur="kucukKalin" renk="#fff">{basHarfler(kullanici?.name)}</Metin>
        </Pressable>
      </View>
    </View>
  );
}
function SayiKart({ deger, etiket, renk: r, onPress, dar }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${etiket}: ${deger}`} style={({ pressed }) => [dar ? { flex: 1 } : { flexBasis: "47%", flexGrow: 1 }, pressed && { opacity: 0.8 }]}>
      <Kart style={{ paddingVertical: aralik.s }}>
        <Metin tur="baslikL" renk={r || renk.metin} style={yazi.tutar}>{deger}</Metin>
        <Metin tur="kucuk" renk={renk.metinIkincil}>{etiket}</Metin>
      </Kart>
    </Pressable>
  );
}
function Kisayol({ ikon, ad, alt, onPress }) {
  return (
    <Kart onPress={onPress} style={{ flexBasis: "47%", flexGrow: 1 }} erisimEtiketi={ad}>
      <IkonKutu ad={ikon} />
      <Metin tur="govdeKalin" style={{ marginTop: aralik.s }}>{ad}</Metin>
      {alt ? <Metin tur="minik" renk={renk.metinIkincil}>{alt}</Metin> : null}
    </Kart>
  );
}
function IsSatiri({ x, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", minHeight: 56, borderTopWidth: 0.5, borderTopColor: renk.cizgi }, pressed && { opacity: 0.7 }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Metin tur="govdeKalin" numberOfLines={1}>{x.fiziksel_id} · {x.kod}</Metin>
        <Metin tur="minik" renk={x.cleanup || x.sorun?.var ? renk.uyari : renk.metinIkincil} numberOfLines={1}>
          {[x.is_turu, x.plan_tarihi ? `Plan ${tarih(x.plan_tarihi)}` : null, x.cleanup ? `Clean Up: ${x.cleanup.kalem} eksik` : null, x.sorun?.var && !x.cleanup ? "Açık sorun" : null].filter(Boolean).join(" · ")}</Metin>
      </View>
      <Rozet metin={x.montaj.ad} tonAdi={MONTAJ_TON[x.montaj.durum]} />
    </Pressable>
  );
}

// ── FİRMA SAHİBİ ─────────────────────────────────────────────────────────────────────────────────────────────────
export function TaseronSahipAnaSayfa({ navigation }) {
  const { kullanici } = useOturum();
  const saha = sahaAcik(kullanici);
  const v = useVeri("taseronSaha", () => taseronSahaApi.isler(), { etkin: saha });
  const c = useVeri("taseronCari", () => taseronPanelApi.cari());
  useFocusEffect(useCallback(() => { StatusBar.setBarStyle("light-content", true); }, []));
  const g = v.veri?.sayac?.grup || {};
  const q = c.veri?.qc_esasli || null;
  const firma = v.veri?.firma?.ad || c.veri?.firma?.ad || kullanici?.taseron?.ad || "Firma";
  const isler = (f) => navigation.navigate("TaseronIsler", f ? { filtre: f } : undefined);
  return (
    <View style={{ flex: 1, backgroundColor: renk.zemin }}>
      <ScrollView contentContainerStyle={{ paddingBottom: aralik.xxl }}
        refreshControl={<RefreshControl refreshing={v.yenileniyor || c.yenileniyor} onRefresh={() => { v.yenile(); c.yenile(); }} tintColor="#fff" />}>
        <Ust baslik={firma} alt={`Firma sahibi · ${tarih(new Date().toISOString())}`} kullanici={kullanici} navigation={navigation} />
        <BaglantiBandi />
        <View style={{ paddingHorizontal: aralik.m, marginTop: -48 }}>
          {saha ? (
            v.hata && !v.veri ? <Kart><HataDurum hata={v.hata} baslik="İşler alınamadı" onTekrar={v.yenile} /></Kart>
              : !v.veri ? <IskeletKart yukseklik={150} /> : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: aralik.s }}>
                  <SayiKart deger={g.atanan ?? 0} etiket="Atanan · montaj bekliyor" onPress={() => isler("atanan")} />
                  <SayiKart deger={g.devam ?? 0} etiket="Montaj devam ediyor" renk={renk.uyari} onPress={() => isler("devam")} />
                  <SayiKart deger={g.qc_bekleyen ?? 0} etiket="Montaj tamam · QC bekliyor" onPress={() => isler("qc_bekleyen")} />
                  <SayiKart deger={g.qc_ok ?? 0} etiket="QC OK (kapanmış)" renk={renk.basari} onPress={() => isler("qc_ok")} />
                </View>
              )
          ) : <Kart><BosDurum ikon="map-outline" baslik="Saha ekranı hesabınız için kapalı" aciklama="Finans bilgileriniz aşağıda. Saha erişimi için Teknocenter ile görüşün." /></Kart>}
          {v.veri ? <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: 4 }}>{v.veri.sayac.toplam} iş kaydı · {v.veri.sayac.fiziksel_saha} fiziksel saha · bir iş birden çok kartta olabilir</Metin> : null}
          <BolumBasligi baslik="Hızlı erişim" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: aralik.s }}>
            {saha ? <Kisayol ikon="list-outline" ad="İşlerim" onPress={() => isler()} /> : null}
            {saha ? <Kisayol ikon="map-outline" ad="Saha Haritası" alt="Yakınımdaki sahalar" onPress={() => navigation.navigate("TaseronHarita")} /> : null}
            <Kisayol ikon="pricetags-outline" ad="Atanan İş Bedelleri" alt="Plan — hak edilmiş değil" onPress={() => navigation.navigate("TaseronAtananBedeller")} />
            <Kisayol ikon="ribbon-outline" ad="Yaptığımız Sahalar" onPress={() => navigation.navigate("TaseronYaptiklarimiz")} />
          </View>
          <BolumBasligi baslik="Finansal özet" eylem="Finans" onEylem={() => navigation.navigate("TaseronFinans")} />
          {c.hata && !c.veri ? <Kart><HataDurum hata={c.hata} baslik="Finans bilgisi alınamadı" onTekrar={c.yenile} /></Kart>
            : !c.veri ? <IskeletKart yukseklik={120} />
            : !q ? <Kart><BosDurum ikon="cash-outline" baslik="QC esaslı hakediş hesaplanamadı" aciklama={c.veri.mesaj || "Firmanızın cari kartı hakediş esaslı değil."} /></Kart> : (
              <Kart style={{ paddingVertical: aralik.xs }} onPress={() => navigation.navigate("TaseronFinans")} erisimEtiketi="Finans ayrıntısı">
                <BilgiSatiri etiket="QC kapanmış hakediş (KDV hariç)" deger={para(q.qc_kapanmis, "TRY")} />
                <BilgiSatiri etiket="Montajı yapıldı, QC bekliyor" deger={para(q.montaj_qc_bekleyen, "TRY")} />
                <BilgiSatiri etiket="Gerçekleşen toplam ödeme" deger={para(q.odenen, "TRY")} />
                <BilgiSatiri etiket={q.yon.kod === "AVANS" ? "Açık avansınız" : q.yon.metin} deger={para(Math.abs(q.net), "TRY")} son />
              </Kart>
            )}
        </View>
      </ScrollView>
    </View>
  );
}

// ── ÇALIŞAN / OPERASYON SORUMLUSU ────────────────────────────────────────────────────────────────────────────────
export function TaseronCalisanAnaSayfa({ navigation }) {
  const { kullanici } = useOturum();
  const v = useVeri("taseronSaha", () => taseronSahaApi.isler());
  useFocusEffect(useCallback(() => { StatusBar.setBarStyle("light-content", true); }, []));
  const isler = v.veri?.isler || [];
  const bugun = useMemo(() => isler.filter((x) => bugunMu(x.plan_tarihi) && x.montaj.durum !== "TAMAMLANDI"), [isler]);
  const devam = useMemo(() => isler.filter((x) => (x.gruplar || []).includes("devam")), [isler]);
  const eksik = useMemo(() => isler.filter((x) => (x.gruplar || []).includes("eksik")), [isler]);
  const ac = (kod) => navigation.navigate("TaseronSahaDetay", { kod });
  const ekip = v.veri?.ekip?.ad || kullanici?.taseron_saha?.ekip_ad || null;
  return (
    <View style={{ flex: 1, backgroundColor: renk.zemin }}>
      <ScrollView contentContainerStyle={{ paddingBottom: aralik.xxl }}
        refreshControl={<RefreshControl refreshing={v.yenileniyor} onRefresh={v.yenile} tintColor="#fff" />}>
        <Ust baslik={ekip || v.veri?.firma?.ad || "Ekibim"} alt={`${v.veri?.firma?.ad || "Taşeron"} · ${v.veri?.rol === "CALISAN" ? "Çalışan" : "Operasyon sorumlusu"} · ${tarih(new Date().toISOString())}`}
          kullanici={kullanici} navigation={navigation} />
        <BaglantiBandi />
        <View style={{ paddingHorizontal: aralik.m, marginTop: -48 }}>
          {v.hata && !v.veri ? <Kart><HataDurum hata={v.hata} baslik="İşler alınamadı" onTekrar={v.yenile} /></Kart> : null}
          {!v.veri && !v.hata ? <IskeletKart yukseklik={150} /> : null}
          {v.veri ? (
            <>
              <View style={{ flexDirection: "row", gap: aralik.s }}>
                <SayiKart dar deger={bugun.length} etiket="Bugünkü atama" onPress={() => navigation.navigate("TaseronIsler", { filtre: "atanan" })} />
                <SayiKart dar deger={devam.length} etiket="Devam eden" renk={renk.uyari} onPress={() => navigation.navigate("TaseronIsler", { filtre: "devam" })} />
                <SayiKart dar deger={eksik.length} etiket="Eksik / Clean Up" renk={eksik.length ? renk.hata : undefined} onPress={() => navigation.navigate("TaseronIsler", { filtre: "eksik" })} />
              </View>
              <BolumBasligi baslik="Bugünkü atamalar" />
              <Kart dolgu={false} style={{ paddingHorizontal: aralik.m }}>
                {!bugun.length ? <Metin tur="kucuk" renk={renk.metinIkincil} style={{ paddingVertical: aralik.s }}>Bugün için planlanmış iş yok.</Metin> : bugun.map((x) => <IsSatiri key={x.kod} x={x} onPress={() => ac(x.kod)} />)}
              </Kart>
              <BolumBasligi baslik="Devam eden işler" />
              <Kart dolgu={false} style={{ paddingHorizontal: aralik.m }}>
                {!devam.length ? <Metin tur="kucuk" renk={renk.metinIkincil} style={{ paddingVertical: aralik.s }}>Devam eden iş yok.</Metin> : devam.map((x) => <IsSatiri key={x.kod} x={x} onPress={() => ac(x.kod)} />)}
              </Kart>
              <BolumBasligi baslik="Eksik / Clean Up işleri" />
              <Kart dolgu={false} style={{ paddingHorizontal: aralik.m }}>
                {!eksik.length ? <Metin tur="kucuk" renk={renk.metinIkincil} style={{ paddingVertical: aralik.s }}>Açık eksik ya da Clean Up yok.</Metin> : eksik.map((x) => <IsSatiri key={x.kod} x={x} onPress={() => ac(x.kod)} />)}
              </Kart>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: aralik.s, marginTop: aralik.m }}>
                <Kisayol ikon="map-outline" ad="Saha Haritası" alt="Yakınımdaki sahalar" onPress={() => navigation.navigate("TaseronHarita")} />
                <Kisayol ikon="ribbon-outline" ad="Yaptığımız Sahalar" onPress={() => navigation.navigate("TaseronYaptiklarimiz")} />
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

export { finansVar };
