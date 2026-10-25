// Form bileşenleri: metin alanı, tutar, seçim listesi (arama destekli alt sayfa), tarih, seçenek çipleri.
import React, { useId, useMemo, useState } from "react";
import { FlatList, InputAccessoryView, Keyboard, Modal, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { aralik, DOKUNMA, kose, renk, yazi } from "../tema";
import { Buton, Metin } from "./temel";
import { tarih, tarihUzun, isoGun } from "../mantik/bicim";

function Etiket({ etiket, zorunlu, yardim }) {
  return (
    <View style={{ marginBottom: 6 }}>
      <Metin tur="etiket" renk={renk.metinIkincil}>
        {etiket}{zorunlu ? <Metin tur="etiket" renk={renk.hata}> *</Metin> : null}
      </Metin>
      {yardim ? <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: 2 }}>{yardim}</Metin> : null}
    </View>
  );
}

// iOS sayısal klavyede "Tamam" tuşu yok: klavyenin üstüne kapatma çubuğu eklenir
const SAYISAL = ["decimal-pad", "number-pad", "numeric", "phone-pad"];
function KlavyeCubugu({ kimlik }) {
  if (Platform.OS !== "ios") return null;
  return (
    <InputAccessoryView nativeID={kimlik}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", backgroundColor: "#F1F3F6", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: renk.cizgiKoyu, paddingHorizontal: aralik.s }}>
        <Pressable onPress={() => Keyboard.dismiss()} accessibilityRole="button" accessibilityLabel="Klavyeyi kapat" style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: aralik.s }}>
          <Metin tur="govdeKalin" renk={renk.lacivertAcik}>Tamam</Metin>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

export function Alan({ etiket, zorunlu, yardim, hata, deger, onDegis, ipucu, cokSatir, klavye, buyukHarf = "sentences", style, devreDisi, sonEk, ...p }) {
  const [odak, setOdak] = useState(false);
  const cubukKimligi = `klavye-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const sayisal = SAYISAL.includes(klavye);
  return (
    <View style={[{ marginBottom: aralik.m }, style]}>
      {etiket ? <Etiket etiket={etiket} zorunlu={zorunlu} yardim={yardim} /> : null}
      <View style={[f.kutu, odak && f.kutuOdak, hata && f.kutuHata, devreDisi && { backgroundColor: renk.yuzeyIkincil }, cokSatir && { alignItems: "flex-start" }]}>
        <TextInput
          value={deger}
          onChangeText={onDegis}
          placeholder={ipucu}
          placeholderTextColor={renk.metinSoluk}
          multiline={cokSatir}
          keyboardType={klavye || "default"}
          autoCapitalize={buyukHarf}
          editable={!devreDisi}
          onFocus={() => setOdak(true)}
          onBlur={() => setOdak(false)}
          accessibilityLabel={etiket}
          inputAccessoryViewID={sayisal && Platform.OS === "ios" ? cubukKimligi : undefined}
          style={[yazi.govde, f.girdi, cokSatir && { minHeight: 88, textAlignVertical: "top", paddingTop: 12 }]}
          {...p}
        />
        {sayisal ? <KlavyeCubugu kimlik={cubukKimligi} /> : null}
        {sonEk ? <Metin tur="govdeKalin" renk={renk.metinIkincil} style={{ marginRight: aralik.s }}>{sonEk}</Metin> : null}
      </View>
      {hata ? <Metin tur="minik" renk={renk.hata} style={{ marginTop: 4 }} accessibilityRole="alert">{hata}</Metin> : null}
    </View>
  );
}

export function TutarAlani(p) {
  return <Alan klavye="decimal-pad" ipucu="0,00" sonEk="₺" buyukHarf="none" {...p} />;
}

// Seçim alanı: dokununca alt sayfada liste açılır; uzun listelerde arama kutusu
export function SecimAlani({ etiket, zorunlu, hata, deger, secenekler, onSec, ipucu = "Seçin", aramali, etiketGetir = (x) => x?.ad ?? String(x), anahtarGetir = (x) => x?.id ?? String(x), style, yardim }) {
  const [acik, setAcik] = useState(false);
  const [ara, setAra] = useState("");
  const alt = useSafeAreaInsets().bottom;
  const secili = secenekler.find((s) => anahtarGetir(s) === deger);
  const liste = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase("tr-TR");
    return q ? secenekler.filter((s) => etiketGetir(s).toLocaleLowerCase("tr-TR").includes(q)) : secenekler;
  }, [ara, secenekler, etiketGetir]);
  return (
    <View style={[{ marginBottom: aralik.m }, style]}>
      {etiket ? <Etiket etiket={etiket} zorunlu={zorunlu} yardim={yardim} /> : null}
      <Pressable onPress={() => { setAra(""); setAcik(true); }} accessibilityRole="button" accessibilityLabel={`${etiket}: ${secili ? etiketGetir(secili) : ipucu}`}
        style={[f.kutu, hata && f.kutuHata]}>
        <Metin tur="govde" renk={secili ? renk.metin : renk.metinSoluk} style={{ flex: 1, paddingHorizontal: aralik.s }} numberOfLines={1}>
          {secili ? etiketGetir(secili) : ipucu}
        </Metin>
        <Ionicons name="chevron-down" size={18} color={renk.metinSoluk} style={{ marginRight: aralik.s }} />
      </Pressable>
      {hata ? <Metin tur="minik" renk={renk.hata} style={{ marginTop: 4 }}>{hata}</Metin> : null}
      <Modal visible={acik} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAcik(false)}>
        <View style={{ flex: 1, backgroundColor: renk.yuzey }}>
          <View style={f.sayfaBaslik}>
            <Metin tur="baslikM" style={{ flex: 1, fontWeight: "700" }}>{etiket}</Metin>
            <Pressable onPress={() => setAcik(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Kapat"
              style={{ width: DOKUNMA, height: DOKUNMA, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="close" size={26} color={renk.metin} />
            </Pressable>
          </View>
          {aramali ? (
            <View style={[f.kutu, { marginHorizontal: aralik.m, marginBottom: aralik.xs }]}>
              <Ionicons name="search" size={18} color={renk.metinSoluk} style={{ marginLeft: aralik.s }} />
              <TextInput value={ara} onChangeText={setAra} placeholder="Ara" placeholderTextColor={renk.metinSoluk} autoCorrect={false}
                style={[yazi.govde, f.girdi]} accessibilityLabel="Listede ara" />
            </View>
          ) : null}
          <FlatList
            data={liste}
            keyExtractor={(x) => String(anahtarGetir(x))}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: alt + aralik.l }}
            ListEmptyComponent={<Metin tur="kucuk" renk={renk.metinIkincil} style={{ textAlign: "center", padding: aralik.l }}>Sonuç yok</Metin>}
            renderItem={({ item }) => {
              const sec = anahtarGetir(item) === deger;
              return (
                <Pressable onPress={() => { onSec(anahtarGetir(item), item); setAcik(false); }} accessibilityRole="button" accessibilityState={{ selected: sec }}
                  style={({ pressed }) => [f.secenek, pressed && { backgroundColor: renk.yuzeyIkincil }]}>
                  <Metin tur={sec ? "govdeKalin" : "govde"} style={{ flex: 1 }}>{etiketGetir(item)}</Metin>
                  {sec ? <Ionicons name="checkmark" size={22} color={renk.lacivert} /> : null}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

// Tarih: değer "YYYY-MM-DD"; gelecek tarih seçilemez
export function TarihAlani({ etiket, zorunlu, deger, onDegis, style, enGec = new Date() }) {
  const [acik, setAcik] = useState(false);
  const [gecici, setGecici] = useState(null);
  const alt = useSafeAreaInsets().bottom;
  const d = deger ? new Date(`${deger}T12:00:00`) : new Date();
  return (
    <View style={[{ marginBottom: aralik.m }, style]}>
      {etiket ? <Etiket etiket={etiket} zorunlu={zorunlu} /> : null}
      <Pressable onPress={() => { setGecici(d); setAcik(true); }} accessibilityRole="button" accessibilityLabel={`${etiket}: ${tarihUzun(deger)}`} style={f.kutu}>
        <Ionicons name="calendar-outline" size={18} color={renk.metinIkincil} style={{ marginLeft: aralik.s }} />
        <Metin tur="govde" style={{ flex: 1, paddingHorizontal: aralik.xs }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{tarih(deger) || "Tarih seçin"}</Metin>
      </Pressable>
      <Modal visible={acik} transparent animationType="fade" onRequestClose={() => setAcik(false)}>
        <Pressable style={f.perde} onPress={() => setAcik(false)} accessibilityLabel="Kapat" />
        <View style={[f.altSayfa, { paddingBottom: alt + aralik.m }]}>
          <Metin tur="baslikM" style={{ fontWeight: "700", marginBottom: aralik.xs }}>{etiket || "Tarih"}</Metin>
          <DateTimePicker
            value={gecici || d}
            mode="date"
            display={Platform.OS === "ios" ? "inline" : "default"}
            maximumDate={enGec}
            locale="tr-TR"
            accentColor={renk.lacivert}
            themeVariant="light"
            onChange={(_, secilen) => { if (secilen) setGecici(secilen); if (Platform.OS !== "ios") { setAcik(false); if (secilen) onDegis(isoGun(secilen)); } }}
          />
          <Buton baslik="Tamam" onPress={() => { onDegis(isoGun(gecici || d)); setAcik(false); }} style={{ marginTop: aralik.s }} />
        </View>
      </Modal>
    </View>
  );
}

// Tek seçimli çipler (az seçenekli alanlar için listeden daha hızlı)
export function CipSecim({ etiket, zorunlu, hata, secenekler, deger, onSec, style }) {
  return (
    <View style={[{ marginBottom: aralik.m }, style]}>
      {etiket ? <Etiket etiket={etiket} zorunlu={zorunlu} /> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: aralik.xs }}>
        {secenekler.map((s) => {
          const k = s.id ?? s, ad = s.ad ?? s, sec = k === deger;
          return (
            <Pressable key={k} onPress={() => onSec(k)} accessibilityRole="radio" accessibilityState={{ selected: sec }}
              style={[f.cip, sec && f.cipSecili]}>
              {s.ikon ? <Ionicons name={s.ikon} size={16} color={sec ? "#fff" : renk.lacivert} style={{ marginRight: 6 }} /> : null}
              <Metin tur="kucukKalin" renk={sec ? "#fff" : renk.metin}>{ad}</Metin>
            </Pressable>
          );
        })}
      </View>
      {hata ? <Metin tur="minik" renk={renk.hata} style={{ marginTop: 4 }}>{hata}</Metin> : null}
    </View>
  );
}

const f = StyleSheet.create({
  kutu: { flexDirection: "row", alignItems: "center", minHeight: DOKUNMA + 2, backgroundColor: renk.yuzey, borderRadius: kose.m, borderWidth: 1, borderColor: renk.cizgiKoyu },
  kutuOdak: { borderColor: renk.lacivert, borderWidth: 1.5 },
  kutuHata: { borderColor: renk.hata },
  girdi: { flex: 1, color: renk.metin, paddingHorizontal: aralik.s, paddingVertical: 12 },
  sayfaBaslik: { flexDirection: "row", alignItems: "center", paddingLeft: aralik.m, paddingRight: aralik.xs, paddingTop: aralik.s, paddingBottom: aralik.xs },
  secenek: { flexDirection: "row", alignItems: "center", minHeight: DOKUNMA + 4, paddingHorizontal: aralik.m, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: renk.cizgi },
  perde: { flex: 1, backgroundColor: "rgba(15,27,45,0.35)" },
  altSayfa: { backgroundColor: renk.yuzey, borderTopLeftRadius: kose.l, borderTopRightRadius: kose.l, padding: aralik.m },
  cip: { flexDirection: "row", alignItems: "center", minHeight: 42, paddingHorizontal: 14, borderRadius: kose.tam, borderWidth: 1, borderColor: renk.cizgiKoyu, backgroundColor: renk.yuzey },
  cipSecili: { backgroundColor: renk.lacivert, borderColor: renk.lacivert },
});
