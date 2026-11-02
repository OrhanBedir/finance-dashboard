import React, { useEffect, useState } from "react";
import {
  View, Text, Image, TouchableOpacity, ActivityIndicator, ScrollView, StyleSheet, Platform, useWindowDimensions,
} from "react-native";

/* 24.10.2026 (Orhan): OTOMATİK FİŞ KIRPMA sonuç ekranı. Fotoğraf çekilince/seçilince sunucu fişi bulur ve
   kırpılmış önizleme döner; bu ekran:
   - işlem sürerken "Fiş algılanıyor…" gösterir (fotoğraf telefonda kalır),
   - güvenilir sonuçta önizleme + tek dokunuşla "Devam — fişi ekle",
   - uyarılı sonuçta uyarıları açıkça yazar; ekleme için kullanıcı ya düzeltir ya da açıkça "uyarıya rağmen" seçer,
   - birden fazla fişte ayrı önizlemeler gösterir, kullanıcı seçer (hiçbiri kendiliğinden seçilmez),
   - fiş bulunamazsa / servis hatasında "Elle kırp", "Yeniden çek", "Tekrar dene" ve açıkça etiketli
     "Kırpmadan ekle" sunar. Yanlış kırpılmış belge sessizce kaydedilmez. */

const BANT = {
  GUVENILIR: ["#dcfce7", "#166534", "✂️ Fiş algılandı ve otomatik kırpıldı"],
  KONTROL: ["#fef3c7", "#92400e", "⚠️ Fiş algılandı — kırpmayı kontrol edin"],
  COKLU: ["#dbeafe", "#1e40af", "🧾 Fotoğrafta birden fazla fiş var — bu kaleme eklenecekleri seçin"],
  FIS_YOK: ["#fee2e2", "#991b1b", "Fotoğrafta fiş algılanamadı"],
  AI_HATA: ["#fee2e2", "#991b1b", "Otomatik kırpma şu an yapılamadı"],
};

export default function FisIsleme({ is, onEkle, onDuzelt, onYenidenCek, onTekrarDene, onKirpmadan, onIptal }) {
  const { width: EKRAN_W } = useWindowDimensions();
  const [secili, setSecili] = useState([]);
  const s = is?.sonuc;
  useEffect(() => { setSecili([]); }, [s?.isleme_id]);
  if (!is) return null;

  const mesgul = is.asama === "isleniyor" || is.asama === "ekleniyor";
  const durum = s?.durum;
  const adaylar = s?.adaylar || [];
  const coklu = adaylar.length > 1;
  const bant = BANT[durum];
  const onizG = coklu ? (EKRAN_W - 56) / 2 : EKRAN_W - 48;
  const sec = (no) => setSecili((x) => (x.includes(no) ? x.filter((n) => n !== no) : [...x, no]));

  const kart = (a) => {
    const oran = a.olcu?.w && a.olcu?.h ? a.olcu.w / a.olcu.h : 0.4;
    const h = Math.min(coklu ? 300 : 430, onizG / oran), w = h * oran;
    const isaretli = secili.includes(a.no);
    return (
      <TouchableOpacity key={a.no} activeOpacity={coklu ? 0.7 : 1} onPress={() => coklu && sec(a.no)}
        style={[st.kart, coklu && { width: onizG }, coklu && isaretli && st.kartSecili]}>
        {coklu && <Text style={[st.kutu, isaretli && st.kutuSecili]}>{isaretli ? "☑︎" : "☐"} Fiş {a.no}</Text>}
        <View style={{ alignItems: "center" }}>
          <Image source={{ uri: a.onizleme }} style={{ width: w, height: h, borderRadius: 6, backgroundColor: "#111" }} resizeMode="contain" />
        </View>
        {!!a.etiket && <Text style={st.etiket} numberOfLines={2}>{a.etiket}</Text>}
        {(a.uyarilar || []).map((u, i) => <Text key={i} style={st.uyari}>⚠ {u}</Text>)}
        <TouchableOpacity disabled={mesgul} onPress={() => onDuzelt(a)} style={st.linkBtn}>
          <Text style={st.linkTxt}>✂️ Kırpmayı düzelt</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <View style={st.kap}>
      <View style={st.ustBar}>
        <Text style={st.baslik}>📷 Fiş kırpma</Text>
        {!mesgul && <TouchableOpacity onPress={onIptal}><Text style={st.kapat}>Vazgeç</Text></TouchableOpacity>}
      </View>

      {is.asama === "isleniyor" && (
        <View style={st.orta}>
          <Image source={{ uri: is.foto }} style={st.bekleFoto} resizeMode="contain" blurRadius={2} />
          <ActivityIndicator size="large" color="#fff" style={{ marginTop: 18 }} />
          <Text style={st.bekleTxt}>Fiş algılanıyor ve kırpılıyor…</Text>
          <Text style={st.bekleAlt}>Genellikle 10–40 saniye sürer. Fotoğrafınız telefonda duruyor.</Text>
        </View>
      )}

      {is.asama === "ekleniyor" && (
        <View style={st.orta}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={st.bekleTxt}>Fiş masraf kalemine ekleniyor…</Text>
        </View>
      )}

      {is.asama === "hata" && (
        <View style={st.orta}>
          <Image source={{ uri: is.foto }} style={st.bekleFoto} resizeMode="contain" />
          <Text style={[st.bekleTxt, { color: "#fca5a5" }]}>{is.hata}</Text>
          <Text style={st.bekleAlt}>Fotoğraf ve masraf bilgileri kaybolmadı.</Text>
          <TouchableOpacity style={[st.btn, st.btnAna, { alignSelf: "stretch", marginTop: 16 }]} onPress={onTekrarDene}>
            <Text style={st.btnAnaTxt}>↻ Tekrar dene</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[st.btn, st.btnIkincil, { alignSelf: "stretch" }]} onPress={onYenidenCek}>
            <Text style={st.btnIkincilTxt}>📸 Yeniden çek / seç</Text>
          </TouchableOpacity>
        </View>
      )}

      {is.asama === "sonuc" && s && (
        <>
          <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 30 }}>
            {bant && (
              <View style={[st.bant, { backgroundColor: bant[0] }]}>
                <Text style={[st.bantTxt, { color: bant[1] }]}>{bant[2]}</Text>
                {durum === "AI_HATA" && !!s.mesaj && <Text style={[st.bantAlt, { color: bant[1] }]}>{s.mesaj}</Text>}
                {durum === "FIS_YOK" && <Text style={[st.bantAlt, { color: bant[1] }]}>Fişi düz bir zemine koyup tamamı görünecek şekilde yeniden çekin ya da elle kırpın.</Text>}
              </View>
            )}
            {!!is.ekleHata && <View style={[st.bant, { backgroundColor: "#fee2e2" }]}><Text style={[st.bantTxt, { color: "#991b1b" }]}>Eklenemedi: {is.ekleHata}</Text></View>}
            <View style={coklu ? st.izgara : null}>{adaylar.map(kart)}</View>
            {!adaylar.length && !!s.kaynak?.onizleme && (
              <Image source={{ uri: s.kaynak.onizleme }} style={{ width: "100%", height: 380, borderRadius: 8 }} resizeMode="contain" />
            )}
          </ScrollView>

          <View style={st.altBar}>
            {durum === "GUVENILIR" && (
              <TouchableOpacity style={[st.btn, st.btnAna]} onPress={() => onEkle([{ aday_no: adaylar[0].no }])}>
                <Text style={st.btnAnaTxt}>✓ Devam — fişi ekle</Text>
              </TouchableOpacity>
            )}
            {durum === "KONTROL" && (
              <>
                <TouchableOpacity style={[st.btn, st.btnAna]} onPress={() => onDuzelt(adaylar[0])}>
                  <Text style={st.btnAnaTxt}>✂️ Kırpmayı düzelt</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.btn, st.btnCizgi]} onPress={() => onEkle([{ aday_no: adaylar[0].no }])}>
                  <Text style={st.btnCizgiTxt}>Uyarıya rağmen bu haliyle ekle</Text>
                </TouchableOpacity>
              </>
            )}
            {durum === "COKLU" && (
              <TouchableOpacity disabled={!secili.length} style={[st.btn, st.btnAna, !secili.length && { opacity: 0.45 }]}
                onPress={() => onEkle(secili.slice().sort((a, b) => a - b).map((no) => ({ aday_no: no })))}>
                <Text style={st.btnAnaTxt}>{secili.length ? `Seçilen ${secili.length} fişi bu kaleme ekle` : "Eklenecek fişleri seçin"}</Text>
              </TouchableOpacity>
            )}
            {(durum === "FIS_YOK" || durum === "AI_HATA") && (
              <TouchableOpacity style={[st.btn, st.btnAna]} onPress={() => onDuzelt(null)}>
                <Text style={st.btnAnaTxt}>✂️ Elle kırp</Text>
              </TouchableOpacity>
            )}
            <View style={st.satir}>
              {durum === "AI_HATA" && (
                <TouchableOpacity style={[st.btn, st.btnIkincil, { flex: 1 }]} onPress={onTekrarDene}>
                  <Text style={st.btnIkincilTxt}>↻ Tekrar dene</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[st.btn, st.btnIkincil, { flex: 1 }]} onPress={onYenidenCek}>
                <Text style={st.btnIkincilTxt}>📸 Yeniden çek</Text>
              </TouchableOpacity>
              {(durum === "FIS_YOK" || durum === "AI_HATA") && (
                <TouchableOpacity style={[st.btn, st.btnIkincil, { flex: 1 }]} onPress={onKirpmadan}>
                  <Text style={st.btnIkincilTxt}>Kırpmadan ekle</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  kap: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: 40, elevation: 40, backgroundColor: "#0b1220" },
  ustBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: Platform.OS === "ios" ? 54 : 30, paddingBottom: 10, paddingHorizontal: 18 },
  baslik: { color: "#fff", fontSize: 17, fontWeight: "800" },
  kapat: { color: "#93c5fd", fontSize: 14, fontWeight: "700" },
  orta: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  bekleFoto: { width: "70%", height: "45%", opacity: 0.55, borderRadius: 8 },
  bekleTxt: { color: "#fff", fontSize: 15.5, fontWeight: "700", marginTop: 12, textAlign: "center" },
  bekleAlt: { color: "#9ca3af", fontSize: 12.5, marginTop: 6, textAlign: "center" },
  bant: { borderRadius: 10, padding: 12, marginBottom: 12 },
  bantTxt: { fontSize: 14, fontWeight: "800" },
  bantAlt: { fontSize: 12.5, marginTop: 4 },
  izgara: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  kart: { backgroundColor: "#111827", borderRadius: 12, padding: 10, marginBottom: 12, borderWidth: 2, borderColor: "#1f2937" },
  kartSecili: { borderColor: "#22c55e" },
  kutu: { color: "#d1d5db", fontWeight: "800", fontSize: 14, marginBottom: 6 },
  kutuSecili: { color: "#4ade80" },
  etiket: { color: "#cbd5e1", fontSize: 12, marginTop: 6 },
  uyari: { color: "#fcd34d", fontSize: 12.5, marginTop: 5, fontWeight: "600" },
  linkBtn: { marginTop: 8, alignSelf: "flex-start", paddingVertical: 4 },
  linkTxt: { color: "#93c5fd", fontWeight: "700", fontSize: 13 },
  altBar: { padding: 12, paddingBottom: Platform.OS === "ios" ? 30 : 14, backgroundColor: "#0b1220", borderTopWidth: 1, borderTopColor: "#1f2937", gap: 8 },
  satir: { flexDirection: "row", gap: 8 },
  btn: { borderRadius: 11, paddingVertical: 13, alignItems: "center", justifyContent: "center", marginTop: 0 },
  btnAna: { backgroundColor: "#0f766e" },
  btnAnaTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  btnIkincil: { backgroundColor: "#1f2937" },
  btnIkincilTxt: { color: "#e5e7eb", fontWeight: "700", fontSize: 13 },
  btnCizgi: { borderWidth: 1, borderColor: "#f59e0b" },
  btnCizgiTxt: { color: "#fbbf24", fontWeight: "700", fontSize: 13 },
});
