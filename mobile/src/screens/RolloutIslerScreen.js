import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Modal,
  Alert, ActivityIndicator, Platform, SafeAreaView, RefreshControl, Linking,
} from "react-native";
import { apiGet, apiPost } from "../api";
import { fiiliBildir } from "./OperasyonScreens"; // 31.10.2026: issue / engel bildirimi (QC'den bağımsız fiilî durum)

/* ═══ ROLLOUT · İŞLERİM (Faz 1, 03.09.2026) ═══════════════════════════════
   Merkezden atanan işler (New Site Montaj, ENH, Survey, MW, On Air, Power,
   Clean Up, PAC…) burada. Bekleyen / Tamamlanan sekmeleri. İş kartında
   atayanın notu, saha belgeleri (TSSR indir), personeller. Sahada "İşe Başla"
   → rollout başlangıç tarihi otomatik; "Çıkış Yap" sihirbazı → tamamlandı mı,
   QC tamamlandı mı, bugün çalışanlar, not → rollout bitiş/QC otomatik.
   Başla/Bitir'i atanan personelden herhangi biri yapabilir (Orhan, 03.09). */

const AYLAR = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
const fmt = (d) => {
  if (!d) return "—";
  const t = new Date(d);
  if (isNaN(t)) return String(d).slice(0, 10);
  return `${t.getDate()} ${AYLAR[t.getMonth()]}`;
};
const fmtSaat = (d) => {
  if (!d) return "—";
  const t = new Date(d);
  if (isNaN(t)) return "—";
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
};
const DURUM = {
  ATANDI:     { txt: "Atandı",       bg: "#eff6ff", ink: "#1d4ed8" },
  BASLADI:    { txt: "Sahadasınız",  bg: "#dcfce7", ink: "#166534" },
  DEVAM:      { txt: "Devam ediyor", bg: "#fef3c7", ink: "#b45309" },
  QC_BEKLE:   { txt: "QC bekliyor",  bg: "#fef3c7", ink: "#92400e" },
  TAMAMLANDI: { txt: "Tamamlandı",   bg: "#f1f5f9", ink: "#475569" },
  IPTAL:      { txt: "İptal",        bg: "#fee2e2", ink: "#b91c1c" },
  ARA_VERILDI:{ txt: "Ara verildi",  bg: "#fee2e2", ink: "#b91c1c" },
};
// Sahada yarım kalma sebepleri (04.09.2026): "Devam ediyor" seçilince sorulur; not Rollout Data'ya işlenir
const SEBEPLER = ["Yarın devam", "Halk tepkisi", "Farklı sahaya yönlendirildi", "Eksik malzeme", "Hava / erişim sorunu", "Huawei / müşteri kaynaklı bekleme", "Diğer"];

export default function RolloutIslerScreen({ user, navigation }) {
  const benEmail = String(user?.email || "").toLowerCase();
  const [sekme, setSekme] = useState("bekleyen");
  const [bekleyen, setBekleyen] = useState([]);
  const [tamamlanan, setTamamlanan] = useState([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [secili, setSecili] = useState(null);      // detay
  const [islem, setIslem] = useState(false);
  // Çıkış sihirbazı
  const [cikis, setCikis] = useState(false);
  const [tamamlandi, setTamamlandi] = useState(null);   // true/false
  const [qcOk, setQcOk] = useState(null);               // true/false
  const [calisanlar, setCalisanlar] = useState([]);     // email[]
  const [notu, setNotu] = useState("");
  const [sebep, setSebep] = useState("Yarın devam");

  const yukle = useCallback(async (sessiz) => {
    if (!sessiz) setYukleniyor(true);
    try {
      const d = await apiGet("/is-atama/benim");
      if (d && d.ok) { setBekleyen(d.bekleyen || []); setTamamlanan(d.tamamlanan || []); }
      else if (d?.error) Alert.alert("Hata", d.error);
    } catch (e) { Alert.alert("Hata", e.message); }
    finally { setYukleniyor(false); setYenileniyor(false); }
  }, []);
  useEffect(() => {
    yukle();
    const unsub = navigation.addListener("focus", () => yukle(true));
    return unsub;
  }, [navigation, yukle]);

  const detayAc = async (row) => {
    setSecili(row);
    try {
      const d = await apiGet(`/is-atama/${row.id}`);
      if (d && d.ok && d.row) setSecili(d.row);
    } catch (_) {}
  };

  const basla = () => {
    Alert.alert("İşe Başla", `${(secili.site_codes || []).join(", ")}\n${secili.kategori_ad}\n\nBaşlama saati kaydedilecek ve rollout verisine "aksiyon alındı" olarak işlenecek.`, [
      { text: "Vazgeç", style: "cancel" },
      { text: "Başla", onPress: async () => {
        setIslem(true);
        try {
          const d = await apiPost(`/is-atama/${secili.id}/basla`, {}, true);
          if (!d?.ok) throw new Error(d?.error || "Başlatılamadı");
          setSecili(d.row); yukle(true);
        } catch (e) { Alert.alert("Hata", e.message); }
        finally { setIslem(false); }
      } },
    ]);
  };

  const cikisAc = () => {
    setTamamlandi(null); setQcOk(null); setNotu(""); setSebep("Yarın devam");
    setCalisanlar((secili.personeller || []).map((p) => p.email));
    setCikis(true);
  };
  const cikisGonder = async () => {
    if (tamamlandi === null) return Alert.alert("Eksik", "Saha tamamlandı mı, devam mı ediyor?");
    if (tamamlandi && secili.qc_yazar && qcOk === null) return Alert.alert("Eksik", "QC tamamlandı mı?");
    if (tamamlandi && secili.qc_yazar && qcOk === false && !notu.trim()) return Alert.alert("Not gerekli", "QC tamamlanmadıysa kısa bir not yazın.");
    if (tamamlandi === false && sebep !== "Yarın devam" && !notu.trim()) return Alert.alert("Not gerekli", `"${sebep}" için kısa bir açıklama yazın; ofis ve Rollout Data'ya işlenecek.`);
    setIslem(true);
    try {
      const d = await apiPost(`/is-atama/${secili.id}/bitir`, {
        tamamlandi, qc_tamamlandi: secili.qc_yazar ? qcOk : null, not: notu.trim() || null, sebep: tamamlandi === false ? sebep : null,
        calisanlar: (secili.personeller || []).filter((p) => calisanlar.includes(p.email)),
      }, true);
      if (!d?.ok) throw new Error(d?.error || "Kaydedilemedi");
      setCikis(false); setSecili(d.row); yukle(true);
      Alert.alert(
        d.durum === "TAMAMLANDI" ? "İş kapatıldı ✅" : d.durum === "QC_BEKLE" ? "Kaydedildi" : d.durum === "ARA_VERILDI" ? "Ara verildi ⏸" : "Gün kapatıldı",
        d.durum === "TAMAMLANDI" ? "Rollout verisi güncellendi." : d.durum === "QC_BEKLE" ? "Montaj bitti, QC bekliyor olarak işaretlendi." : d.durum === "ARA_VERILDI" ? "Sebep ve notunuz ofise ve Rollout Data'ya işlendi. İş bekleyen listenizde kalır; uygun olunca 'İşe Başla' ile devam edin." : "Yarın tekrar 'İşe Başla' ile devam edin.",
      );
    } catch (e) { Alert.alert("Hata", e.message); }
    finally { setIslem(false); }
  };

  const liste = sekme === "bekleyen" ? bekleyen : tamamlanan;
  const acikMi = (r) => !["TAMAMLANDI", "IPTAL"].includes(r.durum);

  const Rozet = ({ durum }) => {
    const d = DURUM[durum] || DURUM.ATANDI;
    return <View style={[st.rozet, { backgroundColor: d.bg }]}><Text style={[st.rozetTxt, { color: d.ink }]}>{d.txt}</Text></View>;
  };

  /* ── Detay ── */
  if (secili) {
    const s = secili;
    const sahalar = Array.isArray(s.sahalar) ? s.sahalar : [];
    const gunler = Array.isArray(s.gunler) ? s.gunler : [];
    const cleanupMi = s.kategori === "CLEANUP";
    return (
      <SafeAreaView style={st.safe}>
        <View style={st.header}>
          <TouchableOpacity onPress={() => setSecili(null)} style={st.backBtn}><Text style={st.backTxt}>‹</Text></TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={st.title}>{s.kategori_ikon} {s.kategori_ad}{s.alt_tip ? ` · ${s.alt_tip}` : ""}</Text>
            <Text style={st.sub}>{(s.site_codes || []).join(" · ")}</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View style={st.kart}>
            <View style={st.satirArasi}>
              <Text style={st.kartBaslik}>Plan: {fmt(s.plan_tarihi)}</Text>
              <Rozet durum={s.durum} />
            </View>
            {s.atayan_not ? (
              <View style={st.notKutu}>
                <Text style={st.notBaslik}>📝 Atayan notu · {s.atayan_ad || String(s.atayan_email || "").split("@")[0]}</Text>
                <Text style={st.notTxt}>{s.atayan_not}</Text>
              </View>
            ) : null}
            <Text style={st.kisiler}>👥 {(s.personeller || []).map((p) => p.ad).join(", ")}</Text>
            {s.durdurma_sebebi ? <Text style={[st.kucuk, { color: "#b91c1c", fontWeight: "700", marginTop: 6 }]}>⏸ Ara verildi: {s.durdurma_sebebi}</Text> : null}
            {s.baslama_ts ? <Text style={st.kucuk}>Başlama: {fmt(s.baslama_ts)} {fmtSaat(s.baslama_ts)}{s.bitis_ts ? ` · Bitiş: ${fmt(s.bitis_ts)} ${fmtSaat(s.bitis_ts)}` : ""}</Text> : null}
          </View>

          <Text style={st.bolum}>SAHA VE BELGELER</Text>
          {sahalar.map((sa) => (
            /* 08.09.2026: Clean Up işinde saha koduna dokunmak da fotoğraf ekranını açar
               (personel butonu değil site ID'yi tıklıyordu). */
            <TouchableOpacity key={sa.site_code} style={st.kart} activeOpacity={cleanupMi && acikMi(s) ? 0.7 : 1}
              onPress={() => { if (cleanupMi && acikMi(s)) navigation.navigate("RolloutCleanup", { site: sa.site_code }); }}>
              <Text style={st.siteKod}>{sa.site_code}{cleanupMi && acikMi(s) ? "  ›" : ""}</Text>
              <Text style={st.kucuk}>{[sa.bolge, sa.il, sa.site_type, sa.project_code].filter(Boolean).join(" · ") || "Rollout bilgisi yok"}</Text>
              {sa.survey_note ? <Text style={[st.kucuk, { marginTop: 4 }]}>Survey notu: {sa.survey_note}</Text> : null}
              <View style={st.belgeRow}>
                {(sa.belgeler || []).length ? sa.belgeler.map((b, i) => (
                  <TouchableOpacity key={i} style={[st.belgeBtn, b.oncelikli && st.belgeBtnOnemli]} onPress={() => Linking.openURL(b.url).catch(() => Alert.alert("Açılamadı", "Belge linki açılamadı."))}>
                    <Text style={[st.belgeTxt, b.oncelikli && { color: "#1d4ed8" }]}>📄 {b.etiket}</Text>
                  </TouchableOpacity>
                )) : <Text style={st.kucuk}>Bu saha için yüklü belge yok</Text>}
              </View>
              {cleanupMi && acikMi(s) && (
                <TouchableOpacity style={st.cleanupBtn} onPress={() => navigation.navigate("RolloutCleanup", { site: sa.site_code })}>
                  <Text style={st.cleanupTxt}>🧹 Önce / Sonra fotoğraf ekranı</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          ))}

          {gunler.length > 0 && (
            <>
              <Text style={st.bolum}>GÜN KAYITLARI</Text>
              <View style={st.kart}>
                {gunler.map((g) => (
                  <View key={g.id} style={st.gunSatir}>
                    <Text style={st.gunTarih}>{fmt(g.tarih)}</Text>
                    <Text style={st.gunAd}>{g.personel_ad || g.personel_email}</Text>
                    <Text style={st.gunSaat}>{fmtSaat(g.baslama)} – {fmtSaat(g.bitis)}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
          {s.kapanis_not ? (
            <View style={[st.kart, { backgroundColor: "#fefce8", borderColor: "#fef08a" }]}>
              <Text style={st.notBaslik}>Saha notları</Text>
              <Text style={st.notTxt}>{s.kapanis_not}</Text>
            </View>
          ) : null}

          {acikMi(s) && s.durum !== "BASLADI" && (
            <TouchableOpacity style={[st.anaBtn, { backgroundColor: "#16a34a" }]} onPress={basla} disabled={islem} activeOpacity={0.85}>
              {islem ? <ActivityIndicator color="#fff" /> : <Text style={st.anaBtnTxt}>▶ İşe Başla{s.durum === "DEVAM" ? " (yeni gün)" : s.durum === "ARA_VERILDI" ? " (devam)" : ""}</Text>}
            </TouchableOpacity>
          )}
          {s.durum === "BASLADI" && (
            <TouchableOpacity style={[st.anaBtn, { backgroundColor: "#d97706" }]} onPress={cikisAc} disabled={islem} activeOpacity={0.85}>
              <Text style={st.anaBtnTxt}>■ Çıkış Yap</Text>
            </TouchableOpacity>
          )}
          {/* 31.10.2026: issue / engel bildirimi — işi kapatmaz, QC'ye yazmaz; haritada ve haftalık planda "⚠ Issue" etiketi olur */}
          {acikMi(s) && (
            <TouchableOpacity style={[st.anaBtn, { backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#dc2626" }]} disabled={islem} activeOpacity={0.85}
              onPress={() => Alert.prompt
                ? Alert.prompt("Issue / engel bildir", "Kısa açıklama (ör. eksik malzeme, erişim yok):", async (txt) => {
                    if (!txt || !txt.trim()) return;
                    try { for (const kod of s.site_codes || []) await fiiliBildir(s.id, kod, "ISSUE", { issue_turu: "Saha issue", aciklama: txt.trim() }); Alert.alert("Bildirildi", "Issue ofise iletildi; iş açık kalır."); }
                    catch (e) { Alert.alert("Hata", e.message); }
                  })
                : Alert.alert("Issue / engel", "Issue bildirimi için Çıkış Yap → Devam ediyor → sebep seçin.")}>
              <Text style={[st.anaBtnTxt, { color: "#dc2626" }]}>⚠ Issue / engel bildir</Text>
            </TouchableOpacity>
          )}
          {s.durum === "QC_BEKLE" && (
            <Text style={[st.kucuk, { textAlign: "center", marginTop: 8 }]}>Montaj bitti, QC bekleniyor. QC tamamlanınca "İşe Başla → Çıkış Yap → QC Evet" ile kapatın.</Text>
          )}
        </ScrollView>

        {/* Çıkış sihirbazı */}
        <Modal visible={cikis} transparent animationType="slide" onRequestClose={() => setCikis(false)}>
          <View style={st.modalArka}>
            <View style={st.modalKutu}>
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={st.modalBaslik}>Çıkış · {(s.site_codes || []).join(", ")}</Text>

                <Text style={st.soru}>Saha tamamlandı mı?</Text>
                <View style={st.secRow}>
                  <TouchableOpacity style={[st.secBtn, tamamlandi === true && st.secBtnOk]} onPress={() => setTamamlandi(true)}><Text style={[st.secTxt, tamamlandi === true && st.secTxtOn]}>✓ Tamamlandı</Text></TouchableOpacity>
                  <TouchableOpacity style={[st.secBtn, tamamlandi === false && st.secBtnWarn]} onPress={() => { setTamamlandi(false); setQcOk(null); }}><Text style={[st.secTxt, tamamlandi === false && st.secTxtOn]}>↻ Devam ediyor</Text></TouchableOpacity>
                </View>

                {tamamlandi === true && s.qc_yazar && (
                  <>
                    <Text style={st.soru}>QC tamamlandı mı?</Text>
                    <View style={st.secRow}>
                      <TouchableOpacity style={[st.secBtn, qcOk === true && st.secBtnOk]} onPress={() => setQcOk(true)}><Text style={[st.secTxt, qcOk === true && st.secTxtOn]}>Evet</Text></TouchableOpacity>
                      <TouchableOpacity style={[st.secBtn, qcOk === false && st.secBtnWarn]} onPress={() => setQcOk(false)}><Text style={[st.secTxt, qcOk === false && st.secTxtOn]}>Hayır</Text></TouchableOpacity>
                    </View>
                  </>
                )}

                {tamamlandi === false && (
                  <>
                    <Text style={st.soru}>Neden yarım kaldı?</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {SEBEPLER.map((sb) => (
                        <TouchableOpacity key={sb} onPress={() => setSebep(sb)} style={[st.chip, sebep === sb && (sb === "Yarın devam" ? st.chipOk : st.chipWarn)]}>
                          <Text style={[st.chipTxt, sebep === sb && st.chipTxtOn]}>{sb}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}
                <Text style={st.soru}>Bugün sahada çalışanlar</Text>
                {(s.personeller || []).map((p) => {
                  const on = calisanlar.includes(p.email);
                  const ben = p.email === benEmail;
                  return (
                    <TouchableOpacity key={p.email} style={st.kisiSatir} disabled={ben}
                      onPress={() => setCalisanlar((c) => on ? c.filter((e) => e !== p.email) : [...c, p.email])}>
                      <Text style={[st.kutu, on && st.kutuOn]}>{on ? "☑" : "☐"}</Text>
                      <Text style={st.kisiAd}>{p.ad}{ben ? " (siz)" : ""}</Text>
                    </TouchableOpacity>
                  );
                })}

                <Text style={st.soru}>Not {(tamamlandi && s.qc_yazar && qcOk === false) || (tamamlandi === false && sebep !== "Yarın devam") ? "(zorunlu)" : "(isteğe bağlı)"}</Text>
                <TextInput value={notu} onChangeText={setNotu} multiline placeholder="Örn: 2. sektör kablo yetmedi, yarın 10 m daha lazım."
                  placeholderTextColor="#94a3b8" style={st.modalInput} />

                <View style={st.secRow}>
                  <TouchableOpacity style={[st.secBtn, { backgroundColor: "#e2e8f0" }]} onPress={() => setCikis(false)}><Text style={st.secTxt}>Vazgeç</Text></TouchableOpacity>
                  <TouchableOpacity style={[st.secBtn, { backgroundColor: "#d97706", borderColor: "#d97706" }]} onPress={cikisGonder} disabled={islem}>
                    {islem ? <ActivityIndicator color="#fff" /> : <Text style={[st.secTxt, { color: "#fff" }]}>■ Çıkış Yap</Text>}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  /* ── Liste ── */
  return (
    <SafeAreaView style={st.safe}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}><Text style={st.backTxt}>‹</Text></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={st.title}>Rollout · İşlerim</Text>
          <Text style={st.sub}>Size atanan saha işleri</Text>
        </View>
      </View>
      <View style={st.sekmeRow}>
        {[["bekleyen", `Bekleyen (${bekleyen.length})`], ["tamamlanan", `Tamamlanan (${tamamlanan.length})`]].map(([k, t]) => (
          <TouchableOpacity key={k} style={[st.sekme, sekme === k && st.sekmeOn]} onPress={() => setSekme(k)}>
            <Text style={[st.sekmeTxt, sekme === k && st.sekmeTxtOn]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={() => { setYenileniyor(true); yukle(true); }} />}>
        {yukleniyor ? <ActivityIndicator style={{ marginTop: 30 }} color="#1E3A5F" /> : null}
        {!yukleniyor && liste.length === 0 && (
          <View style={st.bos}>
            <Text style={st.bosTxt}>{sekme === "bekleyen" ? "Bekleyen iş yok" : "Tamamlanan iş yok"}</Text>
            <Text style={st.bosAlt}>{sekme === "bekleyen" ? "Ofis iş atadığında burada görünür. Aşağı çekerek yenileyin." : "Son 60 günde kapattığınız işler burada listelenir."}</Text>
          </View>
        )}
        {liste.map((r) => (
          <TouchableOpacity key={r.id} style={[st.isKart, r.durum === "BASLADI" && st.isKartAktif]} activeOpacity={0.85} onPress={() => detayAc(r)}>
            <View style={st.satirArasi}>
              <Text style={st.isKategori}>{r.kategori_ikon} {r.kategori_ad}{r.alt_tip ? ` · ${r.alt_tip}` : ""}</Text>
              <Rozet durum={r.durum} />
            </View>
            <Text style={st.siteKod}>{(r.site_codes || []).join(" · ")}</Text>
            <Text style={st.kucuk}>Plan {fmt(r.plan_tarihi)} · {(r.personeller || []).map((p) => String(p.ad || "").split(" ")[0]).join(", ")}{r.bolge ? ` · ${r.bolge}` : ""}</Text>
            {r.durdurma_sebebi && r.durum === "ARA_VERILDI" ? <Text style={[st.kucuk, { color: "#b91c1c", fontWeight: "700" }]}>⏸ {r.durdurma_sebebi}</Text> : null}
            {r.atayan_not ? <Text style={st.notOnizleme} numberOfLines={2}>📝 {r.atayan_not}</Text> : null}
            {r.kategori === "CLEANUP" && Array.isArray(r.cleanup) && r.cleanup.length > 0 && (
              <Text style={st.kucuk}>🧹 {r.cleanup.map((c) => `${c.site_code.split("_")[0]}: ${(c.items || []).filter((i) => i.tamamlandi).length}/${(c.items || []).length}`).join(" · ")}</Text>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f1f5f9" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#1E3A5F" },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  backTxt: { color: "#fff", fontSize: 26, lineHeight: 28, marginTop: -2 },
  title: { color: "#fff", fontSize: 17, fontWeight: "800" },
  sub: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 1 },
  sekmeRow: { flexDirection: "row", backgroundColor: "#1E3A5F", paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  sekme: { flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center" },
  sekmeOn: { backgroundColor: "#fff" },
  sekmeTxt: { color: "rgba(255,255,255,0.85)", fontWeight: "800", fontSize: 13 },
  sekmeTxtOn: { color: "#1E3A5F" },
  bos: { backgroundColor: "#fff", borderRadius: 14, padding: 18, alignItems: "center", borderWidth: 1, borderColor: "#e2e8f0" },
  bosTxt: { fontWeight: "800", color: "#0f172a", fontSize: 14 },
  bosAlt: { color: "#64748b", fontSize: 12, marginTop: 6, textAlign: "center" },
  isKart: { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#e2e8f0", marginBottom: 10 },
  isKartAktif: { borderColor: "#16a34a", borderWidth: 2 },
  isKategori: { fontSize: 13.5, fontWeight: "800", color: "#0f172a", flex: 1, marginRight: 8 },
  siteKod: { fontSize: 15, fontWeight: "900", color: "#0f172a", marginTop: 4, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  kucuk: { fontSize: 11.5, color: "#64748b", marginTop: 3 },
  notOnizleme: { fontSize: 12, color: "#713f12", marginTop: 6, backgroundColor: "#fefce8", borderRadius: 8, padding: 8 },
  satirArasi: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rozet: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  rozetTxt: { fontSize: 11.5, fontWeight: "800" },
  kart: { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#e2e8f0", marginBottom: 12 },
  kartBaslik: { fontSize: 13, fontWeight: "800", color: "#1e3a5f" },
  notKutu: { backgroundColor: "#fefce8", borderRadius: 10, padding: 10, marginTop: 10, borderWidth: 1, borderColor: "#fef08a" },
  notBaslik: { fontSize: 11, fontWeight: "800", color: "#854d0e", marginBottom: 3 },
  notTxt: { fontSize: 13.5, color: "#713f12", lineHeight: 19 },
  kisiler: { fontSize: 12.5, color: "#334155", marginTop: 10, fontWeight: "600" },
  bolum: { fontSize: 11, fontWeight: "800", color: "#475569", letterSpacing: 1, marginBottom: 8, marginLeft: 2, marginTop: 4 },
  belgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  belgeBtn: { backgroundColor: "#f1f5f9", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: "#e2e8f0" },
  belgeBtnOnemli: { backgroundColor: "#eff6ff", borderColor: "#bfdbfe" },
  belgeTxt: { fontSize: 12, fontWeight: "700", color: "#475569" },
  cleanupBtn: { marginTop: 10, backgroundColor: "#0f766e", borderRadius: 10, paddingVertical: 11, alignItems: "center" },
  cleanupTxt: { color: "#fff", fontWeight: "800", fontSize: 13 },
  gunSatir: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#f1f5f9", gap: 8 },
  gunTarih: { width: 56, fontSize: 12, fontWeight: "700", color: "#1e3a5f" },
  gunAd: { flex: 1, fontSize: 12.5, color: "#0f172a", fontWeight: "600" },
  gunSaat: { fontSize: 12, color: "#64748b" },
  anaBtn: { marginTop: 8, borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  anaBtnTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  modalArka: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  modalKutu: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: "88%" },
  modalBaslik: { fontSize: 16, fontWeight: "800", color: "#0f172a", marginBottom: 6 },
  soru: { fontSize: 13, fontWeight: "800", color: "#334155", marginTop: 14, marginBottom: 8 },
  secRow: { flexDirection: "row", gap: 10 },
  secBtn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#e2e8f0", backgroundColor: "#f8fafc" },
  secBtnOk: { backgroundColor: "#16a34a", borderColor: "#16a34a" },
  secBtnWarn: { backgroundColor: "#d97706", borderColor: "#d97706" },
  secTxt: { fontWeight: "800", fontSize: 14, color: "#334155" },
  secTxtOn: { color: "#fff" },
  chip: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7, borderWidth: 1.5, borderColor: "#e2e8f0", backgroundColor: "#f8fafc" },
  chipOk: { backgroundColor: "#16a34a", borderColor: "#16a34a" },
  chipWarn: { backgroundColor: "#b91c1c", borderColor: "#b91c1c" },
  chipTxt: { fontSize: 12.5, fontWeight: "700", color: "#334155" },
  chipTxtOn: { color: "#fff" },
  kisiSatir: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  kutu: { fontSize: 20, color: "#94a3b8" },
  kutuOn: { color: "#16a34a" },
  kisiAd: { fontSize: 14, color: "#0f172a", fontWeight: "600" },
  modalInput: { minHeight: 70, borderWidth: 1.5, borderColor: "#cbd5e1", borderRadius: 12, padding: 12, fontSize: 14, color: "#0f172a", textAlignVertical: "top", marginBottom: 14 },
});
