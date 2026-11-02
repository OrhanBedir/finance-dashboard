import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Modal,
  Alert, ActivityIndicator, SafeAreaView, RefreshControl, Linking,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE, apiGet } from "../api";

/* ═══ OPERASYON EKRANLARI (31.10.2026, Orhan) ═══════════════════════════════════════════════════════════════
   Web ile AYNI uçlar (sunucu yetki + firma kapsamı):
     HwMalzemeScreen      /hw-malzeme/*         Emre: Site ID / iş kodu ara → kabul (kısmi / tam, geliş tarihi, kalemler, fotoğraf),
                                                ekibe teslim, devir, depoya dönüş, kullanım, iade; geçmiş. İstek anahtarı ile
                                                çift gönderim / bağlantı kopması ikinci kayıt üretmez.
     HaftalikPlanScreen   /operasyon/haftalik   Weekly Rollout Plan — gün / ekip bazlı rahat okunur kartlar (tablo değil)
     EkiplerNeredeScreen  /operasyon/ekipler-nerede  "Ekipler nerede?" — bildirilen son çalışma sahası (canlı GPS değil)
     DepodakiSahalarScreen /hw-malzeme/depo-ozet Depodaki sahalar (saha / iş / malzeme ayrı sayılır)
   Renk tek başına anlam taşımaz: her durum metinle yazılır. QC ayrı alandır. */

const LAC = "#1e3a5f";
const AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const GUN = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const fmt = (d) => { if (!d) return "—"; const t = new Date(String(d).length <= 10 ? d + "T12:00:00" : d); return isNaN(t) ? String(d).slice(0, 10) : `${t.getDate()} ${AYLAR[t.getMonth()]}`; };
const fmtZ = (d) => { if (!d) return "—"; const t = new Date(d); return isNaN(t) ? "—" : `${t.getDate()} ${AYLAR[t.getMonth()]} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`; };
const bugunISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const gunEkle = (t, n) => { const d = new Date(`${t}T12:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const pazartesi = (t) => { const g = new Date(`${t}T12:00:00`).getDay(); return gunEkle(t, -((g + 6) % 7)); };
const yeniAnahtar = () => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const sayi = (v) => (v == null || v === "" ? "—" : Number(v).toLocaleString("tr-TR", { maximumFractionDigits: 3 }));

// Yazma isteği: istek anahtarı gövdede; ağ hatasında anahtar KORUNUR (tekrar güvenli), başarılı kayıttan sonra yenilenir
async function hwPost(path, body, anahtar, form) {
  const token = await AsyncStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token || ""}`, "x-istemci": "mobil" };
  if (!form) headers["Content-Type"] = "application/json";
  let res;
  try { res = await fetch(`${API_BASE}${path}`, { method: "POST", headers, body: form || JSON.stringify({ ...body, istek_anahtari: anahtar }) }); }
  catch { const e = new Error("Bağlantı kurulamadı. Kaydın alınıp alınmadığı doğrulanamadı — bilgiler duruyor, aynı kaydı tekrar gönderin; ikinci kez kaydedilmez."); e.belirsiz = true; throw e; }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.ok === false) { const e = new Error(j.error || `Sunucu hatası (${res.status})`); e.http = res.status; e.ek = j; throw e; }
  return j;
}

const FIILI = { MAVI: { bg: "#dbeafe", fg: "#1e40af", kenar: "#2563eb", ad: "Planlandı / başlamadı" }, SARI: { bg: "#fef9c3", fg: "#713f12", kenar: "#eab308", ad: "Devam ediyor" },
  YESIL: { bg: "#dcfce7", fg: "#14532d", kenar: "#16a34a", ad: "Fiziksel montaj tamamlandı" }, GRI: { bg: "#f1f5f9", fg: "#334155", kenar: "#94a3b8", ad: "Doğrulanmadı" } };
const KONUM_R = { DEPODA: ["#dbeafe", "#1e40af"], EKIPTE: ["#fef3c7", "#92400e"], KISMEN_EKIP_DEPO: ["#ffedd5", "#9a3412"], KULLANILDI: ["#dcfce7", "#166534"], IADE: ["#f1f5f9", "#475569"], ESKI_TEYIT: ["#fee2e2", "#991b1b"], YOK: ["#f1f5f9", "#64748b"] };
const TIP_AD = { INHOUSE: "Inhouse", TASERON: "Taşeron", TANIMSIZ: "Ekip tipi tanımlanmadı" };

function Baslik({ navigation, baslik, sag }) {
  return <View style={s.baslik}>
    <TouchableOpacity onPress={() => navigation.goBack()} style={s.geri}><Text style={s.geriTxt}>‹ Geri</Text></TouchableOpacity>
    <Text style={s.baslikTxt} numberOfLines={1}>{baslik}</Text>
    <View style={{ minWidth: 60, alignItems: "flex-end" }}>{sag || null}</View>
  </View>;
}
function Rozet({ d }) { if (!d) return null; const [bg, fg] = KONUM_R[d.konum] || KONUM_R.YOK; return <View style={[s.rozet, { backgroundColor: bg }]}><Text style={[s.rozetTxt, { color: fg }]}>{d.etiket || d.konum_ad}</Text></View>; }
function RenkAciklama() {
  return <View style={s.aciklama}>
    {Object.entries(FIILI).map(([k, v]) => <View key={k} style={s.acSatir}><View style={[s.acKutu, { backgroundColor: v.bg, borderColor: v.kenar }]} /><Text style={s.acTxt}>{v.ad}</Text></View>)}
    <View style={s.acSatir}><Text style={[s.acTxt, { color: "#991b1b", fontWeight: "800" }]}>⚠ Issue</Text><Text style={s.acTxt}> issue / eksik malzeme · QC ayrı alandır</Text></View>
  </View>;
}

/* ═══ HW MALZEME DURUMU ═══ */
export function HwMalzemeScreen({ navigation, route }) {
  const [q, setQ] = useState(""); const [sonuc, setSonuc] = useState([]); const [ariyor, setAriyor] = useState(false);
  const [secili, setSecili] = useState(route?.params?.kod || null); const [secenek, setSecenek] = useState(null); const [hata, setHata] = useState("");
  useEffect(() => { apiGet("/hw-malzeme/secenekler").then((d) => { if (d?.ok) setSecenek(d); else setHata(d?.error || "Seçenekler alınamadı"); }).catch((e) => setHata(e.message)); }, []);
  useEffect(() => {
    const t = q.replace(/\s+/g, ""); if (t.length < 2) { setSonuc([]); return; }
    let iptal = false; setAriyor(true);
    const z = setTimeout(() => apiGet(`/hw-malzeme/ara?q=${encodeURIComponent(t)}`).then((d) => { if (!iptal) { if (d?.ok) setSonuc(d.sonuclar); else setHata(d?.error || ""); } }).catch((e) => !iptal && setHata(e.message)).finally(() => !iptal && setAriyor(false)), 300);
    return () => { iptal = true; clearTimeout(z); };
  }, [q]);
  if (secili) return <IsDetay kod={secili} secenek={secenek} navigation={navigation} onGeri={() => setSecili(null)} />;
  const grup = {}; for (const x of sonuc) (grup[x.fiziksel_id || x.site_code] = grup[x.fiziksel_id || x.site_code] || []).push(x);
  return <SafeAreaView style={s.ekran}>
    <Baslik navigation={navigation} baslik="📦 HW Malzeme Durumu" sag={<TouchableOpacity onPress={() => navigation.navigate("DepodakiSahalar")}><Text style={s.link}>Depo</Text></TouchableOpacity>} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 14 }}>
      {hata ? <Text style={s.hata}>{hata}</Text> : null}
      <Text style={s.etiket}>Site ID ya da tam iş kodu</Text>
      <TextInput style={[s.girdi, { fontSize: 17 }]} autoCapitalize="characters" autoCorrect={false} value={q} onChangeText={setQ} placeholder="ör. KA3737" />
      {ariyor ? <ActivityIndicator style={{ marginTop: 8 }} /> : null}
      {Object.entries(grup).map(([f, l]) => <View key={f} style={{ marginTop: 10 }}>
        <Text style={s.fiz}>{f} <Text style={s.kucuk}>{l.length > 1 ? `${l.length} iş — her biri ayrı` : ""}</Text></Text>
        {l.map((x) => <TouchableOpacity key={x.site_code} style={s.kart} onPress={() => setSecili(x.site_code)}>
          <Text style={s.kod}>{x.site_code}</Text>
          <Text style={s.kucuk}>{[x.bolge, x.il, x.site_type].filter(Boolean).join(" · ")}</Text>
          <Rozet d={x.durum} />
        </TouchableOpacity>)}
      </View>)}
      {q.replace(/\s+/g, "").length >= 2 && !ariyor && !sonuc.length ? <Text style={[s.kucuk, { marginTop: 8 }]}>Kapsamınızda eşleşen iş kodu yok.</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}

function IsDetay({ kod, secenek, navigation, onGeri }) {
  const [v, setV] = useState(null); const [hata, setHata] = useState(""); const [form, setForm] = useState(null); const [n, setN] = useState(0);
  const yukle = useCallback(() => apiGet(`/hw-malzeme/is/${encodeURIComponent(kod)}`).then((d) => { if (d?.ok) { setV(d); setHata(""); } else setHata(d?.error || "Alınamadı"); }).catch((e) => setHata(e.message)), [kod]);
  useEffect(() => { yukle(); }, [yukle, n]);
  const tamam = (msg) => { setForm(null); setN((x) => x + 1); if (msg) Alert.alert("Kaydedildi", msg); };
  if (hata) return <SafeAreaView style={s.ekran}><Baslik navigation={navigation} baslik={kod} /><Text style={[s.hata, { margin: 14 }]}>{hata}</Text><TouchableOpacity style={s.ikincil} onPress={onGeri}><Text style={s.ikincilTxt}>← Aramaya dön</Text></TouchableOpacity></SafeAreaView>;
  if (!v) return <SafeAreaView style={s.ekran}><Baslik navigation={navigation} baslik={kod} /><ActivityIndicator style={{ marginTop: 30 }} /></SafeAreaView>;
  const d = v.durum;
  const lok = {}; for (const b of v.bakiye) (lok[b.lok_ad] = lok[b.lok_ad] || []).push(b);
  return <SafeAreaView style={s.ekran}>
    <Baslik navigation={navigation} baslik={v.fiziksel_id || kod} sag={<TouchableOpacity onPress={onGeri}><Text style={s.link}>Arama</Text></TouchableOpacity>} />
    <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => setN((x) => x + 1)} />}>
      <Text style={s.kod}>{v.site_code}</Text>
      <Text style={s.kucuk}>{[v.bolge && `${v.bolge} bölgesi`, v.il, v.site_type].filter(Boolean).join(" · ")}</Text>
      <View style={s.ozetSatir}>
        <View style={s.ozetKutu}><Text style={s.kucuk}>Geldi mi?</Text><Text style={s.kalin}>{d.kabul_sayisi ? `Evet · ${d.kabul_sayisi} teslimat` : d.eski_kayit ? "Eski kayıt (teyit bekliyor)" : "Hayır"}</Text>{d.ilk_gelis ? <Text style={s.kucuk}>İlk geliş {fmt(d.ilk_gelis)}</Text> : null}</View>
        <View style={s.ozetKutu}><Text style={s.kucuk}>Tamamı geldi mi?</Text><Text style={s.kalin}>{d.teslim_ad}</Text>{d.eksik_aciklama ? <Text style={[s.kucuk, { color: "#b45309" }]}>Eksik: {d.eksik_aciklama}</Text> : null}</View>
      </View>
      <View style={s.ozetKutu}><Text style={s.kucuk}>Nerede?</Text><Rozet d={d} /></View>
      {v.rollout ? <Text style={[s.kucuk, { marginTop: 6 }]}>Rollout Data: geliş {fmt(v.rollout.malzeme_gelis_tarihi)} · durum {v.rollout.malzeme_status || "boş"}</Text> : null}
      {v.yansima.filter((y) => y.celiski).map((y, i) => <Text key={i} style={s.uyari}>⚠ {y.celiski}</Text>)}
      {v.hareket_yetkisi && !form ? <View style={s.dugmeSatir}>
        <TouchableOpacity style={s.birincil} onPress={() => setForm("kabul")}><Text style={s.birincilTxt}>📦 Malzeme kabulü</Text></TouchableOpacity>
        {[["ekibe-teslim", "Ekibe teslim"], ["devir", "Ekipler arası devir"], ["depoya-donus", "Depoya dönüş"], ["kullanim", "Sahada kullanıldı"], ["iade", "Huawei'ye iade"]].map(([k, ad]) =>
          <TouchableOpacity key={k} style={s.ikincil} onPress={() => setForm(k)}><Text style={s.ikincilTxt}>{ad}</Text></TouchableOpacity>)}
      </View> : null}
      {!v.hareket_yetkisi ? <Text style={[s.kucuk, { marginTop: 8 }]}>Salt okunur: depo hareketi yetkiniz yok.</Text> : null}
      {form === "kabul" ? <KabulFormu is={v} secenek={secenek} onTamam={tamam} onIptal={() => setForm(null)} /> : null}
      {form && form !== "kabul" ? <HareketFormu tur={form} is={v} secenek={secenek} onTamam={tamam} onIptal={() => setForm(null)} /> : null}
      <Text style={s.bolum}>Malzeme nerede? (kalem bazında)</Text>
      {!v.bakiye.length ? <Text style={s.kucuk}>Kayıtlı malzeme yok.</Text> : null}
      {Object.entries(lok).map(([ad, l]) => <View key={ad} style={s.kart}><Text style={s.kalin}>{ad}</Text><Text>{l.map((b) => `${b.ad} ${sayi(b.miktar)} ${b.birim}`).join(" · ")}</Text></View>)}
      <Text style={s.bolum}>Hareketler</Text>
      {v.islemler.slice().reverse().map((x) => <View key={x.id} style={[s.kart, x.ters_islem_id ? { opacity: 0.55 } : null]}>
        <Text style={s.kalin}>#{x.id} {x.tur_ad}{x.teslim_tipi ? ` · ${x.teslim_tipi === "TAM" ? "tam" : "kısmi"}` : ""}</Text>
        <Text style={s.kucuk}>{x.kaynak} → {x.hedef} · {fmt(x.islem_tarihi)}{x.ters_islem_id ? ` · İPTAL (#${x.ters_islem_id})` : ""}</Text>
        <Text>{x.kalemler.map((k) => `${k.ad} ${sayi(k.miktar)} ${k.birim}`).join(" · ")}</Text>
        <Text style={s.kucuk}>{x.kaydeden} · {fmtZ(x.zaman)} · {x.kanal}{x.gerekce ? ` · ${x.gerekce}` : ""}{x.aciklama ? ` · ${x.aciklama}` : ""}</Text>
        {(x.belgeler || []).map((b, i) => <TouchableOpacity key={i} onPress={() => Linking.openURL(b.url)}><Text style={s.link}>📎 {b.ad || `belge ${i + 1}`}</Text></TouchableOpacity>)}
        {(x.gecmis || []).map((g, i) => <Text key={i} style={s.kucuk}>• {fmtZ(g.zaman)} {g.yapan}: {g.alan} {JSON.stringify(g.eski)} → {JSON.stringify(g.yeni)}</Text>)}
      </View>)}
    </ScrollView>
  </SafeAreaView>;
}

function KalemEditor({ kalemler, setKalemler }) {
  const S = (i, k, val) => setKalemler(kalemler.map((x, j) => (j === i ? { ...x, [k]: val } : x)));
  return <View>
    {kalemler.map((k, i) => <View key={i} style={s.kalemSatir}>
      <TextInput style={[s.girdi, { flex: 2 }]} placeholder="Malzeme adı (RRU5258)" value={k.ad} onChangeText={(t) => S(i, "ad", t)} />
      <TextInput style={[s.girdi, { flex: 1 }]} placeholder="Miktar" keyboardType="decimal-pad" value={k.miktar} onChangeText={(t) => S(i, "miktar", t)} />
      <TouchableOpacity onPress={() => kalemler.length > 1 && setKalemler(kalemler.filter((_, j) => j !== i))} style={{ padding: 8 }}><Text>✕</Text></TouchableOpacity>
    </View>)}
    <TouchableOpacity style={s.ikincil} onPress={() => setKalemler([...kalemler, { ad: "", miktar: "", birim: "Adet" }])}><Text style={s.ikincilTxt}>+ Kalem ekle</Text></TouchableOpacity>
  </View>;
}
function KabulFormu({ is, secenek, onTamam, onIptal }) {
  const [f, setF] = useState({ gelis_tarihi: bugunISO(), teslim_tipi: "", depo_id: secenek?.depolar?.[0]?.id || null, eksik_aciklama: "", aciklama: "", kapsam: "RF", belgeler: [] });
  const [kalemler, setKalemler] = useState([{ ad: "", miktar: "", birim: "Adet" }]);
  const [hata, setHata] = useState(""); const [mukerrer, setMukerrer] = useState(false); const [gonder, setGonder] = useState(false); const anahtar = useRef(yeniAnahtar());
  const F = (k, val) => { setF((x) => ({ ...x, [k]: val })); setMukerrer(false); };
  const fotoEkle = async () => {
    let IP; try { IP = require("expo-image-picker"); } catch { return Alert.alert("Fotoğraf", "Bu sürümde kamera modülü yok; belgeyi webden ekleyin."); }
    const izin = await IP.requestCameraPermissionsAsync(); if (!izin.granted) return;
    const r = await IP.launchCameraAsync({ quality: 0.6 }); if (r.canceled) return;
    const a = r.assets[0]; const fd = new FormData(); fd.append("dosya", { uri: a.uri, name: "teslim.jpg", type: "image/jpeg" });
    try { const j = await hwPost("/hw-malzeme/belge", null, null, fd); F("belgeler", [...f.belgeler, j.belge]); } catch (e) { setHata(e.message); }
  };
  const kaydet = async (onay = false) => {
    if (gonder) return; setHata("");
    if (!f.teslim_tipi) return setHata("Teslim tipini seçin: kısmi ya da tam");
    setGonder(true);
    try {
      const r = await hwPost("/hw-malzeme/kabul", { site_code: is.site_code, ...f, kalemler: kalemler.filter((k) => k.ad || k.miktar), mukerrer_onay: onay, eski_kayit_teyidi: !!is.durum?.eski_kayit }, anahtar.current);
      anahtar.current = yeniAnahtar(); onTamam(r.tekrar ? "Bu kayıt daha önce alınmıştı; ikinci kez işlenmedi." : "Kabul kaydedildi.");
    } catch (e) { if (e.http === 409 && e.ek?.mukerrer) setMukerrer(true); setHata(e.message); } finally { setGonder(false); }
  };
  return <View style={[s.kart, { borderColor: "#93c5fd" }]}>
    <Text style={s.kalin}>Malzeme kabulü (depoya giriş)</Text>
    {is.durum?.eski_kayit ? <Text style={s.uyari}>Rollout'ta eski kayıt var (geliş {fmt(is.durum.eski_kayit.malzeme_gelis_tarihi)}) — tamlığı ve yeri doğrulanmamış; bu kabul teyit olarak işaretlenir.</Text> : null}
    <Text style={s.etiket}>Geliş tarihi (YYYY-AA-GG)</Text><TextInput style={s.girdi} value={f.gelis_tarihi} onChangeText={(t) => F("gelis_tarihi", t)} />
    <Text style={s.etiket}>Depo</Text>
    <View style={s.secRow}>{(secenek?.depolar || []).map((dp) => <TouchableOpacity key={dp.id} style={[s.sec, f.depo_id === dp.id && s.secOn]} onPress={() => F("depo_id", dp.id)}><Text style={[s.secTxt, f.depo_id === dp.id && s.secTxtOn]}>{dp.ad}</Text></TouchableOpacity>)}</View>
    <Text style={s.etiket}>Teslim durumu</Text>
    <View style={s.secRow}>
      <TouchableOpacity style={[s.sec, f.teslim_tipi === "TAM" && { backgroundColor: "#15803d", borderColor: "#15803d" }]} onPress={() => F("teslim_tipi", "TAM")}><Text style={[s.secTxt, f.teslim_tipi === "TAM" && s.secTxtOn]}>✓ Tamamı geldi</Text></TouchableOpacity>
      <TouchableOpacity style={[s.sec, f.teslim_tipi === "KISMI" && { backgroundColor: "#b45309", borderColor: "#b45309" }]} onPress={() => F("teslim_tipi", "KISMI")}><Text style={[s.secTxt, f.teslim_tipi === "KISMI" && s.secTxtOn]}>◐ Kısmi · eksik var</Text></TouchableOpacity>
    </View>
    {f.teslim_tipi === "KISMI" ? <><Text style={s.etiket}>Eksik kalan (zorunlu)</Text><TextInput style={s.girdi} value={f.eksik_aciklama} onChangeText={(t) => F("eksik_aciklama", t)} placeholder="ör. 1 AAU gelmedi" /></> : null}
    <Text style={s.etiket}>Kapsam</Text>
    <View style={s.secRow}>{[["RF", "RF / montaj"], ["ENH", "ENH (enerji)"]].map(([k, ad]) => <TouchableOpacity key={k} style={[s.sec, f.kapsam === k && s.secOn]} onPress={() => F("kapsam", k)}><Text style={[s.secTxt, f.kapsam === k && s.secTxtOn]}>{ad}</Text></TouchableOpacity>)}</View>
    <Text style={s.etiket}>Teslim alınan malzemeler</Text><KalemEditor kalemler={kalemler} setKalemler={setKalemler} />
    <Text style={s.etiket}>Açıklama</Text><TextInput style={s.girdi} value={f.aciklama} onChangeText={(t) => F("aciklama", t)} placeholder="İrsaliye no vb." />
    <TouchableOpacity style={s.ikincil} onPress={fotoEkle}><Text style={s.ikincilTxt}>📷 Teslim belgesi / fotoğraf çek{f.belgeler.length ? ` (${f.belgeler.length})` : ""}</Text></TouchableOpacity>
    {hata ? <Text style={s.hata}>{hata}</Text> : null}
    <View style={s.dugmeSatir}>
      <TouchableOpacity style={s.birincil} onPress={() => kaydet(false)} disabled={gonder}>{gonder ? <ActivityIndicator color="#fff" /> : <Text style={s.birincilTxt}>Kabulü kaydet</Text>}</TouchableOpacity>
      {mukerrer ? <TouchableOpacity style={[s.birincil, { backgroundColor: "#b45309" }]} onPress={() => kaydet(true)}><Text style={s.birincilTxt}>Ayrı teslimat olarak kaydet</Text></TouchableOpacity> : null}
      <TouchableOpacity style={s.ikincil} onPress={onIptal}><Text style={s.ikincilTxt}>Vazgeç</Text></TouchableOpacity>
    </View>
  </View>;
}
const HAREKET_AD = { "ekibe-teslim": "Ekibe teslim", devir: "Ekipler arası devir", "depoya-donus": "Ekipten depoya dönüş", kullanim: "Sahada kullanıldı", iade: "Huawei'ye iade" };
function HareketFormu({ tur, is, secenek, onTamam, onIptal }) {
  const loklar = [...new Map((is.bakiye || []).filter((b) => ["DEPO", "EKIP"].includes(b.lok_tip)).map((b) => [`${b.lok_tip}:${b.lok_id}`, b])).values()];
  const [kaynak, setKaynak] = useState(() => (loklar.find((b) => (tur === "ekibe-teslim" ? b.lok_tip === "DEPO" : ["devir", "depoya-donus"].includes(tur) ? b.lok_tip === "EKIP" : true)) || null));
  const [hedef, setHedef] = useState(null); const [gerekce, setGerekce] = useState(""); const [secim, setSecim] = useState({}); const [hata, setHata] = useState(""); const [gonder, setGonder] = useState(false);
  const anahtar = useRef(yeniAnahtar());
  const kk = kaynak ? `${kaynak.lok_tip}:${kaynak.lok_id}` : null;
  const kalemler = (is.bakiye || []).filter((b) => `${b.lok_tip}:${b.lok_id}` === kk);
  const hedefEkipler = (secenek?.ekipler || []).filter((e) => !(kaynak?.lok_tip === "EKIP" && String(e.ekip_no) === String(kaynak.lok_id)));
  const kaydet = async () => {
    if (gonder) return; setHata(""); setGonder(true);
    try {
      const kl = kalemler.filter((k) => secim[k.anahtar] !== "0").map((k) => ({ ad: k.ad, kod: k.kod, birim: k.birim, miktar: String(secim[k.anahtar] ?? k.miktar) }));
      const body = { site_code: is.site_code, gerekce, aciklama: gerekce, kalemler: kl };
      if (tur === "ekibe-teslim") { if (!hedef) throw new Error("Teslim alan ekibi seçin"); Object.assign(body, { depo_id: Number(kaynak.lok_id), ekip_no: Number(hedef) }); }
      else if (tur === "devir") { if (!hedef) throw new Error("Devralan ekibi seçin"); Object.assign(body, { kaynak_ekip_no: Number(kaynak.lok_id), hedef_ekip_no: Number(hedef) }); }
      else if (tur === "depoya-donus") { if (!hedef) throw new Error("Depoyu seçin"); Object.assign(body, { ekip_no: Number(kaynak.lok_id), depo_id: Number(hedef) }); }
      else Object.assign(body, kaynak.lok_tip === "EKIP" ? { ekip_no: Number(kaynak.lok_id) } : { depo_id: Number(kaynak.lok_id) });
      await hwPost(`/hw-malzeme/${tur}`, body, anahtar.current); anahtar.current = yeniAnahtar(); onTamam(`${HAREKET_AD[tur]} kaydedildi.`);
    } catch (e) { setHata(e.message); } finally { setGonder(false); }
  };
  return <View style={[s.kart, { borderColor: "#fde68a" }]}>
    <Text style={s.kalin}>{HAREKET_AD[tur]}</Text>
    {tur === "ekibe-teslim" ? <Text style={s.kucuk}>Plan ataması teslim değildir; malzeme ancak bu kayıtla ekibe geçer.</Text> : null}
    <Text style={s.etiket}>Kaynak</Text>
    <View style={s.secRow}>{loklar.filter((b) => (tur === "ekibe-teslim" ? b.lok_tip === "DEPO" : ["devir", "depoya-donus"].includes(tur) ? b.lok_tip === "EKIP" : true)).map((b) => { const on = kk === `${b.lok_tip}:${b.lok_id}`; return <TouchableOpacity key={`${b.lok_tip}:${b.lok_id}`} style={[s.sec, on && s.secOn]} onPress={() => setKaynak(b)}><Text style={[s.secTxt, on && s.secTxtOn]}>{b.lok_ad}</Text></TouchableOpacity>; })}</View>
    {["ekibe-teslim", "devir"].includes(tur) ? <><Text style={s.etiket}>{tur === "devir" ? "Devralan ekip" : "Teslim alan ekip"}</Text>
      <View style={s.secRow}>{hedefEkipler.map((e) => <TouchableOpacity key={e.ekip_no} style={[s.sec, String(hedef) === String(e.ekip_no) && s.secOn]} onPress={() => setHedef(e.ekip_no)}><Text style={[s.secTxt, String(hedef) === String(e.ekip_no) && s.secTxtOn]}>{e.ad}{e.ekip_tipi ? ` · ${e.ekip_tipi.ad}` : ""}</Text></TouchableOpacity>)}</View></> : null}
    {tur === "depoya-donus" ? <><Text style={s.etiket}>Depo</Text><View style={s.secRow}>{(secenek?.depolar || []).map((dp) => <TouchableOpacity key={dp.id} style={[s.sec, String(hedef) === String(dp.id) && s.secOn]} onPress={() => setHedef(dp.id)}><Text style={[s.secTxt, String(hedef) === String(dp.id) && s.secTxtOn]}>{dp.ad}</Text></TouchableOpacity>)}</View></> : null}
    <Text style={s.etiket}>Kalemler (boş = tamamı, 0 = taşınmaz)</Text>
    {!kalemler.length ? <Text style={s.uyari}>Seçilen kaynakta bu işe ait malzeme yok.</Text> : null}
    {kalemler.map((k) => <View key={k.anahtar} style={s.kalemSatir}><Text style={{ flex: 2 }}>{k.ad} — {sayi(k.miktar)} {k.birim}</Text>
      <TextInput style={[s.girdi, { flex: 1 }]} keyboardType="decimal-pad" placeholder={String(k.miktar)} value={secim[k.anahtar] ?? ""} onChangeText={(t) => setSecim((x) => ({ ...x, [k.anahtar]: t }))} /></View>)}
    <Text style={s.etiket}>{["devir", "iade"].includes(tur) ? "Gerekçe (zorunlu)" : "Açıklama"}</Text><TextInput style={s.girdi} value={gerekce} onChangeText={setGerekce} />
    {hata ? <Text style={s.hata}>{hata}</Text> : null}
    <View style={s.dugmeSatir}>
      <TouchableOpacity style={s.birincil} onPress={kaydet} disabled={gonder || !kalemler.length}>{gonder ? <ActivityIndicator color="#fff" /> : <Text style={s.birincilTxt}>Kaydet</Text>}</TouchableOpacity>
      <TouchableOpacity style={s.ikincil} onPress={onIptal}><Text style={s.ikincilTxt}>Vazgeç</Text></TouchableOpacity>
    </View>
  </View>;
}

/* ═══ DEPODAKİ SAHALAR ═══ */
export function DepodakiSahalarScreen({ navigation }) {
  const [v, setV] = useState(null); const [hata, setHata] = useState(""); const [grup, setGrup] = useState("depoda_montaj_bekliyor");
  useEffect(() => { apiGet("/hw-malzeme/depo-ozet").then((d) => (d?.ok ? setV(d) : setHata(d?.error || "Alınamadı"))).catch((e) => setHata(e.message)); }, []);
  const G = [["depoda_montaj_bekliyor", "Depoda · Montaj bekliyor", (x) => x.konum === "DEPODA" && x.teslim === "TAM" && !x.montaj_basladi], ["depoda_kismi", "Depoda · Kısmi", (x) => x.konum === "DEPODA" && x.teslim === "KISMI"],
    ["ekipte", "Ekipte", (x) => x.konum === "EKIPTE"], ["kismen_ekip_depo", "Kısmen ekipte / depoda", (x) => x.konum === "KISMEN_EKIP_DEPO"], ["eski_teyit", "Eski kayıt · teyit", (x) => x.konum === "ESKI_TEYIT"]];
  const sec = G.find((g) => g[0] === grup);
  return <SafeAreaView style={s.ekran}>
    <Baslik navigation={navigation} baslik="🏬 Depodaki Sahalar" />
    {hata ? <Text style={[s.hata, { margin: 14 }]}>{hata}</Text> : null}
    {!v && !hata ? <ActivityIndicator style={{ marginTop: 30 }} /> : null}
    {v ? <ScrollView contentContainerStyle={{ padding: 14 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>{G.map(([k, ad]) => { const o = v.ozet[k]; return <TouchableOpacity key={k} style={[s.sayacKutu, grup === k && { borderColor: LAC, backgroundColor: "#eff6ff" }]} onPress={() => setGrup(k)}>
        <Text style={s.kalin}>{ad}</Text><Text style={s.kucuk}>{o.fiziksel_saha} saha · {o.is_kaydi} iş · {sayi(o.malzeme_miktari)} kalem</Text></TouchableOpacity>; })}</ScrollView>
      <Text style={s.kucuk}>{v.aciklama}</Text>
      {v.isler.filter(sec[2]).map((x) => <TouchableOpacity key={x.site_code} style={s.kart} onPress={() => navigation.navigate("HwMalzeme", { kod: x.site_code })}>
        <Text style={s.fiz}>{x.fiziksel_id} <Text style={s.kod}>{x.site_code}</Text></Text>
        <Text style={s.kucuk}>{[x.bolge, x.il].filter(Boolean).join(" · ")}{x.ilk_gelis ? ` · geliş ${fmt(x.ilk_gelis)}` : ""}</Text>
        <Rozet d={x} />{x.eksik_aciklama ? <Text style={[s.kucuk, { color: "#b45309" }]}>eksik: {x.eksik_aciklama}</Text> : null}
      </TouchableOpacity>)}
      {!v.isler.filter(sec[2]).length ? <Text style={s.kucuk}>Bu grupta iş yok.</Text> : null}
    </ScrollView> : null}
  </SafeAreaView>;
}

/* ═══ WEEKLY ROLLOUT PLAN (gün / ekip bazlı) ═══ */
export function HaftalikPlanScreen({ navigation }) {
  const [hafta, setHafta] = useState(pazartesi(bugunISO())); const [v, setV] = useState(null); const [hata, setHata] = useState(""); const [yuk, setYuk] = useState(false);
  const [bolge, setBolge] = useState([]); const [tip, setTip] = useState([]); const [detay, setDetay] = useState(null);
  useEffect(() => { let iptal = false; setYuk(true);
    const qs = new URLSearchParams({ hafta, ...(bolge.length ? { bolge: bolge.join(",") } : {}), ...(tip.length ? { tip: tip.join(",") } : {}) }).toString();
    apiGet(`/operasyon/haftalik?${qs}`).then((d) => { if (iptal) return; if (d?.ok) { setV(d); setHata(""); } else setHata(d?.error || "Alınamadı"); }).catch((e) => !iptal && setHata(e.message)).finally(() => !iptal && setYuk(false));
    return () => { iptal = true; }; }, [hafta, bolge.join(), tip.join()]); // eslint-disable-line
  const bugun = v?.bugun || bugunISO();
  const Cip = ({ liste, secili, setSecili, secenek }) => <View style={s.secRow}>{secenek.map(([k, ad]) => { const on = secili.includes(k); return <TouchableOpacity key={k} style={[s.sec, on && s.secOn]} onPress={() => setSecili(on ? secili.filter((x) => x !== k) : [...secili, k])}><Text style={[s.secTxt, on && s.secTxtOn]}>{ad}</Text></TouchableOpacity>; })}</View>;
  return <SafeAreaView style={s.ekran}>
    <Baslik navigation={navigation} baslik="📅 Weekly Rollout Plan" sag={<TouchableOpacity onPress={() => navigation.navigate("EkiplerNerede")}><Text style={s.link}>Nerede?</Text></TouchableOpacity>} />
    <View style={s.haftaSatir}>
      <TouchableOpacity style={s.ikincil} onPress={() => setHafta(gunEkle(hafta, -7))}><Text style={s.ikincilTxt}>‹</Text></TouchableOpacity>
      <TouchableOpacity style={s.ikincil} onPress={() => setHafta(pazartesi(bugunISO()))}><Text style={s.ikincilTxt}>Bu hafta</Text></TouchableOpacity>
      <TouchableOpacity style={s.ikincil} onPress={() => setHafta(gunEkle(hafta, 7))}><Text style={s.ikincilTxt}>›</Text></TouchableOpacity>
      <Text style={[s.kalin, { marginLeft: 6 }]}>{fmt(hafta)} – {fmt(gunEkle(hafta, 6))}</Text>
    </View>
    <View style={{ paddingHorizontal: 14 }}>
      <Cip secili={bolge} setSecili={setBolge} secenek={(v?.secenekler?.bolgeler?.length ? v.secenekler.bolgeler : ["Ankara", "Bursa", "İzmir"]).map((b) => [b, b])} />
      <Cip secili={tip} setSecili={setTip} secenek={[["INHOUSE", "Inhouse"], ["TASERON", "Taşeron"]]} />
      <RenkAciklama />
    </View>
    {hata ? <Text style={[s.hata, { margin: 14 }]}>{hata}</Text> : null}
    {yuk && !v ? <ActivityIndicator style={{ marginTop: 20 }} /> : null}
    {v ? <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
      {v.gunler.map((g) => { const satirlar = v.ekipler.map((e) => ({ e, l: e.kartlar.filter((k) => k.tarih === g.tarih && ["MONTAJ", "FAALIYET", "ATAMA"].includes(k.tur)) })).filter((x) => x.l.length);
        return <View key={g.tarih} style={[s.gunKutu, g.tarih === bugun && { backgroundColor: "#eff6ff", borderColor: "#93c5fd" }]}>
          <Text style={s.gunBaslik}>{g.ad} {fmt(g.tarih)}{g.tarih === bugun ? " · Bugün" : ""}{g.tatil ? " · tatil" : ""}</Text>
          {!satirlar.length ? <Text style={s.kucuk}>Plan yok</Text> : null}
          {satirlar.map(({ e, l }) => <View key={e.ekip_no} style={{ marginTop: 6 }}>
            <Text style={s.kalin}>{e.ad} <Text style={s.kucuk}>{TIP_AD[e.tip.kod]}{e.bolge ? ` · ${e.bolge}` : ""}</Text></Text>
            {l.map((k, i) => { const R = FIILI[k.fiili?.renk || "MAVI"] || FIILI.GRI; return <TouchableOpacity key={i} style={[s.isKart, { backgroundColor: R.bg, borderLeftColor: R.kenar }]} onPress={() => setDetay({ k, e })}>
              <Text style={[s.kalin, { color: R.fg }]}>{k.fiziksel_id || k.ad}{k.gun_toplam > 1 ? `  (${k.gun_no}/${k.gun_toplam}. gün)` : ""}</Text>
              {k.site_code ? <Text style={[s.kucuk, { color: R.fg }]}>{k.site_code}</Text> : null}
              <Text style={{ color: R.fg }}>{k.ikon || ""} {k.is_turu || k.ad} · {k.saatli ? `${k.bas}–${k.bit}` : "tüm gün"}</Text>
              <Text style={[s.kalin, { color: R.fg }]}>{k.fiili?.ad || R.ad}</Text>
              {k.fiili?.issue ? <Text style={s.issue}>⚠ {k.fiili.issue.tur}</Text> : null}
              {k.malzeme ? <Text style={[s.kucuk, { color: R.fg }]}>📦 {k.malzeme.etiket}</Text> : null}
            </TouchableOpacity>; })}
          </View>)}
        </View>; })}
    </ScrollView> : null}
    <Modal visible={!!detay} transparent animationType="slide" onRequestClose={() => setDetay(null)}>
      <View style={s.modalArka}><View style={s.modalKutu}>{detay ? <ScrollView>
        <Text style={s.fiz}>{detay.k.fiziksel_id || detay.k.ad}</Text>{detay.k.site_code ? <Text style={s.kod}>{detay.k.site_code}</Text> : null}
        {[["İş türü", detay.k.is_turu], ["Planlanan", `${fmt(detay.k.tarih)} ${detay.k.saatli ? `${detay.k.bas}–${detay.k.bit}` : "tüm gün"}`], ["Fiilî durum", detay.k.fiili?.ad || "—"],
          ["Issue", detay.k.fiili?.issue ? `${detay.k.fiili.issue.tur}${detay.k.fiili.issue.aciklama ? `: ${detay.k.fiili.issue.aciklama}` : ""}` : "yok"], ["Son bildirim", detay.k.fiili?.son_bildirim ? `${fmtZ(detay.k.fiili.son_bildirim)}${detay.k.fiili.son_bildirim_eski ? " (eski)" : ""}` : "yok"],
          ["QC (ayrı)", detay.k.qc?.durum || "—"], ["Malzeme", detay.k.malzeme?.etiket || "kayıt yok"], ["Ekip", `${detay.e.ad} · ${TIP_AD[detay.e.tip.kod]}`],
          ["Ekip şefi", detay.e.sef ? `${detay.e.sef.ad}${detay.e.sef.telefon ? ` · ${detay.e.sef.telefon}` : ""}` : "kayıtlı değil"], ["Araç", detay.e.plaka || "kayıtlı değil"]].map(([a, b]) => <View key={a} style={s.dlSatir}><Text style={s.kucuk}>{a}</Text><Text style={s.kalin}>{b}</Text></View>)}
        {detay.e.sef?.telefon ? <TouchableOpacity style={s.ikincil} onPress={() => Linking.openURL(`tel:${detay.e.sef.telefon}`)}><Text style={s.ikincilTxt}>📞 Şefi ara</Text></TouchableOpacity> : null}
        <TouchableOpacity style={s.birincil} onPress={() => setDetay(null)}><Text style={s.birincilTxt}>Kapat</Text></TouchableOpacity>
      </ScrollView> : null}</View></View>
    </Modal>
  </SafeAreaView>;
}

/* ═══ EKİPLER NEREDE? ═══ */
export function EkiplerNeredeScreen({ navigation }) {
  const [v, setV] = useState(null); const [hata, setHata] = useState("");
  const yukle = useCallback(() => apiGet("/operasyon/ekipler-nerede").then((d) => (d?.ok ? setV(d) : setHata(d?.error || "Alınamadı"))).catch((e) => setHata(e.message)), []);
  useEffect(() => { yukle(); }, [yukle]);
  return <SafeAreaView style={s.ekran}>
    <Baslik navigation={navigation} baslik="🗺 Ekipler nerede?" />
    {hata ? <Text style={[s.hata, { margin: 14 }]}>{hata}</Text> : null}
    {!v && !hata ? <ActivityIndicator style={{ marginTop: 30 }} /> : null}
    {v ? <ScrollView contentContainerStyle={{ padding: 14 }} refreshControl={<RefreshControl refreshing={false} onRefresh={yukle} />}>
      <Text style={s.uyari}>{v.not}</Text>
      {v.ekipler.map((e) => { const sb = e.son_bildirim; const k = sb ? v.konumlar[sb.fiziksel_idler[0]] : null; return <View key={e.ekip_no} style={s.kart}>
        <Text style={s.fiz}>{e.ad}</Text>
        <Text style={s.kucuk}>{TIP_AD[e.tip.kod]}{e.bolge ? ` · ${e.bolge}` : ""} · Şef: {e.sef ? `${e.sef.ad}${e.sef.telefon ? ` · ${e.sef.telefon}` : ""}` : "kayıtlı değil"} · {e.plaka || "plaka kayıtlı değil"}</Text>
        <Text style={{ marginTop: 4 }}>Son bildirilen çalışma: <Text style={s.kalin}>{sb ? sb.fiziksel_idler.join(", ") : "bildirim yok"}</Text></Text>
        {sb ? <Text style={[s.kucuk, { color: sb.eski ? "#b45309" : "#166534" }]}>{sb.olay === "TAMAMLANDI" ? "Tamamlandı bildirimi" : sb.olay === "BASLADI" ? "İşe başladı" : sb.olay === "ISSUE" ? "Issue bildirimi" : sb.olay === "CIKIS" ? "Çıkış yaptı" : sb.olay} · {fmtZ(sb.zaman)}{sb.eski ? " · ESKİ BİLDİRİM" : ""}</Text> : null}
        <Text style={s.kucuk}>Bugün planlanan: {e.bugun_plan_fiziksel.length ? e.bugun_plan_fiziksel.join(", ") : "plan yok"}</Text>
        {e.plan_farkli ? <Text style={s.issue}>⚠ Planlanan saha ile bildirilen saha farklı</Text> : null}
        {k ? <TouchableOpacity onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${k.lat},${k.lng}`)}><Text style={s.link}>Bildirilen sahanın konumu ↗</Text></TouchableOpacity> : sb ? <Text style={s.kucuk}>Sahanın doğrulanmış koordinatı yok</Text> : null}
      </View>; })}
    </ScrollView> : null}
  </SafeAreaView>;
}

// İş kartı için fiilî bildirim (RolloutIslerScreen'den kullanılır): issue / issue kapandı. Başla / bitir mevcut akışta.
export async function fiiliBildir(isAtamaId, siteCode, olay, ek = {}) {
  return hwPost("/is-fiili/bildir", { is_atama_id: isAtamaId, site_code: siteCode, olay, ...ek }, yeniAnahtar());
}

const s = StyleSheet.create({
  ekran: { flex: 1, backgroundColor: "#f8fafc" },
  baslik: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 10, backgroundColor: LAC },
  geri: { paddingVertical: 4, paddingRight: 8, minWidth: 60 }, geriTxt: { color: "#fff", fontSize: 16, fontWeight: "700" },
  baslikTxt: { flex: 1, color: "#fff", fontSize: 17, fontWeight: "800", textAlign: "center" },
  link: { color: "#1d4ed8", fontWeight: "700" },
  etiket: { fontSize: 13, fontWeight: "700", color: "#334155", marginTop: 10, marginBottom: 4 },
  girdi: { borderWidth: 1.5, borderColor: "#cbd5e1", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15, backgroundColor: "#fff" },
  kart: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, padding: 12, marginTop: 8 },
  fiz: { fontSize: 20, fontWeight: "900", color: "#0f172a" }, kod: { fontSize: 14, fontWeight: "800", color: "#0f172a" },
  kucuk: { fontSize: 12.5, color: "#64748b" }, kalin: { fontWeight: "800", color: "#0f172a" },
  rozet: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginTop: 4 }, rozetTxt: { fontWeight: "800", fontSize: 13 },
  hata: { color: "#991b1b", fontWeight: "700", marginTop: 8 }, uyari: { color: "#92400e", backgroundColor: "#fffbeb", borderRadius: 8, padding: 8, marginTop: 6 },
  issue: { color: "#991b1b", fontWeight: "900", backgroundColor: "#fee2e2", alignSelf: "flex-start", paddingHorizontal: 6, borderRadius: 6, marginTop: 2 },
  ozetSatir: { flexDirection: "row", gap: 8, marginTop: 10 }, ozetKutu: { flex: 1, backgroundColor: "#fff", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#e2e8f0", marginTop: 8 },
  dugmeSatir: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  birincil: { backgroundColor: LAC, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, marginTop: 6 }, birincilTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  ikincil: { backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#cbd5e1", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginTop: 6, alignSelf: "flex-start" }, ikincilTxt: { color: "#1e293b", fontWeight: "800" },
  bolum: { fontSize: 16, fontWeight: "900", marginTop: 16, color: "#0f172a" },
  secRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  sec: { borderWidth: 1.5, borderColor: "#cbd5e1", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "#fff" }, secOn: { backgroundColor: LAC, borderColor: LAC },
  secTxt: { fontWeight: "700", color: "#1e293b" }, secTxtOn: { color: "#fff" },
  kalemSatir: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  sayacKutu: { borderWidth: 2, borderColor: "#e2e8f0", borderRadius: 12, padding: 10, marginRight: 8, backgroundColor: "#fff", minWidth: 160 },
  haftaSatir: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingTop: 8 },
  aciklama: { marginTop: 8, gap: 2 }, acSatir: { flexDirection: "row", alignItems: "center", gap: 6 }, acKutu: { width: 14, height: 14, borderRadius: 3, borderWidth: 2 }, acTxt: { fontSize: 12, color: "#334155" },
  gunKutu: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, padding: 10, marginBottom: 10 }, gunBaslik: { fontSize: 16, fontWeight: "900", color: "#0f172a" },
  isKart: { borderRadius: 10, borderLeftWidth: 5, padding: 8, marginTop: 6 },
  modalArka: { flex: 1, backgroundColor: "rgba(15,23,42,.5)", justifyContent: "flex-end" }, modalKutu: { backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: "85%" },
  dlSatir: { paddingVertical: 5, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
});
