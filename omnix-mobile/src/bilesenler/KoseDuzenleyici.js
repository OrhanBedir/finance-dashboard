// "Kırpmayı düzelt / Elle kırp": dört köşe bağımsız sürüklenir (eğik çekimde perspektif sunucuda düzeltilir),
// "Döndür" belgenin üst kenarını değiştirir. Görüntü sunucunun yönlendirilmiş önizlemesidir; köşeler sunucunun
// fotoğraf ölçüsüne (olcu) çevrilip onTamam(kose) ile döner. Kırpmayı telefon yapmaz, sunucu orijinalden yapar.
// Eski ERC Operasyon uygulamasındaki FisKirpma.js mantığı referans alındı (o dosya değiştirilmedi).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, PanResponder, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { aralik, renk } from "../tema";
import { Buton, Metin } from "./temel";
import {
  dondur, disbukey, ekrandanOlcuye, gecerliKose, olcudenEkrana, sinirla, varsayilanKose, yerlesimHesapla, yeterliBuyuk,
} from "../mantik/kirpma";

const TUTAMAC = 48; // dokunma alanı (saha kullanımı)
const UST = "#F0B429", KENAR = "#38BDF8";

export function KoseDuzenleyici({ uri, olcu, baslangic, baslik = "Kırpmayı düzelt", isliyor = false, onIptal, onTamam }) {
  const kenar = useSafeAreaInsets();
  const [alan, setAlan] = useState(null);
  const [kose, setKose] = useState(null); // ekran noktaları [{x,y}×4]
  const koseRef = useRef(null);
  const basRef = useRef(null);
  const yerlesim = useMemo(() => yerlesimHesapla(olcu, alan), [olcu, alan]);

  const ayarla = (k) => { koseRef.current = k; setKose(k); };
  const sifirla = () => {
    if (!yerlesim) return;
    ayarla(olcudenEkrana(gecerliKose(baslangic) ? baslangic : varsayilanKose(olcu), yerlesim));
  };
  useEffect(sifirla, [yerlesim]); // eslint-disable-line react-hooks/exhaustive-deps

  const panlar = useMemo(() => [0, 1, 2, 3].map((i) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { basRef.current = koseRef.current?.[i]; },
    onPanResponderMove: (_e, g) => {
      const b = basRef.current;
      if (!b || !koseRef.current || !yerlesim) return;
      const k = koseRef.current.slice();
      k[i] = sinirla({ x: b.x + g.dx, y: b.y + g.dy }, yerlesim);
      ayarla(k);
    },
  })), [yerlesim]);

  const tamam = () => {
    const k = koseRef.current;
    if (!k || !yerlesim) return;
    if (!disbukey(k)) { Alert.alert("Köşeler çaprazlandı", "Köşeleri fişin dört köşesine sırasıyla yerleştirin."); return; }
    const q = ekrandanOlcuye(k, yerlesim);
    if (!yeterliBuyuk(q, olcu)) { Alert.alert("Alan çok küçük", "Çerçeveyi fişin tamamını içine alacak şekilde büyütün."); return; }
    onTamam(q);
  };

  const cizgi = (a, b, r, kalin) => {
    const L = Math.hypot(b.x - a.x, b.y - a.y), aci = Math.atan2(b.y - a.y, b.x - a.x);
    return { position: "absolute", left: (a.x + b.x) / 2 - L / 2, top: (a.y + b.y) / 2 - kalin / 2, width: L, height: kalin, backgroundColor: r, transform: [{ rotate: `${aci}rad` }] };
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#05080F" }}>
      <View style={{ paddingTop: kenar.top + aralik.xs, paddingHorizontal: aralik.m, paddingBottom: aralik.xs }}>
        <Metin tur="baslikM" renk="#fff" style={{ fontWeight: "700" }} accessibilityRole="header">{baslik}</Metin>
        <Metin tur="kucuk" renk="#AAB4C3" style={{ marginTop: 2 }}>
          Dört köşeyi fişin köşelerine sürükleyin. Altın renkli kenar fişin üstüdür; ters ise "Döndür"e dokunun.
        </Metin>
      </View>

      <View style={{ flex: 1 }} onLayout={(e) => setAlan({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {yerlesim ? (
          <Image source={{ uri }} resizeMode="contain" accessibilityLabel="Fiş fotoğrafı"
            style={{ position: "absolute", left: yerlesim.x, top: yerlesim.y, width: yerlesim.w, height: yerlesim.h }} />
        ) : null}
        {kose ? (
          <>
            {kose.map((a, i) => <View key={`c${i}`} pointerEvents="none" style={cizgi(a, kose[(i + 1) % 4], i === 0 ? UST : KENAR, i === 0 ? 4 : 2)} />)}
            <View pointerEvents="none" style={{ position: "absolute", left: (kose[0].x + kose[1].x) / 2 - 26, top: (kose[0].y + kose[1].y) / 2 - 28,
              width: 52, alignItems: "center", backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 6, paddingVertical: 1 }}>
              <Metin tur="minik" renk={UST} style={{ fontWeight: "800" }}>▲ ÜST</Metin>
            </View>
            {kose.map((p, i) => (
              <View key={`t${i}`} {...panlar[i].panHandlers} accessibilityLabel={["Sol üst", "Sağ üst", "Sağ alt", "Sol alt"][i] + " köşe"}
                style={{ position: "absolute", left: p.x - TUTAMAC / 2, top: p.y - TUTAMAC / 2, width: TUTAMAC, height: TUTAMAC, alignItems: "center", justifyContent: "center" }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 3, borderColor: i < 2 ? UST : KENAR, backgroundColor: "rgba(0,0,0,0.35)" }} />
              </View>
            ))}
          </>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", gap: aralik.xs, padding: aralik.s, paddingBottom: Math.max(kenar.bottom, aralik.s), backgroundColor: "#05080F" }}>
        <Buton baslik="Vazgeç" tur="ikincil" kucuk onPress={onIptal} devreDisi={isliyor} style={{ flex: 1 }} />
        <Buton baslik="Döndür" ikon="refresh" tur="ikincil" kucuk onPress={() => koseRef.current && ayarla(dondur(koseRef.current))} devreDisi={isliyor} style={{ flex: 1.1 }} />
        <Buton baslik="Sıfırla" tur="ikincil" kucuk onPress={sifirla} devreDisi={isliyor} style={{ flex: 1 }} />
        <Buton baslik="Kırp, ekle" ikon="crop" tur="vurgu" kucuk onPress={tamam} yukleniyor={isliyor} devreDisi={!kose} style={{ flex: 1.4 }} />
      </View>
    </View>
  );
}
