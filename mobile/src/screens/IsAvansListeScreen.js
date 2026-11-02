import React, { useState, useEffect, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, SafeAreaView, ActivityIndicator, RefreshControl, Modal } from "react-native";
import { apiGet } from "../api";
import AkisAdim from "../components/AkisAdim";
import { AvansRedKutusu, AvansGonderimDetayi, AvansGonderimRozeti, avansZaman } from "../components/AvansRed";

/* 02.11.2026 (Orhan): İş Avanslarım — tüm liste (ana ekranda yalnız son 5 vardı). Reddedilen talepler kaybolmaz: ayrı,
   belirgin "Reddedildi · Düzeltmeniz bekleniyor" bölümünde gerekçe / reddeden / zaman / aşama ile görünür ve "Düzelt ve
   yeniden gönder" ile aynı talep kimliği altında yeni onay turu açılır. Veri web ile aynı uçtan (/hr/is-avans; sunucu
   personeli kendi kayıtlarına kilitler). Detay: /hr/is-avans/:id/detay (gönderim turları) + /islem-gecmisi/avans/:id. */

const DURUM = {
  TALEP: ["Rollout müdürü onayı bekliyor", "#F3F4F6", "#374151"], ROLLOUT_MUDUR_ONAY: ["PM onayı bekliyor", "#DBEAFE", "#1E40AF"],
  PM_ONAY: ["Direktör onayı bekliyor", "#FED7AA", "#92400E"], DIREKTOR_ONAY: ["Onaylandı · ödeme bekliyor", "#DCFCE7", "#166534"],
  TAMAMLANDI: ["Ödendi", "#DBEAFE", "#1E40AF"], REDDEDILDI: ["Reddedildi", "#FEE2E2", "#991B1B"],
};
const fmtTL = (v) => `${Number(v || 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} ₺`;
const fmtGun = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join(".") : "");
const AKTIF = ["TALEP", "ROLLOUT_MUDUR_ONAY", "PM_ONAY", "DIREKTOR_ONAY"];
const TUR_SONUC = { REDDEDILDI: ["Reddedildi", "#FEE2E2", "#991B1B"], ONAYLANDI: ["Onaylandı · ödendi", "#DCFCE7", "#166534"], ACIK: ["Onay sürecinde", "#DBEAFE", "#1E40AF"] };
const ALAN_AD = { tutar: "Tutar", tarih: "Tarih", gider_turu: "Gider türü", bolge: "Bölge", proje: "Proje", plaka: "Plaka", arac_km: "Araç KM", aciklama: "Açıklama", not_aciklama: "Not", son_odeme_tarihi: "Son ödeme günü", firma: "Firma" };
const alanDeger = (k, v) => (v == null || v === "" ? "—" : k === "tutar" ? fmtTL(v) : String(v));

function Kart({ a, onDetay, onDuzelt }) {
  const d = DURUM[a.durum] || [a.durum, "#F3F4F6", "#6B7280"];
  return (
    <View style={[st.card, a.duzeltilebilir && st.cardRed]}>
      <View style={st.row}>
        <Text style={st.title} numberOfLines={1}>{a.gider_turu || "—"}{a.proje ? ` · ${a.proje}` : ""}</Text>
        <View style={[st.pill, { backgroundColor: d[1] }]}><Text style={[st.pillTxt, { color: d[2] }]}>{d[0]}</Text></View>
      </View>
      <View style={st.row}>
        <Text style={st.amt}>{fmtTL(a.tutar)}</Text>
        <Text style={st.date}>AV-{a.id} · {fmtGun(a.tarih)}{a.bolge ? ` · ${a.bolge}` : ""}</Text>
      </View>
      {a.aciklama ? <Text style={st.ack} numberOfLines={2}>{a.aciklama}</Text> : null}
      <AvansGonderimRozeti t={a} />
      {a.red ? <AvansRedKutusu t={a} /> : null}
      {!a.red && AKTIF.includes(a.durum) ? <AkisAdim durum={a.durum} tip="AVANS" /> : null}
      <View style={st.btnRow}>
        <TouchableOpacity style={[st.btn, st.btnGhost]} onPress={() => onDetay(a)}><Text style={st.btnGhostTxt}>🕘 Detay / geçmiş</Text></TouchableOpacity>
        {a.duzeltilebilir ? <TouchableOpacity style={[st.btn, st.btnRed]} onPress={() => onDuzelt(a)}><Text style={st.btnRedTxt}>🔁 Düzelt ve yeniden gönder</Text></TouchableOpacity> : null}
      </View>
    </View>
  );
}

export function AvansDetayModal({ talep, onClose, onDuzelt }) {
  const [detay, setDetay] = useState(null);
  const [gecmis, setGecmis] = useState(null);
  useEffect(() => {
    if (!talep) { setDetay(null); setGecmis(null); return; }
    let iptal = false;
    apiGet(`/hr/is-avans/${talep.id}/detay`).then((d) => { if (!iptal) setDetay(d && d.ok ? d : { hata: d?.error || "Detay alınamadı" }); }).catch((e) => { if (!iptal) setDetay({ hata: e.message }); });
    apiGet(`/islem-gecmisi/avans/${talep.id}`).then((d) => { if (!iptal) setGecmis(d && d.ok ? d.olaylar || [] : []); }).catch(() => { if (!iptal) setGecmis([]); });
    return () => { iptal = true; };
  }, [talep?.id]);
  if (!talep) return null;
  const t = detay?.talep || talep;
  const TIP = { OLUSTURMA: "Oluşturuldu", DUZENLEME: "Düzenlendi", ONAY: "Onaylandı", ODEME: "Ödendi", RED: "Reddedildi", YENIDEN_GONDERIM: "Düzeltilip yeniden gönderildi", YONLENDIRME: "Onay zincirine yönlendirildi", SILME: "Silindi", DUZELTME: "Düzeltme" };
  return (
    <Modal visible={!!talep} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
        <View style={st.mHeader}>
          <View style={{ flex: 1 }}><Text style={st.mTitle}>İş Avansı AV-{t.id}</Text><Text style={st.mSub}>{fmtTL(t.tutar)} · {fmtGun(t.tarih)} · {t.gider_turu || ""}</Text></View>
          <TouchableOpacity onPress={onClose} style={{ padding: 4 }}><Text style={{ fontSize: 22, color: "#93C5FD" }}>✕</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {[["Durum", (DURUM[t.durum] || [t.durum])[0]], ["Gönderim", `${t.tur_no || 1}. gönderim`], ["Bölge", t.bolge], ["Proje", t.proje], ["Plaka", t.plaka], ["Açıklama", t.aciklama], ["Not", t.not_aciklama], ["Son ödeme günü", fmtGun(t.son_odeme_tarihi) || null]]
            .filter(([, v]) => v).map(([l, v]) => (
              <View key={l} style={st.mRow}><Text style={st.mLabel}>{l}</Text><Text style={st.mVal}>{v}</Text></View>
            ))}
          {t.red ? <View style={{ marginTop: 12 }}><AvansRedKutusu t={t} /></View> : null}
          {Number(t.tur_no) > 1 ? <View style={{ marginTop: 10 }}><AvansGonderimDetayi t={t} /></View> : null}
          {t.duzeltilebilir && onDuzelt ? (
            <TouchableOpacity style={[st.btn, st.btnRed, { marginTop: 14, paddingVertical: 14 }]} onPress={() => { onClose(); setTimeout(() => onDuzelt(t), 250); }}>
              <Text style={[st.btnRedTxt, { fontSize: 15 }]}>🔁 Düzelt ve yeniden gönder</Text>
            </TouchableOpacity>
          ) : null}

          <Text style={st.secTitle}>Gönderimler {detay?.turlar ? `(${detay.turlar.length})` : ""}</Text>
          {!detay ? <ActivityIndicator style={{ marginTop: 8 }} /> : detay.hata ? <Text style={st.err}>{detay.hata}</Text> : (detay.turlar || []).map((tr) => {
            const s = TUR_SONUC[tr.sonuc] || [tr.sonuc || "—", "#F3F4F6", "#6B7280"]; const dg = tr.degisen || {};
            return (
              <View key={tr.tur_no} style={st.tur}>
                <View style={st.row}><Text style={st.turTitle}>{tr.tur_no}. gönderim{tr.aktif ? " · aktif" : ""}</Text><View style={[st.pill, { backgroundColor: s[1] }]}><Text style={[st.pillTxt, { color: s[2] }]}>{s[0]}</Text></View></View>
                <Text style={st.turSub}>{tr.gonderen_ad || tr.gonderen_email || ""} · {avansZaman(tr.gonderim_zamani) || "—"}</Text>
                {tr.gonderim_aciklama ? <Text style={st.turTxt}><Text style={{ fontWeight: "800" }}>Düzeltme açıklaması: </Text>{tr.gonderim_aciklama}</Text> : null}
                {Object.keys(dg).length ? <Text style={st.turTxt}><Text style={{ fontWeight: "800" }}>Değişen: </Text>{Object.entries(dg).map(([k, v]) => `${ALAN_AD[k] || k}: ${alanDeger(k, v.eski)} → ${alanDeger(k, v.yeni)}`).join(" · ")}</Text> : null}
                {tr.alanlar ? <Text style={[st.turTxt, { color: "#6B7280" }]}>{[["tutar", tr.alanlar.tutar], ["tarih", tr.alanlar.tarih], ["gider_turu", tr.alanlar.gider_turu], ["bolge", tr.alanlar.bolge]].filter(([, v]) => v != null && v !== "").map(([k, v]) => `${ALAN_AD[k]}: ${alanDeger(k, v)}`).join(" · ")}{tr.alanlar.aciklama ? ` · Açıklama: ${tr.alanlar.aciklama}` : ""}</Text> : null}
                {tr.red ? <Text style={[st.turTxt, { color: "#991B1B" }]}><Text style={{ fontWeight: "800" }}>Red: </Text>{tr.red.aciklama || "eski kayıtta red gerekçesi bulunmuyor"} — {tr.red.reddeden_ad || tr.red.reddeden_email || "bilinmiyor"} · {tr.red.zaman ? avansZaman(tr.red.zaman) : "tarih yok"} · {tr.red.asama_tr || "aşama bilgisi yok"}</Text> : null}
              </View>
            );
          })}

          <Text style={st.secTitle}>İşlem geçmişi</Text>
          {!gecmis ? <ActivityIndicator style={{ marginTop: 8 }} /> : gecmis.length === 0 ? <Text style={st.turSub}>Kayıtlı işlem yok</Text> : gecmis.map((o, i) => (
            <View key={i} style={st.olay}>
              <Text style={st.olayTitle}>{TIP[o.tip] || o.baslik || o.tip} <Text style={st.turSub}>· {o.zaman ? (o.sadeceTarih ? fmtGun(o.zaman) : avansZaman(o.zaman)) : "tarih bilinmiyor"}</Text></Text>
              <Text style={st.turSub}>{o.kim?.ad || "—"}</Text>
              {(o.detay || []).map((d, j) => <Text key={j} style={st.turTxt}>{d}</Text>)}
              {o.gerekce ? <Text style={[st.turTxt, { color: "#9A3412" }]}>Not / gerekçe: {o.gerekce}</Text> : null}
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

export default function IsAvansListeScreen({ navigation, user }) {
  const [rows, setRows] = useState(null);
  const [hata, setHata] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [detay, setDetay] = useState(null);
  const yukle = useCallback(async () => {
    try { setHata(""); const d = await apiGet("/hr/is-avans"); setRows(Array.isArray(d) ? d : []); if (!Array.isArray(d)) setHata(d?.error || "Liste alınamadı"); }
    catch (e) { setHata(e.message || "Sunucuya ulaşılamadı"); setRows([]); }
    finally { setRefreshing(false); }
  }, []);
  useEffect(() => { yukle(); const unsub = navigation.addListener("focus", yukle); return unsub; }, [navigation, yukle]);
  const duzelt = (a) => navigation.navigate("IsAvans", { duzelt: a });
  const liste = rows || [];
  // Yalnız kendi kayıtlarım (sunucu zaten kilitler; yönetici hesabında yine kendi kayıtlarım gösterilir)
  const benim = liste.filter((a) => a.sahibi !== false);
  const redBekleyen = benim.filter((a) => a.duzeltilebilir);
  const onayda = benim.filter((a) => AKTIF.includes(a.durum));
  const odenen = benim.filter((a) => a.durum === "TAMAMLANDI");
  const eskiRed = benim.filter((a) => a.durum === "REDDEDILDI" && !a.duzeltilebilir);
  const Bolum = ({ baslik, veri, renk, bos }) => (
    <>
      <Text style={[st.secTitle, renk && { color: renk }]}>{baslik} ({veri.length})</Text>
      {veri.length === 0 ? <View style={st.empty}><Text style={st.emptyTxt}>{bos}</Text></View> : veri.map((a) => <Kart key={a.id} a={a} onDetay={setDetay} onDuzelt={duzelt} />)}
    </>
  );
  return (
    <SafeAreaView style={st.safe}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4, width: 60 }}><Text style={st.back}>‹ Geri</Text></TouchableOpacity>
        <Text style={st.hTitle}>İş Avanslarım</Text>
        <TouchableOpacity onPress={() => navigation.navigate("IsAvans")} style={{ padding: 4, width: 60, alignItems: "flex-end" }}><Text style={st.back}>＋ Yeni</Text></TouchableOpacity>
      </View>
      {rows === null ? <ActivityIndicator style={{ marginTop: 40 }} size="large" color="#1D4ED8" /> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); yukle(); }} />}>
          {hata ? <Text style={st.err}>{hata}</Text> : null}
          <Bolum baslik="❌ Reddedildi · Düzeltmeniz bekleniyor" veri={redBekleyen} renk="#B91C1C" bos="Düzeltme bekleyen talebiniz yok" />
          <Bolum baslik="⏳ Onayda" veri={onayda} bos="Onayda bekleyen talebiniz yok" />
          <Bolum baslik="✓ Ödenen" veri={odenen.slice(0, 30)} renk="#166534" bos="Ödenmiş talep yok" />
          {eskiRed.length ? <Bolum baslik="Reddedilen (eski)" veri={eskiRed} renk="#6B7280" bos="" /> : null}
        </ScrollView>
      )}
      <AvansDetayModal talep={detay} onClose={() => setDetay(null)} onDuzelt={duzelt} />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F0F4FF" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#1D4ED8", paddingHorizontal: 16, paddingVertical: 14, paddingTop: 18 },
  back: { color: "#fff", fontSize: 15, fontWeight: "600" }, hTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  secTitle: { fontSize: 13, fontWeight: "800", color: "#374151", marginTop: 14, marginBottom: 8, letterSpacing: 0.3 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  cardRed: { borderLeftWidth: 4, borderLeftColor: "#DC2626" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  title: { fontSize: 14, fontWeight: "700", color: "#111827", flex: 1, marginRight: 8 }, amt: { fontSize: 17, fontWeight: "800", color: "#111827" },
  date: { fontSize: 11.5, color: "#6B7280" }, ack: { fontSize: 12.5, color: "#4B5563", marginTop: 2 },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }, pillTxt: { fontSize: 11, fontWeight: "700" },
  btnRow: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  btn: { borderRadius: 9, paddingVertical: 9, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  btnGhost: { backgroundColor: "#F1F5F9", borderWidth: 1, borderColor: "#E2E8F0" }, btnGhostTxt: { color: "#334155", fontWeight: "700", fontSize: 13 },
  btnRed: { backgroundColor: "#B91C1C", flex: 1 }, btnRedTxt: { color: "#fff", fontWeight: "800", fontSize: 13 },
  empty: { backgroundColor: "#fff", borderRadius: 10, padding: 14, alignItems: "center" }, emptyTxt: { color: "#9CA3AF", fontSize: 13 },
  err: { color: "#991B1B", backgroundColor: "#FEE2E2", borderRadius: 8, padding: 10, fontWeight: "700", marginBottom: 8 },
  mHeader: { backgroundColor: "#1E3A5F", flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 20, paddingVertical: 16 },
  mTitle: { fontSize: 18, fontWeight: "800", color: "#fff" }, mSub: { fontSize: 12, color: "#93C5FD", marginTop: 2 },
  mRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  mLabel: { fontSize: 12, color: "#9CA3AF", fontWeight: "600", flex: 1 }, mVal: { fontSize: 13.5, color: "#111827", fontWeight: "700", flex: 2, textAlign: "right" },
  tur: { backgroundColor: "#FAF5FF", borderWidth: 1, borderColor: "#E9D5FF", borderRadius: 10, padding: 10, marginBottom: 8 },
  turTitle: { fontSize: 13, fontWeight: "800", color: "#3B0764" }, turSub: { fontSize: 11.5, color: "#6B7280", marginTop: 2 }, turTxt: { fontSize: 12.5, color: "#1E1B4B", marginTop: 4, lineHeight: 18 },
  olay: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" }, olayTitle: { fontSize: 13, fontWeight: "800", color: "#0F172A" },
});
