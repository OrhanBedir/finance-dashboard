// Temel bileşenler: metin, kart, buton, rozet, satır. Tüm ekranlar bunları kullanır — renk/boşluk tek yerden.
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { aralik, DOKUNMA, golge, kose, renk, ton, yazi } from "../tema";

export function Metin({ tur = "govde", renk: r, style, children, ...p }) {
  return <Text style={[yazi[tur], { color: r || renk.metin }, style]} {...p}>{children}</Text>;
}

export function Kart({ children, style, onPress, erisimEtiketi, dolgu = true }) {
  const icerik = [st.kart, dolgu && { padding: aralik.m }, style];
  if (!onPress) return <View style={icerik}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={erisimEtiketi}
      style={({ pressed }) => [icerik, pressed && { opacity: 0.85, transform: [{ scale: 0.995 }] }]}>
      {children}
    </Pressable>
  );
}

// tur: birincil (lacivert) | ikincil (çerçeveli) | vurgu (altın) | tehlike | metin
export function Buton({ baslik, onPress, tur = "birincil", ikon, yukleniyor = false, devreDisi = false, style, kucuk = false, erisimIpucu }) {
  const pasif = devreDisi || yukleniyor;
  const s = BUTON[tur] || BUTON.birincil;
  return (
    <Pressable
      onPress={pasif ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: pasif, busy: yukleniyor }}
      accessibilityLabel={baslik}
      accessibilityHint={erisimIpucu}
      style={({ pressed }) => [
        st.buton, kucuk && st.butonKucuk, { backgroundColor: s.zemin, borderColor: s.cerceve || s.zemin },
        pressed && !pasif && { opacity: 0.82 }, pasif && { opacity: 0.5 }, style,
      ]}
    >
      {yukleniyor ? <ActivityIndicator color={s.on} /> : (
        <>
          {ikon ? <Ionicons name={ikon} size={kucuk ? 18 : 20} color={s.on} style={{ marginRight: 8 }} /> : null}
          <Text style={[kucuk ? yazi.kucukKalin : yazi.govdeKalin, { color: s.on }]} numberOfLines={1} maxFontSizeMultiplier={1.4}>{baslik}</Text>
        </>
      )}
    </Pressable>
  );
}

const BUTON = {
  birincil: { zemin: renk.lacivert, on: renk.metinTers },
  ikincil: { zemin: renk.yuzey, on: renk.lacivert, cerceve: renk.cizgiKoyu },
  vurgu: { zemin: renk.altin, on: "#1F1403" },
  tehlike: { zemin: renk.hataZemin, on: renk.hata, cerceve: "#F5C2BC" },
  basari: { zemin: renk.basari, on: renk.metinTers },
  metin: { zemin: "transparent", on: renk.lacivert },
};

export function Rozet({ metin, tonAdi = "notr", ikon, style }) {
  const t = ton[tonAdi] || ton.notr;
  return (
    <View style={[st.rozet, { backgroundColor: t.zemin }, style]}>
      {ikon ? <Ionicons name={ikon} size={13} color={t.on} style={{ marginRight: 4 }} /> : null}
      <Text style={[yazi.minik, { color: t.on, fontWeight: "600" }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>{metin}</Text>
    </View>
  );
}

export function IkonKutu({ ad, tonAdi = "marka", boyut = 40 }) {
  const t = ton[tonAdi] || ton.marka;
  return (
    <View style={{ width: boyut, height: boyut, borderRadius: boyut * 0.3, backgroundColor: t.zemin, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={ad} size={boyut * 0.5} color={t.on} />
    </View>
  );
}

// Liste satırı: ikon + başlık/alt metin + sağda değer + ok
export function Satir({ ikon, ikonTon, baslik, alt, sag, sagAlt, onPress, ok = !!onPress, son = false, erisimEtiketi }) {
  const icerik = (
    <View style={[st.satir, !son && st.satirCizgi]}>
      {ikon ? <View style={{ marginRight: aralik.s }}><IkonKutu ad={ikon} tonAdi={ikonTon} boyut={36} /></View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Metin tur="govdeKalin" numberOfLines={2}>{baslik}</Metin>
        {alt ? <Metin tur="kucuk" renk={renk.metinIkincil} numberOfLines={2} style={{ marginTop: 2 }}>{alt}</Metin> : null}
      </View>
      {(sag || sagAlt) ? (
        <View style={{ alignItems: "flex-end", marginLeft: aralik.s, maxWidth: "45%" }}>
          {typeof sag === "string" ? <Metin tur="govdeKalin" style={yazi.tutar} numberOfLines={1}>{sag}</Metin> : sag}
          {sagAlt ? (typeof sagAlt === "string" ? <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: 2 }}>{sagAlt}</Metin> : <View style={{ marginTop: 4 }}>{sagAlt}</View>) : null}
        </View>
      ) : null}
      {ok ? <Ionicons name="chevron-forward" size={18} color={renk.metinSoluk} style={{ marginLeft: 6 }} /> : null}
    </View>
  );
  if (!onPress) return icerik;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={erisimEtiketi || (typeof baslik === "string" ? baslik : undefined)}
      style={({ pressed }) => pressed && { backgroundColor: renk.yuzeyIkincil }}>
      {icerik}
    </Pressable>
  );
}

export function BolumBasligi({ baslik, eylem, onEylem, style }) {
  return (
    <View style={[st.bolum, style]}>
      <Metin tur="etiket" renk={renk.metinIkincil} style={{ textTransform: "uppercase", letterSpacing: 0.6 }} accessibilityRole="header">{baslik}</Metin>
      {eylem ? (
        <Pressable onPress={onEylem} hitSlop={12} accessibilityRole="button">
          <Metin tur="kucukKalin" renk={renk.lacivertAcik}>{eylem}</Metin>
        </Pressable>
      ) : null}
    </View>
  );
}

export function BilgiSatiri({ etiket, deger, son }) {
  if (deger === null || deger === undefined || deger === "") return null;
  return (
    <View style={[st.bilgi, !son && st.satirCizgi]}>
      <Metin tur="kucuk" renk={renk.metinIkincil} style={{ flex: 1 }}>{etiket}</Metin>
      <Metin tur="kucukKalin" style={{ flex: 1.6, textAlign: "right" }}>{deger}</Metin>
    </View>
  );
}

export const st = StyleSheet.create({
  kart: { backgroundColor: renk.yuzey, borderRadius: kose.l, borderWidth: StyleSheet.hairlineWidth, borderColor: renk.cizgi, ...golge },
  buton: { minHeight: DOKUNMA + 4, borderRadius: kose.m, paddingHorizontal: aralik.l, flexDirection: "row", alignItems: "center", justifyContent: "center", borderWidth: 1 },
  butonKucuk: { minHeight: 40, paddingHorizontal: aralik.m, borderRadius: kose.s + 2 },
  rozet: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 4, borderRadius: kose.tam },
  satir: { flexDirection: "row", alignItems: "center", paddingVertical: aralik.s, minHeight: DOKUNMA + 8 },
  satirCizgi: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: renk.cizgi },
  bolum: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: aralik.xl, marginBottom: aralik.xs, paddingHorizontal: 2 },
  bilgi: { flexDirection: "row", paddingVertical: aralik.s, gap: aralik.s },
});
