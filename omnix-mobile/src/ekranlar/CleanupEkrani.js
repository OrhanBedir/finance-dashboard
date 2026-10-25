// Clean Up (rollout): saha eksik kalemleri, kalem başına önce/sonra fotoğrafı, onaya gönderme; bölge onaycısı için
// onay/red. Eski ERC Operasyon uygulamasındaki RolloutCleanupScreen akışı referans alındı (o dosya değiştirilmedi).
// Yetki ve kilit backend'de: onaya gönderilmiş / onaylanmış kayda fotoğraf eklenmez; personel yalnız kendi
// fotoğrafını kilitlenmeden önce siler; onay/red yalnız sahanın bölge onaycısında.
// Fotoğraflar bağlantı varken tek tek yüklenir (taslak kuyruğu yok); bağlantı koparsa kayıt yeniden okunur,
// fotoğraf eklendiyse listede görünür — böylece aynı fotoğraf farkında olmadan iki kez eklenmez.
import React, { useEffect, useRef, useState } from "react";
import { Alert, Image, Linking, Modal, Pressable, ScrollView, StatusBar, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { aralik, kose, renk } from "../tema";
import { BolumBasligi, Buton, Kart, Metin, Rozet } from "../bilesenler/temel";
import { Bant, BosDurum, HataDurum, IskeletKart } from "../bilesenler/durum";
import { Alan } from "../bilesenler/form";
import { Ekran } from "../bilesenler/Ekran";
import { useOturum } from "../oturum/OturumSaglayici";
import { useGecersizKil, useVeri } from "../api/veri";
import { cleanupApi } from "../api/uclar";
import { durumBilgisi } from "../mantik/durumlar";
import { tarih } from "../mantik/bicim";
import { hataMetni } from "../mantik/hata";
import { cleanupDurumu, duzenlenebilir, fotoSilinebilir, ilerleme, kalemFotolari, kalemleri, kalemMetni } from "../mantik/cleanup";
import { fisSec, FisHatasi } from "../taslak/fis";
import { fotoSil } from "../taslak/taslakDepo";

const temizKod = (s) => String(s || "").replace(/\s+/g, "").toUpperCase();

export function CleanupEkrani({ route }) {
  const onayModu = !!route.params?.onayModu;
  const [site, setSite] = useState(temizKod(route.params?.site));
  const [arama, setArama] = useState("");
  if (!site) {
    return (
      <Ekran baslik="Clean Up" altBaslik="Site ID ile aç" klavye>
        <Kart>
          <Alan etiket="Site ID" deger={arama} onDegis={(x) => setArama(x.toUpperCase())} buyukHarf="characters" autoCorrect={false}
            ipucu="Örn. IZ1900_L2100_AE" returnKeyType="search" onSubmitEditing={() => temizKod(arama).length >= 4 && setSite(temizKod(arama))} />
          <Buton baslik="Getir" ikon="search" onPress={() => (temizKod(arama).length >= 4 ? setSite(temizKod(arama)) : Alert.alert("Site ID", "Saha kodunu yazın."))} />
        </Kart>
      </Ekran>
    );
  }
  return <CleanupKaydi key={site} site={site} onayModu={onayModu} />;
}

function CleanupKaydi({ site, onayModu }) {
  const { kullanici, kapsam } = useOturum();
  const gecersizKil = useGecersizKil();
  const anahtar = `cleanup:${site}`;
  const v = useVeri(anahtar, async () => (await cleanupApi.saha(site)).row || null);
  const [yerel, setYerel] = useState(null); // son işlemin döndürdüğü satır (yeniden okuma gelene kadar)
  useEffect(() => { setYerel(null); }, [v.veri]);
  const kayit = yerel || v.veri;
  const [yukleniyor, setYukleniyor] = useState(null); // `${kalemId}_${tip}`
  const [bekle, setBekle] = useState(false);
  const [buyuk, setBuyuk] = useState(null); // { foto, kalem }
  const [red, setRed] = useState(null); // metin
  const kilit = useRef(false);
  const alt = useSafeAreaInsets().bottom;

  const tazele = () => gecersizKil([anahtar, "cleanupAtanan", "cleanupOnay"]);
  const islem = async (is, { basari, belirsiz } = {}) => {
    if (kilit.current) return false;
    kilit.current = true; setBekle(true);
    try {
      const d = await is();
      if (d?.row) setYerel(d.row);
      tazele();
      if (basari) Alert.alert(basari[0], basari[1]);
      return true;
    } catch (e) {
      tazele();
      Alert.alert("İşlem tamamlanamadı", e?.sonucBelirsiz ? (belirsiz || "Bağlantı koptu. Kayıt yenilendi; gerekiyorsa tekrar deneyin.") : hataMetni(e));
      return false;
    } finally { kilit.current = false; setBekle(false); }
  };

  const fotoEkle = (k, tip) => {
    Alert.alert(`${tip === "once" ? "Önce" : "Sonra"} fotoğrafı`, kalemMetni(k), [
      { text: "Kamera", onPress: () => secVeYukle(k, tip, "kamera") },
      { text: "Galeri", onPress: () => secVeYukle(k, tip, "galeri") },
      { text: "Vazgeç", style: "cancel" },
    ]);
  };

  const secVeYukle = async (k, tip, kaynak) => {
    let f = null;
    try {
      f = await fisSec(kaynak, kapsam);
    } catch (e) {
      if (e instanceof FisHatasi && e.ayarlar) Alert.alert("İzin gerekli", e.message, [{ text: "Vazgeç", style: "cancel" }, { text: "Ayarları aç", onPress: () => Linking.openSettings() }]);
      else Alert.alert("Fotoğraf eklenemedi", e instanceof FisHatasi ? e.message : "Fotoğraf hazırlanırken bir sorun oluştu.");
      return;
    }
    if (!f) return;
    setYukleniyor(`${k.id}_${tip}`);
    try {
      await islem(() => cleanupApi.fotoYukle(site, k.id, tip, { uri: f.uri, ad: `${site}_${tip}.jpg`, mime: "image/jpeg" }), {
        belirsiz: "Bağlantı koptu. Kayıt yenilendi: fotoğraf kalemin altında görünüyorsa yüklenmiştir, görünmüyorsa tekrar ekleyin.",
      });
    } finally {
      fotoSil(f.uri); // telefondaki geçici kopya
      setYukleniyor(null);
    }
  };

  const fotoKaldir = (foto, k) => Alert.alert("Fotoğrafı sil", "Bu fotoğraf kayıttan kaldırılacak.", [
    { text: "Vazgeç", style: "cancel" },
    { text: "Sil", style: "destructive", onPress: async () => { if (await islem(() => cleanupApi.fotoSil(site, k.id, foto.url))) setBuyuk(null); } },
  ]);

  const onayaGonder = () => {
    const p = ilerleme(kayit);
    if (!p.gonderilebilir) {
      Alert.alert("Eksik fotoğraf", `${p.sonraEksik} kalemin "Sonra" fotoğrafı yok. Her kalem için en az bir "Sonra" fotoğrafı çekin.`);
      return;
    }
    Alert.alert("Onaya gönder", "Tüm eksikler tamamlandı olarak bölge onaycısına gönderilecek. Gönderdikten sonra fotoğraf eklenemez.", [
      { text: "Vazgeç", style: "cancel" },
      { text: "Gönder", onPress: () => islem(() => cleanupApi.onayaGonder(site), { basari: ["Onaya gönderildi", "Bölge onaycısının listesine düştü."] }) },
    ]);
  };

  const onayla = () => Alert.alert("Onayla", `${site} Clean Up işleri onaylansın mı?`, [
    { text: "Vazgeç", style: "cancel" },
    { text: "Onayla", onPress: () => islem(() => cleanupApi.onayla(site), { basari: ["Onaylandı", ""] }) },
  ]);

  const redGonder = async () => {
    if (!red?.trim()) { Alert.alert("Gerekçe gerekli", "Ekibin neyi düzelteceğini kısaca yazın."); return; }
    if (await islem(() => cleanupApi.reddet(site, red.trim()), { basari: ["Reddedildi", "Ekip düzeltip yeniden gönderecek."] })) setRed(null);
  };

  if (v.yukleniyor && !kayit) return <Ekran baslik={site} altBaslik="Clean Up"><IskeletKart /><IskeletKart /></Ekran>;
  if (v.hata && !kayit) return <Ekran baslik={site} altBaslik="Clean Up"><Kart><HataDurum hata={v.hata} onTekrar={v.yenile} /></Kart></Ekran>;
  if (!kayit) {
    return (
      <Ekran baslik={site} altBaslik="Clean Up" yenileniyor={v.yenileniyor} onYenile={v.yenile}>
        <Kart><BosDurum ikon="construct-outline" baslik="Bu saha için Clean Up kaydı yok" aciklama="Kayıt ofisten (Rollout Data → Clean Up) açılır; eksikler girildikten sonra burada görünür." /></Kart>
      </Ekran>
    );
  }

  const durumKod = cleanupDurumu(kayit);
  const d = durumBilgisi("cleanup", durumKod);
  const p = ilerleme(kayit);
  const acik = duzenlenebilir(kayit);
  const onaylayabilir = !!kayit.onay_yetkim && durumKod === "ONAY_BEKLE";
  const altCubuk = onayModu || onaylayabilir
    ? (onaylayabilir ? (
      <View style={{ flexDirection: "row", gap: aralik.s }}>
        <Buton baslik="Reddet" tur="tehlike" onPress={() => setRed("")} devreDisi={bekle} style={{ flex: 1 }} />
        <Buton baslik="Onayla" tur="basari" ikon="checkmark" onPress={onayla} yukleniyor={bekle} style={{ flex: 1.4 }} />
      </View>) : null)
    : acik && p.toplam ? (
      <Buton baslik={durumKod === "RED" ? "Düzeltildi — tekrar onaya gönder" : "Onaya gönder"} ikon="send" onPress={onayaGonder} yukleniyor={bekle && !yukleniyor}
        tur={p.gonderilebilir ? "birincil" : "ikincil"} erisimIpucu={p.gonderilebilir ? undefined : `${p.sonraEksik} kalemde Sonra fotoğrafı eksik`} />
    ) : null;

  return (
    <Ekran baslik={site} altBaslik={onayModu ? "Clean Up · onay" : "Clean Up"} yenileniyor={v.yenileniyor} onYenile={v.yenile} alt={altCubuk}>
      <Kart>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Metin tur="baslikM" style={{ flex: 1, fontWeight: "700" }}>{p.toplam ? `${p.tamam}/${p.toplam} kalem tamamlandı` : "Eksik kalem girilmemiş"}</Metin>
          <Rozet metin={d.ad} tonAdi={d.ton} />
        </View>
        {p.toplam ? (
          <View style={{ height: 8, borderRadius: 4, backgroundColor: renk.cizgi, marginTop: aralik.s, overflow: "hidden" }}>
            <View style={{ height: 8, width: `${Math.round((100 * p.tamam) / p.toplam)}%`, backgroundColor: renk.basari }} />
          </View>
        ) : null}
        <Metin tur="kucuk" renk={renk.metinIkincil} style={{ marginTop: aralik.s }}>
          {[kayit.bolge, kayit.visit_date ? `Ziyaret ${tarih(kayit.visit_date)}` : null, kayit.completion_date ? `Tamamlama ${tarih(kayit.completion_date)}` : null].filter(Boolean).join(" · ") || "Tarih girilmemiş"}
        </Metin>
        {durumKod === "RED" && kayit.red_notu ? <Bant tonAdi="hata" baslik="Red gerekçesi" metin={kayit.red_notu} style={{ marginTop: aralik.s }} /> : null}
        {durumKod === "ONAY_BEKLE" && !onaylayabilir ? (
          <Bant tonAdi="uyari" metin={`Onay bekleniyor${kayit.onaya_gonderme_tarihi ? ` · ${tarih(kayit.onaya_gonderme_tarihi)}` : ""}. Bu aşamada fotoğraf eklenemez.`} style={{ marginTop: aralik.s }} />
        ) : null}
        {durumKod === "ONAYLANDI" ? <Bant tonAdi="basari" metin={`Onaylandı${kayit.onay_tarihi ? ` · ${tarih(kayit.onay_tarihi)}` : ""}`} style={{ marginTop: aralik.s }} /> : null}
        {acik && !onayModu ? <Bant tonAdi="bilgi" metin={'Her kalem için önce ve sonra fotoğrafı çekin. "Sonra" fotoğrafı yüklenince kalem tamamlanır. Fotoğraflar bağlantı varken yüklenir.'} style={{ marginTop: aralik.s }} /> : null}
      </Kart>

      <BolumBasligi baslik="Eksik kalemler" />
      {kalemleri(kayit).map((k) => {
        const { once, sonra } = kalemFotolari(k);
        const fotolar = [...once.map((f) => ({ ...f, e: "Önce" })), ...sonra.map((f) => ({ ...f, e: "Sonra" }))];
        return (
          <Kart key={k.id} style={{ marginBottom: aralik.s, borderLeftWidth: 4, borderLeftColor: k.tamamlandi ? renk.basari : renk.cizgiKoyu }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
              <Ionicons name={k.tamamlandi ? "checkmark-circle" : "ellipse-outline"} size={22} color={k.tamamlandi ? renk.basari : renk.metinSoluk} />
              <Metin tur="govdeKalin" style={{ flex: 1, marginLeft: aralik.xs }}>{kalemMetni(k)}</Metin>
            </View>
            {fotolar.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: aralik.s }}>
                {fotolar.map((f, i) => (
                  <Pressable key={`${f.url}-${i}`} onPress={() => setBuyuk({ foto: f, kalem: k })} accessibilityRole="imagebutton" accessibilityLabel={`${f.e} fotoğrafı`}
                    style={{ marginRight: aralik.xs, alignItems: "center" }}>
                    <Image source={{ uri: f.url }} style={{ width: onayModu ? 112 : 76, height: onayModu ? 112 : 76, borderRadius: kose.s, backgroundColor: renk.cizgi }} />
                    <Metin tur="minik" renk={f.e === "Sonra" ? renk.basari : renk.uyari} style={{ marginTop: 2, fontWeight: "700" }}>{f.e}</Metin>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            {(onayModu || !acik) && !sonra.length ? <Metin tur="kucuk" renk={renk.hata} style={{ marginTop: aralik.xs }}>Bu kalemde "Sonra" fotoğrafı yok.</Metin> : null}
            {acik && !onayModu ? (
              <View style={{ flexDirection: "row", gap: aralik.xs, marginTop: aralik.s }}>
                <Buton baslik={`Önce${once.length ? ` (${once.length})` : ""}`} ikon="camera-outline" tur="ikincil" kucuk onPress={() => fotoEkle(k, "once")}
                  yukleniyor={yukleniyor === `${k.id}_once`} devreDisi={!!yukleniyor || bekle} style={{ flex: 1 }} />
                <Buton baslik={`Sonra${sonra.length ? ` (${sonra.length})` : ""}`} ikon="camera" tur="basari" kucuk onPress={() => fotoEkle(k, "sonra")}
                  yukleniyor={yukleniyor === `${k.id}_sonra`} devreDisi={!!yukleniyor || bekle} style={{ flex: 1 }} />
              </View>
            ) : null}
          </Kart>
        );
      })}
      {kayit.notlar ? <Bant tonAdi="notr" baslik="Ofis notu" metin={kayit.notlar} /> : null}

      <Modal visible={!!buyuk} animationType="fade" onRequestClose={() => setBuyuk(null)} onDismiss={() => StatusBar.setBarStyle("dark-content", true)}>
        <View style={{ flex: 1, backgroundColor: "#05080F", paddingBottom: alt + aralik.s }}>
          <StatusBar barStyle="light-content" />
          {buyuk ? (
            <>
              <Image source={{ uri: buyuk.foto.url }} resizeMode="contain" style={{ flex: 1 }} accessibilityLabel={`${buyuk.foto.e} fotoğrafı`} />
              <Metin tur="kucuk" renk="#AAB4C3" style={{ textAlign: "center", marginVertical: aralik.xs }}>
                {`${buyuk.foto.e} · ${kalemMetni(buyuk.kalem)}${buyuk.foto.tarih ? ` · ${tarih(buyuk.foto.tarih)}` : ""}`}
              </Metin>
              <View style={{ flexDirection: "row", gap: aralik.s, paddingHorizontal: aralik.m }}>
                {fotoSilinebilir(buyuk.foto, kullanici.email, kayit) && !onayModu
                  ? <Buton baslik="Fotoğrafı sil" ikon="trash-outline" tur="tehlike" onPress={() => fotoKaldir(buyuk.foto, buyuk.kalem)} yukleniyor={bekle} style={{ flex: 1 }} />
                  : null}
                <Buton baslik="Kapat" tur="ikincil" onPress={() => setBuyuk(null)} style={{ flex: 1 }} />
              </View>
            </>
          ) : null}
        </View>
      </Modal>

      <Modal visible={red !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setRed(null)}>
        <View style={{ flex: 1, backgroundColor: renk.yuzey, padding: aralik.m, paddingBottom: alt + aralik.m }}>
          <Buton baslik="Kapat" tur="metin" kucuk onPress={() => setRed(null)} style={{ alignSelf: "flex-end" }} />
          <Metin tur="baslikM" style={{ fontWeight: "700", marginBottom: aralik.s }}>Reddetme gerekçesi</Metin>
          <Alan cokSatir deger={red || ""} onDegis={setRed} ipucu="Ekip bu metni görecek" autoFocus />
          <Buton baslik="Reddet" tur="tehlike" onPress={redGonder} yukleniyor={bekle} />
        </View>
      </Modal>
    </Ekran>
  );
}
