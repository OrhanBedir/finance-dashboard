// Taşeron saha operasyonu (04.11.2026, Orhan): Teknocenter taşeron firmalarının (TEKNO_EMRAH, TEKNO_2KX, TEKNO_İZTAŞ …) saha ekranı.
//   Sahalarım (liste) + Harita — aynı iş listesi, aynı durum kuralları (/taseron-saha/isler). Firma / ekip kapsamı SUNUCUDA.
//   İş detayı → "Montaja Başla" (saha + iş kodu onayı) → "Montajı Tamamla" (tam / kısmi, açıklama, kalan iş, sorun, foto).
// Montajı tamamlamak QC, Huawei kabulü, PR, hakediş ya da fatura DEĞİLDİR; taşeron QC veremez, sorun / alarm kapatamaz.
// Fiyat, hakediş, fatura, ödeme verisi bu ekranlarda yoktur; ekran verisi yalnız bellekte tutulur (yalnız form taslağı telefonda).
// Gönderim: buton kilitli, her istek istek_anahtari taşır; bağlantı yoksa "Gönderilmeyi bekliyor" — başarısızlıkta "Kaydedildi" denmez.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StatusBar, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { aralik, golge, kose, renk } from "../tema";
import { BilgiSatiri, BolumBasligi, Buton, Kart, Metin, Rozet } from "../bilesenler/temel";
import { Bant, BosDurum, EskiVeriBandi, HataDurum, IskeletKart, Yukleniyor } from "../bilesenler/durum";
import { Ekran } from "../bilesenler/Ekran";
import { Alan, CipSecim } from "../bilesenler/form";
import { BaglantiBandi } from "../bilesenler/BaglantiBandi";
import { HaritaTuvali } from "./SahaHaritaEkrani";
import { useOturum } from "../oturum/OturumSaglayici";
import { useGecersizKil, useVeri } from "../api/veri";
import { taseronSahaApi } from "../api/uclar";
import { tokenOku } from "../api/istemci";
import { API_BASE } from "../config/ortam";
import { kuyrukBosalt, kuyrukDinle, kuyrukDurumu, kuyrukluGonder } from "../taslak/kuyruk";
import { taslak, taslakKaydet, taslakSil, yeniKimlik } from "../taslak/taslakDepo";
import { fisSec } from "../taslak/fis";
import { katmanlar } from "../harita/haritaMantik";
import { FILTRELER, HARITA_LEJANT, KAPSAMLAR, MONTAJ_TON, BOS_TAMAMLA, haritaSahalari, kapsamUyar, qcTon, sayac as sayacHesapla, suz, tamamlaGovdesi, tamamlaHatalari } from "../mantik/taseronSaha";
import { saat, tarih } from "../mantik/bicim";
import { hataMetni } from "../mantik/hata";

const ANAHTAR = "taseronSaha";
const isAnahtari = (kod) => `taseronSahaIs:${kod}`;
const zaman = (v) => (v ? `${tarih(v)}${/T/.test(String(v)) ? ` ${saat(v)}` : ""}` : null);
const SORUN_TON = { EKIP: "uyari", QC: "hata", KAYIT: "notr", ARA: "uyari" };

// Bekleyen (gönderilememiş) taşeron saha bildirimleri — kuyruktan
function useBekleyenler(kapsam) {
  const [l, setL] = useState([]);
  useEffect(() => {
    let canli = true;
    const oku = () => kuyrukDurumu(kapsam).then((d) => { if (canli) setL(d.bekleyen.filter((x) => String(x.yol).startsWith("/taseron-saha/"))); }).catch(() => {});
    oku();
    const kapat = kuyrukDinle(oku);
    return () => { canli = false; kapat(); };
  }, [kapsam]);
  return l;
}

// ── SAHALARIM / HARİTA ─────────────────────────────────────────────────────────────────────────────────────────────
export function TaseronSahaEkrani({ navigation }) {
  const kenar = useSafeAreaInsets();
  const { kapsam } = useOturum();
  const gecersizKil = useGecersizKil();
  const v = useVeri(ANAHTAR, () => taseronSahaApi.isler());
  const [gorunum, setGorunum] = useState("liste");
  const [filtre, setFiltre] = useState("tumu");
  const [arama, setArama] = useState("");
  const [kapsamSec, setKapsamSec] = useState("firma");
  const [secili, setSecili] = useState(null);
  const bekleyen = useBekleyenler(kapsam);
  useFocusEffect(useCallback(() => {
    StatusBar.setBarStyle("light-content", true);
    kuyrukBosalt(kapsam).then((r) => { if (r?.gonderilen) gecersizKil([ANAHTAR]); }).catch(() => {});
    return () => StatusBar.setBarStyle("dark-content", true);
  }, [kapsam])); // eslint-disable-line react-hooks/exhaustive-deps

  const veri = v.veri;
  const isler = veri?.isler || [];
  const kapsamli = useMemo(() => isler.filter((x) => kapsamUyar(x, kapsamSec)), [isler, kapsamSec]);
  const say = useMemo(() => sayacHesapla(kapsamli), [kapsamli]);
  const liste = useMemo(() => suz(isler, { filtre, arama, kapsam: kapsamSec }), [isler, filtre, arama, kapsamSec]);
  const sahalar = useMemo(() => haritaSahalari(liste), [liste]);
  const k = useMemo(() => katmanlar(sahalar), [sahalar]);
  const baslik = veri?.ekip ? `${veri.firma?.ad} · ${veri.ekip.ad}` : veri?.firma?.ad || "Sahalarım";
  const ac = (kod) => navigation.navigate("TaseronSahaDetay", { kod });

  return (
    <View style={{ flex: 1, backgroundColor: renk.zemin }}>
      <View style={{ backgroundColor: renk.lacivert, paddingTop: kenar.top + aralik.xs, paddingBottom: aralik.s }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: aralik.m }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Metin tur="baslikL" renk="#FFFFFF" accessibilityRole="header">Sahalar</Metin>
            <Metin tur="minik" renk="#B8C7DA" numberOfLines={1}>{baslik}{veri?.rol === "CALISAN" ? " · ekip görünümü" : veri ? " · firma görünümü" : ""}</Metin>
          </View>
          <Pressable onPress={() => navigation.navigate("TaseronYaptiklarimiz")} accessibilityRole="button" accessibilityLabel="Yaptığımız Sahalar" hitSlop={8}
            style={({ pressed }) => [{ height: 36, paddingHorizontal: 10, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.14)", flexDirection: "row", alignItems: "center" }, pressed && { opacity: 0.6 }]}>
            <Ionicons name="ribbon-outline" size={16} color="#FFFFFF" />
            <Metin tur="etiket" renk="#FFFFFF" style={{ marginLeft: 5 }}>Yaptıklarımız</Metin>
          </Pressable>
          <Pressable onPress={v.yenile} accessibilityRole="button" accessibilityLabel="Yenile" hitSlop={8}
            style={({ pressed }) => [{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.6 }]}>
            <Ionicons name="refresh" size={22} color="#FFFFFF" />
          </Pressable>
        </View>
        {/* Sahalarım / Harita */}
        <View style={{ flexDirection: "row", marginHorizontal: aralik.m, marginTop: aralik.s, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: kose.m, padding: 3 }}>
          {[["liste", "Sahalarım", "list"], ["harita", "Harita", "map"]].map(([kod, ad, ikon]) => {
            const sec = gorunum === kod;
            return (
              <Pressable key={kod} onPress={() => { setGorunum(kod); setSecili(null); }} accessibilityRole="tab" accessibilityState={{ selected: sec }}
                style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", height: 40, borderRadius: kose.m - 2, backgroundColor: sec ? "#FFFFFF" : "transparent" }}>
                <Ionicons name={sec ? ikon : `${ikon}-outline`} size={17} color={sec ? renk.lacivert : "#DCE5F0"} />
                <Metin tur="kucukKalin" renk={sec ? renk.lacivert : "#FFFFFF"} style={{ marginLeft: 6 }}>{ad}</Metin>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", marginHorizontal: aralik.m, marginTop: aralik.s, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: kose.m, paddingHorizontal: aralik.s }}>
          <Ionicons name="search" size={18} color="#B8C7DA" />
          <TextInput value={arama} onChangeText={setArama} placeholder="Site ID ya da iş kodu ara" placeholderTextColor="#8FA3BC" autoCapitalize="characters"
            autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" accessibilityLabel="Site ID ya da iş kodu ara"
            style={{ flex: 1, color: "#FFFFFF", fontSize: 16, paddingVertical: 10, paddingHorizontal: aralik.xs }} />
        </View>
        {veri && veri.rol !== "CALISAN" ? (
          <View style={{ flexDirection: "row", marginHorizontal: aralik.m, marginTop: aralik.s, gap: aralik.xs }}>
            {KAPSAMLAR.map((kp) => {
              const sec = kapsamSec === kp.kod;
              const n = isler.filter((x) => kapsamUyar(x, kp.kod)).length;
              return (
                <Pressable key={kp.kod} onPress={() => setKapsamSec(kp.kod)} accessibilityRole="tab" accessibilityState={{ selected: sec }}
                  style={{ flex: 1, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: sec ? "#FFFFFF" : "rgba(255,255,255,0.25)", backgroundColor: sec ? "rgba(255,255,255,0.18)" : "transparent" }}>
                  <Metin tur="etiket" renk="#FFFFFF" numberOfLines={1}>{kp.ad} {n}</Metin>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: aralik.m, paddingTop: aralik.s, gap: aralik.xs }}>
          {FILTRELER.map((f) => {
            const sec = filtre === f.kod;
            return (
              <Pressable key={f.kod} onPress={() => setFiltre(f.kod)} accessibilityRole="button" accessibilityState={{ selected: sec }}
                style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", height: 36, paddingHorizontal: 13, borderRadius: 18, backgroundColor: sec ? renk.altin : "rgba(255,255,255,0.14)" }, pressed && { opacity: 0.8 }]}>
                <Metin tur="etiket" renk={sec ? renk.lacivertKoyu : "#FFFFFF"}>{f.ad}</Metin>
                {veri ? <Metin tur="etiket" renk={sec ? renk.lacivertKoyu : "#B8C7DA"} style={{ marginLeft: 5 }}>{say[f.kod]}</Metin> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <BaglantiBandi />
      {bekleyen.length ? (
        <Bant tonAdi="uyari" ikon="cloud-upload-outline" baslik={`Gönderilmeyi bekliyor: ${bekleyen.length}`} style={{ margin: aralik.m, marginBottom: 0 }}
          metin={`${bekleyen.map((b) => b.aciklama).join(" · ")}. Bağlantı gelince kendiliğinden gönderilir; tekrar basmayın.`}
          eylem="Şimdi gönder" onEylem={() => kuyrukBosalt(kapsam).then((r) => { if (r?.gonderilen) gecersizKil([ANAHTAR]); })} />
      ) : null}

      {v.yukleniyor && !veri ? <View style={{ padding: aralik.m }}><IskeletKart /><IskeletKart /><IskeletKart /></View>
        : v.hata && !veri ? <View style={{ padding: aralik.m }}><Kart><HataDurum hata={v.hata} baslik="Sahalar alınamadı" onTekrar={v.yenile} /></Kart></View>
        : gorunum === "liste" ? (
          <ScrollView contentContainerStyle={{ padding: aralik.m, paddingBottom: aralik.xxl }}>
            <EskiVeriBandi v={v} style={{ marginBottom: aralik.s }} />
            {!isler.length ? <Kart><BosDurum ikon="construct-outline" baslik="Size atanmış saha işi yok" aciklama="Teknocenter iş atadığında burada görünür." /></Kart>
              : !liste.length ? <Kart><BosDurum ikon="search-outline" baslik="Bu filtreye uyan iş yok" eylem="Filtreyi temizle" onEylem={() => { setFiltre("tumu"); setArama(""); }} /></Kart> : null}
            {liste.map((x) => <SahaKarti key={x.kod} x={x} onPress={() => ac(x.kod)} />)}
            {liste.length && say.tumu ? <Metin tur="minik" renk={renk.metinSoluk} style={{ textAlign: "center", marginTop: aralik.s }}>{veri.not}</Metin> : null}
          </ScrollView>
        ) : (
          <View style={{ flex: 1, backgroundColor: "#DCE7F2" }}>
            <HaritaTuvali k={k} sahalar={sahalar} secili={secili?.id || null} onSaha={(s) => setSecili(s)} onIl={() => {}} aktifIller={[]}
              alt={0} toplam={haritaSahalari(isler).length} onListe={() => setGorunum("liste")} benimGoster={false} lejant={HARITA_LEJANT} yaklasikLejant={false} />
            {secili ? <HaritaSahaPaneli s={secili} onKapat={() => setSecili(null)} onIs={ac} /> : null}
          </View>
        )}
    </View>
  );
}

function SahaKarti({ x, onPress }) {
  return (
    <Kart onPress={onPress} style={{ marginBottom: aralik.s }} erisimEtiketi={`${x.kod}, ${x.montaj.ad}, ${x.qc.ad}${x.sorun.var ? ", sorun var" : ""}`}>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Metin tur="govdeKalin" numberOfLines={1}>{x.kod}</Metin>
          <Metin tur="kucuk" renk={renk.metinIkincil} numberOfLines={1}>{[x.fiziksel_id, x.is_turu].filter(Boolean).join(" · ")}</Metin>
        </View>
        <Rozet metin={x.montaj.ad} tonAdi={MONTAJ_TON[x.montaj.durum]} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: aralik.xs }}>
        {!x.qc.gizli ? <Rozet metin={x.qc.ad} tonAdi={qcTon(x.qc)} ikon="shield-checkmark-outline" /> : null}
        {x.sorun.kayitlar.map((s, i) => <Rozet key={i} metin={s.etiket} tonAdi={SORUN_TON[s.kaynak] || "uyari"} ikon="alert-circle-outline" />)}
        {x.ekip ? <Rozet metin={x.ekip.ad} tonAdi="marka" ikon="people-outline" /> : <Rozet metin="Ekibe ayrılmamış" tonAdi="notr" />}
        {!x.islem.montaj ? <Rozet metin="Salt okunur" tonAdi="notr" ikon="eye-outline" /> : null}
      </View>
      {x.konum_yok ? <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: 6 }}>Konum kayıtlı değil — yalnız listede görünür</Metin> : null}
    </Kart>
  );
}

function HaritaSahaPaneli({ s, onKapat, onIs }) {
  const kenar = useSafeAreaInsets();
  return (
    <View style={[{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: renk.yuzey, borderTopLeftRadius: kose.l, borderTopRightRadius: kose.l,
      paddingHorizontal: aralik.m, paddingTop: aralik.s, paddingBottom: kenar.bottom + aralik.s, maxHeight: 320 }, golge]}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: aralik.xs }}>
        <View style={{ flex: 1 }}>
          <Metin tur="baslikM">{s.id}</Metin>
          <Metin tur="minik" renk={renk.metinIkincil}>{s.isler.length} iş{s.il_adi ? ` · ${s.il_adi}` : ""}</Metin>
        </View>
        <Pressable onPress={onKapat} accessibilityRole="button" accessibilityLabel="Kapat" hitSlop={8} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="close" size={22} color={renk.metinIkincil} />
        </Pressable>
      </View>
      <ScrollView>
        {s.isler.map((x) => (
          <Pressable key={x.kod} onPress={() => onIs(x.kod)} accessibilityRole="button"
            style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", minHeight: 52, borderTopWidth: 0.5, borderTopColor: renk.cizgi }, pressed && { opacity: 0.7 }]}>
            <View style={{ flex: 1 }}>
              <Metin tur="govdeKalin">{x.kod}</Metin>
              <Metin tur="minik" renk={renk.metinIkincil} numberOfLines={1}>{[x.is_turu, x.qc.gizli ? null : x.qc.ad, x.sorun.var ? "Sorun var" : null, x.islem.montaj ? null : "Salt okunur"].filter(Boolean).join(" · ")}</Metin>
            </View>
            <Rozet metin={x.montaj.ad} tonAdi={MONTAJ_TON[x.montaj.durum]} />
            <Ionicons name="chevron-forward" size={18} color={renk.metinSoluk} style={{ marginLeft: 6 }} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

// ── İŞ DETAYI ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function TaseronSahaDetayEkrani({ route, navigation }) {
  const { kod } = route.params;
  const { kapsam } = useOturum();
  const gecersizKil = useGecersizKil();
  const v = useVeri(isAnahtari(kod), async () => (await taseronSahaApi.is(kod)).is);
  const [bekle, setBekle] = useState(false);
  const kilit = useRef(false);
  const bekleyen = useBekleyenler(kapsam).filter((b) => b.yol === `/taseron-saha/is/${encodeURIComponent(kod)}/basla`);
  const x = v.veri;

  const basla = () => {
    if (!x || kilit.current) return;
    Alert.alert("Montaja başlıyor musunuz?", `Saha: ${x.fiziksel_id}\nİş kodu: ${x.kod}\n\nBaşlangıç saati, ekibiniz ve adınız sunucuya ulaştığı anda kaydedilir.`, [
      { text: "Vazgeç", style: "cancel" },
      { text: "Evet, başla", onPress: async () => {
        if (kilit.current) return;
        kilit.current = true; setBekle(true);
        try {
          const r = await kuyrukluGonder(kapsam, { yol: `/taseron-saha/is/${encodeURIComponent(x.kod)}/basla`, govde: { onay_kod: x.kod }, aciklama: `Montaja başla · ${x.kod}` });
          if (r.kuyrukta) {
            Alert.alert("Gönderilmeyi bekliyor", "Bağlantı yok. Başlangıç telefonda bekliyor ve bağlantı gelince kendiliğinden gönderilecek. Tekrar basmayın.");
          } else {
            gecersizKil([isAnahtari(x.kod), ANAHTAR]);
            Alert.alert(r.sonuc?.zaten ? "Bilgi" : "Kaydedildi", r.sonuc?.mesaj || "Montaj başlangıcı kaydedildi");
          }
        } catch (e) {
          gecersizKil([isAnahtari(x.kod)]);
          Alert.alert("Başlangıç kaydedilemedi", hataMetni(e));
        } finally { kilit.current = false; setBekle(false); }
      } },
    ]);
  };
  const alt = !x ? null : bekleyen.length ? <Bant tonAdi="uyari" ikon="cloud-upload-outline" baslik="Montaj başlangıcı gönderilmeyi bekliyor" metin="Bağlantı gelince kendiliğinden gönderilir." />
    : x.islem.basla ? <Buton baslik="Montaja Başla" ikon="play" yukleniyor={bekle} onPress={basla} />
    : x.islem.tamamla ? <Buton baslik="Montajı Tamamla" ikon="checkmark-done" tur="basari" onPress={() => navigation.navigate("TaseronMontajTamamla", { kod: x.kod, fiziksel_id: x.fiziksel_id })} />
    : null;

  return (
    <Ekran baslik={kod} altBaslik={x ? `${x.fiziksel_id} · ${x.is_turu}` : "Yükleniyor…"} yenileniyor={v.yenileniyor} onYenile={v.yenile} alt={alt}>
      {v.yukleniyor && !x ? <><IskeletKart yukseklik={160} /><IskeletKart /></> : null}
      {v.hata && !x ? <Kart><HataDurum hata={v.hata} baslik="İş bilgisi alınamadı" onTekrar={v.yenile} /></Kart> : null}
      <EskiVeriBandi v={v} style={{ marginBottom: aralik.s }} />
      {x ? (
        <>
          <Kart>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <Rozet metin={x.montaj.ad} tonAdi={MONTAJ_TON[x.montaj.durum]} ikon="construct-outline" />
              {!x.qc.gizli ? <Rozet metin={x.qc.ad} tonAdi={qcTon(x.qc)} ikon="shield-checkmark-outline" /> : null}
            </View>
            <View style={{ marginTop: aralik.s }}>
              <BilgiSatiri etiket="Site ID" deger={x.fiziksel_id} />
              <BilgiSatiri etiket="İş kodu" deger={x.kod} />
              <BilgiSatiri etiket="İş türü" deger={x.is_turu} />
              <BilgiSatiri etiket="Ekip" deger={x.ekip?.ad || "Ekibe ayrılmamış"} />
              <BilgiSatiri etiket="Montaj başlangıcı" deger={zaman(x.montaj.baslama) || "—"} />
              <BilgiSatiri etiket="Montaj bitişi" deger={zaman(x.montaj.bitis) || "—"} />
              {!x.qc.gizli ? <BilgiSatiri etiket="QC" deger={x.qc.kapanis ? `${x.qc.ad} · ${tarih(x.qc.kapanis)}` : x.qc.ad} son /> : <BilgiSatiri etiket="QC" deger="Bu iş kolunun QC bilgisi sizde değil" son />}
            </View>
            {x.montaj.uyarilar?.length ? <Bant tonAdi="notr" baslik="Kontrol gerekli" metin={`${x.montaj.uyarilar.join(" · ")}. Teknocenter kontrol edecek.`} style={{ marginTop: aralik.s }} /> : null}
          </Kart>
          {!x.islem.montaj ? <Bant tonAdi="notr" ikon="eye-outline" baslik="Salt okunur" metin={x.islem.neden} style={{ marginTop: aralik.s }} />
            : !x.islem.basla && !x.islem.tamamla && x.islem.engel ? <Bant tonAdi="notr" ikon="information-circle-outline" metin={x.islem.engel} style={{ marginTop: aralik.s }} /> : null}
          {x.montaj_kaynagi ? <Bant tonAdi="bilgi" ikon="git-branch-outline" metin={x.montaj_kaynagi} style={{ marginTop: aralik.s }} /> : null}

          <BolumBasligi baslik="Açık sorunlar" />
          {!x.sorun.var ? <Kart><Metin tur="kucuk" renk={renk.metinIkincil}>Açık sorun kaydı yok.</Metin></Kart>
            : x.sorun.kayitlar.map((s, i) => (
              <Kart key={i} style={{ marginBottom: aralik.xs }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Rozet metin={s.etiket} tonAdi={SORUN_TON[s.kaynak] || "uyari"} ikon="alert-circle-outline" />
                  <Metin tur="kucukKalin" style={{ marginLeft: aralik.xs, flex: 1 }} numberOfLines={1}>{s.tur}</Metin>
                </View>
                {s.aciklama ? <Metin tur="kucuk" style={{ marginTop: 6 }}>{s.aciklama}</Metin> : null}
                <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: 4 }}>
                  {s.kaynak === "EKIP" ? "Ekibinizin bildirimi — doğrulanmış teknik alarm değildir. Sorunu Teknocenter kapatır."
                    : s.kaynak === "QC" ? "QC sonucu (Teknocenter / Huawei). Düzeltme için Teknocenter ile görüşün."
                    : "Teknocenter kaydı. Ayrıntı için Teknocenter ile görüşün."}{s.zaman ? ` · ${zaman(s.zaman)}` : ""}
                </Metin>
              </Kart>
            ))}

          {x.notlar?.length ? (<><BolumBasligi baslik="Operasyon notları" />
            <Kart>{x.notlar.map((n, i) => <Metin key={i} tur="kucuk" style={{ marginTop: i ? 6 : 0 }}>{n}</Metin>)}</Kart></>) : null}

          <BolumBasligi baslik="Ekip raporları" />
          {!x.raporlar.length ? <Kart><Metin tur="kucuk" renk={renk.metinIkincil}>Henüz rapor yok.</Metin></Kart>
            : x.raporlar.map((r) => <RaporKarti key={r.id} r={r} onDuzelt={() => navigation.navigate("TaseronMontajTamamla", { kod: x.kod, fiziksel_id: x.fiziksel_id, rapor: r })} />)}
          <Bant tonAdi="bilgi" metin={x.bilgi} style={{ marginTop: aralik.m }} />
        </>
      ) : null}
    </Ekran>
  );
}

function RaporKarti({ r, onDuzelt }) {
  const token = tokenOku();
  return (
    <Kart style={{ marginBottom: aralik.xs }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Metin tur="govdeKalin" style={{ flex: 1 }}>{r.tur_ad}{r.standart ? " · standart tam" : ""}</Metin>
        {r.tur !== "BASLADI" ? <Rozet metin={r.pr_durum_ad} tonAdi={r.pr_durum === "BEKLIYOR" ? "notr" : "bilgi"} /> : null}
      </View>
      <Metin tur="minik" renk={renk.metinIkincil}>{[r.bildiren, r.ekip, zaman(r.zaman)].filter(Boolean).join(" · ")}{r.surum > 1 ? ` · düzeltildi (${r.surum}. sürüm)` : ""}</Metin>
      {r.aciklama ? <Metin tur="kucuk" style={{ marginTop: 6 }}>{r.aciklama}</Metin> : null}
      {r.kalan_is ? <Metin tur="kucuk" style={{ marginTop: 4 }}><Metin tur="kucukKalin">Kalan iş: </Metin>{r.kalan_is}</Metin> : null}
      {r.sorun ? <Metin tur="kucuk" style={{ marginTop: 4 }}><Metin tur="kucukKalin">Sorun: </Metin>{r.sorun}</Metin> : null}
      {r.fotolar.length ? (
        <ScrollView horizontal style={{ marginTop: aralik.xs }} contentContainerStyle={{ gap: 6 }}>
          {r.fotolar.map((f) => <Image key={f.id} accessibilityLabel={f.ad} style={{ width: 72, height: 72, borderRadius: kose.s, backgroundColor: renk.cizgi }}
            source={{ uri: `${API_BASE}${taseronSahaApi.fotoYolu(r.id, f.id)}`, headers: token ? { Authorization: `Bearer ${token}` } : undefined }} />)}
        </ScrollView>
      ) : null}
      {r.teknocenter_notu ? <Bant tonAdi="bilgi" baslik="Teknocenter notu" metin={r.teknocenter_notu} style={{ marginTop: aralik.xs }} /> : null}
      {r.duzeltilebilir ? <Buton baslik="Raporu düzelt" ikon="create-outline" tur="ikincil" kucuk onPress={onDuzelt} style={{ marginTop: aralik.xs }} /> : null}
    </Kart>
  );
}

// ── MONTAJI TAMAMLA (ve rapor düzeltme) ────────────────────────────────────────────────────────────────────────────
// Taslak telefonda saklanır (yalnız bu kişinin kapsamında): yazılanlar kaybolmaz, istek anahtarı korunur → yeniden gönderim tek kayıt.
// Sıra: 1) rapor (istek_anahtari) → bildirim_id taslağa yazılır  2) fotoğraflar tek tek (her biri kendi anahtarıyla)  3) taslak silinir.
const FOTO_MAX = 6;
export function TaseronMontajTamamlaEkrani({ route, navigation }) {
  const { kod, fiziksel_id, rapor } = route.params;
  const duzelt = !!rapor;
  const { kapsam } = useOturum();
  const gecersizKil = useGecersizKil();
  const TASLAK_ID = duzelt ? `taseron-duzelt:${rapor.id}` : `taseron-tamamla:${kod}`;
  const [f, setF] = useState(duzelt ? { tur: rapor.tur === "TAMAMLANDI" ? "TAM" : "KISMI", standart: !!rapor.standart, aciklama: rapor.aciklama || "", kalan_is: rapor.kalan_is || "", sorun: rapor.sorun || "" } : BOS_TAMAMLA);
  const [fotolar, setFotolar] = useState([]);
  const [meta, setMeta] = useState({ anahtar: null, bildirim_id: duzelt ? rapor.id : null, bekliyor: false });
  const [hazir, setHazir] = useState(false);
  const [gonderildi, setGonderildi] = useState(false);
  const [denendi, setDenendi] = useState(false);
  const [bekle, setBekle] = useState(false);
  const kilit = useRef(false);
  const h = denendi ? tamamlaHatalari(f) : {};

  useEffect(() => {
    let canli = true;
    taslak(kapsam, TASLAK_ID).then((t) => {
      if (!canli) return;
      if (t) { if (t.form) setF(t.form); setFotolar(t.fotolar || []); setMeta((m) => ({ ...m, anahtar: t.anahtar || null, bildirim_id: t.bildirim_id || m.bildirim_id, bekliyor: !!t.bekliyor })); }
      setHazir(true);
    }).catch(() => setHazir(true));
    return () => { canli = false; };
  }, [kapsam, TASLAK_ID]);
  // Yazılanlar her değişiklikte telefona (gönderilene kadar)
  useEffect(() => {
    if (!hazir || gonderildi) return;
    const t = setTimeout(() => { taslakKaydet(kapsam, { id: TASLAK_ID, tur: "taseron-saha", kod, form: f, fotolar, anahtar: meta.anahtar, bildirim_id: meta.bildirim_id, bekliyor: meta.bekliyor }).catch(() => {}); }, 400);
    return () => clearTimeout(t);
  }, [f, fotolar, meta, hazir, gonderildi]); // eslint-disable-line react-hooks/exhaustive-deps

  const fotoEkle = async (kaynak) => {
    if (fotolar.length >= FOTO_MAX) return Alert.alert("En çok 6 fotoğraf", "Bir rapora en çok 6 fotoğraf eklenir.");
    try {
      const p = await fisSec(kaynak, kapsam);
      if (p) setFotolar((l) => [...l, { uri: p.uri, ad: p.ad, mime: p.mime, etiket: `Fotoğraf ${l.length + 1}`, anahtar: `f-${yeniKimlik()}`, yuklendi: false }]);
    } catch (e) { Alert.alert("Fotoğraf eklenemedi", e?.message || "Tekrar deneyin."); }
  };

  const gonder = async () => {
    if (kilit.current) return;
    setDenendi(true);
    if (Object.keys(tamamlaHatalari(f)).length) return;
    kilit.current = true; setBekle(true);
    let m = { ...meta };
    try {
      // 1) Rapor
      if (!m.bildirim_id) {
        m.anahtar = m.anahtar || `ts-${yeniKimlik()}`;
        await taslakKaydet(kapsam, { id: TASLAK_ID, tur: "taseron-saha", kod, form: f, fotolar, anahtar: m.anahtar, bekliyor: true });
        setMeta({ ...m, bekliyor: true });
        let r;
        try { r = await taseronSahaApi.tamamla(kod, tamamlaGovdesi(f, kod, m.anahtar)); }
        catch (e) {
          if (e?.sonucBelirsiz || e?.tur === "sunucu") {
            Alert.alert("Gönderilmeyi bekliyor", "Bağlantı yok ya da sunucu yanıt vermedi. Yazdıklarınız telefonda saklandı. Bağlantı gelince \"Tekrar gönder\"e basın — aynı rapor ikinci kez kaydedilmez.");
            return;
          }
          throw e;
        }
        if (r.zaten && !r.bildirim_id) {
          await taslakSil(kapsam, TASLAK_ID); setGonderildi(true); gecersizKil([isAnahtari(kod), ANAHTAR]);
          Alert.alert("Bilgi", r.mesaj, [{ text: "Tamam", onPress: () => navigation.goBack() }]);
          return;
        }
        m = { ...m, bildirim_id: r.bildirim_id, bekliyor: false, mesaj: r.mesaj };
        setMeta(m);
        await taslakKaydet(kapsam, { id: TASLAK_ID, tur: "taseron-saha", kod, form: f, fotolar, anahtar: m.anahtar, bildirim_id: m.bildirim_id, bekliyor: false });
      } else if (duzelt && !m.duzeltildi) {
        await taseronSahaApi.duzelt(rapor.id, { aciklama: f.aciklama, kalan_is: f.kalan_is, sorun: f.sorun, standart: f.standart, surum: rapor.surum });
        m = { ...m, duzeltildi: true, mesaj: "Rapor düzeltildi (önceki sürüm saklandı)" }; // foto tekrarında ikinci kez düzeltme gönderilmez
        setMeta(m);
      }
      // 2) Fotoğraflar
      const kalan = [];
      const yeniListe = [...fotolar];
      for (let i = 0; i < yeniListe.length; i++) {
        const p = yeniListe[i];
        if (p.yuklendi) continue;
        try { await taseronSahaApi.fotoYukle(m.bildirim_id, p, p.anahtar); yeniListe[i] = { ...p, yuklendi: true }; }
        catch (e) { kalan.push(e); }
      }
      setFotolar(yeniListe);
      gecersizKil([isAnahtari(kod), ANAHTAR]);
      if (kalan.length) {
        await taslakKaydet(kapsam, { id: TASLAK_ID, tur: "taseron-saha", kod, form: f, fotolar: yeniListe, anahtar: m.anahtar, bildirim_id: m.bildirim_id, bekliyor: false });
        Alert.alert("Rapor kaydedildi, fotoğraf eksik", `${kalan.length} fotoğraf gönderilemedi (${hataMetni(kalan[0])}). "Tekrar gönder" ile yalnız eksik fotoğraflar gönderilir.`);
        return;
      }
      await taslakSil(kapsam, TASLAK_ID);
      setGonderildi(true);
      Alert.alert("Kaydedildi", m.mesaj || "Bildiriminiz kaydedildi", [{ text: "Tamam", onPress: () => navigation.goBack() }]);
    } catch (e) {
      Alert.alert("Gönderilemedi", hataMetni(e));
    } finally { kilit.current = false; setBekle(false); }
  };

  const raporGitti = !!meta.bildirim_id && !duzelt;
  const butonAdi = meta.bekliyor || (raporGitti && fotolar.some((p) => !p.yuklendi)) ? "Tekrar gönder" : duzelt ? "Düzeltmeyi kaydet" : "Gönder";
  return (
    <Ekran baslik={duzelt ? "Raporu düzelt" : "Montajı Tamamla"} altBaslik={`${fiziksel_id} · ${kod}`} klavye
      alt={hazir ? <Buton baslik={butonAdi} ikon="send" tur={f.tur === "TAM" ? "basari" : "birincil"} yukleniyor={bekle} onPress={gonder} /> : null}>
      {!hazir ? <Yukleniyor /> : (
        <>
          <Kart style={{ marginBottom: aralik.m }}>
            <BilgiSatiri etiket="Site ID" deger={fiziksel_id} />
            <BilgiSatiri etiket="İş kodu" deger={kod} son />
          </Kart>
          {meta.bekliyor ? <Bant tonAdi="uyari" ikon="cloud-upload-outline" baslik="Gönderilmeyi bekliyor" metin="Bu rapor henüz sunucuya ulaşmadı. Bağlantı gelince Tekrar gönder'e basın." style={{ marginBottom: aralik.m }} /> : null}
          {raporGitti && fotolar.some((p) => !p.yuklendi) && !bekle ? <Bant tonAdi="basari" baslik="Rapor kaydedildi" metin="Eksik fotoğraflar gönderilince taslak kapanır." style={{ marginBottom: aralik.m }} /> : null}
          <CipSecim etiket="Montaj sonucu" zorunlu hata={h.tur} deger={f.tur} onSec={(t) => !duzelt && !raporGitti && setF((x) => ({ ...x, tur: t }))}
            secenekler={[{ id: "TAM", ad: "Tam tamamlandı", ikon: "checkmark-done" }, { id: "KISMI", ad: "Kısmi · devam edecek", ikon: "time-outline" }]} />
          {f.tur === "TAM" ? (
            <Pressable onPress={() => !raporGitti && setF((x) => ({ ...x, standart: !x.standart }))} accessibilityRole="checkbox" accessibilityState={{ checked: f.standart }}
              style={{ flexDirection: "row", alignItems: "center", minHeight: 56, padding: aralik.s, borderRadius: kose.m, borderWidth: 1.5, borderColor: f.standart ? renk.basari : renk.cizgiKoyu,
                backgroundColor: f.standart ? renk.basariZemin : renk.yuzey, marginBottom: aralik.m }}>
              <Ionicons name={f.standart ? "checkbox" : "square-outline"} size={26} color={f.standart ? renk.basari : renk.metinSoluk} />
              <View style={{ marginLeft: aralik.s, flex: 1 }}>
                <Metin tur="govdeKalin">Standart tam</Metin>
                <Metin tur="minik" renk={renk.metinIkincil}>Atanan kapsam eksiksiz yapıldı, ek açıklama yok</Metin>
              </View>
            </Pressable>
          ) : null}
          {f.tur === "KISMI" ? <Bant tonAdi="uyari" metin="Kısmi iş tamamlanmış sayılmaz; montaj devam ediyor olarak kalır." style={{ marginBottom: aralik.m }} /> : null}
          {f.tur ? (
            <>
              <Alan etiket={f.tur === "KISMI" ? "Bugün yapılan iş" : "Yapılan iş"} zorunlu={f.tur === "KISMI" || !f.standart} hata={h.aciklama} cokSatir
                deger={f.aciklama} onDegis={(t) => setF((x) => ({ ...x, aciklama: t }))} ipucu="Ör. anten, RRU ve kablolar takıldı; etiketler yapıldı" />
              {f.tur === "KISMI" ? <Alan etiket="Kalan iş" zorunlu hata={h.kalan_is} cokSatir deger={f.kalan_is} onDegis={(t) => setF((x) => ({ ...x, kalan_is: t }))} ipucu="Ör. enerji bağlantısı yapılacak" /> : null}
              <Alan etiket="Sahada sorun var mı? (isteğe bağlı)" cokSatir deger={f.sorun} onDegis={(t) => setF((x) => ({ ...x, sorun: t }))} ipucu="Ör. kapı kilidi kırık, malzeme eksik" />
              <Metin tur="kucukKalin" style={{ marginBottom: aralik.xs }}>Fotoğraflar (isteğe bağlı, en çok 6)</Metin>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: aralik.xs, marginBottom: aralik.s }}>
                {fotolar.map((p, i) => (
                  <View key={p.uri}>
                    <Image source={{ uri: p.uri }} style={{ width: 84, height: 84, borderRadius: kose.s, backgroundColor: renk.cizgi }} accessibilityLabel={p.etiket} />
                    {p.yuklendi ? <View style={{ position: "absolute", right: 4, bottom: 4 }}><Ionicons name="checkmark-circle" size={20} color={renk.basari} /></View>
                      : <Pressable onPress={() => setFotolar((l) => l.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={`${p.etiket} kaldır`} hitSlop={8}
                        style={{ position: "absolute", right: -6, top: -6, backgroundColor: "#fff", borderRadius: 12 }}><Ionicons name="close-circle" size={24} color={renk.hata} /></Pressable>}
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: "row", gap: aralik.xs, marginBottom: aralik.m }}>
                <Buton baslik="Fotoğraf çek" ikon="camera-outline" tur="ikincil" kucuk style={{ flex: 1 }} onPress={() => fotoEkle("kamera")} devreDisi={fotolar.length >= FOTO_MAX} />
                <Buton baslik="Galeriden" ikon="images-outline" tur="ikincil" kucuk style={{ flex: 1 }} onPress={() => fotoEkle("galeri")} devreDisi={fotolar.length >= FOTO_MAX} />
              </View>
            </>
          ) : null}
          <Bant tonAdi="bilgi" metin="Bu bildirim QC, Huawei kabulü, PR, hakediş ya da fatura değildir. QC ve kabul Teknocenter tarafından ayrıca yapılır." />
        </>
      )}
    </Ekran>
  );
}
