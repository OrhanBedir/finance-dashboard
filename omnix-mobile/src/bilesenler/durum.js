// Yükleniyor / boş / hata / bilgi bantları — her listede aynı görünüm. Teknik hata metni gösterilmez.
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { aralik, kose, renk, ton } from "../tema";
import { Buton, Metin } from "./temel";
import { hataMetni, okumaHataBasligi } from "../mantik/hata";

export function Yukleniyor({ metin = "Yükleniyor…", style }) {
  return (
    <View style={[{ paddingVertical: aralik.xxl, alignItems: "center" }, style]} accessibilityLiveRegion="polite">
      <ActivityIndicator color={renk.lacivert} />
      <Metin tur="kucuk" renk={renk.metinIkincil} style={{ marginTop: aralik.s }}>{metin}</Metin>
    </View>
  );
}

// İskelet kart: veri gelene kadar yerleşim oynamasın
export function IskeletKart({ yukseklik = 96, style }) {
  return <View style={[{ height: yukseklik, borderRadius: kose.l, backgroundColor: "#E9EDF3", marginBottom: aralik.s }, style]} />;
}

export function BosDurum({ ikon = "file-tray-outline", baslik, aciklama, eylem, onEylem, style }) {
  return (
    <View style={[{ alignItems: "center", paddingVertical: aralik.xl, paddingHorizontal: aralik.l }, style]}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: renk.notrZemin, alignItems: "center", justifyContent: "center", marginBottom: aralik.s }}>
        <Ionicons name={ikon} size={26} color={renk.metinSoluk} />
      </View>
      <Metin tur="govdeKalin" style={{ textAlign: "center" }}>{baslik}</Metin>
      {aciklama ? <Metin tur="kucuk" renk={renk.metinIkincil} style={{ textAlign: "center", marginTop: 4 }}>{aciklama}</Metin> : null}
      {eylem ? <Buton baslik={eylem} onPress={onEylem} tur="ikincil" kucuk style={{ marginTop: aralik.m }} /> : null}
    </View>
  );
}

export function HataDurum({ hata, onTekrar, baslik, style }) {
  const ag = hata?.tur === "ag" || hata?.tur === "zamanAsimi";
  const yetki = hata?.tur === "yetki";
  // Verilen başlık yalnız yetki dışı hatalarda kullanılır: yetkisizlik "yüklenemedi" diye gösterilmez
  baslik = yetki || ag ? okumaHataBasligi(hata) : (baslik || okumaHataBasligi(hata));
  return (
    <View style={[{ alignItems: "center", paddingVertical: aralik.xl, paddingHorizontal: aralik.l }, style]} accessibilityLiveRegion="polite">
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: ag ? renk.uyariZemin : renk.hataZemin, alignItems: "center", justifyContent: "center", marginBottom: aralik.s }}>
        <Ionicons name={ag ? "cloud-offline-outline" : yetki ? "lock-closed-outline" : "alert-circle-outline"} size={26} color={ag ? renk.uyari : renk.hata} />
      </View>
      <Metin tur="govdeKalin" style={{ textAlign: "center" }}>{baslik}</Metin>
      <Metin tur="kucuk" renk={renk.metinIkincil} style={{ textAlign: "center", marginTop: 4 }}>{hataMetni(hata)}</Metin>
      {onTekrar && !yetki ? <Buton baslik="Tekrar dene" ikon="refresh" onPress={onTekrar} tur="ikincil" kucuk style={{ marginTop: aralik.m }} /> : null}
    </View>
  );
}

// Veri yenilenemedi ama önceki başarılı veri ekranda: kesin/güncel sonuç gibi sunulmaz, zamanı yazılır
export function EskiVeriBandi({ v, style }) {
  if (!v?.hata || !v?.veri) return null;
  const z = v.zaman ? new Date(v.zaman) : null;
  const ne = z ? `${String(z.getHours()).padStart(2, "0")}:${String(z.getMinutes()).padStart(2, "0")}` : null;
  const yetki = v.hata?.tur === "yetki";
  return (
    <Bant tonAdi="uyari" style={style} ikon={yetki ? "lock-closed-outline" : "cloud-offline-outline"}
      baslik={yetki ? "Bu bilgiyi görme yetkiniz kaldırılmış olabilir" : "Güncellenemedi"}
      metin={`${ne ? `Gösterilen bilgi son başarılı yükleme (${ne}) anına ait; ` : "Gösterilen bilgi "}güncel olmayabilir.`}
      eylem={yetki ? undefined : "Tekrar dene"} onEylem={v.yenile} />
  );
}

// Satır içi bant: bilgi / uyarı / hata / başarı
export function Bant({ tonAdi = "bilgi", ikon, baslik, metin, eylem, onEylem, style }) {
  const t = ton[tonAdi] || ton.bilgi;
  const varsayilanIkon = { bilgi: "information-circle", uyari: "warning", hata: "alert-circle", basari: "checkmark-circle", notr: "information-circle" }[tonAdi];
  return (
    <View style={[{ flexDirection: "row", backgroundColor: t.zemin, borderRadius: kose.m, padding: aralik.s, alignItems: "flex-start" }, style]}
      accessibilityRole={tonAdi === "hata" ? "alert" : undefined}>
      <Ionicons name={ikon || varsayilanIkon} size={20} color={t.on} style={{ marginRight: aralik.xs, marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        {baslik ? <Metin tur="kucukKalin" renk={t.on}>{baslik}</Metin> : null}
        {metin ? <Metin tur="kucuk" renk={renk.metin} style={{ marginTop: baslik ? 2 : 0 }}>{metin}</Metin> : null}
        {eylem ? <Metin tur="kucukKalin" renk={t.on} style={{ marginTop: 6, textDecorationLine: "underline" }} onPress={onEylem} accessibilityRole="button">{eylem}</Metin> : null}
      </View>
    </View>
  );
}
