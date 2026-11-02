import React, { useMemo, useRef, useState } from "react";
import {
  View, Text, Image, TouchableOpacity, Modal, ActivityIndicator,
  PanResponder, useWindowDimensions, StyleSheet, Platform, Alert,
} from "react-native";

/* 10.09.2026 (saha talebi): Fiş fotoğrafı çekildikten sonra kırpma yapılamıyordu.
   expo-image-picker'ın allowsEditing'i iOS'ta ZORUNLU KARE kırpma veriyor; fişler
   uzun ve dar olduğu için altı kesiliyordu. Çözüm: platform bağımsız kendi kırpma ekranımız.
   20.10.2026 (Orhan): manipulateAsync düzeltmesi + kırpma künyesi (build 28).
   24.10.2026 (Orhan): OTOMATİK FİŞ KIRPMA — kırpma artık SUNUCUDA, orijinal fotoğraftan yapılır
   (POST /hr/masraf-belge/:kalemId/isle → önizleme; onay → sunucu kırpar ve ek yapar). Bu ekran
   "Kırpmayı düzelt / Elle kırp" ekranıdır: dört köşe BAĞIMSIZ sürüklenir (eğik çekimde perspektif
   düzeltilir), "Döndür" belgenin üst kenarını değiştirir. Görüntü sunucunun gönderdiği yönlendirilmiş
   önizlemedir (EXIF belirsizliği yok); koordinatlar sunucunun fotoğraf ölçüsüne (olcu) çevrilip
   onTamam(kose) ile döner — köşe sırası belgeye göre: sol üst, sağ üst, sağ alt, sol alt. */

const TUTAMAC = 44;      // köşe tutamağının dokunma alanı

// gomulu=true → kendi Modal'ını AÇMAZ, bulunduğu Modal'ın içinde tam ekran katman olarak çizilir
// (iOS aynı anda iki Modal göstermiyor; 17.09.2026).
export default function FisKirpma({ uri, olcu, baslangic, gorunur, onIptal, onTamam, gomulu = false, isliyor = false, baslik }) {
  const { width: EKRAN_W, height: EKRAN_H } = useWindowDimensions();
  const [kose, setKose] = useState(null);   // ekran koordinatı [{x,y}×4]
  const koseRef = useRef(null);
  const basRef = useRef(null);

  // Görüntüyü "contain" ile yerleştir: alan = ekran − üst bar − alt bar (tutamaklar için kenar boşluğu)
  const yerlesim = useMemo(() => {
    if (!olcu?.w || !olcu?.h) return null;
    const ustBar = Platform.OS === "ios" ? 112 : 88, altBar = Platform.OS === "ios" ? 104 : 90, kenar = 22;
    const aw = EKRAN_W - kenar * 2, ah = Math.max(120, EKRAN_H - ustBar - altBar - kenar * 2);
    const oran = Math.min(aw / olcu.w, ah / olcu.h);
    const w = olcu.w * oran, h = olcu.h * oran;
    return { x: kenar + (aw - w) / 2, y: ustBar + kenar + (ah - h) / 2, w, h, oran };
  }, [olcu, EKRAN_W, EKRAN_H]);

  const ekranaCevir = (q) => q.map(([x, y]) => ({ x: yerlesim.x + x * yerlesim.oran, y: yerlesim.y + y * yerlesim.oran }));
  const varsayilan = () => {
    const m = 0.07;
    return [[olcu.w * m, olcu.h * m], [olcu.w * (1 - m), olcu.h * m], [olcu.w * (1 - m), olcu.h * (1 - m)], [olcu.w * m, olcu.h * (1 - m)]];
  };
  const sifirla = () => {
    if (!yerlesim) return;
    const k = ekranaCevir(Array.isArray(baslangic) && baslangic.length === 4 ? baslangic : varsayilan());
    setKose(k); koseRef.current = k;
  };
  React.useEffect(() => { if (gorunur) sifirla(); }, [yerlesim, baslangic, gorunur]);

  const sinirla = (p) => ({
    x: Math.max(yerlesim.x, Math.min(yerlesim.x + yerlesim.w, p.x)),
    y: Math.max(yerlesim.y, Math.min(yerlesim.y + yerlesim.h, p.y)),
  });
  const yapPan = (i) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { basRef.current = koseRef.current?.[i]; },
    onPanResponderMove: (_e, g) => {
      const b = basRef.current; if (!b || !koseRef.current) return;
      const k = koseRef.current.slice();
      k[i] = sinirla({ x: b.x + g.dx, y: b.y + g.dy });
      koseRef.current = k; setKose(k);
    },
  });
  const panlar = useMemo(() => [0, 1, 2, 3].map(yapPan), [yerlesim]);

  // Belgenin üstü bir sonraki kenar olur: çıktı 90° saat yönünde döner
  const dondur = () => {
    const k = koseRef.current; if (!k) return;
    const y = [k[3], k[0], k[1], k[2]];
    koseRef.current = y; setKose(y);
  };

  const disbukey = (k) => {
    let isaret = 0;
    for (let i = 0; i < 4; i++) {
      const a = k[i], b = k[(i + 1) % 4], c = k[(i + 2) % 4];
      const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(z) < 1e-6) continue;
      if (!isaret) isaret = Math.sign(z); else if (Math.sign(z) !== isaret) return false;
    }
    return isaret !== 0;
  };
  const tamam = () => {
    const k = koseRef.current; if (!k || !yerlesim) return;
    if (!disbukey(k)) { Alert.alert("Köşeler çaprazlandı", "Köşeleri fişin dört köşesine sırasıyla yerleştirin."); return; }
    onTamam(k.map((p) => [Math.round(((p.x - yerlesim.x) / yerlesim.oran) * 10) / 10, Math.round(((p.y - yerlesim.y) / yerlesim.oran) * 10) / 10]));
  };

  const cizgi = (a, b, renk, kalin = 2) => {
    const L = Math.hypot(b.x - a.x, b.y - a.y), aci = Math.atan2(b.y - a.y, b.x - a.x);
    return { position: "absolute", left: (a.x + b.x) / 2 - L / 2, top: (a.y + b.y) / 2 - kalin / 2, width: L, height: kalin,
      backgroundColor: renk, transform: [{ rotate: `${aci}rad` }] };
  };

  const icerik = (
      <View style={[st.kap, gomulu ? { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: 50, elevation: 50 } : null]}>
        <View style={st.ustBar}>
          <Text style={st.baslik}>{baslik || "Kırpmayı düzelt"}</Text>
          <Text style={st.altBaslik}>Dört köşeyi fişin köşelerine sürükleyin. Sarı kenar fişin üstüdür — ters ise ↻ Döndür.</Text>
        </View>

        {yerlesim && (
          <Image source={{ uri }} style={{ position: "absolute", left: yerlesim.x, top: yerlesim.y, width: yerlesim.w, height: yerlesim.h }} resizeMode="contain" />
        )}

        {kose && yerlesim && (
          <>
            {kose.map((a, i) => <View key={`c${i}`} pointerEvents="none" style={cizgi(a, kose[(i + 1) % 4], i === 0 ? "#facc15" : "#22d3ee", i === 0 ? 4 : 2)} />)}
            <View pointerEvents="none" style={[st.ustEtiket, { left: (kose[0].x + kose[1].x) / 2 - 24, top: (kose[0].y + kose[1].y) / 2 - 26 }]}>
              <Text style={st.ustEtiketTxt}>▲ ÜST</Text>
            </View>
            {kose.map((p, i) => (
              <View key={`t${i}`} {...panlar[i].panHandlers} style={[st.tutamac, { left: p.x - TUTAMAC / 2, top: p.y - TUTAMAC / 2 }]}>
                <View style={[st.nokta, i === 0 || i === 1 ? { borderColor: "#facc15" } : null]} />
              </View>
            ))}
          </>
        )}

        {!yerlesim && <ActivityIndicator size="large" color="#fff" style={{ marginTop: 200 }} />}

        <View style={st.altBar}>
          <TouchableOpacity onPress={onIptal} disabled={isliyor} style={[st.btn, st.btnIptal]}>
            <Text style={st.btnIptalTxt}>Vazgeç</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={dondur} disabled={isliyor} style={[st.btn, st.btnDuz]}>
            <Text style={st.btnDuzTxt}>↻ Döndür</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={sifirla} disabled={isliyor} style={[st.btn, st.btnDuz]}>
            <Text style={st.btnDuzTxt}>Sıfırla</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={tamam} disabled={isliyor || !kose} style={[st.btn, st.btnOk]}>
            {isliyor ? <ActivityIndicator color="#fff" /> : <Text style={st.btnOkTxt}>✂️ Kırp ve Ekle</Text>}
          </TouchableOpacity>
        </View>
      </View>
  );
  if (gomulu) return gorunur ? icerik : null;
  return (
    <Modal visible={!!gorunur} animationType="slide" onRequestClose={onIptal} statusBarTranslucent>
      {icerik}
    </Modal>
  );
}

const st = StyleSheet.create({
  kap: { flex: 1, backgroundColor: "#000" },
  ustBar: { paddingTop: Platform.OS === "ios" ? 54 : 30, paddingBottom: 10, paddingHorizontal: 18, backgroundColor: "#000" },
  baslik: { color: "#fff", fontSize: 17, fontWeight: "800" },
  altBaslik: { color: "#9ca3af", fontSize: 12.5, marginTop: 2 },
  tutamac: { position: "absolute", width: TUTAMAC, height: TUTAMAC, alignItems: "center", justifyContent: "center" },
  nokta: { width: 22, height: 22, borderRadius: 11, borderWidth: 3, borderColor: "#22d3ee", backgroundColor: "rgba(0,0,0,0.35)" },
  ustEtiket: { position: "absolute", width: 48, alignItems: "center", backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 6, paddingVertical: 1 },
  ustEtiketTxt: { color: "#facc15", fontSize: 10.5, fontWeight: "800" },
  altBar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: 6, padding: 12, paddingBottom: Platform.OS === "ios" ? 30 : 16, backgroundColor: "#000" },
  btn: { flex: 1, borderRadius: 11, paddingVertical: 13, alignItems: "center", justifyContent: "center" },
  btnIptal: { backgroundColor: "#1f2937" },
  btnIptalTxt: { color: "#d1d5db", fontWeight: "700", fontSize: 13 },
  btnDuz: { backgroundColor: "#374151" },
  btnDuzTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
  btnOk: { backgroundColor: "#0f766e", flex: 1.5 },
  btnOkTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },
});
