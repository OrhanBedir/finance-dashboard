import React from "react";
import { View, Text, StyleSheet } from "react-native";

/* 02.11.2026 (Orhan): iş avansı red / yeniden gönderim bileşenleri — web ile aynı sunucu alanları:
   t.red {aciklama, reddeden_ad, zaman, asama_tr, not, tur_no}, t.tur_no, t.gonderim {aciklama, degisen, gonderen_ad, zaman},
   t.onceki_red {aciklama, reddeden_ad, asama_tr, tur_no}. Eski kayıtta eksik bilgi açıkça yazılır; gerekçe uydurulmaz. */
export const avansZaman = (z) => {
  if (!z) return null;
  try { return new Date(z).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch (_) { try { const d = new Date(z); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; } catch (__) { return String(z); } }
};
const ALAN_AD = { tutar: "Tutar", tarih: "Tarih", gider_turu: "Gider türü", bolge: "Bölge", proje: "Proje", plaka: "Plaka", arac_km: "Araç KM", aciklama: "Açıklama", not_aciklama: "Not", son_odeme_tarihi: "Son ödeme günü", firma: "Firma" };
const deger = (k, v) => (v == null || v === "" ? "—" : k === "tutar" ? `${Number(v).toLocaleString("tr-TR")} ₺` : String(v));

export function AvansGonderimRozeti({ t }) {
  if (!t || !(Number(t.tur_no) > 1)) return null;
  return <View style={st.rozet}><Text style={st.rozetTxt}>🔁 Yeniden gönderildi · {t.tur_no}. gönderim</Text></View>;
}

export function AvansRedKutusu({ t }) {
  const r = t && t.red; if (!r) return null;
  return (
    <View style={st.red}>
      <Text style={st.redBaslik}>❌ Reddedildi{r.tur_no > 1 ? ` (${r.tur_no}. gönderim)` : ""}{t.duzeltilebilir ? " · Düzeltmeniz bekleniyor" : ""}</Text>
      <Text style={st.redTxt}><Text style={{ fontWeight: "800" }}>Gerekçe: </Text>{r.aciklama || <Text style={{ fontStyle: "italic", color: "#B45309" }}>{r.not || "Eski kayıtta red gerekçesi bulunmuyor"}</Text>}</Text>
      <Text style={st.redAlt}>Reddeden: {r.reddeden_ad || r.reddeden_email || "bilinmiyor"} · {r.zaman ? avansZaman(r.zaman) : "eski kayıtta tarih bilgisi yok"}</Text>
      <Text style={st.redAlt}>Aşama: {r.asama_tr || "eski kayıtta aşama bilgisi yok"}</Text>
    </View>
  );
}

export function AvansGonderimDetayi({ t }) {
  if (!t || !(Number(t.tur_no) > 1)) return null;
  const d = (t.gonderim && t.gonderim.degisen) || {};
  const keys = Object.keys(d);
  return (
    <View style={st.mor}>
      <Text style={st.morBaslik}>🔁 {t.tur_no}. gönderim{t.gonderim?.gonderen_ad ? ` · ${t.gonderim.gonderen_ad}` : ""}{t.gonderim?.zaman ? ` · ${avansZaman(t.gonderim.zaman)}` : ""}</Text>
      {t.onceki_red ? <Text style={st.morTxt}><Text style={{ fontWeight: "800" }}>Önceki red ({t.onceki_red.tur_no}. gönderim): </Text>{t.onceki_red.aciklama || "gerekçe kayıtlı değil"} — {t.onceki_red.reddeden_ad || t.onceki_red.reddeden_email || ""}{t.onceki_red.asama_tr ? `, ${t.onceki_red.asama_tr}` : ""}</Text> : null}
      <Text style={st.morTxt}><Text style={{ fontWeight: "800" }}>Personelin düzeltme açıklaması: </Text>{t.gonderim?.aciklama || "—"}</Text>
      <Text style={st.morTxt}><Text style={{ fontWeight: "800" }}>Değişen alanlar: </Text>{keys.length ? keys.map((k) => `${ALAN_AD[k] || k}: ${deger(k, d[k].eski)} → ${deger(k, d[k].yeni)}`).join(" · ") : "yok (yalnız açıklama eklendi)"}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  rozet: { alignSelf: "flex-start", backgroundColor: "#EDE9FE", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, marginTop: 6 },
  rozetTxt: { color: "#5B21B6", fontSize: 11, fontWeight: "800" },
  red: { backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA", borderRadius: 10, padding: 10, marginTop: 8 },
  redBaslik: { color: "#7F1D1D", fontWeight: "800", fontSize: 13 }, redTxt: { color: "#7F1D1D", fontSize: 13, marginTop: 3, lineHeight: 19 }, redAlt: { color: "#991B1B", fontSize: 11.5, marginTop: 2 },
  mor: { backgroundColor: "#F5F3FF", borderWidth: 1, borderColor: "#DDD6FE", borderRadius: 10, padding: 10, marginTop: 8 },
  morBaslik: { color: "#3B0764", fontWeight: "800", fontSize: 13 }, morTxt: { color: "#3B0764", fontSize: 12.5, marginTop: 3, lineHeight: 18 },
});
