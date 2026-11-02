import React from "react";
import { View, Text, StyleSheet } from "react-native";

/* 10.09.2026 (Orhan): Mobilde bir avans/masraf formunun ONAYININ KİMDE olduğu
   görünmüyordu — PM'e "onay bekleyen" diye düşen kayıt aslında rollout müdürü
   adımındaydı, panelde doğru görünüyordu. Web'deki akış göstergesinin aynısı:
   dolu yeşil = geçilmiş adım, sarı = şu an bekleyen adım, gri = sırada.
   Altında düz Türkçe: "Sıra: Nurcan Kuş (Rollout)". */

const AVANS_ADIM = { TALEP: 0, ROLLOUT_MUDUR_ONAY: 1, PM_ONAY: 2, DIREKTOR_ONAY: 3, MUHASEBE_ONAY: 3, TAMAMLANDI: 4, REDDEDILDI: -1 };
const AVANS_ET = ["R", "PM", "PD", "M"];
const AVANS_KIMDE = {
  TALEP: "Rollout müdürü", ROLLOUT_MUDUR_ONAY: "Orhan Bedir (PM)",
  PM_ONAY: "Düzgün Şimşek (PD)", DIREKTOR_ONAY: "Muhasebe", MUHASEBE_ONAY: "Muhasebe",
  TAMAMLANDI: "Tamamlandı · ödendi", REDDEDILDI: "Reddedildi",
};

const MASRAF_ADIM = { TASLAK: 0, ROLLOUT_BEKLE: 0, MUHASEBE_BEKLE: 1, PM_BEKLE: 2, DIREKTOR_BEKLE: 3, TAMAMLANDI: 4, ARSIVLENDI: 5, REDDEDILDI: -1 };
const MASRAF_ET = ["R", "M", "PM", "PD", "A"];
const MASRAF_KIMDE = {
  TASLAK: "Sizde · gönderilmedi", ROLLOUT_BEKLE: "Nurcan Kuş (Rollout)",
  MUHASEBE_BEKLE: "Muhasebe kontrolü", PM_BEKLE: "Orhan Bedir (PM)",
  DIREKTOR_BEKLE: "Düzgün Şimşek (PD)", TAMAMLANDI: "Muhasebe (ödeme)",
  ARSIVLENDI: "Kapandı · arşivde", REDDEDILDI: "Reddedildi",
};

export default function AkisAdim({ durum, tip = "AVANS", kimdeGoster = true, style }) {
  const avans = tip === "AVANS";
  const idx = (avans ? AVANS_ADIM : MASRAF_ADIM)[durum];
  const etiketler = avans ? AVANS_ET : MASRAF_ET;
  const kimde = (avans ? AVANS_KIMDE : MASRAF_KIMDE)[durum] || durum || "—";
  if (idx === undefined) return null;
  const red = idx === -1;
  const bitti = avans ? durum === "TAMAMLANDI" : ["ARSIVLENDI"].includes(durum);

  return (
    <View style={[st.kap, style]}>
      {!red && (
        <View style={st.satir}>
          {etiketler.map((e, i) => (
            <React.Fragment key={e + i}>
              {i > 0 && <View style={[st.cizgi, { backgroundColor: i <= idx ? "#16a34a" : "#d1d5db" }]} />}
              <View style={[st.nokta, i < idx || bitti ? st.done : i === idx ? st.now : st.next]}>
                <Text style={[st.noktaTxt, i < idx || bitti ? st.doneTxt : i === idx ? st.nowTxt : st.nextTxt]}>{e}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      )}
      {kimdeGoster && (
        <Text style={[st.kimde, red && { color: "#b91c1c" }, bitti && { color: "#15803d" }]} numberOfLines={1}>
          {red || bitti ? kimde : `Sıra: ${kimde}`}
        </Text>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  kap: { marginTop: 6 },
  satir: { flexDirection: "row", alignItems: "center" },
  cizgi: { width: 12, height: 2 },
  nokta: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  noktaTxt: { fontSize: 9, fontWeight: "800" },
  done: { backgroundColor: "#16a34a", borderColor: "#16a34a" },
  doneTxt: { color: "#fff" },
  now: { backgroundColor: "#fef3c7", borderColor: "#f59e0b" },
  nowTxt: { color: "#b45309" },
  next: { backgroundColor: "#fff", borderColor: "#d1d5db" },
  nextTxt: { color: "#9ca3af" },
  kimde: { fontSize: 11.5, color: "#6b7280", fontWeight: "600", marginTop: 5 },
});
